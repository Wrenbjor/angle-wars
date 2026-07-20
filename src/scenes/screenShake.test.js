import { describe, it, expect } from 'vitest';
import {
  shakeOffsetX,
  shakeOffsetY,
  flashAlpha,
  decayTrauma,
} from './screenShake.js';
import {
  SCREEN_SHAKE_MAX_OFFSET,
  SCREEN_SHAKE_TRAUMA_DECAY_PER_SEC,
} from '../config/constants.js';

// A phase where both axis sines are clearly positive (chosen so scale/monotonic
// assertions do not straddle a zero-crossing). See the frequency constants.
const POS_PHASE = 30;

describe('shakeOffsetX / shakeOffsetY', () => {
  it('is exactly 0 at trauma 0 (camera returns to center, no drift)', () => {
    for (const phase of [0, 10, 30, 123, 999]) {
      // Math.abs normalizes the signed zero (-0 from `mag*sin(negative)`), which is
      // numerically 0 and applies as a zero camera offset either way.
      expect(Math.abs(shakeOffsetX(0, phase))).toBe(0);
      expect(Math.abs(shakeOffsetY(0, phase))).toBe(0);
    }
  });

  it('stays within +/- SCREEN_SHAKE_MAX_OFFSET for any trauma (incl. > 1) and phase', () => {
    for (const trauma of [0, 0.25, 0.5, 1, 2, 5]) {
      for (let phase = 0; phase <= 1000; phase += 7) {
        expect(Math.abs(shakeOffsetX(trauma, phase))).toBeLessThanOrEqual(
          SCREEN_SHAKE_MAX_OFFSET + 1e-9,
        );
        expect(Math.abs(shakeOffsetY(trauma, phase))).toBeLessThanOrEqual(
          SCREEN_SHAKE_MAX_OFFSET + 1e-9,
        );
      }
    }
  });

  it('scales up with trauma at a fixed phase', () => {
    // At a phase with a positive sine, a larger trauma yields a larger offset.
    const small = shakeOffsetX(0.5, POS_PHASE);
    const large = shakeOffsetX(1, POS_PHASE);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
    // Y axis scales too.
    expect(shakeOffsetY(1, POS_PHASE)).toBeGreaterThan(shakeOffsetY(0.5, POS_PHASE));
  });

  it('varies with the phase at a fixed trauma (it oscillates)', () => {
    expect(shakeOffsetX(1, 10)).not.toBe(shakeOffsetX(1, 50));
    expect(shakeOffsetY(1, 10)).not.toBe(shakeOffsetY(1, 50));
  });

  it('decorrelates the two axes (different frequencies)', () => {
    // At the same trauma+phase the two axes generally differ (own frequency each).
    expect(shakeOffsetX(1, 137)).not.toBe(shakeOffsetY(1, 137));
  });
});

describe('flashAlpha', () => {
  const DUR = 120;

  it('is 1 when the countdown is full (just fired)', () => {
    expect(flashAlpha(DUR, DUR)).toBe(1);
  });

  it('is 0 when the countdown has elapsed', () => {
    expect(flashAlpha(0, DUR)).toBe(0);
  });

  it('clamps to 1 when flashMs exceeds the duration', () => {
    expect(flashAlpha(DUR * 2, DUR)).toBe(1);
  });

  it('is degenerate-safe for a non-positive duration (→ 0, no divide-by-zero)', () => {
    expect(flashAlpha(50, 0)).toBe(0);
    expect(flashAlpha(50, -10)).toBe(0);
  });

  it('decreases monotonically as the countdown drains, staying in [0, 1]', () => {
    let prev = -Infinity;
    // Iterate from elapsed (0) up to full (DUR): alpha rises with flashMs, so
    // scanning increasing flashMs must be non-decreasing (the fade is the reverse).
    for (let ms = 0; ms <= DUR; ms += DUR / 12) {
      const a = flashAlpha(ms, DUR);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
    expect(prev).toBe(1); // reaches full at flashMs == DUR
  });
});

describe('decayTrauma', () => {
  it('subtracts DECAY_PER_SEC * dt/1000 from the trauma', () => {
    const dtMs = 100;
    const expected = 1 - SCREEN_SHAKE_TRAUMA_DECAY_PER_SEC * (dtMs / 1000);
    expect(decayTrauma(1, dtMs)).toBeCloseTo(expected, 9);
  });

  it('clamps at 0 (never negative) when the step over-decays', () => {
    expect(decayTrauma(0.1, 10000)).toBe(0);
    expect(decayTrauma(0, 16)).toBe(0);
  });

  it('is monotonic non-increasing over successive steps toward 0', () => {
    let t = 1;
    let prev = Infinity;
    for (let i = 0; i < 200; i++) {
      t = decayTrauma(t, 16);
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(0);
      prev = t;
    }
    expect(t).toBe(0);
  });
});
