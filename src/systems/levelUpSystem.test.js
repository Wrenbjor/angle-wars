import { describe, it, expect } from 'vitest';
import { LevelUpSystem } from './LevelUpSystem.js';
import { createProgressionState } from '../state/ProgressionState.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import {
  FIXED_STEP_MS,
  LEVELUP_INVULN_FLOOR,
  LEVELUP_LANDING_INVULN_MS,
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
  CARD_OFFER_SIZE,
  ITEM_MAX_LEVEL,
  SPREAD_CANNON_GUARANTEE_LEVEL,
} from '../config/constants.js';

// Story 8.3/8.4/8.5/10.1 — the level-up state machine. LevelUpSystem edge-detects the
// level-up, enqueues owed selections, holds invuln, and offers a weighted seeded draw
// from the injected item registry (Story 10.1). The offer is VARIABLE LENGTH: full up to
// CARD_OFFER_SIZE, SHORT when fewer are eligible, and EMPTY (auto-drained) when none are.
// A latched choice re-folds PlayerStats. Every case drives plain stubs + a deterministic
// stub rng, asserting the public fields.

function seqRng(values = [0.13, 0.47, 0.81, 0.29, 0.63]) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

function build({ invulnMs = 0, rng = seqRng(), registry = ITEM_REGISTRY, playerStats } = {}) {
  const levelStub = { level: 1, levelsGainedThisTick: 0 };
  const playerStub = { invulnMs };
  const prog = createProgressionState();
  const ps = playerStats ?? createPlayerStats();
  const sys = new LevelUpSystem(levelStub, playerStub, prog, registry, ps, rng);
  return { sys, levelStub, playerStub, prog, rng, playerStats: ps };
}

// A full offer is CARD_OFFER_SIZE distinct registry items (the 5-item registry yields 3).
function expectValidOffer(offer, registry = ITEM_REGISTRY) {
  expect(offer).toHaveLength(CARD_OFFER_SIZE);
  const ids = offer.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of offer) expect(registry).toContain(c);
}

describe('LevelUpSystem — constructor argument guards (Story 10.1 signature shift)', () => {
  // Story 10.1 inserted `registry` and `playerStats` at positional slots 4/5, pushing
  // `rng` to slot 6. A stale caller threading its rng at slot 4 or 5 fails SILENTLY
  // without these guards: at slot 4 `pool.length` is 0 so every draw returns an empty
  // offer and the auto-drain swallows every owed pick for the whole run; at slot 5 the
  // rng binds to `playerStats` and `rng` falls back to Math.random, so the offer leaves
  // the seedable stream. Both guards are load-bearing, so both are pinned here.
  const args = () => [
    { level: 1, levelsGainedThisTick: 0 },
    { invulnMs: 0 },
    createProgressionState(),
  ];

  it('throws when `registry` (arg 4) is not an array — the stale rng-at-slot-4 call', () => {
    const rng = seqRng();
    expect(() => new LevelUpSystem(...args(), rng, createPlayerStats())).toThrow(TypeError);
    expect(() => new LevelUpSystem(...args(), rng, createPlayerStats())).toThrow(
      /`registry` \(arg 4\)/,
    );
  });

  it.each([
    ['a number', 42],
    ['a string', 'stats'],
    ['a boolean', true],
    ['a function', () => {}],
    ['an array', []],
    // Everything below is `typeof === 'object'`, so a bare type test would let it
    // through as an empty stat store — base calcs and a silent fold onto the wrong
    // object for the whole run with no diagnostic. These are the shapes actually in
    // scope at the buildArenaWorld call site, i.e. the wrong-slot mistake the guard
    // names.
    ['a Map', new Map([['fireRateMult', 1.4]])],
    ['a Set', new Set()],
    ['a Date', new Date(0)],
    ['a typed array', new Int32Array(2)],
  ])(
    'throws when `playerStats` (arg 5) is present but is %s',
    (_label, bad) => {
      const rng = seqRng();
      expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, bad)).toThrow(TypeError);
      expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, bad)).toThrow(
        /`playerStats` \(arg 5\)/,
      );
    },
  );

  it('names what actually arrived, not just "object"', () => {
    const rng = seqRng();
    expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, new Map())).toThrow(/Map instance/);
    expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, [])).toThrow(/array/);
    expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, 42)).toThrow(/number/);
  });

  it('accepts the correct 6-arg call, and an omitted `playerStats` (pre-10.1 stubs)', () => {
    expect(
      () =>
        new LevelUpSystem(...args(), ITEM_REGISTRY, createPlayerStats(), seqRng()),
    ).not.toThrow();
    expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY)).not.toThrow();
    expect(
      () => new LevelUpSystem(...args(), ITEM_REGISTRY, null, seqRng()),
    ).not.toThrow();
  });
});

describe('LevelUpSystem — level-up moment state machine', () => {
  it('idle: no level-up, nothing pending → inactive, empty offer, invuln untouched', () => {
    const { sys, playerStub } = build({ invulnMs: 0 });
    sys.fixedUpdate();
    expect(sys.selectionActive).toBe(false);
    expect(sys.pendingSelections).toBe(0);
    expect(sys.currentOffer).toEqual([]);
    expect(playerStub.invulnMs).toBe(0);
  });

  it('level-up fires: pending 1, offer of 3 distinct registry cards, active, invuln armed', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expectValidOffer(sys.currentOffer);
    expect(sys.selectionActive).toBe(true);
    expect(playerStub.invulnMs).toBeGreaterThanOrEqual(LEVELUP_INVULN_FLOOR);
  });

  it('the weighted draw is deterministic under a fixed-sequence stub rng', () => {
    const seq = [0.17, 0.53, 0.88, 0.31, 0.72];
    const a = build({ rng: seqRng(seq) });
    a.levelStub.levelsGainedThisTick = 1;
    a.sys.fixedUpdate();
    const b = build({ rng: seqRng(seq) });
    b.levelStub.levelsGainedThisTick = 1;
    b.sys.fixedUpdate();
    expect(a.sys.currentOffer.map((c) => c.id)).toEqual(b.sys.currentOffer.map((c) => c.id));
  });

  it('multi-level jump (levelsGainedThisTick 3): owes three picks, offer of 3 distinct cards', () => {
    const { sys, levelStub } = build();
    levelStub.levelsGainedThisTick = 3;
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(3);
    expectValidOffer(sys.currentOffer);
  });

  it('multi-level jump: after a pick drains, the fresh post-pick offer reflects updated ownership', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    const picked = sys.currentOffer[0];
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(prog.ownedCards[picked.id]).toBe(1);
    expectValidOffer(sys.currentOffer);
    expect(sys.pendingSelections).toBe(1);
    expect(sys.selectionActive).toBe(true);
  });

  it('invuln held: re-armed ≥ FLOOR each pending tick, never drains to 0', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    for (let i = 0; i < 50; i++) {
      sys.fixedUpdate();
      playerStub.invulnMs -= FIXED_STEP_MS;
      expect(playerStub.invulnMs).toBeGreaterThan(0);
    }
  });

  it('no re-enqueue: later ticks with levelsGainedThisTick 0 leave pending unchanged', () => {
    const { sys, levelStub } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.fixedUpdate();
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).toHaveLength(CARD_OFFER_SIZE);
  });

  it('select, none left: applies the picked card (records ownership + pick counter), closes', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    const card = sys.currentOffer[1];
    sys.queueSelection(1);
    sys.fixedUpdate();
    expect(prog.ownedCards[card.id]).toBe(1);
    expect(prog.debugStat).toBe(1); // pick counter (no statDelta anymore)
    expect(sys.pendingSelections).toBe(0);
    expect(sys.currentOffer).toEqual([]);
    expect(sys.selectionActive).toBe(false);
  });

  it('a pick re-folds PlayerStats from the updated owned set (synthetic registry proves the fold ran)', () => {
    const registry = [
      { id: 'dmg', track: 'offense', rarity: 5, maxLevel: 5, levels: [
        { level: 1, desc: 'L1', stats: { damageMult: 0.15 } },
        { level: 2, desc: 'L2', stats: { damageMult: 0.25 } },
        { level: 3, desc: 'L3', stats: { damageMult: 0.35 } },
        { level: 4, desc: 'L4', stats: { damageMult: 0.45 } },
        { level: 5, desc: 'L5', stats: { damageMult: 0.6 } },
      ] },
    ];
    const { sys, levelStub, playerStats } = build({ registry });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(playerStats.damageMult).toBe(1); // not yet picked
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate(); // pick 'dmg' → level 1 → fold
    expect(playerStats.damageMult).toBeCloseTo(1.15);
  });

  // The fold FREQUENCY invariant (Boundaries + AC: "runs only on a level change, never
  // per frame"). Asserting the resulting VALUE cannot catch a regression that hoists the
  // fold into every tick — the store ends up identical either way. Count the folds
  // instead, via a counting `stats` getter that only the fold reads.
  it('the PlayerStats fold runs ONCE on the pick and never again per tick (no per-frame fold)', () => {
    let statsReads = 0;
    const registry = [
      {
        id: 'dmg',
        title: 'Dmg',
        track: 'offense',
        rarity: 5,
        maxLevel: 5,
        levels: Array.from({ length: 5 }, (_, i) => ({
          level: i + 1,
          desc: `L${i + 1}`,
          get stats() {
            statsReads++;
            return { damageMult: 0.15 };
          },
        })),
      },
    ];
    const { sys, levelStub, playerStats } = build({ registry });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate(); // offer opens; nothing owned yet, so the fold reads no stats
    levelStub.levelsGainedThisTick = 0;
    expect(statsReads).toBe(0);
    sys.queueSelection(0);
    sys.fixedUpdate(); // the pick → exactly ONE fold over the one owned item
    expect(statsReads).toBe(1);
    expect(playerStats.damageMult).toBeCloseTo(1.15);
    // 120 further ticks (2 seconds of fixed steps) with no crossing and nothing
    // pending must not re-fold even once.
    for (let t = 0; t < 120; t++) sys.fixedUpdate();
    expect(statsReads).toBe(1);
  });

  it('final pick grants the longer LANDING invuln when the queue empties', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(playerStub.invulnMs).toBe(LEVELUP_INVULN_FLOOR);
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(0);
    expect(playerStub.invulnMs).toBe(LEVELUP_LANDING_INVULN_MS);
  });

  it('landing grant never SHRINKS a larger invuln already in flight', () => {
    const bigShield = LEVELUP_LANDING_INVULN_MS + 1200;
    const { sys, levelStub, playerStub } = build({ invulnMs: bigShield });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(playerStub.invulnMs).toBe(bigShield);
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(playerStub.invulnMs).toBe(bigShield);
  });

  it('a non-final pick keeps the per-tick floor re-arm, NOT the landing grace', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(playerStub.invulnMs).toBe(LEVELUP_INVULN_FLOOR);
  });

  it('select, more left: applies, drains one, rebuilds a fresh offer, stays active', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    const first = sys.currentOffer[0];
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(prog.ownedCards[first.id]).toBe(1);
    expect(prog.debugStat).toBe(1);
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).toHaveLength(CARD_OFFER_SIZE);
    expect(sys.selectionActive).toBe(true);
  });

  // Regression net for step (2)'s UNCONDITIONAL enqueue: a level crossed while the
  // overlay is already open must still OWE a pick. Gating the enqueue on
  // `!selectionActive` would silently eat that pick, and no other case drives two
  // consecutive crossing ticks.
  it('level-up mid-selection: another crossing while pending increments the count; next offer shows after the pick', () => {
    const { sys, levelStub } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate(); // pending 1
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate(); // another crossing mid-selection → pending 2
    levelStub.levelsGainedThisTick = 0;
    expect(sys.pendingSelections).toBe(2);
    sys.queueSelection(0);
    sys.fixedUpdate(); // pick one → pending 1, fresh offer
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).toHaveLength(CARD_OFFER_SIZE);
    expect(sys.selectionActive).toBe(true);
  });

  it('invalid index (5 or -1): guarded no-op — latch cleared, no apply, pending unchanged', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(5);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(sys.pendingSelections).toBe(1);
    expect(prog.debugStat).toBe(0);
    expect(sys._queuedChoice).toBe(null);
    sys.queueSelection(-1);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(sys.selectionActive).toBe(true);
  });

  it('select with none pending: guarded no-op — no apply, no throw', () => {
    const { sys, prog } = build();
    sys.queueSelection(0);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.debugStat).toBe(0);
    expect(prog.ownedCards).toEqual({});
    expect(sys.pendingSelections).toBe(0);
  });

  it('queueSelection latches only the first choice within a fixed-step window', () => {
    const { sys } = build();
    sys.queueSelection(0);
    sys.queueSelection(2);
    expect(sys._queuedChoice).toBe(0);
  });
});

describe('LevelUpSystem — Story 10.1 variable-size offers', () => {
  // A SHORT offer: pre-banish 7 of the 9 registry items (Story 11.1 added orbit-blade,
  // Story 11.2 added seeker-drones, Story 11.3 added mine-layer, Story 11.4 added
  // piercing-lance, Story 11.5 added ricochet-rounds, so banishing 7 leaves 2), then cross a
  // level. The offer is exactly the 2 eligible cards; a pick against a 2-card offer applies
  // normally.
  it('short offer (2 eligible): offer holds exactly 2 cards, and a pick applies', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set([
      'overcharge',
      'nanite-shield',
      'orbit-blade',
      'seeker-drones',
      'mine-layer',
      'piercing-lance',
      'ricochet-rounds',
      'flak-burst',
      'gravity-well',
      'reinforced-hull',
      'bomb-capacitor',
      'chrono-field',
    ]);
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.currentOffer).toHaveLength(2);
    const ids = sys.currentOffer.map((c) => c.id);
    expect(ids).not.toContain('overcharge');
    expect(sys.selectionActive).toBe(true);
    levelStub.levelsGainedThisTick = 0;
    const picked = sys.currentOffer[1];
    sys.queueSelection(1); // valid index within the 2-card offer
    sys.fixedUpdate();
    expect(prog.ownedCards[picked.id]).toBe(1);
    expect(sys.pendingSelections).toBe(0);
    expect(sys.selectionActive).toBe(false);
  });

  it('short offer: a pick at index === offer.length (out of the short range) is a guarded no-op', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set([
      'overcharge',
      'nanite-shield',
      'orbit-blade',
      'seeker-drones',
      'mine-layer',
      'piercing-lance',
      'ricochet-rounds',
      'flak-burst',
      'gravity-well',
      'reinforced-hull',
      'bomb-capacitor',
      'chrono-field',
    ]);
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.currentOffer).toHaveLength(2);
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(2); // valid for a 3-card offer, but this one holds 2
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1); // unchanged — no apply
    expect(Object.keys(prog.ownedCards)).toHaveLength(0);
    expect(sys.selectionActive).toBe(true);
  });

  // An EMPTY offer: all 13 registry items banished → 0 eligible. The owed pick AUTO-DRAINS
  // with no card applied, the overlay closes, and the landing invuln is granted.
  it('empty offer (0 eligible): the owed pick auto-drains, no card applied, landing invuln granted', () => {
    const { sys, levelStub, prog, playerStub } = build({ invulnMs: 0 });
    prog.banishedIds = new Set([
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
      'bomb-capacitor',
      'chrono-field',
    ]);
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.currentOffer).toEqual([]);
    expect(sys.pendingSelections).toBe(0); // drained
    expect(sys.selectionActive).toBe(false); // overlay closes
    expect(Object.keys(prog.ownedCards)).toHaveLength(0); // no card applied
    expect(playerStub.invulnMs).toBe(LEVELUP_LANDING_INVULN_MS); // landing grace granted
  });

  it('empty offer auto-drain grant never SHRINKS a larger invuln already in flight (takes the MAX)', () => {
    // A 0-eligible offer grants Math.max(invulnMs, LANDING). Seed a LARGER in-flight
    // window (e.g. a fresh respawn shield) so a regression to a plain assign — which
    // would clobber it down to 800 — fails here (mirrors the pick-path max guard).
    const bigShield = LEVELUP_LANDING_INVULN_MS + 1200;
    const { sys, levelStub, prog, playerStub } = build({ invulnMs: bigShield });
    prog.banishedIds = new Set([
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
      'bomb-capacitor',
      'chrono-field',
    ]);
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(0); // drained
    expect(sys.selectionActive).toBe(false);
    expect(playerStub.invulnMs).toBe(bigShield); // preserved, not dropped to 800
  });

  it('empty offer drains ALL owed picks of a multi-level jump at once', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set([
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
      'bomb-capacitor',
      'chrono-field',
    ]);
    levelStub.levelsGainedThisTick = 3; // owes 3
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(0); // all drained, not just one
    expect(sys.selectionActive).toBe(false);
  });

  it('empty offer never holds the player invulnerable: no lingering pending across ticks', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set([
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
      'bomb-capacitor',
      'chrono-field',
    ]);

    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.fixedUpdate();
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(0);
    expect(sys.selectionActive).toBe(false);
    expect(sys.currentOffer).toEqual([]);
  });
});

describe('LevelUpSystem — Story 8.5 reroll & banish', () => {
  function openSelection(opts) {
    const world = build(opts);
    world.levelStub.level = 2;
    world.levelStub.levelsGainedThisTick = 1;
    world.sys.fixedUpdate();
    world.levelStub.levelsGainedThisTick = 0;
    return world;
  }

  it('reroll with a charge: spends one, redraws a fresh offer (new array), pending unchanged', () => {
    const { sys, prog } = openSelection();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    const oldOffer = sys.currentOffer;
    sys.queueReroll();
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES - 1);
    expect(sys.currentOffer).not.toBe(oldOffer);
    expectValidOffer(sys.currentOffer);
    expect(sys.pendingSelections).toBe(1);
    expect(sys.selectionActive).toBe(true);
  });

  it('reroll deterministic: same rng + state, reroll twice → identical redrawn offer', () => {
    const seq = [0.19, 0.61, 0.08, 0.44, 0.77, 0.23, 0.9, 0.35];
    const a = openSelection({ rng: seqRng(seq) });
    a.sys.queueReroll();
    a.sys.fixedUpdate();
    const b = openSelection({ rng: seqRng(seq) });
    b.sys.queueReroll();
    b.sys.fixedUpdate();
    expect(a.sys.currentOffer.map((c) => c.id)).toEqual(b.sys.currentOffer.map((c) => c.id));
  });

  it('reroll depleted: guarded no-op — offer unchanged (same array), charge stays 0', () => {
    const { sys, prog } = openSelection();
    prog.rerollCharges = 0;
    const oldOffer = sys.currentOffer;
    sys.queueReroll();
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(0);
    expect(sys.currentOffer).toBe(oldOffer);
  });

  it('reroll level grant: crossing INTO level 10 grants +1 reroll on that tick', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 10;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES + 1);
  });

  it('reroll multi-grant: a single jump 9→16 crosses 10 AND 15 → +2 rerolls', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 16;
    levelStub.levelsGainedThisTick = 7;
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES + 2);
  });

  it('reroll grant lower bound: a crossing whose prevLevel is already past a threshold grants nothing', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 12;
    levelStub.levelsGainedThisTick = 1;
    const before = prog.rerollCharges;
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(before);
  });

  it('reroll no re-grant: a non-crossing tick (levelsGainedThisTick 0) at level 20 grants nothing', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 20;
    levelStub.levelsGainedThisTick = 0;
    const before = prog.rerollCharges;
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(before);
  });

  it('banish with a charge: adds the focused id to banishedIds, spends one, fresh offer excludes it', () => {
    const { sys, prog } = openSelection();
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    const bannedId = sys.currentOffer[0].id;
    sys.queueBanish(0);
    sys.fixedUpdate();
    expect(prog.banishedIds.has(bannedId)).toBe(true);
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES - 1);
    expectValidOffer(sys.currentOffer);
    expect(sys.currentOffer.some((c) => c.id === bannedId)).toBe(false);
    expect(sys.pendingSelections).toBe(1);
  });

  it('banish never returns: after banishing id X, many subsequent redraws never offer X again', () => {
    const { sys, prog } = openSelection();
    const bannedId = sys.currentOffer[0].id;
    sys.queueBanish(0);
    sys.fixedUpdate();
    prog.rerollCharges = 50;
    for (let t = 0; t < 40; t++) {
      sys.queueReroll();
      sys.fixedUpdate();
      expect(sys.currentOffer.some((c) => c.id === bannedId)).toBe(false);
    }
  });

  // Regression net for the reroll/banish guards under a MULTI-pick queue: the tool must
  // change only the offer, never the owed count or the held invuln. These are the cases
  // where the Story 10.1 empty-offer auto-drain could destroy several owed picks at once.
  it('multi-pick reroll: with pending 2, a reroll leaves both picks owed + player invuln, redraws a fresh offer; a later pick drains to 1', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.level = 3;
    levelStub.levelsGainedThisTick = 2; // prevLevel 1 → pending 2, no reroll grant
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    expect(sys.pendingSelections).toBe(2);
    const oldOffer = sys.currentOffer;
    sys.queueReroll();
    sys.fixedUpdate();
    // Both picks are STILL owed and the player is STILL invulnerable (only the offer changed).
    expect(sys.pendingSelections).toBe(2);
    expect(playerStub.invulnMs).toBeGreaterThanOrEqual(LEVELUP_INVULN_FLOOR);
    expect(sys.currentOffer).not.toBe(oldOffer);
    expectValidOffer(sys.currentOffer);
    expect(sys.selectionActive).toBe(true);
    // A subsequent pick drains to 1 with a fresh offer, still active.
    const afterReroll = sys.currentOffer;
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).not.toBe(afterReroll);
    expectValidOffer(sys.currentOffer);
    expect(sys.selectionActive).toBe(true);
  });

  it('multi-pick banish: with pending 2, a banish leaves both picks owed + player invuln, redraws a fresh offer excluding the id; a later pick drains to 1', () => {
    const { sys, levelStub, playerStub, prog } = build({ invulnMs: 0 });
    levelStub.level = 3;
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    expect(sys.pendingSelections).toBe(2);
    const bannedId = sys.currentOffer[0].id;
    const oldOffer = sys.currentOffer;
    sys.queueBanish(0);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(2);
    expect(playerStub.invulnMs).toBeGreaterThanOrEqual(LEVELUP_INVULN_FLOOR);
    expect(prog.banishedIds.has(bannedId)).toBe(true);
    expect(sys.currentOffer).not.toBe(oldOffer);
    expectValidOffer(sys.currentOffer);
    expect(sys.currentOffer.some((c) => c.id === bannedId)).toBe(false);
    expect(sys.selectionActive).toBe(true);
    // A subsequent pick drains to 1 with a fresh offer.
    const afterBanish = sys.currentOffer;
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).not.toBe(afterBanish);
    expectValidOffer(sys.currentOffer);
  });

  it('banish depleted: guarded no-op — nothing banished, offer unchanged, charge stays 0', () => {
    const { sys, prog } = openSelection();
    prog.banishCharges = 0;
    const oldOffer = sys.currentOffer;
    sys.queueBanish(0);
    sys.fixedUpdate();
    expect(prog.banishCharges).toBe(0);
    expect(prog.banishedIds.size).toBe(0);
    expect(sys.currentOffer).toBe(oldOffer);
  });

  it('banish invalid index (5 / -1): guarded no-op — latch cleared, nothing banished, no throw', () => {
    const { sys, prog } = openSelection();
    const oldOffer = sys.currentOffer;
    sys.queueBanish(5);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.banishedIds.size).toBe(0);
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(sys._queuedBanish).toBe(null);
    expect(sys.currentOffer).toBe(oldOffer);
    sys.queueBanish(-1);
    sys.fixedUpdate();
    expect(prog.banishedIds.size).toBe(0);
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
  });

  it('reroll/banish with none pending: guarded no-op — no charge spent, no throw', () => {
    const { sys, prog } = build();
    sys.queueReroll();
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    sys.queueBanish(0);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(prog.banishedIds.size).toBe(0);
    expect(sys.selectionActive).toBe(false);
  });

  it('latch idempotency: two queueReroll() before a tick spend only one charge', () => {
    const { sys, prog } = openSelection();
    prog.rerollCharges = 2;
    sys.queueReroll();
    sys.queueReroll();
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(1);
  });

  it('latch idempotency: queueBanish honors only the first index within a fixed-step window', () => {
    const { sys } = build();
    sys.queueBanish(0);
    sys.queueBanish(1);
    expect(sys._queuedBanish).toBe(0);
  });

  it('a same-tick pick empties the offer, so a same-tick reroll/banish is a no-op that spends no charge', () => {
    const { sys, prog } = openSelection();
    const rerollBefore = prog.rerollCharges;
    const banishBefore = prog.banishCharges;
    sys.queueSelection(0);
    sys.queueReroll();
    sys.queueBanish(1);
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(rerollBefore);
    expect(prog.banishCharges).toBe(banishBefore);
    expect(prog.banishedIds.size).toBe(0);
  });
});

describe('LevelUpSystem — the Spread Cannon offer guarantee (Story 10.3)', () => {
  // PRD §13.3's onboarding beat, end to end through the system: LevelUpSystem threads its
  // CURRENT run level into drawCardOffer, so an unowned Spread Cannon is reserved a slot
  // from run level 3 onward — unless an exclusion outranks it.
  const spreadIds = (sys) => sys.currentOffer.map((c) => c.id);

  it('a level-3 crossing with spread-cannon UNOWNED produces an offer containing it', () => {
    const { sys, levelStub, prog } = build();
    expect(prog.ownedCards['spread-cannon']).toBeUndefined();
    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expectValidOffer(sys.currentOffer);
    expect(spreadIds(sys)).toContain('spread-cannon');
    expect(sys.currentOffer[0].id).toBe('spread-cannon'); // the reserved slot
  });

  it('BELOW level 3 the offer is the ordinary weighted draw (no reservation)', () => {
    // The 4-item registry always yields a 3-card offer, so "contains it" proves nothing
    // below the threshold — instead pin that the draw is IDENTICAL to one built by a
    // system whose level never reaches the threshold at all.
    const seq = [0.17, 0.53, 0.88, 0.31, 0.72];
    const a = build({ rng: seqRng(seq) });
    a.levelStub.level = 2;
    a.levelStub.levelsGainedThisTick = 1;
    a.sys.fixedUpdate();
    // Same seed, same (empty) ownership, level 0 — the pre-10.3 baseline.
    const b = build({ rng: seqRng(seq) });
    b.levelStub.level = 0;
    b.levelStub.levelsGainedThisTick = 1;
    b.sys.fixedUpdate();
    expect(spreadIds(a.sys)).toEqual(spreadIds(b.sys));
  });

  it('picking the guaranteed card removes the guarantee from the NEXT offer', () => {
    // A multi-level jump owes two picks, so the post-pick tick rebuilds the offer against
    // the just-updated ownership — the exact path the guarantee must retire on.
    const { sys, levelStub, prog } = build();
    levelStub.level = 4;
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    expect(sys.currentOffer[0].id).toBe('spread-cannon');

    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0); // take the guaranteed card
    sys.fixedUpdate();
    expect(prog.ownedCards['spread-cannon']).toBe(1);
    expect(sys.pendingSelections).toBe(1);
    // The rebuilt offer no longer RESERVES it — it is back to being a weighted candidate
    // like everything else (slot 0 is now whatever the draw produced first).
    expect(sys.currentOffer[0].id).not.toBe('spread-cannon');
  });

  it('the guarantee also folds Spread Cannon into playerStats on the pick', () => {
    // The whole point of guaranteeing the card: the run's default firing actually
    // evolves. One pick, and the SHARED store the FiringSystem reads carries the volley.
    const { sys, levelStub, playerStats } = build();
    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(playerStats.spreadWays).toBe(0);
    sys.queueSelection(0); // the reserved spread-cannon slot
    levelStub.levelsGainedThisTick = 0;
    sys.fixedUpdate();
    expect(playerStats.spreadWays).toBe(3); // Lv1: 3-way / 12°
    expect(playerStats.spreadArcDeg).toBe(12);
  });

  it('a BANISHED spread-cannon stays absent at level 3+ (banish permanence outranks it)', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds.add('spread-cannon');
    for (const level of [3, 5, 12]) {
      sys.currentOffer = [];
      sys.pendingSelections = 0;
      levelStub.level = level;
      levelStub.levelsGainedThisTick = 1;
      sys.fixedUpdate();
      expect(spreadIds(sys)).not.toContain('spread-cannon');
      levelStub.levelsGainedThisTick = 0;
      sys.queueSelection(0); // drain the owed pick so the next iteration starts clean
      sys.fixedUpdate();
    }
  });

  it('a MAXED spread-cannon is not re-offered at level 3+ (maxed exclusion outranks it)', () => {
    const { sys, levelStub, prog } = build();
    prog.ownedCards['spread-cannon'] = ITEM_MAX_LEVEL;
    levelStub.level = 9;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(spreadIds(sys)).not.toContain('spread-cannon');
  });

  it('a legacy level stub with no `level` field degrades to no guarantee (no throw)', () => {
    // `this.levelSystem.level` is `undefined`, which is not a finite number, so the
    // reservation is skipped. NOT "falls back to level 0" — the drawCardOffer default is
    // -Infinity precisely so an absent run level cannot satisfy a `guaranteeFromLevel: 0`
    // threshold; see the `runLevel defaults to no-guarantee, not to level 0` cases in
    // cardOffer.test.js.
    const levelStub = { levelsGainedThisTick: 1 }; // no `level` at all
    const sys = new LevelUpSystem(
      levelStub,
      { invulnMs: 0 },
      createProgressionState(),
      ITEM_REGISTRY,
      createPlayerStats(),
      seqRng(),
    );
    expect(() => sys.fixedUpdate()).not.toThrow();
    expectValidOffer(sys.currentOffer);
  });
});

describe('LevelUpSystem — a PAID reroll can displace the guaranteed card (Story 10.3)', () => {
  // A reroll works by clearing currentOffer so step (3) redraws. The redraw re-passes the
  // current run level, so without a suppression the reservation deterministically refills
  // slot 0 with the SAME guaranteed card: the player spends a charge, only 2 of 3 slots
  // actually reroll, and banish becomes the only way to see a guarantee-free offer. The
  // suppression is ONE-SHOT — the guarantee returns on the next rebuild while unowned.

  it('a reroll at run level >= 3 with spread-cannon unowned CAN yield an offer without it', () => {
    // A curated rng so the SUPPRESSED weighted redraw deterministically excludes
    // spread-cannon: once the guarantee is lifted, spread-cannon competes on weight only
    // and could re-appear by chance in the 6-item registry, so the seed is pinned (Story
    // 11.2 grew the offense track, which shifted the weighted draw off the old default).
    const { sys, levelStub, prog } = build({
      rng: seqRng([0.05, 0.05, 0.05, 0.29, 0.29]),
    });
    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    // The guarantee reserved slot 0, as it must.
    expect(sys.currentOffer[0].id).toBe('spread-cannon');
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES);

    sys.queueReroll();
    sys.fixedUpdate();
    // The charge was spent AND the paid redraw was actually free of the guarantee — the
    // suppression lifted the slot-0 reservation, and the curated seed kept spread-cannon out
    // of the weighted redraw too.
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES - 1);
    expect(sys.currentOffer).toHaveLength(CARD_OFFER_SIZE);
    expect(sys.currentOffer.map((c) => c.id)).not.toContain('spread-cannon');
  });

  it('the suppression is ONE-SHOT: the NEXT level-up offer has the guarantee back', () => {
    // Curated rng (see the sibling test) so the suppressed redraw deterministically excludes
    // spread-cannon over the 6-item registry.
    const { sys, levelStub, prog } = build({
      rng: seqRng([0.05, 0.05, 0.05, 0.29, 0.29]),
    });
    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.queueReroll();
    sys.fixedUpdate();
    expect(sys.currentOffer.map((c) => c.id)).not.toContain('spread-cannon');

    // Drain the owed pick (taking something that is NOT spread-cannon), then level again.
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(prog.ownedCards['spread-cannon']).toBeUndefined();
    expect(sys.pendingSelections).toBe(0);

    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL + 1;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    // "Always offered by Lv3" is unaffected — the exemption covered only the paid redraw.
    expect(sys.currentOffer[0].id).toBe('spread-cannon');
  });

  it('the suppression is ONE-SHOT: a post-pick rebuild in the SAME multi-level jump has it back', () => {
    // The other rebuild path. A 2-level jump owes two picks; a reroll on the first is
    // exempt, but the rebuild after the pick drains is guaranteed again. Curated rng (see
    // the sibling tests) so the suppressed redraw deterministically excludes spread-cannon
    // over the 6-item registry.
    const { sys, levelStub } = build({
      rng: seqRng([0.05, 0.05, 0.05, 0.29, 0.29]),
    });
    levelStub.level = 5;
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.queueReroll();
    sys.fixedUpdate();
    expect(sys.currentOffer.map((c) => c.id)).not.toContain('spread-cannon');

    sys.queueSelection(0); // drains one owed pick; step (3) rebuilds for the second
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer[0].id).toBe('spread-cannon');
  });

  it('an UNPAID reroll (0 charges) does not consume the suppression', () => {
    // The guarded no-op must not silently burn the one-shot exemption, or a player at 0
    // charges would lose the guarantee from their next offer for free.
    const { sys, levelStub, prog } = build();
    prog.rerollCharges = 0;
    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    expect(sys.currentOffer[0].id).toBe('spread-cannon');

    sys.queueReroll(); // no charge — a no-op
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(0);
    expect(sys.currentOffer[0].id).toBe('spread-cannon'); // offer untouched
    expect(sys._suppressGuaranteeOnce).toBe(false);
  });

  it('BANISH behavior is unchanged — a banished spread-cannon stays out permanently', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = SPREAD_CANNON_GUARANTEE_LEVEL;
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    const slot = sys.currentOffer.findIndex((c) => c.id === 'spread-cannon');
    expect(slot).toBe(0);
    sys.queueBanish(slot);
    sys.fixedUpdate();
    expect(prog.banishedIds.has('spread-cannon')).toBe(true);
    expect(sys.currentOffer.map((c) => c.id)).not.toContain('spread-cannon');
    // And it never returns, on any later rebuild.
    for (const level of [4, 8]) {
      sys.queueSelection(0);
      sys.fixedUpdate();
      levelStub.level = level;
      levelStub.levelsGainedThisTick = 1;
      sys.fixedUpdate();
      levelStub.levelsGainedThisTick = 0;
      expect(sys.currentOffer.map((c) => c.id)).not.toContain('spread-cannon');
    }
  });
});
