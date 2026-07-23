---
title: 'Story 10.1: Item & Upgrade Framework'
type: 'feature'
created: '2026-07-23'
status: done
baseline_revision: 'c9b46c1d865baa484419c3d33beada80ba72c44d'
final_revision: 'a9096988e1df90e781dc8451d9966c8be4de607c'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The level-up draft (Epic 8) offers `PLACEHOLDER_CARDS` (`{id,title,statDelta,rarity,track}`) whose only effect is bumping a debug counter; there is no data-driven item definition, no per-level effect model, no runtime player-stat store, and no owned/maxed/remnant/slot state that the upgrade and (future) fusion systems can share. Adding items would mean new plumbing each time.

**Approach:** Introduce a single data-driven item registry (the one definition the offer, on-pick application, owned-state, and current level all read from), a runtime `PlayerStats` modifier store with an on-change fold that applies an owned item's current-level effect deltas (zero per-frame allocation), and framework state/queries for owned/level/maxed/Lv3-remnant/slot-occupancy exposed to offer weighting and fusion checks. This story lays the framework and swaps the placeholder pool for the registry; each item's gameplay-seam wiring and effect numbers land in its own story (10.2–10.5).

## Boundaries & Constraints

**Always:**
- Exactly one definition per item is the source of truth: the card offer, on-pick application, owned-state, and current level all read from it. Registry entries are duck-compatible with the existing card shape — they carry `id`, `rarity`, `track` (so `cardOffer`/`LevelUpSystem` keep working) plus `name`, `maxLevel` (5), `levels` (five per-level effect descriptors), and `fusion` (`{partner, epic}` or `null`).
- An item's level is its owned count (`ownedCards[id]`), capped at `maxLevel`. Upgrading increments the level and re-applies effects via the `PlayerStats` fold.
- The `PlayerStats` fold is pure and in-place: it resets each field to its base then adds every owned item's **current-level** `stats` contribution (multiplier fields base `1`, additive/count fields base `0`). It runs only on a level change (on-pick), never per frame, and allocates nothing per call beyond reuse of the passed object.
- Preserve the existing weighted-draw formula, determinism (same rng + eligible pool → identical result), and the reroll/banish behavior. Maxed items (`level >= maxLevel`) and remnant items get weight `0` (never offered); slot-full unowned same-track items keep weight `0` as today.
- The offer contains **only eligible (positive-weight) cards** — at most `CARD_OFFER_SIZE`, drawn by the weighted-without-replacement formula, and **never padded** with an excluded (banished / maxed / remnant / slot-full-unowned) card to reach a count. When fewer than `CARD_OFFER_SIZE` cards are eligible the offer is **short** (2, 1, or 0 cards); an excluded card is never shown. This resolves the former "exactly-`CARD_OFFER_SIZE`" invariant, which was unsatisfiable against Story 8.5 banish-permanence once ≥2 of the 4 Epic-10 items are excluded — count-safety must never win over exclusion purity.
- An **empty** eligible pool (0 cards — e.g. every owned item maxed, or all banished) **auto-drains** the owed pick(s): the pending selection count goes to `0` with **no card applied**, the overlay closes, and normal play resumes with the usual landing invulnerability. The player is never held invulnerable on an empty overlay.
- Slot occupancy (distinct owned per track) is computed by one shared helper read by both `cardOffer` and the exposed fusion/query surface — not duplicated.

**Block If:**
- The framework cannot preserve deterministic-draw byte-for-byte parity for the existing offer scenarios (owned/unowned/slot-full/banish) **that have at least `CARD_OFFER_SIZE` eligible cards** while adding maxed/remnant handling and variable-size (short/empty) offers.

**Never:**
- Do NOT wire item effects into `FiringSystem`, `PlayerMovementSystem`, `CollisionSystem`, or `PlayerDeathSystem`, and do NOT author the four items' real per-level effect numbers or behaviors (spread pattern, dash, shield-vs-life, damage/fire-rate consumption). Those are stories 10.2–10.5. The four items register with metadata + human `desc` per level + empty `stats: {}` maps.
- Do NOT implement fusion consumption (Epic 12) — only track and expose remnant state.
- Do NOT introduce per-frame allocation in any hot loop, and do NOT change Phaser/render code beyond the existing DEV readout staying functional — **EXCEPT** the minimal change to render a short offer: the level-up overlay must draw only as many card panels as the offer holds (0–`CARD_OFFER_SIZE`) and its focus navigation must clamp/wrap to the current offer length instead of a hardcoded 3. The overlay already gates each panel on `i < offer.length`; the only fixes needed are the focus-wrap modulus and letting the empty-offer case close cleanly. No other render change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register + offer reads definition | Registry with an item; empty progression | `drawCardOffer` draws that item using its `rarity`/`track` from the definition; owned-state/level read `ownedCards[id]` | No error expected |
| Upgrade owned item | Item owned at level N (N < maxLevel), pick its card | Level → N+1; fold sets `PlayerStats` to base + all owned items' current-level `stats` | No error expected |
| Level cap | Item owned at level == maxLevel, pick applied | Level stays at maxLevel (no increment past cap) | Guarded no-op; no throw |
| Maxed item offer | Item at `level >= maxLevel` | `cardWeight` returns 0 → never offered as an upgrade | No error expected |
| Remnant item | Item marked remnant (frozen at Lv3) | `isRemnant` true, level == 3, `cardWeight` returns 0 (excluded); state exposed via query | No error expected |
| Slot occupancy exposed | Owned items across tracks | Shared `slotOccupancy` returns distinct-owned per track; offer weighting and fusion query read the same value | No error expected |
| Fold determinism / no per-frame alloc | Same owned set folded twice | Identical `PlayerStats`; fold invoked only on pick, not each tick | No error expected |
| Short offer (< 3 eligible) | Fewer than `CARD_OFFER_SIZE` items eligible — e.g. 4-item registry with 2 banished (reproduces the escalation: banish `overcharge` + `nanite-shield`) | `drawCardOffer` returns **only** the eligible cards (here 2) in draw order — **no** excluded card padded in; overlay renders exactly that many panels; focus nav clamps to the count; a pick applies normally | No error; no throw on the shorter array |
| Empty offer (0 eligible) | No eligible items — all owned maxed, or all banished | `drawCardOffer` returns `[]`; the owed selection(s) **auto-drain** (`pendingSelections → 0`), **no** card applied; overlay closes; landing invulnerability granted as on a normal final pick | No error; never held invulnerable on an empty overlay |

</intent-contract>

## Code Map

- `src/config/cards.js` -- current `PLACEHOLDER_CARDS` pool; retired/replaced by the registry (delete or empty; remove its live import).
- `src/config/itemRegistry.js` -- NEW: `ITEM_REGISTRY`, definition shape, `getItem(id)`, `getItemsByTrack(track)`.
- `src/state/PlayerStats.js` -- NEW: `createPlayerStats()` base store + `recomputePlayerStats(playerStats, ownedCards, registry)` fold.
- `src/state/ProgressionState.js` -- `createProgressionState` (add `remnantIds`); `applyCard` (cap at maxLevel, drop `statDelta`); NEW query/helpers.
- `src/systems/cardOffer.js` -- `cardWeight`/`drawCardOffer` read the definition, zero maxed/remnant, use the shared slot-occupancy helper.
- `src/systems/LevelUpSystem.js` -- inject registry (pool) + `playerStats`; recompute stats after a pick.
- `src/scenes/buildArenaWorld.js` -- construct `playerStats`; pass registry + `playerStats`; expose `playerStats` in the returned ctx.
- `src/config/constants.js` -- add `ITEM_MAX_LEVEL = 5`, `ITEM_REMNANT_LEVEL = 3`; reuse `SLOT_LIMIT_OFFENSE/DEFENSE`.
- `src/scenes/ArenaScene.js:1710` -- DEV readout reads `debugStat`; keep it functional (no behavior change required).
- `src/scenes/ArenaScene.js:903` -- level-up overlay focus nav (`moveCardFocus`, hardcoded `% 3`) + panel render (`i < offer.length`, already variable-safe): clamp/wrap focus to `currentOffer.length` for a short offer; empty offer closes via the sim-side auto-drain (overlay gated on `selectionActive`).

## Tasks & Acceptance

**Execution:**
- `src/config/itemRegistry.js` -- CREATE the data-driven registry: exported frozen `ITEM_REGISTRY` array of definitions `{ id, name, track:'offense'|'defense', rarity, maxLevel: ITEM_MAX_LEVEL, levels: [{ level, desc, stats }]×5, fusion: {partner, epic}|null }`, plus `getItem(id)` and `getItemsByTrack(track)`. Register the four Epic-10 items (Overcharge, Spread Cannon, Nanite Shield, Afterburner) with real id/name/track/rarity/fusion metadata and a five-entry `levels` array whose `desc` comes from the epic and whose `stats` is `{}` (each item's real effect numbers land in its own story). Freeze entries.
- `src/state/PlayerStats.js` -- CREATE `createPlayerStats()` returning the base modifier store (multiplier fields at `1`, additive/count fields at `0`) and `recomputePlayerStats(playerStats, ownedCards, registry)` that resets to base then adds each owned item's current-level `stats` contribution additively, mutating in place with no per-call allocation beyond the passed object.
- `src/state/ProgressionState.js` -- ADD `remnantIds: new Set()` to `createProgressionState`; change `applyCard(state, card)` to increment the owned count capped at `card.maxLevel` (no `statDelta`; keep `debugStat += 1` as a legacy pick counter for the DEV readout); ADD helpers `getLevel(state, id)`, `isOwned(state, id)`, `isMaxed(state, card)`, `isRemnant(state, id)`, `markRemnant(state, id)` (freezes level at `ITEM_REMNANT_LEVEL`, adds to `remnantIds`), and `slotOccupancy(state, registry)` returning distinct-owned counts per track.
- `src/systems/cardOffer.js` -- UPDATE `cardWeight` to return 0 when the item is maxed (`level >= card.maxLevel`) or remnant, and `drawCardOffer` to derive slot occupancy via the shared `slotOccupancy` helper; preserve the existing formula, ordering, and float-guard. **REMOVE the zero-weight fill safety net** — `drawCardOffer` returns **only** the drawn positive-weight (eligible) cards, a variable-length array of `0..CARD_OFFER_SIZE`, never padding with an excluded card. (This deletes the old "documented-unreachable exactly-three fill" that re-surfaced banished/excluded cards.)
- `src/systems/LevelUpSystem.js` -- ADD a registry (pool) constructor param and a `playerStats` param; draw from the injected registry instead of importing `PLACEHOLDER_CARDS`; after `applyCard` on a pick, call `recomputePlayerStats(playerStats, progressionState.ownedCards, registry)`. **Relax the exactly-three latch to a variable offer:** the pick guard accepts an offer of `1..CARD_OFFER_SIZE` (`currentOffer.length >= 1` and `index < currentOffer.length`); the reroll/banish guards require a non-empty offer (`>= 1`) instead of `=== 3`. **Empty-offer auto-drain:** in step (3), when a rebuild yields an **empty** offer while a selection is pending, drain ALL owed picks (`pendingSelections = 0`) with no `applyCard`, grant the landing invulnerability (as on a normal final pick), and close the overlay — never leave `pendingSelections > 0` with an empty `currentOffer` (which would hold the player invulnerable forever).
- `src/scenes/ArenaScene.js` -- UPDATE the level-up overlay for a variable offer: change the focus-navigation wrap from a hardcoded `% 3` to clamp/wrap against `currentOffer.length` (guarded when length is 0), so focus never lands on an unrendered panel. The panel render already gates on `i < offer.length`; no other overlay change.
- `src/scenes/buildArenaWorld.js` -- CREATE `playerStats` beside `playerState`/`progressionState`; pass the registry + `playerStats` into `LevelUpSystem`; expose `playerStats` in the returned ctx.
- `src/config/constants.js` -- ADD `ITEM_MAX_LEVEL = 5` and `ITEM_REMNANT_LEVEL = 3`.
- `src/config/cards.js` (+ `cards.test.js`) -- REMOVE `PLACEHOLDER_CARDS` from the live path (delete the file and its test, or empty it) once all importers point at the registry.
- `src/config/itemRegistry.test.js`, `src/state/playerStats.test.js`, `src/state/progressionState.test.js`, `src/systems/cardOffer.test.js`, `src/systems/levelUpSystem.test.js`, `src/scenes/buildArenaWorld.test.js` -- ADD/UPDATE unit tests covering every I/O & Edge-Case Matrix row (register→offer, upgrade+fold, level cap, maxed→weight 0, remnant→weight 0 + exposed, slot occupancy shared, fold determinism/no-alloc) plus regression parity for the existing deterministic-draw scenarios **that have ≥ `CARD_OFFER_SIZE` eligible cards**. ADD explicit coverage for the two variable-offer rows: (a) **short offer** — with 2 of 4 items banished, `drawCardOffer` returns exactly the 2 eligible cards and never the banished ids (the escalation's `overcharge` + `nanite-shield` repro must assert `overcharge` is absent), and the `LevelUpSystem` pick guard applies a 2-card offer; (b) **empty offer** — with 0 eligible items, `drawCardOffer` returns `[]` and a pending `LevelUpSystem` selection auto-drains to `pendingSelections === 0` with no `applyCard`, the overlay closes, and the landing invuln is granted. The former `cardOffer.test.js` maxed/remnant test that only exercised `cardWeight` must be strengthened to drive the full `drawCardOffer` path so an excluded card can never be padded back in undetected.

**Acceptance Criteria:**
- Given a registered item definition, when the draft offers and a player picks it, then the offer weighting, the applied effect, the owned flag, and the current level are all derived from that one definition (no second source of item data).
- Given an owned item below its cap, when it is upgraded via a card, then its level increments and `PlayerStats` equals the base folded with every owned item's current-level `stats` contribution, with the fold invoked only on the pick (not per frame).
- Given an item at `maxLevel` or marked as a Lv3 remnant, when the offer is drawn, then that item is never offered (weight 0) and its maxed/remnant/slot state is readable through the framework's query surface for offer weighting and fusion checks.
- Given the existing owned/unowned/slot-full/banish draw scenarios **that have at least `CARD_OFFER_SIZE` eligible cards**, when the offer is drawn with the same rng stream, then the result is byte-for-byte identical to the pre-framework behavior.
- Given fewer than `CARD_OFFER_SIZE` eligible items (e.g. banished/maxed down to two or one), when the offer is drawn, then it contains **only** those eligible cards — never an excluded card padded in to reach three — and the overlay renders exactly that many panels; a pick applies normally.
- Given **zero** eligible items, when a level-up is owed, then the offer is empty, the owed pick(s) auto-drain with no card applied, the overlay closes, and normal play resumes with the usual landing invulnerability (the player is never held invulnerable on an empty overlay).

## Spec Change Log

<!-- The original blocking finding was an intent_gap (root cause inside the intent-contract) escalated for human disambiguation rather than auto-repaired. -->

### 2026-07-23 — Intent-gap resolution (`/bmad-loop-resolve`, human: Wren)

**Escalation:** the intent-contract required BOTH "preserve the exactly-`CARD_OFFER_SIZE` (3) offer invariant" AND "excluded (banished/maxed/remnant) items are never offered" — unsatisfiable against Story 8.5 banish-permanence once ≥2 of the 4 Epic-10 items are excluded (reachable via the 2 starting banish charges). The reverted attempt kept the exactly-three zero-weight fill and re-surfaced a banished card (`overcharge`) as pickable.

**Decision (variable-size offers):** the exactly-`CARD_OFFER_SIZE` invariant is **dropped**. The offer contains only eligible cards, up to `CARD_OFFER_SIZE`; when fewer are eligible it is short (2 or 1), and an excluded card is **never** padded in. A **zero-eligible** offer **auto-drains** the owed pick(s) with no card applied and closes the overlay (no filler reward, no invulnerable stall). Encoded above in Boundaries (Always/Block If/Never), the I/O matrix (short-offer + empty-offer rows), the Acceptance Criteria, and the cardOffer / LevelUpSystem / ArenaScene tasks.

The attempted reading was **wrong** (it padded excluded cards back in), so the saved patch is not restored — the story re-drives from scratch against this corrected contract. The secondary findings noted in the Review Triage Log (remnant not re-upgradable via `applyCard`; `recomputePlayerStats` reset robust to later-story stat fields; `markRemnant` freeze-only; overlay `desc`/target-level render — deferred) fold into that re-derivation.

## Review Triage Log

### 2026-07-23 — Review pass (follow-up #2)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 15: (high 0, medium 6, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `recomputePlayerStats` (`src/state/PlayerStats.js`) dereferenced `item.levels.length` twice in the level clamp with no guard, so a definition carrying **no** `levels` array threw a `TypeError` **inside** `world.fixedUpdate` — killing the sim loop on the pick that owns the item. Reproduced directly (`recomputePlayerStats(ps, {x:1}, [{id:'x', maxLevel:3}])`); reachable both from a partially-authored 10.2–10.5 item and from the duck-typed `{id, track, maxLevel}` fixtures already in `progressionState.test.js`. This is the sibling of the maxLevel-outruns-`levels` clamp patched last pass — that one defended the *short* array, this one the *absent* array. Fixed: `if (!Array.isArray(item.levels) || item.levels.length === 0) continue;` before the clamp, plus a test proving the malformed entries contribute nothing while a well-formed sibling still folds (mutation-verified).
  - `[low]` `[patch]` The `playerStats` constructor slot (`src/systems/LevelUpSystem.js`, arg 5) had no type guard, so the *same* stale-arity trap the arg-4 guard was added to close remained open one slot over: `new LevelUpSystem(ls, ps, prog, ITEM_REGISTRY, rng)` passes the array check, binds the rng to `this.playerStats`, and silently defaults `rng` to `Math.random` — the offer leaves the seedable stream with nothing thrown, and the fold writes stat fields onto the rng function. Fixed: throw a `TypeError` naming the arg move when `playerStats` is present but not an object.
  - `[low]` `[patch]` The arg-4 `Array.isArray(registry)` guard added last pass was itself **unverified** — deleting it left the suite green, and with it gone a stale four-arg caller makes every draw empty while the new auto-drain silently swallows every owed pick for a whole run. Fixed: pinned both guards (throw on rng-at-slot-4 and rng-at-slot-5, plus the positive 6-arg and omitted-`playerStats` cases); each mutation-verified to fail its own test alone.
  - `[low]` `[patch]` The maxed/remnant predicates existed **twice** with divergent expressions and divergent type tolerance: `cardWeight` used `card.maxLevel != null && level >= card.maxLevel` plus a private `isRemnantId`, while the exposed query surface used `card.maxLevel ?? Infinity` and a `.has`-only `isRemnant`/`applyCard`. They agree on every input today, but nothing pinned that, so the offer and the query surface could drift into disagreeing about which items are excluded — in the story whose thesis is one definition per concept. Fixed: extracted `isMaxedAtLevel(level, card)` and the tolerant `hasRemnant(idSet, id)` primitives in `ProgressionState.js`; `isMaxed`, `isRemnant`, `applyCard` and `cardWeight` all route through them and the `isRemnantId` duplicate is deleted. Mutation-verified: neutering either primitive fails tests in **both** `cardOffer.test.js` and `progressionState.test.js`, so the adoption is load-bearing on both surfaces. Also closes the `remnantIds` type-contract split (cardOffer documented Set-or-array tolerance while `applyCard`/`isRemnant` would throw on an array).
  - `[low]` `[patch]` The `stats` authoring convention was ambiguous in exactly the way that produces a silent balance bug: `*Mult` field naming plus JSDoc calling each entry the "TOTAL modifier map" invites `damageMult: 1.15` for "+15% damage", which folds onto base 1 to give **2.15×** — and every test still passes, because all four shipped items carry empty `stats`. Fixed (docs only): an explicit AUTHORING CONVENTION block in `PlayerStats.js` with the correct/wrong pair, a note that "TOTALS-at-that-level" refers to levels rather than to the base, and the additive multi-item stacking rule stated as deliberate.
  - `[low]` `[patch]` `markRemnant` (`src/state/ProgressionState.js`) is the one level-mutating function that is **not** a fold trigger — it clamps a level from Lv5 to Lv3 while `recomputePlayerStats` runs only on a card pick, so a fusion-consumed item keeps applying its Lv5 modifiers until the next pick, which (once the eligible pool is exhausted) may never come. Correct per this story's intent, which scopes fusion consumption to Epic 12 and has no production caller yet, but the trap is invisible at the call site. Fixed (docs only): the caller contract now states the re-fold obligation explicitly and points at `recomputePlayerStats`.

Deferred finding (medium): the per-track slot-limit mechanic is unreachable against the shipped 2+2 registry (`SLOT_LIMIT_OFFENSE=5`/`DEFENSE=4`) and the deleted `cards.test.js` carried the only pool-size-vs-limit invariant, which cannot be restored without failing. Three layers converged on it independently. Not fixable inside this story's intent (the four-item registry is mandated, the limits are reused "as today"); logged to `deferred-work.md` as a new entry to re-establish against the shipped registry once Epic 10–12 land more items.

Rejected (15): empty-offer silent auto-drain with no player feedback, the invuln grant on a drained level-up, and banishing the last eligible card draining all owed picks (all three are the human-resolved intended behavior per the Spec Change Log — the intent states the owed pick(s) drain and "normal play resumes with the usual landing invulnerability"); reroll spending a charge on a provably identical redraw (empirically confirmed over 200 draws, but refusing the spend would *change* the reroll behavior the intent says to preserve, and it is content-scale — it resolves as Epic 10–12 land items); the composed run-length trajectory (short offers becoming the mid-run norm, drain becoming terminal) being untested end-to-end — a design question the intent asked and answered; `drawCardOffer` not reading `progressionState.banishedIds` (documented last pass, both production callers thread it explicitly, and defaulting it would contradict the `banishedIds default (omitted)` regression pin deliberately restored last pass); `debugStat += 1` before the guards (DEV-only readout, unreachable in the live path); the dead query API with no production caller (deliberate Epic 12 plumbing per "track and expose" — and `isMaxed`/`isRemnant` now have one via the patch above); dangling `piercing-lance`/sentinel fusion partners (Epic 12 owns consumption); deleting `title` and rendering `name` instead (another render change, excluded by the `Never` clause; the `title === name` pin already prevents drift); the unrendered per-level `desc` and the left-aligned short offer (both already logged to `deferred-work.md` in prior passes — not re-deferred); VG15–VG17 asserting on source text rather than behavior (the file's established VG1–VG14 convention for Phaser-coupled code; the proposed extraction is a render refactor the intent excludes); the fold's arithmetic being pinned only by synthetic fixtures (inherent — the intent mandates empty `stats` on all four items); and the pointer hit-test clamp exceeding the `Never` clause's literal two-item render allowance (the clause states one clear goal — focus must never land on an unrendered panel — and the pointer path is part of that same focus surface, so there is exactly one reading and no intent gap).

### 2026-07-23 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 2, low 7)
- defer: 1: (high 0, medium 1, low 0)
- reject: 16: (high 0, medium 4, low 12)
- addressed_findings:
  - `[medium]` `[patch]` Five regression tests were deleted for behavior this story never changed, and the deletions were not forced by the pool swap (the intent-alignment layer restored three verbatim and they passed). Mutation-verified live hole: gating the step-(2) enqueue on `!selectionActive` — which silently eats a pick owed from a level crossed while the overlay is open — passed the whole suite. Fixed: restored `level-up mid-selection`, `multi-pick reroll`, `multi-pick banish`, `reroll no re-grant at level 20` (`levelUpSystem.test.js`) and `banishedIds default (omitted)` (`cardOffer.test.js`); re-confirmed the enqueue mutation now fails.
  - `[medium]` `[patch]` `recomputePlayerStats` (`src/state/PlayerStats.js`) clamped the level index by `maxLevel` alone, so a definition whose `maxLevel` outruns its authored `levels` array indexed past the end and the undefined-entry guard dropped that item's **entire** contribution instead of clamping — a silent total loss of its effects, in exactly the authoring shape stories 10.2–10.5 will produce. Fixed: clamp by `Math.min(level, cap, item.levels.length)`; added a short-registry fold test (mutation-verified).
  - `[low]` `[patch]` The three render-side sites the variable-length offer made load-bearing had zero coverage — all three mutation-verified to ship green. Fixed: added VG15 (focus wraps against `currentOffer.length`, plus the not-`% 3` negative and the `len <= 0` guard), VG16 (both pointer hit-test loops bound on the live-offer `shown` clamp), VG17 (panel render gates on `i < offer.length`) to `renderIntegration.test.js`, following the file's established source-pin convention. Each pin fails independently under its own mutation.
  - `[low]` `[patch]` The fold-frequency invariant — named in Boundaries, the I/O matrix, and AC #2 ("runs only on a level change, never per frame") — was unverified: the existing test asserts the resulting value, which a per-frame fold produces identically. Fixed: added a fold-**count** test using a counting `stats` getter, asserting exactly one fold on the pick and none across 120 further ticks; hoisting the fold into `fixedUpdate` now fails it.
  - `[low]` `[patch]` `drawCardOffer`'s JSDoc (`src/systems/cardOffer.js`) listed `banishedIds` as a `progressionState` field, but only the separate top-level argument is read (while `remnantIds` **is** read off `progressionState`) — a caller following the documented shape gets zero banish exclusion, silently breaking Story 8.5 permanence. Fixed: corrected the param shape and added an explicit note on the two-source asymmetry.
  - `[low]` `[patch]` The fusion map test asserted only the `epic` half of each `{partner, epic}` pair (`partner` was merely `typeof === 'string'`), so a partner-id typo breaking the reciprocal Nanite ↔ Afterburner recipe passed. Fixed: pinned both halves of all four PRD §13.5 rows and added a reciprocity/resolution test for the one fully-registered pair; the `any-2-offense-lv5` sentinel is now pinned as a documented sentinel rather than an implied id.
  - `[low]` `[patch]` `title` duplicates `name` with nothing binding them, so editing `name` alone would silently leave the overlay rendering a stale label — a second source of truth in the story that exists to remove them. Fixed: asserted `item.title === item.name` for every entry.
  - `[low]` `[patch]` `LevelUpSystem`'s constructor takes `registry` at positional slot 4 — where `rng` used to live — so a stale four-arg caller binds its rng to `registry`, making every offer empty; combined with the new empty-offer auto-drain that silently swallows every owed pick for a whole run with no throw. Fixed: added an `Array.isArray(registry)` guard that throws at construction with a message naming the arg move (verified to throw on the stale four-arg call).
  - `[low]` `[patch]` `markRemnant`'s docstring (`src/state/ProgressionState.js`) was self-contradictory and did not describe the code — it claimed a no-op on an unowned id while the code unconditionally adds to `remnantIds`, permanently excluding a never-owned item. Fixed: rewrote it to state the actual freeze-only clamp plus an explicit caller contract that ownership is **not** validated here (Epic 12 owns the caller).

Deferred finding (medium): a SHORT offer renders left-aligned inside the fixed three-panel footprint (the rects are precomputed once against a hardcoded 3), so a two-card offer sits visibly off-centre. Newly created by this story but the fix is a layout change excluded by the intent-contract's `Never` clause ("No other render change"); logged to `deferred-work.md` for the same overlay/UX pass as the per-level `desc` entry.

Rejected (16): empty-offer silent drain with no player feedback, and the invuln grant on a drained level-up (both the human-resolved intended behavior per the Spec Change Log — the intent explicitly says the owed pick(s) drain and "normal play resumes with the usual landing invulnerability"); banishing the last eligible card draining all owed picks (the intent specifies plural drain to `0` on an empty pool); slot limits `5`/`4` unreachable against the 2+2 registry and the deleted `cards.test.js` pool-size invariant (which cannot be restored without failing — intent reuses the existing limits, more items land later); reroll near-no-op with only four items (content-scale, resolves as Epic 10–12 land); additive `*Mult`-on-base-1 authoring convention (the intent's specified fold); stale non-base keys rebased rather than deleted (speculative future test breakage); the three-way missing-`maxLevel` fallback divergence (every registry entry carries `maxLevel`, already pinned; the one concrete latent bug it implied was patched above); `debugStat += 1` before the guards and its unchanged DEV label (DEV-only readout, unreachable in the live path since excluded items weigh 0); `cardWeight` re-implementing `isMaxed`/`isRemnant` inline (the intent's shared-helper clause is scoped to slot occupancy, which *is* shared); dead query API with no production caller (deliberate Epic 12 plumbing per the intent's "track and expose"); the sub-frame stale-`_cardFocus` window after a shrinking reroll (independently examined and cleared by the edge-case layer — focus resets on every offer-array identity change); dangling `piercing-lance` / sentinel fusion partners as unregistered items (Epic 12 owns consumption; the test-coverage half was patched); the fold's arithmetic being pinned only by synthetic fixtures (inherent — the intent mandates empty `stats` on all four items); and the zero-panel render path being dead because the drain fires before the overlay opens (this satisfies "never held invulnerable on an empty overlay" more strongly than opening and closing it).

### 2026-07-23 — Review pass (post-implementation)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` `recomputePlayerStats` (`src/state/PlayerStats.js`) reset cleared only `PLAYER_STATS_BASE` keys, so a non-base stat key added by a later story's item `stats` accumulated across folds (violating the module's own documented robustness). Fixed: reset now clears every present key to its `baseFor` convention base before overlaying `PLAYER_STATS_BASE`; added a two-fold no-accumulation test with synthetic non-base keys.
  - `[medium]` `[patch]` Level-up overlay pointer hit-test (`src/scenes/ArenaScene.js`) looped the fixed 3 card/banish rects regardless of offer length, so a tap in a hidden short/empty-offer panel set `_cardFocus`/queued an out-of-range select/banish (sim-guarded no-op, but focus landed on an unrendered panel). Fixed: both hit-test loops clamp to `Math.min(_cardRects.length, currentOffer.length)`, extending the keyboard/gamepad focus-clamp to the pointer path per the intent's short-offer overlay clause.
  - `[low]` `[patch]` Empty-offer auto-drain invuln grant (`Math.max`) was only asserted with a seeded `invulnMs: 0`, so a regression to a plain assign would pass. Fixed (test only): added an empty-offer test seeding a larger in-flight invuln (`LANDING + 1200`) and asserting it is preserved.

Deferred finding (medium): the level-up overlay renders only each item's `title`, not the registry's per-level `desc` or current/target level — an upgrade looks identical to a new item. Pre-existing (Story 8.3 overlay) and out of scope by the intent-contract `Never` clause; logged to `deferred-work.md` for an item story / UX pass.

Rejected (9): slot limits `SLOT_LIMIT_OFFENSE=5`/`DEFENSE=4` unreachable with the 2+2 registry (intent reuses the existing limits; more items land later; still synthetically tested); `fusion.partner` ids not registered + directional pair→epic asymmetry (fusion consumption is Epic 12 — intent only tracks/exposes); `markRemnant` flags an unowned id / never re-folds `PlayerStats` (per-spec + tested; Epic 12 wires consumption and its re-fold); additive multiplier stacking (the intent's specified fold — effect numbers deferred to 10.2–10.5); `debugStat += 1` before the remnant/cap guards (DEV-only readout; unreachable in the live path since excluded items have weight 0 and are never picked); `LevelUpSystem` constructor positional-param insertion (both callers updated + tested); empty-offer silent auto-drain with no player feedback (the human-resolved intended behavior per this spec's Spec Change Log).

### 2026-07-23 — Review pass
- intent_gap: 1: (high 1, medium 0, low 0)
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 5
- addressed_findings:
  - none

Blocking finding (intent_gap, high): The intent-contract requires BOTH "preserve the exactly-`CARD_OFFER_SIZE` (3) offer invariant" AND "maxed/remnant items are never offered", and Story 8.5 guarantees a banished id never reappears. With the 4-item Epic-10 registry these are unsatisfiable once ≥2 items are excluded — reachable in normal play via the 2 starting banish charges: `drawCardOffer`'s zero-weight fill then re-surfaces a banished/maxed card as a pickable upgrade (empirically reproduced: banishing `overcharge` + `nanite-shield` returns an offer containing `overcharge`). Root cause is inside `<intent-contract>` (the "Always" Boundary), so it cannot be auto-repaired; the reverted implementation is saved at `intent-gap-attempt-10-1-item-and-upgrade-framework.patch`. Moot secondary findings (deferred to re-derivation once the gap is resolved): applyCard should not upgrade a remnant; `recomputePlayerStats` reset should be robust to stat fields added by later stories; `markRemnant` should freeze-only (never raise/mint a level); the level-up overlay does not render per-level `desc`/target level.

## Design Notes

Registry entry (real metadata, effect numbers deferred to the item's own story):

```js
Object.freeze({
  id: 'overcharge', name: 'Overcharge', track: 'offense', rarity: 5,
  maxLevel: ITEM_MAX_LEVEL,
  levels: [ { level: 1, desc: '+15% damage', stats: {} }, /* …L2–L5… */ ],
  fusion: { partner: 'tesla-coil', epic: 'railgun' },
})
```

The fold reads only the **current** level's `stats` (per-level entries are totals-at-that-level, not deltas to sum across levels):

```js
export function recomputePlayerStats(ps, ownedCards, registry) {
  ps.damageMult = 1; ps.fireRateMult = 1; ps.moveSpeedMult = 1; ps.shieldCharges = 0; // base
  for (const id in ownedCards) {
    const lvl = ownedCards[id]; if (lvl < 1) continue;
    const s = getItem(registry, id)?.levels[lvl - 1]?.stats; if (!s) continue;
    for (const k in s) ps[k] += s[k]; // additive fold onto base
  }
}
```

The `PlayerStats` field vocabulary starts minimal; item stories extend it. Because 10.1's registered items carry empty `stats`, the fold is a no-op on real content today and is proven by a synthetic-fixture test — the framework is real; the item content is each story's job.

## Verification

**Commands:**
- `npm test` -- expected: all Vitest suites pass, including the new/updated itemRegistry, playerStats, progressionState, cardOffer, levelUpSystem, and buildArenaWorld tests.
- `npm run build` -- expected: production build succeeds with no unresolved imports after `PLACEHOLDER_CARDS` removal.


## Auto Run Result

Status: done

### Summary
Second follow-up review pass over the already-implemented Item & Upgrade Framework (the prior pass set `followup_review_recommended: true`). Four review layers ran in parallel over the full `src/` diff since `c9b46c1`. No intent gaps and no spec defects surfaced — the framework as built still matches the human-resolved variable-size, exclusion-pure offer contract. Six findings were patched: one latent crash in the fold, two constructor-guard gaps (one missing guard, one unverified guard), one predicate-duplication cleanup that also closed a type-contract split, and two documentation corrections that close silent-authoring traps for stories 10.2–10.5. One finding was deferred and fifteen rejected. Notably, three of the four layers converged independently on the slot-limit reachability gap (deferred) and all four on the `markRemnant` re-fold trap (patched as a caller contract).

### Files changed
No behavioral change to shipped gameplay beyond one latent-crash guard and one defensive constructor guard:
- `src/state/PlayerStats.js` — the fold skips a definition with no authored `levels` array instead of throwing a `TypeError` inside `fixedUpdate`; added an AUTHORING CONVENTION block stating that a `*Mult` entry is the fractional bonus added onto base 1 (`0.15`, never `1.15`) and that multi-item multipliers stack additively by design.
- `src/state/ProgressionState.js` — extracted the shared `isMaxedAtLevel` / `hasRemnant` predicate primitives now backing `isMaxed`, `isRemnant`, `applyCard` **and** `cardWeight`; `markRemnant`'s caller contract now states the Epic-12 re-fold obligation.
- `src/systems/cardOffer.js` — `cardWeight` routes its maxed/remnant questions through the shared primitives; the private `isRemnantId` duplicate is deleted.
- `src/systems/LevelUpSystem.js` — the constructor throws when `playerStats` (arg 5, one slot past the guarded `registry`) is present but not an object, closing the stale-arity trap that silently drops the offer off the seedable rng stream.
- `src/state/playerStats.test.js` — added the malformed-definition (absent / empty `levels`) fold test.
- `src/systems/levelUpSystem.test.js` — added the constructor-guard describe block pinning both throws plus the positive 6-arg and omitted-`playerStats` calls.

### Review findings
- **Patches applied (6):** fold crash on a definition with no `levels` array (medium); `playerStats` arg-5 type guard (low); tests for the previously unverified arg-4 registry guard (low); maxed/remnant predicate duplication + `remnantIds` type-contract split (low); `stats` authoring-convention documentation (low); `markRemnant` re-fold caller contract (low).
- **Deferred (1):** the per-track slot-limit mechanic is unreachable against the 2+2 registry and the deleted `cards.test.js` pool-size invariant has no replacement (logged to `deferred-work.md` as a new entry).
- **Rejected (15):** see the triage-log entry — chiefly the empty-offer drain semantics, the drained-level-up invuln grant and the last-card banish (all human-resolved intent), content-scale consequences of a four-item registry, Epic-12-owned forward plumbing, and two findings already sitting in the deferred ledger from prior passes.

### Follow-up review recommendation
`true`. Patched findings this pass: 0 high, 1 medium, 5 low → score `3x1 + 1x5 = 8` >= 5. As with the prior pass, the score is driven by breadth of low-severity hardening rather than by any unresolved defect; the one medium patch is closed and mutation-verified.

### Verification
- `npm test` — 67 files, **1261 tests, all pass** (1257 before this pass; +4 new).
- `npm run build` — production build succeeds, 96 modules transformed, no unresolved imports.
- **Mutation verification** — every new pin was confirmed to bite by reverting the behavior it guards and observing that exact test fail, then restoring: removing the `levels` guard → the malformed-definition test alone; removing the arg-5 guard → the arg-5 test alone; removing the arg-4 guard → the arg-4 test alone; neutering `isMaxedAtLevel` → 5 failures across `cardOffer.test.js` **and** `progressionState.test.js`; neutering `hasRemnant` → 6 failures across both files (proving `cardWeight` genuinely routes through the shared primitives rather than merely importing them).

### Residual risks
- The deferred slot-limit gap means the Epic-8 build-commitment ceiling is inert on shipped content until the registry grows; the weighting branch itself remains covered by synthetic pools.
- The fold's arithmetic is still proven only against synthetic fixtures, since the intent mandates empty `stats` on all four registered items — the first real numbers land in 10.2 and will exercise it against shipped content.
- The `markRemnant` re-fold obligation is documented, not enforced; Epic 12 must honor it when it wires fusion consumption.
