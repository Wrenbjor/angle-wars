import {
  PINWHEEL_RADIUS,
  PINWHEEL_SCORE,
  PINWHEEL_XP,
} from '../config/constants.js';

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
// Shape: { x, y, vx, vy, radius, score, xp, wanderMs }
//  - x, y     : position (px, arena/logical space)
//  - vx, vy   : velocity (px/s) — set on spawn to a random heading × drift speed,
//               then rotated by wander turns and reflected by wall bounces (the
//               magnitude |v| stays == PINWHEEL_DRIFT_SPEED throughout)
//  - radius   : half-extent (px) for the placeholder diamond and the circle-circle
//               bullet↔enemy / ship↔enemy collision (shared with the other seams)
//  - score    : base per-type value credited when this pinwheel is killed (read by
//               the ScoringSystem). Carried per-instance so scoring stays
//               type-agnostic across archetypes.
//  - xp       : base per-type XP value dropped as an orb when this pinwheel is
//               bullet-killed (Story 8.1). A SEPARATE economy from `score`,
//               carried per-instance like it.
//  - wanderMs : per-instance accumulator (ms) for the heading re-roll cadence.
//               Ignored by the shared collision/death/scoring seams.
//  - telegraphMs : spawn-telegraph countdown (ms, Story 2.6). While > 0 the
//               pinwheel is non-lethal to the player (PlayerDeathSystem skips it)
//               and frozen (PinwheelSystem skips its wander/drift/bounce tick);
//               it renders a spawn-in cue. Defaults to 0 (spawned-and-active);
//               PinwheelSystem.spawn overwrites it.
//  - _dashHitSeq : the Afterburner dash's ONE-HIT-PER-DASH stamp (Story 10.5).
//             LAZILY added by DashSystem's sweep on the first dash contact — it is
//             deliberately NOT initialized by this factory, so an instance that has
//             never been dash-hit simply lacks the field (`undefined` matches no
//             `dashSeq`, which starts at 1). Holds the `dashSeq` of the dash that
//             last hit this instance; the sweep skips any enemy already carrying the
//             CURRENT seq, so one press lands one hit even when a wall clamp holds
//             the ship still for the whole window. `dashSeq` only ever increases, so
//             a recycled instance can never carry a stale stamp into a later dash.

/**
 * Create a zeroed pinwheel with its collision radius, base score, a zeroed
 * wander accumulator, and inactive telegraph. Used as the Pool factory;
 * positional/velocity/wander/telegraph fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, score:number, xp:number, wanderMs:number, telegraphMs:number}}
 */
export function createPinwheel() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: PINWHEEL_RADIUS,
    score: PINWHEEL_SCORE,
    xp: PINWHEEL_XP,
    wanderMs: 0,
    telegraphMs: 0,
  };
}
