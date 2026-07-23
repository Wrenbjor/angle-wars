---
stepsCompleted: []
inputDocuments: []
project: Angle Wars
version: 1.0
date: 2026-07-19
author: Party Mode roundtable (facilitated for Wren)
---

# Angle Wars — Product Requirements Document

> **Document status.** **Part 1 (v1 — the pure Retro Evolved clone, §§1–12) is SHIPPED** — Epics 1–7 are complete and the game runs on desktop and mobile. **Part 2 (v2 — Progression, §13+) is the new specification** added on top of the shipped core: XP, a card-draft build system, a fusion tech-tree, an opt-in "cheat-code" ad model, meta-progression, and ships. Read Part 1 for what exists; read Part 2 for what's next.

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
- ❌ Console builds. (Web WebGL is the v1 target; a **mobile** native shell via Capacitor is added post-v1 as Epic 7 — see §11.)
- ❌ In-app purchases and ads-as-a-tax. *(Superseded in v2: see §13.7 — v2 introduces the **Generosity Engine**, an opt-in "cheat-code" rewarded-ad model with **no IAP and no microtransactions**. This retires the old "IAP/ads deferred to a later epic" plan.)*

## 3. Target Player & Platform

- **Player:** Arcade-score-chasers and Geometry Wars fans; anyone who wants a tight 3-minute "one more run" session.
- **Platform:** Desktop web browsers with WebGL. Primary input **gamepad (twin-stick)**; **keyboard + mouse** fully supported as fallback. **Mobile** (iOS/Android) is added post-v1 via a Capacitor native shell with on-screen touch twin-stick controls — see Epic 7 in §11.

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

**Post-v1 epics** (layered on the finished, shipped core):

6. **Epic 6 — Feel & Signature Hazards:** discovered-through-play tuning — calmer grid feedback + reduced-motion accessibility, the black hole re-cast as an unstable ticking bomb, and the mirror-reflector "dumbbell" hazard.
7. **Epic 7 — Mobile (Capacitor Shell & Touch Play):** wrap the static web build as an installable iOS/Android app via **Capacitor** — on-screen touch twin-stick controls into the existing input seam, safe-area-aware landscape layout, a mobile performance profile, native lifecycle (auto-pause, haptics, keep-awake), and store-submission scaffolding.

**v2 — Progression** (layered on the shipped v1 core; full design in §13, story breakdown in `epics.md`):

8. **Epic 8 — The Level-Up Loop (XP, Curve & Card UI):** XP orbs, the level curve, the time-dilated level-up moment, and the weighted 3-card draft with slot limits, reroll, and banish — the progression skeleton, testable with placeholder cards.
9. **Epic 9 — Adaptive Spawn Director & Armored Threat:** rework the spawn director from time-based to **build-power-based** (track player DPS, feed it into spawn weight) and add the armored enemy archetype. The load-bearing system that keeps a maxed build honest — and the governor that keeps the Generosity Engine's cheat-codes fair. Built *before* the exotic cards.
10. **Epic 10 — Core Arsenal (Stat-Stackers):** Overcharge, Spread Cannon, Nanite Shield, Afterburner at all five levels — validates that stat-stacking feels good, and lays the item/upgrade framework.
11. **Epic 11 — Exotic Arsenal & New Entity Systems:** the remaining ten items — Orbit Blade, Seeker Drones, Mine Layer, Piercing Lance, Ricochet, Flak Burst, Gravity Well, Reinforced Hull, Bomb Capacitor, Chrono Field. The pooling stress test.
12. **Epic 12 — The Fusion Tech Tree (Epics):** the fusion condition system, the FUSION READY moment, and all fourteen run-defining Epic upgrades (with a hard live-split cap on Kaleidoscope).
13. **Epic 13 — The Generosity Engine (Opt-In Reward Ads):** the anti-dark-pattern monetization pillar — a player-initiated ad button that grants massive "cheat-code" rewards, **never forced**, always optional, offline-safe. No IAP, no microtransactions.
14. **Epic 14 — Meta-Progression & Ships:** the Cores economy, a small permanent tree that *completes* in ~20 hours, and five unlockable trade-off ships.
15. **Epic 15 — Daily Seeded Run:** make the simulation deterministic and add a shared daily challenge on a common seed.

Full story breakdown with acceptance criteria: see `epics.md`.

## 12. Open Questions / Deferred to Playtest

- Final feel constants (accel, drag, fire rate, bullet speed, shake magnitude) — tuned post-launch with a controller (Design Pillar 3).
- Exact score weights per enemy, life/bomb thresholds — start from RE1 references, tune live.
- Confirmation of any additional RE1 enemy archetypes beyond the confirmed five.

---

# Part 2 — Angle Wars v2: Progression

## 13. v2 Overview

v1 is a pure, faithful clone: one ship, one arena, one perfect risk/reward loop. v2 keeps that loop **completely intact** and layers a roguelite build system on top of it. Every run still starts as Retro Evolved. The difference is that killing now also earns **XP**, XP earns **level-ups**, and each level-up is a **choice** — a three-card draft that, over a run, turns the ship into a specific build. A **fusion tech-tree** turns pairs of maxed items into run-defining **Epics**. Between runs, a small **meta-progression** tree and a roster of **trade-off ships** give a completing (not endless) sense of growth. Monetization is a single, deliberately generous, opt-in ad model.

The multiplier is still king. Death still resets it. Everything in v2 is built to make you want to keep it alive.

### 13.0 v2 Design Pillars

1. **The v1 loop is untouched.** Progression is *additive*. A player who ignores every card still plays Retro Evolved. Movement, firing, bombs, the multiplier, and death all keep their v1 behavior.
2. **You get two Epics, maybe three — never all fourteen.** Scarcity is the replay engine. The fusion tree is shaped so that no single run can complete it; each run is a different two or three points on the map.
3. **The build becomes a commitment.** Around level 9–12 the slots fill and the run stops being "collect everything" and becomes "this specific build." That moment is the point.
4. **Difficulty scales to power, not just to the clock.** A good build must be *answered* by the game, or minute 20 becomes an idle game. The spawn director tracks what the player can actually do and responds.
5. **The Generosity Engine: an ad is a gift you reach for, never a tax you pay.** No IAP. No microtransactions. No forced ads, ever. The only monetization is an *obvious, optional* button that grants a massive "temp cheat-code" reward when the player chooses to watch. We blow the dark pattern out of the water — players *want* to click, because they know exactly what it gets them.
6. **Growth completes.** The permanent meta-tree is intentionally finite (~15 nodes, fully unlockable in ~20 hours). Permanent power that never ends is a treadmill; permanent power that *finishes* is a satisfying arc.

## 13.1 XP & Level Curve

XP orbs drop on kill and drift toward the ship inside a **pickup radius** (a defense stat you can upgrade). Orbs left on the floor are a soft tension: chase them into danger, or leave value behind.

**XP sources:**

| Source | XP |
|---|---|
| Blue Seeker | 1 |
| Green Square | 2 |
| Pinwheel | 2 |
| Snake segment | 1 (head: 3) |
| Black Hole defused | 25 |
| Mirror Reflector center-kill | 15 |
| Multiplier bonus | XP × (1 + mult/20) — 10× = 1.5× XP |

**Curve:** `XP_to_next(n) = 8 + 6n + 0.55n²`

| Level | XP to next | Cumulative | ~Time |
|---|---|---|---|
| 1→2 | 15 | 15 | 0:20 |
| 2→3 | 22 | 37 | 0:45 |
| 5→6 | 52 | 190 | 2:30 |
| 10→11 | 123 | 725 | 6:00 |
| 15→16 | 222 | 1,780 | 11:00 |
| 20→21 | 350 | 3,600 | 18:00 |
| 25→26 | 502 | 6,400 | 27:00 |
| 30 (cap) | — | 9,800 | ~38:00 |

Level 30 is a full build. Most runs die at 12–18 — that's correct; the ceiling should feel distant.

**Level-up moment:** time dilates to **0.15×** rather than a hard pause. The arena keeps crawling behind the card UI so the player sees the swarm they're about to be dropped back into. Enemies can't damage the player during selection. Three cards, one pick.

## 13.2 Card Offer Logic

Not pure random — weighted:

```
weight = base_rarity_weight
       × (owned ? 2.2 : 1.0)          // finishing builds > starting them
       × (level_1_of_5 ? 1.0 : 1.4)   // mid-tier upgrades favored
       × (slots_full && !owned ? 0 : 1) // no dead offers
       × banish_multiplier
```

**Slot limits:** 5 offense weapons, 4 defense items. Once full, only owned-item upgrades appear. This forces commitment around level 9–12 — the moment a run becomes a specific build.

**Reroll:** 1 free per run, +1 at level 10, 15, 20. **Banish:** 2 per run, permanently removes a card from the offer pool for that run. Both are build-shaping tools, not conveniences.

**Epic gating:** an item at Lv5 does *not* auto-offer its Epic. An Epic requires a **fusion condition** — a second specific item at Lv3+. This is the tech-tree's actual spine. You can't get every Epic in one run; you get two, maybe three.

## 13.3 The Offense Tree (8 items)

Each item levels 1→5; Lv5 + a fusion partner unlocks its Epic (see §13.5).

| # | Item | Role | Level path (1→5) | Epic |
|---|---|---|---|---|
| 1 | **Orbit Blade** | Melee ring (whip analogue) | 1 blade 90dmg/1.2s → 2 opposed → 3 blades/1.0s → 4 blades +40% → 5 blades/0.7s +25% radius | **Tesla Circuit** — blades chain lightning between each other; enemies inside the ring take continuous arc damage; kills spawn a 2-jump chain |
| 2 | **Spread Cannon** | Base-weapon evolution (always offered by Lv3) | 3-way/12° → 5-way/16° → +30% fire rate → 7-way/22° → 9-way/+35% dmg | **Sunburst** — full 360° ring every 4th volley; ring bullets pierce twice |
| 3 | **Piercing Lance** | Slow, heavy, line-clearing | 2s bolt/pierce 2 → pierce 4 → 1.4s/+50% → pierce 7 +0.5s trail → fires fwd+back | **Railgun** — 1.2s charge, arena-width, infinite pierce, grid-shockwave line, +200% dmg |
| 4 | **Seeker Drones** | Autonomous ("enemies behind me") | 1 drone/1.5s → 2 → 3/+40% → 4 homing → 5/+60% | **Swarm Protocol** — drones ram-kill + respawn in 3s; each drone kill spawns a mini-drone (5s) |
| 5 | **Mine Layer** | Zone control (rewards kiting) | mine/2s 3s-arm 60r → +2 cap/100r → 1.3s → mines pull inward → chain to adjacent | **Singularity Field** — mines become mini black holes: pull 1.5s then implode 3× dmg + grid warp (reuses gravity shader) |
| 6 | **Ricochet Rounds** | Synergy with Mirror Reflector | bounce once → twice → +25%/bounce → bounce off enemies → 4 bounces + seek | **Kaleidoscope** — every wall bounce splits the bullet in two *(hard live-split cap required — see §13.8)* |
| 7 | **Flak Burst** | Anti-cluster | every 5th shot → 6 frags → every 4th/8 → +50% → every 3rd/12 → frags airburst once | **Fragmentation Cascade** — enemies killed by a fragment airburst on death; chain-clears dense waves |
| 8 | **Overcharge** | Support/enabler (the common fusion key) | +15% dmg → +25%/+10% rate → +35%/+20% → +45%/+30% → +60%/+40% | **Critical Resonance** — 20% crit for 3× dmg; crits emit a shockwave and refund 1 XP |

## 13.4 The Defense Tree (6 items)

| # | Item | Level path (1→5) | Epic |
|---|---|---|---|
| 1 | **Nanite Shield** | absorb 1 hit/20s → 15s → 2 charges → 10s → 3 charges + knockback pulse | **Phase Armor** — shield break = 2s intangible, pass through and damage enemies |
| 2 | **Afterburner** | +12% speed → +20% + dash(3s cd) → +25% + dash i-frames → 2s cd + dash damages → +35% + burning trail | **Slipstream** — dash spawns a taunting decoy (3s) that then explodes |
| 3 | **Gravity Well** | +40% pickup radius → +80% → orbs home → +25% XP value → +150% + pulls enemies slightly | **Event Horizon** — permanent weak gravity field: enemies drift in, bullets curve into them (high-risk enabler) |
| 4 | **Reinforced Hull** | +1 life → i-frames 2s→3.5s → +1 life → death drops mult to 50% not 1× → +1 life (4 total) | **Revenant** — on death a 900-radius smart-bomb detonates and you keep your full multiplier |
| 5 | **Bomb Capacitor** | +1 bomb/+30% radius → threshold 100k→75k → stun survivors 2s +1 bomb → threshold 50k + bombs drop 5 XP → +2 bombs + 3s damage field | **Chain Reaction** — bomb kills each detonate a mini-bomb; screen-wide cascade |
| 6 | **Chrono Field** | 250px/12% slow → 300px/20% → enemy bullets slow 30% → 380px/30% → also slows Black Hole growth + Reflector spin | **Stasis Lock** — every 12s freeze all enemies 1.5s; frozen enemies take 2× dmg and shatter into extra XP |

## 13.5 Fusion Map (the actual tech tree)

```
Orbit Blade Lv5    + Overcharge Lv3      → TESLA CIRCUIT
Spread Cannon Lv5  + Piercing Lance Lv3  → SUNBURST
Piercing Lance Lv5 + Overcharge Lv3      → RAILGUN
Seeker Drones Lv5  + Nanite Shield Lv3   → SWARM PROTOCOL
Mine Layer Lv5     + Gravity Well Lv3    → SINGULARITY FIELD
Ricochet Lv5       + Spread Cannon Lv3   → KALEIDOSCOPE
Flak Burst Lv5     + Overcharge Lv3      → FRAGMENTATION CASCADE
Overcharge Lv5     + any 2 offense Lv5   → CRITICAL RESONANCE

Nanite Lv5         + Afterburner Lv3     → PHASE ARMOR
Afterburner Lv5    + Nanite Lv3          → SLIPSTREAM
Gravity Well Lv5   + Mine Layer Lv3      → EVENT HORIZON
Reinforced Lv5     + Bomb Capacitor Lv3  → REVENANT
Bomb Capacitor Lv5 + Flak Burst Lv3      → CHAIN REACTION
Chrono Field Lv5   + any defense Lv5     → STASIS LOCK
```

The shape is deliberate. **Overcharge** feeds three Epics — the greedy generalist pick that always feels safe but caps your Epic count. **Nanite ↔ Afterburner** fuse into each other, so a defense-first player gets a mutually reinforcing pair. **Mine Layer ↔ Gravity Well** cross-fuse, making the "gravity build" the most cohesive archetype (and reusing existing shader work). Realistic run: 2 Epics by level 20, 3 if you commit hard and reroll well. Never all 14. **That's the replay engine.**

## 13.6 Fusion UX

When both conditions are met, the **next** level-up guarantees the Epic card in slot 1, rendered differently — gold border, particle aura, the fusion recipe shown beneath, a distinct audio sting. It replaces the Lv5 item; the fusion partner is consumed to a **Lv3 remnant** (keeps its stats, stops upgrading). A **⚡ FUSION READY** badge appears on the HUD the moment the condition is satisfied. The anticipation between "ready" and the next level-up is a genuine tension spike — protect it.

## 13.7 Monetization — The Generosity Engine

**No IAP. No microtransactions. No forced ads. Ever.** Monetization is a single opt-in mechanism: an **obvious, always-optional ad button/icon** the player can hit whenever they want. Watching a rewarded ad grants a **massive "temp cheat-code" reward** — e.g. 20× XP burst, +5 smart bombs, an **instant Lv5 item of choice**, a burst of invulnerability. An ad should feel like *turning on a cheat code you chose.*

- **Never pop an ad unprompted.** No interstitials, no post-run gates, no hidden-X dark patterns. The player initiates, always.
- **The reward is the advertisement.** Players click *because they know exactly what it gets them* — that's the whole model.
- **Cheat-codes can shortcut the build arc, and that's fine.** "Instant Lv5 item" can hand you a fusion partner; a 20× XP burst can vault levels. This is intended — it's a solo score-chaser and the reward is a toy.
- **The Spawn Director is the governor.** Because difficulty scales to build power (§13.8), a big ad boost is *answered* by a proportionately harder swarm. Power-in triggers threat-out. The cheat-code doesn't break the game — the game rises to meet it.
- **Offline-safe.** The base game is complete and fully playable with the ad button never touched. Ad unavailability (offline, SDK not ready, network fail) never blocks progress and the button degrades cleanly.
- **The trade we're making, on the record:** a never-forced ad model earns far less per user than a dark-pattern one. We are trading revenue-per-user for goodwill, retention, and word-of-mouth — deliberately. This pillar is load-bearing enough to say *no* to ourselves later.

## 13.8 Meta-Progression (no microtransactions)

**Cores** — earned per run from score, level reached, and Epics fused. Spent on a small **permanent** tree:

| Node | Cost | Effect |
|---|---|---|
| Starting XP | 200 | Begin at level 2 |
| Reroll+ | 350 | +1 reroll per run |
| Banish+ | 350 | +1 banish |
| Greed | 500 | +10% XP globally |
| Foresight | 800 | See 4 cards, pick 1 |
| Loadout | 1200 | Choose your starting weapon |

Cap this deliberately — ~15 nodes total, fully unlockable in ~20 hours. Permanent power that *completes* is a satisfying arc, not a treadmill.

**Ships** (unlocks, not purchases) — each is a different game, not a bigger number:

| Ship | Unlock | Trade-off |
|---|---|---|
| **Vanguard** | default | baseline |
| **Needle** | reach Lv20 | +30% fire rate, 1 life only |
| **Bulwark** | defuse 5 black holes in one run | +2 lives, −20% move speed |
| **Vector** | fuse 3 Epics in one run | 1 free reroll per level-up, −25% dmg |
| **Ghost** | die at exactly 10× three times | phases through enemies at <15% HP window, no shield synergy |

## 13.9 Balance Guardrails

- **Epic power ceiling: ~4× a Lv5 item.** Epics should feel run-*defining*, not run-*ending*. If Railgun trivializes the swarm at level 18, the ramp must outpace it.
- **The spawn director must scale to build power, not just time.** Track player DPS over a rolling 10s window and feed it into spawn weight. Otherwise a good build turns minute 20 into an idle game. *(This is the single most load-bearing system in v2 — see Epic 9.)*
- **Late-run enemy answer.** Introduce an **armored archetype** around 15:00 that takes reduced damage from projectiles but full damage from melee/AoE. Keeps Orbit Blade and Mine builds viable and stops pure-Spread from being the only correct answer.
- **The multiplier must stay king.** Every Epic should have a reason to keep it alive. **Revenant** is the deliberate exception — the "I accept death" build, interesting *only* because everything else says the opposite.
- **Bounded worst-case entity counts.** Mechanics that multiply live entities (Kaleidoscope's bullet-splitting, Fragmentation cascades, 5 blades + 5 drones + 12 mines simultaneously) get **hard live-count caps** so peak density stays inside the framerate budget (NFR11).

## 13.10 v2 Build Order → Epic Mapping

The v2 epics (8–15) follow this dependency order. Spine-first *within v2*: the loop and its governor before the content; content before the money and the meta.

1. **XP orbs + level curve + card UI** → **Epic 8**. The loop is testable with 3 placeholder cards. Route all gameplay RNG through a single seedable stream from the start, so the daily-run capstone (Epic 15) is additive, not a rewrite.
2. **Adaptive spawn director + armored enemy** → **Epic 9**. The load-bearing governor and the late-game answer. Built *before* the exotic cards so every item is tested against a director that scales to it — and so the Generosity Engine has its safety valve ready.
3. **Overcharge, Spread, Nanite, Afterburner at all 5 levels** → **Epic 10**. Validates stat-stacking feels good before any exotic behavior; lays the item/upgrade framework.
4. **Orbit Blade, Drones, Mine Layer + remaining items** → **Epic 11**. New pooled entity systems; exposes whether pooling holds under peak build density.
5. **Fusion system + 3 proof Epics (Tesla, Railgun, Phase Armor), then the rest** → **Epic 12**. Prove the pattern, then complete all 14.
6. **The Generosity Engine** → **Epic 13**. Opt-in cheat-code ads, governed by the Epic 9 director.
7. **Meta-progression + ships** → **Epic 14**. The between-runs layer.
8. **Daily seeded run** → **Epic 15**. Needs the whole simulation deterministic; the determinism seam planted in Epic 8 pays off here.
