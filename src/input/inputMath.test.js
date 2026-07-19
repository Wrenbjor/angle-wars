import { describe, it, expect } from 'vitest';
import {
  applyRadialDeadzone,
  clampToUnitCircle,
  normalizeToUnit,
} from './inputMath.js';
import { InputState } from './InputState.js';

const DZ = 0.25;

describe('applyRadialDeadzone', () => {
  it('returns (0,0) for a dead-center stick', () => {
    expect(applyRadialDeadzone(0, 0, DZ)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0,0) inside the deadzone and at its exact edge', () => {
    expect(applyRadialDeadzone(0.1, 0.1, DZ)).toEqual({ x: 0, y: 0 }); // mag ≈0.14
    expect(applyRadialDeadzone(DZ, 0, DZ)).toEqual({ x: 0, y: 0 }); // at edge
  });

  it('rescales so response starts at 0 at the deadzone edge (no jump)', () => {
    // Just past the edge → near-zero magnitude, not a jump to ~0.25.
    const justPast = applyRadialDeadzone(DZ + 1e-6, 0, DZ);
    expect(justPast.x).toBeGreaterThan(0);
    expect(justPast.x).toBeLessThan(1e-5);

    // Halfway (0.5 on a 0.25 deadzone) → (0.5-0.25)/(1-0.25) = 1/3.
    const mid = applyRadialDeadzone(0.5, 0, DZ);
    expect(mid.x).toBeCloseTo(1 / 3, 6);
    expect(mid.y).toBe(0);
  });

  it('reaches magnitude 1 at the unit circle and preserves direction', () => {
    const full = applyRadialDeadzone(1, 0, DZ);
    expect(full.x).toBeCloseTo(1, 6);
    expect(full.y).toBeCloseTo(0, 6);

    // A diagonal on the unit circle keeps its direction, magnitude → 1.
    const diag = applyRadialDeadzone(0.6, 0.8, DZ);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 6);
    expect(diag.y / diag.x).toBeCloseTo(0.8 / 0.6, 6);
  });

  it('clamps a stick reported beyond the unit circle to magnitude 1', () => {
    const over = applyRadialDeadzone(1, 1, DZ); // raw mag ≈1.41
    expect(Math.hypot(over.x, over.y)).toBeCloseTo(1, 6);
  });
});

describe('clampToUnitCircle', () => {
  it('scales down a vector whose magnitude exceeds 1', () => {
    expect(clampToUnitCircle(1, 1)).toEqual({
      x: 1 / Math.SQRT2,
      y: 1 / Math.SQRT2,
    });
    const r = clampToUnitCircle(3, 4); // mag 5 → (0.6, 0.8)
    expect(r.x).toBeCloseTo(0.6, 9);
    expect(r.y).toBeCloseTo(0.8, 9);
  });

  it('leaves a vector at or within the unit circle untouched', () => {
    expect(clampToUnitCircle(0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(clampToUnitCircle(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('normalizeToUnit', () => {
  it('returns the zero vector with mag 0 for a zero-length input', () => {
    expect(normalizeToUnit(0, 0)).toEqual({ x: 0, y: 0, mag: 0 });
  });

  it('normalizes to unit length and reports the original magnitude', () => {
    const r = normalizeToUnit(3, 4); // mag 5 → (0.6, 0.8)
    expect(r.x).toBeCloseTo(0.6, 9);
    expect(r.y).toBeCloseTo(0.8, 9);
    expect(r.mag).toBeCloseTo(5, 9);
  });

  it('preserves direction while scaling to magnitude 1', () => {
    const r = normalizeToUnit(-100, 0);
    expect(r.x).toBeCloseTo(-1, 9);
    expect(r.y).toBe(0);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(1, 9);
  });

  it('leaves an already-unit vector at magnitude 1', () => {
    const r = normalizeToUnit(0, 1);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(1, 9);
    expect(r.mag).toBeCloseTo(1, 9);
  });
});

describe('InputState.setAim / clearAim', () => {
  it('normalizes a non-zero aim to a unit direction and marks it active', () => {
    const s = new InputState();
    s.setAim(0, 10);
    expect(s.aimActive).toBe(true);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBeCloseTo(1, 9);
    expect(Math.hypot(s.aimX, s.aimY)).toBeCloseTo(1, 9);
  });

  it('treats a zero-magnitude aim as inactive (no stale direction)', () => {
    const s = new InputState();
    s.setAim(3, 4); // active first
    s.setAim(0, 0);
    expect(s.aimActive).toBe(false);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBe(0);
  });

  it('clearAim() resets the aim channel to inactive', () => {
    const s = new InputState();
    s.setAim(1, 0);
    s.clearAim();
    expect(s.aimActive).toBe(false);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBe(0);
  });

  it('clear() also clears the aim channel', () => {
    const s = new InputState();
    s.setMove(1, 0);
    s.setAim(0, 1);
    s.clear();
    expect(s.moveX).toBe(0);
    expect(s.moveY).toBe(0);
    expect(s.aimActive).toBe(false);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBe(0);
  });
});

describe('InputState.setMove', () => {
  it('normalizes a raw keyboard diagonal to the unit circle (not faster)', () => {
    const s = new InputState();
    s.setMove(1, 1);
    expect(Math.hypot(s.moveX, s.moveY)).toBeCloseTo(1, 9);
    expect(s.moveX).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(s.moveY).toBeCloseTo(1 / Math.SQRT2, 9);
  });

  it('stores a sub-unit intent unchanged', () => {
    const s = new InputState();
    s.setMove(0.3, 0.4);
    expect(s.moveX).toBeCloseTo(0.3, 9);
    expect(s.moveY).toBeCloseTo(0.4, 9);
  });

  it('clear() resets intent to rest', () => {
    const s = new InputState();
    s.setMove(1, 0);
    s.clear();
    expect(s.moveX).toBe(0);
    expect(s.moveY).toBe(0);
  });
});
