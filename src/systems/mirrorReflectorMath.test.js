import { describe, it, expect } from 'vitest';
import {
  reflectorEndpoints,
  closestPointOnSegment,
  reflectVelocity,
} from './mirrorReflectorMath.js';

// Pure-math coverage for the Mirror Reflector geometry helpers (Story 6.3). These
// are the genuinely-new collision math; the system + renderer both build on them, so
// exact coverage here lets the system tests assert behavior and the render pass rely
// on the same endpoints the collision tests use.

describe('reflectorEndpoints — the two weight endpoints of the spinning bar', () => {
  it('angle 0 → endpoints along ±x from the center', () => {
    const e = reflectorEndpoints(100, 50, 0, 10);
    expect(e.ax).toBeCloseTo(110, 9);
    expect(e.ay).toBeCloseTo(50, 9);
    expect(e.bx).toBeCloseTo(90, 9);
    expect(e.by).toBeCloseTo(50, 9);
  });

  it('angle π/2 → endpoints along ±y from the center', () => {
    const e = reflectorEndpoints(100, 50, Math.PI / 2, 10);
    expect(e.ax).toBeCloseTo(100, 9);
    expect(e.ay).toBeCloseTo(60, 9);
    expect(e.bx).toBeCloseTo(100, 9);
    expect(e.by).toBeCloseTo(40, 9);
  });

  it('arbitrary angle → endpoints at ±halfLen along (cos,sin)·angle, symmetric about the center', () => {
    const cx = 12;
    const cy = -7;
    const angle = 0.7;
    const L = 15;
    const e = reflectorEndpoints(cx, cy, angle, L);
    expect(e.ax).toBeCloseTo(cx + Math.cos(angle) * L, 9);
    expect(e.ay).toBeCloseTo(cy + Math.sin(angle) * L, 9);
    expect(e.bx).toBeCloseTo(cx - Math.cos(angle) * L, 9);
    expect(e.by).toBeCloseTo(cy - Math.sin(angle) * L, 9);
    // The center is exactly the midpoint of the two endpoints.
    expect((e.ax + e.bx) / 2).toBeCloseTo(cx, 9);
    expect((e.ay + e.by) / 2).toBeCloseTo(cy, 9);
  });
});

describe('closestPointOnSegment — projection clamped to the segment', () => {
  it('interior projection returns the foot of the perpendicular', () => {
    const c = closestPointOnSegment(5, 5, 0, 0, 10, 0);
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });

  it('clamps to endpoint A when the projection falls before the segment', () => {
    const c = closestPointOnSegment(-5, 5, 0, 0, 10, 0);
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });

  it('clamps to endpoint B when the projection falls past the segment', () => {
    const c = closestPointOnSegment(15, 5, 0, 0, 10, 0);
    expect(c.x).toBeCloseTo(10, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });

  it('a degenerate zero-length segment returns endpoint A (no divide-by-zero)', () => {
    const c = closestPointOnSegment(0, 0, 3, 4, 3, 4);
    expect(c.x).toBe(3);
    expect(c.y).toBe(4);
  });

  it('writes into and returns the provided out object (zero-alloc hot path)', () => {
    const out = { x: 0, y: 0 };
    const c = closestPointOnSegment(5, 5, 0, 0, 10, 0, out);
    expect(c).toBe(out); // same instance — no allocation
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });
});

describe('reflectVelocity — mirror across a unit normal, magnitude preserved', () => {
  it('reflects across an axis normal (0,1): flips the normal component only', () => {
    const r = reflectVelocity(3, -4, 0, 1);
    expect(r.vx).toBeCloseTo(3, 9); // tangential component unchanged
    expect(r.vy).toBeCloseTo(4, 9); // normal component flipped
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(5, 9);
  });

  it('reflects across an arbitrary unit normal', () => {
    const inv = 1 / Math.SQRT2;
    const r = reflectVelocity(1, 0, inv, inv);
    expect(r.vx).toBeCloseTo(0, 9);
    expect(r.vy).toBeCloseTo(-1, 9);
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(1, 9);
  });

  it('preserves magnitude for a general velocity + normal', () => {
    const inv = 1 / Math.SQRT2;
    const vx = 7;
    const vy = -2;
    const r = reflectVelocity(vx, vy, inv, inv);
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(Math.hypot(vx, vy), 9);
  });

  it('leaves a velocity tangential to the bar (v·n == 0) unchanged', () => {
    // n=(0,1); a purely-horizontal velocity is tangential → no change.
    const r = reflectVelocity(9, 0, 0, 1);
    expect(r.vx).toBeCloseTo(9, 9);
    expect(r.vy).toBeCloseTo(0, 9);
  });

  it('writes into and returns the provided out object (zero-alloc hot path), matching the allocating form', () => {
    const inv = 1 / Math.SQRT2;
    const out = { vx: 0, vy: 0 };
    const r = reflectVelocity(7, -2, inv, inv, out);
    expect(r).toBe(out); // same instance — no allocation
    // Result equals the allocating (no-out) form.
    const alloc = reflectVelocity(7, -2, inv, inv);
    expect(out.vx).toBeCloseTo(alloc.vx, 12);
    expect(out.vy).toBeCloseTo(alloc.vy, 12);
  });
});
