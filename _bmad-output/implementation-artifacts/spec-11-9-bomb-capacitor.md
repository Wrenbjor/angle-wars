---
title: 'Story 11.9 — Bomb Capacitor'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_revision: '36dabdccb542e4e7827c4c3606eff4631d24095a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 11's ninth exotic item and fourth DEFENSE item. Smart bomb progression is fixed (3 starting bombs, 100k score threshold, fixed radius, no lingering control or resource drops), preventing bomb-focused survival builds from scaling into late-game density.

**Approach:** Add the data-driven `bomb-capacitor` defense item definition with 5 per-level TOTALS maps in `src/config/itemRegistry.js`. Register six fold fields in `PlayerStats.js` (`extraBombs`, `bombRadiusMult`, `bombAwardInterval`, `bombStunMs`, `bombXpOrbs`, `bombDamageFieldMs`). Extend `BombSystem.js` to sync extra bombs on level pick, scale score award threshold (75k at Lv2+, 50k at Lv4+), scale shockwave radius (+30%), stun surviving combat enemies for 2s at Lv3+, drop 5 XP orbs on detonation at Lv4+, and sustain a 3s lingering damage field at Lv5. Wire `playerStats` and `xpOrbSystem` into `BombSystem` in `buildArenaWorld.js`.

## Boundaries & Constraints

**Always:**
- `bomb-capacitor` fold fields base cleanly in `PLAYER_STATS_BASE`: `extraBombs` (base 0), `bombRadiusMult` (base 1), `bombAwardInterval` (base 0), `bombStunMs` (base 0), `bombXpOrbs` (base 0), `bombDamageFieldMs` (base 0). Unowned Bomb Capacitor yields byte-identical pre-11.9 `BombSystem` behavior.
- `extraBombs` delta on level change grants extra bombs directly to `scoreState.bombs` (+1 at Lv1, +1 at Lv3, +2 at Lv5, totaling +4 bombs at Lv5).
- Score threshold for +1 bomb award scales to `bombAwardInterval` when `bombAwardInterval > 0` (75000 at Lv2-3, 50000 at Lv4-5), falling back to `BOMB_AWARD_SCORE_INTERVAL` (100000) when 0.
- Shockwave effective radius scales `BOMB_SHOCKWAVE_MAX_RADIUS` (900px) by `playerStats.bombRadiusMult` (1.3x at Lv1+, equaling 1170px).
- Surviving combat enemies at Lv3+ (`bombStunMs >= 1`) receive `s.stunMs = 2000`, freezing their velocity/homing and rendering them non-lethal in `PlayerDeathSystem` for 2 seconds.
- Detonation at Lv4+ (`bombXpOrbs >= 1`) spawns 5 XP orbs around detonation origin `(x, y)` via `xpOrbSystem`.
- Detonation at Lv5+ (`bombDamageFieldMs >= 1`) arms a 3s lingering damage field at origin `(x, y)` with radius `effectiveRadius` that clears entering combat enemies during its window.
- Sanitization: `extraBombs` clamped integer `>= 0`, `bombRadiusMult` clamped finite `>= 1`, `bombAwardInterval` clamped finite `>= 0`, `bombStunMs` clamped finite `>= 0`, `bombXpOrbs` clamped integer `>= 0`, `bombDamageFieldMs` clamped finite `>= 0`.

**Block If:** none — level curve, radius bonus, threshold values, stun duration, orb drops, and damage field duration are fully specified.

**Never:**
- Never allocate objects in fixedUpdate or detonation paths; reuse scratch arrays.
- Never award negative bombs or allow threshold calculations to regress score cursor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / Default | `playerStats` null, base stats | 100k threshold, 900px radius, no stun, 0 orbs, no damage field | Default base values used |
| Lv1 +1 Bomb & +30% Radius | Lv1 owned (`extraBombs: 1`, `bombRadiusMult: 0.3`) | `scoreState.bombs` +1, effective shockwave radius is 1170px | No error expected |
| Lv2 75k Threshold | Lv2 owned (`bombAwardInterval: 75000`) | +1 bomb awarded every 75k points scored | No error expected |
| Lv3 Stun & +1 Bomb | Lv3 owned (`extraBombs: 2`, `bombStunMs: 2000`) | `scoreState.bombs` +1, surviving combat enemies stunned for 2s | No error expected |
| Lv4 50k Threshold & Orbs | Lv4 owned (`bombAwardInterval: 50000`, `bombXpOrbs: 5`) | 50k award threshold; detonation spawns 5 XP orbs around detonation point | Null guard on `xpOrbSystem` |
| Lv5 +2 Bombs & Damage Field | Lv5 owned (`extraBombs: 4`, `bombDamageFieldMs: 3000`) | `scoreState.bombs` +2; 3s lingering damage field clears enemies entering blast radius | Defensive checks on active pools |

</intent-contract>

## Code Map

- `src/state/PlayerStats.js` -- add `extraBombs`, `bombRadiusMult`, `bombAwardInterval`, `bombStunMs`, `bombXpOrbs`, `bombDamageFieldMs` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `bomb-capacitor` defense item definition with 5 per-level TOTALS maps and fusion metadata `partner: 'flak-burst'`, `epic: 'chain-reaction'`.
- `src/config/itemRegistry.test.js` -- add `'bomb-capacitor'` to `EXPECTED_IDS` and unit tests for `bomb-capacitor` definition shape and level progression.
- `src/systems/BombSystem.js` -- accept `playerStats` and `xpOrbSystem`, implement extra bomb delta sync, dynamic threshold interval, shockwave radius scaling, survivor 2s stun, 5 XP orb drop, and 3s damage field.
- `src/systems/EnemySystem.js`, `GreenSquareSystem.js`, `PinwheelSystem.js`, `SnakeSystem.js`, `ArmoredSystem.js` -- support `s.stunMs` freeze countdown in fixedUpdate.
- `src/systems/PlayerDeathSystem.js` -- skip contact death for stunned enemies (`s.stunMs > 0`).
- `src/scenes/buildArenaWorld.js` -- pass `playerStats` to `BombSystem` and late-bind `xpOrbSystem`.
- `src/systems/bombCapacitorSystem.test.js` -- NEW unit tests for Bomb Capacitor (levels 1->5, extra bombs grant, threshold scaling, radius scaling, stun, orb drop, damage field, sanitization).

## Tasks & Acceptance

**Execution:**
- `src/state/PlayerStats.js` -- add `extraBombs: 0`, `bombRadiusMult: 1`, `bombAwardInterval: 0`, `bombStunMs: 0`, `bombXpOrbs: 0`, `bombDamageFieldMs: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `bomb-capacitor` item definition in Defense track.
- `src/config/itemRegistry.test.js` -- include `bomb-capacitor` in registry tests.
- `src/systems/BombSystem.js` -- update `BombSystem` to apply extra bomb grants, dynamic threshold, scaled shockwave radius, 2s survivor stun, 5 XP orb drops, and 3s damage field.
- `src/systems/EnemySystem.js`, `GreenSquareSystem.js`, `PinwheelSystem.js`, `SnakeSystem.js`, `ArmoredSystem.js` -- integrate `s.stunMs` freeze handling.
- `src/systems/PlayerDeathSystem.js` -- skip lethal contact for `s.stunMs > 0`.
- `src/scenes/buildArenaWorld.js` -- wire `playerStats` and `xpOrbSystem` into `BombSystem`.
- `src/systems/bombCapacitorSystem.test.js` -- implement unit test suite covering levels 1->5 and edge cases.
- `src/state/playerStats.test.js` -- extend tests to verify `recomputePlayerStats` for Bomb Capacitor.

**Acceptance Criteria:**
- Given Bomb Capacitor is unowned, when bombs are awarded or detonated, threshold is 100k, radius is 900px, 0 extra bombs granted, 0 stun applied, 0 XP orbs dropped, and 0 damage field created.
- Given Lv1 owned, when picked/detonated, then `scoreState.bombs` increases by 1 and shockwave radius is 1170px (1.3x).
- Given Lv2 owned, when score increases, then +1 bomb is awarded every 75,000 points.
- Given Lv3 owned, when upgraded/detonated, then `scoreState.bombs` increases by 1 and active surviving enemies are stunned for 2 seconds.
- Given Lv4 owned, when score increases or bomb detonates, then threshold is 50,000 points and 5 XP orbs drop around the detonation point.
- Given Lv5 owned, when upgraded/detonated, then `scoreState.bombs` increases by 2 and a 3s damage field clears enemies entering the blast radius.
- Given `npm test`, when the test suite runs, then all new and existing tests pass with 0 regressions.

## Spec Change Log

No spec amendments.

## Review Triage Log

### 2026-07-25 — Initial Spec Creation
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings: none

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 0
- reject: 11
- addressed_findings:
  - `[medium]` `[patch]` Reset `stunMs = 0` on enemy spawn in `EnemySystem`, `GreenSquareSystem`, `PinwheelSystem`, `SnakeSystem`, `ArmoredSystem` so recycled pool instances never start pre-stunned.
  - `[medium]` `[patch]` Recompute score threshold awards in `BombSystem` when `bombAwardInterval` changes mid-run so passed milestone thresholds pay out cleanly.
  - `[medium]` `[patch]` Add public `spawnOrb(x, y, value)` to `XpOrbSystem` with active count cap check, and update `BombSystem` to call `spawnOrb`.
  - `[low]` `[patch]` Zero `pw.vx` and `pw.vy` when `pw.stunMs > 0` in `PinwheelSystem.js` for velocity consistency across enemy systems.
  - `[low]` `[patch]` Clean up snake chain stun handling in `SnakeSystem.js` to avoid redundant per-segment decrement loops.
  - `[low]` `[patch]` Add test assertions for `ctx.bombSystem.playerStats` & `ctx.bombSystem.xpOrbSystem` in `buildArenaWorld.test.js`, and add `stunMs` unit tests to `greenSquareSystem.test.js`, `pinwheelSystem.test.js`, `snakeSystem.test.js`, and `armoredSystem.test.js`.

## Design Notes

**Extra Bombs Delta Sync:** Syncing `playerStats.extraBombs` via a `_syncedExtraBombs` cursor in `BombSystem` safely grants +1 bomb on Lv1, +1 on Lv3, and +2 on Lv5 without re-granting on recomputes.

**Dynamic Score Threshold:** Reading `playerStats.bombAwardInterval` dynamically in `BombSystem` allows score threshold to drop from 100k to 75k at Lv2 and 50k at Lv4 without resetting the monotonic score cursor.

**Survivor Stun & Non-Lethality:** Setting `s.stunMs = 2000` on surviving combat enemies freezes their position/velocity updates in enemy systems and bypasses contact death in `PlayerDeathSystem` for 2 seconds.

**XP Orb Drop & Damage Field:** At Lv4+, calling `xpOrbSystem.spawnOrb` 5 times at detonation origin drops orb pickups. At Lv5+, setting `damageFieldMs = 3000` sustains a 3-second zone that clears any entering combat enemies.

## Verification

**Commands:**
- `npx vitest run src/systems/bombCapacitorSystem.test.js` -- expected: all Bomb Capacitor tests pass (7/7 passed).
- `npx vitest run src/config/itemRegistry.test.js src/state/playerStats.test.js` -- expected: registry and playerStats test suites pass (139/139 passed).
- `npm test` -- expected: entire test suite passes without regressions (78/78 files, 2073 tests passed).
- `npm run build` -- expected: production build succeeds.

## Auto Run Result

Status: done
Summary: Implemented Story 11.9 Bomb Capacitor defense item. Registered data-driven item definition in itemRegistry.js with 5 levels (+1 bomb/+30% radius → 75k threshold → 2s survivor stun + 1 bomb → 50k threshold + 5 XP orbs → +2 bombs + 3s damage field) and fusion metadata (partner: 'flak-burst', epic: 'chain-reaction'). Added fold fields to PlayerStats.js. Extended BombSystem.js to sync extra bombs delta, scale threshold interval, scale shockwave radius, stun survivors for 2s, drop 5 XP orbs via xpOrbSystem, and sustain a 3s lingering damage field. Integrated stunMs freeze across all 5 combat enemy systems and skipped contact death for stunned enemies in PlayerDeathSystem.
Files Changed:
- `src/state/PlayerStats.js`: Added `extraBombs`, `bombRadiusMult`, `bombAwardInterval`, `bombStunMs`, `bombXpOrbs`, `bombDamageFieldMs` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js`: Added frozen `bomb-capacitor` defense item definition.
- `src/config/itemRegistry.test.js`: Added `bomb-capacitor` to `EXPECTED_IDS` and registry tests.
- `src/systems/BombSystem.js`: Extended constructor and fixedUpdate/detonateAt for extra bombs sync, threshold scaling, radius scaling, survivor 2s stun, 5 XP orb drop, and 3s damage field.
- `src/systems/EnemySystem.js`, `GreenSquareSystem.js`, `PinwheelSystem.js`, `SnakeSystem.js`, `ArmoredSystem.js`: Added `stunMs` freeze check in fixedUpdate and reset `stunMs = 0` on spawn.
- `src/systems/PlayerDeathSystem.js`: Skipped contact death for stunned enemies (`s.stunMs > 0`).
- `src/systems/XpOrbSystem.js`: Added public `spawnOrb` method with active count cap check.
- `src/scenes/buildArenaWorld.js`: Passed `playerStats` to `BombSystem` and late-bound `xpOrbSystem`.
- `src/systems/bombCapacitorSystem.test.js`: Created unit test suite for Bomb Capacitor (7 tests).
- `src/state/playerStats.test.js`: Added fold tests for Bomb Capacitor.
- `src/scenes/buildArenaWorld.test.js`: Added assertions for bombSystem playerStats and xpOrbSystem bindings.
- `src/systems/greenSquareSystem.test.js`, `pinwheelSystem.test.js`, `snakeSystem.test.js`, `armoredSystem.test.js`: Added `stunMs` unit test cases.
- `src/systems/cardOffer.test.js` & `src/systems/levelUpSystem.test.js`: Added `bomb-capacitor` to test fixture banished sets.
Review Findings Breakdown:
- Patches applied: 6
- Deferred: 0
- Rejected: 11
Follow-up Review Recommended: true (Score: 12)
Verification Performed:
- `npx vitest run src/systems/bombCapacitorSystem.test.js`: 7/7 passed.
- `npx vitest run src/config/itemRegistry.test.js src/state/playerStats.test.js`: 139/139 passed.
- `npm test`: 78/78 test files passed (2073 tests passed).
- `npm run build`: Production build succeeded.
Residual Risks: None.

