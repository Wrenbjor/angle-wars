import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createMirrorReflector } from '../entities/MirrorReflector.js';
import { pickSafeEdgePlacement } from './spawnPlacement.js';
import {
  closestPointOnSegment,
  reflectVelocity,
} from './mirrorReflectorMath.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  BULLET_RADIUS,
  REFLECTOR_DRIFT_SPEED,
  REFLECTOR_SPIN_RATE,
  REFLECTOR_BAR_HALF_LENGTH,
  REFLECTOR_BAR_HALF_THICKNESS,
  REFLECTOR_WEIGHT_RADIUS,
  REFLECTOR_CENTER_KILL_RADIUS,
  REFLECTOR_SCORE,
  REFLECTOR_POOL_PREWARM,
  REFLECTOR_MAX_ACTIVE,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
  CHRONO_SLOW_FACTOR_MAX,
} from '../config/constants.js';

// MirrorReflectorSystem — the Mirror Reflector (dumbbell) hazard: drift + spin +
// wall-bounce, bullet↔bar reflect, and center-destroy / weight-kill (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, ordered in the enemy
// section AFTER SnakeSystem and BEFORE the SpawnDirector/CollisionSystem — and, load-
// bearing, BEFORE PlayerDeathSystem so a weight-kill's `playerState.pendingDeath` is
// consumed the SAME tick (exactly like the Black Hole detonation). Owns its own
// reflector Pool (public `enemyPool` — the single source of active/free truth;
// reflectors are NOT in world.entities).
//
// The reflector is modeled on the Pinwheel's drift + wall-bounce + pooling +
// telegraph, plus a constant SPIN. The genuinely-new code is the bullet↔bar reflect
// and the bespoke ship interactions — neither fits the uniform {x,y,radius} circle
// seams, which is exactly why the reflector is kept OUT of the CollisionSystem /
// BombSystem / BlackHole / PlayerDeathSystem pool lists and handles its own tests.
//
// Each fixed step, in order:
//   1. Telegraph gate + motion: a spawning-in reflector is frozen + inert until its
//      countdown reaches 0; otherwise SPIN (angle += RATE·dtSec), DRIFT (x += v·dtSec),
//      and WALL-BOUNCE (clamp to the inset bound + negate that velocity component,
//      preserving |v|). All dt-driven → frame-rate-independent.
//   2. Bullet reflect: per active non-telegraph reflector, per active bullet (at most
//      once per bullet per tick via a reusable Set): if the bullet is within
//      BULLET_RADIUS + REFLECTOR_BAR_HALF_THICKNESS of the bar segment AND approaching
//      (side·(v·n) < 0 for the fixed unit normal n=(−sinθ, cosθ)), mirror the bullet's
//      velocity across n (|v| preserved). The bullet is NOT consumed and stays player-
//      owned; the reflector is undamaged.
//   3. Ship interactions (post-move ship, once per reflector): center-destroy when
//      dist(ship, center) ≤ REFLECTOR_CENTER_KILL_RADIUS (release + flat REFLECTOR_SCORE
//      to scoreState.score); else weight-kill when the ship overlaps either weight
//      circle (playerState.pendingDeath = true). Center-destroy takes precedence when
//      both hold (reward threading the needle).
//   4. Deferred release: reflectors destroyed this tick are released in a second pass
//      (never release() mid-forEachActive); the score credit and pendingDeath set are
//      scalar and happen inline.
//
// The reflector is INDIFFERENT to the player's aim: it never reads the ship or bullets
// for its MOTION. It reads them only for the reflect + ship-interaction tests. A per-
// type concurrency cap (REFLECTOR_MAX_ACTIVE, enforced in spawn()) stops it piling up
// — it is unkillable by fire and the SpawnDirector has only a global cap.
//
// Zero steady-state allocation: reusable scratch arrays materialize the active bullet
// set and the deferred reflector releases, a reusable Set tracks per-tick reflected
// bullets, and a reusable scratch object receives each closest-point result.
export class MirrorReflectorSystem extends System {
  /**
     * @param {{x:number,y:number,radius:number}} ship The player ship (read for the
     *   center-destroy / weight-kill tests; never mutated here).
     * @param {import('../core/Pool.js').Pool} bulletPool Active player bullets (their
     *   velocity is mirrored in place on a bar reflect; never consumed here).
     * @param {{pendingDeath:boolean}} playerState Shared player lifecycle — a weight
     *   contact sets `pendingDeath` so PlayerDeathSystem costs a life the same tick.
     * @param {{score:number}} scoreState Shared run economy — a center-destroy credits
     *   the flat REFLECTOR_SCORE directly (never through the multiplier seam).
     * @param {Object<string, number>|() => number} [playerStatsOrRng] Shared runtime modifier
     *   store (Story 11.10: chronoSlowWorld), OR a legacy `rng` function for backward compat.
     * @param {() => number} [rng] Injectable RNG in [0,1) for the spawn edge/placement,
     *   drift heading, and initial angle; injectable so spawn is unit-testable.
     *   NOTE: the reflector stores no ship for its MOTION — the avoid point flows only as a
     *   spawn() argument (player-indifferent drift).
     */
  constructor(ship, bulletPool, playerState, scoreState, playerStatsOrRng, rng = Math.random) {
    super();
    this.ship = ship;
    this.bulletPool = bulletPool;
    this.playerState = playerState;
    this.scoreState = scoreState;
    this._rng = rng;
    if (typeof playerStatsOrRng === 'function') {
      // Backward-compat: existing callers pass (…, scoreState, rng) without playerStats.
      this._rng = playerStatsOrRng;
      this._playerStats = undefined;
    } else {
      this._playerStats = playerStatsOrRng;
    }

    /** Pool of reflectors — the single source of active/free truth (public for the
     *  renderer; deliberately NOT shared into any circle-collision seam). */
    this.enemyPool = new Pool(createMirrorReflector);
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the instances
    // land on the free stack.
    const warm = [];
    for (let i = 0; i < REFLECTOR_POOL_PREWARM; i++) {
      warm.push(this.enemyPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.enemyPool.release(warm[i]);
    }

    // Reusable scratch so the steady-state path allocates nothing. Materialized
    // active bullet set (iterating a Set can't be indexed), a per-tick reflected-
    // bullet dedupe Set, deferred reflector releases, and a scratch object reused
    // for each closest-point-on-segment result.
    this._bullets = [];
    this._collectBullet = (b) => this._bullets.push(b);
    this._reflected = new Set();
    this._releaseReflectors = [];
    this._closest = { x: 0, y: 0 };
    this._rv = { vx: 0, vy: 0 };

    // Public per-tick CENTER-KILL report (Story 8.1): the center positions of
    // reflectors destroyed by threading their center this tick, parallel arrays
    // centerKillX[k]/centerKillY[k]. Reset to empty each tick (alongside the
    // deferred-release list) and pushed at center-destroy (primitive coords pushed
    // before the pool release, so recycle-safe). The XpOrbSystem reads this to drop
    // one MIRROR_CENTER_KILL_XP orb per center-kill (parallel to the flat score
    // payout). A weight-kill credits nothing and is NOT reported. Reused arrays.
    this.centerKillX = [];
    this.centerKillY = [];

    // Hoisted per-reflector callbacks so the two forEachActive passes reuse one
    // closure each instead of allocating a fresh arrow per reflector per tick. The
    // per-tick dt (ms) is stashed on `this` for the motion pass to read.
    this._dt = 0;
    this._minX = 0;
    this._maxX = 0;
    this._minY = 0;
    this._maxY = 0;
    this._stepMotion = (r) => this._advanceMotion(r);
    this._stepInteract = (r) => this._interact(r);
  }

  /**
   * Advance one fixed step: telegraph-gate + drift/spin/wall-bounce, then bullet
   * reflect + ship destroy/weight-kill (deferred release).
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    this._dt = dt;
    // Story 11.10: if chronoSlowWorld is enabled, scale spin rate by (1 - slowFactor).
    const slowFactor = this._computeWorldSlowFactor();
    const spinMult = this._chronoSlowWorldEnabled() ? (1 - slowFactor) : 1;
    this._spinMult = spinMult;

    // Wall-bounce bounds inset by the dumbbell's full reach (bar half-length + weight
    // radius) so the whole spinning body stays inside the drawn border at any angle.
    const eff = REFLECTOR_BAR_HALF_LENGTH + REFLECTOR_WEIGHT_RADIUS;
    this._minX = ARENA_BORDER_INSET + eff;
    this._maxX = ARENA_WIDTH - ARENA_BORDER_INSET - eff;
    this._minY = ARENA_BORDER_INSET + eff;
    this._maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - eff;

    // Pass 1: telegraph gate + drift/spin/wall-bounce (mutating each active reflector
    // in place — safe; no structural pool mutation here).
    this.enemyPool.forEachActive(this._stepMotion);

    // Materialize the active bullet set once (reused across all reflectors this tick)
    // and clear the per-tick reflected-bullet dedupe Set + the deferred-release list.
    const bullets = this._bullets;
    bullets.length = 0;
    this.bulletPool.forEachActive(this._collectBullet);
    this._reflected.clear();
    this._releaseReflectors.length = 0;
    // Reset the per-tick center-kill report (Story 8.1) so a tick with no center-kill
    // reports [] and a prior tick's kill is never re-read.
    this.centerKillX.length = 0;
    this.centerKillY.length = 0;

    // Pass 2: bullet reflect + ship interactions, collecting reflectors to release.
    this.enemyPool.forEachActive(this._stepInteract);

    // Pass 3: deferred release (safe to mutate the active set now).
    const releases = this._releaseReflectors;
    for (let i = 0; i < releases.length; i++) {
      this.enemyPool.release(releases[i]);
    }
  }

  /**
   * Telegraph gate + drift/spin/wall-bounce for one reflector. A spawning-in
   * reflector is frozen (no spin/drift/bounce) until its countdown reaches 0; on the
   * tick it reaches 0 it falls through and moves this same tick.
   * @private
   */
  _advanceMotion(r) {
    const dt = this._dt;
    if (r.telegraphMs > 0) {
      r.telegraphMs -= dt;
      if (r.telegraphMs > 0) return; // still telegraphing → frozen
      r.telegraphMs = 0; // just activated → fall through to normal motion
    }
    const dtSec = dt / 1000;

    // Spin: advance the angle (rotation preserved regardless of drift). dt-driven.
    // Wrapped modulo 2π so the accumulated angle never grows unbounded over a long
    // run (cos/sin are unaffected — this is purely a magnitude bound).
    r.angle = (r.angle + REFLECTOR_SPIN_RATE * dtSec * this._spinMult) % (Math.PI * 2);

    // Drift: integrate straight-line by the fixed-step dt (frame-rate-independent).
    r.x += r.vx * dtSec;
    r.y += r.vy * dtSec;

    // Wall bounce: clamp to the crossed inset bound and reflect that component
    // (negating preserves |v|). Corners reflect both axes independently.
    if (r.x < this._minX) {
      r.x = this._minX;
      r.vx = -r.vx;
    } else if (r.x > this._maxX) {
      r.x = this._maxX;
      r.vx = -r.vx;
    }
    if (r.y < this._minY) {
      r.y = this._minY;
      r.vy = -r.vy;
    } else if (r.y > this._maxY) {
      r.y = this._maxY;
      r.vy = -r.vy;
    }
  }

  /**
   * Bullet↔bar reflect + ship destroy/weight-kill for one active reflector. A
   * telegraphing reflector is inert (no reflect, no destroy, no kill). Collects the
   * reflector into the deferred-release list on a center-destroy; sets the scalar
   * score / pendingDeath inline.
   * @private
   */
  _interact(r) {
    if (r.telegraphMs > 0) return; // still telegraphing → inert

    // Bar endpoints + the fixed unit normal n = (−sinθ, cosθ). Using the fixed unit
    // normal (never derived from a possibly-degenerate difference) avoids any
    // divide-by-zero in the reflect.
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    const ax = r.x + c * REFLECTOR_BAR_HALF_LENGTH;
    const ay = r.y + s * REFLECTOR_BAR_HALF_LENGTH;
    const bx = r.x - c * REFLECTOR_BAR_HALF_LENGTH;
    const by = r.y - s * REFLECTOR_BAR_HALF_LENGTH;
    const nx = -s;
    const ny = c;

    // --- Bullet reflect ---------------------------------------------------------
    const reflectBand = BULLET_RADIUS + REFLECTOR_BAR_HALF_THICKNESS;
    const reflectBandSq = reflectBand * reflectBand;
    const bullets = this._bullets;
    const reflected = this._reflected;
    const closest = this._closest;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (reflected.has(b)) continue; // already reflected once this tick
      // Proximity: within the band of the bar SEGMENT (not the infinite line).
      closestPointOnSegment(b.x, b.y, ax, ay, bx, by, closest);
      const ddx = b.x - closest.x;
      const ddy = b.y - closest.y;
      if (ddx * ddx + ddy * ddy > reflectBandSq) continue;
      // Approaching gate: side is the bullet's signed offset from the bar line through
      // the center; the bullet must be moving toward the bar (side·(v·n) < 0). This
      // makes a bullet reflect once then recede — it cannot flip every tick while
      // overlapping (jitter-free).
      const side = (b.x - r.x) * nx + (b.y - r.y) * ny;
      const vDotN = b.vx * nx + b.vy * ny;
      if (side * vDotN >= 0) continue; // receding (or parallel) → no reflect
      const rv = reflectVelocity(b.vx, b.vy, nx, ny, this._rv);
      b.vx = rv.vx;
      b.vy = rv.vy;
      reflected.add(b); // at most once per bullet per tick
      // The bullet is NOT consumed and stays player-owned; the reflector is undamaged.
    }

    // --- Ship interactions (evaluated once) -------------------------------------
    const ship = this.ship;
    const sdx = ship.x - r.x;
    const sdy = ship.y - r.y;
    if (sdx * sdx + sdy * sdy <= REFLECTOR_CENTER_KILL_RADIUS * REFLECTOR_CENTER_KILL_RADIUS) {
      // Center-destroy: release the reflector (deferred) + credit the flat payout
      // directly to the shared score surface. pendingDeath is NOT set (center wins).
      this._releaseReflectors.push(r);
      this.scoreState.score += REFLECTOR_SCORE;
      // Story 8.1: report the center-kill position NOW (primitive coords, before the
      // deferred pool release) so the XpOrbSystem can drop one orb at the center.
      this.centerKillX.push(r.x);
      this.centerKillY.push(r.y);
      return;
    }
    // Else weight-kill: ship overlapping EITHER weight circle sets the shared
    // pendingDeath (consumed by the normal PlayerDeathSystem flow). The reflector is
    // NOT released and no score is credited.
    const wr = ship.radius + REFLECTOR_WEIGHT_RADIUS;
    const wrSq = wr * wr;
    const wadx = ship.x - ax;
    const wady = ship.y - ay;
    const wbdx = ship.x - bx;
    const wbdy = ship.y - by;
    if (wadx * wadx + wady * wady <= wrSq || wbdx * wbdx + wbdy * wbdy <= wrSq) {
      this.playerState.pendingDeath = true;
    }
  }

  /**
   * Whether a `spawn()` call would actually place a reflector (i.e. the per-type cap
   * is not yet reached). The SpawnDirector queries this to skip the reflector in its
   * weighted pick when it is capped — so an interval is not WASTED selecting a capped
   * archetype while other archetypes have room. The no-op guard in `spawn()` remains
   * as a safety net for any caller that does not gate on this.
   * @returns {boolean}
   */
  canSpawn() {
    return this.enemyPool.activeCount < REFLECTOR_MAX_ACTIVE;
  }

  /**
   * Spawn one reflector on a random arena edge, fully inside the drawn border, with a
   * random drift heading at the drift speed and a random initial spin angle, frozen +
   * inert for ENEMY_SPAWN_TELEGRAPH_MS. A NO-OP at/above REFLECTOR_MAX_ACTIVE (no
   * acquire) — the per-type concurrency cap, since the reflector is unkillable by fire
   * and the SpawnDirector has only a global cap. Public: the SpawnDirector is the sole
   * caller during a run, supplying the ship position as (avoidX, avoidY) so the
   * placement re-rolls ≥ SPAWN_SAFE_RADIUS away; the avoid point is a spawn() ARGUMENT
   * only (the reflector stores no ship for its motion). Called with no avoid args the
   * first roll is accepted (back-compat).
   * @param {number} [avoidX] Ship x to keep the spawn away from.
   * @param {number} [avoidY] Ship y to keep the spawn away from.
   */
  spawn(avoidX, avoidY) {
    // Per-type cap: at/above the cap, spawn is a no-op (no acquire).
    if (this.enemyPool.activeCount >= REFLECTOR_MAX_ACTIVE) return;

    const r = this.enemyPool.acquire();
    // Edge placement inset by the dumbbell's full reach so a fresh reflector sits
    // fully inside the border; re-rolled (bounded) to avoid the ship.
    const eff = REFLECTOR_BAR_HALF_LENGTH + REFLECTOR_WEIGHT_RADIUS;
    const p = pickSafeEdgePlacement(
      this._rng,
      eff,
      avoidX,
      avoidY,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    r.x = p.x;
    r.y = p.y;

    // Random drift heading at the constant drift speed (|v| == REFLECTOR_DRIFT_SPEED;
    // wall bounces only reflect it thereafter).
    const heading = this._rng() * Math.PI * 2;
    r.vx = Math.cos(heading) * REFLECTOR_DRIFT_SPEED;
    r.vy = Math.sin(heading) * REFLECTOR_DRIFT_SPEED;

    // Random initial spin angle so recycled reflectors do not all share one phase.
    r.angle = this._rng() * Math.PI * 2;

    // Telegraph: frozen + inert until the countdown reaches 0.
    r.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
  }

  /**
    * Compute the slow percent, clamped to CHRONO_SLOW_FACTOR_MAX.
    * Returns 0 when no playerStats.
    * @returns {number}
    * @private
    */
  _computeWorldSlowFactor() {
    const ps = this._playerStats;
    if (!ps) return 0;
    const raw = ps.chronoSlowPercent;
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.min(raw, CHRONO_SLOW_FACTOR_MAX);
  }

  /**
    * Whether chronoSlowWorld is enabled from the shared player-stats store.
    * @returns {boolean}
    * @private
    */
  _chronoSlowWorldEnabled() {
    const ps = this._playerStats;
    return ps && ps.chronoSlowWorld >= 1;
  }
}
