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
//     levels: [{ level, desc, stats }] ×5, guaranteeFromLevel: number | null,
//     fusion: {partner, epic} | null }
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
//               map the fold applies. HOW a value is authored follows the FIELD, not a
//               single rule (see the AUTHORING CONVENTION in state/PlayerStats.js):
//               a `*Mult` field is a FRACTIONAL BONUS onto a base of 1 (fireRateMult
//               0.3 = +30%), while a COUNT or an INTERVAL field is the ABSOLUTE value
//               onto a base of 0 (shieldCharges 2 = two charges; shieldRechargeMs
//               15000 = a 15s interval). Do not author an interval as a fraction. Each
//               item's real per-level effect NUMBERS and gameplay-seam wiring land in
//               its OWN story: Overcharge 10.2, Spread Cannon 10.3, Nanite Shield 10.4
//               and Afterburner 10.5. All FOUR Epic-10 items are now authored — no entry
//               carries an empty `stats` map any more.
//
//               ⚠ TOTALS-vs-DELTA-DESC TRAP. `stats` is the TOTAL at that level; `desc`
//               is player-facing prose and may read as a DELTA. Spread Cannon L3's desc
//               is '+30% fire rate', but its `stats` must ALSO restate the L2 spread
//               (5 ways / 16°) — otherwise picking L3 would silently REMOVE the spread.
//               Restated values are deliberate content, not copy-paste slips, and the
//               `desc` strings are never rewritten to match the totals.
//   - guaranteeFromLevel
//             : the RUN level from which the card offer RESERVES this item a slot while
//               it is still UNOWNED (level 0) — a `number`, or `null` for an item with
//               no guarantee. Read by systems/cardOffer.js BEFORE the weighted loop, so
//               it consumes no rng() draw. It is EXCLUSION-SUBORDINATE: it only ever
//               reserves a slot for an item whose ordinary `cardWeight` is already > 0,
//               so banished / maxed / remnant / unowned-in-a-full-track still exclude
//               it. Present on EVERY entry (null where there is no guarantee) so the
//               shape is uniform.
//   - fusion  : {partner, epic} — this item at Lv5 + `partner` at Lv3 unlocks `epic`
//               (PRD §13.5); or null when it has no fusion. Tracked + exposed here;
//               Epic 12 owns the actual fusion consumption.

import { ITEM_MAX_LEVEL, SPREAD_CANNON_GUARANTEE_LEVEL } from './constants.js';

/**
 * The four Epic-10 items (PRD §13.3 offense / §13.4 defense) as data-driven
 * definitions. Frozen (the array and every entry + nested level/fusion object) so no
 * consumer can mutate the shared registry. Every item's effect NUMBERS landed in its
 * own story — Overcharge's (10.2), Spread Cannon's (10.3), Nanite Shield's (10.4) and
 * Afterburner's (10.5); all four are AUTHORED and none carries an empty `stats` map.
 * @type {ReadonlyArray<{ id: string, name: string, title: string,
 *   track: 'offense'|'defense', rarity: number, maxLevel: number,
 *   levels: ReadonlyArray<{ level: number, desc: string, stats: Object<string,number> }>,
 *   guaranteeFromLevel: number | null,
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
    // Story 10.2 — the real per-level NUMBERS (PRD §13.3). Per the PlayerStats.js
    // AUTHORING CONVENTION these are FRACTIONAL BONUSES folded onto the base of 1
    // (`{ damageMult: 0.25 }` → 1.25x), and each level entry is the TOTAL at that
    // level, not a delta from the level before it. Every value must agree with the
    // `desc` text beside it — the registry is the single source of truth for both.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '+15% damage',
        stats: Object.freeze({ damageMult: 0.15 }),
      }),
      Object.freeze({
        level: 2,
        desc: '+25% damage / +10% fire rate',
        stats: Object.freeze({ damageMult: 0.25, fireRateMult: 0.1 }),
      }),
      Object.freeze({
        level: 3,
        desc: '+35% damage / +20% fire rate',
        stats: Object.freeze({ damageMult: 0.35, fireRateMult: 0.2 }),
      }),
      Object.freeze({
        level: 4,
        desc: '+45% damage / +30% fire rate',
        stats: Object.freeze({ damageMult: 0.45, fireRateMult: 0.3 }),
      }),
      Object.freeze({
        level: 5,
        desc: '+60% damage / +40% fire rate',
        stats: Object.freeze({ damageMult: 0.6, fireRateMult: 0.4 }),
      }),
    ]),
    // No offer guarantee — Overcharge is drawn purely on its weight.
    guaranteeFromLevel: null,
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
    // Story 10.3 — the real per-level NUMBERS (PRD §13.3). Two new fold fields:
    //   - spreadWays   : bullets per volley (additive/count field, base 0 — an unowned
    //                    Spread Cannon leaves the single-bullet volley untouched);
    //   - spreadArcDeg : the volley's TOTAL cone angle in degrees, CENTERED on the aim
    //                    direction — NOT the gap between adjacent bullets. Bullets are
    //                    spaced evenly across it, so a 3-way / 12° volley fires at aim
    //                    −6°, 0°, +6°. (PRD §13.5's Sunburst "full 360° ring" is the
    //                    same author using degrees for a volley's TOTAL coverage.)
    // The fire-rate and damage rungs reuse Story 10.2's already-shipped seams
    // (fireRateMult → effective interval, damageMult → stamped bullet damage) and stack
    // ADDITIVELY with Overcharge.
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header): L3 restates
    // the L2 spread, L4 restates the L3 fire rate, L5 restates the L4 arc AND the L3
    // fire rate — even though each `desc` reads as a delta. The saturating shape (a 22°
    // cone at both L4 and L5, so the volley grows DENSER rather than wider) is
    // deliberate content: more DPS down the aim line, not a wall of near-perpendicular
    // bullets.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '3-way spread / 12°',
        stats: Object.freeze({ spreadWays: 3, spreadArcDeg: 12 }),
      }),
      Object.freeze({
        level: 2,
        desc: '5-way spread / 16°',
        stats: Object.freeze({ spreadWays: 5, spreadArcDeg: 16 }),
      }),
      Object.freeze({
        level: 3,
        desc: '+30% fire rate',
        stats: Object.freeze({ spreadWays: 5, spreadArcDeg: 16, fireRateMult: 0.3 }),
      }),
      Object.freeze({
        level: 4,
        desc: '7-way spread / 22°',
        stats: Object.freeze({ spreadWays: 7, spreadArcDeg: 22, fireRateMult: 0.3 }),
      }),
      Object.freeze({
        level: 5,
        desc: '9-way spread / +35% damage',
        stats: Object.freeze({
          spreadWays: 9,
          spreadArcDeg: 22,
          fireRateMult: 0.3,
          damageMult: 0.35,
        }),
      }),
    ]),
    // PRD §13.3: Spread Cannon is the base-weapon evolution and is ALWAYS offered by run
    // level 3 while still unowned — the onboarding beat that makes a run's default firing
    // reliably scale into the mid-game. Subordinate to every exclusion (see the field's
    // note in the entry-shape header).
    guaranteeFromLevel: SPREAD_CANNON_GUARANTEE_LEVEL,
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
    // Story 10.4 — the real per-level NUMBERS (PRD §13.4). Three fold fields, all
    // ADDITIVE/COUNT fields (base 0 — an unowned shield changes nothing):
    //   - shieldCharges    : the MAXIMUM number of charges, NOT the live count. The
    //                        live count and the recharge timer are RUNTIME state on
    //                        NaniteShieldSystem, because the fold resets and re-derives
    //                        the whole store on EVERY card pick — a live count kept here
    //                        would be silently refilled by picking any unrelated item.
    //   - shieldRechargeMs : the interval that regenerates ONE charge, in milliseconds.
    //   - shieldKnockback  : the Lv5 break-pulse FLAG (>= 1 enables it). The pulse fires
    //                        only when the FINAL charge breaks — see NaniteShieldSystem.
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header), and this item
    // is where that trap bites hardest: L2 ('Recharge 15s') and L4 ('Recharge 10s') read
    // as recharge-ONLY but must RESTATE the charge count, or picking them would delete
    // the shield entirely; L3 ('2 charges') and L5 ('3 charges + knockback pulse') read
    // as charge-ONLY but must RESTATE the recharge interval, or picking them would drop
    // the shield to the base 0ms interval. The `desc` strings stay exactly as Story 10.1
    // shipped them — they are player-facing prose, never rewritten to match the totals.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: 'Absorb 1 hit / 20s recharge',
        stats: Object.freeze({ shieldCharges: 1, shieldRechargeMs: 20000 }),
      }),
      Object.freeze({
        level: 2,
        desc: 'Recharge 15s',
        stats: Object.freeze({ shieldCharges: 1, shieldRechargeMs: 15000 }),
      }),
      Object.freeze({
        level: 3,
        desc: '2 charges',
        stats: Object.freeze({ shieldCharges: 2, shieldRechargeMs: 15000 }),
      }),
      Object.freeze({
        level: 4,
        desc: 'Recharge 10s',
        stats: Object.freeze({ shieldCharges: 2, shieldRechargeMs: 10000 }),
      }),
      Object.freeze({
        level: 5,
        desc: '3 charges + knockback pulse',
        stats: Object.freeze({
          shieldCharges: 3,
          shieldRechargeMs: 10000,
          shieldKnockback: 1,
        }),
      }),
    ]),
    // No offer guarantee — Nanite Shield is drawn purely on its weight.
    guaranteeFromLevel: null,
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
    // Story 10.5 — the real per-level NUMBERS (PRD §13.4). FIVE fold fields:
    //   - moveSpeedMult  : a `*Mult` field, so the FRACTIONAL bonus onto a base of 1
    //                      (0.12 = +12%). PlayerMovementSystem applies it to BOTH its
    //                      thrust acceleration AND its speed cap, by the same factor,
    //                      so the ACHIEVED top speed really is SHIP_MAX_SPEED × mult at
    //                      every rung. (Scaling the cap alone delivers nothing above
    //                      ~1.15 — the thrust/drag equilibrium becomes the binding
    //                      constraint. See PlayerMovementSystem for the arithmetic.)
    //   - dashCooldownMs : the interval (ms) that GATES a dash — an ABSOLUTE INTERVAL
    //                      onto a base of 0, NEVER a fraction (the same authoring rule
    //                      shieldRechargeMs follows). It is also the ENABLE flag: 0
    //                      means no dash at all, which is why Lv1 owns none.
    //                      ⚠ It goes DOWN across levels (3000 → 2000) while the fold
    //                      only ever ADDS. That is correct because level entries are
    //                      TOTALS, not deltas — the fold reads ONE level's map.
    //   - dashIFrames    : Lv3+ FLAG (>= 1 enables) — invulnerability for the window.
    //   - dashDamage     : Lv4+ FLAG (>= 1 enables) — contact damage on the sweep. The
    //                      MAGNITUDE is the DASH_CONTACT_DAMAGE constant, not a fold
    //                      field, so a second dash item could not double it.
    //   - dashTrail      : Lv5 FLAG (>= 1 enables) — the cosmetic burning trail.
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header), and the
    // TOTALS-vs-DELTA-DESC trap bites here in both directions: L3's desc names ONLY the
    // i-frames yet must RESTATE the L2 cooldown, or picking it would DELETE the dash;
    // L4's desc names ONLY the cooldown and the damage yet must restate the speed and
    // the i-frames. L4 in particular repeats `moveSpeedMult: 0.25` UNCHANGED from L3 —
    // that reads like a copy-paste slip and is deliberate content (L4 is a cooldown /
    // damage rung, not a speed rung). The `desc` strings stay exactly as Story 10.1
    // shipped them — player-facing prose, never rewritten to match the totals.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '+12% move speed',
        stats: Object.freeze({ moveSpeedMult: 0.12 }),
      }),
      Object.freeze({
        level: 2,
        desc: '+20% speed + dash (3s cooldown)',
        stats: Object.freeze({ moveSpeedMult: 0.2, dashCooldownMs: 3000 }),
      }),
      Object.freeze({
        level: 3,
        desc: '+25% speed + dash i-frames',
        stats: Object.freeze({
          moveSpeedMult: 0.25,
          dashCooldownMs: 3000,
          dashIFrames: 1,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: '2s dash cooldown + dash damages on contact',
        stats: Object.freeze({
          moveSpeedMult: 0.25,
          dashCooldownMs: 2000,
          dashIFrames: 1,
          dashDamage: 1,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '+35% speed + burning dash trail',
        stats: Object.freeze({
          moveSpeedMult: 0.35,
          dashCooldownMs: 2000,
          dashIFrames: 1,
          dashDamage: 1,
          dashTrail: 1,
        }),
      }),
    ]),
    // No offer guarantee — Afterburner is drawn purely on its weight.
    guaranteeFromLevel: null,
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
