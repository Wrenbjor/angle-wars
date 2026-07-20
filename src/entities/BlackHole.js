import {
  BLACKHOLE_RADIUS,
  BLACKHOLE_UNSTABLE_RADIUS,
} from '../config/constants.js';

// BlackHole — the pooled Black Hole hazard (plain data, Phaser-free).
//
// Reworked in Story 6.2 from an HP-based destructible into an UNSTABLE ticking
// bomb. The hole is STATIONARY (no velocity). Each fixed step the BlackHoleSystem
// pulls nearby entities toward its body (gravity) and ABSORBS the bullets/enemies
// that reach it: absorbed enemies GROW its radius toward the unstable threshold,
// absorbed player bullets SHRINK it toward the floor. `radius` is the single
// instability metric — there is no `hp` and no `feed` anymore. Holes are low-churn
// (one at a time by default) but still pooled so spawn/detonate/implode cycles
// allocate nothing on the steady-state path.
//
// This factory only builds an instance when the pool cannot recycle a freed one;
// the BlackHoleSystem re-initializes every field in place on each spawn, so the
// values here are just a well-defined starting shape.
//
// Shape: { x, y, radius, telegraphMs }  (stationary — no vx/vy)
//  - x, y   : position (px, arena/logical space). Fixed for the hole's lifetime.
//  - radius : half-extent (px) used as the gravity SOURCE center, the ship-contact
//             body, the bullet/enemy-absorption test, and the placeholder circle.
//             GROWS on enemy absorption (toward BLACKHOLE_UNSTABLE_RADIUS →
//             detonation) and SHRINKS on player-bullet absorption (toward
//             BLACKHOLE_MIN_RADIUS → safe implosion). The single instability clock.
//  - telegraphMs : spawn-telegraph countdown (ms, Story 2.6). While > 0 the hole
//             is non-lethal to the player (PlayerDeathSystem skips it) and frozen
//             (BlackHoleSystem skips its gravity/absorb/grow/shrink/detonation/
//             implosion tick — a spawning hole is briefly inert); it only renders a
//             spawn-in cue. Defaults to 0 (spawned-and-active); BlackHoleSystem
//             ._spawnOne overwrites it.

/**
 * Create a fresh Black Hole at its starting (stable) radius with an inactive
 * telegraph. Used as the hole Pool factory; every field is overwritten on spawn.
 * @returns {{x:number, y:number, radius:number, telegraphMs:number}}
 */
export function createBlackHole() {
  return {
    x: 0,
    y: 0,
    radius: BLACKHOLE_RADIUS,
    telegraphMs: 0,
  };
}

/**
 * Instability of a hole at the given radius: a normalized 0..1 measure of how
 * close it is to detonating, clamped to [0,1]. 0 at the spawn/stable radius
 * (BLACKHOLE_RADIUS), 1 at the unstable threshold (BLACKHOLE_UNSTABLE_RADIUS).
 *
 * This is THE one shared instability formula: the render color/pulse, the audio
 * urgency level, and the system's `maxInstability` all derive from it — one
 * formula, one source of "how close to blowing." Pure and Phaser-free.
 * @param {number} radius The hole's current radius (px).
 * @returns {number} instability in [0,1]
 */
export function blackHoleInstability(radius) {
  const span = BLACKHOLE_UNSTABLE_RADIUS - BLACKHOLE_RADIUS;
  if (!(span > 0)) return 0; // degenerate config guard (no divide-by-zero)
  let t = (radius - BLACKHOLE_RADIUS) / span;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t;
}
