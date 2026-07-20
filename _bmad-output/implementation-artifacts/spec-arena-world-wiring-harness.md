---
title: 'Arena World Wiring Harness — shared headless buildArenaWorld factory + order/pool/late-bind coverage'
type: 'refactor'
created: '2026-07-20'
status: 'done'
baseline_revision: 'd9a6f03833e573e572d26d0116eb211a7e42215d'
final_revision: '4cf6a8fe5ee1dd4fbfeade9804ccfc196200c546'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/src/scenes/ArenaScene.js'
  - '{project-root}/src/core/World.js'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** `ArenaScene.create()` inlines a 19-system world build whose registration order, `enemyPools`/`deathPools` composition, and two load-bearing late-binds (`snakeSystem.collisionSystem`, `blackHoleSystem.collisionSystem`) are load-bearing but have **zero** automated coverage — no test imports `ArenaScene`. The four `*Integration.test.js` files each hand-replicate a partial chain, and two of them (`highScoreIntegration`, `extraLifeIntegration`) already **drift** from the scene by constructing `PlayerDeathSystem` with `enemyPools` instead of `deathPools`. A reorder of `addSystem` calls or a swapped pool reference would leave the whole suite green.

**Approach:** Extract the inline world build into a shared, **Phaser-free** ordered-system factory `buildArenaWorld()` that `ArenaScene.create()` consumes (byte-identical wiring) and that the integration tests consume for construction. Add one assertion suite pinning the registration order, the pool compositions, and the late-binds. This codifies the currently-correct order and stops the drift; it fixes no live gameplay defect.

## Boundaries & Constraints

**Always:**
- `buildArenaWorld()` MUST import zero Phaser symbols — it lives at `src/scenes/buildArenaWorld.js` but constructs only `World`, systems, states, entities, pools, and the high-score port, so it runs headlessly in the `node` vitest env.
- The factory MUST reproduce `ArenaScene.create()`'s wiring exactly: same 19 `addSystem` calls in the same order, the same `enemyPools` (4 archetype pools) and `deathPools = [...enemyPools, holePool]` arrays (same pool object identities), and both late-binds (`snakeSystem.collisionSystem` and `blackHoleSystem.collisionSystem` set to the constructed `collisionSystem`).
- After the refactor `ArenaScene.create()` MUST produce a functionally identical scene — every `this.*` handle the render loop (`update()`) reads still assigned, and the Phaser display-object creation order (depth/z-order) unchanged.
- The factory MUST default every system's rng to `Math.random` and default the high-score port to `createHighScoreStorage()` when the caller injects neither, so a no-arg `buildArenaWorld()` matches the scene's current behavior.
- Existing test assertions in the four `*Integration.test.js` files MUST all still pass after they are migrated to build their composed context via the factory.

**Block If:**
- The current inline registration order turns out NOT to match the order the intent enumerates (SimClock→PlayerMovement→Firing→Enemy→GreenSquare→Pinwheel→Snake→SpawnDirector→Collision→Scoring→BlackHole→Bomb→ExtraLife→PlayerDeath→HighScore→GridField→Particle→ScreenFeedback→AudioDirector) — do not "fix" gameplay to fit the test; HALT and surface the discrepancy.

**Never:**
- Never change gameplay behavior, tick semantics, or the registration order — this is a pure extraction + coverage change.
- Never import Phaser (or any browser global) into `buildArenaWorld.js`.
- Never edit the deferred-work ledger (`deferred-work.md`); the orchestrator records resolution.
- Never move `FixedTimestep`, the Phaser graphics, `PlayerInputSampler`, the audio engine, or input handlers into the factory — those are scene-only concerns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No-arg build | `buildArenaWorld()` in node env | Returns a context whose `world.systems` are the 19 systems in canonical order; `enemyPools` has 4 pools; `deathPools` is `[...enemyPools, holePool]` | `createHighScoreStorage()` no-ops on absent localStorage; never throws |
| Injected rng | `buildArenaWorld({ rng })` | Every rng-taking system (Enemy, GreenSquare, Pinwheel, Snake, SpawnDirector, BlackHole, Particle) receives `rng` | No error expected |
| Injected port | `buildArenaWorld({ highScoreStorage })` | `HighScoreSystem` uses the injected port (fake `{load,save}`) | No error expected |
| Late-binds | after build | `snakeSystem.collisionSystem === collisionSystem` and `blackHoleSystem.collisionSystem === collisionSystem` | No error expected |
| Pool identity | after build | `collisionSystem` sees `enemyPools`; `deathPools[deathPools.length-1] === blackHoleSystem.holePool` and `deathPools` does NOT include the hole pool inside `enemyPools` | No error expected |

</intent-contract>

## Code Map

- `src/scenes/ArenaScene.js` -- current inline world build (`create()` lines ~158–465); refactor to call the factory and assign handles onto `this.*`, keeping all Phaser/render setup inline.
- `src/scenes/buildArenaWorld.js` -- **NEW** Phaser-free factory: constructs World + 19 systems + ship + inputState + states + pools + late-binds, returns named handles.
- `src/scenes/buildArenaWorld.test.js` -- **NEW** assertion suite: order, `enemyPools`/`deathPools` composition, late-binds, rng/port injection.
- `src/core/World.js` -- `world.systems` is the public ordered array the suite reads (constructor-name mapping).
- `src/systems/bombIntegration.test.js`, `extraLifeIntegration.test.js`, `highScoreIntegration.test.js`, `scoreMultiplierIntegration.test.js` -- migrate each `makeComposed()` to build via `buildArenaWorld()` (inject rng / fake port), pull system + pool handles from it; keep each file's curated `runTick` and assertions. Fixes the `enemyPools`→`deathPools` drift in the two drifting files.

## Tasks & Acceptance

**Execution:**
- `src/scenes/buildArenaWorld.js` -- create the factory. Signature `buildArenaWorld({ rng, highScoreStorage } = {})`. Construct in the scene's exact order; apply both late-binds; build `enemyPools` and `deathPools`; return `{ world, ship, inputState, scoreState, playerState, enemyPools, deathPools, highScoreStorage, simClock, playerMovementSystem, firingSystem, enemySystem, greenSquareSystem, pinwheelSystem, snakeSystem, spawnDirector, collisionSystem, scoringSystem, blackHoleSystem, bombSystem, extraLifeSystem, playerDeathSystem, highScoreSystem, gridFieldSystem, particleSystem, screenFeedbackSystem, audioDirector }`. When `rng` is undefined pass `undefined` to each system (its `= Math.random` default applies); when `highScoreStorage` is undefined call `createHighScoreStorage()`.
- `src/scenes/ArenaScene.js` -- replace the inline system construction (`this.world = new World()` … `world.addSystem(this.audioDirector)`) with a single `buildArenaWorld()` call, assigning each returned handle onto `this.*`. Relocate the three graphics created inside that region (`bulletGraphics`, `bombShockwaveGraphics`, `particleGraphics`) and `inputSampler` to immediately after the factory call, preserving their creation order relative to the remaining display objects. Keep `gridShader` + `borderGraphics` before the call and `FixedTimestep` in the scene.
- `src/scenes/buildArenaWorld.test.js` -- unit-test the I/O matrix: assert `world.systems.map(s => s.constructor.name)` equals the canonical 19-name order; `enemyPools` is the 4 archetype pools (identity-checked against each system's `enemyPool`); `deathPools` equals `[...enemyPools, blackHoleSystem.holePool]`; both late-binds identity-equal `collisionSystem`; `collisionSystem` was built over `enemyPools`; injected `rng`/`highScoreStorage` are honored.
- `src/systems/bombIntegration.test.js`, `extraLifeIntegration.test.js`, `highScoreIntegration.test.js`, `scoreMultiplierIntegration.test.js` -- migrate each `makeComposed()` to derive its systems/pools/states from `buildArenaWorld({ rng: <seqRng>, highScoreStorage: <port> })`; keep the curated `runTick` and every existing assertion.

**Acceptance Criteria:**
- Given the refactor is complete, when `npm run test` runs, then all existing tests plus the new `buildArenaWorld.test.js` pass.
- Given `buildArenaWorld()` is called with no args in the node env, when its `world.systems` constructor names are listed, then they equal the canonical 19-system order and no error is thrown.
- Given the two previously-drifting integration tests now consume the factory, when they run, then `PlayerDeathSystem` is wired with `deathPools` (not `enemyPools`) and their assertions still pass.
- Given a reviewer inverts any two adjacent `addSystem` calls in `buildArenaWorld.js`, when the suite runs, then the order assertion fails (the drift-catch the deferred work asks for).
- Given `npm run build` runs after the `ArenaScene` refactor, then it succeeds (imports resolve, no Phaser leaked into the factory).

## Review Triage Log

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[medium]` `[patch]` the factory's return object is the new load-bearing seam the scene destructures (27 handles onto `this.*`), yet the suite pinned only a subset — the render-only handles (`ship`, `inputState`, `scoreState`, `playerState`, `simClock`, `playerMovementSystem`, `firingSystem`, `gridFieldSystem`, `screenFeedbackSystem`, `audioDirector`) were asserted by no test, so a dropped/renamed return key would ship green and crash the live render loop on the first frame → added a `RETURN_HANDLES` contract test asserting every scene-consumed key is defined on the factory return.
  - rejected (noise / by-design / prior-pass-settled / out-of-intent-surface): `Object.assign(this, arena)` handle-copy restyle (prior-rejected); "verbatim extraction" comment wording (drift-fix noted in commit, prior-settled); shared-rng-stream interleaving (documented contract, by-design); warn/throw on non-function rng (the silent `= Math.random` coercion is a deliberate prior-pass fix); malformed high-score port validation (outside the I/O matrix — injected ports are `{load,save}`; needs garbage input); `buildArenaWorld(null)` TypeError (no caller passes `null`; outside the no-arg/injected-object I/O surface); `ParticleSystem.rng` public-vs-`_rng` naming (pre-existing, prior-rejected); comment-only coupling in `scoreMultiplierIntegration` runTick (documented, by-design); full-arena-construction-drives-subset risk (Design Notes: factory is construction-only, `world.fixedUpdate` deliberately unused); triple-documented order rationale (cosmetic); smoke test asserting only `not.toThrow()` (deliberate mis-wiring detector added last pass); hard-coded `CANONICAL_ORDER` list (that duplication IS the reorder tripwire); per-pair semantic ordering-invariant assertions (enhancement beyond the pinned canonical order).

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` `buildArenaWorld.js` high-score port guard used `=== undefined`; a `null` port bypassed the default and crashed `HighScoreSystem`'s ctor → changed to `== null`.
  - `[low]` `[patch]` injected `rng` was threaded raw; a `null`/non-function value slipped past each system's `= Math.random` default → coerce to `undefined` at the factory boundary (`const _rng = typeof rng === 'function' ? rng : undefined`) and added a shared-rng-stream contract note.
  - `[medium]` `[patch]` the factory's assertable-wiring goal was undercut because no test ticked the assembled world (7 systems' cross-system ctor args unexercised) → added a headless full-chain no-throw smoke test (120 `world.fixedUpdate` ticks, constant rng); it passes, confirming no hidden mis-wiring.
  - `[low]` `[patch]` stale block comment in `scoreMultiplierIntegration.test.js` still described the removed `{killedEnemies}` stand-in → rewritten to describe the factory-based composition.
  - rejected (noise/by-design/out-of-intent-scope): private-field rng assertions (valid & passing); `Object.assign(this, arena)` style suggestion; returning defensive copies of `enemyPools`/`deathPools` (identity assertions require the live shared refs); "verbatim/pure-refactor" wording (drift-fix called out in the commit message instead); a death-on-hole-contact regression test (PlayerDeathSystem's behavioral surface, not the composition surface the intent scopes — composition IS asserted).

## Design Notes

The factory is the extracted construction verbatim — same constructor args, same order, same late-binds — so the scene's behavior is preserved by construction, not by re-derivation. The scene cannot be unit-tested (`create()` needs a live Phaser context), so the factory is the seam that makes the load-bearing wiring headlessly assertable; the scene's correct consumption is covered by `npm run build` + the render-loop handle assignments.

Canonical order (19): `SimClockSystem, PlayerMovementSystem, FiringSystem, EnemySystem, GreenSquareSystem, PinwheelSystem, SnakeSystem, SpawnDirector, CollisionSystem, ScoringSystem, BlackHoleSystem, BombSystem, ExtraLifeSystem, PlayerDeathSystem, HighScoreSystem, GridFieldSystem, ParticleSystem, ScreenFeedbackSystem, AudioDirectorSystem`.

Integration-test migration keeps each file's `runTick` (a curated SUBSET of the chain over hand-placed entities) — the factory is consumed for CONSTRUCTION only, so `world.fixedUpdate()` (which would run movement/spawn and perturb hand-placed state) is deliberately not used.

## Verification

**Commands:**
- `npm run test` -- expected: all suites green, including the new `buildArenaWorld.test.js` and the four migrated integration suites.
- `npm run build` -- expected: succeeds; confirms the `ArenaScene` refactor's imports resolve and no Phaser dependency leaked into `buildArenaWorld.js`.

**Manual checks (if no CLI):**
- Inspect `buildArenaWorld.js` imports: no `phaser` import present.

## Auto Run Result

Status: done (follow-up review pass on a completed `done` spec)

**Summary:** The extraction (`buildArenaWorld` factory + order/pool/late-bind coverage) landed in commit `06e8354` and was already reviewed. This follow-up review pass re-ran the four review layers (adversarial, edge-case, verification-gap, intent-alignment) over the code diff since baseline `d9a6f03`. The intent-alignment audit confirmed the diff faithfully implements the literal contract. One new, actionable coverage gap was found and patched; all other findings re-surfaced prior-pass by-design decisions or fell outside the intent's I/O surface.

**Files changed this pass:**
- `src/scenes/buildArenaWorld.test.js` -- added a `RETURN_HANDLES` contract test asserting every one of the 27 handles the scene destructures onto `this.*` is defined on the factory return — closing the new return-object→destructure drift seam (a dropped/renamed render-only key would otherwise ship green and crash the live render loop on the first frame).

**Review findings breakdown:** patch 1 (medium 1) applied; defer 0; reject 13 (all low — prior-pass-settled by-design decisions or outside the intent's I/O surface). intent_gap 0, bad_spec 0.

**Follow-up review recommendation:** false. Patched severity counts: high 0, medium 1, low 0; score = 3×1 + 1×0 = 3 (< 5, no high).

**Verification performed:**
- `npm run test` -- 639 tests across 43 files pass (includes the new contract assertion).
- `npm run build` -- succeeds (66 modules transformed; no Phaser leaked into the factory).

**Residual risks:** Low. The scene's `create()` glue (the 27 hand-assignments) still cannot be unit-tested directly, but the factory's return contract is now pinned headlessly, so a factory-side key drop/rename is caught by CI. The pre-existing working-tree modification to `deferred-work.md` is unrelated to this change and was left in place (no findings were deferred this pass).
