import { describe, it, expect } from 'vitest';
import {
  pickSafeEdgePlacement,
  pickSafeInteriorPlacement,
} from './spawnPlacement.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SEEKER_RADIUS,
  BLACKHOLE_RADIUS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
} from '../config/constants.js';

// Deterministic rng cycling a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// A counting rng wrapper so tests can assert the BOUNDED draw count.
function countingRng(values) {
  let i = 0;
  const fn = () => {
    fn.calls++;
    return values[i++ % values.length];
  };
  fn.calls = 0;
  return fn;
}

const R = SEEKER_RADIUS;
const MIN_X = ARENA_BORDER_INSET + R;
const MAX_X = ARENA_WIDTH - ARENA_BORDER_INSET - R;
const MIN_Y = ARENA_BORDER_INSET + R;
const MAX_Y = ARENA_HEIGHT - ARENA_BORDER_INSET - R;

function distSq(x, y, ax, ay) {
  const dx = x - ax;
  const dy = y - ay;
  return dx * dx + dy * dy;
}

describe('pickSafeEdgePlacement — no avoid (back-compat first roll)', () => {
  it('returns the first roll unchanged when avoid is undefined', () => {
    // edge=0 (top), t=0.5 → top-center. No avoid args → first roll accepted.
    const rng = countingRng([0.0, 0.5]);
    const p = pickSafeEdgePlacement(rng, R, undefined, undefined, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    expect(p.edge).toBe(0);
    expect(p.y).toBe(MIN_Y);
    expect(p.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
    // Exactly one edge draw + one position draw — no re-roll.
    expect(rng.calls).toBe(2);
  });

  it('returns the first roll when avoid is non-finite (NaN)', () => {
    const rng = countingRng([0.25, 0.5]);
    const p = pickSafeEdgePlacement(rng, R, NaN, NaN, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    expect(p.edge).toBe(1); // bottom
    expect(p.y).toBe(MAX_Y);
    expect(rng.calls).toBe(2);
  });
});

describe('pickSafeEdgePlacement — ship avoidance (bounded re-roll)', () => {
  it('accepts the first roll when it is already ≥ safeRadius from the ship', () => {
    // Ship at bottom-center; first roll is top-center → already far → no re-roll.
    const shipX = MIN_X + 0.5 * (MAX_X - MIN_X);
    const shipY = MAX_Y;
    const rng = countingRng([0.0, 0.5]); // top-center
    const p = pickSafeEdgePlacement(rng, R, shipX, shipY, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    expect(p.edge).toBe(0);
    expect(distSq(p.x, p.y, shipX, shipY)).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
    expect(rng.calls).toBe(2); // no re-roll
  });

  it('re-rolls away from a ship sitting on the first candidate, landing ≥ safeRadius', () => {
    // Ship at top-center. First roll = top-center (on the ship → too close) →
    // re-roll to bottom-center (far). Second roll accepted.
    const shipX = MIN_X + 0.5 * (MAX_X - MIN_X);
    const shipY = MIN_Y;
    const rng = countingRng([0.0, 0.5, /* re-roll → */ 0.25, 0.5]);
    const p = pickSafeEdgePlacement(rng, R, shipX, shipY, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    // Landed on the bottom edge, far from the ship.
    expect(p.edge).toBe(1);
    expect(p.y).toBe(MAX_Y);
    expect(distSq(p.x, p.y, shipX, shipY)).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
    // One rejected attempt (2 draws) + one accepted attempt (2 draws).
    expect(rng.calls).toBe(4);
  });

  it('boxed-in: every candidate too close → returns the LAST candidate after maxAttempts, bounded', () => {
    // safeRadius larger than the whole arena diagonal → no edge point is ever far
    // enough, so every attempt is rejected and the last candidate is returned.
    const huge = ARENA_WIDTH + ARENA_HEIGHT; // certainly larger than any distance
    const shipX = MIN_X + 0.5 * (MAX_X - MIN_X);
    const shipY = MIN_Y + 0.5 * (MAX_Y - MIN_Y);
    const rng = countingRng([0.0, 0.5]); // always top-center
    const p = pickSafeEdgePlacement(rng, R, shipX, shipY, huge, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    // Never hangs — returns the (last) candidate, still a valid on-edge point.
    expect(p.edge).toBe(0);
    expect(p.y).toBe(MIN_Y);
    // Exactly maxAttempts attempts, 2 draws each — bounded, no infinite loop.
    expect(rng.calls).toBe(2 * SPAWN_PLACEMENT_MAX_ATTEMPTS);
  });

  it('a non-positive maxAttempts still makes ONE attempt and returns a valid on-edge point', () => {
    for (const bad of [0, -3]) {
      const rng = countingRng([0.0, 0.5]); // top-center
      const p = pickSafeEdgePlacement(rng, R, 640, MIN_Y, SPAWN_SAFE_RADIUS, bad);
      // A real on-edge candidate — NOT the zeroed {0,0} off-arena default.
      expect(p.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
      expect(p.y).toBe(MIN_Y);
      expect(rng.calls).toBe(2); // exactly one attempt
    }
  });
});

describe('pickSafeInteriorPlacement — no avoid + ship avoidance', () => {
  const IMIN_X = ARENA_BORDER_INSET + BLACKHOLE_RADIUS;
  const IMAX_X = ARENA_WIDTH - ARENA_BORDER_INSET - BLACKHOLE_RADIUS;
  const IMIN_Y = ARENA_BORDER_INSET + BLACKHOLE_RADIUS;
  const IMAX_Y = ARENA_HEIGHT - ARENA_BORDER_INSET - BLACKHOLE_RADIUS;

  it('returns the first interior roll unchanged when avoid is undefined', () => {
    const rng = countingRng([0.5, 0.5]);
    const p = pickSafeInteriorPlacement(rng, BLACKHOLE_RADIUS, undefined, undefined, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    expect(p.x).toBeCloseTo(IMIN_X + 0.5 * (IMAX_X - IMIN_X), 6);
    expect(p.y).toBeCloseTo(IMIN_Y + 0.5 * (IMAX_Y - IMIN_Y), 6);
    expect(rng.calls).toBe(2);
  });

  it('re-rolls away from a ship on the first candidate, landing ≥ safeRadius', () => {
    // Ship at arena center; first roll = center (too close) → re-roll to a corner.
    const shipX = IMIN_X + 0.5 * (IMAX_X - IMIN_X);
    const shipY = IMIN_Y + 0.5 * (IMAX_Y - IMIN_Y);
    const rng = countingRng([0.5, 0.5, /* re-roll → */ 0.0, 0.0]);
    const p = pickSafeInteriorPlacement(rng, BLACKHOLE_RADIUS, shipX, shipY, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    expect(p.x).toBeCloseTo(IMIN_X, 6); // top-left corner
    expect(p.y).toBeCloseTo(IMIN_Y, 6);
    expect(distSq(p.x, p.y, shipX, shipY)).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
    expect(rng.calls).toBe(4);
  });

  it('boxed-in interior: returns the last candidate after maxAttempts, bounded', () => {
    const huge = ARENA_WIDTH + ARENA_HEIGHT;
    const shipX = IMIN_X + 0.5 * (IMAX_X - IMIN_X);
    const shipY = IMIN_Y + 0.5 * (IMAX_Y - IMIN_Y);
    const rng = countingRng([0.5, 0.5]);
    const p = pickSafeInteriorPlacement(rng, BLACKHOLE_RADIUS, shipX, shipY, huge, SPAWN_PLACEMENT_MAX_ATTEMPTS);
    // Still a valid interior point (the last candidate), never an infinite loop.
    expect(p.x).toBeGreaterThanOrEqual(IMIN_X);
    expect(p.x).toBeLessThanOrEqual(IMAX_X);
    expect(p.y).toBeGreaterThanOrEqual(IMIN_Y);
    expect(p.y).toBeLessThanOrEqual(IMAX_Y);
    expect(rng.calls).toBe(2 * SPAWN_PLACEMENT_MAX_ATTEMPTS);
  });

  it('a non-positive maxAttempts still makes ONE attempt and returns a valid interior point', () => {
    for (const bad of [0, -3]) {
      const rng = countingRng([0.5, 0.5]);
      const p = pickSafeInteriorPlacement(rng, BLACKHOLE_RADIUS, IMIN_X + 0.5 * (IMAX_X - IMIN_X), IMIN_Y + 0.5 * (IMAX_Y - IMIN_Y), SPAWN_SAFE_RADIUS, bad);
      // A real interior candidate — NOT the zeroed {0,0} off-arena default.
      expect(p.x).toBeCloseTo(IMIN_X + 0.5 * (IMAX_X - IMIN_X), 6);
      expect(p.y).toBeCloseTo(IMIN_Y + 0.5 * (IMAX_Y - IMIN_Y), 6);
      expect(rng.calls).toBe(2); // exactly one attempt
    }
  });
});
