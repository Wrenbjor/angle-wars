# Epic 4 Context: Signature Aesthetic & Juice

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic transforms the working shooter into something that unmistakably reads as Geometry Wars. On top of the already-functional core loop and economy, it layers the signature audiovisual identity: neon vector glow via bloom, a GPU-rendered grid floor that ripples and warps, a pooled particle system for death bursts and thruster trails, screen-feel effects (shake, flash, hit-stop), and sound with adaptive music. This is the "everything glows, everything moves" pillar — the reason the product is a faithful clone rather than a generic twin-stick shooter. Every effect here must land without compromising the locked framerate, because a beautiful game that stutters fails the core promise.

## Stories

- Story 4.1: Neon Vector Art and Bloom
- Story 4.2: Deforming Grid Field
- Story 4.3: Pooled Particle System
- Story 4.4: Screen Juice and Feedback
- Story 4.5: Sound and Adaptive Music

## Requirements & Constraints

- Ships, bullets, and enemies render as bright vector styling with additive blending, passed through a Bloom post-FX stage so bright elements bleed light.
- A neon grid field fills the play area and must ripple outward from explosions, bomb detonations, and player death; it must also warp toward an active black hole and release when that hazard is destroyed.
- Enemy destruction emits a fading, dispersing burst of neon particles; the thrusting ship leaves a particle trail. Thousands of particles may be live at once.
- Screen feedback: camera shake proportional to event magnitude plus a brief flash/hit-stop on bomb detonation and player death; subtle non-obstructive feedback (color pulses, small camera nudges) on kills and near-misses.
- Audio: SFX for fire, kill, death, bomb, and spawn events; background music intensity that adapts as difficulty ramps; a mute/volume control whose setting persists.
- Performance is the hard constraint on everything here: the target is a sustained 60 FPS on mid-range hardware under a busy late-game arena with bloom, grid warp, and dense particles all active simultaneously. Effects that cannot hold the framerate must be scaled back rather than allowed to drop frames.
- Success is judged perceptually: a Geometry Wars fan should look at it and recognize Retro Evolved.

## Technical Decisions

- Engine is Phaser 3 on the WebGL renderer. Use Phaser's built-in Bloom post-FX for glow and additive-blend graphics/sprites for the neon vectors rather than hand-rolling the glow.
- The deforming grid must run on the GPU as a mesh/shader — per-vertex CPU deformation is explicitly disallowed for performance.
- All high-churn objects, particles included, are drawn from managed per-type object pools with zero per-frame allocation in the hot loop. The particle system must be pool-backed from the start, not retrofitted.
- Simulation stays on a fixed timestep decoupled from render, so effect timing and feel remain identical regardless of frame rate.
- Effect magnitudes (shake intensity, hit-stop duration, particle counts, ripple strength) are centralized as tunable constants — the design intent is post-launch, controller-in-hand tuning, so these must not be scattered inline.
- The architecture should keep VFX as a dedicated system alongside movement/spawning/collision/scoring, preserving the clean, extensible structure required for a future v2.

## UX & Interaction Patterns

- There is no separate UX document; visual and feedback behavior is specified within the stories themselves.
- Feedback must reinforce action without obscuring it — juice serves readability, never fights it. Near-miss and kill cues stay subtle; only major events (bomb, death) warrant strong shake/flash/hit-stop.
- Grid response is diegetic: ripples originate from the world-space point of each explosion/death, and gravity warp tracks the black hole's position.

## Cross-Story Dependencies

- Story 4.2 (grid warp) depends on the black hole hazard's gravity and lifecycle, which were implemented with placeholder visuals in Epic 2 (Story 2.4); this epic delivers that hazard's grid-distortion visual.
- The audio setting persistence in Story 4.5 ties into the settings/persistence work delivered in Epic 5 (Story 5.3) — coordinate on where the mute/volume preference is stored.
- Particle bursts (4.3) and screen juice (4.4) hook into existing gameplay events from earlier epics (enemy death, bomb detonation, player death), so those event points must already fire before the effects can attach.
- All effects share the single 60 FPS budget; the final performance audit and hardening happens in Epic 5 (Story 5.5), but each story here must stay within budget rather than deferring cost.
