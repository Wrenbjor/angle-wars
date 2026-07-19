---
title: 'Story 2.2 — Pinwheel/Wanderer Enemy'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'acaf6e24d4a069f78cc9c13dde3068963add6f28'
final_revision: '108147e0b0065923703ce3162691f17f668c963f'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Epic 2's roster so far reacts to the player (the homing Seeker, the flee/aggro Green Square). The arena needs a threat that is *indifferent* to the player — a drifter that clutters the space so the player must weave through hazards rather than only outrun pursuers.

**Approach:** Add the Pinwheel/Wanderer as its own pooled enemy archetype with a dedicated behavior system: it spawns on a random arena edge with a random heading, drifts at a constant speed along a **pseudo-random (wandering) trajectory** — periodically re-rolling its heading by a bounded random turn — and **bounces (reflects) off the arena walls**, never referencing the ship. It is killable, scorable, and lethal-on-contact purely by plugging its pool into the shared `enemyPools` seams already generalized in Story 2.1 — no seam changes.

## Boundaries & Constraints

**Always:**
- All motion, heading-wander cadence, and spawn timing derive from the fixed-step `dt` (frame-rate independent) — never raw render time.
- Pinwheels live in their own prewarmed object `Pool` (owned by `PinwheelSystem`); the steady-state behavior/spawn path allocates nothing (NFR2).
- The pinwheel is **indifferent to the player**: `PinwheelSystem` never reads the ship or bullets. Its trajectory never depends on player position.
- Drift speed is constant (magnitude preserved): heading changes rotate the velocity vector; a wall bounce reflects one velocity component — both keep `|v| == PINWHEEL_DRIFT_SPEED`.
- Wall collision is a **reflection** (bounce), not a park-at-the-wall clamp: on crossing an inset bound, clamp the position back to the bound *and* negate that axis's velocity component.
- Heading re-rolls on a per-instance cadence (`PINWHEEL_WANDER_INTERVAL_MS`), by a uniform random turn in `[−PINWHEEL_WANDER_MAX_TURN_RAD, +PINWHEEL_WANDER_MAX_TURN_RAD]`, drawn from an injectable `rng`.
- All feel, scoring, and color values are centralized constants in `constants.js` — no inline magic numbers.
- Bullet-kill, player-contact lethality (FR6), and scoring route through the SAME generalized shared seams (`CollisionSystem` / `PlayerDeathSystem` / `ScoringSystem`) the Seeker and Green Square already use — the pinwheel pool is added to the `enemyPools` arrays; no parallel duplicate path and no seam semantic change.

**Block If:**
- Making the pinwheel killable/lethal/scorable would require changing the shared seam *semantics* (not merely adding its pool to the existing `enemyPools` arrays). That signals a hidden conflict in the shared contract — HALT with the specifics.

**Never:**
- Do not implement the spawn director, difficulty ramp, or spawn telegraph (Stories 2.5 / 2.6) — the pinwheel self-spawns on a fixed cadence, mirroring the Seeker and Green Square, for now.
- Do not make the pinwheel home toward, flee from, or otherwise react to the player, its bullets, or other enemies.
- Do not add neon/bloom/grid aesthetics or a real spinning-pinwheel animation — placeholder vector shape only (Epic 4).
- Do not fold in a score multiplier (Epic 3) — credit the base score unmultiplied.
- Do not merge pinwheels into the Seeker's or Green Square's pool/system — keep pool-per-archetype per the epic's architecture.

## I/O & Edge-Case Matrix

Scope: one `PinwheelSystem.fixedUpdate(dt)` step unless noted. "pw" = one active pinwheel. Bounds: `[INSET+RADIUS, DIM−INSET−RADIUS]` per axis.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Straight drift | `pw` mid-arena, `wanderMs` far from interval, no wall in reach | position integrates by `v·dtSec`; `vx,vy` unchanged; `|v|` == `DRIFT_SPEED` | none |
| Heading re-roll (wander) | accumulated `wanderMs` crosses `WANDER_INTERVAL_MS` | velocity rotated by `turn = (rng()*2−1)*WANDER_MAX_TURN_RAD`; `|v|` preserved; `wanderMs -= INTERVAL` | none |
| Wander cadence | elapsed sim time `T` (fine vs coarse ticks), no wall | heading re-rolls ≈ `floor(T / WANDER_INTERVAL_MS)` times, tick-size independent | none |
| Bounce off wall (x) | integrated `x` would exit `[minX,maxX]` | `x` clamped to the bound; `vx → −vx`; `vy` unchanged; `|v|` preserved | none |
| Bounce off wall (y) | integrated `y` would exit `[minY,maxY]` | `y` clamped to the bound; `vy → −vy`; `vx` unchanged; `|v|` preserved | none |
| Corner bounce | integrated position exits on BOTH axes | both components reflected independently; position clamped into the corner | none |
| Spawn cadence | `T` ms of accumulated fixed steps elapse | ≈ `floor(T / SPAWN_INTERVAL_MS)` pinwheels spawned on random edges, each with a random heading at `DRIFT_SPEED`, tick-size independent | none |
| Bullet kill (AC3) | active bullet overlaps a pinwheel; `CollisionSystem` runs over `[pinwheelPool]` | pinwheel released to its pool, bullet consumed, pinwheel in `killedEnemies`; `ScoringSystem` adds `PINWHEEL_SCORE` | none |
| Ship contact (AC2) | non-invulnerable ship overlaps a pinwheel; `PlayerDeathSystem` runs over `[pinwheelPool]` | standard death flow (life lost then respawn, or game-over on last life); at most one death per step | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add Pinwheel feel/scoring/color constants (radius, drift speed, wander interval + max turn, spawn interval, pool prewarm, score, color).
- `src/entities/Pinwheel.js` -- NEW pooled entity factory, mirrors `Seeker.js`; shape adds a per-instance `wanderMs` accumulator (no `aggro`, no ship coupling).
- `src/systems/PinwheelSystem.js` -- NEW behavior system: per-tick wander (heading re-roll on cadence) + integrate + wall-reflect, and fixed-cadence edge spawn with a random heading. Mirrors `EnemySystem.js` structure; constructor takes only an injectable `rng` (no ship, no bullet pool).
- `src/scenes/ArenaScene.js` -- construct `PinwheelSystem` (after `GreenSquareSystem`, before `CollisionSystem`); add its pool to the `enemyPools` array passed to `CollisionSystem` and `PlayerDeathSystem`; add a pinwheel render pass (placeholder filled diamond in `COLOR_PINWHEEL`).
- `src/systems/pinwheelSystem.test.js` -- NEW unit tests: every I/O-matrix row (drift, wander re-roll + cadence, wall/corner bounce, spawn) plus pool prewarm, factory default, and AC2/AC3 routed through the real `CollisionSystem`/`ScoringSystem`/`PlayerDeathSystem` over a `[pinwheelPool]` array.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `PINWHEEL_RADIUS`, `PINWHEEL_DRIFT_SPEED`, `PINWHEEL_WANDER_INTERVAL_MS`, `PINWHEEL_WANDER_MAX_TURN_RAD`, `PINWHEEL_SPAWN_INTERVAL_MS`, `PINWHEEL_POOL_PREWARM`, `PINWHEEL_SCORE`, `COLOR_PINWHEEL` -- centralized tunables for the new archetype.
- `src/entities/Pinwheel.js` -- add `createPinwheel()` returning `{ x, y, vx, vy, radius, score, wanderMs:0 }` -- pool factory; a well-defined zeroed shape re-initialized on spawn.
- `src/systems/PinwheelSystem.js` -- implement wander (per-instance `wanderMs` accumulator; on crossing `PINWHEEL_WANDER_INTERVAL_MS`, rotate velocity by a bounded random turn), position integration + wall reflection, and fixed-cadence edge spawning with a random heading at drift speed; own the pinwheel `Pool` (prewarmed); constructor `(rng = Math.random)` only -- the archetype's behavior + spawn, indifferent to the player.
- `src/scenes/ArenaScene.js` -- construct `PinwheelSystem` in order, push `pinwheelSystem.enemyPool` into the shared `enemyPools` array (so collision/death/scoring already see it), and add the placeholder pinwheel render pass -- integrate into the running game.
- `src/systems/pinwheelSystem.test.js` -- unit-test every I/O-matrix row (straight drift, wander re-roll + tick-size-independent cadence, x/y/corner bounce with magnitude preserved, spawn cadence/placement/random-heading) plus pool prewarm, the factory default, frame-rate independence of straight-drift displacement, and AC2/AC3 through the real shared seams over `[pinwheelPool]` -- lock the behavior contract and the shared-seam integration for this archetype.

**Acceptance Criteria:**
- Given a running game with a pinwheel spawned mid-arena and no wall in reach, when a fixed step runs, then it drifts along its current heading at the constant drift speed and never adjusts toward or away from the ship (indifferent).
- Given a pinwheel whose accumulated per-instance time crosses the wander interval, when the fixed step runs, then its heading rotates by a bounded random turn while its speed magnitude is preserved, and over equal elapsed sim time the number of re-rolls is independent of tick size.
- Given a pinwheel drifting into an arena wall, when it would cross the inset bound, then it is clamped to the bound and the corresponding velocity component is reflected (it bounces back into the arena) with its speed magnitude preserved.
- Given a player bullet overlapping a pinwheel, when `CollisionSystem` runs over the pool array containing the pinwheel pool, then the pinwheel is released to its pool, the bullet is consumed, the pinwheel appears in `killedEnemies`, and `ScoringSystem` adds `PINWHEEL_SCORE` to `ScoreState`.
- Given a non-invulnerable ship overlapping a pinwheel, when `PlayerDeathSystem` runs over the pool array containing the pinwheel pool, then the standard death flow fires (life lost then respawn, or game-over on the last life), at most one death per step.
- Given equal elapsed sim time split into fine vs. coarse fixed steps with no wander event and no wall, when the pinwheel drifts, then its net displacement matches exactly (frame-rate independence of integration).
- Given the pinwheel behavior and spawn path runs for many steps, when observed, then the pool is prewarmed and recycles instances with no growth beyond prewarm (no per-frame allocation).

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 5: (high 0, medium 2, low 3)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` The pinwheel render pass in `ArenaScene` allocated a fresh array + 4 point-object literals per pinwheel per frame via `fillPoints`, breaking the codebase's zero-per-frame-allocation render discipline (seeker `fillCircle` / green-square `fillRect`; Story 2.1 patched per-tick closures for the same reason) — hoisted a reusable 4-element `_pinwheelPoints` buffer mutated in place before `fillPoints`, so the render pass now allocates nothing per frame.
  - `[low]` `[patch]` The `_spawnOne` edge-placement test asserted only the loose `onFixed && inX && inY` predicate for the bottom/left/right edges (only the top edge was coordinate-pinned), so a regression sending a branch to the wrong bound would ship green — added coordinate-exact tests for the bottom (`y===MAX_Y`), left (`x===MIN_X`), and right (`x===MAX_X`) edges with deterministic `seqRng`, mirroring the existing top-edge test.
  - `[low]` `[patch]` No test exercised the emergent wandering trajectory over an integrated run — the existing multi-interval test feeds `rng=0.5` (zero turn), so AC1's headline "pseudo-random trajectory" (the heading actually changing over time) was unverified — added a test with `rng=()=>1` (max turn) that runs a mid-arena pinwheel for exactly 2 wander re-rolls (no spawn, no wall) and asserts the heading rotated cumulatively to ≈ +2×`MAX_TURN`, magnitude preserved at drift speed, and the path bent (`vy !== 0`).

## Design Notes

**Why the wander (pseudo-random) reading, not a straight billiard path.** The archetype is the "Wanderer" and the AC/epic call for a "pseudo-random *trajectory*" — the path itself is pseudo-random, not merely a deterministic straight line launched from a random seed (which would read as "bounces around," not "wanders"). So the committed behavior is: constant-speed drift whose heading periodically re-rolls by a bounded random turn, *plus* wall reflection. The wander magnitude and cadence (`PINWHEEL_WANDER_MAX_TURN_RAD`, `PINWHEEL_WANDER_INTERVAL_MS`) are exactly the kind of feel tunables the epic says to centralize and tune post-launch — they are not an intent gap.

**Frame-rate independence of the wander cadence.** Heading re-rolls on a per-instance `wanderMs` accumulator (`wanderMs += dt; while (wanderMs >= INTERVAL) { rotate; wanderMs -= INTERVAL; }`), so the *count* of re-rolls over elapsed sim time `T` is `floor(T/INTERVAL)` regardless of tick size — mirroring the spawn-cadence accumulator. Between re-rolls the motion is straight-line integration (`x += vx*dtSec`), which is exactly dt-derived, so the sub-interval displacement test can assert an exact fine-vs-coarse match.

**Rotate the velocity vector (preserve magnitude), don't recompute from an angle.** A wander turn `θ` rotates `(vx,vy)` in place; a wall bounce negates one component. Both preserve `|v| == DRIFT_SPEED`, so the drifter never speeds up or stalls:

```js
// wander: rotate current velocity by a bounded random turn
const theta = (rng() * 2 - 1) * PINWHEEL_WANDER_MAX_TURN_RAD;
const c = Math.cos(theta), s = Math.sin(theta);
const nvx = pw.vx * c - pw.vy * s;
const nvy = pw.vx * s + pw.vy * c;
pw.vx = nvx; pw.vy = nvy;
// integrate, then reflect off each wall it crossed:
pw.x += pw.vx * dtSec;
if (pw.x < minX) { pw.x = minX; pw.vx = -pw.vx; }
else if (pw.x > maxX) { pw.x = maxX; pw.vx = -pw.vx; }
// (same for y)
```

**No ship/bullet coupling.** Unlike the Seeker (homes) and Green Square (flees/threat-detects), the pinwheel reads neither the ship nor the bullet pool — its constructor takes only `rng`. This keeps the archetype honest to "indifferent to the player" and keeps the system trivially deterministic to test. Collision remains circle-circle on `radius`; the diamond is only the *rendered* placeholder.

**Shared seams unchanged.** Story 2.1 already generalized `CollisionSystem`/`PlayerDeathSystem` to an array of pools and made `ScoringSystem` type-agnostic (reads each killed enemy's own `score`). The pinwheel carries the uniform `{x,y,vx,vy,radius,score}` shape (plus `wanderMs`, ignored by the seams), so it plugs in by adding its pool to the `enemyPools` array in `ArenaScene` — no seam code changes. The new test file exercises AC2/AC3 through the *real* seams over `[pinwheelPool]` so the archetype's killable/lethal/scorable contract is pinned at its true surface rather than assumed from shape-compatibility.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `pinwheelSystem.test.js` and the unchanged collision/scoring/death suites.
- `npm run build` -- expected: production build succeeds with no errors.

**Manual checks:**
- `npm run dev`, then in the arena: pinwheels spawn on the edges and drift in meandering paths that visibly change heading and bounce off the walls, ignoring the ship entirely; a bullet that hits one destroys it and the score jumps by its value; touching one (while not invulnerable) costs a life; a fresh restart shows the same behavior.
</content>
</invoke>

## Auto Run Result

Status: done

**Implemented change:** Added the Pinwheel/Wanderer archetype — a player-*indifferent* drifter that spawns on a random arena edge with a random heading, drifts at a constant speed along a pseudo-random (wandering) trajectory (periodically re-rolling its heading by a bounded random turn), and bounces (reflects) off the arena walls — as its own pooled entity + behavior system. It never references the ship or bullets. It is killable, scorable, and lethal-on-contact (FR6) purely by adding its pool to the shared `enemyPools` arrays already generalized in Story 2.1 — no seam code changed.

**Files changed:**
- `src/config/constants.js` — added Pinwheel feel/scoring/color constants (`PINWHEEL_RADIUS`, `PINWHEEL_DRIFT_SPEED`, `PINWHEEL_WANDER_INTERVAL_MS`, `PINWHEEL_WANDER_MAX_TURN_RAD`, `PINWHEEL_SPAWN_INTERVAL_MS`, `PINWHEEL_POOL_PREWARM`, `PINWHEEL_SCORE`, `COLOR_PINWHEEL`).
- `src/entities/Pinwheel.js` — NEW `createPinwheel()` pool factory (`{x,y,vx,vy,radius,score,wanderMs:0}`).
- `src/systems/PinwheelSystem.js` — NEW wander (heading re-roll on a per-instance `wanderMs` cadence) + integrate + wall-reflect behavior and fixed-cadence random-edge/random-heading spawn; owns a prewarmed pool; constructor takes only an injectable `rng` (no ship, no bullet pool — indifferent to the player).
- `src/scenes/ArenaScene.js` — constructs `PinwheelSystem` (after `GreenSquareSystem`, before `CollisionSystem`), pushes its pool into the shared `enemyPools` array, and renders pinwheels as placeholder filled diamonds (via a hoisted reusable points buffer — zero per-frame allocation).
- `src/systems/pinwheelSystem.test.js` — NEW (27 tests).

**Review findings breakdown:** 3 patches applied (all low severity), 5 findings deferred (in 3 ledger entries), 9 rejected as noise.
- Patches: hoisted a reusable points buffer for the pinwheel render pass (zero per-frame allocation, matching the seeker/green-square discipline); hardened the `_spawnOne` edge-placement test with coordinate-exact assertions for the bottom/left/right edges; added an integrated multi-interval test that exercises the emergent wandering trajectory with a non-zero turn (covering AC1's headline directly).
- Deferred: (1) the `ArenaScene` pinwheel wiring/world-registration/render surface has no headless integration coverage — joins the orchestrator-owned integration-harness deferral from Stories 1.1–2.1; (2) pinwheels never despawn/cap and (being indifferent) accumulate faster than the homing/fleeing archetypes, plus grazing-incidence wall-hug — feel/balance entangled with Story 2.5's spawn cap/despawn; (3) instant-spawn-on-ship risk shared with the Seeker/Green Square — spawn-safety owned by Story 2.6's spawn telegraph.
- Rejected (noise): bounce clamps overshoot instead of reflecting it (spec-specified clamp; ≤2.17 px at the shipped drift speed — imperceptible; standard technique), cumulative `|v|` floating-point drift over rotations (~1e-13 relative over tens of minutes — physically negligible), unguarded rng-range `else` in edge selection (pre-existing Seeker/Green-Square idiom, standard `[0,1)` contract), injected-rng-NaN "zombie" (production uses `Math.random`; only tests inject and pass valid rng), degenerate-arena-config inverted bounds (unreachable at 1280×720), frame-rate-independence "overclaim" (the game runs at a constant fixed step; Design Notes scope the claim correctly), degenerate deterministic-test-rng correlation (the established `seqRng` pattern; draw order is explicitly covered), and the NFR2 500-step test not crossing prewarm / lazy growth past prewarm (by-design pooling, rejected identically in Story 2.1 — steady-state recycling within prewarm is the actual requirement and is tested).

**Follow-up review recommended:** false (patched findings: 0 high, 0 medium, 3 low; score 3×0 + 1×3 = 3 < 5).

**Verification performed:**
- `npm test` — 12 files, 157 tests, all pass (new `pinwheelSystem.test.js` at 27; unchanged collision/scoring/death suites green).
- `npm run build` — production build succeeds (the >500 kB chunk-size notice is pre-existing bundled-Phaser, not from this change).
- Matrix Test Audit: every I/O-matrix row (straight drift, wander re-roll + tick-size-independent cadence, x/y/corner bounce with magnitude preserved, spawn cadence, bullet-kill AC3 through the real collision/scoring seams, ship-contact AC2 through the real death seam) has a covering test that ran and passed.

**Residual risks:**
- Tunable feel values (radius, drift speed, wander interval/turn, spawn interval, score) are implementer choices left open by the spec — worth a manual playtest pass, especially the wander cadence/turn magnitude (how "meandering" the drift reads).
- Manual in-browser checks (`npm run dev`) were not run in this headless environment; behavior is covered by unit tests, and the `ArenaScene` render/wiring layer remains the deliberately-untested Phaser boundary (deferral entry 1).
