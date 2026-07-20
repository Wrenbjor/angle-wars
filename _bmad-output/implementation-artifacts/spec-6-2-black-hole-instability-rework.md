---
title: 'Black Hole Instability Rework'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: '8c01f5dc3a744aeba763df0c296705f8d6601e0d'
final_revision: '10fc141'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/entities/BlackHole.js'
  - '{project-root}/src/systems/BlackHoleSystem.js'
  - '{project-root}/src/systems/BombSystem.js'
  - '{project-root}/src/systems/PlayerDeathSystem.js'
  - '{project-root}/src/systems/AudioDirectorSystem.js'
  - '{project-root}/src/systems/GridFieldSystem.js'
  - '{project-root}/src/state/PlayerState.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/scenes/ArenaScene.js'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The Black Hole (Story 2.4) plays like a chore, not a threat: feeding it grows it toward a *harmless* radius cap and it also emits seekers (double jeopardy), while sustained fire depletes a hidden `hp` bar to destroy it for a payout. Ignoring it is never actually dangerous.

**Approach:** Invert it into an unstable ticking bomb. Absorbed enemies/matter grow its radius toward an *unstable threshold*; crossing it **detonates** — a smart-bomb screen clear (reuse `BombSystem`) that also **costs the player a life** (reuse `PlayerDeathSystem` via a shared `pendingDeath` flag) with the normal respawn + multiplier reset. Player fire now **shrinks** it (the inverse of feeding); shrinking it to a floor is a **safe implosion** that destroys it for its score payout. The old `hp`/bullet-damage destruction and the feed-driven seeker emission are removed. Radius is the single instability metric; render shows an escalating red pulse and audio a rising urgency level as it nears the threshold.

## Boundaries & Constraints

**Always:**
- `radius` is the sole instability metric. Enemy absorption grows it by `BLACKHOLE_GROWTH_PER_ABSORB`; each absorbed player bullet shrinks it by `BLACKHOLE_SHRINK_PER_BULLET`. Gravity, absorption cadence, and all growth/shrink derive from the fixed-step `dt` path exactly as today (gravity stays a `dt`-scaled position nudge).
- After a tick's absorptions, evaluate the hole once: `radius >= BLACKHOLE_UNSTABLE_RADIUS` → **detonation**; else `radius <= BLACKHOLE_MIN_RADIUS` → **safe implosion**. Detonation takes precedence if both somehow hold.
- **Detonation** = (1) `bombSystem.detonateAt(hole.x, hole.y)` (the reused smart-bomb screen clear of the four archetype pools) + (2) `playerState.pendingDeath = true` (the normal death/respawn + multiplier reset) + (3) release the hole. **No** `BLACKHOLE_SCORE` payout on detonation.
- **Safe implosion** = credit `BLACKHOLE_SCORE` to `scoreState` + release the hole. **No** screen clear, **no** life cost, no lethal blast.
- Pool mutations from a detonation's screen clear happen in the SECOND (deferred) pass, AFTER this system's own absorbed-bullet/enemy/hole releases, so no enemy is double-released and each appears in `collisionSystem.killedEnemies` exactly once (mirror the existing two-pass discipline). Absorbed enemies stay unscored (this system runs after `ScoringSystem`).
- Ship contact with an undestroyed, non-telegraphing hole still kills the player through the existing `PlayerDeathSystem` pool-list seam (`[...enemyPools, holePool]`), unchanged.
- `PlayerDeathSystem` consumes `pendingDeath` read-and-clear at the top of its tick and applies the SAME death-flow body as a contact death, subject to the SAME guards: a detonation during invulnerability or after game-over is suppressed AND the flag is dropped (never deferred to a later tick).
- A telegraphing hole (`telegraphMs > 0`) stays frozen and non-lethal (no gravity/absorb/grow/shrink/detonation/implosion) and does not contribute to instability, exactly as today.
- `blackHoleInstability(radius)` is one pure, exported function: `clamp((radius − BLACKHOLE_RADIUS) / (BLACKHOLE_UNSTABLE_RADIUS − BLACKHOLE_RADIUS), 0, 1)`. The render color/pulse, the audio urgency level, and the system's `maxInstability` all derive from it — one formula, one source.
- All new feel/economy/color values are centralized constants in `constants.js` (no inline magic numbers), per the post-launch-tuning constraint.
- Steady-state gravity/absorb path allocates nothing (NFR2): reuse the existing scratch/two-pass buffers.

**Block If:**
- Reusing `BombSystem` for the screen clear or `PlayerDeathSystem` for the life cost would require changing the *semantics* of a shared seam (rather than adding a `detonateAt` method / a `pendingDeath` flag consumed through the normal flow). HALT with specifics.

**Never:**
- Do not keep or re-add `hp`, `feed`, bullet-damage destruction, or feed-driven seeker emission — they are removed. The hole's only threat is the instability clock (avoid double jeopardy).
- Do not add a passive time-based growth timer — growth is absorption-driven only (matches "grows *as it absorbs*").
- Do not award `BLACKHOLE_SCORE` on detonation, and do not make the safe implosion clear the screen or cost a life.
- Do not make the detonation death bypass the invuln/game-over guards (it routes through the *normal* death flow).
- Do not reimplement the screen clear or the death flow inline in `BlackHoleSystem`; call the reused seams.
- Do not add the hole to the `CollisionSystem` list, and do not make gravity mutate velocity (position-nudge only), per Story 2.4's invariants.

## I/O & Edge-Case Matrix

Scope: one `BlackHoleSystem.fixedUpdate(dt)` step unless noted. `bombSystem`/`collisionSystem` are late-bound; until set, the dependent effect is a guarded no-op (gravity/shrink still run).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gravity pull | entity within `BLACKHOLE_GRAVITY_RADIUS` | position nudged toward hole, `dt`-scaled, distance falloff (unchanged from 2.4) | guard `d>0`, no NaN |
| Enemy absorption → grow | active non-telegraph enemy overlaps body; `cs` set | enemy released to OWNER pool + pushed to `cs.killedEnemies` (unscored); `hole.radius += BLACKHOLE_GROWTH_PER_ABSORB`; NO seeker emitted | guard `cs` null |
| Bullet absorption → shrink | active bullet overlaps body | bullet released to bullet pool; `hole.radius -= BLACKHOLE_SHRINK_PER_BULLET` | none |
| Reach unstable → detonation | after absorptions `radius >= BLACKHOLE_UNSTABLE_RADIUS` | `bombSystem.detonateAt(hole.x,hole.y)` called; `playerState.pendingDeath = true`; hole released; `scoreState.score` unchanged (no payout) | guard `bombSystem` null (still cost life + release) |
| Reach floor → safe implosion | after absorptions `radius <= BLACKHOLE_MIN_RADIUS` | `scoreState.score += BLACKHOLE_SCORE`; hole released; `bombSystem.detonateAt` NOT called; `pendingDeath` NOT set | none |
| Detonation two-pass safety | hole detonates same tick it absorbs enemy E, with other active enemies present | E appears once in `killedEnemies` (absorb) and is not re-released; the screen clear releases the OTHER actives once each; hole released once | deferred second pass |
| Instability level | after tick | `blackHoleSystem.maxInstability = max over active non-telegraph holes of blackHoleInstability(radius)`; `0` when none | none |
| Telegraphing hole | `telegraphMs > 0` | frozen: no gravity/absorb/grow/shrink/detonation/implosion; non-lethal; excluded from `maxInstability` | none |
| Ship contact lethal (AC4) | non-invuln ship overlaps active hole; `PlayerDeathSystem` over `[…enemyPools, holePool]` | standard death flow; hole NOT destroyed; at most one death/step | none |
| Detonation life cost via flag | `playerState.pendingDeath` true; vulnerable | `PlayerDeathSystem` applies normal death (life−1 + respawn + `PLAYER_INVULN_MS` + `resetMultiplier` + `deathSeq++`); flag cleared | none |
| Detonation during invuln | `pendingDeath` true; `invulnMs > 0` | no death; flag cleared (not deferred); invuln decremented | none |
| Detonation after game-over | `pendingDeath` true; `gameOver` true | no death; flag cleared; no negative lives | none |
| `detonateAt(x,y)` seam (BombSystem) | called directly | clears all four archetype pools to owners + `killedEnemies`; arms shockwave at `(x,y)`; does NOT decrement `bombs`; does NOT consume the input latch | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- remove `BLACKHOLE_MAX_RADIUS`, `BLACKHOLE_HP`, `BLACKHOLE_BULLET_DAMAGE`, `BLACKHOLE_GROWTH_PER_FEED`, `BLACKHOLE_FEED_PER_SPAWN`; add `BLACKHOLE_UNSTABLE_RADIUS`, `BLACKHOLE_MIN_RADIUS`, `BLACKHOLE_GROWTH_PER_ABSORB`, `BLACKHOLE_SHRINK_PER_BULLET`, `COLOR_BLACK_HOLE_UNSTABLE`, and pulse tuning (`BLACKHOLE_PULSE_HZ`, `BLACKHOLE_PULSE_ALPHA_DEPTH`). Keep `BLACKHOLE_RADIUS`, gravity, spawn, `BLACKHOLE_MAX_ACTIVE`, `BLACKHOLE_POOL_PREWARM`, `BLACKHOLE_SCORE`, `COLOR_BLACK_HOLE`. (`GRID_WARP_RADIUS` already tracks `BLACKHOLE_GRAVITY_RADIUS` — untouched.)
- `src/entities/BlackHole.js` -- new shape `{x, y, radius, telegraphMs}` (drop `hp`, `feed`); export pure `blackHoleInstability(radius)`; rewrite the doc comment.
- `src/systems/BlackHoleSystem.js` -- the core rework (see Tasks). Constructor drops `spawnPool`, adds `playerState`; add settable `bombSystem` (late-bound). Remove `_feed`/`_spawnSeekerAtEdge`/seeker imports. Add `maxInstability` public level. Detonation + implosion replace the hp path; detonation screen-clear deferred to the second pass.
- `src/systems/PlayerDeathSystem.js` -- consume `playerState.pendingDeath` (read-and-clear) at top-of-tick under the existing guards; extract the death-flow body into `_applyDeath()` reused by both the contact path and the flag path.
- `src/state/PlayerState.js` -- add `pendingDeath: false` to the shape + `createPlayerState()`; document it as a one-tick programmatic-death request.
- `src/systems/BombSystem.js` -- extract `detonateAt(x, y)` (the two-pass clear + shockwave arm at `(x,y)`, no bomb decrement, no input consume); `fixedUpdate` calls `detonateAt(ship.x, ship.y)` then decrements `bombs` on the player path.
- `src/systems/AudioDirectorSystem.js` -- add `blackHoleSystem` source; expose `blackHoleInstability` getter (a LEVEL = `blackHoleSystem.maxInstability`, `0` when absent), mirroring `musicIntensity`.
- `src/systems/GridFieldSystem.js` -- repoint the warp-strength normalization from `BLACKHOLE_MAX_RADIUS` to `BLACKHOLE_UNSTABLE_RADIUS` (semantically the same reference — the largest radius a hole reaches).
- `src/scenes/blackHoleRender.js` -- NEW pure, Phaser-free helpers: `blackHolePulseColor(ratio)` (lerp `COLOR_BLACK_HOLE`→`COLOR_BLACK_HOLE_UNSTABLE`) and `blackHolePulseAlpha(ratio, timeMs, baseAlpha)` (steady at ratio 0; sine pulse whose depth/rate rises with ratio).
- `src/scenes/ArenaScene.js` -- in the hole render pass, per hole compute `ratio = blackHoleInstability(h.radius)`, fill with `blackHolePulseColor(ratio)` at `blackHolePulseAlpha(ratio, now, telegraphAlpha(...))`; map `audioDirector.blackHoleInstability` to the urgency-cue gain in the audio engine (manual boundary).
- `src/scenes/buildArenaWorld.js` -- move `createPlayerState()` above the Black Hole section; new `BlackHoleSystem(ship, bulletPool, enemyPools, scoreState, playerState, rng)`; late-bind `blackHoleSystem.bombSystem = bombSystem`; pass `blackHoleSystem` to `AudioDirectorSystem`.
- Test files (below): `blackHoleSystem.test.js` (rewrite), `playerDeathSystem.test.js`, `bombSystem.test.js`, `audioDirectorSystem.test.js`, `blackHoleRender.test.js` (new), `buildArenaWorld.test.js`, `renderIntegration.test.js`, `bombIntegration.test.js`, `extraLifeIntegration.test.js`.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- swap the constant set as in the Code Map; keep names centralized with doc comments (placeholders tuned post-launch). `BLACKHOLE_MIN_RADIUS < BLACKHOLE_RADIUS < BLACKHOLE_UNSTABLE_RADIUS`.
- `src/entities/BlackHole.js` -- shape `{x,y,radius,telegraphMs}`; `createBlackHole()` returns it with `radius: BLACKHOLE_RADIUS`, `telegraphMs: 0`; export `blackHoleInstability(radius)` (clamped ratio).
- `src/systems/BlackHoleSystem.js` -- gravity unchanged; per active non-telegraph hole absorb overlapping bullets (release + `radius -=` shrink) and enemies (release to owner + `killedEnemies` + `radius +=` growth, guarded on `cs`); after the tick's absorptions decide detonation vs implosion (detonation precedence); collect detonations and release-holes; in the deferred pass release absorbed bullets/enemies/holes THEN run each collected detonation's `bombSystem.detonateAt` + set `playerState.pendingDeath`; credit implosion payout; compute `maxInstability`. Remove `_feed`/`_spawnSeekerAtEdge`/`spawnPool`. Zero steady-state allocation.
- `src/state/PlayerState.js` -- add `pendingDeath: false`.
- `src/systems/PlayerDeathSystem.js` -- top of `fixedUpdate`: `const forced = ps.pendingDeath; ps.pendingDeath = false;` then the existing `gameOver`/`invulnMs` guards; if still vulnerable and `forced`, `_applyDeath()` and return before the contact scan. `_applyDeath()` holds the extracted life/respawn/game-over/`resetMultiplier`/death-latch body.
- `src/systems/BombSystem.js` -- add `detonateAt(x,y)`; `fixedUpdate` player path calls it then `ss.bombs -= 1`.
- `src/systems/AudioDirectorSystem.js` -- add `blackHoleSystem` ctor arg + `blackHoleInstability` getter.
- `src/systems/GridFieldSystem.js` -- `BLACKHOLE_MAX_RADIUS` → `BLACKHOLE_UNSTABLE_RADIUS` (import + the `s = hole.radius / …` line + comment).
- `src/scenes/blackHoleRender.js` -- NEW pure helpers per Code Map.
- `src/scenes/ArenaScene.js` -- wire pulse color/alpha into the hole render + the audio urgency level (import the new helpers + `blackHoleInstability`).
- `src/scenes/buildArenaWorld.js` -- reorder `createPlayerState()`, new ctor args, `bombSystem` late-bind, `AudioDirectorSystem` gets `blackHoleSystem`.
- `src/systems/blackHoleSystem.test.js` -- REWRITE: cover every I/O-matrix row incl. grow/shrink, detonation (via a `BombSystem` and `PlayerDeathSystem`/`playerState` — real or faithful stub — asserting screen clear + `pendingDeath` + no payout), safe implosion (payout + release, no clear/death), detonation two-pass safety with a real `BombSystem` + real `CollisionSystem`, `maxInstability`, telegraph freeze, ship-contact via real `PlayerDeathSystem`, `blackHoleInstability` formula, and zero-allocation.
- `src/systems/playerDeathSystem.test.js` -- add: `pendingDeath` → normal death (life/respawn/invuln/multiplier reset/`deathSeq`); suppressed+cleared during invuln; suppressed+cleared after game-over; one death per tick when both `pendingDeath` and a contact overlap.
- `src/systems/bombSystem.test.js` -- add: `detonateAt(x,y)` clears all pools + arms shockwave at `(x,y)` without decrementing `bombs` or consuming the latch; player `fixedUpdate` path still decrements exactly one.
- `src/systems/audioDirectorSystem.test.js` -- add: `blackHoleInstability` reflects `blackHoleSystem.maxInstability` as a level (read, not consumed); `0` with no `blackHoleSystem`.
- `src/scenes/blackHoleRender.test.js` -- NEW: `blackHolePulseColor(0)===COLOR_BLACK_HOLE`, `(1)===COLOR_BLACK_HOLE_UNSTABLE`, midpoint interpolates; `blackHolePulseAlpha` steady at ratio 0 and oscillates with `timeMs` at ratio 1.
- `src/scenes/buildArenaWorld.test.js` -- update to the new `BlackHoleSystem` signature, assert `blackHoleSystem.bombSystem` late-bind, `AudioDirectorSystem` wired with `blackHoleSystem`, `playerState` still shared into both, `deathPools` still `[...enemyPools, holePool]`, same 19 systems same order.
- `src/scenes/renderIntegration.test.js` -- add source-text assertions: ArenaScene's hole render calls `blackHolePulseColor`/`blackHolePulseAlpha`/`blackHoleInstability`, and maps `audioDirector.blackHoleInstability` into the audio engine.
- `src/systems/bombIntegration.test.js` -- update the hole init in case (c) to the new shape (drop `hp`/`feed`); the "bomb never clears the hole" assertion stands.
- `src/systems/extraLifeIntegration.test.js` -- rework case (c): drive the payout through the **safe implosion** (seed `hole.radius = BLACKHOLE_MIN_RADIUS + BLACKHOLE_SHRINK_PER_BULLET`, place one overlapping bullet → implode → `BLACKHOLE_SCORE`), update the narrative from "detonation payout" to "implosion payout".

**Acceptance Criteria:**
- Given an active hole absorbing an enemy, when the step runs, then its `radius` grows by `BLACKHOLE_GROWTH_PER_ABSORB`, the enemy is removed via `collisionSystem.killedEnemies` unscored, and no seeker is emitted.
- Given an active hole struck by a player bullet, when the step runs, then the bullet is consumed and `radius` shrinks by `BLACKHOLE_SHRINK_PER_BULLET`.
- Given a hole whose radius reaches `BLACKHOLE_UNSTABLE_RADIUS`, when the step runs, then `bombSystem.detonateAt(hole.x,hole.y)` fires the screen clear, `playerState.pendingDeath` is set, the hole is released, and `scoreState.score` gains no payout.
- Given `playerState.pendingDeath` is set and the player is vulnerable, when `PlayerDeathSystem` runs, then a life is lost with the normal respawn/invulnerability and `resetMultiplier` fires and `deathSeq` bumps; given the player is invulnerable or game-over instead, then no death occurs and the flag is cleared (not deferred).
- Given a hole shrunk to `BLACKHOLE_MIN_RADIUS`, when the step runs, then `BLACKHOLE_SCORE` is credited, the hole is released, and neither a screen clear nor a life cost occurs.
- Given a non-invulnerable ship overlapping an undestroyed hole, when `PlayerDeathSystem` runs over `[…enemyPools, holePool]`, then the standard death flow fires and the hole is not destroyed (unchanged AC4).
- Given a hole detonating the same tick it absorbs an enemy while other enemies are active, when the two passes complete, then no enemy is double-released and each cleared/absorbed enemy appears once in `collisionSystem.killedEnemies`.
- Given `blackHoleInstability(radius)`, when radius is at `BLACKHOLE_RADIUS` it returns 0, at `BLACKHOLE_UNSTABLE_RADIUS` it returns 1, and it clamps outside `[0,1]`; and `blackHoleSystem.maxInstability` equals the max over active non-telegraphing holes.

## Spec Change Log

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 1, medium 2, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 12
- addressed_findings:
  - `[high]` `[patch]` The new escalating-red hole pulse (temporal alpha oscillation up to `BLACKHOLE_PULSE_HZ`) was applied unconditionally in the ArenaScene render, bypassing the Story 6.1 Reduced Motion accommodation that gates flash/camera-shake/grid-warp — a flashing red in the WCAG 2.3.1 seizure band with no opt-out. Gated the pulse's temporal oscillation on `this._reducedMotion` (steady alpha when on; the escalating red COLOR stays as the static readable cue), mirroring the sibling effects; added a source-text assertion to `renderIntegration.test.js` and a steady-alpha unit test to `blackHoleRender.test.js`.
  - `[medium]` `[patch]` The black-hole audio urgency level was read from the fixed-step-latched `maxInstability` every render frame, but the sim (and `maxInstability`) halts at game-over — so a run ending with an unstable hole froze the level non-zero and droned the urgency tone over the game-over screen. Zeroed the urgency level when `playerState.gameOver` in the render loop; updated the urgency-wiring source-text assertion.
  - `[medium]` `[patch]` The detonation life-cost was verified only in halves (producer asserted `pendingDeath === true`; consumer hand-set the flag) — no test drove a real detonation through a real `PlayerDeathSystem`. Added two composed tests (reusing the AC4 harness): a real detonation decrements `lives` with the normal respawn/invuln + `deathSeq` bump, and a last-life detonation ends the run (`gameOver`).
  - `[low]` `[patch]` A hole struck by multiple bullets in one tick could shrink its radius below zero before the end-of-tick implosion check, feeding a negative radius into the same-tick enemy-absorb overlap test. Clamped the per-bullet shrink at a zero floor; added a 20-bullet covering test (floors at 0, still safely implodes).

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1: (high 0, medium 0, low 1)
- reject: 13
- addressed_findings:
  - none
- notes: Four review layers (adversarial, edge-case, verification-gap, intent-alignment) re-ran on the committed diff (`8c01f5d..f2833c7`, src/ only). Verification-gap found zero gaps and praised the coverage. One genuinely new latent finding deferred (concurrent-detonation life accounting under a raised `BLACKHOLE_MAX_ACTIVE`); the highest-severity finding (free screen clear during invuln) was already captured in the prior pass's deferred-work entry and is spec-consistent (AC2 routes the cost through the normal death flow, which respects invulnerability), so not re-added. All other findings rejected as spec-mandated (single end-of-tick evaluation, instability formula clamp, grid-warp normalization, dual-seam reuse), not reachable (detonateAt guard, sine-phase precision), consistent-existing-behavior (pause freezes the whole audio mix, not just urgency; all-or-nothing continuous-voice construction), or prior-pass deliberate decisions (call-site game-over urgency zeroing).

## Design Notes

**Radius is the whole clock.** Collapsing instability onto `radius` means the existing grid-warp (whose strength already scales with radius) and the new red pulse both intensify for free as the hole nears detonation, and shrinking it visibly calms it. `blackHoleInstability(radius)` is the one shared formula (0 at spawn radius, 1 at the unstable threshold, clamped) — imported by the render color/pulse, the audio level, and the system's `maxInstability`, so there is a single source of "how close to blowing."

**Two reuse seams, minimally extended — not reimplemented.**
- Screen clear: `BombSystem.detonateAt(x, y)` extracts today's inline clear+arm so the black hole triggers the identical, position-originated shockwave without touching `bombs` or the input latch. `BlackHoleSystem` runs before `BombSystem`, so it late-binds a `bombSystem` reference (mirroring the existing `collisionSystem` late-bind).
- Life cost: a `pendingDeath` boolean on the shared `PlayerState` — the same read-and-clear latch idiom as `InputState.consumeBomb` — consumed by `PlayerDeathSystem` through the *normal* death flow (extracted into `_applyDeath`). Because it routes through the existing guards, a detonation during respawn-invulnerability or after game-over is suppressed and the one-tick flag is dropped, never deferred. This is the chosen reading of "the *normal* death/respawn flow": it respects invulnerability. `createPlayerState()` moves above the black-hole construction so both systems share the one `playerState`.

**Two-pass detonation safety.** `detonateAt` releases enemies immediately, so it must run in the deferred second pass — after this system releases its own absorbed bullets/enemies/holes. By then absorbed enemies are already inactive, so the clear's `forEachActive` cannot re-collect them: every enemy lands in `killedEnemies` exactly once. (`BLACKHOLE_MAX_ACTIVE` is 1 by default, but the detonation buffer is coded for N.)

**Detonation pays nothing; implosion pays.** AC ties the payout to defusing (implosion); detonation's "reward" is the consolation screen clear. Keeping them disjoint (payout only on `radius <= BLACKHOLE_MIN_RADIUS`) matches the fiction: let it blow and you lose a life, defuse it and you bank `BLACKHOLE_SCORE`.

**Manual-verification boundary.** The pure helpers (`blackHoleInstability`, `blackHolePulseColor/Alpha`) and the sim levels (`maxInstability`, `AudioDirectorSystem.blackHoleInstability`) are unit-tested; the visible red pulse and the audible rising urgency cue (Phaser render + Web Audio synthesis) are the disclosed manual boundary, per codebase precedent (Story 6.1), covered by source-text wiring assertions in `renderIntegration.test.js`.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the rewritten `blackHoleSystem.test.js`, the new `blackHoleRender.test.js`, and the updated player-death/bomb/audio/grid/build/bomb-integration/extra-life-integration suites.
- `npm run build` -- expected: production build succeeds (no dangling references to the removed constants).

**Manual checks (Phaser render + Web Audio — not unit-testable, per codebase precedent):**
- `npm run dev`: let a black hole absorb enemies — it grows, the grid bow deepens, it pulses an escalating red, and a rising urgency tone tracks its approach; ignore it and at the threshold it detonates — the screen clears (enemies gone) and the player loses a life with the normal respawn + multiplier reset. Pour sustained fire into a hole instead — it shrinks and safely implodes for a score jump (no blast, no life lost). Touching an undestroyed hole while vulnerable still kills. Reduced Motion (Story 6.1) still flattens the warp/flash/shake AND the new hole pulse (steady red, no flashing).

## Auto Run Result

Status: done (follow-up review pass)

**Summary of change under review:** This run was a follow-up review of the already-implemented-and-committed Black Hole Instability Rework (baseline `8c01f5d` → `f2833c7`). No code was changed this pass; the rework inverts the Black Hole from an HP-drained/feed-grown hazard into an instability bomb: absorbed enemies grow `radius`, player bullets shrink it, crossing `BLACKHOLE_UNSTABLE_RADIUS` detonates (reused `BombSystem.detonateAt` screen clear + `pendingDeath` life cost, no payout), shrinking to `BLACKHOLE_MIN_RADIUS` safely implodes for `BLACKHOLE_SCORE`. Instability drives a red render pulse (reduced-motion-gated) and an audio urgency tone.

**Files changed this pass (review bookkeeping only):**
- `_bmad-output/implementation-artifacts/spec-6-2-black-hole-instability-rework.md` — status lifecycle, follow-up triage-log entry, `followup_review_recommended: false`, this result.
- `_bmad-output/implementation-artifacts/deferred-work.md` — one new deferred entry (concurrent-detonation life accounting, latent).

**Review findings breakdown:** 4 layers (adversarial, edge-case, verification-gap, intent-alignment) re-run on the committed src/ diff. patch: 0 · defer: 1 (low) · reject: 13 · intent_gap: 0 · bad_spec: 0. Verification-gap reported zero gaps. The one deferred finding: `pendingDeath` is a boolean set per-detonation, so a future `BLACKHOLE_MAX_ACTIVE > 1` would let N simultaneous detonations cost one life but clear the screen N times (latent — unreachable at the current cap of 1). The highest-severity finding (free screen clear during respawn-invulnerability) was already captured in the prior pass's deferred entry and is spec-consistent (AC2 routes the cost through the normal death flow, which respects invuln), so not re-added. All other findings rejected as spec-mandated, not reachable, consistent existing behavior, or prior-pass deliberate decisions.

**Follow-up review recommendation:** false. This pass patched 0 findings → no high-severity patch; score = 3×0 (medium) + 1×0 (low) = 0 (< 5).

**Verification performed:** `npm test` → 708 tests / 47 files passed. `npm run build` → production build succeeded (68 modules, clean). No source changed this pass, so both confirm the committed state remains green.

**Residual risks:** The one deferred latent finding (multi-hole detonation life accounting) — a note gated behind future tuning, not a live defect. The disclosed manual-verification boundary stands: the visible red pulse and audible urgency tone (Phaser render + Web Audio) are covered only by pure-helper unit tests and source-text wiring assertions, per codebase precedent.

**Residual artifacts (not part of this change, left in place):** `_bmad-output/implementation-artifacts/sprint-status.yaml` was already modified before this run (orchestrator-owned) — not committed by this pass.

