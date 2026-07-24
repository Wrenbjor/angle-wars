import { describe, it, expect } from 'vitest';
import { SeekerDroneSystem } from './SeekerDroneSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createArmored } from '../entities/Armored.js';
import { createBullet } from '../entities/Bullet.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import {
  FIXED_STEP_MS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SEEKER_DRONE_ORBIT_RADIUS,
  SEEKER_DRONE_ROTATE_PERIOD_MS,
  SEEKER_DRONE_MAX_COUNT,
  SEEKER_DRONE_BASE_DAMAGE,
  SEEKER_DRONE_BASE_PERIOD_MS,
  SEEKER_DRONE_PERIOD_FLOOR_MS,
  SEEKER_DRONE_POOL_PREWARM,
  SEEKER_DRONE_SHOT_POOL_PREWARM,
  SEEKER_DRONE_SHOT_SPEED,
  SEEKER_DRONE_SHOT_LIFETIME_MS,
  PLAYER_BULLET_BASE_DAMAGE,
  ARMORED_HP,
} from '../config/constants.js';

// Story 11.2 — SeekerDroneSystem owns the Seeker Drones' drone POOL + shot POOL + the
// per-drone fire accumulators + the ring's rotation PHASE, while the shared playerStats
// store owns only the derived count/damage/period/homing. This suite covers the rows of
// the story's I/O matrix that belong to this system: the count sync, the ring geometry, the
// per-drone fire cadence at the nearest enemy, the straight/homing shot flight, the shot↔
// enemy sweep through applyPlayerDamage (including the armored projectile-resistance
// contrast), the hit-once guard, the lifetime cap, the junk sanitizers, and the
// steady-state zero-allocation invariant. The registration-slot + assembled-pipeline wiring
// lives in buildArenaWorld.test.js.

const DT = FIXED_STEP_MS;

// The per-level fold maps the real registry produces (pinned against the registry itself in
// playerStats.test.js — restated here as the system's input vocabulary).
const LV1 = { seekerDroneCount: 1, seekerDroneDamage: 3, seekerDronePeriodMs: 1500 };
const LV3 = { seekerDroneCount: 3, seekerDroneDamage: 3, seekerDronePeriodMs: 1071 };
const LV4 = {
  seekerDroneCount: 4,
  seekerDroneDamage: 3,
  seekerDronePeriodMs: 1071,
  seekerDroneHoming: 1,
};
const LV5 = {
  seekerDroneCount: 5,
  seekerDroneDamage: 4.8,
  seekerDronePeriodMs: 1071,
  seekerDroneHoming: 1,
};

/**
 * A seeker-drone system over a fresh centred ship, the given enemy pools, a real
 * CollisionSystem seam, and a real player-stat store seeded with the given fold fields
 * (the shape `recomputePlayerStats` produces). `stats === null` means NO store (the
 * pre-story path).
 */
function makeSystem(stats = {}, pools) {
  const ship = createPlayerShip();
  ship.x = ARENA_WIDTH / 2;
  ship.y = ARENA_HEIGHT / 2;
  const enemyPools = pools ?? [new Pool(createSeeker)];
  const collisionSystem = new CollisionSystem(new Pool(createBullet), enemyPools);
  const playerStats = stats === null ? null : { ...createPlayerStats(), ...stats };
  const system = new SeekerDroneSystem(ship, enemyPools, collisionSystem, playerStats);
  return { ship, enemyPools, enemyPool: enemyPools[0], collisionSystem, playerStats, system };
}

function addEnemy(pool, x, y, { telegraphMs = 0, hp } = {}) {
  const e = pool.acquire();
  e.x = x;
  e.y = y;
  e.vx = 0;
  e.vy = 0;
  e.telegraphMs = telegraphMs;
  if (hp !== undefined) e.hp = hp;
  return e;
}

function activeDrones(system) {
  const out = [];
  system.pool.forEachActive((d) => out.push(d));
  return out;
}

function isActive(pool, target) {
  let found = false;
  pool.forEachActive((e) => {
    if (e === target) found = true;
  });
  return found;
}

function isShotActive(system, target) {
  let found = false;
  system.shotPool.forEachActive((s) => {
    if (s === target) found = true;
  });
  return found;
}

/** Inject a stamped shot directly into the shot pool (white-box, for the flight paths). */
function injectShot(system, { x, y, vx = 0, vy = 0, homing = 0, damage = 3 }) {
  const shot = system.shotPool.acquire();
  shot.x = x;
  shot.y = y;
  shot.vx = vx;
  shot.vy = vy;
  shot.homing = homing;
  shot.damage = damage;
  shot.ageMs = 0;
  return shot;
}

describe('SeekerDroneSystem — count sync from the fold', () => {
  it('an unowned build spawns NO drones, NO shots and never touches an enemy', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem();
    const e = addEnemy(enemyPool, ship.x + 100, ship.y);
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
    expect(system.shotPool.activeCount).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).toHaveLength(0);
    expect(collisionSystem.bulletDamageCount).toBe(0);
  });

  it('a NULL store means no drones/shots ever, no throw (the pre-11.2 path)', () => {
    const { enemyPool, system, ship } = makeSystem(null);
    expect(system.playerStats).toBeNull();
    const e = addEnemy(enemyPool, ship.x + 100, ship.y);
    expect(() => {
      for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
    expect(system.shotPool.activeCount).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
  });

  it('Lv1 → exactly one drone at the ring radius', () => {
    const { ship, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    const [d] = activeDrones(system);
    expect(Math.hypot(d.x - ship.x, d.y - ship.y)).toBeCloseTo(
      SEEKER_DRONE_ORBIT_RADIUS,
      9,
    );
  });

  it('Lv3 → three drones evenly spaced ~2π/3 apart at the ring radius', () => {
    const { ship, system } = makeSystem(LV3);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(3);
    const drones = activeDrones(system);
    for (const d of drones) {
      expect(Math.hypot(d.x - ship.x, d.y - ship.y)).toBeCloseTo(
        SEEKER_DRONE_ORBIT_RADIUS,
        9,
      );
    }
    const angles = drones
      .map((d) => Math.atan2(d.y - ship.y, d.x - ship.x))
      .map((a) => (a < 0 ? a + Math.PI * 2 : a))
      .sort((p, q) => p - q);
    expect(angles[1] - angles[0]).toBeCloseTo((2 * Math.PI) / 3, 6);
    expect(angles[2] - angles[1]).toBeCloseTo((2 * Math.PI) / 3, 6);
  });

  it('a level RISE 1→5 mid-run reaches 5 drones with no factory allocation (prewarmed)', () => {
    const { playerStats, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    const total = system.pool.activeCount + system.pool.freeCount;
    expect(total).toBe(SEEKER_DRONE_POOL_PREWARM);

    Object.assign(playerStats, LV5); // the Lv5 pick folds
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(5);
    // No factory call — total capacity is still exactly the prewarm.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(total);
  });

  it('a level DROP releases the surplus drones back to the pool', () => {
    const { playerStats, system } = makeSystem(LV5);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(5);
    const total = system.pool.activeCount + system.pool.freeCount;

    Object.assign(playerStats, LV1); // remnant/drop to a single drone
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    // Released, not destroyed: the surplus went back to the free list.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(total);

    // …and all the way to nothing owned.
    Object.assign(playerStats, { seekerDroneCount: 0 });
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });

  it('the ring TRACKS a moving ship — drones re-centre on the ship each tick', () => {
    const { ship, system } = makeSystem(LV3);
    system.fixedUpdate(DT);
    ship.x += 137;
    ship.y -= 89;
    system.fixedUpdate(DT);
    const drones = activeDrones(system);
    expect(drones).toHaveLength(3);
    for (const d of drones) {
      expect(Math.hypot(d.x - ship.x, d.y - ship.y)).toBeCloseTo(
        SEEKER_DRONE_ORBIT_RADIUS,
        9,
      );
    }
  });

  it('fresh drones seed their fire accumulators STAGGERED across [0, period) (not all at once)', () => {
    // A count sync seeds each fresh drone's fireAccumMs at (idx/count)·period, so growing
    // the count does not burst-fire every drone the same tick. Reverting the seed to 0
    // would make every value equal — this observes the spread.
    const { system } = makeSystem(LV5); // 5 drones, no enemies (so nothing fires)
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(5);
    const period = LV5.seekerDronePeriodMs; // 1071
    const accums = activeDrones(system).map((d) => d.fireAccumMs);
    // All in [0, period), none banked past a period…
    for (const a of accums) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(period);
    }
    // …the values are DISTINCT (a Set of 5), not all equal / not all 0…
    expect(new Set(accums).size).toBe(5);
    // …and genuinely SPREAD across the window, not clustered at one value.
    expect(Math.max(...accums) - Math.min(...accums)).toBeGreaterThan(period * 0.5);
  });
});

describe('SeekerDroneSystem — fire cadence + shot kill through applyPlayerDamage', () => {
  it('Lv1 with one enemy fires within ~1.5s a shot that kills it (scored + reported)', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 100, ship.y);
    // ~90 ticks to reach the 1500ms fire period, then the straight shot travels ~100px
    // (700px/s → ~9 ticks) to a stationary enemy. 200 ticks is comfortably enough.
    let killed = false;
    for (let i = 0; i < 200 && !killed; i++) {
      system.fixedUpdate(DT);
      killed = !isActive(enemyPool, e);
    }
    expect(killed).toBe(true);
    expect(collisionSystem.killedEnemies).toContain(e);
    expect(collisionSystem.bulletKillCount).toBe(1);
  });

  it('a shot spawns from a drone (not the ship nose) and flies toward the enemy', () => {
    const { enemyPool, system, ship } = makeSystem(LV1);
    addEnemy(enemyPool, ship.x + 300, ship.y);
    // Run until the first shot exists, then verify it left a drone position (not the ship).
    let shot = null;
    for (let i = 0; i < 200 && !shot; i++) {
      system.fixedUpdate(DT);
      system.shotPool.forEachActive((s) => {
        if (!shot) shot = s;
      });
    }
    expect(shot).not.toBeNull();
    // A straight (non-homing) shot toward an enemy on the +x axis travels rightward.
    expect(shot.vx).toBeGreaterThan(0);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(SEEKER_DRONE_SHOT_SPEED, 4);
  });

  it('a drone pressed OUTSIDE the arena (wall-hugging ship) still lands a hit on an interior enemy', () => {
    // The ring radius (72) exceeds the ship's ~40px wall clamp, so a wall-pressed ship puts
    // the wall-side drone OUTSIDE the arena. The step-6 spawn clamps the shot origin back
    // into the interior and aims from there, so the shot is not immediately released
    // off-arena and still connects — without the clamp the wall-side drones fire blanks.
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    ship.x = 60; // pressed to the LEFT wall (ring reaches x = 60 − 72 = −12, outside)
    const e = addEnemy(enemyPool, ship.x + 100, ship.y); // interior enemy to the right
    system.fixedUpdate(DT); // create the drone
    // Force the single drone onto the wall side (angle ≈ π → left of ship, outside) and
    // prime it to fire this tick.
    system._phaseRad = Math.PI;
    const [d] = activeDrones(system);
    d.fireAccumMs = LV1.seekerDronePeriodMs; // one full period of banked credit → fires now
    system.fixedUpdate(DT);
    // The drone really did sit outside the arena when it fired…
    expect(d.x).toBeLessThan(ARENA_BORDER_INSET);
    // …yet a shot exists (the origin was clamped in-bounds, not born off-arena)…
    expect(system.shotPool.activeCount).toBeGreaterThanOrEqual(1);
    // …and it flies in-bounds toward the interior enemy and kills it (not released off-arena).
    let killed = false;
    for (let i = 0; i < 60 && !killed; i++) {
      system.fixedUpdate(DT);
      killed = !isActive(enemyPool, e);
    }
    expect(killed).toBe(true);
    expect(collisionSystem.killedEnemies).toContain(e);
  });

  it('holds fire with no live enemy — no shot, no throw, no unbounded accumulator', () => {
    const { system } = makeSystem(LV5); // 5 drones, empty arena
    expect(() => {
      for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.shotPool.activeCount).toBe(0);
    // Each drone's fire accumulator is clamped to the period — never banked unbounded.
    for (const d of activeDrones(system)) {
      expect(d.fireAccumMs).toBeLessThanOrEqual(1071 + 1e-9);
    }
  });

  it('an ARMORED (finite hp) RESISTS a drone shot — hp chipped, shot consumed, not one-shot', () => {
    // The melee/AoE items one-shot the armored; a drone shot is a PROJECTILE, so the armored
    // resists it exactly as it resists a bullet. Inject a shot ON the armored so the sweep
    // resolves deterministically on the next tick.
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system, ship } = makeSystem(LV1, [armoredPool]);
    const a = addEnemy(armoredPool, ship.x, ship.y, { hp: ARMORED_HP });
    const shot = injectShot(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, damage: 3 });
    system.fixedUpdate(DT);
    // hp 5 − 3 = 2 → survives; the shot is consumed (a hit always consumes the shot).
    expect(isActive(armoredPool, a)).toBe(true);
    expect(a.hp).toBe(ARMORED_HP - 3);
    expect(isShotActive(system, shot)).toBe(false);
    expect(collisionSystem.killedEnemies).not.toContain(a);
    expect(collisionSystem.bulletDamageCount).toBe(1);
  });

  it('the folded per-shot DAMAGE flows through the seam (−3 at Lv1, −4.8 at Lv5)', () => {
    for (const [stats, dmg] of [
      [LV1, 3],
      [LV5, 4.8],
    ]) {
      const armoredPool = new Pool(createArmored);
      const { system, ship } = makeSystem(stats, [armoredPool]);
      const a = addEnemy(armoredPool, ship.x, ship.y, { hp: 1e6 });
      injectShot(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, damage: dmg });
      system.fixedUpdate(DT);
      expect(a.hp, `${dmg} damage`).toBeCloseTo(1e6 - dmg, 6);
      expect(isActive(armoredPool, a)).toBe(true);
    }
  });

  it('NEVER targets NOR hits a telegraphing (spawning-in) enemy', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 100, ship.y, { telegraphMs: 1e6 });
    // Even a shot placed right on the telegraphing enemy must not hit it.
    injectShot(system, { x: ship.x + 100, y: ship.y, vx: 0, vy: 0, damage: 3 });
    for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).not.toContain(e);
    expect(collisionSystem.bulletDamageCount).toBe(0);
    // …and with the only enemy telegraphing, the drone found no target and fired nothing new.
  });

  it('reaches every combat pool it was given (one shared collector)', () => {
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const { collisionSystem, system, ship } = makeSystem(LV1, [seekers, squares]);
    const s = addEnemy(seekers, ship.x, ship.y);
    const q = addEnemy(squares, ship.x + 1, ship.y);
    // Two shots, one on each archetype, so both routes are exercised the same tick.
    injectShot(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, damage: 3 });
    injectShot(system, { x: ship.x + 1, y: ship.y, vx: 0, vy: 0, damage: 3 });
    system.fixedUpdate(DT);
    expect(isActive(seekers, s)).toBe(false);
    expect(isActive(squares, q)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(s);
    expect(collisionSystem.killedEnemies).toContain(q);
  });

  it('the melee-vs-projectile contrast: matches a bullet against the armored', () => {
    // A single 1-damage bullet leaves the armored alive — the same shared seam, the same
    // armored, the projectile damage model a drone shot shares.
    const armoredPool = new Pool(createArmored);
    const { collisionSystem } = makeSystem(LV1, [armoredPool]);
    const a = armoredPool.acquire();
    a.hp = ARMORED_HP;
    const killed = collisionSystem.applyPlayerDamage(a, armoredPool, PLAYER_BULLET_BASE_DAMAGE);
    expect(killed).toBe(false);
    expect(a.hp).toBe(ARMORED_HP - 1);
  });
});

describe('SeekerDroneSystem — homing shots (Lv4+)', () => {
  it('a homing shot re-points its velocity toward the nearest enemy each step', () => {
    const { enemyPool, system, ship } = makeSystem(LV4);
    // Enemy far to the LEFT; a shot at centre moving RIGHT must re-aim leftward this tick.
    addEnemy(enemyPool, ship.x - 300, ship.y);
    const shot = injectShot(system, {
      x: ship.x,
      y: ship.y,
      vx: SEEKER_DRONE_SHOT_SPEED,
      vy: 0,
      homing: 1,
      damage: 3,
    });
    system.fixedUpdate(DT);
    // Re-pointed toward the enemy (−x), at constant speed (EnemySystem's re-aim model).
    expect(shot.vx).toBeLessThan(0);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(SEEKER_DRONE_SHOT_SPEED, 6);
    expect(Number.isFinite(shot.x)).toBe(true);
    expect(Number.isFinite(shot.y)).toBe(true);
  });

  it('with NO live enemy a homing shot keeps its current velocity (flies straight on)', () => {
    const { system, ship } = makeSystem(LV4); // no enemies added
    const shot = injectShot(system, {
      x: ship.x,
      y: ship.y,
      vx: SEEKER_DRONE_SHOT_SPEED,
      vy: 0,
      homing: 1,
      damage: 3,
    });
    system.fixedUpdate(DT);
    expect(shot.vx).toBeCloseTo(SEEKER_DRONE_SHOT_SPEED, 6);
    expect(shot.vy).toBe(0);
  });

  it('a homing shot that never connects EXPIRES at the lifetime cap (live count bounded)', () => {
    // A stationary homing shot in the empty arena never leaves the arena, so ONLY the
    // lifetime cap can retire it — the load-bearing bound on a circling homing shot.
    const { system, ship } = makeSystem({ seekerDroneCount: 0, seekerDroneHoming: 1 });
    const shot = injectShot(system, {
      x: ship.x,
      y: ship.y,
      vx: 0,
      vy: 0,
      homing: 1,
      damage: 3,
    });
    const ticks = Math.floor(SEEKER_DRONE_SHOT_LIFETIME_MS / DT);
    for (let i = 0; i < ticks - 1; i++) system.fixedUpdate(DT);
    expect(isShotActive(system, shot)).toBe(true); // still inside the arena, under the cap
    for (let i = 0; i < 3; i++) system.fixedUpdate(DT);
    expect(isShotActive(system, shot)).toBe(false); // retired at the cap
  });

  it('a straight shot flying into a border is released off-arena BEFORE the lifetime cap', () => {
    // The isOutsideArena despawn path (distinct from the lifetime cap): a non-homing shot
    // just inside the right border, flying right, is released on the tick its center crosses
    // ARENA_BORDER_INSET — far short of SEEKER_DRONE_SHOT_LIFETIME_MS.
    const { system, ship } = makeSystem({ seekerDroneCount: 0 }); // no drones interfering
    const shot = injectShot(system, {
      x: ARENA_WIDTH - ARENA_BORDER_INSET - 6,
      y: ship.y,
      vx: SEEKER_DRONE_SHOT_SPEED,
      vy: 0,
      homing: 0,
      damage: 3,
    });
    const lifetimeTicks = Math.floor(SEEKER_DRONE_SHOT_LIFETIME_MS / DT);
    let ticks = 0;
    while (isShotActive(system, shot) && ticks < lifetimeTicks) {
      system.fixedUpdate(DT);
      ticks++;
    }
    expect(isShotActive(system, shot)).toBe(false);
    // Retired by crossing the border, NOT by ageing out — well under the lifetime cap.
    expect(ticks).toBeLessThan(lifetimeTicks);
    expect(shot.ageMs).toBeLessThan(SEEKER_DRONE_SHOT_LIFETIME_MS);
  });
});

describe('SeekerDroneSystem — hit-once guard', () => {
  it('two shots over one enemy the same tick hit it at most once (one consumed, one lives)', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x, ship.y); // unarmored → dies in one hit
    const shotA = injectShot(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, damage: 3 });
    const shotB = injectShot(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, damage: 3 });
    system.fixedUpdate(DT);
    // The enemy is killed exactly once…
    expect(isActive(enemyPool, e)).toBe(false);
    expect(collisionSystem.killedEnemies.filter((k) => k === e)).toHaveLength(1);
    expect(collisionSystem.bulletKillCount).toBe(1);
    // …one shot was consumed, the other found no unhit target and stays live.
    const aLive = isShotActive(system, shotA);
    const bLive = isShotActive(system, shotB);
    expect(aLive !== bLive).toBe(true); // exactly one of them survived
    expect(system.shotPool.activeCount).toBe(1);
  });
});

describe('SeekerDroneSystem — sanitizers (SAFETY guards, never balance levers)', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk count (%s) → no drones at all', (_label, v) => {
    const { system } = makeSystem({ ...LV1, seekerDroneCount: v });
    expect(() => {
      for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
  });

  it('a FRACTIONAL count is floored to whole drones', () => {
    const { system } = makeSystem({ ...LV1, seekerDroneCount: 3.7 });
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(3);
  });

  it('an ABSURD count clamps to SEEKER_DRONE_MAX_COUNT (the acquire loop stays bounded)', () => {
    const { system } = makeSystem({ ...LV1, seekerDroneCount: 1e9 });
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(SEEKER_DRONE_MAX_COUNT);
    expect(system._count()).toBe(SEEKER_DRONE_MAX_COUNT);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -5],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk damage (%s) → the base-damage fallback', (_label, v) => {
    const { system } = makeSystem({ ...LV1, seekerDroneDamage: v });
    expect(system._damage()).toBe(SEEKER_DRONE_BASE_DAMAGE);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -5],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk period (%s) → the base-period fallback, and the tick never throws/hangs', (_label, v) => {
    const { enemyPool, system, ship } = makeSystem({ ...LV1, seekerDronePeriodMs: v });
    addEnemy(enemyPool, ship.x + 100, ship.y);
    expect(system._periodMs()).toBe(SEEKER_DRONE_BASE_PERIOD_MS);
    expect(() => {
      for (let i = 0; i < 120; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    const [d] = activeDrones(system);
    expect(Number.isFinite(d.x)).toBe(true);
    expect(Number.isFinite(d.y)).toBe(true);
  });

  it.each([
    ['NaN', NaN],
    ['negative', -1],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk homing (%s) → homing OFF (straight shots)', (_label, v) => {
    const { system } = makeSystem({ ...LV4, seekerDroneHoming: v });
    expect(system._homing()).toBe(0);
  });

  it('a MISSING store (legacy stub) means no drones ever, no throw', () => {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const collisionSystem = new CollisionSystem(new Pool(createBullet), [enemyPool]);
    const system = new SeekerDroneSystem(ship, [enemyPool], collisionSystem);
    expect(system.playerStats).toBeNull();
    expect(() => {
      for (let i = 0; i < 100; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
    expect(system.shotPool.activeCount).toBe(0);
  });

  it('guards a null ship / pools / collisionSystem defensively (no-op, no throw)', () => {
    const playerStats = { ...createPlayerStats(), ...LV1 };
    const noShip = new SeekerDroneSystem(null, null, null, playerStats);
    expect(() => {
      for (let i = 0; i < 10; i++) noShip.fixedUpdate(DT);
    }).not.toThrow();
    // Drones are still synced to the count (the pool needs no ship), just not repositioned.
    expect(noShip.pool.activeCount).toBe(1);
  });
});

describe('SeekerDroneSystem — fire-period floor (SAFETY guard)', () => {
  it('a tiny-positive folded period does NOT burst-fire a drone in a single tick', () => {
    // Without the SEEKER_DRONE_PERIOD_FLOOR_MS clamp, a 0.5ms period makes the step-6
    // `while (fireAccumMs >= period)` loop run 1 + floor(dt/period) ≈ 34 iterations in ONE
    // tick — a same-tick shot burst that grows the shot pool past its prewarm. The floor
    // clamps the effective period above the fixed step, bounding a drone to ~1 shot/tick.
    const { enemyPool, system, ship } = makeSystem({ ...LV1, seekerDronePeriodMs: 0.5 });
    addEnemy(enemyPool, ship.x + 100, ship.y); // a target is present
    expect(system._periodMs()).toBe(SEEKER_DRONE_PERIOD_FLOOR_MS);
    system.fixedUpdate(DT); // one drone, one tick
    // A single tick spawns at most a handful of shots (in fact 0–1) — never a 30+ burst.
    expect(system.shotPool.activeCount).toBeLessThanOrEqual(4);
    // …and the shot pool never grew past its prewarm via the factory.
    expect(system.shotPool.activeCount + system.shotPool.freeCount).toBe(
      SEEKER_DRONE_SHOT_POOL_PREWARM,
    );
  });
});

describe('SeekerDroneSystem — targeting selects the nearest LIVE enemy', () => {
  it('a homing shot re-aims toward the NEARER of two enemies', () => {
    const { enemyPool, system, ship } = makeSystem(LV4);
    addEnemy(enemyPool, ship.x + 40, ship.y); // NEAR, to the right
    addEnemy(enemyPool, ship.x - 300, ship.y); // FAR, to the left
    const shot = injectShot(system, {
      x: ship.x,
      y: ship.y,
      vx: 0,
      vy: -SEEKER_DRONE_SHOT_SPEED, // moving up so it re-aims from a fresh heading
      homing: 1,
      damage: 3,
    });
    system.fixedUpdate(DT);
    // Nearest is the +40 enemy → re-aim toward +x (a flipped nearest comparison would send it
    // toward the −300 enemy, i.e. −x).
    expect(shot.vx).toBeGreaterThan(0);
  });

  it('the same shot re-aims the OTHER way when the near enemy is on the left', () => {
    const { enemyPool, system, ship } = makeSystem(LV4);
    addEnemy(enemyPool, ship.x - 40, ship.y); // NEAR, to the left now
    addEnemy(enemyPool, ship.x + 300, ship.y); // FAR, to the right
    const shot = injectShot(system, {
      x: ship.x,
      y: ship.y,
      vx: 0,
      vy: -SEEKER_DRONE_SHOT_SPEED,
      homing: 1,
      damage: 3,
    });
    system.fixedUpdate(DT);
    expect(shot.vx).toBeLessThan(0);
  });
});

describe('SeekerDroneSystem — the FOLD flows onto a really-fired shot (not just injected)', () => {
  it('a real drone stamps the folded HOMING flag and folded DAMAGE onto the shot it fires', () => {
    // Every homing/damage flight test injects a hand-stamped shot; this pins the fold → fire
    // wiring itself: a real drone reaching its cadence must stamp `homing` from `_homing()`
    // and `damage` from `_damage()` — dropping either would ship Lv4 flying straight / Lv5
    // dealing the base 3, while the injected-shot suite stayed green.
    const stats = {
      seekerDroneCount: 1,
      seekerDroneDamage: 4.8,
      seekerDronePeriodMs: 1071,
      seekerDroneHoming: 1,
    };
    const { enemyPool, system, ship } = makeSystem(stats);
    addEnemy(enemyPool, ship.x + 100, ship.y); // a target so the drone actually fires
    system.fixedUpdate(DT); // create the drone
    const [d] = activeDrones(system);
    d.fireAccumMs = stats.seekerDronePeriodMs; // prime to fire this tick
    system.fixedUpdate(DT);
    expect(system.shotPool.activeCount).toBeGreaterThanOrEqual(1);
    let fired = null;
    system.shotPool.forEachActive((s) => {
      if (!fired) fired = s;
    });
    expect(fired).not.toBeNull();
    expect(fired.homing).toBe(1); // flowed from _homing(), not left at the factory 0
    expect(fired.damage).toBeCloseTo(4.8, 6); // flowed from _damage(), not the base 3
  });
});

describe('SeekerDroneSystem — off-arena expiry on every border', () => {
  const cx = ARENA_WIDTH / 2;
  const cy = ARENA_HEIGHT / 2;
  const S = SEEKER_DRONE_SHOT_SPEED;
  it.each([
    ['right', ARENA_WIDTH - ARENA_BORDER_INSET - 6, cy, S, 0],
    ['left', ARENA_BORDER_INSET + 6, cy, -S, 0],
    ['top', cx, ARENA_BORDER_INSET + 6, 0, -S],
    ['bottom', cx, ARENA_HEIGHT - ARENA_BORDER_INSET - 6, 0, S],
  ])(
    'a shot exiting the %s border is released off-arena before the lifetime cap',
    (_side, x, y, vx, vy) => {
      const { system } = makeSystem({ seekerDroneCount: 0 }); // no drones interfering
      const shot = injectShot(system, { x, y, vx, vy, homing: 0, damage: 3 });
      const lifetimeTicks = Math.floor(SEEKER_DRONE_SHOT_LIFETIME_MS / DT);
      let ticks = 0;
      while (isShotActive(system, shot) && ticks < lifetimeTicks) {
        system.fixedUpdate(DT);
        ticks++;
      }
      expect(isShotActive(system, shot)).toBe(false);
      expect(ticks).toBeLessThan(lifetimeTicks); // retired by the border, not by ageing out
      expect(shot.ageMs).toBeLessThan(SEEKER_DRONE_SHOT_LIFETIME_MS);
    },
  );
});

describe('SeekerDroneSystem — allocation', () => {
  it('allocates nothing per tick at a fixed level (stable pools, hoisted collectors, reused scratch)', () => {
    // Survivors (huge-hp armored) around the ring so the drones fire continuously and the
    // shots are consumed on hit every eligible tick — a real hot path, not an idle loop.
    const armoredPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV5, [armoredPool]);
    for (const [dx, dy] of [
      [150, 0],
      [-150, 0],
      [0, 150],
      [0, -150],
      [120, 120],
      [-120, -120],
    ]) {
      addEnemy(armoredPool, ship.x + dx, ship.y + dy, { hp: 1e9 });
    }
    // Warm up (drone acquire + scratch growth + first fires).
    for (let i = 0; i < 130; i++) system.fixedUpdate(DT);

    const collectEnemy = system._collectEnemy;
    const collectDrone = system._collectDrone;
    const collectShot = system._collectShot;
    const enemiesRef = system._enemies;
    const ownersRef = system._owners;
    const activeDronesRef = system._activeDrones;
    const shotsRef = system._shots;
    const droneTotal = system.pool.activeCount + system.pool.freeCount;
    const shotTotal = system.shotPool.activeCount + system.shotPool.freeCount;
    const shape = Object.keys(system).sort();

    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);

    // The drone pool is stable (no acquire/release at a held level, no factory growth)…
    expect(system.pool.activeCount).toBe(5);
    expect(system.pool.activeCount + system.pool.freeCount).toBe(droneTotal);
    // …the shot pool churns (spawn/hit/expire) but never GROWS past the prewarm — active +
    // free stays constant, i.e. no factory allocation, and the live count stays bounded…
    expect(system.shotPool.activeCount + system.shotPool.freeCount).toBe(shotTotal);
    expect(shotTotal).toBe(SEEKER_DRONE_SHOT_POOL_PREWARM);
    expect(system.shotPool.activeCount).toBeLessThanOrEqual(SEEKER_DRONE_SHOT_POOL_PREWARM);
    // …the hoisted iteration callbacks are the SAME closures (never fresh arrows)…
    expect(system._collectEnemy).toBe(collectEnemy);
    expect(system._collectDrone).toBe(collectDrone);
    expect(system._collectShot).toBe(collectShot);
    // …the scratch arrays are the SAME references (length-reset in place, never realloc)…
    expect(system._enemies).toBe(enemiesRef);
    expect(system._owners).toBe(ownersRef);
    expect(system._activeDrones).toBe(activeDronesRef);
    expect(system._shots).toBe(shotsRef);
    // …and no field was added to the instance across the run.
    expect(Object.keys(system).sort()).toEqual(shape);
  });
});

describe('SeekerDroneSystem — fire CADENCE (the folded fire period is honored)', () => {
  // Measure the ticks a single fresh drone takes to fire its first shot from a ZEROED
  // accumulator — that count × DT is the effective fire period. Every drone is reset to 0
  // first, so the staggered acquire-seed can't shorten the measured interval. Without this,
  // the +40% fire-rate rung (Lv3: 1500 → 1071ms) is pinned only as a fold VALUE
  // (playerStats.test.js) and never exercised through step-6's `while (fireAccumMs >= period)`
  // gate — a regression that flattens or mis-scales the cadence would ship green (the
  // "kills within 200 ticks" test tolerates any period up to ~2.9s).
  function ticksToFirstShot(stats) {
    const { enemyPool, system, ship } = makeSystem(stats);
    addEnemy(enemyPool, ship.x + 200, ship.y); // a persistent in-bounds target
    system.fixedUpdate(DT); // create the drone(s)
    for (const d of activeDrones(system)) d.fireAccumMs = 0; // start every drone from 0
    let ticks = 0;
    while (system.shotPool.activeCount === 0 && ticks < 1000) {
      system.fixedUpdate(DT);
      ticks++;
    }
    return ticks;
  }

  it('Lv1 fires on its ~1500ms cadence and Lv3 on its faster ~1071ms (+40%) cadence', () => {
    const t1 = ticksToFirstShot(LV1);
    const t3 = ticksToFirstShot(LV3);
    // Effective period ≈ ticks × DT, within one tick of the folded period. This pins the
    // ABSOLUTE cadence: a "fire every tick" regression (≈16ms) or an "always base period"
    // regression (Lv3 firing at 1500, not 1071) both land far outside these one-tick windows.
    expect(t1 * DT).toBeGreaterThan(LV1.seekerDronePeriodMs - DT);
    expect(t1 * DT).toBeLessThanOrEqual(LV1.seekerDronePeriodMs + DT);
    expect(t3 * DT).toBeGreaterThan(LV3.seekerDronePeriodMs - DT);
    expect(t3 * DT).toBeLessThanOrEqual(LV3.seekerDronePeriodMs + DT);
    // …and the +40% rung is a STRICTLY faster cadence (fewer ticks between shots).
    expect(t3).toBeLessThan(t1);
  });
});

describe('SeekerDroneSystem — no-pierce (a shot damages at most ONE enemy)', () => {
  it('one shot overlapping TWO enemies kills only one; the other survives, the shot is consumed once', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    // Two unarmored enemies (each dies in one hit) at essentially the same point — a single
    // shot overlaps BOTH. The hit-once guard is per-ENEMY, so it alone does NOT stop one shot
    // from walking through several enemies; only the sweep `break` does. Removing that `break`
    // (pierce) would kill both here — a regression the two-shots-one-enemy test can't see.
    const e1 = addEnemy(enemyPool, ship.x, ship.y);
    const e2 = addEnemy(enemyPool, ship.x + 1, ship.y);
    const totalBefore = system.shotPool.activeCount + system.shotPool.freeCount;
    const shot = injectShot(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, damage: 3 });
    system.fixedUpdate(DT);
    // Exactly ONE of the two died — the shot did not pierce to the second.
    const e1Dead = !isActive(enemyPool, e1);
    const e2Dead = !isActive(enemyPool, e2);
    expect(e1Dead !== e2Dead).toBe(true);
    expect(collisionSystem.killedEnemies).toHaveLength(1);
    expect(collisionSystem.bulletKillCount).toBe(1);
    // The shot was consumed exactly once and returned to the pool — no double-release, no
    // pool-size drift.
    expect(isShotActive(system, shot)).toBe(false);
    expect(system.shotPool.activeCount).toBe(0);
    expect(system.shotPool.activeCount + system.shotPool.freeCount).toBe(totalBefore);
  });
});

describe('SeekerDroneSystem — decorative ring rotation', () => {
  it('the ring PHASE advances every tick around a stationary ship', () => {
    // One drone (Lv1) → its angle about the ship IS the ring phase, and with no enemy it never
    // fires to perturb its position. Deleting the `_phaseRad` advance (or breaking its wrap)
    // would FREEZE the ring at its initial angle with nothing else failing; this observes the
    // per-tick angular progression against SEEKER_DRONE_ROTATE_PERIOD_MS.
    const { ship, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    const angle = () => {
      const [d] = activeDrones(system);
      return Math.atan2(d.y - ship.y, d.x - ship.x);
    };
    const a0 = angle();
    const K = 20; // keep the total advance well under π so there is no atan2 wrap ambiguity
    for (let i = 0; i < K; i++) system.fixedUpdate(DT);
    let delta = angle() - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const expectedPerTick = (2 * Math.PI * DT) / SEEKER_DRONE_ROTATE_PERIOD_MS;
    expect(delta).toBeGreaterThan(0); // it genuinely advanced (not frozen)
    expect(delta).toBeCloseTo(expectedPerTick * K, 4);
  });
});
