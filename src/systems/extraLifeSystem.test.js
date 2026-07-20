import { describe, it, expect } from 'vitest';
import { ExtraLifeSystem } from './ExtraLifeSystem.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import {
  FIXED_STEP_MS,
  PLAYER_START_LIVES,
  LIFE_AWARD_SCORE_THRESHOLDS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const [T1, T2, T3, T4] = LIFE_AWARD_SCORE_THRESHOLDS;

// Build an ExtraLifeSystem over fresh shared state, optionally at a seed score
// (to exercise the construction-time cursor seeding).
function makeSystem({ score = 0 } = {}) {
  const scoreState = createScoreState();
  scoreState.score = score;
  const playerState = createPlayerState();
  const system = new ExtraLifeSystem(scoreState, playerState);
  return { system, scoreState, playerState };
}

describe('LIFE_AWARD_SCORE_THRESHOLDS — the tunable milestone list (FR10)', () => {
  it('is a defined, finite, strictly ascending list (not a repeating interval)', () => {
    expect(Array.isArray(LIFE_AWARD_SCORE_THRESHOLDS)).toBe(true);
    expect(LIFE_AWARD_SCORE_THRESHOLDS.length).toBeGreaterThan(0);
    for (let i = 1; i < LIFE_AWARD_SCORE_THRESHOLDS.length; i++) {
      expect(LIFE_AWARD_SCORE_THRESHOLDS[i]).toBeGreaterThan(
        LIFE_AWARD_SCORE_THRESHOLDS[i - 1],
      );
    }
  });
});

describe('ExtraLifeSystem — milestone extra-life award (FR10)', () => {
  it('a fresh run stays at PLAYER_START_LIVES until the first threshold', () => {
    const { system, scoreState, playerState } = makeSystem();
    expect(playerState.lives).toBe(PLAYER_START_LIVES);

    // Score grows but stays below the first threshold: no award.
    scoreState.score = T1 - 1;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
  });

  it('awards one life when the score crosses a single threshold', () => {
    const { system, scoreState, playerState } = makeSystem();

    scoreState.score = T1 + 1;
    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES + 1);
    expect(system._nextThresholdIndex).toBe(1); // cursor advanced past T1
  });

  it('awards one life per threshold when a single tick jumps past several', () => {
    const { system, scoreState, playerState } = makeSystem();

    // One tick jumps from below T1 to past T3 → three lives (T1, T2, T3).
    scoreState.score = T3 + 1;
    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES + 3);
    expect(system._nextThresholdIndex).toBe(3);
  });

  it('awards nothing when the score grows but crosses no threshold', () => {
    const { system, scoreState, playerState } = makeSystem();

    // Cross T1 first (one award), then grow within [T1, T2): no further award.
    scoreState.score = T1 + 1;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES + 1);

    scoreState.score = T2 - 1;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES + 1); // unchanged
    expect(system._nextThresholdIndex).toBe(1); // cursor unchanged
  });

  it('landing exactly ON a threshold counts as crossing it', () => {
    const { system, scoreState, playerState } = makeSystem();

    scoreState.score = T1; // exactly equal
    system.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES + 1);
  });

  it('no-ops once every threshold has been awarded (exhausted list)', () => {
    const { system, scoreState, playerState } = makeSystem();

    // Blow past the last threshold in one tick → all lives awarded.
    scoreState.score = T4 + 1;
    system.fixedUpdate(DT);
    const livesAfterAll = playerState.lives;
    expect(livesAfterAll).toBe(PLAYER_START_LIVES + LIFE_AWARD_SCORE_THRESHOLDS.length);
    expect(system._nextThresholdIndex).toBe(LIFE_AWARD_SCORE_THRESHOLDS.length);

    // Any further score growth awards nothing.
    scoreState.score = T4 * 100;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(livesAfterAll);
  });

  it('seeds the cursor past thresholds already at/below the construction score (no retroactive award)', () => {
    // Constructed at a score already past T1 and T2.
    const { system, scoreState, playerState } = makeSystem({ score: T2 + 1 });

    // The already-passed thresholds are seeded past, never awarded.
    expect(system._nextThresholdIndex).toBe(2);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);

    // A first tick at the same score awards nothing (they are not retroactive).
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);

    // Only crossing the NEXT unawarded threshold (T3) awards.
    scoreState.score = T3;
    system.fixedUpdate(DT);
    expect(playerState.lives).toBe(PLAYER_START_LIVES + 1);
  });

  it('never writes the score (reads it only)', () => {
    const { system, scoreState } = makeSystem();
    scoreState.score = T1 + 1;
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(T1 + 1); // untouched by the award
  });
});
