import { System } from '../core/System.js';

// CollisionSystem — bullet↔enemy destruction across all archetype pools (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER the enemy/green-square and firing
// systems, so it sees post-move bullet and enemy positions. Each fixed step it
// tests active bullets against the active enemies of EVERY enemy pool it is
// given (circle-circle) and releases each hit enemy to ITS OWN owning pool and
// consumed bullets to the bullet pool. It owns no pool — it reads the pools it
// is given (the single sources of active/free truth).
//
// The enemy pools are a LIST so every archetype (Blue Seeker, Green Square, and
// future Epic-2 enemies) plugs into this one seam instead of a per-type
// duplicate. Every enemy shares the uniform {x,y,radius,score} shape, so this
// seam reads only x,y,radius (and score is carried through for the ScoringSystem)
// and stays type-agnostic.
//
// Contract (from the I/O matrix), preserved once generalized to N pools:
//   - A bullet is consumed after it hits: one bullet destroys AT MOST one enemy
//     ACROSS ALL pools.
//   - An enemy is destroyed once: an enemy already hit this tick is skipped, so
//     two bullets over the same enemy release it only once (no double-release);
//     the second bullet finds no unhit target and stays active.
//   - Hit when center distance ≤ bullet.radius + enemy.radius (boundary counts).
//
// Zero per-frame allocation: reusable scratch arrays materialize the pools'
// active sets (iterating a Set directly can't be indexed, and releasing mutates
// it mid-iteration — both unsafe), a parallel array records each enemy's owning
// pool so the release routes correctly, and pre-cleared reusable Sets track hits.
// Releases are deferred to a second pass because mutating a pool's active set
// mid-iteration is unsafe.
export class CollisionSystem extends System {
  /**
   * @param {import('../core/Pool.js').Pool} bulletPool Active bullets to test/consume.
   * @param {import('../core/Pool.js').Pool[]} enemyPools Array of enemy pools
   *   (one per archetype) whose active instances are tested/destroyed.
   */
  constructor(bulletPool, enemyPools) {
    super();
    this.bulletPool = bulletPool;
    this.enemyPools = enemyPools;

    // Reusable scratch: materialized active sets, refilled each tick. `_owners`
    // is parallel to `_enemies` — `_owners[i]` is the pool that owns `_enemies[i]`
    // so a hit routes its release to the correct pool.
    this._bullets = [];
    this._enemies = [];
    this._owners = [];
    // Hoisted collect callback + the pool it is currently materializing, so the
    // per-pool `forEachActive` below reuses one closure instead of allocating a
    // fresh arrow per pool per tick (keeps materialization O(1)-alloc for any
    // number of pools).
    this._currentPool = null;
    this._collectEnemy = (s) => {
      this._enemies.push(s);
      this._owners.push(this._currentPool);
    };
    // Reusable pre-cleared hit-tracking sets, so a bullet that already hit is
    // skipped and an enemy already destroyed is skipped.
    this._hitBullets = new Set();
    this._hitEnemies = new Set();

    // Public per-tick kill report: the enemies this system destroyed this tick
    // (any archetype). Reset at the top of every fixedUpdate (so an empty tick
    // reports [] and a kill is never counted twice), then filled in pass 2
    // alongside release. Read by the ScoringSystem, which runs immediately after
    // this system. Reused array — no per-tick allocation.
    this.killedEnemies = [];
  }

  /**
   * Advance one fixed step: test bullets vs enemies across all pools, mark hits,
   * then release each to its owning pool.
   * @param {number} _dt Constant fixed-step delta (ms) — collision is stateless
   *   in dt; positions are already integrated by the prior systems this tick.
   */
  fixedUpdate(_dt) {
    // Materialize the bullet set and the union of all enemy pools into reusable
    // scratch (length reset, no alloc), recording each enemy's owning pool.
    const bullets = this._bullets;
    const enemies = this._enemies;
    const owners = this._owners;
    bullets.length = 0;
    enemies.length = 0;
    owners.length = 0;
    this.bulletPool.forEachActive((b) => bullets.push(b));
    const pools = this.enemyPools;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }

    const hitBullets = this._hitBullets;
    const hitEnemies = this._hitEnemies;
    hitBullets.clear();
    hitEnemies.clear();

    // Reset the per-tick kill report so a tick with no kills reports [] and a
    // previous tick's kills are never re-counted (length reset, no alloc).
    const killedEnemies = this.killedEnemies;
    killedEnemies.length = 0;

    // Pass 1: mark hits. A bullet stops after its first hit (consumed); an enemy
    // already hit this tick is skipped (destroyed once).
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      for (let j = 0; j < enemies.length; j++) {
        const s = enemies[j];
        if (hitEnemies.has(s)) {
          continue; // already destroyed by an earlier bullet this tick
        }
        const dx = b.x - s.x;
        const dy = b.y - s.y;
        const r = b.radius + s.radius;
        // Squared compare avoids a sqrt; ≤ so a boundary touch counts as a hit.
        if (dx * dx + dy * dy <= r * r) {
          hitBullets.add(b);
          hitEnemies.add(s);
          break; // bullet consumed — at most one enemy per bullet
        }
      }
    }

    // Pass 2: release marked instances to their OWNING pool (safe to mutate the
    // pools now) and record each released enemy in the public kill report for
    // the ScoringSystem. Iterate the parallel arrays so each release routes to
    // the pool that owns that instance.
    for (let j = 0; j < enemies.length; j++) {
      const s = enemies[j];
      if (hitEnemies.has(s)) {
        killedEnemies.push(s);
        owners[j].release(s);
      }
    }
    for (const b of hitBullets) {
      this.bulletPool.release(b);
    }
  }
}
