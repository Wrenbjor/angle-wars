// Placeholder card registry (Story 8.3 / Epic 8 progression).
//
// The level-up moment (LevelUpSystem + ArenaScene overlay) offers exactly three
// cards on a level-up. These are PLACEHOLDERS: selecting one only stacks a debug
// stat and records ownership in the run-scoped progressionState (see
// ProgressionState.js) — there is no real item/upgrade content yet. Epic 10
// replaces this pool with the real weighted item registry; the level-up loop, the
// ownership-count model, and the selection state machine are designed so that swap
// needs no rework here.
//
// Each card is a frozen { id, title, statDelta }:
//   - id        : stable unique key (the ownership map is keyed by it).
//   - title     : human-readable label the overlay renders.
//   - statDelta : the amount this card adds to progressionState.debugStat when
//                 applied (a plain numeric placeholder effect).

/**
 * The fixed placeholder offer for Epic 8: exactly three cards with distinct ids
 * and titles. Frozen so no consumer can mutate the shared registry. Story 8.4
 * later replaces this fixed trio with a weighted seeded draw; Epic 10 replaces the
 * content with real items.
 * @type {ReadonlyArray<{ id: string, title: string, statDelta: number }>}
 */
export const PLACEHOLDER_CARDS = Object.freeze([
  Object.freeze({ id: 'debug-alpha', title: 'Alpha Boost', statDelta: 1 }),
  Object.freeze({ id: 'debug-beta', title: 'Beta Boost', statDelta: 1 }),
  Object.freeze({ id: 'debug-gamma', title: 'Gamma Boost', statDelta: 1 }),
]);
