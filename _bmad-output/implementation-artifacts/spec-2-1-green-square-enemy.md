---
title: 'Story 2.1 — Green Square Enemy'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '699b48d27b96dc078243d2184f8d455f167a0126'
final_revision: '8ee587e5516696dbed8aa83134751406d6e2d71c'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Epic 1 shipped a single enemy — the homing Blue Seeker. The arena needs varied, characterful threats. The Green Square is the first of Epic 2's roster: an enemy that flees the player until provoked, then turns and hunts.

**Approach:** Add the Green Square as its own pooled enemy archetype with a dedicated behavior system (flee away from the player; latch to aggressive pursuit once the player fires near it), and generalize the shared collision / player-death / scoring seams to operate over an array of enemy pools so every current and future archetype plugs into one seam instead of a per-type duplicate.

## Boundaries & Constraints

**Always:**
- All motion, threat detection, and spawn timing derive from the fixed-step `dt` (frame-rate independent) — never raw render time.
- Green squares live in their own prewarmed object `Pool`; the steady-state behavior/spawn path allocates nothing (NFR2).
- All feel, scoring, and color values are centralized constants in `constants.js` — no inline magic numbers.
- The flee→aggro transition is a one-way latch: once provoked, a green square stays aggressive for its lifetime.
- Bullet-kill, player-contact lethality (FR6), and scoring route through the SAME generalized shared seams the Seeker already uses — no parallel duplicate collision/death/scoring path.
- Preserve existing invariants once generalized to multiple pools: a bullet destroys at most one enemy across all pools; at most one player death per fixed step.
- The green square's base score is credited unmultiplied (the multiplier is Epic 3).

**Block If:**
- The existing Seeker collision/death/scoring behavior would have to change *semantically* (not merely generalize from one pool to a list of pools) to accommodate green squares — that signals a hidden conflict in the shared contract. HALT with the specifics.

**Never:**
- Do not implement the spawn director, difficulty ramp, or spawn telegraph (Stories 2.5 / 2.6) — the green square self-spawns on a fixed cadence, mirroring the Seeker, for now.
- Do not add neon/bloom/grid aesthetics — placeholder vector square only (Epic 4).
- Do not fold in a score multiplier (Epic 3).
- Do not merge green squares into the Seeker's pool or `EnemySystem` — keep pool-per-archetype per the epic's architecture.
- Do not add steering/pathfinding beyond "flee directly away" and "home directly toward".

## I/O & Edge-Case Matrix

Scope: one `GreenSquareSystem.fixedUpdate(dt)` step unless noted. "square" = one active green square; "ship" = the homing/flee reference.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flee (unprovoked) | `aggro=false`, ship offset, no active bullet within `THREAT_RADIUS` of square | velocity = unit(square − ship) × `FLEE_SPEED` (directly away); position integrates away; `aggro` stays false | none |
| Threat → aggro | `aggro=false`, an active bullet with center within `THREAT_RADIUS` of the square | `aggro` latches to true this tick; velocity homes = unit(ship − square) × `CHASE_SPEED` | none |
| Aggro pursuit | `aggro=true`, ship offset | velocity = unit(ship − square) × `CHASE_SPEED` (toward ship); position integrates toward ship | none |
| Aggro latched | `aggro=true`, no bullet near | stays aggressive; keeps homing toward the ship | none |
| Coincident with ship | square exactly at ship position (either state) | zero velocity, no NaN, position unchanged | `mag>0` guard |
| Wall clamp | integrated position would exit the arena inset bound | position clamped to `[INSET+RADIUS, DIM−INSET−RADIUS]` on each axis | none |
| Spawn cadence | `T` ms of accumulated fixed steps elapse | ≈ `floor(T / SPAWN_INTERVAL_MS)` squares spawned on random arena edges, each `aggro=false`, tick-size independent | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add Green Square feel/scoring/color constants (radius, flee/chase speeds, threat radius, spawn interval, pool prewarm, score, color).
- `src/entities/GreenSquare.js` -- NEW pooled entity factory, mirrors `Seeker.js`; shape adds a boolean `aggro`.
- `src/systems/GreenSquareSystem.js` -- NEW behavior system: per-tick flee/threat/aggro/home + integrate + clamp, and fixed-cadence edge spawn. Mirrors `EnemySystem.js`; also reads the bullet pool for threat detection.
- `src/systems/CollisionSystem.js` -- generalize the single `enemyPool` to an array `enemyPools`; rename the public `killedSeekers` report to `killedEnemies`; release each hit enemy to its owning pool.
- `src/systems/ScoringSystem.js` -- read `collisionSystem.killedEnemies` (was `killedSeekers`); logic otherwise unchanged (credits each killed enemy's own `score`).
- `src/systems/PlayerDeathSystem.js` -- generalize the single `enemyPool` to an array `enemyPools`; test the ship against every active enemy across all pools.
- `src/scenes/ArenaScene.js` -- construct `GreenSquareSystem` (after `EnemySystem`, before `CollisionSystem`); pass both enemy pools as arrays to `CollisionSystem` and `PlayerDeathSystem`; add a green-square render pass (placeholder filled square).
- `src/systems/greenSquareSystem.test.js` -- NEW unit tests (behavior, threat/aggro, frame-rate independence, spawn, pooling, factory).
- `src/systems/collisionSystem.test.js` -- update to the array constructor and `killedEnemies`; add a multi-pool case.
- `src/systems/scoringSystem.test.js` -- update the collision stub to expose `killedEnemies`.
- `src/systems/playerDeathSystem.test.js` -- update to the array constructor; add a green-square-in-second-pool lethal case.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `GREEN_SQUARE_RADIUS`, `GREEN_SQUARE_FLEE_SPEED`, `GREEN_SQUARE_CHASE_SPEED`, `GREEN_SQUARE_THREAT_RADIUS`, `GREEN_SQUARE_SPAWN_INTERVAL_MS`, `GREEN_SQUARE_POOL_PREWARM`, `GREEN_SQUARE_SCORE`, `COLOR_GREEN_SQUARE` -- centralized tunables for the new archetype.
- `src/entities/GreenSquare.js` -- add `createGreenSquare()` returning `{ x, y, vx, vy, radius, score, aggro:false }` -- pool factory; a well-defined zeroed shape re-initialized on spawn.
- `src/systems/GreenSquareSystem.js` -- implement flee/threat/aggro/home behavior, position integration + arena clamp, and fixed-cadence edge spawning; own the green-square `Pool` (prewarmed); read the bullet pool for threat detection -- the archetype's behavior + spawn.
- `src/systems/CollisionSystem.js` -- accept `enemyPools` (array); materialize enemies across all pools with their owning pool; keep the one-hit-per-bullet pass; release each hit enemy to its pool; expose `killedEnemies` -- one collision seam for all archetypes.
- `src/systems/ScoringSystem.js` -- read `killedEnemies` -- credit every killed archetype's base score.
- `src/systems/PlayerDeathSystem.js` -- accept `enemyPools` (array); test the ship against active enemies across all pools; unchanged death/respawn/invuln flow -- one lethality seam for all archetypes.
- `src/scenes/ArenaScene.js` -- wire `GreenSquareSystem` in order and pass pool arrays; add the placeholder green-square render pass -- integrate into the running game.
- `src/systems/greenSquareSystem.test.js` -- unit-test every I/O-matrix row (flee, threat→aggro, aggro home, latch, coincident, clamp, spawn cadence/placement) plus pool prewarm and the factory default -- lock the behavior contract.
- `src/systems/{collisionSystem,scoringSystem,playerDeathSystem}.test.js` -- update to the generalized signatures and add the multi-pool cases -- keep the shared seams green and cover the new pool.

**Acceptance Criteria:**
- Given a running game with a green square spawned and no bullets near it, when a fixed step runs, then the square moves directly away from the ship at the flee speed and remains non-aggressive.
- Given a fleeing green square, when an active player bullet is within the threat radius, then it latches to aggressive and, on that and every later step, homes toward the ship at the chase speed even after the bullet is gone.
- Given a player bullet overlapping a green square, when `CollisionSystem` runs, then the square is released to its pool, the bullet is consumed, the square appears in `killedEnemies`, and `ScoringSystem` adds its base score to `ScoreState`.
- Given a non-invulnerable ship overlapping a green square (fleeing or aggressive) in the second enemy pool, when `PlayerDeathSystem` runs, then the standard death flow fires (life lost then respawn, or game-over on the last life), at most one death per step.
- Given equal elapsed sim time split into fine vs. coarse fixed steps, when the square flees or chases, then its net displacement matches within one coarse step (frame-rate independence).
- Given the green-square behavior and spawn path runs for many steps, when observed, then the pool is prewarmed and recycles instances with no growth beyond prewarm (no per-frame allocation).
- Given a fresh run started via `scene.restart()`, when it begins, then the green-square pool, system, and state are rebuilt from zero alongside the existing run-scoped objects.

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 7: (high 0, medium 4, low 3)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` CollisionSystem + PlayerDeathSystem materialized their multi-pool active sets with a fresh arrow closure per pool per tick, contradicting each class's "zero per-frame allocation" contract — hoisted one reusable collect callback (tracking the current owning pool in CollisionSystem) so materialization is O(1)-alloc for any pool count.
  - `[low]` `[patch]` The green-square render used the module constant `GREEN_SQUARE_RADIUS` instead of the instance's own `s.radius` (the seeker render already uses `s.radius`), risking sprite/hitbox divergence if a per-instance radius is ever introduced — switched to `s.radius` and removed the now-unused import.
  - `[low]` `[patch]` `_spawnOne`'s `s.aggro = false` reset was pinned by no test (a fresh pool's instances are already `false` from the factory, so the existing spawn-aggro test passes even if the reset is deleted) — added a regression test that provokes a square to aggressive, releases it, respawns, and asserts the recycled instance comes back fleeing.

## Design Notes

**Why generalize the shared seams to an array of pools.** The epic mandates a pool per archetype with collision/death/scoring as shared seams. Making green squares killable, lethal, and scorable *requires* those three consumers to see the green-square pool this story — it is not speculative. Generalizing the single `enemyPool` to `enemyPools` (a list) is the minimal honest shape and serves NFR8; later Epic-2 archetypes reuse it unchanged. Enemy instances share the uniform `{x,y,vx,vy,radius,score}` shape, so the seams read only `x,y,radius,score` and stay type-agnostic.

**Threat detection = bullet proximity.** "The player fires toward it" is modeled as: an active bullet's center lies within `GREEN_SQUARE_THREAT_RADIUS` of the square — a deterministic, unit-testable proxy for aiming-and-firing. `THREAT_RADIUS` exceeds the bullet+square collision radius, so a near-miss provokes while a direct hit destroys. `GreenSquareSystem` runs before `CollisionSystem`, so the latch is recorded before a hit can release the square.

**Player-contact lethality is in-scope.** AC2's aggressive square "pursues the player"; pursuit with no threat is incoherent, and FR6 makes contact lethal for all enemies. Green squares kill on contact regardless of aggro state, via the generalized `PlayerDeathSystem` — not a new path.

**Homing/flee math reuse.** Aggro homing equals the Seeker's `unit(ship − self) × speed`; flee is its negation. Reuse the coincident-position `mag>0` guard to avoid NaN. Example (per active square):

```js
const dx = ship.x - s.x, dy = ship.y - s.y;
const mag = Math.hypot(dx, dy);
const speed = s.aggro ? CHASE_SPEED : FLEE_SPEED;
const sign = s.aggro ? 1 : -1;           // toward ship vs. away
if (mag > 0) { s.vx = sign * dx / mag * speed; s.vy = sign * dy / mag * speed; }
else { s.vx = 0; s.vy = 0; }
s.x += s.vx * dtSec; s.y += s.vy * dtSec;
// clamp x,y into [INSET+RADIUS, DIM−INSET−RADIUS]
```

Collision remains circle-circle on `radius` for consistency; the square is only the *rendered* placeholder shape (`fillRect` centered on the entity).

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `greenSquareSystem.test.js` and the updated collision/scoring/death suites.
- `npm run build` -- expected: production build succeeds with no errors.

**Manual checks:**
- `npm run dev`, then in the arena: green squares spawn on the edges and flee from the ship; firing near one flips it to chasing you; a bullet that hits one destroys it and the score jumps by its value; touching one (while not invulnerable) costs a life; a fresh restart shows the same behavior.

## Auto Run Result

Status: done

**Implemented change:** Added the Green Square archetype — a flee-until-provoked enemy with a one-way aggro latch (provoked when a player bullet's center comes within the threat radius), fleeing directly away while unprovoked and homing toward the ship once aggressive — as its own pooled entity + behavior system. Generalized the three shared consumer seams (collision, player-death, scoring) from a single enemy pool to an array of enemy pools so every archetype routes through one seam: green squares are destroyed by bullets (awarding their base score) and are lethal to the ship on contact (FR6), in either behavior state.

**Files changed:**
- `src/config/constants.js` — added Green Square feel/scoring/color constants.
- `src/entities/GreenSquare.js` — NEW `createGreenSquare()` pool factory (`{x,y,vx,vy,radius,score,aggro:false}`).
- `src/systems/GreenSquareSystem.js` — NEW flee/threat/aggro/home + integrate + arena-clamp behavior and fixed-cadence edge spawn; owns a prewarmed pool; reads the bullet pool for threat detection.
- `src/systems/CollisionSystem.js` — generalized to an array of enemy pools; renamed the kill report `killedSeekers`→`killedEnemies`; releases each hit enemy to its owning pool.
- `src/systems/ScoringSystem.js` — reads `killedEnemies`.
- `src/systems/PlayerDeathSystem.js` — generalized to an array of enemy pools.
- `src/scenes/ArenaScene.js` — wires `GreenSquareSystem` (after EnemySystem, before CollisionSystem), passes both enemy pools as arrays to the collision/death systems, and renders green squares.
- `src/systems/greenSquareSystem.test.js` — NEW (23 tests).
- `src/systems/{collisionSystem,scoringSystem,playerDeathSystem}.test.js` — updated to the generalized signatures + multi-pool cases.

**Review findings breakdown:** 4 patches applied (all low severity), 7 findings deferred (in 3 ledger entries), 9 rejected as noise.
- Patches: hoisted the per-pool materialization closures in CollisionSystem/PlayerDeathSystem (true zero-per-tick allocation for any pool count); green-square render now draws from the instance `s.radius` (matching the seeker render); added a regression test pinning the `_spawnOne` aggro-reset on a recycled instance.
- Deferred: (1) ArenaScene green-square wiring/ordering/render has no headless integration coverage — joins the existing Phaser-boundary harness deferral from Stories 1.1–1.6; (2) straight-line flee self-corners and squares accumulate at walls (no despawn/cap) — feel/balance for playtest, entangled with Story 2.5's spawn cap/despawn; (3) instant-spawn-on-ship risk shared with the Seeker — spawn-safety owned by Story 2.6's spawn telegraph.
- Rejected (noise): lazy pool growth beyond prewarm (by-design, matches the Seeker precedent; not a per-frame hot-loop allocation), directional/tunneling threat-model objections (proximity is a documented, defensible reading of AC2's "/it is threatened"), duplicate-pool/`Array.isArray` defensive-guard suggestions (no such caller; hot-path cost), out-of-range-RNG edge selection (pre-existing Seeker idiom, standard `[0,1)` contract), and the rename-reader check (grep confirmed no stale readers).

**Follow-up review recommended:** false (patched findings: 0 high, 0 medium, 4 low; score 3×0 + 1×4 = 4 < 5).

**Verification performed:**
- `npm test` — 11 files, 130 tests, all pass (new `greenSquareSystem.test.js` at 23; updated collision/scoring/death suites green).
- `npm run build` — production build succeeds (the >500 kB chunk-size notice is pre-existing bundled-Phaser, not from this change).
- Matrix Test Audit: every I/O-matrix row (flee, threat→aggro, aggro pursuit, latched, coincident, wall clamp, spawn cadence) has a covering test that ran and passed.

**Residual risks:**
- Tunable feel values (radius, flee/chase speeds, threat radius, spawn interval, score) are implementer choices left open by the spec — worth a manual playtest pass.
- Manual in-browser checks (`npm run dev`) were not run in this headless environment; behavior is covered by unit tests, and the ArenaScene render/wiring layer remains the deliberately-untested Phaser boundary (deferral D1).
- `final_revision` records the dev-auto commit (`8ee587e`); the visible HEAD is the amended commit that folds in this result section.
