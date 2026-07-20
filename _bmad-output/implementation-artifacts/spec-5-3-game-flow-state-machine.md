---
title: 'Game Flow State Machine and Settings'
type: 'feature'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false # follow-up pass 2: 0 patch; score 0 < 5
context: []
warnings: [multiple-goals, oversized]
baseline_revision: 'dacb088438176188d902c07509bb85f2fd42ca6d'
final_revision: 'db5a19afbbcfc40509879e6c6fbe6cca44dbf9b3'
---

<intent-contract>

## Intent

**Problem:** The scene chain has a dead end and no settings surface. Game over (`ArenaScene`) offers only a direct `scene.restart()` — there is no way back to the title (Epic 5 / FR14 requires "no dead ends, every terminal state offers restart AND return to title"). There is no settings screen: volume/mute live only as in-run `M`/`-`/`+` keys, and fullscreen cannot be toggled or persisted at all. The transitions between screens are ad-hoc `scene.start`/`scene.restart` calls with no governing model.

**Approach:** Introduce a Phaser-free, unit-tested **game-flow state machine seam** (`gameFlow.js`) that defines the legal transition graph — `title → play → (death/respawn) → game over → restart | title`, plus `title ↔ settings` — and proves it has no dead ends. The Title, Arena, and a new **SettingsScene** consult it to guard and route every screen transition (they stay thin Phaser adapters). Add a **return-to-title** action at game over (dedicated `T` key, leaving Story 5.2's Esc/P pause behavior untouched). Add a **SettingsScene** (reached with `S` from the title) exposing volume, mute, and fullscreen, each applying immediately and persisting. Consolidate audio persistence into one guarded `settingsStorage.js` `{ muted, volume, fullscreen }` port — the consolidation both `audioSettingsStorage.js` and `constants.js` explicitly designate this story to own — reusing the existing localStorage key value so no stored data is lost.

## Boundaries & Constraints

**Always:**
- Route every cross-screen transition through `gameFlow.nextFlowState(currentState, event)`; a `null` result is an illegal transition and MUST be a guarded no-op. `sceneForState` maps a state to its Phaser scene key. All decision logic lives in the Phaser-free seam; the scenes only call `scene.start(...)` / `scene.restart()` on its result.
- The state machine has **no dead ends**: from every state both `TITLE` and `PLAY` are reachable, and the `GAME_OVER` (terminal) state offers BOTH `RESTART` (→ play) and `RETURN_TO_TITLE` (→ title). This is an asserted, unit-tested property of the transition table.
- Settings changes apply immediately AND persist to `localStorage` on the same keypress: volume/mute → re-apply the effective master gain to the SettingsScene's live `AudioEngine` and play a short confirmation blip (audible immediacy); fullscreen → `this.scale.toggleFullscreen()` (visible immediacy). Every change writes the whole `{ muted, volume, fullscreen }` object through `settingsStorage.save`.
- Consolidate through ONE guarded port `settingsStorage.js` mirroring `highScoreStorage`/`audioSettingsStorage` (try/catch everything, never throw, defaults on missing/corrupt/blocked store, injectable Storage). Reuse the existing key VALUE (`'angleWars.audioSettings'`) under the renamed constant `SETTINGS_STORAGE_KEY` so old `{muted,volume}` payloads still load (fullscreen defaults `false`).
- `ArenaScene` keeps its existing in-run `M`/`-`/`+` audio behavior byte-identical; it only swaps to `createSettingsStorage()`, carries `this._fullscreen` as a read-only passthrough, and includes it when saving so a save never clobbers the fullscreen field.
- Centralize all new tunables (settings-screen colors/fonts, `SETTINGS_FULLSCREEN_DEFAULT`) in `src/config/constants.js`, mirroring the `TITLE_*` / `PAUSE_*` blocks; no inline magic values in scenes.
- Bind settings/nav keys via scene keyboard events (the established boundary pattern), with an `event.repeat` guard on the volume/mute keys (the Story 5.2 held-key lesson) so a held key steps once per press.
- Register `SettingsScene` in the `main.js` scene list; reached from the title with `S`, exited back to title with `Esc` or `Enter`.

**Block If:**
- (none anticipated — additive scenes + a pure seam over an established scene/seam/port architecture with two explicit precedents; no ambiguous decision requires a human.)

**Never:**
- Do NOT change Story 5.2 pause behavior: `Esc`/`P` at game over still do nothing (return-to-title is a distinct `T` key). Do NOT reach SettingsScene from pause, and do NOT add pause→settings/quit — the pause overlay stays resume-only.
- Do NOT add gamepad navigation to the settings screen or input remapping (Story 5.4 owns gamepad polish / input config). Settings navigation is keyboard-only this story; the title's existing gamepad-start is unchanged.
- Do NOT auto-enter fullscreen at page load — browsers require a user gesture, so a persisted `fullscreen:true` cannot be restored without one; persist the preference and apply it on toggle only.
- Do NOT do any performance/build work (Story 5.5), and do NOT alter gameplay systems, pools, scoring, or the high-score persistence.
- Do NOT leave `GAME_OVER` reachable only via `scene.restart()` — the dead end is the defect being fixed.

## I/O & Edge-Case Matrix

`nextFlowState(state, event)` in the pure `gameFlow.js` seam (states: `TITLE`, `PLAY`, `GAME_OVER`, `SETTINGS`):

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|-----------------|----------------|
| Start a run | `(TITLE, START)` | `PLAY` | — |
| Open settings | `(TITLE, OPEN_SETTINGS)` | `SETTINGS` | — |
| Close settings | `(SETTINGS, CLOSE_SETTINGS)` | `TITLE` | — |
| Player runs out of lives | `(PLAY, PLAYER_DIED)` | `GAME_OVER` | — |
| Restart from game over | `(GAME_OVER, RESTART)` | `PLAY` | — |
| Return to title from game over | `(GAME_OVER, RETURN_TO_TITLE)` | `TITLE` | — |
| Illegal transition | e.g. `(PLAY, OPEN_SETTINGS)`, `(TITLE, RESTART)` | `null` (no-op) | Guarded no-op |
| Unknown state/event | `(undefined, 'foo')` | `null` | Guarded no-op |

`settingsMenu.js` format helpers: `formatVolume(0.6) → 'VOLUME  60%'`; `formatVolume(NaN) → 'VOLUME  0%'`; `formatToggle('MUTE', true) → 'MUTE  ON'`, `formatToggle('FULLSCREEN', false) → 'FULLSCREEN  OFF'`.

`settingsStorage.load()`: missing/blocked/corrupt store → `{ muted: false, volume: 0.6, fullscreen: false }`; legacy `{muted,volume}` payload → fullscreen defaults `false`; non-boolean `fullscreen` → default; volume clamped to `[0,1]`.

</intent-contract>

## Code Map

- `src/main.js` -- scene registry array `[BootScene, PreloadScene, TitleScene, ArenaScene]`; add `SettingsScene`.
- `src/scenes/TitleScene.js` -- `create()` binds Enter/Space/pointer/gamepad → `scene.start('ArenaScene')`; add `S` → settings via the flow seam, and a settings prompt line.
- `src/scenes/ArenaScene.js` -- game-over overlay + restart handler (lines ~639–697, `restart` = Enter/Space/pointer → `scene.restart()` guarded on `playerState.gameOver`); audio settings wiring (lines ~466–513, `createAudioSettingsStorage`, `applyAudioSettings`, `M`/`MINUS`/`PLUS`). Add `T` return-to-title; swap to `createSettingsStorage()`; carry `_fullscreen`.
- `src/scenes/titleScreen.js` (+`.test.js`) -- Phaser-free title content seam (`START_PROMPT`, `CONTROLS_LINES`); add `SETTINGS_PROMPT` and pause/settings control lines.
- `src/persistence/audioSettingsStorage.js` (+`.test.js`) -- guarded `{muted,volume}` port to be ABSORBED/replaced by the consolidated port.
- `src/audio/audioMix.js` -- `effectiveVolume`, `adjustVolume`, `clampVolume` (reused by SettingsScene).
- `src/audio/audioEngine.js` -- guarded synth; constructs silent (master + music at gain 0), no-op without a context; reused by SettingsScene for the volume blip, disposed on `shutdown`.
- `src/config/constants.js` -- `AUDIO_SETTINGS_STORAGE_KEY`/`AUDIO_*_DEFAULT` (lines ~620–633), `TITLE_*`/`PAUSE_*` style blocks (~700–730) are the templates for the new settings block + key rename.

## Tasks & Acceptance

**Execution:**
- `src/scenes/gameFlow.js` -- NEW pure Phaser-free seam. Export `FLOW_STATES` (`TITLE`,`PLAY`,`GAME_OVER`,`SETTINGS`), `FLOW_EVENTS` (`START`,`OPEN_SETTINGS`,`CLOSE_SETTINGS`,`PLAYER_DIED`,`RESTART`,`RETURN_TO_TITLE`), `nextFlowState(state, event)` (transition table per the I/O matrix; `null` for any unlisted pair), and `sceneForState(state)` (`TITLE`→`'TitleScene'`, `PLAY`/`GAME_OVER`→`'ArenaScene'`, `SETTINGS`→`'SettingsScene'`). No Phaser import.
- `src/scenes/gameFlow.test.js` -- NEW vitest tests: every I/O-matrix row; illegal/unknown pairs → `null`; and the **no-dead-ends property** — from every state a BFS over the table reaches both `TITLE` and `PLAY`, every state has ≥1 outgoing edge, and `GAME_OVER` has both `RESTART` and `RETURN_TO_TITLE`.
- `src/scenes/settingsMenu.js` -- NEW pure seam: content constants (`SETTINGS_TITLE`='SETTINGS', `SETTINGS_HINT` naming the keys) and `formatVolume(volume)` (→ `'VOLUME  NN%'`, coercing NaN/negative/out-of-range to a clean 0–100%) + `formatToggle(label, on)` (→ `'<label>  ON'|'OFF'`). No Phaser import.
- `src/scenes/settingsMenu.test.js` -- NEW vitest tests covering `formatVolume`/`formatToggle` happy + edge inputs and asserting the content constants are non-empty strings.
- `src/persistence/settingsStorage.js` -- NEW guarded port `createSettingsStorage(storage?)` for `{ muted, volume, fullscreen }`, structurally identical to `audioSettingsStorage.js` (guarded `defaultLocalStorage()`, per-method try/catch, never throws). `load()` defaults each field (`AUDIO_MUTED_DEFAULT`, `AUDIO_MASTER_VOLUME_DEFAULT` clamped, `SETTINGS_FULLSCREEN_DEFAULT`) and accepts a legacy `{muted,volume}` payload; `save()` writes the whole object. Uses `SETTINGS_STORAGE_KEY`.
- `src/persistence/settingsStorage.test.js` -- NEW vitest tests: defaults on null/blocked/corrupt store; round-trip of all three fields; legacy `{muted,volume}` load (fullscreen defaults); volume clamp; non-boolean `fullscreen`/`muted` coercion; `save` swallows a throwing store.
- `src/persistence/audioSettingsStorage.js` + `audioSettingsStorage.test.js` -- DELETE (absorbed by `settingsStorage`).
- `src/scenes/SettingsScene.js` -- NEW Phaser scene. `create()`: load settings via `createSettingsStorage()`; build a neon `SETTINGS_TITLE` (additive blend + `addNeonBloom`, mirroring TitleScene) plus lines for volume/mute/fullscreen (from `settingsMenu` formatters) and the hint; construct a reused `AudioEngine(this.sound?.context)` and `setMasterGain(effectiveVolume(volume,muted))`, disposing it on `shutdown`. Bind (with `event.repeat` guard where noted): `MINUS`/`PLUS` → `adjustVolume`; `M` → toggle muted; each re-applies the effective gain, plays a short blip (`playSfx('fire')`), refreshes the line text, and persists. `F` → `this.scale.toggleFullscreen()`, refresh + persist. `ESC`/`ENTER` → `sceneForState(nextFlowState(SETTINGS, CLOSE_SETTINGS))` → `scene.start('TitleScene')`.
- `src/scenes/TitleScene.js` -- EDIT `create()`: bind `keydown-S` → `scene.start(sceneForState(nextFlowState(TITLE, OPEN_SETTINGS)))`; route the existing start gesture through `nextFlowState(TITLE, START)`→`sceneForState` (still `'ArenaScene'`); add the `SETTINGS_PROMPT` text object (neon-consistent).
- `src/scenes/ArenaScene.js` -- EDIT: (1) import `createSettingsStorage` (not audio port); load `{muted,volume,fullscreen}`, set `this._fullscreen = ...`, and include `fullscreen: this._fullscreen` in the `applyAudioSettings` save; (2) bind `keydown-T` → if `nextFlowState(FLOW_STATES.GAME_OVER, RETURN_TO_TITLE)` is non-null AND `this.playerState.gameOver`, `scene.start('TitleScene')` (guarded so it only fires at game over); (3) update `gameOverPrompt` text to advertise both restart (Enter/Space/click) and title (`T`).
- `src/scenes/titleScreen.js` (+`titleScreen.test.js`) -- ADD `SETTINGS_PROMPT` (non-empty, naming `S`) and extend `CONTROLS_LINES` to mention Pause (Esc/P) and Settings (S); update the test to assert the new constant is a non-empty string.
- `src/config/constants.js` -- RENAME `AUDIO_SETTINGS_STORAGE_KEY` → `SETTINGS_STORAGE_KEY` (SAME value `'angleWars.audioSettings'`, updated comment); ADD `SETTINGS_FULLSCREEN_DEFAULT = false` and a `SETTINGS_*` style block (title/item/hint colors + fonts) mirroring the `TITLE_*` block.
- `src/main.js` -- EDIT: import and append `SettingsScene` to the scene array.

**Acceptance Criteria:**
- Given the title screen, when the player presses `S`, then the SettingsScene appears; and when they press `Esc` or `Enter` there, then they return to the title — no screen is a dead end.
- Given the settings screen, when the player presses `-`/`+` or `M`, then the on-screen volume/mute line updates immediately, a confirmation blip plays at the new effective gain, and the change persists to `localStorage`; when they press `F`, then the window toggles fullscreen immediately and the preference persists.
- Given a fresh page load after changing settings, when the game reads persisted settings, then the stored volume/mute are re-applied at run start (and legacy `{muted,volume}` data still loads, with fullscreen defaulting off).
- Given a game-over screen, when the player presses `T`, then they return to the title; when they press Enter/Space/click, then a fresh run starts; and when they press `Esc`/`P`, then nothing happens (Story 5.2 pause behavior preserved).
- Given the pure `gameFlow.js` seam under vitest, when `nextFlowState` runs, then it returns exactly the I/O-matrix value for every listed pair and `null` for illegal/unknown pairs, and the no-dead-ends property holds (TITLE and PLAY reachable from every state; GAME_OVER offers restart and return-to-title).

## Design Notes

The state machine is expressed as a **pure transition table**, not a stateful object shared across Phaser scenes (scenes are independent; each already knows its own state — Title is `TITLE`, Settings is `SETTINGS`, Arena is `PLAY`/`GAME_OVER`). Each scene passes its own state to `nextFlowState` and acts on the result. This keeps the flow model fully unit-testable (including the no-dead-ends property that directly encodes FR14) while the scenes remain thin adapters — the same seam/adapter split used everywhere else in this codebase.

`GAME_OVER` stays an in-`ArenaScene` overlay sub-state (not a separate scene), so the frozen final-frame + final-score backdrop is preserved; `sceneForState(GAME_OVER)` therefore returns `'ArenaScene'`. `PLAY→GAME_OVER` is driven by the sim (`PlayerDeathSystem` latching `gameOver`), so it needs no runtime seam call — it exists in the table only for the completeness/no-dead-ends proof.

Volume "applies immediately" is made literal by giving SettingsScene its own guarded `AudioEngine` (title/settings screens otherwise have no live audio). The engine constructs silent — master gain 0, music voices at gain 0, and `setMusicLayerGains` is never called — so ONLY the explicit per-change blip sounds; a muted or zero-volume state yields an inaudible blip (correct feedback), and a missing/blocked audio context degrades the whole engine to a no-op. Disposed on `shutdown` (mirrors ArenaScene) so no oscillators leak.

Consolidation reuses the key VALUE, so it is a rename + superset, not a data migration: a previously stored `{"muted":...,"volume":...}` still parses and just gains a defaulted `fullscreen`. Every writer saves the WHOLE object it holds (ArenaScene carries `_fullscreen` untouched; SettingsScene owns all three), so no write clobbers another field.

Fullscreen: `this.scale.toggleFullscreen()` works with the existing `Phaser.Scale.FIT` config. The preference persists, but browsers forbid entering fullscreen without a user gesture, so it is NOT auto-restored at boot (applied on the toggle keypress only) — a deliberate, documented limitation, not a gap.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new `gameFlow.test.js`, `settingsMenu.test.js`, `settingsStorage.test.js` (and `audioSettingsStorage.test.js` removed); no orphaned import of the deleted port.
- `npm run build` -- expected: production build succeeds (new scene + imports compile; `SettingsScene` registered).

**Manual checks:**
- `npm run dev`. Title → press `S` → SettingsScene: press `-`/`+` (volume line moves, blip audible), `M` (mute toggles, blip silenced), `F` (window enters/exits fullscreen). Press `Esc` → back to title. Reload the page → start a run → confirm the volume/mute you set are in effect (HUD audio behaves as set). Play, die → at game over press `T` → title (high score updated); start again, die, press Enter → fresh run; press `Esc`/`P` at game over → nothing happens.

## Spec Change Log

_No bad_spec loopbacks — spec unchanged through review (0 intent_gap, 0 bad_spec)._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `SettingsScene` flipped `_fullscreen` optimistically after `scale.toggleFullscreen()`, so a browser deny/defer or a native F11/click-away exit desynced the label + persisted value. Fix: the `F` key only calls `toggleFullscreen()`; scale-manager `enterfullscreen`/`leavefullscreen` events now own `_fullscreen`, the label, and persistence (Phaser is the source of truth); listeners torn down on shutdown.
  - `[medium]` `[patch]` The migration-compat guarantee (reused key VALUE so legacy `{muted,volume}` loads) was unverified — tests seeded/read via the `SETTINGS_STORAGE_KEY` constant. Added an assertion pinning `SETTINGS_STORAGE_KEY === 'angleWars.audioSettings'` and a legacy-load test seeding the fake store under the hardcoded literal old key.
  - `[low]` `[patch]` `gameFlow.nextFlowState`/`sceneForState` returned inherited `Object.prototype` members (e.g. for `'toString'`/`'constructor'`/`'__proto__'`), violating the `string|null` contract. Guarded both lookups with `Object.hasOwn`; added prototype-key tests.
  - `[low]` `[patch]` `ArenaScene` `keydown-T` discarded the seam result and hardcoded `scene.start('TitleScene')`. Now routes through `sceneForState(nextFlowState(...))` (seam is the single state→scene authority), consistent with Title/Settings.
  - `[low]` `[patch]` `TitleScene` `keydown-S` was not gated by the start `started` latch, so a same-frame start+S could double-`scene.start`. Gated `S` on the shared latch.
  - `[low]` `[patch]` `ArenaScene` game-over `restart` (Enter/Space/click) and `keydown-T` shared no one-shot latch, so a same-frame Enter+T was nondeterministic. Added a shared `leaving` latch; `gameOver` guards unchanged.
- deferred: 1 — ArenaScene's in-run `M`/`-`/`+` audio keys lack the `event.repeat` held-key guard that `SettingsScene` has (pre-existing Story 4.5 code, not caused by this story).
- rejected (9): mid-run quit-to-title (out of scope — the intent's flow routes play→game over→title, no play→title edge); no-dead-ends test using the sim-driven `PLAYER_DIED` edge (faithful to that flow); Esc-in-fullscreen "trap" (Enter is an advertised, always-working back key); `playSfx('fire')` UI blip (per-spec choice; string-typed SFX is the engine's API); AudioEngine on a static menu (deliberate design; silent voices at gain 0, disposed on shutdown); no gamepad nav in settings (Story 5.4 owns gamepad polish per the epic); `COLOR_SETTINGS_TITLE_STRING` naming (mirrors the existing `COLOR_TITLE_TEXT_STRING`); `_settings` vs `settingsStorage` port naming (cosmetic); no-clobber passthrough untested (scene wiring is the repo's disclosed manual-verification boundary; the storage layer IS covered).

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 12: (high 0, medium 2, low 10)
- addressed_findings:
  - `[medium]` `[patch]` `SettingsScene.create()` seeded `_fullscreen` (and thus the "FULLSCREEN ON/OFF" label) from the persisted `loaded.fullscreen`. Since fullscreen is deliberately never auto-restored at boot, after any session that turned it on the reloaded settings screen showed "FULLSCREEN ON" while the window was actually windowed — a lying label that also made the first `F` press appear inverted (it entered fullscreen while the label already read ON). The `enterfullscreen`/`leavefullscreen` reconcilers only fire on transitions, never at entry, so the initial mismatch was never corrected. Fix: seed `this._fullscreen = this.scale.isFullscreen` (the scale manager is the source of truth, consistent with the prior pass's toggle-time fix); the stored value still round-trips through the port but the label now reflects reality.
  - `[medium]` `[patch]` `TitleScene`'s `start()` gesture lacked the `event.repeat` held-key guard that `keydown-S` (and every SettingsScene key) already carries. Because this story makes SettingsScene closable via `Enter` → `TitleScene`, a held `Enter` closes settings once (its `close` is repeat-guarded) but OS auto-repeat then delivers `keydown-ENTER` to the freshly-started TitleScene, whose `started` latch is false on the new instance — immediately starting a run and skipping the title. Fix: added `if (event && event.repeat) return;` to `start` (the guard is a no-op for pointer/gamepad events, which carry no `.repeat`).
- deferred: none (the ArenaScene in-run `M`/`-`/`+` missing-repeat-guard item was already deferred in the first pass; not re-added).
- rejected (12): ArenaScene re-persisting a stale `_fullscreen` after a native fullscreen exit (per-intent read-only passthrough by design, and neutralized once the label patch above reads live state on the next settings visit); persisted `fullscreen` being "write-only / dead on load" (the intent explicitly requires persist-but-never-auto-restore — a documented limitation, not a gap); SettingsScene's own `AudioEngine` on a static menu (deliberate design — silent voices at gain 0, disposed on shutdown; already rejected first pass); ArenaScene `M`/`-`/`+` lacking the repeat guard (pre-existing Story 4.5 code, already in the deferred ledger — byte-identical-audio is an explicit spec mandate); numpad `+`/`-` not bound (mirrors the existing Story 4.5 ArenaScene bindings; not this story's surface to extend); no `fullscreenunsupported` feedback (niche; degrading `F` to a no-op on unsupported browsers is acceptable); inaudible confirmation blip when muted (deliberate per-spec "correct feedback"; already rejected first pass); `save()` coercing a partial object's missing field (no current caller passes a partial object; the whole-object-write contract is the spec's explicit design); the no-clobber save-composition being untested / "extract a pure helper" (scene wiring is the repo's disclosed manual-verification boundary — already adjudicated first pass; the storage layer IS covered); `SETTINGS_HINT` test asserting only non-empty rather than naming the keys (the test meets the spec task's literal "non-empty string" bar); `CONTROLS_LINES` new Pause/Settings line untested for content (same — meets the spec's stated bar; `SETTINGS_PROMPT` separately advertises `S`); scene-wiring / fullscreen-reconciliation untested (the reviewer's own "reported for completeness only" — the disclosed manual boundary; the pure seam is fully unit-tested).

### 2026-07-20 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 15: (high 0, medium 1, low 14)
- addressed_findings:
  - none
- deferred: none (the pre-existing ArenaScene in-run `M`/`-`/`+` missing-repeat-guard item is already in the ledger from pass 1; not re-added).
- rejected (15): fullscreen persistence being write-only / "dead on load" (the intent explicitly mandates persist-but-never-auto-restore — already adjudicated pass 2); volume/mute change re-persisting `_fullscreen` seeded from live state, "overwriting" a stored `true` (direct, accepted consequence of the pass-2 honest-label fix; the stored value is never read, so no player-visible effect); native fullscreen exit on Title/Arena leaving the stored value stale (per-intent read-only passthrough by design — already rejected pass 2); flow seam "partial adoption" — `GAME_OVER→PLAY` restart using `scene.restart()` instead of routing through the seam (`scene.restart()` IS the documented thin-adapter pattern; restart is a same-scene re-run, not a cross-scene transition; the functional no-dead-end requirement is met and verified); `PLAY→GAME_OVER` being a "decorative" edge the runtime never traverses (explicitly documented in Design Notes + gameFlow.js as sim-driven / proof-only); mid-run quit-to-title being absent (out of scope on the intent's own authority — the flow is play→game-over→title, no play→title edge; already rejected pass 1); unguarded `this.scale.toggleFullscreen()` / no `fullscreenunsupported` feedback (Phaser does not synchronously throw here and degrades `F` to a no-op on unsupported browsers — already rejected pass 2); same-frame `F`+`Esc`/`Enter` mutation keys not sharing the `closing` close-latch (no double-scene-transition possible — `F` triggers only a fullscreen toggle, not a `scene.start`; transient and self-heals on next visit via live-state seeding); `playSfx('fire')` UI blip reuse + inaudible-when-muted confirmation (deliberate per-spec "correct feedback" — already rejected passes 1 & 2); same-frame `leaving`/`started`/`closing` latch determinism being untested (scene wiring is the repo's disclosed manual-verification boundary — already adjudicated passes 1 & 2); `keydown-T` resolving the seam lookup before the `gameOver` guard and lacking an `event.repeat` guard (negligible per-press work; the `leaving` latch + `gameOver` guard already make it deterministic and one-shot); `SETTINGS_STORAGE_KEY` name-vs-value mismatch relying on a comment (the load-bearing value is already pinned by an equality test — reviewer conceded "good"); SettingsScene's own `AudioEngine` not ensuring the Web Audio context is resumed before blips (Phaser unlocks the context on the `S` user-gesture that reaches the scene; a suspended context degrades the blip to a guarded no-op — speculative); numpad / non-US-layout `+`/`-` not bound to match the hint glyph (mirrors the existing Story 4.5 ArenaScene bindings; not this story's surface to extend — already rejected pass 2); fullscreen not persisting "on the same keypress" because the write is deferred to the async `enterfullscreen`/`leavefullscreen` reconciler (the pass-1/2 fix deliberately made Phaser's scale manager the source of truth so the label + stored value never lie about a denied/deferred/native toggle — a correctness improvement, not a contract miss).

## Auto Run Result

Status: done (follow-up review pass 2)

**Summary of change:** No code changed in this pass. This was a fresh follow-up review of the already-completed Story 5.3 (game-flow state machine + settings surface), triggered because the prior pass set `followup_review_recommended: true`. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel over the full `src/` diff since baseline `dacb088`. All surfaced findings were triaged and every one routed to `reject` — either explicitly by-design per the intent contract, already adjudicated in the two prior passes, or new-but-negligible (speculative / self-healing / no player-visible defect). The implementation stands as committed at `a018afe`.

**Files changed this pass:** only this spec file (frontmatter `status`/`followup_review_recommended` + this triage entry). No source or test files were modified.

**Review findings breakdown:** intent_gap 0, bad_spec 0, patch 0 (applied: none), defer 0, reject 15 (high 0, medium 1, low 14).

**Follow-up review recommendation:** `false`. Patched findings this pass = 0 → score = 3×0 + 1×0 = 0 (< 5), no high-severity patch. The review loop has converged: this pass produced no patches, so no further automated review is recommended.

**Verification performed:** Both review-diff construction and finding triage were verified against the live source (`gameFlow.js`, `SettingsScene.js`, `ArenaScene.js` game-over/restart/T handlers read directly). The prior passes' `npm test` / `npm run build` outcomes remain valid since no code changed; no re-run was required as this pass applied zero patches.

**Residual risks:** The disclosed, intent-documented limitations remain by design: (1) persisted `fullscreen` is a forward-compat preference that is deliberately never auto-restored and currently has no read-consumer; (2) the Phaser scene wiring (S/T/F key routing, fullscreen reconciliation) is the repo's manual-verification boundary and is not unit-tested — the pure seams (`gameFlow`, `settingsMenu`, `settingsStorage`) are fully covered. One pre-existing item remains in the deferred-work ledger from pass 1: ArenaScene's in-run `M`/`-`/`+` audio keys lack the `event.repeat` held-key guard (Story 4.5 code; byte-identical-audio is an explicit spec mandate for this story).


