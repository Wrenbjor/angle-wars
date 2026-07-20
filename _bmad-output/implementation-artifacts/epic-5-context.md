# Epic 5 Context: Game Shell, Flow & Release

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic wraps the playable core, enemy roster, economy, and aesthetic layers into a finished, shippable product. It delivers everything around the arena that makes Angle Wars feel complete: a neon title screen, pause/resume, a full game-flow state machine with no dead ends, a persisted settings screen, tuned twin-stick input with gamepad and keyboard/mouse hot-swap, and a performance-hardened static web build. It matters because the prior epics prove the game is fun; this epic proves it is deployable — a Geometry Wars fan can go from title to run to game over to high score end-to-end and the whole thing loads fast and holds framerate on real hardware.

## Stories

- Story 5.1: Title and Start Screen
- Story 5.2: Pause and Resume
- Story 5.3: Game Flow State Machine and Settings
- Story 5.4: Input Config and Gamepad Polish
- Story 5.5: Performance Hardening and Web Build

## Requirements & Constraints

- The title screen must present the neon game title, the persisted high score, a start prompt, and basic controls; pressing start begins a fresh run.
- Pause must freeze all simulation and spawning behind an overlay; resume must continue with zero state loss (exact position, timers, difficulty ramp, multiplier all preserved).
- A single state machine must govern the full flow — title → play → death/respawn → game over → restart/title — with every terminal state offering both a direct restart and a return to title. No screen may be a dead end.
- A settings screen must expose at least volume and fullscreen; changes apply immediately and persist across sessions via local storage.
- Gamepad twin-stick must respond through tuned deadzones with no stick drift; keyboard (WASD/arrows) + mouse must be a complete fallback (move + aim + fire); the game must hot-swap between input methods mid-session without a restart.
- Performance target: sustain 60 FPS on mid-range hardware under worst-case late-game load — maximum enemies, thousands of particles, bombs detonating, bloom active, grid warping simultaneously.
- All high-churn objects (bullets, enemies, particles) must remain pooled with zero per-frame allocation in the hot loop; this epic includes an audit to confirm it across the assembled game.
- The production build must emit a static bundle deployable to any static host with no server dependency, loading quickly in modern desktop WebGL browsers, with the canvas scaling responsively while preserving arena aspect ratio.
- Success is measured end-to-end: a full session works with zero dead ends, and framerate holds during a peak swarm with bombs going off.

## Technical Decisions

- Engine is Phaser 3 (WebGL renderer); the flow between screens should be expressed with Phaser scenes coordinated by the game-flow state machine.
- Simulation runs on a fixed timestep decoupled from render; pause must halt the simulation clock, not merely hide rendering, so no time accrues while paused.
- Persistence uses `localStorage` for both high score and settings; settings and high score share the same persistence approach and survive reload.
- Build/deploy uses a static bundler (e.g. Vite) producing a self-contained static bundle.
- Feel and juice magnitudes (deadzones, shake, etc.) are centralized tunable constants — Epic 5 input tuning adjusts these rather than scattering values through the code.
- The entity/system architecture must stay clean and extensible so a future v2 (powers, progression) can bolt on without a rewrite; avoid shortcuts in the shell/state layer that would couple screens to gameplay internals.

## Cross-Story Dependencies

- This epic assembles and hardens systems delivered earlier; it assumes the core loop (Epic 1), full enemy roster and spawn director (Epic 2), score/multiplier/bombs/lives economy (Epic 3), and the aesthetic/juice layer (Epic 4) are in place.
- Story 5.1 (title) and Story 5.3 (state machine) depend on the persistent high score from Epic 3 (Story 3.4).
- Story 5.3's settings screen owns the persisted audio/mute setting that Epic 4's audio story (Story 4.5) reads from.
- Story 5.5's peak-load 60 FPS target exercises the pooling from Epics 1–4 (bullets, enemies, particles) and the bloom + deforming-grid render cost from Epic 4 all at once.
- Story 5.4 builds on the input foundations established for movement (Story 1.2) and firing (Story 1.3), finalizing deadzones and hot-swap across the whole game.
