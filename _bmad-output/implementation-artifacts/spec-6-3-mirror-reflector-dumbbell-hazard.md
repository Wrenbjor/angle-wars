---
title: 'Mirror Reflector (Dumbbell) Hazard'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: '33c3811f9505e7af39baae3739e898e26f669919'
final_revision: 'f811fb0806c19363b024439bf981262515e35f45'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/entities/Pinwheel.js'
  - '{project-root}/src/systems/PinwheelSystem.js'
  - '{project-root}/src/systems/SpawnDirector.js'
  - '{project-root}/src/systems/spawnPlacement.js'
  - '{project-root}/src/systems/CollisionSystem.js'
  - '{project-root}/src/systems/PlayerDeathSystem.js'
  - '{project-root}/src/state/PlayerState.js'
  - '{project-root}/src/entities/Bullet.js'
  - '{project-root}/src/systems/FiringSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/scenes/ArenaScene.js'
  - '{project-root}/src/scenes/telegraphCue.js'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The roster has no threat that resists firepower. Every hazard so far dies to bullets or bombs, so play is one-dimensional: aim and hold fire. Epic 6 wants one more hazard with a distinct verb — positioning and nerve, not shooting.

**Approach:** Add the Mirror Reflector, rendered as a spinning **dumbbell** (two lethal weights joined by a bar). It drifts + spins like a pooled Pinwheel, spawns through the existing SpawnDirector + spawn telegraph, and is **immune to gunfire** — a player bullet striking its bar **reflects** (velocity mirrored across the bar's normal) and stays a live player shot. It is destroyed **only** by flying the ship through its **center point** (score payout); touching **either weight** kills the player through the existing death flow. New collision code: a bullet-vs-bar segment test + a per-bullet velocity mirror, modeled on the PinwheelSystem drift/pool pattern; the weight-kill reuses the Story 6.2 `playerState.pendingDeath` seam.

## Boundaries & Constraints

**Always:**
- The reflector is a **pooled** entity (own `enemyPool`, zero steady-state allocation, prewarmed) that **drifts** (constant `|v| = REFLECTOR_DRIFT_SPEED`, wall-bounce-reflect on the inset bounds) and **spins** (`angle += REFLECTOR_SPIN_RATE · dtSec`) every fixed step — all motion `dt`-driven, frame-rate-independent (mirror `PinwheelSystem`).
- It spawns **only** via `SpawnDirector` (a fifth governed spawnable with base/peak weights): `spawn(avoidX, avoidY)` places it on a random arena edge ≥ `SPAWN_SAFE_RADIUS` from the ship via `pickSafeEdgePlacement` (effective radius = `REFLECTOR_BAR_HALF_LENGTH + REFLECTOR_WEIGHT_RADIUS`), sets `telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS`, a random drift heading at the drift speed, and a random initial `angle`.
- While `telegraphMs > 0` the reflector is **frozen and inert**: no drift/spin, no bullet reflect, no ship destroy, no weight kill; decrement by `dt`, clamp at 0, activate (fall through) on the tick it reaches 0 — the same telegraph-freeze convention every archetype follows.
- **Bullet reflect** (per active non-telegraph reflector, per active bullet, at most once per bullet per tick): the bar is the segment between the two weight endpoints. If the bullet is within `BULLET_RADIUS + REFLECTOR_BAR_HALF_THICKNESS` of that segment **and approaching** the bar (`side · (v·n) < 0`, where `n` is the bar's unit normal `(−sinθ, cosθ)` and `side` is the bullet's signed offset from the bar line through the center), mirror the bullet velocity across `n` (`v' = v − 2(v·n)n`, magnitude preserved). The bullet is **not** consumed and stays player-owned; the reflector takes **no** damage.
- **Ship interactions** (post-move ship, per active non-telegraph reflector, evaluated once): if `dist(ship, center) ≤ REFLECTOR_CENTER_KILL_RADIUS` → **destroy** (release the reflector to its pool + credit a flat `REFLECTOR_SCORE` directly to `scoreState.score`); **else** if the ship overlaps **either** weight circle (`dist(ship, weight) ≤ ship.radius + REFLECTOR_WEIGHT_RADIUS`) → **weight kill** (`playerState.pendingDeath = true`, consumed by the normal `PlayerDeathSystem` flow). Center-destroy takes precedence when both hold in one tick (reward threading the needle).
- Reflector pool releases are **deferred** to a second pass (never `release()` mid-`forEachActive`); the score credit and `pendingDeath` set are scalar and happen inline.
- A per-type concurrency cap: `spawn()` is a no-op when `enemyPool.activeCount >= REFLECTOR_MAX_ACTIVE` (the reflector is unkillable by fire and would otherwise pile up — the SpawnDirector has only a global cap).
- All new feel/geometry/economy/color values are centralized constants in `constants.js` (no inline magic numbers), per the post-launch-tuning constraint.

**Block If:**
- Reflecting a bullet, killing via a weight, or scoring the center-destroy would require changing the **semantics** of a shared seam (rather than: velocity-mutating a pooled bullet in place, setting `playerState.pendingDeath`, and `scoreState.score += REFLECTOR_SCORE`). HALT with specifics.

**Never:**
- Do **not** add the reflector pool to the `CollisionSystem` `enemyPools`, the `BombSystem` clear list, the `BlackHoleSystem` absorb/gravity set, or the `PlayerDeathSystem` `deathPools`. It is immune to gunfire, bombs, and black-hole absorption, and its lethal region is the weights (not a center circle) — so none of the uniform-circle shared seams apply. "Destroyed **only** by flying through its center."
- Do **not** consume/despawn a reflected bullet, damage the reflector on a bullet hit, or make the reflect frame-rate dependent.
- Do **not** implement a ship-vs-reflected-bullet death path this story. Reflected bullets stay in the shared player bullet pool and are harmless to the player by construction (no ship-vs-player-bullet seam exists). `REFLECTED_BULLET_HARMS_PLAYER` is defined as the centralized tunable at its default (`false`); wiring the harm-player branch (a new seam) is deferred post-launch.
- Do **not** give the reflector a lifespan/time-based despawn — it persists until threaded (bounded by `REFLECTOR_MAX_ACTIVE`).

## I/O & Edge-Case Matrix

Scope: one `MirrorReflectorSystem.fixedUpdate(dt)` step unless noted.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Drift + spin | active non-telegraph reflector | position += `v·dtSec`; `angle += REFLECTOR_SPIN_RATE·dtSec`; wall-bounce reflects the crossed-axis velocity, clamped to the inset bound | — |
| Telegraph freeze | `telegraphMs > 0` | frozen/inert (no drift/spin/reflect/destroy/kill); `telegraphMs -= dt` clamped ≥ 0; activates at 0 | NaN-safe |
| Bullet reflect | active bullet near the bar, approaching | bullet velocity mirrored across bar normal (`|v|` preserved); bullet stays active + player-owned; reflector unchanged | guard div-by-zero via fixed unit normal |
| Bullet not consumed | reflected bullet, later tick | still in `bulletPool`; can destroy an enemy via `CollisionSystem` normally | — |
| Bullet receding | active bullet near the bar, moving away (`side·(v·n) ≥ 0`) | no reflect (prevents per-tick jitter) | — |
| Bullet double-reflect guard | one bullet near two reflectors' bars same tick | reflected at most once this tick | reusable Set |
| Ship through center | `dist(ship, center) ≤ REFLECTOR_CENTER_KILL_RADIUS` | reflector released; `scoreState.score += REFLECTOR_SCORE`; `pendingDeath` NOT set | deferred release |
| Ship hits a weight | ship overlaps either weight circle; center miss | `playerState.pendingDeath = true`; reflector NOT released; no score | — |
| Center + weight same tick | ship overlaps both | destroy wins: released + scored; `pendingDeath` NOT set | — |
| Telegraphing + ship at center | `telegraphMs > 0`, ship on center | no destroy, no kill (inert) | — |
| Spawn | `spawn(avoidX, avoidY)` below cap | one reflector on a safe edge; `telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS`; `|v| = REFLECTOR_DRIFT_SPEED`; random heading + `angle` | — |
| Spawn at cap | `activeCount >= REFLECTOR_MAX_ACTIVE` | no-op (no acquire) | — |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add reflector feel/geometry/economy constants (`REFLECTOR_DRIFT_SPEED`, `REFLECTOR_SPIN_RATE`, `REFLECTOR_BAR_HALF_LENGTH`, `REFLECTOR_BAR_HALF_THICKNESS`, `REFLECTOR_WEIGHT_RADIUS`, `REFLECTOR_CENTER_KILL_RADIUS`, `REFLECTOR_SCORE`, `REFLECTOR_POOL_PREWARM`, `REFLECTOR_MAX_ACTIVE`), `SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT`/`_PEAK_WEIGHT`, `COLOR_MIRROR_REFLECTOR`, and the documented tunable `REFLECTED_BULLET_HARMS_PLAYER = false`.
- `src/entities/MirrorReflector.js` -- NEW pooled entity factory `createMirrorReflector()` → `{x, y, vx, vy, angle, telegraphMs}` (Phaser-free), with a shape doc comment modeled on `Pinwheel.js`.
- `src/systems/mirrorReflectorMath.js` -- NEW pure, Phaser-free helpers: `reflectorEndpoints(x, y, angle, halfLen)` → the two weight endpoints; `closestPointOnSegment(px, py, ax, ay, bx, by)`; `reflectVelocity(vx, vy, nx, ny)` (mirror across a unit normal). Shared by the system and the renderer.
- `src/systems/MirrorReflectorSystem.js` -- NEW system (extends `System`): owns the reflector `Pool` (prewarmed), public `spawn(avoidX, avoidY)` (cap-guarded, telegraph, safe edge placement), `fixedUpdate(dt)` doing telegraph-gate → drift+spin+wall-bounce → bullet reflect → ship destroy/weight-kill (deferred release). Constructor: `(ship, bulletPool, playerState, scoreState, rng)`.
- `src/state/PlayerState.js` -- no shape change (reuses `pendingDeath` from Story 6.2); update the doc comment to note the reflector weight-kill as a second `pendingDeath` producer.
- `src/systems/SpawnDirector.js` -- doc-comment only: note a fifth governed spawnable (the reflector) that is NOT one-hit but spawns through the director + telegraph and counts toward the global cap. No logic change (the director is archetype-generic).
- `src/scenes/buildArenaWorld.js` -- construct `MirrorReflectorSystem` in the enemy section (after `SnakeSystem`, before `SpawnDirector`, so it is a spawnable and runs before `CollisionSystem`/`PlayerDeathSystem`); add it as the 5th `SpawnDirector` spawnable; do NOT add its pool to `enemyPools`/`deathPools`; register it (20 systems now); return the handle. Update the "19 systems" doc.
- `src/scenes/ArenaScene.js` -- NEW dumbbell render pass: per active reflector compute endpoints via `reflectorEndpoints` (bar length + weight radius scaled by `telegraphScale`), draw the bar line + two weight circles in `COLOR_MIRROR_REFLECTOR` at `telegraphAlpha`; add the reflector graphics to the additive/bloom layer list. Manual-verification boundary (Phaser render), source-text asserted.
- Test files (below).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the constants above with doc comments; keep placeholder values tunable. Invariant: `REFLECTOR_CENTER_KILL_RADIUS < REFLECTOR_BAR_HALF_LENGTH` (center-kill zone sits inside the bar, disjoint from the weight ends in the common case).
- `src/entities/MirrorReflector.js` -- `createMirrorReflector()` returns the zeroed shape (`telegraphMs: 0`); the system overwrites positional/velocity/angle/telegraph on spawn.
- `src/systems/mirrorReflectorMath.js` -- the three pure helpers; `reflectVelocity` assumes a unit normal and returns `v − 2(v·n)n`; `closestPointOnSegment` clamps the projection parameter to `[0,1]`.
- `src/systems/MirrorReflectorSystem.js` -- implement per the Boundaries: telegraph gate, drift/spin/wall-bounce (mirror `PinwheelSystem`), bullet reflect (fixed unit normal `(−sinθ, cosθ)`, approaching-gate, per-tick double-reflect Set), ship destroy/weight-kill (center precedence), deferred reflector release, cap-guarded `spawn()`. Zero steady-state allocation (reused scratch arrays/Set).
- `src/state/PlayerState.js` -- doc-comment update only.
- `src/systems/SpawnDirector.js` -- doc-comment update only.
- `src/scenes/buildArenaWorld.js` -- construct + register + wire per Code Map; return `mirrorReflectorSystem`.
- `src/scenes/ArenaScene.js` -- wire the dumbbell render pass + bloom layer.
- `src/systems/mirrorReflectorMath.test.js` -- NEW: `reflectorEndpoints` at `angle` 0 / π/2 / arbitrary; `closestPointOnSegment` (interior projection, both endpoint clamps); `reflectVelocity` (reflect across an axis normal, across an arbitrary unit normal, magnitude preserved, a tangential velocity unchanged).
- `src/systems/mirrorReflectorSystem.test.js` -- NEW: cover every I/O-matrix row incl. drift+spin+wall-bounce, telegraph freeze/activate, bullet reflect (mirrored + not consumed + reflector undamaged + magnitude preserved), receding-bullet no-reflect, ship-center destroy (release + `REFLECTOR_SCORE`, no `pendingDeath`), ship-weight kill (`pendingDeath` set, not released, no score), center-vs-weight precedence, telegraphing-inert, `spawn()` (placement/telegraph/`|v|`/away-from-ship) and the cap no-op, and steady-state pool reuse. Plus two composed cases: (a) a reflected bullet goes on to destroy an enemy through a real `CollisionSystem`; (b) a weight contact drives a real `PlayerDeathSystem` to a life loss with the normal respawn/invuln.
- `src/scenes/buildArenaWorld.test.js` -- update to 20 systems (same relative order), assert the reflector is the 5th `SpawnDirector` spawnable, its pool is NOT in `enemyPools` nor `deathPools`, `ship`/`bulletPool`/`playerState`/`scoreState` are shared into it, and `mirrorReflectorSystem` is returned.
- `src/scenes/renderIntegration.test.js` -- add source-text assertions: ArenaScene's reflector render calls `reflectorEndpoints`, fills with `COLOR_MIRROR_REFLECTOR`, applies `telegraphAlpha`/`telegraphScale`, and the reflector graphics join the bloom/additive layer list.

**Acceptance Criteria:**
- Given an active reflector, when the step runs, then it drifts at `REFLECTOR_DRIFT_SPEED`, its `angle` advances by `REFLECTOR_SPIN_RATE·dtSec`, and it bounces off the inset walls — all frame-rate-independent.
- Given a player bullet approaching the reflector's bar, when the step runs, then the bullet's velocity is mirrored across the bar's normal (magnitude preserved), the bullet stays active and player-owned, and the reflector is undamaged; a later tick that bullet can still destroy an enemy.
- Given the ship's center within `REFLECTOR_CENTER_KILL_RADIUS` of a reflector's center, when the step runs, then the reflector is released to its pool and `REFLECTOR_SCORE` is credited, and no life is lost.
- Given the ship overlapping either weight (and not the center), when the step runs, then `playerState.pendingDeath` is set and the normal `PlayerDeathSystem` flow costs a life with respawn/invulnerability; the reflector is not destroyed.
- Given a telegraphing reflector (`telegraphMs > 0`), when the step runs, then it neither reflects bullets, nor is destroyed by the center, nor kills on weight contact, and its countdown decrements toward activation.
- Given the reflector pool at `REFLECTOR_MAX_ACTIVE`, when `spawn()` is called, then no new reflector is acquired.
- Given the built arena world, then the reflector spawns through the `SpawnDirector` + telegraph, is drawn from a pool, and its pool is absent from `enemyPools`/`deathPools` (immune to gunfire, bombs, and black-hole absorption).

## Spec Change Log

## Review Triage Log

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 11
- addressed_findings:
  - `[low]` `[patch]` The bullet-reflect proximity/distance gate (`MirrorReflectorSystem._interact`, the `> reflectBandSq` reject) was never exercised as a rejecter — every bullet test sits ~5px from the bar (in-band), so deleting the gate would reflect all approaching bullets arena-wide and fail nothing. Added a far-but-approaching-bullet no-reflect test (bullet 160px from the bar, moving toward it → velocity unchanged).
  - `[low]` `[patch]` The weight-kill OR-predicate's second term (the −x endpoint / weight B) was never the kill source — all three ship-lethality tests overlap the +x weight (A). Added a `shipX = 640 − REFLECTOR_BAR_HALF_LENGTH` weight-kill test so dropping the `|| (weight B)` term now fails ("either weight kills").
  - `[low]` `[patch]` The center-destroy score credit (`scoreState.score += REFLECTOR_SCORE`) was tested only from a score of 0, where `+=` and `=` are indistinguishable. Added a test that pre-seeds a nonzero run score and asserts the payout is ADDED (an overwrite regression, which would wipe the run score on every reflector kill, now fails).
  - `[low]` `[patch]` The documented `REFLECTOR_CENTER_KILL_RADIUS < REFLECTOR_BAR_HALF_LENGTH` invariant (keeps the thread-through reward zone disjoint from the lethal weights) was prose-only with no guard. Added a design-invariant test pinning it, so a post-launch tune that collapses the thread-the-needle zone fails CI.
- notes: Follow-up review pass on the `done` spec — same four review layers (adversarial, edge-case, verification-gap, intent-alignment) ran on the full baseline→HEAD diff (`33c3811..d563289`; the prior run's `final_revision` was rebased into `d563289`). All four patches are test-only verification hardening of the new code (zero production change). The one NEW deferred finding: the bullet↔bar reflect is a per-tick discrete proximity+approaching sample (no swept test), so a fast near-perpendicular bullet can step across the ~20px band in one tick and tunnel through the "immune to gunfire" bar with no bounce (≈1/3 of perpendicular approaches at default constants) — appended to the deferred-work ledger as a new entry. This is the intent's explicitly-specified reflect algorithm (an "Always" constraint inside the intent contract), so it is intent-faithful, not a deviation, and the reflector's damage-immunity contract still holds; the swept-test refinement is post-launch. Rejected findings (11) were intent-faithful design choices or non-defects: the discrete-sample tunneling routed to defer (not reject); the global-cap occupancy of up-to-3 unkillable reflectors (intent explicitly counts them toward the global cap + self-caps via `REFLECTOR_MAX_ACTIVE`); the `MAX_ACTIVE ≤ POOL_PREWARM` and spawn-avoid-to-center relations (satisfied at defaults, speculative future-tuning); the fixed-bar-normal reflect near the weight endpoints (intent specifies the fixed unit normal `(−sinθ, cosθ)`); the off-axis "safe pocket" on the inert bar (intent lethal regions are the center + two weights only); the destroy-tick-still-reflects ordering (harmless — reflect has no side effect); the direct-score-credit bypass of `ScoringSystem` (intent models it on the black-hole safe-implosion payout); the dead `REFLECTED_BULLET_HARMS_PLAYER` tunable (intent-specified default + already deferred); the `side===0` measure-zero float coincidence (subset of the tunneling defer); the black-hole-absorb assertion gap (transitively pinned — `blackHoleSystem.enemyPools` IS the same `enemyPools` array the build test already asserts the reflector pool is absent from); and the render/spawn surface-verification gaps (per-codebase-precedent manual Phaser boundaries).

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 1: (high 0, medium 0, low 1)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` A capped reflector picked by the SpawnDirector wasted the whole spawn interval (no enemy spawned despite room for other archetypes) and fired a spurious spawn SFX (`spawnCount++` on a no-op `spawn()`). Added `MirrorReflectorSystem.canSpawn()` and made `SpawnDirector._pickAndSpawn` zero the weight of any spawnable reporting `canSpawn()===false` before the weighted pick (redistributing its share; `spawnCount` stays honest; float-guard preserved) + 3 director tests.
  - `[low]` `[patch]` `reflectVelocity` allocated a fresh `{vx,vy}` per bar reflect, breaking the system's zero-steady-state-allocation (NFR2) claim. Added an optional `out` param (mirroring `closestPointOnSegment`) + a reused `_rv` scratch at the call site; added an `out`-param math test.
  - `[low]` `[patch]` The "center precedence" test was tautological — the default kill-zones are tangent (bar-half-length 48 = center-kill 18 + ship 16 + weight 14) and the motion-pass spin nudged the weight just outside, so the weight-kill predicate was false and an inverted (weight-first) precedence would pass green. Rewrote it so both predicates strictly hold at the tested position after the spin (weight-first now fails).
  - `[low]` `[patch]` The two-axis (corner) wall-bounce path was untested (single-axis only). Added a corner test asserting both `vx`/`vy` negate and `|v|` is preserved.
  - `[low]` `[patch]` The spin angle accumulated unbounded (`+=`), risking float drift over long sessions. Wrapped with `% (2π)`.
  - `[low]` `[patch]` The new reflector spawnable's base/peak weights were wired but unasserted. Added `spawnables[4].baseWeight/peakWeight` assertions to the build test.
  - `[low]` `[patch]` The "never stores a ship for its motion" test only asserted spawn succeeded (tautology). Replaced with a bit-identical-motion comparison across far-apart ship positions.
- notes: Four review layers (adversarial, edge-case, verification-gap, intent-alignment) ran on the full baseline→working diff. The one deferred finding: the `REFLECTED_BULLET_HARMS_PLAYER` tunable is defined at its harmless default but unread (no ship-vs-reflected-bullet seam) — wiring the harm-player branch is intent-deferred post-launch. Rejected findings were intent-faithful or non-defects: reflection scoped to "the bar" per FR19 (weights bullet-permeable; endpoint-normal), the deliberate center-point-thread vs weight-edge-contact difficulty asymmetry, the inert rod ("either weight"; the weight+center zones tile the bar), cross-reflector score-and-die (independent objects, each outcome earned), the missing game-over score guard (the sim is gated off at game-over — moot), and weight-kill re-arm (identical to existing contact-death respawn+invuln semantics).

## Design Notes

**Modeled on the Pinwheel, with new collision.** Drift + wall-bounce + pooling + telegraph are the exact `PinwheelSystem` pattern (rotating/negating velocity to preserve `|v|`, `dt`-driven, prewarmed pool, `pickSafeEdgePlacement`). The genuinely new code is the bullet↔bar reflect and the bespoke ship interactions — neither fits the uniform `{x,y,radius}` circle seams, which is exactly why the reflector is kept OUT of `enemyPools`/`deathPools` and handles its own bullet/ship tests.

**Reflect is stateless and jitter-free.** Using the bar's fixed unit normal `n = (−sinθ, cosθ)` avoids any divide-by-zero, and gating on `side·(v·n) < 0` (bullet approaching from its side) means a bullet reflects once and then recedes — it cannot flip every tick while overlapping. `FiringSystem` (earlier in the tick) integrates the reflected bullet away next tick. Reflected bullets are the same pooled player bullets, so "still destroys enemies" and "harmless to the player" both hold by construction — no new seam.

**Weight-kill reuses Story 6.2's `pendingDeath`.** A weight contact sets the shared `playerState.pendingDeath`, consumed read-and-clear by `PlayerDeathSystem` through the normal death flow (respects invuln/game-over, one death per tick). This is the second producer of that flag (the black-hole detonation is the first) — the same minimally-extended seam, not a reimplemented death path. Placing `MirrorReflectorSystem` before `PlayerDeathSystem` (in the enemy section) makes the flag consumed the same tick, exactly like `BlackHoleSystem`.

**Hazard-payout, not multiplier kill.** The center-destroy credits a flat `REFLECTOR_SCORE` directly to `scoreState.score` (no multiplier, no `killedEnemies`), mirroring the black-hole safe-implosion payout — the reflector is a hazard, not a swarm enemy scored through `ScoringSystem`.

**Center precedence + self-cap are deliberate corner rules.** Center-destroy winning a simultaneous weight overlap rewards threading the needle (and `REFLECTOR_CENTER_KILL_RADIUS < REFLECTOR_BAR_HALF_LENGTH` keeps the zones disjoint in the common case). Because the reflector is immune to fire and bombs, `REFLECTOR_MAX_ACTIVE` (enforced in `spawn()`) stops it accumulating unboundedly, since the director has only a global cap.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `mirrorReflectorMath.test.js` and `mirrorReflectorSystem.test.js` and the updated `buildArenaWorld`/`renderIntegration` suites.
- `npm run build` -- expected: production build succeeds (no dangling references).

**Manual checks (Phaser render — not unit-testable, per codebase precedent):**
- `npm run dev`: a spinning dumbbell telegraphs in and drifts/bounces around the arena. Firing at it bounces bullets off the bar (which can then hit other enemies) and never damages it. Flying the ship through the exact center pops it for a score jump; grazing either weight kills the ship with the normal respawn/multiplier reset.

## Auto Run Result

Status: done (follow-up review pass on a `done` spec)

**Summary of change (this pass):** A fresh four-layer review of the shipped Story 6.3 (Mirror Reflector / dumbbell hazard) over the full baseline→HEAD diff (`33c3811..d563289`). The simulation logic was found faithful to the intent; the pass added four test-only verification-gap hardenings (zero production-code change) and recorded one new deferred design refinement. No `intent_gap` or `bad_spec` — no code re-derivation loopback.

**Files changed:**
- `src/systems/mirrorReflectorSystem.test.js` — +4 tests: far-but-approaching bullet no-reflect (pins the proximity/distance gate), −x-endpoint weight-kill (pins the "either weight" OR branch), nonzero-prior-score center-destroy (pins the additive `+=` credit vs an overwrite), and a `CENTER_KILL_RADIUS < BAR_HALF_LENGTH` design-invariant guard.
- `_bmad-output/implementation-artifacts/deferred-work.md` — +1 new entry: the discrete-sample bullet-tunneling refinement.
- `_bmad-output/implementation-artifacts/spec-6-3-mirror-reflector-dumbbell-hazard.md` — status/frontmatter + new triage-log entry + this result.

**Review findings breakdown:** patch 4 (low 4) applied; defer 1 (medium 1) — bullet-tunneling, appended to the ledger as a new entry; reject 11 (intent-faithful design choices, harmless orderings, measure-zero float, transitively-pinned invariants, per-precedent manual render boundaries). intent_gap 0, bad_spec 0.

**Follow-up review recommendation:** `false`. Patched findings this pass: high 0, medium 0, low 4 → no high patched; score = 3×0 + 1×4 = 4 (< 5).

**Verification performed:**
- `npm test` — PASS (49 files, 756 tests; `mirrorReflectorSystem.test.js` 24→28).
- `npm run build` — PASS (production build succeeded, no dangling references).

**Residual risks / artifacts:**
- Deferred (not fixed this pass): fast near-perpendicular player bullets can tunnel through the reflect band un-bounced (≈1/3 of perpendicular approaches at default constants). The reflector's core damage-immunity contract still holds; only the bounce feel degrades. It is the intent's explicitly specified proximity+approaching reflect algorithm, so it is intent-faithful and left for a post-launch swept-test refinement.
- Residual artifact (left uncommitted, orchestrator-owned): `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified before this run started; not part of the reviewed diff).

