---
title: 'Story 1.6 — Score and HUD'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '55b594a454b337f06017c7718a530b13a7cfd592'
final_revision: 'c0ee0c127c789790f2e210e4fed64e09ce65dc59'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Bullets destroy seekers and lives run out into a `gameOver` flag (Stories 1.4/1.5), but nothing scores a kill, nothing shows score or lives, and `gameOver` has no on-screen consequence — the run has no readout and no way to start again, so the core loop can't be read or replayed.

**Approach:** Add a Phaser-free `ScoreState` (`{ score }`) and a Phaser-free `ScoringSystem` that, each fixed step, credits the base value of every seeker the `CollisionSystem` destroyed that tick (the Seeker carries its own base `score`; `CollisionSystem` reports its per-tick kills). `ArenaScene` draws a HUD (score + remaining lives) each render frame, and on `gameOver` freezes the simulation and shows a game-over overlay (final score + restart prompt) whose restart begins a fresh run via `scene.restart()`. No multiplier (Epic 3).

## Boundaries & Constraints

**Always:**
- Score is credited only inside `world.fixedUpdate(dt)`: each tick `ScoringSystem` reads the seekers `CollisionSystem` destroyed this tick and adds each one's base `score` to `ScoreState.score`. One kill adds exactly its base value; N kills in one tick add the sum; no kills add nothing.
- The awarded value is the enemy's own base per-type value (`Seeker.score = SEEKER_SCORE`), summed across kills — never multiplied (the multiplier arrives in Epic 3 / Story 3.1).
- `CollisionSystem` exposes the seekers it destroyed this tick in a reusable public array (`killedSeekers`), reset at the top of every `fixedUpdate` so a tick with no kills reports an empty list and kills are never counted twice across ticks. Its existing bullet/seeker release behavior is unchanged.
- `ScoringSystem` runs after `CollisionSystem` (so the kills for this tick are already recorded) and adds zero steady-state allocation (reuses the reported array, allocates no per-tick structures).
- System order becomes: SimClock → PlayerMovement → Firing → Enemy → Collision → Scoring → PlayerDeath.
- The HUD shows current `ScoreState.score` and current `PlayerState.lives`, read fresh each render frame, so both reflect a kill or a death on the very next frame (immediate update).
- On `PlayerState.gameOver`, `ArenaScene` stops advancing the simulation (stops feeding the fixed-timestep accumulator) so the displayed score is final and stable, and shows a game-over overlay with the final score and a restart prompt.
- Restart begins a fresh run cleanly via `this.scene.restart()` — re-running `create()` rebuilds pools, ship, `PlayerState`, and `ScoreState` from zero (score 0, full lives, no active seekers/bullets). Restart is only accepted while `gameOver` is true.
- `ScoreState` and `ScoringSystem` are Phaser-free and unit-testable headlessly under Vitest; the `CollisionSystem.killedSeekers` reporting is likewise unit-tested.
- Every tunable/layout magnitude (base seeker score, HUD/overlay fonts and colors) is a named constant in `src/config/constants.js` — no inline magic numbers.

**Block If:**
- (none anticipated — this story adds to established pool/system/state/scene patterns already in the codebase.)

**Never:**
- Do not implement the score multiplier, multiplier HUD, or multiplier-on-death reset — Epic 3 / Story 3.1 (FR7 multiplier half, FR8).
- Do not build a title screen, settings, pause, or the full game-flow state machine (title → play → game over → restart/title) — Stories 5.1–5.3. This story's flow is only: play → game over → fresh run.
- Do not add extra-lives-at-score-thresholds, smart bombs, or persistent/high-score storage — Epic 3 (3.2/3.3/3.4).
- Do not change `CollisionSystem`'s destruction rules or `PlayerDeathSystem`'s death/respawn/invulnerability logic — only read their results.
- Do not add particle bursts, screen shake, flash, neon/bloom, or any death/score aesthetic — placeholder text/shapes only (Epic 4). The debug readout stays as-is.
- Do not credit score from ship↔enemy contact or any path other than a `CollisionSystem` bullet-kill.

## I/O & Edge-Case Matrix

`ScoringSystem.fixedUpdate(dt)` — constructed with `(collisionSystem, scoreState)`; reads `collisionSystem.killedSeekers`:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No kills this tick | `killedSeekers` empty | `scoreState.score` unchanged | No error expected |
| One kill | `killedSeekers` = `[seeker]` with `score = SEEKER_SCORE` | `scoreState.score += SEEKER_SCORE` | No error expected |
| Multiple kills, one tick | `killedSeekers` = three seekers | `scoreState.score += 3 × SEEKER_SCORE` | No error expected |
| Kills across ticks accumulate | tick A one kill, tick B one kill | after B, `scoreState.score == 2 × SEEKER_SCORE` | No error expected |
| No double count | tick A one kill; tick B `killedSeekers` empty | after B, score stays at tick-A total (not re-added) | No error expected |

`CollisionSystem.killedSeekers` (extended behavior):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kill recorded | one bullet overlaps one seeker | after tick, `killedSeekers` length 1 == the destroyed seeker; pools released as before | No error expected |
| No kill | bullet far from seeker | after tick, `killedSeekers` length 0 | No error expected |
| Reset between ticks | tick A kills one; tick B has no overlap | after B, `killedSeekers` length 0 (previous kill cleared) | No error expected |
| Two kills one tick | two bullets each over a distinct seeker | after tick, `killedSeekers` length 2 | No error expected |
| Seeker base value | `createSeeker()` | instance has `score == SEEKER_SCORE` | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- EDIT: add `SEEKER_SCORE` (gameplay), and HUD/overlay layout constants (`COLOR_HUD_TEXT`, `HUD_FONT`, `COLOR_GAMEOVER_OVERLAY`, `GAMEOVER_OVERLAY_ALPHA`, `COLOR_GAMEOVER_TEXT`, `GAMEOVER_TITLE_FONT`, `GAMEOVER_SCORE_FONT`, `GAMEOVER_PROMPT_FONT`).
- `src/entities/Seeker.js` -- EDIT: add `score: SEEKER_SCORE` to the factory shape — the base per-type value, so scoring reads it per-instance (extensible to future enemy types).
- `src/state/ScoreState.js` -- NEW (Phaser-free): `createScoreState()` → `{ score: 0 }`. Shared run-economy state, mirroring `PlayerState`; read by the HUD/game-over screen.
- `src/systems/CollisionSystem.js` -- EDIT: add a reusable public `killedSeekers` array; reset it at the top of `fixedUpdate`; push each seeker released in pass 2. Release rules unchanged.
- `src/systems/ScoringSystem.js` -- NEW (Phaser-free): reads `(collisionSystem, scoreState)`; each fixed step sums `killedSeekers[i].score` into `scoreState.score`. Owns no pool/state; zero steady-state allocation.
- `src/scenes/ArenaScene.js` -- EDIT: create `ScoreState`; register `ScoringSystem` after `CollisionSystem`; draw HUD (score + lives) each frame; freeze the sim and show a game-over overlay (final score + restart prompt) while `gameOver`; wire restart (Enter/Space/click → `scene.restart()`).
- `src/systems/scoringSystem.test.js` -- NEW: unit tests for every `ScoringSystem` I/O matrix row.
- `src/systems/collisionSystem.test.js` -- EDIT: add tests for the `killedSeekers` reporting rows and the `createSeeker().score` value.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `SEEKER_SCORE` (e.g. 100) plus the HUD/overlay font/color constants, documented and tunable -- keeps score value and HUD layout centralized.
- `src/entities/Seeker.js` -- add `score: SEEKER_SCORE` to `createSeeker()` -- the base per-type value scoring reads.
- `src/state/ScoreState.js` -- implement `createScoreState()` returning `{ score: 0 }` -- shared run-economy state.
- `src/systems/CollisionSystem.js` -- add reusable `killedSeekers` array; reset at top of `fixedUpdate`; record released seekers in pass 2 -- reports per-tick kills without changing destruction rules.
- `src/systems/ScoringSystem.js` -- implement `fixedUpdate(dt)`: sum `collisionSystem.killedSeekers[i].score` into `scoreState.score` -- the kill→score seam.
- `src/scenes/ArenaScene.js` -- create `ScoreState`; `addSystem(new ScoringSystem(collisionSystem, scoreState))` after `CollisionSystem`; add HUD text (score + lives) refreshed each frame; on `gameOver` skip `fixedTimestep.advance` and render a game-over overlay (final score + restart prompt); accept Enter/Space/pointer to `scene.restart()` only while `gameOver` -- wires scoring, live HUD, and game-over/restart into the scene.
- `src/systems/scoringSystem.test.js` -- unit-test every `ScoringSystem` matrix row -- proves scoring headlessly.
- `src/systems/collisionSystem.test.js` -- add `killedSeekers` reporting tests and `createSeeker().score` -- proves the kill-reporting seam and base value.

**Acceptance Criteria:**
- Given the game is running, when a player bullet destroys a seeker, then the score increases by the seeker's base value (no multiplier) and the on-screen score reflects it on the next render frame (FR7).
- Given the game is running, when the player looks at the HUD, then the current score and remaining lives are both displayed and each updates immediately when it changes.
- Given the player loses their last life, when `gameOver` is reached, then the simulation stops advancing, a game-over screen shows the final (now-stable) score, and a restart affordance is offered.
- Given the game-over screen, when the player triggers restart, then a fresh run begins with score 0, full lives, and no carryover entities (FR14).
- Given the codebase, when a reviewer inspects it, then `ScoreState` and `ScoringSystem` are Phaser-free, `ScoringSystem` runs inside `world.fixedUpdate(dt)` after `CollisionSystem`, and scoring plus the `killedSeekers` reporting are covered by passing unit tests.
- Given `npm test` and `npm run build`, when they run, then all unit tests pass and the production build completes, both with exit code 0.

## Spec Change Log

_No entries — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` Game-over sim-freeze was checked once per render frame, wrapping the whole `fixedTimestep.advance()`; since `advance()` runs up to `MAX_SUB_STEPS` (5) sub-steps, a death on a non-final sub-step of a lag-spike frame let later sub-steps keep running EnemySystem/CollisionSystem/ScoringSystem, so the "final" score could climb after death — violating the spec's "displayed score is final and stable" invariant. Fixed by moving the `gameOver` check inside the per-sub-step callback (`advance(delta, (dt) => { if (!gameOver) world.fixedUpdate(dt); })`) so each sub-step re-reads it and halts the sim the instant death latches. `npm test` (99 pass) and `npm run build` re-run green. (Converged: adversarial, edge-case.)
- deferred:
  - The `ArenaScene` scoring/HUD/game-over integration surface — the load-bearing Collision→Scoring registration order (so `ScoringSystem` reads `killedSeekers` after `CollisionSystem` fills+resets it), the game-over sim-freeze gate, and the restart-guard input wiring — has no automated coverage. Three review layers converged (adversarial, verification-gap, intent-alignment): `scoringSystem.test.js` stubs the collision system, `collisionSystem.test.js` never invokes scoring, and no test composes the real pair through `World`, so a reordered `addSystem`, a dropped freeze guard, or an inverted restart guard would ship green. The system-order piece is headlessly testable; the rest is the deliberately-thin Phaser/scene boundary. Recorded to `deferred-work.md` — the same orchestrator-owned scene/World harness gap deferred by Stories 1.1–1.5.
- rejected (out-of-scope on the intent's authority / precedent-rejected / not a present defect):
  - Restart listeners re-registered every `create()`/`scene.restart()` could leak stale closures that restart a live run — not a present defect: Phaser's scene input/keyboard plugins remove `create()`-registered listeners on shutdown, and the `if (gameOver)` guard reads the current (post-restart) `playerState`, so any stale handler is a no-op. (Edge-case hunter independently concluded "handled.")
  - `killedSeekers` holds seeker instances already released to the pool — safe: the only consumer is the same-tick `ScoringSystem` (runs immediately after), and the array is reset before any re-acquire. A future cross-tick consumer is speculative (matches the "future-field speculative" rejection class from 1.5).
  - `_spawnOne()` never re-assigns `score`, so a recycled instance keeps its prior value — no present defect: `score` is the invariant `SEEKER_SCORE` on every instance (factory-set, never mutated); the multi-type-shared-pool scenario is speculative and counter to the per-type-pool architecture (bullets/seekers already have separate pools).
  - No re-entrancy guard on the three restart triggers firing in one frame — speculative: `scene.restart()` queues a single pending restart on the scene manager; no evidence stacked calls double-teardown or throw.
  - Game-over overlay z-order dims the HUD/debug text and duplicates the score — cosmetic and placeholder-only; the intent requires the game-over screen to show the final score (it does), and the neon/aesthetic layer is explicitly Epic 4.
  - `ScoringSystem` constructor doesn't fail-fast on a missing `killedSeekers` — matches sibling-system precedent: neither `CollisionSystem` nor `PlayerDeathSystem` validates its injected pools/state; adding a guard here would be inconsistent.
  - Per-frame `hudText.setText`/`gameOverScore.setText` string churn — precedent-accepted: the existing `debugText.setText` runs every render frame identically, and NFR2's zero-per-frame-allocation guarantee targets the pooled-entity sim path, not render-layer text. The associated "comment misrepresents behavior" claim is incorrect — the comment accurately says the render loop sets visibility and the final-score text.
  - `this.input.keyboard.on(...)` assumes the keyboard plugin is non-null — keyboard input is on by default in Phaser and is already relied upon by `PlayerInputSampler` (WASD/arrows); a config that disables it is a speculative non-production change.

## Design Notes

Dedicated `ScoringSystem` (not folded into `CollisionSystem`): scoring is a distinct concern from "detect overlap and release pooled entities," matching the one-system-per-concern architecture (Movement, Firing, Enemy, Collision, PlayerDeath) the epic anticipates. The only producer of a "bullet killed a seeker" event is `CollisionSystem`, and a kill is a transient event (not inferable from pool counts, since spawns also change them), so `CollisionSystem` reports its per-tick kills via a reusable public `killedSeekers` array and `ScoringSystem` consumes it — the same "systems read siblings' public fields" pattern `ArenaScene`/`CollisionSystem` already use for pools. The seeker carries its own base `score` so the model is per-type and extends to Epic 2 enemy types and the Epic 3 multiplier without reshaping this seam.

`ScoringSystem.fixedUpdate`:

```js
fixedUpdate(_dt) {
  const killed = this.collisionSystem.killedSeekers;
  for (let i = 0; i < killed.length; i++) {
    this.scoreState.score += killed[i].score;
  }
}
```

Game-over handling is scene-local and deliberately minimal — not the Story 5.3 state machine. Freezing means `ArenaScene.update` simply stops calling `fixedTimestep.advance` while `gameOver`, so no system runs, the score is final, and `gameOver` is stable; the HUD/overlay still render. Restart is `this.scene.restart()`, which re-runs `create()` and rebuilds every run-scoped object (pools, ship, `PlayerState`, `ScoreState`) from scratch — a clean fresh run without inventing a state machine.

The HUD, game-over overlay, freeze gate, and restart input live in `ArenaScene` (Phaser) — the same deliberately-thin scene/integration boundary Stories 1.1–1.5 left to `npm run dev` verification and recorded to `deferred-work.md`. The Phaser-free scoring core (`ScoreState`, `ScoringSystem`, `killedSeekers`) is fully unit-tested.

## Verification

**Commands:**
- `npm test` -- expected: exit 0; all suites pass, including the new `scoringSystem` tests and the extended `collisionSystem` tests.
- `npm run build` -- expected: exit 0; `dist/` bundle emitted (the >500 kB Phaser chunk-size warning is expected and out of scope).

**Manual checks (if no CLI):**
- `npm run dev`: destroy seekers and watch the HUD score climb by the base value per kill and lives drop on each death, both immediately. Let all lives run out — the arena freezes, a game-over screen shows the final score, and pressing Enter/Space or clicking starts a clean fresh run (score 0, full lives).

## Auto Run Result

Status: done

**Summary:** Implemented Story 1.6 — Score and HUD. Added a shared, Phaser-free `ScoreState` (`{ score }`) and a Phaser-free `ScoringSystem` run inside `world.fixedUpdate(dt)` immediately **after** `CollisionSystem` (order now SimClock → PlayerMovement → Firing → Enemy → Collision → Scoring → PlayerDeath). Each fixed step `ScoringSystem` credits the base value of every seeker `CollisionSystem` destroyed that tick into `ScoreState.score` — one kill adds its base value, N kills add the sum, no kills add nothing, and the value is never multiplied (the multiplier is deferred to Epic 3 / Story 3.1). The base per-type value is carried on each `Seeker` instance (`score = SEEKER_SCORE`) so scoring is per-type and extends to future enemy types; `CollisionSystem` reports its per-tick kills through a reusable public `killedSeekers` array (reset at the top of every `fixedUpdate`, filled alongside release in pass 2), leaving its destruction rules unchanged. `ArenaScene` creates the state, registers the system, draws a top-right HUD (score + lives) refreshed each render frame, and on `PlayerState.gameOver` freezes the simulation and shows a game-over overlay (final score + restart prompt); Enter/Space/pointer begin a fresh run via `scene.restart()`, guarded to fire only while game-over. All feel/layout magnitudes are centralized constants. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel against the diff since baseline `55b594a`; no intent_gap and no bad_spec were found.

**Files changed (reviewed code diff):**
- `src/config/constants.js` — added `SEEKER_SCORE` (100) plus HUD constants (`COLOR_HUD_TEXT`, `HUD_FONT`) and game-over overlay constants (`COLOR_GAMEOVER_OVERLAY`, `GAMEOVER_OVERLAY_ALPHA`, `COLOR_GAMEOVER_TEXT`, `GAMEOVER_TITLE_FONT`, `GAMEOVER_SCORE_FONT`, `GAMEOVER_PROMPT_FONT`), documented and tunable.
- `src/entities/Seeker.js` — added `score: SEEKER_SCORE` to the `createSeeker()` factory shape (base per-type value).
- `src/state/ScoreState.js` — NEW (Phaser-free): `createScoreState()` → `{ score: 0 }`.
- `src/systems/CollisionSystem.js` — added reusable public `killedSeekers` array; reset at top of `fixedUpdate`; record each released seeker in pass 2. Release rules unchanged.
- `src/systems/ScoringSystem.js` — NEW (Phaser-free): sums `collisionSystem.killedSeekers[i].score` into `scoreState.score` each fixed step; zero steady-state allocation.
- `src/scenes/ArenaScene.js` — create `ScoreState`; register `ScoringSystem` after `CollisionSystem`; top-right HUD (score + lives); freeze the sim (per sub-step) and show a game-over overlay while `gameOver`; Enter/Space/pointer restart via `scene.restart()` guarded to `gameOver`.
- `src/systems/scoringSystem.test.js` — NEW: 5 tests covering every `ScoringSystem` I/O matrix row (no kills, one kill, multi-kill one tick, cross-tick accumulation, no double-count).
- `src/systems/collisionSystem.test.js` — added 4 `killedSeekers` reporting tests + `createSeeker().score` value test.

**Review findings breakdown:** patch 1 · defer 1 · reject 8 · intent_gap 0 · bad_spec 0.
- Patched (1, medium): the game-over sim-freeze was gated once per render frame around the whole `fixedTimestep.advance()`, so a death on a non-final sub-step of a multi-sub-step (lag) frame let later sub-steps keep scoring — violating the "final score is stable" invariant. Fixed by moving the `gameOver` check inside the per-sub-step callback (adversarial + edge-case converged).
- Deferred (1, → `deferred-work.md`): the `ArenaScene` scoring/HUD/game-over integration surface — the load-bearing Collision→Scoring registration order, the sim-freeze gate, and the restart-guard wiring — has no automated coverage (adversarial + verification-gap + intent-alignment converged); the same deliberately-thin Phaser/scene boundary deferred by Stories 1.1–1.5.
- Rejected (8): restart-listener leak (Phaser tears listeners down on shutdown; guard reads current state); stale pooled refs in `killedSeekers` (only same-tick consumer); spawn never re-sets `score` (invariant `SEEKER_SCORE`; per-type-pool architecture); restart re-entrancy (speculative; `scene.restart()` idempotent); overlay z-order/duplicate score (cosmetic, placeholder aesthetic → Epic 4); `ScoringSystem` constructor validation (sibling systems don't validate deps); per-frame `setText` churn (matches the existing debug readout; NFR2 targets the pooled path); `this.input.keyboard` null (keyboard on by default, already used by `PlayerInputSampler`).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 1, low 0 → score = 3×1 + 1×0 = 3 (< 5, no high).

**Verification performed:**
- `npm test` → 99/99 pass across 10 files (adds `scoringSystem` 5, extends `collisionSystem` to 12), exit 0 — re-run green after the patch.
- `npm run build` → exit 0; `dist/` bundle emitted (the >500 kB Phaser chunk-size warning is expected and out of scope).
- Matrix Test Audit: all 10 I/O matrix rows (5 `ScoringSystem` + 4 `CollisionSystem.killedSeekers` + 1 `createSeeker().score`) covered by tests that ran and passed.

**Residual risks / artifacts:**
- The deferred `ArenaScene` scoring/HUD/game-over coverage gap remains open (tracked in `deferred-work.md`): a reordered `addSystem` (Scoring before Collision), a dropped freeze guard, or an inverted restart guard would pass the whole headless suite yet be wrong in-game; `npm run dev` is the only live-integration verification, and it was not run in this headless environment.
- Feel/layout constants (`SEEKER_SCORE=100`, HUD/overlay fonts and colors) are first-pass placeholder defaults for hand-tuning; the neon/bloom aesthetic and the full game-flow state machine (title/pause/restart-to-title) remain out of scope (Epic 4 / Story 5.3).
- Residual working-tree artifacts left in place (not part of the reviewed code diff; orchestrator-owned): this spec file, the modified `deferred-work.md`, and `sprint-status.yaml` (still lists `1-6-score-and-hud: backlog` — the orchestrator owns the status flip, per the Story 1.1–1.5 convention).
- `final_revision` recorded in frontmatter after the commit below.
