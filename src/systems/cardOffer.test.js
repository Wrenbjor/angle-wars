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
  SPREAD_CANNON_GUARANTEE_LEVEL,
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

  it('ESCALATION repro: banishing 5 of the 7 real-registry items returns exactly the 2 eligible cards, banished absent', () => {
    // The exact case that broke the old exactly-three fill: with all but 2 registry items
    // banished (Story 11.1 added orbit-blade, Story 11.2 added seeker-drones, Story 11.3 added
    // mine-layer — so banishing 5 leaves 2), the offer must be the 2 remaining ELIGIBLE cards —
    // never a banished card padded back in.
    const banishedIds = new Set([
      'overcharge',
      'nanite-shield',
      'orbit-blade',
      'seeker-drones',
      'mine-layer',
    ]);
    const prog = createProgressionState();
    const rng = seqRng([0.07, 0.29, 0.53, 0.81, 0.11, 0.42]);
    for (let t = 0; t < 30; t++) {
      const offer = drawCardOffer({ pool: ITEM_REGISTRY, progressionState: prog, rng, banishedIds });
      expect(offer).toHaveLength(2); // exactly the two eligible items
      const ids = offer.map((c) => c.id);
      expect(ids).not.toContain('overcharge');
      expect(ids).not.toContain('nanite-shield');
      expect(ids).not.toContain('orbit-blade');
      expect(ids).not.toContain('seeker-drones');
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

describe('drawCardOffer — Story 10.3 offer guarantee (`guaranteeFromLevel`)', () => {
  // PRD §13.3's "Spread Cannon is always offered by Lv3", expressed as data on the
  // definition: from `guaranteeFromLevel` onward, an UNOWNED and otherwise-ELIGIBLE item
  // is reserved an offer slot BEFORE the weighted loop — consuming no rng() and never
  // overriding an exclusion.

  // A synthetic guaranteed card, so the guarantee is exercised independently of the
  // shipped registry's particular ids/rarities.
  function guaranteedCard(id, rarity, fromLevel, maxLevel = ITEM_MAX_LEVEL) {
    return { id, title: id, rarity, track: 'offense', maxLevel, guaranteeFromLevel: fromLevel };
  }

  it('AT and ABOVE the threshold with the item unowned: it occupies offer slot 0', () => {
    const g = guaranteedCard('gtd', 1, 3); // the LOWEST rarity — weight alone would rarely pick it
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    for (const runLevel of [3, 4, 12]) {
      const offer = drawCardOffer({
        pool,
        progressionState: prog,
        rng: seqRng([0.1, 0.5, 0.9]),
        runLevel,
      });
      expect(offer).toHaveLength(CARD_OFFER_SIZE);
      expect(offer[0]).toBe(g); // reserved FIRST, before the weighted picks
      const ids = offer.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length); // still distinct
      // The remaining slots are ordinary weighted draws from the rest of the pool.
      for (const c of offer.slice(1)) expect(c).not.toBe(g);
    }
  });

  it('holds on EVERY subsequent offer, not just the crossing level-up', () => {
    const g = guaranteedCard('gtd', 1, 3);
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9)];
    const prog = createProgressionState();
    const rng = seqRng([0.13, 0.47, 0.81, 0.29, 0.63]);
    for (let t = 0; t < 25; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng, runLevel: 7 });
      expect(offer.map((c) => c.id)).toContain('gtd');
    }
  });

  it('BELOW the threshold: no reservation, and the draw is IDENTICAL to the pre-10.3 draw', () => {
    // The no-rng-consumed property, stated as the observable it protects: for the same
    // seeded stream, an inactive guarantee must produce byte-identical output to a call
    // that has no guarantee concept at all (`runLevel` omitted).
    const g = guaranteedCard('gtd', 1, 3);
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11, 0.42, 0.68];
    for (const runLevel of [0, 1, 2]) {
      const withArg = drawCardOffer({
        pool,
        progressionState: prog,
        rng: seqRng(SEQ),
        runLevel,
      });
      const withoutArg = drawCardOffer({ pool, progressionState: prog, rng: seqRng(SEQ) });
      expect(withArg.map((c) => c.id)).toEqual(withoutArg.map((c) => c.id));
    }
  });

  it('an ACTIVE guarantee consumes no rng() — the remaining draws see the untouched stream', () => {
    // Counted directly: a full offer normally costs CARD_OFFER_SIZE rng() calls; with one
    // slot reserved it must cost exactly one fewer.
    const g = guaranteedCard('gtd', 1, 3);
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    const count = (runLevel) => {
      let calls = 0;
      const inner = seqRng([0.07, 0.29, 0.53, 0.81]);
      const rng = () => {
        calls++;
        return inner();
      };
      const offer = drawCardOffer({ pool, progressionState: prog, rng, runLevel });
      return { calls, offer };
    };
    const inactive = count(1);
    const active = count(3);
    expect(inactive.calls).toBe(CARD_OFFER_SIZE);
    expect(active.calls).toBe(CARD_OFFER_SIZE - 1);
    // And the reserved card really is the extra one.
    expect(active.offer.map((c) => c.id)).toContain('gtd');
  });

  it('once OWNED (level >= 1): no reservation — the ordinary weighted draw, unchanged', () => {
    const g = guaranteedCard('gtd', 1, 3);
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    prog.ownedCards = { gtd: 1 };
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11];
    const guaranteed = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng(SEQ),
      runLevel: 9,
    });
    const plain = drawCardOffer({ pool, progressionState: prog, rng: seqRng(SEQ) });
    // Identical: owning the item retires the guarantee entirely.
    expect(guaranteed.map((c) => c.id)).toEqual(plain.map((c) => c.id));
  });

  it.each([
    [
      'BANISHED (Story 8.5 permanence outranks the guarantee)',
      (prog) => prog,
      { banishedIds: new Set(['gtd']) },
    ],
    ['MAXED', (prog) => ((prog.ownedCards = { gtd: ITEM_MAX_LEVEL }), prog), {}],
    [
      'a fusion REMNANT',
      (prog) => ((prog.ownedCards = { gtd: 3 }), (prog.remnantIds = new Set(['gtd'])), prog),
      {},
    ],
  ])('EXCLUSION WINS over the guarantee: a %s card is never offered', (
    _label,
    mutate,
    extra,
  ) => {
    const g = guaranteedCard('gtd', 9, 3); // highest rarity AND guaranteed — still out
    const pool = [g, offCard('a', 3), defCard('b', 3), defCard('c', 3)];
    const prog = mutate(createProgressionState());
    const rng = seqRng([0.1, 0.5, 0.9, 0.3, 0.7]);
    for (let t = 0; t < 30; t++) {
      const offer = drawCardOffer({
        pool,
        progressionState: prog,
        rng,
        runLevel: 12,
        ...extra,
      });
      expect(offer.map((c) => c.id)).not.toContain('gtd');
    }
  });

  it('EXCLUSION WINS: an unowned guaranteed card in a FULL track is not offered', () => {
    // The fourth exclusion. The track is full of OTHER owned offense items, so the
    // guaranteed (unowned, offense) card weighs 0 — and the reservation must respect
    // that rather than re-open a closed track.
    const g = guaranteedCard('gtd', 9, 3);
    const pool = [g];
    const prog = createProgressionState();
    const owned = {};
    for (let i = 0; i < SLOT_LIMIT_OFFENSE; i++) {
      const id = `off-owned-${i}`;
      pool.push(offCard(id, 3, ITEM_MAX_LEVEL));
      owned[id] = 1;
    }
    pool.push(defCard('def-a', 4, ITEM_MAX_LEVEL));
    prog.ownedCards = owned;
    const rng = seqRng([0.05, 0.4, 0.7, 0.9, 0.25]);
    for (let t = 0; t < 30; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng, runLevel: 12 });
      expect(offer.map((c) => c.id)).not.toContain('gtd');
    }
  });

  it('a guarantee can leave the offer SHORT — it never pads or resurrects a zero-weight card', () => {
    // Exclusion purity is unchanged by the guarantee: two of four banished still yields a
    // 2-card offer, with the guaranteed-but-eligible card present and the banished absent.
    const g = guaranteedCard('gtd', 1, 3);
    const pool = [g, offCard('a', 5), offCard('z1', 5), offCard('z2', 5)];
    const prog = createProgressionState();
    const offer = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng([0.5]),
      banishedIds: new Set(['z1', 'z2']),
      runLevel: 5,
    });
    expect(offer).toHaveLength(2);
    const ids = offer.map((c) => c.id);
    expect(ids).toContain('gtd');
    expect(ids).toContain('a');
    expect(ids).not.toContain('z1');
    expect(ids).not.toContain('z2');
  });

  it('never overflows CARD_OFFER_SIZE, even with more guaranteed cards than slots', () => {
    const pool = [
      guaranteedCard('g1', 5, 1),
      guaranteedCard('g2', 5, 1),
      guaranteedCard('g3', 5, 1),
      guaranteedCard('g4', 5, 1),
      offCard('a', 5),
    ];
    const prog = createProgressionState();
    const offer = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng([0.5]),
      runLevel: 9,
    });
    expect(offer).toHaveLength(CARD_OFFER_SIZE);
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Reserved in REGISTRY order (deterministic, independent of the rng stream).
    expect(ids).toEqual(['g1', 'g2', 'g3']);
  });

  it.each([
    ['null (every non-guaranteed registry entry)', null],
    ['undefined (a legacy / synthetic pool card)', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a string', '3'],
  ])('a non-finite guaranteeFromLevel (%s) never reserves', (_label, value) => {
    const g = { id: 'gtd', title: 'gtd', rarity: 1, track: 'offense', maxLevel: ITEM_MAX_LEVEL };
    if (value !== undefined) g.guaranteeFromLevel = value;
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11];
    const withLevel = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng(SEQ),
      runLevel: 99,
    });
    const plain = drawCardOffer({ pool, progressionState: prog, rng: seqRng(SEQ) });
    expect(withLevel.map((c) => c.id)).toEqual(plain.map((c) => c.id));
  });

  it.each([
    ['omitted', undefined],
    ['NaN (a legacy stub with no run level)', NaN],
  ])('a missing/NaN runLevel (%s) is treated as no guarantee', (_label, runLevel) => {
    const prog = createProgressionState();
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11];
    const offer = drawCardOffer({
      pool: ITEM_REGISTRY,
      progressionState: prog,
      rng: seqRng(SEQ),
      runLevel,
    });
    const plain = drawCardOffer({
      pool: ITEM_REGISTRY,
      progressionState: prog,
      rng: seqRng(SEQ),
    });
    expect(offer.map((c) => c.id)).toEqual(plain.map((c) => c.id));
  });

  it('over the REAL registry: spread-cannon is guaranteed from run level 3 while unowned', () => {
    const prog = createProgressionState();
    const rng = seqRng([0.07, 0.29, 0.53, 0.81, 0.11, 0.42, 0.68]);
    // Below the threshold it is only ever a weighted candidate…
    for (let level = 0; level < SPREAD_CANNON_GUARANTEE_LEVEL; level++) {
      const offer = drawCardOffer({
        pool: ITEM_REGISTRY,
        progressionState: prog,
        rng,
        runLevel: level,
      });
      expect(offer).toHaveLength(CARD_OFFER_SIZE);
    }
    // …and from level 3 on it is in EVERY offer, at slot 0.
    for (let level = SPREAD_CANNON_GUARANTEE_LEVEL; level <= 20; level++) {
      const offer = drawCardOffer({
        pool: ITEM_REGISTRY,
        progressionState: prog,
        rng,
        runLevel: level,
      });
      expect(offer[0].id).toBe('spread-cannon');
      expect(offer).toHaveLength(CARD_OFFER_SIZE);
      const ids = offer.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('over the REAL registry: a BANISHED spread-cannon stays out at every level 3+', () => {
    // The exact adjudication Story 8.5 permanence forces: a player who banished the
    // base-weapon evolution never sees it again, guarantee or not.
    const prog = createProgressionState();
    const banishedIds = new Set(['spread-cannon']);
    const rng = seqRng([0.07, 0.29, 0.53, 0.81, 0.11, 0.42, 0.68]);
    for (let level = 3; level <= 20; level++) {
      const offer = drawCardOffer({
        pool: ITEM_REGISTRY,
        progressionState: prog,
        rng,
        banishedIds,
        runLevel: level,
      });
      expect(offer.map((c) => c.id)).not.toContain('spread-cannon');
      expect(offer).toHaveLength(CARD_OFFER_SIZE); // the other three fill it
    }
  });

  it('over the REAL registry: an OWNED spread-cannon retires the guarantee', () => {
    const prog = createProgressionState();
    prog.ownedCards = { 'spread-cannon': 1 };
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11];
    const guaranteed = drawCardOffer({
      pool: ITEM_REGISTRY,
      progressionState: prog,
      rng: seqRng(SEQ),
      runLevel: 12,
    });
    const plain = drawCardOffer({
      pool: ITEM_REGISTRY,
      progressionState: prog,
      rng: seqRng(SEQ),
    });
    expect(guaranteed.map((c) => c.id)).toEqual(plain.map((c) => c.id));
  });
});

describe('drawCardOffer — `runLevel` defaults to no-guarantee, not to level 0 (Story 10.3)', () => {
  it('an item with `guaranteeFromLevel: 0` does NOT reserve when runLevel is omitted', () => {
    // The reason the default is -Infinity rather than 0. A 0 default makes `0 >= 0` true,
    // so a threshold-0 item would reserve a slot for EVERY caller that omits the argument
    // — every legacy and synthetic-pool call site — silently breaking the "an inactive
    // guarantee leaves the draw bit-identical" property that the whole design rests on.
    const g = {
      id: 'gtd',
      title: 'gtd',
      rarity: 1,
      track: 'offense',
      maxLevel: ITEM_MAX_LEVEL,
      guaranteeFromLevel: 0,
    };
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11];

    // Omitted runLevel: identical to a pool with no guaranteed card at all.
    const omitted = drawCardOffer({ pool, progressionState: prog, rng: seqRng(SEQ) });
    const plainPool = [
      { ...g, guaranteeFromLevel: null },
      ...pool.slice(1),
    ];
    const noGuarantee = drawCardOffer({
      pool: plainPool,
      progressionState: prog,
      rng: seqRng(SEQ),
    });
    expect(omitted.map((c) => c.id)).toEqual(noGuarantee.map((c) => c.id));

    // An EXPLICIT run level of 0 still honors a threshold of 0 — the default is what
    // changed, not the comparison.
    const explicitZero = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng(SEQ),
      runLevel: 0,
    });
    expect(explicitZero[0]).toBe(g);
  });

  it('a non-numeric runLevel cannot activate a guarantee by coercion', () => {
    // The default only fires on `undefined`, and `>=` coerces its operands — so `null`
    // (which skips the default entirely) compared as 0, and a stringified level ('9',
    // the shape a serialized/save-loaded run level takes) compared as 9. Both satisfied
    // a finite threshold that the type contract says they cannot reach. The threshold
    // side was always Number.isFinite-checked; the run-level side was not.
    const g = {
      id: 'gtd',
      title: 'gtd',
      rarity: 1,
      track: 'offense',
      maxLevel: ITEM_MAX_LEVEL,
      guaranteeFromLevel: 0,
    };
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();

    // `null` against a threshold of 0 — the case the -Infinity default cannot cover.
    expect(
      drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.07, 0.29, 0.53]), runLevel: null })[0],
    ).not.toBe(g);

    // A string level against a threshold it would coerce past.
    const hi = [{ ...g, guaranteeFromLevel: 3 }, ...pool.slice(1)];
    for (const junk of ['9', true, {}, []]) {
      const offer = drawCardOffer({
        pool: hi,
        progressionState: prog,
        rng: seqRng([0.07, 0.29, 0.53]),
        runLevel: junk,
      });
      expect(offer.map((c) => c.id)).not.toContain('gtd');
    }

    // The real numeric path is untouched.
    expect(
      drawCardOffer({ pool: hi, progressionState: prog, rng: seqRng([0.07, 0.29, 0.53]), runLevel: 3 })[0].id,
    ).toBe('gtd');
  });

  it('a NEGATIVE guaranteeFromLevel still does not reserve on an omitted runLevel', () => {
    const g = {
      id: 'gtd',
      title: 'gtd',
      rarity: 1,
      track: 'offense',
      maxLevel: ITEM_MAX_LEVEL,
      guaranteeFromLevel: -5,
    };
    const pool = [g, offCard('a', 9), offCard('b', 9), defCard('c', 9), defCard('d', 9)];
    const prog = createProgressionState();
    const SEQ = [0.07, 0.29, 0.53, 0.81, 0.11];
    const omitted = drawCardOffer({ pool, progressionState: prog, rng: seqRng(SEQ) });
    const below = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng(SEQ),
      runLevel: -99,
    });
    expect(omitted.map((c) => c.id)).toEqual(below.map((c) => c.id));
    expect(omitted.map((c) => c.id)).not.toContain('gtd');
  });
});
