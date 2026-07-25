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
//   1. For every live orb: compute the ship distance. Within the collect radius
//      (SHIP_RADIUS + XP_ORB_RADIUS) → credit orb.value × xpValueMult × (1 + multiplier /
//      XP_MULTIPLIER_DIVISOR) using the multiplier AT COLLECT TIME (accumulated as a
//      float, no rounding) and collect it back to the pool. Else within
//      effective pickup radius → drift toward the ship by speed·dt (540 px/s if homing
//      enabled, else 320 px/s) — unless that step would reach or pass the ship, in which
//      case it collects this tick instead of overshooting. Else it stays put.
//   2. Spawn from the three reports, honoring the cap — a spawn that would exceed
//      XP_ORB_MAX is skipped this tick (the ParticleSystem precedent).
//   3. At Lv5, active orbs apply a position nudge to nearby non-telegraphing combat
//      enemies within GRAVITY_WELL_PULL_RADIUS (100px) toward the orb position.
//
// Bounded: live orbs never exceed the cap; the cap + pool reuse is the only bound
// (orbs never time out). Zero steady-state allocation.
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

    // Reusable enemy pull scratch arrays and hoisted functions (zero per-frame allocation).
    this._enemies = [];
    this._collectEnemy = (e) => {
      if (e && e.telegraphMs > 0) return;
      this._enemies.push(e);
    };
    this._dtSec = 0;
    this._applyPullFromOrb = (o) => {
      const enemies = this._enemies;
      const dtSec = this._dtSec;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < GRAVITY_WELL_PULL_RADIUS) {
          const pull = GRAVITY_WELL_PULL_STRENGTH * (1 - d / GRAVITY_WELL_PULL_RADIUS) * dtSec;
          const inv = pull / d;
          e.x += dx * inv;
          e.y += dy * inv;
        }
      }
    };
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
    const dtSec = dt / 1000;
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

    // (2) Spawn this tick's drops from the three reports, honoring the cap. Advance-
    //     then-spawn: a fresh orb waits one tick before it can drift/collect.

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

    // (3) Lv5 Enemy Pull: active orbs pull nearby non-telegraphing combat enemies inward.
    if (pullEnabled && this.enemyPools && ship && this.pool.activeCount > 0) {
      const enemies = this._enemies;
      enemies.length = 0;
      for (let p = 0; p < this.enemyPools.length; p++) {
        const pool = this.enemyPools[p];
        if (pool) {
          pool.forEachActive(this._collectEnemy);
        }
      }
      if (enemies.length > 0) {
        this._dtSec = dtSec;
        this.pool.forEachActive(this._applyPullFromOrb);
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

