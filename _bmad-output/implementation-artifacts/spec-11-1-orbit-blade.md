---
title: 'Story 11.1 — Orbit Blade'
type: 'feature'
created: '2026-07-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '79f4bc61c47a3cafb0a9bb718b0d358587cb6741'
final_revision: '0e56373fb36f29a42c62480c92599617c1c1cc0f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Epic 11 opens the "exotic arsenal" — items that add genuinely new pooled-entity systems rather than folding a stat. Orbit Blade is the first: rotating melee blades around the ship that give the player a close-range answer which also lands **full** damage on the armored archetype (Story 9.3), the enemy that resists projectiles.

**Approach:** Register `orbit-blade` as a data-driven offense item in the existing Epic-10 framework (registry + `PlayerStats` fold), and add a dedicated `OrbitBladeSystem` that owns a `Pool` of blade entities. Each fixed step it syncs the live blade count to the folded level, rotates the blades around the ship at the level's period, and routes each blade↔enemy contact through the shared `CollisionSystem.applyPlayerDamage` seam — the same path bullets and the dash use, so scoring/XP/DPS latches and armor behave identically. Because a blade deals 90 damage and every current enemy (armored included, hp 5) dies at ≤ its own hp, one blade contact = a full-damage kill.

## Boundaries & Constraints

**Always:**
- Route every blade hit through `collisionSystem.applyPlayerDamage(enemy, ownerPool, damage)` — never decrement `hp` or release enemies directly. This is what makes armor, kill latches, coordinate/XP snapshots and `bulletDamageCount` behave exactly as for a bullet.
- Blades are **pooled entities** with **zero per-frame allocation** in the steady state (NFR2/NFR11): acquire/release only when the blade count changes (a card pick); repositioning mutates `x/y` in place; the sweep uses hoisted collectors + length-reset scratch (the `CollisionSystem`/`DashSystem` convention).
- Register `OrbitBladeSystem` **after `CollisionSystem`/`DashSystem` and before `ScoringSystem`** so its kills land in the freshly-reset kill latches and are scored, dropped as XP, and fed to DPS telemetry — mirroring `DashSystem`'s load-bearing slot.
- Scope the sweep to `enemyPools` (the five combat archetypes), never `deathPools` — the Black Hole and Mirror Reflector are out of scope, the same scoping `DashSystem._sweep` / `NaniteShieldSystem._pulse` use.
- Skip a **telegraphing** enemy (`telegraphMs > 0`) — the single non-lethality seam every combat system respects.
- Level `stats` maps are **TOTALS-at-that-level**, not deltas: each level restates count/damage/period, or the fold (which resets to base each pick) would drop them. Author the `desc` strings verbatim from the PRD; never rewrite prose to match the totals.
- Read all fold fields through junk-sanitized getters (the `NaniteShieldSystem`/`DashSystem` idiom): a missing/`null` store, missing field, or `NaN/Infinity/negative/string/fractional` must degrade safely (no blades / fallback constant), never throw inside the tick.
- A `null` `playerStats` store means **no blades ever** — exactly the pre-story behavior (the item is purely additive).

**Block If:**
- The intended meaning of any per-level number diverges from what this spec authored (blade count 1→2→3→4→5, damage 90/90/90/126/126, rotation period ms 1200/1200/1000/1000/700, +25% ring radius only at Lv5) — HALT with `intent gap`.

**Never:**
- Do not implement the **Tesla Circuit** fusion (Orbit Blade Lv5 + Overcharge Lv3) — that is Epic 12. Only register the `fusion` metadata `{ partner: 'overcharge', epic: 'tesla-circuit' }`.
- Do not add chain lightning, arc damage, or any effect beyond rotating contact blades.
- Do not touch the draft/offer/reroll/slot-limit machinery — a third offense item plugs into it unchanged (`SLOT_LIMIT_OFFENSE` is 5).
- Do not let the ship be moved, damaged, or otherwise mutated by this system — it only reads `ship.x/y`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / null store | `orbitBladeCount` at base 0, or `playerStats === null` | 0 active blades; no sweep; no allocation | n/a (pre-story behavior) |
| Level rise | count fold rises 1→3 on a pick | active blade count reaches 3 within the next tick (acquire from prewarmed free list) | reuse pool; no factory alloc |
| Level/remnant drop | count fold drops (e.g. Epic-12 remnant) | extra blades released back to the pool; live count clamps down | second-pass release (never mid-`forEachActive`) |
| Rotation | count ≥ 1, valid period | blades sit at `ship ± orbitRadius`, evenly spaced (`2π/count` apart), phase advances `2π/(period/1000)` rad/s each tick | wrap phase into `[0,2π)` |
| Contact kill (one-hit enemy) | a blade overlaps a Seeker (no `hp`) | Seeker released via `applyPlayerDamage`; appears in `killedEnemies`; scores + drops one XP orb | — |
| Armored full damage | a blade (90 dmg) overlaps an Armored (`hp` 5) | Armored **killed in one contact** (`5 ≤ 90+ε`) → released + scored; a single 1-dmg bullet leaves it alive (`hp` 4) | contrast is the AC |
| Re-hit guard | a **surviving** enemy (synthetic `hp > 90`) stays overlapping across ticks | hit at most once per `ORBIT_BLADE_HIT_COOLDOWN_MS`, not every tick | lazy `_orbitBladeHitAt` stamp; monotonic elapsed clock so recycled instances never carry a stale future stamp |
| Telegraphing enemy | overlapping enemy has `telegraphMs > 0` | ignored (no hit) | — |
| Junk fold values | `orbitBladeCount/Damage/PeriodMs` = NaN/Infinity/negative/string | count→0 (no blades); damage→`ORBIT_BLADE_BASE_DAMAGE`; period→`ORBIT_BLADE_BASE_PERIOD_MS`; count clamps to `ORBIT_BLADE_MAX_COUNT` | sanitized getters, never throw |

</intent-contract>

## Code Map

- `src/config/itemRegistry.js` -- add the frozen `orbit-blade` offense entry (5 levels, guarantee null, fusion → tesla-circuit).
- `src/state/PlayerStats.js` -- add `orbitBladeCount/orbitBladeDamage/orbitBladePeriodMs` (base 0) and `orbitBladeRadiusMult` (base 1) to `PLAYER_STATS_BASE`.
- `src/config/constants.js` -- new "Orbit Blade" section: geometry/feel + safety constants + colour (see Execution).
- `src/entities/OrbitBlade.js` -- **new** pooled-blade factory `createOrbitBlade()` → `{ x, y, radius }` (plain data, Phaser-free), mirroring `Bullet.js`/`XpOrb.js`.
- `src/systems/OrbitBladeSystem.js` -- **new** system: owns the blade `Pool`, syncs count to the fold, rotates blades, sweeps contact through `applyPlayerDamage`. Template: `DashSystem.js` (melee sweep) + `XpOrbSystem.js` (pool lifecycle) + `NaniteShieldSystem.js` (fold sync + junk sanitizers).
- `src/scenes/buildArenaWorld.js` -- construct + register `OrbitBladeSystem` after `dashSystem`, before `ScoringSystem`; add to the returned handle; bump the "27 systems" comment to 28.
- `src/scenes/ArenaScene.js` -- add `orbitBladeGraphics`, assign `this.orbitBladeSystem`, join the additive-blend neon list, and clear+redraw one filled circle per active blade each frame (the `xpOrbGraphics` pattern).
- `src/config/itemRegistry.test.js` -- extend `EXPECTED_IDS`, `getItemsByTrack('offense')`, and pin the orbit-blade fusion.
- `src/state/playerStats.test.js` -- add an orbit-blade fold test (rungs 1..5 → exact fields).
- `src/scenes/buildArenaWorld.test.js` -- update the canonical count (27→28) + order list; any prewarm/handle assertion.
- `src/systems/orbitBladeSystem.test.js` -- **new** headless suite (see Acceptance).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `ORBIT_BLADE_ORBIT_RADIUS = 56` (ring radius from ship centre), `ORBIT_BLADE_RADIUS = 10` (blade collision/render half-extent), `ORBIT_BLADE_MAX_COUNT = 8` (safety clamp, like `SHIELD_MAX_CHARGES`), `ORBIT_BLADE_BASE_DAMAGE = 90` (junk-fold fallback/floor), `ORBIT_BLADE_BASE_PERIOD_MS = 1200` (junk-fold fallback), `ORBIT_BLADE_HIT_COOLDOWN_MS = 250` (per-enemy re-hit cadence), `ORBIT_BLADE_POOL_PREWARM = ORBIT_BLADE_MAX_COUNT`, `COLOR_ORBIT_BLADE = 0xff3355`. Geometry/feel/colour are tunable; the `*_MAX_*`/`*_BASE_*`/floor values are safety guards, documented as such.
- `src/config/itemRegistry.js` -- append the `orbit-blade` entry to the **offense** block (after `spread-cannon`, before the defense items): `track:'offense'`, `rarity:4`, `maxLevel: ITEM_MAX_LEVEL`, `guaranteeFromLevel: null`, `fusion:{partner:'overcharge', epic:'tesla-circuit'}`. Levels (`desc` verbatim from PRD §13.3, `stats` = totals):
  - L1 `'1 blade / 90 dmg / 1.2s rotation'` → `{ orbitBladeCount:1, orbitBladeDamage:90, orbitBladePeriodMs:1200 }`
  - L2 `'2 opposed blades'` → `{ orbitBladeCount:2, orbitBladeDamage:90, orbitBladePeriodMs:1200 }`
  - L3 `'3 blades / 1.0s rotation'` → `{ orbitBladeCount:3, orbitBladeDamage:90, orbitBladePeriodMs:1000 }`
  - L4 `'4 blades / +40% damage'` → `{ orbitBladeCount:4, orbitBladeDamage:126, orbitBladePeriodMs:1000 }`
  - L5 `'5 blades / 0.7s / +25% radius'` → `{ orbitBladeCount:5, orbitBladeDamage:126, orbitBladePeriodMs:700, orbitBladeRadiusMult:0.25 }`
  Keep the whole entry (and nested level/fusion objects) `Object.freeze`d.
- `src/state/PlayerStats.js` -- add the four fields to `PLAYER_STATS_BASE` with a short comment block in the item-vocabulary style; document that `orbitBladeCount/Damage/PeriodMs` are additive/count fields (base 0 = unowned) whose live rotation phase and the blade pool are RUNTIME state on `OrbitBladeSystem`, and `orbitBladeRadiusMult` is a `*Mult` field (base 1).
- `src/entities/OrbitBlade.js` -- new `createOrbitBlade()` factory returning `{ x:0, y:0, radius: ORBIT_BLADE_RADIUS }`; header comment noting the system overwrites `x/y` on every reposition (a recycled instance keeps stale coords until then).
- `src/systems/OrbitBladeSystem.js` -- new `System` subclass. Constructor `(ship, enemyPools, collisionSystem, playerStats = null)`. Own `this.pool = new Pool(createOrbitBlade)` prewarmed to `ORBIT_BLADE_POOL_PREWARM`; public `this._phaseRad = 0`; hoisted sweep collectors (`_enemies`, `_owners`, `_currentPool`, `_collectEnemy`) + a reusable `_activeBlades` scratch; a private monotonic `_elapsedMs` for the re-hit clock. Sanitized getters `_count()` (finite→floor→clamp `[0, ORBIT_BLADE_MAX_COUNT]`, `<1`→0), `_damage()` (finite&>0 else `ORBIT_BLADE_BASE_DAMAGE`), `_periodMs()` (finite&>0 else `ORBIT_BLADE_BASE_PERIOD_MS`), `_orbitRadius()` (`ORBIT_BLADE_ORBIT_RADIUS ×` sanitized `orbitBladeRadiusMult`, mult finite&>0 else 1). `fixedUpdate(dt)`:
  1. `count = _count()`; acquire while `pool.activeCount < count`, release-one while `> count` (materialize actives into `_activeBlades`, release the surplus in a second pass — never mid-`forEachActive`);
  2. if `count > 0`: advance `_phaseRad += (2π / (_periodMs()/1000)) × (dt/1000)`, wrap into `[0,2π)`; else leave phase;
  3. reposition: materialize actives into `_activeBlades`; for `i` in `[0,count)` set `blade.x = ship.x + R·cos(_phaseRad + i·2π/count)`, `blade.y = ship.y + R·sin(...)`;
  4. `_elapsedMs += dt`; sweep: for each combat enemy across `enemyPools` (hoisted collect), skip `telegraphMs > 0` and skip if `_elapsedMs - (e._orbitBladeHitAt ?? -Infinity) < ORBIT_BLADE_HIT_COOLDOWN_MS`; if ANY active blade overlaps (`dx*dx+dy*dy ≤ (blade.radius+e.radius)²`), set `e._orbitBladeHitAt = _elapsedMs` and call `collisionSystem.applyPlayerDamage(e, ownerPool, _damage())` once, then move to the next enemy. Guard `null` ship/pools/collisionSystem defensively (no-op). Zero per-tick allocation on the steady path.
- `src/scenes/buildArenaWorld.js` -- after the `dashSystem` late-bind and before `ScoringSystem`: `const orbitBladeSystem = new OrbitBladeSystem(ship, enemyPools, collisionSystem, playerStats); world.addSystem(orbitBladeSystem);` add `orbitBladeSystem` to the returned handle object; update the header "27 systems" note to 28 with a one-line Story-11.1 annotation matching the existing style.
- `src/scenes/ArenaScene.js` -- create `this.orbitBladeGraphics = this.add.graphics()` in the pooled-entity z-order band (after enemies/xp orbs, near the ship); assign `this.orbitBladeSystem = arena.orbitBladeSystem`; add `this.orbitBladeGraphics` to the `applyAdditiveBlend` list; in the render loop `clear()` then `fillStyle(COLOR_ORBIT_BLADE, 1)` and `this.orbitBladeSystem.pool.forEachActive((b) => g.fillCircle(b.x, b.y, ORBIT_BLADE_RADIUS))`. Render reads sim state only.
- `src/config/itemRegistry.test.js` -- add `'orbit-blade'` to `EXPECTED_IDS`; change `getItemsByTrack('offense')` expectation to `['overcharge','spread-cannon','orbit-blade']`; add an assertion pinning `getItem('orbit-blade').fusion` to `{ partner:'overcharge', epic:'tesla-circuit' }`. (The universal shape/frozen/5-level/guarantee-null/non-null-fusion loops cover the new entry automatically.)
- `src/state/playerStats.test.js` -- add a test folding the shipped `orbit-blade` rungs 1..5 to the exact fields (`orbitBladeCount` 1/2/3/4/5, `orbitBladeDamage` 90/90/90/126/126, `orbitBladePeriodMs` 1200/1200/1000/1000/700, `orbitBladeRadiusMult` 1/1/1/1/1.25), mirroring the Afterburner rung test.
- `src/scenes/buildArenaWorld.test.js` -- bump the canonical system count 27→28 and insert `OrbitBladeSystem` at its slot in the order assertion; extend any prewarm/handle-presence assertion to include the new system.
- `src/systems/orbitBladeSystem.test.js` -- new headless Vitest suite (see Acceptance); harness per `naniteShieldSystem.test.js` (real ship/pools, `playerStats = { ...createPlayerStats(), ...stats }`, drive `fixedUpdate(FIXED_STEP_MS)`).

**Acceptance Criteria:**
- Given a `playerStats` folded to Orbit Blade Lv1 (count 1), when the system ticks, then `pool.activeCount === 1` and the blade sits at distance `ORBIT_BLADE_ORBIT_RADIUS` from the ship; given Lv3 (count 3), then three blades are `~2π/3` apart at that radius.
- Given an unowned build (base fold) or a `null` `playerStats`, when the system ticks, then `pool.activeCount === 0` and no enemy is touched.
- Given a level rises 1→3 mid-run (fold updated), when the next tick runs, then `pool.activeCount` reaches 3 with no factory allocation (prewarmed); given it later drops, then surplus blades are released back to the pool.
- Given a blade overlaps a one-hit combat enemy, when the sweep runs, then the enemy is released via `applyPlayerDamage` and appears in `collisionSystem.killedEnemies` (so it scores + drops XP downstream).
- Given a blade (90 dmg) overlaps an armored enemy (`hp` 5), when the sweep runs, then the armored is **killed in one contact**; and given the same armored takes a single 1-damage bullet instead, then it survives with `hp` 4 — the melee-vs-projectile contrast.
- Given a synthetic enemy with `hp` far above 90 stays overlapping, when many ticks run, then it is hit at most once per `ORBIT_BLADE_HIT_COOLDOWN_MS` (not every tick), and a telegraphing enemy (`telegraphMs > 0`) is never hit.
- Given junk fold values (`NaN`/`Infinity`/negative/string) for count/damage/period, when the system ticks, then it never throws and degrades safely (0 blades / fallback damage / fallback period; count clamps to `ORBIT_BLADE_MAX_COUNT`).
- Given a fixed level held over ≥ 600 ticks, when the system runs, then the sweep and reposition perform zero per-tick allocation (hoisted collectors keep closure identity; scratch arrays reused; `pool` activeCount stable).
- Given `buildArenaWorld()`, when constructed, then it registers 28 systems in the canonical order with `OrbitBladeSystem` between `DashSystem`/`ScoringSystem`, and the full existing suite still passes.

## Design Notes

**Why "full damage to armored" needs no armor-type tag.** The sim has no damage "kind" field — armor is purely structural: `applyPlayerDamage` kills when `enemy.hp ≤ damage + HP_EPSILON`, else the armored survivor absorbs (`hp -= damage`). Armored resists *projectiles* only because a bullet's base damage is 1 (5 hits to clear `ARMORED_HP` 5). A blade carries 90, so `5 ≤ 90+ε` → one-shot. Routing through the shared seam is therefore both the simplest correct path and what keeps scoring/XP/DPS identical to a bullet kill. Do **not** use `BombSystem`'s unconditional `hp`-ignoring release — that bypasses the kill latches.

**Rotation model.** One shared accumulating phase `_phaseRad`; blade `i` is at `_phaseRad + i·(2π/count)`, so blades stay evenly spaced and "2 opposed" (Lv2) falls out as `π` apart. Angular speed is `2π/(period_s)`, so a smaller period spins faster (1.2s → 1.0s → 0.7s). The blade objects hold only `x/y/radius`; angles are recomputed each tick, so pool insertion order is irrelevant (blades are visually identical).

**Re-hit cooldown.** Every current enemy dies in one blade contact (released, unhittable again), so the cooldown is unobservable with shipped content — but it is the same anti-machine-gun guard `DashSystem` added deliberately (`_dashHitSeq`), here generalized to a monotonic `_elapsedMs` stamp so a future high-hp enemy can't be hit 60×/s. The clock only increases, so a recycled instance's stale stamp is always in the past → correctly eligible.

**Registration slot mirrors DashSystem exactly** — after `CollisionSystem` (latches already reset this tick) and before `ScoringSystem` (kills get scored + XP + DPS). Consequence: a card picked this tick folds later this tick (`LevelUpSystem` runs after `ScoringSystem`), so a level change is visible on the **next** tick — the same one-tick lag every in-band item system accepts.

## Verification

**Commands:**
- `npx vitest run src/systems/orbitBladeSystem.test.js src/config/itemRegistry.test.js src/state/playerStats.test.js src/scenes/buildArenaWorld.test.js` -- expected: all pass (new + updated suites).
- `npm test` -- expected: the full suite is green (no regression from the new registry entry, the new fold fields, or the 28th system).
- `npm run build` -- expected: production build succeeds (no unused-import / syntax breakage in the touched scene/system files).

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 1
- addressed_findings:
  - `[low]` `[patch]` Re-hit stamp recycle-safety relied on an unpinned `ENEMY_SPAWN_TELEGRAPH_MS > ORBIT_BLADE_HIT_COOLDOWN_MS` coupling and the justifying comments were inaccurate — `OrbitBladeSystem._sweep` now clears `_orbitBladeHitAt` on a telegraphing (spawning-in) enemy so recycling is robustly safe; comments corrected; test added.
  - `[low]` `[patch]` Null-ship defensive path let the sweep run against unpositioned blades — sweep now gated on `count > 0 && ship`; dead re-materialize branch removed.
  - `[low]` `[patch]` Blade rotation motion was unverified (a frozen-blades reposition would pass every test) — added a multi-tick `atan2` motion assertion tying `_phaseRad` to real blade position change.
  - `[low]` `[patch]` Sweep damage magnitude was unverified (all shipped enemies one-shot at ≥5) — added a high-hp-survivor test pinning the hp decrement to the folded 90 (Lv1) / 126 (Lv5) through `applyPlayerDamage`.
  - `[low]` `[patch]` Zero-allocation test did not guard scratch-array reallocation — added referential-identity pins on `_enemies`/`_owners`/`_activeBlades` across the 600-tick run.

Rejected: a non-finite-`dt` guard was proposed but dropped as noise — no system in this codebase guards `dt`, and the fixed timestep supplies a finite constant; guarding here would be inconsistent over-defense.

### 2026-07-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1
- reject: 12
- addressed_findings:
  - `[low]` `[patch]` The blade kill's headline claim — "scored, XP orb dropped, full kill feedback, armored one-shot, identical to a bullet" — was verified only in ISOLATION (`orbitBladeSystem.test.js` against a hand-built collision seam) while every Epic-10 sibling (Spread Cannon/Nanite Shield/Afterburner) drives its headline through the ASSEMBLED world. Two review layers (verification-gap + intent-alignment) converged on the missing altitude. Added a `buildArenaWorld — Orbit Blade through the ASSEMBLED world (Story 11.1)` block: real offer→pick→fold→system sync (pinning the documented one-tick fold lag), a Lv1 blade kill observed as a real score+XP-orb+particle+ripple payout through the registered pipeline, and a Lv1 one-shot of an armored — so a source-discriminating regression in ScoringSystem/XpOrbSystem or a slot reorder now fails a test.
  - `[low]` `[patch]` Ring geometry was verified only against a STATIONARY centred ship; a regression that cached the ship origin (blades centred on where the ship WAS) would pass every case. Added a moving-ship test to `orbitBladeSystem.test.js` that translates the ship between ticks and requires all three blades to re-centre on the ship's NEW position at the ring radius.

Rejected/deferred this pass: the recycle-safety-of-a-future-non-telegraphing-enemy concern (two independent guards already exist — the telegraph-clear AND `ENEMY_SPAWN_TELEGRAPH_MS` 600 > `ORBIT_BLADE_HIT_COOLDOWN_MS` 250 — and every shipped enemy telegraphs; unobservable in shipped content per intent), the "silent balance downgrade" and dead-cooldown-branch findings (both by-design per the intent's junk-fallback and forward-looking-guard language), `MAX_COUNT=8`-too-low and enemy-`radius`/`period` extra-sanitizer findings (speculative future content / no shipped enemy produces junk geometry / consistent with the `CollisionSystem`/`DashSystem` convention), the render-reaches-into-`.pool` and null-ship-render findings (consistent with the codebase's untested render-wiring convention; `orbitBladeSystem` never null in production), the render-uses-constant-not-`b.radius` finding (spec-directed; `radius` never mutated), the discrete-collision-tunneling finding (sim-wide convention), and the no-behavioral-out-of-scope-pool-test finding (already pinned structurally by the `enemyPools` identity assertions in `buildArenaWorld.test.js`). One genuine pre-existing issue was deferred: a float-ULP off-by-one in `LevelSystem`'s exact-threshold level derivation for levels 6/9/10 (surfaced incidentally, not caused by this story).


## Auto Run Result

Status: done

**Summary:** Follow-up review pass on an already-`done`, already-committed story (the implementation shipped in `0c6e4fe`). This pass ran the four review layers against the full diff since baseline `79f4bc6`, triaged the findings, and applied two low-severity test-coverage patches — no production code changed.

**Files changed this pass:**
- `src/scenes/buildArenaWorld.test.js` — added a `buildArenaWorld — Orbit Blade through the ASSEMBLED world (Story 11.1)` describe block (real offer→pick→fold→system sync with the documented one-tick lag pinned; a Lv1 blade kill observed end-to-end as score + XP-orb + particle + ripple through the registered pipeline; a Lv1 one-shot of an armored), closing the isolation-vs-assembled altitude gap the Epic-10 siblings all covered.
- `src/systems/orbitBladeSystem.test.js` — added a moving-ship geometry test requiring all three blades to re-centre on the ship's new position each tick (the stationary-ship cases could not catch a cached-origin regression).
- `_bmad-output/implementation-artifacts/deferred-work.md` — one NEW defer entry (pre-existing `LevelSystem` float-ULP boundary at levels 6/9/10).
- `_bmad-output/implementation-artifacts/spec-11-1-orbit-blade.md` — triage log + this result.

**Review findings breakdown:** intent_gap 0, bad_spec 0, patch 2 (low 2), defer 1, reject 12.
- Patches applied: 2 (both test-coverage; verified green).
- Deferred: 1 (LevelSystem exact-threshold ULP off-by-one for levels 6/9/10 — not caused by this story).
- Rejected: 12 (speculative-future-content, by-design-per-intent, or consistent-with-codebase-convention findings; detailed in the triage log).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 2 → score `3×0 + 1×2 = 2` (< 5), no high-severity patch.

**Verification performed:**
- `npx vitest run src/systems/orbitBladeSystem.test.js src/config/itemRegistry.test.js src/state/playerStats.test.js src/scenes/buildArenaWorld.test.js` — all pass (orbitBladeSystem 48, buildArenaWorld 46, plus registry/playerStats suites).
- `npm test` — full suite green: 1758 tests, 70 files.
- `npm run build` — production build succeeds (100 modules transformed).

**Residual risks:** None from this pass (test-only additions). The deferred `LevelSystem` boundary issue remains open in the ledger for a focused later pass. The reject rationale (recycle-safety, sanitizer fallbacks, MAX_COUNT headroom) all concern speculative future high-hp / stacking content that does not exist in shipped Epic 11.
