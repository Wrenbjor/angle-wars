---
title: 'Vibrant Rendering and Accessible Upgrade Cards'
type: 'bugfix'
created: '2026-08-01'
status: 'done'
baseline_commit: '1e5461e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A camera-wide bloom treatment spreads white light across the finished frame, making the game look hazy and muting its neon colors. Level-up cards compound the legibility problem by placing pale text over a bright green focused fill with insufficient contrast.

**Approach:** Remove the full-screen bloom composite while retaining saturated source colors and additive neon layers. Restyle ordinary and focused upgrade cards with dark, high-opacity surfaces, bright borders, and text colors whose contrast is verified programmatically; focus must remain identifiable by border weight as well as color.

## Boundaries & Constraints

**Always:** Preserve gameplay behavior, reduced-motion behavior, card navigation, fusion-card identity, and the existing neon entity palette. Keep all card title, level, description, and action text readable against every ordinary-card state; target WCAG AA 4.5:1 contrast for normal-sized text. Communicate focus with the existing thicker border in addition to hue.

**Ask First:** Any new settings toggle, wholesale art-direction change beyond removing the camera-wide haze, or change to the special gold Fusion-card treatment.

**Never:** Reintroduce a camera-wide color wash, solve contrast by hiding descriptions or reducing information, rely on green/red color distinction alone, or change simulation/progression logic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Normal play | Arena, title, or settings scene renders | Source neon hues remain saturated without a white full-frame bloom composite | Rendering remains functional when camera post-FX is unavailable |
| Resting card | Offer is open and card is not focused | Pale text is readable on a dark surface with a visible accent border | Missing authored description keeps the existing fallback copy readable |
| Focused card | Keyboard, gamepad, or touch focus selects a card | Focus uses a distinct dark surface plus thicker bright border; all text remains at least 4.5:1 | Focus remains recognizable without color perception |
| Fusion card | Fusion offer occupies slot zero | Existing gold Epic styling and dynamic recipe copy remain intact | Missing recipe data retains the existing fallback copy |

</frozen-after-approval>

## Code Map

- `src/scenes/neonStyle.js` -- camera-wide bloom and additive-layer styling seam.
- `src/scenes/ArenaScene.js` -- applies neon styling and renders normal/focused/Fusion level-up cards.
- `src/scenes/TitleScene.js` -- applies the same full-camera bloom on the title view.
- `src/scenes/SettingsScene.js` -- applies the same full-camera bloom on settings.
- `src/config/constants.js` -- shared level-up surface, border, text, and legacy bloom values.
- `src/scenes/neonStyle.test.js` -- render-style seam tests.
- `src/scenes/renderIntegration.test.js` -- source-wiring coverage for Arena and card states.
- `src/config/visualContrast.js` -- new Phaser-free contrast/compositing seam for palette verification.

## Tasks & Acceptance

**Execution:**
- [x] `src/scenes/neonStyle.js`, `src/scenes/ArenaScene.js`, `src/scenes/TitleScene.js`, `src/scenes/SettingsScene.js` -- remove the full-camera bloom registration while preserving additive neon layers.
- [x] `src/config/constants.js` and `src/scenes/ArenaScene.js` -- replace bright green card surfaces with dark normal/focus surfaces, retain a vivid accent border, and keep the thicker focus outline.
- [x] `src/config/visualContrast.js` and tests -- provide a small pure contrast seam and pin ordinary/focused card text at 4.5:1 or better after alpha compositing over black.
- [x] `src/scenes/neonStyle.test.js` and `src/scenes/renderIntegration.test.js` -- update integration pins so full-camera bloom cannot return silently and card rendering continues to use the accessible palette states.

**Acceptance Criteria:**
- Given any primary scene, when it is created, then it does not add a camera-level bloom pass and its authored colors/additive layers render without a white haze.
- Given an ordinary level-up offer, when focus moves between cards, then focused and resting cards both use dark surfaces, text meets at least 4.5:1 contrast, and the focused border is thicker than the resting border.
- Given color-vision deficiency or a monochrome view, when focus changes, then border thickness still identifies the selected card.
- Given a Fusion card, when it renders, then its gold styling, Epic label, and recipe/fallback description remain unchanged.

## Spec Change Log

## Design Notes

The bright accent belongs on outlines and small controls, not underneath paragraphs. Removing the camera-wide bloom does not remove the neon language: entity layers and the hero title retain additive blending, which preserves saturated luminous overlaps without bleaching UI and background pixels together.

## Verification

**Commands:**
- `npm test -- --run src/scenes/neonStyle.test.js src/scenes/renderIntegration.test.js src/config/visualContrast.test.js` -- focused visual-style and accessibility coverage passes.
- `npm test` -- full regression suite passes.
- `npm run build` -- production WebGL bundle succeeds.

**Manual checks:**
- Inspect title, active Arena, ordinary level-up offer, focused-card changes, Fusion offer, and settings: colors should look saturated; text must remain readable at a glance; no full-frame milky halo should remain.

## Suggested Review Order

**Vibrant rendering**

- Entry point preserves additive neon color without processing the completed frame.
  [`ArenaScene.js:535`](../../src/scenes/ArenaScene.js#L535)

- Device profiles now expose only presentation costs still consumed at runtime.
  [`qualityProfile.js:132`](../../src/config/qualityProfile.js#L132)

**Accessible cards**

- Dark surfaces and thick outlines separate readable content from focus indication.
  [`ArenaScene.js:1950`](../../src/scenes/ArenaScene.js#L1950)

- Centralized palette includes accessible normal, focused, and depleted states.
  [`constants.js:1537`](../../src/config/constants.js#L1537)

- Pure compositing math measures the colors players actually see.
  [`visualContrast.js:54`](../../src/config/visualContrast.js#L54)

**Regression coverage**

- Scene integration pins the absence of full-camera bloom across primary views.
  [`renderIntegration.test.js:48`](../../src/scenes/renderIntegration.test.js#L48)

- Contrast tests cover dark and maximally bright gameplay backdrops.
  [`visualContrast.test.js:46`](../../src/config/visualContrast.test.js#L46)
