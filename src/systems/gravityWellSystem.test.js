import { describe, it, expect } from 'vitest';
import { XpOrbSystem } from './XpOrbSystem.js';
import { Pool } from '../core/Pool.js';
import {
  FIXED_STEP_MS,
  XP_ORB_MAX,
  XP_ORB_RADIUS,
  XP_PICKUP_RADIUS,
  XP_ORB_DRIFT_SPEED,
  GRAVITY_WELL_HOMING_SPEED,
  GRAVITY_WELL_PULL_RADIUS,
  GRAVITY_WELL_PULL_STRENGTH,
  SHIP_RADIUS,
  XP_MULTIPLIER_DIVISOR,
  ARENA_BORDER_INSET,
  EVENT_HORIZON_PULL_STRENGTH,
  EVENT_HORIZON_PULL_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

function fakeCollision() {
  return {
    bulletKillCount: 0,
    bulletKillX: [],
    bulletKillY: [],
    bulletKillXp: [],
  };
}

function fakeBlackHole() {
  return { defusedX: [], defusedY: [] };
}

function fakeMirror() {
  return { centerKillX: [], centerKillY: [] };
}

function fakeShip(x = 0, y = 0) {
  return { x, y };
}

function fakeScore(multiplier = 1) {
  return { xp: 0, multiplier };
}

function seedOrb(system, x, y, value = 1) {
  const o = system.pool.acquire();
  o.x = x;
  o.y = y;
  o.value = value;
  return o;
}

function activeOrbs(system) {
  const out = [];
  system.pool.forEachActive((o) => out.push(o));
  return out;
}

// Pool.acquire() returns a FACTORY-CREATED instance, never the caller's literal, so the
// literals passed in here are only field templates — the system mutates the pooled
// instances. Return those instances alongside the pool: asserting on the source literals
// would be unfalsifiable (they are never referenced by the system under test).
function createFakeEnemyPool(defs = []) {
  const pool = new Pool(() => ({ x: 0, y: 0, telegraphMs: 0 }));
  const enemies = defs.map((d) => Object.assign(pool.acquire(), d));
  return { pool, enemies };
}

describe('XpOrbSystem — Gravity Well mechanics (Story 11.7)', () => {
  it('unowned Gravity Well yields standard 120px pickup radius, 320 px/s drift, 1x XP value, and no pull', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(1);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 50, y: 0, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      score,
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );

    // Orb at 150px: outside default 120px radius → no drift
    const farOrb = seedOrb(system, 150, 0, 10);
    system.fixedUpdate(DT);
    expect(farOrb.x).toBe(150);

    // Orb at 100px: inside 120px radius → drifts at 320 px/s
    const orb = seedOrb(system, 100, 0, 10);
    system.fixedUpdate(DT);
    const expectedStep = XP_ORB_DRIFT_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(100 - expectedStep, 5);

    // Orb at contact radius → collects at 1x base value (10 * (1 + 1/20) = 10.5)
    seedOrb(system, SHIP_RADIUS + XP_ORB_RADIUS - 1, 0, 10);
    system.fixedUpdate(DT);
    expect(score.xp).toBeCloseTo(10 * (1 + 1 / XP_MULTIPLIER_DIVISOR), 5);

    // Enemy at (50, 0) is within 100px of active orbs, but unowned → no pull nudge.
    // Asserted on the POOLED instance (the object the system actually walks).
    expect(enemy.x).toBe(50);
    expect(enemy.y).toBe(0);
  });

  it('Lv1 owned (+40% pickup radius): orb at 160px drifts toward ship (pickup radius is 168px)', () => {
    const ship = fakeShip(0, 0);
    const playerStats = {
      xpPickupRadiusMult: 1.4,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
    );

    // 160px is inside 168px (120 * 1.4) pickup radius
    const orb = seedOrb(system, 160, 0, 1);
    system.fixedUpdate(DT);

    const expectedStep = XP_ORB_DRIFT_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(160 - expectedStep, 5);

    // Orb at 170px is outside 168px pickup radius → stays put
    const farOrb = seedOrb(system, 170, 0, 1);
    system.fixedUpdate(DT);
    expect(farOrb.x).toBe(170);
  });

  it('Lv2 owned (+80% pickup radius): orb at 200px drifts toward ship (pickup radius is 216px)', () => {
    const ship = fakeShip(0, 0);
    const playerStats = {
      xpPickupRadiusMult: 1.8,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
    );

    // 200px is inside 216px (120 * 1.8) pickup radius
    const orb = seedOrb(system, 200, 0, 1);
    system.fixedUpdate(DT);

    const expectedStep = XP_ORB_DRIFT_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(200 - expectedStep, 5);

    // Orb at 220px is outside 216px pickup radius → stays put
    const farOrb = seedOrb(system, 220, 0, 1);
    system.fixedUpdate(DT);
    expect(farOrb.x).toBe(220);
  });

  it('Lv3 owned (gravityWellHoming: 1): orb inside 216px pickup radius homes at 540 px/s', () => {
    const ship = fakeShip(0, 0);
    const playerStats = {
      xpPickupRadiusMult: 1.8,
      gravityWellHoming: 1,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
    );

    const orb = seedOrb(system, 200, 0, 1);
    system.fixedUpdate(DT);

    const expectedStep = GRAVITY_WELL_HOMING_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(200 - expectedStep, 5);
  });

  it('Lv4 owned (xpValueMult: 1.25): collected orb pays 1.25x base XP value', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(1); // multiplier 1
    const playerStats = {
      xpPickupRadiusMult: 1.8,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 0,
    };
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      score,
      XP_ORB_MAX,
      playerStats,
    );

    // Seed orb in collect radius with base value 10
    seedOrb(system, 0, 0, 10);
    system.fixedUpdate(DT);

    // Expected XP: 10 * 1.25 * (1 + 1 / 20) = 12.5 * 1.05 = 13.125
    expect(score.xp).toBeCloseTo(10 * 1.25 * (1 + 1 / XP_MULTIPLIER_DIVISOR), 5);
  });

  it('Lv5 owned (+150% radius & enemy pull): 300px pickup radius and active orbs pull nearby non-telegraphing enemies', () => {
    const ship = fakeShip(0, 0);
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    const enemyPool = new Pool(() => ({ x: 0, y: 0, telegraphMs: 0 }));
    const enemy = enemyPool.acquire();
    enemy.x = 500;
    enemy.y = 550;
    enemy.telegraphMs = 0;

    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );

    // Orb at 280px: inside 300px (120 * 2.5) pickup radius
    const orb = seedOrb(system, 280, 0, 1);

    // Static active orb at (500, 500)
    seedOrb(system, 500, 500, 1);

    system.fixedUpdate(DT);

    // Pickup radius check for orb at 280px
    const expectedStep = GRAVITY_WELL_HOMING_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(280 - expectedStep, 5);

    // Enemy pull check: enemy at (500, 550) is 50px from pullOrb (500, 500)
    // Distance d = 50px (< 100px GRAVITY_WELL_PULL_RADIUS)
    // Pull magnitude = GRAVITY_WELL_PULL_STRENGTH * (1 - 50/100) * dtSec = 40 * 0.5 * dtSec = 20 * dtSec
    const dtSec = DT / 1000;
    const pullDist = GRAVITY_WELL_PULL_STRENGTH * (1 - 50 / GRAVITY_WELL_PULL_RADIUS) * dtSec;
    // Direction from enemy (500, 550) to orb (500, 500) is (0, -50), unit vector (0, -1)
    // So enemy y should decrease by pullDist
    expect(enemy.x).toBeCloseTo(500, 5);
    expect(enemy.y).toBeCloseTo(550 - pullDist, 5);
  });


  it('never pulls telegraphing (telegraphMs > 0) enemies', () => {
    const ship = fakeShip(0, 0);
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([
      { x: 500, y: 550, telegraphMs: 400 },
    ]);
    const telegraphingEnemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );

    seedOrb(system, 500, 500, 1);
    system.fixedUpdate(DT);

    // Telegraphing enemy position unchanged
    expect(telegraphingEnemy.x).toBe(500);
    expect(telegraphingEnemy.y).toBe(550);
  });

  it('safely skips pull when enemyPools or ship is null', () => {
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };

    // Null enemyPools
    const systemNoEnemies = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      fakeShip(),
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      null,
    );
    seedOrb(systemNoEnemies, 100, 100, 1);
    expect(() => systemNoEnemies.fixedUpdate(DT)).not.toThrow();

    // Null ship
    const { pool: enemyPool } = createFakeEnemyPool([{ x: 50, y: 50, telegraphMs: 0 }]);
    const systemNoShip = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      null,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    seedOrb(systemNoShip, 100, 100, 1);
    expect(() => systemNoShip.fixedUpdate(DT)).not.toThrow();
  });

  it('sanitizes corrupt or invalid playerStats gracefully', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(1);

    // Negative/NaN/junk stats
    const corruptStats = {
      xpPickupRadiusMult: -5,
      gravityWellHoming: 'yes',
      xpValueMult: NaN,
      gravityWellPullEnemies: null,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 50, y: 0, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      score,
      XP_ORB_MAX,
      corruptStats,
      [enemyPool],
    );

    const orb = seedOrb(system, 100, 0, 10);
    system.fixedUpdate(DT);

    // Falls back to base pickup radius 120 and drift speed 320
    const expectedStep = XP_ORB_DRIFT_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(100 - expectedStep, 5);

    // A junk pull flag enables nothing: the pooled enemy is untouched.
    expect(enemy.x).toBe(50);
    expect(enemy.y).toBe(0);

    // The XP credit must survive a NaN xpValueMult — a NaN reaching scoreState.xp is
    // permanent for the run and silently breaks every downstream level threshold.
    seedOrb(system, 0, 0, 10);
    system.fixedUpdate(DT);
    expect(Number.isFinite(score.xp)).toBe(true);
    expect(score.xp).toBeCloseTo(10 * (1 + 1 / XP_MULTIPLIER_DIVISOR), 5);
  });

  it('a non-finite dt writes no NaN into pooled enemy coordinates', () => {
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 500, y: 550, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      fakeShip(0, 0),
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    seedOrb(system, 500, 500, 1);

    system.fixedUpdate(NaN);
    expect(Number.isFinite(enemy.x)).toBe(true);
    expect(Number.isFinite(enemy.y)).toBe(true);
    expect(enemy.x).toBe(500);
    expect(enemy.y).toBe(550);
  });

  it('caps stacked pull from an orb pile at one orb worth of displacement', () => {
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 500, y: 550, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      fakeShip(0, 0),
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    // 30 co-located orbs 50px from the enemy. Unclamped this would be 30x the nudge.
    for (let i = 0; i < 30; i++) seedOrb(system, 500, 500, 1);

    system.fixedUpdate(DT);

    const dtSec = DT / 1000;
    const maxStep = GRAVITY_WELL_PULL_STRENGTH * dtSec;
    const moved = Math.hypot(enemy.x - 500, enemy.y - 550);
    expect(moved).toBeLessThanOrEqual(maxStep + 1e-9);
    expect(moved).toBeCloseTo(maxStep, 5);
  });

  it('never drags an in-bounds enemy outside the arena interior', () => {
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    // Enemy just inside the top border; a pile of orbs sits outside it, pulling up.
    const { pool: enemyPool, enemies } = createFakeEnemyPool([
      { x: 800, y: ARENA_BORDER_INSET + 0.1, telegraphMs: 0, radius: 0 },
    ]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      fakeShip(0, 0),
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    for (let i = 0; i < 30; i++) seedOrb(system, 800, ARENA_BORDER_INSET - 40, 1);

    system.fixedUpdate(DT);

    expect(enemy.y).toBeGreaterThanOrEqual(ARENA_BORDER_INSET);
  });

  it('a freshly spawned orb waits one tick before it can pull (advance-then-spawn)', () => {
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 500, y: 550, telegraphMs: 0 }]);
    const enemy = enemies[0];
    // A kill report at (500, 500) makes the system SPAWN an orb during this tick.
    const collision = fakeCollision();
    collision.bulletKillCount = 1;
    collision.bulletKillX = [500];
    collision.bulletKillY = [500];
    collision.bulletKillXp = [1];
    const system = new XpOrbSystem(
      collision,
      fakeBlackHole(),
      fakeMirror(),
      fakeShip(0, 0),
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );

    system.fixedUpdate(DT);
    // The orb was spawned this tick, so it must not have pulled yet.
    expect(enemy.y).toBe(550);

    // Next tick it is part of the pre-spawn snapshot and does pull.
    collision.bulletKillCount = 0;
    system.fixedUpdate(DT);
    expect(enemy.y).toBeLessThan(550);
  });
});

// --- Story 12.13 — Event Horizon: passive gravity pull toward ship ---
describe('XpOrbSystem — Event Horizon (Story 12.13)', () => {
  it('eventHorizonActive pulls enemies toward ship', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 300, y: 300, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    const dtSec = DT / 1000;
    const d = 100;
    const expectedPull = EVENT_HORIZON_PULL_STRENGTH * (1 - d / EVENT_HORIZON_PULL_RADIUS) * dtSec;

    system.fixedUpdate(DT);

    expect(enemy.x).toBeCloseTo(300 + expectedPull, 6);
    expect(enemy.y).toBe(300);
  });

  it('eventHorizonActive does not pull telegraphing enemies', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 300, y: 300, telegraphMs: 500 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    system.fixedUpdate(DT);

    expect(enemy.x).toBe(300);
    expect(enemy.y).toBe(300);
  });

  it('eventHorizonActive does not pull enemies outside radius', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 700, y: 300, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    system.fixedUpdate(DT);

    expect(enemy.x).toBe(700);
    expect(enemy.y).toBe(300);
  });

  it('eventHorizonActive does not pull the ship', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 300, y: 300, telegraphMs: 0 }]);
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    const shipX = ship.x;
    const shipY = ship.y;
    system.fixedUpdate(DT);

    expect(ship.x).toBe(shipX);
    expect(ship.y).toBe(shipY);
  });

  it('eventHorizonActive + Gravity Well pull coexist', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 2.5,
      gravityWellHoming: 1,
      xpValueMult: 1.25,
      gravityWellPullEnemies: 1,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 350, y: 350, telegraphMs: 0 }]);
    const enemy = enemies[0];
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    // Place an orbital orb so Gravity Well orb-pull is active.
    const orb = seedOrb(system, 350, 300, 1);

    system.fixedUpdate(DT);

    // Enemy was pulled by both: Event Horizon toward ship (400, 300) AND
    // Gravity Well toward orb (350, 300). Both act together.
    // Event Horizon: dx=50, dy=-50 from enemy, distance ~70.7, pull ~12*(1-70.7/200)*dt
    // Gravity Well: dx=0, dy=-50 from enemy to orb, distance 50, pull ~40*(1-50/100)*dt
    // Both should contribute to movement — enemy.x and enemy.y both change.
    expect(enemy.x).toBeGreaterThan(350); // pulled right by EH toward ship
    expect(enemy.y).toBeLessThan(350); // pulled down by both EH and GW toward ship/orb
  });

  it('null ship guard: does not throw', () => {
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 300, y: 300, telegraphMs: 0 }]);
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      null,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    expect(() => system.fixedUpdate(DT)).not.toThrow();
    expect(enemies[0].x).toBe(300);
    expect(enemies[0].y).toBe(300);
  });

  it('null enemyPools guard: does not throw', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      null,
    );
    system.eventHorizonActive = true;

    expect(() => system.fixedUpdate(DT)).not.toThrow();
  });

  it('NaN dt guard: no NaN propagates into enemy coordinates', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 300, y: 300, telegraphMs: 0 }]);
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    system.fixedUpdate(NaN);

    expect(Number.isFinite(enemies[0].x)).toBe(true);
    expect(Number.isFinite(enemies[0].y)).toBe(true);
  });

  it('negative/invalid dt: does not modify enemy positions', () => {
    const ship = fakeShip(400, 300);
    const playerStats = {
      xpPickupRadiusMult: 1,
      gravityWellHoming: 0,
      xpValueMult: 1,
      gravityWellPullEnemies: 0,
    };
    const { pool: enemyPool, enemies } = createFakeEnemyPool([{ x: 300, y: 300, telegraphMs: 0 }]);
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      fakeScore(),
      XP_ORB_MAX,
      playerStats,
      [enemyPool],
    );
    system.eventHorizonActive = true;

    system.fixedUpdate(-1);

    expect(enemies[0].x).toBe(300);
    expect(enemies[0].y).toBe(300);
  });
});
