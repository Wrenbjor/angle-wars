import { SEEKER_DRONE_RADIUS } from '../config/constants.js';

// SeekerDrone — the pooled autonomous-shooter entity (plain data, Phaser-free; Story
// 11.2).
//
// A drone is a pooled {x,y,radius,fireAccumMs} node that SeekerDroneSystem rides on an
// evenly-spaced ring around the ship. Drones live in an object Pool (owned by
// SeekerDroneSystem), NOT in world.entities, so there is no splice/indexOf churn and
// acquire/release only happen when the drone count changes (a card pick). This factory
// only builds an instance when the pool cannot recycle a freed one.
//
// ⚠ The system OVERWRITES `x/y` on every reposition (once per fixed step for each live
// drone), so a RECYCLED instance keeps its STALE coords until that first reposition — the
// zeroed values here are just a well-defined starting shape, not a position anything reads
// before the system has placed the drone. `fireAccumMs` is the drone's OWN fire-cadence
// accumulator (ms): the system SEEDS it (staggered across [0, period)) on acquire so
// growing the drone count does not make every drone fire the same tick, then accumulates
// dt into it each step and drains one shot per folded period. `radius` is set from
// SEEKER_DRONE_RADIUS and is never mutated (every drone is visually identical, so pool
// insertion order is irrelevant). Drones do NOT collide with enemies — only their SHOTS
// deal damage (see DroneShot.js) — so `radius` is render-only.
//
// Shape: { x, y, radius, fireAccumMs }
//  - x, y        : position (px, arena/logical space) — set each tick to ship + the ring vector
//  - radius      : render half-extent (px), the placeholder filled-dot size
//  - fireAccumMs : per-drone fire-cadence accumulator (ms) — seeded staggered on acquire,
//                  then advanced by dt and drained one shot per period each step

/**
 * Create a zeroed drone with its render radius set and its fire accumulator at 0. Used as
 * the Pool factory; the system overwrites x/y on every reposition and (re)seeds
 * fireAccumMs on acquire.
 * @returns {{x:number, y:number, radius:number, fireAccumMs:number}}
 */
export function createSeekerDrone() {
  return {
    x: 0,
    y: 0,
    radius: SEEKER_DRONE_RADIUS,
    fireAccumMs: 0,
    // Swarm Protocol (Story 12.7) — cooldown timer set on ram-kill.
    // When > 0, the drone is in cooldown until (simNowMs - lastKillTimeMs) >= SWARM_RESPAWN_MS.
    lastKillTimeMs: 0,
    // Whether this is a mini-drone spawned from a parent kill.
    isMini: false,
    // Spawn timestamp for mini-drone lifetime tracking (ms). Separate from lastKillTimeMs
    // to avoid field collision: parents use lastKillTimeMs for cooldown, mini-drones use
    // miniSpawnTimeMs for lifetime.
    miniSpawnTimeMs: 0,
    // Track how many mini-drones this entity was used as (for test assertions).
    miniSpawnCount: 0,
  };
}
