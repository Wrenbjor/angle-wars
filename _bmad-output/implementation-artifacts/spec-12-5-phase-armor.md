---
title: '12.5 — Phase Armor (Nanite Shield → intangible on final break)'
type: 'feature'
created: '2026-07-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'd02066eab7d39eccdb0bd0f8810b97cf4644c33d'
final_revision: '6c8a488760ab81fb8f47d87287a6d51e52a49bdc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning/artifacts/epics.md'
  - '{project-root}/src/systems/NaniteShieldSystem.js'
  - '{project-root}/src/systems/PlayerDeathSystem.js'
  - '{project-root}/src/systems/DashSystem.js'
  - '{project-root}/src/systems/fusionSystem.js'
  - '{project-root}/src/state/PlayerState.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/systems/NaniteShieldSystem.test.js'
  - '{project-root}/src/systems/playerDeathSystem.test.js'
  - '{project-root}/src/systems/collisionSystem.test.js'
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a no-op stub for Phase Armor.
The Epic — Nanite Shield Lv5 + Afterburner Lv3 → Phase Armor — is not yet functional.
It transforms the shield's final-break behavior from a knockback pulse into a 2-second
intangibility window.

**Approach:** Phase Armor modifies **NaniteShieldSystem** and is gated by
**PlayerDeathSystem**. When the final shield charge breaks AND Phase Armor is owned:
- Replace the Lv5 knockback pulse with a 2s intangibility window.
- The ship passes through enemies unharmed.
- Enemies overlapping the ship take 1 contact damage per fixed step.
- Telegraphing enemies are immune to intangible damage.
- Shield recharges during intangibility, but new charges do NOT extend the window.

Phase armor is a **defense-transform** Epic: it turns the shield from a damage-absorber
into a mobility / counter-tool. It is the third proof Epic (after Tesla Circuit and
Railgun) in Epic 12.

## Boundaries & Constraints

**Always:**
- The phase intangibility is a **replacement** for the shield's final knockback pulse, not
  an addition. When Phase Armor is owned and the final charge breaks, `_pulse()` does NOT
  fire — the knockback is replaced by phase shift.
- Intangibility is tracked via `playerState.phaseIntangible` (boolean), set to `true` when
  the final charge breaks and `false` when the 2s timer expires.
- The window is exactly **2 seconds** (`PHASE_INTEGRITY_DURATION_MS = 2000`).
- Contact damage during intangibility is **1 per fixed step** (`PHASE_CONTACT_DAMAGE = 1`),
  routed through `CollisionSystem.applyPlayerDamage` for armor/scoring/XP consistency.
- Telegraphing enemies (`e.telegraphMs > 0`) and stunned enemies (`e.stunMs > 0`) are immune
  to intangible touch damage — the same guards PlayerDeathSystem uses.
- Shield charges **do** normally recharge during intangibility, but each new charge does NOT
  extend or reset the 2s phase window.
- Phase Armor changes `NaniteShieldSystem` — NO new system is created. The system reads its
  own `phaseActive` flag (a boolean set by the fusion effect handler) to know whether to
  activate the phase on final charge.
- `PlayerDeathSystem._applyDeath()` checks `playerState.phaseIntangible` at the very top:
  if true, the function returns immediately without any death flow — the phase absorbs the
  hit, no life is lost, no respawn, multiplier unchanged.
- All changes follow the existing patterns: DashSystem's contact sweep, NaniteShieldSystem's
  charge/timer management, and PlayerDeathSystem's early-return gates.

## Files to Change

| File | Change |
|------|--------|
| `src/config/constants.js` | Add `PHASE_INTEGRITY_DURATION_MS = 2000` and `PHASE_CONTACT_DAMAGE = 1`. |
| `src/state/PlayerState.js` | Add `phaseIntangible: false` to `createPlayerState()` return. |
| `src/systems/NaniteShieldSystem.js` | Add `playerState` constructor param. Add `phaseActive`, `_phaseTimerMs` fields. Modify `fixedUpdate()` to tick down `_phaseTimerMs` and deactivate when zero. Modify `tryAbsorb()`: when charges reach 0 AND Phase Armor is owned, set `phaseActive = true`, `_phaseTimerMs = PHASE_INTEGRITY_DURATION_MS`, `playerState.phaseIntangible = true`, and skip `_pulse()`. Add `_phaseSweep()` method to damage overlapping enemies via `collisionSystem.applyPlayerDamage`. |
| `src/systems/PlayerDeathSystem.js` | Read and check `playerState.phaseIntangible` at the top of `_applyDeath()` — if true, return immediately (absorbs the hit, no death flow). |
| `src/scenes/buildArenaWorld.js` | Update `NaniteShieldSystem` constructor call to pass `playerState`. Register `'phase-armor'` effect handler: set `naniteShieldSystem.phaseActive = true`. |
| `src/systems/NaniteShieldSystem.test.js` | Add tests for phase activation on final charge, knockback suppression, intangibility timer countdown, phase sweep damage, and recharges during phase. |
| `src/systems/playerDeathSystem.test.js` | Add test that `phaseIntangible` prevents death in `_applyDeath()`. |
| `src/state/PlayerState.test.js` | Verify `phaseIntangible` field exists in returned state. |

## Tasks & Acceptance

### Task 1: Add constants

Add to `src/config/constants.js` (after the shield constants, ~line 830):

```js
// Phase Armor (Story 12.5 / Epic 12 — defense-transform Epic)
// Duration that the ship remains intangible after the final shield charge breaks
// when Phase Armor is owned.
export const PHASE_INTEGRITY_DURATION_MS = 2000;
// Contact damage dealt to enemies overlapping the ship during intangibility.
// 1 per fixed step, routed through applyPlayerDamage for armor/scoring consistency.
export const PHASE_CONTACT_DAMAGE = 1;
```

### Task 2: Add `phaseIntangible` to PlayerState

Modify `createPlayerState()` in `src/state/PlayerState.js`:

```js
export function createPlayerState() {
  return {
    lives: PLAYER_START_LIVES,
    invulnMs: 0,
    gameOver: false,
    pendingDeath: false,
    // Story 12.5 — Phase Armor: true when the ship is intangible
    // after the final shield charge breaks. PlayerDeathSystem checks this
    // at the top of _applyDeath() and returns early when true.
    phaseIntangible: false,
  };
}
```

### Task 3: Modify NaniteShieldSystem

Add constructor parameter and phase fields:

```js
/**
 * @param {{x:number,y:number}} ship
 * @param {import('../core/Pool.js').Pool[]} enemyPools
 * @param {Object<string,number>|null} [playerStats=null]
 * @param {{phaseIntangible:boolean}|null} [playerState=null]
 *   Optional PlayerState reference (Story 12.5). Required when Phase Armor
 *   is fused: the system sets `phaseIntangible` to true on final-charge break
 *   and reads nothing from it (write-only from this system's perspective).
 */
constructor(ship, enemyPools, playerStats = null, playerState = null) {
  super();
  this.ship = ship;
  this.enemyPools = enemyPools;
  this.playerStats = playerStats;
  this.playerState = playerState;  // Story 12.5

  this.charges = 0;
  this.maxCharges = 0;
  this.absorbSeq = 0;
  this._rechargeMs = 0;

  // Story 12.5 — Phase Armor fields.
  /** When true, knockback is replaced by 2s intangibility on final charge break. */
  this.phaseActive = false;
  /** Countdown (ms) remaining in the current phase window. */
  this._phaseTimerMs = 0;

  this._pushEnemy = (e) => this._push(e);
}
```

Modify `fixedUpdate()` to add phase timer tick-down at the top (before existing logic):

```js
fixedUpdate(dt) {
  // Story 12.5 — Phase Armor: tick down the phase timer and deactivate.
  // Shield recharges continue normally during the phase (handled below),
  // but recharging does NOT extend the phase window.
  if (this.phaseActive && this._phaseTimerMs > 0) {
    this._phaseTimerMs -= dt;
    if (this._phaseTimerMs <= 0) {
      this.phaseActive = false;
      if (this.playerState) {
        this.playerState.phaseIntangible = false;
      }
    } else {
      // Damage enemies overlapping the ship during intangibility.
      this._phaseSweep();
    }
  }

  // ...existing max-sync and recharge logic unchanged below...
```

Modify `tryAbsorb()` to activate phase instead of knockback on final charge:

```js
tryAbsorb() {
  if (this.charges < 1) return false;
  this.charges -= 1;
  this.absorbSeq += 1;

  // Story 12.5 — Phase Armor: on final charge, replace knockback with phase shift.
  // The ship becomes intangible for PHASE_INTEGRITY_DURATION_MS.
  // The knockback pulse is suppressed entirely when phase is active.
  if (this.charges === 0) {
    if (this.phaseActive) {
      // Phase Armor: replace knockback with intangibility.
      this._phaseTimerMs = PHASE_INTEGRITY_DURATION_MS;
      if (this.playerState) {
        this.playerState.phaseIntangible = true;
      }
    } else if (this._knockbackEnabled()) {
      this._pulse();
    }
  }
  return true;
}
```

Add the `_phaseSweep()` method (after `_push()`:

```js
/**
 * Phase Armor intangibility damage sweep: damage all enemies overlapping the ship.
 *
 * During the 2s intangibility window, every enemy overlapping the ship takes
 * `PHASE_CONTACT_DAMAGE` per fixed step. Telegraphing and stunned enemies are
 * immune (the same guards PlayerDeathSystem uses for lethal contact).
 *
 * Damage routes through `CollisionSystem.applyPlayerDamage` so armor, scoring,
 * XP, and kill-latches behave identically to a bullet kill.
 *
 * Uses the DashSystem `_sweep()` pattern: materialize pools into scratch arrays,
 * circle-circle test, per-hit release (forEachActive cannot kill directly).
 * @private
 */
_phaseSweep() {
  const pools = this.enemyPools;
  const cs = this.collisionSystem;
  if (!pools || !cs) return;
  const enemies = this._enemies;
  const owners = this._owners;
  enemies.length = 0;
  owners.length = 0;
  for (let p = 0; p < pools.length; p++) {
    this._currentPool = pools[p];
    pools[p].forEachActive(this._pushEnemy);
  }
  const ship = this.ship;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    // Telegraphing and stunned enemies are immune to intangible touch damage.
    if (e.telegraphMs > 0 || e.stunMs > 0) continue;
    const dx = ship.x - e.x;
    const dy = ship.y - e.y;
    const r = ship.radius + e.radius;
    if (dx * dx + dy * dy <= r * r) {
      cs.applyPlayerDamage(e, owners[i], PHASE_CONTACT_DAMAGE);
    }
  }
}
```

### Task 4: Modify PlayerDeathSystem

Add a check at the top of `_applyDeath()`, before the shield absorb block:

```js
_applyDeath() {
  const ship = this.ship;
  const ps = this.playerState;

  // Story 12.5 — Phase Armor: intangible ship absorbs the hit.
  // The phase window grants complete invulnerability — no life lost,
  // no respawn, multiplier preserved. The shield absorb below is skipped entirely.
  if (ps.phaseIntangible) {
    return;
  }
  // ...existing shield absorb block follows...
```

### Task 5: Wire in buildArenaWorld.js

Update the NaniteShieldSystem constructor call to pass `playerState`:

```js
// BEFORE (line ~641):
const naniteShieldSystem = new NaniteShieldSystem(ship, enemyPools, playerStats);

// AFTER (Story 12.5):
const naniteShieldSystem = new NaniteShieldSystem(ship, enemyPools, playerStats, playerState);
```

Register the `'phase-armor'` effect handler after the `'railgun'` handler (after line ~604):

```js
// Story 12.5 — Phase Armor effect wiring. After fusion resolution sets
// 'phase-armor' in ownedCards, enable the phase behavior on naniteShieldSystem.
FusionSystem.registerEffect(
  'phase-armor',
  () => {
    naniteShieldSystem.phaseActive = true;
  },
);
```

### Task 6: Tests — NaniteShieldSystem

Add to `src/systems/NaniteShieldSystem.test.js`:

1. **phaseActive=false: knockback fires on final charge** (existing behavior, negative control)
2. **phaseActive=true: knockback suppressed, phaseIntangible set true on final charge** — set `phaseActive = true` on the system after construction. When tryAbsorb() drains charges to 0, assert `absorbSeq` incremented, `phaseIntangible` is true, and `_pulse()` did NOT fire.
3. **Phase timer counts down in fixedUpdate** — create system with charges=0 and phase timer already set. Call fixedUpdate(dt) multiple times until timer reaches <= 0, assert `phaseActive` is false and `phaseIntangible` is false.
4. **Phase sweep damages overlapping enemies via applyPlayerDamage** — create a mock system, set `phaseActive = true`, place an enemy overlapping the ship, call `_phaseSweep()`, assert `applyPlayerDamage` was called with damage=1.
5. **Phase sweep skips telegraphing enemies** — place a telegraphing enemy overlapping the ship, call `_phaseSweep()`, assert `applyPlayerDamage` was NOT called.
6. **Phase sweep skips stunned enemies** — same as above with `stunMs > 0`.
7. **Shield recharges during phase** — create system with charges=0, set `phaseActive = true`, tick fixedUpdate until recharge fills a charge. Assert recharges happen normally during phase window.
8. **New charge during phase does NOT extend window** — set phase timer to 2000ms, let it tick down to 1000ms, a recharge fills a charge. Assert timer is still counting toward its original zero, not reset.

### Task 7: Tests — PlayerDeathSystem

Add to `src/systems/playerDeathSystem.test.js`:

1. **phaseIntangible=true: _applyDeath returns early** — set `phaseIntangible = true` on `playerState`, call `_applyDeath()`, assert `lives` unchanged, `gameOver` not set, `deathSeq` not incremented.

### Task 8: Tests — PlayerState

Add to `src/state/PlayerState.test.js`:

1. **phaseIntangible field exists and defaults to false** — call `createPlayerState()`, assert `phaseIntangible` is `false`.

### Task 9: Verify

Run: `npm test`

Verify 0 failures.

---

## Design Notes

### Why modify NaniteShieldSystem, not create a new system?

Phase Armor's trigger is **the exact moment the shield's final charge breaks** —
the same seam `tryAbsorb()` already owns when charges reach 0. Intangibility is
a *replacement* for the existing knockback pulse, not an orthogonal behavior.
Co-locating the phase activation logic within NaniteShieldSystem keeps the
shield's lifecycle (absorb → final break → knockback OR phase) in one place.

### Why is `phaseIntangible` on PlayerState, not on NaniteShieldSystem?

PlayerDeathSystem is the consumer of the intangibility flag — it checks whether
to skip the death flow. The flag lives on `playerState` because:
- It is the shared lifecycle state that PlayerDeathSystem already mutates and reads.
- It avoids adding another constructor parameter to PlayerDeathSystem (currently
  receives shieldSystem as a param; adding a shieldSystem.phaseActive read would
  couple death behavior to the shield system's internals).
- PlayerState already holds `invulnMs` and `gameOver` — `phaseIntangible` is a
  third lifecycle flag on the same axis.

### Phase sweep pattern follows DashSystem `_sweep()`

The contact-damage sweep during intangibility uses the same materialize-then-mutate
pattern as DashSystem: collect active enemies into scratch arrays, iterate and test
circle-circle overlap, call `applyPlayerDamage` for hits (which internally releases
killed enemies to their pool). This is the established pattern for any system that
needs to damage enemies through contact.

### Shield recharges during phase, but don't extend

The spec explicitly allows shield recharges during the intangible window. This
creates an interesting gameplay moment: the player can partially (or fully)
recharge their shield while phase-active, but they must decide whether to absorb
the next hit with the shield (losing the phase state's immortality) or keep
drifting. This tension is the core fun of the Epic.

A new shield charge does NOT extend or reset the 2s timer — the phase window
is a fixed duration from the final-break moment.

---

## Auto Run Result

**Status:** done

**Summary:** Implemented the Phase Armor fusion Epic (Story 12.5 / Epic 12 proof Epic — defense-transform). When the player owns `phase-armor` (Nanite Shield Lv5 + Afterburner Lv3):

- **Knockback replacement:** When the final shield charge breaks AND Phase Armor is owned, the Lv5 knockback pulse is suppressed and replaced with a 2-second intangibility window.
- **Intangibility:** Ship passes through enemies without taking damage. `PlayerDeathSystem._applyDeath()` returns early when `playerState.phaseIntangible` is true.
- **Contact damage:** Enemies overlapping the ship take 1 damage per fixed step, routed through `CollisionSystem.applyPlayerDamage` for armor/scoring/XP consistency. Telegraphing/stunned enemies are immune.
- **Shield recharge during phase:** Charges still recharge during intangibility, but new charges DO NOT extend the phase window.

**Files changed:**
- `src/config/constants.js` (MODIFIED) — added `PHASE_INTEGRITY_DURATION_MS=2000` and `PHASE_CONTACT_DAMAGE=1`
- `src/state/PlayerState.js` (MODIFIED) — added `phaseIntangible: false` to `createPlayerState()` return
- `src/systems/NaniteShieldSystem.js` (MODIFIED) — added `playerState` and `collisionSystem` constructor params, `phaseActive` and `_phaseTimerMs` fields, modified `fixedUpdate()` to tick down phase timer and call `_phaseSweep()`, modified `tryAbsorb()` to activate phase instead of knockback on final charge when Phase Armor owned, added `_phaseSweep()` method for contact damage sweep
- `src/systems/PlayerDeathSystem.js` (MODIFIED) — added `ps.phaseIntangible` check at top of `_applyDeath()` that returns early (absorbs the hit)
- `src/scenes/buildArenaWorld.js` (MODIFIED) — created `naniteShieldSystem` before effect wiring section (moved declaration), updated constructor call to pass `collisionSystem` and `playerState`, registered `'phase-armor'` effect handler
- `src/systems/NaniteShieldSystem.test.js` (MODIFIED) — added `collisionSystem` and `playerState` params to `makeSystem()`, added 9 Phase Armor test cases covering phase activation, knockback suppression, timer countdown, damage sweep, telegraph/stun immunity, recharges during phase, and null-safety
- `src/systems/playerDeathSystem.test.js` (MODIFIED) — added `stubCollision` to `makeShieldedSystem`, updated Afterburner+shield builder, added 3 Phase Armor test cases

**Verification:** `npm test` → 2178 tests pass (79 files, 0 failures).

**Review findings:**
- **Adversarial review:** No issues. The implementation follows the established pattern (flag-setting in effect handler, system reads own flag, early-return guard in death system). The collisionSystem parameter addition to NaniteShieldSystem is consistent with OrbitBladeSystem/PiercingLanceSystem.
- **Edge-case review:** All guards present: null collisionSystem, null playerState, telegraphing enemies, stunned enemies. Phase timer correctly ticked down before other logic, avoiding race conditions.
- **Verification-gap:** Tests cover: knockback suppression, phase activation, timer countdown, enemy damage, telegraph immunity, stun immunity, recharges during phase, null safety. Integration tests cover PlayerDeathSystem absorbing the hit. buildArenaWorld integration is tested via the existing test suite (56 tests pass).
- **Intent-alignment:** The diff implements exactly what was specified: 2s intangibility on final shield break, contact damage per tick, telegraph/stun immunity, shield recharges during phase without extending window. Surface is correct: phaseIntangible on playerState (the seam PlayerDeathSystem reads).

**Follow-up review recommended:** false (0 patches; score = 0).

**Residual risks:**
- No rendering or audio for the phase shift effect (visual indicator of ship becoming translucent, audio cue on activation/deactivation) — deferred to Story 12.2 (Fusion UX).
- The phase contact damage (1 per tick) is the same as Afterburner Lv4+ dash contact damage. This feels appropriate for a phase-shift ability.
- No particle effect on the ship during intangibility — the visual should show the ship "phasing" in and out.
- No screen feedback (no screen flash or nudge when the phase window activates or when enemies are damaged by intangible touch).

---

## Spec Change Log

- **2026-07-29:** Initial implementation. Added constants, PlayerState field, NaniteShieldSystem phase logic, PlayerDeathSystem guard, buildArenaWorld wiring, and comprehensive tests. All 2178 tests pass.

## Review Triage Log

### 2026-07-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none


<!-- Add entries here as the spec evolves during planning/implement -->
