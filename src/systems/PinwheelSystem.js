import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createPinwheel } from '../entities/Pinwheel.js';
import { pickSafeEdgePlacement } from './spawnPlacement.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  PINWHEEL_RADIUS,
  PINWHEEL_DRIFT_SPEED,
  PINWHEEL_WANDER_INTERVAL_MS,
  PINWHEEL_WANDER_MAX_TURN_RAD,
  PINWHEEL_POOL_PREWARM,
  PINK_SPLITTER_PARENT_RADIUS,
  PINK_SPLITTER_CHILD_RADIUS,
  PINK_SPLITTER_CHILD_COUNT,
  PINK_SPLITTER_PIVOT_SPEED,
  PINK_SPLITTER_ORBIT_RADIUS,
  PINK_SPLITTER_ORBIT_ANGULAR_SPEED,
  PINK_SPLITTER_CHILD_LIFETIME_MS,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
  CHRONO_SLOW_FACTOR_MAX,
} from '../config/constants.js';

// PinwheelSystem — Pinwheel/Wanderer wander + drift + wall-bounce (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step (after the other
// enemy systems, BEFORE the CollisionSystem), so wander cadence and drift are
// identical regardless of render frame rate. Owns its own pinwheel Pool (the
// single source of active/free truth — pinwheels are NOT in world.entities; the
// pool is exposed for the collision/death systems and the renderer).
//
// The Pinwheel is INDIFFERENT to the player: this system's constructor takes
// only an injectable rng — it never reads the ship or the bullet pool, and its
// trajectory never depends on player position. Each fixed step, per active
// pinwheel:
//   1. Wander: accumulate dt into the per-instance `wanderMs`; each time it
//      crosses PINWHEEL_WANDER_INTERVAL_MS, rotate the velocity vector by a
//      uniform random turn in [−MAX_TURN, +MAX_TURN]. Rotating preserves the
//      magnitude, so drift speed is constant.
//   2. Integrate position by v·dtSec.
//   3. Wall bounce: on crossing an inset bound, clamp the position back to the
//      bound AND negate that axis's velocity component (reflection, not a
//      park-at-the-wall clamp). Negation preserves the magnitude too.
//
// This system NO LONGER self-spawns: the SpawnDirector is the sole spawn
// authority and drives the public `spawn()` (its old `_spawnOne`), placing one
// pinwheel on a random arena edge with a random heading at the drift speed.
//
// The steady-state path allocates nothing: the pool recycles freed instances and
// the prewarm builds the free list up front.
export class PinwheelSystem extends System {
  /**
     * @param {Object<string, number>|() => number} [playerStatsOrRng] Shared
     *   runtime modifier store (Story 11.10: chronoSlowPercent), OR an
     *   `rng` function for backward compatibility with existing callers.
     * @param {() => number} [rng] Injectable RNG in [0,1) for the wander turn,
     *   spawn edge/placement, and spawn heading; injectable so the wander/cadence/
     *   placement are unit-testable.
     *   NO ship or bullet pool — the pinwheel is indifferent to the player.
     */
  constructor(playerStatsOrRng, rng = Math.random) {
    super();
    this._rng = rng;
    if (typeof playerStatsOrRng === 'function') {
      // Backward-compat: existing callers pass (rng) without playerStats.
      this._rng = playerStatsOrRng;
      this._playerStats = undefined;
    } else {
      this._playerStats = playerStatsOrRng;
    }
    // Intentionally no ship or bullet pool — the pinwheel is indifferent to the player.

    /** Pool of pinwheels — the single source of active/free truth (public for
     *  the collision/death systems and the renderer). */
    this.enemyPool = new Pool(createPinwheel);
    this.collisionSystem = null;
    this._seenKills = new Set();
    this._expiredChildren = [];
    this._splitSnapshots = [];
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the
    // instances land on the free stack.
    const warm = [];
    for (let i = 0; i < PINWHEEL_POOL_PREWARM; i++) {
      warm.push(this.enemyPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.enemyPool.release(warm[i]);
    }
  }

  /**
   * Advance one fixed step: wander + integrate + wall-reflect each active
   * pinwheel.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const slowFactor = this._slowPercent();
    const killed = this.collisionSystem?.killedEnemies;
    if (killed) {
      const snapshots = this._splitSnapshots;
      snapshots.length = 0;
      for (let i = 0; i < killed.length; i++) {
        const parent = killed[i];
        if (parent.isPinkSplitter && !parent.isSplitterChild) {
          snapshots.push(parent.x, parent.y, parent.vx, parent.vy);
        }
      }
      for (let i = 0; i < snapshots.length; i += 4) {
        this._split(snapshots[i], snapshots[i + 1], snapshots[i + 2], snapshots[i + 3]);
      }
    }

    // Arena bounce bounds (inset by the radius so the pinwheel stays fully inside).
    const minX = ARENA_BORDER_INSET + PINWHEEL_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - PINWHEEL_RADIUS;
    const minY = ARENA_BORDER_INSET + PINWHEEL_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - PINWHEEL_RADIUS;

    const expired = this._expiredChildren;
    expired.length = 0;
    this.enemyPool.forEachActive((pw) => {
      // Story 2.6 telegraph gate: a spawning-in pinwheel is frozen (no wander
      // re-roll, no drift, no bounce) and non-lethal until its countdown reaches
      // 0. Decrement by the fixed-step dt (frame-rate-independent), clamp at 0,
      // and skip the behavior while still telegraphing. On the tick it reaches 0
      // it falls through and drifts + becomes lethal this same tick.
      if (pw.telegraphMs > 0) {
        pw.telegraphMs -= dt;
        if (pw.telegraphMs > 0) return; // still telegraphing → frozen
        pw.telegraphMs = 0; // just activated → fall through to normal behavior
      }
      if (pw.stunMs > 0) {
        pw.stunMs -= dt;
        if (pw.stunMs > 0) {
          pw.vx = 0;
          pw.vy = 0;
          return; // stunned → frozen position/velocity
        }
        pw.stunMs = 0;
      }
      if (pw.isSplitterChild) {
        pw.lifeMs -= dt;
        if (pw.lifeMs <= 0) {
          expired.push(pw);
          return;
        }
        pw.pivotX += pw.pivotVx * dtSec * (1 - slowFactor);
        pw.pivotY += pw.pivotVy * dtSec * (1 - slowFactor);
        const orbitInset = PINK_SPLITTER_CHILD_RADIUS + PINK_SPLITTER_ORBIT_RADIUS;
        const pivotMinX = ARENA_BORDER_INSET + orbitInset;
        const pivotMaxX = ARENA_WIDTH - ARENA_BORDER_INSET - orbitInset;
        const pivotMinY = ARENA_BORDER_INSET + orbitInset;
        const pivotMaxY = ARENA_HEIGHT - ARENA_BORDER_INSET - orbitInset;
        if (pw.pivotX < pivotMinX) { pw.pivotX = pivotMinX; pw.pivotVx = Math.abs(pw.pivotVx); }
        else if (pw.pivotX > pivotMaxX) { pw.pivotX = pivotMaxX; pw.pivotVx = -Math.abs(pw.pivotVx); }
        if (pw.pivotY < pivotMinY) { pw.pivotY = pivotMinY; pw.pivotVy = Math.abs(pw.pivotVy); }
        else if (pw.pivotY > pivotMaxY) { pw.pivotY = pivotMaxY; pw.pivotVy = -Math.abs(pw.pivotVy); }
        pw.orbitAngle += PINK_SPLITTER_ORBIT_ANGULAR_SPEED * dtSec;
        pw.x = pw.pivotX + Math.cos(pw.orbitAngle) * PINK_SPLITTER_ORBIT_RADIUS;
        pw.y = pw.pivotY + Math.sin(pw.orbitAngle) * PINK_SPLITTER_ORBIT_RADIUS;
        return;
      }
      // 1. Wander: re-roll the heading each time the per-instance accumulator
      //    crosses the interval. Rotating the velocity vector preserves |v|, so
      //    the drift speed stays constant (never recomputed from an angle).
      pw.wanderMs += dt;
      while (pw.wanderMs >= PINWHEEL_WANDER_INTERVAL_MS) {
        const theta = (this._rng() * 2 - 1) * PINWHEEL_WANDER_MAX_TURN_RAD;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const nvx = pw.vx * c - pw.vy * s;
        const nvy = pw.vx * s + pw.vy * c;
        pw.vx = nvx;
        pw.vy = nvy;
        pw.wanderMs -= PINWHEEL_WANDER_INTERVAL_MS;
      }

      // 2. Integrate straight-line by the fixed-step dt (frame-rate-independent).
      pw.x += pw.vx * dtSec * (1 - slowFactor);
      pw.y += pw.vy * dtSec * (1 - slowFactor);

      // 3. Wall bounce: clamp to the crossed bound and reflect that component
      //    (negating preserves |v|). Corners reflect both axes independently.
      //    After reflection, nudge heading toward arena center (DW-12) so a
      //    grazing pinwheel peels off the border promptly instead of sliding.
      let bounced = false;
      if (pw.x < minX) {
        pw.x = minX;
        pw.vx = -pw.vx;
        bounced = true;
      } else if (pw.x > maxX) {
        pw.x = maxX;
        pw.vx = -pw.vx;
        bounced = true;
      }
      if (pw.y < minY) {
        pw.y = minY;
        pw.vy = -pw.vy;
        bounced = true;
      } else if (pw.y > maxY) {
        pw.y = maxY;
        pw.vy = -pw.vy;
        bounced = true;
      }
      // DW-12: 25% centerward drift blend on wall bounce to prevent wall-hug.
      // The nudge is purely geometric (arena center), not player-tracking.
      if (bounced) {
        const cx = ARENA_WIDTH / 2 - pw.x;
        const cy = ARENA_HEIGHT / 2 - pw.y;
        const dist = Math.hypot(cx, cy);
        if (dist > 0) {
          const ndx = (cx / dist) * PINWHEEL_DRIFT_SPEED * 0.25;
          const ndy = (cy / dist) * PINWHEEL_DRIFT_SPEED * 0.25;
          pw.vx = pw.vx * 0.75 + ndx;
          pw.vy = pw.vy * 0.75 + ndy;
          // Normalize back to exact drift speed.
          const speed = Math.hypot(pw.vx, pw.vy);
          if (speed > 0) {
            const scale = PINWHEEL_DRIFT_SPEED / speed;
            pw.vx *= scale;
            pw.vy *= scale;
          }
        }
      }
    });
    for (let i = 0; i < expired.length; i++) this.enemyPool.release(expired[i]);
  }

  /**
    * Sanitize the chrono slow percent from the shared player-stats store.
    * Returns 0 when no playerStats; clamps to [0, CHRONO_SLOW_FACTOR_MAX].
    * @returns {number}
    * @private
    */
  _slowPercent() {
    const ps = this._playerStats;
    if (!ps) return 0;
    const raw = ps.chronoSlowPercent;
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.min(raw, CHRONO_SLOW_FACTOR_MAX);
  }

  /**
   * Spawn one pinwheel on a random arena edge, fully inside the drawn border (the
   * fixed axis pinned just inside the inset by the radius, the free axis uniform
   * along the edge). Story 2.6: the placement re-rolls (bounded) to keep the point
   * ≥ SPAWN_SAFE_RADIUS from the ship, and the fresh pinwheel starts frozen +
   * non-lethal for ENEMY_SPAWN_TELEGRAPH_MS. Its heading is a uniform random angle
   * at the drift speed (so |v| == PINWHEEL_DRIFT_SPEED), and its wander accumulator
   * is reset to 0. Public: the SpawnDirector is the sole caller during a run,
   * supplying the ship position as (avoidX, avoidY); the avoid point is a spawn()
   * ARGUMENT only — the Pinwheel stores no ship and stays player-indifferent in its
   * motion. Called with no avoid args the first roll is accepted (back-compat).
   * @param {number} [avoidX] Ship x to keep the spawn away from.
   * @param {number} [avoidY] Ship y to keep the spawn away from.
   */
  spawn(avoidX, avoidY) {
    const pw = this.enemyPool.acquire();
    // Edge placement (edge draw + position draw, re-rolled to avoid the ship),
    // then a third rng draw for the heading — same draw order as pre-2.6.
    const p = pickSafeEdgePlacement(
      this._rng,
      PINWHEEL_RADIUS,
      avoidX,
      avoidY,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    pw.x = p.x;
    pw.y = p.y;

    // Random heading at the constant drift speed. |v| is exactly
    // PINWHEEL_DRIFT_SPEED; the wander/bounce only rotate/reflect it thereafter.
    const angle = this._rng() * Math.PI * 2;
    pw.vx = Math.cos(angle) * PINWHEEL_DRIFT_SPEED;
    pw.vy = Math.sin(angle) * PINWHEEL_DRIFT_SPEED;

    // Fresh wander cadence for a (possibly recycled) instance.
    pw.wanderMs = 0;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    pw.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
    pw.stunMs = 0;
    pw.radius = PINK_SPLITTER_PARENT_RADIUS;
    pw.isPinkSplitter = true;
    pw.isSplitterChild = false;
    pw.lifeMs = 0;
  }

  _split(x, y, vx, vy) {
    let mag = Math.hypot(vx, vy);
    if (!(mag > 0)) { vx = PINK_SPLITTER_PIVOT_SPEED; vy = 0; mag = PINK_SPLITTER_PIVOT_SPEED; }
    const pvx = (vx / mag) * PINK_SPLITTER_PIVOT_SPEED;
    const pvy = (vy / mag) * PINK_SPLITTER_PIVOT_SPEED;
    for (let i = 0; i < PINK_SPLITTER_CHILD_COUNT; i++) {
      const child = this.enemyPool.acquire();
      child.isPinkSplitter = true;
      child.isSplitterChild = true;
      child.radius = PINK_SPLITTER_CHILD_RADIUS;
      child.pivotX = x;
      child.pivotY = y;
      child.pivotVx = pvx;
      child.pivotVy = pvy;
      child.orbitAngle = (i / PINK_SPLITTER_CHILD_COUNT) * Math.PI * 2;
      child.lifeMs = PINK_SPLITTER_CHILD_LIFETIME_MS;
      child.telegraphMs = 0;
      child.stunMs = 0;
      child.x = x + Math.cos(child.orbitAngle) * PINK_SPLITTER_ORBIT_RADIUS;
      child.y = y + Math.sin(child.orbitAngle) * PINK_SPLITTER_ORBIT_RADIUS;
      child.vx = 0;
      child.vy = 0;
      child.score = 0;
      child.xp = 0;
    }
  }
}
