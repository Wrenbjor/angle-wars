import { describe, it, expect } from 'vitest';
import { PLACEHOLDER_CARDS } from './cards.js';
import { drawCardOffer } from '../systems/cardOffer.js';
import { createProgressionState } from '../state/ProgressionState.js';
import {
  SLOT_LIMIT_OFFENSE,
  SLOT_LIMIT_DEFENSE,
  CARD_OFFER_SIZE,
} from './constants.js';

// Story 8.4 — the placeholder card POOL invariants. Epic 8's offer is now a weighted
// draw of CARD_OFFER_SIZE distinct cards from this pool (see systems/cardOffer.js), so
// the invariants guard the shape the weighted draw + slot limits depend on. Epic 10
// replaces the content.
//
// Worst case: BOTH tracks full (SLOT_LIMIT_OFFENSE + SLOT_LIMIT_DEFENSE distinct owned)
// zeroes only the unowned-in-a-full-track cards. The pool carries at least
// SLOT_LIMIT_OFFENSE + 1 offense and SLOT_LIMIT_DEFENSE + 1 defense cards, so even then
// at least (1 + 1) owned-or-offerable cards plus every owned card stay positive — always
// >= CARD_OFFER_SIZE positive-weight cards, so a 3-draw can never underflow.

describe('PLACEHOLDER_CARDS — pool invariants', () => {
  const offense = PLACEHOLDER_CARDS.filter((c) => c.track === 'offense');
  const defense = PLACEHOLDER_CARDS.filter((c) => c.track === 'defense');

  it('carries enough of each track that a track can fill and a 3-draw still succeeds', () => {
    // > the limit so a track can reach its cap AND still leave an owned/offerable card.
    expect(offense.length).toBeGreaterThanOrEqual(SLOT_LIMIT_OFFENSE + 1);
    expect(defense.length).toBeGreaterThanOrEqual(SLOT_LIMIT_DEFENSE + 1);
    // Even both tracks full, the owned-in-track cards stay offerable (only the
    // unowned-in-a-full-track cards zero), so >= SLOT_LIMIT_OFFENSE + SLOT_LIMIT_DEFENSE
    // positive-weight candidates remain — always >= CARD_OFFER_SIZE.
    const worstCasePositive = SLOT_LIMIT_OFFENSE + SLOT_LIMIT_DEFENSE;
    expect(worstCasePositive).toBeGreaterThanOrEqual(CARD_OFFER_SIZE);
  });

  it('every card has a distinct id', () => {
    const ids = PLACEHOLDER_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every card has a non-empty title, numeric statDelta, positive rarity, valid track', () => {
    for (const card of PLACEHOLDER_CARDS) {
      expect(typeof card.title).toBe('string');
      expect(card.title.length).toBeGreaterThan(0);
      expect(typeof card.statDelta).toBe('number');
      expect(Number.isFinite(card.statDelta)).toBe(true);
      expect(typeof card.rarity).toBe('number');
      expect(card.rarity).toBeGreaterThan(0);
      expect(['offense', 'defense']).toContain(card.track);
    }
  });

  it('varies rarities so weighting is observable (not all equal)', () => {
    const rarities = new Set(PLACEHOLDER_CARDS.map((c) => c.rarity));
    expect(rarities.size).toBeGreaterThan(1);
  });

  it('the pool and every entry are frozen (shared immutable pool)', () => {
    expect(Object.isFrozen(PLACEHOLDER_CARDS)).toBe(true);
    for (const card of PLACEHOLDER_CARDS) {
      expect(Object.isFrozen(card)).toBe(true);
    }
  });

  it('BOTH tracks full against the REAL pool: draw still returns exactly 3 distinct OWNED cards (no zero-weight fill)', () => {
    // The headline safety claim, proven behaviorally end-to-end: own SLOT_LIMIT_OFFENSE
    // distinct offense + SLOT_LIMIT_DEFENSE distinct defense ids from the shipped pool,
    // so every track is full and the (few) unowned-in-track cards weigh 0. drawCardOffer
    // must still return exactly CARD_OFFER_SIZE distinct cards, and every one must be an
    // OWNED (positive-weight) card — no zero-weight safety-net fill slipped in.
    const ownedOffenseIds = offense.slice(0, SLOT_LIMIT_OFFENSE).map((c) => c.id);
    const ownedDefenseIds = defense.slice(0, SLOT_LIMIT_DEFENSE).map((c) => c.id);
    const ownedIds = new Set([...ownedOffenseIds, ...ownedDefenseIds]);
    const prog = createProgressionState();
    for (const id of ownedIds) prog.ownedCards[id] = 1;

    // Drive several draws over a varied rng sequence; every draw must satisfy the claim.
    let i = 0;
    const seq = [0.02, 0.37, 0.61, 0.88, 0.5, 0.14, 0.73, 0.29, 0.95, 0.44];
    const rng = () => seq[i++ % seq.length];
    for (let t = 0; t < 25; t++) {
      const offer = drawCardOffer({ pool: PLACEHOLDER_CARDS, progressionState: prog, rng });
      expect(offer).toHaveLength(CARD_OFFER_SIZE);
      const ids = offer.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length); // distinct
      for (const id of ids) expect(ownedIds.has(id)).toBe(true); // all owned/positive
    }
  });
});
