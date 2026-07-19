import { BLACKHOLE_RADIUS, BLACKHOLE_HP } from '../config/constants.js';

// BlackHole — the pooled Black Hole hazard (plain data, Phaser-free).
//
// Unlike the one-hit enemies, the Black Hole (Epic 2's signature high-risk
// object) is a STATIONARY, HP-based destructible: it never moves, so it carries
// no velocity. Each fixed step the BlackHoleSystem pulls nearby entities toward
// its body (gravity), feeds on the bullets/enemies that reach it (growing its
// radius and accumulating toward the next enemy spawn), and takes bullet damage
// toward destruction. Holes are low-churn (one at a time by default) but still
// pooled so spawn/detonate cycles allocate nothing on the steady-state path.
//
// This factory only builds an instance when the pool cannot recycle a freed one;
// the BlackHoleSystem re-initializes every field in place on each spawn, so the
// values here are just a well-defined starting shape.
//
// Shape: { x, y, radius, hp, feed }  (stationary — no vx/vy)
//  - x, y   : position (px, arena/logical space). Fixed for the hole's lifetime.
//  - radius : half-extent (px) used as the gravity SOURCE center, the feed/ship
//             contact body, the bullet-absorption test, and the placeholder
//             circle. GROWS (clamped) as the hole feeds.
//  - hp     : remaining hit points; DEPLETES by BLACKHOLE_BULLET_DAMAGE per
//             absorbed bullet. At ≤ 0 the hole detonates (payout + removal).
//  - feed   : accumulated absorptions toward the next enemy spawn; every
//             BLACKHOLE_FEED_PER_SPAWN feeds emits one seeker and decrements.
//  - telegraphMs : spawn-telegraph countdown (ms, Story 2.6). While > 0 the hole
//             is non-lethal to the player (PlayerDeathSystem skips it) and frozen
//             (BlackHoleSystem skips its gravity/absorb/feed/grow/detonation tick
//             — a spawning hole is briefly invulnerable); it renders a spawn-in
//             cue. Defaults to 0 (spawned-and-active); BlackHoleSystem._spawnOne
//             overwrites it.

/**
 * Create a fresh Black Hole with its starting radius, full hp, zero feed, and
 * inactive telegraph. Used as the hole Pool factory; every field is overwritten
 * on spawn.
 * @returns {{x:number, y:number, radius:number, hp:number, feed:number, telegraphMs:number}}
 */
export function createBlackHole() {
  return {
    x: 0,
    y: 0,
    radius: BLACKHOLE_RADIUS,
    hp: BLACKHOLE_HP,
    feed: 0,
    telegraphMs: 0,
  };
}
