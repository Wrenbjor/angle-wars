---
title: 'Performance Hardening and Web Build'
type: 'refactor'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false # follow-up pass: patched high 0, medium 0, low 2 → score 3×0 + 1×2 = 2 (<5)
context: []
warnings: [multiple-goals, oversized]
baseline_revision: 'ef9beefe83f9f2eeb29cd32abf0e154556190249'
final_revision: '6b54aa16f0f76126be95437b26b94074db96a595'
---

<intent-contract>

## Intent

**Problem:** Epic 5's release story must prove the assembled game is *deployable and holds framerate under peak load* (NFR1/NFR2/NFR6/NFR7). Two facets remain: (1) the pooling/zero-allocation discipline of the hot loop has never been audited across the fully-assembled game, and the one shared iteration seam every system funnels through — `Pool.forEachActive` — allocates a fresh `Set` iterator on every call (~15/frame+tick), plus a developer FPS/sim-ticks debug readout builds an array + strings every render frame and ships to players; (2) the production build works but bundles Phaser (~95% of bytes) into one monolithic app chunk that re-hashes on every app-code deploy, and the chunk-size warning fires on every build. The web build and responsive canvas scaling (Scale.FIT/CENTER_BOTH, relative `base`) are already correct and MUST NOT be regressed.

**Approach:** An audit-and-harden pass, not a rewrite. Kill the `Pool.forEachActive` per-call iterator allocation (use `Set.prototype.forEach`, no data-structure change). Complete the already-established collector-closure hoisting pattern in the Phaser-free per-tick systems (bullet/expired/hole collectors → stable instance-field callbacks, mirroring the existing `_collectEnemy`). Gate the developer debug readout behind `import.meta.env.DEV` so it is dead-code-eliminated from production and off the per-frame path. Lock in NFR2 by confirming every high-churn pool has the existing steady-state no-growth test. For the web build, split Phaser into its own content-hashed vendor chunk for repeat-load caching and set a deliberate chunk-size warning limit. NFR1's 60-FPS-on-hardware target stays a documented manual measurement (the automatable proxy is the O(1)-in-entity-count allocation audit).

## Boundaries & Constraints

**Always:**
- `Pool.forEachActive(fn)` must visit exactly the currently-active instances (same set, same one-arg call) as today, but allocate no per-call iterator: implement via `this._active.forEach(fn)`. The `_active` `Set` and all release/acquire semantics stay byte-identical. The existing WARNING (fn must not release the visited instance) still holds.
- Hoist each trivial *collector* callback (`FiringSystem` expired-bullet collect; `CollisionSystem` bullet collect; `BlackHoleSystem` hole collect and bullet collect) to a stable instance-field arrow created once in the constructor, exactly like the existing `CollisionSystem._collectEnemy` / `_currentPool` precedent, so no fresh closure is allocated per tick. Behavior (which instances are pushed to which scratch array) stays identical.
- Gate the ArenaScene developer debug readout — both its creation (`this.debugText = this.add.text(...)`, the `_sampleAccumMs`/`_ticksPerSec` sampling, `setScrollFactor`) and its per-frame `setText` array/string build — behind `import.meta.env.DEV`, so a production `vite build` statically eliminates it. The gameplay HUD (`SCORE/MULT/BOMBS/LIVES/HIGH`) and the game-over overlay are gameplay, NOT debug — leave them exactly as-is.
- Every high-churn pool (bullet, seeker, green square, pinwheel, snake segment, black hole, particle) must have a steady-state no-growth test asserting `activeCount + freeCount` never exceeds prewarm/steady capacity across ≥500 fixed steps (the pattern already in `enemySystem.test.js`). Add the test only where one is missing; do not duplicate existing coverage.
- `vite.config.js`: add `build.rollupOptions.output.manualChunks` mapping `phaser` to its own chunk; set `build.chunkSizeWarningLimit` to a deliberate value (≥1600) above the split app chunk. Keep `base: './'`, `build.target: 'es2022'`, and the node-env test block unchanged.
- Keep `src/main.js` Phaser Scale config (`FIT` + `CENTER_BOTH`, `ARENA_WIDTH`×`ARENA_HEIGHT`) and the WEBGL renderer exactly as-is (NFR7 already satisfied) — the config-invariant test asserts they stay.

**Block If:**
- (none anticipated — this is additive hardening + an isolated build-config change over an already-shippable build; no ambiguous decision requires a human.)

**Never:**
- Do NOT change `Pool`'s data structures (no Set→array swap, no index map), any pool's prewarm/capacity, or any acquire/release semantics. The iterator fix is the ONLY change to `Pool.forEachActive`.
- Do NOT touch the correctness-critical *mover* closures (EnemySystem homing, GreenSquare/Pinwheel wander/integration) — they capture per-tick `dt` and carry real regression risk for a single fixed arrow/tick that does not scale with entity count. Leave them; document as bounded residual.
- Do NOT touch the Story 5.4 input layer (`PlayerInputSampler`, `inputMath`, `inputMethod`, `InputState`). Its per-frame scratch objects are intrinsic to that story's just-reviewed pure-seam design, are O(1) (not high-churn/entity-scaling), and are documented as accepted residual.
- Do NOT build an `ArenaScene`/`World` Phaser integration harness. The scene render/wiring surface is the project's standing manual-verification boundary (deferred 15+ times as orchestrator-owned); the ArenaScene render-draw closures and debug-gating stay manual-verified. Re-log, do not close.
- Do NOT alter gameplay, rendering output, scenes, scoring, spawning, audio, or any system's behavior. No visual or feel change is in scope — this is invisible hardening.

## I/O & Edge-Case Matrix

`Pool.forEachActive(fn)` (Phaser-free, `src/core/Pool.js`):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Visit all active | 3 acquired, 1 released | `fn` called for exactly the 2 active instances | — |
| Empty pool | nothing acquired | `fn` never called (no-op) | — |
| Repeated iteration | call `forEachActive` N times over a stable active set | each call visits the same active set; `freeCount`/`activeCount` unchanged across calls (no growth) | — |

Steady-state pooling invariant (per high-churn system, e.g. `FiringSystem`/`ParticleSystem`):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sustained churn | spawn to prewarm, then ≥500 fixed steps of acquire/release | `activeCount + freeCount` never exceeds the prewarmed/steady capacity (zero factory growth in steady state) | — |

`vite.config.js` invariants (imported directly in a node-env test):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Vendor split | read resolved config | `manualChunks` routes `phaser` to its own chunk; `chunkSizeWarningLimit ≥ 1600` | — |
| Static/subpath hosting | read resolved config | `base === './'`, `build.target === 'es2022'` (unchanged) | — |

</intent-contract>

## Code Map

- `src/core/Pool.js` -- `forEachActive(fn)` at ~line 78 uses `for (const obj of this._active)` (allocates a Set iterator per call). EDIT: `this._active.forEach(fn)`. Everything else UNCHANGED.
- `src/core/pool.test.js` -- existing Pool unit tests. ADD: `forEachActive` visits-active / empty-no-op / repeated-call-no-growth cases (I/O matrix).
- `src/systems/FiringSystem.js` -- `fixedUpdate` line ~84 `pool.forEachActive((b) => {...})` collects expired bullets into `this._expired`. EDIT: hoist to a constructor instance-field collector.
- `src/systems/CollisionSystem.js` -- line ~108 `this.bulletPool.forEachActive((b) => bullets.push(b))`; `_collectEnemy`/`_currentPool` (lines ~53-57) are the hoist precedent. EDIT: hoist the bullet collector to `this._collectBullet`.
- `src/systems/BlackHoleSystem.js` -- line ~141 `holePool.forEachActive((h) => holes.push(h))` and ~150 `bulletPool.forEachActive((b) => bullets.push(b))`. EDIT: hoist both to instance-field collectors.
- `src/scenes/ArenaScene.js` -- debug readout: `create()` builds `this.debugText`/sampling fields (~lines 624-634, 801-802); `update()` samples ticks/sec (~1028-1035) and `setText`s the 4-line array (~1054-1062). EDIT: gate all of it behind `import.meta.env.DEV`. HUD (`hudText`, ~1040) + game-over overlay UNCHANGED. The 7 render draw `forEachActive` callbacks (bullets/seekers/green/pinwheel/snake/hole/particles) stay as-is (manual-verified render boundary; documented residual).
- `vite.config.js` -- ADD `build.rollupOptions.output.manualChunks: { phaser: ['phaser'] }` + `build.chunkSizeWarningLimit`. `base`/`target`/`test` UNCHANGED.
- `src/main.js` -- Phaser `scale` (FIT/CENTER_BOTH) + WEBGL. Reference only (asserted, not edited).
- `src/build/buildConfig.test.js` -- NEW node-env test importing `vite.config.js` (and `src/main.js` scale constants where feasible) asserting the build/scaling invariants.
- `enemySystem.test.js` -- existing NFR2 no-growth precedent (`does not grow the pool over steady-state homing steps`, 500 steps). Reference pattern for the audit-gap tests.

## Tasks & Acceptance

**Execution:**
- `src/core/Pool.js` -- EDIT `forEachActive`: replace `for (const obj of this._active) fn(obj)` with `this._active.forEach(fn)`. Update the method comment to note the reused, zero-iterator-allocation iteration. No other change.
- `src/core/pool.test.js` -- ADD the `forEachActive` I/O-matrix cases: visits exactly the active instances after a release; no-op on an empty pool; repeated calls over a stable active set leave `freeCount`/`activeCount` unchanged.
- `src/systems/FiringSystem.js` -- Hoist the expired-bullet collector to a constructor instance-field arrow (e.g. `this._collectExpired = (b) => { b.x += ...; if (isOutsideArena(...)) this._expired.push(b); }`, stashing any per-tick locals it needs — `dtSec` — on `this` at the top of `fixedUpdate`, mirroring `CollisionSystem._currentPool`). Pass the field to `forEachActive`. Behavior identical.
- `src/systems/CollisionSystem.js` -- Hoist the bullet collector to `this._collectBullet = (b) => this._bullets.push(b)` in the constructor; pass it to `forEachActive`. (`_collectEnemy` already hoisted — match it.)
- `src/systems/BlackHoleSystem.js` -- Hoist the hole collector (`this._collectHole = (h) => this._holes.push(h)`) and the bullet collector (`this._collectBullet = (b) => this._bullets.push(b)`) to constructor instance-field arrows; pass them to the respective `forEachActive` calls.
- `src/scenes/ArenaScene.js` -- Gate the developer debug readout behind `import.meta.env.DEV`: guard its creation in `create()` and its sampling + `setText` in `update()` so a production build eliminates it. Leave the gameplay HUD and game-over overlay untouched.
- `vite.config.js` -- Add `build.rollupOptions.output.manualChunks: { phaser: ['phaser'] }` and `build.chunkSizeWarningLimit: 1600`. Keep `base: './'`, `build.target: 'es2022'`, `outDir: 'dist'`, and the `test` block unchanged.
- `src/build/buildConfig.test.js` -- NEW node-env vitest importing the default export of `../../vite.config.js`: assert `base === './'`, `build.target === 'es2022'`, `build.rollupOptions.output.manualChunks.phaser` includes `'phaser'`, and `build.chunkSizeWarningLimit >= 1600`.
- Steady-state no-growth audit tests -- For each high-churn pool lacking one (bullet/`FiringSystem`, particle/`ParticleSystem`, green square, pinwheel, snake segment, black hole), ADD (in the system's existing `*.test.js`) a `does not grow the pool over ≥500 steady-state steps (NFR2)` case mirroring `enemySystem.test.js`. If a pool already has equivalent coverage, note it and skip — do not duplicate.

**Acceptance Criteria:**
- Given a `Pool` with instances acquired and some released, when `forEachActive(fn)` is called, then `fn` is invoked once for exactly each active instance and never for a released or never-acquired one, and repeated calls over a stable active set leave `freeCount`/`activeCount` unchanged. (NFR2)
- Given any high-churn pool (bullets, seekers, green squares, pinwheels, snake segments, black holes, particles), when its system runs ≥500 steady-state fixed steps after reaching prewarm, then `activeCount + freeCount` never exceeds the prewarmed/steady capacity — zero per-frame object allocation (the factory does not fire in steady state). (NFR2)
- Given the Phaser-free per-tick systems (`FiringSystem`, `CollisionSystem`, `BlackHoleSystem`), when a fixed step runs, then their pool-collector callbacks are stable hoisted instance-field references (asserted identical across ticks) and the collected/scored/released results are unchanged from before. (NFR2)
- Given a production `vite build`, when it runs, then it emits a static bundle to `dist/` (an `index.html` referencing content-hashed assets via **relative** `./assets/...` paths, no server dependency) with Phaser in its own content-hashed vendor chunk separate from the app chunk, and the build completes without the chunk-size warning. (NFR6)
- Given the resolved `vite.config.js` and `src/main.js`, when the build-config test runs, then `base === './'`, `build.target === 'es2022'`, the Phaser `manualChunks` entry is present, and the Phaser Scale config remains `FIT` + `CENTER_BOTH` at the fixed arena size (responsive, aspect-preserving canvas). (NFR6, NFR7)
- Given a production build served from a static host, when opened in a modern desktop WebGL browser and the window is resized, then the canvas scales to fit while preserving the 16:9 arena aspect (letterboxed, centered), and no developer FPS/sim-ticks debug readout is visible. (NFR7) — manual verification.
- Given a peak-load late game (max enemies, thousands of particles, bombs detonating, bloom + grid warp simultaneously), when played on mid-range hardware, then it sustains 60 FPS. (NFR1) — manual measurement; the automatable proxy is the O(1)-in-entity-count pooling audit above.

## Spec Change Log

_No bad_spec loopbacks — spec unchanged through review (0 intent_gap, 0 bad_spec). All review findings resolved as in-diff patches, one deferral, or rejections._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The DEV-gating this change introduced (debug readout behind `import.meta.env.DEV`) had no test pinning it: a future un-gated `this.debugText.setText(...)` would crash only in a production `vite build` (vitest runs DEV=true; no test constructs `ArenaScene`). Added a `buildConfig.test.js` guard that strips `if (import.meta.env.DEV){...}` blocks (balanced-brace) from the `ArenaScene` source and asserts no `debugText`/`_ticksPerSec`/`_sampleAccumMs`/`_lastSampleTicks` reference remains outside a gate (and that a gate marker is present so the strip is exercised).
  - `[low]` `[patch]` `Pool.forEachActive` silently widened its callback arity by delegating to `Set.prototype.forEach` (`(value,value,set)` vs the old single arg) — a latent footgun on the one shared seam. Documented the widened contract in JSDoc (read only the first param; do not pass a variadic fn like `Array.push`). Did NOT wrap the call, which would reintroduce the exact per-call closure allocation this change removed.
  - `[low]` `[patch]` The spec AC promised the hoisted collectors are "asserted identical across ticks" but no test checked it. Added reference-stability assertions for `_collectBullet` (collision), `_collectExpired` (firing), and `_collectHole`/`_collectBullet` (black hole) across a `fixedUpdate`.
  - `[low]` `[patch]` The particle no-growth test's fixed 50-step warm-up could falsely fail on a future particle-lifetime/cap re-tune (snapshotting `capacity` mid-growth). Replaced with a loop-until-stable warm-up (total unchanged for 3 consecutive steps, capped at 2000) before snapshotting; kept the saturation sanity checks.
- deferred: 1 — the built-artifact/runtime verification for this story's ACs (NFR1 60-FPS on hardware; NFR7 live canvas resize/letterbox; a `dist` smoke test asserting relative asset paths + the emitted phaser chunk + tree-shaken debug strings) remains on the project's standing manual-verification boundary — no automated test constructs `ArenaScene` or runs a build. Logged to the deferred-work ledger.
- rejected (9): the "most frequent allocation" doc wording (grounded in this story's allocation audit — the shared seam's ~15/frame+tick was the highest-frequency site, not folklore); NFR7 Scale asserted via `main.js` source-text rather than runtime (spec-sanctioned "where feasible" proxy — `main.js` runs `new Phaser.Game` at load and can't be imported headlessly; the verification-gap layer explicitly accepted this boundary); global `chunkSizeWarningLimit: 1600` "masking" app-chunk bloat (idiomatic Vite — the limit is global by design, was never a hard guard, and Phaser legitimately needs the raised ceiling); the `>= 1600` assertion being a near-tautology (still guards against lowering it below the vendor chunk); FiringSystem `_dtSec` ordering dependency (safe today — the collector only runs inside `fixedUpdate` after the assignment; matches the existing `_currentPool` precedent and is comment-documented); `_collectExpired` not signaling its integrate side effect in its name (the behavior is documented at the definition); no runtime production debug toggle for QA (out of scope — the intent wants the readout hidden in production); `manualChunks` object-form coupling (correctly guards the current config shape); consolidating the three DEV gates into one helper (the new guard test mitigates the drift risk without churning the scene structure).

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` The ParticleSystem NFR2 no-growth test's loop-until-stable warm-up (`particleSystem.test.js`) could exit its 2000-step bound *without* reaching a 3-step stable streak (e.g. a future particle-lifetime/cap re-tune that never plateaus), snapshotting a still-rising `capacity`; the subsequent 500-step `toBe(capacity)` steady-state assertions would then compare against a moving baseline and let a slow leak pass. Added `expect(stableStreak).toBeGreaterThanOrEqual(3)` after the warm-up so a never-stabilizing pool fails loudly instead of silently.
  - `[low]` `[patch]` Two pre-existing high-churn no-growth tests fell short of the AC's explicit "≥500 fixed steps": the bullet/`FiringSystem` test ran 400 steps and the black-hole test ran 300. Bumped both to 500 so every named high-churn pool's steady-state test literally meets the ≥500 bar the story's own AC asserts. (Both remain green — extra steps only add identical steady-state assertions.)
- rejected (12): particle render-draw `forEachActive` callback still allocating per frame (the intent *explicitly* documents the 7 ArenaScene render-draw callbacks as the manual-verified render boundary and accepted residual — out of scope on the authority of the intent); `FiringSystem._dtSec` action-at-a-distance (safe today — set at the top of `fixedUpdate` before iteration, `Set.forEach` is synchronous/non-reentrant, mirrors the sanctioned `_currentPool` precedent, and the displacement is behaviorally tested; prior-rejected); `Pool.forEachActive` arity footgun having no test (the widened `(value,value,set)` contract is JSDoc-documented from the prior pass, all ~20 callers pass single-arg arrows, and an arity assertion would test `Set.forEach` engine behavior rather than our code); `stripDevBlocks` brace-counting being context-blind to braces-in-strings/comments (test-only helper; all current + idiomatic DEV blocks are brace-balanced; the "build and grep the bundle" alternative crosses the spec-sanctioned manual-verification boundary); `stripDevBlocks` exact-string marker brittle to reformatting (same helper; hypothetical future formatting change, low value); `manualChunks`/`chunkSizeWarningLimit` assertions being config-shape tautologies (verifying the real emitted chunk requires a build — the sanctioned manual boundary; prior-rejected); `main.js` Scale/renderer asserted via source-text regex (spec-sanctioned "where feasible" proxy — `main.js` runs `new Phaser.Game` at load and can't be imported headlessly; prior-rejected); `manualChunks` object-form no-op for a non-bare Phaser specifier (Phaser is imported as a bare specifier; the object form is idiomatic and correct for this import); `chunkSizeWarningLimit: 1600` magic threshold "masking" app-chunk bloat (idiomatic Vite — global by design, the intent explicitly set ≥1600, Phaser legitimately needs the ceiling; prior-rejected); four independent `import.meta.env.DEV` gates risking drift (verified consistent — all gates live within the same `create()`/`update()` methods and the `buildConfig` strip-test guards against a future un-gated reference; prior-rejected); collector reference-stability tests being near-tautological / not pinning the call site (they satisfy the AC as worded — "asserted identical across ticks" — and the production call sites were verified correct by inspection; a call-site spy is a marginal enhancement not worth churning three just-shipped tests); debug tree-shaking verified by source proxy rather than a built artifact (the documented manual-verification boundary, already on the deferred-work ledger from the prior pass — not re-logged).

## Design Notes

Why `Set.prototype.forEach` instead of a data-structure change: `for..of` over a `Set` calls `Set[Symbol.iterator]()`, materializing a `SetIterator` object per call (the ~15/frame+tick allocation the audit flagged as #1 by frequency). `Set.prototype.forEach` iterates the internal backing without a user-visible iterator object, so the fix is one line with zero change to release/acquire semantics or the `_active` `Set` itself — the lowest-risk way to remove the single most frequent hot-loop allocation, applied once at the seam every system shares.

Collector-closure hoisting completes a pattern the systems already started: `CollisionSystem` hoisted its *enemy* collector (`_collectEnemy`, stashing `_currentPool` per-loop) but left its *bullet* collector inline; `BlackHoleSystem`/`FiringSystem` similarly hoisted some scratch but not their per-tick `forEachActive` arrows. Hoisting the remaining trivial one-line-push collectors to constructor instance fields makes them stable references (no fresh arrow/tick) at near-zero risk, since the callback body is a pure push into reused scratch.

Scope boundary (bounded residual, intentionally NOT eliminated): after these fixes the hot loop's remaining per-frame allocations are a small **fixed, O(1)-in-entity-count** set — the correctness-critical mover closures (EnemySystem homing, GreenSquare/Pinwheel wander, which capture per-tick `dt`), the 7 ArenaScene render-draw callbacks (the manual-verified Phaser render boundary), and the Story 5.4 input-sampler scratch (`{gamepadActive,kbmActive}` + `inputMath` returns, intrinsic to that story's just-reviewed pure-seam design). None scale with entity count, so none threaten the peak-load 60-FPS target; eliminating them would churn freshly-shipped, correctness-critical, or deliberately-pure code for negligible GC benefit. The AC-relevant property — *all high-churn OBJECTS pooled with zero per-frame allocation* — is fully delivered and guarded.

Debug-gating via `import.meta.env.DEV`: Vite statically replaces this with `false` in `vite build`, so the whole debug-readout branch is tree-shaken from the production bundle (smaller bundle, no per-frame `setText`/array build, and players never see internal sim diagnostics). Dev (`vite`) still shows it.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `pool.test.js` `forEachActive` cases, the new `buildConfig.test.js`, and the added per-pool NFR2 no-growth cases; no behavior regression in the hoisted systems' existing tests (firing/collision/black-hole).
- `npm run build` -- expected: build succeeds; `dist/` contains `index.html` + a separate content-hashed **phaser** chunk and app chunk under `assets/`; `dist/index.html` references them via relative `./assets/...` paths; NO "Some chunks are larger than 500 kB" warning is emitted.

**Manual checks:**
- `npm run build && npm run preview`, open in a desktop browser: game loads and plays; resize the window → canvas fits and stays centered preserving 16:9 (letterboxed, not stretched); NO FPS/sim-ticks debug readout is visible (gameplay HUD still shows). `npm run dev` still shows the debug readout.
- Peak-load feel (NFR1, unautomatable): during a heavy late-game swarm with bombs detonating and bloom + grid warp active, framerate holds at 60 on mid-range hardware.



## Auto Run Result

Status: done (follow-up review pass)

**Summary of change under review:** An audit-and-harden pass over the assembled game's hot loop and web build (already implemented + reviewed in the original run at commit `a11976a`). This follow-up review pass re-ran four independent review layers (adversarial, edge-case, verification-gap, intent-alignment) over the full diff since baseline `ef9beef`. The shipped production code — `Pool.forEachActive` → `Set.prototype.forEach`, hoisted collector closures in Firing/Collision/BlackHole systems, `import.meta.env.DEV`-gated debug readout, and the Vite Phaser vendor split — was walked path-by-path by two reviewers and found mechanically correct and safe (single-arg callers, consistent DEV gates within their methods, `_dtSec` set before a synchronous non-reentrant iteration). No high or medium severity finding touched shipped code. Three low-severity test-hardening patches were applied.

**Files changed this pass (all test-only):**
- `src/systems/particleSystem.test.js` — added `expect(stableStreak).toBeGreaterThanOrEqual(3)` after the loop-until-stable warm-up so a future pool that never plateaus fails loudly instead of snapshotting a mid-growth baseline (closes a latent NFR2 false-negative).
- `src/systems/firingSystem.test.js` — bullet steady-state no-growth test bumped 400 → 500 steps to meet the AC's explicit "≥500 fixed steps".
- `src/systems/blackHoleSystem.test.js` — black-hole steady-state no-growth test bumped 300 → 500 steps for the same AC conformance.

**Review findings breakdown:** patch 2 (low 2), defer 0, reject 12 (low 12), intent_gap 0, bad_spec 0. See the `## Review Triage Log` follow-up entry for the full rejection rationale (most rejects were intent-sanctioned proxy surfaces or prior-pass-triaged items; the built-artifact/runtime manual-verification boundary remains on the deferred-work ledger from the original pass and was not re-logged).

**Follow-up review recommendation:** false (patched high 0, medium 0, low 2 → score 3×0 + 1×2 = 2, below the 5 threshold).

**Verification performed:**
- `npm test` → 42 files, **629 tests passed** (including the bumped bullet/black-hole no-growth tests and the hardened particle warm-up guard).
- `npm run build` → succeeds; emits `dist/assets/phaser-0YPJO2g1.js` (1,481 kB, own content-hashed vendor chunk) + `dist/assets/index-*.js` (51.8 kB app chunk); **no chunk-size warning**; `dist/index.html` references both via relative `./assets/...` paths. (NFR1 60-FPS-on-hardware and NFR7 live canvas resize remain the documented manual-verification boundary.)

**Residual risks / artifacts:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` was already modified in the working tree at session start (not part of this change) — left in place as a residual artifact, not committed.
- The intent's runtime/build-output guarantees (zero-iterator/closure allocation, tree-shaken production debug readout, emitted Phaser chunk topology, 60 FPS at peak load) are verified via sanctioned proxies (allocation-audit tests, source/config assertions) rather than at their own surface — an inherent, intent-accepted boundary.
