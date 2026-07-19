import { describe, it, expect } from 'vitest';
import { EnemySystem } from './EnemySystem.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  SEEKER_SPEED,
  SEEKER_RADIUS,
  SEEKER_POOL_PREWARM,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// A ship is just a homing target: any object with x,y works.
function makeShip(x, y) {
  return { x, y };
}

// Deterministic rng that cycles through a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Materialize the active seekers into an array (tests only).
function activeSeekers(system) {
  const out = [];
  system.enemyPool.forEachActive((s) => out.push(s));
  return out;
}

// Directly place a live seeker in the pool at a position (bypasses random spawn).
function placeSeeker(system, x, y) {
  const s = system.enemyPool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  return s;
}

describe('EnemySystem — no self-spawn (director is the sole spawn authority)', () => {
  it('fixedUpdate never spawns on its own, over many intervals with no director', () => {
    const system = new EnemySystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    // Run far longer than any old cadence; the cadence no longer lives here.
    for (let i = 0; i < 2000; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount).toBe(0);
  });

  it('public spawn() places exactly one seeker per call', () => {
    const system = new EnemySystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(1);
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(2);
  });

  it('does not grow the pool over steady-state homing steps after a few spawns (NFR2)', () => {
    const system = new EnemySystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    for (let i = 0; i < 5; i++) system.spawn();
    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      SEEKER_POOL_PREWARM,
    );
    expect(system.enemyPool.activeCount).toBe(5); // no self-spawn added any
  });
});

describe('EnemySystem — spawn placement', () => {
  const minX = ARENA_BORDER_INSET + SEEKER_RADIUS;
  const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SEEKER_RADIUS;
  const minY = ARENA_BORDER_INSET + SEEKER_RADIUS;
  const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SEEKER_RADIUS;

  function onAnEdge(s) {
    const onFixed =
      s.x === minX || s.x === maxX || s.y === minY || s.y === maxY;
    const inX = s.x >= minX && s.x <= maxX;
    const inY = s.y >= minY && s.y <= maxY;
    return onFixed && inX && inY;
  }

  it('spawns each seeker on an arena edge, inside the drawn border', () => {
    // rng: edge selector then free-axis t, for every edge (0..3) at varied t.
    const system = new EnemySystem(
      makeShip(640, 360),
      seqRng([0.0, 0.1, 0.3, 0.4, 0.6, 0.7, 0.9, 0.95]),
    );
    // Spawn one on each of the four edges deterministically.
    system.spawn(); // edge 0 (top)
    system.spawn(); // edge 1 (bottom)
    system.spawn(); // edge 2 (left)
    system.spawn(); // edge 3 (right)

    const seekers = activeSeekers(system);
    expect(seekers.length).toBe(4);
    for (const s of seekers) {
      expect(onAnEdge(s)).toBe(true);
    }
  });

  it('places the top-edge seeker at y=minY with x in the free-axis range', () => {
    // edge=0 (top), t=0.5 → centered along x.
    const system = new EnemySystem(makeShip(640, 360), seqRng([0.0, 0.5]));
    system.spawn();
    const [s] = activeSeekers(system);
    expect(s.y).toBe(minY);
    expect(s.x).toBeCloseTo(minX + 0.5 * (maxX - minX), 6);
  });
});

describe('EnemySystem — homing', () => {
  it('sets velocity = unit(ship − seeker) × SEEKER_SPEED and moves toward the ship', () => {
    const system = new EnemySystem(makeShip(200, 100), seqRng([0.1, 0.5]));
    const s = placeSeeker(system, 100, 100); // ship is straight +x
    system.fixedUpdate(DT);
    expect(s.vx).toBeCloseTo(SEEKER_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
    expect(s.x).toBeCloseTo(100 + SEEKER_SPEED * (DT / 1000), 6);
    expect(s.y).toBeCloseTo(100, 6);
  });

  it('produces a diagonal unit velocity of magnitude SEEKER_SPEED', () => {
    const system = new EnemySystem(makeShip(400, 400), seqRng([0.1, 0.5]));
    const s = placeSeeker(system, 100, 100); // ship at 45°
    system.fixedUpdate(DT);
    const mag = Math.hypot(s.vx, s.vy);
    expect(mag).toBeCloseTo(SEEKER_SPEED, 6);
    // Equal components toward +x/+y for a 45° target.
    expect(s.vx).toBeCloseTo(s.vy, 6);
  });

  it('is frame-rate independent: equal net displacement for fine vs coarse ticks', () => {
    const T = 500; // ms — small enough the seeker never reaches the target
    const shipX = 1000;

    function runDisplacement(tickMs, ticks) {
      const system = new EnemySystem(makeShip(shipX, 360), seqRng([0.1, 0.5]));
      const s = placeSeeker(system, 100, 360);
      const startX = s.x;
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return s.x - startX;
    }

    const fine = runDisplacement(DT, Math.round(T / DT));
    const coarseStep = 100;
    const coarse = runDisplacement(coarseStep, Math.round(T / coarseStep));

    // Equal within one coarse step of travel.
    const oneStep = SEEKER_SPEED * (coarseStep / 1000);
    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(oneStep);
    // And both moved toward the ship (+x).
    expect(fine).toBeGreaterThan(0);
    expect(coarse).toBeGreaterThan(0);
  });

  it('tracks independently: two seekers each head toward the one ship', () => {
    const system = new EnemySystem(makeShip(500, 500), seqRng([0.1, 0.5]));
    const a = placeSeeker(system, 100, 500); // ship straight +x from a
    const b = placeSeeker(system, 500, 100); // ship straight +y from b
    system.fixedUpdate(DT);
    // a heads +x, b heads +y — distinct directions.
    expect(a.vx).toBeCloseTo(SEEKER_SPEED, 6);
    expect(a.vy).toBeCloseTo(0, 6);
    expect(b.vx).toBeCloseTo(0, 6);
    expect(b.vy).toBeCloseTo(SEEKER_SPEED, 6);
  });

  it('coincident with the ship: zero velocity, no NaN, position unchanged', () => {
    const system = new EnemySystem(makeShip(300, 300), seqRng([0.1, 0.5]));
    const s = placeSeeker(system, 300, 300);
    system.fixedUpdate(DT);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(Number.isNaN(s.x)).toBe(false);
    expect(Number.isNaN(s.y)).toBe(false);
    expect(s.x).toBe(300);
    expect(s.y).toBe(300);
  });
});

describe('EnemySystem — pool prewarm (NFR2)', () => {
  it('prewarms the pool and recycles instances without growing (no allocation)', () => {
    const system = new EnemySystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    // At construction the pool is fully prewarmed and nothing is checked out.
    expect(system.enemyPool.freeCount).toBe(SEEKER_POOL_PREWARM);
    expect(system.enemyPool.activeCount).toBe(0);

    // Spawn exactly the prewarm count: every acquire recycles a prewarmed idle
    // instance, so the factory never runs and the pool never grows.
    for (let i = 0; i < SEEKER_POOL_PREWARM; i++) system.spawn();

    expect(system.enemyPool.activeCount).toBe(SEEKER_POOL_PREWARM);
    expect(system.enemyPool.freeCount).toBe(0);
    // Total capacity never exceeded the prewarm — no factory call beyond it.
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      SEEKER_POOL_PREWARM,
    );
  });
});
