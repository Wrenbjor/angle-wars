import { describe, it, expect } from 'vitest';
import { HighScoreSystem } from './HighScoreSystem.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import { FIXED_STEP_MS } from '../config/constants.js';

const DT = FIXED_STEP_MS;

// A fake guarded port recording load()/save() calls, seeded with a stored high.
function makeFakePort(stored = 0) {
  return {
    stored,
    saves: [],
    load() {
      return this.stored;
    },
    save(score) {
      this.saves.push(score);
      this.stored = score;
    },
  };
}

// Build a HighScoreSystem over fresh shared state and a fake port at a given
// stored baseline.
function makeSystem({ stored = 0 } = {}) {
  const scoreState = createScoreState();
  const playerState = createPlayerState();
  const port = makeFakePort(stored);
  const system = new HighScoreSystem(scoreState, playerState, port);
  return { system, scoreState, playerState, port };
}

describe('HighScoreSystem — construction seeds from the port', () => {
  it('a fresh run with nothing stored starts highScore at 0', () => {
    const { system, port } = makeSystem({ stored: 0 });
    expect(system.highScore).toBe(0);
    // load() called exactly once at construction.
    expect(port.saves.length).toBe(0);
  });

  it('seeds highScore from the persisted baseline on a fresh run', () => {
    const { system } = makeSystem({ stored: 7500 });
    expect(system.highScore).toBe(7500);
  });
});

describe('HighScoreSystem — live tracking during a run', () => {
  it('highScore climbs to track the running best each tick (before game-over)', () => {
    const { system, scoreState } = makeSystem({ stored: 1000 });

    // Below the persisted value: display stays at the persisted baseline.
    scoreState.score = 500;
    system.fixedUpdate(DT);
    expect(system.highScore).toBe(1000);

    // Past the persisted value: display climbs to track the run's best.
    scoreState.score = 1500;
    system.fixedUpdate(DT);
    expect(system.highScore).toBe(1500);

    scoreState.score = 3000;
    system.fixedUpdate(DT);
    expect(system.highScore).toBe(3000);
  });

  it('never writes the score or the gameOver flag (reads only)', () => {
    const { system, scoreState, playerState } = makeSystem({ stored: 0 });
    scoreState.score = 4242;
    system.fixedUpdate(DT);
    expect(scoreState.score).toBe(4242);
    expect(playerState.gameOver).toBe(false);
  });
});

describe('HighScoreSystem — persist on the game-over edge (FR11)', () => {
  it('a run that beats the stored high saves once with the new high', () => {
    const { system, scoreState, playerState, port } = makeSystem({ stored: 1000 });

    // Drive the score up over the run.
    scoreState.score = 5000;
    system.fixedUpdate(DT);
    expect(port.saves.length).toBe(0); // not persisted mid-run

    // Game-over latches this tick.
    playerState.gameOver = true;
    system.fixedUpdate(DT);

    expect(port.saves).toEqual([5000]);
    expect(system.highScore).toBe(5000);
  });

  it('a run that ends below the stored high writes nothing; display stays at the persisted value', () => {
    const { system, scoreState, playerState, port } = makeSystem({ stored: 8000 });

    scoreState.score = 3000;
    system.fixedUpdate(DT);
    playerState.gameOver = true;
    system.fixedUpdate(DT);

    expect(port.saves).toEqual([]);
    expect(system.highScore).toBe(8000); // persisted value still shown
  });

  it('a final score exactly equal to the stored high is not a "beat" — no write', () => {
    const { system, scoreState, playerState, port } = makeSystem({ stored: 4000 });

    scoreState.score = 4000; // exactly equal
    system.fixedUpdate(DT);
    playerState.gameOver = true;
    system.fixedUpdate(DT);

    expect(port.saves).toEqual([]);
    expect(system.highScore).toBe(4000);
  });

  it('persists at most once across extra fixedUpdate calls after game-over (idempotent)', () => {
    const { system, scoreState, playerState, port } = makeSystem({ stored: 100 });

    scoreState.score = 9000;
    system.fixedUpdate(DT);
    playerState.gameOver = true;

    // The latching tick plus several extra ungated ticks.
    system.fixedUpdate(DT);
    system.fixedUpdate(DT);
    system.fixedUpdate(DT);

    expect(port.saves).toEqual([9000]); // exactly one write for the run
  });

  it('re-reads the stored value at write time so a concurrent tab is not clobbered', () => {
    // This tab constructs with baseline B and its run rises to S (B < S), so by the
    // construction-time baseline alone it would "beat" and write. But before the
    // game-over tick another tab persists a HIGHER value B2 (B2 > S) into the shared
    // store. The fresh load() at the write moment sees B2 ≥ S, so this run did NOT
    // beat the CURRENT stored value → no save, and B2 is left intact.
    const B = 1000;
    const { system, scoreState, playerState, port } = makeSystem({ stored: B });

    const S = 5000;
    scoreState.score = S;
    system.fixedUpdate(DT);
    expect(system.highScore).toBe(S);

    // Another tab raises the shared stored value above this run's high.
    const B2 = 9000;
    port.stored = B2;

    playerState.gameOver = true;
    system.fixedUpdate(DT);

    expect(port.saves).toEqual([]); // never wrote over the higher concurrent value
    expect(port.stored).toBe(B2); // the other tab's higher score is preserved
  });

  it('a beating run persists the beaten score on the same tick game-over latches', () => {
    const { system, scoreState, playerState, port } = makeSystem({ stored: 2000 });

    // Score climbs past the stored high AND game-over latches on the SAME tick —
    // the after-PlayerDeath placement this rests on.
    scoreState.score = 6000;
    playerState.gameOver = true;
    system.fixedUpdate(DT);

    expect(port.saves).toEqual([6000]);
    expect(system.highScore).toBe(6000);
  });
});
