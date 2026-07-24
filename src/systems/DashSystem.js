import { System } from '../core/System.js';
import {
  DASH_DURATION_MS,
  DASH_COOLDOWN_FLOOR_MS,
  DASH_CONTACT_DAMAGE,
} from '../config/constants.js';

// DashSystem — the Afterburner dash's RUNTIME state (Story 10.5 / PRD §13.4),
// Phaser-free.
//
// Afterburner is the second Epic-10 item whose effect is not a pure stat read, and the
// SPLIT of responsibility mirrors NaniteShieldSystem's exactly:
//   - the FOLD (state/PlayerStats.js) owns the DERIVED PARAMETERS — `dashCooldownMs`
//     (which doubles as the enable flag) plus the `dashIFrames`/`dashDamage`/`dashTrail`
//     flags;
//   - THIS system owns the LIVE cooldown, the active window and the dash direction.
// They are split because `recomputePlayerStats` resets every field and re-derives the
// whole store on EVERY card pick: a live cooldown kept there would be silently refunded
// by picking any unrelated item (a free dash once per level).
//
// It does NOT move the ship. PlayerMovementSystem stays the SOLE writer of
// ship.vx/vy/x/y and reads this system's window; this system owns the window, the
// direction and the damage sweep. Two movers is the failure mode that rule prevents.
//
// REGISTRATION SLOT (see scenes/buildArenaWorld.js) is load-bearing in three
// directions. It is registered immediately AFTER CollisionSystem and BEFORE
// ScoringSystem so that:
//   - its kills append to CollisionSystem's per-tick kill latches AFTER that system has
//     already RESET them at the top of its own fixedUpdate (registering earlier would
//     drop them into arrays about to be cleared);
//   - its kills are SCORED, and reach DpsTelemetrySystem / XpOrbSystem / GridFieldSystem
//     / ParticleSystem, so a dash kill pays out score, XP, a ripple and a spray exactly
//     like a bullet kill. (BombSystem's deliberately UNSCORED removal is the
//     ANTI-pattern here: a panic button should not farm score, but XP is progression
//     currency and a dash that ate enemies silently would be a hidden penalty for using
//     the item.)
//   - it is necessarily LATER in the tick than PlayerMovementSystem, so movement applies
//     the window one fixed step (16.7ms) after it opens.
//
// THE `movementActive` FLAG. That one-step lag is why `active` alone is not safe to
// read: movement sees the flag as the PREVIOUS tick left it, while PlayerDeathSystem and
// ParticleSystem — both later than this system — would see it as THIS tick left it.
// Those are different windows, offset in opposite directions, which on the first attempt
// left the final ~22px of dash travel unprotected. So the VERY FIRST statement of
// fixedUpdate republishes `movementActive = active`: precisely what movement acted on
// earlier this tick. Every downstream consumer (the i-frame gate, the damage sweep, the
// trail) reads `movementActive`, never `active`, so the moving / protected / damaged /
// trailing windows are the SAME set of ticks by construction.
//
// Each fixed step:
//   0. publish `movementActive` (before any mutation — see above);
//   1. tick the cooldown down, clamped at 0;
//   2. if a dash is active, tick its remaining window down and close it at <= 0;
//   3. if Lv4+ and the window was open this tick, sweep enemies in contact range and
//      route each through CollisionSystem.applyPlayerDamage;
//   4. read-and-clear the input latch and, if everything is ready, open a new dash.
//
// Zero per-tick allocation: scalar arithmetic on the idle path, and the sweep uses
// hoisted collectors + length-reset scratch arrays (the CollisionSystem pattern).
export class DashSystem extends System {
  /**
   * @param {{x:number,y:number,angle:number,radius:number}} ship The player ship — read
   *   for the sweep origin and the zero-intent facing fallback. NEVER mutated here.
   * @param {import('../input/InputState.js').InputState} inputState The shared input
   *   state: the `dashQueued` latch is read-and-cleared each step, and moveX/moveY give
   *   the dash direction.
   * @param {import('../core/Pool.js').Pool[]} enemyPools The five COMBAT archetype pools
   *   the Lv4+ contact sweep damages. Deliberately `enemyPools`, never `deathPools`: the
   *   Black Hole and the Mirror Reflector are out of scope, the same scoping
   *   NaniteShieldSystem's pulse and BombSystem.detonateAt apply.
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The shared
   *   damage seam — every dash hit goes through its `applyPlayerDamage`, so armor,
   *   scoring, XP and the kill latches behave exactly as for a bullet. (Holding the
   *   collision system is the BombSystem precedent.)
   * @param {Object<string,number>|null} [playerStats=null] The shared player-stat store
   *   the dash parameters are read from (optional — a null store means no dash ever,
   *   i.e. exactly the pre-10.5 behavior).
   */
  constructor(ship, inputState, enemyPools, collisionSystem, playerStats = null) {
    super();
    this.ship = ship;
    this.inputState = inputState;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;

    // Public runtime state.
    /**
     * The internal window bookkeeping: true while a dash is in flight. MUTATED
     * mid-tick (opened in step 4, closed in step 2), so nothing outside
     * PlayerMovementSystem — which runs BEFORE this system and therefore reads it as
     * the previous tick left it — should read this. Consumers read `movementActive`.
     */
    this.active = false;
    /**
     * The PUBLISHED window: the value `active` had when PlayerMovementSystem read it
     * earlier in THIS tick. Captured as the first statement of fixedUpdate. This is the
     * one flag the i-frame gate, the damage sweep and the trail all read, which is what
     * makes their windows identical to the ticks the ship actually travelled.
     */
    this.movementActive = false;
    /** Milliseconds left in the active window (0 when idle). */
    this.remainingMs = 0;
    /** Milliseconds left before another dash may be started (0 when ready). */
    this.cooldownRemainingMs = 0;
    /** Unit dash direction, frozen at the moment the dash opened. */
    this.dirX = 0;
    this.dirY = 0;
    /**
     * Public read-only observability latch, mirroring NaniteShieldSystem.absorbSeq: a
     * monotonic count of dashes STARTED. It exists because neither a consumed-and-
     * discarded press nor a real start changes `active` on a tick where a dash is
     * already running — without this, "a dash began" would be indistinguishable from
     * "the press was dropped". It ALSO doubles as the per-dash hit stamp (see the
     * sweep below), so the two uses share one monotonic counter.
     */
    this.dashSeq = 0;

    // Reusable sweep scratch so the damage path allocates nothing: the materialized
    // active enemies and a parallel array of each one's owning pool (so a kill's
    // release routes to the correct pool) — the CollisionSystem/BombSystem convention.
    // Materialize-then-mutate: releasing inside forEachActive would mutate the pool's
    // active Set mid-iteration.
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };
  }

  /**
   * The sanitized dash cooldown interval (ms), or 0 meaning NO DASH AT ALL.
   *
   * Mirrors FiringSystem._mult's shape but fails CLOSED where the shield's recharge
   * reader fails open, and deliberately so: a junk `shieldRechargeMs` still leaves a
   * shield that works (just at a floored rate), because the value only tunes a rate. A
   * junk `dashCooldownMs` is different — the interval IS the enable flag (Lv1 owns no
   * dash precisely because the field is 0), so falling back to a floor would MINT a
   * dash the build never bought.
   *   - no store / missing field / non-finite / <= 0  → 0, i.e. NO dash (pre-10.5);
   *   - finite positive but below the floor           → clamped UP to
   *     DASH_COOLDOWN_FLOOR_MS, so a corrupted 1e-9 permits at most one dash per floor
   *     interval rather than one per tick.
   * Allocates nothing.
   * @returns {number} the sanitized interval in ms, or 0 for "dash disabled".
   */
  _cooldownMs() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.dashCooldownMs;
    if (!Number.isFinite(v) || v <= 0) return 0;
    return v < DASH_COOLDOWN_FLOOR_MS ? DASH_COOLDOWN_FLOOR_MS : v;
  }

  /**
   * Whether the Lv3+ dash i-frames are enabled — the `dashIFrames` flag, sanitized on
   * the NaniteShieldSystem._knockbackEnabled terms: a missing store, a missing field, a
   * non-finite value, a string, or anything below 1 all resolve to DISABLED.
   * Allocates nothing.
   * @returns {boolean}
   */
  _iFramesEnabled() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return false;
    const v = ps.dashIFrames;
    return Number.isFinite(v) && v >= 1;
  }

  /**
   * Whether the Lv4+ dash contact damage is enabled — the `dashDamage` flag, sanitized
   * exactly as `_iFramesEnabled`. The damage MAGNITUDE is the DASH_CONTACT_DAMAGE
   * constant, never a fold field.
   * @returns {boolean}
   */
  _damageEnabled() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return false;
    const v = ps.dashDamage;
    return Number.isFinite(v) && v >= 1;
  }

  /**
   * Whether the Lv5 burning dash trail is enabled — the `dashTrail` flag, sanitized
   * exactly as `_iFramesEnabled`. Cosmetic only.
   * @returns {boolean}
   */
  _trailEnabled() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return false;
    const v = ps.dashTrail;
    return Number.isFinite(v) && v >= 1;
  }

  /**
   * Whether the build currently OWNS a dash at all — i.e. the sanitized cooldown is a
   * real positive interval. False at Lv0 and Lv1, true from Lv2. This is what the touch
   * button's ownership gate reads (via ArenaScene → PlayerInputSampler.setDashEnabled),
   * so the on-screen button exists exactly when the capability does.
   * @returns {boolean}
   */
  dashEnabled() {
    return this._cooldownMs() > 0;
  }

  /**
   * Whether the player is dash-invulnerable RIGHT NOW: the published window AND the
   * Lv3+ flag. Read by PlayerDeathSystem. Reading `movementActive` (not `active`) is
   * what makes the protected ticks exactly the ticks the ship travelled.
   * @returns {boolean}
   */
  iFramesActive() {
    return this.movementActive && this._iFramesEnabled();
  }

  /**
   * Whether the Lv5 burning trail should be emitted RIGHT NOW: the published window AND
   * the flag. Read by ParticleSystem, on the same `movementActive` terms as the i-frames.
   * @returns {boolean}
   */
  trailActive() {
    return this.movementActive && this._trailEnabled();
  }

  /**
   * CANCEL an in-flight dash: close the window immediately (both the internal `active`
   * and the published `movementActive`, and zero `remainingMs`) while leaving
   * `cooldownRemainingMs` UNTOUCHED — the dash was spent, so it is not refunded.
   *
   * Called by PlayerDeathSystem._applyDeath. Without it, a death during an UNPROTECTED
   * (Lv2, no i-frames) dash leaves the window open: the respawn re-parks the ship at
   * arena centre and the movement dash branch immediately flings it ~238px back out
   * during its invulnerability window.
   */
  cancel() {
    this.active = false;
    this.movementActive = false;
    this.remainingMs = 0;
  }

  /**
   * Advance one fixed step.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    // (0) FIRST, before any mutation: republish the window PlayerMovementSystem acted
    // on earlier this tick (it runs before this system — see the class header). Every
    // downstream consumer reads THIS, never `active`, so the moving / protected /
    // damaged / trailing windows are the same ticks instead of offset by one step.
    this.movementActive = this.active;

    // (1) Cooldown countdown, clamped at 0.
    if (this.cooldownRemainingMs > 0) {
      this.cooldownRemainingMs -= dt;
      if (this.cooldownRemainingMs < 0) this.cooldownRemainingMs = 0;
    }

    // (2) Window countdown. Closing here (after movement already applied this tick's
    // travel) is what makes `movementActive` the honest record of the travelled ticks.
    if (this.active) {
      this.remainingMs -= dt;
      if (this.remainingMs <= 0) {
        this.remainingMs = 0;
        this.active = false;
      }
    }

    // (3) Lv4+ contact sweep, over the window's ticks only.
    if (this.movementActive && this._damageEnabled()) {
      this._sweep();
    }

    // (4) Input. Read-and-clear ALWAYS — a press during the cooldown or mid-dash is
    // DISCARDED rather than buffered into the next opening, so holding the button
    // cannot bank dashes and a mistimed tap does not fire later by surprise.
    const pressed = this.inputState ? this.inputState.consumeDash() : false;
    if (!pressed) return;
    if (this.active) return; // already dashing — no second dash, no cooldown refresh
    if (this.cooldownRemainingMs > 0) return; // still cooling down
    const cooldown = this._cooldownMs();
    if (cooldown <= 0) return; // no dash owned (Lv0/Lv1, or a junk store)

    // Direction: the normalized move intent, or — at zero intent — the ship's current
    // facing, which always exists (PlayerMovementSystem holds the last facing angle at
    // rest). Normalizing here means a half-deflected stick dashes the full distance.
    const mx = this.inputState.moveX;
    const my = this.inputState.moveY;
    const mag = Math.hypot(mx, my);
    if (mag > 0) {
      this.dirX = mx / mag;
      this.dirY = my / mag;
    } else {
      this.dirX = Math.cos(this.ship.angle);
      this.dirY = Math.sin(this.ship.angle);
    }

    this.active = true;
    this.remainingMs = DASH_DURATION_MS;
    // The cooldown starts at dash START, not at its end. The window (180ms) always
    // closes long before the shortest shipped cooldown (2000ms) elapses, so the two
    // never race.
    this.cooldownRemainingMs = cooldown;
    this.dashSeq += 1;
  }

  /**
   * The Lv4+ contact sweep: damage every COMBAT enemy overlapping the ship right now.
   *
   * ONE HIT PER DASH, not per tick. The sweep re-runs every tick of the window at the
   * ship's CURRENT position — which is right for covering the whole dash PATH (per-tick
   * travel at DASH_SPEED is ~21.7px, well under the smallest contact radius, so nothing
   * tunnels through) — but the arena clamp can hold the ship stationary for the entire
   * window, and an enemy pinned between ship and wall would then take one hit per tick
   * from a single press (~10× the damage and ~10 units into the Story 9.2 DPS
   * governor). A per-dash stamp is the conventional melee-sweep semantic.
   *
   * The stamp is `dashSeq` rather than a Set for two reasons: it allocates NOTHING (the
   * `_dashHitSeq` field is added once per pooled object, not once per tick), and because
   * `dashSeq` only ever INCREASES a pooled enemy can never carry a stale stamp forward
   * into a later dash — a recycled instance's old stamp can never equal a future seq.
   *
   * Every hit routes through CollisionSystem.applyPlayerDamage, so armor, the kill
   * latches, the coordinate/XP snapshots and `bulletDamageCount` behave exactly as for
   * a bullet. Materialize-then-mutate: a kill releases the enemy to its pool, which
   * cannot be done inside forEachActive.
   * @private
   */
  _sweep() {
    const pools = this.enemyPools;
    const cs = this.collisionSystem;
    if (!pools || !cs) return;
    const enemies = this._enemies;
    const owners = this._owners;
    enemies.length = 0;
    owners.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }
    const ship = this.ship;
    const seq = this.dashSeq;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // A telegraphing (spawning-in) enemy is inert to the dash, the same single
      // non-lethality seam CollisionSystem/PlayerDeathSystem/the shield pulse respect.
      if (e.telegraphMs > 0) continue;
      // Already hit by THIS dash — skip for the rest of the window.
      if (e._dashHitSeq === seq) continue;
      const dx = ship.x - e.x;
      const dy = ship.y - e.y;
      const r = ship.radius + e.radius;
      // Squared compare avoids a sqrt; <= so a boundary touch counts, mirroring every
      // other contact test in the sim.
      if (dx * dx + dy * dy <= r * r) {
        e._dashHitSeq = seq;
        cs.applyPlayerDamage(e, owners[i], DASH_CONTACT_DAMAGE);
      }
    }
  }
}
