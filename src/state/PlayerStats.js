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
// — the fold owns only the derived MAXIMA (see the field comments below). Afterburner
// (10.5) is the last item still carrying empty `stats` maps — the framework is real;
// those item numbers are its story's job.
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
  // Movement (Afterburner, Story 10.5).
  moveSpeedMult: 1,
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
