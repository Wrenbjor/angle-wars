---
title: 'Native Lifecycle and Feel Integration'
type: 'feature'
created: '2026-07-21'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'a5d32c78bbf90d488da6c83685c8a3d29996f64e'
final_revision: 'b782beb'
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The game now runs inside the Capacitor WebView (Stories 7.3/7.4) but behaves like a web page, not a native app: backgrounding it keeps the run live (the player can die while away — FR23), the Android hardware back button abruptly closes the app, key feel events (death, bomb, extra life) produce no tactile response, and the screen can auto-lock mid-run. None of the native `App`/lifecycle surface is wired.

**Approach:** Add a Phaser-free native-lifecycle seam that (1) auto-pauses an active run on background/focus loss and lets it resume cleanly via the existing pause flag (Story 5.2); (2) routes the Android back button through a pure decision (pause/resume during a run, safe background-minimize otherwise — never an abrupt close); (3) fires short Capacitor Haptics pulses on death/bomb/extra-life, suppressed under Reduced Motion (Story 6.1), aggregated in the existing `ScreenFeedbackSystem` latch pattern; and (4) keeps the display awake only while actively playing via the `navigator.wakeLock` boundary. Pure decisions live in unit-tested modules; the risky native/browser calls sit behind fail-safe boundaries that mirror `mobileLayout` (inject the global, try/catch → safe default, never throw). Two official plugins are added — `@capacitor/app`, `@capacitor/haptics`; keep-awake uses the web Screen Wake Lock API (no community plugin). No gameplay/sim/scoring/movement/firing change.

## Boundaries & Constraints

**Always:**
- **Auto-pause is force-pause, never toggle.** On Capacitor `App` `appStateChange` `isActive:false` OR `document` `visibilitychange` `hidden`, if a run is active (`ArenaScene` running AND `!playerState.gameOver` AND `!_paused`) set `ArenaScene._paused = true`. On return, do NOT auto-resume — the run stays paused and resumes via the existing bit-identical resume (a key/tap/back), so the player is never dropped straight back into live danger. Never pause a game-over.
- **Back button never abruptly closes.** Route through a pure decision: run active + playing → pause; run active + paused → resume (both via the existing `togglePause(paused, gameOver)`); otherwise (title/settings/game-over) → `App.minimizeApp()` (safe background, state preserved). `App.exitApp()` is never called.
- **Haptics respect Reduced Motion and the latch discipline.** Death/bomb/extra-life edges are aggregated as pending pulses in `ScreenFeedbackSystem` (mirroring its `deathSeq`/`shockwaveMs` edge-detection) using module-level style constants and a reused buffer (no new per-frame allocation, NFR2). `ArenaScene` ALWAYS drains the pulses each frame (deterministic), but only calls the Haptics boundary when `!this._reducedMotion` — suppression at the output layer exactly like screen-shake/flash. Style mapping: death → Heavy, bomb → Medium, extra life → Light.
- **Keep-awake tracks active play only, edge-triggered.** Desired-awake = run active AND `!_paused` AND `!gameOver`. `ArenaScene` requests the wake lock when desired flips true and releases it when it flips false (and on scene shutdown), tracking a boolean so no wake-lock call happens per frame. Keep-awake is NOT gated by Reduced Motion (that flag governs motion feel, not screen sleep).
- **Fail-safe boundaries.** Every native/browser touch (`@capacitor/app`, `@capacitor/haptics`, `navigator.wakeLock`) goes through a guarded boundary that feature-detects, wraps the call in try/catch, and degrades to a no-op — never throwing and never crashing `create()`/`update()`/bootstrap. The pure decision modules import NO `@capacitor/*` package and NO Phaser; the plugin objects are imported only in `main.js`/`ArenaScene` (the untestable adapter layer, like Phaser) and injected into the boundaries.
- New deps `@capacitor/app` and `@capacitor/haptics` are pinned to the existing Capacitor 8 line (`^8`), so `cap sync` stays coherent. Preserve every `main.js` invariant asserted by the suite (WEBGL renderer, FIT/CENTER scale, the `scene: [...]` chain, `input.gamepad`).

**Block If:**
- (none anticipated — additive lifecycle wiring over the shipped native shell; the reading of "resumes cleanly" and back-at-root behavior are resolved in Design Notes from the AC's stated rationale, not left open. On-device haptic/keep-awake/back behavior is a documented manual boundary, not a block.)

**Never:**
- Do NOT change gameplay, spawning, scoring, movement, firing, the fixed-step sim, or the pause overlay's visuals/keys. Extra-life logic keeps its exact award timing/ordering — only an observability `awardSeq` latch is added.
- Do NOT add a user-facing haptics/keep-awake toggle or persist any new setting — Reduced Motion is the single governing flag (Story 6.1), and keep-awake/auto-pause are automatic.
- Do NOT auto-resume gameplay on foreground, and do NOT call `App.exitApp()` or otherwise close the app on back.
- Do NOT add a community keep-awake plugin — use `navigator.wakeLock`.
- Do NOT claim on-device haptics/keep-awake/back-button/framerate are verified here — this Linux host has no device/WebView; do not fabricate device results.
- Do NOT introduce new per-frame allocation in the drain or keep-awake paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Background during run | `decideBackgroundPause({ runActive:true, paused:false })` | `true` (force pause) | — |
| Background at title/paused/game-over | `runActive:false` OR `paused:true` | `false` (no-op) | — |
| Back — playing | `decideBackButton({ runActive:true, paused:false })` | `'pause'` | — |
| Back — paused | `decideBackButton({ runActive:true, paused:true })` | `'resume'` | — |
| Back — not in run | `decideBackButton({ runActive:false, paused:* })` | `'minimize'` | — |
| Keep-awake desired | `decideKeepAwake({ runActive:true, paused:false, gameOver:false })` | `true` | — |
| Keep-awake released | run inactive OR paused OR game-over | `false` | — |
| Wire lifecycle | `wireNativeLifecycle({ app, doc, controller })` fires background/back events | routes to `controller.forcePause()` / `.pause()/.resume()/.minimize()`; returns an unsubscribe that removes every listener | missing `app`/`doc`/method → skipped, never throws |
| Haptic boundary | `pulseHaptic(haptics, 'HEAVY')` | calls `haptics.impact({ style:'HEAVY' })` once | `haptics` null / `.impact` absent / throws → no-op, never throws |
| Wake-lock boundary | `acquireWakeLock(nav)` / `releaseWakeLock(sentinel)` | requests/releases the screen lock, returns sentinel or null | absent `navigator.wakeLock` / rejection / throw → null / no-op, never throws |
| Extra-life latch | `ExtraLifeSystem.fixedUpdate` crosses N thresholds | `awardSeq` rises by exactly N; unchanged on a non-award tick | — |
| Haptic aggregation | death edge / bomb edge / extra-life edge in `ScreenFeedbackSystem.fixedUpdate` | one pending `HEAVY` / `MEDIUM` / `LIGHT` pulse; `drainHapticPulses(sink)` emits each once then empties | no edge → drain emits nothing |

</intent-contract>

## Code Map

- `package.json` -- add `@capacitor/app` and `@capacitor/haptics` at `^8` to `dependencies` (Capacitor-8 line).
- `src/scenes/nativeLifecycle.js` -- NEW pure, Phaser-free, `@capacitor/*`-free module: `decideBackgroundPause(state)`, `decideBackButton(state)`, `decideKeepAwake(state)`, and `wireNativeLifecycle({ app, doc, controller })` — the guarded boundary that registers `appStateChange`/`backButton` (Capacitor `App`) + `visibilitychange` (`document`), routes each through the decisions to the injected `controller`, and returns an unsubscribe.
- `src/scenes/nativeFeel.js` -- NEW fail-safe boundary module: `HAPTIC_STYLE` constants (`HEAVY`/`MEDIUM`/`LIGHT`), `pulseHaptic(haptics, style)`, `acquireWakeLock(nav)`, `releaseWakeLock(sentinel)`. Injects the plugin/`navigator`; feature-detect + try/catch → no-op; never throws. Imports no `@capacitor/*`.
- `src/systems/ExtraLifeSystem.js` -- add `this.awardSeq = 0`; increment it once per life awarded inside the existing `fixedUpdate` loop (observability latch only — award timing/ordering unchanged).
- `src/systems/ScreenFeedbackSystem.js` -- add optional trailing `extraLifeSystem = null` param; seed `this._prevAwardSeq`; in `fixedUpdate`, edge-detect death → `HEAVY`, bomb → `MEDIUM`, extra-life `awardSeq` → `LIGHT`, pushing style constants into a reused `_hapticPulses` buffer; expose `drainHapticPulses(sink)` that calls `sink(style)` per pending pulse then clears (zero new alloc).
- `src/scenes/buildArenaWorld.js` -- pass `extraLifeSystem` as the 6th arg to `new ScreenFeedbackSystem(...)`.
- `src/scenes/ArenaScene.js` -- import `Haptics`; in `update()` drain haptic pulses via a stable bound sink and, when `!this._reducedMotion`, `pulseHaptic(Haptics, style)`; edge-triggered keep-awake using `decideKeepAwake` + `acquireWakeLock`/`releaseWakeLock`, tracking `this._displayAwake`; release the wake lock on `shutdown`.
- `src/main.js` -- capture `const game = new Phaser.Game(config)`; import `App`; call `wireNativeLifecycle` with a `controller` that resolves `game.scene.getScene('ArenaScene')`, computes run-active, and force-pauses / toggles via `togglePause` / `App.minimizeApp()`.
- `src/build/capacitorConfig.test.js` -- extend the required set to include `@capacitor/app` + `@capacitor/haptics` at major 8.
- `src/scenes/nativeLifecycle.test.js`, `src/scenes/nativeFeel.test.js` -- NEW: cover every I/O-matrix decision + boundary row (incl. absent/throwing globals).
- `src/systems/extraLifeSystem.test.js`, `src/systems/screenFeedbackSystem.test.js` -- extend for the `awardSeq` latch and the haptic-aggregation/drain rows.
- `src/scenes/renderIntegration.test.js` -- extend the source-text pins with the ArenaScene haptic reduced-motion guard + keep-awake wiring.

## Tasks & Acceptance

**Execution:**
- `package.json` -- add `@capacitor/app@^8` and `@capacitor/haptics@^8`; run `npm install` so the build resolves them.
- `src/scenes/nativeLifecycle.js` -- implement the three pure decisions + `wireNativeLifecycle` boundary (guarded registration, unsubscribe).
- `src/scenes/nativeFeel.js` -- implement `HAPTIC_STYLE`, `pulseHaptic`, `acquireWakeLock`, `releaseWakeLock` as fail-safe boundaries.
- `src/systems/ExtraLifeSystem.js` -- add the `awardSeq` latch (increment per award; no behavior change).
- `src/systems/ScreenFeedbackSystem.js` -- add the optional `extraLifeSystem` param, the three-edge haptic aggregation into a reused buffer, and `drainHapticPulses(sink)`.
- `src/scenes/buildArenaWorld.js` -- thread `extraLifeSystem` into `ScreenFeedbackSystem`.
- `src/scenes/ArenaScene.js` -- wire per-frame haptic drain (Reduced-Motion-guarded) and edge-triggered keep-awake; release on shutdown.
- `src/main.js` -- capture the game, import `App`, wire the lifecycle controller (auto-pause + back-button).
- `src/build/capacitorConfig.test.js` + `src/scenes/nativeLifecycle.test.js` + `src/scenes/nativeFeel.test.js` + `src/systems/extraLifeSystem.test.js` + `src/systems/screenFeedbackSystem.test.js` + `src/scenes/renderIntegration.test.js` -- add/extend to cover every I/O-matrix row and the ArenaScene wirings.

**Acceptance Criteria:**
- Given a run in progress, when the app is backgrounded or loses focus, then `decideBackgroundPause` returns true and the controller force-pauses `ArenaScene` (the run cannot die while away); a game-over or already-paused/title state is a no-op; and on return the run stays paused and resumes cleanly via the existing pause flag (no auto-resume). (FR23/FR15)
- Given an Android device, when the hardware back button fires, then `decideBackButton` returns `'pause'`/`'resume'` during a run and `'minimize'` otherwise, and the wiring calls the matching controller method — never `App.exitApp()`/an abrupt close. (FR23)
- Given death, bomb, and extra-life events, when each fires, then `ScreenFeedbackSystem` aggregates exactly one `HEAVY`/`MEDIUM`/`LIGHT` pending pulse and `ArenaScene` fires it via the Haptics boundary — suppressed entirely when `reducedMotion` is on, with the drain still emptying deterministically and no new per-frame allocation. (FR23, Story 6.1)
- Given an active run, when the player is mid-play, then `decideKeepAwake` is true and the wake lock is held; when paused, at game-over, or outside `ArenaScene`, then it is false and the lock is released; the wake-lock request/release happen only on the boolean edge, not per frame. (FR23)
- Given any absent or throwing host global (`App`, `Haptics`, `navigator.wakeLock`, `document`), when a boundary is exercised, then it degrades to a no-op and never throws — bootstrap, `create()`, and `update()` never crash.
- Given `npm install`, `npx vitest run`, and `npm run build`, when they execute, then the full existing suite plus the new/extended tests pass and the production build succeeds.
- Given a mid-range Android/iOS device via the Story 7.3 native build, when a run is played, then backgrounding auto-pauses, the back button pauses/resumes or safely backgrounds, death/bomb/extra-life buzz (unless Reduced Motion is on), and the screen stays awake only during play. **[Manual — not verifiable on this Linux host (no device/WebView); the automated gates above prove the pure decisions, the fail-safe boundaries, the haptic aggregation/suppression, and the keep-awake edge logic — same manual boundary as Stories 7.3/7.4.]**

## Spec Change Log

<!-- Append-only. Empty — no bad_spec loopback occurred. -->

## Review Triage Log

### 2026-07-21 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 10
- addressed_findings:
  - `[low]` `[patch]` `src/scenes/ArenaScene.js` — two load-bearing comments contradicted the code and each other: the top-of-`update()` comment claimed the haptic buffer drains at the top "while paused... deterministically," and the drain-site comment said it sits "ABOVE the pause gate's early return," but the drain is physically BELOW the pause return (co-located with the flash/shake consumes, so it runs only on non-paused frames — which is correct). Only keep-awake is at the top. A maintainer trusting "always drains while paused" could add a paused-frame pulse source or move the drain and strand/duplicate buzzes. Corrected both comments to describe the real structure; code unchanged (it was right). Flagged by the adversarial and intent-alignment layers.
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the keep-awake wiring was pinned only by a loose `/acquireWakeLock\(/` regex that bound neither the branch placement nor the `this._onWakeLockReleased` recovery arg, so dropping the arg (silently kills thermal/battery-saver re-acquire → screen sleeps mid-play) or swapping the acquire/release branches (screen sleeps during play, stays lit while paused) both shipped green. Tightened the pin to bind `acquireWakeLock(...this._onWakeLockReleased...)` inside the `if (desiredAwake) { ... } else { releaseWakeLock(this._wakeSentinel) }` structure; mutation-verified it now fails when the arg is dropped. (verification-gap layer)
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — `setPaused` is the sole pause entry point (keyboard handler + native background/back-button controller both route through it), and its whole purpose is zeroing `_flashMs`/`_trauma`/camera scroll so a mid-bomb background pause doesn't freeze a near-white overlay; yet the only tests reaching a `setPaused` call use a fake whose `setPaused` merely assigns `_paused`, so deleting any reset reintroduced the frozen-overlay bug with all tests green. ArenaScene cannot be imported headlessly (`phaser` throws `window is not defined`), so — per this file's source-text convention for the untestable adapter layer — added a pin asserting the settle fields are zeroed under `if (paused)`. (verification-gap layer)
- rejected (summary): wake-lock async-rejection never retries (`acquireWakeLock` returns the rejecting thenable, so `_displayAwake` latches true with no `release` event to recover) — the spec I/O matrix explicitly contracts "rejection → null / no-op, never throws" and frames keep-awake as a best-effort, disclosed on-device manual boundary that self-heals on the next pause/resume; a naive retry-on-rejection reintroduces the per-frame wake-lock calls NFR2 forbids, and cannot be device-verified on this Linux host. Wake-lock stale-release leak on rapid pause→resume (an old sentinel's async `release` event landing after a new sentinel is acquired flips `_displayAwake` false, leaking the new lock on the next re-acquire) — negligible impact: the leaked sentinel keeps the screen awake (not a sleep bug) and self-clears via the W3C visibility-hidden auto-release, requires a precise sub-frame async race, and the identity-tracking fix touches recovery machinery unverifiable here. Web-build haptics fire (`pulseHaptic` feature-detects `impact` but not `isNativePlatform`) — not a defect: `@capacitor/haptics`' web implementation degrades to `navigator.vibrate`/no-op, and the guarded-boundary shape is exactly what the spec contracts. Unguarded `resume()` lacking the `!gameOver` guard its siblings carry — defensive-only: `decideBackButton` never routes `resume` at game-over. Brittle `majors.has('8')` config test — it asserts exactly the spec-required Capacitor-8 major coherence; a future major upgrade updating it is normal. Re-raised prior-pass rejections (unchanged rationale): back-at-game-over minimize vs navigate-to-title, `^8` vs `^8.4.2` version pin (tighter pin unsatisfiable), discarded `wireNativeLifecycle` unsubscribe / HMR leak, double background signal (`appStateChange` + `visibilitychange`, `forcePause` idempotent), no independent haptics toggle (explicit spec `Never`).

### 2026-07-21 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` `src/scenes/ArenaScene.js` / `src/main.js` — the programmatic pause paths (`forcePause`/`pause`) set `_paused` directly, skipping the render-juice settle the keyboard handler runs on enter-pause (`_flashMs=0`/`_trauma=0`/camera scroll=0). A background/back-button pause fired mid-bomb would freeze a near-white flash / held camera offset on the PAUSED overlay (mobile-only, so desktop tests never caught it). Extracted a public `ArenaScene.setPaused(paused)` seam that runs the settle on enter-pause; the keyboard handler and the lifecycle controller now both route through it. Flagged by the adversarial layer; confirmed against ArenaScene.js:640-645.
  - `[low]` `[patch]` `src/scenes/nativeFeel.js` — `pulseHaptic` wrapped `impact()` in try/catch but never `.catch()`ed the returned Promise (its wake-lock siblings do), so an async rejection on a device without a motor escaped as an unhandled rejection, violating the module's never-throws/never-leaks contract. Now swallows the thenable rejection; test added.
  - `[low]` `[patch]` `src/scenes/ArenaScene.js` — `drainHapticPulses` ran before `fixedTimestep.advance`, so a pulse produced by this frame's sim steps was delivered one render frame late and out of step with the flash/shake consume. Moved the drain to after the advance, co-located with the trauma/flash consumes, so the buzz lands on the same frame as its cue.
  - `[low]` `[patch]` `src/scenes/nativeFeel.js` / `src/scenes/ArenaScene.js` — the keep-awake edge-trigger latched `_displayAwake` on intent, so a platform-initiated wake-lock release (thermal/battery-saver) while still visible+playing was never re-acquired → the screen could sleep mid-run. `acquireWakeLock(nav, onRelease)` now attaches a guarded one-shot `release` listener; ArenaScene passes an `onRelease` that clears `_displayAwake` so the next frame re-acquires. Tests added. Flagged independently by the adversarial and edge-case layers.
  - `[low]` `[patch]` `src/scenes/buildArenaWorld.test.js` — no test observed the real `screenFeedbackSystem.extraLifeSystem === extraLifeSystem` linkage (only handle presence + order), so dropping/nulling the new 6th constructor arg would silently kill the extra-life LIGHT pulse. Added the linkage assertion. (verification-gap layer)
  - `[low]` `[patch]` `src/main.js` / `src/scenes/nativeLifecycle.js` — the lifecycle controller (the FR23 auto-pause/back-button branch logic) was only source-text-pinned. Extracted `makeLifecycleController(game, App)` into `nativeLifecycle.js` with a full unit-test suite against a fake game/scene/App; also made `pause()`/`resume()` explicit (`setPaused(true)`/`setPaused(false)`) instead of byte-identical toggles, dissolving the adversarial layer's "inert routing" finding. (verification-gap + adversarial)
  - `[low]` `[patch]` `src/scenes/nativeFeel.js` / `src/scenes/ArenaScene.js` — the Reduced-Motion haptic gate was inline in the sink (regex-pinned only), so an inverted/dropped guard (fire haptics when accessibility wants silence) had no failing test. Extracted a pure `emitHaptic(reducedMotion, haptics, style)`; both arms unit-tested. (verification-gap layer)
- rejected (summary): back-button at game-over minimizes the app rather than returning to title — intent authority only requires "never abruptly closes," which minimize satisfies (spec Design Notes); new-plugin version range `^8` "should match `^8.4.2`" — the suggested pin is UNSATISFIABLE (`@capacitor/app` tops out at 8.1.1, `@capacitor/haptics` at 8.0.2; these plugins version independently of core, so `^8` is the correct shared-major range, which the config test enforces); dev-only HMR unsubscribe-leak (discarded `wireNativeLifecycle` return) — no effect on the shipped native app, out of scope of the intent; double background signal (`appStateChange` + `visibilitychange`) — the AC names both explicitly and `forcePause` is idempotent via its `!_paused` guard; no independent haptics on/off toggle — explicit spec `Never` and intent resolves "the relevant feel setting" to Reduced Motion (no such toggle exists, Story 6.1); the intent-alignment "verification lands below the device surface" observation — the genuinely device-level half of each AC (real buzz/back-event/wake-lock/background-pause) is the disclosed manual boundary, identical to Stories 7.3/7.4, and its actionable sub-parts were addressed by the three verification-gap patches above.

## Design Notes

- **"Resumes cleanly on return" = stay paused, not auto-resume.** The AC's stated rationale is "so the player never dies while away." Auto-resuming the instant the app foregrounds would drop the player into live danger before their thumbs are ready — contradicting that purpose. So background force-pauses and foreground does nothing; "resumes cleanly" is satisfied by the existing bit-identical resume (Story 5.2) when the player dismisses the pause. This is the reading the rationale selects, not an open choice.
- **Back-at-root = minimize, not a confirm dialog.** The AC offers "pause/resume OR a safe exit-confirm" with the load-bearing invariant "rather than abruptly closing." The primary named mapping (pause/resume) covers the in-run case. At the title/settings/game-over root there is no modal infrastructure to build a confirm on; `App.minimizeApp()` backgrounds the app (like Home) — unambiguously safe, reversible, state-preserving, and standard Android — satisfying the invariant without scope creep. `exitApp()` is never called.
- **Why aggregate haptics in `ScreenFeedbackSystem`.** It already owns the death (`deathSeq`) and bomb (`shockwaveMs`) edge-detection and the "system exposes a latch, render loop polls" idiom. Adding the extra-life edge (via a new `awardSeq` on `ExtraLifeSystem`, its first observability latch) plus a `drainHapticPulses(sink)` reuses that machinery; the scene's Reduced-Motion guard mirrors shake/flash exactly (always consume, suppress only the output call). Injecting `extraLifeSystem` as an optional trailing param keeps existing positional callers/tests intact.
- **Why `navigator.wakeLock`, not a plugin.** Keep-awake needs no native plugin: the Screen Wake Lock API works in the Android WebView and iOS 16.4+ WKWebView, fits the guarded-browser-boundary pattern (like `mobileLayout` over `screen.orientation`), and avoids a community plugin whose Capacitor-8 compatibility is uncertain. It degrades to a no-op on unsupported hosts.
- **Boundary shape (mirror of `mobileLayout.lockLandscape`):**
  ```js
  export function pulseHaptic(haptics, style) {
    if (!haptics?.impact) return;          // feature-detect → no-op
    try { haptics.impact({ style }); }     // fire-and-forget
    catch { /* never throw — device/web fallback absent */ }
  }
  ```

## Verification

**Commands:**
- `npm install` -- expected: `@capacitor/app@^8` + `@capacitor/haptics@^8` resolve and install cleanly.
- `npx vitest run` -- expected: full suite green incl. the new `nativeLifecycle`/`nativeFeel` suites and the extended extra-life/screen-feedback/capacitor-config/render-integration suites; no regression in the existing ~897 tests.
- `npm run build` -- expected: production Vite build succeeds and `dist` is produced (the new plugin imports resolve).

**Manual checks (cannot run on this Linux host):**
- On a mid-range Android/iOS device via the Story 7.3 native build: background mid-run → auto-pauses, foreground → still paused, resumes cleanly; Android back → pause/resume in a run, safe background at title (never closes); death/bomb/extra-life produce short haptic pulses, silenced when Reduced Motion is on; the screen never auto-locks during play and does outside it.


## Auto Run Result

Status: done (follow-up review pass)

**Summary:** A fresh follow-up review pass over the already-`done` Story 7.5 spec (native lifecycle, back-button routing, haptics, keep-awake). Four review layers ran in parallel (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment). No `intent_gap` or `bad_spec` surfaced; the implementation holds. Three low-severity patches applied, ten findings rejected, zero deferred.

**Files changed this pass:**
- `src/scenes/ArenaScene.js` — corrected two contradictory load-bearing comments about the haptic-drain position (drain is BELOW the pause gate and runs only on non-paused frames; only keep-awake sits at the top). Executable code unchanged — it was already correct.
- `src/scenes/renderIntegration.test.js` — tightened the keep-awake source-text pin to bind the `this._onWakeLockReleased` recovery arg inside the `if (desiredAwake) {...} else { releaseWakeLock(this._wakeSentinel) }` structure (mutation-verified to fail when the arg is dropped), and added a pin asserting the `setPaused` render-juice settle zeroes `_flashMs`/`_trauma`/camera scroll under `if (paused)`.

**Review findings breakdown:** patch 3 (low 3); reject 10; defer 0; intent_gap 0; bad_spec 0. Details in the `## Review Triage Log` follow-up entry.

**Follow-up review recommendation:** false. Patched findings this pass: high 0, medium 0, low 3 → score = 3×0 + 1×3 = 3 (< 5).

**Verification performed:**
- `npx vitest run` — 974 tests passed (56 files), incl. the 2 new/tightened source-text pins.
- `npm run build` — production Vite build succeeded (`dist` produced; plugin imports resolve).
- Mutation check — dropping the `this._onWakeLockReleased` arg made the tightened keep-awake pin fail, then reverted.
- Manual on-device checks (haptics, keep-awake, back-button, framerate) remain the disclosed manual boundary — not verifiable on this Linux host (no device/WebView); not claimed here.

**Residual risks / artifacts:**
- Two rejected wake-lock robustness findings (async-rejection never retries; stale-release leak on rapid pause→resume) are real but narrow, self-healing code paths deemed out-of-scope on the spec's best-effort keep-awake boundary contract — see the triage log for the full rationale. They cannot be device-verified here.
- Residual uncommitted files left in place (not part of this review's code change): `_bmad-output/implementation-artifacts/sprint-status.yaml` (orchestrator-owned bmad-loop state) and this spec's post-commit `final_revision`/`## Auto Run Result` frontmatter/section updates (written after the reviewed commit `b782beb`, per the finalize ordering; the orchestrator folds these in).
