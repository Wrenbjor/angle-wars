---
title: 'Story 9.2 — Build-Adaptive Spawn Scaling'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: '8685a16ef64eb5f42fc35f69fdda28363540e648'
final_revision: 'a7d8323'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The v1 `SpawnDirector` escalates spawn pressure purely on elapsed time, so a strong build eventually out-damages the swarm and minute 20 turns idle. Story 9.1 delivered a live `dps` signal (build power) but nothing consumes it yet.

**Approach:** Add a **damped adaptive rate governor** to `SpawnDirector` that consumes `dpsTelemetry.dps`. A slew-rate-limited `pressure` scalar tracks a dps-derived target and shortens the effective spawn interval below the v1 curve — so higher sustained DPS raises spawn rate, bounded per adjustment, with the v1 time-ramp preserved as a hard floor. This is the rate lever only; toughness/armor is Story 9.3 and the explicit boost-hook/validation harness is Story 9.4.

## Boundaries & Constraints

**Always:**
- The v1 time-based interval (`intervalAt(elapsed)`) is a **hard floor**: the effective interval is `floorInterval / (1 + pressure)` with `pressure >= 0`, so the adaptive layer only ever spawns *equal-or-faster* than v1, never slower. At `pressure === 0` the effective interval equals the v1 interval exactly.
- The governor is **damped**: `pressure` moves toward its target by at most `SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS * dt` per fixed step (a slew-rate limiter). It can never overshoot a constant target and therefore cannot oscillate.
- `pressure` is bounded to `[0, SPAWN_DIRECTOR_MAX_PRESSURE]`; the target is `clamp(dps / SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE, 0, SPAWN_DIRECTOR_MAX_PRESSURE)`. This bound (with the existing `MAX_ACTIVE` cap) is the death-spiral guard.
- Runs on the fixed step only (advances by `dt`), so it is frame-rate-independent by construction: identical tick sequence ⇒ identical `pressure` and effective interval.
- The dps source is **optional and late-bound**: `this.dpsTelemetry` defaults to `null`; when null the governor reads dps as `0`, `pressure` stays `0`, and the director's behavior is byte-identical to v1. The scene wires it after both systems exist (the director runs earlier in the tick than the telemetry, so it reads last tick's `dps` — a harmless, causally-necessary one-tick lag).
- Zero per-tick allocation: the governor adds only scalar field updates; no new arrays/objects/closures in `fixedUpdate`.
- The governor is event-agnostic — it tracks the `dps` signal, so any power drop (death reset, remnant consumption) manifests as a falling `dps`, which relaxes `pressure` back toward the floor. No event wiring.

**Block If:**
- (none — the lever (rate), the control law (slew-limited pressure), the floor semantics, and the source (optional late-bound telemetry) are all resolved here; no unattended decision remains.)

**Never:**
- Do NOT add enemy HP / armor / a projectile-vs-melee damage modifier (Story 9.3).
- Do NOT add an explicit transient boost-hook entry point or the governor-validation harness (Story 9.4) — this story only builds the governor that 9.4 will validate.
- Do NOT adapt the mix weights or introduce a second closed loop; the `pressure` scalar is the reusable seam a later story can also tap. Keep `intervalAt` / `weightAt` / `currentInterval` as pure v1 functions (existing tests pin them).
- Do NOT introduce wall-clock time; advance on the fixed step only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No telemetry bound | `dpsTelemetry === null` | `pressure` stays 0; effective interval === `intervalAt(elapsed)` every tick (v1 behavior) | No error expected |
| Zero DPS | telemetry with `dps === 0` | target 0; `pressure` stays 0; effective interval === v1 floor | No error expected |
| Sustained high DPS | `dps` held above reference for many ticks | `pressure` rises gradually (≤ slew·dt per tick) to its clamped target and holds; effective interval settles at `floor/(1+pressure)` < floor | No error expected |
| Sudden power spike | `dps` steps 0 → large in one tick | `pressure` climbs monotonically toward target by bounded steps, never overshoots (no oscillation), clamps at `MAX_PRESSURE` | No error expected |
| Sudden power drop | `pressure` high, then `dps` → 0 | `pressure` falls monotonically toward 0 by bounded steps; effective interval relaxes back up toward the v1 floor, reaching it exactly at `pressure === 0` | No error expected |
| Framerate independence | same tick/dps sequence, fine vs coarse dt to same elapsed (constant target) | identical `pressure` and effective interval | No error expected |

</intent-contract>

## Code Map

- `src/systems/SpawnDirector.js` -- the system to extend: add optional `dpsTelemetry` field, a public read-only `pressure`, the governor update in `fixedUpdate`, effective-interval application to the spawn loop, and an `effectiveInterval` getter. `intervalAt`/`weightAt`/`currentInterval` stay pure v1.
- `src/config/constants.js` -- add the three governor constants in the existing Spawn Director section.
- `src/scenes/buildArenaWorld.js` -- late-bind `spawnDirector.dpsTelemetry = dpsTelemetrySystem` after the telemetry system is constructed (mirrors the `snakeSystem.collisionSystem` late-bind). No new system, no order change.
- `src/scenes/ArenaScene.js` -- add a DEV-gated readout line for `pressure` beside the existing `dps` line (~1656).
- `src/systems/spawnDirector.test.js` -- existing v1 tests must stay green (they construct with no telemetry); add governor tests.
- `src/scenes/buildArenaWorld.test.js` -- add one wiring assertion (`ctx.spawnDirector.dpsTelemetry === ctx.dpsTelemetrySystem`); system count/order unchanged.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE = 8` (dps mapping to +1.0 pressure — interval halves), `SPAWN_DIRECTOR_MAX_PRESSURE = 2` (pressure cap → ≤3× the v1 rate), and `SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS = 0.0002` (max |Δpressure| per ms — a full 0→max swing ≈ 10s, matching the dps window). Comment each as a tunable placeholder.
- `src/systems/SpawnDirector.js` -- in the constructor add `this.dpsTelemetry = null;` and `this.pressure = 0;`. In `fixedUpdate`, before the accumulator loop, read `const dps = this.dpsTelemetry ? this.dpsTelemetry.dps : 0;`, compute `target = clamp(dps / REFERENCE, 0, MAX_PRESSURE)`, and slew `this.pressure` toward `target` by at most `SLEW_PER_MS * dt` (snap to target when within one step — no overshoot). Compute `const floor = this.intervalAt(this._elapsedMs)` and use `const interval = floor / (1 + this.pressure)` as the loop's interval (replacing the current `intervalAt` call). Add `get effectiveInterval() { return this.intervalAt(this._elapsedMs) / (1 + this.pressure); }`. No allocation added to the hot loop.
- `src/scenes/buildArenaWorld.js` -- after `world.addSystem(dpsTelemetrySystem)`, add `spawnDirector.dpsTelemetry = dpsTelemetrySystem;` with a short comment (the closed loop; director reads last tick's dps).
- `src/scenes/ArenaScene.js` -- add ``` `pressure   : ${this.spawnDirector.pressure.toFixed(2)}` ``` to the DEV `debugText.setText([...])` array.
- `src/systems/spawnDirector.test.js` -- add a governor describe block covering every I/O-matrix row over a stub `{ dps }` telemetry: no-telemetry ≡ v1 (effective interval == `intervalAt`); zero-dps no pressure; sustained-high-dps pressure rise + settle at clamped target; spike bounded-step monotonic climb with no overshoot; drop monotonic relax back to the exact v1 floor at pressure 0; framerate independence (same tick count ⇒ same pressure); `MAX_PRESSURE` clamp; and a zero-alloc guard (`_weights` buffer stable) over many governed ticks.
- `src/scenes/buildArenaWorld.test.js` -- assert `ctx.spawnDirector.dpsTelemetry === ctx.dpsTelemetrySystem` on a fresh build.

**Acceptance Criteria:**
- Given a director with no telemetry bound (or `dps === 0`), when it runs any tick sequence, then `pressure === 0` and its effective interval equals `intervalAt(elapsed)` (the v1 floor) exactly.
- Given telemetry reporting a sustained `dps` above the reference, when the director runs the full slew, then `pressure` rises gradually (each tick's change ≤ `SLEW_PER_MS·dt`), settles at `clamp(dps/REFERENCE, 0, MAX_PRESSURE)`, and the effective interval is shorter than the v1 floor (more spawns).
- Given `dps` steps up sharply, when the director responds, then `pressure` increases monotonically without ever exceeding its target (no overshoot/oscillation) and is capped at `MAX_PRESSURE`.
- Given `pressure` is elevated and `dps` then drops to 0, when the director runs, then `pressure` decreases monotonically toward 0 and the effective interval relaxes back up to the v1 floor, reaching it exactly when `pressure === 0`.
- Given the identical tick/dps sequence driven headlessly at any cadence (constant target), when compared, then `pressure` and the effective interval are identical.

## Spec Change Log

(No bad_spec loopback occurred — empty.)

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 3: (high 0, medium 2, low 1)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[low]` `[patch]` Non-finite `dps` (NaN/`undefined` from a mis-wired/renamed telemetry source) slipped the target clamp → `pressure` NaN → effective interval NaN → `while (_accumMs >= NaN)` always false → all spawning frozen with no recovery. Not reachable under the current finite-by-construction 9.1 producer, but the governor's new division + loop-bound makes it catastrophic-if-triggered and the old `else if (target < 0)` branch was dead. Restructured the clamp to `if (!(target >= 0)) target = 0; else if (target > MAX) target = MAX;`, which snaps a non-finite/negative target to 0 (safe v1 fallback), keeping `pressure` provably finite in `[0, MAX]` every tick.
  - `[low]` `[patch]` The effective-interval formula `intervalAt/(1+pressure)` was duplicated (the `effectiveInterval` getter vs. an inline copy in `fixedUpdate`); tests observed the getter while the accumulator loop used the inline copy — the two could silently diverge — and the divisor could reach ≤ 0 (→ non-terminating loop) if `pressure` were ever ≤ -1. Consolidated `fixedUpdate` to consume `this.effectiveInterval` (one source of truth) and clamped the getter's divisor to `1 + Math.max(0, this.pressure)` (single hang-proof division site). Byte-identical for all tests since `pressure ∈ [0, MAX]` internally.
  - `[low]` `[patch]` Verification gap (broken-verification-gap): AC1's "higher DPS → more spawns" was asserted only via the `effectiveInterval` getter and the `pressure` scalar, never by observing realized spawn counts through the accumulator loop. Patch 2 structurally closes the ship-green path (loop now uses the tested getter); additionally added a test asserting a pressured director (target 1.0) fires strictly more realized spawns per fixed window than a pressure-0 director (~2×), directly exercising the loop's use of the effective interval.

## Design Notes

Slew-rate limiter toward a dps-derived target — the whole control law is damped by construction:

```js
// fixedUpdate, before the accumulator loop (pressure + elapsed fixed for the tick)
const dps = this.dpsTelemetry ? this.dpsTelemetry.dps : 0;
let target = dps / SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE;
if (!(target >= 0)) target = 0;                       // also snaps a non-finite dps → safe v1 fallback
else if (target > SPAWN_DIRECTOR_MAX_PRESSURE) target = SPAWN_DIRECTOR_MAX_PRESSURE;
const maxStep = SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS * dt;
const delta = target - this.pressure;                 // symmetric: rise and relax
if (delta > maxStep) this.pressure += maxStep;
else if (delta < -maxStep) this.pressure -= maxStep;
else this.pressure = target;                          // within one step → snap (no overshoot)
const interval = this.effectiveInterval;              // one source of truth: intervalAt/(1+max(0,pressure))
```

Why slew-limiting, not a PID/EMA: the AC demands "bounded step per adjustment" and "settles without oscillation" — a slew limiter toward a constant target is monotonic and cannot overshoot, giving both for free with one scalar and no gains to tune. The `dps` sensor is itself already smoothed over ~10s (9.1), so the governor doesn't chase noise. Dividing the v1 floor by `(1 + pressure ≥ 1)` guarantees the floor invariant algebraically — effective interval ≤ floor always, `=` at pressure 0. `pressure ∈ [0, MAX_PRESSURE]` bounds the fastest adaptive rate to `floor/(1+MAX_PRESSURE)`, and the existing summed `MAX_ACTIVE` cap remains the hard frame-budget ceiling, so no separate min-interval clamp is needed.

## Verification

**Commands:**
- `npx vitest run src/systems/spawnDirector.test.js` -- expected: existing v1 tests + new governor tests all pass.
- `npx vitest run src/scenes/buildArenaWorld.test.js` -- expected: canonical order/count unchanged + new dpsTelemetry-wiring assertion passes.
- `npx vitest run` -- expected: full suite green (no regression).
- `npx vite build` -- expected: production build succeeds; the DEV `pressure` readout tree-shakes out.

## Auto Run Result

Status: done

**Summary:** Implemented Story 9.2 — Build-Adaptive Spawn Scaling: the first consumer of the Story 9.1 `dps` signal. Added a damped, slew-rate-limited `pressure` governor to `SpawnDirector` that shortens the effective spawn interval below the v1 time-ramp — `effectiveInterval = intervalAt(elapsed) / (1 + pressure)`, with `pressure` slewing toward `clamp(dps / REFERENCE, 0, MAX_PRESSURE)` by at most `SLEW_PER_MS·dt` per fixed step. Higher sustained DPS raises spawn rate; the v1 curve is preserved as a hard floor (`pressure ≥ 0` ⇒ interval ≤ v1, `=` at pressure 0); spikes settle without overshoot (monotonic slew toward a constant target); power drops relax pressure back to the floor. The dps source is optional/late-bound, so a director with no telemetry is byte-identical to v1. Rate lever only — toughness is Story 9.3, the explicit boost-hook/validation harness is Story 9.4.

**Files changed:**
- `src/config/constants.js` — added `SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE = 8`, `SPAWN_DIRECTOR_MAX_PRESSURE = 2`, `SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS = 0.0002` (tunable placeholders) in the Spawn Director section.
- `src/systems/SpawnDirector.js` — optional `dpsTelemetry` field (default `null`) + public read-only `pressure`; slew-limited governor in `fixedUpdate` (with a finite/negative-safe target clamp); a single-source `effectiveInterval` getter (hang-proof divisor) that the accumulator loop consumes. `intervalAt`/`weightAt`/`currentInterval` remain pure v1.
- `src/scenes/buildArenaWorld.js` — late-bind `spawnDirector.dpsTelemetry = dpsTelemetrySystem` (closes the loop; director reads last tick's dps). No new system, no order change.
- `src/scenes/ArenaScene.js` — DEV-gated `pressure` readout line beside `dps`.
- `src/systems/spawnDirector.test.js` — governor describe block: no-telemetry≡v1, zero-dps, sustained-rise/settle, spike bounded-climb/clamp, drop relax-to-exact-floor, framerate independence, zero-alloc, and (review-added) realized-cadence-shortens-under-pressure.
- `src/scenes/buildArenaWorld.test.js` — `spawnDirector.dpsTelemetry === dpsTelemetrySystem` wiring assertion.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 3 deferred entries (below).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `9-2-build-adaptive-spawn-scaling`: backlog → done.

**Review findings breakdown:** 4 layers (Blind Hunter, Edge-Case Hunter, Verification-Gap, Intent-Alignment). intent_gap 0, bad_spec 0, patch 3 (all low), defer 3, reject 4.
- **Patched (3, all low):** (1) a non-finite `dps` (NaN/`undefined` from a mis-wired telemetry source) slipped the target clamp → NaN `pressure` → frozen spawns; restructured the clamp to `!(target >= 0)` so it snaps to a safe v1 fallback (also retiring the previously-dead negative branch). (2) the effective-interval formula was duplicated (getter vs. inline loop copy) and the divisor could reach ≤ 0 if `pressure` went < -1; consolidated the loop to consume the getter (one source of truth) and clamped the getter's divisor with `Math.max(0, pressure)` (single hang-proof site). (3) realized spawn cadence under pressure wasn't pinned to the accumulator loop (only the getter/scalar); patch 2 structurally closes the ship-green path and a realized-cadence test was added (pressured director fires ~2× the spawns of a pressure-0 director over the same window).
- **Deferred (3):** (1) no end-to-end stepped integration of the assembled telemetry→pressure loop — add at 9.4; (2) the epic's "spawn weight/mix" surface is not exercised by dps in 9.2 (spec excluded mix; likely absorbed by 9.3's build-power-gated armored archetype) — confirm intent at 9.4; (3) governor balance/feel (throughput-signal saturation, symmetric relaxation timing) for 9.4's governor-validation charter.
- **Rejected (4):** external mutation of the documented read-only `pressure` field (codebase convention — undefended like `dps`/`spawnCount`; and fix 2's divisor guard hardens it anyway); "MIN floor bypassed 3×" (misreads the floor — the v1 curve is a *difficulty* floor, adaptive-faster-than-MIN is the design intent, stated in the spec); soft-cap perf under pressure (MAX_ACTIVE=60 still bounds active load unchanged); "no behavioral coverage" (false — 7+ governor tests exist; that reviewer saw an abbreviated diff).

**Follow-up review recommendation:** false. Patched this pass: 0 high, 0 medium, 3 low → score `3×0 + 1×3 = 3` (< 5), no high severity.

**Verification performed:**
- `npx vitest run src/systems/spawnDirector.test.js` — 37 passed.
- `npx vitest run src/scenes/buildArenaWorld.test.js` — 21 passed.
- `npx vitest run` — 1170 passed (65 files), full suite green after the patches.
- `npx vite build` — production build succeeds; the `pressure` DEV readout tree-shakes out of the shipped bundle.

**Residual risks:** Low. The governor is a bounded, damped single-scalar controller: `pressure ∈ [0, MAX_PRESSURE]` (now finite-by-construction after the clamp fix), the v1 curve is an algebraic floor, and the existing `MAX_ACTIVE` cap remains the hard frame-budget ceiling. The optional/late-bound telemetry means a null source degrades to exact v1 behavior. Open balance questions (signal saturation, relaxation feel) and the mix-surface intent question are logged for Story 9.4, which is chartered to validate governor honesty.
