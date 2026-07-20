import { describe, it, expect } from 'vitest';
import { BlackHoleSystem } from './BlackHoleSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { SnakeSystem } from './SnakeSystem.js';
import { Pool } from '../core/Pool.js';
import { createBlackHole } from '../entities/BlackHole.js';
import { createBullet } from '../entities/Bullet.js';
import { createSeeker } from '../entities/Seeker.js';
import { createPinwheel } from '../entities/Pinwheel.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  SHIP_RADIUS,
  SEEKER_RADIUS,
  BULLET_RADIUS,
  BLACKHOLE_RADIUS,
  BLACKHOLE_MAX_RADIUS,
  BLACKHOLE_GRAVITY_RADIUS,
  BLACKHOLE_GRAVITY_STRENGTH,
  BLACKHOLE_HP,
  BLACKHOLE_BULLET_DAMAGE,
  BLACKHOLE_GROWTH_PER_FEED,
  BLACKHOLE_FEED_PER_SPAWN,
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

// Build a system with real pools. The spawn pool (fed seekers) is separate from
// the enemy pools so tests can observe emission distinctly, unless a test wires
// them together on purpose.
function makeSystem({
  ship = createPlayerShip(),
  bulletPool = new Pool(createBullet),
  enemyPools = [new Pool(createSeeker)],
  spawnPool = new Pool(createSeeker),
  scoreState = createScoreState(),
  rng = seqRng([0.5, 0.5]),
} = {}) {
  const system = new BlackHoleSystem(
    ship,
    bulletPool,
    enemyPools,
    spawnPool,
    scoreState,
    rng,
  );
  return { system, ship, bulletPool, enemyPools, spawnPool, scoreState };
}

// Capture the active instances of a pool via the public API (no private-Set
// access). Returns them as an array in iteration order.
function activeOf(pool) {
  const out = [];
  pool.forEachActive((x) => out.push(x));
  return out;
}

// Place a live hole at (x,y) directly (bypassing random spawn), re-initialized to
// a fresh shape unless overridden. Returns the pooled hole instance.
function placeHole(system, x, y, over = {}) {
  const h = system.holePool.acquire();
  h.x = x;
  h.y = y;
  h.radius = over.radius ?? BLACKHOLE_RADIUS;
  h.hp = over.hp ?? BLACKHOLE_HP;
  h.feed = over.feed ?? 0;
  return h;
}

describe('createBlackHole factory', () => {
  it('returns the starting {x,y,radius,hp,feed} shape (stationary — no velocity)', () => {
    const h = createBlackHole();
    expect(h.x).toBe(0);
    expect(h.y).toBe(0);
    expect(h.radius).toBe(BLACKHOLE_RADIUS);
    expect(h.hp).toBe(BLACKHOLE_HP);
    expect(h.feed).toBe(0);
    expect(h.telegraphMs).toBe(0); // spawned-and-active default (Story 2.6)
    expect('vx' in h).toBe(false);
    expect('vy' in h).toBe(false);
  });
});

describe('BlackHoleSystem — hoisted collector stability (NFR2)', () => {
  it('reuses the same hole + bullet collector references across ticks', () => {
    // Collectors are stable constructor instance fields, not fresh per-tick
    // closures — so forEachActive allocates no arrow per tick.
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
    // Ship a known distance d to the −x side, inside the gravity radius.
    const d = 100;
    ship.x = CENTER_X - d;
    ship.y = CENTER_Y;

    system.fixedUpdate(DT);

    const pull =
      BLACKHOLE_GRAVITY_STRENGTH * (1 - d / BLACKHOLE_GRAVITY_RADIUS) * DT_SEC;
    // Displacement is purely +x (dy = 0), magnitude = pull.
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

    // Both moved toward the hole center (bullet from −x moves +x; enemy from +x moves −x).
    expect(b.x).toBeGreaterThan(CENTER_X - 80);
    expect(e.x).toBeLessThan(CENTER_X + 120);
    expect(b.y).toBeCloseTo(CENTER_Y, 9);
    expect(e.y).toBeCloseTo(CENTER_Y, 9);
  });

  it('does not move an entity at or beyond the gravity radius', () => {
    const { system, ship } = makeSystem();
    placeHole(system, CENTER_X, CENTER_Y);
    // Exactly at the radius (guard is d < R, so == R is unaffected).
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
      return ship.x - (CENTER_X - d); // +x displacement magnitude
    }
    const small = stepOnce(DT);
    const big = stepOnce(2 * DT);
    expect(big).toBeCloseTo(2 * small, 9);
  });
});

describe('BlackHoleSystem — telegraphing enemies are inert to the hole (Story 2.6)', () => {
  it('an ACTIVE hole does not pull a telegraphing enemy in its gravity radius, but pulls an active one', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({ bulletPool, enemyPools: [enemyPool] });
    placeHole(system, CENTER_X, CENTER_Y); // active hole (telegraphMs 0)

    const telegraphing = enemyPool.acquire();
    telegraphing.x = CENTER_X - 100; // inside gravity radius
    telegraphing.y = CENTER_Y;
    telegraphing.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
    const active = enemyPool.acquire();
    active.x = CENTER_X + 120; // inside gravity radius
    active.y = CENTER_Y;
    active.telegraphMs = 0;

    system.fixedUpdate(DT);

    // Frozen enemy is not dragged (position unchanged); active enemy is pulled in.
    expect(telegraphing.x).toBe(CENTER_X - 100);
    expect(telegraphing.y).toBe(CENTER_Y);
    expect(active.x).toBeLessThan(CENTER_X + 120);
  });

  it('an ACTIVE hole does not absorb a telegraphing enemy overlapping its body — until it activates', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({ bulletPool, enemyPools: [enemyPool] });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;

    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const e = enemyPool.acquire();
    e.x = CENTER_X + 5; // overlapping the body but not coincident (so a pull would move it)
    e.y = CENTER_Y;
    e.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS; // telegraphing

    collision.fixedUpdate(DT); // resets killedEnemies to []
    system.fixedUpdate(DT);

    // Not absorbed and not pulled while telegraphing — inert.
    expect(enemyPool.activeCount).toBe(1);
    expect(hole.feed).toBe(0);
    expect(hole.radius).toBe(BLACKHOLE_RADIUS);
    expect(collision.killedEnemies).not.toContain(e);
    expect(e.x).toBe(CENTER_X + 5); // gravity skipped it too

    // Activate it: now the same overlapping enemy is absorbed + fed.
    e.telegraphMs = 0;
    collision.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0); // absorbed
    expect(hole.feed).toBe(1);
    expect(collision.killedEnemies).toContain(e);
  });
});

describe('BlackHoleSystem — bullet feed + damage (AC2/AC3)', () => {
  it('absorbs an overlapping bullet: releases it, damages hp, feeds, grows the radius', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const startRadius = hole.radius;

    const b = bulletPool.acquire();
    b.x = CENTER_X; // dead center of the body — inside radius + bullet.radius
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(bulletPool.activeCount).toBe(0); // consumed
    expect(hole.hp).toBe(BLACKHOLE_HP - BLACKHOLE_BULLET_DAMAGE);
    expect(hole.feed).toBe(1);
    expect(hole.radius).toBeCloseTo(startRadius + BLACKHOLE_GROWTH_PER_FEED, 9);
  });

  it('absorbs a bullet touching the body boundary (d == hole.radius + bullet.radius)', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const r = hole.radius + BULLET_RADIUS;
    const b = bulletPool.acquire();
    b.x = CENTER_X + r; // exactly on the boundary
    b.y = CENTER_Y;

    system.fixedUpdate(DT);
    // Boundary counts as an overlap: consumed. (Gravity nudged it inward first,
    // but even without that the ≤ test includes the boundary.)
    expect(bulletPool.activeCount).toBe(0);
    expect(hole.hp).toBe(BLACKHOLE_HP - BLACKHOLE_BULLET_DAMAGE);
  });
});

describe('BlackHoleSystem — enemy absorption via the real CollisionSystem seam (AC2)', () => {
  it('releases the enemy to its OWN pool, appends to killedEnemies, feeds, does NOT score', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
    });
    // Real collision + scoring seams over the same enemy pool.
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    const scoring = new ScoringSystem(collision, scoreState);
    system.collisionSystem = collision;

    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const e = enemyPool.acquire();
    e.x = CENTER_X; // inside the body
    e.y = CENTER_Y;

    // Mirror the real tick order: Collision → Scoring → BlackHole. (No bullets, so
    // the collision/scoring passes are no-ops that reset killedEnemies to [].)
    collision.fixedUpdate(DT);
    scoring.fixedUpdate(DT);
    const scoreBefore = scoreState.score;
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0); // released to its own pool
    expect(collision.killedEnemies).toContain(e); // reconciliation seam
    expect(hole.feed).toBe(1);
    // The absorbed enemy is NOT scored (BlackHoleSystem runs AFTER ScoringSystem).
    expect(scoreState.score).toBe(scoreBefore);
  });

  it('does NOT absorb enemies before the collision system is late-bound (guarded); gravity + bullet feed still run', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const { system } = makeSystem({ bulletPool, enemyPools: [enemyPool] });
    expect(system.collisionSystem).toBeNull();

    const hole = placeHole(system, CENTER_X, CENTER_Y);
    const e = enemyPool.acquire();
    e.x = CENTER_X + 5; // overlapping the body, but no collisionSystem
    e.y = CENTER_Y;
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    // Enemy not absorbed (still active), but gravity moved it and the bullet fed.
    expect(enemyPool.activeCount).toBe(1);
    expect(bulletPool.activeCount).toBe(0); // bullet still consumed
    expect(hole.hp).toBe(BLACKHOLE_HP - BLACKHOLE_BULLET_DAMAGE);
    expect(e.x).not.toBe(CENTER_X + 5); // gravity nudged it
  });

  it('routes an absorbed enemy to ITS OWN owning pool across multiple archetype pools', () => {
    const bulletPool = new Pool(createBullet);
    const seekerPool = new Pool(createSeeker);
    const pinwheelPool = new Pool(createPinwheel);
    // The hole spans BOTH pools; only the pinwheel (second pool) overlaps the body.
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [seekerPool, pinwheelPool],
    });
    const collision = new CollisionSystem(bulletPool, [seekerPool, pinwheelPool]);
    system.collisionSystem = collision;

    placeHole(system, CENTER_X, CENTER_Y);
    const pw = pinwheelPool.acquire();
    pw.x = CENTER_X; // inside the body
    pw.y = CENTER_Y;

    collision.fixedUpdate(DT); // resets killedEnemies to []
    system.fixedUpdate(DT);

    // Released to its OWN (pinwheel) pool; the seeker pool is untouched.
    expect(pinwheelPool.activeCount).toBe(0);
    expect(pinwheelPool.freeCount).toBe(1);
    expect(seekerPool.activeCount).toBe(0);
    expect(seekerPool.freeCount).toBe(0);
    // Present in the real reconciliation report.
    expect(collision.killedEnemies).toContain(pw);
  });

  it('a real snake reconciles an absorbed mid-chain segment (split via killedEnemies)', () => {
    const bulletPool = new Pool(createBullet);
    // Deterministic snake (indifferent to the player — takes only an rng).
    const snakeSystem = new SnakeSystem(seqRng([0.1, 0.5]));
    const segPool = snakeSystem.enemyPool;
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [segPool],
    });
    // Real collision seam over the segment pool, late-bound into BOTH systems.
    const collision = new CollisionSystem(bulletPool, [segPool]);
    system.collisionSystem = collision;
    snakeSystem.collisionSystem = collision;

    // Hand-place a straight 5-segment snake (head +x) using real pooled instances.
    const hx = 400;
    const hy = 400;
    const segments = [];
    for (let i = 0; i < 5; i++) {
      const seg = segPool.acquire();
      // Wide gaps so a single-tick gravity nudge can't pull a NEIGHBOR into the
      // body — only the exactly-overlapping mid-chain segment is absorbed.
      seg.x = hx - i * 80;
      seg.y = hy;
      seg.vx = 0;
      seg.vy = 0;
      segments.push(seg);
    }
    snakeSystem.snakes.push({ segments, headingRad: 0, slitherPhaseRad: 0 });
    const target = segments[2]; // a mid-chain segment

    // Hole overlaps ONLY the mid-chain segment.
    placeHole(system, target.x, target.y);

    collision.fixedUpdate(DT); // resets killedEnemies to []
    system.fixedUpdate(DT); // absorbs the segment → release + push to killedEnemies

    // The segment was released to the segment pool and reported killed.
    expect(collision.killedEnemies).toContain(target);
    expect(segPool.activeCount).toBe(4);

    // Snake reconciles on its next tick: the absorbed segment is gone from every
    // chain and the snake split into two independent snakes at the gap.
    snakeSystem.fixedUpdate(DT);
    for (const sk of snakeSystem.snakes) {
      expect(sk.segments).not.toContain(target);
    }
    expect(snakeSystem.snakes.length).toBe(2);
    // Pool state consistent: exactly the four survivors active, no double-release.
    expect(segPool.activeCount).toBe(4);
    const stillActive = activeOf(segPool);
    expect(stillActive).not.toContain(target);
    const totalInChains = snakeSystem.snakes.reduce(
      (n, sk) => n + sk.segments.length,
      0,
    );
    expect(totalInChains).toBe(4);
  });
});

describe('BlackHoleSystem — growth cap', () => {
  it('clamps the radius at BLACKHOLE_MAX_RADIUS when fed while already maxed', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_MAX_RADIUS,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(hole.radius).toBe(BLACKHOLE_MAX_RADIUS); // stayed clamped
    expect(hole.feed).toBe(1); // still fed/damaged
  });

  it('never exceeds the cap as the last growth step crosses it', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    // One growth step below the cap so the next feed would overshoot without a clamp.
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      radius: BLACKHOLE_MAX_RADIUS - BLACKHOLE_GROWTH_PER_FEED / 2,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);
    expect(hole.radius).toBe(BLACKHOLE_MAX_RADIUS);
  });
});

describe('BlackHoleSystem — feed → enemy spawn (AC2)', () => {
  it('emits one seeker at a random arena edge when feed reaches BLACKHOLE_FEED_PER_SPAWN', () => {
    const bulletPool = new Pool(createBullet);
    const spawnPool = new Pool(createSeeker);
    // rng feeds the edge-spawn: edge index (0=top) then position along it.
    const { system } = makeSystem({
      bulletPool,
      spawnPool,
      rng: seqRng([0.0, 0.5]),
    });
    // One feed short of the spawn threshold; the single bullet this tick trips it.
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      feed: BLACKHOLE_FEED_PER_SPAWN - 1,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    expect(spawnPool.activeCount).toBe(0);
    system.fixedUpdate(DT);

    expect(spawnPool.activeCount).toBe(1); // one seeker emitted
    expect(hole.feed).toBe(0); // BLACKHOLE_FEED_PER_SPAWN subtracted
    // Placed on the top edge (edge 0): y pinned just inside the inset by the radius.
    const minY = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const spawned = activeOf(system.spawnPool)[0];
    expect(spawned.y).toBe(minY);
  });
});

describe('BlackHoleSystem — detonation (AC3)', () => {
  it('credits BLACKHOLE_SCORE and releases the hole when hp reaches zero', () => {
    const bulletPool = new Pool(createBullet);
    const scoreState = createScoreState();
    const { system } = makeSystem({ bulletPool, scoreState });
    // hp exactly one bullet from death.
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      hp: BLACKHOLE_BULLET_DAMAGE,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(hole.hp).toBeLessThanOrEqual(0);
    expect(scoreState.score).toBe(BLACKHOLE_SCORE); // payout credited directly
    expect(system.holePool.activeCount).toBe(0); // hole removed
  });

  it('the killing tick stops absorbing/feeding: no growth, no phantom seeker, extra bullets pass through', () => {
    const bulletPool = new Pool(createBullet);
    const enemyPool = new Pool(createSeeker);
    const spawnPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [enemyPool],
      spawnPool,
      scoreState,
    });
    // A real collision stub so enemy absorption is enabled (it must NOT run on the
    // death tick either). rng would emit at an edge if a phantom feed occurred.
    system.collisionSystem = { killedEnemies: [] };

    // One hit from death, and already one feed short of the spawn threshold — so a
    // (wrongly) counted killing feed would both grow AND emit a phantom seeker.
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      hp: BLACKHOLE_BULLET_DAMAGE,
      feed: BLACKHOLE_FEED_PER_SPAWN - 1,
    });
    const radiusBefore = hole.radius;
    expect(radiusBefore).toBe(BLACKHOLE_RADIUS);

    // Three bullets all overlapping the body; only the first (killing) one is eaten.
    for (let i = 0; i < 3; i++) {
      const b = bulletPool.acquire();
      b.x = CENTER_X;
      b.y = CENTER_Y;
    }

    system.fixedUpdate(DT);

    expect(system.holePool.activeCount).toBe(0); // detonated + released
    expect(scoreState.score).toBe(BLACKHOLE_SCORE); // payout
    expect(spawnPool.activeCount).toBe(0); // NO phantom seeker
    expect(hole.radius).toBe(radiusBefore); // never grew on the death tick
    expect(bulletPool.activeCount).toBe(2); // only the killing bullet consumed
  });

  it('a destroyed hole no longer pulls or is lethal on the next step', () => {
    const bulletPool = new Pool(createBullet);
    const ship = createPlayerShip();
    const { system } = makeSystem({ bulletPool, ship });
    placeHole(system, CENTER_X, CENTER_Y, { hp: BLACKHOLE_BULLET_DAMAGE });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;
    system.fixedUpdate(DT); // detonates

    // Next step: an entity that would have been pulled is not moved (no active hole).
    ship.x = CENTER_X - 100;
    ship.y = CENTER_Y;
    system.fixedUpdate(DT);
    expect(ship.x).toBe(CENTER_X - 100);
  });
});

describe('BlackHoleSystem — ship contact through the real PlayerDeathSystem (AC3)', () => {
  it('a non-invulnerable ship over an undestroyed hole triggers the death flow; the hole survives', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    const hole = placeHole(system, 300, 300);
    ship.x = 300;
    ship.y = 300;

    // The death seam over ONLY the hole pool (the scene builds [...enemyPools, holePool]).
    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS); // respawn invuln granted
    expect(ship.x).toBe(CENTER_X); // respawned to center
    expect(ship.y).toBe(CENTER_Y);
    // Ship contact never destroys the hole.
    expect(system.holePool.activeCount).toBe(1);
    expect(hole.hp).toBe(BLACKHOLE_HP);
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

    expect(playerState.lives).toBe(PLAYER_START_LIVES); // no life lost
    expect(playerState.gameOver).toBe(false);
  });

  it('at most one death per step (a boundary touch counts as lethal)', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    const hole = placeHole(system, 300, 300);
    const r = SHIP_RADIUS + hole.radius;
    ship.x = 300 + r; // exactly on the contact boundary
    ship.y = 300;

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
  });
});

describe('BlackHoleSystem — spawn telegraph (Story 2.6)', () => {
  it('freezes a telegraphing hole: no gravity, no absorb/feed/grow/detonation; counts down by dt (AC1)', () => {
    const bulletPool = new Pool(createBullet);
    const ship = createPlayerShip();
    const { system } = makeSystem({ bulletPool, ship });
    const hole = placeHole(system, CENTER_X, CENTER_Y);
    hole.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
    // Ship within the gravity radius, a bullet dead-center (would be absorbed).
    ship.x = CENTER_X - 100;
    ship.y = CENTER_Y;
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;
    const startHp = hole.hp;

    system.fixedUpdate(DT);

    // No gravity (ship unmoved), no absorb/feed (bullet alive, hp/radius/feed unchanged).
    expect(ship.x).toBe(CENTER_X - 100);
    expect(bulletPool.activeCount).toBe(1);
    expect(hole.hp).toBe(startHp);
    expect(hole.radius).toBe(BLACKHOLE_RADIUS);
    expect(hole.feed).toBe(0);
    // Only the telegraph advanced.
    expect(hole.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
  });

  it('a telegraphing hole overlapping the ship is non-lethal via the death seam (AC1)', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    const hole = placeHole(system, 300, 300);
    hole.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
    ship.x = 300;
    ship.y = 300; // overlapping

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [system.holePool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES); // no death while telegraphing
    expect(playerState.gameOver).toBe(false);
  });

  it('resumes gravity + becomes active on the tick the telegraph reaches 0 (AC2)', () => {
    const ship = createPlayerShip();
    const { system } = makeSystem({ ship });
    const hole = placeHole(system, CENTER_X, CENTER_Y);
    hole.telegraphMs = DT; // one step from activation
    ship.x = CENTER_X - 100;
    ship.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(hole.telegraphMs).toBe(0);
    // Gravity resumed this same tick — the ship was pulled toward the hole (+x).
    expect(ship.x).toBeGreaterThan(CENTER_X - 100);
  });

  it('a fed seeker is emitted telegraphing AND placed ≥ SPAWN_SAFE_RADIUS from the ship (AC3)', () => {
    const bulletPool = new Pool(createBullet);
    const spawnPool = new Pool(createSeeker);
    const ship = createPlayerShip(); // center
    const { system } = makeSystem({
      bulletPool,
      spawnPool,
      ship,
      rng: seqRng([0.0, 0.5]), // top edge, far from a centered ship → accepted
    });
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      feed: BLACKHOLE_FEED_PER_SPAWN - 1,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(spawnPool.activeCount).toBe(1);
    expect(hole.feed).toBe(0);
    const spawned = activeOf(spawnPool)[0];
    // Fed seeker telegraphs (frozen + non-lethal until it activates).
    expect(spawned.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    // And it is kept away from the ship.
    const dx = spawned.x - ship.x;
    const dy = spawned.y - ship.y;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
  });

  it('a fed seeker RE-ROLLS away from a ship sitting on the first edge candidate (AC3)', () => {
    // Pin the ship ON the first edge candidate (top-center, edge 0 / t=0.5) so the
    // avoidance MUST re-roll — this fails if `_spawnSeekerAtEdge` drops `this.ship`.
    const bulletPool = new Pool(createBullet);
    const spawnPool = new Pool(createSeeker);
    const ship = createPlayerShip();
    ship.x = ARENA_WIDTH / 2; // == first edge candidate x
    ship.y = ARENA_BORDER_INSET + SEEKER_RADIUS; // == first edge candidate y (top)
    const { system } = makeSystem({
      bulletPool,
      spawnPool,
      ship,
      // edge 0 / t=0.5 (on the ship → too close) → re-roll → edge 1 / t=0.5 (far).
      rng: seqRng([0.0, 0.5, 0.25, 0.5]),
    });
    const hole = placeHole(system, CENTER_X, CENTER_Y, {
      feed: BLACKHOLE_FEED_PER_SPAWN - 1,
    });
    const b = bulletPool.acquire();
    b.x = CENTER_X;
    b.y = CENTER_Y;

    system.fixedUpdate(DT);

    expect(spawnPool.activeCount).toBe(1);
    expect(hole.feed).toBe(0);
    const spawned = activeOf(spawnPool)[0];
    // Re-rolled clear of the ship (would be ~0 away if avoidance were disabled).
    const dx = spawned.x - ship.x;
    const dy = spawned.y - ship.y;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
    expect(spawned.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
  });

  it('_spawnOne places the hole ≥ SPAWN_SAFE_RADIUS from the ship and telegraphing (AC3)', () => {
    const ship = createPlayerShip(); // center — the first interior roll lands on it
    // First interior roll (0.5,0.5) == center (on ship) → re-roll to a corner.
    const { system } = makeSystem({ ship, rng: seqRng([0.5, 0.5, 0.0, 0.0]) });
    system._spawnOne();
    const hole = activeOf(system.holePool)[0];
    const dx = hole.x - ship.x;
    const dy = hole.y - ship.y;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
    expect(hole.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
  });
});

describe('BlackHoleSystem — self-spawn cadence + cap', () => {
  it('spawns one hole after a full interval and never exceeds BLACKHOLE_MAX_ACTIVE', () => {
    const { system } = makeSystem();
    // Run well past several intervals.
    const T = BLACKHOLE_SPAWN_INTERVAL_MS * 5;
    const ticks = Math.round(T / DT);
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    // The cap holds: no more than BLACKHOLE_MAX_ACTIVE holes despite the elapsed time.
    expect(system.holePool.activeCount).toBe(BLACKHOLE_MAX_ACTIVE);
  });

  it('does not spawn before one full interval has accumulated', () => {
    const { system } = makeSystem();
    const ticks = Math.floor(BLACKHOLE_SPAWN_INTERVAL_MS / DT) - 1;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(0);
  });

  it('spawns again once a hole is destroyed and the cap frees up', () => {
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem({ bulletPool });
    // Reach the cap. A small margin past the exact interval avoids a float-rounding
    // boundary (summed dt can land a hair under the threshold) while staying below
    // two intervals so the cap of one still holds.
    const ticks = Math.round(BLACKHOLE_SPAWN_INTERVAL_MS / DT) + 2;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(BLACKHOLE_MAX_ACTIVE);

    // Destroy the one hole: activate it past its spawn telegraph (Story 2.6 —
    // a self-spawned hole starts frozen + invulnerable), drop its hp, bullet on it.
    const hole = activeOf(system.holePool)[0];
    hole.telegraphMs = 0;
    hole.hp = BLACKHOLE_BULLET_DAMAGE;
    const b = bulletPool.acquire();
    b.x = hole.x;
    b.y = hole.y;
    system.fixedUpdate(DT);
    expect(system.holePool.activeCount).toBe(0);

    // After another full interval a fresh hole spawns.
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
    // Re-initialized to a fresh shape.
    expect(hole.hp).toBe(BLACKHOLE_HP);
    expect(hole.radius).toBe(BLACKHOLE_RADIUS);
    expect(hole.feed).toBe(0);
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
    const scoreState = createScoreState();
    const { system } = makeSystem({
      bulletPool,
      enemyPools: [enemyPool],
      scoreState,
    });
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    system.collisionSystem = collision;
    placeHole(system, CENTER_X, CENTER_Y);

    // Keep a couple of persistent (non-absorbed) bullets/enemies out of the body
    // so the gravity path runs every tick without draining everything.
    const b = bulletPool.acquire();
    b.x = CENTER_X - 200;
    b.y = CENTER_Y;
    const e = enemyPool.acquire();
    e.x = CENTER_X + 200;
    e.y = CENTER_Y - 150;

    for (let i = 0; i < 500; i++) {
      collision.fixedUpdate(DT);
      system.fixedUpdate(DT);
    }
    // The hole pool never grew beyond prewarm (+ at most the cap of active holes).
    expect(system.holePool.activeCount + system.holePool.freeCount).toBe(
      BLACKHOLE_POOL_PREWARM,
    );
  });
});
