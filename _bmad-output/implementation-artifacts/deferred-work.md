# Deferred Work Ledger

Findings surfaced during review that are real but out of scope for the story that surfaced them. The orchestrator owns their status and resolution.

### DW-1: Follow-up review still recommended for 5-4-input-config-and-gamepad-polish after the damping cap was spent
origin: review-budget-followup
source_spec: `spec-5-4-input-config-and-gamepad-polish.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260719-113220-5a3e; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-2: The render-integration surface (Phaser.WEBGL enforcement, Scale.FIT/CENTER_BOTH letterboxing, Boot→Preload→Arena chain, and the render→sim decoupling wiring in ArenaScene.update) plus the ArenaScene sim-rate sampling math have zero automated coverage; consider extracting the sampling into a Phaser-free helper (unit-tested like the other core primitives) and/or adding a headless config-assertion smoke test for the scene setup.

origin: migrated from legacy ledger (review of spec-1-1-project-bootstrap-and-game-shell.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-1-1-project-bootstrap-and-game-shell.md`
location: `src/scenes/ArenaScene.js` (render→sim decoupling, sim-rate sampling), Boot→Preload→Arena chain
reason: Three independent review layers (verification-gap, adversarial/blind-hunter, intent-alignment) converged on the same gap. AC4's headline observable (steady sim ticks/sec independent of render FPS) and the intent's most distinctive "Always" invariants (WEBGL not AUTO; FIT/CENTER_BOTH; render callback never runs sim directly) are asserted only as config literals and human-read canvas text — a regression flipping the renderer to AUTO, breaking the scale mode, or calling world.fixedUpdate(delta) directly from update() would pass the entire existing suite (src/**/*.test.js covers only src/core/). The spec deliberately scoped headless unit-testing to Pool/FixedTimestep, so closing this adds a module beyond the story's captured intent.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-scene-render-and-sim-rate-coverage

### DW-3: `PlayerInputSampler.sample()` — the keyboard `(right-left, down-up)` axis mapping and the gamepad-priority deadzone fall-through — has no automated coverage; consider driving `sample()` with a fake keys/pad object (or extracting the pure axis-resolution decision) to assert control mapping and pad↔keyboard priority.

origin: migrated from legacy ledger (review of spec-1-2-player-ship-and-twin-stick-movement.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-1-2-player-ship-and-twin-stick-movement.md`
location: `PlayerInputSampler.sample()`
reason: Three independent review layers (adversarial/blind-hunter, verification-gap, intent-alignment) converged on the same gap. `PlayerInputSampler` is referenced only by its own definition and the ArenaScene import/instantiation; no `*.test.js` constructs or calls it. All movement/input tests seed `InputState` directly via `setMove`, bypassing the sampler entirely — so a sign inversion (inverted controls), a swapped up/down axis, or a broken pad-idle fall-through (a connected-but-idle pad calling `setMove(0,0)` and suppressing WASD) would ship green. The spec deliberately designated the sampler as the thin Phaser boundary not headlessly tested; closing this adds scene/input mocking infrastructure beyond the story's captured intent (orchestrator-owned, mirrors the Story 1.1 render-integration deferral above).
status: done 2026-07-20
resolution: already resolved: PlayerInputSampler.test.js now drives the move path headlessly with fake keys/pad objects: pad-wins-over-keyboard priority asserted at PlayerInputSampler.test.js:101-113, keyboard-branch axis (left key -> moveX<0) and KBM<->GAMEPAD hot-swap at :131-156 and :264-277. The 'no automated coverage' gap the entry describes is closed.

### DW-4: `PlayerInputSampler.sampleAim()` — the aim-acquisition path (gamepad **right**-stick deadzone priority, the mouse `worldX/worldY − ship` fallback, and the new pointer-engagement gate) — has no automated coverage; consider driving `sampleAim` with a fake pad + fake `scene.input.activePointer` (or extracting the pure ship-relative subtraction / device-priority decision) to assert right-stick-vs-mouse priority, the correct subtraction order and world-space coords, and the engagement gate.

origin: migrated from legacy ledger (review of spec-1-3-twin-stick-firing.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-1-3-twin-stick-firing.md`
location: `PlayerInputSampler.sampleAim()`
reason: Two independent review layers (verification-gap, intent-alignment) converged on the same gap, and this is the surface the story's **primary** AC literally names ("gamepad right stick, or mouse position"). A symbol/import search across `src/**/*.test.js` for `PlayerInputSampler`/`sampleAim`/`rightStick`/`worldX`/`activePointer` returns no matches; every `firingSystem.test.js` case seeds aim via `input.setAim(...)` directly, bypassing the sampler. So a wrong stick (left vs right), an inverted `ship − pointer` subtraction, a screen-vs-world coordinate mistake, or a broken engagement gate would flip/break the primary aim AC while shipping green. Same deliberately-thin Phaser boundary as the Story 1.1 render-integration and Story 1.2 movement-sampler deferrals above; closing it needs scene/input mocking infrastructure beyond this story's captured intent (orchestrator-owned).
status: done 2026-07-20
resolution: already resolved: PlayerInputSampler.test.js drives sampleAim with a fake pad + fake activePointer: right-stick-vs-mouse priority (centered stick does NOT snap to stale mouse) at :115-129; subtraction order + world-space coords ((worldX-ship.x, worldY-ship.y) normalized) directly asserted at :146-155; disconnect->clearAim at :158-172/:217-244. Gap closed.

### DW-5: The `ArenaScene` enemy wiring/render surface — the system-registration order (SimClock → PlayerMovement → Firing → Enemy → Collision), the pool references passed to `CollisionSystem` (`firingSystem.bulletPool`, `enemySystem.enemyPool`), the real firing-pipeline-bullet → spawned-seeker destruction path (AC-2 end to end), and the seeker render loop — has no automated coverage; consider a headless `buildWorld()`/wiring helper that asserts system order and the collision pools' identity, plus (as with the bullet render) a manual/extracted-draw-helper check for the render loop.

origin: migrated from legacy ledger (review of spec-1-4-blue-seeker-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-1-4-blue-seeker-enemy.md`
location: `src/scenes/ArenaScene.js` (system registration + collision pools + seeker render), `CollisionSystem`
reason: Two independent review layers (verification-gap, intent-alignment) converged: the story's ACs are stated at the running-game/integration surface ("the game is running", "a Seeker is on screen", "a player bullet collides with it") while every test operates one layer below at the isolated-primitive surface — `enemySystem.test.js`/`collisionSystem.test.js` construct their own pools and hand-place entities, and no test constructs a `World` with these systems or references `ArenaScene`. A reorder of the `addSystem` calls (Collision before Enemy) or a swapped/wrong pool reference would leave the entire suite green while breaking collision-sees-post-move-positions in-game, and `World.fixedUpdate` (`src/core/World.js:56-64`) itself flags this insertion order as load-bearing. Same deliberately-thin Phaser boundary as the Story 1.1 render-integration and Story 1.2/1.3 sampler deferrals above; closing it needs scene/World integration-harness infrastructure beyond this story's captured intent (orchestrator-owned).
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-6: The `ArenaScene` player-death wiring/render surface — the load-bearing `PlayerDeathSystem`-after-`CollisionSystem` registration order (so a seeker a bullet destroys this tick cannot also kill the player) and the invulnerability blink render (`shipSprite.alpha` derived from `invulnMs`) — has no automated coverage; consider a headless `buildWorld()`/wiring helper asserting system order (a seeker overlapping both a live bullet and the ship, one `fixedUpdate`, seeker released AND life kept — inverting the two `addSystem` calls should fail it), plus an extracted/tested blink-alpha helper.

origin: migrated from legacy ledger (review of spec-1-5-player-death-and-collision.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-1-5-player-death-and-collision.md`
location: `src/scenes/ArenaScene.js` (PlayerDeathSystem registration order + invuln blink render)
reason: Two review layers (adversarial, verification-gap) converged. `PlayerDeathSystem` must run after `CollisionSystem` (`CollisionSystem.js` releases hit seekers in the same tick; `PlayerDeathSystem` reads the enemy pool after) — a real, load-bearing ordering dependency living only as `addSystem` order in `ArenaScene.js` (which has zero test surface). Every `playerDeathSystem.test.js` case constructs the system standalone over a bare ship + `Pool`, with no `CollisionSystem` and no `World`/`ArenaScene`, so reordering the registration or breaking the render blink formula (`Math.floor(invulnMs / PLAYER_INVULN_BLINK_MS) % 2`, `ArenaScene.js` update loop) would ship green. Same deliberately-thin Phaser/scene boundary as the Story 1.1–1.4 render/wiring deferrals above; closing it needs the same orchestrator-owned scene/World integration harness.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-7: The `ArenaScene` scoring/HUD/game-over integration surface — the load-bearing Collision→Scoring registration order (so `ScoringSystem` reads `collisionSystem.killedSeekers` after `CollisionSystem` fills and resets it), the game-over sim-freeze gate, and the restart-guard input wiring — has no automated coverage; consider a headless `buildWorld()`/wiring helper composing the real `CollisionSystem` + `ScoringSystem` through `World` (a bullet overlapping a seeker, one `fixedUpdate`, `scoreState.score === SEEKER_SCORE`; reversing the two `addSystem` calls should fail it), plus extracted/tested predicates for the freeze gate (`shouldAdvanceSim(playerState)`) and the restart guard.

origin: migrated from legacy ledger (review of spec-1-6-score-and-hud.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-1-6-score-and-hud.md`
location: `src/scenes/ArenaScene.js` (Collision→Scoring order, sim-freeze gate, restart guard)
reason: Three review layers (adversarial, verification-gap, intent-alignment) converged. `ScoringSystem` is correct only because it is registered after `CollisionSystem`, which resets `killedSeekers` at the top of its own `fixedUpdate` — but `scoringSystem.test.js` stubs the collision system with a hand-built `{ killedSeekers: [...] }` (never the real reset/order), `collisionSystem.test.js` never invokes scoring, and `world.test.js` composes only unrelated recording systems, so a swapped `addSystem` order would credit the prior tick's kills (off-by-one) or drop the final game-over-tick kill while shipping green. Likewise the game-over sim-freeze (`if (!gameOver) world.fixedUpdate(dt)` inside `advance`) and the restart guard (`if (gameOver) scene.restart()`) are inline scene glue with no Phaser-free seam: dropping/inverting either would keep the sim running after death (unstable "final" score) or restart a live run on a mid-run keypress/click, with nothing to catch it. The system-order piece is headlessly testable; the freeze/restart glue is the same deliberately-thin Phaser/scene boundary as the Story 1.1–1.5 render/wiring deferrals above (orchestrator-owned scene/World integration harness).
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-8: The `ArenaScene` green-square wiring/render surface — the load-bearing `GreenSquareSystem`-before-`CollisionSystem` registration order (so a still-active bullet can provoke a nearby square before a hit releases it), the composition of the green-square pool into the `enemyPools` arrays passed to both `CollisionSystem` and `PlayerDeathSystem`, and the green-square render pass — has no automated coverage; consider the same headless `buildWorld()`/wiring harness proposed for Stories 1.4–1.6, extended to assert green squares route through collision (killable/scored), death (lethal, FR6), and render.

origin: migrated from legacy ledger (review of spec-2-1-green-square-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-1-green-square-enemy.md`
location: `src/scenes/ArenaScene.js` + `GreenSquareSystem` (registration order, enemyPools composition, render)
reason: Verification-gap and adversarial layers converged: the story's ACs are stated at the running-game surface while every test builds its own two-pool arrays (`[seekerPool, greenPool]`) and drives `GreenSquareSystem`/`CollisionSystem`/`PlayerDeathSystem` in isolation. Dropping the green pool from either `enemyPools` array (squares become invincible/unscored, or non-lethal — violating FR6), reordering `GreenSquareSystem` after `CollisionSystem` (near-miss provocation silently weakens because the consuming bullet is gone), or dropping the render pass (invisible) would all leave the suite green. This is the same deliberately-thin Phaser/scene boundary and orchestrator-owned integration-harness deferral logged for Stories 1.1–1.6.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-9: Green-square flee behavior is a straight-line retreat that clamps and parks against the arena wall/corner it flees into, and squares are never despawned or capped, so unshot fleeing squares accumulate at the walls over a run; the PRD's "must be cornered" / AC1's "moving agilely around the arena" agility expectation is not represented — a feel-and-balance item for post-launch tuning (PRD Pillar 3) that is also entangled with the spawn-cap/despawn behavior owned by Story 2.5 (Escalating Spawn Director).

origin: migrated from legacy ledger (review of spec-2-1-green-square-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-1-green-square-enemy.md`
location: `GreenSquareSystem` (flee behavior)
reason: Intent-alignment and adversarial layers converged: the diff faithfully implements the spec's committed reading (straight-line flee + arena clamp; the two wall-clamp tests assert a fleeing square resting exactly at MIN/MAX bounds is correct), which satisfies AC1's literal primary clause "flees away from the player" but not the softer "moving agilely / must be cornered" reading. Not a defect against the story's literal ACs; real enough to revisit in playtest tuning and when Story 2.5 introduces concurrency caps/despawn.
status: open

### DW-10: `GreenSquareSystem._spawnOne` (like the pre-existing `EnemySystem._spawnOne`) places a new square at a random arena-edge point with no check against the ship's current position and spawns after the behavior pass, so a fresh square is a live lethal collider on its first tick and can appear on top of a wall-hugging player for an unavoidable death; safe-spawn placement (avoid the ship's position) is explicitly owned by Story 2.6 (Enemy Spawn Telegraph) per the epic.

origin: migrated from legacy ledger (review of spec-2-1-green-square-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-1-green-square-enemy.md`
location: `GreenSquareSystem._spawnOne`
reason: Adversarial layer flagged instant-death-on-spawn; the mechanism is identical to and shared with the Blue Seeker (Story 1.4), so it is not newly introduced by this story, and the epic assigns "avoids spawning directly on the ship's current position" plus the pre-active non-lethal telegraph window to Story 2.6. Deferred to that story rather than patched here to avoid duplicating spawn-safety logic that 2.6 will centralize across all archetypes.
status: done 2026-07-20
resolution: already resolved: Story 2.6 wired ship-avoidance + non-lethal telegraph: GreenSquareSystem.js:165-172 calls pickSafeEdgePlacement (spawnPlacement.js:48-95) with the ship as avoid point, sets telegraphMs at :181, gates behavior at :106-110, and PlayerDeathSystem.js:116-119 skips any enemy with telegraphMs>0. Instant-death-on-spawn no longer reachable.

### DW-11: The `ArenaScene` pinwheel wiring/render surface — the load-bearing `world.addSystem(pinwheelSystem)` registration (so pinwheels ever spawn/move in-game), the composition of `pinwheelSystem.enemyPool` into the shared `enemyPools` array passed to both `CollisionSystem` and `PlayerDeathSystem` (so pinwheels are killable/scored and lethal, FR6), and the pinwheel diamond render pass — has no automated coverage; consider the same headless `buildWorld()`/wiring harness proposed for Stories 1.4–2.1, extended to assert pinwheels route through world-tick, collision, death, and render.

origin: migrated from legacy ledger (review of spec-2-2-pinwheel-wanderer-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-2-pinwheel-wanderer-enemy.md`
location: `src/scenes/ArenaScene.js` + `PinwheelSystem` (registration, enemyPools composition, render)
reason: Verification-gap and intent-alignment layers converged: the AC2/AC3 tests reconstruct `CollisionSystem`/`PlayerDeathSystem`/`ScoringSystem` by hand over a locally-built `[pinwheelPool]` (proving shape-compatibility with the seams) but nothing exercises `ArenaScene`. Dropping `this.pinwheelSystem.enemyPool` from the `enemyPools` array (pinwheels become invincible/unscored/non-lethal), removing `world.addSystem(this.pinwheelSystem)` (the feature is silently dead — never spawns or moves), or breaking the render pass (invisible) would all leave the full suite green. This is the same deliberately-thin Phaser/scene boundary and orchestrator-owned integration-harness deferral logged for Stories 1.1–2.1.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-12: Pinwheels are never despawned or capped and, being genuinely indifferent to the player, are removed ONLY by a bullet kill, so over a run they accumulate faster than the homing Seeker / fleeing Green Square (which cluster near or get shot by the player); past `PINWHEEL_POOL_PREWARM` (32) the pool grows lazily (one-time factory allocation per new instance — not a per-frame hot-loop allocation) and on-screen clutter/collision cost climb. Separately, a pinwheel whose heading grazes a wall (reachable within the ±`PINWHEEL_WANDER_MAX_TURN_RAD` wander) bounces and slides along the border until the next wander turn redirects it inward — a feel item. Both are post-launch tuning entangled with Story 2.5's spawn cap/despawn and difficulty ramp.

origin: migrated from legacy ledger (review of spec-2-2-pinwheel-wanderer-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-2-pinwheel-wanderer-enemy.md`
location: `PinwheelSystem` (no cap/despawn; grazing wall-hug)
reason: Adversarial and edge-case layers converged; the accumulation/no-cap mechanism is the same one logged for the Green Square (Story 2.1) and Seeker, and the epic assigns spawn cadence/mix/cap and per-run reset to Story 2.5 (Escalating Spawn Director). The lazy-growth-past-prewarm allocation is the by-design pooling behavior explicitly rejected as noise in Story 2.1 (steady-state recycling within prewarm is the actual NFR2 requirement and is tested). The grazing wall-hug is real but minor and self-correcting via the periodic wander re-roll; both are feel/balance for playtest tuning, not defects against this story's literal ACs.
status: open

### DW-13: `PinwheelSystem._spawnOne` (like the pre-existing `EnemySystem`/`GreenSquareSystem` spawners) places a new pinwheel at a random arena-edge point with no check against the ship's current position and spawns after the behavior pass, so a fresh pinwheel is a live lethal collider on its first tick and can appear on top of a wall-hugging player for an unavoidable death; because the pinwheel is indifferent to the player it offers no positional cue at all, making the cheap-death vector slightly sharper than the homing/fleeing archetypes. Safe-spawn placement (avoid the ship) plus the pre-active non-lethal telegraph window are explicitly owned by Story 2.6 (Enemy Spawn Telegraph) per the epic.

origin: migrated from legacy ledger (review of spec-2-2-pinwheel-wanderer-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-2-pinwheel-wanderer-enemy.md`
location: `PinwheelSystem._spawnOne`
reason: Adversarial and edge-case layers flagged instant-death-on-spawn; the mechanism is identical to and shared with the Seeker (1.4) and Green Square (2.1), so it is not newly introduced here, and the epic assigns "avoids spawning directly on the ship's current position" plus the telegraph to Story 2.6. Deferred to that story rather than patched here to avoid duplicating spawn-safety logic 2.6 will centralize across all archetypes (mirrors the identical Story 2.1 deferral).
status: done 2026-07-20
resolution: already resolved: PinwheelSystem.js:153-160 calls pickSafeEdgePlacement with ship avoidance, telegraphMs set at :173, gated at :92-96, non-lethal via PlayerDeathSystem.js:116-119. Story 2.6 closed the spawn-safety gap this entry was deferred to it for.

### DW-14: The snake body momentarily compresses when the head reverses off a wall — the follow-the-leader constraint only pulls a segment inward when it is farther than `SNAKE_SEGMENT_SPACING` (never pushes it out), so as the reversed head passes back over its trailing segments they bunch below the spacing for a few ticks before re-stringing along the new heading. A transient feel/visual artifact of the committed slither+wall-bounce+follow motion model; collision stays correct (every segment remains individually lethal/killable), and the real body aesthetic is Epic 4.

origin: migrated from legacy ledger (review of spec-2-3-snake-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md`
location: `SnakeSystem` (follow-the-leader constraint on wall reversal)
reason: Adversarial and edge-case layers converged on the bounce "crumple." It is a genuine emergent consequence of the spec-committed motion model (not a spec deviation and not a correctness bug): the followers reposition only when `dist > SPACING`, so a head reversing toward its own body overruns it until the gaps re-open. Best addressed with the Epic 4 body rendering pass and post-launch feel tuning (how visible the compression reads), alongside any body-reversal handling that a real slither animation introduces.
status: open

### DW-15: Snakes are never despawned or capped and, being indifferent to the player, are removed ONLY when every one of their segments is shot, so over a run whole 8-segment chains accumulate (one per `SNAKE_SPAWN_INTERVAL_MS`); past `SNAKE_SEGMENT_POOL_PREWARM` (64, ≈8 snakes) the shared segment pool grows lazily (one-time factory allocation per new segment — not a per-frame hot-loop allocation) and on-screen clutter / collision cost climb. Post-launch tuning entangled with Story 2.5's spawn cap/despawn and difficulty ramp.

origin: migrated from legacy ledger (review of spec-2-3-snake-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md`
location: `SnakeSystem` (no cap/despawn)
reason: Adversarial layer flagged unbounded accumulation; the mechanism is identical to the Seeker/Green-Square/Pinwheel accumulation already logged for Stories 2.1–2.2, and the epic assigns spawn cadence/mix/cap and per-run reset to Story 2.5 (Escalating Spawn Director). The lazy-growth-past-prewarm allocation is by-design pooling (steady-state recycling within prewarm is the actual NFR2 requirement and is tested, including a 500-step no-growth test); the accumulation cap belongs to 2.5, not this story's literal ACs.
status: done 2026-07-20
resolution: already resolved: Story 2.5 SpawnDirector added a global active-instance cap (SpawnDirector.js:153 'if (_totalActive() >= SPAWN_DIRECTOR_MAX_ACTIVE) continue'), and _totalActive() counts snake segments individually (SpawnDirector.js:164-171); SPAWN_DIRECTOR_MAX_ACTIVE=60 (constants.js:232). Total swarm (snakes included) is now bounded, resolving this entry's sole concern (unbounded snake accumulation).

### DW-16: When a snake's base heading is parallel to the wall it contacts (±π/2 at an x-wall, 0/π at a y-wall), the base-heading reflection is an identity (`π − π/2 == π/2`), yet the ±`SNAKE_SLITHER_AMPLITUDE_RAD` slither component can still drive the head into that wall — the head then grinds along the border (clamped each tick) until it reaches a corner or the slither redirects it, instead of cleanly bouncing. A feel item: reflecting the actual crossing-velocity component (eff heading) rather than the base heading would fix it, but that is a motion-model change best tuned with Story 2.5.

origin: migrated from legacy ledger (review of spec-2-3-snake-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md`
location: `SnakeSystem` (base-heading reflection at parallel-incidence walls)
reason: Adversarial and edge-case layers converged. Reachable (e.g. a top-edge snake with base heading π/2 grazing a side wall while the slither pushes sideways). Collision stays correct and the grind is self-correcting at the next corner/reflection; it mirrors the grazing-incidence wall-hug deferred for the Pinwheel (Story 2.2). Real but minor feel/balance, entangled with post-launch motion tuning — not a defect against this story's literal ACs.
status: open

### DW-17: `SnakeSystem._spawnOne` pins the head just inside a random edge and trails the body OUTWARD behind it, so on spawn up to ~`(SNAKE_SEGMENT_COUNT−1)·SNAKE_SEGMENT_SPACING` (≈154px) of live, collidable, drawn segments sit outside the arena border until the head slithers inward and pulls them in. The player is clamped inside the border so those off-border segments cannot unfairly kill, but a bullet near the edge could score one and the renderer briefly draws segments outside the border. Spawn-safety/placement is owned by Story 2.6 and the visual is Epic 4.

origin: migrated from legacy ledger (review of spec-2-3-snake-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md`
location: `SnakeSystem._spawnOne` (off-border body tail on spawn)
reason: Adversarial layer flagged the off-border spawn tail; it is the explicitly-documented, intended spawn geometry (the snake "emerges from the edge"), acknowledged in the spec's Design Notes as acceptable because the ship is border-clamped. Cleaning it up (spawn wholly inside, cull/hold off-border segments) overlaps the safe-spawn/telegraph work the epic assigns to Story 2.6 and the aesthetic pass in Epic 4 — deferred there rather than reshaping spawn geometry now.
status: open

### DW-18: The `ArenaScene` snake wiring/render surface — the `world.addSystem(snakeSystem)` registration BEFORE `CollisionSystem`, the composition of `snakeSystem.enemyPool` into the shared `enemyPools` array (so segments are killable/scored and lethal, FR6), the late-bind `snakeSystem.collisionSystem = this.collisionSystem` (without which the split reap is a permanent no-op), and the segment render pass — has no automated coverage; consider the same headless wiring harness proposed for Stories 1.4–2.2, extended to assert snakes route through world-tick, collision, death, split, and render.

origin: migrated from legacy ledger (review of spec-2-3-snake-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md`
location: `src/scenes/ArenaScene.js` + `SnakeSystem` (registration order, enemyPools, late-bind collisionSystem, render)
reason: Verification-gap and intent-alignment layers converged: the AC2/AC3 tests reconstruct `CollisionSystem`/`PlayerDeathSystem`/`ScoringSystem` by hand over a locally-built `[segmentPool]` and manually set `system.collisionSystem`, so they prove seam-compatibility but never exercise `ArenaScene`. Dropping the late-bind (splitting silently never happens), omitting the pool from `enemyPools` (snakes non-lethal/unscored), or registering `SnakeSystem` after `CollisionSystem` (reap reads same-tick instead of prior-tick kills) would all leave the full suite green. Same deliberately-thin Phaser/scene boundary and orchestrator-owned integration-harness deferral logged for Stories 1.1–2.2.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-19: `SnakeSystem._spawnOne` pins the new head just inside a random arena edge (`INSET+RADIUS` from the wall) with no check against the ship's current position and acquires it live on the same tick, so a snake head can materialize on top of a border-hugging player for an unavoidable death; the head — unlike the off-border body tail already logged — spawns INSIDE the play border and so can overlap the ship. Safe-spawn placement (avoid the ship's position) plus the pre-active non-lethal telegraph window are explicitly owned by Story 2.6 (Enemy Spawn Telegraph) per the epic.

origin: migrated from legacy ledger (review of spec-2-3-snake-enemy.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-3-snake-enemy.md`
location: `SnakeSystem._spawnOne` (in-border head placement on spawn)
reason: Adversarial and edge-case layers flagged instant-death-on-spawn; the mechanism is identical to and shared with the Seeker (1.4), Green Square (2.1), and Pinwheel (2.2) spawners already deferred to Story 2.6, and is distinct from the snake's existing off-border-spawn-tail entry (which explicitly notes the border-clamped ship cannot be hit by the OUTWARD body segments — the head is the in-border collider this covers). Deferred to Story 2.6 rather than patched here to avoid duplicating spawn-safety logic 2.6 will centralize across all archetypes (mirrors the identical Story 2.1/2.2 deferrals); not a defect against this story's literal ACs, which explicitly exclude spawn-safety.
status: done 2026-07-20
resolution: already resolved: SnakeSystem._spawnOne now re-rolls head placement to avoid the ship (SnakeSystem.js:318-325 via pickSafeEdgePlacement) and the whole chain is non-lethal during the head's telegraph window (gated :243-249; PlayerDeathSystem.js:116-119). The in-border-head instant-death vector this entry covers is closed by Story 2.6.

### DW-20: The Black Hole's feed-driven enemy emission has no per-tick or pool cap, and `BLACKHOLE_GRAVITY_RADIUS` (340) exceeds the min hole-to-edge distance (a hole may sit ~50px from an edge; center-to-short-edge is ~322px), so a seeker emitted at a random arena edge can land back inside the well's gravity field — the "edge-spawn avoids re-feed" claim in the spec Design Notes / `_spawnSeekerAtEdge` comment is only partly true.

origin: migrated from legacy ledger (review of spec-2-4-black-hole-hazard.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-4-black-hole-hazard.md`
location: `BlackHoleSystem._spawnSeekerAtEdge` (emission cap + re-feed geometry)
reason: Adversarial layer flagged a re-feed loop and unbounded emission. The loop is real but sub-critical, not a runaway: `BLACKHOLE_FEED_PER_SPAWN`=4 damps it (each re-absorption is only 1 feed, needing 4 to re-emit), `BLACKHOLE_MAX_RADIUS` caps growth, and homing (140 px/s) beats the outer pull (peaks ~300 px/s only near the core, d<~181px) so most emitted seekers escape. The uncapped accumulation is the same no-cap/despawn concern already deferred to Story 2.5 (Escalating Spawn Director) for every archetype; the constants are explicit placeholders "tuned post-launch." Not a defect against this story's literal ACs (it does grow + periodically spawn).
status: open

### DW-21: Gravity is applied as an independent per-entity position nudge to every enemy including individual snake segments, but `SnakeSystem`'s follow-the-leader constraint only pulls a segment toward its leader when farther than the spacing (never pushes apart), so gravity that compresses a chain below `SNAKE_SEGMENT_SPACING` is never re-separated — a snake that passes through a well can stay permanently clumped after leaving it.

origin: migrated from legacy ledger (review of spec-2-4-black-hole-hazard.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-4-black-hole-hazard.md`
location: `BlackHoleSystem` gravity nudge × `SnakeSystem` follow-the-leader constraint
reason: Adversarial and intent-alignment layers converged. Real but low-impact: a snake compressed enough to clump is usually being absorbed (segments within the hole body are consumed), and a clumped snake is still a lethal body; the effect is a visual/hitbox read degradation. Fixing it cleanly (pull only the head, or bidirectional re-spacing) would require `BlackHoleSystem` to distinguish snake heads from bodies — coupling it to `SnakeSystem` internals the spec forbids — so it is a snake motion-model / feel item entangled with the existing deferred snake wall-grind tuning (Story 2.5) rather than an AC violation.
status: open

### DW-22: `BlackHoleSystem` runs late in the tick and mutates enemy positions (gravity) immediately before `PlayerDeathSystem` tests ship↔enemy contact on those mutated positions, so a well can drag an enemy onto the ship for a same-tick, hard-to-avoid death near the hole.

origin: migrated from legacy ledger (review of spec-2-4-black-hole-hazard.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-4-black-hole-hazard.md`
location: `BlackHoleSystem` tick placement relative to `PlayerDeathSystem` (`src/scenes/ArenaScene.js`)
reason: Adversarial layer flagged near-well fairness. The ship is also pulled and the player retains control (`SHIP_MAX_SPEED` 520 >> peak pull 300 px/s), so it is chaotic-hazard feel rather than a guaranteed death, and it is the same "unavoidable-contact near an uncontrolled event" family as the spawn-safety vectors already deferred to Story 2.6 for every archetype. Not an AC violation (AC1 wants the attractive force; AC3 wants contact to be lethal) — a tuning/telegraph item for 2.5/2.6.
status: open

### DW-23: `BlackHoleSystem._spawnOne` places a hole at a random interior point (whose range spans the arena-center respawn point) with no ship/respawn-proximity check, and gravity ignores the respawn invulnerability window, so a hole can appear on/near the ship or the respawn point and a fresh respawn can land inside the well.

origin: migrated from legacy ledger (review of spec-2-4-black-hole-hazard.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-4-black-hole-hazard.md`
location: `BlackHoleSystem._spawnOne` (interior placement vs ship/respawn point)
reason: Edge-case and adversarial layers flagged the respawn/spawn overlap. Mirrors the spawn-safety deferrals already logged for the Seeker (1.4), Green Square (2.1), Pinwheel (2.2), and Snake head (2.3) — spawn-safety/placement (avoid the ship's position) plus the pre-active non-lethal telegraph are explicitly owned by Story 2.6 per the epic; the `PLAYER_INVULN_MS` (2000ms) window + player mobility mitigate the respawn case. Deferred to 2.6 rather than duplicating spawn-safety logic here; not a defect against this story's literal ACs, which exclude spawn-safety.
status: open

### DW-24: The load-bearing `ArenaScene` wiring — the registration order (BlackHole AFTER Scoring so absorbed enemies are removed-but-not-scored, BEFORE PlayerDeath), the `deathPools = [...enemyPools, holePool]` composition (hole lethal-on-contact but NOT in the `CollisionSystem` one-shot list), and the late-bound `collisionSystem` — plus the AC1 "the gravity position-nudge survives the movers" invariant, have no automated coverage; the unit tests hand-reproduce the tick order and the death list rather than driving the real scene, and no test runs the nudge through a real mover.

origin: migrated from legacy ledger (review of spec-2-4-black-hole-hazard.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-4-black-hole-hazard.md`
location: `src/scenes/ArenaScene.js` (BlackHole registration order, deathPools composition, late-bound collisionSystem)
reason: Verification-gap and intent-alignment layers converged. This is the same deliberately-thin Phaser/scene integration-harness gap deferred for Stories 1.1–2.3 (no test imports `ArenaScene`; a reordered `addSystem` or an omitted `holePool` would ship green). The intent-alignment layer additionally found the spec Design Notes' blanket rationale ("every mover advances position as `x += …`, never an absolute assignment") is imperfect — `SnakeSystem` absolute-assigns body-segment positions and `GreenSquare`/`Pinwheel` absolute-assign on wall clamp — yet the AC1 observable (ship/enemies/bullets are pulled toward the well) still holds for every archetype because the snake HEAD integrates and the body follows it, and the absolute-assigns are wall-clamp edge writes, not the steady path. Closing both needs the orchestrator-owned scene/World integration harness (and, optionally, a headless mover+BlackHoleSystem tick test); the observable is satisfied, so this is a coverage/rationale-accuracy gap, not a functional defect against the ACs.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-25: The `SpawnDirector`'s load-bearing `ArenaScene` wiring has no automated coverage — the registration order (director added AFTER `SnakeSystem`, BEFORE `CollisionSystem`, so a director-spawned enemy is present but un-moved for this tick's collision, reproducing the old self-spawn timing), the mapping of the eight `SPAWN_DIRECTOR_*` weight constants onto the correct four archetypes, and reset-by-reconstruction on `scene.restart()` (AC3) are verified only by unit tests on a bare director over fakes plus `npm run build` and a manual run. A reordered `addSystem`, a base/peak weight swapped onto the wrong archetype, or a regression that made the director persist across restart (defeating the ramp reset) would ship green.

origin: migrated from legacy ledger (review of spec-2-5-escalating-spawn-director.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-2-5-escalating-spawn-director.md`
location: `src/scenes/ArenaScene.js` + `SpawnDirector` (registration order, weight→archetype mapping, restart reset)
reason: Adversarial, verification-gap, and intent-alignment layers converged. This is the same deliberately-thin Phaser/scene integration-harness gap deferred for Stories 1.1–2.4 (no test imports `ArenaScene`). The AC3 reset test builds a second fresh director and asserts the base ramp — the constructor surface, not the `scene.restart()` lifecycle surface where the intent lives — which the spec Design Notes explicitly acknowledge as the unit-level proxy for reset-by-reconstruction; the real `create()`/`scene.restart()` path is present and correct (ArenaScene construct + restart) but only build/manual-verified. Closing it needs the orchestrator-owned scene/World integration harness (a world-order assertion that the director sits between Snake and Collision, and a restart smoke test). Not a defect against this story's literal ACs.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-26: The shared per-kill scoring seam (`ScoringSystem.fixedUpdate`) computes `killedEnemies[i].score * multiplier` with no guard on `.score`; a future enemy archetype pooled without a numeric `score` field would make the award `NaN` and permanently poison `ScoreState.score` (the HUD and game-over screen then render `NaN` for the rest of the run).

origin: migrated from legacy ledger (review of spec-3-1-score-multiplier-system.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-3-1-score-multiplier-system.md`
location: `ScoringSystem.fixedUpdate` (unguarded `.score` multiply)
reason: Adversarial and edge-case layers converged. Pre-existing latent gap — the pre-multiplier code (`+= killed[i].score`) had the identical exposure — so it was not introduced by this story, and it is not reachable today (all four current factories carry a numeric `score`). It is real for the seam's stated purpose (every future archetype credits through this one type-agnostic path, per the ScoringSystem contract). Close it when the seam gains its next consumer with a `typeof base === 'number'` guard or a dev-time finite-number assert. Not a defect against this story's literal ACs.
status: open

### DW-27: The load-bearing four-system tick order (Collision→Scoring→BlackHole→Bomb→PlayerDeath) that every Smart-Bombs guarantee rests on — unscored clear (Bomb after Scoring), same-tick rescue (Bomb before PlayerDeath), and a fully-settled score for the +1-bomb award (Bomb after BlackHole) — is asserted only inside `bombIntegration.test.js`'s own hardcoded `runTick`; no test binds it to `ArenaScene`'s real `addSystem` registration order, so a future reorder of `BombSystem` in the scene would pass every test while silently breaking all three guarantees in the running game.

origin: migrated from legacy ledger (review of spec-3-2-smart-bombs.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-3-2-smart-bombs.md`
location: `src/scenes/ArenaScene.js` (BombSystem registration order) vs `bombIntegration.test.js`
reason: Verification-gap layer flagged it as the strongest gap (broken-verification-gap); adversarial and intent-alignment layers corroborated that the whole feature's correctness hinges on placement. Same deliberately-thin Phaser/scene integration-harness gap deferred for Stories 1.1–3.1 (no test imports `ArenaScene`; its `addSystem` order is unverified repo-wide). Closing it needs the orchestrator-owned scene/World integration harness — most cleanly a single shared ordered-system factory that both `ArenaScene` and `bombIntegration.test.js` consume, so a scene reorder fails a test (a refactor, not a trivial patch). Not a defect against this story's literal ACs; the code is currently correct and the behavior (given the order) is fully covered.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-28: ExtraLifeSystem's load-bearing tick placement (after Scoring/BlackHole/Bomb so the milestone award reads a fully-settled score, before PlayerDeath so an earned life is banked ahead of the death check → the last-life same-tick rescue) is asserted only inside `extraLifeIntegration.test.js`'s own hardcoded `runTick`; no test binds it to `ArenaScene`'s real `addSystem` registration order, so a future reorder of `ExtraLifeSystem` in the scene would pass every test while silently breaking the settled-score award and the same-tick rescue in the running game.

origin: migrated from legacy ledger (review of spec-3-3-extra-lives.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-3-3-extra-lives.md`
location: `src/scenes/ArenaScene.js` (ExtraLifeSystem registration order) vs `extraLifeIntegration.test.js`
reason: Verification-gap and adversarial layers converged on this as the strongest gap (regression-gap). It is the SAME repo-wide untested-Phaser-scene integration gap already deferred for Stories 1.1–3.2 (no test imports `ArenaScene`; its `addSystem` order is unverified everywhere). Closing it needs the orchestrator-owned scene/World integration harness — most cleanly one shared ordered-system factory that both `ArenaScene` and the integration tests consume, so a scene reorder fails a test (a refactor, not a trivial patch). Not a defect against this story's literal ACs; the code is currently correct (verified: BlackHole registered at ArenaScene 241 < ExtraLife 295 < PlayerDeath 305) and the behavior (given the order) is covered by the hand-built chain.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-29: HighScoreSystem's load-bearing tick placement (registered AFTER PlayerDeathSystem so it observes `gameOver` on the same tick a last-life contact latches it — before the `if (!gameOver) world.fixedUpdate` gate freezes the world next tick — and persists the beaten score) is asserted only inside `highScoreIntegration.test.js`'s own hardcoded `runTick`; no test binds it to `ArenaScene`'s real `addSystem` registration order, so a future reorder of `HighScoreSystem` before `PlayerDeathSystem` would pass every test while silently shipping a game that never persists the high score (the system would see `gameOver=false` on the latching tick, then never run again once the gate engages).

origin: migrated from legacy ledger (review of spec-3-4-persistent-high-score.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-3-4-persistent-high-score.md`
location: `src/scenes/ArenaScene.js` (HighScoreSystem registration order) vs `highScoreIntegration.test.js`
reason: Verification-gap layer flagged it CONFIRMED as the strongest gap (broken-verification-gap); adversarial layer corroborated. It is the SAME repo-wide untested-Phaser-scene integration gap already deferred for Stories 1.1–3.3 (no test imports `ArenaScene`; its `addSystem` order is unverified everywhere — `grep` for ArenaScene imports returns only `src/main.js`). Closing it needs the orchestrator-owned scene/World integration harness — most cleanly one shared ordered-system factory that both `ArenaScene` and the integration tests consume, so a scene reorder fails a test (a refactor, not a trivial patch; importing `ArenaScene` in a node/no-jsdom test is not viable — `create()` needs a full Phaser scene context). Not a defect against this story's literal ACs; the code is currently correct (verified: PlayerDeath registered at ArenaScene.js:307 < HighScore at :326) and the behavior (given the order) is covered by the hand-built chain.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-arena-world-wiring-harness

### DW-30: The Story 4.4 juice adds a full-screen white flash (peak alpha 1) and a camera shake on every bomb detonation and player death, with no reduced-motion / flash-off / juice-intensity setting anywhere — a photosensitivity and motion-sickness accessibility gap (WCAG 2.3.1 territory) with no escape hatch for affected players.

origin: migrated from legacy ledger (review of spec-4-4-screen-juice-and-feedback.md), 2026-07-20
source_spec: `{project-root}/_bmad-output/implementation-artifacts/spec-4-4-screen-juice-and-feedback.md`
location: `src/scenes/ArenaScene.js` (flash/shake juice) + settings/persistence infrastructure
reason: Adversarial review layer flagged the missing accessibility controls; the flash color (0xffffff), peak alpha, shake magnitude, and hit-stop are all live juice on the two biggest events. Real product concern, but out of this story's ACs and unbuildable now — there is no settings/persistence infrastructure yet (Epic 5 Story 5.3 owns settings and persisted preferences; the epic context also ties audio mute/volume persistence to that same story). Closing it belongs with that settings work (or a dedicated accessibility story): a persisted juice-intensity / reduced-motion preference read by ArenaScene to scale or disable shake+flash. The acute rapid-flash seizure trigger is largely unreachable in practice (bomb/death flashes are seconds apart, not >3/sec), so this is a settings/accessibility feature, not a live-defect against the current ACs.
status: open

### DW-31: The new TitleScene offers gamepad-button start, but ArenaScene's game-over screen still binds only Enter/Space/pointer to restart, so a gamepad-only player is stranded at game over.

origin: migrated from legacy ledger (review of spec-5-1-title-and-start-screen.md), 2026-07-20
source_spec: `_bmad-output/implementation-artifacts/spec-5-1-title-and-start-screen.md`
location: `src/scenes/ArenaScene.js:689-691` (game-over restart binding)
reason: TitleScene binds `this.input.gamepad?.on('down', start)`; ArenaScene.js:689-691 restart binds only keydown-ENTER/keydown-SPACE/pointerdown. Game-over/restart flow is explicitly out of Story 5.1 scope — belongs to the Story 5.3 state machine and 5.4 gamepad polish.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-gamepad-input-robustness

### DW-32: ArenaScene's in-run audio keys (`M` mute, `-`/`+` volume) lack the `event.repeat` held-key guard that the new SettingsScene (and Story 5.2's pause) apply, so holding one steps every OS auto-repeat tick and the same control behaves differently in-run vs on the settings screen.

origin: migrated from legacy ledger (review of spec-5-3-game-flow-state-machine.md), 2026-07-20
source_spec: `_bmad-output/implementation-artifacts/spec-5-3-game-flow-state-machine.md`
location: `src/scenes/ArenaScene.js` (keydown-M/MINUS/PLUS handlers)
reason: Edge/adversarial review flagged the inconsistency. ArenaScene.js keydown-M/MINUS/PLUS handlers have no `if (event && event.repeat) return;` guard, whereas SettingsScene.js's identical handlers do (and Story 5.2 added the same guard to pause after its own review). Pre-existing Story 4.5 code, not caused or touched by Story 5.3 (which only swapped the storage port), so out of this story's scope — a one-line guard per handler when in-run audio input is next revisited (e.g. Story 5.4 input polish).
status: done 2026-07-20
resolution: resolved by sweep bundle dw-in-run-audio-key-repeat-guard

### DW-33: The gamepad smart-bomb binding (`GAMEPAD_BOMB_BUTTONS = [4, 5]`) and the stick reads assume the W3C "standard" gamepad mapping without checking `pad.mapping`, so a non-standard controller can report different bumper indices — leaving the smart bomb unbindable or misbound on those pads.

origin: migrated from legacy ledger (review of spec-5-4-input-config-and-gamepad-polish.md), 2026-07-20
source_spec: `_bmad-output/implementation-artifacts/spec-5-4-input-config-and-gamepad-polish.md`
location: `PlayerInputSampler` (`isBombButton`, `GAMEPAD_BOMB_BUTTONS`, stick reads)
reason: Adversarial review flagged it. `isBombButton` matches raw indices 4/5 and `isGamepadActive`/`sampleMove`/`sampleAim` read `pad.leftStick`/`pad.rightStick` — all standard-mapping assumptions. Pre-existing across the whole input path (the sticks already assume standard mapping since Stories 1.2/1.3); Story 5.4 extends the same assumption to the new bomb binding rather than introducing it. Not a defect against this story's literal ACs (which presume a conventional twin-stick pad), and Phaser normalizes most common controllers to standard mapping. Closing it needs a mapping-aware button/axis resolution (or a `pad.mapping === 'standard'` guard with a documented fallback) applied uniformly to sticks and the bomb — a broader input-robustness pass, not a trivial patch.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-gamepad-input-robustness

### DW-34: `PlayerInputSampler.getPad()` hard-pins gamepad index 0, so on a disconnect+reconnect where the browser reassigns the pad a non-zero `Gamepad.index`, `getPad(0)` returns null and the physically-connected, actively-used controller drives nothing until the player switches to keyboard/mouse.

origin: migrated from legacy ledger (review of spec-5-4-input-config-and-gamepad-polish.md), 2026-07-20
source_spec: `_bmad-output/implementation-artifacts/spec-5-4-input-config-and-gamepad-polish.md`
location: `PlayerInputSampler.getPad()` (hard-pinned index 0)
reason: Adversarial and edge-case review layers converged on it. `getPad()` returns `gp.getPad(0)` (verified: Phaser's `getPad` matches on `Gamepad.index`, and browsers can reassign a reconnected pad to index 1+). Pre-existing — the index-0 pin predates Story 5.4 (the old sampler already called `this.getPad()`); this story only added the `pad.connected` guard, which bounds the stuck-frozen-stick damage on disconnect but does not re-home input to the new slot. Not a defect against this story's literal ACs (which presume "a connected gamepad" — the single index-0 pad of a single-player game). Closing it needs `getPad()` to select the first *connected* pad (e.g. `gp.getAll().find(p => p.connected)`) instead of index 0, plus a harness update — a small robustness pass best done alongside any multi-pad or reconnect-handling work.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-gamepad-input-robustness

### DW-35: Story 5.5's headline ACs are verified one surface below where they live — NFR1 (60 FPS under peak load on mid-range hardware) and NFR7 (live canvas resize/letterbox + "no debug readout visible" in the shipped build) are manual-only, and NFR6 build correctness (dist relative asset paths, emitted separate phaser vendor chunk, tree-shaken "render FPS"/"sim ticks/s" strings) is asserted at the vite.config/source surface and via the `npm run build` verification command rather than an automated test that inspects the built `dist/` artifact.

origin: migrated from legacy ledger (review of spec-5-5-performance-hardening-and-web-build.md), 2026-07-20
source_spec: `_bmad-output/implementation-artifacts/spec-5-5-performance-hardening-and-web-build.md`
location: `buildConfig.test.js` / `vite.config` / `src/main.js` / built `dist/` artifact
reason: All four review layers converged on the surface mismatch. No test constructs `ArenaScene` or runs a real build: `buildConfig.test.js` imports the vite config object and regex-matches `main.js` source text (both un-importable headlessly — `main.js` runs `new Phaser.Game` at load), and the NFR2 property is proven via a pool-count no-growth proxy, not a GC/allocation measurement. This is the same deliberately-thin Phaser/scene + build-artifact manual-verification boundary logged as orchestrator-owned for Stories 1.1–5.4; closing it needs a scene/World integration harness and/or a build-then-inspect smoke step (build-before-test ordering, better as a CI script than a vitest unit) beyond this story's captured intent. The DEV-gate source-text guard added this pass bounds the highest-risk regression (a production-only `debugText` crash) without the full harness.
status: done 2026-07-20
resolution: resolved by sweep bundle dw-build-artifact-verification-test

- source_spec: `_bmad-output/implementation-artifacts/spec-6-2-black-hole-instability-rework.md`
  summary: A black-hole detonation that occurs while the player is invulnerable (or already game-over) fires the smart-bomb screen clear and releases the hole, but the life cost is suppressed by the normal death guards — yielding a no-life-cost board wipe within the respawn-invulnerability window.
  evidence: BlackHoleSystem's detonation calls `bombSystem.detonateAt` and sets `playerState.pendingDeath` unconditionally, while PlayerDeathSystem read-and-clears (drops) `pendingDeath` without a death when `invulnMs > 0`/`gameOver`. Behavior is AC2-compliant (AC2 routes the cost through the "normal death/respawn flow", which respects invulnerability) and consistent with the game's invuln semantics, so it is not a defect against the literal ACs — but three review layers flagged it as a real balance concern. Resolving it (couple the screen clear to the life actually being spent, or defer the detonation until the player is vulnerable) is a design/tuning decision, not a mechanical fix.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-2-black-hole-instability-rework.md`
  summary: Detonation life-cost accounting is per-tick, not per-hole — the `detonateHoles` loop sets the boolean `playerState.pendingDeath` once for any number of simultaneous detonations while each hole still runs a full smart-bomb screen clear, so if `BLACKHOLE_MAX_ACTIVE` is ever raised above 1, N holes detonating in one tick cost the player only one life but clear the screen N times.
  evidence: `BlackHoleSystem.js:318-322` iterates `detonateHoles`, calling `bombSystem.detonateAt(...)` per hole but assigning `playerState.pendingDeath = true` (a boolean latch PlayerDeathSystem consumes once) — asymmetric with the implosion loop at `:325-327`, which credits `BLACKHOLE_SCORE` per hole. Not reachable today (`BLACKHOLE_MAX_ACTIVE = 1` caps active holes at one) and both blind-hunter and edge-case layers flagged it as latent, but the spec Design Notes explicitly state "the detonation buffer is coded for N," so the boolean life cost contradicts that stated N-hole robustness goal. Fix would count deaths (or clear per detonation) rather than latch once — a small change gated behind any future multi-hole tuning.
