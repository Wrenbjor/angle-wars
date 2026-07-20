---
status: done
---

# BMad Dev Auto Result

Status: done
Blocking condition: none

## Bundle

- bundle_name: in-run-audio-key-repeat-guard
- dw_ids: DW-32

## Change

Added the missing `event.repeat` held-key guard to ArenaScene's three in-run
audio handlers (`keydown-M`, `keydown-MINUS`, `keydown-PLUS`) in
`src/scenes/ArenaScene.js` (handlers at lines 222-233 after the edit). Each
handler now takes the `(event)` param and short-circuits on
`if (event && event.repeat) return;`, mirroring `SettingsScene.js:145-159` and
the ArenaScene pause handler (`togglePauseInput`). Holding a key during a run no
longer steps on every OS auto-repeat tick, so the control behaves identically
in-run and on the settings screen. A single tap still steps exactly once
(`repeat === false`).

## Testing decision

No new test added. The `event.repeat` guard is a Phaser-scene inline concern
that is deliberately untested throughout this codebase — the convention is to
test extracted Phaser-free seams (`pauseControl.test.js` covers `togglePause`,
`settingsMenu.test.js` covers the formatters, `audioMix` covers
`adjustVolume`/`toggleMute`), never the scene keyboard wiring or the native
`KeyboardEvent` guard. SettingsScene's identical guard and the pause guard have
no scene-level test. Adding one here would invent a test pattern that exists
nowhere in the repo. The pure audio seams this change routes through are already
fully covered.

## Verification

- `npm test` → 46 files, 668 tests passed
- `npm run build` → clean production build (67 modules transformed)

## Ledger note

The deferred-work ledger was NOT edited, per invocation instructions — the
orchestrator records DW-32 resolution.
