import { describe, it, expect } from 'vitest';
import { LevelUpSystem } from './LevelUpSystem.js';
import { createProgressionState } from '../state/ProgressionState.js';
import { PLACEHOLDER_CARDS } from '../config/cards.js';
import {
  FIXED_STEP_MS,
  LEVELUP_INVULN_FLOOR,
  LEVELUP_LANDING_INVULN_MS,
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
} from '../config/constants.js';

// Story 8.3/8.4 — the level-up state machine. LevelUpSystem edge-detects the level-up
// from levelSystem.levelsGainedThisTick, enqueues owed selections, holds invuln, and
// offers a weighted seeded trio (Story 8.4's drawCardOffer, routed through the injected
// `_rng`); a latched choice is drained + applied in the tick. Every case drives plain
// stubs ({levelsGainedThisTick} level stub, {invulnMs} player stub, a real
// createProgressionState()) + a deterministic stub rng, asserting the public fields.

// A stub rng replaying a fixed sequence (looping) — deterministic and injectable, so
// the weighted draw is repeatable across ticks.
function seqRng(values = [0.13, 0.47, 0.81, 0.29, 0.63]) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

function build({ invulnMs = 0, rng = seqRng() } = {}) {
  // Story 8.5: the level stub now also carries `level` (the real LevelSystem always
  // exposes it) so the reroll-charge grant edge-detect can compute prevLevel.
  const levelStub = { level: 1, levelsGainedThisTick: 0 };
  const playerStub = { invulnMs };
  const prog = createProgressionState();
  const sys = new LevelUpSystem(levelStub, playerStub, prog, rng);
  return { sys, levelStub, playerStub, prog, rng };
}

// The three offered cards must be exactly CARD_OFFER_SIZE (3), pairwise distinct, and
// every one a member of PLACEHOLDER_CARDS.
function expectValidOffer(offer) {
  expect(offer).toHaveLength(3);
  const ids = offer.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of offer) expect(PLACEHOLDER_CARDS).toContain(c);
}

describe('LevelUpSystem — level-up moment state machine', () => {
  it('idle: no level-up, nothing pending → inactive, empty offer, invuln untouched', () => {
    const { sys, playerStub } = build({ invulnMs: 0 });
    sys.fixedUpdate();
    expect(sys.selectionActive).toBe(false);
    expect(sys.pendingSelections).toBe(0);
    expect(sys.currentOffer).toEqual([]);
    expect(playerStub.invulnMs).toBe(0);
  });

  it('level-up fires (levelsGainedThisTick 1): pending 1, offer of 3 distinct pool cards, active, invuln armed', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expectValidOffer(sys.currentOffer);
    expect(sys.selectionActive).toBe(true);
    expect(playerStub.invulnMs).toBeGreaterThanOrEqual(LEVELUP_INVULN_FLOOR);
  });

  it('the weighted draw is deterministic under a fixed-sequence stub rng (same crossing twice → identical trio)', () => {
    const seq = [0.17, 0.53, 0.88, 0.31, 0.72];
    const a = build({ rng: seqRng(seq) });
    a.levelStub.levelsGainedThisTick = 1;
    a.sys.fixedUpdate();
    const b = build({ rng: seqRng(seq) });
    b.levelStub.levelsGainedThisTick = 1;
    b.sys.fixedUpdate();
    expect(a.sys.currentOffer.map((c) => c.id)).toEqual(
      b.sys.currentOffer.map((c) => c.id),
    );
  });

  it('multi-level jump (levelsGainedThisTick 3): owes three picks, offer of 3 distinct pool cards', () => {
    const { sys, levelStub } = build();
    levelStub.levelsGainedThisTick = 3;
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(3);
    expectValidOffer(sys.currentOffer);
  });

  it('multi-level jump: after a pick drains, the fresh post-pick offer reflects the updated ownership and is still three distinct', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate(); // pending 2, first offer built
    levelStub.levelsGainedThisTick = 0;
    const picked = sys.currentOffer[0];
    sys.queueSelection(0);
    sys.fixedUpdate(); // pick one → pending 1, fresh offer drawn against new ownership
    // Ownership now records the picked card.
    expect(prog.ownedCards[picked.id]).toBe(1);
    // The fresh offer is still exactly three distinct pool cards (drawn against the
    // just-updated ownership — the picked card now weighs as an owned card).
    expectValidOffer(sys.currentOffer);
    expect(sys.pendingSelections).toBe(1);
    expect(sys.selectionActive).toBe(true);
  });

  it('invuln held: re-armed ≥ FLOOR each pending tick, never drains to 0 (simulated per-tick drain)', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    // Simulate the ordering: LevelUpSystem tops invuln up, THEN PlayerDeathSystem drains
    // it by one tick's dt (it runs after). FLOOR > FIXED_STEP_MS, so it never hits 0.
    for (let i = 0; i < 50; i++) {
      sys.fixedUpdate();
      playerStub.invulnMs -= FIXED_STEP_MS;
      expect(playerStub.invulnMs).toBeGreaterThan(0);
    }
  });

  it('no re-enqueue: after the crossing tick, later ticks with levelsGainedThisTick 0 leave pending unchanged', () => {
    const { sys, levelStub } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    sys.fixedUpdate();
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).toHaveLength(3); // offer persists, not rebuilt every tick
  });

  it('select, none left: applies the picked card, closes, deactivates', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    const card = sys.currentOffer[1];
    sys.queueSelection(1);
    sys.fixedUpdate();
    expect(prog.debugStat).toBe(card.statDelta);
    expect(prog.ownedCards[card.id]).toBe(1);
    expect(sys.pendingSelections).toBe(0);
    expect(sys.currentOffer).toEqual([]);
    expect(sys.selectionActive).toBe(false);
  });

  it('final pick grants the longer LANDING invuln when the queue empties', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate(); // offer built, invuln armed to the per-tick floor
    expect(playerStub.invulnMs).toBe(LEVELUP_INVULN_FLOOR);
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate(); // last pick → queue empty
    expect(sys.pendingSelections).toBe(0);
    expect(playerStub.invulnMs).toBe(LEVELUP_LANDING_INVULN_MS);
  });

  it('landing grant never SHRINKS a larger invuln already in flight (e.g. a respawn shield)', () => {
    // A player who levels up while a bigger invuln window is counting down (a fresh
    // respawn grants PLAYER_INVULN_MS = 2000, far above the 800 landing grace) must not
    // have that window clobbered DOWN by the landing grant on the final pick — the
    // floor top-up in step (3) leaves it untouched (2000 > FLOOR) and the landing grant
    // takes the MAX, so the earned shield survives intact.
    const bigShield = LEVELUP_LANDING_INVULN_MS + 1200; // > landing, > floor
    const { sys, levelStub, playerStub } = build({ invulnMs: bigShield });
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate(); // offer built; floor top-up is a no-op (bigShield already > FLOOR)
    expect(playerStub.invulnMs).toBe(bigShield);
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate(); // final pick → queue empty, landing grant applied
    expect(sys.pendingSelections).toBe(0);
    expect(playerStub.invulnMs).toBe(bigShield); // preserved, not dropped to 800
  });

  it('a non-final pick keeps the per-tick floor re-arm, NOT the landing grace', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate(); // pending 2, invuln floor
    levelStub.levelsGainedThisTick = 0;
    sys.queueSelection(0);
    sys.fixedUpdate(); // pick one → pending 1 (more remain)
    expect(sys.pendingSelections).toBe(1);
    expect(playerStub.invulnMs).toBe(LEVELUP_INVULN_FLOOR);
    expect(playerStub.invulnMs).not.toBe(LEVELUP_LANDING_INVULN_MS);
  });

  it('select, more left: applies, drains one, rebuilds a fresh offer, stays active', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 2;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    const first = sys.currentOffer[0];
    sys.queueSelection(0);
    sys.fixedUpdate();
    expect(prog.debugStat).toBe(first.statDelta);
    expect(sys.pendingSelections).toBe(1);
    expect(sys.currentOffer).toHaveLength(3);
    expect(sys.selectionActive).toBe(true);
  });

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
    expect(sys.currentOffer).toHaveLength(3);
    expect(sys.selectionActive).toBe(true);
  });

  it('invalid index (5 or -1): guarded no-op — latch cleared, no apply, pending unchanged, no throw', () => {
    const { sys, levelStub, prog } = build();
    levelStub.levelsGainedThisTick = 1;
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;

    sys.queueSelection(5);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(sys.pendingSelections).toBe(1);
    expect(prog.debugStat).toBe(0);
    expect(sys._queuedChoice).toBe(null); // latch consumed even on the no-op

    sys.queueSelection(-1);
    sys.fixedUpdate();
    expect(sys.pendingSelections).toBe(1);
    expect(prog.debugStat).toBe(0);
    expect(sys.selectionActive).toBe(true); // still open, unchanged
  });

  it('select with none pending: guarded no-op — no apply, no throw', () => {
    const { sys, prog } = build();
    sys.queueSelection(0);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.debugStat).toBe(0);
    expect(prog.ownedCards).toEqual({});
    expect(sys.pendingSelections).toBe(0);
  });

  it('queueSelection latches only the first choice within a fixed-step window (bomb-latch idiom)', () => {
    const { sys } = build();
    sys.queueSelection(0);
    sys.queueSelection(2);
    expect(sys._queuedChoice).toBe(0);
  });
});

describe('LevelUpSystem — Story 8.5 reroll & banish', () => {
  // Drive a crossing so a 3-card selection is active, then clear the crossing flag so
  // later ticks do not re-enqueue. Returns the built world for the caller to act on.
  // The stub is a REALIZABLE state: gaining 1 level to reach level 2 (prevLevel 1), well
  // below the first reroll-grant threshold (10), so opening a selection never itself
  // grants a reroll charge — the reroll/banish cases start from REROLL_INITIAL_CHARGES.
  function openSelection(opts) {
    const world = build(opts);
    world.levelStub.level = 2;
    world.levelStub.levelsGainedThisTick = 1;
    world.sys.fixedUpdate();
    world.levelStub.levelsGainedThisTick = 0;
    return world;
  }

  it('reroll with a charge: spends one, redraws a fresh 3-distinct offer (new array), pending unchanged, still active', () => {
    const { sys, prog } = openSelection();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    const oldOffer = sys.currentOffer;
    sys.queueReroll();
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES - 1);
    expect(sys.currentOffer).not.toBe(oldOffer); // a fresh array (step-3 redraw)
    expectValidOffer(sys.currentOffer);
    expect(sys.pendingSelections).toBe(1);
    expect(sys.selectionActive).toBe(true);
  });

  it('reroll deterministic: same rng sequence + same state, reroll twice → identical redrawn trio (ids + order)', () => {
    const seq = [0.19, 0.61, 0.08, 0.44, 0.77, 0.23, 0.9, 0.35];
    const a = openSelection({ rng: seqRng(seq) });
    a.sys.queueReroll();
    a.sys.fixedUpdate();
    const b = openSelection({ rng: seqRng(seq) });
    b.sys.queueReroll();
    b.sys.fixedUpdate();
    expect(a.sys.currentOffer.map((c) => c.id)).toEqual(
      b.sys.currentOffer.map((c) => c.id),
    );
  });

  it('reroll depleted: guarded no-op — offer unchanged (same array), charge stays 0', () => {
    const { sys, prog } = openSelection();
    prog.rerollCharges = 0;
    const oldOffer = sys.currentOffer;
    sys.queueReroll();
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(0);
    expect(sys.currentOffer).toBe(oldOffer); // untouched: no redraw
  });

  it('reroll level grant: crossing INTO level 10 grants +1 reroll on that tick', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 10;
    levelStub.levelsGainedThisTick = 1; // prevLevel 9 → crosses 10
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES + 1);
  });

  it('reroll multi-grant: a single jump 9→16 crosses 10 AND 15 → +2 rerolls', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 16;
    levelStub.levelsGainedThisTick = 7; // prevLevel 9 → crosses 10 and 15 (not 20)
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES + 2);
  });

  it('reroll no re-grant: a non-crossing tick (levelsGainedThisTick 0) at level 20 grants nothing', () => {
    const { sys, levelStub, prog } = build();
    levelStub.level = 20;
    levelStub.levelsGainedThisTick = 0;
    const before = prog.rerollCharges;
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(before);
  });

  it('reroll grant lower bound: a crossing tick whose prevLevel is ALREADY past a threshold grants nothing', () => {
    // Exercises the `prevLevel < T` lower bound of the grant guard (not just `T <= level`).
    // level 12 with levelsGainedThisTick 1 → prevLevel 11, already past 10 (and below 15),
    // so NO threshold is crossed INTO this tick and no reroll is granted. A weakened guard
    // of just `T <= level` (an unbounded economy) would wrongly re-grant the 10 threshold.
    const { sys, levelStub, prog } = build();
    levelStub.level = 12;
    levelStub.levelsGainedThisTick = 1; // prevLevel 11 (already > 10, < 15)
    const before = prog.rerollCharges;
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(before);
  });

  it('banish with a charge: adds the focused id to banishedIds, spends one charge, fresh offer excludes it', () => {
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
    expect(sys.selectionActive).toBe(true);
  });

  it('banish never returns: after banishing id X, many subsequent redraws never offer X again this run', () => {
    const { sys, prog } = openSelection();
    const bannedId = sys.currentOffer[0].id;
    sys.queueBanish(0);
    sys.fixedUpdate();
    // Give plenty of reroll charges and drive many real redraws through drawCardOffer.
    prog.rerollCharges = 50;
    for (let t = 0; t < 40; t++) {
      sys.queueReroll();
      sys.fixedUpdate();
      expect(sys.currentOffer.some((c) => c.id === bannedId)).toBe(false);
    }
  });

  it('multi-pick reroll: with pending 2, a reroll leaves both picks owed + player invuln, redraws a fresh trio; a later pick drains to 1', () => {
    const { sys, levelStub, playerStub } = build({ invulnMs: 0 });
    levelStub.level = 3;
    levelStub.levelsGainedThisTick = 2; // prevLevel 1 → pending 2, no reroll grant
    sys.fixedUpdate();
    levelStub.levelsGainedThisTick = 0;
    expect(sys.pendingSelections).toBe(2);
    const oldOffer = sys.currentOffer;
    sys.queueReroll();
    sys.fixedUpdate();
    // Both picks are STILL owed and the player is STILL invulnerable (only the trio changed).
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

  it('multi-pick banish: with pending 2, a banish leaves both picks owed + player invuln, redraws a fresh trio excluding the id; a later pick drains to 1', () => {
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
    expect(sys.currentOffer).toBe(oldOffer); // untouched: no banish, no redraw
  });

  it('banish invalid index (5 / -1): guarded no-op — latch cleared, nothing banished, charge unchanged, no throw', () => {
    const { sys, prog } = openSelection();
    const oldOffer = sys.currentOffer;
    sys.queueBanish(5);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.banishedIds.size).toBe(0);
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(sys._queuedBanish).toBe(null); // latch consumed even on the no-op
    expect(sys.currentOffer).toBe(oldOffer); // untouched

    sys.queueBanish(-1);
    sys.fixedUpdate();
    expect(prog.banishedIds.size).toBe(0);
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
  });

  it('reroll/banish with none pending: guarded no-op — no charge spent, no throw', () => {
    const { sys, prog } = build(); // nothing pending
    sys.queueReroll();
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    sys.queueBanish(0);
    expect(() => sys.fixedUpdate()).not.toThrow();
    expect(prog.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(prog.banishedIds.size).toBe(0);
    expect(sys.selectionActive).toBe(false);
  });

  it('latch idempotency: two queueReroll() before a tick spend only one charge (one-slot latch)', () => {
    const { sys, prog } = openSelection();
    prog.rerollCharges = 2;
    sys.queueReroll();
    sys.queueReroll();
    sys.fixedUpdate();
    expect(prog.rerollCharges).toBe(1); // only one reroll honored
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
    // Pick (empties currentOffer in step 1) AND request reroll+banish the same tick.
    sys.queueSelection(0);
    sys.queueReroll();
    sys.queueBanish(1);
    sys.fixedUpdate();
    // The pick drained the only owed selection → closed; reroll/banish saw an empty
    // offer and no-op'd, so neither charge was spent.
    expect(prog.rerollCharges).toBe(rerollBefore);
    expect(prog.banishCharges).toBe(banishBefore);
    expect(prog.banishedIds.size).toBe(0);
  });
});
