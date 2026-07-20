// settingsMenu — Phaser-free content/format seam for the SettingsScene (Story 5.3).
//
// Mirrors titleScreen.js: the codebase keeps static text content and the small bits
// of display formatting in Phaser-free, node-testable modules so both have automated
// coverage (settingsMenu.test.js) and SettingsScene stays a thin view layer that only
// wires these strings onto Phaser text objects. Imports Phaser NOTHING.

/** The neon hero title of the settings screen. */
export const SETTINGS_TITLE = 'SETTINGS';

/** The key-hint line naming every settings control. */
export const SETTINGS_HINT =
  'Volume: - / +    Mute: M    Fullscreen: F    Reduced Motion: R    Back: Esc / Enter';

/**
 * Format a master volume (0..1) into its settings-screen display line as a whole
 * percent. Defensive: coerces NaN / negative / out-of-range / non-number to a clean
 * 0–100% so a bad value renders as a valid line rather than leaking `NaN%` onscreen.
 * @param {number} volume Master volume, expected in [0,1].
 * @returns {string} e.g. `'VOLUME  60%'` (0% for any missing/invalid input).
 */
export function formatVolume(volume) {
  const raw = Number(volume);
  // Gate on finiteness first so NaN / Infinity / -Infinity map to 0, then clamp the
  // finite value into [0,1] before scaling to a whole percent.
  const clamped = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const pct = Math.round(clamped * 100);
  return `VOLUME  ${pct}%`;
}

/**
 * Format a labelled boolean toggle into its `ON` / `OFF` display line.
 * @param {string} label The setting label (e.g. `'MUTE'`, `'FULLSCREEN'`).
 * @param {boolean} on Whether the toggle is on.
 * @returns {string} e.g. `'MUTE  ON'` / `'FULLSCREEN  OFF'`.
 */
export function formatToggle(label, on) {
  return `${label}  ${on ? 'ON' : 'OFF'}`;
}
