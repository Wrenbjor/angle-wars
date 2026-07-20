import { describe, it, expect } from 'vitest';
import { BombSystem } from './BombSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { SnakeSystem } from './SnakeSystem.js';
import { Pool } from '../core/Pool.js';
import { InputState } from '../input/InputState.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createPinwheel } from '../entities/Pinwheel.js';
import { createBullet } from '../entities/Bullet.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import {
  FIXED_STEP_MS,
  BOMB_START_COUNT,
  BOMB_AWARD_SCORE_INTERVAL,
  BOMB_SHOCKWAVE_MS,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SCORE_MULTIPLIER_START,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Deterministic rng that cycles a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Capture the active instances of a pool via the public API. Returns an array.
function activeOf(pool) {
  const out = [];
  pool.forEachActive((x) => out.push(x));
  return out;
}

// Build a BombSystem over real pools with a lightweight collision stub (only its
// killedEnemies array is read by the BombSystem). Tests that need the real
// Collision/Scoring seams wire them explicitly.
function makeSystem({
  inputState = new InputState(),
  enemyPools = [new Pool(createSeeker)],
  collisionSystem = { killedEnemies: [] },
  scoreState = createScoreState(),
  ship = createPlayerShip(),
} = {}) {
  const system = new BombSystem(
    inputState,
    enemyPools,
    collisionSystem,
    scoreState,
    ship,
  );
  return { system, inputState, enemyPools, collisionSystem, scoreState, ship };
}

describe('createScoreState — bombs field (Story 3.2 / FR9)', () => {
  it('a fresh run starts with BOMB_START_COUNT bombs', () => {
    const ss = createScoreState();
    expect(ss.bombs).toBe(BOMB_START_COUNT);
    expect(BOMB_START_COUNT).toBe(3);
  });
});

describe('BombSystem — detonation clears active enemies (unscored)', () => {
  it('releases every active enemy across all pools, appends to killedEnemies, and decrements bombs by one', () => {
    const seekerPool = new Pool(createSeeker);
    const greenPool = new Pool(createGreenSquare);
    const pinwheelPool = new Pool(createPinwheel);
    const collision = { killedEnemies: [] };
    const inputState = new InputState();
    const { system, scoreState } = makeSystem({
      inputState,
      enemyPools: [seekerPool, greenPool, pinwheelPool],
      collisionSystem: collision,
    });

    // Three enemies across three archetype pools.
    const s = seekerPool.acquire();
    const g = greenPool.acquire();
    const p = pinwheelPool.acquire();

    const bombsBefore = scoreState.bombs;
    inputState.queueBomb();
    system.fixedUpdate(DT);

    // Every active enemy released to ITS OWN pool.
    expect(seekerPool.activeCount).toBe(0);
    expect(greenPool.activeCount).toBe(0);
    expect(pinwheelPool.activeCount).toBe(0);
    // All appended to the reconciliation seam.
    expect(collision.killedEnemies).toContain(s);
    expect(collision.killedEnemies).toContain(g);
    expect(collision.killedEnemies).toContain(p);
    expect(collision.killedEnemies.length).toBe(3);
    // Bomb count dropped by exactly one.
    expect(scoreState.bombs).toBe(bombsBefore - 1);
  });

  it('does NOT score or advance the multiplier for bomb-cleared kills (runs after ScoringSystem)', () => {
    const enemyPool = new Pool(createSeeker);
    const bulletPool = new Pool(createBullet);
    const scoreState = createScoreState();
    const inputState = new InputState();
    // Real Collision → Scoring → Bomb seams over the same pool (the true tick order).
    const collision = new CollisionSystem(bulletPool, [enemyPool]);
    const scoring = new ScoringSystem(collision, scoreState);
    const { system } = makeSystem({
      inputState,
      enemyPools: [enemyPool],
      collisionSystem: collision,
      scoreState,
    });

    // Two active enemies, no bullets — collision/scoring are no-ops that reset
    // killedEnemies to [].
    enemyPool.acquire();
    enemyPool.acquire();

    const scoreBefore = scoreState.score;
    const multBefore = scoreState.multiplier;
    const killsBefore = scoreState.multiplierKills;

    inputState.queueBomb();
    // Mirror the real tick order.
    collision.fixedUpdate(DT);
    scoring.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0); // cleared
    expect(collision.killedEnemies.length).toBe(2); // reported for reconciliation
    // Unscored: nothing credited, multiplier + progress untouched.
    expect(scoreState.score).toBe(scoreBefore);
    expect(scoreState.multiplier).toBe(multBefore);
    expect(scoreState.multiplierKills).toBe(killsBefore);
    expect(multBefore).toBe(SCORE_MULTIPLIER_START);
  });

  it('arms the placeholder shockwave at the ship position on detonation', () => {
    const inputState = new InputState();
    const ship = createPlayerShip();
    ship.x = 321;
    ship.y = 654;
    const { system } = makeSystem({ inputState, ship });

    inputState.queueBomb();
    system.fixedUpdate(DT);

    // Countdown set (already decayed by one dt this tick) at the ship position.
    expect(system.shockwaveMs).toBeCloseTo(BOMB_SHOCKWAVE_MS - DT, 9);
    expect(system.shockwaveX).toBe(321);
    expect(system.shockwaveY).toBe(654);
  });

  it('clears a telegraphing (still-frozen) enemy too — regardless of spawn-in state', () => {
    const enemyPool = new Pool(createSeeker);
    const collision = { killedEnemies: [] };
    const inputState = new InputState();
    const { system } = makeSystem({
      inputState,
      enemyPools: [enemyPool],
      collisionSystem: collision,
    });
    const telegraphing = enemyPool.acquire();
    telegraphing.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS; // fresh, still frozen

    inputState.queueBomb();
    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0); // cleared despite telegraphing
    expect(collision.killedEnemies).toContain(telegraphing);
  });
});

describe('BombSystem — detonateAt(x,y) reuse seam (Story 6.2)', () => {
  it('clears every active enemy + arms the shockwave at (x,y) WITHOUT decrementing bombs or consuming the latch', () => {
    const seekerPool = new Pool(createSeeker);
    const greenPool = new Pool(createGreenSquare);
    const pinwheelPool = new Pool(createPinwheel);
    const collision = { killedEnemies: [] };
    const inputState = new InputState();
    const { system, scoreState } = makeSystem({
      inputState,
      enemyPools: [seekerPool, greenPool, pinwheelPool],
      collisionSystem: collision,
    });
    const s = seekerPool.acquire();
    const g = greenPool.acquire();
    const p = pinwheelPool.acquire();

    const bombsBefore = scoreState.bombs;
    // A latched bomb request must survive — detonateAt is the shared clear, NOT the
    // player press path (the black hole must not steal or spend the player's bomb).
    inputState.queueBomb();

    system.detonateAt(111, 222);

    // Every active enemy released to its own pool + appended to the reconciliation seam.
    expect(seekerPool.activeCount).toBe(0);
    expect(greenPool.activeCount).toBe(0);
    expect(pinwheelPool.activeCount).toBe(0);
    expect(collision.killedEnemies).toContain(s);
    expect(collision.killedEnemies).toContain(g);
    expect(collision.killedEnemies).toContain(p);
    expect(collision.killedEnemies.length).toBe(3);
    // Shockwave armed at the GIVEN origin (not the ship), at full duration (detonateAt
    // does not run the per-tick decay).
    expect(system.shockwaveMs).toBe(BOMB_SHOCKWAVE_MS);
    expect(system.shockwaveX).toBe(111);
    expect(system.shockwaveY).toBe(222);
    // No bomb spent, latch NOT consumed.
    expect(scoreState.bombs).toBe(bombsBefore);
    expect(inputState.bombQueued).toBe(true);
  });

  it('the player fixedUpdate path routes through detonateAt then spends exactly one bomb at the ship', () => {
    const enemyPool = new Pool(createSeeker);
    const collision = { killedEnemies: [] };
    const inputState = new InputState();
    const ship = createPlayerShip();
    ship.x = 42;
    ship.y = 84;
    const { system, scoreState } = makeSystem({
      inputState,
      enemyPools: [enemyPool],
      collisionSystem: collision,
      ship,
    });
    enemyPool.acquire();
    const bombsBefore = scoreState.bombs;

    inputState.queueBomb();
    system.fixedUpdate(DT);

    // The shared clear ran (enemy cleared, shockwave at the SHIP)…
    expect(enemyPool.activeCount).toBe(0);
    expect(system.shockwaveX).toBe(42);
    expect(system.shockwaveY).toBe(84);
    // …and the player path spent exactly one bomb (unlike detonateAt alone).
    expect(scoreState.bombs).toBe(bombsBefore - 1);
    expect(inputState.bombQueued).toBe(false); // player press consumes the latch
  });
});

describe('BombSystem — no-op cases', () => {
  it('a press with 0 bombs consumes the latch, destroys nothing, fires no shockwave', () => {
    const enemyPool = new Pool(createSeeker);
    const collision = { killedEnemies: [] };
    const scoreState = createScoreState();
    scoreState.bombs = 0;
    const inputState = new InputState();
    const { system } = makeSystem({
      inputState,
      enemyPools: [enemyPool],
      collisionSystem: collision,
      scoreState,
    });
    enemyPool.acquire();

    inputState.queueBomb();
    system.fixedUpdate(DT);

    expect(inputState.bombQueued).toBe(false); // latch consumed
    expect(enemyPool.activeCount).toBe(1); // nothing destroyed
    expect(collision.killedEnemies.length).toBe(0);
    expect(scoreState.bombs).toBe(0); // stays 0
    expect(system.shockwaveMs).toBe(0); // no shockwave
  });

  it('a press with bombs but an empty arena decrements bombs and fires the shockwave', () => {
    const enemyPool = new Pool(createSeeker);
    const scoreState = createScoreState();
    const inputState = new InputState();
    const { system } = makeSystem({
      inputState,
      enemyPools: [enemyPool],
      scoreState,
    });

    const bombsBefore = scoreState.bombs;
    inputState.queueBomb();
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore - 1);
    expect(system.shockwaveMs).toBeGreaterThan(0); // shockwave fired
  });

  it('no press this tick: no detonation, bombs unchanged, a running shockwave keeps decaying', () => {
    const inputState = new InputState();
    const scoreState = createScoreState();
    const { system } = makeSystem({ inputState, scoreState });

    // Fire a shockwave first.
    inputState.queueBomb();
    system.fixedUpdate(DT);
    const bombsAfterFire = scoreState.bombs;
    const swAfterFire = system.shockwaveMs;

    // Next tick, no press.
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsAfterFire); // unchanged
    expect(system.shockwaveMs).toBeCloseTo(swAfterFire - DT, 9); // kept decaying
  });

  it('the shockwave countdown decays to exactly 0 and clamps (never negative)', () => {
    const inputState = new InputState();
    const { system } = makeSystem({ inputState });
    inputState.queueBomb();
    system.fixedUpdate(DT);
    // Run enough ticks to exhaust the countdown.
    const ticks = Math.ceil(BOMB_SHOCKWAVE_MS / DT) + 2;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.shockwaveMs).toBe(0);
  });
});

describe('BombSystem — latch is single-shot', () => {
  it('multiple queueBomb calls before one tick cause at most ONE detonation', () => {
    const scoreState = createScoreState();
    const inputState = new InputState();
    const { system } = makeSystem({ inputState, scoreState });

    const bombsBefore = scoreState.bombs;
    // Several key edges within one fixed-step window.
    inputState.queueBomb();
    inputState.queueBomb();
    inputState.queueBomb();
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore - 1); // exactly one detonation
  });

  it('a consumed latch does not re-fire on the next tick', () => {
    const scoreState = createScoreState();
    const inputState = new InputState();
    const { system } = makeSystem({ inputState, scoreState });

    inputState.queueBomb();
    system.fixedUpdate(DT);
    const afterFirst = scoreState.bombs;
    system.fixedUpdate(DT); // no new press
    expect(scoreState.bombs).toBe(afterFirst); // no second detonation
  });
});

describe('BombSystem — score-threshold award (+1 bomb per 100k)', () => {
  it('awards one bomb when the score crosses a single boundary', () => {
    const scoreState = createScoreState();
    scoreState.score = 99000;
    const { system } = makeSystem({ scoreState }); // cursor seeded at 99000
    const bombsBefore = scoreState.bombs;

    scoreState.score = 101000;
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore + 1);
    expect(system._scoreCursor).toBe(101000); // cursor advanced
  });

  it('awards one bomb per boundary when a single jump crosses several (100k/200k/300k)', () => {
    const scoreState = createScoreState();
    scoreState.score = 90000;
    const { system } = makeSystem({ scoreState });
    const bombsBefore = scoreState.bombs;

    scoreState.score = 320000; // crosses 100k, 200k, 300k
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore + 3);
    expect(system._scoreCursor).toBe(320000);
  });

  it('awards nothing for a score change that crosses no boundary', () => {
    const scoreState = createScoreState();
    scoreState.score = 101000;
    const { system } = makeSystem({ scoreState });
    const bombsBefore = scoreState.bombs;

    scoreState.score = 150000; // still within the [100k,200k) band
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore);
    expect(system._scoreCursor).toBe(150000);
  });

  it('landing exactly ON a boundary awards it', () => {
    const scoreState = createScoreState();
    scoreState.score = 50000;
    const { system } = makeSystem({ scoreState });
    const bombsBefore = scoreState.bombs;

    scoreState.score = BOMB_AWARD_SCORE_INTERVAL; // exactly 100000
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore + 1);
  });

  it('a fresh run does not award a bomb until the first boundary is crossed', () => {
    const scoreState = createScoreState(); // score 0, cursor seeded at 0
    const { system } = makeSystem({ scoreState });
    const bombsBefore = scoreState.bombs;

    scoreState.score = 99999;
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(bombsBefore); // not yet
  });

  it('the award and the detonation both apply on the same tick', () => {
    const scoreState = createScoreState();
    scoreState.score = 99000;
    const inputState = new InputState();
    const { system } = makeSystem({ inputState, scoreState });
    const bombsBefore = scoreState.bombs;

    scoreState.score = 101000; // crosses one boundary (+1)
    inputState.queueBomb(); // and detonate (−1)
    system.fixedUpdate(DT);

    expect(scoreState.bombs).toBe(bombsBefore); // +1 award − 1 spend = net 0
  });
});

describe('BombSystem — snake chain routed through killedEnemies', () => {
  it('clears a full active snake: every segment released + reported, then SnakeSystem reaps the whole chain', () => {
    const bulletPool = new Pool(createBullet);
    const snakeSystem = new SnakeSystem(seqRng([0.1, 0.5]));
    const segPool = snakeSystem.enemyPool;
    const collision = new CollisionSystem(bulletPool, [segPool]);
    snakeSystem.collisionSystem = collision;
    const inputState = new InputState();
    const { system } = makeSystem({
      inputState,
      enemyPools: [segPool],
      collisionSystem: collision,
    });

    // Hand-place a straight 5-segment active snake using real pooled instances.
    const segments = [];
    for (let i = 0; i < 5; i++) {
      const seg = segPool.acquire();
      seg.x = 400 - i * 30;
      seg.y = 400;
      seg.vx = 0;
      seg.vy = 0;
      seg.telegraphMs = 0;
      segments.push(seg);
    }
    snakeSystem.snakes.push({ segments, headingRad: 0, slitherPhaseRad: 0 });

    inputState.queueBomb();
    collision.fixedUpdate(DT); // resets killedEnemies to []
    system.fixedUpdate(DT); // clears every segment → release + push to killedEnemies

    // Every segment released and reported.
    expect(segPool.activeCount).toBe(0);
    for (const seg of segments) {
      expect(collision.killedEnemies).toContain(seg);
    }

    // SnakeSystem reconciles on its next tick: the whole chain is reaped to removal.
    snakeSystem.fixedUpdate(DT);
    expect(snakeSystem.snakes.length).toBe(0);
    expect(activeOf(segPool).length).toBe(0);
  });
});

describe('BombSystem — zero steady-state allocation (NFR)', () => {
  it('does not grow its scratch buffers across repeated detonations', () => {
    const enemyPool = new Pool(createSeeker);
    const collision = { killedEnemies: [] };
    const scoreState = createScoreState();
    scoreState.bombs = 1000; // plenty to spend
    const inputState = new InputState();
    const { system } = makeSystem({
      inputState,
      enemyPools: [enemyPool],
      collisionSystem: collision,
      scoreState,
    });

    for (let t = 0; t < 50; t++) {
      collision.killedEnemies.length = 0; // a real CollisionSystem resets this each tick
      enemyPool.acquire();
      enemyPool.acquire();
      inputState.queueBomb();
      system.fixedUpdate(DT);
      expect(enemyPool.activeCount).toBe(0);
    }
    // Scratch is reused (materialized set has at most this tick's active count).
    expect(system._enemies.length).toBeLessThanOrEqual(2);
    expect(system._owners.length).toBeLessThanOrEqual(2);
  });
});
