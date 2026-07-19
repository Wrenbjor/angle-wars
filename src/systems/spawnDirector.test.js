import { describe, it, expect } from 'vitest';
import { SpawnDirector } from './SpawnDirector.js';
import {
  FIXED_STEP_MS,
  SPAWN_DIRECTOR_BASE_INTERVAL_MS,
  SPAWN_DIRECTOR_MIN_INTERVAL_MS,
  SPAWN_DIRECTOR_RAMP_DURATION_MS,
  SPAWN_DIRECTOR_MAX_ACTIVE,
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
