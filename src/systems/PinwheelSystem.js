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
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
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
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for the
   *   wander turn, spawn edge/placement, and spawn heading; injectable so the
   *   wander/cadence/placement are unit-testable. NO ship or bullet pool — the
   *   pinwheel is indifferent to the player.
   */
  constructor(rng = Math.random) {
    super();
    this._rng = rng;

    /** Pool of pinwheels — the single source of active/free truth (public for
     *  the collision/death systems and the renderer). */
    this.enemyPool = new Pool(createPinwheel);
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

    // Arena bounce bounds (inset by the radius so the pinwheel stays fully inside).
    const minX = ARENA_BORDER_INSET + PINWHEEL_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - PINWHEEL_RADIUS;
    const minY = ARENA_BORDER_INSET + PINWHEEL_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - PINWHEEL_RADIUS;

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
      pw.x += pw.vx * dtSec;
      pw.y += pw.vy * dtSec;

      // 3. Wall bounce: clamp to the crossed bound and reflect that component
      //    (negating preserves |v|). Corners reflect both axes independently.
      if (pw.x < minX) {
        pw.x = minX;
        pw.vx = -pw.vx;
      } else if (pw.x > maxX) {
        pw.x = maxX;
        pw.vx = -pw.vx;
      }
      if (pw.y < minY) {
        pw.y = minY;
        pw.vy = -pw.vy;
      } else if (pw.y > maxY) {
        pw.y = maxY;
        pw.vy = -pw.vy;
      }
    });
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
  }
}
