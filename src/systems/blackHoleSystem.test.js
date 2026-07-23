import { describe, it, expect } from 'vitest';
import { BlackHoleSystem } from './BlackHoleSystem.js';
import { BombSystem } from './BombSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { SnakeSystem } from './SnakeSystem.js';
import { Pool } from '../core/Pool.js';
import { createBlackHole, blackHoleInstability } from '../entities/BlackHole.js';
import { createBullet } from '../entities/Bullet.js';
import { createSeeker } from '../entities/Seeker.js';
import { createPinwheel } from '../entities/Pinwheel.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import { InputState } from '../input/InputState.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  SHIP_RADIUS,
  BULLET_RADIUS,
  BLACKHOLE_RADIUS,
  BLACKHOLE_UNSTABLE_RADIUS,
  BLACKHOLE_MIN_RADIUS,
  BLACKHOLE_GRAVITY_RADIUS,
  BLACKHOLE_GRAVITY_STRENGTH,
  BLACKHOLE_GROWTH_PER_ABSORB,
  BLACKHOLE_SHRINK_PER_BULLET,
  BLACKHOLE_SPAWN_INTERVAL_MS,
  BLACKHOLE_MAX_ACTIVE,
  BLACKHOLE_POOL_PREWARM,
  BLACKHOLE_SCORE,
  PLAYER_INVULN_MS,
  PLAYER_START_LIVES,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const DT_SEC = DT / 1000;
const CENTER_X = ARENA_WIDTH / 2;
const CENTER_Y = ARENA_HEIGHT / 2;

// Deterministic rng that cycles a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Build a system with real pools (Story 6.2 signature: no spawnPool; playerState
// is shared so a detonation can cost a life).
function makeSystem({
  ship = createPlayerShip(),
  bulletPool = new Pool(createBullet),
  enemyPools = [new Pool(createSeeker)],
  scoreState = createScoreState(),
  playerState = createPlayerState(),
  rng = seqRng([0.5, 0.5]),
} = {}) {
  const system = new BlackHoleSystem(
    ship,
    bulletPool,
    enemyPools,
    scoreState,
    playerState,
    rng,
  );
  return { system, ship, bulletPool, enemyPools, scoreState, playerState };
}

// Capture the active instances of a pool via the public API (no private-Set
// access). Returns them as an array in iteration order.
function activeOf(pool) {
  const out = [];
  pool.forEachActive((x) => out.push(x));
  return out;
}

// Place a live hole at (x,y) directly (bypassing random spawn), re-initialized to
// a fresh (stable) shape unless overridden. Returns the pooled hole instance.
function placeHole(system, x, y, over = {}) {
  const h = system.holePool.acquire();
  h.x = x;
  h.y = y;
  h.radius = over.radius ?? BLACKHOLE_RADIUS;
  h.telegraphMs = over.telegraphMs ?? 0;
  return h;
}

describe('createBlackHole factory + blackHoleInstability', () => {
  it('returns the starting {x,y,radius,telegraphMs} shape (stationary — no velocity, no hp/feed)', () => {
    const h = createBlackHole();
    expect(h.x).toBe(0);
    expect(h.y).toBe(0);
    expect(h.radius).toBe(BLACKHOLE_RADIUS);
    expect(h.telegraphMs).toBe(0); // spawned-and-active default (Story 2.6)
    expect('vx' in h).toBe(false);
    expect('vy' in h).toBe(false);
    expect('hp' in h).toBe(false); // removed (Story 6.2)
    expect('feed' in h).toBe(false); // removed (Story 6.2)
  });

  it('blackHoleInstability is 0 at the stable radius, 1 at the unstable threshold, and clamps outside', () => {
    expect(blackHoleInstability(BLACKHOLE_RADIUS)).toBe(0);
    expect(blackHoleInstability(BLACKHOLE_UNSTABLE_RADIUS)).toBe(1);
    // Below the stable radius (a shrinking hole) clamps to 0; above the threshold clamps to 1.
    expect(blackHoleInstability(BLACKHOLE_MIN_RADIUS)).toBe(0);
    expect(blackHoleInstability(BLACKHOLE_UNSTABLE_RADIUS + 100)).toBe(1);
    // Midpoint radius interpolates linearly.
    const mid = (BLACKHOLE_RADIUS + BLACKHOLE_UNSTABLE_RADIUS) / 2;
    expect(blackHoleInstability(mid)).toBeCloseTo(0.5, 9);
  });
});

describe('BlackHoleSystem — hoisted collector stability (NFR2)', () => {
  it('reuses the same hole + bullet collector references across ticks', () => {
    const { system } = makeSystem();
    const holeRef = system._collectHole;
    const bulletRef = system._collectBullet;
    system.fixedUpdate(DT);
    expect(system._collectHole).toBe(holeRef);
    expect(system._collectBullet).toBe(bulletRef);
  });
});

describe('BlackHoleSystem — gravity (AC1)', () => {
  it('pulls an entity within range toward the hole by STRENGTH·(1−d/R)·dtSec', () => {
    const { system, ship } = makeSystem();
    placeHole(system, CENTER_X, CENTER_Y);
    const d = 100;
    ship.x = CENTER_X - d;
    ship.y = CENTER_Y;

    system.fixedUpdate(DT);

    const pull =
      BLACKHOLE_GRAVITY_STRENGTH * (1 - d / BLACKHOLE_GRAVITY_RADIUS) * DT_SEC;
    expect(ship.x).toBeCloseTo(CENTER_X - d + pull, 9);
    expect(ship.y).toBeCloseTo(CENTER_Y, 9);
    expect(pull).toBeGreaterThan(0);
  });

  it('pulls active bullets and enemies too, not just the ship', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({ bulletPool, enemyPools: [enemyPool] });
    placeHole(system, CENTER_X, CENTER_Y);

    const b = bulletPool.acquire();
    b.x = CENTER_X - 80;
    b.y = CENTER_Y;
    const e = enemyPool.acquire();
    e.x = CENTER_X + 120;
    e.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(b.x).toBeGreaterThan(CENTER_X - 80);
    expect(e.x).toBeLessThan(CENTER_X + 120);
    expect(b.y).toBeCloseTo(CENTER_Y, 9);
    expect(e.y).toBeCloseTo(CENTER_Y, 9);
  });

  it('does not move an entity at or beyond the gravity radius', () => {
    const { system, ship } = makeSystem();
    placeHole(system, CENTER_X, CENTER_Y);
    ship.x = CENTER_X - BLACKHOLE_GRAVITY_RADIUS;
    ship.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(ship.x).toBe(CENTER_X - BLACKHOLE_GRAVITY_RADIUS);
    expect(ship.y).toBe(CENTER_Y);
  });

  it('does not move an entity coincident with the core (no direction, no NaN)', () => {
    const { system, ship } = makeSystem();
    placeHole(system, CENTER_X, CENTER_Y);
    ship.x = CENTER_X;
    ship.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    expect(Number.isNaN(ship.x)).toBe(false);
    expect(Number.isNaN(ship.y)).toBe(false);
  });

  it('single-step pull scales with dt (a 2·dt step displaces twice a dt step)', () => {
    const d = 150;
    function stepOnce(tickMs) {
      const { system, ship } = makeSystem();
      placeHole(system, CENTER_X, CENTER_Y);
      ship.x = CENTER_X - d;
      ship.y = CENTER_Y;
      system.fixedUpdate(tickMs);
      return ship.x - (CENTER_X - d);
    }
    const small = stepOnce(DT);
    const big = stepOnce(2 * DT);
    expect(big).toBeCloseTo(2 * small, 9);
  });
});

describe('BlackHoleSystem — enemy absorption GROWS the radius (AC — grow)', () => {
  it('releases the enemy to its OWN pool, appends to killedEnemies, grows the radius, does NOT score', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    const scoring = new ScoringSystem(collision, scoreState);
    system.collisionSystem = collision;

    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const startRadius = hole.radius;
    const e = enemyPool.acquire();
    e.x = CENTER_X;
    e.y = CENTER_Y;

    // Mirror the real tick order: Collision → Scoring → BlackHole.
    collision.fixedUpdate(DT);
    scoring.fixedUpdate(DT);
    const scoreBefore = scoreState.score;
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0); // released to its own pool
    expect(collision.killedEnemies).toContain(e); // reconciliation seam
    expect(hole.radius).toBeCloseTo(startRadius + BLACKHOLE_GROWTH_PER_ABSORB, 9);
    // Absorbed enemy is NOT scored (BlackHoleSystem runs AFTER ScoringSystem).
    expect(scoreState.score).toBe(scoreBefore);
  });

  it('does NOT absorb enemies before the collision system is late-bound (guarded); gravity + bullet-shrink still run', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({ bulletPool, enemyPools: [enemyPool] });
    expect(system.collisionSystem).toBeNull();

    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const startRadius = hole.radius;
    const e = enemyPool.acquire();
    e.x = CENTER_X + 5;
    e.y = CENTER_Y;
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    // Enemy not absorbed (still active), but gravity moved it and the bullet shrank.
    expect(enemyPool.activeCount).toBe(1);
    expect(bulletPool.activeCount).toBe(0);
    expect(hole.radius).toBeCloseTo(startRadius - BLACKHOLE_SHRINK_PER_BULLET, 9);
    expect(e.x).not.toBe(CENTER_X + 5);
  });

  it('routes an absorbed enemy to ITS OWN owning pool across multiple archetype pools', () => {
    const bulletPool = new Pool(createBullet);
    const seekerPool = new Pool(createSeeker);
    const pinwheelPool = new Pool(createPinwheel);
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [seekerPool, pinwheelPool],
    });
    const collision = new CollisionSystem(bulletPool, [seekerPool, pinwheelPool]);
    system.collisionSystem = collision;

    placeHole(system, CENTER_X, CENTER_Y);
    const pw = pinwheelPool.acquire();
    pw.x = CENTER_X;
    pw.y = CENTER_Y;

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(pinwheelPool.activeCount).toBe(0);
    expect(pinwheelPool.freeCount).toBe(1);
    expect(seekerPool.activeCount).toBe(0);
    expect(seekerPool.freeCount).toBe(0);
    expect(collision.killedEnemies).toContain(pw);
  });

  it('a real snake reconciles an absorbed mid-chain segment (split via killedEnemies)', () => {
    const bulletPool = new Pool(createBullet);
    const snakeSystem = new SnakeSystem(seqRng([0.1, 0.5]));
    const segPool = snakeSystem.enemyPool;
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [segPool],
    });
    const collision = new CollisionSystem(bulletPool, [segPool]);
    system.collisionSystem = collision;
    snakeSystem.collisionSystem = collision;

    const hx = 400;
    const hy = 400;
    const segments = [];
    for (let i = 0; i < 5; i++) {
      const seg = segPool.acquire();
      seg.x = hx - i * 80;
      seg.y = hy;
      seg.vx = 0;
      seg.vy = 0;
      segments.push(seg);
    }
    snakeSystem.snakes.push({ segments, headingRad: 0, slitherPhaseRad: 0 });
    const target = segments[2];

    placeHole(system, target.x, target.y);

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(collision.killedEnemies).toContain(target);
    expect(segPool.activeCount).toBe(4);

    snakeSystem.fixedUpdate(DT);
    for (const sk of snakeSystem.snakes) {
      expect(sk.segments).not.toContain(target);
    }
    expect(snakeSystem.snakes.length).toBe(2);
    expect(segPool.activeCount).toBe(4);
    const stillActive = activeOf(segPool);
    expect(stillActive).not.toContain(target);
  });
});

describe('BlackHoleSystem — bullet absorption SHRINKS the radius (AC — shrink)', () => {
  it('absorbs an overlapping bullet: releases it and shrinks the radius', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const startRadius = hole.radius;

    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(bulletPool.activeCount).toBe(0); // consumed
    expect(hole.radius).toBeCloseTo(startRadius - BLACKHOLE_SHRINK_PER_BULLET, 9);
  });

  it('absorbs a bullet touching the body boundary (d == hole.radius + bullet.radius)', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const startRadius = hole.radius;
    const r = hole.radius + BULLET_RADIUS;
    const b = bulletPool.acquire();
    b.x = CENTER_X + r; // exactly on the boundary
    b.y = CENTER_Y;

    system.fixedUpdate(DT);
    expect(bulletPool.activeCount).toBe(0);
    expect(hole.radius).toBeLessThan(startRadius);
  });
});

describe('BlackHoleSystem — detonation at the unstable threshold (AC — detonation)', () => {
  // Wire a full real screen-clear + life-cost path: a BombSystem (reused screen
  // clear) + a shared playerState (the life cost) + a real CollisionSystem.
  function makeDetonable({ holeRadius, otherEnemies = [] } = {}) {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const playerState = createPlayerState();
    const ship = createPlayerShip();
    ship.x = 50; // parked far from the centered hole
    ship.y = 50;
    const { system } = makeSystem({
      ship,
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
      playerState,
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;
    const bombSystem = new BombSystem(
      new InputState(),
      [enemyPool],
      collision,
      scoreState,
      ship,
    );
    system.bombSystem = bombSystem;

    // The enemy whose absorption tips the hole over the threshold, dead-center.
    const hole = placeHole(system, CENTER_X, CENTER_Y, { radius: holeRadius });
    const tipEnemy = enemyPool.acquire();
    tipEnemy.x = CENTER_X;
    tipEnemy.y = CENTER_Y;
    // Other active enemies well outside the hole's gravity radius (not pulled/absorbed).
    const others = otherEnemies.map(([x, y]) => {
      const e = enemyPool.acquire();
      e.x = x;
      e.y = y;
      return e;
    });
    return { system, collision, bombSystem, scoreState, playerState, hole, enemyPool, tipEnemy, others };
  }

  it('crossing the threshold fires the screen clear, sets pendingDeath, releases the hole, pays NO score', () => {
    const ctx = makeDetonable({
      holeRadius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
      otherEnemies: [[80, 80], [ARENA_WIDTH - 80, ARENA_HEIGHT - 80]],
    });
    const { system, collision, scoreState, playerState, enemyPool, tipEnemy, others } = ctx;
    const scoreBefore = scoreState.score;

    collision.fixedUpdate(DT); // resets killedEnemies to []
    system.fixedUpdate(DT);

    // The absorbing enemy grew the hole to the threshold → detonation this tick.
    expect(system.holePool.activeCount).toBe(0); // hole released
    expect(playerState.pendingDeath).toBe(true); // life cost requested
    expect(scoreState.score).toBe(scoreBefore); // NO payout on detonation
    // The screen clear removed the OTHER active enemies (and the absorbed one).
    expect(enemyPool.activeCount).toBe(0);
    expect(collision.killedEnemies).toContain(tipEnemy);
    for (const e of others) expect(collision.killedEnemies).toContain(e);
  });

  it('two-pass safety: each cleared/absorbed enemy appears exactly ONCE in killedEnemies', () => {
    const ctx = makeDetonable({
      holeRadius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
      otherEnemies: [[80, 80], [ARENA_WIDTH - 80, ARENA_HEIGHT - 80]],
    });
    const { system, collision, tipEnemy, others } = ctx;

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    const killed = collision.killedEnemies;
    // Exactly three removals (1 absorbed + 2 cleared), no duplicates.
    expect(killed.length).toBe(3);
    expect(new Set(killed).size).toBe(3);
    expect(killed).toContain(tipEnemy);
    for (const e of others) expect(killed).toContain(e);
  });

  it('detonation with an UNSET bombSystem still costs the life + releases the hole (screen clear skipped)', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const playerState = createPlayerState();
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
      playerState,
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;
    expect(system.bombSystem).toBeNull();

    placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
    });
    const tip = enemyPool.acquire();
    tip.x = CENTER_X;
    tip.y = CENTER_Y;
    // Another enemy far away: with no bombSystem the screen clear cannot fire, so it survives.
    const survivor = enemyPool.acquire();
    survivor.x = 80;
    survivor.y = 80;

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(system.holePool.activeCount).toBe(0); // hole still released
    expect(playerState.pendingDeath).toBe(true); // life still requested
    expect(scoreState.score).toBe(0); // no payout
    // The absorbed enemy is gone but the distant one is NOT cleared (no bombSystem).
    expect(activeOf(enemyPool)).toContain(survivor);
    expect(collision.killedEnemies).toContain(tip);
    expect(collision.killedEnemies).not.toContain(survivor);
  });

  it('a released detonated hole no longer pulls on the next step', () => {
    const ctx = makeDetonable({
      holeRadius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
    });
    const { system, collision } = ctx;
    const ship = system.ship;
    collision.fixedUpdate(DT);
    system.fixedUpdate(DT); // detonates + releases

    ship.x = CENTER_X - 100;
    ship.y = CENTER_Y;
    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);
    expect(ship.x).toBe(CENTER_X - 100); // no active hole → no pull
  });

  it('end-to-end: a real detonation actually SPENDS a life through the real PlayerDeathSystem (shared playerState)', () => {
    const ctx = makeDetonable({
      holeRadius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
    });
    const { system, collision, playerState } = ctx;
    // The REAL death seam over the shared playerState (hole pool empties on
    // detonation → no contact death; the ONLY death is the forced pendingDeath).
    const ship = system.ship;
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);

    // One fixed tick in registration order: BlackHole detonates (sets pendingDeath),
    // then PlayerDeathSystem consumes it.
    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);
    expect(playerState.pendingDeath).toBe(true); // producer set it
    death.fixedUpdate(DT);

    // The life was actually spent with the NORMAL respawn flow, and the flag cleared.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(playerState.pendingDeath).toBe(false);
    expect(death.deathSeq).toBe(1);
  });

  it('end-to-end: a detonation on the LAST life ends the run through the real PlayerDeathSystem', () => {
    const ctx = makeDetonable({
      holeRadius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
    });
    const { system, collision, playerState } = ctx;
    playerState.lives = 1; // last life
    const death = new PlayerDeathSystem(system.ship, [system.holePool], playerState);

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
    expect(playerState.invulnMs).toBe(0); // no respawn invuln on the final death
    expect(playerState.pendingDeath).toBe(false);
  });
});

describe('BlackHoleSystem — safe implosion at the floor (AC — implosion)', () => {
  it('shrinking to the floor credits BLACKHOLE_SCORE, releases the hole, no screen clear, no life cost', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const playerState = createPlayerState();
    const ship = createPlayerShip();
    const { system } = makeSystem({
      ship,
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
      playerState,
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;
    const bombSystem = new BombSystem(
      new InputState(),
      [enemyPool],
      collision,
      scoreState,
      ship,
    );
    system.bombSystem = bombSystem;

    // One bullet-shrink away from the floor.
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_MIN_RADIUS + BLACKHOLE_SHRINK_PER_BULLET,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;
    // A distant active enemy to prove the screen clear did NOT fire on implosion.
    const survivor = enemyPool.acquire();
    survivor.x = 80;
    survivor.y = 80;

    collision.fixedUpdate(DT);
    const scoreBefore = scoreState.score;
    system.fixedUpdate(DT);

    expect(hole.radius).toBeLessThanOrEqual(BLACKHOLE_MIN_RADIUS);
    expect(system.holePool.activeCount).toBe(0); // hole released
    expect(scoreState.score).toBe(scoreBefore + BLACKHOLE_SCORE); // payout credited
    expect(playerState.pendingDeath).toBe(false); // NO life cost
    expect(activeOf(enemyPool)).toContain(survivor); // NO screen clear
    expect(bombSystem.shockwaveMs).toBe(0); // detonateAt was never called
  });

  it('many overlapping bullets in one tick never drive the radius negative and still safely implode', () => {
    const bulletPool = new Pool(createBullet);
    const scoreState = createScoreState();
    const playerState = createPlayerState();
    const { system } = makeSystem({ bulletPool, scoreState, playerState });

    // Start just above the floor, then far MORE overlapping bullets than the shrink
    // budget to the floor — without the zero clamp the radius would go negative.
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_MIN_RADIUS + BLACKHOLE_SHRINK_PER_BULLET,
    });
    for (let i = 0; i < 20; i++) {
      const b = bulletPool.acquire();
      b.x = CENTER_X; // dead center — overlaps at any shrinking radius
      b.y = CENTER_Y;
    }

    const scoreBefore = scoreState.score;
    system.fixedUpdate(DT);

    // The radius floored at 0 (never negative, never NaN)…
    expect(hole.radius).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(hole.radius)).toBe(false);
    // …and the hole still safely imploded (radius <= floor) for its payout, no life cost.
    expect(system.holePool.activeCount).toBe(0);
    expect(scoreState.score).toBe(scoreBefore + BLACKHOLE_SCORE);
    expect(playerState.pendingDeath).toBe(false);
    expect(bulletPool.activeCount).toBe(0); // all bullets absorbed
  });
});

describe('BlackHoleSystem — defuse report (defusedX/defusedY, Story 8.1)', () => {
  it('a safe implosion pushes the imploded hole coords into defusedX/defusedY', () => {
    const bulletPool = new Pool(createBullet);
    const scoreState = createScoreState();
    const { system } = makeSystem({ bulletPool, scoreState });
    // A distinctive off-center position so the reported coords are unambiguous.
    const HX = CENTER_X + 37;
    const HY = CENTER_Y - 19;
    const hole = placeHole(system, HX, HY, {
      radius: BLACKHOLE_MIN_RADIUS + BLACKHOLE_SHRINK_PER_BULLET,
    });
    const b = bulletPool.acquire();
    b.x = HX;
    b.y = HY;

    system.fixedUpdate(DT);

    // The hole safely imploded and its position was reported for the XP drop.
    expect(hole.radius).toBeLessThanOrEqual(BLACKHOLE_MIN_RADIUS);
    expect(system.holePool.activeCount).toBe(0);
    expect(system.defusedX).toEqual([HX]);
    expect(system.defusedY).toEqual([HY]);
  });

  it('a detonation leaves the defuse report empty (economy parity — a detonation pays no XP)', () => {
    const enemyPool = new Pool(createSeeker);
    const bulletPool = new Pool(createBullet);
    const scoreState = createScoreState();
    const playerState = createPlayerState();
    const ship = createPlayerShip();
    ship.x = 50; // parked far from the centered hole
    ship.y = 50;
    const { system } = makeSystem({
      ship,
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
      playerState,
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;
    // One absorb away from the unstable threshold → detonation this tick.
    placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_GROWTH_PER_ABSORB,
    });
    const tipEnemy = enemyPool.acquire();
    tipEnemy.x = CENTER_X;
    tipEnemy.y = CENTER_Y;

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    // Detonation (not implosion): the hole is gone but nothing was reported as defused.
    expect(system.holePool.activeCount).toBe(0);
    expect(playerState.pendingDeath).toBe(true);
    expect(system.defusedX).toEqual([]);
    expect(system.defusedY).toEqual([]);
  });

  it('resets the defuse report to empty each tick (a no-defuse tick reports nothing)', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    // Tick A: implode a hole → report populated.
    const HX = CENTER_X + 5;
    const HY = CENTER_Y + 7;
    placeHole(system, HX, HY, {
      radius: BLACKHOLE_MIN_RADIUS + BLACKHOLE_SHRINK_PER_BULLET,
    });
    const b = bulletPool.acquire();
    b.x = HX;
    b.y = HY;
    system.fixedUpdate(DT);
    expect(system.defusedX).toEqual([HX]);

    // Tick B: nothing implodes (no holes left) → the report resets to empty.
    system.fixedUpdate(DT);
    expect(system.defusedX).toEqual([]);
    expect(system.defusedY).toEqual([]);
  });
});

describe('BlackHoleSystem — instability level (maxInstability)', () => {
  it('is 0 with no active holes', () => {
    const { system } = makeSystem();
    system.fixedUpdate(DT);
    expect(system.maxInstability).toBe(0);
  });

  it('equals blackHoleInstability(radius) for a single active hole', () => {
    const { system } = makeSystem();
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      radius: (BLACKHOLE_RADIUS + BLACKHOLE_UNSTABLE_RADIUS) / 2,
    });
    system.fixedUpdate(DT);
    expect(system.maxInstability).toBeCloseTo(blackHoleInstability(hole.radius), 9);
    expect(system.maxInstability).toBeCloseTo(0.5, 9);
  });

  it('takes the MAX over multiple active non-telegraphing holes', () => {
    const { system } = makeSystem();
    placeHole(system, 200, 200, { radius: BLACKHOLE_RADIUS + 5 });
    const hot = placeHole(system, 600, 400, {
      radius: BLACKHOLE_UNSTABLE_RADIUS - 5,
    });
    system.fixedUpdate(DT);
    expect(system.maxInstability).toBeCloseTo(blackHoleInstability(hot.radius), 9);
  });

  it('excludes a telegraphing hole (not yet unstable)', () => {
    const { system } = makeSystem();
    placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_UNSTABLE_RADIUS - 5,
      telegraphMs: ENEMY_SPAWN_TELEGRAPH_MS,
    });
    system.fixedUpdate(DT);
    expect(system.maxInstability).toBe(0);
  });
});

describe('BlackHoleSystem — ship contact through the real PlayerDeathSystem (AC4)', () => {
  it('a non-invulnerable ship over an undestroyed hole triggers the death flow; the hole survives', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    const hole = placeHole(system, 300, 300);
    ship.x = 300;
    ship.y = 300;

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    // Ship contact never destroys the hole.
    expect(system.holePool.activeCount).toBe(1);
    expect(hole.radius).toBe(BLACKHOLE_RADIUS);
  });

  it('no death while invulnerable', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    placeHole(system, 300, 300);
    ship.x = 300;
    ship.y = 300;

    const playerState = createPlayerState();
    playerState.invulnMs = 500;
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
  });

  it('at most one death per step (a boundary touch counts as lethal)', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    const hole = placeHole(system, 300, 300);
    const r = SHIP_RADIUS + hole.radius;
    ship.x = 300 + r;
    ship.y = 300;

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
  });
});

describe('BlackHoleSystem — spawn telegraph (Story 2.6)', () => {
  it('freezes a telegraphing hole: no gravity, no absorb/grow/shrink/detonation/implosion; counts down by dt', () => {
    const bulletPool = new Pool(createBullet);
    const ship = createPlayerShip();
    const { system } = makeSystem({ bulletPool, ship });
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      telegraphMs: ENEMY_SPAWN_TELEGRAPH_MS,
    });
    ship.x = CENTER_X - 100;
    ship.y = CENTER_Y;
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    // No gravity (ship unmoved), no absorb/shrink (bullet alive, radius unchanged).
    expect(ship.x).toBe(CENTER_X - 100);
    expect(bulletPool.activeCount).toBe(1);
    expect(hole.radius).toBe(BLACKHOLE_RADIUS);
    // Only the telegraph advanced; excluded from the instability level.
    expect(hole.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
    expect(system.maxInstability).toBe(0);
  });

  it('a telegraphing hole overlapping the ship is non-lethal via the death seam', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    placeHole(system, 300, 300, { telegraphMs: ENEMY_SPAWN_TELEGRAPH_MS });
    ship.x = 300;
    ship.y = 300;

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
  });

  it('resumes gravity + becomes active on the tick the telegraph reaches 0', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    placeHole(system, CENTER_X, CENTER_Y, { telegraphMs: DT });
    ship.x = CENTER_X - 100;
    ship.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(ship.x).toBeGreaterThan(CENTER_X - 100); // pulled this same tick
  });

  it('an ACTIVE hole does not pull or absorb a telegraphing enemy — until it activates', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({ bulletPool, enemyPools: [enemyPool] });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;

    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const e = enemyPool.acquire();
    e.x = CENTER_X + 5;
    e.y = CENTER_Y;
    e.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;

    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(1); // not absorbed
    expect(hole.radius).toBe(BLACKHOLE_RADIUS); // no growth
    expect(collision.killedEnemies).not.toContain(e);
    expect(e.x).toBe(CENTER_X + 5); // gravity skipped it too

    // Activate it: now the same overlapping enemy is absorbed + grows the hole.
    e.telegraphMs = 0;
    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0);
    expect(hole.radius).toBeCloseTo(BLACKHOLE_RADIUS + BLACKHOLE_GROWTH_PER_ABSORB, 9);
    expect(collision.killedEnemies).toContain(e);
  });

  it('_spawnOne places the hole ≥ SPAWN_SAFE_RADIUS from the ship and telegraphing', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship, rng: seqRng([0.5, 0.5, 0.0, 0.0]) });
    system._spawnOne();
    const hole = activeOf(system.holePool)[0];
    const dx = hole.x - ship.x;
    const dy = hole.y - ship.y;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
    expect(hole.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(hole.radius).toBe(BLACKHOLE_RADIUS); // fresh, stable
  });
});

describe('BlackHoleSystem — self-spawn cadence + cap', () => {
  it('spawns one hole after a full interval and never exceeds BLACKHOLE_MAX_ACTIVE', () => {
    const { system } = makeSystem();
    const T = BLACKHOLE_SPAWN_INTERVAL_MS * 5;
    const ticks = Math.round(T / DT);
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(BLACKHOLE_MAX_ACTIVE);
  });

  it('does not spawn before one full interval has accumulated', () => {
    const { system } = makeSystem();
    const ticks = Math.floor(BLACKHOLE_SPAWN_INTERVAL_MS / DT) - 1;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(0);
  });

  it('spawns again once a hole safely implodes and the cap frees up', () => {
    const { system, scoreState } = makeSystem();
    const ticks = Math.round(BLACKHOLE_SPAWN_INTERVAL_MS / DT) + 2;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(BLACKHOLE_MAX_ACTIVE);

    // Defuse the one hole: activate it (self-spawned holes start telegraphing) and
    // drop its radius to the floor so the next tick implodes it.
    const hole = activeOf(system.holePool)[0];
    hole.telegraphMs = 0;
    hole.radius = BLACKHOLE_MIN_RADIUS;
    const scoreBefore = scoreState.score;
    system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(0);
    expect(scoreState.score).toBe(scoreBefore + BLACKHOLE_SCORE); // implosion payout

    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(BLACKHOLE_MAX_ACTIVE);
  });

  it('interior spawn placement keeps the body fully inside the border', () => {
    const { system } = makeSystem({ rng: seqRng([0.5, 0.5]) });
    system._spawnOne();
    const hole = activeOf(system.holePool)[0];
    expect(hole.x).toBeGreaterThanOrEqual(ARENA_BORDER_INSET + BLACKHOLE_RADIUS);
    expect(hole.x).toBeLessThanOrEqual(
      ARENA_WIDTH - ARENA_BORDER_INSET - BLACKHOLE_RADIUS,
    );
    expect(hole.y).toBeGreaterThanOrEqual(ARENA_BORDER_INSET + BLACKHOLE_RADIUS);
    expect(hole.y).toBeLessThanOrEqual(
      ARENA_HEIGHT - ARENA_BORDER_INSET - BLACKHOLE_RADIUS,
    );
    expect(hole.radius).toBe(BLACKHOLE_RADIUS);
  });
});

describe('BlackHoleSystem — pool prewarm / no per-frame growth (NFR2)', () => {
  it('prewarms the hole pool', () => {
    const { system } = makeSystem();
    expect(system.holePool.freeCount).toBe(BLACKHOLE_POOL_PREWARM);
    expect(system.holePool.activeCount).toBe(0);
  });

  it('does not grow the pool over many steady-state gravity/absorb steps', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [enemyPool],
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;
    placeHole(system, CENTER_X, CENTER_Y);

    // Persistent (non-absorbed) bullet/enemy out of the body so the gravity path
    // runs every tick without draining everything (kept beyond the body radius).
    const b = bulletPool.acquire();
    b.x = CENTER_X - 300;
    b.y = CENTER_Y;
    const e = enemyPool.acquire();
    e.x = CENTER_X + 300;
    e.y = CENTER_Y - 200;

    for (let i = 0; i < 200; i++) {
      collision.fixedUpdate(DT);
      system.fixedUpdate(DT);
    }
    // The hole pool never grew beyond prewarm.
    expect(system.holePool.activeCount + system.holePool.freeCount).toBe(
      BLACKHOLE_POOL_PREWARM,
    );
  });
});
