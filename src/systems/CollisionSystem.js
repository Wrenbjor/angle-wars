import { System } from '../core/System.js';

// CollisionSystem — bullet↔enemy destruction (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER the enemy and firing systems, so it
// sees post-move bullet and seeker positions. Each fixed step it tests active
// bullets against active seekers (circle-circle) and releases hit seekers to the
// enemy pool and consumed bullets to the bullet pool. It owns no pool — it reads
// the two pools it is given (the single sources of active/free truth).
//
// Contract (from the I/O matrix):
//   - A bullet is consumed after it hits: one bullet destroys AT MOST one seeker.
//   - A seeker is destroyed once: a seeker already hit this tick is skipped, so
//     two bullets over the same seeker release it only once (no double-release);
//     the second bullet finds no unhit target and stays active.
//   - Hit when center distance ≤ bullet.radius + seeker.radius (boundary counts).
//
// Zero per-frame allocation: two reusable scratch arrays materialize the pools'
// active sets (iterating a Set directly can't be indexed, and releasing mutates
// it mid-iteration — both unsafe), and two pre-cleared reusable Sets track hits.
// Releases are deferred to a second pass because mutating a pool's active set
// mid-iteration is unsafe.
export class CollisionSystem extends System {
  /**
   * @param {import('../core/Pool.js').Pool} bulletPool Active bullets to test/consume.
   * @param {import('../core/Pool.js').Pool} enemyPool  Active seekers to test/destroy.
   */
  constructor(bulletPool, enemyPool) {
    super();
    this.bulletPool = bulletPool;
    this.enemyPool = enemyPool;

    // Reusable scratch: materialized active sets, refilled each tick.
    this._bullets = [];
    this._seekers = [];
    // Reusable pre-cleared hit-tracking sets, so a bullet that already hit is
    // skipped and a seeker already destroyed is skipped.
    this._hitBullets = new Set();
    this._hitSeekers = new Set();
  }

  /**
   * Advance one fixed step: test bullets vs seekers, mark hits, then release.
   * @param {number} _dt Constant fixed-step delta (ms) — collision is stateless
   *   in dt; positions are already integrated by the prior systems this tick.
   */
  fixedUpdate(_dt) {
    // Materialize both active sets into reusable scratch (length reset, no alloc).
    const bullets = this._bullets;
    const seekers = this._seekers;
    bullets.length = 0;
    seekers.length = 0;
    this.bulletPool.forEachActive((b) => bullets.push(b));
    this.enemyPool.forEachActive((s) => seekers.push(s));

    const hitBullets = this._hitBullets;
    const hitSeekers = this._hitSeekers;
    hitBullets.clear();
    hitSeekers.clear();

    // Pass 1: mark hits. A bullet stops after its first hit (consumed); a seeker
    // already hit this tick is skipped (destroyed once).
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      for (let j = 0; j < seekers.length; j++) {
        const s = seekers[j];
        if (hitSeekers.has(s)) {
          continue; // already destroyed by an earlier bullet this tick
        }
        const dx = b.x - s.x;
        const dy = b.y - s.y;
        const r = b.radius + s.radius;
        // Squared compare avoids a sqrt; ≤ so a boundary touch counts as a hit.
        if (dx * dx + dy * dy <= r * r) {
          hitBullets.add(b);
          hitSeekers.add(s);
          break; // bullet consumed — at most one seeker per bullet
        }
      }
    }

    // Pass 2: release marked instances (safe to mutate the pools now).
    for (const s of hitSeekers) {
      this.enemyPool.release(s);
    }
    for (const b of hitBullets) {
      this.bulletPool.release(b);
    }
  }
}
