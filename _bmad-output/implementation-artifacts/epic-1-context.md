# Epic 1 Context: Playable Core Loop

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic stands up a production-grade (not throwaway) vertical slice that proves the core twin-stick feel and the kill/die loop of the game: a ship you move and aim independently, continuous auto-fire, one enemy that spawns, homes, and dies to bullets, player death with lives, and a live score/HUD with game-over and restart. It intentionally ships with placeholder vector shapes and no signature aesthetic yet. It matters because it establishes the engine foundation — fixed-timestep loop, scene structure, and object pooling — that every later epic builds on, and it de-risks the project by validating that the fundamental feel is right before aesthetic and economy layers are added.

## Stories

- Story 1.1: Project Bootstrap and Game Shell
- Story 1.2: Player Ship and Twin-Stick Movement
- Story 1.3: Twin-Stick Firing
- Story 1.4: Blue Seeker Enemy
- Story 1.5: Player Death and Collision
- Story 1.6: Score and HUD

## Requirements & Constraints

- Movement and aim must be fully independent (twin-stick): the player can fly one direction while firing another. Primary input is a gamepad (left stick moves, right stick aims); keyboard-move + mouse-aim must work as a complete fallback.
- Firing is continuous auto-fire in the aim direction at a fixed cadence — no manual trigger pull required for this epic.
- The arena is a bounded rectangle: the ship is clamped inside and cannot leave; bullets despawn when they cross the boundary.
- One enemy type (Blue Seeker) that spawns and immediately homes toward the player's current position, is destroyed by a player bullet (bullet is consumed on hit), and kills the player on contact.
- Player death costs a life, respawns the ship at center with a brief invulnerability window during which enemy contact does no harm and the ship visibly signals the invulnerable state; running out of lives transitions to a game-over state.
- Score increases on each kill by a base per-type value (the multiplier is deliberately deferred to a later epic — do not implement it here). The HUD shows current score and remaining lives and updates immediately.
- Game-over screen shows the final score and offers restart; restarting begins a fresh run cleanly.
- All feel constants (acceleration, thrust, drag, fire cadence, invulnerability duration, etc.) must be centralized and tunable — exact magnitudes are intentionally unspecified and will be tuned by hand post-launch. Do not hardcode magic numbers inline.
- Performance guardrails apply from the start: high-churn entities (bullets, enemies) are drawn from object pools with zero per-frame allocation in the hot loop, and enemy/ship motion must be frame-rate-independent.

## Technical Decisions

- Engine: Phaser 3 with the WebGL renderer.
- Simulation runs on a fixed timestep decoupled from the render frame rate, so feel is identical regardless of display refresh; all entity motion (ship, bullets, Seeker homing) derives from the fixed-timestep delta, never raw frame time.
- Scene structure: Boot, Preload, and Arena scenes wired in sequence. This epic establishes that sequence as the foundation.
- Architecture: a lightweight entity/system structure (dedicated systems such as movement, firing, collision, scoring) plus a reusable, managed object-pool utility, with a pool per high-churn entity type. This structure must be clean and extensible enough that later powers/progression bolt on without a rewrite — build the pooling utility and system boundaries here as reusable foundations, not one-offs.
- The canvas scales responsively to the window while preserving the arena's aspect ratio.
- Ship movement model is velocity-based: acceleration/thrust applied on input, drag decelerating smoothly to a stop when input is released; the ship sprite rotates to face its travel/aim direction.
- Persistence (localStorage) and the neon/bloom aesthetic are out of scope for this epic — use placeholder vector shapes only.

## Cross-Story Dependencies

- Story 1.1 (bootstrap, fixed-timestep loop, scene structure, pooling utility) is the foundation all other stories in this epic depend on; do it first.
- Stories 1.2 (movement) and 1.3 (firing) both build on 1.1 and on the shared input handling; firing depends on the ship existing.
- Story 1.4 (Seeker) depends on bullets (1.3) for its destruction path and on the ship (1.2) for its homing target and pooling patterns established in 1.1/1.3.
- Story 1.5 (death/collision) depends on the ship (1.2) and an enemy (1.4) to collide.
- Story 1.6 (score/HUD/game-over) depends on kills (1.4) and the lives/death system (1.5). It deliberately omits the multiplier, which arrives in the score/economy epic; the extra-lives-at-thresholds and full game-flow state machine also land in later epics.
