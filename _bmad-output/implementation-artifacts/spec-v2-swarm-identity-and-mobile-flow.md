---
title: 'V2 Swarm Identity and Mobile Flow'
type: 'feature'
created: '2026-08-01'
status: 'done'
baseline_commit: '6384a05'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prd.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Phone playtesting exposed a keyboard-only game-over exit, weak early pressure followed by abrupt spawn dumps, enemies with insufficiently distinct verbs, and effects far below the dense neon spectacle shown in the two supplied Geometry-Wars references.

**Approach:** Deliver one coordinated combat-feel pass: touch-native terminal controls, a smooth two-minute pursuit ramp into a large live swarm, four readable enemy identities, and substantially denser pooled effects that remain bounded by the mobile quality profile.

## Boundaries & Constraints

**Always:** Preserve fixed-timestep determinism, seeded gameplay RNG, safe spawn telegraphs, pool ownership, zero steady-state hot-loop allocation, mobile particle caps, reduced-motion suppression, and desktop keyboard/gamepad controls. The Pink Splitter replaces the current Pinwheel/Wanderer roster slot; the teal diamond is the existing Seeker identity restyled and retuned. By two minutes the player should feel continuously pursued, with many enemies alive simultaneously rather than a saved backlog appearing in one tick.

**Ask First:** Changing score/XP values, adding another roster slot, changing player weapons/upgrades, raising mobile caps beyond measured phone performance, or changing the black-hole/galaxy hazard's damage rules.

**Never:** Make snake bodies destructible; permit recursive pink splitting; let decorative particles affect gameplay; use uncapped emitters; restore camera-wide haze/bloom; or make an off-button game-over touch restart accidentally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Mobile game over | Touch-capable/native run is terminal | Safe-area Restart and Title buttons perform their named actions | Same-frame multi-touch resolves once; outside taps do nothing |
| Green pursuit | Green is active with bullets nearby | It pursues, temporarily evades bullet trajectories, and resumes pursuit; walls allow bullet pressure to pin it | Zero-distance and multiple-bullet steering stay finite/deterministic |
| Pink death | Large pink parent dies by any damage source | Exactly three killable children orbit a pivot that drifts for a bounded time | Children never split again; pooled reuse resets all parent/child state |
| Snake fire | Bullet strikes orange body or purple head | Body consumes bullet without damage; head hit follows damage rules and head death removes whole snake | Whole-snake cleanup reports/releases every segment exactly once |
| Spawn catch-up | Large frame delta or resumed accumulator | At most the configured per-tick budget spawns; overdue backlog is discarded | Live cap still allows a dense late swarm without a single-frame dump |
| VFX saturation | Many simultaneous kills/hazards on mobile | Layered color-coded bursts/trails emit up to the profile cap | Excess particles are skipped while timers drain normally |

</frozen-after-approval>

## Code Map

- `src/scenes/ArenaScene.js` -- game-over UI/input and all enemy/particle render passes.
- `src/scenes/mobileLayout.js` -- safe-area-aware screen-space control placement.
- `src/systems/GreenSquareSystem.js` -- green pursuit and bullet-avoidance steering.
- `src/systems/EnemySystem.js` -- steady-homing Seeker behavior.
- `src/systems/PinwheelSystem.js` -- current Wanderer slot to replace with parent/child splitter behavior.
- `src/systems/SnakeSystem.js` -- snake ownership, chain movement, and whole-snake reconciliation.
- `src/systems/CollisionSystem.js` -- bullet/body absorption versus damageable heads.
- `src/systems/SpawnDirector.js` -- time/DPS cadence, mix, live cap, and catch-up policy.
- `src/systems/ParticleSystem.js` -- pooled death, trail, impact, and hazard emissions.
- `src/scenes/buildArenaWorld.js` -- shared pool/system composition and ordering.
- `src/config/constants.js` and `src/config/qualityProfile.js` -- centralized tuning and mobile budgets.

## Tasks & Acceptance

**Execution:**
- [x] `src/scenes/gameOverControls.js`, `src/scenes/mobileLayout.js`, `src/scenes/ArenaScene.js` -- add pure hit-testing plus safe-area Restart/Title buttons; preserve desktop bindings and ordered one-shot exit handling.
- [x] `src/systems/GreenSquareSystem.js`, `src/entities/GreenSquare.js` -- replace flee/provocation with chase-plus-nearest-threat avoidance whose wall interaction supports player pinning.
- [x] `src/systems/EnemySystem.js`, `src/entities/Seeker.js`, `src/scenes/ArenaScene.js` -- retune the baseline homing threat and render it as a teal diamond.
- [x] `src/systems/PinwheelSystem.js`, its entity factory, and render/combat wiring -- implement a large pink parent that creates one three-child formation orbiting a drifting pivot.
- [x] `src/systems/SnakeSystem.js`, `src/systems/CollisionSystem.js`, and rendering -- make orange bodies bullet-absorbing/lethal, purple heads damageable, and head death atomically remove the chain.
- [x] `src/systems/SpawnDirector.js` -- smooth the first 120 seconds, discard accumulator catch-up beyond a bounded spawn budget, and tune caps/mix so large simultaneous pursuit emerges late in the ramp.
- [x] `src/systems/ParticleSystem.js`, relevant event-report seams, and `src/scenes/ArenaScene.js` -- add entity-colored layered death sprays, stronger player trails/impacts, and capped orbital/spiral particles around active black holes.
- [x] `src/config/constants.js`, `src/config/qualityProfile.js`, and focused unit/integration tests -- centralize all new behavior/VFX values and prove desktop/mobile caps, deterministic pooling, collision ownership, layout, and coarse-delta pacing.

**Acceptance Criteria:**
- Given a touch-only phone run, when the player dies, then both restart and title are reachable without a keyboard and survive safe-area/layout changes.
- Given each enemy family on screen, when it moves, is fired upon, splits, or is killed, then its silhouette, color, and verb match the frozen behavior matrix.
- Given a fresh run, when elapsed time approaches two minutes, then pressure grows continuously into a dense live swarm without accumulator-driven single-frame dumps.
- Given peak mobile combat, when kills, trails, and a black hole overlap, then the scene remains bounded by the mobile profile with no pool growth after warm-up.

## Design Notes

Treat the screenshots as density/composition references: bright outlined families, layered radial sparks, persistent directional trails, and a particle-rich galaxy center. Preserve foreground readability and accessibility; density comes from bounded local layers, not a muted full-screen filter.

## Verification

**Commands:**
- `npm test` -- all unit/integration tests pass, including deterministic coarse-delta and pool-reuse cases.
- `npm run build` -- production bundle succeeds.
- `npx cap sync android && (cd android && ./gradlew assembleDebug)` -- replacement phone APK succeeds.

**Manual checks:**
- Play on Android through two minutes; verify terminal buttons, green wall-pinning, teal pursuit, one-generation drifting pink trio, head-only snake kills, smooth swarm growth, and readable dense effects.

## Suggested Review Order

**Mobile terminal flow**

- Start with the touch-safe terminal UI and shared one-shot routing.
  [`ArenaScene.js:718`](../../src/scenes/ArenaScene.js#L718)

- Safe-area geometry adapts the two actions to narrow displays.
  [`mobileLayout.js:91`](../../src/scenes/mobileLayout.js#L91)

**Enemy identities and lifecycle**

- Predictive closest-approach steering creates green pursuit and bullet evasion.
  [`GreenSquareSystem.js:143`](../../src/systems/GreenSquareSystem.js#L143)

- Snapshot-first splitting prevents pooled aliases during simultaneous pink deaths.
  [`PinwheelSystem.js:105`](../../src/systems/PinwheelSystem.js#L105)

- Immediate reconciliation makes snake-head death remove its body before contact.
  [`SnakeSystem.js:128`](../../src/systems/SnakeSystem.js#L128)

- Teal diamonds and purple/orange snakes establish distinct silhouettes.
  [`ArenaScene.js:1536`](../../src/scenes/ArenaScene.js#L1536)

**Pacing and spectacle**

- Per-tick spawn budgeting discards backlog while allowing dense live pressure.
  [`SpawnDirector.js:199`](../../src/systems/SpawnDirector.js#L199)

- Globally bounded galaxy sparks respect caps, determinism, and reduced motion.
  [`ParticleSystem.js:296`](../../src/systems/ParticleSystem.js#L296)

**Regression proof**

- Same-tick double-parent deaths prove six distinct, zero-payout children.
  [`pinwheelSystem.test.js:551`](../../src/systems/pinwheelSystem.test.js#L551)

- Extreme deltas and reduced motion prove bounded galaxy emission.
  [`particleSystem.test.js:675`](../../src/systems/particleSystem.test.js#L675)

- Narrow safe spans keep both terminal actions reachable.
  [`mobileLayout.test.js:186`](../../src/scenes/mobileLayout.test.js#L186)
