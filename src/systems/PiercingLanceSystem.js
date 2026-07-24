import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createLanceBolt } from '../entities/LanceBolt.js';
import { createLanceTrailNode } from '../entities/LanceTrailNode.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  LANCE_BOLT_SPEED,
  LANCE_PERIOD_FLOOR_MS,
  LANCE_BASE_PIERCE,
  LANCE_MAX_PIERCE,
  LANCE_BOLT_BASE_DAMAGE,
  LANCE_BOLT_POOL_PREWARM,
  LANCE_TRAIL_LIFETIME_MS,
  LANCE_TRAIL_DROP_MS,
  LANCE_TRAIL_DAMAGE,
  LANCE_TRAIL_NODE_MAX,
} from '../config/constants.js';

// PiercingLanceSystem — the Piercing Lance's pooled bolts + their Lv4+ trail nodes (Story
// 11.4 / PRD §13.3), Phaser-free.
//
// Piercing Lance is the fourth Epic-11 EXOTIC item and the first PIERCING projectile: a slow,
// heavy bolt auto-fired on a cadence FROM the ship TOWARD the nearest combat enemy that
// punches THROUGH a line of enemies (pierce 2 → 7) — a dense column clears in one shot. Unlike
// a base bullet (one bullet = at most one kill) or a Seeker-Drone shot (consumed on first
// hit), a bolt SURVIVES each hit and continues until its pierce charges are spent, deals a
// heavier per-hit damage, and at Lv4+ leaves a 0.5s damage TRAIL along its path; Lv5 also
// fires a second bolt backward (antipodal). The SPLIT of responsibility mirrors
// SeekerDroneSystem / MineLayerSystem:
//   - the FOLD (state/PlayerStats.js) owns the DERIVED PARAMETERS — `lancePeriodMs`,
//     `lancePierce`, `lanceDamage`, `lanceTrail` and `lanceBackward`;
//   - THIS system owns the live bolt POOL, the trail-node POOL and the fire ACCUMULATOR.
// They are split because `recomputePlayerStats` resets every field and re-derives the whole
// store on EVERY card pick: a live timer/pool kept there would be reset by picking any
// unrelated item.
//
// REGISTRATION SLOT (see scenes/buildArenaWorld.js) mirrors MineLayerSystem's exactly: AFTER
// CollisionSystem (its per-tick kill latches are already RESET this tick, so a lance kill lands
// in the fresh arrays) and BEFORE ScoringSystem (so a lance kill is SCORED and produces the
// full kill feedback — XP orb, ripple, spray, SFX).
//
// Each fixed step (fixedUpdate), in order:
//   1. READ + SANITIZE the fold (period 0/junk → unowned gate; pierce clamped to
//      [1, LANCE_MAX_PIERCE]; damage positive-finite; trail/backward flags — all for STAMPING
//      new bolts);
//   2. MATERIALIZE the non-telegraphing combat enemies (+ owners) once into hoisted scratch;
//   3. ADVANCE every live bolt over a stable snapshot: integrate straight-line motion; drop
//      trail nodes on the LANCE_TRAIL_DROP_MS cadence for trail-stamped bolts (evicting the
//      oldest node past LANCE_TRAIL_NODE_MAX); sweep the enemies, hitting each as-yet-unhit
//      overlapping enemy ONCE through applyPlayerDamage (per-bolt hitSet, decrement
//      pierceRemaining), releasing the bolt when its pierce is spent or it exits the arena;
//   4. AGE every live trail node over a snapshot: expire (release) past LANCE_TRAIL_LIFETIME_MS,
//      else apply its damage to each as-yet-unhit overlapping enemy ONCE (per-node hitSet);
//   5. FIRE on the folded period toward the nearest enemy (Lv5 also fires the antipodal bolt);
//      with no target HOLD FIRE and clamp the accumulator to one period so no backlog banks.
//
// Route every hit (bolt or trail node) through collisionSystem.applyPlayerDamage, NEVER by
// decrementing hp / releasing the enemy directly. A lance bolt is a PROJECTILE, so the armored
// archetype resists it exactly as it resists a bullet (intended — the lance is NOT on the
// melee/AoE full-damage list; its Lv3+ one-shot of armored is purely by MAGNITUDE, folded
// `lanceDamage` 6 > ARMORED_HP 5). Scoped to enemyPools (the five combat archetypes), never
// deathPools — the Black Hole and the Mirror Reflector are out of scope, the same scoping
// MineLayerSystem / SeekerDroneSystem / OrbitBladeSystem use.
//
// PIERCE-ONCE-PER-ENEMY. Each bolt carries its OWN `hitSet` (created cold in the factory,
// `.clear()`ed on spawn — no steady-path allocation) so a fast bolt overlapping one enemy for
// 2–3 ticks spends only one pierce charge on it. Two SEPARATE bolts (consecutive cadence, or
// Lv5 forward + backward) each hit a SURVIVING enemy once because each has its own set — which
// is how armor is chipped by multiple bolts. A shared per-tick `_killedThisTick` guard blocks
// any lance source (a second bolt, a trail node) from touching an enemy already KILLED and
// RELEASED this tick, so no released enemy is double-hit / double-released while a surviving
// (armored) enemy stays hittable by a different bolt.
//
// Zero per-tick allocation on the steady path: bolts + nodes recycle through prewarmed pools;
// the advance/age/fire passes use hoisted collectors + length-reset scratch arrays + reused
// per-entity Sets + a reused kill guard (the CollisionSystem / SeekerDroneSystem convention).
export class PiercingLanceSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The player ship — read for the fire origin. NEVER
   *   mutated here (the system only reads ship.x/y).
   * @param {import('../core/Pool.js').Pool[]} enemyPools The five COMBAT archetype pools the
   *   bolts + trail nodes target + damage. Deliberately `enemyPools`, never `deathPools`: the
   *   Black Hole and the Mirror Reflector are out of scope, the same scoping MineLayerSystem /
   *   SeekerDroneSystem apply.
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The shared damage
   *   seam — every hit goes through its `applyPlayerDamage`, so armor, scoring, XP and the kill
   *   latches behave exactly as for a bullet.
   * @param {Object<string,number>|null} [playerStats=null] The shared player-stat store the
   *   lance parameters are read from (optional — a null store means NO bolts ever, i.e.
   *   exactly the pre-11.4 behavior).
   */
  constructor(ship, enemyPools, collisionSystem, playerStats = null) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;

    // The bolt pool — the single source of active/free bolt truth. Prewarmed so a fire never
    // hits the factory once running.
    this.pool = new Pool(createLanceBolt);
    const warmBolts = [];
    for (let i = 0; i < LANCE_BOLT_POOL_PREWARM; i++) {
      warmBolts.push(this.pool.acquire());
    }
    for (let i = 0; i < warmBolts.length; i++) {
      this.pool.release(warmBolts[i]);
    }

    // The trail-node pool — the single source of active/free node truth. Prewarmed to the live
    // cap so a drop (even the over-cap evict-then-acquire) never hits the factory.
    this.trailPool = new Pool(createLanceTrailNode);
    const warmNodes = [];
    for (let i = 0; i < LANCE_TRAIL_NODE_MAX; i++) {
      warmNodes.push(this.trailPool.acquire());
    }
    for (let i = 0; i < warmNodes.length; i++) {
      this.trailPool.release(warmNodes[i]);
    }

    // Runtime fire accumulator (ms): dt is banked here while owned, drained one period per
    // cadence. Held at 0 while unowned (the ownership gate) and clamped to one period when
    // target-less, so the item begins a fresh cadence rather than dumping a backlog.
    this._fireAccumMs = 0;

    // Reusable scratch for the live bolt set — length-reset each use (no per-tick alloc).
    // Materialized once per tick so the advance/sweep pass can release bolts safely (releasing
    // mutates the pool's active Set, which forEachActive forbids; iterating a materialized
    // snapshot is safe).
    this._bolts = [];
    this._collectBolt = (b) => this._bolts.push(b);

    // Reusable scratch for the live trail-node set — materialized once per tick for the
    // age/expire pass, and reused by the oldest-eviction helper at drop time.
    this._nodes = [];
    this._collectNode = (n) => this._nodes.push(n);

    // Reusable sweep scratch so the target scan + collisions allocate nothing: the materialized
    // NON-telegraphing combat enemies and a parallel array of each one's owning pool (so a
    // kill's release routes to the correct pool) — the SeekerDroneSystem convention. The
    // collector SKIPS a telegraphing enemy, so a spawning-in enemy is never a target NOR a hit.
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      if (e.telegraphMs > 0) return;
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };

    // Reused per-tick KILL guard (CollisionSystem's `_hitEnemies` pattern, but a KILL guard,
    // not a hit guard): an enemy KILLED + RELEASED by any lance source this tick is added here,
    // so a later bolt / trail node never hits — or double-releases — a stale reference. A
    // SURVIVING (armored) enemy is NOT added, so a second bolt (its own hitSet empty) still
    // chips it. Cleared each tick, so it is still reused (no per-tick allocation).
    this._killedThisTick = new Set();
  }

  /**
   * The sanitized fire period (ms between bolt cadences) off the shared store — 0 means
   * UNOWNED (the ownership gate), else a positive value floored to LANCE_PERIOD_FLOOR_MS. A
   * missing store, a missing field, a non-finite value, or a non-positive one all resolve to
   * 0 (no bolts — the pre-11.4 behavior). A finite BUT tiny-positive value is clamped UP to the
   * floor so the fire `while` loop drains at most ~1 cadence/tick. Allocates nothing.
   * @returns {number} 0 (unowned) or a period >= LANCE_PERIOD_FLOOR_MS.
   * @private
   */
  _periodMs() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.lancePeriodMs;
    if (!Number.isFinite(v) || v <= 0) return 0;
    return v < LANCE_PERIOD_FLOOR_MS ? LANCE_PERIOD_FLOOR_MS : v;
  }

  /**
   * The sanitized pierce count off the shared store — an INTEGER in [1, LANCE_MAX_PIERCE]. A
   * missing store, a missing field, or junk (NaN, Infinity, negative, fractional < 1) resolves
   * to LANCE_BASE_PIERCE; a fractional value is floored; an absurdly large value is clamped to
   * LANCE_MAX_PIERCE (a SAFETY guard). Allocates nothing.
   * @returns {number} the sanitized pierce (integer, 1..LANCE_MAX_PIERCE).
   * @private
   */
  _pierce() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return LANCE_BASE_PIERCE;
    const v = ps.lancePierce;
    if (!Number.isFinite(v)) return LANCE_BASE_PIERCE;
    const n = Math.floor(v);
    if (n < 1) return LANCE_BASE_PIERCE;
    return n > LANCE_MAX_PIERCE ? LANCE_MAX_PIERCE : n;
  }

  /**
   * The sanitized per-bolt damage off the shared store — always > 0. A missing store, a
   * missing field, a non-finite value, or a non-positive one all resolve to
   * LANCE_BOLT_BASE_DAMAGE (the authored L1 damage). Allocates nothing.
   * @returns {number}
   * @private
   */
  _damage() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return LANCE_BOLT_BASE_DAMAGE;
    const v = ps.lanceDamage;
    if (!Number.isFinite(v) || v <= 0) return LANCE_BOLT_BASE_DAMAGE;
    return v;
  }

  /**
   * The sanitized trail flag off the shared store — 1 (on) or 0 (off). Enabled only by a
   * finite value >= 1; a missing store/field or junk resolves to 0, so a corrupted store can
   * never spuriously enable the trail. Allocates nothing.
   * @returns {number} 1 when the trail is on, else 0.
   * @private
   */
  _trail() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.lanceTrail;
    return Number.isFinite(v) && v >= 1 ? 1 : 0;
  }

  /**
   * The sanitized backward flag off the shared store — 1 (on) or 0 (off). Same sanitizer shape
   * as `_trail`. Allocates nothing.
   * @returns {number} 1 when the backward bolt is on, else 0.
   * @private
   */
  _backward() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.lanceBackward;
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
   * Advance one fixed step: sanitize the fold, materialize the combat enemies, advance +
   * collide the bolts (dropping trail nodes), age + apply the trail nodes, then fire on
   * cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const pool = this.pool;
    const dtSec = dt / 1000;
    const cs = this.collisionSystem;
    const pools = this.enemyPools;

    // (1) Read + sanitize the fold — the parameters STAMPED onto any bolt fired this tick.
    const period = this._periodMs();

    // (2) Materialize the combat enemies (+ owners) ONCE through the hoisted collector, which
    // skips a telegraphing (spawning-in) enemy — so it is never a target NOR a hit. Shared by
    // the bolt sweep (3), the trail-node sweep (4) and the fire scan (5).
    const enemies = this._enemies;
    const owners = this._owners;
    enemies.length = 0;
    owners.length = 0;
    if (pools) {
      for (let p = 0; p < pools.length; p++) {
        this._currentPool = pools[p];
        pools[p].forEachActive(this._collectEnemy);
      }
    }

    // Reset the per-tick KILL guard shared across the bolt + trail passes.
    const killed = this._killedThisTick;
    killed.clear();

    // (3) Advance + sweep every live bolt over a materialized snapshot. Releasing a bolt
    // mutates the pool's active Set, which forEachActive forbids — but the snapshot array is a
    // separate copy, so releasing while iterating IT is safe. A bolt fired later this tick
    // (step 5) is NOT in this snapshot, so it is first advanced NEXT tick (the FiringSystem
    // convention — a fresh bolt never hits the tick it spawns).
    const bolts = this._bolts;
    bolts.length = 0;
    pool.forEachActive(this._collectBolt);
    for (let i = 0; i < bolts.length; i++) {
      const bolt = bolts[i];
      // Integrate straight-line motion (bolts never re-aim).
      bolt.x += bolt.vx * dtSec;
      bolt.y += bolt.vy * dtSec;

      // Drop trail nodes on cadence for a trail-stamped bolt (a per-bolt accumulator), evicting
      // the OLDEST live node while at the cap so the live count never exceeds LANCE_TRAIL_NODE_MAX.
      // Guard the cadence positive (like _periodMs floors the fire period): a 0/negative
      // LANCE_TRAIL_DROP_MS would make `accum >= drop` always true and `accum -= drop` never
      // shrink — a hard-hang infinite loop. A non-positive cadence disables the trail instead.
      if (bolt.trail >= 1 && LANCE_TRAIL_DROP_MS > 0) {
        bolt.trailAccumMs += dt;
        while (bolt.trailAccumMs >= LANCE_TRAIL_DROP_MS) {
          this._dropTrailNode(bolt.x, bolt.y);
          bolt.trailAccumMs -= LANCE_TRAIL_DROP_MS;
        }
      }

      // Sweep vs the materialized enemies: each as-yet-unhit overlapping enemy (skipping any
      // already KILLED this tick by another source) takes ONE applyPlayerDamage and consumes a
      // pierce charge; the bolt is released when its pierce is spent. Guards null pools /
      // collisionSystem defensively (no sweep, but the bolt still ages + can exit).
      let released = false;
      if (pools && cs) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (bolt.hitSet.has(e) || killed.has(e)) continue;
          const dx = bolt.x - e.x;
          const dy = bolt.y - e.y;
          const rr = bolt.radius + e.radius;
          // Squared compare avoids a sqrt; <= so a boundary touch counts (the sim-wide contact
          // convention).
          if (dx * dx + dy * dy <= rr * rr) {
            bolt.hitSet.add(e);
            const wasKilled = cs.applyPlayerDamage(e, owners[j], bolt.damage);
            if (wasKilled) killed.add(e);
            bolt.pierceRemaining -= 1;
            if (bolt.pierceRemaining <= 0) {
              pool.release(bolt);
              released = true;
              break;
            }
          }
        }
      }
      if (released) continue;

      // Release on arena exit (a straight constant-velocity flight guarantees the bolt
      // eventually leaves, so no time-lifetime is needed).
      if (isOutsideArena(bolt.x, bolt.y)) {
        pool.release(bolt);
      }
    }

    // (4) Age + apply every live trail node over a materialized snapshot (safe to release while
    // iterating IT). A node expires past LANCE_TRAIL_LIFETIME_MS; otherwise it deals its damage
    // to each as-yet-unhit overlapping enemy ONCE (per-node hitSet), skipping any already
    // killed this tick. A node is NOT consumed on a hit — it lingers and can chip several
    // distinct enemies over its life.
    const nodes = this._nodes;
    nodes.length = 0;
    this.trailPool.forEachActive(this._collectNode);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      node.lifeMs += dt;
      if (node.lifeMs >= LANCE_TRAIL_LIFETIME_MS) {
        this.trailPool.release(node);
        continue;
      }
      if (!(pools && cs)) continue;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (node.hitSet.has(e) || killed.has(e)) continue;
        const dx = node.x - e.x;
        const dy = node.y - e.y;
        const rr = node.radius + e.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          node.hitSet.add(e);
          const wasKilled = cs.applyPlayerDamage(e, owners[j], node.damage);
          if (wasKilled) killed.add(e);
        }
      }
    }

    // (5) Fire cadence. Only when OWNED (period > 0) AND with a valid ship (a bolt is fired
    // FROM the ship position). Accumulate dt, then while a full period is banked AND a target
    // exists, fire a bolt FROM the clamped ship origin TOWARD the nearest enemy (Lv5 also fires
    // the antipodal bolt), decrementing by the period. Clamp the accumulator to `period` so a
    // target-less build cannot bank unbounded credit — it fires ONCE the instant a target
    // appears (responsive, never a backlog burst). When unowned, hold the accumulator at 0.
    const ship = this.ship;
    if (period > 0 && ship) {
      this._fireAccumMs += dt;
      const pierce = this._pierce();
      const damage = this._damage();
      const trail = this._trail();
      const backward = this._backward();
      while (this._fireAccumMs >= period) {
        // Clamp the fire ORIGIN into the arena interior so a wall-pressed ship never fires a
        // bolt born out of bounds (which isOutsideArena would release the very next tick) — a
        // no-op for an inside ship (the normal case). The SeekerDroneSystem spawn-clamp.
        const ox = clamp(ship.x, ARENA_BORDER_INSET, ARENA_WIDTH - ARENA_BORDER_INSET);
        const oy = clamp(ship.y, ARENA_BORDER_INSET, ARENA_HEIGHT - ARENA_BORDER_INSET);
        const t = this._nearestEnemy(ox, oy);
        if (!t) break; // no target — hold fire (the accumulator is clamped below)
        // Aim FROM the clamped origin toward the target.
        const dx = t.x - ox;
        const dy = t.y - oy;
        const mag = Math.hypot(dx, dy);
        let ux;
        let uy;
        if (mag > 0) {
          const inv = LANCE_BOLT_SPEED / mag;
          ux = dx * inv;
          uy = dy * inv;
        } else {
          // Target coincident with the ship: no direction — pick an arbitrary but finite
          // velocity (never a NaN). It exits the arena regardless.
          ux = 0;
          uy = LANCE_BOLT_SPEED;
        }
        this._spawnBolt(ox, oy, ux, uy, pierce, damage, trail);
        // Lv5: a second bolt fires antipodal (backward), full pierce/damage/trail.
        if (backward >= 1) {
          this._spawnBolt(ox, oy, -ux, -uy, pierce, damage, trail);
        }
        this._fireAccumMs -= period;
      }
      if (this._fireAccumMs > period) this._fireAccumMs = period;
    } else {
      // Unowned (or no ship): hold the accumulator at 0 so going owned starts a fresh cadence.
      this._fireAccumMs = 0;
    }
  }

  /**
   * Acquire a bolt from the prewarmed pool and STAMP every field (a recycled bolt carries stale
   * values), clearing its per-bolt hitSet so it can hit fresh enemies. Allocates nothing (the
   * hitSet is `.clear()`ed, never reallocated).
   * @param {number} x Origin x (px).
   * @param {number} y Origin y (px).
   * @param {number} vx Velocity x (px/s).
   * @param {number} vy Velocity y (px/s).
   * @param {number} pierce Distinct enemies the bolt may punch through.
   * @param {number} damage Per-hit damage.
   * @param {number} trail Trail flag (>= 1 → drops trail nodes).
   * @private
   */
  _spawnBolt(x, y, vx, vy, pierce, damage, trail) {
    const bolt = this.pool.acquire();
    bolt.x = x;
    bolt.y = y;
    bolt.vx = vx;
    bolt.vy = vy;
    bolt.damage = damage;
    bolt.pierceRemaining = pierce;
    bolt.trail = trail;
    bolt.trailAccumMs = 0;
    bolt.hitSet.clear();
  }

  /**
   * Drop a trail node at a point, evicting the OLDEST live node (max lifeMs) while at the cap so
   * the live count never exceeds LANCE_TRAIL_NODE_MAX. STAMPS every field and clears the
   * per-node hitSet. Reuses the `_nodes` scratch for the eviction scan (the age pass
   * re-materializes it), so it allocates nothing.
   * @param {number} x
   * @param {number} y
   * @private
   */
  _dropTrailNode(x, y) {
    const trailPool = this.trailPool;
    // Evict the oldest while at/over the cap (a while, not an if — defensive), so acquiring
    // never pushes the live count above the cap.
    while (trailPool.activeCount >= LANCE_TRAIL_NODE_MAX) {
      this._evictOldestTrailNode();
    }
    const node = trailPool.acquire();
    node.x = x;
    node.y = y;
    node.lifeMs = 0;
    node.damage = LANCE_TRAIL_DAMAGE;
    node.hitSet.clear();
  }

  /**
   * Release the OLDEST live trail node (max lifeMs — a node dropped earlier has aged longer)
   * back to the pool. Called before an over-cap drop so the live count stays bounded. Reuses
   * the `_nodes` scratch. A no-op if somehow no node is active.
   * @private
   */
  _evictOldestTrailNode() {
    const trailPool = this.trailPool;
    const nodes = this._nodes;
    nodes.length = 0;
    trailPool.forEachActive(this._collectNode);
    let oldest = null;
    let oldestLife = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].lifeMs > oldestLife) {
        oldestLife = nodes[i].lifeMs;
        oldest = nodes[i];
      }
    }
    if (oldest) trailPool.release(oldest);
  }
}

/**
 * Clamp a scalar into `[lo, hi]`. Used to pull a wall-pressed ship's bolt fire origin back into
 * the arena interior so a bolt is not born off-arena and released on the next tick.
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
 * side — the FiringSystem convention, so a lance bolt despawns at exactly the boundary a bullet
 * does.
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
