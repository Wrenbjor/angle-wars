import { describe, it, expect } from 'vitest';
import { GreenSquareSystem } from './GreenSquareSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  GREEN_SQUARE_RADIUS,
  GREEN_SQUARE_FLEE_SPEED,
  GREEN_SQUARE_CHASE_SPEED,
  GREEN_SQUARE_THREAT_RADIUS,
  GREEN_SQUARE_SPAWN_INTERVAL_MS,
  GREEN_SQUARE_POOL_PREWARM,
  GREEN_SQUARE_SCORE,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Arena clamp bounds (inset by the radius), shared by several tests.
const MIN_X = ARENA_BORDER_INSET + GREEN_SQUARE_RADIUS;
const MAX_X = ARENA_WIDTH - ARENA_BORDER_INSET - GREEN_SQUARE_RADIUS;
const MIN_Y = ARENA_BORDER_INSET + GREEN_SQUARE_RADIUS;
const MAX_Y = ARENA_HEIGHT - ARENA_BORDER_INSET - GREEN_SQUARE_RADIUS;

// A ship is just a flee/home reference: any object with x,y works.
function makeShip(x, y) {
  return { x, y };
}

// Deterministic rng that cycles through a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Build a system with an (optionally shared) bullet pool for threat detection.
function makeSystem(ship, bulletPool = new Pool(createBullet), rng = seqRng([0.1, 0.5])) {
  const system = new GreenSquareSystem(ship, bulletPool, rng);
  return { system, bulletPool };
}

// Directly place a live square in the pool at a position (bypasses random spawn).
function placeSquare(system, x, y, aggro = false) {
  const s = system.enemyPool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.aggro = aggro;
  return s;
}

// Add an active bullet at a position (only x,y matter for threat detection).
function addBullet(pool, x, y) {
  const b = pool.acquire();
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
  return b;
}

function activeSquares(system) {
  const out = [];
  system.enemyPool.forEachActive((s) => out.push(s));
  return out;
}

describe('GreenSquareSystem — flee (unprovoked)', () => {
  it('moves directly away from the ship at the flee speed and stays non-aggressive', () => {
    // Ship straight +x from the square → flee is straight −x.
    const { system } = makeSystem(makeShip(300, 100));
    const s = placeSquare(system, 100, 100);
    system.fixedUpdate(DT);

    expect(s.aggro).toBe(false);
    expect(s.vx).toBeCloseTo(-GREEN_SQUARE_FLEE_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
    // Integrated away from the ship (−x), no wall in reach.
    expect(s.x).toBeCloseTo(100 - GREEN_SQUARE_FLEE_SPEED * (DT / 1000), 6);
    expect(s.y).toBeCloseTo(100, 6);
  });

  it('flees diagonally with a unit velocity of magnitude FLEE_SPEED', () => {
    // Ship at 45° from the square → flee is the opposite 45°.
    const { system } = makeSystem(makeShip(500, 500));
    const s = placeSquare(system, 300, 300);
    system.fixedUpdate(DT);

    const mag = Math.hypot(s.vx, s.vy);
    expect(mag).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6);
    // Away from the ship: both components negative and equal.
    expect(s.vx).toBeLessThan(0);
    expect(s.vy).toBeLessThan(0);
    expect(s.vx).toBeCloseTo(s.vy, 6);
  });
});

describe('GreenSquareSystem — threat → aggro latch', () => {
  it('latches aggressive this tick when a bullet is within the threat radius, then homes', () => {
    const ship = makeShip(400, 100);
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem(ship, bulletPool);
    const s = placeSquare(system, 100, 100);
    // Bullet within THREAT_RADIUS of the square but well outside a hit radius.
    addBullet(bulletPool, 100 + GREEN_SQUARE_THREAT_RADIUS - 1, 100);

    system.fixedUpdate(DT);

    expect(s.aggro).toBe(true);
    // On the SAME tick it already homes toward the ship (+x) at the chase speed.
    expect(s.vx).toBeCloseTo(GREEN_SQUARE_CHASE_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
    expect(s.x).toBeGreaterThan(100); // moved toward the ship
  });

  it('does NOT provoke when the nearest bullet is beyond the threat radius', () => {
    const ship = makeShip(400, 100);
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem(ship, bulletPool);
    const s = placeSquare(system, 100, 100);
    // Just beyond the threat radius.
    addBullet(bulletPool, 100 + GREEN_SQUARE_THREAT_RADIUS + 1, 100);

    system.fixedUpdate(DT);

    expect(s.aggro).toBe(false);
    // Still fleeing (−x, away from the ship).
    expect(s.vx).toBeCloseTo(-GREEN_SQUARE_FLEE_SPEED, 6);
  });

  it('an exact boundary bullet (distance == threat radius) provokes', () => {
    const ship = makeShip(400, 100);
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem(ship, bulletPool);
    const s = placeSquare(system, 100, 100);
    addBullet(bulletPool, 100 + GREEN_SQUARE_THREAT_RADIUS, 100);

    system.fixedUpdate(DT);

    expect(s.aggro).toBe(true);
  });

  it('once latched it STAYS aggressive after the bullet is gone (one-way latch)', () => {
    const ship = makeShip(400, 100);
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem(ship, bulletPool);
    const s = placeSquare(system, 100, 100);
    const b = addBullet(bulletPool, 150, 100); // within threat radius
    system.fixedUpdate(DT);
    expect(s.aggro).toBe(true);

    // Remove all bullets; the square must remain aggressive and keep homing.
    bulletPool.release(b);
    system.fixedUpdate(DT);
    expect(s.aggro).toBe(true);
    expect(s.vx).toBeGreaterThan(0); // still homing toward the ship (+x)
  });
});

describe('GreenSquareSystem — aggro pursuit', () => {
  it('sets velocity = unit(ship − square) × CHASE_SPEED and moves toward the ship', () => {
    const { system } = makeSystem(makeShip(300, 100));
    const s = placeSquare(system, 100, 100, /*aggro*/ true);
    system.fixedUpdate(DT);

    expect(s.vx).toBeCloseTo(GREEN_SQUARE_CHASE_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
    expect(s.x).toBeCloseTo(100 + GREEN_SQUARE_CHASE_SPEED * (DT / 1000), 6);
    expect(s.y).toBeCloseTo(100, 6);
  });

  it('stays aggressive with no bullet near (latched) and keeps homing', () => {
    const { system } = makeSystem(makeShip(500, 500));
    const s = placeSquare(system, 100, 100, /*aggro*/ true);
    system.fixedUpdate(DT);

    expect(s.aggro).toBe(true);
    const mag = Math.hypot(s.vx, s.vy);
    expect(mag).toBeCloseTo(GREEN_SQUARE_CHASE_SPEED, 6);
    // Toward the ship: both components positive.
    expect(s.vx).toBeGreaterThan(0);
    expect(s.vy).toBeGreaterThan(0);
  });
});

describe('GreenSquareSystem — coincident with the ship', () => {
  for (const aggro of [false, true]) {
    it(`zero velocity, no NaN, position unchanged (aggro=${aggro})`, () => {
      const { system } = makeSystem(makeShip(640, 360));
      const s = placeSquare(system, 640, 360, aggro); // exactly at the ship
      system.fixedUpdate(DT);

      expect(s.vx).toBe(0);
      expect(s.vy).toBe(0);
      expect(Number.isNaN(s.x)).toBe(false);
      expect(Number.isNaN(s.y)).toBe(false);
      expect(s.x).toBe(640);
      expect(s.y).toBe(360);
    });
  }
});

describe('GreenSquareSystem — wall clamp', () => {
  it('clamps a fleeing square to the arena inset bounds on each axis', () => {
    // Ship at center; square pinned in the top-left corner → flee heads further
    // out of bounds and must be clamped back to (MIN_X, MIN_Y).
    const { system } = makeSystem(makeShip(ARENA_WIDTH / 2, ARENA_HEIGHT / 2));
    const s = placeSquare(system, MIN_X, MIN_Y);
    system.fixedUpdate(DT);

    expect(s.x).toBe(MIN_X);
    expect(s.y).toBe(MIN_Y);
  });

  it('clamps against the far (max) bounds too', () => {
    // Ship at center; square in the bottom-right corner → flee heads out past
    // the max bounds and is clamped back to (MAX_X, MAX_Y).
    const { system } = makeSystem(makeShip(ARENA_WIDTH / 2, ARENA_HEIGHT / 2));
    const s = placeSquare(system, MAX_X, MAX_Y);
    system.fixedUpdate(DT);

    expect(s.x).toBe(MAX_X);
    expect(s.y).toBe(MAX_Y);
  });
});

describe('GreenSquareSystem — frame-rate independence', () => {
  it('flee: equal net displacement for fine vs coarse ticks', () => {
    const T = 500; // ms — short enough the square never reaches a wall
    const shipX = 1000; // far to the right → the square flees −x the whole time

    function runDisplacement(tickMs, ticks) {
      const { system } = makeSystem(makeShip(shipX, 360));
      const s = placeSquare(system, 500, 360);
      const startX = s.x;
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return s.x - startX;
    }

    const fine = runDisplacement(DT, Math.round(T / DT));
    const coarseStep = 100;
    const coarse = runDisplacement(coarseStep, Math.round(T / coarseStep));

    const oneStep = GREEN_SQUARE_FLEE_SPEED * (coarseStep / 1000);
    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(oneStep);
    // Both fled away from the ship (−x).
    expect(fine).toBeLessThan(0);
    expect(coarse).toBeLessThan(0);
  });

  it('chase: equal net displacement for fine vs coarse ticks', () => {
    const T = 500;
    const shipX = 1000;

    function runDisplacement(tickMs, ticks) {
      const { system } = makeSystem(makeShip(shipX, 360));
      const s = placeSquare(system, 100, 360, /*aggro*/ true);
      const startX = s.x;
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return s.x - startX;
    }

    const fine = runDisplacement(DT, Math.round(T / DT));
    const coarseStep = 100;
    const coarse = runDisplacement(coarseStep, Math.round(T / coarseStep));

    const oneStep = GREEN_SQUARE_CHASE_SPEED * (coarseStep / 1000);
    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(oneStep);
    // Both chased toward the ship (+x).
    expect(fine).toBeGreaterThan(0);
    expect(coarse).toBeGreaterThan(0);
  });
});

describe('GreenSquareSystem — spawn cadence', () => {
  it('spawns ≈ floor(T / interval) squares, independent of tick size', () => {
    const T = GREEN_SQUARE_SPAWN_INTERVAL_MS * 5;
    const expected = Math.floor(T / GREEN_SQUARE_SPAWN_INTERVAL_MS);

    function runSpawns(tickMs) {
      const { system } = makeSystem(makeShip(640, 360));
      const ticks = Math.round(T / tickMs);
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return system.enemyPool.activeCount;
    }

    const fine = runSpawns(DT);
    const coarse = runSpawns(GREEN_SQUARE_SPAWN_INTERVAL_MS);

    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(1);
    expect(fine).toBeGreaterThanOrEqual(expected - 1);
    expect(fine).toBeLessThanOrEqual(expected + 1);
    expect(coarse).toBeGreaterThanOrEqual(expected - 1);
    expect(coarse).toBeLessThanOrEqual(expected + 1);
  });

  it('does not spawn before one full interval has accumulated', () => {
    const { system } = makeSystem(makeShip(640, 360));
    const ticks = Math.floor(GREEN_SQUARE_SPAWN_INTERVAL_MS / DT) - 1;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount).toBe(0);
  });

  it('each spawned square starts non-aggressive (fleeing)', () => {
    const { system } = makeSystem(makeShip(640, 360));
    system._spawnOne();
    const [s] = activeSquares(system);
    expect(s.aggro).toBe(false);
  });

  it('a recycled instance that was aggressive respawns fleeing (aggro reset)', () => {
    // Provoke a square to aggro=true, release it back to the pool, then spawn —
    // the recycled instance must come back fleeing. Pins the `s.aggro = false`
    // reset in _spawnOne (a fresh pool's instances are already false from the
    // factory, so the spawn-aggro test above cannot catch a dropped reset).
    const { system } = makeSystem(makeShip(640, 360));
    const s = placeSquare(system, 100, 100, /*aggro*/ true);
    expect(s.aggro).toBe(true);
    system.enemyPool.release(s);
    system._spawnOne();
    // The single free instance is the one just released — recycled, not new.
    const [recycled] = activeSquares(system);
    expect(recycled).toBe(s);
    expect(recycled.aggro).toBe(false);
  });
});

describe('GreenSquareSystem — spawn placement', () => {
  function onAnEdge(s) {
    const onFixed =
      s.x === MIN_X || s.x === MAX_X || s.y === MIN_Y || s.y === MAX_Y;
    const inX = s.x >= MIN_X && s.x <= MAX_X;
    const inY = s.y >= MIN_Y && s.y <= MAX_Y;
    return onFixed && inX && inY;
  }

  it('spawns each square on an arena edge, inside the drawn border', () => {
    const { system } = makeSystem(
      makeShip(640, 360),
      new Pool(createBullet),
      seqRng([0.0, 0.1, 0.3, 0.4, 0.6, 0.7, 0.9, 0.95]),
    );
    system._spawnOne(); // top
    system._spawnOne(); // bottom
    system._spawnOne(); // left
    system._spawnOne(); // right

    const squares = activeSquares(system);
    expect(squares.length).toBe(4);
    for (const s of squares) {
      expect(onAnEdge(s)).toBe(true);
    }
  });

  it('places the top-edge square at y=MIN_Y with x in the free-axis range', () => {
    const { system } = makeSystem(
      makeShip(640, 360),
      new Pool(createBullet),
      seqRng([0.0, 0.5]),
    );
    system._spawnOne();
    const [s] = activeSquares(system);
    expect(s.y).toBe(MIN_Y);
    expect(s.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
  });
});

describe('GreenSquareSystem — pool prewarm (NFR2)', () => {
  it('prewarms the pool and recycles instances without growing (no allocation)', () => {
    const { system } = makeSystem(makeShip(640, 360));
    expect(system.enemyPool.freeCount).toBe(GREEN_SQUARE_POOL_PREWARM);
    expect(system.enemyPool.activeCount).toBe(0);

    for (let i = 0; i < GREEN_SQUARE_POOL_PREWARM; i++) system._spawnOne();

    expect(system.enemyPool.activeCount).toBe(GREEN_SQUARE_POOL_PREWARM);
    expect(system.enemyPool.freeCount).toBe(0);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      GREEN_SQUARE_POOL_PREWARM,
    );
  });

  it('does not grow the pool over many steady-state behavior/spawn steps', () => {
    // Run long enough to spawn a handful of squares; capacity must never exceed
    // the prewarm (no per-frame allocation once warm).
    const { system } = makeSystem(makeShip(640, 360));
    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      GREEN_SQUARE_POOL_PREWARM,
    );
    expect(system.enemyPool.activeCount).toBeGreaterThan(0); // did spawn
  });
});

describe('createGreenSquare factory', () => {
  it('returns a zeroed shape with radius, base score, and aggro=false', () => {
    const s = createGreenSquare();
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.radius).toBe(GREEN_SQUARE_RADIUS);
    expect(s.score).toBe(GREEN_SQUARE_SCORE);
    expect(s.aggro).toBe(false);
  });
});
