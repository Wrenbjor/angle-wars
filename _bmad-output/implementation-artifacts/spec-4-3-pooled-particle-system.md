---
title: 'Story 4.3 — Pooled Particle System'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '1a1caad7cacd489fccf4aa8927eaeef1c7a576ed'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '79f811e3d1e7c27916f78225e6962a0bbd769b2e'
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Enemy kills and ship thrust have no particle payoff — the signature Geometry Wars "everything sprays sparks" juice is absent (FR12, NFR2). Kills just remove a shape; the thrusting ship leaves no trail. The epic requires a pool-backed particle system from the start (never retrofitted), able to hold thousands of live particles at 60 FPS (NFR1).

**Approach:** Add a new Phaser-free `ParticleSystem` (registered LAST in the world pipeline, alongside `GridFieldSystem`) that owns a `Pool` of plain particle objects and, each fixed tick, advances/expires live particles, emits a **burst** of neon particles per bullet-killed enemy (reusing `CollisionSystem`'s existing recycle-proof kill snapshots — the same source Story 4.2's ripples use), and emits a throttled **trail** particle behind the ship while it is thrusting. A tiny pure `particleStyle.js` seam holds the age→alpha fade curve. `ArenaScene` renders every live particle as an additive-blend neon dot (glowing under the Story 4.1 camera Bloom) with zero per-frame allocation. All counts/speeds/lifetimes/colors are centralized `PARTICLE_*` constants.

## Boundaries & Constraints

**Always:**
- **Pool-backed, zero steady-state allocation:** particles come from a `src/core/Pool.js` instance (lazy growth, reuse on the hot path). `fixedUpdate` advance/expire and the `ArenaScene` render both use pre-allocated reusable scratch — no per-tick/per-frame array or object allocation once warm (mirrors `CollisionSystem` scratch + the bullet render loop).
- **Bounded:** live particles never exceed `PARTICLE_MAX`; emission that would exceed the cap is skipped (bounds the pool and protects NFR1). "Thousands live" is supported by the cap + pool reuse, not unbounded growth.
- **Runs LAST, read-only:** `ParticleSystem` registers after `HighScoreSystem`/`GridFieldSystem`, so every input it reads is final within the tick: `collisionSystem.bulletKillCount` (this tick's bullet kills only), `collisionSystem.bulletKillX/bulletKillY` (kill-time coordinate snapshots), the post-move `ship` position/facing, and `inputState.moveX/moveY`. It only mutates its own pool — no gameplay effect whatsoever.
- **Burst = bullet kill:** emit `PARTICLE_BURST_COUNT` particles at `(bulletKillX[k], bulletKillY[k])` for `k` in `[0, bulletKillCount)`, each with a random heading (injected `rng`) and speed in `[PARTICLE_BURST_SPEED_MIN, PARTICLE_BURST_SPEED_MAX]`, lifetime `PARTICLE_BURST_LIFETIME_MS`. Particles integrate by their velocity and decay it by exponential drag (`PARTICLE_DRAG_RETAIN_PER_SEC`), and expire (slot freed) once `ageMs ≥ lifeMs`.
- **Trail = thrust:** while `hypot(moveX, moveY) ≥ PARTICLE_THRUST_MIN_INTENT`, accumulate fixed `dt`; each whole `PARTICLE_TRAIL_INTERVAL_MS` crossed emits ONE particle at the ship position drifting opposite the ship facing at `PARTICLE_TRAIL_SPEED` (± `rng` spread), lifetime `PARTICLE_TRAIL_LIFETIME_MS`. When intent falls below threshold, the accumulator resets to 0 so the trail stops immediately.
- All tunables are `PARTICLE_*` in `constants.js` as documented post-launch placeholders (mirrors `GRID_*` / `NEON_BLOOM_*`); no magic numbers inline in the system or at the `ArenaScene` call site. Particle render alpha comes only from `particleStyle.particleAlpha(ageMs, lifeMs)`.
- The particle render layer is added to the existing additive-blend neon list so particles glow under the single camera Bloom — no per-object FX.

**Block If:**
- Nothing new gates this story: particles are plain `graphics.fillCircle` in additive blend (already used for bullets/enemies) and the pool/system pattern already exists. If some genuinely unresolvable platform mismatch surfaces during implementation, HALT with specifics — but none is anticipated.

**Never:**
- Do NOT emit bursts for enemies removed by a Black Hole absorb or a bomb clear (`killedEnemies` indices `≥ bulletKillCount`), and do NOT emit a burst on player death. This matches Story 4.2's established "absorb ≠ explosion; the bomb has its own single effect" convention — the ripple and the burst represent the SAME event (an enemy exploding) and must fire on the same trigger. Bomb/death screen feedback is Story 4.4.
- Do NOT change any simulation/gameplay behavior. Reading `bulletKillCount`/`bulletKillX/Y`, the ship, and input is observation only — no kills, scoring, lives, respawn, movement, or firing may change.
- Do NOT implement other Epic 4 effects (camera shake / hit-stop / flash 4.4, audio 4.5). Do NOT allocate per frame in the hot path, add per-object bloom, or store particles in `world.entities`.

## I/O & Edge-Case Matrix

Scope: pure calls over fakes (no Phaser). `ParticleSystem` is Phaser-free; `particleStyle.js` imports no Phaser. A deterministic injected `rng` makes headings reproducible.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Burst on bullet kills | `bulletKillCount=2`, snapshots (10,20),(30,40) | `2 × PARTICLE_BURST_COUNT` particles active, half at each origin, age 0, speed in `[MIN,MAX]`, heading from `rng` | none |
| Absorb/bomb removals ignored | `killedEnemies` length 5 but `bulletKillCount=2` | only the first 2 origins burst; indices 2..4 emit nothing | none |
| Advance + integrate | active particle at (x,y) vel (vx,vy), tick `dt` | `ageMs += dt`; `x += vx·dt/1000`, `y += vy·dt/1000` | none |
| Drag decay | active particle, tick `dt` | `vx,vy ×= PARTICLE_DRAG_RETAIN_PER_SEC^(dt/1000)` | none |
| Expire | particle with `ageMs` reaching `lifeMs` | slot released to the pool; `activeCount` drops | none |
| Soft cap | `activeCount = PARTICLE_MAX`, a burst is due | no new particles; `activeCount` stays ≤ `PARTICLE_MAX` | none |
| Trail while thrusting | `moveX,moveY` with `hypot ≥ threshold`, accumulated `dt ≥ interval` | one trail particle at ship (x,y), velocity ≈ opposite `ship.angle` × `TRAIL_SPEED` | none |
| Trail throttle | thrust over ticks summing `< interval` | no trail yet; emits exactly one once a whole interval is crossed | none |
| Trail stops | `hypot(moveX,moveY) < threshold` | no trail particle; internal thrust accumulator reset to 0 | none |
| Zero-alloc reuse | expire a particle, then emit | emission reuses the freed slot before the factory grows the pool | none |
| Fade curve | `particleAlpha(ageMs, lifeMs)` | 1 at age 0, 0 at age ≥ life, decreasing in between (clamped 0..1) | tolerates age > life |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ADD a "Pooled particle system (Story 4.3)" section: `PARTICLE_MAX`, `PARTICLE_BURST_COUNT`, `PARTICLE_BURST_SPEED_MIN`, `PARTICLE_BURST_SPEED_MAX`, `PARTICLE_BURST_LIFETIME_MS`, `PARTICLE_BURST_SIZE`, `PARTICLE_BURST_COLOR`, `PARTICLE_DRAG_RETAIN_PER_SEC`, `PARTICLE_THRUST_MIN_INTENT`, `PARTICLE_TRAIL_INTERVAL_MS`, `PARTICLE_TRAIL_LIFETIME_MS`, `PARTICLE_TRAIL_SPEED`, `PARTICLE_TRAIL_SPREAD_RAD`, `PARTICLE_TRAIL_SIZE`, `PARTICLE_TRAIL_COLOR`. Documented placeholders.
- `src/entities/Particle.js` -- NEW plain-data factory `createParticle()` → `{ x, y, vx, vy, ageMs, lifeMs, size, color }` (zeroed shape; `ParticleSystem` overwrites on emit). Mirrors `Seeker.js`/`Bullet.js`. Used as the `Pool` factory.
- `src/systems/ParticleSystem.js` -- NEW Phaser-free `System`. Owns `pool = new Pool(createParticle)`. Ctor `(collisionSystem, ship, inputState, rng = Math.random)`. `fixedUpdate(dt)`: advance/expire active particles (reusable scratch, second-pass release), emit bullet-kill bursts from `bulletKillX/Y`, emit throttled thrust trail (`_trailAccumMs`). Honors `PARTICLE_MAX`. Reusable scratch, no per-tick alloc.
- `src/scenes/particleStyle.js` -- NEW Phaser-free render-math seam: `particleAlpha(ageMs, lifeMs)` (age→alpha fade, clamped 0..1). Imports NO Phaser (mirrors `telegraphCue.js`/`neonStyle.js`).
- `src/scenes/ArenaScene.js` -- construct `ParticleSystem(this.collisionSystem, this.ship, this.inputState)` and `world.addSystem` it LAST (after `GridFieldSystem`); add `this.particleGraphics = this.add.graphics()`; include it in the `applyAdditiveBlend` layer list; in `update()` clear + draw each active particle as a filled circle with `particleAlpha`-derived alpha (zero per-frame alloc, mirrors the bullet render).
- `src/systems/particleSystem.test.js` -- NEW; unit-test every I/O-matrix row (burst source/count/origin, absorb/bomb ignored, advance/drag/expire, soft cap, trail threshold/throttle/stop, reuse) with fakes + deterministic rng.
- `src/scenes/particleStyle.test.js` -- NEW; unit-test `particleAlpha` (endpoints, monotonic decrease, age>life clamp).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the `PARTICLE_*` section -- centralized tunables, no inline magic numbers.
- `src/entities/Particle.js` -- add `createParticle()` plain-data factory -- the pooled particle shape (mirrors other entity factories).
- `src/systems/ParticleSystem.js` -- implement the pool + fixed-step advance/expire + burst + trail emission with the `PARTICLE_MAX` cap -- the Phaser-free simulation seam for particles.
- `src/scenes/particleStyle.js` -- implement `particleAlpha` -- the Phaser-free age→alpha fade used by the render pass.
- `src/scenes/ArenaScene.js` -- register `ParticleSystem` last, add the additive-blend particle layer, render active particles per frame -- integrates particles into the running game with zero per-frame CPU allocation.
- `src/systems/particleSystem.test.js`, `src/scenes/particleStyle.test.js` -- unit-test every I/O-matrix row.

**Acceptance Criteria:**
- Given the game is running, when an enemy is destroyed by a player bullet, then a burst of neon particles appears at the kill point and fades/disperses outward — confirmed via `npm run dev`; automated seam: `ParticleSystem` emits `PARTICLE_BURST_COUNT` particles per bullet kill at the kill snapshot origin, and only for bullet kills (`particleSystem.test.js`).
- Given the ship is thrusting, when it moves, then it leaves a fading particle trail behind it — confirmed via `npm run dev`; automated seam: trail emission is gated on thrust intent ≥ `PARTICLE_THRUST_MIN_INTENT` and throttled to one particle per `PARTICLE_TRAIL_INTERVAL_MS`, resetting when thrust stops (`particleSystem.test.js`).
- Given thousands of particles may be live, when they spawn and expire, then they are drawn from a pool with no per-frame allocation and hold 60 FPS (NFR1, NFR2) — confirmed via the in-game FPS readout; architecturally supported: pool-backed with lazy growth + reuse, bounded by `PARTICLE_MAX`, zero-alloc advance and render (reuse assertion in `particleSystem.test.js`; `Pool` behavior in `pool.test.js`).
- Given particles ship, when the simulation runs, then gameplay is unchanged — the same kills, scores, lives, deaths, and game-over as before (the system is a read-only observer) — confirmed by the existing suites remaining green.

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[low]` `[patch]` Trail throttle `while` loop could infinite-hang if `PARTICLE_TRAIL_INTERVAL_MS` were ever tuned to ≤ 0 (a documented post-launch placeholder). Captured the interval into a local `step` and gated the loop on `step > 0`; shipped-value (24) behavior is identical. Guards a catastrophic (unrecoverable freeze) failure mode — worse than Story 4.2's visible-NaN tuning case, hence patched rather than rejected.
  - `[low]` `[patch]` The `PARTICLE_MAX` bound was pinned only on the burst path (the burst soft-cap test uses zero thrust intent, so the trail branch never ran). Added a trail-at-cap test: fill the pool to `PARTICLE_MAX`, drive sustained thrust across a trail interval, assert `activeCount === PARTICLE_MAX` (trail emits nothing past the cap).
  - `[low]` `[patch]` The spec's #1 Never ("pure read-only observer") was asserted only in prose. Added a gameplay-neutrality test exercising both read paths in one tick (bullet kill + thrust) and asserting the ship (`x/y/angle`), input (`moveX/moveY`), and `bulletKillCount` are all unchanged after `fixedUpdate` while only the system's own pool grows.
- rejected (not defects — intent-sanctioned aesthetics/tunables, disclosed manual-verification boundary, or pre-existing conventions; substantive ones recorded as residual risks):
  - **Per-particle `fillCircle`/`fillStyle` render cost, the per-frame render arrow closure, and the untested rendered-pixels + 60 FPS surface** — the disclosed manual-verification boundary (GLSL/render/frame-timing cannot run under vitest/jsdom), identical to the Story 4.1/4.2 precedent and to every existing entity render; the spec scopes absolute FPS to the `npm run dev` pass + Epic 5 Story 5.5. Recorded as residual risks.
  - **Trail gated on thrust INTENT rather than ship velocity ("when it moves"), trail direction from held facing, trail emitted from ship center, drag value 0.02/s** — defensible juice/aesthetic choices and documented post-launch tunables (a thruster firing into a wall spraying wash is a defensible reading of "thrusting"); judged controller-in-hand. Recorded as residual risks.
  - **Live particles freeze mid-flight on game-over (render continues, `fixedUpdate` gated off)** — intent-consistent with the established "the whole sim freezes on game-over" behavior (Story 4.2 accepted the identical grid freeze), and the particles sit under the dimming game-over overlay.
  - **"Runs LAST" is a comment-only invariant; the burst `bulletKillX[k]` read is unguarded against array-length drift** — no reachable trigger: `CollisionSystem` fills `bulletKillX/Y` in lockstep up to `bulletKillCount`, and the shipped pipeline registers this system last; both mirror the already-shipped `GridFieldSystem` exactly.
  - **Soft-cap multi-kill asymmetry (earlier kills in a tick consume the remaining budget) and the "large catch-up dt" comment** — acceptable graceful degradation only at the 2000-particle pathological cap, and a harmless defensive loop (`fixedUpdate` always receives the constant `FIXED_STEP_MS`).

## Design Notes

**Why bullet kills only.** Story 4.2 already defined, for this exact codebase, what "an enemy explodes" means: a player bullet kill (`killedEnemies[0..bulletKillCount)` with the recycle-proof `bulletKillX/Y` snapshots), NOT a Black Hole absorb (sucked in, not blown up) and NOT a per-enemy bomb clear (the bomb owns one effect). The grid ripple and the particle burst are two renderings of the SAME event, so they fire on the SAME trigger. Reusing `CollisionSystem`'s existing snapshots means no new sim-side latch and guaranteed-correct origins even when a killed enemy's object is recycled later in the tick.

**Zero-alloc advance.** `Pool.forEachActive` forbids releasing mid-iteration, so advance materializes the active set into a reusable scratch array (length-reset + push), integrates/ages in place, collects expired into a second reusable array, and releases them after iteration — the `CollisionSystem` pattern. Emission `acquire()`s from the pool (reuses a freed particle; the factory allocates only while growing), then overwrites all fields.

**Trail throttle.** `_trailAccumMs += dt` while thrusting; `while (_trailAccumMs >= PARTICLE_TRAIL_INTERVAL_MS) { emit(); _trailAccumMs -= interval; }` so a large catch-up `dt` emits a bounded number, and dropping below the intent threshold sets `_trailAccumMs = 0` so the trail ends cleanly. Input intent is constant across a frame's sub-steps (sampled once at render rate), so per-sub-step accumulation is correct.

**Fresh per run.** A new `ParticleSystem` (own pool) is constructed each `create()`/`scene.restart()`, so particles reset to none — matching `GridFieldSystem`. The GLSL-free render (plain `fillCircle`) is a manual `npm run dev` check for actual glow/feel; the pure system + fade seams carry the automated coverage (Story 4.1/4.2 precedent).

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new `particleSystem.test.js` and `particleStyle.test.js`; every other existing suite unchanged and green (gameplay-neutral change).
- `npm run build` -- expected: production build succeeds (pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: destroying an enemy with a bullet sprays a short-lived burst of glowing neon particles that disperse and fade; flying the ship leaves a fading thruster trail that stops when you release the stick; a busy arena (many kills + trail) holds the FPS readout at/near 60. Black-hole absorbs and bomb clears do NOT each spray a burst.

## Auto Run Result

Status: done

**Implemented change:** Story 4.3 — Pooled Particle System. A new Phaser-free `ParticleSystem` (registered LAST in the world pipeline, after `GridFieldSystem`) owns a `Pool` of plain particle objects and, each fixed tick, advances/expires every live particle (age by `dt`, integrate by velocity, decay velocity by exponential drag, free the slot at end of life), emits a **burst** of `PARTICLE_BURST_COUNT` neon particles per bullet-killed enemy at that kill's recycle-proof coordinate snapshot (the same `CollisionSystem.bulletKillX/Y[0..bulletKillCount)` source Story 4.2's grid ripples read — so absorbs and bomb clears do NOT spray), and emits a throttled thrust **trail** (one particle per `PARTICLE_TRAIL_INTERVAL_MS` of accumulated thrust, drifting opposite the ship's facing) while the move-intent magnitude is at/above the threshold. Live particles are bounded by `PARTICLE_MAX` (emission past the cap is skipped) and the hot path allocates nothing once warm (reusable advance scratch + pool reuse). A tiny pure `particleStyle.particleAlpha` seam holds the age→alpha fade. `ArenaScene` renders every live particle as an additive-blend neon dot (per-particle color + fade alpha) that glows under the Story 4.1 camera Bloom, with zero per-frame array/object allocation. The system is a pure read-only observer — no kills, scoring, lives, movement, or firing changes.

**Files changed:**
- `src/config/constants.js` — added the documented "Pooled particle system (Story 4.3)" section: the 15 `PARTICLE_*` tunables (cap, burst count/speed range/lifetime/size/color, drag, thrust threshold, trail interval/lifetime/speed/spread/size/color) as post-launch placeholders.
- `src/entities/Particle.js` — NEW `createParticle()` plain-data factory `{x,y,vx,vy,ageMs,lifeMs,size,color}` (the Pool factory; every field overwritten on emit).
- `src/systems/ParticleSystem.js` — NEW Phaser-free system: owns the particle `Pool`; zero-alloc advance/integrate/drag/expire (reusable scratch + second-pass release); bullet-kill bursts from the recycle-proof snapshots; throttled thrust trail (guarded against a ≤ 0 interval); honors `PARTICLE_MAX`.
- `src/scenes/particleStyle.js` — NEW Phaser-free `particleAlpha(ageMs, lifeMs)` age→alpha fade, clamped `[0,1]`, degenerate-safe.
- `src/scenes/ArenaScene.js` — constructs `ParticleSystem` and registers it LAST; adds the additive-blend `particleGraphics` layer; renders active particles per frame with `particleAlpha`-derived alpha (zero per-frame allocation, mirrors the bullet render).
- `src/systems/particleSystem.test.js`, `src/scenes/particleStyle.test.js` — NEW; cover every I/O-matrix row (burst source/count/origin/age, rng heading+speed, absorb/bomb ignored, advance/integrate/drag/expire, burst soft cap, trail-at-cap, trail threshold/throttle/stop, zero-alloc reuse, gameplay neutrality; the fade curve endpoints/monotonicity/clamp/degenerate).

**Review findings breakdown:** 3 patches applied (all low — trail-loop ≤ 0 infinite-hang guard; trail-at-cap bound test; gameplay-neutrality test); 0 intent_gap; 0 bad_spec; 0 deferred; 15 rejected (intent-sanctioned aesthetics/tunables, the disclosed manual render/FPS boundary, or pre-existing conventions — see the Review Triage Log).

**Follow-up review recommendation:** false. Patched this pass: 0 high, 0 medium, 3 low → score `3×0 + 1×3 = 3` (< 5), no high severity.

**Verification performed:** `npm test` — 30 files, 446 tests all pass (including the new `particleSystem.test.js` and `particleStyle.test.js`; every other existing suite unchanged and green, confirming gameplay is unchanged). `npm run build` — production build succeeds (pre-existing Phaser chunk-size advisory only). Matrix Test Audit: every I/O row is covered by a test that ran and passed. The `PARTICLE_*` constants, the `CollisionSystem.bulletKillCount/X/Y` contract, the `ship`/`InputState` shapes, and the last-in-pipeline registration were all confirmed against the live code; no Block-If triggered.

**Residual risks (unverifiable in this environment; all on the manual `npm run dev` checklist):**
- The Phaser render path (per-particle additive `fillCircle`, glow under bloom) and the busy-arena 60 FPS target cannot execute under vitest/jsdom, so actual on-screen sparks, dispersal feel, glow, and frame timing are confirmed only by the in-browser manual pass — the automated tests cover the sim + fade seams, not rendered pixels or frame rate (a disclosed limitation matching the Story 4.1/4.2 precedent; the absolute frame-budget audit belongs to Epic 5 Story 5.5).
- All `PARTICLE_*` values are documented post-launch placeholders; burst dispersal (drag `0.02/s`), trail density/direction/origin, and colors are untuned and best judged controller-in-hand.
- The thrust trail is gated on move-intent magnitude (not ship velocity), so a wall-pinned ship holding thrust emits a stationary trail — a defensible "engine is firing" reading of "thrusting," recorded rather than changed.
- Live particles freeze in place on game-over (the whole sim freezes; render continues) and sit under the dimming overlay until restart — intent-consistent with the established freeze behavior (Story 4.2 grid precedent).
