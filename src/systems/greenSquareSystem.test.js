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
  GREEN_SQUARE_POOL_PREWARM,
  GREEN_SQUARE_SCORE,
  GREEN_SQUARE_XP,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
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

  it('bounces off the −y wall: clamps position, reflects vy', () => {
    // dtSec = FIXED_STEP_MS / 1000 ≈ 0.0167 → displacement = 120 * 0.0167 ≈ 2px/frame.
    // Ship at bottom → square flees UP (−y). Start y=40, y = 40−2 = 38 < MIN_Y(39).
    const ship = makeShip(780, 720);
    let sys = new GreenSquareSystem(ship, new Pool(createBullet), seqRng([0.1, 0.5]));
    let s = placeSquare(sys, 780, 40);
    sys.fixedUpdate(DT);

    expect(s.y).toBe(MIN_Y);
    expect(s.vx).toBeCloseTo(0, 6);
    expect(s.vy).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6);
  });

  it('bounces off the +x wall: clamps position, reflects vx', () => {
    // Start x=MAX_X(1521)−1=1520, +2px → 1522 > 1521 → clamped.
    const ship = makeShip(640, 360);
    let sys = new GreenSquareSystem(ship, new Pool(createBullet), seqRng([0.1, 0.5]));
    let s = placeSquare(sys, 1520, 360);
    sys.fixedUpdate(DT);

    expect(s.x).toBe(MAX_X);
    expect(s.vx).toBeCloseTo(-GREEN_SQUARE_FLEE_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6);
  });

  it('bounces off the +y wall: reflects vy inward', () => {
    // Ship at y=38 above square. Square near top wall flees +y, reflects inward.
    const ship = makeShip(780, 38);
    let sys = new GreenSquareSystem(ship, new Pool(createBullet), seqRng([0.1, 0.5]));
    let s = placeSquare(sys, 780, MAX_Y - 0.5);
    sys.fixedUpdate(DT);

    expect(s.y).toBe(MAX_Y);
    expect(s.vy).toBeCloseTo(-GREEN_SQUARE_FLEE_SPEED, 6); // reflected inward
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6);
  });

  it('bounces off the −x wall: reflects vx inward', () => {
    // Ship far right → square flees −x, hits left wall, vx reflected inward.
    const ship = makeShip(1550, 360);
    let sys = new GreenSquareSystem(ship, new Pool(createBullet), seqRng([0.1, 0.5]));
    let s = placeSquare(sys, MIN_X + 0.5, 360);
    sys.fixedUpdate(DT);

    expect(s.x).toBe(MIN_X);
    expect(s.vx).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6); // reflected inward (+x)
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(GREEN_SQUARE_FLEE_SPEED, 6);
  });

  it('corner bounce: both axes reflect independently', () => {
    // Ship in bottom-left → flee heads +x, +y from top-right corner area.
    const ship = makeShip(MIN_X, MIN_Y);
    let sys = new GreenSquareSystem(ship, new Pool(createBullet), seqRng([0.1, 0.5]));
    // Start near top-right, fleeing +x, +y.
    let sq = placeSquare(sys, MAX_X - 0.5, MAX_Y - 0.5);
    sys.fixedUpdate(DT);

    expect(sq.x).toBe(MAX_X);
    expect(sq.y).toBe(MAX_Y);
    // Both components reflected (flee was +x, +y; now −x, −y pointing inward).
    expect(sq.vx).toBeLessThan(0);
    expect(sq.vy).toBeLessThan(0);
  });

  it('aggressive chase: reflects off wall instead of parking against it', () => {
    // Ship at right → chase +x. When square reaches right wall, it bounces back.
    const { system } = makeSystem(makeShip(ARENA_WIDTH - 10, ARENA_HEIGHT / 2));
    const s = placeSquare(system, MAX_X - 0.5, ARENA_HEIGHT / 2, true);
    // Chase velocity is toward ship (+x, 0 from center).
    system.fixedUpdate(DT);

    expect(s.x).toBe(MAX_X);
    expect(s.vx).toBeLessThan(0); // bounced back (was positive, now negative)
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

describe('GreenSquareSystem — spawn telegraph (Story 2.6)', () => {
  it('spawn() sets telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS and starts fleeing/at rest', () => {
    const { system } = makeSystem(makeShip(640, 360));
    system.spawn();
    const [s] = activeSquares(system);
    expect(s.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(s.aggro).toBe(false);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('freezes a telegraphing square: no aggro latch, no move, counts down by dt', () => {
    const ship = makeShip(400, 100);
    const bulletPool = new Pool(createBullet);
    const { system } = makeSystem(ship, bulletPool);
    const s = placeSquare(system, 100, 100);
    s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
    // A bullet inside the threat radius that WOULD provoke an active square.
    addBullet(bulletPool, 100 + GREEN_SQUARE_THREAT_RADIUS - 1, 100);

    system.fixedUpdate(DT);

    // No latch, no movement — frozen while telegraphing; only the countdown moved.
    expect(s.aggro).toBe(false);
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
  });

  it('behaves normally on the tick the telegraph reaches 0 (AC2)', () => {
    const { system } = makeSystem(makeShip(300, 100));
    const s = placeSquare(system, 100, 100); // ship +x → flees −x once active
    s.telegraphMs = DT;

    system.fixedUpdate(DT);

    expect(s.telegraphMs).toBe(0);
    expect(s.vx).toBeCloseTo(-GREEN_SQUARE_FLEE_SPEED, 6); // fleeing this same tick
    expect(s.x).toBeLessThan(100);
  });

  it('spawn-point avoidance: re-rolls the placement away from a ship on the default candidate (AC3)', () => {
    const minX = ARENA_BORDER_INSET + GREEN_SQUARE_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - GREEN_SQUARE_RADIUS;
    const minY = ARENA_BORDER_INSET + GREEN_SQUARE_RADIUS;
    const shipX = minX + 0.5 * (maxX - minX);
    const shipY = minY;
    const { system } = makeSystem(
      makeShip(shipX, shipY),
      new Pool(createBullet),
      seqRng([0.0, 0.5, 0.25, 0.5]), // top-center (on ship) → re-roll → bottom-center
    );
    system.spawn(shipX, shipY);
    const [s] = activeSquares(system);
    const dx = s.x - shipX;
    const dy = s.y - shipY;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
  });
});

describe('GreenSquareSystem — no self-spawn + public spawn', () => {
  it('fixedUpdate never spawns on its own, over many intervals with no director', () => {
    const { system } = makeSystem(makeShip(640, 360));
    for (let i = 0; i < 2000; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount).toBe(0);
  });

  it('public spawn() places exactly one square per call', () => {
    const { system } = makeSystem(makeShip(640, 360));
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(1);
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(2);
  });

  it('each spawned square starts non-aggressive (fleeing)', () => {
    const { system } = makeSystem(makeShip(640, 360));
    system.spawn();
    const [s] = activeSquares(system);
    expect(s.aggro).toBe(false);
  });

  it('a recycled instance that was aggressive respawns fleeing (aggro reset)', () => {
    // Provoke a square to aggro=true, release it back to the pool, then spawn —
    // the recycled instance must come back fleeing. Pins the `s.aggro = false`
    // reset in spawn() (a fresh pool's instances are already false from the
    // factory, so the spawn-aggro test above cannot catch a dropped reset).
    const { system } = makeSystem(makeShip(640, 360));
    const s = placeSquare(system, 100, 100, /*aggro*/ true);
    expect(s.aggro).toBe(true);
    system.enemyPool.release(s);
    system.spawn();
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
    system.spawn(); // top
    system.spawn(); // bottom
    system.spawn(); // left
    system.spawn(); // right

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
    system.spawn();
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

    for (let i = 0; i < GREEN_SQUARE_POOL_PREWARM; i++) system.spawn();

    expect(system.enemyPool.activeCount).toBe(GREEN_SQUARE_POOL_PREWARM);
    expect(system.enemyPool.freeCount).toBe(0);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      GREEN_SQUARE_POOL_PREWARM,
    );
  });

  it('does not grow the pool over many steady-state behavior steps after a few spawns', () => {
    // Spawn a handful (the director's job), then run behavior steps; capacity must
    // never exceed the prewarm (no per-frame allocation once warm).
    const { system } = makeSystem(makeShip(640, 360));
    for (let i = 0; i < 5; i++) system.spawn();
    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      GREEN_SQUARE_POOL_PREWARM,
    );
    expect(system.enemyPool.activeCount).toBe(5); // no self-spawn added any
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
    expect(s.xp).toBe(GREEN_SQUARE_XP); // base per-type XP (Story 8.1)
    expect(s.aggro).toBe(false);
    expect(s.telegraphMs).toBe(0); // spawned-and-active default (Story 2.6)
  });
});

describe('GreenSquareSystem — stun freeze (Story 11.9)', () => {
  it('freezes a stunned square: no move, velocity zeroed, counts down stunMs by dt', () => {
    const { system } = makeSystem(makeShip(400, 100));
    const s = placeSquare(system, 100, 100);
    s.stunMs = 2000;

    system.fixedUpdate(DT);

    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.stunMs).toBeCloseTo(2000 - DT, 6);
  });
});
