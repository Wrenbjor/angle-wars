import { SCORE_MULTIPLIER_START } from '../config/constants.js';

// ScoreState — the shared run-economy state (plain data, Phaser-free).
//
// Mirrors PlayerState: a plain-data object the ScoringSystem mutates each fixed
// tick and the scene reads for the HUD and game-over screen. Kept separate from
// PlayerState because score is a distinct concern (run economy) from the ship's
// lives/invulnerability/game-over lifecycle. A fresh run rebuilds it from zero.
//
// Shape: { score, multiplier, multiplierKills }
//  - score           : accumulated run score (starts at 0; grows by each killed
//                       enemy's base value × the current multiplier).
//  - multiplier      : the RE1 run multiplier (starts at SCORE_MULTIPLIER_START;
//                       climbs on kills to the cap; reset to START on death).
//  - multiplierKills : progress toward the next multiplier step (0..KILLS_PER_STEP);
//                       resets to 0 on each step-up and on death.

/**
 * Create the run-economy state at the start of a run: score zero, multiplier at
 * its starting value, and zero progress toward the next step.
 * @returns {{score:number, multiplier:number, multiplierKills:number}}
 */
export function createScoreState() {
  return {
    score: 0,
    multiplier: SCORE_MULTIPLIER_START,
    multiplierKills: 0,
  };
}

/**
 * Reset the multiplier back to its starting value and clear its kill-progress.
 * Called at the death seam so the streak is wiped the instant the player dies
 * (both a respawning death and the final game-over death). Leaves the score
 * itself untouched — you keep the points you earned, but lose the streak.
 * @param {{multiplier:number, multiplierKills:number}} scoreState
 */
export function resetMultiplier(scoreState) {
  scoreState.multiplier = SCORE_MULTIPLIER_START;
  scoreState.multiplierKills = 0;
}
