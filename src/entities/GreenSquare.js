import { GREEN_SQUARE_RADIUS, GREEN_SQUARE_SCORE } from '../config/constants.js';

// GreenSquare — the pooled Green Square enemy (plain data, Phaser-free).
//
// The Green Square is Epic 2's first archetype: it flees directly away from the
// ship until an active bullet passes near it, then latches to aggressive and
// homes toward the ship for the rest of its life. Like the Seeker it is a
// high-churn entity that lives in its OWN object Pool (owned by the
// GreenSquareSystem), NOT in world.entities — no splice/indexOf churn. This
// factory only builds an instance when the pool cannot recycle a freed one; the
// GreenSquareSystem (re)initializes the fields in place on every spawn, so the
// zeroed values here are just a well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius, score, aggro }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set each tick from the flee/home direction
//  - radius : half-extent (px) for the placeholder square and circle-circle
//             bullet↔enemy / ship↔enemy collision (shared with the Seeker seams)
//  - score  : base per-type value credited when this square is killed (read by
//             the ScoringSystem). Carried per-instance so scoring stays
//             type-agnostic across archetypes.
//  - aggro  : one-way latch — false while fleeing, set true forever once a
//             nearby bullet provokes it (then it homes toward the ship).

/**
 * Create a zeroed green square with its collision radius, base score, and a
 * false aggro latch. Used as the Pool factory; positional/velocity/aggro fields
 * are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, score:number, aggro:boolean}}
 */
export function createGreenSquare() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: GREEN_SQUARE_RADIUS,
    score: GREEN_SQUARE_SCORE,
    aggro: false,
  };
}
