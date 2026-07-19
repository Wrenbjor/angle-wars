---
title: 'Story 1.4 — Blue Seeker Enemy'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '352511352335b2c04756138011a1b342dbb55249'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: 'b559d300c36b6bcebdb5a2460659ee9726c9c6e7'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The arena has a ship that flies and fires (Stories 1.2–1.3), but nothing to fight: no enemy spawns, homes, or can be destroyed, so there is no kill loop and later stories (1.5 player death, 1.6 score) have no enemy to collide with or score against.

**Approach:** Add the Blue Seeker — a pooled, Phaser-free enemy that spawns at the arena edge on a fixed cadence and, each fixed step, homes straight toward the player's current position at a constant speed. A `CollisionSystem` (also Phaser-free) tests active bullets against active seekers each fixed step; on overlap the seeker is destroyed (returned to its pool) and the bullet is consumed (returned to the bullet pool). `ArenaScene` renders active seekers as placeholder blue vector shapes.

## Boundaries & Constraints

**Always:**
- Each active seeker homes toward the ship's **current** position every fixed step: velocity = `unit(ship − seeker) × SEEKER_SPEED`, recomputed each tick so it continuously tracks a moving player. Multiple seekers each track independently.
- All enemy motion, spawning, and collision math run only inside `world.fixedUpdate(dt)` driven by the constant fixed-step `dt` (`dtSec = dt/1000`), so speeds are identical regardless of render frame rate.
- Enemies are drawn from an object `Pool` (one pool per high-churn type). The steady-state spawn/despawn/collision path allocates nothing per frame: reuse via `acquire()`/`release()`, reusable scratch buffers for deferred releases, and pre-cleared reusable sets for hit tracking. The enemy pool is prewarmed at construction.
- A bullet is consumed on hit: one bullet destroys at most one seeker, and one seeker is destroyed by at most one bullet per tick (no double-release). Collision is circle-circle: hit when center distance `≤ bullet.radius + seeker.radius`.
- Spawn position is on a random arena edge, inside the drawn border (within `[inset+radius, dimension−inset−radius]`). The spawner takes an injectable `rng` (default `Math.random`) so spawn cadence and placement are unit-testable.
- Every tunable magnitude (seeker speed, radius, spawn interval, prewarm count, color) is a named constant in `src/config/constants.js` — no inline magic numbers.
- `Seeker`, `EnemySystem`, and `CollisionSystem` are Phaser-free and unit-testable headlessly under Vitest.

**Block If:**
- (none anticipated — this story adds to an existing, installed toolchain and established pooling/system patterns.)

**Never:**
- Do not implement player death, ship↔enemy collision, invulnerability, or lives — Story 1.5. This story destroys seekers with bullets only; the ship is a homing target, never a collider.
- Do not implement score, HUD, or game-over — Story 1.6.
- Do not build an escalating/difficulty-ramped spawn director, spawn telegraph, or a max-alive cap — Epic 2 (`2-5`, `2-6`). This story uses a single constant spawn cadence.
- Do not add other enemy types, enemy firing, or enemy-vs-enemy interaction.
- Do not add particle trails, bloom, screen shake, or any signature aesthetic — placeholder blue vector shape only (Epic 4).
- Do not add seekers to `world.entities` (churn/splitting cost) — the enemy `Pool` is the single source of active/free truth, exposed for the collision system and the renderer (mirrors the bullet-pool decision in 1.3).

## I/O & Edge-Case Matrix

`EnemySystem.fixedUpdate(dt)` (ship, injectable rng, its enemy pool):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Spawn cadence | no seekers, run for `T` ms of ticks (ungated) | seeker count ≈ `floor(T / SEEKER_SPAWN_INTERVAL_MS)`; independent of tick size | No error expected |
| Spawn placement | seeded rng | spawned seeker lies on an arena edge, within `[inset+radius, dim−inset−radius]` on the free axis | No error expected |
| Homing velocity | one seeker at A, ship at B | after a tick `vx,vy == unit(B−A) × SEEKER_SPEED` and position moved toward B | No error expected |
| Frame-rate independence | same `T` via fine vs coarse ticks, static ship | net displacement toward the target equal (± one step) regardless of tick size | No error expected |
| Independent tracking | two seekers at different positions, one ship | each gets its own velocity toward the ship (distinct directions) | No error expected |
| Coincident with ship | seeker exactly at ship position | magnitude 0 → velocity `(0,0)`, no `NaN`, position unchanged | No error expected |

`CollisionSystem.fixedUpdate(dt)` (bullet pool, enemy pool):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bullet hits seeker | one bullet overlapping one seeker | both released to their pools; enemy `activeCount`−1 and bullet `activeCount`−1 | No error expected |
| No overlap | bullet far from seeker | nothing released; both counts unchanged | No error expected |
| Boundary touch | center distance exactly `== rb+rs` | counts as a hit (uses `≤`) | No error expected |
| One bullet, two seekers | bullet overlaps two seekers | the bullet destroys exactly one seeker, then is consumed | No error expected |
| Two bullets, one seeker | two bullets overlap the same seeker | seeker released once (no double-release); one bullet consumed, the other still active | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- EDIT: add `SEEKER_SPEED`, `SEEKER_RADIUS`, `SEEKER_SPAWN_INTERVAL_MS`, `SEEKER_POOL_PREWARM`, `COLOR_SEEKER`.
- `src/entities/Seeker.js` -- NEW (Phaser-free): `createSeeker()` → `{ x, y, vx, vy, radius }` pool factory (zeroed; `radius = SEEKER_RADIUS`). The shared enemy shape the collision system reuses.
- `src/systems/EnemySystem.js` -- NEW (Phaser-free): owns a prewarmed `enemyPool`; each fixed step homes every active seeker toward the ship, then spawns at `SEEKER_SPAWN_INTERVAL_MS` cadence on a random arena edge via an injectable `rng`. Exposes `enemyPool`.
- `src/systems/CollisionSystem.js` -- NEW (Phaser-free): each fixed step tests active bullets vs active seekers (circle-circle) and releases hit seekers to the enemy pool and consumed bullets to the bullet pool, with no double-release and zero per-frame allocation.
- `src/scenes/ArenaScene.js` -- EDIT: create the `EnemySystem` (after firing) and `CollisionSystem` (after enemy) and add them to the world; render active seekers each render frame as placeholder blue vector shapes via a cleared/redrawn `Graphics`.
- `src/systems/enemySystem.test.js` -- NEW: unit tests for every `EnemySystem` I/O & edge-case matrix row.
- `src/systems/collisionSystem.test.js` -- NEW: unit tests for every `CollisionSystem` I/O & edge-case matrix row.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `SEEKER_SPEED`, `SEEKER_RADIUS`, `SEEKER_SPAWN_INTERVAL_MS`, `SEEKER_POOL_PREWARM`, `COLOR_SEEKER` with documented, tunable defaults -- keeps all feel/layout magnitudes centralized.
- `src/entities/Seeker.js` -- implement `createSeeker()` returning a zeroed seeker with `radius = SEEKER_RADIUS` -- the pooled high-churn enemy.
- `src/systems/EnemySystem.js` -- implement `fixedUpdate(dt)`: home + integrate every active seeker toward the ship, then accumulate `dt` and spawn at cadence on a random edge (injectable `rng`); own and prewarm `enemyPool`; no per-frame allocation -- the fixed-timestep enemy logic.
- `src/systems/CollisionSystem.js` -- implement `fixedUpdate(dt)`: collect active bullets and seekers into reusable scratch, test circle-circle, mark hits in pre-cleared reusable sets (bullet consumed after one hit; seeker destroyed once), then release in a second pass -- the bullet↔enemy destruction seam (extended by Story 1.5 for ship↔enemy).
- `src/scenes/ArenaScene.js` -- add the `EnemySystem` after firing and the `CollisionSystem` after it; each render frame clear a `Graphics` and draw a placeholder blue shape for every active seeker -- delivers on-screen enemies without running sim in the render callback.
- `src/systems/enemySystem.test.js` -- unit-test every `EnemySystem` I/O matrix row -- proves homing/spawn/independence headlessly.
- `src/systems/collisionSystem.test.js` -- unit-test every `CollisionSystem` I/O matrix row -- proves destruction/consumption headlessly.

**Acceptance Criteria:**
- Given a running game, when a Blue Seeker spawns, then it immediately homes toward the player's current position and is drawn from an object pool (FR4, NFR2).
- Given a Seeker on screen, when a player bullet collides with it, then the Seeker is destroyed and returned to its pool and the bullet is consumed (FR6).
- Given multiple Seekers pursuing simultaneously, when they move, then each tracks the player independently and their speed is frame-rate-independent (derived from the fixed-step `dt`).
- Given the codebase, when a reviewer inspects it, then `Seeker`, `EnemySystem`, and `CollisionSystem` are Phaser-free, run inside `world.fixedUpdate(dt)`, enemies live in a pool (not `world.entities`), and the homing + collision math are covered by passing unit tests.
- Given `npm test` and `npm run build`, when they run, then all unit tests pass and the production build completes, both with exit code 0.

## Spec Change Log

_No entries — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 1
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` Misleading constant comment: `SEEKER_POOL_PREWARM` claimed it was "sized above the worst-case simultaneous alive count," but this story has no alive cap or death mechanic (deferred to 1.5/Epic 2), so no worst-case bound exists — a passive player can exceed the prewarm and the pool then grows lazily. Reworded to state it sizes the expected steady-state peak under continuous auto-fire, with documented lazy growth beyond it and the true cap deferred to Epic 2. Value unchanged.
  - `[low]` `[patch]` Wrong ordering rationale: the `ArenaScene` Enemies-block comment said "EnemySystem runs after firing so seekers home toward the ship's post-move position," but homing depends on `PlayerMovementSystem` (firing does not move the ship). Corrected the comment to name `PlayerMovementSystem` as the real dependency and `CollisionSystem`-after-both as the collision ordering constraint. System-add order unchanged (already correct).
  - `[low]` `[patch]` NFR2 enemy-pool prewarm/no-alloc was asserted only by construction — no test read `enemyPool.freeCount`, so deleting the prewarm loop would pass every test. Added a "pool prewarm (NFR2)" test: `freeCount === SEEKER_POOL_PREWARM` and `activeCount === 0` at construction, then after `SEEKER_POOL_PREWARM` spawns `activeCount === SEEKER_POOL_PREWARM`, `freeCount === 0`, total capacity unchanged (factory never ran beyond the prewarm). Mirrors the Story 1.3 FiringSystem NFR2 test.
- deferred:
  - The `ArenaScene` enemy wiring/render surface — system-registration order (SimClock → PlayerMovement → Firing → Enemy → Collision), the pool references passed to `CollisionSystem`, the real firing-bullet → spawned-seeker destruction path (AC-2 end to end), and the seeker render loop — has no automated coverage; every test operates at the isolated-primitive surface (own pools, hand-placed entities), and no test constructs a `World` with these systems or touches `ArenaScene`. Two review layers (verification-gap, intent-alignment) converged. Recorded to `deferred-work.md` — the deliberately-thin Phaser boundary needing a scene/World integration harness beyond this story's captured intent (orchestrator-owned; mirrors the 1.1 render-integration and 1.2/1.3 sampler deferrals).
- rejected (noise / speculative / precedent-rejected / out-of-scope on the intent's authority / not a present defect):
  - Per-tick arrow-closure allocation in `forEachActive` callbacks contradicts the "zero allocation" claim — precedent-rejected identically in Story 1.3 (render-closure finding); the no-alloc guarantee targets the pooled-entity path, and a single V8-optimizable closure per tick matches the established `FiringSystem` pattern.
  - Homing overshoot jitter when a seeker reaches a stationary ship — cosmetic, marginal to trigger (2.3 px/tick band at exact center, only when the ship holds still and does not fire toward it), and mooted by Story 1.5 making ship contact lethal; adding arrival-clamping would invent behavior the spec deliberately left unspecified (direct constant-speed homing).
  - Collision tunneling: a fast bullet grazing a seeker's rim can step past the overlap between ticks (converged: adversarial + edge-case) — head-on hits are reliable at shipped constants (15 px step < 18 px combined radius); only closest-approach grazes miss, which is genre-normal, and the spec deliberately scoped circle-circle point-in-time collision (swept collision is a substantial out-of-scope addition; same speculative-tuning class as Story 1.3's rejected BULLET_SPEED findings).
  - Subnormal homing magnitude (`0 < mag < ~7.8e-307`) overflowing `SEEKER_SPEED/mag` to Infinity/NaN — unreachable: 2.3 px/tick discretization never lands a seeker that close, and positions are normal-range floats; same speculative non-finite class precedent-rejected in Stories 1.2/1.3.
  - Spawn-cadence test tolerance (±1) too loose — the tolerance matches the matrix's own "≈ floor(T/interval)" / "± one step" contract; tightening the fine path to exact-equal risks float-accumulation flakiness for no behavioral guarantee gained.
  - Frame-rate-independence claim over-broad (proven only for a static ship) — the AC claims speed independence (tested via displacement invariance), not curved-pursuit-path invariance; production `dt` is the constant fixed step, so path shape is deterministic.
  - No constructor dependency validation in `EnemySystem`/`CollisionSystem` — consistent with the existing `PlayerMovementSystem`/`FiringSystem`, which also do not validate their ctor deps; not a deficiency this change introduced relative to precedent.
  - No `Pool.clear()` teardown on scene shutdown/restart — precedent-rejected in Stories 1.2/1.3; no restart path exists yet, and the later story that introduces restart owns its teardown.
  - No game-state gate seam for a future pause/game-over to halt spawning — speculative future work; Stories 1.5/1.6 own their integration (same class as Story 1.3's rejected stale-ship-ref-for-1.5 finding).
  - `Math.floor(rng()*4) === 4` if an injected `rng` returns exactly `1.0` — `Math.random` (the default) never returns 1.0, and the `else` branch absorbs the value safely (a right-edge micro-bias, no crash); only a non-conforming injected generator triggers it.
  - Spawn placement asserted only via the private `_spawnOne()` rather than the public `fixedUpdate` spawn path — `_spawnOne` IS the production spawn code (invoked by `fixedUpdate`), so the placement math under test is real; the concern is a speculative future inline-refactor, and cadence-through-`fixedUpdate` is separately covered.
  - The `while` spawn catch-up loop (multiple spawns in one oversized tick) untested — unreachable in production: `dt` is the constant `FIXED_STEP_MS` (~16.7 ms) « `SEEKER_SPAWN_INTERVAL_MS` (1200 ms), so the loop never iterates more than once per tick; the `while` is defensive form (same class as Story 1.3's rejected "cadence-test dt the production path never emits").
  - "Immediately homes" honored only in the continuous-re-homing sense, with a one-fixed-step (~16.7 ms) stationary frame before a freshly spawned seeker first moves — imperceptible, and the single reasonable reading ("begins homing at once and tracks the current position") is satisfied; not an intent gap.

## Design Notes

Homing + spawn cadence (fixed-step, `dtSec = dt/1000`), mirroring `FiringSystem`'s advance-then-spawn shape:

```js
// 1. Home + integrate each active seeker toward the ship's CURRENT position.
pool.forEachActive((s) => {
  const dx = ship.x - s.x, dy = ship.y - s.y;
  const mag = Math.hypot(dx, dy);
  if (mag > 0) { const inv = SEEKER_SPEED / mag; s.vx = dx * inv; s.vy = dy * inv; }
  else { s.vx = 0; s.vy = 0; }            // coincident: no direction, no NaN
  s.x += s.vx * dtSec; s.y += s.vy * dtSec;
});
// 2. Spawn at a constant cadence (accumulate, unlike firing this is ungated).
this._accumMs += dt;
while (this._accumMs >= SEEKER_SPAWN_INTERVAL_MS) { this._spawnOne(); this._accumMs -= SEEKER_SPAWN_INTERVAL_MS; }
```

Direct constant-speed homing (recomputed each tick) is the minimal faithful reading of "homes toward the player's current position" — no turn-rate limit or acceleration is specified, so none is invented; the path curves naturally as the player moves. `_accumMs` starts at 0 (first seeker after one interval). Seekers are pool-managed, **not** in `world.entities`, so there is no `splice`/`indexOf` churn; the pool is exposed (`enemySystem.enemyPool`) for collision and rendering.

Collision uses two reusable scratch arrays (materialized from each pool) and two pre-cleared reusable `Set`s (`_hitBullets`, `_hitSeekers`): a bullet that already hit is skipped, a seeker already hit is skipped, and releases are deferred to a second pass because mutating a pool's active set mid-iteration is unsafe. System order in the world: SimClock → PlayerMovement → Firing → Enemy → Collision, so collision sees post-move bullet and seeker positions.

## Verification

**Commands:**
- `npm test` -- expected: exit 0; all suites pass, including the new `enemySystem` and `collisionSystem` tests.
- `npm run build` -- expected: exit 0; `dist/` bundle emitted.

**Manual checks (if no CLI):**
- `npm run dev`: blue seekers appear at the arena edges on a steady cadence and curve toward the ship as it moves; auto-fire bullets that touch a seeker make it vanish and the bullet disappears with it; several seekers on screen each track the ship independently.

## Auto Run Result

Status: done

**Summary:** Implemented Story 1.4 — Blue Seeker Enemy. Added the Blue Seeker as a pooled, Phaser-free enemy: `EnemySystem` (run inside `world.fixedUpdate(dt)`) owns a prewarmed enemy `Pool`, spawns one seeker per `SEEKER_SPAWN_INTERVAL_MS` on a random arena edge (via an injectable `rng`, default `Math.random`), and each fixed step homes every active seeker toward the ship's **current** position at a constant `SEEKER_SPEED` (`unit(ship − seeker) × speed`, recomputed each tick so it tracks a moving player; each seeker independent; coincident magnitude 0 → zero velocity, no NaN). A separate Phaser-free `CollisionSystem` tests active bullets against active seekers each fixed step (circle-circle, hit when center distance ≤ `rb+rs`), consuming the bullet after one hit (at most one seeker per bullet) and destroying each seeker once (no double-release), releasing both to their pools. Seekers live in the pool, **not** `world.entities`. `ArenaScene` wires `EnemySystem` after firing and `CollisionSystem` after enemy, and renders active seekers as placeholder blue vector circles each render frame. All feel magnitudes are centralized constants. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel against the diff since baseline `3525113`; no intent_gap and no bad_spec were found.

**Files changed (reviewed code diff):**
- `src/config/constants.js` — added `SEEKER_SPEED`, `SEEKER_RADIUS`, `SEEKER_SPAWN_INTERVAL_MS`, `SEEKER_POOL_PREWARM`, `COLOR_SEEKER` (patched: corrected the `SEEKER_POOL_PREWARM` "worst-case alive count" comment).
- `src/entities/Seeker.js` — NEW (Phaser-free): `createSeeker()` pool factory → `{x,y,vx,vy,radius}`.
- `src/systems/EnemySystem.js` — NEW (Phaser-free): prewarmed enemy pool; per-tick homing + fixed-cadence edge spawn via injectable `rng`; exposes `enemyPool`.
- `src/systems/CollisionSystem.js` — NEW (Phaser-free): bullet↔seeker circle-circle destruction with one-hit-per-bullet, destroy-once, and reusable scratch/sets.
- `src/scenes/ArenaScene.js` — added `EnemySystem` (after firing) and `CollisionSystem` (after enemy) to the world and render active seekers as blue circles (patched: corrected the system-ordering rationale comment).
- `src/systems/enemySystem.test.js` — NEW: 10 tests covering every EnemySystem matrix row plus the patched NFR2 prewarm/no-growth test.
- `src/systems/collisionSystem.test.js` — NEW: 7 tests covering every CollisionSystem matrix row (hit, no-overlap, exact-boundary touch, just-beyond, one-bullet/two-seekers, two-bullets/one-seeker, no-alloc).

**Review findings breakdown:** patch 3 (low 3) · defer 1 · reject 13 · intent_gap 0 · bad_spec 0.
- Patched (3): misleading `SEEKER_POOL_PREWARM` comment (no worst-case bound exists without a cap); wrong `ArenaScene` ordering rationale (`PlayerMovementSystem`, not firing, is homing's dependency); enemy-pool NFR2 prewarm/no-alloc asserted only by construction (added a prewarm test reading `freeCount`).
- Deferred (1, → `deferred-work.md`): the `ArenaScene` enemy wiring/render integration surface (system order, collision pool references, real-bullet→seeker end-to-end, seeker render) has no automated coverage — the deliberately-thin Phaser boundary needing a scene/World harness (orchestrator-owned; mirrors the 1.1/1.2/1.3 deferrals).
- Rejected (13): closure-alloc nit (1.3 precedent); homing overshoot jitter (cosmetic, mooted by 1.5); collision tunneling (head-on reliable; circle-circle deliberately scoped); subnormal-magnitude NaN (unreachable; 1.2/1.3 precedent); loose cadence-test tolerance (matches matrix "≈"); over-broad frame-rate claim (AC is speed, tested); no ctor validation (matches existing systems); no `Pool.clear()` teardown (1.2/1.3 precedent); no spawn game-state gate (speculative 1.5/1.6); `rng===1.0` edge (default never yields it; safe fallback); placement-via-private-method (production path, speculative refactor); untested `while` catch-up (unreachable in production); "immediately" one-tick delay (imperceptible; single reading satisfied).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 3 → score = 3×0 + 1×3 = 3 (< 5, no high).

**Verification performed:**
- `npm test` → 79/79 pass across 8 files (pool 8, fixedTimestep 11, inputMath 18, world 5, enemySystem 10, collisionSystem 7, firingSystem 9, playerMovementSystem 11), exit 0. Re-run after the patches also green.
- `npm run build` → exit 0; `dist/` bundle emitted (the >500 kB Phaser chunk-size warning is expected and out of scope).
- Matrix Test Audit: all 6 EnemySystem and all 5 CollisionSystem I/O matrix rows covered by tests that ran and passed.

**Residual risks / artifacts:**
- The deferred `ArenaScene` wiring/render coverage gap remains open (tracked in `deferred-work.md`) — a reordered `addSystem` call or a swapped collision-pool reference would pass the whole headless suite yet break the game; `npm run dev` is the only live-integration verification.
- With no alive cap and no death mechanic yet (player death is Story 1.5), a passive player who does not shoot lets seekers accumulate; beyond `SEEKER_POOL_PREWARM` (32) the pool grows lazily (a one-time alloc per new instance, by design — the steady state still recycles). A true alive cap / escalating director lands in Epic 2. Feel constants (`SEEKER_SPEED=140`, `SEEKER_RADIUS=14`, `SEEKER_SPAWN_INTERVAL_MS=1200`) are first-pass defaults for hand-tuning.
- Collision is discrete circle-circle: head-on hits are reliable at shipped constants (15 px/tick step < 18 px combined radius), but a grazing pass can occasionally tunnel — genre-normal and within the spec's scoped collision model.
- Residual working-tree artifacts left in place (not part of the reviewed code diff; orchestrator-owned): this spec file, the modified `deferred-work.md`, and `sprint-status.yaml` (still lists `1-4-...: backlog` — the orchestrator owns the status flip, per the Story 1.1–1.3 convention).
- `final_revision` recorded in frontmatter after the commit below.
