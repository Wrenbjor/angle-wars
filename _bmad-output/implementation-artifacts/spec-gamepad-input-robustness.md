---
title: 'Gamepad input robustness (DW-31, DW-33, DW-34)'
type: 'bugfix'
created: '2026-07-20'
status: 'done'
baseline_revision: '777355dd1902b11bec042db89e5a347a36c4304d'
final_revision: 'bc83b8b'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/src/input/PlayerInputSampler.js'
  - '{project-root}/src/input/inputMath.js'
  - '{project-root}/src/input/PlayerInputSampler.test.js'
  - '{project-root}/src/input/inputMath.test.js'
  - '{project-root}/src/scenes/ArenaScene.js'
  - '{project-root}/src/scenes/TitleScene.js'
  - '{project-root}/src/config/constants.js'
warnings:
  - multiple-goals
  - oversized
---

<intent-contract>

## Intent

**Problem:** A pad-only player is left stranded or silently unbound in three ways: ArenaScene's game-over screen only restarts on Enter/Space/pointer (no gamepad), the smart-bomb button match assumes the W3C "standard" mapping with no `pad.mapping` guard, and `getPad()` hard-pins gamepad index 0 so a pad reassigned to a non-zero slot on disconnect+reconnect drives nothing.

**Approach:** Wire the gamepad `down` event into ArenaScene's existing guarded restart closure; make the bomb-button match mapping-aware in the pure `inputMath` seam with a documented best-effort fallback plus a one-time non-standard diagnostic; and select the first *connected* pad instead of index 0.

## Boundaries & Constraints

**Always:**
- Preserve all existing keyboard/mouse behavior: restart (Enter/Space/pointer), bomb (Shift + bumpers), active-method hot-swap, and the disconnect fall-back must remain green in every existing test.
- Keep `inputMath.js` helpers pure and Phaser-free (unit-testable headlessly).
- The gamepad restart must reuse ArenaScene's existing `restart` closure and its shared `leaving` latch + `playerState.gameOver` guard — no new latch, and it must fire *only* at game over.
- Bomb parity: one physical bumper press → exactly one queued bomb, still frozen while paused.
- `getPad()` must keep returning `null` for a dead/disconnected pad (the existing sticky-GAMEPAD freeze fix) — only the *selection* changes, not the connected-guard.

**Block If:**
- None anticipated. The Phaser gamepad plugin exposes `getAll()`; if enumeration were unavailable, fall back to scanning `getPad(0..total-1)` (a decision, not a blocker).

**Never:**
- Do NOT add gamepad return-to-title; DW-31 is restart-only (keyboard `T` remains the title route). A pad player can always restart, so they are not stranded.
- Do NOT build a per-controller remapping database or attempt a true non-standard axis remap — no reliable programmatic remap exists for an unidentified pad; the fallback is documented best-effort + diagnostic only.
- Do NOT add multi-pad simultaneous play (single-player: first connected pad wins).
- Do NOT change deadzone/bomb constants or the `resolveActiveMethod` state machine.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bomb button, standard pad | `isBombButton(4,'standard')`, `isBombButton(5,'standard')` | `true` | No error expected |
| Non-bomb button, standard pad | `isBombButton(0,'standard')` | `false` | No error expected |
| Bomb button, non-standard pad | `isBombButton(4,'')` | `true` (documented best-effort fallback) | No error expected |
| Undefined mapping arg | `isBombButton(4)` (default) | `true` (defaults to standard) | Back-compat with existing callers |
| Mapping diagnostic, non-standard | `mappingWarning('')` | non-null warning string | No error expected |
| Mapping diagnostic, standard | `mappingWarning('standard')` | `null` | No error expected |
| Pad reassigned to non-zero slot | index 0 disconnected, index 1 `connected` | `getPad()` returns the index-1 pad; sampler drives move/aim from it | No error expected |
| All pads disconnected | every slot `connected:false` (or `total===0`) | `getPad()` returns `null` | Sampler falls back to keyboard/mouse |

</intent-contract>

## Code Map

- `src/input/inputMath.js` -- pure helpers; home of `isBombButton` and the new mapping-aware helpers.
- `src/input/PlayerInputSampler.js` -- Phaser input boundary; `getPad()` selection, bomb `down` listener, once-per-instance mapping diagnostic.
- `src/scenes/ArenaScene.js` -- game-over restart binding (`restart` closure at ~427-436) and prompt text (~406-414).
- `src/scenes/TitleScene.js` -- reference pattern: `this.input.gamepad?.on('down', start)`.
- `src/config/constants.js` -- `GAMEPAD_BOMB_BUTTONS = [4,5]` (bumper indices).
- `src/input/inputMath.test.js`, `src/input/PlayerInputSampler.test.js` -- test harness to extend.

## Tasks & Acceptance

**Execution:**
- `src/input/inputMath.js` -- add `GAMEPAD_STANDARD_MAPPING = 'standard'`, `isStandardMapping(mapping)`, and `mappingWarning(mapping)` (returns a diagnostic string for a non-standard/unidentified mapping, else `null`); change `isBombButton(index, mapping = GAMEPAD_STANDARD_MAPPING)` to branch on the mapping with a documented non-standard best-effort fallback -- so the raw-index assumption is explicit, centralized, and seam-ready.
- `src/input/PlayerInputSampler.js` -- (a) `getPad()` selects the first *connected* pad via `gp.getAll().find(p => p && p.connected)` instead of `getPad(0)`, keeping the `total===0` short-circuit and returning `null` when none is connected; (b) the bomb `down` listener passes `pad.mapping` into `isBombButton`; (c) `sample()` emits the `mappingWarning` via `console.warn` at most once per sampler instance when a connected non-standard pad is present -- makes DW-33's mapping-awareness observable for the whole pad (sticks + bomb).
- `src/scenes/ArenaScene.js` -- bind `this.input.gamepad?.on('down', restart)` alongside the Enter/Space/pointer bindings (reusing the same guarded closure); update the game-over prompt text to name the gamepad as a restart gesture.
- `src/input/inputMath.test.js` -- unit-test `isStandardMapping`, the mapping-aware `isBombButton` (standard true/false, non-standard best-effort, default arg), and `mappingWarning` (standard→null, non-standard→string).
- `src/input/PlayerInputSampler.test.js` -- extend the harness: `makePad` defaults `mapping:'standard'` (overridable), the mock gamepad gains `getAll()`, add `setPads([...])`; add tests for DW-34 (a connected pad at a non-zero slot drives input while index 0 is disconnected) and DW-33 (a connected non-standard pad triggers exactly one `console.warn` across repeated `sample()` calls, and the bomb still binds).

**Acceptance Criteria:**
- Given the game-over screen is showing, when a gamepad button is pressed, then a fresh run begins via the same `restart` path as Enter/Space (subject to the shared `leaving` latch), and nothing happens if pressed while not at game over.
- Given a connected pad is reported at a non-zero `Gamepad.index` while index 0 is disconnected/absent, when the sampler runs, then `getPad()` returns that connected pad and movement/aim are driven from it.
- Given a connected pad reports a non-standard `mapping`, when it is first sampled, then a single diagnostic warning is emitted (not repeated on later frames) and a bumper press still queues a bomb.
- Given a pad reporting the standard mapping, when it is used, then no diagnostic warning is emitted and all prior bomb/stick/restart behavior is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 2: (high 0, medium 0, low 2)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[low]` `[patch]` `undefined`/absent gamepad `mapping` was classified inconsistently — `isBombButton` defaulted it to standard while `mappingWarning`/`isStandardMapping` treated it as non-standard. Removed the `= GAMEPAD_STANDARD_MAPPING` default so a missing mapping routes through the non-standard best-effort branch uniformly (return values unchanged); added a coherence-lock test.
  - `[low]` `[patch]` `warnOnNonStandardMapping` docstring claimed the latch keeps it off the per-frame hot path — false for the common standard-pad case. Corrected the comment (logic unchanged; latching-on-checked would break hot-swap warning).
- reject/defer notes (ledger intentionally NOT edited, per invocation constraint):
  - defer — no gamepad route back to Title (pad-only players use keyboard `T`); DW-31 was scoped to restart only.
  - defer — the DW-31 gamepad-restart binding has no headless test (pre-existing gap: ArenaScene's keyboard/pointer restart bindings are likewise untested; no scene-input harness exists). Covered by the spec's manual check.
  - reject — mapping-aware `isBombButton` branches are currently identical: intent-mandated seam ("guard with a documented fallback"), documented as the future remap divergence point.
  - reject — gamepad restart binds any button incl. bomb bumpers: intent models DW-31 on TitleScene's any-button start; `gameOver` guard preserves in-run disjointness; pointer/Enter/Space already restart instantly.
  - reject ×3 — cross-pad bomb, multi-pad diagnostic gap, stick "half-scoping": multi-pad is an explicit non-goal and the stick reads use Phaser's normalized accessors per the intent-authorized documented-fallback resolution.
  - reject ×2 — mock `getPad(i)` fidelity (dead in production) and `getAll()` per-frame allocation (the intent-endorsed `getAll().find()`, negligible): test-only / immaterial.

## Design Notes

Honest scope of the mapping fix (DW-33): the stick reads already go through Phaser's normalized `pad.leftStick` / `pad.rightStick` accessors (built from axes 0–3), not raw `pad.axes[i]`, so they are already as mapping-robust as Phaser allows — there is no reliable programmatic axis remap for an *unidentified* pad without a per-controller database (explicitly out of scope). The concrete raw-index assumption worth guarding is the bomb button (`button.index` vs `[4,5]`). So the deliverable makes the assumption **explicit, centralized, and diagnosable**: `isBombButton` branches on `mapping` (standard → canonical `[4,5]`; non-standard → the same indices as a documented best-effort, since refusing to bind would leave the bomb unreachable — strictly worse), and a one-time `mappingWarning` surfaces a non-standard pad so a possible misbind is discoverable rather than silent. This single seam is where a future per-pad remap table would diverge the two branches.

DW-31 has no headless test (ArenaScene scene tests are all pure-seam; `create()` is not instantiated in vitest — the existing Enter/Space/pointer bindings are likewise untested there). It is a one-line binding reusing the already-guarded `restart` closure, verified by parity + suite-green + manual check.

Example (getPad selection):
```js
getPad() {
  const gp = this.scene.input.gamepad;
  if (!gp || gp.total === 0) return null;
  const pad = gp.getAll().find((p) => p && p.connected);
  return pad ?? null;
}
```

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `inputMath` mapping tests and the new `PlayerInputSampler` DW-33/DW-34 tests.
- `npm run build` -- expected: production build succeeds (no broken imports or signature mismatches).

**Manual checks (DW-31 — no headless scene harness):**
- Run the app, reach game over, press a gamepad button → a fresh run starts; confirm keyboard `T` still returns to title and Enter/Space/click still restart.

## Auto Run Result

Status: done

**Summary:** Closed the three gamepad-support gaps in the bundle. A pad-only player can now restart from the game-over screen (DW-31); the smart-bomb button match is mapping-aware with a documented best-effort fallback plus a once-per-instance non-standard-mapping diagnostic (DW-33); and `getPad()` selects the first *connected* pad instead of hard-pinning index 0, so a pad reassigned to a non-zero slot on reconnect still drives input (DW-34).

**Files changed:**
- `src/input/inputMath.js` — added `GAMEPAD_STANDARD_MAPPING`, `isStandardMapping`, `mappingWarning`; made `isBombButton(index, mapping)` mapping-aware (standard → canonical bumpers; non-standard/undefined → documented best-effort, classified consistently after the review patch).
- `src/input/PlayerInputSampler.js` — `getPad()` selects the first connected pad via `getAll().find(...)`; bomb listener passes `pad?.mapping`; added `warnOnNonStandardMapping` (once-per-instance diagnostic).
- `src/scenes/ArenaScene.js` — bound the gamepad `down` event to the existing guarded `restart` closure; updated the game-over prompt text to name the gamepad.
- `src/input/inputMath.test.js` — tests for `isStandardMapping`, mapping-aware `isBombButton`, `mappingWarning`, plus a coherence-lock for undefined-mapping classification.
- `src/input/PlayerInputSampler.test.js` — extended the harness (pad list, `getAll`, `mapping`); added DW-34 pad-selection tests and the DW-33 warn-once test.

**Review findings breakdown:**
- Patches applied (2, both low): consistent `undefined`-mapping classification across `isBombButton`/`mappingWarning`; corrected a misleading hot-path comment.
- Deferred (2) — reported here rather than appended to the deferred-work ledger, per the invocation's "do not edit the deferred-work ledger" constraint (the orchestrator records resolution):
  1. No gamepad route back to the Title screen for a pad-only player (keyboard `T` only); DW-31 was scoped to restart. Evidence: `ArenaScene.js` return-to-title binds only `keydown-T`.
  2. The DW-31 gamepad-restart binding has no headless test — a pre-existing gap (ArenaScene's keyboard/pointer restart bindings are also untested; no scene-input harness exists). Evidence: no scene test references `gamepad`; `ArenaScene.create()` is not instantiated in vitest.
- Rejected (7): the intentional identical `isBombButton` branches (intent-mandated seam), any-button gamepad restart incl. bumpers (intent models TitleScene's any-button start; in-run disjointness preserved by the `gameOver` guard), cross-pad bomb + multi-pad diagnostic gap (multi-pad is an explicit non-goal; any-pad bomb predates this change), DW-33 stick "half-scoping" (intent-authorized documented-fallback; Phaser normalizes the stick axes), mock `getPad(i)` fidelity (dead in production), and `getAll()` per-frame allocation (the intent-endorsed approach; negligible).

**Follow-up review recommended:** false (patched findings: 0 high, 0 medium, 2 low → score `3×0 + 1×2 = 2` < 5, no high).

**Verification performed:**
- `npm test` → 46 files / 668 tests pass (including the new `inputMath` mapping tests and `PlayerInputSampler` DW-33/DW-34 tests).
- `npm run build` → production build succeeds (67 modules, no errors).
- I/O matrix audit: all 8 rows covered by tests that ran and passed.
- DW-31 manual check not run in this unattended session (documented above as a manual step).

**Residual risks:**
- DW-31's gamepad-restart wiring is verified by inspection + suite-green only (no headless scene test) — see deferred item 2.
- The `isBombButton` mapping branches are intentionally identical today; a truly non-standard/unidentified pad gets a best-effort bumper binding (surfaced by the diagnostic), not a guaranteed-correct remap.
