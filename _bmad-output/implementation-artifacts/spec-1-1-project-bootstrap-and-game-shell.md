---
title: 'Story 1.1 — Project Bootstrap and Game Shell'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '4dbed2be0469d3775353a4e2254a96f5d9033a4a'
final_revision: 'be41773363ec306e7438373ba2b102c2dd351cbf'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The repository is empty — there is no runnable game, no engine foundation, and no shared primitives (fixed-timestep loop, object pool, entity/system structure) that every later Epic 1 story depends on.

**Approach:** Stand up a production-grade Phaser 3 (WebGL) + Vite project whose Boot → Preload → Arena scene chain renders a bounded arena on a WebGL canvas, driven by a fixed-timestep simulation decoupled from render, on a responsively aspect-scaled canvas — plus reusable, unit-tested `Pool` and `FixedTimestep` utilities and a lightweight `World`/`System` structure that later entities plug into.

## Boundaries & Constraints

**Always:**
- Renderer is Phaser 3 forced to WebGL (`Phaser.WEBGL`), not Canvas/AUTO.
- Simulation advances only through a fixed-timestep accumulator; per-tick logic receives a constant dt independent of render frame rate. The Phaser render callback never runs simulation logic directly.
- Canvas uses Phaser Scale `FIT` + `CENTER_BOTH` against a fixed logical arena size so the arena aspect ratio is preserved at any window size.
- All tunable values (arena width/height, fixed step ms, colors) live in one central constants module — no magic numbers inline.
- Pure logic (`Pool`, `FixedTimestep`, `World`, `System`, constants) must not import Phaser, so it is unit-testable headlessly under Vitest.
- `Pool` acquire/release reuse instances with zero per-frame allocation on the reuse path (no rest/spread in the hot path).

**Block If:**
- A required tool is unavailable such that `npm install` / `npm run build` cannot run at all (e.g. no network for the initial dependency install). HALT with the missing capability as blocking condition.

**Never:**
- Do not implement gameplay beyond the shell: no ship, input, firing, enemies, collision, scoring, HUD score, persistence, or aesthetic/bloom/particles — those are later stories.
- Do not add speculative abstractions (component registries, ECS libraries, an `Entity` class) beyond the minimal `World`/`System` needed as a foundation.
- Do not commit `node_modules/` or `dist/` (already git-ignored).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fixed step, one frame's worth | `advance(stepMs, fn)` | `fn` called exactly once with `stepMs`; returns 1; accumulator ~0 | No error expected |
| Fixed step, slow frame (backlog) | `advance(2.5 * stepMs, fn)` | `fn` called twice; remainder `0.5*stepMs` retained for next frame | No error expected |
| Fixed step, fast frame (sub-step) | `advance(0.4 * stepMs, fn)` | `fn` not called; returns 0; accumulator retains the partial delta | No error expected |
| Spiral-of-death guard | huge delta exceeding `maxSubSteps` | steps capped at `maxSubSteps`; leftover backlog dropped, not accumulated | No error expected |
| Pool reuse | acquire, release, acquire again | second acquire returns the same recycled instance; no new allocation | No error expected |
| Pool grows on demand | acquire with empty free list | factory creates a new instance; `activeCount` increments | No error expected |

</intent-contract>

## Code Map

- `package.json` -- deps (`phaser`), devDeps (`vite`, `vitest`), scripts `dev`/`build`/`preview`/`test`.
- `vite.config.js` -- Vite + Vitest (node/jsdom-free unit) config.
- `index.html` -- page hosting the game mount; loads `src/main.js` as a module.
- `src/config/constants.js` -- centralized tunable constants: `ARENA_WIDTH`, `ARENA_HEIGHT`, `FIXED_STEP_MS`, `MAX_SUB_STEPS`, background/border colors.
- `src/main.js` -- builds the Phaser.Game config (WEBGL, Scale.FIT/CENTER_BOTH from constants) and the `[BootScene, PreloadScene, ArenaScene]` sequence.
- `src/scenes/BootScene.js` -- minimal init; starts PreloadScene.
- `src/scenes/PreloadScene.js` -- asset-load stage (no real assets yet); starts ArenaScene.
- `src/scenes/ArenaScene.js` -- draws the bounded arena border; owns a `World` + `FixedTimestep`; drives `world.fixedUpdate(dt)` from Phaser `update(time, delta)`; shows a small debug readout of render FPS vs sim ticks/sec.
- `src/core/Pool.js` -- generic object pool (Phaser-free).
- `src/core/FixedTimestep.js` -- accumulator advancing a callback at a constant dt (Phaser-free).
- `src/core/World.js` -- holds `entities[]` + `systems[]`; `fixedUpdate(dt)` iterates systems (Phaser-free).
- `src/core/System.js` -- base class with `fixedUpdate(dt, world)` hook (Phaser-free).
- `src/systems/SimClockSystem.js` -- foundational example system; counts sim ticks and accumulated sim time so the fixed-timestep pipeline has a real, observable job.
- `src/core/pool.test.js` -- unit tests for `Pool`.
- `src/core/fixedTimestep.test.js` -- unit tests for `FixedTimestep`.
- `README.md` -- fresh-checkout run instructions (`npm install`, `npm run dev`).

## Tasks & Acceptance

**Execution:**
- `package.json` -- create with Phaser dependency, Vite/Vitest dev deps, and `dev`/`build`/`preview`/`test` scripts -- makes the project installable and buildable from a fresh checkout.
- `vite.config.js` -- configure Vite build and Vitest test runner -- enables `npm run build` and `npm test`.
- `index.html` + `src/main.js` -- mount Phaser as WEBGL with Scale.FIT/CENTER_BOTH and the three-scene sequence sourced from constants -- satisfies WebGL canvas, scene wiring, and responsive aspect-preserving scaling.
- `src/config/constants.js` -- centralize arena size, fixed step, sub-step cap, and colors -- keeps feel/config tunable with no inline magic numbers.
- `src/scenes/BootScene.js`, `src/scenes/PreloadScene.js`, `src/scenes/ArenaScene.js` -- implement the Boot→Preload→Arena chain; ArenaScene draws the arena border and drives the fixed-timestep world -- delivers the visible bounded arena and decoupled simulation.
- `src/core/FixedTimestep.js` -- implement the accumulator with `advance(deltaMs, fn)`, `alpha`, and `maxSubSteps` spiral guard per the I/O matrix -- the decoupling primitive.
- `src/core/Pool.js` -- implement zero-alloc acquire/release with lazy growth and `activeCount`/`freeCount` per the I/O matrix -- the pooling primitive for later entities.
- `src/core/World.js` + `src/core/System.js` + `src/systems/SimClockSystem.js` -- implement the minimal entity/system foundation and wire SimClockSystem into ArenaScene's world -- the extensible structure AC3 requires, kept non-dead by giving the pipeline a real tick-counting job.
- `src/core/pool.test.js` + `src/core/fixedTimestep.test.js` -- unit-test every I/O & edge-case matrix row -- proves the primitives behave correctly headlessly.
- `README.md` -- document install/run/build/test commands.

**Acceptance Criteria:**
- Given a fresh checkout with dependencies installed, when `npm run build` runs, then it completes with exit code 0 and emits a static bundle under `dist/`.
- Given the dev server (`npm run dev`), when the page loads, then a WebGL canvas shows a bounded rectangular arena border centered in the window.
- Given the running game, when the window is resized, then the canvas scales to fit while preserving the arena's aspect ratio (letterboxed, not stretched).
- Given the running game, when frames render at a varying rate, then the simulation tick count advances at the fixed rate defined by `FIXED_STEP_MS` (observable in the debug readout as steady sim ticks/sec independent of render FPS).
- Given the codebase, when a reviewer inspects it, then Phaser-free `Pool`, `FixedTimestep`, `World`, and `System` modules exist with `Pool` and `FixedTimestep` covered by passing unit tests, and ArenaScene drives its systems through the fixed-timestep loop.
- Given `npm test`, when it runs, then all unit tests pass with exit code 0.

## Spec Change Log

_No entries — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 4, low 7)
- defer: 0
- reject: 3
- addressed_findings:
  - `[medium]` `[patch]` FixedTimestep constructor validated nothing — added RangeError guards for `stepMs > 0` and integer `maxSubSteps >= 1` to prevent a silently frozen simulation on misconfiguration.
  - `[medium]` `[patch]` `FixedTimestep.advance` corrupted the accumulator on a NaN/negative delta (permanent freeze) — added a `!Number.isFinite(deltaMs) || deltaMs < 0` early-return guard, with tests.
  - `[medium]` `[patch]` Spiral guard discarded a legitimate sub-step remainder when the cap was hit exactly — now only drops backlog when `accumulator >= stepMs`; `alpha` clamps its numerator. Added a remainder-preservation test.
  - `[medium]` `[patch]` `World`/`System`/`SimClockSystem` backbone and the composed accumulator→world→system pipeline had zero tests — added `src/core/world.test.js` (dispatch order, dt/world passthrough, add/removeEntity, addSystem-throws, end-to-end SimClock incl. a spiral-cap frame).
  - `[low]` `[patch]` `Pool.acquire` tracked a nullish factory result as active — added a TypeError guard, with a test.
  - `[low]` `[patch]` `Pool` had no teardown path (idle stack grew unbounded) — added `clear()` with a test.
  - `[low]` `[patch]` `Pool.forEachActive` invited release-during-iteration Set corruption — added a docstring warning (behavior unchanged, zero-alloc preserved).
  - `[low]` `[patch]` `World.addSystem` accepted anything — added a TypeError when the arg lacks `fixedUpdate`, failing fast at the call site.
  - `[low]` `[patch]` Misleading `eslint-disable` directives referenced non-existent tooling — removed from `main.js` and `System.js`.
  - `[low]` `[patch]` `SimClockSystem.simTimeMs` was accumulated but never read — surfaced it in the ArenaScene debug readout.
  - `[low]` `[patch]` `package.json` lacked an `engines` field matching the README's Node floor — added `"engines": { "node": ">=18" }`.
  - `[reject]` Forcing `Phaser.WEBGL` without an AUTO/Canvas fallback or teardown — contradicts the intent-contract's `Always: Phaser.WEBGL` and the WebGL-desktop target; discarding the game instance is normal Phaser usage.
  - `[reject]` Debug readout dips after a stall / sampling window can exceed 1000ms — diagnostic-only text reflecting honest fixed-timestep behavior.
  - `[reject]` Production `FIXED_STEP_MS = 1000/60` float drift untested — negligible in double precision; integer `ticks` is the authoritative counter.

### 2026-07-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1
- reject: 12
- addressed_findings:
  - `[low]` `[patch]` README `npm test` row listed only "(`Pool`, timestep)" although `world.test.js` also runs — corrected to "(`Pool`, `FixedTimestep`, `World`)".
  - `[low]` `[patch]` `World.fixedUpdate` iterated `systems` by live index with no mutation-during-iteration warning (unlike the analogous `Pool.forEachActive`, which already carries one) — added a WARNING docstring that a system must not add/remove systems mid-tick; zero behavior change.
- deferred:
  - Render-integration surface (WEBGL enforcement, FIT/CENTER_BOTH letterboxing, scene chain, render→sim decoupling wiring) and the ArenaScene sim-rate sampling math have no automated coverage; recorded to `deferred-work.md` (three review layers converged; closing it adds a module beyond the story's captured intent, so the orchestrator owns it).
- rejected (noise / out-of-scope on the intent's authority / factually wrong):
  - Forcing `Phaser.WEBGL` without a Canvas/AUTO fallback — the intent's `Always` mandates WEBGL-forced (re-rejected from the prior pass).
  - README "sim rate holds steady … regardless of how fast frames render" — this is the standard fixed-timestep phrasing and mirrors AC4's own wording.
  - Spiral guard "zeroes the accumulator and discards the legitimate remainder" — factually wrong; the guard only zeroes when `steps === maxSubSteps && accumulator >= stepMs`, so a sub-step remainder survives (confirmed by the intent-alignment audit and the existing remainder-preservation test).
  - No `try/catch` isolation around the per-tick `fn` in `advance()` — swallowing exceptions in the sim loop is undesirable; speculative (no system throws).
  - Sampling window can exceed 1000 ms (`_sampleAccumMs = 0` vs `-= 1000`) — already rejected last pass as honest diagnostic-only behavior.
  - `Math.round(actualFps)` / `_sampleAccumMs += delta` could show `NaN` — Phaser does not emit `NaN`/negative frame deltas; debug-readout-only; folded into the deferred sampler item if ever acted on.
  - Add a Pool capacity ceiling / leak diagnostic — speculative feature; intent `Never: no speculative abstractions`.
  - `index.html` flex centering redundant with `CENTER_BOTH` — harmless; both center.
  - Test filename casing (`pool.test.js` vs `Pool.js`) — cosmetic convention; imports use exact paths.
  - `Pool.acquire` should reject an already-active factory result — requires a misbehaving factory; speculative caller misuse.
  - `Pool.forEachActive` mutation hazard is documented not enforced — already carries the WARNING docstring added last pass; working as intended.

## Design Notes

Fixed-timestep pattern (decouples sim from render, guards the spiral of death):

```js
advance(deltaMs, fn) {
  this.accumulator += deltaMs;
  let steps = 0;
  while (this.accumulator >= this.stepMs && steps < this.maxSubSteps) {
    fn(this.stepMs);
    this.accumulator -= this.stepMs;
    steps++;
  }
  if (steps === this.maxSubSteps) this.accumulator = 0; // drop backlog
  return steps;
}
```

`Pool` keeps a `free` stack and an `active` set; `acquire()` pops or lazily creates and returns the instance for the caller to initialize (no rest/spread, so the reuse path allocates nothing). ArenaScene calls `fixedTimestep.advance(delta, dt => world.fixedUpdate(dt))` inside Phaser's `update`; the debug readout compares `game.loop.actualFps` against SimClockSystem's ticks/sec to make the decoupling visible.

## Verification

**Commands:**
- `npm install` -- expected: dependencies install without error.
- `npm run build` -- expected: exit 0; `dist/` produced.
- `npm test` -- expected: exit 0; all `Pool` and `FixedTimestep` tests pass.

**Manual checks (if no CLI):**
- `npm run dev`, open the served URL: a centered WebGL canvas shows the bounded arena border; resizing the window letterboxes without stretching; the debug readout shows sim ticks/sec holding near `1000 / FIXED_STEP_MS` while render FPS may differ.


## Auto Run Result

Status: done

**Summary:** Follow-up review pass (`review_loop_iteration` reset to 0) on the completed Story 1.1 shell. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel against the diff since baseline `4dbed2b`. No intent_gap and no bad_spec — the intent-contract held. Two low-severity patches applied; one real cross-cutting gap deferred to the ledger; the remaining findings rejected as noise, out-of-scope on the intent's authority, or factually incorrect.

**Files changed this pass:**
- `README.md` — corrected the `npm test` scripts-table row from "(Pool, timestep)" to "(Pool, FixedTimestep, World)".
- `src/core/World.js` — added a mutation-during-iteration WARNING docstring to `fixedUpdate` (mirrors the existing `Pool.forEachActive` warning); zero behavior change.

**Review findings breakdown:** patch 2 (low 2) · defer 1 · reject 12 · intent_gap 0 · bad_spec 0.
- Patched: README test-list accuracy; World.fixedUpdate iteration warning.
- Deferred (→ `deferred-work.md`): render-integration surface (WEBGL/FIT/CENTER_BOTH/scene-chain/decoupling wiring) and ArenaScene sim-rate sampling math have no automated coverage — three review layers converged, but closing it adds a module beyond the story's captured intent.
- Rejected: WEBGL-no-fallback (intent mandates WEBGL); README "regardless of frame rate" (standard fixed-timestep phrasing); spiral-guard-discards-remainder (factually wrong — remainder is preserved); no try/catch around per-tick fn (speculative); sampling-window >1000ms (already rejected, honest diagnostic); NaN in readout (Phaser emits no NaN delta); Pool leak-diagnostic feature (speculative); index.html flex redundancy (harmless); test filename casing (cosmetic); Pool already-active factory guard (speculative misuse); forEachActive doc-not-enforced (already warned).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 2 → score = 3×0 + 1×2 = 2 (< 5, no high).

**Verification performed:**
- `npm test` → 24/24 pass (pool 8, fixedTimestep 11, world 5), exit 0.
- `npm run build` → exit 0; `dist/` bundle emitted (Phaser chunk-size warning is expected and out of scope).

**Residual risks / artifacts:**
- The deferred render-integration verification gap remains open (tracked in `deferred-work.md`) — a regression flipping the renderer to AUTO, breaking the scale mode, or bypassing the fixed-timestep in `ArenaScene.update` would not be caught by the current `src/core`-only suite.
- Residual working-tree artifacts left in place (not part of the reviewed code diff; orchestrator-owned): `sprint-status.yaml` (modified), and untracked `deferred-work.md`, `epic-1-context.md`, and this spec file.
- `final_revision`: `be41773363ec306e7438373ba2b102c2dd351cbf`.
