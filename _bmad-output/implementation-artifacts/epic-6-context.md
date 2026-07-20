# Epic 6 Context: Feel & Signature Hazards (Post-Launch Tweaks)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic delivers the refinements that only surfaced once the finished game was actually played: the grid feedback reads as too loud, the black hole plays like a chore instead of a threat, and the roster wants one more hazard with a distinct verb. These are tuning-and-content stories layered on the already-shipping core — each is independently shippable and reuses existing systems (settings persistence from Epic 5, the smart-bomb shockwave from Epic 3, the spawn director + spawn telegraph from Epic 2, and the collision/death seams from Epic 1). The work tones default visual feedback down and finally hangs a reduced-motion accessibility option on the existing settings screen, inverts the black hole into an unstable ticking bomb, and adds the spinning mirror-reflector "dumbbell."

## Stories

- Story 6.1: Grid Subtlety and Reduced-Motion Accessibility
- Story 6.2: Black Hole Instability Rework
- Story 6.3: Mirror Reflector (Dumbbell) Hazard

## Requirements & Constraints

- The default kill-ripple grid deformation must be markedly subtler than the pre-epic version (reduced amplitude/reach) while remaining readable as feedback.
- A Reduced Motion setting must scale down or disable grid warp, the full-screen white flash, and camera shake; when enabled, bomb/death events still read clearly through non-motion cues (color, particles, audio). The preference must apply immediately and persist across sessions in localStorage. This closes a deferred accessibility item (WCAG 2.3.1 motion-safety) that could not be built until settings/persistence infrastructure existed.
- The black hole grows toward an *unstable threshold* as it absorbs enemies/matter (not a harmless cap). As it nears instability it must pulse escalating red with a rising audio-urgency cue.
- Reaching the unstable threshold detonates the hole like a smart bomb (screen-clearing shockwave that destroys on-screen enemies) AND costs the player a life, triggering the normal death/respawn flow and multiplier reset.
- Sustained player fire shrinks the black hole; enough fire destroys it via a safe implosion (no lethal blast) for its score payout — the inverse of feeding it. The old feed-driven seeker emission is removed so the hole's only threat is the instability clock (avoids double jeopardy).
- Ship contact with an undestroyed black hole still kills the player.
- The mirror reflector drifts aimlessly while continuously spinning about its center, rendered as a dumbbell (two weights joined by a bar). It spawns through the existing spawn director + telegraph and is drawn from a pool.
- The reflector is immune to gunfire: a player bullet striking the bar reflects off it (angle of incidence about the bar's normal) and continues as a live player shot that can still destroy enemies. The reflector is destroyed only by flying the ship through its center point, for a score payout. Contact with either weight kills the player.
- All new feel magnitudes (ripple amplitude, instability rate, reflected-bullet behavior) must be centralized tunable constants for post-launch playtesting.

## Technical Decisions

- Engine is Phaser 3 (WebGL). Simulation runs on a fixed timestep decoupled from render, so all new motion (drift, spin, gravity growth, instability clock) must be fixed-timestep driven, not frame-rate dependent.
- High-churn entities use per-type managed object pools with zero per-frame allocation in the hot loop; the mirror reflector must follow this pooling pattern (modeled on the existing Pinwheel/Wanderer drift + pool system).
- Story 6.2 inverts the existing black hole (originally a grow-and-emit gravity well): reuse the smart-bomb shockwave for the screen clear and the existing PlayerDeath system for the life cost rather than reimplementing either.
- The mirror-reflector reflect is genuinely new collision code — a segment-vs-point test (bullet vs bar) plus a per-bullet, per-tick velocity mirror. Reflected bullets stay player-owned; whether they can harm the player is a tunable feel constant (default: harmless to the player).
- Settings and high score persist via localStorage; the Reduced Motion flag joins the existing persisted settings set surfaced on the Epic 5 settings screen.
- Architecture is a lightweight entity/component structure with dedicated systems (movement, spawning, collision, scoring, VFX); new hazards and settings must bolt onto these seams without a rewrite (v2-extensibility constraint).

## Cross-Story Dependencies

- Story 6.1 depends on the Epic 5 settings screen + localStorage persistence, and on the grid (Epic 4.2), full-screen flash and camera shake (Epic 4.4) it tones down.
- Story 6.2 depends on the existing black hole (Epic 2.4) it reworks, the smart-bomb shockwave (Epic 3.2), and the player death/respawn + multiplier-reset flow (Epic 1.5, Epic 3.1); its escalating red/audio cues build on Epic 4 VFX/audio.
- Story 6.3 depends on the spawn director + spawn telegraph (Epic 2.5, 2.6), the pooling utility (Epic 1), the Pinwheel/Wanderer drift pattern (Epic 2.2), and the player-bullet + collision/death systems (Epic 1.3, 1.5).
- The three stories are otherwise independent of one another and each is independently shippable.
