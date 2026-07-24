import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createOrbitBlade } from '../entities/OrbitBlade.js';
import {
  ORBIT_BLADE_ORBIT_RADIUS,
  ORBIT_BLADE_MAX_COUNT,
  ORBIT_BLADE_BASE_DAMAGE,
  ORBIT_BLADE_BASE_PERIOD_MS,
  ORBIT_BLADE_HIT_COOLDOWN_MS,
  ORBIT_BLADE_POOL_PREWARM,
} from '../config/constants.js';

const TWO_PI = Math.PI * 2;

// OrbitBladeSystem — the Orbit Blade's pooled blade ring + rotation + contact sweep
// (Story 11.1 / PRD §13.3), Phaser-free.
//
// Orbit Blade is the first Epic-11 EXOTIC item: it adds a genuinely new pooled-entity
// system rather than folding a stat. The SPLIT of responsibility mirrors
// NaniteShieldSystem / DashSystem:
//   - the FOLD (state/PlayerStats.js) owns the DERIVED PARAMETERS — `orbitBladeCount`,
//     `orbitBladeDamage`, `orbitBladePeriodMs` and `orbitBladeRadiusMult`;
//   - THIS system owns the live blade POOL and the accumulating rotation PHASE.
// They are split because `recomputePlayerStats` resets every field and re-derives the
// whole store on EVERY card pick: a live phase/pool kept there would be reset by picking
// any unrelated item.
//
// REGISTRATION SLOT (see scenes/buildArenaWorld.js) mirrors DashSystem's exactly: AFTER
// CollisionSystem (its per-tick kill latches are already RESET this tick, so blade kills
// land in the fresh arrays) and BEFORE ScoringSystem (so a blade kill is SCORED and
// produces the full kill feedback — XP orb, ripple, spray, SFX). Consequence: a card
// picked this tick folds later this tick (LevelUpSystem runs after ScoringSystem), so a
// level change is visible on the NEXT tick — the one-tick lag every in-band item accepts.
//
// Each fixed step (fixedUpdate):
//   1. SYNC the live blade count to the folded count: acquire from the prewarmed free
//      list while short, release the surplus (materialize-then-mutate — never release
//      mid-forEachActive) while long;
//   2. if count > 0, advance the shared phase by the level's angular speed;
//   3. REPOSITION: place blade i at ship ± R·(cos,sin)(phase + i·2π/count), evenly spaced;
//   4. SWEEP: for each combat enemy across enemyPools, skip a telegraphing enemy and one
//      still inside its re-hit cooldown; if ANY live blade overlaps, route ONE hit through
//      collisionSystem.applyPlayerDamage (armor/scoring/XP/kill-latches behave as a bullet).
//
// Route every blade hit through applyPlayerDamage, NEVER by decrementing hp / releasing
// directly (BombSystem's unconditional hp-ignoring release is the ANTI-pattern — it
// bypasses the kill latches). Scoped to enemyPools (the five combat archetypes), never
// deathPools — the Black Hole and the Mirror Reflector are out of scope, the same scoping
// DashSystem._sweep / NaniteShieldSystem._pulse use.
//
// Zero per-tick allocation on the steady path: acquire/release happen only on a count
// change; repositioning mutates x/y in place; the sweep uses hoisted collectors + a
// length-reset scratch array (the CollisionSystem/DashSystem convention).
export class OrbitBladeSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The player ship — read for the ring anchor. NEVER
   *   mutated here (the system only reads ship.x/y).
   * @param {import('../core/Pool.js').Pool[]} enemyPools The five COMBAT archetype pools
   *   the contact sweep damages. Deliberately `enemyPools`, never `deathPools`: the Black
   *   Hole and the Mirror Reflector are out of scope, the same scoping DashSystem._sweep
   *   and NaniteShieldSystem._pulse apply.
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The shared
   *   damage seam — every blade hit goes through its `applyPlayerDamage`, so armor,
   *   scoring, XP and the kill latches behave exactly as for a bullet.
   * @param {Object<string,number>|null} [playerStats=null] The shared player-stat store
   *   the blade parameters are read from (optional — a null store means NO blades ever,
   *   i.e. exactly the pre-11.1 behavior).
   */
  constructor(ship, enemyPools, collisionSystem, playerStats = null) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;

    // The blade pool — the single source of active/free truth. Prewarmed so a card pick
    // that raises the count acquires from the free list with no factory allocation.
    this.pool = new Pool(createOrbitBlade);
    const warm = [];
    for (let i = 0; i < ORBIT_BLADE_POOL_PREWARM; i++) {
      warm.push(this.pool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.pool.release(warm[i]);
    }

    /**
     * The shared accumulating rotation phase (radians), wrapped into [0, 2π). Blade `i`
     * sits at `_phaseRad + i·(2π/count)`, so the blades stay evenly spaced and "2 opposed"
     * (Lv2) falls out as π apart. Public for observability/render alignment.
     */
    this._phaseRad = 0;

    // A private monotonic elapsed clock (ms) for the per-enemy re-hit cooldown. The stamp
    // `_orbitBladeHitAt` is an ABSOLUTE-TIME window: an enemy is eligible again only once
    // `_elapsedMs - _orbitBladeHitAt >= ORBIT_BLADE_HIT_COOLDOWN_MS`. Recycle-safety does
    // NOT come from "the clock only increases" (a stamp 100ms in the past is still inside
    // the cooldown), but from the fact that every recycled enemy RE-TELEGRAPHS on spawn:
    // the sweep CLEARS the stamp (to -Infinity) while an enemy is telegraphing, so a
    // recycled instance always re-enters the sweep eligible, whatever the cooldown/
    // telegraph numeric relationship.
    this._elapsedMs = 0;

    // Reusable sweep scratch so the damage path allocates nothing: the materialized active
    // enemies and a parallel array of each one's owning pool (so a kill's release routes to
    // the correct pool) — the CollisionSystem/DashSystem convention. Materialize-then-
    // mutate: releasing inside forEachActive would mutate the pool's active Set mid-iteration.
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };

    // Reusable scratch for the live blade set — length-reset each use (no per-tick alloc).
    // Materialized both to release the surplus (never mid-forEachActive) and to reposition.
    this._activeBlades = [];
    this._collectBlade = (b) => this._activeBlades.push(b);
  }

  /**
   * The sanitized blade count off the shared store — an INTEGER in [0,
   * ORBIT_BLADE_MAX_COUNT]. Mirrors NaniteShieldSystem._maxCharges: a missing store, a
   * missing field, or junk (NaN, Infinity, negative, fractional, string, 1e9) resolves to
   * something the acquire loop can terminate on rather than throw.
   *   - no store / non-finite / < 1 → 0, i.e. NO blades (the pre-11.1 behavior);
   *   - fractional                  → floored to a whole blade;
   *   - absurdly large              → clamped to ORBIT_BLADE_MAX_COUNT (a SAFETY guard: an
   *     unclamped 1e9 would ask the acquire loop to mint a billion blades).
   * Allocates nothing.
   * @returns {number} the sanitized count (integer, 0..ORBIT_BLADE_MAX_COUNT).
   * @private
   */
  _count() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.orbitBladeCount;
    if (!Number.isFinite(v)) return 0;
    const n = Math.floor(v);
    if (n < 1) return 0;
    return n > ORBIT_BLADE_MAX_COUNT ? ORBIT_BLADE_MAX_COUNT : n;
  }

  /**
   * The sanitized per-blade damage off the shared store — always > 0. A missing store, a
   * missing field, a non-finite value, or a non-positive one all resolve to
   * ORBIT_BLADE_BASE_DAMAGE (the authored L1 damage). Allocates nothing.
   * @returns {number}
   * @private
   */
  _damage() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return ORBIT_BLADE_BASE_DAMAGE;
    const v = ps.orbitBladeDamage;
    if (!Number.isFinite(v) || v <= 0) return ORBIT_BLADE_BASE_DAMAGE;
    return v;
  }

  /**
   * The sanitized rotation period (ms per revolution) off the shared store — always > 0. A
   * missing store, a missing field, a non-finite value, or a non-positive one all resolve
   * to ORBIT_BLADE_BASE_PERIOD_MS, so the angular-speed divide is always safe. Allocates
   * nothing.
   * @returns {number}
   * @private
   */
  _periodMs() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return ORBIT_BLADE_BASE_PERIOD_MS;
    const v = ps.orbitBladePeriodMs;
    if (!Number.isFinite(v) || v <= 0) return ORBIT_BLADE_BASE_PERIOD_MS;
    return v;
  }

  /**
   * The sanitized ring radius (px): ORBIT_BLADE_ORBIT_RADIUS × the folded
   * `orbitBladeRadiusMult` (base 1). A missing store/field or a non-finite / non-positive
   * mult falls back to a factor of 1, so a junk store cannot collapse the ring to 0 or NaN.
   * Allocates nothing.
   * @returns {number}
   * @private
   */
  _orbitRadius() {
    const ps = this.playerStats;
    let mult = 1;
    if (ps !== null && ps !== undefined) {
      const v = ps.orbitBladeRadiusMult;
      if (Number.isFinite(v) && v > 0) mult = v;
    }
    return ORBIT_BLADE_ORBIT_RADIUS * mult;
  }

  /**
   * Advance one fixed step: sync the blade count to the fold, rotate, reposition, sweep.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const pool = this.pool;
    const count = this._count();

    // (1) Sync the live blade count to the folded count. Acquire from the prewarmed free
    // list while short; release the surplus while long. A count DROP (an Epic-12 remnant,
    // or the item going unowned) clamps the live set down. Releases go through a second
    // pass over a materialized snapshot — never inside forEachActive.
    while (pool.activeCount < count) pool.acquire();
    if (pool.activeCount > count) {
      const blades = this._activeBlades;
      blades.length = 0;
      pool.forEachActive(this._collectBlade);
      for (let i = count; i < blades.length; i++) pool.release(blades[i]);
    }

    // (2) Advance the shared phase by this tick's rotation. Angular speed is
    // 2π / period_s, so a smaller period spins faster. Wrapped into [0, 2π) to keep the
    // accumulator bounded. When no blades are owned the phase is left untouched.
    if (count > 0) {
      const periodSec = this._periodMs() / 1000;
      this._phaseRad += (TWO_PI / periodSec) * (dt / 1000);
      // periodSec > 0 always (the sanitizer floors the period positive), so the step is
      // finite; wrap into [0, 2π). A modulo keeps it correct even for a large step.
      this._phaseRad %= TWO_PI;
      if (this._phaseRad < 0) this._phaseRad += TWO_PI;
    }

    // (3) Reposition every live blade: evenly spaced around the ship at the ring radius.
    // Materialize the active set, then overwrite x/y in place (zero allocation). Guard a
    // null ship defensively (no-op — the blades keep their prior coords).
    const ship = this.ship;
    if (count > 0 && ship) {
      const blades = this._activeBlades;
      blades.length = 0;
      pool.forEachActive(this._collectBlade);
      const r = this._orbitRadius();
      const step = TWO_PI / count;
      // `blades.length === count` here (step 1 synced them), but iterate the min defensively.
      const n = Math.min(count, blades.length);
      for (let i = 0; i < n; i++) {
        const a = this._phaseRad + i * step;
        blades[i].x = ship.x + r * Math.cos(a);
        blades[i].y = ship.y + r * Math.sin(a);
      }
    }

    // (4) Sweep. Advance the monotonic re-hit clock, then damage every overlapping combat
    // enemy at most once per ORBIT_BLADE_HIT_COOLDOWN_MS. Gated on a valid ship AND count:
    // the sweep must only run after step 3 actually POSITIONED the blades, so a null ship
    // (blades left at their prior/zeroed coords) can never spuriously hit an enemy near the
    // origin.
    this._elapsedMs += dt;
    if (count > 0 && ship) this._sweep(count);
  }

  /**
   * The contact sweep: for each COMBAT enemy across enemyPools, if any live blade overlaps
   * it, route ONE hit through CollisionSystem.applyPlayerDamage — so armor, the kill
   * latches, the coordinate/XP snapshots and `bulletDamageCount` behave exactly as for a
   * bullet. A telegraphing (spawning-in) enemy is skipped (the single non-lethality seam
   * every combat system respects); an enemy still inside its re-hit cooldown is skipped.
   *
   * The re-hit stamp `_orbitBladeHitAt` is an ABSOLUTE-TIME window rather than a Set: it
   * allocates nothing (the field is added once per pooled object, lazily on the first
   * hit). RECYCLE-SAFETY does NOT come from "the clock only increases" — a stamp a fraction
   * of a cooldown in the past is still in the past yet NOT eligible. It comes from the fact
   * that every recycled enemy RE-TELEGRAPHS on spawn: the telegraph branch below CLEARS the
   * stamp (to -Infinity) while an enemy is telegraphing, so a recycled instance always
   * activates ELIGIBLE, whatever the cooldown/telegraph numeric relationship happens to be.
   *
   * Only reached with a valid ship AND count > 0 (see fixedUpdate step 4), so the reposition
   * pass has already materialized `_activeBlades` to `count` current blade positions.
   *
   * Materialize-then-mutate: a kill releases the enemy to its pool, which cannot be done
   * inside forEachActive. Zero per-tick allocation (hoisted collectors + length-reset
   * scratch). Guards null pools / collisionSystem defensively (no-op).
   * @param {number} count The live blade count (> 0 when this is called).
   * @private
   */
  _sweep(count) {
    const pools = this.enemyPools;
    const cs = this.collisionSystem;
    if (!pools || !cs) return;

    // The live blades to test overlap against — already materialized to `count` current
    // positions by the reposition pass this tick (the sweep only runs after a real
    // reposition, so their x/y are current).
    const blades = this._activeBlades;
    const bladeCount = Math.min(count, blades.length);
    if (bladeCount === 0) return;

    // Collect the combat enemies + their owning pools through the hoisted collectors.
    const enemies = this._enemies;
    const owners = this._owners;
    enemies.length = 0;
    owners.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }

    const now = this._elapsedMs;
    const damage = this._damage();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // A telegraphing (spawning-in) enemy is inert — the same non-lethality seam
      // CollisionSystem / PlayerDeathSystem / DashSystem / the shield pulse respect. ALSO
      // clear its re-hit stamp: every recycled enemy re-telegraphs on spawn, so clearing
      // here guarantees it re-enters the sweep ELIGIBLE (a stale stamp from the pooled
      // instance's PREVIOUS life can never suppress its first hit in this life).
      if (e.telegraphMs > 0) {
        e._orbitBladeHitAt = -Infinity;
        continue;
      }
      // Still inside its re-hit cooldown — skip until the window elapses. `?? -Infinity`
      // makes a never-hit enemy (no stamp) always eligible.
      const last = e._orbitBladeHitAt ?? -Infinity;
      if (now - last < ORBIT_BLADE_HIT_COOLDOWN_MS) continue;
      // Overlap test against every live blade; the first overlap lands the hit.
      const er = e.radius;
      let hit = false;
      for (let b = 0; b < bladeCount; b++) {
        const blade = blades[b];
        const dx = blade.x - e.x;
        const dy = blade.y - e.y;
        const rr = blade.radius + er;
        // Squared compare avoids a sqrt; <= so a boundary touch counts (every other
        // contact test in the sim uses the same convention).
        if (dx * dx + dy * dy <= rr * rr) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      e._orbitBladeHitAt = now;
      cs.applyPlayerDamage(e, owners[i], damage);
    }
  }
}
