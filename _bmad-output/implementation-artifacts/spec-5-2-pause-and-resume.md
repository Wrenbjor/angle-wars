---
title: 'Pause and Resume'
type: 'feature'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false # 2 patch (medium 1, low 1); score 4 < 5, no high
context: []
warnings: [oversized]
baseline_revision: 'c92ba7568d5c9485a6e8530d1f88d4877bdd3219'
final_revision: 'f0e2e2ccef42e79a7f6b5d9ee5d11d682e82eddf'
---

<intent-contract>

## Intent

**Problem:** A run cannot be paused. Once `ArenaScene` is live the simulation advances every frame with no way to stop it, so a player who must step away loses the run (FR15). There is a game-over freeze and a hit-stop freeze, but no player-invoked pause.

**Approach:** Add a player-toggled pause to `ArenaScene` that mirrors the scene's existing freeze-gate idiom (game-over / hit-stop). While paused, `update()` returns before feeding the fixed-timestep accumulator, so **no fixed step runs, no input is sampled, and no render-owned juice advances** — the whole sim (positions, spawn timers, difficulty ramp, multiplier, lives) is frozen untouched and resumes bit-identical. A dimming pause overlay ("PAUSED" + resume prompt) shows while paused. The toggle decision and overlay text live in a Phaser-free, unit-tested seam, matching the codebase's system/seam split. Do **not** build the Story 5.3 game-flow state machine.

## Boundaries & Constraints

**Always:**
- Freeze by skipping the sim, not by hiding render: while paused, `update()` must not call `this.inputSampler.sample()`, must not call `this.fixedTimestep.advance(...)`, and must not advance the render-owned juice/audio countdowns — it shows the overlay and returns. The last drawn frame stays frozen on screen.
- Route the pause toggle through the pure `togglePause(paused, gameOver)` seam; never inline the toggle+guard logic in the scene.
- Guard pausing against game-over: a pause key press while `playerState.gameOver` is a no-op (game-over already owns the freeze + restart flow, untouched by this story).
- Detect the pause key via scene keyboard events (`this.input.keyboard.on('keydown-…')`), the same boundary pattern as the existing M / restart handlers — so the key still fires while paused (the update loop keeps running; only the sim is gated).
- Centralize all new tunables (overlay color/alpha, text colors/fonts) in `src/config/constants.js`, mirroring the existing `GAMEOVER_*` block; no inline magic values in the scene.
- Pin the pause overlay + text with `setScrollFactor(0)` and create them hidden, mirroring the game-over overlay.

**Block If:**
- (none anticipated — this is an additive in-scene freeze-gate with a clear precedent; no ambiguous decision requires a human.)

**Never:**
- Do not use Phaser's `this.scene.pause()` / a separate pause `Phaser.Scene`, and do not add a settings menu, quit-to-title, or any screen transition — the governing state machine over the scenes is Story 5.3's job.
- Do not mutate any sim state (ship, pools, `PlayerState`, `ScoreState`, spawn ramp, timesteps) on pause or resume — resume must be exact.
- Do not change the game-over / restart flow, the hit-stop gate, or audio settings behavior.
- Do not add gamepad pause (gamepad input polish is Story 5.4) — keyboard toggle only.

## I/O & Edge-Case Matrix

Applies to `togglePause(paused, gameOver)` in the pure `pauseControl.js` seam.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pause a live run | `togglePause(false, false)` | `true` | No error expected |
| Resume a paused run | `togglePause(true, false)` | `false` | No error expected |
| Pause key at game over | `togglePause(false, true)` | `false` (cannot pause) | No error expected |
| Defensive: paused + game over | `togglePause(true, true)` | `false` (game over forces unpaused) | No error expected |

</intent-contract>

## Code Map

- `src/scenes/ArenaScene.js` -- `update(time, delta)` drives the sim via `this.fixedTimestep.advance(delta, dt => { if (!gameOver) world.fixedUpdate(dt) })`, with existing freeze-gates for hit-stop (top of `update`) and game-over; `create()` builds the game-over overlay (lines ~633–676) and binds ENTER/SPACE/M via `this.input.keyboard.on(...)`. Pause wiring mirrors both.
- `src/config/constants.js` -- `GAMEOVER_OVERLAY`/`GAMEOVER_*_FONT` block (~lines 691–698) is the style template for the new `PAUSE_*` constants.
- `src/scenes/titleScreen.js` + `titleScreen.test.js` -- the established Phaser-free content-seam + vitest pattern to mirror for `pauseControl.js`.
- `src/core/FixedTimestep.js` -- `advance()` banks only the delta it is given; skipping the call while paused means no wall-clock time accrues (its `< stepMs` remainder is preserved, not pause time), guaranteeing an exact resume.

## Tasks & Acceptance

**Execution:**
- `src/scenes/pauseControl.js` -- NEW pure Phaser-free seam: export `PAUSE_TITLE` (`'PAUSED'`), `PAUSE_PROMPT` (non-empty, naming the resume keys), and `togglePause(paused, gameOver)` implementing the I/O matrix (`gameOver ? false : !paused`). No Phaser import.
- `src/scenes/pauseControl.test.js` -- NEW vitest unit tests covering every I/O-matrix row of `togglePause` and asserting `PAUSE_TITLE` / `PAUSE_PROMPT` are non-empty strings.
- `src/config/constants.js` -- ADD a `PAUSE_*` block mirroring the game-over block: `COLOR_PAUSE_OVERLAY`, `PAUSE_OVERLAY_ALPHA`, `COLOR_PAUSE_TEXT`, `PAUSE_TITLE_FONT`, `PAUSE_PROMPT_FONT`, with brief comments.
- `src/scenes/ArenaScene.js` -- EDIT `create()`: initialize `this._paused = false`; build a hidden, `setScrollFactor(0)` pause overlay (dimming rect + centered `PAUSE_TITLE` + `PAUSE_PROMPT`) alongside the game-over overlay; bind `keydown-ESC` and `keydown-P` to a handler that sets `this._paused = togglePause(this._paused, this.playerState.gameOver)`. EDIT `update()`: at the very top, set the pause overlay/text visibility to `this._paused`, and if `this._paused` is true, `return` before `inputSampler.sample()` and all sim/juice/audio advancement.

**Acceptance Criteria:**
- Given a live run, when the player presses Esc or P, then the pause overlay appears and the simulation and spawning freeze — the ship, bullets, enemies, spawn timers, difficulty ramp, and multiplier stop advancing (observed via the debug `sim ticks` readout holding steady and no on-screen motion).
- Given a paused run, when the player presses Esc or P again, then the overlay disappears and play continues exactly where it left off — ship position, active enemies, spawn cadence, difficulty ramp, and multiplier are identical to the pre-pause frame (no jump, no lost or double-applied step, no buffered bomb firing).
- Given a game-over screen, when the player presses Esc or P, then nothing changes (no pause overlay) — the game-over/restart flow is unaffected.
- Given the pure `pauseControl.js` seam, when `togglePause` runs under vitest, then it returns the exact value in the I/O matrix for every listed input, and `PAUSE_TITLE` / `PAUSE_PROMPT` are non-empty.

## Design Notes

In-scene freeze-gate over `this.scene.pause()`: the scene already halts the sim this exact way twice (the hit-stop `if (this._hitStopMs > 0)` branch and the `if (!gameOver)` gate inside `advance`'s callback). Reusing that idiom makes pause a one-property gate with no new machinery and nothing to reconcile on resume; `scene.pause()` / a discrete pause scene belong to Story 5.3's state machine. The resume is exact because all sim mutation flows through `world.fixedUpdate(dt)` (only ever called from `fixedTimestep.advance(...)`), so skipping that call freezes every system at once, and skipping `inputSampler.sample()` means no intent is buffered mid-pause. The game loop never stops, so `delta` stays ~16 ms and nothing accrues in the accumulator.

Gate placement (top of `update`):
```
update(time, delta) {
  this.pauseOverlay.setVisible(this._paused);
  this.pauseTitle.setVisible(this._paused);
  this.pausePrompt.setVisible(this._paused);
  if (this._paused) return;        // frozen: last frame stays on screen
  this.inputSampler.sample();
  // …existing hit-stop / sim / juice / render unchanged…
}
```

Audio is intentionally left running at its last music intensity while paused (music is not simulation; no new SFX latch fires while the sim is frozen). Ducking on pause is out of scope.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `pauseControl.test.js`.
- `npm run build` -- expected: production build succeeds (the edited scene and new imports compile).

**Manual checks:**
- `npm run dev`, start a run, let enemies spawn. Press Esc (or P): the "PAUSED" overlay appears, all motion stops, the debug `sim ticks` value holds constant. Press Esc (or P) again: the overlay clears and the exact frozen scene resumes moving with no jump. Pause, wait several seconds, resume — the difficulty ramp/spawn cadence continues as if no time passed. Die, then press Esc/P at the game-over screen — nothing happens; Enter/Space still restarts.

## Spec Change Log

_No bad_spec loopbacks — spec unchanged through review._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` Held Esc/P auto-repeated the pause toggle: the keys are bound via `keyboard.on('keydown-…')` with no registered Key, so (verified in Phaser 3.90.0 `KeyboardPlugin`) OS key-repeat re-emitted `keydown` every tick, flickering `_paused`. Added an `event.repeat` guard so a held key toggles once; a tap is unchanged.
  - `[low]` `[patch]` A bomb flash / camera shake in flight when pausing froze under the top-of-`update` gate, washing the PAUSED overlay near-white (120ms `SCREEN_FLASH_MS` window) or holding a shake offset. On the transition into pause the handler now zeroes `_flashMs`/`_trauma` and recenters the camera; resume path untouched.

## Auto Run Result

Status: done

**Summary of implemented change:** Story 5.2 adds a player-invoked pause/resume to `ArenaScene`. A new Phaser-free `pauseControl.js` seam holds the overlay text (`PAUSE_TITLE`, `PAUSE_PROMPT`) and the sole decision — `togglePause(paused, gameOver) => gameOver ? false : !paused`, so pausing is a no-op at game over. `ArenaScene` wires it: `create()` builds a hidden, `setScrollFactor(0)` dimming overlay + "PAUSED" title + resume prompt, and binds Esc / P (keyboard events, so they fire while paused) to the toggle; `update()` gains a top-of-loop gate that mirrors `_paused` onto the overlay and `return`s before input sampling and all sim/juice/audio advancement while paused. Because the game loop keeps running but `fixedTimestep.advance(...)` (the only path to `world.fixedUpdate`) is never called while paused, no fixed step runs and no delta is banked — the whole sim (position, spawn timers, difficulty ramp, multiplier, lives) freezes untouched and resumes bit-identical. This mirrors the scene's existing hit-stop / game-over freeze idiom; the Story 5.3 game-flow state machine is deliberately not built.

**Files changed:**
- `src/scenes/pauseControl.js` — NEW Phaser-free seam: `PAUSE_TITLE` (`'PAUSED'`), `PAUSE_PROMPT` (`'Press Esc or P to resume'`), `togglePause(paused, gameOver)`.
- `src/scenes/pauseControl.test.js` — NEW vitest suite: all 4 `togglePause` I/O-matrix rows + non-empty content-constant assertions (6 tests).
- `src/config/constants.js` — ADD the `PAUSE_*` overlay color/alpha/font block, mirroring the game-over block.
- `src/scenes/ArenaScene.js` — wire the pause state, overlay, Esc/P toggle (with an `event.repeat` auto-repeat guard), and the top-of-`update` freeze gate; settle render-owned juice on entering pause.

**Review findings breakdown:** 0 intent_gap, 0 bad_spec, **2 patch applied** (1 medium: held-key auto-repeat flicker; 1 low: frozen flash/shake washing the pause overlay), **0 deferred**, **4 rejected** (music continuing while paused, and volume/mute keys acting while paused — the intent scopes pause to "simulation and spawning" freeze with no run-state loss, and audio is neither; pause freeze/resume being untested — the verification-gap lens returned zero gaps, matching the repo-wide convention that scenes rest on manual verification with all decision logic extracted to the tested seam; and the "no time accrues" clock-halt "assumption" — it holds by construction since `scene.pause()` is deliberately not used). Four review layers ran in parallel (adversarial, edge-case, verification-gap, intent-alignment).

**Follow-up review recommendation:** `false` — 2 findings triaged `patch` this pass (score: 3×medium 1 + 1×low 1 = 4; threshold is 5 or any high).

**Verification performed:** `npm test` → 557/557 pass across 37 files (incl. the new `pauseControl.test.js`, 6 tests) after patches. `npm run build` → succeeds (pre-existing Phaser chunk-size advisory only). Matrix audit: every `togglePause` I/O row is covered by a test that ran and passed. F1 (held-key repeat) was confirmed directly against the Phaser 3.90.0 `KeyboardPlugin` source before patching.

**Residual risks:** The AC-level behaviors of the live scene (overlay appears, sim/spawning freeze, bit-identical resume) rest on manual verification (`npm run dev`) — Phaser scenes are untested repo-wide by design, with all testable logic extracted to the covered `pauseControl.js` seam. Music intentionally continues at its last intensity while paused (out of scope per the intent's "simulation and spawning" framing).

**Residual artifacts (not part of this change):** none — working tree clean after commit.
