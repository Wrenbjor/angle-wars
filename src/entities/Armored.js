import {
  ARMORED_RADIUS,
  ARMORED_SCORE,
  ARMORED_XP,
  ARMORED_HP,
} from '../config/constants.js';

// Armored — the pooled Armored enemy (plain data, Phaser-free; Story 9.3).
//
// The armored is a high-churn entity like the Seeker: spawned at the arena edge
// and destroyed by fire. It lives in an object Pool (owned by the ArmoredSystem),
// NOT in world.entities, so there is no splice/indexOf churn. This factory only
// builds an instance when the pool cannot recycle a freed one; the ArmoredSystem
// (re)initializes the fields in place on every spawn, so the zeroed values here
// are just a well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius, score, xp, telegraphMs, hp }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set each tick from unit(ship − armored) × ARMORED_SPEED
//  - radius : half-extent (px) for the placeholder shape and bullet↔enemy collision
//  - score  : base per-type value credited when this armored is killed (read by
//             the ScoringSystem). Carried per-instance like every other archetype.
//  - xp     : base per-type XP value dropped as an orb when this armored is
//             bullet-KILLED (its final hit). A non-killing armor hit drops no orb.
//  - telegraphMs : spawn-telegraph countdown (ms, Story 2.6). While > 0 the
//             armored is non-lethal to the player (PlayerDeathSystem skips it) and
//             frozen (ArmoredSystem skips its homing); it renders a spawn-in cue.
//             Defaults to 0 (spawned-and-active); ArmoredSystem.spawn overwrites it.
//  - hp     : the PLAYER-DAMAGE durability. It is decremented ONLY through
//             CollisionSystem.applyPlayerDamage — the single armor-respecting path,
//             used by the bullet sweep and (Story 10.5) by the Afterburner Lv4+ dash
//             contact, so an armored behaves identically whichever hits it. It drops
//             by the HITTING source's `damage` (Story 10.2): the armored survives
//             while hp exceeds that damage (hp -= damage), and a hit whose damage
//             meets or exceeds the remaining hp kills it. So hits-to-kill is
//             ceil(hp / damage) — ARMORED_HP only at the base damage unit of 1. The
//             AoE paths (smart bomb, black hole) ignore hp entirely — they release
//             unconditionally = full damage for free. Reset to ARMORED_HP on every
//             spawn. This per-instance `hp` field is what distinguishes the armored
//             from the one-hit archetypes (which have no `hp` field and are released
//             on their first player-damage hit).
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
 * Create a zeroed armored with its collision radius, base score/xp, inactive
 * telegraph, and full hp. Used as the Pool factory; positional/velocity/telegraph/
 * hp fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, score:number, xp:number, telegraphMs:number, hp:number}}
 */
export function createArmored() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: ARMORED_RADIUS,
    score: ARMORED_SCORE,
    xp: ARMORED_XP,
    telegraphMs: 0,
    hp: ARMORED_HP,
  };
}
