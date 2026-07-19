import { describe, it, expect } from 'vitest';
import { FixedTimestep } from './FixedTimestep.js';

const STEP = 10; // ms — arbitrary constant step for the tests.
const MAX = 5;

describe('FixedTimestep', () => {
  it('runs fn exactly once for one step worth of delta', () => {
    // Matrix: Fixed step, one frame's worth.
    const ft = new FixedTimestep(STEP, MAX);
    const calls = [];
    const steps = ft.advance(STEP, (dt) => calls.push(dt));
    expect(steps).toBe(1);
    expect(calls).toEqual([STEP]);
    expect(ft.accumulator).toBeCloseTo(0, 10);
  });

  it('runs fn twice and retains the remainder on a slow frame', () => {
    // Matrix: slow frame (backlog) — 2.5 steps -> 2 runs, 0.5*step retained.
    const ft = new FixedTimestep(STEP, MAX);
    let count = 0;
    const steps = ft.advance(2.5 * STEP, () => count++);
    expect(steps).toBe(2);
    expect(count).toBe(2);
    expect(ft.accumulator).toBeCloseTo(0.5 * STEP, 10);
  });

  it('does not run fn on a sub-step frame and retains the partial delta', () => {
    // Matrix: fast frame (sub-step) — 0.4 step -> 0 runs, delta accumulates.
    const ft = new FixedTimestep(STEP, MAX);
    let count = 0;
    const steps = ft.advance(0.4 * STEP, () => count++);
    expect(steps).toBe(0);
    expect(count).toBe(0);
    expect(ft.accumulator).toBeCloseTo(0.4 * STEP, 10);
  });

  it('accumulates partial deltas across frames until a step fires', () => {
    // Two 0.4-step frames bank 0.8; a third 0.4 crosses 1.0 -> exactly 1 step.
    const ft = new FixedTimestep(STEP, MAX);
    let count = 0;
    const fn = () => count++;
    expect(ft.advance(0.4 * STEP, fn)).toBe(0);
    expect(ft.advance(0.4 * STEP, fn)).toBe(0);
    expect(ft.advance(0.4 * STEP, fn)).toBe(1);
    expect(count).toBe(1);
    expect(ft.accumulator).toBeCloseTo(0.2 * STEP, 10);
  });

  it('caps steps at maxSubSteps and drops the leftover backlog (spiral guard)', () => {
    // Matrix: spiral-of-death guard — a huge delta must not run unbounded and
    // must not retain backlog once the cap is hit.
    const ft = new FixedTimestep(STEP, MAX);
    let count = 0;
    const steps = ft.advance(100 * STEP, () => count++);
    expect(steps).toBe(MAX);
    expect(count).toBe(MAX);
    expect(ft.accumulator).toBe(0); // leftover backlog dropped, not accumulated
  });

  it('preserves a legitimate remainder when the cap is hit exactly', () => {
    // Cap hit with only a valid sub-step remainder (< stepMs) left over: the
    // remainder must survive rather than be discarded as backlog.
    const ft = new FixedTimestep(STEP, MAX);
    let count = 0;
    const steps = ft.advance((MAX + 0.4) * STEP, () => count++);
    expect(steps).toBe(MAX);
    expect(count).toBe(MAX);
    expect(ft.accumulator).toBeCloseTo(0.4 * STEP, 10);
  });

  it('throws when constructed with a non-positive stepMs', () => {
    expect(() => new FixedTimestep(0, MAX)).toThrow(RangeError);
    expect(() => new FixedTimestep(-1, MAX)).toThrow(RangeError);
    expect(() => new FixedTimestep(NaN, MAX)).toThrow(RangeError);
  });

  it('throws when constructed with maxSubSteps < 1 or non-integer', () => {
    expect(() => new FixedTimestep(STEP, 0)).toThrow(RangeError);
    expect(() => new FixedTimestep(STEP, 2.5)).toThrow(RangeError);
  });

  it('ignores a NaN or negative delta and still steps on a later valid delta', () => {
    const ft = new FixedTimestep(STEP, MAX);
    let count = 0;
    const fn = () => count++;

    // Bank a valid partial first so we can prove the accumulator is untouched.
    ft.advance(0.5 * STEP, fn);
    expect(ft.accumulator).toBeCloseTo(0.5 * STEP, 10);

    expect(ft.advance(NaN, fn)).toBe(0);
    expect(ft.advance(-5 * STEP, fn)).toBe(0);
    expect(count).toBe(0);
    expect(ft.accumulator).toBeCloseTo(0.5 * STEP, 10); // unchanged

    // A subsequent valid delta crosses the threshold and steps normally.
    expect(ft.advance(0.6 * STEP, fn)).toBe(1);
    expect(count).toBe(1);
    expect(ft.accumulator).toBeCloseTo(0.1 * STEP, 10);
  });

  it('reports alpha as the fractional progress toward the next step', () => {
    const ft = new FixedTimestep(STEP, MAX);
    ft.advance(0.4 * STEP, () => {});
    expect(ft.alpha).toBeCloseTo(0.4, 10);
  });

  it('reset() discards banked time', () => {
    const ft = new FixedTimestep(STEP, MAX);
    ft.advance(0.4 * STEP, () => {});
    ft.reset();
    expect(ft.accumulator).toBe(0);
  });
});
