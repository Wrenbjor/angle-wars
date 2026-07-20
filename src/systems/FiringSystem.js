import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIRE_INTERVAL_MS,
  BULLET_SPEED,
  BULLET_POOL_PREWARM,
} from '../config/constants.js';

// FiringSystem — continuous auto-fire + bullet flight (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, so the
// shots-per-second and bullet motion are identical regardless of render frame
// rate. Owns the bullet Pool (the single source of active/free truth — bullets
// are NOT in world.entities, to avoid splice/indexOf churn). Each fixed step it:
//   1. advances every active bullet and despawns any whose center has crossed
//      the arena border (back to the pool),
//   2. while the aim channel is active, accumulates dt and spawns one bullet per
//      FIRE_INTERVAL_MS in the aim direction from the ship nose.
//
// Bullet velocity comes ONLY from the aim direction × BULLET_SPEED — never the
// ship's velocity. That is the FR1 independence guarantee, by construction. The
// steady-state spawn/despawn path allocates nothing: the pool recycles freed
// instances and a reusable scratch array collects deferred releases.
export class FiringSystem extends System {
  /**
   * @param {{x:number,y:number,radius:number}} ship Aim origin (fire from nose).
   * @param {import('../input/InputState.js').InputState} inputState Aim channel.
   */
  constructor(ship, inputState) {
    super();
    this.ship = ship;
    this.input = inputState;

    /** Pool of bullets — the single source of active/free truth (public for
     *  Story 1.4 collision). */
    this.bulletPool = new Pool(createBullet);
    // Prewarm: build the free list up front so steady-state spawns never hit
    // the factory (no allocation once running). Acquire then release so the
    // instances land on the free stack.
    const warm = [];
    for (let i = 0; i < BULLET_POOL_PREWARM; i++) {
      warm.push(this.bulletPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.bulletPool.release(warm[i]);
    }

    // Reusable scratch buffer for deferred releases — Pool.forEachActive forbids
    // mutating the active set mid-iteration, so expired bullets are collected
    // here and released in a second pass. Reused every tick (no per-frame alloc).
    this._expired = [];
    // Fire-cadence accumulator (ms). Seeded to the interval so the first active
    // tick fires immediately (responsive), not after a full interval of delay.
    this._accumMs = FIRE_INTERVAL_MS;

    // Public read-only observability latch (Story 4.5): the number of bullets THIS
    // system spawned this tick. Reset at the top of every fixedUpdate (so an empty
    // tick reports 0 and a shot is never counted twice), then ++ per bullet spawned.
    // Read by the AudioDirectorSystem (fire SFX source) — mirrors
    // CollisionSystem.bulletKillCount. Purely observational: it never affects the
    // fire cadence, cap, mix, or placement.
    this.shotsFiredCount = 0;
  }

  /**
   * Advance one fixed step: integrate + despawn bullets, then spawn at cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const pool = this.bulletPool;

    // Reset the per-tick shots-fired report (Story 4.5) so a tick with no spawns
    // reports 0 and a prior tick's shots are never re-counted.
    this.shotsFiredCount = 0;

    // 1. Advance existing bullets; collect any that have left the arena. Runs
    //    even when aim is inactive so in-flight bullets keep travelling.
    this._expired.length = 0;
    pool.forEachActive((b) => {
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      if (isOutsideArena(b.x, b.y)) {
        this._expired.push(b);
      }
    });
    // Deferred release (second pass — safe to mutate the active set now).
    for (let i = 0; i < this._expired.length; i++) {
      pool.release(this._expired[i]);
    }

    // 2. Spawn at a fixed cadence while aiming; bullet velocity derives ONLY
    //    from the aim direction × BULLET_SPEED (never the ship's velocity).
    const input = this.input;
    if (input.aimActive) {
      this._accumMs += dt;
      while (this._accumMs >= FIRE_INTERVAL_MS) {
        const b = pool.acquire();
        // Emerge from the ship nose along the aim direction.
        b.x = this.ship.x + input.aimX * this.ship.radius;
        b.y = this.ship.y + input.aimY * this.ship.radius;
        b.vx = input.aimX * BULLET_SPEED;
        b.vy = input.aimY * BULLET_SPEED;
        this.shotsFiredCount++; // Story 4.5 read-only fire-event counter
        this._accumMs -= FIRE_INTERVAL_MS;
      }
    } else {
      // Reset so re-aiming fires at once with no accumulated backlog/burst.
      this._accumMs = FIRE_INTERVAL_MS;
    }
  }
}

/**
 * True when a point's center has crossed the drawn arena border (the inset
 * boundary) on any side.
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isOutsideArena(x, y) {
  return (
    x < ARENA_BORDER_INSET ||
    x > ARENA_WIDTH - ARENA_BORDER_INSET ||
    y < ARENA_BORDER_INSET ||
    y > ARENA_HEIGHT - ARENA_BORDER_INSET
  );
}
