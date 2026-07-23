---
title: 'Story 8.3 — The Level-Up Moment & Card UI'
type: 'feature'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '1245d55bfb13960ffe65e4d21d4fb96a0c38a5df'
final_revision: 'aa9b421bb89184bc905e77f83a7d122c774a29d6'
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 8.2 gave the run a derived level and a `levelsGainedThisTick` edge seam, but a level-up currently does nothing — there is no moment, no choice, no card. Epic 8's whole deliverable (enemies → XP → level → *draft a card*) needs this beat before 8.4 can weight the offer or 8.5 can add reroll/banish.

**Approach:** On a level-up, dilate world time to **0.15×** (a slow-mo, not a hard pause — the swarm keeps crawling), hold the player invulnerable, and open a modal three-card overlay. Selecting a card applies a **placeholder** effect (stack a debug stat + record ownership in run-scoped progression state), closes the UI, and restores normal time. A new Phaser-free `LevelUpSystem` owns the sim-side state machine (edge-detect, invuln hold, offer, selection latch); `ArenaScene` owns the render-side overlay, dilation, and input. Strictly additive over v1 — no RNG (8.4's concern), no death/collision/movement edits.

## Boundaries & Constraints

**Always:**
- Edge-detect the level-up from `levelSystem.levelsGainedThisTick` (≥1 on the crossing tick). Enqueue exactly that many owed selections (a multi-level jump owes multiple picks, drained one card at a time).
- While one or more selections are pending: keep the player invulnerable by topping `playerState.invulnMs` up to at least `LEVELUP_INVULN_FLOOR` every tick (reuses the existing i-frame gate at `PlayerDeathSystem.js:103` — no death/collision edits), and dilate the sim to `LEVELUP_TIME_SCALE` by scaling the `delta` fed to `fixedTimestep.advance` (per-step `dt` stays `FIXED_STEP_MS`, so all v1 per-tick physics is bit-identical — only the step *rate* slows).
- Exactly three cards are offered. Selecting one applies it (debug stat delta + ownership recorded), decrements the pending count, and — if none remain — closes the overlay and restores normal time; if more remain, a fresh three is offered and time stays dilated.
- Card ownership + the debug stat live in a new run-scoped `progressionState`, built fresh per run in `buildArenaWorld` beside `scoreState`/`playerState`, never touched by the death path — so it resets on a fresh run and survives a non-final death (mirrors `scoreState.xp`).
- Card navigation + confirm work across keyboard, gamepad, and touch, mirroring the existing restart quad-input and the `touchControls` geometric hit-test; every scene `keydown` handler carries the `event.repeat` guard.
- While the overlay is open, gameplay input is suppressed (ship idles, no fire, no bomb) and pause (Esc/P) is disabled — navigation keys (arrows / A-D) must not also drive the ship.

**Block If:** (none — the dilation factor, invuln reuse, curve seam, and placeholder-card model are fully specified by the intent + Epic 8 context.)

**Never:**
- No RNG and no weighting/slots/reroll/banish (Stories 8.4/8.5). The offer this story is a fixed placeholder trio.
- Do not modify v1 movement/firing/bombs/multiplier/death/collision behavior, `createScoreState()`, `createPlayerState()`, or `LevelSystem`. Reuse the existing `invulnMs` gate and the `advance(delta,…)` seam; add no new field to `PlayerDeathSystem`.
- No real item/upgrade content or registry (Epic 10). Cards record ownership + a debug stat only; design the state so Epic 10 can replace the placeholders without reworking this loop.
- Do not hard-pause (`_paused`) for the level-up — it is a 0.15× dilation, not a freeze; the swarm must stay visible and crawling.

## I/O & Edge-Case Matrix

`LevelUpSystem` reads `levelSystem.levelsGainedThisTick`, `playerState.invulnMs`; writes `pendingSelections`, `currentOffer`, `playerState.invulnMs`, and (on selection) `progressionState`.

| Scenario | Input / State | Expected Behavior | Notes |
|----------|--------------|---------------------------|-------|
| Idle | `levelsGainedThisTick 0`, pending 0 | `selectionActive false`, `currentOffer []`, `invulnMs` untouched | timeScale 1 |
| Level-up fires | `levelsGainedThisTick 1` (one tick) | pending 1, `currentOffer` = the 3 placeholder cards, `selectionActive true`, `invulnMs ≥ FLOOR` | overlay opens, dilation on |
| Multi-level jump | `levelsGainedThisTick 3` | pending 3 | three picks owed |
| Invuln held | pending 1, ticks elapse (PlayerDeathSystem drains `invulnMs`) | `invulnMs` never reaches 0 while pending (re-armed ≥ FLOOR each tick) | player unhittable |
| No re-enqueue | after enqueue, later ticks `levelsGainedThisTick 0` | pending unchanged | edge-detect only on the crossing tick |
| Select, none left | pending 1, `queueSelection(1)`, next tick | apply `offer[1]`: `debugStat += statDelta`, `ownedCards[id]=1`; pending 0; `currentOffer []`; `selectionActive false` | overlay closes, time restores, residual invuln drains |
| Select, more left | pending 2, `queueSelection(0)`, tick | apply, pending 1, fresh offer built, `selectionActive true` | next card shown, stays dilated |
| Level-up mid-selection | pending 1 + orb collected during slow-mo crosses a threshold | pending increments; after current pick, next offer shows | queue drains all owed picks |
| Invalid index | pending 1, `queueSelection(5)` or `-1` | latch cleared, no apply, pending unchanged, no throw | guarded no-op |
| Select with none pending | pending 0, `queueSelection(0)` | no apply, no throw | guarded no-op |
| Fresh run | `createProgressionState()` | `debugStat 0`, `ownedCards {}` | run-scoped reset |
| Same card twice | `applyCard(state, X)` ×2 | `ownedCards[X.id] === 2`, `debugStat += 2·statDelta` | ownership is a count/level |

</intent-contract>

## Code Map

- `src/config/constants.js` -- append `LEVELUP_TIME_SCALE = 0.15`, `LEVELUP_INVULN_FLOOR` (> `FIXED_STEP_MS`), and card-overlay style constants (dim reuse `COLOR_PAUSE_OVERLAY`; panel/focus colors + alphas, card title/prompt/heading fonts, card rect width/height/gap) — mirror the existing pause/game-over overlay style constants.
- `src/config/cards.js` -- **new**. `PLACEHOLDER_CARDS`: exactly three frozen `{ id, title, statDelta }` cards with distinct ids/titles. Placeholder pool for Epic 8; Epic 10 replaces the content.
- `src/state/ProgressionState.js` -- **new**. `createProgressionState()` → `{ ownedCards: {}, debugStat: 0 }`; pure `applyCard(state, card)` (increments `debugStat` by `card.statDelta`, bumps `ownedCards[card.id]`). Phaser-free, mirrors `ScoreState.js` shape/discipline.
- `src/systems/LevelUpSystem.js` -- **new** Phaser-free `System`. Constructor `(levelSystem, playerState, progressionState)`. Owns `pendingSelections`, `currentOffer`, a `_queuedChoice` latch; exposes `selectionActive` + `queueSelection(index)`. Mirrors `LevelSystem`'s discipline (own public fields, no per-tick allocation on the idle path).
- `src/scenes/buildArenaWorld.js` -- construct `progressionState` beside `scoreState`/`playerState` (~line 136); construct + `world.addSystem(levelUpSystem)` immediately after `levelSystem` (~line 290, so it runs after `LevelSystem` and before `PlayerDeathSystem`); add both to the return object; bump "22 systems" prose → 23.
- `src/scenes/ArenaScene.js` -- assign `this.levelUpSystem` / `this.progressionState`; build the card overlay (dim + 3 panels + texts + heading + prompt) hidden in `create()` after the pause overlay; bind card nav/confirm input after the pause input; in `update()` scale the `advance` delta by `LEVELUP_TIME_SCALE` while `selectionActive`, suppress gameplay input while open, drive overlay visibility/focus/prompt, and disable Esc/P pause while open; append owned-count + `debugStat` to the DEV debug readout.
- `src/systems/levelUpSystem.test.js` -- **new** unit tests for every I/O-matrix row.
- `src/state/progressionState.test.js` -- **new** unit tests for `createProgressionState`/`applyCard`.
- `src/config/cards.test.js` -- **new** registry invariants (exactly 3, distinct ids, each has `title` + numeric `statDelta`).
- `src/scenes/buildArenaWorld.test.js` -- insert `'LevelUpSystem'` into `CANONICAL_ORDER` (right after `'LevelSystem'`); add `'levelUpSystem'` + `'progressionState'` to `RETURN_HANDLES`; bump "22"→"23" prose; add wiring assertions (shared `levelSystem`/`playerState`/`progressionState` instances; fresh progression shape).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- append the level-up tuning constants (`LEVELUP_TIME_SCALE = 0.15` — slow-mo, not a freeze; `LEVELUP_INVULN_FLOOR`, comfortably above `FIXED_STEP_MS` so a re-arm always survives one tick's drain, e.g. `200`) and the card-overlay style constants, each with a one-line rationale in the file's comment style.
- `src/config/cards.js` -- new. Export `PLACEHOLDER_CARDS` = three `Object.freeze`'d `{ id, title, statDelta }` cards (distinct ids/titles, numeric `statDelta`; e.g. three that each `+1` a debug stat). Doc-comment that these are Epic 8 placeholders that only stack a debug stat, replaced by Epic 10's real registry.
- `src/state/ProgressionState.js` -- new. `createProgressionState()` returns `{ ownedCards: {}, debugStat: 0 }` (run-scoped; rebuilt fresh per run, never reset on death — mirrors `scoreState.xp`). Pure `applyCard(state, card)`: `state.debugStat += card.statDelta; state.ownedCards[card.id] = (state.ownedCards[card.id] ?? 0) + 1;`. Doc-comment the ownership-count model as the Epic 10 seam.
- `src/systems/LevelUpSystem.js` -- new. `class LevelUpSystem extends System`, constructor stores the three refs and inits `pendingSelections=0`, `currentOffer=[]`, `_queuedChoice=null`. `get selectionActive() { return this.pendingSelections > 0; }`. `queueSelection(index)` latches the index if none latched (`if (this._queuedChoice === null) this._queuedChoice = index;`), mirroring the bomb latch. `fixedUpdate()`: **(1)** consume the latch — if `_queuedChoice !== null`, read+clear it, and only when `pendingSelections > 0 && currentOffer.length === 3 && index in [0,3)` call `applyCard(progressionState, currentOffer[index])`, `pendingSelections--`, `currentOffer = []`; **(2)** if `levelSystem.levelsGainedThisTick > 0`, `pendingSelections += levelSystem.levelsGainedThisTick`; **(3)** if `pendingSelections > 0`: build `currentOffer = PLACEHOLDER_CARDS.slice(0, 3)` when empty, and `if (playerState.invulnMs < LEVELUP_INVULN_FLOOR) playerState.invulnMs = LEVELUP_INVULN_FLOOR`; else `currentOffer = []`. Offer is (re)built only on the crossing/post-pick tick, never every tick. Doc-comment: reads the 8.2 `levelsGainedThisTick` seam, holds invuln via the existing gate, and the fixed placeholder offer is 8.4's future weighted-draw seam.
- `src/scenes/buildArenaWorld.js` -- import `LevelUpSystem` + `createProgressionState`; create `const progressionState = createProgressionState()` beside the other run state; after `world.addSystem(levelSystem)` construct `const levelUpSystem = new LevelUpSystem(levelSystem, playerState, progressionState)` (comment: runs after LevelSystem to read this tick's `levelsGainedThisTick`, before PlayerDeathSystem so the invuln top-up gates death the same tick) and `world.addSystem(levelUpSystem)`; add `levelUpSystem` + `progressionState` to the return object; update the "22 systems" prose → 23.
- `src/scenes/ArenaScene.js` --
  - Assign `this.levelUpSystem = arena.levelUpSystem` and `this.progressionState = arena.progressionState` in the destructuring block.
  - In `create()` after the pause overlay: build a hidden, `setScrollFactor(0)` card overlay — a dim rect (reuse `COLOR_PAUSE_OVERLAY`), a "LEVEL UP" heading, three card panels (`Graphics` rects) + three title `Text`, and a prompt line — layered above the pause/game-over overlays (created last). Track `this._cardFocus = 0`.
  - In `create()` after the pause input: bind card navigation + confirm, each guarded `if (!this.levelUpSystem.selectionActive) return;` and (for keys) the `event.repeat` guard — LEFT/RIGHT + A/D move `_cardFocus` (wrap 0..2); ENTER/SPACE and gamepad `on('down')` confirm via `this.levelUpSystem.queueSelection(this._cardFocus)`; a `pointerdown` geometric hit-test on the three card rects (base-resolution `pointer.x/y`, mirroring `touchControls._insideBomb`) sets focus + confirms that card. Add `if (this.levelUpSystem.selectionActive) return;` to `togglePauseInput` so pause is disabled while cards are open.
  - In `update()`: replace the `advance(delta, …)` call in the hit-stop `else` branch with `const timeScale = this.levelUpSystem.selectionActive ? LEVELUP_TIME_SCALE : 1; this.fixedTimestep.advance(delta * timeScale, …)` (hit-stop still wins). Immediately after `this.inputSampler.sample()`, when `selectionActive`, suppress gameplay input (`this.inputState.clear()` and drop any queued bomb) so the ship idles and navigation keys don't drive it. In the overlay-render region, toggle the card overlay visibility on `selectionActive`, render the three `currentOffer` titles, draw the `_cardFocus` panel brighter/thicker (bomb-pressed idiom), and set the prompt from `this.inputSampler.activeMethod`.
  - In the DEV debug readout, append the owned-card count (`Object.keys(this.progressionState.ownedCards).length`) and `this.progressionState.debugStat`.
- `src/systems/levelUpSystem.test.js` -- new. Cover every I/O-matrix row against a hand-built system with plain stubs (`{levelsGainedThisTick}` level stub, `{invulnMs}` player stub, a real `createProgressionState()`): idle; single level-up (pending 1, offer of 3, `selectionActive`, invuln armed); multi-level (pending 3); invuln held across ticks with a simulated per-tick drain; no re-enqueue when `levelsGainedThisTick` returns to 0; select-none-left (applies, closes, `selectionActive false`); select-more-left (applies, fresh offer, still active); invalid index and select-with-none-pending (guarded no-ops, no throw); level-up mid-selection enqueues another pick.
- `src/state/progressionState.test.js` -- new. Fresh shape (`debugStat 0`, `ownedCards {}`); `applyCard` increments `debugStat` by `statDelta` and records ownership; same card twice → count 2 and doubled `debugStat`; two different cards → both recorded.
- `src/config/cards.test.js` -- new. `PLACEHOLDER_CARDS` has exactly 3 entries, ids are distinct, each has a non-empty `title` and a numeric `statDelta`; entries are frozen.
- `src/scenes/buildArenaWorld.test.js` -- insert `'LevelUpSystem'` into `CANONICAL_ORDER` right after `'LevelSystem'`; add `'levelUpSystem'` and `'progressionState'` to `RETURN_HANDLES`; bump the "22"→"23" prose; add a test asserting `ctx.levelUpSystem.levelSystem === ctx.levelSystem`, `ctx.levelUpSystem.playerState === ctx.playerState`, `ctx.levelUpSystem.progressionState === ctx.progressionState`, and that `ctx.progressionState` starts `{ ownedCards: {}, debugStat: 0 }`.

**Acceptance Criteria:**
- Given a run whose XP crosses a level threshold, when the level-up fires, then world time dilates to `0.15×` (the arena and swarm stay visible and crawling, not frozen), the player is invulnerable for the whole selection, and exactly three cards are shown.
- Given the card overlay is open, when the player selects a card via keyboard, gamepad, or touch, then that card is applied, the overlay closes, and normal time is restored — and if more selections were owed (multi-level jump), a fresh three appears and time stays dilated until the last pick.
- Given a placeholder card is chosen, when it is applied, then `progressionState.debugStat` increases by the card's `statDelta` and `progressionState.ownedCards` records the card id (proving the draft loop end-to-end before real items exist).
- Given a selection is pending, when enemies would contact the ship, then the player takes no damage (existing `invulnMs` gate held ≥ `LEVELUP_INVULN_FLOOR` each tick) and the sim/run clock advances at the dilated rate.
- Given a fresh run rebuilds state, then `progressionState` resets to `{ ownedCards: {}, debugStat: 0 }`; given a non-final death, then it is unchanged.
- Given `npm test` and `npm run build`, when they run, then all existing suites still pass, the new `levelUpSystem` / `progressionState` / `cards` tests and the extended 23-system `buildArenaWorld` wiring tests pass, and the production build resolves the new modules/constants.

## Design Notes

**Dilation, not freeze — one seam.** The only clean lever is the render `delta` fed to `fixedTimestep.advance` (`ArenaScene.js:796`); the per-step `dt` stays the constant `FIXED_STEP_MS`, so every system integrates a bit-identical fixed slice and only the *rate* of steps changes. Scaling `delta ×0.15` makes the accumulator fill 0.15× as fast → the whole world (enemies, bullets, spawn ramp, `simClock.simTimeMs`) advances at 0.15× real time uniformly, with zero edits inside any system. The "run clock reflects dilated time" AC falls out for free because `simTimeMs`/spawn-elapsed are `Σ dt` and fewer ticks fire per real second. Hit-stop (a hard freeze) must still win over dilation.

**Invuln by re-arming the existing gate.** `PlayerDeathSystem` returns early while `invulnMs > 0` (`:103`) and decrements it by `dt` each tick. `LevelUpSystem` runs *before* `PlayerDeathSystem`, so topping `invulnMs` up to `LEVELUP_INVULN_FLOOR` (> one tick's drain) each pending tick keeps the player invulnerable for an *indefinite* selection without a new flag or any death/collision edit — and inherits the existing i-frame ship-blink render cue for free. A small residual floor also gives a brief landing grace after the overlay closes.

**Latch the choice, drain in the sim.** The overlay (render loop) calls `queueSelection(index)`; `fixedUpdate` consumes the latch and applies the card — mirroring the bomb latch, keeping all state mutation deterministic and inside the tick, and making the whole state machine unit-testable via plain ticks. Pending is a *count* (not a bool) so a multi-level jump or an orb collected mid-slow-mo owes multiple picks, drained one card at a time; the offer is fixed placeholders now and becomes 8.4's weighted seeded draw later.

**Phaser UI is manual-verified.** The overlay + input follow the codebase convention (pause/game-over overlays, restart quad-input, `touchControls` hit-test have no unit tests); the sim-side state machine, state, and wiring carry the automated coverage. Navigation reuses arrows/A-D, so gameplay input must be cleared while the overlay is open or the same keys would steer the ship.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including `levelUpSystem.test.js`, `progressionState.test.js`, `cards.test.js`, and the extended 23-system `buildArenaWorld.test.js`.
- `npm run build` -- expected: production Vite build succeeds (no unresolved imports from the new modules/constants).

**Manual checks:**
- `npm run dev`, play a run: on a level-up the world slows to a crawl (not a freeze) and a three-card overlay appears; navigate with keys/gamepad/touch and confirm — the overlay closes and full speed resumes; the DEV readout's owned-count / debug stat climb by one per pick; standing in the swarm during the pick deals no damage; a big XP jump that crosses two levels at once presents a second card before resuming.

## Spec Change Log

<!-- Append-only. Empty — no bad_spec loopback occurred. -->

## Review Triage Log

### 2026-07-23 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` Blind card-pick on window-refocus during a forced pause (`ArenaScene.js:782-832`). All five card input handlers (nav L/R, keyboard confirm, gamepad `down`, `pointerdown`) gated only on `selectionActive` — not `_paused`. A `forcePause()` (blur/backgrounding, desktop web included) fires MID-selection with the overlay hidden but these event listeners still live; the update loop early-returns while paused so nothing drains the pick. The `pointerdown` path selects by CLICK POSITION, so the very click that refocuses the window silently latches an arbitrary card (whichever rect it lands in) applied on resume — a hole the prior pass's rejection ("merely picks the current focus the player would pick anyway") did not cover for touch/mouse. Confirmed against real code. Fixed: added `|| this._paused` to all five guards (the same `selectionActive && !this._paused` idiom the first pass used on `togglePauseInput`); added `renderIntegration.test.js` VG10 pinning that exactly five handlers carry the pause guard, plus a handler-comment rationale.
  - `[low]` `[patch]` (VG-A) Confirm-grace DECAY unpinned — VG6 pinned only the arm (`= LEVELUP_CONFIRM_GRACE_MS`) and the `> 0` gate, not the `_cardConfirmGraceMs -= delta` decay (`ArenaScene.js:1349`). Dropping the decay pins the grace `> 0` forever → every confirm path early-returns → the pick never drains → `selectionActive` sticks true: a permanent soft-lock shipping with all tests green. Fixed: extended VG6 to also require the decay.
  - `[low]` `[patch]` (VG-B) Paused-overlay-hide pin was incomplete — VG5 is named "hides the WHOLE overlay" but pinned only the four singleton `setVisible(false)` calls, missing the `cardTitles` hide loop (`ArenaScene.js:965-966`). Dropping the loop leaves the three card titles floating over the PAUSED screen while VG5 stays green. Fixed: extended VG5 to require the `cardTitles[i].setVisible(false)` loop.
  - `[low]` `[patch]` (VG-E) "progressionState survives a non-final death" AC had zero coverage — `buildArenaWorld.test.js` asserts only the fresh-build shape; no test drove a death and re-checked progression. Added a `playerDeathSystem.test.js` behavioral guard: seed `progressionState` via `applyCard`, drive a real lethal contact (life lost, respawn, not game-over), assert progression is byte-for-byte unchanged. Guards against a future death-path edit clearing progression the way it already resets the multiplier.
- Rejected (noise / by-design / speculative / manual-verify convention — several re-raised from prior passes and still not this story's problem): gamepad B/face-buttons all confirm (deliberate prior-pass leniency, no cancel action to conflict); one-frame opening input+dilation leak on the crossing tick (the same self-correcting opening-edge race prior passes rejected — player is invulnerable); `freshOffer` focus-reset keyed on `.slice()` array identity (works this story; a speculative 8.4 weighted-draw concern); indefinite dilation lets spawns accumulate (the intent MANDATES a visible crawling swarm and an indefinite selection — by-design; fast-forward is 8.4/8.5); `gameOver`/`selectionActive` mutual-exclusion unasserted (no active bug — invuln holds the player alive; speculative future hazard); confirm-grace re-arms per owed pick on a multi-level jump (by-design — prevents a held confirm blowing through all owed picks; ~180ms is negligible); confirm-grace decays by an unclamped render delta (speculative frame-spike-coincides-with-buffered-confirm edge; negligible); entire ArenaScene render/input verified by source-text regex only (the established, intent-referenced manual-verify convention — "Phaser UI is manual-verified"; the load-bearing gates are source-text-pinned); grace-gated tap swallows focus feedback in the first 180ms (cosmetic); (VG-C) gamepad nav poll unpinned and (VG-D) `setVisible(cardsOpen)` show-toggle unpinned (both manual-verify convention — no defect, and a hidden overlay is caught the instant anyone plays; the behavioral soft-lock/AC gaps VG-A/VG-B/VG-E are the ones worth pinning).

### 2026-07-23 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[medium]` `[patch]` Landing invuln CLOBBERED a larger active window (`LevelUpSystem.js:107`). The final-pick landing grant was an unconditional `this.playerState.invulnMs = LEVELUP_LANDING_INVULN_MS` (800). A player who levels up while a bigger invuln is counting down (a fresh `PLAYER_INVULN_MS = 2000` respawn shield mid-run) had the last ~1200ms of earned i-frames silently discarded — an unfair death dropping back into the crawled swarm. The step-3 floor top-up (`< FLOOR`) correctly preserved 2000, but the landing line overwrote it. Fixed: `Math.max(this.playerState.invulnMs, LEVELUP_LANDING_INVULN_MS)`; added a `levelUpSystem.test.js` case (start `invulnMs` above landing, final pick, assert preserved) that also closes the previously-untested `> FLOOR` branch.
  - `[low]` `[patch]` Held touch stranded a stick on overlay CLOSE (`ArenaScene.js`). A card tap shares `pointerdown` with the twin-stick sampler, so a finger still held when the pick drains leaves a stick anchored — masked by `inputState.clear()` only while `selectionActive`. On close it steered/aimed the ship the instant full speed resumed. The pause path already `resetTouch()`es on its edge; the close path did not. Fixed: `resetTouch()` on the `selectionActive` true→false edge (+ VG8 source-text pin).
  - `[low]` `[patch]` (VG4) Input-suppression ORDERING unpinned — the existing VG2 pin asserts only that the `clear()`+`consumeBomb()` block exists; hoisting it above `inputSampler.sample()` would still match VG2 yet let `sample()` re-populate intent after the clear (ship steers under the modal). Added a pin that `sample()` precedes the clear block.
  - `[low]` `[patch]` (VG5) Paused-overlay-hide unpinned — the mid-selection forced-pause hide (prevents the card modal stacking under PAUSED, a prior-pass soft-lock fix) had no regression guard. Added a source-text pin on the four-object hide sequence.
  - `[low]` `[patch]` (VG6) Confirm-grace unpinned — the `_cardConfirmGraceMs` arm + `> 0` gate (prior-pass instant-auto-pick fix) had no guard. Added pins on both the arm and the gate.
  - `[low]` `[patch]` (VG7) Focus-reset unpinned — the `roseActive || freshOffer → _cardFocus = 0` reset (prior-pass stale-focus fix) had no guard. Added a source-text pin.
  - `[low]` `[patch]` (VG9) Gamepad face-button restriction unpinned — the `idx >= 0 && idx <= 3` confirm gate (prior-pass "any button confirmed card 0" fix) had no guard. Added a source-text pin.
- Rejected (noise / by-design / speculative / intent-referenced convention): confirm latency at the dilated step rate (~110ms — an inherent consequence of the intent-mandated "latch the choice, drain in the sim" architecture; no clean fix within the contract); card nav/confirm not gated on `_paused` (negligible harm — a force-paused, overlay-hidden state is resumed via Esc/P, and a confirm there merely picks the current focus the player would pick anyway); gamepad confirm accepting all four face buttons vs the "A to confirm" prompt (deliberate prior-pass leniency; there is no cancel action for B to conflict with); crossing-tick bomb not suppressed and dilation one frame late (the same one-frame opening-edge race the prior pass already rejected — self-corrects next tick, player is invulnerable); focus-reset clobbering a same-frame nav input (the reset is intended; the same-frame race is negligible); gamepad non-standard button indices (speculative, degrades gracefully — stick nav still works); unbounded `pendingSelections` / no skip (the designed multi-level queue; fast-forward is an 8.4/8.5 concern); stacked `pointerdown` listeners with no central dispatch (the one real non-disjoint instance is patched above; the rest is speculative); landing grace granted on a same-tick re-crossing (a benign over-grant of invuln, never an under-grant); nav-wrap and touch-hit-test having no executed coverage (the intent explicitly models this input tier on the restart quad-input and the untested `touchControls` geometric hit-test — behavioral tests here would require a refactor the intent does not call for; the load-bearing gates are source-text-pinned); timeScale hit-stop nesting not structurally pinned (the precedence is in place; a regex nesting-pin is brittle and low-value).

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 1, medium 1, low 6)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[high]` `[patch]` Pause-during-selection deadlock + stacked overlays (`ArenaScene.js`). The `togglePauseInput` guard `if (selectionActive) return;` blocked BOTH entering AND resuming pause, but `nativeLifecycle.forcePause()`→`setPaused(true)` fires on any platform (desktop web `visibilitychange` included) with no foreground auto-resume; a paused sim early-returns before `advance`, so `LevelUpSystem` never drains the selection → `selectionActive` sticks true and Esc/P can't resume → unrecoverable desktop soft-lock, with the card modal stacked under PAUSED. Fixed: guard changed to `selectionActive && !this._paused` (blocks entering, allows resuming); the paused early-return now hides all level-up overlay objects.
  - `[medium]` `[patch]` Gamepad could not navigate + misleading prompt (`ArenaScene.js`). Only `gamepad.on('down', confirm)` existed (any button confirmed card 0) while the prompt said "Stick / D-pad to choose". Fixed: confirm restricted to face buttons (indices 0–3); edge-latched d-pad (buttons 14/15) + left-stick-horizontal navigation polled in `update()`; prompt corrected to "A to confirm".
  - `[low]` `[patch]` Instant-confirm on open (`ArenaScene.js`) — a confirm edge in flight when a level-up fired mid-combat auto-picked the default card. Fixed: a render-owned `_cardConfirmGraceMs` (`LEVELUP_CONFIRM_GRACE_MS = 180`) armed on the overlay-open edge gates all confirm paths; navigation stays allowed.
  - `[low]` `[patch]` Stale `_cardFocus` (`ArenaScene.js`) carried across overlays. Fixed: focus resets to 0 on the `selectionActive` false→true edge and on a fresh offer mid multi-level jump.
  - `[low]` `[patch]` Thin landing invuln (`LevelUpSystem.js`) — only the ~200ms floor remained on close, risking an unavoidable death dropping back into the crawled swarm. Fixed: the pick that empties the queue grants `LEVELUP_LANDING_INVULN_MS = 800`; non-final picks keep the floor re-arm (both covered by new tests).
  - `[low]` `[patch]` (VG1) Dilation gate unpinned — added a `renderIntegration.test.js` source-text assertion on `const timeScale = this.levelUpSystem.selectionActive ? LEVELUP_TIME_SCALE : 1`.
  - `[low]` `[patch]` (VG2) Input-suppression block unpinned — added a source-text assertion on the `selectionActive` → `inputState.clear()` + `consumeBomb()` block.
  - `[low]` `[patch]` (VG3) Pause guard unpinned — added a source-text assertion on `selectionActive && !this._paused`.
- Rejected (noise / by-design / speculative / firm-contract): offer-≠-3 soft-lock and the "exactly three" magic-number-in-5-places (the epic fixes the offer at exactly three — a firm contract, not a defect); orbs collected during slow-mo enqueuing more picks (the designed multi-level queue behavior, an I/O-matrix row); touch card-tap sharing `pointerdown` with the virtual stick (input is cleared each frame while selecting; speculative, no repro); per-frame overlay `setVisible`/redraw (matches the codebase's per-frame pause/game-over overlay convention; negligible); `consumeBomb()` dropping a same-frame bomb (spec-intended suppression); the one-frame opening-edge bomb race (self-corrects next frame, negligible, no clean fix — player is invulnerable); "add headless scene-interaction tests" (Phaser render/input is manual-verified per codebase convention; the load-bearing gates are now source-text-pinned via VG1–3).

## Auto Run Result

Status: done

**Summary:** Follow-up review pass (pass 3) over the committed Story 8.3 implementation (level-up moment: 0.15× time dilation, indefinite invuln hold, modal three-card draft overlay across keyboard/gamepad/touch, run-scoped `progressionState`). Four independent adversarial review layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel. One genuine new defect and three verification-coverage gaps were patched; eleven findings rejected (most re-raised from the two prior passes and still by-design/speculative/convention).

**Files changed (this pass):**
- `src/scenes/ArenaScene.js` — pause-guard all five card input handlers (`|| this._paused`) so a forced pause mid-selection can't blind-pick a card on window-refocus; added handler-comment rationale.
- `src/scenes/renderIntegration.test.js` — VG5 extended to pin the `cardTitles` hide loop; VG6 extended to pin the confirm-grace `-= delta` decay (soft-lock guard); new VG10 pinning all five handlers carry the pause guard.
- `src/systems/playerDeathSystem.test.js` — new behavioral test: a non-final death leaves `progressionState` byte-for-byte unchanged (covers the previously-untested AC).
- `_bmad-output/implementation-artifacts/spec-8-3-level-up-moment-and-card-ui.md` — this triage log + result.

**Review findings breakdown:** patch 4 (high 0, medium 0, low 4); defer 0; reject 11; intent_gap 0; bad_spec 0.
- Patches: (1) blind card-pick on refocus during forced pause — the `pointerdown` handler selects by click position, so a refocus click latched an arbitrary pick; (2) VG-A confirm-grace decay unpinned (silent soft-lock if dropped); (3) VG-B paused-overlay-hide pin missed the card titles; (4) VG-E "survives non-final death" AC had zero coverage.
- No deferrals → deferred-work ledger unchanged (per the invocation constraint, new entries only, none created).

**Follow-up review recommendation:** `false`. Patched this pass: high 0, medium 0, low 4. Score = 3×0 + 1×4 = 4 (< 5), no high → false.

**Verification:**
- `npm test` — 63 files, 1111 tests pass (includes the extended VG5/VG6, new VG10, and the new death-persistence test).
- `npm run build` — production Vite build succeeds (91 modules).
- Targeted re-run of the two modified test files: 84 tests pass.

**Residual artifacts (not part of this change, left in place):** `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified before this session — orchestrator-owned state).

**Residual risks:** The entire ArenaScene render/input surface remains verified by source-text pins rather than headless behavioral tests — an accepted, intent-referenced convention ("Phaser UI is manual-verified"); the load-bearing gates (dilation, input suppression, pause guard, grace arm/gate/decay, overlay hide, pause-guard on all handlers) are now source-text-pinned. The `freshOffer` focus-reset keys on `.slice()` array identity, which is correct for this story's fixed placeholder trio but is a seam Story 8.4's weighted draw must preserve (noted, not a current defect).

