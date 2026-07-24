import { describe, it, expect } from 'vitest';
import { ITEM_REGISTRY, getItem, getItemsByTrack } from './itemRegistry.js';
import {
  ITEM_MAX_LEVEL,
  SPREAD_CANNON_GUARANTEE_LEVEL,
  SPREAD_MAX_WAYS,
  SPREAD_MAX_ARC_DEG,
  SHIELD_MAX_CHARGES,
  SHIELD_RECHARGE_FLOOR_MS,
} from './constants.js';

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

  it('Afterburner still carries EMPTY stats (10.5 deferred)', () => {
    // Stories 10.2, 10.3 and 10.4 authored Overcharge's, Spread Cannon's and Nanite
    // Shield's numbers; this pin NARROWS to the ONE still-deferred item. It stops
    // Afterburner (10.5) from silently landing its effect numbers here without its own
    // story's wiring — the fold would apply them with no gameplay seam reading them.
    for (const item of ITEM_REGISTRY) {
      if (
        item.id === 'overcharge' ||
        item.id === 'spread-cannon' ||
        item.id === 'nanite-shield'
      ) {
        continue;
      }
      for (const lvl of item.levels) {
        expect(lvl.stats, `${item.id} L${lvl.level} stats should still be empty`).toEqual(
          {},
        );
      }
    }
  });

  it('carries `guaranteeFromLevel` on EVERY entry — a number only on spread-cannon', () => {
    // The field's SHAPE is uniform across the registry (Story 10.3), so cardOffer's
    // reservation reads one consistent field rather than probing for its existence. A
    // number means "reserve me an offer slot from that run level while unowned"; null
    // means no guarantee. `undefined` (the field simply forgotten on a new entry) is NOT
    // acceptable — hence the own-property check.
    for (const item of ITEM_REGISTRY) {
      expect(
        Object.prototype.hasOwnProperty.call(item, 'guaranteeFromLevel'),
        `${item.id} is missing guaranteeFromLevel`,
      ).toBe(true);
      if (item.id === 'spread-cannon') {
        expect(item.guaranteeFromLevel).toBe(SPREAD_CANNON_GUARANTEE_LEVEL);
        expect(Number.isFinite(item.guaranteeFromLevel)).toBe(true);
      } else {
        expect(item.guaranteeFromLevel, `${item.id} must not be guaranteed`).toBeNull();
      }
    }
    // PRD §13.3's onboarding beat is specifically "by Lv3".
    expect(SPREAD_CANNON_GUARANTEE_LEVEL).toBe(3);
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

describe('ITEM_REGISTRY — Spread Cannon per-level stats (Story 10.3, PRD §13.3)', () => {
  // The exact per-level maps. `spreadWays`/`spreadArcDeg` are ADDITIVE/COUNT fields
  // (base 0), and `spreadArcDeg` is the volley's TOTAL cone angle centered on aim — NOT
  // the gap between adjacent bullets. `fireRateMult`/`damageMult` are FRACTIONAL BONUSES
  // reusing Story 10.2's seams. Every map is the TOTAL at that level.
  const EXPECTED_SPREAD_STATS = [
    { spreadWays: 3, spreadArcDeg: 12 },
    { spreadWays: 5, spreadArcDeg: 16 },
    { spreadWays: 5, spreadArcDeg: 16, fireRateMult: 0.3 },
    { spreadWays: 7, spreadArcDeg: 22, fireRateMult: 0.3 },
    { spreadWays: 9, spreadArcDeg: 22, fireRateMult: 0.3, damageMult: 0.35 },
  ];

  it('pins all five levels exactly (frozen, totals-at-level)', () => {
    const sc = getItem('spread-cannon');
    expect(sc.levels).toHaveLength(EXPECTED_SPREAD_STATS.length);
    sc.levels.forEach((lvl, i) => {
      expect(lvl.stats, `spread-cannon L${lvl.level}`).toEqual(EXPECTED_SPREAD_STATS[i]);
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('levels are TOTALS, not deltas — the carried-forward rungs are restated', () => {
    // The single property a delta-authoring slip breaks, and the one a reviewer reading
    // `desc` alone will mistake for a copy-paste error. The fold reads ONLY the current
    // level's map, so a level that "only adds fire rate" must still restate the spread it
    // inherits — otherwise picking Spread Cannon L3 would silently REMOVE the L2 spread.
    const [l1, l2, l3, l4, l5] = getItem('spread-cannon').levels.map((l) => l.stats);

    // L3's desc is '+30% fire rate' alone, yet it carries the L2 spread verbatim.
    expect(l3.spreadWays).toBe(l2.spreadWays);
    expect(l3.spreadArcDeg).toBe(l2.spreadArcDeg);
    // L4's desc is '7-way spread / 22°' alone, yet it carries the L3 fire rate.
    expect(l4.fireRateMult).toBe(l3.fireRateMult);
    // L5's desc is '9-way spread / +35% damage', yet it carries BOTH the L4 arc and the
    // L3 fire rate. The arc SATURATING at 22° is deliberate: the volley grows denser,
    // not wider.
    expect(l5.spreadArcDeg).toBe(l4.spreadArcDeg);
    expect(l5.fireRateMult).toBe(l3.fireRateMult);
    // Every level from L1 on carries a spread — the item is never a spread-less card.
    for (const s of [l1, l2, l3, l4, l5]) {
      expect(s.spreadWays).toBeGreaterThanOrEqual(3);
      expect(s.spreadArcDeg).toBeGreaterThan(0);
    }
  });

  it('the way count is ODD at every level (a bullet always travels exactly along aim)', () => {
    for (const lvl of getItem('spread-cannon').levels) {
      expect(lvl.stats.spreadWays % 2, `L${lvl.level} way count must be odd`).toBe(1);
    }
  });

  it('ways rise monotonically and the arc never regresses', () => {
    const levels = getItem('spread-cannon').levels;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].stats.spreadWays).toBeGreaterThanOrEqual(
        levels[i - 1].stats.spreadWays,
      );
      expect(levels[i].stats.spreadArcDeg).toBeGreaterThanOrEqual(
        levels[i - 1].stats.spreadArcDeg,
      );
      expect(levels[i].stats.fireRateMult ?? 0).toBeGreaterThanOrEqual(
        levels[i - 1].stats.fireRateMult ?? 0,
      );
      expect(levels[i].stats.damageMult ?? 0).toBeGreaterThanOrEqual(
        levels[i - 1].stats.damageMult ?? 0,
      );
    }
  });

  it('the shipped desc strings are UNTOUCHED (a desc rewrite would be a PRD contradiction)', () => {
    // Spread Cannon's descs read as DELTAS while the stats are TOTALS — a deliberate,
    // documented mismatch. The resolution is to keep the text exactly as Story 10.1
    // shipped it, so pin the strings themselves rather than deriving numbers from them
    // (the Overcharge desc↔stats and clause-count tests stay Overcharge-scoped for this
    // exact reason).
    expect(getItem('spread-cannon').levels.map((l) => l.desc)).toEqual([
      '3-way spread / 12°',
      '5-way spread / 16°',
      '+30% fire rate',
      '7-way spread / 22°',
      '9-way spread / +35% damage',
    ]);
  });

  it('carries no stat key outside the volley/fire rungs the story owns', () => {
    for (const lvl of getItem('spread-cannon').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect(['spreadWays', 'spreadArcDeg', 'fireRateMult', 'damageMult']).toContain(k);
      }
    }
  });

  it('stays inside the FiringSystem SAFETY clamps at every level (they are not levers)', () => {
    for (const lvl of getItem('spread-cannon').levels) {
      // Inclusive, matching the runtime clamps (`v > MAX ? MAX : v`) — a strict `<` here
      // would redden a legal boundary value and imply the safety constant needs raising.
      expect(lvl.stats.spreadWays).toBeLessThanOrEqual(SPREAD_MAX_WAYS);
      expect(lvl.stats.spreadArcDeg).toBeLessThanOrEqual(SPREAD_MAX_ARC_DEG);
    }
  });
});

describe('ITEM_REGISTRY — Nanite Shield per-level stats (Story 10.4, PRD §13.4)', () => {
  // The exact per-level maps. All three fields are ADDITIVE/COUNT fields (base 0):
  // `shieldCharges` is the MAXIMUM charge count (never the live one — that is runtime
  // state on NaniteShieldSystem), `shieldRechargeMs` is the per-charge regeneration
  // interval, and `shieldKnockback` is the Lv5 break-pulse flag. Every map is the TOTAL
  // at that level.
  const EXPECTED_SHIELD_STATS = [
    { shieldCharges: 1, shieldRechargeMs: 20000 },
    { shieldCharges: 1, shieldRechargeMs: 15000 },
    { shieldCharges: 2, shieldRechargeMs: 15000 },
    { shieldCharges: 2, shieldRechargeMs: 10000 },
    { shieldCharges: 3, shieldRechargeMs: 10000, shieldKnockback: 1 },
  ];

  it('pins all five levels exactly (frozen, totals-at-level)', () => {
    const ns = getItem('nanite-shield');
    expect(ns.levels).toHaveLength(EXPECTED_SHIELD_STATS.length);
    ns.levels.forEach((lvl, i) => {
      expect(lvl.stats, `nanite-shield L${lvl.level}`).toEqual(EXPECTED_SHIELD_STATS[i]);
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('levels are TOTALS, not deltas — the carried-forward rungs are restated', () => {
    // The single property a delta-authoring slip breaks, and the one this item makes
    // WORST: the fold reads ONLY the current level's map, so a level whose desc reads as
    // "recharge only" that failed to restate the charge count would DELETE the shield,
    // and one that reads as "charges only" without the interval would drop the recharge
    // to the base 0ms.
    const [l1, l2, l3, l4, l5] = getItem('nanite-shield').levels.map((l) => l.stats);

    // L2's desc is 'Recharge 15s' alone, yet it restates L1's single charge.
    expect(l2.shieldCharges).toBe(l1.shieldCharges);
    // L3's desc is '2 charges' alone, yet it restates the L2 recharge interval.
    expect(l3.shieldRechargeMs).toBe(l2.shieldRechargeMs);
    // L4's desc is 'Recharge 10s' alone, yet it restates the L3 charge count.
    expect(l4.shieldCharges).toBe(l3.shieldCharges);
    // L5's desc is '3 charges + knockback pulse', yet it restates the L4 interval.
    expect(l5.shieldRechargeMs).toBe(l4.shieldRechargeMs);
    // Every level from L1 on grants a real shield with a real recharge — never a
    // charge-less card, never an instant/zero recharge.
    for (const s of [l1, l2, l3, l4, l5]) {
      expect(s.shieldCharges).toBeGreaterThanOrEqual(1);
      expect(s.shieldRechargeMs).toBeGreaterThan(0);
    }
  });

  it('the knockback pulse flag exists ONLY at Lv5 (PRD §13.4)', () => {
    const levels = getItem('nanite-shield').levels;
    for (const lvl of levels.slice(0, 4)) {
      expect(lvl.stats.shieldKnockback, `L${lvl.level} must not knock back`).toBeUndefined();
    }
    expect(levels[4].stats.shieldKnockback).toBe(1);
  });

  it('charges rise monotonically and the recharge interval never gets slower', () => {
    const levels = getItem('nanite-shield').levels;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].stats.shieldCharges).toBeGreaterThanOrEqual(
        levels[i - 1].stats.shieldCharges,
      );
      expect(levels[i].stats.shieldRechargeMs).toBeLessThanOrEqual(
        levels[i - 1].stats.shieldRechargeMs,
      );
    }
  });

  it('the shipped desc strings are UNTOUCHED (a desc rewrite would be a PRD contradiction)', () => {
    // Nanite Shield's descs read as DELTAS while the stats are TOTALS — the same
    // deliberate, documented mismatch Spread Cannon has. The resolution is to keep the
    // text exactly as Story 10.1 shipped it.
    expect(getItem('nanite-shield').levels.map((l) => l.desc)).toEqual([
      'Absorb 1 hit / 20s recharge',
      'Recharge 15s',
      '2 charges',
      'Recharge 10s',
      '3 charges + knockback pulse',
    ]);
  });

  it('carries no stat key outside the three shield rungs the story owns', () => {
    // Nanite Shield is a DEFENSE item — it must not quietly acquire a fire or movement
    // field that another story's seam would then read.
    for (const lvl of getItem('nanite-shield').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect(['shieldCharges', 'shieldRechargeMs', 'shieldKnockback']).toContain(k);
      }
    }
  });

  it('is the ONLY item in the registry authoring any shield field (the additive-fold tripwire)', () => {
    // The fold ADDS every non-`Mult` field, so a SECOND item authoring `shieldRechargeMs`
    // would make the shield SLOWER, not faster (20000 + 15000 = 35000ms) — and a second
    // `shieldCharges` author would silently inflate the cap. That hazard is documented in
    // PLAYER_STATS_BASE, but a comment cannot fail a build; this can. An Epic 11/12 author
    // who genuinely wants a second shield-affecting item must fold a RATE or a fractional
    // `*Mult`, not stack another interval — and should land that decision here, not
    // discover it in play.
    for (const key of ['shieldCharges', 'shieldRechargeMs', 'shieldKnockback']) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual([
        'nanite-shield',
      ]);
    }
  });

  it('stays inside the NaniteShieldSystem SAFETY clamps at every level (they are not levers)', () => {
    for (const lvl of getItem('nanite-shield').levels) {
      // STRICT, deliberately: a shipped value that merely REACHED either guard would
      // already mean the guard had become a balance lever, which is the state this
      // test exists to forbid. An inclusive bound would permit exactly that.
      expect(lvl.stats.shieldCharges).toBeLessThan(SHIELD_MAX_CHARGES);
      expect(lvl.stats.shieldRechargeMs).toBeGreaterThan(SHIELD_RECHARGE_FLOOR_MS);
    }
  });
});
