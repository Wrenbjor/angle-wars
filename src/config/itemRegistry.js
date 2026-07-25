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

import { ITEM_MAX_LEVEL, SPREAD_CANNON_GUARANTEE_LEVEL, REINFORCED_HULL_IFRAMES_BONUS_MS } from './constants.js';

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
  Object.freeze({
    id: 'orbit-blade',
    name: 'Orbit Blade',
    title: 'Orbit Blade',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.1 — the first Epic-11 EXOTIC offense item (PRD §13.3): a ring of
    // rotating melee blades. Four fold fields, all read by OrbitBladeSystem:
    //   - orbitBladeCount   : blade count (additive/count field, base 0 — an unowned
    //                         Orbit Blade means NO blades and no sweep);
    //   - orbitBladeDamage  : per-blade contact damage, routed through the shared
    //                         CollisionSystem.applyPlayerDamage seam (armor-respecting);
    //   - orbitBladePeriodMs: rotation period in ms per full revolution — a smaller
    //                         value spins FASTER (1200 → 1000 → 700). An ABSOLUTE
    //                         INTERVAL onto a base of 0, never a fraction (the same
    //                         authoring rule shieldRechargeMs / dashCooldownMs follow);
    //   - orbitBladeRadiusMult: the Lv5 +25% ring-radius bonus — a `*Mult` FRACTIONAL
    //                         bonus onto a base of 1 (0.25 → 1.25× radius), authored
    //                         ONLY at Lv5.
    //
    // The live rotation phase and the blade pool are RUNTIME state on OrbitBladeSystem,
    // for the same reason the shield's live charge count and the dash's live window are:
    // the fold RESETS every field and re-derives the whole store on EVERY card pick.
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header): L2 restates
    // the L1 damage/period, L3 restates the damage, L4 restates the period, L5 restates
    // the damage — even though each `desc` reads as a delta. The `desc` strings stay
    // exactly as PRD §13.3 shipped them — player-facing prose, never rewritten to match
    // the totals. The count 1→2→3→4→5, damage 90/90/90/126/126, period 1200/1200/1000/
    // 1000/700, +25% radius only at Lv5.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '1 blade / 90 dmg / 1.2s rotation',
        stats: Object.freeze({
          orbitBladeCount: 1,
          orbitBladeDamage: 90,
          orbitBladePeriodMs: 1200,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: '2 opposed blades',
        stats: Object.freeze({
          orbitBladeCount: 2,
          orbitBladeDamage: 90,
          orbitBladePeriodMs: 1200,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: '3 blades / 1.0s rotation',
        stats: Object.freeze({
          orbitBladeCount: 3,
          orbitBladeDamage: 90,
          orbitBladePeriodMs: 1000,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: '4 blades / +40% damage',
        stats: Object.freeze({
          orbitBladeCount: 4,
          orbitBladeDamage: 126,
          orbitBladePeriodMs: 1000,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '5 blades / 0.7s / +25% radius',
        stats: Object.freeze({
          orbitBladeCount: 5,
          orbitBladeDamage: 126,
          orbitBladePeriodMs: 700,
          orbitBladeRadiusMult: 0.25,
        }),
      }),
    ]),
    // No offer guarantee — Orbit Blade is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Orbit Blade Lv5 + Overcharge Lv3 → Tesla Circuit (PRD §13.5). Epic 12 owns the
    // actual fusion consumption; this only registers the metadata.
    fusion: Object.freeze({ partner: 'overcharge', epic: 'tesla-circuit' }),
  }),
  Object.freeze({
    id: 'seeker-drones',
    name: 'Seeker Drones',
    title: 'Seeker Drones',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.2 — the second Epic-11 EXOTIC offense item (PRD §13.3): autonomous
    // shooters that ride a ring around the ship and fire pooled shots at the nearest
    // combat enemy on their own cadence. Four fold fields, all read by SeekerDroneSystem:
    //   - seekerDroneCount    : drone count (additive/count field, base 0 — an unowned
    //                           Seeker Drones means NO drones, no shots, no target scan);
    //   - seekerDroneDamage   : per-shot damage, routed through the shared
    //                           CollisionSystem.applyPlayerDamage seam. A shot is a
    //                           PROJECTILE, so the armored archetype resists it exactly as
    //                           it resists a bullet (intended — drones are not on the
    //                           melee/AoE full-damage list, which is why the base is low);
    //   - seekerDronePeriodMs : fire period in ms between a drone's shots — a smaller
    //                           value fires FASTER (1500 → 1071). An ABSOLUTE INTERVAL onto
    //                           a base of 0, never a fraction (the same authoring rule
    //                           shieldRechargeMs / orbitBladePeriodMs follow);
    //   - seekerDroneHoming   : the Lv4+ homing FLAG (>= 1 enables) — a shot re-aims toward
    //                           the nearest enemy each fixed step. Authored ONLY at Lv4/Lv5.
    //
    // The live drone/shot pools, the per-drone fire accumulators and the ring's rotation
    // phase are RUNTIME state on SeekerDroneSystem, for the same reason the shield's live
    // charge count and the blade's live phase are: the fold RESETS every field and
    // re-derives the whole store on EVERY card pick.
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header): L2 restates the
    // L1 damage/period, L3 restates the damage, L4 restates the damage/period AND adds
    // homing, L5 restates the period/homing while raising the damage — even though each
    // `desc` reads as a delta. The `desc` strings stay exactly as PRD §13.3 shipped them —
    // player-facing prose, never rewritten to match the totals. The count 1→2→3→4→5,
    // damage 3/3/3/3/4.8 (×1.6 at Lv5), period 1500/1500/1071/1071/1071 (÷1.4 = +40% rate
    // from Lv3), homing from Lv4.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '1 drone / fires every 1.5s',
        stats: Object.freeze({
          seekerDroneCount: 1,
          seekerDroneDamage: 3,
          seekerDronePeriodMs: 1500,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: '2 drones',
        stats: Object.freeze({
          seekerDroneCount: 2,
          seekerDroneDamage: 3,
          seekerDronePeriodMs: 1500,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: '3 drones / +40% fire rate',
        stats: Object.freeze({
          seekerDroneCount: 3,
          seekerDroneDamage: 3,
          seekerDronePeriodMs: 1071,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: '4 drones / homing shots',
        stats: Object.freeze({
          seekerDroneCount: 4,
          seekerDroneDamage: 3,
          seekerDronePeriodMs: 1071,
          seekerDroneHoming: 1,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '5 drones / +60% damage',
        stats: Object.freeze({
          seekerDroneCount: 5,
          seekerDroneDamage: 4.8,
          seekerDronePeriodMs: 1071,
          seekerDroneHoming: 1,
        }),
      }),
    ]),
    // No offer guarantee — Seeker Drones is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Seeker Drones Lv5 + Nanite Shield Lv3 → Swarm Protocol (PRD §13.5). Epic 12 owns
    // the actual fusion consumption; this only registers the metadata.
    fusion: Object.freeze({ partner: 'nanite-shield', epic: 'swarm-protocol' }),
  }),
  Object.freeze({
    id: 'mine-layer',
    name: 'Mine Layer',
    title: 'Mine Layer',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.3 — the third Epic-11 EXOTIC offense item (PRD §13.3) and the first
    // AoE-DETONATION entity: the kiting ship drops timed mines that arm, then detonate on
    // an approaching enemy, dealing FULL damage to every enemy in the blast. Five fold
    // fields, all read by MineLayerSystem:
    //   - mineDropPeriodMs   : the interval (ms) between drops (additive/count field, base
    //                          0 — an unowned Mine Layer means NO drops, no detonation, no
    //                          pull). Also the OWNERSHIP GATE: 0 = unowned. A smaller value
    //                          drops FASTER (2000 → 1300). An ABSOLUTE INTERVAL onto a base
    //                          of 0, never a fraction (the same authoring rule
    //                          shieldRechargeMs / seekerDronePeriodMs follow);
    //   - mineCap            : the MAXIMUM live mine count — a drop over the cap evicts the
    //                          oldest mine first (10 → 12);
    //   - mineDetonateRadius : the blast radius (px) stamped on each new mine at drop,
    //                          routed through the shared CollisionSystem.applyPlayerDamage
    //                          seam (armor-respecting). A mine detonation is AoE and deals
    //                          FULL damage to the armored archetype (via MINE_DETONATE_DAMAGE
    //                          = 90 >= ARMORED_HP), unlike the projectile-resisted drone shot;
    //   - minePull           : the Lv4+ pull FLAG (>= 1 enables) — an armed mine drags nearby
    //                          combat enemies inward each tick;
    //   - mineChain          : the Lv5 chain FLAG (>= 1 enables) — a detonation chains to
    //                          adjacent armed mines.
    //
    // The live mine pool and the drop accumulator are RUNTIME state on MineLayerSystem, for
    // the same reason the shield's live charge count and the blade's live phase are: the
    // fold RESETS every field and re-derives the whole store on EVERY card pick. Per-mine
    // detonate radius / pull / chain are STAMPED at DROP time, so a mine laid at Lv1 keeps
    // its 60r/no-pull/no-chain shape even after a later upgrade (the drone-shot convention).
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header): L3 ('drops every
    // 1.3s') restates the cap AND the L2 100r blast; L4 ('mines pull enemies inward') and
    // L5 ('detonation chains to adjacent mines') restate every field they inherit — even
    // though each `desc` reads as a delta. The `desc` strings stay exactly as PRD §13.3
    // shipped them — player-facing prose, never rewritten to match the totals. The period
    // 2000/2000/1300/1300/1300, cap 10/12/12/12/12, radius 60/100/100/100/100, pull from
    // Lv4, chain from Lv5.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: 'mine every 2s / 3s arm / 60r',
        stats: Object.freeze({
          mineDropPeriodMs: 2000,
          mineCap: 10,
          mineDetonateRadius: 60,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: '+2 mine cap / 100r blast',
        stats: Object.freeze({
          mineDropPeriodMs: 2000,
          mineCap: 12,
          mineDetonateRadius: 100,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: 'drops every 1.3s',
        stats: Object.freeze({
          mineDropPeriodMs: 1300,
          mineCap: 12,
          mineDetonateRadius: 100,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: 'mines pull enemies inward',
        stats: Object.freeze({
          mineDropPeriodMs: 1300,
          mineCap: 12,
          mineDetonateRadius: 100,
          minePull: 1,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: 'detonation chains to adjacent mines',
        stats: Object.freeze({
          mineDropPeriodMs: 1300,
          mineCap: 12,
          mineDetonateRadius: 100,
          minePull: 1,
          mineChain: 1,
        }),
      }),
    ]),
    // No offer guarantee — Mine Layer is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Mine Layer Lv5 + Gravity Well Lv3 → Singularity Field (PRD §13.5 — mines becoming
    // mini black holes). Epic 12 owns the actual fusion consumption; this only registers
    // the metadata (the partner `gravity-well` lands in Story 11.7).
    fusion: Object.freeze({ partner: 'gravity-well', epic: 'singularity-field' }),
  }),
  Object.freeze({
    id: 'piercing-lance',
    name: 'Piercing Lance',
    title: 'Piercing Lance',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.4 — the fourth Epic-11 EXOTIC offense item (PRD §13.3) and the first PIERCING
    // projectile: a slow, heavy bolt auto-fired on a cadence FROM the ship TOWARD the nearest
    // combat enemy that punches THROUGH a line of enemies instead of stopping at the first, so
    // a dense column clears in one shot. Five fold fields, all read by PiercingLanceSystem:
    //   - lancePeriodMs  : the interval (ms) between bolt cadences (additive/count field, base
    //                      0 — an unowned Piercing Lance means NO bolts, no pierce, no trail).
    //                      Also the OWNERSHIP GATE: 0 = unowned. A smaller value fires FASTER
    //                      (2000 → 1400). An ABSOLUTE INTERVAL onto a base of 0, never a
    //                      fraction (the same authoring rule mineDropPeriodMs / seekerDronePeriodMs
    //                      follow);
    //   - lancePierce    : distinct enemies ONE bolt punches through (2 → 4 → 7);
    //   - lanceDamage    : per-bolt damage, routed through the shared
    //                      CollisionSystem.applyPlayerDamage seam (armor-respecting). A bolt is
    //                      a PROJECTILE — the armored archetype (hp 5) resists it, so the Lv3
    //                      +50% (4 → 6) one-shots armored by MAGNITUDE (hits-to-kill 2 → 1),
    //                      NOT by an armor-bypass classification (contrast the mine's AoE 90);
    //   - lanceTrail     : the Lv4+ trail FLAG (>= 1 enables) — a bolt drops a 0.5s lingering
    //                      damage trail along its path;
    //   - lanceBackward  : the Lv5 backward FLAG (>= 1 enables) — a second bolt fires antipodal
    //                      (backward) each cadence.
    //
    // The live bolt/trail pools and the fire accumulator are RUNTIME state on
    // PiercingLanceSystem, for the same reason the shield's live charge count and the mine's
    // live pool are: the fold RESETS every field and re-derives the whole store on EVERY card
    // pick. Per-bolt pierce / damage / trail are STAMPED at FIRE time, so a bolt fired at Lv1
    // keeps its 2-pierce / 4-damage / no-trail shape even after a later upgrade (the drone-shot
    // convention).
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header): L2 restates the L1
    // period/damage, L3 restates the L2 pierce, L4 ('leaves a damage trail') restates every
    // field it inherits, L5 ('fires a second bolt backward') restates the trail too — even
    // though each `desc` reads as a delta. The `desc` strings stay exactly as PRD §13.3 shipped
    // them — player-facing prose, never rewritten to match the totals. The period
    // 2000/2000/1400/1400/1400, pierce 2/4/4/7/7, damage 4/4/6/6/6, trail from Lv4, backward
    // from Lv5.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: 'pierces 2 enemies / fires every 2s',
        stats: Object.freeze({
          lancePeriodMs: 2000,
          lancePierce: 2,
          lanceDamage: 4,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: 'pierces 4 enemies',
        stats: Object.freeze({
          lancePeriodMs: 2000,
          lancePierce: 4,
          lanceDamage: 4,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: '+50% damage / faster fire',
        stats: Object.freeze({
          lancePeriodMs: 1400,
          lancePierce: 4,
          lanceDamage: 6,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: 'pierces 7 / leaves a damage trail',
        stats: Object.freeze({
          lancePeriodMs: 1400,
          lancePierce: 7,
          lanceDamage: 6,
          lanceTrail: 1,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: 'fires a second bolt backward',
        stats: Object.freeze({
          lancePeriodMs: 1400,
          lancePierce: 7,
          lanceDamage: 6,
          lanceTrail: 1,
          lanceBackward: 1,
        }),
      }),
    ]),
    // No offer guarantee — Piercing Lance is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Piercing Lance Lv5 + Overcharge Lv3 → Railgun (PRD §13.5). Epic 12 owns the actual
    // fusion consumption; this only registers the metadata.
    fusion: Object.freeze({ partner: 'overcharge', epic: 'railgun' }),
  }),
  Object.freeze({
    id: 'ricochet-rounds',
    name: 'Ricochet Rounds',
    title: 'Ricochet Rounds',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.5 — the fifth Epic-11 EXOTIC offense item (PRD §13.4) and the first BASE-GUN
    // MODIFIER of the epic: it makes the player's ORDINARY bullets bounce off the arena walls
    // (and, higher up, enemies) instead of despawning at the border, so a miss keeps working.
    // Unlike the four prior Epic-11 items (each a SEPARATE pooled system), Ricochet folds onto
    // the EXISTING base bullet via FiringSystem/CollisionSystem — the Overcharge / Spread
    // Cannon category. Four fold fields, all STAMPED onto each bullet at spawn (systems/
    // ricochet.js), none carrying runtime system state:
    //   - ricochetBounces      : the bounce BUDGET (additive/count field, base 0 — an unowned
    //                            Ricochet means the pre-11.5 gun: bullets despawn at the border
    //                            and are consumed on first hit). Also the OWNERSHIP GATE: 0 =
    //                            unowned. A single budget spent by wall AND enemy reflections.
    //   - ricochetDmgPerBounce : the per-bounce damage-growth FRACTION (0.25 = +25%/bounce),
    //                            NOT a `*Mult` — bases at 0, written as the plain fraction;
    //                            growth compounds on the bullet's current stamped damage;
    //   - ricochetOffEnemies   : the Lv4+ enemy-bounce FLAG (>= 1 enables) — a bullet with
    //                            budget bounces OFF an enemy it hits instead of being consumed;
    //   - ricochetSeek         : the Lv5 homing FLAG (>= 1 enables) — a bounced bullet re-aims
    //                            toward the nearest combat enemy each fixed step.
    //
    // ⚠ Every map is the TOTAL at that level (see the entry-shape header): L3 restates the L2
    // bounces AND adds the growth fraction, L4 restates bounces/growth AND adds the enemy-bounce
    // flag, L5 raises the budget to 4 AND restates growth/enemy-bounce while adding seek — even
    // though each `desc` reads as a delta. The `desc` strings stay exactly as PRD §13.4 shipped
    // them — player-facing prose, never rewritten to match the totals. The bounces 1/2/2/2/4,
    // dmgPerBounce 0/0/0.25/0.25/0.25, offEnemies from Lv4, seek from Lv5.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: 'bullets bounce off walls once',
        stats: Object.freeze({ ricochetBounces: 1 }),
      }),
      Object.freeze({
        level: 2,
        desc: 'bullets bounce twice',
        stats: Object.freeze({ ricochetBounces: 2 }),
      }),
      Object.freeze({
        level: 3,
        desc: '+25% damage per bounce',
        stats: Object.freeze({
          ricochetBounces: 2,
          ricochetDmgPerBounce: 0.25,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: 'bounce off enemies too',
        stats: Object.freeze({
          ricochetBounces: 2,
          ricochetDmgPerBounce: 0.25,
          ricochetOffEnemies: 1,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '4 bounces / bounced shots seek enemies',
        stats: Object.freeze({
          ricochetBounces: 4,
          ricochetDmgPerBounce: 0.25,
          ricochetOffEnemies: 1,
          ricochetSeek: 1,
        }),
      }),
    ]),
    // No offer guarantee — Ricochet Rounds is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Ricochet Rounds Lv5 + Spread Cannon Lv3 → Kaleidoscope (PRD §13.5). Epic 12 owns the
    // actual fusion consumption; this only registers the metadata.
    fusion: Object.freeze({ partner: 'spread-cannon', epic: 'kaleidoscope' }),
  }),
  Object.freeze({
    id: 'flak-burst',
    name: 'Flak Burst',
    title: 'Flak Burst',
    track: 'offense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.6 — the sixth Epic-11 EXOTIC offense item (PRD §13.3) and second BASE-GUN
    // MODIFIER of the epic: Flak Burst turns every Nth bullet fired into an airburst shell
    // that detonates on enemy impact or wall contact into a radial cluster of fragments.
    // Four fold fields, all read by FiringSystem / FlakSystem:
    //   - flakCadence           : cadence N (5 → 4 → 4 → 3 → 3) AND ownership gate (0 = unowned);
    //   - flakFragments         : primary fragment count per airburst (6 → 8 → 8 → 12 → 12);
    //   - flakDamageMult        : fragment damage multiplier fraction (0.5 = +50% at Lv3+);
    //   - flakSecondaryAirburst : Lv5 secondary airburst FLAG (>= 1 enables) — primary fragments
    //                            airburst once on hit or expiration into 4 sub-fragments.
    //
    // ⚠ Every map is the TOTAL at that level (see entry-shape header): L3 restates cadence/fragments
    // AND adds +50% fragment damage; L4 restates fragment damage AND updates cadence/fragments;
    // L5 restates cadence/fragments/damage AND adds secondary airbursts.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: 'Every 5th bullet airbursts / 6 fragments',
        stats: Object.freeze({
          flakCadence: 5,
          flakFragments: 6,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: 'Every 4th bullet / 8 fragments',
        stats: Object.freeze({
          flakCadence: 4,
          flakFragments: 8,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: '+50% fragment damage',
        stats: Object.freeze({
          flakCadence: 4,
          flakFragments: 8,
          flakDamageMult: 0.5,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: 'Every 3rd bullet / 12 fragments',
        stats: Object.freeze({
          flakCadence: 3,
          flakFragments: 12,
          flakDamageMult: 0.5,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: 'Secondary airbursts',
        stats: Object.freeze({
          flakCadence: 3,
          flakFragments: 12,
          flakDamageMult: 0.5,
          flakSecondaryAirburst: 1,
        }),
      }),
    ]),
    // No offer guarantee — Flak Burst is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Flak Burst Lv5 + Overcharge Lv3 → Fragmentation Cascade (PRD §13.5). Epic 12 owns the
    // actual fusion consumption; this only registers the metadata.
    fusion: Object.freeze({ partner: 'overcharge', epic: 'fragmentation-cascade' }),
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
  Object.freeze({
    id: 'gravity-well',
    name: 'Gravity Well',
    title: 'Gravity Well',
    track: 'defense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.7 — the third Epic-11 EXOTIC defense item (PRD §13.4): extends XP pickup
    // radius, adds orb homing, scales base XP orb value, and nudges nearby enemies toward orbs.
    // Four fold fields, all read by XpOrbSystem:
    //   - xpPickupRadiusMult     : pickup radius multiplier bonus (+40% → +80% → +80% → +80% → +150%);
    //   - gravityWellHoming      : Lv3+ homing FLAG (>= 1 enables 540 px/s orb homing);
    //   - xpValueMult            : Lv4+ base XP value multiplier bonus (+25% at Lv4+);
    //   - gravityWellPullEnemies : Lv5+ pull FLAG (>= 1 enables active orbs pulling nearby combat enemies).
    //
    // ⚠ Every map is the TOTAL at that level (see entry-shape header): L3 restates radius bonus
    // AND adds homing; L4 restates radius/homing AND adds XP value boost; L5 restates homing/XP value
    // AND raises radius bonus to +150% while adding enemy pull.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '+40% XP pickup radius',
        stats: Object.freeze({
          xpPickupRadiusMult: 0.4,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: '+80% XP pickup radius',
        stats: Object.freeze({
          xpPickupRadiusMult: 0.8,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: 'XP orbs home toward ship (540 px/s)',
        stats: Object.freeze({
          xpPickupRadiusMult: 0.8,
          gravityWellHoming: 1,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: '+25% base XP value from orbs',
        stats: Object.freeze({
          xpPickupRadiusMult: 0.8,
          gravityWellHoming: 1,
          xpValueMult: 0.25,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '+150% pickup radius / XP orbs pull nearby enemies',
        stats: Object.freeze({
          xpPickupRadiusMult: 1.5,
          gravityWellHoming: 1,
          xpValueMult: 0.25,
          gravityWellPullEnemies: 1,
        }),
      }),
    ]),
    // No offer guarantee — Gravity Well is drawn purely on its weight.
    guaranteeFromLevel: null,
    // Gravity Well Lv5 + Mine Layer Lv3 → Event Horizon (PRD §13.5).
    fusion: Object.freeze({ partner: 'mine-layer', epic: 'event-horizon' }),
  }),
  Object.freeze({
    id: 'reinforced-hull',
    name: 'Reinforced Hull',
    title: 'Reinforced Hull',
    track: 'defense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.8 — the fourth Epic-11 EXOTIC defense item (PRD §13.4): adds extra max lives,
    // extends respawn invulnerability duration, and softens run multiplier reset on death.
    // Three fold fields, all read by PlayerDeathSystem:
    //   - extraLives            : +1 max life on pick (+1 at Lv1, Lv3, Lv5);
    //   - respawnIFramesMs      : additional respawn i-frames duration in ms (1500ms at Lv2+);
    //   - softenMultiplierReset : Lv4+ flag (>= 1 enables 50% multiplier drop on death instead of 1x).
    //
    // ⚠ Every map is the TOTAL at that level: L2 restates extraLives: 1; L3 restates respawnIFramesMs: 1500;
    // L4 restates extraLives: 2 and respawnIFramesMs: 1500; L5 restates respawnIFramesMs: 1500 and softenMultiplierReset: 1.
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '+1 max life',
        stats: Object.freeze({ extraLives: 1 }),
      }),
      Object.freeze({
        level: 2,
        desc: '3.5s respawn i-frames',
        stats: Object.freeze({
          extraLives: 1,
          respawnIFramesMs: REINFORCED_HULL_IFRAMES_BONUS_MS,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: '+1 max life',
        stats: Object.freeze({
          extraLives: 2,
          respawnIFramesMs: REINFORCED_HULL_IFRAMES_BONUS_MS,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: 'death drops multiplier to 50%',
        stats: Object.freeze({
          extraLives: 2,
          respawnIFramesMs: REINFORCED_HULL_IFRAMES_BONUS_MS,
          softenMultiplierReset: 1,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '+1 max life',
        stats: Object.freeze({
          extraLives: 3,
          respawnIFramesMs: REINFORCED_HULL_IFRAMES_BONUS_MS,
          softenMultiplierReset: 1,
        }),
      }),
    ]),
    guaranteeFromLevel: null,
    // Reinforced Hull Lv5 + Bomb Capacitor Lv3 → Revenant (PRD §13.5).
    fusion: Object.freeze({ partner: 'bomb-capacitor', epic: 'revenant' }),
  }),
  Object.freeze({
    id: 'bomb-capacitor',
    name: 'Bomb Capacitor',
    title: 'Bomb Capacitor',
    track: 'defense',
    rarity: 4,
    maxLevel: ITEM_MAX_LEVEL,
    // Story 11.9 — the fifth Epic-11 EXOTIC defense item (PRD §13.4): smart bomb progression.
    // Six fold fields:
    //   - extraBombs        : extra smart bombs granted (+1 at Lv1, +1 at Lv3, +2 at Lv5);
    //   - bombRadiusMult    : multiplier bonus for shockwave radius (+30% at Lv1+);
    //   - bombAwardInterval : score threshold interval for +1 bomb award (75k at Lv2+, 50k at Lv4+);
    //   - bombStunMs        : stun duration (ms) for surviving combat enemies at Lv3+ (2000ms);
    //   - bombXpOrbs        : count of XP orbs dropped on detonation at Lv4+ (5 orbs);
    //   - bombDamageFieldMs : duration (ms) of lingering damage field at Lv5 (3000ms).
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        desc: '+1 bomb / +30% shockwave radius',
        stats: Object.freeze({
          extraBombs: 1,
          bombRadiusMult: 0.3,
        }),
      }),
      Object.freeze({
        level: 2,
        desc: '+1 bomb every 75k score',
        stats: Object.freeze({
          extraBombs: 1,
          bombRadiusMult: 0.3,
          bombAwardInterval: 75000,
        }),
      }),
      Object.freeze({
        level: 3,
        desc: '+1 bomb / surviving enemies stunned for 2s',
        stats: Object.freeze({
          extraBombs: 2,
          bombRadiusMult: 0.3,
          bombAwardInterval: 75000,
          bombStunMs: 2000,
        }),
      }),
      Object.freeze({
        level: 4,
        desc: '+1 bomb every 50k score / detonation drops 5 XP orbs',
        stats: Object.freeze({
          extraBombs: 2,
          bombRadiusMult: 0.3,
          bombAwardInterval: 50000,
          bombStunMs: 2000,
          bombXpOrbs: 5,
        }),
      }),
      Object.freeze({
        level: 5,
        desc: '+2 bombs / 3s lingering damage field',
        stats: Object.freeze({
          extraBombs: 4,
          bombRadiusMult: 0.3,
          bombAwardInterval: 50000,
          bombStunMs: 2000,
          bombXpOrbs: 5,
          bombDamageFieldMs: 3000,
        }),
      }),
    ]),
    guaranteeFromLevel: null,
    // Bomb Capacitor Lv5 + Flak Burst Lv3 → Chain Reaction (PRD §13.5).
    fusion: Object.freeze({ partner: 'flak-burst', epic: 'chain-reaction' }),
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
