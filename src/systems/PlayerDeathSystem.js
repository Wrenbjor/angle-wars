import { System } from '../core/System.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { PLAYER_INVULN_MS } from '../config/constants.js';

// PlayerDeathSystem — ship↔enemy death, lives, respawn, invulnerability, and the
// game-over flag (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER CollisionSystem (so a seeker killed
// by a bullet this tick is already released and cannot also kill the player) and
// after PlayerMovementSystem/EnemySystem (so it sees post-move ship and seeker
// positions). It owns no pool/state — it reads the ship entity, the enemy pool,
// and the shared PlayerState it is given.
//
// Each fixed step:
//   1. If the run is over (gameOver), do nothing.
//   2. Count the invulnerability window down by dt (clamped at 0). While it is
//      still > 0 the player is invulnerable — return without any contact test.
//   3. Otherwise test the ship against active seekers (circle-circle) and, on the
//      first overlap, apply the death flow: deduct a life and either respawn at
//      arena center with a fresh invulnerability window (lives remain) or set
//      game-over (last life). At most ONE death per fixed step (break on first).
//
// Circle-circle lethal when center distance ≤ ship.radius + seeker.radius
// (boundary counts, mirroring CollisionSystem). Seekers are never destroyed here
// — ship contact only kills the player; bullets destroy enemies (Story 1.4).
//
// Zero steady-state allocation: a reusable scratch array materializes the pool's
// active set each tick (iterating the pool's Set directly can't be indexed).
export class PlayerDeathSystem extends System {
  /**
   * @param {{x:number,y:number,vx:number,vy:number,angle:number,radius:number}} ship
   *   The player ship entity (mutated on respawn).
   * @param {import('../core/Pool.js').Pool} enemyPool Active seekers to test against.
   * @param {{lives:number, invulnMs:number, gameOver:boolean}} playerState
   *   Shared player lifecycle state (mutated here).
   */
  constructor(ship, enemyPool, playerState) {
    super();
    this.ship = ship;
    this.enemyPool = enemyPool;
    this.playerState = playerState;

    // Reusable scratch: materialized active seeker set, refilled each tick.
    this._seekers = [];
  }

  /**
   * Advance one fixed step: count down invulnerability, then (if vulnerable)
   * test ship vs seekers and apply the death flow.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ps = this.playerState;

    // Run ended — do nothing further (no negative lives, no further respawn).
    if (ps.gameOver) {
      return;
    }

    // Invulnerable: count the window down (clamp ≥ 0) and take no lethal contact.
    // The window ending and the first vulnerable tick are distinct steps.
    if (ps.invulnMs > 0) {
      ps.invulnMs -= dt;
      if (ps.invulnMs < 0) {
        ps.invulnMs = 0;
      }
      return;
    }

    // Vulnerable: materialize active seekers into reusable scratch (no alloc).
    const ship = this.ship;
    const seekers = this._seekers;
    seekers.length = 0;
    this.enemyPool.forEachActive((s) => seekers.push(s));

    // Test circle-circle; the first overlap is a lethal hit. At most one death
    // per tick — break so overlapping seekers cost exactly one life.
    for (let i = 0; i < seekers.length; i++) {
      const s = seekers[i];
      const dx = ship.x - s.x;
      const dy = ship.y - s.y;
      const r = ship.radius + s.radius;
      // Squared compare avoids a sqrt; ≤ so a boundary touch counts.
      if (dx * dx + dy * dy <= r * r) {
        ps.lives -= 1;
        if (ps.lives > 0) {
          // Respawn: copy the canonical spawn so arena-center lives in one place.
          const sp = createPlayerShip();
          ship.x = sp.x;
          ship.y = sp.y;
          ship.vx = 0;
          ship.vy = 0;
          ship.angle = sp.angle;
          ps.invulnMs = PLAYER_INVULN_MS;
        } else {
          // Last life: game-over. Do not respawn or grant invulnerability.
          ps.lives = 0;
          ps.gameOver = true;
        }
        break;
      }
    }
  }
}
