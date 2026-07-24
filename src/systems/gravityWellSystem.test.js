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

function createFakeEnemyPool(enemies = []) {
  const pool = new Pool(() => ({ x: 0, y: 0, telegraphMs: 0 }));
  for (const e of enemies) {
    const instance = pool.acquire();
    Object.assign(instance, e);
  }
  return pool;
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
    const enemy = { x: 50, y: 0, telegraphMs: 0 };
    const enemyPool = createFakeEnemyPool([enemy]);
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

    // Enemy at (50, 0) is within 100px of active orbs, but unowned → no pull nudge
    expect(enemy.x).toBe(50);
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
    const telegraphingEnemy = { x: 500, y: 550, telegraphMs: 400 };
    const enemyPool = createFakeEnemyPool([telegraphingEnemy]);
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
    const enemyPool = createFakeEnemyPool([{ x: 50, y: 50, telegraphMs: 0 }]);
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
    const system = new XpOrbSystem(
      fakeCollision(),
      fakeBlackHole(),
      fakeMirror(),
      ship,
      score,
      XP_ORB_MAX,
      corruptStats,
    );

    const orb = seedOrb(system, 100, 0, 10);
    system.fixedUpdate(DT);

    // Falls back to base pickup radius 120 and drift speed 320
    const expectedStep = XP_ORB_DRIFT_SPEED * (DT / 1000);
    expect(orb.x).toBeCloseTo(100 - expectedStep, 5);
  });
});
