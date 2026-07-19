---
title: 'Story 1.2 — Player Ship and Twin-Stick Movement'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'b229929b4581317af6828c12a453c833a5eddc03'
final_revision: 'c9ffd047de552af1e4556db802578ac1de51e81e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The game shell (Story 1.1) renders a bounded arena driven by a fixed-timestep `World`, but there is no player: nothing to move, no input, no entity for later firing/enemies/collision to attach to.

**Approach:** Add a player ship as a plain `World` entity moved by a Phaser-free `PlayerMovementSystem` that runs in the existing fixed-timestep loop — velocity-based with input thrust, exponential drag to a smooth stop, a max-speed cap, arena-boundary clamping, and rotation toward travel direction. A thin Phaser input layer (gamepad left stick + WASD/arrows) samples a normalized move-intent each render frame into a shared `InputState`; ArenaScene syncs a placeholder vector sprite from the ship entity each frame.

## Boundaries & Constraints

**Always:**
- All movement math (thrust, drag, max-speed clamp, integration, boundary clamp, facing angle) lives in the Phaser-free `PlayerMovementSystem` and runs only inside `world.fixedUpdate(dt)`, driven by the constant fixed-step `dt` — never by raw render delta. Time is scaled as `dt / 1000` (seconds); no per-frame allocation in the tick.
- Movement is velocity-based: input applies acceleration (thrust); when input is released, drag decelerates the ship smoothly toward rest. Drag is frame-rate-independent (exponential: `v *= retainPerSec ** dtSec`).
- The ship is clamped to the arena interior (border inset ± ship radius on each axis) and cannot leave; the velocity component pushing into a wall is zeroed on clamp so it does not accumulate.
- The ship rotates to face its direction of travel (velocity) while moving; when effectively stopped (speed below a small threshold) the last facing angle is held, not snapped to zero.
- Keyboard diagonals and gamepad stick input are normalized so magnitude never exceeds 1 (diagonal is not faster); the gamepad stick uses a radial deadzone.
- Every tunable magnitude (accel, max speed, drag, deadzone, radius, turn threshold, color) is a named constant in `src/config/constants.js` — no inline magic numbers.
- Pure movement and input math must be unit-testable headlessly under Vitest (no Phaser import in `PlayerMovementSystem`, `PlayerShip`, `InputState`, `inputMath`).

**Block If:**
- (none anticipated — this story adds to an existing, installed toolchain.)

**Never:**
- Do not implement aim/firing, bullets, enemies, collision, death, score, or HUD — later stories. Rotation here follows travel direction only; a separate aim stick / mouse aim arrives in Story 1.3.
- Do not add particle trails, thrust FX, bloom, or any signature aesthetic — placeholder vector shape only (Epic 4).
- Do not add render-frame interpolation, input remapping/config screens, or gamepad hot-swap polish — deferred to later stories (5.4).
- Do not pool the ship (single long-lived entity) or add speculative component/ECS machinery beyond the existing `World`/`System` structure.

## I/O & Edge-Case Matrix

Behavior of `PlayerMovementSystem.fixedUpdate(dt)` on a ship entity given an `InputState`:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thrust from rest | move `(1,0)`, ship `vx=0` | after one tick `vx > 0` and `x` increased; `vx ≈ SHIP_ACCEL*dtSec` (pre-drag) | No error expected |
| Diagonal not faster | move `(1,1)` (unnormalized) | intent magnitude clamped to 1; resulting accel magnitude ≈ `SHIP_ACCEL*dtSec`, not `√2×` | No error expected |
| Drag to stop | no input, `vx>0` | speed strictly decreases each tick, monotonically approaching ~0; never reverses sign | No error expected |
| Max-speed cap | sustained thrust many ticks | speed converges to and never exceeds `SHIP_MAX_SPEED` | No error expected |
| Boundary clamp | position driven past `maxX` | `x` clamped to `ARENA_WIDTH - inset - radius`; `vx` (outward) set to 0 | No error expected |
| Facing while moving | `vx>0, vy>0` above turn threshold | `angle == atan2(vy, vx)` | No error expected |
| Facing while stopped | speed below `SHIP_MIN_TURN_SPEED` | `angle` unchanged from prior tick | No error expected |
| Radial deadzone | gamepad stick within deadzone | move intent resolves to `(0,0)` (no drift) | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- EDIT: add ship feel constants (`SHIP_ACCEL`, `SHIP_MAX_SPEED`, `SHIP_DRAG_RETAIN_PER_SEC`, `SHIP_MIN_TURN_SPEED`, `SHIP_RADIUS`, `COLOR_SHIP`) and `INPUT_DEADZONE`.
- `src/main.js` -- EDIT: enable the gamepad input plugin (`input: { gamepad: true }`) so the left stick is readable.
- `src/entities/PlayerShip.js` -- NEW (Phaser-free): `createPlayerShip()` → `{ x, y, vx, vy, angle, radius }` spawned at arena center from constants; the shared ship entity shape later stories (1.3 firing origin, 1.4 homing target, 1.5 collision) build on.
- `src/input/inputMath.js` -- NEW (Phaser-free): pure `applyRadialDeadzone(x, y, deadzone)` and `clampToUnitCircle(x, y)`.
- `src/input/InputState.js` -- NEW (Phaser-free): carrier holding `moveX`/`moveY`; `setMove(x, y)` clamps to the unit circle before storing; `clear()`.
- `src/input/PlayerInputSampler.js` -- NEW (Phaser-tied, thin): reads gamepad left stick (deadzoned) with WASD/arrow-key fallback each render frame and writes the resulting intent into an `InputState`.
- `src/systems/PlayerMovementSystem.js` -- NEW (Phaser-free): the AC-bearing movement integration over the ship entity + `InputState`, run per fixed tick.
- `src/scenes/ArenaScene.js` -- EDIT: create the ship entity + placeholder vector sprite, `InputState`, `PlayerInputSampler`, and `PlayerMovementSystem` (added to the world); sample input each render frame, then sync sprite position/rotation from the ship entity.
- `src/systems/playerMovementSystem.test.js` -- NEW: unit tests for every I/O & edge-case matrix row over the movement system.
- `src/input/inputMath.test.js` -- NEW: unit tests for deadzone + unit-circle clamp (incl. `InputState.setMove` normalization).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the ship + input constants listed in the Code Map with sane, documented, tunable defaults -- keeps all feel magnitudes centralized (no inline numbers).
- `src/main.js` -- add `input: { gamepad: true }` to the Phaser config -- enables left-stick reads without touching the scene chain.
- `src/entities/PlayerShip.js` -- implement `createPlayerShip()` spawning at `(ARENA_WIDTH/2, ARENA_HEIGHT/2)` with zero velocity and `radius = SHIP_RADIUS` -- the shared player entity.
- `src/input/inputMath.js` -- implement `applyRadialDeadzone` (zero below deadzone, rescale so response starts at 0 at the deadzone edge) and `clampToUnitCircle` (scale down only when magnitude > 1) -- pure input math.
- `src/input/InputState.js` -- implement the move-intent carrier with unit-circle-clamped `setMove` and `clear` -- the render↔sim seam the movement system reads.
- `src/input/PlayerInputSampler.js` -- read gamepad `pad.leftStick` (deadzoned) when a pad is connected and engaged, else WASD/arrow keys as `(right-left, down-up)`; write via `inputState.setMove` -- the thin Phaser input boundary.
- `src/systems/PlayerMovementSystem.js` -- implement `fixedUpdate(dt)`: apply thrust from intent, exponential drag, max-speed clamp, integrate position, clamp to arena interior with outward-velocity zeroing, and set facing angle from velocity above the turn threshold -- the fixed-timestep movement logic.
- `src/scenes/ArenaScene.js` -- wire the ship entity, placeholder triangle vector sprite (nose along +x, drawn once, transformed per frame), input state, sampler, and movement system; in `update()` sample input, advance the fixed timestep, then sync `sprite.setPosition(ship.x, ship.y)` and `sprite.rotation = ship.angle` -- delivers on-screen movement without running sim in the render callback.
- `src/systems/playerMovementSystem.test.js` -- unit-test every I/O matrix row -- proves the movement AC logic headlessly.
- `src/input/inputMath.test.js` -- unit-test deadzone thresholds/rescale, unit-circle clamp, and `InputState.setMove` diagonal normalization -- proves input math headlessly.

**Acceptance Criteria:**
- Given a running game, when the player pushes movement input (gamepad left stick or WASD/arrows), then the ship accelerates in that direction (velocity + thrust) and its sprite rotates to face travel direction.
- Given the ship moving toward an arena edge, when it reaches the boundary, then it is clamped inside the arena interior and cannot cross the border (FR3).
- Given no movement input while the ship drifts, when successive ticks run, then drag decelerates it smoothly to a near-stop without reversing direction, using only centralized feel constants.
- Given the codebase, when a reviewer inspects it, then `PlayerMovementSystem`, `PlayerShip`, `InputState`, and `inputMath` are Phaser-free, the movement system runs inside `world.fixedUpdate(dt)`, and the movement + input math are covered by passing unit tests.
- Given `npm test` and `npm run build`, when they run, then all unit tests pass and the production build completes, both with exit code 0.

## Design Notes

Movement integration order inside one fixed tick (semi-implicit Euler; `dtSec = dt/1000`):

```js
// 1. thrust from normalized intent (magnitude ≤ 1)
ship.vx += moveX * SHIP_ACCEL * dtSec;
ship.vy += moveY * SHIP_ACCEL * dtSec;
// 2. exponential drag — frame-rate independent, smooth stop
const k = Math.pow(SHIP_DRAG_RETAIN_PER_SEC, dtSec);
ship.vx *= k; ship.vy *= k;
// 3. cap speed
const sp = Math.hypot(ship.vx, ship.vy);
if (sp > SHIP_MAX_SPEED) { const f = SHIP_MAX_SPEED / sp; ship.vx *= f; ship.vy *= f; }
// 4. integrate, then clamp to arena, zeroing the outward component
ship.x += ship.vx * dtSec; ship.y += ship.vy * dtSec;
// clampX/clampY against inset±radius; if clamped, zero vx/vy pushing outward
// 5. face travel direction only when actually moving
if (Math.hypot(ship.vx, ship.vy) > SHIP_MIN_TURN_SPEED) ship.angle = Math.atan2(ship.vy, ship.vx);
```

`SHIP_DRAG_RETAIN_PER_SEC` is the fraction of speed retained after one input-free second (0..1; smaller = snappier stop). Phaser `rotation` is clockwise-positive with y-down, matching `atan2(vy, vx)`, so no angle conversion is needed. Input is sampled at render rate as a *level* (current intent), consumed at sim rate — correct for continuous movement (no edge events to miss). Render-frame interpolation via `FixedTimestep.alpha` is intentionally omitted here (identical at 60/60) and left as later polish.

## Verification

**Commands:**
- `npm test` -- expected: exit 0; all suites pass, including the new `playerMovementSystem` and `inputMath` tests.
- `npm run build` -- expected: exit 0; `dist/` bundle emitted.

**Manual checks (if no CLI):**
- `npm run dev`: the ship appears at arena center; WASD/arrows (and a gamepad left stick) accelerate it with visible momentum; releasing input drifts it to a smooth stop; the nose points along the direction of travel; driving into any edge stops the ship at the border without crossing it.

## Spec Change Log

_No entries — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 1
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` Boundary-clamp coverage was asymmetric — only the `maxX` and `minY` branches were tested, leaving the hand-duplicated `minX`/`maxY` branches (and their outward-velocity sign guards) unverified against a copy-paste typo. Added two mirror tests (`minX`, `maxY`); `playerMovementSystem.test.js` 9 → 11 tests, all four wall branches now asserted.
- deferred:
  - `PlayerInputSampler.sample()` input logic (keyboard `(right-left, down-up)` axis mapping + gamepad-priority deadzone fall-through) has no automated coverage; three review layers (adversarial, verification-gap, intent-alignment) converged on it. Recorded to `deferred-work.md` — it is the deliberately-thin Phaser boundary the spec scoped out of headless testing, and closing it needs scene/input mocking infrastructure beyond this story's captured intent (orchestrator-owned).
- rejected (noise / out-of-scope on the intent's authority / not a present defect):
  - NaN/non-finite gamepad axis propagating to a permanent `NaN` position — the browser Gamepad API yields finite doubles; speculative (same class rejected in Story 1.1's Phaser-emits-no-NaN finding).
  - Near-zero deadzoned stick (`x !== 0 || y !== 0`) suppressing the keyboard — requires a pad resting *past* a 25% radial deadzone (broken/drifting hardware); input-priority + hot-swap polish is Story 5.4 (FR16) per the epic breakdown.
  - Entity/system "ownership divergence" (ship in `world.entities` but system holds a direct ref) — no present defect; systems holding their own state matches the existing `SimClockSystem` pattern, and the ship is in `world.entities` for later homing/collision discovery (1.4/1.5).
  - `applyRadialDeadzone` not validating `deadzone ∈ [0,1)` — speculative caller misuse of a constant-driven value (same class as 1.1's rejected Pool already-active guard).
  - `scene.input.keyboard.addKeys` unguarded against a disabled keyboard plugin — speculative future config change; keyboard is on by default and never disabled.
  - `getPad()` not checking `pad.connected` — rare multi-pad connect/disconnect ordering; gamepad hot-swap is Story 5.4 (FR16).
  - `PlayerMovementSystem` header comment "feel identical regardless of frame rate" called overstated — the movement integration *is* frame-rate-independent (fixed dt); precedent-rejected in 1.1 (standard fixed-timestep phrasing).
  - Ship velocity never snapped to exactly 0 below the turn threshold ("creeps indefinitely") — exponential drag reaches sub-pixel/s within ~2s and passes the drag-to-stop assertion (< 1 px/s); honest asymptotic drag that meets the "smooth stop" AC.
  - Doc note that the max-speed cap masks drag-tuning of the ceiling; redundant initial `create()` sprite sync; `InputState.setMove` double-normalization on the pad path — nice-to-have/nits (the unit-circle clamp is correctly load-bearing for raw keyboard diagonals).
  - No scene-shutdown teardown of the sprite/keys — no scene-restart path exists yet; the later story that introduces restart owns its teardown.
  - Degenerate arena smaller than `2 × ship.radius` inverting the clamp bounds — unreachable under the current constants (1280×720 interior vs radius 16).

## Auto Run Result

Status: done

**Summary:** Implemented Story 1.2 — the player ship and twin-stick *movement* half (the aim stick / mouse aim is Story 1.3, per the epic breakdown). A `PlayerShip` plain entity is added to the existing fixed-timestep `World` and moved by a Phaser-free `PlayerMovementSystem`: velocity-based with input thrust, exponential frame-rate-independent drag to a smooth stop, a max-speed cap, arena-interior clamping with outward-velocity zeroing, and facing that follows the direction of travel. A thin Phaser input boundary (`PlayerInputSampler`) samples the gamepad left stick (radial deadzone) with a WASD/arrow-key fallback into a shared `InputState` the sim consumes. All feel magnitudes are centralized constants. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel against the diff since baseline `b229929`; the intent-alignment audit confirmed the correct reading (movement now, aim deferred) with no intent_gap and no bad_spec.

**Files changed (committed in `c9ffd04`):**
- `src/config/constants.js` — added ship feel constants (`SHIP_ACCEL`, `SHIP_MAX_SPEED`, `SHIP_DRAG_RETAIN_PER_SEC`, `SHIP_MIN_TURN_SPEED`, `SHIP_RADIUS`, `COLOR_SHIP`) and `INPUT_DEADZONE`.
- `src/main.js` — enabled the gamepad input plugin (`input: { gamepad: true }`).
- `src/entities/PlayerShip.js` — NEW (Phaser-free): `createPlayerShip()` → `{x,y,vx,vy,angle,radius}` spawned at arena center.
- `src/input/inputMath.js` — NEW (Phaser-free): pure `applyRadialDeadzone` + `clampToUnitCircle`.
- `src/input/InputState.js` — NEW (Phaser-free): unit-circle-clamped move-intent carrier.
- `src/input/PlayerInputSampler.js` — NEW (thin Phaser boundary): gamepad-left-stick + WASD/arrow sampling.
- `src/systems/PlayerMovementSystem.js` — NEW (Phaser-free): the AC-bearing movement integration.
- `src/scenes/ArenaScene.js` — wired the ship entity, placeholder triangle sprite, input state/sampler, and movement system; per-frame sprite sync.
- `src/input/inputMath.test.js` — NEW: 10 tests (deadzone, unit-circle clamp, `InputState.setMove`).
- `src/systems/playerMovementSystem.test.js` — NEW: 11 tests covering every I/O matrix row plus all four wall-clamp branches.

**Review findings breakdown:** patch 1 (low 1) · defer 1 · reject 13 · intent_gap 0 · bad_spec 0.
- Patched: asymmetric boundary-clamp coverage — added `minX`/`maxY` mirror tests so all four wall branches are asserted (`playerMovementSystem.test.js` 9 → 11).
- Deferred (→ `deferred-work.md`): `PlayerInputSampler.sample()` input logic (keyboard axis mapping + gamepad-priority fall-through) has no automated coverage — three review layers converged; it is the deliberately-thin Phaser boundary and closing it needs scene/input mocking beyond this story's captured intent.
- Rejected (13): NaN-from-gamepad (browser API yields finite doubles); near-zero-stick-suppresses-keyboard (broken-hardware + 5.4 polish); entity/system "ownership divergence" (no present defect; matches `SimClockSystem` pattern); deadzone range validation, keyboard-plugin-disabled guard, `pad.connected` check (speculative / 5.4 gamepad polish); overstated frame-rate comment (precedent-rejected in 1.1); asymptotic rest velocity (meets smooth-stop AC); cap-masks-drag doc note, redundant initial sprite sync, double-normalization (nits); no scene-shutdown teardown (no restart path yet); degenerate-arena clamp inversion (unreachable under current constants).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 1 → score = 3×0 + 1×1 = 1 (< 5, no high).

**Verification performed:**
- `npm test` → 45/45 pass across 5 files (pool 8, fixedTimestep 11, world 5, inputMath 10, playerMovementSystem 11), exit 0. Re-run after the patch also green.
- `npm run build` → exit 0; `dist/` bundle emitted (Phaser chunk-size warning is expected and out of scope).
- Matrix Test Audit: all 8 I/O matrix rows covered by tests that ran and passed.

**Residual risks / artifacts:**
- The deferred input-sampler coverage gap remains open (tracked in `deferred-work.md`) — a sign inversion or broken pad↔keyboard priority in `PlayerInputSampler` would not be caught by the current headless suite; the `npm run dev` manual check is the only live-input verification.
- Feel constants (`SHIP_ACCEL=2600`, `SHIP_MAX_SPEED=520`, drag retain `0.015`, etc.) are first-pass defaults; the epic explicitly expects hand-tuning post-launch. They are structurally correct and centralized.
- Residual working-tree artifacts left in place (not part of the reviewed code diff; orchestrator-owned): the modified `deferred-work.md`, this spec file, and `sprint-status.yaml` (still lists `1-2-...: backlog` — the orchestrator owns the status flip, per the Story 1.1 convention).
- `final_revision`: `c9ffd047de552af1e4556db802578ac1de51e81e`.
