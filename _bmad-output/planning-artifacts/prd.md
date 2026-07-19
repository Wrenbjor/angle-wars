---
stepsCompleted: []
inputDocuments: []
project: Angle Wars
version: 1.0
date: 2026-07-19
author: Party Mode roundtable (facilitated for Wren)
---

# Angle Wars — Product Requirements Document (v1)

## 1. Vision

Angle Wars is a faithful, 1:1 clone of **Geometry Wars: Retro Evolved** (2005) built in **Phaser (WebGL)** and playable in the browser. A single ship, a single bounded neon arena, an endless escalating swarm of geometric enemies, and one perfect risk/reward loop: kill without dying to climb your multiplier, because death takes it all away.

This is v1. It is deliberately **pure** — no collectible geoms, no game-mode menu, no player abilities. Those are v2. The goal of v1 is a polished, shippable recreation of the single Evolved mode that made the original a classic, and a clean engine on which a v2 (custom powers, progression) can later be built.

## 2. Goals & Non-Goals

### Product Goals
- **G1 — Faithful feel.** Reproduce Retro Evolved's twin-stick control, enemy behaviors, and the multiplier-dies-on-death tension so a fan recognizes it instantly.
- **G2 — Signature aesthetic.** Neon vector glow (bloom), a deforming grid floor, and dense particle effects at a locked framerate.
- **G3 — Shippable polish.** A complete game shell — title, pause, game-over, high score, settings — deployable as a static web build.
- **G4 — A clean engine for v2.** Entity/system architecture extensible enough to bolt on powers and progression later without a rewrite.

### Non-Goals (explicitly out of scope for v1)
- ❌ Collectible **geoms** and the RE2-style uncapped multiplier (RE1 has neither).
- ❌ Multiple game modes (Waves, Pacifism, King, Sequence, Deadline) — RE1 is single-mode.
- ❌ **Special powers / abilities** and **level progression / unlocks** — these are Wren's v2.
- ❌ Online multiplayer, leaderboards-as-a-service, accounts. (Local high score only.)
- ❌ Native/console builds. Web (WebGL) only for v1.

## 3. Target Player & Platform

- **Player:** Arcade-score-chasers and Geometry Wars fans; anyone who wants a tight 3-minute "one more run" session.
- **Platform:** Desktop web browsers with WebGL. Primary input **gamepad (twin-stick)**; **keyboard + mouse** fully supported as fallback.

## 4. Design Pillars

1. **The multiplier is the game.** It climbs to **10×** by killing without dying, and **resets to 1× on death**. Every design decision serves this tension. (This is the single biggest RE1-vs-RE2 distinction and is non-negotiable.)
2. **Everything glows, everything moves.** Additive neon rendering + bloom, a grid that ripples from every explosion and warps around gravity wells, particles everywhere — at a rock-solid framerate.
3. **Feel over features.** The ship's acceleration, the fire cadence, the screen shake, the death burst — these are tuned by hand after launch with a controller in-hand. The PRD specifies *what*, not the final magic numbers.
4. **Pure and small.** One dish cooked flawlessly. No feature enters v1 that wasn't in Retro Evolved.

## 5. Core Loop

Spawn → move & aim independently (twin-stick) → auto-fire clears enemies → enemies escalate endlessly → killing raises your multiplier (cap 10×) → a hit kills you, costs a life, and **resets your multiplier** → smart bomb clears the screen in an emergency → out of lives → game over → high score → again.

## 6. Enemy Roster (RE1 canon)

Faithful behaviors are the acceptance criteria; exact tuning constants are set during story implementation and post-launch playtest.

| Enemy | Behavior |
|-------|----------|
| **Blue Seeker** | Diamond. Spawns and immediately homes toward the player. The baseline threat. |
| **Green Square** | Flees the player until fired upon, then turns aggressive and agile. Must be cornered. |
| **Pinwheel / Wanderer** | Drifts on a random trajectory, indifferent to the player, bouncing around the arena. |
| **Snake** | Segmented body that slithers in a line; dangerous along its whole length. |
| **Black Hole** (hazard) | Gravity well: pulls in the ship, enemies, and bullets; warps the grid; grows when fed; spawns enemies; destructible, with a violent payout when destroyed. |

> The exact canonical roster is finalized at GDD/create-story time against Retro Evolved; the set above is the confirmed faithful core. Additional archetypes (e.g. rockets) may be added as stories in Epic 2 without changing the architecture.

## 7. Functional Requirements

- **FR1** — Twin-stick control: movement and aim are independent (left stick moves, right stick aims; keyboard-move + mouse-aim fallback).
- **FR2** — Continuous auto-fire of projectiles in the aim direction at a fixed cadence.
- **FR3** — Bounded rectangular arena; the ship is clamped to bounds and bullets despawn at the edge.
- **FR4** — Enemy roster with faithful per-type behaviors (Seeker, Green Square, Pinwheel/Wanderer, Snake, Black Hole).
- **FR5** — Endless spawn director with a continuous difficulty ramp (rate and mix escalate over time).
- **FR6** — Collision: bullets destroy enemies; enemy-or-hazard contact kills the player.
- **FR7** — Score accrues per kill, weighted by enemy type, multiplied by the current multiplier.
- **FR8** — Multiplier increments on kills, caps at **10×**, and **resets to 1× on player death**.
- **FR9** — Smart bombs: start with **3**, detonation clears all on-screen enemies with a shockwave, **+1 bomb per 100,000 points**.
- **FR10** — Extra lives awarded at score thresholds.
- **FR11** — Persistent local high score (survives reload).
- **FR12** — Player death: lose a life, brief respawn invulnerability, out of lives → game over.
- **FR13** — Black hole: exerts gravity on ship/enemies/bullets, distorts the grid, spawns enemies, is destructible.
- **FR14** — Game flow: title → play → game over → restart/title.
- **FR15** — Pause and resume mid-run.
- **FR16** — Input: gamepad twin-stick with deadzones, plus keyboard+mouse fallback; hot-swap between them.

## 8. Non-Functional Requirements

- **NFR1** — Sustain **60 FPS** on mid-range hardware under peak load (hundreds of entities + thousands of particles).
- **NFR2** — **Object pooling** for all high-churn entities (bullets, enemies, particles); **zero per-frame allocation** in the hot loop.
- **NFR3** — **Fixed-timestep** simulation so feel is identical regardless of render framerate.
- **NFR4** — Neon aesthetic via WebGL additive blending + a **Bloom post-FX** pipeline.
- **NFR5** — The deforming grid runs on the GPU (mesh/shader), not per-vertex CPU work.
- **NFR6** — Ships as a **static web build**; fast first load; no server required.
- **NFR7** — Runs across modern desktop browsers; canvas scales responsively while preserving arena aspect.
- **NFR8** — Entity/system architecture is clean and extensible enough that v2 powers/progression bolt on without a rewrite.

## 9. Technical Approach

- **Engine:** Phaser 3 (WebGL renderer). Use Phaser's built-in **Bloom post-FX** for the glow, additive-blend sprites/graphics for neon vectors, and a custom mesh/shader for the deforming grid.
- **Architecture:** Lightweight entity/component structure with dedicated systems (movement, spawning, collision, scoring, VFX). Managed object pools per entity type.
- **Simulation:** Fixed-timestep update decoupled from render.
- **Persistence:** `localStorage` for high score and settings.
- **Build/Deploy:** Static bundle (e.g. Vite) deployable to any static host.

## 10. Success Metrics

- A Geometry Wars fan plays it blind and says "yep, that's Retro Evolved."
- Holds 60 FPS during a late-game swarm with bombs going off.
- The multiplier-reset-on-death tension is *felt* — dying at 10× hurts.
- A full session (title → runs → game over → high score) works end to end with zero dead ends.

## 11. Epic Roadmap (spine-first)

1. **Epic 1 — Playable Core Loop:** production-grade vertical slice; ship, firing, one enemy, death, score. Proves the feel.
2. **Epic 2 — Enemy Roster & Spawn Director:** all archetypes + endless escalation.
3. **Epic 3 — Score, Multiplier, Bombs & Lives:** the RE1 economy (incl. multiplier-reset-on-death).
4. **Epic 4 — Signature Aesthetic & Juice:** bloom, deforming grid, particles, screen feel, audio.
5. **Epic 5 — Game Shell, Flow & Release:** title, pause, settings, input polish, performance hardening, web build.

Full story breakdown with acceptance criteria: see `epics.md`.

## 12. Open Questions / Deferred to Playtest

- Final feel constants (accel, drag, fire rate, bullet speed, shake magnitude) — tuned post-launch with a controller (Design Pillar 3).
- Exact score weights per enemy, life/bomb thresholds — start from RE1 references, tune live.
- Confirmation of any additional RE1 enemy archetypes beyond the confirmed five.
