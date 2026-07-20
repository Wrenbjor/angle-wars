// inputMath — pure, Phaser-free input helpers.
//
// Kept isolated from any Phaser types so they can be unit-tested headlessly and
// reused by both the gamepad and keyboard paths.

import { GAMEPAD_BOMB_BUTTONS } from '../config/constants.js';

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

/**
 * The W3C Gamepad "standard" mapping id. Phaser surfaces the browser's
 * `Gamepad.mapping` string on each pad; when it equals this, `button.index`
 * carries the canonical layout (LB=4, RB=5, …) our bomb constants assume.
 */
export const GAMEPAD_STANDARD_MAPPING = 'standard';

/**
 * Whether a pad reports the canonical W3C "standard" mapping.
 *
 * A pad with an empty / unidentified / non-'standard' `mapping` is one the
 * browser could not fit to the standard layout, so its raw `button.index`
 * values are not guaranteed to match the standard button positions.
 *
 * @param {string} [mapping] The pad's `Gamepad.mapping` string.
 * @returns {boolean} True only for the exact 'standard' mapping.
 */
export function isStandardMapping(mapping) {
  return mapping === GAMEPAD_STANDARD_MAPPING;
}

/**
 * Whether a gamepad button index maps to the smart-bomb action (either bumper).
 *
 * Pure lookup against the configured GAMEPAD_BOMB_BUTTONS so the sampler's
 * edge-triggered gamepad listener carries no inline button numbers. A
 * non-numeric / undefined index (a button with no index) is not a bomb button.
 *
 * Mapping-aware but single-seam by design: on the 'standard' mapping the
 * canonical bumper indices `[4,5]` are authoritative. On a non-standard /
 * unidentified mapping there is no reliable programmatic remap for an unknown
 * pad (a per-controller database is explicitly out of scope), so we fall back
 * to the SAME indices as a documented best-effort — refusing to bind would
 * leave the bomb unreachable for that player, which is strictly worse than a
 * possible misbind. `mappingWarning` surfaces the non-standard pad so the risk
 * is discoverable rather than silent. This is the one place a future per-pad
 * remap table would diverge the two branches.
 *
 * @param {number} index The pressed gamepad button's index.
 * @param {string} [mapping] The pad's `Gamepad.mapping` string. A missing /
 *   undefined mapping is classified as NON-standard (the best-effort branch),
 *   identical to how `isStandardMapping` / `mappingWarning` treat it — so the
 *   three seams never disagree on the same input.
 * @returns {boolean} True only for the configured bumper indices.
 */
export function isBombButton(index, mapping) {
  if (isStandardMapping(mapping)) {
    return GAMEPAD_BOMB_BUTTONS.includes(index);
  }
  // Non-standard / unidentified pad: best-effort fall back to the same bumper
  // indices (see the doc note above) rather than leaving the bomb unbindable.
  return GAMEPAD_BOMB_BUTTONS.includes(index);
}

/**
 * A one-line diagnostic for a pad whose mapping is not the canonical W3C
 * 'standard', or `null` for a standard pad.
 *
 * Surfaces the non-standard pad so a possible bomb-button misbind (see
 * `isBombButton`'s best-effort fallback) is discoverable rather than silent.
 * The sampler emits this at most once per instance via `console.warn`.
 *
 * @param {string} [mapping] The pad's `Gamepad.mapping` string.
 * @returns {string|null} A diagnostic message for a non-standard mapping, else null.
 */
export function mappingWarning(mapping) {
  if (isStandardMapping(mapping)) {
    return null;
  }
  const reported = mapping ? `"${mapping}"` : '(empty)';
  return (
    `Gamepad reports a non-standard mapping ${reported}; button positions ` +
    `may not match the standard layout, so the smart-bomb bumpers ` +
    `(${GAMEPAD_BOMB_BUTTONS.join(', ')}) are a best-effort binding.`
  );
}
