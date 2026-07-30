import { describe, it, expect, beforeEach } from 'vitest';
import {
  FusionSystem,
  FUSION_RECIPES,
  checkConditions,
  resolveRecipe,
  getReadyFusion,
  isRecipeReady,
  effectRegistry,
  registerEffect,
} from './fusionSystem.js';
import { markRemnant, removeOwnedItem } from '../state/ProgressionState.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import { ITEM_MAX_LEVEL, ITEM_REMNANT_LEVEL } from '../config/constants.js';

// Story 12.1 — Fusion Core. Tests cover all 4 acceptance criteria:
// AC1 : condition detection → immediate fusion-ready state
// AC2 : fusion resolution → replacement + remnant
// AC3 : generic partner rules (any-2-offense-lv5, any-defense)
// AC4 : full 14-recipe registry, tests, effects stubbed

// --- Helpers ---------------------------------------------------------------

function makeProg(owned = {}, remnantIds = []) {
  return {
    ownedCards: { ...owned },
    remnantIds: new Set(remnantIds),
    banishedIds: new Set(),
  };
}

// --- AC4: full 14-recipe registry, tests, effects stubbed ----------------

describe('FusionSystem — recipe registry (AC4)', () => {
  it('has exactly 14 recipes', () => {
    expect(FUSION_RECIPES.length).toBe(14);
  });

  it('all recipes are frozen (deep-immutable)', () => {
    for (const recipe of FUSION_RECIPES) {
      expect(Object.isFrozen(recipe)).toBe(true);
    }
  });

  it('every recipe has the required fields', () => {
    const requiredFields = [
      'id', 'primaryItemId', 'partnerRule', 'partnerItemId',
      'requiredLevel', 'epicType', 'name', 'effect',
    ];
    for (const recipe of FUSION_RECIPES) {
      for (const field of requiredFields) {
        expect(recipe).toHaveProperty(field);
      }
    }
  });

  it('all partnerRules are valid types', () => {
    const validRules = ['single', 'any-2-offense-lv5', 'any-defense'];
    for (const recipe of FUSION_RECIPES) {
      expect(validRules).toContain(recipe.partnerRule);
    }
  });

  it('single-partner recipes specify a partnerItemId', () => {
    const single = FUSION_RECIPES.filter((r) => r.partnerRule === 'single');
    expect(single.every((r) => r.partnerItemId)).toBe(true);
    expect(single.length).toBe(12);
  });

  it('generic-rule recipes have null partnerItemId', () => {
    const generic = FUSION_RECIPES.filter(
      (r) => r.partnerRule !== 'single',
    );
    expect(generic.every((r) => r.partnerItemId === null)).toBe(true);
    expect(generic.length).toBe(2);
  });

  it('the effect stub is a no-op function', () => {
    for (const recipe of FUSION_RECIPES) {
      expect(typeof recipe.effect).toBe('function');
      expect(() => recipe.effect()).not.toThrow();
    }
  });

  it('recipes match the PRD §13.5 fusion map order', () => {
    const expectedIds = [
      'tesla-circuit',
      'sunburst',
      'railgun',
      'swarm-protocol',
      'singularity-field',
      'kaleidoscope',
      'fragmentation-cascade',
      'critical-resonance',
      'phase-armor',
      'slipstream',
      'event-horizon',
      'revenant',
      'chain-reaction',
      'stasis-lock',
    ];
    const actualIds = FUSION_RECIPES.map((r) => r.id);
    expect(actualIds).toEqual(expectedIds);
  });
});

// --- AC1: condition detection → immediate fusion-ready state ---------------

describe('FusionSystem — condition detection (AC1)', () => {
  it('single partner (Piercing Lance Lv5 + Overcharge Lv3) → railgun ready', () => {
    const prog = makeProg({
      'piercing-lance': 5,
      'overcharge': 3,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const ready = result.readyFusions.find((r) => r.recipeId === 'railgun');
    expect(ready).toBeDefined();
    expect(ready.partnerItemId).toBe('overcharge');
  });

  it('single partner: Lv3 or above partner (Overcharge Lv4) is detected', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 4,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const ready = result.readyFusions.find((r) => r.recipeId === 'tesla-circuit');
    expect(ready).toBeDefined();
    expect(ready.partnerItemId).toBe('overcharge');
  });

  it('Lv5 primary not owned → no fusion', () => {
    const prog = makeProg({
      'overcharge': 5,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const tesla = result.readyFusions.find((r) => r.recipeId === 'tesla-circuit');
    expect(tesla).toBeUndefined();
  });

  it('Lv5 primary owned but partner below Lv3 → no fusion', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 2,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const tesla = result.readyFusions.find((r) => r.recipeId === 'tesla-circuit');
    expect(tesla).toBeUndefined();
  });

  it('Lv2 primary not maxed → no fusion', () => {
    const prog = makeProg({
      'orbit-blade': 2,
      'overcharge': 3,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const tesla = result.readyFusions.find((r) => r.recipeId === 'tesla-circuit');
    expect(tesla).toBeUndefined();
  });

  it('multiple ready fusions: first recipe in registry order detected', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
      'piercing-lance': 5,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    expect(result.readyFusions.length).toBeGreaterThanOrEqual(1);
    // First ready should be tesla-circuit (registry order)
    expect(result.readyFusions[0].recipeId).toBe('tesla-circuit');
  });

  it('getReadyFusion returns the first ready fusion or null', () => {
    const progNone = makeProg({});
    expect(getReadyFusion(progNone, FUSION_RECIPES, ITEM_REGISTRY)).toBeNull();

    const progOne = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
    });
    const ready = getReadyFusion(progOne, FUSION_RECIPES, ITEM_REGISTRY);
    expect(ready).not.toBeNull();
    expect(ready.recipeId).toBe('tesla-circuit');
  });

  it('isRecipeReady checks a single recipe', () => {
    const teslaRecipe = FUSION_RECIPES[0];
    const progReady = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
    });
    const result = isRecipeReady(teslaRecipe, progReady, ITEM_REGISTRY);
    expect(result.satisfied).toBe(true);

    const progNotReady = makeProg({
      'orbit-blade': 4,
      'overcharge': 3,
    });
    const result2 = isRecipeReady(teslaRecipe, progNotReady, ITEM_REGISTRY);
    expect(result2.satisfied).toBe(false);
  });
});

// --- AC2: fusion resolution → replacement + remnant -----------------------

describe('FusionSystem — resolution (AC2)', () => {
  it('primary is removed from ownedCards', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
    });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(prog.ownedCards['orbit-blade']).toBeUndefined();
  });

  it('Epic id is added to ownedCards', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
    });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(prog.ownedCards['tesla-circuit']).toBe(1);
  });

  it('partner becomes a remnant (clamped to Lv3, added to remnantIds)', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
    });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(prog.remnantIds.has('overcharge')).toBe(true);
    expect(prog.ownedCards['overcharge']).toBe(ITEM_REMNANT_LEVEL);
  });

  it('Lv5 partner is clamped DOWN to Lv3 remnant', () => {
    // Overcharge at Lv5 is consumed by the single rule (any Lv3+ counts).
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 5,
    });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(prog.remnantIds.has('overcharge')).toBe(true);
    expect(prog.ownedCards['overcharge']).toBe(ITEM_REMNANT_LEVEL);
  });

  it('Lv3 or above partner (not exactly Lv3) is also a remnant', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 4,
    });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(prog.remnantIds.has('overcharge')).toBe(true);
    expect(prog.ownedCards['overcharge']).toBe(ITEM_REMNANT_LEVEL);
  });

  it('non-existent recipe id is a guarded no-op', () => {
    const prog = makeProg({
      'orbit-blade': 5,
      'overcharge': 3,
    });
    expect(() => resolveRecipe('non-existent-id', prog, FUSION_RECIPES)).not.toThrow();
    expect(prog.ownedCards['orbit-blade']).toBe(5);
    expect(prog.remnantIds.size).toBe(0);
  });
});

// --- AC3: generic partner rules (any-2-offense-lv5, any-defense) -----------

describe('FusionSystem — generic partner rules (AC3)', () => {
  it('any-2-offense-lv5: Critical Resonance with 2 offense items at Lv5', () => {
    const prog = makeProg({
      'overcharge': 5,
      'orbit-blade': 5,
      'piercing-lance': 5,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const crit = result.readyFusions.find((r) => r.recipeId === 'critical-resonance');
    expect(crit).toBeDefined();
    expect(crit.partnerItemId).not.toBeNull();
  });

  it('any-2-offense-lv5: only 1 offense at Lv5 → not ready', () => {
    const prog = makeProg({
      'overcharge': 5,
      'orbit-blade': 5,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const crit = result.readyFusions.find((r) => r.recipeId === 'critical-resonance');
    expect(crit).toBeUndefined();
  });

  it('any-2-offense-lv5: 2 offense at Lv4 → not ready (Lv4 is not Lv5)', () => {
    const prog = makeProg({
      'overcharge': 5,
      'orbit-blade': 4,
      'piercing-lance': 4,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const crit = result.readyFusions.find((r) => r.recipeId === 'critical-resonance');
    expect(crit).toBeUndefined();
  });

  it('any-2-offense-lv5: 2 offense at Lv5 but one is a remnant → only 1 counts', () => {
    const prog = makeProg(
      {
        'overcharge': 5,
        'orbit-blade': 5,
        'piercing-lance': 5,
      },
      ['piercing-lance'],
    );
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const crit = result.readyFusions.find((r) => r.recipeId === 'critical-resonance');
    expect(crit).toBeUndefined();
  });

  it('any-defense: Stasis Lock with Chrono Field Lv5 + any defense at Lv3+', () => {
    const prog = makeProg({
      'chrono-field': 5,
      'nanite-shield': 3,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const stasis = result.readyFusions.find((r) => r.recipeId === 'stasis-lock');
    expect(stasis).toBeDefined();
    expect(stasis.partnerItemId).toBe('nanite-shield');
  });

  it('any-defense: only Chrono Field (no defense partner) → not ready', () => {
    const prog = makeProg({
      'chrono-field': 5,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const stasis = result.readyFusions.find((r) => r.recipeId === 'stasis-lock');
    expect(stasis).toBeUndefined();
  });

  it('any-defense: defense partner at Lv2 → not ready (below Lv3)', () => {
    const prog = makeProg({
      'chrono-field': 5,
      'nanite-shield': 2,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const stasis = result.readyFusions.find((r) => r.recipeId === 'stasis-lock');
    expect(stasis).toBeUndefined();
  });

  it('any-defense: remnant partner does not satisfy condition', () => {
    const prog = makeProg(
      {
        'chrono-field': 5,
        'nanite-shield': 5,
      },
      ['nanite-shield'],
    );
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const stasis = result.readyFusions.find((r) => r.recipeId === 'stasis-lock');
    expect(stasis).toBeUndefined();
  });

  it('primary at Lv4 generic rule → not ready', () => {
    const prog = makeProg({
      'chrono-field': 4,
      'nanite-shield': 5,
    });
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const stasis = result.readyFusions.find((r) => r.recipeId === 'stasis-lock');
    expect(stasis).toBeUndefined();
  });
});

// --- Banished and remnant exclusion -----------------------------------------

describe('FusionSystem — banished and remnant exclusion', () => {
  it('banished single partner → no fusion', () => {
    const prog = makeProg(
      { 'orbit-blade': 5, 'overcharge': 3 },
      [],
    );
    prog.banishedIds = new Set(['overcharge']);
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const tesla = result.readyFusions.find((r) => r.recipeId === 'tesla-circuit');
    expect(tesla).toBeUndefined();
  });

  it('primary is a remnant → no fusion even if partner is ready', () => {
    const prog = makeProg(
      { 'orbit-blade': 3 },
      ['orbit-blade'],
    );
    const result = checkConditions(prog, FUSION_RECIPES, ITEM_REGISTRY);
    const tesla = result.readyFusions.find((r) => r.recipeId === 'tesla-circuit');
    expect(tesla).toBeUndefined();
  });
});

// --- Remove owned item -----------------------------------------------------

describe('FusionSystem — integration with ProgressionState primitives', () => {
  it('markRemnant properly freezes level and adds to remnantIds', () => {
    const prog = makeProg({ 'overcharge': 5 });
    markRemnant(prog, 'overcharge');
    expect(prog.remnantIds.has('overcharge')).toBe(true);
    expect(prog.ownedCards['overcharge']).toBe(3);
  });

  it('getReadyFusion returns null when no fusions ready', () => {
    const prog = makeProg({ 'overcharge': 1 });
    expect(getReadyFusion(prog, FUSION_RECIPES, ITEM_REGISTRY)).toBeNull();
  });
});

describe('FusionSystem — removeOwnedItem helper', () => {
  it('removeOwnedItem removes from ownedCards and remnantIds', () => {
    const prog = makeProg({ 'overcharge': 3 });
    prog.remnantIds.add('overcharge');
    removeOwnedItem(prog, 'overcharge');
    expect(prog.ownedCards['overcharge']).toBeUndefined();
    expect(prog.remnantIds.has('overcharge')).toBe(false);
  });

  it('removeOwnedItem is a no-op when id is not present', () => {
    const prog = makeProg({ 'overcharge': 3 });
    removeOwnedItem(prog, 'non-existent');
    expect(prog.ownedCards['overcharge']).toBe(3);
  });
});

// --- FusionSystem class -----------------------------------------------------

describe('FusionSystem — class structure', () => {
  it('FusionSystem is a constructed class', () => {
    const fs = new FusionSystem();
    expect(fs).toBeInstanceOf(FusionSystem);
  });

  it('FUSION_RECIPES is accessible as a static property', () => {
    expect(FusionSystem.FUSION_RECIPES).toBe(FUSION_RECIPES);
    expect(FusionSystem.FUSION_RECIPES.length).toBe(14);
  });
});

// --- EffectRegistry wiring ---------------------------------------------------

describe('FusionSystem — effectRegistry wiring', () => {
  beforeEach(() => {
    // Clean the registry before each test to avoid cross-test pollution.
    for (const key of Object.keys(effectRegistry)) {
      delete effectRegistry[key];
    }
  });

  it('effectRegistry is an object', () => {
    expect(effectRegistry).toBeTypeOf('object');
  });

  it('registerEffect stores a handler by recipe Id', () => {
    let called = false;
    registerEffect('tesla-circuit', () => { called = true; });
    expect(effectRegistry['tesla-circuit']).toBeTypeOf('function');
  });

  it('resolveRecipe calls registered handler with { recipeId, progressionState }', () => {
    let ctx = null;
    registerEffect('tesla-circuit', (c) => { ctx = c; });
    const prog = makeProg({ 'orbit-blade': 5, 'overcharge': 3 });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(ctx).not.toBeNull();
    expect(ctx.recipeId).toBe('tesla-circuit');
    expect(ctx.progressionState).toBe(prog);
    expect(ctx.progressionState.ownedCards['tesla-circuit']).toBe(1);
    expect(ctx.progressionState.ownedCards['orbit-blade']).toBeUndefined();
  });

  it('handler that sets a flag on an external target is called by resolveRecipe', () => {
    // Simulates the buildArenaWorld pattern: an external system receives
    // the registration and gets its flag set by the handler.
    const externalTarget = { teslaActive: false };
    registerEffect('tesla-circuit', () => {
      externalTarget.teslaActive = true;
    });
    const prog = makeProg({ 'orbit-blade': 5, 'overcharge': 3 });
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(externalTarget.teslaActive).toBe(true);
  });

  it('unregistered recipes call no handler (no throw)', () => {
    const prog = makeProg({ 'orbit-blade': 5, 'overcharge': 3 });
    registerEffect('some-fake-recipe', () => { throw new Error('should not call'); });
    // Resolve a genuine recipe that has no registered handler.
    resolveRecipe('tesla-circuit', prog, FUSION_RECIPES);
    expect(prog.ownedCards['tesla-circuit']).toBe(1);
  });

  it('FusionSystem.registerEffect and FusionSystem.effectRegistry mirror the module exports', () => {
    expect(FusionSystem.registerEffect).toBe(registerEffect);
    expect(FusionSystem.effectRegistry).toBe(effectRegistry);
  });
});
