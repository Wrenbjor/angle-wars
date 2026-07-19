import { describe, it, expect } from 'vitest';
import { ScoringSystem } from './ScoringSystem.js';
import { createScoreState } from '../state/ScoreState.js';
import { createSeeker } from '../entities/Seeker.js';
import { FIXED_STEP_MS, SEEKER_SCORE } from '../config/constants.js';

const DT = FIXED_STEP_MS;

// A minimal stand-in for CollisionSystem: the ScoringSystem only reads the
// public `killedSeekers` array, so a plain object with that field is enough to
// drive every I/O-matrix row without the collision machinery.
function makeSystem() {
  const collisionSystem = { killedSeekers: [] };
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
    collisionSystem.killedSeekers = [createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(SEEKER_SCORE);
  });

  it('adds the sum of base values for multiple kills in one tick', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedSeekers = [createSeeker(), createSeeker(), createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(3 * SEEKER_SCORE);
  });

  it('accumulates kills across ticks', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedSeekers = [createSeeker()];
    system.fixedUpdate(DT);
    collisionSystem.killedSeekers = [createSeeker()];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(2 * SEEKER_SCORE);
  });

  it('does not re-count a prior tick when the next tick has no kills', () => {
    const { collisionSystem, scoreState, system } = makeSystem();
    collisionSystem.killedSeekers = [createSeeker()];
    system.fixedUpdate(DT);
    // A real CollisionSystem resets killedSeekers each tick; emulate an empty tick.
    collisionSystem.killedSeekers = [];
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(SEEKER_SCORE);
  });
});
