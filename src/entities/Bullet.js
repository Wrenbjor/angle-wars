import { BULLET_RADIUS } from '../config/constants.js';

// Bullet — the pooled high-churn entity (plain data, Phaser-free).
//
// Bullets are the single highest-churn entity in the game: spawned and
// despawned many times per second. They live in an object Pool (owned by the
// FiringSystem), NOT in world.entities, so there is no splice/indexOf churn.
// This factory only builds an instance when the pool cannot recycle a freed
// one; the FiringSystem (re)initializes the fields in place on every acquire,
// so the zeroed values here are just a well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set from aim direction × BULLET_SPEED
//  - radius : half-extent (px) for the placeholder shape and Story 1.4
//             collision. NOT the spawn nose offset — the FiringSystem spawns
//             bullets from the ship's radius (SHIP_RADIUS), not this.

/**
 * Create a zeroed bullet with its collision radius set. Used as the Pool
 * factory; fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number}}
 */
export function createBullet() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: BULLET_RADIUS,
  };
}
