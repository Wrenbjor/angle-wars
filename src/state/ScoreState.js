// ScoreState — the shared run-economy state (plain data, Phaser-free).
//
// Mirrors PlayerState: a plain-data object the ScoringSystem mutates each fixed
// tick and the scene reads for the HUD and game-over screen. Kept separate from
// PlayerState because score is a distinct concern (run economy) from the ship's
// lives/invulnerability/game-over lifecycle. A fresh run rebuilds it from zero.
//
// Shape: { score }
//  - score : accumulated run score (starts at 0; grows by each killed seeker's
//            base value — never multiplied here; the multiplier is Epic 3).

/**
 * Create the run-economy state at the start of a run: score zero.
 * @returns {{score:number}}
 */
export function createScoreState() {
  return {
    score: 0,
  };
}
