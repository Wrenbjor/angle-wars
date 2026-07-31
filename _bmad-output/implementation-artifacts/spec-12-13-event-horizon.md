---
title: '12.13 — Event Horizon (permanent gravity field draws enemies in, curves bullets toward them)'
type: 'feature'
created: '2026-07-31'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '77317ed2c01c92a362cb201a6642c261045800f1'
final_revision: ''
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/src/systems/BlackHoleSystem.js'
  - '{project-root}/src/systems/EnemySystem.js'
  - '{project-root}/src/systems/FiringSystem.js'
  - '{project-root}/src/systems/XpOrbSystem.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/config/itemRegistry.js'
  - '{project-root}/src/systems/fusionSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
warnings: []
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for
Event Horizon. The Epic — **Gravity Well Lv5 + Mine Layer Lv3 → Event Horizon**
— is not yet functional. When fused, it creates a **permanent weak gravity field**
that passively draws enemies in toward the ship and curves player bullets toward
nearby enemies. This is the gravity-archetype payoff from the PRD.

**Approach:** Implement the gravity pull in **XpOrbSystem.fixedUpdate** (the
already-established location for Gravity Well Lv5 enemy pull: it pulls enemies
toward active XP orbs — this story changes the pull source from *orbs* to the
*ship* and makes it passive). The bullet curvature is a small per-bullet velocity
nudge toward the nearest enemy, applied in the **FiringSystem bullet integration
step** (`_collectExpired` callback, during the `b.x += b.vx * dtSec` integration).
Both effects are **weak and passive** — the Event Horizon does not make the player
actively aim; it gives gravity-based builds a persistent arena-advantage.

Event Horizon is a **defense** Epic: its permanent gravity modifies a passive
effect (Gravity Well already pulls toward orbs from Level 5) into a stronger,
always-on version that pulls toward the ship.

## Boundaries & Constraints

**Always:**
- The gravity pull and bullet curvature are **always active** when Event Horizon
  is fused (controlled by `eventHorizonActive` flag), independent of Gravity Well
  ownership or active XP orbs.
- **Enemy gravity pull** is applied in `XpOrbSystem.fixedUpdate`: if
  `eventHorizonActive`, pull *all* non-telegraphing non-telegraphing enemies
  toward the ship using the same inverse-distance falloff formula as Gravity Well
  (`_gravityPullEnemies` in XpOrbSystem).
- The pull strength is `EVENT_HORIZON_PULL_STRENGTH` (weaker than active Gravity
  Well pull — this is the permanent ambient field, not a focused pull).
- Pull falloff: `pull = strength * (1 - d / RADIUS) * dtSec` for d < radius;
  zero pull at d ≥ radius.
- Pull radius: `EVENT_HORIZON_PULL_RADIUS`.
- Telegraphing enemies (`telegraphMs > 0`) are immune to the pull.
- The ship is **not** pulled by its own gravity field.
- **Bullet curvature** is applied in `FiringSystem.fixedUpdate` during each
  bullet's integration step: if `eventHorizonActive`, add a small velocity nudge
  toward the nearest non-telegraphing combat enemy, scaled by `EVENT_HORIZON_BULLET_CURVE_STRENGTH`.
- Bullet curvature preserves the bullet's total speed: the velocity is only rotated
  slightly toward the target direction, not accelerated.
- The nearest-enemy scan for bullet curvature reuses the existing hoisted
  `_enemies` scratch (same filtering pattern as BulletSystem's Lv5 Ricochet seek
  — skips telegraphing enemies).
- Bullet curvature is **very weak** — the velocity rotation angle is at most
  `EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD` radians (≈ small degrees) per tick.
- Zero per-frame allocation in both code paths: scalar constants, reused scratch.
- The `eventHorizonActive` flag is set by the fusion effect handler in
  `buildArenaWorld.js` (reads either from `mineLayerSystem._eventHorizon` or
  `fusionSystem._eventHorizon` — whichever provides the field on the world).
- No rendering for the gravity field — the "event horizon" visual is ambient, not
  a drawn shape (deferred, if desired, to Story 12.2).
- No audio for Event Horizon — no ambient gravity sound (deferred, if desired,
  to Story 12.2).
- Bullet curvature only fires when enemies exist: if `enemies.length === 0`, skip
  the nearest-enemy scan entirely.
- Bullet curvature does not apply to missiles/drones (only player-owned bullets
  in the bullet pool). The system only reads `this.bulletPool.forEachActive`, so
  non-player bullets aren't affected either way.
- The gravity pull does not interact with XP orbs — only enemies are pulled.
- Existing Gravity Well pull (toward orbs) is NOT modified, disabled, or
  superseded: both effects coexist (player gets double gravity).

**Block If:** None. All design decisions are specified here.

**Never:**
- Modify BlackHoleSystem, DashSystem, or any other system — Event Horizon
  is two targeted additions: pull-in-XpOrbSystem + curve-in-FiringSystem.
- Pull the ship toward itself — no self-gravity.
- Let bullet curvature accelerate bullets above `BULLET_SPEED` — velocity
  magnitude is preserved (rotation-only).
- Create new entity pools or systems — both effects are data-driven state
  modifications using existing infrastructure.
- Override enemy movement systems — gravity is a position nudge, not a velocity
  change, so it composes with enemy homing/drifting.
- Implement visual or audio cues for the gravity field — that is a Story 12.2
  concern.
- Let telegraphing enemies be pulled or avoided by bullet curvature.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Event Horizon fused: enemy at 100px | eventHorizonActive, enemy at d=100 < radius | Enemy nudged toward ship at pull = strength * (1 - d/R) * dtSec | No error expected |
| Enemy at 400px (outside radius) | eventHorizonActive, enemy at d=400 > radius | No pull — enemy position unchanged | No error expected |
| Telegraphing enemy in pull range | eventHorizonActive, telegraphMs > 0 | Enemy is inert — position unchanged | No error expected |
| Multiple enemies in pull range | eventHorizonActive, enemies at various distances | Each enemy pulled independently at its own pull strength | No error expected |
| No enemies on screen | eventHorizonActive | Pull code runs but finds nothing — no effect | No error expected |
| Player aiming: bullet shoots | eventHorizonActive, nearest enemy at 150px | Bullet velocity slightly rotated toward enemy (within angle cap) | No error expected |
| Player aiming: no enemies | eventHorizonActive, enemies.length === 0 | Bullet fires straight — no curvature | No error expected |
| Bullet at maximum angle | eventHorizonActive, enemy at sharp angle to bullet | Bullet velocity rotated by at most `EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD` | No error expected |
| Bullet speed preservation | eventHorizonActive, bullet at speed 400 | Bullet speed remains 400 after curvature (rotation only) | No error expected |
| Second dash during decoy life | Player dashes while decoy is alive | Existing decoy replaced with new decoy at new dash position (timer reset) | No error expected |
| Null ship reference | eventHorizonActive, ship === null | Pull code skips safely — no crash | Guard: if (!ship) return |
| Null enemyPools reference | eventHorizonActive, enemyPools === null | Curvature code skips — no crash | Guard: if (!enemyPools) return |
| NaN/Infinity dt | eventHorizonActive, dt is NaN | No NaN propagates into enemy/bullet coordinates | Checked in existing XpOrbSystem pattern |

## Code Map

- `src/config/constants.js` -- MODIFY -- add `EVENT_HORIZON_PULL_STRENGTH`, `EVENT_HORIZON_PULL_RADIUS`, `EVENT_HORIZON_BULLET_CURVE_STRENGTH`, `EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD`
- `src/systems/XpOrbSystem.js` -- MODIFY -- add `eventHorizonActive` field; in `fixedUpdate`, pull all non-telegraphing enemies toward the ship when `eventHorizonActive` (reuses `_gravityPullEnemies` pattern / adds new _eventHorizonPull inline)
- `src/systems/FiringSystem.js` -- MODIFY -- add `_eventHorizonActive` field; during bullet integration in `_collectExpired`, apply velocity nudge toward nearest enemy when active (reuses existing `_enemies` scratch + `_nearestEnemy`)
- `src/scenes/buildArenaWorld.js` -- MODIFY -- wire `fusionSystem.eventHorizonEffect` to set `eventHorizonActive` on both XpOrbSystem and FiringSystem
- `src/systems/fusionSystem.js` -- MODIFY -- update the Event Horizon stub comment

## Tasks & Acceptance

### Task 1: Add Event Horizon constants

Add to `src/config/constants.js` (after the Slipstream constants, ~line 855):

```js
// --- Event Horizon (Story 12.13 / Epic 12 — defense Epic) ------------------------
// Strength (px/s) of the permanent weak gravity field that passively pulls
// enemies toward the ship. Weaker than Gravity Well Lv5 active pull because
// this is ambient — it should draw enemies in gently, not overwhelm the arena.
// Gravity Well Lv5 active pull (with orbs active) can be as high as 40 px/s;
// this sits at 12 px/s so coexistence is additive not explosive.
export const EVENT_HORIZON_PULL_STRENGTH = 12;
// Radius (px) of the passive gravity field. Enemies within this radius are
// pulled toward the ship each tick. Sized large enough to consistently influence
|enemy positioning but small enough that the strength remains feel at max range.
export const EVENT_HORIZON_PULL_RADIUS = 200;
// Bullet curvature: the maximum velocity rotation angle (radians) per tick toward
// the nearest combat enemy. At 0.03 rad (~1.7°) per fixed step, a bullet's path
|curves gradually over ~30ms — enough to nudge a slightly-missed shot toward a
|nearby enemy without making the weapon homing. This is a nudge, not a snap.
export const EVENT_HORIZON_BULLET_CURVE_STRENGTH = 1;
// The actual rotation magnitude is `min(angle_to_nearest, EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD)`
// so the nudge is always bounded.
export const EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD = 0.03;
```

### Task 2: Modify XpOrbSystem — passive gravity pull toward ship

Add fields in the XpOrbSystem constructor (after the `_currentOrbPullStrength` field,
which sets up the per-orb pull state):

```js
    // Story 12.13 — Event Horizon: true when fused. The gravity field always
    // pulls enemies toward the ship, independent of active XP orbs.
    this.eventHorizonActive = false;
```

In `XpOrbSystem.fixedUpdate`, add the event horizon pull **after** the existing
Gravity Well enemy pull (which pulls toward active orbs) but **before** the
final boundary clamping. The new pull is additive to the orb pull.

Add the pull logic after the Gravity Well pull section (after the loop that iterates
over `activeOrbs` and calls `_gravityPullEnemies` for each orb):

```js
    // Story 12.13 — Event Horizon: passive gravity field pulls non-telegraphing
    // enemies toward the ship regardless of active XP orbs. This is additive to
    // the existing Gravity Well pull-towards-orbs, so a Lv5 Gravity Well + Event
    // Horizon creates a double-attraction field.
    if (this.eventHorizonActive && enemyPools && ship) {
      const pullStrength = EVENT_HORIZON_PULL_STRENGTH;
      const radius = EVENT_HORIZON_PULL_RADIUS;
      const dtSec = dt / 1000;
      if (Number.isFinite(dtSec) && dtSec > 0) {
        const px = ship.x;
        const py = ship.y;
        for (let p = 0; p < enemyPools.length; p++) {
          const pool = enemyPools[p];
          for (const e of pool._active) {
            // Telegraphing enemies are inert to the gravity field.
            if (e.telegraphMs > 0) continue;
            const dx = px - e.x;
            const dy = py - e.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < radius) {
              const pull = pullStrength * (1 - d / radius) * dtSec;
              const maxStep = GRAVITY_WELL_PULL_STRENGTH * dtSec;
              // Clamp individual pull step to prevent stacking issues.
              const clampedPull = Math.min(pull, maxStep);
              e.x += (dx / d) * clampedPull;
              e.y += (dy / d) * clampedPull;
              // Boundary clamp (mirror XpOrbSystem orb-pull guard).
              e.x = Math.max(ARENA_BORDER_INSET + 0.1, Math.min(ARENA_WIDTH - ARENA_BORDER_INSET - 0.1, e.x));
              e.y = Math.max(ARENA_BORDER_INSET + 0.1, Math.min(ARENA_HEIGHT - ARENA_BORDER_INSET - 0.1, e.y));
            }
          }
        }
      }
    }
```

**Important note:** The iteration over `pool._active` assumes this is safe.
Looking at the existing code pattern, XpOrbSystem already iterates over existing
enemy pools via `_collectEnemy`. The pull-enemies code in Gravity Well uses the
pattern of walking the pool's `_active` Set directly. We'll review this in the
actual implementation.

Alternative: reuse the hoisted collector, materialize into `_enemies`, then iterate:

```js
    if (this.eventHorizonActive && enemyPools && ship) {
      // Collect enemies into the hoisted _enemies scratch.
      this._enemies.length = 0;
      for (let p = 0; p < enemyPools.length; p++) {
        this._currentPool = enemyPools[p];
        enemyPools[p].forEachActive(this._collectEnemy);
      }
      const pullStrength = EVENT_HORIZON_PULL_STRENGTH;
      const radius = EVENT_HORIZON_PULL_RADIUS;
      const dtSec = dt / 1000;
      if (Number.isFinite(dtSec) && dtSec > 0) {
        const px = ship.x;
        const py = ship.y;
        for (let i = 0; i < this._enemies.length; i++) {
          const e = this._enemies[i];
          if (e.telegraphMs > 0) continue;
          const dx = px - e.x;
          const dy = py - e.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < radius) {
            const pull = pullStrength * (1 - d / radius) * dtSec;
            const clampedPull = Math.min(pull, GRAVITY_WELL_PULL_STRENGTH * dtSec);
            e.x += (dx / d) * clampedPull;
            e.y += (dy / d) * clampedPull;
            e.x = Math.max(ARENA_BORDER_INSET + 0.1, Math.min(ARENA_WIDTH - ARENA_BORDER_INSET - 0.1, e.x));
            e.y = Math.max(ARENA_BORDER_INSET + 0.1, Math.min(ARENA_HEIGHT - ARENA_BORDER_INSET - 0.1, e.y));
          }
        }
      }
    }
```

This is the safer pattern — it matches the existing Gravity Well pull
implementation in XpOrbSystem.

**Final Task 2 implementation:**

Add `this.eventHorizonActive = false;` to XpOrbSystem constructor (after line
where `_enemyPools` is stored or `_collectEnemy` is defined — pick a consistent
spot, near other Event Horizon flags).

In `XpOrbSystem.fixedUpdate`, after the end of the existing `for (const orb of
activeOrbs)` loop (which handles Gravity Well active orb pull), insert the
Event Horizon block as shown in the alternative pattern above.

### Task 3: Modify FiringSystem — bullet curvature

Add fields in the FiringSystem constructor (after the `_sunburstVolleyCounter`
field, ~line 282):

```js
    // Story 12.13 — Event Horizon: true when fused. Bullets curve slightly
    // toward the nearest combat enemy during integration.
    this._eventHorizonActive = false;
```

In `FiringSystem.fixedUpdate`, add the nearest-enemy scan **before** the bullet
integration step (before `pool.forEachActive(this._collectExpired)`), using the
same pattern as the existing `_seekActive` block at lines 593-601:

```js
    // Story 12.13 — Event Horizon: bullet curvature. Collect the nearest
    // non-telegraphing combat enemy so each bullet can query it during
    // integration. Only materialize when Event Horizon is active.
    if (this._eventHorizonActive && this.enemyPools) {
      this._enemies.length = 0;
      for (let p = 0; p < this.enemyPools.length; p++) {
        this.enemyPools[p].forEachActive(this._collectEnemy);
      }
    }
```

In `_collectExpired`, **before** the `b.x += b.vx * dtSec` integration line,
add the Event Horizon curvature. Since `_collectExpired` is an hoisted
instance-field arrow, it closes over `this`. Check `this._eventHorizonActive`
and, if true, apply a small velocity rotation toward the nearest enemy:

```js
      // Story 12.13 — Event Horizon: curvature. Small velocity rotation toward
      // the nearest combat enemy, preserving bullet speed.
      if (this._eventHorizonActive && this._nearestEnemy) {
        const target = this._nearestEnemy(b.x, b.y);
        if (target) {
          const dx = target.x - b.x;
          const dy = target.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > 0) {
            // Rotation angle toward target, capped at EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD.
            // The target angle is Math.atan2(dy, d) relative to the bullet's forward axis.
            // But simpler: just rotate velocity toward the target direction.
            const targetAngle = Math.atan2(dy, dx);
            const bulletAngle = Math.atan2(b.vy, b.vx);
            let angleDiff = targetAngle - bulletAngle;
            // Normalize angleDiff to [-π, π].
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            const nudge = Math.max(-EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD,
                   Math.min(EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD, angleDiff));
            if (Math.abs(nudge) > 1e-9) {
              // Rotate velocity by nudge radians.
              const cos = Math.cos(nudge);
              const sin = Math.sin(nudge);
              const vx = b.vx * cos - b.vy * sin;
              const vy = b.vx * sin + b.vy * cos;
              b.vx = vx;
              b.vy = vy;
            }
          }
        }
      }
```

**Important:** The `_nearestEnemy` method is a hoisted private method at line 532.
It reads from `this._enemies` which is populated by `forEachActive` calls in
`fixedUpdate`. We need to make sure the enemies are collected before the bullet
integration step.

### Task 4: Wire eventHorizonActive in buildArenaWorld.js

In `buildArenaWorld.js`, after the `critical-resonance` fusion effect handler
registration (around line 663), add the Event Horizon effect:

```js
    // Story 12.13 — Event Horizon: passive gravity pull + bullet curvature.
    FusionSystem.registerEffect(
      'event-horizon',
      () => {
        // Enable the passive gravity field on XpOrbSystem.
        if (xpOrbSystem) xpOrbSystem.eventHorizonActive = true;
        // Enable bullet curvature on FiringSystem.
        if (firingSystem) firingSystem._eventHorizonActive = true;
      },
    );
```

Check: what the variable names are for XpOrbSystem and FiringSystem.
Looking at buildArenaWorld.js — we'll verify the exact variable names when
implementing.

### Task 5: Update fusionSystem.js stub comment

The `event-horizon` recipe already exists in `FUSION_RECIPES`. Update the
stub comment:

```js
  effect: () => {}, // Story 12.13 — wires passive gravity + bullet curvature
```

### Task 6: Tests — XpOrbSystem (Event Horizon pull)

Create or append tests in `src/systems/gravityWellSystem.test.js`:

1. **eventHorizonActive pulls enemies toward ship** — set `eventHorizonActive = true` on XpOrbSystem. Place enemy at `(-100, 0)` from ship. Call `fixedUpdate(DT)`. Assert enemy.x has decreased by expected pull distance (`strength * (1 - d/radius) * dtSec` clamped to max).

2. **eventHorizonActive does not pull telegraphing enemies** — enemy at `(-100, 0)` with `telegraphMs > 0`. Assert position unchanged.

3. **eventHorizonActive does not pull enemies outside radius** — enemy at `(-300, 0)`. Assert position unchanged.

4. **eventHorizonActive does not pull the ship** — ship never moves because of its own gravity. Assert ship.x/ship.y unchanged.

5. **eventHorizonActive + Gravity Well pull coexist** — both flags true. Enemy should be pulled by both orb pull (toward orb) AND event horizon pull (toward ship). Verify additive displacement.

6. **null ship guard** — set `ship = null`. Call `fixedUpdate(DT)`. Should not throw.

7. **null enemyPools guard** — pass `null` for enemyPools. Call `fixedUpdate(DT)`. Should not throw.

8. **NaN dt guard** — call `fixedUpdate(NaN)`. Assert no NaN propagates into enemy coordinates.

9. **negative/invalid dt guard** — call `fixedUpdate(-1)`. Should not modify enemy positions.

### Task 7: Tests — FiringSystem (Event Horizon bullet curvature)

Create or append tests in `src/systems/firingSystem.test.js`:

1. **eventHorizonActive curves bullet toward nearest enemy** — set `_eventHorizonActive = true`. Place enemy at (50, 50) from ship. Fire bullet rightward (vx = bulletSpeed, vy = 0). Call `fixedUpdate(DT)`. Assert bullet has acquired a small vy velocity component toward the enemy.

2. **eventHorizonActive preserves bullet speed** — assert `Math.hypot(newVx, newVy) === Math.hypot(oldVx, oldVy)`.

3. **eventHorizonActive: no enemies → no curvature** — no enemies in arena. EnemyPools exist but are empty. Bullet fires straight (no velocity change from curvature).

4. **eventHorizonActive: bullet already aimed at enemy → minimal nudge** — enemy directly ahead of bullet direction. Angle diff ≈ 0, so nudge is minimal (near zero).

5. **eventHorizonActive: bullet aimed opposite of enemy → maximum nudge** — enemy behind bullet. Angle diff is large (up to nearly π), but nudge is capped at `EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD`.

6. **eventHorizonActive: null enemyPools → no crash** — set `enemyPools = null`. Fire bullet. Should not throw.

7. **multiple bullets all curve identically** — two bullets fired simultaneously. Both curve toward the same nearest enemy by the same nudge.

### Task 8: Verify

Run: `npm test`

Verify: if tests are appended to existing test files, ensure all existing tests
also pass + all new Event Horizon tests pass.

## Verification

**Commands:**
- `npm test` -- expected: all existing tests pass + all new Event Horizon tests pass.

---

## Design Notes

### Why modify XpOrbSystem, not create a new gravity system?

XpOrbSystem already owns the **enemy pull** code from Grayity Well Lv5 — it
walks enemy pools, applies inverse-distance falloff pull toward orb positions,
and clamps positions to arena bounds. Event Horizon simply changes the pull
target from *orb position* to *ship position*, and makes it active every tick
regardless of orb count. Reusing this code avoids introducing a new system that
would only differ in one constant (pull target).

The existing pattern in XpOrbSystem:
1. Uses hoisted `_enemies` / `_currentPool` scratch
2. Collects non-telegraphing enemies via `forEachActive(_collectEnemy)`
3. Iterates collected enemies, applies pull formula, clamps to arena

This is the exact same pattern BlackHoleSystem uses for `_pull`, and DashSystem
reuses for its Slipstream decoy pull. One implementation, three consumers.

### Why FiringSystem for bullet curvature?

Bullet curvature is a per-bullet velocity adjustment that happens during
**integration** — the same step where `b.x += b.vx * dtSec` is executed.
FiringSystem owns the bullet pool and the integration loop, so it's the natural
place to add this effect. There's no other system that touches bullet velocity
after spawn — FiringSystem is the bullet lifecycle manager.

The curvature is implemented as a **velocity rotation** (preserve speed,
change direction slightly) rather than a velocity addition. This ensures bullets
never accelerate above `BULLET_SPEED` and the effect is purely orientational,
never additive to speed. This aligns with how the Black Hole pull works on
bullets: it's a **position nudge**, not a velocity addition.

**Correction:** Actually, BlackHoleSystem pulls bullets via position nudge
(`_pull` in BlackHoleSystem). Event Horizon's bullet effect is different —
it's a **velocity rotation** applied at integration time. Both are valid
position-mutation strategies; the velocity rotation is chosen because it
creates a gradual curved path rather than a discrete position shift (which
would look jittery).

### Why is the pull so weak?

The PRD says Event Horizon's power sits near the ~4× Lv5-item ceiling —
**run-defining, not run-ending**. A strong gravity field would dominate every
enemy movement, making positioning trivial and reducing the skill ceiling
too much. The pull is deliberately gentle: 12 px/s at the center (weaker than
Gravity Well's 40 px/s active pull), with 200px radius. This means:

- Enemies are noticeably drawn in from nearby (50-100px) but ignore distant ones (300px+)
- The effect is a persistent pressure, not a force field
- It synergizes with Gravity Well Lv5's orb pull (double gravity is strong)
- It creates a "danger zone" around the ship that enemies must fight against

If the pull were stronger (e.g. 40 px/s like Gravity Well), enemies would
cluster around the ship like a magnet — predictable, boring, and trivially
exploitable by any AoE build. The weak pull keeps the effect **ambient**
rather than **dominant**.

### Why is bullet curvature so weak (~1.7° per tick)?

The PRD says "curves bullets toward enemies" — that's the entire spec. The
question is how much. If curvature were strong (e.g. 10°/tick), bullets would
essentially home in on enemies, turning Event Horizon into a homing-bullet
upgrade with a different name. This would break the twin-stick skill gap
(aim less meaningful, curvature does the work).

At 0.03 rad (~1.7°) per tick:
- A bullet needs ~4-5 ticks to fully turn toward a nearby enemy
- The bullet still mostly travels in the fired direction
- Players will *feel* the nudge on border cases — shots that barely miss
  now curve back to hit — but it doesn't replace aiming
- It's a **bonus**, not a replacement for aim

Think of it like a gentle wind you can feel pushing at the edge of your shots,
not a homing missile.

### The "Event Horizon" metaphor

The name "Event Horizon" (the point of no return around a black hole) is
apt for two reasons:

1. **Permanent gravity well around the ship** — just as a black hole
   relentlessly attracts everything nearby, Event Horizon passively pulls
   enemies toward you. You don't pull the lever; it's always there.

2. **Curved light paths** — in physics, light curves near a black hole
   because gravity bends spacetime. Bullets "curving" toward enemies
   mirrors this: the gravity field warps the battlefield's geometry,
   making your shots find their mark more reliably.

The effect is passive and invisible — no draw call, no audio. The
*player feels* the gravity but can't see it directly. A visual "event
horizon" ring or distortion could be added in Story 12.2 if desired.

### Why not make the pull target the player's aim direction?

The PRD says "draws enemies in" (toward the ship), not toward the player's
aim. This keeps the effect simple: always toward the ship. Making it aim-
directional would add complexity (direction calculation, player-state reading)
without proportional value — the gravity is a passive aura, not a directed
force. The player focuses on movement (repositioning to optimize the gravity
field's spread) rather than aiming at enemies to attract them.

### Coexistence with Gravity Well

Both effects coexist. Gravity Well Lv5 pulls enemies toward **active XP orbs**
(each orb is a mini gravity well). Event Horizon pulls enemies toward the
**ship** (one permanent field). The two can pull enemies in different directions,
creating interesting multi-vector force interactions that make enemy behavior
less predictable and more chaotic — a feature, not a bug.

## Auto Run Result

**Status:** done

**Summary:** Implemented Story 12.13 — Event Horizon fusion Epic. When fused (Gravity Well Lv5 + Mine Layer Lv3):

- **Passive gravity pull:** Enemies within EVENT_HORIZON_PULL_RADIUS (200px) are pulled toward the ship each tick at a gentle constant (12 px/s at center), using inverse-distance falloff. Telegraphing enemies are immune. Coexists additively with Gravity Well Lv5 orb pull.
- **Bullet curvature:** Player bullets are slightly curved toward the nearest combat enemy during integration. Velocity rotation is capped at ~1.7° per tick, preserving bullet speed. No enemies → no curvature.

**Files changed:**
- `src/config/constants.js` (MODIFIED) — added 4 Event Horizon constants: `EVENT_HORIZON_PULL_STRENGTH=12`, `EVENT_HORIZON_PULL_RADIUS=200`, `EVENT_HORIZON_BULLET_CURVE_STRENGTH=1`, `EVENT_HORIZON_BULLET_CURVE_ANGLE_MAX_RAD=0.03`
- `src/systems/XpOrbSystem.js` (MODIFIED) — imported new constants; added `eventHorizonActive` field; in `fixedUpdate`, after Gravity Well pull, pull non-telegraphing enemies toward the ship when `eventHorizonActive` is true
- `src/systems/FiringSystem.js` (MODIFIED) — imported new constants; added `_eventHorizonActive` field; in `fixedUpdate`, before bullet integration, collect nearest-enemy scratch; in `_collectExpired`, apply velocity rotation toward nearest enemy when `eventHorizonActive`
- `src/scenes/buildArenaWorld.js` (MODIFIED) — registered `'event-horizon'` fusion effect handler: sets `xpOrbSystem.eventHorizonActive = true` and `firingSystem._eventHorizonActive = true`
- `src/systems/fusionSystem.js` (MODIFIED) — updated Event Horizon stub comment from "Stub" to "Story 12.13 — wires passive gravity + bullet curvature"
- `src/systems/gravityWellSystem.test.js` (MODIFIED) — appended 9 Event Horizon pull tests
- `src/systems/firingSystem.test.js` (MODIFIED) — appended 7 Event Horizon curvature tests

**Verification:** `npm test` → 2270 tests pass (all existing + 16 new Event Horizon tests, 0 failures).

**Residual risks:**
- No visual/audio for the gravity field (intentionally deferred to Story 12.2 per spec)
- The `_nearestEnemy` truthy guard in FiringSystem always passes since it's a class method (defensive documentation only)
- Bullet curvature speed-preservation verified as primary metric rather than specific velocity value (depends on timing within fixed tick)

---

## Spec Change Log

| Date | Change |
|------|--------|
| 2026-07-31 | Implemented per tasks 1-8; status changed to done |
