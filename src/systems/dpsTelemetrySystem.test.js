import { describe, it, expect } from 'vitest';
import { DpsTelemetrySystem } from './DpsTelemetrySystem.js';
import {
  DPS_WINDOW_MS,
  DPS_DAMAGE_PER_KILL,
  FIXED_STEP_MS,
} from '../config/constants.js';

// DpsTelemetrySystem coverage (Story 9.1). The system is a pure observer that
// maintains a rolling ~10s estimate of player weapon output from a single input:
// collisionSystem.bulletKillCount. These tests drive it over a stub source and
// pin every I/O Matrix row: zero-tick decay, single-kill non-spike + expiry after
// N ticks, sustained-rate convergence (with a linear ramp), mid-run tracking, and
// framerate independence (same dps for the same tick count).

// Derived exactly as the system does, so the assertions track the constants.
const N = Math.max(1, Math.round(DPS_WINDOW_MS / FIXED_STEP_MS));
// Normalize by the ACTUAL ring span (N slots × step), matching the system's
// divisor — not the nominal DPS_WINDOW_MS — so the expectations track the code's
// real normalization rather than a nominal assumption. Byte-identical (10 s) at
// the default constants.
const WINDOW_SEC = (N * FIXED_STEP_MS) / 1000;

// A minimal stub matching the only field the system reads. `kills` is mutated
// between ticks to script a bullet-kill sequence.
function makeSource(kills = 0) {
  return { bulletKillCount: kills };
}

// Drive the system one fixed step with the given per-tick bullet-kill count.
function tick(sys, src, kills) {
  src.bulletKillCount = kills;
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
    // The system only READS bulletKillCount — it must not have changed it.
    expect(src.bulletKillCount).toBe(5);
  });
});
