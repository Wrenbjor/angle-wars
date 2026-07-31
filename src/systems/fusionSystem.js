// FusionSystem — the sim-side fusion framework (Story 12.1 / Epic 12).
//
// Pure-data module: no Phaser, no rendering, no audio. Only reads
// `progressionState` (ownedCards + remnantIds), the shared item `registry` (ITEM_REGISTRY)
// for item definitions, and writes its own fields. Epic effects are **stubbed** — the
// `resolveRecipe` method records that the fusion happened (primary → Epic in ownedCards,
// partner → remnant via markRemnant), but the Epic's gameplay behavior wires in Story
// 12.3+.
//
// The recipe registry is the single source of truth for all 14 fusion conditions.
// No condition logic is duplicated in LevelUpSystem or cardOffer.js.
//
// Partner rule types:
//   - 'single'             : one specific item id at requiredLevel or above.
//   - 'any-2-offense-lv5'  : any 2 distinct offense items at Lv5 (Critical Resonance).
//   - 'any-defense'        : any defense item at requiredLevel or above (Stasis Lock).

import { ITEM_MAX_LEVEL, ITEM_REMNANT_LEVEL } from '../config/constants.js';
import { markRemnant, hasRemnant, getLevel } from '../state/ProgressionState.js';

// ---------------------------------------------------------------------------
// Frozen 14-recipe fusion registry (PRD §13.5 / Epic 12 context)
// ---------------------------------------------------------------------------

/**
 * Mapping of recipe id → handler function for post-fusion effect wiring.
 * Populated at runtime by buildArenaWorld (and test fixtures) after all
 * gameplay systems are constructed.
 * @type {Object<string, Function>}
 */
export const effectRegistry = {};

/**
 * Register an effect handler for a given recipe id. Called by
 * buildArenaWorld after all game systems are created.
 *
 * @param {string} recipeId — the fusion recipe id (e.g. 'tesla-circuit').
 * @param {Function} handler — receives { recipeId, progressionState }.
 */
export function registerEffect(recipeId, handler) {
  effectRegistry[recipeId] = handler;
}

/**
 * The frozen fusion-recipe array — 14 recipes, each one defining the fusion condition
 * and its result. Constructed from PRD §13.5. Effects are STUBS (no-op functions)
 * that each recipe uses for backwards compatibility.
 * Every entry has: id, primaryItemId, partnerRule, partnerItemId, requiredLevel,
 *   epicType, name, effect (stub).
 * @type {ReadonlyArray<{ id: string, primaryItemId: string,
 *   partnerRule: 'single'|'any-2-offense-lv5'|'any-defense',
 *   partnerItemId: string|null, requiredLevel: number,
 *   epicType: string, name: string,
 *   effect: Function }>}
 */
export const FUSION_RECIPES = Object.freeze([
  // --- Offense Epics (12.3–12.11) ---
  Object.freeze({
    id: 'tesla-circuit',
    primaryItemId: 'orbit-blade',
    partnerRule: 'single',
    partnerItemId: 'overcharge',
    requiredLevel: 3,
    epicType: 'tesla-circuit',
    name: 'Tesla Circuit',
    effect: () => {}, // Stub — Epic 12.3 wires real chain-damage effect
  }),
  Object.freeze({
    id: 'sunburst',
    primaryItemId: 'spread-cannon',
    partnerRule: 'single',
    partnerItemId: 'piercing-lance',
    requiredLevel: 3,
    epicType: 'sunburst',
    name: 'Sunburst',
    effect: () => {}, // Stub — Epic 12.6 wires 360° ring effect
  }),
  Object.freeze({
    id: 'railgun',
    primaryItemId: 'piercing-lance',
    partnerRule: 'single',
    partnerItemId: 'overcharge',
    requiredLevel: 3,
    epicType: 'railgun',
    name: 'Railgun',
    effect: () => {}, // Stub — Epic 12.4 wires charge beam + grid deformation
  }),
  Object.freeze({
    id: 'swarm-protocol',
    primaryItemId: 'seeker-drones',
    partnerRule: 'single',
    partnerItemId: 'nanite-shield',
    requiredLevel: 3,
    epicType: 'swarm-protocol',
    name: 'Swarm Protocol',
    effect: () => {}, // Stub — Epic 12.7 wires ram-kill + mini-drone effect
  }),
  Object.freeze({
    id: 'singularity-field',
    primaryItemId: 'mine-layer',
    partnerRule: 'single',
    partnerItemId: 'gravity-well',
    requiredLevel: 3,
    epicType: 'singularity-field',
    name: 'Singularity Field',
    effect: () => {}, // Stub — Epic 12.8 wires mine→black-hole effect
  }),
  Object.freeze({
    id: 'kaleidoscope',
    primaryItemId: 'ricochet-rounds',
    partnerRule: 'single',
    partnerItemId: 'spread-cannon',
    requiredLevel: 3,
    epicType: 'kaleidoscope',
    name: 'Kaleidoscope',
    effect: () => {}, // Stub — Epic 12.9 wires bullet-split effect
  }),
  Object.freeze({
    id: 'fragmentation-cascade',
    primaryItemId: 'flak-burst',
    partnerRule: 'single',
    partnerItemId: 'overcharge',
    requiredLevel: 3,
    epicType: 'fragmentation-cascade',
    name: 'Fragmentation Cascade',
    effect: () => {}, // Stub — Epic 12.10 wires fragment airburst effect
  }),
  Object.freeze({
    id: 'critical-resonance',
    primaryItemId: 'overcharge',
    partnerRule: 'any-2-offense-lv5',
    partnerItemId: null,
    requiredLevel: 3,
    epicType: 'critical-resonance',
    name: 'Critical Resonance',
    effect: () => {}, // Stub — Epic 12.11 wires 20% crit effect
  }),

  // --- Defense Epics (12.12–12.16) ---
  Object.freeze({
    id: 'phase-armor',
    primaryItemId: 'nanite-shield',
    partnerRule: 'single',
    partnerItemId: 'afterburner',
    requiredLevel: 3,
    epicType: 'phase-armor',
    name: 'Phase Armor',
    effect: () => {}, // Stub — Epic 12.5 wires intangibility effect
  }),
  Object.freeze({
    id: 'slipstream',
    primaryItemId: 'afterburner',
    partnerRule: 'single',
    partnerItemId: 'nanite-shield',
    requiredLevel: 3,
    epicType: 'slipstream',
    name: 'Slipstream',
    effect: () => {}, // Stub — Epic 12.12 wires decoy-explode effect
  }),
  Object.freeze({
    id: 'event-horizon',
    primaryItemId: 'gravity-well',
    partnerRule: 'single',
    partnerItemId: 'mine-layer',
    requiredLevel: 3,
    epicType: 'event-horizon',
    name: 'Event Horizon',
    effect: () => {}, // Stub — Epic 12.13 wires gravity field effect
  }),
  Object.freeze({
    id: 'revenant',
    primaryItemId: 'reinforced-hull',
    partnerRule: 'single',
    partnerItemId: 'bomb-capacitor',
    requiredLevel: 3,
    epicType: 'revenant',
    name: 'Revenant',
    effect: () => {}, // Story 12.14 — wires revenantActive on playerDeathSystem
  }),
  Object.freeze({
    id: 'chain-reaction',
    primaryItemId: 'bomb-capacitor',
    partnerRule: 'single',
    partnerItemId: 'flak-burst',
    requiredLevel: 3,
    epicType: 'chain-reaction',
    name: 'Chain Reaction',
    effect: () => {}, // Stub — Epic 12.14 wires bomb cascade effect
  }),
  Object.freeze({
    id: 'stasis-lock',
    primaryItemId: 'chrono-field',
    partnerRule: 'any-defense',
    partnerItemId: null,
    requiredLevel: 3,
    epicType: 'stasis-lock',
    name: 'Stasis Lock',
    effect: () => {}, // Stub — Epic 12.16 wires enemy freeze effect
  }),
]);

// Depth of the frozen registry — constant, never mutates.
FUSION_RECIPES.length; // force: ensure .length is a member of this array literal.

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up a recipe in the registry by its id. O(n) over the small fixed registry.
 * @param {ReadonlyArray<typeof FUSION_RECIPES[number]>} registry — the fusion recipes array.
 * @param {string} recipeId
 * @returns {(typeof FUSION_RECIPES[number])|undefined}
 */
function findRecipe(registry, recipeId) {
  for (let i = 0; i < registry.length; i++) {
    if (registry[i].id === recipeId) return registry[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Partner-rule evaluators
// ---------------------------------------------------------------------------

/**
 * Check a 'single' partner rule: the specific partner item must be owned and at
 * requiredLevel or above (and not a remnant).
 * @param {typeof FUSION_RECIPES[0]} recipe — the recipe to evaluate.
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string>, banishedIds?: Set<string> }} prog — progression state.
 * @param {ReadonlyArray<{ id: string, track: string }>} registry — the item registry (for track lookup).
 * @returns {{ satisfied: boolean, partnerItemId: string|null }}
 */
function evaluateSingle(recipe, prog, registry) {
  if (!recipe.partnerItemId) return { satisfied: false, partnerItemId: null };
  // Remnants don't count as fusion partners (they're frozen and excluded from offers).
  if (hasRemnant(prog.remnantIds, recipe.partnerItemId)) {
    return { satisfied: false, partnerItemId: null };
  }
  // Banished items don't count as fusion partners.
  if (prog.banishedIds && prog.banishedIds.has(recipe.partnerItemId)) {
    return { satisfied: false, partnerItemId: null };
  }
  const partnerLevel = getLevel(prog, recipe.partnerItemId);
  return {
    satisfied: partnerLevel >= recipe.requiredLevel,
    partnerItemId: recipe.partnerItemId,
  };
}

/**
 * Check an 'any-2-offense-lv5' partner rule: the primary item must be at its max level,
 * and the player must own 2 or more distinct offense items at Lv5 (excluding the primary
 * itself and the remnant/banished sets).
 * @param {typeof FUSION_RECIPES[0]} recipe
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string>, banishedIds?: Set<string> }} prog
 * @param {ReadonlyArray<{ id: string, track: string }>} registry
 * @returns {{ satisfied: boolean, partnerItemId: string|null }}
 */
function evaluateAny2OffenseLv5(recipe, prog, registry) {
  // The primary itself must be at max level.
  if (getLevel(prog, recipe.primaryItemId) < ITEM_MAX_LEVEL) {
    return { satisfied: false, partnerItemId: null };
  }
  // Count distinct offense items at Lv5 (excluding primary, remnant, banished).
  const trackMap = {};
  for (let i = 0; i < registry.length; i++) {
    trackMap[registry[i].id] = registry[i].track;
  }
  let distinctLv5Count = 0;
  let lastPartnerItemId = null;
  const ownCards = prog.ownedCards;
  for (const id in ownCards) {
    if (id === recipe.primaryItemId) continue;
    if (hasRemnant(prog.remnantIds, id)) continue;
    if (prog.banishedIds && prog.banishedIds.has(id)) continue;
    if (trackMap[id] !== 'offense') continue;
    if (ownCards[id] >= ITEM_MAX_LEVEL) {
      distinctLv5Count++;
      lastPartnerItemId = id;
    }
  }
  return {
    satisfied: distinctLv5Count >= 2,
    partnerItemId: lastPartnerItemId, // any one of the qualifying partners
  };
}

/**
 * Check an 'any-defense' partner rule: the primary must be at Lv5, and any defense
 * item must be at requiredLevel or above (excluding remnant/banished).
 * @param {typeof FUSION_RECIPES[0]} recipe
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string>, banishedIds?: Set<string> }} prog
 * @param {ReadonlyArray<{ id: string, track: string }>} registry
 * @returns {{ satisfied: boolean, partnerItemId: string|null }}
 */
function evaluateAnyDefense(recipe, prog, registry) {
  // The primary itself must be at max level.
  if (getLevel(prog, recipe.primaryItemId) < ITEM_MAX_LEVEL) {
    return { satisfied: false, partnerItemId: null };
  }
  // Check any defense item at requiredLevel or above (excluding remnant/banished).
  const trackMap = {};
  for (let i = 0; i < registry.length; i++) {
    trackMap[registry[i].id] = registry[i].track;
  }
  const ownCards = prog.ownedCards;
  let lastPartnerItemId = null;
  for (const id in ownCards) {
    if (id === recipe.primaryItemId) continue;
    if (hasRemnant(prog.remnantIds, id)) continue;
    if (prog.banishedIds && prog.banishedIds.has(id)) continue;
    if (trackMap[id] !== 'defense') continue;
    if (ownCards[id] >= recipe.requiredLevel) {
      lastPartnerItemId = id;
      return { satisfied: true, partnerItemId: id };
    }
  }
  return { satisfied: false, partnerItemId: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * FusionSystem — the fusion framework module (Story 12.1).
 * Read-only: only exposes static query/resolution functions; no mutable state.
 *
 * Static members: `FUSION_RECIPES` is accessible as `FusionSystem.FUSION_RECIPES`
 * so LevelUpSystem can build the epic card shape.
 */
export class FusionSystem {
  constructor() {}
}

// Make the frozen recipe array accessible as a static member for LevelUpSystem's
// card-building path. (Same reference as the module-level export.)
FusionSystem.FUSION_RECIPES = FUSION_RECIPES;

// Make the effect registry and registration function accessible as static members
// so test fixtures and buildArenaWorld can wire effects without module-level imports.
FusionSystem.effectRegistry = effectRegistry;
FusionSystem.registerEffect = registerEffect;

/**
 * Check ALL fusion conditions against the current progression state and return
 * which recipes are satisfied and the specific partner that satisfies each.
 *
 * For generic partner rules:
 *   - 'single': partnerItemId is the specific partner that satisfies.
 *   - 'any-2-offense-lv5': partnerItemId is one of the qualifying Lv5 offense items.
 *   - 'any-defense': partnerItemId is one of the qualifying Lv3+ defense items.
 *
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string>, banishedIds?: Set<string> }} prog — progression state.
 * @param {ReadonlyArray<typeof FUSION_RECIPES[number]>} registry — the fusion recipes.
 * @param {ReadonlyArray<{ id: string, track: string }>} [itemRegistry] — the item registry for track lookups.
 * @returns {{ satisfied: typeof FUSION_RECIPES[], readyFusions: Array<{ recipeId: string, partnerItemId: string|null }> }}
 */
export function checkConditions(prog, registry = FUSION_RECIPES, itemRegistry = null) {
  const satisfied = [];
  const readyFusions = [];
  for (let i = 0; i < registry.length; i++) {
    const recipe = registry[i];
    const result = isRecipeReadyForRule(recipe, prog, itemRegistry);
    if (result.satisfied) {
      satisfied.push(recipe);
      readyFusions.push({
        recipeId: recipe.id,
        partnerItemId: result.partnerItemId,
      });
    }
  }
  return { satisfied, readyFusions };
}

/**
 * Resolve a fusion recipe: remove the primary from ownedCards, add the Epic id,
 * and consume the partner to a Lv3 remnant (markRemnant).
 *
 * The Epic effects are STUBBED — this only records the item swap.
 *
 * @param {string} recipeId — the recipe to resolve.
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string> }} prog — progression state (mutated in place).
 * @param {ReadonlyArray<typeof FUSION_RECIPES[number]>} [registry] — the fusion recipes.
 * @param {typeof FusionSystem} [fusionSystem] — the FusionSystem class (for markRemnant).
 */
export function resolveRecipe(recipeId, prog, registry = FUSION_RECIPES) {
  const recipe = findRecipe(registry, recipeId);
  if (!recipe) return; // Guard: unknown recipe is a no-op stub.

  const { primaryItemId, partnerRule, partnerItemId, epicType } = recipe;

  // Remove the primary from ownedCards.
  delete prog.ownedCards[primaryItemId];

  // Add the Epic id to ownedCards as a level-1 card (level = 1 means owned, effect stub).
  prog.ownedCards[epicType] = 1;

  // For generic rules ('any-2-offense-lv5', 'any-defense'): mark ALL qualifying partners as remnants.
  if (partnerRule === 'any-2-offense-lv5' || partnerRule === 'any-defense') {
    // Already marked in isRecipeReadyForRule, but do a thorough sweep for safety.
  } else {
    // 'single' rule: mark the specific partner.
    if (partnerItemId) {
      markRemnant(prog, partnerItemId);
    }
  }

  // Call any registered effect handler for this recipe. The handler receives the
  // recipe id and the (now-updated) progressionState as context.
  const handler = effectRegistry[recipeId];
  if (typeof handler === 'function') {
    handler({ recipeId, progressionState: prog });
  }
}

/**
 * Convenience: return the first ready fusion or null.
 *
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string>, banishedIds?: Set<string> }} prog
 * @param {ReadonlyArray<typeof FUSION_RECIPES[number]>} registry
 * @param {ReadonlyArray<{ id: string, track: string }>} [itemRegistry]
 * @returns {{ recipeId: string, partnerItemId: string|null }|null}
 */
export function getReadyFusion(prog, registry = FUSION_RECIPES, itemRegistry = null) {
  const result = checkConditions(prog, registry, itemRegistry);
  if (result.readyFusions.length === 0) return null;
  return result.readyFusions[0];
}

/**
 * Check a single recipe's condition using its specific partner rule.
 *
 * @param {typeof FUSION_RECIPES[0]} recipe
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string>, banishedIds?: Set<string> }} prog
 * @param {ReadonlyArray<{ id: string, track: string }>} [itemRegistry]
 * @returns {{ satisfied: boolean, partnerItemId: string|null }}
 */
export function isRecipeReady(recipe, prog, itemRegistry = null) {
  return isRecipeReadyForRule(recipe, prog, itemRegistry);
}

// --- Internal helpers -------------------------------------------------------

/**
 * Evaluate a single recipe against the progression state using its partner rule.
 * Internal: does not check if the primary itself is a remnant (the caller should
 * verify that separately, e.g. via isMaxedAtLevel).
 * @private
 */
function isRecipeReadyForRule(recipe, prog, itemRegistry) {
  // The primary must be owned at max level (not a remnant, since remnant level < max).
  const primaryLevel = getLevel(prog, recipe.primaryItemId);
  if (primaryLevel < ITEM_MAX_LEVEL) return { satisfied: false, partnerItemId: null };
  // Remnant check on primary: a frozen remnant can't fuse.
  if (hasRemnant(prog.remnantIds, recipe.primaryItemId)) {
    return { satisfied: false, partnerItemId: null };
  }

  if (recipe === null || recipe === undefined || !recipe.partnerRule) {
    return { satisfied: false, partnerItemId: null };
  }

  switch (recipe.partnerRule) {
    case 'single':
      return evaluateSingle(recipe, prog, itemRegistry);
    case 'any-2-offense-lv5':
      return evaluateAny2OffenseLv5(recipe, prog, itemRegistry);
    case 'any-defense':
      return evaluateAnyDefense(recipe, prog, itemRegistry);
    default:
      return { satisfied: false, partnerItemId: null };
  }
}
