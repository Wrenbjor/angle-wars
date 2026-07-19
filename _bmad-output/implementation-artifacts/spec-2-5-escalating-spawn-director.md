---
title: 'Story 2.5 — Escalating Spawn Director'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'a1393164516a6106b168c3290ad6812762aeb59e'
final_revision: 'a6cde0497a5462bc13908d520e6f6f4ebb8b149c'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Each combat archetype (Seeker, Green Square, Pinwheel, Snake) currently self-spawns on its own fixed placeholder cadence, with no central control, no escalation, and no concurrency bound. There is no single authority that grows the swarm harder the longer a run lasts, so every run has a flat, un-ramping intensity and the pools accumulate without limit (the no-cap/despawn debt logged against Stories 2.1–2.3).

**Approach:** Add a dedicated `SpawnDirector` system that becomes the *sole* spawn authority for the four one-hit combat archetypes. Strip the self-spawn cadence out of those four systems (each keeps its pool + movement/behavior and exposes a public `spawn()`), and let the director own: a continuous difficulty ramp derived from elapsed sim time that (a) shrinks the spawn interval toward a floor and (b) interpolates per-archetype mix weights from an easy base toward a tougher peak; a global active-instance cap (the performance guardrail that bounds peak load and resolves the accumulation debt); and per-run reset by reconstruction on `scene.restart()`. The Black Hole is a distinct, locally-capped hazard and stays on its own Story-2.4 self-spawn — out of the director's swarm mix.

## Boundaries & Constraints

**Always:**
- The `SpawnDirector` is the ONLY thing that spawns Seekers, Green Squares, Pinwheels, and Snakes during a run. The four systems must no longer self-spawn (no `_accumMs` cadence in their `fixedUpdate`).
- All ramp math derives from accumulated fixed-step `dt` (elapsed sim time), never render time — so escalation is frame-rate-independent. `elapsed` and the spawn accumulator advance only by `dt`.
- Difficulty is a pure function of `elapsed`: the spawn interval is monotonic non-increasing from `SPAWN_DIRECTOR_BASE_INTERVAL_MS` down to a floor of `SPAWN_DIRECTOR_MIN_INTERVAL_MS`, reached at `SPAWN_DIRECTOR_RAMP_DURATION_MS` and held flat after; each archetype's weight interpolates linearly from its base weight to its peak weight over the same ramp, so the value at a given elapsed time is identical regardless of tick size.
- Archetype selection is a weighted random over the CURRENT weights using the injectable rng; an archetype whose current weight is 0 is never selected. The Snake's base weight is 0 (held back early) and its peak weight is positive (present late) so the mix observably shifts toward tougher combinations.
- The steady-state director path allocates nothing per tick: the weight scratch buffer is reused, and the active-count sum and weighted pick never build new arrays.
- Before each spawn the director checks the global cap: it counts total active instances across the four director-governed pools and skips the spawn (discarding that interval's banked time, mirroring the Black Hole's at-cap behavior) when the count is `>= SPAWN_DIRECTOR_MAX_ACTIVE`.
- All ramp/mix/cap values are centralized `SPAWN_DIRECTOR_*` constants in `constants.js` — placeholders, tuned post-launch, no inline magic numbers.
- Each refactored system keeps its existing pool prewarm, movement/behavior, and per-instance placement exactly as-is; only the cadence trigger moves out.

**Block If:**
- Making the director the single spawn authority would require changing the *semantics* of a shared seam (`CollisionSystem` / `PlayerDeathSystem` / `ScoringSystem` / `Pool` / `World` run-order contract) rather than removing per-system cadence + adding one new system — that signals a hidden conflict. HALT with specifics.

**Never:**
- Do not implement spawn telegraphing, the pre-active non-lethal state, or spawn-point ship-avoidance / spawn-safety — those are Story 2.6. The director reuses each archetype's EXISTING edge/interior placement unchanged; it does not read the ship for placement.
- Do not fold the Black Hole into the director's weighted mix and do not remove its Story-2.4 self-spawn (its local `BLACKHOLE_MAX_ACTIVE` already bounds it; it is a hazard, not a swarm enemy). Do not edit `BlackHoleSystem` or `blackHoleSystem.test.js`.
- Do not add a score multiplier, despawn/aging of live enemies, or difficulty tuning beyond the linear ramp (Epic 3 / post-launch feel).
- Do not change enemy movement, homing, flee/aggro, wander, slither, split, collision, scoring, or death behavior — only relocate the spawn trigger.
- Do not make the cap remove already-active enemies; it only gates NEW spawns.

## I/O & Edge-Case Matrix

Scope: one `SpawnDirector.fixedUpdate(dt)` step (or the pure ramp/mix helpers), constructed over four fake spawnables `{ system:{ spawn(), enemyPool:{activeCount} }, baseWeight, peakWeight }` with an injectable rng, unless noted.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Interval at run start (AC1) | fresh director, `elapsed == 0` | current interval == `SPAWN_DIRECTOR_BASE_INTERVAL_MS` | none |
| Interval mid-ramp (AC1) | `elapsed == RAMP_DURATION/2` | interval == `BASE − (BASE−MIN)/2` (linear) | none |
| Interval floor (AC1) | `elapsed >= RAMP_DURATION` | interval == `MIN`, never lower for any larger elapsed | clamp |
| Interval monotonic (AC1) | increasing elapsed samples | interval is non-increasing across them | none |
| dt-independence (AC1) | same real elapsed reached via fine vs coarse `dt` | interval and weights are identical (functions of `elapsed = Σdt`) | none |
| First spawn timing | fresh director stepped by `dt` until `accum >= BASE_INTERVAL` | exactly one spawn fires on the crossing step, none before | none |
| Mix early = no snake (AC1) | `elapsed == 0`, snake base weight 0, rng swept across [0,1) | Snake `spawn()` never called; only positive-weight archetypes selected | none |
| Mix late includes snake (AC1) | `elapsed >= RAMP_DURATION`, snake peak weight > 0, rng near 1 | Snake `spawn()` can be selected | none |
| Weighted selection determinism (AC1) | fixed weights, rng returns a value landing in a known archetype's cumulative band | that archetype's `spawn()` is called exactly once | none |
| Cap reached (AC2) | summed `activeCount` across pools `>= SPAWN_DIRECTOR_MAX_ACTIVE`, interval elapsed | no `spawn()` called; banked interval time discarded (not re-tried next tick) | none |
| Cap below (AC2) | summed `activeCount < MAX_ACTIVE`, interval elapsed | one `spawn()` called | none |
| No per-tick allocation (AC2) | many steady-state steps | the reused `_weights` buffer reference is stable; no new arrays per tick | none |
| Reset by reconstruction (AC3) | director A stepped past RAMP_DURATION vs a freshly constructed director B | B's interval == BASE and B never selects the snake at elapsed 0 (starting ramp) | none |
| Refactored system no self-spawn | any of the four systems, `fixedUpdate(dt)` run for many intervals with no director | its pool stays empty (activeCount 0) — cadence no longer lives there | none |
| Public spawn places one | `system.spawn()` called directly | exactly one instance (a whole chain for Snake) placed per the archetype's existing placement rules | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- REMOVE the now-unused `SEEKER_SPAWN_INTERVAL_MS`, `GREEN_SQUARE_SPAWN_INTERVAL_MS`, `PINWHEEL_SPAWN_INTERVAL_MS`, `SNAKE_SPAWN_INTERVAL_MS` (keep `BLACKHOLE_SPAWN_INTERVAL_MS`); ADD the `SPAWN_DIRECTOR_*` ramp/mix/cap constants (base+min interval, ramp duration, global max-active, and per-archetype base/peak weights).
- `src/systems/SpawnDirector.js` -- NEW system. Constructor `(spawnables, rng = Math.random)` where each spawnable is `{ system, baseWeight, peakWeight }` (system exposes `spawn()` + `enemyPool.activeCount`). Owns `_elapsedMs`, `_accumMs`, reusable `_weights`. Per tick: advance elapsed; compute current interval from the ramp; accumulate; while an interval has elapsed, if total active `< MAX_ACTIVE` pick an archetype by current interpolated weights and call its `spawn()`. Pure helpers for interval(elapsed) and the weighted pick for unit testing.
- `src/systems/EnemySystem.js` -- remove `_accumMs` + the cadence block in `fixedUpdate` and the `SEEKER_SPAWN_INTERVAL_MS` import; rename `_spawnOne()` → public `spawn()`. Keep pool, prewarm, homing, placement.
- `src/systems/GreenSquareSystem.js` -- same refactor (drop cadence + interval import; `_spawnOne` → `spawn`). Keep pool, prewarm, threat/flee/aggro, placement.
- `src/systems/PinwheelSystem.js` -- same refactor. Keep pool, prewarm, wander/drift/bounce, placement.
- `src/systems/SnakeSystem.js` -- same refactor; `spawn()` still pushes a full `SEGMENT_COUNT` chain to `this.snakes`. Keep reap/split, move, placement.
- `src/scenes/ArenaScene.js` -- construct the four enemy systems, then construct `SpawnDirector` over them and `world.addSystem` it AFTER `SnakeSystem` and BEFORE `CollisionSystem` (so fresh enemies exist for this tick's collision/death exactly as the old end-of-update self-spawn did); pass a run-scoped rng or default. No other wiring changes.
- `src/systems/spawnDirector.test.js` -- NEW; unit-test every I/O-matrix row with fake spawnables (ramp shape, mix ramp incl. snake gating, weighted-pick determinism, cap gate, no-alloc, reset-by-construction, first-spawn timing).
- `src/systems/{enemy,greenSquare,pinwheel,snake}System.test.js` -- UPDATE: replace the `_spawnOne()` calls with `spawn()`; remove the "spawn cadence" describe blocks (cadence is the director's now) and add a "`fixedUpdate` does not self-spawn" assertion; fix the "no pool growth" tests to `spawn()` a few first, then step and assert no growth.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- remove the four combat `*_SPAWN_INTERVAL_MS`; add `SPAWN_DIRECTOR_BASE_INTERVAL_MS`, `SPAWN_DIRECTOR_MIN_INTERVAL_MS`, `SPAWN_DIRECTOR_RAMP_DURATION_MS`, `SPAWN_DIRECTOR_MAX_ACTIVE`, and per-archetype `SPAWN_DIRECTOR_{SEEKER,GREEN,PINWHEEL,SNAKE}_{BASE,PEAK}_WEIGHT` -- centralized ramp tunables (snake base 0).
- `src/systems/EnemySystem.js`, `GreenSquareSystem.js`, `PinwheelSystem.js`, `SnakeSystem.js` -- strip self-spawn cadence, drop the interval import, expose `_spawnOne` as public `spawn()`; everything else unchanged -- relinquish the spawn trigger to the director.
- `src/systems/SpawnDirector.js` -- implement the ramp (interval floor + linear weight interpolation), the capped weighted-pick spawn loop over `dt`, zero per-tick allocation, and pure interval/weight helpers -- the single escalating spawn authority.
- `src/scenes/ArenaScene.js` -- construct + order the director between Snake and Collision, over the four systems -- integrate escalation into the running game while preserving spawn-timing semantics.
- `src/systems/spawnDirector.test.js` -- unit-test every I/O-matrix row -- lock the ramp, mix, cap, no-alloc, and reset contracts.
- `src/systems/{enemy,greenSquare,pinwheel,snake}System.test.js` -- migrate `_spawnOne`→`spawn`, drop cadence tests, add no-self-spawn + fixed no-growth tests -- keep the suites green and the NFR2 no-growth intent covered.

**Acceptance Criteria:**
- Given a run in progress, when sim time elapses, then the director's spawn interval decreases monotonically from `SPAWN_DIRECTOR_BASE_INTERVAL_MS` toward `SPAWN_DIRECTOR_MIN_INTERVAL_MS` and the archetype mix shifts continuously from the base weights toward the peak weights (Snake absent at start, present later) — an endless, continuous ramp (FR5).
- Given the four combat systems, when their `fixedUpdate` runs without a director, then no enemy is spawned (the director is the sole spawn authority), and when `SpawnDirector.fixedUpdate` runs it spawns via each system's public `spawn()`.
- Given many enemies already active, when the summed active count across the four director pools reaches `SPAWN_DIRECTOR_MAX_ACTIVE`, then the director spawns no more until the count drops, bounding peak load; the steady-state director path allocates nothing per tick (NFR1/NFR2).
- Given a freshly constructed director (a new run after game over), when it begins, then its interval is `SPAWN_DIRECTOR_BASE_INTERVAL_MS` and its mix is the base mix (starting ramp) — reset by reconstruction on `scene.restart()`.
- Given equal elapsed sim time split into fine vs. coarse fixed steps, when the interval and weights are read, then they are identical (the ramp is a pure function of `elapsed = Σdt`, frame-rate-independent).

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 1, low 0)
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[low]` `[patch]` The global active cap is a pre-spawn check, so a Snake `spawn()` (adds `SNAKE_SEGMENT_COUNT` segments at once) can push the summed total to `MAX_ACTIVE + SNAKE_SEGMENT_COUNT − 1` — a bounded, deterministic soft-cap overshoot that was undocumented and untested. Documented the soft-cap semantics at the gate (kept the simple pre-check — no per-cost gating; the +7 overshoot on a 60 cap is harmless for the frame budget and mirrors the Black Hole's accepted check-before discipline) and added a cap test using a fake whose `spawn()` raises its own `activeCount` (by 1 and by `SNAKE_SEGMENT_COUNT`), asserting the exact bounded ceiling and that no further spawn fires once at/over cap.
  - `[low]` `[patch]` The ramped-interval escalation (AC1's headline behavior) was pinned only via the pure `intervalAt` helper; every `fixedUpdate`-driven test ran near elapsed 0 (interval ≈ BASE), so replacing `intervalAt(this._elapsedMs)` with a constant BASE would have passed all tests. Added two `fixedUpdate`-at-peak-elapsed tests proving cadence is strictly faster at peak (consumed interval ≈ MIN, more spawns per elapsed window) than near start.

## Design Notes

**Why strip self-spawn instead of modulating it.** The epic mandates "a dedicated system owning spawn cadence, mix selection... and per-run reset." Two spawn authorities (systems + director) would double-spawn or force the director to reach into each system's accumulator. Cleanest is one authority: the systems expose `spawn()` and own only movement; the director owns *when* and *which*. Each `spawn()` is the old `_spawnOne` verbatim (its placement is already correct and tested).

**Ramp shape (pure function of elapsed).** Both curves are piecewise-linear and continuous:
```js
const p = Math.min(elapsedMs / SPAWN_DIRECTOR_RAMP_DURATION_MS, 1);
const interval = SPAWN_DIRECTOR_BASE_INTERVAL_MS
  - (SPAWN_DIRECTOR_BASE_INTERVAL_MS - SPAWN_DIRECTOR_MIN_INTERVAL_MS) * p; // ≥ MIN
const weightᵢ = baseᵢ + (peakᵢ - baseᵢ) * p;                                // per archetype
```
Because `elapsed` is `Σdt` and `p` derives only from it, both are tick-size independent — so the total-spawn count is not asserted to be exactly dt-invariant (the interval changes across the ramp), but the interval/weight *values at a given elapsed* are. Snake `base 0 → peak >0` is what makes "shifts toward tougher combinations" observable.

**Why a global active cap.** AC1 (rate rises endlessly) and AC2 (sustain 60 FPS) can only coexist if concurrency is bounded — otherwise an ever-faster spawn rate eventually breaks the frame budget. The cap sums `activeCount` across the four pools (a snake counts as its live segments — the honest per-frame cost) and gates new spawns; at cap the interval's banked time is discarded rather than backlogged (matching the Black Hole's by-design at-cap behavior from 2.4). It never despawns live enemies. This also resolves the no-cap/despawn debt logged for Stories 2.1–2.3.

**Weighted pick, zero allocation.** A reused `_weights` array (length = spawnable count) is refilled each spawn from the interpolated weights; the pick walks a running `rng()*total` subtraction — no per-tick arrays, no sort. A weight of 0 contributes no band, so a 0-weight archetype is unreachable.

**Director order in the world.** Placed after `SnakeSystem` and before `CollisionSystem`: the old per-system self-spawn ran at the end of each system's own update (a fresh enemy sat un-moved until next tick but was present for that tick's collision). Spawning just before Collision reproduces that exactly, with no fresh enemy moved the tick it appears.

**Reset by reconstruction.** `scene.restart()` rebuilds every run-scoped object, so a new `SpawnDirector` starts at `elapsed 0` = base ramp. No explicit `reset()` needed; the unit test proves a fresh director is at the base ramp (the observable meaning of "resets to the starting ramp"). Full scene-restart wiring is verified via build + manual run — the same integration-harness gap prior stories carry.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `spawnDirector.test.js` and the migrated enemy/green/pinwheel/snake suites; `blackHoleSystem.test.js` unchanged and green.
- `npm run build` -- expected: production build succeeds (the pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: at run start only a light trickle of mostly Seekers/Green Squares appears; over ~1–2 minutes the spawn rate visibly climbs and Pinwheels then Snakes join the mix; the arena never floods past the cap (frame rate holds); restarting after game over returns to the light starting trickle.

## Auto Run Result

Status: done

**Summary of implemented change:** Added the Escalating Spawn Director (Story 2.5). The four one-hit combat systems (Seeker, Green Square, Pinwheel, Snake) no longer self-spawn — each keeps its pool + movement and exposes a public `spawn()`. A new `SpawnDirector` system is the sole spawn authority: it derives a continuous difficulty ramp purely from elapsed sim time (`Σ dt`), shrinking the spawn interval monotonically from `SPAWN_DIRECTOR_BASE_INTERVAL_MS` (1500) to a `SPAWN_DIRECTOR_MIN_INTERVAL_MS` floor (350) over `SPAWN_DIRECTOR_RAMP_DURATION_MS` (120s), and linearly interpolating each archetype's mix weight from base to peak (Snake gated 0→2 so the mix shifts toward tougher combinations). A global soft cap (`SPAWN_DIRECTOR_MAX_ACTIVE` 60) summed across the four pools bounds peak load, and per-run reset is by reconstruction on `scene.restart()`. The Black Hole keeps its own Story-2.4 self-spawn (a distinct, locally-capped hazard) and was not touched.

**Files changed:**
- `src/config/constants.js` — removed the four combat `*_SPAWN_INTERVAL_MS`; added the `SPAWN_DIRECTOR_*` ramp/mix/cap constants (base+min interval, ramp duration, max-active, per-archetype base/peak weights; Snake base 0).
- `src/systems/SpawnDirector.js` — NEW; the single escalating spawn authority (pure `intervalAt`/`weightAt`/`progressAt` helpers; capped weighted-pick spawn loop over `dt`; zero per-tick allocation).
- `src/systems/EnemySystem.js`, `GreenSquareSystem.js`, `PinwheelSystem.js`, `SnakeSystem.js` — stripped the `_accumMs` self-spawn cadence + interval import; `_spawnOne()` → public `spawn()`; movement/behavior unchanged.
- `src/scenes/ArenaScene.js` — construct `SpawnDirector` over the four systems and add it after `SnakeSystem`, before `CollisionSystem` (preserving prior spawn-just-before-collision timing).
- `src/systems/spawnDirector.test.js` — NEW; 17 tests covering every I/O-matrix row plus the two review-added tests (real-`activeCount` soft-cap ceiling; escalation-through-`fixedUpdate` at peak elapsed).
- `src/systems/{enemy,greenSquare,pinwheel,snake}System.test.js` — migrated `_spawnOne`→`spawn`, dropped cadence describe blocks, added no-self-spawn + public-`spawn()` + reworked no-growth tests.

**Review findings breakdown (4 layers: adversarial, edge-case, verification-gap, intent-alignment):**
- Patches applied: 2 (both low). (1) Documented + tested the bounded soft-cap overshoot (a picked Snake may reach `MAX_ACTIVE + SNAKE_SEGMENT_COUNT − 1`); (2) added `fixedUpdate`-at-peak tests proving the ramped interval actually shortens cadence (the headline escalation was only pinned via the pure helper before).
- Deferred: 1 (medium) — the `ArenaScene` director run-order (after Snake / before Collision) and reset-by-reconstruction on `scene.restart()` have no headless integration test (the project-wide integration-harness gap prior stories 1.1–2.4 all carry).
- Rejected: 13 — misconfiguration hypotheticals with sane shipped constants (non-positive MIN interval → infinite loop; `RAMP_DURATION`==0 → NaN; MIN>BASE inverted ramp; negative weights), unreachable guards (all-zero-weight window — Seeker weight stays ≥4), tuning/toughness-direction items the intent defers post-launch (Seeker weight 5→4; "is the mix actually tougher"), AC2 items not headlessly feasible / out of the director's scope (bullets not in the cap; 60 FPS not measured), a documented-intentional narrowing (dt spawn-count parity vs value parity), the acknowledged AC3 reconstruction-surface limitation, and a negligible micro-recompute (`progressAt` 5×/spawn tick).

**Follow-up review recommendation:** false. Patched findings this pass = 2 (high 0, medium 0, low 2); score = 3×0 + 1×2 = 2 (< 5), no high-severity patch.

**Verification performed:** `npm test` → 15 suites, 233 tests pass (including `spawnDirector.test.js`, 17 tests; `blackHoleSystem.test.js` unchanged, 27 tests). `npm run build` → production build succeeds (the >500 kB chunk notice is the pre-existing Phaser bundle-size advisory, not a failure). Matrix Test Audit: every I/O-matrix row is covered by a test that ran and passed (12 in the director suite; "no self-spawn" + "public `spawn()` places one" across the four migrated suites).

**Residual risks:** The director run-order and scene-restart reset are proven only at the unit/build level (the same integration-harness gap the ledger already tracks for prior stories). The ramp/mix/cap constants are deliberate placeholders (feel tuning is post-launch), so the "light trickle → climbs → Snakes join → never floods" experience depends on those values. The cap is a soft guardrail: a picked Snake transiently overshoots `MAX_ACTIVE` by up to `SNAKE_SEGMENT_COUNT − 1` (bounded, harmless for the frame budget).
