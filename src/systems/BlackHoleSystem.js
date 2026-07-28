import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createBlackHole, blackHoleInstability } from '../entities/BlackHole.js';
import { pickSafeInteriorPlacement } from './spawnPlacement.js';
import {
  BLACKHOLE_RADIUS,
  BLACKHOLE_UNSTABLE_RADIUS,
  BLACKHOLE_MIN_RADIUS,
  BLACKHOLE_GRAVITY_RADIUS,
  BLACKHOLE_GRAVITY_STRENGTH,
  BLACKHOLE_GROWTH_PER_ABSORB,
  BLACKHOLE_SHRINK_PER_BULLET,
  BLACKHOLE_SPAWN_INTERVAL_MS,
  BLACKHOLE_MAX_ACTIVE,
  BLACKHOLE_POOL_PREWARM,
  BLACKHOLE_SCORE,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
  CHRONO_SLOW_FACTOR_MAX,
} from '../config/constants.js';

// BlackHoleSystem — the Black Hole hazard: gravity + absorb/grow/shrink +
// instability detonation/implosion (Phaser-free, reworked in Story 6.2).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, ordered LATE in
// the tick — AFTER the enemy movers, the bullet integrator, the CollisionSystem,
// and the ScoringSystem, and BEFORE the BombSystem and PlayerDeathSystem. That
// ordering is load-bearing:
//   - Gravity is a POSITION nudge applied after every mover has integrated
//     x += v·dt, so it accumulates instead of being erased (the movers recompute
//     velocity each tick — a velocity force would vanish; see the spec Design
//     Notes). Because it is scaled by dtSec it is frame-rate-independent.
//   - Running after ScoringSystem means an absorbed enemy appended to
//     collisionSystem.killedEnemies is REMOVED (reconciled by owner systems like
//     SnakeSystem on their next tick) but NOT scored — only the player's own
//     bullet kills add score at the seam.
//   - Running BEFORE BombSystem lets a detonation late-bind `bombSystem` and reuse
//     its `detonateAt` screen clear; running BEFORE PlayerDeathSystem lets a
//     detonation set `playerState.pendingDeath` for the SAME-tick life cost.
//
// The hole is an UNSTABLE ticking bomb: `radius` is the SINGLE instability metric.
// Absorbed enemies GROW it (BLACKHOLE_GROWTH_PER_ABSORB) toward
// BLACKHOLE_UNSTABLE_RADIUS; absorbed player bullets SHRINK it
// (BLACKHOLE_SHRINK_PER_BULLET) toward BLACKHOLE_MIN_RADIUS. After a tick's
// absorptions the hole is evaluated ONCE:
//   - radius >= BLACKHOLE_UNSTABLE_RADIUS → DETONATION: a smart-bomb screen clear
//     (bombSystem.detonateAt at the hole) + a player life (playerState.pendingDeath)
//     + release the hole. NO score payout.
//   - else radius <= BLACKHOLE_MIN_RADIUS → safe IMPLOSION: credit BLACKHOLE_SCORE
//     + release the hole. No screen clear, no life cost.
// Detonation takes precedence if both somehow hold. There is NO passive time-based
// growth and NO feed-driven seeker emission — the instability clock is the hole's
// only threat (no double jeopardy).
//
// Owns ONE prewarmed hole Pool (public `holePool`) — the single source of
// active/free truth. The hole is lethal-on-contact via the PlayerDeathSystem pool
// list (which reads only {x,y,radius}), but is deliberately NOT in the
// CollisionSystem list: it owns its own bullet-vs-hole absorption test.
//
// `collisionSystem` and `bombSystem` are late-bound by the scene (the hole pool
// must exist before the collision system that the death list references; the bomb
// system is constructed after this one). Until `collisionSystem` is set, enemy
// absorption is a guarded no-op (gravity + bullet-shrink still run); until
// `bombSystem` is set, a detonation still costs a life + releases the hole but its
// screen clear is a guarded no-op.
//
// `maxInstability` (public LEVEL, 0..1) is the max blackHoleInstability(radius)
// over the active non-telegraphing holes — the render red pulse and the audio
// urgency cue both derive from it (one formula, one source). 0 when no such hole.
//
// Zero steady-state allocation: reusable scratch materializes the active sets and
// records deferred releases (mutating a pool's active set mid-forEachActive is
// unsafe — collect, then release in a second pass, mirroring CollisionSystem).
export class BlackHoleSystem extends System {
  /**
     * @param {{x:number,y:number}} ship The player ship (pulled by gravity; read+mutated).
     * @param {import('../core/Pool.js').Pool} bulletPool Active bullets (pulled + absorbed → shrink).
     * @param {import('../core/Pool.js').Pool[]} enemyPools Every archetype enemy pool
     *   (their active instances are pulled + absorbed → grow).
     * @param {{score:number}} scoreState Shared run economy — credited the safe-implosion payout.
     * @param {{pendingDeath:boolean}} playerState Shared player lifecycle — a detonation
     *   sets `pendingDeath` so PlayerDeathSystem costs the player a life the same tick.
     * @param {Object<string, number>|() => number} [playerStatsOrRng] Shared runtime modifier
     *   store (Story 11.10: chronoSlowWorld), OR a legacy `rng` function for backward compat.
     * @param {() => number} [rng] Injectable RNG in [0,1) for spawn placement; injectable so
     *   spawn cadence/placement are unit-testable.
     */
  constructor(ship, bulletPool, enemyPools, scoreState, playerState, playerStatsOrRng, rng = Math.random) {
    super();
    this.ship = ship;
    this.bulletPool = bulletPool;
    this.enemyPools = enemyPools;
    this.scoreState = scoreState;
    this.playerState = playerState;
    this._rng = rng;
    if (typeof playerStatsOrRng === 'function') {
      // Backward-compat: existing callers pass (…, playerState, rng) without playerStats.
      this._rng = playerStatsOrRng;
      this._playerStats = undefined;
    } else {
      this._playerStats = playerStatsOrRng;
    }

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
    // Late-bound by the scene AFTER the BombSystem is constructed (BlackHoleSystem
    // runs before it). Until set, a detonation's screen clear is a guarded no-op
    // (the life cost + hole release still apply).
    this.bombSystem = null;

    // Public instability LEVEL (0..1): max blackHoleInstability over active
    // non-telegraphing holes, recomputed each tick. Drives the render red pulse and
    // the audio urgency cue. 0 when there is no such hole.
    this.maxInstability = 0;

    // Public per-tick DEFUSE report (Story 8.1): the positions of holes that safely
    // IMPLODED ("defused") this tick, parallel arrays defusedX[k]/defusedY[k]. Reset
    // to empty at the top of every fixedUpdate and pushed at implosion DETECTION
    // (before the hole is released, so the coords are recycle-safe primitives — no
    // aliasing). The XpOrbSystem reads this to drop one BLACKHOLE_DEFUSED_XP orb per
    // defuse. A DETONATION credits nothing and is deliberately NOT reported (economy
    // parity — an absorbed/bomb-cleared removal drops no XP). Reused arrays — no
    // per-tick allocation.
    this.defusedX = [];
    this.defusedY = [];

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
    // Holes that crossed a threshold this tick: detonations (screen clear + life)
    // and implosions (score payout). Both are released; these track the follow-up.
    this._detonateHoles = [];
    this._implodeHoles = [];
    // Hoisted maxInstability collector (skips telegraphing holes) — writes
    // this.maxInstability in place, no per-tick closure allocation.
    this._collectMaxInstability = (h) => {
      if (h.telegraphMs > 0) return; // a telegraphing hole is not yet unstable
      const inst = blackHoleInstability(h.radius);
      if (inst > this.maxInstability) this.maxInstability = inst;
    };
  }

  /**
   * Advance one fixed step: gravity + absorb/grow/shrink per active hole, then
   * evaluate detonation vs implosion, then self-spawn at cadence, then recompute
   * the instability level.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    // Story 11.10: if chronoSlowWorld is enabled, scale growth/shrink by (1 - slowFactor).
    const slowFactor = this._computeWorldSlowFactor();
    const growthMult = this._chronoSlowWorldEnabled() ? (1 - slowFactor) : 1;
    const shrinkMult = this._chronoSlowWorldEnabled() ? (1 - slowFactor) : 1;

    // Materialize the active holes, bullets, and the union of enemy pools into
    // reusable scratch (length reset, no alloc), recording each enemy's owner.
    const holes = this._holes;
    holes.length = 0;
    this.holePool.forEachActive(this._collectHole);

    // Reset the per-tick defuse report (Story 8.1) BEFORE the holes guard so a tick
    // with no holes reports [] and a prior tick's defuse is never re-read.
    const defusedX = this.defusedX;
    const defusedY = this.defusedY;
    defusedX.length = 0;
    defusedY.length = 0;

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
      const detonateHoles = this._detonateHoles;
      const implodeHoles = this._implodeHoles;
      consumedBullets.clear();
      consumedEnemies.clear();
      releaseBullets.length = 0;
      releaseEnemies.length = 0;
      releaseEnemyOwners.length = 0;
      releaseHoles.length = 0;
      detonateHoles.length = 0;
      implodeHoles.length = 0;

      for (let hi = 0; hi < holes.length; hi++) {
        const hole = holes[hi];

        // Story 2.6 telegraph gate: a spawning-in hole is frozen (no gravity,
        // absorb, grow, shrink, detonation, or implosion) and non-lethal until its
        // countdown reaches 0. Decrement by the fixed-step dt (frame-rate-independent),
        // clamp at 0, and skip the whole behavior while still telegraphing. On the
        // tick it reaches 0 it falls through and its gravity/absorb resume this tick.
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

        // (2a) Absorb overlapping bullets: consume + SHRINK toward the floor.
        //      Deferred release (mutating the bullet pool mid-walk is unsafe).
        for (let i = 0; i < bullets.length; i++) {
          const b = bullets[i];
          if (consumedBullets.has(b)) continue; // already eaten by an earlier hole
          const dx = hole.x - b.x;
          const dy = hole.y - b.y;
          const r = hole.radius + b.radius;
          if (dx * dx + dy * dy <= r * r) {
            consumedBullets.add(b);
            releaseBullets.push(b);
            // Clamp at a zero floor so several bullets overlapping one hole in a
            // single tick cannot drive the radius negative before the end-of-tick
            // implosion check (a negative radius would also distort the same-tick
            // enemy-absorb overlap test r = hole.radius + e.radius). The
            // implosion check radius <= BLACKHOLE_MIN_RADIUS still fires at 0.
            hole.radius = Math.max(0, hole.radius - BLACKHOLE_SHRINK_PER_BULLET * shrinkMult);
          }
        }

        // (2b) Absorb overlapping enemies — guarded until collisionSystem is set.
        //      Release to the OWNER pool AND append to killedEnemies so owner
        //      systems (e.g. SnakeSystem) reconcile through the same seam a bullet
        //      kill uses; NOT scored (runs after Scoring). Each absorbed enemy
        //      GROWS the hole toward the unstable threshold.
        if (cs) {
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
              hole.radius += BLACKHOLE_GROWTH_PER_ABSORB * growthMult;
            }
          }
        }

        // (3) Evaluate the hole ONCE after this tick's absorptions. Detonation
        //     (unstable threshold) takes precedence over implosion (floor) if both
        //     somehow hold. Either outcome releases the hole; the follow-up (screen
        //     clear + life, or payout) is deferred to the second pass below so the
        //     detonation's own enemy releases run AFTER this system's releases.
        if (hole.radius >= BLACKHOLE_UNSTABLE_RADIUS) {
          detonateHoles.push(hole);
          releaseHoles.push(hole);
        } else if (hole.radius <= BLACKHOLE_MIN_RADIUS) {
          implodeHoles.push(hole);
          releaseHoles.push(hole);
          // Story 8.1: report the defuse position NOW (before the hole is released
          // below) as recycle-safe primitive coords, so the XpOrbSystem can drop one
          // orb at the hole. Parallel to the score payout credited in the second pass.
          defusedX.push(hole.x);
          defusedY.push(hole.y);
        }
      }

      // Second pass — safe to mutate the pools now. Order is load-bearing:
      //   (a) release this system's own absorbed bullets/enemies/holes FIRST, so a
      //       detonation's screen clear (step d) cannot re-collect an already-
      //       absorbed enemy (it is inactive by then) — each enemy lands in
      //       killedEnemies exactly once (two-pass detonation safety);
      //   (b) THEN run each detonation's screen clear + life cost;
      //   (c) THEN credit each implosion's payout.
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
      // (b) Detonations: the reused smart-bomb screen clear at the hole's position
      //     (guarded — a null bombSystem still costs the life + releases the hole),
      //     plus the SAME-tick life cost through the normal death flow. NO payout.
      for (let i = 0; i < detonateHoles.length; i++) {
        const hole = detonateHoles[i];
        if (this.bombSystem) this.bombSystem.detonateAt(hole.x, hole.y);
        this.playerState.pendingDeath = true;
      }
      // (c) Implosions: the safe-defuse payout credited directly to the shared
      //     score surface (flat, never multiplied). No screen clear, no life cost.
      for (let i = 0; i < implodeHoles.length; i++) {
        this.scoreState.score += BLACKHOLE_SCORE;
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

    // Recompute the instability LEVEL: the max instability over the active,
    // non-telegraphing holes (a freshly self-spawned hole telegraphs, so it is
    // excluded). 0 when there is no such hole.
    this.maxInstability = 0;
    this.holePool.forEachActive(this._collectMaxInstability);
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
   * Spawn one hole at a random INTERIOR point (inset by its radius so the body sits
   * fully inside the drawn border), re-initialized to its starting (stable) shape.
   * Story 2.6: the placement re-rolls (bounded) to keep the hole ≥ SPAWN_SAFE_RADIUS
   * from the ship (`this.ship`), and the fresh hole starts frozen + non-lethal for
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
    // Re-initialize the pooled instance to a fresh, stable hole.
    h.radius = BLACKHOLE_RADIUS;
    // Telegraph: frozen + non-lethal until the countdown reaches 0.
    h.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
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
