---
title: 'Story 2.3 — Snake Enemy'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'aeac29ed69dee2760fa3496213c496ff59648b29'
final_revision: '1da19ff7ce8058a5c99ceeb8daea6480eb40d6a7'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Epic 2's roster so far is single-body threats (homing Seeker, flee/aggro Green Square, indifferent Pinwheel). The arena needs a *large* threat — a long segmented body that is dangerous along its entire length — so big enemies force the player to reposition rather than shoot-through, and shooting it makes it fragment.

**Approach:** Add the Snake as its own pooled archetype: a chain of pooled segments that follows a self-propelled slithering head. The head drifts at a constant speed along a serpentine path (heading oscillates sinusoidally) and bounces off the arena walls; each following segment geometrically trails the one ahead at a fixed spacing. Every segment (head included) is a uniform `{x,y,vx,vy,radius,score}` instance in one shared segment pool, so it plugs into the existing `enemyPools` seams for lethal-on-contact (FR6) and bullet-kill+score — no seam semantic changes. Killing a mid-body segment splits the snake into two independent snakes ("breaks apart").

## Boundaries & Constraints

**Always:**
- All head motion, slither-phase advance, and spawn cadence derive from the fixed-step `dt` (never render time). Slither phase advances as `phase += SLITHER_ANG_VEL * dtSec`, so its value over elapsed sim time is tick-size independent.
- Segments live in ONE prewarmed segment `Pool` owned by `SnakeSystem`; the steady-state move path allocates nothing (NFR2). Snake struct allocation happens only on spawn/split events, never per frame.
- Every segment — head and body — is lethal on ship contact (FR6) and killable+scorable, entirely by adding the segment pool to the existing `enemyPools` arrays (`CollisionSystem` / `PlayerDeathSystem`) and carrying per-instance `score` for `ScoringSystem`. No parallel path, no seam semantic change.
- The body is a follow-the-leader chain processed head→tail: each non-head segment is pulled to exactly `SNAKE_SEGMENT_SPACING` behind its leader along the current head→segment line (only when farther than the spacing). This is a geometric position constraint (no `dt`), inherently frame-rate independent.
- The head is INDIFFERENT to the player: `SnakeSystem` never reads the ship or bullets for motion. Its only cross-system read is `collisionSystem.killedEnemies` (the established post-collision reaction seam, same as `ScoringSystem`) to detect which of its segments were destroyed this-tick-prior and split the chain accordingly.
- Splitting on kill: when segment(s) are destroyed, each surviving maximal contiguous run of the chain becomes its own snake; a run's new head re-derives its `headingRad` from the direction it was trailing. Snakes reduced to zero segments are removed.
- All feel/scoring/color values are centralized constants in `constants.js` — no inline magic numbers.

**Block If:**
- Making the snake killable/lethal/scorable would require changing the shared seam *semantics* (not merely adding its segment pool to the `enemyPools` arrays). That signals a hidden conflict — HALT with specifics.

**Never:**
- Do not implement the spawn director, difficulty ramp, spawn cap/despawn, or spawn telegraph / spawn-safety (Stories 2.5 / 2.6) — the snake self-spawns on a fixed cadence like the Seeker/Green Square/Pinwheel.
- Do not make the head home toward, flee from, or otherwise react to the player or its bullets. Do not give segments a shared HP bar — each segment is destroyed by one hit (per-segment fragmentation is the faithful "breaks apart").
- Do not add neon/bloom/grid aesthetics or a real slithering animation — placeholder vector segments only (Epic 4).
- Do not fold in a score multiplier (Epic 3) — credit each segment's base score unmultiplied.
- Do not merge snake segments into another archetype's pool/system — keep pool-per-archetype.
- Do not modify `CollisionSystem` / `PlayerDeathSystem` / `ScoringSystem` / `Pool`.

## I/O & Edge-Case Matrix

Scope: one `SnakeSystem.fixedUpdate(dt)` step unless noted. Bounds: head clamps to `[INSET+RADIUS, DIM−INSET−RADIUS]` per axis.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Head slither drift | head `slitherPhase=0`, `headingRad=0`, mid-arena, no wall | head moves +x by `HEAD_SPEED·dtSec` (eff heading = base since sin 0); `slitherPhase += ANG_VEL·dtSec` | none |
| Slither phase cadence | elapsed sim `T`, fine vs coarse ticks | final `slitherPhase` == `ANG_VEL·T/1000`, tick-size independent | none |
| Head wall bounce (x) | head crosses `[minX,maxX]`, `slitherPhase=0` | head clamped to bound; `headingRad → π − headingRad` (reflect about vertical wall) | none |
| Head wall bounce (y) | head crosses `[minY,maxY]`, `slitherPhase=0` | head clamped to bound; `headingRad → −headingRad` | none |
| Follow-the-leader | follower farther than spacing behind (moved) head, collinear | follower snapped to exactly `SPACING` behind head along the head→follower line; dt-independent | none |
| Follow (close enough) | follower within `SPACING` of leader | follower not moved (no push) | none |
| Spawn cadence | `T` ms of accumulated fixed steps | ≈ `floor(T / SPAWN_INTERVAL_MS)` snakes spawned, each `SEGMENT_COUNT` segments on a random edge trailing outward, tick-size independent | none |
| Bullet kill + score (AC3) | bullet overlaps a segment; `CollisionSystem` over `[segmentPool]`, then `SnakeSystem.fixedUpdate` | segment released to pool + bullet consumed + in `killedEnemies`; `ScoringSystem` adds `SNAKE_SEGMENT_SCORE`; next `SnakeSystem` step drops it from its snake | none |
| Mid-body split (AC3) | a middle segment killed | snake partitions into two snakes at the gap (front keeps head state; back re-heads); dead segment dropped | none |
| Head killed | head (index 0) killed | front run empty; the next survivor becomes a new head | none |
| Whole snake killed | all its segments killed one tick | snake removed from the active snake list | none |
| Ship contact any segment (AC2) | non-invuln ship overlaps ANY segment; `PlayerDeathSystem` over `[segmentPool]` | standard death flow (life lost then respawn, or game-over on last life); at most one death per step; segment not destroyed | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add Snake feel/scoring/color constants (segment radius, head speed, segment spacing + count, slither amplitude + angular velocity, spawn interval, pool prewarm, per-segment score, color).
- `src/entities/SnakeSegment.js` -- NEW pooled segment factory; uniform `{x,y,vx,vy,radius,score}` shape (mirrors `Pinwheel.js` minus wander state). Head and body share this shape; head-motion state lives on the snake struct, not the segment.
- `src/systems/SnakeSystem.js` -- NEW behavior system: owns the segment `Pool` (prewarmed, public `enemyPool`) and a public `snakes` array of `{segments[], headingRad, slitherPhaseRad}` structs. Per tick: (1) split from `collisionSystem.killedEnemies`, (2) head slither+integrate+wall-reflect then follow-the-leader per snake, (3) fixed-cadence edge spawn. Constructor `(rng = Math.random)`; a settable `collisionSystem` property (late-bound by the scene; reap is a no-op until set). No ship/bullet coupling.
- `src/scenes/ArenaScene.js` -- construct `SnakeSystem` (after `PinwheelSystem`, before `CollisionSystem`); push its segment pool into the shared `enemyPools` array; set `snakeSystem.collisionSystem = this.collisionSystem` after the collision system exists; add a snake render pass (placeholder filled circles per active segment in `COLOR_SNAKE`, zero per-frame allocation).
- `src/systems/snakeSystem.test.js` -- NEW unit tests: every I/O-matrix row (slither drift, phase cadence tick-independence, x/y wall bounce, follow-the-leader + no-push, spawn cadence/placement, mid-body split, head-kill re-head, whole-snake removal) plus pool prewarm/no-growth, the factory default, and AC2/AC3 routed through the REAL `CollisionSystem`/`ScoringSystem`/`PlayerDeathSystem` over `[segmentPool]`.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `SNAKE_SEGMENT_RADIUS`, `SNAKE_HEAD_SPEED`, `SNAKE_SEGMENT_SPACING`, `SNAKE_SEGMENT_COUNT`, `SNAKE_SLITHER_AMPLITUDE_RAD`, `SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC`, `SNAKE_SPAWN_INTERVAL_MS`, `SNAKE_SEGMENT_POOL_PREWARM`, `SNAKE_SEGMENT_SCORE`, `COLOR_SNAKE` -- centralized tunables for the new archetype.
- `src/entities/SnakeSegment.js` -- add `createSnakeSegment()` returning `{x,y,vx,vy,radius,score}` -- pool factory; a zeroed uniform shape re-initialized on spawn.
- `src/systems/SnakeSystem.js` -- implement the split-on-kill reap (from `collisionSystem.killedEnemies`, partitioning each snake's segment list into surviving contiguous runs), the per-snake head slither (sinusoidal heading + `dt`-integrated position + wall reflection of the base heading) and head→tail follow-the-leader constraint, and fixed-cadence random-edge snake spawning; own the prewarmed segment `Pool`; constructor `(rng = Math.random)`, settable `collisionSystem` -- the archetype's behavior + spawn + fragmentation, indifferent to the player.
- `src/scenes/ArenaScene.js` -- construct `SnakeSystem` in order, push `snakeSystem.enemyPool` into the shared `enemyPools` array (so collision/death/scoring already see it), late-bind `snakeSystem.collisionSystem`, and add the placeholder snake render pass (filled circle per segment) -- integrate into the running game.
- `src/systems/snakeSystem.test.js` -- unit-test every I/O-matrix row plus pool prewarm/no-growth, the factory default, slither-phase tick-size independence, and AC2/AC3 through the real shared seams over `[segmentPool]` -- lock the behavior contract, the fragmentation, and the shared-seam integration for this archetype.

**Acceptance Criteria:**
- Given a running game with a snake spawned, when fixed steps run, then it moves as a connected multi-segment body: the head slithers at a constant speed along a serpentine path and bounces off the walls, and each following segment trails the one ahead at the fixed spacing, never referencing the ship (FR4).
- Given a non-invulnerable ship overlapping ANY snake segment (head or body), when `PlayerDeathSystem` runs over the pool array containing the segment pool, then the standard death flow fires (life lost then respawn, or game-over on the last life), at most one death per step, and the segment is not destroyed (FR6).
- Given a player bullet overlapping a snake segment, when `CollisionSystem` runs over the pool array containing the segment pool, then the segment is released to its pool, the bullet is consumed, the segment appears in `killedEnemies`, and `ScoringSystem` adds `SNAKE_SEGMENT_SCORE` to `ScoreState` (NFR2 pooled segments).
- Given a mid-body segment is destroyed, when the next `SnakeSystem` step runs, then the snake breaks apart into two independent snakes at the gap (each continuing to slither and follow-the-leader), and a snake with no remaining segments is removed.
- Given equal elapsed sim time split into fine vs. coarse fixed steps, when a head slithers, then its accumulated slither phase matches (the slither cadence derives from `dt`, not tick count).
- Given the snake behavior and spawn path runs for many steps, when observed, then the segment pool is prewarmed and recycles instances with no growth beyond prewarm (no per-frame allocation on the steady-state move path).

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 5: (high 0, medium 2, low 3)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[low]` `[patch]` `_emitRun` re-derived a split fragment's heading via `Math.atan2(run[0]−run[1])`, but adjacent survivors can coincide (the follow constraint never pushes them apart; a wall reversal folds the head over its body), so `atan2(0,0)` returned an arbitrary due-east `0` — guarded to fall back to `parent.headingRad` when the body axis is degenerate, plus a covering test.
  - `[low]` `[patch]` AC1's headline "slither" (a curved/serpentine path) was verified only by proxies (phase-counter advance + straight-line motion at phase 0); no test asserted the head ever traces a curved trajectory — added an integrated-run test asserting the head advances along +x while its cross-axis position bows up to a peak and weaves back (a real serpentine path, not a straight line), mirroring Story 2.2's emergent-wander patch.
  - `[low]` `[patch]` Only single-wall bounces were tested — the corner case (head crosses an x bound AND a y bound in one step, both `if` blocks firing) was uncovered; added a corner-bounce test asserting both axes clamp and the base heading reflects through both blocks (π/4 → 3π/4 → −3π/4).
  - `[low]` `[patch]` `_reap` partitions a snake into arbitrarily many survivor runs but only a single mid-body kill (2 fragments) was tested; added a two-non-adjacent-kills test asserting a 6-segment snake splits into exactly three fragments with the index-0 run reusing the original struct.
  - `[low]` `[patch]` The `run.length < 2` branch of `_emitRun` (a lone trailing fragment inherits the parent heading) was never exercised; added a test killing the second-to-last segment so the tail is a single-segment run that inherits the finite parent heading.

### 2026-07-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1: (high 0, medium 1, low 0)
- reject: 11: (high 0, medium 2, low 9)
- addressed_findings:
  - none

_Follow-up pass over the identical committed code (`aeac29e..HEAD`, no new code changes). Four review layers (adversarial, edge-case, verification-gap, intent-alignment) re-converged on the same items already captured on the deferred-work ledger from the initial pass: the wall-reversal body crumple, the base-vs-effective-heading wall grind, the unbounded no-cap accumulation, the off-border spawn tail, and the untested ArenaScene wiring/split-late-bind surface — all left as-is (already tracked, orchestrator-owned). One genuinely-new finding was deferred: the snake head spawning INSIDE a random edge can overlap a border-hugging ship for an unavoidable death (spawn-safety owned by Story 2.6; mirrors the Story 2.1/2.2 spawn-safety defers). Remaining reviewer findings (split-heading direction pop, shared slither phase across fragments, duplicated bounds math, heading non-normalization, scene-graphics teardown) were rejected as intent-consistent, cosmetic, or without practical impact._

## Design Notes

**Why per-segment fragmentation, not a shared HP bar.** AC3 says "takes damage/breaks apart … using pooled segments." "breaks apart" + "segments" select per-segment destruction: each segment is a pooled instance with effectively 1 HP; a hit destroys that one segment (via the shared collision seam) and splits the chain — a monolithic HP bar would neither "break apart" nor exercise "pooled segments." Head and body are the same uniform shape and the same per-segment score; the head is just `segments[0]`.

**Why an indifferent slithering head, not a homing one.** The epic/story characterize the snake purely by its slither + segmented body ("dangerous along its whole body", "force me to reposition") and — unlike the Seeker ("homes") and Green Square ("flees/pursues") — conspicuously state no player-tracking. The committed reading is a self-propelled serpentine drifter you dodge, mirroring the Pinwheel's clean no-ship-coupling. Head heading oscillates sinusoidally to read as a slither:

```js
snake.slitherPhaseRad += SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC * dtSec;
const eff = snake.headingRad + Math.sin(snake.slitherPhaseRad) * SNAKE_SLITHER_AMPLITUDE_RAD;
head.x += Math.cos(eff) * SNAKE_HEAD_SPEED * dtSec;
head.y += Math.sin(eff) * SNAKE_HEAD_SPEED * dtSec;
// wall bounce: clamp + reflect the BASE heading (slither continues on top)
if (head.x < minX) { head.x = minX; snake.headingRad = Math.PI - snake.headingRad; }
else if (head.x > maxX) { head.x = maxX; snake.headingRad = Math.PI - snake.headingRad; }
if (head.y < minY) { head.y = minY; snake.headingRad = -snake.headingRad; }
else if (head.y > maxY) { head.y = maxY; snake.headingRad = -snake.headingRad; }
```

**Follow-the-leader (geometric, dt-free).** Process segments head→tail so each follows its already-updated leader:

```js
const dx = leader.x - seg.x, dy = leader.y - seg.y;
const dist = Math.hypot(dx, dy);
if (dist > SNAKE_SEGMENT_SPACING) {
  const k = SNAKE_SEGMENT_SPACING / dist;   // pull to exactly SPACING behind
  seg.x = leader.x - dx * k;
  seg.y = leader.y - dy * k;
}
```

**Frame-rate independence, scoped honestly.** Slither-phase accumulation and spawn cadence are `dt`-based, so their value/count over elapsed sim time is tick-size independent (the tests assert this). Follow-the-leader is a position constraint with no `dt`. The head traces a *curving* path, so its exact position is a discrete integral — I do NOT claim bit-exact fine-vs-coarse position match for the curving head (only straight constant-velocity motion has that property, e.g. the Pinwheel's straight-drift test); the requirement satisfied here is "derives from the fixed-step `dt`, never render time."

**Split without touching shared seams.** `SnakeSystem` reads `collisionSystem.killedEnemies` (the exact signal `ScoringSystem` already consumes) at the top of its step to detect which of its segments were destroyed the prior tick, then partitions each affected snake's `segments` array into maximal runs of survivors (identity lookup against a killed-set — foreign archetypes' kills never match). The first run keeps the original struct (and head state); each later run becomes a new snake whose head re-derives `headingRad` from the direction it was trailing (or inherits the old base heading if it is a lone segment). `collisionSystem` is late-bound by the scene (the pool must exist before the collision system that references it), so the reap is a guarded no-op until set. Splitting/spawning allocate snake structs only on those events; the per-tick move path allocates nothing.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `snakeSystem.test.js` and the unchanged collision/scoring/death suites.
- `npm run build` -- expected: production build succeeds with no errors.

**Manual checks:**
- `npm run dev`, then in the arena: snakes emerge from the edges and slither as connected multi-segment bodies that curve and bounce off the walls, ignoring the ship; touching any part (while not invulnerable) costs a life; a bullet that hits a middle segment destroys that segment, jumps the score, and splits the snake into two shorter snakes that keep slithering; a fresh restart shows the same behavior.

## Auto Run Result

Status: done (follow-up review pass)

**Summary of implemented change:** No code changed in this pass. This was a follow-up review over the already-implemented, already-committed Snake archetype (Story 2.3): a new pooled segment archetype (`SnakeSegment` factory + `SnakeSystem`) with a self-propelled slithering head, wall bounce, head→tail follow-the-leader chain, split-on-kill fragmentation, and fixed-cadence edge spawning, wired into `ArenaScene` and the shared `enemyPools` seams.

**Files changed this pass:**
- `_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md` — appended the follow-up Review Triage Log entry and this Auto Run Result; frontmatter status/followup flag updated.
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended one new defer entry (snake head spawn-on-ship unavoidable-death vector, owned by Story 2.6).

_(Reviewed code diff `aeac29e..HEAD` — `src/config/constants.js`, `src/entities/SnakeSegment.js`, `src/systems/SnakeSystem.js`, `src/scenes/ArenaScene.js`, `src/systems/snakeSystem.test.js` — was unchanged this pass; it remains as committed in the Story 2.3 commit.)_

**Review findings breakdown (4 layers: adversarial, edge-case, verification-gap, intent-alignment):**
- Patches applied: 0.
- Deferred: 1 new — snake head spawns just inside a random edge and can overlap a border-hugging ship for an unavoidable death (spawn-safety is explicitly Story 2.6 scope; mirrors the Story 2.1/2.2 spawn-safety defers).
- Already tracked (no new action): the wall-reversal body crumple, the parallel-to-wall head grind (base-vs-effective heading reflection), the unbounded no-cap accumulation, the off-border spawn tail, and the untested `ArenaScene` wiring/split-late-bind surface — all already on the deferred-work ledger from the initial pass.
- Rejected: split-fragment heading "direction pop" (intent-consistent — "the direction it was trailing"), fragments sharing `slitherPhaseRad` (cosmetic; snakes are positionally independent), duplicated inset-bounds math (DRY nit; both sites use shared constants), `headingRad` never normalized (cos/sin are precision-stable over any realistic session), and `snakeGraphics`/pool teardown-on-restart leak (Phaser destroys scene display objects on shutdown; `SnakeSystem` is reconstructed on scene create). The reap's system-ordering dependency is correct and documented, and its regression risk is already covered by the deferred wiring entry.

**Follow-up review recommendation:** false. Patched findings this pass = 0 (high 0, medium 0, low 0); score = 3×0 + 1×0 = 0 (< 5), no high-severity patch.

**Verification performed:** `npm test` → all 13 suites, 188 tests pass (including `snakeSystem.test.js`, 31 tests). No code was modified this pass, so the committed verification stands; the test run confirms the committed state is green.

**Residual risks:** All carried by the deferred-work ledger (orchestrator-owned): the four already-tracked snake feel/wiring items plus the newly-deferred spawn-on-ship vector, all entangled with Stories 2.5 (spawn cap/despawn, difficulty ramp) and 2.6 (spawn telegraph/safety) and Epic 4 (real body aesthetics). No open risk against this story's literal ACs.

