# Epic 9 Context: Adaptive Spawn Director & Armored Threat

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic reworks the v1 spawn director from a purely time-based ramp into a closed-loop, build-power-aware system. Instead of difficulty scaling only with elapsed time, the director measures what the player can actually kill — a rolling estimate of player DPS — and feeds it into spawn rate, mix, and toughness so a strong build is answered rather than allowed to trivialize the late game. It also introduces the armored enemy archetype as the late-run counter that keeps melee, mine, and AoE builds relevant against pure-projectile builds. This is the single most load-bearing system in v2: it is the governor that later makes the Generosity Engine's cheat-code rewards fair (power-in produces threat-out), and it is deliberately built before the exotic cards of Epics 10–12 so every future item is tuned against a director that already scales to it. The v1 time-escalation is preserved as a difficulty floor.

## Stories

- Story 9.1: Player DPS Telemetry
- Story 9.2: Build-Adaptive Spawn Scaling
- Story 9.3: Armored Enemy Archetype
- Story 9.4: Governor Validation — Power Spikes Stay Honest

## Requirements & Constraints

- Maintain a rolling ~10-second estimate of player DPS, updated in the hot loop with zero per-frame allocation and no framerate dependence. The estimate must track real changes in player output (new weapon, Epic, boost, or a lull) smoothly across the window without spiking on individual hits.
- Feed the DPS estimate into spawn weight and rate so higher sustained damage output raises pressure (rate, mix, toughness). The response must be damped: a bounded step per adjustment, settling without oscillation, a death-spiral, or a boredom-spiral.
- The original time-based escalation remains a hard floor — adaptive scaling only ever adds pressure on top; difficulty never drops below the v1 curve.
- On a sudden large power spike (Epic fusion, ad cheat-code), pressure must rise proportionately and re-settle. On a sudden power drop (death reset, remnant consumption), pressure must relax back toward the floor rather than stranding the player against a swarm tuned for a build they no longer have.
- Armored archetype: introduced roughly at the 15:00 mark and/or on a build-power threshold, spawned with a telegraph. It takes reduced damage from projectiles but full damage from melee/AoE sources. It must be meaningfully harder for a pure-projectile build to clear, creating pressure to diversify — without ever being immune.
- Provide a boost hook that a simulated large transient boost can drive, proving the director answers it so the boost reads as a thrill, not a skip, and difficulty re-settles as the boost fades. Epic 13's real ad rewards must reuse this same governor path with no new balancing surface.
- Simulation runs on a fixed timestep; feel must be identical regardless of render framerate.

## Technical Decisions

- Extend the existing v1 spawn director rather than replacing it; the time-based ramp stays in place as the floor beneath the adaptive layer.
- Damage-dealt events already flowing through the collision/damage path are the telemetry source for the rolling DPS window — instrument that seam rather than adding a parallel accounting system.
- The closed loop must be explicitly damped and bounded (clamped per-adjustment step) to guarantee stability; this is a stated design constraint, not an implementation detail to be discovered.
- The armored archetype spawns through the existing spawn director + telegraph seam and is drawn from the enemy pool; its distinction is a per-damage-source modifier (reduced vs. full) keyed on projectile vs. melee/AoE, not a new spawn/render pipeline.
- Design the transient-boost hook as a shared, reusable entry point so Epic 13 (Generosity Engine) wires real rewards to the identical path. Keep the architecture extensible enough that this bolts on without a rewrite.

## Cross-Story Dependencies

- Story 9.2 consumes the DPS telemetry produced by Story 9.1; Story 9.4 validates the full loop from 9.1–9.3.
- Builds directly on the v1 spawn director and spawn telegraph, and on the fixed-timestep simulation and object-pooling foundations.
- Sequenced before Epics 10–12 (the card arsenal and fusion Epics) so each item is balanced against this director.
- The boost hook and governor path are the safety valve later relied on by Epic 13 (the Generosity Engine); armored-enemy viability assumes the melee/mine/AoE items that arrive in Epics 10–12.
