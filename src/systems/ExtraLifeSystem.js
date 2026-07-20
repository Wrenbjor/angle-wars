import { System } from '../core/System.js';
import { LIFE_AWARD_SCORE_THRESHOLDS } from '../config/constants.js';

// ExtraLifeSystem — score-milestone extra-life award (Phaser-free).
//
// FR10: the RE1 milestone reward. Each fixed step it awards +1 to
// PlayerState.lives for every entry in the fixed ascending
// LIFE_AWARD_SCORE_THRESHOLDS list the running score has reached or passed since
// construction. This is the same threshold-crossing-on-a-monotonic-cursor idiom
// BombSystem uses for its 100k bomb award, but a DEFINED FINITE LIST (not a
// repeating interval) awarding onto the existing lives counter.
//
// It runs inside world.fixedUpdate(dt), ordered LATE in the tick — AFTER
// ScoringSystem, BlackHoleSystem, and BombSystem, and BEFORE PlayerDeathSystem.
// That ordering is load-bearing:
//   - After Scoring + BlackHole (+ Bomb): the score it reads is fully settled this
//     tick — a kill's award and the black-hole detonation payout both count toward
//     a threshold with no one-tick lag.
//   - Before PlayerDeath: a life earned this tick is banked before the death
//     check. If a threshold-crossing kill and a lethal contact land on the same
//     tick while on the last life, the earned life is added first (1→2), then the
//     death consumes one (2→1, respawn) — the player is rescued by the milestone
//     they just earned, symmetric to a bomb clearing enemies before the death
//     check. This does NOT violate "reaching 0 ends the game": the player never
//     reaches 0, they earn a life.
//
// It reads scoreState.score (NEVER writes it) and mutates only playerState.lives.
// No life cap / no clamp — the finite list bounds total awards. It never resets or
// alters awarded lives on death; the death path is the only place lives decrease.
//
// Exactly-once via a monotonic index. Because score only ever increases and the
// list is ascending, an index cursor advanced past each consumed threshold fires
// each exactly once and never rescans awarded entries — O(1) amortized, zero
// per-tick allocation.
export class ExtraLifeSystem extends System {
  /**
   * @param {{score:number}} scoreState Shared run-economy state — score is READ
   *   (never written) for the milestone award.
   * @param {{lives:number}} playerState Shared player lifecycle state — lives is
   *   the single counter the award increments (the same one deaths decrement).
   */
  constructor(scoreState, playerState) {
    super();
    this.scoreState = scoreState;
    this.playerState = playerState;

    // Monotonic cursor: the index of the next unawarded threshold. Seeded at
    // construction by skipping every threshold already at/below the current score
    // (0 on a fresh run → skips none), so thresholds already passed are never
    // awarded retroactively (mirrors BombSystem._scoreCursor = scoreState.score).
    // A fresh instance per run (scene.restart rebuilds every system) resets it.
    this._nextThresholdIndex = 0;
    const score = scoreState.score;
    while (
      this._nextThresholdIndex < LIFE_AWARD_SCORE_THRESHOLDS.length &&
      score >= LIFE_AWARD_SCORE_THRESHOLDS[this._nextThresholdIndex]
    ) {
      this._nextThresholdIndex += 1;
    }
  }

  /**
   * Advance one fixed step: award +1 life per threshold the settled score has
   * reached or passed since the cursor last advanced.
   * @param {number} _dt Constant fixed-step delta, in milliseconds (unused —
   *   the award is time-independent, driven purely by the monotonic score).
   */
  fixedUpdate(_dt) {
    const score = this.scoreState.score;
    let idx = this._nextThresholdIndex;
    // Ascending list + monotonic score → each threshold fires exactly once, and a
    // single tick that jumps past several awards one life per threshold crossed.
    while (
      idx < LIFE_AWARD_SCORE_THRESHOLDS.length &&
      score >= LIFE_AWARD_SCORE_THRESHOLDS[idx]
    ) {
      this.playerState.lives += 1;
      idx += 1;
    }
    this._nextThresholdIndex = idx;
  }
}
