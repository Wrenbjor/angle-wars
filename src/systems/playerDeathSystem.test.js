import { describe, it, expect } from 'vitest';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { EnemySystem } from './EnemySystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createScoreState } from '../state/ScoreState.js';
import {
  FIXED_STEP_MS,
  PLAYER_INVULN_MS,
  PLAYER_START_LIVES,
  SHIP_RADIUS,
  SEEKER_RADIUS,
  GREEN_SQUARE_RADIUS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  SCORE_MULTIPLIER_START,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const CENTER_X = ARENA_WIDTH / 2;
const CENTER_Y = ARENA_HEIGHT / 2;

// Build a ship, enemy pool, player state, and death system over them. The
// death seam takes an ARRAY of enemy pools (one per archetype); the single
// seeker pool is the common case, wrapped in a one-element list.
function makeSystem() {
  const ship = createPlayerShip();
  const enemyPool = new Pool(createSeeker);
  const playerState = createPlayerState();
  const system = new PlayerDeathSystem(ship, [enemyPool], playerState);
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

describe('PlayerDeathSystem — spawn telegraph non-lethality (Story 2.6)', () => {
  it('a telegraphing enemy (telegraphMs > 0) overlapping the ship is NON-lethal (AC1)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    const s = addSeeker(enemyPool, 100, 100); // fully overlapping
    s.telegraphMs = 500; // still spawning in → skipped by the death seam

    system.fixedUpdate(DT);

    // No life lost, no respawn, no game-over — the telegraphing enemy is skipped.
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(0);
    expect(ship.x).toBe(100); // not respawned to center
    expect(ship.y).toBe(100);
    // PlayerDeathSystem never mutates telegraphMs (the owning mover counts it down).
    expect(s.telegraphMs).toBe(500);
  });

  it('an active enemy (telegraphMs == 0) overlapping the ship is still lethal (AC2)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    const s = addSeeker(enemyPool, 100, 100);
    s.telegraphMs = 0; // activated

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });

  it('the same enemy becomes lethal the step AFTER its telegraph is spent (AC2)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    const s = addSeeker(enemyPool, 100, 100);
    // Telegraphing → non-lethal.
    s.telegraphMs = DT;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);

    // The mover decremented it to 0 (simulated here); now it is lethal.
    s.telegraphMs = 0;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });

  it('mixed overlap: exactly one death, caused by the ACTIVE enemy; the telegraphing one is skipped', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 200;
    ship.y = 200;
    const telegraphing = addSeeker(enemyPool, 200, 200);
    telegraphing.telegraphMs = 400; // skipped
    const active = addSeeker(enemyPool, 200, 200);
    active.telegraphMs = 0; // lethal

    system.fixedUpdate(DT);

    // Exactly one death — from the active enemy; the telegraphing one never counts.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(playerState.gameOver).toBe(false);
    // Neither enemy is destroyed by contact, and the telegraph is untouched.
    expect(enemyPool.activeCount).toBe(2);
    expect(telegraphing.telegraphMs).toBe(400);
  });
});

describe('PlayerDeathSystem — composed with the real EnemySystem mover (Story 2.6 AC2)', () => {
  // AC2's "same tick begins normal behavior AND becomes lethal" is a cross-system
  // ordering property: the owning mover decrements telegraphMs to 0, then
  // PlayerDeathSystem — running LATER in the same fixed step — reads that now-zero
  // value as lethal. The other telegraph tests hand-set telegraphMs = 0 to stand in
  // for the mover; these run the actual EnemySystem mover and the death seam over a
  // SHARED pool, so the coupling (and the no-early / no-late-lethality boundary) is
  // asserted through the real decrement, not a simulated one.
  function makeComposed() {
    const ship = createPlayerShip();
    // The seeker never fires random spawns here (we place it directly), but a
    // deterministic rng keeps construction free of Math.random.
    const enemy = new EnemySystem(ship, () => 0.5);
    const playerState = createPlayerState();
    // The death seam reads the SAME pool the mover owns and counts down.
    const death = new PlayerDeathSystem(ship, [enemy.enemyPool], playerState);
    return { ship, enemy, playerState, death };
  }

  it('the tick the mover zeroes telegraphMs is the tick the death seam turns lethal', () => {
    const { ship, enemy, playerState, death } = makeComposed();
    ship.x = 100;
    ship.y = 100;
    const s = enemy.enemyPool.acquire();
    s.x = 100; // coincident with the ship → homing keeps it in contact
    s.y = 100;
    s.vx = 0;
    s.vy = 0;
    s.telegraphMs = DT; // one step from activation

    // Real mover step: decrements DT → 0 and (now active) homes. Coincident with
    // the ship, so it stays overlapping.
    enemy.fixedUpdate(DT);
    expect(s.telegraphMs).toBe(0); // the mover — not the test — cleared it

    // Death seam runs later in the same fixed step: lethal that same step.
    death.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });

  it('while still telegraphing after a mover step, the enemy is frozen in place AND non-lethal', () => {
    const { ship, enemy, playerState, death } = makeComposed();
    ship.x = 100;
    ship.y = 100;
    const s = enemy.enemyPool.acquire();
    s.x = 100;
    s.y = 100;
    s.vx = 0;
    s.vy = 0;
    s.telegraphMs = DT * 2; // two steps from activation

    // Real mover step: decrements to DT (still > 0) and must NOT move it.
    enemy.fixedUpdate(DT);
    expect(s.telegraphMs).toBeCloseTo(DT, 9);
    expect(s.x).toBe(100); // frozen — no homing while telegraphing
    expect(s.y).toBe(100);

    // Death seam: no life lost while it is still telegraphing.
    death.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
  });
});

describe('PlayerDeathSystem — multiplier reset on death (Story 3.1, FR8)', () => {
  // A ship, seeker pool, player state, score state, and a death system wired
  // with the score state (the optional 4th constructor param).
  function makeSystemWithScore() {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    const system = new PlayerDeathSystem(
      ship,
      [enemyPool],
      playerState,
      scoreState,
    );
    return { ship, enemyPool, playerState, scoreState, system };
  }

  it('a respawning death resets the multiplier and its progress to start/0', () => {
    const { ship, enemyPool, playerState, scoreState, system } =
      makeSystemWithScore();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping → death
    // A climbed multiplier with progress toward the next step.
    scoreState.multiplier = 7;
    scoreState.multiplierKills = 3;
    scoreState.score = 4200;

    system.fixedUpdate(DT);

    // Respawning death (lives remain).
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    // Multiplier + progress wiped; score itself untouched (keep points, lose streak).
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
    expect(scoreState.score).toBe(4200);
  });

  it('the final game-over death also resets the multiplier to start/0', () => {
    const { ship, enemyPool, playerState, scoreState, system } =
      makeSystemWithScore();
    playerState.lives = 1; // last life → game-over
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);
    scoreState.multiplier = 10;
    scoreState.multiplierKills = 2;

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('does not reset the multiplier when no death occurs', () => {
    const { ship, enemyPool, playerState, scoreState, system } =
      makeSystemWithScore();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 500, 500); // far away → no contact
    scoreState.multiplier = 5;
    scoreState.multiplierKills = 4;

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(scoreState.multiplier).toBe(5);
    expect(scoreState.multiplierKills).toBe(4);
  });

  it('a system built without a scoreState still runs the death flow unchanged', () => {
    // No 4th arg → scoreState defaults to null; the death seam must not throw and
    // must apply the normal death flow (this is makeSystem() from the top of file).
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping → death

    expect(() => system.fixedUpdate(DT)).not.toThrow();

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(ship.x).toBe(CENTER_X); // respawned to center
    expect(ship.y).toBe(CENTER_Y);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });
});

describe('PlayerDeathSystem — multiple archetype pools', () => {
  // Build a ship, a seeker pool AND a green-square pool, and a death system
  // spanning both.
  function makeMultiSystem() {
    const ship = createPlayerShip();
    const seekerPool = new Pool(createSeeker);
    const greenPool = new Pool(createGreenSquare);
    const playerState = createPlayerState();
    const system = new PlayerDeathSystem(
      ship,
      [seekerPool, greenPool],
      playerState,
    );
    return { ship, seekerPool, greenPool, playerState, system };
  }

  it('a green square in the second pool is lethal on contact (fleeing state)', () => {
    const { ship, greenPool, playerState, system } = makeMultiSystem();
    ship.x = 100;
    ship.y = 100;
    const g = greenPool.acquire();
    g.x = 100;
    g.y = 100; // overlapping
    g.aggro = false; // fleeing — still lethal on contact (FR6)

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(ship.x).toBe(CENTER_X); // respawned to center
    expect(ship.y).toBe(CENTER_Y);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    // The green square is never destroyed by ship contact — it stays active.
    expect(greenPool.activeCount).toBe(1);
  });

  it('an aggressive green square is lethal too, and a boundary touch counts', () => {
    const { ship, greenPool, playerState, system } = makeMultiSystem();
    const r = SHIP_RADIUS + GREEN_SQUARE_RADIUS;
    ship.x = 200;
    ship.y = 200;
    const g = greenPool.acquire();
    g.x = 200 + r; // exactly r apart along +x (boundary)
    g.y = 200;
    g.aggro = true;

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });

  it('one death per tick even with enemies overlapping in BOTH pools', () => {
    const { ship, seekerPool, greenPool, playerState, system } = makeMultiSystem();
    ship.x = 300;
    ship.y = 300;
    const s = seekerPool.acquire();
    s.x = 300;
    s.y = 300;
    const g = greenPool.acquire();
    g.x = 300;
    g.y = 300;

    system.fixedUpdate(DT);

    // Exactly one life lost, one invuln grant — never one per pool.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    // Neither enemy released by contact.
    expect(seekerPool.activeCount).toBe(1);
    expect(greenPool.activeCount).toBe(1);
  });
});
