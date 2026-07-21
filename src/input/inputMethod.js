// inputMethod — pure, Phaser-free active-input-method seam.
//
// Decides which device (gamepad vs keyboard/mouse vs touch) is currently driving
// the ship from per-frame activity, so hot-swap between devices is explicit and
// unit-testable. The sampler holds no stateful device object: each frame it
// passes its previous method plus the per-device "active this frame" booleans and
// acts on the returned method. Keeping the decision here (not in the Phaser
// boundary) makes it fully testable while the sampler stays a thin adapter.

/** The input methods the sampler resolves between. */
export const INPUT_METHOD = Object.freeze({
  KBM: 'kbm',
  GAMEPAD: 'gamepad',
  TOUCH: 'touch',
});

/**
 * Resolve the active input method for this frame.
 *
 * Sticky per-frame resolution generalized to all three devices (not a stateful
 * device object): count the devices reporting activity this frame, and
 *  - exactly ONE active → switch to that device (it took over)
 *  - zero OR more than one active → keep `prev` (sticky)
 *
 * Sticky on contention (2+) and on idle (0) prevents flicker: resting every input
 * keeps the current device, and a single frame where several report activity does
 * not thrash the method. For the two-device case this is byte-for-byte identical
 * to the old rule (both / neither → sticky), so an absent `touchActive` (undefined
 * → falsy → filtered out) preserves the prior keyboard/gamepad behavior exactly.
 *
 * @param {string} prev The previous method (INPUT_METHOD.KBM / .GAMEPAD / .TOUCH).
 * @param {{gamepadActive:boolean, kbmActive:boolean, touchActive?:boolean}}
 *   activity This frame's per-device activity flags.
 * @returns {string} The resolved method for this frame.
 */
export function resolveActiveMethod(prev, { gamepadActive, kbmActive, touchActive }) {
  const active = [
    touchActive && INPUT_METHOD.TOUCH,
    gamepadActive && INPUT_METHOD.GAMEPAD,
    kbmActive && INPUT_METHOD.KBM,
  ].filter(Boolean);
  return active.length === 1 ? active[0] : prev;
}
