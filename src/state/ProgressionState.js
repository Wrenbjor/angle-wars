// ProgressionState — the run-scoped card-progression state (plain data, Phaser-free).
//
// Mirrors ScoreState's shape/discipline: a plain-data object mutated as the player
// drafts cards during level-up moments, read by the scene for the DEV readout. Kept
// separate from ScoreState (run economy) and PlayerState (ship lifecycle) because
// card ownership is its own concern. Built fresh per run in buildArenaWorld beside
// scoreState/playerState, NEVER touched by the death path — so it resets on a fresh
// run and survives a non-final death, exactly like scoreState.xp.
//
// Shape: { ownedCards, debugStat, rerollCharges, banishCharges, banishedIds, remnantIds }
//  - ownedCards    : a map of item id → COUNT = the item's LEVEL (Story 10.1), capped
//                    at the item definition's maxLevel. Each draft of an item increments
//                    its level; the PlayerStats fold reads the current level's effects.
//  - debugStat     : a legacy running PICK counter (each applied card adds 1), kept only
//                    for the DEV readout. Real item effects now flow through the
//                    PlayerStats fold (state/PlayerStats.js), not here — statDelta retired.
//  - rerollCharges : Story 8.5 reroll economy — the number of trio redraws the run has
//                    banked (starts REROLL_INITIAL_CHARGES; LevelUpSystem grants +1 on
//                    crossing into each REROLL_LEVEL_GRANTS level, spends one per reroll).
//  - banishCharges : Story 8.5 banish economy — the number of permanent card drops the
//                    run has left (starts BANISH_INITIAL_CHARGES, one spent per banish).
//  - banishedIds   : Story 8.5 — the Set of card ids banished this run. Threaded into
//                    the weighted draw so a banished id is never offered again (its
//                    weight zeroes via the 8.4 banishMultiplier). A Set for O(1)
//                    membership + natural dedup.
//  - remnantIds    : Story 10.1 — the Set of item ids frozen as fusion remnants (Lv3,
//                    no longer upgradable). Threaded into the weighted draw so a remnant
//                    is never offered again; Epic 12 drives the actual fusion consumption.
// Like ownedCards, all are run-scoped: created fresh per run and never touched by the
// death path (survive a non-final death, reset on a fresh run).

import {
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
  ITEM_REMNANT_LEVEL,
} from '../config/constants.js';

// Story 10.1 note: an item's LEVEL is its owned count (ownedCards[id]), capped at the
// item definition's maxLevel. `remnantIds` (new this story) is the set of items frozen
// at ITEM_REMNANT_LEVEL because a fusion consumed them — they keep their Lv3 stats and
// stop upgrading. Epic 12 owns the actual fusion consumption; this story only tracks +
// exposes the remnant state to the offer weighting (a remnant is never re-offered) and
// the forward-looking fusion checks.

/**
 * Create the run-scoped card-progression state at the start of a run: no cards
 * owned, debug stat zero, the reroll/banish charge economies at their starting
 * values, an empty banished set, and an empty remnant set. Rebuilt fresh per run
 * (never reset on death — mirrors scoreState.xp).
 * @returns {{ ownedCards: Object<string, number>, debugStat: number,
 *   rerollCharges: number, banishCharges: number, banishedIds: Set<string>,
 *   remnantIds: Set<string> }}
 */
export function createProgressionState() {
  return {
    ownedCards: {},
    debugStat: 0,
    rerollCharges: REROLL_INITIAL_CHARGES,
    banishCharges: BANISH_INITIAL_CHARGES,
    banishedIds: new Set(),
    remnantIds: new Set(),
  };
}

/**
 * Apply a drafted card to the progression state (pure mutation): bump the owned COUNT
 * (= the item's level) for its id, capped at the item's maxLevel, and increment the
 * legacy `debugStat` pick counter (kept for the DEV readout — it now counts picks, not
 * a stat delta; real effects flow through the PlayerStats fold, not here). A pick on an
 * item already at its cap, or on a fusion-frozen remnant, is a guarded no-op on the
 * owned count (level never rises past the cap / above a remnant's frozen Lv3).
 * @param {{ ownedCards: Object<string, number>, debugStat: number,
 *   remnantIds?: Set<string> }} state
 * @param {{ id: string, maxLevel?: number }} card
 */
export function applyCard(state, card) {
  state.debugStat += 1;
  const id = card.id;
  // A remnant is frozen at ITEM_REMNANT_LEVEL and no longer upgradable.
  if (hasRemnant(state.remnantIds, id)) return;
  const level = state.ownedCards[id] ?? 0;
  if (!isMaxedAtLevel(level, card)) state.ownedCards[id] = level + 1;
}

// --- Shared predicate primitives -------------------------------------------------
// The maxed/remnant questions are asked from two surfaces with two different argument
// shapes: the query surface below takes a progression `state`, while cardOffer.cardWeight
// works from the loose `{ ownedCards, remnantIds }` it was handed. Both route through
// THESE primitives so the semantics cannot drift apart (the offer must never treat an
// item as offerable that `isMaxed`/`isRemnant` report as excluded, or vice versa).

/**
 * True when an item already AT `level` is at (or above) the cap its definition declares.
 * A card without a `maxLevel` (e.g. a legacy synthetic fixture) is never maxed.
 * @param {number} level The item's current level (owned count).
 * @param {{ maxLevel?: number }} card
 * @returns {boolean}
 */
export function isMaxedAtLevel(level, card) {
  const cap = card.maxLevel ?? Infinity;
  return level >= cap;
}

/**
 * Tolerant membership test for a remnant/banish-style id set. Accepts a Set, an array,
 * or null/undefined (empty); anything else is treated as empty. Tolerant rather than
 * `.has`-only so a hydrated-from-JSON array cannot throw on one surface while working
 * on the other.
 * @param {Set<string>|string[]|null|undefined} idSet
 * @param {string} id
 * @returns {boolean}
 */
export function hasRemnant(idSet, id) {
  if (!idSet) return false;
  if (typeof idSet.has === 'function') return idSet.has(id);
  if (Array.isArray(idSet)) return idSet.includes(id);
  return false;
}

/**
 * The current level (owned count) of an item — 0 when unowned.
 * @param {{ ownedCards: Object<string, number> }} state
 * @param {string} id
 * @returns {number}
 */
export function getLevel(state, id) {
  return state.ownedCards[id] ?? 0;
}

/**
 * True when the item is owned (level >= 1).
 * @param {{ ownedCards: Object<string, number> }} state
 * @param {string} id
 * @returns {boolean}
 */
export function isOwned(state, id) {
  return getLevel(state, id) >= 1;
}

/**
 * True when the item is at (or above) its level cap — a maxed item is never re-offered.
 * @param {{ ownedCards: Object<string, number> }} state
 * @param {{ id: string, maxLevel?: number }} card
 * @returns {boolean}
 */
export function isMaxed(state, card) {
  return isMaxedAtLevel(getLevel(state, card.id), card);
}

/**
 * True when the item is a fusion-consumed remnant (frozen at ITEM_REMNANT_LEVEL).
 * @param {{ remnantIds?: Set<string> }} state
 * @param {string} id
 * @returns {boolean}
 */
export function isRemnant(state, id) {
  return hasRemnant(state.remnantIds, id);
}

/**
 * Mark an item a fusion remnant: FREEZE its level at ITEM_REMNANT_LEVEL and add it to
 * remnantIds so it is never re-offered and no longer upgradable. FREEZE-ONLY: the level
 * is clamped DOWN to ITEM_REMNANT_LEVEL when it is above it (a fusion consumes a maxed
 * item down to Lv3) and is otherwise left untouched — it never raises a level and never
 * mints ownership for an unowned id.
 *
 * Caller contract: Epic 12 (fusion consumption) drives this with an id it has already
 * confirmed owned at Lv5. It is NOT validated here — calling it with an unowned id adds
 * that id to remnantIds at level 0, permanently excluding it from the offer.
 *
 * The caller MUST re-fold PlayerStats after this call. This is the one level-mutating
 * function that is NOT a fold trigger: recomputePlayerStats runs only on a card pick
 * (LevelUpSystem), so a freeze from Lv5 down to Lv3 leaves the consumed item's Lv5
 * modifiers live until the next pick — which, once the eligible pool is exhausted, may
 * never come. Story 10.1 only tracks and exposes remnant state (no production caller
 * exists yet); Epic 12 owns the caller and therefore owns that re-fold.
 * @see isRemnant
 * @see module:state/PlayerStats.recomputePlayerStats
 * @param {{ ownedCards: Object<string, number>, remnantIds: Set<string> }} state
 * @param {string} id
 */
export function markRemnant(state, id) {
  state.remnantIds.add(id);
  const level = state.ownedCards[id] ?? 0;
  // Freeze DOWN to the remnant level only; never raise/mint a level.
  if (level > ITEM_REMNANT_LEVEL) state.ownedCards[id] = ITEM_REMNANT_LEVEL;
}

/**
 * The shared slot-occupancy query: distinct-owned item count per track, keyed by the
 * registry's id→track mapping. Read by BOTH the offer weighting (cardOffer) and the
 * fusion/query surface — one helper, never duplicated. An owned item counts once
 * regardless of its level (distinct-owned, not total levels).
 * @param {{ ownedCards: Object<string, number> }} state
 * @param {ReadonlyArray<{ id: string, track: string }>} registry
 * @returns {Object<string, number>} track → distinct-owned count.
 */
export function slotOccupancy(state, registry) {
  const trackOf = {};
  for (let i = 0; i < registry.length; i++) trackOf[registry[i].id] = registry[i].track;
  const counts = {};
  const ownedCards = state.ownedCards;
  for (const id in ownedCards) {
    if ((ownedCards[id] ?? 0) >= 1) {
      const track = trackOf[id];
      if (track != null) counts[track] = (counts[track] ?? 0) + 1;
    }
  }
  return counts;
}
