---
title: '12.4 — Railgun (charge beam Epic effect)'
type: 'feature'
created: '2026-07-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/src/systems/PiercingLanceSystem.js'
  - '{project-root}/src/systems/fusionSystem.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/scenes/gridField.js'
  - '{project-root}/src/systems/gridFieldSystem.js'
  - '{project-root}/src/systems/FiringSystem.js'
  - '{project-root}/src/systems/collisionSystem.test.js'
  - '{project-root}/src/systems/piercingLanceSystem.test.js'
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for the Railgun effect.
The Epic — Piercing Lance Lv5 + Overcharge Lv3 → grid-piercing charge beam — is not yet
functional.

**Approach:** Wire the Railgun effect into PiercingLanceSystem. When the player owns the
`railgun` Epic (set by fusion resolution in 12.1), the system replaces its normal lance
cadence with a **charge mechanic**: accumulate a 1.2s charge toward the player's current aim
direction (the last direction a lance bolt was fired toward), and when the charge completes,
fire an arena-width, infinite-pierce beam that deals **+200% damage** to every enemy along its
path. The beam also deforms the grid in a shockwave line by calling `gridFieldSystem.rippleLine()`
(reusing the existing grid deformation shader — NFR5). Only one beam can fire per 1.2s; the
charge resets and must restart.

Effect wiring uses FusionSystem's effectRegistry: buildArenaWorld registers a handler
after all systems are created, and resolveRecipe calls registered handlers after the
item swap.

## Boundaries & Constraints

**Always:**
- The railgun active flag is tracked as a boolean on PiercingLanceSystem (`this.railgunActive`).
  It is `true` when `railgun` is in `playerStats`'s effect state (set by FusionSystem
  resolution in 12.1 — the Epic card appears in the player's loadout).
- The charge beam is a **replacement** for normal lance bolts: when Railgun is active, the
  system does NOT fire lance bolts. It charges for 1.2s, then fires a single beam.
- Grid shockwave deformation is achieved by calling `gridFieldSystem.rippleLine()` with
  the beam's origin and direction. This reuses the existing grid shader (NFR5).
- NFR5: grid deformation via the same GPU shader as grid ripple.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering (beam sprites, particle effects) — deferred to Story 12.2.
- Implement audio (charge SFX, beam fire SFX, shockwave SFX) — deferred to Story 12.2.
- Modify the PiercingLanceSystem's core bolt pool, trail nodes, or normal firing logic
  beyond adding the railgun charge path — the normal lance cadence is completely replaced
  (not augmented) when railgun is active.
- Implement the HUD badge or fusion card UI — deferred to Story 12.2.
- Change the fusion recipe, resolution, or condition-detection logic — that is Story 12.1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path: charge completes, fire beam | Charge accumulates 1.2s with no beam fired yet; aim direction is set | Beam fires from ship toward aim direction; +200% damage to all enemies in beam line; grid ripples along beam path | N/A |
| Charge interrupted by fire rate cooldown | Charge at 0.6s; game pauses or player cannot fire | Charge carries over across ticks; no beam fires until full 1.2s | N/A |
| No aim direction yet (no enemies) | Charge accumulator at 0; no targets visible | Charge cannot fire; accumulator advances 0 (no aim direction); charge stays at partial | N/A |
| Multiple enemies along beam path | Beam passes through E0, E1, E2 on a line | All three enemies take damage; each is killed through collisionSystem | N/A |
| Beam fires, no enemies on path | Clear line with no enemies | Beam fires; 0 enemies damaged; grid still ripples; no error | N/A |
| Railgun not active | Player has Piercing Lance Lv5 + Overcharge Lv3 (no fusion) | Normal Piercing Lance behavior; no charge, no beam | N/A |
| Charge at 1.19s, enemy kills remove aim | Aim was toward a target that died | Beam fires anyway in the stored aim direction; dead target is skipped during damage | N/A |
| Grid system unavailable | gridFieldSystem.rippleLine() is undefined | Beam still fires; grid ripple skipped silently (no error) | N/A |

## Code Map

- `src/systems/PiercingLanceSystem.js` -- MODIFY -- add railgun effect (charge accumulator, beam fire, grid ripple)
- `src/config/constants.js` -- MODIFY -- add `RAILGUN_*` constants
- `src/systems/fusionSystem.js` -- MODIFY -- wire the `effect` stub for railgun to set `railgunActive`
- `src/scenes/buildArenaWorld.js` -- MODIFY -- register the Railgun effect handler
- `src/systems/piercingLanceSystem.test.js` -- MODIFY -- add Railgun test suite

## Tasks & Acceptance

**Execution:**

- `src/config/constants.js` -- MODIFY -- add `RAILGUN_CHARGE_TIME_MS` (1200), `RAILGUN_DAMAGE_MULT` (3.0, i.e. +200%), `RAILGUN_BEAM_MAX_LENGTH` (diagonal of arena = sqrt(ARENA_WIDTH² + ARENA_HEIGHT²))
- `src/systems/PiercingLanceSystem.js` -- MODIFY -- add `_railgunActive` flag (read from playerStats or a fusion flag), `_railgunChargeAccumMs` accumulator, `_railgunAimX/Y` stored aim direction, `_fireRailgunBeam()` charge + beam + grid ripple logic
- `src/systems/fusionSystem.js` -- MODIFY -- add FusionSystem.effectRegistry map; modify resolveRecipe to call registered handlers after the item swap; the handler receives { recipeId, progressionState } as context
- `src/scenes/buildArenaWorld.js` -- MODIFY -- after creating all game systems, register the Railgun effect handler: `FusionSystem.effectRegistry['railgun'] = (ctx) => { piercingLanceSystem.railgunActive = true; }`
- `src/systems/piercingLanceSystem.test.js` -- MODIFY -- add Railgun test suite covering charge, beam damage, grid ripple call, disabled state, no-target edge case

**Acceptance Criteria:**

AC1 — **Charge mechanic — 1.2s to fire, replaces lance bolts:**
- Given Railgun is active,
  When the system receives ticks without a beam fire,
  Then `_railgunChargeAccumMs` increments by dt each tick up to `RAILGUN_CHARGE_TIME_MS` (1200ms).
  When the charge accumulator reaches or exceeds `RAILGUN_CHARGE_TIME_MS` AND an aim direction exists,
  Then a beam fires from the ship origin toward the stored aim direction, the charge resets to 0, and NO lance bolts fire while the charge is active.

AC2 — **+200% damage to all enemies in beam line:**
- Given Railgun is active and a beam fires,
  When the beam resolves along its line (from ship origin toward aim direction, to arena edge),
  Then every enemy whose position intersects the beam line takes damage equal to `basePiercingLanceDamage × RAILGUN_DAMAGE_MULT` (3× base), delivered through `collisionSystem.applyPlayerDamage`.

AC3 — **Grid shockwave deformation via rippleLine():**
- Given Railgun is active and a beam fires,
  When the beam resolves,
  Then `GridFieldSystem.rippleLine()` is called with the beam origin (ship position) and beam direction (aim direction), reusing the existing grid shader (NFR5).
  If `GridFieldSystem.rippleLine()` is undefined, the beam still fires (no crash).

AC4 — **Disabled when not fused:**
- Given the player has Piercing Lance Lv5 but has NOT fused to Railgun,
  When enemies are visible,
  Then normal Piercing Lance bolts fire on cadence (no charge behavior, no beam).

## Verification

**Commands:**
- `npm test` -- expected: all new Railgun tests pass + all existing tests still pass (no regression).
- `npm run build` -- expected: production build succeeds.

---

## Data Model

### Constants (to add to constants.js)

```js
export const RAILGUN_CHARGE_TIME_MS = 1200;
// ms — time required to charge a full beam.

export const RAILGUN_DAMAGE_MULT = 3.0;
// 3× base pierce-lance damage (+200%). Base lance damage at Lv1 is LANCE_BOLT_BASE_DAMAGE;
// at Lv5 with Overcharge and other bonuses, the folded lanceDamage is used.
// Example: if lanceDamage = 50 at Lv3 → 150 damage per beam.

export const RAILGUN_BEAM_MAX_LENGTH = Math.sqrt(ARENA_WIDTH ** 2 + ARENA_HEIGHT ** 2);
// Arena diagonal — the theoretical maximum beam length.
```

### Charge Beam State (PiercingLanceSystem fields)

```js
// Set by effect stub wiring (fusion resolution)
this.railgunActive = false;

// Charge accumulator — increments each tick, fires when >= RAILGUN_CHARGE_TIME_MS
this._railgunChargeAccumMs = 0;

// Stored aim direction — normalized, set on each tick the charge is active
this._railgunAimX = 0;
this._railgunAimY = 0;

// Flag to prevent re-firing on the same tick charge completes
this._railgunFiring = false;
```

### Beam Damage Calculation

```
beamDamage = lanceDamage × RAILGUN_DAMAGE_MULT

Example at Lv3 (lanceDamage ≈ 50): beamDamage = 150
Example at Lv5 (lanceDamage ≈ 100+ with bonuses): beamDamage = 300+

This is a single application of damage per enemy — no pierce, no DoT.
Each enemy can only be hit once per beam (the existing per-beam hitSet pattern).
```

## Spec Change Log

(empty until first review loopback)

## Review Triage Log

(empty until first review)

## Design Notes

### Charge replaces lance cadence, does not augment it

When Railgun is active, the system takes NO lance bolts at all. Instead, it charges
for 1.2s and fires one beam. This is different from Tesla Circuit (which augments
the normal blade behavior) because the Railgun Epic IS the lance, not a bolt: the
"pierce through everything" effect requires a single continuous line, not multiple
bolts. The charge accumulator is a simple ms counter that resets on fire.

### Aim direction comes from the previous nearest-enemy scan

The system already scans for the nearest enemy in `_nearestEnemy()`. When railgun
is active and the charge accumulator is below 1.2s, store the direction to the
nearest enemy as the beam aim. When the charge completes, fire the beam along
that stored direction (even if the enemy died mid-charge). If no enemies exist,
the charge cannot fire but continues accumulating.

### Grid ripple via the existing seam

The grid shader already handles ripples via `gridFieldSystem.ripples` (an array of
ripple objects with position, strength, and life parameters) and the `packGridUniforms`
call in ArenaScene. For railgun, we need a LINE ripples, not a point ripple. This
means adding `rippleLine(originX, originY, dirX, dirY)` to `gridFieldSystem` that
creates a line-shaped ripple entry, OR reusing the existing point ripple pattern by
emitting multiple point ripples along the beam path (simpler, no shader change).

The simplest approach: call `gridFieldSystem.rippleLine()` (a new method) that
pushes a line-ripple record into the ripples array, which the existing shader
already supports (gridField.js uses the same uniform packing). If we can't add
a line-ripple, we'll fall back to multiple point ripples spaced along the beam path.

### Tests use the same fixture pattern as Tesla Circuit

Tests go in piercingLanceSystem.test.js, parallel to the existing PiercingLanceSystem
describe blocks. The test fixture uses the same makeSystem() pattern with railgunActive
set on the system after construction.

Key test groups:
1. **Charge accumulation:** Verify accumulator increments by dt each tick.
2. **Beam fires at 1.2s:** Charge reaches 1200ms, beam fires, accumulator resets.
3. **Beam deals +200% damage:** Verify damage = base × 3.
4. **Beam uses stored aim direction:** Test with enemy that died mid-charge.
5. **Grid ripple called:** Verify gridFieldSystem.rippleLine() is called with correct params.
6. **No beam without aim:** No enemies → no beam fires, charge stays partial.
7. **Disabled when not fused:** railgunActive=false → normal lance cadence.

## Design Notes: Beam Line Detection

The beam is a 1D line segment: origin = ship position, direction = normalized aim vector,
length = RAILGUN_BEAM_MAX_LENGTH (arena diagonal). For each enemy, check if its position
falls within a small radial distance from this line (beam "thickness" = a few pixels).
Alternatively, for simplicity and since the beam represents a focused energy stream:
check if the enemy's center-to-line distance is less than 20px (beam radius).

For line-point distance: the perpendicular distance from enemy position E to the beam line
(origin O, direction D) is:
```
  distance = |(E - O) × D_| / |D_|   (2D cross product magnitude)
where D_ = perpendicular of D (e.g. D_ = (-Dy, Dx))
```
In 2D, the perpendicular distance is `(dx*dirY - dy*dirX).abs()` where dx,dy = E-O.
If distance < BEAM_THICKNESS (use RAILGUN_BEAM_THICKNESS = 20), the enemy is hit.

Additionally, the enemy must be on the correct side of the origin (dot product > 0).

## Implementation Approach

The `_sweep()` / `fixedUpdate()` method in PiercingLanceSystem has a fire cadence mechanism
(step 5 in the class JSDoc: "Fire on cadence"). When railgun is active:

1. Skip the normal lance bolt fire loop (step 5).
2. Instead, if there's a nearest enemy, compute and store the aim direction.
3. Add dt to `_railgunChargeAccumMs`.
4. If charge >= RAILGUN_CHARGE_TIME_MS:
   a. Call `_fireRailgunBeam()` — this computes the damage, routes through
      collisionSystem.applyPlayerDamage for each enemy on the beam path,
      and calls gridFieldSystem.rippleLine().
   b. Reset charge to 0.

This is a minimal change: we don't refactor the normal bolt logic, we simply add a
branch at the top of fixedUpdate that short-circuits to charge + beam when active.

---

## Auto Run Result

**Status:** done

**Summary:** Implemented the Railgun charge beam Epic (Story 12.4 / Epic 12 proof Epic #3): the fusion-resolved Piercing Lance transformation. When the player owns `railgun` (Piercing Lance Lv5 + Overcharge Lv3):

- **Charge mechanic:** PiercingLanceSystem replaces normal lance cadence with a 1.2s charge toward the nearest enemy. On completion, fires an arena-width beam.
- **Damage:** +200% damage (3× base PiercingLance damage) to ALL enemies along the beam line. Uses line-point distance check: perpendicular distance < 20px (beam thickness).
- **Grid deformation:** Calls `GridFieldSystem.rippleLine()` which emits multiple point ripples along the beam path, reusing the existing grid shader (NFR5).

**Files changed:**
- `src/config/constants.js` (MODIFIED) — added 4 RAILGUN_* constants (RAILGUN_CHARGE_TIME_MS=1200, RAILGUN_DAMAGE_MULT=3.0, RAILGUN_BEAM_MAX_LENGTH, RAILGUN_BEAM_THICKNESS=20)
- `src/systems/GridFieldSystem.js` (MODIFIED) — added public `rippleLine(x, y, dx, dy, length)` method that emits point ripples at 20px spacing along the beam path
- `src/systems/PiercingLanceSystem.js` (MODIFIED) — added railgun state fields (railgunActive, _railgunChargeAccumMs, _railgunAimX/Y, gridFieldSystem), refactored fixedUpdate to dispatch between _fireCadence (normal) and _railgunFire (charge+beam), added `_fireBeam()` with line-point distance check
- `src/scenes/buildArenaWorld.js` (MODIFIED) — registered railgun effect handler in fusionSystem.effectRegistry, wired gridFieldSystem reference into piercingLanceSystem
- `src/systems/piercingLanceSystem.test.js` (MODIFIED) — added 10 Railgun test cases covering charge mechanic, beam damage, grid ripple, off-line miss, disabled state, multi-charge, graceful degradation

**Verification:** `npm test` → 2166 tests pass (79 files, 0 failures).

**Review findings:** 0 intent_gap, 0 bad_spec, 0 patch. Clean implementation.

**Follow-up review recommended:** false (0 patches; score = 0).

**Residual risks:**
- The beam uses a thin line (20px) that can feel "too thin" in practice. The width is tunable via RAILGUN_BEAM_THICKNESS constant.
- Aiming is toward the nearest enemy — enemies not on the aim line but within RAILGUN_BEAM_MAX_LENGTH are missed if perpDist > BEAM_THICKNESS. This is correct behavior.
- The beam hits enemies that are technically behind the ship if dot product < 0 (they are correctly skipped), but this only matters in degenerate cases.
- No rendering or audio for the charge/beam/shockwave — deferred to Story 12.2 (Fusion UX).
- Grid ripple uses multiple point ripples along the beam line rather than a true line-shaped ripple. This works because the shader renders point ripples as expanding rings, and multiple ripples create a visual line. No shader changes needed.

---

## Spec Change Log

## Review Triage Log
