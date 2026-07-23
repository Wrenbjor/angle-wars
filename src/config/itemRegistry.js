// Item registry (Story 10.1 / Epic 10) — the single data-driven source of truth
// for every arsenal item.
//
// This replaces the Epic-8 PLACEHOLDER_CARDS pool. Each entry is ONE definition the
// whole draft loop reads from: the weighted card offer (systems/cardOffer.js) reads
// `rarity`/`track`/`maxLevel`, the on-pick application + owned-state read `id`, the
// current level is `ownedCards[id]` capped at `maxLevel`, the PlayerStats fold
// (state/PlayerStats.js) reads the current level's `stats`, and the (forward-looking)
// fusion checks read `fusion`. Adding an item is CONTENT — a new frozen entry — not
// new plumbing.
//
// Entry shape (duck-compatible with the retired card shape so cardOffer/LevelUpSystem
// keep working unchanged — id/rarity/track carry the draw, and `title` is the label
// the overlay renders):
//   { id, name, title, track:'offense'|'defense', rarity, maxLevel: ITEM_MAX_LEVEL,
//     levels: [{ level, desc, stats }] ×5, fusion: {partner, epic} | null }
//   - id      : stable unique key; ownedCards is keyed by it.
//   - name    : human-readable item name (canonical).
//   - title   : the label the level-up overlay draws (aliased to name so the overlay
//               renders a real label without a render-code change).
//   - track   : 'offense' | 'defense' — the per-track slot-limit bucket
//               (SLOT_LIMIT_OFFENSE / SLOT_LIMIT_DEFENSE).
//   - rarity  : the positive BASE weight the draw multiplies by the ownership /
//               level / slot factors. Draw-only metadata.
//   - maxLevel: the level cap (ITEM_MAX_LEVEL = 5). An item at level >= maxLevel is
//               never re-offered (cardWeight 0).
//   - levels  : exactly five per-level effect descriptors. `desc` is the human text
//               (from PRD §13.3/§13.4); `stats` is the current-level TOTAL modifier
//               map the fold applies. THIS story registers every item with an EMPTY
//               `stats: {}` — the framework is real, but each item's real per-level
//               effect NUMBERS and gameplay-seam wiring land in its own story
//               (Overcharge 10.2, Spread Cannon 10.3, Nanite Shield 10.4,
//               Afterburner 10.5). So the fold is a proven no-op on real content today.
//   - fusion  : {partner, epic} — this item at Lv5 + `partner` at Lv3 unlocks `epic`
//               (PRD §13.5); or null when it has no fusion. Tracked + exposed here;
//               Epic 12 owns the actual fusion consumption.

import { ITEM_MAX_LEVEL } from './constants.js';

/**
 * The four Epic-10 items (PRD §13.3 offense / §13.4 defense) as data-driven
 * definitions. Frozen (the array and every entry + nested level/fusion object) so no
 * consumer can mutate the shared registry. Effect NUMBERS are deferred to each item's
 * own story — every `stats` map is empty here.
 * @type {ReadonlyArray<{ id: string, name: string, title: string,
 *   track: 'offense'|'defense', rarity: number, maxLevel: number,
 *   levels: ReadonlyArray<{ level: number, desc: string, stats: Object<string,number> }>,
 *   fusion: { partner: string, epic: string } | null }>}
 */
export const ITEM_REGISTRY = Object.freeze([
  // --- Offense ---
  Object.freeze({
    id: 'overcharge',
    name: 'Overcharge',
    title: 'Overcharge',
    track: 'offense',
    rarity: 5,
    maxLevel: ITEM_MAX_LEVEL,
    levels: Object.freeze([
      Object.freeze({ level: 1, desc: '+15% damage', stats: Object.freeze({}) }),
      Object.freeze({ level: 2, desc: '+25% damage / +10% fire rate', stats: Object.freeze({}) }),
      Object.freeze({ level: 3, desc: '+35% damage / +20% fire rate', stats: Object.freeze({}) }),
      Object.freeze({ level: 4, desc: '+45% damage / +30% fire rate', stats: Object.freeze({}) }),
      Object.freeze({ level: 5, desc: '+60% damage / +40% fire rate', stats: Object.freeze({}) }),
    ]),
    // Overcharge Lv5 + any 2 offense items at Lv5 → Critical Resonance (PRD §13.5).
    // The "any 2 offense" condition has no single partner id; Epic 12 resolves it.
    fusion: Object.freeze({ partner: 'any-2-offense-lv5', epic: 'critical-resonance' }),
  }),
  Object.freeze({
    id: 'spread-cannon',
    name: 'Spread Cannon',
    title: 'Spread Cannon',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    levels: Object.freeze([
      Object.freeze({ level: 1, desc: '3-way spread / 12°', stats: Object.freeze({}) }),
      Object.freeze({ level: 2, desc: '5-way spread / 16°', stats: Object.freeze({}) }),
      Object.freeze({ level: 3, desc: '+30% fire rate', stats: Object.freeze({}) }),
      Object.freeze({ level: 4, desc: '7-way spread / 22°', stats: Object.freeze({}) }),
      Object.freeze({ level: 5, desc: '9-way spread / +35% damage', stats: Object.freeze({}) }),
    ]),
    // Spread Cannon Lv5 + Piercing Lance Lv3 → Sunburst (PRD §13.5).
    fusion: Object.freeze({ partner: 'piercing-lance', epic: 'sunburst' }),
  }),
  // --- Defense ---
  Object.freeze({
    id: 'nanite-shield',
    name: 'Nanite Shield',
    title: 'Nanite Shield',
    track: 'defense',
    rarity: 5,
    maxLevel: ITEM_MAX_LEVEL,
    levels: Object.freeze([
      Object.freeze({ level: 1, desc: 'Absorb 1 hit / 20s recharge', stats: Object.freeze({}) }),
      Object.freeze({ level: 2, desc: 'Recharge 15s', stats: Object.freeze({}) }),
      Object.freeze({ level: 3, desc: '2 charges', stats: Object.freeze({}) }),
      Object.freeze({ level: 4, desc: 'Recharge 10s', stats: Object.freeze({}) }),
      Object.freeze({ level: 5, desc: '3 charges + knockback pulse', stats: Object.freeze({}) }),
    ]),
    // Nanite Shield Lv5 + Afterburner Lv3 → Phase Armor (PRD §13.5).
    fusion: Object.freeze({ partner: 'afterburner', epic: 'phase-armor' }),
  }),
  Object.freeze({
    id: 'afterburner',
    name: 'Afterburner',
    title: 'Afterburner',
    track: 'defense',
    rarity: 3,
    maxLevel: ITEM_MAX_LEVEL,
    levels: Object.freeze([
      Object.freeze({ level: 1, desc: '+12% move speed', stats: Object.freeze({}) }),
      Object.freeze({ level: 2, desc: '+20% speed + dash (3s cooldown)', stats: Object.freeze({}) }),
      Object.freeze({ level: 3, desc: '+25% speed + dash i-frames', stats: Object.freeze({}) }),
      Object.freeze({ level: 4, desc: '2s dash cooldown + dash damages on contact', stats: Object.freeze({}) }),
      Object.freeze({ level: 5, desc: '+35% speed + burning dash trail', stats: Object.freeze({}) }),
    ]),
    // Afterburner Lv5 + Nanite Shield Lv3 → Slipstream (PRD §13.5).
    fusion: Object.freeze({ partner: 'nanite-shield', epic: 'slipstream' }),
  }),
]);

/**
 * Look up an item definition by its id. O(n) over the small fixed registry.
 * @param {string} id
 * @returns {(typeof ITEM_REGISTRY)[number] | undefined} the definition, or undefined.
 */
export function getItem(id) {
  for (let i = 0; i < ITEM_REGISTRY.length; i++) {
    if (ITEM_REGISTRY[i].id === id) return ITEM_REGISTRY[i];
  }
  return undefined;
}

/**
 * All item definitions belonging to a track ('offense' | 'defense'), in registry
 * order. A NEW array per call (the entries themselves are the shared frozen refs).
 * @param {'offense'|'defense'} track
 * @returns {Array<(typeof ITEM_REGISTRY)[number]>}
 */
export function getItemsByTrack(track) {
  return ITEM_REGISTRY.filter((item) => item.track === track);
}
