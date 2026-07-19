# Epic 2 Context: Enemy Roster & Spawn Director

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic completes the faithful Retro Evolved threat set and makes the arena come alive with an endless, escalating swarm. It adds the remaining enemy archetypes with their distinct behaviors (Green Square, Pinwheel/Wanderer, Snake), the Black Hole gravity-well hazard, an endless spawn director that continuously ramps spawn rate and enemy mix over time, and safe spawn telegraphing so the player is never killed by an enemy that appears on top of them. It matters because it turns the single-enemy vertical slice from Epic 1 into a varied, endlessly-intensifying combat arena — the actual moment-to-moment gameplay of the finished product — while holding the 60 FPS peak-load performance bar.

## Stories

- Story 2.1: Green Square Enemy
- Story 2.2: Pinwheel/Wanderer Enemy
- Story 2.3: Snake Enemy
- Story 2.4: Black Hole Hazard
- Story 2.5: Escalating Spawn Director
- Story 2.6: Enemy Spawn Telegraph

## Requirements & Constraints

- Each enemy archetype must reproduce its Retro Evolved behavior faithfully; exact tuning constants (speeds, aggro ranges, gravity strength, score weights) are intentionally unspecified and tuned post-launch — centralize them, never hardcode magic numbers inline.
- Green Square flees the player until fired upon or threatened, then flips to aggressive pursuit and moves agilely.
- Pinwheel/Wanderer drifts on a pseudo-random trajectory indifferent to the player, bouncing off arena walls; still lethal on ship contact.
- Snake is a connected multi-segment body that follows a head and slithers; it is dangerous along its entire length (contact with any segment kills the player), and it takes damage / breaks apart when shot.
- Black Hole exerts an attractive gravitational force on the ship, enemies, and bullets when they are near; it grows and periodically spawns enemies as it absorbs matter; it is destructible, detonating with a score payout burst on death; contact with an undestroyed black hole kills the player. Its grid-warping visual is deferred to Epic 4 — implement gravity and lifecycle here with placeholder visuals only.
- Every enemy destroyed by a bullet is consumed from its pool and awards its per-type score value.
- The spawn director must escalate endlessly: as time elapses it increases spawn rate and shifts the mix toward tougher combinations on a continuous ramp; a fresh run after game over resets difficulty to the starting ramp.
- Spawn telegraphing: every enemy plays a brief spawn-in telegraph (fade/scale/pulse) during which it cannot kill the player; once the telegraph completes it becomes active and can collide lethally. The director must avoid choosing spawn points on or too near the ship's current position.
- Performance guardrails apply under peak load: all enemies (including snake segments) are drawn from object pools with zero per-frame allocation in the hot loop, and the game must sustain 60 FPS with many enemies and bullets active.

## Technical Decisions

- Engine: Phaser 3 (WebGL renderer). All enemy motion and gravity derive from the fixed-timestep simulation delta so behavior is frame-rate-independent — never raw frame time.
- New enemy types extend the entity/system foundation and per-type object pools established in Epic 1; add a pool per new archetype (and for snake segments) rather than allocating per spawn.
- Enemy behavior differences (flee/aggro state, drift+bounce, segmented follow, gravity) should live in the movement/behavior system(s) as per-type logic, keeping the architecture clean and extensible for later archetypes and v2.
- The Black Hole applies gravity as a force on nearby entities (ship, enemies, bullets), with a grow/feed/spawn lifecycle and a destructible health model; its visual grid warp is intentionally out of scope here (arrives with the deforming grid in Epic 4).
- The spawn director is a dedicated system owning spawn cadence, mix selection over a continuous difficulty ramp, spawn-point selection (avoiding the ship), and per-run reset on new game.
- Spawn telegraph is a distinct pre-active enemy state: telegraphing enemies render their fade/scale/pulse cue and are non-lethal until activated, at which point normal behavior and lethal collision begin.

## Cross-Story Dependencies

- All Epic 2 stories build on the Epic 1 foundation: the fixed-timestep loop, entity/system structure, object-pool utility, bullet system, collision/scoring, and player death.
- Stories 2.1, 2.2, 2.3, and 2.4 each add an independent enemy/hazard type and can be built in parallel; each reuses the pooling and collision patterns from Epic 1.
- Story 2.5 (spawn director) depends on the enemy types existing (2.1–2.4, plus the Epic 1 Seeker) so it has a roster to spawn and mix.
- Story 2.6 (spawn telegraph) applies to all enemies and integrates with the spawn director's spawn-point selection (2.5); build it so every archetype routes through the telegraphed spawn path.
- Story 2.4 (Black Hole) has a forward dependency on Epic 4 Story 4.2 for its grid-warp visual — gravity and lifecycle land here, the visual later.
