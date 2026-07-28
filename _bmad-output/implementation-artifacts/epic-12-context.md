# Epic 12 Context: The Fusion Tech Tree

## Summary

Epic 12 builds the **fusion system** — the roguelite tech tree that turns pairs of maxed items into fourteen **run-defining Epic upgrades**. Fusion is the spine of v2 progression: scarcity is the replay engine. The tree is shaped so no run can complete all Epics; a realistic run fuses 2–3, never all 14.

**Goal from epics.md:** Build the fusion mechanic + UX and three **proof Epics** first (Tesla Circuit, Railgun, Phase Armor) to prove the pattern across behavior classes (chain-damage, grid-deform, defense-transform), then complete the remaining eleven Epics. Kaleidoscope ships with a hard live-split cap (NFR11).

**Spine-first within v2:** Epic 9 is built before this epic so every fusion Epic is tested against a director that scales to it.

---

## Fusion System (FR31) — Stories 12.1 (core) & 12.2 (UX)

### The Mechanic

- A fusion condition is: **item at Lv5 + a specific partner at Lv3+**
- When the condition is satisfied, a **⚡ FUSION READY** badge appears on the HUD immediately
- The **next** level-up **guarantees the Epic card in slot 1**
- The Epic card is rendered as a gold card with particle aura, the fusion recipe beneath, and a distinct audio sting
- When chosen, the fusion resolves:
  - The Lv5 item is **replaced** by its Epic
  - The fusion partner is **consumed to a Lv3 remnant** (keeps its stats, stops upgrading, still occupies its slot)
- Generic partner rules apply: "any 2 offense Lv5" or "any defense Lv5" styles are satisfied by any qualifying items, consuming the chosen partner(s)

**NFR5** relevance: Railgun deforms the grid in a shockwave line, reusing the existing grid shader.

---

## Fusion Recipes (the tech tree) — from PRD §13.5

```
Orbit Blade Lv5    + Overcharge Lv3      → TESLA CIRCUIT
Spread Cannon Lv5  + Piercing Lance Lv3  → SUNBURST
Piercing Lance Lv5 + Overcharge Lv3      → RAILGUN
Seeker Drones Lv5  + Nanite Shield Lv3   → SWARM PROTOCOL
Mine Layer Lv5     + Gravity Well Lv3    → SINGULARITY FIELD
Ricochet Lv5       + Spread Cannon Lv3   → KALEIDOSCOPE
Flak Burst Lv5     + Overcharge Lv3      → FRAGMENTATION CASCADE
Overcharge Lv5     + any 2 offense Lv5   → CRITICAL RESONANCE

Nanite Shield Lv5  + Afterburner Lv3     → PHASE ARMOR
Afterburner Lv5    + Nanite Shield Lv3   → SLIPSTREAM
Gravity Well Lv5   + Mine Layer Lv3      → EVENT HORIZON
Reinforced Hull Lv5 + Bomb Capacitor Lv3 → REVENANT
Bomb Capacitor Lv5 + Flak Burst Lv3      → CHAIN REACTION
Chrono Field Lv5   + any defense Lv5     → STASIS LOCK
```

**Tree shape notes:** Overcharge feeds three Epics (greedy generalist, always safe but caps Epic count). Nanite ↔ Afterburner cross-fuse (defense-first player gets a mutually reinforcing pair). Mine Layer ↔ Gravity Well cross-fuse (the "gravity build" is the most cohesive archetype, reuses existing shader work).

---

## Proof Epics (Stories 12.3–12.5: Tesla Circuit, Railgun, Phase Armor)

### Tesla Circuit — Orbit Blade Lv5 + Overcharge Lv3
- Blades chain **lightning** between each other
- Enemies inside the ring take **continuous arc damage**
- Kills spawn a **2-jump chain**
- NFR11: bounded entity counts for chain effects

### Railgun — Piercing Lance Lv5 + Overcharge Lv3
- A **1.2s charge** fires an **arena-width, infinite-pierce beam**
- Deforms the grid in a **shockwave line** (reuses existing grid shader — NFR5)
- **+200% damage**
- NFR5: grid deformation via the same GPU shader as grid ripple

### Phase Armor — Nanite Shield Lv5 + Afterburner Lv3
- Shield break makes the ship **intangible for 2s**
- Ship passes through and damages enemies
- Defense-transform Epic

**Balance guardrail:** Each Epic's power sits near the **~4× Lv5-item ceiling** — run-defining, not run-ending (from PRD §13.9).

---

## Offense Epics (Stories 12.6–12.11: Sunburst, Swarm Protocol, Singularity Field, Kaleidoscope, Fragmentation Cascade, Critical Resonance)

| Fusion | Epic | Effect |
|--------|------|--------|
| Spread Lv5 + Piercing Lv3 | **Sunburst** | 360° ring every 4th volley; ring bullets pierce twice |
| Drones Lv5 + Nanite Lv3 | **Swarm Protocol** | Drones ram-kill + respawn in 3s; each drone kill spawns a 5s mini-drone |
| Mine Lv5 + Gravity Well Lv3 | **Singularity Field** | Mines become mini black holes (pull 1.5s → implode 3× dmg + grid warp, reuses gravity shader) |
| Ricochet Lv5 + Spread Lv3 | **Kaleidoscope** | Every wall bounce splits the bullet in two — **hard cap on live split-bullets** (NFR11) |
| Flak Lv5 + Overcharge Lv3 | **Fragmentation Cascade** | Fragment-kills airburst on death; chain-clears dense waves |
| Overcharge Lv5 + any 2 offense Lv5 | **Critical Resonance** | 20% crit for 3× dmg; crits emit a shockwave and refund 1 XP (NFR5 grid use) |

---

## Defense Epics (Stories 12.12–12.16: Slipstream, Event Horizon, Revenant, Chain Reaction, Stasis Lock)

| Fusion | Epic | Effect |
|--------|------|--------|
| Afterburner Lv5 + Nanite Lv3 | **Slipstream** | Dash spawns a taunting decoy (3s) that then explodes |
| Gravity Well Lv5 + Mine Lv3 | **Event Horizon** | Permanent weak gravity field draws enemies in and curves bullets into them |
| Bomb Capacitor Lv5 + Flak Lv3 | **Chain Reaction** | Bomb kills each detonate a mini-bomb; screen-wide cascade (bounded by NFR11) |
| Chrono Field Lv5 + any defense Lv5 | **Stasis Lock** | Every 12s freeze all enemies 1.5s; frozen enemies take 2× dmg and shatter into extra XP |
| Reinforced Hull Lv5 + Bomb Capacitor Lv3 | **Revenant** | On death: 900-radius smart-bomb detonates and player keeps **full multiplier** — the deliberate "I accept death" exception to the multiplier-is-king rule (NFR11 bounding) |

---

## Relevant NFRs

- **NFR5** — Deforming grid on GPU (mesh/shader): Railgun shockwave line and Singularity Field grid warp reuse the existing grid shader.
- **NFR11** — Pooling holds under peak build density: 5 orbit blades + 5 drones + 12 mines simultaneously. Kaleidoscope bullet-splitting and Frag cascade carry **hard live-count caps** to bound exponential growth. Chain Reaction's screen-wide cascade and Swarm Protocol's mini-drone spawn are all capped.

Also relevant: **NFR1** (60 FPS under all these entity pressures), **NFR2** (object pooling, zero per-frame allocation in hot loop), **NFR8** (clean extensible entity/system architecture ready for Epics).

---

## Integration Points

- **PRD §13.5** (Fusion Map / recipes)
- **PRD §13.6** (Fusion UX spec: gold border, particle aura, audio sting, FUSION READY badge)
- **PRD §13.9** (Balance guardrails: ~4× Lv5 ceiling, capped entity counts, multiplier-is-king)
- **FR31** (Fusion system requirement)
- **Epic 10** (Item & Upgrade Framework: registry, per-level effects, owned-state, slot occupancy, Lv3-remnant state)
- **Epic 11** (Exotic Arsenal: all 14 source items that feed into fusions)

---

## Story 12.1 is the first story to implement

> **Re-sliced 2026-07-27:** Epic 12 is now 16 single-session stories (loop run 20260726-170549-ab23 timed out on every bundled story). Content is unchanged; only the slicing moved. See epics.md for the authoritative story list.

**Story 12.1: Fusion Core** — the sim-side plumbing: recipe registry (all fourteen recipes, data-driven), condition detection, level-up offer guarantee hook, fusion resolution (Lv5 item → Epic, partner → Lv3 remnant), and the generic partner rules. Epic effects are stubbed until their own stories land. **Story 12.2: Fusion UX** adds the HUD badge, gold card + particle aura + recipe text, and audio sting on top. Stories 12.3–12.16 then implement one Epic each and wire it to its recipe: proof Epics first (12.3 Tesla Circuit, 12.4 Railgun, 12.5 Phase Armor — one chain-damage, one grid-deform, one defense-transform), then the remaining offense (12.6–12.11) and defense (12.12–12.16) Epics. The fusion core must be complete and testable before any individual Epic can be verified.
