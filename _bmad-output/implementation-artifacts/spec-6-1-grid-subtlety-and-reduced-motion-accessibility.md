---
title: 'Grid Subtlety and Reduced-Motion Accessibility'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: 'b486673147e36f182fc0b76302662f592ca64d54'
final_revision: '3184b66'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/persistence/settingsStorage.js'
  - '{project-root}/src/scenes/settingsMenu.js'
  - '{project-root}/src/scenes/SettingsScene.js'
  - '{project-root}/src/scenes/ArenaScene.js'
  - '{project-root}/src/scenes/gridField.js'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Once played, Angle Wars' grid feedback reads as too loud (the kill-ripple is distractingly big), and the game has no escape hatch for players sensitive to motion or flashing — the deferred Story 4.4 accessibility item (WCAG 2.3.1). The Epic 5 settings/persistence infrastructure now exists to hang that option on.

**Approach:** (1) Retune the default grid ripple constants so the kill-ripple is markedly subtler yet still readable. (2) Add a persisted `reducedMotion` setting to the existing settings object + SettingsScene, and when it is on suppress the three named motion/flash cues at render time — the grid warp (black-hole bow), the full-screen flash, and the camera shake — while leaving particles, audio, and the (now-calmer) ripple untouched so every event still reads.

## Boundaries & Constraints

**Always:**
- Reduced motion is **presentation-only**: the simulation (ScreenFeedbackSystem trauma/flash latches, GridFieldSystem warp target, all event sources) stays byte-identical whether the flag is on or off. Suppression happens only where the render loop consumes those latches. This keeps particles, audio, and sim determinism unaffected (satisfying "the event still reads through non-motion cues").
- `reducedMotion` persists through the SAME guarded `settingsStorage` port and the SAME `SETTINGS_STORAGE_KEY` value — a superset field, defaulted `false`, so legacy `{muted,volume(,fullscreen)}` payloads still load. Never introduce a new storage key or a data migration.
- Every writer of the settings object writes the WHOLE `{muted,volume,fullscreen,reducedMotion}` object so no save clobbers a field it does not own (mirror the existing `fullscreen` passthrough in ArenaScene).
- All new/changed tunables stay centralized in `constants.js`; no inline magic numbers in scenes or seams.
- The retuned ripple must remain visibly non-zero (still readable feedback), not disabled.

**Block If:**
- (none expected — this is a localized retune + additive setting on established seams)

**Never:**
- Never suppress the grid **ripple** (uRipples) or hit-stop under reduced motion — AC2 enumerates only grid warp, full-screen flash, and camera shake. The ripple is the codebase's distinct `uRipples` mechanism (calmed globally by AC1); hit-stop is a brief freeze, not motion/flash.
- Never suppress particles or audio under reduced motion (they are the surviving readable cues).
- Never add a per-source ripple amplitude or restructure the grid/feedback systems — AC1 is a constant retune of the shared ripple.
- Never auto-apply reduced motion mid-run via a live re-read; it is read once at `ArenaScene.create()` (settings are reachable only from the title, so a toggle takes effect on the next run — which is every fresh run and every restart).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Load reducedMotion (valid) | stored `{...,reducedMotion:true}` | `load()` returns `reducedMotion:true` | — |
| Load reducedMotion (missing/legacy) | payload with no `reducedMotion` | `load()` returns `reducedMotion:false` (default) | Missing → default |
| Load reducedMotion (wrong type) | stored `reducedMotion:'yes'` | coerced to default `false` (only a real boolean counts) | Non-boolean → default |
| Save round-trip | `save({...,reducedMotion:true})` | JSON includes `reducedMotion:true`; `load()` reads it back; `!!` coercion on save | Blocked store → no-op, no throw |
| Pack warp, reduced motion off | active warp, `reduceMotion=false` | `uWarp.value.z` = warp strength (unchanged) | — |
| Pack warp, reduced motion on | active warp, `reduceMotion=true` | `uWarp.value.z` forced `0`; ripple slots still packed normally | — |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ripple tunables (`GRID_RIPPLE_AMPLITUDE`, `GRID_RIPPLE_SPEED`) to retune (AC1); add `SETTINGS_REDUCED_MOTION_DEFAULT`.
- `src/persistence/settingsStorage.js` -- guarded port; add `reducedMotion` to `defaults()`, `load()` coercion, `save()` serialization.
- `src/scenes/settingsMenu.js` -- `SETTINGS_HINT` string; extend to name the Reduced Motion key (`formatToggle` reused, no new formatter).
- `src/scenes/SettingsScene.js` -- add reduced-motion line + `keydown-R` toggle + persist; re-space setting lines so the new line and hint do not overlap.
- `src/scenes/ArenaScene.js` -- read `reducedMotion`; include it in the `applyAudioSettings` save passthrough; gate camera shake (`scrollX/Y=0`), flash (`alpha=0`), and warp (pass flag to `packGridUniforms`) when on.
- `src/scenes/gridField.js` -- `packGridUniforms(uniforms, gridFieldSystem, reduceMotion=false)` forces warp `z=0` when `reduceMotion`.
- Test files (below) for each Phaser-free change.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- AC1: lower `GRID_RIPPLE_AMPLITUDE` (14 → 6) and `GRID_RIPPLE_SPEED` (480 → 300) so the ripple is markedly subtler in amplitude and reach yet still non-zero; update their doc comments. Add `export const SETTINGS_REDUCED_MOTION_DEFAULT = false;` with a comment (a persisted `{muted,volume,fullscreen,reducedMotion}` superset field).
- `src/persistence/settingsStorage.js` -- add `reducedMotion` to `defaults()`, to `load()` (only a real boolean counts, else `SETTINGS_REDUCED_MOTION_DEFAULT`), and to `save()` (`reducedMotion: !!settings.reducedMotion`). Import the new constant.
- `src/scenes/settingsMenu.js` -- extend `SETTINGS_HINT` to name the toggle key, e.g. `'Volume: - / +    Mute: M    Fullscreen: F    Reduced Motion: R    Back: Esc / Enter'`.
- `src/scenes/SettingsScene.js` -- load `this._reducedMotion = loaded.reducedMotion`; add a `REDUCED MOTION ON/OFF` text line via `formatToggle('REDUCED MOTION', this._reducedMotion)`; re-space the volume/mute/fullscreen/reduced-motion/hint y-offsets so none overlap; add a `keydown-R` handler (with the `event.repeat` guard, matching the other keys) that flips `_reducedMotion`, refreshes the line, and persists; include `reducedMotion` in `_persist()`.
- `src/scenes/gridField.js` -- add a third optional `reduceMotion = false` param to `packGridUniforms`; when true, set the packed warp `w.z = 0` regardless of the system's warp state (ripple packing unchanged). Update the JSDoc.
- `src/scenes/ArenaScene.js` -- set `this._reducedMotion = settings.reducedMotion` after the existing settings load; include `reducedMotion: this._reducedMotion` in the `applyAudioSettings` save object (passthrough, mirroring `fullscreen`); in the render loop, when `this._reducedMotion` write `cameras.main.scrollX/scrollY = 0` instead of the shake offsets and set `flashOverlay` alpha to `0`; pass `this._reducedMotion` as the third arg to `packGridUniforms(...)`.
- `src/persistence/settingsStorage.test.js` -- add `reducedMotion` to the `DEFAULTS` fixture and the valid/coercion/legacy/round-trip expectations; add cases: valid `reducedMotion:true` round-trips, non-boolean `reducedMotion` coerces to default, legacy payload defaults it `false`.
- `src/scenes/settingsMenu.test.js` -- assert `SETTINGS_HINT` names the Reduced Motion key (e.g. contains `'Reduced Motion'` and `'R'`).
- `src/scenes/gridField.test.js` -- add a warp case: an active warp packs `z=0` when `packGridUniforms(...,true)` while ripple slots still pack normally; default (`reduceMotion` omitted/false) leaves warp `z` unchanged.

**Acceptance Criteria:**
- Given the ripple constants after AC1, when compared to the prior values, then `GRID_RIPPLE_AMPLITUDE` and `GRID_RIPPLE_SPEED` are both markedly lower and still strictly positive (readable, not disabled).
- Given a settings object with `reducedMotion:true` persisted, when `settingsStorage.load()` runs, then it returns `reducedMotion:true`; given a legacy payload without the field, then it returns `reducedMotion:false`.
- Given `packGridUniforms` called with `reduceMotion=true` and an active warp, when it packs, then `uWarp.value.z === 0` and the ripple slots are still packed from the system state.
- Given the SettingsScene, when the player presses `R`, then the REDUCED MOTION line flips ON/OFF and the whole settings object (including `reducedMotion`) is written through the guarded port (persists across sessions).
- Given `reducedMotion` is on at `ArenaScene.create()`, when a bomb detonates or the player dies, then no full-screen flash and no camera-shake offset are applied while the audio SFX and particles for that event still fire (the event remains readable).

## Spec Change Log

_(none — no bad_spec loopback occurred.)_

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` The reduced-motion ArenaScene render wiring had no automated coverage (the `packGridUniforms` third `reduceMotion` arg, the `scrollX/Y` zeroing branch, the `flashOverlay.setAlpha` gating, and the `reducedMotion` passthrough in the in-run `applyAudioSettings` save). A silent regression to any of these would disable the accessibility feature or reset the user's preference with the suite green. Added source-text assertions to `src/scenes/renderIntegration.test.js` (the established convention for Phaser-coupled ArenaScene wiring that cannot be imported headlessly).

## Design Notes

Reduced motion is deliberately gated at the **render-consumption** layer, not in the sim:
- Warp: `packGridUniforms(this.gridShader.uniforms, this.gridFieldSystem, this._reducedMotion)` — the pure seam forces `uWarp.z = 0`, so the black-hole grid bow flattens without touching `GridFieldSystem`.
- Flash + shake: in `ArenaScene.update`, still `consume*()` the latches (so they reset), but when `this._reducedMotion` write `scrollX/scrollY = 0` and `flashOverlay.setAlpha(0)` instead of the computed values. The `screenShake.js` pure functions and `ScreenFeedbackSystem` are unchanged.

Why: an accessibility preference should change what the player *sees*, not what the sim *computes*, so determinism, particles, and audio are untouched — that is exactly what makes AC3's "still reads through color/particles/audio" hold for free.

AC1 vs AC2 vocabulary: this codebase names two distinct grid mechanisms — `uRipples` (explosion/kill/bomb/death rings) and `uWarp` (black-hole bow). AC1 tones the shared **ripple** down for everyone; AC2 additionally suppresses the **warp** (+flash+shake) only under reduced motion. The ripple is intentionally NOT suppressed by the toggle (it is the calmed, readable non-flash feedback), matching AC2's explicit enumeration.

`SettingsScene` line layout after adding a 4th setting line (example y-offsets, tune for no overlap): title `cy-140`, volume `cy-60`, mute `cy-20`, fullscreen `cy+20`, reduced-motion `cy+60`, hint `cy+130`.

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including the updated `settingsStorage.test.js`, `settingsMenu.test.js`, and `gridField.test.js`.
- `npm run build` -- expected: production build succeeds (no import/reference errors from the new constant/param).

**Manual checks (Phaser render layer — not unit-testable, per codebase precedent):**
- `npm run dev`: default run — kill-ripple is visibly subtler than before but still readable. On the settings screen, `R` toggles REDUCED MOTION ON/OFF and the label updates immediately; reload the page and re-open settings — the choice persisted. With it ON, start a run: bombs/deaths produce no white flash and no camera shake, the black-hole grid bow is flat, yet SFX and particle bursts still fire; with it OFF, flash/shake/warp return.

## Auto Run Result

Status: done

### Summary
Story 6.1 delivered: (AC1) the default grid kill-ripple is markedly calmer for everyone — `GRID_RIPPLE_AMPLITUDE` 14→6 and `GRID_RIPPLE_SPEED` 480→300, still strictly positive/readable; (AC2/AC3) a persisted `reducedMotion` accessibility setting joins the consolidated `{muted,volume,fullscreen,reducedMotion}` object (same storage key, legacy-tolerant) with an `R` toggle on the settings screen, and when it is on `ArenaScene` suppresses the grid warp, the full-screen flash, and the camera shake at the render-consumption layer while the sim, particles, and audio stay byte-identical (so bomb/death events still read through non-motion cues). Closes the deferred Story 4.4 WCAG 2.3.1 item.

### Files changed
- `src/config/constants.js` — retuned ripple amplitude/speed (AC1); added `SETTINGS_REDUCED_MOTION_DEFAULT`.
- `src/persistence/settingsStorage.js` — `reducedMotion` added to defaults/load-coercion/save (legacy-tolerant, `!!` coerced).
- `src/scenes/settingsMenu.js` — `SETTINGS_HINT` names the `Reduced Motion: R` key.
- `src/scenes/SettingsScene.js` — loads `_reducedMotion`; REDUCED MOTION line; `keydown-R` toggle; re-spaced lines; `_persist` includes it.
- `src/scenes/gridField.js` — `packGridUniforms(uniforms, sys, reduceMotion=false)` forces warp `z=0` when on (ripple untouched).
- `src/scenes/ArenaScene.js` — reads `_reducedMotion`; passes it through the in-run save; render loop zeroes shake, gates flash alpha, and flattens warp under it.
- `src/persistence/settingsStorage.test.js`, `src/scenes/settingsMenu.test.js`, `src/scenes/gridField.test.js` — coverage for the new field/hint/warp-gate (I/O matrix rows).
- `src/scenes/renderIntegration.test.js` — review patch: source-text regression assertions pinning the four reduced-motion ArenaScene wirings.

### Review findings breakdown
- Patches applied: 1 — `[medium]` added `renderIntegration.test.js` source-text coverage for the reduced-motion ArenaScene wiring (packGridUniforms 3rd arg, scroll zeroing, flash gating, in-run save passthrough).
- Deferred: 0.
- Rejected: 12 — chiefly the "ripple/particles still animate under reduced motion" cluster (rejected on the authority of the intent: AC2 enumerates only warp/flash/shake, AC3 names particles as a surviving cue, AC1 handles the ripple as a separate global calm), plus non-automatable visual-tuning, out-of-scope mid-run-apply, and speculative/noise items. Edge-case-hunter returned no findings.

### Follow-up review recommendation
`false`. This pass's patched findings: high 0, medium 1, low 0. Score = 3×1 + 1×0 = 3 (< 5), no high severity.

### Verification
- `npm test` — 46 files, 678 tests, all pass (includes the new reduced-motion coverage and every I/O-matrix row).
- `npm run build` — production build succeeds, no import/reference errors.
- Matrix Test Audit — all six I/O matrix rows covered by tests that ran and passed.
- The Phaser render-layer visuals (actual on-screen warp/flash/shake suppression, ripple legibility) remain manual `npm run dev` checks per codebase precedent; the wiring that drives them is now source-text-pinned.

### Residual risks
- On-screen visual feel (is amplitude 6 "readable"; do audio+ripple suffice with flash/shake gone) is a subjective tuning judgment verified only manually; all values are centralized tunable constants for post-launch adjustment.
- `reducedMotion` is read once at `ArenaScene.create()` by design (settings are title-only, so a toggle applies on the next run/restart) — no mid-run live re-read.
