import { System } from '../core/System.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { PLAYER_INVULN_MS } from '../config/constants.js';

// PlayerDeathSystem — ship↔enemy death, lives, respawn, invulnerability, and the
// game-over flag (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER CollisionSystem (so an enemy killed
// by a bullet this tick is already released and cannot also kill the player) and
// after PlayerMovementSystem/EnemySystem/GreenSquareSystem (so it sees post-move
// ship and enemy positions). It owns no pool/state — it reads the ship entity,
// the enemy pools, and the shared PlayerState it is given.
//
// The enemy pools are a LIST so every archetype (Blue Seeker, Green Square, and
// future Epic-2 enemies) is lethal on contact through this one seam (FR6) — no
// per-type duplicate. Every enemy shares the uniform {x,y,radius,telegraphMs}
// shape, so this seam reads only those fields and stays type-agnostic (a Green
// Square kills on contact regardless of its aggro state). Story 2.6: an instance
// still telegraphing its spawn (telegraphMs > 0) is skipped — the single
// non-lethality seam that makes every archetype safe while spawning in.
//
// Each fixed step:
//   1. If the run is over (gameOver), do nothing.
//   2. Count the invulnerability window down by dt (clamped at 0). While it is
//      still > 0 the player is invulnerable — return without any contact test.
//   3. Otherwise test the ship against the active enemies of every pool
//      (circle-circle) and, on the first overlap, apply the death flow: deduct a
//      life and either respawn at arena center with a fresh invulnerability
//      window (lives remain) or set game-over (last life). At most ONE death per
//      fixed step (break on first).
//
// Circle-circle lethal when center distance ≤ ship.radius + enemy.radius
// (boundary counts, mirroring CollisionSystem). Enemies are never destroyed here
// — ship contact only kills the player; bullets destroy enemies (Story 1.4).
//
// Zero steady-state allocation: a reusable scratch array materializes the union
// of the pools' active sets each tick (iterating a Set directly can't be indexed).
export class PlayerDeathSystem extends System {
  /**
   * @param {{x:number,y:number,vx:number,vy:number,angle:number,radius:number}} ship
   *   The player ship entity (mutated on respawn).
   * @param {import('../core/Pool.js').Pool[]} enemyPools Array of enemy pools
   *   (one per archetype) whose active instances are tested against the ship.
   * @param {{lives:number, invulnMs:number, gameOver:boolean}} playerState
   *   Shared player lifecycle state (mutated here).
   */
  constructor(ship, enemyPools, playerState) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.playerState = playerState;

    // Reusable scratch: materialized union of active enemies, refilled each tick.
    this._enemies = [];
    // Hoisted collect callback so the per-pool `forEachActive` reuses one closure
    // instead of allocating a fresh arrow per pool per tick.
    this._collectEnemy = (s) => this._enemies.push(s);
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

    // Vulnerable: materialize the union of active enemies into reusable scratch
    // (no alloc) — every archetype pool contributes its live instances.
    const ship = this.ship;
    const enemies = this._enemies;
    enemies.length = 0;
    const pools = this.enemyPools;
    for (let p = 0; p < pools.length; p++) {
      pools[p].forEachActive(this._collectEnemy);
    }

    // Test circle-circle; the first overlap is a lethal hit. At most one death
    // per tick — break so overlapping enemies cost exactly one life.
    for (let i = 0; i < enemies.length; i++) {
      const s = enemies[i];
      // Story 2.6: a telegraphing (spawning-in) enemy of ANY archetype is
      // non-lethal — skip it. The uniform telegraphMs field defaults to 0
      // (active/lethal) in every factory, so this one line makes every archetype
      // safe while telegraphing through this single shared seam.
      if (s.telegraphMs > 0) continue;
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
