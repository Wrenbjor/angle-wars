# Epic 11 Context: Exotic Arsenal & New Entity Systems

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic ships the remaining ten arsenal items — six offense (Orbit Blade, Seeker Drones, Mine Layer, Piercing Lance, Ricochet Rounds, Flak Burst) and four defense (Gravity Well, Reinforced Hull, Bomb Capacitor, Chrono Field) — each at all five levels, completing the 14-item arsenal. Unlike Epic 10's stat-stackers, several of these introduce genuinely new pooled-entity systems (rotating blades, autonomous drones, timed mines, airburst fragments, ricochet bullets), which makes this epic the deliberate pooling stress test: it must hold the framerate target with 5 blades + 5 drones + 12 mines (plus fragment/ricochet multiplication) all live at once, with zero per-frame allocation. Every item plugs into an existing seam — the firing path, collision, the smart-bomb system, the movement seam, or the XP pickup radius — through the Epic 10 item/upgrade framework, so this is content plus new bounded entity systems, not new plumbing.

## Stories

- Story 11.1: Orbit Blade
- Story 11.2: Seeker Drones
- Story 11.3: Mine Layer
- Story 11.4: Piercing Lance
- Story 11.5: Ricochet Rounds
- Story 11.6: Flak Burst
- Story 11.7: Gravity Well
- Story 11.8: Reinforced Hull
- Story 11.9: Bomb Capacitor
- Story 11.10: Chrono Field

## Requirements & Constraints

- Each item is a five-level effect path registered as a declarative definition in the existing item framework; the card offer, on-pick application, owned-state, level, maxed, and remnant state all read from that one definition. Adding an item is content, not new plumbing.
- All high-churn entities introduced here (blades, drones, drone shots, mines, fragments, ricochet bullets, homing orbs) must be object-pooled with zero per-frame allocation in the hot loop.
- Any mechanic that multiplies live entities carries a hard live-count cap so the worst case stays inside the framerate budget: mine count is bounded (oldest removed/detonated past the cap), Flak fragment spawns are hard-capped, and ricochet bullets stay within the pool cap. Peak-density scenario (5 blades + 5 drones + 12 mines simultaneously) is the acceptance bar (NFR11).
- Melee/contact and AoE items (Orbit Blade, mine detonations, Flak fragments) must deal full damage to the armored enemy archetype (Story 9.3), which resists projectiles — this keeps melee/AoE builds viable and is a load-bearing interaction, not incidental.
- Defense items integrate with existing v1 systems rather than replacing them: Gravity Well feeds the Story 8.1 XP pickup radius/homing; Reinforced Hull adds max lives, respawn i-frame duration, and an item-gated multiplier-softening exception; Bomb Capacitor extends the v1 smart-bomb system (count, radius, threshold, effects); Chrono Field is a slow aura affecting enemies, enemy bullets, and world hazards.
- Reinforced Hull Lv4 is a deliberate, item-gated exception to the v1 "multiplier resets to 1× on death" rule — on death the multiplier drops to 50% rather than fully resetting. Revenant (Epic 12) is a further exception; both are intentional and must be gated strictly to the owning item.
- Chrono Field's top-level effect also slows world systems (Black Hole growth, Mirror Reflector spin) and enemy bullets — it is not enemy-movement-only at Lv5.

## Technical Decisions

- Reuse the Epic 10 data-driven registry: items are declarative definitions carrying track (offense/defense), base rarity weight, five per-level effect deltas, and fusion partner + Epic. The draft/upgrade/fusion systems already consume this registry unchanged.
- New pooled-entity systems (Orbit Blade rotation, autonomous Seeker Drones + their shots, timed/armed mines, airburst fragments, ricochet bullets, homing XP orbs) follow the existing per-type managed object-pool pattern with fixed caps; recompute or cache derived stats on level change, never per frame.
- Effect application flows through existing seams: firing (Piercing Lance, Ricochet Rounds, Flak Burst), collision (blades, mines, fragments), the smart-bomb system (Bomb Capacitor), the lives/multiplier/death path (Reinforced Hull), the movement/position seam (Mine Layer drop point, Orbit Blade anchor), and the XP pickup system (Gravity Well).
- Ricochet bounces off arena walls (and, at higher levels, enemies) — reuse the existing arena-bounds geometry; bounced bullets remain pooled and capped. This is the intended synergy seam with the Mirror Reflector hazard.
- Slot occupancy (5 offense, 4 defense) and maxed/Lv3-remnant state are already first-class in the framework; these items register into that state so the offer weighting and forward fusion checks read them without new wiring.
- The armored-enemy damage model (reduced from projectiles, full from melee/AoE) already exists from Epic 9; new melee/AoE items must route their damage so the armor modifier classifies them correctly.

## UX & Interaction Patterns

- All ten items surface through the existing level-up draft: time dilates (not a hard pause), the arena stays visible behind the card UI, the player is invulnerable during selection, and three weighted cards are offered. These are additional real item cards in the same flow — no new selection UX.
- New entity systems must be visually legible under the neon/bloom aesthetic so the player can read blade arcs, drone targeting, armed-vs-unarmed mines, and airburst fragments at a glance.

## Cross-Story Dependencies

- Depends on Epic 10: the item/upgrade framework (registry, per-level application, owned/level/maxed/remnant state, slot limits) is the substrate; every story here is content registered into it.
- Depends on Epic 8: the card draft, weighted offer logic, slot limits, reroll/banish, and the XP pickup system that Gravity Well (11.7) extends.
- Depends on Epic 9: the armored enemy archetype (Story 9.3) that Orbit Blade (11.1), mines (11.3), and Flak fragments (11.6) must damage in full; the adaptive spawn director should scale to these new build powers.
- Reuses v1 systems: smart bombs (Bomb Capacitor / 11.9), lives + multiplier-reset-on-death (Reinforced Hull / 11.8), and the Black Hole and Mirror Reflector hazards that Chrono Field (11.10) slows.
- Forward dependency: several items are fusion partners feeding Epic 12 Epics — Orbit Blade→Tesla Circuit, Piercing Lance→Railgun, Seeker Drones→Swarm Protocol, Mine Layer/Gravity Well→Singularity Field & Event Horizon, Ricochet→Kaleidoscope, Flak→Fragmentation Cascade, Bomb Capacitor→Chain Reaction/Revenant, Chrono Field→Stasis Lock. The maxed/remnant plumbing they hit already exists from Epic 10.
