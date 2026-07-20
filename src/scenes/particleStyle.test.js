import { describe, it, expect } from 'vitest';
import { particleAlpha } from './particleStyle.js';

const LIFE = 600; // a representative particle lifetime (ms)

describe('particleAlpha', () => {
  it('is 1 at age 0 (just emitted)', () => {
    expect(particleAlpha(0, LIFE)).toBe(1);
  });

  it('is 0 at age == life (fully faded)', () => {
    expect(particleAlpha(LIFE, LIFE)).toBe(0);
  });

  it('is 0.5 at the midpoint of the life', () => {
    expect(particleAlpha(LIFE / 2, LIFE)).toBeCloseTo(0.5, 9);
  });

  it('decreases monotonically across the life, staying in [0, 1]', () => {
    let prev = Infinity;
    for (let ms = 0; ms <= LIFE; ms += LIFE / 12) {
      const a = particleAlpha(ms, LIFE);
      expect(a).toBeLessThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
    expect(prev).toBe(0); // reached full fade at the end (age == life)
  });

  it('clamps to 0 for age beyond the life (tolerates age > life)', () => {
    expect(particleAlpha(LIFE * 2, LIFE)).toBe(0);
    expect(particleAlpha(LIFE + 1, LIFE)).toBeGreaterThanOrEqual(0);
  });

  it('is degenerate-safe (lifeMs <= 0 → 0, no divide-by-zero)', () => {
    expect(particleAlpha(0, 0)).toBe(0);
    expect(particleAlpha(10, -5)).toBe(0);
  });
});
