import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createArmored } from '../entities/Armored.js';
import { pickSafeEdgePlacement } from './spawnPlacement.js';
import {
  ARMORED_SPEED,
  ARMORED_RADIUS,
  ARMORED_HP,
  ARMORED_POOL_PREWARM,
  ARMORED_MIN_ELAPSED_MS,
  ARMORED_PRESSURE_THRESHOLD,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
} from '../config/constants.js';

// ArmoredSystem — the Armored enemy: slow homing chaser with projectile-only HP
// (Phaser-free; Story 9.3 / Epic 9).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, ordered in the
// enemy section AFTER MirrorReflectorSystem and BEFORE the SpawnDirector (so it is
// a spawnable) and BEFORE CollisionSystem (so a fresh armored exists for this
// tick's collision/death). Owns its own armored Pool (public `enemyPool` — the
// single source of active/free truth; armored are NOT in world.entities).
//
// The armored mirrors the Seeker: it homes toward the ship's CURRENT position at a
// constant (slow) speed each fixed step, honoring the shared spawn telegraph (a
// spawning-in armored is frozen + non-lethal until its countdown reaches 0). It
// does NOT self-spawn: the SpawnDirector is the sole spawn authority and drives the
// public `spawn()`. The director owns WHEN and WHICH.
//
// What makes it distinct is durability, not motion: each instance carries an `hp`
// field reset to ARMORED_HP on spawn. ONLY the projectile path (CollisionSystem)
// decrements it — a bullet hit with hp > 1 survives, a hit at hp <= 1 kills. The
// AoE/melee paths (BombSystem, BlackHoleSystem) release enemies unconditionally
// regardless of hp, so they deal FULL damage for free. The asymmetry falls out of
// WHERE hp is checked — no kind-enum, no new pipeline. This system holds no HP
// logic itself; it only sets hp on spawn (the CollisionSystem owns the decrement).
//
// Eligibility gate: the director consults canSpawn() (the Mirror Reflector cap
// precedent) before its weighted pick. The armored is eligible only once the run
// passes ARMORED_MIN_ELAPSED_MS OR the director's build-power `pressure` crosses
// ARMORED_PRESSURE_THRESHOLD — read from a LATE-BOUND back-reference to the
// SpawnDirector (default null; unbound ⇒ canSpawn() false, never spawns without its
// gate source). Same late-bind shape as spawnDirector.dpsTelemetry.
//
// The steady-state path allocates nothing: the pool recycles freed instances and
// the prewarm builds the free list up front; the homing pass reuses one hoisted
// closure.
export class ArmoredSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The homing target (read-only here — the
   *   ship is never a collider in this system, only a target).
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for spawn
   *   edge and placement; injectable so placement is unit-testable.
   */
  constructor(ship, rng = Math.random) {
    super();
    this.ship = ship;
    this._rng = rng;

    /** Pool of armored — the single source of active/free truth (public for the
     *  collision system, both AoE paths, the death seam, and the renderer). */
    this.enemyPool = new Pool(createArmored);
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the instances
    // land on the free stack.
    const warm = [];
    for (let i = 0; i < ARMORED_POOL_PREWARM; i++) {
      warm.push(this.enemyPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.enemyPool.release(warm[i]);
    }

    // Late-bound back-reference to the SpawnDirector (wired by the scene AFTER both
    // systems exist — the director is constructed after this system so it can list
    // this system as a spawnable). Read ONLY by canSpawn() for its time/pressure
    // gate. Defaults to null so an unbound system never spawns (canSpawn() false).
    this.spawnDirector = null;

    // Hoisted per-armored homing callback so the forEachActive pass reuses one
    // closure instead of allocating a fresh arrow per instance per tick. The
    // per-tick dt (ms) is stashed on `this` for the callback to read.
    this._dt = 0;
    this._stepHome = (s) => this._advance(s);
  }

  /**
   * Advance one fixed step: home + integrate every active armored toward the ship.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    this._dt = dt;
    this.enemyPool.forEachActive(this._stepHome);
  }

  /**
   * Telegraph gate + homing for one armored. A spawning-in armored is frozen (no
   * homing) and non-lethal until its countdown reaches 0; on the tick it reaches 0
   * it falls through and homes + becomes lethal this same tick (movers run before
   * PlayerDeathSystem). Mirrors the Seeker homing (incl. the coincident guard).
   * @private
   */
  _advance(s) {
    const dt = this._dt;
    // Story 2.6 telegraph gate: a spawning-in armored is frozen (no homing) and
    // non-lethal until its countdown reaches 0. Decrement by the fixed-step dt
    // (frame-rate-independent), clamp at 0, and skip the homing while still
    // telegraphing.
    if (s.telegraphMs > 0) {
      s.telegraphMs -= dt;
      if (s.telegraphMs > 0) return; // still telegraphing → frozen
      s.telegraphMs = 0; // just activated → fall through to normal homing
    }
    const dtSec = dt / 1000;
    const ship = this.ship;
    const dx = ship.x - s.x;
    const dy = ship.y - s.y;
    const mag = Math.hypot(dx, dy);
    if (mag > 0) {
      const inv = ARMORED_SPEED / mag;
      s.vx = dx * inv;
      s.vy = dy * inv;
    } else {
      // Coincident with the ship: no direction — zero velocity, no NaN.
      s.vx = 0;
      s.vy = 0;
    }
    s.x += s.vx * dtSec;
    s.y += s.vy * dtSec;
  }

  /**
   * Whether a `spawn()` call is currently eligible. The SpawnDirector queries this
   * (the Mirror Reflector cap precedent) before its weighted pick and zeroes the
   * armored's weight when false, so its share flows to the eligible archetypes. The
   * armored is eligible once the run passes ARMORED_MIN_ELAPSED_MS OR the director's
   * build-power `pressure` crosses ARMORED_PRESSURE_THRESHOLD. Unbound (no director
   * back-ref) ⇒ false, so it never spawns without its gate source.
   * @returns {boolean}
   */
  canSpawn() {
    const d = this.spawnDirector;
    return (
      d != null &&
      (d.elapsedMs >= ARMORED_MIN_ELAPSED_MS ||
        d.pressure >= ARMORED_PRESSURE_THRESHOLD)
    );
  }

  /**
   * Spawn one armored on a random arena edge, fully inside the drawn border, with
   * full hp and frozen + non-lethal for ENEMY_SPAWN_TELEGRAPH_MS. Public: the
   * SpawnDirector is the sole caller during a run, supplying the ship position as
   * (avoidX, avoidY) so the placement re-rolls ≥ SPAWN_SAFE_RADIUS away. Called with
   * no avoid args the first roll is accepted (back-compat).
   * @param {number} [avoidX] Ship x to keep the spawn away from.
   * @param {number} [avoidY] Ship y to keep the spawn away from.
   */
  spawn(avoidX, avoidY) {
    const s = this.enemyPool.acquire();
    const p = pickSafeEdgePlacement(
      this._rng,
      ARMORED_RADIUS,
      avoidX,
      avoidY,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    s.x = p.x;
    s.y = p.y;

    // Start at rest; the next home pass sets velocity toward the ship.
    s.vx = 0;
    s.vy = 0;
    // Full projectile durability, reset every spawn (recycled instances start fresh).
    s.hp = ARMORED_HP;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
  }
}
