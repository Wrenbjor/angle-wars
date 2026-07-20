// titleScreen — Phaser-free content/format seam for the TitleScene (Story 5.1).
//
// The whole codebase keeps decision/format logic in Phaser-free, node-testable
// modules and isolates browser/Phaser globals in the scenes. This module holds
// the title screen's static text content and the one bit of formatting logic —
// turning a persisted high score into its display line — so both have automated
// coverage (titleScreen.test.js) and TitleScene stays a thin view layer that
// only wires these strings onto Phaser text objects.
//
// Imports Phaser NOTHING.

/** The neon hero title. */
export const TITLE_TEXT = 'ANGLE WARS';

/** The "press start" prompt inviting any start input. */
export const START_PROMPT = 'Press Enter / Space, click, or a gamepad button to start';

/**
 * The basic-controls lines, describing ONLY the controls that exist today
 * (Story 5.1 does not add pause, settings, or gamepad bomb — see the spec's
 * Never list). Move: WASD/arrows/left stick; Aim & Fire: mouse/right stick;
 * Smart Bomb: Shift (PlayerInputSampler binds KC.SHIFT); Mute: M; Volume: -/+.
 * @type {string[]}
 */
export const CONTROLS_LINES = [
  'Move:  WASD / Arrows / Left Stick',
  'Aim & Fire:  Mouse / Right Stick',
  'Smart Bomb:  Shift    Mute: M    Volume: - / +',
];

/**
 * Format a persisted high score into its title-screen display line.
 *
 * Defensive: the source is the guarded high-score port (which already yields a
 * non-negative integer or 0), but this seam coerces anyway so any value —
 * negative, NaN, fractional, undefined — renders as a clean, non-negative
 * integer rather than leaking a bad token onto the screen.
 * @param {number} highScore The persisted high score.
 * @returns {string} e.g. `'HIGH SCORE 12345'` (0 for any missing/invalid input).
 */
export function formatHighScore(highScore) {
  const raw = Number(highScore);
  // Gate on finiteness before flooring so Infinity / -Infinity / NaN all yield 0
  // (Math.floor(Infinity) is Infinity, which would otherwise leak onto the screen).
  const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  return `HIGH SCORE ${n}`;
}
