import { describe, it, expect } from 'vitest';
import { ScoringSystem } from './ScoringSystem.js';
import { createScoreState } from '../state/ScoreState.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import {
  FIXED_STEP_MS,
  SEEKER_SCORE,
  GREEN_SQUARE_SCORE,
  SCORE_MULTIPLIER_START,
  SCORE_MULTIPLIER_MAX,
  SCORE_MULTIPLIER_KILLS_PER_STEP,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// A minimal stand-in for CollisionSystem: the ScoringSystem only reads the
// public `killedEnemies` array, so a plain object with that field is enough to
// drive every I/O-matrix row without the collision machinery.
function makeSystem() {
  const collisionSystem = { killedEnemies: [] };
  const scoreState = createScoreState();
  const system = new ScoringSystem(collisionSystem, scoreState);
  return { collisionSystem, scoreState, system };
}

describe('ScoringSystem', () => {
  it('leaves the score unchanged when no seekers were killed this tick', () => {
    const { scoreState, system } = makeSystem();
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(0);
  });

  it('adds one seeker base value for a single kill', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedEnemies = [createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(SEEKER_SCORE);
  });

  it('adds the sum of base values for multiple kills in one tick', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedEnemies = [createSeeker(), createSeeker(), createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(3 * SEEKER_SCORE);
  });

  it('credits each archetype its own base value (mixed seeker + green square)', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    // A type-agnostic seam: a seeker and a green square killed the same tick
    // each contribute their own per-instance base score.
    collisionSystem.killedEnemies = [createSeeker(), createGreenSquare()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(SEEKER_SCORE + GREEN_SQUARE_SCORE);
  });

  it('accumulates kills across ticks', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedEnemies = [createSeeker()];
    system.fixedUpdate(DT);
    collisionSystem.killedEnemies = [createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(2 * SEEKER_SCORE);
  });

  it('does not re-count a prior tick when the next tick has no kills', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedEnemies = [createSeeker()];
    system.fixedUpdate(DT);
    // A real CollisionSystem resets killedEnemies each tick; emulate an empty tick.
    collisionSystem.killedEnemies = [];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(SEEKER_SCORE);
  });
});

describe('ScoringSystem — score multiplier (Story 3.1, FR7/FR8)', () => {
  // Build N seekers to kill in a single tick.
  function seekers(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(createSeeker());
    return out;
  }

  it('starts at the configured start multiplier with zero progress', () => {
    const { scoreState } = makeSystem();
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('no kills this tick leaves score, multiplier, and progress unchanged', () => {
    const { scoreState, system } = makeSystem();
    scoreState.multiplier = 4;
    scoreState.multiplierKills = 2;
    scoreState.score = 500;
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(500);
    expect(scoreState.multiplier).toBe(4);
    expect(scoreState.multiplierKills).toBe(2);
  });

  it('awards base × current multiplier (single kill above 1×)', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    scoreState.multiplier = 3;
    collisionSystem.killedEnemies = [createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(SEEKER_SCORE * 3);
  });

  it('each archetype is multiplied by its own base × the shared multiplier', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    scoreState.multiplier = 2;
    collisionSystem.killedEnemies = [createSeeker(), createGreenSquare()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe((SEEKER_SCORE + GREEN_SQUARE_SCORE) * 2);
  });

  it('a single kill advances the multiplier progress by one', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedEnemies = [createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.multiplierKills).toBe(1);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
  });

  it('steps the multiplier up after kills-per-step kills, resetting progress', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedEnemies = seekers(SCORE_MULTIPLIER_KILLS_PER_STEP);
    system.fixedUpdate(DT);
    // All KILLS_PER_STEP kills scored at the pre-step (start) multiplier.
    expect(scoreState.score).toBe(
      SCORE_MULTIPLIER_KILLS_PER_STEP * SEEKER_SCORE * SCORE_MULTIPLIER_START,
    );
    // The step-up happened after those awards.
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START + 1);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('the triggering kill is scored at the pre-step multiplier; a later kill same tick uses the new one', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    // One more than a full step: the first KILLS_PER_STEP score at start×, the
    // extra kill scores at the stepped-up multiplier.
    collisionSystem.killedEnemies = seekers(SCORE_MULTIPLIER_KILLS_PER_STEP + 1);
    system.fixedUpdate(DT);
    const expected =
      SCORE_MULTIPLIER_KILLS_PER_STEP * SEEKER_SCORE * SCORE_MULTIPLIER_START +
      SEEKER_SCORE * (SCORE_MULTIPLIER_START + 1);
    expect(scoreState.score).toBe(expected);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START + 1);
    expect(scoreState.multiplierKills).toBe(1);
  });

  it('never exceeds the cap: at the cap, kills score at the cap and progress stays frozen', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    scoreState.multiplier = SCORE_MULTIPLIER_MAX;
    scoreState.multiplierKills = 0;
    collisionSystem.killedEnemies = seekers(SCORE_MULTIPLIER_KILLS_PER_STEP + 3);
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(
      (SCORE_MULTIPLIER_KILLS_PER_STEP + 3) * SEEKER_SCORE * SCORE_MULTIPLIER_MAX,
    );
    // Never past the cap, and progress is frozen once capped.
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_MAX);
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('climbs from start to the cap over sustained kills and holds there', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    // Enough kills to run well past the cap: (steps needed) × per-step, plus extra.
    const stepsToCap = SCORE_MULTIPLIER_MAX - SCORE_MULTIPLIER_START;
    const total = stepsToCap * SCORE_MULTIPLIER_KILLS_PER_STEP + 10;
    for (let i = 0; i < total; i++) {
      collisionSystem.killedEnemies = [createSeeker()];
      system.fixedUpdate(DT);
    }
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_MAX);
  });
});
