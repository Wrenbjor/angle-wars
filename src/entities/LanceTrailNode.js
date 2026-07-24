import {
  LANCE_TRAIL_NODE_RADIUS,
  LANCE_TRAIL_DAMAGE,
} from '../config/constants.js';

// LanceTrailNode — the pooled Piercing-Lance lingering damage node (plain data, Phaser-free;
// Story 11.4).
//
// A trail node is a pooled {x,y,radius,lifeMs,damage,hitSet} circle a Lv4+ trail-stamped bolt
// drops along its path every LANCE_TRAIL_DROP_MS. Each node lives LANCE_TRAIL_LIFETIME_MS
// (the "0.5s damage trail"), dealing LANCE_TRAIL_DAMAGE to each combat enemy that overlaps it
// — hitting each distinct enemy AT MOST ONCE (a per-node hitSet) — then expires. Unlike a
// bolt it is NOT consumed on a hit: it lingers and can chip several distinct enemies over its
// life. Nodes live in an object Pool (owned by PiercingLanceSystem), NOT in world.entities, so
// there is no splice/indexOf churn; the live node count is hard-bounded by LANCE_TRAIL_NODE_MAX
// (oldest evicted past the cap). This factory only builds an instance when the pool cannot
// recycle a freed one; the system STAMPS EVERY field in place on every drop.
//
// ⚠ SAME stale-carry-over warning as LanceBolt.js / DroneShot.js: `Pool.release` resets
// nothing, so a RECYCLED node still carries the PREVIOUS node's position / age / damage AND
// its populated `hitSet` until the dropping code overwrites them. PiercingLanceSystem stamps
// x/y/damage, resets lifeMs to 0, and `.clear()`s the hitSet on every drop — which is what
// makes the fields correct in practice. Any future node source MUST do the same.
//
// Shape: { x, y, radius, lifeMs, damage, hitSet }
//  - x, y    : position (px, arena/logical space) — the bolt's position at drop time.
//  - radius  : collision/render half-extent (px), the node↔enemy overlap term.
//  - lifeMs  : the node's age (ms), bumped by dt each step and reset to 0 on drop. A node
//              expires (is released) once lifeMs >= LANCE_TRAIL_LIFETIME_MS.
//  - damage  : the damage dealt to each overlapping combat enemy through
//              CollisionSystem.applyPlayerDamage (a PROJECTILE, armor-respecting). Stamped
//              per drop from LANCE_TRAIL_DAMAGE.
//  - hitSet  : the per-node Set of enemies this node has ALREADY hit, so it damages each
//              distinct enemy at most once over its life. A real Set built cold here;
//              `.clear()`ed (never reallocated) on every drop, so the steady path allocates
//              nothing.

/**
 * Create a zeroed trail node with its collision radius and base damage set, age 0, and a fresh
 * empty `hitSet`. Used as the Pool factory (COLD acquires only); every field is overwritten
 * (and the hitSet cleared) on drop.
 * @returns {{x:number, y:number, radius:number, lifeMs:number, damage:number, hitSet:Set<object>}}
 */
export function createLanceTrailNode() {
  return {
    x: 0,
    y: 0,
    radius: LANCE_TRAIL_NODE_RADIUS,
    lifeMs: 0,
    damage: LANCE_TRAIL_DAMAGE,
    hitSet: new Set(),
  };
}
