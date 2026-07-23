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

  it('every entry has exactly five per-level descriptors (level 1..5, non-empty desc, EMPTY stats)', () => {
    for (const item of ITEM_REGISTRY) {
      expect(item.levels).toHaveLength(ITEM_MAX_LEVEL);
      item.levels.forEach((lvl, i) => {
        expect(lvl.level).toBe(i + 1);
        expect(typeof lvl.desc).toBe('string');
        expect(lvl.desc.length).toBeGreaterThan(0);
        // Story 10.1: effect NUMBERS are deferred — every stats map is empty today.
        expect(lvl.stats).toEqual({});
      });
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
