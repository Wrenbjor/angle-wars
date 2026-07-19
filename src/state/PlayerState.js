import { PLAYER_START_LIVES } from '../config/constants.js';

// PlayerState — the shared player lifecycle state (plain data, Phaser-free).
//
// Mirrors the PlayerShip/InputState shared-state pattern: a plain-data object
// the PlayerDeathSystem mutates each fixed tick and the scene reads for the
// invulnerability indication (and, later, the HUD/game-over screen). Kept
// separate from the ship entity because lives/invulnerability/game-over are a
// distinct lifecycle concern from the ship's position/velocity/facing.
//
// Shape: { lives, invulnMs, gameOver }
//  - lives    : remaining lives (starts at PLAYER_START_LIVES; never negative)
//  - invulnMs : remaining respawn-invulnerability window (ms; 0 = vulnerable)
//  - gameOver : true once the last life is lost (run ended)

/**
 * Create the player lifecycle state at the start of a run: full lives, not
 * invulnerable, not game-over.
 * @returns {{lives:number, invulnMs:number, gameOver:boolean}}
 */
export function createPlayerState() {
  return {
    lives: PLAYER_START_LIVES,
    invulnMs: 0,
    gameOver: false,
  };
}
