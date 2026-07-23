import { describe, it, expect } from 'vitest';
import { FiringSystem } from './FiringSystem.js';
import { InputState } from '../input/InputState.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  FIRE_INTERVAL_MS,
  FIRE_INTERVAL_FLOOR_MS,
  FIRE_INTERVAL_CEIL_MS,
  PLAYER_BULLET_BASE_DAMAGE,
  PLAYER_BULLET_MIN_DAMAGE,
  BULLET_SPEED,
  BULLET_POOL_PREWARM,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Build a ship + input + firing-system triad. `aim` seeds the aim channel via
// setAim (normalized exactly as the real sampler would leave it). `playerStats`
// (Story 10.2) is OPTIONAL — omitted, the system is constructed with two args
// exactly as every pre-10.2 caller did.
function makeSystem({
  ship: shipOverrides = {},
  aim = null,
  playerStats = undefined,
} = {}) {
  const ship = { ...createPlayerShip(), ...shipOverrides };
  const input = new InputState();
  if (aim) {
    input.setAim(aim[0], aim[1]);
  }
  const system =
    playerStats === undefined
      ? new FiringSystem(ship, input)
      : new FiringSystem(ship, input, playerStats);
  return { ship, input, system };
}

// Count total spawns over `ticks` steps of `tickMs` via an acquire spy — bullets
// despawn as they leave the arena, so activeCount would undercount the shots
// actually fired.
function countSpawns(system, tickMs, ticks) {
  let spawns = 0;
  const orig = system.bulletPool.acquire.bind(system.bulletPool);
  system.bulletPool.acquire = () => {
    spawns++;
    return orig();
  };
  for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
  return spawns;
}

// Materialize the active bullets into an array (tests only — the hot path never
// allocates like this).
function activeBullets(system) {
  const out = [];
  system.bulletPool.forEachActive((b) => out.push(b));
  return out;
}

describe('FiringSystem', () => {
  it('spawns one bullet on the first active tick (seeded accumulator)', () => {
    const { system } = makeSystem({ aim: [0, 1] });
    expect(system.bulletPool.activeCount).toBe(0);
    system.fixedUpdate(DT);
    expect(system.bulletPool.activeCount).toBe(1);
  });

  it('reuses the same hoisted expired-collector reference across ticks (NFR2)', () => {
    // The collector is a stable constructor instance field, not a fresh per-tick
    // closure — so forEachActive allocates no arrow per tick.
    const { system } = makeSystem({ aim: [0, 1] });
    const ref = system._collectExpired;
    system.fixedUpdate(DT);
    expect(system._collectExpired).toBe(ref);
  });

  it('fires at a fixed cadence independent of tick size', () => {
    const T = 900; // ms of held aim

    // Fine ticks: DT-sized slices summing to exactly T.
    const fine = makeSystem({ aim: [1, 0] });
    const fineCount = countSpawns(fine.system, DT, Math.round(T / DT));

    // Coarse ticks: interval-sized slices summing to the same T.
    const coarse = makeSystem({ aim: [1, 0] });
    const coarseCount = countSpawns(
      coarse.system,
      FIRE_INTERVAL_MS,
      Math.round(T / FIRE_INTERVAL_MS),
    );

    // Both tick sizes fire the same number of shots.
    expect(fineCount).toBe(coarseCount);
    // ≈ floor(T / FIRE_INTERVAL_MS), ± the seeded first shot.
    const base = Math.floor(T / FIRE_INTERVAL_MS);
    expect(fineCount).toBeGreaterThanOrEqual(base);
    expect(fineCount).toBeLessThanOrEqual(base + 1);
  });

  it('bullet velocity comes only from aim, never the ship velocity (FR1)', () => {
    const { system } = makeSystem({
      ship: { vx: 999, vy: -777 },
      aim: [0, 1],
    });
    system.fixedUpdate(DT);
    const [b] = activeBullets(system);
    expect(b.vx).toBe(0);
    expect(b.vy).toBeCloseTo(BULLET_SPEED, 6);
  });

  it('spawns from the ship nose along the aim direction', () => {
    const ax = 0.6;
    const ay = 0.8; // already a unit vector
    const { ship, system } = makeSystem({
      ship: { x: 400, y: 300 },
      aim: [ax, ay],
    });
    system.fixedUpdate(DT);
    const [b] = activeBullets(system);
    // A bullet spawns after the integrate pass, so on its spawn tick it sits
    // exactly at the nose origin (x + ax*radius, y + ay*radius) — no travel yet.
    expect(b.x).toBeCloseTo(ship.x + ax * ship.radius, 6);
    expect(b.y).toBeCloseTo(ship.y + ay * ship.radius, 6);
  });

  it('spawns nothing while aim is inactive, but keeps in-flight bullets moving', () => {
    // Fire one bullet, then release aim.
    const { input, system } = makeSystem({ aim: [1, 0] });
    system.fixedUpdate(DT);
    expect(system.bulletPool.activeCount).toBe(1);
    const [b] = activeBullets(system);
    const xBefore = b.x;

    input.clearAim();
    system.fixedUpdate(DT);
    // No new spawn...
    expect(system.bulletPool.activeCount).toBe(1);
    // ...but the existing bullet still advanced.
    expect(b.x).toBeGreaterThan(xBefore);
    expect(b.x).toBeCloseTo(xBefore + BULLET_SPEED * (DT / 1000), 6);
  });

  it('integrates bullet position by v*dtSec each tick, count unchanged pre-boundary', () => {
    const { input, system } = makeSystem({
      ship: { x: 200, y: 360 },
      aim: [1, 0],
    });
    system.fixedUpdate(DT); // spawn
    input.clearAim();
    const [b] = activeBullets(system);
    const dtSec = DT / 1000;
    const start = b.x;
    system.fixedUpdate(DT);
    system.fixedUpdate(DT);
    expect(b.x).toBeCloseTo(start + 2 * BULLET_SPEED * dtSec, 6);
    expect(system.bulletPool.activeCount).toBe(1);
  });

  it('despawns a bullet back to the pool when its center crosses the border', () => {
    // Ship hugging the right interior wall, aiming right: the bullet leaves the
    // arena within a few ticks.
    const nearRight = ARENA_WIDTH - ARENA_BORDER_INSET - 1;
    const { input, system } = makeSystem({
      ship: { x: nearRight, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
    });
    system.fixedUpdate(DT); // spawn (already just past the inset via nose offset + travel)
    input.clearAim(); // isolate: no further spawns

    // Advance until it despawns.
    let guard = 0;
    while (system.bulletPool.activeCount > 0 && guard < 100) {
      system.fixedUpdate(DT);
      guard++;
    }
    expect(system.bulletPool.activeCount).toBe(0);
    expect(system.bulletPool.freeCount).toBeGreaterThan(0);
  });

  it('never grows the pool past the prewarm under sustained fire (NFR2)', () => {
    // At construction the pool is fully prewarmed and nothing is checked out.
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
    });
    expect(system.bulletPool.freeCount).toBe(BULLET_POOL_PREWARM);
    expect(system.bulletPool.activeCount).toBe(0);

    // Hold aim active for a sustained run. Ship centered so bullets leave the
    // arena and despawn, keeping peak in-flight well under the prewarm. If total
    // capacity ever exceeded the prewarm, the factory ran — i.e. the steady
    // state allocated. Assert it never does, on every tick.
    for (let i = 0; i < 500; i++) {
      system.fixedUpdate(DT);
      expect(
        system.bulletPool.activeCount + system.bulletPool.freeCount,
      ).toBeLessThanOrEqual(BULLET_POOL_PREWARM);
    }
  });

  // --- Story 4.5: read-only shotsFiredCount latch (the fire-event source) -----
  it('shotsFiredCount tracks the bullets spawned this tick (1 per fire interval)', () => {
    const { system } = makeSystem({ aim: [0, 1] });
    // Fresh system reports 0 before any tick.
    expect(system.shotsFiredCount).toBe(0);
    // First active tick fires exactly one bullet (seeded accumulator).
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(1);
  });

  it('shotsFiredCount resets to 0 each tick (per-tick latch, not cumulative)', () => {
    const { input, system } = makeSystem({ aim: [0, 1] });
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(1);
    // A tick with no new spawn (aim released) reports 0, not the prior 1.
    input.clearAim();
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(0);
  });

  it('shotsFiredCount is 0 on a tick that spawns nothing (aim inactive)', () => {
    const { system } = makeSystem(); // no aim
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(0);
  });

  it('shotsFiredCount counts every bullet in a multi-spawn (coarse) tick', () => {
    // A tick larger than several fire intervals banks multiple spawns in one step.
    const { system } = makeSystem({ aim: [1, 0] });
    system.fixedUpdate(FIRE_INTERVAL_MS * 3);
    // Seeded accumulator + 3 intervals of banked time → the count matches the
    // bullets actually spawned this tick (never a stale value).
    expect(system.shotsFiredCount).toBe(system.bulletPool.activeCount);
    expect(system.shotsFiredCount).toBeGreaterThan(1);
  });

  it('recycles a freed bullet on the next spawn (no pool growth)', () => {
    const nearRight = ARENA_WIDTH - ARENA_BORDER_INSET - 1;
    const { ship, input, system } = makeSystem({
      ship: { x: nearRight, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
    });
    const totalBefore = system.bulletPool.activeCount + system.bulletPool.freeCount;

    // Fire + fly a bullet out of the arena.
    system.fixedUpdate(DT);
    input.clearAim();
    let guard = 0;
    while (system.bulletPool.activeCount > 0 && guard < 100) {
      system.fixedUpdate(DT);
      guard++;
    }
    const freeAfterDespawn = system.bulletPool.freeCount;
    expect(freeAfterDespawn).toBeGreaterThan(0);

    // Re-aim into the arena interior and spawn again: free drops, active rises,
    // and the pool did not grow.
    ship.x = ARENA_WIDTH / 2;
    input.setAim(0, 1);
    system.fixedUpdate(DT);
    expect(system.bulletPool.activeCount).toBe(1);
    expect(system.bulletPool.freeCount).toBe(freeAfterDespawn - 1);
    const totalAfter = system.bulletPool.activeCount + system.bulletPool.freeCount;
    expect(totalAfter).toBe(totalBefore);
  });
});

// --- Story 10.2 (Overcharge): playerStats-driven cadence + stamped damage -------
describe('FiringSystem — playerStats cadence + damage (Story 10.2)', () => {
  const T = 900; // ms of held aim, the same span the base cadence test uses
  const TICKS = Math.round(T / DT);

  it('base parity: no store and an explicit BASE store fire the identical shot count', () => {
    // The load-bearing no-regression guarantee: with no Overcharge owned, cadence is
    // byte-for-byte today's. A two-arg construction (every pre-10.2 caller) and a
    // three-arg construction with a base store must agree — and both must match the
    // shot count FIRE_INTERVAL_MS alone produces.
    const noStore = makeSystem({ aim: [1, 0] });
    const baseStore = makeSystem({ aim: [1, 0], playerStats: createPlayerStats() });

    const a = countSpawns(noStore.system, DT, TICKS);
    const b = countSpawns(baseStore.system, DT, TICKS);

    expect(a).toBe(b);
    const expected = Math.floor(T / FIRE_INTERVAL_MS);
    expect(a).toBeGreaterThanOrEqual(expected);
    expect(a).toBeLessThanOrEqual(expected + 1);
  });

  it('the effective interval is FIRE_INTERVAL_MS at base and FIRE_INTERVAL_MS / mult above it', () => {
    expect(makeSystem({}).system._fireIntervalMs()).toBe(FIRE_INTERVAL_MS);
    const ps = createPlayerStats();
    const { system } = makeSystem({ playerStats: ps });
    expect(system._fireIntervalMs()).toBe(FIRE_INTERVAL_MS);
    ps.fireRateMult = 1.4; // Overcharge Lv5
    expect(system._fireIntervalMs()).toBeCloseTo(FIRE_INTERVAL_MS / 1.4, 10);
    expect(system._fireIntervalMs()).toBeLessThan(FIRE_INTERVAL_MS);
  });

  it('fireRateMult 1.4 fires strictly MORE shots than base over the same span', () => {
    const base = makeSystem({ aim: [1, 0], playerStats: createPlayerStats() });
    const fast = makeSystem({
      aim: [1, 0],
      playerStats: { ...createPlayerStats(), fireRateMult: 1.4 },
    });

    const baseCount = countSpawns(base.system, DT, TICKS);
    const fastCount = countSpawns(fast.system, DT, TICKS);

    expect(fastCount).toBeGreaterThan(baseCount);
    // ≈ T / (FIRE_INTERVAL_MS / 1.4), ± the seeded first shot.
    const expected = Math.floor(T / (FIRE_INTERVAL_MS / 1.4));
    expect(fastCount).toBeGreaterThanOrEqual(expected);
    expect(fastCount).toBeLessThanOrEqual(expected + 1);
  });

  it('a higher fireRateMult never fires FEWER shots (monotonic across the five rungs)', () => {
    let prev = -1;
    for (const mult of [1, 1.1, 1.2, 1.3, 1.4]) {
      const { system } = makeSystem({
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), fireRateMult: mult },
      });
      const count = countSpawns(system, DT, TICKS);
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
  });

  it.each([
    ['zero', 0],
    ['negative', -2],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['undefined', undefined],
    ['a string', '1.4'],
  ])(
    'sanitizes a degenerate fireRateMult (%s) to 1 — base cadence, loop terminates',
    (_label, value) => {
      const { system } = makeSystem({
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), fireRateMult: value },
      });
      expect(system._fireIntervalMs()).toBe(FIRE_INTERVAL_MS);
      // The spawn loop must TERMINATE (a zero/negative interval would hang it) and
      // produce exactly the base cadence's shot count.
      const count = countSpawns(system, DT, TICKS);
      const expected = Math.floor(T / FIRE_INTERVAL_MS);
      expect(count).toBeGreaterThanOrEqual(expected);
      expect(count).toBeLessThanOrEqual(expected + 1);
    },
  );

  it('an OMITTED store (undefined/null) degrades to base cadence — the two-arg path', () => {
    // Spec-mandated: a caller that never passes the store keeps the exact pre-10.2
    // behavior. `undefined` here means the two-arg constructor call.
    for (const omitted of [undefined, null]) {
      const { system } = makeSystem({ aim: [1, 0], playerStats: omitted });
      expect(system.playerStats).toBeNull();
      expect(system._fireIntervalMs()).toBe(FIRE_INTERVAL_MS);
      expect(() => system.fixedUpdate(DT)).not.toThrow();
      expect(system.shotsFiredCount).toBe(1);
    }
  });

  it.each([
    ['a number', 42],
    ['a string', 'stats'],
    ['a boolean', true],
    ['a function', () => {}],
    ['an array', []],
    // Everything below is `typeof === 'object'`, so a bare type test would let it
    // through as an empty stat store — base cadence and base damage for the whole
    // run with no diagnostic. These are the shapes actually in scope at the
    // buildArenaWorld call site, i.e. the wrong-slot mistake the guard names.
    ['a Map', new Map([['fireRateMult', 1.4]])],
    ['a Set', new Set()],
    ['a Date', new Date(0)],
    ['a typed array', new Int32Array(2)],
    ['a class instance', new InputState()],
  ])(
    'THROWS a descriptive TypeError when the third arg is present but is %s',
    (_label, bad) => {
      // Fail loud, like LevelUpSystem's arg-5 guard: silently degrading would make a
      // positional-argument mistake look identical to "Overcharge does nothing".
      // The guard checks SHAPE, not `typeof` — see the constructor comment.
      const ship = createPlayerShip();
      const input = new InputState();
      expect(() => new FiringSystem(ship, input, bad)).toThrow(TypeError);
      expect(() => new FiringSystem(ship, input, bad)).toThrow(/arg 3/);
      expect(() => new FiringSystem(ship, input, bad)).toThrow(/playerStats/);
    },
  );

  it('names what actually arrived, not just "object"', () => {
    const ship = createPlayerShip();
    const input = new InputState();
    expect(() => new FiringSystem(ship, input, new Map())).toThrow(/Map instance/);
    expect(() => new FiringSystem(ship, input, [])).toThrow(/array/);
    expect(() => new FiringSystem(ship, input, 42)).toThrow(/number/);
  });

  it.each([
    ['an object literal missing every stat field', {}],
    ['an object literal with junk stat values', { damageMult: 'x', fireRateMult: null }],
    ['a null-prototype object', Object.create(null)],
  ])(
    'ACCEPTS %s — a degenerate FIELD sanitizes, it does not throw',
    (_label, store) => {
      // The guard stops at the container deliberately. The I/O contract requires a
      // missing / 0 / negative / NaN multiplier to resolve to the base at read time,
      // so widening this into a field-level check would turn a specified sanitize
      // into a crash.
      const ship = createPlayerShip();
      const input = new InputState();
      expect(() => new FiringSystem(ship, input, store)).not.toThrow();
      expect(new FiringSystem(ship, input, store)._fireIntervalMs()).toBe(
        FIRE_INTERVAL_MS,
      );
    },
  );

  it('accepts a plain object store (the guard rejects wrong types, not real stores)', () => {
    const ship = createPlayerShip();
    const input = new InputState();
    const ps = createPlayerStats();
    expect(() => new FiringSystem(ship, input, ps)).not.toThrow();
    expect(new FiringSystem(ship, input, ps).playerStats).toBe(ps);
  });

  it('never returns a NON-FINITE interval, even for a denormal-tiny multiplier', () => {
    // A denormal like 5e-324 is finite AND > 0, so `_mult` accepts it — but
    // FIRE_INTERVAL_MS / 5e-324 overflows to Infinity. An infinite interval would
    // latch `_accumMs = Infinity` on the non-aiming branch, and the spawn `while`
    // would then never terminate once the multiplier returned to normal.
    for (const tiny of [5e-324, 1e-320, Number.MIN_VALUE]) {
      const { system } = makeSystem({
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), fireRateMult: tiny },
      });
      const interval = system._fireIntervalMs();
      expect(Number.isFinite(interval)).toBe(true);
      expect(interval).toBeGreaterThan(0);
      // The CEILING, not the base interval: a multiplier tiny enough to overflow the
      // quotient is tinier still than the ones that merely hit the ceiling, so falling
      // back to base here would make the gun FASTER as the multiplier shrank. See the
      // monotonicity test below.
      expect(interval).toBe(FIRE_INTERVAL_CEIL_MS);
      // And the spawn loop terminates at that interval.
      const count = countSpawns(system, DT, TICKS);
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('is MONOTONE in fireRateMult: a smaller multiplier never fires faster', () => {
    // The two upper-end guards (the CEILING for tiny-but-finite quotients, the
    // non-finite fallback for overflowed ones) must agree on what a broken-tiny
    // multiplier means. They did not: 1e-300 hit the ceiling (9000ms) while the
    // slightly smaller 5e-324 overflowed and fell back to the base 90ms — a 100x
    // SPEEDUP from reducing the multiplier. Descending multipliers, non-increasing
    // fire rate ⇒ non-decreasing interval, all the way into the denormals.
    const descending = [
      2, 1.7, 1.4, 1.15, 1, 0.5, 1e-6, 1e-12, 1e-300, 5.1e-307, 5e-307, 5e-324,
    ];
    let prev = 0;
    for (const fireRateMult of descending) {
      const { system } = makeSystem({
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), fireRateMult },
      });
      const interval = system._fireIntervalMs();
      expect(Number.isFinite(interval)).toBe(true);
      expect(interval).toBeGreaterThanOrEqual(prev);
      expect(interval).toBeLessThanOrEqual(FIRE_INTERVAL_CEIL_MS);
      expect(interval).toBeGreaterThanOrEqual(FIRE_INTERVAL_FLOOR_MS);
      prev = interval;
    }
  });

  it('recovers from a denormal multiplier latched while NOT aiming (loop still terminates)', () => {
    // The exact hang path: the non-aiming branch stores the interval into _accumMs.
    // If that value were Infinity, the next aiming tick's
    // `while (Infinity >= interval) { _accumMs -= interval }` would never end.
    const ps = { ...createPlayerStats(), fireRateMult: 5e-324 };
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      playerStats: ps,
    });
    input.clearAim();
    system.fixedUpdate(DT); // latches _accumMs on the non-aiming branch
    expect(Number.isFinite(system._accumMs)).toBe(true);

    // The multiplier returns to a normal value and the player re-aims.
    ps.fireRateMult = 1.4;
    input.setAim(1, 0);
    const count = countSpawns(system, DT, TICKS); // must TERMINATE
    expect(count).toBeGreaterThan(0);
    // Bounded, not unbounded — the whole point of the guard. The accumulator latched
    // the CEILING while not aiming, but the shrink-clamp in fixedUpdate discards credit
    // banked at the longer interval, so the first aiming tick fires once (the usual
    // seeded first shot) and the rest is plain cadence — never a banked burst, and
    // never the runaway a non-finite interval would produce.
    const expected = Math.floor(T / (FIRE_INTERVAL_MS / 1.4));
    expect(count).toBeLessThanOrEqual(expected + 1);
  });

  it.each([
    ['1e-12', 1e-12],
    ['1e-6', 1e-6],
    ['1e-9', 1e-9],
  ])(
    'CEILS the effective interval for a tiny-but-finite multiplier (%s)',
    (_label, tiny) => {
      // Finiteness alone is not enough. `Number.isFinite(90 / 1e-12)` is true — the
      // quotient is a perfectly finite 9e13 ms — so the non-finite fallback never
      // fires, the non-aiming branch latches 9e13 into _accumMs, and the next tick at
      // a normal multiplier has to work that credit down ONE INTERVAL AT A TIME:
      // ~1.4e12 spawn-loop iterations, each calling pool.acquire(). A hang in
      // everything but name, and the reason the guard needs a ceiling, not just a
      // finite check.
      const { system } = makeSystem({
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), fireRateMult: tiny },
      });
      expect(system._fireIntervalMs()).toBe(FIRE_INTERVAL_CEIL_MS);
      expect(FIRE_INTERVAL_CEIL_MS).toBeGreaterThan(FIRE_INTERVAL_MS);
    },
  );

  it('recovers from a tiny-but-FINITE multiplier latched while NOT aiming (bounded drain)', () => {
    const ps = { ...createPlayerStats(), fireRateMult: 1e-12 };
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      playerStats: ps,
    });
    input.clearAim();
    system.fixedUpdate(DT); // latches the ceiling, not 9e13
    expect(system._accumMs).toBe(FIRE_INTERVAL_CEIL_MS);

    ps.fireRateMult = 1.4; // back to a shipped value; the player re-aims
    input.setAim(1, 0);
    const drainTicks = 3;
    const count = countSpawns(system, DT, drainTicks); // must TERMINATE, and quickly
    // The banked ceiling is DISCARDED, not drained: credit accrued at a longer interval
    // is clamped away the moment the interval shrinks, so the bound is the ordinary
    // cadence over these ticks plus the seeded first shot — NOT ceil(CEIL / interval),
    // which would be ~140 pool.acquire() calls inside a single fixed step.
    const interval = FIRE_INTERVAL_MS / 1.4;
    expect(count).toBeLessThanOrEqual(
      Math.floor((drainTicks * DT) / interval) + 1,
    );
    expect(Number.isFinite(system._accumMs)).toBe(true);
  });

  it('discards credit banked at a LONGER interval — no burst, no pool growth (NFR2)', () => {
    // The banked-backlog path, on BOTH branches. A tiny fireRateMult parks up to
    // FIRE_INTERVAL_CEIL_MS of credit in _accumMs; a return to a shipped multiplier
    // must not cash that in as one giant volley. Without the shrink-clamp this fired
    // ~140 bullets in ONE fixed step and grew the pool 64 → 140 permanently, breaking
    // the same prewarm invariant the NFR2 test in this file asserts.
    for (const releaseAim of [true, false]) {
      const ps = { ...createPlayerStats(), fireRateMult: 1e-12 };
      const { input, system } = makeSystem({
        ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
        aim: [1, 0],
        playerStats: ps,
      });
      const prewarmTotal =
        system.bulletPool.activeCount + system.bulletPool.freeCount;
      expect(prewarmTotal).toBe(BULLET_POOL_PREWARM);

      if (releaseAim) {
        input.clearAim();
        system.fixedUpdate(DT); // non-aiming branch latches the ceiling
        input.setAim(1, 0);
      } else {
        // Aiming the whole time: _accumMs accrues dt/tick toward a 9000ms interval
        // and never spawns, so it banks the same backlog without the latch.
        for (let i = 0; i < 400; i++) system.fixedUpdate(DT);
        expect(system._accumMs).toBeGreaterThan(FIRE_INTERVAL_MS * 50);
      }

      ps.fireRateMult = 1.4; // back to the shipped maximum
      const before = system.bulletPool.activeCount;
      system.fixedUpdate(DT);
      const spawnedThisTick = system.bulletPool.activeCount - before;
      expect(spawnedThisTick).toBeLessThanOrEqual(1);
      // The pool never had to grow: no factory call, no allocation inside the step.
      expect(system.bulletPool.activeCount + system.bulletPool.freeCount).toBe(
        prewarmTotal,
      );
    }
  });

  it('floors the STAMPED damage at PLAYER_BULLET_MIN_DAMAGE (producer-side)', () => {
    // `_mult` sanitizes non-finite and non-positive multipliers to 1, but a finite
    // tiny-POSITIVE one survives it. Unclamped, that stamps a damage below ulp(hp),
    // where `hp -= damage` is an exact float no-op and a finite-hp enemy is
    // permanently unkillable. CollisionSystem clamps too, but the value on the wire
    // must already be valid for any other consumer of `bullet.damage`.
    for (const damageMult of [1e-12, 5e-324, 1e-300]) {
      const { system } = makeSystem({
        ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), damageMult },
      });
      system.fixedUpdate(DT);
      const spawned = activeBullets(system);
      expect(spawned.length).toBeGreaterThan(0);
      for (const b of spawned) expect(b.damage).toBe(PLAYER_BULLET_MIN_DAMAGE);
    }
    // And the clamp is invisible to every authored value.
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
      playerStats: { ...createPlayerStats(), damageMult: 1.6 },
    });
    system.fixedUpdate(DT);
    for (const b of activeBullets(system)) {
      expect(b.damage).toBeCloseTo(PLAYER_BULLET_BASE_DAMAGE * 1.6, 12);
    }
  });

  it.each([
    // Tap-firing is the NORMAL input pattern — PlayerInputSampler clears the aim
    // channel every time the right stick returns to rest — so the value the
    // non-aiming branch seeds into _accumMs is a shipped-reachable cadence surface,
    // not an edge case. Seeding the CURRENT effective interval is what makes re-aiming
    // fire immediately without banking stale credit; seeding the constant
    // FIRE_INTERVAL_MS instead banks 90ms of credit into a tighter cadence on every
    // release, roughly DOUBLING sustained tap-fire output at Overcharge Lv5 (30 -> 59
    // shots over this pattern). Every other aim-release test in this file runs at
    // exactly FIRE_INTERVAL_MS, where the two are indistinguishable — these rungs are
    // what make the difference observable.
    [1, 30],
    [1.4, 30], // Overcharge Lv5 — the shipped maximum
    [1.7, 30], // Spread Cannon's projected rung (Story 10.3)
    [2.0, 60],
  ])(
    'tap-firing at fireRateMult %s fires exactly %i shots (no banked re-aim burst)',
    (fireRateMult, expected) => {
      const { input, system } = makeSystem({
        ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
        aim: [1, 0],
        playerStats: { ...createPlayerStats(), fireRateMult },
      });
      let shots = 0;
      const orig = system.bulletPool.acquire.bind(system.bulletPool);
      system.bulletPool.acquire = () => {
        shots++;
        return orig();
      };
      for (let cycle = 0; cycle < 30; cycle++) {
        input.setAim(1, 0);
        for (let t = 0; t < 3; t++) system.fixedUpdate(DT);
        input.clearAim();
        for (let t = 0; t < 3; t++) system.fixedUpdate(DT);
      }
      expect(shots).toBe(expected);
    },
  );

  it('bounds the first re-aim tick even at the interval FLOOR (no unbounded burst)', () => {
    // The floor's own stated contract: a runaway multiplier must not let a single
    // re-aim tick bank an unbounded number of spawns.
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      playerStats: { ...createPlayerStats(), fireRateMult: 9 },
    });
    input.clearAim();
    system.fixedUpdate(DT); // seeds _accumMs = FIRE_INTERVAL_FLOOR_MS
    expect(system._accumMs).toBe(FIRE_INTERVAL_FLOOR_MS);
    input.setAim(1, 0);
    system.fixedUpdate(DT);
    // One seeded shot plus the tick's own accrual — constant, not runaway.
    expect(system.shotsFiredCount).toBe(
      Math.floor(DT / FIRE_INTERVAL_FLOOR_MS) + 1,
    );
  });

  it('re-stamps damage on a RECYCLED bullet (Pool.release resets nothing)', () => {
    // The factory default only applies on a COLD acquire; release resets no fields, so
    // a recycled instance carries the previous shot's damage until something stamps
    // it. A stale value is finite and positive, so the CollisionSystem's fallback
    // cannot detect it — the only thing standing between that and a wrong-damage
    // bullet is FiringSystem stamping on EVERY spawn, including recycled ones. Story
    // 10.3's Spread Cannon acquires from this same pool.
    const ps = { ...createPlayerStats(), damageMult: 1.6 };
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: ps,
    });
    system.fixedUpdate(DT);
    const [strong] = activeBullets(system);
    expect(strong.damage).toBeCloseTo(1.6, 10);

    // Send it back to the free list carrying its stamped 1.6.
    system.bulletPool.release(strong);
    expect(strong.damage).toBeCloseTo(1.6, 10); // release really does NOT reset

    // A weaker build now fires; the recycled instance must carry the NEW damage.
    ps.damageMult = 1;
    input.setAim(1, 0);
    system.fixedUpdate(FIRE_INTERVAL_MS);
    const recycled = activeBullets(system);
    expect(recycled).toContain(strong); // the same instance really was reused
    for (const b of recycled) expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
  });

  it('floors the effective interval at FIRE_INTERVAL_FLOOR_MS for an absurd multiplier', () => {
    // The floor is a SAFETY guard, not a balance lever: no authored value reaches it
    // (Lv5's 1.4 yields ~64ms), but a runaway multiplier must not drive the interval
    // to ~0 and bank an unbounded number of spawns per tick.
    const { system } = makeSystem({
      aim: [1, 0],
      playerStats: { ...createPlayerStats(), fireRateMult: 1e9 },
    });
    expect(system._fireIntervalMs()).toBe(FIRE_INTERVAL_FLOOR_MS);
    expect(FIRE_INTERVAL_FLOOR_MS).toBeGreaterThan(0);
    expect(FIRE_INTERVAL_FLOOR_MS).toBeLessThan(FIRE_INTERVAL_MS / 1.4);
    system.fixedUpdate(DT); // terminates
    expect(system.shotsFiredCount).toBe(Math.floor(DT / FIRE_INTERVAL_FLOOR_MS) + 1);
  });

  it('stamps every spawned bullet with PLAYER_BULLET_BASE_DAMAGE at base', () => {
    const { system } = makeSystem({ aim: [0, 1] });
    system.fixedUpdate(FIRE_INTERVAL_MS * 3); // several spawns in one tick
    const bullets = activeBullets(system);
    expect(bullets.length).toBeGreaterThan(1);
    for (const b of bullets) expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
  });

  it.each([
    [1.15, 1],
    [1.25, 1.1],
    [1.35, 1.2],
    [1.45, 1.3],
    [1.6, 1.4],
  ])(
    'stamps base × damageMult (%s) on every bullet spawned that tick',
    (damageMult, fireRateMult) => {
      const { system } = makeSystem({
        aim: [0, 1],
        playerStats: { ...createPlayerStats(), damageMult, fireRateMult },
      });
      system.fixedUpdate(FIRE_INTERVAL_MS * 3);
      const bullets = activeBullets(system);
      expect(bullets.length).toBeGreaterThan(1);
      for (const b of bullets) {
        expect(b.damage).toBeCloseTo(PLAYER_BULLET_BASE_DAMAGE * damageMult, 10);
      }
    },
  );

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', NaN],
    ['undefined', undefined],
  ])('sanitizes a degenerate damageMult (%s) to the base damage unit', (_l, value) => {
    const { system } = makeSystem({
      aim: [0, 1],
      playerStats: { ...createPlayerStats(), damageMult: value },
    });
    system.fixedUpdate(DT);
    const [b] = activeBullets(system);
    expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
  });

  it('an in-flight bullet keeps its ORIGINAL damage when the store is upgraded mid-run', () => {
    // The store is the SAME object the fold mutates in place, so the upgrade is
    // visible immediately — but only to bullets spawned AFTER it.
    const ps = createPlayerStats();
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: ps,
    });
    system.fixedUpdate(DT);
    const [older] = activeBullets(system);
    expect(older.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);

    // The card pick lands: the fold mutates the SHARED store in place.
    ps.damageMult = 1.6;
    ps.fireRateMult = 1.4;

    input.setAim(1, 0); // spawn the next bullet on a distinct heading
    system.fixedUpdate(FIRE_INTERVAL_MS);
    const after = activeBullets(system).filter((b) => b !== older);
    expect(after.length).toBeGreaterThan(0);
    for (const b of after) expect(b.damage).toBeCloseTo(1.6, 10);
    // The bullet already on screen was NOT retroactively strengthened.
    expect(older.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
  });

  it('tightens cadence from the next tick after a mid-run upgrade (same store, no reconstruction)', () => {
    const ps = createPlayerStats();
    const { system } = makeSystem({ aim: [1, 0], playerStats: ps });
    const before = countSpawns(system, DT, TICKS);
    ps.fireRateMult = 1.4; // the fold's in-place mutation
    const after = countSpawns(system, DT, TICKS);
    expect(after).toBeGreaterThan(before);
  });

  it('holds the same playerStats reference it was constructed with (never copied)', () => {
    const ps = createPlayerStats();
    const { system } = makeSystem({ playerStats: ps });
    expect(system.playerStats).toBe(ps);
  });

  it('allocates nothing per tick under an upgraded fire rate (NFR2)', () => {
    // The faster cadence must not outrun the pool: the prewarm still covers the peak
    // in-flight count, so the factory never runs in the steady state.
    //
    // Assert the pool total is UNCHANGED, not merely "<= prewarm". The pool only ever
    // grows (lazily, via the factory), so `<= prewarm` and `=== prewarm` are the same
    // claim about the factory — but the equality states it as the invariant it is, and
    // reads as a failure the moment the factory runs even once. A `<=` bound also
    // invites being read as "we measured headroom", which it never did.
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
      playerStats: { ...createPlayerStats(), fireRateMult: 1.4 },
    });
    const prewarmTotal =
      system.bulletPool.activeCount + system.bulletPool.freeCount;
    expect(prewarmTotal).toBe(BULLET_POOL_PREWARM);
    for (let i = 0; i < 500; i++) {
      system.fixedUpdate(DT);
      expect(system.bulletPool.activeCount + system.bulletPool.freeCount).toBe(
        prewarmTotal,
      );
    }
  });
});
