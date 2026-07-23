import { describe, it, expect } from 'vitest';
import { buildArenaWorld } from '../scenes/buildArenaWorld.js';
import { createScoreState } from '../state/ScoreState.js';
import {
  FIXED_STEP_MS,
  GREEN_SQUARE_XP,
  XP_MULTIPLIER_DIVISOR,
  SCORE_MULTIPLIER_MAX,
  BLACKHOLE_MIN_RADIUS,
  BLACKHOLE_SHRINK_PER_BULLET,
  BLACKHOLE_DEFUSED_XP,
  MIRROR_CENTER_KILL_XP,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// XP-orb economy integration (Story 8.1). The unit tests exercise the XpOrbSystem
// over STUBBED report objects; this file composes the REAL systems over ONE shared
// ScoreState + ship + pools in the exact fixed-step order ArenaScene registers them
// (…CollisionSystem → ScoringSystem → BlackHoleSystem → BombSystem → XpOrbSystem →
// PlayerDeath…) and drives a REAL bullet kill, so the whole seam is proven end-to-end:
// a real enemy carries a real per-type xp, the real CollisionSystem snapshots it into
// bulletKillXp, and the real XpOrbSystem drops + collects an orb that credits the real
// scoreState.xp. Also pins the economy-parity guarantee (a bomb-cleared kill drops no
// XP) and the xp:0 init (a NaN regression guard). Phaser-free, deterministic.

// Deterministic rng cycling a fixed sequence in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Compose the real chain via the shared factory — the SAME construction (order,
// pools, late-binds, and the XpOrbSystem wired after the bomb late-bind) ArenaScene
// uses — then pull the handles this file drives. runTick drives a curated subset over
// hand-placed entities (the factory is used for CONSTRUCTION only; world.fixedUpdate
// is never invoked here, so no SpawnDirector spawns interfere).
function makeComposed() {
  const ctx = buildArenaWorld({ rng: seqRng([0.5, 0.5]) });
  return {
    ...ctx,
    bulletPool: ctx.firingSystem.bulletPool,
    seekerPool: ctx.enemySystem.enemyPool,
    greenPool: ctx.greenSquareSystem.enemyPool,
  };
}

// One simulated fixed tick in ArenaScene's exact registration order (the slice from
// the mirror reflector through the orb system, then death — everything that can move XP
// or clear an enemy this tick). MirrorReflectorSystem is registered in the enemy section
// BEFORE the collision/scoring chain; XpOrbSystem runs AFTER BombSystem. With no live
// reflectors mirror.fixedUpdate is a no-op (it self-spawns nothing — spawning is via
// spawn(), not fixedUpdate), so adding it here is safe for the bullet/bomb cases.
function runTick(ctx) {
  ctx.mirrorReflectorSystem.fixedUpdate(DT);
  ctx.collisionSystem.fixedUpdate(DT);
  ctx.scoringSystem.fixedUpdate(DT);
  ctx.blackHoleSystem.fixedUpdate(DT);
  ctx.bombSystem.fixedUpdate(DT);
  ctx.xpOrbSystem.fixedUpdate(DT);
  ctx.playerDeathSystem.fixedUpdate(DT);
}

function addBullet(pool, x, y) {
  const b = pool.acquire();
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
  return b;
}

// An ACTIVE (telegraphMs 0) green square at (x,y) — its real per-type xp is GREEN_SQUARE_XP.
function addGreen(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = 0;
  return s;
}

function addSeeker(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = 0;
  return s;
}

function activeOrbs(system) {
  const out = [];
  system.pool.forEachActive((o) => out.push(o));
  return out;
}

describe('XP-orb integration — full tick chain in ArenaScene order', () => {
  it('a real bullet kill drops an orb that credits the real per-type XP × (1 + mult/20)', () => {
    const ctx = makeComposed();
    const { ship, scoreState, bulletPool, greenPool } = ctx;
    // Ship parked far from the kill so the orb neither drifts nor collects on the
    // spawn tick (isolating the drop), and the killed enemy never contacts the ship.
    ship.x = 200;
    ship.y = 200;
    // Cap the multiplier so a kill's scoring cannot bump it — the collect-time value
    // stays exactly SCORE_MULTIPLIER_MAX, making the scaling assertion deterministic.
    scoreState.multiplier = SCORE_MULTIPLIER_MAX;
    const KILL_X = 800;
    const KILL_Y = 400;
    // A real green square (xp === GREEN_SQUARE_XP) with a bullet dead on top of it.
    addGreen(greenPool, KILL_X, KILL_Y);
    addBullet(bulletPool, KILL_X, KILL_Y);

    // Tick 1: the REAL CollisionSystem kills the square and snapshots its xp into
    // bulletKillXp; the REAL XpOrbSystem drops one orb at the kill point (advance-then-
    // spawn: it is NOT collected this tick even though the report is real).
    runTick(ctx);
    expect(greenPool.activeCount).toBe(0); // genuinely bullet-killed
    expect(ctx.collisionSystem.bulletKillCount).toBe(1);
    expect(ctx.collisionSystem.bulletKillXp).toEqual([GREEN_SQUARE_XP]);
    const orbs = activeOrbs(ctx.xpOrbSystem);
    expect(orbs.length).toBe(1);
    expect(orbs[0].x).toBe(KILL_X);
    expect(orbs[0].y).toBe(KILL_Y);
    expect(orbs[0].value).toBe(GREEN_SQUARE_XP); // the REAL per-type value, not a stub
    expect(scoreState.xp).toBe(0); // not yet collected

    // Tick 2: move the ship onto the orb → the REAL XpOrbSystem collects it and credits
    // value × (1 + multiplier / XP_MULTIPLIER_DIVISOR) at collect time.
    ship.x = KILL_X;
    ship.y = KILL_Y;
    runTick(ctx);
    expect(activeOrbs(ctx.xpOrbSystem).length).toBe(0); // collected
    const expected = GREEN_SQUARE_XP * (1 + SCORE_MULTIPLIER_MAX / XP_MULTIPLIER_DIVISOR);
    expect(scoreState.xp).toBeCloseTo(expected, 9);
    expect(scoreState.xp).toBeCloseTo(3.0, 9); // 2 × (1 + 10/20)
  });

  it('economy parity: a bomb-cleared kill credits NO XP and drops no orb', () => {
    const ctx = makeComposed();
    const { ship, inputState, scoreState, seekerPool } = ctx;
    ship.x = 200;
    ship.y = 200;
    // Two active enemies cleared by a bomb (unscored removals appended to killedEnemies
    // but NOT to bulletKillCount/bulletKillXp) — the XP economy must mirror score.
    addSeeker(seekerPool, 900, 500);
    addSeeker(seekerPool, 950, 520);

    inputState.queueBomb();
    runTick(ctx);

    // The bomb fired (enemies gone) but no XP was earned and no orb was dropped.
    expect(seekerPool.activeCount).toBe(0);
    expect(ctx.collisionSystem.bulletKillCount).toBe(0); // no BULLET kills this tick
    expect(activeOrbs(ctx.xpOrbSystem).length).toBe(0);
    expect(scoreState.xp).toBe(0);
  });

  it('a real black-hole implosion ("defused") drops a value-25 orb that credits XP end-to-end', () => {
    const ctx = makeComposed();
    const { ship, scoreState } = ctx;
    // Ship parked far so the value-25 orb neither drifts nor collects on the drop tick.
    ship.x = 200;
    ship.y = 200;
    scoreState.multiplier = SCORE_MULTIPLIER_MAX; // deterministic collect-time scaling
    const HX = 800;
    const HY = 400;
    // A real hole one bullet-shrink above the floor, with a bullet dead on it → the REAL
    // BlackHoleSystem safely implodes it this tick (not a detonation).
    const hole = ctx.blackHoleSystem.holePool.acquire();
    hole.x = HX;
    hole.y = HY;
    hole.radius = BLACKHOLE_MIN_RADIUS + BLACKHOLE_SHRINK_PER_BULLET;
    hole.telegraphMs = 0;
    addBullet(ctx.firingSystem.bulletPool, HX, HY);

    // Tick 1: real implosion → real defusedX/Y report → real XpOrbSystem drops one orb
    // (advance-then-spawn: not collected this tick).
    runTick(ctx);
    expect(ctx.blackHoleSystem.holePool.activeCount).toBe(0); // genuinely imploded
    expect(ctx.blackHoleSystem.defusedX).toEqual([HX]);
    const orbs = activeOrbs(ctx.xpOrbSystem);
    expect(orbs.length).toBe(1);
    expect(orbs[0].x).toBe(HX);
    expect(orbs[0].y).toBe(HY);
    expect(orbs[0].value).toBe(BLACKHOLE_DEFUSED_XP); // the REAL 25, not a stub
    expect(scoreState.xp).toBe(0); // not yet collected

    // Tick 2: ship onto the orb → collected, crediting 25 × (1 + mult/20).
    ship.x = HX;
    ship.y = HY;
    runTick(ctx);
    expect(activeOrbs(ctx.xpOrbSystem).length).toBe(0);
    const expected =
      BLACKHOLE_DEFUSED_XP * (1 + SCORE_MULTIPLIER_MAX / XP_MULTIPLIER_DIVISOR);
    expect(scoreState.xp).toBeCloseTo(expected, 9);
  });

  it('a real mirror center-kill drops a value-15 orb that credits XP end-to-end', () => {
    const ctx = makeComposed();
    const { ship, scoreState } = ctx;
    scoreState.multiplier = SCORE_MULTIPLIER_MAX; // deterministic collect-time scaling
    const RX = 500;
    const RY = 300;
    // Ship exactly on the reflector center → a REAL center-destroy this tick (the orb
    // spawns at the center, i.e. under the ship, so it collects on the NEXT tick).
    ship.x = RX;
    ship.y = RY;
    const r = ctx.mirrorReflectorSystem.enemyPool.acquire();
    r.x = RX;
    r.y = RY;
    r.vx = 0;
    r.vy = 0;
    r.angle = 0;
    r.telegraphMs = 0;

    // Tick 1: real center-destroy → real centerKillX/Y report → real XpOrbSystem drops
    // one orb at the center (advance-then-spawn: not collected this tick).
    runTick(ctx);
    expect(ctx.mirrorReflectorSystem.enemyPool.activeCount).toBe(0); // destroyed
    expect(ctx.mirrorReflectorSystem.centerKillX).toEqual([RX]);
    const orbs = activeOrbs(ctx.xpOrbSystem);
    expect(orbs.length).toBe(1);
    expect(orbs[0].value).toBe(MIRROR_CENTER_KILL_XP); // the REAL 15, not a stub
    expect(scoreState.xp).toBe(0); // not yet collected

    // Tick 2: ship still on the orb (at the center) → collected, crediting 15 × (1 + mult/20).
    runTick(ctx);
    expect(activeOrbs(ctx.xpOrbSystem).length).toBe(0);
    const expected =
      MIRROR_CENTER_KILL_XP * (1 + SCORE_MULTIPLIER_MAX / XP_MULTIPLIER_DIVISOR);
    expect(scoreState.xp).toBeCloseTo(expected, 9);
  });

  it('createScoreState() initializes xp to 0 (guards the xp:0 init → NaN regression)', () => {
    // A missing/undefined init would make the first `scoreState.xp += …` produce NaN,
    // permanently poisoning the run XP total — this pins the finite zero start.
    const state = createScoreState();
    expect(state.xp).toBe(0);
    expect(Number.isFinite(state.xp)).toBe(true);
    // The composed world's shared state starts there too.
    const ctx = makeComposed();
    expect(ctx.scoreState.xp).toBe(0);
  });
});
