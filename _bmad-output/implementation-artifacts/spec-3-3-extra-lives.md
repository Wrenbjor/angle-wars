---
title: 'Extra Lives'
type: 'feature'
created: '2026-07-19'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '83ae6daa60b7ae93f1ba00c6b1172553ba5c659a'
baseline_revision: '82af53a13e8e7054dc3d0b4a99387af2283e1688'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The RE1 reward loop is incomplete — the player earns nothing for a long, skilled run. FR10 ("extra lives at score thresholds") does not exist: crossing a milestone score grants no life, so a good run cannot outlast the 3 starting lives.

**Approach:** Add a small `ExtraLifeSystem` that, each fixed step, awards `+1` to `PlayerState.lives` for every entry in a fixed ascending `LIFE_AWARD_SCORE_THRESHOLDS` list the running score has crossed since construction — the same **threshold-crossing-on-a-monotonic-cursor** idiom `BombSystem` uses for its 100k bomb award, but a **defined finite list** (not a repeating interval) and awarding onto the existing lives counter. It reads `ScoreState.score` (never writes it) and mutates `PlayerState.lives`; the HUD already renders `LIVES` from that field, so no HUD change is needed.

## Boundaries & Constraints

**Always:**
- Extra lives are awarded from a fixed **ascending list** of score thresholds (`LIFE_AWARD_SCORE_THRESHOLDS`), each threshold granting exactly **one** life the first time the running score reaches or passes it. A single tick that jumps the score past several thresholds awards one life **per** threshold crossed.
- The award increments `PlayerState.lives` — the single lives counter deaths already decrement. There is no separate life economy: awards and deaths compose on one field, and reaching 0 lives still ends the game exactly as today (FR12).
- Threshold crossing is detected against a **monotonic cursor** (an index into the ascending list) advanced as thresholds are consumed, so each threshold fires exactly once and the score's monotonic growth guarantees no threshold is missed or repeated.
- The cursor is **seeded at construction** from the current score (0 on a fresh run): thresholds already at/below the starting score are skipped, never awarded retroactively (mirrors `BombSystem._scoreCursor = scoreState.score`). A fresh instance per run (via `scene.restart` rebuilding every system) resets the cursor.
- `ExtraLifeSystem` runs **after** `ScoringSystem`, `BlackHoleSystem`, and `BombSystem` (so the score it reads is fully settled this tick, including the black-hole payout) and **before** `PlayerDeathSystem` (so a life earned this tick is banked before the death check — see Design Notes).
- The threshold list is a centralized tunable constant — no inline magic numbers.
- Zero steady-state allocation: the award path is integer comparisons against a module-level constant array and an index; it allocates nothing per tick.

**Block If:**
- (none — the intent, ACs, and epic context fully determine the mechanic. Exact threshold values are explicitly delegated as tunable placeholders "tuned post-launch"; picking RE1-derived placeholders and centralizing them is the delegated decision, not an intent gap.)

**Never:**
- Do not use a repeating "every N points" interval for lives — FR10/the epic context deliberately contrast "bombs at every 100k" with "extra lives at **defined thresholds**"; lives are a finite ordered list, not an interval (that is what bounds them without a cap).
- Do not add a life cap or clamp the award — FR10 specifies none; the finite threshold list bounds total awards naturally.
- Do not reset, lose, or alter awarded lives on death — the award only ever **adds**; the death path is the only place lives decrease, and it is unchanged.
- Do not move lives onto `ScoreState` or touch the score, multiplier, bombs, respawn/invulnerability, game-over lifecycle, or high-score persistence (Stories 3.1 / 3.2 / 3.4). Lives stay on `PlayerState`.
- Do not change the HUD wiring beyond what already renders `LIVES` (it reads `PlayerState.lives` fresh each frame — an award shows on the next frame with no change).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh run start | new state, `score = 0`, `lives = PLAYER_START_LIVES` | cursor seeded past no thresholds; `lives` unchanged until the first threshold | No error expected |
| Score crosses one threshold | cursor at T; `score` rises from `< T` to `≥ T` | `lives += 1`; cursor advances past T | No error expected |
| One tick jumps several thresholds | `score` jumps from below T1 to above T3 (T1<T2<T3) | `lives += 3` (one per crossed threshold); cursor advances past T3 | No error expected |
| Score rises, no threshold crossed | `score` grows but stays between two thresholds | `lives` unchanged; cursor unchanged | No error expected |
| Score reaches a threshold exactly | `score == T` (from `< T`) | counts as crossing: `lives += 1` | No error expected |
| All thresholds already awarded | cursor past the last entry | no further awards regardless of score | No error expected |
| Constructed at a non-zero score | `score` already ≥ some thresholds at construction | those thresholds are seeded-past, never awarded retroactively | No error expected |
| Same-tick threshold cross + lethal contact on last life | `lives = 1`; a kill crosses a threshold AND an active enemy overlaps the ship this tick | ExtraLife banks the life (`lives 1→2`) before PlayerDeath, which then consumes one on the lethal contact → respawn at `lives = 1`; run continues (not game over) | No error expected |
| Last-life death, no threshold crossed | `lives = 1`; lethal contact, score crosses nothing | game over at `lives = 0`, exactly as today | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- run-economy section; add `LIFE_AWARD_SCORE_THRESHOLDS` (ascending array of RE1-derived placeholder milestone scores) with a doc comment mirroring the bomb-award constant.
- `src/state/PlayerState.js` -- unchanged shape; `lives` is already the counter the award increments. (Confirm the doc comment still reads true; no code change required.)
- `src/systems/ExtraLifeSystem.js` (new) -- the award system: read settled `scoreState.score`, award `+1` life per crossed threshold via the index cursor, seeded at construction.
- `src/scenes/ArenaScene.js` -- construct + `addSystem(new ExtraLifeSystem(this.scoreState, this.playerState))` after `BombSystem` and before `PlayerDeathSystem`. HUD already renders `LIVES` (no change).
- `src/systems/extraLifeSystem.test.js` (new) -- unit-cover the I/O matrix rows.
- `src/systems/extraLifeIntegration.test.js` (new) -- compose the real Scoring→Bomb→ExtraLife→PlayerDeath order over one shared state to lock the load-bearing tick placement (same-tick award-then-death rescue; last-life death without a cross still ends the run).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- Add `LIFE_AWARD_SCORE_THRESHOLDS = [100000, 250000, 500000, 1000000]` (ascending) in the run-economy section with a doc comment: defined finite milestone list (NOT a repeating interval, unlike bombs), each awards one life once, tunable placeholders tuned post-launch, no cap. -- Centralize all life-award tuning; encode the finite-list decision at the constant.
- `src/systems/ExtraLifeSystem.js` (new) -- `System` subclass. Constructor `(scoreState, playerState)`; seed `this._nextThresholdIndex` by skipping every threshold `<= scoreState.score`. `fixedUpdate(_dt)`: `while (idx < LIFE_AWARD_SCORE_THRESHOLDS.length && scoreState.score >= LIFE_AWARD_SCORE_THRESHOLDS[idx]) { playerState.lives += 1; idx++; }` then store idx back. Phaser-free; zero per-tick allocation. -- The whole mechanic at one seam, exactly-once via the monotonic index.
- `src/scenes/ArenaScene.js` -- Import and construct `new ExtraLifeSystem(this.scoreState, this.playerState)`; `world.addSystem` it AFTER `this.bombSystem` and BEFORE `this.playerDeathSystem`, with a comment explaining the settled-score + banked-before-death placement. No HUD/render change (LIVES already drawn from `PlayerState.lives`). -- Wire the system at the load-bearing tick position.
- `src/systems/extraLifeSystem.test.js` (new) -- Cover the I/O matrix: single cross awards one; multi-threshold jump awards N; no-cross no-op; exact-value cross counts; exhausted list no-ops; construction seed skips already-passed thresholds; fresh run stays at `PLAYER_START_LIVES` until the first threshold. -- Locks FR10 mechanics headlessly.
- `src/systems/extraLifeIntegration.test.js` (new) -- Compose real `ScoringSystem`, `BombSystem`, `ExtraLifeSystem`, `PlayerDeathSystem` over one shared `ScoreState`+`PlayerState` in ArenaScene order. Assert: (a) a same-tick threshold-crossing kill on the last life banks the life before the death check → player respawns and the run continues; (b) a last-life lethal contact with no threshold crossed still ends the game at 0 lives. -- Pins the tick placement the feature rests on.

**Acceptance Criteria:**
- Given a run in progress, when the running score crosses a defined life threshold (including a single kill that jumps past several thresholds), then `PlayerState.lives` increases by exactly one per threshold crossed, each threshold awarded once, and the HUD reflects the new count on the next render frame (FR10).
- Given a fresh run, when it starts, then `lives` is `PLAYER_START_LIVES` and no life is awarded until the score reaches the first threshold.
- Given the lives counter, when it is displayed, then it reflects both deaths (Epic 1) and awards consistently on the one `PlayerState.lives` field, and reaching 0 lives still ends the game (FR12).
- Given the existing scoring, death, black-hole, bomb, and multiplier suites, when the suite runs, then all pre-existing behavior still passes (no regression: the multiplier still resets on death, bombs still award at 100k, the score is never mutated by the life award).

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 1: (high 0, medium 0, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` `extraLifeIntegration.test.js` claimed to compose "the exact fixed-step order ArenaScene registers them" and ArenaScene's comment credits the placement with "catches the black-hole payout with no one-tick lag", yet the composed chain OMITTED `BlackHoleSystem` — the load-bearing settled-score-catches-payout seam had zero executing coverage. Added the real `BlackHoleSystem` into the chain at its true position (Collision→Scoring→BlackHole→Bomb→ExtraLife→PlayerDeath), corrected the header comment, and added case `(c)`: a hole detonation whose `BLACKHOLE_SCORE` payout carries the score across the first life threshold awards the life that SAME tick (347 tests pass).
- Deferred (1, low): ExtraLifeSystem's load-bearing tick placement is asserted only inside `extraLifeIntegration.test.js`'s own hardcoded `runTick`; no test binds it to `ArenaScene`'s real `addSystem` registration order, so a future reorder would ship green while breaking the settled-score award and the same-tick rescue. Identical to the repo-wide untested-Phaser-scene gap already deferred for Stories 1.1–3.2; closing it needs a shared ordered-system factory both `ArenaScene` and the integration tests consume (a refactor, not a trivial patch). Logged to the deferred-work ledger.
- Rejected (10, all low): no `gameOver` self-guard on `ExtraLifeSystem` (matches its direct sibling `BombSystem`, which also relies on the external world gate; unreachable in-game since ExtraLife runs before PlayerDeath and the gate stops the whole sim once gameOver latches); no runtime validation that `LIFE_AWARD_SCORE_THRESHOLDS` is strictly ascending (already guarded by an executing unit test that turns CI red on a bad edit — not a silent failure — and runtime validation would diverge from the repo's plain-constant convention); no award juice/feedback (Epic 4 owns aesthetic/juice per intent; the AC only requires the HUD `LIVES` count to update, which it does); cursor seed assumes score 0 at construction (always 0 on a fresh run; the seed is the deliberate no-retroactive-award policy mirroring `BombSystem._scoreCursor`; the continue/restore case is speculative — same as the bomb story's rejected finding); integration case `(a)` coupled to `SCORE_MULTIPLIER_START === 1` (passes for the current tuning; the multiplier starts at 1 by RE1 design and never climbs in a fresh composed state); duplicated crossing-condition seed-vs-tick / "divergent copy of BombSystem" (interval-vs-finite-list are structurally different mechanisms; unifying is over-abstraction, and the inline cursor matches the codebase style); score-monotonicity unenforced (monotonic by construction today — `+=` only; a future penalty mechanic is speculative — same as the bomb story's rejected finding); no e2e multi-threshold-rescue / concurrent bomb+life co-award (a compound of already-proven behaviors: unit multi-threshold awarding + the integration rescue); prose guarantees not enforced / duplicated across files (matches the repo's heavily-documented-header convention — `BombSystem`/`PlayerDeathSystem` do the same; the substantive coverage concerns are the patch + defer above); and the HUD "updates" clause satisfied by pre-existing untested render (the `LIVES` line already renders `PlayerState.lives` each frame — correctly reused; untestable headlessly, exactly as the bomb story rejected for the BOMBS line).

## Design Notes

**Fixed list, not an interval — the load-bearing reading.** FR10 says "extra lives at score **thresholds**" and Story 3.3's AC says "crosses **a defined life threshold**", while the bomb story says "crosses **a multiple of 100,000**". The epic context makes the contrast explicit: "bombs at every 100k, extra lives at **defined thresholds**." Had lives been a repeating interval it would have been worded symmetrically to bombs; it deliberately is not. So lives use a finite ascending list — which is also what bounds total awards without needing a cap. The exact values are placeholders (epic context: "life thresholds … starts from RE1 references and is tuned post-launch. Centralize these as tunable constants"), so `[100000, 250000, 500000, 1000000]` is a delegated tuning choice, centralized like every other placeholder in this codebase.

**Tick placement (after Scoring/BlackHole/Bomb, before PlayerDeath)** mirrors `BombSystem`'s reasoning:
- *After Scoring + BlackHole* → the score read is fully settled this tick (a kill's award and the black-hole payout both count toward a threshold with no one-tick lag).
- *Before PlayerDeath* → a life earned this tick is banked before the death check. If a threshold-crossing kill and a lethal contact land on the same tick while on the last life, the earned life is added first (`1→2`), then the death consumes one (`2→1`, respawn) — the player is rescued by the milestone they just earned, symmetric to how a bomb clears enemies before the death check. This also avoids the incoherence of awarding a life *after* game-over has latched (once `gameOver` is set, the whole-tick gate in `ArenaScene.update` stops every system next tick, and within the latching tick ExtraLife has already run). This is a deliberate, player-favorable ordering; it does not violate "reaching 0 ends the game" — the player never reaches 0, they earn a life.

**Exactly-once via a monotonic index.** Because `score` only ever increases and the list is ascending, an index cursor advanced past each consumed threshold fires each exactly once and never rescans awarded entries — O(1) amortized, zero allocation. Seeding it past thresholds already ≤ the construction score prevents a retroactive award if the system is ever constructed at a non-zero score (defensive, mirrors the bomb cursor; currently always 0 on a fresh run).

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `extraLifeSystem` and `extraLifeIntegration` tests; no regression in scoring/death/bomb/black-hole/multiplier suites.
- `npm run build` -- expected: production build completes with no errors.

**Manual checks:**
- Run `npm run dev`, play: the HUD shows `LIVES 3` at start; driving the score across the first threshold increments the displayed life count by one; dying decrements it and reaching 0 still shows GAME OVER.

## Auto Run Result

Status: done

Summary: Implemented FR10 (Story 3.3 Extra Lives) — the RE1 milestone reward. A new `ExtraLifeSystem` awards +1 to `PlayerState.lives` for each entry in a fixed ascending `LIFE_AWARD_SCORE_THRESHOLDS` list the running score reaches or passes, detected via a monotonic index cursor so each threshold fires exactly once (even when one tick jumps past several). Wired into `ArenaScene` after Scoring/BlackHole/Bomb (settled score) and before PlayerDeath (an earned life is banked before the death check → a threshold-crossing kill on the last life rescues the player). Reads score, never writes it; only ever adds to the single lives counter deaths decrement; reaching 0 lives still ends the game. The HUD already renders `LIVES` from that field, so no render change was needed. The finite-list-not-interval reading is anchored on the epic context's explicit contrast ("bombs at every 100k, extra lives at *defined thresholds*"); exact values are delegated tunable placeholders.

Files changed this run:
- `src/config/constants.js` — added `LIFE_AWARD_SCORE_THRESHOLDS = [100000, 250000, 500000, 1000000]` with a doc comment encoding the finite-list / no-cap decision.
- `src/systems/ExtraLifeSystem.js` (new) — the Phaser-free award system: monotonic-index cursor, seeded at construction to skip already-passed thresholds; zero per-tick allocation.
- `src/scenes/ArenaScene.js` — constructed and `addSystem`'d `ExtraLifeSystem` after `BombSystem` and before `PlayerDeathSystem`, with a comment explaining the load-bearing placement.
- `src/systems/extraLifeSystem.test.js` (new) — 9 unit tests covering every I/O-matrix row plus the strictly-ascending-list invariant and never-writes-score.
- `src/systems/extraLifeIntegration.test.js` (new) — 4 tests composing the real Collision→Scoring→BlackHole→Bomb→ExtraLife→PlayerDeath chain: (a) same-tick last-life rescue, (b) last-life death with no cross still ends the game, (c) black-hole payout crossing a threshold awards the life the same tick, plus a fresh-run sanity check.
- `_bmad-output/implementation-artifacts/deferred-work.md` — one new defer entry (unpinned real ArenaScene system order).

Review findings breakdown: patch 1 (low), defer 1 (low), reject 10 (all low); intent_gap 0, bad_spec 0.

Follow-up review recommendation: false — patched findings this pass: 0 high, 0 medium, 1 low; score = 3×0 + 1×1 = 1 (< 5), no high.

Verification performed:
- `npm test` → 22 files, 347 tests pass (extraLifeSystem 9, extraLifeIntegration 4). No regression in the scoring/death/bomb/black-hole/multiplier suites.
- `npm run build` → production build succeeded (vite, 44 modules, no errors; the >500 kB chunk-size notice is pre-existing and unrelated).

Residual risks: the deferred unpinned-tick-order gap (a future `ArenaScene` reorder of `ExtraLifeSystem` would ship green while breaking the settled-score award / same-tick rescue) — same repo-wide untested-scene gap tracked since Story 1.1. Threshold values are delegated tunable placeholders (tuned post-launch); the mechanic itself is fully pinned by tests. The award has no bespoke visual cue yet — juice is Epic 4; the AC-required HUD count update is satisfied by the existing per-frame render.
