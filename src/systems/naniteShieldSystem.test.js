import { describe, it, expect } from 'vitest';
import { NaniteShieldSystem } from './NaniteShieldSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import {
  FIXED_STEP_MS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SEEKER_RADIUS,
  SEEKER_SPEED,
  SPAWN_SAFE_RADIUS,
  SHIELD_MAX_CHARGES,
  SHIELD_RECHARGE_FLOOR_MS,
  SHIELD_ABSORB_INVULN_MS,
  SHIELD_KNOCKBACK_RADIUS,
  SHIELD_KNOCKBACK_PUSH,
  PHASE_INTEGRITY_DURATION_MS,
} from '../config/constants.js';

// Story 10.4 — NaniteShieldSystem owns the shield's RUNTIME state (the live charge
// count + the recharge timer) while the shared playerStats store owns only the derived
// MAXIMA. This suite covers the rows of the story's I/O matrix that belong to this
// system: the max sync, the recharge, tryAbsorb, the Lv5 break pulse, and all three
// junk sanitizers. The DEATH-SEAM integration (a life preserved, no deathSeq bump)
// lives in playerDeathSystem.test.js; the assembled-world chain in buildArenaWorld.test.js.

const DT = FIXED_STEP_MS;

/**
 * A shield system over a fresh ship, one seeker pool, and a real player-stat store
 * seeded with the given shield fields (the shape `recomputePlayerStats` produces).
 */
function makeSystem(stats = {}, playerState = null) {
  const ship = createPlayerShip();
  const enemyPool = new Pool(createSeeker);
  const playerStats = { ...createPlayerStats(), ...stats };
  // Story 12.5 — Phase Armor needs a collisionSystem stub with applyPlayerDamage.
  let appliedDmgSeq = 0;
  const collisionSystem = {
    applyPlayerDamage: (enemy, ownerPool, _damage) => {
      appliedDmgSeq += 1;
      enemy._appliedDmgSeq = appliedDmgSeq;
      ownerPool.release(enemy);
      collisionSystem.bulletKillCount += 1;
      return true;
    },
    killedEnemies: [],
    bulletKillCount: 0,
    bulletDamageCount: 0,
  };
  const system = new NaniteShieldSystem(ship, [enemyPool], collisionSystem, playerStats, playerState);
  return { ship, enemyPool, playerStats, system, collisionSystem };
}

function addSeeker(pool, x, y, telegraphMs = 0) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = telegraphMs;
  return s;
}

// The per-level MAXIMA the real registry folds to (pinned against the registry itself
// in playerStats.test.js — restated here as the system's input vocabulary).
const LV1 = { shieldCharges: 1, shieldRechargeMs: 20000 };
const LV3 = { shieldCharges: 2, shieldRechargeMs: 15000 };
const LV5 = { shieldCharges: 3, shieldRechargeMs: 10000, shieldKnockback: 1 };

describe('NaniteShieldSystem — max sync from the fold', () => {
  it('starts empty with no shield owned, and never gains a charge', () => {
    const { system } = makeSystem();
    expect(system.charges).toBe(0);
    expect(system.maxCharges).toBe(0);
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(0);
    expect(system.maxCharges).toBe(0);
    expect(system.absorbSeq).toBe(0);
  });

  it('FIRST ACQUISITION grants the full max immediately (the pick is usable on its own tick)', () => {
    const { playerStats, system } = makeSystem();
    // The pick's fold lands (LevelUpSystem runs earlier in the tick than this system).
    Object.assign(playerStats, LV1);
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(1);
    expect(system.charges).toBe(1); // NOT 0-waiting-a-recharge
  });

  it('a charge-count RUNG grants its delta immediately, even from an empty shield', () => {
    // The I/O matrix "level-up refill" row: owned Lv2 (max 1) with the charge already
    // SPENT, then picking Lv3 (max 2). The delta is +1, so the live count goes 0 → 1 on
    // the pick tick — you do not wait a recharge for the card you just picked, and you
    // do not get a free full refill either.
    const { playerStats, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    expect(system.charges).toBe(1);
    expect(system.tryAbsorb()).toBe(true);
    expect(system.charges).toBe(0);

    Object.assign(playerStats, LV3); // the Lv3 pick folds: max 1 → 2
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(2);
    expect(system.charges).toBe(1); // +1 delta, not a refill to 2
  });

  it('a max that DROPS clamps the live count down (an Epic 12 remnant)', () => {
    const { playerStats, system } = makeSystem(LV5);
    system.fixedUpdate(DT);
    expect(system.charges).toBe(3);
    // The store re-derives to a LOWER max (a remnant freeze, or an un-owned item).
    Object.assign(playerStats, LV1);
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(1);
    expect(system.charges).toBe(1);
    // …and all the way to nothing owned.
    Object.assign(playerStats, { shieldCharges: 0, shieldRechargeMs: 0 });
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(0);
    expect(system.charges).toBe(0);
    expect(system.tryAbsorb()).toBe(false);
  });
});

describe('NaniteShieldSystem — recharge', () => {
  it('regenerates exactly ONE charge per interval (Lv1, 20000ms)', () => {
    const { system } = makeSystem(LV1);
    system.fixedUpdate(DT); // sync + grant the first charge
    system.tryAbsorb();
    expect(system.charges).toBe(0);

    // One tick short of the interval: still empty.
    const ticks = Math.round(20000 / DT);
    for (let i = 0; i < ticks - 1; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(0);
    system.fixedUpdate(DT);
    expect(system.charges).toBe(1);
  });

  it('never exceeds the max, and the timer idles at the cap', () => {
    // The I/O matrix "recharge at cap" row: at Lv3 with both charges live, any amount
    // of elapsed time leaves the count at 2 and the accumulator at 0.
    const { system } = makeSystem(LV3);
    system.fixedUpdate(DT);
    expect(system.charges).toBe(2);
    for (let i = 0; i < 5000; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(2);
    expect(system.maxCharges).toBe(2);
    expect(system._rechargeMs).toBe(0);
  });

  it('a later break starts a FULL interval (no banked idle time)', () => {
    // The reason the timer resets at the cap: idling full for a minute must not make
    // the next break refill instantly.
    const { system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    for (let i = 0; i < 3600; i++) system.fixedUpdate(DT); // ~60s idling at the cap
    expect(system.charges).toBe(1);

    system.tryAbsorb();
    const ticks = Math.round(20000 / DT);
    for (let i = 0; i < ticks - 1; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(0); // still recharging — the wait was not skipped
    system.fixedUpdate(DT);
    expect(system.charges).toBe(1);
  });

  it('a max DROP that lands the count AT the cap discards the banked partial interval', () => {
    // The at-cap early return zeroes the accumulator, and this is its only REACHABLE
    // path with a non-zero accumulator: `_rechargeMs += dt` sits BELOW the cap guard,
    // so idling full can never bank time. Getting there needs a partial recharge in
    // flight (charges < max) that a max DROP then turns into charges >= max.
    const { playerStats, system } = makeSystem(LV3); // max 2, 15000ms
    system.fixedUpdate(DT);
    expect(system.charges).toBe(2);
    system.tryAbsorb(); // 1 of 2 — now recharging
    for (let i = 0; i < Math.round(5000 / DT); i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(1);
    expect(system._rechargeMs).toBeGreaterThan(0); // ~5000ms banked, mid-interval

    // The store re-derives to max 1: the live count is already AT the new cap.
    Object.assign(playerStats, LV1);
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(1);
    expect(system.charges).toBe(1);
    expect(system._rechargeMs).toBe(0); // the in-flight interval is discarded, not banked

    // …so the NEXT break waits a full interval rather than ~5000ms less.
    system.tryAbsorb();
    const ticks = Math.round(20000 / DT);
    for (let i = 0; i < ticks - 1; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(0);
    system.fixedUpdate(DT);
    expect(system.charges).toBe(1);
  });

  it('refills a MULTI-charge shield one charge per interval, not all at once', () => {
    const { system } = makeSystem(LV3); // max 2, 15000ms
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    expect(system.charges).toBe(0);

    // +1 tick absorbs the fixed step's float residue (900 × 16.666… lands a hair under
    // 15000ms). The claim is one charge per interval, not the exact landing tick.
    const ticks = Math.round(15000 / DT) + 1;
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(1); // exactly ONE — not both at once
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    expect(system.charges).toBe(2);
  });
});

describe('NaniteShieldSystem — tryAbsorb', () => {
  it('returns false and changes nothing with 0 live charges', () => {
    const { system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    expect(system.tryAbsorb()).toBe(true);
    // Empty now — the I/O matrix "empty shield" row: a shield at 0 saves nothing.
    expect(system.tryAbsorb()).toBe(false);
    expect(system.charges).toBe(0);
    expect(system.absorbSeq).toBe(1); // NOT bumped by the refused call
  });

  it('spends one charge and bumps absorbSeq per successful absorb', () => {
    const { system } = makeSystem(LV5);
    system.fixedUpdate(DT);
    expect(system.charges).toBe(3);
    expect(system.tryAbsorb()).toBe(true);
    expect(system.charges).toBe(2);
    expect(system.absorbSeq).toBe(1);
    expect(system.tryAbsorb()).toBe(true);
    expect(system.charges).toBe(1);
    expect(system.absorbSeq).toBe(2);
  });

  it('absorbSeq distinguishes an absorb from a recharge on a tick where both land', () => {
    // The whole reason the latch is published: the NET `charges` delta across an absorb
    // + a recharge is 0, so without absorbSeq an absorb is invisible.
    const { system } = makeSystem(LV3);
    system.fixedUpdate(DT);
    system.tryAbsorb(); // 2 → 1
    const before = system.charges;
    // Step until the recharge actually lands (bounded — the interval is 15000ms).
    let landed = false;
    for (let i = 0; i < 2000 && !landed; i++) {
      system.fixedUpdate(DT);
      landed = system.charges === 2;
    }
    expect(landed).toBe(true); // the recharge landed: 1 → 2 …
    system.tryAbsorb(); // … and an absorb lands on that same tick: 2 → 1
    expect(system.charges).toBe(before); // net zero…
    expect(system.absorbSeq).toBe(2); // …but the absorb is still observable
  });

  it('never goes negative under repeated absorb attempts', () => {
    const { system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    for (let i = 0; i < 10; i++) system.tryAbsorb();
    expect(system.charges).toBe(0);
    expect(system.absorbSeq).toBe(1);
  });
});

describe('NaniteShieldSystem — the Lv5 break pulse', () => {
  // Displacement at distance d: SHIELD_KNOCKBACK_PUSH × (1 − d/SHIELD_KNOCKBACK_RADIUS).
  function expectedPush(d) {
    return SHIELD_KNOCKBACK_PUSH * (1 - d / SHIELD_KNOCKBACK_RADIUS);
  }

  // `expectedPush` is derived from SHIELD_KNOCKBACK_PUSH, so every falloff assertion
  // below is tautological in the constant's magnitude — it pins the SHAPE of the
  // falloff, not its size. This pins the size, against the independent quantities the
  // constant's own comment bounds it by.
  it('the contact-range push stays a personal-space clear, not a screen clear', () => {
    const contactPush = expectedPush(30); // an enemy in lethal contact at ~30px
    // Below SPAWN_SAFE_RADIUS — the game's own "clear of the player" distance. Above it
    // the Lv5 break would be teleporting the swarm off the player's screen.
    expect(contactPush).toBeLessThan(SPAWN_SAFE_RADIUS);
    // …and above the distance a SEEKER re-closes within the absorb window, so the pulse
    // buys separation that outlives the i-frames rather than evaporating inside them.
    expect(contactPush).toBeGreaterThan((SEEKER_SPEED * SHIELD_ABSORB_INVULN_MS) / 1000);
  });

  it('pushes enemies outward with LINEAR falloff, and not at all beyond the radius', () => {
    // The I/O matrix "Lv5 final break" row: three enemies at 30 / 150 / 300 px.
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const near = addSeeker(enemyPool, ship.x + 30, ship.y);
    const mid = addSeeker(enemyPool, ship.x + 150, ship.y);
    const far = addSeeker(enemyPool, ship.x + 300, ship.y);
    system.fixedUpdate(DT);

    // Drain to the FINAL charge, then break it.
    system.tryAbsorb();
    system.tryAbsorb();
    expect(near.x).toBe(ship.x + 30); // nothing moved on the non-final breaks
    expect(system.tryAbsorb()).toBe(true);
    expect(system.charges).toBe(0);

    expect(near.x).toBeCloseTo(ship.x + 30 + expectedPush(30), 9); // ~159px push
    expect(mid.x).toBeCloseTo(ship.x + 150 + expectedPush(150), 9); // ~76px push
    expect(far.x).toBe(ship.x + 300); // outside the radius — untouched
    // Purely radial: the perpendicular axis is unchanged.
    expect(near.y).toBe(ship.y);
    expect(mid.y).toBe(ship.y);
  });

  it('pushes along the true radial direction (diagonal case), preserving the magnitude', () => {
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const d = 100;
    const e = addSeeker(enemyPool, ship.x + d * 0.6, ship.y + d * 0.8);
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();

    const moved = Math.hypot(e.x - ship.x, e.y - ship.y);
    expect(moved).toBeCloseTo(d + expectedPush(d), 9);
    // Same bearing from the ship as before (a pure outward displacement).
    expect((e.x - ship.x) / moved).toBeCloseTo(0.6, 9);
    expect((e.y - ship.y) / moved).toBeCloseTo(0.8, 9);
  });

  it('fires ONLY on the FINAL charge — a 3→2 or 2→1 break moves nothing', () => {
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const e = addSeeker(enemyPool, ship.x + 40, ship.y);
    system.fixedUpdate(DT);

    system.tryAbsorb(); // 3 → 2
    expect(e.x).toBe(ship.x + 40);
    system.tryAbsorb(); // 2 → 1
    expect(e.x).toBe(ship.x + 40);
    system.tryAbsorb(); // 1 → 0: the FINAL break
    expect(e.x).toBeGreaterThan(ship.x + 40);
  });

  it('does not fire below Lv5 (shieldKnockback 0), however final the break', () => {
    // The I/O matrix "break below Lv5" row — Lv4 is max 2 with no knockback flag.
    const { ship, enemyPool, system } = makeSystem({
      shieldCharges: 2,
      shieldRechargeMs: 10000,
    });
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const e = addSeeker(enemyPool, ship.x + 40, ship.y);
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb(); // the final charge breaks
    expect(system.charges).toBe(0);
    expect(e.x).toBe(ship.x + 40);
    expect(e.y).toBe(ship.y);
  });

  it('SKIPS a telegraphing (spawning-in) enemy', () => {
    // The I/O matrix "pulse vs telegraphing enemy" row: a spawning-in enemy is inert to
    // world forces, exactly as BlackHoleSystem gravity treats it.
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const spawning = addSeeker(enemyPool, ship.x + 40, ship.y, 300);
    const active = addSeeker(enemyPool, ship.x - 40, ship.y);
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();

    expect(spawning.x).toBe(ship.x + 40); // untouched
    expect(spawning.y).toBe(ship.y);
    expect(active.x).toBeLessThan(ship.x - 40); // its neighbor moved
  });

  it('writes NO NaN for an enemy exactly on the ship (d === 0, no direction)', () => {
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const e = addSeeker(enemyPool, ship.x, ship.y);
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();

    expect(Number.isFinite(e.x)).toBe(true);
    expect(Number.isFinite(e.y)).toBe(true);
    expect(e.x).toBe(ship.x); // skipped entirely
    expect(e.y).toBe(ship.y);
  });

  it('clamps every pushed enemy inside the arena interior, inset by its own radius', () => {
    // A break with the ship against each wall: the shove must not put an enemy outside
    // the drawn border (the ARENA_BORDER_INSET + radius convention).
    const minX = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SEEKER_RADIUS;
    const minY = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SEEKER_RADIUS;
    // The ship sits one hug-distance inside each corner, so all four hugging enemies
    // START INSIDE the border — the clamp only ever applies to those (an enemy that was
    // already outside is left alone; see the out-of-bounds case below).
    const HUG = 20;
    const corners = [
      [minX + HUG, minY + HUG],
      [maxX - HUG, minY + HUG],
      [minX + HUG, maxY - HUG],
      [maxX - HUG, maxY - HUG],
    ];
    for (const [sx, sy] of corners) {
      const { ship, enemyPool, system } = makeSystem(LV5);
      ship.x = sx;
      ship.y = sy;
      // Four enemies hugging the ship on each axis, so at least one is shoved straight
      // at the nearest wall from every corner.
      const es = [
        addSeeker(enemyPool, sx + HUG, sy),
        addSeeker(enemyPool, sx - HUG, sy),
        addSeeker(enemyPool, sx, sy + HUG),
        addSeeker(enemyPool, sx, sy - HUG),
      ];
      const before = es.map((e) => Math.hypot(e.x - sx, e.y - sy));
      system.fixedUpdate(DT);
      system.tryAbsorb();
      system.tryAbsorb();
      system.tryAbsorb();
      es.forEach((e, i) => {
        expect(e.x).toBeGreaterThanOrEqual(minX);
        expect(e.x).toBeLessThanOrEqual(maxX);
        expect(e.y).toBeGreaterThanOrEqual(minY);
        expect(e.y).toBeLessThanOrEqual(maxY);
        // …and the clamp never dragged one back TOWARD the ship.
        expect(Math.hypot(e.x - sx, e.y - sy)).toBeGreaterThanOrEqual(before[i]);
      });
      // At least one WAS clamped (otherwise this case proves nothing).
      expect(es.some((e) => e.x === minX || e.x === maxX || e.y === minY || e.y === maxY))
        .toBe(true);
    }
  });

  it('never drags an ALREADY-OUT-OF-BOUNDS enemy back toward the ship, on ANY border', () => {
    // Enemies legitimately sit OUTSIDE the drawn border: SnakeSystem.spawn trails body
    // segments back along the direction opposite the inward heading (up to ~154px out),
    // and every segment un-telegraphs together — so an active enemy beyond a bound is
    // reachable by the pulse. Clamping such an enemy back to the border would MOVE IT
    // TOWARD the ship, i.e. the pulse doing the exact opposite of its job. An axis is
    // therefore clamped only when the enemy started inside that bound.
    //
    // All FOUR borders are driven, not just the left one: `SnakeSystem.spawn` picks its
    // edge uniformly, so a top/bottom/right out-of-bounds enemy is exactly as common. A
    // left-only case leaves the other three `if (e.x <= maxX)` / `if (e.y >= minY)` /
    // `if (e.y <= maxY)` guards free to be deleted by a "simplify the clamp" edit — the
    // very edit the guard exists to prevent — with the suite still green.
    const minX = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SEEKER_RADIUS;
    const minY = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SEEKER_RADIUS;
    const OUT = 100; // how far beyond the bound the enemy starts
    const IN = 50; // how far inside the bound the ship sits (150px apart, inside the radius)
    // [label, ship, enemy, the axis the push acts on, the outward sign on that axis]
    const borders = [
      ['left', { x: minX + IN, y: ARENA_HEIGHT / 2 }, { x: minX - OUT, y: ARENA_HEIGHT / 2 }, 'x', -1],
      ['right', { x: maxX - IN, y: ARENA_HEIGHT / 2 }, { x: maxX + OUT, y: ARENA_HEIGHT / 2 }, 'x', 1],
      ['top', { x: ARENA_WIDTH / 2, y: minY + IN }, { x: ARENA_WIDTH / 2, y: minY - OUT }, 'y', -1],
      ['bottom', { x: ARENA_WIDTH / 2, y: maxY - IN }, { x: ARENA_WIDTH / 2, y: maxY + OUT }, 'y', 1],
    ];
    for (const [label, shipAt, enemyAt, axis, outward] of borders) {
      const { ship, enemyPool, system } = makeSystem(LV5);
      ship.x = shipAt.x;
      ship.y = shipAt.y;
      const e = addSeeker(enemyPool, enemyAt.x, enemyAt.y);
      const startOnAxis = e[axis];
      const before = Math.hypot(e.x - ship.x, e.y - ship.y);
      system.fixedUpdate(DT);
      system.tryAbsorb();
      system.tryAbsorb();
      system.tryAbsorb();

      const after = Math.hypot(e.x - ship.x, e.y - ship.y);
      // The invariant, stated directly: the pulse never brings an enemy CLOSER.
      expect(after, label).toBeGreaterThanOrEqual(before);
      // Pushed FURTHER out along the outward normal, not snapped back to the border.
      expect((e[axis] - startOnAxis) * outward, label).toBeGreaterThan(0);
      expect(e[axis], label).not.toBe(outward < 0 ? (axis === 'x' ? minX : minY) : axis === 'x' ? maxX : maxY);
    }
  });

  it('writes NO NaN at a DENORMAL separation (the push/d overflow trap)', () => {
    // d > 0 but denormal: a `push / d` scale factor overflows to Infinity, and
    // `0 * Infinity` is NaN — which the interior clamp cannot catch either, because every
    // `<` / `>` comparison against NaN is false, so the NaN would be stored. Building the
    // displacement from UNIT components (|dx/d| <= 1) keeps it finite.
    // The origin, so the denormal separation SURVIVES the addition (at arena-centre
    // magnitudes `360 + 5e-324` rounds straight back to 360 and d would be 0 — the
    // already-covered no-direction skip, not this trap).
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = 0;
    ship.y = 0;
    const e = addSeeker(enemyPool, 0, Number.MIN_VALUE);
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();

    expect(Number.isNaN(e.x)).toBe(false);
    expect(Number.isNaN(e.y)).toBe(false);
    expect(Number.isFinite(e.x)).toBe(true);
    expect(Number.isFinite(e.y)).toBe(true);
    // The perpendicular axis carries no displacement at all…
    expect(e.x).toBe(0);
    // …and the (vanishingly small) separation still resolves to a full outward push.
    expect(e.y).toBeCloseTo(SHIELD_KNOCKBACK_PUSH, 6);
  });

  it('KILLS, releases and scores nothing — it only MOVES enemies', () => {
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const e = addSeeker(enemyPool, ship.x + 30, ship.y);
    const before = { ...e };
    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();

    // Still active in its pool, with every non-positional field untouched.
    expect(enemyPool.activeCount).toBe(1);
    expect(enemyPool.freeCount).toBe(0);
    expect(e.vx).toBe(before.vx); // a POSITION nudge, never a velocity impulse
    expect(e.vy).toBe(before.vy);
    expect(e.score).toBe(before.score);
    expect(e.xp).toBe(before.xp);
    expect(e.radius).toBe(before.radius);
    expect(e.hp).toBe(before.hp);
  });

  it('reaches every pool it was given (all five combat archetypes, one collector)', () => {
    const ship = createPlayerShip();
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const playerStats = { ...createPlayerStats(), ...LV5 };
    const collisionSystem = {
      applyPlayerDamage: (enemy, ownerPool) => {
        ownerPool.release(enemy);
        return true;
      },
    };
    const system = new NaniteShieldSystem(ship, [seekers, squares], collisionSystem, playerStats);
    const s = addSeeker(seekers, ship.x + 50, ship.y);
    const q = squares.acquire();
    q.x = ship.x;
    q.y = ship.y + 50;
    q.telegraphMs = 0;

    system.fixedUpdate(DT);
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();

    expect(s.x).toBeGreaterThan(ship.x + 50);
    expect(q.y).toBeGreaterThan(ship.y + 50);
  });
});

describe('NaniteShieldSystem — sanitizers (SAFETY guards, never balance levers)', () => {
  // The sanitizer cases below all assert `toBe(SHIELD_*)`, which pins the WIRING but
  // not the MAGNITUDE — the guards would still "pass" retuned to values that no longer
  // bound anything. These two pin the properties the constants' comments claim.
  it('SHIELD_RECHARGE_FLOOR_MS bounds the refill RATE at one charge per second', () => {
    // What the floor's comment promises a corrupted store cannot exceed. At a floor of
    // 1ms this is 1000 charges/sec — the cap would refill in 3 ticks.
    expect(1000 / SHIELD_RECHARGE_FLOOR_MS).toBeLessThanOrEqual(1);
    // …and it stays a SAFETY guard rather than a lever: an order of magnitude below the
    // fastest shipped rung (10000ms at Lv4/Lv5), so no authored build reaches it.
    expect(SHIELD_RECHARGE_FLOOR_MS * 10).toBeLessThanOrEqual(10000);
  });

  it('SHIELD_MAX_CHARGES sits well above the shipped maximum (slack, not a lever)', () => {
    // The Lv5 max is 3. The clamp is the refill loop's real termination guard, so it
    // must stay comfortably clear of every authorable value rather than tracking it.
    expect(SHIELD_MAX_CHARGES).toBeGreaterThanOrEqual(3 * 2);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk max charges (%s) → no shield at all', (_label, v) => {
    const { system } = makeSystem({ shieldCharges: v, shieldRechargeMs: 20000 });
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(0);
    expect(system.charges).toBe(0);
    expect(system.tryAbsorb()).toBe(false);
  });

  it('a FRACTIONAL max is floored to a whole charge', () => {
    const { system } = makeSystem({ shieldCharges: 1.7, shieldRechargeMs: 20000 });
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(1);
    expect(system.charges).toBe(1);
  });

  it('an ABSURD max clamps to SHIELD_MAX_CHARGES (the refill loop stays bounded)', () => {
    const { system } = makeSystem({ shieldCharges: 1e9, shieldRechargeMs: 20000 });
    system.fixedUpdate(DT);
    expect(system.maxCharges).toBe(SHIELD_MAX_CHARGES);
    expect(system.charges).toBe(SHIELD_MAX_CHARGES);
  });

  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -5],
    ['sub-floor', 1e-9],
    ['a string', 'x'],
    ['undefined', undefined],
  ])(
    'junk recharge (%s) → the floor, and the refill loop TERMINATES',
    (_label, v) => {
      const { system } = makeSystem({ shieldCharges: 3, shieldRechargeMs: v });
      system.fixedUpdate(DT);
      expect(system._rechargeIntervalMs()).toBe(SHIELD_RECHARGE_FLOOR_MS);
      // Drain, then hand the system a single ENORMOUS dt. Without the floor this loop
      // would mint charges forever; with it, one floor-interval per charge and the cap
      // stops it. (The call returning at all is the assertion.)
      system.tryAbsorb();
      system.tryAbsorb();
      system.tryAbsorb();
      expect(system.charges).toBe(0);
      system.fixedUpdate(1e12);
      expect(system.charges).toBe(3);
      expect(system._rechargeMs).toBe(0);
    },
  );

  it.each([
    ['NaN', NaN],
    ['negative', -1],
    ['a string', 'x'],
    ['undefined', undefined],
    ['below 1', 0.5],
  ])('junk knockback (%s) → the pulse is disabled', (_label, v) => {
    const { ship, enemyPool, system } = makeSystem({
      shieldCharges: 1,
      shieldRechargeMs: 10000,
      shieldKnockback: v,
    });
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const e = addSeeker(enemyPool, ship.x + 40, ship.y);
    system.fixedUpdate(DT);
    expect(system._knockbackEnabled()).toBe(false);
    system.tryAbsorb();
    expect(system.charges).toBe(0);
    expect(e.x).toBe(ship.x + 40);
  });

  it('a MISSING store (legacy stub) means max 0, no absorb ever, no throw', () => {
    // The I/O matrix "missing store" row: `playerStats` defaults to null.
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const system = new NaniteShieldSystem(ship, [enemyPool]);
    expect(system.playerStats).toBeNull();
    expect(() => {
      for (let i = 0; i < 100; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.maxCharges).toBe(0);
    expect(system.charges).toBe(0);
    expect(system.tryAbsorb()).toBe(false);
    expect(system.absorbSeq).toBe(0);
  });
});

describe('NaniteShieldSystem — allocation', () => {
  it('allocates nothing per tick on the idle path (scalar state, one hoisted collector)', () => {
    const { enemyPool, system } = makeSystem(LV5);
    addSeeker(enemyPool, 500, 500);
    const collector = system._pushEnemy;
    const shape = Object.keys(system).sort();
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    // The pool is untouched (the system owns none and acquires nothing)…
    expect(enemyPool.activeCount + enemyPool.freeCount).toBe(1);
    // …the per-pool iteration callback is the SAME closure (never a fresh arrow)…
    expect(system._pushEnemy).toBe(collector);
    // …and no field was added to the instance across the run.
    expect(Object.keys(system).sort()).toEqual(shape);
  });

  it('allocates nothing on a BREAK either (the pulse iterates the pools in place)', () => {
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    for (let i = 0; i < 20; i++) addSeeker(enemyPool, ship.x + 10 + i, ship.y);
    system.fixedUpdate(DT);
    const total = enemyPool.activeCount + enemyPool.freeCount;
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();
    // No enemy released, none acquired, no materialization pass into the pool.
    expect(enemyPool.activeCount).toBe(20);
    expect(enemyPool.activeCount + enemyPool.freeCount).toBe(total);
  });
});

// --- Phase Armor (Story 12.5 / Epic 12 — defense-transform Epic) ------------

describe('NaniteShieldSystem — Phase Armor (Story 12.5)', () => {
  it('phaseActive=false: knockback fires on final charge (negative control)', () => {
    const { ship, enemyPool, system } = makeSystem(LV5);
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    // Place enemies within knockback radius.
    for (let i = 0; i < 5; i++) {
      addSeeker(enemyPool, ship.x + 50 * (i + 1), ship.y);
    }
    // tick first to sync max from playerStats (which has Lv5 maxCharges=3).
    system.fixedUpdate(DT);
    // Drain all 3 charges (Lv5).
    expect(system.tryAbsorb()).toBe(true);
    expect(system.tryAbsorb()).toBe(true);
    expect(system.tryAbsorb()).toBe(true);
    // The pulse moved at least one enemy (knockback radius is 260).
    expect(system.absorbSeq).toBe(3);
  });

  it('phaseActive=true: knockback suppressed, phaseIntangible set true on final charge', () => {
    const playerState = { phaseIntangible: false };
    const { ship, enemyPool, system } = makeSystem(LV5, playerState);
    // Enable phase armor.
    system.phaseActive = true;
    // tick first to sync max.
    system.fixedUpdate(DT);
    // Drain all 3 charges (Lv5).
    system.tryAbsorb();
    system.tryAbsorb();
    system.tryAbsorb();
    // absorbSeq bumped, phaseIntangible set.
    expect(system.absorbSeq).toBe(3);
    expect(playerState.phaseIntangible).toBe(true);
    // Phase timer was set to the full duration.
    expect(system._phaseTimerMs).toBe(PHASE_INTEGRITY_DURATION_MS);
  });

  it('phase timer counts down in fixedUpdate, deactivates at zero', () => {
    const playerState = { phaseIntangible: false };
    const { ship, enemyPool, system } = makeSystem(LV5, playerState);
    system.phaseActive = true;
    playerState.phaseIntangible = true;
    system._phaseTimerMs = PHASE_INTEGRITY_DURATION_MS;
    // Tick for 2001ms (just past 2s at 60fps = 121 ticks).
    for (let i = 0; i < 121; i++) system.fixedUpdate(DT);
    // Phase should now be deactivated.
    expect(system.phaseActive).toBe(false);
    expect(playerState.phaseIntangible).toBe(false);
    expect(system._phaseTimerMs).toBeLessThanOrEqual(0);
  });

  it('phase sweep damages overlapping enemies via applyPlayerDamage', () => {
    const playerState = { phaseIntangible: false };
    const { ship, enemyPool, system, collisionSystem } = makeSystem(LV5, playerState);
    ship.x = 500;
    ship.y = 300;
    // Enable phase and set timer.
    system.phaseActive = true;
    system._phaseTimerMs = 1000;
    playerState.phaseIntangible = true;
    // Place an enemy overlapping the ship.
    addSeeker(enemyPool, ship.x, ship.y);
    // Pre-bulletKillCount for delta check.
    const preKills = collisionSystem.bulletKillCount;
    // Tick fixedUpdate — triggers _phaseSweep.
    system.fixedUpdate(DT);
    // Enemy should have been killed (1 damage = 1-HP enemy).
    expect(collisionSystem.bulletKillCount).toBeGreaterThanOrEqual(preKills + 1);
  });

  it('phase sweep skips telegraphing enemies', () => {
    const playerState = { phaseIntangible: false };
    const { ship, enemyPool, system, collisionSystem } = makeSystem(LV5, playerState);
    ship.x = 500;
    ship.y = 300;
    system.phaseActive = true;
    system._phaseTimerMs = 1000;
    playerState.phaseIntangible = true;
    // Place a telegraphing enemy.
    addSeeker(enemyPool, ship.x, ship.y, 500);
    const preKills = collisionSystem.bulletKillCount;
    system.fixedUpdate(DT);
    // Telegraphing enemy should NOT be damaged.
    expect(collisionSystem.bulletKillCount).toBe(preKills);
  });

  it('phase sweep skips stunned enemies', () => {
    const playerState = { phaseIntangible: false };
    const { ship, enemyPool, system, collisionSystem } = makeSystem(LV5, playerState);
    ship.x = 500;
    ship.y = 300;
    system.phaseActive = true;
    system._phaseTimerMs = 1000;
    playerState.phaseIntangible = true;
    const e = addSeeker(enemyPool, ship.x, ship.y, 0);
    e.stunMs = 100; // Stunned -> immune.
    const preKills = collisionSystem.bulletKillCount;
    system.fixedUpdate(DT);
    expect(collisionSystem.bulletKillCount).toBe(preKills);
  });

  it('shield recharges during phase, but new charge does NOT extend window', () => {
    const playerState = { phaseIntangible: false };
    const { ship, enemyPool, system } = makeSystem(LV5, playerState);
    system.phaseActive = true;
    playerState.phaseIntangible = true;
    // Start phase with 2000ms and already-drained charges.
    system._phaseTimerMs = 2000;
    system.charges = 0;
    system.maxCharges = 3;
    // Let time pass: at Lv5, rechargeIntervalMs = 10000ms, so charges fill slowly.
    // Use a faster recharge for testing: inject a faster playerStats.
    const fastStats = { shieldCharges: 3, shieldRechargeMs: 100, shieldKnockback: 1 };
    system.playerStats = fastStats;
    const preTime = system._phaseTimerMs;
    // Tick 50 times = 833ms.
    for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    // Phase timer should have ticked down by ~833ms.
    expect(system._phaseTimerMs).toBeLessThan(preTime);
    // Phase should still be active.
    expect(system.phaseActive).toBe(true);
    expect(playerState.phaseIntangible).toBe(true);
  });

  it('null playerState: does not throw when activating phase', () => {
    // Collision system without collisionSystem -> _phaseSweep returns.
    const { enemyPool, system } = makeSystem(LV5);
    system.phaseActive = true;
    system._phaseTimerMs = 1000;
    // Should not throw even with null playerState.
    expect(() => system.fixedUpdate(DT)).not.toThrow();
  });

  it('null collisionSystem: _phaseSweep does not throw', () => {
    // Ship created without collisionSystem.
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const system = new NaniteShieldSystem(
      ship,
      [enemyPool],
      null,  // collisionSystem = null
      createPlayerStats(),
    );
    system.phaseActive = true;
    system._phaseTimerMs = 1000;
    addSeeker(enemyPool, ship.x + 10, ship.y);
    expect(() => system.fixedUpdate(DT)).not.toThrow();
  });
});
