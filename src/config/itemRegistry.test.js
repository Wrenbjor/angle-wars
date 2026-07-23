import { describe, it, expect } from 'vitest';
import { ITEM_REGISTRY, getItem, getItemsByTrack } from './itemRegistry.js';
import { ITEM_MAX_LEVEL } from './constants.js';

// Story 10.1 — the data-driven item registry: the ONE definition per item that the
// offer, on-pick application, owned-state, and current level all read from. The four
// Epic-10 items register with real id/name/track/rarity/fusion metadata and five
// per-level descriptors; effect NUMBERS (stats) are deferred to each item's own story
// (empty maps here), so these tests guard the SHAPE the framework depends on.

const EXPECTED_IDS = ['overcharge', 'spread-cannon', 'nanite-shield', 'afterburner'];

describe('ITEM_REGISTRY — the four Epic-10 item definitions', () => {
  it('registers exactly the four Epic-10 items with distinct ids', () => {
    const ids = ITEM_REGISTRY.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // distinct
    for (const id of EXPECTED_IDS) expect(ids).toContain(id);
    expect(ITEM_REGISTRY).toHaveLength(EXPECTED_IDS.length);
  });

  it('every entry carries the full definition shape', () => {
    for (const item of ITEM_REGISTRY) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.name).toBe('string');
      expect(item.name.length).toBeGreaterThan(0);
      // `title` is the overlay label ALIAS of `name` (duck-compatible with the retired
      // card shape). They must stay identical: `name` is canonical but `title` is what the
      // overlay actually draws, so editing one alone would silently render a stale label —
      // exactly the second-source-of-truth this story exists to remove.
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.title).toBe(item.name);
      expect(['offense', 'defense']).toContain(item.track);
      expect(typeof item.rarity).toBe('number');
      expect(item.rarity).toBeGreaterThan(0);
      expect(item.maxLevel).toBe(ITEM_MAX_LEVEL);
    }
  });

  it('every entry has exactly five per-level descriptors (level 1..5, non-empty desc, well-formed frozen stats)', () => {
    // The UNIVERSAL stats constraint, over every entry and every level — deliberately
    // stronger than a typeof check (which `[]`, or a map full of junk, would pass):
    // every stats map is a FROZEN PLAIN object whose every value is a finite number.
    // A per-item numbers pin lives in each item's own story suite; this is the shape
    // contract the fold depends on for ALL of them, Overcharge included.
    for (const item of ITEM_REGISTRY) {
      expect(item.levels).toHaveLength(ITEM_MAX_LEVEL);
      item.levels.forEach((lvl, i) => {
        expect(lvl.level).toBe(i + 1);
        expect(typeof lvl.desc).toBe('string');
        expect(lvl.desc.length).toBeGreaterThan(0);
        const where = `${item.id} L${lvl.level}`;
        expect(typeof lvl.stats, `${where} stats type`).toBe('object');
        expect(lvl.stats, `${where} stats is null`).not.toBeNull();
        // A plain object, never an array (an array is `typeof 'object'` and would
        // fold as an empty/index-keyed store).
        expect(Array.isArray(lvl.stats), `${where} stats is an array`).toBe(false);
        expect(Object.isFrozen(lvl.stats), `${where} stats not frozen`).toBe(true);
        // Every authored value must be a finite number — the fold ADDS these onto the
        // base, so a string/null/NaN would poison the store (and every seam reading it).
        for (const [k, v] of Object.entries(lvl.stats)) {
          expect(Number.isFinite(v), `${where} stats.${k} = ${v} is not finite`).toBe(
            true,
          );
        }
      });
    }
  });

  it('every item OTHER than Overcharge still carries EMPTY stats (10.3–10.5 deferred)', () => {
    // Story 10.2 authored ONLY Overcharge's numbers. This pin is what stops a later
    // item story (Spread Cannon 10.3, Nanite Shield 10.4, Afterburner 10.5) from
    // silently landing its effect numbers here without its own story's wiring —
    // the fold would apply them with no gameplay seam reading them.
    for (const item of ITEM_REGISTRY) {
      if (item.id === 'overcharge') continue;
      for (const lvl of item.levels) {
        expect(lvl.stats, `${item.id} L${lvl.level} stats should still be empty`).toEqual(
          {},
        );
      }
    }
  });

  it('carries fusion metadata ({partner, epic}) on every Epic-10 item', () => {
    for (const item of ITEM_REGISTRY) {
      expect(item.fusion).not.toBeNull();
      expect(typeof item.fusion.partner).toBe('string');
      expect(typeof item.fusion.epic).toBe('string');
    }
    // Pin the PRD §13.5 fusion map — BOTH halves. Asserting only `epic` let a typo in a
    // `partner` id through (nothing consumes fusion yet, so no other check would catch
    // it), silently breaking the recipe when Epic 12 resolves this data.
    expect(getItem('spread-cannon').fusion).toEqual({
      partner: 'piercing-lance',
      epic: 'sunburst',
    });
    expect(getItem('nanite-shield').fusion).toEqual({
      partner: 'afterburner',
      epic: 'phase-armor',
    });
    expect(getItem('afterburner').fusion).toEqual({
      partner: 'nanite-shield',
      epic: 'slipstream',
    });
    // Overcharge's PRD condition is "any 2 offense items at Lv5" — no single partner id,
    // so the field carries a documented SENTINEL that Epic 12 resolves specially.
    expect(getItem('overcharge').fusion).toEqual({
      partner: 'any-2-offense-lv5',
      epic: 'critical-resonance',
    });
  });

  it('the reciprocal Nanite ↔ Afterburner pair resolves within the registry', () => {
    // The only fully-registered recipe today: each names the other, and both partners
    // actually exist here. (spread-cannon's partner `piercing-lance` and overcharge's
    // sentinel are deliberately forward-looking — later epics register them.)
    for (const id of ['nanite-shield', 'afterburner']) {
      const partnerId = getItem(id).fusion.partner;
      expect(getItem(partnerId)).toBeDefined();
      expect(getItem(partnerId).fusion.partner).toBe(id);
    }
  });

  it('varies rarity so weighting is observable (not all equal)', () => {
    const rarities = new Set(ITEM_REGISTRY.map((i) => i.rarity));
    expect(rarities.size).toBeGreaterThan(1);
  });

  it('the registry and every entry (+ nested levels/fusion) are deeply frozen', () => {
    expect(Object.isFrozen(ITEM_REGISTRY)).toBe(true);
    for (const item of ITEM_REGISTRY) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.levels)).toBe(true);
      for (const lvl of item.levels) {
        expect(Object.isFrozen(lvl)).toBe(true);
        expect(Object.isFrozen(lvl.stats)).toBe(true);
      }
      expect(Object.isFrozen(item.fusion)).toBe(true);
    }
  });
});

describe('getItem / getItemsByTrack', () => {
  it('getItem returns the definition by id, undefined for an unknown id', () => {
    expect(getItem('overcharge')).toBe(ITEM_REGISTRY[0]);
    expect(getItem('nope')).toBeUndefined();
  });

  it('getItemsByTrack returns the items of a track in registry order', () => {
    const offense = getItemsByTrack('offense');
    const defense = getItemsByTrack('defense');
    expect(offense.map((i) => i.id)).toEqual(['overcharge', 'spread-cannon']);
    expect(defense.map((i) => i.id)).toEqual(['nanite-shield', 'afterburner']);
    // Every returned entry actually belongs to the requested track.
    for (const i of offense) expect(i.track).toBe('offense');
    for (const i of defense) expect(i.track).toBe('defense');
  });
});

describe('ITEM_REGISTRY — Overcharge per-level stats (Story 10.2, PRD §13.3)', () => {
  // The exact per-level maps. Per the state/PlayerStats.js AUTHORING CONVENTION these
  // are FRACTIONAL BONUSES folded onto the base of 1 (0.25 → 1.25x), and each level's
  // map is the TOTAL at that level, NOT a delta from the level below.
  const EXPECTED_OVERCHARGE_STATS = [
    { damageMult: 0.15 },
    { damageMult: 0.25, fireRateMult: 0.1 },
    { damageMult: 0.35, fireRateMult: 0.2 },
    { damageMult: 0.45, fireRateMult: 0.3 },
    { damageMult: 0.6, fireRateMult: 0.4 },
  ];

  it('pins all five levels exactly (fractional bonuses, totals-at-level)', () => {
    const oc = getItem('overcharge');
    expect(oc.levels).toHaveLength(EXPECTED_OVERCHARGE_STATS.length);
    oc.levels.forEach((lvl, i) => {
      expect(lvl.stats).toEqual(EXPECTED_OVERCHARGE_STATS[i]);
      // Frozen like every other nested registry object.
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('L1 grants damage ONLY (no fire-rate rung until L2)', () => {
    const l1 = getItem('overcharge').levels[0];
    expect(l1.stats.damageMult).toBe(0.15);
    expect(l1.stats.fireRateMult).toBeUndefined();
  });

  it('every level agrees with its already-shipped desc text', () => {
    // The desc strings shipped in Story 10.1 and must NOT drift from the numbers: the
    // registry is the single source of truth for BOTH the player-visible text and the
    // applied effect, so parse the percentages back out of the text and compare.
    // "+25% damage / +10% fire rate" → damageMult 0.25, fireRateMult 0.10.
    for (const lvl of getItem('overcharge').levels) {
      const dmgMatch = /\+(\d+)% damage/.exec(lvl.desc);
      expect(dmgMatch, `no damage clause in "${lvl.desc}"`).not.toBeNull();
      expect(lvl.stats.damageMult).toBeCloseTo(Number(dmgMatch[1]) / 100, 10);

      const rateMatch = /\+(\d+)% fire rate/.exec(lvl.desc);
      if (rateMatch) {
        expect(lvl.stats.fireRateMult).toBeCloseTo(Number(rateMatch[1]) / 100, 10);
      } else {
        // No fire-rate clause in the text → no fire-rate key in the map.
        expect(lvl.stats.fireRateMult).toBeUndefined();
      }
    }
  });

  it('every desc CLAUSE has a backing stat key (the check runs both ways)', () => {
    // The check above is one-directional: it proves every clause it already knows
    // about has backing numbers, but it cannot see a clause it does not know about.
    // A desc gaining a third promise ("+25% damage / +10% fire rate / +5% crit")
    // would pass every other assertion in this file — the damage and fire-rate
    // regexes still match and no unexpected stat key was added — while the registry
    // advertises an effect the fold never applies. Counting clauses closes that.
    for (const lvl of getItem('overcharge').levels) {
      const clauses = lvl.desc.split('/').map((c) => c.trim()).filter(Boolean);
      expect(
        clauses.length,
        `"${lvl.desc}" promises ${clauses.length} effect(s) but stats has ` +
          `${Object.keys(lvl.stats).length} key(s)`,
      ).toBe(Object.keys(lvl.stats).length);
    }
  });

  it('both rungs increase monotonically across levels (no regression at a higher level)', () => {
    const levels = getItem('overcharge').levels;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].stats.damageMult).toBeGreaterThan(levels[i - 1].stats.damageMult);
      const prevRate = levels[i - 1].stats.fireRateMult ?? 0;
      const rate = levels[i].stats.fireRateMult ?? 0;
      expect(rate).toBeGreaterThanOrEqual(prevRate);
    }
  });

  it('carries no stat key outside the damage/fire-rate rungs the story owns', () => {
    // Overcharge is a GLOBAL fire item — it must not quietly acquire a movement or
    // defense field that another story's seam would then read.
    for (const lvl of getItem('overcharge').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect(['damageMult', 'fireRateMult']).toContain(k);
      }
    }
  });
});
