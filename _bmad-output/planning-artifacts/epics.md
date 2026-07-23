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

#### v2 — Progression (Epics 8–15)

- **FR24** — XP orbs: enemies drop XP orbs on death (per-type values, incl. multiplier bonus XP×(1+mult/20)); orbs drift toward the ship inside an upgradeable pickup radius; orbs left on the floor persist as a collect-or-abandon tension.
- **FR25** — XP & leveling: XP accrues against `XP_to_next(n)=8+6n+0.55n²`; level cap 30; the current multiplier boosts XP gained.
- **FR26** — Level-up moment: on level-up, time dilates to **0.15×** (not a hard pause), the arena stays visible behind the card UI, the player is invulnerable during selection, and three cards are offered — pick one.
- **FR27** — Weighted card offer & slots: cards are offered by the weighted formula (base rarity × owned-2.2 × mid-tier-1.4 × slot-full-gate × banish); slot limits are **5 offense / 4 defense**; once a track is full only owned-item upgrades appear (no dead offers).
- **FR28** — Reroll & banish: 1 reroll per run (+1 at Lv10/15/20); 2 banishes per run (permanently removes a card from that run's offer pool).
- **FR29** — Offense arsenal: 8 offense items (Orbit Blade, Spread Cannon, Piercing Lance, Seeker Drones, Mine Layer, Ricochet Rounds, Flak Burst, Overcharge), each with a 5-level effect path.
- **FR30** — Defense arsenal: 6 defense items (Nanite Shield, Afterburner, Gravity Well, Reinforced Hull, Bomb Capacitor, Chrono Field), each with a 5-level effect path.
- **FR31** — Fusion system: an Epic unlocks only via a fusion condition (a Lv5 item + a specific partner at Lv3+); a **⚡ FUSION READY** HUD badge appears on satisfaction; the next level-up guarantees the gold Epic card in slot 1; the partner is consumed to a Lv3 remnant; 14 Epics total.
- **FR32** — Adaptive spawn director: track player DPS over a rolling 10s window and feed it into spawn weight/rate so difficulty scales to **build power**, not just elapsed time — a damped closed loop (no oscillation, no death-spiral) with time-escalation as a floor.
- **FR33** — Armored enemy archetype: introduced ~15:00; takes reduced damage from projectiles but full damage from melee/AoE, keeping melee and AoE builds viable; telegraphed on spawn.
- **FR34** — Generosity Engine (opt-in rewarded ads): a persistent, obvious, **player-initiated** ad button grants a large "cheat-code" reward (e.g. 20× XP burst, +5 bombs, instant Lv5 item of choice, invulnerability burst); ads are **never** forced, auto-popped, or used as a gate; the base game is complete and playable without ever watching one; no IAP, no microtransactions.
- **FR35** — Cores & meta-progression: earn Cores per run (from score, level reached, Epics fused); spend on a small **permanent** tree (~15 nodes incl. Starting XP, Reroll+, Banish+, Greed, Foresight, Loadout) that fully completes in ~20 hours.
- **FR36** — Ship unlocks: 5 ships (Vanguard, Needle, Bulwark, Vector, Ghost) unlocked by achievement (never purchase), each a trade-off variant that changes how the game plays.
- **FR37** — Daily seeded run: a shared daily challenge where a common daily seed produces an identical run (spawns + card offers) for every player.

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
- **NFR11** — Pooling holds under peak **build** density: 5 orbit blades + 5 drones + 12 mines + fragment/ricochet multiplication simultaneously must stay at the framerate target with zero per-frame allocation; any mechanic that multiplies live entities (Kaleidoscope split, Flak/Fragmentation cascade) carries a hard live-count cap to bound the worst case.
- **NFR12** — Deterministic simulation: a single seedable RNG stream drives all gameplay randomness (spawns + card offers) so a given seed reproduces a run exactly; no `Math.random` in the gameplay hot path. (Foundation for the daily run; the seam is planted in Epic 8.)
- **NFR13** — Rewarded-ad integration is graceful and offline-safe: no network dependency for core play; ad unavailability (offline, SDK failure, ad not ready) never blocks progress and the ad button degrades cleanly.
- **NFR14** — v2 persistence: meta-progression, unlocked ships, and Cores persist in `localStorage` alongside high score/settings, with a forward-compatible schema.

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

> **IAP and ads are explicitly out of scope for this epic.** Capacitor was chosen precisely because its plugin ecosystem makes native rewarded ads straightforward to add later — this shell is built to accept them. In v2 that monetization becomes **Epic 13 — The Generosity Engine** (opt-in cheat-code ads, no IAP, no microtransactions). Epic 7 delivers the installable, store-submittable native shell and faithful touch play, nothing more. The touch-control story (7.1) is deliberately sequenced first and browser-testable so the twin-stick *feel* is proven before any native wrapping cost is incurred.

---

# v2 — Progression (Epics 8–15)

Layered on the shipped v1 core. Spine-first *within v2*: the level-up loop and its difficulty governor before the content; content before the money and the meta; determinism last. Full design rationale in `prd.md` §13. No story depends on a future story.

## Epic 8: The Level-Up Loop (XP, Curve & Card UI)

**Goal:** Build the progression *skeleton* on top of the untouched v1 loop — XP orbs, the level curve, the time-dilated level-up moment, and the weighted three-card draft with slot limits, reroll, and banish — proven end-to-end with **placeholder cards** before any real item exists. Enemies dropping XP and the player leveling and drafting a card is the whole deliverable; the cards do nothing yet but stack a debug stat. Critically, this epic plants the **seedable-RNG seam** (NFR12): all spawn and card-offer randomness routes through one seedable stream from day one, so the daily-run capstone (Epic 15) is additive rather than a rewrite. The v1 loop is untouched — a player who dismisses every card still plays Retro Evolved.

### Story 8.1: XP Orbs — Drop, Drift & Pickup

As a player,
I want killing enemies to drop XP orbs that I collect by getting near them,
So that combat feeds my progression and leaving orbs behind is a real choice.

**Acceptance Criteria:**

**Given** an enemy is destroyed
**When** it dies
**Then** it drops XP orb(s) worth its per-type value (Blue Seeker 1, Green Square 2, Pinwheel 2, Snake segment 1 / head 3, Black Hole defused 25, Mirror Reflector center-kill 15), spawned from a pooled orb system with zero per-frame allocation (FR24, NFR2)

**Given** XP orbs exist on the floor
**When** the ship is within the pickup radius
**Then** orbs drift toward the ship and are collected on contact, adding their value to the run's XP total (FR24)

**Given** orbs outside the pickup radius
**When** the player does not approach them
**Then** they persist on the floor as collectible value (no timeout that trivializes the collect-or-abandon tension), within a pooled live-orb cap (FR24, NFR11)

**Given** the current multiplier
**When** an orb is collected
**Then** the XP credited is scaled by the multiplier bonus `× (1 + mult/20)` (10× → 1.5× XP) (FR24, FR25)

### Story 8.2: XP, Level Curve & Leveling

As a player,
I want collected XP to fill a level bar on a curve that keeps the ceiling distant,
So that leveling paces a run without ever feeling finished too early.

**Acceptance Criteria:**

**Given** accumulated run XP
**When** it reaches the threshold `XP_to_next(n) = 8 + 6n + 0.55n²` for the current level
**Then** the player levels up and the remainder carries toward the next level (FR25)

**Given** the level curve
**When** the player reaches level 30
**Then** leveling stops at the cap (a full build) and further XP is inert (FR25)

**Given** a run in progress
**When** the HUD renders
**Then** current level and progress toward the next level are shown without occluding critical play space (FR25)

### Story 8.3: The Level-Up Moment & Card UI

As a player,
I want a level-up to slow the world and offer me three cards,
So that choosing an upgrade is a charged beat, not a jarring stop.

**Acceptance Criteria:**

**Given** a level-up fires
**When** the card UI opens
**Then** time dilates to **0.15×** (not a hard pause), the arena and swarm stay visible and crawling behind the UI, and the player is invulnerable for the duration of selection (FR26)

**Given** the card UI is open
**When** it presents choices
**Then** exactly three cards are shown and selecting one applies it, closes the UI, and restores normal time (FR26)

**Given** placeholder card content (this epic)
**When** a card is chosen
**Then** it applies a debug stat delta and records ownership, proving the draft loop end-to-end before real items exist (FR26)

**Given** a card selection is pending
**When** the player has not yet picked
**Then** enemies cannot damage the player and the run clock reflects the dilated time (FR26)

### Story 8.4: Weighted Card Offer & Slot Limits

As a player,
I want the cards I'm offered to favor finishing my build over starting new ones,
So that a run commits to a specific build around the mid-game.

**Acceptance Criteria:**

**Given** a level-up card offer
**When** candidates are weighted
**Then** the weight is `base_rarity × (owned?2.2:1.0) × (level_1_of_5?1.0:1.4) × (slots_full && !owned ? 0 : 1) × banish_multiplier` and three are drawn without duplicates via the seedable RNG stream (FR27, NFR12)

**Given** slot limits of 5 offense and 4 defense
**When** a track is full
**Then** only upgrades to already-owned items in that track are offered — no dead offers for un-ownable new items (FR27)

**Given** the seedable RNG stream
**When** card offers are generated
**Then** the same seed + same run state yields the same three cards (deterministic offers) (NFR12)

### Story 8.5: Reroll & Banish

As a player,
I want to reroll a bad hand and banish cards I never want this run,
So that I can shape my build, not just accept what luck deals.

**Acceptance Criteria:**

**Given** a card offer is shown
**When** the player rerolls
**Then** a new set of three is drawn (respecting weights and slots) and a reroll charge is consumed; the player starts with 1 reroll per run and gains +1 at levels 10, 15, and 20 (FR28)

**Given** a card offer is shown
**When** the player banishes a card
**Then** that card is permanently removed from this run's offer pool, a banish charge is consumed (2 per run), and it never appears again this run (FR28)

**Given** no reroll or banish charges remain
**When** the player attempts one
**Then** the action is unavailable and clearly shown as depleted (FR28)

## Epic 9: Adaptive Spawn Director & Armored Threat

**Goal:** The load-bearing rework. Convert the v1 time-based spawn director into a **closed-loop, build-power-aware** director: measure what the player can actually kill (DPS over a rolling window) and feed it into spawn weight and rate, so a strong build is *answered* instead of trivializing minute 20 — without oscillating into a death-spiral or a boredom-spiral. Add the **armored enemy archetype** as the late-run answer that keeps melee/AoE builds relevant. This epic is deliberately sequenced *before* the exotic cards so every item in Epics 10–12 is tuned against a director that scales to it, and it is the **governor** that later makes the Generosity Engine's cheat-codes fair (power-in → threat-out). The v1 time-escalation remains as a difficulty floor.

### Story 9.1: Player DPS Telemetry

As the game,
I want a live estimate of how much damage the player is dealing,
So that difficulty can respond to build power rather than only to the clock.

**Acceptance Criteria:**

**Given** damage the player deals to enemies
**When** it is applied
**Then** a rolling 10-second DPS estimate is maintained in the hot loop with zero per-frame allocation and no dependence on framerate (fixed-timestep) (FR32, NFR2, NFR3)

**Given** the rolling window
**When** the player's output changes (new weapon, Epic, ad boost, or a lull)
**Then** the estimate tracks the change smoothly within the window without spiking on single hits (FR32)

### Story 9.2: Build-Adaptive Spawn Scaling

As a player with a strong build,
I want the swarm to rise to meet me,
So that a good build stays challenging instead of turning the game idle.

**Acceptance Criteria:**

**Given** the player's rolling DPS estimate (Story 9.1)
**When** the spawn director computes spawn weight and rate
**Then** higher sustained DPS increases pressure (rate/mix/toughness) via a **damped** response, and the time-based escalation remains as a floor so difficulty never drops below the v1 curve (FR32, FR5)

**Given** a sudden large power spike (e.g. an Epic fusion or an ad cheat-code)
**When** the director responds
**Then** pressure rises proportionately and settles without oscillation or a runaway death-spiral (bounded step per adjustment) (FR32)

**Given** a sudden power drop (death reset, remnant)
**When** the director responds
**Then** pressure relaxes toward the floor rather than stranding the player against a swarm tuned for a build they no longer have (FR32)

### Story 9.3: Armored Enemy Archetype

As a player,
I want a late-game enemy that punishes a pure-projectile build,
So that melee, mine, and AoE builds stay viable answers.

**Acceptance Criteria:**

**Given** a run passes ~15:00 (and/or a build-power threshold)
**When** the director introduces the armored archetype
**Then** it spawns telegraphed and takes **reduced** damage from projectiles but **full** damage from melee/AoE sources (Orbit Blade, mines, bomb/AoE Epics) (FR33)

**Given** the armored enemy in the mix
**When** a pure-Spread build engages it
**Then** it is meaningfully harder to clear than a normal enemy, creating pressure to diversify — without being immune (FR33)

### Story 9.4: Governor Validation — Power Spikes Stay Honest

As a designer,
I want proof that a big transient power boost is answered by the director,
So that the Generosity Engine's cheat-codes (Epic 13) can't trivialize a run.

**Acceptance Criteria:**

**Given** a simulated large transient boost (stand-in for an ad cheat-code: e.g. instant Lv5 item + 20× XP)
**When** it is applied mid-run
**Then** the director raises pressure proportionately so the boost reads as a *thrill*, not a *skip*, and difficulty re-settles as the boost's effect fades (FR32, FR34)

**Given** the boost hook
**When** Epic 13 wires real ad rewards to it
**Then** the same governor path is reused with no new balancing surface (FR32, NFR8)

## Epic 10: Core Arsenal — Stat-Stackers

**Goal:** Ship the four **stat-stacking** items — Overcharge, Spread Cannon, Nanite Shield, Afterburner — at all five levels, and lay the reusable **item/upgrade framework** (registry, per-level effect application, owned-state, slot occupancy, Lv3-remnant state) that Epics 11–12 build on. These four are chosen first because they stack numbers onto existing v1 seams (damage, fire rate, movement, a shield) with no new entity systems — the goal is to prove that stacking feels good and the draft loop is fun *before* any exotic behavior is written. Real cards now replace Epic 8's placeholders.

### Story 10.1: Item & Upgrade Framework

As a developer,
I want a data-driven item registry that the draft, upgrade, and fusion systems share,
So that adding items and Epics is content, not new plumbing.

**Acceptance Criteria:**

**Given** an item definition (track, base rarity, five level effects, fusion partner + Epic)
**When** it is registered
**Then** the card offer (Story 8.4), on-pick application, owned-state, and current level all read from that single definition (FR29, FR30, NFR8)

**Given** an owned item
**When** it is upgraded via a card
**Then** its level increments and the level's effect delta is applied through the relevant gameplay system with no per-frame allocation (NFR2)

**Given** slot occupancy and remnant state
**When** an item is owned, maxed, or reduced to a Lv3 remnant (for Epic 12)
**Then** the framework tracks that state and exposes it to the offer weighting and fusion checks (FR27, FR31)

### Story 10.2: Overcharge

As a player,
I want a support item that boosts all my damage and fire rate,
So that I have a safe generalist pick that also enables fusions.

**Acceptance Criteria:**

**Given** Overcharge at levels 1→5
**When** owned
**Then** it applies +15% dmg → +25%/+10% rate → +35%/+20% → +45%/+30% → +60%/+40% globally to the player's fire (FR29)

**Given** it is the most common fusion key (feeds three Epics)
**When** offered
**Then** it uses its base rarity weight and behaves as a normal offense-slot item (occupies an offense slot) (FR27, FR29)

### Story 10.3: Spread Cannon

As a player,
I want to evolve my base shot into a wide spread,
So that my default firing scales into the mid-game.

**Acceptance Criteria:**

**Given** the player has not evolved the base weapon
**When** the run reaches ~level 3
**Then** Spread Cannon Lv1 is offered (always-offered-by-Lv3 rule) (FR27, FR29)

**Given** Spread Cannon at levels 1→5
**When** owned
**Then** it fires 3-way/12° → 5-way/16° → 5-way/+30% rate → 7-way/22° → 9-way/+35% dmg through the existing firing seam (FR2, FR29)

### Story 10.4: Nanite Shield

As a player,
I want a shield that absorbs hits and recharges,
So that a single mistake isn't always fatal.

**Acceptance Criteria:**

**Given** Nanite Shield at levels 1→5
**When** owned
**Then** it absorbs 1 hit/20s recharge → 15s → 2 charges → 10s → 3 charges + a knockback pulse on break, integrating with the v1 death/collision path (a shielded hit consumes a charge instead of a life) (FR30, FR6, FR12)

**Given** the shield breaks at Lv5
**When** the final charge is consumed
**Then** a knockback pulse pushes nearby enemies back (FR30)

### Story 10.5: Afterburner

As a player,
I want more speed and a dash,
So that I can kite and reposition out of danger.

**Acceptance Criteria:**

**Given** Afterburner at levels 1→5
**When** owned
**Then** it grants +12% speed → +20% + a dash on button (3s cd) → +25% + dash i-frames → 2s cd + dash damages on contact → +35% + a burning dash trail, feeding the existing movement seam (FR30, FR1)

**Given** a dash with i-frames (Lv3+)
**When** the player dashes through an enemy
**Then** the i-frames prevent death for the dash window (and at Lv4+ the dash damages enemies it passes) (FR30)

## Epic 11: Exotic Arsenal & New Entity Systems

**Goal:** Ship the remaining ten items — six offense (Orbit Blade, Seeker Drones, Mine Layer, Piercing Lance, Ricochet Rounds, Flak Burst) and four defense (Gravity Well, Reinforced Hull, Bomb Capacitor, Chrono Field). Several introduce **new pooled entity systems** (rotating blades, autonomous drones, timed mines) — this epic is the **pooling stress test** (NFR11): it must hold framerate with 5 blades + 5 drones + 12 mines live at once. Each item plugs into existing seams (firing, collision, bombs, movement, the XP pickup radius) via the Epic 10 framework.

### Story 11.1: Orbit Blade

As a player,
I want rotating melee blades around my ship,
So that I have a close-range answer that also hits armored enemies.

**Acceptance Criteria:**

**Given** Orbit Blade at levels 1→5
**When** owned
**Then** it maintains 1 blade 90dmg/1.2s rotation → 2 opposed → 3 blades/1.0s → 4 blades/+40% dmg → 5 blades/0.7s/+25% radius, as pooled entities with zero per-frame allocation (FR29, NFR2, NFR11)

**Given** blades are melee/contact damage
**When** they strike an armored enemy (Story 9.3)
**Then** they deal full damage (FR29, FR33)

### Story 11.2: Seeker Drones

As a player,
I want autonomous drones that shoot enemies for me,
So that threats behind me are handled.

**Acceptance Criteria:**

**Given** Seeker Drones at levels 1→5
**When** owned
**Then** 1 drone firing every 1.5s at the nearest enemy → 2 → 3/+40% rate → 4 with homing shots → 5/+60% dmg, all pooled (drones and their shots) (FR29, NFR2, NFR11)

**Given** up to 5 drones plus other pooled systems active
**When** at peak density
**Then** the framerate target holds (NFR11)

### Story 11.3: Mine Layer

As a player,
I want to drop mines behind me,
So that kiting builds zones of denial.

**Acceptance Criteria:**

**Given** Mine Layer at levels 1→5
**When** owned
**Then** it drops a mine every 2s (3s arm, 60r) → +2 cap/100r → 1.3s drop → mines pull enemies inward before detonating → detonation chains to adjacent mines, as pooled entities capped at the mine limit (FR29, NFR2, NFR11)

**Given** the mine cap
**When** more mines would exist than the cap
**Then** the oldest is removed/detonated so live count stays bounded (NFR11)

### Story 11.4: Piercing Lance

As a player,
I want a slow heavy bolt that punches through a line of enemies,
So that dense columns clear in one shot.

**Acceptance Criteria:**

**Given** Piercing Lance at levels 1→5
**When** owned
**Then** every 2s a bolt piercing 2 → pierce 4 → 1.4s/+50% dmg → pierce 7 + a 0.5s damage trail → fires twice (forward + backward) (FR29)

### Story 11.5: Ricochet Rounds

As a player,
I want bullets that bounce off walls,
So that I get value from shots that miss and synergy with the Mirror Reflector.

**Acceptance Criteria:**

**Given** Ricochet Rounds at levels 1→5
**When** owned
**Then** bullets bounce off arena walls once → twice → +25% dmg per bounce → also bounce off enemies → 4 bounces and bounced shots seek (FR29, FR19)

**Given** bouncing bullets are pooled
**When** many are live
**Then** live bullet count stays within the pool cap (NFR11)

### Story 11.6: Flak Burst

As a player,
I want shots that airburst into fragments,
So that clustered enemies take splash damage.

**Acceptance Criteria:**

**Given** Flak Burst at levels 1→5
**When** owned
**Then** every 5th shot airbursts into 6 fragments → every 4th/8 → fragments +50% dmg → every 3rd/12 → fragments themselves airburst once, with fragment spawn counts bounded by a hard cap (FR29, NFR11)

### Story 11.7: Gravity Well

As a player,
I want a bigger XP pickup radius with homing orbs,
So that I collect value without diving into danger.

**Acceptance Criteria:**

**Given** Gravity Well at levels 1→5
**When** owned
**Then** pickup radius +40% → +80% → orbs actively home to the ship → +25% XP value → +150% radius and orbs also slightly pull enemies, all feeding the Story 8.1 pickup system (FR30, FR24)

### Story 11.8: Reinforced Hull

As a player,
I want more lives and a softer death penalty,
So that a durable build can survive deeper.

**Acceptance Criteria:**

**Given** Reinforced Hull at levels 1→5
**When** owned
**Then** +1 max life → respawn i-frames 2s→3.5s → +1 max life → death drops the multiplier to 50% instead of 1× → +1 max life (4 total), integrating with the v1 lives/multiplier-reset systems (FR30, FR8, FR10, FR12)

**Given** the Lv4 effect
**When** the player dies
**Then** the multiplier is halved rather than fully reset (a deliberate, item-gated exception to the v1 rule) (FR30, FR8)

### Story 11.9: Bomb Capacitor

As a player,
I want more and stronger smart bombs,
So that a bomb build can lean on screen-clears.

**Acceptance Criteria:**

**Given** Bomb Capacitor at levels 1→5
**When** owned
**Then** +1 bomb/+30% radius → bomb threshold 100k→75k → bombs stun survivors 2s + 1 bomb → threshold 50k + bombs drop 5 XP orbs → +2 bombs + a 3s damage field, integrating with the v1 bomb system (FR30, FR9)

### Story 11.10: Chrono Field

As a player,
I want an aura that slows nearby enemies,
So that I get breathing room and control the tempo.

**Acceptance Criteria:**

**Given** Chrono Field at levels 1→5
**When** owned
**Then** enemies within 250px move 12% slower → 20%/300px → enemy bullets slow 30% → 30%/380px → the field also slows Black Hole growth and Mirror Reflector spin (FR30, FR13, FR18, FR19)

## Epic 12: The Fusion Tech Tree (Epics)

**Goal:** Build the fusion system and all fourteen run-defining **Epic** upgrades — the actual tech tree that makes each run a different two or three points on the map. Deliver the fusion **mechanic + UX** and three **proof Epics** first (Tesla Circuit, Railgun, Phase Armor — one chain-damage, one grid-deform, one defense-transform) to prove the pattern across behavior classes, then complete the remaining eleven. Scarcity is the design: the tree is shaped so no run can fuse more than ~2–3 Epics. Kaleidoscope ships with a **hard live-split cap** (NFR11).

### Story 12.1: Fusion System & UX

As a player,
I want maxing an item plus its partner to unlock a run-defining Epic,
So that my build pays off in a dramatic upgrade I chose toward.

**Acceptance Criteria:**

**Given** a Lv5 item and its specific partner at Lv3+
**When** the condition is satisfied
**Then** a **⚡ FUSION READY** badge appears on the HUD immediately, and the *next* level-up guarantees the Epic card in slot 1, rendered as a gold card with particle aura, the fusion recipe beneath it, and a distinct audio sting (FR31)

**Given** the Epic card is chosen
**When** the fusion resolves
**Then** the Lv5 item is replaced by its Epic and the partner is consumed to a **Lv3 remnant** (keeps its stats, stops upgrading, still occupies its slot) (FR31)

**Given** the "any 2 offense Lv5" / "any defense Lv5" style conditions (Critical Resonance, Stasis Lock)
**When** evaluated
**Then** the generic partner rule is satisfied by any qualifying items, consuming the chosen partner(s) per the recipe (FR31)

### Story 12.2: Proof Epics — Tesla Circuit, Railgun, Phase Armor

As a player,
I want the first three Epics to feel unmistakably run-defining,
So that the fusion payoff is proven across an offense-chain, a grid-deform, and a defense-transform.

**Acceptance Criteria:**

**Given** Orbit Blade Lv5 + Overcharge Lv3
**When** fused
**Then** **Tesla Circuit**: blades chain lightning between each other, enemies inside the ring take continuous arc damage, and kills spawn a 2-jump chain (FR31, NFR11)

**Given** Piercing Lance Lv5 + Overcharge Lv3
**When** fused
**Then** **Railgun**: a 1.2s charge fires an arena-width, infinite-pierce beam that deforms the grid in a shockwave line for +200% dmg, reusing the existing grid shader (FR31, NFR5)

**Given** Nanite Shield Lv5 + Afterburner Lv3
**When** fused
**Then** **Phase Armor**: a shield break makes the ship intangible for 2s, passing through and damaging enemies (FR31)

**Given** any Epic
**When** it is active
**Then** its power sits near the ~4× Lv5-item ceiling — run-defining, not run-ending — and the Epic 9 director scales to it (FR31, FR32)

### Story 12.3: Offense Epics — Sunburst, Swarm Protocol, Singularity Field, Kaleidoscope, Fragmentation Cascade, Critical Resonance

As a player,
I want the rest of the offense Epics,
So that every offense archetype has a payoff.

**Acceptance Criteria:**

**Given** the offense fusion recipes
**When** each is fused
**Then** **Sunburst** (Spread Lv5 + Piercing Lv3): 360° ring every 4th volley, ring bullets pierce twice; **Swarm Protocol** (Drones Lv5 + Nanite Lv3): drones ram-kill + respawn 3s, each drone kill spawns a 5s mini-drone; **Singularity Field** (Mine Lv5 + Gravity Well Lv3): mines become mini black holes (pull 1.5s → implode 3× dmg + grid warp, reusing the gravity shader); **Fragmentation Cascade** (Flak Lv5 + Overcharge Lv3): fragment-kills airburst on death; **Critical Resonance** (Overcharge Lv5 + any 2 offense Lv5): 20% crit for 3× dmg, crits emit a shockwave and refund 1 XP (FR31, NFR5, NFR11)

**Given** Ricochet Lv5 + Spread Lv3 → **Kaleidoscope** (every wall bounce splits the bullet in two)
**When** it is active
**Then** a **hard cap on live split-bullets** bounds the exponential growth so peak density stays within the framerate budget (FR31, NFR11)

### Story 12.4: Defense Epics — Slipstream, Event Horizon, Revenant, Chain Reaction, Stasis Lock

As a player,
I want the defense Epics,
So that defense-first builds are as run-defining as offense.

**Acceptance Criteria:**

**Given** the defense fusion recipes
**When** each is fused
**Then** **Slipstream** (Afterburner Lv5 + Nanite Lv3): dash spawns a taunting decoy (3s) that explodes; **Event Horizon** (Gravity Well Lv5 + Mine Lv3): a permanent weak gravity field draws enemies in and curves bullets into them; **Chain Reaction** (Bomb Capacitor Lv5 + Flak Lv3): bomb-kills each detonate a mini-bomb in a screen-wide cascade (bounded by NFR11); **Stasis Lock** (Chrono Field Lv5 + any defense Lv5): every 12s freeze all enemies 1.5s, frozen enemies take 2× dmg and shatter into extra XP (FR31, NFR11)

**Given** Reinforced Lv5 + Bomb Capacitor Lv3 → **Revenant**
**When** the player dies
**Then** a 900-radius smart-bomb detonates and the player keeps their full multiplier — the deliberate "I accept death" exception to the multiplier-is-king rule (FR31, FR8)

## Epic 13: The Generosity Engine (Opt-In Reward Ads)

**Goal:** Ship the monetization pillar — and it is a *pillar*, not a footnote. A single, obvious, **player-initiated** ad button grants a massive "temp cheat-code" reward when the player chooses to watch. **No IAP. No microtransactions. No forced ads, ever** — no interstitials, no post-run gates, no hidden-X dark patterns. The reward *is* the advertisement: players click because they know exactly what it gets them. Cheat-codes may shortcut the build arc (that's intended, it's a solo toy), and the Epic 9 director is the governor that keeps them fair — power-in triggers threat-out. The base game is complete and fully playable with the button never touched; ad unavailability never blocks progress (NFR13). Depends on the XP/bomb/item grant seams (Epics 8–12) and the director's boost hook (Story 9.4).

### Story 13.1: Rewarded Ad Integration (Offline-Safe)

As a developer,
I want rewarded ads wired through the Capacitor plugin with a graceful fallback,
So that watching an ad reliably grants a reward and *not* watching never blocks anyone.

**Acceptance Criteria:**

**Given** the Capacitor rewarded-ad plugin
**When** an ad is requested by the player and completes
**Then** a reward callback fires exactly once and grants the chosen reward; a dismissed/incomplete ad grants nothing and returns cleanly to play (FR34, NFR13)

**Given** the device is offline, the SDK failed to init, or no ad is ready
**When** the player would watch
**Then** the flow degrades cleanly (button shows unavailable), core play is unaffected, and no error blocks the run (NFR13)

**Given** the app lifecycle
**When** an ad is showing
**Then** the run auto-pauses (reusing Story 7.5 lifecycle) and resumes on return with no double-reward or lost input (FR34, FR15)

### Story 13.2: The Ad Button & Generosity UX

As a player,
I want an obvious optional button that tells me the reward before I tap it,
So that watching an ad feels like reaching for a gift, never paying a tax.

**Acceptance Criteria:**

**Given** an active run
**When** the HUD renders
**Then** a persistent, obvious, **optional** ad button/icon is present, shows the reward it will grant, and is never a gate or a blocker to any other action (FR34)

**Given** the ad button
**When** the game runs at any point (spawn, mid-run, game-over)
**Then** no ad is ever auto-popped, timed, or forced — the player initiates every ad, always (FR34, Pillar §13.0.5)

**Given** an ad is unavailable
**When** the button is shown
**Then** it degrades to a clear unavailable state without nagging or dead-ending (NFR13)

### Story 13.3: Cheat-Code Reward Payouts

As a player,
I want ad rewards that feel like turning on a temporary cheat code,
So that I *want* to watch.

**Acceptance Criteria:**

**Given** a completed rewarded ad
**When** the reward is granted
**Then** it delivers a large "cheat-code" payout — e.g. a 20× XP burst, +5 smart bombs, an **instant Lv5 item of choice**, or an invulnerability burst — through the existing XP/bomb/item grant seams (Epics 8–12) (FR34)

**Given** an "instant Lv5 item of choice" reward
**When** it grants an item already partnered for a fusion
**Then** it may immediately satisfy a fusion condition — this arc-shortcut is intended and permitted (FR34)

**Given** any cheat-code reward is applied
**When** it spikes the player's power
**Then** it routes through the Story 9.4 boost hook so the spawn director answers with proportionate threat (power-in → threat-out) (FR34, FR32)

### Story 13.4: Generosity Pillar Guardrails (Made Testable)

As the product,
I want the anti-dark-pattern promise enforced in code,
So that future changes can't quietly betray it.

**Acceptance Criteria:**

**Given** the entire app
**When** audited
**Then** there exists **no** code path that shows an ad unprompted, gates progress behind an ad, or offers any IAP/microtransaction (FR34)

**Given** every ad is player-initiated and offline-safe
**When** a player never touches the ad button
**Then** the full game — every level, every Epic, every ship unlock — remains reachable through normal play (FR34, NFR13)

## Epic 14: Meta-Progression & Ships

**Goal:** The between-runs layer. Earn **Cores** per run and spend them on a small **permanent** tree that intentionally *completes* in ~20 hours (growth as an arc, not a treadmill), and unlock **five trade-off ships** through achievement (never purchase), each of which makes the game play differently. All meta state persists locally with a forward-compatible schema (NFR14).

### Story 14.1: Cores Economy & Persistence

As a player,
I want runs to earn a currency I keep,
So that even a failed run makes lasting progress.

**Acceptance Criteria:**

**Given** a run ends
**When** Cores are awarded
**Then** the payout is derived from score, level reached, and Epics fused, and is added to a persistent Core balance (FR35, NFR14)

**Given** the Core balance and any purchased nodes / unlocked ships
**When** the app is closed and reopened
**Then** all meta state persists via `localStorage` under a forward-compatible schema alongside high score/settings (NFR14)

### Story 14.2: The Permanent Core Tree

As a player,
I want to spend Cores on permanent upgrades that eventually finish,
So that meta-progression is a satisfying completing arc.

**Acceptance Criteria:**

**Given** the Core tree
**When** the player spends Cores
**Then** nodes unlock — Starting XP (200, begin at Lv2), Reroll+ (350), Banish+ (350), Greed (500, +10% XP), Foresight (800, see 4 cards pick 1), Loadout (1200, choose starting weapon) — and their effects apply to subsequent runs (FR35)

**Given** the tree is capped (~15 nodes, ~20h to fully unlock)
**When** all nodes are purchased
**Then** the tree shows as complete with no further Core sink (no endless treadmill) (FR35)

### Story 14.3: Ship Unlocks & Roster

As a player,
I want to unlock new ships by achieving things,
So that mastery — not money — opens new ways to play.

**Acceptance Criteria:**

**Given** the ship roster
**When** its unlock conditions are met in play
**Then** ships unlock: **Needle** (reach Lv20), **Bulwark** (defuse 5 black holes in one run), **Vector** (fuse 3 Epics in one run), **Ghost** (die at exactly 10× three times) — Vanguard is the default; no ship is ever purchasable (FR36, NFR14)

**Given** an unlocked ship
**When** the player selects it before a run
**Then** it is chosen as the run's ship and persists as unlocked (FR36, NFR14)

### Story 14.4: Ship Trade-off Integration

As a player,
I want each ship to genuinely change the game,
So that a ship is a different game, not a bigger number.

**Acceptance Criteria:**

**Given** a selected ship
**When** a run starts
**Then** its trade-offs apply through existing systems — Needle (+30% fire rate, 1 life), Bulwark (+2 lives, −20% move), Vector (1 free reroll per level-up, −25% dmg), Ghost (phases through enemies in a <15% HP window, no shield synergy) (FR36)

**Given** the Loadout meta node (Story 14.2)
**When** it is owned
**Then** the player may choose their starting weapon at run start (FR35, FR36)

## Epic 15: Daily Seeded Run

**Goal:** The deterministic capstone — a shared daily challenge where everyone plays an identical run. This requires the whole simulation to be reproducible from a seed; the seedable-RNG seam planted in Epic 8 makes this an *additive* mode rather than a rewrite. Deliver the determinism hardening pass first, then the daily mode.

### Story 15.1: Deterministic Simulation Hardening

As a developer,
I want spawns and card offers driven entirely by one seedable RNG stream,
So that a seed reproduces a run exactly.

**Acceptance Criteria:**

**Given** all gameplay randomness (spawn director, enemy selection, card offers, drops)
**When** the simulation runs
**Then** it draws only from a single seedable RNG stream with no `Math.random` in the gameplay hot path (FR37, NFR12)

**Given** the same seed and the same player inputs
**When** a run is replayed
**Then** it produces an identical sequence of spawns and card offers (FR37, NFR12)

### Story 15.2: Daily Seeded Run Mode

As a player,
I want a daily challenge everyone shares,
So that I can compare my run against the same conditions as others.

**Acceptance Criteria:**

**Given** a daily seed derived from the date
**When** the player starts the daily run
**Then** the run uses that seed so spawns and card offers are identical for all players that day (FR37, NFR12)

**Given** a completed daily run
**When** it ends
**Then** the result (score, level, Epics fused) is captured against that day's seed for the player's own comparison, with local persistence (FR37, NFR14)
