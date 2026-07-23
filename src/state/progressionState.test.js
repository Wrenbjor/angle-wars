import { describe, it, expect } from 'vitest';
import { createProgressionState, applyCard } from './ProgressionState.js';

// Story 8.3 — the run-scoped card-progression state. Pure data + a pure applyCard;
// no Phaser, no ticks. Mirrors ScoreState's discipline.

describe('createProgressionState — fresh run-scoped state', () => {
  it('starts with no cards owned and a zero debug stat', () => {
    const state = createProgressionState();
    expect(state).toEqual({ ownedCards: {}, debugStat: 0 });
  });

  it('returns a fresh independent object each call (run-scoped rebuild)', () => {
    const a = createProgressionState();
    const b = createProgressionState();
    expect(a).not.toBe(b);
    expect(a.ownedCards).not.toBe(b.ownedCards);
  });
});

describe('applyCard — stack the stat + record ownership', () => {
  it('increments debugStat by statDelta and records the card id at count 1', () => {
    const state = createProgressionState();
    applyCard(state, { id: 'x', statDelta: 3 });
    expect(state.debugStat).toBe(3);
    expect(state.ownedCards.x).toBe(1);
  });

  it('same card twice → count 2 and doubled debugStat (ownership is a count/level)', () => {
    const state = createProgressionState();
    const card = { id: 'x', statDelta: 2 };
    applyCard(state, card);
    applyCard(state, card);
    expect(state.ownedCards.x).toBe(2);
    expect(state.debugStat).toBe(4);
  });

  it('two different cards → both recorded, stats summed', () => {
    const state = createProgressionState();
    applyCard(state, { id: 'a', statDelta: 1 });
    applyCard(state, { id: 'b', statDelta: 5 });
    expect(state.ownedCards).toEqual({ a: 1, b: 1 });
    expect(state.debugStat).toBe(6);
  });
});
