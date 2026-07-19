import { describe, it, expect } from 'vitest';
import {
  spawnTelegraphProgress,
  telegraphAlpha,
  telegraphScale,
} from './telegraphCue.js';

const FULL = 600; // a representative telegraph duration (ms)

describe('spawnTelegraphProgress', () => {
  it('p == 0 at the instant of spawn (telegraphMs == fullMs)', () => {
    expect(spawnTelegraphProgress(FULL, FULL)).toBe(0);
  });

  it('p == 1 for an active instance (telegraphMs <= 0)', () => {
    expect(spawnTelegraphProgress(0, FULL)).toBe(1);
    expect(spawnTelegraphProgress(-50, FULL)).toBe(1);
  });

  it('p == 0 (clamped to the floor) when telegraphMs > fullMs', () => {
    expect(spawnTelegraphProgress(FULL * 2, FULL)).toBe(0); // clamp keeps p at its floor
    // Explicit clamp check: a countdown above full never yields a negative p.
    expect(spawnTelegraphProgress(FULL + 1, FULL)).toBeGreaterThanOrEqual(0);
  });

  it('increases monotonically as the countdown drains across the window', () => {
    let prev = -Infinity;
    // telegraphMs draining full → 0 means progress rising 0 → 1.
    for (let ms = FULL; ms >= 0; ms -= FULL / 12) {
      const p = spawnTelegraphProgress(ms, FULL);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
    expect(prev).toBe(1); // reached full progress at the end (ms == 0)
  });

  it('midpoint of the window is p == 0.5', () => {
    expect(spawnTelegraphProgress(FULL / 2, FULL)).toBeCloseTo(0.5, 9);
  });

  it('is divide-by-zero safe (fullMs <= 0 → 1)', () => {
    expect(spawnTelegraphProgress(100, 0)).toBe(1);
    expect(spawnTelegraphProgress(100, -10)).toBe(1);
  });
});

describe('telegraphAlpha', () => {
  const MIN = 0.15;
  it('p == 0 → minAlpha (faintest at spawn)', () => {
    expect(telegraphAlpha(0, MIN)).toBe(MIN);
  });
  it('p == 1 → 1 (fully opaque when active)', () => {
    expect(telegraphAlpha(1, MIN)).toBe(1);
  });
  it('interpolates linearly at the midpoint', () => {
    expect(telegraphAlpha(0.5, MIN)).toBeCloseTo(MIN + (1 - MIN) * 0.5, 9);
  });
});

describe('telegraphScale', () => {
  const MIN = 0.4;
  it('p == 0 → minScale (smallest at spawn)', () => {
    expect(telegraphScale(0, MIN)).toBe(MIN);
  });
  it('p == 1 → 1 (full radius when active)', () => {
    expect(telegraphScale(1, MIN)).toBe(1);
  });
  it('interpolates linearly at the midpoint', () => {
    expect(telegraphScale(0.5, MIN)).toBeCloseTo(MIN + (1 - MIN) * 0.5, 9);
  });
});
