import { LANCE_BOLT_RADIUS, LANCE_BOLT_BASE_DAMAGE } from '../config/constants.js';

// LanceBolt — the pooled Piercing-Lance projectile (plain data, Phaser-free; Story 11.4).
//
// A lance bolt is a pooled {x,y,vx,vy,radius,damage,pierceRemaining,trail,trailAccumMs,
// hitSet} projectile the ship auto-fires on a cadence toward the nearest combat enemy. It is
// the first PIERCING projectile: unlike the base bullet (one bullet = at most one kill) and
// the Seeker-Drone shot (consumed on first hit), a bolt SURVIVES each hit and continues,
// punching through up to `pierceRemaining` distinct enemies before being released. Bolts are
// their OWN pooled type (owned by PiercingLanceSystem), deliberately NOT fed into the
// FiringSystem bullet pool: making the shared bullet pierce would make FiringSystem /
// CollisionSystem pierce-aware for one item and risk the v1 gun. PiercingLanceSystem owns
// their advance + collide, leaving the v1 firing/collision code byte-unchanged.
//
// This factory only builds an instance when the pool cannot recycle a freed one; the
// PiercingLanceSystem STAMPS EVERY field in place on every spawn (and CLEARS `hitSet`), so
// the values here are just a well-defined starting shape.
//
// ⚠ SAME stale-carry-over warning as DroneShot.js / Bullet.js: `Pool.release` resets
// nothing, so a RECYCLED bolt still carries the PREVIOUS bolt's velocity / damage / pierce /
// trail / age AND its populated `hitSet` until the spawning code overwrites them.
// PiercingLanceSystem stamps all of x/y/vx/vy/damage/pierceRemaining/trail, resets
// trailAccumMs to 0, and `.clear()`s the hitSet on every spawn — which is what makes the
// fields correct in practice. Any future bolt source MUST do the same (an un-cleared hitSet
// would make a recycled bolt refuse to hit enemies the PRIOR bolt already hit).
//
// Shape: { x, y, vx, vy, radius, damage, pierceRemaining, trail, trailAccumMs, hitSet }
//  - x, y            : position (px, arena/logical space).
//  - vx, vy          : velocity (px/s) — the aim-at-nearest direction × LANCE_BOLT_SPEED
//                      (Lv5's backward bolt is the antipode). Constant over the flight (no
//                      re-aim), which guarantees the bolt eventually leaves the arena.
//  - radius          : collision/render half-extent (px), the bolt↔enemy overlap term.
//  - damage          : damage dealt to each enemy through CollisionSystem.applyPlayerDamage
//                      (a PROJECTILE, so the armored archetype resists it). Stamped per spawn
//                      from the folded lanceDamage, so an in-flight bolt keeps the damage it
//                      was FIRED with — a mid-run upgrade never retroactively strengthens
//                      bolts on screen.
//  - pierceRemaining : distinct enemies the bolt may still punch through. Decremented once
//                      per distinct enemy hit; the bolt is released when it reaches 0.
//  - trail           : the per-bolt trail FLAG (>= 1 → drops LanceTrailNodes along its path).
//                      Stamped per spawn from the folded lanceTrail, so a bolt fired before a
//                      Lv4 upgrade leaves no trail.
//  - trailAccumMs    : the per-bolt trail-drop accumulator (ms), bumped by dt and drained one
//                      LANCE_TRAIL_DROP_MS per node dropped. Reset to 0 on spawn.
//  - hitSet          : the per-bolt Set of enemies this bolt has ALREADY hit, so it never
//                      hits — or spends a pierce charge on — the same enemy twice across the
//                      2–3 ticks it may overlap it. A real Set built cold here; `.clear()`ed
//                      (never reallocated) on every spawn, so the steady path allocates
//                      nothing.

/**
 * Create a zeroed lance bolt with its collision radius and base damage set, base pierce, no
 * trail, age 0, and a fresh empty `hitSet`. Used as the Pool factory (COLD acquires only);
 * every field is overwritten (and the hitSet cleared) on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, damage:number, pierceRemaining:number, trail:number, trailAccumMs:number, hitSet:Set<object>}}
 */
export function createLanceBolt() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: LANCE_BOLT_RADIUS,
    damage: LANCE_BOLT_BASE_DAMAGE,
    pierceRemaining: 0,
    trail: 0,
    trailAccumMs: 0,
    hitSet: new Set(),
  };
}
