import {
  MINE_RADIUS,
  MINE_ARM_MS,
  MINE_BASE_DETONATE_RADIUS,
  MINE_DETONATE_DAMAGE,
} from '../config/constants.js';

// Mine — the pooled timed-mine entity (plain data, Phaser-free; Story 11.3).
//
// A mine is a pooled {x,y,radius,ageMs,armMs,detonateRadius,damage,pull,chain} circle the
// kiting ship drops in its wake. MineLayerSystem ages it (ageMs += dt) until it ARMS
// (ageMs >= armMs), then DETONATES it when a combat enemy enters its blast — dealing full
// AoE damage through the shared CollisionSystem.applyPlayerDamage seam. Mines live in an
// object Pool (owned by MineLayerSystem), NOT in world.entities, so there is no
// splice/indexOf churn and acquire/release only happen on a drop, a detonation, or a
// cap-eviction. This factory only builds an instance when the pool cannot recycle a freed
// one; the system STAMPS EVERY field in place on every drop.
//
// ⚠ SAME stale-carry-over warning as DroneShot.js / Bullet.js: `Pool.release` resets
// nothing, so a RECYCLED mine still carries the PREVIOUS mine's position/age/radius/
// pull/chain until the dropping code overwrites it. MineLayerSystem stamps all of
// x/y/detonateRadius/damage/pull/chain/armMs and resets ageMs to 0 on every drop, which is
// what makes the fields correct in practice. Any future mine source MUST do the same.
//
// Per-mine STAMPING (the drone-shot convention): detonateRadius / pull / chain / damage /
// armMs are captured at DROP time from the fold, so a mine laid at Lv1 keeps its
// 60r/no-pull/no-chain shape even after a later upgrade — a mid-run upgrade only
// strengthens NEW mines, never the ones already on the ground.
//
// Shape: { x, y, radius, ageMs, armMs, detonateRadius, damage, pull, chain }
//  - x, y           : position (px, arena/logical space) — the ship's wake at drop.
//  - radius         : collision/render half-extent (px) of the mine body itself.
//  - ageMs          : the mine's age (ms), bumped by dt each step and reset to 0 on drop.
//                     A mine is ARMED once ageMs >= armMs (inert until then).
//  - armMs          : the arm delay (ms) stamped from MINE_ARM_MS at drop.
//  - detonateRadius : the blast radius (px) — enemies within detonateRadius + enemy.radius
//                     of an armed mine trigger + take the detonation. Stamped per drop.
//  - damage         : the detonation damage dealt to every enemy in the blast through
//                     CollisionSystem.applyPlayerDamage (AoE, full damage vs armor).
//  - pull           : the per-mine pull FLAG (>= 1 → an armed mine drags nearby enemies
//                     inward). Stamped per drop from the folded minePull.
//  - chain          : the per-mine chain FLAG (>= 1 → this mine's detonation chains to
//                     adjacent armed mines). Stamped per drop from the folded mineChain.

/**
 * Create a zeroed mine with its body radius, arm delay, base detonate radius and base
 * damage set, pull/chain off, age 0. Used as the Pool factory (COLD acquires only); every
 * field is overwritten on drop.
 * @returns {{x:number, y:number, radius:number, ageMs:number, armMs:number, detonateRadius:number, damage:number, pull:number, chain:number}}
 */
export function createMine() {
  return {
    x: 0,
    y: 0,
    radius: MINE_RADIUS,
    ageMs: 0,
    armMs: MINE_ARM_MS,
    detonateRadius: MINE_BASE_DETONATE_RADIUS,
    damage: MINE_DETONATE_DAMAGE,
    pull: 0,
    chain: 0,
  };
}
