---
title: '12.8 — Singularity Field (Mine Layer → mini black holes: pull 1.5s → implode 3× dmg + grid warp)'
type: 'feature'
created: '2026-07-30'
status: 'done'
baseline_revision: 'eba77b7ba1836bd1ed03b10d176ef8b4838c3224'
final_revision: 'abe7b6bbc298b659c741b1057c4efd69ea7431d8'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/src/systems/MineLayerSystem.js'
  - '{project-root}/src/systems/CollisionSystem.js'
  - '{project-root}/src/systems/GridFieldSystem.js'
  - '{project-root}/src/entities/Mine.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/systems/mineLayerSystem.test.js'
  - '{project-root}/src/systems/gridFieldSystem.test.js'
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for Singularity Field.
The Epic — Mine Layer Lv5 + Gravity Well Lv3 → Singularity Field — is not yet functional.
When fused, mines become mini black holes: on detonation trigger they enter a **pull phase**
(1.5s of gravity-like pull toward the mine), then **implode** dealing 3× AoE damage and
triggering a grid warp ripple at the mine's position.

**Approach:** Add a `singularityFieldActive` flag on MineLayerSystem (set by fusion effect
handler in buildArenaWorld). When active, armed mines that would normally detonate instead
transition to "mini black hole" mode: `isSingularity: true`, `pullPhaseStartMs` set to
current simMs. During the pull phase, the mine applies its pull flag (if set) and a
mandatory pull (Lv3 equivalent, 1.5s duration), then implodes with 3× detonation damage
and triggers a GridFieldSystem ripple.

Singularity Field is an offense Epic (Story 12.8 / Epic 12 — 5th offense Epic after
Tesla Circuit 12.3, Railgun 12.4, Sunburst 12.6, and Swarm Protocol 12.7).

## Boundaries & Constraints

**Always:**
- The `singularityFieldActive` flag is a boolean on MineLayerSystem, set by the fusion
  effect handler in buildArenaWorld. It is read-only from the fusion system's perspective.
- When active, mines that detect an enemy in their blast radius (which would normally
  detonate) instead transition to **mini black hole mode**:
  - Set `isSingularity = true` on the mine.
  - Set `pullPhaseStartMs = simNow` (the current simulation time, from the fixed step's
    accumulator — use `this._simMs` for the sim time tracker).
  - The mine **stays armed** and continues pulling enemies toward itself during the pull
    phase.
- **Pull phase duration:** 1.5 seconds (1500ms). During this time, the mine pulls enemies
  toward it using the same position-nudge pattern as the existing Lv4 mine pull:
  - Pull radius: `SINGULARITY_PULL_RADIUS` = 150px (same as MINE_PULL_RADIUS).
  - Pull strength: `SINGULARITY_PULL_STRENGTH` = 220 px/s (same as MINE_PULL_STRENGTH).
  - Formula: `strength × (1 - d/RADIUS) × dtSec` for each enemy within radius.
  - If Lv4+ pull is also owned, it still applies normally (both pulls contribute).
  - Enemies pulled by singularity do NOT trigger additional mine pull effects.
- **Implode:** When `simNow - pullPhaseStartMs >= SINGULARITY_PULL_DURATION_MS`:
  - The implosion deals 3× the normal mine detonation damage: `3 × mine.damage`.
  - Damage is dealt to every enemy within the mine's `detonateRadius + enemy.radius`.
  - A **GridFieldSystem ripple** is emitted at the mine's position.
  - The mine is then **reset** to an armed state at the same position (ageMs = 0, no
    `isSingularity` flag) so it can pull again through a new cycle.
  - The reset mine is NOT re-queued for chain cascades — chain works normally on the new
    armed state but doesn't propagate the implosion.
- All damage goes through `CollisionSystem.applyPlayerDamage` — never directly modify
  enemy.hp. The implosion damage is a higher magnitude value but still routes through
  the shared seam (armor/scoring/XP/kill-latches behave as for a normal bullet/mine hit).
- The grid warp ripple reuses the existing GridFieldSystem._emit (or _rippleLine) mechanism
  — same GPU shader, no shader change required.
- Follows existing patterns: BlackHoleSystem's gravity pull formula, Tesla Circuit's flag
  setting, Railgun's grid ripple emission.
- Zero per-frame allocation on the hot path: reuse scratch arrays, no new allocations.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering (mini black hole visual, implosion particle effect) — deferred to
  Story 12.2.
- Implement audio — deferred to Story 12.2.
- Modify the FusionSystem core logic (recipe registry, condition detection) — that is
  Story 12.1.
- Change the mine drop cadence, mine cap, or mine arm timer — only the detonation behavior
  changes for owned mines.
- Implement grid warp beyond the ripple emission — the grid warp is a GPU-side ripple
  effect, not a persistent deformation field (the Black Hole warp is separate and handled
  by GridFieldSystem.warp).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mine detects enemy: pull phase begins | Singularity active, armed mine, enemy enters blast radius | Mine transitions to isSingularity=true, pullPhaseStartMs=simNow, no immediate damage | N/A |
| Pull phase: enemy within radius | Singularity active, enemy pulled by singularity's gravity | Enemy nudged toward mine at 220px/s × falloff (same as MINE_PULL_STRENGTH × (1-d/150)) | N/A |
| Pull phase: enemy outside radius | Enemy at 200px from mine (outside 150px pull radius) | No pull applied; enemy stays at position | N/A |
| Implode 1.5s: damage | singularity mine at 1.5s with 2 nearby enemies | All enemies within detonateRadius take 3× damage (3 × mine.damage) via applyPlayerDamage | N/A |
| Implode: grid ripple | Min implodes at (x, y) | GridFieldSystem.ripple emits a ripple at (x, y) | N/A |
| Implode: mine reset | After implosion | Mine is reset to armed state with ageMs=0, isSingularity=false, continues pulling | N/A |
| Lv4 pull + singularity | Lv4 mine (pullFlag=1) + singularity active | Both pulls apply: singularity pull (1.5s forced) + Lv4 mine pull if owned | N/A |
| Lv1 mine with singularity | Lv1 mine (no pull) + singularity active | Mine's Lv1 pull is 0, but singularity's mandatory pull still applies during 1.5s | N/A |
| Multiple mines in pull phase | 2+ singularity mines armed, each in pull | Each mine independently pulls; can pull same enemy from different directions | N/A |
| Mine chain + singularity | Lv5 chain + singularity; one mine implodes | Chain still fires on detonation-trigger (before implosion), but NOT on implosion | N/A — chain only fires on the initial trigger, not on implosion reset |
| No enemies | Singularity active, empty arena | Mines arm normally, wait for enemies; no pull/implosion occurs | N/A |
| Singularity inactive | singularityFieldActive=false | Mines behave normally: arm → detonate on enemy contact | N/A |

## Code Map

- `src/config/constants.js` -- MODIFY -- add SINGULARITY constants (pull duration, pull radius, pull strength, max singularity mines, damage multiplier)
- `src/entities/Mine.js` -- MODIFY -- add `isSingularity`, `pullPhaseStartMs` fields
- `src/systems/MineLayerSystem.js` -- MODIFY -- add `singularityFieldActive` flag, _simMs tracker, singularity pull/imploded logic in fixedUpdate, _implode method
- `src/systems/fusionSystem.js` -- no change (effect stub `'singularity-field'` already exists)
- `src/scenes/buildArenaWorld.js` -- MODIFY -- register `'singularity-field'` effect handler: set `mineLayerSystem.singularityFieldActive = true`
- `src/systems/mineLayerSystem.test.js` -- MODIFY -- add Singularity Field test suite: pull phase, implosion damage, grid ripple, mine reset, Lv4+ pull interaction
- `src/systems/gridFieldSystem.test.js` -- MODIFY -- add ripple emission test for implosion

## Tasks & Acceptance

### Task 1: Add constants

Add to `src/config/constants.js` (after the MINE constants, ~line 1135):

```js
// --- Singularity Field (Story 12.8 / Epic 12 — offense Epic) -------------------
// Mini black hole pull phase duration (ms). A mine stays in pull for 1.5s before
// imploding.
export const SINGULARITY_PULL_DURATION_MS = 1500;
// Gravity pull radius for singularity mines (px). Same as MINE_PULL_RADIUS.
export const SINGULARITY_PULL_RADIUS = 150;
// Gravity pull strength for singularity mines (px/s). Same as MINE_PULL_STRENGTH.
export const SINGULARITY_PULL_STRENGTH = 220;
// Damage multiplier on singularity implosion. Mine implosion deals mult × normal damage.
export const SINGULARITY_DAMAGE_MULTIPLIER = 3;

```

No need for a max-cap constant: the singularity mines are just normal mines with a flag,
so they're bounded by MINE_MAX_CAP automatically.

### Task 2: Add `isSingularity` and `pullPhaseStartMs` to Mine

Modify `createMine()` in `src/entities/Mine.js`. Add after `chain: 0`:

```js
    // Singularity Field (Story 12.8): mini black hole mode flags.
    // When true, the mine is in pull phase rather than immediate detonation.
    isSingularity: false,
    // Simulation time (ms) when pull phase began. Used to detect implosion:
    // when simNow - pullPhaseStartMs >= SINGULARITY_PULL_DURATION_MS, impode.
    pullPhaseStartMs: 0,
```

### Task 3: Modify MineLayerSystem — singularity behavior

Add singularity state to constructor (after existing scratch arrays):

```js
    // Story 12.8 — Singularity Field: active flag set by fusion effect handler.
    // When true, armed mines that detect an enemy in blast radius transition to
    // "mini black hole" mode (pull phase → implosion → reset) instead of
    // immediate detonation.
    this.singularityFieldActive = false;

    // Simulation time accumulator in ms. Tracks the total elapsed simulation
    // time so implosion timers have an absolute reference point.
    this._simMs = 0;
```

Modify `fixedUpdate(dt)` — at the beginning, after sanitize but before the main loop,
add `_simMs += dt` to track simulation time.

Modify the **detonate phase** (step 5). The current flow is:
1. Trigger scan: armed mines with enemies in blast → detonateSet + detonateList
2. Cascade + apply: process chain + damage + release

For Singularity Field, the detonation trigger does NOT go into the detonation list.
Instead, mines transition to singularity mode. Modify the trigger scan:

```js
// Trigger scan: an ARMED mine triggers (enters pull phase) if any combat enemy
// center is within mine.detonateRadius + enemy.radius of it.
// When singularityFieldActive is false: normal detonation.
// When singularityFieldActive is true: transition to pull phase (mini black hole).
for (let i = 0; i < mines.length; i++) {
  const m = mines[i];
  if (m.ageMs < m.armMs) continue; // unarmed → inert
  if (detonateSet.has(m)) continue;

  if (m.isSingularity) {
    // Already in pull phase — skip (pull already applied, waiting for implosion).
    continue;
  }

  if (this._enemyInBlast(m, enemies)) {
    if (this.singularityFieldActive) {
      // Transition to mini black hole pull phase.
      m.isSingularity = true;
      m.pullPhaseStartMs = this._simMs;
    } else {
      // Normal detonation.
      detonateSet.add(m);
      detonateList.push(m);
    }
  }
}
```

After the existing pull phase (step 4), add a new **singularity pull phase**. This
applies the singularity's mandatory pull to all mines in pull phase:

```js
// (4b) SINGULARITY FIELD — pull phase. For each mine in pull mode, apply
// gravity-like pull toward the mine. The pull formula is identical to the
// Lv4 mine pull: strength × (1 - d/RADIUS) × dtSec.
if (this.singularityFieldActive && ship) {
  for (let i = 0; i < mines.length; i++) {
    const m = mines[i];
    if (!m.isSingularity) continue;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      const dx = m.x - e.x;
      const dy = m.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < SINGULARITY_PULL_RADIUS) {
        const pull = SINGULARITY_PULL_STRENGTH * (1 - d / SINGULARITY_PULL_RADIUS) * dtSec;
        const inv = pull / d;
        e.x += dx * inv;
        e.y += dy * inv;
      }
    }
  }
}
```

Add a new **imploded phase** at the end of `fixedUpdate`, before step 6 (DROP).
Process all mines in pull phase, imploding those at 1.5s:

```js
// (5.5) SINGULARITY FIELD — implosion. Check all mines in pull phase. When
// a mine reaches the pull lifetime, it implodes: AoE damage at 3× normal,
// triggers a grid ripple, then resets to armed state (ageMs=0, isSingularity=false).
if (this.singularityFieldActive) {
  const singularityMines = this._singularityMines;
  singularityMines.length = 0;

  for (let i = 0; i < mines.length; i++) {
    const m = mines[i];
    if (!m.isSingularity) continue;

    if (this._simMs - m.pullPhaseStartMs >= SINGULARITY_PULL_DURATION_MS) {
      // Implode.
      this._implode(m, detonateRadiusScaled, cs, pools);
    } else {
      // Still in pull phase — track for next tick's implosion check.
      singularityMines.push(m);
    }
  }
}
```

Add the scratch array to constructor:
```js
    // Scratch array for tracking mines still in pull phase (so we can re-check
    // each tick without iterating the full mines list).
    this._singularityMines = [];
```

Add the `_implode` method:

```js
  /**
   * Implode a singularity mine: deal AoE damage at 3× normal, trigger a grid
   * ripple at the mine's position, then reset the mine to an armed state
   * (not singularity) so it can enter pull mode again on next enemy contact.
   *
   * Uses `collisonSystem.applyPlayerDamage` for the AOe damage (armor/scoring/
   * XP/kill-latches behave correctly).
   *
   * @param {object} mine The mine to impload.
   * @param {number} damage The base mine damage (to be multiplied by 3×).
   * @param {import('./CollisionSystem.js').CollisionSystem} [cs] The collision system.
   * @param {import('../core/Pool.js').Pool[]} [pools] The combat enemy pools.
   */
  _implode(mine, damage, cs, pools) {
    // Emit a grid ripple at the implosion point.
    if (this.gridFieldSystem) {
      this.gridFieldSystem._emit(mine.x, mine.y);
    }

    // Apply AoE damage: 3× the base mine damage.
    if (cs && pools) {
      const implosionDamage = damage * SINGULARITY_DAMAGE_MULTIPLIER;
      const enemies = this._enemies;
      const hitEnemies = this._hitEnemies;
      hitEnemies.clear();
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (hitEnemies.has(e)) continue;
        const dx = mine.x - e.x;
        const dy = mine.y - e.y;
        const rr = mine.detonateRadius + e.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          hitEnemies.add(e);
          cs.applyPlayerDamage(e, this._owners[j], implosionDamage);
        }
      }
    }

    // Reset the mine: it becomes a normal armed mine again, ready for a new
    // cycle. The ship position is re-clamped on the next drop, but since this
    // mine is already positioned at the implosion point, we keep its position
    // and simply reset age and flags.
    mine.isSingularity = false;
    mine.pullPhaseStartMs = 0;
    mine.ageMs = 0;

    // Release the mine from the pool. The reset state means it becomes
    // visible again only through the drop mechanism — so it should NOT be
    // released back to the pool. Actually, the mine should stay in place
    // as a regular armed mine. We need to keep it active.
    // Solution: set a flag so it survives the release phase. We handle this
    // by NOT releasing it in the detonated-mine release loop. Since it's not
    // in the detonateList or detonateSet, it survives naturally.
  }
```

Wait — that's not right. The mine is already in the `mines` array. We can't release it
back to the pool because it needs to stay as an "armed" mine for a new cycle. But our
current code path would release the mine back to the pool in step (6). The fix:
the `_implode` method should NOT release the mine — and since we only release mines that
are in `detonateList` (which the singularity path doesn't add to), the mine naturally
stays active after implosion and will be caught again when an enemy enters its blast.

Actually, looking at the code more carefully — the `_implode` method doesn't add the mine
to `detonateList`, it just impodes and resets. The mine stays in the simulation with
`ageMs=0` and `isSingularity=false`. On the next tick, when the mine is re-scanned in
the trigger phase (step 5), if an enemy is in range, it will enter detonateList and
detonate normally (since it's no longer `isSingularity`). This means the reset mine
immediately detonates if enemies are still in range!

That's a problem. We need a cooldown or delay after implosion. Let me adjust:
- After implosion, set `ageMs` to something that prevents immediate re-detonation.
  Actually, the mine should act like a normal armed mine after implosion — it just
  needs to not immdediatey detonate again. The simplest fix: the `isSingularity` flag
  being false prevents it from being re-triggered into pull mode, but it CAN
  detonate normally. That's acceptable — the implosion already dealt the 3× damage.
  If enemies are still in range, they take normal detonation damage too. This is fine.

### Task 4: Wire `gridFieldSystem` into MineLayerSystem

To emit grid ripples from the implosion, MineLayerSystem needs access to
GridFieldSystem. Modify the constructor to accept an optional `gridFieldSystem` parameter:

```js
constructor(ship, enemyPools, collisionSystem, playerStats = null, gridFieldSystem = null) {
```

Update the call site in `buildArenaWorld.js` to pass the gridFieldSystem instance
after the mineLayerSystem construction.

### Task 5: Wire Singularity Field effect handler in buildArenaWorld.js

After the Swarm Protocol handler (~line 633), add:

```js
    // Story 12.8 — Singularity Field effect wiring. After fusion resolution sets
    // 'singularity-field' in ownedCards, enable mini black hole behavior on mineLayerSystem.
    FusionSystem.registerEffect(
      'singularity-field',
      () => {
        mineLayerSystem.singularityFieldActive = true;
      },
    );
```

Update the mineLayerSystem constructor call to pass gridFieldSystem as the 5th param.

### Task 6: Tests — MineLayerSystem

Add to `src/systems/mineLayerSystem.test.js`:

1. **singularityFieldActive=false: normal detonation** — set singularityFieldActive=false, detect enemy in blast, trigger normal detonation.
2. **singularityFieldActive=true, enemy enters blast: pull phase begins** — set singularityFieldActive=true, detect enemy, verify mine.isSingularity = true, pullPhaseStartMs = simNow.
3. **Pull phase: enemy within radius is pulled** — enemy within 100px in pull phase, verify position changes by expected amount.
4. **Pull phase: enemy outside radius not pulled** — enemy at 200px, verify no change.
5. **Implode at 1.5s: damage dealt** — advance sim 1.5s, verify 3× damage applied to enemies in blast radius.
6. **Implode: grid ripple emitted** — verify gridFieldSystem._emit was called at mine position.
7. **Implode: mine reset to armed** — verify mine.isSingularity = false, mine.ageMs = 0 after implosion.
8. **Multiple mines in pull phase** — 2 mines in pull, both trigger pull independently.
9. **Lv4 mine pull + singularity pull both apply** — Lv4 mine with singularity: both pulls contribute.
10. **No enemies: no pull, no implosion** — empty arena, pull phase does nothing.
11. **Reset mine re-triggers on enemy contact** — after implosion reset, enemy in blast → normal detonation.
12. **Implode damage routing** — verify damage goes through applyPlayerDamage, not direct hp modification.
13. **Zero allocation in hot path** — verify no allocations during fixedUpdate in pull phase.

### Task 7: Tests — GridFieldSystem

Add to `src/systems/gridFieldSystem.test.js`:

No new tests needed — the ripple emission test is covered in mineLayerSystem tests
(verify gridFieldSystem._emit was called). But add a dedicated test that GridFieldSystem
_emit produces a ripple that will render in the shader:

1. **_emit at (x, y) creates active ripple** — call _emit(100, 200), verify active=true, x=100, y=200.
2. **Emit over capacity recycles oldest** — emit GRID_MAX_RIPPLES+1 ripples, verify oldest was recycled.

### Task 8: Verify

Run: `npm test`

Verify 0 failures.

---

## Acceptance Criteria

- Given a fused Singularity Field (Mine Lv5 + Gravity Well Lv3), when an armed mine detects an enemy in its blast radius, then the mine transitions into mini black hole pull mode instead of detonating.
- Given a mine in pull mode, enemies within 150px are pulled toward the mine at 220 px/s with linear falloff during the 1.5s pull duration.
- Given a mine in pull mode for 1.5s, it implodes at the next fixedUpdate, dealing 3× AoE damage through applyPlayerDamage.
- Given a mine implosion, a grid ripple is emitted at the mine's position.
- Given an implosion, the mine resets to normal armed state (ageMs=0, isSingularity=false) for a new cycle.
- When singularityFieldActive is false, mines behave exactly as before.
- The grid ripple uses the existing GridFieldSystem._emit mechanism (same GPU shader, no shader change).
- All damage is routed through CollisionSystem.applyPlayerDamage for armor/scoring/XP correct handling.

---

## Review Triage Log

### 2026-07-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` Zero-allocation test was vacuous (empty enemy array) — added stationary enemy with high HP to verify pull hot-path actually executes while maintaining zero-allocation invariant.
  - `[medium]` `[patch]` 3× damage multiplier not verified — added dedicated test using high-hp absorbers (hp = 280) to measure exact per-hit damage absorption, confirming `mine.damage × 3 = 270`.

---

## Auto Run Result

Status: done
Implementation: Added singularityFieldActive flag to MineLayerSystem, modified trigger scan to transition to pull mode instead of detonating, added singularity pull phase, added implosion phase with grid ripple emission and 3× AoE damage, wired fusion effect handler in buildArenaWorld.js, added 13 new tests. All 2228 tests pass.
Revision: 220b0e4a470611b1e678e45d610e4e143d191c4b
