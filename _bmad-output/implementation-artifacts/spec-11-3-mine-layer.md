---
title: 'Story 11.3 — Mine Layer'
type: 'feature'
created: '2026-07-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'dd7575b077a7df890f0b496f35c2fe5e6b608efc'
final_revision: '5b5dcd9966c918e8c75f03589144e7f3aa94da93'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Epic 11's third exotic item and the first AoE-detonation entity. Mine Layer drops timed mines behind the kiting ship that arm, then detonate on an approaching enemy — the "zone of denial" answer. Unlike the Orbit Blade (a contact sweep) and Seeker Drones (projectile shots resisted by armor), a mine detonation is **AoE and deals FULL damage to the armored archetype** (Story 9.3), and it introduces the epic's third new pooled system whose worst case is the NFR11 stress bar (**12 mines** live alongside 5 blades + 5 drones), zero-per-frame allocation on the steady path.

**Approach:** Register `mine-layer` as a data-driven offense item, add five fold fields to `PlayerStats`, and add one new `MineLayerSystem` that owns a mine pool. Each fixed step it ages/arms mines, (Lv4+) pulls nearby enemies inward toward armed mines via a position nudge, detonates any armed mine an enemy has entered (dealing its stamped AoE damage to every enemy in blast through the shared `CollisionSystem.applyPlayerDamage` seam so armor/scoring/XP/kill-latches behave exactly as for a bullet), (Lv5) chains a detonation to adjacent armed mines, and drops a fresh mine at the ship on the folded cadence — evicting the oldest when at cap. Registered immediately after `SeekerDroneSystem` and before `ScoringSystem`, the same load-bearing slot.

## Boundaries & Constraints

**Always:**
- Every detonation hit routes through `collisionSystem.applyPlayerDamage(enemy, ownerPool, mine.damage)` — never by decrementing `hp` or releasing the enemy directly. The stamped detonation damage (`MINE_DETONATE_DAMAGE = 90`) exceeds `ARMORED_HP` (5), so a mine one-shots the armored archetype: that is the "full damage to melee/AoE" (FR33) requirement, achieved by magnitude through the shared armor-respecting seam, exactly as the Orbit Blade's 90 is.
- Mines are object-pooled with a fixed prewarmed pool; the steady-state path (age, arm-check, pull-nudge, detonation-scan, drop-cadence) allocates nothing per fixed step — reuse hoisted collectors + length-reset scratch arrays + reused Sets (the CollisionSystem/SeekerDroneSystem convention).
- Live mine count is hard-bounded by the folded cap: when a drop would exceed the cap, the **oldest live mine is released** (removed) before the new one is acquired, so the live count never exceeds the cap. Cap is clamped to `MINE_MAX_CAP` against a corrupted fold.
- Derived parameters (drop period, cap, detonate radius, pull flag, chain flag) live ONLY in the folded `PlayerStats` store; the live mine pool and the drop accumulator are RUNTIME state on `MineLayerSystem` (the fold resets and re-derives the whole store on every card pick — a live timer/pool kept there would be reset by picking any unrelated item).
- Per-mine detonate radius / damage / pull / chain / arm are STAMPED on the mine at DROP time from the fold (a mine laid at Lv1 keeps its 60r/no-pull/no-chain shape even after a later upgrade — the SeekerDrone "a shot keeps the damage it was fired with" convention; a mid-run upgrade only strengthens NEW mines).
- Sanitize every fold read: a null/missing store, missing field, or junk (NaN, Infinity, negative, fractional where inappropriate, absurdly large) resolves to a safe base — drop period ≤ 0 / junk → **no drops** (the pre-11.3 behavior; the drop period is the ownership gate), cap → base, detonate radius → base, pull/chain → off. A finite-but-tiny drop period is clamped UP to `MINE_DROP_PERIOD_FLOOR_MS` so the drop `while` loop drains at most ~1 mine/tick.
- A mine only detonates once ARMED (`ageMs >= MINE_ARM_MS`); an unarmed mine is inert (no detonation, no pull) and never damages anything. Mines never damage the player — only enemies.
- Scope the detonation/pull to `enemyPools` (the five COMBAT archetypes), never `deathPools` (Black Hole / Mirror Reflector are out of scope — the same scoping OrbitBladeSystem/SeekerDroneSystem use). Skip a telegraphing enemy (`telegraphMs > 0`) as both a pull target and a detonation hit.
- An enemy hit by any mine this tick is guarded against a second mine hit the same tick (a reused hit Set, like CollisionSystem's `_hitEnemies`) so overlapping blasts / a chain cascade never double-release an enemy.
- Per-level `stats` maps are TOTALS-at-that-level (restate every field the item still grants), never deltas.

**Block If:**
- The registration slot after `SeekerDroneSystem` / before `ScoringSystem` cannot be honored (e.g. an unexpected refactor removed the slot) — a mine kill outside it is either dropped from the reset kill-latches or never scored.

**Never:**
- Do NOT implement Singularity Field (the Lv5 + Gravity-Well-Lv3 fusion — mines becoming mini black holes) — that is Epic 12; this story only registers the fusion metadata.
- Do NOT feed detonation damage through the BombSystem's `hp`-ignoring outright release — it bypasses the kill latches; the shared `applyPlayerDamage` seam is the only path.
- Do NOT make CollisionSystem or any v1 system mine-aware — MineLayerSystem owns the mines' age/arm/pull/detonate/drop entirely.
- No new selection/draft UX — the card surfaces through the existing level-up flow unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / null store | drop period 0 or no store | No mines dropped, no detonation, no pull; identical to pre-11.3 | No throw; drop accumulator held at 0 |
| Lv1 owned, empty arena | period 2000, cap 10, radius 60 | A mine drops at the ship every ~2s; each arms after 3s; live count accumulates up to 10 then holds (oldest evicted) | Drop accumulator clamped to period |
| Armed mine, enemy enters radius | armed mine, unarmored enemy within 60r | Mine detonates: enemy killed via `applyPlayerDamage`, scored, XP orb dropped; mine released | — |
| Armed mine vs armored (hp 5) | armed mine, armored within radius | `applyPlayerDamage(_, _, 90)` one-shots it (90 > 5) — FULL AoE damage; mine released | — |
| Unarmed mine, enemy on top | ageMs < 3000, enemy overlapping | No detonation, no pull; mine stays inert until armed | No throw |
| Lv4 pull, enemy near armed mine | pull on, enemy within pull radius | Enemy nudged toward the mine each tick (position nudge, dt-scaled), dragged into blast then detonated | No nudge outside pull radius / at core (no NaN) |
| Lv5 chain, adjacent armed mines | one mine detonates, others armed within chain radius | The detonation chains: adjacent armed mines also detonate this tick, cascade bounded (each mine detonates once) | Cascade terminates; no double-release |
| Over cap | at cap 10/12, a new drop is due | Oldest live mine released BEFORE the new one is acquired; live count stays ≤ cap | Never exceeds `MINE_MAX_CAP` |
| Junk fold values | period 0.5 / cap 1e9 / radius NaN | period → floored to `MINE_DROP_PERIOD_FLOOR_MS`; cap → `MINE_MAX_CAP`; radius → base | No throw, no unbounded loop, no NaN position |
| Wall-pressed ship | ship at arena edge | Drop origin clamped into the arena interior (a mine is never laid out of bounds) | — |

</intent-contract>

## Code Map

- `src/config/itemRegistry.js` -- add the frozen `mine-layer` offense entry (5 levels, guarantee null, fusion → singularity-field via gravity-well).
- `src/config/constants.js` -- new "Mine Layer" section: mine body radius, base/floor drop period, arm delay, base/max detonate radius, detonation damage, pull radius + strength, chain radius, base + max cap, pool prewarm, colours (armed/unarmed). Mark `*_MAX_*` / `*_BASE_*` / floor / arm / damage as SAFETY/authored constants, not balance levers.
- `src/state/PlayerStats.js` -- add `mineDropPeriodMs`/`mineCap`/`mineDetonateRadius`/`minePull`/`mineChain` (all base 0) to `PLAYER_STATS_BASE` with field comments.
- `src/entities/Mine.js` -- **new** pooled-mine factory `createMine()` → `{ x, y, radius, ageMs, armMs, detonateRadius, damage, pull, chain }` (plain data, Phaser-free), mirroring `OrbitBlade.js`/`DroneShot.js` (system stamps every field on drop).
- `src/systems/MineLayerSystem.js` -- **new** system: owns the mine `Pool`; ages/arms mines, pulls enemies into armed pull-mines, detonates armed mines an enemy has entered (AoE through `applyPlayerDamage`), chains detonations, drops on cadence, evicts oldest at cap. Templates: `SeekerDroneSystem.js` (fold sanitizers + drop cadence + arena clamp + hoisted scratch), `OrbitBladeSystem.js` (count sync + release-via-snapshot), `BlackHoleSystem._pull` (position-nudge pull model), `CollisionSystem.js` (`applyPlayerDamage` + hit-once guard).
- `src/scenes/buildArenaWorld.js` -- construct + register `MineLayerSystem` after `seekerDroneSystem`, before `scoringSystem`; add to the returned handle; bump the "29 systems" comment to 30.
- `src/scenes/ArenaScene.js` -- add `mineGraphics`, assign `this.mineLayerSystem`, join the additive-blend neon list, and clear+redraw a filled dot per active mine each frame in `COLOR_MINE_ARMED` when armed else `COLOR_MINE_UNARMED` (the `orbitBladeGraphics` pattern; reads sim state only).
- `src/config/itemRegistry.test.js` -- extend `EXPECTED_IDS`, `getItemsByTrack('offense')`, and pin the mine-layer fusion.
- `src/state/playerStats.test.js` -- add a mine-layer fold test (rungs 1..5 → exact fields).
- `src/scenes/buildArenaWorld.test.js` -- update `CANONICAL_ORDER` (add `MineLayerSystem` after `SeekerDroneSystem`, before `ScoringSystem`), the canonical count (29→30), and the slot/handle assertions.
- `src/systems/mineLayerSystem.test.js` -- **new** headless suite (see Acceptance).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the "Mine Layer (Story 11.3 / PRD §13.3)" section. Suggested values (tunable feel / safety guards, framed like the Seeker Drones block): `MINE_RADIUS = 7`, `MINE_BASE_DROP_PERIOD_MS = 2000`, `MINE_DROP_PERIOD_FLOOR_MS = 100` (SAFETY), `MINE_ARM_MS = 3000` (arm delay, constant across levels), `MINE_BASE_DETONATE_RADIUS = 60`, `MINE_MAX_DETONATE_RADIUS = 100`, `MINE_DETONATE_DAMAGE = 90` (full-damage vs armored — like `ORBIT_BLADE_BASE_DAMAGE`), `MINE_PULL_RADIUS = 150`, `MINE_PULL_STRENGTH = 220` (position-nudge, calibrated below `BLACKHOLE_GRAVITY_STRENGTH = 300`), `MINE_CHAIN_RADIUS = 120`, `MINE_BASE_CAP = 10`, `MINE_MAX_CAP = 16` (SAFETY clamp; shipped max 12 — the NFR11 bar), `MINE_POOL_PREWARM = MINE_MAX_CAP`, `COLOR_MINE_UNARMED = 0x886644` (dim amber), `COLOR_MINE_ARMED = 0xffaa22` (bright amber). Mark the `*_MAX_*` / `*_BASE_*` / floor / arm / damage values as SAFETY/authored constants, not balance levers.
- `src/state/PlayerStats.js` -- add the five fields to `PLAYER_STATS_BASE` (all base 0) with the "derived params only; live pool/accumulator on the system; `mineDropPeriodMs` is the ownership gate (0 → unowned)" comment.
- `src/config/itemRegistry.js` -- add the frozen `mine-layer` entry (`track: 'offense'`, `rarity: 4`, `maxLevel: ITEM_MAX_LEVEL`). Levels (each `stats` map is the TOTAL at that level; `desc` from PRD §13.3, never rewritten):
  - L1 `'mine every 2s / 3s arm / 60r'` → `{ mineDropPeriodMs: 2000, mineCap: 10, mineDetonateRadius: 60 }`
  - L2 `'+2 mine cap / 100r blast'` → `{ mineDropPeriodMs: 2000, mineCap: 12, mineDetonateRadius: 100 }`
  - L3 `'drops every 1.3s'` → `{ mineDropPeriodMs: 1300, mineCap: 12, mineDetonateRadius: 100 }`
  - L4 `'mines pull enemies inward'` → `{ mineDropPeriodMs: 1300, mineCap: 12, mineDetonateRadius: 100, minePull: 1 }`
  - L5 `'detonation chains to adjacent mines'` → `{ mineDropPeriodMs: 1300, mineCap: 12, mineDetonateRadius: 100, minePull: 1, mineChain: 1 }`
  - `guaranteeFromLevel: null`; `fusion: { partner: 'gravity-well', epic: 'singularity-field' }`.
- `src/entities/Mine.js` -- **new** factory `createMine()` → `{ x:0, y:0, radius: MINE_RADIUS, ageMs:0, armMs: MINE_ARM_MS, detonateRadius: MINE_BASE_DETONATE_RADIUS, damage: MINE_DETONATE_DAMAGE, pull:0, chain:0 }`; the system stamps `x/y` and the per-drop fields and resets `ageMs` to 0 on every drop (same stale-carry-over warning as DroneShot.js).
- `src/systems/MineLayerSystem.js` -- **new** `MineLayerSystem extends System`, constructed `(ship, enemyPools, collisionSystem, playerStats = null)`. Prewarm the mine pool to `MINE_POOL_PREWARM`. Runtime state: the mine `Pool` + a `_dropAccumMs`. `fixedUpdate(dt)` order: (1) read + sanitize the fold (`_dropPeriodMs()` — 0/junk → 0 = unowned gate, else floored to `MINE_DROP_PERIOD_FLOOR_MS`; `_cap()` clamped to `MINE_MAX_CAP`; `_detonateRadius()`; `_pull()`; `_chain()`); (2) materialize the non-telegraphing combat enemies (+ owners) once into hoisted scratch; (3) age every live mine (`ageMs += dt`); (4) PULL — for each ARMED mine with `pull`, nudge every combat enemy within `MINE_PULL_RADIUS` toward the mine (`BlackHoleSystem._pull` model: displacement = `MINE_PULL_STRENGTH·(1 − d/MINE_PULL_RADIUS)·dtSec` along unit(mine − enemy); no-op at core / outside radius); (5) DETONATE — for each ARMED mine, if any combat enemy center is within `mine.detonateRadius + enemy.radius`, mark it to detonate; process the detonation set with a chain cascade (a `chain`-stamped mine's detonation adds other ARMED mines within `MINE_CHAIN_RADIUS` to the set; each mine detonates at most once); for each detonating mine apply `mine.damage` to every combat enemy in its blast via `applyPlayerDamage`, guarding the shared per-tick hit Set so no enemy is hit twice; release every detonated mine; (6) DROP cadence — only when owned (`dropPeriod > 0`) accumulate `dt` into `_dropAccumMs`, and while `>= dropPeriod` acquire a mine (evicting the OLDEST — max `ageMs` — first if at cap), stamp it at the ship position clamped into `[ARENA_BORDER_INSET, ARENA_*-ARENA_BORDER_INSET]` with the folded detonate radius / `MINE_DETONATE_DAMAGE` / pull / chain / `MINE_ARM_MS` and `ageMs = 0`, and decrement by `dropPeriod`; when unowned hold `_dropAccumMs` at 0. Guard a null ship (no drop, no pull). Zero per-tick allocation on the steady path.
- `src/scenes/buildArenaWorld.js` -- import + construct `MineLayerSystem(ship, enemyPools, collisionSystem, playerStats)` immediately after `seekerDroneSystem` and before `scoringSystem`; `world.addSystem` it; expose it on the returned arena handle; bump the "29 systems" header comment to 30 with the same slot rationale as Seeker Drones.
- `src/scenes/ArenaScene.js` -- import the two colours + `MINE_RADIUS`; read `this.mineLayerSystem = arena.mineLayerSystem`; add `this.mineGraphics`; include it in the additive-blend neon layer list; in the render pass clear+`fillCircle` a `MINE_RADIUS` dot per active mine, coloured `COLOR_MINE_ARMED` when `mine.ageMs >= mine.armMs` else `COLOR_MINE_UNARMED` (so armed-vs-unarmed reads at a glance — the epic UX note; reads sim state only).
- `src/systems/mineLayerSystem.test.js` -- **new** headless vitest suite covering the Acceptance below.
- `src/state/playerStats.test.js`, `src/config/itemRegistry.test.js`, `src/scenes/buildArenaWorld.test.js` -- extend per the Code Map (fold rungs, registry id/track/fusion, 29→30 count + order + slot/handle wiring).

**Acceptance Criteria:**
- Given an unowned build (drop period 0) or a null store, when the system runs for many fixed steps, then no mine is ever dropped, no enemy is touched, and it never throws (the pre-11.3 path).
- Given Lv1 owned in an empty arena, when the system runs, then a mine is dropped at the ship roughly every 2000 ms, each becomes armed once its `ageMs` reaches `MINE_ARM_MS` (3000), and the live mine count grows to the cap (10) and then holds there (a new drop evicts the oldest), never exceeding the cap.
- Given a Lv2 build (cap 12, radius 100) and a level RISE 1→5 mid-run, then the cap reaches 12 with no factory allocation (prewarmed); given a level DROP, a subsequent over-cap drop still evicts to the current cap.
- Given an ARMED mine and an unarmored enemy that enters its detonate radius, when the system runs, then the mine detonates, the enemy is killed through `applyPlayerDamage` (scored, reported in `collisionSystem.killedEnemies` / `bulletKillCount`), and the mine is released; an UNARMED mine under the same enemy does nothing.
- Given the armored archetype (finite `hp = ARMORED_HP`) inside an armed mine's blast, when it detonates, then `applyPlayerDamage(_, _, 90)` KILLS it in one detonation (full AoE damage, 90 > 5) — contrasting the drone shot that only chips it.
- Given a Lv4 (pull) armed mine and an enemy within `MINE_PULL_RADIUS`, when the system runs a step, then the enemy's position moves toward the mine (a dt-scaled nudge), and an enemy exactly at the mine center or outside the pull radius produces no NaN and no movement.
- Given a Lv5 (chain) armed mine that detonates with other armed mines within `MINE_CHAIN_RADIUS`, when it detonates, then those adjacent armed mines also detonate the same tick (cascade), each mine detonates at most once, and no enemy is released twice.
- Given junk fold values (drop period 0.5, cap 1e9, radius NaN), when the system runs, then the drop period floors to `MINE_DROP_PERIOD_FLOOR_MS` (at most ~1 mine/tick), the cap clamps to `MINE_MAX_CAP`, the radius falls back to `MINE_BASE_DETONATE_RADIUS`, and the fixed step never hangs or produces a NaN position.
- Given a steady run (mines dropping, aging, arming, some detonating) over many ticks, when the system runs, then the steady path allocates nothing per fixed step (mine pool active+free total stays constant across ticks with no churn beyond drops/detonations) and the live mine count stays bounded by the cap.
- Given the factory build, when `buildArenaWorld` runs, then it registers 30 systems in the canonical order with `MineLayerSystem` immediately after `SeekerDroneSystem` and before `ScoringSystem`, scoped to `enemyPools`, with the shared `collisionSystem`/`ship`/`playerStats` handles.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` `MINE_MAX_DETONATE_RADIUS` was 100 — exactly the shipped Lv2+ blast radius, so the safety clamp had zero headroom and silently doubled as an invisible balance ceiling (a future authored radius >100 would clamp with no trace). Raised to 240 with a headroom comment (mirroring `MINE_MAX_CAP = 16 > 12`); the existing absurd-radius clamp test asserts against the constant, so it stayed green.
  - `[low]` `[patch]` Every detonation/chain/pull test injected a pre-armed mine, so the natural drop→arm→detonate seam was never exercised end to end (the intent-alignment auditor's primary divergence). Added a natural-lifecycle test: a fold-driven drop through the drop cadence, aged past `MINE_ARM_MS` over successive ticks, then a stationary enemy entering the armed blast detonates it through the real `CollisionSystem` seam (enemy killed + reported, mine released).
  - Deferred (1): no live-mine teardown on an owned→unowned transition — orphaned armed mines would keep detonating. Unreachable in shipped play (item levels only increase; no item removal exists), so recorded in the deferred-work ledger for the Epic-12 fusion that will make it reachable, not patched now.
  - Rejected (12): damage-stacking across overlapping blasts (hit-once is intended; 90 one-shots every current enemy — latent-only speculation); the pull ship-guard (spec-mandated; no mines exist when the ship is null); evict-oldest-is-armed (AC-faithful "oldest" reading; balance speculation); arm-desc binding (matches the project-wide desc-verbatim convention); pull core-overshoot (mirrors the documented BlackHole `_pull`; the enemy detonates the mine long before reaching the core); `_cap`/`_detonateRadius` returning base when unowned (private methods behind the documented drop-period ownership gate; no external consumer); redundant arm/damage restamps (defensive stale-carry-over, per the DroneShot convention); `clamp` duplication (pre-existing pattern; refactor out of scope); per-enemy `bulletDamageCount` (the correct/honest AoE build-power semantics); cs-null-with-pools (unreachable — the real constructor always provides `collisionSystem`); drop-burst on a period collapse (corrupted-store-only, bounded by cap, no allocation/no crash; the floor constant already guards the dangerous infinite-loop case); over-cap linger after a cap drop (unreachable — levels only increase; a transient bounded overage the drop-drain already resolves).

## Design Notes

**"Full damage to armored" is magnitude, not a bypass.** `applyPlayerDamage` treats any enemy with a finite `hp > damage` as an armored survivor (chips `hp`, no kill). There is NO armor-bypass flag in the codebase — the Orbit Blade's "full damage" is achieved purely by dealing 90 against `ARMORED_HP = 5`, so the kill branch runs. Mine detonation reuses that exact mechanism: `MINE_DETONATE_DAMAGE = 90` through the same seam one-shots the armored archetype. Keeping the value at/above the blade's is what makes a mine AoE-full-damage; a lower value would silently make mines armor-resisted.

**Pull is a POSITION nudge, not a velocity force** — the BlackHoleSystem lesson. The enemy movers recompute velocity each tick, so a velocity force would be erased; a position nudge applied after the movers integrate (MineLayerSystem sits after CollisionSystem, i.e. after the movers) accumulates and is dt-scaled for frame-rate independence.

**"Behind me" = the ship's current position (the wake).** The ACs don't constrain the drop offset, and a facing- vs velocity-relative offset are two defensible readings with no observable acceptance difference — so rather than pick one, the mine drops at the ship's clamped position. A moving/kiting ship naturally leaves the mines in its wake, satisfying "kiting builds zones of denial." This is a deliberate reading of unconstrained flavor, not an unresolved gap.

**Cap eviction = remove the oldest, not detonate it.** The AC sanctions "removed/detonated"; removal (release to pool) is the deterministic half with no eviction-triggered chain cascade to reason about, and it fully satisfies "live count stays bounded." Oldest = max `ageMs` (a mine dropped earlier has aged longer); no separate sequence counter is needed.

**Per-mine stamping mirrors the drone shot.** A mine's blast radius / pull / chain are captured at drop, so a mine laid at Lv1 stays a Lv1 mine — a mid-run upgrade only improves NEW mines, exactly as an in-flight drone shot keeps the damage it was fired with. This keeps the mechanic deterministic and avoids reading the live fold mid-detonation.

**Chain cascade is bounded and allocation-free.** A detonation seeds a hoisted work-set; a `chain`-stamped mine adds adjacent armed mines within `MINE_CHAIN_RADIUS`; a reused `Set` marks each mine detonated-once so the cascade terminates within the live mine count. The shared per-tick enemy hit `Set` (CollisionSystem's `_hitEnemies` pattern) guarantees an enemy caught in overlapping blasts is hit — and released — at most once.

## Verification

**Commands:**
- `npx vitest run src/systems/mineLayerSystem.test.js src/state/playerStats.test.js src/config/itemRegistry.test.js src/scenes/buildArenaWorld.test.js` -- expected: all pass (new suite + the three extended suites green).
- `npx vitest run` -- expected: the full suite stays green (no regression in CollisionSystem / OrbitBlade / SeekerDrone or the fold).
- `npm run build` -- expected: production build succeeds (no import/const wiring errors).

## Auto Run Result

Status: done

**Summary of change:** Implemented Story 11.3 — Mine Layer, the third Epic-11 exotic offense item and the first AoE-detonation pooled entity. A data-driven `mine-layer` registry item (5 levels), five `PlayerStats` fold fields, a new `Mine` pooled entity, and a new `MineLayerSystem` that ages/arms mines, pulls enemies inward (Lv4), detonates armed mines an enemy enters — dealing FULL AoE damage to the armored archetype through the shared `applyPlayerDamage` seam — chains detonations to adjacent armed mines (Lv5), and drops on cadence with an oldest-eviction cap. Registered immediately after `SeekerDroneSystem` / before `ScoringSystem` (30 systems); render + wiring follow the established exotic-item pattern.

**Files changed:**
- `src/config/constants.js` — new Mine Layer constants section (geometry/feel + safety guards + armed/unarmed colours); `MINE_MAX_DETONATE_RADIUS` given deliberate headroom (240) per review.
- `src/config/itemRegistry.js` — frozen `mine-layer` offense entry (5 levels as totals-at-level, `guaranteeFromLevel: null`, fusion → `singularity-field` via `gravity-well`).
- `src/state/PlayerStats.js` — five `mine*` fold fields (all base 0) with the derived-params/ownership-gate comment.
- `src/entities/Mine.js` (new) — `createMine()` pooled factory.
- `src/systems/MineLayerSystem.js` (new) — the age/arm/pull/detonate/chain/drop system.
- `src/scenes/buildArenaWorld.js` — construct + register `MineLayerSystem` (slot + returned handle; 29→30 comment).
- `src/scenes/ArenaScene.js` — mine render (armed vs unarmed colour) + additive-blend neon layer.
- `src/systems/mineLayerSystem.test.js` (new) — headless suite (incl. the review-added natural-lifecycle test).
- `src/config/itemRegistry.test.js`, `src/state/playerStats.test.js`, `src/scenes/buildArenaWorld.test.js` — extended (id/track/fusion, fold rungs 1–5, 30-system order + slot/handle).
- `src/systems/cardOffer.test.js`, `src/systems/levelUpSystem.test.js` — registry-size maintenance (banish sets 6→7 items), the same upkeep stories 11.1/11.2 performed.

**Review findings breakdown:**
- Patches applied (2, both low): `MINE_MAX_DETONATE_RADIUS` headroom (100→240 safety guard); a natural drop→arm→detonate lifecycle test closing the injection-only coverage gap.
- Deferred (1): no live-mine teardown on an owned→unowned transition — orphaned mines would keep detonating; unreachable in shipped play (levels only increase, no item removal), recorded for the Epic-12 fusion that will make it reachable.
- Rejected (12): intended hit-once/one-shot; spec-mandated ship guard; AC-faithful oldest-eviction; project-wide desc-verbatim convention; BlackHole-mirrored pull overshoot; ownership-gated private sanitizers; defensive restamps; pre-existing `clamp` duplication; per-enemy build-power semantics; unreachable cs-null construction; corrupted-store-only drop-burst (floor-guarded, bounded); unreachable over-cap linger (drop-drain resolves it).

**Follow-up review recommendation:** false. This pass patched 0 high, 0 medium, 2 low; score = 3×0 + 1×2 = 2 (< 5).

**Verification performed:**
- `npx vitest run src/systems/mineLayerSystem.test.js src/state/playerStats.test.js src/config/itemRegistry.test.js src/scenes/buildArenaWorld.test.js` — 207 passed.
- `npx vitest run` — full suite 1896 passed (72 files).
- `npm run build` — production build succeeded.

**Residual risks:** The deferred owned→unowned mine teardown is unreachable in shipped play and ledgered for Epic 12. No other residual risks — the reject set is corrupted-store-only, unreachable-by-construction, or intended-and-documented behavior.
