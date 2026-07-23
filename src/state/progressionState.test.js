import { describe, it, expect } from 'vitest';
import { createProgressionState, applyCard } from './ProgressionState.js';
import {
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
} from '../config/constants.js';

// Story 8.3/8.5 — the run-scoped card-progression state. Pure data + a pure applyCard;
// no Phaser, no ticks. Mirrors ScoreState's discipline. Story 8.5 added the reroll/banish
// charge economies + the banished-id set.

describe('createProgressionState — fresh run-scoped state', () => {
  it('starts with no cards owned, a zero debug stat, the starting reroll/banish charges, and an empty banished set', () => {
    const state = createProgressionState();
    expect(state.ownedCards).toEqual({});
    expect(state.debugStat).toBe(0);
    expect(state.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    expect(state.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(state.banishedIds).toBeInstanceOf(Set);
    expect(state.banishedIds.size).toBe(0);
  });

  it('returns a fresh independent object each call (run-scoped rebuild), with a distinct banished Set', () => {
    const a = createProgressionState();
    const b = createProgressionState();
    expect(a).not.toBe(b);
    expect(a.ownedCards).not.toBe(b.ownedCards);
    // The banished Set is per-instance (a mutation on one run never bleeds into another).
    expect(a.banishedIds).not.toBe(b.banishedIds);
    a.banishedIds.add('off-rapid');
    expect(b.banishedIds.size).toBe(0);
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
