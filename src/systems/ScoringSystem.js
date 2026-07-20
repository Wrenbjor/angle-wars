import { System } from '../core/System.js';
import {
  SCORE_MULTIPLIER_MAX,
  SCORE_MULTIPLIER_KILLS_PER_STEP,
} from '../config/constants.js';

// ScoringSystem — credits score for bullet-killed enemies and drives the run
// multiplier (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER CollisionSystem, so the kills for
// this tick are already recorded on collisionSystem.killedEnemies. Each fixed
// step it credits each killed enemy's own base `score` × the current multiplier
// into ScoreState.score — type-agnostic, so every archetype (Seeker, Green
// Square, …) is awarded its own per-instance value through this one seam (FR7).
//
// It also advances the multiplier (FR8): each kill (while below the cap) counts
// toward the next step; on reaching SCORE_MULTIPLIER_KILLS_PER_STEP the progress
// resets and the multiplier climbs one step, never past SCORE_MULTIPLIER_MAX.
//
// Contract (from the I/O matrix):
//   - No kills this tick  → score, multiplier, and progress all unchanged.
//   - One kill at m×      → score += that enemy's base × m; progress advances one.
//   - N kills one tick    → each enemy scored at the multiplier in effect when it
//     is processed (an earlier kill this tick may step it up for a later one).
//   - The triggering kill (the one that crosses the step threshold) is scored at
//     the PRE-step multiplier, since the award is credited before the step-up.
//   - At the cap further kills score at the cap and never advance progress.
//   - Across ticks the additions accumulate; because CollisionSystem resets
//     killedEnemies at the top of every tick, a kill is never counted twice.
//
// Owns no pool or state: it reads CollisionSystem's public killedEnemies and
// mutates the shared ScoreState. Zero steady-state allocation — it reuses the
// reported array and allocates no per-tick structures.
export class ScoringSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem
   *   The sibling collision system whose killedEnemies report is consumed.
   * @param {{score:number, multiplier:number, multiplierKills:number}} scoreState
   *   Shared run-economy state to credit and advance.
   */
  constructor(collisionSystem, scoreState) {
    super();
    this.collisionSystem = collisionSystem;
    this.scoreState = scoreState;
  }

  /**
   * Advance one fixed step: award each enemy killed this tick at the current
   * multiplier, then advance the multiplier's kill-progress (up to the cap).
   * @param {number} _dt Constant fixed-step delta (ms) — scoring is stateless
   *   in dt; it only reads the kills already recorded this tick.
   */
  fixedUpdate(_dt) {
    const ss = this.scoreState;
    const killed = this.collisionSystem.killedEnemies;
    for (let i = 0; i < killed.length; i++) {
      // Award at the multiplier in effect for this kill (before any step-up).
      ss.score += killed[i].score * ss.multiplier;
      // Advance the streak only while below the cap; frozen once capped.
      if (ss.multiplier < SCORE_MULTIPLIER_MAX) {
        if (++ss.multiplierKills >= SCORE_MULTIPLIER_KILLS_PER_STEP) {
          ss.multiplierKills = 0;
          ss.multiplier += 1;
        }
      }
    }
  }
}
