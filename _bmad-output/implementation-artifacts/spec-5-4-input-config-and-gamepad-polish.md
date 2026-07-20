---
title: 'Input Config and Gamepad Polish'
type: 'feature'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true # follow-up-2 pass patched 1 medium + 2 low → score 3×1+1×2 = 5 (≥5)
context: []
warnings: [oversized]
baseline_revision: '0aff09a7234e20aad35b9755fe54e7e72c520969'
final_revision: 'ce558a5e6ca3d86e9ef85ffc2f1dd95d3b09c34f'
---

<intent-contract>

## Intent

**Problem:** The twin-stick input path (built in Stories 1.2/1.3) works but was never finalized for Epic 5: both sticks share one untuned `INPUT_DEADZONE`; hot-swap between gamepad and keyboard/mouse is only an implicit per-channel fall-through with a real feel defect (once the mouse has ever been engaged, a gamepad player who releases the right stick has their aim snap to the stale cursor position — cross-device aim bleed); the codebase explicitly defers gamepad smart-bomb to "Epic 5 input polish," so a gamepad-only player literally cannot detonate a bomb; and none of the hot-swap / device-selection logic is unit-tested. This is the story the epic and Story 5.3 designate to own gamepad polish and input config (FR16).

**Approach:** Centralize and tune the deadzones into separate `MOVE_DEADZONE` / `AIM_DEADZONE` constants (aim slightly larger so a resting right stick never rotates the fire vector). Introduce a Phaser-free, unit-tested **active-input-method seam** (`inputMethod.js`) that decides which device (gamepad vs keyboard/mouse) is currently driving from per-frame activity, making hot-swap explicit and eliminating cross-device aim bleed. Add gamepad smart-bomb (either bumper) via a pure button helper, mirroring the existing keyboard latch. All decision logic lives in pure seams; `PlayerInputSampler` stays the thin Phaser boundary and remains the repo's disclosed manual-verification surface.

## Boundaries & Constraints

**Always:**
- Keep move and aim as two independent channels feeding the existing `InputState` (`setMove`/`setAim`/`clearAim`/`queueBomb`); the `PlayerMovementSystem`, `FiringSystem`, and `BombSystem` are untouched — they already read only `InputState`.
- Resolve the active input method every frame via `resolveActiveMethod(prev, { gamepadActive, kbmActive })`: gamepad-only-active → `GAMEPAD`; kbm-only-active → `KBM`; both active or neither active → keep `prev` (sticky). Seed the sampler's method to `KBM` (keyboard/mouse is the baseline until a pad shows activity).
- `gamepadActive` this frame = a pad is present AND (left stick past `MOVE_DEADZONE` OR right stick past `AIM_DEADZONE` OR a bomb button pressed). `kbmActive` this frame = any WASD/arrow key down OR the bomb key down OR the pointer moved since last frame OR the pointer is down.
- Gate the channels by the resolved method: when `GAMEPAD` and a pad is present, move = left stick (deadzoned; below deadzone → no move, no keyboard fall-through) and aim = right stick (deadzoned; centered → `clearAim`, firing stops — no mouse bleed). Otherwise move = keyboard and aim = mouse (preserving the existing `activePointer` engaged-gate so aim stays inactive until the mouse is actually used). If the pad disappears while method is `GAMEPAD`, both channels fall back to keyboard/mouse defensively.
- Apply the radial deadzone with the per-channel constant (`MOVE_DEADZONE` for the left stick, `AIM_DEADZONE` for the right stick) through the existing `applyRadialDeadzone`; a resting stick still produces exactly zero (no drift).
- Gamepad smart-bomb latches through the same `InputState.queueBomb()` seam the keyboard uses (one press → at most one detonation), triggered on the button's just-pressed edge via the gamepad `'down'` event, filtered by the pure `isBombButton(index)` helper (either bumper). Never poll-and-re-queue every frame.
- Centralize every new tunable in `src/config/constants.js` (`MOVE_DEADZONE`, `AIM_DEADZONE`, `GAMEPAD_BOMB_BUTTONS`), replacing `INPUT_DEADZONE`; no inline magic values in the sampler.
- Unit-test the pure seams (`resolveActiveMethod`, `isBombButton`); the sampler's Phaser wiring stays on the manual-verification boundary per the established repo convention.

**Block If:**
- (none anticipated — additive pure seams + tuning over an established, single-consumer input path; no ambiguous decision requires a human.)

**Never:**
- Do NOT change `InputState`'s public shape or any consuming system's math/behavior; the move/aim/bomb contracts stay byte-compatible.
- Do NOT add input remapping UI, a controls-config screen, or gamepad menu navigation (title/settings/pause/game-over stay keyboard+pointer+existing-gamepad-start only). "Input config" here means centralized/tuned input constants, not a rebinding surface.
- Do NOT alter Story 5.3 settings, Story 5.2 pause, scene flow, scoring, pooling, or any non-input system.
- Do NOT auto-fire toward a stale/uninitialized pointer, and do NOT let a connected-but-idle pad suppress keyboard/mouse.

## I/O & Edge-Case Matrix

`resolveActiveMethod(prev, { gamepadActive, kbmActive })` in the pure `inputMethod.js` seam (methods: `KBM`, `GAMEPAD`):

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|-----------------|----------------|
| Pick up gamepad | `('kbm', {gamepadActive:true, kbmActive:false})` | `'gamepad'` | — |
| Return to keyboard/mouse | `('gamepad', {gamepadActive:false, kbmActive:true})` | `'kbm'` | — |
| Gamepad held, no new input | `('gamepad', {gamepadActive:false, kbmActive:false})` | `'gamepad'` (sticky) | — |
| Both devices active same frame | `('gamepad', {gamepadActive:true, kbmActive:true})` | `'gamepad'` (keep prev) | — |
| Idle from baseline | `('kbm', {gamepadActive:false, kbmActive:false})` | `'kbm'` (sticky) | — |

`isBombButton(index)`: `4 → true`, `5 → true` (either bumper), `0 → false`, `undefined → false`.

`applyRadialDeadzone` with split constants (existing pure fn, unchanged): right stick magnitude `0.27` with `AIM_DEADZONE = 0.30` → `(0,0)` (no aim); left stick magnitude `0.27` with `MOVE_DEADZONE = 0.25` → non-zero (moves) — the split is observable.

</intent-contract>

## Code Map

- `src/input/PlayerInputSampler.js` -- the thin Phaser input boundary. `sample()` calls `sampleMove(pad)`/`sampleAim(pad)`/`sampleBomb()`; `getPad()` returns pad-or-null; keyboard keys bound in ctor (adds bomb=Shift). EDIT: track/resolve `activeMethod`, gate move/aim by it, add gamepad-bomb listener, use split deadzone constants.
- `src/input/InputState.js` -- Phaser-free render↔sim seam (`setMove`/`setAim`/`clearAim`/`queueBomb`/`consumeBomb`). UNCHANGED (reused).
- `src/input/inputMath.js` (+`.test.js`) -- pure `applyRadialDeadzone`/`clampToUnitCircle`/`normalizeToUnit`. UNCHANGED (reused with the two new deadzone constants). ADD `isBombButton` here (or in the new seam) with tests.
- `src/config/constants.js` -- `INPUT_DEADZONE = 0.25` at line 53 (imported only by the sampler). REPLACE with `MOVE_DEADZONE`/`AIM_DEADZONE`; ADD `GAMEPAD_BOMB_BUTTONS`.
- `src/scenes/ArenaScene.js` -- lines ~173-175 construct `InputState` + `PlayerInputSampler`; line ~826 calls `this.inputSampler.sample()` each render frame. UNCHANGED wiring (sampler API stable).
- `src/scenes/TitleScene.js` -- line ~145 `this.input.gamepad?.on('down', start)` is the reference pattern for edge-based gamepad button handling. Reference only.
- `src/systems/{PlayerMovementSystem,FiringSystem,BombSystem}.js` -- consume `InputState` only (`moveX/moveY`, `aimActive/aimX/aimY`, `consumeBomb`). UNCHANGED.

## Tasks & Acceptance

**Execution:**
- `src/input/inputMethod.js` -- NEW pure Phaser-free seam. Export `INPUT_METHOD` (`KBM:'kbm'`, `GAMEPAD:'gamepad'`) and `resolveActiveMethod(prev, { gamepadActive, kbmActive })` implementing the I/O matrix (gamepad-only→GAMEPAD, kbm-only→KBM, both/neither→`prev`). No Phaser import.
- `src/input/inputMethod.test.js` -- NEW vitest: every I/O-matrix row for `resolveActiveMethod`, including sticky-on-contention and sticky-on-idle.
- `src/input/inputMath.js` -- ADD pure `isBombButton(index)` returning `GAMEPAD_BOMB_BUTTONS.includes(index)` (guards non-numeric/undefined → false). (Placing it beside the other pure input helpers.)
- `src/input/inputMath.test.js` -- ADD cases for `isBombButton` (both bumpers → true; face/stick/undefined → false).
- `src/config/constants.js` -- REPLACE `INPUT_DEADZONE` with `MOVE_DEADZONE = 0.25` and `AIM_DEADZONE = 0.30` (documented: aim larger so a resting/brushed right stick never rotates fire; both feed the radial deadzone). ADD `GAMEPAD_BOMB_BUTTONS = [4, 5]` (standard-mapping bumper indices; either fires the bomb, mirroring "either Shift").
- `src/input/PlayerInputSampler.js` -- EDIT: (1) import `MOVE_DEADZONE`/`AIM_DEADZONE`/`GAMEPAD_BOMB_BUTTONS`, `resolveActiveMethod`/`INPUT_METHOD`, `isBombButton`; drop `INPUT_DEADZONE`. (2) init `this.activeMethod = INPUT_METHOD.KBM` and `this._lastPointerMoveTime = 0`. (3) in `sample()`, compute `gamepadActive`/`kbmActive` for the frame and set `this.activeMethod = resolveActiveMethod(this.activeMethod, {...})` before sampling channels. (4) `sampleMove`: use left stick with `MOVE_DEADZONE` only when `activeMethod===GAMEPAD` and a pad is present (below deadzone → `setMove(0,0)`, no keyboard fall-through); otherwise keyboard branch (unchanged). (5) `sampleAim`: use right stick with `AIM_DEADZONE` only when `activeMethod===GAMEPAD` and a pad is present (centered → `clearAim`); otherwise the existing mouse-with-engaged-gate branch. (6) register `scene.input.gamepad?.on('down', (pad, button) => { if (isBombButton(button.index)) this.input.queueBomb(); })` in the ctor (keyboard `sampleBomb` unchanged). Update the header comment to describe active-method gating.

**Acceptance Criteria:**
- Given a connected gamepad, when the player uses the left and right sticks, then the ship moves and aims/fires with the tuned per-channel deadzones and a resting stick produces zero movement/aim (no drift). (FR16)
- Given no gamepad (or the player is on keyboard/mouse), when they use WASD/arrows and the mouse, then WASD/arrows move and the mouse aims and fires as a complete fallback. (FR16)
- Given the player is mid-session on one input method, when they start using the other device, then control hot-swaps to it within a frame with no restart; and a gamepad player who has previously touched the mouse does NOT have their aim snap to the stale cursor when the right stick is released (aim stops instead). (FR16)
- Given a connected gamepad, when the player presses a bumper, then a smart bomb detonates exactly once per press, at parity with the keyboard Shift bomb (one press → at most one detonation).
- Given the pure `inputMethod.js` and `isBombButton` seams under vitest, when they run, then `resolveActiveMethod` returns exactly the I/O-matrix value for every listed case and `isBombButton` is true only for the configured bumper indices.

## Spec Change Log

_No bad_spec loopbacks — spec unchanged through review (0 intent_gap, 0 bad_spec). All review findings resolved as in-diff patches or deferrals._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 1: (high 0, medium 1, low 0)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[medium]` `[patch]` On a mid-play gamepad disconnect the sampler stayed sticky-`GAMEPAD` while `getPad()` returned null, so `sampleAim`'s `GAMEPAD && pad` guard failed and fell through to the mouse — snapping aim to the stale cursor and auto-firing there (reviving the exact cross-device bleed this story fixes, violating the intent-contract "Never: no stale-pointer autofire"). Fix: `sampleAim` now, on `GAMEPAD && !pad`, `clearAim()`s and returns; the mouse re-acquires aim only after a real mouse move flips the method to KBM. Regression-guarded by a new sampler test (case d).
  - `[medium]` `[patch]` The story's core sampler behavior (active-method gating, the centered-stick `clearAim` bleed-fix, the disconnect fix, the gamepad-bomb listener) had zero test coverage — verified only in prose — so a regression would ship green. Added `src/input/PlayerInputSampler.test.js` driving `sample()` over a mocked Phaser surface and asserting on the Phaser-free `InputState`: gating with no keyboard leak, centered-stick aim-clear, KBM↔GAMEPAD hot-swap, disconnect aim-clear, and one-bomb-per-bumper-press.
  - `[low]` `[patch]` `_lastPointerMoveTime` was seeded to `0`, but `activePointer.moveTime` survives a scene restart, so the first post-restart frame read a stale timestamp as a fresh mouse move → one frame of false KBM activation (a gamepad player got one frame of stale-cursor aim). Fix: seed it from the live `activePointer.moveTime` in the constructor.
  - `[low]` `[patch]` The deadzone-split test hardcoded the probe magnitude `0.27`, coupling it to the current constant values (a legitimate re-tune would break a pure-math test). Fix: derive the probe from the constants (`(MOVE_DEADZONE + AIM_DEADZONE) / 2`) so the assertion tests the relationship, not frozen numbers; removed the superseded hardcoded test.
- deferred: 1 — the gamepad bomb binding and stick reads assume the W3C "standard" mapping without a `pad.mapping` guard (a pre-existing whole-input-path assumption Story 5.4 extends to the new bomb binding; non-standard pads may misbind the bomb). Logged to the deferred-work ledger.
- rejected (8): ungated bomb on both devices (intended parity — keyboard Shift is equally always-live; a bumper press is deliberate input); a bomb-button press flipping the active method mid-still-mouse and clearing aim for one self-healing frame (niche: requires a pad connected during kbm play with the mouse held dead-still); "sticky on contention" blocking hot-swap while both devices overlap (deliberate anti-thrash design — a clean handoff releases the old device); `activeMethod` "lying" for hypothetical future consumers after disconnect (no current consumer; the real aim consequence is fixed by the patch above); pointer `moveTime` same-millisecond/still-mouse edge (stickiness keeps a still mouse aiming); `isBombButton` placed in `inputMath.js` (spec-sanctioned placement; cosmetic); gamepad `'down'` listener lacking self-teardown (reviewer verified Phaser's `GamepadPlugin.shutdown()` `removeAllListeners()` fires on scene shutdown — no current leak); per-frame deadzone recomputation across the activity check and channel writer (negligible; same helper + constants, no real drift risk).

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` The async gamepad `'down'` bomb listener bypassed Story 5.2's pause freeze: `ArenaScene.update()` returns before `sample()` when `_paused` (freezing the keyboard Shift bomb), but the event-driven listener still fired, so a bumper press while paused latched a `queueBomb()` that detonated on resume — asymmetric with the frozen keyboard and a wasted limited resource. Fix: gate the listener on `!this.scene._paused`, mirroring the exact invariant the update loop enforces (input-layer only; pause behavior untouched). Regression-guarded by new sampler test (i).
  - `[medium]` `[patch]` The per-channel deadzone split (the headline AC: a brushed right stick must NOT rotate aim while the same-magnitude left stick still moves) was verified only at the pure `applyRadialDeadzone` level with explicit args — no sampler test drove a stick magnitude in the (MOVE_DEADZONE, AIM_DEADZONE) = (0.25, 0.30) band, so swapping the two constants or reverting `sampleAim` to `MOVE_DEADZONE` would reintroduce the exact bug and ship green. Added sampler test (f): a constant-derived probe magnitude moves via the left stick but produces no aim via the right stick.
  - `[low]` `[patch]` The constructor's "seed `_lastPointerMoveTime` from the LIVE pointer, not 0" fix (which prevents one frame of false KBM activation for a gamepad player after a scene restart) had no test — every harness pointer started at `moveTime = 0`, so seed-from-live and seed-0 were indistinguishable. Added sampler test (g): harness constructed with `pointerMoveTime = 500`; asserts the seed and that a gamepad-only first frame is not hijacked to KBM.
  - `[low]` `[patch]` The `isGamepadActive` "held bomb button counts as gamepad activity" clause had zero coverage — test (e) exercised the separate constructor `'down'` listener, never populating `pad.buttons` for the activity check, so deleting the clause would ship green. Added sampler test (h): resting sticks + a held bumper resolves the method to GAMEPAD.
- rejected (11): stray/passive pointer-move flipping a resting gamepad player to KBM (spec explicitly defines "the pointer moved since last frame" as a KBM-activity signal — this is the designed hot-swap, not bleed); single global `activeMethod` removing mixed-device play like gamepad-move + mouse-aim (the intent-contract explicitly gates BOTH channels by one resolved method); a mouse nudge during pause flipping to KBM on the first resume frame (the pause overlay has no mouse UI, the pointer-move→KBM result is spec-consistent and self-heals on the next stick input, and a "correct" guard would reach into the explicitly walled-off Story 5.2 pause path); the bomb listener firing for any connected pad rather than only `getPad(0)` (two simultaneous controllers is out of scope for this single-player twin-stick game); the `'down'` listener lacking self-teardown (re-verified from the prior pass — Phaser's `GamepadPlugin.shutdown()` `removeAllListeners()` fires on scene shutdown, no leak on the `scene.restart()` game-over path); a held mouse button vetoing hot-swap (spec defines "the pointer is down" as a KBM signal); a stuck/held bumper pinning the method to GAMEPAD (spec defines a held bomb button as gamepad activity); the disconnect move/aim asymmetry where move falls through to the keyboard while aim clears (documented benign — no keys held → zero move); per-frame deadzone recomputation across the activity check and channel writers (prior-rejected; negligible, same helper + constants); `isBombButton` living in `inputMath.js` (spec-sanctioned placement); `GAMEPAD_BOMB_BUTTONS` exported unfrozen (cosmetic — no code mutates it).

### 2026-07-20 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 1: (high 0, medium 1, low 0)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The story's disconnect defense rested on a false Phaser assumption. Verified against Phaser 3.90 source: `GamepadPlugin.refreshPads()` does `if (!livePad) continue;` on the null navigator slot a disconnected pad reports — it never removes the pad from `this.gamepads`, so `total` stays ≥1 and `getPad(0)` keeps returning a STALE pad with frozen stick/button values. The sampler's `if (!pad) clearAim()` fallback (and test `(d)`, which used `pad:null`) therefore never fired on a real disconnect: a right stick deflected at the moment of disconnect read as ongoing gamepad activity forever, locking the ship into sticky-GAMEPAD, auto-firing a frozen direction with the mouse unable to recover (both-active → sticky). Fix: `getPad()` now guards on the live `pad.connected` flag (Phaser's `Gamepad.connected` → `this.pad.connected`), returning null for a dead pad so both channels fall back defensively per the intent. Regression-guarded by new sampler test `(j)` (retained `connected:false` pad with a frozen deflected stick → aim clears, and a subsequent mouse move recovers to KBM instead of locking).
  - `[low]` `[patch]` The `isGamepadActive` right-stick branch (aim-only gamepad acquisition from the KBM baseline) was never the sole trigger in any test — tests `(c)`/`(g)` co-push the left stick, `(b)`/`(f)` pre-set the method, `(h)` uses a button — so a regression in that branch (deletion, or reuse of the wrong deadzone) would ship green. Added sampler test `(k)`: a resting left stick + active right stick from the KBM baseline acquires GAMEPAD and aims.
  - `[low]` `[patch]` The `isKbmActive` keyDown and `p.isDown` branches were never asserted as the KBM-acquisition source — the GAMEPAD→KBM flip was only ever driven by `pointer.moveTime` (test `(c)`) — so a regression dropping either term would leave a player who sets the pad down and switches to WASD (or holds a mouse button) stuck in sticky-GAMEPAD with dead controls, still green. Added sampler tests `(l)` (movement key flips to KBM, keyboard drives the move) and `(m)` (held pointer button flips to KBM).
- deferred: 1 — `getPad()` hard-pins gamepad index 0; on a disconnect+reconnect where the browser reassigns the pad a non-zero `Gamepad.index`, `getPad(0)` returns null and the live controller drives nothing until the player switches to keyboard/mouse. Pre-existing (the index-0 pin predates this story); the new `connected` guard bounds the stuck-aim damage but does not re-home to the new slot. Logged to the deferred-work ledger.
- rejected (9): a bomb-button press flipping the active method to GAMEPAD and clearing a mouse player's aim (spec explicitly defines "a bomb button pressed" as gamepad activity, and the trigger — mouse-aiming while pressing a controller bumper — is an incoherent input combination; re-confirmed from the prior pass); a mouse nudge during pause flipping to KBM on the first resume frame (prior-rejected — spec-consistent, self-heals on the next stick input, and a correct guard would reach into the walled-off Story 5.2 pause path); `isKbmActive` carrying a hidden per-frame side effect on `_lastPointerMoveTime` (maintainability note, no user-facing defect); the gamepad bomb binding assuming the W3C standard mapping without a `pad.mapping` guard (ALREADY logged to the deferred-work ledger in the first review pass — not re-deferred); a bomb latched during game-over detonating on a future resume (reviewer conceded harmless today — world sim is gated off and `scene.restart()` rebuilds `InputState`; latent-only); per-frame deadzone recomputation across the activity check and channel writers (prior-rejected twice — negligible, same helper + constants); divergent "pointer engaged" definitions between `isKbmActive` and `sampleAim` (no demonstrated defect); the bomb `'down'` listener firing for any connected pad rather than only `getPad(0)` (two simultaneous controllers is out of scope for this single-player game — prior-rejected); the intent-alignment auditor's observation that the sampler's decision logic is tested by mocking Phaser rather than living in a pure seam (descriptive-only, no behavioral defect; the sampler test was a deliberate quality add in the first review pass, and behavior is fully intent-aligned).

## Design Notes

Active method is a **sticky, per-frame resolution**, not a stateful device object: the sampler passes its previous method plus two booleans and acts on the result — fully unit-testable while the sampler stays a thin adapter. Sticky on both/neither-active prevents flicker (resting all inputs keeps the current device; a contention frame doesn't thrash).

The cross-device aim-bleed fix is the core polish: `sampleAim` previously fell through to the mouse whenever the right stick centered, so any prior mouse engagement snapped a gamepad player's aim to the stale cursor on stick release. Gating aim (and move) to the active device makes a centered right stick `clearAim` (firing stops) — the expected twin-stick behavior — while a keyboard/mouse player is unaffected.

Deadzone split: `AIM_DEADZONE (0.30) > MOVE_DEADZONE (0.25)` because aim rotation from a barely-touched right stick is more visible than a tiny translation; both feed the already-tested `applyRadialDeadzone`. Gamepad bomb reuses the keyboard latch (`queueBomb`→`consumeBomb`) via an edge-triggered `'down'` listener (as `TitleScene` uses for start), so holding a bumper cannot re-queue.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new `inputMethod.test.js` and the added `isBombButton` cases; no orphaned import of the removed `INPUT_DEADZONE`.
- `npm run build` -- expected: production build succeeds (new seam + constants compile; sampler imports resolve).

**Manual checks:**
- `npm run dev`. With a gamepad: left stick moves (dead-center = still, no drift), right stick aims/fires, centering the right stick stops fire; press a bumper → smart bomb detonates once. Move the mouse, then use only the gamepad sticks and release the right stick → aim does NOT snap to the cursor (firing stops). Without touching the gamepad: WASD/arrows move, mouse aims and fires; hold Shift → bomb. Switch back and forth between pad and keyboard/mouse mid-run → control follows the last-used device every time with no restart.


## Auto Run Result

Status: done (follow-up review pass — follow-up 2)

**Summary:** A follow-up review pass over the already-shipped Story 5.4 input change. Four review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran in parallel. One genuine defect and two verification gaps were patched; one pre-existing robustness issue was deferred; nine findings were rejected. No intent_gap, no bad_spec — no implementation loopback.

**Files changed this pass:**
- `src/input/PlayerInputSampler.js` — `getPad()` now guards on the live `pad.connected` flag so a real Phaser mid-play disconnect (stale non-null pad with frozen sticks) reads as no-pad and the channels fall back defensively.
- `src/input/PlayerInputSampler.test.js` — `makePad()` defaults `connected: true`; added regression tests `(j)` disconnect-with-frozen-stick recovery, `(k)` aim-only gamepad acquisition, `(l)` keyDown KBM acquisition, `(m)` held-pointer KBM acquisition. (9 → 13 cases.)
- spec Review Triage Log + `deferred-work.md` — recorded this pass and the deferred reconnect-slot item.

**Review findings breakdown (this pass):**
- Patches applied: 3 — high 0, medium 1 (disconnect stale-pad defense was dead code against real Phaser), low 2 (untested `isGamepadActive` right-stick branch; untested `isKbmActive` keyDown/`p.isDown` branches).
- Deferred: 1 — `getPad()` hard-pins index 0, so a reconnect on a non-zero gamepad slot leaves the live pad unread (pre-existing; logged to ledger).
- Rejected: 9 (see Review Triage Log for each and its reason).

**Follow-up review recommendation:** true. Patched this pass: high 0, medium 1, low 2 → score = 3×1 + 1×2 = 5 (≥5).

**Verification performed:**
- `npm test` → 41 files, 614 tests passed (PlayerInputSampler.test.js: 13 passed).
- `npm run build` → production build succeeded.

**Residual risks:**
- The deferred reconnect-slot robustness gap remains (bounded, not a live defect for a single index-0 pad).
- The previously-deferred non-standard `pad.mapping` assumption remains open (first-pass ledger entry, not re-deferred).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` was already modified before this run (orchestrator-owned) — left in place, not part of this reviewed change.
