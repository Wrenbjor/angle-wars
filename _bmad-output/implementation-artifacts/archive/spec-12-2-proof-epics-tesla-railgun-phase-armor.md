---
title: 'Proof Epics: Tesla Circuit, Railgun, Phase Armor'
type: 'feature'
created: '2026-07-27'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'f8263f623c3a278ec5cda69650d69441478b9203'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-1-fusion-system-and-ux.md'
  - '{project-root}/_bmad-output/planning-artifacts/prd.md'
warnings: []
---

## Intent

**Problem:** The fusion system (12.1) provides the plum-bing — detection, HUD badge, guaranteed Epic card, remnant consumption — but no fusion Epic has an actual gameplay effect. The three proof Epics (Tesla Circuit, Railgun, Phase Armor) are the first run-defining upgrades the player can fuse. They prove the pattern across all three behavior classes (chain-damage, grid-deform, defense-transform) and establish the architectural template for the remaining eleven Epics.

**Approach:** Three new pooled-entity systems (or modifications to existing ones):

1. **Tesla Circuit** — extends OrbitBladeSystem: blades chain lightning between each other when an enemy is inside the blade ring; kills spawn a 2-jump chain lightning effect.
2. **Railgun** — extends PiercingLanceSystem: a 1.2s charge fires an arena-width beam that pierces every enemy on its line, deforms the grid in a shockwave line, and deals +200% damage.
3. **Phase Armor** — modifies NaniteShieldSystem: on shield break, the ship becomes intangible for 2s (passing through enemies and damaging them); a defense-transform Epic.

Each Epic is ACTIVE ONLY when the player has fused the recipe. The active check reads `progressionState.ownedCards['tesla-circuit']` (etc.) — if any > 0, the effect is on. The fusion Epic is stored as a new entry in `ITEM_REGISTRY` under the track of the fusion source item.

## Boundaries & Constraints

**Always:**
- The three Epics are gated by presence in `ownedCards` (owned as a fusion Epic). They are registered in `ITEM_REGISTRY` with their own ids (`tesla-circuit`, `railgun`, `phase-armor`) and do NOT replace the source items — the source item remains owned (the fusion replaces it, but the Epic entry coexists).
- All pooled entities (tesla arcs, railgun beam, phase-intangible entities) use the existing `Pool` pattern with pre-warmed pools. Zero per-frame allocation in the hot loop.
- Tesla Circuit chaining respects NFR11: the chain is bounded to 2 jumps; the arc entities are pooled.
- Railgun beam is a single instantaneous effect (not a persistent object) — the damage, grid deformation, and visual are all computed and rendered in one frame.
- Phase Armor intangibility is a player state flag (`phaseActive: true/false`) with a timer; enemies colliding with an intangible player instead deal damage to themselves (or pass through harmlessly).
- The fusion Epic effects apply to ALL enemies in `enemyPools`, never `deathPools`.
- All damage from Epic effects routes through `collisionSystem.applyPlayerDamage`, so the armored archetype and scoring/XP seams behave consistently.

**Block If:**
- The exact visual design of the lightning arc, railgun beam, and phase-shift visual — these are aesthetic decisions deferred to post-launch tuning. The minimum visible feedback is a colored fillCircle/line on an existing graphics layer.

**Never:**
- Do NOT modify the item registry to add epic entries — that would be epic content defined in 12.3/12.4. Story 12.2 only adds registry entries for the three proof Epics.
- Do NOT change the fusion resolution logic (12.1) to add new Epic entries. The fusion resolution stays as-is; 12.2 reads the fusion state at runtime.
- Do NOT introduce new fusion recipes. The three proof Epics are the only entries 12.2 adds.
- Do NOT modify systems outside of those explicitly listed here. The effects must piggyback on existing systems (OrbitBladeSystem, PiercingLanceSystem, NaniteShieldSystem) rather than creating entirely new orchestrator systems.

## I/O & Edge-Case Matrix

### Tesla Circuit

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, blades present, enemy in ring | Tesla circuit owned + blade ring contains a non-telegraphing enemy | Continuous arc damage to enemies inside ring (applied once per FIXED_STEP_MS, not per-frame) | No error expected |
| Fusion active, no enemies in ring | Tesla circuit owned + blade ring has no enemies | No arcs; system idles | No error expected |
| Fusion active, kill from arc causes 2-jump chain | An arc damage tick kills an enemy | A 2-jump lightning chain spawns from the kill position (chain length = 2, each hop damages first nearby enemy) | Chain never targets the already-dead enemy |
| Fusion active, multiple enemies in ring | 3+ enemies inside blade ring | Each enemy takes arc damage every fixed step (independent hits, same cooldown) | No error expected |
| Fusion just un-fused (remnant) | Lv5 Orbit Blade consumed → Tesla Circuit present, Lv3 remnant Afterburner | Tesla effect remains active (reads ownedCards['tesla-circuit'], not orbit-blade) | No error expected |
| Arc damage to armored | Armored enemy inside ring | Full damage from arc (melee/AoE classification) — same damage model as blade contact | No error expected |

### Railgun

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion active, lance fires | Railgun owned + lance period expires + enemy exists | Charge for 1.2s → fires one arena-width beam. The beam pierces ALL enemies on its line (not just the nearest), deals +200% damage, deforms the grid along the beam path | Beam is instantaneous — no persistent entity |
| Fusion active, no enemy in line | Railgun owned + lance fires toward empty space | Charge completes but beam hits nothing — no damage, no grid deformation, no score | No error expected |
| Fusion active, multiple enemies in line | 3 enemies aligned on beam path | All 3 take beam damage (pierce-through); all 3 score/XP | No error expected |
| Fusion active, beam through armored | Armored enemy on beam path | Full damage from beam (AoE classification) — armored resists projectiles, not AoE | No error expected |
| Charge mid-enemy-death (no enemy) | Player levels up / remnant fires → no enemies | Charge completes; beam fires with no target → no-op | No error expected |
| Multiple charges stacking | 2+ periods elapse while charging | Charge starts fresh; only one beam fires per period expiry (no backlog) | No error expected |

### Phase Armor

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Fusion active, shield breaks | Nanite Shield (owned by Phase Armor) final charge consumed | Ship becomes intangible for 2s; enemies passing through take damage from ship instead; collision with enemies is suppressed for the player |
| Fusion active, intangible, enemies collide | Enemy in intangible zone | Enemy takes beam-like damage; player takes no damage; player survives through enemy swarm |
| Fusion active, intangible timer expires | 2s elapsed | Phase ends; normal collision resumes; shield charges still recharging |
| Fusion active, shield recharge mid-phase | Shield recharges during intangibility | New charge does NOT extend intangibility; intangibility runs to completion on the next shield break |
| Fusion active, death during intangibility | Player would die while intangible | Death is absorbed by the intangibility window (effectively a second shield); intangibility ends; no life lost |
| Intangible + collision with telegraphing | Telegraphing enemy overlaps ship | Telegraphing enemies are immune to intangible damage — skip |

## Code Map

### New registry entries (itemRegistry.js)

- `src/config/itemRegistry.js` — Add three new frozen entries AFTER the existing 12 items:
  - `tesla-circuit`: `{ id: 'tesla-circuit', name: 'Tesla Circuit', title: 'Tesla Circuit', track: 'offense', rarity: 1, maxLevel: 1, levels: [{ level: 1, desc: 'Blades chain lightning in their ring', stats: {} }, ...], fusion: null }` — Lv1 only, owned once per fusion.
  - `railgun`: `{ id: 'railgun', name: 'Railgun', title: 'Railgun', track: 'offense', rarity: 1, maxLevel: 1, levels: [{ level: 1, desc: 'Charge → arena-width piercing beam', stats: {} }, ...], fusion: null }`
  - `phase-armor`: `{ id: 'phase-armor', name: 'Phase Armor', title: 'Phase Armor', track: 'defense', rarity: 1, maxLevel: 1, levels: [{ level: 1, desc: 'Shield break → 2s intangibility', stats: {} }, ...], fusion: null }`

### Tesla Circuit — OrbitBladeSystem extension

- `src/systems/OrbitBladeSystem.js` — Add the tesla arc effect:
  - Constructor: Accept an optional `fusionState` parameter (the progressionState to read ownedCards for tesla-circuit). Add a tesla arc pool (`Pool(createTeslaArc)`). Add `_teslaArcDamage` read from the Tesla Circuit registry entry.
  - `fixedUpdate(dt)`: After the blade sweep (step 4), if `hasTeslaCircuit(fusionState)` is true, scan blades for overlapping enemies. For each enemy in the ring, apply arc damage via `collisionSystem.applyPlayerDamage(e, _owner, _teslaArcDamage)`. On kill, spawn a 2-jump chain from the kill position.
  - `_teslaArcs = []` — hoisted scratch for active arc entities (materialized from pool each tick).
  - Pool factory `createTeslaArc()` → `{ x, y, lifeMs, maxLifeMs, hitSet: new Set() }`.
  - Arc lifetime: ~0.2s (visible flicker), applied once per tick to nearby enemies along the arc path.

- `src/entities/TeslaArc.js` — New pooled entity factory: `{ x, y, radius, lifeMs, maxLifeMs, hitSet }`. The radius is a small circular area centered on the arc endpoint.

### Railgun — PiercingLanceSystem extension

- `src/systems/PiercingLanceSystem.js` — Add the railgun charge-and-fire effect:
  - Constructor: Accept an optional `fusionState` parameter. Add `_railgunPhase` (idle / charging / ready / firing) and `_railgunAccumMs`. Add `_railgunDamageMult` = 3.0 (i.e., +200% on top of base lance damage).
  - `fixedUpdate(dt)`: When lance fires and railgun is owned, replace the normal bolt fire with a charge + beam: if `_railgunPhase === 'idle'` and there's an enemy, set phase to 'charging' and start accumulating. After 1200ms, fire beam, reset to idle. During the charge, the ship cannot fire regular lance bolts (the railgun consumes the period).
  - `_fireRailgunBeam(x, y, vx, vy)`: Compute beam geometry — a line from the fire origin in the aim direction. Find ALL enemies whose center lies within the beam path (swept rectangle / line-vs-circle test). Apply damage to each via `applyPlayerDamage`. Trigger grid deformation via a late-bound `gridFieldSystem.triggerRailgunShockwave(originX, originY, endX, endY)`.
  - The beam visual is drawn as a line on the `lanceBoltGraphics` layer (the existing lance bolt graphics object) — a thick white line from origin to the farthest enemy hit (or arena edge).

- `src/scripts/gridField.js` (or `GridFieldSystem.js`) — Add `triggerRailgunShockwave(x1, y1, x2, y2)`: push a ripple along the beam line. This could be implemented as a series of ripple points along the line.

### Phase Armor — NaniteShieldSystem extension

- `src/systems/NaniteShieldSystem.js` — Modify `tryAbsorb()` to integrate Phase Armor:
  - Constructor: Accept an optional `fusionState` parameter. Add `phaseActive` boolean and `_phaseTimerMs`.
  - `fixedUpdate(dt)`: If `_phaseTimerMs > 0`, decrement it; if `phaseActive` and timer expires, set `phaseActive = false`. When `_phaseTimerMs > 0`, set `playerState.phaseIntangible = true` (or a new field on playerState).
  - `tryAbsorb()`: When the final charge is absorbed AND phase armor is owned, set `phaseActive = true` and `_phaseTimerMs = PHASE_INTEGRALITY_DURATION_MS` (2000ms). Do NOT call `_pulse()` — the knockback pulse is replaced by the phase-shift visual.
  - The `playerState` needs a new field `phaseIntangible: boolean` that the collision system checks.

- `src/state/PlayerState.js` — Add `phaseIntangible: false` to the initial state. This is the seam `PlayerDeathSystem` and `CollisionSystem` will read.

- `src/systems/CollisionSystem.js` — When checking player-enemy collision: if `playerState.phaseIntangible`, skip the lethal collision. The enemy instead takes damage from the phase effect.
  - Alternatively: `NaniteShieldSystem` or a new `PhaseArmorSystem` handles the "damage on intangible passage." The simplest pattern: in `fixedUpdate`, if `phaseActive`, sweep all enemies for overlap with the ship, and deal damage per-enemy per-tick (like Tesla Circuit's arc damage).

### PlayerDeathSystem — Phase Armor gate

- `src/systems/PlayerDeathSystem.js` — When `playerState.phaseIntangible` is true and a lethal collision occurs: skip the death body. Intangibility absorbs the hit (no life lost, no deathSeq bumped). The playerState.phaseIntangible is NOT consumed — the next shield break starts a new phase window.
  - If `playerState.pendingDeath` is set while `phaseIntangible` is true: clear `pendingDeath`, do NOT reduce life, do NOT bump deathSeq.

### PlayerDeathSystem — Phase Armor integration with death path

- `src/systems/PlayerDeathSystem.js` — At the very top of `_applyDeath()`: if `playerState.phaseIntangible`, return early (phase absorbs the hit — no death, no life lost). This is the single seam change.

### PlayerDeathSystem — Phase Armor integration with death path

- `src/systems/PlayerDeathSystem.js` — At the very top of `_applyDeath()`: if `playerState.phaseIntangible`, return early (phase absorbs the hit — no death, no life lost). This is the single seam change.

### Constants (constants.js)

- `src/config/constants.js` — Add constants for the three Epics:
  - `PHASE_INTEGRITY_DURATION_MS = 2000` (2s intangibility)
  - `TESLA_ARC_DAMAGE = 2` (arc damage per fixed step to enemies in ring)
  - `TESLA_ARC_LIFETIME_MS = 200` (arc visual flicker)
  - `TESLA_CHAIN_JUMP_COUNT = 2` (2-jump chain on arc kill)
  - `TESLA_CHAIN_DAMAGE = 1` (chain lightning damage)
  - `TESLA_CHAIN_LIFETIME_MS = 150` (chain visual flicker)
  - `RAILGUN_CHARGE_MS = 1200` (1.2s charge time)
  - `RAILGUN_DAMAGE_MULT = 3.0` (200% above base lance damage)
  - `RAILGUN_BEAM_WIDTH = 20` (beam sweep width for hit detection)
  - `COLOR_TESLA_ARC = 0x33ccff` (bright blue-white arc)
  - `COLOR_TESLA_CHAIN = 0x88eeff` (cyan-blue chain)
  - `COLOR_RAILGUN_BEAM = 0xffffff` (white beam)
  - `LANCE_BOLT_RADIUS_RAILGUN = 6` (larger visual for railgun bolt during charge)

### buildArenaWorld.js — late binding

- `src/scenes/buildArenaWorld.js` — Late-bind `progressionState` into the three systems:
  - `OrbitBladeSystem` constructor takes a 4th param `playerStats` — add a 4th (or 5th) param for fusion state.
  - `PiercingLanceSystem` constructor takes a 4th param — add fusion state.
  - `NaniteShieldSystem` constructor takes a 3rd param — add a 4th param for fusion state.
  - `PlayerDeathSystem` needs access to `playerState` for phaseIntangible field — already has it via the constructor.

## Tasks & Acceptance

### Task 1: Registry entries and constants

- `src/config/itemRegistry.js` — Add exactly 3 frozen entries:
  ```js
  // Tesla Circuit (Story 12.2 proof) — fusion of Orbit Blade Lv5 + Overcharge Lv3
  Object.freeze({
    id: 'tesla-circuit', name: 'Tesla Circuit', title: 'Tesla Circuit',
    track: 'offense', rarity: 1, maxLevel: 1,
    levels: Object.freeze([
      Object.freeze({ level: 1, desc: 'Blades chain lightning between each other; kills spawn 2-jump chain', stats: Object.freeze({}) }),
    ]),
    guaranteeFromLevel: null, fusion: null
  })
  ```
  Same shape for `railgun` (offense) and `phase-armor` (defense).

- `src/config/constants.js` — Add all `PHASE_*`, `TESLA_*`, `RAILGUN_*`, and `COLOR_TESLA_*`, `COLOR_RAILGUN_*` constants listed above.

**Acceptance:** 
- `getItem('tesla-circuit')`, `getItem('railgun')`, and `getItem('phase-armor')` return valid entries.
- All new constants are exported and usable.

### Task 2: Tesla Circuit — orbit blade arc damage

- `src/systems/OrbitBladeSystem.js` — Extend `fixedUpdate` to perform arc damage:
  **After step 4** (the blade sweep): if any Fusion Epic in `ownedCards` (tesla-circuit > 0), for each combat enemy within range of ANY blade (distance from blade to enemy center <= blade radius + TESLA_ARC_DAMAGE_RADIUS), apply `TESLA_ARC_DAMAGE` to that enemy (once per enemy per fixed step, using the hitSet pattern). On kill from arc damage, spawn a 2-jump chain from the enemy position (each hop: pick nearest enemy, apply `TESLA_CHAIN_DAMAGE`, repeat).

  Also: add a `_teslaArcs` array (hoisted scratch), a `_teslaArcPool` pool, and the `createTeslaArc` factory. The pool is pre-warmed to `TESLA_ARC_POOL_PREWARM` (e.g. 50).

- `src/entities/TeslaArc.js` — New entity: `{ x, y, radius, lifeMs, maxLifeMs, hitSet: new Set() }`.

- `src/scenes/buildArenaWorld.js` — Late-bind `progressionState` into OrbitBladeSystem (`orbitBladeSystem.fusionState = progressionState`).

- `src/scenes/ArenaScene.js` (rendering) — Draw tesla arcs on the `orbitBladeGraphics` layer: after the blade dots, draw arcs as `lineTo` connections between blade-enemy pairs. (Or simply draw arc entities as colored circles on the particleGraphics layer — simpler and consistent with how particles are drawn.)

**Acceptance criteria:**
- Tesla arcs deal damage to enemies within the blade ring every fixed step (once per enemy).
- Enemies take arc damage via `applyPlayerDamage`, producing correct score/XP feedback.
- Arc kill spawns a 2-jump chain: the chain hops to the nearest 2 enemies, dealing chain damage to each.
- Chain damage also routes through `applyPlayerDamage`.
- When no Tesla Circuit is owned, arcs behave exactly as before (zero change).
- Zero per-tick allocation on the steady path.
- Arc damage to armored enemies deals full damage.

### Task 3: Railgun — charge and beam

- `src/systems/PiercingLanceSystem.js` — Modify `fixedUpdate` step 5:
  When `hasRailgun(fusionState)` is true, intercept the normal lance fire:
  If `_railgunPhase === 'idle'` and there's a target enemy, start charging: set `_railgunPhase = 'charging'`, `_railgunAccumMs = 0`. 
  While charging, do NOT fire regular bolts. After 1200ms: set `_railgunPhase = 'firing'`, fire a beam, reset to 'idle'.
  The beam calculation: from the ship (or the clamped origin) toward the nearest enemy, extend the line to the arena edge. Find all enemies whose center lies within `RAILGUN_BEAM_WIDTH` of this line. Apply `lanceDamage * RAILGUN_DAMAGE_MULT` to each, using the existing `applyPlayerDamage` seam.

  After firing: set `_railgunPhase = 'idle'`, reset `_fireAccumMs` appropriately. The 1.2s charge consumes the normal lance period (no bolts during charge).

- `src/systems/GridFieldSystem.js` — Add `triggerRailgunShockwave(x1, y1, x2, y2)`: this pushes a grid ripple along a line segment. For simplicity: push one ripple at each endpoint and midpoints, creating a chain of ripples along the beam path. Each ripple uses existing `pushRipple()` infrastructure.

- `src/scenes/ArenaScene.js` (rendering) — During the charge phase: draw a glowing pulse on the `lanceBoltGraphics` layer centered on the ship. After firing: draw a thick white line (`lbg.lineStyle`) from the origin to the farthest point hit (or arena edge). This is transient — drawn on the same frame the beam fires, then the line is cleared when the next frame clears `lanceBoltGraphics`.

**Alternative rendering approach (simpler):** During charge, draw a pulsing circle on `lanceBoltGraphics` around the ship. After firing, spawn a particle effect that visually traces the beam line.

### Task 4: Phase Armor — shield break → intangibility

- `src/state/PlayerState.js` — Add `phaseIntangible: false` to the initial state returned by `createPlayerState()`.

- `src/systems/NaniteShieldSystem.js` — Add fusion state parameter:
  - New fields: `phaseActive = false`, `_phaseTimerMs = 0`.
  - `fixedUpdate(dt)`: If `_phaseTimerMs > 0`, decrement it. If `_phaseTimerMs <= 0` and `phaseActive`, set `phaseActive = false`.
  - `tryAbsorb()`: On final charge (charges → 0): if Phase Armor is owned (`phaseArmorOwned(fusionState)`), set `phaseActive = true`, `_phaseTimerMs = PHASE_INTEGRITY_DURATION_MS`, and `playerState.phaseIntangible = true`. Do NOT call `_pulse()` — the knockback is replaced by the phase shift.
  - The `playerState.phaseIntangible` field is set to `true` when phase active, `false` when timer expires.

- `src/systems/PlayerDeathSystem.js` — At the TOP of `_applyDeath()`:
  ```js
  if (playerState.phaseIntangible) {
    // Phase armor absorbs the hit — no death, no life lost.
    return;
  }
  ```

- `src/systems/CollisionSystem.js` — Add a late-bound `playerDeathSystem` reference for Phase Armor's intangible damage:
  When checking player-enemy contact: if `playerState.phaseIntangible` is true, instead of calling `playerDeathSystem._applyDeath()`, route through the intangible handler: deal damage to the enemy (using a constant intangible contact damage, e.g. `TESLA_ARC_DAMAGE` or a new `PHASE_CONTACT_DAMAGE` constant).
  
  Wait — this needs more thought. Phase Armor is intangibility: the ship passes through enemies. During intangibility, the player should take NO damage from enemies, and enemies should take damage on contact. This should NOT go through `CollisionSystem`'s normal player-death path.
  
  The simplest approach: in `PlayerDeathSystem._applyDeath()`, check `phaseIntangible` at the very top and return early (absorbs the hit). Additionally, in `NaniteShieldSystem.fixedUpdate()` or a dedicated `PhaseArmorSystem`, sweep for overlapping enemies when `phaseActive` is true and deal `PHASE_CONTACT_DAMAGE` per-enemy-per-tick via `applyPlayerDamage`.

**Revised Task 4 approach** — simpler and more contained:

  - `NaniteShieldSystem` becomes a `PhaseArmorSystem` on top of itself (or the code moves into the system as-is):
    - In `fixedUpdate`, when `phaseActive`, sweep all `enemyPools` and deal contact damage to overlapping enemies via `cs.applyPlayerDamage` (routed through a late-bound `collisionSystem`).
  
  - The `tryAbsorb()` path when Phase Armor activates:
    1. `phaseActive = true`
    2. `_phaseTimerMs = PHASE_INTEGRITY_DURATION_MS`
    3. `playerState.phaseIntangible = true`
    4. NO knockback pulse (`_pulse()` is skipped)

- `src/scenes/buildArenaWorld.js` — Late-bind `progressionState` into NaniteShieldSystem.

- `src/scenes/ArenaScene.js` — Draw a visual cue: when `playerState.phaseIntangible`, render a faint purple/semi-transparent halo around the ship (on `shipSprite` or a separate graphics layer).

**Acceptance criteria:**
- When Phase Armor is fused and the final shield charge breaks: intangibility activates for 2s.
- During intangibility, player takes no damage from any enemy contact.
- During intangibility, enemies overlapped by the ship take `PHASE_CONTACT_DAMAGE` per fixed step (via `applyPlayerDamage`).
- Intangibility ends after 2s (or when all charges are consumed by a non-death contact — but the shield was already empty, so this case is the phase active).
- When Phase Armor is not owned, shield behavior is byte-identical to pre-12.2 (including the Lv5 knockback pulse).
- Death during intangibility is absorbed — no life lost, no deathSeq bumped.

## Spec Change Log

| Date | Change |
|------|--------|
| 2026-07-27 | Initial spec for proof Epics (Tesla Circuit, Railgun, Phase Armor) |

## Verification

**Commands:**
- `npx vitest run --reporter=verbose` — expected: all existing tests pass (no regressions)
- `npx vitest run src/systems/orbitBladeSystem.test.js` — expected: existing OrbitBlade tests pass
- `npx vitest run src/systems/naniteShieldSystem.test.js` — expected: existing NaniteShield tests pass
- `npx vitest run src/systems/piercingLanceSystem.test.js` — expected: existing PiercingLance tests pass

**Manual checks (in-game):**
- Fuse Orbit Blade Lv5 + Overcharge Lv3 → verify Tesla Circuit available (fusion Epic card at slot 0 during level-up), select it → verify blade ring arcs to nearby enemies every ~100ms and kills spawn 2-jump lightning chains.
- Pierce Lance Lv5 + Overcharge Lv3 → verify Railgun available during level-up, select it → verify next lance shot charges for ~1.2s then fires an arena-width beam that hits all aligned enemies with +200% damage and grid deform.
- Nanite Shield Lv5 + Afterburner Lv3 → verify Phase Armor available during level-up, select it → verify final shield break triggers 2s intangibility (ship visually shifts), enemies on contact take damage, player takes no damage.
