---
title: 'Story 11.7 — Gravity Well'
type: 'feature'
created: '2026-07-24'
status: 'in-review'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '84aaa4a4f826e6f3bff8d49641fef2d58ed2bb0a'
final_revision: '095859a916328f85c268c7a7b518b23a1a251489'
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
Review Findings Breakdown:
- Patches applied: 0
- Deferred: 0
- Rejected: 0
Follow-up Review Recommended: false (Score: 0)
Verification Performed:
- `npx vitest run src/systems/gravityWellSystem.test.js src/config/itemRegistry.test.js src/state/playerStats.test.js`: 133/133 passed.
- `npm test`: 76/76 test files passed (2039 tests passed).
- `npm run build`: Production build succeeded.
Residual Risks: None.

