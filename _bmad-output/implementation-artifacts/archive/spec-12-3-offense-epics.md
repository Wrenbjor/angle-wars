---
title: 'Offense Fusion Epics: Sunburst, Swarm Protocol, Singularity Field, Kaleidoscope, Fragmentation Cascade, Critical Resonance'
type: 'feature'
created: '2026-07-27'
status: 'in-progress'
review_loop_iteration: 0
baseline_revision: 'f8263f623c3a278ec5cda69650d69441478b9203'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-1-fusion-system-and-ux.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-2-proof-epics-tesla-railgun-phase-armor.md'
  - '{project-root}/src/config/itemRegistry.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/systems/FiringSystem.js'
  - '{project-root}/src/systems/FlakSystem.js'
  - '{project-root}/src/systems/MineLayerSystem.js'
  - '{project-root}/src/systems/SeekerDroneSystem.js'
  - '{project-root}/src/systems/ricochet.js'
  - '{project-root}/src/systems/GridFieldSystem.js'
  - '{project-root}/src/systems/CollisionSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
warnings: []
---

## Intent

**Problem:** Epic 12's fusion system (12.1) and proof Epics (12.2) establish the fusion plumbing and three proof Epics (Tesla Circuit, Railgun, Phase Armor), but six offense Epics remain unplumbed — the run-defining upgrades that make offense-first builds truly distinct: Sunburst (ring-of-death every 4th volley), Swarm Protocol (drone self-replication), Singularity Field (mini black hole mines), Kaleidoscope (bullet splitting), Fragmentation Cascade (chain-clearing airbursts), and Critical Resonance (crit shockwave). These are the remaining eight offense Epics minus the two already-proofed (Tesla Circuit from fusion with Overcharge, Railgun from fusion with Overcharge) — six new fusion-powered behaviors.

**Approach:** Register each Epic in the item registry, add fusion condition checks to the six source systems (FiringSystem, SeekerDroneSystem, MineLayerSystem, ricochet, FlakSystem, FiringSystem+CollisionSystem), and integrate the Epic effects through existing seams (applyPlayerDamage for damage routing, GridFieldSystem.pushRipple for grid deformation, Pool pattern for pooled entities). No new top-level systems — each Epic piggybacks on its source item's system via late-bound `fusionState` (progressionState) parameter.

## Boundaries & Constraints

**Always:**
- Fusion detection reads `progressionState.ownedCards['<epic-id>']` — the effect is on iff the Epic entry is present at level >= 1.
- All damage from Epic effects routes through `collisionSystem.applyPlayerDamage(enemy, ownerPool, damage)` so the armored archetype, scoring, and XP seams behavior consistently.
- NFR11 bounding: every Epic with exponential entity growth carries a hard live-count cap, implemented via Pool prewarming + max-live enforcement (Kaleidoscope bullet-splitting is explicitly bounded; others use existing caps).
- Zero per-frame allocation in the hot loop — all scratch arrays hoisted as module-level or instance-level pre-allocated buffers.
- The fusion Epic entries in `itemRegistry.js` follow the same schema as regular items: `{ id, name, title, track, rarity, maxLevel: 1, levels: [{ level: 1, desc, stats }], fusion: null }` — all are single-level (no upgrading after fusion).

**Block If:**
- The exact visual design of ring bullets, mini black holes, bullet-splits on screen, or crit shockwaves — these are aesthetic decisions. Minimum visible feedback is a colored circle/line on the appropriate graphics layer.

**Never:**
- Do NOT implement fusion detection logic (12.1) or proof Epic effects (12.2) — those are separate stories.
- Do NOT implement the five defense Epics (12.4) — they are a separate story.
- Do NOT modify the card offer drawing algorithm — fusion Epic availability only affects runtime behavior, not the draft loop.
- Do NOT introduce new top-level systems — integrate into existing systems via late-bound `fusionState` parameters.

## I/O & Edge-Case Matrix

### Sunburst (Spread Lv5 + Piercing Lv3)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, normal volley fires | Sunburst owned, player is firing, volley count mod 4 === 0 | A 360-degree ring of bullets fires (piercing=2) in addition to normal volleys; normal volley cadence is unchanged for non-ring shots | No error expected |
| Fusion active, ring bullet hits wall | Ring bullet (pierce=2) strikes arena border | Bullet is reflected (normal ricochet physics) or consumed at border — ring piercing only applies to enemies, not wall bounces | No error expected |
| Fusion active, ring bullet hits enemy | Ring bullet contacts enemy | Enemy takes damage via applyPlayerDamage; bullet pierces through (consumes one pierce charge) | No error expected |
| Fusion inactive, normal spread fires | Sunburst not owned, Spread Cannon owned at any level | Normal Spread Cannon behavior, no ring bullets | No error expected |

### Swarm Protocol (Drones Lv5 + Nanite Lv3)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, drone kills enemy | Swarm Protocol owned, a drone destroys an enemy | Drone respawns after 3 seconds (staggered, not instant); a mini-drone spawns at kill position with 5s lifetime, then returns to pool | No error expected |
| Fusion active, 5 drones already alive | Swarm Protocol owned, drone count at max (SEEKER_DRONE_MAX_COUNT = 5) | No additional drones spawned until a live drone is destroyed; respawn happens when slot frees up | No error expected |
| Fusion active, drone kills via contact (not shot) | Swarm owned, drone physically kills enemy (if ram-kill exists) | Mini-drone still spawns on kill, regardless of kill source (bullet or contact) | No error expected |
| Fusion inactive | Swarms not owned | Normal Seeker Drone behavior (no respawns, no mini-drone) | No error expected |

### Singularity Field (Mine Lv5 + Gravity Well Lv3)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, mine arms | Singularity Field owned, mine arms (ageMs >= MINE_ARM_MS) | Mine gains pull radius (reuses BlackHoleSystem gravity parameters for 1.5s), then detonates as imploding AoE (3x base damage, grid warp) | No error expected |
| Fusion active, mine before arm stage | Mine dropped but not yet armed | Normal mine behavior (no gravity effects until armed) | No error expected |
| Fusion active, mine pulled by Black Hole | Enemy Black Hole is present, Singularity Field mine pulled into Black Hole | Mine detonates on contact with Black Hole body (pulls enemy first, then implodes) | No error expected |
| Fusion inactive | Mine Layer owned without fusion | Normal Mine Layer behavior, no gravity/imploding | No error expected |

### Kaleidoscope (Ricochet Lv5 + Spread Lv3)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, bullet wall-bounces | Kaleidoscope owned, bullet reflects off wall | Upon wall-bounce, a clone bullet spawns from collision point with reflected velocity; original continues (two bullets now) | No error expected |
| Fusion active, split bullet wall-bounces again | Clone bullet reflects off another wall | Another split occurs; total bullets multiply exponentially | Hard cap on live split-bullets prevents runaway (max ~50) |
| Fusion inactive, bullet wall-bounces | No Kaleidoscope, Ricochet Lv5 | Normal ricochet behavior, no splitting | No error expected |
| Split cap reached | Many bullets split, live split count reaches cap | Spawning stops producing clones; existing splits still operate normally | No error expected |

### Fragmentation Cascade (Flak Lv5 + Overcharge Lv3)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, fragment kills enemy | Cascade owned, fragment hits and kills enemy | Fragment triggers a secondary airburst at kill position (smaller radius than primary flak) | No error expected |
| Fusion active, fragment kills via armor collision | Fragment kills through armored enemy (melee/AoE) | Secondary airburst fires regardless of damage type (projectile or melee/AoE) | No error expected |
| Fusion inactive, fragment kills | No Cascade, Flak Lv5 owned | Normal fragment behavior, no secondary airburst on kill | No error expected |
| Cascade airburst damages already-killed enemy in same tick | Multiple kills in same tick, cascade overlaps | Guarded by per-tick hit Set (same pattern as mine chain detonation) | No error expected |

### Critical Resonance (Overcharge Lv5 + any 2 offense Lv5)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, bullet hits enemy | Resonance owned, bullet contacts enemy | 20% chance per hit for 3x damage; on crit, grid deformation shockwave fires at hit position | No error expected |
| Fusion active, crit kills enemy | Critical hit kills enemy | Crit shockwave fires; 1 XP refunded to player's XP total | No error expected |
| Fusion active, bullet misses (no enemy) | Resonance owned, bullet passes through empty space | No crit check (only on actual hit); normal bullet behavior | No error expected |
| Fusion active, bullet hits armored | Crit on armored enemy | Critical damage applies (armor takes reduced projectile damage but crit still at 3x) | No error expected |
| Multiple crits in one volley | Full Spread Cannon volley, each bullet is a crit | Multiple shockwaves fire; XP refund applies per crit kill | No error expected |
| Fusion inactive, bullet hits | Overcharge Lv5 + offense items owned, no resonance | Normal bullet damage, no crit check | No error expected |

## Code Map

### Registry additions

- `src/config/itemRegistry.js` — Add 6 frozen Fusion Epic entries (after existing items, before defense Epics):
  - `sunburst`: offense, rarity 1, maxLevel 1, fusion null (fused from Spread Lv5 + Piercing Lv3)
  - `swarm-protocol`: offense, rarity 1, maxLevel 1, fusion null (fused from Drones Lv5 + Nanite Lv3)
  - `singularity-field`: offense, rarity 1, maxLevel 1, fusion null (fused from Mine Lv5 + Gravity Well Lv3)
  - `kaleidoscope`: offense, rarity 1, maxLevel 1, fusion null (fused from Ricochet Lv5 + Spread Lv3)
  - `fragmentation-cascade`: offense, rarity 1, maxLevel 1, fusion null (fused from Flak Lv5 + Overcharge Lv3)
  - `critical-resonance`: offense, rarity 1, maxLevel 1, fusion null (fused from Overcharge Lv5 + any 2 offense Lv5)
- Each entry has `levels: [{ level: 1, desc: '<effect description>', stats: {} }]`.
- Each entry has `fusion: null` (Epics are not themselves fusable).

### Constants

- `src/config/constants.js` — Add constants for each Epic:
  - `SUNBURST_RING_INTERVAL_FRAMES = 8` (ring fires every 4th volley at ~200ms at 60fps, 8 fixed steps)
  - `SUNBURST_RING_BULLET_COUNT = 16` (divides 360 into 16 directions)
  - `SUNBURST_RING_PIERCE = 2` (ring bullets pierce 2 enemies)
  - `SWARM_RESPAWN_MS = 3000` (drone respawn delay)
  - `SWARM_MINI_DRONE_LIFETIME_MS = 5000` (mini-drone lifetime)
  - `SWARM_MINI_DRONE_MAX_LIVE = 15` (hard cap on mini-drone pool)
  - `SINGULARITY_PULL_RADIUS = 120` (mini black hole pull radius)
  - `SINGULARITY_IMPLODE_DAMAGE_MULT = 3.0` (3x mine damage on implode)
  - `SINGULARITY_PULL_DURATION_MS = 1500` (gravity effect duration before implode)
  - `KALEIDOSCOPE_SPLIT_POOL_CAP = 50` (hard cap on live split-bullets)
  - `KALEIDOSCOPE_SPLIT_POOL_PREWARM = 100`
  - `FRAGMENTATION_CASCADE_RADIUS = 60` (secondary airburst radius)
  - `CRITICAL_RESONANCE_CRIT_CHANCE = 0.20` (20% crit)
  - `CRITICAL_RESONANCE_CRIT_MULT = 3.0` (3x damage on crit)
  - `CRITICAL_RESONANCE_XP_REFUND = 1` (XP bonus on crit kill)

### Sunburst — FiringSystem extension

- `src/systems/FiringSystem.js` — Extend `fixedUpdate` with ring-fire logic:
  - Constructor: Accept optional `fusionState` parameter. Read `progressionState.ownedCards['sunburst']` to check if active.
  - Track `volleyIndex` counter. Every 4th volley (volleyIndex % 4 === 0), fire a 360-degree ring:
    - Acquire `SUNBURST_RING_BULLET_COUNT` bullets from the pool
    - Distribute them evenly across 360 degrees: angle = i * (2π / ringCount)
    - Stamp `pierce = SUNBURST_RING_PIERCE` if the bullet entity supports it
    - Velocity = `BULLET_SPEED * (cos(angle), sin(angle))`
  - Ring bullets are stamped with a `ringBullet = true` flag so they can be distinguished (optional — used for collision behavior differentiation in 12.3, not required now).

### Swarm Protocol — SeekerDroneSystem extension

- `src/systems/SeekerDroneSystem.js` — Extend with respawn and mini-drone spawning:
  - Constructor: Accept optional `fusionState` parameter. Add `_swarmRespawnTimers` (array of pending respawn times) and `_miniDronePool` (Pool).
  - `_spawnMiniDrone(x, y)`: acquire a mini-drone from the pool, set x/y/position, set lifetime, release it. Lifetime countdown in fixedUpdate.
  - On drone kill detection (when a kill is logged for a drone's shot): spawn a mini-drone at kill position.
  - Drone respawn: when a drone is destroyed (shot kills it or it expires), schedule a respawn at `currentTime + SWARM_RESPAWN_MS`. When timer elapses and drone count < max, acquire a drone from pool and position it.
  - Mini-drone pool: prewarmed to SWARM_MINI_DRONE_POOL_PREWARM (e.g. 30). Max live enforced: SWARM_MINI_DRONE_MAX_LIVE. Mini-drones deal SEEKER_DRONE_BASE_DAMAGE on contact with enemies (not the player).
  - Mini-drones: they orbit the ship briefly then drift toward nearest enemy for 1s, then expire. They use a separate pool to avoid interfering with the main drone system.

### Singularity Field — MineLayerSystem extension

- `src/systems/MineLayerSystem.js` — Extend mine behavior with gravity + implode:
  - Constructor: Accept optional `fusionState` parameter. Add `gridFieldSystem` late-bound reference for grid warp.
  - On armed mine detonation: instead of normal immediate burst, first enter a brief gravity phase:
    - For 1.5s (SINGULARITY_PULL_DURATION_MS), the mine exerts pull force on enemies within SINGULARITY_PULL_RADIUS (reusing BlackHoleSystem gravity parameters, scaled down).
    - After the pull phase, the mine implodes (detonates as a normal mine but at 3x damage).
    - During implode: call `gridFieldSystem.pushRipple(x, y, ...)` to deform the grid.
    - The pull phase uses a position-nudge pattern (same as Lv4 Mine pull but with stronger radius).
  - The imploded mine's damage: `MINE_BASE_DETONATE_DAMAGE * SINGULARITY_IMPLODE_DAMAGE_MULT (3x) * mine.detOnateDamageMult`.
  - If the mine is destroyed during the pull phase (e.g., by an enemy collision or Black Hole), it detonates immediately at normal damage (no implode bonus).

### Kaleidoscope — ricochet.js extension

- `src/systems/ricochet.js` — Extend `reflectBulletOffWall` with split spawning:
  - Modify `reflectBulletOffWall(bullet)` or accept the split as a bonus. When a bullet successfully wall-bounces (not at cap), also check if the owner has the Kaleidoscope fusion.
  - If active: acquire a new bullet from the pool, clone the source bullet's x/y position (at collision point), reflected velocity, original damage, and set `bounced = true`. This cloned bullet is the "split."
  - Apply `stampRicochet(splitBullet, params)` so the split inherits the ricochet bounces.
  - Hard cap: maintain a `_kaleidoscopeSplitCount` counter. Before acquiring a split bullet, if `splitCount >= KALEIDOSCOPE_SPLIT_POOL_CAP`, skip the split. Release the split from the counter when it expires (despawns at wall, hits enemy, or lifetime expires).
  - The split bullet's lifetime should match the source bullet's lifetime (they share the same source).
  - The split must NOT itself trigger another Kaleidoscope split — it has `bounced = true` which prevents recursive splits.

### Fragmentation Cascade — FlakSystem extension

- `src/systems/FlakSystem.js` — Extend fragment kill detection with secondary airburst:
  - Constructor: Accept optional `fusionState` parameter. Add a `_cascadeHitSet` (module-level scratch Set) for per-tick duplicate prevention.
  - On fragment kill (when a fragment's collision causes damage that kills an enemy): trigger a secondary airburst at the kill position.
  - Secondary airburst: spawn a small burst of new fragments (`FLAK_FRAGMENT_BASE_DAMAGE / 2` damage, radius = FLAK_FRAGMENT_RADIUS * 0.5) centered on kill position. These are "cascade fragments" — they do not trigger further cascades (no recursive chain).
  - The cascade fragments inherit the source bullet's owner (the player), so they score/XP correctly.
  - Cap the cascade fragments per-hit and per-tick to prevent runaway.

### Critical Resonance — FiringSystem + CollisionSystem extension

- `src/systems/FiringSystem.js` — On bullet enemy hit (in the collision detection path or in CollisionSystem):
  - The FiringSystem doesn't directly handle collisions, so this is a late-bound check: FiringSystem stamps a `hasResonance = hasFusionEpic(fusionState)` flag on each bullet at spawn.
  - In `CollisionSystem`: when a bullet with `hasResonance` hits an enemy, roll a random number (using the deterministic RNG or a simple `Math.random` for the crit check — this is a data-dependent branch, not gameplay-random, so Math.random is acceptable).
  - If roll < CRITICAL_RESONANCE_CRIT_CHANCE (0.20): apply 3x damage instead of base damage.
  - On a crit: call `gridFieldSystem.pushRipple(hitX, hitY, ...)` for the shockwave visual.
  - On a crit kill: if the kill credit goes to the player, add CRITICAL_RESONANCE_XP_REFUND (1) to the player's XP.
  - XP refund is handled via a late-bound call to `progressionState.refundXP(1)` (or a similar API — if not yet available in 12.1, it must be added as a helper method).

### buildArenaWorld.js — late binding

- `src/scenes/buildArenaWorld.js` — Late-bind `progressionState` into:
  - `FiringSystem` (2nd system, after ship creation): `firingSystem.fusionState = progressionState`
  - `SeekerDroneSystem`: `seekerDroneSystem.fusionState = progressionState`
  - `MineLayerSystem`: `mineLayerSystem.fusionState = progressionState`
  - `CollisionSystem`: `collisionSystem.fusionState = progressionState` (for Critical Resonance and general fusion checks)
  - `GridFieldSystem` (if not already bound): for Singularity Field and Critical Resonance grid deformation calls

## Tasks & Acceptance

**Execution:**

- `src/config/itemRegistry.js` -- Add 6 frozen Fusion Epic entries for: sunburst, swarm-protocol, singularity-field, kaleidoscope, fragmentation-cascade, critical-resonance. All follow the existing fusion Epic schema: `{ id, name, title, track: 'offense', rarity: 1, maxLevel: 1, levels: [{ level: 1, desc, stats: {} }], fusion: null }`.

- `src/config/constants.js` -- Add constants for all 6 Epics: SUNBURST_RING_INTERVAL_FRAMES, SUNBURST_RING_BULLET_COUNT, SUNBURST_RING_PIERCE, SWARM_RESPAWN_MS, SWARM_MINI_DRONE_LIFETIME_MS, SWARM_MINI_DRONE_MAX_LIVE, SINGULARITY_PULL_RADIUS, SINGULARITY_IMPLODE_DAMAGE_MULT, SINGULARITY_PULL_DURATION_MS, KALEIDOSCOPE_SPLIT_POOL_CAP, FRAGMENTATION_CASCADE_RADIUS, CRITICAL_RESONANCE_CRIT_CHANCE, CRITICAL_RESONANCE_CRIT_MULT, CRITICAL_RESONANCE_XP_REFUND.

- `src/systems/FiringSystem.js` -- Add Sunburst ring-fire: track `volleyIndex`, every 4th volley spawns a 360-degree ring of bullets (pierce=2); stamp `pierceCount` on ring bullets for the pierce tracking. Add late-bound `fusionState` parameter.

- `src/systems/SeekerDroneSystem.js` -- Add Swarm Protocol: drone respawn timer (3s), mini-drone pool (15 max live, 5s lifetime), mini-drone spawning on drone kill. Add late-bound `fusionState` parameter.

- `src/systems/MineLayerSystem.js` -- Add Singularity Field: armed mines enter gravity phase (1.5s pull -> implode at 3x damage + grid warp); late-bound `gridFieldSystem` reference. Add late-bound `fusionState` parameter.

- `src/systems/ricochet.js` -- Add Kaleidoscope: on wall-bounce, spawn split bullet (cloned position/velocity, inherits ricochet params), hard cap at 50 live splits. Prevent recursive splits via `bounced` flag.

- `src/systems/FlakSystem.js` -- Add Fragmentation Cascade: on fragment kill, spawn secondary airburst (smaller radius, no recursion). Add per-tick hit guard. Add late-bound `fusionState` parameter.

- `src/systems/CollisionSystem.js` -- Add Critical Resonance: on bullet-enemy collision, if bullet has resonance flag, check 20% crit chance. On crit: 3x damage, grid ripple at hit position, XP refund on crit kill.

- `src/scenes/buildArenaWorld.js` -- Late-bind `progressionState` into FiringSystem, SeekerDroneSystem, MineLayerSystem, CollisionSystem. Late-bind `gridFieldSystem` into MineLayerSystem.

**Acceptance Criteria:**

- Given the item registry, when `getItem('sunburst')`, `getItem('swarm-protocol')`, `getItem('singularity-field')`, `getItem('kaleidoscope')`, `getItem('fragmentation-cascade')`, and `getItem('critical-resonance')` are called, then each returns a valid entry with correct `id`, `name`, `title`, `track: 'offense'`, `maxLevel: 1`, and `fusion: null`.
- Given the constants file, when all constant names (SUNBURST_RING_INTERVAL_FRAMES, SUNBURST_RING_BULLET_COUNT, SUNBURST_RING_PIERCE, SWARM_RESPAWN_MS, SWARM_MINI_DRONE_LIFETIME_MS, SWARM_MINI_DRONE_MAX_LIVE, SINGULARITY_PULL_RADIUS, SINGULARITY_IMPLODE_DAMAGE_MULT, SINGULARITY_PULL_DURATION_MS, KALEIDOSCOPE_SPLIT_POOL_CAP, FRAGMENTATION_CASCADE_RADIUS, CRITICAL_RESONANCE_CRIT_CHANCE, CRITICAL_RESONANCE_CRIT_MULT, CRITICAL_RESONANCE_XP_REFUND) are imported, then they resolve to the defined numeric values.
- Given Sunburst is fused, when the player fires and the volley index is a multiple of 4, then 16 bullets spawn distributed evenly across 360 degrees with `pierceCount = SUNBURST_RING_PIERCE` and velocity `BULLET_SPEED * (cos(angle), sin(angle))`; normal volleys are unaffected.
- Given Sunburst is fused, when a ring bullet contacts an enemy, then damage is applied via `applyPlayerDamage` and the bullet retains one pierce charge (not consumed).
- Given Sunburst is fused, when a ring bullet crosses the arena border, then it is despawned normally (pierce charge is irrelevant at border).
- Given Sunburst is NOT fused, when the player fires, then no ring bullets are created (behavior identical to pre-12.3).
- Given Swarm Protocol is fused, when a drone is destroyed (by any source), then a respawn timer of `SWARM_RESPAWN_MS` (3s) is scheduled for that drone's slot; when the timer fires and drone count < `SEEKER_DRONE_MAX_COUNT`, a new drone is spawned from the pool at position (0, 0) or the drone orbit position.
- Given Swarm Protocol is fused, when a drone (any drone) kills an enemy, then a mini-drone spawns at the kill position with `SEEKER_DRONE_BASE_DAMAGE` and `SWARM_MINI_DRONE_LIFETIME_MS` (5s) lifetime.
- Given Swarm Protocol is fused, when the mini-drone count reaches `SWARM_MINI_DRONE_MAX_LIVE` (15), then spawning new mini-drones is skipped (they are silently dropped).
- Given Swarm Protocol is NOT fused, when a drone kills an enemy, then no mini-drone spawns and the drone respawn behavior matches pre-12.3 (no respawn).
- Given Singularity Field is fused, when a mine reaches armed state, then it enters a 1.5s gravity pull phase: enemies within `SINGULARITY_PULL_RADIUS` are nudged toward the mine each fixed step.
- Given Singularity Field is fused, when the gravity pull phase ends, then the mine detonates after a brief delay, dealing `MINE_BASE_DETONATE_DAMAGE * SINGULARITY_IMPLODE_DAMAGE_MULT` (3x) to all enemies in range and calling `gridFieldSystem.pushRipple()` at the mine position.
- Given Singularity Field is fused, when a pulling mine is destroyed before the implode timer fires, then it detonates immediately at normal (non-implosion) damage.
- Given Kaleidoscope is fused, when a bullet wall-bounces, then a clone bullet spawns from the collision point with reflected velocity, same damage, and inherited ricochet params; the clone has `bounced = true` and cannot trigger another Kaleidoscope split.
- Given Kaleidoscope is fused, when the live split-bullet count reaches `KALEIDOSCOPE_SPLIT_POOL_CAP` (50), then new split bullets are not spawned.
- Given Kaleidoscope is NOT fused, when a bullet wall-bounces, then no split occurs (normal ricochet behavior).
- Given Fragmentation Cascade is fused, when a fragment kills an enemy via collision, then a secondary airburst spawns at the kill position with damage `FLAK_FRAGMENT_BASE_DAMAGE / 2` and radius `FLAK_FRAGMENT_RADIUS * 0.5`; the cascade fragments do NOT trigger further cascades.
- Given Fragmentation Cascade is NOT fused, when a fragment kills an enemy, then no secondary airburst occurs (normal flak behavior).
- Given Critical Resonance is fused, when a bullet has the resonance flag and contacts an enemy, then a 20% random check is performed; if it succeeds (crit), the enemy takes 3x damage instead of base damage and a grid shockwave fires at the hit position.
- Given Critical Resonance is fused, when a crit hits and kills an enemy, then the player is awarded `CRITICAL_RESONANCE_XP_REFUND` (1) XP.
- Given Critical Resonance is NOT fused, when a bullet contacts an enemy, then no crit check is performed and the enemy takes normal (non-crit) damage.
- Given a fusion Epic effect is active and an enemy dies via that effect, when the damage is applied, then `collisionSystem.applyPlayerDamage(enemy, ownerPool, damage)` is used (not a direct health decrement).
- Given an offensive system, when `fusionState` is `null`, then all fusion checks short-circuit to `false` and the system behaves identically to pre-12.3 code.
- Given peak build density (all 6 offense Epics fused, max drones, mines, frak, bullets), when measured over 10 seconds, then object pools handle all entity churn with zero per-frame allocation (no `new` or array allocation in any `fixedUpdate` hot path).

## Spec Change Log

## Review Triage Log

## Design Notes

### Pattern: Late-bound fusionState

Each system that implements a fusion Epic accepts an optional `fusionState` (the `progressionState` instance) as its last constructor parameter. The pattern:

```js
constructor(ship, enemyPools, collisionSystem, playerStats = null, fusionState = null) {
  super();
  // ... existing setup ...
  this.fusionState = fusionState;
}

// In fixedUpdate():
const isSunburstActive = this.fusionState && this.fusionState.ownedCards['sunburst'] > 0;
if (isSunburstActive) {
  // ... epic behavior ...
}
```

When `buildArenaWorld.js` passes `progressionState` as the fusionState parameter, the system reads from it each tick. When `fusionState` is null (before Epic 12 is implemented), all Epic checks short-circuit and the system behaves identically to pre-12 behavior.

### Pattern: Fusion Epic detection is opt-in per-system

Each system checks only its own Epic:
- FiringSystem checks for `sunburst` and `critical-resonance` (both affect firing behavior).
- SeekerDroneSystem checks for `swarm-protocol`.
- MineLayerSystem checks for `singularity-field`.
- ricochet.js checks for `kaleidoscope`.
- FlakSystem checks for `fragmentation-cascade`.

### Pattern: NFR11 bounding

All exponential growth mechanisms are bounded:
- Kaleidoscope bullet splits: `KALEIDOSCOPE_SPLIT_POOL_CAP = 50`. The `_kaleidoscopeSplitCount` counter tracks active splits.
- Swarm mini-drone: `SWARM_MINI_DRONE_MAX_LIVE = 15`. The mini-drone pool enforces this via prewarming.
- Singularity Field pull: uses the existing BlackHoleSystem gravitational model (already bounded).
- Fragmentation Cascade: cascade fragments per-hit are hard-coded to a single burst; no recursive chain.
- Sunburst ring: 16 bullets per shot, bounded by the bullet pool (existing pool prewarmed for base bullets).
- Critical Resonance: single bullet with 3x damage — no entity multiplication.

### Integration priority within the epic

6 sub-stories that could be implemented in parallel:

| Sub-story | System | Dependencies | Risk |
|-----------|--------|--------------|------|
| Sunburst ring-fire | FiringSystem | None | LOW — pure additive to existing fire path |
| Kaleidoscope split | ricochet.js | ricochet wall-bounce logic | LOW — pure function extension |
| Fragmentation Cascade | FlakSystem | Fragment kill detection | LOW — single event hook |
| Critical Resonance | CollisionSystem | Bullet-enemy collision hit | MEDIUM — new damage routing, RNG |
| Swarm Protocol | SeekerDroneSystem | Kill detection, respawn timers | MEDIUM — new entity pool (mini-drone) |
| Singularity Field | MineLayerSystem | Armed state, gridFieldSystem | HIGH — new dual-phase state machine |

## Verification

**Commands:**
- `npx eslint src/` -- expected: no lint errors
- `node --experimental-vm-modules node_modules/.bin/jest --testPathPattern="itemRegistry|FiringSystem|SeekerDroneSystem|MineLayerSystem|ricochet|FlakSystem|CollisionSystem" --no-coverage` -- expected: all existing tests pass

**Manual checks:**
- Fuse Orbit Blade Lv5 + Overcharge Lv3 (Tesla Circuit from 12.2) is NOT directly needed for 12.3 — all six offense Epics use their source items directly.
- In-game: verify each Epic triggers only when fused, only the correct system is affected, and all effects respect NFR11 bounding (no framerate drop at max density).
