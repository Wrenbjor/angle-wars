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
  SPREAD_MAX_WAYS,
  SPREAD_MAX_ARC_DEG,
} from '../config/constants.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';

const DT = FIXED_STEP_MS;

// The worst build the item framework can AUTHOR (Story 10.3): Spread Cannon Lv5's 9-way
// volley at the fastest authorable cadence — its own +30% fire rate stacked additively
// with Overcharge Lv5's +40%. This is the build BULLET_POOL_PREWARM is sized against.
const WORST_AUTHORABLE_BUILD = Object.freeze({
  spreadWays: 9,
  spreadArcDeg: 22,
  fireRateMult: 1.7,
  damageMult: 1.95,
});

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

  it.each([
    ['the base single-bullet volley', undefined],
    // The WORST case the item framework can author (Story 10.3): Spread Cannon Lv5's
    // 9-way volley at the fastest authorable cadence — its own +30% stacked additively
    // with Overcharge Lv5's +40%.
    //
    // NOTE this case fires from the arena CENTRE, where bullets exit after ~half the
    // arena and the peak in-flight is only ~146. It is a cadence/no-throw case, NOT a
    // pin on the prewarm's sizing — the sizing geometry is covered by the dedicated
    // suite below, which fires along the inset diagonal and the full arena width.
    ['a 9-way Spread Cannon Lv5 + Overcharge Lv5 volley', WORST_AUTHORABLE_BUILD],
  ])('never grows the pool past the prewarm under sustained fire — %s (NFR2)', (
    _label,
    stats,
  ) => {
    // At construction the pool is fully prewarmed and nothing is checked out.
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
      playerStats: stats ? { ...createPlayerStats(), ...stats } : undefined,
    });
    expect(system.bulletPool.freeCount).toBe(BULLET_POOL_PREWARM);
    expect(system.bulletPool.activeCount).toBe(0);

    // Hold aim active for a sustained run. Ship centered so bullets leave the
    // arena and despawn, keeping peak in-flight under the prewarm. If total
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
    // Run BOTH the base gun and a 9-way Spread Cannon Lv5 volley: with a volley the
    // banked backlog would cash in as ~140 x 9 = 1260 bullets in one step, so the clamp
    // matters more, not less, once a volley can spawn many bullets per interval.
    for (const releaseAim of [true, false]) {
      for (const spread of [null, { spreadWays: 9, spreadArcDeg: 22 }]) {
        const ways = spread ? spread.spreadWays : 1;
        const ps = { ...createPlayerStats(), ...(spread ?? {}), fireRateMult: 1e-12 };
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
        // At most ONE volley — which is 1 bullet at base and `ways` bullets with a
        // spread build. Never the banked backlog.
        expect(system.volleysFiredCount).toBeLessThanOrEqual(1);
        expect(spawnedThisTick).toBeLessThanOrEqual(ways);
        // The pool never had to grow: no factory call, no allocation inside the step.
        expect(system.bulletPool.activeCount + system.bulletPool.freeCount).toBe(
          prewarmTotal,
        );
      }
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

  it.each([
    ['Overcharge Lv5 alone', { fireRateMult: 1.4 }],
    // Story 10.3's worst authorable build: 9 bullets per volley at the fastest cadence
    // the framework can produce (Spread Cannon Lv3's +30% stacked additively with
    // Overcharge Lv5's +40%). ~170 bullets/second through the same pool.
    [
      'Spread Cannon Lv5 + Overcharge Lv5 (9 ways at fireRateMult 1.70)',
      { spreadWays: 9, spreadArcDeg: 22, fireRateMult: 1.7, damageMult: 1.95 },
    ],
  ])('allocates nothing per tick under %s (NFR2)', (_label, stats) => {
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
      playerStats: { ...createPlayerStats(), ...stats },
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

// --- Story 10.3 (Spread Cannon): multi-bullet volleys ---------------------------
describe('FiringSystem — spread volleys (Story 10.3)', () => {
  // The SHIPPED ladder, read as (ways, TOTAL cone in degrees) — see the registry.
  const SHIPPED_LEVELS = [
    { level: 1, ways: 3, arcDeg: 12 },
    { level: 2, ways: 5, arcDeg: 16 },
    { level: 3, ways: 5, arcDeg: 16 },
    { level: 4, ways: 7, arcDeg: 22 },
    { level: 5, ways: 9, arcDeg: 22 },
  ];

  // The SIGNED angle (degrees) of a bullet's velocity relative to the aim direction.
  // Positive is the same rotation sense the fan builds with (aim rotated by +offset).
  function offsetDeg(bullet, ax, ay) {
    const dx = bullet.vx / BULLET_SPEED;
    const dy = bullet.vy / BULLET_SPEED;
    return (Math.atan2(ax * dy - ay * dx, ax * dx + ay * dy) * 180) / Math.PI;
  }

  // The expected evenly-spaced, aim-centered offsets for a (ways, arc) volley.
  function expectedOffsets(ways, arcDeg) {
    if (ways < 2) return [0];
    const step = arcDeg / (ways - 1);
    const half = (ways - 1) / 2;
    const out = [];
    for (let i = 0; i < ways; i++) out.push((i - half) * step);
    return out;
  }

  function spreadStats(ways, arcDeg, extra = {}) {
    return { ...createPlayerStats(), spreadWays: ways, spreadArcDeg: arcDeg, ...extra };
  }

  it('BASE PARITY: no store, a base store, and an explicit 0-ways store all fire ONE bullet', () => {
    // The load-bearing no-regression guarantee: with no Spread Cannon owned the volley
    // is byte-for-byte the pre-10.3 single shot — same nose position, same velocity,
    // same damage, same counters. The base store now CARRIES spreadWays/spreadArcDeg at
    // their base of 0, so this also pins that adding the fields changed nothing.
    const ax = 0.6;
    const ay = 0.8;
    const reference = { x: null, y: null, vx: null, vy: null };
    for (const playerStats of [
      undefined,
      createPlayerStats(),
      spreadStats(0, 0),
      { ...createPlayerStats(), spreadWays: 1, spreadArcDeg: 12 }, // 1 way is still single
    ]) {
      const { ship, system } = makeSystem({
        ship: { x: 400, y: 300 },
        aim: [ax, ay],
        playerStats,
      });
      system.fixedUpdate(DT);
      const bullets = activeBullets(system);
      expect(bullets).toHaveLength(1);
      const [b] = bullets;
      expect(b.x).toBeCloseTo(ship.x + ax * ship.radius, 12);
      expect(b.y).toBeCloseTo(ship.y + ay * ship.radius, 12);
      expect(b.vx).toBeCloseTo(ax * BULLET_SPEED, 12);
      expect(b.vy).toBeCloseTo(ay * BULLET_SPEED, 12);
      expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
      expect(system.shotsFiredCount).toBe(1);
      expect(system.volleysFiredCount).toBe(1);
      // Every variant is EXACTLY identical, bit for bit — not merely close.
      if (reference.x === null) {
        reference.x = b.x;
        reference.y = b.y;
        reference.vx = b.vx;
        reference.vy = b.vy;
      } else {
        expect([b.x, b.y, b.vx, b.vy]).toEqual([
          reference.x,
          reference.y,
          reference.vx,
          reference.vy,
        ]);
      }
    }
  });

  it.each(SHIPPED_LEVELS)(
    'Spread Cannon Lv$level fires $ways bullets across a $arcDeg° TOTAL cone, evenly spaced and aim-centered',
    ({ ways, arcDeg }) => {
      const ax = 0;
      const ay = 1;
      const { ship, system } = makeSystem({
        ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
        aim: [ax, ay],
        playerStats: spreadStats(ways, arcDeg),
      });
      system.fixedUpdate(DT);
      const bullets = activeBullets(system);
      expect(bullets).toHaveLength(ways);

      const offsets = bullets.map((b) => offsetDeg(b, ax, ay));
      const expected = expectedOffsets(ways, arcDeg);
      // Same multiset of offsets, in spawn order.
      offsets.forEach((o, i) => expect(o).toBeCloseTo(expected[i], 9));
      // The cone is CENTERED on aim and its TOTAL width is exactly arcDeg — the
      // property the whole "total cone, not per-bullet gap" reading rests on.
      expect(Math.min(...offsets)).toBeCloseTo(-arcDeg / 2, 9);
      expect(Math.max(...offsets)).toBeCloseTo(arcDeg / 2, 9);
      expect(Math.max(...offsets) - Math.min(...offsets)).toBeCloseTo(arcDeg, 9);

      for (const b of bullets) {
        // Every bullet leaves at exactly BULLET_SPEED (the direction was rotated, not
        // scaled) and from the nose ALONG ITS OWN direction.
        const speed = Math.hypot(b.vx, b.vy);
        expect(speed).toBeCloseTo(BULLET_SPEED, 9);
        expect(b.x).toBeCloseTo(ship.x + (b.vx / BULLET_SPEED) * ship.radius, 9);
        expect(b.y).toBeCloseTo(ship.y + (b.vy / BULLET_SPEED) * ship.radius, 9);
      }
    },
  );

  it.each(SHIPPED_LEVELS)(
    'Lv$level: the CENTER bullet travels exactly along aim (bit-identical to the base shot)',
    ({ ways, arcDeg }) => {
      // Every shipped way count is ODD, so the middle bullet must be the base shot
      // untouched — not a float-noise rotation of it. This is what makes a spread build
      // a strict superset of the base gun down the aim line.
      const ax = 0.6;
      const ay = 0.8;
      const base = makeSystem({ ship: { x: 400, y: 300 }, aim: [ax, ay] });
      base.system.fixedUpdate(DT);
      const [baseBullet] = activeBullets(base.system);

      const { system } = makeSystem({
        ship: { x: 400, y: 300 },
        aim: [ax, ay],
        playerStats: spreadStats(ways, arcDeg),
      });
      system.fixedUpdate(DT);
      const bullets = activeBullets(system);
      const center = bullets[(ways - 1) / 2];
      expect(center.vx).toBe(baseBullet.vx);
      expect(center.vy).toBe(baseBullet.vy);
      expect(center.x).toBe(baseBullet.x);
      expect(center.y).toBe(baseBullet.y);
    },
  );

  it('the volley re-aims with the LIVE aim vector (no reconstruction, no stale cone)', () => {
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
      playerStats: spreadStats(3, 12),
    });
    system.fixedUpdate(DT);
    let bullets = activeBullets(system);
    expect(bullets).toHaveLength(3);
    for (const b of bullets) expect(Math.abs(offsetDeg(b, 1, 0))).toBeLessThanOrEqual(6.001);

    const before = new Set(bullets);
    input.setAim(0, -1); // the stick swings 90°
    system.fixedUpdate(FIRE_INTERVAL_MS);
    bullets = activeBullets(system).filter((b) => !before.has(b));
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    const offsets = bullets.map((b) => offsetDeg(b, 0, -1));
    expect(Math.min(...offsets)).toBeCloseTo(-6, 9);
    expect(Math.max(...offsets)).toBeCloseTo(6, 9);
  });

  it('a mid-run Spread Cannon pick changes the very next volley through the SHARED store', () => {
    // The card pick folds the SAME object the system holds — no reconstruction.
    const ps = createPlayerStats();
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: ps,
    });
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(1);

    ps.spreadWays = 5; // the fold's in-place mutation (Lv2)
    ps.spreadArcDeg = 16;
    input.setAim(0, 1);
    system.fixedUpdate(FIRE_INTERVAL_MS);
    expect(system.shotsFiredCount).toBe(5);
    expect(system.volleysFiredCount).toBe(1);
  });

  it('stamps `damage` on EVERY bullet in the volley, including a RECYCLED instance', () => {
    // entities/Bullet.js's ⚠ obligation, written for this story: Pool.release resets
    // nothing, so a recycled bullet carries the PREVIOUS shot's damage — finite and
    // positive, so CollisionSystem's fallback cannot detect it. The fan loop must stamp
    // every single bullet, not just the first.
    const ps = spreadStats(9, 22, { damageMult: 1.95 });
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: ps,
    });
    system.fixedUpdate(DT);
    const strong = activeBullets(system);
    expect(strong).toHaveLength(9);
    for (const b of strong) expect(b.damage).toBeCloseTo(1.95, 10);

    // Recycle the whole volley back onto the free list, still carrying 1.95.
    for (const b of strong) system.bulletPool.release(b);
    for (const b of strong) expect(b.damage).toBeCloseTo(1.95, 10); // release resets nothing

    // A weaker build fires; every recycled instance must carry the NEW damage.
    ps.damageMult = 1;
    input.setAim(1, 0);
    system.fixedUpdate(FIRE_INTERVAL_MS);
    const recycled = activeBullets(system);
    expect(recycled).toHaveLength(9);
    expect(recycled.some((b) => strong.includes(b))).toBe(true); // really reused
    for (const b of recycled) expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
  });

  it.each([
    ['NaN', NaN, 1],
    ['negative', -4, 1],
    ['zero', 0, 1],
    ['fractional below 2', 1.5, 1], // floors to 1 → the single shot
    ['fractional above 2', 4.9, 4], // floors to a whole bullet count
    ['absurdly large', 1e9, SPREAD_MAX_WAYS], // clamped — the loop-termination guard
    ['Infinity', Infinity, 1],
    ['a string', '9', 1],
    ['undefined', undefined, 1],
  ])('sanitizes a degenerate spreadWays (%s) — bounded spawns, no throw', (
    _label,
    value,
    expectedWays,
  ) => {
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: { ...createPlayerStats(), spreadWays: value, spreadArcDeg: 22 },
    });
    expect(system._spreadWays()).toBe(expectedWays);
    expect(() => system.fixedUpdate(DT)).not.toThrow(); // the fan loop TERMINATES
    expect(system.shotsFiredCount).toBe(expectedWays);
    expect(system.volleysFiredCount).toBe(1);
    expect(activeBullets(system)).toHaveLength(expectedWays);
    for (const b of activeBullets(system)) {
      expect(Number.isFinite(b.vx) && Number.isFinite(b.vy)).toBe(true);
    }
  });

  it.each([
    ['NaN', NaN, 0],
    ['negative', -30, 0],
    ['zero', 0, 0],
    ['Infinity', Infinity, 0],
    ['absurdly large', 1e6, SPREAD_MAX_ARC_DEG], // clamped, never a wild magnitude
    ['a string', '22', 0],
    ['undefined', undefined, 0],
  ])('sanitizes a degenerate spreadArcDeg (%s) — bounded cone, no throw', (
    _label,
    value,
    expectedArc,
  ) => {
    const ax = 0;
    const ay = 1;
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [ax, ay],
      playerStats: { ...createPlayerStats(), spreadWays: 5, spreadArcDeg: value },
    });
    expect(system._spreadArcDeg()).toBe(expectedArc);
    expect(() => system.fixedUpdate(DT)).not.toThrow();
    const bullets = activeBullets(system);
    expect(bullets).toHaveLength(5); // the ways count is unaffected by a junk arc
    for (const b of bullets) {
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BULLET_SPEED, 9);
      expect(Math.abs(offsetDeg(b, ax, ay))).toBeLessThanOrEqual(expectedArc / 2 + 1e-9);
    }
    if (expectedArc === 0) {
      // A 0° cone is degenerate but well-defined: every bullet travels along aim.
      for (const b of bullets) {
        expect(b.vx).toBeCloseTo(ax * BULLET_SPEED, 9);
        expect(b.vy).toBeCloseTo(ay * BULLET_SPEED, 9);
      }
    }
  });

  it('AT the arc clamp, every bullet still travels FORWARD and no two coincide', () => {
    // What SPREAD_MAX_ARC_DEG actually buys (it is not an overflow guard — cos/sin are
    // bounded for every finite input, and non-finite values are rejected before the
    // clamp). At 180° the outermost offsets are exactly ±90°, so a junk arc still yields
    // a forward-facing fan. Both properties break above it: at 360° the first and last
    // bullets sit at −180° and +180° — the SAME direction, two bullets in one place — and
    // a 2-way volley at 360° fires BOTH bullets directly backwards.
    const ax = 0;
    const ay = 1;
    for (const ways of [2, 3, SPREAD_MAX_WAYS]) {
      const { system } = makeSystem({
        ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
        aim: [ax, ay],
        playerStats: { ...createPlayerStats(), spreadWays: ways, spreadArcDeg: 1e6 },
      });
      expect(system._spreadArcDeg()).toBe(SPREAD_MAX_ARC_DEG);
      system.fixedUpdate(DT);
      const bullets = activeBullets(system);
      expect(bullets).toHaveLength(ways);

      const offsets = bullets.map((b) => offsetDeg(b, ax, ay));
      // No bullet fires backwards: every offset is within ±90° of aim, so the forward
      // component of every velocity is non-negative.
      for (const o of offsets) expect(Math.abs(o)).toBeLessThanOrEqual(90 + 1e-9);
      for (const b of bullets) {
        expect(b.vx * ax + b.vy * ay).toBeGreaterThanOrEqual(-1e-9);
      }
      // And no two bullets share a direction (the 360° coincidence failure).
      for (let i = 0; i < bullets.length; i++) {
        for (let j = i + 1; j < bullets.length; j++) {
          expect(Math.abs(offsets[i] - offsets[j])).toBeGreaterThan(1e-9);
        }
      }
    }
    // Stated as the invariant it is, so raising the constant fails here.
    expect(SPREAD_MAX_ARC_DEG).toBeLessThanOrEqual(180);
  });

  it('an OMITTED store keeps the single shot (the two-arg path is untouched by 10.3)', () => {
    const { system } = makeSystem({ aim: [0, 1], playerStats: undefined });
    expect(system._spreadWays()).toBe(1);
    expect(system._spreadArcDeg()).toBe(0);
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(1);
  });

  it('rebuilds the offset table ONLY on a (ways, arc) change — never per tick (NFR2)', () => {
    const ps = spreadStats(5, 16);
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: ps,
    });
    // The buffers are preallocated at construction and never replaced — a rebuild
    // writes IN PLACE, so the fixed step allocates nothing.
    const cos = system._offsetCos;
    const sin = system._offsetSin;
    expect(cos).toHaveLength(SPREAD_MAX_WAYS);
    expect(sin).toHaveLength(SPREAD_MAX_WAYS);

    for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    expect(system._tableBuilds).toBe(1); // ONE build for 200 ticks of unchanged level
    expect(system._offsetCos).toBe(cos);
    expect(system._offsetSin).toBe(sin);

    // A card pick (the fold mutating the shared store) rebuilds exactly once…
    ps.spreadWays = 9;
    ps.spreadArcDeg = 22;
    for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    expect(system._tableBuilds).toBe(2);
    expect(system._offsetCos).toBe(cos); // …still in place, still the same buffers
    expect(system._offsetSin).toBe(sin);
  });

  it('the base gun never touches the offset table at all', () => {
    const { system } = makeSystem({ aim: [0, 1], playerStats: createPlayerStats() });
    for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    expect(system._tableBuilds).toBe(0);
  });

  // --- The volley/bullet counter split (the audio seam) -------------------------
  it('a 9-way volley reports ONE fire event and NINE bullets', () => {
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: spreadStats(9, 22),
    });
    system.fixedUpdate(DT);
    expect(system.volleysFiredCount).toBe(1);
    expect(system.shotsFiredCount).toBe(9);
  });

  it('both counters reset every tick (per-tick latches, not cumulative)', () => {
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: spreadStats(9, 22),
    });
    expect(system.volleysFiredCount).toBe(0); // fresh system, before any tick
    system.fixedUpdate(DT);
    expect(system.volleysFiredCount).toBe(1);
    input.clearAim();
    system.fixedUpdate(DT);
    expect(system.volleysFiredCount).toBe(0);
    expect(system.shotsFiredCount).toBe(0);
  });

  it('a multi-interval tick counts every VOLLEY once and every BULLET once', () => {
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [0, 1],
      playerStats: spreadStats(3, 12),
    });
    system.fixedUpdate(FIRE_INTERVAL_MS * 3); // seeded + 3 banked intervals
    expect(system.volleysFiredCount).toBeGreaterThan(1);
    expect(system.shotsFiredCount).toBe(system.volleysFiredCount * 3);
    expect(system.bulletPool.activeCount).toBe(system.shotsFiredCount);
  });

  it('cadence is unaffected by the way count — spread multiplies bullets, not volleys', () => {
    // The fire-rate rung is the ONLY thing that changes cadence; adding ways must not
    // secretly also change how often the gun fires.
    const T = 900;
    const TICKS = Math.round(T / DT);
    const base = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
      playerStats: createPlayerStats(),
    });
    const spread = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
      playerStats: spreadStats(9, 22),
    });
    let baseVolleys = 0;
    let spreadVolleys = 0;
    for (let i = 0; i < TICKS; i++) {
      base.system.fixedUpdate(DT);
      spread.system.fixedUpdate(DT);
      baseVolleys += base.system.volleysFiredCount;
      spreadVolleys += spread.system.volleysFiredCount;
    }
    expect(spreadVolleys).toBe(baseVolleys);
  });

  it('the interval FLOOR still bounds a whole VOLLEY burst (ways × the floor bound)', () => {
    // The floor's contract, restated for volleys: an absurd multiplier must not let a
    // single re-aim tick bank an unbounded number of BULLETS either.
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      playerStats: spreadStats(SPREAD_MAX_WAYS, 22, { fireRateMult: 1e9 }),
    });
    input.clearAim();
    system.fixedUpdate(DT);
    input.setAim(1, 0);
    system.fixedUpdate(DT);
    const volleys = Math.floor(DT / FIRE_INTERVAL_FLOOR_MS) + 1;
    expect(system.volleysFiredCount).toBe(volleys);
    expect(system.shotsFiredCount).toBe(volleys * SPREAD_MAX_WAYS);
  });
});

// --- Story 10.3: BULLET_POOL_PREWARM sizing (NFR2) -------------------------------
describe('FiringSystem — the bullet pool is sized for the geometry it CLAIMS (NFR2)', () => {
  // The prewarm's derivation lives in a comment beside the constant. These tests exist
  // because that comment is prose arithmetic: nothing stopped it from being wrong (it
  // was — it used the STEADY-STATE volley rate, which ordinary tap-aiming beats), and
  // nothing stopped a retune of FIRE_INTERVAL_MS / BULLET_SPEED / the arena size from
  // quietly invalidating it. Two things are pinned here: the bound recomputed from the
  // LIVE constants, and the actual pool behavior in the geometry the bound assumes.
  //
  // Every pre-existing NFR2 case in this file fires from the arena CENTRE or the ship
  // SPAWN point, where bullets exit after a fraction of the arena — peak in-flight 146
  // and 11 respectively, against 456 in the sizing geometry. They could not have caught
  // an undersized prewarm, which is why these cases fire from the inset corner and the
  // inset edge instead.

  const INSET = ARENA_BORDER_INSET;
  const INNER_W = ARENA_WIDTH - 2 * INSET;
  const INNER_H = ARENA_HEIGHT - 2 * INSET;
  const DIAGONAL = Math.hypot(INNER_W, INNER_H);

  /**
   * The peak simultaneous in-flight bullet count the firing seam can ACHIEVE, recomputed
   * from the live constants and the SHIPPED registry rather than restated as a literal.
   */
  function bulletPoolBound() {
    // The largest fireRateMult / spreadWays the registry can fold: every item's best
    // rung summed (the fold stacks the same field ADDITIVELY across items), the
    // multiplier onto its base of 1 and the count onto its base of 0.
    let maxFireRateBonus = 0;
    let maxWaysBonus = 0;
    for (const item of ITEM_REGISTRY) {
      let bestRate = 0;
      let bestWays = 0;
      for (const lvl of item.levels) {
        bestRate = Math.max(bestRate, lvl.stats.fireRateMult ?? 0);
        bestWays = Math.max(bestWays, lvl.stats.spreadWays ?? 0);
      }
      maxFireRateBonus += bestRate;
      // SUMMED across items, not Math.max'd — `spreadWays` folds through the same
      // `playerStats[k] += stats[k]` path as `fireRateMult` (PlayerStats.js), so two
      // items carrying it stack. Taking the max here would model a fold the code does
      // not perform: Epic 12's Sunburst fusion or any later item carrying spreadWays
      // would fold to a higher count while this bound still returned 9-ways arithmetic,
      // leaving `BULLET_POOL_PREWARM >= bound` green while the pool silently began
      // calling its factory inside the fixed step — the exact regression this helper
      // exists to catch.
      maxWaysBonus += bestWays;
    }
    const maxFireRateMult = 1 + maxFireRateBonus;
    // Base 0 for a count field; a build with no spread item still fires one bullet.
    const maxWays = Math.max(1, maxWaysBonus);

    // The effective interval at that multiplier, through the same clamp FiringSystem
    // applies.
    const interval = Math.min(
      FIRE_INTERVAL_CEIL_MS,
      Math.max(FIRE_INTERVAL_FLOOR_MS, FIRE_INTERVAL_MS / maxFireRateMult),
    );

    // Volleys per second. The STEADY rate is 1/interval — but the non-aiming branch
    // re-seeds `_accumMs` to the interval, so an aim channel toggling on alternate fixed
    // steps fires every SECOND tick regardless of how long the interval is. Whichever is
    // larger binds.
    const steadyVolleysPerSec = 1000 / interval;
    const toggleVolleysPerSec = 1000 / (2 * FIXED_STEP_MS);
    const volleysPerSec = Math.max(steadyVolleysPerSec, toggleVolleysPerSec);

    // Longest straight-line flight before the border despawn.
    const flightSec = DIAGONAL / BULLET_SPEED;

    return Math.ceil(volleysPerSec * maxWays * flightSec);
  }

  it('the prewarm covers the bound recomputed from the LIVE constants + shipped registry', () => {
    const bound = bulletPoolBound();
    // Sanity: the bound is a real, non-degenerate number (a broken derivation that
    // collapsed to 0 would otherwise pass the assertion below vacuously).
    expect(bound).toBeGreaterThan(400);
    expect(BULLET_POOL_PREWARM).toBeGreaterThanOrEqual(bound);
  });

  it('the TOGGLE path — not the steady state — is what the bound has to cover', () => {
    // The specific error the original derivation made. If a retune ever makes the steady
    // rate the binding term this test stops being meaningful, so state the relationship
    // explicitly rather than leaving it implicit in a Math.max.
    const interval = FIRE_INTERVAL_MS / 1.7; // the fastest authorable cadence
    expect(interval).toBeGreaterThan(2 * FIXED_STEP_MS);
  });

  it.each([
    // The sizing geometry itself: a bullet crossing the full inset diagonal, which is
    // the flight time the bound is computed from.
    [
      'inset corner, firing across the diagonal',
      { x: INSET + 1, y: INSET + 1 },
      [INNER_W / DIAGONAL, INNER_H / DIAGONAL],
      false,
    ],
    // The full arena WIDTH — the longest single-axis flight.
    ['left inset edge, aiming +x', { x: INSET + 1, y: ARENA_HEIGHT / 2 }, [1, 0], false],
    // The achievable PEAK: aim toggling inactive→active on alternate fixed steps (stick
    // deadzone jitter / tap-aiming) fires a volley every second tick — 30 volleys/s at
    // the 60Hz step, well above the 18.89/s steady cadence the original derivation used.
    // Measured peak here: 456 in-flight, which is what forced the prewarm past 320.
    [
      'inset corner, TOGGLING aim every tick across the diagonal',
      { x: INSET + 1, y: INSET + 1 },
      [INNER_W / DIAGONAL, INNER_H / DIAGONAL],
      true,
    ],
    [
      'left inset edge, TOGGLING aim every tick along +x',
      { x: INSET + 1, y: ARENA_HEIGHT / 2 },
      [1, 0],
      true,
    ],
  ])(
    'never runs the pool factory at the worst authorable build — %s (NFR2)',
    (_label, shipPos, aim, toggleAim) => {
      const { input, system } = makeSystem({
        ship: shipPos,
        aim,
        playerStats: { ...createPlayerStats(), ...WORST_AUTHORABLE_BUILD },
      });
      const prewarmTotal =
        system.bulletPool.activeCount + system.bulletPool.freeCount;
      expect(prewarmTotal).toBe(BULLET_POOL_PREWARM);

      // Long enough for the in-flight population to reach its steady peak: the max
      // flight is ~1.84s ≈ 110 ticks, so 3000 ticks is ~27 full fill/drain cycles.
      let peak = 0;
      for (let i = 0; i < 3000; i++) {
        if (toggleAim) {
          if (i % 2 === 0) input.setAim(aim[0], aim[1]);
          else input.clearAim();
        }
        system.fixedUpdate(DT);
        peak = Math.max(peak, system.bulletPool.activeCount);
        // The load-bearing assertion: EQUALITY, so the moment the factory runs even
        // once (the pool only ever grows) this fails.
        expect(system.bulletPool.activeCount + system.bulletPool.freeCount).toBe(
          prewarmTotal,
        );
      }
      // And the run genuinely stressed the pool — otherwise the assertion above would
      // pass vacuously in a geometry where bullets despawn immediately (which is exactly
      // how the arena-centre and spawn-point cases gave false confidence). 200 sits above
      // the arena-centre geometry's peak of 146 and far above the spawn point's 11, so
      // this threshold FAILS for any case that quietly drifts back to a short flight
      // path. Measured here: 282 / 290 sustained, 442 / 456 toggling.
      expect(peak).toBeGreaterThan(200);
      expect(peak).toBeLessThanOrEqual(bulletPoolBound());
    },
  );
});

// --- Story 11.5 (Ricochet Rounds): stamp, wall bounce, seek, termination ---------
describe('FiringSystem — Ricochet Rounds (Story 11.5)', () => {
  // Grab the single live bullet (the tests below fire exactly one).
  function theBullet(system) {
    let b = null;
    system.bulletPool.forEachActive((x) => (b = x));
    return b;
  }

  // Fire exactly one volley from a centered ship, then stop aiming so no more spawn.
  function fireOnce(stats, aim = [1, 0]) {
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim,
      playerStats: { ...createPlayerStats(), ...stats },
    });
    system.fixedUpdate(DT); // seeded accumulator → exactly one volley
    input.clearAim();
    return { input, system };
  }

  // Drive the single bullet to extinction, counting how many bounces it spent.
  function driveUntilGone(system, maxTicks = 1000) {
    const bullet = theBullet(system);
    let prevRem = bullet ? bullet.bouncesRemaining : 0;
    let bounces = 0;
    let ticks = 0;
    while (system.bulletPool.activeCount > 0 && ticks < maxTicks) {
      system.fixedUpdate(DT);
      ticks++;
      let stillActive = false;
      system.bulletPool.forEachActive((b) => {
        if (b === bullet) stillActive = true;
      });
      if (!stillActive) break;
      if (bullet.bouncesRemaining < prevRem) {
        bounces += prevRem - bullet.bouncesRemaining;
        prevRem = bullet.bouncesRemaining;
      }
    }
    return { bounces, ticks, active: system.bulletPool.activeCount };
  }

  it('stamps the four ricochet fields (+ bounced=false) on the base single-bullet volley', () => {
    const { system } = fireOnce({
      ricochetBounces: 4,
      ricochetDmgPerBounce: 0.25,
      ricochetOffEnemies: 1,
      ricochetSeek: 1,
    });
    const b = theBullet(system);
    expect(b.bouncesRemaining).toBe(4);
    expect(b.dmgPerBounce).toBe(0.25);
    expect(b.bounceOffEnemies).toBe(true);
    expect(b.seek).toBe(true);
    expect(b.bounced).toBe(false);
  });

  it('stamps ricochet on EVERY bullet of a spread volley', () => {
    const { system } = fireOnce({
      spreadWays: 3,
      spreadArcDeg: 12,
      ricochetBounces: 2,
      ricochetDmgPerBounce: 0.25,
    });
    let count = 0;
    system.bulletPool.forEachActive((b) => {
      count++;
      expect(b.bouncesRemaining).toBe(2);
      expect(b.dmgPerBounce).toBe(0.25);
      expect(b.bounced).toBe(false);
    });
    expect(count).toBe(3); // all three fanned bullets stamped
  });

  it('an unowned bullet (bounces 0) despawns at the border, never bouncing — pre-11.5', () => {
    const { system } = fireOnce({}); // base store: ricochetBounces 0
    const b = theBullet(system);
    expect(b.bouncesRemaining).toBe(0);
    const { bounces, active } = driveUntilGone(system, 300);
    expect(bounces).toBe(0);
    expect(active).toBe(0); // released exactly as before this story
    expect(b.bounced).toBe(false);
  });

  it('Lv1 (bounces 1): reflects off ONE wall, then despawns on the next wall', () => {
    const { system } = fireOnce({ ricochetBounces: 1 });
    const { bounces, active } = driveUntilGone(system, 600);
    expect(bounces).toBe(1);
    expect(active).toBe(0);
  });

  it('Lv2 (bounces 2): reflects off two walls, then despawns on the third', () => {
    const { system } = fireOnce({ ricochetBounces: 2 });
    const { bounces, active } = driveUntilGone(system, 900);
    expect(bounces).toBe(2);
    expect(active).toBe(0);
  });

  it('a wall reflection preserves bullet speed and marks it bounced', () => {
    const { system } = fireOnce({ ricochetBounces: 2 });
    const b = theBullet(system);
    const speed = Math.hypot(b.vx, b.vy);
    // Step until the first reflection lands.
    let guard = 0;
    while (b.bouncesRemaining === 2 && guard < 400) {
      system.fixedUpdate(DT);
      guard++;
    }
    expect(b.bounced).toBe(true);
    expect(b.bouncesRemaining).toBe(1);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speed, 6);
  });

  // --- Lv5 seek steering ---------------------------------------------------------
  function seekSetup(enemies) {
    const { input, system } = makeSystem({
      ship: { x: 200, y: ARENA_HEIGHT / 2 },
      aim: [0, 1], // fire DOWNWARD, so a re-aim toward a rightward enemy is observable
      playerStats: {
        ...createPlayerStats(),
        ricochetBounces: 4,
        ricochetOffEnemies: 1,
        ricochetSeek: 1,
      },
    });
    system.enemyPools = [{ forEachActive: (cb) => enemies.forEach(cb) }];
    system.fixedUpdate(DT);
    input.clearAim();
    return { system };
  }

  it('re-aims a BOUNCED seek bullet toward the nearest enemy at unchanged speed', () => {
    const enemy = { x: 800, y: ARENA_HEIGHT / 2, telegraphMs: 0, radius: 14 };
    const { system } = seekSetup([enemy]);
    const b = theBullet(system);
    // Place it away from the enemy, moving DOWN, and mark it as already bounced.
    b.x = 400;
    b.y = ARENA_HEIGHT / 2;
    b.vx = 0;
    b.vy = 900;
    b.bounced = true;
    const speed = Math.hypot(b.vx, b.vy);
    system.fixedUpdate(DT);
    // Enemy is directly to the RIGHT → velocity now points +x, magnitude preserved.
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vy).toBeCloseTo(0, 6);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speed, 6);
  });

  it('does NOT seek before the bullet has bounced (bounced=false → straight)', () => {
    const enemy = { x: 800, y: ARENA_HEIGHT / 2, telegraphMs: 0, radius: 14 };
    const { system } = seekSetup([enemy]);
    const b = theBullet(system);
    b.x = 400;
    b.y = ARENA_HEIGHT / 2;
    b.vx = 0;
    b.vy = 900;
    b.bounced = false; // not yet bounced
    system.fixedUpdate(DT);
    expect(b.vx).toBe(0); // unchanged — no seek
    expect(b.vy).toBe(900);
  });

  it('flies straight when a bounced seek bullet has NO target (empty arena)', () => {
    const { system } = seekSetup([]); // enemyPools bound but empty
    const b = theBullet(system);
    b.x = 400;
    b.y = ARENA_HEIGHT / 2;
    b.vx = 0;
    b.vy = 900;
    b.bounced = true;
    system.fixedUpdate(DT);
    expect(b.vx).toBe(0); // no target → velocity unchanged
    expect(b.vy).toBe(900);
  });

  it('re-aims toward the NEAREST of several enemies (min-distance selection)', () => {
    // A near enemy (down-and-slightly-right of the bullet) and a far one (far right). The
    // re-aim must point at the NEAR enemy, not merely at any enemy — verifying _nearestEnemy's
    // min-distance comparison, which a single-enemy fixture leaves unexercised.
    const near = { x: 420, y: ARENA_HEIGHT / 2 + 140, telegraphMs: 0, radius: 14 };
    const far = { x: 1400, y: ARENA_HEIGHT / 2, telegraphMs: 0, radius: 14 };
    const { system } = seekSetup([far, near]); // near listed second — order must not matter
    const b = theBullet(system);
    b.x = 400;
    b.y = ARENA_HEIGHT / 2;
    b.vx = 0;
    b.vy = 900;
    b.bounced = true;
    system.fixedUpdate(DT);
    // Velocity, normalized, points at the NEAR enemy (dx 20, dy 140 → mostly +y), not the far
    // one (which would be almost pure +x with vy ≈ 0).
    const speed = Math.hypot(b.vx, b.vy);
    const dx = near.x - 400;
    const dy = near.y - ARENA_HEIGHT / 2;
    const mag = Math.hypot(dx, dy);
    expect(b.vx / speed).toBeCloseTo(dx / mag, 6);
    expect(b.vy / speed).toBeCloseTo(dy / mag, 6);
    expect(b.vy).toBeGreaterThan(b.vx); // clearly the near (down) enemy, not the far (+x) one
  });

  it('does NOT seek a TELEGRAPHING (spawning-in) enemy — flies straight', () => {
    // The only enemy is still spawning in (telegraphMs > 0), so it is not a valid seek target;
    // the bounced bullet must fly straight, exactly as with an empty arena.
    const spawningIn = { x: 800, y: ARENA_HEIGHT / 2, telegraphMs: 600, radius: 14 };
    const { system } = seekSetup([spawningIn]);
    const b = theBullet(system);
    b.x = 400;
    b.y = ARENA_HEIGHT / 2;
    b.vx = 0;
    b.vy = 900;
    b.bounced = true;
    system.fixedUpdate(DT);
    expect(b.vx).toBe(0); // telegraphing enemy skipped → no target → velocity unchanged
    expect(b.vy).toBe(900);
  });

  it('never grows the pool and every bullet eventually releases under sustained Lv5 fire (NFR11)', () => {
    // No enemies present → seek bullets fly straight to walls and exhaust their budget, so
    // the population is bounded and every bullet terminates (the arena-empties guarantee).
    const { input, system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0.4],
      playerStats: {
        ...createPlayerStats(),
        ricochetBounces: 4,
        ricochetDmgPerBounce: 0.25,
        ricochetOffEnemies: 1,
        ricochetSeek: 1,
      },
    });
    system.enemyPools = [{ forEachActive: () => {} }]; // bound but empty
    const total = system.bulletPool.activeCount + system.bulletPool.freeCount;
    expect(total).toBe(BULLET_POOL_PREWARM);
    for (let i = 0; i < 1500; i++) {
      system.fixedUpdate(DT);
      expect(
        system.bulletPool.activeCount + system.bulletPool.freeCount,
      ).toBeLessThanOrEqual(BULLET_POOL_PREWARM);
    }
    // Stop firing; every live ricochet bullet must eventually leave the arena.
    input.clearAim();
    let guard = 0;
    while (system.bulletPool.activeCount > 0 && guard < 3000) {
      system.fixedUpdate(DT);
      guard++;
    }
    expect(system.bulletPool.activeCount).toBe(0);
  });
});
