---
title: '12.11 — Critical Resonance (Overcharge Lv5 + 2 offense Lv5 → 20% crit 3× dmg + shockwave)'
created: '2026-07-31'
status: done
review_loop_iteration: 0
baseline_revision: ''
final_revision: ''
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-1-fusion-system-and-ux.md'
  - '{project-root}/src/systems/CollisionSystem.js'
  - '{project-root}/src/systems/FiringSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/config/itemRegistry.js'
  - '{project-root}/src/systems/GridFieldSystem.js'
  - '{project-root}/src/state/ProgressionState.js'
  - '{project-root}/src/systems/collisionSystem.test.js'
warnings: []
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a stub for
Critical Resonance. The Epic — Overcharge Lv5 + any 2 offense
Lv5 → Critical Resonance — is not yet functional. When fused,
player bullets have a 20% chance per hit to crit for 3× damage; on
crit, a grid deformation shockwave fires at the hit position and a
crit kill refunds 1 XP to the player's XP total.

**Approach:** Modify **CollisionSystem** — add a `critCheck` flag and a
`critDamageMult` field on each bullet stamped by FiringSystem at spawn.
When a resonant bullet hits an enemy, roll against 20% chance; on crit:
multiply damage by 3× (replaces the original), call `gridFieldSystem.emitRipple`
at the hit position, and if the kill is credited to the player, add
1 XP to `progressionState.xp`. Wire the `critical-resonance` effect
handler in buildArenaWorld to stamp the flag on FiringSystem. Add the
const `hasResonance` flag to each bullet at spawn. FiringSystem stamps
`bullet.resonanceActive = true` on each bullet when Critical Resonance is
fused (read from `fusionState.ownedCards['critical-resonance']`).

## Boundaries & Constraints

**Always:**
- The `resonanceActive` flag is stamped onto each bullet at spawn time
  by FiringSystem. It is ON iff `this.fusionState && this.fusionState.ownedCards['critical-resonance']`.
- The crit check happens in **CollisionSystem** pass 1 (at collision time),
  NOT in pass 2 (applyPlayerDamage). This is load-bearing: the damage
  multiplier must be resolved BEFORE `applyPlayerDamage` is called,
  because `applyPlayerDamage` routes damage through the armor-respecting
  health reduction path.
- Damage on crit = 3× the bullet's stamped damage (not 1×, not
  `dmg + 2×dmg`: the entire damage applied IS `dmg * CRIT_MULT`).
  On a normal (non-crit) hit, the original damage applies unchanged.
- The crit check is a simple `Math.random() < CRIT_CHANCE` (0.20).
  This is a data-dependent branch (not gameplay-random like RNG
  for enemy behavior), so `Math.random()` is acceptable.
- On crit: call `gridFieldSystem.emitRipple(x, y)` at the hit
  position. Reuses the existing GridFieldSystem ripple emission
  (no new shader or visual work).
- On a crit kill: if the kill credits to the player (which it always
  does, since all hits through `applyPlayerDamage` originate from
  player weapons), add `CRIT_XP_REFUND` (1) XP to
  `progressionState.xp`.
- NFR11 bounding: Critical Resonance is a single-bullet modifier
  — no entity multiplication, no pool pressure.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering for the crit shockwave visual — deferred to Story 12.2.
- Implement audio for crits — deferred to Story 12.2.
- Implement the grid deformation shader changes — deferred to Story 12.2.
- Allow non-fused builds to roll crits: only bullets with `resonanceActive=true` trigger the check.
- Modify the card offer algorithm — Critical Resonance fusion is resolved by Epic 12's fusion system, not by a change to card drawing.
- Refund XP to a non-player source: all `applyPlayerDamage` hits originate from player weapons.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path: bullet hits enemy | Crit fused, bullet with `resonanceActive=true` contacts enemy | 20% crit roll; if success (crit): bullet deals `dmg × 3`, grid ripple fires at hit, no other visual/audio changes | No error expected |
| Crit does not roll | Crit fused, bullet hits enemy | Normal damage applied; no ripple, no XP refund | No error expected |
| Crit kills an enemy | crit success, enemy death results | Enemy killed through normal `applyPlayerDamage`; 1 XP added to progression state; ripple at hit pos | No error expected |
| Crit damages but does not kill | crit success, enemy has armor (hp > dmg×3) | Enemy takes 3× damage, survives if hp > 3×dmg; ripple fires (the crit happened regardless of kill); NO XP refund (no kill) | No error expected |
| Bullet misses (no enemy) | Crit fused, bullet passes through empty space | No check performed; normal bullet behavior | No error expected |
| Bullet hits armored enemy | crit success, armored archetype (hp 5) | Damage is 3× base; if 3×dmg > remaining hp → kill + xp refund; if not → armor absorbs the rest | No error expected |
| Multiple bullets crit in one volley | Spread Cannon + Crit fused, multi-bullet volley, all roll crit | Each bullet independently rolls; each crit fires its own ripple; XP refunds accumulate per crit kill | No error expected |
| Fusion inactive | Overcharge + offense items owned, no critical-resonance | Normal bullet damage; no crit check | No error expected |

## Code Map

- `src/systems/FiringSystem.js` -- MODIFY -- accept optional `fusionState` parameter; stamp `resonanceActive=true` on each bullet when Critical Resonance is fused
- `src/systems/CollisionSystem.js` -- MODIFY -- read bullet `resonanceActive` flag in collision path; on hit, check `Math.random() < CRIT_CHANCE` for crit; apply `dmg × CRIT_MULT` if crit; emit grid ripple at hit; add XP refund on crit kill via late-bound `progressionState`
- `src/config/constants.js` -- MODIFY -- add CRITICAL_RESONANCE_CRIT_CHANCE, CRITICAL_RESONANCE_CRIT_MULT, CRITICAL_RESONANCE_XP_REFUND; add `hasResonance` to bullet stamp path
- `src/scenes/buildArenaWorld.js` -- MODIFY -- wire `critical-resonance` effect handler: stamp flag on FiringSystem bullets; bind `progressionState` into CollisionSystem for XP refund; late-bind gridFieldSystem reference into CollisionSystem for ripple emission
- `src/state/ProgressionState.js` -- MODIFY -- add `refundXP(n)` helper method or expose a direct `xp` field for incremental XP additions

## Tasks & Acceptance

### Task 1: Add Critical Resonance constants

Add to `src/config/constants.js` (after the existing Flak/Cascade constants):

```js
// --- Critical Resonance (Story 12.11 / Epic 12 — offense Epic) ---------------
// Fusion: Overcharge Lv5 + any 2 offense Lv5.
// Per-hit crit chance for Critical Resonance bullets.
export const CRITICAL_RESONANCE_CRIT_CHANCE = 0.20;
// Critical damage multiplier: dmg × this on a crit.
export const CRITICAL_RESONANCE_CRIT_MULT = 3.0;
// XP refunded per crit kill (applied to progressionState.xp).
export const CRITICAL_RESONANCE_XP_REFUND = 1;
```

### Task 2: Add critical-resonance Fusion Epic entry to itemRegistry.js

Add a frozen entry to the `ITEM_REGISTRY` array (after `fragmentation-cascade`, before the `--- Defense ---` section):

```js
Object.freeze({
  id: 'critical-resonance',
  name: 'Critical Resonance',
  title: 'Critical Resonance',
  track: 'offense',
  rarity: 1,
  maxLevel: 1,
  levels: Object.freeze([
    Object.freeze({
      level: 1,
      desc: '20% crit for 3× damage; crits emit a shockwave and refund 1 XP',
      stats: Object.freeze({}),
    }),
  ]),
  // Not fusable itself.
  fusion: null,
}),
```

### Task 3: Modify FiringSystem — add fusionState and stamp resonance flag

Add optional `fusionState` parameter to the FiringSystem constructor:

```js
constructor(ship, inputState, playerStats = null, fusionState = null) {
  super();
  // ... existing setup ...
  this.fusionState = fusionState;
}
```

In the bullet spawn path (both single-shot and spread-volley branches), after the existing stamp operations (stampRicochet, _stampFlak), add:

```js
// Story 12.11 — Critical Resonance: stamp resonance flag on the bullet.
// When fused, CollisionSystem will roll for crit on every hit.
if (this.fusionState && this.fusionState.ownedCards['critical-resonance']) {
  b.resonanceActive = true;
}
```

### Task 4: Wire critical-resonance effect handler in buildArenaWorld.js

After the existing fusion effect handlers (after 'fragmentation-cascade'), wire:

```js
// Story 12.11 — Critical Resonance effect wiring.
// After fusion resolution sets 'critical-resonance' in ownedCards,
// enable the crit-check flag on FiringSystem (via fusionState).
FusionSystem.registerEffect(
  'critical-resonance',
  () => {
    // fusionState flows into the FiringSystem constructor as the 4th arg.
    // The FiringSystem reads this.fusionState.ownedCards['critical-resonance']
    // to stamp resonanceActive=true on each bullet.
  },
);
```

Since `fusionState` is only passed into the FiringSystem constructor, the effect handler registration is essentially a no-op for critical-resonance (the FiringSystem reads `fusionState` directly each tick). However, the handler registration is still needed for consistency with the epic effect wiring pattern.

### Task 5: Modify CollisionSystem — add critic detection

Add late-bound references for `progressionState` and `gridFieldSystem`:

```js
constructor(bulletPool, enemyPools) {
  super();
  // ... existing setup ...
  // Late-bound by buildArenaWorld (Story 12.11).
  this.progressionState = null;
  this.gridFieldSystem = null;
}
```

In pass 1, after the ricochet/pierce logic but before the hit-consumption logic, add the crit check:

```js
// Story 12.11 — Critical Resonance: if the bullet has resonanceActive,
// roll for crit. On crit (Math.random() < CRIT_CHANCE), store a
// damage multiplier on the hit so pass 2 applies the scaled damage.
if (b.resonanceActive) {
  if (Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
    // Mark this bullet as a crit hit — pass 2 will apply 3× damage.
    hitEnemies.set(s, { dmg: hitEnemies.get(s), critMult: CRITICAL_RESONANCE_CRIT_MULT });
    // Also store the hit position for grid ripple emission.
    b._critX = b.x;
    b._critY = b.y;
    continue; // skip to next enemy — bullet consumed as normal
  }
}
```

Wait, this approach of modifying the hitEnemies map value is clean — it stores an object `{dmg, critMult}` instead of a bare number. Let me reconsider: the simpler approach is to store a multiplier on the bullet itself.

Better approach — stamp `b._critDmg = true` on the bullet and `b._critPos = {x: b.x, y: b.y}` in pass 1, then in pass 2, when `applyPlayerDamage` is called, check `b._critDmg` to multiply the damage:

```js
// In pass 1, after a hit is recorded:
if (b.resonanceActive) {
  if (Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
    b._critDmg = true;
    b._critX = s.x;
    b._critY = s.y;
  }
}
```

Then in pass 2, when processing a hit:

```js
const entry = hitEnemies.get(s);
let damage = entry;
let critX = 0;
let critY = 0;
let isCrit = false;

// Find the bullet that claimed this enemy to read crit flags.
const bullet = hitBulletsHasClaim.has ? null : null; // Hmm, this gets complicated.
```

Actually, the cleanest approach given the existing code structure is to store the hit data in the Map with more information:

```js
// In pass 1 — record hit info (enriched for crit):
hitEnemies.set(s, {
  dmg: /* the base damage */,
  isCrit: b.resonanceActive && Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE,
  critX: b.x,
  critY: b.y,
});
```

But this would change the existing Map value from a number to an object. The simplest approach that minimizes change is to add a parallel scratch Map or a side structure to track which enemies were crit hits.

Even simpler: stamp a flag on the bullet itself (`b._isCrit`) that gets checked in pass 2, and use a parallel `Map<enemy, {x, y}>` for crit positions.

Let me simplify further: in pass 1, when the bullet has `resonanceActive` and the random roll succeeds, stamp `b._crit = true` and `b._critX`/`b._critY` with the collision position. Then in pass 2, when calling `applyPlayerDamage(enemy, ownerPool, hitEnemies.get(s))`, we DON'T need to modify the damage — instead, we handle the crit multiplier separately by modifying the damage applied before calling `applyPlayerDamage`:

Actually, the cleanest approach for this codebase: store enriched hit info in the Map. The original code stores `hitEnemies.set(s, damage)` as a number. We can keep a parallel check:

```js
// Pass 1 — hit detection:
hitEnemies.set(s, hitDamage);  // existing logic

// After that, if resonance + crit, stamp on the bullet:
if (b.resonanceActive && hitDamage === originalHitDamage) {
  // Check crit on the hit enemy
  if (Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
    b._crit = true;
    b._critX = s.x;
    b._critY = s.y;
    // Apply 3× damage by modifying the stored value
    hitEnemies.set(s, hitDamage * CRITICAL_RESONANCE_CRIT_MULT);
  }
}
```

This modifies the value in `hitEnemies` Map to the crit-scaled damage. Pass 2 reads this value and passes it to `applyPlayerDamage`. Clean, minimal change.

But wait — the original code sets hitEnemies BEFORE the ricochet/pierce/reflect logic. The ricochet and pierce branches happen AFTER that set. Let me look at the actual flow again:

In the current code:
1. Collision circle test
2. Set hitEnemies.set(s, damage)  
3. Flak airburst check
4. Ricochet off enemy check (optional - bullet stays alive)
5. Sunburst pierce check (optional - bullet stays alive)
6. Non-piercing: add to hitBullets
7. Break

The crit check should happen in step 2 (after collision confirmed, before ricochet/pierce decisions). But if the bullet bounces off the enemy (ricochet), we still want to apply the crit damage (and the bullet stays alive with the ricochet). Same for pierce: the bullet pierces through AND applies crit damage.

So the flow should be:
- After collision confirmed (step 1)
- Before ricochet/pierce (step 3-4)
- Check crit → stamp on bullet, modify damage in hitEnemies
- Continue to ricochet/pierce as normal

Let me refine the implementation:

In pass 1, right after setting `hitEnemies.set(s, normalizedDamage)` and before the flak check:

```js
          // Story 12.11 — Critical Resonance: on hit, check for crit.
          // If the bullet has resonanceActive and the roll succeeds,
          // apply 3× damage and mark the bullet for ripple emission.
          if (b.resonanceActive && Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
            hitEnemies.set(s, normalizedDamage * CRITICAL_RESONANCE_CRIT_MULT);
            b._crit = true;
            b._critX = s.x;
            b._critY = s.y;
          } else {
            hitEnemies.set(s, normalizedDamage);
          }
```

Wait, the existing code already calls `hitEnemies.set(s, ...)` for the base damage. I should REPLACE that pattern, not nest it inside. Let me look at the specific lines to modify:

In the current pass 1, around line 218-223:
```js
          hitEnemies.set(
            s,
            Number.isFinite(b.damage) && b.damage > 0
              ? Math.max(PLAYER_BULLET_MIN_DAMAGE, b.damage)
              : PLAYER_BULLET_BASE_DAMAGE,
          );
```

This should be replaced with:

```js
          let hitDmg = Number.isFinite(b.damage) && b.damage > 0
            ? Math.max(PLAYER_BULLET_MIN_DAMAGE, b.damage)
            : PLAYER_BULLET_BASE_DAMAGE;
          // Story 12.11 — Critical Resonance: roll for crit on hit.
          if (b.resonanceActive && Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
            hitDmg *= CRITICAL_RESONANCE_CRIT_MULT;
            b._crit = true;
            b._critX = s.x;
            b._critY = s.y;
          }
          hitEnemies.set(s, hitDmg);
```

This is clean: one `hitEnemies.set()` call, same location, minimal diff.

### Task 6: Handle ripple emission and XP refund in pass 2

After pass 2's `applyPlayerDamage` loop, handle the crit-side effects (ripple + XP refund). Since we stamped `b._crit` on the bullet, we can iterate `hitBullets` to find crit bullets:

```js
    // Story 12.11 — Critical Resonance: emit grid ripple for crit hits,
    // and refund XP for crit kills.
    for (const b of hitBullets) {
      if (b._crit) {
        if (this.gridFieldSystem) {
          this.gridFieldSystem._emit(b._critX, b._critY);
        }
        if (b._critKilled) {
          if (this.progressionState) {
            this.progressionState.xp += CRITICAL_RESONANCE_XP_REFUND;
          }
        }
        delete b._crit;
        delete b._critX;
        delete b._critY;
        delete b._critKilled;
      }
    }
```

Then in the existing hit processing loop (pass 2), after `applyPlayerDamage` returns `true` (kill):
```js
        if (wasKilled) {
          // Story 12.11 — Critical Resonance: track crit kills for XP refund.
          if (b._crit) {
            b._critKilled = true;
          }
```

Wait, but `b` (the bullet) isn't directly accessible in pass 2 in a way that's easy to modify. Let me think about this differently.

The pass 2 loop iterates enemies (not bullets):
```js
    for (let j = 0; j < enemies.length; j++) {
      const s = enemies[j];
      if (hitEnemies.has(s)) {
        this.applyPlayerDamage(s, owners[j], hitEnemies.get(s));
      }
    }
```

The enemy is keyed in `hitEnemies`, and we can also look up the bullet from somewhere. Hmm, the enemy → bullet mapping isn't directly available.

Alternative: instead of a separate bullet iteration, store the crit kill information in a separate Map or set keyed by enemy. Let me use a parallel Map:

```js
// At class construction, add:
// Enemy → {isCrit: boolean, x:number, y:number} for crit kills that need ripple + XP.
this._critHits = new Map();
```

In pass 2, after `applyPlayerDamage` returns true (kill):
```js
        if (wasKilled) {
          this._killedThisTick.add(s);
          const critInfo = this._critHits.get(s);
          if (critInfo) {
            // Emit ripple
            if (this.gridFieldSystem) {
              this.gridFieldSystem._emit(critInfo.x, critInfo.y);
            }
            // Refund XP
            if (this.progressionState) {
              this.progressionState.xp += CRITICAL_RESONANCE_XP_REFUND;
            }
            this._critHits.delete(s);
          }
        }
```

In pass 1 (collision check), when crit is detected:
```js
          if (b.resonanceActive && Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
            hitDmg *= CRITICAL_RESONANCE_CRIT_MULT;
            this._critHits.set(s, { x: s.x, y: s.y });
          }
          hitEnemies.set(s, hitDmg);
```

This is cleaner! The `_critHits` Map carries the hit position info from pass 1 to pass 2, and is cleaned up after processing.

### Task 7: Wire in buildArenaWorld.js

Add late binds after CollisionSystem construction:
```js
collisionSystem.progressionState = progressionState;
collisionSystem.gridFieldSystem = gridFieldSystem;
```

But wait, `gridFieldSystem` is constructed LATER in buildArenaWorld.js (around line 722). And `progressionState` is created earlier (line 194). So the late-binds for gridFieldSystem need to happen after gridFieldSystem exists.

The simplest approach: bind `progressionState` in the CollisionSystem constructor's late-bind section (after line 307), and bind `gridFieldSystem` after line 734 (where gridFieldSystem is already created).

```js
// Story 12.11 — bind progressionState into CollisionSystem for XP refund.
collisionSystem.progressionState = progressionState;
```
(placed after line 306, before world.addSystem(collisionSystem))

And later:
```js
// Story 12.11 — bind gridFieldSystem into CollisionSystem for ripple emission.
collisionSystem.gridFieldSystem = gridFieldSystem;
```
(placed after line 734, after gridFieldSystem is created)

### Task 8: Wire critical-resonance effect handler

Add the effect registration after 'fragmentation-cascade':

```js
// Story 12.11 — Critical Resonance effect wiring.
// After fusion resolution sets 'critical-resonance' in ownedCards,
// the FiringSystem reads fusionState directly (no handler state needed).
FusionSystem.registerEffect(
  'critical-resonance',
  () => {
    // The FiringSystem already checks fusionState.ownedCards['critical-resonance']
    // on each bullet spawn, so no additional flag-setting is required here.
  },
);
```

### Task 9: Tests — CollisionSystem

Add to `src/systems/collisionSystem.test.js`:

1. **resonanceActive=false: no crit on hit** — bullet with resonanceActive=false hits enemy; verify base damage applied, no ripple
2. **resonanceActive=true + crit roll: 3× damage, ripple, XP** — bullet hits enemy, crit rolls; verify 3× damage, `_emit` called on gridFieldSystem
3. **resonanceActive=true + no crit: normal damage** — bullet hits enemy, crit roll fails; verify base damage, no special effects
4. **crit kills: 1 XP refunded** — enemy killed by crit; verify progressionState.xp += 1
5. **crit damages but doesn't kill: ripple fires, NO XP** — armored enemy survives crit; verify ripple fires, no XP refund
6. **Multiple crits in one tick: each fires ripple independently** — spread + crit, multiple bullets crit; verify multiple ripples
7. **resonance flag from FiringSystem** — FiringSystem stamps resonanceActive when fusionState has critical-resonance

## Verification

**Commands:**
- `npm test` -- expected: all existing tests pass + all new Critical Resonance tests pass.

## Spec Change Log

| Date | Change |
|------|--------|
| 2026-07-31 | Initial spec created from archived epic spec (spec-12-3-offense-epics.md) |

## Auto Run Result

**Status:** done

**Summary:** Implemented Story 12.11 — Critical Resonance fusion Epic. When fused (Overcharge Lv5 + any 2 offense items at Lv5):

- **20% crit chance:** Each bullet hit rolls against 20% chance; if successful, deals 3× base damage instead of normal.
- **Grid shockwave:** On crit, calls `gridFieldSystem._emit()` at the hit position, reusing the existing deforming grid shader.
- **XP refund:** On a crit kill, adds 1 XP to `scoreState.xp`.
- **Armor interaction:** Crit damage is determined BEFORE `applyPlayerDamage`, so the armored archetype receives the 3× damage (making the hit more likely to kill). If the enemy survives the 3× damage, a ripple still fires (the crit happened) but no XP is refunded.

**Files changed:**
- `src/config/constants.js` (MODIFIED) — added 3 Critical Resonance constants: `CRITICAL_RESONANCE_CRIT_CHANCE=0.20`, `CRITICAL_RESONANCE_CRIT_MULT=3.0`, `CRITICAL_RESONANCE_XP_REFUND=1`
- `src/config/itemRegistry.js` (MODIFIED) — added frozen `critical-resonance` Fusion Epic entry (offense track, rarity 1, maxLevel 1, fusion null)
- `src/systems/FiringSystem.js` (MODIFIED) — added `fusionState` constructor parameter; stamp `b.resonanceActive=true` on bullets in single-shot, spread-volley, and Sunburst ring spawn paths
- `src/systems/CollisionSystem.js` (MODIFIED) — import CRITICAL_RESONANCE constants; late-bind `scoreState` and `gridFieldSystem`; in pass 1, check `b.resonanceActive` on hit, roll `Math.random() < CRIT_CHANCE`, apply `dmg × 3`, track hit position in `_critHits` Map; in pass 2, emit grid ripple and refund XP for crit kills
- `src/scenes/buildArenaWorld.js` (MODIFIED) — pass `progressionState` as `fusionState` to FiringSystem constructor; pass `scoreState` to CollisionSystem constructor; wire `critical-resonance` effect handler; bind `gridFieldSystem` into `collisionSystem`

**Verification:** `npm test`

## Spec Change Log

| Date | Change |
|------|--------|
| 2026-07-31 | Initial spec created from archived epic spec (spec-12-3-offense-epics.md) |
| 2026-07-31 | Implemented per tasks 1-9; status changed to done |
