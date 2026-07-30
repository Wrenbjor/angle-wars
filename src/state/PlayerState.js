import { PLAYER_START_LIVES } from '../config/constants.js';

// PlayerState — the shared player lifecycle state (plain data, Phaser-free).
//
// Mirrors the PlayerShip/InputState shared-state pattern: a plain-data object
// the PlayerDeathSystem mutates each fixed tick and the scene reads for the
// invulnerability indication (and, later, the HUD/game-over screen). Kept
// separate from the ship entity because lives/invulnerability/game-over are a
// distinct lifecycle concern from the ship's position/velocity/facing.
//
// Shape: { lives, invulnMs, gameOver, pendingDeath, phaseIntangible }
//  - lives        : remaining lives (starts at PLAYER_START_LIVES; never negative)
//  - invulnMs     : remaining respawn-invulnerability window (ms; 0 = vulnerable)
//  - gameOver     : true once the last life is lost (run ended)
//  - pendingDeath : a one-tick programmatic-death REQUEST. A system that needs to
//                   cost the player a life without a ship↔enemy circle-contact sets
//                   this true; PlayerDeathSystem consumes it read-and-clear at the top
//                   of its tick and applies the SAME death flow as a contact death,
//                   subject to the SAME invuln/game-over guards. The same read-and-clear
//                   latch idiom as InputState.consumeBomb — never deferred to a later
//                   tick. TWO producers today, both routing through this one seam:
//                   (1) a Black Hole detonation (Story 6.2), and (2) a Mirror Reflector
//                   WEIGHT-KILL (Story 6.3) — the reflector's lethal region is its two
//                   weights (not a uniform circle), so it is NOT in the PlayerDeathSystem
//                   pool list and instead sets pendingDeath when the ship overlaps a weight.
//  - phaseIntangible : true when Phase Armor is active (Story 12.5): the ship is
//                   intangible after the final shield charge breaks. PlayerDeathSystem
//                   checks this at the top of `_applyDeath()` and returns early when
//                   true.

/**
 * Create the player lifecycle state at the start of a run: full lives, not
 * invulnerable, not game-over, no pending programmatic death.
 * @returns {{lives:number, invulnMs:number, gameOver:boolean, pendingDeath:boolean, phaseIntangible:boolean}}
 */
export function createPlayerState() {
  return {
    lives: PLAYER_START_LIVES,
    invulnMs: 0,
    gameOver: false,
    pendingDeath: false,
    // Story 12.5 — Phase Armor: intangible after final shield break.
    phaseIntangible: false,
  };
}
