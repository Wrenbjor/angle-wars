// gameFlow — the Phaser-free game-flow state machine seam (Story 5.3 / FR14).
//
// The whole codebase keeps decision logic in Phaser-free, node-testable modules and
// isolates Phaser/browser globals in the scenes. This module is the SOLE authority on
// the legal screen-transition graph — title → play → (death/respawn) → game over →
// restart | title, plus title ⇄ settings — expressed as a PURE transition TABLE, not
// a stateful object shared across scenes. Phaser scenes are independent and each
// already knows its own state (Title is TITLE, Settings is SETTINGS, Arena is
// PLAY/GAME_OVER); each scene passes its own state to nextFlowState(state, event) and
// acts on the null-or-target result. This keeps the flow model fully unit-testable —
// including the no-dead-ends property that directly encodes FR14 ("no dead ends;
// every terminal state offers restart AND return to title") — while the scenes stay
// thin adapters that only call scene.start(...) / scene.restart() on the result.
//
// Imports Phaser NOTHING.

/** The flow states. Each maps to a Phaser scene key via sceneForState(). */
export const FLOW_STATES = Object.freeze({
  TITLE: 'TITLE',
  PLAY: 'PLAY',
  GAME_OVER: 'GAME_OVER',
  SETTINGS: 'SETTINGS',
});

/** The flow events that drive transitions. */
export const FLOW_EVENTS = Object.freeze({
  START: 'START',
  OPEN_SETTINGS: 'OPEN_SETTINGS',
  CLOSE_SETTINGS: 'CLOSE_SETTINGS',
  PLAYER_DIED: 'PLAYER_DIED',
  RESTART: 'RESTART',
  RETURN_TO_TITLE: 'RETURN_TO_TITLE',
});

// The transition table: state → (event → next state). Any pair NOT listed here is an
// illegal transition and yields null (a guarded no-op at the call site). GAME_OVER is
// the terminal state and deliberately offers BOTH RESTART (→ PLAY) and RETURN_TO_TITLE
// (→ TITLE), so it is never a dead end. PLAY→GAME_OVER exists here for the
// completeness / no-dead-ends proof; at runtime the sim (PlayerDeathSystem latching
// gameOver) drives that transition, so no scene calls nextFlowState for it.
const TRANSITIONS = Object.freeze({
  [FLOW_STATES.TITLE]: Object.freeze({
    [FLOW_EVENTS.START]: FLOW_STATES.PLAY,
    [FLOW_EVENTS.OPEN_SETTINGS]: FLOW_STATES.SETTINGS,
  }),
  [FLOW_STATES.SETTINGS]: Object.freeze({
    [FLOW_EVENTS.CLOSE_SETTINGS]: FLOW_STATES.TITLE,
  }),
  [FLOW_STATES.PLAY]: Object.freeze({
    [FLOW_EVENTS.PLAYER_DIED]: FLOW_STATES.GAME_OVER,
  }),
  [FLOW_STATES.GAME_OVER]: Object.freeze({
    [FLOW_EVENTS.RESTART]: FLOW_STATES.PLAY,
    [FLOW_EVENTS.RETURN_TO_TITLE]: FLOW_STATES.TITLE,
  }),
});

// State → Phaser scene key. GAME_OVER is an in-ArenaScene overlay sub-state (not its
// own scene), so it shares ArenaScene's key with PLAY — the frozen final frame +
// final-score backdrop is preserved.
const SCENE_FOR_STATE = Object.freeze({
  [FLOW_STATES.TITLE]: 'TitleScene',
  [FLOW_STATES.PLAY]: 'ArenaScene',
  [FLOW_STATES.GAME_OVER]: 'ArenaScene',
  [FLOW_STATES.SETTINGS]: 'SettingsScene',
});

/**
 * The next flow state for a (state, event) pair, or null for any illegal/unknown pair.
 * @param {string} state A FLOW_STATES value (unknown → null).
 * @param {string} event A FLOW_EVENTS value (unknown → null).
 * @returns {string|null} The target FLOW_STATES value, or null (a guarded no-op).
 */
export function nextFlowState(state, event) {
  // Object.hasOwn gates BOTH lookups so a prototype-chain key ('toString',
  // 'constructor', '__proto__', …) never returns an inherited Object.prototype
  // member instead of null — the string|null contract holds for any input.
  if (!Object.hasOwn(TRANSITIONS, state)) return null;
  const row = TRANSITIONS[state];
  if (!Object.hasOwn(row, event)) return null;
  return row[event];
}

/**
 * The Phaser scene key that renders a given flow state.
 * @param {string} state A FLOW_STATES value.
 * @returns {string|null} The scene key (TITLE→'TitleScene', PLAY/GAME_OVER→
 *   'ArenaScene', SETTINGS→'SettingsScene'), or null for an unknown state.
 */
export function sceneForState(state) {
  // Object.hasOwn gate so a prototype-chain key ('toString', 'constructor', …) never
  // returns an inherited Object.prototype member instead of null.
  if (!Object.hasOwn(SCENE_FOR_STATE, state)) return null;
  return SCENE_FOR_STATE[state];
}
