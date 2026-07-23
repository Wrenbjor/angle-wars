import { describe, it, expect } from 'vitest';
import { cardWeight, drawCardOffer } from './cardOffer.js';
import { createProgressionState } from '../state/ProgressionState.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import {
  SLOT_LIMIT_OFFENSE,
  SLOT_LIMIT_DEFENSE,
  CARD_OFFER_SIZE,
  CARD_WEIGHT_OWNED_MULT,
  CARD_WEIGHT_UNOWNED_MULT,
  CARD_WEIGHT_LEVEL1_MULT,
  CARD_WEIGHT_MIDTIER_MULT,
  ITEM_MAX_LEVEL,
} from '../config/constants.js';

// Story 8.4 / 10.1 — the weighted-without-replacement card draw. cardWeight computes
// the Epic-8 formula extended with maxed/remnant EXCLUSION; drawCardOffer draws up to
// CARD_OFFER_SIZE distinct ELIGIBLE cards through an injected rng, deterministically,
// and is VARIABLE LENGTH — it NEVER pads an excluded card in to reach a count (the old
// zero-weight fill safety net is removed). Every case drives a real
// createProgressionState() and hand-built pools + a stub rng.

const LIMITS = { offense: SLOT_LIMIT_OFFENSE, defense: SLOT_LIMIT_DEFENSE };

// A small hand-built pool card: distinct ids, varied rarities, both tracks. maxLevel is
// optional so the pre-maxed tests behave exactly like the legacy pool (no maxLevel →
// never maxed).
function offCard(id, rarity, maxLevel) {
  return { id, title: id, rarity, track: 'offense', maxLevel };
}
function defCard(id, rarity, maxLevel) {
  return { id, title: id, rarity, track: 'defense', maxLevel };
}

// A stub rng that replays a fixed sequence, looping — deterministic and injectable.
function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

describe('cardWeight — the Epic-8 weight formula (+ Story 10.1 exclusion)', () => {
  it('unowned card: rarity × UNOWNED × MIDTIER (level 0 ≠ 1 → 1.4)', () => {
    const card = offCard('x', 5);
    const w = cardWeight(card, { ownedCards: {}, slotCounts: {}, limits: LIMITS });
    expect(w).toBeCloseTo(5 * CARD_WEIGHT_UNOWNED_MULT * CARD_WEIGHT_MIDTIER_MULT);
  });

  it('owned level 1: rarity × OWNED × LEVEL1 (2.2 × 1.0)', () => {
    const card = offCard('x', 5);
    const w = cardWeight(card, { ownedCards: { x: 1 }, slotCounts: {}, limits: LIMITS });
    expect(w).toBeCloseTo(5 * CARD_WEIGHT_OWNED_MULT * CARD_WEIGHT_LEVEL1_MULT);
  });

  it('owned mid-tier (level 3): rarity × OWNED × MIDTIER (2.2 × 1.4 — highest tier)', () => {
    const card = offCard('x', 5);
    const w = cardWeight(card, { ownedCards: { x: 3 }, slotCounts: {}, limits: LIMITS });
    expect(w).toBeCloseTo(5 * CARD_WEIGHT_OWNED_MULT * CARD_WEIGHT_MIDTIER_MULT);
  });

  it('unowned card in a FULL track weighs 0; owned card in a full track stays positive', () => {
    const unowned = offCard('u', 5);
    const owned = offCard('o', 5);
    const slotCounts = { offense: SLOT_LIMIT_OFFENSE };
    expect(cardWeight(unowned, { ownedCards: { o: 1 }, slotCounts, limits: LIMITS })).toBe(0);
    expect(
      cardWeight(owned, { ownedCards: { o: 1 }, slotCounts, limits: LIMITS }),
    ).toBeGreaterThan(0);
  });

  it('for equal rarity, weight orders owned-mid-tier (lvl 2) > owned-level-1 > unowned', () => {
    const rarity = 3;
    const ctxFor = (level) => ({
      ownedCards: level > 0 ? { x: level } : {},
      slotCounts: {},
      limits: LIMITS,
    });
    const card = offCard('x', rarity);
    expect(cardWeight(card, ctxFor(2))).toBeGreaterThan(cardWeight(card, ctxFor(1)));
    expect(cardWeight(card, ctxFor(1))).toBeGreaterThan(cardWeight(card, ctxFor(0)));
  });

  it('a banished id weighs 0 (Story 8.5 seam); a non-banished id is unaffected', () => {
    const card = offCard('x', 5);
    expect(
      cardWeight(card, {
        ownedCards: {},
        banishedIds: new Set(['x']),
        slotCounts: {},
        limits: LIMITS,
      }),
    ).toBe(0);
    expect(
      cardWeight(card, {
        ownedCards: {},
        banishedIds: new Set(['y']),
        slotCounts: {},
        limits: LIMITS,
      }),
    ).toBeGreaterThan(0);
  });

  it('Story 10.1: a MAXED item (level >= maxLevel) weighs 0; below the cap it is positive', () => {
    const card = offCard('x', 5, ITEM_MAX_LEVEL);
    expect(
      cardWeight(card, { ownedCards: { x: ITEM_MAX_LEVEL }, slotCounts: {}, limits: LIMITS }),
    ).toBe(0);
    expect(
      cardWeight(card, {
        ownedCards: { x: ITEM_MAX_LEVEL - 1 },
        slotCounts: {},
        limits: LIMITS,
      }),
    ).toBeGreaterThan(0);
  });

  it('Story 10.1: a REMNANT item weighs 0 (excluded); a non-remnant id is unaffected', () => {
    const card = offCard('x', 5, ITEM_MAX_LEVEL);
    expect(
      cardWeight(card, {
        ownedCards: { x: 3 },
        remnantIds: new Set(['x']),
        slotCounts: {},
        limits: LIMITS,
      }),
    ).toBe(0);
    expect(
      cardWeight(card, {
        ownedCards: { x: 3 },
        remnantIds: new Set(['y']),
        slotCounts: {},
        limits: LIMITS,
      }),
    ).toBeGreaterThan(0);
  });
});

describe('drawCardOffer — variable-length weighted-without-replacement draw', () => {
  it('fresh run: three distinct cards, all from the pool', () => {
    const pool = [offCard('a', 5), offCard('b', 4), defCard('c', 3), defCard('d', 2)];
    const prog = createProgressionState();
    const offer = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.1, 0.5, 0.9]) });
    expect(offer).toHaveLength(CARD_OFFER_SIZE);
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // distinct
    for (const c of offer) expect(pool).toContain(c);
  });

  it('deterministic: same rng sequence + same ownedCards, drawn twice → identical ids/order', () => {
    const pool = [offCard('a', 5), offCard('b', 4), offCard('e', 6), defCard('c', 3), defCard('d', 2)];
    const prog = createProgressionState();
    prog.ownedCards = { a: 2, c: 1 };
    const first = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.13, 0.77, 0.42]) });
    const second = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.13, 0.77, 0.42]) });
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
  });

  it('band-walk selects by weight magnitude: hand-computed rng lands each pick on the exact dictated card', () => {
    // Fresh run: each weight = rarity × 1.0 × 1.4. a=1.4, b=2.8, c=4.2.
    // Draw1: total 8.4, rng 0.6→r=5.04; a→3.64,b→0.84,c→-3.36<0 ⇒ c.
    // Draw2: [a,b] total 4.2, rng 0.5→r=2.1; a→0.7,b→-2.1<0 ⇒ b. Draw3: [a] ⇒ a.
    const pool = [offCard('a', 1), offCard('b', 2), offCard('c', 3)];
    const prog = createProgressionState();
    const offer = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.6, 0.5, 0.0]) });
    expect(offer.map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('float-guard fallback: an rng that never drives r negative still returns valid in-pool cards, no throw', () => {
    const pool = [offCard('a', 5), offCard('b', 4), defCard('c', 3), defCard('d', 2)];
    const prog = createProgressionState();
    let offer;
    expect(() => {
      offer = drawCardOffer({ pool, progressionState: prog, rng: () => 1 });
    }).not.toThrow();
    expect(offer).toHaveLength(CARD_OFFER_SIZE);
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of offer) expect(pool).toContain(c);
  });

  it('offense track full: no UNOWNED offense card is drawn; owned offense + defense still appear', () => {
    const ownedOffense = [];
    const pool = [];
    for (let i = 0; i < SLOT_LIMIT_OFFENSE; i++) {
      const id = `off-owned-${i}`;
      ownedOffense.push(id);
      pool.push(offCard(id, 3));
    }
    pool.push(offCard('off-fresh', 5));
    pool.push(defCard('def-a', 4), defCard('def-b', 4));

    const prog = createProgressionState();
    const owned = {};
    for (const id of ownedOffense) owned[id] = 1;
    prog.ownedCards = owned;

    const rng = seqRng([0.01, 0.31, 0.62, 0.87, 0.5, 0.2, 0.95, 0.44]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    expect(seen.has('off-fresh')).toBe(false);
    expect(ownedOffense.some((id) => seen.has(id))).toBe(true);
    expect(seen.has('def-a') || seen.has('def-b')).toBe(true);
  });

  it('defense track full: no UNOWNED defense card is drawn; owned defense stays offerable', () => {
    const ownedDefense = [];
    const pool = [];
    for (let i = 0; i < SLOT_LIMIT_DEFENSE; i++) {
      const id = `def-owned-${i}`;
      ownedDefense.push(id);
      pool.push(defCard(id, 3));
    }
    pool.push(defCard('def-fresh', 5));
    pool.push(offCard('off-a', 4), offCard('off-b', 4));

    const prog = createProgressionState();
    const owned = {};
    for (const id of ownedDefense) owned[id] = 1;
    prog.ownedCards = owned;

    const rng = seqRng([0.05, 0.4, 0.7, 0.9, 0.25, 0.6]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    expect(seen.has('def-fresh')).toBe(false);
    expect(ownedDefense.some((id) => seen.has(id))).toBe(true);
  });

  it('slot count is DISTINCT-owned, not total: one high-level card does NOT fill its track', () => {
    const heavy = offCard('off-heavy', 3);
    const freshOffense = offCard('off-fresh', 5);
    const pool = [heavy, freshOffense, defCard('def-a', 4), defCard('def-b', 4)];

    const prog = createProgressionState();
    prog.ownedCards = { 'off-heavy': SLOT_LIMIT_OFFENSE + 2 };

    const rng = seqRng([0.03, 0.44, 0.71, 0.9, 0.28, 0.61, 0.15]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    expect(seen.has('off-fresh')).toBe(true);
  });

  it('the returned ids are pairwise distinct in any state', () => {
    const pool = [offCard('a', 5), offCard('b', 4), offCard('e', 1), defCard('c', 3), defCard('d', 2)];
    const prog = createProgressionState();
    prog.ownedCards = { a: 4, c: 1, e: 2 };
    const rng = seqRng([0.99, 0.0, 0.5, 0.33, 0.66]);
    for (let t = 0; t < 30; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      const ids = offer.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('banishedIds default (omitted): nothing is zeroed by banish — every card reachable', () => {
    // The omitted-argument default. Note banishedIds is the SEPARATE top-level arg, NOT
    // read off progressionState — this pins that omitting it excludes nothing (rather
    // than, say, throwing or silently zeroing the pool).
    const pool = [offCard('a', 5), offCard('b', 5), defCard('c', 5)];
    const prog = createProgressionState();
    const rng = seqRng([0.05, 0.5, 0.95, 0.3, 0.7, 0.1]);
    const seen = new Set();
    for (let t = 0; t < 20; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    // With only three positive-weight cards, every offer is all three.
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('drawCardOffer — Story 10.1 exclusion purity (maxed / remnant / short / empty)', () => {
  it('a maxed item is never offered (excluded end-to-end through the draw)', () => {
    const maxed = offCard('maxed', 9, ITEM_MAX_LEVEL); // highest rarity, but maxed
    const pool = [maxed, offCard('a', 3), defCard('b', 3), defCard('c', 3)];
    const prog = createProgressionState();
    prog.ownedCards = { maxed: ITEM_MAX_LEVEL };
    const rng = seqRng([0.1, 0.5, 0.9, 0.3, 0.7]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    expect(seen.has('maxed')).toBe(false);
    // The three eligible cards ARE reachable (draw not degenerately stuck).
    expect(seen.has('a') && seen.has('b') && seen.has('c')).toBe(true);
  });

  it('a remnant item is never offered (excluded end-to-end through the draw)', () => {
    const remnant = offCard('remnant', 9, ITEM_MAX_LEVEL);
    const pool = [remnant, offCard('a', 3), defCard('b', 3), defCard('c', 3)];
    const prog = createProgressionState();
    prog.ownedCards = { remnant: 3 };
    prog.remnantIds = new Set(['remnant']);
    const rng = seqRng([0.1, 0.5, 0.9, 0.3, 0.7]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    expect(seen.has('remnant')).toBe(false);
  });

  it('SHORT offer: with only two eligible cards, returns exactly those two — NO excluded card padded in', () => {
    // Only two positive-weight cards; the rest banished to 0. The offer is length 2 (the
    // old zero-weight fill is gone), and never includes a banished/excluded card.
    const pool = [offCard('a', 5), offCard('b', 5), offCard('z1', 5), offCard('z2', 5)];
    const prog = createProgressionState();
    const banishedIds = new Set(['z1', 'z2']);
    let offer;
    expect(() => {
      offer = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.5, 0.5, 0.5]), banishedIds });
    }).not.toThrow();
    expect(offer).toHaveLength(2); // short — NOT padded to CARD_OFFER_SIZE
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // distinct
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('z1');
    expect(ids).not.toContain('z2');
  });

  it('ESCALATION repro: banishing overcharge + nanite-shield over the real registry returns exactly the 2 eligible cards, overcharge absent', () => {
    // The exact case that broke the old exactly-three fill: with 2 of the 4 registry
    // items banished, the offer must be the 2 remaining ELIGIBLE cards — never the
    // banished overcharge padded back in.
    const banishedIds = new Set(['overcharge', 'nanite-shield']);
    const prog = createProgressionState();
    const rng = seqRng([0.07, 0.29, 0.53, 0.81, 0.11, 0.42]);
    for (let t = 0; t < 30; t++) {
      const offer = drawCardOffer({ pool: ITEM_REGISTRY, progressionState: prog, rng, banishedIds });
      expect(offer).toHaveLength(2); // exactly the two eligible items
      const ids = offer.map((c) => c.id);
      expect(ids).not.toContain('overcharge');
      expect(ids).not.toContain('nanite-shield');
      expect(ids).toContain('spread-cannon');
      expect(ids).toContain('afterburner');
    }
  });

  it('one banished over the real registry: offer is exactly three eligible, banished absent', () => {
    const banishedIds = new Set(['overcharge']);
    const prog = createProgressionState();
    const rng = seqRng([0.07, 0.29, 0.53, 0.81, 0.11, 0.42, 0.68]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool: ITEM_REGISTRY, progressionState: prog, rng, banishedIds });
      expect(offer).toHaveLength(CARD_OFFER_SIZE); // 3 of 4 eligible
      for (const c of offer) {
        expect(ITEM_REGISTRY).toContain(c);
        seen.add(c.id);
      }
    }
    expect(seen.has('overcharge')).toBe(false);
  });

  it('EMPTY offer: with zero eligible cards (all banished), returns [] — no card, no throw', () => {
    const pool = [offCard('a', 5), defCard('b', 5)];
    const prog = createProgressionState();
    const banishedIds = new Set(['a', 'b']);
    let offer;
    expect(() => {
      offer = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.5]), banishedIds });
    }).not.toThrow();
    expect(offer).toEqual([]);
  });

  it('EMPTY offer: every owned item maxed → [] (nothing left to upgrade)', () => {
    const pool = [offCard('a', 5, ITEM_MAX_LEVEL), defCard('b', 5, ITEM_MAX_LEVEL)];
    const prog = createProgressionState();
    prog.ownedCards = { a: ITEM_MAX_LEVEL, b: ITEM_MAX_LEVEL };
    const offer = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.5, 0.5]) });
    expect(offer).toEqual([]);
  });
});
