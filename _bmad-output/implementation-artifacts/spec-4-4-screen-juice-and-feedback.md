---
title: 'Story 4.4 — Screen Juice and Feedback'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: '8c17f2e02bb4c2be468b7f1a472b6c97a1b44ec8'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '27246016ea274a4c39f91348264242b20ed2b76c'
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Big moments (a smart-bomb detonation, the player's death) and small ones (each kill, a near-miss) have no *screen-feel* payoff yet — the camera never shakes, nothing flashes, the action never hit-stops. Geometry Wars sells impact through screen juice (FR12, NFR2); today only the grid ripple (4.2) and particle burst (4.3) fire, and they read the exact events this story also needs.

**Approach:** Add a Phaser-free `ScreenFeedbackSystem` (registered LAST in the world pipeline, after `ParticleSystem`) that observes the SAME event sources the grid reads — `collisionSystem.bulletKillCount` (kills), `bombSystem.shockwaveMs` rising edge (bomb), `playerDeathSystem.deathSeq` increment (death) — plus a new read-only near-miss scan of the ship against the enemy pools, and turns them into three magnitude latches it exposes via `consume*()` reads: pending **shake trauma** (proportional per event), a **flash request**, and a **hit-stop request**. A tiny pure `screenShake.js` seam holds the trauma→camera-offset, flash-alpha, and trauma-decay math. `ArenaScene` owns the three real-time countdowns (so they play out and settle even while the sim is frozen on game-over), applies the shake to `cameras.main`, draws a screen-covering flash overlay, and gates `world.fixedUpdate` off for the hit-stop freeze. All magnitudes are centralized `SCREEN_*` constants.

## Boundaries & Constraints

**Always:**
- **Runs LAST, read-only:** `ScreenFeedbackSystem` registers after `GridFieldSystem`/`ParticleSystem`, so every input it reads is final within the tick. It mutates only its own latch fields — no pool, entity, score, life, or death state changes (a pure observer, exactly like `GridFieldSystem`/`ParticleSystem`).
- **Big events (bomb + death) = shake + flash + hit-stop.** On the `bombSystem.shockwaveMs` rising edge add `SCREEN_SHAKE_TRAUMA_BOMB` to pending trauma and raise the flash + hit-stop requests; on each `playerDeathSystem.deathSeq` increment add `SCREEN_SHAKE_TRAUMA_DEATH` and raise the flash + hit-stop requests. Death shakes harder than a bomb (magnitude is proportional to event severity). Edge-detection prevs are seeded from the current source values at construction so no cue fires spuriously on the first tick (mirrors `GridFieldSystem`).
- **Small events (kills + near-misses) = subtle nudge only.** Add `SCREEN_SHAKE_TRAUMA_KILL` per bullet kill (`× bulletKillCount` this tick) and `SCREEN_SHAKE_TRAUMA_NEARMISS` per registered near-miss to pending trauma — and NOTHING else (no flash, no hit-stop): these must reinforce without obscuring play.
- **Near-miss = throttled proximity:** each fixed step, decrement `_nearMissCooldownMs` by `dt` (clamp ≥ 0); if it is 0 and any active, non-telegraphing (`telegraphMs === 0`) enemy across the pools has center distance to the ship in `(ship.radius + enemy.radius, SCREEN_NEARMISS_RADIUS]` (close but not overlapping), register ONE near-miss (add its trauma) and reset the cooldown to `SCREEN_NEARMISS_COOLDOWN_MS`. Throttling avoids per-tick spam and needs no per-enemy identity tracking (recycle-safe).
- **Latches consumed by the render loop:** `consumePendingTrauma()` returns the accumulated trauma add and resets it to 0; `consumeFlashRequest()`/`consumeHitStopRequest()` return `SCREEN_FLASH_MS`/`SCREEN_HITSTOP_MS` if a big event fired since the last consume (else 0) and reset. `ArenaScene` owns `_trauma`/`_flashMs`/`_hitStopMs` as real-time countdowns advanced by the render `delta`, so they complete even when the sim is frozen (game-over) — a frozen full-screen flash must never obscure the game-over screen.
- **Hit-stop freezes the sim, not its own countdown:** while `_hitStopMs > 0`, `ArenaScene` skips feeding `fixedTimestep.advance` (the whole sim freezes, composing with the existing game-over gate) and decays `_hitStopMs` by the render `delta`. The countdown lives at render level because a frozen sim cannot advance a sim-side countdown out of the freeze.
- **Shake via camera offset:** `ArenaScene` sets `cameras.main.scrollX/scrollY` from `shakeOffsetX/Y(_trauma, phase)` each frame (0 at trauma 0, bounded by `SCREEN_SHAKE_MAX_OFFSET`). The flash overlay is pinned `setScrollFactor(0)` so it always covers the view regardless of shake.
- All tunables are `SCREEN_*` in `constants.js` as documented post-launch placeholders (mirrors `GRID_*`/`PARTICLE_*`); no magic numbers inline in the system, the seam, or the `ArenaScene` call sites.

**Block If:**
- Nothing new gates this story: camera shake is a `scrollX/scrollY` write, the flash is a plain `graphics.fillRect` + alpha, and the hit-stop is one extra gate around the already-existing `fixedTimestep.advance` call. If a genuinely unresolvable platform mismatch surfaces during implementation, HALT with specifics — but none is anticipated.

**Never:**
- Do NOT change any simulation/gameplay behavior. Reading the kill/bomb/death sources, the ship, and the enemy pools is observation only — no kills, scoring, lives, respawn, movement, firing, or the game-over flow may change. Hit-stop only *pauses* the sim; it never alters what the sim computes.
- Do NOT fire flash or hit-stop on kills or near-misses (only bomb + death warrant strong feedback). Do NOT emit near-miss cues for telegraphing (spawning-in) enemies, and do NOT fire a near-miss for an enemy already overlapping the ship's collision radius.
- Do NOT implement audio (Story 4.5) or replace the existing grid ripple / particle burst / placeholder shockwave ring. Do NOT add per-object bloom or allocate on the per-tick / per-frame hot path.

## I/O & Edge-Case Matrix

Scope: pure calls over fakes (no Phaser). `ScreenFeedbackSystem` is Phaser-free; `screenShake.js` imports no Phaser. Sources are faked like `gridFieldSystem.test.js`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bomb detonation | `shockwaveMs` rises 0→N | `consumePendingTrauma()===SCREEN_SHAKE_TRAUMA_BOMB`; flash & hit-stop requests raised | none |
| Player death | `deathSeq` increments | pending trauma `===SCREEN_SHAKE_TRAUMA_DEATH`; flash & hit-stop raised | none |
| Bullet kills (subtle) | `bulletKillCount=3` | pending trauma `===3×SCREEN_SHAKE_TRAUMA_KILL`; NO flash, NO hit-stop | none |
| Near-miss in band | enemy at dist ≤ `SCREEN_NEARMISS_RADIUS`, cooldown 0 | pending trauma includes `SCREEN_SHAKE_TRAUMA_NEARMISS`; cooldown set; NO flash/hit-stop | none |
| Near-miss throttled | in-band again before cooldown elapses | no additional trauma until cooldown reaches 0 | none |
| Near-miss excluded | enemy telegraphing, or overlapping ship, or dist > radius | no near-miss registered | none |
| Seeded prevs | constructed mid-run (shockwave decaying, deathSeq>0) | first tick with no new edge → pending trauma 0, no requests | none |
| Multiple events one tick | bomb edge + 2 kills + near-miss | pending trauma sums all; flash/hit-stop raised once | none |
| Consume resets | consume, then consume again with no new event | second consume returns 0 / no request | none |
| Gameplay neutral | bomb + kill + near-miss in one tick | ship, enemies, kill count, score, lives all unchanged after `fixedUpdate` | none |
| `shakeOffsetX/Y(trauma,phase)` | trauma 0 / trauma 1 | 0 at trauma 0; `|offset| ≤ SCREEN_SHAKE_MAX_OFFSET`; scales with trauma; varies with phase | none |
| `flashAlpha(ms,dur)` | ms=dur / ms=0 / ms>dur / dur≤0 | 1 / 0 / clamp 1 / 0 (degenerate-safe), decreasing between | tolerates ms>dur |
| `decayTrauma(t,dtMs)` | t=1, dt | `t − DECAY_PER_SEC·dt/1000`, clamped ≥ 0 | clamps at 0 |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ADD a "Screen juice & feedback (Story 4.4)" section: `SCREEN_SHAKE_MAX_OFFSET`, `SCREEN_SHAKE_FREQ_X`, `SCREEN_SHAKE_FREQ_Y`, `SCREEN_SHAKE_TRAUMA_DECAY_PER_SEC`, `SCREEN_SHAKE_TRAUMA_BOMB`, `SCREEN_SHAKE_TRAUMA_DEATH`, `SCREEN_SHAKE_TRAUMA_KILL`, `SCREEN_SHAKE_TRAUMA_NEARMISS`, `SCREEN_FLASH_MS`, `COLOR_SCREEN_FLASH`, `SCREEN_HITSTOP_MS`, `SCREEN_NEARMISS_RADIUS`, `SCREEN_NEARMISS_COOLDOWN_MS`. Documented placeholders.
- `src/systems/ScreenFeedbackSystem.js` -- NEW Phaser-free `System`. Ctor `(collisionSystem, bombSystem, playerDeathSystem, ship, enemyPools)`. Seeds `_prevShockwaveMs`/`_prevDeathSeq` from current source values. `fixedUpdate(dt)`: detect bomb/death edges (raise flash+hit-stop, add big trauma), add per-kill + per-near-miss trauma, run the throttled near-miss scan (hoisted zero-alloc callback over the pools). Public: `consumePendingTrauma()`, `consumeFlashRequest()`, `consumeHitStopRequest()`.
- `src/scenes/screenShake.js` -- NEW Phaser-free render-math seam: `shakeOffsetX(trauma, phase)`, `shakeOffsetY(trauma, phase)`, `flashAlpha(flashMs, flashDurationMs)` (clamped 0..1, degenerate-safe), `decayTrauma(trauma, dtMs)`. Imports NO Phaser (mirrors `particleStyle.js`/`neonStyle.js`).
- `src/scenes/ArenaScene.js` -- construct `ScreenFeedbackSystem(...)` and `world.addSystem` it LAST (after `ParticleSystem`); add `this.flashOverlay = this.add.graphics()` (arena-covering `COLOR_SCREEN_FLASH` rect, `setScrollFactor(0)`, above the gameplay layers); add render-owned `_trauma`/`_flashMs`/`_hitStopMs`/`_shakePhase`. In `update()`: gate the `fixedTimestep.advance` call on `_hitStopMs` (freeze while > 0, decay it by `delta`); after advancing, pull the system's latches into the countdowns; decay `_trauma`/`_flashMs`; write `cameras.main.scrollX/scrollY` from `shakeOffsetX/Y`; set the flash overlay alpha from `flashAlpha`.
- `src/systems/screenFeedbackSystem.test.js` -- NEW; unit-test every I/O-matrix row for the system (edges, subtle adds, near-miss band/throttle/exclusions, seeded prevs, multi-event, consume-reset, gameplay neutrality) with fakes.
- `src/scenes/screenShake.test.js` -- NEW; unit-test `shakeOffsetX/Y` (zero/bound/scale/phase), `flashAlpha` (endpoints/monotonic/clamp/degenerate), `decayTrauma` (decay/clamp).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the `SCREEN_*` section + `COLOR_SCREEN_FLASH` -- centralized tunables, no inline magic numbers.
- `src/systems/ScreenFeedbackSystem.js` -- implement the read-only event→latch system with the throttled near-miss scan -- the Phaser-free simulation seam for screen feedback.
- `src/scenes/screenShake.js` -- implement `shakeOffsetX/Y`, `flashAlpha`, `decayTrauma` -- the Phaser-free render math used by the camera-shake + flash + decay.
- `src/scenes/ArenaScene.js` -- register the system last, add the flash overlay + render-owned countdowns, gate the sim for hit-stop, apply shake to the camera, draw the flash -- integrates the juice with zero per-frame allocation and no gameplay change.
- `src/systems/screenFeedbackSystem.test.js`, `src/scenes/screenShake.test.js` -- unit-test every I/O-matrix row.

**Acceptance Criteria:**
- Given a bomb detonates or the player dies, when the event fires, then the camera shakes proportionally (death harder than bomb) and a brief flash + hit-stop emphasize it — confirmed via `npm run dev`; automated seam: the system adds the bomb/death trauma and raises the flash + hit-stop requests exactly on the shockwave rising edge / `deathSeq` increment (`screenFeedbackSystem.test.js`).
- Given kills and near-misses, when they occur, then a subtle camera nudge reinforces them without a flash or hit-stop — confirmed via `npm run dev`; automated seam: per-kill and throttled near-miss trauma adds with no flash/hit-stop, near-miss gated on the proximity band, active state, and cooldown (`screenFeedbackSystem.test.js`).
- Given juice intensity, when configured, then every magnitude (shake offset/trauma weights/decay, flash duration/color, hit-stop duration, near-miss radius/cooldown) is a centralized `SCREEN_*` constant — verified by the constants section and the seam/system reading only those.
- Given the feedback ships, when the simulation runs, then gameplay is unchanged — the same kills, scores, lives, deaths, and game-over as before (a read-only observer; hit-stop only pauses the sim) — confirmed by the existing suites remaining green and the gameplay-neutrality test.

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 1
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` The Story 4.4 camera shake offsets `cameras.main.scrollX/scrollY`, dragging every default-`scrollFactor` layer — including the non-diegetic readouts. A death (largest trauma) coincides with the game-over screen, so the final-score readout jittered ~17px for ~0.5s, fighting the epic's "juice serves readability, never fights it" principle. Pinned `debugText`, `hudText`, `gameOverOverlay`, `gameOverTitle`, `gameOverScore`, `gameOverPrompt` with `setScrollFactor(0)` so the readouts stay screen-fixed while the gameplay world (grid, entities, particles, border) and the already-pinned flash overlay shake unchanged. Tests + build re-verified green.
- deferred (not this story's problem — real product gaps surfaced incidentally; belong with the settings epic):
  - `[defer]` No reduced-motion / flash-intensity accessibility toggle for the white flash + camera shake. Real and valuable, but no settings/persistence infrastructure exists yet (Epic 5 Story 5.3 owns settings) and it is outside this story's ACs. Recorded to `deferred-work.md`.
- rejected (not defects — inherited shipped conventions, intent-sanctioned tunables/aesthetics, or the disclosed manual-verification boundary; substantive ones recorded as residual risks):
  - **Consecutive-tick bomb re-detonation missed, and death detected via `deathSeq !==` rather than `>`** — both mirror the already-shipped, reviewed `GridFieldSystem` (Story 4.2) edge-detection *exactly* (`shockwaveMs > prev`, `deathSeq !== prev`, seeded prevs); `deathSeq` is monotonic by construction and a human cannot detonate two bombs within one 16.7ms fixed step. Diverging here would desync from the shipped grid-ripple convention. Recorded as residual risks.
  - **The ArenaScene render-loop wiring (hit-stop gate, latch→countdown, camera/flash application) has no automated test** — the disclosed manual-verification boundary (ArenaScene imports Phaser; untestable under vitest/jsdom), identical to the Story 4.1/4.2/4.3 precedent; the Phaser-free system + math seams carry the automated coverage. Recorded as a residual risk.
  - **Camera shake can reveal a ~24px near-black gutter at the arena edge at peak (bomb/death) trauma** — the revealed area is the same near-black `COLOR_BACKGROUND` the grid already sits on, beyond the inset neon border, brief and only on the biggest shakes; `SCREEN_SHAKE_MAX_OFFSET` is a documented placeholder and the fix (overscanning the Story 4.2 grid shader quad) is out of scope. Recorded as a residual risk, judged controller-in-hand.
  - **Full-screen white flash intensity / "hides play"** — flashes fire only on a bomb (screen already cleared) or a death (player dead/invulnerable), i.e. moments with no actionable enemies to obscure; the flash duration/color/alpha are documented placeholders tuned in playtest.
  - **Unthrottled per-kill trauma, the clamp-to-1 flattening severity ordering, frame-rate-sampled oscillation, an unwrapped shake phase, catch-up trauma on tab-refocus, and the single global near-miss cooldown** — all bounded and intent-consistent: kill trauma decays faster (1.8/s) than any realistic kill rate accrues so it cannot peg to max; the clamp is the spec's own bounded-trauma rule and severity ordering holds in the common (non-saturated) case; the phase is real-time (frame-rate-independent) and float64-precise for eras of play; catch-up is bounded by `MAX_SUB_STEPS=5`; the global near-miss cooldown is the spec's deliberate "subtle, no per-enemy state" design. All governed by documented `SCREEN_*` placeholders.

## Design Notes

**Why render-owned countdowns.** The grid ripple (4.2) and particles (4.3) freeze in place on game-over because the whole sim freezes (an accepted precedent). A frozen *full-screen white flash* at peak alpha, however, would blank out the game-over screen — so the flash, hit-stop, and shake are driven at the render layer from latches the sim raises: they play out over real time and settle to zero even while `world.fixedUpdate` is gated off. Hit-stop *must* live at render level regardless — a sim frozen by its own hit-stop cannot count itself back out.

**Why the same sources as the grid.** The bomb/death/kill events already have recycle-proof, edge-detected latches on `CollisionSystem`/`BombSystem`/`PlayerDeathSystem` that `GridFieldSystem` consumes; reading them at end-of-tick (registered LAST) means no one-tick lag and no new sim-side plumbing. The grid ripple and the shake are two renderings of the same events.

**Near-miss without per-enemy state.** Pooled enemies recycle, so a single global cooldown (`_nearMissCooldownMs`) throttles the cue instead of tracking each enemy's approach — bounded, zero-alloc (a hoisted `forEachActive` callback), and recycle-safe. The near-miss radius/cooldown are the fuzzy part of the intent, chosen as tunable placeholders (a defensible reading of "near-miss," judged controller-in-hand).

**Fresh per run.** A new `ScreenFeedbackSystem` (seeded prevs) and reset `_trauma`/`_flashMs`/`_hitStopMs` each `create()`/`scene.restart()` mean no residual shake/flash carries into a new run — matching `GridFieldSystem`/`ParticleSystem`. Actual on-screen shake/flash/hit-stop feel is a manual `npm run dev` check (Phaser render is untestable under vitest); the Phaser-free system + math seams carry the automated coverage (the 4.1/4.2/4.3 precedent).

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new `screenFeedbackSystem.test.js` and `screenShake.test.js`; every other existing suite unchanged and green (gameplay-neutral change).
- `npm run build` -- expected: production build succeeds (pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: detonating a bomb or dying makes the camera kick hard and a brief white flash + momentary freeze land; a death kicks harder than a bomb; each kill gives a tiny nudge and a close enemy pass gives a subtle nudge — none of which obscures play; on the final (game-over) death the flash fades and the camera settles rather than freezing white/offset over the game-over screen; the HUD, debug readout, and game-over text stay screen-fixed (do not jitter) while the world shakes; a busy arena holds the FPS readout at/near 60.

## Auto Run Result

Status: done

**Implemented change:** Story 4.4 — Screen Juice and Feedback. A new Phaser-free `ScreenFeedbackSystem` (registered LAST in the world pipeline, after `ParticleSystem`) observes the SAME event sources the grid ripple (4.2) and particle burst (4.3) read — `collisionSystem.bulletKillCount` (kills), the `bombSystem.shockwaveMs` rising edge (bomb), the `playerDeathSystem.deathSeq` increment (death) — plus a new read-only, throttled near-miss proximity scan of the ship against the enemy pools, and turns them into three render-consumable magnitude latches: pending **shake trauma** (proportional per event — death > bomb, kills/near-misses a subtle nudge), a **flash request**, and a **hit-stop request** (the latter two on big events only). A pure `screenShake.js` seam holds the trauma→camera-offset, flash-alpha, and trauma-decay math. `ArenaScene` owns the three real-time countdowns (`_trauma`/`_flashMs`/`_hitStopMs`) so they play out and settle over real time even while the sim is frozen (game-over / hit-stop) — a frozen full-screen flash never blanks the game-over screen, and a sim frozen by its own hit-stop cannot count itself back out. It applies the shake to `cameras.main.scrollX/scrollY`, draws a screen-covering flash overlay, and gates `world.fixedUpdate` off during the hit-stop freeze. The non-diegetic UI (HUD, debug, game-over overlay + text) is pinned `setScrollFactor(0)` so readouts stay legible while the world shakes. The system is a pure read-only observer — no kills, scoring, lives, movement, firing, or the game-over flow changes; hit-stop only pauses the sim.

**Files changed:**
- `src/config/constants.js` — added the documented "Screen juice & feedback (Story 4.4)" section: 13 `SCREEN_*` tunables (shake max-offset, X/Y frequencies, trauma decay, per-event trauma weights for bomb/death/kill/near-miss, flash duration, hit-stop duration, near-miss radius, near-miss cooldown) + `COLOR_SCREEN_FLASH`, as post-launch placeholders (death trauma 0.85 > bomb 0.55).
- `src/systems/ScreenFeedbackSystem.js` — NEW Phaser-free read-only observer: seeds edge-detection prevs; per tick raises bomb/death trauma + flash + hit-stop, adds per-kill and throttled near-miss trauma via a hoisted zero-alloc `forEachActive` scan; exposes `consumePendingTrauma()`/`consumeFlashRequest()`/`consumeHitStopRequest()`.
- `src/scenes/screenShake.js` — NEW Phaser-free math seam: `shakeOffsetX/Y` (trauma-squared, clamped, bounded by `SCREEN_SHAKE_MAX_OFFSET`), `flashAlpha` (clamped/degenerate-safe), `decayTrauma` (clamped ≥ 0).
- `src/scenes/ArenaScene.js` — constructs + registers `ScreenFeedbackSystem` LAST; adds a pinned full-view flash overlay; adds render-owned countdowns; gates the sim for hit-stop; pulls latches, decays countdowns by render delta, applies shake to the camera, and sets the flash alpha; pins the non-diegetic UI layers (review patch).
- `src/systems/screenFeedbackSystem.test.js`, `src/scenes/screenShake.test.js` — NEW; cover every I/O-matrix row (bomb/death edges, per-kill subtle add, near-miss band/throttle/re-fire/exclusions, seeded prevs, multi-event, consume-reset, gameplay neutrality; shake offset zero/bound/scale/phase/decorrelate, flash alpha endpoints/clamp/degenerate/monotonic, decay/clamp/monotonic).

**Review findings breakdown:** 1 patch applied (low — pinned the non-diegetic UI so the camera shake never jitters the HUD / debug / game-over readouts, honoring the epic's "juice serves readability" principle); 0 intent_gap; 0 bad_spec; 1 deferred (reduced-motion / flash-intensity accessibility toggle → settings epic); 11 rejected (inherited shipped `GridFieldSystem` edge-detection conventions, the disclosed ArenaScene manual-verification boundary, and intent-sanctioned bounded tunables/aesthetics — see the Review Triage Log).

**Follow-up review recommendation:** false. Patched this pass: 0 high, 0 medium, 1 low → score `3×0 + 1×1 = 1` (< 5), no high severity.

**Verification performed:** `npm test` — 32 files, 476 tests all pass (including the new `screenFeedbackSystem.test.js` (17) and `screenShake.test.js` (13); every other existing suite unchanged and green, confirming gameplay is unchanged). `npm run build` — production build succeeds (pre-existing Phaser chunk-size advisory only). Matrix Test Audit: every I/O row is covered by a test that ran and passed. The `SCREEN_*` constants, the `CollisionSystem.bulletKillCount` / `BombSystem.shockwaveMs` / `PlayerDeathSystem.deathSeq` contracts, the ship/`enemyPools` shapes, and the last-in-pipeline registration were confirmed against live code; the edge-detection mirrors the shipped Story 4.2 `GridFieldSystem` exactly; no Block-If triggered.

**Residual risks (unverifiable in this environment; on the manual `npm run dev` checklist):**
- The Phaser render path (camera shake via `scrollX/scrollY`, the flash overlay, the hit-stop sim-freeze gate) cannot execute under vitest/jsdom, so actual on-screen shake/flash/freeze feel — and the ArenaScene latch→countdown wiring — is confirmed only by the in-browser manual pass (the disclosed 4.1/4.2/4.3 boundary; the Phaser-free system + math seams carry the automated coverage).
- At peak (bomb/death) trauma the camera shake can briefly reveal a ~24px near-black gutter at the arena edge (same `COLOR_BACKGROUND` as the grid backdrop, beyond the inset neon border); `SCREEN_SHAKE_MAX_OFFSET` is a documented placeholder to tune controller-in-hand.
- Consecutive-tick double-bomb detonation and the `deathSeq !==` death check mirror the shipped `GridFieldSystem` convention exactly; both are effectively unreachable (a human cannot detonate two bombs within one 16.7ms fixed step; `deathSeq` is monotonic by construction).
- All `SCREEN_*` values (shake magnitude/decay, flash duration/color/alpha, hit-stop duration, near-miss radius/cooldown, per-event trauma weights) are documented post-launch placeholders best judged controller-in-hand.
- No reduced-motion / flash-intensity accessibility setting exists yet (deferred to the Epic 5 settings work); the acute rapid-flash trigger is largely unreachable in practice (bomb/death flashes are seconds apart).
