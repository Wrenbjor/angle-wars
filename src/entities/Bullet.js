import { BULLET_RADIUS, PLAYER_BULLET_BASE_DAMAGE } from '../config/constants.js';

// Bullet — the pooled high-churn entity (plain data, Phaser-free).
//
// Bullets are the single highest-churn entity in the game: spawned and
// despawned many times per second. They live in an object Pool (owned by the
// FiringSystem), NOT in world.entities, so there is no splice/indexOf churn.
// This factory only builds an instance when the pool cannot recycle a freed
// one; the FiringSystem (re)initializes the fields in place on every acquire,
// so the zeroed values here are just a well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius, damage }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set from aim direction × BULLET_SPEED
//  - radius : half-extent (px) for the placeholder shape and Story 1.4
//             collision. NOT the spawn nose offset — the FiringSystem spawns
//             bullets from the ship's radius (SHIP_RADIUS), not this.
//  - damage : damage dealt to a finite-`hp` enemy; stamped per spawn by
//             `FiringSystem` from `base × damageMult` (Story 10.2). Carried on the
//             instance so an in-flight bullet keeps the damage it was FIRED with —
//             a mid-run upgrade never retroactively strengthens bullets already on
//             screen.
//
//             The value set below is ONLY the cold-instance default: the Pool
//             factory runs on a COLD acquire, and `Pool.release` resets nothing, so
//             a RECYCLED bullet still carries the PREVIOUS shot's damage until the
//             spawning code overwrites it. `FiringSystem` stamps `damage` on every
//             spawn, which is what makes the field correct in practice.
//
//             ⚠ ANY future bullet source (Story 10.3's Spread Cannon, and anything
//             else acquiring from this pool) MUST stamp `damage` at acquire. A stale
//             carry-over is finite and positive, so it passes `CollisionSystem`'s
//             `Number.isFinite(b.damage) && b.damage > 0` fallback undetected — the
//             collision side CANNOT catch this for you, and the symptom is a bullet
//             silently dealing some earlier shot's damage.

/**
 * Create a zeroed bullet with its collision radius and base damage set. Used as the
 * Pool factory (COLD acquires only); fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, damage:number}}
 */
export function createBullet() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: BULLET_RADIUS,
    damage: PLAYER_BULLET_BASE_DAMAGE,
  };
}
