import { System } from '../core/System.js';

// ScoringSystem — credits score for bullet-killed enemies (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER CollisionSystem, so the kills for
// this tick are already recorded on collisionSystem.killedEnemies. Each fixed
// step it sums each killed enemy's own base `score` into ScoreState.score —
// type-agnostic, so every archetype (Seeker, Green Square, …) credits its own
// per-instance value through this one seam.
//
// Contract (from the I/O matrix):
//   - No kills this tick  → score unchanged.
//   - One kill            → score += that enemy's base score.
//   - N kills one tick    → score += sum of the N base scores.
//   - Across ticks the additions accumulate; because CollisionSystem resets
//     killedEnemies at the top of every tick, a kill is never counted twice.
//   - The value is the enemy's own base per-type value — NEVER multiplied here
//     (the multiplier arrives in Epic 3 / Story 3.1).
//
// Owns no pool or state: it reads CollisionSystem's public killedEnemies and
// mutates the shared ScoreState. Zero steady-state allocation — it reuses the
// reported array and allocates no per-tick structures.
export class ScoringSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem
   *   The sibling collision system whose killedEnemies report is consumed.
   * @param {{score:number}} scoreState Shared run-economy state to credit.
   */
  constructor(collisionSystem, scoreState) {
    super();
    this.collisionSystem = collisionSystem;
    this.scoreState = scoreState;
  }

  /**
   * Advance one fixed step: add each enemy killed this tick to the score.
   * @param {number} _dt Constant fixed-step delta (ms) — scoring is stateless
   *   in dt; it only reads the kills already recorded this tick.
   */
  fixedUpdate(_dt) {
    const killed = this.collisionSystem.killedEnemies;
    for (let i = 0; i < killed.length; i++) {
      this.scoreState.score += killed[i].score;
    }
  }
}
