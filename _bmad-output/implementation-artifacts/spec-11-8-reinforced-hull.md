---
title: 'Story 11.8 — Reinforced Hull'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 'c7cf001c7d0f979e9c0148055e4e34c919098bc9'
review_loop_iteration: 2
followup_review_recommended: false
final_revision: '5a76716118b6049a085ddc013c2714cc98eb487e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 11's eighth exotic item and fourth DEFENSE item. The player's survival pool and error tolerance are fixed (1 starting life, 2s respawn i-frames, and total multiplier wipe to 1× on death).

**Approach:** Add the data-driven `reinforced-hull` defense item definition with 5 per-level TOTALS maps in `src/config/itemRegistry.js`. Register three fields in `PlayerStats.js` (`extraLives`, `respawnIFramesMs`, `softenMultiplierReset`). Extend `PlayerDeathSystem.js` and `ScoreState.js` to grant extra lives on level pick delta, scale respawn invulnerability by `respawnIFramesMs` (yielding 3.5s i-frames at Lv2+), and halve run multiplier on death when `softenMultiplierReset >= 1` (Lv4+). Wire `playerStats` into `PlayerDeathSystem` in `buildArenaWorld.js`.

## Boundaries & Constraints

**Always:**
- `reinforced-hull` fold fields base cleanly in `PLAYER_STATS_BASE`: `extraLives` (base 0), `respawnIFramesMs` (base 0), `softenMultiplierReset` (base 0). Unowned Reinforced Hull yields byte-identical pre-11.8 player death and multiplier behavior.
- `extraLives` delta on level change grants +1 to `playerState.lives` immediately when `extraLives` increases (at Lv1, Lv3, Lv5).
- Respawn invulnerability duration is `PLAYER_INVULN_MS` (2000ms) + `playerStats.respawnIFramesMs` (1500ms at Lv2+, totaling 3500ms = 3.5s).
- On death with `softenMultiplierReset >= 1` (Lv4+), `resetMultiplier` drops `ScoreState.multiplier` to 50% (`Math.max(SCORE_MULTIPLIER_START, Math.floor(multiplier * 0.5))`) rather than fully resetting to 1× (`SCORE_MULTIPLIER_START`). `multiplierKills` is still reset to 0.
- Ownership gate: unowned (`extraLives === 0`, `respawnIFramesMs === 0`, `softenMultiplierReset === 0`) or `null` `playerStats` yields standard 2s respawn i-frames and full 1× multiplier reset on death.
- Sanitization: `extraLives` clamped to integer in `[0, 3]`, `respawnIFramesMs` clamped finite `>= 0`, `softenMultiplierReset` enabled `>= 1`.

**Block If:** none — level curve, max lives, respawn i-frames, multiplier softening, and fusion partner are fully specified.

**Never:**
- Never reset `extraLives` or decrement `playerState.lives` when unowned or on non-death ticks.
- Never grant extra lives repeatedly on non-level-up stat recomputes (only grant the delta when `extraLives` increases).
- Never shrink existing larger `invulnMs` when granting respawn i-frames.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / Default | `playerStats` null, or unowned | Respawn i-frames = 2000ms (2s), death resets multiplier to 1× | Sanitizers default to standard base values |
| Lv1 +1 Max Life | Lv1 owned (`extraLives: 1`) | `playerState.lives` increases by +1 on pick; respawn i-frames = 2s; death resets multiplier to 1× | No error expected |
| Lv2 Respawn i-Frames | Lv2 owned (`respawnIFramesMs: 1500`) | Respawn i-frames = 3500ms (3.5s); lives count unchanged on Lv2 pick | No error expected |
| Lv3 Second Extra Life | Lv3 owned (`extraLives: 2`) | `playerState.lives` increases by +1 on pick (total 2 extra granted); respawn i-frames = 3.5s | No error expected |
| Lv4 Multiplier Softening | Lv4 owned (`softenMultiplierReset: 1`) | On death, multiplier drops to 50% (e.g. 8× → 4×, 5× → 2×) instead of 1×; multiplierKills resets to 0 | No error expected |
| Lv5 Third Extra Life (4 Max) | Lv5 owned (`extraLives: 3`) | `playerState.lives` increases by +1 on pick (total 3 extra granted, 4 max lives from base 1); death drops mult to 50% | No error expected |
| Multiplier 1× on Lv4 Death | Lv4 owned, multiplier is 1× | Multiplier remains 1× (`Math.max(1, Math.floor(1 * 0.5))`) | Clamped to SCORE_MULTIPLIER_START (1) |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add `REINFORCED_HULL_IFRAMES_BONUS_MS`.
- `src/state/PlayerStats.js` -- add `extraLives: 0`, `respawnIFramesMs: 0`, `softenMultiplierReset: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `reinforced-hull` defense item definition with 5 per-level TOTALS maps and fusion metadata `partner: 'bomb-capacitor'`, `epic: 'revenant'`.
- `src/config/itemRegistry.test.js` -- add `'reinforced-hull'` to `EXPECTED_IDS` and unit tests for `reinforced-hull` definition shape and level progression.
- `src/state/ScoreState.js` -- update `resetMultiplier` to accept optional `playerStats` and apply 50% multiplier drop when `softenMultiplierReset >= 1`.
- `src/systems/PlayerDeathSystem.js` -- accept `playerStats`, sync extra lives delta on level change, apply dynamic respawn i-frames (`PLAYER_INVULN_MS + respawnIFramesMs`), and pass `playerStats` to `resetMultiplier`.
- `src/scenes/buildArenaWorld.js` -- pass `playerStats` as 7th argument to `PlayerDeathSystem`.
- `src/systems/reinforcedHullSystem.test.js` -- NEW unit tests for Reinforced Hull (extra lives grant, respawn i-frames, multiplier softening on death, sanitization).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `REINFORCED_HULL_IFRAMES_BONUS_MS = 1500`.
- `src/state/PlayerStats.js` -- add `extraLives: 0`, `respawnIFramesMs: 0`, `softenMultiplierReset: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `reinforced-hull` item definition in Defense track.
- `src/config/itemRegistry.test.js` -- include `reinforced-hull` in registry tests.
- `src/state/ScoreState.js` -- support optional `playerStats` in `resetMultiplier` to soften reset to 50%.
- `src/systems/PlayerDeathSystem.js` -- update `PlayerDeathSystem` to sync extra lives, scale respawn i-frames, and pass `playerStats` to `resetMultiplier`.
- `src/scenes/buildArenaWorld.js` -- wire `playerStats` into `PlayerDeathSystem`.
- `src/systems/reinforcedHullSystem.test.js` -- implement unit test suite covering levels 1->5 and edge cases.
- `src/state/playerStats.test.js` -- extend tests to verify `recomputePlayerStats` for Reinforced Hull.

**Acceptance Criteria:**
- Given Reinforced Hull is unowned, when player dies, then respawn i-frames duration is 2000ms and run multiplier resets to 1×.
- Given Lv1 owned, when card is picked, then `playerState.lives` increases by +1.
- Given Lv2 owned, when player dies with lives remaining, then respawn invulnerability is set to 3500ms (3.5s).
- Given Lv3 owned, when card is picked, then `playerState.lives` increases by +1 (accumulated 2 extra lives).
- Given Lv4 owned, when player dies (respawning or final game-over), then multiplier is reduced to 50% of current value instead of 1×, and kill progress resets to 0.
- Given Lv5 owned, when card is picked, then `playerState.lives` increases by +1 (accumulated 3 extra lives, 4 total max lives).
- Given `npm test`, when the test suite runs, then all new and existing tests pass with 0 regressions.

## Spec Change Log

No spec amendments.

## Review Triage Log

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` Imported `REINFORCED_HULL_IFRAMES_BONUS_MS` in `src/config/itemRegistry.js` and replaced hardcoded 1500 literals.
  - `[medium]` `[patch]` Initialized `_syncedExtraLives` in `PlayerDeathSystem` constructor from `playerStats` to prevent duplicate extra lives grants on system re-instantiation.
  - `[medium]` `[patch]` Guarded extra lives delta sync in `PlayerDeathSystem.fixedUpdate` with `!ps.gameOver`.
  - `[low]` `[patch]` Validated `scoreState.multiplier` and `softenMultiplierReset` with `Number.isFinite` in `ScoreState.js` `resetMultiplier`.
  - `[low]` `[patch]` Added `expect(ctx.playerDeathSystem.playerStats).toBe(ctx.playerStats)` identity assertion in `src/scenes/buildArenaWorld.test.js`.

## Design Notes

**Lives Grant Delta Tracking:** Following `NaniteShieldSystem`'s max Charges sync, `PlayerDeathSystem` syncs `extraLives` from `playerStats` each fixed tick. When `extraLives` rises above the previously synced value (`_syncedExtraLives`), the delta (`newExtra - _syncedExtraLives`) is immediately added to `playerState.lives`. This ensures picking Reinforced Hull at Lv1, Lv3, and Lv5 grants +1 live at the exact moment of pick without re-granting on unrelated stat folds or resetting on death.

**Dynamic Respawn i-Frames:** Adding `respawnIFramesMs` (1500ms at Lv2+) to `PLAYER_INVULN_MS` (2000ms) on respawn gives the player 3500ms (3.5s) of invulnerability after dying, allowing safer recovery in dense swarms.

**Multiplier Softening:** At Lv4+, `softenMultiplierReset >= 1` modifies `resetMultiplier(scoreState, playerStats)` to set `scoreState.multiplier = Math.max(1, Math.floor(scoreState.multiplier * 0.5))` instead of resetting to 1×. Progress toward the next multiplier step (`multiplierKills`) is still reset to 0 to reward streak continuation without preserving partial step progress.

## Verification

**Commands:**
- `npx vitest run src/systems/reinforcedHullSystem.test.js` -- expected: all Reinforced Hull tests pass.
- `npx vitest run src/config/itemRegistry.test.js src/state/playerStats.test.js` -- expected: registry and playerStats test suites pass.
- `npm test` -- expected: entire test suite passes without regressions.
- `npm run build` -- expected: production build succeeds.

### Story closure — 2026-07-27 (manual reconciliation)

The 5-patch review pass above was completed on 2026-07-25 (run 20260725-132316) but discarded by
the bmad-loop orchestrator: this spec's committed `baseline_revision` (`c7cf001`) never matched the
orchestrator-recorded run baseline, so the finished work was rolled back to an `attempt-preserve/*`
ref and the story deferred (again in runs 20260725-141410 and 20260726-170549). A later discarded
re-review of the same diff found only one candidate patch — removing `REINFORCED_HULL_IFRAMES_BONUS_MS`
as unused — which is superseded by this pass's constants-import fix that makes `itemRegistry.js` use
that constant; the removal was deliberately NOT landed.

Resolution: the review pass was cherry-picked onto `v2-progression` as `5a76716`
(full suite green: 78 files, 2094 tests). Status set to `done`.
