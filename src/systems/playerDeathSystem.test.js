import { describe, it, expect } from 'vitest';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerState } from '../state/PlayerState.js';
import {
  FIXED_STEP_MS,
  PLAYER_INVULN_MS,
  PLAYER_START_LIVES,
  SHIP_RADIUS,
  SEEKER_RADIUS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const CENTER_X = ARENA_WIDTH / 2;
const CENTER_Y = ARENA_HEIGHT / 2;

// Build a ship, enemy pool, player state, and death system over them.
function makeSystem() {
  const ship = createPlayerShip();
  const enemyPool = new Pool(createSeeker);
  const playerState = createPlayerState();
  const system = new PlayerDeathSystem(ship, enemyPool, playerState);
  return { ship, enemyPool, playerState, system };
}

function addSeeker(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  return s;
}

describe('PlayerDeathSystem', () => {
  it('lethal contact: deducts a life, respawns at center, grants invuln, keeps seeker', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    // Move the ship off center so the respawn-to-center is observable.
    ship.x = 100;
    ship.y = 100;
    ship.vx = 50;
    ship.vy = -30;
    const seeker = addSeeker(enemyPool, 100, 100); // fully overlapping

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1); // 2
    expect(playerState.gameOver).toBe(false);
    // Respawned at arena center, velocity reset.
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    expect(ship.vx).toBe(0);
    expect(ship.vy).toBe(0);
    // Fresh invulnerability window.
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    // The seeker stays active (ship contact never destroys seekers).
    expect(enemyPool.activeCount).toBe(1);
  });

  it('no contact: no life lost, ship unmoved by this system, not game-over', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 500, 500); // far away

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(0);
    // Ship not moved by this system.
    expect(ship.x).toBe(100);
    expect(ship.y).toBe(100);
  });

  it('contact while invulnerable: no harm, no respawn, invuln decremented not reset', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    playerState.invulnMs = 500;
    addSeeker(enemyPool, 100, 100); // overlapping, but invulnerable

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES); // no life lost
    expect(playerState.gameOver).toBe(false);
    // Ship not moved to center.
    expect(ship.x).toBe(100);
    expect(ship.y).toBe(100);
    // Invuln decremented by dt, not reset to the full window.
    expect(playerState.invulnMs).toBeCloseTo(500 - DT, 9);
  });

  it('boundary touch (distance == ship.radius + seeker.radius) counts as lethal', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    const r = SHIP_RADIUS + SEEKER_RADIUS;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100 + r, 100); // exactly r apart along +x

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });

  it('does not kill just beyond the boundary (distance slightly > r)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    const r = SHIP_RADIUS + SEEKER_RADIUS;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100 + r + 0.001, 100);

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.invulnMs).toBe(0);
  });

  it('invuln countdown reaches 0 at ~the same sim time regardless of tick size', () => {
    // Fine ticks vs coarse ticks, contact present throughout. The window must
    // reach 0 after ~the same elapsed sim time, never go negative, and no death
    // occurs until it hits 0.
    function runToZero(tickMs) {
      const { ship, enemyPool, playerState, system } = makeSystem();
      ship.x = 100;
      ship.y = 100;
      playerState.invulnMs = PLAYER_INVULN_MS;
      addSeeker(enemyPool, 100, 100); // overlapping the whole time
      let elapsed = 0;
      let ticks = 0;
      // Run until the window is exhausted.
      while (playerState.invulnMs > 0) {
        system.fixedUpdate(tickMs);
        elapsed += tickMs;
        ticks += 1;
        expect(playerState.invulnMs).toBeGreaterThanOrEqual(0); // never negative
        expect(ticks).toBeLessThan(100000); // guard against a stuck loop
      }
      // No death happened while counting down (still full lives, not game-over).
      expect(playerState.lives).toBe(PLAYER_START_LIVES);
      expect(playerState.gameOver).toBe(false);
      return elapsed;
    }

    const fine = runToZero(1); // 1 ms ticks
    const coarse = runToZero(DT); // fixed-step ticks
    // Both land within one coarse tick of the true window duration.
    expect(fine).toBeGreaterThanOrEqual(PLAYER_INVULN_MS);
    expect(fine).toBeLessThan(PLAYER_INVULN_MS + 1);
    expect(coarse).toBeGreaterThanOrEqual(PLAYER_INVULN_MS);
    expect(coarse).toBeLessThan(PLAYER_INVULN_MS + DT);
  });

  it('multiple seekers in one tick cost exactly one life (one respawn, one invuln)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 200;
    ship.y = 200;
    addSeeker(enemyPool, 200, 200); // both overlap the ship
    addSeeker(enemyPool, 200, 200);

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1); // exactly one death
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS); // one grant
    expect(playerState.gameOver).toBe(false);
    // Neither seeker was released.
    expect(enemyPool.activeCount).toBe(2);
  });

  it('last life → game-over: lives 0, gameOver true, no respawn, no invuln', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    playerState.lives = 1;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
    expect(playerState.invulnMs).toBe(0); // no invuln granted
    // Ship NOT respawned to center.
    expect(ship.x).toBe(100);
    expect(ship.y).toBe(100);
  });

  it('after game-over: early-returns, no negative lives, no respawn', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    playerState.lives = 0;
    playerState.gameOver = true;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(0); // stays 0, no negative
    expect(playerState.gameOver).toBe(true);
    expect(ship.x).toBe(100); // no respawn
    expect(ship.y).toBe(100);
  });

  it('allocates nothing on the steady-state path (reusable scratch)', () => {
    const { enemyPool, system } = makeSystem();
    addSeeker(enemyPool, 500, 500); // far, no contact
    for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    expect(enemyPool.activeCount + enemyPool.freeCount).toBe(1);
  });
});
