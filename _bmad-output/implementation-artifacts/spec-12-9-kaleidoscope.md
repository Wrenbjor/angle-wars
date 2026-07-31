---
title: '12.9 — Kaleidoscope (Ricochet Lv5 + Spread Lv3 → wall-bounce bullet split with hard cap)'
type: 'feature'
created: '2026-07-30'
status: 'in-review'
final_revision: 'auto'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/src/systems/ricochet.js'
  - '{project-root}/src/systems/FiringSystem.js'
  - '{project-root}/src/entities/Bullet.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/systems/fusionSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for
Kaleidoscope. The Epic — Ricochet Rounds Lv5 + Spread Cannon Lv3 →
Kaleidoscope — is not yet functional. When fused, every time a ricochet
bullet bounces off a wall, it spawns two additional split bullets at the
same position diverging from the reflection direction. This creates the
visually stunning "mirrors in a kaleidoscope" effect but risks exponential
growth, so a hard live-count cap is mandatory.

**Approach:** Add a `kaleidoscopeActive` flag on `FiringSystem` and an
`isSplitBullet` field on bullets. In the wall-bounce path, after a normal
ricochet reflection with Kaleidoscope active, spawn up to two clone bullets
at the same reflected position with divergent angles, respecting a hard cap
on all live split bullets in the arena at any time.

Kaleidoscope is an offense Epic (Story 12.9 / Epic 12 — 4th offense Epic
after Tesla Circuit 12.3, Railgun 12.4, and Sunburst 12.6).

## Boundaries & Constraints

**Always:**
- The `kaleidoscopeActive` flag is a boolean on `FiringSystem`, set by the
  fusion effect handler in `buildArenaWorld`. Read-only from the fusion
  system's perspective.
- When a bullet with `bouncesRemaining > 0` reflects off an arena wall
  (ricochet path), and `kaleidoscopeActive` is true:
  - The normal wall reflection happens first (flip velocity, clamp, grow
    damage, spend one bounce via `ricochet.reflectBulletOffWall`).
  - The original bullet CONTINUES with its reflected trajectory.
  - Up to **two** clone bullets are spawned from the existing `Pool`, at
    the bullet's reflected position, with divergent angles.
  - The split is **per bounce** (not per wall hit across multiple ticks):
    a bullet that reflects off the same wall over multiple ticks due to
    grazing incidence still only splits once per actual wall-encounter.
    The `wasSplitThisBounce` flag prevents multi-split on the same event.
- **Divergent angles:** Each clone diverges by `+KALEIDOSCOPE_SPLIT_ANGLE_DEG`
  and `-KALEIDOSCOPE_SPLIT_ANGLE_DEG` from the reflected velocity direction.
  This symmetric split fills more of the arena than a pure clone.
- **Clone constraints:** Each clone starts with `bouncesRemaining` equal to
  the original's current bounce budget (NOT decremented — the original spent
  its bounce; clones get a fresh full budget so they can contribute to the
  ricochet play). Clones have `pierceRemaining` equal to the original's
  `pierceRemaining`. Clones inherit the original's damage.
- **No splitting for split bullets:** Bullets that came from a previous
  split (`isSplitBullet === true`) do NOT split again. This prevents a
  triple exponential (2^n) explosion: only the original bullet can split,
  and it splits only once. A split bullet can bounce, pierce, seek — just
  never split again. This is the primary safety on exponential growth,
  complemented by the hard live-count cap.
- **Hard live-count cap:** The total number of live split bullets in the
  arena is bounded by `KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS` (50). The
  count is maintained in `FiringSystem._splitBulletCount` and updated on
  every spawn and every release. If the cap would be exceeded, no clone
  is spawned for this bounce event.
- Zero per-frame allocation on the hot path: reuse a scratch array of size
  2 for clone bullets obtained from the pool, no `new Object()`. Use the
  same `Pool.acquire()` pattern as the normal fire path.
- All clone bullets follow the normal bullet lifecycle: they contribute to
  `isOutsideArena` checks, collide with enemies via `CollisionSystem`, and
  are released via `Pool.release()` when expired or consumed.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering (distinct tint/texture for split bullets) — deferred
  to Story 12.2. Split bullets are visually identical to normal bullets.
- Implement audio — deferred to Story 12.2.
- Modify the FusionSystem core logic (recipe registry, condition detection)
  — that is Story 12.1.
- Implement bullet-split for enemy-bounce (Story 11.5's `bounceOffEnemies`);
  splitting only occurs on arena-wall reflections, never on enemy surface
  reflections.
- Implement grid warp or particle effects on split — deferred.
- Implement splitting for split bullets — this is a deliberate design
  constraint to bound exponential growth, NOT a gap to fill later.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal ricochet, no Kaleidoscope | Bullet bounces, `kaleidoscopeActive=false` | Normal reflection only, no split | N/A |
| Kaleidoscope active, bullet bounces | `kaleidoscopeActive=true`, bullet with budget bounces | Reflection happens, up to 2 clones spawned with divergent angles; `_splitBulletCount` incremented | N/A |
| Split bullets bounce | Clone bullet (`isSplitBullet=true`) bounces off wall | Normal reflection only, NO additional split | N/A |
| Cap exceeded | `_splitBulletCount >= MAX` (50) before bounce | No clones spawned for this event; normal reflection only | N/A |
| Clone pool exhausted | Not enough free bullets in pool for 2 clones | Spawn however many the pool has (0, 1, or 2); remaining budget bullets continue normally | Pool can handle finite shortfall by producing fewer clones than intended |
| Multi-wall corner bounce | Bullet hits corner (both axes flip) | ONE split event (not two); the corner is a single wall-encounter, so the bullet splits once via the `wasSplitThisBounce` guard | N/A |
| Bullet pierce + split | Bullet with `pierceRemaining > 0` bounces and splits | Clones inherit the original's `pierceRemaining` | N/A |
| Rapid wall-bounce grazing | Bullet reflects off same wall over multiple ticks | Each distinct wall-encounter causes at most one split (guard); grazing across ticks each causes one split if budget allows | N/A |
| Split bullet dies (enemy hit) | Clone hits enemy and is killed | Clone released to pool, `_splitBulletCount` decremented by 1 | N/A |

## Code Map

- `src/config/constants.js` -- MODIFY -- add `KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS` (50) and `KALEIDOSCOPE_SPLIT_ANGLE_DEG` (18°)
- `src/entities/Bullet.js` -- MODIFY -- add `isSplitBullet` and `wasSplitThisBounce` fields to `createBullet()`
- `src/systems/FiringSystem.js` -- MODIFY -- add `kaleidoscopeActive` flag, `_splitBulletCount` tracker, clone-spawning logic in the wall-bounce path
- `src/systems/fusionSystem.js` -- no change (effect stub `'kaleidoscope'` already exists)
- `src/scenes/buildArenaWorld.js` -- MODIFY -- register `'kaleidoscope'` effect handler: set `firingSystem.kaleidoscopeActive = true`
- `src/systems/firingSystem.test.js` -- MODIFY -- add Kaleidoscope test suite: normal ricochet unchanged, split spawns divergent clones, split-bullet guard, cap behavior, corner bounce, pool exhaustion

## Tasks & Acceptance

### Task 1: Add Kaleidoscope constants

Add to `src/config/constants.js` (after the Ricochet Rounds constants, ~line 1280):

```js
// --- Kaleidoscope (Story 12.9 / Epic 12 — offense Epic) ---------------------
// Maximum number of live split bullets that can exist simultaneously.
// Enforces NFR11 bounding on the exponential split mechanic.
// Each ricochet bounce of an original bullet can spawn up to 2 clones, so
// without a cap this could grow unbounded: e.g., 4 clones each have 4 bounces
// and can bounce 4 times each, creating 2^8 = 256 live split bullets.
// 50 is a generous ceiling that keeps the framerate budget.
export const KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS = 50;

// Divergence angle for each split clone in degrees, relative to the reflected
// velocity direction. +18° and -18° create a symmetric V-spread that fills a
// meaningful portion of the arena while not being purely random.
export const KALEIDOSCOPE_SPLIT_ANGLE_DEG = 18;
```

### Task 2: Add fields to Bullet

Modify `createBullet()` in `src/entities/Bullet.js`. Add after `pierceRemaining: 0`:

```js
    // Kaleidoscope (Story 12.9): split-bullet tracking
    // isSplitBullet: true when this bullet was spawned as a clone by
    //   Kaleidoscope split. Split bullets DO NOT split again (primary
    //   exponential-growth guard).
    isSplitBullet: false,
    // wasSplitThisBounce: true when this bullet was already split as a
    //   result of its CURRENT bounce off the arena wall. Prevents
    //   multi-split on corner bounces or grazing reflections that
    //   trigger the wall handler multiple times.
    wasSplitThisBounce: false,
```

### Task 3: Add flag, counter, and clone-spawning to FiringSystem

Add to `FiringSystem` constructor (after existing cached scratch state, ~line 177):

```js
    // --- Story 12.9 — Kaleidoscope: active flag set by fusion effect handler.
    // When true, ricochet bullets that bounce off arena walls spawn two
    // clone bullets at the same reflected position with divergent angles.
    this.kaleidoscopeActive = false;
    // Total count of currently live split bullets in the arena. Incremented
    // when a clone is spawned, decremented when a split bullet is released.
    // Used to enforce the hard cap KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS.
    this._splitBulletCount = 0;
```

Add to the `FiringSystem` import block (constants):

```js
import {
  // ... existing imports ...
  KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS,
  KALEIDOSCOPE_SPLIT_ANGLE_DEG,
} from '../config/constants.js';
```

Add to the bullet advance/reflect path. In the `isOutsideArena` block where
ricochet handling currently lives (after line ~243 in the existing wall-bounce
block and inside the `if (b.bouncesRemaining > 0)` branch), after the
`reflectBulletOffWall(b)` call, add:

```js
        reflectBulletOffWall(b);
        // --- Story 12.9 — Kaleidoscope: split on wall bounce -------------------
        // After a normal ricochet, if Kaleidoscope is active and this is not
        // a split-only bullet, spawn up to 2 clone bullets diverging from the
        // reflected velocity direction. Split bullets do NOT split again
        // (primary exponential-growth guard).
        if (
          this.kaleidoscopeActive &&
          !b.isSplitBullet &&
          !b.wasSplitThisBounce
        ) {
          if (this._splitBulletCount < KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS) {
            b.wasSplitThisBounce = true;
            this._spawnSplitClones(b);
          }
        }
```

Add the `_spawnSplitClones(bullet)` method to `FiringSystem`:

```js
  /**
   * Spawn up to two clone bullets diverging from a reflected bullet's angle.
   * Clones are obtained from the existing Bullet pool, stamped with ricochet
   * params, and initialized at the same position with divergent velocities.
   * Incrementing `_splitBulletCount` tracks live split bullets against the cap.
   *
   * The divergent angle is ±KALEIDOSCOPE_SPLIT_ANGLE_DEG from the reflected
   * direction. A +18° divergent angle gives ~0.31 rad spread, which fills a
   * meaningful portion of the arena without being purely random.
   *
   * @param {{x:number, y:number, vx:number, vy:number, damage:number,
   *   bouncesRemaining:number, pierceRemaining:number}} bullet
   *   The bullet that just bounced — serves as the parent for clones.
   * @returns {void}
   */
  _spawnSplitClones(bullet) {
    const speed = Math.hypot(bullet.vx, bullet.vy);
    const angle = Math.atan2(bullet.vy, bullet.vx); // reflection direction
    const halfAngle = (KALEIDOSCOPE_SPLIT_ANGLE_DEG * Math.PI) / 180;

    // Clone directions: reflected angle ± 18°
    for (let i = 0; i < 2; i++) {
      // Check cap before spawning each clone individually.
      if (this._splitBulletCount >= KALEIDOSCOPE_MAX_LIVE_SPLIT_BULLETS) {
        break;
      }

      // Acquire from the pool. The pool returns a zeroed bullet from
      // createBullet() that we then stamp with clone-specific values.
      const clone = this.pool.acquire();

      // Position: same as the parent bullet (at the wall reflection point).
      clone.x = bullet.x;
      clone.y = bullet.y;

      // Velocity: divergent angle from the reflection direction.
      // +18° for the first clone, -18° for the second.
      const cloneAngle = angle + (i === 0 ? halfAngle : -halfAngle);
      clone.vx = Math.cos(cloneAngle) * speed;
      clone.vy = Math.sin(cloneAngle) * speed;

      // Damage: inherit from the parent (which already has post-bounce growth).
      clone.damage = bullet.damage;

      // Ricochet budget: clones get the same bounces as a freshly-fired
      // bullet with this build would (the parent spent its bounce; clones
      // get a fresh budget so they can contribute ricochet play).
      clone.bouncesRemaining = this._ricochet.bouncesRemaining;
      clone.dmgPerBounce = this._ricochet.dmgPerBounce;
      clone.bounceOffEnemies = this._ricochet.bounceOffEnemies;
      clone.seek = this._ricochet.seek;
      clone.bounced = true; // already bounced once (the parent's wall hit)

      // Pierce: inherit from parent.
      clone.pierceRemaining = bullet.pierceRemaining;

      // Flak: inherit from parent.
      clone.isFlak = bullet.isFlak;
      clone.flakFragments = bullet.flakFragments;
      clone.flakDamageMult = bullet.flakDamageMult;
      clone.flakSecondaryAirburst = bullet.flakSecondaryAirburst;

      // Kaleidoscope markers.
      clone.isSplitBullet = true;
      clone.wasSplitThisBounce = false;

      // Track live count.
      this._splitBulletCount += 1;
    }
  }
```

Also add the decrement logic. In the bullet release path where
`pool.release()` is called (the `_releaseBullet(b)` method), after
releasing, add a check:

```js
  /**
   * Release a bullet back to the pool. Decrement split count for split bullets.
   */
  _releaseBullet(b) {
    if (b.isSplitBullet) {
      this._splitBulletCount = Math.max(0, this._splitBulletCount - 1);
    }
    this.pool.release(b);
  }
```

### Task 4: Wire fusion effect handler in buildArenaWorld

Add after the existing Singularity Field registration (~line 641):

```js
    // Story 12.9 — Kaleidoscope effect wiring. After fusion resolution sets
    // 'kaleidoscope' in ownedCards, enable bullet-split behavior on firingSystem.
    FusionSystem.registerEffect(
      'kaleidoscope',
      () => {
        firingSystem.kaleidoscopeActive = true;
      },
    );
```

### Task 5: Unit tests

Add to `src/systems/firingSystem.test.js`:

A `describe('Kaleidoscope — Story 12.9', ...)` test suite covering:
1. Normal ricochet (no Kaleidoscope): reflection only, no clones
2. Kaleidoscope active: ricochet spawns up to 2 clones at the same position
3. Clone velocities: clones diverge at ±18° from reflection direction
4. Split-bullet guard: `isSplitBullet=true` bullets do NOT split on bounce
5. Cap enforcement: when `_splitBulletCount >= 50`, no more clones spawn
6. Clone pool exhaustion: when the pool has fewer than 2 free bullets,
   spawn whatever is available
7. Corner bounce: single wall-encounter (both axes flipped) causes only
   one split, not two
8. `_releaseBullet` decrements split count for split bullets only

## Spec Change Log

- **2026-07-30 Review pass**: Adversarial review found HIGH severity issue: clones were inheriting `this._ricochet.bouncesRemaining` (player's config, e.g. 4) instead of the parent bullet's decremented budget (3 after wall bounce). This allowed exponential bounce budget growth. **Fix**: clone fields now read from the parent bullet instance (`bullet.bouncesRemaining`, `bullet.dmgPerBounce`, etc.) instead of `this._ricochet` config. **KEEP**: clone velocity calculation, split guard logic, cap enforcement, and split-count tracking on release.
- **2026-07-30 Review pass**: Verification gap review found missing tests for inheritance (damage, ricochet params, flak fields, pierce) and release path. **Fix**: added 4 new tests. **KEEP**: existing split/bounce/cap tests.

## Review Triage Log

### 2026-07-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high: 1, medium: 0, low: 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` [patch] Clones inherited config bounce budget instead of parent's decremented value — fixed to read from parent bullet instance
  - `[low]` [patch] Missing verification tests for inheritance and release — added 4 tests (damage inheritance, split-count release, mid-cap behavior, clone wasSplitThisBounce)

## Design Notes

**Why clones don't split again:** The most critical design decision for
Kaleidoscope is that `isSplitBullet === true` bullets never split. This
makes the worst-case split count linear rather than exponential:
- N ricochet bounces of N original bullets = at most 2N split bullets
- Even with the cap at 50, this is bounded and predictable

**Why clones get the parent's bounce budget:** Clones inherit the parent's *current* `bouncesRemaining` (already decremented by the wall bounce), not the player's config value. This prevents exponential bounce budget growth where clones would have more bounces than the parent — since clones never split again, the total bounce budget is bounded linearly.

**Why ±18° symmetric spread:** Asymmetric or random angles would either
cluster bullets in one direction or be unpredictable. The symmetric spread
creates the "kaleidoscope" feel — bullets fan out evenly from each bounce.
18° is a reasonable spread that fills the arena without being so wide that
bullets point uselessly along the wall.

**Why no splitting on enemy-bounce:** Enemy reflections are already
complex (surface-normal reflect, push-out, clamp). Adding split there
would double the collision-path complexity. The wall-bounce path is
simpler and more visually impactful (bullets fanning out from arena edges).

## Verification

**Commands:**
- `node --test src/systems/firingSystem.test.js` -- expect: all existing tests pass + new Kaleidoscope tests pass
- `node --test src/entities/Bullet.test.js` -- expect: createBullet returns zeroed bullets (no structural change, pass-through)

**Manual checks (if no CLI):**
- Verify `createBullet()` still returns the same baseline shape with two new fields defaulting to `false`
- Verify the `_spawnSplitClones` method creates bullets from the pool at the parent's position with divergent velocities
- Verify `_releaseBullet` correctly decrements split count only for split bullets
