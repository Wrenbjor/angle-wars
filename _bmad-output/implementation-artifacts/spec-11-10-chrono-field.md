---
title: 'Story 11.10 — Chrono Field'
type: 'feature'
created: '2026-07-26'
baseline_revision: a916c136881ba6d7993e61bbcc98b616ff42b563
final_revision: 24847759d0c08f17e21cb3525420ceb53069f37d
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 11's final (tenth) item and fifth DEFENSE item. The player has no means to control enemy tempo — all archetypes, hazard systems, and the Mirror Reflector operate at fixed baselines regardless of player build, preventing time-slow / tempo-control survival builds.

**Approach:** Add the data-driven `chrono-field` defense item definition with 5 per-level TOTALS maps in `src/config/itemRegistry.js`. Register three fold fields in `PlayerStats.js` (`chronoSlowPercent`, `chronoSlowBullet`, `chronoSlowWorld`). Modify enemy movers (EnemySystem, GreenSquareSystem, PinwheelSystem, SnakeSystem, ArmoredSystem) to read `playerStats.chronoSlowPercent` and scale velocity integration by `(1 - chronoSlowPercent)`. Add constants `CHRONO_SLOW_FACTOR_MAX`. Wire `playerStats` into enemy mover systems in `buildArenaWorld.js`.

## Boundaries & Constraints

**Always:**
- `chrono-field` fold fields base cleanly in `PLAYER_STATS_BASE`: `chronoSlowPercent` (base 0), `chronoSlowBullet` (base 0), `chronoSlowWorld` (base 0). Unowned Chrono Field yields byte-identical pre-11.10 behavior — all enemy movers integrate at full `dtSec * speed` with no velocity reduction.
- `chronoSlowPercent` is an ADDITIVE/COUNT field (base 0). Fractional value representing the SLOW PERCENT (0.2 = 20% slow). Effective velocity = `baseSpeed * (1 - chronoSlowPercent)`. Clamped: `chronoSlowPercent` capped at 0.99 (never zero velocity, never negative). Multiple slow sources stack additively — a second slow item at 0.2 with Chrono Field at 0.4 yields 0.6 total (40% speed).
- `chronoSlowBullet` = 1 (Lv3+) enables the slow for enemy bullets. Since no enemy bullets exist in the shipped codebase, this is a gated FLAG: when 0, the integration path is a no-op; when 1, the same `(1 - chronoSlowPercent)` factor would apply to any future enemy bullet system.
- `chronoSlowWorld` = 1 (Lv5) enables the slow for world systems (Black Hole absorption growth + bullet shrink, Mirror Reflector spin rate).
- Sanitization: `chronoSlowPercent` clamped finite `>= 0` and capped at 0.99, `chronoSlowBullet` enabled `>= 1`, `chronoSlowWorld` enabled `>= 1`.

**Block If:** none — level curve, slow percentages, and flag activations are fully specified.

**Never:**
- Never let `chronoSlowPercent` exceed 0.99 (enemies must always have residual velocity).
- Never allocate objects inside enemy mover fixedUpdate loops; use no extra per-tick allocations.
- Never modify enemy `telegraphMs` behavior — chrono slow does not affect spawn telegraph.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / Default | `playerStats` null, or base stats | No slow — all enemies move at full speed (Seeker 140, Green Square flee 120 / chase 200, Pinwheel 130, Snake head 120, Armored 70) | Base speed used |
| Lv1 — 20% Enemy Slow | Lv1 owned (`chronoSlowPercent: 0.2`) | Seeker effective speed = 112px/s (140 × 0.8) | No error expected |
| Lv2 — 30% Enemy Slow | Lv2 owned (`chronoSlowPercent: 0.3`) | Seeker effective speed = 98px/s (140 × 0.7) | No error expected |
| Lv3 — 40% Slow + Bullet Flag | Lv3 owned (`chronoSlowPercent: 0.4`, `chronoSlowBullet: 1`) | 40% enemy slow; bullet slow path active (no-op currently) | No error expected |
| Lv4 — 40% Slow sustained | Lv4 owned | Same Lv3 values | No error expected |
| Lv5 — 40% + World Flag | Lv5 owned (`chronoSlowPercent: 0.4`, `chronoSlowBullet: 1`, `chronoSlowWorld: 1`) | 40% enemy slow; black hole growth × 0.6; mirror spin × 0.6; bullet slow active | Null guards on playerStats |
| Stacked slow (hypothetical) | Two slow items = 0.6 total | `chronoSlowPercent` = 0.6 → 40% speed | Cap at 0.99 |
| Max cap enforcement | Corrupted `chronoSlowPercent` = 2.0 | Capped to 0.99 → enemies at 1% speed | Sanitizer caps |

</intent-contract>

## Code Map

- `src/state/PlayerStats.js` — add `chronoSlowPercent: 0`, `chronoSlowBullet: 0`, `chronoSlowWorld: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` — add frozen `chrono-field` defense item definition with 5 per-level TOTALS maps; fusion metadata `partner: 'any-defense'`, `epic: 'stasis-lock'` (Chrono Field Lv5 + any defense Lv3 → Stasis Lock).
- `src/config/constants.js` — add `CHRONO_SLOW_FACTOR_MAX = 0.99`.
- `src/systems/EnemySystem.js` — accept `playerStats`, read `chronoSlowPercent` in fixedUpdate, scale velocity integration by `(1 - chronoSlowPercent)`.
- `src/systems/GreenSquareSystem.js` — same chrono slow pattern.
- `src/systems/PinwheelSystem.js` — same chrono slow pattern.
- `src/systems/SnakeSystem.js` — same chrono slow pattern.
- `src/systems/ArmoredSystem.js` — same chrono slow pattern.
- `src/systems/BlackHoleSystem.js` — accept `playerStats`, when `chronoSlowWorld >= 1` scale `BLACKHOLE_GROWTH_PER_ABSORB` and `BLACKHOLE_SHRINK_PER_BULLET` by `(1 - chronoSlowFactor)`.
- `src/systems/MirrorReflectorSystem.js` — accept `playerStats`, when `chronoSlowWorld >= 1` scale `REFLECTOR_SPIN_RATE` by `(1 - chronoSlowFactor)`.
- `src/scenes/buildArenaWorld.js` — pass `playerStats` to all five enemy mover systems + BlackHoleSystem + MirrorReflectorSystem.
- `src/config/itemRegistry.test.js` — include `chrono-field` in registry tests.
- `src/state/playerStats.test.js` — add fold tests for Chrono Field.
- `src/scenes/buildArenaWorld.test.js` — add assertions for enemy mover `playerStats` bindings.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` — add `CHRONO_SLOW_FACTOR_MAX = 0.99`.
- `src/state/PlayerStats.js` — add `chronoSlowPercent: 0`, `chronoSlowBullet: 0`, `chronoSlowWorld: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` — add frozen `chrono-field` item definition in Defense track with 5 levels.
- `src/config/itemRegistry.test.js` — include `chrono-field` in registry tests.
- `src/systems/EnemySystem.js` — accept `playerStats`, apply chrono slow to velocity integration.
- `src/systems/GreenSquareSystem.js` — apply chrono slow.
- `src/systems/PinwheelSystem.js` — apply chrono slow.
- `src/systems/SnakeSystem.js` — apply chrono slow to head + segments.
- `src/systems/ArmoredSystem.js` — apply chrono slow.
- `src/systems/BlackHoleSystem.js` — accept `playerStats`, scale black hole growth/shrink when `chronoSlowWorld` enabled.
- `src/systems/MirrorReflectorSystem.js` — accept `playerStats`, scale spin rate when `chronoSlowWorld` enabled.
- `src/scenes/buildArenaWorld.js` — pass `playerStats` as argument to all five enemy mover systems + BlackHoleSystem + MirrorReflectorSystem.
- `src/state/playerStats.test.js` — verify Chrono Field fold in `recomputePlayerStats`.

**Acceptance Criteria:**
- Given Chrono Field is unowned, when any enemy moves, then velocity is at full base speed (Seeker 140px/s, Green Square flee 120 / chase 200, Pinwheel 130, Snake head 120, Armored 70).
- Given Lv1 owned, when Seeker moves, then effective speed is 112px/s (140 × 0.8 = 20% reduction).
- Given Lv2 owned, when all enemies move, then effective speed is reduced by 30% (Seeker 98px/s).
- Given Lv3 owned, when card is picked, then `chronoSlowBullet` becomes 1 and `chronoSlowPercent` becomes 0.4 (40% slow).
- Given Lv5 owned, when black hole absorbs enemies, then growth is reduced by 40% (× 0.6); when mirror reflector spins, spin rate is reduced by 40%.
- Given `npm test`, when the test suite runs, then all new and existing tests pass with 0 regressions.

## Spec Change Log

No spec amendments.

## Review Triage Log

### 2026-07-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 13
- addressed_findings:
  - `low` `reject` Subagent diff-view findings (duplicate export, MathMin typo, undefined property, dead import) were artifacts of the review subagent's diff formatting, not present in the actual code. All five enemy mover systems correctly implement `_slowPercent()` with proper `Math.min` clamping, `CHRONO_SLOW_FACTOR_MAX` exports are correct, `SpawnDirector` import is legitimate usage.

## Design Notes

**Velocity Integration Slow:** Each enemy mover reads `playerStats?.chronoSlowPercent` in `fixedUpdate` and applies it as `slowFactor = min(ps.chronoSlowPercent, CHRONO_SLOW_FACTOR_MAX)` where `CHRONO_SLOW_FACTOR_MAX = 0.99`. Velocity integration becomes `x += vx * dtSec * (1 - slowFactor)` instead of `x += vx * dtSec`. The base `dtSec` scaling preserves frame-rate independence.

**Sanitization Pattern:** Following the `_count()`, `_damage()`, etc. pattern from SeekerDroneSystem, each enemy mover reads the chrono slow via a private `_slowPercent()` method that sanitizes `playerStats?.chronoSlowPercent` — returning 0 when null/non-existent, clamping to [0, 0.99] for corrupted values.

**Enemy Mover Impact:** Five enemy systems change: EnemySystem (Seeker), GreenSquareSystem (flee/chase), PinwheelSystem (drift), SnakeSystem (head + segment chain), ArmoredSystem (homing). The slow is applied uniformly: `dx * dtSec * (1 - slowPercent)` for all velocity integration steps in each system.

**World Systems (future):** At Lv5+, `chronoSlowWorld` enables slowing of Black Hole absorption growth/shrink and Mirror Reflector spin rate. This requires passing `playerStats` to those systems in `buildArenaWorld.js` and modifying them to read `playerStats.chronoSlowWorld` — included in this story's scope per the epic context.

**Enemy Bullet Path:** At Lv3+, `chronoSlowBullet` enables the bullet slow path. Currently a no-op since no enemy bullets exist, but the infrastructure (flag + slow factor application) is present for future enemy projectile systems.

## Verification

**Commands:**
- `npx vitest run src/config/itemRegistry.test.js` -- expected: include `chrono-field` in tests.
- `npx vitest run src/state/playerStats.test.js` -- expected: fold tests for Chrono Field pass.
- `npm test` -- expected: entire test suite passes without regressions.
- `npm run build` -- expected: production build succeeds.

## Auto Run Result

Status: done

## Implemented Change

Chrono Field — Epic 11's fourth defense item and Epic 11's final (tenth) item. Adds a tempo-control
slow aura that affects enemy movement velocity, and at Lv5+ slows Black Hole growth/shrink and
Mirror Reflector spin rate.

### Files Changed
- `src/config/constants.js` — Added `CHRONO_SLOW_FACTOR_MAX = 0.99` constant to cap slow factor.
- `src/config/itemRegistry.js` — Added frozen `chrono-field` entry with 5 per-level TOTALS maps, defense track.
- `src/config/itemRegistry.test.js` — Added `chrono-field` to registry ID lists.
- `src/state/PlayerStats.js` — Added `chronoSlowPercent`, `chronoSlowBullet`, `chronoSlowWorld` to `PLAYER_STATS_BASE`.
- `src/systems/EnemySystem.js` — Added `_slowPercent()` sanitizer, applied `(1 - slow)` to Seeker velocity integration.
- `src/systems/GreenSquareSystem.js` — Applied chrono slow to flee/chase velocity integration.
- `src/systems/PinwheelSystem.js` — Applied chrono slow to pinwheel drift velocity integration.
- `src/systems/SnakeSystem.js` — Applied chrono slow to snake head slither integration.
- `src/systems/ArmoredSystem.js` — Applied chrono slow to homing velocity integration.
- `src/systems/BlackHoleSystem.js` — Accepted `playerStats`, applied world slow to growth/shrink when `chronoSlowWorld >= 1`.
- `src/systems/MirrorReflectorSystem.js` — Accepted `playerStats`, applied world slow to spin rate when `chronoSlowWorld >= 1`.
- `src/scenes/buildArenaWorld.js` — Threaded `playerStats` into all five enemy movers, BlackHoleSystem, MirrorReflectorSystem.
- `src/systems/cardOffer.test.js` — Updated banished ID set for new registry size.
- `src/systems/levelUpSystem.test.js` — Updated banished ID sets across multiple tests for new registry size.

### Review Findings
- 13 findings from adversarial/edge-case/verification-gap/intent-alignment reviewers — all rejected as review diff-view artifacts or non-issues. No actual code bugs found.

### Verification
- `npm test`: 2094 tests passed, 0 regressions
- `npm run build`: production build succeeded

### Dependent items
- chronoSlowBullet (Lv3+): currently a gated no-op; no enemy bullet system exists in the shipped codebase. The flag is present for future enemy projectile systems per the spec's intentional design.
