---
title: 'Scene render-integration & sim-rate sampling coverage (DW-2)'
type: 'refactor'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: '3ee1dc257f177253b0ee3b79dc4a3659b6000d5a'
final_revision: 'd6fa8f3071837ee75e7f60d0df4f1ce026b62764'
---

<intent-contract>

## Intent

**Problem:** ArenaScene's sim-rate sampling math lives inline in `update()` and the render→sim decoupling wiring (the render callback must never step the world directly) plus the Boot→Preload→…→Arena scene chain have zero automated coverage. A regression that called `this.world.fixedUpdate(delta)` straight from `update()`, or broke the Boot→Preload→Title handoff, would pass the entire existing suite (tests never import Phaser-coupled modules).

**Approach:** Extract the once-per-second sim-tick sampling into a Phaser-free `SimRateSampler` primitive (a stateful accumulator like `FixedTimestep`) and unit-test it headlessly; rewire ArenaScene's DEV readout to use it. Add a headless source-assertion smoke test (`readFileSync`, the established `buildConfig.test.js` pattern, since Phaser cannot be imported in the node test env) that pins the scene chain and the render→sim decoupling wiring.

## Boundaries & Constraints

**Always:**
- `SimRateSampler` is Phaser-free (imports nothing from `phaser`) and reproduces the current sampling math exactly: accumulate render delta; when the accumulator reaches the window, `ticksPerSec = (ticksNow − ticksAtLastSample) × 1000 / accumulatedMs`, then latch `ticksAtLastSample = ticksNow` and zero the accumulator.
- The ArenaScene readout stays byte-identical in behavior and stays fully DEV-gated: every `_simRateSampler` reference lives inside an `import.meta.env.DEV` block so a production build (DEV statically false) never references it.
- The smoke test pins, via source text: the scene registration order in `main.js` (Boot→Preload→Title→Arena→Settings), the `BootScene`→`PreloadScene` and `PreloadScene`→`TitleScene` handoffs, that `main.js` forces WEBGL and does not fall back to `Phaser.AUTO`, and the render→sim decoupling in `ArenaScene.update` (the world is stepped only through `this.fixedTimestep.advance(...)`, exactly once, inside a `gameOver`-gated callback — never called directly from `update()`).
- `buildConfig.test.js` already pins the WEBGL / `Scale.FIT` / `CENTER_BOTH` positives (Story 5.5, NFR7); the new file complements it (scene chain, decoupling, and the not-AUTO negative) rather than re-asserting those positives.

**Block If:**
- (none — this is additive test/refactor work with a faithful behavior-preserving extraction; no unattended product decision is required.)

**Never:**
- Do not change gameplay, render output, the readout's displayed numbers, or the production bundle's behavior.
- Do not import `phaser` from any test (it throws `window is not defined` in the node env) — assert Phaser-coupled invariants against source text, not by importing the module.
- Do not add a config constant, edit `constants.js`, or broaden scope to other scenes.
- Do not weaken or delete the existing `buildConfig.test.js` assertions.

## I/O & Edge-Case Matrix

`SimRateSampler.update(deltaMs, ticks)` — window = 1000 ms, fresh sampler starts `ticksPerSec = 0`, `lastTicks = 0`, `accumMs = 0`:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Below window | Frames totaling `accumMs < 1000` | No sample fires; `ticksPerSec` stays at its prior value (0 on a fresh sampler); accumulator retains the running total | No error expected |
| Window crossed | Accumulated to `accumMs ≥ 1000` (e.g. 1000 ms over 60 frames, `ticks` went 0→60) | `ticksPerSec === 60`; `lastTicks` latches to current `ticks`; `accumMs` resets to 0 | No error expected |
| Divisor is actual accum, not the window | Single `update(1500, 90)` on a fresh sampler | `ticksPerSec === (90 × 1000) / 1500 === 60` (divides by the real accumulated 1500, not by 1000) | No error expected |
| Successive windows | Cross window twice; second window ticks advance by a different amount | Second `ticksPerSec` computed from the delta of ticks since the previous latch (not cumulative from 0) | No error expected |
| Steady state independent of frame count | Same ~1000 ms of ticks delivered as few big frames vs many small frames | Same `ticksPerSec` either way (rate reads render-FPS-independent) | No error expected |
| `reset()` | After sampling, call `reset()` | `accumMs`, `lastTicks`, and `ticksPerSec` all return to 0 | No error expected |
| Misconfigured window | `new SimRateSampler(0)` / `(-1)` / `(NaN)` | Throws `RangeError` (fail-fast at construction, mirroring `FixedTimestep`) | Constructor throws |

</intent-contract>

## Code Map

- `src/scenes/ArenaScene.js` -- owns the inline sampling (create() DEV block ~L520-524 init; update() DEV block ~L753-761 sampling; readout ~L787 reads `_ticksPerSec`) and the render→sim decoupling (update() ~L563-565: `this.fixedTimestep.advance(delta, (dt) => { if (!this.playerState.gameOver) this.world.fixedUpdate(dt); })`).
- `src/core/FixedTimestep.js` -- the sibling Phaser-free accumulator primitive to mirror in style (constructor fail-fast, `reset()`).
- `src/core/fixedTimestep.test.js` -- the test-style template for the new sampler unit test.
- `src/main.js` -- the Phaser.Game config: `type: Phaser.WEBGL`, `scale` FIT/CENTER_BOTH, and `scene: [BootScene, PreloadScene, TitleScene, ArenaScene, SettingsScene]`.
- `src/scenes/BootScene.js` -- `create()` starts `'PreloadScene'`.
- `src/scenes/PreloadScene.js` -- `create()` starts `'TitleScene'`.
- `src/build/buildConfig.test.js` -- existing source-assertion precedent; already pins WEBGL/FIT/CENTER_BOTH positives and the DEV-gating production-safety check (extend its identifier list with `_simRateSampler`).
- `src/systems/SimClockSystem.js` -- source of `simClock.ticks` fed into the sampler.

## Tasks & Acceptance

**Execution:**
- `src/core/SimRateSampler.js` (new) -- add a Phaser-free `SimRateSampler` class: `constructor(windowMs)` fail-fast on non-finite/≤0 (`RangeError`, like `FixedTimestep`); fields `windowMs`, `accumMs=0`, `lastTicks=0`, `ticksPerSec=0`; `update(deltaMs, ticks)` accumulates and, when `accumMs >= windowMs`, sets `ticksPerSec = (ticks - lastTicks) * 1000 / accumMs`, latches `lastTicks = ticks`, zeroes `accumMs`, and returns `ticksPerSec`; `reset()` zeroes all three fields. Faithful extraction — reproduce the original per-frame math exactly (no NaN/negative delta guard on `update`; Phaser guarantees a finite delta, matching the original inline code).
- `src/core/simRateSampler.test.js` (new) -- unit-test every row of the I/O & Edge-Case Matrix, mirroring `fixedTimestep.test.js` structure.
- `src/scenes/ArenaScene.js` -- add top-level `import { SimRateSampler } from '../core/SimRateSampler.js';`; in the create() DEV block replace `_lastSampleTicks`/`_sampleAccumMs`/`_ticksPerSec` with `this._simRateSampler = new SimRateSampler(1000);`; in the update() DEV block replace the inline sampling with `this._simRateSampler.update(delta, this.simClock.ticks);`; in the readout replace `this._ticksPerSec.toFixed(1)` with `this._simRateSampler.ticksPerSec.toFixed(1)`. Keep every `_simRateSampler` reference inside a DEV gate; leave the decoupling wiring unchanged.
- `src/scenes/renderIntegration.test.js` (new) -- headless source-text smoke test (`readFileSync` + `fileURLToPath`, like `buildConfig.test.js`, with a top comment noting Phaser can't be imported in the node env). Assert: (1) `main.js` registers scenes in order Boot→Preload→Title→Arena→Settings; (2) `main.js` forces `type: Phaser.WEBGL` and contains no `Phaser.AUTO` (the not-AUTO negative buildConfig lacks); (3) `BootScene.js` source starts `'PreloadScene'` and `PreloadScene.js` source starts `'TitleScene'`; (4) `ArenaScene.js` update advances the sim only through `this.fixedTimestep.advance(delta,`, that `this.world.fixedUpdate(` appears exactly once in the file, and that the sole occurrence is the `if (!this.playerState.gameOver) this.world.fixedUpdate(dt);` form (render callback never steps the world directly and never on game over).
- `src/build/buildConfig.test.js` -- add `_simRateSampler` to the stripped-DEV-block production-safety identifier list so the new field is guaranteed DEV-gated.

**Acceptance Criteria:**
- Given a fresh `SimRateSampler(1000)`, when it is driven with the same total ticks over 1000 ms as either a few large deltas or many small deltas, then it reports the same `ticksPerSec` both ways (sim rate reads independent of render frame count).
- Given `ArenaScene.js`, when a regression changes `update()` to call `this.world.fixedUpdate(delta)` directly (outside the `advance` callback) or removes the `gameOver` gate, then `renderIntegration.test.js` fails.
- Given `BootScene.js`/`PreloadScene.js`/`main.js`, when the Boot→Preload→Title chain or the WEBGL renderer (flip to `Phaser.AUTO`) or the scene registration order regresses, then `renderIntegration.test.js` fails.
- Given a production build (`import.meta.env.DEV` statically false), when the DEV blocks are stripped, then no `_simRateSampler` (or legacy `_ticksPerSec`/`_sampleAccumMs`/`_lastSampleTicks`) reference survives — `buildConfig.test.js` proves it — so the shipped bundle never touches the sampler.
- Given the full suite, when `npx vitest run` executes, then all tests pass (new and pre-existing).

## Spec Change Log

(none — no bad_spec loopback occurred.)

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` Sampler wiring in `ArenaScene` was unpinned — an arg-swap (`update(ticks, delta)`) or a dropped per-frame call would ship a broken DEV readout with the whole suite green. Added a source-text assertion to `renderIntegration.test.js` pinning `new SimRateSampler(1000)` and `this._simRateSampler.update(delta, this.simClock.ticks)` (delta before ticks).

Rejected (11): NaN/Infinity-delta permanently poisons the accumulator (unreachable — Phaser guarantees a finite delta; spec-mandated faithful extraction, documented in the class); negative rate on non-monotonic ticks (unreachable — `simClock.ticks` is monotonic and the sampler is rebuilt per scene, never reused across a tick reset); `reset()` dead + untested resume (spec-mandated API matching the `FixedTimestep` sibling; zeroing contract is tested; no production caller); `update()` returning the value while also exposing `.ticksPerSec` (harmless dual-read, mirrors `FixedTimestep.advance`); constructor lacks an explicit `Infinity` case (same `Number.isFinite` branch already covered by the `NaN` test; matches the matrix row as written); readout skews low during game-over/hit-stop freeze (faithful carry-over of the original inline behavior; documented); source-text (not behavioral) decoupling assertion + alias false-pass (source text is the only feasible headless surface — `phaser` throws on import — matching the `buildConfig.test.js` convention); `not.toContain('Phaser.AUTO')` / whole-file scan comment brittleness (low-probability future false-failure in a 35-line file; the strict form is an acceptable guard); exact-5-scene roster pin (a defensible config-invariant pin — a new scene should force a deliberate test update); committed prod bundle-cleanliness test absent (crash-safety IS committed-tested via the DEV-gated field; bundle cleanliness is verified by `vite build` + dist grep at verification; a committed bundle-diff test is scope expansion for a DEV-only diagnostic, and the reviewer's proposed `SimRateSampler`-in-strip-list fix is invalid — the top-level import legitimately survives DEV-stripping); FIT/CENTER_BOTH pinned in `buildConfig.test.js` rather than the new file (a deliberate, documented no-duplication decision — the invariant stays pinned at suite level, so a scale-mode regression still fails the suite).

## Design Notes

**Faithful extraction — why no delta guard.** `FixedTimestep` rejects NaN/negative deltas because a bad delta would permanently freeze the sim accumulator. The sampler is a DEV-only *diagnostic* readout, and the original inline code applied no such guard. The extraction preserves that exactly (only the constructor fails fast, which never triggers in real use since it's constructed with the literal `1000`) so the readout stays byte-identical — this is a behavior-preserving refactor, not a behavior change.

**Divisor is the real accumulator, not the window.** The original divides by `this._sampleAccumMs` (which is `≥ 1000` when the sample fires, not exactly 1000). `SimRateSampler.update` must divide by `accumMs`, not `windowMs`, to stay faithful — the matrix's "divisor is actual accum" row pins this.

**Why source-text assertions.** `phaser` throws `window is not defined` on import in the node test env (verified), so `main.js`/`BootScene`/`PreloadScene`/`ArenaScene` cannot be imported headlessly. `buildConfig.test.js` already establishes `readFileSync`-based source assertion as this repo's convention for Phaser-coupled invariants; the new smoke test follows it. The `world.fixedUpdate` count-equals-1 check is the load-bearing decoupling guard: it fails if a second, direct `world.fixedUpdate` call is added to `update()`.

## Verification

**Commands:**
- `npx vitest run src/core/simRateSampler.test.js` -- expected: the sampler unit suite passes (all matrix rows).
- `npx vitest run src/scenes/renderIntegration.test.js src/build/buildConfig.test.js` -- expected: the smoke test and the (updated) build-config test pass.
- `npx vitest run` -- expected: the entire suite passes with no regressions.
- `npx vite build` -- expected: the production build succeeds (confirms the top-level `SimRateSampler` import tree-shakes cleanly and nothing references the DEV-only field outside a gate).

## Auto Run Result

Status: done

**Summary.** Closed DW-2's coverage gap. Extracted ArenaScene's previously-inline, DEV-only sim-rate sampling math into a Phaser-free `SimRateSampler` primitive (a `FixedTimestep` sibling) with a headless unit suite, rewired the DEV readout to use it, and added a headless source-text smoke test that pins the scene chain and the render→sim decoupling wiring (the invariants that previously lived only as config literals / human-read canvas text). WEBGL / FIT / CENTER_BOTH stay pinned by the pre-existing `buildConfig.test.js`; the new file adds the not-AUTO negative it lacked.

**Files changed.**
- `src/core/SimRateSampler.js` (new) — Phaser-free once-per-window sim-tick rate meter; constructor fail-fast (`RangeError`) on non-finite/≤0 window; `update(deltaMs, ticks)` divides by the real accumulator; `reset()`.
- `src/core/simRateSampler.test.js` (new) — 7 unit tests, one per I/O-matrix row.
- `src/scenes/ArenaScene.js` — inline sampling replaced by the sampler; all references stay DEV-gated; decoupling wiring untouched.
- `src/scenes/renderIntegration.test.js` (new) — source-text smoke test: scene order, WEBGL/not-AUTO, Boot→Preload→Title handoffs, render→sim decoupling guard, and (review patch) sampler wiring + arg order.
- `src/build/buildConfig.test.js` — added `_simRateSampler` to the DEV-strip production-safety identifier list.

**Review findings.** 1 patch applied (low — pinned the sampler wiring so an arg-swap/dropped-call fails the suite). 0 deferred. 11 rejected (unreachable latent contracts, spec-mandated faithful-extraction choices, source-text brittleness inherent to the only feasible headless approach, and the documented FIT/CENTER_BOTH no-duplication decision). No intent gaps, no bad_spec loopbacks. See the Review Triage Log for the full breakdown.

**Follow-up review recommended:** false (patched: 0 high, 0 medium, 1 low; score `3×0 + 1×1 = 1` < 5).

**Verification.**
- `npx vitest run` — 45 files, 654 tests, all pass.
- `npx vitest run src/core/simRateSampler.test.js` — 7 pass (all matrix rows).
- `npx vitest run src/scenes/renderIntegration.test.js src/build/buildConfig.test.js` — 16 pass (8 + 8).
- `npx vite build` — succeeds; dist grep confirms no `SimRateSampler`/`_simRateSampler`/`ticksPerSec` in the production bundle (sampler tree-shaken out).

**Residual risks.** The scene-chain/decoupling/renderer invariants are pinned by source-text assertion (Phaser can't be imported headlessly — verified `window is not defined`), matching the `buildConfig.test.js` convention; these catch wiring/config regressions, not live runtime behavior. Low, and inherent to the environment.
