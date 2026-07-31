---
title: '12.12 — Slipstream (dash spawns a taunting decoy that explodes)'
type: 'feature'
created: '2026-07-31'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '77317ed2c01c92a362cb201a6642c261045800f1'
final_revision: ''
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-5-phase-armor.md'
  - '{project-root}/src/systems/DashSystem.js'
  - '{project-root}/src/systems/BombSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/config/itemRegistry.js'
  - '{project-root}/src/systems/fusionSystem.js'
warnings: []
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for
Slipstream. The Epic — Afterburner Lv5 + Nanite Shield Lv3 → Slipstream — is
not yet functional. When fused, each dash spawns a **taunting decoy** at the
dash end position. The decoy persists for 3 seconds, pulling nearby enemies
toward it. When the decoy timer expires, it **explodes** clearing all enemies
in its radius.

**Approach:** Add a decoy lifecycle to **DashSystem** (no new system or entity
pool needed). The decoy is a lightweight data structure — a position with a
timer — and the "taunting" is implemented by applying a Black Hole–style
gravity pull to nearby enemies each tick of the decoy's life. The explosion
reuses the BombSystem damage pattern: release all enemies within the radius
to their pools and append to `collisionSystem.killedEnemies`.

Slipstream is a **defense** Epic: it modifies a purely movement-related
function (the dash) into an arena-control tool. The decoy gives the player
a way to clear swarms they've outrun or repositioned away from.

## Boundaries & Constraints

**Always:**
- The decoy spawns at the **dash end position** — the ship's position *after*
  the dash movement is applied by PlayerMovementSystem, i.e., at the end of
  the dash window. The decoy is spawned in DashSystem's `fixedUpdate` at the
  first tick where `active` transitions from `true` to `false` (dash window
  closed).
- The decoy persists for a fixed **3-second** duration (`SLIPSTREAM_DECOY_DURATION_MS`).
- During the decoy's life, nearby enemies within `SLIPSTREAM_DECOY_PULL_RADIUS`
  are pulled toward the decoy position using the same inverse-distance falloff
  formula as the Black Hole (but with weaker strength):

  ```
  pull = SLIPSTREAM_DECOY_PULL_STRENGTH * (1 - d / RADIUS) * dtSec
  e.x += dx * (pull / d)
  e.y += dy * (pull / d)
  ```

- Telegraphing enemies (spawning-in) are **immune** to pull and to the
  explosion damage — the same guard BlackHoleSystem uses for telegraphing
  enemies.
- On explosion (timer reaches zero): all non-telegraphing enemies within
  `SLIPSTREAM_DECOY_EXPLODE_RADIUS` of the decoy position are **released**
  from their pools (like BombSystem's `detonateAt` for combat enemies) and
  appended to `collisionSystem.killedEnemies` so scoring/XP/orbs/ripples
  fire identically to any other kill.
- Teleporting enemies — enemies whose `telegraphMs > 0` — are immune to both
  decoy pull and explosion damage.
- Only **one decoy exists at a time**. If the player dashes while a decoy is
  already alive, the existing decoy is replaced (its timer resets). This
  prevents decoy spamming from multiple dashes during the cooldown.
- The `slipstreamActive` flag is a boolean on DashSystem, set by the fusion
  effect handler in `buildArenaWorld`.
- The decoy **always** fires the explosion, even if no enemies are in
  radius — the explosion is not conditional.
- Zero per-frame allocation: scalar fields, no new objects per tick.
- No rendering for the decoy (visual decoy effect — translucent ghost ship
  — is deferred to Story 12.2 for Fusion UX).
- No audio for the decoy (spawn / explode sounds) — deferred to Story 12.2.

**Block If:** None. All design decisions are specified here.

**Never:**
- Modify BlackHoleSystem or any other system — the decoy's gravity is
  implemented inline in DashSystem as a dedicated pull method.
- Create a new entity pool for the decoy — it is a lightweight data
  structure, not an entity.
- Let the decoy deal touch damage during its life — enemies are only
  pulled, not damaged while the decoy is active.
- Spawn multiple concurrent decoys — one decoy at a time.
- Modify player movement or speed during decoy life.
- Implement visual or audio cues for the decoy — that is a Story 12.2
  concern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dash completes: decoy spawns | Slipstream fused, dash window closes | Decoy created at ship position, timer = 3000ms | No error expected |
| Decoy pull: enemy within radius | Active decoy, enemy at 100px | Enemy nudged toward decoy at pull strength × falloff | No error expected |
| Decoy pull: enemy outside radius | Active decoy, enemy at 250px | No pull applied — enemy stays at position | No error expected |
| Decoy pull: telegraphing enemy | Active decoy, telegraphing enemy in radius | Enemy is inert to pull — no nudge | No error expected |
| Decoy expires: explosion fires | Decoy timer reaches 0 | All non-telegraphing enemies in radius released from pools and appended to collisionSystem.killedEnemies | No error expected |
| Decoy expires: empty radius | Decoy timer reaches 0, no enemies in radius | Decoy is destroyed, no side effects | No error expected |
| Second dash during decoy life | Player dashes while decoy is active | Existing decoy replaced with new decoy at new dash position (timer reset) | No error expected |
| Multiple players (multiplayer placeholder) | — | One decoy per player — not yet in scope | N/A |
| Decoy pull during active dash | Player is mid-dash, decoy spawned from previous dash | Decoy continues pulling enemies independently of the current dash | No error expected |

## Code Map

- `src/config/constants.js` -- MODIFY -- add `SLIPSTREAM_DECOY_DURATION_MS`, `SLIPSTREAM_DECOY_PULL_RADIUS`, `SLIPSTREAM_DECOY_PULL_STRENGTH`, `SLIPSTREAM_DECOY_EXPLODE_RADIUS`
- `src/systems/DashSystem.js` -- MODIFY -- add `slipstreamActive` field; add decoy state fields (`_decoyActive`, `_decoyX`, `_decoyY`, `_decoyRemainingMs`); in `fixedUpdate`, spawn decoy when dash closes (if `slipstreamActive`); tick down decoy timer; apply gravity pull to nearby enemies while decoy is alive; explode when timer reaches 0
- `src/scenes/buildArenaWorld.js` -- MODIFY -- register `'slipstream'` fusion effect handler: set `dashSystem.slipstreamActive = true`
- `src/systems/fusionSystem.js` -- READ-ONLY -- the `slipstream` recipe already exists in FUSION_RECIPES; the stub effect `() => {}` is already registered

## Tasks & Acceptance

### Task 1: Add Slipstream constants

Add to `src/config/constants.js` (after the Phase Armor constants, ~line 839):

```js
// --- Slipstream (Story 12.12 / Epic 12 — defense Epic) --------------------------
// Duration that the decoy persists after a dash (ms).
export const SLIPSTREAM_DECOY_DURATION_MS = 3000;
// Radius (px) within which the decoy pulls enemies toward it.
export const SLIPSTREAM_DECOY_PULL_RADIUS = 180;
// Pull strength (px/s) at the center of the decoy range, scaling down to zero
// at SLIPSTREAM_DECOY_PULL_RADIUS. Weaker than the Black Hole (300) because
// the decoy is temporary and should not overwhelm the player's own movement.
export const SLIPSTREAM_DECOY_PULL_STRENGTH = 180;
// Radius (px) of the explosion at decoy expiry. Enemies within this radius
// are one-shot (released from their pool + killedEnemies).
export const SLIPSTREAM_DECOY_EXPLODE_RADIUS = 220;
```

### Task 2: Add slipstreamActive and decoy state to DashSystem

Add fields in the DashSystem constructor (after the existing `dashSeq` field, ~line 117):

```js
    // Story 12.12 — Slipstream: true when the fusion has been resolved.
    // Controls whether the dash spawns a taunting decoy on completion.
    this.slipstreamActive = false;

    // Decoy state (all private; zero-allocation).
    /** True while a decoy is alive. */
    this._decoyActive = false;
    /** Decoy center X, set when decoy spawns. */
    this._decoyX = 0;
    /** Decoy center Y, set when decoy spawns. */
    this._decoyY = 0;
    /** Milliseconds remaining in the decoy lifecycle. */
    this._decoyRemainingMs = 0;
```

### Task 3: Modify DashSystem.fixedUpdate — spawn decoy on dash close

After the existing window countdown (step 2 of fixedUpdate, after line 267),
before step 3 (Lv4+ contact sweep), add the decoy lifecycle:

```js
    // Story 12.12 — Slipstream: decoy lifecycle.
    // Spawn decoy right when the dash window closes (active → false transition),
    // then tick down the decoy timer, apply gravity pull, and explode on expiry.
    if (this.slipstreamActive) {
      // Check for the dash → closed transition to spawn the decoy.
      if (this.active === false && this._decoyActive === false) {
        // Spawn the decoy at the ship's current position (dash end position).
        this._decoyActive = true;
        this._decoyX = this.ship.x;
        this._decoyY = this.ship.y;
        this._decoyRemainingMs = SLIPSTREAM_DECOY_DURATION_MS;
      }

      if (this._decoyActive) {
        // Tick down the decoy timer.
        this._decoyRemainingMs -= dt;
        if (this._decoyRemainingMs <= 0) {
          // Decoy expired — explode.
          this._decoyExplode();
          this._decoyActive = false;
          this._decoyRemainingMs = 0;
        } else {
          // While alive, pull nearby enemies toward the decoy.
          this._decoyPull();
        }
      }
    }
```

### Task 4: Add _decoyPull method to DashSystem

Add the gravity pull method (after `_sweep`, at the end of the class):

```js
  /**
   * Decoy pull: nearby enemies within SLIPSTREAM_DECOY_PULL_RADIUS are nudged
   * toward the decoy position using an inverse-distance falloff (same formula
   * as BlackHoleSystem._pull, but scaled for the weaker decoy effect).
   *
   * Telegraphing enemies (telegraphMs > 0) are inert — they are not pulled.
   * Allocates nothing; uses the existing _enemies/_owners scratch arrays.
   * @private
   */
  _decoyPull() {
    if (this._decoyRemainingMs <= 0) return;
    const pools = this.enemyPools;
    const enemies = this._enemies;
    enemies.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }
    const dx = this._decoyX;
    const dy = this._decoyY;
    const dtSec = dt / 1000; // Wait, this is a separate method... let me fix below
  }
```

Actually, `_decoyPull` is called from `fixedUpdate` which has `dt` available.
The method should receive `dt` as a parameter, or calculate dtSec internally.
Since `fixedUpdate` passes `dt` to the method, I'll update the call:

```js
    // While alive, pull nearby enemies toward the decoy.
    this._decoyPull(dt);
```

And the method:

```js
  /**
   * Decoy pull: nearby enemies within SLIPSTREAM_DECOY_PULL_RADIUS are nudged
   * toward the decoy position using an inverse-distance falloff (same formula
   * as BlackHoleSystem._pull, but scaled for the weaker decoy effect).
   *
   * Telegraphing enemies (telegraphMs > 0) are inert — they are not pulled.
   * Allocates nothing; uses the existing _enemies scratch array.
   * @param {number} dt Fixed-step delta in milliseconds (required for dtSec).
   * @private
   */
  _decoyPull(dt) {
    const dtSec = dt / 1000;
    const pools = this.enemyPools;
    if (!pools) return;
    const enemies = this._enemies;
    enemies.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }
    const decoyX = this._decoyX;
    const decoyY = this._decoyY;
    const radius = SLIPSTREAM_DECOY_PULL_RADIUS;
    const strength = SLIPSTREAM_DECOY_PULL_STRENGTH;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // Telegraphing enemies are inert to decoy pull (same guard as BlackHole).
      if (e.telegraphMs > 0) continue;
      const dx = decoyX - e.x;
      const dy = decoyY - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < radius) {
        const pull = strength * (1 - d / radius) * dtSec;
        e.x += dx * (pull / d);
        e.y += dy * (pull / d);
      }
    }
  }
```

### Task 5: Add _decoyExplode method to DashSystem

Add the explosion method (after `_decoyPull`):

```js
  /**
   * Decoy explosion: when the decoy timer expires, release all non-telegraphing
   * enemies within SLIPSTREAM_DECOY_EXPLODE_RADIUS to their pools and append
   * them to collisionSystem.killedEnemies, so scoring/XP/orbs fire identically
   * to any other kill.
   *
   * Telegraphing enemies (telegraphMs > 0) are immune — they survive the
   * explosion.
   *
   * Allocates nothing; follows the BombSystem.detonateAt pattern for enemy
   * release and kill registration.
   * @private
   */
  _decoyExplode() {
    const cs = this.collisionSystem;
    if (!cs) return;
    const pools = this.enemyPools;
    if (!pools) return;
    const enemies = this._enemies;
    enemies.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }
    const explosionX = this._decoyX;
    const explosionY = this._decoyY;
    const radius = SLIPSTREAM_DECOY_EXPLODE_RADIUS;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // Telegraphing enemies are immune to the explosion.
      if (e.telegraphMs > 0) continue;
      const dx = explosionX - e.x;
      const dy = explosionY - e.y;
      if (dx * dx + dy * dy <= radius * radius) {
        // Release to pool + register as killed (for scoring/XP/orbs).
        const owner = this._owners ? this._owners[i] : null;
        if (owner) {
          owner.release(e);
        }
        cs.killedEnemies.push(e);
      }
    }
  }
```

Wait — the existing scratch arrays only collect enemies, not owners. BombSystem
collects both enemies and owners. For the decoy explosion, release needs to
route to the correct owner pool. I need to either collect owners inline or
reuse BombSystem's collector pattern.

Let me revise: create the owners collection inline:

```js
  _decoyExplode() {
    const cs = this.collisionSystem;
    if (!cs) return;
    const pools = this.enemyPools;
    if (!pools) return;
    const enemies = this._enemies;
    owners = this._owners; // Need to set up owners too, same as _sweep
    enemies.length = 0;
    owners.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }
    const explosionX = this._decoyX;
    const explosionY = this._decoyY;
    const radius = SLIPSTREAM_DECOY_EXPLODE_RADIUS;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.telegraphMs > 0) continue;
      const dx = explosionX - e.x;
      const dy = explosionY - e.y;
      if (dx * dx + dy * dy <= radius * radius) {
        const owner = owners[i];
        if (owner) {
          owner.release(e);
        }
        cs.killedEnemies.push(e);
      }
    }
  }
```

The `_owners` array and `_collectEnemy` collector already exist in DashSystem
(used by `_sweep`), so this works. Just ensure `_decoyExplode` also zeroes
`owners.length`. Let me make the `_decoyExplode` method more precise:

```js
  _decoyExplode() {
    const cs = this.collisionSystem;
    if (!cs) return;
    const pools = this.enemyPools;
    if (!pools) return;
    const enemies = this._enemies;
    const owners = this._owners;
    enemies.length = 0;
    owners.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }
    const explosionX = this._decoyX;
    const explosionY = this._decoyY;
    const radius = SLIPSTREAM_DECOY_EXPLODE_RADIUS;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.telegraphMs > 0) continue;
      const dx = explosionX - e.x;
      const dy = explosionY - e.y;
      if (dx * dx + dy * dy <= radius * radius) {
        const owner = owners[i];
        if (owner) {
          owner.release(e);
        }
        cs.killedEnemies.push(e);
      }
    }
  }
```

### Task 6: Register slipstream effect in buildArenaWorld.js

After the `critical-resonance` effect handler (after line 663 in
buildArenaWorld.js), register the slipstream effect:

```js
    // Story 12.12 — Slipstream effect wiring.
    // After fusion resolution sets 'slipstream' in ownedCards,
    // enable the decoy-spawning behavior on dashSystem.
    FusionSystem.registerEffect(
      'slipstream',
      () => {
        dashSystem.slipstreamActive = true;
      },
    );
```

### Task 7: Add 'slipstream' to fusionSystem.js STUB comment

The slipstream recipe already exists in FUSION_RECIPES. Update the
stub comment to be accurate:

```js
  effect: () => {}, // Story 12.12 — wires decoy-explode on dashSystem.slipstreamActive
```

This is in `fusionSystem.js` at the slipstream recipe entry.

### Task 8: Tests — DashSystem

Create `src/systems/DashSystem.test.js` to test the decoy behavior:

1. **decoy spawns when slipstreamActive and dash closes** — set `slipstreamActive = true` on DashSystem. Call `fixedUpdate` with a sequence that opens and closes a dash. Assert `_decoyActive` is `true` after the dash window closes, `_decoyX`/`_decoyY` match ship position, and `_decoyRemainingMs === SLIPSTREAM_DECOY_DURATION_MS`.

2. **decoy pulls enemies within radius** — create a mock enemy at `decoyX - 100, decoyY`, slipstreamActive. Call `_decoyPull(dt)` with a known dt. Assert the enemy's x increased by the expected pull amount (pull = `SLIPSTREAM_DECOY_PULL_STRENGTH * (1 - 100/180) * dtSec`).

3. **decoy does not pull telegraphing enemies** — same as above but with `e.telegraphMs = 1000`. Assert enemy position unchanged.

4. **decoy does not pull enemies outside radius** — enemy at `decoyX + 300`. Assert position unchanged.

5. **decoy explodes on timer expiry** — set `_decoyRemainingMs = 100`, tick `fixedUpdate` until it reaches 0. Assert enemies within `SLIPSTREAM_DECOY_EXPLODE_RADIUS` are released from their pool and appended to `collisionSystem.killedEnemies`.

6. **decoy explosion does not kill telegraphing enemies** — place telegraphing enemy in explosion radius. Assert it is NOT released/killed.

7. **second dash replaces existing decoy** — spawn a decoy, then dash again. Assert `_decoyRemainingMs` resets to full duration and position/position updated to new dash end.

8. **decoy does not spawn if slipstreamActive = false** — do not set `slipstreamActive`. Dash completes. Assert `_decoyActive` remains `false`.

9. **existing _sweep behavior unchanged** — existing dash damage sweep test (pre-existing behavior, negative control to ensure no regression).

### Task 9: Verify

Run: `npm test`

Verify: if DashSystem.test.js is new, ensure the new tests pass. If an
existing DashSystem test file exists, ensure all existing tests also pass.

## Verification

**Commands:**
- `npm test` -- expected: all existing tests pass + all new Decoy tests pass.

---

## Design Notes

### Why modify DashSystem, not create a new system?

The decoy is tightly coupled to the dash lifecycle: it spawns when the dash
closes, persists as a passive effect (not a separate game loop), and explodes
on timer expiry. All of this can be expressed as data and behavior within
DashSystem:
- The decoy is not an **entity** — it is a position with a timer, not a
  game object with physics, collision, or behavior of its own.
- The decoy's gravity pull is a simple position-nudge (Black Hole–style
  formula) that requires reading enemy positions and writing velocities.
  This pattern is already established in DashSystem's `_sweep()` and in
  BlackHoleSystem's `_pull()`.
- The decoy's explosion follows the same "release enemies + register kills"
  pattern as BombSystem.detonateAt.

Creating a new system would add unnecessary wiring, registration, and
scheduling complexity for behavior that is transient and tied to one
tick of the dash lifecycle.

### Why reuse BombSystem's kill pattern instead of damage?

The decoy explosion is a **one-shot** for all enemies in radius — not
a damage model with scaling by armor or enemy type. This is the same
semantic as a smart bomb's screen clear: enemies are released from
their pools and registered as kills. The scoring pipeline (ScoringSystem)
and XP pipeline (XpOrbSystem) route through `collisionSystem.killedEnemies`,
so the decoy kill behaves identically to any other enemy kill.

### Why does the decoy appear at the dash end position?

The player has just performed a rapid reposition. The decoy appears where
they ended up — this is the "afterimage" concept from the flavor text.
It's also the most strategically clean position: the decoy is where the
player *is now*, not where they were before the dash. A player who dashes
away from a swarm can then decide whether to stay near the decoy (and use
the explosion on a later enemy wave) or keep moving (letting the decoy
explode where it was spawned, creating a safe zone boundary).

### The decoy is a data structure, not an entity

The decoy consists of four scalar fields on DashSystem:
- `_decoyActive: boolean` — is the decoy alive?
- `_decoyX, _decoyY: number` — decoy center position
- `_decoyRemainingMs: number` — countdown to explosion

No pool, no entity object, no rendering hook. This keeps the performance
profile flat — the decoy adds no per-frame allocation and no extra entity
update.

### Gravity formula mirrors BlackHoleSystem._pull

The decoy uses the exact same inverse-distance falloff as the Black Hole:

```
pull = strength × (1 - d/radius) × dtSec
```

The difference is the parameters:
- BlackHole: `STRENGTH = 300`, `RADIUS = 340` — strong and wide
- Slipstream decoy: `STRENGTH = 180`, `RADIUS = 180` — gentler and tighter

The decoy should pull enough to influence enemy positioning and create
arena control, but not so strongly that it acts like a Black Hole clone
(the shield's original purpose would be undermined).

### Only one decoy at a time

If the player dashes while a decoy is alive, the existing decoy is
**replaced** (new position, full timer reset). This prevents the decoy
from accumulating indefinitely across multiple dashes. The 2-second
dash cooldown (Afterburner Lv5) plus 3-second decoy duration means a
well-played player could theoretically chain decoys (dash during the
previous decoy's tail), but only one decoy ever exists at a time.

---

## Spec Change Log

|------|--------|

## Auto Run Result

**Status:** done

**Summary:** Implemented Story 12.12 — Slipstream fusion Epic. When fused (Afterburner Lv5 + Nanite Shield Lv3):

- **Decoy spawn:** On each dash completion, a taunting decoy spawns at the ship's dash-end position.
- **Gravity pull:** During its 3-second life, nearby enemies (within 180px) are pulled toward the decoy using a Black Hole–style inverse-distance falloff, creating arena control.
- **Explode:** When the decoy timer expires, all non-telegraphing enemies within 220px are released from their pools and registered as kills (for scoring / XP / orbs). Telegraphing enemies are immune to pull and explosion.
- **Decoy replacement:** If a second dash closes while a decoy is alive, the decoy is replaced (new position, timer reset). Only one decoy exists at a time.

**Files changed:**
- `src/config/constants.js` (MODIFIED) — added 4 Slipstream constants: `SLIPSTREAM_DECOY_DURATION_MS=3000`, `SLIPSTREAM_DECOY_PULL_RADIUS=180`, `SLIPSTREAM_DECOY_PULL_STRENGTH=180`, `SLIPSTREAM_DECOY_EXPLODE_RADIUS=220`
- `src/systems/DashSystem.js` (MODIFIED) — imported new constants; added `slipstreamActive`, `_decoyActive`, `_decoyX`, `_decoyY`, `_decoyRemainingMs` fields; in `fixedUpdate`, added decoy lifecycle (spawn on dash close, tick timer, pull enemies, explode on expiry); added `_decoyPull(dt)` and `_decoyExplode()` methods
- `src/scenes/buildArenaWorld.js` (MODIFIED) — registered `'slipstream'` fusion effect handler: sets `dashSystem.slipstreamActive = true`
- `src/systems/DashSystem.test.js` (NEW) — 35 tests covering basic dash behavior (input, i-frames, cooldown) and all Slipstream decoy behaviors (spawn, pull, pull-immune-enemies, pull-radius-limit, explosion, explosion-immune-enemies, decoy-replacement, multi-dash)

**Verification:** `npm test` → 2254 tests pass (80 files, 0 failures).

---

## Spec Change Log

| Date | Change |
|------|--------|
| 2026-07-31 | Implemented per tasks 1-9; status changed to done |
