import { describe, it, expect } from 'vitest';
import {
  blackHolePulseColor,
  blackHolePulseAlpha,
} from './blackHoleRender.js';
import {
  COLOR_BLACK_HOLE,
  COLOR_BLACK_HOLE_UNSTABLE,
} from '../config/constants.js';

// blackHoleRender — pure instability render-cue math (Story 6.2). The visible red
// pulse is the disclosed manual boundary; these unit tests pin the underlying
// color-lerp + alpha-pulse formulas so an inverted or dead cue is caught headlessly.

// Extract the R/G/B channels of a packed 0xRRGGBB color.
function channels(c) {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

describe('blackHolePulseColor — instability color lerp', () => {
  it('returns exactly COLOR_BLACK_HOLE at instability 0 (resting purple)', () => {
    expect(blackHolePulseColor(0)).toBe(COLOR_BLACK_HOLE);
  });

  it('returns exactly COLOR_BLACK_HOLE_UNSTABLE at instability 1 (alarming red)', () => {
    expect(blackHolePulseColor(1)).toBe(COLOR_BLACK_HOLE_UNSTABLE);
  });

  it('interpolates each channel at the midpoint (between the two endpoints)', () => {
    const [r0, g0, b0] = channels(COLOR_BLACK_HOLE);
    const [r1, g1, b1] = channels(COLOR_BLACK_HOLE_UNSTABLE);
    const [rm, gm, bm] = channels(blackHolePulseColor(0.5));
    // Each midpoint channel lies strictly between its two endpoints (the endpoints
    // differ on every channel for these two placeholder colors).
    expect(rm).toBe(Math.round(r0 + (r1 - r0) * 0.5));
    expect(gm).toBe(Math.round(g0 + (g1 - g0) * 0.5));
    expect(bm).toBe(Math.round(b0 + (b1 - b0) * 0.5));
    // Sanity: the midpoint is genuinely between the endpoints on the red channel
    // (which rises purple→red), so the lerp is not inverted.
    expect(rm).toBeGreaterThan(r0);
    expect(rm).toBeLessThan(r1);
  });

  it('clamps out-of-range ratios to the endpoint colors', () => {
    expect(blackHolePulseColor(-1)).toBe(COLOR_BLACK_HOLE);
    expect(blackHolePulseColor(2)).toBe(COLOR_BLACK_HOLE_UNSTABLE);
  });
});

describe('blackHolePulseAlpha — instability alpha pulse', () => {
  it('is steady at the base alpha at instability 0, regardless of time', () => {
    expect(blackHolePulseAlpha(0, 0, 0.5)).toBe(0.5);
    expect(blackHolePulseAlpha(0, 12345, 0.5)).toBe(0.5);
    expect(blackHolePulseAlpha(0, 999999, 0.8)).toBe(0.8);
  });

  it('oscillates with time at instability 1 (the pulse is alive)', () => {
    // A base low enough that the ±depth swing never clamps, so the raw oscillation
    // is observable. sin(phase) is 0 at t=0, so alpha == base there…
    const base = 0.5;
    expect(blackHolePulseAlpha(1, 0, base)).toBeCloseTo(base, 9);
    // …and moves off base at a later time (a dead pulse would return base again).
    const later = blackHolePulseAlpha(1, 100, base);
    expect(later).not.toBeCloseTo(base, 6);
    // Two different times generally give two different alphas.
    const t1 = blackHolePulseAlpha(1, 100, base);
    const t2 = blackHolePulseAlpha(1, 200, base);
    expect(t1).not.toBeCloseTo(t2, 6);
  });

  it('holds a STEADY alpha at any instability when reduceMotion is true (WCAG 2.3.1)', () => {
    const base = 0.5;
    // Full instability + reduced motion → no oscillation: steady baseAlpha at every time.
    expect(blackHolePulseAlpha(1, 0, base, true)).toBe(base);
    expect(blackHolePulseAlpha(1, 100, base, true)).toBe(base);
    expect(blackHolePulseAlpha(1, 250, base, true)).toBe(base);
    // Without reduced motion the same inputs DO move off base (proving the gate matters).
    expect(blackHolePulseAlpha(1, 100, base, false)).not.toBeCloseTo(base, 6);
  });

  it('stays within [0,1] even when the swing would overshoot', () => {
    // A high base with the deep swing peaks above 1 → clamped, never > 1 or < 0.
    for (let t = 0; t <= 1000; t += 37) {
      const a = blackHolePulseAlpha(1, t, 0.95);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});
