import { PINWHEEL_RADIUS, PINWHEEL_SCORE } from '../config/constants.js';

// Pinwheel — the pooled Pinwheel/Wanderer enemy (plain data, Phaser-free).
//
// The Pinwheel is Epic 2's "Wanderer" archetype: it spawns at a random arena
// edge with a random heading and drifts at a constant speed along a
// pseudo-random path — periodically re-rolling its heading by a bounded random
// turn and bouncing off the walls — INDIFFERENT to the player (it never reads
// the ship or bullets). Like the Seeker and Green Square it is a high-churn
// entity that lives in its OWN object Pool (owned by the PinwheelSystem), NOT in
// world.entities — no splice/indexOf churn. This factory only builds an instance
// when the pool cannot recycle a freed one; the PinwheelSystem (re)initializes
// the fields in place on every spawn, so the zeroed values here are just a
// well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius, score, wanderMs }
//  - x, y     : position (px, arena/logical space)
//  - vx, vy   : velocity (px/s) — set on spawn to a random heading × drift speed,
//               then rotated by wander turns and reflected by wall bounces (the
//               magnitude |v| stays == PINWHEEL_DRIFT_SPEED throughout)
//  - radius   : half-extent (px) for the placeholder diamond and the circle-circle
//               bullet↔enemy / ship↔enemy collision (shared with the other seams)
//  - score    : base per-type value credited when this pinwheel is killed (read by
//               the ScoringSystem). Carried per-instance so scoring stays
//               type-agnostic across archetypes.
//  - wanderMs : per-instance accumulator (ms) for the heading re-roll cadence.
//               Ignored by the shared collision/death/scoring seams.

/**
 * Create a zeroed pinwheel with its collision radius, base score, and a zeroed
 * wander accumulator. Used as the Pool factory; positional/velocity/wander fields
 * are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, score:number, wanderMs:number}}
 */
export function createPinwheel() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: PINWHEEL_RADIUS,
    score: PINWHEEL_SCORE,
    wanderMs: 0,
  };
}
