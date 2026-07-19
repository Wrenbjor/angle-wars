// inputMath — pure, Phaser-free input helpers.
//
// Kept isolated from any Phaser types so they can be unit-tested headlessly and
// reused by both the gamepad and keyboard paths.

/**
 * Apply a radial (circular) deadzone to a 2D stick vector.
 *
 * Below the deadzone the result is exactly (0, 0) so a resting stick produces
 * no drift. At or above it, the response is rescaled so it starts at 0 at the
 * deadzone edge and reaches 1 at the unit circle — no jump as the stick leaves
 * the deadzone. Direction is preserved.
 *
 * @param {number} x Raw stick X in [-1, 1].
 * @param {number} y Raw stick Y in [-1, 1].
 * @param {number} deadzone Deadzone radius in [0, 1).
 * @returns {{x:number, y:number}} Deadzoned, rescaled vector.
 */
export function applyRadialDeadzone(x, y, deadzone) {
  const mag = Math.hypot(x, y);
  // At or inside the deadzone (or a dead-center stick): no intent.
  if (mag <= deadzone || mag === 0) {
    return { x: 0, y: 0 };
  }
  // Rescale magnitude to start at 0 at the deadzone edge. Guard the
  // denominator so a degenerate deadzone of 1 cannot divide by zero.
  const denom = 1 - deadzone;
  const scaled = denom > 0 ? (mag - deadzone) / denom : 1;
  // Clamp: a stick reported slightly beyond the unit circle stays at 1.
  const clamped = scaled > 1 ? 1 : scaled;
  const s = clamped / mag;
  return { x: x * s, y: y * s };
}

/**
 * Clamp a 2D vector to the unit circle: scale down only when its magnitude
 * exceeds 1 (so a raw keyboard diagonal (1,1) is not √2× faster), and leave
 * shorter vectors untouched.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{x:number, y:number}} Vector with magnitude <= 1.
 */
export function clampToUnitCircle(x, y) {
  const mag = Math.hypot(x, y);
  if (mag > 1) {
    return { x: x / mag, y: y / mag };
  }
  return { x, y };
}

/**
 * Normalize a 2D vector to unit length, also returning its original magnitude.
 *
 * Aim is a pure direction: only the angle matters, not how far the stick is
 * pushed or how distant the cursor is. A zero-length input has no direction, so
 * it returns the zero vector with `mag === 0` — the caller treats that as
 * "no aim" (inactive).
 *
 * @param {number} x
 * @param {number} y
 * @returns {{x:number, y:number, mag:number}} Unit vector + original magnitude;
 *   `{x:0, y:0, mag:0}` when the input has zero length.
 */
export function normalizeToUnit(x, y) {
  const mag = Math.hypot(x, y);
  if (mag === 0) {
    return { x: 0, y: 0, mag: 0 };
  }
  return { x: x / mag, y: y / mag, mag };
}
