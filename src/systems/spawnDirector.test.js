import { describe, it, expect } from 'vitest';
import { SpawnDirector } from './SpawnDirector.js';
import {
  FIXED_STEP_MS,
  SPAWN_DIRECTOR_BASE_INTERVAL_MS,
  SPAWN_DIRECTOR_MIN_INTERVAL_MS,
  SPAWN_DIRECTOR_RAMP_DURATION_MS,
  SPAWN_DIRECTOR_MAX_ACTIVE,
  SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE,
  SPAWN_DIRECTOR_MAX_PRESSURE,
  SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS,
  SNAKE_SEGMENT_COUNT,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Deterministic rng that cycles through a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// A fake spawnable: a system exposing spawn() (counts calls) + enemyPool with a
// mutable activeCount, plus the base/peak weights the director interpolates.
function fakeSpawnable(baseWeight, peakWeight, activeCount = 0) {
  const system = {
    spawnCalls: 0,
    spawn() {
      this.spawnCalls++;
    },
    enemyPool: { activeCount },
  };
  return { system, baseWeight, peakWeight };
}

// Sum of spawn() calls across a director's spawnables.
function totalSpawns(spawnables) {
  return spawnables.reduce((n, s) => n + s.system.spawnCalls, 0);
}

// A fake spawnable whose spawn() actually grows its own pool by `perSpawn`
// instances (1 for a single-body archetype, SNAKE_SEGMENT_COUNT for a snake),
// so the director's summed cap sees the real post-spawn cost.
function countingSpawnable(baseWeight, peakWeight, perSpawn, activeCount = 0) {
  const system = {
    spawnCalls: 0,
    enemyPool: { activeCount },
    spawn() {
      this.spawnCalls++;
      this.enemyPool.activeCount += perSpawn;
    },
  };
  return { system, baseWeight, peakWeight };
}

// A conventional 4-archetype mix mirroring the scene wiring: snake base 0.
function fourMix() {
  return [
    fakeSpawnable(5, 4), // seeker
    fakeSpawnable(3, 4), // green
    fakeSpawnable(1, 3), // pinwheel
    fakeSpawnable(0, 2), // snake (base 0 → absent at start)
  ];
}

describe('SpawnDirector — interval ramp (AC1)', () => {
  it('interval at run start (elapsed 0) equals BASE_INTERVAL', () => {
    const dir = new SpawnDirector(fourMix(), seqRng([0.1]));
    expect(dir.elapsedMs).toBe(0);
    expect(dir.currentInterval).toBe(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
  });

  it('interval mid-ramp is the linear midpoint BASE − (BASE−MIN)/2', () => {
    const dir = new SpawnDirector(fourMix());
    const mid =
      SPAWN_DIRECTOR_BASE_INTERVAL_MS -
      (SPAWN_DIRECTOR_BASE_INTERVAL_MS - SPAWN_DIRECTOR_MIN_INTERVAL_MS) / 2;
    expect(dir.intervalAt(SPAWN_DIRECTOR_RAMP_DURATION_MS / 2)).toBeCloseTo(mid, 9);
  });

  it('interval reaches the MIN floor at RAMP_DURATION and never goes lower', () => {
    const dir = new SpawnDirector(fourMix());
    expect(dir.intervalAt(SPAWN_DIRECTOR_RAMP_DURATION_MS)).toBeCloseTo(
      SPAWN_DIRECTOR_MIN_INTERVAL_MS,
      9,
    );
    // Any larger elapsed clamps to MIN, never below.
    for (const mult of [1.5, 3, 100]) {
      expect(dir.intervalAt(SPAWN_DIRECTOR_RAMP_DURATION_MS * mult)).toBe(
        SPAWN_DIRECTOR_MIN_INTERVAL_MS,
      );
    }
  });

  it('interval is monotonic non-increasing across increasing elapsed samples', () => {
    const dir = new SpawnDirector(fourMix());
    let prev = Infinity;
    for (let e = 0; e <= SPAWN_DIRECTOR_RAMP_DURATION_MS * 1.5; e += 1000) {
      const v = dir.intervalAt(e);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('dt-independence: fine vs coarse steps to the same elapsed give identical interval + weights', () => {
    const total = 1000; // ms reached two ways
    const fine = new SpawnDirector(fourMix());
    for (let i = 0; i < 100; i++) fine.fixedUpdate(10); // 100 × 10ms
    const coarse = new SpawnDirector(fourMix());
    for (let i = 0; i < 5; i++) coarse.fixedUpdate(200); // 5 × 200ms

    expect(fine.elapsedMs).toBeCloseTo(total, 9);
    expect(coarse.elapsedMs).toBeCloseTo(total, 9);
    // Interval is a pure function of elapsed = Σdt → identical.
    expect(fine.currentInterval).toBeCloseTo(coarse.currentInterval, 9);
    // Weights (e.g. the snake's) are equal too.
    expect(fine.weightAt(0, 2, fine.elapsedMs)).toBeCloseTo(
      coarse.weightAt(0, 2, coarse.elapsedMs),
      9,
    );
  });
});

describe('SpawnDirector — first spawn timing', () => {
  it('fires exactly one spawn on the interval crossing, none before', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0])); // always the first archetype
    let steps = 0;
    // Step one fixed sub-step at a time until the first spawn occurs.
    while (totalSpawns(mix) === 0 && steps < 100000) {
      dir.fixedUpdate(DT);
      steps++;
    }
    // Exactly one spawn happened (a single early DT step cannot bank two intervals).
    expect(totalSpawns(mix)).toBe(1);
    // And it happened around one BASE interval of elapsed sim time.
    expect(dir.elapsedMs).toBeGreaterThan(SPAWN_DIRECTOR_BASE_INTERVAL_MS * 0.9);
    expect(dir.elapsedMs).toBeLessThan(SPAWN_DIRECTOR_BASE_INTERVAL_MS * 1.1);
  });
});

describe('SpawnDirector — mix ramp / snake gating (AC1)', () => {
  it('at elapsed 0 the snake (base weight 0) is never selected for any rng in [0,1)', () => {
    // Sweep rng across the unit interval; snake is index 3 with base weight 0.
    for (let r = 0; r < 1; r += 0.02) {
      const mix = fourMix();
      const dir = new SpawnDirector(mix, () => r);
      dir._pickAndSpawn(); // elapsed 0 (fresh)
      expect(mix[3].system.spawnCalls).toBe(0); // snake never spawned
      // Exactly one of the positive-weight archetypes spawned.
      expect(totalSpawns(mix)).toBe(1);
    }
  });

  it('at/after RAMP_DURATION the snake (peak weight > 0) can be selected (rng near 1)', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, () => 0.9999);
    dir._elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS; // peak weights active
    dir._pickAndSpawn();
    expect(mix[3].system.spawnCalls).toBe(1); // snake selected at the top band
  });

  it('weighted selection is deterministic: rng landing in an archetype band picks it', () => {
    // Constant weights (base==peak) so the mix is independent of elapsed: [2,3].
    const a = fakeSpawnable(2, 2);
    const b = fakeSpawnable(3, 3);
    // rng=0.5 → r = 0.5*5 = 2.5, which lands in b's cumulative band [2,5).
    const dir = new SpawnDirector([a, b], () => 0.5);
    dir._pickAndSpawn();
    expect(a.system.spawnCalls).toBe(0);
    expect(b.system.spawnCalls).toBe(1);
  });
});

describe('SpawnDirector — global active cap (AC2)', () => {
  it('spawns one when the summed active count is below MAX_ACTIVE', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS); // one interval elapses
    expect(totalSpawns(mix)).toBe(1);
  });

  it('spawns nothing when the summed active count is at/above MAX_ACTIVE, and discards the banked interval', () => {
    const mix = fourMix();
    // Pin one pool's active count at the cap so the summed total is at the cap.
    mix[0].system.enemyPool.activeCount = SPAWN_DIRECTOR_MAX_ACTIVE;
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS); // an interval elapses at cap
    expect(totalSpawns(mix)).toBe(0); // no spawn

    // The banked interval was discarded (subtracted), NOT re-tried: dropping the
    // count below the cap and stepping a tiny dt (< one interval) still spawns none.
    mix[0].system.enemyPool.activeCount = 0;
    dir.fixedUpdate(1);
    expect(totalSpawns(mix)).toBe(0);
  });

  it('the cap sums active counts across ALL governed pools (a snake counts as its segments)', () => {
    const mix = fourMix();
    // Spread the cap across two pools so neither alone reaches it.
    mix[0].system.enemyPool.activeCount = SPAWN_DIRECTOR_MAX_ACTIVE - 3;
    mix[3].system.enemyPool.activeCount = 3; // e.g. a snake's live segments
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(totalSpawns(mix)).toBe(0); // summed total == cap → gated
  });

  it('is a SOFT cap: a snake picked at MAX_ACTIVE-1 overshoots to MAX_ACTIVE-1+SNAKE_SEGMENT_COUNT, then the next spawn is gated', () => {
    // Two archetypes whose spawn() grows their own pools: a single-body one (0
    // weight, never picked) and a snake-like one (adds SNAKE_SEGMENT_COUNT at
    // once, the only positive-weight archetype so it is always selected).
    const single = countingSpawnable(0, 0, 1);
    const snakeLike = countingSpawnable(1, 1, SNAKE_SEGMENT_COUNT);
    // Prime the summed active total to exactly one below the cap.
    single.system.enemyPool.activeCount = SPAWN_DIRECTOR_MAX_ACTIVE - 1;

    const dir = new SpawnDirector([single, snakeLike], seqRng([0.0]));
    // One interval elapses: the pre-check sees MAX_ACTIVE-1 (< cap) and lets the
    // snake spawn, which adds a whole SEGMENT_COUNT chain in one go.
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(snakeLike.system.spawnCalls).toBe(1);
    expect(single.system.spawnCalls).toBe(0);

    // Bounded soft-cap ceiling: the summed total sits at MAX_ACTIVE-1 + the
    // largest per-spawn cost (a snake's SEGMENT_COUNT), NOT clamped to the cap.
    const total =
      single.system.enemyPool.activeCount + snakeLike.system.enemyPool.activeCount;
    expect(total).toBe(SPAWN_DIRECTOR_MAX_ACTIVE - 1 + SNAKE_SEGMENT_COUNT);

    // Now over the cap: the next elapsed interval spawns nothing further.
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(snakeLike.system.spawnCalls).toBe(1); // no additional spawn
    expect(single.system.spawnCalls).toBe(0);
  });
});

// A fake spawnable exposing a canSpawn() eligibility gate (the Mirror Reflector
// pattern): the director must zero its weight when canSpawn() is false so a capped
// archetype is never picked and its share flows to the others.
function gatedSpawnable(baseWeight, peakWeight, eligible = true, activeCount = 0) {
  const system = {
    spawnCalls: 0,
    _eligible: eligible,
    canSpawn() {
      return this._eligible;
    },
    spawn() {
      this.spawnCalls++;
    },
    enemyPool: { activeCount },
  };
  return { system, baseWeight, peakWeight };
}

describe('SpawnDirector — canSpawn() eligibility gate (Story 6.3)', () => {
  it('never selects an ineligible (canSpawn()===false) spawnable and redirects its share to the others', () => {
    // The gated archetype carries ALL the weight but is ineligible; the only other
    // archetype has a tiny weight. Across the whole rng range the eligible one is
    // always picked (the ineligible band is zeroed) — its share was redistributed.
    for (let r = 0; r < 1; r += 0.05) {
      const gated = gatedSpawnable(100, 100, false); // huge weight, but ineligible
      const eligible = fakeSpawnable(1, 1); // tiny weight, always eligible
      const dir = new SpawnDirector([gated, eligible], () => r);
      dir._pickAndSpawn();
      expect(gated.system.spawnCalls).toBe(0); // never picked while ineligible
      expect(eligible.system.spawnCalls).toBe(1); // took every interval instead
    }
  });

  it('no-ops the interval only when the SOLE positive-weight archetype is ineligible', () => {
    // A single gated archetype that is ineligible → total weight 0 → nothing spawns
    // (the interval is intentionally consumed but no honest spawn is counted).
    const gated = gatedSpawnable(5, 5, false);
    const dir = new SpawnDirector([gated], seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(gated.system.spawnCalls).toBe(0);
    expect(dir.spawnCount).toBe(0); // spawnCount stays honest — no phantom spawn
  });

  it('behaves unchanged when the gated spawnable IS eligible (canSpawn()===true)', () => {
    // Same weights, now eligible: rng=0.5 over weights [5,3] → r=0.5*8=4 lands in the
    // first band [0,5) → the gated one is picked exactly as an ungated archetype would be.
    const gated = gatedSpawnable(5, 5, true);
    const other = fakeSpawnable(3, 3);
    const dir = new SpawnDirector([gated, other], () => 0.5);
    dir._pickAndSpawn();
    expect(gated.system.spawnCalls).toBe(1);
    expect(other.system.spawnCalls).toBe(0);
  });
});

describe('SpawnDirector — zero per-tick allocation (NFR1/NFR2)', () => {
  it('reuses the same _weights buffer across many steady-state steps', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0, 0.3, 0.6, 0.9]));
    const ref = dir._weights;
    const len = ref.length;
    for (let i = 0; i < 2000; i++) dir.fixedUpdate(DT);
    // The scratch buffer reference and length are stable — no new arrays per tick.
    expect(dir._weights).toBe(ref);
    expect(dir._weights.length).toBe(len);
    // It did actually spawn over the run (the path was exercised).
    expect(totalSpawns(mix)).toBeGreaterThan(0);
  });
});

describe('SpawnDirector — escalation drives real cadence through fixedUpdate (AC1)', () => {
  it('spawns strictly more over a fixed elapsed window at peak (interval≈MIN) than near start (interval≈BASE)', () => {
    const WINDOW_MS = 3000;
    // Count spawns fixedUpdate actually fires over WINDOW_MS of elapsed sim time,
    // starting from a given elapsed. The fourMix fakes never grow activeCount, so
    // the global cap never gates — this isolates the cadence.
    function spawnsOverWindow(startElapsedMs) {
      const mix = fourMix();
      const dir = new SpawnDirector(mix, seqRng([0.0, 0.3, 0.6, 0.9]));
      dir._elapsedMs = startElapsedMs; // jump to the ramp position under test
      const end = startElapsedMs + WINDOW_MS;
      while (dir.elapsedMs < end) dir.fixedUpdate(DT);
      return totalSpawns(mix);
    }

    // Near start the interval is ≈ BASE (slow); at/after RAMP_DURATION it is
    // clamped to MIN (fast), so the same window yields many more spawns.
    const nearStart = spawnsOverWindow(0);
    const atPeak = spawnsOverWindow(SPAWN_DIRECTOR_RAMP_DURATION_MS);

    // The headline behavior: cadence genuinely rises with elapsed. If the ramp
    // were replaced by a constant BASE interval, these would be ~equal.
    expect(atPeak).toBeGreaterThan(nearStart);
    // And the counts track the actual ramped intervals (within ±1 boundary slack).
    const expectedNear = Math.floor(WINDOW_MS / SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    const expectedPeak = Math.floor(WINDOW_MS / SPAWN_DIRECTOR_MIN_INTERVAL_MS);
    expect(Math.abs(nearStart - expectedNear)).toBeLessThanOrEqual(1);
    expect(Math.abs(atPeak - expectedPeak)).toBeLessThanOrEqual(1);
  });

  it('at peak elapsed the consumed interval is ≈ MIN_INTERVAL, not BASE_INTERVAL', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir._elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS; // interval clamped at MIN
    // Step small DT slices until the first spawn fires; the elapsed advanced to
    // reach it is the interval the accumulator actually crossed.
    const startElapsed = dir.elapsedMs;
    let guard = 0;
    while (totalSpawns(mix) === 0 && guard < 100000) {
      dir.fixedUpdate(DT);
      guard++;
    }
    const consumed = dir.elapsedMs - startElapsed;
    expect(consumed).toBeGreaterThan(SPAWN_DIRECTOR_MIN_INTERVAL_MS - DT);
    expect(consumed).toBeLessThan(SPAWN_DIRECTOR_MIN_INTERVAL_MS + DT);
    // Sanity: that is far below the base interval (the ramp really shrank it).
    expect(consumed).toBeLessThan(SPAWN_DIRECTOR_BASE_INTERVAL_MS / 2);
  });
});

// A fake spawnable that records the arguments its spawn() was last called with,
// so tests can assert the director forwards the ship's (x,y) as the avoid point.
function recordingSpawnable(baseWeight, peakWeight, activeCount = 0) {
  const system = {
    spawnCalls: 0,
    lastArgs: null,
    spawn(...args) {
      this.spawnCalls++;
      this.lastArgs = args;
    },
    enemyPool: { activeCount },
  };
  return { system, baseWeight, peakWeight };
}

describe('SpawnDirector — spawn-point ship-avoidance forwarding (Story 2.6, AC3)', () => {
  it('forwards ship.x, ship.y to the picked archetype spawn() when built with a ship', () => {
    const a = recordingSpawnable(1, 1); // the only positive-weight archetype
    const ship = { x: 321, y: 654 };
    const dir = new SpawnDirector([a], seqRng([0.0]), ship);
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS); // one interval → one spawn

    expect(a.system.spawnCalls).toBe(1);
    expect(a.system.lastArgs).toEqual([321, 654]);
  });

  it('reads the ship position LIVE at spawn time (a moving player)', () => {
    const a = recordingSpawnable(1, 1);
    const ship = { x: 10, y: 20 };
    const dir = new SpawnDirector([a], seqRng([0.0]), ship);
    // Move the ship before the interval elapses.
    ship.x = 999;
    ship.y = 888;
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(a.system.lastArgs).toEqual([999, 888]);
  });

  it('back-compat: with no ship the picked spawn() is called with NO avoid args', () => {
    const a = recordingSpawnable(1, 1);
    const dir = new SpawnDirector([a], seqRng([0.0])); // no ship
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(a.system.spawnCalls).toBe(1);
    expect(a.system.lastArgs).toEqual([]); // spawn() — undefined avoid args
  });
});

describe('SpawnDirector — read-only spawnCount latch (Story 4.5)', () => {
  it('is 0 on a fresh director before any tick', () => {
    const dir = new SpawnDirector(fourMix(), seqRng([0.0]));
    expect(dir.spawnCount).toBe(0);
  });

  it('reports 1 on the tick a single director spawn fires', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS); // one interval → one spawn
    expect(totalSpawns(mix)).toBe(1);
    expect(dir.spawnCount).toBe(1);
  });

  it('counts one spawn event even when a snake adds many segments', () => {
    // A snake-like archetype whose spawn() adds SNAKE_SEGMENT_COUNT segments is the
    // only positive-weight pick — one director spawn is still ONE spawn event.
    const snakeLike = countingSpawnable(1, 1, SNAKE_SEGMENT_COUNT);
    const dir = new SpawnDirector([snakeLike], seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(snakeLike.system.spawnCalls).toBe(1);
    expect(dir.spawnCount).toBe(1); // one event, not SNAKE_SEGMENT_COUNT
  });

  it('resets to 0 each tick (per-tick latch, not cumulative)', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS); // spawns → count 1
    expect(dir.spawnCount).toBe(1);
    dir.fixedUpdate(1); // tiny dt, no interval crossed → no spawn
    expect(dir.spawnCount).toBe(0);
  });

  it('is 0 on a tick gated by the global active cap (no spawn taken)', () => {
    const mix = fourMix();
    mix[0].system.enemyPool.activeCount = SPAWN_DIRECTOR_MAX_ACTIVE; // at the cap
    const dir = new SpawnDirector(mix, seqRng([0.0]));
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    expect(totalSpawns(mix)).toBe(0);
    expect(dir.spawnCount).toBe(0);
  });

  it('counts a spawn taken via the float-guard fallback branch (rng lands on the top boundary)', () => {
    // rng() === 1 → r = total; the first weighted loop subtracts every band without
    // r ever going negative, so the pick resolves in the float-guard fallback (which
    // awards the last positive-weight archetype). This exercises that branch's
    // spawnCount++ (the seqRng([0.0]) tests only ever hit the first loop).
    const a = fakeSpawnable(1, 1); // single positive-weight archetype
    const dir = new SpawnDirector([a], () => 1);
    dir.fixedUpdate(SPAWN_DIRECTOR_BASE_INTERVAL_MS); // one interval → one spawn
    expect(a.system.spawnCalls).toBe(1); // a spawn actually occurred
    expect(dir.spawnCount).toBe(1);
  });
});

// A mutable DPS-telemetry stub exposing only the `dps` field the governor reads.
function dpsStub(dps = 0) {
  return { dps };
}

describe('SpawnDirector — build-adaptive rate governor (Story 9.2)', () => {
  it('no telemetry bound ≡ v1: pressure stays 0 and effectiveInterval == intervalAt every tick', () => {
    const dir = new SpawnDirector(fourMix(), seqRng([0.0, 0.3, 0.6, 0.9]));
    expect(dir.dpsTelemetry).toBe(null); // defaults to no source
    for (let i = 0; i < 500; i++) {
      dir.fixedUpdate(DT);
      expect(dir.pressure).toBe(0);
      // Effective interval is byte-identical to the pure v1 floor at pressure 0.
      expect(dir.effectiveInterval).toBe(dir.intervalAt(dir.elapsedMs));
    }
  });

  it('zero dps: pressure stays 0 and the effective interval is the v1 floor', () => {
    const dir = new SpawnDirector(fourMix(), seqRng([0.0]));
    dir.dpsTelemetry = dpsStub(0);
    for (let i = 0; i < 300; i++) {
      dir.fixedUpdate(DT);
      expect(dir.pressure).toBe(0);
      expect(dir.effectiveInterval).toBe(dir.intervalAt(dir.elapsedMs));
    }
  });

  it('sustained high dps: pressure rises by ≤ slew·dt per tick, settles at the clamped target, interval shorter than the floor', () => {
    // dps == reference → target pressure exactly 1.0 (below the MAX cap).
    const dir = new SpawnDirector(fourMix(), seqRng([0.0, 0.5]));
    dir.dpsTelemetry = dpsStub(SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE);
    const target = 1.0;
    const maxStep = SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS * DT;
    for (let i = 0; i < 500; i++) {
      const before = dir.pressure;
      dir.fixedUpdate(DT);
      // Each adjustment is bounded by the slew rate (with float slack).
      expect(dir.pressure - before).toBeLessThanOrEqual(maxStep + 1e-9);
      expect(dir.pressure).toBeGreaterThanOrEqual(before); // rising, never dips
    }
    // Settled exactly at the clamped target and holds there.
    expect(dir.pressure).toBeCloseTo(target, 9);
    // Effective interval is genuinely shorter than the v1 floor (more spawns).
    const floor = dir.intervalAt(dir.elapsedMs);
    expect(dir.effectiveInterval).toBeLessThan(floor);
    expect(dir.effectiveInterval).toBeCloseTo(floor / (1 + target), 9);
  });

  it('sudden power spike: pressure climbs monotonically without overshoot and clamps at MAX_PRESSURE', () => {
    // dps far above the reference so the raw target exceeds the cap → clamps to MAX.
    const dir = new SpawnDirector(fourMix(), seqRng([0.0]));
    dir.dpsTelemetry = dpsStub(SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE * 100);
    let prev = dir.pressure;
    for (let i = 0; i < 2000; i++) {
      dir.fixedUpdate(DT);
      // Monotonic non-decreasing and NEVER exceeds the clamped target (no overshoot).
      expect(dir.pressure).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(dir.pressure).toBeLessThanOrEqual(SPAWN_DIRECTOR_MAX_PRESSURE + 1e-9);
      prev = dir.pressure;
    }
    // Reached and holds the hard cap.
    expect(dir.pressure).toBeCloseTo(SPAWN_DIRECTOR_MAX_PRESSURE, 9);
  });

  it('sudden power drop: pressure relaxes monotonically to exactly 0 and the interval returns to the exact v1 floor', () => {
    const dir = new SpawnDirector(fourMix(), seqRng([0.0]));
    const stub = dpsStub(SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE * 100);
    dir.dpsTelemetry = stub;
    // Drive pressure up to the cap first.
    for (let i = 0; i < 2000; i++) dir.fixedUpdate(DT);
    expect(dir.pressure).toBeGreaterThan(0);
    // Power collapses to 0 (death reset / remnant consumption manifests as dps→0).
    stub.dps = 0;
    let prev = dir.pressure;
    for (let i = 0; i < 2000; i++) {
      dir.fixedUpdate(DT);
      expect(dir.pressure).toBeLessThanOrEqual(prev + 1e-12); // monotonic relax
      expect(dir.pressure).toBeGreaterThanOrEqual(0); // never negative
      prev = dir.pressure;
    }
    // Relaxed back to EXACTLY 0 → the effective interval is the exact v1 floor again.
    expect(dir.pressure).toBe(0);
    expect(dir.effectiveInterval).toBe(dir.intervalAt(dir.elapsedMs));
  });

  it('framerate independence: fine vs coarse dt to the same elapsed give identical pressure + effective interval (constant target)', () => {
    // A constant huge target so both runs are still slewing (not yet capped) at the
    // compared elapsed — pressure accrues slew·Σdt, identical regardless of cadence.
    const DPS = SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE * 100;
    const totalMs = 1000; // reached two ways; slew·1000 = 0.2 < MAX, so still climbing

    const fine = new SpawnDirector(fourMix(), seqRng([0.0]));
    fine.dpsTelemetry = dpsStub(DPS);
    for (let i = 0; i < 100; i++) fine.fixedUpdate(10); // 100 × 10ms

    const coarse = new SpawnDirector(fourMix(), seqRng([0.0]));
    coarse.dpsTelemetry = dpsStub(DPS);
    for (let i = 0; i < 5; i++) coarse.fixedUpdate(200); // 5 × 200ms

    expect(fine.elapsedMs).toBeCloseTo(totalMs, 9);
    expect(coarse.elapsedMs).toBeCloseTo(totalMs, 9);
    expect(fine.pressure).toBeCloseTo(coarse.pressure, 9);
    expect(fine.effectiveInterval).toBeCloseTo(coarse.effectiveInterval, 9);
    // Sanity: it really was still slewing (below the cap), so this is a real compare.
    expect(fine.pressure).toBeGreaterThan(0);
    expect(fine.pressure).toBeLessThan(SPAWN_DIRECTOR_MAX_PRESSURE);
  });

  it('sustained pressure shortens the REALIZED cadence: more spawns per window than pressure 0 (drives the accumulator loop, not just the getter)', () => {
    const WINDOW_MS = 4000;
    function spawnsOverWindow(dpsValue) {
      const mix = fourMix();
      const dir = new SpawnDirector(mix, seqRng([0.0, 0.3, 0.6, 0.9]));
      if (dpsValue != null) dir.dpsTelemetry = dpsStub(dpsValue);
      // Settle pressure first (well past the slew ramp) at a FIXED elapsed so both
      // runs share the same v1 floor, then count spawns over the window from there.
      dir._elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS; // interval at the MIN floor
      for (let i = 0; i < 4000; i++) dir.fixedUpdate(DT); // reach steady-state pressure
      const startSpawns = totalSpawns(mix);
      const end = dir.elapsedMs + WINDOW_MS;
      while (dir.elapsedMs < end) dir.fixedUpdate(DT);
      return { spawns: totalSpawns(mix) - startSpawns, pressure: dir.pressure };
    }
    const base = spawnsOverWindow(null); // pressure 0 → v1 floor cadence
    const pressured = spawnsOverWindow(SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE); // target 1.0
    expect(base.pressure).toBe(0);
    expect(pressured.pressure).toBeCloseTo(1.0, 6);
    // Realized cadence genuinely rose (this is what fails if the loop ever stops
    // dividing the interval by (1+pressure)).
    expect(pressured.spawns).toBeGreaterThan(base.spawns);
    // ≈ the floor/(1+pressure) ratio: pressure 1.0 → ~2× the spawns (±1 boundary slack).
    expect(pressured.spawns).toBeGreaterThanOrEqual(base.spawns * 2 - 1);
  });

  it('zero per-tick allocation under a live governor: the _weights buffer stays stable over many governed ticks', () => {
    const mix = fourMix();
    const dir = new SpawnDirector(mix, seqRng([0.0, 0.3, 0.6, 0.9]));
    dir.dpsTelemetry = dpsStub(SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE * 100); // pressure active
    const ref = dir._weights;
    const len = ref.length;
    for (let i = 0; i < 2000; i++) dir.fixedUpdate(DT);
    // The scratch buffer reference + length are unchanged — the governor added only
    // scalar field updates, no new arrays/objects in the hot loop.
    expect(dir._weights).toBe(ref);
    expect(dir._weights.length).toBe(len);
    // The governor genuinely engaged (pressure rose) and the loop actually spawned.
    expect(dir.pressure).toBeGreaterThan(0);
    expect(totalSpawns(mix)).toBeGreaterThan(0);
  });
});

describe('SpawnDirector — reset by reconstruction (AC3)', () => {
  it('a freshly constructed director is at the base ramp regardless of a prior run', () => {
    const mixA = fourMix();
    const a = new SpawnDirector(mixA, seqRng([0.0, 0.4, 0.8]));
    // Drive A well past the ramp so its interval is at the MIN floor.
    for (let i = 0; i < 20000; i++) a.fixedUpdate(DT);
    expect(a.currentInterval).toBeCloseTo(SPAWN_DIRECTOR_MIN_INTERVAL_MS, 6);

    // A brand-new director (a new run after game over) starts at the base ramp.
    const mixB = fourMix();
    const b = new SpawnDirector(mixB, () => 0.9999);
    expect(b.elapsedMs).toBe(0);
    expect(b.currentInterval).toBe(SPAWN_DIRECTOR_BASE_INTERVAL_MS);
    // And at elapsed 0 it never selects the snake, even with rng near 1.
    b._pickAndSpawn();
    expect(mixB[3].system.spawnCalls).toBe(0);
  });
});
