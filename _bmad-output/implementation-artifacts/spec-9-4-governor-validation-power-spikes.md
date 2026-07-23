---
title: 'Story 9.4 — Governor Validation: Power Spikes Stay Honest'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: 'e7283e88b5270a6c77873e510f910ce0442d7176'
final_revision: '45ca80ee3559a21c76f54e1543435256bd284c34'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The Epic 9 governor (9.1 DPS telemetry → 9.2 slew-limited `pressure` → 9.3 armored gating) has never been proven to answer a *transient* power spike, and there is no seam for a spike to enter it. Epic 13's Generosity Engine will grant "cheat-code" rewards (instant Lv5 item + 20× XP, invuln bursts) that must trigger proportionate threat — power-in → threat-out — reusing this governor with no new balancing surface. DW-368 also flags that the assembled telemetry→director loop is never stepped end-to-end, so a stuck-at-zero governor would ship green.

**Approach:** Add a single reusable boost hook — `DpsTelemetrySystem.applyBoost(magnitude, durationMs)` — that folds a linearly-decaying transient into the existing `dps` signal the governor already consumes. Because the boost enters `dps` (not a new director input), the whole 9.2/9.3 response answers automatically. Prove it with a stepped integration test over `buildArenaWorld()` (the harness DW-368 charters) that applies a large boost mid-run and asserts `spawnDirector.pressure` rises then re-settles as the boost fades. Add a DEV-only keybind + readout so the same spike is observable in a live run.

## Boundaries & Constraints

**Always:**
- The boost enters the governor **only** through the existing `dps` signal — no new field on `SpawnDirector`, no second pressure input. The governor's control law (9.2) and armored gating (9.3) are unchanged.
- Decay is frame-rate-independent (drains by `dt` of sim time, reaching 0 at exactly `durationMs` regardless of tick size) and allocation-free in the hot loop (scalar fields only).
- With no boost applied, `dps` is byte-identical to the 9.1 rolling estimate: every existing `dpsTelemetrySystem.test.js` exact-equality assertion stays green.
- Invalid input (`magnitude ≤ 0` / `durationMs ≤ 0` / non-finite) is a silent no-op: the hook never reduces `dps` below the real signal and never poisons it with NaN.
- Per-run reset is by reconstruction only (`scene.restart()` rebuilds the world at boost 0) — no explicit reset method.
- The DEV keybind + readout are gated behind `import.meta.env.DEV` so production tree-shakes them out.

**Block If:**
- The epic/PRD is discovered to require the boost to bypass `dps` and manipulate `pressure` directly (would contradict "no new balancing surface").

**Never:**
- Do not wire a real ad button, Capacitor plugin, or player-facing reward UI — that is Epic 13. This story ships only the hook, its default tunables, and the DEV trigger.
- Do not add a dps→archetype-mix bias, asymmetric relaxation, or an `ARMORED_MAX_ACTIVE` cap (DW-371/375/380): 9.3's build-power-gated armored spawn is the mix answer, and the symmetric-slew re-settle is validated here, not redesigned.
- Do not change `SpawnDirector`, `CollisionSystem`, or the ring/window math of the DPS estimator.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Large boost mid-run | `applyBoost(large, dur)` then step | `dps` jumps by the boost; `pressure` slews up (bounded by `SPAWN_DIRECTOR_MAX_PRESSURE`); as ticks pass the boost decays and `pressure` re-settles toward the v1 floor | No error expected |
| Boost fully faded | `dur` ms of sim elapsed after a boost | `boostDps === 0` exactly; `dps` equals the pure rolling estimate; `pressure` relaxes toward floor | No error expected |
| Stacked boosts | `applyBoost` twice before the first fades | `boostDps` accumulates; the drain rate is re-derived so the combined reservoir empties over the new `durationMs` | No error expected |
| Invalid boost | `applyBoost(0 / -5 / NaN, …)` or `(mag, 0 / NaN)` | No-op: `boostDps` unchanged, `dps` neither reduced nor made non-finite | Ignored silently |
| No boost ever | Normal run | `dps` === 9.1 rolling estimate; governor byte-identical to pre-9.4 | No error expected |

</intent-contract>

## Code Map

- `src/systems/DpsTelemetrySystem.js` -- add `applyBoost(magnitude, durationMs)`, public `boostDps` field + private `_boostDrainPerMs`; decay the boost by `dt` in `fixedUpdate` (rename `_dt`→`dt`) and set `this.dps = rollingSum/windowSec + this.boostDps`. Update the class comment for the 9.4 transient-boost seam.
- `src/config/constants.js` -- add a "Governor boost hook (Story 9.4)" block: `GOVERNOR_BOOST_DPS` (large cheat-code-stand-in magnitude) and `GOVERNOR_BOOST_DURATION_MS` (fade time), documented as tunable placeholders reused by Epic 13.
- `src/scenes/ArenaScene.js` -- DEV-only `keydown-G` handler calling `this.dpsTelemetrySystem.applyBoost(GOVERNOR_BOOST_DPS, GOVERNOR_BOOST_DURATION_MS)`; add a `boost` line to the existing DEV readout (~1693). Import the two constants.
- `src/systems/dpsTelemetrySystem.test.js` -- add boost unit cases (rise, linear decay to exactly 0 at `durationMs`, frame-rate independence of decay, stacking, invalid-input no-op, zero-alloc); confirm existing exact-equality cases stay green.
- `src/scenes/buildArenaWorld.test.js` -- **new** stepped integration test (DW-368): build the world, `applyBoost` a large spike, step `ctx.world.fixedUpdate(FIXED_STEP_MS)`, assert `pressure` rises above 0 then re-settles toward the floor after the boost fades.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `GOVERNOR_BOOST_DPS` and `GOVERNOR_BOOST_DURATION_MS` in the Spawn Director / governor area, with the tunable-placeholder note and a comment that Epic 13 calls the hook with these defaults.
- `src/systems/DpsTelemetrySystem.js` -- implement the boost hook + decay + `dps = rolling + boostDps`, per Design Notes; guard invalid input; keep zero-alloc.
- `src/scenes/ArenaScene.js` -- DEV-gated keybind + readout line; import constants.
- `src/systems/dpsTelemetrySystem.test.js` -- unit-test the I/O matrix rows for the hook.
- `src/scenes/buildArenaWorld.test.js` -- add the end-to-end governor-answers-a-boost harness.

**Acceptance Criteria:**
- Given the assembled world from `buildArenaWorld()`, when a large transient boost is applied via `dpsTelemetrySystem.applyBoost(...)` and `world.fixedUpdate(FIXED_STEP_MS)` is stepped, then `spawnDirector.pressure` rises above 0 within the fade window (the director answers), proving the loop is not stuck-at-zero.
- Given that same run, when the boost's `durationMs` of sim time has elapsed, then `boostDps` is exactly 0 and `spawnDirector.pressure` re-settles back down toward the v1 floor (a strictly lower pressure than its boosted peak).
- Given no boost is ever applied, when the DPS estimator runs, then `dps` equals the 9.1 rolling estimate and every pre-existing exact-equality test stays green.
- Given Epic 13's future reward path, when it calls `applyBoost` with the default constants, then it reuses the identical governor path — the boost's only footprint is the shared `dps` signal plus the two tunable constants (no new director input, no new balancing surface).

## Spec Change Log

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 1
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` `applyBoost` guard `!(x > 0)` accepted `+Infinity` (magnitude → permanent NaN `dps`; duration → 0 drain, never fades), violating the I/O-matrix "non-finite → silent no-op" contract. Added `Number.isFinite` to the guard; extended the invalid-input test with `+Infinity` magnitude and duration cases.
  - `[medium]` `[patch]` Integration test used a tautological `≤ MAX_PRESSURE` bound and an any-drop `< peakPressure` re-settle check — proving neither a substantive answer nor a re-settle. Replaced with observed-dynamics thresholds: `peakPressure > 0.75` (obs 1.043) and post-relax `< peakPressure * 0.5` AND `< 0.05` (obs 0).
  - `[medium]` `[patch]` No test asserted `dps === rolling + boost` with both terms non-zero (replace-semantics regression would ship green, masked by the clamp at magnitude 24). Added a combined-terms unit test (rolling `R≈120` + boost, bit-exact `R + 15`).
  - `[low]` `[patch]` `GOVERNOR_BOOST_DPS` comment computed the target as if base dps were 0; reworded to note the boost sums with live dps (target `(dps+24)/8 ≥ 3`).
  - `[low]` `[patch]` `keydown-G` omitted the scene's `event.repeat` held-key guard convention; added it.

### 2026-07-23 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 2
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` The "stacks additively and re-derives the drain" unit test used two EQUAL-duration boosts applied back-to-back with no decay between — a setup where a wrong rate-accumulating impl (`_boostDrainPerMs += magnitude/durationMs`) produces byte-identical numbers, so the test could not discriminate the I/O-matrix "combined reservoir empties over the NEW durationMs" contract (mutant-confirmed by the verification-gap layer). Added a second stacking test that decays the first boost partially, then stacks a DIFFERENT (shorter) duration, and asserts the combined reservoir empties to exactly 0 at the new duration (a rate-accumulating regression would leave 2). Full suite green (1214).
  - Deferred (2, both non-blocking coverage notes appended to the DW ledger): the integration test asserts only `pressure` and never the 9.3 armored-gating surface the "whole 9.2/9.3 answers" claim names (armored IS eligibility-reachable at the ~1.043 peak via the OR gate); and the test drives the director only through the `applyBoost` seam with rolling `dps` held at 0, so the real collision→telemetry producer edge and add-not-replace superposition are exercised only at the unit surface.
  - Rejected (13): the armored-spawn "permanent difficulty step" / threshold-redesign findings (intent explicitly designs for build-power-gated armored spawn and forbids caps/redesign); `dps`-includes-boost "poisons consumers" (intent deliberately folds boost into `dps`); short-duration-collapse & duration-reset-not-extend stacking "footguns" (the spec'd re-derive-over-new-duration behavior); `+Infinity`-via-summed-magnitude NaN poison (needs a ~1e308 magnitude — unreachable; single-call guard contract intact); unbounded G-mash & DEV readout double-count & untested G-handler (DEV-only scaffolding, pressure clamped); `toBe(0)` float-coincidence (ceil-ticks + negative-clamp make exact 0 robust); comment nits (`saturates at 2` describes the pre-slew target; `~run-length`); one-tick director lag (inherent, negligible).

## Design Notes

The boost is a real-time transient added to `dps` — the single signal the governor consumes — so the entire 9.2 rate response and 9.3 armored gating answer with **no** `SpawnDirector` change:

```js
// applyBoost — reusable entry point (Epic 13 calls this same method)
applyBoost(magnitude, durationMs) {
  if (!(magnitude > 0) || !(durationMs > 0)) return;   // silent no-op; never reduce/poison dps
  this.boostDps += magnitude;                           // stack additively
  this._boostDrainPerMs = this.boostDps / durationMs;   // re-derive so the reservoir empties over dur
}

// fixedUpdate(dt) — decay by SIM TIME (frame-rate-independent), zero alloc
if (this.boostDps > 0) {
  this.boostDps -= this._boostDrainPerMs * dt;
  if (this.boostDps < 0) this.boostDps = 0;
}
// ... existing ring/window math unchanged ...
this.dps = this._sum / windowSec + this.boostDps;       // governor already reads .dps
```

Why fold into `dps` (not add a `pressure` input): "no new balancing surface" (epic + NFR8) means the spike must enter the *same* build-power signal the governor already consumes. A `pressure` input would be a second knob and bypass armored gating's derivation. Folding into `dps` makes the boost expressible in the governor's native units (damage/sec) and routes it through the already-validated slew limiter — which gives the "rises proportionately, re-settles without overshoot" behavior for free (9.2 Design Notes). The `MAX_PRESSURE` clamp bounds a huge spike to a proportionate-up-to-cap answer; the symmetric slew relaxes it as the boost drains.

Decay is drained by `dt` (sim ms), so total drain over `durationMs` is `_boostDrainPerMs * durationMs = boostDps₀` — it reaches 0 at exactly `durationMs` for any tick size (frame-rate-independent), while the ring/window remains per-tick as in 9.1. `boostDps` is public (mirrors `this.dps`) so the DEV readout can show the spike and its fade.

Suggested tunables: `GOVERNOR_BOOST_DPS ≈ 24` (with `SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE=8` → target 3, clamped to `MAX_PRESSURE=2`: a clear, bounded, saturating spike as a cheat-code stand-in) and `GOVERNOR_BOOST_DURATION_MS ≈ 8000` (a ~run-length transient comparable to the 10s window). Both are placeholders tuned post-launch, mirroring the `SPAWN_DIRECTOR_*` convention.

Deferred-work resolutions carried by this story (non-blocking, so the sweep can close them): DW-368 is satisfied by the new end-to-end harness; DW-371/372 — no dps→mix bias (9.3 armored spawn is the mix answer); DW-375/376 — symmetric-slew re-settle is validated here, not made asymmetric; DW-380/384 — armored cap / AoE-XP remain playtest/Epic-11 questions, out of scope.

## Verification

**Commands:**
- `npx vitest run src/systems/dpsTelemetrySystem.test.js` -- expected: all green, including the new boost cases and the untouched exact-equality cases.
- `npx vitest run src/scenes/buildArenaWorld.test.js` -- expected: all green, including the new end-to-end governor-answers-a-boost harness.
- `npx vitest run` -- expected: full suite green (no regression in SpawnDirector/collision/armored tests).
- `npx eslint src/systems/DpsTelemetrySystem.js src/config/constants.js src/scenes/ArenaScene.js` -- expected: clean.

**Manual checks (if no CLI):**
- Dev build (`npm run dev`), start a run, press **G**: the DEV readout `boost` line spikes and `pressure` climbs, then both relax back over ~8s — the spike reads as a thrill that re-settles.

## Auto Run Result

Status: done (follow-up review pass)

**Summary of change (this pass):** A fresh review pass over the already-implemented Story 9.4 governor boost hook. Four review layers (adversarial, edge-case, verification-gap, intent-alignment) ran in parallel over the full diff since the baseline. One genuinely actionable finding was patched (a non-discriminating stacking test), two real coverage gaps were deferred, and 13 findings were rejected — most on the authority of the intent, which explicitly designs for build-power-gated armored spawn (no caps/redesign) and deliberately folds the boost into the shared `dps` signal.

**Files changed (this pass):**
- `src/systems/dpsTelemetrySystem.test.js` — added a discriminating stacking test (partial-decay + different-duration stack) that pins the "combined reservoir empties over the NEW durationMs" contract; a rate-accumulating regression now fails.
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended two NEW defer entries (armored-surface coverage; real-DPS producer-edge coverage).
- `_bmad-output/implementation-artifacts/spec-9-4-governor-validation-power-spikes.md` — triage log + this result.

**Review findings breakdown:** patch 1 (low 1); defer 2; reject 13; intent_gap 0; bad_spec 0. No bad_spec loopback (`review_loop_iteration` unchanged at 0).

**Follow-up review recommendation:** `false`. Patched this pass: 1 low, 0 medium, 0 high → score `3×0 + 1×1 = 1` (< 5, no high).

**Verification performed:**
- `npx vitest run src/systems/dpsTelemetrySystem.test.js src/scenes/buildArenaWorld.test.js` → 42 passed (dpsTelemetry 18, buildArenaWorld 24), including the new discriminating stacking test.
- `npx vitest run` → 1214 passed across 66 files (no regression).
- `npx eslint …` → **not applicable**: the project has no ESLint config (`eslint.config.js`) and no `lint` npm script; the spec's eslint command cannot run here. The change is a test-only addition matching the file's existing style/conventions.

**Residual risks:** The two deferred coverage notes (9.3 armored surface and the real-combat producer edge are exercised only at the unit surface, not end-to-end) are non-blocking and tracked for when Epic 13 wires real rewards. The governor's boost feel at the shipped placeholder constants remains a playtest/Epic-13 tuning question (pre-existing DW entry).

