---
title: 'Title and Start Screen'
type: 'feature'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
baseline_revision: '3f0c48a304da85da5f548376f8812816f6e5cdbc'
final_revision: '2e48f7379d273a053a3e4ede053212c54174e404'
---

<intent-contract>

## Intent

**Problem:** The game boots straight into a live run (Boot → Preload → Arena). There is no front door — no title, no place to see the persisted high score, and no explicit "press start" gate — so the game does not read as a finished product (FR14).

**Approach:** Insert a `TitleScene` between Preload and Arena that shows the neon "ANGLE WARS" title, the current persisted high score, a start prompt, and the basic controls. Any start input (Enter / Space / click / gamepad button) starts a fresh `ArenaScene` run. Keep the high-score read and the title's text content in a Phaser-free, unit-tested seam, matching the codebase's system/seam split.

## Boundaries & Constraints

**Always:**
- Read the high score through the existing guarded port `createHighScoreStorage().load()` — never touch `localStorage` directly in the scene.
- Route the scene chain through the title: `Boot → Preload → Title → Arena`. Starting from the title is one user gesture, so audio unlock keeps working unchanged.
- Centralize all new tunables (colors, fonts) in `src/config/constants.js`; no inline magic values in the scene.
- Reuse the neon aesthetic seam (`applyAdditiveBlend` / `addNeonBloom` from `neonStyle.js`) so the title glows consistently with the rest of the game.

**Block If:**
- (none anticipated — this is additive shell wiring with no ambiguous decision requiring a human)

**Never:**
- Do not rewire the in-arena game-over / restart flow — `ArenaScene`'s `scene.restart()` stays exactly as is. The full title ⇄ play ⇄ game-over state machine is Story 5.3's job, not this one.
- Do not add pause, a settings screen, or gamepad deadzone tuning (Stories 5.2 / 5.3 / 5.4).
- Do not persist or mutate any state from the title screen (it only reads the high score).

## I/O & Edge-Case Matrix

Applies to `formatHighScore(highScore)` in the pure `titleScreen.js` seam.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stored high score | `12345` | `'HIGH SCORE 12345'` | No error expected |
| No stored score | `0` | `'HIGH SCORE 0'` | No error expected |
| Defensive coercion | `-5`, `NaN`, `3.9`, `undefined` | `'HIGH SCORE 0'`, `'HIGH SCORE 0'`, `'HIGH SCORE 3'`, `'HIGH SCORE 0'` | Coerced to a non-negative integer (`Math.max(0, Math.floor(Number(n) || 0))`) |

</intent-contract>

## Code Map

- `src/scenes/PreloadScene.js` -- currently `scene.start('ArenaScene')`; re-point to `'TitleScene'`.
- `src/main.js` -- Phaser game config; register `TitleScene` in the `scene` array between Preload and Arena.
- `src/persistence/highScoreStorage.js` -- `createHighScoreStorage().load()` returns the persisted high score (guarded, never throws); the title reads through this.
- `src/scenes/neonStyle.js` -- `applyAdditiveBlend(layers, Phaser.BlendModes.ADD)` and `addNeonBloom(camera)`; reuse for the title's neon glow.
- `src/config/constants.js` -- add title-screen colors/fonts (near the HUD / game-over block).
- `src/scenes/ArenaScene.js` -- reference only for the neon-wiring and input-handler patterns to mirror.

## Tasks & Acceptance

**Execution:**
- `src/scenes/titleScreen.js` -- NEW pure Phaser-free seam: export `TITLE_TEXT` (`'ANGLE WARS'`), `START_PROMPT`, `CONTROLS_LINES` (array describing move / aim-fire / bomb / mute-volume using the controls that actually exist), and `formatHighScore(highScore)` implementing the I/O matrix. No Phaser import.
- `src/scenes/titleScreen.test.js` -- NEW vitest unit tests covering every I/O-matrix row of `formatHighScore` and asserting the exported content constants are non-empty.
- `src/config/constants.js` -- ADD title-screen constants (`COLOR_TITLE_TEXT` numeric + string as needed, `TITLE_FONT`, `COLOR_TITLE_HISCORE`/`TITLE_HISCORE_FONT`, `COLOR_TITLE_PROMPT`/`TITLE_PROMPT_FONT`, `COLOR_TITLE_CONTROLS`/`TITLE_CONTROLS_FONT`) with brief comments, mirroring the existing HUD/game-over constant style.
- `src/scenes/TitleScene.js` -- NEW `Phaser.Scene` (`'TitleScene'`): in `create()`, draw the centered neon title, the high-score line (from `formatHighScore(createHighScoreStorage().load())`), the start prompt, and the controls lines; put the title text into additive blend and register `addNeonBloom(this.cameras.main)` for the neon look; bind Enter / Space / `pointerdown` (and, guarded, `this.input.gamepad?.on('down', …)`) to `this.scene.start('ArenaScene')`.
- `src/scenes/PreloadScene.js` -- EDIT `create()` to `this.scene.start('TitleScene')`.
- `src/main.js` -- EDIT the `scene` array to `[BootScene, PreloadScene, TitleScene, ArenaScene]` and import `TitleScene`.

**Acceptance Criteria:**
- Given a fresh page load, when the scene chain runs, then `PreloadScene` starts `TitleScene` (not `ArenaScene`), and the title screen shows the neon "ANGLE WARS" title, the current high score, a start prompt, and the basic controls.
- Given the title screen is displayed, when the player presses Enter, Space, clicks, or presses a gamepad button, then a fresh `ArenaScene` run begins (its `create()` rebuilds all run state from zero).
- Given a high score is persisted in the guarded store, when the title screen appears, then the displayed high-score line equals `formatHighScore(load())` for that value; with no stored score it reads `HIGH SCORE 0`.
- Given the pure `titleScreen.js` seam, when `formatHighScore` runs under vitest, then it returns the exact strings in the I/O matrix for every listed input.

## Design Notes

Why a separate scene rather than an overlay in `ArenaScene`: the codebase already uses discrete Phaser scenes (`Boot`/`Preload`/`Arena`) and Story 5.3 will add a governing state machine over these same scenes — a `TitleScene` is the seam 5.3 builds on, so an overlay now would be thrown away.

Title glow: mirror `ArenaScene`'s neon wiring — `addNeonBloom(this.cameras.main)` gives every bright element an on-theme halo; additionally put the hero title text into `applyAdditiveBlend([...], Phaser.BlendModes.ADD)` so it reads as a bright neon sign (a deliberate choice for the title, distinct from the HUD text which stays normal-blend). Both are configured once in `create()`.

`CONTROLS_LINES` example (describe only what exists today):
```
Move:  WASD / Arrows / Left Stick
Aim & Fire:  Mouse / Right Stick
Smart Bomb:  (as bound)   Mute: M   Volume: - / +
```

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `titleScreen.test.js`.
- `npm run build` -- expected: production build succeeds (the new scene and imports compile).

**Manual checks:**
- `npm run dev`, open the game: the title screen appears first with the neon "ANGLE WARS" title, a `HIGH SCORE <n>` line, a start prompt, and the controls lines. Pressing Enter (or clicking) starts the arena on a fresh run. Play a run, beat the stored high score, reload — the title now shows the higher value.

## Spec Change Log

_No bad_spec loopbacks — spec unchanged through review._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[low]` `[patch]` `formatHighScore` leaked `HIGH SCORE Infinity` for a non-finite input, contradicting its own JSDoc — added a `Number.isFinite` gate (Infinity/-Infinity → `HIGH SCORE 0`) plus two I/O-matrix test rows.
  - `[low]` `[patch]` Start listeners had no re-entry guard — added a one-shot `started` latch so two gestures in one frame / key auto-repeat cannot double-fire `scene.start('ArenaScene')`.
  - `[low]` `[patch]` `constants.js` block comment over-claimed "no inline magic values in TitleScene" while inline layout y-offsets are used (consistent with ArenaScene) — reworded to drop the absolute claim.
  - `[low]` `[patch]` Removed the dead numeric `COLOR_TITLE_TEXT` export (only the string form is referenced).

## Auto Run Result

Status: done

**Summary of implemented change:** Story 5.1 gives the game a front door. A new `TitleScene` is inserted into the scene chain (`Boot → Preload → Title → Arena`): it renders the neon "ANGLE WARS" hero title (additive blend + camera bloom, reusing `neonStyle.js`), the persisted high score (read only through the guarded `createHighScoreStorage().load()` port), a start prompt, and the basic controls, then starts a fresh `ArenaScene` run on any start input (Enter / Space / click / gamepad button). All text content and the high-score formatting live in a Phaser-free, unit-tested `titleScreen.js` seam; the scene stays a thin view layer. The in-arena game-over/restart flow is untouched (Story 5.3 owns the full state machine).

**Files changed:**
- `src/scenes/titleScreen.js` — NEW Phaser-free seam: `TITLE_TEXT`, `START_PROMPT`, `CONTROLS_LINES`, and `formatHighScore` (finite-gated coercion to a non-negative integer).
- `src/scenes/titleScreen.test.js` — NEW vitest suite: full `formatHighScore` I/O matrix (incl. Infinity/-Infinity) + content-constant assertions (11 tests).
- `src/scenes/TitleScene.js` — NEW `Phaser.Scene('TitleScene')`: renders the four elements, neon wiring, one-shot latched start bindings.
- `src/config/constants.js` — ADD title-screen color/font constants.
- `src/main.js` — register `TitleScene` in the scene array.
- `src/scenes/PreloadScene.js` — start `TitleScene` instead of `ArenaScene`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `5-1-title-and-start-screen: done`.

**Review findings breakdown:** 0 intent_gap, 0 bad_spec, **4 patch applied** (all low: `formatHighScore` Infinity leak vs its JSDoc; missing start-listener re-entry latch; over-claiming constants comment; dead numeric `COLOR_TITLE_TEXT`), **1 deferred** (gamepad-start promised on title but ArenaScene game-over has no gamepad restart → Story 5.3/5.4), **7 rejected** (all low: working-as-designed click-aim; unreachable unguarded bloom; store-not-read fields matching repo norm; untested scene wiring = repo-wide convention; speculative 5.3 sleep/wake cleanup; static-screen bloom/prompt-blink aesthetics; within-session high-score refresh handled by 5.3's return-to-title). Four review layers run in parallel (adversarial, edge-case, verification-gap, intent-alignment).

**Follow-up review recommendation:** `false` — 4 findings triaged `patch` this pass (score 4: high 0, medium 0, low 4; threshold is 5 or any high).

**Verification performed:** `npm test` → 551/551 pass across 36 files (incl. the new `titleScreen.test.js`). `npm run build` → succeeds (pre-existing Phaser chunk-size advisory only). Matrix audit: every `formatHighScore` I/O row is covered by a test that ran and passed.

**Residual risks:** The AC-level behaviors of the live scene (title renders, start transitions, high score displays) rest on manual verification (`npm run dev`) — Phaser scenes are untested repo-wide by design, with all testable logic extracted to the covered `titleScreen.js` seam. The gamepad-start ⇄ game-over-restart parity gap is deferred to the Story 5.3 state machine.

**Residual artifacts (not part of this change):** none — working tree clean after commit.
