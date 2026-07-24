import { describe, it, expect } from 'vitest';
import { ITEM_REGISTRY, getItem, getItemsByTrack } from './itemRegistry.js';
import {
  ITEM_MAX_LEVEL,
  SPREAD_CANNON_GUARANTEE_LEVEL,
  SPREAD_MAX_WAYS,
  SPREAD_MAX_ARC_DEG,
  SHIELD_MAX_CHARGES,
  SHIELD_RECHARGE_FLOOR_MS,
  MOVE_SPEED_MULT_MAX,
  DASH_COOLDOWN_FLOOR_MS,
} from './constants.js';

// Story 10.1 — the data-driven item registry: the ONE definition per item that the
// offer, on-pick application, owned-state, and current level all read from. The four
// Epic-10 items register with real id/name/track/rarity/fusion metadata and five
// per-level descriptors. Effect NUMBERS (stats) landed in each item's own story —
// Overcharge 10.2, Spread Cannon 10.3, Nanite Shield 10.4, Afterburner 10.5 — so all
// four are now authored, and these tests guard both the SHAPE the framework depends on
// and each item's shipped rungs.

const EXPECTED_IDS = [
  'overcharge',
  'spread-cannon',
  'orbit-blade',
  'seeker-drones',
  'mine-layer',
  'piercing-lance',
  'ricochet-rounds',
  'flak-burst',
  'nanite-shield',
  'afterburner',
  'gravity-well',
  'reinforced-hull',
];



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

  it('carries NO empty stats map anywhere (all four Epic-10 items are authored)', () => {
    // Story 10.5 landed the LAST deferred numbers. The old pin here asserted that
    // Afterburner still carried `{}`; its replacement is the complement — nothing in
    // the registry contributes nothing to the fold any more. An item re-emptied by a
    // bad merge would be silently inert in play, and this catches it.
    for (const item of ITEM_REGISTRY) {
      for (const lvl of item.levels) {
        expect(
          Object.keys(lvl.stats).length,
          `${item.id} L${lvl.level} stats must not be empty`,
        ).toBeGreaterThan(0);
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
    // Story 11.1: Orbit Blade Lv5 + Overcharge Lv3 → Tesla Circuit (Epic 12 resolves it).
    expect(getItem('orbit-blade').fusion).toEqual({
      partner: 'overcharge',
      epic: 'tesla-circuit',
    });
    // Story 11.2: Seeker Drones Lv5 + Nanite Shield Lv3 → Swarm Protocol (Epic 12 resolves it).
    expect(getItem('seeker-drones').fusion).toEqual({
      partner: 'nanite-shield',
      epic: 'swarm-protocol',
    });
    // Story 11.3: Mine Layer Lv5 + Gravity Well Lv3 → Singularity Field (Epic 12 resolves it;
    // the partner `gravity-well` is forward-looking, landing in Story 11.7).
    expect(getItem('mine-layer').fusion).toEqual({
      partner: 'gravity-well',
      epic: 'singularity-field',
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
    expect(offense.map((i) => i.id)).toEqual([
      'overcharge',
      'spread-cannon',
      'orbit-blade',
      'seeker-drones',
      'mine-layer',
      'piercing-lance',
      'ricochet-rounds',
      'flak-burst',
    ]);

    expect(defense.map((i) => i.id)).toEqual([
      'nanite-shield',
      'afterburner',
      'gravity-well',
      'reinforced-hull',
    ]);
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

// --- Afterburner (Story 10.5) ------------------------------------------------
describe('ITEM_REGISTRY — Afterburner stats (Story 10.5)', () => {
  const AFTERBURNER_FIELDS = [
    'moveSpeedMult',
    'dashCooldownMs',
    'dashIFrames',
    'dashDamage',
    'dashTrail',
  ];

  it('authors the exact five per-level stats maps, frozen', () => {
    const levels = getItem('afterburner').levels;
    expect(levels.map((l) => l.stats)).toEqual([
      { moveSpeedMult: 0.12 },
      { moveSpeedMult: 0.2, dashCooldownMs: 3000 },
      { moveSpeedMult: 0.25, dashCooldownMs: 3000, dashIFrames: 1 },
      {
        moveSpeedMult: 0.25,
        dashCooldownMs: 2000,
        dashIFrames: 1,
        dashDamage: 1,
      },
      {
        moveSpeedMult: 0.35,
        dashCooldownMs: 2000,
        dashIFrames: 1,
        dashDamage: 1,
        dashTrail: 1,
      },
    ]);
    for (const lvl of levels) {
      expect(Object.isFrozen(lvl.stats), `L${lvl.level} stats not frozen`).toBe(true);
    }
  });

  it('authors LEVELS as TOTALS, not deltas (the properties a delta slip breaks)', () => {
    const [, l2, l3, l4, l5] = getItem('afterburner').levels;
    // L3's desc names only the i-frames, but it must RESTATE L2's cooldown — a delta
    // slip here would DELETE the dash on the level that adds i-frames to it.
    expect(l3.stats.dashCooldownMs).toBe(l2.stats.dashCooldownMs);
    // L4's desc names only the cooldown + damage, but it must restate L3's speed and
    // i-frames. The unchanged 0.25 reads like a copy-paste slip and is deliberate.
    expect(l4.stats.moveSpeedMult).toBe(l3.stats.moveSpeedMult);
    expect(l4.stats.dashIFrames).toBe(1);
    // L5 restates every prior flag alongside its own trail.
    expect(l5.stats.dashIFrames).toBe(1);
    expect(l5.stats.dashDamage).toBe(1);
    expect(l5.stats.dashCooldownMs).toBe(l4.stats.dashCooldownMs);
  });

  it('DECREASES dashCooldownMs from L3 to L4 while every other field is monotonic', () => {
    const levels = getItem('afterburner').levels;
    // The cooldown is the one field that goes DOWN across levels, which is only sound
    // because level entries are TOTALS (the fold reads ONE level's map, never a sum).
    expect(levels[3].stats.dashCooldownMs).toBeLessThan(levels[2].stats.dashCooldownMs);
    for (let i = 1; i < levels.length; i++) {
      const prev = levels[i - 1].stats;
      const cur = levels[i].stats;
      for (const key of ['moveSpeedMult', 'dashIFrames', 'dashDamage', 'dashTrail']) {
        expect(
          cur[key] ?? 0,
          `${key} must not regress from L${i} to L${i + 1}`,
        ).toBeGreaterThanOrEqual(prev[key] ?? 0);
      }
    }
  });

  it('carries no stat key outside the five rungs the story owns', () => {
    for (const lvl of getItem('afterburner').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect(AFTERBURNER_FIELDS).toContain(k);
      }
    }
  });

  it('is the ONLY item authoring any Afterburner field (the additive-fold tripwire)', () => {
    // Same hazard the shield tripwire guards: the fold ADDS, so a second author of
    // `dashCooldownMs` would make the dash SLOWER, and a second `moveSpeedMult` author
    // would stack additively rather than multiplicatively. Land that decision here.
    for (const key of AFTERBURNER_FIELDS) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual([
        'afterburner',
      ]);
    }
  });

  it('stays inside the movement/dash SAFETY clamps at every level (they are not levers)', () => {
    for (const lvl of getItem('afterburner').levels) {
      // STRICT, deliberately: a shipped value ON a guard would already mean the guard
      // had become a balance lever — the state these tests exist to forbid.
      // `MOVE_SPEED_MULT_MAX` clamps the FOLDED multiplier in `_moveSpeedMult()`
      // (base 1 + the bonus, e.g. 1.35 at Lv5), not the raw registry bonus, so fold
      // onto the base here to assert against the quantity the clamp actually guards —
      // otherwise an authored bonus of 2.5 (folded 3.5, which the clamp WOULD engage)
      // would slip past a bare `0.35 < 3` check.
      expect(1 + lvl.stats.moveSpeedMult).toBeLessThan(MOVE_SPEED_MULT_MAX);
      if (lvl.stats.dashCooldownMs !== undefined) {
        expect(lvl.stats.dashCooldownMs).toBeGreaterThan(DASH_COOLDOWN_FLOOR_MS);
      }
    }
  });

  it('keeps the Story 10.1 desc strings verbatim (prose, never rewritten to the totals)', () => {
    expect(getItem('afterburner').levels.map((l) => l.desc)).toEqual([
      '+12% move speed',
      '+20% speed + dash (3s cooldown)',
      '+25% speed + dash i-frames',
      '2s dash cooldown + dash damages on contact',
      '+35% speed + burning dash trail',
    ]);
  });
});

// --- Seeker Drones (Story 11.2) ----------------------------------------------
describe('ITEM_REGISTRY — Seeker Drones per-level stats (Story 11.2, PRD §13.3)', () => {
  // The exact per-level maps. All four fields are ADDITIVE/COUNT fields (base 0):
  // `seekerDroneCount` is the drone count, `seekerDroneDamage` the per-shot damage,
  // `seekerDronePeriodMs` the fire period, `seekerDroneHoming` the Lv4+ homing flag. Every
  // map is the TOTAL at that level.
  const EXPECTED_DRONE_STATS = [
    { seekerDroneCount: 1, seekerDroneDamage: 3, seekerDronePeriodMs: 1500 },
    { seekerDroneCount: 2, seekerDroneDamage: 3, seekerDronePeriodMs: 1500 },
    { seekerDroneCount: 3, seekerDroneDamage: 3, seekerDronePeriodMs: 1071 },
    {
      seekerDroneCount: 4,
      seekerDroneDamage: 3,
      seekerDronePeriodMs: 1071,
      seekerDroneHoming: 1,
    },
    {
      seekerDroneCount: 5,
      seekerDroneDamage: 4.8,
      seekerDronePeriodMs: 1071,
      seekerDroneHoming: 1,
    },
  ];

  it('pins all five levels exactly (frozen, totals-at-level)', () => {
    const sd = getItem('seeker-drones');
    expect(sd.levels).toHaveLength(EXPECTED_DRONE_STATS.length);
    sd.levels.forEach((lvl, i) => {
      expect(lvl.stats, `seeker-drones L${lvl.level}`).toEqual(EXPECTED_DRONE_STATS[i]);
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('levels are TOTALS, not deltas — the carried-forward rungs are restated', () => {
    // The fold reads ONLY the current level's map, so a level whose desc reads as a delta
    // must still restate the fields it inherits — otherwise picking L3 ('+40% fire rate')
    // would silently REMOVE the drones, and L4 ('homing shots') would drop the count/period.
    const [l1, l2, l3, l4, l5] = getItem('seeker-drones').levels.map((l) => l.stats);
    // L2's desc is '2 drones' alone, yet it restates L1's damage + period.
    expect(l2.seekerDroneDamage).toBe(l1.seekerDroneDamage);
    expect(l2.seekerDronePeriodMs).toBe(l1.seekerDronePeriodMs);
    // L3's desc is '3 drones / +40% fire rate', yet it restates the damage.
    expect(l3.seekerDroneDamage).toBe(l2.seekerDroneDamage);
    // L4's desc is '4 drones / homing shots', yet it restates the L3 damage + period.
    expect(l4.seekerDroneDamage).toBe(l3.seekerDroneDamage);
    expect(l4.seekerDronePeriodMs).toBe(l3.seekerDronePeriodMs);
    // L5's desc is '5 drones / +60% damage', yet it restates the L4 period AND homing.
    expect(l5.seekerDronePeriodMs).toBe(l4.seekerDronePeriodMs);
    expect(l5.seekerDroneHoming).toBe(l4.seekerDroneHoming);
    // Every level from L1 on grants at least one drone with a real damage + period.
    for (const s of [l1, l2, l3, l4, l5]) {
      expect(s.seekerDroneCount).toBeGreaterThanOrEqual(1);
      expect(s.seekerDroneDamage).toBeGreaterThan(0);
      expect(s.seekerDronePeriodMs).toBeGreaterThan(0);
    }
  });

  it('the +40% fire rate is the period ÷ 1.4 and the +60% damage is ×1.6 (PRD math)', () => {
    const [, , l3, , l5] = getItem('seeker-drones').levels.map((l) => l.stats);
    // 1500 / 1.4 ≈ 1071 (rounded).
    expect(l3.seekerDronePeriodMs).toBe(Math.round(1500 / 1.4));
    // 3 × 1.6 = 4.8.
    expect(l5.seekerDroneDamage).toBeCloseTo(3 * 1.6, 10);
  });

  it('the homing flag exists ONLY from Lv4 (PRD §13.3)', () => {
    const levels = getItem('seeker-drones').levels;
    for (const lvl of levels.slice(0, 3)) {
      expect(lvl.stats.seekerDroneHoming, `L${lvl.level} must not home`).toBeUndefined();
    }
    expect(levels[3].stats.seekerDroneHoming).toBe(1);
    expect(levels[4].stats.seekerDroneHoming).toBe(1);
  });

  it('drone count rises monotonically and the fire period never gets slower', () => {
    const levels = getItem('seeker-drones').levels;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].stats.seekerDroneCount).toBeGreaterThanOrEqual(
        levels[i - 1].stats.seekerDroneCount,
      );
      expect(levels[i].stats.seekerDronePeriodMs).toBeLessThanOrEqual(
        levels[i - 1].stats.seekerDronePeriodMs,
      );
      expect(levels[i].stats.seekerDroneDamage).toBeGreaterThanOrEqual(
        levels[i - 1].stats.seekerDroneDamage,
      );
    }
  });

  it('carries no stat key outside the four drone rungs the story owns', () => {
    for (const lvl of getItem('seeker-drones').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect([
          'seekerDroneCount',
          'seekerDroneDamage',
          'seekerDronePeriodMs',
          'seekerDroneHoming',
        ]).toContain(k);
      }
    }
  });

  it('is the ONLY item authoring any Seeker Drone field (the additive-fold tripwire)', () => {
    // The fold ADDS, so a SECOND item authoring `seekerDronePeriodMs` would make the drones
    // fire SLOWER, and a second `seekerDroneCount` author would inflate the count. An Epic
    // 11/12 author who wants a second drone-affecting item must fold a RATE or a `*Mult`.
    for (const key of [
      'seekerDroneCount',
      'seekerDroneDamage',
      'seekerDronePeriodMs',
      'seekerDroneHoming',
    ]) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual([
        'seeker-drones',
      ]);
    }
  });

  it('keeps the PRD §13.3 desc strings verbatim (prose, never rewritten to the totals)', () => {
    expect(getItem('seeker-drones').levels.map((l) => l.desc)).toEqual([
      '1 drone / fires every 1.5s',
      '2 drones',
      '3 drones / +40% fire rate',
      '4 drones / homing shots',
      '5 drones / +60% damage',
    ]);
  });
});

// --- Mine Layer (Story 11.3) -------------------------------------------------
describe('ITEM_REGISTRY — Mine Layer per-level stats (Story 11.3, PRD §13.3)', () => {
  // The exact per-level maps. `mineDropPeriodMs`/`mineCap`/`mineDetonateRadius` are
  // ADDITIVE/COUNT fields (base 0), and `minePull`/`mineChain` are FLAGS. `mineDropPeriodMs`
  // is ALSO the ownership gate (0 = unowned). Every map is the TOTAL at that level.
  const EXPECTED_MINE_STATS = [
    { mineDropPeriodMs: 2000, mineCap: 10, mineDetonateRadius: 60 },
    { mineDropPeriodMs: 2000, mineCap: 12, mineDetonateRadius: 100 },
    { mineDropPeriodMs: 1300, mineCap: 12, mineDetonateRadius: 100 },
    { mineDropPeriodMs: 1300, mineCap: 12, mineDetonateRadius: 100, minePull: 1 },
    {
      mineDropPeriodMs: 1300,
      mineCap: 12,
      mineDetonateRadius: 100,
      minePull: 1,
      mineChain: 1,
    },
  ];

  it('pins all five levels exactly (frozen, totals-at-level)', () => {
    const ml = getItem('mine-layer');
    expect(ml.levels).toHaveLength(EXPECTED_MINE_STATS.length);
    ml.levels.forEach((lvl, i) => {
      expect(lvl.stats, `mine-layer L${lvl.level}`).toEqual(EXPECTED_MINE_STATS[i]);
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('the track/rarity/maxLevel and guarantee shape match the framework contract', () => {
    const ml = getItem('mine-layer');
    expect(ml.track).toBe('offense');
    expect(ml.rarity).toBeGreaterThan(0);
    expect(ml.maxLevel).toBe(ITEM_MAX_LEVEL);
    expect(ml.guaranteeFromLevel).toBeNull();
  });

  it('levels are TOTALS, not deltas — the carried-forward rungs are restated', () => {
    // The fold reads ONLY the current level's map, so a level whose desc reads as a delta must
    // still restate the fields it inherits — otherwise picking L3 ('drops every 1.3s') would
    // silently REMOVE the cap/blast, and L4 ('mines pull enemies inward') / L5 ('detonation
    // chains…') would drop everything they inherit.
    const [l1, l2, l3, l4, l5] = getItem('mine-layer').levels.map((l) => l.stats);
    // L2's desc is '+2 mine cap / 100r blast', yet it restates L1's drop period.
    expect(l2.mineDropPeriodMs).toBe(l1.mineDropPeriodMs);
    // L3's desc is 'drops every 1.3s' alone, yet it restates the L2 cap AND blast radius.
    expect(l3.mineCap).toBe(l2.mineCap);
    expect(l3.mineDetonateRadius).toBe(l2.mineDetonateRadius);
    // L4's desc is 'mines pull enemies inward' alone, yet it restates the L3 period/cap/radius.
    expect(l4.mineDropPeriodMs).toBe(l3.mineDropPeriodMs);
    expect(l4.mineCap).toBe(l3.mineCap);
    expect(l4.mineDetonateRadius).toBe(l3.mineDetonateRadius);
    // L5's desc is 'detonation chains to adjacent mines' alone, yet it restates the L4 pull.
    expect(l5.minePull).toBe(l4.minePull);
    // Every level from L1 on drops mines with a real cap + blast radius.
    for (const s of [l1, l2, l3, l4, l5]) {
      expect(s.mineDropPeriodMs).toBeGreaterThan(0);
      expect(s.mineCap).toBeGreaterThanOrEqual(1);
      expect(s.mineDetonateRadius).toBeGreaterThan(0);
    }
  });

  it('the pull flag exists ONLY from Lv4 and the chain flag ONLY at Lv5 (PRD §13.3)', () => {
    const levels = getItem('mine-layer').levels;
    for (const lvl of levels.slice(0, 3)) {
      expect(lvl.stats.minePull, `L${lvl.level} must not pull`).toBeUndefined();
    }
    expect(levels[3].stats.minePull).toBe(1);
    expect(levels[4].stats.minePull).toBe(1);
    for (const lvl of levels.slice(0, 4)) {
      expect(lvl.stats.mineChain, `L${lvl.level} must not chain`).toBeUndefined();
    }
    expect(levels[4].stats.mineChain).toBe(1);
  });

  it('cap rises monotonically, the drop period never gets slower, the radius never shrinks', () => {
    const levels = getItem('mine-layer').levels;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].stats.mineCap).toBeGreaterThanOrEqual(levels[i - 1].stats.mineCap);
      expect(levels[i].stats.mineDropPeriodMs).toBeLessThanOrEqual(
        levels[i - 1].stats.mineDropPeriodMs,
      );
      expect(levels[i].stats.mineDetonateRadius).toBeGreaterThanOrEqual(
        levels[i - 1].stats.mineDetonateRadius,
      );
    }
  });

  it('carries no stat key outside the five mine rungs the story owns', () => {
    for (const lvl of getItem('mine-layer').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect([
          'mineDropPeriodMs',
          'mineCap',
          'mineDetonateRadius',
          'minePull',
          'mineChain',
        ]).toContain(k);
      }
    }
  });

  it('is the ONLY item authoring any Mine Layer field (the additive-fold tripwire)', () => {
    // The fold ADDS, so a SECOND item authoring `mineDropPeriodMs` would make drops SLOWER,
    // and a second `mineCap` author would inflate the cap. An Epic 11/12 author who wants a
    // second mine-affecting item must fold a RATE or a `*Mult`.
    for (const key of [
      'mineDropPeriodMs',
      'mineCap',
      'mineDetonateRadius',
      'minePull',
      'mineChain',
    ]) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual(['mine-layer']);
    }
  });

  it('keeps the PRD §13.3 desc strings verbatim (prose, never rewritten to the totals)', () => {
    expect(getItem('mine-layer').levels.map((l) => l.desc)).toEqual([
      'mine every 2s / 3s arm / 60r',
      '+2 mine cap / 100r blast',
      'drops every 1.3s',
      'mines pull enemies inward',
      'detonation chains to adjacent mines',
    ]);
  });
});

// --- Piercing Lance (Story 11.4) --------------------------------------------
describe('ITEM_REGISTRY — Piercing Lance per-level stats (Story 11.4, PRD §13.3)', () => {
  // The exact per-level maps. `lancePeriodMs`/`lancePierce`/`lanceDamage` are ADDITIVE/COUNT
  // fields (base 0), and `lanceTrail`/`lanceBackward` are FLAGS. `lancePeriodMs` is ALSO the
  // ownership gate (0 = unowned). Every map is the TOTAL at that level.
  const EXPECTED_LANCE_STATS = [
    { lancePeriodMs: 2000, lancePierce: 2, lanceDamage: 4 },
    { lancePeriodMs: 2000, lancePierce: 4, lanceDamage: 4 },
    { lancePeriodMs: 1400, lancePierce: 4, lanceDamage: 6 },
    { lancePeriodMs: 1400, lancePierce: 7, lanceDamage: 6, lanceTrail: 1 },
    {
      lancePeriodMs: 1400,
      lancePierce: 7,
      lanceDamage: 6,
      lanceTrail: 1,
      lanceBackward: 1,
    },
  ];

  it('pins all five levels exactly (frozen, totals-at-level)', () => {
    const pl = getItem('piercing-lance');
    expect(pl.levels).toHaveLength(EXPECTED_LANCE_STATS.length);
    pl.levels.forEach((lvl, i) => {
      expect(lvl.stats, `piercing-lance L${lvl.level}`).toEqual(EXPECTED_LANCE_STATS[i]);
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('the track/rarity/maxLevel/guarantee and fusion shape match the framework contract', () => {
    const pl = getItem('piercing-lance');
    expect(pl.track).toBe('offense');
    expect(pl.rarity).toBeGreaterThan(0);
    expect(pl.maxLevel).toBe(ITEM_MAX_LEVEL);
    expect(pl.guaranteeFromLevel).toBeNull();
    // Piercing Lance Lv5 + Overcharge Lv3 → Railgun (PRD §13.5); Epic 12 owns the consumption.
    expect(pl.fusion).toEqual({ partner: 'overcharge', epic: 'railgun' });
  });

  it('levels are TOTALS, not deltas — the carried-forward rungs are restated', () => {
    const [l1, l2, l3, l4, l5] = getItem('piercing-lance').levels.map((l) => l.stats);
    // L2's desc is 'pierces 4 enemies', yet it restates L1's period and damage.
    expect(l2.lancePeriodMs).toBe(l1.lancePeriodMs);
    expect(l2.lanceDamage).toBe(l1.lanceDamage);
    // L3's desc is '+50% damage / faster fire' alone, yet it restates the L2 pierce.
    expect(l3.lancePierce).toBe(l2.lancePierce);
    // L4's desc names the trail, yet it restates the L3 period/damage.
    expect(l4.lancePeriodMs).toBe(l3.lancePeriodMs);
    expect(l4.lanceDamage).toBe(l3.lanceDamage);
    // L5's desc names only the backward bolt, yet it restates the L4 pierce/trail.
    expect(l5.lancePierce).toBe(l4.lancePierce);
    expect(l5.lanceTrail).toBe(l4.lanceTrail);
    // Every level from L1 on fires a bolt with a real period/pierce/damage.
    for (const s of [l1, l2, l3, l4, l5]) {
      expect(s.lancePeriodMs).toBeGreaterThan(0);
      expect(s.lancePierce).toBeGreaterThanOrEqual(1);
      expect(s.lanceDamage).toBeGreaterThan(0);
    }
  });

  it('the trail flag exists ONLY from Lv4 and the backward flag ONLY at Lv5 (PRD §13.3)', () => {
    const levels = getItem('piercing-lance').levels;
    for (const lvl of levels.slice(0, 3)) {
      expect(lvl.stats.lanceTrail, `L${lvl.level} must not trail`).toBeUndefined();
    }
    expect(levels[3].stats.lanceTrail).toBe(1);
    expect(levels[4].stats.lanceTrail).toBe(1);
    for (const lvl of levels.slice(0, 4)) {
      expect(lvl.stats.lanceBackward, `L${lvl.level} must not fire backward`).toBeUndefined();
    }
    expect(levels[4].stats.lanceBackward).toBe(1);
  });

  it('pierce rises monotonically, the period never gets slower, the damage never shrinks', () => {
    const levels = getItem('piercing-lance').levels;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].stats.lancePierce).toBeGreaterThanOrEqual(levels[i - 1].stats.lancePierce);
      expect(levels[i].stats.lancePeriodMs).toBeLessThanOrEqual(
        levels[i - 1].stats.lancePeriodMs,
      );
      expect(levels[i].stats.lanceDamage).toBeGreaterThanOrEqual(levels[i - 1].stats.lanceDamage);
    }
  });

  it('carries no stat key outside the five lance rungs the story owns', () => {
    for (const lvl of getItem('piercing-lance').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect([
          'lancePeriodMs',
          'lancePierce',
          'lanceDamage',
          'lanceTrail',
          'lanceBackward',
        ]).toContain(k);
      }
    }
  });

  it('is the ONLY item authoring any Piercing Lance field (the additive-fold tripwire)', () => {
    for (const key of [
      'lancePeriodMs',
      'lancePierce',
      'lanceDamage',
      'lanceTrail',
      'lanceBackward',
    ]) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual(['piercing-lance']);
    }
  });

  it('keeps the PRD §13.3 desc strings verbatim (prose, never rewritten to the totals)', () => {
    expect(getItem('piercing-lance').levels.map((l) => l.desc)).toEqual([
      'pierces 2 enemies / fires every 2s',
      'pierces 4 enemies',
      '+50% damage / faster fire',
      'pierces 7 / leaves a damage trail',
      'fires a second bolt backward',
    ]);
  });
});

// --- Gravity Well (Story 11.7) ----------------------------------------------
describe('ITEM_REGISTRY — Gravity Well per-level stats (Story 11.7, PRD §13.4)', () => {
  const EXPECTED_GRAVITY_WELL_STATS = [
    { xpPickupRadiusMult: 0.4 },
    { xpPickupRadiusMult: 0.8 },
    { xpPickupRadiusMult: 0.8, gravityWellHoming: 1 },
    { xpPickupRadiusMult: 0.8, gravityWellHoming: 1, xpValueMult: 0.25 },
    { xpPickupRadiusMult: 1.5, gravityWellHoming: 1, xpValueMult: 0.25, gravityWellPullEnemies: 1 },
  ];

  it('pins all five levels exactly (frozen, totals-at-level)', () => {
    const gw = getItem('gravity-well');
    expect(gw.levels).toHaveLength(EXPECTED_GRAVITY_WELL_STATS.length);
    gw.levels.forEach((lvl, i) => {
      expect(lvl.stats, `gravity-well L${lvl.level}`).toEqual(EXPECTED_GRAVITY_WELL_STATS[i]);
      expect(Object.isFrozen(lvl.stats)).toBe(true);
    });
  });

  it('the track/rarity/maxLevel/guarantee and fusion shape match the framework contract', () => {
    const gw = getItem('gravity-well');
    expect(gw.track).toBe('defense');
    expect(gw.rarity).toBeGreaterThan(0);
    expect(gw.maxLevel).toBe(ITEM_MAX_LEVEL);
    expect(gw.guaranteeFromLevel).toBeNull();
    expect(gw.fusion).toEqual({ partner: 'mine-layer', epic: 'event-horizon' });
  });

  it('levels are TOTALS, not deltas — carried-forward rungs are restated', () => {
    const [l1, l2, l3, l4, l5] = getItem('gravity-well').levels.map((l) => l.stats);
    // L3 restates L2 radius bonus and adds homing.
    expect(l3.xpPickupRadiusMult).toBe(l2.xpPickupRadiusMult);
    expect(l3.gravityWellHoming).toBe(1);
    // L4 restates radius/homing and adds xpValueMult.
    expect(l4.xpPickupRadiusMult).toBe(l3.xpPickupRadiusMult);
    expect(l4.gravityWellHoming).toBe(l3.gravityWellHoming);
    expect(l4.xpValueMult).toBe(0.25);
    // L5 restates homing/xpValueMult, increases radius bonus to 1.5, and adds enemy pull.
    expect(l5.gravityWellHoming).toBe(l4.gravityWellHoming);
    expect(l5.xpValueMult).toBe(l4.xpValueMult);
    expect(l5.xpPickupRadiusMult).toBe(1.5);
    expect(l5.gravityWellPullEnemies).toBe(1);
  });

  it('the homing flag exists ONLY from Lv3, value boost from Lv4, pull from Lv5 (PRD §13.4)', () => {
    const levels = getItem('gravity-well').levels;
    expect(levels[0].stats.gravityWellHoming).toBeUndefined();
    expect(levels[1].stats.gravityWellHoming).toBeUndefined();
    expect(levels[2].stats.gravityWellHoming).toBe(1);
    expect(levels[3].stats.gravityWellHoming).toBe(1);
    expect(levels[4].stats.gravityWellHoming).toBe(1);

    expect(levels[0].stats.xpValueMult).toBeUndefined();
    expect(levels[1].stats.xpValueMult).toBeUndefined();
    expect(levels[2].stats.xpValueMult).toBeUndefined();
    expect(levels[3].stats.xpValueMult).toBe(0.25);
    expect(levels[4].stats.xpValueMult).toBe(0.25);

    expect(levels[0].stats.gravityWellPullEnemies).toBeUndefined();
    expect(levels[1].stats.gravityWellPullEnemies).toBeUndefined();
    expect(levels[2].stats.gravityWellPullEnemies).toBeUndefined();
    expect(levels[3].stats.gravityWellPullEnemies).toBeUndefined();
    expect(levels[4].stats.gravityWellPullEnemies).toBe(1);
  });

  it('is the ONLY item authoring any Gravity Well field (the additive-fold tripwire)', () => {
    for (const key of [
      'xpPickupRadiusMult',
      'gravityWellHoming',
      'xpValueMult',
      'gravityWellPullEnemies',
    ]) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual(['gravity-well']);
    }
  });

  it('keeps the PRD §13.4 desc strings verbatim (prose, never rewritten to the totals)', () => {
    expect(getItem('gravity-well').levels.map((l) => l.desc)).toEqual([
      '+40% XP pickup radius',
      '+80% XP pickup radius',
      'XP orbs home toward ship (540 px/s)',
      '+25% base XP value from orbs',
      '+150% pickup radius / XP orbs pull nearby enemies',
    ]);
  });
});

// --- Reinforced Hull (Story 11.8) ------------------------------------------
describe('ITEM_REGISTRY — Reinforced Hull stats (Story 11.8)', () => {
  const REINFORCED_HULL_FIELDS = [
    'extraLives',
    'respawnIFramesMs',
    'softenMultiplierReset',
  ];

  it('authors the exact five per-level stats maps, frozen', () => {
    const levels = getItem('reinforced-hull').levels;
    expect(levels.map((l) => l.stats)).toEqual([
      { extraLives: 1 },
      { extraLives: 1, respawnIFramesMs: 1500 },
      { extraLives: 2, respawnIFramesMs: 1500 },
      { extraLives: 2, respawnIFramesMs: 1500, softenMultiplierReset: 1 },
      { extraLives: 3, respawnIFramesMs: 1500, softenMultiplierReset: 1 },
    ]);
    for (const lvl of levels) {
      expect(Object.isFrozen(lvl.stats), `L${lvl.level} stats not frozen`).toBe(true);
    }
  });

  it('authors LEVELS as TOTALS, not deltas', () => {
    const [l1, l2, l3, l4, l5] = getItem('reinforced-hull').levels.map((l) => l.stats);
    // L2 restates extraLives: 1 and adds respawnIFramesMs: 1500
    expect(l2.extraLives).toBe(l1.extraLives);
    // L3 restates respawnIFramesMs: 1500 and updates extraLives: 2
    expect(l3.respawnIFramesMs).toBe(l2.respawnIFramesMs);
    // L4 restates extraLives: 2 & respawnIFramesMs: 1500 and adds softenMultiplierReset: 1
    expect(l4.extraLives).toBe(l3.extraLives);
    expect(l4.respawnIFramesMs).toBe(l3.respawnIFramesMs);
    // L5 restates respawnIFramesMs & softenMultiplierReset and updates extraLives: 3
    expect(l5.respawnIFramesMs).toBe(l4.respawnIFramesMs);
    expect(l5.softenMultiplierReset).toBe(l4.softenMultiplierReset);
  });

  it('carries no stat key outside the three rungs the story owns', () => {
    for (const lvl of getItem('reinforced-hull').levels) {
      for (const k of Object.keys(lvl.stats)) {
        expect(REINFORCED_HULL_FIELDS).toContain(k);
      }
    }
  });

  it('is the ONLY item authoring any Reinforced Hull field (the additive-fold tripwire)', () => {
    for (const key of REINFORCED_HULL_FIELDS) {
      const authors = ITEM_REGISTRY.filter((item) =>
        item.levels.some((lvl) => Object.prototype.hasOwnProperty.call(lvl.stats, key)),
      ).map((item) => item.id);
      expect(authors, `${key} must be authored by exactly one item`).toEqual([
        'reinforced-hull',
      ]);
    }
  });

  it('keeps the PRD §13.4 desc strings verbatim', () => {
    expect(getItem('reinforced-hull').levels.map((l) => l.desc)).toEqual([
      '+1 max life',
      '3.5s respawn i-frames',
      '+1 max life',
      'death drops multiplier to 50%',
      '+1 max life',
    ]);
  });
});

