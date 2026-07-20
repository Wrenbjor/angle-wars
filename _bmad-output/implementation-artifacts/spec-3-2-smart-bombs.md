---
title: 'Smart Bombs'
type: 'feature'
created: '2026-07-19'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'f97cdadcf02cdbc9e9b602868c5c5ee1fe64d15c'
final_revision: '608a68086eaa893b5c24599f418803fba4474d71'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The RE1 emergency tool is missing — there are no smart bombs. A player caught in a hopeless swarm has no escape, and the FR9 economy (start with 3 bombs, a screen-clear on press, +1 bomb per 100,000 points) does not exist yet.

**Approach:** Add a run-economy bomb count (starts at 3, lives on `ScoreState`, shown on the HUD), an edge-triggered bomb input latched through `InputState`, and a `BombSystem` that on a press clears every active enemy across the four archetype pools by **reusing the existing kill/destruction seam** exactly as the Black Hole absorb does (removed but **not** scored — RE1-faithful), decrements the count, fires a placeholder expanding shockwave, and awards +1 bomb each time the running score crosses a 100,000 boundary.

## Boundaries & Constraints

**Always:**
- Bomb count is run-economy state on `ScoreState`, starts at `BOMB_START_COUNT` (3), rebuilt from zero on a fresh run, visible on the HUD and updated on the next render frame after it changes.
- The bomb input is **edge-triggered** — one detonation per key press — sampled at the Phaser input boundary into `InputState` as a latched request the `BombSystem` consumes (reads-and-clears) each fixed step.
- A press with ≥1 bomb always detonates: it destroys every **active** enemy across the four archetype pools through the shared destruction seam (release to the owning pool **and** append to `collisionSystem.killedEnemies` so owner systems like `SnakeSystem` reconcile), decrements `bombs` by one, and sets the placeholder shockwave countdown at the ship position.
- Bomb-cleared enemies are **not scored** and do **not** advance the multiplier — the bomb is a defensive cost, not a reward (RE1). This is guaranteed structurally by running `BombSystem` **after** `ScoringSystem`, the same way `BlackHoleSystem`'s absorb is unscored.
- `BombSystem` runs **after** `ScoringSystem` and `BlackHoleSystem` and **before** `PlayerDeathSystem`, so (a) cleared enemies are unscored, (b) the score it reads for the bomb award is fully settled this tick (no one-tick lag, and it catches the black-hole payout too), and (c) the clear removes enemies before the death check — a bomb genuinely rescues the player from an otherwise-lethal contact this tick.
- +1 bomb is awarded for each `BOMB_AWARD_SCORE_INTERVAL` (100,000) boundary the running score crosses, detected by comparing a monotonic previous-score cursor to the current total so each boundary fires exactly once even when a single kill jumps past several intervals.
- All tuning (start count, award interval, shockwave duration + placeholder visual) are centralized constants — no inline magic numbers.
- Zero steady-state allocation: the detonation uses reusable scratch (materialize the active sets, release in a second pass), mirroring `CollisionSystem`/`BlackHoleSystem`.

**Block If:**
- (none — the intent, ACs, and epic context fully determine the mechanic.)

**Never:**
- Do not score or multiply bomb-cleared kills (the load-bearing RE1 decision above).
- Do not destroy the Black Hole or any hazard — the bomb clears only the four combat-archetype `enemyPools`; the hole is a separate multi-hit hazard with its own lifecycle and stays lethal through a detonation.
- Do not reset or lose bombs on player death — bombs persist across respawns and game-over; only a fresh run resets them (do not touch `resetMultiplier`).
- Do not change the multiplier, lives, death/respawn/game-over lifecycle, or high-score persistence (Stories 3.1 / 3.3 / 3.4).
- Do not build the final shockwave / screen-shake juice — this story ships a placeholder expanding ring only; Epic 4 owns the real aesthetic.
- Do not add a bomb cap (FR9 specifies none).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Press, bombs remain, enemies present | `bombQueued`, `bombs = b > 0`, N active enemies | all N active enemies released to their owning pools and appended to `killedEnemies` (unscored, multiplier unchanged); `bombs = b − 1`; shockwave countdown set | No error expected |
| Press, no bombs | `bombQueued`, `bombs = 0` | latch consumed/cleared; nothing destroyed; no shockwave; `bombs` stays 0 | No error expected |
| Press, bombs remain, empty arena | `bombQueued`, `bombs = b > 0`, 0 enemies | `bombs = b − 1`; shockwave fired; nothing to destroy | No error expected |
| No press this tick | `bombQueued = false` | no detonation; any running shockwave countdown keeps decaying; `bombs` unchanged | No error expected |
| Score crosses one boundary | cursor 99,000 → score 101,000 | `bombs += 1`; cursor advances to current score | No error expected |
| One kill jumps several boundaries | cursor 90,000 → score 320,000 | `bombs += 3` (one per 100k crossed: 100k/200k/300k) | No error expected |
| Score change, no boundary crossed | 101,000 → 150,000 | `bombs` unchanged | No error expected |
| Multiple key edges before one tick | several presses within a fixed-step window | at most one detonation (single latched request) | No error expected |
| Bomb-cleared active snake chain | a fully active snake present | every segment released + appended to `killedEnemies`; `SnakeSystem` reaps the whole chain to removal on its next tick | No error expected |
| Telegraphing (spawning-in) enemy present | a fresh, still-frozen enemy on screen | it is cleared too — a detonation clears every active pool instance regardless of telegraph state (AC: "all on-screen enemies") | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- run-economy + colors sections; add `BOMB_START_COUNT`, `BOMB_AWARD_SCORE_INTERVAL`, `BOMB_SHOCKWAVE_MS`, `BOMB_SHOCKWAVE_MAX_RADIUS`, `COLOR_BOMB_SHOCKWAVE`.
- `src/state/ScoreState.js` -- add `bombs` to the shape (starts at `BOMB_START_COUNT`); `resetMultiplier` stays untouched so bombs survive death.
- `src/input/InputState.js` -- add the latched bomb request: `bombQueued`, `queueBomb()`, `consumeBomb()`.
- `src/input/PlayerInputSampler.js` -- add the bomb key; on its just-pressed edge call `input.queueBomb()` (the Phaser boundary).
- `src/systems/BombSystem.js` (new) -- the detonation + award system: consume the latched request, clear active enemies through the shared seam (unscored), decrement `bombs`, drive the shockwave countdown, and award +1 bomb per 100k crossing.
- `src/scenes/ArenaScene.js` -- construct + add `BombSystem` after `BlackHoleSystem` and before `PlayerDeathSystem`; add the `BOMBS` line to the HUD; render the placeholder expanding shockwave ring from `BombSystem` state.
- `src/systems/bombSystem.test.js` (new) -- cover the I/O matrix rows.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- Add `BOMB_START_COUNT = 3`, `BOMB_AWARD_SCORE_INTERVAL = 100000`, `BOMB_SHOCKWAVE_MS` (placeholder, e.g. 300), `BOMB_SHOCKWAVE_MAX_RADIUS` (placeholder, e.g. 900), and `COLOR_BOMB_SHOCKWAVE` (placeholder) with doc comments in the run-economy / colors sections. -- Centralize all bomb tuning.
- `src/state/ScoreState.js` -- Extend the shape to `{ score, multiplier, multiplierKills, bombs }` with `bombs` starting at `BOMB_START_COUNT`; leave `resetMultiplier` unchanged. -- Bomb count is run-economy, reset only on a fresh run (never on death).
- `src/input/InputState.js` -- Add `bombQueued = false`, `queueBomb()` (latch true), and `consumeBomb()` (return the flag and clear it). -- The render→sim edge seam for the discrete bomb press.
- `src/input/PlayerInputSampler.js` -- Register a dedicated bomb key in `addKeys` (Left Shift — deliberately NOT Enter/Space/pointer, which are the game-over restart inputs); in `sample()`, on the key's just-down edge (`Phaser.Input.Keyboard.JustDown`) call `input.queueBomb()`. -- Turn a discrete key press into one latched request (keyboard now; gamepad bomb is Epic 5 input polish).
- `src/systems/BombSystem.js` (new) -- `fixedUpdate(dt)`: (1) award +1 bomb per `BOMB_AWARD_SCORE_INTERVAL` crossed since the last-seen score cursor, then advance the cursor; (2) if `consumeBomb()` returns true and `bombs > 0`: release every active enemy across `enemyPools` to its owning pool and append each to `collisionSystem.killedEnemies`, decrement `bombs`, and set `shockwaveMs = BOMB_SHOCKWAVE_MS` at the ship position; (3) decrement `shockwaveMs` by `dt` (clamp at 0). Use reusable scratch (materialize actives + owners, release in a second pass) — no per-tick allocation. -- The whole mechanic at one seam; unscored by construction (runs after `ScoringSystem`).
- `src/scenes/ArenaScene.js` -- Construct `new BombSystem(this.inputState, this.enemyPools, this.collisionSystem, this.scoreState, this.ship)` and add it after `BlackHoleSystem` and before `PlayerDeathSystem`; add a `BOMBS ${bombs}` line to the HUD `setText`; each render frame draw the placeholder expanding shockwave ring from the `BombSystem` state while its countdown runs. -- Wire the system at the load-bearing tick position and make bombs + detonation observable.
- `src/systems/bombSystem.test.js` (new) -- Cover the I/O matrix: detonate clears + decrements + leaves score/multiplier untouched; empty-bomb no-op; threshold award (single, multi-boundary, no-cross); latch single-shot; snake chain routed through `killedEnemies`; shockwave countdown set then decays. -- Locks FR9.

**Acceptance Criteria:**
- Given a fresh run, when it starts, then `bombs` is 3 and the HUD shows the bomb count on the next render frame.
- Given the player has ≥1 bomb, when a bomb press is processed, then every active enemy across all four archetype pools is destroyed, the bomb count decreases by exactly one, and no score is credited and the multiplier does not change for those kills.
- Given the player has 0 bombs, when a bomb press is processed, then nothing is destroyed, the count stays 0, and no detonation occurs.
- Given a run in progress, when the running score crosses a multiple of `BOMB_AWARD_SCORE_INTERVAL` (including a single kill that jumps past several multiples), then the bomb count increases by exactly one per boundary crossed, each boundary awarded once.
- Given the existing collision, scoring, death, and black-hole suites, when the suite runs, then all pre-existing behavior still passes (no regression: the multiplier still advances only on bullet kills, the black-hole payout stays flat, and death still resets the multiplier).

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` bombs-persist-through-death was unverified — added death-seam tests asserting `scoreState.bombs` is untouched after both a respawning death and the final game-over death (FR9).
  - `[medium]` `[patch]` the load-bearing BombSystem tick position (unscored clear / same-tick rescue / Black-Hole-not-cleared) was asserted only in prose or locally-constructed order — added `bombIntegration.test.js` composing the real Collision→Scoring→BlackHole→Bomb→PlayerDeath chain in ArenaScene order.
  - `[low]` `[patch]` the ArenaScene BombSystem "rescues the player" comment was overbroad — qualified it to the four cleared archetype pools (the Black Hole stays lethal through a detonation).
  - `[low]` `[patch]` the PlayerInputSampler bomb-key comment said "Left Shift" but `KC.SHIFT` fires on either Shift — corrected to "Shift".
- Rejected (11, all low): the bomb-does-not-clear-the-Black-Hole behavior (intent-consistent — FR6/FR9 distinguish "enemy" from "hazard"; the epic context says the bomb reuses the *enemy* destruction path, which excludes the hole); the unscored-bomb-kills decision (by-design, RE1 fidelity — scoring bomb kills would windfall points and jump the multiplier, undercutting Design Pillar 1); the Shift key choice (placeholder pending Epic 5 input config); the `_scoreCursor` seed-at-non-zero-score concern (speculative future continue/checkpoint; currently correct); the shockwave placeholder issues (first-frame radius off-by-one, 900px radius exceeding the arena, frozen-on-game-over — all cosmetic placeholder art, replaced by Epic 4, and the game-over freeze is consistent with the existing arena-snapshot convention); the unbounded bomb count + HUD width (FR9 specifies no cap; HUD styling is Epic 4); the 4-line HUD layout (placeholder, Epic 4); the game-over bomb-latch reconstruction coupling (speculative Epic 5 pause/resume; currently correct via scene.restart); and the residual input-sampler/HUD Phaser-glue coverage (untestable headlessly, consistent with the repo-wide untested-scene pattern).

### 2026-07-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[low]` `[patch]` the cross-tick half of the RE1 "not scored" guarantee — bomb kills left on `collisionSystem.killedEnemies` must also not be scored on the *following* tick — was verified only at a single-tick surface. Added `bombIntegration.test.js` case `(a-crosstick)`: it runs a second full tick after a detonation and asserts score/multiplier/progress stay flat, pinning that CollisionSystem wipes the report before ScoringSystem re-reads it.
  - `[low]` `[patch]` `bombIntegration.test.js` `(c)` used a tautological `expect(seeker).toBeDefined()` that observed nothing — replaced with `expect(collisionSystem.killedEnemies).toContain(seeker)`, which actually observes the cleared enemy routed through the shared destruction seam.
- Deferred (1, low): the four-system tick order (Collision→Scoring→BlackHole→Bomb→PlayerDeath) the whole feature rests on is asserted only inside `bombIntegration.test.js`'s own hardcoded `runTick`; no test binds it to `ArenaScene`'s real `addSystem` registration order, so a future reorder in the scene would pass every test while silently breaking the unscored-clear / same-tick-rescue / settled-award guarantees. Consistent with the repo-wide untested-Phaser-scene pattern; closing it needs a shared ordered-system factory that both ArenaScene and the test consume (a refactor, not a trivial patch). Logged to the deferred-work ledger.
- Rejected (13, all low): frozen placeholder shockwave ring over the game-over overlay (cosmetic — the whole arena freezes on game-over by the existing snapshot convention, and shockwave aesthetics are Epic 4 per intent); same-tick shockwave decay eating the cue under catch-up load; shockwave origin frozen at ship position on a same-window respawn (both cosmetic placeholder art, Epic 4); no feedback on a 0-bomb press (the I/O matrix specifies a silent no-op; feedback juice is Epic 4); award assumes monotonic score; `_scoreCursor` seeded at construction (both documented in Design Notes as currently correct — speculative future continue/restore concerns); bomb clears telegraphing enemies (by-design, documented, tested — matches AC "all on-screen enemies"); the `killedEnemies` multi-writer contract lacks a structural guard (no current defect — enforced by tick order and covered by the integration test); no test for the game-over freeze × in-flight shockwave (rejected with its cosmetic root cause); unbounded BOMBS HUD value (FR9 mandates no cap; HUD styling is Epic 4); Shift bomb key (deliberate spec placeholder; rebind/gamepad is Epic 5); and the PlayerInputSampler SHIFT→`queueBomb` edge + the HUD BOMBS-line render being untested (Phaser boundary, untestable headlessly, consistent with the repo-wide untested-scene pattern).

## Design Notes

Placement is load-bearing — `BombSystem` runs **after** `ScoringSystem` + `BlackHoleSystem` and **before** `PlayerDeathSystem`:
- After Scoring → bomb-cleared enemies appended to `killedEnemies` are removed but **not** scored (RE1: bombs award no points/multiplier — the exact pattern `BlackHoleSystem` already uses for absorbed enemies).
- After BlackHole → the score read for the +1-bomb award is fully settled this tick (no one-tick lag; the black-hole payout counts toward thresholds too).
- Before PlayerDeath → the clear removes enemies before the death check, so a bomb genuinely rescues the player from an otherwise-lethal contact this tick.

Why route through `collisionSystem.killedEnemies` instead of releasing enemies directly: an owner system that keeps its own struct list independent of the pool (`SnakeSystem.snakes`) reconciles destroyed instances **only** through that seam. Releasing a snake segment straight to the pool would leave `SnakeSystem` moving a freed (possibly re-acquired) segment. Appending to `killedEnemies` lets `SnakeSystem` reap the whole chain on its next tick — identical to how a bullet kill and a black-hole absorb already work. Non-snake archetypes are pool-only, so the append is harmless for them (foreign instances never match a snake's segments).

The bomb clears **all** active pool instances regardless of telegraph state (AC: "all on-screen enemies"). This differs deliberately from the Black Hole, which leaves telegraphing enemies inert — a decisive player-triggered clear is not the same as a passive gravity field.

Threshold award via a monotonic cursor: `crossed = floor(score / INTERVAL) − floor(cursor / INTERVAL)`; the score only ever increases, so every boundary fires exactly once. No bomb cap (FR9 specifies none).

The expanding shockwave is a placeholder ring driven by a sim-side countdown (`shockwaveMs`, mirroring the existing `telegraphMs` / `invulnMs` idiom) that the render loop reads; the real shockwave + screen-shake juice is Epic 4.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `bombSystem` tests.
- `npm run build` -- expected: production build completes with no errors.

**Manual checks:**
- Run `npm run dev`, play: the HUD shows `BOMBS 3`; pressing the bomb key (Shift) in a swarm clears every enemy with an expanding ring and drops the count by one; a press at 0 bombs does nothing; crossing 100,000 points grants a bomb; dying does not change the bomb count.

## Auto Run Result

Status: done

Summary: Follow-up review pass over the completed Smart Bombs story (Story 3.2). Re-reviewed the full diff since baseline `f97cdad` across four parallel lenses (adversarial, edge-case, verification-gap, intent-alignment). The core mechanic is confirmed correct — unscored clear via the shared `killedEnemies` seam, single-shot latch, bomb-persistence across death, and the load-bearing tick placement (Collision→Scoring→BlackHole→Bomb→PlayerDeath) all hold. Two low-severity test-hardening patches applied; one coverage gap deferred; 13 findings rejected.

Files changed this pass:
- `src/systems/bombIntegration.test.js` — added `(a-crosstick)` test asserting bomb kills stay unscored on the FOLLOWING tick (CollisionSystem wipes the report before ScoringSystem re-reads); replaced a tautological `expect(seeker).toBeDefined()` with a `killedEnemies` containment check that actually observes the destruction seam.
- `_bmad-output/implementation-artifacts/deferred-work.md` — one new entry: the ArenaScene `addSystem` tick order is unverified against the real scene.
- `_bmad-output/implementation-artifacts/spec-3-2-smart-bombs.md` — Review Triage Log + frontmatter (status, followup flag, final_revision).

Review findings breakdown: patch 2 (all low), defer 1 (low), reject 13 (all low); intent_gap 0, bad_spec 0.

Follow-up review recommendation: false — patched findings only: 0 high, 0 medium, 2 low; score = 3×0 + 1×2 = 2 (< 5), no high.

Verification performed:
- `npm test` → 20 files, 334 tests pass (bombIntegration now 6 tests incl. the new cross-tick case).
- `npm run build` → production build succeeded (vite, 43 modules, no errors).

Residual risks: the deferred ArenaScene tick-order coverage gap (a scene reorder would ship green while breaking the unscored-clear / same-tick-rescue / settled-award guarantees). Placeholder shockwave cosmetics and input rebinding remain owned by Epics 4/5 per the intent. `sprint-status.yaml` carried a pre-existing working-tree modification (orchestrator bookkeeping), committed with this pass.

