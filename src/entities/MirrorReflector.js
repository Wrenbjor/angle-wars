// MirrorReflector — the pooled Mirror Reflector (dumbbell) hazard (plain data,
// Phaser-free).
//
// The Mirror Reflector (Story 6.3) is Epic 6's hazard that RESISTS firepower: a
// spinning DUMBBELL of two lethal weights joined by a bar. Like the Pinwheel it
// spawns at a random arena edge with a random heading and DRIFTS at a constant
// speed, bouncing off the walls, INDIFFERENT to the player (it never reads the ship
// or bullets for its motion). It additionally SPINS (its `angle` advances every
// fixed step). It lives in its OWN object Pool (owned by the MirrorReflectorSystem),
// NOT in world.entities — no splice/indexOf churn. This factory only builds an
// instance when the pool cannot recycle a freed one; the MirrorReflectorSystem
// (re)initializes the fields in place on every spawn, so the zeroed values here are
// just a well-defined starting shape.
//
// Unlike the one-hit archetypes it carries NO uniform `radius`/`score` field: it is
// deliberately kept OUT of the shared {x,y,radius} circle seams (CollisionSystem,
// BombSystem, BlackHole absorb, PlayerDeathSystem). Its geometry (bar half-length,
// weight radius, center-kill radius) and its score payout are centralized constants
// the MirrorReflectorSystem reads directly — the reflector owns its own bullet/ship
// collision tests.
//
// Shape: { x, y, vx, vy, angle, telegraphMs }
//  - x, y     : center position (px, arena/logical space) — the point the ship
//               threads to destroy it, and the rotation pivot of the dumbbell.
//  - vx, vy   : drift velocity (px/s) — set on spawn to a random heading × drift
//               speed, then reflected by wall bounces (|v| stays == the drift speed).
//  - angle    : spin angle (radians). The bar lies along (cos, sin)·angle; the two
//               weights sit at ±REFLECTOR_BAR_HALF_LENGTH along it. Advances by
//               REFLECTOR_SPIN_RATE·dtSec each active tick.
//  - telegraphMs : spawn-telegraph countdown (ms, Story 2.6). While > 0 the
//               reflector is FROZEN and inert (no drift/spin, no bullet reflect, no
//               ship destroy, no weight kill); it only renders a spawn-in cue.
//               Defaults to 0 (spawned-and-active); MirrorReflectorSystem.spawn
//               overwrites it.

/**
 * Create a zeroed mirror reflector with an inactive telegraph. Used as the Pool
 * factory; positional/velocity/angle/telegraph fields are overwritten on spawn.
 * @returns {{x:number, y:number, vx:number, vy:number, angle:number, telegraphMs:number}}
 */
export function createMirrorReflector() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    telegraphMs: 0,
  };
}
