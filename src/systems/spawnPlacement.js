import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
} from '../config/constants.js';

// spawnPlacement — pure, Phaser-free safe-placement helpers (Story 2.6).
//
// Every enemy spawn re-uses one of these two helpers so the spawn-point
// ship-avoidance rule (keep the chosen point at least `safeRadius` from the
// ship) lives in ONE testable seam instead of being duplicated across five
// spawners. Both are pure functions of an injected rng plus scalars — no engine
// dependency, no shared state, so they unit-test directly.
//
// The re-roll is BOUNDED: each helper tries at most `maxAttempts` placements,
// re-rolling only while the candidate is within `safeRadius` of a *finite*
// avoid point, and returns the last candidate if every attempt is too close (a
// corner-boxed player can never hang the loop). When the avoid coordinates are
// undefined / non-finite (e.g. the SpawnDirector has no ship, or back-compat
// `spawn()` calls), the first roll is returned unchanged — identical rng draw
// order to the pre-2.6 placement, so existing placement tests still hold.

/**
 * True only when BOTH avoid coordinates are finite numbers. Undefined / null /
 * NaN → no avoidance (first roll accepted).
 * @private
 */
function hasAvoid(avoidX, avoidY) {
  return Number.isFinite(avoidX) && Number.isFinite(avoidY);
}

/**
 * Pick an arena-edge placement (the established edge spawn: one axis pinned just
 * inside the inset by `radius`, the free axis uniform along the edge), re-rolling
 * up to `maxAttempts` times to keep the point ≥ `safeRadius` from a finite avoid
 * point. Two rng draws per attempt: the edge (0=top,1=bottom,2=left,3=right) then
 * the position along it. `edge` is returned so the caller (e.g. the Snake) can
 * derive an inward heading from it.
 *
 * @param {() => number} rng RNG in [0,1).
 * @param {number} radius Half-extent of the spawning body (edge inset).
 * @param {number} [avoidX] Ship x to keep away from (non-finite → no avoidance).
 * @param {number} [avoidY] Ship y to keep away from (non-finite → no avoidance).
 * @param {number} safeRadius Minimum distance to keep from the avoid point.
 * @param {number} maxAttempts Bounded re-roll cap (≥ 1).
 * @returns {{edge:number, t:number, x:number, y:number}}
 */
export function pickSafeEdgePlacement(
  rng,
  radius,
  avoidX,
  avoidY,
  safeRadius,
  maxAttempts,
) {
  const minX = ARENA_BORDER_INSET + radius;
  const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - radius;
  const minY = ARENA_BORDER_INSET + radius;
  const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - radius;

  const avoid = hasAvoid(avoidX, avoidY);
  const safeSq = safeRadius * safeRadius;
  // Always make at least one attempt: a non-positive maxAttempts must still
  // return a valid on-edge candidate, never the zeroed {0,0} off-arena default.
  const attempts = Math.max(1, maxAttempts | 0);

  let edge = 0;
  let t = 0;
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    edge = Math.floor(rng() * 4); // 0=top,1=bottom,2=left,3=right
    t = rng();
    if (edge === 0) {
      x = minX + t * (maxX - minX);
      y = minY;
    } else if (edge === 1) {
      x = minX + t * (maxX - minX);
      y = maxY;
    } else if (edge === 2) {
      x = minX;
      y = minY + t * (maxY - minY);
    } else {
      x = maxX;
      y = minY + t * (maxY - minY);
    }

    if (!avoid) break; // no avoid point → first roll accepted
    const dx = x - avoidX;
    const dy = y - avoidY;
    if (dx * dx + dy * dy >= safeSq) break; // far enough → accept
    // else too close → re-roll (unless this was the last attempt).
  }
  return { edge, t, x, y };
}

/**
 * Pick a random INTERIOR placement (inset by `radius` so the body sits fully
 * inside the drawn border), re-rolling up to `maxAttempts` times to keep the
 * point ≥ `safeRadius` from a finite avoid point. Two rng draws per attempt
 * (x, then y). Used by the Black Hole self-spawn.
 *
 * @param {() => number} rng RNG in [0,1).
 * @param {number} radius Half-extent of the spawning body (interior inset).
 * @param {number} [avoidX] Ship x to keep away from (non-finite → no avoidance).
 * @param {number} [avoidY] Ship y to keep away from (non-finite → no avoidance).
 * @param {number} safeRadius Minimum distance to keep from the avoid point.
 * @param {number} maxAttempts Bounded re-roll cap (≥ 1).
 * @returns {{x:number, y:number}}
 */
export function pickSafeInteriorPlacement(
  rng,
  radius,
  avoidX,
  avoidY,
  safeRadius,
  maxAttempts,
) {
  const minX = ARENA_BORDER_INSET + radius;
  const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - radius;
  const minY = ARENA_BORDER_INSET + radius;
  const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - radius;

  const avoid = hasAvoid(avoidX, avoidY);
  const safeSq = safeRadius * safeRadius;
  // Always make at least one attempt: a non-positive maxAttempts must still
  // return a valid interior candidate, never the zeroed {0,0} off-arena default.
  const attempts = Math.max(1, maxAttempts | 0);

  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    x = minX + rng() * (maxX - minX);
    y = minY + rng() * (maxY - minY);

    if (!avoid) break; // no avoid point → first roll accepted
    const dx = x - avoidX;
    const dy = y - avoidY;
    if (dx * dx + dy * dy >= safeSq) break; // far enough → accept
    // else too close → re-roll (unless this was the last attempt).
  }
  return { x, y };
}
