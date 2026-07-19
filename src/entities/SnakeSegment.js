import { SNAKE_SEGMENT_RADIUS, SNAKE_SEGMENT_SCORE } from '../config/constants.js';

// SnakeSegment — one pooled segment of a Snake (plain data, Phaser-free).
//
// The Snake (Epic 2's large threat) is a chain of these uniform segments that
// trails a self-propelled slithering head. Head and body share this exact shape:
// the head is just segments[0]. The per-snake head-motion state (base heading and
// slither phase) lives on the SnakeSystem's snake struct, NOT on the segment, so
// every segment — head included — is a plain {x,y,vx,vy,radius,score} instance
// that plugs into the shared collision/death/scoring seams with no special-casing.
//
// Segments are high-churn (spawned in bunches, destroyed one hit at a time), so
// they live in ONE shared object Pool owned by the SnakeSystem, NOT in
// world.entities — no splice/indexOf churn. This factory only builds an instance
// when the pool cannot recycle a freed one; the SnakeSystem (re)initializes the
// position on every spawn, so the zeroed values here are just a well-defined
// starting shape.
//
// Shape: { x, y, vx, vy, radius, score }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s). Unused for motion — the head is integrated from the
//             snake's slither state and the body is a geometric position
//             constraint — but kept so the shape is IDENTICAL to the other
//             archetypes' instances that flow through the shared seams.
//  - radius : half-extent (px) for the placeholder circle and the circle-circle
//             bullet↔enemy / ship↔enemy collision (shared with the other seams).
//  - score  : base per-segment value credited when this segment is killed (read by
//             the ScoringSystem). Carried per-instance so scoring stays
//             type-agnostic across archetypes.

/**
 * Create a zeroed snake segment with its collision radius and base score. Used as
 * the shared segment Pool factory; the positional fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, score:number}}
 */
export function createSnakeSegment() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: SNAKE_SEGMENT_RADIUS,
    score: SNAKE_SEGMENT_SCORE,
  };
}
