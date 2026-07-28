// PlayerStats — the runtime player-stat modifier store (Story 10.1 / Epic 10),
// plain data, Phaser-free.
//
// A single object holding the derived firepower/defense modifiers an owned build
// produces. Gameplay systems (Overcharge → global fire, Afterburner → movement, …)
// read these instead of recomputing per frame. The store is folded ONCE on a level
// change (a card pick — see LevelUpSystem), never per frame, and the fold mutates the
// passed object in place with ZERO per-call allocation, honoring the epic's
// zero-per-frame-allocation constraint.
//
// Field vocabulary starts minimal and each item story extends it. The fold is
// additive onto a per-field base: MULTIPLIER fields (suffix `Mult`) base at 1, all
// other (additive/count) fields base at 0. Story 10.2 gave the fold its first REAL
// content: Overcharge's five levels carry authored `damageMult`/`fireRateMult` maps,
// exercised against the SHIPPED registry in playerStats.test.js (not only against
// synthetic fixtures). Story 10.3 added Spread Cannon's, which introduce the two
// `spreadWays`/`spreadArcDeg` count fields AND reuse Overcharge's `fireRateMult`/
// `damageMult` rungs — so two items now stack additively on the same fields, exactly as
// the fold specifies. Story 10.4 added Nanite Shield's three `shield*` fields, the first
// item whose effect has RUNTIME state (a live charge count) rather than a pure stat read
// — the fold owns only the derived MAXIMA (see the field comments below). Story 10.5
// added Afterburner's five `moveSpeedMult`/`dash*` fields, the second item with RUNTIME
// state (the live cooldown / active window / dash direction live on DashSystem). All
// four Epic-10 items are now authored — no registry entry carries an empty `stats` map.
//
// AUTHORING CONVENTION (read this before writing any `stats` map in stories 10.2–10.5).
// The fold ADDS onto the base, so a `*Mult` entry is the FRACTIONAL BONUS, never the
// finished multiplier:
//   "+15% damage"  →  { damageMult: 0.15 }   // folds onto base 1 → 1.15x   CORRECT
//   "+15% damage"  →  { damageMult: 1.15 }   // folds onto base 1 → 2.15x   WRONG
// Non-`Mult` (additive/count) fields base at 0 and are written as the plain amount
// (`{ shieldCharges: 1 }`). "TOTALS-at-that-level" below refers to LEVELS, not to the
// base: each level entry restates the item's whole bonus at that level rather than a
// delta from the level before it — it is still a bonus added onto the base. Two items
// contributing the same `*Mult` therefore stack ADDITIVELY (+50% and +50% → 2.0x, not
// 2.25x); that is the specified fold, not an accident.

/**
 * The base modifier fields and their starting values. Reset iterates THIS map (rather
 * than a hardcoded field list), so a later story that adds a field here is reset
 * correctly with no second place to update. Multiplier fields base at 1; additive/
 * count fields base at 0.
 * @type {Readonly<Object<string, number>>}
 */
export const PLAYER_STATS_BASE = Object.freeze({
  // Global fire modifiers (Overcharge, Story 10.2 — Spread Cannon's fire-rate rung).
  damageMult: 1,
  fireRateMult: 1,
  // Volley shape (Spread Cannon, Story 10.3). Both are ADDITIVE/COUNT fields, so they
  // base at 0 — no Spread Cannon owned means the pre-10.3 single-bullet volley, and
  // FiringSystem treats any sanitized ways < 2 as that single shot.
  //  - spreadWays   : bullets emitted per volley.
  //  - spreadArcDeg : the volley's TOTAL cone angle in degrees, CENTERED on the aim
  //                   direction — NOT the gap between adjacent bullets. The bullets are
  //                   spaced evenly across it (3 ways / 12° → aim −6°, 0°, +6°), so the
  //                   odd shipped counts always keep one bullet exactly along aim.
  spreadWays: 0,
  spreadArcDeg: 0,
  // Movement + dash (Afterburner, Story 10.5). `moveSpeedMult` is a `*Mult` field
  // (base 1) that PlayerMovementSystem applies to BOTH its thrust acceleration and its
  // speed cap; the four `dash*` fields are ADDITIVE/COUNT fields (base 0 — no
  // Afterburner owned means the pre-10.5 movement path exactly, and no dash).
  //
  // These are the DERIVED PARAMETERS only. The live cooldown, the active window and the
  // dash direction are RUNTIME state on systems/DashSystem.js, for exactly the reason
  // the shield's live charge count is: this fold RESETS every field and re-derives the
  // whole store on EVERY card pick, so a live timer kept here would be refunded by
  // picking any unrelated item (a free dash once per level).
  //  - moveSpeedMult  : the fractional movement-speed bonus (0.2 = +20%).
  //  - dashCooldownMs : the interval (ms) that GATES a dash. ⚠ Like shieldRechargeMs it
  //                     folds ADDITIVELY, so a hypothetical SECOND dash-bearing item
  //                     would make the dash SLOWER, not faster (3000 + 2000 = 5000ms).
  //                     No such item exists — Afterburner is the only dash item — but an
  //                     Epic 11/12 author adding one must fold a RATE or a fractional
  //                     `*Mult` instead of stacking another interval here. It is also
  //                     the dash's ENABLE flag: DashSystem fails CLOSED on 0/junk, so a
  //                     build with no interval owns no dash (which is why Lv1 has none).
  //  - dashIFrames    : the Lv3+ invulnerability FLAG (>= 1 enables), mirroring
  //                     shieldKnockback.
  //  - dashDamage     : the Lv4+ contact-damage FLAG (>= 1 enables). The MAGNITUDE lives
  //                     in the DASH_CONTACT_DAMAGE constant, not here, so a second
  //                     dash-bearing item could never double it.
  //  - dashTrail      : the Lv5 burning-trail FLAG (>= 1 enables). Cosmetic only.
  moveSpeedMult: 1,
  dashCooldownMs: 0,
  dashIFrames: 0,
  dashDamage: 0,
  dashTrail: 0,
  // Defense (Nanite Shield, Story 10.4). All three are ADDITIVE/COUNT fields, so they
  // base at 0 — no Nanite Shield owned means the pre-10.4 death path exactly.
  //  - shieldCharges    : the MAXIMUM number of absorb charges, NOT the live count.
  //                       The live count and the recharge timer are RUNTIME state on
  //                       systems/NaniteShieldSystem.js, deliberately: this fold RESETS
  //                       every field and re-derives the whole store on EVERY card pick,
  //                       so a live count kept here would be silently restored to full by
  //                       picking any unrelated item — a free shield reset once per level.
  //  - shieldRechargeMs : the interval (ms) that regenerates ONE charge. ⚠ This folds
  //                       ADDITIVELY like every other non-`Mult` field, so a hypothetical
  //                       SECOND recharge-bearing item would make the shield SLOWER, not
  //                       faster (20000 + 15000 = 35000ms). No such item exists — Nanite
  //                       Shield is the only shield item — but an Epic 11/12 author adding
  //                       one must fold a RATE (charges/sec) or a fractional `*Mult`
  //                       instead of stacking another interval here.
  //  - shieldKnockback  : the Lv5 break-pulse flag (>= 1 enables it).
  shieldCharges: 0,
  shieldRechargeMs: 0,
  shieldKnockback: 0,
  // Orbit Blade (Story 11.1). The first Epic-11 EXOTIC item: a ring of rotating melee
  // blades. `orbitBladeCount`/`orbitBladeDamage`/`orbitBladePeriodMs` are ADDITIVE/COUNT
  // fields (base 0 — no Orbit Blade owned means NO blades and no sweep, exactly the
  // pre-11.1 behavior), while `orbitBladeRadiusMult` is a `*Mult` field (base 1).
  //
  // These are the DERIVED PARAMETERS only. The live rotation PHASE and the blade POOL
  // are RUNTIME state on systems/OrbitBladeSystem.js, for exactly the reason the shield's
  // live charge count and the dash's live window are: this fold RESETS every field and
  // re-derives the whole store on EVERY card pick, so a live phase/pool kept here would
  // be reset by picking any unrelated item.
  //  - orbitBladeCount    : the number of live blades (1..5 shipped). ⚠ Like every other
  //                         non-`Mult` field it folds ADDITIVELY, so a hypothetical SECOND
  //                         blade-count item would ADD blades. Orbit Blade is the only such
  //                         item; an Epic-11/12 author adding one must fold a RATE or a
  //                         `*Mult`, not stack another count here.
  //  - orbitBladeDamage   : per-blade contact damage, routed through the shared
  //                         CollisionSystem.applyPlayerDamage seam (so armor/scoring/XP
  //                         behave exactly as for a bullet). 90/90/90/126/126 shipped.
  //  - orbitBladePeriodMs : rotation period (ms per full revolution). An ABSOLUTE INTERVAL
  //                         onto a base of 0, NEVER a fraction (the same authoring rule
  //                         shieldRechargeMs / dashCooldownMs follow). A smaller value
  //                         spins FASTER. It is also the presence signal for a valid spin:
  //                         OrbitBladeSystem fails safe to a base period on 0/junk.
  //  - orbitBladeRadiusMult: the Lv5 +25% ring-radius bonus (`*Mult`, base 1).
  orbitBladeCount: 0,
  orbitBladeDamage: 0,
  orbitBladePeriodMs: 0,
  orbitBladeRadiusMult: 1,
  // Seeker Drones (Story 11.2). The second Epic-11 EXOTIC item: autonomous shooters
  // that ride a ring around the ship and fire pooled shots at the nearest enemy. All
  // four fields are ADDITIVE/COUNT fields (base 0 — no Seeker Drones owned means NO
  // drones, NO shots and no target scan, exactly the pre-11.2 behavior).
  //
  // These are the DERIVED PARAMETERS only. The live drone POOL, the shot POOL, the
  // per-drone fire accumulators and the ring's rotation PHASE are RUNTIME state on
  // systems/SeekerDroneSystem.js, for exactly the reason the shield's live charge count,
  // the dash's live window and the blade's live phase are: this fold RESETS every field
  // and re-derives the whole store on EVERY card pick, so a live timer/pool kept here
  // would be reset by picking any unrelated item.
  //  - seekerDroneCount    : the number of live drones (1..5 shipped). ⚠ Like every other
  //                          non-`Mult` field it folds ADDITIVELY, so a hypothetical
  //                          SECOND drone-count item would ADD drones. Seeker Drones is
  //                          the only such item; an Epic-11/12 author adding one must fold
  //                          a RATE or a `*Mult`, not stack another count here.
  //  - seekerDroneDamage   : per-shot damage, routed through the shared
  //                          CollisionSystem.applyPlayerDamage seam. A shot is a
  //                          PROJECTILE, so the armored archetype resists it exactly as it
  //                          resists a bullet (intended). 3/3/3/3/4.8 shipped.
  //  - seekerDronePeriodMs : the fire period (ms between a drone's shots). An ABSOLUTE
  //                          INTERVAL onto a base of 0, NEVER a fraction (the same
  //                          authoring rule shieldRechargeMs / orbitBladePeriodMs follow).
  //                          A smaller value fires FASTER. It is also the presence signal
  //                          for a valid cadence: SeekerDroneSystem fails safe to a base
  //                          period on 0/junk. 1500/1500/1071/1071/1071 shipped.
  //  - seekerDroneHoming   : the Lv4+ homing FLAG (>= 1 enables) — a shot re-aims toward
  //                          the nearest enemy each fixed step. Off (0) below Lv4.
  seekerDroneCount: 0,
  seekerDroneDamage: 0,
  seekerDronePeriodMs: 0,
  seekerDroneHoming: 0,
  // Mine Layer (Story 11.3). The third Epic-11 EXOTIC item and the first AoE-detonation
  // entity: the kiting ship drops timed mines that arm, then detonate on an approaching
  // enemy. Four are ADDITIVE/COUNT fields and one (`minePull`/`mineChain`) is a FLAG — all
  // base at 0, so no Mine Layer owned means NO drops, no detonation and no pull (exactly
  // the pre-11.3 behavior).
  //
  // These are the DERIVED PARAMETERS only. The live mine POOL and the drop ACCUMULATOR are
  // RUNTIME state on systems/MineLayerSystem.js, for exactly the reason the shield's live
  // charge count, the dash's live window, the blade's live phase and the drone's live pool
  // are: this fold RESETS every field and re-derives the whole store on EVERY card pick, so
  // a live timer/pool kept here would be reset by picking any unrelated item.
  //  - mineDropPeriodMs   : the interval (ms) between mine drops AND the OWNERSHIP GATE —
  //                         0 means unowned (no drops at all), which is why it bases at 0.
  //                         An ABSOLUTE INTERVAL onto a base of 0, never a fraction (the
  //                         same authoring rule shieldRechargeMs / orbitBladePeriodMs /
  //                         seekerDronePeriodMs follow). A smaller value drops FASTER.
  //                         ⚠ Like every other non-`Mult` field it folds ADDITIVELY, so a
  //                         hypothetical SECOND mine-drop item would make drops SLOWER; Mine
  //                         Layer is the only such item — an Epic-12 author adding one must
  //                         fold a RATE or a `*Mult`, not stack another interval.
  //  - mineCap            : the MAXIMUM live mine count (10..12 shipped). When a drop would
  //                         exceed it the OLDEST live mine is evicted first. Clamped to
  //                         MINE_MAX_CAP against a corrupted fold.
  //  - mineDetonateRadius : the blast radius (px) STAMPED on each new mine at drop, routed
  //                         through the shared applyPlayerDamage seam so armor/scoring/XP
  //                         behave exactly as for a bullet. 60/100/100/100/100 shipped.
  //  - minePull           : the Lv4+ pull FLAG (>= 1 enables) — an armed mine drags nearby
  //                         combat enemies inward each tick. Off (0) below Lv4.
  //  - mineChain          : the Lv5 chain FLAG (>= 1 enables) — a detonation chains to
  //                         adjacent armed mines. Off (0) below Lv5.
  mineDropPeriodMs: 0,
  mineCap: 0,
  mineDetonateRadius: 0,
  minePull: 0,
  mineChain: 0,
  // Piercing Lance (Story 11.4). The fourth Epic-11 EXOTIC item and the first PIERCING
  // projectile: a slow, heavy bolt auto-fired on a cadence FROM the ship TOWARD the nearest
  // combat enemy that punches THROUGH a line of enemies (pierce 2 → 7). Three are
  // ADDITIVE/COUNT fields and two (`lanceTrail`/`lanceBackward`) are FLAGS — all base at 0, so
  // no Piercing Lance owned means NO bolts, no pierce and no trail (exactly the pre-11.4
  // behavior).
  //
  // These are the DERIVED PARAMETERS only. The live bolt POOL, the trail-node POOL and the
  // fire ACCUMULATOR are RUNTIME state on systems/PiercingLanceSystem.js, for exactly the
  // reason the shield's live charge count, the dash's live window, the blade's live phase, the
  // drone's live pool and the mine's live pool are: this fold RESETS every field and
  // re-derives the whole store on EVERY card pick, so a live timer/pool kept here would be
  // reset by picking any unrelated item.
  //  - lancePeriodMs  : the interval (ms) between bolt cadences AND the OWNERSHIP GATE —
  //                     0 means unowned (no bolts at all), which is why it bases at 0. An
  //                     ABSOLUTE INTERVAL onto a base of 0, never a fraction (the same
  //                     authoring rule shieldRechargeMs / seekerDronePeriodMs / mineDropPeriodMs
  //                     follow). A smaller value fires FASTER. ⚠ Like every other non-`Mult`
  //                     field it folds ADDITIVELY, so a hypothetical SECOND lance-cadence item
  //                     would make bolts SLOWER; Piercing Lance is the only such item — an
  //                     Epic-12 author adding one must fold a RATE or a `*Mult`.
  //  - lancePierce    : the number of distinct enemies ONE bolt punches through (2 → 7). A
  //                     bolt spends one charge per distinct enemy, then is released. Clamped to
  //                     an integer in [1, LANCE_MAX_PIERCE] against a corrupted fold.
  //  - lanceDamage    : per-bolt damage, routed through the shared
  //                     CollisionSystem.applyPlayerDamage seam. A bolt is a PROJECTILE, so the
  //                     armored archetype resists it exactly as it resists a bullet — the
  //                     Lv3 +50% (4 → 6) one-shots armored (hp 5) by MAGNITUDE, not by an
  //                     armor-bypass classification. 4/4/6/6/6 shipped.
  //  - lanceTrail     : the Lv4+ trail FLAG (>= 1 enables) — a bolt drops a 0.5s lingering
  //                     damage trail along its path. Off (0) below Lv4.
  //  - lanceBackward  : the Lv5 backward FLAG (>= 1 enables) — a second bolt fires antipodal
  //                     (backward) each cadence. Off (0) below Lv5.
  lancePeriodMs: 0,
  lancePierce: 0,
  lanceDamage: 0,
  lanceTrail: 0,
  lanceBackward: 0,
  // Ricochet Rounds (Story 11.5). The fifth Epic-11 EXOTIC item and the first BASE-GUN
  // MODIFIER of the epic: it makes the player's ORDINARY bullets bounce off the arena walls
  // (and, higher up, enemies) instead of despawning at the border. Unlike the four prior
  // Epic-11 items — each a SEPARATE pooled system reading a DERIVED-PARAMETER fold — Ricochet
  // has NO runtime system state of its own: the four fields below are folded here and STAMPED
  // onto each bullet at spawn (like `damage`), so an in-flight bullet keeps the behaviour it
  // was fired with. All four are ADDITIVE/COUNT fields (base 0 — no Ricochet owned means the
  // pre-11.5 gun exactly: a bullet despawns at the border and is consumed on its first hit).
  //  - ricochetBounces      : the bounce BUDGET a bullet is stamped with (1 → 2 → 4) AND the
  //                           OWNERSHIP GATE — a bullet stamped with 0 behaves byte-identically
  //                           to pre-11.5. A single budget spent by wall AND enemy reflections
  //                           alike. ⚠ Like every other non-`Mult` field it folds ADDITIVELY;
  //                           Ricochet is the only bounce-budget item, so an Epic-12 author
  //                           adding one must fold a `*Mult`, not stack another count here.
  //                           Clamped to an integer in [0, RICOCHET_MAX_BOUNCES] against a
  //                           corrupted fold (systems/ricochet.js).
  //  - ricochetDmgPerBounce : the per-bounce damage-growth FRACTION (0.25 = +25%/bounce),
  //                           NOT a `*Mult` field — it bases at 0 and is written as the plain
  //                           fraction. Growth is `damage *= 1 + this` per reflection event
  //                           (wall OR enemy), compounding on the bullet's current stamped
  //                           damage. Clamped to RICOCHET_DMG_PER_BOUNCE_MAX against junk.
  //  - ricochetOffEnemies   : the Lv4+ enemy-bounce FLAG (>= 1 enables) — a bullet with budget
  //                           left bounces OFF an enemy it hits (still dealing its damage)
  //                           instead of being consumed. Off (0) below Lv4.
  //  - ricochetSeek         : the Lv5 homing FLAG (>= 1 enables) — a bullet that has bounced at
  //                           least once re-aims toward the nearest combat enemy each fixed
  //                           step (speed preserved). Off (0) below Lv5.
  ricochetBounces: 0,
  ricochetDmgPerBounce: 0,
  ricochetOffEnemies: 0,
  ricochetSeek: 0,
  // Flak Burst (Story 11.6). The sixth Epic-11 EXOTIC item and second BASE-GUN MODIFIER of
  // the epic: it turns every Nth bullet fired by the player into an airburst shell that detonates
  // on enemy impact or wall contact into a radial cluster of fragments. All four fields are
  // folded here and STAMPED onto each bullet at spawn when `flakCadence > 0` (the ownership gate).
  // All four are ADDITIVE/COUNT fields (base 0 — no Flak Burst owned means the pre-11.6 gun).
  //  - flakCadence           : cadence N (5 → 4 → 4 → 3 → 3) AND ownership gate (0 = unowned).
  //  - flakFragments         : primary fragment count per airburst (6 → 8 → 8 → 12 → 12).
  //  - flakDamageMult        : fragment damage multiplier fraction (0.5 = +50% at Lv3+).
  //  - flakSecondaryAirburst : Lv5 secondary airburst FLAG (>= 1 enables) — primary fragments
  //                            airburst once on hit or expiration into 4 sub-fragments.
  flakCadence: 0,
  flakFragments: 0,
  flakDamageMult: 0,
  flakSecondaryAirburst: 0,
  // Gravity Well (Story 11.7). The seventh Epic-11 EXOTIC item and third DEFENSE item:
  // extends the XP pickup radius, adds orb homing, scales base XP orb value, and nudges
  // nearby enemies toward active orbs.
  //  - xpPickupRadiusMult     : multiplier for XP_PICKUP_RADIUS (base 1 -> 1.4x at Lv1, 1.8x at Lv2-4, 2.5x at Lv5).
  //  - gravityWellHoming      : Lv3+ homing FLAG (>= 1 enables 540 px/s orb homing within pickup radius).
  //  - xpValueMult            : multiplier for base orb XP value on collect (base 1 -> 1.25x at Lv4+).
  //  - gravityWellPullEnemies : Lv5+ pull FLAG (>= 1 enables active XP orbs pulling nearby combat enemies).
  xpPickupRadiusMult: 1,
  gravityWellHoming: 0,
  xpValueMult: 1,
  gravityWellPullEnemies: 0,
  // Reinforced Hull (Story 11.8 / PRD §13.4). Defense item: +max lives, respawn i-frames, and 50% multiplier reset.
  //  - extraLives            : count of extra max lives granted (+1 at Lv1, Lv3, Lv5).
  //  - respawnIFramesMs      : additional respawn i-frames duration in ms (1500ms at Lv2+).
  //  - softenMultiplierReset : Lv4+ flag (>= 1 enables 50% multiplier drop on death instead of 1x).
  extraLives: 0,
  respawnIFramesMs: 0,
  softenMultiplierReset: 0,
  // Bomb Capacitor (Story 11.9 / PRD §13.4). Defense item: smart bomb progression.
  //  - extraBombs         : count of extra smart bombs granted (+1 at Lv1, +1 at Lv3, +2 at Lv5).
  //  - bombRadiusMult     : multiplier bonus for shockwave radius (1.3x at Lv1+).
  //  - bombAwardInterval  : score threshold interval for +1 bomb award (75k at Lv2+, 50k at Lv4+).
  //  - bombStunMs         : stun duration (ms) for surviving enemies at Lv3+ (2000ms).
  //  - bombXpOrbs         : count of XP orbs dropped on detonation at Lv4+ (5 orbs).
  //  - bombDamageFieldMs  : duration (ms) of lingering damage field at Lv5 (3000ms).
  extraBombs: 0,
  bombRadiusMult: 1,
  bombAwardInterval: 0,
  bombStunMs: 0,
  bombXpOrbs: 0,
  bombDamageFieldMs: 0,
  // Chrono Field (Story 11.10 / Epic 11). Defense item: time-dilation slow aura.
  //  - chronoSlowPercent  : additive/count field, base 0. Fractional slow percent (0.2 = 20% slow).
  //                         Effective velocity = baseSpeed × (1 - chronoSlowPercent). Clamped
  //                         to [0, CHRONO_SLOW_FACTOR_MAX] (0.99) so enemies never reach zero
  //                         velocity. Multiple slow sources stack additively.
  //  - chronoSlowBullet   : FLAG (>= 1 enables slow for enemy bullets). Currently a gated
  //                         no-op since no enemy bullet system exists in the shipped codebase.
  //  - chronoSlowWorld    : FLAG (>= 1 enables slow for world systems — Black Hole growth/shrink
  //                         and Mirror Reflector spin rate). Off at base; enabled at Lv5.
  chronoSlowPercent: 0,
  chronoSlowBullet: 0,
  chronoSlowWorld: 0,
});



/**
 * The base value for a stat key not present in PLAYER_STATS_BASE — inferred from the
 * naming convention so the fold is robust to stat keys a later story adds to an item's
 * `stats` before wiring the field into PLAYER_STATS_BASE: a `*Mult` field bases at 1,
 * everything else (additive/count) at 0.
 * @param {string} key
 * @returns {number}
 */
function baseFor(key) {
  return key.endsWith('Mult') ? 1 : 0;
}

/**
 * Create the base player-stat store: every PLAYER_STATS_BASE field at its base value.
 * A fresh independent object per call (run-scoped, like the other state factories).
 * @returns {Object<string, number>}
 */
export function createPlayerStats() {
  const ps = {};
  for (const k in PLAYER_STATS_BASE) ps[k] = PLAYER_STATS_BASE[k];
  return ps;
}

/**
 * Look up an item definition by id within the PASSED registry (not the module-level
 * one), so a synthetic-fixture registry can drive the fold in tests.
 * @param {ReadonlyArray<{ id: string }>} registry
 * @param {string} id
 */
function findInRegistry(registry, id) {
  for (let i = 0; i < registry.length; i++) {
    if (registry[i].id === id) return registry[i];
  }
  return undefined;
}

/**
 * Recompute the player-stat store from the owned build (a PURE, in-place fold, run
 * ONLY on a level change): reset every base field to its base, then add each owned
 * item's CURRENT-LEVEL `stats` contribution additively. Per-level `stats` entries are
 * TOTALS-at-that-level (not deltas summed across levels), so only the current level is
 * read. Allocates nothing per call beyond reuse of the passed object.
 *
 * Determinism: the same owned set + registry always yields the identical store.
 * Level cap: a level above the item's maxLevel reads the maxLevel entry (defensive —
 * applyCard already caps), and never past the last AUTHORED level entry.
 * @param {Object<string, number>} playerStats The store to mutate in place.
 * @param {Object<string, number>} ownedCards  id → owned count (the item level).
 * @param {ReadonlyArray<{ id: string, maxLevel: number,
 *   levels: ReadonlyArray<{ stats: Object<string,number> }> }>} registry
 * @returns {Object<string, number>} the same, mutated, playerStats object.
 */
export function recomputePlayerStats(playerStats, ownedCards, registry) {
  // Reset to base. First clear EVERY key currently on the object to its
  // convention base (Mult→1, else→0) — so a non-base key introduced by a prior
  // fold's `baseFor` safety net (a stat a later story added to an item before wiring
  // it into PLAYER_STATS_BASE) returns to its base each recompute instead of
  // compounding — then overlay the explicit base values for the known fields.
  for (const k in playerStats) playerStats[k] = baseFor(k);
  for (const k in PLAYER_STATS_BASE) playerStats[k] = PLAYER_STATS_BASE[k];
  if (!ownedCards || !registry) return playerStats;
  for (const id in ownedCards) {
    const level = ownedCards[id];
    if (!(level >= 1)) continue;
    const item = findInRegistry(registry, id);
    if (!item) continue;
    // A definition with no authored `levels` array contributes nothing. Guarded because
    // the clamp below dereferences `levels.length` twice: a partially-authored item (or a
    // duck-typed `{ id, track, maxLevel }` fixture) would otherwise throw a TypeError
    // INSIDE the fixed-step tick, killing the sim loop on the pick that owns it.
    if (!Array.isArray(item.levels) || item.levels.length === 0) continue;
    // Clamp by BOTH the declared cap and the number of authored level entries: a
    // definition whose maxLevel outruns its `levels` array (an authoring slip a later
    // item story can introduce) must fall back to its LAST authored level, not read
    // past the end — an undefined entry would silently drop the item's whole
    // contribution instead of clamping.
    const cap = item.maxLevel ?? item.levels.length;
    const idx = Math.min(level, cap, item.levels.length) - 1;
    const entry = item.levels[idx];
    const stats = entry && entry.stats;
    if (!stats) continue;
    for (const k in stats) {
      // Additive fold onto the base; a key not in PLAYER_STATS_BASE gets its
      // convention-inferred base so the add never lands on undefined (→ NaN).
      if (playerStats[k] === undefined) playerStats[k] = baseFor(k);
      playerStats[k] += stats[k];
    }
  }
  return playerStats;
}
