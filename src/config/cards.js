// Placeholder card pool (Story 8.4 / Epic 8 progression).
//
// The level-up moment (LevelUpSystem + ArenaScene overlay) offers three cards on
// a level-up, drawn by a deterministic weighted-without-replacement draw (see
// systems/cardOffer.js) from THIS pool. These are PLACEHOLDERS: selecting one only
// stacks a debug stat and records ownership in the run-scoped progressionState (see
// ProgressionState.js) — there is no real item/upgrade content yet. Epic 10 replaces
// this pool with the real weighted item registry; the level-up loop, the ownership-
// count model, the weighted draw, and the selection state machine are designed so
// that swap needs no rework here.
//
// Each card is a frozen { id, title, statDelta, rarity, track }:
//   - id        : stable unique key (the ownership map is keyed by it).
//   - title     : human-readable label the overlay renders.
//   - statDelta : the amount this card adds to progressionState.debugStat when
//                 applied (a plain numeric placeholder effect).
//   - rarity    : the positive BASE weight the draw multiplies by the ownership /
//                 level / slot factors (varied across cards so weighting is
//                 observable). Draw-only metadata — applyCard ignores it.
//   - track     : 'offense' or 'defense' — which build track the card belongs to,
//                 for the per-track slot-limit cap (SLOT_LIMIT_OFFENSE /
//                 SLOT_LIMIT_DEFENSE). Draw-only metadata.
//
// The pool is sized 6 offense + 5 defense = 11 so that even with BOTH tracks at
// their slot limit (5 offense + 4 defense distinct owned) at least 9 cards still
// carry positive weight — the exactly-three draw can never underflow.

/**
 * The Epic-8 placeholder pool the weighted draw (Story 8.4) offers from: 6 offense
 * + 5 defense = 11 cards with distinct ids/titles and varied rarities. Frozen so no
 * consumer can mutate the shared registry. Epic 10 replaces the content with real
 * weighted items.
 * @type {ReadonlyArray<{ id: string, title: string, statDelta: number, rarity: number, track: 'offense'|'defense' }>}
 */
export const PLACEHOLDER_CARDS = Object.freeze([
  // --- Offense (6) ---
  Object.freeze({ id: 'off-rapid', title: 'Rapid Fire', statDelta: 1, rarity: 5, track: 'offense' }),
  Object.freeze({ id: 'off-spread', title: 'Spread Shot', statDelta: 1, rarity: 4, track: 'offense' }),
  Object.freeze({ id: 'off-pierce', title: 'Piercing Rounds', statDelta: 1, rarity: 3, track: 'offense' }),
  Object.freeze({ id: 'off-charge', title: 'Charge Beam', statDelta: 1, rarity: 2, track: 'offense' }),
  Object.freeze({ id: 'off-homing', title: 'Homing Shots', statDelta: 1, rarity: 2, track: 'offense' }),
  Object.freeze({ id: 'off-crit', title: 'Critical Strike', statDelta: 1, rarity: 1, track: 'offense' }),
  // --- Defense (5) ---
  Object.freeze({ id: 'def-shield', title: 'Energy Shield', statDelta: 1, rarity: 5, track: 'defense' }),
  Object.freeze({ id: 'def-armor', title: 'Reinforced Armor', statDelta: 1, rarity: 4, track: 'defense' }),
  Object.freeze({ id: 'def-regen', title: 'Regeneration', statDelta: 1, rarity: 3, track: 'defense' }),
  Object.freeze({ id: 'def-dodge', title: 'Evasion', statDelta: 1, rarity: 2, track: 'defense' }),
  Object.freeze({ id: 'def-thorns', title: 'Thorns', statDelta: 1, rarity: 1, track: 'defense' }),
]);
