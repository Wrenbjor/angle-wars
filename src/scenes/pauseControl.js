// pauseControl — Phaser-free decision/content seam for ArenaScene's pause (Story 5.2).
//
// The whole codebase keeps decision/format logic in Phaser-free, node-testable
// modules and isolates browser/Phaser globals in the scenes. This module holds
// the pause overlay's static text content and the one bit of decision logic —
// toggling the paused flag while respecting the game-over freeze — so both have
// automated coverage (pauseControl.test.js) and ArenaScene stays a thin view
// layer that only wires this decision and these strings onto Phaser objects.
//
// Imports Phaser NOTHING.

/** The pause overlay's centered title. */
export const PAUSE_TITLE = 'PAUSED';

/** The resume prompt naming the keys that unpause. */
export const PAUSE_PROMPT = 'Press Esc or P to resume';

/**
 * Decide the next paused state when the pause key is pressed.
 *
 * Game-over owns its own freeze + restart flow, so it takes priority: while
 * game over the run can never be paused, and any lingering paused flag is
 * forced back to unpaused (defensive — game over should never leave a run
 * stuck under the pause overlay). Otherwise the key simply toggles pause.
 * @param {boolean} paused   The current paused state.
 * @param {boolean} gameOver Whether the run is already game over.
 * @returns {boolean} The next paused state.
 */
export function togglePause(paused, gameOver) {
  return gameOver ? false : !paused;
}
