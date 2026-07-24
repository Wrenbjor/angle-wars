import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createSeekerDrone } from '../entities/SeekerDrone.js';
import { createDroneShot } from '../entities/DroneShot.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SEEKER_DRONE_ORBIT_RADIUS,
  SEEKER_DRONE_ROTATE_PERIOD_MS,
  SEEKER_DRONE_SHOT_SPEED,
  SEEKER_DRONE_SHOT_LIFETIME_MS,
  SEEKER_DRONE_BASE_DAMAGE,
  SEEKER_DRONE_BASE_PERIOD_MS,
  SEEKER_DRONE_PERIOD_FLOOR_MS,
  SEEKER_DRONE_MAX_COUNT,
  SEEKER_DRONE_POOL_PREWARM,
  SEEKER_DRONE_SHOT_POOL_PREWARM,
} from '../config/constants.js';

const TWO_PI = Math.PI * 2;

// SeekerDroneSystem — the Seeker Drones' pooled drone ring + their pooled shots (Story
// 11.2 / PRD §13.3), Phaser-free.
//
// Seeker Drones is the second Epic-11 EXOTIC item: it adds TWO genuinely new pooled-entity
// systems (the drones, and their SHOTS) rather than folding a stat. The SPLIT of
// responsibility mirrors OrbitBladeSystem / DashSystem / NaniteShieldSystem:
//   - the FOLD (state/PlayerStats.js) owns the DERIVED PARAMETERS — `seekerDroneCount`,
//     `seekerDroneDamage`, `seekerDronePeriodMs` and `seekerDroneHoming`;
//   - THIS system owns the live drone POOL, the live shot POOL, the per-drone fire
//     accumulators and the ring's accumulating rotation PHASE.
// They are split because `recomputePlayerStats` resets every field and re-derives the
// whole store on EVERY card pick: a live timer/pool kept there would be reset by picking
// any unrelated item.
//
// REGISTRATION SLOT (see scenes/buildArenaWorld.js) mirrors OrbitBladeSystem's exactly:
// AFTER CollisionSystem (its per-tick kill latches are already RESET this tick, so a drone
// kill lands in the fresh arrays) and BEFORE ScoringSystem (so a drone kill is SCORED and
// produces the full kill feedback — XP orb, ripple, spray, SFX). Consequence: a card
// picked this tick folds later this tick (LevelUpSystem runs after ScoringSystem), so a
// level change is visible on the NEXT tick — the one-tick lag every in-band item accepts.
//
// Each fixed step (fixedUpdate):
//   1. SYNC the live drone count to the folded count: acquire from the prewarmed free
//      list while short (seeding a fresh drone's `fireAccumMs` staggered across
//      [0, period) so growing the count doesn't burst-fire every drone the same tick),
//      release the surplus (materialize-then-mutate — never inside forEachActive) while
//      long;
//   2. advance the decorative rotation PHASE and REPOSITION every live drone evenly on the
//      ring around the ship (mutate x/y in place; guard a null ship);
//   3. MATERIALIZE the combat enemies (+ their owning pools) once, SKIPPING telegraphing
//      ones, into hoisted scratch — the shared target set for both the shot homing and the
//      per-drone fire scan;
//   4+5. ADVANCE + SWEEP each live shot in one pass over a materialized snapshot: a homing
//      shot re-points its velocity toward the nearest live enemy (EnemySystem's per-tick
//      re-aim model) at constant SEEKER_DRONE_SHOT_SPEED; integrate; bump `ageMs`; release
//      if off-arena or past SEEKER_DRONE_SHOT_LIFETIME_MS; else if it overlaps an
//      as-yet-unhit enemy this tick, route ONE applyPlayerDamage and consume the shot
//      (hit-once-per-enemy guard, like CollisionSystem);
//   6. per drone, accumulate dt into `fireAccumMs` and while `>= period` AND a target
//      exists, spawn a pooled shot from the drone toward the nearest enemy (stamping every
//      field; `homing` from the fold), decrementing by `period`; clamp the accumulator so a
//      target-less drone cannot bank unbounded credit.
//
// Route every shot hit through applyPlayerDamage, NEVER by decrementing hp / releasing the
// enemy directly. A drone shot is a PROJECTILE, so the armored archetype resists it exactly
// as it resists a bullet (intended — drones are NOT on the melee/AoE full-damage list).
// Scoped to enemyPools (the five combat archetypes), never deathPools — the Black Hole and
// the Mirror Reflector are out of scope, the same scoping DashSystem / OrbitBladeSystem use.
//
// The drone shots are their OWN pooled type, deliberately NOT fed into the FiringSystem
// bullet pool: folding the Lv4+ homing into the shared bullet pool would make two
// load-bearing v1 systems (FiringSystem / CollisionSystem) homing-aware for one item. This
// system owns the shots' advance + collide, leaving that v1 code byte-unchanged.
//
// Zero per-tick allocation on the steady path: drone acquire/release happen only on a count
// change; repositioning mutates x/y in place; shots recycle through the prewarmed pool; the
// scan/sweep use hoisted collectors + length-reset scratch arrays + a reused hit Set (the
// CollisionSystem / OrbitBladeSystem convention).
export class SeekerDroneSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The player ship — read for the ring anchor. NEVER
   *   mutated here (the system only reads ship.x/y).
   * @param {import('../core/Pool.js').Pool[]} enemyPools The five COMBAT archetype pools
   *   the drone shots target + damage. Deliberately `enemyPools`, never `deathPools`: the
   *   Black Hole and the Mirror Reflector are out of scope, the same scoping
   *   OrbitBladeSystem / DashSystem apply.
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The shared
   *   damage seam — every shot hit goes through its `applyPlayerDamage`, so armor, scoring,
   *   XP and the kill latches behave exactly as for a bullet.
   * @param {Object<string,number>|null} [playerStats=null] The shared player-stat store the
   *   drone parameters are read from (optional — a null store means NO drones ever, i.e.
   *   exactly the pre-11.2 behavior).
   */
  constructor(ship, enemyPools, collisionSystem, playerStats = null) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;

    // The drone pool — the single source of active/free drone truth. Prewarmed so a card
    // pick that raises the count acquires from the free list with no factory allocation.
    this.pool = new Pool(createSeekerDrone);
    const warmDrones = [];
    for (let i = 0; i < SEEKER_DRONE_POOL_PREWARM; i++) {
      warmDrones.push(this.pool.acquire());
    }
    for (let i = 0; i < warmDrones.length; i++) {
      this.pool.release(warmDrones[i]);
    }

    // The shot pool — the single source of active/free shot truth. Prewarmed above the
    // worst-case steady-state in-flight count so spawns recycle with no factory allocation.
    this.shotPool = new Pool(createDroneShot);
    const warmShots = [];
    for (let i = 0; i < SEEKER_DRONE_SHOT_POOL_PREWARM; i++) {
      warmShots.push(this.shotPool.acquire());
    }
    for (let i = 0; i < warmShots.length; i++) {
      this.shotPool.release(warmShots[i]);
    }

    /**
     * The decorative accumulating ring-rotation phase (radians), wrapped into [0, 2π).
     * Drone `i` sits at `_phaseRad + i·(2π/count)`, so the drones stay evenly spaced. This
     * spin is purely cosmetic — the drones fire regardless of where the ring rotated to.
     * Public for observability/render alignment.
     */
    this._phaseRad = 0;

    // Reusable scratch for the live drone set — length-reset each use (no per-tick alloc).
    // Materialized to release the surplus (never mid-forEachActive), to reposition, and to
    // drive the per-drone fire cadence.
    this._activeDrones = [];
    this._collectDrone = (d) => this._activeDrones.push(d);

    // Reusable scratch for the live shot set — materialized once per tick so the
    // advance/sweep pass can release shots safely (releasing mutates the pool's active Set,
    // which forEachActive forbids; iterating a materialized array snapshot is safe).
    this._shots = [];
    this._collectShot = (s) => this._shots.push(s);

    // Reusable sweep scratch so the target scan + collision allocate nothing: the
    // materialized NON-telegraphing combat enemies and a parallel array of each one's owning
    // pool (so a kill's release routes to the correct pool) — the CollisionSystem /
    // OrbitBladeSystem convention. The collector SKIPS a telegraphing enemy, so an enemy
    // spawning-in is never a target NOR a hit.
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      if (e.telegraphMs > 0) return;
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };

    // Reused pre-cleared hit-tracking Set so a shot that would hit an already-hit enemy this
    // tick finds no target and stays live (the hit-once-per-enemy guard — like
    // CollisionSystem's `_hitEnemies`). Cleared each tick, so it is still reused (no
    // per-tick allocation).
    this._hitEnemies = new Set();
  }

  /**
   * The sanitized drone count off the shared store — an INTEGER in [0,
   * SEEKER_DRONE_MAX_COUNT]. Mirrors OrbitBladeSystem._count: a missing store, a missing
   * field, or junk (NaN, Infinity, negative, fractional, string, 1e9) resolves to something
   * the acquire loop can terminate on rather than throw.
   *   - no store / non-finite / < 1 → 0, i.e. NO drones (the pre-11.2 behavior);
   *   - fractional                  → floored to a whole drone;
   *   - absurdly large              → clamped to SEEKER_DRONE_MAX_COUNT (a SAFETY guard: an
   *     unclamped 1e9 would ask the acquire loop to mint a billion drones).
   * Allocates nothing.
   * @returns {number} the sanitized count (integer, 0..SEEKER_DRONE_MAX_COUNT).
   * @private
   */
  _count() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.seekerDroneCount;
    if (!Number.isFinite(v)) return 0;
    const n = Math.floor(v);
    if (n < 1) return 0;
    return n > SEEKER_DRONE_MAX_COUNT ? SEEKER_DRONE_MAX_COUNT : n;
  }

  /**
   * The sanitized per-shot damage off the shared store — always > 0. A missing store, a
   * missing field, a non-finite value, or a non-positive one all resolve to
   * SEEKER_DRONE_BASE_DAMAGE (the authored L1 damage). Allocates nothing.
   * @returns {number}
   * @private
   */
  _damage() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return SEEKER_DRONE_BASE_DAMAGE;
    const v = ps.seekerDroneDamage;
    if (!Number.isFinite(v) || v <= 0) return SEEKER_DRONE_BASE_DAMAGE;
    return v;
  }

  /**
   * The sanitized fire period (ms between a drone's shots) off the shared store — always
   * > 0. A missing store, a missing field, a non-finite value, or a non-positive one all
   * resolve to SEEKER_DRONE_BASE_PERIOD_MS. A finite BUT tiny-positive value is clamped UP
   * to SEEKER_DRONE_PERIOD_FLOOR_MS, so the fire-cadence `while` loop always terminates and
   * the accumulator drain is always bounded (a floored period sits well above the fixed
   * step, so a drone fires at most ~1 shot/tick — never a same-tick burst). Allocates
   * nothing.
   * @returns {number}
   * @private
   */
  _periodMs() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return SEEKER_DRONE_BASE_PERIOD_MS;
    const v = ps.seekerDronePeriodMs;
    if (!Number.isFinite(v) || v <= 0) return SEEKER_DRONE_BASE_PERIOD_MS;
    return Math.max(v, SEEKER_DRONE_PERIOD_FLOOR_MS);
  }

  /**
   * The sanitized homing flag off the shared store — 1 (on) or 0 (off). Homing is enabled
   * only by a finite value >= 1; a missing store/field or junk resolves to 0 (straight
   * shots), so a corrupted store can never spuriously enable homing. Allocates nothing.
   * @returns {number} 1 when homing is on, else 0.
   * @private
   */
  _homing() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.seekerDroneHoming;
    return Number.isFinite(v) && v >= 1 ? 1 : 0;
  }

  /**
   * The nearest materialized combat enemy to a point, or null when none exist. Reads the
   * hoisted `_enemies` scratch (already filtered of telegraphing enemies), so it allocates
   * nothing. Squared distance — no sqrt.
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
   * Advance one fixed step: sync the drone count, rotate + reposition, scan targets,
   * advance + sweep shots, then fire at cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const pool = this.pool;
    const shotPool = this.shotPool;
    const count = this._count();
    const period = this._periodMs();

    // (1) Sync the live drone count to the folded count. Acquire from the prewarmed free
    // list while short (seeding each fresh drone's fire accumulator staggered across
    // [0, period) — index-based, deterministic, no rng — so growing the count never
    // burst-fires every drone the same tick); release the surplus while long. A count DROP
    // (an Epic-12 remnant, or the item going unowned) clamps the live set down via a
    // materialized snapshot — never inside forEachActive.
    while (pool.activeCount < count) {
      const d = pool.acquire();
      const idx = pool.activeCount - 1; // 0-based slot of the drone just added
      d.fireAccumMs = count > 0 ? (idx / count) * period : 0;
    }
    if (pool.activeCount > count) {
      const drones = this._activeDrones;
      drones.length = 0;
      pool.forEachActive(this._collectDrone);
      for (let i = count; i < drones.length; i++) pool.release(drones[i]);
    }

    // (2) Advance the decorative rotation phase (only when drones are owned — an unowned
    // build leaves it untouched) and reposition every live drone evenly on the ring. Guard
    // a null ship defensively (no reposition — the drones keep their prior coords).
    if (count > 0) {
      this._phaseRad +=
        (TWO_PI / (SEEKER_DRONE_ROTATE_PERIOD_MS / 1000)) * (dt / 1000);
      this._phaseRad %= TWO_PI;
      if (this._phaseRad < 0) this._phaseRad += TWO_PI;
    }
    const ship = this.ship;
    const drones = this._activeDrones;
    drones.length = 0;
    pool.forEachActive(this._collectDrone);
    if (count > 0 && ship) {
      const r = SEEKER_DRONE_ORBIT_RADIUS;
      const step = TWO_PI / count;
      const n = Math.min(count, drones.length);
      for (let i = 0; i < n; i++) {
        const a = this._phaseRad + i * step;
        drones[i].x = ship.x + r * Math.cos(a);
        drones[i].y = ship.y + r * Math.sin(a);
      }
    }

    // (3) Materialize the combat enemies (+ owners) ONCE through the hoisted collector,
    // which skips a telegraphing (spawning-in) enemy — so an enemy spawning in is never a
    // target NOR a hit. Shared by the shot homing (4) and the per-drone fire scan (6).
    const enemies = this._enemies;
    const owners = this._owners;
    enemies.length = 0;
    owners.length = 0;
    const pools = this.enemyPools;
    if (pools) {
      for (let p = 0; p < pools.length; p++) {
        this._currentPool = pools[p];
        pools[p].forEachActive(this._collectEnemy);
      }
    }

    // (4)+(5) Advance + sweep every live shot in one pass over a materialized snapshot.
    // Releasing a shot mutates the pool's active Set, which forEachActive forbids — but the
    // snapshot array is a separate copy, so releasing while iterating IT is safe. A shot
    // spawned later this tick (step 6) is not in this snapshot, so it is first advanced
    // NEXT tick (the FiringSystem convention — a fresh shot never hits the tick it spawns).
    const dtSec = dt / 1000;
    const shots = this._shots;
    shots.length = 0;
    shotPool.forEachActive(this._collectShot);
    const hitEnemies = this._hitEnemies;
    hitEnemies.clear();
    const cs = this.collisionSystem;
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      // Homing re-aim (Lv4+): re-point the velocity toward the nearest live enemy at
      // constant speed each fixed step (EnemySystem's Blue-Seeker model). With no target
      // (or a coincident one), keep the current velocity so the shot flies straight on.
      if (shot.homing >= 1) {
        const t = this._nearestEnemy(shot.x, shot.y);
        if (t) {
          const dx = t.x - shot.x;
          const dy = t.y - shot.y;
          const mag = Math.hypot(dx, dy);
          if (mag > 0) {
            const inv = SEEKER_DRONE_SHOT_SPEED / mag;
            shot.vx = dx * inv;
            shot.vy = dy * inv;
          }
        }
      }
      // Integrate + age.
      shot.x += shot.vx * dtSec;
      shot.y += shot.vy * dtSec;
      shot.ageMs += dt;
      // Expire off-arena OR at the lifetime cap (the cap is load-bearing: a homing shot
      // that never connects would otherwise circle forever and never leave the arena).
      if (
        shot.ageMs >= SEEKER_DRONE_SHOT_LIFETIME_MS ||
        isOutsideArena(shot.x, shot.y)
      ) {
        shotPool.release(shot);
        continue;
      }
      // Sweep vs the materialized enemies: the first as-yet-unhit overlapping enemy takes
      // ONE applyPlayerDamage and the shot is consumed (hit-once-per-enemy, so two shots
      // over one enemy this tick land at most one hit — the second finds no unhit target
      // and stays live). Guards a null collisionSystem defensively (no-op).
      if (!cs) continue;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (hitEnemies.has(e)) continue;
        const ddx = shot.x - e.x;
        const ddy = shot.y - e.y;
        const rr = shot.radius + e.radius;
        // Squared compare avoids a sqrt; <= so a boundary touch counts (the sim-wide
        // contact convention).
        if (ddx * ddx + ddy * ddy <= rr * rr) {
          hitEnemies.add(e);
          cs.applyPlayerDamage(e, owners[j], shot.damage);
          shotPool.release(shot);
          break;
        }
      }
    }

    // (6) Fire cadence. Per drone, accumulate dt, then while there is a full period of
    // banked credit AND a target exists, spawn a pooled shot from the drone toward the
    // nearest enemy (stamping every field — a recycled shot carries stale values). Clamp
    // the accumulator to `period` so a target-less drone (empty arena) cannot bank unbounded
    // credit, then fires ONCE the instant a target appears (responsive, never a backlog
    // burst).
    if (count > 0 && ship) {
      const homing = this._homing();
      const damage = this._damage();
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        d.fireAccumMs += dt;
        while (d.fireAccumMs >= period) {
          // Clamp the spawn ORIGIN into the arena interior FIRST: a wall-pressed ship can
          // push the wall-side drone (ring radius 72) outside the arena (the ship clamps
          // only to within ~40px of the border), and a shot spawned out of bounds would be
          // released by isOutsideArena on the very next tick — a wall-side blank. Clamping
          // to [ARENA_BORDER_INSET, ARENA_*-ARENA_BORDER_INSET] is a no-op for an inside
          // drone (the normal case), so the spawn still leaves the drone's position there.
          const ox = clamp(d.x, ARENA_BORDER_INSET, ARENA_WIDTH - ARENA_BORDER_INSET);
          const oy = clamp(d.y, ARENA_BORDER_INSET, ARENA_HEIGHT - ARENA_BORDER_INSET);
          const t = this._nearestEnemy(ox, oy);
          if (!t) break; // no target — hold fire (the accumulator is clamped below)
          // Aim FROM the clamped origin toward the target, so an outside drone's shot both
          // starts in-bounds and flies accurately at the enemy.
          const dx = t.x - ox;
          const dy = t.y - oy;
          const mag = Math.hypot(dx, dy);
          const shot = shotPool.acquire();
          shot.x = ox;
          shot.y = oy;
          if (mag > 0) {
            const inv = SEEKER_DRONE_SHOT_SPEED / mag;
            shot.vx = dx * inv;
            shot.vy = dy * inv;
          } else {
            // Target coincident with the drone: no direction — pick an arbitrary but
            // finite velocity (never a NaN). It expires at the lifetime cap regardless.
            shot.vx = 0;
            shot.vy = SEEKER_DRONE_SHOT_SPEED;
          }
          shot.damage = damage;
          shot.homing = homing;
          shot.ageMs = 0;
          d.fireAccumMs -= period;
        }
        if (d.fireAccumMs > period) d.fireAccumMs = period;
      }
    }
  }
}

/**
 * Clamp a scalar into `[lo, hi]`. Used to pull a wall-side drone's shot spawn origin back
 * into the arena interior so it is not released off-arena on the next tick.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * True when a point's center has crossed the drawn arena border (the inset boundary) on any
 * side — the FiringSystem convention, so a drone shot despawns at exactly the boundary a
 * bullet does.
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
