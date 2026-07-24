import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import {
  resolveRicochetParams,
  stampRicochet,
  reflectBulletOffWall,
} from './ricochet.js';
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
  SPREAD_MAX_WAYS,
  SPREAD_MAX_ARC_DEG,
} from '../config/constants.js';

// Degrees → radians, for the volley cone (Story 10.3). Module-level so the conversion
// is a constant multiply, never a per-build expression.
const DEG_TO_RAD = Math.PI / 180;

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
//
// Story 10.3 (Spread Cannon) turns a single shot into a VOLLEY, reading two more fields
// off the same live store:
//   - spreadWays   → bullets emitted per volley (sanitized: anything < 2 is the single
//     shot, so an unowned Spread Cannon is exactly the pre-10.3 gun);
//   - spreadArcDeg → the volley's TOTAL cone angle in degrees, CENTERED on the aim
//     direction — NOT the gap between adjacent bullets. The `ways` bullets are spaced
//     EVENLY across that cone (3 ways / 12° → aim −6°, 0°, +6°), so every odd way count
//     keeps one bullet travelling exactly along aim.
// Each bullet's direction is the LIVE aim unit vector rotated by its own cached offset,
// and it spawns from the ship nose ALONG ITS OWN direction at BULLET_SPEED. The cos/sin
// offset table is rebuilt only when `(ways, arcDeg)` changes — i.e. on a card pick —
// into preallocated buffers, so the hot loop still allocates nothing. Both fields are
// clamped by SPREAD_MAX_WAYS / SPREAD_MAX_ARC_DEG, which are loop-termination SAFETY
// guards in the same shape as FIRE_INTERVAL_FLOOR_MS, never balance levers.
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
    // --- Story 11.5 Ricochet Rounds --------------------------------------------
    // The combat enemy pools, late-bound by buildArenaWorld AFTER enemyPools is assembled
    // (FiringSystem is constructed before it exists — the same late-bind pattern
    // snakeSystem.collisionSystem uses). Read ONLY for the Lv5 seek re-aim; null keeps the
    // pre-11.5 behaviour (no seek scan). FiringSystem runs before EnemySystem, so seek reads
    // enemy positions one tick stale — negligible at the fixed step.
    this.enemyPools = null;
    // Reusable ricochet-param scratch, resolved ONCE per tick from the live store and stamped
    // per bullet (the `damage`/`ways` convention — zero per-tick allocation).
    this._ricochet = {
      bouncesRemaining: 0,
      dmgPerBounce: 0,
      bounceOffEnemies: false,
      seek: false,
    };
    // True on a tick where a Lv5 seek build is active AND enemyPools is bound, so the common
    // no-ricochet path never materializes enemies. Set at the top of every fixedUpdate.
    this._seekActive = false;
    // Reusable scratch for the materialized non-telegraphing combat enemies (seek targets).
    // Length-reset each tick; the collector SKIPS a telegraphing enemy so a spawning-in enemy
    // is never a seek target (the SeekerDroneSystem convention).
    this._enemies = [];
    this._collectEnemy = (e) => {
      if (e.telegraphMs > 0) return;
      this._enemies.push(e);
    };
    // Hoisted expired-bullet collector — a stable instance-field arrow created once,
    // so `forEachActive` reuses one closure instead of allocating a fresh arrow per
    // tick. Seek-steers (Lv5) then advances each active bullet; on a border crossing it
    // reflects a bullet with budget (Ricochet) or collects it for release (pre-11.5 despawn).
    this._collectExpired = (b) => {
      // Seek steering (Ricochet Lv5): a bullet that has bounced re-aims toward the nearest
      // enemy at unchanged speed BEFORE integrating. Gated to seek+bounced (and a live seek
      // build), so an unowned build and an as-yet-unbounced seek bullet both pay nothing.
      if (this._seekActive && b.seek && b.bounced) {
        this._steerSeek(b);
      }
      b.x += b.vx * this._dtSec;
      b.y += b.vy * this._dtSec;
      if (isOutsideArena(b.x, b.y)) {
        // Ricochet: a bullet with bounce budget reflects off the wall and stays live; a
        // bullet with no budget (0 = unowned, or exhausted) despawns exactly as pre-11.5.
        if (b.bouncesRemaining > 0) {
          reflectBulletOffWall(b);
        } else {
          this._expired.push(b);
        }
      }
    };
    // Fire-cadence accumulator (ms). Seeded to the EFFECTIVE interval so the first
    // active tick fires immediately (responsive), not after a full interval of
    // delay — at base this is exactly FIRE_INTERVAL_MS, as before Story 10.2.
    this._accumMs = this._fireIntervalMs();

    // Public read-only observability latch (Story 4.5): the number of BULLETS THIS
    // system spawned this tick. Reset at the top of every fixedUpdate (so an empty
    // tick reports 0 and a shot is never counted twice), then ++ per bullet spawned.
    // Mirrors CollisionSystem.bulletKillCount. Purely observational: it never affects
    // the fire cadence, cap, mix, or placement.
    //
    // Story 10.3 kept this honest to its name — with Spread Cannon owned, a single
    // trigger-pull spawns `ways` bullets and this counts all of them, which is the whole
    // point of the story. The AUDIO cue therefore moved to `volleysFiredCount` below.
    this.shotsFiredCount = 0;
    // Public read-only observability latch (Story 10.3): the number of fire EVENTS —
    // VOLLEYS — this tick, incremented once per cadence interval regardless of how many
    // bullets that volley emitted. Reset alongside shotsFiredCount every tick.
    //
    // This, not shotsFiredCount, is the AudioDirectorSystem's fire cue: one trigger-pull
    // is one gunshot. Left on the bullet count, a 9-way build would peg the
    // AUDIO_SFX_FIRE_MAX_PER_FRAME cap on every single tick.
    this.volleysFiredCount = 0;

    // --- Story 10.3 cached per-bullet rotation table ---------------------------
    // Parallel cos/sin buffers holding each bullet's rotation offset from the aim
    // direction, preallocated at SPREAD_MAX_WAYS so a rebuild writes in place and the
    // fixed step never allocates. Rebuilt ONLY when `(ways, arcDeg)` differs from the
    // values the table was last built for — i.e. on a card pick, never per tick.
    this._offsetCos = new Float64Array(SPREAD_MAX_WAYS);
    this._offsetSin = new Float64Array(SPREAD_MAX_WAYS);
    // The (ways, arcDeg) pair the table currently holds. Seeded to -1/-1 (a pair no
    // sanitizer can produce) so the first real volley always builds.
    this._tableWays = -1;
    this._tableArcDeg = -1;
    // Rebuild counter — observability only (proves the table is NOT rebuilt per tick).
    this._tableBuilds = 0;
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
   * The sanitized number of bullets in one volley (Story 10.3) — an INTEGER in
   * [1, SPREAD_MAX_WAYS]. Mirrors `_mult`: the value comes off the shared store, so a
   * missing store, a missing field, or junk (NaN, Infinity, negative, fractional, 1e9)
   * must resolve to something the fan loop can terminate on rather than throw.
   *   - no store / non-finite / < 2  → 1, the pre-10.3 SINGLE shot;
   *   - fractional                   → floored to a whole bullet count;
   *   - absurdly large               → clamped to SPREAD_MAX_WAYS (a SAFETY guard: an
   *     unclamped 1e9 would ask the loop for a billion pool.acquire() calls inside one
   *     fixed step).
   * Returns a number; allocates nothing.
   * @returns {number} the sanitized way count (integer, 1..SPREAD_MAX_WAYS).
   */
  _spreadWays() {
    const ps = this.playerStats;
    if (ps === null) return 1;
    const v = ps.spreadWays;
    if (!Number.isFinite(v)) return 1;
    const ways = Math.floor(v);
    if (ways < 2) return 1;
    return ways > SPREAD_MAX_WAYS ? SPREAD_MAX_WAYS : ways;
  }

  /**
   * The sanitized TOTAL cone angle (degrees) of a volley, centered on aim (Story 10.3)
   * — a finite number in [0, SPREAD_MAX_ARC_DEG]. Sanitized on the same terms as
   * `_spreadWays`: a missing store/field, a non-finite value, or a non-positive one all
   * resolve to 0° (every bullet travels along aim — degenerate but well-defined, never a
   * NaN offset stamped into the rotation table), and an absurd value clamps to
   * SPREAD_MAX_ARC_DEG.
   *
   * The clamp here is GEOMETRIC, not numeric: cos/sin are bounded for every finite input,
   * and the non-finite check above has already run, so no arc value is numerically
   * dangerous. It exists so a corrupted arc still yields a forward-facing volley — see
   * the constant. Loop termination is guarded by SPREAD_MAX_WAYS alone.
   * Allocates nothing.
   * @returns {number} the sanitized total cone angle in degrees (0..SPREAD_MAX_ARC_DEG).
   */
  _spreadArcDeg() {
    const ps = this.playerStats;
    if (ps === null) return 0;
    const v = ps.spreadArcDeg;
    if (!Number.isFinite(v) || v <= 0) return 0;
    return v > SPREAD_MAX_ARC_DEG ? SPREAD_MAX_ARC_DEG : v;
  }

  /**
   * Ensure the cached per-bullet rotation table matches `(ways, arcDeg)`, rebuilding it
   * IN PLACE only when the pair changed since the last build (a card pick, effectively
   * — never per tick). Both arguments must already be sanitized, with `ways >= 2`.
   *
   * The offsets are spaced EVENLY across the TOTAL cone and centered on aim: bullet `i`
   * sits at `(i - (ways-1)/2) × arc/(ways-1)`. Written that way rather than as
   * `-arc/2 + i×step` so the CENTER bullet of an odd volley gets an offset of EXACTLY 0
   * — its direction is then bit-identical to the un-spread aim vector, not a
   * float-noise rotation of it.
   * @param {number} ways   integer >= 2, <= SPREAD_MAX_WAYS
   * @param {number} arcDeg finite >= 0, <= SPREAD_MAX_ARC_DEG
   * @returns {void}
   */
  _ensureOffsetTable(ways, arcDeg) {
    if (ways === this._tableWays && arcDeg === this._tableArcDeg) return;
    this._tableWays = ways;
    this._tableArcDeg = arcDeg;
    this._tableBuilds++;
    const step = (arcDeg * DEG_TO_RAD) / (ways - 1);
    const half = (ways - 1) / 2;
    for (let i = 0; i < ways; i++) {
      const off = (i - half) * step;
      this._offsetCos[i] = Math.cos(off);
      this._offsetSin[i] = Math.sin(off);
    }
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
   * The nearest materialized combat enemy to a point, or null when none exist (Ricochet Lv5
   * seek). Reads the hoisted `_enemies` scratch (already filtered of telegraphing enemies),
   * so it allocates nothing. Squared distance — no sqrt. Mirrors SeekerDroneSystem._nearestEnemy.
   * @param {number} x
   * @param {number} y
   * @returns {object|null}
   * @private
   */
  _nearestEnemy(x, y) {
    const enemies = this._enemies;
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  /**
   * Re-aim a bounced Ricochet Lv5 bullet's velocity toward the nearest combat enemy, PRESERVING
   * its current speed (a reflection-preserved |v|). With no target (empty arena) or a coincident
   * one, the velocity is left unchanged so the bullet flies straight on to a wall — which is what
   * guarantees a homing bullet still terminates (NFR11). Mutates the bullet in place; allocates
   * nothing. Mirrors SeekerDroneSystem's homing re-aim.
   * @param {{x:number,y:number,vx:number,vy:number}} b
   * @returns {void}
   * @private
   */
  _steerSeek(b) {
    const t = this._nearestEnemy(b.x, b.y);
    if (!t) return;
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const mag = Math.hypot(dx, dy);
    if (mag <= 0) return;
    const speed = Math.hypot(b.vx, b.vy);
    const inv = speed / mag;
    b.vx = dx * inv;
    b.vy = dy * inv;
  }

  /**
   * Advance one fixed step: integrate + despawn bullets, then spawn at cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const pool = this.bulletPool;

    // Reset the per-tick fire reports (Story 4.5 bullets, Story 10.3 volleys) so a tick
    // with no spawns reports 0 on both and a prior tick's shots are never re-counted.
    this.shotsFiredCount = 0;
    this.volleysFiredCount = 0;

    // Resolve the ricochet params ONCE per tick from the live store (the `damage`/`ways`
    // convention) into the reused scratch, to stamp per bullet below. An unowned build
    // resolves to bouncesRemaining 0 (the ownership gate) — the stamped-0 pre-11.5 bullet.
    resolveRicochetParams(this.playerStats, this._ricochet);
    // Materialize the non-telegraphing combat enemies ONCE for the Lv5 seek re-aim, but ONLY
    // when a seek build is active and enemyPools is bound — the common no-ricochet path scans
    // nothing. `_ricochet.seek` is true only at Lv5, and seek bullets exist only once it is, so
    // gating on the live flag covers every live seek bullet.
    this._seekActive = !!(this.enemyPools && this._ricochet.seek);
    if (this._seekActive) {
      const enemies = this._enemies;
      enemies.length = 0;
      const pools = this.enemyPools;
      for (let p = 0; p < pools.length; p++) {
        pools[p].forEachActive(this._collectEnemy);
      }
    }

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
      // Volley shape, resolved once per tick from the live shared store (Story 10.3) and
      // sanitized so the fan loop below is always bounded. `ways <= 1` is the pre-10.3
      // single shot — the overwhelmingly common case (no Spread Cannon owned) — and the
      // table is only touched when there is actually a cone to build.
      const ways = this._spreadWays();
      if (ways > 1) this._ensureOffsetTable(ways, this._spreadArcDeg());
      while (this._accumMs >= interval) {
        if (ways <= 1) {
          // BASE VOLLEY — the literal pre-10.3 code path, kept verbatim rather than
          // folded into a one-iteration case of the fan loop, so "no Spread Cannon owned
          // behaves byte-for-byte as before" is true by construction and not by review.
          const b = pool.acquire();
          // Emerge from the ship nose along the aim direction.
          b.x = this.ship.x + input.aimX * this.ship.radius;
          b.y = this.ship.y + input.aimY * this.ship.radius;
          b.vx = input.aimX * BULLET_SPEED;
          b.vy = input.aimY * BULLET_SPEED;
          b.damage = damage; // Story 10.2 — stamped ONCE, at spawn
          stampRicochet(b, this._ricochet); // Story 11.5 — stamped from the LIVE fold
          this.shotsFiredCount++; // Story 4.5 read-only bullet counter
        } else {
          // SPREAD VOLLEY — fan `ways` bullets across the cached cone. Each bullet's
          // direction is the LIVE aim unit vector rotated by its own cached offset (the
          // standard 2-D rotation), so it stays unit-length and the volley re-aims with
          // the stick. It emerges from the nose along ITS OWN direction, not the aim
          // direction, so the volley leaves the ship as a fan rather than a line.
          for (let i = 0; i < ways; i++) {
            const c = this._offsetCos[i];
            const s = this._offsetSin[i];
            const dx = input.aimX * c - input.aimY * s;
            const dy = input.aimX * s + input.aimY * c;
            const b = pool.acquire();
            b.x = this.ship.x + dx * this.ship.radius;
            b.y = this.ship.y + dy * this.ship.radius;
            b.vx = dx * BULLET_SPEED;
            b.vy = dy * BULLET_SPEED;
            // Story 10.2's stamp-at-acquire obligation (see entities/Bullet.js): EVERY
            // bullet in the volley, because a RECYCLED instance still carries the
            // previous shot's damage and the collision-side fallback cannot detect it.
            b.damage = damage;
            // Story 11.5's identical obligation for the five ricochet fields — every bullet in
            // the volley, or a recycled instance leaks the previous shot's bounce state.
            stampRicochet(b, this._ricochet);
            this.shotsFiredCount++;
          }
        }
        // One trigger-pull = one fire EVENT, whatever the bullet count (the audio cue).
        this.volleysFiredCount++;
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
