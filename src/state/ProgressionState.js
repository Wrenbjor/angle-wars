// ProgressionState — the run-scoped card-progression state (plain data, Phaser-free).
//
// Mirrors ScoreState's shape/discipline: a plain-data object mutated as the player
// drafts cards during level-up moments, read by the scene for the DEV readout. Kept
// separate from ScoreState (run economy) and PlayerState (ship lifecycle) because
// card ownership is its own concern. Built fresh per run in buildArenaWorld beside
// scoreState/playerState, NEVER touched by the death path — so it resets on a fresh
// run and survives a non-final death, exactly like scoreState.xp.
//
// Shape: { ownedCards, debugStat, rerollCharges, banishCharges, banishedIds }
//  - ownedCards    : a map of card id → COUNT (how many times that card has been
//                    drafted). The count/level model is the Epic 10 seam: when real
//                    items replace the placeholders, an item's level is its owned
//                    count, with no change to this loop.
//  - debugStat     : a plain running total the placeholder cards stack (each applied
//                    card adds its statDelta). Proves the draft loop end-to-end before
//                    real item effects exist; Epic 10's items apply real effects here.
//  - rerollCharges : Story 8.5 reroll economy — the number of trio redraws the run has
//                    banked (starts REROLL_INITIAL_CHARGES; LevelUpSystem grants +1 on
//                    crossing into each REROLL_LEVEL_GRANTS level, spends one per reroll).
//  - banishCharges : Story 8.5 banish economy — the number of permanent card drops the
//                    run has left (starts BANISH_INITIAL_CHARGES, one spent per banish).
//  - banishedIds   : Story 8.5 — the Set of card ids banished this run. Threaded into
//                    the weighted draw so a banished id is never offered again (its
//                    weight zeroes via the 8.4 banishMultiplier). A Set for O(1)
//                    membership + natural dedup.
// Like ownedCards, all three are run-scoped: created fresh per run and never touched by
// the death path (survive a non-final death, reset on a fresh run).

import {
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
} from '../config/constants.js';

/**
 * Create the run-scoped card-progression state at the start of a run: no cards
 * owned, debug stat zero, the reroll/banish charge economies at their starting
 * values, and an empty banished set. Rebuilt fresh per run (never reset on death —
 * mirrors scoreState.xp).
 * @returns {{ ownedCards: Object<string, number>, debugStat: number,
 *   rerollCharges: number, banishCharges: number, banishedIds: Set<string> }}
 */
export function createProgressionState() {
  return {
    ownedCards: {},
    debugStat: 0,
    rerollCharges: REROLL_INITIAL_CHARGES,
    banishCharges: BANISH_INITIAL_CHARGES,
    banishedIds: new Set(),
  };
}

/**
 * Apply a drafted card to the progression state (pure mutation): stack its
 * statDelta onto debugStat and bump the owned COUNT for its id. Drafting the same
 * card twice yields ownedCards[id] === 2 and adds its statDelta twice — the
 * ownership-count / level model that Epic 10 builds real item levels on.
 * @param {{ ownedCards: Object<string, number>, debugStat: number }} state
 * @param {{ id: string, statDelta: number }} card
 */
export function applyCard(state, card) {
  state.debugStat += card.statDelta;
  state.ownedCards[card.id] = (state.ownedCards[card.id] ?? 0) + 1;
}
