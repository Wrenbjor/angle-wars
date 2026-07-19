import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SEEKER_SPEED,
  SEEKER_RADIUS,
  SEEKER_SPAWN_INTERVAL_MS,
  SEEKER_POOL_PREWARM,
} from '../config/constants.js';

// EnemySystem — Blue Seeker homing + spawn cadence (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, so homing speed
// and spawn cadence are identical regardless of render frame rate. Owns the
// enemy Pool (the single source of active/free truth — seekers are NOT in
// world.entities, to avoid splice/indexOf churn; the pool is exposed for the
// collision system and the renderer). Each fixed step it:
//   1. homes + integrates every active seeker toward the ship's CURRENT position
//      at a constant speed (recomputed each tick, so it tracks a moving player),
//   2. accumulates dt and spawns one seeker per SEEKER_SPAWN_INTERVAL_MS on a
//      random arena edge via an injectable rng.
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

    // Spawn-cadence accumulator (ms). Starts at 0 so the first seeker spawns
    // after one full interval (ungated — spawning does not depend on any input).
    this._accumMs = 0;
  }

  /**
   * Advance one fixed step: home + integrate seekers, then spawn at cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const ship = this.ship;

    // 1. Home + integrate each active seeker toward the ship's CURRENT position.
    //    Velocity is recomputed every tick so it continuously tracks a moving
    //    player; each seeker tracks independently.
    this.enemyPool.forEachActive((s) => {
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

    // 2. Spawn at a constant cadence. Unlike firing this is ungated (no input
    //    channel), so it always accumulates.
    this._accumMs += dt;
    while (this._accumMs >= SEEKER_SPAWN_INTERVAL_MS) {
      this._spawnOne();
      this._accumMs -= SEEKER_SPAWN_INTERVAL_MS;
    }
  }

  /**
   * Spawn one seeker on a random arena edge, fully inside the drawn border: the
   * fixed axis is pinned just inside the inset (by the radius), the free axis is
   * uniformly random within [inset+radius, dim−inset−radius].
   * @private
   */
  _spawnOne() {
    const s = this.enemyPool.acquire();

    // Free-axis bounds, shared by both orientations.
    const minX = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SEEKER_RADIUS;
    const minY = ARENA_BORDER_INSET + SEEKER_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SEEKER_RADIUS;

    // Choose one of four edges. First rng draw picks the edge, second the
    // position along it.
    const edge = Math.floor(this._rng() * 4); // 0=top,1=bottom,2=left,3=right
    const t = this._rng();
    if (edge === 0) {
      s.x = minX + t * (maxX - minX);
      s.y = minY;
    } else if (edge === 1) {
      s.x = minX + t * (maxX - minX);
      s.y = maxY;
    } else if (edge === 2) {
      s.x = minX;
      s.y = minY + t * (maxY - minY);
    } else {
      s.x = maxX;
      s.y = minY + t * (maxY - minY);
    }

    // Start at rest; the next home pass sets velocity toward the ship.
    s.vx = 0;
    s.vy = 0;
  }
}
