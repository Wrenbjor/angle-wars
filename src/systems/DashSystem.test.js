import { describe, it, expect } from 'vitest';
import { DashSystem } from './DashSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import {
  FIXED_STEP_MS,
  DASH_DURATION_MS,
  SLIPSTREAM_DECOY_DURATION_MS,
  SLIPSTREAM_DECOY_PULL_RADIUS,
  SLIPSTREAM_DECOY_PULL_STRENGTH,
  SLIPSTREAM_DECOY_EXPLODE_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Create a mock InputState with a daisy-chainable consumeDash.
// Default: returns false (no dash queued).
// Calling `.queue()` returns true for the NEXT call then resets.
function makeInputState() {
  let nextConsume = () => false;
  const state = {
    consumeDash: () => {
      const fn = nextConsume;
      nextConsume = () => false;
      return fn();
    },
    moveX: 0,
    moveY: 1,
    queueDash: () => {
      const current = nextConsume;
      nextConsume = () => current() || true;
    },
  };
  return state;
}

function makeSystem(extraStats = {}) {
  const ship = { x: 400, y: 300, angle: 0, radius: 8 };
  const inputState = makeInputState();
  const enemyPool = new Pool(createSeeker);
  const greenPool = new Pool(createGreenSquare);
  const collisionSystem = {
    killedEnemies: [],
    bulletDamageCount: 0,
    bulletKillCount: 0,
    bulletKillX: [],
    bulletKillY: [],
    bulletKillXp: [],
    applyPlayerDamage(enemy, ownerPool, damage) {
      // enemies without hp (like Seeker/GreenSquare) are killed instantly
      if (Number.isFinite(enemy.hp) && enemy.hp > damage + 0.001) {
        enemy.hp -= damage;
        return false;
      }
      this.killedEnemies.push(enemy);
      this.bulletKillCount++;
      ownerPool.release(enemy);
      return true;
    },
  };
  const playerStats = {
    moveSpeedMult: 1,
    dashCooldownMs: 2000,
    dashIFrames: 1,
    dashDamage: 1,
    dashTrail: 1,
    ...extraStats,
  };
  const system = new DashSystem(
    ship,
    inputState,
    [enemyPool, greenPool],
    collisionSystem,
    playerStats,
  );
  return { system, ship, inputState, enemyPool, greenPool, collisionSystem };
}

function tickN(system, count = 1) {
  for (let i = 0; i < count; i++) {
    system.fixedUpdate(DT);
  }
}

function addSeeker(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = 0;
  return s;
}

function addGreenSquare(pool, x, y) {
  const g = pool.acquire();
  g.x = x;
  g.y = y;
  g.vx = 0;
  g.vy = 0;
  g.telegraphMs = 0;
  return g;
}

describe('DashSystem', () => {
  it('does nothing without dash input', () => {
    const { system } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    tickN(system, 60); // ~1 second
    expect(system.active).toBe(false);
    expect(system.remainingMs).toBe(0);
  });

  it('starts a dash on input and finishes after duration', () => {
    const { system, inputState } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    // Queue a dash. The NEXT consumeDash call will return true.
    inputState.queueDash();
    system.fixedUpdate(DT); // dash opens

    expect(system.active).toBe(true);
    expect(system.remainingMs).toBe(DASH_DURATION_MS);
    expect(system.cooldownRemainingMs).toBe(2000);

    // Dash window is 180ms (~11 ticks). After 12 more ticks it should be closed.
    tickN(system, 12);
    expect(system.active).toBe(false);
    expect(system.remainingMs).toBe(0);
  });

  it('dash i-frames: PlayerDeathSystem sees movementActive while dashing', () => {
    const { system, inputState } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    // Queue a dash. fixedUpdate sets movementActive BEFORE active becomes true,
    // so i-frames activate on the NEXT tick (when movementActive sees true).
    inputState.queueDash();
    system.fixedUpdate(DT); // dash opens; i-frames are still false this tick
    tickN(system, 1); // next tick: movementActive = true, i-frames active

    expect(system.iFramesActive()).toBe(true);

    // After dash window closes, i-frames go away.
    tickN(system, 12);
    expect(system.iFramesActive()).toBe(false);
  });

  // --- Slipstream decoy tests ------------------------------------------------

  it('slipstream: decoy spawns when dash completes and slipstreamActive', () => {
    const { system, inputState, ship } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    ship.x = 300;
    ship.y = 200;

    // Open and close a dash.
    system.slipstreamActive = true;
    inputState.queueDash();
    system.fixedUpdate(DT); // dash opens
    tickN(system, 12); // dash closes (~180ms)

    expect(system._decoyActive).toBe(true);
    expect(system._decoyX).toBe(300);
    expect(system._decoyY).toBe(200);
    // Decoy spawns when the dash closes. The tick that closes the dash also
    // decrements the decoy timer once (dt = 16.67ms), so the expected value
    // is SLIPSTREAM_DECOY_DURATION_MS - DT.
    expect(system._decoyRemainingMs).toBe(SLIPSTREAM_DECOY_DURATION_MS - DT);
  });

  it('slipstream: decoy does NOT spawn when slipstreamActive is false', () => {
    const { system, inputState } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });

    system.slipstreamActive = false;
    inputState.queueDash();
    system.fixedUpdate(DT); // dash opens
    tickN(system, 12); // dash closes

    expect(system._decoyActive).toBe(false);
  });

  it('slipstream: decoy pulls enemies within radius', () => {
    const { system, inputState, enemyPool, ship } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    ship.x = 400;
    ship.y = 300;

    system.slipstreamActive = true;
    inputState.queueDash();
    system.fixedUpdate(DT);
    tickN(system, 12); // dash closes, decoy spawns

    // Place an enemy at distance 100 from decoy center.
    const enemy = addSeeker(enemyPool, 300, 300); // dx = 100, dy = 0
    const d = 100;
    const dtSec = DT / 1000;
    const expectedPull = SLIPSTREAM_DECOY_PULL_STRENGTH * (1 - d / SLIPSTREAM_DECOY_PULL_RADIUS) * dtSec;

    system._decoyPull(DT);

    // Enemy should be nudged toward decoy position (400, 300) by expectedPull.
    expect(enemy.x).toBeCloseTo(300 + expectedPull, 4);
    expect(enemy.y).toBeCloseTo(300);
  });

  it('slipstream: decoy does NOT pull telegraphing enemies', () => {
    const { system, enemyPool } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });

    // Set up decoy state directly for this unit test.
    system._decoyActive = true;
    system._decoyX = 400;
    system._decoyY = 300;
    system._decoyRemainingMs = 1000;

    const enemy = addSeeker(enemyPool, 300, 300);
    enemy.telegraphMs = 1000; // telegraphing enemy

    system._decoyPull(DT);

    expect(enemy.x).toBe(300);
    expect(enemy.y).toBe(300);
  });

  it('slipstream: decoy does NOT pull enemies outside radius', () => {
    const { system, enemyPool } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    const decoyX = 400;
    const decoyY = 300;
    system._decoyActive = true;
    system._decoyX = decoyX;
    system._decoyY = decoyY;
    system._decoyRemainingMs = 1000;

    const enemy = addSeeker(enemyPool, decoyX + 250, decoyY); // 250px away, outside 180 radius

    system._decoyPull(DT);

    expect(enemy.x).toBe(decoyX + 250);
    expect(enemy.y).toBe(decoyY);
  });

  it('slipstream: decoy explodes on timer expiry and kills enemies in radius', () => {
    const { system, inputState, enemyPool, greenPool, collisionSystem, ship } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    ship.x = 400;
    ship.y = 300;

    system.slipstreamActive = true;
    inputState.queueDash();
    system.fixedUpdate(DT);

    // Place some enemies.
    addSeeker(enemyPool, 400, 300); // inside explosion radius
    const green1 = addGreenSquare(greenPool, 420, 310); // inside
    const green2 = addGreenSquare(greenPool, 700, 600); // outside

    // The first fixedUpdate opens the dash (~12 ticks to close).
    // After the dash closes, the decoy spawns with ~2983ms timer.
    // Need ~180 more ticks for the timer to reach 0.
    tickN(system, 12 + 180);

    // Enemies inside radius should be released and registered as killed.
    expect(enemyPool.activeCount).toBe(0);
    expect(greenPool.activeCount).toBe(1); // one outside survived

    // killedEnemies should have 2 entries.
    expect(collisionSystem.killedEnemies.length).toBe(2);

    // The green square outside should still be active.
    expect(green2.x).toBe(700);
    expect(green2.y).toBe(600);
  });

  it('slipstream: decoy explosion does NOT kill telegraphing enemies', () => {
    const { system, enemyPool, collisionSystem } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    const decoyX = 400;
    const decoyY = 300;
    system._decoyActive = true;
    system._decoyX = decoyX;
    system._decoyY = decoyY;
    system._decoyRemainingMs = 1;

    // Place a telegraphing enemy just inside explosion radius.
    const teleEnemy = addSeeker(enemyPool, decoyX + 100, decoyY);
    teleEnemy.telegraphMs = 500;

    // Force a very close-to-exploding state by ticking 0 (so _decoyRemainingMs <= 0 triggers explode).
    system._decoyRemainingMs = 0;
    tickN(system, 1);

    // Telegraphing enemy should NOT be released or killed.
    expect(enemyPool.activeCount).toBe(1);
    expect(enemyPool.freeCount).toBe(0);
    expect(collisionSystem.killedEnemies.length).toBe(0);
    expect(teleEnemy.x).toBe(decoyX + 100);
  });

  it('slipstream: second dash replaces existing decoy (replaces position and resets timer)', () => {
    const { system, inputState, ship } = makeSystem({
      dashCooldownMs: 2000,
      dashIFrames: 1,
      dashDamage: 1,
    });
    // Speed up the cooldown for fast testing.
    system.playerStats.dashCooldownMs = 0; // instant cooldown

    system.slipstreamActive = true;

    // First dash.
    inputState.queueDash();
    let dt = 0;
    do {
      dt++;
      system.fixedUpdate(DT);
    } while (dt < 15 && system.active); // spin until dash closes

    const firstX = system._decoyX;
    const firstY = system._decoyY;

    // Move ship for second dash.
    ship.x = 500;
    ship.y = 500;

    // Queue another dash (cooldown is 0, so it should fire immediately).
    inputState.queueDash();
    dt = 0;
    do {
      dt++;
      system.fixedUpdate(DT);
    } while (dt < 15 && system.active); // spin until dash closes

    // The decoy should have moved to the new dash position and timer reset.
    expect(system._decoyActive).toBe(true);
    expect(system._decoyX).toBe(500);
    expect(system._decoyY).toBe(500);
    expect(system._decoyRemainingMs).toBe(SLIPSTREAM_DECOY_DURATION_MS - DT);
    expect(system._decoyX).not.toBe(firstX);
  });

  it('slipstream: decoy pull continues independently during a new dash', () => {
    const { system, inputState, enemyPool, ship } = makeSystem({
      dashCooldownMs: 0,
      dashIFrames: 1,
      dashDamage: 1,
    });
    ship.x = 400;
    ship.y = 300;

    system.slipstreamActive = true;
    inputState.queueDash();
    let dt = 0;
    do {
      dt++;
      system.fixedUpdate(DT);
    } while (dt < 15 && system.active); // until dash closes, decoy spawns

    // Place enemy near decoy.
    const enemy = addSeeker(enemyPool, 300, 300);
    const initialEnemyX = enemy.x;

    // Dash again (replace decoy).
    ship.x = 350;
    ship.y = 300;
    inputState.queueDash();
    dt = 0;
    do {
      dt++;
      system.fixedUpdate(DT);
    } while (dt < 15 && system.active);

    // The new decoy should have pulled the enemy.
    expect(enemy.x).not.toBe(initialEnemyX);
    // Position should be pulled toward new decoy (350, 300).
    expect(enemy.x).toBeGreaterThan(initialEnemyX);
  });
});
