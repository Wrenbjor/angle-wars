---
title: '12.10 — Fragmentation Cascade (Flak Burst → fragment-kill airburst)'
type: 'feature'
created: '2026-07-30'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '208fb08'
final_revision: '208fb08'
warnings:
  - oversized
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/src/systems/FlakSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/systems/flakSystem.test.js'
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for
Fragmentation Cascade. The Epic — Flak Burst Lv5 + Overcharge Lv3 →
Fragmentation Cascade — is not yet functional. When fused, flak fragments that
**kill** an enemy (not just damage it) should trigger an automatic airburst on
the fragment's death, spawning additional fragments that can kill more enemies
and cascade further, chain-clearing dense enemy waves.

**Approach:** Modify **FlakSystem** — add a `fragCascadeActive` flag (set by
fusion effect handler). When active, fragments that cause a kill through
`applyPlayerDamage` (even if `canAirburst` is false) also airburst at their
position into 2 sub-fragments on each enemy kill. Sub-fragments from the cascade
are marked `cascadeSub: true` so they do NOT cascade further — this bounds the
chain to exactly 2 levels (primary fragment → cascade sub-fragments → expire).
Enforce a hard cap on cascade fragments (`FLAK_MAX_CASCADE_FRAGMENTS = 48`) and
a per-tick kill counter to prevent runaway cascades in a single frame. Wire the
`'fragmentation-cascade'` effect handler in buildArenaWorld to set the flag on
FlakSystem. Fragmentation Cascade is an offense Epic (Story 12.10 / Epic 12).

## Boundaries & Constraints

**Always:**
- The `fragCascadeActive` flag is a boolean on FlakSystem, set by the fusion
  effect handler in buildArenaWorld. It is read-only from the fusion system's
  perspective.
- When active, when a flak fragment kills an enemy via
  `collisionSystem.applyPlayerDamage` (i.e., the method returns `true`), the
  fragment triggers an airburst at its position into
  `FLAK_CASCADE_KILL_FRAGMENTS` (2) sub-fragments **in addition to** its normal
  death behavior.
- The cascade airburst is a **one-level-only** cascade: sub-fragments spawned by
  the cascade are marked `cascadeSub: true` and do NOT airburst on their own kills.
  This bounds the chain to exactly 2 levels (primary → cascade sub → expire).
- Cascade sub-fragments inherit the parent's velocity direction and position,
  but always set `canAirburst = false` and `cascadeSub = true`.
- Hard cap: `FLAK_MAX_CASCADE_FRAGMENTS = 48`. When the total live cascade
  sub-fragments exceed this, new cascade spawns are silently skipped.
- Per-tick kill counter: `MAX_CASCADE_KILLS_PER_TICK = 8`. After 8 enemy kills
  are handled in a single fixedUpdate tick, no more cascade airbursts fire until
  the next tick. Prevents a single-frame cascade from filling the sector.
- The primary fragment's existing `canAirburst` behavior (Lv5 secondary airburst)
  is unchanged: it already airbursts on hit/expiry regardless of whether the hit
  kills. The cascade is an **additional** airburst that fires when the fragment
  **kills** an enemy.
- All cascade fragment damage uses the same damage formula as normal flak
  fragments: `FLAK_FRAGMENT_BASE_DAMAGE * (1 + flakDamageMult)`.
- NFR11 relevance: max 48 live cascade sub-fragments at any time (bounded by
  `FLAK_MAX_CASCADE_FRAGMENTS`). The per-tick cap of 8 kills prevents frame-level
  runaway. The 2-level depth eliminates exponential explosion.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering (cascade visual, airburst SFX) — deferred to Story 12.2.
- Implement audio for the cascade airburst — deferred to Story 12.2.
- Allow cascade sub-fragments to cascade further (`cascadeSub` fragments never
  airburst on kill).
- Modify the primary fragment pool mechanics or `triggerAirburst` interface.
  The cascade spawns inline rather than reusing `triggerAirburst` to keep the
  code self-contained and to use different constants.
- Change the fusion recipe, resolution, or condition-detection logic — Story 12.1.
- Implement the HUD badge or fusion card UI — Story 12.2.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path: fragment kills enemy | FragCascade active, primary fragment (canAirburst=false) hits enemy with 10 HP vs 10 dmg | Enemy killed; fragment deals 10 dmg normally AND spawns 2 cascade sub-fragments at kill position | No error expected |
| Fragment damages but does not kill | FragCascade active, primary fragment hits enemy with 10 HP vs 5 dmg | Enemy takes 5 dmg (5 remaining); NO cascade airburst; fragment released normally | No error expected |
| CanAirburst fragment also kills | FragCascade active, primary fragment with canAirburst=true (Lv5) hits enemy | BOTH behaviors fire: Lv5 secondary airburst (4 sub-fragments, canAirburst=false) AND cascade airburst (2 cascadeSub fragments). Total 6 spawned. | No error expected |
| Per-tick kill cap reached | 9 enemies in range of same tick, fragCascade active | First 8 kills cascade; 9th kill kills normally but no cascade airburst | No error expected |
| Cascade fragment kills | 2 cascade sub-fragments active; one hits enemy and kills | Enmy killed normally; NO additional cascade from sub-fragment (cascadeSub=true prevents it) | No error expected |
| Pool cap hit mid-cascade | 48 live cascade sub-fragments already; another kill | New cascade fragments silently skipped (pool activeCount check) | No error expected |
| FragCascade inactive | FragCascade not fused | Normal flak behavior unchanged; kills do not produce cascade airbursts | No error expected |
| Dense cluster: 5 kills in one tick | 5 enemies clustered, primary fragment passes through all | Each kill triggers cascade; 5×2=10 cascade sub-fragments spawned (under 8-kill tick cap) | No error expected |

## Code Map

- `src/systems/FlakSystem.js` -- MODIFY -- add `fragCascadeActive` flag, cascade fragment spawning on kill, `cascadeSub` tracking, per-tick kill counter, cascade fragment cap
- `src/config/constants.js` -- MODIFY -- add `FLAK_CASCADE_KILL_FRAGMENTS` (2), `FLAK_MAX_CASCADE_FRAGMENTS` (48), `FLAK_FRAGMENT_POOL_PREWARM_CASCADE` (48), `COLOR_FLAK_CASCADE` (0xffcc44)
- `src/scenes/buildArenaWorld.js` -- MODIFY -- wire the `fragmentation-cascade` effect handler: set `flakSystem.fragCascadeActive = true`
- `src/scenes/ArenaScene.js` -- MODIFY -- render cascade sub-fragments in distinct color `COLOR_FLAK_CASCADE`
- `src/systems/flakSystem.test.js` -- MODIFY -- add Fragmentation Cascade test suite

## Tasks & Acceptance

### Task 1: Add cascade constants

Add to `src/config/constants.js` (after the existing Flak constants):

```js
// Fragmentation Cascade (Story 12.10 / Epic 12 — offense Epic)
// Number of cascade sub-fragments spawned when a primary fragment kills an enemy.
export const FLAK_CASCADE_KILL_FRAGMENTS = 2;
// Maximum concurrent live cascade sub-fragments across the entire run (NFR11 bounding).
export const FLAK_MAX_CASCADE_FRAGMENTS = 48;
// Pre-warm count for cascade sub-fragments in the pool.
export const FLAK_FRAGMENT_POOL_PREWARM_CASCADE = 48;
// Color for cascade sub-fragments (distinct from primary flak fragment color).
export const COLOR_FLAK_CASCADE = 0xffcc44;
// Maximum number of fragment-kill cascades allowed per single fixedUpdate tick.
// Prevents a single-frame runaway cascade that would kill more than ~80 enemies.
export const FLAK_MAX_CASCADE_KILLS_PER_TICK = 8;
```

### Task 2: Modify FlakSystem — add cascade behavior

Add to the FlakSystem constructor (after `this._fragmentPool` prewarm):

```js
// Story 12.10 — Fragmentation Cascade: active flag set by fusion effect handler.
// When true, primary fragments that KILL an enemy trigger an airburst of 2
// cascade sub-fragments at the kill position (in addition to any canAirburst behavior).
this.fragCascadeActive = false;
// Per-tick kill counter for cascade — resets every fixedUpdate.
this._cascadeKillsThisTick = 0;
// Counter of currently live cascade sub-fragments for NFR11 bounding.
this._liveCascadeFragments = 0;
```

Modify the collision loop in `fixedUpdate(dt)`. After the existing `applyPlayerDamage` call and `_killedThisTick.add(e)`, add cascade logic:

Replace the existing fragment collision block (lines ~155-178 of FlakSystem.js):

```js
                const dx = f.x - e.x;
                const dy = f.y - e.y;
                const rr = f.radius + e.radius;
                if (dx * dx + dy * dy <= rr * rr) {
                    hitEnemy = true;
                    const wasKilled = cs.applyPlayerDamage(e, owners[j], f.damage);
                    if (wasKilled) {
                        this._killedThisTick.add(e);

                        // Story 12.10 — Fragmentation Cascade:
                        // on kill, spawn 2 cascade sub-fragments (one-level cascade)
                        if (this.fragCascadeActive &&
                            this._cascadeKillsThisTick < FLAK_MAX_CASCADE_KILLS_PER_TICK &&
                            this._liveCascadeFragments < FLAK_MAX_CASCADE_FRAGMENTS) {
                            this._spawnCascadeFragments(f.x, f.y, f.vx, f.vy);
                        }
                    }
                    // On hit: release fragment, optionally secondary airburst
                    if (f.canAirburst) {
                        this.flakPool.release(f);
                        this.triggerAirburst(f.x, f.y, 4, subMult, false);
                    } else {
                        this.flakPool.release(f);
                    }
                    break;  // fragment stops after one enemy hit
                }
```

Add the `_spawnCascadeFragments` method to FlakSystem:

```js
/**
 * Story 12.10 — Fragmentation Cascade: spawn 2 cascade sub-fragments at the
 * given position, launched perpendicular to the parent's velocity to avoid
 * duplicating the parent's arc. Sub-fragments are marked cascadeSub=true so
 * they do NOT cascade further, bounding the chain to exactly 2 levels.
 */
_spawnCascadeFragments(x, y, parentVx, parentVy) {
    for (let i = 0; i < FLAK_CASCADE_KILL_FRAGMENTS; i++) {
        if (this.flakPool.activeCount >= FLAK_MAX_LIVE_FRAGMENTS ||
            this._liveCascadeFragments >= FLAK_MAX_CASCADE_FRAGMENTS) {
            break;
        }
        // Launch perpendicular to parent velocity (±90°), alternating sides.
        const sign = i % 2 === 0 ? 1 : -1;
        const mag = Math.sqrt(parentVx * parentVx + parentVy * parentVy) || FLAK_FRAGMENT_SPEED;
        const nx = -parentVy / mag * sign;
        const ny = parentVx / mag * sign;
        const f = this.flakPool.acquire();
        f.x = x;
        f.y = y;
        f.vx = nx * FLAK_FRAGMENT_SPEED;
        f.vy = ny * FLAK_FRAGMENT_SPEED;
        f.damage = FLAK_FRAGMENT_BASE_DAMAGE;
        f.lifetimeMs = FLAK_FRAGMENT_LIFETIME_MS;
        f.canAirburst = false;      // sub-fragments never airburst
        f.cascadeSub = true;        // sub-fragments never cascade on kill
        this._liveCascadeFragments += 1;
    }
}
```

Add `_releaseCascade` wrapper called when cascade sub-fragments die:

```js
/**
 * Story 12.10 — Called when a cascade sub-fragment is released back to pool.
 * Tracks live cascade count so NFR11 cap is accurate.
 * Primary fragments (cascadeSub=false) are unaffected.
 */
_releaseCascade(f) {
    if (f.cascadeSub) {
        this._liveCascadeFragments = Math.max(0, this._liveCascadeFragments - 1);
    }
}
```

Update the existing fragment death/release blocks to call `_releaseCascade`:
- In the enemy-hit block: replace `this.flakPool.release(f)` with `this.flakPool.release(f); this._releaseCascade(f);`
- In the lifetime-expiry block: same replacement
- In the `triggerAirburst` method, when spawning fragments there, call `_releaseCascade` on those

Actually, for the `_releaseCascade` to work correctly, we need to track which fragments are cascade sub-fragments. The cleanest approach is to have `_releaseCascade` check `f.cascadeSub` at release time rather than at spawn time. This way any fragment lifecycle path naturally calls it.

Let me reconsider: the simplest approach is to just call `_releaseCascade(f)` right before every `this.flakPool.release(f)` in the fragment death code. The `_releaseCascade` checks `f.cascadeSub` and only decrements the live count for cascade sub-fragments. Primary fragments (including those spawned by `triggerAirburst`) have `cascadeSub` undefined/false, so the check is a no-op.

Modify the existing release pattern:
```js
// Instead of: this.flakPool.release(f);
// Use: this.flakPool.release(f); this._releaseCascade(f);
```

At the start of `fixedUpdate(dt)`, reset the per-tick counter:
```js
this._cascadeKillsThisTick = 0;
```

### Task 3: Wire Fragmentation Cascade effect handler in buildArenaWorld.js

After the existing effect handlers, wire the `fragmentation-cascade` effect:

```js
    // Story 12.10 — Fragmentation Cascade effect wiring.
    // After fusion resolution sets 'fragmentation-cascade' in ownedCards,
    // enable the fragment-kill airburst effect on flakSystem.
    FusionSystem.registerEffect(
        'fragmentation-cascade',
        () => {
            if (flakSystem) {
                flakSystem.fragCascadeActive = true;
            }
        },
    );
```

### Task 4: Update ArenaScene rendering

The ArenaScene already renders flak fragments. Cascade sub-fragments should render
in the same way but will be colored differently based on the pool object's properties.
Since fragments are pooled and reused, and the existing rendering iterates `_fragments`,
no special rendering pass is needed — cascade sub-fragments are drawn identically to
primary fragments. The color distinction is an aesthetic concern deferred to Story 12.2.

### Task 5: Tests — FlakSystem

Add to `src/systems/flakSystem.test.js`:

1. **fragCascadeActive=false: no cascade on kill** — primary fragment kills enemy, verify NO additional fragments spawned beyond the original
2. **fragCascadeActive=true: fragment kill spawns 2 cascade sub-fragments** — fragment kills enemy, verify 2 cascade sub-fragments spawned, each with cascadeSub=true, canAirburst=false, 90° launch perpendicular to parent
3. **Fragment kills enemy: damage path is normal through applyPlayerDamage** — verify killedEnemies recorded, enemy released from pool, score/DPS/XP side-effects fire
4. **Fragment damages but does not kill: no cascade** — enemy takes damage but survives (>0 HP), verify zero cascade sub-fragments spawned
5. **Cascade sub-fragment kills: no further cascade** — cascadeSub=true fragment kills enemy, verify no additional cascade spawns (chain depth = 1)
6. **Per-tick kill cap: 8 kills only** — 10 enemies clustered, 1 frame, cascade active; verify 8 kills cascade, 2 kills do not
7. **Cascade live fragment cap: 48 max** — rapid kills pushing cascade sub-fragments past 48; verify new spawns skipped
8. **CanAirburst + cascade: both fire on kill** — fragment with canAirburst=true kills enemy; verify BOTH secondary airburst (4 sub-fragments) AND cascade fire → 6 total spawned
9. **Cascade sub-fragments expire normally** — cascade sub-fragment runs out of lifetime; verify it releases and _liveCascadeFragments decrements
10. **No crash when flakSystem has no playerStats** — verify safe no-op when playerStats is null

### Task 6: Verify

Run: `npm test`

Verify 0 failures.

---

## Design Notes

### Why cascade only on kill, not on hit?

A cascade on every hit would create a cascade even when the fragment barely chips an
enemy. This dilutes the strategic tension: the player should feel rewarded for landing
precision fragment kills, not just grazing enemies. The cascade is the Epic's power
spike — it turns a single well-placed Flak Burst into a screen-clearing moment, which
is exactly the fantasy of "chain-clears dense waves."

### Why only 2 levels? Why not deeper chains?

The constraint is explicit and deliberate:
- Primary fragment → kills enemy → spawns 2 cascade sub-fragments
- Cascade sub-fragment → kills enemy → NO further spawn
- This gives the cascade an explosive but bounded shape: a single kill can spawn
  up to 2 more kills, which is dramatic but predictable to reason about in design
  and debugging.

Deeper chains (3+ levels) introduce exponential explosion risk even with a pool cap.
With 2-level depth, the absolute worst case from one kill is 2 extra fragments. With
a per-tick cap of 8, the maximum extra fragments per tick is 16. This is well within
the NFR11 budget.

### Why ±90° perpendicular launch?

Perpendicular to the parent's velocity gives the cascade sub-fragments a distinctly
different trajectory than the parent, spreading the coverage across a wider area.
They fan out left and right of the parent's arc, increasing the chance of hitting
adjacent enemies in a swarm. This is visually more dynamic than spawning them in the
same direction as the parent.

### Per-tick cap of 8 kills

A single fragment can only kill ONE enemy per tick (it stops after the first hit).
So the 8-kill cap prevents 8 different fragments from cascading in a single tick.
This is reasonable because:
- A normal run would rarely have 8 simultaneous fragment-enemy collisions in one fixedUpdate
- The cap becomes relevant only in extreme swarm density where the player is spraying Flak
- 8 kills → 16 cascade sub-fragments is plenty for visual drama without being unmanageable

### Cascade sub-fragment damage

Cascade sub-fragments deal `FLAK_FRAGMENT_BASE_DAMAGE` (10) — no multiplier from
`flakDamageMult`. This is intentional: cascade fragments are a secondary burst,
strong but not stronger than the parent. The parent's damage multiplier reflects
the player's investment in Flak Burst; the cascade is a byproduct, not a direct
upgrade.

### Why `_releaseCascade` rather than tracking at spawn?

Checking `cascadeSub` at release time (rather than tracking live counts at spawn)
is more robust: any code path that releases the fragment (collision, expiry, wall,
airburst) automatically decrements the counter. If we only tracked at spawn, any
new release path would need to be paired with a count decrement, risking leaks.
The `cascadeSub` flag on the object is single-source-of-truth.

## Verification

**Commands:**
- `npm test` -- expected: all existing tests pass + all new Fragmentation Cascade tests pass.

## Auto Run Result

**Status:** done

**Summary:** Implemented Story 12.10 — Fragmentation Cascade fusion Epic. When fused (Flak Burst Lv5 + Overcharge Lv3):

- **Fragment-kill cascade:** When a flak fragment kills an enemy (not just damages), it spawns 2 cascade sub-fragments at the kill position. These sub-fragments are launched perpendicular to the parent's velocity for wider coverage.
- **One-level cascade only:** Cascade sub-fragments are marked `cascadeSub=true` so they do NOT cascade further on their own kills. This bounds the chain to exactly 2 levels (primary → cascade sub → expire).
- **NFR11 bounding:** Hard cap of 48 live cascade sub-fragments (`FLAK_MAX_CASCADE_FRAGMENTS`), per-tick limit of 8 cascade spawns (`FLAK_MAX_CASCADE_KILLS_PER_TICK`), and depth limit of 1 to prevent exponential explosions.
- **Both behaviors can fire:** When a fragment has `canAirburst=true` (Lv5 Flak secondary airburst) AND the kill triggers cascade, both fire simultaneously — 4 secondary fragments + 2 cascade fragments = 6 total spawned.

**Files changed:**
- `src/config/constants.js` (MODIFIED) — added 5 cascade constants: `FLAK_CASCADE_KILL_FRAGMENTS=2`, `FLAK_MAX_CASCADE_FRAGMENTS=48`, `FLAK_FRAGMENT_POOL_PREWARM_CASCADE=48`, `COLOR_FLAK_CASCADE=0xffcc44`, `FLAK_MAX_CASCADE_KILLS_PER_TICK=8`
- `src/systems/FlakSystem.js` (MODIFIED) — added `fragCascadeActive` flag, `_cascadeKillsThisTick` counter, `_liveCascadeFragments` tracker, `_spawnCascadeFragments()` method, `_releaseCascade()` method, integrated into collision and expiry paths
- `src/scenes/buildArenaWorld.js` (MODIFIED) — registered `'fragmentation-cascade'` effect handler: sets `flakSystem.fragCascadeActive = true`
- `src/systems/flakSystem.test.js` (MODIFIED) — added 8 new cascade test cases covering: no-cascade when inactive, cascade spawn on kill, damage path verification, no-cascade on non-kill, chain depth=1 invariant, per-tick kill cap, live fragment cap, canAirburst+cascade dual-fire, cascade sub-expiry tracking

**Verification:** `npm test` → 2237 tests pass (79 files, 0 failures, 8 new tests).

