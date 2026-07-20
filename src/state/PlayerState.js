import { PLAYER_START_LIVES } from '../config/constants.js';

// PlayerState — the shared player lifecycle state (plain data, Phaser-free).
//
// Mirrors the PlayerShip/InputState shared-state pattern: a plain-data object
// the PlayerDeathSystem mutates each fixed tick and the scene reads for the
// invulnerability indication (and, later, the HUD/game-over screen). Kept
// separate from the ship entity because lives/invulnerability/game-over are a
// distinct lifecycle concern from the ship's position/velocity/facing.
//
// Shape: { lives, invulnMs, gameOver, pendingDeath }
//  - lives        : remaining lives (starts at PLAYER_START_LIVES; never negative)
//  - invulnMs     : remaining respawn-invulnerability window (ms; 0 = vulnerable)
//  - gameOver     : true once the last life is lost (run ended)
//  - pendingDeath : a one-tick programmatic-death REQUEST. A system that needs to
//                   cost the player a life without a ship↔enemy contact (Story 6.2:
//                   a Black Hole detonation) sets this true; PlayerDeathSystem
//                   consumes it read-and-clear at the top of its tick and applies
//                   the SAME death flow as a contact death, subject to the SAME
//                   invuln/game-over guards. The same read-and-clear latch idiom as
//                   InputState.consumeBomb — never deferred to a later tick.

/**
 * Create the player lifecycle state at the start of a run: full lives, not
 * invulnerable, not game-over, no pending programmatic death.
 * @returns {{lives:number, invulnMs:number, gameOver:boolean, pendingDeath:boolean}}
 */
export function createPlayerState() {
  return {
    lives: PLAYER_START_LIVES,
    invulnMs: 0,
    gameOver: false,
    pendingDeath: false,
  };
}
