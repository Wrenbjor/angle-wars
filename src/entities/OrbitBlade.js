import { ORBIT_BLADE_RADIUS } from '../config/constants.js';

// OrbitBlade — the pooled rotating-blade entity (plain data, Phaser-free; Story 11.1).
//
// A blade is a pooled {x,y,radius} circle that OrbitBladeSystem spins around the ship.
// Blades live in an object Pool (owned by OrbitBladeSystem), NOT in world.entities, so
// there is no splice/indexOf churn and acquire/release only happen when the blade count
// changes (a card pick). This factory only builds an instance when the pool cannot
// recycle a freed one.
//
// ⚠ The system OVERWRITES `x/y` on every reposition (once per fixed step for each live
// blade), so a RECYCLED instance keeps its STALE coords until that first reposition — the
// zeroed values here are just a well-defined starting shape, not a position anything reads
// before the system has placed the blade. `radius` is set from ORBIT_BLADE_RADIUS and is
// never mutated (every blade is visually identical, so pool insertion order is irrelevant).
//
// Shape: { x, y, radius }
//  - x, y   : position (px, arena/logical space) — set each tick to ship ± the ring vector
//  - radius : collision/render half-extent (px), the blade↔enemy overlap term

/**
 * Create a zeroed blade with its collision radius set. Used as the Pool factory; the
 * system overwrites x/y on every reposition.
 * @returns {{x:number, y:number, radius:number}}
 */
export function createOrbitBlade() {
  return {
    x: 0,
    y: 0,
    radius: ORBIT_BLADE_RADIUS,
  };
}
