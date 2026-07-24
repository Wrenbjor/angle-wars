---
title: 'Story 11.6 — Flak Burst'
type: 'feature'
created: '2026-07-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '02666a7f73847a287bb7dd932c6890467bdd3c89'
final_revision: '7f53fa983cbcdf04f3ba552cf550445c94ec2d56'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 11's sixth exotic offense item and the second BASE-GUN MODIFIER of the epic. Flak Burst turns every Nth bullet fired by the player (every 5th → 4th → 4th → 3rd → 3rd) into an airburst shell that detonates on enemy impact or wall contact into a radial cluster of pooled fragments (6 → 8 → 8 → 12 → 12), dealing splash damage to clustered waves. Higher levels boost fragment damage (+50%) and — at Lv5 — enable secondary airbursts where fragments themselves airburst once on contact or expiration. Flak fragments deal full damage to the armored enemy archetype (Story 9.3) as an AoE/fragment entity, and total fragment spawns are hard-capped to preserve zero per-frame allocation and framerate stability (NFR11). Flak Burst is also the Fragmentation Cascade fusion partner (Epic 12, with Overcharge Lv3) and Chain Reaction partner (with Bomb Capacitor Lv5).

**Approach:** Register `flak-burst` as a data-driven offense item with four additive fold fields on `PlayerStats` (`flakCadence`, `flakFragments`, `flakDamageMult`, `flakSecondaryAirburst`). Extend `entities/Bullet.js` and `FiringSystem.js` to track firing cadence and stamp flak airburst metadata onto every Nth bullet at acquire time. Implement `src/entities/FlakFragment.js` (pooled fragment entity) and `src/systems/FlakSystem.js` (manages active fragments, radial airburst spawning, fixed-step movement, wall/lifetime expiration, secondary airbursts at Lv5, and enemy collision via `collisionSystem.applyPlayerDamage`). Enforce a hard live-fragment cap (`FLAK_MAX_LIVE_FRAGMENTS = 120`) to guarantee NFR11 zero-allocation bounds.

## Boundaries & Constraints

**Always:**
- A bullet's flak parameters (`isFlak`, `flakFragments`, `flakDamageMult`, `flakSecondaryAirburst`) are STAMPED at spawn from the LIVE fold in `FiringSystem.js` when `flakCadence > 0`. A recycled bullet carries the previous shot's fields until re-stamped; stamping at acquire time prevents leaking stale airburst state.
- Ownership gate is `flakCadence > 0`: an unowned Flak Burst (`flakCadence === 0`), `null` `playerStats`, or a corrupt fold yields byte-identical pre-11.6 bullet behavior.
- Airburst trigger: a flak-stamped bullet airbursts ONCE when it hits an enemy (in `CollisionSystem`) OR when it expires at the arena border (in `FiringSystem`). Airbursting produces `flakFragments` primary fragments in a 360° radial distribution centered at the detonation `(x, y)`.
- Fragment properties: each fragment moves outward along its radial vector at `FLAK_FRAGMENT_SPEED`, deals `FLAK_FRAGMENT_BASE_DAMAGE * (1 + flakDamageMult)` damage, has collision radius `FLAK_FRAGMENT_RADIUS`, and expires after `FLAK_FRAGMENT_LIFETIME_MS` or upon arena border crossing.
- Armored enemy integration: Flak fragment damage is routed through `collisionSystem.applyPlayerDamage`, which reduces `enemy.hp` directly — fragment damage (10 base / 15 at Lv3+) exceeds `ARMORED_HP` (5), so a fragment kills an armored enemy in one hit (dealing full damage to armored enemies as required by Epic 11 NFRs).
- Level 5 Secondary Airburst: at Lv5 (`flakSecondaryAirburst >= 1`), primary fragments carry `canAirburst = true`. When a primary fragment hits an enemy or expires at lifetime/wall, it airbursts ONCE into 4 secondary fragments with `canAirburst = false` (sub-fragments never airburst again).
- NFR11 zero-allocation cap: active live fragments are capped at `FLAK_MAX_LIVE_FRAGMENTS = 120`. When `flakPool.activeCount >= FLAK_MAX_LIVE_FRAGMENTS`, new fragment acquisitions fail safe (skipped or oldest evicted) without throwing or allocating per frame.
- Sanitization: `flakCadence` is clamped to an integer in `[0, 10]` (0 = unowned); `flakFragments` is clamped to an integer in `[0, 32]`; `flakDamageMult` is clamped to finite `>= 0`; `flakSecondaryAirburst` is enabled when finite `>= 1`.

**Block If:** none — the level curve, airburst mechanics, fragment distribution, damage scaling, secondary airbursts, and NFR11 pool capping are fully specified.

**Never:**
- Never allow secondary fragments to airburst recursively (unbounded chain explosion is forbidden; `canAirburst` is strictly boolean and set `false` on secondary fragments).
- Never allocate objects inside the fixedUpdate loop or airburst spawn step; fragments reuse prewarmed pool instances.
- Never bypass `collisionSystem.applyPlayerDamage` for fragment enemy kills; scoring, DPS telemetry, XP orbs, and grid ripples must be notified via the standard collision reporting seam.
- Not in scope: the Fragmentation Cascade or Chain Reaction fusion behaviors (only register `fusion: { partner: 'overcharge', epic: 'fragmentation-cascade' }` metadata in the registry).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / corrupt store | `playerStats` null, or `flakCadence` 0/NaN/negative | Bullets behave byte-identically to pre-11.6 (no airbursts, standard flight/despawn) | Sanitizers default to 0 (unowned) |
| Lv1 Airburst on hit | Lv1 owned (`cadence: 5`, `fragments: 6`), 5th shot hits enemy | Enemy takes bullet damage; bullet airbursts at hit position into 6 fragments moving outward | No error expected |
| Lv1 Airburst on wall | Lv1 owned, 5th shot reaches arena border without hitting enemy | Bullet airbursts at border position into 6 fragments moving inward/radially | No error expected |
| Lv2 Higher Fragments | Lv2 owned (`cadence: 4`, `fragments: 8`), 4th shot airbursts | Every 4th shot airbursts into 8 fragments | No error expected |
| Lv3 Fragment Damage | Lv3 owned (`flakDamageMult: 0.5`), fragment hits armored enemy | Fragment deals `10 * 1.5 = 15` damage; armored enemy (HP 5) killed in 1 hit | No error expected |
| Lv4 Cadence & Fragments | Lv4 owned (`cadence: 3`, `fragments: 12`), 3rd shot airbursts | Every 3rd shot airbursts into 12 fragments with +50% damage | No error expected |
| Lv5 Secondary Airburst | Lv5 owned (`flakSecondaryAirburst: 1`), primary fragment expires/hits | Primary fragment airbursts into 4 secondary fragments; secondary fragments do NOT airburst further | No error expected |
| Pool Cap under load | Many airbursts occurring simultaneously near `FLAK_MAX_LIVE_FRAGMENTS` | Live fragment count capped at 120; no per-frame allocation; sim remains smooth | Extra fragment spawns skipped fail-safe |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add `FLAK_FRAGMENT_RADIUS`, `FLAK_FRAGMENT_SPEED`, `FLAK_FRAGMENT_LIFETIME_MS`, `FLAK_FRAGMENT_BASE_DAMAGE`, `FLAK_MAX_LIVE_FRAGMENTS`, `FLAK_FRAGMENT_POOL_PREWARM`, and `COLOR_FLAK_FRAGMENT` with rationale comments.
- `src/state/PlayerStats.js` -- add `flakCadence: 0`, `flakFragments: 0`, `flakDamageMult: 0`, `flakSecondaryAirburst: 0` to `PLAYER_STATS_BASE`, with doc comments matching existing exotic items.
- `src/config/itemRegistry.js` -- add frozen `flak-burst` definition in Offense track after `ricochet-rounds` with 5 per-level TOTALS maps.
- `src/entities/Bullet.js` -- extend `createBullet()` with flak fields (`isFlak`, `flakFragments`, `flakDamageMult`, `flakSecondaryAirburst`) at cold defaults.
- `src/entities/FlakFragment.js` -- NEW entity factory `createFlakFragment()`.
- `src/systems/FlakSystem.js` -- NEW system managing fragment pool, airburst spawning, movement, expiration, Lv5 secondary airbursts, and enemy collision.
- `src/systems/FiringSystem.js` -- maintain `flakCounter` to stamp every Nth bullet with flak parameters; trigger airburst when a flak bullet reaches arena border.
- `src/systems/CollisionSystem.js` -- trigger airburst when a flak bullet hits an enemy before/upon consumption.
- `src/scenes/buildArenaWorld.js` -- instantiate `FlakSystem` immediately after `PiercingLanceSystem` and before `ScoringSystem`; expose in return handle.
- `src/scenes/ArenaScene.js` -- add `flakGraphics` render loop drawing active fragments in `COLOR_FLAK_FRAGMENT`.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add Flak constants (`FLAK_FRAGMENT_RADIUS = 3`, `FLAK_FRAGMENT_SPEED = 320`, `FLAK_FRAGMENT_LIFETIME_MS = 600`, `FLAK_FRAGMENT_BASE_DAMAGE = 10`, `FLAK_MAX_LIVE_FRAGMENTS = 120`, `FLAK_FRAGMENT_POOL_PREWARM = 120`, `COLOR_FLAK_FRAGMENT = 0xffaa00`).
- `src/state/PlayerStats.js` -- add `flakCadence: 0`, `flakFragments: 0`, `flakDamageMult: 0`, `flakSecondaryAirburst: 0` to `PLAYER_STATS_BASE`.
- `src/config/itemRegistry.js` -- add frozen `flak-burst` item definition with per-level TOTALS matching PRD/epics.
- `src/entities/Bullet.js` -- extend `createBullet()` with cold default flak fields.
- `src/entities/FlakFragment.js` -- create `createFlakFragment()` entity factory.
- `src/systems/FlakSystem.js` -- implement `FlakSystem` with fragment pool, `triggerAirburst(x, y, count, damageMult, canAirburst)`, fixedUpdate movement/expiration, secondary airbursts, and enemy collision via `applyPlayerDamage`.
- `src/systems/FiringSystem.js` -- integrate flak stamping on every Nth shot and trigger airburst on border despawn.
- `src/systems/CollisionSystem.js` -- trigger airburst when a flak bullet hits an enemy.
- `src/scenes/buildArenaWorld.js` -- wire `FlakSystem` into world pipeline.
- `src/scenes/ArenaScene.js` -- render flak fragments in `COLOR_FLAK_FRAGMENT`.
- `src/systems/flakSystem.test.js` -- NEW unit tests for FlakSystem (airburst spawning, fragment movement, expiration, secondary airbursts, armored damage, live-count cap).
- `src/state/playerStats.test.js` -- extend tests for Flak Burst fold across levels 1→5.

**Acceptance Criteria:**
- Given Flak Burst is unowned (`flakCadence === 0`), when bullets fire and hit enemies or walls, then no airbursts occur and bullet behavior is byte-identical to pre-11.6.
- Given Lv1 owned, when the player fires 5 shots, then the 5th shot airbursts on hit/wall into 6 fragments distributed radially in 360°.
- Given Lv2 owned, when shots fire, then every 4th shot airbursts into 8 fragments.
- Given Lv3 owned, when a fragment hits an armored enemy, then it deals 15 damage (+50%) and kills the armored enemy in 1 hit.
- Given Lv4 owned, when shots fire, then every 3rd shot airbursts into 12 fragments.
- Given Lv5 owned, when a primary fragment expires or hits an enemy, then it airbursts ONCE into 4 secondary fragments; secondary fragments do not airburst again.
- Given sustained firing under high density, when live fragments approach 120, then active fragments remain capped at 120 with zero per-frame allocation.
- Given `npm test`, when the test suite runs, then all new and existing tests pass with 0 regressions.

## Spec Change Log

No spec amendments.

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` Added 3 unit test cases in `src/systems/flakSystem.test.js` covering CollisionSystem bullet flak airburst on enemy collision, FlakSystem primary fragment secondary airburst on enemy impact, and multi-bullet spread-cannon volley flak stamping.
  - `[medium]` `[patch]` Maintained deterministic 360° radial distribution in FlakSystem while verifying exact angle vectors across test cases.

## Design Notes

**Airburst Trigger Seams:** Stamping flak parameters onto bullets in `FiringSystem` ensures each bullet carries its own flak identity. Triggering the airburst on both enemy impact (in `CollisionSystem`) and wall expiration (in `FiringSystem`) ensures shots that miss still provide anti-cluster utility at the arena perimeter.

**Armored Enemy Damage Alignment:** Fragment damage uses `applyPlayerDamage` directly, treating fragments as AoE/contact threats that bypass projectile resistance. Base fragment damage (10) combined with +50% (15 at Lv3+) ensures one-shot kills on armored enemies (5 HP), fulfilling the Epic 11 NFR requirement.

**Live Count Capping & NFR11:** Capping fragments at 120 (`FLAK_MAX_LIVE_FRAGMENTS`) prevents entity inflation during intense firing scenarios (e.g. Spread Cannon + Flak Burst Lv5 secondary airbursts).

## Verification

**Commands:**
- `npx vitest run src/systems/flakSystem.test.js` -- expected: all FlakSystem tests pass.
- `npx vitest run src/state/playerStats.test.js src/systems/firingSystem.test.js src/systems/collisionSystem.test.js` -- expected: extended suites pass.
- `npm test` -- expected: entire test suite passes without regressions.
- `npm run build` -- expected: production build succeeds.

## Auto Run Result

Status: done

### Summary of change
Story 11.6 ships Flak Burst — Epic 11's sixth exotic offense item and second base-gun modifier — as a data-driven item. Every Nth bullet fired by the player airbursts into a radial cluster of pooled fragments (6 → 8 → 8 → 12 → 12) on enemy impact or wall contact. Fragments deal full damage to armored enemies via `collisionSystem.applyPlayerDamage`. Higher levels boost damage (+50%) and at Lv5 enable secondary airbursts where primary fragments airburst once into 4 sub-fragments upon hit or expiration. Hard live-fragment cap of 120 (`FLAK_MAX_LIVE_FRAGMENTS`) enforces NFR11 zero per-frame allocation.

### Files changed
- `src/config/constants.js` — Flak constants (radius 3, speed 320, lifetime 600ms, base damage 10, max live fragments 120, prewarm 120, tint 0xffaa00).
- `src/state/PlayerStats.js` — extended `PLAYER_STATS_BASE` with `flakCadence`, `flakFragments`, `flakDamageMult`, `flakSecondaryAirburst`.
- `src/config/itemRegistry.js` — added data-driven `flak-burst` definition under Offense track.
- `src/entities/Bullet.js` — added cold default flak fields to `createBullet()`.
- `src/entities/FlakFragment.js` — NEW entity factory for flak fragments.
- `src/systems/FlakSystem.js` — NEW system managing fragment pool, airburst spawning, movement, expiration, Lv5 secondary airbursts, and enemy collision.
- `src/systems/FiringSystem.js` — flak cadence stamping on every Nth bullet and wall airburst trigger.
- `src/systems/CollisionSystem.js` — enemy impact airburst trigger.
- `src/scenes/buildArenaWorld.js` — wired `FlakSystem` into world pipeline.
- `src/scenes/ArenaScene.js` -- added `flakGraphics` render loop.
- `src/systems/flakSystem.test.js` -- NEW unit test suite covering all flak mechanics and verification gaps.
- `src/state/playerStats.test.js`, `src/config/itemRegistry.test.js`, `src/scenes/buildArenaWorld.test.js`, `src/systems/cardOffer.test.js`, `src/systems/levelUpSystem.test.js` — updated tests for 10-item registry and 32-system pipeline.

### Review findings breakdown
- Reviewers: Blind Hunter (adversarial), Edge Case Hunter, Verification Gap, Intent Alignment — all run in parallel.
- **Patches applied: 2** (medium 2, low 0):
  1. `[medium]` Added 3 unit test cases in `flakSystem.test.js` covering CollisionSystem bullet flak airburst, primary fragment secondary airburst on enemy hit, and spread-cannon volley flak stamping.
  2. `[medium]` Verified deterministic 360° radial distribution in FlakSystem and exact velocity vectors in test assertions.
- **Deferred: 0.**
- **Rejected: 10** (all low) — design/sweep CCD opinions, transient null resets, and non-recursive secondary airburst constraints already satisfied.

### Verification performed
- `npx vitest run src/systems/flakSystem.test.js` → 10 passed.
- `npm test` → 75 files, **2017 tests passed**, 0 regressions.
- `npm run build` → production build succeeded (111 modules).

### Follow-up review recommendation
`true`. Triaged 2 medium patches; score = 3×2 = 6 ≥ 5.

### Residual risks
- None. All fragment allocations are bounded by the prewarmed pool (120 max live instances), ensuring zero per-frame allocation in hot loops.
- `git status --porcelain` residual: `sprint-status.yaml` was already modified before this run; left in place.
