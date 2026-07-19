import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { pickSafeEdgePlacement } from './spawnPlacement.js';
import {
  SEEKER_SPEED,
  SEEKER_RADIUS,
  SEEKER_POOL_PREWARM,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
} from '../config/constants.js';

// EnemySystem — Blue Seeker homing (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, so homing speed
// is identical regardless of render frame rate. Owns the enemy Pool (the single
// source of active/free truth — seekers are NOT in world.entities, to avoid
// splice/indexOf churn; the pool is exposed for the collision system and the
// renderer). Each fixed step it homes + integrates every active seeker toward the
// ship's CURRENT position at a constant speed (recomputed each tick, so it tracks
// a moving player).
//
// This system NO LONGER self-spawns: the SpawnDirector is the sole spawn
// authority and drives the public `spawn()` (its old `_spawnOne`). The
// director owns WHEN and WHICH; this system owns only movement + placement.
//
// The steady-state path allocates nothing: the pool recycles freed instances and
// the prewarm builds the free list up front.
export class EnemySystem extends System {
  /**
   * @param {{x:number,y:number}} ship The homing target (read-only here — the
   *   ship is never a collider in this story, only a target).
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for spawn
   *   edge and placement; injectable so cadence/placement are unit-testable.
   */
  constructor(ship, rng = Math.random) {
    super();
    this.ship = ship;
    this._rng = rng;

    /** Pool of seekers — the single source of active/free truth (public for
     *  the collision system and the renderer). */
    this.enemyPool = new Pool(createSeeker);
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the
    // instances land on the free stack.
    const warm = [];
    for (let i = 0; i < SEEKER_POOL_PREWARM; i++) {
      warm.push(this.enemyPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.enemyPool.release(warm[i]);
    }
  }

  /**
   * Advance one fixed step: home + integrate every active seeker toward the ship.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const ship = this.ship;

    // 1. Home + integrate each active seeker toward the ship's CURRENT position.
    //    Velocity is recomputed every tick so it continuously tracks a moving
    //    player; each seeker tracks independently.
    this.enemyPool.forEachActive((s) => {
      // Story 2.6 telegraph gate: a spawning-in seeker is frozen (no homing) and
      // non-lethal until its countdown reaches 0. Decrement by the fixed-step dt
      // (frame-rate-independent), clamp at 0, and skip the homing while still
      // telegraphing. On the tick it reaches 0 it falls through and homes +
      // becomes lethal this same tick (movers run before PlayerDeathSystem).
      if (s.telegraphMs > 0) {
        s.telegraphMs -= dt;
        if (s.telegraphMs > 0) return; // still telegraphing → frozen
        s.telegraphMs = 0; // just activated → fall through to normal homing
      }
      const dx = ship.x - s.x;
      const dy = ship.y - s.y;
      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        const inv = SEEKER_SPEED / mag;
        s.vx = dx * inv;
        s.vy = dy * inv;
      } else {
        // Coincident with the ship: no direction — zero velocity, no NaN.
        s.vx = 0;
        s.vy = 0;
      }
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
    });
  }

  /**
   * Spawn one seeker on a random arena edge, fully inside the drawn border (the
   * fixed axis pinned just inside the inset by the radius, the free axis uniform
   * along the edge). Story 2.6: the placement re-rolls (bounded) to keep the
   * point ≥ SPAWN_SAFE_RADIUS from the ship, and the fresh seeker starts frozen +
   * non-lethal for ENEMY_SPAWN_TELEGRAPH_MS. Public: the SpawnDirector is the
   * sole caller during a run, supplying the ship position as (avoidX, avoidY);
   * called with no avoid args the first roll is accepted (back-compat).
   * @param {number} [avoidX] Ship x to keep the spawn away from.
   * @param {number} [avoidY] Ship y to keep the spawn away from.
   */
  spawn(avoidX, avoidY) {
    const s = this.enemyPool.acquire();
    const p = pickSafeEdgePlacement(
      this._rng,
      SEEKER_RADIUS,
      avoidX,
      avoidY,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    s.x = p.x;
    s.y = p.y;

    // Start at rest; the next home pass sets velocity toward the ship.
    s.vx = 0;
    s.vy = 0;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
  }
}
