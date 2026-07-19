---
title: 'Story 2.4 — Black Hole Hazard'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'd757d0e301486bed2e4f6b617e3a5e7e3e623b5a'
final_revision: 'b19d595a658d9d03130f070aa8245d7e73600f01'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Epic 2's roster so far is a set of discrete kill-them-or-dodge-them threats. The arena still lacks the signature RE1 *high-risk object*: a gravity well that warps the flow of the whole battlefield — pulling the ship, enemies, and bullets toward it, growing as it devours them, and paying off big when finally destroyed.

**Approach:** Add the Black Hole as its own pooled hazard archetype (`BlackHole` factory + `BlackHoleSystem`). Unlike the one-hit enemies it is a stationary, HP-based destructible: each fixed step it applies an attractive positional pull to every nearby ship/bullet/enemy (inverse-distance falloff, `dt`-scaled), *feeds* on bullets and enemies that reach its body (growing its radius and periodically emitting a new enemy at the arena edge), takes bullet damage toward destruction, and on death credits a big score payout and is removed. It reuses the existing seams non-invasively: contact-lethality via the shared `PlayerDeathSystem` pool list (added there but NOT to the `CollisionSystem` list, since it is multi-hit not one-shot), and absorbed enemies are removed through the established `collisionSystem.killedEnemies` reconciliation seam so owner systems (SnakeSystem) stay consistent. Its grid-warping visual is deferred to Epic 4 — placeholder circle only.

## Boundaries & Constraints

**Always:**
- All gravity displacement, feed cadence, and spawn cadence derive from the fixed-step `dt` (never render time). Gravity is applied as a **position** nudge (`x += unit·strength·falloff·dtSec`), so it survives the enemy movers (which integrate `x += v·dt`, never assign absolute positions) and the bullet integrator running earlier in the tick.
- The Black Hole lives in ONE prewarmed `Pool` owned by `BlackHoleSystem` (public `holePool`); the steady-state gravity/absorb path allocates nothing (NFR2). Hole/enemy struct allocation happens only on spawn/absorb/detonate events, never per frame.
- Contact-lethality is achieved by adding `holePool` to the pool list passed to the existing `PlayerDeathSystem` ONLY — reading its uniform `{x,y,radius}` shape. The hole is NOT added to the `CollisionSystem` pool list (one bullet must NOT one-shot it).
- Bullet-vs-hole and enemy-vs-hole interaction is owned entirely by `BlackHoleSystem` (its own circle test against each hole body), separate from the shared `CollisionSystem` bullet↔enemy pass.
- An absorbed enemy is released to its OWN owning pool AND recorded in `collisionSystem.killedEnemies`, so stateful owner systems (SnakeSystem's chain reap) reconcile through the same removal seam a bullet-kill uses. `BlackHoleSystem` runs AFTER `ScoringSystem` so absorbed enemies are removed but NOT scored (only the player's own kills and the detonation payout score).
- The detonation payout is credited by adding `BLACKHOLE_SCORE` directly to the shared `ScoreState` (an event payout, not a per-tick one-shot kill — the `ScoringSystem`/`killedEnemies` seam is specifically for one-hit bullet kills).
- All feel/economy/color values are centralized constants in `constants.js` — no inline magic numbers.

**Block If:**
- Making the hole contact-lethal, feedable, or destructible would require changing the *semantics* of a shared seam (`CollisionSystem` / `PlayerDeathSystem` / `ScoringSystem` / `Pool`) rather than composing pool lists / appending to the existing `killedEnemies` report — that signals a hidden conflict. HALT with specifics.

**Never:**
- Do not implement the spawn director, global difficulty ramp, or spawn telegraph / spawn-safety (Stories 2.5 / 2.6). The hole self-spawns on a fixed cadence with a small per-archetype `BLACKHOLE_MAX_ACTIVE` guard (a sanity cap so O(holes×entities) gravity stays bounded — NOT the director's global cap/mix/ramp).
- Do not implement the grid-warp visual (Epic 4 / Story 4.2) — placeholder filled circle only.
- Do not fold in a score multiplier (Epic 3) — credit the raw `BLACKHOLE_SCORE` payout unmultiplied.
- Do not merge the hole into another archetype's pool/system, and do not make gravity mutate entity *velocity* (the enemy movers recompute velocity each tick and would erase it; position-nudge is the robust model).
- Do not edit `CollisionSystem` / `PlayerDeathSystem` / `ScoringSystem` / `Pool` / `SnakeSystem` source (compose lists and reuse the `killedEnemies` seam instead).

## I/O & Edge-Case Matrix

Scope: one `BlackHoleSystem.fixedUpdate(dt)` step unless noted. `holePool` is late-bound to `collisionSystem` (like SnakeSystem) — until set, enemy absorption is a guarded no-op (gravity/bullet-feed still run).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gravity pull (AC1) | entity (ship/bullet/enemy) at distance `d`, `0 < d < GRAVITY_RADIUS` | entity position moved toward the hole by `GRAVITY_STRENGTH·(1 − d/GRAVITY_RADIUS)·dtSec` along the unit vector | none |
| Gravity beyond range | entity at `d ≥ GRAVITY_RADIUS` | entity not moved | none |
| Gravity at the core | entity coincident with hole (`d == 0`) | entity not moved (no direction; no NaN) | guard `d>0` |
| Gravity dt-scaling | same entity/hole, one step of `dt` vs `2·dt` | the `2·dt` nudge is twice the `dt` nudge (pull ∝ dtSec) | none |
| Bullet feed + damage (AC2/AC3) | active bullet overlaps hole body (`d ≤ hole.radius + bullet.radius`) | bullet released to bullet pool; `hole.hp −= BLACKHOLE_BULLET_DAMAGE`; `hole.feed += 1`; radius grows | none |
| Enemy absorption (AC2) | active enemy overlaps hole body; `collisionSystem` set | enemy released to its OWN pool AND pushed to `collisionSystem.killedEnemies`; `hole.feed += 1`; radius grows; enemy NOT scored | none |
| Absorption before late-bind | enemy overlaps hole body; `collisionSystem == null` | no absorption (guarded); gravity/bullet-feed still run | guard on null |
| Growth cap | fed hole already at `BLACKHOLE_MAX_RADIUS` | radius stays `BLACKHOLE_MAX_RADIUS` (clamped) | clamp |
| Feed → enemy spawn (AC2) | `hole.feed` reaches `BLACKHOLE_FEED_PER_SPAWN` | one seeker spawned at a random arena edge (into `spawnPool`); `hole.feed −= BLACKHOLE_FEED_PER_SPAWN` | none |
| Detonation (AC3) | `hole.hp ≤ 0` after damage | `scoreState.score += BLACKHOLE_SCORE`; hole released from `holePool` (no longer active/lethal) | none |
| Ship contact (AC3) | non-invuln ship overlaps an undestroyed hole; `PlayerDeathSystem` over `[…enemyPools, holePool]` | standard death flow (life lost + respawn, or game-over on last life); at most one death/step; hole NOT destroyed | none |
| Ship contact while invulnerable | ship overlaps hole, `invulnMs > 0` | no death (PlayerDeathSystem guards) | none |
| Self-spawn cadence + cap | `T` ms accumulated, `< BLACKHOLE_MAX_ACTIVE` holes active | ≈`floor(T/INTERVAL)` holes spawned at random interior points until the cap; none beyond the cap until one is destroyed | none |
| Pool prewarm / no growth | many steady-state steps | `holePool` prewarmed; gravity/absorb path grows nothing beyond prewarm (no per-frame allocation) | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add Black Hole feel/economy/color constants (initial + max radius, gravity radius + strength, HP + bullet damage, growth-per-feed, feed-per-spawn, spawn interval, max-active, pool prewarm, detonation score, color).
- `src/entities/BlackHole.js` -- NEW pooled factory; shape `{x, y, radius, hp, feed}` (stationary — no velocity). `radius` grows, `hp` depletes, `feed` accumulates toward the next enemy spawn. Re-initialized on spawn.
- `src/systems/BlackHoleSystem.js` -- NEW hazard system. Owns the prewarmed `holePool` (public). Constructor `(ship, bulletPool, enemyPools, spawnPool, scoreState, rng = Math.random)`; a settable `collisionSystem` (late-bound by the scene; enemy absorption is a guarded no-op until set). Per tick, per active hole: (1) apply gravity to ship + every active bullet + every active enemy; (2) feed on overlapping bullets (consume + damage + feed) and overlapping enemies (release to owner pool + append to `killedEnemies` + feed); (3) grow (clamped) and, per `BLACKHOLE_FEED_PER_SPAWN`, emit a seeker at a random arena edge into `spawnPool`; (4) if `hp ≤ 0`, credit `BLACKHOLE_SCORE` to `scoreState` and release the hole (deferred second pass — no mid-iteration release). Then self-spawn at cadence, capped at `BLACKHOLE_MAX_ACTIVE`, at random interior points.
- `src/scenes/ArenaScene.js` -- construct `BlackHoleSystem` (after `ScoringSystem`, before `PlayerDeathSystem`); create `ScoreState` before it; pass the shared `enemyPools`, `firingSystem.bulletPool`, `enemySystem.enemyPool` (spawn target), and `scoreState`; late-bind `blackHoleSystem.collisionSystem = this.collisionSystem`; build the death pool list as `[...enemyPools, blackHoleSystem.holePool]` for `PlayerDeathSystem` (hole is lethal-on-contact but NOT in the `CollisionSystem` list); add a placeholder hole render pass (filled circle in `COLOR_BLACK_HOLE`, zero per-frame allocation).
- `src/systems/blackHoleSystem.test.js` -- NEW unit tests: every I/O-matrix row (gravity pull / out-of-range / core / dt-scaling, bullet feed+damage, enemy absorption via the REAL `CollisionSystem.killedEnemies`, guarded pre-late-bind, growth cap, feed→spawn, detonation payout, ship-contact + invuln through the REAL `PlayerDeathSystem` over `[holePool]`, self-spawn cadence+cap, pool prewarm/no-growth) plus the factory default.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `BLACKHOLE_RADIUS`, `BLACKHOLE_MAX_RADIUS`, `BLACKHOLE_GRAVITY_RADIUS`, `BLACKHOLE_GRAVITY_STRENGTH`, `BLACKHOLE_HP`, `BLACKHOLE_BULLET_DAMAGE`, `BLACKHOLE_GROWTH_PER_FEED`, `BLACKHOLE_FEED_PER_SPAWN`, `BLACKHOLE_SPAWN_INTERVAL_MS`, `BLACKHOLE_MAX_ACTIVE`, `BLACKHOLE_POOL_PREWARM`, `BLACKHOLE_SCORE`, `COLOR_BLACK_HOLE` -- centralized tunables (placeholders; tuned post-launch).
- `src/entities/BlackHole.js` -- add `createBlackHole()` returning `{x, y, radius: BLACKHOLE_RADIUS, hp: BLACKHOLE_HP, feed: 0}` -- pooled factory; a well-defined shape re-initialized on spawn.
- `src/systems/BlackHoleSystem.js` -- implement gravity (position-nudge with inverse-distance falloff, `dt`-scaled) over ship+bullets+enemies; bullet feed+damage and enemy absorption (release to owner pool + append to `killedEnemies`, guarded until `collisionSystem` set); growth (clamped) + feed-driven edge spawn into `spawnPool`; detonation payout to `scoreState` + deferred release; self-spawn cadence with `BLACKHOLE_MAX_ACTIVE` cap at random interior points; own the prewarmed `holePool` -- the hazard's whole lifecycle.
- `src/scenes/ArenaScene.js` -- construct `BlackHoleSystem` in order (after Scoring, before PlayerDeath), move `ScoreState` creation ahead of it, late-bind `collisionSystem`, pass the death pool list `[...enemyPools, holePool]` to `PlayerDeathSystem` (and NOT the hole to `CollisionSystem`), and add the placeholder hole render pass -- integrate into the running game.
- `src/systems/blackHoleSystem.test.js` -- unit-test every I/O-matrix row plus the factory default and AC2/AC3 through the real shared seams (`CollisionSystem.killedEnemies`, `PlayerDeathSystem` over `[holePool]`, `ScoreState`) -- lock the gravity, feed/grow/spawn, destruction, and contact-lethality contracts.

**Acceptance Criteria:**
- Given a Black Hole is present and the ship, an enemy, or a bullet is within `BLACKHOLE_GRAVITY_RADIUS`, when a fixed step runs, then each is displaced toward the hole by a `dt`-scaled, distance-falloff pull, and anything at or beyond the radius is unaffected (FR13).
- Given a Black Hole, when a bullet or an enemy reaches its body, then it is consumed (bullet released to the bullet pool / enemy released to its own pool and reconciled through `collisionSystem.killedEnemies`), the hole's radius grows (clamped at `BLACKHOLE_MAX_RADIUS`), and every `BLACKHOLE_FEED_PER_SPAWN` feeds it emits one new seeker at a random arena edge (FR13).
- Given the player puts `BLACKHOLE_HP` worth of bullet damage into a Black Hole, when its hp reaches zero, then `BLACKHOLE_SCORE` is added to `ScoreState` and the hole is removed from its pool (and stops being lethal/gravitational).
- Given a non-invulnerable ship overlapping an undestroyed Black Hole, when `PlayerDeathSystem` runs over the pool list containing `holePool`, then the standard death flow fires (life lost + respawn, or game-over on the last life), at most one death per step, and the hole is NOT destroyed (FR6/FR13).
- Given equal elapsed sim time split into fine vs. coarse fixed steps, when gravity pulls an entity from a fixed distance, then the single-step displacement scales with `dt` (the pull derives from `dt`, not tick count).
- Given the gravity/feed/absorb path runs for many steps, when observed, then `holePool` is prewarmed and recycles instances with no growth beyond prewarm (no per-frame allocation on the steady-state path).

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 5: (high 0, medium 4, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` A detonating hole (`hp ≤ 0` on its killing bullet) still ran `_feed` on the killer and kept absorbing the remaining overlapping bullets/enemies into a corpse — growing an about-to-be-freed hole and emitting a phantom seeker. Made the bullet loop `break` once `hp ≤ 0`, guarded the killing blow's feed (`if (hp > 0) _feed`), and gated the enemy-absorption loop on `hp > 0`; added a covering test (one-hit-from-death hole + 3 overlapping bullets → detonates, no growth, no seeker emitted, only the killing bullet consumed).
  - `[low]` `[patch]` The absorption owner-routing (`releaseEnemyOwners[i].release(e)`) was tested only over a single seeker pool, while production wires four pools — a routing regression would ship green. Added a multi-pool absorption test (`[seekerPool, pinwheelPool]`, enemy in the second pool → released to its own pool, first untouched, appears in the real `collisionSystem.killedEnemies`).
  - `[low]` `[patch]` The snake-segment reconciliation the design leans on (absorbed segment released to its pool AND pushed to `killedEnemies` so `SnakeSystem._reap` splits the chain) was unverified. Added a real-`SnakeSystem` + real-`CollisionSystem` test: the hole absorbs a mid-chain segment, and after the next `SnakeSystem.fixedUpdate` the segment is gone from all chains, the snake split in two, and pool state is consistent (no orphan/double-release).
  - `[low]` `[patch]` The new tests reached into `Pool`'s private `_active` Set (`[...pool._active][0]`); replaced all three sites with a public-API helper over `forEachActive`/`activeCount`.

## Design Notes

**Why a position-nudge gravity, not a velocity force.** The enemy movers (`EnemySystem`, `GreenSquareSystem`, `PinwheelSystem`, `SnakeSystem`) recompute or integrate velocity from scratch each tick, so any velocity a gravity force added would be erased before it moved anything. Every mover advances position as `x += …` (never an absolute assignment), so a **position** displacement applied after them (BlackHoleSystem runs late in the tick) accumulates correctly and is frame-rate-independent because it is scaled by `dtSec`. The pull uses a linear inverse-distance falloff so it strengthens toward the core:

```js
const dx = hole.x - e.x, dy = hole.y - e.y;
const d = Math.hypot(dx, dy);
if (d > 0 && d < BLACKHOLE_GRAVITY_RADIUS) {
  const pull = BLACKHOLE_GRAVITY_STRENGTH * (1 - d / BLACKHOLE_GRAVITY_RADIUS) * dtSec;
  const inv = pull / d;               // (pull) × unit(dx,dy)
  e.x += dx * inv; e.y += dy * inv;
}
```

**Why HP-based, out of the CollisionSystem list.** AC3 ("damages it enough") makes the hole multi-hit destructible — the opposite of the one-shot enemies `CollisionSystem` releases. So the hole is NOT in the collision pool list; `BlackHoleSystem` owns its own bullet test (consume + `hp -= damage` + feed). It IS in the `PlayerDeathSystem` pool list, whose seam only reads `{x,y,radius}` and kills the player without destroying the collider — exactly the contact-lethal-hazard semantics AC3 needs, for free. ArenaScene therefore passes two different lists: `enemyPools` to `CollisionSystem`, and `[...enemyPools, holePool]` to `PlayerDeathSystem`.

**Why absorption rides `killedEnemies`.** Bullets have no owner-side state, so an absorbed bullet is released directly. But a snake segment is referenced by `SnakeSystem`'s `snakes[].segments[]` struct; releasing it to the pool alone would leave a zombie in that struct. `SnakeSystem._reap` already removes any of its segments that appear in `collisionSystem.killedEnemies` (the removal-reconciliation seam it consumes each tick). So an absorbed enemy is released to its pool AND pushed onto `killedEnemies`; the snake reconciles on its next tick exactly as it does for a bullet kill — uniformly for every archetype, no `SnakeSystem` edit. `BlackHoleSystem` is ordered AFTER `ScoringSystem`, so these appended absorptions are removed but not scored (the reset at the top of the next `CollisionSystem` tick clears them before scoring runs again; `SnakeSystem`, which runs before that reset, still sees them). The one-tick reap delay is the snake's existing, tested behavior.

**Why the detonation payout writes ScoreState directly.** `ScoringSystem` sums `killedEnemies[i].score` — the one-hit bullet-kill seam. The hole's payout is a lifecycle *event* (destruction), not a per-tick kill, and it must not be multiplied or double-counted; `BlackHoleSystem` adds `BLACKHOLE_SCORE` to the same `ScoreState.score` surface the HUD reads. Both scoring paths converge on that one observable value.

**Feed emits at the edge, not the core.** A fed enemy spawns at a random arena edge (the established `_spawnOne` placement), not next to the hole — otherwise this hole's own gravity would suck it straight back in and re-feed, a runaway loop. `BLACKHOLE_MAX_ACTIVE` (default 1) keeps gravity O(1 hole × entities) and matches RE1's rare-hazard feel; the global cadence/mix/cap is Story 2.5's job. Deferred (mirrors prior archetypes): the hole self-spawns at a random interior point with no ship-proximity check, so it can appear on/near the ship for an unavoidable death — spawn-safety is Story 2.6's; the grid-warp visual is Epic 4 / Story 4.2.

**Release safety.** Detonating holes and (defensively) any pool mutation during a `forEachActive` walk are deferred to a post-iteration pass (collect, then release), mirroring `CollisionSystem`'s two-pass discipline.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `blackHoleSystem.test.js` and the unchanged collision/scoring/death/snake suites.
- `npm run build` -- expected: production build succeeds with no errors.

**Manual checks:**
- `npm run dev`, then in the arena: a black hole appears and visibly pulls the ship, drifting enemies, and bullets toward it; feeding it (letting enemies/bullets reach it) grows it and periodically emits a new enemy from an edge; sustained fire eventually destroys it with a score jump and it vanishes (pull stops); touching an undestroyed hole (while not invulnerable) costs a life; a fresh restart shows the same behavior.

## Auto Run Result

Status: done

**Summary of implemented change:** Added the Black Hole hazard (Story 2.4) as a new pooled archetype: a stationary, HP-based destructible gravity well. Each fixed step `BlackHoleSystem` applies a `dt`-scaled, inverse-distance-falloff position pull to the ship, every active bullet, and every active enemy; feeds on bullets (consume + damage + grow) and enemies (release to the owner pool + reconcile via `collisionSystem.killedEnemies` + grow) that reach its body; emits a seeker at a random arena edge every `BLACKHOLE_FEED_PER_SPAWN` feeds; and on `hp ≤ 0` credits `BLACKHOLE_SCORE` to `ScoreState` and is removed. Contact-lethality reuses `PlayerDeathSystem` (the hole is added to its pool list only, never to `CollisionSystem`'s one-shot list); the system is ordered after `ScoringSystem` and before `PlayerDeathSystem`. Grid-warp visual deferred to Epic 4 — placeholder filled circle only.

**Files changed:**
- `src/config/constants.js` — added 13 Black Hole tunables + `COLOR_BLACK_HOLE` (centralized placeholders).
- `src/entities/BlackHole.js` — NEW pooled factory; stationary `{x,y,radius,hp,feed}` shape.
- `src/systems/BlackHoleSystem.js` — NEW hazard system: gravity + feed/grow/edge-spawn + clean detonation + self-spawn (cadence, `BLACKHOLE_MAX_ACTIVE` cap); zero steady-state allocation, two-pass deferred release.
- `src/scenes/ArenaScene.js` — construct/order `BlackHoleSystem` (after Scoring, before PlayerDeath), late-bind `collisionSystem`, `deathPools = [...enemyPools, holePool]` for `PlayerDeathSystem` (hole kept out of `CollisionSystem`), placeholder circle render pass.
- `src/systems/blackHoleSystem.test.js` — NEW; 27 tests covering every I/O-matrix row plus the review-added detonation-cleanliness, multi-pool owner-routing, and real-`SnakeSystem` reconciliation tests.

**Review findings breakdown (4 layers: adversarial, edge-case, verification-gap, intent-alignment):**
- Patches applied: 4 (all low). Clean detonation (killing bullet no longer feeds/grows/emits, and a detonating hole absorbs nothing further that tick); multi-pool absorption owner-routing test; real-`SnakeSystem` mid-chain absorption reconciliation test; test hygiene (public Pool API instead of private `_active`).
- Deferred: 5 — (1) feed-spawn no-cap + emitted seekers can re-enter the gravity radius (sub-critical; 2.5 territory); (2) gravity can permanently clump a snake below its follow-spacing (feel; snake motion-model); (3) gravity can drag an enemy onto the ship for a same-tick death (near-well fairness; 2.6 family); (4) hole spawns at a random interior point incl. the respawn point with no proximity check and gravity ignores invuln (spawn-safety; 2.6); (5) `ArenaScene` wiring/order + the AC1 nudge-survives-movers invariant are only hand-reproduced in unit tests, and that invariant's blanket rationale is imperfect though the observable holds (integration-harness gap, same as Stories 1.1–2.3).
- Rejected: 10 — dead cross-hole dedupe under `MAX_ACTIVE=1` (by-design forward-compat), ship-drift-after-game-over (false: the scene freezes the sim on game over), hardcoded `SEEKER_RADIUS` in a seeker-named method (by-design), banked spawn time discarded at cap (by-design, prevents burst backlog), same-tick order-dependent absorption (negligible ~1.5px), over-cap radius never clamps down (unreachable), `MAX_ACTIVE>1` overlapping holes (not reachable at default), and the three deliberate intent narrowings (kinematic-warp not momentum, seekers-only emission, score-only payout — visuals deferred).

**Follow-up review recommendation:** false. Patched findings this pass = 4 (high 0, medium 0, low 4); score = 3×0 + 1×4 = 4 (< 5), no high-severity patch.

**Verification performed:** `npm test` → 14 suites, 215 tests pass (including `blackHoleSystem.test.js`, 27 tests). `npm run build` → production build succeeds (the >500 kB chunk notice is the pre-existing Phaser bundle-size advisory, not a failure).

**Residual risks:** All carried by the deferred-work ledger (orchestrator-owned): the feed-spawn cap/re-feed balance and the near-well fairness/spawn-safety/clumping feel items (entangled with Stories 2.5/2.6 and the snake motion model), and the `ArenaScene` integration-harness + gravity-through-movers verification gap. No open risk against this story's literal ACs.
