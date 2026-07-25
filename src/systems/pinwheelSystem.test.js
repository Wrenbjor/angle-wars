import { describe, it, expect } from 'vitest';
import { PinwheelSystem } from './PinwheelSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createPinwheel } from '../entities/Pinwheel.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  PINWHEEL_RADIUS,
  PINWHEEL_DRIFT_SPEED,
  PINWHEEL_WANDER_INTERVAL_MS,
  PINWHEEL_WANDER_MAX_TURN_RAD,
  PINWHEEL_POOL_PREWARM,
  PINWHEEL_SCORE,
  PINWHEEL_XP,
  PLAYER_INVULN_MS,
  PLAYER_START_LIVES,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Arena bounce bounds (inset by the radius), shared by several tests.
const MIN_X = ARENA_BORDER_INSET + PINWHEEL_RADIUS;
const MAX_X = ARENA_WIDTH - ARENA_BORDER_INSET - PINWHEEL_RADIUS;
const MIN_Y = ARENA_BORDER_INSET + PINWHEEL_RADIUS;
const MAX_Y = ARENA_HEIGHT - ARENA_BORDER_INSET - PINWHEEL_RADIUS;

// Deterministic rng that cycles through a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// The Pinwheel is indifferent to the player: the system takes ONLY an rng.
function makeSystem(rng = seqRng([0.1, 0.5, 0.25])) {
  return new PinwheelSystem(rng);
}

// Directly place a live pinwheel in the pool (bypasses random spawn) with an
// explicit velocity and wander accumulator.
function placePinwheel(system, x, y, vx, vy, wanderMs = 0) {
  const pw = system.enemyPool.acquire();
  pw.x = x;
  pw.y = y;
  pw.vx = vx;
  pw.vy = vy;
  pw.wanderMs = wanderMs;
  return pw;
}

function activePinwheels(system) {
  const out = [];
  system.enemyPool.forEachActive((pw) => out.push(pw));
  return out;
}

describe('PinwheelSystem — straight drift (indifferent to the player)', () => {
  it('integrates by v·dtSec, leaves velocity + magnitude unchanged, no re-roll', () => {
    const system = makeSystem();
    // Mid-arena, drifting +x at the drift speed, wander far from the interval.
    const pw = placePinwheel(system, 640, 360, PINWHEEL_DRIFT_SPEED, 0, 0);
    system.fixedUpdate(DT);

    // Velocity untouched (no wander crossing, no wall).
    expect(pw.vx).toBe(PINWHEEL_DRIFT_SPEED);
    expect(pw.vy).toBe(0);
    // Magnitude preserved == drift speed.
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
    // Position integrated by v·dtSec.
    expect(pw.x).toBeCloseTo(640 + PINWHEEL_DRIFT_SPEED * (DT / 1000), 9);
    expect(pw.y).toBeCloseTo(360, 9);
    // Wander accumulator advanced by dt but did not cross the interval.
    expect(pw.wanderMs).toBeCloseTo(DT, 9);
  });

  it('drifts purely from its own velocity — the trajectory never references a ship', () => {
    // The system exposes no ship reference at all (indifferent by construction).
    const system = makeSystem();
    expect(system.ship).toBeUndefined();
    const pw = placePinwheel(system, 400, 400, 0, PINWHEEL_DRIFT_SPEED, 0);
    system.fixedUpdate(DT);
    // Moved along its own −/+y velocity, unrelated to any player position.
    expect(pw.x).toBeCloseTo(400, 9);
    expect(pw.y).toBeCloseTo(400 + PINWHEEL_DRIFT_SPEED * (DT / 1000), 9);
  });
});

describe('PinwheelSystem — heading re-roll (wander)', () => {
  it('rotates velocity by turn=(rng*2−1)*MAX_TURN, preserves magnitude, subtracts interval', () => {
    // rng()=>1 → theta = +MAX_TURN (the max positive turn).
    const system = new PinwheelSystem(() => 1);
    // wanderMs pre-loaded to the interval so a single dt tick crosses exactly once.
    const pw = placePinwheel(
      system,
      640,
      360,
      PINWHEEL_DRIFT_SPEED,
      0,
      PINWHEEL_WANDER_INTERVAL_MS,
    );
    system.fixedUpdate(DT);

    const theta = PINWHEEL_WANDER_MAX_TURN_RAD;
    expect(pw.vx).toBeCloseTo(PINWHEEL_DRIFT_SPEED * Math.cos(theta), 6);
    expect(pw.vy).toBeCloseTo(PINWHEEL_DRIFT_SPEED * Math.sin(theta), 6);
    // Magnitude preserved through the rotation.
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 6);
    // One interval subtracted, dt remainder carried.
    expect(pw.wanderMs).toBeCloseTo(DT, 6);
  });

  it('a zero turn (rng==0.5) leaves the heading unchanged but still consumes the interval', () => {
    const system = new PinwheelSystem(() => 0.5); // theta = 0
    const pw = placePinwheel(
      system,
      640,
      360,
      0,
      PINWHEEL_DRIFT_SPEED,
      PINWHEEL_WANDER_INTERVAL_MS,
    );
    system.fixedUpdate(DT);

    expect(pw.vx).toBeCloseTo(0, 9);
    expect(pw.vy).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
    expect(pw.wanderMs).toBeCloseTo(DT, 6);
  });

  it('re-roll COUNT over elapsed sim time is independent of tick size', () => {
    // T below the spawn interval so ONLY wander re-rolls draw the rng (each
    // re-roll draws exactly one value). Count draws to count re-rolls.
    const T = PINWHEEL_WANDER_INTERVAL_MS * 2; // 1400ms < spawn interval (2000ms)
    const expected = Math.floor(T / PINWHEEL_WANDER_INTERVAL_MS); // 2

    function countRerolls(tickMs) {
      let calls = 0;
      const rng = () => {
        calls++;
        return 0.5; // theta = 0: keeps motion straight, isolates the count
      };
      const system = new PinwheelSystem(rng);
      // Drift downward, mid-arena, so no wall is reached over T.
      placePinwheel(system, 640, 100, 0, PINWHEEL_DRIFT_SPEED, 0);
      const ticks = Math.round(T / tickMs);
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return calls;
    }

    const fine = countRerolls(DT);
    const coarse = countRerolls(100);
    // Tick-size independence within the ±1 float-accumulator boundary tolerance
    // (mirrors the spawn-cadence assertion): the count tracks floor(T/interval)
    // regardless of tick size, never scaling with the number of ticks.
    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(1);
    expect(fine).toBeGreaterThanOrEqual(expected - 1);
    expect(fine).toBeLessThanOrEqual(expected + 1);
    expect(coarse).toBeGreaterThanOrEqual(expected - 1);
    expect(coarse).toBeLessThanOrEqual(expected + 1);
  });

  it('emergent wander: heading rotates cumulatively over an integrated run (AC1 pseudo-random path)', () => {
    // rng()=>1 → each re-roll turns by +MAX_TURN. 90 DT ticks = 1500ms of sim
    // time → exactly 2 re-rolls (floor(1500/700)), 0 spawns (< 2000ms spawn
    // interval), and the ~195px max path never reaches a wall from mid-arena.
    const system = new PinwheelSystem(() => 1);
    const pw = placePinwheel(system, 640, 360, PINWHEEL_DRIFT_SPEED, 0, 0);
    for (let i = 0; i < 90; i++) system.fixedUpdate(DT);

    // (a) Heading rotated cumulatively to ≈ +2×MAX_TURN from the initial +x.
    const heading = Math.atan2(pw.vy, pw.vx);
    expect(heading).toBeCloseTo(2 * PINWHEEL_WANDER_MAX_TURN_RAD, 6);
    // (b) Speed magnitude preserved across the rotations.
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 6);
    // (c) The path actually bent — it is no longer straight along +x.
    expect(pw.vy).not.toBe(0);
    // No spawn occurred (only the placed pinwheel is active), so the run drove a
    // real integrated wander, not a fresh edge-spawn heading.
    expect(system.enemyPool.activeCount).toBe(1);
  });
});

describe('PinwheelSystem — wall bounce (reflection)', () => {
  it('bounces off the +x wall: clamps to maxX, negates vx, keeps vy + magnitude', () => {
    const system = makeSystem();
    // Just inside maxX, drifting +x fast enough to cross this tick.
    const pw = placePinwheel(system, MAX_X - 1, 360, PINWHEEL_DRIFT_SPEED, 0, 0);
    system.fixedUpdate(DT);

    expect(pw.x).toBe(MAX_X); // clamped to the bound
    expect(pw.vx).toBe(-PINWHEEL_DRIFT_SPEED); // reflected
    expect(pw.vy).toBe(0); // untouched
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
  });

  it('bounces off the −x wall: clamps to minX, negates vx', () => {
    const system = makeSystem();
    const pw = placePinwheel(system, MIN_X + 1, 360, -PINWHEEL_DRIFT_SPEED, 0, 0);
    system.fixedUpdate(DT);

    expect(pw.x).toBe(MIN_X);
    expect(pw.vx).toBe(PINWHEEL_DRIFT_SPEED);
    expect(pw.vy).toBe(0);
  });

  it('bounces off the +y wall: clamps to maxY, negates vy, keeps vx + magnitude', () => {
    const system = makeSystem();
    const pw = placePinwheel(system, 640, MAX_Y - 1, 0, PINWHEEL_DRIFT_SPEED, 0);
    system.fixedUpdate(DT);

    expect(pw.y).toBe(MAX_Y);
    expect(pw.vy).toBe(-PINWHEEL_DRIFT_SPEED);
    expect(pw.vx).toBe(0);
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
  });

  it('bounces off the −y wall: clamps to minY, negates vy', () => {
    const system = makeSystem();
    const pw = placePinwheel(system, 640, MIN_Y + 1, 0, -PINWHEEL_DRIFT_SPEED, 0);
    system.fixedUpdate(DT);

    expect(pw.y).toBe(MIN_Y);
    expect(pw.vy).toBe(PINWHEEL_DRIFT_SPEED);
    expect(pw.vx).toBe(0);
  });

  it('corner bounce: both axes reflect independently and clamp into the corner', () => {
    const system = makeSystem();
    const v = PINWHEEL_DRIFT_SPEED / Math.SQRT2; // equal split, |v| == drift speed
    const pw = placePinwheel(system, MAX_X - 1, MAX_Y - 1, v, v, 0);
    system.fixedUpdate(DT);

    expect(pw.x).toBe(MAX_X);
    expect(pw.y).toBe(MAX_Y);
    expect(pw.vx).toBeCloseTo(-v, 9);
    expect(pw.vy).toBeCloseTo(-v, 9);
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
  });
});

describe('PinwheelSystem — frame-rate independence of straight-drift integration', () => {
  it('equal net displacement for fine vs coarse ticks (no wander, no wall)', () => {
    // T below the wander interval so no re-roll occurs, mid-arena so no wall.
    const T = 480; // ms; 10*48 == 96*5 == 480 exactly
    const vx = PINWHEEL_DRIFT_SPEED;

    function runDisplacement(tickMs, ticks) {
      const system = makeSystem();
      const pw = placePinwheel(system, 300, 360, vx, 0, 0);
      const startX = pw.x;
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return pw.x - startX;
    }

    const fine = runDisplacement(10, T / 10); // 48 fine ticks
    const coarse = runDisplacement(96, T / 96); // 5 coarse ticks
    expect(fine).toBeCloseTo(coarse, 9);
    // And both equal the closed-form drift over T.
    expect(fine).toBeCloseTo(vx * (T / 1000), 9);
  });
});

describe('PinwheelSystem — no self-spawn / public spawn / placement / heading', () => {
  it('fixedUpdate never spawns on its own, over many intervals with no director', () => {
    const system = makeSystem();
    for (let i = 0; i < 2000; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount).toBe(0);
  });

  it('public spawn() places exactly one pinwheel per call', () => {
    const system = makeSystem();
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(1);
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(2);
  });

  it('spawns each pinwheel on an arena edge, inside the drawn border', () => {
    // Three rng draws per spawn: edge, position-along-edge, heading angle.
    const system = makeSystem(
      seqRng([
        0.0, 0.1, 0.2, // top
        0.3, 0.4, 0.2, // bottom
        0.6, 0.7, 0.2, // left
        0.9, 0.95, 0.2, // right
      ]),
    );
    system.spawn();
    system.spawn();
    system.spawn();
    system.spawn();

    const pws = activePinwheels(system);
    expect(pws.length).toBe(4);
    for (const pw of pws) {
      const onFixed =
        pw.x === MIN_X || pw.x === MAX_X || pw.y === MIN_Y || pw.y === MAX_Y;
      const inX = pw.x >= MIN_X && pw.x <= MAX_X;
      const inY = pw.y >= MIN_Y && pw.y <= MAX_Y;
      expect(onFixed && inX && inY).toBe(true);
    }
  });

  it('places the top-edge pinwheel at y=MIN_Y with x in the free-axis range', () => {
    // edge index 0 (0.0*4=0), free-axis t=0.5.
    const system = makeSystem(seqRng([0.0, 0.5, 0.0]));
    system.spawn();
    const [pw] = activePinwheels(system);
    expect(pw.y).toBe(MIN_Y);
    expect(pw.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
  });

  it('places the bottom-edge pinwheel at y=MAX_Y with x in the free-axis range', () => {
    // edge index 1 (0.25*4=1.0), free-axis t=0.5.
    const system = makeSystem(seqRng([0.25, 0.5, 0.0]));
    system.spawn();
    const [pw] = activePinwheels(system);
    expect(pw.y).toBe(MAX_Y);
    expect(pw.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
  });

  it('places the left-edge pinwheel at x=MIN_X with y in the free-axis range', () => {
    // edge index 2 (0.5*4=2.0), free-axis t=0.3.
    const system = makeSystem(seqRng([0.5, 0.3, 0.0]));
    system.spawn();
    const [pw] = activePinwheels(system);
    expect(pw.x).toBe(MIN_X);
    expect(pw.y).toBeCloseTo(MIN_Y + 0.3 * (MAX_Y - MIN_Y), 6);
  });

  it('places the right-edge pinwheel at x=MAX_X with y in the free-axis range', () => {
    // edge index 3 (0.75*4=3.0), free-axis t=0.7.
    const system = makeSystem(seqRng([0.75, 0.7, 0.0]));
    system.spawn();
    const [pw] = activePinwheels(system);
    expect(pw.x).toBe(MAX_X);
    expect(pw.y).toBeCloseTo(MIN_Y + 0.7 * (MAX_Y - MIN_Y), 6);
  });

  it('spawns with a random heading at exactly the drift speed', () => {
    const system = makeSystem(seqRng([0.0, 0.5, 0.37]));
    system.spawn();
    const [pw] = activePinwheels(system);
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
    // Heading matches the third rng draw × 2π.
    const angle = 0.37 * Math.PI * 2;
    expect(pw.vx).toBeCloseTo(Math.cos(angle) * PINWHEEL_DRIFT_SPEED, 9);
    expect(pw.vy).toBeCloseTo(Math.sin(angle) * PINWHEEL_DRIFT_SPEED, 9);
  });

  it('a recycled instance respawns with a fresh (zeroed then re-loaded) wander accumulator', () => {
    const system = makeSystem(seqRng([0.0, 0.5, 0.1]));
    // Give a live instance a large wanderMs, release it, then respawn it.
    const pw = placePinwheel(system, 100, 100, PINWHEEL_DRIFT_SPEED, 0, 999);
    system.enemyPool.release(pw);
    system.spawn();
    const [recycled] = activePinwheels(system);
    expect(recycled).toBe(pw); // recycled, not freshly allocated
    expect(recycled.wanderMs).toBe(0);
  });
});

describe('PinwheelSystem — spawn telegraph (Story 2.6)', () => {
  it('spawn() sets telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS (heading + drift still set)', () => {
    const system = makeSystem(seqRng([0.0, 0.5, 0.37]));
    system.spawn();
    const [pw] = activePinwheels(system);
    expect(pw.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    // Heading/speed are set on spawn as before (the drift only starts on activation).
    expect(Math.hypot(pw.vx, pw.vy)).toBeCloseTo(PINWHEEL_DRIFT_SPEED, 9);
  });

  it('freezes a telegraphing pinwheel: no wander re-roll, no drift, counts down by dt', () => {
    // rng()=>1 would turn by +MAX_TURN if the wander ran; it must NOT while frozen.
    const system = new PinwheelSystem(() => 1);
    const pw = placePinwheel(
      system,
      640,
      360,
      PINWHEEL_DRIFT_SPEED,
      0,
      PINWHEEL_WANDER_INTERVAL_MS, // primed to cross the wander interval this tick
    );
    pw.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;

    system.fixedUpdate(DT);

    // Frozen: position, velocity, and the wander accumulator are all untouched.
    expect(pw.x).toBe(640);
    expect(pw.y).toBe(360);
    expect(pw.vx).toBe(PINWHEEL_DRIFT_SPEED);
    expect(pw.vy).toBe(0);
    expect(pw.wanderMs).toBe(PINWHEEL_WANDER_INTERVAL_MS);
    // Only the telegraph advanced.
    expect(pw.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
  });

  it('drifts normally on the tick the telegraph reaches 0 (AC2)', () => {
    const system = makeSystem();
    const pw = placePinwheel(system, 640, 360, PINWHEEL_DRIFT_SPEED, 0, 0);
    pw.telegraphMs = DT;

    system.fixedUpdate(DT);

    expect(pw.telegraphMs).toBe(0);
    // Integrated by v·dtSec this same tick.
    expect(pw.x).toBeCloseTo(640 + PINWHEEL_DRIFT_SPEED * (DT / 1000), 9);
  });

  it('spawn-point avoidance: re-rolls the placement away from a ship on the default candidate (AC3)', () => {
    const shipX = MIN_X + 0.5 * (MAX_X - MIN_X);
    const shipY = MIN_Y;
    // top-center (on ship) → re-roll → bottom-center (far); trailing heading draw.
    const system = makeSystem(seqRng([0.0, 0.5, 0.25, 0.5, 0.37]));
    system.spawn(shipX, shipY);
    const [pw] = activePinwheels(system);
    const dx = pw.x - shipX;
    const dy = pw.y - shipY;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
  });

  it('the system never stores a ship — the avoid point is a spawn() argument only', () => {
    const system = makeSystem();
    system.spawn(100, 100);
    // Player-indifferent by construction: no ship reference materializes.
    expect(system.ship).toBeUndefined();
  });
});

describe('PinwheelSystem — pool prewarm (NFR2)', () => {
  it('prewarms the pool and recycles instances without growing (no allocation)', () => {
    const system = makeSystem();
    expect(system.enemyPool.freeCount).toBe(PINWHEEL_POOL_PREWARM);
    expect(system.enemyPool.activeCount).toBe(0);

    for (let i = 0; i < PINWHEEL_POOL_PREWARM; i++) system.spawn();

    expect(system.enemyPool.activeCount).toBe(PINWHEEL_POOL_PREWARM);
    expect(system.enemyPool.freeCount).toBe(0);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      PINWHEEL_POOL_PREWARM,
    );
  });

  it('does not grow the pool over many steady-state behavior steps after a few spawns', () => {
    const system = makeSystem();
    for (let i = 0; i < 5; i++) system.spawn();
    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      PINWHEEL_POOL_PREWARM,
    );
    expect(system.enemyPool.activeCount).toBe(5); // no self-spawn added any
  });
});

describe('createPinwheel factory', () => {
  it('returns a zeroed shape with radius, base score, and wanderMs=0', () => {
    const pw = createPinwheel();
    expect(pw.x).toBe(0);
    expect(pw.y).toBe(0);
    expect(pw.vx).toBe(0);
    expect(pw.vy).toBe(0);
    expect(pw.radius).toBe(PINWHEEL_RADIUS);
    expect(pw.score).toBe(PINWHEEL_SCORE);
    expect(pw.xp).toBe(PINWHEEL_XP); // base per-type XP (Story 8.1)
    expect(pw.wanderMs).toBe(0);
    expect(pw.telegraphMs).toBe(0); // spawned-and-active default (Story 2.6)
  });
});

describe('PinwheelSystem — AC3: bullet kill + scoring through the real shared seams', () => {
  it('a bullet over a pinwheel releases it, consumes the bullet, and credits PINWHEEL_SCORE', () => {
    const system = makeSystem();
    const pinwheelPool = system.enemyPool;
    const pw = placePinwheel(system, 400, 400, PINWHEEL_DRIFT_SPEED, 0, 0);

    // A real bullet overlapping the pinwheel.
    const bulletPool = new Pool(createBullet);
    const b = bulletPool.acquire();
    b.x = 400;
    b.y = 400;

    // The REAL collision + scoring seams over an array containing the pinwheel pool.
    const collision = new CollisionSystem(bulletPool, [pinwheelPool]);
    const scoreState = createScoreState();
    const scoring = new ScoringSystem(collision, scoreState);

    collision.fixedUpdate(DT);
    scoring.fixedUpdate(DT);

    expect(pinwheelPool.activeCount).toBe(0); // pinwheel released to its pool
    expect(bulletPool.activeCount).toBe(0); // bullet consumed
    expect(collision.killedEnemies).toContain(pw); // reported killed
    expect(scoreState.score).toBe(PINWHEEL_SCORE); // scored its own base value
  });
});

describe('PinwheelSystem — AC2: ship contact through the real PlayerDeathSystem', () => {
  it('a non-invulnerable ship over a pinwheel triggers the standard death flow', () => {
    const system = makeSystem();
    const pinwheelPool = system.enemyPool;
    const ship = createPlayerShip();
    ship.x = 200;
    ship.y = 200;
    placePinwheel(system, 200, 200, PINWHEEL_DRIFT_SPEED, 0, 0); // overlapping

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [pinwheelPool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS); // respawn invuln granted
    // Ship contact never destroys the pinwheel.
    expect(pinwheelPool.activeCount).toBe(1);
  });

  it('game-over on the last life (at most one death per step)', () => {
    const system = makeSystem();
    const pinwheelPool = system.enemyPool;
    const ship = createPlayerShip();
    ship.x = 200;
    ship.y = 200;
    // Two overlapping pinwheels — still only ONE death this step.
    placePinwheel(system, 200, 200, PINWHEEL_DRIFT_SPEED, 0, 0);
    placePinwheel(system, 200, 200, 0, PINWHEEL_DRIFT_SPEED, 0);

    const playerState = createPlayerState();
    playerState.lives = 1; // last life
    const death = new PlayerDeathSystem(ship, [pinwheelPool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
  });
});

describe('PinwheelSystem — stun freeze (Story 11.9)', () => {
  it('freezes a stunned pinwheel: no drift, velocity zeroed, counts down stunMs by dt', () => {
    const system = makeSystem();
    const pw = placePinwheel(system, 200, 200, PINWHEEL_DRIFT_SPEED, 0, 0);
    pw.stunMs = 2000;

    system.fixedUpdate(DT);

    expect(pw.x).toBe(200);
    expect(pw.y).toBe(200);
    expect(pw.vx).toBe(0);
    expect(pw.vy).toBe(0);
    expect(pw.stunMs).toBeCloseTo(2000 - DT, 6);
  });
});
