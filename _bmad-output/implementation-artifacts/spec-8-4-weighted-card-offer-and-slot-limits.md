---
title: 'Story 8.4 — Weighted Card Offer & Slot Limits'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: '3587916574c3fd66f9845d3f667d686ecac5720e'
final_revision: 'e913af242e967585012d7146b6ffe43fd1a3d91c'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 8.3 offers a *fixed* placeholder trio (`PLACEHOLDER_CARDS.slice(0, 3)`) with no RNG, no weighting, and no slot limits. Epic 8's promise — "a run commits to a specific build around the mid-game" — needs the offer to favor finishing owned builds over starting new ones, cap each track, and be deterministic on the seedable stream, before Story 8.5 layers on reroll/banish.

**Approach:** Replace the fixed offer-build line in `LevelUpSystem` with a pure, deterministic **weighted-without-replacement draw** of three distinct cards, routed through the existing injected `_rng` stream (the same one the spawn systems use). Expand the placeholder pool so each card carries a `rarity` (base weight) and a `track` (`offense`/`defense`); weight each candidate by the Epic-8 formula, zero unowned cards in a full track (5 offense / 4 defense), and draw three. Strictly additive: no ArenaScene render change (the overlay already renders `currentOffer` titles and `applyCard` still uses `id`+`statDelta`), and the 8.3 selection state machine (edge-detect, invuln, latch) is untouched — only the offer-*build* changes.

## Boundaries & Constraints

**Always:**
- The offer is **exactly three distinct cards**, drawn weighted-without-replacement from the shared injected `_rng`, so the 8.3 selection-latch guard (`currentOffer.length === 3`) always holds and a pick always drains.
- Per-candidate weight = `base_rarity × (owned ? 2.2 : 1.0) × (level_1_of_5 ? 1.0 : 1.4) × (slotsFull && !owned ? 0 : 1) × banishMultiplier`, where a candidate's `level = ownedCards[id] ?? 0`; `owned = level >= 1`; `level_1_of_5 = level === 1`; `slotsFull` = the count of **distinct owned ids whose `track` matches the candidate's track** is `>=` that track's limit (offense 5, defense 4); `banishMultiplier = 1` for every card this story.
- **Determinism:** the same `rng` sequence + same `progressionState` yields the identical three cards (same ids, same order). Every bit of offer randomness routes through the injected `_rng` — **no `Math.random` in the offer path.**
- Reuse LevelUpSystem's existing offer-(re)build seam (step 3, rebuild only when `currentOffer.length === 0`): a fresh weighted draw fires on the crossing tick and on each post-pick tick of a multi-level jump, reflecting the just-updated ownership. Zero steady-state allocation on the idle path is preserved (the draw runs only on a rebuild, never every tick).
- The placeholder pool stays `Object.freeze`d and Epic-10-swappable; the `ownedCards` count/level model is unchanged.

**Block If:** (none — the weight formula, slot limits, seedable-stream seam, and placeholder model are fully specified by the epic; the `level_1_of_5` binding is fixed by the literal formula token, see Design Notes.)

**Never:**
- No reroll, no banish action/charges, no actual banishing (Story 8.5). Include only the `banishMultiplier` seam defaulting to `1` (an empty banished set); do not build any 8.5 UI or state.
- No real item content or registry (Epic 10). Cards still only stack `debugStat` and record ownership; the new `rarity`/`track` fields are draw-only metadata.
- Do not modify v1 movement/firing/bombs/multiplier/death/collision, `LevelSystem`, `ProgressionState` (`createProgressionState`/`applyCard`/its shape), or the 8.3 selection state machine's edge-detect / invuln / latch / landing-invuln behavior — the ONLY behavioral change is the offer-build line and adding an `_rng` ref.
- Do not enforce a per-card max-level cap on offers (owned cards stay offerable at any level — matches 8.3's uncapped `applyCard`; Epic 10 owns real caps and the "of 5" ladder).
- Do not plug a seeded RNG into `ArenaScene`/`buildArenaWorld`'s caller (Epic 15). 8.4 only routes the offer through whatever `_rng` `buildArenaWorld` already threads (still `Math.random` in the live scene today).

## I/O & Edge-Case Matrix

`drawCardOffer({ pool, progressionState, rng, banishedIds })` → array of exactly three distinct cards. `cardWeight(card, ctx)` → the formula value.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh run | `ownedCards {}` | 3 distinct cards; each candidate weight = `rarity × 1.0 × 1.4 × 1 × 1` (unowned → `level_1_of_5` false) | none |
| Owned, level 1 | `ownedCards[x]=1` | card `x` weight = `rarity × 2.2 × 1.0` (owned, level===1) | none |
| Owned, mid-tier | `ownedCards[x]=3` | card `x` weight = `rarity × 2.2 × 1.4` (highest tier) | none |
| Offense track full | 5 distinct offense ids owned | every **unowned** offense card weight 0 (not offered); owned offense cards still offerable; all defense cards offerable | none |
| Defense track full | 4 distinct defense ids owned | every unowned defense card weight 0; owned defense still offerable | none |
| Deterministic offer | same `rng` sequence + same `ownedCards`, drawn twice | identical three cards, identical order | none |
| No duplicates | any state | the three returned ids are pairwise distinct | none |
| Banish seam | `banishedIds` omitted/empty | `banishMultiplier = 1` for all → nothing zeroed by banish | none |
| Degenerate pool | fewer than 3 positive-weight candidates (unreachable with the 11-card pool) | fill remaining slots deterministically from undrawn cards in pool order so length stays 3 | guarded, no throw |

`LevelUpSystem` change: gains an `_rng` ref; on offer (re)build it calls `drawCardOffer` instead of `PLACEHOLDER_CARDS.slice(0, 3)`.

</intent-contract>

## Code Map

- `src/config/constants.js` -- append the offer tuning constants: `SLOT_LIMIT_OFFENSE = 5`, `SLOT_LIMIT_DEFENSE = 4`, `CARD_OFFER_SIZE = 3`, `CARD_WEIGHT_OWNED_MULT = 2.2`, `CARD_WEIGHT_UNOWNED_MULT = 1.0`, `CARD_WEIGHT_LEVEL1_MULT = 1.0`, `CARD_WEIGHT_MIDTIER_MULT = 1.4` — each with a one-line rationale in the file's comment style, mirroring the existing `LEVELUP_*` tuning block.
- `src/config/cards.js` -- expand `PLACEHOLDER_CARDS` to a pool of **6 offense + 5 defense = 11** frozen cards, each `{ id, title, statDelta, rarity, track }` (`track ∈ {'offense','defense'}`, `rarity` a positive base weight, varied across cards). Update the doc-comment: Epic-8 placeholder pool that 8.4 weights and draws from; Epic 10 replaces the content.
- `src/systems/cardOffer.js` -- **new**, Phaser-free pure module. `cardWeight(card, { ownedCards, banishedIds, slotCounts, limits })` returns the formula value. `drawCardOffer({ pool, progressionState, rng = Math.random, banishedIds })` computes each card's weight (deriving per-track distinct-owned counts once), then draws `CARD_OFFER_SIZE` distinct cards by weighted-without-replacement running `rng()*total` subtraction (mirroring `SpawnDirector._pickAndSpawn`: a 0-weight card contributes no band and is never picked; a float guard awards a boundary hit to the last positive card), removing each picked card before the next draw. Deterministic zero-weight fill safety net keeps the result length at exactly three.
- `src/systems/LevelUpSystem.js` -- import `drawCardOffer`; constructor gains `rng = Math.random` (4th param) stored as `this._rng`; in step (3) replace `this.currentOffer = PLACEHOLDER_CARDS.slice(0, 3)` with `this.currentOffer = drawCardOffer({ pool: PLACEHOLDER_CARDS, progressionState: this.progressionState, rng: this._rng })`. Update the class doc-comment (it now performs the weighted seeded draw — no longer "no RNG"). All other behavior unchanged.
- `src/scenes/buildArenaWorld.js` -- pass `_rng` as the 4th argument to `new LevelUpSystem(levelSystem, playerState, progressionState, _rng)`; update the adjacent comment ("offers a weighted seeded trio" rather than "the fixed placeholder trio").
- `src/systems/cardOffer.test.js` -- **new**. Cover every I/O-matrix row.
- `src/config/cards.test.js` -- **update**. Replace the "exactly three" invariant with the 8.4 pool invariants.
- `src/systems/levelUpSystem.test.js` -- **update**. The single/multi-level rows that asserted the offer equals the three placeholder cards now assert length 3 + distinct ids + drawn-from-pool + determinism under a stub rng; inject an `_rng`.
- `src/scenes/buildArenaWorld.test.js` -- add `ctx.levelUpSystem._rng` to the "honors an injected rng" enumeration.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- append the seven offer tuning constants listed in the Code Map, each with a one-line rationale, after the existing `LEVELUP_*` block.
- `src/config/cards.js` -- replace the 3-card `PLACEHOLDER_CARDS` with the 11-card pool (6 `track:'offense'`, 5 `track:'defense'`), each entry `Object.freeze`d with `{ id, title, statDelta, rarity, track }` — distinct ids/titles, numeric `statDelta`, positive numeric `rarity` (vary rarities so weighting is observable), valid `track`. Keep the array frozen. Update the doc-comment to describe the weighted-draw pool and the Epic-10 swap seam.
- `src/systems/cardOffer.js` -- new. Implement `cardWeight` (formula exactly, using the constants) and `drawCardOffer`. Derive per-track distinct-owned counts from `progressionState.ownedCards` + each card's `track` once per draw. Draw three distinct via the `SpawnDirector`-style running-subtraction walk with the float guard, removing each pick; skip 0-weight cards (never offered). If positive-weight candidates run out before three (documented as unreachable given the pool), fill remaining slots deterministically from the not-yet-drawn cards in pool order so the result is always exactly `CARD_OFFER_SIZE`. Doc-comment: this is 8.3's `PLACEHOLDER_CARDS.slice(0,3)` seam replaced by the weighted seeded draw; `banishedIds` (default empty) is the 8.5 seam.
- `src/systems/LevelUpSystem.js` -- add the `rng = Math.random` constructor param (`this._rng = rng`), import `drawCardOffer`, and swap the step-(3) offer-build line to the weighted draw. Update the doc-comment.
- `src/scenes/buildArenaWorld.js` -- thread `_rng` into the `LevelUpSystem` construction (4th arg) and update the comment.
- `src/systems/cardOffer.test.js` -- new. With a real `createProgressionState()` and hand-built pools/stub rng: unowned weight (`×1.0×1.4`), owned-level-1 weight (`×2.2×1.0`), mid-tier level-3 weight (`×2.2×1.4`); offense-full and defense-full zeroing of unowned-in-track while owned-in-track stay positive and the other track stays offerable; determinism (fixed-sequence stub rng + same ownedCards, drawn twice → identical ids/order); distinctness of the three ids; `banishedIds` default → nothing zeroed; degenerate <3-positive fill returns exactly three without throwing.
- `src/config/cards.test.js` -- update. Assert: at least `SLOT_LIMIT_OFFENSE + 1` (=6) offense cards and at least `SLOT_LIMIT_DEFENSE + 1` (=5) defense cards (so a track can fill and a 3-draw still succeeds); every card has a distinct id, non-empty title, numeric `statDelta`, positive numeric `rarity`, and `track ∈ {'offense','defense'}`; the array and every entry are frozen. Include a comment noting the worst case (both tracks full) still leaves ≥ 3 positive-weight cards.
- `src/systems/levelUpSystem.test.js` -- update. Construct the system with a stub `_rng`; the single-level-up and multi-level rows now assert `currentOffer.length === 3`, the three ids are distinct and all belong to `PLACEHOLDER_CARDS`, and — with a fixed-sequence stub rng — the drawn trio is deterministic (drive the same crossing twice, assert identical). Add a case: after picking a card in a multi-level jump, the next post-pick offer reflects the updated ownership (still three distinct). Keep all existing edge-detect / invuln / latch / guarded-no-op / landing-invuln assertions unchanged.
- `src/scenes/buildArenaWorld.test.js` -- add `expect(ctx.levelUpSystem._rng).toBe(rng)` to the "honors an injected rng" test; leave the existing LevelUpSystem wiring test intact.

**Acceptance Criteria:**
- Given a level-up card offer with candidates in varied ownership states, when weights are computed, then each candidate's weight equals `rarity × (owned ? 2.2 : 1.0) × (level === 1 ? 1.0 : 1.4) × (trackFull && !owned ? 0 : 1) × 1`, and three cards are drawn without duplicates from the injected `_rng`.
- Given a track at its slot limit (5 offense or 4 defense distinct owned), when the offer is drawn, then no unowned card in that track is offered (weight 0) while already-owned cards in that track remain offerable and the other track is unaffected.
- Given the same `rng` sequence and the same `progressionState`, when the offer is drawn twice, then the three cards are identical (deterministic offers).
- Given a level-up (`LevelUpSystem` fed a stub `_rng`), when the offer builds, then `currentOffer` has exactly three distinct cards from `PLACEHOLDER_CARDS`, so the 8.3 selection latch (`currentOffer.length === 3`) still applies a pick.
- Given a multi-level jump, when an owed pick drains and a fresh offer builds, then the new draw reflects the just-updated ownership and is still exactly three distinct cards.
- Given `npm test` and `npm run build`, when they run, then all existing suites still pass, the new `cardOffer` tests and the updated `cards` / `levelUpSystem` / `buildArenaWorld` tests pass, and the production build resolves `src/systems/cardOffer.js` and the new constants.

## Spec Change Log

<!-- Append-only. Empty until the first bad_spec loopback. -->

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 0
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` (VG-A / Blind Hunter) The `cardOffer` suite never asserted that weight **magnitude** governs selection — a uniform pick among positive-weight candidates would pass every existing test, leaving the story's whole "favor owned / mid-tier builds" behavior with zero regression protection. The production draw is correct (a proper `rng()*total` band-walk); only the tests were insufficient. Fixed (test-only): added a direct `cardWeight` ordering assertion (equal rarity → owned-mid-tier > owned-level-1 > unowned) and a `drawCardOffer` band-boundary test (pool weights 1.4/2.8/4.2, rng `[0.6, 0.5, 0.0]` → hand-computed picks `['c','b','a']`; a uniform pick yields `b` first and fails).
  - `[low]` `[patch]` (VG-B / Blind Hunter) The float-guard fallback (`picked === -1` → last-positive-candidate) was dead in the test run (every stub rng < 1). A regression there would throw `candidates[-1].card` at a level-up. Fixed (test-only): added a case with `rng: () => 1` that drives `r` to never go negative, asserting a valid in-pool card is returned and nothing throws.
  - `[low]` `[patch]` (VG-C) The degenerate-fill test did not pin the fill card's identity, leaving the "fills deterministically in pool order" contract unverified. Fixed: added `expect(offer[2].id).toBe('z1')` (first undrawn card in pool order).
  - `[low]` `[patch]` (Blind Hunter / Edge Case Hunter) The "3-draw can never underflow" safety claim was proven only by arithmetic (`SLOT_LIMIT_OFFENSE + SLOT_LIMIT_DEFENSE >= CARD_OFFER_SIZE`), never behaviorally against the shipped pool. Fixed: added an end-to-end `cards.test.js` case that owns 5 distinct offense + 4 distinct defense **real** ids (both tracks full), drives 25 draws, and asserts every returned card is exactly three distinct **owned** (positive-weight) cards — no zero-weight fill slips in.
  - `[low]` `[patch]` (Blind Hunter) The `cardOffer.js` docstring claimed a banished/zero-weight card "is never offered," but the unreachable safety-net fill can include one to preserve the exactly-three count. Fixed (doc-only): scoped the claim — banished/zero-weight cards are never offered in normal operation (positive-weight pool ≥ 3); the impossible `< 3`-positive safety-net fill intentionally prioritizes the exactly-three latch invariant over banish/zero-weight purity. No behavior change.
  - `[low]` `[patch]` (Blind Hunter / Edge Case Hunter) The `CARD_OFFER_SIZE` constant comment implied downstream code consumes it, but `LevelUpSystem`'s latch (`currentOffer.length === 3`, `index < 3`) and the ArenaScene overlay hardcode the literal `3`. Fixed (comment-only): reworded to state "exactly three" is a firm Epic-8 contract mirrored as a literal `3` in those call sites, which must be updated in lockstep if the value ever changes.
- Rejected (by-design / out-of-scope by the intent / speculative): the `level_1_of_5` = `level <= 1` alternative reading (R2) — the verbatim AC formula's literal token `level_1_of_5` is false for level 0, and both readings preserve the AC's stated goal ordering (mid-tier owned > just-started owned > unowned); the difference is placeholder-card tuning magnitude that Epic 10 replaces; the non-monotonic level factor (the same verbatim-formula consequence); `isBanished` returning false for a plain-object banished map (Story 8.5 defines its own banish state shape and can pass a Set/array, already supported); no `cardWeight` field validation (Epic 10 owns the real registry + its validation; 8.4's pool is invariant-tested in `cards.test.js`); no offer variety / anti-repeat guarantee (the intent **mandates** favoring owned builds and offering only owned upgrades in a full track — by-design); the offer draw perturbing the shared spawn `_rng` stream (the epic's mandated single-seedable-stream design; no seed is even plugged in until Epic 15); no per-card max-level cap / unbounded stacking (spec **Never** — Epic 10 owns caps; 8.3 is already uncapped); `slotCounts` skipping an owned id absent from the pool (owned ⊆ `PLACEHOLDER_CARDS` this story; an Epic-10 pool-divergence concern); a defensive `picked === -1` break (speculative — `total > 0` guarantees a positive candidate, and the new VG-B test proves the branch returns a valid card).

### 2026-07-23 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 17
- addressed_findings:
  - `[low]` `[patch]` (Verification Gap) The slot-count derivation is DISTINCT-owned (`slotCounts[track] += 1` per owned id), but every slot-limit test owned each card at exactly count 1, so `+= 1` (distinct) and `+= ownedCards[id]` (total level) were behaviorally indistinguishable — leaving the distinct-vs-total semantics with zero regression protection even though cards are uncapped and real play stacks a single card to level ≥ the limit. The production code is correct; only the tests were insufficient. Fixed (test-only): added a `drawCardOffer` case owning ONE offense card at level `SLOT_LIMIT_OFFENSE + 2` and asserting an unowned same-track card is still offerable — the track is not full from one high-level card. A `+= ownedCards[id]` refactor fails this while the shipped distinct-count code stays green.
- Rejected (by-design / out-of-scope by the intent / speculative, deduped across the four reviewers): `CARD_OFFER_SIZE` mirrored as a literal `3` in the latch/overlay (already comment-addressed in the prior pass; "exactly three" is a firm Epic-8 contract, and changing the constant is a hypothetical future edit the comment already guards against); `pool.length < CARD_OFFER_SIZE` → sub-three offer / soft-lock (the deterministic fill is the documented-unreachable safety net; the shipped 6+5 pool keeps ≥ 9 positive-weight cards even with both tracks full — a speculative future pool-shrink concern); unowned level-0 cards receiving the `1.4` "mid-tier" factor (the verbatim AC formula's literal `level === 1 ? 1.0 : 1.4`; resolved in Design Notes and already rejected last pass); `rarity` reading as "higher = more common" (by-design: it is the intent's `base_rarity` weight, draw-only placeholder metadata Epic 10 replaces); NaN/Infinity `rarity` poisoning the band-walk, `undefined ownedCards` throwing, duplicate pool ids defeating distinctness (all unreachable — `cards.test.js` invariant-tests positive-finite rarities and distinct ids, and `createProgressionState` always initializes `ownedCards` to an object with integer levels; a robustness-of-general-exports concern the shipped path never reaches); wrong-shaped `banishedIds` silently no-op'ing (by-design — Story 8.5 owns the banish state shape and can pass a Set/array, already rejected last pass); the safety-net fill resurfacing a banished card in 8.5 (out-of-scope 8.5; already doc-scoped last pass — count-safety intentionally wins in the impossible < 3-positive state); `cardWeight` exported while `slotCounts` derivation lives in `drawCardOffer` (by-design — the exported signature `cardWeight(card, ctx)` is spec-specified as the pure test seam); the data-dependent rng-consumption count coupling the shared spawn stream (the epic's mandated single-seedable-stream design; no seed is plugged in until Epic 15; already rejected last pass); the slot limits (5 of 6 offense, 4 of 5 defense) barely constraining a run (intent-specified tuning — the pool is deliberately sized limit+1 so a track can fill and a 3-draw still succeeds; placeholder magnitudes Epic 10 replaces); `ArenaScene` assuming a length-3 offer (pre-existing 8.3 behavior; ArenaScene is untouched this story per the intent's "No ArenaScene change," and `drawCardOffer` guarantees exactly three for the shipped pool); the weight/slot-limit acceptance being verified at the `cardOffer.js` unit surface rather than end-to-end through `LevelUpSystem` (by-design — the Code Map/Tasks explicitly mandate the new pure `cardOffer.js` module and assign those assertions there and to `cards.test.js`'s real-pool full-track case; the intent auditor confirmed no behavioral divergence, only a spec-mandated decomposition); the `banished id weighs 0` unit test "reaching into" 8.5 behavior (by-design — `banishMultiplier` is a formula factor in-scope this story via the I/O matrix's banish-seam row, defaulting to 1); and the `isBanished` array branch being untested (a forward 8.5 seam, inert this story).

## Design Notes

**`level_1_of_5` binding (resolved by the literal formula token).** The verbatim weight formula — given identically in `epics.md` and the Epic 8 context — reads `(level_1_of_5 ? 1.0 : 1.4)`. A candidate's `level = ownedCards[id] ?? 0`, so `level_1_of_5` is true **iff `level === 1`** (the first rung of a 1..5 card ladder). Unowned = level 0 (≠ 1 → factor 1.4), just-started = level 1 (factor 1.0), mid-tier = levels 2–4 (factor 1.4). Multiplied by the `owned ? 2.2 : 1.0` factor, the net favoring is: mid-tier owned (`2.2 × 1.4 = 3.08·rarity`) > just-started owned (`2.2 × 1.0 = 2.2·rarity`) > unowned (`1.0 × 1.4 = 1.4·rarity`) — exactly "favors finishing owned builds over starting new ones **and** favors mid-tier upgrades." The alternative reading (unowned also gets the 1.0 factor) is rejected: level 0 ≠ level 1 per the literal token. Card levels are uncapped here (matching 8.3's uncapped `applyCard`); Epic 10 owns the real per-card cap and the "of 5" ceiling.

**Weighted-without-replacement draw mirrors the spawn director.** `drawCardOffer` reuses `SpawnDirector._pickAndSpawn`'s proven pattern — sum positive weights, walk a running `rng()*total` subtraction to pick one band, with a float guard awarding an exact top-boundary hit to the last positive card. A 0-weight card contributes no band and is therefore never picked, exactly like a 0-weight (capped) spawn archetype. Apply it three times, removing the picked card each round so the three are distinct. Pool sizing (6 offense + 5 defense) guarantees ≥ 9 cards carry positive weight even with **both** tracks full (only the ≤ 2 unowned-in-full-track cards are zeroed), so the exactly-three draw never underflows; the deterministic zero-weight fill is a documented, unreachable safety net that prevents any future pool shrink from producing a `< 3` offer (which would break the 8.3 `currentOffer.length === 3` latch).

**No ArenaScene change.** The overlay already renders `this.levelUpSystem.currentOffer[i].title` for three cards and `applyCard` uses only `id`+`statDelta`; the new `rarity`/`track` fields are draw-only. The 8.3 `freshOffer` focus-reset keys on the offer **array identity**, and `drawCardOffer` returns a new array per call, so that seam (and the whole heavily source-text-pinned ArenaScene input surface) is preserved untouched.

**`banishMultiplier` is the 8.5 seam.** It is a formula factor defaulting to `1` for every card (empty `banishedIds`), so the offer weighting is complete and correct now, and Story 8.5 wires real banishing by populating that set — no rework of the draw.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `cardOffer.test.js` and the updated `cards.test.js` / `levelUpSystem.test.js` / `buildArenaWorld.test.js`.
- `npm run build` -- expected: production Vite build succeeds (resolves `src/systems/cardOffer.js` and the new constants).

**Manual checks:**
- `npm run dev`, play a run and level up several times: the three offered cards vary between level-ups, and already-owned cards recur noticeably more often than fresh ones; after drafting 5 distinct offense cards, new (unowned) offense cards stop appearing while defense cards and upgrades to owned offense cards keep showing.

## Auto Run Result

Status: done

**Summary:** Follow-up review pass over the already-implemented Story 8.4 (weighted card offer & slot limits). The implementation replaces Story 8.3's fixed `PLACEHOLDER_CARDS.slice(0, 3)` offer with a deterministic weighted-without-replacement draw (`src/systems/cardOffer.js`) routed through the injected `_rng`, an 11-card (6 offense / 5 defense) pool carrying `rarity`+`track`, per-track slot limits (5/4), and a `banishMultiplier` seam for Story 8.5. This pass ran four review layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment) and applied one test-only regression patch.

**Files changed this pass:**
- `src/systems/cardOffer.test.js` — added one `drawCardOffer` regression test pinning the DISTINCT-owned slot-count semantics (one card owned at level > the slot limit must NOT fill its track; the unowned same-track card stays offerable).
- `_bmad-output/implementation-artifacts/spec-8-4-weighted-card-offer-and-slot-limits.md` — appended the follow-up review-triage entry; set `status: done`, `followup_review_recommended: false`, captured `final_revision`.

**Review findings breakdown:**
- intent_gap: 0, bad_spec: 0
- patch applied: 1 — `[low]` test-only regression guard for the distinct-owned slot-count semantics (VG-1). Production draw code was already correct; the gap was zero regression protection distinguishing distinct-owned from total-level counting.
- deferred: 0
- rejected: 17 (deduped across four reviewers) — all either unreachable with the invariant-tested shipped pool (NaN/Infinity rarity, undefined ownedCards, duplicate ids), intent-mandated by-design (literal weight formula, single shared seedable stream, exactly-three latch contract, no ArenaScene change, spec-mandated `cardOffer.js` decomposition), or out-of-scope Story 8.5 / Epic 10 seams already settled in the prior pass. Full rationale in the Review Triage Log entry above.

**Follow-up review recommendation:** `false`. Patched this pass: high 0, medium 0, low 1. Score = 3×0 + 1×1 = 1 (< 5), no high-severity patch → not recommended.

**Verification:**
- `npm test` — all 64 files / 1131 tests pass (including the new `cardOffer.test.js` case).
- `npm run build` — production Vite build succeeds (92 modules transformed).

**Residual risks:** None material to this story. The rejected robustness edge cases (NaN/Infinity/malformed-input defenses in the exported pure functions) are unreachable through the shipped pool + `createProgressionState` path and are explicitly out of this story's scope; Epic 10 owns the real registry and its validation. `_bmad-output/.../sprint-status.yaml` remains modified in the working tree as a pre-existing orchestration artifact — left in place, not part of this change.

