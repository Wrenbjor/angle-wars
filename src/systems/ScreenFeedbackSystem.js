import { System } from '../core/System.js';
import {
  SCREEN_SHAKE_TRAUMA_BOMB,
  SCREEN_SHAKE_TRAUMA_DEATH,
  SCREEN_SHAKE_TRAUMA_KILL,
  SCREEN_SHAKE_TRAUMA_NEARMISS,
  SCREEN_FLASH_MS,
  SCREEN_HITSTOP_MS,
  SCREEN_NEARMISS_RADIUS,
  SCREEN_NEARMISS_COOLDOWN_MS,
} from '../config/constants.js';

// ScreenFeedbackSystem — the Phaser-free simulation seam for screen juice
// (Story 4.4): camera shake, screen flash, and hit-stop.
//
// Runs LAST in the world pipeline (registered after GridFieldSystem /
// ParticleSystem), so within each fixed tick every input it reads is already
// final: collisionSystem.bulletKillCount (this tick's bullet kills, before
// BlackHole/Bomb appends), the bombSystem shockwave rising edge, the
// playerDeathSystem.deathSeq increment, and the current ship/enemy positions. It
// is a PURE read-only observer — it mutates ONLY its own latch fields and never
// touches a pool, entity, score, life, or death state (exactly like
// GridFieldSystem / ParticleSystem).
//
// Each fixed step it turns those events into three magnitude latches the render
// loop consumes:
//   - pending shake TRAUMA (accumulated add): +BOMB on a bomb edge, +DEATH on a
//     death edge (death harder than a bomb), +KILL per bullet kill this tick, and
//     +NEARMISS per registered near-miss,
//   - a FLASH request: raised on a bomb OR death edge (big events only),
//   - a HIT-STOP request: raised on a bomb OR death edge (big events only).
// Kills and near-misses add trauma ONLY — no flash, no hit-stop — so they reinforce
// without obscuring play.
//
// Near-miss without per-enemy state: pooled enemies recycle, so a single global
// cooldown (_nearMissCooldownMs) throttles the cue instead of tracking each enemy's
// approach. Each step it decrements the cooldown by dt; when the cooldown is 0 and
// any active, non-telegraphing enemy sits in the band (ship.radius+enemy.radius,
// SCREEN_NEARMISS_RADIUS] (close but not overlapping), it registers ONE near-miss
// and resets the cooldown. Bounded, zero-alloc (a hoisted forEachActive callback),
// recycle-safe.
//
// Edge-detection prevs are seeded from the current source values at construction so
// no cue fires spuriously on the first tick (mirrors GridFieldSystem). The render
// loop drives the actual shake/flash/hit-stop at render level from the latches so
// they play out and settle over real time even while the sim is frozen (game-over).
export class ScreenFeedbackSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem Source
   *   of this tick's bullet-kill count (bulletKillCount) — the subtle per-kill nudge.
   * @param {import('./BombSystem.js').BombSystem} bombSystem Source of the bomb
   *   shockwave latch (shockwaveMs rising edge = a detonation big event).
   * @param {import('./PlayerDeathSystem.js').PlayerDeathSystem} playerDeathSystem
   *   Source of the death latch (deathSeq increment = a death big event).
   * @param {{x:number,y:number,radius:number}} ship The player ship — read for the
   *   near-miss proximity scan. Observed, never mutated.
   * @param {import('../core/Pool.js').Pool[]} enemyPools Every combat-archetype
   *   enemy pool; their active, non-telegraphing instances are scanned for a
   *   near-miss. Observed, never mutated.
   */
  constructor(collisionSystem, bombSystem, playerDeathSystem, ship, enemyPools) {
    super();
    this.collisionSystem = collisionSystem;
    this.bombSystem = bombSystem;
    this.playerDeathSystem = playerDeathSystem;
    this.ship = ship;
    this.enemyPools = enemyPools;

    // Edge-detection previous-values, SEEDED from the current state so no spurious
    // cue fires on the first tick (mirrors GridFieldSystem's prev seeding).
    this._prevShockwaveMs = bombSystem ? bombSystem.shockwaveMs : 0;
    this._prevDeathSeq = playerDeathSystem ? playerDeathSystem.deathSeq : 0;

    // Render-consumable latches (reset by the consume*() reads).
    this._pendingTrauma = 0;
    this._flashPending = false;
    this._hitStopPending = false;

    // Single global near-miss throttle (ms). Decremented by dt each step; reset to
    // SCREEN_NEARMISS_COOLDOWN_MS whenever a near-miss registers. Recycle-safe.
    this._nearMissCooldownMs = 0;

    // Near-miss scan scratch: a hoisted callback (reused across pools/ticks, no
    // per-tick alloc) and the found-flag it sets. `_nearMissRadiusSq` is precomputed.
    this._nearMissHit = false;
    this._nearMissRadiusSq = SCREEN_NEARMISS_RADIUS * SCREEN_NEARMISS_RADIUS;
    this._checkNearMiss = (e) => {
      if (this._nearMissHit) return; // one near-miss per scan is enough
      if (e.telegraphMs > 0) return; // telegraphing (spawning-in) enemy → excluded
      const dx = this.ship.x - e.x;
      const dy = this.ship.y - e.y;
      const distSq = dx * dx + dy * dy;
      // Lower bound depends on this enemy's radius (must not already overlap the
      // ship's collision radius); upper bound is the shared near-miss radius. Band
      // is (low, high]: strictly outside the overlap, at/inside the near-miss ring.
      const low = this.ship.radius + e.radius;
      const lowSq = low * low;
      if (distSq > lowSq && distSq <= this._nearMissRadiusSq) {
        this._nearMissHit = true;
      }
    };
  }

  /**
   * Advance one fixed step: detect the bomb/death edges (raise flash + hit-stop and
   * add the big trauma), add the per-kill trauma, and run the throttled near-miss
   * scan. Mutates only this system's own latches.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    // (1) Bomb detonation — big event. shockwaveMs only rises at a detonation
    //     (otherwise it decays), so the rising edge fires exactly once per bomb.
    const bs = this.bombSystem;
    if (bs) {
      if (bs.shockwaveMs > this._prevShockwaveMs) {
        this._pendingTrauma += SCREEN_SHAKE_TRAUMA_BOMB;
        this._flashPending = true;
        this._hitStopPending = true;
      }
      this._prevShockwaveMs = bs.shockwaveMs;
    }

    // (2) Player death — big event, harder than a bomb. One per deathSeq increment
    //     (both a respawning death and the final game-over death).
    const pds = this.playerDeathSystem;
    if (pds) {
      if (pds.deathSeq !== this._prevDeathSeq) {
        this._pendingTrauma += SCREEN_SHAKE_TRAUMA_DEATH;
        this._flashPending = true;
        this._hitStopPending = true;
        this._prevDeathSeq = pds.deathSeq;
      }
    }

    // (3) Bullet kills — subtle nudge only (NO flash, NO hit-stop). bulletKillCount
    //     is this tick's bullet kills, before BlackHole/Bomb appends (the same
    //     source the grid ripple / particle burst read).
    const cs = this.collisionSystem;
    if (cs) {
      const n = cs.bulletKillCount;
      if (n > 0) {
        this._pendingTrauma += n * SCREEN_SHAKE_TRAUMA_KILL;
      }
    }

    // (4) Near-miss — throttled subtle nudge only. Decrement the cooldown by dt
    //     (clamp >= 0); when it is 0 and any active, non-telegraphing enemy sits in
    //     the proximity band, register ONE near-miss and reset the cooldown.
    if (this._nearMissCooldownMs > 0) {
      this._nearMissCooldownMs -= dt;
      if (this._nearMissCooldownMs < 0) this._nearMissCooldownMs = 0;
    }
    if (this._nearMissCooldownMs === 0 && this.ship && this.enemyPools) {
      this._nearMissHit = false;
      const pools = this.enemyPools;
      for (let p = 0; p < pools.length; p++) {
        pools[p].forEachActive(this._checkNearMiss);
      }
      if (this._nearMissHit) {
        this._pendingTrauma += SCREEN_SHAKE_TRAUMA_NEARMISS;
        this._nearMissCooldownMs = SCREEN_NEARMISS_COOLDOWN_MS;
      }
    }
  }

  /**
   * Read-and-reset the accumulated pending shake trauma add (0 if none since the
   * last consume). The render loop adds this into its own real-time trauma countdown.
   * @returns {number} accumulated trauma add
   */
  consumePendingTrauma() {
    const t = this._pendingTrauma;
    this._pendingTrauma = 0;
    return t;
  }

  /**
   * Read-and-reset the flash request: SCREEN_FLASH_MS if a big event (bomb/death)
   * fired since the last consume, else 0.
   * @returns {number} flash duration (ms) or 0
   */
  consumeFlashRequest() {
    if (!this._flashPending) return 0;
    this._flashPending = false;
    return SCREEN_FLASH_MS;
  }

  /**
   * Read-and-reset the hit-stop request: SCREEN_HITSTOP_MS if a big event
   * (bomb/death) fired since the last consume, else 0.
   * @returns {number} hit-stop duration (ms) or 0
   */
  consumeHitStopRequest() {
    if (!this._hitStopPending) return 0;
    this._hitStopPending = false;
    return SCREEN_HITSTOP_MS;
  }
}
