import { describe, it, expect } from 'vitest';
import { DpsTelemetrySystem } from './DpsTelemetrySystem.js';
import {
  DPS_WINDOW_MS,
  DPS_DAMAGE_PER_KILL,
  FIXED_STEP_MS,
} from '../config/constants.js';

// DpsTelemetrySystem coverage (Story 9.1, repointed Story 9.3). The system is a
// pure observer that maintains a rolling ~10s estimate of player weapon output from
// a single input: collisionSystem.bulletDamageCount (the per-tick count of damaging
// bullet HITS — kills PLUS non-killing armor hits — repointed from bulletKillCount
// in Story 9.3). These tests drive it over a stub source and pin every I/O Matrix
// row: zero-tick decay, single-hit non-spike + expiry after N ticks, sustained-rate
// convergence (with a linear ramp), mid-run tracking, framerate independence (same
// dps for the same tick count), and that a non-killing armor hit still credits build
// power (build stays honest against armor).

// Derived exactly as the system does, so the assertions track the constants.
const N = Math.max(1, Math.round(DPS_WINDOW_MS / FIXED_STEP_MS));
// Normalize by the ACTUAL ring span (N slots × step), matching the system's
// divisor — not the nominal DPS_WINDOW_MS — so the expectations track the code's
// real normalization rather than a nominal assumption. Byte-identical (10 s) at
// the default constants.
const WINDOW_SEC = (N * FIXED_STEP_MS) / 1000;

// A minimal stub matching the only field the system reads (Story 9.3: the source is
// bulletDamageCount, the damaging-HIT count, not bulletKillCount). `hits` is mutated
// between ticks to script a per-tick damaging-hit sequence.
function makeSource(hits = 0) {
  return { bulletDamageCount: hits };
}

// Drive the system one fixed step with the given per-tick damaging-hit count.
function tick(sys, src, hits) {
  src.bulletDamageCount = hits;
  sys.fixedUpdate(FIXED_STEP_MS);
}

describe('DpsTelemetrySystem — rolling player DPS estimate', () => {
  it('starts at dps 0 with a single pre-allocated Float64Array ring, no window yet', () => {
    const sys = new DpsTelemetrySystem(makeSource());
    expect(sys.dps).toBe(0);
    expect(sys._ring).toBeInstanceOf(Float64Array);
    expect(sys._ring.length).toBe(N);
    expect(sys.windowMs).toBe(DPS_WINDOW_MS);
  });

  it('does NOT re-allocate the ring on fixedUpdate (zero per-frame allocation)', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    const ring = sys._ring;
    for (let i = 0; i < 50; i++) tick(sys, src, i % 2);
    // Same Float64Array instance throughout — the hot loop allocates nothing.
    expect(sys._ring).toBe(ring);
  });

  it('a tick with no kills adds 0 to the window (dps reflects only decay)', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    for (let i = 0; i < 100; i++) tick(sys, src, 0);
    expect(sys.dps).toBe(0);
  });

  it('a single isolated kill rises to exactly 1/windowSec, never spikes above it, then expires after N ticks', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    const share = DPS_DAMAGE_PER_KILL / WINDOW_SEC; // 0.1 @ default constants

    // One kill tick, then silence.
    tick(sys, src, 1);
    expect(sys.dps).toBeCloseTo(share, 12);

    // Holds flat across the rest of the window and NEVER spikes above its share.
    for (let t = 1; t < N; t++) {
      tick(sys, src, 0);
      expect(sys.dps).toBeCloseTo(share, 12);
      expect(sys.dps).toBeLessThanOrEqual(share + 1e-9);
    }
    // The Nth tick after the kill evicts that slot — the estimate drops to 0.
    tick(sys, src, 0);
    expect(sys.dps).toBe(0);
  });

  it('sustained output converges to K, ramping ~linearly across the window', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    // 1 damage-unit per tick == FIXED_STEP ticks/sec × 1 == (1000/FIXED_STEP_MS)/sec.
    const K = DPS_DAMAGE_PER_KILL / (FIXED_STEP_MS / 1000); // 60 @ default constants

    let prev = 0;
    for (let t = 1; t <= N; t++) {
      tick(sys, src, 1);
      // Linear ramp: after t filled slots, dps = (t · dmg) / windowSec.
      const expected = (t * DPS_DAMAGE_PER_KILL) / WINDOW_SEC;
      expect(sys.dps).toBeCloseTo(expected, 9);
      // Monotonic non-decreasing while filling — a smooth ramp, not a jump.
      expect(sys.dps).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = sys.dps;
    }
    // A full window of sustained 1/tick output converges to K.
    expect(sys.dps).toBeCloseTo(K, 6);

    // After output stops, it decays back to 0 across ~the window.
    for (let t = 0; t < N; t++) tick(sys, src, 0);
    expect(sys.dps).toBe(0);
  });

  it('tracks a mid-run rate change R1 → R2 gradually, with no instantaneous jump', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    // Fill the window at R1 = 1/tick, then switch to R2 = 3/tick.
    for (let t = 0; t < N; t++) tick(sys, src, 1);
    const atR1 = sys.dps; // == K1

    // The per-tick change can only ever be (Δdmg)/windowSec — one slot swings by
    // at most one tick's worth. Assert no jump larger than a single kill's share
    // as the window slides from R1 toward R2.
    const maxStep = (3 - 0) * DPS_DAMAGE_PER_KILL / WINDOW_SEC + 1e-9;
    let prev = atR1;
    for (let t = 0; t < N; t++) {
      tick(sys, src, 3);
      expect(Math.abs(sys.dps - prev)).toBeLessThanOrEqual(maxStep);
      // Rising toward the higher rate — never overshoots R2.
      expect(sys.dps).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = sys.dps;
    }
    // After a full window at R2 it has fully tracked to the new rate (3× R1).
    expect(sys.dps).toBeCloseTo(atR1 * 3, 6);
  });

  it('is framerate-independent: identical dps for an identical tick sequence regardless of dt', () => {
    // Same scripted kill sequence, driven with two DIFFERENT dt cadences. dt is
    // ignored (the system advances per tick, not per dt), so the resulting dps
    // must be bit-identical for the same tick count.
    const seq = [];
    for (let t = 0; t < N + 250; t++) seq.push(t % 7 === 0 ? 2 : 0);

    const srcA = makeSource();
    const sysA = new DpsTelemetrySystem(srcA);
    for (const k of seq) {
      srcA.bulletKillCount = k;
      sysA.fixedUpdate(FIXED_STEP_MS); // "60 FPS" cadence
    }

    const srcB = makeSource();
    const sysB = new DpsTelemetrySystem(srcB);
    for (const k of seq) {
      srcB.bulletKillCount = k;
      sysB.fixedUpdate(FIXED_STEP_MS * 3); // a wildly different render cadence
    }

    expect(sysB.dps).toBe(sysA.dps);
  });

  it('never mutates its telemetry source (pure observer)', () => {
    const src = makeSource(5);
    const sys = new DpsTelemetrySystem(src);
    sys.fixedUpdate(FIXED_STEP_MS);
    // The system only READS bulletDamageCount — it must not have changed it.
    expect(src.bulletDamageCount).toBe(5);
  });

  it('a non-killing armor hit still advances dps by exactly 1/windowSec (Story 9.3 — build stays honest against armor)', () => {
    // A single tick with one damaging HIT that killed NOTHING (bulletDamageCount 1,
    // bulletKillCount 0) must credit build power identically to a kill: the estimator
    // reads bulletDamageCount, so damage poured into armor is not lost. This is the
    // whole point of the 9.3 repoint — the governor's build signal cannot sag while
    // the player pours fire into a wall of armor.
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    const share = DPS_DAMAGE_PER_KILL / WINDOW_SEC; // 0.1 @ default constants

    // One armor-hit tick (no kill), then silence — identical curve to a lone kill.
    tick(sys, src, 1);
    expect(sys.dps).toBeCloseTo(share, 12);
    // Integer credit keeps the estimate exact (no float drift): flat across the window.
    for (let t = 1; t < N; t++) {
      tick(sys, src, 0);
      expect(sys.dps).toBeCloseTo(share, 12);
    }
    // Expires cleanly after N ticks — bit-exact 0, proving the ring stayed integer-valued.
    tick(sys, src, 0);
    expect(sys.dps).toBe(0);
  });
});

// --- Story 9.4 transient-boost seam ------------------------------------------
// applyBoost(magnitude, durationMs) folds a linearly-decaying transient into the
// SAME `dps` the governor consumes, so the 9.2/9.3 response answers with no new
// balancing surface. These pin the I/O Matrix rows for the hook: rise, linear
// decay to exactly 0 at durationMs, frame-rate independence of the decay,
// additive stacking with a re-derived drain, invalid-input silent no-op, and
// zero-allocation with a boost live. Power-of-two magnitudes/durations/dt are
// used so the drain arithmetic is exact in binary float (=== 0 assertions hold).
describe('DpsTelemetrySystem — Story 9.4 boost hook', () => {
  it('starts with no boost (boostDps 0) — dps is the pure rolling estimate', () => {
    const sys = new DpsTelemetrySystem(makeSource());
    expect(sys.boostDps).toBe(0);
  });

  it('a boost immediately raises boostDps by the magnitude and folds into dps on the next tick', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    // Exact-in-float: drain = 16/1024 = 0.015625, drain/tick @ dt 64 = 1.0.
    sys.applyBoost(16, 1024);
    // The reservoir jumps immediately; dps is not recomputed until fixedUpdate.
    expect(sys.boostDps).toBe(16);
    // One tick with zero hits: rolling estimate stays 0, so dps == the boost after
    // one tick's decay (16 − 1 = 15) — a clear rise above 0.
    src.bulletDamageCount = 0;
    sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(15);
    expect(sys.dps).toBe(15);
    expect(sys.dps).toBeGreaterThan(0);
  });

  it('decays linearly to EXACTLY 0 at durationMs (then holds at 0)', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    sys.applyBoost(16, 1024); // 16 ticks @ dt 64 (1024 ms), 1.0 drained per tick
    // Just before the fade completes it is still positive (linear, no early clamp).
    for (let t = 0; t < 15; t++) sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(1);
    // The 16th tick lands exactly on durationMs → bit-exact 0.
    sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(0);
    expect(sys.dps).toBe(0);
    // Held at 0 — no undershoot, no negative reservoir poisoning dps.
    for (let t = 0; t < 10; t++) sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(0);
  });

  it('the decay is frame-rate independent — same boostDps for the same sim time at any dt', () => {
    // Same boost, two different tick cadences, compared at the SAME elapsed sim time.
    const srcA = makeSource();
    const sysA = new DpsTelemetrySystem(srcA);
    sysA.applyBoost(16, 1024);
    for (let t = 0; t < 8; t++) sysA.fixedUpdate(64); // 8 × 64 = 512 ms

    const srcB = makeSource();
    const sysB = new DpsTelemetrySystem(srcB);
    sysB.applyBoost(16, 1024);
    for (let t = 0; t < 4; t++) sysB.fixedUpdate(128); // 4 × 128 = 512 ms

    // Half the fade elapsed either way → half the reservoir drained, bit-identical.
    expect(sysA.boostDps).toBe(8);
    expect(sysB.boostDps).toBe(sysA.boostDps);
  });

  it('stacks additively and re-derives the drain so the COMBINED reservoir empties over the new duration', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    sys.applyBoost(8, 1024);
    // A second boost before the first fades: reservoir accumulates, drain re-derived
    // from the CURRENT total so the whole 16 empties over the new 1024 ms.
    sys.applyBoost(8, 1024);
    expect(sys.boostDps).toBe(16);
    expect(sys._boostDrainPerMs).toBe(16 / 1024);
    // 16 ticks @ dt 64 == 1024 ms of sim → the combined reservoir reaches exactly 0.
    for (let t = 0; t < 16; t++) sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(0);
  });

  it('re-derives the drain from the CURRENT reservoir over the NEW duration when stacked mid-decay (not accumulating per-boost rates)', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    src.bulletDamageCount = 0;
    // First boost, then let it PARTIALLY decay before stacking — the equal-duration,
    // no-decay-between stack above cannot tell re-derivation apart from a wrong impl
    // that accumulates per-boost rates (both give identical numbers). Decaying first
    // AND stacking a DIFFERENT duration makes the two diverge, pinning the I/O-matrix
    // contract: the drain empties the COMBINED reservoir over the NEW duration.
    sys.applyBoost(8, 1024); // drain 8/1024 = 0.0078125/ms (exact in float)
    for (let t = 0; t < 4; t++) sys.fixedUpdate(64); // 256 ms → drained 2, boostDps 6
    expect(sys.boostDps).toBe(6);
    // Stack a second boost with a SHORTER duration. Re-derivation sets the drain from
    // the current total (14) over the new 512 ms: 14/512 = 0.02734375/ms (exact).
    sys.applyBoost(8, 512);
    expect(sys.boostDps).toBe(14);
    expect(sys._boostDrainPerMs).toBe(14 / 512);
    // 8 ticks @ 64 == 512 ms → the combined reservoir empties to EXACTLY 0 at the new
    // duration. A rate-accumulating regression (drain 0.0078125 + 8/512 = 0.0234375)
    // would leave 2 here, so this assertion discriminates it.
    for (let t = 0; t < 8; t++) sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(0);
  });

  it('ignores invalid boosts (silent no-op) — never reduces or poisons dps', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    // From a clean state, every invalid form leaves boostDps untouched. +Infinity is
    // rejected too: an infinite magnitude would make boostDps Infinity and next tick
    // `Infinity − Infinity = NaN` stick dps at NaN forever; an infinite durationMs
    // gives a 0 drain that never fades — both are silent no-ops.
    sys.applyBoost(0, 1000);
    sys.applyBoost(-5, 1000);
    sys.applyBoost(NaN, 1000);
    sys.applyBoost(Infinity, 1000);
    sys.applyBoost(10, 0);
    sys.applyBoost(10, -100);
    sys.applyBoost(10, NaN);
    sys.applyBoost(10, Infinity);
    expect(sys.boostDps).toBe(0);
    // dps is not poisoned by the rejected non-finite inputs.
    src.bulletDamageCount = 0;
    sys.fixedUpdate(FIXED_STEP_MS);
    expect(Number.isFinite(sys.dps)).toBe(true);
    expect(sys.dps).toBe(0);
    // A valid boost then invalid follow-ups must not REDUCE the reservoir nor make
    // it non-finite (the hook only ever adds a positive, finite magnitude).
    sys.applyBoost(10, 1000);
    sys.applyBoost(-999, 1000);
    sys.applyBoost(NaN, 1000);
    sys.applyBoost(Infinity, 1000);
    sys.applyBoost(5, 0);
    sys.applyBoost(5, Infinity);
    expect(sys.boostDps).toBe(10);
    src.bulletDamageCount = 0;
    sys.fixedUpdate(FIXED_STEP_MS);
    expect(Number.isFinite(sys.dps)).toBe(true);
    expect(sys.dps).toBeGreaterThan(0);
  });

  it('ADDS the boost to a non-zero rolling estimate (not replace) — dps === rolling + boost', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    // Fill the whole window at a steady 2 hits/tick so the rolling estimate is a
    // known R > 0 (== 2 × 1000/FIXED_STEP_MS == 120 @ default constants). With no
    // boost yet, this tick's dps IS the pure rolling value — capture it.
    for (let t = 0; t < N; t++) tick(sys, src, 2);
    const R = sys.dps;
    expect(R).toBeGreaterThan(0);
    expect(R).toBeCloseTo(120, 6);

    // Now apply a boost and tick ONCE more at the SAME 2 hits/tick: the window slides
    // by one identical slot so _sum (and thus the rolling value) is bit-identical to
    // R, while the boost drains one tick. Power-of-two boost + dt: drain = 16/1024 ×
    // 64 = 1.0 exact, so boostDps = 15. dps must equal R + 15 EXACTLY — proving the
    // boost sums with the live rolling estimate; a regression to replace-semantics
    // (boost masking real dps) would yield 15 (≠ R + 15) and fail here.
    sys.applyBoost(16, 1024);
    src.bulletDamageCount = 2;
    sys.fixedUpdate(64);
    expect(sys.boostDps).toBe(15);
    expect(sys.dps).toBe(R + 15);
  });

  it('allocates nothing in the hot loop while a boost is live (same ring instance)', () => {
    const src = makeSource();
    const sys = new DpsTelemetrySystem(src);
    const ring = sys._ring;
    sys.applyBoost(16, 1024);
    for (let i = 0; i < 40; i++) tick(sys, src, i % 3);
    // The boost decays via scalar fields only — the ring is never re-allocated.
    expect(sys._ring).toBe(ring);
  });
});
