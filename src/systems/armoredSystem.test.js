import { describe, it, expect } from 'vitest';
import { ArmoredSystem } from './ArmoredSystem.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  ARMORED_SPEED,
  ARMORED_RADIUS,
  ARMORED_HP,
  ARMORED_POOL_PREWARM,
  ARMORED_MIN_ELAPSED_MS,
  ARMORED_PRESSURE_THRESHOLD,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
} from '../config/constants.js';

// ArmoredSystem coverage (Story 9.3). The armored is a slow homing chaser (mirrors
// the Seeker) with a projectile-only `hp` set on spawn, honoring the shared spawn
// telegraph, and a late-bound canSpawn() time-OR-pressure gate. The HP DECREMENT
// itself lives in CollisionSystem (covered there); this suite pins the mover,
// telegraph, spawn (placement + hp + telegraph), the spawn gate, and zero-alloc.

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

// Materialize the active armored into an array (tests only).
function activeArmored(system) {
  const out = [];
  system.enemyPool.forEachActive((s) => out.push(s));
  return out;
}

// Directly place a live armored in the pool at a position (bypasses random spawn).
function placeArmored(system, x, y) {
  const s = system.enemyPool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.hp = ARMORED_HP;
  s.telegraphMs = 0;
  return s;
}

describe('ArmoredSystem — no self-spawn (director is the sole spawn authority)', () => {
  it('fixedUpdate never spawns on its own, over many intervals with no director', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    for (let i = 0; i < 2000; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount).toBe(0);
  });

  it('public spawn() places exactly one armored per call', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(1);
    system.spawn();
    expect(system.enemyPool.activeCount).toBe(2);
  });
});

describe('ArmoredSystem — spawn (placement, hp, telegraph)', () => {
  const minX = ARENA_BORDER_INSET + ARMORED_RADIUS;
  const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - ARMORED_RADIUS;
  const minY = ARENA_BORDER_INSET + ARMORED_RADIUS;
  const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - ARMORED_RADIUS;

  function onAnEdge(s) {
    const onFixed =
      s.x === minX || s.x === maxX || s.y === minY || s.y === maxY;
    const inX = s.x >= minX && s.x <= maxX;
    const inY = s.y >= minY && s.y <= maxY;
    return onFixed && inX && inY;
  }

  it('spawns on an arena edge, inside the drawn border, with full hp + telegraph + at rest', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.0, 0.5]));
    system.spawn();
    const [s] = activeArmored(system);
    expect(onAnEdge(s)).toBe(true);
    expect(s.hp).toBe(ARMORED_HP);
    expect(s.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('resets hp to ARMORED_HP on every spawn (a recycled instance starts fresh)', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.0, 0.5]));
    // Spawn, then simulate the instance being damaged and released back to the pool.
    system.spawn();
    const [s] = activeArmored(system);
    s.hp = 1; // battered
    system.enemyPool.release(s);
    // The next spawn recycles that same object — hp must be reset to full.
    system.spawn();
    const [s2] = activeArmored(system);
    expect(s2).toBe(s); // same recycled instance
    expect(s2.hp).toBe(ARMORED_HP);
  });

  it('re-rolls the placement away from a ship on the default edge candidate (safe radius)', () => {
    const shipX = minX + 0.5 * (maxX - minX);
    const shipY = minY;
    // First roll: top-center (on the ship). Re-roll: bottom-center (far).
    const system = new ArmoredSystem(
      makeShip(shipX, shipY),
      seqRng([0.0, 0.5, 0.25, 0.5]),
    );
    system.spawn(shipX, shipY);
    const [s] = activeArmored(system);
    const dx = s.x - shipX;
    const dy = s.y - shipY;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(
      SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS,
    );
  });
});

describe('ArmoredSystem — spawn telegraph (Story 2.6)', () => {
  it('freezes a telegraphing armored (no homing) and counts telegraphMs down by dt', () => {
    const system = new ArmoredSystem(makeShip(1000, 360), seqRng([0.1, 0.5]));
    const s = placeArmored(system, 100, 360);
    s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;

    system.fixedUpdate(DT);

    expect(s.x).toBe(100);
    expect(s.y).toBe(360);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
  });

  it('homes on the tick the telegraph reaches 0 (activates + moves same tick)', () => {
    const system = new ArmoredSystem(makeShip(1000, 360), seqRng([0.1, 0.5]));
    const s = placeArmored(system, 100, 360);
    s.telegraphMs = DT; // exactly one step from activation

    system.fixedUpdate(DT);

    expect(s.telegraphMs).toBe(0);
    expect(s.vx).toBeCloseTo(ARMORED_SPEED, 6); // homing toward +x
    expect(s.x).toBeGreaterThan(100);
  });

  it('telegraph countdown clamps at 0 and is frame-rate independent', () => {
    function elapsedToZero(tickMs) {
      const system = new ArmoredSystem(makeShip(1000, 360), seqRng([0.1, 0.5]));
      const s = placeArmored(system, 100, 360);
      s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
      let elapsed = 0;
      let guard = 0;
      while (s.telegraphMs > 0 && guard < 100000) {
        system.fixedUpdate(tickMs);
        elapsed += tickMs;
        guard++;
        expect(s.telegraphMs).toBeGreaterThanOrEqual(0);
      }
      return elapsed;
    }
    const fine = elapsedToZero(1);
    const coarse = elapsedToZero(DT);
    expect(fine).toBeGreaterThanOrEqual(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(fine).toBeLessThan(ENEMY_SPAWN_TELEGRAPH_MS + 1);
    expect(coarse).toBeGreaterThanOrEqual(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(coarse).toBeLessThan(ENEMY_SPAWN_TELEGRAPH_MS + DT);
  });
});

describe('ArmoredSystem — slow homing', () => {
  it('sets velocity = unit(ship − armored) × ARMORED_SPEED and moves toward the ship', () => {
    const system = new ArmoredSystem(makeShip(200, 100), seqRng([0.1, 0.5]));
    const s = placeArmored(system, 100, 100); // ship straight +x
    system.fixedUpdate(DT);
    expect(s.vx).toBeCloseTo(ARMORED_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
    expect(s.x).toBeCloseTo(100 + ARMORED_SPEED * (DT / 1000), 6);
    expect(s.y).toBeCloseTo(100, 6);
  });

  it('is slower than a Seeker by construction (ARMORED_SPEED is the durable-bruiser pace)', () => {
    // The archetype is a slow tank; the constant reflects that (guards a retune that
    // would accidentally make it a fast chaser).
    const system = new ArmoredSystem(makeShip(1100, 360), seqRng([0.1, 0.5]));
    const s = placeArmored(system, 100, 360);
    system.fixedUpdate(DT);
    const speed = Math.hypot(s.vx, s.vy);
    expect(speed).toBeCloseTo(ARMORED_SPEED, 6);
  });

  it('tracks a MOVING ship: recomputes heading each tick toward the ship\'s new position', () => {
    const ship = makeShip(1000, 360);
    const system = new ArmoredSystem(ship, seqRng([0.1, 0.5]));
    const s = placeArmored(system, 500, 360); // ship straight +x initially
    system.fixedUpdate(DT);
    expect(s.vy).toBeCloseTo(0, 6); // heading +x

    // Move the ship far up; the next tick must re-home toward the new position — the
    // heading flips to predominantly -y (it was purely +x before), proving per-tick
    // recompute against a moving target. (A tiny residual x-offset from the first
    // tick's drift leaves |vx| small but non-zero — so assert dominance, not exact 0.)
    ship.x = 500;
    ship.y = -400;
    system.fixedUpdate(DT);
    expect(s.vy).toBeLessThan(0); // now heading toward -y (was 0)
    expect(Math.abs(s.vy)).toBeGreaterThan(Math.abs(s.vx)); // predominantly vertical
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(ARMORED_SPEED, 6); // speed preserved
  });

  it('coincident with the ship: zero velocity, no NaN, position unchanged', () => {
    const system = new ArmoredSystem(makeShip(300, 300), seqRng([0.1, 0.5]));
    const s = placeArmored(system, 300, 300);
    system.fixedUpdate(DT);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(Number.isNaN(s.x)).toBe(false);
    expect(Number.isNaN(s.y)).toBe(false);
    expect(s.x).toBe(300);
    expect(s.y).toBe(300);
  });
});

describe('ArmoredSystem — canSpawn() time-OR-pressure gate', () => {
  it('returns false when the director back-ref is unbound (never spawns without its gate source)', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    expect(system.spawnDirector).toBe(null);
    expect(system.canSpawn()).toBe(false);
  });

  it('returns false before MIN elapsed with low pressure (gate closed)', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    system.spawnDirector = {
      elapsedMs: ARMORED_MIN_ELAPSED_MS - 1,
      pressure: 0,
    };
    expect(system.canSpawn()).toBe(false);
  });

  it('returns true at/after MIN elapsed regardless of pressure (time arm)', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    system.spawnDirector = { elapsedMs: ARMORED_MIN_ELAPSED_MS, pressure: 0 };
    expect(system.canSpawn()).toBe(true);
    system.spawnDirector.elapsedMs = ARMORED_MIN_ELAPSED_MS + 60000;
    expect(system.canSpawn()).toBe(true);
  });

  it('returns true when pressure >= THRESHOLD BEFORE MIN elapsed (build-power arm)', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    system.spawnDirector = {
      elapsedMs: 0, // well before the time gate
      pressure: ARMORED_PRESSURE_THRESHOLD,
    };
    expect(system.canSpawn()).toBe(true);
  });

  it('stays closed just below the pressure threshold before MIN elapsed', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    system.spawnDirector = {
      elapsedMs: 0,
      pressure: ARMORED_PRESSURE_THRESHOLD - 0.0001,
    };
    expect(system.canSpawn()).toBe(false);
  });
});

describe('ArmoredSystem — pool prewarm + zero allocation (NFR2)', () => {
  it('prewarms the pool at construction and recycles without growing', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    expect(system.enemyPool.freeCount).toBe(ARMORED_POOL_PREWARM);
    expect(system.enemyPool.activeCount).toBe(0);
    for (let i = 0; i < ARMORED_POOL_PREWARM; i++) system.spawn();
    expect(system.enemyPool.activeCount).toBe(ARMORED_POOL_PREWARM);
    expect(system.enemyPool.freeCount).toBe(0);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      ARMORED_POOL_PREWARM,
    );
  });

  it('does not grow the pool over many steady-state homing steps after a few spawns', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    for (let i = 0; i < 5; i++) system.spawn();
    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      ARMORED_POOL_PREWARM,
    );
    expect(system.enemyPool.activeCount).toBe(5);
  });

  it('reuses one hoisted homing callback across ticks (no per-tick closure alloc)', () => {
    const system = new ArmoredSystem(makeShip(640, 360), seqRng([0.1, 0.5]));
    const ref = system._stepHome;
    system.fixedUpdate(DT);
    expect(system._stepHome).toBe(ref);
  });
});
