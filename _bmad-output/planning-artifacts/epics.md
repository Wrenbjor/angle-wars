---
stepsCompleted: []
inputDocuments: [prd.md]
---

# Angle Wars - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Angle Wars, decomposing the requirements from the PRD into implementable, single-session stories. Angle Wars is a 1:1 clone of *Geometry Wars: Retro Evolved* built in Phaser (WebGL). Epics are ordered **spine-first**: a production-grade playable core is proven before the signature aesthetic is layered on. No story depends on a future story.

## Requirements Inventory

### Functional Requirements

- **FR1** — Twin-stick control: movement and aim independent (gamepad; keyboard-move + mouse-aim fallback).
- **FR2** — Continuous auto-fire in the aim direction at a fixed cadence.
- **FR3** — Bounded rectangular arena; ship clamped to bounds; bullets despawn at edge.
- **FR4** — Enemy roster with faithful behaviors (Seeker, Green Square, Pinwheel/Wanderer, Snake, Black Hole).
- **FR5** — Endless spawn director with escalating difficulty (rate + mix).
- **FR6** — Collision: bullets destroy enemies; enemy/hazard contact kills the player.
- **FR7** — Score per kill, weighted by enemy type, times the current multiplier.
- **FR8** — Multiplier increments on kills, caps at 10×, resets to 1× on death.
- **FR9** — Smart bombs: 3 to start, screen-clear shockwave, +1 per 100,000 points.
- **FR10** — Extra lives at score thresholds.
- **FR11** — Persistent local high score.
- **FR12** — Player death: lose a life, respawn invulnerability, out of lives → game over.
- **FR13** — Black hole: gravity on ship/enemies/bullets, grid distortion, spawns enemies, destructible.
- **FR14** — Game flow: title → play → game over → restart/title.
- **FR15** — Pause and resume.
- **FR16** — Input: gamepad twin-stick with deadzones + keyboard/mouse fallback; hot-swap.
- **FR17** — Accessibility/feel: grid kill-ripple toned down by default; a persisted Reduced-Motion setting scales down or disables grid warp, the full-screen flash, and camera shake (WCAG 2.3.1).
- **FR18** — Black-hole instability (revises FR13): absorbing matter grows the hole toward an unstable threshold; reaching it detonates as a lethal, screen-clearing blast that costs the player a life; sustained fire shrinks it to a safe destruction; a rising red pulse + audio urgency track its approach to instability.
- **FR19** — Mirror Reflector ("dumbbell") hazard: a spinning two-weight bar that drifts the arena and reflects player bullets off its bar; immune to gunfire, destroyed only by flying the ship through its center; the weights are lethal on contact.
- **FR20** — Touch twin-stick control: on-screen floating dual thumbsticks (left half = move, right half = aim, holding aim auto-fires) plus an on-screen smart-bomb button, feeding the same move/aim/bomb intent seam as gamepad and keyboard/mouse, and hot-swapping with them.
- **FR21** — Mobile layout: landscape orientation lock; the WebGL canvas fits varied phone aspect ratios while preserving the arena's playable aspect; HUD and touch controls respect device safe-area insets (notches, rounded corners, home indicator) and never occlude critical play space.
- **FR22** — Native mobile shell: the static web build is packaged as an installable iOS and Android app via Capacitor, running the full game inside the native WebView.
- **FR23** — Native lifecycle & feel: the game auto-pauses when the app is backgrounded or loses focus; the Android hardware back button is handled; short haptic pulses fire on key feel events (death, bomb, extra life) where supported; the display is kept awake during an active run.

### NonFunctional Requirements

- **NFR1** — Sustain 60 FPS under peak load (hundreds of entities + thousands of particles).
- **NFR2** — Object pooling for all high-churn entities; zero per-frame allocation in the hot loop.
- **NFR3** — Fixed-timestep simulation decoupled from render.
- **NFR4** — Neon aesthetic via additive blending + Bloom post-FX.
- **NFR5** — Deforming grid on the GPU (mesh/shader).
- **NFR6** — Static web build; fast first load; no server.
- **NFR7** — Cross-browser desktop; responsive canvas scaling preserving arena aspect.
- **NFR8** — Clean, extensible entity/system architecture (ready for v2 powers/progression).
- **NFR9** — Mobile performance profile: sustain the mobile framerate target on a mid-range phone GPU inside a WebView by scaling particle caps, bloom cost, and grid resolution down from desktop defaults through the existing centralized quality/feel constants.
- **NFR10** — Store-ready packaging: app icons, splash screens, orientation/permission manifests, and iOS + Android signing/build configuration sufficient to submit to the Apple App Store and Google Play.

### Additional Requirements

- Local persistence via `localStorage` (high score + settings).
- Deployable static bundle (e.g. Vite).
- All feel constants centralized/tunable (post-launch playtest tuning per PRD Pillar 3).

### UX Design Requirements

- No separate UX doc for v1. HUD, title, pause, and game-over layouts are specified inline within the relevant stories.

### FR Coverage Map

| Requirement | Covered by |
|-------------|------------|
| FR1 | 1.2 |
| FR2 | 1.3 |
| FR3 | 1.1, 1.2, 1.3 |
| FR4 | 1.4, 2.1, 2.2, 2.3, 2.4 |
| FR5 | 2.5, 2.6 |
| FR6 | 1.4, 1.5 |
| FR7 | 1.6, 3.1 |
| FR8 | 3.1 |
| FR9 | 3.2 |
| FR10 | 3.3 |
| FR11 | 3.4 |
| FR12 | 1.5, 3.3 |
| FR13 | 2.4, 4.2 |
| FR14 | 1.6, 5.3 |
| FR15 | 5.2 |
| FR16 | 1.2, 1.3, 5.4 |
| NFR1 | 2.5, 4.3, 5.5 |
| NFR2 | 1.3, 1.4, 4.3, 5.5 |
| NFR3 | 1.1 |
| NFR4 | 4.1 |
| NFR5 | 4.2 |
| NFR6 | 5.5 |
| NFR7 | 1.1, 5.5, 7.2 |
| NFR8 | 1.1 (foundation), all entity stories |
| FR20 | 7.1 |
| FR21 | 7.2 |
| FR22 | 7.3 |
| FR23 | 7.5 |
| NFR9 | 7.4 |
| NFR10 | 7.6 |

## Epic List

1. **Epic 1 — Playable Core Loop:** A production-grade vertical slice — bootstrap, twin-stick ship, firing, one homing enemy, death, and score/HUD — proving the core feel.
2. **Epic 2 — Enemy Roster & Spawn Director:** The remaining RE1 enemy archetypes and the endless escalating spawn system with safe spawn telegraphing.
3. **Epic 3 — Score, Multiplier, Bombs & Lives:** The RE1 economy — the 10× multiplier that resets on death, smart bombs, extra lives, and persistent high score.
4. **Epic 4 — Signature Aesthetic & Juice:** Neon bloom, the deforming grid, the pooled particle system, screen feel, and audio.
5. **Epic 5 — Game Shell, Flow & Release:** Title, pause, full game-flow state machine, input polish, and performance-hardened web build.
6. **Epic 6 — Feel & Signature Hazards (Post-Launch Tweaks):** Discovered-through-play refinements — calmer visual feedback with reduced-motion accessibility, the black hole re-cast as an unstable ticking bomb, and the mirror-reflector "dumbbell" hazard.
7. **Epic 7 — Mobile (Capacitor Shell & Touch Play):** Take the finished web build to phones — on-screen twin-stick touch controls, a safe-area-aware landscape layout, a Capacitor native shell around the static bundle, a mobile performance profile, native lifecycle/haptics, and store-submission scaffolding. IAP/ads deferred to a later epic.

---

## Epic 1: Playable Core Loop

**Goal:** Stand up a production-grade (not throwaway) vertical slice that proves the twin-stick feel and the kill/die loop: a ship you can move and aim independently, continuous firing, one enemy that spawns and homes and dies to bullets, player death with lives, and a live score/HUD with a game-over/restart. No aesthetic yet — placeholder vector shapes. Establishes the engine foundation (fixed-timestep loop, scene structure, pooling) all later epics build on.

### Story 1.1: Project Bootstrap and Game Shell

As a developer,
I want a running Phaser project with a scene structure and a fixed-timestep game loop,
So that every later story has a stable, production-grade foundation to build on.

**Acceptance Criteria:**

**Given** a fresh checkout
**When** I run the dev build command
**Then** a browser window opens showing a bounded rectangular arena on a WebGL canvas
**And** the project has Boot, Preload, and Arena scenes wired in sequence

**Given** the game is running
**When** the update loop executes
**Then** simulation runs on a fixed timestep decoupled from render frame rate (NFR3)
**And** the canvas scales responsively to the window while preserving the arena's aspect ratio (NFR7)

**Given** the codebase
**When** a reviewer inspects it
**Then** an entity/system structure and a reusable object-pool utility exist as the foundation for later entities (NFR8, NFR2)

### Story 1.2: Player Ship and Twin-Stick Movement

As a player,
I want to fly my ship around the arena,
So that I can dodge and reposition.

**Acceptance Criteria:**

**Given** a running game
**When** I push the movement input (gamepad left stick, or WASD/arrows)
**Then** the ship accelerates in that direction with velocity, thrust, and drag, and the ship sprite rotates to face travel/aim

**Given** the ship is moving toward the arena edge
**When** it reaches the boundary
**Then** it is clamped inside the arena and cannot leave (FR3)

**Given** no movement input
**When** the ship is drifting
**Then** drag slows it to a stop smoothly (feel constants centralized for later tuning)

### Story 1.3: Twin-Stick Firing

As a player,
I want my ship to continuously fire in the direction I aim, independent of where I'm moving,
So that I can shoot one way while flying another — the core of twin-stick play.

**Acceptance Criteria:**

**Given** the game is running
**When** I provide aim input (gamepad right stick, or mouse position)
**Then** the ship fires bullets continuously in the aim direction at a fixed cadence (FR2), independent of movement direction (FR1)

**Given** bullets are being fired rapidly
**When** many exist at once
**Then** bullets are drawn from an object pool with no per-frame allocation (NFR2)

**Given** a bullet reaches the arena edge
**When** it crosses the boundary
**Then** it is despawned and returned to the pool (FR3)

### Story 1.4: Blue Seeker Enemy

As a player,
I want an enemy that hunts me and can be shot,
So that there is something to fight and score against.

**Acceptance Criteria:**

**Given** the game is running
**When** a Blue Seeker spawns
**Then** it immediately homes toward the player's current position (FR4) and is drawn from an enemy pool (NFR2)

**Given** a Seeker is on screen
**When** a player bullet collides with it
**Then** the Seeker is destroyed and returned to its pool, and the bullet is consumed (FR6)

**Given** multiple Seekers
**When** they pursue the player simultaneously
**Then** each tracks independently without frame-rate-dependent speed (uses fixed-timestep motion)

### Story 1.5: Player Death and Collision

As a player,
I want to die when an enemy touches me and respawn to keep playing,
So that there are real stakes to the loop.

**Acceptance Criteria:**

**Given** the ship and an enemy are in the arena
**When** the enemy collides with the ship
**Then** the player dies, a life is deducted, and the ship respawns at center with a brief invulnerability window (FR6, FR12)

**Given** the player has just respawned
**When** they are within the invulnerability window
**Then** enemy contact does not kill them and the ship indicates the invulnerable state

**Given** the player has 0 lives remaining
**When** they are killed
**Then** the run ends and the game transitions to a game-over state (FR12)

### Story 1.6: Score and HUD

As a player,
I want to see my score and lives and a game-over screen,
So that I know how I'm doing and can start again.

**Acceptance Criteria:**

**Given** the game is running
**When** I destroy an enemy
**Then** score increases (base per-type value; multiplier is introduced in Epic 3) and the on-screen score updates immediately (FR7)

**Given** the game is running
**When** I look at the HUD
**Then** current score and remaining lives are displayed clearly

**Given** the player runs out of lives
**When** the game-over state is reached
**Then** a game-over screen shows the final score and offers restart, and restarting begins a fresh run (FR14)

---

## Epic 2: Enemy Roster & Spawn Director

**Goal:** Complete the faithful RE1 threat set and make the arena come alive with an endless, escalating swarm. Add the remaining enemy archetypes with their distinct behaviors, the black hole hazard, and a spawn director that ramps rate and mix over time — with safe spawn telegraphing so the player is never killed by an instant spawn.

### Story 2.1: Green Square Enemy

As a player,
I want an enemy that runs from me until provoked,
So that the arena has varied, characterful threats.

**Acceptance Criteria:**

**Given** a Green Square has spawned
**When** the player has not fired at it
**Then** it flees away from the player, moving agilely around the arena (FR4)

**Given** a Green Square is fleeing
**When** the player fires toward it / it is threatened
**Then** it switches to aggressive behavior and pursues the player

**Given** a player bullet hits it
**When** collision occurs
**Then** it is destroyed and pooled, awarding its score value

### Story 2.2: Pinwheel/Wanderer Enemy

As a player,
I want a drifting enemy that ignores me but clutters the arena,
So that the space fills with hazards I must weave through.

**Acceptance Criteria:**

**Given** a Pinwheel/Wanderer spawns
**When** it moves
**Then** it drifts along a pseudo-random trajectory indifferent to the player (FR4), bouncing off arena walls

**Given** it contacts the ship
**When** collision occurs
**Then** it kills the player like any enemy (FR6)

**Given** a player bullet hits it
**When** collision occurs
**Then** it is destroyed and pooled, awarding its score value

### Story 2.3: Snake Enemy

As a player,
I want a long segmented enemy that is dangerous along its whole body,
So that big threats force me to reposition.

**Acceptance Criteria:**

**Given** a Snake spawns
**When** it moves
**Then** it slithers as a connected multi-segment body following a head, dangerous along its full length (FR4)

**Given** the ship contacts any segment
**When** collision occurs
**Then** the player dies (FR6)

**Given** the player fires at the Snake
**When** segments are hit
**Then** it takes damage/breaks apart per faithful behavior and awards score, using pooled segments (NFR2)

### Story 2.4: Black Hole Hazard

As a player,
I want a gravity well that pulls everything toward it and pays off big when destroyed,
So that the arena has the signature RE1 high-risk objects.

**Acceptance Criteria:**

**Given** a Black Hole is present
**When** the ship, enemies, or bullets are near it
**Then** it exerts an attractive gravitational force on all of them (FR13)

**Given** the Black Hole absorbs matter
**When** it is fed (bullets/enemies)
**Then** it grows and periodically spawns new enemies (FR13)

**Given** the player damages it enough
**When** it is destroyed
**Then** it detonates with a payout burst and is removed; contact with an undestroyed black hole kills the player

> The grid-warping visual of the black hole is delivered in Story 4.2; this story implements its gravity and lifecycle with placeholder visuals.

### Story 2.5: Escalating Spawn Director

As a player,
I want the swarm to grow endlessly harder the longer I survive,
So that every run builds tension and eventually overwhelms me.

**Acceptance Criteria:**

**Given** a run is in progress
**When** time elapses
**Then** the spawn director increases spawn rate and shifts the enemy mix toward tougher combinations on a continuous ramp (FR5)

**Given** peak-difficulty spawning
**When** many enemies and bullets are active
**Then** the game sustains 60 FPS via pooling and efficient updates (NFR1, NFR2)

**Given** a fresh run after game over
**When** it begins
**Then** difficulty resets to the starting ramp

### Story 2.6: Enemy Spawn Telegraph

As a player,
I want enemies to visibly warn before they become lethal,
So that I'm never killed by an enemy that appeared on top of me.

**Acceptance Criteria:**

**Given** an enemy is about to spawn
**When** it appears
**Then** it plays a brief spawn-in telegraph (fade/scale/pulse) during which it cannot kill the player

**Given** the telegraph completes
**When** the enemy becomes active
**Then** it begins its normal behavior and can collide lethally

**Given** the spawn director places enemies
**When** choosing spawn points
**Then** it avoids spawning directly on the ship's current position

---

## Epic 3: Score, Multiplier, Bombs & Lives

**Goal:** Implement the RE1 economy that turns a shooter into *Geometry Wars* — the multiplier that climbs to 10× and is lost on death, screen-clearing smart bombs, extra lives at thresholds, and a persistent high score. This is where the risk/reward soul of the game arrives.

### Story 3.1: Score Multiplier System

As a player,
I want a multiplier that rewards a killing streak and punishes death,
So that staying alive matters as much as shooting.

**Acceptance Criteria:**

**Given** a run in progress
**When** I destroy enemies without dying
**Then** my score multiplier increases up to a hard cap of 10× (FR8) and is shown on the HUD

**Given** my current multiplier
**When** I destroy an enemy
**Then** the awarded score = enemy base value × current multiplier (FR7)

**Given** any multiplier value
**When** the player dies
**Then** the multiplier resets to 1× immediately (FR8) — the core RE1 tension

### Story 3.2: Smart Bombs

As a player,
I want emergency bombs that clear the screen,
So that I can escape a hopeless swarm at a cost.

**Acceptance Criteria:**

**Given** a new game
**When** it starts
**Then** the player has 3 bombs, shown on the HUD (FR9)

**Given** the player has at least one bomb
**When** they press the bomb input
**Then** all on-screen enemies are destroyed with an expanding shockwave and the bomb count decreases by one (FR9)

**Given** the player's score crosses a multiple of 100,000
**When** the threshold is passed
**Then** the player is awarded one additional bomb (FR9)

### Story 3.3: Extra Lives

As a player,
I want to earn extra lives by scoring well,
So that skilled runs last longer.

**Acceptance Criteria:**

**Given** a run in progress
**When** the score crosses a defined life threshold
**Then** the player gains an extra life and the HUD updates (FR10)

**Given** the life count
**When** displayed
**Then** it reflects deaths (Epic 1) and awards consistently, and reaching 0 still ends the game (FR12)

### Story 3.4: Persistent High Score

As a player,
I want my best score remembered between sessions,
So that I have something to beat.

**Acceptance Criteria:**

**Given** a finished run
**When** the final score exceeds the stored high score
**Then** the new high score is written to local storage (FR11)

**Given** the game loads or reaches game-over/title
**When** the high score is shown
**Then** it reflects the persisted value across page reloads (FR11)

---

## Epic 4: Signature Aesthetic & Juice

**Goal:** Make it *look and feel* like Geometry Wars. Neon vector glow via bloom, the rippling/warping grid floor, a pooled particle system for death bursts and trails, screen shake and hit feedback, and audio. This is the "polished final product" layer — the reason it's a clone and not just a shooter.

### Story 4.1: Neon Vector Art and Bloom

As a player,
I want everything to glow like neon,
So that the game has the unmistakable Geometry Wars look.

**Acceptance Criteria:**

**Given** the game renders
**When** ships, bullets, and enemies are drawn
**Then** they use bright vector styling with additive blending and a Bloom post-FX pass so bright elements bleed light (NFR4)

**Given** the bloom pipeline is active
**When** the arena is busy
**Then** the effect holds without dropping below the 60 FPS target (NFR1)

### Story 4.2: Deforming Grid Field

As a player,
I want the floor grid to ripple and warp,
So that explosions and gravity wells feel physical.

**Acceptance Criteria:**

**Given** the arena
**When** it renders
**Then** a neon grid field fills the play area, rendered on the GPU (mesh/shader) (NFR5)

**Given** an explosion, bomb, or death occurs
**When** it happens
**Then** the grid ripples outward from that point

**Given** a black hole is present (Story 2.4)
**When** it exerts gravity
**Then** the grid visibly warps toward it, and releases when the black hole is destroyed (FR13)

### Story 4.3: Pooled Particle System

As a player,
I want enemies to burst into showers of particles,
So that every kill is satisfying.

**Acceptance Criteria:**

**Given** an enemy is destroyed
**When** it dies
**Then** it emits a burst of neon particles that fade and disperse

**Given** the ship is thrusting
**When** it moves
**Then** it leaves a particle trail

**Given** thousands of particles may be active
**When** they spawn and expire
**Then** they are drawn from a pool with no per-frame allocation, holding 60 FPS (NFR1, NFR2)

### Story 4.4: Screen Juice and Feedback

As a player,
I want the screen to react to the action,
So that impacts feel powerful.

**Acceptance Criteria:**

**Given** a bomb detonates or the player dies
**When** the event fires
**Then** the camera shakes proportionally and a brief flash/hit-stop emphasizes it

**Given** kills and near-misses
**When** they occur
**Then** subtle feedback (color pulses/camera nudge) reinforces them without obscuring play

**Given** juice intensity
**When** configured
**Then** magnitudes are centralized constants for post-launch tuning

### Story 4.5: Sound and Adaptive Music

As a player,
I want sound effects and music that build with the action,
So that the game is immersive.

**Acceptance Criteria:**

**Given** gameplay events (fire, kill, death, bomb, spawn)
**When** they occur
**Then** appropriate SFX play

**Given** a run intensifies
**When** difficulty ramps
**Then** the background music intensity adapts

**Given** the player wants quiet
**When** they toggle mute/volume
**Then** audio respects the setting and it persists (with settings, Story 5.3)

---

## Epic 5: Game Shell, Flow & Release

**Goal:** Everything around the arena that makes Angle Wars a finished, shippable product — a neon title screen, pause/resume, a complete game-flow state machine, input configuration and gamepad polish, and a performance-hardened static web build.

### Story 5.1: Title and Start Screen

As a player,
I want a title screen,
So that the game has a proper front door.

**Acceptance Criteria:**

**Given** the game loads
**When** the title screen appears
**Then** it shows the neon "Angle Wars" title, the current high score, a start prompt, and basic controls

**Given** the title screen
**When** the player presses start
**Then** a new run begins (FR14)

### Story 5.2: Pause and Resume

As a player,
I want to pause mid-run,
So that I can step away without dying.

**Acceptance Criteria:**

**Given** a run in progress
**When** the player presses pause
**Then** simulation and spawning freeze and a pause overlay appears (FR15)

**Given** a paused game
**When** the player resumes
**Then** play continues exactly where it left off with no state loss (FR15)

### Story 5.3: Game Flow State Machine and Settings

As a player,
I want the game to move cleanly between all its screens and remember my settings,
So that there are no dead ends.

**Acceptance Criteria:**

**Given** the game
**When** it runs
**Then** a state machine governs title → play → death/respawn → game over → restart/title with no dead ends (FR14)

**Given** a settings screen
**When** the player adjusts volume and fullscreen
**Then** changes apply immediately and persist across sessions (localStorage)

**Given** any terminal state (game over)
**When** reached
**Then** the player can restart directly or return to the title

### Story 5.4: Input Config and Gamepad Polish

As a player,
I want reliable gamepad and keyboard/mouse controls,
So that the twin-stick feel is right on any setup.

**Acceptance Criteria:**

**Given** a connected gamepad
**When** the player uses both sticks
**Then** movement and aim respond with tuned deadzones and no drift (FR16)

**Given** no gamepad
**When** the player uses keyboard + mouse
**Then** WASD/arrows move and mouse aims/fires as a full fallback (FR16)

**Given** both input methods
**When** the player switches between them mid-session
**Then** the game hot-swaps without requiring a restart (FR16)

### Story 5.5: Performance Hardening and Web Build

As a player,
I want the game to run smoothly and load fast on the web,
So that it's genuinely shippable.

**Acceptance Criteria:**

**Given** a peak-load late game (max enemies, particles, bombs, bloom, grid warp)
**When** measured
**Then** it sustains 60 FPS on mid-range hardware (NFR1)

**Given** the entity and particle systems
**When** audited
**Then** all high-churn objects are pooled with zero per-frame allocation in the hot loop (NFR2)

**Given** the project
**When** built for production
**Then** it produces a static bundle deployable to any static host, loading quickly in modern desktop browsers (NFR6, NFR7)

---

## Epic 6: Feel & Signature Hazards (Post-Launch Tweaks)

**Goal:** The refinements that only surface once the game is actually played. Angle Wars boots, runs, and ships — but the grid feedback is too loud, the black hole reads as a chore instead of a threat, and the roster wants one more hazard with a distinct verb. This epic tones the visual feedback down (and finally hangs a reduced-motion accessibility option on the settings screen built in Epic 5), inverts the black hole into an unstable ticking bomb, and adds the mirror-reflector "dumbbell." These are tuning-and-content stories layered on the finished core — each is independently shippable and reuses the existing systems (settings persistence, the smart-bomb shockwave, the spawn director + telegraph, the collision/death seams).

### Story 6.1: Grid Subtlety and Reduced-Motion Accessibility

As a player sensitive to motion or flashing,
I want calmer default feedback and a reduced-motion option,
So that the game is comfortable to look at and accessible to play.

**Acceptance Criteria:**

**Given** a run with frequent kills
**When** enemies are destroyed
**Then** the grid deformation kill-ripple is markedly subtler by default than before (reduced amplitude/reach), still readable as feedback but no longer visually distracting (FR17)

**Given** the settings screen
**When** the player enables Reduced Motion
**Then** grid warp, the full-screen flash, and camera shake are scaled down or disabled, and the preference applies immediately and persists across sessions via localStorage (FR17, NFR-persistence)

**Given** Reduced Motion is enabled
**When** a bomb detonates or the player dies
**Then** the white full-screen flash and the camera shake are suppressed (or minimized), while the event still reads clearly through non-motion cues (color/particles/audio)

> Closes the deferred Story 4.4 accessibility item (WCAG 2.3.1): the flash + shake had no escape hatch until Epic 5 added the settings/persistence infrastructure this story now reads.

### Story 6.2: Black Hole Instability Rework

As a player,
I want the black hole to be a ticking bomb I have to shut down,
So that ignoring it is genuinely dangerous and defusing it in time is a real decision.

**Acceptance Criteria:**

**Given** an active black hole
**When** it absorbs enemies and matter
**Then** it grows toward an unstable threshold instead of a harmless cap, and as it nears instability it pulses an escalating red and a rising audio urgency cue tracks its approach (FR18)

**Given** a black hole reaches the unstable threshold
**When** it goes unstable
**Then** it detonates like a smart bomb — a screen-clearing shockwave that destroys enemies on screen — AND the detonation costs the player a life (triggering the normal death/respawn + multiplier reset) (FR18, FR9-style clear, FR12)

**Given** the player fires on a black hole
**When** bullets strike it
**Then** it shrinks over time; sustained fire shrinks it out of existence, destroying it for its score payout with a safe implosion (no lethal blast) — the inverse of feeding it (FR18)

**Given** an undestroyed black hole
**When** the ship contacts its body
**Then** the player dies on contact as before (FR13)

> Inverts Story 2.4: feeding now pushes the hole toward a lethal detonation (not a harmless grow-and-emit), and sustained fire is the defuse. The old feed-driven seeker emission is removed — the hole's threat is now the instability clock, avoiding double jeopardy. Reuses the smart-bomb shockwave (Story 3.2) for the screen clear and the PlayerDeathSystem for the life cost.

### Story 6.3: Mirror Reflector (Dumbbell) Hazard

As a player,
I want a spinning reflector I can't just shoot down,
So that some threats demand positioning and nerve instead of firepower.

**Acceptance Criteria:**

**Given** a mirror reflector is present
**When** it moves
**Then** it drifts aimlessly around the arena while continuously spinning about its center, rendered as a dumbbell — two weights joined by a bar (FR19) — spawning through the existing spawn director + telegraph (FR5, Story 2.6) and drawn from a pool (NFR2)

**Given** a player bullet strikes the reflector's bar
**When** they collide
**Then** the bullet reflects off the bar (angle of incidence about the bar's normal) and continues as a live player shot that can still destroy enemies; the reflector takes no damage from gunfire (FR19)

**Given** a mirror reflector
**When** the ship flies through its center point
**Then** the reflector is destroyed for a score payout (FR19)
**And** contact with either weight kills the player (FR6)

> The reflect is a segment-vs-point collision plus a velocity mirror per bullet per tick — genuinely new collision code, modeled on the PinwheelSystem drift/pool pattern. Reflected bullets remain player-owned; whether they can harm the player is left as a tunable feel constant (default: harmless to the player) for post-launch play.

---

## Epic 7: Mobile (Capacitor Shell & Touch Play)

**Goal:** Make the finished web game a real, installable mobile app without rewriting the game. Wrap the existing static Vite build in a **Capacitor** native shell (Ionic's modern wrapper — best plugin ecosystem, actively maintained, generates the Xcode/Android Studio projects), add **on-screen twin-stick touch controls** that plug into the existing Phaser-free input seam, make the layout respect phone screens (landscape lock, safe-area insets, thumb reach), give it a **mobile performance profile** so the bloom/grid/particle stack holds framerate on a phone GPU inside a WebView, wire **native lifecycle** (auto-pause on background, hardware back, haptics, keep-awake), and lay down **store-submission scaffolding** (icons, splash, signing). Spine-first *within mobile*: the touch feel is the highest-risk, most game-defining piece, so it is proven **first in the browser** before anything is wrapped natively. In-app purchases and ads are the reason Capacitor was chosen (its plugin ecosystem), but they are **explicitly out of scope for this epic** — this epic delivers the installable, store-submittable shell they later bolt onto.

### Story 7.1: Touch Twin-Stick Controls

As a player on a phone,
I want on-screen dual thumbsticks that move and aim independently,
So that the twin-stick core survives without a controller.

**Acceptance Criteria:**

**Given** a touch device (or touch input)
**When** I press and hold anywhere on the left half of the screen
**Then** a floating virtual movement stick appears at my thumb and its deflection sets the ship's move intent (FR20), clamped to the unit circle like the analog stick

**Given** the right half of the screen
**When** I press and hold there
**Then** a floating virtual aim stick appears, its direction sets the aim, and while it is held the ship auto-fires in that direction (FR2, FR20) independent of movement (FR1)

**Given** the touch control path
**When** it samples input each render frame
**Then** it writes normalized move/aim into the existing `InputState` seam (`src/input/InputState.js`) via a new `INPUT_METHOD.TOUCH` branch in `resolveActiveMethod` (`src/input/inputMethod.js`) and a touch sampling path, with **no changes** to the movement, firing, or bomb systems (NFR8)

**Given** an on-screen smart-bomb button
**When** the player taps it
**Then** a bomb is latched through the existing `queueBomb`/`consumeBomb` seam exactly once per tap, regardless of how long the button is held (FR9)

**Given** the player switches between touch and another device (gamepad/keyboard/mouse)
**When** touch activity begins or ends
**Then** the active-input-method resolution hot-swaps to/from touch without a restart, with no cross-device aim bleed (FR16-style, mirrors the existing sticky-method logic)

### Story 7.2: Responsive Mobile Layout, Orientation & Safe Areas

As a player on a phone,
I want the game to fill my screen correctly and keep controls off the notch,
So that it looks and plays right on any handset.

**Acceptance Criteria:**

**Given** the app runs on a handset
**When** it starts
**Then** it locks to landscape and the WebGL canvas scales to the device's aspect ratio while preserving the arena's playable aspect (NFR7)

**Given** a device with a notch, rounded corners, or a home indicator
**When** the HUD and touch controls lay out
**Then** they respect the safe-area insets (`env(safe-area-inset-*)`) so nothing critical is clipped or pushed under the hardware (FR21)

**Given** the on-screen thumbsticks and bomb button
**When** they are placed
**Then** they sit within comfortable thumb reach and do not occlude the ship, score, lives, multiplier, or bomb HUD during play (FR21)

### Story 7.3: Capacitor Native Shell and Device Build

As a developer,
I want the static web build wrapped as an installable iOS and Android app,
So that Angle Wars runs as a real mobile app.

**Acceptance Criteria:**

**Given** the existing production Vite build (Story 5.5)
**When** Capacitor is added and configured
**Then** `capacitor.config` points `webDir` at the production build output (`dist`), sets an app id and display name, and `npx cap sync` copies the built bundle into the native projects (FR22)

**Given** Capacitor is configured
**When** the native platforms are added
**Then** iOS (Xcode) and Android (Android Studio) projects are generated and build cleanly

**Given** a real device or emulator
**When** the app is launched from the native project
**Then** the full game runs end to end (title → play → game over → restart) inside the native WebView with touch controls (Story 7.1) active

### Story 7.4: Mobile Performance Profile

As a player on a mid-range phone,
I want a smooth framerate even with bloom, grid warp, and particles,
So that the game feels good, not choppy.

**Acceptance Criteria:**

**Given** the game detects it is running on a mobile device / inside the Capacitor WebView
**When** it initializes
**Then** it applies a mobile quality profile that scales particle caps, bloom cost, and grid resolution down from desktop defaults via the existing centralized quality/feel constants — no per-frame allocation introduced (NFR2, NFR9)

**Given** a peak-load late game (max enemies, particles, bombs, bloom, grid warp) on a mid-range phone GPU inside the WebView
**When** measured
**Then** it holds the mobile framerate target without sustained hitching (NFR9, NFR1)

**Given** the Reduced-Motion and quality settings (Stories 6.1 / 5.3)
**When** the player adjusts them on mobile
**Then** they compose with the mobile profile and persist across sessions (localStorage)

### Story 7.5: Native Lifecycle and Feel Integration

As a player on a phone,
I want the game to behave like a native app — pausing when I leave, buzzing on impact, and not sleeping mid-run,
So that it feels at home on the device.

**Acceptance Criteria:**

**Given** a run in progress
**When** the app is backgrounded or loses focus (Capacitor `App` state / `visibilitychange`)
**Then** the game auto-pauses via the existing pause system (Story 5.2) so the player never dies while away, and resumes cleanly on return (FR23, FR15)

**Given** an Android device
**When** the player presses the hardware back button
**Then** it maps to pause/resume or a safe exit-confirm rather than abruptly closing the app (FR23)

**Given** key feel events (player death, bomb detonation, extra life)
**When** they fire on a device that supports it
**Then** a short haptic pulse plays via Capacitor Haptics, suppressed when Reduced Motion / the relevant feel setting is off (FR23, respects Story 6.1)

**Given** an active run
**When** the player is mid-play
**Then** the display is kept awake (no auto-lock) during play and the keep-awake is released outside of play (FR23)

### Story 7.6: Store Release Scaffolding

As a developer,
I want icons, splash screens, and signing configured for both stores,
So that Angle Wars can actually be submitted.

**Acceptance Criteria:**

**Given** the native projects
**When** release assets are generated
**Then** app icons and splash screens exist across the required iOS and Android densities/sizes (NFR10)

**Given** the platform manifests
**When** they are configured
**Then** orientation, display name, bundle/app id, and required permissions are set correctly for Apple App Store and Google Play submission (NFR10)

**Given** a release build
**When** it is produced
**Then** iOS and Android signing/build configuration is documented and yields a store-uploadable artifact (NFR10)

> **IAP and ads are explicitly out of scope for this epic.** Capacitor was chosen precisely because its plugin ecosystem makes native in-app purchases and ads straightforward to add later — this shell is built to accept them, but the monetization stories are deferred to a dedicated later epic. Epic 7 delivers the installable, store-submittable native shell and faithful touch play, nothing more. The touch-control story (7.1) is deliberately sequenced first and browser-testable so the twin-stick *feel* is proven before any native wrapping cost is incurred.
