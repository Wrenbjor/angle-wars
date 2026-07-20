import { describe, it, expect } from 'vitest';
import { buildArenaWorld } from '../scenes/buildArenaWorld.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createSeeker } from '../entities/Seeker.js';
import {
  FIXED_STEP_MS,
  SEEKER_SCORE,
  SCORE_MULTIPLIER_START,
  SCORE_MULTIPLIER_KILLS_PER_STEP,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Cross-system integration for the Story 3.1 "keep the points, lose the streak"
// property. The unit tests exercise ScoringSystem and PlayerDeathSystem in
// isolation; this file composes the REAL systems (via the shared buildArenaWorld
// factory — the SAME construction ArenaScene uses) over ONE shared ScoreState and
// drives only the Scoring THEN PlayerDeath slice of the chain.
//
// That ordering is the load-bearing guarantee from the spec's Design Notes: a
// kill-and-die on the same tick is scored at the pre-death multiplier first, and
// only then does the death wipe the streak. Phaser-free. Because this file's
// runTick invokes ONLY scoringSystem → playerDeathSystem, the factory's real
// collisionSystem never has its fixedUpdate called, so each test drives scoring by
// assigning `ctx.collisionSystem.killedEnemies = [...]` directly and the value
// persists across the tick (nothing resets it); the death seam reads the real
// seeker enemy Pool.

// Compose the real chain via the shared factory — the SAME construction (order,
// pools, late-binds) ArenaScene uses — then pull the handles this file drives.
// runTick calls ONLY scoring → death, so the factory's real collisionSystem never
// has its fixedUpdate invoked; each test drives scoring by assigning
// ctx.collisionSystem.killedEnemies directly (nothing resets it here). The seeker
// pool is the archetype pool the death seam contacts. Factory used for
// CONSTRUCTION only.
function makeComposed() {
  const ctx = buildArenaWorld();
  return {
    ...ctx,
    enemyPool: ctx.enemySystem.enemyPool,
  };
}

// One simulated fixed tick in ArenaScene's order: Scoring runs, then PlayerDeath.
function runTick({ scoringSystem, playerDeathSystem }) {
  scoringSystem.fixedUpdate(DT);
  playerDeathSystem.fixedUpdate(DT);
}

// Place an ACTIVE (telegraphMs 0) enemy overlapping the ship so the death seam
// registers a lethal contact this tick.
function addOverlappingEnemy(enemyPool, ship) {
  const s = enemyPool.acquire();
  s.x = ship.x;
  s.y = ship.y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = 0; // active → lethal
  return s;
}

describe('Score multiplier integration — Scoring then PlayerDeath, one shared ScoreState', () => {
  it('same-tick kill + death: scores at the pre-death multiplier, then wipes the streak', () => {
    const ctx = makeComposed();
    const { ship, collisionSystem, enemyPool, scoreState, playerState } = ctx;
    // A climbed multiplier before the tick.
    scoreState.multiplier = 4;
    scoreState.multiplierKills = 0;
    // Fix the ship position; place an active overlapping enemy for the death seam.
    ship.x = 300;
    ship.y = 300;
    addOverlappingEnemy(enemyPool, ship);
    // A killed seeker credited by the scoring seam this same tick.
    collisionSystem.killedEnemies = [createSeeker()];

    runTick(ctx);

    // Scored at the pre-death multiplier (4×), because Scoring ran before Death.
    expect(scoreState.score).toBe(SEEKER_SCORE * 4);
    // A life was lost this tick.
    expect(playerState.lives).toBeLessThan(createPlayerState().lives);
    // The streak was wiped that same tick (multiplier + progress back to start/0).
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('keep-the-points: the accrued score survives the death reset (not zeroed)', () => {
    const ctx = makeComposed();
    const { ship, collisionSystem, enemyPool, scoreState } = ctx;
    scoreState.multiplier = 4;
    ship.x = 300;
    ship.y = 300;
    addOverlappingEnemy(enemyPool, ship);
    collisionSystem.killedEnemies = [createSeeker()];

    runTick(ctx);

    const earned = SEEKER_SCORE * 4;
    expect(scoreState.score).toBe(earned);
    // Reset touched only the multiplier + progress, never the accrued score.
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.score).toBe(earned);
  });

  it('climb-then-die: kill-only ticks step the multiplier up, then a death resets it while keeping the score', () => {
    const ctx = makeComposed();
    const { ship, collisionSystem, enemyPool, scoreState, playerState } = ctx;
    // Keep the ship away from any enemy during the climb (no death pool contact).
    ship.x = 300;
    ship.y = 300;

    // Kill-only ticks (scoring runs, no overlapping enemy) to cross one full step
    // and advance into the next, so the multiplier is provably above start.
    const killOnlyTicks = SCORE_MULTIPLIER_KILLS_PER_STEP + 1;
    for (let i = 0; i < killOnlyTicks; i++) {
      collisionSystem.killedEnemies = [createSeeker()];
      runTick(ctx); // death seam finds no enemy → no reset
    }
    expect(scoreState.multiplier).toBeGreaterThan(SCORE_MULTIPLIER_START);
    expect(playerState.lives).toBe(createPlayerState().lives); // no death yet
    const scoreBeforeDeath = scoreState.score;
    expect(scoreBeforeDeath).toBeGreaterThan(0);

    // Now a death tick: no new kill, but an overlapping active enemy is present.
    collisionSystem.killedEnemies = [];
    addOverlappingEnemy(enemyPool, ship);
    runTick(ctx);

    // Multiplier + progress reset to start/0; the accrued score is retained.
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
    expect(scoreState.score).toBe(scoreBeforeDeath);
    expect(playerState.lives).toBeLessThan(createPlayerState().lives);
  });
});
