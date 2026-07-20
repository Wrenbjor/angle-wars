---
title: 'Story 4.1 — Neon Vector Art and Bloom'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'cdf4382866b0dbc0a1469ddfc2863280b9a87b9d'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '49ed32788fdc2844f978487d400ce5a83b0777a1'
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Every entity currently renders as a flat, placeholder vector shape drawn with default (normal) alpha blending and no glow. The game reads as a generic twin-stick shooter, not Geometry Wars — the signature neon "everything glows and bleeds light" look (NFR4) is missing.

**Approach:** Two view-only changes, both isolated behind a Phaser-free config/apply seam (`src/scenes/neonStyle.js`) and wired in `ArenaScene`: (1) put the neon vector layers (ship, bullets, and every enemy archetype, plus the arena border and bomb shockwave) into **additive blend mode** so bright shapes accumulate light over the dark background; (2) register **one camera-level Bloom post-FX pass** (`cameras.main.postFX.addBloom`) so bright elements bleed light across the whole frame. Bloom is applied ONCE at the camera — a single full-screen pass whose cost is independent of entity count — which is the choice that holds 60 FPS in a busy arena (NFR1). No simulation, no gameplay, and no entity geometry changes.

## Boundaries & Constraints

**Always:**
- This story is **view-only**. It touches only render wiring in `ArenaScene`, the new `neonStyle.js` helper, and new `constants.js` tunables. No system, entity factory, pool, collision, scoring, or fixed-step code changes; zero simulation/behavior change.
- Bloom is registered **once**, at the camera level (`this.cameras.main.postFX.addBloom(...)`), not per game object. Its cost is one screen-space pass regardless of how many enemies/bullets are alive — this is the load-bearing performance decision for AC2.
- The neon vector layers get `setBlendMode(Phaser.BlendModes.ADD)`: `shipSprite`, `bulletGraphics`, `seekerGraphics`, `greenSquareGraphics`, `pinwheelGraphics`, `snakeGraphics`, `blackHoleGraphics`, `bombShockwaveGraphics`, and the arena border graphics. Additive over the dark `COLOR_BACKGROUND` is what produces the neon glow/overlap brightening.
- The **game-over dimming overlay** (`gameOverOverlay`, a black rect at `GAMEOVER_OVERLAY_ALPHA`) MUST stay in NORMAL blend — additive black adds nothing, so making it additive would silently stop it dimming the scene. Text objects (debug, HUD, game-over lines) also stay NORMAL blend for readability; the camera bloom still gives them a subtle on-theme glow.
- All new bloom tunables (`NEON_BLOOM_*`) are centralized in `constants.js` as placeholders (tuned post-launch) — no inline magic numbers at the call site. `neonStyle.js` imports Phaser NOTHING (mirrors `constants.js`/`telegraphCue.js`); the `Phaser.BlendModes.ADD` value is injected by the caller so the helper stays headless-testable.
- The existing zero-per-frame-allocation render discipline is preserved: blend mode and bloom are configured ONCE in `create()`, never per frame in `update()`.
- The existing neon color palette in `constants.js` is retained as-is; the glow comes from additive + bloom, not from recoloring entities.

**Block If:**
- Registering camera bloom or setting additive blend requires changing the renderer away from the forced WebGL in `main.js`, OR the Phaser 3.90 camera `postFX.addBloom` / `Graphics.setBlendMode` API is not actually available as documented. Either signals a platform mismatch — HALT with specifics.

**Never:**
- Do not implement Story 4.2+ effects: no grid field, no ripple/warp, no particle system, no screen shake, no hit-stop, no audio. Only additive vector styling + a bloom pass.
- Do not change any entity's shape, radius, color, position math, or the telegraph fade/scale cue. Do not touch pools, systems, collision, scoring, death, or fixed-step ordering.
- Do not add per-object bloom/glow FX (per-entity `postFX.addBloom`) — that is the O(entities) path this story explicitly rejects for the O(1) camera pass.
- Do not add a per-frame allocation or per-frame FX reconfiguration in the render loop.

## I/O & Edge-Case Matrix

Scope: pure calls to the new `src/scenes/neonStyle.js` helpers over fakes (no Phaser). `ADD` = the injected additive blend-mode value.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bloom config maps constants | read `NEON_BLOOM` | object fields equal the `NEON_BLOOM_*` constants in the documented order (color, offsetX, offsetY, blurStrength, strength, steps) | none |
| Additive applied to every layer | `applyAdditiveBlend([l1,l2,l3], ADD)` where each `l` is a fake with `setBlendMode` | every layer's `setBlendMode` called exactly once with `ADD`; returns the same list | none |
| Additive on empty list | `applyAdditiveBlend([], ADD)` | no calls; returns `[]` (no throw) | tolerates empty |
| Bloom registered from config | `addNeonBloom(fakeCamera)` where `fakeCamera.postFX.addBloom` records args | calls `postFX.addBloom(color, offsetX, offsetY, blurStrength, strength, steps)` with exactly the `NEON_BLOOM` values in order; returns the controller the fake returns | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ADD a "Neon aesthetic / bloom (Story 4.1)" section: `NEON_BLOOM_COLOR`, `NEON_BLOOM_OFFSET_X`, `NEON_BLOOM_OFFSET_Y`, `NEON_BLOOM_BLUR_STRENGTH`, `NEON_BLOOM_STRENGTH`, `NEON_BLOOM_STEPS`. Placeholders, documented as post-launch tunables.
- `src/scenes/neonStyle.js` -- NEW Phaser-free helper. Exports `NEON_BLOOM` (config object built from the constants), `applyAdditiveBlend(layers, blendAdd)` (sets `setBlendMode(blendAdd)` on each layer; blend value injected so the module imports no Phaser), and `addNeonBloom(camera)` (forwards the `NEON_BLOOM` tuple to `camera.postFX.addBloom` in the documented order).
- `src/scenes/ArenaScene.js` -- in `create()`: keep a reference to the arena border graphics; collect the nine neon layers into an array and call `applyAdditiveBlend(layers, Phaser.BlendModes.ADD)` once; call `addNeonBloom(this.cameras.main)` once. Leave `gameOverOverlay` and all text objects in NORMAL blend. No `update()` changes.
- `src/scenes/neonStyle.test.js` -- NEW; unit-test every I/O-matrix row (config↔constants mapping, additive applied to each layer + empty-list, bloom-arg forwarding order) over fakes.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the six `NEON_BLOOM_*` constants in a new documented section -- centralized bloom tunables, no inline magic numbers.
- `src/scenes/neonStyle.js` -- implement `NEON_BLOOM`, `applyAdditiveBlend`, `addNeonBloom` (Phaser-free; blend value injected) -- the one testable seam for the neon styling + bloom wiring.
- `src/scenes/ArenaScene.js` -- reference the border graphics, apply additive blend to the nine neon layers once, register the camera bloom once; overlay/text stay normal blend -- integrates the neon look into the running game without per-frame cost.
- `src/scenes/neonStyle.test.js` -- unit-test every I/O-matrix row -- guards against a dropped/reordered bloom param or a missed layer shipping silently.

**Acceptance Criteria:**
- Given the game is running in the browser, when ships, bullets, and enemies are drawn, then they render with bright vector styling under additive blending and a Bloom post-FX pass so bright elements visibly bleed light (NFR4) — confirmed via `npm run dev` (automated seam: additive blend applied to each neon layer and one camera bloom registered from `NEON_BLOOM`, per `neonStyle.test.js`).
- Given the bloom pipeline is active and the arena is busy (many enemies, bullets, and a bomb shockwave on screen), when the frame renders, then the effect holds without dropping below the 60 FPS target (NFR1) — confirmed via the in-game FPS readout under `npm run dev`; architecturally guaranteed because bloom is a single camera-level pass whose cost is independent of entity count.
- Given the player reaches game over, when the dimming overlay shows, then it still visibly darkens the arena (the overlay is not additive), and the neon entities beneath still glow.

## Design Notes

**Camera bloom, not per-object.** Phaser 3.60+ exposes `postFX.addBloom(color, offsetX=1, offsetY=1, blurStrength=1, strength=1, steps=4)` on both game objects and cameras (verified in Phaser 3.90). Registering it once on `cameras.main` post-processes the entire composited frame in a fixed number of screen-space passes — its cost does not scale with the number of live enemies/bullets, which is exactly why it satisfies AC2 in a busy arena. A per-object bloom would add a pass per entity and blow the frame budget; it is a `Never`.

**Additive + dark background = neon.** The neon layers use `setBlendMode(Phaser.BlendModes.ADD)` (value `1`). Over `COLOR_BACKGROUND` (near-black), additive makes each bright shape add its light and overlapping shapes brighten toward white — the Geometry Wars look — and the bloom then bleeds that light outward. The `BlendModes.ADD` numeric value is injected into `applyAdditiveBlend` so `neonStyle.js` stays Phaser-free and unit-testable in vitest/jsdom (same discipline as `telegraphCue.js`).

**Blend-mode exceptions matter.** Additive black is a no-op, so the game-over dimming overlay must stay NORMAL blend or it would silently stop darkening the scene — the overlay is deliberately excluded from the neon layer list. Text stays NORMAL for readability (the camera bloom still glows it slightly). Configuration happens once in `create()`; the per-frame `clear()`/redraw loops are untouched, preserving zero-per-frame allocation.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `neonStyle.test.js`; no existing suite changes (view-only story, no simulation code touched).
- `npm run build` -- expected: production build succeeds (the pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: ships, bullets, and every enemy archetype glow and bleed light (additive neon + bloom); overlapping bright shapes brighten. With a busy arena (let a run ramp up, fire continuously, trigger a bomb), the FPS readout holds at/near 60. On game over, the dimming overlay still darkens the arena and the entities beneath still glow.

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` The two "documented order" tests could not catch a within-pair parameter swap because the fixture values collide (`NEON_BLOOM_OFFSET_X == OFFSET_Y == 1`, `BLUR_STRENGTH == STRENGTH == 1.2`), so a crossed `blurStrength`/`strength` (semantically different Phaser bloom params) would have shipped green. Added a value-independent order test in `neonStyle.test.js` that mocks `constants.js` with distinct sentinels (2/3/4/5/6) and dynamically re-imports `neonStyle.js` in isolation, asserting `addBloom` receives them in the exact `color, offsetX, offsetY, blurStrength, strength, steps` positions — an offsetX↔offsetY or blurStrength↔strength swap now fails. Isolation torn down in `finally`; the code was already correct (no production change).
  - `[low]` `[patch]` `NEON_BLOOM` was an exported mutable object read live by `addNeonBloom` on every `create()`/`scene.restart()`, so a stray mutation elsewhere could leak into a later run's bloom registration. Wrapped it in `Object.freeze(...)` (the only production change this pass) and added an `Object.isFrozen` assertion.
- rejected (not defects — verified non-issues, intent-sanctioned aesthetics/tunables, or theoretical no-reachable-trigger):
  - **Bloom stacking across `scene.restart()`** — verified false against the Phaser 3.90 source: `CameraManager.shutdown()` sets `main = undefined`, `destroy()`s every camera (tearing down its postFX pipeline), and empties the list; the next `start()` recreates a fresh main camera, so `addNeonBloom` adds exactly one bloom to a brand-new empty postFX each run.
  - **ArenaScene neon wiring (which 9 layers go additive, overlay/text exclusion, real `Phaser.BlendModes.ADD`, `cameras.main`) has no automated coverage** — an intent-sanctioned Phaser-coupled manual surface, identical to the Story 2.6 render-cue/ship-forwarding precedent; the pure seam is unit-tested and the spec's Verification honestly scopes the rest to `npm run dev` (the verification-gap reviewer confirmed the disclosure is not an overclaim).
  - **AC2 "architecturally guaranteed 60 FPS" reads as an overclaim** — defensible: AC2's stated axis is the *busy arena*, i.e. cost scaling with entity count, which a single camera-level pass genuinely neutralizes; the absolute-hardware frame-budget audit is epic-deferred to Story 5.5 (performance hardening).
  - **Camera bloom re-brightens neon under the game-over overlay (AC3 dim softened); bloom glow smears functional HUD/debug/game-over text; additive whiteout collapses dense overlapping enemies toward one color; invuln-blink alpha 0.25 modulates added-light rather than opacity under additive** — all intent-sanctioned consequences of the requested additive/bloom aesthetic, governed by placeholder tunables (`NEON_BLOOM_STRENGTH` et al.) the epic flags for post-launch/Story 4.4 tuning; each is on the spec's manual `npm run dev` checklist and structurally reversible by tuning strength, no code-structure change required. Recorded as residual risks.
  - **`applyAdditiveBlend` throws on a null/holey layer list; `addNeonBloom` throws if `camera.postFX` is absent** — no reachable trigger: all nine layers are provably constructed before the single call site (confirmed by two reviewers), and `main.js` forces `type: Phaser.WEBGL` so there is no non-WebGL/Canvas-fallback path (the spec's Block-If already covers a renderer change; mid-run WebGL context-loss is a pre-existing engine-wide concern, not this story's).
  - **Discarded `addNeonBloom` return (the Bloom controller handle) / hand-maintained nine-layer array is a silent-omission risk for future Epic 4.2+ layers / the neon block's correctness rests on `create()` line ordering** — speculative future-maintainability items: post-launch tuning is done by editing the centralized `NEON_BLOOM_*` constants and reloading (no live-controller consumer exists), each future story adds its own layer plus its own manual check, and the ordering contract is documented by an explicit section comment.

## Auto Run Result

Status: done

**Implemented change:** Story 4.1 — Neon Vector Art and Bloom. A view-only render pass adding the signature Geometry Wars glow: the nine neon vector layers (ship, bullets, seekers, green squares, pinwheels, snakes, black holes, bomb shockwave, arena border) are put into additive blend so bright shapes accumulate light over the near-black background, and ONE camera-level Bloom post-FX pass (`cameras.main.postFX.addBloom`) bleeds that light across the whole frame. Bloom is registered once at the camera — a single screen-space pass whose cost is independent of entity count — which is the load-bearing choice for holding 60 FPS in a busy arena. The game-over dimming overlay and all text deliberately stay in NORMAL blend. No simulation, gameplay, or entity-geometry change; the per-frame render loop and its zero-per-frame-allocation discipline are untouched.

**Files changed:**
- `src/config/constants.js` — added a documented "Neon aesthetic / bloom (Story 4.1)" section with the six `NEON_BLOOM_*` tunables (`COLOR`, `OFFSET_X`, `OFFSET_Y`, `BLUR_STRENGTH`, `STRENGTH`, `STEPS`) as post-launch placeholders in `addBloom` order.
- `src/scenes/neonStyle.js` — NEW Phaser-free helper: `NEON_BLOOM` (frozen config built from the constants), `applyAdditiveBlend(layers, blendAdd)` (injected blend value, one `setBlendMode` per layer), `addNeonBloom(camera)` (forwards the tuple to `camera.postFX.addBloom`).
- `src/scenes/neonStyle.test.js` — NEW; 7 tests: config↔constants mapping + key order, additive applied per layer + empty-list tolerance, bloom-arg forwarding + return, plus the value-independent (distinct-sentinel) order test and the frozen-config assertion.
- `src/scenes/ArenaScene.js` — imported the helpers; promoted the arena border graphics to `this.borderGraphics`; in `create()` applies additive blend to the nine neon layers once and registers the camera bloom once (overlay/text left NORMAL); `update()` untouched.

**Review findings breakdown:** 2 patches applied (both low — 1 test-strength hardening, 1 one-line `Object.freeze`); 0 intent_gap; 0 bad_spec; 0 deferred; 12 rejected (1 verified false against the Phaser source, the rest intent-sanctioned aesthetic/manual-surface items or theoretical no-reachable-trigger concerns — see the Review Triage Log).

**Follow-up review recommendation:** false. Patched this pass: 0 high, 0 medium, 2 low → score `3×0 + 1×2 = 2` (< 5), no high severity.

**Verification performed:** `npm test` — 26 files, 380 tests all pass (including `neonStyle.test.js`, 7 tests; no existing suite changed). `npm run build` — production build succeeded (pre-existing Phaser chunk-size advisory only, not a failure). Matrix Test Audit: all four I/O rows covered by tests that ran and passed. The Phaser `addBloom` signature and `BlendModes.ADD == 1` were confirmed directly against the Phaser 3.90 source; the `scene.restart()` camera lifecycle (fresh camera + empty postFX per run) was likewise verified there.

**Residual risks (all on the manual `npm run dev` checklist; all reversible by tuning the placeholder `NEON_BLOOM_*` constants, no code-structure change):**
- The actual visual glow/bleed and the busy-arena 60 FPS target are confirmed only by the in-browser manual pass — the automated tests cover the wiring seam, not rendered pixels or frame timing (an accepted, disclosed limitation of the vitest/jsdom stack, matching the Story 2.6 precedent).
- Global camera bloom also affects functional HUD/debug/game-over text (slight halo) and, on the game-over screen, re-adds highlight light over the dimming overlay; additive blend can wash dense overlapping enemies toward white and softens the invuln-blink's low-alpha frame. If any reads poorly in the manual pass, lowering `NEON_BLOOM_STRENGTH` (or a future dedicated UI camera in Epic 5) resolves it without touching this story's structure.
