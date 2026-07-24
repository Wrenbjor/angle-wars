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
  GRAVITY_WELL_HOMING_SPEED,
  GRAVITY_WELL_PULL_RADIUS,
  GRAVITY_WELL_PULL_STRENGTH,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
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
// Extended in Story 11.7 (Gravity Well defense item): reads `playerStats` for dynamic
// pickup radius (+40% → +80% → +80% → +80% → +150%), orb homing speed (540 px/s at Lv3+),
// base XP value scaling (+25% at Lv4+), and position-nudge enemy pull toward active orbs
// at Lv5 (reading `enemyPools`).
//
// Runs inside world.fixedUpdate(dt). It reads the three per-tick DROP reports every
// scored-death seam publishes (recycle-safe snapshots captured at kill time, before
// any pool release):
//   - collisionSystem.bulletKillX/Y/Xp[0 .. bulletKillCount) — PLAYER-DAMAGE kills
//     only (bullets, then the Story 10.5 dash sweep, both through applyPlayerDamage)
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
//   1. At Lv5, the orbs alive at TICK START apply a position nudge to nearby
//      non-telegraphing combat enemies within GRAVITY_WELL_PULL_RADIUS (100px) toward
//      the orb position. Deliberately inside the advance phase, over the same pre-spawn
//      snapshot the drift/collect pass uses, so a fresh orb waits one tick before it can
//      pull exactly as it waits before it can drift/collect.
//   2. For every live orb: compute the ship distance. Within the collect radius
//      (SHIP_RADIUS + XP_ORB_RADIUS) → credit orb.value × xpValueMult × (1 + multiplier /
//      XP_MULTIPLIER_DIVISOR) using the multiplier AT COLLECT TIME (accumulated as a
//      float, no rounding) and collect it back to the pool. Else within the
//      effective pickup radius → drift toward the ship by speed·dt (540 px/s if homing
//      enabled, else 320 px/s) — unless that step would reach or pass the ship, in which
//      case it collects this tick instead of overshooting (so a large drift speed can
//      never oscillate an orb across the ship and hold a cap slot forever). Else it
//      stays put — an orb on the floor NEVER times out (a per-tick distance gate, not a
//      magnet latch: an orb the ship approaches then leaves stops drifting).
//   3. Spawn from the three reports, honoring the cap — a spawn that would exceed
//      XP_ORB_MAX is skipped this tick (the ParticleSystem precedent).
//
// Bounded: live orbs never exceed the cap; the cap + pool reuse is the only bound
// (orbs never time out). Zero steady-state allocation: advance materializes the
// active set into a reusable scratch array (Pool.forEachActive forbids releasing
// mid-iteration), collects expired orbs into a second reusable array, and releases
// them in a second pass; squared-distance compares avoid a sqrt on the resting-orb
// majority (only a drifting orb computes one). The Lv5 pull uses the same discipline:
// reusable enemy + accumulator scratch arrays and a squared-distance reject before any
// sqrt. Spawning acquire()s from the pool.
export class XpOrbSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem Source of
   *   this tick's PLAYER-DAMAGE kill drop report: bulletKillX/Y/Xp[0 ..
   *   bulletKillCount) — bullets and the Story 10.5 dash sweep.
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
   * @param {Object<string, number>} [playerStats] Runtime player modifier store.
   * @param {Array<import('../core/Pool.js').Pool>} [enemyPools] Array of combat enemy pools.
   */
  constructor(
    collisionSystem,
    blackHoleSystem,
    mirrorReflectorSystem,
    ship,
    scoreState,
    maxOrbs = XP_ORB_MAX,
    playerStats = null,
    enemyPools = null,
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
    this.playerStats = playerStats;
    this.enemyPools = enemyPools;

    // The orb pool — the single source of active/free truth. Lazy growth; reuse on
    // the hot path (no per-tick allocation once warm).
    this.pool = new Pool(createXpOrb);

    // Reusable advance scratch: the materialized active set and the collected set,
    // both length-reset each tick (no per-tick allocation). `_collect` is a hoisted
    // closure so forEachActive reuses one arrow instead of allocating per tick.
    this._active = [];
    this._expired = [];
    this._collect = (o) => this._active.push(o);

    // Reusable Lv5 enemy-pull scratch (zero per-frame allocation): the candidate enemy
    // set plus a parallel per-enemy displacement accumulator. `_collectEnemy` is a
    // hoisted closure so forEachActive reuses one arrow instead of allocating per tick.
    // A nullish pool member is dropped here so the pull loops never have to re-check it.
    this._enemies = [];
    this._pullX = [];
    this._pullY = [];
    this._collectEnemy = (e) => {
      if (e == null || e.telegraphMs > 0) return;
      this._enemies.push(e);
    };
  }

  /**
   * Lv5 enemy pull: every orb in `orbs` nudges each candidate enemy toward it.
   *
   * Contributions are ACCUMULATED per enemy and then clamped to one orb's worth of
   * displacement (GRAVITY_WELL_PULL_STRENGTH · dtSec) before being applied. Without the
   * clamp the nudge sums over every orb in range — orbs drop at kill sites, never time
   * out, and routinely pile up, so an unclamped sum would let a heap of co-located orbs
   * displace an enemy faster than it can fly and shove it into the player. The clamp
   * makes a pile no stronger than a single orb.
   *
   * Each contribution is built from UNIT components (`dx/d`, `dy/d`) rather than from a
   * `pull/d` scale factor, for the reason NaniteShieldSystem._push documents: at a
   * DENORMAL separation `pull / d` overflows to Infinity and `0 * Infinity` is NaN,
   * which no later clamp can catch (every comparison against NaN is false). `dx/d` is
   * bounded by 1 for every d > 0, so the product stays finite. A squared-distance
   * reject runs BEFORE the sqrt, so the out-of-range majority never pays for one.
   *
   * The result is clamped back inside the arena INTERIOR, inset by the enemy's own
   * radius, following the same convention as NaniteShieldSystem._push — and with the
   * same per-axis rule: an axis is clamped ONLY when the enemy was already within that
   * bound beforehand, because enemies DO legitimately sit outside the border (SnakeSystem
   * trails body segments well outside it) and clamping one of those in would teleport it.
   * @private
   */
  _applyPull(orbs, dtSec) {
    const enemies = this._enemies;
    const pullX = this._pullX;
    const pullY = this._pullY;
    const n = enemies.length;
    pullX.length = 0;
    pullY.length = 0;
    for (let j = 0; j < n; j++) {
      pullX.push(0);
      pullY.push(0);
    }

    const radius = GRAVITY_WELL_PULL_RADIUS;
    const radiusSq = radius * radius;
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      for (let j = 0; j < n; j++) {
        const e = enemies[j];
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        const dSq = dx * dx + dy * dy;
        // Squared-distance reject first: no sqrt for the out-of-range majority. Also
        // covers d === 0 (an enemy exactly on an orb has no pull direction).
        if (!(dSq > 0) || dSq >= radiusSq) continue;
        const d = Math.sqrt(dSq);
        const mag = GRAVITY_WELL_PULL_STRENGTH * (1 - d / radius) * dtSec;
        pullX[j] += (dx / d) * mag;
        pullY[j] += (dy / d) * mag;
      }
    }

    // One orb's worth of displacement is the per-tick ceiling for any single enemy.
    const maxStep = GRAVITY_WELL_PULL_STRENGTH * dtSec;
    const maxStepSq = maxStep * maxStep;
    for (let j = 0; j < n; j++) {
      let px = pullX[j];
      let py = pullY[j];
      const magSq = px * px + py * py;
      if (!(magSq > 0)) continue;
      if (magSq > maxStepSq) {
        const scale = maxStep / Math.sqrt(magSq);
        px *= scale;
        py *= scale;
      }
      const e = enemies[j];
      const r = Number.isFinite(e.radius) ? e.radius : 0;
      const minX = ARENA_BORDER_INSET + r;
      const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - r;
      const minY = ARENA_BORDER_INSET + r;
      const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - r;
      let x = e.x + px;
      let y = e.y + py;
      // Clamp only the bounds the enemy started INSIDE (see the note above).
      if (x < minX) {
        if (e.x >= minX) x = minX;
      } else if (x > maxX) {
        if (e.x <= maxX) x = maxX;
      }
      if (y < minY) {
        if (e.y >= minY) y = minY;
      } else if (y > maxY) {
        if (e.y <= maxY) y = maxY;
      }
      e.x = x;
      e.y = y;
    }
  }

  _pickupRadiusMult() {
    const raw = this.playerStats?.xpPickupRadiusMult;
    return Number.isFinite(raw) && raw >= 1 ? raw : 1;
  }

  _gravityWellHoming() {
    const raw = this.playerStats?.gravityWellHoming;
    return Number.isFinite(raw) && raw >= 1;
  }

  _xpValueMult() {
    const raw = this.playerStats?.xpValueMult;
    return Number.isFinite(raw) && raw >= 1 ? raw : 1;
  }

  _gravityWellPullEnemies() {
    const raw = this.playerStats?.gravityWellPullEnemies;
    return Number.isFinite(raw) && raw >= 1;
  }

  /**
   * Advance one fixed step: drift/collect live orbs, then spawn this tick's drops.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    // A non-finite / non-positive dt yields a zero step rather than propagating NaN.
    // Pre-11.7 a NaN here could only corrupt orb positions, which the pool recycles;
    // the Lv5 pull writes POOLED ENEMY coordinates, where a NaN is permanent for the
    // run (collision, steering and rendering all degrade silently).
    const dtSec = Number.isFinite(dt) && dt > 0 ? dt / 1000 : 0;
    const ship = this.ship;
    const scoreState = this.scoreState;

    const radiusMult = this._pickupRadiusMult();
    const homingEnabled = this._gravityWellHoming();
    const xpValueMult = this._xpValueMult();
    const pullEnabled = this._gravityWellPullEnemies();

    const speed = homingEnabled ? GRAVITY_WELL_HOMING_SPEED : XP_ORB_DRIFT_SPEED;
    const pickupRadius = XP_PICKUP_RADIUS * radiusMult;

    // (1) Advance + collect. Materialize the active set first (releasing mid-
    //     iteration over the pool's active Set is unsafe), drift/collect in place,
    //     then release collected orbs in a second pass.
    const active = this._active;
    const expired = this._expired;
    active.length = 0;
    expired.length = 0;
    this.pool.forEachActive(this._collect);

    // (1a) Lv5 enemy pull, over the PRE-SPAWN snapshot so a fresh orb waits one tick
    //      before it can pull — the same grace the drift/collect pass gives it.
    if (pullEnabled && this.enemyPools && active.length > 0 && dtSec > 0) {
      const enemies = this._enemies;
      enemies.length = 0;
      for (let p = 0; p < this.enemyPools.length; p++) {
        const pool = this.enemyPools[p];
        if (pool) pool.forEachActive(this._collectEnemy);
      }
      if (enemies.length > 0) this._applyPull(active, dtSec);
    }

    if (ship && active.length > 0) {
      const collectR = SHIP_RADIUS + XP_ORB_RADIUS;
      const collectRSq = collectR * collectR;
      const pickupRSq = pickupRadius * pickupRadius;
      const step = speed * dtSec;
      const divisor = XP_MULTIPLIER_DIVISOR;
      for (let i = 0; i < active.length; i++) {
        const o = active[i];
        const dx = ship.x - o.x;
        const dy = ship.y - o.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= collectRSq) {
          // Collect: credit the fractional, collect-time-multiplier XP (accumulated
          // as a float — no rounding), scaled by xpValueMult, then release the orb to pool.
          scoreState.xp += o.value * xpValueMult * (1 + scoreState.multiplier / divisor);
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
            scoreState.xp += o.value * xpValueMult * (1 + scoreState.multiplier / divisor);
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

    // (3) Spawn this tick's drops from the three reports, honoring the cap. Advance-
    //     then-spawn: a fresh orb waits one tick before it can pull/drift/collect.

    // Player-damage kills (bullets, then the Story 10.5 dash sweep) — the recycle-safe
    // snapshots [0 .. bulletKillCount). The count
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
   * Public entry point to spawn a single XP orb (e.g. from Bomb Capacitor detonation).
   * Honors maxOrbs cap.
   * @param {number} x
   * @param {number} y
   * @param {number} value
   */
  spawnOrb(x, y, value = 1) {
    if (this.pool.activeCount >= this.maxOrbs) return null;
    return this._spawn(x, y, value);
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
