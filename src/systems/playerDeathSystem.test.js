import { describe, it, expect, vi } from 'vitest';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { NaniteShieldSystem } from './NaniteShieldSystem.js';
import { DashSystem } from './DashSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { PlayerMovementSystem } from './PlayerMovementSystem.js';
import { createBullet } from '../entities/Bullet.js';
import { InputState } from '../input/InputState.js';
import { EnemySystem } from './EnemySystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createScoreState } from '../state/ScoreState.js';
import {
  createProgressionState,
  applyCard,
} from '../state/ProgressionState.js';
import { createPlayerStats, recomputePlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import {
  FIXED_STEP_MS,
  PLAYER_INVULN_MS,
  SHIELD_ABSORB_INVULN_MS,
  PLAYER_START_LIVES,
  SHIP_RADIUS,
  SHIP_MAX_SPEED,
  SHIP_ACCEL,
  SPAWN_SAFE_RADIUS,
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

  it('non-final death leaves run-scoped progressionState untouched (Story 8.3 AC)', () => {
    // The card-progression state must SURVIVE a non-final death (mirrors scoreState.xp):
    // the death path never receives or touches it. PlayerDeathSystem takes only
    // (ship, [enemyPool], playerState) — no progression ref — so a real lethal contact
    // that respawns the player must leave a separately-held progressionState identical.
    // Guards against a future death-path edit clearing progression like it resets the
    // multiplier. Without this, the "unchanged on non-final death" AC has zero coverage.
    const { ship, enemyPool, playerState, system } = makeSystem();
    const progressionState = createProgressionState();
    // Story 10.1: applyCard increments the owned COUNT (= the item level) and bumps the
    // legacy debugStat pick counter by 1 per pick (statDelta was retired).
    applyCard(progressionState, { id: 'card-a' });
    applyCard(progressionState, { id: 'card-a' });
    applyCard(progressionState, { id: 'card-b' });
    // Story 8.5: seed the reroll/banish economy fields to NON-default values too, so
    // "untouched by death" is proven against real mutations — a targeted death-path reset
    // of just these fields (to their fresh-run defaults) would otherwise read as untouched.
    progressionState.rerollCharges = 3;
    progressionState.banishCharges = 0;
    progressionState.banishedIds.add('off-rapid');
    const before = JSON.stringify(progressionState);

    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // fully overlapping → lethal contact

    system.fixedUpdate(DT);

    // A real NON-FINAL death occurred (life lost, respawned, not game-over)...
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    // ...and progression is byte-for-byte unchanged by it.
    expect(JSON.stringify(progressionState)).toBe(before);
    expect(progressionState).toEqual({
      ownedCards: { 'card-a': 2, 'card-b': 1 },
      debugStat: 3, // 3 picks → pick counter 3 (Story 10.1: no statDelta)
      // Story 8.5: the run-scoped reroll/banish economy fields survive the death path
      // intact at their SEEDED (non-default) values — proving death does not reset them.
      rerollCharges: 3,
      banishCharges: 0,
      banishedIds: new Set(['off-rapid']),
      // Story 10.1: the run-scoped remnant set survives death too (empty here).
      remnantIds: new Set(),
    });
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

  it('a respawning death does NOT touch the bomb count (bombs persist across death, FR9)', () => {
    const { ship, enemyPool, playerState, scoreState, system } =
      makeSystemWithScore();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping → death
    scoreState.multiplier = 7;
    scoreState.multiplierKills = 3;
    scoreState.bombs = 2; // mid-run bomb stockpile

    system.fixedUpdate(DT);

    // Respawning death (lives remain) resets the streak but NEVER the bombs.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.bombs).toBe(2); // survived the death
  });

  it('the final game-over death also leaves the bomb count untouched (FR9)', () => {
    const { ship, enemyPool, playerState, scoreState, system } =
      makeSystemWithScore();
    playerState.lives = 1; // last life → game-over
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);
    scoreState.bombs = 2;

    system.fixedUpdate(DT);

    expect(playerState.gameOver).toBe(true);
    expect(scoreState.bombs).toBe(2); // bombs persist even into game-over
  });
});

describe('PlayerDeathSystem — programmatic pendingDeath (Story 6.2)', () => {
  // A ship, seeker pool, player state, score state, and a death system wired with
  // the score state (so the multiplier-reset side of the shared death flow is
  // asserted for the forced path too).
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

  it('a set pendingDeath (vulnerable) applies the SAME normal death flow and clears the flag', () => {
    const { ship, playerState, scoreState, system } = makeSystemWithScore();
    ship.x = 250;
    ship.y = 175;
    // A climbed streak to prove the multiplier reset fires on the forced death too.
    scoreState.multiplier = 7;
    scoreState.multiplierKills = 3;
    scoreState.score = 4200;
    playerState.pendingDeath = true; // a detonation requested a life this tick

    system.fixedUpdate(DT);

    // Normal respawning death: life−1, respawn to center, invuln granted, multiplier
    // reset, deathSeq bumped — identical to a contact death.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
    expect(scoreState.score).toBe(4200); // score untouched
    expect(system.deathSeq).toBe(1);
    // The one-tick request is consumed (read-and-clear).
    expect(playerState.pendingDeath).toBe(false);
  });

  it('the last-life pendingDeath ends the run at game-over (no respawn, no invuln)', () => {
    const { ship, playerState, system } = makeSystemWithScore();
    playerState.lives = 1;
    ship.x = 300;
    ship.y = 300;
    playerState.pendingDeath = true;

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
    expect(playerState.invulnMs).toBe(0);
    expect(playerState.pendingDeath).toBe(false);
  });

  it('is SUPPRESSED and the flag CLEARED (not deferred) while invulnerable', () => {
    const { playerState, system } = makeSystemWithScore();
    playerState.invulnMs = 500;
    playerState.pendingDeath = true;

    system.fixedUpdate(DT);

    // No death; the request is dropped this tick (never deferred to a later one).
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.pendingDeath).toBe(false);
    expect(playerState.invulnMs).toBeCloseTo(500 - DT, 9); // window still counted down
    expect(system.deathSeq).toBe(0); // no death latched

    // Next tick (still invulnerable) does NOT resurrect the dropped request.
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
  });

  it('is SUPPRESSED and the flag CLEARED after game-over (no negative lives)', () => {
    const { playerState, system } = makeSystemWithScore();
    playerState.lives = 0;
    playerState.gameOver = true;
    playerState.pendingDeath = true;

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(0); // no negative
    expect(playerState.gameOver).toBe(true);
    expect(playerState.pendingDeath).toBe(false);
    expect(system.deathSeq).toBe(0);
  });

  it('costs exactly ONE life when both pendingDeath and a lethal contact hold this tick', () => {
    const { ship, enemyPool, playerState, system } = makeSystemWithScore();
    ship.x = 200;
    ship.y = 200;
    playerState.pendingDeath = true;
    addSeeker(enemyPool, 200, 200); // overlapping the ship too

    system.fixedUpdate(DT);

    // The forced death runs first and returns before the contact scan → one life,
    // one invuln grant, one deathSeq bump (never one per cause).
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(system.deathSeq).toBe(1);
    expect(playerState.pendingDeath).toBe(false);
    // The overlapping enemy is never destroyed by contact.
    expect(enemyPool.activeCount).toBe(1);
  });

  it('does nothing when pendingDeath is false and there is no contact', () => {
    const { ship, enemyPool, playerState, system } = makeSystemWithScore();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 500, 500); // far away
    // pendingDeath defaults false.

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.pendingDeath).toBe(false);
    expect(system.deathSeq).toBe(0);
  });
});

describe('PlayerDeathSystem death latch (Story 4.2)', () => {
  it('starts at deathSeq 0 with a zeroed death point', () => {
    const { system } = makeSystem();
    expect(system.deathSeq).toBe(0);
    expect(system.deathX).toBe(0);
    expect(system.deathY).toBe(0);
  });

  it('a respawning death latches the PRE-respawn ship position and bumps deathSeq', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 250;
    ship.y = 175;
    addSeeker(enemyPool, 250, 175); // overlapping → death

    system.fixedUpdate(DT);

    // Respawning death (lives remain), ship teleported to center...
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    // ...but the latch captured the death point BEFORE the respawn moved it.
    expect(system.deathSeq).toBe(1);
    expect(system.deathX).toBe(250);
    expect(system.deathY).toBe(175);
  });

  it('the final game-over death also latches the death point and bumps deathSeq', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    playerState.lives = 1; // last life → game-over
    ship.x = 90;
    ship.y = 610;
    addSeeker(enemyPool, 90, 610);

    system.fixedUpdate(DT);

    expect(playerState.gameOver).toBe(true);
    expect(system.deathSeq).toBe(1);
    expect(system.deathX).toBe(90);
    expect(system.deathY).toBe(610);
  });

  it('fires exactly once per death (no re-latch without a new death)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    ship.x = 300;
    ship.y = 300;
    addSeeker(enemyPool, 300, 300);

    system.fixedUpdate(DT); // death 1 → invulnerable now
    expect(system.deathSeq).toBe(1);

    // Next tick: invulnerable, so no new death, no new latch.
    system.fixedUpdate(DT);
    expect(system.deathSeq).toBe(1);
  });

  it('does not latch when no death occurs', () => {
    const { ship, enemyPool, system } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 500, 500); // far — no contact

    system.fixedUpdate(DT);

    expect(system.deathSeq).toBe(0);
    expect(system.deathX).toBe(0);
    expect(system.deathY).toBe(0);
  });

  it('does not latch a death that was prevented by invulnerability', () => {
    const { ship, enemyPool, system, playerState } = makeSystem();
    ship.x = 100;
    ship.y = 100;
    playerState.invulnMs = 500;
    addSeeker(enemyPool, 100, 100); // overlapping but invulnerable

    system.fixedUpdate(DT);

    expect(system.deathSeq).toBe(0);
  });

  it('increments deathSeq once per successive death (multi-death run)', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    // Death 1.
    ship.x = 100;
    ship.y = 100;
    const s = addSeeker(enemyPool, 100, 100);
    system.fixedUpdate(DT);
    expect(system.deathSeq).toBe(1);
    expect(system.deathX).toBe(100);

    // Burn off invulnerability without contact.
    s.x = 5000;
    s.y = 5000;
    let guard = 0;
    while (playerState.invulnMs > 0 && guard < 10000) {
      system.fixedUpdate(DT);
      guard += 1;
    }

    // Death 2 at a different point.
    ship.x = 700;
    ship.y = 500;
    s.x = 700;
    s.y = 500;
    system.fixedUpdate(DT);
    expect(system.deathSeq).toBe(2);
    expect(system.deathX).toBe(700);
    expect(system.deathY).toBe(500);
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

describe('PlayerDeathSystem — Nanite Shield absorb (Story 10.4)', () => {
  // The absorb is wired through the REAL NaniteShieldSystem (not a hand-rolled stub),
  // over the REAL fold of the SHIPPED registry — so these cases fail if the registry
  // numbers, the fold, the system's charge accounting, or the death-seam branch drift
  // apart. The shield is an OPTIONAL 5th constructor arg, mirroring `scoreState` at
  // slot 4, so every pre-10.4 construction in this file is untouched.

  function makeShieldedSystem(level = 1) {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    const playerStats = createPlayerStats();
    recomputePlayerStats(playerStats, { 'nanite-shield': level }, ITEM_REGISTRY);
    // Story 12.5 — Phase Armor: collisionSystem is now required by NaniteShieldSystem.
    const stubCollision = {
      applyPlayerDamage: (enemy, ownerPool, _damage) => {
        ownerPool.release(enemy);
        return true;
      },
    };
    const shieldSystem = new NaniteShieldSystem(ship, [enemyPool], stubCollision, playerStats);
    // The shield syncs its max off the fold on its own tick (it is registered BEFORE
    // PlayerDeathSystem in the assembled world), so charge it the same way here.
    shieldSystem.fixedUpdate(DT);
    const system = new PlayerDeathSystem(
      ship,
      [enemyPool],
      playerState,
      scoreState,
      shieldSystem,
    );
    return { ship, enemyPool, playerState, scoreState, shieldSystem, system };
  }

  it('a CONTACT hit is absorbed: a charge spent, no life, no respawn, streak + position kept', () => {
    const { ship, enemyPool, playerState, scoreState, shieldSystem, system } =
      makeShieldedSystem(1);
    ship.x = 100;
    ship.y = 100;
    ship.vx = 50;
    ship.vy = -30;
    scoreState.multiplier = 7;
    scoreState.multiplierKills = 3;
    expect(shieldSystem.charges).toBe(1);
    addSeeker(enemyPool, 100, 100); // fully overlapping → lethal contact

    system.fixedUpdate(DT);

    // The charge paid for it — and nothing else did.
    expect(shieldSystem.charges).toBe(0);
    expect(shieldSystem.absorbSeq).toBe(1);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
    // NOT teleported to arena center, velocity untouched — staying put is the point.
    expect(ship.x).toBe(100);
    expect(ship.y).toBe(100);
    expect(ship.vx).toBe(50);
    expect(ship.vy).toBe(-30);
    // The streak survives (an absorb never reaches resetMultiplier).
    expect(scoreState.multiplier).toBe(7);
    expect(scoreState.multiplierKills).toBe(3);
    // No death latch → no grid ripple, no death shake, no death SFX cue.
    expect(system.deathSeq).toBe(0);
    // The short escape window, assigned directly (never the full respawn window).
    expect(playerState.invulnMs).toBe(SHIELD_ABSORB_INVULN_MS);
    expect(SHIELD_ABSORB_INVULN_MS).toBeLessThan(PLAYER_INVULN_MS);
    // The enemy is untouched by the absorb itself (Lv1 has no knockback pulse).
    expect(enemyPool.activeCount).toBe(1);
  });

  it('a PROGRAMMATIC (pendingDeath) hit is absorbed identically, and the flag is still consumed', () => {
    // The Black Hole detonation / Mirror Reflector weight-kill path. It funnels through
    // the SAME shared body, so the shield covers it — a shield that lapsed here would be
    // the first guard in this system to discriminate between the two death paths.
    const { ship, playerState, scoreState, shieldSystem, system } =
      makeShieldedSystem(1);
    ship.x = 250;
    ship.y = 175;
    scoreState.multiplier = 4;
    playerState.pendingDeath = true;

    system.fixedUpdate(DT);

    expect(shieldSystem.charges).toBe(0);
    expect(shieldSystem.absorbSeq).toBe(1);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
    expect(ship.x).toBe(250); // not respawned to center
    expect(ship.y).toBe(175);
    expect(scoreState.multiplier).toBe(4);
    expect(system.deathSeq).toBe(0);
    expect(playerState.invulnMs).toBe(SHIELD_ABSORB_INVULN_MS);
    // The one-tick request is still consumed (read-and-clear), never deferred.
    expect(playerState.pendingDeath).toBe(false);
  });

  it('an absorbed hit on the LAST life continues the run (gameOver stays false)', () => {
    const { ship, enemyPool, playerState, shieldSystem, system } = makeShieldedSystem(1);
    playerState.lives = 1;
    ship.x = 400;
    ship.y = 400;
    addSeeker(enemyPool, 400, 400);

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(1);
    expect(playerState.gameOver).toBe(false);
    expect(shieldSystem.charges).toBe(0);
    expect(system.deathSeq).toBe(0);
  });

  it('an EMPTY shield falls through to the full v1 death flow, unchanged', () => {
    const { ship, enemyPool, playerState, scoreState, shieldSystem, system } =
      makeShieldedSystem(1);
    // Spend the charge, then take a hit with nothing left.
    expect(shieldSystem.tryAbsorb()).toBe(true);
    expect(shieldSystem.charges).toBe(0);
    ship.x = 100;
    ship.y = 100;
    scoreState.multiplier = 6;
    scoreState.multiplierKills = 2;
    addSeeker(enemyPool, 100, 100);

    system.fixedUpdate(DT);

    // Exactly the pre-10.4 behavior: life lost, respawn to center, full invuln window,
    // multiplier wiped, deathSeq bumped at the lethal-contact position.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
    expect(system.deathSeq).toBe(1);
    expect(system.deathX).toBe(100);
    expect(system.deathY).toBe(100);
  });

  it('spends NO charge while the player is already INVULNERABLE', () => {
    // The guards live in fixedUpdate ABOVE the _applyDeath call sites and stay there —
    // the shield check sits INSIDE the shared body, after they have already passed, so
    // a charge can never be spent on a hit that was never going to land.
    const { ship, enemyPool, playerState, shieldSystem, system } = makeShieldedSystem(1);
    playerState.invulnMs = 500;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);
    playerState.pendingDeath = true; // and a forced death too, for good measure

    system.fixedUpdate(DT);

    expect(shieldSystem.charges).toBe(1); // untouched
    expect(shieldSystem.absorbSeq).toBe(0);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.invulnMs).toBeCloseTo(500 - DT, 9); // the window just counts down
    expect(playerState.pendingDeath).toBe(false);
  });

  it('spends NO charge after GAME-OVER', () => {
    const { ship, enemyPool, playerState, shieldSystem, system } = makeShieldedSystem(1);
    playerState.lives = 0;
    playerState.gameOver = true;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);

    system.fixedUpdate(DT);

    expect(shieldSystem.charges).toBe(1);
    expect(shieldSystem.absorbSeq).toBe(0);
    expect(playerState.lives).toBe(0);
  });

  it('spends AT MOST ONE charge per tick with two overlapping enemies', () => {
    // The contact loop breaks after _applyDeath returns, so an absorb ends the scan
    // exactly as a death does — two enemies on the ship cost one charge, not two.
    const { ship, enemyPool, playerState, shieldSystem, system } = makeShieldedSystem(5);
    // Lv5: max 3 charges. Two overlapping enemies must still cost exactly one.
    expect(shieldSystem.charges).toBe(3);
    ship.x = 300;
    ship.y = 300;
    addSeeker(enemyPool, 300, 300);
    addSeeker(enemyPool, 300, 300);

    system.fixedUpdate(DT);

    expect(shieldSystem.charges).toBe(2);
    expect(shieldSystem.absorbSeq).toBe(1);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
  });

  it('the absorb i-frames stop consecutive-tick charge drain (the reason they are granted)', () => {
    // Without a window the lethal test would re-fire against the still-overlapping enemy
    // on the very next fixed step and drain a 3-charge shield in 3 ticks (50ms).
    const { ship, enemyPool, shieldSystem, system } = makeShieldedSystem(5);
    ship.x = 300;
    ship.y = 300;
    addSeeker(enemyPool, 300, 300); // parked on the ship, never moving

    // MEASURE the gap between consecutive absorbs rather than stepping a token few
    // ticks: at 3 ticks (50ms) this test passes for any window above ~34ms, which
    // leaves SHIELD_ABSORB_INVULN_MS — the constant the whole item rests on — unpinned
    // downward. The measured gap IS the window, so a retune has to move this number.
    system.fixedUpdate(DT); // the first contact: one absorb
    expect(shieldSystem.absorbSeq).toBe(1);
    expect(shieldSystem.charges).toBe(2);

    let ticks = 0;
    while (shieldSystem.absorbSeq === 1 && ticks < 600) {
      system.fixedUpdate(DT);
      ticks++;
    }
    expect(shieldSystem.absorbSeq).toBe(2); // it did eventually re-fire (not a hang)
    // The gap is the window itself, plus the tick that drains its last fraction and the
    // distinct VULNERABLE tick it ends on. Bounded rather than exact: where the
    // countdown crosses zero depends on float residue in 1000 / FIXED_STEP_MS, which is
    // not a property worth pinning — the DURATION is.
    expect(ticks * DT).toBeGreaterThanOrEqual(SHIELD_ABSORB_INVULN_MS);
    expect(ticks * DT).toBeLessThan(SHIELD_ABSORB_INVULN_MS + 3 * DT);
  });

  it('the absorb window is long enough to BE the escape it is documented as', () => {
    // The absorb deliberately leaves the ship in the swarm (no respawn teleport), so the
    // window is the only thing that gets the player clear. Its own comment justifies the
    // value by the distance it covers — pinned here against the game's own "clear of the
    // player" distance, so a retune that silently breaks the promise fails.
    //
    // Budgeted from a STANDSTILL, not from SHIP_MAX_SPEED. The constant's comment
    // explicitly disowns the top-speed figure as "the BEST case (already at top speed,
    // already pointed away)" and commits to the realistic one instead — an absorb usually
    // fires at rest or moving INTO the threat. Asserting the best case would pass at a
    // window far below what the comment promises, which is the whole failure this test
    // exists to catch.
    const seconds = SHIELD_ABSORB_INVULN_MS / 1000;
    const accelSeconds = Math.min(SHIP_MAX_SPEED / SHIP_ACCEL, seconds); // time to reach top speed
    const escapeDistance =
      0.5 * SHIP_ACCEL * accelSeconds * accelSeconds + SHIP_MAX_SPEED * (seconds - accelSeconds);
    expect(escapeDistance).toBeGreaterThan(SPAWN_SAFE_RADIUS);
    // …and it is genuinely the worst-case budget, strictly under the top-speed figure.
    expect(escapeDistance).toBeLessThan((SHIP_MAX_SPEED * SHIELD_ABSORB_INVULN_MS) / 1000);
    // Still strictly shorter than a respawn's window — an absorb is the cheaper event.
    expect(SHIELD_ABSORB_INVULN_MS).toBeLessThan(PLAYER_INVULN_MS);
  });

  it('a system built with NO shield argument is byte-identical to pre-10.4', () => {
    // The optional slot-5 injection: every existing caller and test stub constructs
    // without it, and must get the untouched v1 death flow.
    const { ship, enemyPool, playerState, system } = makeSystem();
    expect(system.shieldSystem).toBeNull();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(system.deathSeq).toBe(1);
  });

  it('the Lv5 FINAL break pulses through the death seam (enemies shoved, none killed)', () => {
    const { ship, enemyPool, playerState, shieldSystem, system } = makeShieldedSystem(5);
    ship.x = 600;
    ship.y = 360;
    const e = addSeeker(enemyPool, 600 + 20, 360);
    // Burn the first two charges outside the seam, so the next contact is the FINAL one.
    shieldSystem.tryAbsorb();
    shieldSystem.tryAbsorb();
    expect(shieldSystem.charges).toBe(1);
    expect(e.x).toBe(620); // no pulse on the non-final breaks

    system.fixedUpdate(DT);

    expect(shieldSystem.charges).toBe(0);
    expect(playerState.lives).toBe(PLAYER_START_LIVES); // still no life cost
    expect(e.x).toBeGreaterThan(620); // shoved outward by the break pulse
    expect(enemyPool.activeCount).toBe(1); // moved, never killed or released
  });
});

// --- Afterburner dash seams (Story 10.5) -------------------------------------
describe('PlayerDeathSystem — the Afterburner dash i-frames and cancel (Story 10.5)', () => {
  // Wired through the REAL DashSystem over the REAL fold of the SHIPPED registry, so
  // these cases fail if the registry numbers, the fold, the dash's window accounting or
  // the death-seam branches drift apart. The dash is an OPTIONAL 6th constructor arg,
  // mirroring `shieldSystem` at slot 5, so every pre-10.5 construction is untouched.

  function makeDashingSystem(level, { withShield = false } = {}) {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    const inputState = new InputState();
    const playerStats = createPlayerStats();
    const owned = { afterburner: level };
    if (withShield) owned['nanite-shield'] = 1;
    recomputePlayerStats(playerStats, owned, ITEM_REGISTRY);
    const collisionSystem = new CollisionSystem(new Pool(createBullet), [enemyPool]);
    const dashSystem = new DashSystem(
      ship,
      inputState,
      [enemyPool],
      collisionSystem,
      playerStats,
    );
    let shieldSystem = null;
    if (withShield) {
      // Story 12.5 — Phase Armor: collisionSystem is now required.
      shieldSystem = new NaniteShieldSystem(ship, [enemyPool], collisionSystem, playerStats);
      shieldSystem.fixedUpdate(DT);
    }
    const system = new PlayerDeathSystem(
      ship,
      [enemyPool],
      playerState,
      scoreState,
      shieldSystem,
      dashSystem,
    );
    return {
      ship,
      enemyPool,
      playerState,
      scoreState,
      inputState,
      dashSystem,
      shieldSystem,
      system,
    };
  }

  /** Open a dash and advance it to the first tick with the window PUBLISHED. */
  function openDash(h) {
    h.inputState.setMove(1, 0);
    h.inputState.queueDash();
    h.dashSystem.fixedUpdate(DT);
    h.dashSystem.fixedUpdate(DT);
    expect(h.dashSystem.movementActive).toBe(true);
  }

  it('Lv3+ i-frames: a lethal contact costs no life, no deathSeq, no multiplier reset, no shield charge', () => {
    const h = makeDashingSystem(3, { withShield: true });
    h.ship.x = 400;
    h.ship.y = 300;
    addSeeker(h.enemyPool, 400, 300);
    h.scoreState.multiplier = 6;
    h.scoreState.multiplierKills = 4;
    expect(h.shieldSystem.charges).toBe(1);
    openDash(h);

    h.system.fixedUpdate(DT);

    expect(h.playerState.lives).toBe(PLAYER_START_LIVES);
    expect(h.system.deathSeq).toBe(0);
    expect(h.scoreState.multiplier).toBe(6);
    expect(h.scoreState.multiplierKills).toBe(4);
    // The dash is the CHEAPER defense — the gate returns before _applyDeath, so no
    // charge is spent.
    expect(h.shieldSystem.charges).toBe(1);
    // Position kept (no respawn teleport).
    expect(h.ship.x).toBe(400);
    expect(h.ship.y).toBe(300);
  });

  it('Lv3+ i-frames SUPPRESS AND DROP a pendingDeath (never deferred to a later tick)', () => {
    const h = makeDashingSystem(3);
    openDash(h);
    h.playerState.pendingDeath = true;

    h.system.fixedUpdate(DT);
    expect(h.playerState.pendingDeath).toBe(false); // read-and-cleared at the top
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES);

    // Close the window; the dropped request must NOT re-fire.
    for (let i = 0; i < 20; i++) h.dashSystem.fixedUpdate(DT);
    expect(h.dashSystem.movementActive).toBe(false);
    h.system.fixedUpdate(DT);
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES);
    expect(h.system.deathSeq).toBe(0);
  });

  it('the i-frame gate counts NOTHING down (DashSystem owns the window)', () => {
    const h = makeDashingSystem(3);
    addSeeker(h.enemyPool, h.ship.x, h.ship.y);
    openDash(h);
    const remainingBefore = h.dashSystem.remainingMs;
    expect(h.playerState.invulnMs).toBe(0);
    h.system.fixedUpdate(DT);
    // No invuln consumed, and the dash window is untouched by this system.
    expect(h.playerState.invulnMs).toBe(0);
    expect(h.dashSystem.remainingMs).toBe(remainingBefore);
  });

  it('the ordinary death flow resumes the moment the window closes', () => {
    const h = makeDashingSystem(3);
    addSeeker(h.enemyPool, h.ship.x, h.ship.y);
    openDash(h);
    for (let i = 0; i < 30; i++) {
      h.system.fixedUpdate(DT);
      h.dashSystem.fixedUpdate(DT);
      if (!h.dashSystem.movementActive) break;
    }
    h.system.fixedUpdate(DT);
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(h.system.deathSeq).toBe(1);
  });

  it('Lv2 (no i-frames): the ordinary flow runs AND the dash is CANCELLED — contact path', () => {
    const h = makeDashingSystem(2);
    h.ship.x = 100;
    h.ship.y = 100;
    addSeeker(h.enemyPool, 100, 100);
    openDash(h);
    expect(h.dashSystem.active).toBe(true);
    const cooldown = h.dashSystem.cooldownRemainingMs;

    h.system.fixedUpdate(DT);

    expect(h.playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(h.system.deathSeq).toBe(1);
    expect(h.dashSystem.active).toBe(false);
    expect(h.dashSystem.movementActive).toBe(false);
    expect(h.dashSystem.remainingMs).toBe(0);
    // The dash was SPENT — the cooldown is not refunded.
    expect(h.dashSystem.cooldownRemainingMs).toBe(cooldown);
  });

  it('Lv2 (no i-frames): the dash is CANCELLED on the pendingDeath path too', () => {
    const h = makeDashingSystem(2);
    openDash(h);
    h.playerState.pendingDeath = true;
    h.system.fixedUpdate(DT);
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(h.dashSystem.active).toBe(false);
    expect(h.dashSystem.remainingMs).toBe(0);
  });

  it('a SHIELD ABSORB during an unprotected Lv2 dash does NOT cancel the dash', () => {
    // `cancel()` sits BELOW the shield's tryAbsorb guard in _applyDeath, and that
    // placement is load-bearing: an absorb is not a death — no life, no respawn, no
    // teleport — so there is no re-parked ship to fling out and nothing to cancel.
    // Hoisting the cancel above the absorb guard would silently eat the player's dash
    // mid-flight AND still burn its cooldown, on a hit that cost them nothing else.
    const h = makeDashingSystem(2, { withShield: true });
    h.ship.x = 420;
    h.ship.y = 260;
    addSeeker(h.enemyPool, 420, 260);
    expect(h.shieldSystem.charges).toBe(1);
    openDash(h);
    expect(h.dashSystem.active).toBe(true);
    const remainingBefore = h.dashSystem.remainingMs;
    const cooldownBefore = h.dashSystem.cooldownRemainingMs;

    h.system.fixedUpdate(DT);

    // The absorb happened: a charge spent, the life kept, the ship not teleported.
    expect(h.shieldSystem.charges).toBe(0);
    expect(h.shieldSystem.absorbSeq).toBe(1);
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES);
    expect(h.system.deathSeq).toBe(0);
    expect(h.ship.x).toBe(420);
    expect(h.ship.y).toBe(260);
    // …and the dash SURVIVED it, untouched.
    expect(h.dashSystem.active).toBe(true);
    expect(h.dashSystem.movementActive).toBe(true);
    expect(h.dashSystem.remainingMs).toBe(remainingBefore);
    expect(h.dashSystem.cooldownRemainingMs).toBe(cooldownBefore);
  });

  it('a FIVE-ARG construction is byte-identical to pre-10.5', () => {
    const { ship, enemyPool, playerState, system } = makeSystem();
    expect(system.dashSystem).toBeNull();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(ship.x).toBe(CENTER_X);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
  });

  it('WINDOW ALIGNMENT: the protected ticks are EXACTLY the ticks the ship travelled', () => {
    // Driven in WORLD ORDER — movement, then dash, then death — with a real
    // PlayerMovementSystem and a real DashSystem. The recorded tick sets must be
    // IDENTICAL: no leading protected-but-stationary tick, and (the defect this
    // replaces) no trailing travelling-but-unprotected tick.
    const h = makeDashingSystem(3);
    const movement = new PlayerMovementSystem(
      h.ship,
      h.inputState,
      { moveSpeedMult: 1.25 },
      h.dashSystem,
    );
    h.inputState.setMove(1, 0);
    h.inputState.queueDash();

    const travelled = [];
    const protectedTicks = [];
    for (let t = 0; t < 30; t++) {
      const before = { vx: h.ship.vx, vy: h.ship.vy };
      const wasDashing = h.dashSystem.active;
      movement.fixedUpdate(DT);
      if (wasDashing) travelled.push(t);
      h.dashSystem.fixedUpdate(DT);
      if (h.dashSystem.iFramesActive()) protectedTicks.push(t);
      h.system.fixedUpdate(DT);
      expect(before).toBeDefined();
    }
    expect(travelled.length).toBeGreaterThan(0);
    expect(protectedTicks).toEqual(travelled);
  });

  it('a death mid-Lv2-dash leaves the respawned ship AT ARENA CENTRE on the following ticks', () => {
    // Without the cancel the movement dash branch flings the freshly-respawned ship
    // ~238px back out during its invulnerability window.
    const h = makeDashingSystem(2);
    const movement = new PlayerMovementSystem(
      h.ship,
      h.inputState,
      { moveSpeedMult: 1.2 },
      h.dashSystem,
    );
    h.ship.x = 300;
    h.ship.y = 300;
    addSeeker(h.enemyPool, 300, 300);
    h.inputState.setMove(1, 0);
    h.inputState.queueDash();
    // Run world-ordered ticks until the death lands, then stop driving the stick so
    // any remaining displacement can only come from a live dash window.
    for (let t = 0; t < 20; t++) {
      movement.fixedUpdate(DT);
      h.dashSystem.fixedUpdate(DT);
      h.system.fixedUpdate(DT);
      if (h.playerState.lives < PLAYER_START_LIVES) break;
    }
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(h.dashSystem.active).toBe(false); // cancelled with the death
    expect(h.ship.x).toBe(CENTER_X);
    expect(h.ship.y).toBe(CENTER_Y);
    h.inputState.setMove(0, 0);
    for (let t = 0; t < 20; t++) {
      movement.fixedUpdate(DT);
      h.dashSystem.fixedUpdate(DT);
      h.system.fixedUpdate(DT);
    }
    // Still at centre. Without the cancel the dash branch would have driven it ~238px
    // away during the respawn's invulnerability window.
    expect(Math.hypot(h.ship.x - CENTER_X, h.ship.y - CENTER_Y)).toBeLessThan(1);
  });
});

// --- Phase Armor (Story 12.5 / Epic 12 — defense-transform Epic) ------------

describe('PlayerDeathSystem — Phase Armor (Story 12.5)', () => {
  it('phaseIntangible=true: _applyDeath returns early, no life lost', () => {
    const h = makeSystem({});
    // Set phaseIntangible as Phase Armor would.
    h.playerState.phaseIntangible = true;
    // Place enemy in contact.
    addSeeker(h.enemyPool, h.ship.x, h.ship.y);
    // Record pre-death state.
    const preLives = h.playerState.lives;
    const preSeq = h.system.deathSeq;
    h.system.fixedUpdate(DT);
    // Death should be absorbed: lives unchanged, no deathSeq bump.
    expect(h.playerState.lives).toBe(preLives);
    expect(h.system.deathSeq).toBe(preSeq);
    expect(h.playerState.phaseIntangible).toBe(true); // still active
  });

  it('phaseIntangible=true: game-over does NOT gate the phase absorb', () => {
    const h = makeSystem({});
    h.playerState.lives = 1;
    h.playerState.gameOver = false;
    h.playerState.phaseIntangible = true;
    addSeeker(h.enemyPool, h.ship.x, h.ship.y);
    h.system.fixedUpdate(DT);
    // Should NOT have gone to game-over; life preserved.
    expect(h.playerState.gameOver).toBe(false);
    expect(h.playerState.lives).toBe(1);
  });

  it('phaseIntangible=false: normal death flow proceeds', () => {
    const h = makeSystem({});
    // phaseIntangible starts as false.
    expect(h.playerState.phaseIntangible).toBe(false);
    addSeeker(h.enemyPool, h.ship.x, h.ship.y);
    h.system.fixedUpdate(DT);
    // Normal death: life deducted.
    expect(h.playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(h.system.deathSeq).toBe(1);
  });
});

// --- Revenant (Story 12.14 / Epic 12 — defense Epic) ------------------------

describe('PlayerDeathSystem — Revenant (Story 12.14)', () => {
  // Build a ship, seeker pool, player state, score state, bombSystem stub,
  // and a death system with revenantActive and bombSystem wired in.
  function makeRevenantSystem() {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    const bombSystem = {
      detonateAt: vi.fn(),
    };
    const system = new PlayerDeathSystem(
      ship,
      [enemyPool],
      playerState,
      scoreState,
      null, // shieldSystem
      null, // dashSystem
      null, // playerStats
      bombSystem, // bombSystem (Story 12.14)
    );
    return { ship, enemyPool, playerState, scoreState, bombSystem, system };
  }

  it('revenantActive=false: no bomb fires on death', () => {
    const { ship, enemyPool, scoreState, bombSystem, system } = makeRevenantSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping → death
    scoreState.multiplier = 5;

    system.fixedUpdate(DT);

    // Normal death: life lost, multiplier reset, no bomb.
    expect(bombSystem.detonateAt).not.toHaveBeenCalled();
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
  });

  it('revenantActive=true: bomb fires at death point on death', () => {
    const { ship, enemyPool, playerState, scoreState, bombSystem, system } =
      makeRevenantSystem();
    ship.x = 250;
    ship.y = 175;
    addSeeker(enemyPool, 250, 175); // overlapping → death
    system.revenantActive = true;

    system.fixedUpdate(DT);

    // Bomb detonates at the death point (ship position BEFORE respawn).
    // Exactly two args: Revenant reuses the ordinary clear and must not opt into
    // queued-player-bomb-only targets such as Mirror Reflectors.
    expect(bombSystem.detonateAt).toHaveBeenCalledWith(250, 175);
  });

  it('revenantActive=true: multiplier is kept (not reset to 1×)', () => {
    const { ship, enemyPool, playerState, scoreState, bombSystem, system } =
      makeRevenantSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping → death
    system.revenantActive = true;
    scoreState.multiplier = 8;
    scoreState.multiplierKills = 3;

    system.fixedUpdate(DT);

    // Multiplier stays at 8×, multiplierKills reset to 0.
    expect(scoreState.multiplier).toBe(8);
    expect(scoreState.multiplierKills).toBe(0);
    // Life lost, respawn occurs.
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
  });

  it('revenantActive=false: multiplier resets to 1× (regression check)', () => {
    const { ship, enemyPool, scoreState, system } = makeRevenantSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100); // overlapping → death
    scoreState.multiplier = 6;
    scoreState.multiplierKills = 4;

    system.fixedUpdate(DT);

    // Standard death: full multiplier reset.
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('revenantActive=true + game-over: bomb fires and game-over still sets', () => {
    const { ship, enemyPool, playerState, scoreState, bombSystem, system } =
      makeRevenantSystem();
    playerState.lives = 1; // last life
    ship.x = 90;
    ship.y = 610;
    addSeeker(enemyPool, 90, 610);
    system.revenantActive = true;
    scoreState.multiplier = 10;

    system.fixedUpdate(DT);

    // Bomb fires even on game-over.
    expect(bombSystem.detonateAt).toHaveBeenCalledWith(90, 610);
    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
    // Multiplier technically kept (not reset), but run is over.
    expect(scoreState.multiplier).toBe(10);
  });

  it('bombSystem=null: no crash when revenantActive=true', () => {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    // No bombSystem (null).
    const system = new PlayerDeathSystem(
      ship,
      [enemyPool],
      playerState,
      scoreState,
      null,
      null,
      null,
      null, // bombSystem = null
    );
    system.revenantActive = true;
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);

    // Should not throw even though bombSystem is null (optional chaining handles it).
    expect(() => system.fixedUpdate(DT)).not.toThrow();
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
  });

  it('existing contact-death behavior unchanged (negative control)', () => {
    const { ship, enemyPool, playerState, scoreState, system } = makeRevenantSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);
    scoreState.multiplier = 7;
    scoreState.multiplierKills = 3;

    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS);
    expect(ship.x).toBe(CENTER_X);
    expect(ship.y).toBe(CENTER_Y);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('revenantActive=true: death point latched correctly for bomb origin', () => {
    const { ship, enemyPool, playerState, scoreState, bombSystem, system } =
      makeRevenantSystem();
    ship.x = 400;
    ship.y = 200;
    addSeeker(enemyPool, 400, 200); // overlapping → death
    system.revenantActive = true;

    system.fixedUpdate(DT);

    // Death point latches the ship position at contact, BEFORE respawn.
    expect(system.deathX).toBe(400);
    expect(system.deathY).toBe(200);
    // Bomb fires at that same point.
    expect(bombSystem.detonateAt).toHaveBeenCalledWith(400, 200);
  });

  it('revenantActive=true at multiplier 1×: no-op multiplier, bomb still fires', () => {
    const { ship, enemyPool, scoreState, bombSystem, system } = makeRevenantSystem();
    ship.x = 100;
    ship.y = 100;
    addSeeker(enemyPool, 100, 100);
    system.revenantActive = true;
    scoreState.multiplier = 1;

    system.fixedUpdate(DT);

    expect(bombSystem.detonateAt).toHaveBeenCalled();
    expect(scoreState.multiplier).toBe(1); // no change to make
  });
});
