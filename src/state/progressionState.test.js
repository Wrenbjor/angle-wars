import { describe, it, expect } from 'vitest';
import {
  createProgressionState,
  applyCard,
  getLevel,
  isOwned,
  isMaxed,
  isRemnant,
  markRemnant,
  slotOccupancy,
} from './ProgressionState.js';
import {
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
  ITEM_MAX_LEVEL,
  ITEM_REMNANT_LEVEL,
} from '../config/constants.js';

// Story 8.3/8.5/10.1 — the run-scoped card-progression state. Pure data + pure helpers;
// no Phaser, no ticks. Mirrors ScoreState's discipline. Story 10.1: applyCard now caps
// the owned COUNT (= the item level) at the card's maxLevel and drops statDelta (the
// legacy debugStat is now just a pick counter); remnant state + the framework query
// helpers (getLevel/isOwned/isMaxed/isRemnant/markRemnant/slotOccupancy) land here.

// A minimal item-definition fixture (duck-compatible with a registry entry).
function item(id, track, maxLevel = ITEM_MAX_LEVEL) {
  return { id, track, maxLevel };
}

describe('createProgressionState — fresh run-scoped state', () => {
  it('starts empty: no cards, zero debug stat, starting charges, empty banished + remnant sets', () => {
    const state = createProgressionState();
    expect(state.ownedCards).toEqual({});
    expect(state.debugStat).toBe(0);
    expect(state.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    expect(state.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(state.banishedIds).toBeInstanceOf(Set);
    expect(state.banishedIds.size).toBe(0);
    expect(state.remnantIds).toBeInstanceOf(Set);
    expect(state.remnantIds.size).toBe(0);
  });

  it('returns a fresh independent object each call, with distinct banished + remnant Sets', () => {
    const a = createProgressionState();
    const b = createProgressionState();
    expect(a).not.toBe(b);
    expect(a.ownedCards).not.toBe(b.ownedCards);
    expect(a.banishedIds).not.toBe(b.banishedIds);
    expect(a.remnantIds).not.toBe(b.remnantIds);
    a.remnantIds.add('overcharge');
    expect(b.remnantIds.size).toBe(0);
  });
});

describe('applyCard — increment the level (owned count), capped at maxLevel', () => {
  it('records the card id at level 1 and bumps the debugStat pick counter (no statDelta)', () => {
    const state = createProgressionState();
    applyCard(state, item('overcharge', 'offense'));
    expect(state.ownedCards.overcharge).toBe(1);
    expect(state.debugStat).toBe(1); // a PICK counter, not a stat delta
  });

  it('same card twice → level 2 and pick counter 2 (ownership is a count/level)', () => {
    const state = createProgressionState();
    const card = item('overcharge', 'offense');
    applyCard(state, card);
    applyCard(state, card);
    expect(state.ownedCards.overcharge).toBe(2);
    expect(state.debugStat).toBe(2);
  });

  it('caps the level at maxLevel — a pick at the cap does not increment past it (guarded no-op)', () => {
    const state = createProgressionState();
    const card = item('overcharge', 'offense', ITEM_MAX_LEVEL);
    for (let i = 0; i < ITEM_MAX_LEVEL + 3; i++) applyCard(state, card);
    expect(state.ownedCards.overcharge).toBe(ITEM_MAX_LEVEL); // never past the cap
  });

  it('does not upgrade a fusion remnant (frozen), even if a card is applied to it', () => {
    const state = createProgressionState();
    const card = item('overcharge', 'offense');
    applyCard(state, card);
    applyCard(state, card);
    applyCard(state, card); // level 3
    markRemnant(state, 'overcharge');
    const before = state.ownedCards.overcharge;
    applyCard(state, card); // guarded no-op on the count
    expect(state.ownedCards.overcharge).toBe(before);
  });
});

describe('framework query helpers', () => {
  it('getLevel / isOwned: 0 + false when unowned, the count + true once owned', () => {
    const state = createProgressionState();
    expect(getLevel(state, 'overcharge')).toBe(0);
    expect(isOwned(state, 'overcharge')).toBe(false);
    applyCard(state, item('overcharge', 'offense'));
    expect(getLevel(state, 'overcharge')).toBe(1);
    expect(isOwned(state, 'overcharge')).toBe(true);
  });

  it('isMaxed: false below the cap, true at the cap', () => {
    const state = createProgressionState();
    const card = item('overcharge', 'offense', ITEM_MAX_LEVEL);
    for (let i = 0; i < ITEM_MAX_LEVEL - 1; i++) applyCard(state, card);
    expect(isMaxed(state, card)).toBe(false);
    applyCard(state, card); // reach the cap
    expect(isMaxed(state, card)).toBe(true);
  });

  it('markRemnant: freezes the level at ITEM_REMNANT_LEVEL and flags isRemnant', () => {
    const state = createProgressionState();
    const card = item('overcharge', 'offense');
    for (let i = 0; i < ITEM_MAX_LEVEL; i++) applyCard(state, card); // maxed at 5
    expect(isRemnant(state, 'overcharge')).toBe(false);
    markRemnant(state, 'overcharge');
    expect(isRemnant(state, 'overcharge')).toBe(true);
    expect(getLevel(state, 'overcharge')).toBe(ITEM_REMNANT_LEVEL); // frozen DOWN to Lv3
  });

  it('markRemnant is freeze-only: it never RAISES a level below the remnant level', () => {
    const state = createProgressionState();
    applyCard(state, item('overcharge', 'offense')); // level 1
    markRemnant(state, 'overcharge');
    // Below ITEM_REMNANT_LEVEL stays put (never minted UP to 3).
    expect(getLevel(state, 'overcharge')).toBe(1);
    expect(isRemnant(state, 'overcharge')).toBe(true);
  });

  it('markRemnant on an unowned id: flags remnant but mints no ownership level', () => {
    const state = createProgressionState();
    markRemnant(state, 'overcharge');
    expect(isRemnant(state, 'overcharge')).toBe(true);
    expect(getLevel(state, 'overcharge')).toBe(0); // never minted UP
  });
});

describe('slotOccupancy — distinct-owned per track (the ONE shared helper)', () => {
  const registry = [
    item('overcharge', 'offense'),
    item('spread-cannon', 'offense'),
    item('nanite-shield', 'defense'),
    item('afterburner', 'defense'),
  ];

  it('counts DISTINCT owned ids per track, regardless of level', () => {
    const state = createProgressionState();
    state.ownedCards = { overcharge: 5, 'spread-cannon': 1, 'nanite-shield': 3 };
    expect(slotOccupancy(state, registry)).toEqual({ offense: 2, defense: 1 });
  });

  it('a single high-level card fills exactly one slot (distinct, not total levels)', () => {
    const state = createProgressionState();
    state.ownedCards = { overcharge: 5 };
    expect(slotOccupancy(state, registry)).toEqual({ offense: 1 });
  });

  it('empty ownership → empty occupancy', () => {
    const state = createProgressionState();
    expect(slotOccupancy(state, registry)).toEqual({});
  });
});
