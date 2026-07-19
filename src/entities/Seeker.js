import { SEEKER_RADIUS } from '../config/constants.js';

// Seeker — the pooled Blue Seeker enemy (plain data, Phaser-free).
//
// Seekers are a high-churn entity: spawned at the arena edge and destroyed by
// bullets. They live in an object Pool (owned by the EnemySystem), NOT in
// world.entities, so there is no splice/indexOf churn — this mirrors the
// bullet-pool decision from Story 1.3. This factory only builds an instance when
// the pool cannot recycle a freed one; the EnemySystem (re)initializes the
// fields in place on every spawn, so the zeroed values here are just a
// well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set each tick from unit(ship − seeker) × SEEKER_SPEED
//  - radius : half-extent (px) for the placeholder shape and bullet↔enemy collision

/**
 * Create a zeroed seeker with its collision radius set. Used as the Pool
 * factory; fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number}}
 */
export function createSeeker() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: SEEKER_RADIUS,
  };
}
