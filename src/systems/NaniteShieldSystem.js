import { System } from '../core/System.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SHIELD_MAX_CHARGES,
  SHIELD_RECHARGE_FLOOR_MS,
  SHIELD_KNOCKBACK_RADIUS,
  SHIELD_KNOCKBACK_PUSH,
  PHASE_INTEGRITY_DURATION_MS,
  PHASE_CONTACT_DAMAGE,
} from '../config/constants.js';

// NaniteShieldSystem — the Nanite Shield's RUNTIME state (Story 10.4 / PRD §13.4),
// Phaser-free.
//
// The shield is the first Epic-10 item whose effect is not a pure stat read. The
// SPLIT of responsibility is the whole design:
//   - the FOLD (state/PlayerStats.js) owns the derived MAXIMA — `shieldCharges` is a
//     CAP, plus `shieldRechargeMs` and the Lv5 `shieldKnockback` flag;
//   - THIS system owns the LIVE charge count and the recharge timer.
// They are split because `recomputePlayerStats` resets every field and re-derives the
// whole store on EVERY card pick: a live count kept there would be silently restored to
// full by picking any unrelated item (a free shield reset once per level).
//
// Registration slot (see scenes/buildArenaWorld.js) is load-bearing in BOTH directions:
// AFTER LevelUpSystem, so a pick-tick fold is already visible when the max syncs; and
// BEFORE PlayerDeathSystem, so `tryAbsorb()` reads a count that is current for this tick.
//
// Each fixed step:
//   1. SYNC the max off the shared store. When the max RISES (first acquisition, or a
//      charge-count rung) the live count gains the SAME delta immediately — picking
//      "2 charges" gives you the second charge NOW, it does not make you wait a
//      recharge for the card you just picked. Then clamp the live count into
//      [0, maxCharges] so a max that DROPS (an Epic 12 remnant) clamps it down.
//   2. RECHARGE: while below the cap, accumulate dt and convert each whole interval
//      into one charge. At the cap the timer is reset to 0 and idles, so a later break
//      always starts a FULL interval rather than inheriting banked idle time.
//
// `tryAbsorb()` is the seam PlayerDeathSystem._applyDeath() calls at the TOP of the
// shared death body: it spends one charge and reports true, or reports false when the
// shield is empty (or absent) and the ordinary death flow must run. The caller — not
// this system — owns the game-over / invulnerability guards, so a charge can never be
// spent while the player was already safe.
//
// Zero per-tick allocation: the max-sync and recharge are scalar arithmetic, and the
// Lv5 pulse iterates the pools through a HOISTED `forEachActive` collector (it mutates
// only x/y, never the active set, so no materialization pass is needed).
export class NaniteShieldSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The player ship entity (the pulse epicenter).
   * @param {import('../core/Pool.js').Pool[]} enemyPools The five COMBAT archetype
   *   pools the Lv5 break pulse displaces. Deliberately `enemyPools`, never
   *   `deathPools`: the Black Hole and the Mirror Reflector are immune to AoE, the
   *   same scoping BombSystem.detonateAt applies.
   * @param {import('../systems/CollisionSystem.js').CollisionSystem} collisionSystem
   *   The shared damage seam — Phase Armor's `_phaseSweep` routes contact damage
   *   through `applyPlayerDamage` here.
   * @param {Object<string,number>|null} [playerStats=null] The shared player-stat
   *   store the MAXIMA are read from (optional — a null store means no shield ever,
   *   i.e. exactly the pre-10.4 behavior).
   * @param {{phaseIntangible:boolean}|null} [playerState=null]
   *   Optional PlayerState reference (Story 12.5). When Phase Armor is fused, the
   *   system sets `phaseIntangible` to true on final-charge break and reads nothing
   *   from it (write-only from this system's perspective).
   */
  constructor(ship, enemyPools, collisionSystem, playerStats = null, playerState = null) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;
    this.playerState = playerState;

    // Public runtime state.
    /** Live charge count — what an absorb spends. Starts empty (nothing owned). */
    this.charges = 0;
    /** The derived cap, re-synced from the fold each tick. Starts at 0. */
    this.maxCharges = 0;
    /**
     * Public read-only observability latch, mirroring PlayerDeathSystem.deathSeq: a
     * monotonic count of absorbs. It exists because the net `charges` delta on a tick
     * where an absorb AND a recharge both land is 0 — without this, an absorb would be
     * indistinguishable from "nothing happened". Published now so Epic 4's feedback
     * work (a HUD readout, a break burst, an SFX cue — all deliberately out of scope
     * here) has an edge to consume without touching this system again.
     */
    this.absorbSeq = 0;

    // Recharge accumulator (ms). Private: it is an implementation detail of the
    // per-charge regeneration, not part of the observable contract.
    this._rechargeMs = 0;

    // Story 12.5 — Phase Armor fields.
    /** When true, knockback is replaced by 2s intangibility on final charge break. */
    this.phaseActive = false;
    /** Countdown (ms) remaining in the current phase window. */
    this._phaseTimerMs = 0;

    // Hoisted pulse callback so the per-pool `forEachActive` reuses ONE closure
    // instead of allocating a fresh arrow per pool per break.
    this._pushEnemy = (e) => this._push(e);

    // Story 12.5 — Phase Armor scratch: reusable arrays for _phaseSweep.
    /** Materialized active enemies, reused each tick to avoid allocation. */
    this._enemies = [];
    /** Owner pools for each materialized enemy (parallel to `_enemies`), reused each tick. */
    this._owners = [];
    /** Pool being iterated by `_currentPool.forEachActive(this._pushEnemy)`. */
    this._currentPool = null;
    /** Callback: collect active enemy from the current pool into scratch arrays. */
    this._collectPhaseEnemy = (e) => {
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };
  }

  /**
   * The sanitized MAXIMUM charge count off the shared store — an INTEGER in
   * [0, SHIELD_MAX_CHARGES]. Mirrors FiringSystem._spreadWays: the value comes off the
   * shared store, so a missing store, a missing field, or junk (NaN, Infinity, negative,
   * fractional, 1e9) must resolve to something the refill loop can terminate on rather
   * than throw.
   *   - no store / non-finite / < 1 → 0, i.e. NO shield (the pre-10.4 death path);
   *   - fractional                  → floored to a whole charge;
   *   - absurdly large              → clamped to SHIELD_MAX_CHARGES (a SAFETY guard: an
   *     unclamped 1e9 would ask the refill loop to mint a billion charges).
   * Allocates nothing.
   * @returns {number} the sanitized max (integer, 0..SHIELD_MAX_CHARGES).
   */
  _maxCharges() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.shieldCharges;
    if (!Number.isFinite(v)) return 0;
    const max = Math.floor(v);
    if (max < 1) return 0;
    return max > SHIELD_MAX_CHARGES ? SHIELD_MAX_CHARGES : max;
  }

  /**
   * The sanitized per-charge recharge interval (ms) — always >= SHIELD_RECHARGE_FLOOR_MS.
   * Mirrors FiringSystem._mult's shape: a missing store, a missing field, a non-finite
   * value, a non-positive one, or anything below the floor all resolve to the floor. A
   * SAFETY guard, never a balance lever — the floor sits 10x below the fastest shipped
   * rung, so no authored build reaches it.
   *
   * What the floor DOES: it bounds the refill RATE at one charge per second, so a
   * corrupted store cannot regenerate a charge every tick. What it does NOT do, despite
   * the obvious reading: make the refill loop terminate. That loop is bounded by its own
   * `this.charges < max` clause plus the SHIELD_MAX_CHARGES clamp on `max` — it stops at
   * the cap even at an interval of 0. Do not drop that clause on the strength of this
   * floor.
   * Allocates nothing.
   * @returns {number} the sanitized interval in ms (>= SHIELD_RECHARGE_FLOOR_MS).
   */
  _rechargeIntervalMs() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return SHIELD_RECHARGE_FLOOR_MS;
    const v = ps.shieldRechargeMs;
    if (!Number.isFinite(v) || v <= 0 || v < SHIELD_RECHARGE_FLOOR_MS) {
      return SHIELD_RECHARGE_FLOOR_MS;
    }
    return v;
  }

  /**
   * Whether the Lv5 break pulse is enabled — the `shieldKnockback` flag, sanitized on
   * the same terms as the other two readers: a missing store, a missing field, a
   * non-finite value, a string, or anything below 1 all resolve to DISABLED.
   * Allocates nothing.
   * @returns {boolean}
   */
  _knockbackEnabled() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return false;
    const v = ps.shieldKnockback;
    return Number.isFinite(v) && v >= 1;
  }

  /**
   * Advance one fixed step: sync the max off the fold, then recharge toward it.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
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

    // (1) Sync the MAX first, so a pick applied earlier this tick (LevelUpSystem runs
    // before this system) is already reflected. A RISE grants the SAME delta to the
    // live count immediately — the card you just picked is usable now, not one recharge
    // from now. A DROP (an Epic 12 remnant) is handled by the clamp below.
    const max = this._maxCharges();
    if (max > this.maxCharges) {
      this.charges += max - this.maxCharges;
    }
    this.maxCharges = max;
    if (this.charges > max) this.charges = max;
    if (this.charges < 0) this.charges = 0;

    // (2) Recharge. At (or above) the cap the timer resets and idles, so a later break
    // always begins a FULL interval rather than inheriting banked idle time. Below the
    // cap, each whole interval of accumulated time becomes one charge. The loop
    // terminates because `_rechargeIntervalMs()` is floored strictly above 0 AND
    // `charges` rises to the (clamped, finite) cap.
    if (this.charges >= max) {
      this._rechargeMs = 0;
      return;
    }
    const interval = this._rechargeIntervalMs();
    this._rechargeMs += dt;
    while (this._rechargeMs >= interval && this.charges < max) {
      this._rechargeMs -= interval;
      this.charges += 1;
    }
    // Reaching the cap mid-loop discards the remainder for the same reason as above.
    if (this.charges >= max) this._rechargeMs = 0;
  }

  /**
   * Try to spend one charge INSTEAD of a life. Called from the very top of
   * PlayerDeathSystem._applyDeath() — the shared body BOTH the ship↔enemy contact path
   * and the programmatic `pendingDeath` path funnel through — so a shielded hit is
   * absorbed identically whichever produced it.
   *
   * On success the caller grants SHIELD_ABSORB_INVULN_MS and returns: no life is lost,
   * no respawn happens, the run multiplier and the ship's position survive, and
   * `deathSeq` is NOT bumped (so the grid ripple, the screen shake and the death SFX
   * all stay silent — keeping the streak and the position is the whole value of the pick).
   *
   * The Lv5 break pulse fires ONLY when the FINAL charge breaks (the count reaches 0)
   * AND knockback is enabled — a 3→2 or 2→1 break fires nothing.
   * @returns {boolean} true if a charge was spent (the death is absorbed).
   */
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

  /**
   * The Lv5 break pulse: shove every nearby COMBAT enemy away from the ship.
   *
   * It MOVES enemies and nothing else — no damage, no hp change, no release, no kill
   * report, no score. Scoped to `enemyPools` only (never `deathPools`), so the Black
   * Hole and the Mirror Reflector are untouched — the same AoE scoping
   * BombSystem.detonateAt applies.
   *
   * It is a POSITION displacement, not a velocity impulse, deliberately: EnemySystem and
   * ArmoredSystem recompute vx/vy toward the ship every tick, so a velocity force would
   * be erased before it moved anything — the identical reasoning BlackHoleSystem records
   * for its gravity nudge. Running from PlayerDeathSystem's late slot (after every mover
   * has already integrated) is what makes the displacement persist this tick.
   *
   * Safe to iterate the pools directly: the callback mutates only x/y and never the
   * active set, so no materialization pass is needed and nothing allocates.
   * @private
   */
  _pulse() {
    const pools = this.enemyPools;
    if (!pools) return;
    for (let p = 0; p < pools.length; p++) {
      pools[p].forEachActive(this._pushEnemy);
    }
  }

  /**
   * Displace ONE enemy outward from the ship: `SHIELD_KNOCKBACK_PUSH × (1 − d/RADIUS)`
   * along unit(e − ship) — BlackHoleSystem._pull inverted (push, not pull), with the
   * same `d > 0` no-direction guard and WITHOUT its `dtSec` scaling (this is an
   * instantaneous event, not a per-tick force).
   *
   * Skipped for a TELEGRAPHING (spawning-in) enemy — inert to world forces, exactly as
   * BlackHoleSystem gravity treats it — and for an enemy exactly on the ship (d === 0:
   * no direction).
   *
   * The displacement is built from UNIT components (`dx/d`, `dy/d`) rather than from a
   * `push/d` scale factor, so no NaN can ever be written to x/y. At a DENORMAL
   * separation `push / d` overflows to Infinity, and `0 * Infinity` is NaN — which the
   * clamp below cannot catch either, since every `<`/`>` comparison against NaN is
   * false. `dx/d` is bounded by 1 for every d > 0, so the product stays finite.
   *
   * The result is clamped back inside the arena INTERIOR, inset by the enemy's own
   * radius (the ARENA_BORDER_INSET convention spawnPlacement/PinwheelSystem use), so a
   * break against a wall cannot shove enemies outside the drawn border. An axis is
   * clamped ONLY when the enemy was already within that bound before the push: enemies
   * DO legitimately sit outside the border (SnakeSystem.spawn trails body segments up to
   * ~154px outside it, and they all un-telegraph together), and clamping one of those
   * back to the border would drag it TOWARD the ship — the exact opposite of the pulse's
   * job. Guarded this way, the pulse can never reduce an enemy's distance from the ship.
   * @private
   */
  _push(e) {
    if (e.telegraphMs > 0) return;
    const ship = this.ship;
    const dx = e.x - ship.x;
    const dy = e.y - ship.y;
    const d = Math.hypot(dx, dy);
    if (!(d > 0) || d >= SHIELD_KNOCKBACK_RADIUS) return;
    const push = SHIELD_KNOCKBACK_PUSH * (1 - d / SHIELD_KNOCKBACK_RADIUS);
    // Unit direction, away from the ship. |dx/d| <= 1 for every d > 0, so both
    // components are finite even at a denormal separation.
    const ux = dx / d;
    const uy = dy / d;
    const r = e.radius;
    const minX = ARENA_BORDER_INSET + r;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - r;
    const minY = ARENA_BORDER_INSET + r;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - r;
    let x = e.x + ux * push;
    let y = e.y + uy * push;
    // Clamp only the bounds the enemy started INSIDE (see the note above).
    if (x < minX) {
      if (e.x >= minX) x = minX;
    } else if (x > maxX) {
      if (e.x <= maxX) x = maxX;
    }
    if (y < minY) {
      if (e.y >= minY) y = minY;
    } else if (y > maxY) {
      if (e.y <= maxY) y = maxY;
    }
    e.x = x;
    e.y = y;
  }

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
   * circle-circle test, release via applyPlayerDamage.
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
      pools[p].forEachActive(this._collectPhaseEnemy);
    }
    const ship = this.ship;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // Telegraphing and stunned enemies are immune to intangible touch damage.
      if (e.telegraphMs > 0 || e.stunMs > 0) continue;
      const dx = ship.x - e.x;
      const dy = ship.y - e.y;
      const r = ship.radius + e.radius;
      // Squared compare avoids a sqrt; ≤ so boundary touch counts.
      if (dx * dx + dy * dy <= r * r) {
        cs.applyPlayerDamage(e, owners[i], PHASE_CONTACT_DAMAGE);
      }
    }
  }
}
