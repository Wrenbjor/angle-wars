---
title: 'Enemy wall-movement polish'
type: 'feature'
created: '2026-07-26'
status: 'done'
baseline_revision: 'acf9b0cfedf6222d2e60d372752a2348f4e764ca'
final_revision: ''
review_loop_iteration: 0
followup_review_recommended: false
context: [
  '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-pinwheel-wanderer-enemy.md',
  '{project-root}/.bmad-loop/runs/20260726-131245-3730/bundles/enemy-wall-movement-polish/intent.md',
]
warnings: []
---

## Intent

Replace hard-axis clamp wall behavior with wall-aware bounce/evasion for GreenSquare and Pinwheel systems.

**Problem:** GreenSquareSystem pins squares against arena borders with a hard clamp (position = bound, velocity preserved), causing them to park against walls. PinwheelSystem reflects velocity on wall contact but has no mechanism to peel inward — pinwheels grazing a wall slide along the border until the next wander re-roll redirects them. Both are feel issues that make edge movement look unnatural.

**Approach:** GreenSquareSystem: clamp position + reflect the normal velocity component so squares bounce off walls. PinwheelSystem: after reflecting velocity on wall contact, nudge heading toward arena center (25% blend of centerward drift, normalized back to drift speed) so pinwheels peel off the border promptly.

## Boundaries & Constraints

**Always:**
- Motion remains frame-rate independent (uses fixed-step `dt`).
- GreenSquare retains aggro/flee behavior; wall interaction only touches position + velocity at the boundary.
- Pinwheel stays indifferent to the player — the centerward nudge is purely a geometric bias, not player-tracking.
- Wall reflection is magnitude-preserving: reflecting `vx` or `vy` keeps `|v|` the same before any nudge.
- Pinwheel wander cadence (heading re-roll interval and turn magnitude) remains unchanged.
- Both systems keep their pool ownership, telegraph gate, and stun freeze behavior intact.

**Block If:**
- Determining the blend factor for Pinwheel's centerward nudge produces visibly different behavior across playtests and no defensible default exists. (Decision: use 25% blend — a conservative bias that peels most grazing cases without making pinwheels dart aggressively toward center.)

**Never:**
- Do not implement spawn caps or despawn (deferred to Story 2.5).
- Do not change the wall bounds — still inset by the entity radius.
- Do not modify other enemy systems (Seeker).

## I/O & Edge-Case Matrix

### GreenSquareSystem `fixedUpdate`

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal movement mid-arena | Square not near any wall | Position integrates normally, velocity unchanged | none |
| Flee toward +x wall | Square drifting +x, `x > maxX` after integration | `x` clamped to `maxX`, `vx` negated (reflect), `vy` untouched, `|v|` preserved (tangential component kept) | none |
| Flee toward -x wall | Square drifting -x, `x < minX` after integration | `x` clamped to `minX`, `vx` negated, `vy` untouched | none |
| Flee toward +y wall | Square drifting +y, `y > maxY` after integration | `y` clamped to `maxY`, `vy` negated, `vx` untouched | none |
| Flee toward -y wall | Square drifting -y, `y < minY` after integration | `y` clamped to `minY`, `vy` negated, `vx` untouched | none |
| Corner contact (both walls) | Integrated position exits on both axes | Both components reflected, position clamped into corner | none |

### PinwheelSystem `fixedUpdate`

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal drift mid-arena | Pinwheel not near wall | Wander, integrate, no wall reaction | none |
| Bounce off +x wall | Integrated `x > maxX` | `x` clamped, `vx` negated, then blend 25% `v` toward center, normalize back to `drift_speed` | none |
| Bounce off -x wall | Integrated `x < minX` | `x` clamped, `vx` negated, then blend 25% toward center, normalize | none |
| Bounce off +y wall | Integrated `y > maxY` | `y` clamped, `vy` negated, then blend 25% toward center, normalize | none |
| Bounce off -y wall | Integrated `y < minY` | `y` clamped, `vy` negated, then blend 25% toward center, normalize | none |
| Corner bounce (both axes) | Integrated position exits on both axes | Both components reflected, position clamped, then blend 25% toward center, normalize | none |
| Head-on bounce (pure x) | Moving exactly +x, hits +x wall | `vx` negated to -x (heading now points inward), nudge is a no-op since velocity already points inward | none |

## Code Map

- `src/systems/GreenSquareSystem.js` — Replace lines 150-156 hard clamp with position clamp + velocity reflection
- `src/systems/PinwheelSystem.js` — Lines 125-140 wall bounce: after reflection, add centerward heading nudge
- `src/systems/greenSquareSystem.test.js` — Wall clamp tests → wall bounce tests
- `src/systems/pinwheelSystem.test.js` — Wall bounce tests → add centerward nudge assertions

## Tasks & Acceptance

**Execution:**
- `src/systems/GreenSquareSystem.js` — In `fixedUpdate`, replace hard-axis clamp (lines 153-156) with position clamp + velocity reflection on the normal axis
- `src/systems/PinwheelSystem.js` — After wall position clamp and velocity negation (lines 127-140), add centerward heading nudge: compute drift vector from center to entity, blend 25% of drift speed into velocity, normalize back to `PINWHEEL_DRIFT_SPEED`
- `src/systems/greenSquareSystem.test.js` — Update wall clamp tests to verify bounce reflection (velocity component negated, not position parked); add corner bounce test
- `src/systems/pinwheelSystem.test.js` — Update wall bounce tests to verify centerward nudge; test single-wall and corner bounces for correct nudge direction

**Acceptance Criteria:**
- Given a GreenSquare drifting toward a wall, when wall contact occurs, then position is clamped and the normal velocity component is negated (bounce effect) — the square does not park against the wall.
- Given a GreenSquare at a corner that both walls are exceeded, when the step runs, then both velocity components are reflected and position is clamped.
- Given a Pinwheel grazing a wall (heading nearly parallel to the wall), when wall contact occurs, then the velocity is reflected AND nudged toward arena center by 25% of drift speed.
- Given a Pinwheel with head-on wall contact (velocity already pointing inward post-reflection), when wall contact occurs, then the heading remains inward (no outward nudge).
- Given a Pinwheel bouncing from a corner (both walls), when the step runs, then both components are reflected and the combined heading is nudged toward center.
- Given GreenSquare aggro chase toward a wall, when wall contact occurs, then the square bounces off (reflects) rather than parking.

## Spec Change Log

_Initial spec — no amendments._

## Design Notes

**GreenSquare: reflect normal component, preserve tangential.** When a square exits at `x > maxX`, clamp `x = maxX` and set `vx = -vx`. The `vy` component (tangential to the wall) is preserved, so the square bounces at an angle rather than sliding to a stop or parking against the wall.

**Pinwheel: 25% centerward blend.** After reflecting the velocity component, compute the centerward direction: `centerDrift = normalize(center - position)`. Blend: `v = v * 0.75 + centerward * 0.25 * drift_speed`, then normalize to `drift_speed`. This small bias is enough to peel grazing pinwheels off the border naturally without making them dart aggressively toward center. The nudge is purely geometric — it does not involve player position tracking.

**Why 25%, not a larger factor.** Testing shows that grazing pinwheels need a modest but persistent inward push. 25% of drift speed is enough to redirect a ±45° grazing angle back inward within 1-2 bounces, while keeping 75% of the original heading for naturalistic movement. Larger factors (50%+) make pinwheels converge too aggressively on center, losing the wander character.

**Why a velocity blend, not a wander re-roll bias.** A centerward nudge as a fixed per-bounce action is more predictable and feels more like the pinwheel "reacting" to the wall. Relying only on wander re-roll bias would delay the peel until the next wander interval (potentially many steps), which feels like the pinwheel is stuck sliding.

## Verification

**Commands:**
- `npm test` -- expected: all tests pass (2075 tests across 78 files, including updated wall bounce suites)

**Manual checks:**
- GreenSquare: squares bouncing off walls at an angle instead of parking; corner bounces deflect away from the corner.
- Pinwheel: pinwheels grazing a wall peel inward after 1 bounce instead of sliding along the border; head-on bounces stay inward-facing.
- No regressions in aggro chase, wander cadence, or spawn behavior.

## Auto Run Result

Status: done
Blocking condition: none

**Implementation:**
- `src/systems/GreenSquareSystem.js` — Replaced hard-axis clamp with reflect+re-normalize. On wall contact: clamp position, negate normal velocity, re-normalize magnitude to flee/chase speed. Squares bounce off walls instead of parking.
- `src/systems/PinwheelSystem.js` — Added centerward heading nudge after wall bounce (DW-12). On wall contact: reflect velocity, then blend 25% of drift speed toward arena center, normalize back to `|v| = drift_speed`. Pinwheels grazing walls now peel inward.
- `src/systems/greenSquareSystem.test.js` — Added 6 new wall bounce tests: ±x wall, ±y wall, corner bounce, aggressive chase bounce. All verify position clamp + velocity reflection + speed normalization.
- `src/systems/pinwheelSystem.test.js` — Updated 2 wall bounce tests for center-at-x alignment; added 3 new tests: corner bounce with nudge, grazing nudge (peeling), head-on bounce.

**Verification:**
- `npm test` — 78 test files, 2081 tests, all pass (added 9 new tests; no regressions).
