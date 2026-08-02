---
title: 'Mobile Title and Settings Controls'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_commit: '5ea9ee2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-3-game-flow-state-machine.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-7-2-responsive-mobile-layout-orientation-and-safe-areas.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The game-over screen is touch-friendly, but the title and settings screens still expose keyboard-oriented text prompts. On a phone, settings cannot be opened reliably and individual preferences have no discoverable touch controls.

**Approach:** Replace prompt-only title navigation with explicit Play and Settings buttons, and present settings as touch-sized volume controls, toggle switches, and a Back button. Preserve keyboard and gamepad paths as parallel inputs, then advance the synchronized release version from `2.0.1` to `2.1.0`.

## Boundaries & Constraints

**Always:** Render visible Play and Settings buttons on the title screen; only a Play-button activation starts a run while Settings opens the existing settings flow; provide volume decrement/increment controls, switches for Mute, Fullscreen, and Reduced Motion, plus Back; make every target at least 48 logical pixels high with readable normal/pressed/on/off contrast; debounce activations so one pointer gesture causes one action; keep all controls inside the arena and usable with mobile safe-area/landscape scaling; update labels immediately from authoritative state; persist through the existing guarded settings port; keep keyboard shortcuts and gamepad start working; use the existing game-flow seam for scene transitions; bump via `npm run version:bump -- minor` so package, lockfile, Android name/code remain synchronized.

**Ask First:** Adding settings beyond the existing four, changing stored defaults, adding a UI framework/DOM overlay, remapping controls, or publishing/merging the `2.1.0` release.

**Never:** Leave a full-screen pointer handler that turns a Settings tap into Play; require keyboard input on mobile; represent switches by color alone; persist partial settings objects; optimistically claim fullscreen changed before Phaser confirms the actual display state; remove desktop keyboard/gamepad behavior; commit generated web or Android build outputs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Title Play | Tap/click Play once | One guarded transition to Arena | Extra same-gesture events are ignored |
| Title Settings | Tap/click Settings | One guarded transition to Settings; never Arena | Invalid transition is a no-op |
| Volume | Tap −/+ at bounds | Step by configured amount and clamp to `[0,1]`; label and audio update | Repeated pointer events do not double-step |
| Preference switch | Tap Mute or Reduced Motion | Boolean flips, ON/OFF text and switch geometry update, full object persists | Storage/audio failures remain guarded |
| Fullscreen switch | Tap Fullscreen | Request toggle; UI updates only from enter/leave events | Denied request leaves prior state visible |
| Back | Tap Back | Return to Title once | Invalid transition is a no-op |
| Mixed input | Touch followed by keyboard/gamepad in same frame | At most one scene transition/action | Per-action latch prevents duplicates |

</frozen-after-approval>

## Code Map

- `src/scenes/TitleScene.js` -- current global pointer-to-start behavior and keyboard/gamepad navigation.
- `src/scenes/SettingsScene.js` -- existing keyboard-only preference mutations and persistence.
- `src/scenes/gameOverControls.js` -- precedent for pure rectangular control layout and hit testing.
- `src/scenes/settingsMenu.js` -- Phaser-free volume/toggle formatting seam.
- `src/scenes/mobileLayout.js` -- arena/safe-area layout conventions.
- `src/persistence/settingsStorage.js` -- guarded whole-object persistence contract.
- `src/config/constants.js` -- centralized menu dimensions, colors, fonts, and spacing.
- `src/scenes/renderIntegration.test.js` -- source-level Phaser boundary verification.

## Tasks & Acceptance

**Execution:**
- [x] `src/scenes/menuControls.js`, `src/scenes/menuControls.test.js` -- add pure control layout, finite hit testing, action validation, and switch view-model helpers covering the matrix.
- [x] `src/config/constants.js` -- define shared accessible menu-control dimensions and visual states.
- [x] `src/scenes/TitleScene.js` -- render Play/Settings buttons, remove global pointer-start ambiguity, and route button actions through the existing flow seam while preserving keys/gamepad.
- [x] `src/scenes/SettingsScene.js` -- render volume −/+, three stateful switches, and Back; reuse the existing mutation, fullscreen reconciliation, audio feedback, and persistence paths.
- [x] `src/scenes/titleScreen.js`, `src/scenes/settingsMenu.js` and tests -- update concise labels/helpers without duplicating state logic.
- [x] `src/scenes/renderIntegration.test.js` -- pin interactive control creation, action routing, cleanup, and absence of title-wide pointer start.
- [x] Release metadata -- run the supported minor bump and assert exact `2.1.0` synchronization.

**Acceptance Criteria:**
- Given a phone-sized landscape canvas, when Title or Settings renders, then every available action is represented by a readable touch target fully inside the arena.
- Given the Title screen, when Settings is tapped, then Settings opens exactly once and no Arena transition occurs.
- Given any settings control, when it is tapped, then the same existing setting mutation, immediate feedback, whole-object persistence, and label refresh occur as with its keyboard shortcut.
- Given desktop or gamepad input, when existing shortcuts are used, then behavior remains available and the visible controls remain synchronized.
- Given release verification, when tests/build/version checks run, then all pass with package and Android metadata at `2.1.0`.

## Spec Change Log

## Design Notes

Use one pure rectangular-control seam for deterministic layout and hit testing, while Phaser scenes remain thin render/input adapters. Switches must combine track/thumb position with explicit `ON`/`OFF` text. Title pointer input must dispatch by hit target instead of treating the entire canvas as Start.

## Verification

**Commands:**
- `npm test` -- all pure control, settings, scene-boundary, and regression tests pass.
- `npm run version:check` -- synchronized metadata reports `2.1.0`.
- `npm run build` -- production bundle succeeds.
- `./node_modules/.bin/cap sync android && (cd android && ./gradlew assembleDebug)` -- mobile shell and debug APK build successfully.

**Manual checks:**
- On a phone, tap every title/settings control near its center and edges; confirm one action, clear pressed/on/off feedback, and no overlap or accidental Play transition.

## Suggested Review Order

**Shared control model**

- Start with the deterministic layouts, validated actions, switch state, and activation latch.
  [`menuControls.js:7`](../../src/scenes/menuControls.js#L7)

**Title navigation**

- Explicit Play and Settings targets replace ambiguous canvas-wide activation while preserving shortcuts.
  [`TitleScene.js:110`](../../src/scenes/TitleScene.js#L110)

**Settings interaction**

- Keyboard and touch share authoritative mutation functions with same-frame duplicate suppression.
  [`SettingsScene.js:156`](../../src/scenes/SettingsScene.js#L156)

- Stateful touch controls activate on owned pointer release and cancel when dragged away.
  [`SettingsScene.js:272`](../../src/scenes/SettingsScene.js#L272)

- Switches communicate state through both explicit text and thumb position.
  [`SettingsScene.js:316`](../../src/scenes/SettingsScene.js#L316)

**Supporting verification and metadata**

- Pure tests cover target geometry, boundary hits, switch semantics, and activation deduplication.
  [`menuControls.test.js:1`](../../src/scenes/menuControls.test.js#L1)

- Integration tests pin Phaser bindings and prevent regression to global title activation.
  [`renderIntegration.test.js:1`](../../src/scenes/renderIntegration.test.js#L1)

- Package metadata is the synchronized SemVer authority for the `2.1.0` build.
  [`package.json:1`](../../package.json#L1)
