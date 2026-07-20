import { System } from '../core/System.js';
import {
  BOMB_AWARD_SCORE_INTERVAL,
  BOMB_SHOCKWAVE_MS,
} from '../config/constants.js';

// BombSystem — smart-bomb detonation + score-threshold award (Phaser-free).
//
// The RE1 emergency screen-clear (FR9). Runs inside world.fixedUpdate(dt) at the
// constant fixed step, ordered LATE in the tick — AFTER ScoringSystem and
// BlackHoleSystem, and BEFORE PlayerDeathSystem. That ordering is load-bearing:
//   - After ScoringSystem: enemies this system appends to
//     collisionSystem.killedEnemies are REMOVED (reconciled by owner systems like
//     SnakeSystem on their next tick) but NOT scored and do not advance the
//     multiplier — a bomb is a defensive cost, not a reward. This is the exact
//     unscored-clear pattern BlackHoleSystem's absorb already uses.
//   - After BlackHoleSystem: the score read for the +1-bomb award is fully
//     settled this tick (no one-tick lag; the black-hole detonation payout counts
//     toward the 100k thresholds too).
//   - Before PlayerDeathSystem: the clear removes enemies before the death check,
//     so a bomb genuinely rescues the player from an otherwise-lethal contact
//     this same tick.
//
// Each fixed step, in order:
//   (1) Award +1 bomb per BOMB_AWARD_SCORE_INTERVAL boundary the running score
//       has crossed since the last-seen cursor (floor(score/INTERVAL) −
//       floor(cursor/INTERVAL)); the score only ever increases, so each boundary
//       fires exactly once even when a single kill jumps past several intervals.
//       Then advance the cursor to the current score. No bomb cap (FR9).
//   (2) Consume the latched bomb request (reads-and-clears). If one was pending
//       AND bombs > 0: release EVERY active enemy across the four archetype pools
//       to its OWNING pool AND append it to collisionSystem.killedEnemies (the
//       reconciliation seam, identical to a bullet kill / black-hole absorb), then
//       decrement bombs by one and arm the placeholder shockwave at the ship. The
//       clear ignores telegraph state — a decisive player-triggered detonation
//       clears every on-screen enemy regardless of spawn-in state (unlike the
//       passive Black Hole, which leaves telegraphing enemies inert).
//   (3) Decay the shockwave countdown by dt (clamped at 0).
//
// The bomb clears ONLY the four combat-archetype enemyPools — never the Black Hole
// or any hazard (a separate multi-hit lifecycle that stays lethal through a
// detonation). It never touches the multiplier, lives, or the death lifecycle.
//
// Zero steady-state allocation: reusable scratch materializes the active sets and
// their owners (iterating a Set can't be indexed, and releasing mutates it
// mid-iteration — both unsafe), then a second pass releases + reports; mirrors
// CollisionSystem / BlackHoleSystem.
export class BombSystem extends System {
  /**
   * @param {import('../input/InputState.js').InputState} inputState Shared input
   *   seam; the latched bomb request is consumed (reads-and-clears) each step.
   * @param {import('../core/Pool.js').Pool[]} enemyPools Every combat-archetype
   *   enemy pool (their active instances are cleared on a detonation).
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The
   *   collision system whose public killedEnemies report is the reconciliation
   *   seam bomb-cleared enemies are appended to.
   * @param {{score:number, bombs:number}} scoreState Shared run economy — bombs is
   *   decremented on a detonation and incremented on each 100k crossing; score is
   *   read (never written) for the award.
   * @param {{x:number,y:number}} ship The player ship — the shockwave origin.
   */
  constructor(inputState, enemyPools, collisionSystem, scoreState, ship) {
    super();
    this.inputState = inputState;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.scoreState = scoreState;
    this.ship = ship;

    // Monotonic previous-score cursor for the threshold award. Seeded from the
    // current score (0 on a fresh run) so the first bomb is awarded at the first
    // BOMB_AWARD_SCORE_INTERVAL boundary, never retroactively for a pre-seeded score.
    this._scoreCursor = scoreState.score;

    // Placeholder expanding-shockwave state the render loop reads: a sim-side
    // countdown (mirrors telegraphMs / invulnMs) and the ship position captured at
    // detonation so the ring stays put as the ship keeps moving. Epic 4 replaces
    // the placeholder ring with the real shockwave + screen-shake juice.
    this.shockwaveMs = 0;
    this.shockwaveX = 0;
    this.shockwaveY = 0;

    // Reusable scratch so the detonation path allocates nothing: the materialized
    // active enemies and a parallel array of each one's owning pool (so a release
    // routes to the correct pool). Collected in pass 1, drained in pass 2.
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };
  }

  /**
   * Advance one fixed step: award threshold bombs, then (if requested and armed)
   * detonate, then decay the shockwave countdown.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ss = this.scoreState;

    // (1) Threshold award: +1 bomb per interval boundary crossed since the cursor.
    //     floor difference fires each boundary exactly once even across a multi-
    //     interval jump; the score is monotonic so the cursor only advances.
    const score = ss.score;
    if (score > this._scoreCursor) {
      const crossed =
        Math.floor(score / BOMB_AWARD_SCORE_INTERVAL) -
        Math.floor(this._scoreCursor / BOMB_AWARD_SCORE_INTERVAL);
      if (crossed > 0) ss.bombs += crossed;
      this._scoreCursor = score;
    }

    // (2) Detonation: consume the latch (reads-and-clears) so the press fires at
    //     most one detonation. Only detonate with a bomb in hand.
    const requested = this.inputState.consumeBomb();
    if (requested && ss.bombs > 0) {
      const enemies = this._enemies;
      const owners = this._owners;
      enemies.length = 0;
      owners.length = 0;
      const pools = this.enemyPools;
      for (let p = 0; p < pools.length; p++) {
        this._currentPool = pools[p];
        pools[p].forEachActive(this._collectEnemy);
      }

      // Second pass — safe to mutate the pools now: release each active enemy to
      // its OWNING pool and append it to the kill report so owner systems (e.g.
      // SnakeSystem) reconcile through the same seam a bullet kill uses. UNSCORED
      // by construction — this runs after ScoringSystem, which already ran this
      // tick over its own (bullet-kill) report.
      const killed = this.collisionSystem.killedEnemies;
      for (let i = 0; i < enemies.length; i++) {
        owners[i].release(enemies[i]);
        killed.push(enemies[i]);
      }

      ss.bombs -= 1;

      // Arm the placeholder shockwave at the ship's current position.
      this.shockwaveMs = BOMB_SHOCKWAVE_MS;
      this.shockwaveX = this.ship.x;
      this.shockwaveY = this.ship.y;
    }

    // (3) Decay the shockwave countdown (clamped at 0), whether or not a
    //     detonation happened this tick.
    if (this.shockwaveMs > 0) {
      this.shockwaveMs -= dt;
      if (this.shockwaveMs < 0) this.shockwaveMs = 0;
    }
  }
}
