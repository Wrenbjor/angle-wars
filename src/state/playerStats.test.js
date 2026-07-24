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

  it('the SHIPPED registry contributes every one of the four Epic-10 items (all authored)', () => {
    const ps = createPlayerStats();
    // Own every shipped item at a spread of levels. All four now carry authored
    // numbers — Overcharge (10.2), Spread Cannon (10.3), Nanite Shield (10.4) and
    // Afterburner (10.5).
    recomputePlayerStats(
      ps,
      { overcharge: 5, 'spread-cannon': 3, 'nanite-shield': 2, afterburner: 4 },
      ITEM_REGISTRY,
    );
    expect(ps.damageMult).toBeCloseTo(1.6, 10); // Overcharge L5 only (Spread L3 adds none)
    expect(ps.fireRateMult).toBeCloseTo(1.7, 10); // 1 + 0.40 (OC L5) + 0.30 (Spread L3)
    expect(ps.spreadWays).toBe(5); // Spread Cannon L3 restates the L2 spread
    expect(ps.spreadArcDeg).toBe(16);
    // Nanite Shield L2: one MAX charge on a 15s recharge, no Lv5 knockback yet.
    expect(ps.shieldCharges).toBe(1);
    expect(ps.shieldRechargeMs).toBe(15000);
    expect(ps.shieldKnockback).toBe(0);
    // Afterburner L4: +25% speed, a 2s dash on i-frames + contact damage, no trail.
    expect(ps.moveSpeedMult).toBeCloseTo(1.25, 10);
    expect(ps.dashCooldownMs).toBe(2000);
    expect(ps.dashIFrames).toBe(1);
    expect(ps.dashDamage).toBe(1);
    expect(ps.dashTrail).toBe(0);
    // And the fold introduced no key beyond the declared base fields.
    expect(Object.keys(ps).sort()).toEqual(Object.keys(PLAYER_STATS_BASE).sort());
  });

  // --- Afterburner (Story 10.5) --------------------------------------------
  it('folds the SHIPPED Afterburner rungs 1..5 to the exact five fields', () => {
    // Drives the REAL registry, not a fixture: a re-authoring slip in itemRegistry.js
    // has to fail here as well as in the registry's own suite.
    const expected = [
      { moveSpeedMult: 1.12, dashCooldownMs: 0, dashIFrames: 0, dashDamage: 0, dashTrail: 0 },
      { moveSpeedMult: 1.2, dashCooldownMs: 3000, dashIFrames: 0, dashDamage: 0, dashTrail: 0 },
      { moveSpeedMult: 1.25, dashCooldownMs: 3000, dashIFrames: 1, dashDamage: 0, dashTrail: 0 },
      { moveSpeedMult: 1.25, dashCooldownMs: 2000, dashIFrames: 1, dashDamage: 1, dashTrail: 0 },
      { moveSpeedMult: 1.35, dashCooldownMs: 2000, dashIFrames: 1, dashDamage: 1, dashTrail: 1 },
    ];
    for (let level = 1; level <= 5; level++) {
      const ps = createPlayerStats();
      recomputePlayerStats(ps, { afterburner: level }, ITEM_REGISTRY);
      const e = expected[level - 1];
      expect(ps.moveSpeedMult, `L${level} moveSpeedMult`).toBeCloseTo(e.moveSpeedMult, 10);
      expect(ps.dashCooldownMs, `L${level} dashCooldownMs`).toBe(e.dashCooldownMs);
      expect(ps.dashIFrames, `L${level} dashIFrames`).toBe(e.dashIFrames);
      expect(ps.dashDamage, `L${level} dashDamage`).toBe(e.dashDamage);
      expect(ps.dashTrail, `L${level} dashTrail`).toBe(e.dashTrail);
    }
  });

  it('leaves all five Afterburner fields at base when it is UNOWNED', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { overcharge: 5 }, ITEM_REGISTRY);
    expect(ps.moveSpeedMult).toBe(1);
    expect(ps.dashCooldownMs).toBe(0);
    expect(ps.dashIFrames).toBe(0);
    expect(ps.dashDamage).toBe(0);
    expect(ps.dashTrail).toBe(0);
  });

  it('keeps the Afterburner fields unaffected by a stacked OFFENSE item', () => {
    // The two tracks share no fold key, so owning Overcharge must not perturb any
    // Afterburner field — the tripwire in the registry suite guards the authoring side,
    // this guards the folded side.
    const alone = createPlayerStats();
    recomputePlayerStats(alone, { afterburner: 3 }, ITEM_REGISTRY);
    const stacked = createPlayerStats();
    recomputePlayerStats(stacked, { afterburner: 3, overcharge: 5 }, ITEM_REGISTRY);
    for (const k of [
      'moveSpeedMult',
      'dashCooldownMs',
      'dashIFrames',
      'dashDamage',
      'dashTrail',
    ]) {
      expect(stacked[k], `${k} perturbed by an offense item`).toBe(alone[k]);
    }
    // …and the offense item did land, so the comparison is not vacuous.
    expect(stacked.damageMult).toBeGreaterThan(alone.damageMult);
  });

  it('exposes NO dash RUNTIME state through the fold (cooldown/window/direction)', () => {
    // The live cooldown, the active window and the dash direction are DashSystem's, for
    // the same reason the shield's live charge count is: this fold resets and re-derives
    // on EVERY pick, so a live timer here would be refunded by any unrelated item.
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { afterburner: 5 }, ITEM_REGISTRY);
    for (const k of Object.keys(ps)) {
      expect(k).not.toMatch(/remaining|active|dirX|dirY|dashSeq/i);
    }
    expect(Object.keys(ps).sort()).toEqual(Object.keys(PLAYER_STATS_BASE).sort());
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

describe('recomputePlayerStats — Spread Cannon against the REAL registry (Story 10.3)', () => {
  // The second real-content exercise of the fold, and the one that proves the two NEW
  // count fields (`spreadWays`/`spreadArcDeg`) land as authored and that the levels are
  // TOTALS: an author who wrote L3 as a delta ('+30% fire rate' with no spread) would
  // show up here as a Lv3 pick that DELETES the player's spread.
  const EXPECTED_BY_LEVEL = [
    { level: 1, spreadWays: 3, spreadArcDeg: 12, fireRateMult: 1, damageMult: 1 },
    { level: 2, spreadWays: 5, spreadArcDeg: 16, fireRateMult: 1, damageMult: 1 },
    { level: 3, spreadWays: 5, spreadArcDeg: 16, fireRateMult: 1.3, damageMult: 1 },
    { level: 4, spreadWays: 7, spreadArcDeg: 22, fireRateMult: 1.3, damageMult: 1 },
    { level: 5, spreadWays: 9, spreadArcDeg: 22, fireRateMult: 1.3, damageMult: 1.35 },
  ];

  it.each(EXPECTED_BY_LEVEL)(
    'Spread Cannon Lv$level folds to $spreadWays ways / $spreadArcDeg° / fireRateMult $fireRateMult / damageMult $damageMult',
    ({ level, spreadWays, spreadArcDeg, fireRateMult, damageMult }) => {
      const ps = createPlayerStats();
      recomputePlayerStats(ps, { 'spread-cannon': level }, ITEM_REGISTRY);
      expect(ps.spreadWays).toBe(spreadWays);
      expect(ps.spreadArcDeg).toBe(spreadArcDeg);
      expect(ps.fireRateMult).toBeCloseTo(fireRateMult, 10);
      expect(ps.damageMult).toBeCloseTo(damageMult, 10);
      // Spread Cannon touches nothing on the defense/movement seams.
      expect(ps.moveSpeedMult).toBe(1);
      expect(ps.shieldCharges).toBe(0);
    },
  );

  it('an unowned (level 0) Spread Cannon leaves the volley fields at their base of 0', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { 'spread-cannon': 0 }, ITEM_REGISTRY);
    expect(ps.spreadWays).toBe(0);
    expect(ps.spreadArcDeg).toBe(0);
    expect(ps).toEqual({ ...PLAYER_STATS_BASE });
  });

  it('re-folding at a LOWER Spread Cannon level does not accumulate (levels are totals)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { 'spread-cannon': 5 }, ITEM_REGISTRY);
    recomputePlayerStats(ps, { 'spread-cannon': 1 }, ITEM_REGISTRY);
    expect(ps.spreadWays).toBe(3); // the L1 TOTAL, not 3+5+5+7+9
    expect(ps.spreadArcDeg).toBe(12);
    expect(ps.fireRateMult).toBe(1); // L1 has no fire-rate rung — back to base
    expect(ps.damageMult).toBe(1);
  });

  it('STACKS ADDITIVELY with Overcharge on the shared fire rungs (both Lv5 → 1.70 / 1.95)', () => {
    // Two items contributing the same `*Mult` stack ADDITIVELY onto the single base of 1
    // (+40% and +30% → 1.70x, never 1.4 × 1.3 = 1.82). That is the specified fold, and
    // 1.70 is exactly the cadence BULLET_POOL_PREWARM is sized against.
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { overcharge: 5, 'spread-cannon': 5 }, ITEM_REGISTRY);
    expect(ps.fireRateMult).toBeCloseTo(1.7, 10); // 1 + 0.40 + 0.30
    expect(ps.damageMult).toBeCloseTo(1.95, 10); // 1 + 0.60 + 0.35
    expect(ps.spreadWays).toBe(9);
    expect(ps.spreadArcDeg).toBe(22);
  });

  it('an over-cap Spread Cannon level clamps to the Lv5 entry', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { 'spread-cannon': 99 }, ITEM_REGISTRY);
    expect(ps.spreadWays).toBe(9);
    expect(ps.spreadArcDeg).toBe(22);
    expect(ps.damageMult).toBeCloseTo(1.35, 10);
  });
});

describe('recomputePlayerStats — Nanite Shield against the REAL registry (Story 10.4)', () => {
  // The third real-content exercise of the fold, and the first for a DEFENSE item. The
  // three fields are all ADDITIVE/COUNT (base 0), and `shieldCharges` is the MAXIMUM
  // charge count — never the live one (that is runtime state on NaniteShieldSystem,
  // deliberately kept OUT of this store because the fold resets it on every pick).
  const EXPECTED_BY_LEVEL = [
    { level: 1, shieldCharges: 1, shieldRechargeMs: 20000, shieldKnockback: 0 },
    { level: 2, shieldCharges: 1, shieldRechargeMs: 15000, shieldKnockback: 0 },
    { level: 3, shieldCharges: 2, shieldRechargeMs: 15000, shieldKnockback: 0 },
    { level: 4, shieldCharges: 2, shieldRechargeMs: 10000, shieldKnockback: 0 },
    { level: 5, shieldCharges: 3, shieldRechargeMs: 10000, shieldKnockback: 1 },
  ];

  it.each(EXPECTED_BY_LEVEL)(
    'Nanite Shield Lv$level folds to $shieldCharges max charges / $shieldRechargeMs ms / knockback $shieldKnockback',
    ({ level, shieldCharges, shieldRechargeMs, shieldKnockback }) => {
      const ps = createPlayerStats();
      recomputePlayerStats(ps, { 'nanite-shield': level }, ITEM_REGISTRY);
      expect(ps.shieldCharges).toBe(shieldCharges);
      expect(ps.shieldRechargeMs).toBe(shieldRechargeMs);
      expect(ps.shieldKnockback).toBe(shieldKnockback);
      // Nanite Shield touches nothing on the fire/volley/movement seams.
      expect(ps.damageMult).toBe(1);
      expect(ps.fireRateMult).toBe(1);
      expect(ps.spreadWays).toBe(0);
      expect(ps.spreadArcDeg).toBe(0);
      expect(ps.moveSpeedMult).toBe(1);
    },
  );

  it('an unowned (level 0) Nanite Shield leaves all three shield fields at their base', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { 'nanite-shield': 0 }, ITEM_REGISTRY);
    expect(ps.shieldCharges).toBe(PLAYER_STATS_BASE.shieldCharges);
    expect(ps.shieldRechargeMs).toBe(PLAYER_STATS_BASE.shieldRechargeMs);
    expect(ps.shieldKnockback).toBe(PLAYER_STATS_BASE.shieldKnockback);
    expect(ps).toEqual({ ...PLAYER_STATS_BASE });
  });

  it('re-folding at a LOWER Nanite Shield level does not accumulate (levels are totals)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { 'nanite-shield': 5 }, ITEM_REGISTRY);
    recomputePlayerStats(ps, { 'nanite-shield': 1 }, ITEM_REGISTRY);
    expect(ps.shieldCharges).toBe(1); // the L1 TOTAL, not 1+1+2+2+3
    expect(ps.shieldRechargeMs).toBe(20000); // and not 20000+15000+15000+10000+10000
    expect(ps.shieldKnockback).toBe(0); // the Lv5 pulse flag is GONE at L1
  });

  it('an over-cap Nanite Shield level clamps to the Lv5 entry', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, { 'nanite-shield': 99 }, ITEM_REGISTRY);
    expect(ps.shieldCharges).toBe(3);
    expect(ps.shieldRechargeMs).toBe(10000);
    expect(ps.shieldKnockback).toBe(1);
  });

  it('an OFFENSE item owned alongside it leaves the three shield fields untouched', () => {
    // The stacking check from the other side: Overcharge and Spread Cannon contribute
    // nothing to any `shield*` field, so a maxed offense build cannot inflate (or
    // shorten the recharge of) the shield. The shared-field additive stacking the fold
    // specifies applies only where two items author the SAME key.
    const ps = createPlayerStats();
    recomputePlayerStats(
      ps,
      { 'nanite-shield': 3, overcharge: 5, 'spread-cannon': 5 },
      ITEM_REGISTRY,
    );
    // Shield fields are exactly the Lv3 totals — no offense contribution leaked in.
    expect(ps.shieldCharges).toBe(2);
    expect(ps.shieldRechargeMs).toBe(15000);
    expect(ps.shieldKnockback).toBe(0);
    // …and the offense rungs still stack additively with each other, unaffected.
    expect(ps.fireRateMult).toBeCloseTo(1.7, 10);
    expect(ps.damageMult).toBeCloseTo(1.95, 10);
    expect(ps.spreadWays).toBe(9);
  });
});
