import { describe, it, expect } from 'vitest';
import {
  createPlayerStats,
  recomputePlayerStats,
  PLAYER_STATS_BASE,
} from './PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';

// Story 10.1 — the runtime player-stat modifier store + its pure in-place fold. The
// fold resets to base then adds each owned item's CURRENT-LEVEL stats contribution. A
// SYNTHETIC-fixture registry drives the general folding math (including the malformed-
// definition guards); Story 10.2 added the first REAL-content exercise below, driving
// the SHIPPED ITEM_REGISTRY with Overcharge owned at every level.

// A synthetic registry whose stats maps are non-empty, so the fold is observable.
// Level entries are TOTALS-at-that-level (not deltas summed across levels).
const SYNTH_REGISTRY = [
  {
    id: 'dmg',
    track: 'offense',
    maxLevel: 3,
    levels: [
      { level: 1, desc: 'L1', stats: { damageMult: 0.15 } },
      { level: 2, desc: 'L2', stats: { damageMult: 0.25, fireRateMult: 0.1 } },
      { level: 3, desc: 'L3', stats: { damageMult: 0.35, fireRateMult: 0.2 } },
    ],
  },
  {
    id: 'shield',
    track: 'defense',
    maxLevel: 3,
    levels: [
      { level: 1, desc: 'L1', stats: { shieldCharges: 1 } },
      { level: 2, desc: 'L2', stats: { shieldCharges: 2 } },
      { level: 3, desc: 'L3', stats: { shieldCharges: 3 } },
    ],
  },
];

describe('createPlayerStats — the base modifier store', () => {
  it('returns every base field at its base value (mult fields 1, additive/count fields 0)', () => {
    const ps = createPlayerStats();
    expect(ps.damageMult).toBe(1);
    expect(ps.fireRateMult).toBe(1);
    expect(ps.moveSpeedMult).toBe(1);
    expect(ps.shieldCharges).toBe(0);
    expect(ps).toEqual({ ...PLAYER_STATS_BASE });
  });

  it('returns a fresh independent object each call', () => {
    const a = createPlayerStats();
    const b = createPlayerStats();
    expect(a).not.toBe(b);
    a.damageMult = 99;
    expect(b.damageMult).toBe(1);
  });
});

describe('recomputePlayerStats — the pure in-place fold', () => {
  it('empty ownership → the store is exactly the base', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, {}, SYNTH_REGISTRY);
    expect(ps).toEqual({ ...PLAYER_STATS_BASE });
  });

  it('folds each owned item CURRENT-LEVEL stats additively onto the base', () => {
    const ps = createPlayerStats();
    // dmg at level 2 → damageMult 1 + 0.25, fireRateMult 1 + 0.1; shield at level 1 → +1.
    recomputePlayerStats(ps, { dmg: 2, shield: 1 }, SYNTH_REGISTRY);
    expect(ps.damageMult).toBeCloseTo(1.25);
    expect(ps.fireRateMult).toBeCloseTo(1.1);
    expect(ps.moveSpeedMult).toBe(1); // untouched
    expect(ps.shieldCharges).toBe(1);
  });

  it('reads ONLY the current level (per-level entries are totals, not summed deltas)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { dmg: 3 }, SYNTH_REGISTRY);
    // Level 3 total is 0.35 — NOT 0.15 + 0.25 + 0.35.
    expect(ps.damageMult).toBeCloseTo(1.35);
    expect(ps.fireRateMult).toBeCloseTo(1.2);
  });

  it('resets to base on each call (a downgrade/rebuild does not accumulate)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { dmg: 3 }, SYNTH_REGISTRY);
    recomputePlayerStats(ps, { dmg: 1 }, SYNTH_REGISTRY); // recompute at a lower level
    expect(ps.damageMult).toBeCloseTo(1.15); // level-1 total, not stacked on the prior fold
    expect(ps.fireRateMult).toBe(1); // fireRate only appears at L2+ — back to base
  });

  it('is deterministic + mutates in place (same object, identical result twice, no per-call alloc)', () => {
    const ps = createPlayerStats();
    const owned = { dmg: 2, shield: 3 };
    const returned = recomputePlayerStats(ps, owned, SYNTH_REGISTRY);
    expect(returned).toBe(ps); // same object mutated in place (no new allocation)
    const snapshot = { ...ps };
    recomputePlayerStats(ps, owned, SYNTH_REGISTRY);
    expect(ps).toEqual(snapshot); // identical fold second time
  });

  it('clamps an over-cap owned level to the maxLevel entry (defensive)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { dmg: 99 }, SYNTH_REGISTRY); // above maxLevel 3
    expect(ps.damageMult).toBeCloseTo(1.35); // reads the level-3 (cap) entry
  });

  it('clamps to the LAST AUTHORED level when maxLevel outruns the levels array', () => {
    // An authoring slip a later item story can introduce: maxLevel 5 with only 3 level
    // entries. Clamping by maxLevel alone indexes past the end, and the undefined-entry
    // guard then drops the item's ENTIRE contribution instead of clamping — a silent
    // total loss of its effects. The fold must fall back to the last authored level.
    const shortRegistry = [
      {
        id: 'dmg',
        track: 'offense',
        rarity: 5,
        maxLevel: 5, // claims 5 …
        levels: [
          { level: 1, desc: 'L1', stats: { damageMult: 0.15 } },
          { level: 2, desc: 'L2', stats: { damageMult: 0.25 } },
          { level: 3, desc: 'L3', stats: { damageMult: 0.35 } }, // … but only authors 3
        ],
      },
    ];
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { dmg: 5 }, shortRegistry);
    expect(ps.damageMult).toBeCloseTo(1.35); // last authored level, NOT dropped to base 1
  });

  it('skips (never throws on) a definition with no authored `levels` array', () => {
    // The sibling authoring slip to the one above: a partially-authored item, or a
    // duck-typed `{ id, track, maxLevel }` fixture, reaching the fold. The clamp
    // dereferences `levels.length`, so an absent array throws a TypeError INSIDE the
    // fixed-step tick — killing the sim loop on the pick that owns the item. It must
    // contribute nothing and leave the rest of the fold intact.
    const malformed = [
      { id: 'noLevels', track: 'offense', rarity: 5, maxLevel: 5 }, // no `levels` at all
      { id: 'emptyLevels', track: 'defense', rarity: 4, maxLevel: 5, levels: [] },
      ...SYNTH_REGISTRY,
    ];
    const ps = createPlayerStats();
    expect(() =>
      recomputePlayerStats(ps, { noLevels: 2, emptyLevels: 1, dmg: 2 }, malformed),
    ).not.toThrow();
    // The malformed pair contributed nothing; the well-formed sibling still folded.
    expect(ps.damageMult).toBeCloseTo(1.25); // dmg L2
    expect(ps.fireRateMult).toBeCloseTo(1.1); // dmg L2
    expect(ps.shieldCharges).toBe(0);
  });

  it('the SHIPPED registry contributes ONLY Overcharge today (10.3–10.5 stats still empty)', () => {
    const ps = createPlayerStats();
    // Own every shipped item at a spread of levels. Only Overcharge has authored
    // numbers (Story 10.2); the other three carry empty stats maps, so the rest of
    // the store stays exactly at base.
    recomputePlayerStats(
      ps,
      { overcharge: 5, 'spread-cannon': 3, 'nanite-shield': 2, afterburner: 4 },
      ITEM_REGISTRY,
    );
    expect(ps.damageMult).toBeCloseTo(1.6);
    expect(ps.fireRateMult).toBeCloseTo(1.4);
    // The seams the other three stories own are untouched by this build.
    expect(ps.moveSpeedMult).toBe(PLAYER_STATS_BASE.moveSpeedMult);
    expect(ps.shieldCharges).toBe(PLAYER_STATS_BASE.shieldCharges);
    // And the fold introduced no key beyond the declared base fields.
    expect(Object.keys(ps).sort()).toEqual(Object.keys(PLAYER_STATS_BASE).sort());
  });

  it('the SHIPPED registry with NO Overcharge owned still folds to exactly base', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(
      ps,
      { 'spread-cannon': 5, 'nanite-shield': 5, afterburner: 5 },
      ITEM_REGISTRY,
    );
    expect(ps).toEqual({ ...PLAYER_STATS_BASE });
  });

  it('does NOT accumulate a non-base stat key across folds (robust reset via baseFor)', () => {
    // A synthetic item whose current-level stats carry keys NOT in PLAYER_STATS_BASE:
    // `critChance` (additive → base 0) and `fooMult` (multiplier → base 1). The reset
    // must return each to its convention base every fold, so folding the SAME owned set
    // twice yields the identical store — never a compounded value.
    const registry = [
      {
        id: 'exotic',
        track: 'offense',
        maxLevel: 1,
        levels: [{ level: 1, desc: 'L1', stats: { critChance: 0.1, fooMult: 0.2 } }],
      },
    ];
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { exotic: 1 }, registry);
    expect(ps.critChance).toBeCloseTo(0.1); // additive onto base 0
    expect(ps.fooMult).toBeCloseTo(1.2); // additive onto base 1
    const snapshot = { ...ps };
    recomputePlayerStats(ps, { exotic: 1 }, registry); // fold AGAIN over the same set
    expect(ps).toEqual(snapshot); // no accumulation: identical, not 0.2 / 1.4
    expect(ps.critChance).toBeCloseTo(0.1);
    expect(ps.fooMult).toBeCloseTo(1.2);
  });

  it('ignores an owned id absent from the registry (guarded, no throw)', () => {
    const ps = createPlayerStats();
    expect(() =>
      recomputePlayerStats(ps, { ghost: 2, dmg: 1 }, SYNTH_REGISTRY),
    ).not.toThrow();
    expect(ps.damageMult).toBeCloseTo(1.15); // only the known id folded
  });
});

describe('recomputePlayerStats — Overcharge against the REAL registry (Story 10.2)', () => {
  // The first real-content exercise of the fold: drive the SHIPPED ITEM_REGISTRY (not a
  // synthetic fixture) at every Overcharge level and pin the resulting multipliers. This
  // is what proves the authored fractional bonuses land as the intended TOTAL multipliers
  // — an authoring slip (writing 1.25 instead of 0.25) would show up here as 2.25x.
  const EXPECTED_BY_LEVEL = [
    { level: 1, damageMult: 1.15, fireRateMult: 1 },
    { level: 2, damageMult: 1.25, fireRateMult: 1.1 },
    { level: 3, damageMult: 1.35, fireRateMult: 1.2 },
    { level: 4, damageMult: 1.45, fireRateMult: 1.3 },
    { level: 5, damageMult: 1.6, fireRateMult: 1.4 },
  ];

  it.each(EXPECTED_BY_LEVEL)(
    'Overcharge Lv$level folds to damageMult $damageMult / fireRateMult $fireRateMult',
    ({ level, damageMult, fireRateMult }) => {
      const ps = createPlayerStats();
      recomputePlayerStats(ps, { overcharge: level }, ITEM_REGISTRY);
      expect(ps.damageMult).toBeCloseTo(damageMult, 10);
      expect(ps.fireRateMult).toBeCloseTo(fireRateMult, 10);
      // Overcharge touches ONLY the two global fire rungs.
      expect(ps.moveSpeedMult).toBe(1);
      expect(ps.shieldCharges).toBe(0);
    },
  );

  it('re-folding at a LOWER Overcharge level does not accumulate (levels are totals)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { overcharge: 5 }, ITEM_REGISTRY);
    recomputePlayerStats(ps, { overcharge: 1 }, ITEM_REGISTRY);
    expect(ps.damageMult).toBeCloseTo(1.15, 10);
    expect(ps.fireRateMult).toBe(1); // L1 has no fire-rate rung — back to base
  });

  it('an over-cap Overcharge level clamps to the Lv5 entry', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { overcharge: 99 }, ITEM_REGISTRY);
    expect(ps.damageMult).toBeCloseTo(1.6, 10);
    expect(ps.fireRateMult).toBeCloseTo(1.4, 10);
  });

  it('an unowned (level 0) Overcharge contributes nothing', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { overcharge: 0 }, ITEM_REGISTRY);
    expect(ps).toEqual({ ...PLAYER_STATS_BASE });
  });
});
