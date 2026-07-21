---
title: 'Touch Twin-Stick Controls'
type: 'feature'
created: '2026-07-21'
status: 'done'
baseline_revision: '03d5ab80ed387450a0a274395b7e992c92dbc2a6'
final_revision: 'ea9163f0352bc488471309619f9a1de154bdfec6'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The twin-stick core is unreachable on a phone — every input path (gamepad, keyboard, mouse) requires hardware a touch-only player does not have, so move, aim, auto-fire, and bomb are all unusable. This is Epic 7's spine: touch feel must be proven in the browser before any native wrapping cost is incurred.

**Approach:** Add a third input method (`INPUT_METHOD.TOUCH`) that plugs into the existing Phaser-free `InputState` seam. Left-half touch spawns a floating virtual move stick, right-half spawns a floating aim stick (held → auto-fire), and an on-screen button latches a smart bomb. A new Phaser-free model/math module holds all the logic (unit-tested); `PlayerInputSampler` gains a touch event + sampling branch and hot-swaps via the extended sticky `resolveActiveMethod`; `ArenaScene` renders the overlay. Movement, firing, and bomb systems are untouched.

## Boundaries & Constraints

**Always:**
- Touch feeds gameplay ONLY through `InputState.setMove` / `setAim` / `queueBomb` — the same seam the gamepad/kbm paths use. Move is clamped to the unit circle and aim normalized to a unit direction by those existing methods; do not re-implement that math.
- Left screen half = floating move stick; right half = floating aim stick. Each stick's base anchors at its first-touch point (floating, not fixed); deflection = current − base.
- The smart-bomb button latches exactly one bomb per tap via `queueBomb`, regardless of hold duration or how many render frames the finger stays down (parity with the keyboard/gamepad edge latch).
- Extend `resolveActiveMethod` to three methods with the SAME sticky rule generalized: exactly one device active this frame → switch to it; zero or more than one active → keep `prev`. This must stay byte-for-byte backward compatible with the existing two-method tests.
- Touch input must NOT also read as keyboard/mouse activity: gate the pointer-move/pointer-down signal in `isKbmActive` on `pointer.pointerType !== 'touch'` so a thumb never counts as the mouse (no cross-device aim bleed).
- Leaving touch (another device takes over) or lifting all fingers writes move → (0,0) and aim → inactive, so nothing bleeds across the swap.
- `PlayerInputSampler` stays the SOLE Phaser input boundary; the touch model + math stay Phaser-free and unit-tested, matching the `inputMath` / `inputMethod` convention.
- No new per-frame allocation in the sample path (NFR2/NFR9): reuse persistent state objects.

**Block If:**
- The pinned Phaser version cannot distinguish touch from mouse pointers (no `pointerType`/`wasCanceled` surface) or cannot deliver simultaneous multi-touch pointers — the two-thumb + bomb requirement is then unsatisfiable without a decision. HALT `blocked` with that condition.

**Never:**
- No edits to `PlayerMovementSystem`, `FiringSystem`, `BombSystem`, or the write-API semantics of `InputState` (NFR8).
- No responsive layout, landscape lock, or safe-area insets (Story 7.2); no Capacitor/native shell, haptics, or lifecycle (Stories 7.3–7.5). Fixed logical-coordinate placement is sufficient here.
- No per-controller remap tables or gesture recognizers beyond the two sticks + one button.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Move stick drag | down at left-half (200,400), move to (200+R,400), stick radius R | base=(200,400); `setMove` called with deflection → `moveX≈1, moveY≈0` (clamped to unit circle) | n/a |
| Aim stick drag up | down at right-half (900,300), move to (900,240) | aim stick base set; `setAim` → `aimX≈0, aimY≈-1`, `aimActive=true` (auto-fire) | n/a |
| Aim held, thumb returns to center | after deflecting up, current ≈ base while still held | retains last non-zero dir (0,-1); `aimActive` stays true (keeps firing while held) | n/a |
| Aim pressed, never deflected | down at right-half, no movement, held | no aim direction yet → aim inactive (no firing in an undefined direction) until first deflection | n/a |
| Bomb button tap held 1s | pointerdown inside bomb button rect, held many frames, then up | exactly ONE `queueBomb()` on the down edge; no re-latch while held; no aim stick spawned | n/a |
| Two thumbs at once | move pointer (id A, left half) + aim pointer (id B, right half) simultaneously | move and aim resolved independently from their own pointers; no interference | n/a |
| All fingers lifted | pointerup for the move and aim pointers | `moveX/Y=0`; aim cleared/inactive | n/a |
| Touch then real mouse | touch active, then a genuine mouse move (`pointerType==='mouse'`) | touch pointers don't set `kbmActive`; method flips to KBM only once touch is inactive — no aim bleed either way | n/a |

</intent-contract>

## Code Map

- `src/input/inputMethod.js` -- add `INPUT_METHOD.TOUCH`; generalize `resolveActiveMethod` to the 3-way sticky rule.
- `src/input/touchControls.js` -- NEW, Phaser-free: floating-stick + bomb-button model (`TouchControlState` or equivalent) driven by pointer id/down/move/up; exposes move vector, aim vector (+active), bomb latch, per-frame touch-activity flag, and a render snapshot (base + current positions per stick, bomb rect/pressed).
- `src/input/PlayerInputSampler.js` -- wire multi-touch pointer events into the touch model; add a TOUCH branch to `sampleMove`/`sampleAim`/`sampleBomb`; feed `touchActive` into `resolveActiveMethod`; gate `isKbmActive` on `pointerType`.
- `src/scenes/ArenaScene.js` -- request extra pointers (`this.input.addPointer(2)`), add a touch-overlay graphics object, draw it each active render frame from the sampler's snapshot (and clear it when no touch is active / on pause).
- `src/scenes/touchOverlay.js` -- NEW: thin draw helper `drawTouchOverlay(graphics, snapshot, style)` (base ring + thumb knob per active stick, bomb button).
- `src/config/constants.js` -- touch stick max radius, small origin deadzone, bomb-button geometry (logical coords), and overlay colors/alpha.
- `src/input/touchControls.test.js` -- NEW: unit-test the model + I/O matrix.
- `src/input/inputMethod.test.js` -- extend: 3-way sticky + backward-compat cases.
- `src/input/PlayerInputSampler.test.js` -- extend the harness with pointer-event firing (`scene.input.on`, `addPointer`, `pointerType`) and cover the touch sampling + hot-swap paths.

## Tasks & Acceptance

**Execution:**
- `src/input/inputMethod.js` -- add `TOUCH: 'touch'` to `INPUT_METHOD`; rewrite `resolveActiveMethod(prev, {gamepadActive, kbmActive, touchActive})` as "exactly-one-active switches, else keep prev" -- one seam for all three devices, preserving existing two-method behavior.
- `src/config/constants.js` -- add `TOUCH_STICK_MAX_RADIUS`, `TOUCH_STICK_DEADZONE`, `TOUCH_BOMB_BUTTON` geometry (center + radius in logical space), and touch overlay colors/alpha -- centralize tunables (no magic numbers in logic).
- `src/input/touchControls.js` -- NEW: implement the floating-stick + bomb model. `onPointerDown(id, x, y)` classifies by half (left→move, right→aim) unless the point is inside the bomb rect (→ latch one bomb, no stick); `onPointerMove(id, x, y)` updates the owning stick's current point; `onPointerUp(id)` releases it. Expose `moveVector()` (deflection/MAX_RADIUS), `aimVector()` (unit dir; retains last non-zero while the aim stick is held, inactive before first deflection), `consumeBomb()`-style latch, `isActive()`, and a `snapshot()` for rendering. Reuse `inputMath` helpers where they fit -- keep it Phaser-free and allocation-stable.
- `src/input/PlayerInputSampler.js` -- construct/own a touch model; register `scene.input.on('pointerdown'|'pointermove'|'pointerup'|'pointerupoutside', ...)` guarded on `pointer.pointerType === 'touch'` (and the `_paused` freeze, like the gamepad bomb listener); compute `touchActive`; pass it into `resolveActiveMethod`; add the TOUCH branch to `sampleMove`/`sampleAim` (write from the model, clear on release) and route the model's bomb latch through `this.input.queueBomb()` in `sampleBomb`; exclude touch pointers from `isKbmActive` -- integrate touch as a pure input source with zero downstream changes.
- `src/scenes/touchOverlay.js` -- NEW: `drawTouchOverlay(graphics, snapshot, style)` clears and redraws the base ring + thumb knob for each active stick and the bomb button -- isolates Phaser draw calls from the model.
- `src/scenes/ArenaScene.js` -- `this.input.addPointer(2)` for multi-touch; add `this.touchOverlayGraphics` next to the other graphics objects; after `inputSampler.sample()` each frame call the draw helper with the sampler snapshot; clear the overlay when touch is inactive -- surfaces the controls without touching sim logic.
- `src/input/touchControls.test.js`, `src/input/inputMethod.test.js`, `src/input/PlayerInputSampler.test.js` -- add/extend unit tests covering every I/O-matrix row, the 3-way sticky resolution (incl. backward compat), and the sampler touch+hot-swap paths.

**Acceptance Criteria:**
- Given a touch device, when the player presses and holds on the left half and deflects, then a floating move stick anchors at the touch point and `InputState.moveX/moveY` follow the deflection clamped to the unit circle (a diagonal is never faster than a cardinal).
- Given a right-half press-hold, when the aim stick is deflected, then `InputState.aimActive` is true and `aimX/aimY` is the unit deflection direction, driving auto-fire independently of the move channel; while the finger stays down the aim persists (last non-zero direction) and clears only on release.
- Given the touch path, when it samples each render frame, then it writes solely through `InputState` via a new `INPUT_METHOD.TOUCH` branch in `resolveActiveMethod` plus a touch sampling path, with no diff to the movement, firing, or bomb systems.
- Given the on-screen smart-bomb button, when the player taps it (however briefly or long), then exactly one bomb is latched through `queueBomb`/`consumeBomb` per tap.
- Given the player switches between touch and gamepad/keyboard/mouse, when touch activity begins or ends, then the active method hot-swaps without a restart and with no cross-device aim bleed (a thumb never registers as the mouse, and a released stick does not snap aim to a stale device).
- Given the full test + build gates, when `npx vitest run` and `npm run build` execute, then all input/scene tests pass and the production build succeeds.

## Spec Change Log

_No spec amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-21 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 3
- reject: 10
- addressed_findings:
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the idempotent multi-touch pointer-pool raise (`TOUCH_POINTER_TARGET - manager.pointersTotal`, shortfall-guarded `addPointer`) in `ArenaScene.create()` was unpinned; a regression to an unconditional `addPointer(N)` (pileup to Phaser's cap of 10 across restarts) or a miscomputed shortfall (multi-touch silently fails) would pass the whole suite. Added a source-text pin asserting the target-3 shortfall computation and guarded add.
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the pause-edge touch reconciliation (`this.touchOverlayGraphics.clear()` + `this.inputSampler.resetTouch()` then `return`) was unpinned; dropping/reordering it re-opens the stranded-stick / bomb-latched-on-resume bug the prior pass fixed, with no test failing. Added a source-text pin asserting the consecutive clear→resetTouch→return sequence.
  - `[low]` `[patch]` `src/scenes/renderIntegration.test.js` — the render-frame overlay gate (`if (isTouchActive()) drawTouchOverlay(...) else clear()`) was unpinned; an inverted/dropped gate would draw the overlay over a kbm/gamepad session or never clear it on touch-release, uncaught (touchOverlay.test.js only proves the helper in isolation). Added a source-text pin asserting the `isTouchActive()`-gated draw and the else-clear. All three restore the repo's established `renderIntegration` ArenaScene-wiring convention (Stories 5.x/6.1/6.2/6.3) that Story 7.1 had skipped. `npx vitest run` (816 pass) + `npm run build` green after the change.
- rejected (summary): aim hold-to-fire / opposite return-to-center between the two sticks (by-design per intent — aim retains last non-zero while held, clears on release), move-stick deadzone-vs-gamepad rescale, accidental-bomb-on-mis-touch, touch-only-can't-pause, 3-pointer-headroom (×2 reviewers), no-stick-re-anchor-near-bezel, unrealistic-test-pointer-ids/id-recycle, overlay-shakes-with-camera (already documented; screen-space anchoring is Story 7.2), knob-visual-vs-deadzone, and second-finger-same-half handoff — all by-design-and-tested behaviors, cosmetics, or device-screen/reach/hybrid concerns the epic explicitly sequences to Stories 7.2/7.3.
- deferred (summary): held-finger-dead-after-pause/resume (hybrid keyboard+touch; needs resume-time re-seeding of still-down pointers), `wasTouch` discriminator has no real-Phaser integration test (mock-surface gap; needs e2e infra the repo lacks), and hybrid-device ghost-overlay drawn while `activeMethod !== TOUCH`. Appended as new entries to the deferred-work ledger.

### 2026-07-21 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` `src/scenes/ArenaScene.js` — `addPointer(2)` ran in `create()` every scene restart against the cumulative game-global pool (3→5→7→9→capped-10 with console warnings across a session of game-overs). Made the raise idempotent: add only the shortfall to a fixed target of 3 touch pointers (`manager.pointersTotal`), a no-op on restart.
  - `[medium]` `[patch]` Pause + touch strand — the `_paused` guard on the `pointerup`/`pointerupoutside` listeners swallowed the release edge, so a finger lifted during a (keyboard) pause left a stick `active` (ship drifts / bomb detonates on resume). Added `TouchControls.reset()` + `PlayerInputSampler.resetTouch()`, called in the ArenaScene pause branch; unit-tested at model and sampler level.
  - `[low]` `[patch]` `src/scenes/touchOverlay.test.js` — tautological `lineWidth: TOUCH_OVERLAY_STYLE.lineWidth` self-assertion; imported `TOUCH_OVERLAY_LINE_WIDTH` and asserted against it, plus a `lineStyle` draw-seam assertion so the width is observed.
  - `[low]` `[patch]` `src/scenes/ArenaScene.js` — overlay comment overclaimed the knob "follows its finger even while the camera shakes"; corrected to note the world-space draw drifts a few px during shake and that screen-space anchoring is Story 7.2.
  - `[low]` `[patch]` `src/input/PlayerInputSampler.test.js` — no diagonal over-radius touch-move test exercised the unit-circle clamp on the touch path; added one asserting `hypot(moveX, moveY) ≈ 1`.
- rejected (summary): touch-cancel strand and device-switch KBM-flip (disproved against Phaser 3.90 source — `TOUCH_CANCEL` emits `pointerup`, and the KBM flip only fires on genuine mouse activity); accidental-bomb / bare-tap-steals-method / stylus-fallback / move-deadzone-rescale / magic-number-84 / pointer-headroom / two-finger-bomb / second-finger-same-half / ArenaScene-glue-untested / intent-surface-mismatch (hybrid-device edges, cosmetics, by-design-and-tested behaviors, or descriptive notes whose device-screen/on-device concerns the epic explicitly sequences to Stories 7.2/7.3).

## Design Notes

- **Reuse, don't re-derive.** `InputState.setMove` already clamps to the unit circle and `setAim` already normalizes and treats a zero vector as "no aim". The touch model produces raw deflection/direction vectors and lets those methods do the clamping — identical semantics to the gamepad sticks.
- **Floating stick math:** `base` = first-touch point; `deflection = current − base`; move intent = `deflection / TOUCH_STICK_MAX_RADIUS` (then `setMove` clamps); aim = `normalize(deflection)`.
- **Aim-hold semantics:** the aim stick retains its last non-zero direction for as long as it is held (so "hold to fire" is literally true even as the thumb drifts back toward the origin), but stays inactive before the first non-zero deflection — mirroring the gamepad's centered-stick-doesn't-fire behavior at the instant of press. Release clears it.
- **`resolveActiveMethod` generalization (must preserve old tests):** count active devices; exactly one → that device; else keep `prev`. For two devices this is identical to today (`both` or `neither` → sticky).

```js
export function resolveActiveMethod(prev, { gamepadActive, kbmActive, touchActive }) {
  const active = [
    touchActive && INPUT_METHOD.TOUCH,
    gamepadActive && INPUT_METHOD.GAMEPAD,
    kbmActive && INPUT_METHOD.KBM,
  ].filter(Boolean);
  return active.length === 1 ? active[0] : prev;
}
```

- **Coordinates:** operate in arena logical space (`pointer.worldX/worldY`), split at `ARENA_WIDTH / 2`, so the FIT+CENTER scaling maps touches correctly. Device-specific placement, thumb reach, and safe areas are explicitly Story 7.2.

## Verification

**Commands:**
- `npx vitest run src/input src/scenes` -- expected: all input + scene unit tests pass, including the new touch and extended sticky-method suites.
- `npm run build` -- expected: production Vite build succeeds with no errors.

**Manual checks:**
- In a browser with device/touch emulation on: dragging the left half moves the ship in the deflected direction; dragging the right half aims and continuously fires; the bomb button detonates exactly once per tap even when held; using two thumbs moves and aims independently; then moving the real mouse cleanly retakes aim with no leftover touch aim (and vice-versa) — no restart required.

## Auto Run Result

Status: done (follow-up review pass — 2026-07-21)

**Summary of change reviewed:** The shipped Story 7.1 touch twin-stick implementation (`INPUT_METHOD.TOUCH`: floating move/aim sticks, on-screen bomb button, 3-way sticky `resolveActiveMethod`, Phaser-free touch model + overlay). This was a fresh follow-up review of an already-`done` spec (the prior pass set `followup_review_recommended: true`). Four review layers ran in parallel (blind-hunter, edge-case-hunter, verification-gap, intent-alignment).

**Files changed this pass:**
- `src/scenes/renderIntegration.test.js` — added a "touch twin-stick wiring (Story 7.1)" describe block (3 source-text pins) restoring the repo's established ArenaScene-wiring convention.

**Review findings breakdown:** intent_gap 0, bad_spec 0, patch 3 (all low), defer 3, reject 10.
- **Patched (3, low):** pinned the idempotent multi-touch pointer-pool raise, the pause-edge touch reconciliation (clear overlay + `resetTouch` → return), and the render-frame overlay draw/clear gate — all previously unpinned ArenaScene glue that a regression could break while the whole suite stayed green.
- **Deferred (3):** held-finger dead after pause/resume (hybrid kbm+touch; needs resume-time pointer re-seed); `wasTouch` discriminator lacks a real-Phaser integration test (mock-surface gap, no e2e infra in repo); hybrid-device ghost overlay drawn while `activeMethod !== TOUCH`. Appended as new entries to `deferred-work.md`.
- **Rejected (10):** by-design-and-tested behaviors (aim hold-to-fire, opposite return-to-center), and device-screen/reach/hybrid/cosmetic concerns the epic explicitly sequences to Stories 7.2/7.3 (accidental-bomb, deadzone rescale, pointer headroom ×2, edge re-anchor, overlay shake, knob visual, second-finger-same-half, touch-only-can't-pause, test-pointer-ids).

**Follow-up review recommendation:** `false`. Patched findings this pass: high 0, medium 0, low 3 → score = 3×0 + 1×3 = 3 (< 5), no high. (Down from the prior pass's `true`, indicating convergence.)

**Verification performed:**
- `npx vitest run` → 816 passed (51 files); `renderIntegration.test.js` now 21 tests (+3 new pins).
- `npm run build` → production Vite build succeeded (73 modules, no errors).

**Residual artifacts (in `git status`, not part of the committed change):**
- `spec-7-1-touch-twin-stick-controls.md` — the `final_revision`/status finalize edits + this Auto Run Result, left as a working-tree edit per the repo convention (the orchestrator absorbs the spec).
- `sprint-status.yaml` — pre-existing uncommitted orchestration file, not touched by this pass.

**Residual risks:** The 3 deferred items are real but out of scope (hybrid-device / pause-seam / e2e-infra concerns the epic sequences to 7.2+). The core touch path remains fully unit-covered and the newly pinned ArenaScene glue is now regression-guarded.

Commit: `ea9163f` (follow-up patch); reviewed code diff already in history at `b74b82f` (baseline `03d5ab8`).

