import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { pickSafeEdgePlacement } from './spawnPlacement.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  GREEN_SQUARE_RADIUS,
  GREEN_SQUARE_FLEE_SPEED,
  GREEN_SQUARE_CHASE_SPEED,
  GREEN_SQUARE_THREAT_RADIUS,
  GREEN_SQUARE_POOL_PREWARM,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
} from '../config/constants.js';

// GreenSquareSystem — Green Square flee/aggro behavior (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step (after the
// EnemySystem and firing, BEFORE the CollisionSystem — so a provoking latch is
// recorded before a hit can release the square), so behavior/threat are identical
// regardless of render frame rate. Owns its own green-square Pool (the single
// source of active/free truth — squares are NOT in world.entities; the pool is
// exposed for the collision/death systems and the renderer) and reads the shared
// bullet pool for threat detection.
//
// Each fixed step, per active square:
//   1. If not yet aggressive, test the square against every active bullet: if a
//      bullet center lies within GREEN_SQUARE_THREAT_RADIUS, latch aggro=true
//      (one-way — a provoked square stays aggressive for its lifetime).
//   2. Compute velocity toward the ship (aggro) or directly away (fleeing),
//      using the Seeker's unit-direction math with the coincident mag>0 guard.
//   3. Integrate position, then clamp into the arena inset bounds on each axis.
//
// This system NO LONGER self-spawns: the SpawnDirector is the sole spawn
// authority and drives the public `spawn()` (its old `_spawnOne`). Each spawn
// places one fleeing square (aggro=false).
//
// The steady-state path allocates nothing: the pool recycles freed instances,
// the prewarm builds the free list up front, and a reusable scratch array
// materializes the bullet active set once per tick (indexing a Set is not
// possible and re-closing over forEachActive per square would allocate).
export class GreenSquareSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The flee/home reference (read-only here —
   *   the ship is never a collider in this system, only a reference point).
   * @param {import('../core/Pool.js').Pool} bulletPool Active bullets, read only
   *   for threat detection (never mutated here).
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for spawn
   *   edge and placement; injectable so cadence/placement are unit-testable.
   */
  constructor(ship, bulletPool, rng = Math.random) {
    super();
    this.ship = ship;
    this.bulletPool = bulletPool;
    this._rng = rng;

    /** Pool of green squares — the single source of active/free truth (public
     *  for the collision/death systems and the renderer). */
    this.enemyPool = new Pool(createGreenSquare);
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the
    // instances land on the free stack.
    const warm = [];
    for (let i = 0; i < GREEN_SQUARE_POOL_PREWARM; i++) {
      warm.push(this.enemyPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.enemyPool.release(warm[i]);
    }

    // Reusable scratch: materialized active bullet set, refilled each tick.
    this._bullets = [];
  }

  /**
   * Advance one fixed step: threat/aggro + flee/home + integrate + clamp each
   * active square.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const ship = this.ship;

    // Materialize active bullets once into reusable scratch (no per-square alloc).
    const bullets = this._bullets;
    bullets.length = 0;
    this.bulletPool.forEachActive((b) => bullets.push(b));

    // Arena clamp bounds (inset by the radius so the square stays fully inside).
    const minX = ARENA_BORDER_INSET + GREEN_SQUARE_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - GREEN_SQUARE_RADIUS;
    const minY = ARENA_BORDER_INSET + GREEN_SQUARE_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - GREEN_SQUARE_RADIUS;

    const threatSq = GREEN_SQUARE_THREAT_RADIUS * GREEN_SQUARE_THREAT_RADIUS;

    this.enemyPool.forEachActive((s) => {
      // Story 2.6 telegraph gate: a spawning-in square is frozen (no threat/aggro
      // latch, no move) and non-lethal until its countdown reaches 0. Decrement
      // by the fixed-step dt (frame-rate-independent), clamp at 0, and skip the
      // behavior while still telegraphing. On the tick it reaches 0 it falls
      // through and behaves + becomes lethal this same tick.
      if (s.telegraphMs > 0) {
        s.telegraphMs -= dt;
        if (s.telegraphMs > 0) return; // still telegraphing → frozen
        s.telegraphMs = 0; // just activated → fall through to normal behavior
      }
      // 1. Threat detection (only while still fleeing — the latch is one-way).
      if (!s.aggro) {
        for (let i = 0; i < bullets.length; i++) {
          const b = bullets[i];
          const bx = b.x - s.x;
          const by = b.y - s.y;
          if (bx * bx + by * by <= threatSq) {
            s.aggro = true; // latched aggressive for the rest of its life
            break;
          }
        }
      }

      // 2. Velocity: toward the ship (aggro) or directly away (fleeing). The
      //    coincident mag>0 guard avoids a NaN direction (mirrors the Seeker).
      const dx = ship.x - s.x;
      const dy = ship.y - s.y;
      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        const speed = s.aggro ? GREEN_SQUARE_CHASE_SPEED : GREEN_SQUARE_FLEE_SPEED;
        const sign = s.aggro ? 1 : -1; // toward ship vs. away from ship
        const scale = (sign * speed) / mag;
        s.vx = dx * scale;
        s.vy = dy * scale;
      } else {
        // Coincident with the ship: no direction — zero velocity, no NaN.
        s.vx = 0;
        s.vy = 0;
      }

      // 3. Integrate, then clamp into the arena on each axis.
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      if (s.x < minX) s.x = minX;
      else if (s.x > maxX) s.x = maxX;
      if (s.y < minY) s.y = minY;
      else if (s.y > maxY) s.y = maxY;
    });
  }

  /**
   * Spawn one green square on a random arena edge, fully inside the drawn border
   * (the fixed axis pinned just inside the inset by the radius, the free axis
   * uniform along the edge). Story 2.6: the placement re-rolls (bounded) to keep
   * the point ≥ SPAWN_SAFE_RADIUS from the ship, and the fresh square starts
   * frozen + non-lethal for ENEMY_SPAWN_TELEGRAPH_MS. Spawns fleeing (aggro=false);
   * the next behavior pass sets its velocity. Public: the SpawnDirector is the
   * sole caller during a run, supplying the ship position as (avoidX, avoidY);
   * called with no avoid args the first roll is accepted (back-compat).
   * @param {number} [avoidX] Ship x to keep the spawn away from.
   * @param {number} [avoidY] Ship y to keep the spawn away from.
   */
  spawn(avoidX, avoidY) {
    const s = this.enemyPool.acquire();
    const p = pickSafeEdgePlacement(
      this._rng,
      GREEN_SQUARE_RADIUS,
      avoidX,
      avoidY,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    s.x = p.x;
    s.y = p.y;

    // Start at rest and unprovoked; the next behavior pass sets velocity.
    s.vx = 0;
    s.vy = 0;
    s.aggro = false;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
  }
}
