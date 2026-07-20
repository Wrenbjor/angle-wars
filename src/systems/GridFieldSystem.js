import { System } from '../core/System.js';
import {
  GRID_MAX_RIPPLES,
  GRID_RIPPLE_DURATION_MS,
  BLACKHOLE_MAX_RADIUS,
} from '../config/constants.js';

// GridFieldSystem — the Phaser-free simulation seam for the deforming grid field
// (Story 4.2).
//
// Runs LAST in the world pipeline (after HighScoreSystem), so within each fixed
// tick every input it reads is already final: CollisionSystem has latched
// bulletKillCount (this tick's bullet kills, before BlackHole/Bomb appends),
// BombSystem has raised its shockwave latch on a detonation, PlayerDeathSystem has
// latched the death point, and holePool reflects the current Black Hole. Reading
// at end-of-tick avoids one-tick lag and any reordering of the carefully-ordered
// pipeline.
//
// It owns a BOUNDED, fixed-size pool of ripple slots and a single warp target and
// only ever WRITES its own state (never any pool/entity/score). Each fixed step it:
//   1. advances every active ripple's age by dt and expires those past the lifetime,
//   2. emits ONE ripple per this-tick trigger:
//        - explosion: each enemy destroyed by a player bullet this tick
//          (collisionSystem.bulletKillX/Y[0 .. bulletKillCount) — coordinate
//          snapshots, so a mid-tick pool-recycle of the enemy can't move the origin),
//        - bomb: one at the detonation origin on the shockwave rising edge,
//        - death: one at the player's death point per deathSeq increment,
//   3. recomputes the warp from holePool: warp toward the largest-radius alive,
//      NON-telegraphing hole (strength = clamp(radius/BLACKHOLE_MAX_RADIUS,0,1));
//      warp releases (strength 0) when the hole is gone or still telegraphing.
//
// Absorb/bomb-cleared enemies do NOT each emit a ripple (an absorb is not an
// explosion; the bomb's own single ripple represents its detonation) — that is
// exactly why it reads only the first bulletKillCount snapshots (captured before
// those later systems append their own removals) rather than the whole kill report.
//
// Zero per-tick allocation: the ripple slots are pre-allocated once and mutated in
// place; emission and warp recompute allocate nothing (mirrors CollisionSystem /
// BombSystem scratch discipline). The gridField.js pure seam packs this state into
// the shader's uniform arrays each render frame.
export class GridFieldSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem Source
   *   of this tick's bullet-kill coordinate snapshots: bulletKillX/Y[0 ..
   *   bulletKillCount) (recycle-proof, unlike the killedEnemies objects).
   * @param {import('./BombSystem.js').BombSystem} bombSystem Source of the bomb
   *   shockwave latch (shockwaveMs rising edge + shockwaveX/Y origin).
   * @param {import('./PlayerDeathSystem.js').PlayerDeathSystem} playerDeathSystem
   *   Source of the death latch (deathSeq increments + deathX/deathY origin).
   * @param {import('../core/Pool.js').Pool} holePool The Black Hole pool — the warp
   *   source. Warp targets the largest-radius alive, non-telegraphing hole.
   */
  constructor(collisionSystem, bombSystem, playerDeathSystem, holePool) {
    super();
    this.collisionSystem = collisionSystem;
    this.bombSystem = bombSystem;
    this.playerDeathSystem = playerDeathSystem;
    this.holePool = holePool;

    // Fixed-size ripple pool: a bounded uniform array size => bounded GPU cost,
    // independent of how many explosions occur. Each slot: {active, x, y, ageMs}.
    // Pre-allocated once here; emission/advance mutate slots in place (no alloc).
    /** @type {{active:boolean,x:number,y:number,ageMs:number}[]} */
    this.ripples = new Array(GRID_MAX_RIPPLES);
    for (let i = 0; i < GRID_MAX_RIPPLES; i++) {
      this.ripples[i] = { active: false, x: 0, y: 0, ageMs: 0 };
    }

    // Single warp target. active=false / strength=0 means "released" (no warp).
    this.warp = { active: false, x: 0, y: 0, strength: 0 };

    // Edge-detection previous-values, SEEDED from the current state so no spurious
    // ripple fires on the first tick (mirrors BombSystem's cursor seeding).
    this._prevShockwaveMs = bombSystem ? bombSystem.shockwaveMs : 0;
    this._prevDeathSeq = playerDeathSystem ? playerDeathSystem.deathSeq : 0;

    // Reusable scratch cursor for finding the largest hole (no per-tick alloc).
    this._collectHole = (h) => {
      if (h.telegraphMs > 0) return; // telegraphing hole exerts no gravity yet
      if (this._bestHole === null || h.radius > this._bestHole.radius) {
        this._bestHole = h;
      }
    };
    this._bestHole = null;
  }

  /**
   * Advance one fixed step: age/expire ripples, emit this tick's trigger ripples,
   * and recompute the warp from the current Black Hole.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ripples = this.ripples;

    // (1) Advance + expire existing ripples. A slot at/over the lifetime frees.
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      if (!r.active) continue;
      r.ageMs += dt;
      if (r.ageMs >= GRID_RIPPLE_DURATION_MS) {
        r.active = false;
      }
    }

    // (2a) Explosion ripples: one per enemy destroyed by a player bullet this tick.
    //      Read the COORDINATE SNAPSHOTS bulletKillX/Y[0 .. bulletKillCount) — NOT
    //      the (recyclable) killedEnemies objects: CollisionSystem releases a killed
    //      enemy to its pool mid-tick, and a later same-tick system (e.g. a black-hole
    //      feed-spawn) can acquire() that object and overwrite its x/y, so the object
    //      no longer holds the kill point at end-of-tick. The snapshot count already
    //      excludes absorb/bomb-cleared removals (those are appended after the latch).
    const cs = this.collisionSystem;
    if (cs) {
      const n = cs.bulletKillCount;
      for (let i = 0; i < n; i++) {
        this._emit(cs.bulletKillX[i], cs.bulletKillY[i]);
      }
    }

    // (2b) Bomb ripple on the shockwave rising edge (shockwaveMs only rises at a
    //      detonation; otherwise it decays), so exactly one ripple per detonation.
    const bs = this.bombSystem;
    if (bs) {
      if (bs.shockwaveMs > this._prevShockwaveMs) {
        this._emit(bs.shockwaveX, bs.shockwaveY);
      }
      this._prevShockwaveMs = bs.shockwaveMs;
    }

    // (2c) Death ripple on each deathSeq increment, at the latched death point.
    const pds = this.playerDeathSystem;
    if (pds) {
      if (pds.deathSeq !== this._prevDeathSeq) {
        this._emit(pds.deathX, pds.deathY);
        this._prevDeathSeq = pds.deathSeq;
      }
    }

    // (3) Warp: target the largest-radius alive, non-telegraphing hole. With
    //     BLACKHOLE_MAX_ACTIVE = 1 there is at most one; if more ever exist the
    //     largest wins. No hole (or only telegraphing ones) => warp releases.
    this._bestHole = null;
    if (this.holePool) {
      this.holePool.forEachActive(this._collectHole);
    }
    const hole = this._bestHole;
    const warp = this.warp;
    if (hole) {
      warp.active = true;
      warp.x = hole.x;
      warp.y = hole.y;
      // Strength scales with the hole's current radius, clamped to [0,1].
      let s = hole.radius / BLACKHOLE_MAX_RADIUS;
      if (s < 0) s = 0;
      else if (s > 1) s = 1;
      warp.strength = s;
    } else {
      warp.active = false;
      warp.strength = 0;
    }
  }

  /**
   * Emit one ripple at (x, y): reuse any inactive slot, else overwrite the OLDEST
   * active slot (max ageMs) so the count never exceeds GRID_MAX_RIPPLES. The new
   * ripple starts at age 0. Allocates nothing.
   * @private
   */
  _emit(x, y) {
    const ripples = this.ripples;
    let slot = null;
    let oldest = null;
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      if (!r.active) {
        slot = r;
        break;
      }
      if (oldest === null || r.ageMs > oldest.ageMs) {
        oldest = r;
      }
    }
    if (slot === null) slot = oldest; // all active → recycle the oldest
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.ageMs = 0;
  }
}
