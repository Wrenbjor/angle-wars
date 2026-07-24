---
title: 'Story 11.7 — Gravity Well'
type: 'feature'
created: '2026-07-24'
status: 'in-review'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '84aaa4a4f826e6f3bff8d49641fef2d58ed2bb0a'
final_revision: '413df1b4e22b7e3bf245a683055b5c1aa64ebc08'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 11's seventh exotic item and third DEFENSE item. The player's XP pickup radius and orb economy are static, requiring players to dive dangerously close to enemy swarms to retrieve XP orbs.

**Approach:** Add the data-driven `gravity-well` defense item definition with 5 per-level TOTALS maps in `src/config/itemRegistry.js`. Register four fields in `PlayerStats.js` (`xpPickupRadiusMult`, `gravityWellHoming`, `xpValueMult`, `gravityWellPullEnemies`). Extend `XpOrbSystem.js` to read `playerStats` for dynamic pickup radius (+40% → +80% → +80% → +80% → +150%), orb homing speed (540 px/s at Lv3+), base XP value scaling (+25% at Lv4+), and position-nudge enemy pull toward active orbs at Lv5. Wire `playerStats` and `enemyPools` to `XpOrbSystem` in `buildArenaWorld.js`.

## Boundaries & Constraints

**Always:**
- `gravity-well` fold fields base cleanly in `PLAYER_STATS_BASE`: `xpPickupRadiusMult` (base 1), `gravityWellHoming` (base 0), `xpValueMult` (base 1), `gravityWellPullEnemies` (base 0). Unowned Gravity Well yields byte-identical pre-11.7 `XpOrbSystem` behavior.
- Pickup radius scales `XP_PICKUP_RADIUS` (120px) by `playerStats.xpPickupRadiusMult` (1.4x → 1.8x → 1.8x → 1.8x → 2.5x).
- Homing speed (`GRAVITY_WELL_HOMING_SPEED = 540` px/s) applies at Lv3+ (`gravityWellHoming >= 1`) when orbs drift toward ship within pickup radius.
- XP credit on collect multiplies base orb value by `playerStats.xpValueMult` (1.25x at Lv4+).
- Lv5 enemy pull (`gravityWellPullEnemies >= 1`) nudges non-telegraphing combat enemies within `GRAVITY_WELL_PULL_RADIUS` (100px) toward active/drifting XP orbs using dtSec-scaled position nudges.
- Ownership gate: unowned (`xpPickupRadiusMult === 1` and `gravityWellHoming === 0`) or `null` `playerStats` yields standard 120px pickup radius, standard 320 px/s drift, 1.0x XP value, and zero enemy pull.
- Sanitization: `xpPickupRadiusMult` clamped finite `>= 1`, `xpValueMult` clamped finite `>= 1`, `gravityWellHoming` enabled `>= 1`, `gravityWellPullEnemies` enabled `>= 1`.

**Block If:** none — level curve, pickup radius scaling, homing speed, XP value boost, and enemy pull are fully specified.

**Never:**
- Never pull telegraphing (`telegraphMs > 0`) enemies.
- Never allocate objects inside the fixedUpdate loop; use static scratch arrays for active orbs and combat enemies.
- Never mutate enemy velocity `vx`/`vy` directly for position nudges (use position displacement `x`/`y` dtSec-scaled).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / corrupt store | `playerStats` null, or default base stats | Orbs behave byte-identically to pre-11.7 (120px radius, 320 px/s drift, 1x XP, no pull) | Sanitizers default to standard base values |
| Lv1 Pickup Radius | Lv1 owned (`xpPickupRadiusMult: 0.40`) | Effective pickup radius is 168px (120 * 1.4) | No error expected |
| Lv2 Higher Radius | Lv2 owned (`xpPickupRadiusMult: 0.80`) | Effective pickup radius is 216px (120 * 1.8) | No error expected |
| Lv3 Homing Orbs | Lv3 owned (`gravityWellHoming: 1`) | Orbs within 216px pickup radius move toward ship at 540 px/s homing speed | No error expected |
| Lv4 XP Value Boost | Lv4 owned (`xpValueMult: 0.25`) | Collected orb pays 1.25x base XP value | No error expected |
| Lv5 Radius + Enemy Pull | Lv5 owned (`xpPickupRadiusMult: 1.50`, `gravityWellPullEnemies: 1`) | Effective pickup radius is 300px (120 * 2.5); active orbs nudge nearby combat enemies inward | No error expected |
| Null enemyPools / Null ship | Lv5 owned, but `enemyPools` or `ship` is null | Pull step safely skipped without throwing | Defensive null guards |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add `GRAVITY_WELL_HOMING_SPEED`, `GRAVITY_WELL_PULL_RADIUS`, and `GRAVITY_WELL_PULL_STRENGTH`.
- `src/state/PlayerStats.js` -- add `xpPickupRadiusMult: 1`, `gravityWellHoming: 0`, `xpValueMult: 1`, `gravityWellPullEnemies: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `gravity-well` defense item definition with 5 per-level TOTALS maps and fusion metadata `partner: 'mine-layer'`, `epic: 'event-horizon'`.
- `src/config/itemRegistry.test.js` -- add `'gravity-well'` to `EXPECTED_IDS` and unit tests for `gravity-well` definition shape and level progression.
- `src/systems/XpOrbSystem.js` -- accept `playerStats` and `enemyPools`, integrate dynamic pickup radius, homing speed, XP value multiplier, and Lv5 enemy pull toward orbs.
- `src/scenes/buildArenaWorld.js` -- pass `playerStats` and `enemyPools` to `XpOrbSystem`.
- `src/systems/gravityWellSystem.test.js` -- NEW unit tests for Gravity Well (pickup radius, homing speed, XP value boost, enemy pull, sanitization).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add Gravity Well constants (`GRAVITY_WELL_HOMING_SPEED = 540`, `GRAVITY_WELL_PULL_RADIUS = 100`, `GRAVITY_WELL_PULL_STRENGTH = 40`).
- `src/state/PlayerStats.js` -- add `xpPickupRadiusMult: 1`, `gravityWellHoming: 0`, `xpValueMult: 1`, `gravityWellPullEnemies: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `gravity-well` item definition in Defense track.
- `src/config/itemRegistry.test.js` -- include `gravity-well` in registry tests.
- `src/systems/XpOrbSystem.js` -- update `XpOrbSystem` to apply `playerStats` pickup radius, homing speed, XP value multiplier, and enemy pull towards orbs.
- `src/scenes/buildArenaWorld.js` -- wire `playerStats` and `enemyPools` into `XpOrbSystem`.
- `src/systems/gravityWellSystem.test.js` -- implement unit test suite covering levels 1->5 and edge cases.
- `src/state/playerStats.test.js` -- extend tests to verify `recomputePlayerStats` for Gravity Well.

**Acceptance Criteria:**
- Given Gravity Well is unowned, when XP orbs are on the ground, then pickup radius is 120px, drift speed is 320 px/s, XP multiplier bonus is 0%, and no enemy pull occurs.
- Given Lv1 owned, when an orb is 160px from ship, then the orb drifts toward the ship (pickup radius is 168px).
- Given Lv2 owned, when an orb is 200px from ship, then the orb drifts toward the ship (pickup radius is 216px).
- Given Lv3 owned, when an orb is inside 216px pickup radius, then it homes toward the ship at 540 px/s.
- Given Lv4 owned, when an orb is collected, then the XP credited is scaled by 1.25x base XP value.
- Given Lv5 owned, when combat enemies are within 100px of active orbs, then pickup radius is 300px and nearby non-telegraphing enemies are pulled toward the orb positions.
- Given `npm test`, when the test suite runs, then all new and existing tests pass with 0 regressions.

## Spec Change Log

No spec amendments.

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

### 2026-07-24 — Review pass (follow-up, 4 layers)
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 3, medium 7, low 4)
- defer: 2: (medium 2)
- reject: 7: (medium 3, low 4)
- addressed_findings:
  - `[high]` `[patch]` `_applyPullFromOrb` built its displacement from a `pull / d` scale factor — the exact pattern `NaniteShieldSystem._push` documents as NaN-producing (at denormal separation `pull / d` overflows to Infinity and `0 * Infinity` is NaN, uncatchable by any later clamp). Rewrote to use UNIT components (`dx/d`, `dy/d`), which are bounded by 1 for every `d > 0`. A NaN here writes permanently to pooled ENEMY coordinates, degrading collision, steering and rendering for the rest of the run.
  - `[high]` `[patch]` The two tests covering the story's explicit "Never" clauses (never pull when unowned, never pull telegraphing enemies) were unfalsifiable: `createFakeEnemyPool` `Object.assign`ed the caller's literals into freshly `acquire()`d pool instances and the assertions read the detached literals, which the system never touches. Helper now returns the pooled instances; assertions moved onto them. Verified by mutation: removing the `telegraphMs > 0` guard and removing the `pullEnabled` gate each now fail.
  - `[high]` `[patch]` `buildArenaWorld` wiring for `playerStats`/`enemyPools` — the only path by which Gravity Well affects real play — had no assertion, against a repo convention of 23 such identity pins. A transposed or dropped positional argument would have shipped the whole feature inert with a green suite. Added `playerStats`/`enemyPools` identity assertions plus a `maxOrbs` resolution check for the positional `undefined` placeholder.
  - `[medium]` `[patch]` Pull ran `Math.hypot` on every orb×enemy pair before any range test (O(512 × enemies) per tick, in a file that documented squared-distance rejection as a deliberate optimization). Added a squared-distance reject before the sqrt.
  - `[medium]` `[patch]` Pull applied raw position deltas with no arena clamp, diverging from the `NaniteShieldSystem._push` precedent it otherwise mirrors. Added the same interior clamp inset by enemy radius, with the same per-axis rule (clamp only bounds the enemy started inside, so legitimately-outside snake segments are not teleported in).
  - `[medium]` `[patch]` Pull was summed over every in-range orb with no cap. Orbs drop at kill sites, never time out, and routinely pile up, so a heap of co-located orbs could displace an enemy faster than it can fly — turning a DEFENSE item into an enemy-delivery mechanism. Contributions now accumulate per enemy and clamp to one orb's worth of displacement.
  - `[medium]` `[patch]` Pull ran as step (3) AFTER the spawn phase, so an orb pulled on the tick it dropped — contradicting the file's own documented ADVANCE-then-SPAWN invariant restated two lines above. Moved into the advance phase over the same pre-spawn snapshot the drift/collect pass uses.
  - `[medium]` `[patch]` A non-finite `dt` propagated NaN into pooled enemy coordinates (pre-11.7 it could only reach recyclable orb positions). Added a finite/positive `dt` guard yielding a zero step.
  - `[medium]` `[patch]` The corrupt-stats test fed `xpValueMult: NaN` but asserted only orb drift — never collecting an orb, so the sanitizer most able to poison run state was exercised without being checked. Now asserts `Number.isFinite(score.xp)` and the exact 1x credit, and pins that a junk pull flag moves no enemy.
  - `[medium]` `[patch]` The diff deleted load-bearing rationale still true of surviving code: the `maxOrbs` 0/NaN/negative footgun guard, the "per-tick distance gate, not a magnet latch" no-timeout contract, and the zero-steady-state-allocation explanation. Restored and extended to cover the Lv5 pull.
  - `[low]` `[patch]` The pull block was gated on `ship` being truthy but never read `ship`, making the null-ship test prove nothing about the pull path. Removed the decorative gate.
  - `[low]` `[patch]` An unrelated Afterburner draw loop had its retry budget silently raised 20→30 as an unexplained band-aid for registry growth; at 30 attempts `level` reaches 31 against `LEVEL_MAX` 30, which would have failed on the level assertion rather than the intended "never offered" diagnostic. Bounded to `Math.min(30, LEVEL_MAX - 2)` with the scaling rationale documented.
  - `[low]` `[patch]` Added `gravity-well` to the both-halves fusion pin block and extended the reciprocal-pair test to cover the now fully-registered `mine-layer` ↔ `gravity-well` pair, with a note that the pair's two `epic` values are deliberately different and must not be reconciled.
  - `[low]` `[patch]` Stripped seven whitespace-only insertions across six files (including shared `constants.js` / `itemRegistry.js`, which manufacture merge conflicts for concurrent Epic-11 stories).

## Design Notes

**Dynamic Pickup Radius & Economy:** Scaling `XP_PICKUP_RADIUS` by `xpPickupRadiusMult` allows players to gather XP from safer distances without exposing themselves to high enemy density.

**Homing Speed Boost:** At Lv3, increasing orb movement speed to 540 px/s ensures orbs rapidly reach the ship once in pickup range, preventing orbs from lingering or oscillating.

**Base XP Scaling:** At Lv4, multiplying base orb value by `xpValueMult` (1.25) stacks additively with the multiplier system in `ScoreState.xp += o.value * xpValueMult * (1 + scoreState.multiplier / divisor)`.

**Position-Nudge Enemy Pull:** Following `MineLayerSystem` and `BlackHoleSystem` patterns, enemy pull is applied as a position displacement `x`/`y` rather than velocity impulse, skipping telegraphing enemies and avoiding per-frame allocations.

## Verification

**Commands:**
- `npx vitest run src/systems/gravityWellSystem.test.js` -- expected: all Gravity Well tests pass.
- `npx vitest run src/config/itemRegistry.test.js src/state/playerStats.test.js` -- expected: registry and playerStats test suites pass.
- `npm test` -- expected: entire test suite passes without regressions.
- `npm run build` -- expected: production build succeeds.

## Auto Run Result

Status: done
Summary: Implemented Story 11.7 Gravity Well defense item. Registered data-driven item definition in itemRegistry.js with 5 levels (+40% → +80% → homing → +25% XP value → +150% + enemy pull) and fusion metadata (partner: 'mine-layer', epic: 'event-horizon'). Added fold fields to PlayerStats.js. Extended XpOrbSystem.js to read playerStats for dynamic pickup radius, homing speed, XP value scaling, and Lv5 position-nudge enemy pull toward active orbs.
Files Changed:
- `src/config/constants.js`: Added Gravity Well constants (`GRAVITY_WELL_HOMING_SPEED`, `GRAVITY_WELL_PULL_RADIUS`, `GRAVITY_WELL_PULL_STRENGTH`).
- `src/state/PlayerStats.js`: Added `xpPickupRadiusMult`, `gravityWellHoming`, `xpValueMult`, `gravityWellPullEnemies` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js`: Added frozen `gravity-well` defense item definition.
- `src/config/itemRegistry.test.js`: Added `gravity-well` to `EXPECTED_IDS` and registry tests.
- `src/systems/XpOrbSystem.js`: Extended constructor and fixedUpdate for dynamic pickup radius, homing speed, XP value scaling, and Lv5 enemy pull.
- `src/scenes/buildArenaWorld.js`: Passed `playerStats` and `enemyPools` to `XpOrbSystem`.
- `src/state/playerStats.test.js`: Added fold tests for Gravity Well.
- `src/systems/gravityWellSystem.test.js`: Created unit tests for Gravity Well.
- `src/systems/cardOffer.test.js`: Added `gravity-well` to test fixture banished sets.
- `src/systems/levelUpSystem.test.js`: Added `gravity-well` to test fixture banished sets.
- `src/scenes/buildArenaWorld.test.js`: Adjusted iteration cap for 11 items.
Review Findings Breakdown (initial pass):
- Patches applied: 0
- Deferred: 0
- Rejected: 0

### Follow-up review pass — 2026-07-24

A second review pass ran all four layers against the same reviewed diff (`84aaa4a..ff2666a`).
Note: the previously recorded `final_revision` `095859a` is an ORPHANED commit — history was
rewritten and the on-branch Story 11.7 commit is `ff2666a` (identical tree apart from this
spec's own frontmatter). `final_revision` below is corrected to the real HEAD.

Files Changed (this pass):
- `src/systems/XpOrbSystem.js`: Replaced `_applyPullFromOrb` with `_applyPull` — unit-component displacement (no NaN at denormal separation), squared-distance reject before sqrt, per-enemy accumulation clamped to one orb's worth, arena-interior clamp on the NaniteShield per-axis rule; moved the pull into the advance phase (pre-spawn); added a non-finite `dt` guard; restored the deleted `maxOrbs` / magnet-latch / zero-allocation rationale.
- `src/systems/gravityWellSystem.test.js`: `createFakeEnemyPool` now returns the POOLED instances so the unowned and telegraph assertions are falsifiable; strengthened the corrupt-stats test (finite `score.xp`, exact 1x credit, no pull under a junk flag); added tests for the stacking cap, arena clamp, non-finite `dt`, and the one-tick spawn grace.
- `src/scenes/buildArenaWorld.test.js`: Added `playerStats`/`enemyPools` identity assertions and a `maxOrbs` resolution check to the XpOrbSystem wiring test; bounded the Afterburner retry budget to `Math.min(30, LEVEL_MAX - 2)` with rationale.
- `src/config/itemRegistry.test.js`: Added the `gravity-well` fusion pin and extended the reciprocal-pair test to the `mine-layer` ↔ `gravity-well` pair, documenting why its two `epic` values differ.
- `src/config/constants.js`, `src/config/itemRegistry.js`, `src/scenes/buildArenaWorld.js`: stray blank lines stripped; `src/state/playerStats.test.js`, `src/config/itemRegistry.test.js`, `src/systems/XpOrbSystem.js`: trailing EOF blank lines trimmed. (The blanks this story left in `src/state/PlayerStats.js` and `src/systems/cardOffer.test.js` were already absorbed by Story 11.8, so those files needed no change.)

Review Findings Breakdown (follow-up pass):
- Patches applied: 14 (high 3, medium 7, low 4)
- Deferred: 2
- Rejected: 7
Follow-up Review Recommended: true (Score: high count 3 > 0)
Verification Performed:
- `npx vitest run src/systems/gravityWellSystem.test.js src/config/itemRegistry.test.js src/state/playerStats.test.js src/scenes/buildArenaWorld.test.js`: 200/200 passed.
- Mutation check on the two repaired tests: removing the `telegraphMs > 0` guard fails `never pulls telegraphing enemies`; removing the `pullEnabled` gate fails the unowned and corrupt-stats tests. Both were green under those mutations before this pass.
- `npm test`: 77/77 test files passed (2058 tests passed).
- `npm run build`: Production build succeeded.

Residual Risks:
- The Lv5 pull's tuning is untested as gameplay: at `GRAVITY_WELL_PULL_STRENGTH = 40` with linear falloff, an enemy 50px from an orb moves ~0.33px/tick. Whether that reads as PRD §13.4's "pulls enemies slightly" or as indistinguishable from zero is a playtest question no test at any surface answers.
- Two deferred items recorded in `deferred-work.md`: snake-segment pull granularity, and the absent assembled-world Gravity Well behavior suite.
- Rejected as verified-incorrect: the reported `mine-layer` ↔ `gravity-well` fusion "contradiction". PRD §13.5 lines 246 and 253 define TWO distinct fusions from that pair at different level thresholds (Singularity Field / Event Horizon); the asymmetry is intentional and is now pinned by a test comment so a future reviewer does not "fix" it.

