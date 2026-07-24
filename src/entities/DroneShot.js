import {
  SEEKER_DRONE_SHOT_RADIUS,
  SEEKER_DRONE_BASE_DAMAGE,
} from '../config/constants.js';

// DroneShot — the pooled Seeker-Drone projectile (plain data, Phaser-free; Story 11.2).
//
// A drone shot is a pooled {x,y,vx,vy,radius,damage,homing,ageMs} projectile spawned by a
// drone toward the nearest combat enemy. Shots are their OWN pooled type (owned by
// SeekerDroneSystem), deliberately NOT fed into the FiringSystem bullet pool: they spawn
// from a drone (not the ship nose), carry their own damage, and at Lv4+ HOME (re-aim each
// tick) — folding that into the shared bullet pool would make FiringSystem/CollisionSystem
// homing-aware for one item. SeekerDroneSystem owns their advance + collide, leaving the
// v1 firing/collision code byte-unchanged.
//
// This factory only builds an instance when the pool cannot recycle a freed one; the
// SeekerDroneSystem STAMPS EVERY field in place on every spawn, so the values here are just
// a well-defined starting shape.
//
// ⚠ SAME stale-carry-over warning as Bullet.js: `Pool.release` resets nothing, so a
// RECYCLED shot still carries the PREVIOUS shot's velocity/damage/homing/age until the
// spawning code overwrites it. SeekerDroneSystem stamps all of x/y/vx/vy/damage/homing and
// resets ageMs to 0 on every spawn, which is what makes the fields correct in practice. Any
// future drone-shot source MUST do the same.
//
// Shape: { x, y, vx, vy, radius, damage, homing, ageMs }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set from the aim-at-nearest direction × SEEKER_DRONE_SHOT_SPEED
//  - radius : collision/render half-extent (px), the shot↔enemy overlap term
//  - damage : damage dealt to an enemy through CollisionSystem.applyPlayerDamage (a
//             PROJECTILE, so the armored archetype resists it). Stamped per spawn from the
//             folded seekerDroneDamage, so an in-flight shot keeps the damage it was FIRED
//             with — a mid-run upgrade never retroactively strengthens shots on screen.
//  - homing : the per-shot homing FLAG (>= 1 → re-aim toward the nearest enemy each tick).
//             Stamped per spawn from the folded seekerDroneHoming, so a shot fired before a
//             homing upgrade keeps flying straight — only shots fired AFTER Lv4 home.
//  - ageMs  : the shot's age (ms), bumped by dt each step and reset to 0 on spawn. A shot
//             expires at SEEKER_DRONE_SHOT_LIFETIME_MS — load-bearing for a homing shot that
//             never connects (it would otherwise never leave the arena).

/**
 * Create a zeroed drone shot with its collision radius and base damage set, homing off,
 * age 0. Used as the Pool factory (COLD acquires only); every field is overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, damage:number, homing:number, ageMs:number}}
 */
export function createDroneShot() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: SEEKER_DRONE_SHOT_RADIUS,
    damage: SEEKER_DRONE_BASE_DAMAGE,
    homing: 0,
    ageMs: 0,
  };
}
