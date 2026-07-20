import { describe, it, expect } from 'vitest';
import { SimRateSampler } from './SimRateSampler.js';

const WINDOW = 1000; // ms — the sampling window ArenaScene constructs with.

describe('SimRateSampler', () => {
  it('does not fire below the window and retains the running accumulator', () => {
    // Matrix: below window — accumMs < 1000, no sample, ticksPerSec stays 0.
    const s = new SimRateSampler(WINDOW);
    // Three 300 ms frames = 900 ms < 1000, ticks climbing 0→10→20→30.
    expect(s.update(300, 10)).toBe(0);
    expect(s.update(300, 20)).toBe(0);
    expect(s.update(300, 30)).toBe(0);
    expect(s.ticksPerSec).toBe(0); // never sampled
    expect(s.accumMs).toBeCloseTo(900, 10); // running total retained
    expect(s.lastTicks).toBe(0); // never latched
  });

  it('fires when the window is crossed and latches lastTicks + zeroes accum', () => {
    // Matrix: window crossed — 1000 ms over 10 frames, ticks 0→60 => 60/s.
    // (Cleanly representable 100 ms frames so the accumulator lands exactly on
    // 1000 and fires; a fresh sampler's ticksPerSec is 0 until then.)
    const s = new SimRateSampler(WINDOW);
    let out = 0;
    for (let i = 1; i <= 9; i++) {
      out = s.update(100, i * 6); // 900 ms banked, no sample yet
    }
    expect(out).toBe(0); // ticksPerSec still 0 below the window
    out = s.update(100, 60); // 10th frame crosses 1000 ms, ticks now 60
    expect(out).toBeCloseTo(60, 10);
    expect(s.ticksPerSec).toBeCloseTo(60, 10);
    expect(s.lastTicks).toBe(60); // latched to current ticks
    expect(s.accumMs).toBe(0); // reset
  });

  it('divides by the actual accumulated ms, not the nominal window', () => {
    // Matrix: divisor is actual accum — a single 1500 ms frame with 90 ticks
    // must divide by 1500 (=> 60), not by the 1000 window (which would give 90).
    const s = new SimRateSampler(WINDOW);
    expect(s.update(1500, 90)).toBeCloseTo(60, 10);
    expect(s.ticksPerSec).toBeCloseTo(60, 10);
    expect(s.lastTicks).toBe(90);
    expect(s.accumMs).toBe(0);
  });

  it('computes each window from the tick delta since the previous latch', () => {
    // Matrix: successive windows — second window uses ticks since the last
    // latch, not cumulative from 0.
    const s = new SimRateSampler(WINDOW);
    // First window: 1000 ms, ticks 0→60 => 60/s, latch lastTicks=60.
    expect(s.update(1000, 60)).toBeCloseTo(60, 10);
    expect(s.lastTicks).toBe(60);
    // Second window: 1000 ms, ticks 60→150 (delta 90) => 90/s, NOT 150/s.
    expect(s.update(1000, 150)).toBeCloseTo(90, 10);
    expect(s.lastTicks).toBe(150);
  });

  it('reports the same rate whether delivered as few big frames or many small', () => {
    // Matrix: steady state independent of frame count. Acceptance criterion —
    // sim rate reads render-FPS-independent.
    const few = new SimRateSampler(WINDOW);
    // One big 1000 ms frame carrying 60 ticks.
    const fewRate = few.update(1000, 60);

    const many = new SimRateSampler(WINDOW);
    let manyRate = 0;
    for (let i = 1; i <= 100; i++) {
      // 100 frames of 10 ms = 1000 ms; ticks scaled so 60 accrue over the window.
      manyRate = many.update(10, i * 0.6);
    }
    expect(fewRate).toBeCloseTo(60, 10);
    expect(manyRate).toBeCloseTo(60, 10);
    expect(manyRate).toBeCloseTo(fewRate, 10);
  });

  it('reset() zeroes accumMs, lastTicks, and ticksPerSec', () => {
    // Matrix: reset — all three fields return to 0 after a sample.
    const s = new SimRateSampler(WINDOW);
    s.update(1500, 90); // fires a sample: ticksPerSec=60, lastTicks=90
    expect(s.ticksPerSec).toBeCloseTo(60, 10);
    s.reset();
    expect(s.accumMs).toBe(0);
    expect(s.lastTicks).toBe(0);
    expect(s.ticksPerSec).toBe(0);
  });

  it('throws when constructed with a non-positive or non-finite window', () => {
    // Matrix: misconfigured window — fail-fast at construction like FixedTimestep.
    expect(() => new SimRateSampler(0)).toThrow(RangeError);
    expect(() => new SimRateSampler(-1)).toThrow(RangeError);
    expect(() => new SimRateSampler(NaN)).toThrow(RangeError);
  });
});
