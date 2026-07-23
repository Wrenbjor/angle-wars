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

// A full offer is CARD_OFFER_SIZE distinct registry items (the 4-item registry yields 3).
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

  it('throws when `playerStats` (arg 5) is not an object — the stale rng-at-slot-5 call', () => {
    const rng = seqRng();
    expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, rng)).toThrow(TypeError);
    expect(() => new LevelUpSystem(...args(), ITEM_REGISTRY, rng)).toThrow(
      /`playerStats` \(arg 5\)/,
    );
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
  // A SHORT offer: pre-banish 2 of the 4 registry items, then cross a level. The offer
  // is exactly the 2 eligible cards; a pick against a 2-card offer applies normally.
  it('short offer (2 eligible): offer holds exactly 2 cards, and a pick applies', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set(['overcharge', 'nanite-shield']);
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
    prog.banishedIds = new Set(['overcharge', 'nanite-shield']);
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

  // An EMPTY offer: all 4 registry items banished → 0 eligible. The owed pick AUTO-DRAINS
  // with no card applied, the overlay closes, and the landing invuln is granted.
  it('empty offer (0 eligible): the owed pick auto-drains, no card applied, landing invuln granted', () => {
    const { sys, levelStub, prog, playerStub } = build({ invulnMs: 0 });
    prog.banishedIds = new Set(['overcharge', 'spread-cannon', 'nanite-shield', 'afterburner']);
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
    prog.banishedIds = new Set(['overcharge', 'spread-cannon', 'nanite-shield', 'afterburner']);
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(0); // drained
    expect(sys.selectionActive).toBe(false);
    expect(playerStub.invulnMs).toBe(bigShield); // preserved, not dropped to 800
  });

  it('empty offer drains ALL owed picks of a multi-level jump at once', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set(['overcharge', 'spread-cannon', 'nanite-shield', 'afterburner']);
    levelStub.levelsGainedThisTick = 3; // owes 3
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(0); // all drained, not just one
    expect(sys.selectionActive).toBe(false);
  });

  it('empty offer never holds the player invulnerable: no lingering pending across ticks', () => {
    const { sys, levelStub, prog } = build();
    prog.banishedIds = new Set(['overcharge', 'spread-cannon', 'nanite-shield', 'afterburner']);
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
