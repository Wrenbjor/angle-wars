import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createBlackHole } from '../entities/BlackHole.js';
import {
  pickSafeEdgePlacement,
  pickSafeInteriorPlacement,
} from './spawnPlacement.js';
import {
  SEEKER_RADIUS,
  BLACKHOLE_RADIUS,
  BLACKHOLE_MAX_RADIUS,
  BLACKHOLE_GRAVITY_RADIUS,
  BLACKHOLE_GRAVITY_STRENGTH,
  BLACKHOLE_HP,
  BLACKHOLE_BULLET_DAMAGE,
  BLACKHOLE_GROWTH_PER_FEED,
  BLACKHOLE_FEED_PER_SPAWN,
  BLACKHOLE_SPAWN_INTERVAL_MS,
  BLACKHOLE_MAX_ACTIVE,
  BLACKHOLE_POOL_PREWARM,
  BLACKHOLE_SCORE,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
} from '../config/constants.js';

// BlackHoleSystem — the Black Hole hazard: gravity + feed/grow/spawn + destruction
// (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, ordered LATE in
// the tick — AFTER the enemy movers, the bullet integrator, the CollisionSystem,
// and the ScoringSystem, and BEFORE the PlayerDeathSystem. That ordering is
// load-bearing:
//   - Gravity is a POSITION nudge applied after every mover has integrated
//     x += v·dt, so it accumulates instead of being erased (the movers recompute
//     velocity each tick — a velocity force would vanish; see the spec Design
//     Notes). Because it is scaled by dtSec it is frame-rate-independent.
//   - Running after ScoringSystem means an absorbed enemy appended to
//     collisionSystem.killedEnemies is REMOVED (reconciled by owner systems like
//     SnakeSystem on their next tick) but NOT scored — only the player's own
//     bullet kills and this system's detonation payout add score.
//
// Owns ONE prewarmed hole Pool (public `holePool`) — the single source of
// active/free truth. The hole is lethal-on-contact via the PlayerDeathSystem pool
// list (which reads only {x,y,radius}), but is deliberately NOT in the
// CollisionSystem list: it is multi-hit destructible, so this system owns its own
// bullet-vs-hole test (consume the bullet + hp -= damage + feed).
//
// `collisionSystem` is late-bound by the scene (the hole pool must exist before
// the collision system that the death list references). Until it is set, enemy
// absorption is a guarded no-op; gravity and bullet feed still run.
//
// Each fixed step, per active hole: (1) pull the ship + every active bullet +
// every active enemy toward the body (linear inverse-distance falloff, dt-scaled);
// (2) absorb overlapping bullets (release + damage + feed) and overlapping enemies
// (release to owner pool + append to killedEnemies + feed); (3) grow (clamped) and
// per BLACKHOLE_FEED_PER_SPAWN emit a seeker at a random arena edge; (4) if hp ≤ 0,
// credit BLACKHOLE_SCORE and mark the hole for release. Then self-spawn at cadence,
// capped at BLACKHOLE_MAX_ACTIVE, at random interior points.
//
// Zero steady-state allocation: reusable scratch materializes the active sets and
// records deferred releases (mutating a pool's active set mid-forEachActive is
// unsafe — collect, then release in a second pass, mirroring CollisionSystem).
export class BlackHoleSystem extends System {
  /**
   * @param {{x:number,y:number}} ship The player ship (pulled by gravity; read+mutated).
   * @param {import('../core/Pool.js').Pool} bulletPool Active bullets (pulled + absorbed).
   * @param {import('../core/Pool.js').Pool[]} enemyPools Every archetype enemy pool
   *   (their active instances are pulled + absorbed).
   * @param {import('../core/Pool.js').Pool} spawnPool Target pool for feed-driven
   *   enemy emission (the shared seeker pool).
   * @param {{score:number}} scoreState Shared run economy — credited the detonation payout.
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for spawn
   *   placement; injectable so spawn cadence/placement are unit-testable.
   */
  constructor(ship, bulletPool, enemyPools, spawnPool, scoreState, rng = Math.random) {
    super();
    this.ship = ship;
    this.bulletPool = bulletPool;
    this.enemyPools = enemyPools;
    this.spawnPool = spawnPool;
    this.scoreState = scoreState;
    this._rng = rng;

    /** Pool of black holes — the single source of active/free truth (public for
     *  the death-pool list and the renderer). */
    this.holePool = new Pool(createBlackHole);
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the instances
    // land on the free stack.
    const warm = [];
    for (let i = 0; i < BLACKHOLE_POOL_PREWARM; i++) {
      warm.push(this.holePool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.holePool.release(warm[i]);
    }

    // Late-bound by the scene AFTER the collision system is constructed (the hole
    // pool must exist first). Until set, enemy absorption is a guarded no-op.
    this.collisionSystem = null;

    // Spawn-cadence accumulator (ms). Starts at 0 so the first hole spawns after
    // one full interval (ungated — spawning does not depend on any input).
    this._accumMs = 0;

    // Reusable scratch so the steady-state path allocates nothing. Materialized
    // active sets (iterating a Set can't be indexed and releasing mutates it
    // mid-iteration — both unsafe) and parallel owner tracking for enemies, plus
    // deferred-release buffers and dedupe sets (a bullet/enemy consumed by one
    // hole is skipped by later holes).
    this._holes = [];
    this._bullets = [];
    this._enemies = [];
    this._enemyOwners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      this._enemies.push(e);
      this._enemyOwners.push(this._currentPool);
    };
    // Hoisted hole + bullet collectors — stable instance-field arrows created once
    // (like `_collectEnemy`), so materializing the active sets reuses one closure
    // each instead of allocating a fresh arrow per tick.
    this._collectHole = (h) => this._holes.push(h);
    this._collectBullet = (b) => this._bullets.push(b);
    this._consumedBullets = new Set();
    this._consumedEnemies = new Set();
    this._releaseBullets = [];
    this._releaseEnemies = [];
    this._releaseEnemyOwners = [];
    this._releaseHoles = [];
  }

  /**
   * Advance one fixed step: gravity + feed/grow/spawn + detonation per active
   * hole, then self-spawn at cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;

    // Materialize the active holes, bullets, and the union of enemy pools into
    // reusable scratch (length reset, no alloc), recording each enemy's owner.
    const holes = this._holes;
    holes.length = 0;
    this.holePool.forEachActive(this._collectHole);

    if (holes.length > 0) {
      const bullets = this._bullets;
      const enemies = this._enemies;
      const owners = this._enemyOwners;
      bullets.length = 0;
      enemies.length = 0;
      owners.length = 0;
      this.bulletPool.forEachActive(this._collectBullet);
      const pools = this.enemyPools;
      for (let p = 0; p < pools.length; p++) {
        this._currentPool = pools[p];
        pools[p].forEachActive(this._collectEnemy);
      }

      const cs = this.collisionSystem;
      const consumedBullets = this._consumedBullets;
      const consumedEnemies = this._consumedEnemies;
      const releaseBullets = this._releaseBullets;
      const releaseEnemies = this._releaseEnemies;
      const releaseEnemyOwners = this._releaseEnemyOwners;
      const releaseHoles = this._releaseHoles;
      consumedBullets.clear();
      consumedEnemies.clear();
      releaseBullets.length = 0;
      releaseEnemies.length = 0;
      releaseEnemyOwners.length = 0;
      releaseHoles.length = 0;

      for (let hi = 0; hi < holes.length; hi++) {
        const hole = holes[hi];

        // Story 2.6 telegraph gate: a spawning-in hole is frozen (no gravity,
        // absorb, feed, grow, or detonation) and non-lethal until its countdown
        // reaches 0 — a spawning hole is briefly invulnerable (its own bullet
        // damage is part of this frozen tick). Decrement by the fixed-step dt
        // (frame-rate-independent), clamp at 0, and skip the whole behavior while
        // still telegraphing. On the tick it reaches 0 it falls through and its
        // gravity/feed resume + it becomes lethal this same tick.
        if (hole.telegraphMs > 0) {
          hole.telegraphMs -= dt;
          if (hole.telegraphMs > 0) continue; // still telegraphing → frozen
          hole.telegraphMs = 0; // just activated → fall through to normal behavior
        }

        // (1) Gravity: position nudge toward the hole for ship + bullets + enemies.
        //     Story 2.6: a telegraphing (frozen) ENEMY is inert to the hole — it
        //     is neither pulled nor absorbed until it activates, so gravity cannot
        //     drag a "frozen" enemy (or slide it onto the ship mid-telegraph). The
        //     ship and bullets are always pulled/absorbed normally.
        this._pull(hole, this.ship, dtSec);
        for (let i = 0; i < bullets.length; i++) {
          this._pull(hole, bullets[i], dtSec);
        }
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (e.telegraphMs > 0) continue; // frozen enemy: inert to gravity
          this._pull(hole, e, dtSec);
        }

        // (2a) Absorb overlapping bullets: consume + damage + feed. Deferred
        //      release (mutating the bullet pool mid-walk is unsafe).
        for (let i = 0; i < bullets.length; i++) {
          // A hole that took its killing blow this tick stops absorbing/feeding
          // immediately — the remaining overlapping bullets pass through the
          // vanishing body (they stay active) rather than feeding a corpse.
          if (hole.hp <= 0) break;
          const b = bullets[i];
          if (consumedBullets.has(b)) continue; // already eaten by an earlier hole
          const dx = hole.x - b.x;
          const dy = hole.y - b.y;
          const r = hole.radius + b.radius;
          if (dx * dx + dy * dy <= r * r) {
            consumedBullets.add(b);
            releaseBullets.push(b);
            hole.hp -= BLACKHOLE_BULLET_DAMAGE;
            // The killing blow consumes + damages but does NOT grow/emit — only a
            // surviving hole feeds.
            if (hole.hp > 0) this._feed(hole);
          }
        }

        // (2b) Absorb overlapping enemies — guarded until collisionSystem is set,
        //      and only while the hole is still alive (a detonating hole absorbs
        //      nothing further this tick). Release to the OWNER pool AND append to
        //      killedEnemies so owner systems (e.g. SnakeSystem) reconcile through
        //      the same seam a bullet kill uses; NOT scored (runs after Scoring).
        if (cs && hole.hp > 0) {
          for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            // Skip already-eaten enemies AND telegraphing (frozen) ones — a
            // spawning-in enemy is inert to the hole until it activates.
            if (consumedEnemies.has(e) || e.telegraphMs > 0) continue;
            const dx = hole.x - e.x;
            const dy = hole.y - e.y;
            const r = hole.radius + e.radius;
            if (dx * dx + dy * dy <= r * r) {
              consumedEnemies.add(e);
              releaseEnemies.push(e);
              releaseEnemyOwners.push(owners[i]);
              this._feed(hole);
            }
          }
        }

        // (4) Detonation: hp exhausted → payout + deferred release.
        if (hole.hp <= 0) {
          this.scoreState.score += BLACKHOLE_SCORE;
          releaseHoles.push(hole);
        }
      }

      // Second pass: safe to mutate the pools now. Release absorbed bullets to the
      // bullet pool; release absorbed enemies to their OWNING pool and append each
      // to the collision system's kill report (the reconciliation seam).
      for (let i = 0; i < releaseBullets.length; i++) {
        this.bulletPool.release(releaseBullets[i]);
      }
      for (let i = 0; i < releaseEnemies.length; i++) {
        const e = releaseEnemies[i];
        releaseEnemyOwners[i].release(e);
        cs.killedEnemies.push(e);
      }
      for (let i = 0; i < releaseHoles.length; i++) {
        this.holePool.release(releaseHoles[i]);
      }
    }

    // Self-spawn at a constant cadence, capped at BLACKHOLE_MAX_ACTIVE. Ungated
    // (no input channel), so it always accumulates — mirrors the enemy systems.
    this._accumMs += dt;
    while (this._accumMs >= BLACKHOLE_SPAWN_INTERVAL_MS) {
      this._accumMs -= BLACKHOLE_SPAWN_INTERVAL_MS;
      if (this.holePool.activeCount < BLACKHOLE_MAX_ACTIVE) {
        this._spawnOne();
      }
    }
  }

  /**
   * Apply one hole's gravity to an entity as a POSITION nudge toward the body:
   * displacement = STRENGTH·(1 − d/GRAVITY_RADIUS)·dtSec along unit(hole − e).
   * A no-op outside the gravity radius or exactly at the core (no direction, no
   * NaN). Mutates e.x / e.y in place.
   * @private
   */
  _pull(hole, e, dtSec) {
    const dx = hole.x - e.x;
    const dy = hole.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < BLACKHOLE_GRAVITY_RADIUS) {
      const pull = BLACKHOLE_GRAVITY_STRENGTH * (1 - d / BLACKHOLE_GRAVITY_RADIUS) * dtSec;
      const inv = pull / d; // (pull magnitude) × unit(dx,dy)
      e.x += dx * inv;
      e.y += dy * inv;
    }
  }

  /**
   * Record one feed: bump the feed counter, grow the radius (clamped at
   * BLACKHOLE_MAX_RADIUS), and emit one seeker per BLACKHOLE_FEED_PER_SPAWN feeds.
   * @private
   */
  _feed(hole) {
    hole.feed += 1;
    if (hole.radius < BLACKHOLE_MAX_RADIUS) {
      hole.radius = Math.min(
        BLACKHOLE_MAX_RADIUS,
        hole.radius + BLACKHOLE_GROWTH_PER_FEED,
      );
    }
    while (hole.feed >= BLACKHOLE_FEED_PER_SPAWN) {
      hole.feed -= BLACKHOLE_FEED_PER_SPAWN;
      this._spawnSeekerAtEdge();
    }
  }

  /**
   * Emit one seeker at a random arena edge into the shared spawn pool (NOT next to
   * the hole — otherwise this hole's own gravity would pull it straight back in).
   * Placement is the established edge-spawn, re-rolled (bounded) to keep the seeker
   * ≥ SPAWN_SAFE_RADIUS from the ship (`this.ship`, Story 2.6). The fresh seeker
   * starts frozen + non-lethal for ENEMY_SPAWN_TELEGRAPH_MS.
   * @private
   */
  _spawnSeekerAtEdge() {
    const s = this.spawnPool.acquire();
    const ship = this.ship;
    const p = pickSafeEdgePlacement(
      this._rng,
      SEEKER_RADIUS,
      ship ? ship.x : undefined,
      ship ? ship.y : undefined,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    s.x = p.x;
    s.y = p.y;
    // Start at rest; the owning enemy system sets velocity on its next tick.
    s.vx = 0;
    s.vy = 0;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    s.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
  }

  /**
   * Spawn one hole at a random INTERIOR point (inset by its radius so the body sits
   * fully inside the drawn border), re-initialized to its starting shape. Story
   * 2.6: the placement re-rolls (bounded) to keep the hole ≥ SPAWN_SAFE_RADIUS from
   * the ship (`this.ship`), and the fresh hole starts frozen + non-lethal for
   * ENEMY_SPAWN_TELEGRAPH_MS.
   * @private
   */
  _spawnOne() {
    const h = this.holePool.acquire();
    const ship = this.ship;
    const p = pickSafeInteriorPlacement(
      this._rng,
      BLACKHOLE_RADIUS,
      ship ? ship.x : undefined,
      ship ? ship.y : undefined,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    h.x = p.x;
    h.y = p.y;
    // Re-initialize the pooled instance to a fresh hole.
    h.radius = BLACKHOLE_RADIUS;
    h.hp = BLACKHOLE_HP;
    h.feed = 0;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    h.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
  }
}
