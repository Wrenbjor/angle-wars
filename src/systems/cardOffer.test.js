import { describe, it, expect } from 'vitest';
import { cardWeight, drawCardOffer } from './cardOffer.js';
import { createProgressionState } from '../state/ProgressionState.js';
import { PLACEHOLDER_CARDS } from '../config/cards.js';
import {
  SLOT_LIMIT_OFFENSE,
  SLOT_LIMIT_DEFENSE,
  CARD_OFFER_SIZE,
  CARD_WEIGHT_OWNED_MULT,
  CARD_WEIGHT_UNOWNED_MULT,
  CARD_WEIGHT_LEVEL1_MULT,
  CARD_WEIGHT_MIDTIER_MULT,
} from '../config/constants.js';

// Story 8.4 — the weighted-without-replacement card draw. cardWeight computes the
// Epic-8 formula; drawCardOffer draws CARD_OFFER_SIZE distinct cards through an
// injected rng, deterministically. Every case drives a real createProgressionState()
// and hand-built pools + a stub rng, covering every I/O-matrix row.

const LIMITS = { offense: SLOT_LIMIT_OFFENSE, defense: SLOT_LIMIT_DEFENSE };

// A small hand-built pool: distinct ids, varied rarities, both tracks.
function offCard(id, rarity) {
  return { id, title: id, statDelta: 1, rarity, track: 'offense' };
}
function defCard(id, rarity) {
  return { id, title: id, statDelta: 1, rarity, track: 'defense' };
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

describe('cardWeight — the Epic-8 weight formula', () => {
  it('unowned card: rarity × UNOWNED × MIDTIER (level 0 ≠ 1 → 1.4)', () => {
    const card = offCard('x', 5);
    const w = cardWeight(card, {
      ownedCards: {},
      slotCounts: {},
      limits: LIMITS,
    });
    expect(w).toBeCloseTo(
      5 * CARD_WEIGHT_UNOWNED_MULT * CARD_WEIGHT_MIDTIER_MULT,
    );
  });

  it('owned level 1: rarity × OWNED × LEVEL1 (2.2 × 1.0)', () => {
    const card = offCard('x', 5);
    const w = cardWeight(card, {
      ownedCards: { x: 1 },
      slotCounts: {},
      limits: LIMITS,
    });
    expect(w).toBeCloseTo(5 * CARD_WEIGHT_OWNED_MULT * CARD_WEIGHT_LEVEL1_MULT);
  });

  it('owned mid-tier (level 3): rarity × OWNED × MIDTIER (2.2 × 1.4 — highest tier)', () => {
    const card = offCard('x', 5);
    const w = cardWeight(card, {
      ownedCards: { x: 3 },
      slotCounts: {},
      limits: LIMITS,
    });
    expect(w).toBeCloseTo(5 * CARD_WEIGHT_OWNED_MULT * CARD_WEIGHT_MIDTIER_MULT);
  });

  it('unowned card in a FULL track weighs 0; owned card in a full track stays positive', () => {
    const unowned = offCard('u', 5);
    const owned = offCard('o', 5);
    const slotCounts = { offense: SLOT_LIMIT_OFFENSE };
    expect(
      cardWeight(unowned, { ownedCards: { o: 1 }, slotCounts, limits: LIMITS }),
    ).toBe(0);
    expect(
      cardWeight(owned, { ownedCards: { o: 1 }, slotCounts, limits: LIMITS }),
    ).toBeGreaterThan(0);
  });

  it('for equal rarity, weight orders owned-mid-tier (lvl 2) > owned-level-1 > unowned', () => {
    // Pins the "favor finishing owned builds, and mid-tier upgrades" behavior at the
    // formula level: with rarity held equal, the ownership + level factors alone must
    // strictly order the three states. A uniform/equal weighting would break this.
    const rarity = 3;
    const ctxFor = (level) => ({
      ownedCards: level > 0 ? { x: level } : {},
      slotCounts: {},
      limits: LIMITS,
    });
    const card = offCard('x', rarity);
    const unowned = cardWeight(card, ctxFor(0));
    const ownedLvl1 = cardWeight(card, ctxFor(1));
    const ownedMid = cardWeight(card, ctxFor(2));
    expect(ownedMid).toBeGreaterThan(ownedLvl1);
    expect(ownedLvl1).toBeGreaterThan(unowned);
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
});

describe('drawCardOffer — weighted-without-replacement draw', () => {
  it('fresh run: three distinct cards, all from the pool', () => {
    const pool = [
      offCard('a', 5),
      offCard('b', 4),
      defCard('c', 3),
      defCard('d', 2),
    ];
    const prog = createProgressionState();
    const offer = drawCardOffer({ pool, progressionState: prog, rng: seqRng([0.1, 0.5, 0.9]) });
    expect(offer).toHaveLength(CARD_OFFER_SIZE);
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // distinct
    for (const c of offer) expect(pool).toContain(c);
  });

  it('deterministic: same rng sequence + same ownedCards, drawn twice → identical ids/order', () => {
    const pool = [
      offCard('a', 5),
      offCard('b', 4),
      offCard('e', 6),
      defCard('c', 3),
      defCard('d', 2),
    ];
    const prog = createProgressionState();
    prog.ownedCards = { a: 2, c: 1 };
    const first = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng([0.13, 0.77, 0.42]),
    });
    const second = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng([0.13, 0.77, 0.42]),
    });
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
  });

  it('band-walk selects by weight magnitude: hand-computed rng lands each pick on the exact dictated card', () => {
    // Fresh run, so each weight = rarity × 1.0 (unowned) × 1.4 (level 0 ≠ 1) = rarity×1.4:
    //   a=1×1.4=1.4, b=2×1.4=2.8, c=3×1.4=4.2.
    // Draw 1: total 8.4, rng 0.6 → r=5.04; walk a(1.4)→3.64, b(2.8)→0.84, c(4.2)→-3.36<0 ⇒ c.
    // Draw 2: remaining [a,b] total 4.2, rng 0.5 → r=2.1; a(1.4)→0.7, b(2.8)→-2.1<0 ⇒ b.
    // Draw 3: remaining [a] total 1.4, rng 0 → a.
    // A uniform (index = floor(rng·n)) pick would yield b,_,_ for these values — this
    // assertion fails if the running-subtraction band-walk is replaced by a flat pick.
    const pool = [offCard('a', 1), offCard('b', 2), offCard('c', 3)];
    const prog = createProgressionState();
    const offer = drawCardOffer({
      pool,
      progressionState: prog,
      rng: seqRng([0.6, 0.5, 0.0]),
    });
    expect(offer.map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('float-guard fallback: an rng that never drives r negative still returns valid in-pool cards, no throw', () => {
    // A stub rng returning exactly 1 makes r = 1·total, so the running subtraction ends
    // at 0 (never < 0) — the primary walk finds no pick and the float guard awards it to
    // the last positive-weight candidate. Exercises the `picked === -1` branch.
    const pool = [offCard('a', 5), offCard('b', 4), defCard('c', 3), defCard('d', 2)];
    const prog = createProgressionState();
    let offer;
    expect(() => {
      offer = drawCardOffer({
        pool,
        progressionState: prog,
        rng: () => 1,
      });
    }).not.toThrow();
    expect(offer).toHaveLength(CARD_OFFER_SIZE);
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of offer) expect(pool).toContain(c);
  });

  it('offense track full: no UNOWNED offense card is drawn; owned offense + defense still appear', () => {
    // Own SLOT_LIMIT_OFFENSE distinct offense ids → offense track full.
    const ownedOffense = [];
    const pool = [];
    for (let i = 0; i < SLOT_LIMIT_OFFENSE; i++) {
      const id = `off-owned-${i}`;
      ownedOffense.push(id);
      pool.push(offCard(id, 3));
    }
    const unownedOffense = offCard('off-fresh', 5);
    pool.push(unownedOffense);
    const defA = defCard('def-a', 4);
    const defB = defCard('def-b', 4);
    pool.push(defA, defB);

    const prog = createProgressionState();
    const owned = {};
    for (const id of ownedOffense) owned[id] = 1;
    prog.ownedCards = owned;

    // Draw many times over a varied rng sequence; the unowned-in-full-track card must
    // NEVER appear, while owned-offense and defense cards can.
    const rng = seqRng([0.01, 0.31, 0.62, 0.87, 0.5, 0.2, 0.95, 0.44]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    expect(seen.has('off-fresh')).toBe(false);
    // At least one owned-offense and both defense cards are reachable.
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
    const unownedDefense = defCard('def-fresh', 5);
    pool.push(unownedDefense);
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
    // Pins the "count of DISTINCT owned ids" semantics (constants.js: "once this many
    // DISTINCT cards in a track are owned"). Cards are uncapped, so real play stacks a
    // single card to level >= the slot limit; the track must NOT count as full from that
    // one card. A refactor to `slotCounts[track] += ownedCards[id]` (total level instead
    // of distinct) would falsely full the track here and zero the unowned card below —
    // this test fails on that regression while the distinct-count code stays green.
    const heavy = offCard('off-heavy', 3); // the single owned offense card
    const freshOffense = offCard('off-fresh', 5); // unowned, same track
    const pool = [heavy, freshOffense, defCard('def-a', 4), defCard('def-b', 4)];

    const prog = createProgressionState();
    // Own ONE offense card at a level >= the slot limit: distinct-owned count is 1.
    prog.ownedCards = { 'off-heavy': SLOT_LIMIT_OFFENSE + 2 };

    const rng = seqRng([0.03, 0.44, 0.71, 0.9, 0.28, 0.61, 0.15]);
    const seen = new Set();
    for (let t = 0; t < 40; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      for (const c of offer) seen.add(c.id);
    }
    // Offense track has only 1 DISTINCT owned id (< SLOT_LIMIT_OFFENSE) → not full, so
    // the unowned offense card is still offerable.
    expect(seen.has('off-fresh')).toBe(true);
  });

  it('banishedIds default (omitted): nothing is zeroed by banish — every card reachable', () => {
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

  it('Story 8.5: a banished id over the real pool never appears while the offer stays exactly three distinct', () => {
    // End-to-end lock of "never appears again" at the draw surface with the SHIPPED
    // pool: banish one real id, drive many draws over a varied rng sequence, and assert
    // the banished id is never offered while every offer is still exactly three distinct
    // pool cards (the 6+5 positive-weight pool stays >= 3 with one banished).
    const banishedId = 'off-rapid';
    const banishedIds = new Set([banishedId]);
    const prog = createProgressionState();
    const rng = seqRng([0.07, 0.29, 0.53, 0.81, 0.11, 0.42, 0.68, 0.95, 0.34]);
    const seen = new Set();
    for (let t = 0; t < 60; t++) {
      const offer = drawCardOffer({
        pool: PLACEHOLDER_CARDS,
        progressionState: prog,
        rng,
        banishedIds,
      });
      expect(offer).toHaveLength(CARD_OFFER_SIZE);
      const ids = offer.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length); // distinct
      for (const c of offer) {
        expect(PLACEHOLDER_CARDS).toContain(c);
        seen.add(c.id);
      }
    }
    expect(seen.has(banishedId)).toBe(false);
    // Sanity: other cards ARE reachable (the draw is not degenerately stuck).
    expect(seen.size).toBeGreaterThan(CARD_OFFER_SIZE);
  });

  it('the three returned ids are pairwise distinct in any state', () => {
    const pool = [
      offCard('a', 5),
      offCard('b', 4),
      offCard('e', 1),
      defCard('c', 3),
      defCard('d', 2),
    ];
    const prog = createProgressionState();
    prog.ownedCards = { a: 4, c: 1, e: 2 };
    const rng = seqRng([0.99, 0.0, 0.5, 0.33, 0.66]);
    for (let t = 0; t < 30; t++) {
      const offer = drawCardOffer({ pool, progressionState: prog, rng });
      const ids = offer.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('degenerate: fewer than three positive-weight candidates → fills to exactly three, no throw', () => {
    // Only two positive-weight cards (the rest banished to 0); fill from the undrawn
    // zero-weight cards in pool order so the result is still exactly CARD_OFFER_SIZE.
    const pool = [
      offCard('a', 5),
      offCard('b', 5),
      offCard('z1', 5),
      offCard('z2', 5),
    ];
    const prog = createProgressionState();
    const banishedIds = new Set(['z1', 'z2']);
    let offer;
    expect(() => {
      offer = drawCardOffer({
        pool,
        progressionState: prog,
        rng: seqRng([0.5, 0.5, 0.5]),
        banishedIds,
      });
    }).not.toThrow();
    expect(offer).toHaveLength(CARD_OFFER_SIZE);
    const ids = offer.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // still distinct
    // The two positive-weight cards are both present; the third is a fill card.
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    // The fill is deterministic — the FIRST undrawn card in pool order (z1 precedes z2).
    expect(offer[2].id).toBe('z1');
  });
});
