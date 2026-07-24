---
title: 'Story 11.4 — Piercing Lance'
type: 'feature'
created: '2026-07-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'cdf4ac4d21876ce2a697d9d13be514c1b4346668'
final_revision: '0876c2e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Epic 11's fourth exotic offense item and the first PIERCING projectile. Piercing Lance auto-fires a slow, heavy bolt on a cadence that punches THROUGH a line of enemies (pierce 2 → 7), so dense columns clear in one shot. Unlike Seeker Drones (a light homing shot consumed on first hit) or the base bullet (one bullet = at most one kill), a lance bolt survives each hit and continues, deals a heavier per-hit damage, and at higher levels leaves a 0.5s damage trail and fires a second bolt backward. It is the epic's next pooled projectile system and must stay inside the NFR11 pooling budget with zero per-frame allocation on the steady path.

**Approach:** Register `piercing-lance` as a data-driven offense item, add five fold fields to `PlayerStats`, and add one new `PiercingLanceSystem` that owns its own bolt pool (and, for Lv4+, a small trail-node pool) — a self-contained system mirroring `SeekerDroneSystem`/`MineLayerSystem`, deliberately NOT reusing the shared `FiringSystem` bullet pool or `CollisionSystem`'s one-hit-per-bullet contract. Each fixed step it materializes the combat enemies, advances/collides live bolts (piercing up to `pierce` distinct enemies, each hit routed through the shared `collisionSystem.applyPlayerDamage` seam so armor/scoring/XP/kill-latches behave exactly as for a bullet), ages/expires trail nodes and applies their damage, and fires bolts on the folded cadence FROM the ship TOWARD the nearest combat enemy (Lv5 also fires the antipodal bolt). Registered immediately after `MineLayerSystem` and before `ScoringSystem` — the same load-bearing slot.

## Boundaries & Constraints

**Always:**
- Every lance hit (bolt or trail node) routes through `collisionSystem.applyPlayerDamage(enemy, ownerPool, damage)` — never by decrementing `hp` or releasing the enemy directly. A lance bolt is a PROJECTILE, so the armored archetype (Story 9.3) resists it exactly as it resists a bullet — soaking whole hits of the stamped damage. This is intentional: Piercing Lance is NOT on the melee/AoE full-damage list (Orbit Blade, mine detonations, Flak fragments are). Its damage still one-shots armored at Lv3+ purely by MAGNITUDE (folded `lanceDamage` 6 > `ARMORED_HP` 5), not by classification.
- Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools` — the Black Hole and the Mirror Reflector are out of scope, the same scoping `SeekerDroneSystem`/`MineLayerSystem`/`OrbitBladeSystem` use. A telegraphing (spawning-in) enemy (`telegraphMs > 0`) is never a target NOR a hit.
- A single bolt hits each distinct enemy AT MOST ONCE over its whole flight (a per-bolt hit set, cleared on spawn), consuming one of its `pierce` charges per distinct enemy; when its pierce charges are exhausted the bolt is released. A trail node likewise hits each distinct enemy at most once (a per-node hit set).
- All lance entities are object-pooled with fixed prewarmed pools; the steady-state path (materialize, advance, collide, age, fire) allocates nothing per fixed step — reuse hoisted collectors + length-reset scratch arrays + reused per-entity Sets (the `CollisionSystem`/`SeekerDroneSystem` convention). Live trail-node count is hard-bounded by `LANCE_TRAIL_NODE_MAX` (oldest evicted past the cap).
- Derived parameters (fire period, pierce count, per-bolt damage, trail flag, backward flag) live ONLY in the folded `PlayerStats` store; the live bolt/trail pools and the fire accumulator are RUNTIME state on `PiercingLanceSystem` (the fold resets and re-derives the whole store on every card pick — a live timer/pool kept there would be reset by picking any unrelated item).
- Firing requires a target: fire FROM the ship TOWARD the nearest combat enemy. With no combat enemy present, HOLD FIRE and clamp the fire accumulator to one period so no backlog banks (fires the instant a target appears) — the `SeekerDroneSystem` target-less convention. A `null` `playerStats` store, a period of 0, or a `null` ship means NO bolts ever (exactly the pre-11.4 behavior).
- Each fold field is sanitized against a corrupted store before use, mirroring `MineLayerSystem`'s sanitizers: period 0/junk → unowned gate else floored to `LANCE_PERIOD_FLOOR_MS`; pierce clamped to an integer in `[1, LANCE_MAX_PIERCE]` (junk → `LANCE_BASE_PIERCE`); damage positive-finite (junk → `LANCE_BOLT_BASE_DAMAGE`); trail/backward flags enabled only by a finite value `>= 1`.

**Block If:** none — the level curve, the auto-target direction, the damage values, and the trail model are all resolved here.

**Never:**
- Never modify `FiringSystem`, the shared `Bullet` pool, or `CollisionSystem`'s bullet↔enemy resolution to make the base bullet pierce. The lance is a separate pooled type; the v1 firing/collision code stays byte-unchanged.
- Never let a bolt re-hit an enemy it has already hit, and never let pierce charges be spent twice on the same enemy across ticks.
- Never keep the live bolt pool, the trail-node pool, or the fire accumulator on the `PlayerStats` store.
- Not in scope: the Railgun fusion behavior (Epic 12 owns the fusion consumption; this story only registers the `fusion: { partner: 'overcharge', epic: 'railgun' }` metadata), any render/VFX/audio beyond what the shared kill feedback already produces, and any change to the armored damage model.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owned, target present | Lv1 owned, one combat enemy in arena, period elapses | One bolt spawns from ship toward the enemy; on overlap the (unarmored) enemy is killed via `applyPlayerDamage`; bolt survives (pierce 2) and continues | No error expected |
| Piercing a column | Lv2 owned (pierce 4), 5 unarmored enemies in a line ahead | Bolt kills the first 4 it overlaps (each once) then is released; the 5th survives | No error expected |
| Armored hits-to-kill | Lv1 (dmg 4) vs one armored enemy (hp 5) | Bolt deals 4, armored survives (hp 1), bolt continues; a later Lv3 (dmg 6) bolt one-shots armored | No error expected |
| No target | Owned, arena empty of combat enemies | No bolt fires; accumulator clamped to one period; the tick a combat enemy appears, a bolt fires immediately (no backlog burst) | No error expected |
| Trail (Lv4) | Lv4 owned (trail on), bolt passes a stationary enemy | Trail nodes dropped along the path damage the enemy within the 0.5s window even after the bolt has passed; after `LANCE_TRAIL_LIFETIME_MS` the nodes expire and stop damaging | No error expected |
| Backward (Lv5) | Lv5 owned, one target ahead | Two bolts fire per cadence — one toward the target, one antipodal (backward) — each full pierce/damage/trail | No error expected |
| Unowned / corrupt store | `playerStats` null, or `lancePeriodMs` 0/NaN/negative | No bolts ever spawn; system is inert | Sanitizers fail safe to the unowned gate |
| Over-cap trail nodes | Many trail nodes live (Lv5, multiple bolts) | Live node count never exceeds `LANCE_TRAIL_NODE_MAX`; oldest node evicted before a new drop past the cap | No error expected |

</intent-contract>

## Code Map

- `src/config/itemRegistry.js` -- ITEM_REGISTRY (offense items before the `// --- Defense ---` marker); add the `piercing-lance` def after `mine-layer`. Mirror `orbit-blade`/`mine-layer` shape exactly (direct per-level `stats` totals).
- `src/state/PlayerStats.js` -- `PLAYER_STATS_BASE`; add the five lance fold fields next to the `mine*` fields. The generic `recomputePlayerStats` fold picks them up with no per-item code (additive onto base 0).
- `src/config/constants.js` -- add the `LANCE_*` constants (speed, radius, floor/base/max pierce, base damage, pool prewarm, trail lifetime/cadence/radius/damage/cap). Anchor values to existing siblings (`SEEKER_DRONE_SHOT_SPEED` 700, `BULLET_RADIUS` 4, `MINE_DROP_PERIOD_FLOOR_MS` 100, `ARMORED_HP` 5, `MINE_MAX_CAP` 16).
- `src/entities/LanceBolt.js` -- NEW pooled bolt entity factory `createLanceBolt()`. Mirror `src/entities/DroneShot.js` (stamp-every-field-on-spawn; `Pool.release` resets nothing).
- `src/entities/LanceTrailNode.js` -- NEW pooled trail-node factory `createLanceTrailNode()`. Same stamp-on-drop convention.
- `src/systems/PiercingLanceSystem.js` -- NEW system. Mirror `src/systems/MineLayerSystem.js` (pool prewarm, hoisted `_enemies`/`_owners` collectors that skip telegraphing enemies, materialize-then-mutate snapshot, fold sanitizers, `_nearestEnemy` from `SeekerDroneSystem`, arena-interior origin clamp, oldest-eviction for the trail pool).
- `src/systems/SeekerDroneSystem.js` -- REFERENCE for `_nearestEnemy(x,y)`, the target-less hold-fire + accumulator clamp, and the per-shot `applyPlayerDamage` call.
- `src/systems/MineLayerSystem.js` -- REFERENCE for pooled-entity aging/eviction, fold sanitizers, hoisted scratch, and the registration-slot rationale.
- `src/scenes/buildArenaWorld.js` -- import `PiercingLanceSystem`; construct `new PiercingLanceSystem(ship, enemyPools, collisionSystem, playerStats)` and `world.addSystem(...)` it immediately after `mineLayerSystem` (after its `addSystem`) and before the `// --- Scoring ---` block.
- `src/systems/CollisionSystem.js` -- REFERENCE ONLY for the `applyPlayerDamage(enemy, ownerPool, damage) → boolean` seam. Do not modify.
- `src/systems/mineLayerSystem.test.js` / `src/systems/seekerDroneSystem.test.js` -- REFERENCE for the test harness (synthetic pools, fake `collisionSystem`, fold-driven stats, fixed-step stepping).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `LANCE_BOLT_SPEED = 700`, `LANCE_BOLT_RADIUS = 8`, `LANCE_BOLT_BASE_DAMAGE = 4`, `LANCE_PERIOD_FLOOR_MS = 100`, `LANCE_BASE_PIERCE = 2`, `LANCE_MAX_PIERCE = 16`, `LANCE_BOLT_POOL_PREWARM = 8`, `LANCE_TRAIL_LIFETIME_MS = 500`, `LANCE_TRAIL_DROP_MS = 50`, `LANCE_TRAIL_NODE_RADIUS = 12`, `LANCE_TRAIL_DAMAGE = 1`, `LANCE_TRAIL_NODE_MAX = 64` -- named tunables for the lance, anchored to sibling constants with brief rationale comments in the file's style.
- `src/entities/LanceBolt.js` -- `createLanceBolt()` returning `{ x, y, vx, vy, radius, damage, pierceRemaining, trail, trailAccumMs, hitSet }` (a real `Set` for `hitSet`) -- the pooled bolt; the system stamps every field and clears `hitSet` on spawn.
- `src/entities/LanceTrailNode.js` -- `createLanceTrailNode()` returning `{ x, y, radius, lifeMs, damage, hitSet }` -- the pooled lingering damage node; stamped and `hitSet` cleared on drop.
- `src/state/PlayerStats.js` -- add `lancePeriodMs: 0`, `lancePierce: 0`, `lanceDamage: 0`, `lanceTrail: 0`, `lanceBackward: 0` to `PLAYER_STATS_BASE` (all additive, base 0), with a doc comment matching the `mine*`/`seekerDrone*` blocks.
- `src/config/itemRegistry.js` -- add the frozen `piercing-lance` def (track `offense`, `rarity: 4`, `maxLevel: ITEM_MAX_LEVEL`, `guaranteeFromLevel: null`, `fusion: { partner: 'overcharge', epic: 'railgun' }`) with five per-level `stats` TOTALS: L1 `{lancePeriodMs:2000, lancePierce:2, lanceDamage:4}`; L2 `{lancePeriodMs:2000, lancePierce:4, lanceDamage:4}`; L3 `{lancePeriodMs:1400, lancePierce:4, lanceDamage:6}`; L4 `{lancePeriodMs:1400, lancePierce:7, lanceDamage:6, lanceTrail:1}`; L5 `{lancePeriodMs:1400, lancePierce:7, lanceDamage:6, lanceTrail:1, lanceBackward:1}`. Player-facing `desc` per PRD §13.3.
- `src/systems/PiercingLanceSystem.js` -- `class PiercingLanceSystem extends System` with `constructor(ship, enemyPools, collisionSystem, playerStats = null)`, prewarmed bolt + trail-node pools, fold sanitizers (`_periodMs`, `_pierce`, `_damage`, `_trail`, `_backward`), `_nearestEnemy(x,y)`, and `fixedUpdate(dt)` doing: (1) sanitize fold; (2) materialize combat enemies (+owners), skipping telegraphing; (3) advance live bolts, apply pierce collisions via `applyPlayerDamage` (per-bolt `hitSet`, decrement `pierceRemaining`, release at 0 or on arena exit), and drop trail nodes on the `LANCE_TRAIL_DROP_MS` cadence for trail-stamped bolts; (4) age trail nodes, apply their damage (per-node `hitSet`), expire at `LANCE_TRAIL_LIFETIME_MS`; (5) fire on the folded period toward the nearest enemy (Lv5 also antipodal), clamp/hold when target-less; evict oldest trail node past `LANCE_TRAIL_NODE_MAX`.
- `src/scenes/buildArenaWorld.js` -- import and register `PiercingLanceSystem` in the load-bearing slot (after `mineLayerSystem`, before `ScoringSystem`), with a comment block mirroring the Mine Layer one.
- `src/systems/piercingLanceSystem.test.js` -- NEW unit tests covering the I/O & Edge-Case Matrix rows and the ACs below (mirror `mineLayerSystem.test.js` harness): fires-toward-nearest, pierce-count limit + hit-once-per-enemy, armored hits-to-kill per level, hold-fire-when-target-less + fire-on-appearance, per-level fold values, trail damages within/expires after 0.5s, backward bolt at Lv5, trail-node cap, and the unowned/null-store inert case.

**Acceptance Criteria:**
- Given Piercing Lance is unowned (or `playerStats` is null), when the sim steps, then no lance bolt or trail node ever spawns and no enemy takes lance damage.
- Given Lv1 owned and one combat enemy present, when a fire period elapses, then exactly one bolt spawns from the ship aimed at that enemy, and on overlap the enemy is killed through `collisionSystem.applyPlayerDamage` (not by a direct `hp`/release).
- Given Lv2 owned (pierce 4) and a line of 5 unarmored enemies, when a bolt sweeps through them, then it kills the first 4 distinct enemies it overlaps (each hit once) and is released before reaching the 5th.
- Given an armored enemy (hp 5), when hit by a Lv1 bolt (damage 4) then it survives with reduced hp; when hit by a Lv3 bolt (damage 6) then it dies in that one hit — the "+50% dmg" is observable as armored hits-to-kill dropping from 2 to 1.
- Given owned but no combat enemy in the arena, when fire periods elapse, then no bolt fires and no unbounded backlog accrues; the first tick a combat enemy appears, a bolt fires immediately.
- Given Lv4 owned (trail on), when a bolt passes a stationary combat enemy, then the enemy takes lance-trail damage within `LANCE_TRAIL_LIFETIME_MS` of the bolt passing, and no further trail damage after the nodes expire.
- Given Lv5 owned and a target ahead, when a fire period elapses, then two bolts fire that cadence — one toward the nearest enemy and one in the opposite (backward) direction.
- Given many trail nodes are live, when more are dropped, then the live trail-node count never exceeds `LANCE_TRAIL_NODE_MAX`.
- Given the item at each level 1→5, when `recomputePlayerStats` folds the owned build, then `lancePeriodMs`/`lancePierce`/`lanceDamage`/`lanceTrail`/`lanceBackward` equal 2000/2/4/0/0, 2000/4/4/0/0, 1400/4/6/0/0, 1400/7/6/1/0, 1400/7/6/1/1 respectively.
- Given the full test suite, when `npm test` runs, then all tests pass and the v1 firing/collision behavior is unchanged.

## Spec Change Log

No spec amendments — no `bad_spec`/`intent_gap` loopback occurred. Review findings were resolved as additive patches (see Review Triage Log and Auto Run Result).

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 1, medium 1, low 0)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[high]` `[patch]` No in-game rendering — the lance shipped invisible (ArenaScene untouched), deviating from all three sibling epic-11 items and the epic's visual-legibility requirement. Added `COLOR_LANCE_BOLT`/`COLOR_LANCE_TRAIL`, `ArenaScene` `lanceBoltGraphics`/`lanceTrailGraphics` in the additive-blend neon layer, and a `forEachActive` fillCircle pass for bolts (`pool`) and trail nodes (`trailPool`) — the mine/seeker render pattern, sim-state-read-only.
  - `[medium]` `[patch]` The shared per-tick `_killedThisTick` kill guard (prevents a second same-tick lance source double-releasing/double-scoring an already-killed enemy) was correct but untested — deleting it passed the whole suite. Added two tests (two overlapping bolts; one bolt + one trail node over one killable enemy) asserting exactly-one kill/score and no double-release.

### 2026-07-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[low]` `[patch]` The trail-drop `while (bolt.trailAccumMs >= LANCE_TRAIL_DROP_MS)` loop was unguarded against a non-positive cadence, an asymmetry with the fire period (which `_periodMs` floors to `LANCE_PERIOD_FLOOR_MS`). A `LANCE_TRAIL_DROP_MS` tuned to 0/negative — it is a "Tunable feel" constant — would make the condition always true and the `-=` never shrink, a hard-hang infinite loop on the first Lv4+ bolt. Guarded the loop with `LANCE_TRAIL_DROP_MS > 0` (a non-positive cadence disables the trail instead of hanging); no behavior change at the shipped value 50.
  - `[low]` `[patch]` The `mag === 0` coincident-target fire branch (`PiercingLanceSystem.js` fire path) — the fallback that keeps a bolt's velocity finite when an enemy sits exactly on the clamped ship origin — had zero test coverage; a future refactor to a `/mag` form would yield NaN velocity → a bolt that never exits (`isOutsideArena` false) and never hits (distance test false), leaking the pool one immortal bolt per coincident fire, with no existing test failing. Added a firing test placing an enemy exactly on the ship and asserting the spawned bolt has finite velocity of magnitude `LANCE_BOLT_SPEED` and still releases (pool returns to empty).

## Design Notes

**Why a separate pooled system, not a piercing bullet.** `CollisionSystem`'s contract is "one bullet destroys at most one enemy" (it `break`s and releases the bullet on first overlap). Making the shared bullet pierce would make `FiringSystem`/`CollisionSystem` pierce-aware for one item and risk the v1 gun. Instead the lance owns its bolts and its own collision sweep — exactly the split `SeekerDroneSystem` (its `DroneShot` pool) and `MineLayerSystem` (its `Mine` pool) already use. This keeps the v1 firing/collision code byte-unchanged and the pierce logic contained.

**Direction = auto-target nearest enemy.** The base gun fires only along the twin-stick aim while `aimActive`; an auto-firing passive item needs a direction even when the player isn't aiming. The sibling auto-fire item Seeker Drones already establishes "fire toward the nearest combat enemy, hold fire when there's none" (`_nearestEnemy` + accumulator clamp), and it directly serves the "punch through a line of enemies / clear dense columns" intent (aim at the front of a column, pierce through it). The Lv5 "forward + backward" AC confirms a single primary direction (toward the target) with its antipode. This is the dominant reading; aim-direction firing would duplicate the base gun and not serve the column-clearing fantasy.

**Damage curve 4/4/6/6/6 (direct field, like orbit-blade).** Orbit Blade and Seeker Drones store per-level damage directly (`orbitBladeDamage` 90/126, `seekerDroneDamage`), not via a mult, so the lance mirrors that with a direct `lanceDamage`. Unarmored enemies carry no `hp` and die in one hit regardless of magnitude, so lance damage is observable ONLY as armored hits-to-kill. Base 4 makes armored (hp 5) a 2-hit kill at Lv1–2; the Lv3 "+50%" (→ 6) crosses the one-shot threshold (2 hits → 1), which is exactly what makes the AC testable at the outermost surface. This is magnitude through the shared armor-respecting seam (like Orbit Blade's/Mine's 90), NOT a melee/AoE armor-bypass classification — armor genuinely resists the projectile at Lv1–2.

**Pierce-once-per-enemy across ticks.** A fast bolt can overlap the same enemy for 2–3 fixed steps; without a guard it would burn multiple pierce charges on one enemy. Each bolt carries its own `hitSet` (created cold in the factory, `.clear()`ed on spawn — no steady-path allocation) recording the distinct enemies it has already hit. On overlap with an unhit enemy: `applyPlayerDamage`, add to `hitSet`, decrement `pierceRemaining`; release the bolt when `pierceRemaining <= 0`. Two separate bolts (consecutive cadence, or Lv5 forward+backward) each hit an enemy once because each has its own set. A bolt is also released on arena exit (constant-velocity straight flight guarantees it leaves — no time-lifetime needed).

**Trail model (Lv4).** A trail-stamped bolt drops a pooled `LanceTrailNode` at its position every `LANCE_TRAIL_DROP_MS` (a per-bolt `trailAccumMs`). Each node lives `LANCE_TRAIL_LIFETIME_MS` (the "0.5s"), deals `LANCE_TRAIL_DAMAGE` to each combat enemy that overlaps it, hitting each distinct enemy at most once (per-node `hitSet`), then expires. Node count is bounded by `LANCE_TRAIL_NODE_MAX` with oldest-eviction, mirroring the mine cap — worst case ~40 nodes (Lv5, 4 trail bolts × ~10 nodes) sits comfortably under the cap. This is the minimal faithful "0.5s damage trail": a lingering hazard along the bolt's recent path.

**NFR11 budget.** Peak live lance entities (≤~4 bolts + ≤~40 trail nodes) are modest against the epic's 5 blades + 5 drones + 12 mines stress bar. All pools are prewarmed; the steady path (materialize, advance, collide, age, fire) reuses hoisted collectors, length-reset scratch arrays, and per-entity Sets — zero per-fixed-step allocation.

## Verification

**Commands:**
- `npm test` -- expected: the whole suite passes, including the new `piercingLanceSystem.test.js`, with no regressions in `firingSystem.test.js`/`collisionSystem.test.js` (v1 gun unchanged).
- `npx vitest run src/systems/piercingLanceSystem.test.js` -- expected: all new lance tests pass (fire-toward-target, pierce limit + hit-once, armored curve, hold-fire, trail window, backward bolt, node cap, fold values, unowned inert).
- `npm run build` -- expected: the production build succeeds (no import/name errors from the new modules).

## Auto Run Result

Status: done

### 2026-07-24 — Follow-up review pass

**Summary:** A fresh follow-up review of the already-implemented Story 11.4 (Piercing Lance), triggered by `followup_review_recommended: true`. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel at Opus capability over the code diff since baseline `cdf4ac4`. Two low-severity findings were fixed as additive patches; the remaining findings were rejected as speculative, cosmetic, convention-consistent, or masked-by-magnitude with no observable effect for the current game. No spec amendment (no `bad_spec`), no intent gap, no deferrals.

**Files changed this pass:**
- `src/systems/PiercingLanceSystem.js` — guarded the trail-drop `while` loop with `LANCE_TRAIL_DROP_MS > 0` so a 0/negative "Tunable feel" cadence can no longer hard-hang the sim (mirrors how `_periodMs` floors the fire period).
- `src/systems/piercingLanceSystem.test.js` — added a firing test for the coincident-target (`mag === 0`) branch asserting finite bolt velocity of magnitude `LANCE_BOLT_SPEED` and eventual release (closes a regression gap where a NaN-velocity refactor would leak immortal bolts).

**Review findings breakdown:** patches applied 2 (low 2); deferred 0; rejected 13 (low 13). Rejected classes: same-tick trail double-dip (masked — no shipping enemy survives a Lv4+ bolt to be double-hit, guarded by `_killedThisTick` for killed enemies); out-of-arena trail-node drop (cosmetic waste, well under cap); coincident-shot "waste" behavior (near-zero-measure, finite fallback is fine); owned-but-no-ship accumulator reset (ship is never transiently null in this build); fire-loop iteration cap (fixed-step sim, period floored > dt → ≤1 fire/tick); prewarm-8 sizing (pool auto-grows once, steady state stays zero-alloc); local `clamp`/`isOutsideArena` duplication (established sibling convention the spec mandates); un-re-stamped constant `radius` (doc nit, no functional impact); allocation test post-warmup baseline (correctly measures steady state); loose trail-cadence / backward-trail assertions (cap has its own test; backward bolt reuses the same spawn path); intent-alignment surface divergences (render decided in the prior pass; scoring integration covered by the seam + registration-order tests).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 2 → score `3×0 + 1×2 = 2` (< 5, no high) → false.

**Verification performed:**
- `npx vitest run src/systems/piercingLanceSystem.test.js` — 53 passed (was 52; +1 coincident-target test).
- `npm test` — 1959 passed, 73 files, no regressions (v1 firing/collision unchanged).
- `npm run build` — production build succeeded (108 modules).

**Residual risks:** None introduced this pass — both patches are additive/defensive with no behavior change at shipped constant values. Residual artifact left in the working tree (not part of this change): `_bmad-output/implementation-artifacts/sprint-status.yaml` (orchestrator-owned, modified before this run).

