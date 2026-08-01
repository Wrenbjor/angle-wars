---
title: 'Level-up hard pause and informative upgrade cards'
type: 'bugfix'
created: '2026-08-01'
status: 'done'
baseline_revision: '81d1efc6dfbcd38c970ac20c95502e005503d8bf'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-3-level-up-moment-and-card-ui.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-10-1-item-and-upgrade-framework.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The level-up choice overlay slows the world to 15% instead of stopping it, so enemies, hazards, collisions, and death-producing systems continue while the player reads. The cards show item names but omit the next level and the authored explanation of what the pick changes.

**Approach:** Freeze all world fixed-step advancement for the full lifetime of an active card offer while continuing to process only modal choices at render rate. Render each normal card's upcoming level and existing player-facing `levels[].desc` inside its panel; retain a dedicated fusion-recipe description for synthetic Epic cards.

## Boundaries & Constraints

**Always:** Treat the fixed step that creates an offer as atomic, but suppress every later/catch-up world step once selection becomes active. Process pick, reroll, and banish while frozen without re-reading stale level-crossing state. Resume world motion on the render frame after the final choice closes. Discard pre-offer accumulator remainder/backlog so resume never catches up paused time. Continue input navigation, confirmation grace, UI rendering, and manual-pause-over-card behavior. Use the offered card's current owned level to select `card.levels[currentLevel]`, because registry stats are total maps while `desc` is the intended next-pick explanation.

**Ask First:** Changing card dimensions/layout hierarchy, rewriting registry balance/content descriptions, or changing manual pause semantics.

**Never:** Simulate the world behind the modal, rely on temporary invulnerability as a substitute for pausing, call the full `LevelUpSystem.fixedUpdate()` from the render loop, show the already-owned level's description, or expose raw internal stat keys as player-facing copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Offer opens | A fixed step crosses one or more XP thresholds | Crossing step completes; remaining catch-up steps and all later world steps stop; no enemy/hazard/death motion occurs | Pending choices remain selectable indefinitely |
| Normal card | Unowned or owned registry item is offered | Card shows title, `NEW • Lv 1` or `Lv N → N+1`, and the selected next rung's `desc` inside the panel | Missing/malformed rung falls back safely without throwing |
| Modal action | Pick, reroll, or banish is queued while frozen | Only modal/progression state changes; offers rebuild and final pick closes normally | Invalid/depleted actions remain guarded no-ops |
| Multi-level gain | Several picks are owed | Each pick produces the next offer while the world remains frozen; world resumes one frame after the final pick | Empty eligible pool drains owed picks safely |
| Fusion offer | Synthetic Epic card has no `levels` array | Gold styling remains and recipe/effect description is visible without indexing normal levels | Missing recipe data uses safe Epic fallback copy |
| Manual pause | Pause is toggled while an offer is open | Existing PAUSED overlay hides cards; resuming returns to the same frozen offer | No gameplay/modal input is buffered through pause |

</frozen-after-approval>

## Code Map

- `src/scenes/ArenaScene.js` -- owns render-rate input, fixed-step advance gates, accumulator transition, and persistent card text objects.
- `src/systems/LevelUpSystem.js` -- split modal-action consumption/offer refresh from fixed-tick level-crossing ingestion.
- `src/config/itemRegistry.js` -- existing source of per-level `desc` and total `stats`; no schema change expected.
- `src/core/FixedTimestep.js` -- existing reset/advance seam used to prevent paused-time catch-up.
- `src/systems/levelUpSystem.test.js` -- behavioral coverage for modal-only processing and stale crossing isolation.
- `src/scenes/renderIntegration.test.js` -- source-boundary coverage for world freeze, sub-step gate, card text creation, and next-rung rendering.

## Tasks & Acceptance

**Execution:**
- [x] `src/systems/LevelUpSystem.js` -- extract a modal-only processing phase used by both normal fixed updates and the frozen overlay path, preserving all pick/reroll/banish/offer rules.
- [x] `src/scenes/ArenaScene.js` -- replace level-up time dilation with hard world freeze, reset accumulator on entry, process modal actions without same-frame resume, and render persistent level/description text within each card.
- [x] `src/systems/levelUpSystem.test.js` -- cover picks, reroll, banish, multi-pick redraw, empty offers, invalid actions, and proof that stale `levelsGainedThisTick` is not re-ingested by modal-only updates.
- [x] `src/scenes/renderIntegration.test.js` -- replace slow-motion assertions and cover the hard-freeze/sub-step/card-description seams, including pause hiding and fusion fallback.

**Acceptance Criteria:**
- Given any active level-up offer, when render frames elapse without a choice, then world tick count and all gameplay simulation state remain unchanged.
- Given an offer activates during a multi-sub-step frame, when the first crossing step completes, then no subsequent callback updates the world.
- Given the final choice closes the overlay, when that same render frame completes, then world simulation has not resumed; it resumes normally on the next frame.
- Given every visible normal card, when it renders, then its next level and authored effect/stat description are readable inside the card.

## Spec Change Log

## Design Notes

The current `LevelUpSystem.fixedUpdate()` couples modal commands with level-crossing ingestion. Calling it while the world is frozen would repeatedly consume the stale `levelsGainedThisTick`; the modal-only phase must not perform that ingestion. Fusion aura emission should also be bounded while particle simulation is frozen so a long reading pause cannot fill the gameplay particle pool.

## Verification

**Commands:**
- `npm test -- --run src/systems/levelUpSystem.test.js src/scenes/renderIntegration.test.js src/scenes/pauseControl.test.js src/scenes/buildArenaWorld.test.js` -- expected: focused behavior and integration tests pass.
- `npm test` -- expected: all tests pass.
- `npm run build` -- expected: production build succeeds.

**Manual checks:**
- Trigger a level-up beside enemies/hazards and leave cards open; confirm every background element and the player's life state remain perfectly still.
- Verify new and upgraded normal cards plus a Fusion Epic card show readable, non-overlapping descriptions on keyboard/gamepad and touch layouts.

## Suggested Review Order

**Simulation freeze**

- Frame-start snapshot freezes world advancement while modal commands still resolve.
  [`ArenaScene.js:1338`](../../src/scenes/ArenaScene.js#L1338)

- Modal-only state processing avoids replaying a stale XP crossing edge.
  [`LevelUpSystem.js:303`](../../src/systems/LevelUpSystem.js#L303)

**Card information**

- Persistent text objects establish the title, level, and wrapped-description hierarchy.
  [`ArenaScene.js:933`](../../src/scenes/ArenaScene.js#L933)

- Rendering selects the upcoming rung and preserves dynamically chosen Fusion partners.
  [`ArenaScene.js:1892`](../../src/scenes/ArenaScene.js#L1892)

- Synthetic Fusion cards retain generic-rule partner identity for accurate recipe copy.
  [`LevelUpSystem.js:229`](../../src/systems/LevelUpSystem.js#L229)

**Regression coverage**

- Behavioral tests prove frozen modal actions cannot re-ingest level crossings.
  [`levelUpSystem.test.js:367`](../../src/systems/levelUpSystem.test.js#L367)

- Render-boundary tests pin hard freeze, accumulator reset, and next-rung copy.
  [`renderIntegration.test.js:234`](../../src/scenes/renderIntegration.test.js#L234)

- Obsolete slow-motion tuning is removed while landing invulnerability remains documented.
  [`constants.js:1503`](../../src/config/constants.js#L1503)
