---
title: 'Responsive Mobile Layout, Orientation & Safe Areas'
type: 'feature'
created: '2026-07-21'
baseline_revision: '69969b13dbe75916d80bbab968478d71316f9dcc'
final_revision: 'd435cfb04ef5a509114d62e87f66f434ff556e0e'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The Story 7.1 touch controls and the HUD are placed in fixed arena-logical coordinates with no awareness of the physical handset: a notch, rounded corner, or home indicator can clip or sit under the score/lives/multiplier/bomb HUD and the on-screen bomb button, the touch overlay is drawn in world space (so it drifts under a camera shake), the app never requests a landscape lock, and `env(safe-area-inset-*)` is not even reported because the viewport is not `cover`. This is Epic 7's layout spine: the game must fill a phone screen correctly and keep controls off the hardware before the native shell (7.3) wraps it.

**Approach:** Keep the already-correct Phaser `FIT + CENTER_BOTH` canvas scaling (preserves the arena aspect). Enable safe-area reporting (`viewport-fit=cover`), add a best-effort landscape lock at boot, and add a **Phaser-free, unit-tested layout seam** that reads the four CSS safe-area insets, converts them to arena-logical units through the FIT letterbox, and produces inset-adjusted positions for the HUD, the DEV debug readout, and the smart-bomb button. `ArenaScene` applies that layout at create and on every scale `resize`, screen-anchors the touch overlay (`setScrollFactor(0)`), and feeds the touch model `pointer.x/y` (screen space) instead of `pointer.worldX/worldY` so controls and hit-testing stay stable under shake and correctly placed inside the safe area. The floating sticks already materialize at the thumb, so they are inherently within reach.

## Boundaries & Constraints

**Always:**
- Preserve the existing `Phaser.Scale.FIT` + `CENTER_BOTH` config at the fixed `ARENA_WIDTH × ARENA_HEIGHT` logical size — this already scales the WebGL canvas to the device aspect ratio while preserving the arena's playable aspect (NFR7). Do not switch scale modes.
- Safe-area insets are read via `env(safe-area-inset-*)` (requires `viewport-fit=cover` on the viewport meta). Convert CSS-pixel insets to logical units through the FIT letterbox: an inset that falls entirely inside the letterbox bar contributes **zero** logical inset (the notch sits in the black bar, not over the game); only the part intruding past the bar insets the UI.
- The HUD (score/lives/multiplier/bomb count), the DEV debug readout, and the on-screen smart-bomb button must be pushed in from their respective edges by the logical inset for that edge, so none is clipped or pushed under the notch / rounded corner / home indicator (FR21).
- The smart-bomb button is the ONLY touch element with a fixed position, so its hit region and its drawn position must stay identical — drive both from a single runtime bomb-rect owned by the touch model (`setBombButton`), reflected in the render snapshot. The floating sticks stay floating (materialize at first touch = inherently in thumb reach); the left/right half-split stays at `ARENA_WIDTH / 2`.
- Touch overlay must be screen-anchored: `setScrollFactor(0)` on the overlay graphics AND feed the touch model `pointer.x/pointer.y` (screen/base-resolution space, unaffected by camera scroll) rather than `worldX/worldY`. These two changes are a package — one without the other regresses shake behavior.
- Landscape lock is best-effort and feature-detected: no-op when the Screen Orientation API is absent, and swallow the lock promise's rejection (unsupported platforms / not-fullscreen reject). It must never throw.
- Zero regression for desktop/mouse: with no safe-area insets (`env(...)` = 0) the computed layout must equal today's fixed positions, and the overlay coord change only affects the touch path.
- All layout/inset math stays Phaser-free and unit-tested (matching the `inputMath` / `mobileLayout` convention); `ArenaScene`/`BootScene` remain the only Phaser boundaries. No new per-frame allocation — layout is computed at create + on resize, not per render frame.

**Block If:**
- The pinned Phaser 3.90 scale manager does not expose the live display/parent size and per-frame `pointer.x/y` in base-resolution space needed to compute the letterbox and screen-anchor touches — the safe-area conversion would then be unsatisfiable. HALT `blocked` with that condition.

**Never:**
- No Capacitor / native shell, native orientation config, haptics, or lifecycle (Stories 7.3–7.5). The landscape lock here is the web best-effort only; hard native enforcement is 7.3/7.6.
- No changes to gameplay coordinates, the arena border, entity/ship positions, or the movement/firing/bomb systems — this is a view/layout story only.
- No new mobile quality/perf profile (Story 7.4). No re-tuning of the twin-stick feel, deflection math, or the half-split.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Notch intrudes past the letterbox | left inset 44px CSS, left bar 20px CSS, FIT scale s | logical left inset = (44−20)/s > 0; HUD/debug pushed in by it | n/a |
| Notch sits inside the letterbox bar | left inset 20px, left bar 44px | logical left inset = 0 (clamped); UI unchanged | n/a |
| Desktop / no notch | all insets 0 | logical insets all 0; HUD/debug/bomb at today's exact base positions | n/a |
| Home indicator (bottom) | bottom inset 21px, bottom bar 0 | bomb button center raised by 21/s logical; hit region raised to match | n/a |
| Zero display size (pre-layout) | parentW or parentH ≤ 0 | logicalSafeInsets returns all 0 (no divide-by-zero); resize re-applies later | guarded |
| Bomb rect moved | `setBombButton(x, y−Δ, r)` | a tap at the new center latches a bomb; a tap at the old center does not; snapshot bomb reflects new center | n/a |
| Landscape lock, API present | `orientation.lock` resolves | called once with `'landscape'` | n/a |
| Landscape lock, API absent or rejects | no `orientation` / `lock` rejects | no-op; no throw; rejection swallowed | swallowed |
| Orientation change / rotate | scale `resize` fires with new insets | layout re-read and re-applied (HUD/debug/bomb repositioned) | n/a |

</intent-contract>

## Code Map

- `index.html` -- add `viewport-fit=cover` to the viewport meta so `env(safe-area-inset-*)` is reported.
- `src/scenes/mobileLayout.js` -- NEW, Phaser-free: `parseInsetPx`, `logicalSafeInsets(insetsCss, parentW, parentH, logicalW, logicalH)`, `computeMobileLayout(logicalInsets)` (returns `{debug:{x,y}, hud:{x,y}, bomb:{x,y,radius}}`), plus two injectable browser boundaries `readSafeAreaInsetsCss(doc, getStyle)` and `lockLandscape(orientation)`.
- `src/scenes/mobileLayout.test.js` -- NEW: unit-test the pure math + the injectable boundaries per the I/O matrix.
- `src/config/constants.js` -- add `HUD_MARGIN = 8` (replaces the inline `+ 8` text margins, so the seam is the single source of the HUD/debug offsets).
- `src/input/touchControls.js` -- add a runtime `_bombButton` field (default `TOUCH_BOMB_BUTTON`), `setBombButton(x, y, radius)`; `_insideBomb` and `snapshot()` read the field, not the constant.
- `src/input/PlayerInputSampler.js` -- feed the touch model `pointer.x/pointer.y` (not `worldX/worldY`); add a `setBombButton(x, y, radius)` passthrough to the touch model. Mouse aim stays on `worldX/worldY`.
- `src/scenes/ArenaScene.js` -- `setScrollFactor(0)` on `touchOverlayGraphics`; add `_applyMobileLayout()` (read insets → logical → layout → position `hudText`/`debugText`, call `inputSampler.setBombButton(...)`); call it at end of `create()` and on `this.scale.on('resize', ...)`, removing the listener on `shutdown`.
- `src/scenes/BootScene.js` -- call `lockLandscape(screen?.orientation)` once at boot (guarded).
- `src/input/touchControls.test.js`, `src/input/PlayerInputSampler.test.js` -- extend: `setBombButton` shifts hit region + snapshot; sampler touch harness fires `pointer.x/y`; passthrough test.
- `src/scenes/renderIntegration.test.js` -- extend with a "Story 7.2" describe: pin the overlay `setScrollFactor(0)`, the `_applyMobileLayout` create + resize wiring, the `pointer.x`/`pointer.y` touch feed, the BootScene `lockLandscape` call, and the `viewport-fit=cover` in index.html.

## Tasks & Acceptance

**Execution:**
- `index.html` -- set the viewport meta to `width=device-width, initial-scale=1.0, viewport-fit=cover` -- required for `env(safe-area-inset-*)` to be non-zero.
- `src/config/constants.js` -- add `export const HUD_MARGIN = 8;` with a short comment -- centralize the HUD/debug edge margin the layout seam consumes.
- `src/scenes/mobileLayout.js` -- NEW. `parseInsetPx(v)` → number (`'Npx'`, `''`, `undefined`, `NaN` → 0). `logicalSafeInsets({top,right,bottom,left}, parentW, parentH, logicalW, logicalH)`: guard `parentW/H ≤ 0` → all 0; `s = min(parentW/logicalW, parentH/logicalH)`; symmetric bars `barX=(parentW−logicalW·s)/2`, `barY=(parentH−logicalH·s)/2`; each edge = `max(0, insetCss − bar)/s`. `computeMobileLayout({top,right,bottom,left})` using `ARENA_WIDTH/HEIGHT`, `ARENA_BORDER_INSET`, `HUD_MARGIN`, `TOUCH_BOMB_BUTTON`: `debug={m+left, m+top}`, `hud={ARENA_WIDTH−m−right, m+top}`, `bomb={TOUCH_BOMB_BUTTON.x, TOUCH_BOMB_BUTTON.y−bottom, TOUCH_BOMB_BUTTON.radius}` where `m=ARENA_BORDER_INSET+HUD_MARGIN`. `readSafeAreaInsetsCss(doc, getStyle)`: inject a probe element with `padding: env(safe-area-inset-*)`, read + `parseInsetPx` the four paddings, remove it, return the object (defaults to 0). `lockLandscape(orientation)`: if no `orientation?.lock` → return false; else `orientation.lock('landscape')` with `?.catch(()=>{})`, return true -- one Phaser-free seam for the whole layout, so the FIT/letterbox conversion is headlessly assertable.
- `src/input/touchControls.js` -- add `_bombButton = { x: TOUCH_BOMB_BUTTON.x, y: TOUCH_BOMB_BUTTON.y, radius: TOUCH_BOMB_BUTTON.radius }`; `setBombButton(x, y, radius = this._bombButton.radius)`; point `_insideBomb` and the snapshot's `bomb` fields at `_bombButton` -- a single source of truth for the bomb hit region and its drawn position.
- `src/input/PlayerInputSampler.js` -- change the three touch listeners to pass `pointer.x, pointer.y`; add `setBombButton(x, y, radius) { this.touch.setBombButton(x, y, radius); }` -- screen-anchor the touch coords and expose the bomb-rect seam to the scene.
- `src/scenes/ArenaScene.js` -- `this.touchOverlayGraphics.setScrollFactor(0)` at creation; add `_applyMobileLayout()` that reads `readSafeAreaInsetsCss(document, window.getComputedStyle)`, the parent size (`this.scale.parentSize` or `window.innerWidth/Height`), computes `logicalSafeInsets` then `computeMobileLayout`, sets `hudText`/`debugText` positions and `inputSampler.setBombButton(...)`; call it at the end of `create()` and register `this.scale.on('resize', this._applyMobileLayout, this)`, removing it in the `shutdown` handler -- responsive, allocation-free layout application.
- `src/scenes/BootScene.js` -- in `create()`, call `lockLandscape(typeof screen !== 'undefined' ? screen.orientation : null)` before starting PreloadScene -- best-effort landscape at boot.
- `src/scenes/mobileLayout.test.js`, `src/input/touchControls.test.js`, `src/input/PlayerInputSampler.test.js`, `src/scenes/renderIntegration.test.js` -- add/extend tests covering every I/O-matrix row, the `setBombButton` hit-region + snapshot shift, the `pointer.x/y` touch feed, and the ArenaScene/BootScene/index.html wiring pins.

**Acceptance Criteria:**
- Given the app runs on a handset, when it starts, then the WebGL canvas scales to the device aspect ratio while preserving the arena's playable aspect (the `FIT + CENTER_BOTH` config is unchanged) and a best-effort landscape lock is requested at boot.
- Given a device reporting non-zero `env(safe-area-inset-*)`, when the HUD, DEV debug readout, and smart-bomb button lay out, then each is inset from its edge by the logical inset for that edge (converted through the letterbox), so none is clipped or under the notch / rounded corner / home indicator.
- Given the on-screen bomb button is repositioned by the safe-area layout, when a finger taps its drawn location, then exactly one bomb latches there (hit region and drawn position stay identical), and a tap at the pre-inset location does not.
- Given a camera shake during touch play, when the overlay draws, then the sticks and bomb button stay screen-anchored (no world-space drift) because the overlay is `scrollFactor(0)` and the model is fed screen-space `pointer.x/y`.
- Given no safe-area insets (desktop/mouse), when the layout computes, then the HUD/debug/bomb positions equal today's fixed positions (zero regression) and the mouse/gamepad/keyboard paths are unchanged.
- Given the full gates, when `npx vitest run` and `npm run build` execute, then all input/scene/layout tests pass and the production build succeeds.

## Spec Change Log

_No spec amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-21 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 0, low 6)
- defer: 0
- reject: 12
- addressed_findings:
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the `_applyMobileLayout` composition was pinned only by argument-agnostic regexes (`/logicalSafeInsets\(/`, `/computeMobileLayout\(/`); a `parentW`/`parentH` swap, a transposed `ARENA_WIDTH`/`ARENA_HEIGHT`, or feeding raw `insetsCss` into `computeMobileLayout` would ship green. Tightened the pins to bind the load-bearing arguments (`insetsCss, parentW, parentH, ARENA_WIDTH, ARENA_HEIGHT` and `computeMobileLayout(logical)`).
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the "positions HUD/debug/bomb" test named debug in its title but never asserted `debugText.setPosition(layout.debug…)`; a dropped/mis-wired debug reposition passed. Added the DEV-gated `debugText.setPosition(layout.debug.x, layout.debug.y)` assertion.
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the BootScene landscape-lock argument was unpinned (`/lockLandscape\(/`); a regression to `lockLandscape(screen)` (instead of `screen.orientation`) silently disables the lock while passing. Pinned the guarded `screen.orientation` argument shape.
  - `[low]` `[patch]` `src/config/constants.js`, `src/input/touchControls.js` — stale docs on the re-pointed coordinate seam still said the touch model reads `pointer.worldX/worldY`; Story 7.2 switched the sampler feed to `pointer.x/y` (base-resolution, shake-free). Corrected the comments/JSDoc and refreshed the "tuned later" placement note to reflect the runtime safe-area insetting this story added.
  - `[low]` `[patch]` `src/scenes/mobileLayout.js` — `readSafeAreaInsetsCss` was not fail-safe (unguarded `doc.body.appendChild`), unlike its sibling boundary `lockLandscape`, despite a JSDoc contract promising "defaults every edge to 0". Guarded the host (`doc.body || doc.documentElement`) and wrapped the probe read in try/catch returning all-zero insets.
  - `[low]` `[patch]` `src/scenes/ArenaScene.js` — documented the window-frame assumption at the parent-size read (env() insets and the FIT letterbox bars are both measured in the window frame; valid while `#game` fills the viewport per index.html), removing a latent coordinate-frame trap two reviewers ranked first. Comment-only; no behavior change.
- rejected (summary): iOS landscape-lock no-op / no portrait fallback (best-effort web lock is all 7.2 can do; hard native lock is Story 7.3 per the epic's Capacitor sequencing), unbounded `computeMobileLayout` clamp (insets are physically bounded to tens of px; unreachable on real hardware), rotation-timing stale-inset first read (self-correcting on the next resize/rAF), `resize`-listener-not-removed-on-`sleep` (no scene sleeps ArenaScene in the current architecture; lifecycle is Story 7.5), orientation-lock-never-released (lifecycle/teardown is Story 7.5), horizontal-inset-ignored / stick-under-side-notch and floating-sticks-not-inset-constrained + thumb-reach + hard-non-occlusion (by-design: floating sticks materialize at the thumb per the epic's UX pattern — inherently in the touchable/reachable region; HUD non-occlusion holds by top-right/bottom-center placement), AC1-scaling-asserted-nowhere (the `FIT + CENTER_BOTH` config AC1 relies on is already pinned by `buildConfig.test.js`), and "allocation-free" comment (in context it means no per-frame allocation, which holds — layout runs at create + on resize only).

### 2026-07-21 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 10
- addressed_findings:
  - `[low]` `[patch]` `src/scenes/mobileLayout.js` — `lockLandscape` violated its explicit "must never throw" intent contract on two shapes: `orientation.lock()` throwing synchronously (some platforms throw instead of rejecting) propagated out of the un-try/catch'd `BootScene.create()`, and a truthy non-thenable return (older/prefixed API) made `?.catch` (which only guards nullish) call `.catch` on a non-promise → TypeError. Wrapped the call in try/catch and guarded `.catch` with a `typeof … === 'function'` check. Added two unit rows (sync-throw swallowed, non-thenable tolerated).
  - `[low]` `[patch]` `src/scenes/mobileLayout.js` — `readSafeAreaInsetsCss` removed the DOM probe only on the happy path; a throw after `appendChild` (e.g. `getStyle` raising) hit the `catch` and returned zeros but leaked the hidden `<div>`, accumulating one per create()/resize pass on a throwing host. Moved `probe.remove()` into a `finally` so cleanup runs on every path. Added a unit row asserting zeros + probe removed on a `getStyle` throw, and a missing-host row.
  - `[low]` `[patch]` `src/scenes/mobileLayout.js`, `src/scenes/ArenaScene.js`, `src/scenes/renderIntegration.test.js` — the parent-size read in `_applyMobileLayout` fell back to the window per-axis (`(parent && parent.width) || window.innerWidth` independently per dim), so a half-measured `parentSize` (one axis ≤ 0) mixed a valid parent axis with a window axis and corrupted the FIT-scale/letterbox bar math. Extracted the frame selection into a new Phaser-free `resolveDisplaySize(parentSize, win)` that commits to a single frame (parent, else window for BOTH axes), unit-tested it (the load-bearing letterbox input is now headlessly asserted, not just source-pinned), routed ArenaScene through it, and pinned its use in renderIntegration.
- rejected (summary): runtime-boundary-tested-by-source-regex-not-execution (BlindHunter #6 + VerificationGap #2/#3 + the intent-alignment divergence — the `_applyMobileLayout` body, the resize re-application, and the `setScrollFactor(0)` half of the shake package are pinned by source-regex rather than executed; this is architecturally forced — the vitest env is `node` with no DOM and no test can import `ArenaScene` without Phaser, and the intent's "Always" clause explicitly sanctions a thin source-pinned Phaser boundary with the math in a unit-tested Phaser-free seam. Mitigated by extracting `resolveDisplaySize` so the load-bearing frame-selection is now executed in tests), iOS-rotation-stale-insets (self-correcting on the next resize/rAF; re-confirmed reject from pass 1), bomb.y-unbounded-clamp (insets physically bounded to tens of px; re-confirmed reject from pass 1), non-enumerated-surfaces-not-inset (arena border/game-over/pause overlays/floating sticks — the intent's "Always" clause enumerates exactly HUD + DEV debug + smart-bomb button, and the arena border is in "Never"; floating sticks materialize at the thumb by design), lockLandscape-always-rejects-in-browser / no-portrait-fallback-overlay (best-effort web lock is all 7.2 does per the epic's Capacitor sequencing; a portrait prompt is new UI outside intent; re-confirmed reject from pass 1), DOM-probe-reflow-per-resize ("no per-frame allocation" is about render frames — resize/orientation change is infrequent on the mobile target, not a hot path), shutdown-couples-audio-dispose-with-resize-off (predicated on `dispose()` itself throwing, a separate hypothetical; teardown/lifecycle robustness is Story 7.5), exported-math-NaN-on-partial-inset-object (`readSafeAreaInsetsCss` always returns a full four-key numeric object; the internal functions are never called with a partial shape), probe-failure-no-dev-warning (diagnostic nicety, not a defect), and resize-listener-re-added-on-wake / double-register (no lifecycle wakes ArenaScene without an intervening shutdown in the current architecture; Story 7.5 owns lifecycle; re-confirmed reject from pass 1).

## Design Notes

- **Letterbox conversion (the crux).** FIT+CENTER_BOTH scales the 1280×720 arena by `s = min(parentW/1280, parentH/720)` and centers it, leaving symmetric bars `barX/barY`. A safe-area inset measured from the window edge only intrudes into the drawn game by `max(0, insetCss − bar)` CSS px = `/s` logical units. This is why an inset smaller than its bar contributes nothing — it lands in the black letterbox, not over the arena.
- **Why `pointer.x/y` not `worldX/worldY` for touch.** `pointer.x/y` are in the game's base-resolution (logical) space and exclude camera scroll; `worldX/worldY` include shake scroll. With the overlay pinned at `scrollFactor(0)`, feeding world coords would double-count the shake. Switching to `pointer.x/y` makes both hit-testing and drawing shake-stable — this is exactly the "screen-space anchoring" Story 7.1 deferred here (see the ArenaScene overlay comment). The half-split (640) and deflection math are unchanged.
- **Bomb rect single-source.** The bomb button is the only fixed touch element; letting the model own a runtime `_bombButton` (default from the constant, updated via `setBombButton`) keeps the hit region and the drawn button in lockstep when the safe-area layout shifts it.
- **Desktop is untouched:** `env(...)`=0 → logical insets 0 → `computeMobileLayout` returns the base positions verbatim.

## Verification

**Commands:**
- `npx vitest run src/scenes src/input src/config` -- expected: all layout, scene, and input unit tests pass, including the new `mobileLayout` suite and the extended touch/sampler/renderIntegration suites.
- `npx vitest run` -- expected: full suite green (no regression in the ~816 existing tests).
- `npm run build` -- expected: production Vite build succeeds with no errors.

**Manual checks:**
- In a browser with device emulation (a notched phone, landscape): the HUD sits clear of the notch/rounded corner and the bomb button clears the home indicator; dragging the sticks during a bomb/death shake shows no overlay drift; on desktop the HUD/debug/bomb positions are visually identical to before.

## Auto Run Result

Status: done (follow-up review pass on an already-`done` spec)

### Summary of implemented change
Story 7.2 (responsive mobile layout, orientation & safe areas) was already implemented and reviewed once (baseline `69969b1` → `927f107`). This follow-up review pass re-ran the four review layers (adversarial, edge-case, verification-gap, intent-alignment) against the committed diff and hardened three low-severity items surfaced across reviewers. No intent gaps or spec deviations; the intent contract is unchanged.

### Files changed this pass
- `src/scenes/mobileLayout.js` — `lockLandscape` now try/catch-wrapped and guards `.catch` on a non-thenable return (honors the "never throws" contract on sync-throw / legacy-API shapes); `readSafeAreaInsetsCss` removes its DOM probe in a `finally` (no orphan-node leak on a `getStyle` throw); new Phaser-free `resolveDisplaySize(parentSize, win)` helper that commits to a single coordinate frame.
- `src/scenes/ArenaScene.js` — `_applyMobileLayout` routes the parent-size read through `resolveDisplaySize` instead of the per-axis window fallback (fixes the mixed-frame FIT-scale corruption).
- `src/scenes/mobileLayout.test.js` — added rows: `lockLandscape` sync-throw + non-thenable; `readSafeAreaInsetsCss` throw-path (zeros + probe removed) + missing-host; full `resolveDisplaySize` describe (parent preferred, both-axis window fallback, no frame-mixing).
- `src/scenes/renderIntegration.test.js` — pinned that ArenaScene routes display size through `resolveDisplaySize(this.scale.parentSize, window)`.

### Review findings breakdown
- Patches applied: 3 (all low) — `lockLandscape` never-throws hardening, `readSafeAreaInsetsCss` probe-leak `finally`, mixed-frame parent-size fallback → unit-tested `resolveDisplaySize`.
- Deferred: 0.
- Rejected: 10 — see the follow-up entry in `## Review Triage Log` for each with rationale (the headline reject is the "runtime boundary tested by source-regex not execution" theme, which is architecturally forced — `node` test env, no DOM, `ArenaScene` cannot be imported without Phaser — and sanctioned by the intent's thin-boundary/unit-tested-seam design; mitigated this pass by extracting the load-bearing frame-selection into the now-executed `resolveDisplaySize`).

### Follow-up review recommendation
`false`. Patched this pass: high 0, medium 0, low 3 → score = 3×0 + 1×3 = 3 (< 5, no high).

### Verification performed
- `npx vitest run src/scenes src/input src/config` → 289 passed (18 files), incl. `mobileLayout.test.js` at 26 tests.
- `npx vitest run` → 854 passed (52 files), no regressions.
- `npm run build` → production Vite build succeeded (74 modules, no errors).

### Residual risks / artifacts
- The `_applyMobileLayout` Phaser glue (resize re-application, `setScrollFactor(0)` overlay pin, BootScene lock call site) remains pinned by source-regex rather than executed — architecturally forced and intent-sanctioned; the load-bearing math and frame-selection are all unit-tested.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` was modified before this run (orchestrator bookkeeping, not touched this pass) — left in place as a residual artifact.

