import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIRE_INTERVAL_MS,
  FIRE_INTERVAL_FLOOR_MS,
  FIRE_INTERVAL_CEIL_MS,
  PLAYER_BULLET_BASE_DAMAGE,
  PLAYER_BULLET_MIN_DAMAGE,
  BULLET_SPEED,
  BULLET_POOL_PREWARM,
} from '../config/constants.js';

/**
 * True when `v` is a PLAIN object — an object literal or a null-prototype object, and
 * NOT an array, Map, Set, Date, typed array or class instance. Deliberately a check on
 * the CONTAINER only, never on the field values: the I/O contract requires a
 * degenerate `fireRateMult`/`damageMult` (missing, 0, negative, NaN, a string) to be
 * SANITIZED to the base at read time, not to throw, so field-level validation belongs
 * in `_mult` and nowhere else. Construction-time only.
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * A short human label for a rejected `playerStats` argument, so the thrown message
 * names what actually arrived rather than the useless "object".
 * @param {unknown} v
 * @returns {string}
 */
function describeBadStore(v) {
  if (Array.isArray(v)) return 'array';
  if (typeof v !== 'object') return typeof v;
  const name = v.constructor && v.constructor.name;
  return name && name !== 'Object' ? `${name} instance` : 'a non-plain object';
}

// FiringSystem — continuous auto-fire + bullet flight (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, so the
// shots-per-second and bullet motion are identical regardless of render frame
// rate. Owns the bullet Pool (the single source of active/free truth — bullets
// are NOT in world.entities, to avoid splice/indexOf churn). Each fixed step it:
//   1. advances every active bullet and despawns any whose center has crossed
//      the arena border (back to the pool),
//   2. while the aim channel is active, accumulates dt and spawns one bullet per
//      FIRE_INTERVAL_MS in the aim direction from the ship nose.
//
// Bullet velocity comes ONLY from the aim direction × BULLET_SPEED — never the
// ship's velocity. That is the FR1 independence guarantee, by construction. The
// steady-state spawn/despawn path allocates nothing: the pool recycles freed
// instances and a reusable scratch array collects deferred releases.
//
// Story 10.2 (Overcharge) adds the player-stat reads. The OPTIONAL `playerStats`
// store (state/PlayerStats.js — the one instance buildArenaWorld creates and
// LevelUpSystem folds in place on every card pick) supplies two multipliers, read
// LIVE from the shared object each tick so an upgrade takes effect with no system
// reconstruction:
//   - fireRateMult → the effective spawn interval, FIRE_INTERVAL_MS / fireRateMult
//     clamped into [FIRE_INTERVAL_FLOOR_MS, FIRE_INTERVAL_CEIL_MS] (both ends are
//     spawn-loop termination guards, never balance levers);
//   - damageMult   → each spawned bullet's `damage`, stamped ONCE at spawn from
//     PLAYER_BULLET_BASE_DAMAGE × damageMult (so an in-flight bullet keeps the
//     damage it was fired with).
// With no store (or a base store) every behavior is identical to pre-10.2.
export class FiringSystem extends System {
  /**
   * @param {{x:number,y:number,radius:number}} ship Aim origin (fire from nose).
   * @param {import('../input/InputState.js').InputState} inputState Aim channel.
   * @param {Object<string, number>} [playerStats] The shared runtime modifier store
   *   (Story 10.1). Optional: OMITTED (undefined/null) keeps the exact pre-10.2 base
   *   behavior, so a two-arg caller is unchanged. A PRESENT argument that is not a
   *   plain object throws.
   * @throws {TypeError} when `playerStats` is present but not a plain object.
   */
  constructor(ship, inputState, playerStats = null) {
    super();
    this.ship = ship;
    this.input = inputState;
    // Fail LOUD on a wrong-typed third argument. Silently degrading to base
    // cadence + base damage would make a
    // positional-argument mistake indistinguishable from a content bug — the symptom
    // is "Overcharge does nothing" for the whole run, with no diagnostic.
    //
    // The check is on the CONTAINER, not on `typeof`. `typeof x === 'object'` is true
    // of every array, Map, Set, Date, typed array and class instance, so a bare type
    // test lets through most of the wrong-slot values actually in scope at the
    // buildArenaWorld call site — each of which reads as an empty stat store and
    // yields base cadence + base damage for the whole run. Requiring a PLAIN object
    // rejects that whole class. It stops at the container on purpose: the I/O contract
    // requires a degenerate FIELD (missing, 0, negative, NaN) to be sanitized to the
    // base at read time rather than throw, so a plain object with junk values is
    // legal here and `_mult` handles it. Omitting the argument entirely is still legal
    // (base behavior).
    //
    // NOTE — this guard is deliberately STRONGER than LevelUpSystem's arg-5 guard on
    // the SAME shared store, which is still a bare `typeof === 'object'` and therefore
    // accepts arrays, Map, Set, Date, typed arrays and class instances. That asymmetry
    // is known and tracked as DW-371; it was not closed here because LevelUpSystem.js
    // is Story 10.1's code, outside this story's change surface. Do not read the two
    // guards as equivalent.
    if (playerStats != null && !isPlainObject(playerStats)) {
      throw new TypeError(
        'FiringSystem: `playerStats` (arg 3) must be a PlayerStats object ' +
          '(a plain object) or omitted — ' +
          `received ${describeBadStore(playerStats)}. ` +
          'Did you pass a positional argument in the wrong slot?',
      );
    }
    // Captured ONCE: the fold (recomputePlayerStats) mutates this object IN PLACE, so
    // holding the reference is what makes a mid-run upgrade visible here with no
    // reconstruction.
    this.playerStats = playerStats != null ? playerStats : null;

    /** Pool of bullets — the single source of active/free truth (public for
     *  Story 1.4 collision). */
    this.bulletPool = new Pool(createBullet);
    // Prewarm: build the free list up front so steady-state spawns never hit
    // the factory (no allocation once running). Acquire then release so the
    // instances land on the free stack.
    const warm = [];
    for (let i = 0; i < BULLET_POOL_PREWARM; i++) {
      warm.push(this.bulletPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.bulletPool.release(warm[i]);
    }

    // Reusable scratch buffer for deferred releases — Pool.forEachActive forbids
    // mutating the active set mid-iteration, so expired bullets are collected
    // here and released in a second pass. Reused every tick (no per-frame alloc).
    this._expired = [];
    // Per-tick delta (seconds) stashed on `this` so the hoisted collector can read
    // it without capturing a fresh per-tick closure (mirrors CollisionSystem's
    // `_currentPool`). Set at the top of every fixedUpdate before iterating.
    this._dtSec = 0;
    // Hoisted expired-bullet collector — a stable instance-field arrow created once,
    // so `forEachActive` reuses one closure instead of allocating a fresh arrow per
    // tick. Advances each active bullet and collects any that left the arena.
    this._collectExpired = (b) => {
      b.x += b.vx * this._dtSec;
      b.y += b.vy * this._dtSec;
      if (isOutsideArena(b.x, b.y)) {
        this._expired.push(b);
      }
    };
    // Fire-cadence accumulator (ms). Seeded to the EFFECTIVE interval so the first
    // active tick fires immediately (responsive), not after a full interval of
    // delay — at base this is exactly FIRE_INTERVAL_MS, as before Story 10.2.
    this._accumMs = this._fireIntervalMs();

    // Public read-only observability latch (Story 4.5): the number of bullets THIS
    // system spawned this tick. Reset at the top of every fixedUpdate (so an empty
    // tick reports 0 and a shot is never counted twice), then ++ per bullet spawned.
    // Read by the AudioDirectorSystem (fire SFX source) — mirrors
    // CollisionSystem.bulletKillCount. Purely observational: it never affects the
    // fire cadence, cap, mix, or placement.
    this.shotsFiredCount = 0;
  }

  /**
   * Read one multiplier off the shared player-stat store, sanitized (Story 10.2).
   * A missing store, a missing field, or a non-finite / non-positive value all
   * resolve to 1 — the base, i.e. exactly the pre-10.2 behavior. Keeping the
   * sanitize here means a degenerate `fireRateMult` can never produce a zero or
   * negative interval (which would hang the spawn `while` loop) and a degenerate
   * `damageMult` can never stamp a NaN onto a bullet. Returns a number; allocates
   * nothing.
   * @param {string} key The stat field ('damageMult' | 'fireRateMult').
   * @returns {number} the sanitized multiplier (> 0, finite).
   */
  _mult(key) {
    const ps = this.playerStats;
    if (ps === null) return 1;
    const v = ps[key];
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  /**
   * The EFFECTIVE spawn interval (ms) for the current player stats: the base
   * FIRE_INTERVAL_MS divided by the sanitized `fireRateMult`, floored at
   * FIRE_INTERVAL_FLOOR_MS. The floor is a SAFETY guard (a strictly positive
   * interval is what makes the spawn `while` loop terminate), never a balance
   * lever. At base this returns exactly FIRE_INTERVAL_MS. Allocates nothing.
   *
   * The result is guarded at BOTH ends, and the upper end has two layers because
   * finiteness alone is not enough. The FLOOR stops a huge multiplier driving the
   * interval toward 0 (an unbounded number of spawns banked per tick). The finite
   * check stops a DENORMAL-tiny positive multiplier (e.g. 5e-324 — finite and > 0, so
   * `_mult` accepts it) overflowing the quotient to Infinity. The CEILING stops the
   * case in between, which the finite check alone misses: `fireRateMult = 1e-12` is
   * finite and > 0 and yields a finite 9e13 ms. Any of these, latched into `_accumMs`
   * by the non-aiming branch, has to be worked back down one interval at a time by
   * the spawn `while` — 1.4e12 iterations for the 9e13 case, which is a fixed-step
   * hang in everything but name. Clamping to FIRE_INTERVAL_CEIL_MS keeps the value
   * itself sane; `fixedUpdate` bounds the drain to one interval of banked credit.
   *
   * The result is MONOTONE in `fireRateMult`: a smaller multiplier never yields a
   * shorter interval. That is why the non-finite branch returns the CEILING and not
   * FIRE_INTERVAL_MS — the overflow only happens for a multiplier BELOW the ones the
   * ceiling already handles (the quotient overflows at fireRateMult < ~5.006e-307), so
   * returning the base interval there made 5e-324 fire 100x faster than 1e-300. Both
   * upper-end branches now mean the same thing: a broken-tiny multiplier gives the
   * slowest legal gun, never the fastest.
   * @returns {number} interval in ms, always finite and in
   *   [FIRE_INTERVAL_FLOOR_MS, FIRE_INTERVAL_CEIL_MS].
   */
  _fireIntervalMs() {
    const interval = FIRE_INTERVAL_MS / this._mult('fireRateMult');
    // Non-finite (Infinity from a denormal divisor, or NaN) → the ceiling, which is
    // where every other tiny-multiplier value already lands. See the monotonicity
    // note above: falling back to the BASE interval here inverts the ordering.
    if (!Number.isFinite(interval)) return FIRE_INTERVAL_CEIL_MS;
    return Math.min(
      FIRE_INTERVAL_CEIL_MS,
      Math.max(FIRE_INTERVAL_FLOOR_MS, interval),
    );
  }

  /**
   * Advance one fixed step: integrate + despawn bullets, then spawn at cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const pool = this.bulletPool;

    // Reset the per-tick shots-fired report (Story 4.5) so a tick with no spawns
    // reports 0 and a prior tick's shots are never re-counted.
    this.shotsFiredCount = 0;

    // 1. Advance existing bullets; collect any that have left the arena. Runs
    //    even when aim is inactive so in-flight bullets keep travelling. Stash
    //    dtSec on `this` so the hoisted collector reads it without a fresh closure.
    this._dtSec = dtSec;
    this._expired.length = 0;
    pool.forEachActive(this._collectExpired);
    // Deferred release (second pass — safe to mutate the active set now).
    for (let i = 0; i < this._expired.length; i++) {
      pool.release(this._expired[i]);
    }

    // 2. Spawn at a fixed cadence while aiming; bullet velocity derives ONLY
    //    from the aim direction × BULLET_SPEED (never the ship's velocity).
    //
    //    The cadence is the EFFECTIVE interval, recomputed once per tick from the
    //    live shared store (Story 10.2): FIRE_INTERVAL_MS / fireRateMult, floored at
    //    FIRE_INTERVAL_FLOOR_MS so the `while` below always terminates. At base
    //    (fireRateMult === 1) this is exactly FIRE_INTERVAL_MS — identical to
    //    pre-10.2. Two primitive locals, no allocation.
    const interval = this._fireIntervalMs();
    const input = this.input;
    if (input.aimActive) {
      // Per-bullet damage, resolved once per tick and stamped onto each bullet
      // spawned THIS tick (an in-flight bullet keeps its own stamped value).
      // Floored at PLAYER_BULLET_MIN_DAMAGE at the PRODUCER, so the value on the wire
      // is always one a finite-hp enemy can actually be killed by. `_mult` sanitizes
      // non-finite/non-positive multipliers to 1, but a finite tiny-positive one (1e-12)
      // survives it and would stamp a damage below ulp(hp), where `hp -= damage` is an
      // exact no-op. CollisionSystem clamps too, but as a fallback for FOREIGN bullets:
      // one policy, owned here, so any second consumer of `bullet.damage` (Story 10.3's
      // Spread Cannon, a damage readout) reads an already-valid number.
      const damage = Math.max(
        PLAYER_BULLET_MIN_DAMAGE,
        PLAYER_BULLET_BASE_DAMAGE * this._mult('damageMult'),
      );
      // Discard credit banked at a LONGER interval before accruing this tick's.
      // `_accumMs < interval` holds at the end of every tick (the `while` below
      // establishes it), so this is a no-op in all normal operation — it fires only
      // when `interval` SHRANK since the last tick, which is the one case that can
      // bank an unbounded backlog: a tiny fireRateMult parks up to
      // FIRE_INTERVAL_CEIL_MS of credit (either accrued while aiming at a long
      // interval, or seeded by the non-aiming branch below), and without this clamp a
      // return to a normal multiplier drains it ~140 spawns at a time — each a
      // pool.acquire(), growing the bullet pool past BULLET_POOL_PREWARM inside a
      // single fixed step. Clamping bounds the spawn loop at 1 + dt/interval for ANY
      // interval change, which is also what makes the "re-aiming fires at once with no
      // burst" promise below true at every multiplier.
      if (this._accumMs > interval) this._accumMs = interval;
      this._accumMs += dt;
      while (this._accumMs >= interval) {
        const b = pool.acquire();
        // Emerge from the ship nose along the aim direction.
        b.x = this.ship.x + input.aimX * this.ship.radius;
        b.y = this.ship.y + input.aimY * this.ship.radius;
        b.vx = input.aimX * BULLET_SPEED;
        b.vy = input.aimY * BULLET_SPEED;
        b.damage = damage; // Story 10.2 — stamped ONCE, at spawn
        this.shotsFiredCount++; // Story 4.5 read-only fire-event counter
        this._accumMs -= interval;
      }
    } else {
      // Reset so re-aiming fires at once with no accumulated backlog/burst. Seeded
      // to the CURRENT effective interval so the first tick after re-aiming fires
      // immediately at any fire rate.
      this._accumMs = interval;
    }
  }
}

/**
 * True when a point's center has crossed the drawn arena border (the inset
 * boundary) on any side.
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isOutsideArena(x, y) {
  return (
    x < ARENA_BORDER_INSET ||
    x > ARENA_WIDTH - ARENA_BORDER_INSET ||
    y < ARENA_BORDER_INSET ||
    y > ARENA_HEIGHT - ARENA_BORDER_INSET
  );
}
