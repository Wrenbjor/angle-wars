import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createXpOrb } from '../entities/XpOrb.js';
import {
  XP_ORB_MAX,
  XP_ORB_RADIUS,
  XP_PICKUP_RADIUS,
  XP_ORB_DRIFT_SPEED,
  XP_MULTIPLIER_DIVISOR,
  BLACKHOLE_DEFUSED_XP,
  MIRROR_CENTER_KILL_XP,
  SHIP_RADIUS,
} from '../config/constants.js';

// XpOrbSystem — the pooled XP-orb economy: drop, drift & pickup (Phaser-free).
//
// The first brick of the Epic 8 level-up loop (Story 8.1): a SEPARATE economy
// from `score`. Every enemy death that credits score TODAY also drops one pooled
// XP orb carrying that death's small per-type XP value; each orb drifts toward the
// ship ONLY while the ship is within XP_PICKUP_RADIUS, is collected on contact, and
// credits the run's XP total scaled by the current multiplier. Purely additive —
// the v1 movement/firing/bomb/multiplier/scoring/death behavior is untouched.
//
// Runs inside world.fixedUpdate(dt). It reads the three per-tick DROP reports every
// scored-death seam publishes (recycle-safe snapshots captured at kill time, before
// any pool release):
//   - collisionSystem.bulletKillX/Y/Xp[0 .. bulletKillCount) — bullet kills only
//     (the count already excludes bomb-cleared / black-hole-absorbed removals, which
//     credit no score today and therefore drop NO XP — economy parity),
//   - blackHoleSystem.defusedX/defusedY — safe IMPLOSIONS ("defused"), value
//     BLACKHOLE_DEFUSED_XP (a detonation pays nothing and is not reported),
//   - mirrorReflectorSystem.centerKillX/centerKillY — center-kills, value
//     MIRROR_CENTER_KILL_XP (a weight-kill pays nothing and is not reported).
// It owns a Pool of plain orb objects and ONLY mutates its own pool + scoreState.xp
// — no kills, lives, movement, firing, or scoring is touched (a near read-only
// observer, save for the XP credit).
//
// Each fixed step it, in ADVANCE-then-SPAWN order (so a fresh orb waits one tick
// before it can drift/collect, like the ParticleSystem):
//   1. For every live orb: compute the ship distance. Within the collect radius
//      (SHIP_RADIUS + XP_ORB_RADIUS) → credit orb.value × (1 + multiplier /
//      XP_MULTIPLIER_DIVISOR) using the multiplier AT COLLECT TIME (accumulated as a
//      float, no rounding) and collect it back to the pool. Else within
//      XP_PICKUP_RADIUS → drift toward the ship by XP_ORB_DRIFT_SPEED·dt — unless that
//      step would reach or pass the ship, in which case it collects this tick instead
//      of overshooting (so a large drift speed can never oscillate an orb across the
//      ship and hold a cap slot forever). Else it stays put — an orb on the floor
//      NEVER times out (a per-tick distance gate, not a magnet latch: an orb the ship
//      approaches then leaves stops drifting).
//   2. Spawn from the three reports, honoring the cap — a spawn that would exceed
//      XP_ORB_MAX is skipped this tick (the ParticleSystem precedent).
//
// Bounded: live orbs never exceed the cap; the cap + pool reuse is the only bound
// (orbs never time out). Zero steady-state allocation: advance materializes the
// active set into a reusable scratch array (Pool.forEachActive forbids releasing
// mid-iteration), collects expired orbs into a second reusable array, and releases
// them in a second pass; squared-distance compares avoid a sqrt on the resting-orb
// majority (only a drifting orb computes one). Spawning acquire()s from the pool.
export class XpOrbSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem Source of
   *   this tick's bullet-kill drop report: bulletKillX/Y/Xp[0 .. bulletKillCount).
   * @param {import('./BlackHoleSystem.js').BlackHoleSystem} blackHoleSystem Source of
   *   this tick's defuse report: defusedX/defusedY (safe implosions).
   * @param {import('./MirrorReflectorSystem.js').MirrorReflectorSystem} mirrorReflectorSystem
   *   Source of this tick's center-kill report: centerKillX/centerKillY.
   * @param {{x:number,y:number}} ship The player ship — read for the drift/collect
   *   distance (post-move position). Observed, never mutated.
   * @param {{xp:number,multiplier:number}} scoreState Shared run economy — the ONLY
   *   thing outside the pool this system writes: scoreState.xp on each collect.
   * @param {number} [maxOrbs] Hard cap on simultaneously-live orbs. Defaults to
   *   XP_ORB_MAX; guarded so an injected 0, NaN, or negative falls back to the cap.
   */
  constructor(
    collisionSystem,
    blackHoleSystem,
    mirrorReflectorSystem,
    ship,
    scoreState,
    maxOrbs = XP_ORB_MAX,
  ) {
    super();
    this.collisionSystem = collisionSystem;
    this.blackHoleSystem = blackHoleSystem;
    this.mirrorReflectorSystem = mirrorReflectorSystem;
    this.ship = ship;
    this.scoreState = scoreState;
    // Guard the placeholder footgun (mirrors ParticleSystem.maxParticles): the
    // `= XP_ORB_MAX` default only catches `undefined`, so an injected 0 (which would
    // suppress ALL spawns), NaN, or a negative falls back to the cap rather than
    // silently breaking the economy.
    this.maxOrbs =
      Number.isFinite(maxOrbs) && maxOrbs > 0 ? maxOrbs : XP_ORB_MAX;

    // The orb pool — the single source of active/free truth. Lazy growth; reuse on
    // the hot path (no per-tick allocation once warm).
    this.pool = new Pool(createXpOrb);

    // Reusable advance scratch: the materialized active set and the collected set,
    // both length-reset each tick (no per-tick allocation). `_collect` is a hoisted
    // closure so forEachActive reuses one arrow instead of allocating per tick.
    this._active = [];
    this._expired = [];
    this._collect = (o) => this._active.push(o);
  }

  /**
   * Advance one fixed step: drift/collect live orbs, then spawn this tick's drops.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const ship = this.ship;
    const scoreState = this.scoreState;

    // (1) Advance + collect. Materialize the active set first (releasing mid-
    //     iteration over the pool's active Set is unsafe), drift/collect in place,
    //     then release collected orbs in a second pass.
    const active = this._active;
    const expired = this._expired;
    active.length = 0;
    expired.length = 0;
    this.pool.forEachActive(this._collect);

    if (ship && active.length > 0) {
      const collectR = SHIP_RADIUS + XP_ORB_RADIUS;
      const collectRSq = collectR * collectR;
      const pickupRSq = XP_PICKUP_RADIUS * XP_PICKUP_RADIUS;
      const step = XP_ORB_DRIFT_SPEED * dtSec;
      const divisor = XP_MULTIPLIER_DIVISOR;
      for (let i = 0; i < active.length; i++) {
        const o = active[i];
        const dx = ship.x - o.x;
        const dy = ship.y - o.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= collectRSq) {
          // Collect: credit the fractional, collect-time-multiplier XP (accumulated
          // as a float — no rounding), then release the orb to the pool.
          scoreState.xp += o.value * (1 + scoreState.multiplier / divisor);
          expired.push(o);
        } else if (distSq <= pickupRSq) {
          // Drift toward the ship. distSq > collectRSq > 0 here, so the sqrt and the
          // divide are both safe (no divide-by-zero at the ship center). The sqrt is
          // paid ONLY on a drifting/collecting-by-distance orb — a resting orb on the
          // floor never computes it.
          const dist = Math.sqrt(distSq);
          if (step >= dist) {
            // A drift step that would reach or pass the ship this tick COLLECTS the
            // orb instead of moving it — otherwise a large (future-tuned) drift speed
            // could overshoot the collect band, oscillate the orb across the ship, and
            // permanently hold a cap slot. Same credit + expire as the collect branch.
            scoreState.xp += o.value * (1 + scoreState.multiplier / divisor);
            expired.push(o);
          } else {
            const inv = step / dist; // (drift distance this tick) × unit(dx,dy)
            o.x += dx * inv;
            o.y += dy * inv;
          }
        }
        // Else: outside the pickup radius — stays put (no timeout).
      }
    }
    for (let i = 0; i < expired.length; i++) {
      this.pool.release(expired[i]);
    }

    // (2) Spawn this tick's drops from the three reports, honoring the cap. Advance-
    //     then-spawn: a fresh orb waits one tick before it can drift/collect.

    // Bullet kills — the recycle-safe snapshots [0 .. bulletKillCount). The count
    // already excludes bomb/absorb removals (unscored → no XP). The xp snapshot is
    // already finite-guarded in the CollisionSystem.
    const cs = this.collisionSystem;
    if (cs) {
      const n = cs.bulletKillCount;
      const xs = cs.bulletKillX;
      const ys = cs.bulletKillY;
      const xps = cs.bulletKillXp;
      for (let k = 0; k < n; k++) {
        if (this.pool.activeCount >= this.maxOrbs) break; // cap reached
        this._spawn(xs[k], ys[k], xps[k]);
      }
    }

    // Defused (safely imploded) holes — one BLACKHOLE_DEFUSED_XP orb each.
    const bh = this.blackHoleSystem;
    if (bh) {
      const dxs = bh.defusedX;
      const dys = bh.defusedY;
      for (let i = 0; i < dxs.length; i++) {
        if (this.pool.activeCount >= this.maxOrbs) break; // cap reached
        this._spawn(dxs[i], dys[i], BLACKHOLE_DEFUSED_XP);
      }
    }

    // Mirror center-kills — one MIRROR_CENTER_KILL_XP orb each.
    const mr = this.mirrorReflectorSystem;
    if (mr) {
      const cxs = mr.centerKillX;
      const cys = mr.centerKillY;
      for (let i = 0; i < cxs.length; i++) {
        if (this.pool.activeCount >= this.maxOrbs) break; // cap reached
        this._spawn(cxs[i], cys[i], MIRROR_CENTER_KILL_XP);
      }
    }
  }

  /**
   * Acquire an orb from the pool (reusing a freed slot before the factory grows) and
   * overwrite every field. Allocates nothing on the reuse path.
   * @private
   */
  _spawn(x, y, value) {
    const o = this.pool.acquire();
    o.x = x;
    o.y = y;
    o.value = value;
    return o;
  }
}
