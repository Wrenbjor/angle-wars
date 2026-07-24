import { describe, it, expect } from 'vitest';
import { DashSystem } from './DashSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createArmored } from '../entities/Armored.js';
import { createBullet } from '../entities/Bullet.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { InputState } from '../input/InputState.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import {
  FIXED_STEP_MS,
  DASH_DURATION_MS,
  DASH_COOLDOWN_FLOOR_MS,
  DASH_CONTACT_DAMAGE,
  ARMORED_HP,
} from '../config/constants.js';

// Story 10.5 — DashSystem owns the Afterburner dash's RUNTIME state (the live cooldown,
// the active window, the direction) while the shared playerStats store owns only the
// derived parameters. This suite covers the I/O-matrix rows that belong to this system.
// The MOVEMENT of the dash lives in playerMovementSystem.test.js, the i-frame / cancel
// seams in playerDeathSystem.test.js, the trail in particleSystem.test.js, and the
// assembled-world chain in buildArenaWorld.test.js.

const DT = FIXED_STEP_MS;

// The per-level dash parameters the real registry folds to (pinned against the registry
// itself in playerStats.test.js — restated here as this system's input vocabulary).
const LV1 = { moveSpeedMult: 1.12 };
const LV2 = { moveSpeedMult: 1.2, dashCooldownMs: 3000 };
const LV3 = { moveSpeedMult: 1.25, dashCooldownMs: 3000, dashIFrames: 1 };
const LV4 = {
  moveSpeedMult: 1.25,
  dashCooldownMs: 2000,
  dashIFrames: 1,
  dashDamage: 1,
};
const LV5 = {
  moveSpeedMult: 1.35,
  dashCooldownMs: 2000,
  dashIFrames: 1,
  dashDamage: 1,
  dashTrail: 1,
};

/**
 * A dash system over a fresh ship, a real InputState, the given enemy pools, a REAL
 * CollisionSystem (so the damage path is the shipped one, never a stub) and a real
 * player-stat store seeded with the given dash fields.
 */
function makeSystem(stats = {}, pools = null) {
  const ship = createPlayerShip();
  const inputState = new InputState();
  const enemyPools = pools ?? [new Pool(createSeeker)];
  const collisionSystem = new CollisionSystem(new Pool(createBullet), enemyPools);
  const playerStats = { ...createPlayerStats(), ...stats };
  const system = new DashSystem(
    ship,
    inputState,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  return { ship, inputState, enemyPools, collisionSystem, playerStats, system };
}

function addEnemy(pool, x, y, telegraphMs = 0) {
  const e = pool.acquire();
  e.x = x;
  e.y = y;
  e.vx = 0;
  e.vy = 0;
  e.telegraphMs = telegraphMs;
  return e;
}

/** Queue a dash and advance one fixed step. */
function pressAndStep(system, inputState, dt = DT) {
  inputState.queueDash();
  system.fixedUpdate(dt);
}

describe('DashSystem — cooldown countdown', () => {
  it('counts the cooldown down by dt and clamps at 0 (never negative)', () => {
    const { inputState, system } = makeSystem(LV2);
    pressAndStep(system, inputState);
    expect(system.cooldownRemainingMs).toBe(3000);
    for (let i = 0; i < 10; i++) system.fixedUpdate(DT);
    expect(system.cooldownRemainingMs).toBeCloseTo(3000 - 10 * DT, 6);
    // Overshoot the whole interval — it clamps rather than going negative.
    for (let i = 0; i < 400; i++) system.fixedUpdate(DT);
    expect(system.cooldownRemainingMs).toBe(0);
  });
});

describe('DashSystem — opening a dash', () => {
  it('a press with the cooldown ready opens the window with direction, duration, cooldown and a dashSeq bump', () => {
    const { inputState, system } = makeSystem(LV2);
    inputState.setMove(1, 0);
    expect(system.dashSeq).toBe(0);
    pressAndStep(system, inputState);
    expect(system.active).toBe(true);
    expect(system.remainingMs).toBe(DASH_DURATION_MS);
    expect(system.cooldownRemainingMs).toBe(3000);
    expect(system.dirX).toBeCloseTo(1, 10);
    expect(system.dirY).toBeCloseTo(0, 10);
    expect(system.dashSeq).toBe(1);
  });

  it('NORMALIZES the move intent, so a half-deflected stick dashes the full distance', () => {
    const { inputState, system } = makeSystem(LV2);
    inputState.setMove(0.3, 0.4); // magnitude 0.5
    pressAndStep(system, inputState);
    expect(Math.hypot(system.dirX, system.dirY)).toBeCloseTo(1, 10);
    expect(system.dirX).toBeCloseTo(0.6, 10);
    expect(system.dirY).toBeCloseTo(0.8, 10);
  });

  it('falls back to the ship FACING at zero move intent (the ship always carries one)', () => {
    const { ship, inputState, system } = makeSystem(LV2);
    ship.angle = Math.PI / 2;
    inputState.setMove(0, 0);
    pressAndStep(system, inputState);
    expect(system.dirX).toBeCloseTo(Math.cos(Math.PI / 2), 10);
    expect(system.dirY).toBeCloseTo(Math.sin(Math.PI / 2), 10);
    expect(system.active).toBe(true);
  });

  it('closes the window at exactly DASH_DURATION_MS of accumulated dt', () => {
    const { inputState, system } = makeSystem(LV2);
    inputState.setMove(1, 0);
    pressAndStep(system, inputState);
    const ticks = Math.ceil(DASH_DURATION_MS / DT);
    for (let i = 1; i < ticks; i++) {
      system.fixedUpdate(DT);
      expect(system.active, `still active at tick ${i}`).toBe(true);
    }
    system.fixedUpdate(DT);
    expect(system.active).toBe(false);
    expect(system.remainingMs).toBe(0);
  });
});

describe('DashSystem — a press that cannot open a dash is CONSUMED and DISCARDED', () => {
  it('a press during the cooldown fires nothing, refreshes nothing, and is not buffered', () => {
    const { inputState, system } = makeSystem(LV2);
    pressAndStep(system, inputState);
    // Run the window out, then press again while the cooldown is still in flight.
    for (let i = 0; i < 20; i++) system.fixedUpdate(DT);
    expect(system.active).toBe(false);
    const cooldownBefore = system.cooldownRemainingMs;
    expect(cooldownBefore).toBeGreaterThan(0);
    pressAndStep(system, inputState);
    expect(system.active).toBe(false);
    expect(system.dashSeq).toBe(1); // no bump — the press was dropped
    expect(system.cooldownRemainingMs).toBeCloseTo(cooldownBefore - DT, 6); // not refreshed
    expect(inputState.dashQueued).toBe(false); // consumed, not buffered
  });

  it('a press MID-DASH fires no second dash and does not refresh the cooldown', () => {
    const { inputState, system } = makeSystem(LV2);
    pressAndStep(system, inputState);
    const remainingBefore = system.remainingMs;
    pressAndStep(system, inputState);
    expect(system.dashSeq).toBe(1);
    expect(system.remainingMs).toBeCloseTo(remainingBefore - DT, 6); // window not restarted
    expect(system.cooldownRemainingMs).toBeCloseTo(3000 - DT, 6);
    expect(inputState.dashQueued).toBe(false);
  });

  it('a press with NO dash owned (Lv0 / Lv1) is consumed and discarded', () => {
    for (const stats of [{}, LV1]) {
      const { inputState, system } = makeSystem(stats);
      pressAndStep(system, inputState);
      expect(system.active).toBe(false);
      expect(system.dashSeq).toBe(0);
      expect(system.cooldownRemainingMs).toBe(0);
      expect(inputState.dashQueued).toBe(false);
    }
  });
});

describe('DashSystem — movementActive lags active by exactly one fixedUpdate', () => {
  it('is false on the OPENING tick and true on the tick after (what movement acted on)', () => {
    const { inputState, system } = makeSystem(LV2);
    pressAndStep(system, inputState);
    // The dash opened at the END of this tick; movement (which runs BEFORE this
    // system) has not seen it yet, so nothing was protected/damaged/trailed.
    expect(system.active).toBe(true);
    expect(system.movementActive).toBe(false);
    system.fixedUpdate(DT);
    expect(system.movementActive).toBe(true);
  });

  it('is still true on the CLOSING tick — the tail of the travel is not orphaned', () => {
    const { inputState, system } = makeSystem(LV2);
    pressAndStep(system, inputState);
    const ticks = Math.ceil(DASH_DURATION_MS / DT);
    for (let i = 1; i <= ticks; i++) system.fixedUpdate(DT);
    // `active` closed on this tick, but movement DID apply dash velocity earlier in it,
    // so the published window still covers it. This is the whole reason the field exists.
    expect(system.active).toBe(false);
    expect(system.movementActive).toBe(true);
    system.fixedUpdate(DT);
    expect(system.movementActive).toBe(false);
  });

  it('the published window is exactly as many ticks as the dash travels', () => {
    const { inputState, system } = makeSystem(LV2);
    pressAndStep(system, inputState);
    let published = 0;
    for (let i = 0; i < 40; i++) {
      system.fixedUpdate(DT);
      if (system.movementActive) published += 1;
    }
    expect(published).toBe(Math.ceil(DASH_DURATION_MS / DT));
  });
});

describe('DashSystem — public queries', () => {
  it('dashEnabled() is false at Lv0/Lv1 and true from Lv2', () => {
    expect(makeSystem({}).system.dashEnabled()).toBe(false);
    expect(makeSystem(LV1).system.dashEnabled()).toBe(false);
    for (const stats of [LV2, LV3, LV4, LV5]) {
      expect(makeSystem(stats).system.dashEnabled()).toBe(true);
    }
  });

  it('iFramesActive() / trailActive() require BOTH movementActive and the flag', () => {
    // Lv2: dash but no i-frames and no trail.
    const lv2 = makeSystem(LV2);
    pressAndStep(lv2.system, lv2.inputState);
    lv2.system.fixedUpdate(DT);
    expect(lv2.system.movementActive).toBe(true);
    expect(lv2.system.iFramesActive()).toBe(false);
    expect(lv2.system.trailActive()).toBe(false);

    // Lv3: i-frames, no trail.
    const lv3 = makeSystem(LV3);
    pressAndStep(lv3.system, lv3.inputState);
    lv3.system.fixedUpdate(DT);
    expect(lv3.system.iFramesActive()).toBe(true);
    expect(lv3.system.trailActive()).toBe(false);

    // Lv5: both.
    const lv5 = makeSystem(LV5);
    pressAndStep(lv5.system, lv5.inputState);
    lv5.system.fixedUpdate(DT);
    expect(lv5.system.iFramesActive()).toBe(true);
    expect(lv5.system.trailActive()).toBe(true);
  });

  it('is FALSE on both edge ticks where active and movementActive disagree', () => {
    const { inputState, system } = makeSystem(LV5);
    // Opening tick: active true, movementActive false → nothing protected/trailing.
    pressAndStep(system, inputState);
    expect(system.active).toBe(true);
    expect(system.iFramesActive()).toBe(false);
    expect(system.trailActive()).toBe(false);
    // Closing tick: active false, movementActive true → STILL protected/trailing.
    const ticks = Math.ceil(DASH_DURATION_MS / DT);
    for (let i = 1; i <= ticks; i++) system.fixedUpdate(DT);
    expect(system.active).toBe(false);
    expect(system.iFramesActive()).toBe(true);
    expect(system.trailActive()).toBe(true);
  });
});

describe('DashSystem — cancel()', () => {
  it('clears active/movementActive/remainingMs and does NOT refund the cooldown', () => {
    const { inputState, system } = makeSystem(LV3);
    pressAndStep(system, inputState);
    system.fixedUpdate(DT);
    expect(system.movementActive).toBe(true);
    const cooldown = system.cooldownRemainingMs;
    system.cancel();
    expect(system.active).toBe(false);
    expect(system.movementActive).toBe(false);
    expect(system.remainingMs).toBe(0);
    expect(system.cooldownRemainingMs).toBe(cooldown); // the dash was SPENT
    // …and the protections drop with it on the very same tick.
    expect(system.iFramesActive()).toBe(false);
  });

  it('is safe when no dash is running (idempotent no-op)', () => {
    const { system } = makeSystem(LV3);
    expect(() => system.cancel()).not.toThrow();
    expect(system.active).toBe(false);
    expect(system.remainingMs).toBe(0);
  });
});

describe('DashSystem — the Lv4+ contact sweep', () => {
  /** Open a dash and advance to the first tick the sweep can run on. */
  function openAndArm(h) {
    h.inputState.setMove(1, 0);
    pressAndStep(h.system, h.inputState);
    h.system.fixedUpdate(DT); // movementActive now true → the sweep runs
  }

  it('kills a one-shot enemy in contact range and reports it exactly like a bullet kill', () => {
    const pool = new Pool(createSeeker);
    const h = makeSystem(LV4, [pool]);
    const e = addEnemy(pool, h.ship.x + 5, h.ship.y);
    e.xp = 7;
    openAndArm(h);
    const cs = h.collisionSystem;
    expect(cs.killedEnemies).toContain(e);
    expect(cs.bulletKillCount).toBe(1);
    expect(cs.bulletDamageCount).toBe(1);
    expect(cs.bulletKillX[0]).toBe(h.ship.x + 5);
    expect(cs.bulletKillY[0]).toBe(h.ship.y);
    expect(cs.bulletKillXp[0]).toBe(7);
    expect(pool.activeCount).toBe(0); // released to its OWNING pool
  });

  it('does NOT damage an enemy out of contact range', () => {
    const pool = new Pool(createSeeker);
    const h = makeSystem(LV4, [pool]);
    addEnemy(pool, h.ship.x + 400, h.ship.y);
    openAndArm(h);
    expect(h.collisionSystem.bulletDamageCount).toBe(0);
    expect(pool.activeCount).toBe(1);
  });

  it('does nothing at all when dashDamage is NOT enabled (Lv2/Lv3)', () => {
    for (const stats of [LV2, LV3]) {
      const pool = new Pool(createSeeker);
      const h = makeSystem(stats, [pool]);
      addEnemy(pool, h.ship.x + 5, h.ship.y);
      openAndArm(h);
      expect(h.collisionSystem.bulletDamageCount).toBe(0);
      expect(pool.activeCount).toBe(1);
    }
  });

  it('does nothing while NO dash is running (an idle Lv4 build sweeps nothing)', () => {
    const pool = new Pool(createSeeker);
    const h = makeSystem(LV4, [pool]);
    addEnemy(pool, h.ship.x + 5, h.ship.y);
    for (let i = 0; i < 30; i++) h.system.fixedUpdate(DT);
    expect(h.collisionSystem.bulletDamageCount).toBe(0);
    expect(pool.activeCount).toBe(1);
  });

  it('SKIPS a telegraphing enemy entirely — no damage, no kill', () => {
    const pool = new Pool(createSeeker);
    const h = makeSystem(LV4, [pool]);
    addEnemy(pool, h.ship.x + 5, h.ship.y, 500);
    openAndArm(h);
    expect(h.collisionSystem.bulletDamageCount).toBe(0);
    expect(pool.activeCount).toBe(1);
  });

  it('reaches EVERY pool it was given', () => {
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const h = makeSystem(LV4, [seekers, squares]);
    addEnemy(seekers, h.ship.x + 5, h.ship.y);
    addEnemy(squares, h.ship.x, h.ship.y + 5);
    openAndArm(h);
    expect(h.collisionSystem.bulletKillCount).toBe(2);
    expect(seekers.activeCount).toBe(0);
    expect(squares.activeCount).toBe(0);
  });

  it('an ARMORED enemy SURVIVES with reduced hp and still credits bulletDamageCount', () => {
    const pool = new Pool(createArmored);
    const h = makeSystem(LV4, [pool]);
    const e = addEnemy(pool, h.ship.x + 5, h.ship.y);
    expect(e.hp).toBe(ARMORED_HP);
    openAndArm(h);
    expect(e.hp).toBeCloseTo(ARMORED_HP - DASH_CONTACT_DAMAGE, 10);
    expect(pool.activeCount).toBe(1); // NOT released
    expect(h.collisionSystem.bulletKillCount).toBe(0); // NOT a kill
    expect(h.collisionSystem.killedEnemies).toHaveLength(0);
    expect(h.collisionSystem.bulletDamageCount).toBe(1); // the 9.2 governor still sees it
  });

  it('damages each enemy exactly ONCE per dash, not once per tick', () => {
    const pool = new Pool(createArmored);
    const h = makeSystem(LV4, [pool]);
    // Pin the enemy dead on the ship so it stays in contact range for the whole window
    // no matter how the ship is (not) moved by this system.
    const e = addEnemy(pool, h.ship.x, h.ship.y);
    openAndArm(h);
    // Run the rest of the window with the enemy still overlapping.
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      hits += h.collisionSystem.bulletDamageCount;
      h.collisionSystem.bulletDamageCount = 0;
      h.system.fixedUpdate(DT);
    }
    hits += h.collisionSystem.bulletDamageCount;
    expect(hits).toBe(1);
    expect(e.hp).toBeCloseTo(ARMORED_HP - DASH_CONTACT_DAMAGE, 10);
  });

  it('a wall-pinned enemy takes exactly ONE hit across a whole stationary window', () => {
    // This system never moves the ship, so holding it still for the whole window is
    // exactly the arena-clamp scenario: one press must not become ~10 hits.
    const pool = new Pool(createArmored);
    const h = makeSystem(LV4, [pool]);
    const e = addEnemy(pool, h.ship.x, h.ship.y);
    h.inputState.setMove(1, 0);
    pressAndStep(h.system, h.inputState);
    const ticks = Math.ceil(DASH_DURATION_MS / DT) + 2;
    for (let i = 0; i < ticks; i++) h.system.fixedUpdate(DT);
    // CollisionSystem is not stepping here, so nothing zeroes the counter between
    // ticks — it therefore accumulates the WHOLE window's credit. Exactly one, not one
    // per tick: a per-tick sweep would have pushed ~11 units into the 9.2 governor.
    expect(h.collisionSystem.bulletDamageCount).toBe(1);
    expect(e.hp).toBeCloseTo(ARMORED_HP - DASH_CONTACT_DAMAGE, 10);
  });

  it('still sweeps on the CLOSING tick, where active is false but movementActive is true', () => {
    // The sweep gate MUST read the PUBLISHED window, not `active`. On the closing tick
    // movement already applied dash velocity earlier in the tick, so an enemy the ship
    // reached in that final ~22px of travel has to take its hit. Reading `active` here
    // instead silently drops the tail of every dash — and every other sweep case in
    // this file places the enemy within 5px of the ship's start, so it lands on the
    // FIRST swept tick and can never catch that.
    const pool = new Pool(createArmored);
    const h = makeSystem(LV4, [pool]);
    h.inputState.setMove(1, 0);
    pressAndStep(h.system, h.inputState); // dash opens; movementActive still false

    const ticks = Math.ceil(DASH_DURATION_MS / DT);
    // Advance to ONE TICK BEFORE the closing tick, with no enemy anywhere near.
    for (let i = 1; i < ticks; i++) h.system.fixedUpdate(DT);
    expect(h.system.active).toBe(true);
    expect(h.system.movementActive).toBe(true);
    expect(h.collisionSystem.bulletDamageCount).toBe(0);

    // Now place the enemy in contact and run the CLOSING tick: `active` goes false in
    // step (2), yet the published window still covers this tick.
    const e = addEnemy(pool, h.ship.x, h.ship.y);
    h.system.fixedUpdate(DT);
    expect(h.system.active).toBe(false); // the window closed on THIS tick…
    expect(h.system.movementActive).toBe(true); // …but movement had already travelled
    expect(h.collisionSystem.bulletDamageCount).toBe(1);
    expect(e.hp).toBeCloseTo(ARMORED_HP - DASH_CONTACT_DAMAGE, 10);
  });

  it('a SUBSEQUENT dash can hit the same enemy again (a NEW dashSeq stamp)', () => {
    const pool = new Pool(createArmored);
    const h = makeSystem(LV4, [pool]);
    const e = addEnemy(pool, h.ship.x, h.ship.y);
    openAndArm(h);
    expect(e.hp).toBeCloseTo(ARMORED_HP - 1, 10);
    // Run the whole cooldown out, then dash again.
    for (let i = 0; i < 200; i++) h.system.fixedUpdate(DT);
    expect(h.system.cooldownRemainingMs).toBe(0);
    openAndArm(h);
    expect(h.system.dashSeq).toBe(2);
    expect(e.hp).toBeCloseTo(ARMORED_HP - 2, 10);
  });

  it('routes every hit through applyPlayerDamage with DASH_CONTACT_DAMAGE', () => {
    const pool = new Pool(createArmored);
    const h = makeSystem(LV4, [pool]);
    const e = addEnemy(pool, h.ship.x, h.ship.y);
    const calls = [];
    const real = h.collisionSystem.applyPlayerDamage.bind(h.collisionSystem);
    h.collisionSystem.applyPlayerDamage = (enemy, owner, damage) => {
      calls.push({ enemy, owner, damage });
      return real(enemy, owner, damage);
    };
    openAndArm(h);
    expect(calls).toHaveLength(1);
    expect(calls[0].enemy).toBe(e);
    expect(calls[0].owner).toBe(pool);
    expect(calls[0].damage).toBe(DASH_CONTACT_DAMAGE);
  });
});

describe('DashSystem — sanitizers', () => {
  it('_cooldownMs fails CLOSED: a missing store, missing field, junk or <= 0 means NO DASH', () => {
    const cases = [
      ['missing store', null],
      ['missing field', {}],
      ['NaN', { dashCooldownMs: NaN }],
      ['Infinity', { dashCooldownMs: Infinity }],
      ['zero', { dashCooldownMs: 0 }],
      ['negative', { dashCooldownMs: -1 }],
      ['string', { dashCooldownMs: '3000' }],
    ];
    for (const [label, stats] of cases) {
      const ship = createPlayerShip();
      const inputState = new InputState();
      const system = new DashSystem(ship, inputState, [], null, stats);
      expect(system._cooldownMs(), label).toBe(0);
      expect(system.dashEnabled(), label).toBe(false);
      // And a press really does nothing — the fail-closed DIRECTION, not just the value.
      inputState.queueDash();
      system.fixedUpdate(DT);
      expect(system.active, label).toBe(false);
      expect(system.dashSeq, label).toBe(0);
    }
  });

  it('_cooldownMs clamps a tiny POSITIVE interval UP to the floor (a rate bound, not a mint)', () => {
    const { inputState, system } = makeSystem({ dashCooldownMs: 1e-9 });
    expect(system._cooldownMs()).toBe(DASH_COOLDOWN_FLOOR_MS);
    pressAndStep(system, inputState);
    expect(system.cooldownRemainingMs).toBe(DASH_COOLDOWN_FLOOR_MS);
    // At most one dash per floor interval, never one per tick.
    let dashes = 1;
    for (let i = 0; i < 60; i++) {
      inputState.queueDash();
      system.fixedUpdate(DT);
    }
    dashes = system.dashSeq;
    expect(dashes).toBeLessThanOrEqual(Math.ceil((60 * DT) / DASH_COOLDOWN_FLOOR_MS) + 1);
    expect(dashes).toBeGreaterThan(1);
  });

  it('a shipped interval is passed through unchanged (the floor is not a lever)', () => {
    expect(makeSystem(LV2).system._cooldownMs()).toBe(3000);
    expect(makeSystem(LV4).system._cooldownMs()).toBe(2000);
  });

  it('the three FLAG readers enable only on a finite value >= 1', () => {
    const junk = [undefined, NaN, Infinity, 0, 0.5, -1, '1'];
    for (const v of junk) {
      const { system } = makeSystem({
        dashIFrames: v,
        dashDamage: v,
        dashTrail: v,
      });
      expect(system._iFramesEnabled(), `iFrames ${String(v)}`).toBe(false);
      expect(system._damageEnabled(), `damage ${String(v)}`).toBe(false);
      expect(system._trailEnabled(), `trail ${String(v)}`).toBe(false);
    }
    const { system } = makeSystem({ dashIFrames: 1, dashDamage: 1, dashTrail: 1 });
    expect(system._iFramesEnabled()).toBe(true);
    expect(system._damageEnabled()).toBe(true);
    expect(system._trailEnabled()).toBe(true);
  });

  it('a MISSING store disables everything and never throws', () => {
    const ship = createPlayerShip();
    const inputState = new InputState();
    const system = new DashSystem(ship, inputState, [], null, null);
    expect(system._cooldownMs()).toBe(0);
    expect(system._iFramesEnabled()).toBe(false);
    expect(system._damageEnabled()).toBe(false);
    expect(system._trailEnabled()).toBe(false);
    expect(system.dashEnabled()).toBe(false);
    expect(system.iFramesActive()).toBe(false);
    expect(system.trailActive()).toBe(false);
    inputState.queueDash();
    expect(() => system.fixedUpdate(DT)).not.toThrow();
    expect(system.active).toBe(false);
  });
});

describe('DashSystem — allocation', () => {
  it('allocates nothing per tick on the IDLE path', () => {
    const { system } = makeSystem(LV5);
    const collector = system._collectEnemy;
    const shape = Object.keys(system).sort();
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system._collectEnemy).toBe(collector);
    expect(Object.keys(system).sort()).toEqual(shape);
  });

  it('allocates nothing per tick on the SWEEPING path (reused scratch, length-reset)', () => {
    const pool = new Pool(createArmored);
    const h = makeSystem(LV5, [pool]);
    for (let i = 0; i < 20; i++) addEnemy(pool, h.ship.x + i * 2, h.ship.y);
    const scratchEnemies = h.system._enemies;
    const scratchOwners = h.system._owners;
    const collector = h.system._collectEnemy;
    const shape = Object.keys(h.system).sort();
    for (let d = 0; d < 3; d++) {
      h.inputState.queueDash();
      for (let i = 0; i < 200; i++) h.system.fixedUpdate(DT);
    }
    // The SAME arrays and the SAME closure across every dash and every tick.
    expect(h.system._enemies).toBe(scratchEnemies);
    expect(h.system._owners).toBe(scratchOwners);
    expect(h.system._collectEnemy).toBe(collector);
    expect(Object.keys(h.system).sort()).toEqual(shape);
    // The scratch stays bounded by the live enemy count, never accumulating.
    expect(h.system._enemies.length).toBeLessThanOrEqual(20);
    expect(h.system._owners.length).toBe(h.system._enemies.length);
  });
});
