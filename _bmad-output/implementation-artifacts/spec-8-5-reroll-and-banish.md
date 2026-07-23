---
title: 'Story 8.5 — Reroll & Banish'
type: 'feature'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '1b07532de27a13daa41532d6e44cd13cf0f74af5'
final_revision: '0117eed44569bd6d4df8ace5676e7f0d867a3264'
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** After Story 8.4 the level-up offer is a deterministic weighted trio the player can only *accept* — there is no way to reshape a bad hand or purge a card they never want. Epic 8's promise ("shape my build, not just accept what luck deals") needs two build-shaping tools layered onto the existing 8.3/8.4 draft: **reroll** (redraw the trio, a limited charge economy that grows with the run) and **banish** (permanently drop a card from this run's offer pool). The `banishMultiplier`/`banishedIds` seam was already built in 8.4 and defaults to inert; this story populates and drives it.

**Approach:** Extend the run-scoped `ProgressionState` with `rerollCharges` (start 1), `banishCharges` (start 2), and a `banishedIds` Set (start empty). Add two latches to `LevelUpSystem` mirroring the existing selection latch — `queueReroll()` and `queueBanish(index)` — consumed in `fixedUpdate` while a selection is active: reroll spends a charge and clears `currentOffer` so the existing step-(3) rebuild draws a fresh trio; banish adds the focused card's id to `banishedIds`, spends a banish charge, and likewise clears the offer for a fresh trio that excludes it. Thread `progressionState.banishedIds` into the existing `drawCardOffer` call so every (re)build honors banished ids. Grant +1 reroll charge on the tick the player crosses **into** level 10, 15, or 20 (edge-detected off the same `levelsGainedThisTick` seam, multi-level-jump-safe). Wire the two actions into the `ArenaScene` overlay (keyboard/gamepad/touch) with visible remaining-charge counts and a clearly-disabled look when depleted. Strictly additive: the 8.3 selection state machine (edge-detect, invuln, latch, landing-invuln) and the 8.4 weighted draw are untouched — only new latches, new state, and the `banishedIds` argument are added.

## Boundaries & Constraints

**Always:**
- **Reroll economy:** a run starts with **1** reroll charge; +1 is granted on the tick the player crosses **into** each of levels **10, 15, 20** (so a single multi-level jump that spans several thresholds grants one per threshold crossed). `queueReroll()` is honored only while `selectionActive` and `currentOffer.length === 3` and `rerollCharges > 0`; it then decrements `rerollCharges`, clears `currentOffer` (the step-(3) rebuild redraws a fresh weighted trio respecting weights/slots/banished), and leaves `pendingSelections` unchanged (the player still owes the same pick, still invulnerable). At `rerollCharges === 0` it is a guarded no-op that consumes no charge.
- **Banish economy:** a run has **2** banish charges. `queueBanish(index)` is honored only while `selectionActive`, `currentOffer.length === 3`, `index` is an integer in `0..2`, and `banishCharges > 0`; it then adds `currentOffer[index].id` to `progressionState.banishedIds`, decrements `banishCharges`, and clears `currentOffer` so the step-(3) rebuild redraws a fresh trio **excluding** every banished id. A banished id **never appears in any offer again this run** (its weight is zeroed by the existing 8.4 `banishMultiplier`). At `banishCharges === 0` it is a guarded no-op that consumes no charge.
- **Latch discipline:** `queueReroll`/`queueBanish` mirror the bomb/selection latch — one-slot, only the first call before the next `fixedUpdate` is honored, read-and-cleared in the tick. Consumption order in `fixedUpdate`: selection pick first, then reroll, then banish, then the level-crossing edge-detect + reroll grant, then the offer rebuild + invuln re-arm. Because reroll/banish require `currentOffer.length === 3`, a same-tick pick (which empties the offer) makes them no-op that tick.
- **Determinism:** a reroll or banish redraw routes entirely through the shared injected `_rng` (the same seedable stream 8.4 uses) via `drawCardOffer`; same rng sequence + same progression state ⇒ identical redraw. No `Math.random` in the reroll/banish path.
- **State is run-scoped:** `rerollCharges`/`banishCharges`/`banishedIds` are created fresh per run in `createProgressionState` and, like `ownedCards`, are never touched by the death path (survive a non-final death, reset on a fresh run).
- **UI:** the overlay surfaces both actions on keyboard, gamepad, and touch, each guarded on `selectionActive && !paused` and the open-grace exactly like the existing confirm, and shows the remaining charge count for each; a depleted action (count 0) reads as clearly unavailable (dimmed) and does nothing when pressed.

**Block If:** (none — the reroll/banish charge counts, grant levels, seedable-stream seam, and `banishedIds` seam are fully specified by the epic and already scaffolded in 8.4.)

**Never:**
- Do not modify `cardOffer.js` production code — its `banishMultiplier`/`banishedIds` seam and the weighted-without-replacement draw are already complete from 8.4; this story only *passes* `banishedIds` and *populates* it.
- Do not modify the 8.3 selection state machine's edge-detect / invuln / latch / landing-invuln behavior, `LevelSystem`, the v1 loop (movement/firing/bombs/multiplier/death/collision), or `applyCard`'s shape. The only `LevelUpSystem` changes are the two new latches, the reroll-grant edge-detect, and threading `banishedIds` into the existing `drawCardOffer` call.
- No per-card banish limit beyond the 2-charge cap; no un-banish / no reroll of an *already-picked* card; no persistence of charges/banishes across runs (Epic 14 owns meta-progression).
- No real item content or registry (Epic 10); cards remain placeholder `debugStat` stackers.
- Do not plug a seeded RNG into the live scene (Epic 15) — reroll/banish route through whatever `_rng` `buildArenaWorld` already threads (still `Math.random` in the live scene today).
- Do not change `LevelUpSystem`'s or `buildArenaWorld`'s constructor signatures — `banishedIds` and the charges live on the already-threaded `progressionState`, so no new wiring argument is needed.

## I/O & Edge-Case Matrix

`LevelUpSystem.fixedUpdate()` drives the sim surface; `progressionState` holds the charge/banish state; the level stub exposes `{ level, levelsGainedThisTick }`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reroll with a charge | `selectionActive`, offer of 3, `rerollCharges=1`; `queueReroll()` | `rerollCharges→0`; a fresh 3-distinct offer (new array), `pendingSelections` unchanged, still active/invuln | none |
| Reroll deterministic | same rng seq + same state, reroll twice | identical redrawn trio (ids + order) | none |
| Reroll depleted | `rerollCharges=0`; `queueReroll()` | guarded no-op: offer unchanged, `rerollCharges` stays 0 | none |
| Reroll level grant | crosses into 10 (level=10, `levelsGainedThisTick=1`, `rerollCharges=1`) | `rerollCharges→2` on that tick only | none |
| Reroll multi-grant | jump 9→16 (`level=16`, `levelsGainedThisTick=7`, `rerollCharges=1`) | crosses 10 and 15 ⇒ `rerollCharges→3` | none |
| Reroll no re-grant | later tick, `levelsGainedThisTick=0`, level already 20 | `rerollCharges` unchanged (grant fires only on the crossing tick) | none |
| Banish with a charge | offer of 3, `banishCharges=2`; `queueBanish(0)` | `currentOffer[0].id` added to `banishedIds`; `banishCharges→1`; fresh 3-distinct offer excludes that id | none |
| Banish never returns | after banishing id X, drive several rerolls/rebuilds | X never appears in any subsequent offer this run | none |
| Banish depleted | `banishCharges=0`; `queueBanish(0)` | guarded no-op: nothing banished, offer unchanged | none |
| Banish invalid index | `queueBanish(5)` / `queueBanish(-1)` | guarded no-op, latch cleared, no throw, `banishCharges` unchanged | guarded, no throw |
| Action with none pending | not `selectionActive`; `queueReroll()`/`queueBanish(0)` | guarded no-op, no throw, no charge spent | guarded, no throw |
| Latch idempotency | `queueReroll()` then `queueReroll()` before a tick | only the first honored (one-slot latch) | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- append the reroll/banish tuning block after the existing `CARD_WEIGHT_*` block: `REROLL_INITIAL_CHARGES = 1`, `BANISH_INITIAL_CHARGES = 2`, `REROLL_LEVEL_GRANTS = Object.freeze([10, 15, 20])` (levels that each grant +1 reroll on cross-in), plus UI constants for the two overlay action buttons (colors/alpha for enabled vs depleted, font, layout offsets) mirroring the existing `LEVELUP_*` UI block. One-line rationale each.
- `src/state/ProgressionState.js` -- extend `createProgressionState()` to also return `rerollCharges: REROLL_INITIAL_CHARGES`, `banishCharges: BANISH_INITIAL_CHARGES`, `banishedIds: new Set()`. Update the file doc-comment (run-scoped reroll/banish economy alongside ownership; never touched by death). `applyCard` is unchanged.
- `src/systems/LevelUpSystem.js` -- add `_queuedReroll` (bool latch) and `_queuedBanish` (index latch) with `queueReroll()` / `queueBanish(index)` methods (bomb-latch idiom). In `fixedUpdate`, after the existing choice-consume block and before the edge-detect: consume reroll (guard `selectionActive && currentOffer.length===3 && progressionState.rerollCharges>0` → decrement, clear offer), then consume banish (guard adds valid-index + `banishCharges>0` → add id to `banishedIds`, decrement, clear offer). In the edge-detect block, when `levelsGainedThisTick>0`, compute `prevLevel = levelSystem.level - levelSystem.levelsGainedThisTick` and grant +1 `rerollCharges` for each `T` in `REROLL_LEVEL_GRANTS` with `prevLevel < T && T <= levelSystem.level`. Thread `banishedIds: this.progressionState.banishedIds` into the existing `drawCardOffer({...})` call. Update the class doc-comment.
- `src/scenes/ArenaScene.js` -- add reroll/banish to the level-up overlay: two labelled action controls (Reroll / Banish) below the card prompt showing remaining `progressionState.rerollCharges` / `banishCharges`, with an enabled vs depleted look. Input across all three methods, each guarded on `selectionActive && !this._paused` and `this._cardConfirmGraceMs`: keyboard `R`→`queueReroll()`, `B`→`queueBanish(this._cardFocus)`; gamepad shoulder buttons (index 4 → banish focused, index 5 → reroll); touch pointerdown hit-test on the two action rects. Redraw the controls each frame (like the card panels) with the depleted styling when the matching count is 0. Extend the prompt line to mention reroll/banish. No sim mutation here beyond the latch calls.
- `src/systems/levelUpSystem.test.js` -- **update**. Add the reroll/banish matrix rows: reroll spends a charge + redraws (new offer, pending unchanged); reroll deterministic under a fixed stub rng; reroll depleted no-op; reroll grant on crossing into 10, multi-grant 9→16, no re-grant on a non-crossing tick; banish adds the id + spends a charge + redraw excludes it; banish "never returns" across several rebuilds; banish depleted no-op; banish invalid index guarded no-op; actions with none pending guarded; latch idempotency. Update `build()`'s level stub to include `level`.
- `src/systems/cardOffer.test.js` -- **update**. Add one `drawCardOffer` case over the real `PLACEHOLDER_CARDS` with a populated `banishedIds` (one id), driving many draws and asserting the banished id never appears while the offer stays exactly three distinct (locks "never appears again" at the draw surface with the shipped pool; existing cardWeight-zero and fill cases stay).
- `src/state/progressionState.test.js` -- **update**. Assert the fresh state now includes `rerollCharges === REROLL_INITIAL_CHARGES`, `banishCharges === BANISH_INITIAL_CHARGES`, and an empty `banishedIds` Set (distinct per instance). Keep the existing `ownedCards`/`debugStat`/`applyCard` cases.
- `src/scenes/buildArenaWorld.test.js` -- **update**. Change the exact-shape assertion on `ctx.progressionState` (currently `toEqual({ ownedCards: {}, debugStat: 0 })`) to the extended shape (reroll/banish charges + empty banished Set). Leave the LevelUpSystem/rng wiring assertions intact.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- append `REROLL_INITIAL_CHARGES`, `BANISH_INITIAL_CHARGES`, `REROLL_LEVEL_GRANTS` (frozen `[10,15,20]`), and the overlay action-button UI constants (enabled/depleted colors + alpha, font, layout offsets), each with a one-line rationale, after the `CARD_WEIGHT_*` block.
- `src/state/ProgressionState.js` -- extend `createProgressionState` with `rerollCharges`, `banishCharges`, `banishedIds: new Set()`; update the doc-comment. Do not change `applyCard`.
- `src/systems/LevelUpSystem.js` -- add the `queueReroll()` / `queueBanish(index)` latches and their `fixedUpdate` consumption (reroll then banish, both guarded on an active 3-card offer + a positive matching charge, both clearing `currentOffer` for the existing rebuild); add the reroll-charge grant on crossing into each `REROLL_LEVEL_GRANTS` level (multi-level-jump-safe via `prevLevel = level - levelsGainedThisTick`); thread `banishedIds: this.progressionState.banishedIds` into the existing `drawCardOffer` call. Update the class doc-comment. No other behavior changes.
- `src/scenes/ArenaScene.js` -- render the two action controls with live charge counts + enabled/depleted styling and wire keyboard (`R`/`B`), gamepad (shoulder 4/5), and touch input to `queueReroll()` / `queueBanish(this._cardFocus)`, guarded like the existing card confirm; extend the prompt text. Reads `this.progressionState.rerollCharges`/`banishCharges` for the display.
- `src/systems/levelUpSystem.test.js` -- add the reroll/banish/grant cases listed in the Code Map; update the level stub to carry `level`. Keep all existing 8.3/8.4 assertions.
- `src/systems/cardOffer.test.js` -- add the real-pool banished-id-never-appears draw case.
- `src/state/progressionState.test.js` -- assert the extended fresh-state shape (charges + empty banished Set, distinct per instance).
- `src/scenes/buildArenaWorld.test.js` -- update the `progressionState` shape assertion to the extended shape.

**Acceptance Criteria:**
- Given an active level-up offer of three and `rerollCharges > 0`, when the player rerolls, then a reroll charge is consumed, a fresh three-distinct offer is drawn through the shared `_rng` (respecting weights and slot limits), and the same pick is still owed with the player still invulnerable.
- Given the player crosses into level 10, 15, or 20 (including a single multi-level jump spanning more than one), when that tick resolves, then `rerollCharges` increases by one per threshold crossed, and a later non-crossing tick grants nothing.
- Given an active offer and `banishCharges > 0`, when the player banishes the focused card, then that card's id is added to `banishedIds`, a banish charge is consumed, a fresh three-distinct offer excluding that id is drawn, and the banished id never appears in any later offer for the rest of the run.
- Given `rerollCharges === 0` (or `banishCharges === 0`), when the player attempts that action, then it is a guarded no-op that spends no charge and leaves the offer unchanged; an out-of-range banish index or an action with nothing pending is likewise a guarded no-op that does not throw.
- Given the same rng sequence and progression state, when a reroll (or banish redraw) runs twice, then the redrawn trio is identical (deterministic).
- Given `npm test` and `npm run build`, when they run, then all existing suites still pass, the new/updated `levelUpSystem` / `cardOffer` / `progressionState` / `buildArenaWorld` tests pass, and the production build succeeds.
- Manual (UI, not unit-testable — live Phaser): during a level-up, the overlay shows the reroll and banish controls with their remaining-charge counts; rerolling redraws the trio and decrements the count; banishing the focused card removes it and it never returns that run; when a count hits 0 the control reads as clearly unavailable and does nothing.

## Spec Change Log

<!-- Append-only. Empty until the first bad_spec loopback. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 0
- reject: 10
- addressed_findings:
  - `[medium]` `[patch]` (Edge Case Hunter EC1) Touch players could not aim banish: the Banish action targets `_cardFocus`, but on touch `_cardFocus` is only settable by tapping a card (which also commits a pick) and resets to 0 each fresh offer — so touch banish always hit card slot 0, wasting a charge on the wrong card and defeating the story's headline feature on a first-class (mobile) platform. Routed patch (not bad_spec): the corrective is localized to the un-unit-tested ArenaScene render/input layer and needs no re-derivation of the correct, fully-tested sim work. Fixed: added a per-card banish glyph touch target (top-right corner of each panel) hit-tested BEFORE the card-commit rects and short-circuiting, calling `queueBanish(i)` for the tapped card when a charge remains; removed the un-aimable Banish branch from the bottom action-row pointerdown; keyboard `B` / gamepad LB focus-banish unchanged; prompt + constants updated.
  - `[low]` `[patch]` (Verification Gap VG1) The reroll-charge grant's `prevLevel < T` lower bound (which prevents re-granting once past a 10/15/20 threshold) was never exercised — a weakened `T <= level` guard (unbounded reroll economy) passed every test. Fixed (test-only): added a crossing-tick case at `level=12, levelsGainedThisTick=1` (prevLevel 11, already past 10) asserting `rerollCharges` unchanged, and made the `openSelection` helper's stub level realizable (`level=2` when gaining 1).
  - `[low]` `[patch]` (Verification Gap VG2) The reroll/banish input-mapping direction was unpinned — swapping R↔B or gamepad idx 4↔5 would pass all tests while making the player banish when intending to reroll. Fixed (test-only): added source-text assertions (existing VG9 idiom) pinning `keydown-R`→`queueReroll`, `keydown-B`→`queueBanish(this._cardFocus)`, gamepad `idx===4`→banish, `idx===5`→reroll.
  - `[low]` `[patch]` (Blind Hunter BH6) Reroll/banish were only tested for a single owed pick; the "same picks still owed, still invulnerable" invariant was unproven for `pendingSelections >= 2`. Fixed (test-only): added multi-level-jump (pending 2) reroll and banish cases asserting pending stays 2, still invulnerable, offer redraws fresh (banish excludes the id), and a later pick drains to 1.
  - `[low]` `[patch]` (Blind Hunter BH1) `actionY` duplicated the prompt's hardcoded `+ 50` vertical offset, so changing one silently desyncs the action row from the prompt. Fixed: promoted `50` to `LEVELUP_PROMPT_Y_OFFSET`, reused at both sites.
  - `[low]` `[patch]` (Verification Gap VG3) The "non-final death leaves progressionState untouched" test asserted the new Story 8.5 fields at their fresh-run defaults, so a targeted death-path reset of just those fields would read as untouched. Fixed (test-only): seed `rerollCharges=3`, `banishCharges=0`, `banishedIds={'off-rapid'}` before the lethal contact and assert those exact values survive (mirroring the existing non-default `ownedCards` seed).
- Rejected (noise / by-design / out-of-scope by intent): loose gamepad `idx` guard treating a null button as index 0 (unreachable — Phaser always passes a button; pre-existing); the `renderIntegration` VG10 pause-guard string-count being brittle (the established repo idiom for this Phaser-coupled scene); a same-tick pick/reroll/banish silently dropping the later-consumed action (by-design, documented in Design Notes "Consumption precedence", tested, deterministic and charge-safe); the two independent `pointerdown` listeners lacking mutual exclusion (card and action rects are geometrically non-overlapping; speculative future-layout concern); depleted buttons giving no press feedback (spec-sanctioned by AC3 — "the action is unavailable"; the dimmed render satisfies "clearly shown as depleted"); reroll advancing the shared RNG cursor by a variable count (the epic's mandated single seedable stream; no seed until Epic 15 — same disposition as Story 8.4); action rects computed once without reflow (the scale manager fits the whole base-resolution overlay; same latent pattern as the 8.3 card rects); the asymmetric `queueReroll`/`queueBanish` latch guard (a boolean latch is inherently idempotent — the idempotency test proves it); the "reroll must return a different trio" reading (R-b) — the AC's "a new set of three is drawn (respecting weights and slots)" is a fresh weighted draw that may legitimately overlap, and forcing all-different would fight the mandated favor-owned-builds weighting; the depleted-visual being verified at no automated surface (inherent to the un-unit-testable live-Phaser scene — covered by the manual-verification AC, consistent with 8.3/8.4).

### 2026-07-23 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` (Blind Hunter) The touch level-up prompt hardcoded Unicode `✕` (U+2715) to point at the banish glyph, but the on-card glyph is ASCII `X` (`LEVELUP_CARD_BANISH_GLYPH`, deliberately ASCII per its constant comment "so it renders reliably under the bloom pass"). The prompt both mismatched the on-card symbol and reintroduced the exact under-bloom Unicode-render risk the constant avoids. Fixed (production): the prompt now interpolates `LEVELUP_CARD_BANISH_GLYPH` (already imported) instead of the literal `✕`, so instruction and glyph share one source.
  - `[low]` `[patch]` (Verification Gap / Intent Alignment) The per-card touch banish glyph — the story's headline touch affordance and the only touch path that can aim a *specific* card — was verified only structurally by nothing: VG11/VG12 pin the keyboard/gamepad `queueBanish(this._cardFocus)` direction but no pin covered the glyph's `queueBanish(i)`. A silent regression to `queueBanish(this._cardFocus)` (matching the keyboard idiom) would make every touch banish hit the focused slot (0 on a fresh trio) instead of the tapped card, defeating the feature while the whole suite passed. Fixed (test-only): added `VG13` pinning the `_cardBanishRects` loop to `queueBanish(i)` (the loop index) plus the short-circuit `return`, so a glyph tap targets the tapped card and can never also commit a pick.
  - `[low]` `[patch]` (Verification Gap) The action-row touch path (`r.kind !== 'reroll'` skip that keeps the bottom Banish button deliberately non-hittable, and the reroll rect → `queueReroll()`) had no source pin. Dropping the `kind` filter re-opens the exact wasted-charge-on-slot-0 bug the prior pass's EC1 fix removed. Fixed (test-only): added `VG14` pinning the `r.kind !== 'reroll') continue` skip and the reroll rect driving `queueReroll()`.
- Rejected (noise / by-design / already-dispositioned): the per-card banish glyph mis-tap risk (BH — the glyph is the sanctioned prior-pass EC1 touch affordance, a visible distinct amber control; no un-banish/confirm is in scope); the depleted-banish top-right "dead zone" (BH — the glyph stays visibly rendered dimmed when depleted and the `return` deliberately prevents a glyph tap from committing a pick, per its code comment; the card body remains tappable); the bottom Banish button rendering enabled-looking but ignoring touch (BH — touch banish is fully served by the glyph and the touch prompt directs players to it; the bottom button is a deliberate keyboard-`B`/gamepad-`LB` affordance + charge readout); reroll advancing the shared RNG cursor by a variable count (BH — the epic's mandated single seedable stream, no seed until Epic 15; same disposition as 8.4 and the first 8.5 pass); the two independent `pointerdown` listeners lacking mutual exclusion (BH — geometrically non-overlapping rects; same disposition as the first pass); the glyph's `banishCharges > 0` pre-check vs the reroll button's unconditional `queueReroll()` (BH — contextual, not inconsistent: the pre-check exists to avoid latching under the always-firing depleted short-circuit; the sim latch remains the sole authority for both); bare gamepad indices `4`/`5` without named constants (BH — cosmetic, consistent with the adjacent inline face-button `0..3` range); per-frame `label.setText` allocation while the overlay is open (BH — negligible, consistent with the existing per-frame DEV readout `setText`); the general "no behavioral test for the render/input layer" (BH — superseded by the VG13/VG14 source pins and the manual-verification AC; the established un-unit-testable live-Phaser idiom); `queueReroll` setting its boolean latch unconditionally vs the `=== null` guard on the index latches (BH — a boolean latch is inherently idempotent; same disposition as the first pass, proven by the idempotency test); a same-tick reroll swallowing a same-tick banish (EC — by-design per Design Notes "Consumption precedence": reroll empties the offer so banish no-ops that tick; charge-safe (no charge spent) and deterministic; same disposition as the first pass's rejected same-tick drop); mixed same-frame keyboard-focus-banish + touch-glyph-banish targeting the wrong card (EC — pathological simultaneous touch+keyboard input; the one-slot latch's first-wins is deterministic and charge-safe); the glyph pointer loop not gated on `i < offer.length` unlike the render loop's `shown` (EC — unreachable: `drawCardOffer` invariantly returns exactly 3 while `selectionActive`, and the sim latch re-guards `currentOffer.length === 3`).

## Design Notes

**State home (`ProgressionState`).** Reroll/banish charges and the banished set are run-scoped resources of the draft, so they live beside `ownedCards`/`debugStat` in `ProgressionState` — created fresh per run, never touched by the death path (mirroring `ownedCards`, which survives a non-final death and resets on a fresh run). This needs no new constructor wiring: `progressionState` is already threaded into `LevelUpSystem` and stored on `ArenaScene`. `banishedIds` is a `Set` for O(1) membership and natural dedup; the 8.4 `isBanished` already accepts a `Set`, and the draw only membership-tests it (never iterates it), so determinism is unaffected.

**Reroll grant edge-detect.** The grant reuses the same `levelsGainedThisTick > 0` edge the selection enqueue uses. `prevLevel = levelSystem.level - levelSystem.levelsGainedThisTick`; a threshold `T` is crossed this tick iff `prevLevel < T <= level`, which correctly handles a multi-level jump crossing several thresholds and fires exactly once per threshold (level is monotonic, so no re-cross). This is why the unit-test level stub must expose `level` (the real `LevelSystem` always does).

**Banish redraws the whole trio (chosen reading).** Banishing clears `currentOffer` and lets the existing step-(3) rebuild draw a *fresh three* (excluding banished ids) — reusing the sole existing offer-rebuild seam, matching reroll's "new set of three," and preserving the 8.3 `freshOffer` focus-reset (keyed on array identity) and full determinism. The alternative reading — replace only the banished slot and keep the other two — is deliberately rejected: it would require new single-slot-replacement machinery the codebase does not have, diverge from reroll's whole-trio semantics, and complicate determinism, for a placeholder-tier nuance Epic 10's real draft UX will own. Both readings satisfy the AC's observable contract (banished card gone from the pool + charge consumed + a three-card offer); the AC is silent on the surviving two, and the weighted draw still favors the player's owned-build cards on the redraw, so agency is preserved.

**No `cardOffer.js` change.** 8.4 shipped the complete `banishMultiplier`/`banishedIds` seam (a banished id weighs 0 and is never offered while the positive-weight pool ≥ 3, which always holds for the 6+5 pool with at most 2 banished). 8.5 only *passes* `progressionState.banishedIds` into the existing `drawCardOffer` call and *populates* the set. The added `cardOffer` test locks the end-to-end "never appears again" behavior against the real pool.

**Consumption precedence.** In `fixedUpdate`: pick → reroll → banish → level-cross grant/enqueue → rebuild+invuln. Reroll and banish both require `currentOffer.length === 3`, so if a pick was consumed the same tick (which empties the offer), they become no-ops that tick — clean mutual exclusion. In practice the UI latches only one action per frame; the ordering just makes any pathological multi-latch deterministic and harmless.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the updated `levelUpSystem.test.js` / `cardOffer.test.js` / `progressionState.test.js` / `buildArenaWorld.test.js`.
- `npm run build` -- expected: the production Vite build succeeds (resolves the new constants; no new module).

**Manual checks:**
- `npm run dev`, play a run and level up: the level-up overlay shows Reroll and Banish controls with remaining charges; rerolling redraws the three cards and decrements the reroll count; banishing the focused card removes it and it never reappears that run; reaching level 10/15/20 grants an extra reroll; a depleted control reads as clearly unavailable and does nothing.


## Auto Run Result

Status: done

**Summary of implemented change**
Follow-up review pass over the completed Story 8.5 (Reroll & Banish) diff (baseline `1b07532` → the committed 8.5 work). The sim surface (`LevelUpSystem`, `ProgressionState`, `cardOffer` threading, death-path immutability) was found clean and thoroughly covered by behavioral tests. Three low-severity patches were applied at the un-unit-testable `ArenaScene` touch/render surface; thirteen findings were rejected as noise, by-design, or already dispositioned by the first pass.

**Files changed**
- `src/scenes/ArenaScene.js` — touch level-up prompt now interpolates `LEVELUP_CARD_BANISH_GLYPH` (ASCII `X`) instead of a hardcoded Unicode `✕`, matching the on-card glyph and avoiding the under-bloom Unicode-render risk the constant guards against.
- `src/scenes/renderIntegration.test.js` — added `VG13` (pins the per-card touch banish glyph to `queueBanish(i)` + short-circuit `return`) and `VG14` (pins the action-row reroll-only touch path + the bottom-Banish `r.kind !== 'reroll'` skip), closing the source-pin coverage gap on the Story 8.5 touch pointer paths.
- `_bmad-output/implementation-artifacts/spec-8-5-reroll-and-banish.md` — review triage log entry, status/final_revision/followup frontmatter.

**Review findings breakdown**
- Patches applied: 3 (all low) — prompt glyph mismatch (production); VG13, VG14 (test-only source pins).
- Deferred: 0.
- Rejected: 13 (glyph mis-tap, depleted dead-zone, bottom-banish touch look, RNG cursor, dual listeners, charge pre-check, magic gamepad indices, per-frame setText, "no behavioral test", queueReroll latch asymmetry, reroll+banish same-tick drop, mixed-input wrong card, glyph loop not offer-gated).
- Follow-up review recommended: **false** — patched severities: high 0, medium 0, low 3; score `3 × 0 + 1 × 3 = 3` (< 5) and no high.

**Verification performed**
- `npm test` — 1153 passed (64 files), including new VG13/VG14.
- `npm run build` — production Vite build succeeded (92 modules).

**Residual risks / artifacts**
- The three touch-surface patches live in the live-Phaser render/input layer; VG13/VG14 pin the input wiring at the source level (the repo idiom), and the visual behavior remains covered by the story's manual-verification AC — consistent with 8.3/8.4/8.5.
- Residual working-tree artifact: `_bmad-output/implementation-artifacts/sprint-status.yaml` was already modified before this run began; it is not part of the reviewed change and was left in place.
