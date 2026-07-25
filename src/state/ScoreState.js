import { SCORE_MULTIPLIER_START, BOMB_START_COUNT } from '../config/constants.js';

// ScoreState — the shared run-economy state (plain data, Phaser-free).
//
// Mirrors PlayerState: a plain-data object the ScoringSystem mutates each fixed
// tick and the scene reads for the HUD and game-over screen. Kept separate from
// PlayerState because score is a distinct concern (run economy) from the ship's
// lives/invulnerability/game-over lifecycle. A fresh run rebuilds it from zero.
//
// Shape: { score, multiplier, multiplierKills, bombs, xp }
//  - score           : accumulated run score (starts at 0; grows by each killed
//                       enemy's base value × the current multiplier).
//  - multiplier      : the RE1 run multiplier (starts at SCORE_MULTIPLIER_START;
//                       climbs on kills to the cap; reset to START on death).
//  - multiplierKills : progress toward the next multiplier step (0..KILLS_PER_STEP);
//                       resets to 0 on each step-up and on death.
//  - bombs           : smart-bomb count (Story 3.2 / FR9). Starts at
//                       BOMB_START_COUNT; the BombSystem decrements it on a
//                       detonation and awards +1 per 100k score boundary. Run
//                       economy — rebuilt from zero only on a fresh run, NEVER
//                       reset on death (resetMultiplier leaves it untouched).
//  - xp              : run XP total (Story 8.1 / Epic 8). A SEPARATE economy from
//                       score, accumulated as a float (no rounding) by the
//                       XpOrbSystem as orbs are collected: each credits its base
//                       value × (1 + multiplier / XP_MULTIPLIER_DIVISOR) at collect
//                       time. Run-scoped like score — rebuilt from zero only on a
//                       fresh run, NEVER reset on death (resetMultiplier leaves it
//                       untouched).

/**
 * Create the run-economy state at the start of a run: score zero, multiplier at
 * its starting value, zero progress toward the next step, and the starting bomb
 * count. XP starts at zero (rebuilt only on a fresh run, never reset on death).
 * @returns {{score:number, multiplier:number, multiplierKills:number, bombs:number, xp:number}}
 */
export function createScoreState() {
  return {
    score: 0,
    multiplier: SCORE_MULTIPLIER_START,
    multiplierKills: 0,
    bombs: BOMB_START_COUNT,
    xp: 0,
  };
}

/**
 * Reset the multiplier back to its starting value (or 50% if softenMultiplierReset >= 1)
 * and clear its kill-progress.
 * Called at the death seam so the streak is wiped/softened the instant the player dies
 * (both a respawning death and the final game-over death). Leaves the score
 * itself untouched — you keep the points you earned, but lose the streak.
 * @param {{multiplier:number, multiplierKills:number}} scoreState
 * @param {{softenMultiplierReset?:number}|null} [playerStats=null]
 */
export function resetMultiplier(scoreState, playerStats = null) {
  if (scoreState) {
    const rawSoften = playerStats?.softenMultiplierReset;
    const soften = Number.isFinite(rawSoften) && rawSoften >= 1;
    const currentMult = Number.isFinite(scoreState.multiplier)
      ? scoreState.multiplier
      : SCORE_MULTIPLIER_START;
    if (soften) {
      scoreState.multiplier = Math.max(
        SCORE_MULTIPLIER_START,
        Math.floor(currentMult * 0.5),
      );
    } else {
      scoreState.multiplier = SCORE_MULTIPLIER_START;
    }
    scoreState.multiplierKills = 0;
  }
}
