---
title: 'Story 11.2 — Seeker Drones'
type: 'feature'
created: '2026-07-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: 'ab2a77f298f9771afb4ca9a58a8b02cb6f5b0e89'
final_revision: '4665df1322b4325655d6bc6161de82274c6674a9'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Epic 11's second exotic item. Seeker Drones are autonomous shooters that orbit the ship and fire at the nearest enemy on their own cadence — the "threats behind me are handled" answer. Unlike Orbit Blade (a contact sweep), the drones introduce **two** new pooled systems that must both hold zero per-frame allocation: the drones themselves and their projectiles, which at Lv4 home. Peak density is 5 drones live at once (Lv5), the NFR11 stress bar alongside the 5 blades.

**Approach:** Register `seeker-drones` as a data-driven offense item (like Orbit Blade), add four fold fields to `PlayerStats`, and add one new `SeekerDroneSystem` that owns a drone pool + a drone-shot pool. Drones ride an evenly-spaced ring around the ship; each fires a pooled shot at the nearest live combat enemy every folded period; shots fly straight (Lv1–3) or re-aim toward the nearest enemy each step (Lv4+ homing); every shot↔enemy hit routes through the shared `CollisionSystem.applyPlayerDamage` seam so armor/scoring/XP/kill-latches behave exactly as for a bullet. Registered immediately after `OrbitBladeSystem` and before `ScoringSystem`, the same load-bearing slot.

## Boundaries & Constraints

**Always:**
- Every drone-shot hit routes through `collisionSystem.applyPlayerDamage(enemy, ownerPool, damage)` — never by decrementing `hp` or releasing the enemy directly. Drone shots are PROJECTILES, so the armored archetype (finite `hp`) resists them exactly as it resists bullets (this is intended — drones are not on the melee/AoE full-damage list).
- Drones and drone shots are BOTH object-pooled with fixed prewarmed pools; the steady-state path (position, home, integrate, collide, fire-at-cadence) allocates nothing per fixed step — reuse hoisted collectors + length-reset scratch arrays (the CollisionSystem/OrbitBladeSystem convention).
- Derived parameters (count, per-shot damage, fire period, homing flag) live ONLY in the folded `PlayerStats` store; the live drone pool, shot pool, per-drone fire accumulators, and rotation phase are RUNTIME state on `SeekerDroneSystem` (the fold resets and re-derives the whole store on every card pick — a live timer kept there would be reset by picking any unrelated item).
- Sanitize every fold read: a null/missing store, missing field, or junk (NaN, Infinity, negative, fractional, absurdly large) resolves to a safe base — count → 0 (no drones, exactly the pre-11.2 behavior), damage/period → the authored base constant, homing → off. Count is clamped to `SEEKER_DRONE_MAX_COUNT`.
- Scope the target scan and the collision to `enemyPools` (the five COMBAT archetypes), never `deathPools` (Black Hole / Mirror Reflector are out of scope — the same scoping DashSystem/OrbitBladeSystem use). Skip a telegraphing enemy (`telegraphMs > 0`) as both a target and a hit.
- Live shot count stays bounded: shots expire when they leave the arena OR reach `SEEKER_DRONE_SHOT_LIFETIME_MS` (the lifetime cap is load-bearing — a homing shot that never connects would otherwise never leave the arena).
- Per-level `stats` maps are TOTALS-at-that-level (restate every field the item still grants), never deltas.

**Block If:**
- The registration slot after `OrbitBladeSystem` / before `ScoringSystem` cannot be honored (e.g. an unexpected refactor removed the slot) — a drone kill outside it is either dropped from the reset kill-latches or never scored.

**Never:**
- Do NOT feed drone shots into the FiringSystem bullet pool or make CollisionSystem homing-aware — the shots are their own pooled type with their own advance/collide, so the shared v1 firing/collision code is untouched.
- Do NOT implement Swarm Protocol (the Lv5+Nanite-Shield-Lv3 fusion), ram-kill/respawn, or mini-drone spawning — those are Epic 12; this story only registers the fusion metadata.
- Do NOT give the drones themselves a contact-damage sweep — only their shots deal damage.
- No new selection/draft UX — the card surfaces through the existing level-up flow unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / null store | `seekerDroneCount` 0 or no store | No drones, no shots, no target scan; identical to pre-11.2 | No throw |
| Lv1 owned, one enemy present | count 1, period 1500, dmg 3 | 1 drone on the ring; fires ~every 1.5s a shot toward the enemy; shot hit → `applyPlayerDamage` kills it (unarmored) or chips it (armored) | — |
| No live enemy | count ≥ 1, empty enemyPools | Drones hold fire (no target); no shot spawned; no throw | Fire accumulator does not overflow unbounded |
| Lv4 homing, target moves | homing 1, shot in flight | Shot re-aims toward the nearest live enemy each fixed step at constant speed | If no target, shot keeps its current velocity |
| Junk fold values | count 1e9 / dmg NaN / period -5 | count → clamped to `SEEKER_DRONE_MAX_COUNT`; dmg → base; period → base | No throw, no NaN position, no unbounded loop |
| Two drone shots over one enemy same tick | 2 shots overlap same enemy | Enemy hit at most once this tick (one shot consumed); the other stays live | No double-release |
| Level DROP (remnant / unowned) | count 5 → 2 | Surplus drones released to the pool; live set clamps to 2 | Release via materialized snapshot, never mid-iteration |
| Homing shot never connects | homing shot circling | Expires at `SEEKER_DRONE_SHOT_LIFETIME_MS` | Live shot count stays bounded |

</intent-contract>

## Code Map

- `src/config/itemRegistry.js` -- add the frozen `seeker-drones` offense entry (5 levels, guarantee null, fusion → swarm-protocol via nanite-shield).
- `src/config/constants.js` -- new "Seeker Drones" section: ring/feel geometry, shot speed/radius/lifetime, base damage/period, max-count + prewarm safety guards, colours.
- `src/state/PlayerStats.js` -- add `seekerDroneCount`/`seekerDroneDamage`/`seekerDronePeriodMs`/`seekerDroneHoming` (all base 0) to `PLAYER_STATS_BASE` with field comments.
- `src/entities/SeekerDrone.js` -- **new** pooled-drone factory `createSeekerDrone()` → `{ x, y, radius, fireAccumMs }` (plain data, Phaser-free), mirroring `OrbitBlade.js`.
- `src/entities/DroneShot.js` -- **new** pooled-shot factory `createDroneShot()` → `{ x, y, vx, vy, radius, damage, homing, ageMs }`, mirroring `Bullet.js` (system stamps every field on spawn).
- `src/systems/SeekerDroneSystem.js` -- **new** system: owns the drone `Pool` + the shot `Pool`; syncs drone count to the fold, rotates + positions drones on the ring, runs per-drone fire cadence at the nearest enemy, advances shots (homing re-aim for Lv4+), and sweeps shot↔enemy through `applyPlayerDamage`. Templates: `OrbitBladeSystem.js` (count sync + ring + fold sanitizers), `FiringSystem.js` (spawn cadence + shot integrate/expire), `CollisionSystem.js` (`applyPlayerDamage` + hit-once guard), `EnemySystem.js` (homing model).
- `src/scenes/buildArenaWorld.js` -- construct + register `SeekerDroneSystem` after `orbitBladeSystem`, before `scoringSystem`; add to the returned handle; bump the "28 systems" comment to 29.
- `src/scenes/ArenaScene.js` -- add `seekerDroneGraphics` + `droneShotGraphics`, assign `this.seekerDroneSystem`, join the additive-blend neon list, and clear+redraw a filled dot per active drone and per active shot each frame (the `orbitBladeGraphics` pattern).
- `src/config/itemRegistry.test.js` -- extend `EXPECTED_IDS`, `getItemsByTrack('offense')`, and pin the seeker-drones fusion.
- `src/state/playerStats.test.js` -- add a seeker-drones fold test (rungs 1..5 → exact fields).
- `src/scenes/buildArenaWorld.test.js` -- update the canonical count (28→29) + order list; the load-bearing-slot + returned-handle assertions.
- `src/systems/seekerDroneSystem.test.js` -- **new** headless suite (see Acceptance).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the "Seeker Drones (Story 11.2 / PRD §13.3)" section. Suggested values (tunable feel / safety guards, framed like the Orbit Blade block): `SEEKER_DRONE_ORBIT_RADIUS = 72`, `SEEKER_DRONE_RADIUS = 8`, `SEEKER_DRONE_ROTATE_PERIOD_MS = 4000` (slow decorative ring spin), `SEEKER_DRONE_SHOT_RADIUS = 5`, `SEEKER_DRONE_SHOT_SPEED = 700`, `SEEKER_DRONE_SHOT_LIFETIME_MS = 3000`, `SEEKER_DRONE_BASE_DAMAGE = 3`, `SEEKER_DRONE_BASE_PERIOD_MS = 1500`, `SEEKER_DRONE_MAX_COUNT = 8` (safety clamp; shipped max 5), `SEEKER_DRONE_POOL_PREWARM = SEEKER_DRONE_MAX_COUNT`, `SEEKER_DRONE_SHOT_POOL_PREWARM = 64`, `COLOR_SEEKER_DRONE = 0x33ffaa`, `COLOR_DRONE_SHOT = 0x66ffcc`. Mark the `*_MAX_*` / `*_BASE_*` / lifetime values as SAFETY guards, not balance levers.
- `src/state/PlayerStats.js` -- add the four fields to `PLAYER_STATS_BASE` (all base 0: three additive/count fields + the `seekerDroneHoming` flag) with the "derived params only; live pool/timers on the system" comment.
- `src/config/itemRegistry.js` -- add the frozen `seeker-drones` entry. Levels (each `stats` map is the TOTAL at that level; `desc` from PRD §13.3, never rewritten):
  - L1 `'1 drone / fires every 1.5s'` → `{ seekerDroneCount: 1, seekerDroneDamage: 3, seekerDronePeriodMs: 1500 }`
  - L2 `'2 drones'` → `{ seekerDroneCount: 2, seekerDroneDamage: 3, seekerDronePeriodMs: 1500 }`
  - L3 `'3 drones / +40% fire rate'` → `{ seekerDroneCount: 3, seekerDroneDamage: 3, seekerDronePeriodMs: 1071 }` (1500 ÷ 1.4 ≈ 1071)
  - L4 `'4 drones / homing shots'` → `{ seekerDroneCount: 4, seekerDroneDamage: 3, seekerDronePeriodMs: 1071, seekerDroneHoming: 1 }`
  - L5 `'5 drones / +60% damage'` → `{ seekerDroneCount: 5, seekerDroneDamage: 4.8, seekerDronePeriodMs: 1071, seekerDroneHoming: 1 }` (3 × 1.6 = 4.8)
  - `guaranteeFromLevel: null`; `fusion: { partner: 'nanite-shield', epic: 'swarm-protocol' }`.
- `src/entities/SeekerDrone.js` -- **new** factory `createSeekerDrone()` → `{ x: 0, y: 0, radius: SEEKER_DRONE_RADIUS, fireAccumMs: 0 }`; the system overwrites `x/y` each step and seeds `fireAccumMs` (staggered) on acquire.
- `src/entities/DroneShot.js` -- **new** factory `createDroneShot()` → `{ x:0, y:0, vx:0, vy:0, radius: SEEKER_DRONE_SHOT_RADIUS, damage: SEEKER_DRONE_BASE_DAMAGE, homing: 0, ageMs: 0 }`; every field stamped by the system on spawn (same stale-carry-over warning as Bullet.js).
- `src/systems/SeekerDroneSystem.js` -- **new** `SeekerDroneSystem extends System`, constructed `(ship, enemyPools, collisionSystem, playerStats = null)`. `fixedUpdate(dt)` order: (1) sync drone count to the sanitized fold (acquire from prewarm while short; release the surplus via a materialized snapshot while long; seed a fresh drone's `fireAccumMs` staggered across `[0, period)` so drones don't all fire the same tick); (2) advance the rotation phase and reposition every live drone evenly on the ring around the ship (mutate `x/y` in place; guard a null ship); (3) materialize the combat enemies (+ owners) once, skipping telegraphing ones, into hoisted scratch; (4) advance each live shot — for a homing shot (`shot.homing >= 1`) re-point velocity toward the nearest materialized enemy at `SEEKER_DRONE_SHOT_SPEED` (EnemySystem model; keep current velocity if no target), integrate, bump `ageMs`, collect for release if off-arena or past `SEEKER_DRONE_SHOT_LIFETIME_MS`; (5) sweep live shots vs the materialized enemies — a shot overlapping an as-yet-unhit enemy this tick routes ONE `applyPlayerDamage` and is consumed (hit-once-per-enemy guard, like CollisionSystem); (6) per drone, accumulate `dt` into `fireAccumMs`, and while `>= period` and a target exists, spawn a pooled shot from the drone toward the nearest enemy (stamp all fields; `homing` from the fold), decrement by `period`; clamp the accumulator so a target-less drone can't bank unbounded credit. Add fold sanitizers `_count()`/`_damage()`/`_periodMs()`/`_homing()` mirroring OrbitBladeSystem. Zero per-tick allocation on the steady path.
- `src/scenes/buildArenaWorld.js` -- import + construct `SeekerDroneSystem(ship, enemyPools, collisionSystem, playerStats)` immediately after `orbitBladeSystem` and before `scoringSystem`; `world.addSystem` it; expose it on the returned arena handle; bump the "28 systems" header comment to 29 with the same slot rationale as Orbit Blade.
- `src/scenes/ArenaScene.js` -- import the two colours; read `this.seekerDroneSystem = arena.seekerDroneSystem`; add `this.seekerDroneGraphics` + `this.droneShotGraphics`; include both in the additive-blend neon layer list; in the render pass clear+`fillCircle` a `COLOR_SEEKER_DRONE` dot per active drone and a `COLOR_DRONE_SHOT` dot per active shot (the `orbitBladeGraphics` block pattern; reads sim state only).
- `src/systems/seekerDroneSystem.test.js` -- **new** headless vitest suite covering the Acceptance below.
- `src/state/playerStats.test.js`, `src/config/itemRegistry.test.js`, `src/scenes/buildArenaWorld.test.js` -- extend per the Code Map (fold rungs, registry id/track/fusion, 28→29 count + order + slot/handle wiring).

**Acceptance Criteria:**
- Given an unowned build (count 0) or a null store, when the system runs for many fixed steps, then no drone and no shot is ever active, no enemy is touched, and it never throws (the pre-11.2 path).
- Given Lv1 with one enemy present, when the system runs, then exactly one drone rides the ring at `SEEKER_DRONE_ORBIT_RADIUS`, and within ~1.5s of sim time it spawns a shot toward the enemy that, on overlap, routes through `applyPlayerDamage` and kills the (unarmored) enemy — with the kill scored and reported in `collisionSystem.killedEnemies` / `bulletKillCount`.
- Given Lv3, when the drone count is read, then three drones are live and the fire period is 1071 ms (the +40% rate); given a level RISE 1→5 mid-run, then five drones are reached with no factory allocation (prewarmed) and a level DROP releases the surplus back to the pool.
- Given Lv4 (homing) and a target that moves after the shot is fired, when the shot advances, then its velocity re-points toward the nearest live enemy each step; given no live enemy, the shot keeps its current velocity and expires at the lifetime cap.
- Given the armored archetype (finite `hp`), when a Lv1 drone shot hits it, then `applyPlayerDamage` decrements its `hp` (projectile — resisted) rather than one-shotting it; the shot is consumed.
- Given junk fold values (count 1e9, damage NaN, period ≤ 0), when the system runs, then count clamps to `SEEKER_DRONE_MAX_COUNT`, damage/period fall back to the base constants, no NaN position is produced, and the fixed step never hangs.
- Given two drone shots overlapping one enemy on the same tick, when the sweep resolves, then the enemy is hit at most once (one shot consumed, no double-release) and the other shot stays live.
- Given 5 drones firing plus many in-flight shots and many enemies, when the system runs a stress loop, then the steady path allocates nothing per fixed step (pool active+free totals stay constant across ticks with no spawn/despawn churn beyond the pools) and the live shot count stays bounded.
- Given the factory build, when `buildArenaWorld` runs, then it registers 29 systems in the canonical order with `SeekerDroneSystem` immediately after `OrbitBladeSystem` and before `ScoringSystem`, scoped to `enemyPools` (not the reflector/black-hole pools), with the shared `collisionSystem`/`ship`/`playerStats` handles.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 2: (high 0, medium 0, low 2)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` `_periodMs()` had no floor clamp — a tiny-positive corrupted period burst-fired shots per tick. Added `SEEKER_DRONE_PERIOD_FLOOR_MS` (100) + clamp, making the "always bounded" docstring true, with a bounded-per-tick-spawn test.
  - `[medium]` `[patch]` Wall-hugging drones (ring radius 72 vs ship clamp 40 from border) spawned shots outside the arena that despawned next tick. Clamp the shot spawn origin into the arena interior and aim from the clamped origin; test that a wall-pressed drone still lands a hit.
  - `[low]` `[patch]` Step-6 fire path lacked the null-ship guard the reposition path has. Gated firing on `ship` so a null ship is a clean no-op.
  - `[low]` `[patch]` Added a test pinning the per-drone `fireAccumMs` stagger (fresh Lv5 → distinct accumulators spread across `[0, period)`), so a revert to 0-seed fails CI.
  - `[low]` `[patch]` Added a test for the off-arena shot despawn (`isOutsideArena`) path — previously only the lifetime cap was exercised.

### 2026-07-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` No test proved a REAL Lv4/Lv5 fired shot carries the folded `homing` flag / 4.8 damage — every homing/damage test injected a hand-stamped shot, so a step-6 regression dropping `shot.homing = homing` (Lv4 flies straight) or mis-stamping damage (Lv5 deals 3, not 4.8) would ship green. Added a fold→fire test that primes a real drone to fire and asserts `fired.homing === 1` and `fired.damage ≈ 4.8`.
  - `[low]` `[patch]` `_nearestEnemy` selection was only ever exercised with a single candidate, so a flipped comparison (target the FARTHEST enemy) stayed green. Added two symmetric two-enemy homing re-aim tests (near-right vs far-left, and swapped).
  - `[low]` `[patch]` Off-arena shot expiry was tested on the RIGHT border only. Parameterized the expiry test across all four borders so a sign/bound error in any `isOutsideArena` branch fails.
  - Note: the stale-`_nearestEnemy` corpse-targeting finding and the missing hard live-shot-cap finding were re-raised this pass but are ALREADY logged in the deferred-work ledger by the prior pass (orchestrator-owned) — not re-opened. A tentative `_hitEnemies`-skip fix for the former was prototyped and then reverted after the ledger's recorded analysis confirmed it is unsafe (`_hitEnemies` also holds armored survivors, so the skip would make drones abandon live armored enemies).

### 2026-07-24 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The per-level fire CADENCE was verified only as a folded VALUE (playerStats/registry suites); nothing exercised step-6's `while (fireAccumMs >= period)` gate, so a regression flattening or mis-scaling the rate (e.g. Lv3 firing at the base 1500ms instead of the +40% 1071ms, or firing every tick) shipped green — the only timing test ("kills within ~1.5s") passes for any period up to ~2.9s. Added a cadence test that measures ticks-to-first-shot from a zeroed accumulator for Lv1 and Lv3 and pins each effective period to within one tick, plus asserting Lv3 is strictly faster.
  - `[medium]` `[patch]` No-pierce was proved only for two shots over ONE enemy (the per-enemy hit-once guard); no test put ONE shot over TWO enemies, so deleting the sweep `break` (turning every shot into a piercing multi-hit projectile) would ship green. Added a one-shot/two-coincident-enemies test asserting exactly one dies, the other survives, and the shot is consumed once with no pool-size drift.
  - `[low]` `[patch]` The decorative ring rotation was untested — geometry tests call `fixedUpdate` once and the moving-ship test only re-checks radius, so deleting the `_phaseRad` advance froze the ring with nothing failing. Added a rotation test that runs a stationary-ship Lv1 build for K ticks and asserts the drone's angle advances by the analytical `2π·DT/ROTATE_PERIOD_MS · K`.

## Design Notes

**Why drone shots are their own pooled type, not FiringSystem bullets.** Bullets fly straight and are owned/advanced by FiringSystem and consumed by CollisionSystem. Drone shots spawn from drones (not the ship nose), carry a different damage, and at Lv4 HOME — which needs per-shot target tracking each tick. Folding homing into the shared bullet pool would make two load-bearing v1 systems homing-aware for one item. The epic's stated pattern is "drones and their shots" as their own per-type pools, so `SeekerDroneSystem` owns both and does its own integrate + collide, leaving FiringSystem/CollisionSystem byte-unchanged.

**Registration slot mirrors OrbitBladeSystem/DashSystem exactly** — after `CollisionSystem` (its per-tick kill latches are already RESET this tick, so drone kills land in the fresh arrays) and before `ScoringSystem` (so a drone kill is SCORED and produces the full kill feedback — XP orb, ripple, spray, SFX). `applyPlayerDamage` increments `bulletKillCount`/`bulletDamageCount` and appends the parallel x/y/xp snapshots, so drone kills flow through scoring/DPS/XP identically to bullets. Consequence: a card picked this tick folds later this tick, so a level change is visible on the NEXT tick — the accepted one-tick lag.

**Homing model = EnemySystem.** A homing shot re-points its velocity toward the nearest live enemy each fixed step at constant `SEEKER_DRONE_SHOT_SPEED` (the exact per-tick re-aim EnemySystem uses to home a Blue Seeker onto the ship): `dx/dy` to target, normalize, scale by speed. Full re-point (not turn-rate-limited) is the proven zero-alloc pattern; turn-rate limiting is a later tuning option. The lifetime cap is what bounds a homing shot that keeps chasing without connecting.

**Damage magnitude is a tunable placeholder.** PRD §13.3 / epics.md give the drone COUNT and the relative rungs (+40% rate, homing, +60% dmg) but no absolute per-shot damage — the same way Orbit Blade's exact feel numbers were authored in-story. `SEEKER_DRONE_BASE_DAMAGE = 3` (Lv5 → 4.8, the honest ×1.6) is a balance placeholder framed like the other Orbit Blade constants; the fold and acceptance tests pin the numbers so a retune stays in one place. Drone shots are projectiles and are therefore resisted by the armored archetype — intended, and the reason the base sits low.

**Per-drone fire stagger.** Each drone carries its own `fireAccumMs`; a freshly acquired drone is seeded a staggered offset across `[0, period)` so growing the count doesn't make all drones fire the same tick (a visible burst). The stagger is deterministic (index-based, no rng), so a headless run is reproducible.

## Verification

**Commands:**
- `npx vitest run src/systems/seekerDroneSystem.test.js src/state/playerStats.test.js src/config/itemRegistry.test.js src/scenes/buildArenaWorld.test.js` -- expected: all pass (new suite + the three extended suites green).
- `npx vitest run` -- expected: the full suite stays green (no regression in FiringSystem/CollisionSystem/OrbitBlade or the fold).
- `npm run build` -- expected: production build succeeds (no import/const wiring errors).

## Auto Run Result

Status: done (follow-up review pass 2)

**Summary of change:** A follow-up review pass over the already-shipped Seeker Drones story (Story 11.2). No production behavior was changed — the four review layers (adversarial, edge-case, verification-gap, intent-alignment) surfaced no intent gap and no spec deviation. The intent-alignment audit confirmed the implementation faithfully realizes the task-list-sanctioned readings. The pass closed three verification gaps in the story's own test suite (all test-only additions to `seekerDroneSystem.test.js`).

**Files changed:**
- `src/systems/seekerDroneSystem.test.js` — added a fire-cadence test (Lv1 ~1500ms vs Lv3 ~1071ms, +40% rung pinned to within one tick), a no-pierce test (one shot over two coincident enemies → exactly one dies, shot consumed once), and a ring-rotation test (`_phaseRad` advance verified against `2π·DT/ROTATE_PERIOD_MS`); added the `SEEKER_DRONE_ROTATE_PERIOD_MS` import.

**Review findings breakdown:**
- Patches applied (3): fire-cadence coverage (medium), no-pierce coverage (medium), ring-rotation coverage (low).
- Deferred (0 new): the stale-`_nearestEnemy` corpse-targeting and missing hard live-shot-cap findings were re-raised but are ALREADY in the deferred-work ledger (orchestrator-owned); not re-opened, not re-added.
- Rejected (9): straight-shot target leading (intent specifies straight for Lv1–3), homing turn-rate/range limit (Design Notes: intentional full re-point), multi-drone single-target DPS scaling (out of scope), mag==0 arbitrary-downward shot (rare degenerate, self-expiring), missing scoring-integration test (regression already guarded by the slot-order + kill-latch assertions), 5-drone floor pool test (tied to the already-deferred no-cap topic), reroll magic-RNG-seed brittleness (pre-existing, speculative), render-path pool-name coupling (matches the existing `orbitBladeGraphics` convention), prewarm-comment completeness (documentation of the already-deferred no-cap topic).

**Follow-up review recommendation:** true. This pass patched 0 high, 2 medium, 1 low; score = 3×2 + 1×1 = 7 (≥ 5).

**Verification performed:**
- `npx vitest run src/systems/seekerDroneSystem.test.js` — 61 passed (3 new).
- `npx vitest run src/systems/seekerDroneSystem.test.js src/state/playerStats.test.js src/config/itemRegistry.test.js src/scenes/buildArenaWorld.test.js` — 203 passed.
- `npx vitest run` — full suite 1831 passed (71 files).
- `npm run build` — production build succeeded.

**Residual risks:** None from this pass (test-only additions). The two ledgered items (per-tick stale enemy snapshot causing one-tick corpse-targeting; no structural hard cap on live shots under the clamped-max + floored-period corruption corner) remain open in the deferred-work ledger for orchestrator disposition — both argued as low-impact and both un-exercised by the current tests by design.

**Residual artifacts (not part of this change, left in place):** `_bmad-output/implementation-artifacts/sprint-status.yaml` (pre-existing working-tree modification, orchestrator-owned).
