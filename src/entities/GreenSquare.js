import {
  GREEN_SQUARE_RADIUS,
  GREEN_SQUARE_SCORE,
  GREEN_SQUARE_XP,
} from '../config/constants.js';

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
// Shape: { x, y, vx, vy, radius, score, xp, aggro }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set each tick from the flee/home direction
//  - radius : half-extent (px) for the placeholder square and circle-circle
//             bullet↔enemy / ship↔enemy collision (shared with the Seeker seams)
//  - score  : base per-type value credited when this square is killed (read by
//             the ScoringSystem). Carried per-instance so scoring stays
//             type-agnostic across archetypes.
//  - xp     : base per-type XP value dropped as an orb when this square is
//             bullet-killed (Story 8.1). A SEPARATE economy from `score`,
//             carried per-instance like it.
//  - aggro  : one-way latch — false while fleeing, set true forever once a
//             nearby bullet provokes it (then it homes toward the ship).
//  - telegraphMs : spawn-telegraph countdown (ms, Story 2.6). While > 0 the
//             square is non-lethal to the player (PlayerDeathSystem skips it) and
//             frozen (GreenSquareSystem skips its threat/flee/aggro tick); it
//             renders a spawn-in cue. Defaults to 0 (spawned-and-active);
//             GreenSquareSystem.spawn overwrites it.
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
 * Create a zeroed green square with its collision radius, base score, a false
 * aggro latch, and inactive telegraph. Used as the Pool factory;
 * positional/velocity/aggro/telegraph fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, score:number, xp:number, aggro:boolean, telegraphMs:number}}
 */
export function createGreenSquare() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: GREEN_SQUARE_RADIUS,
    score: GREEN_SQUARE_SCORE,
    xp: GREEN_SQUARE_XP,
    aggro: false,
    telegraphMs: 0,
    particleColor: 0x66ff33,
  };
}
