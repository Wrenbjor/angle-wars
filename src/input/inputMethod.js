// inputMethod — pure, Phaser-free active-input-method seam.
//
// Decides which device (gamepad vs keyboard/mouse) is currently driving the
// ship from per-frame activity, so hot-swap between devices is explicit and
// unit-testable. The sampler holds no stateful device object: each frame it
// passes its previous method plus two "active this frame" booleans and acts on
// the returned method. Keeping the decision here (not in the Phaser boundary)
// makes it fully testable while the sampler stays a thin adapter.

/** The two input methods the sampler resolves between. */
export const INPUT_METHOD = Object.freeze({
  KBM: 'kbm',
  GAMEPAD: 'gamepad',
});

/**
 * Resolve the active input method for this frame.
 *
 * Sticky per-frame resolution (not a stateful device object):
 *  - gamepad active AND kbm NOT active → GAMEPAD (a pad took over)
 *  - kbm active AND gamepad NOT active → KBM (keyboard/mouse took over)
 *  - both active OR neither active     → keep `prev` (sticky)
 *
 * Sticky on contention (both) and on idle (neither) prevents flicker: resting
 * every input keeps the current device, and a single frame where both report
 * activity does not thrash the method back and forth.
 *
 * @param {string} prev The previous method (INPUT_METHOD.KBM / .GAMEPAD).
 * @param {{gamepadActive:boolean, kbmActive:boolean}} activity This frame's
 *   per-device activity flags.
 * @returns {string} The resolved method for this frame.
 */
export function resolveActiveMethod(prev, { gamepadActive, kbmActive }) {
  if (gamepadActive && !kbmActive) return INPUT_METHOD.GAMEPAD;
  if (kbmActive && !gamepadActive) return INPUT_METHOD.KBM;
  return prev;
}
