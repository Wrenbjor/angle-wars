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
    // Hoisted bullet collector — a stable instance-field arrow created once (like
    // `_collectEnemy`), so materializing the bullet set reuses one closure instead
    // of allocating a fresh arrow per tick.
    this._collectBullet = (b) => this._bullets.push(b);
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

    // Public read-only observability latch (Story 4.2): the number of enemies THIS
    // system destroyed by a player bullet this tick — i.e. the length of
    // killedEnemies at the end of THIS system's fixedUpdate, BEFORE later systems
    // (BlackHoleSystem absorbs, BombSystem clears) append their own removals to the
    // same shared array. The array is only ever appended to, never reordered, so
    // killedEnemies[0 .. bulletKillCount) is exactly this tick's bullet kills. The
    // GridFieldSystem reads this to emit an explosion ripple per bullet kill only.
    // Purely observational — it never affects kills, scoring, lives, or any pool.
    this.bulletKillCount = 0;

    // Public read-only observability latch (Story 9.3): the per-tick count of
    // player-bullet hits that DEALT DAMAGE this tick — every hit that landed,
    // whether it KILLED (one-shot enemy, or an armored's final hit) OR only
    // decremented an armored survivor's hp. This is the HONEST build-power figure
    // (damage output, not just kills) that DpsTelemetrySystem reads: pouring fire
    // into armor still registers as build power, so the Story 9.2 governor stays
    // honest. Each hit credits exactly 1 (integer), so the DPS ring stays integer-
    // valued (no float drift — the deferred-work fractional-per-kill risk avoided).
    // Reset to 0 at the top of every fixedUpdate, then set at the end of pass 2.
    // A non-killing armor hit increments THIS but NOT bulletKillCount (which keeps
    // its kill-only semantics — score/XP orbs/grid ripples stay kill-only).
    this.bulletDamageCount = 0;

    // Public read-only coordinate SNAPSHOTS (Story 4.2), parallel to the first
    // bulletKillCount entries of killedEnemies: bulletKillX[k]/bulletKillY[k] are the
    // position of the k-th bullet kill, captured AT KILL TIME. Snapshots are load-
    // bearing: this system releases a bullet-killed enemy back to its pool this tick,
    // and a later same-tick system (e.g. the SpawnDirector acquiring a fresh enemy)
    // can acquire() that very object and overwrite its x/y — so reading the enemy object's
    // coords at end-of-tick could yield the recycled spawn position, not the kill
    // point. Snapshotting here makes the grid's explosion origin recycle-proof.
    // Reused arrays — length reset + push, no per-tick allocation.
    this.bulletKillX = [];
    this.bulletKillY = [];

    // Public read-only XP SNAPSHOTS (Story 8.1), parallel to bulletKillX/Y: the
    // per-type XP value of the k-th bullet kill, captured AT KILL TIME alongside the
    // coordinate snapshot. Recycle-proof for the same reason the coords are — the
    // killed enemy is released this tick and a later same-tick acquire() could
    // overwrite its `xp`. The XpOrbSystem reads bulletKillXp[0 .. bulletKillCount)
    // to drop one orb per bullet kill carrying that kill's value. Purely
    // observational; never affects kills, scoring, lives, or any pool.
    this.bulletKillXp = [];
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
    this.bulletPool.forEachActive(this._collectBullet);
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
    // Reset the per-tick damage-hit count (Story 9.3) so a tick with no hits reports
    // 0 and a prior tick's count never carries over. Refilled at the end of pass 2.
    this.bulletDamageCount = 0;
    // Reset the parallel bullet-kill coordinate snapshots too (Story 4.2), and the
    // parallel XP snapshot (Story 8.1).
    const bulletKillX = this.bulletKillX;
    const bulletKillY = this.bulletKillY;
    const bulletKillXp = this.bulletKillXp;
    bulletKillX.length = 0;
    bulletKillY.length = 0;
    bulletKillXp.length = 0;

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

    // Pass 2: resolve each marked hit (safe to mutate the pools now). Every hit
    // credits ONE integer damage-unit to `damageCount` (the honest per-hit build-
    // power figure — Story 9.3). An ARMORED survivor (a finite hp > 1) ABSORBS the
    // hit: hp is decremented and the enemy is NOT released and NOT reported as a
    // kill (drops no orb / no score / no kill-ripple — a non-killing armor hit). A
    // one-hit enemy (no hp field, or hp <= 1 — the armored's final hit) runs the
    // existing kill path UNCHANGED: record it in the public kill report + snapshots
    // for the ScoringSystem/grid/XP and release it to its OWNING pool. Iterate the
    // parallel arrays so each release routes to the pool that owns that instance.
    let damageCount = 0;
    for (let j = 0; j < enemies.length; j++) {
      const s = enemies[j];
      if (hitEnemies.has(s)) {
        damageCount++; // every hit = 1 integer damage-unit (armor survivor OR kill)
        if (Number.isFinite(s.hp) && s.hp > 1) {
          // Armored survivor: absorb one hit and live. NOT released, NOT a kill.
          s.hp -= 1;
          continue;
        }
        killedEnemies.push(s);
        // Snapshot the kill coordinates NOW, before releasing the object to its
        // pool — a later same-tick acquire() could overwrite s.x/s.y (Story 4.2).
        bulletKillX.push(s.x);
        bulletKillY.push(s.y);
        // Snapshot the XP value too (Story 8.1), guarded to a finite number →
        // 0 (mirrors scoring's finite-score guard) so a malformed instance can
        // never credit a non-finite XP amount downstream.
        bulletKillXp.push(Number.isFinite(s.xp) ? s.xp : 0);
        owners[j].release(s);
      }
    }
    for (const b of hitBullets) {
      this.bulletPool.release(b);
    }
    // Latch this tick's damage-hit count (Story 9.3): kills PLUS non-killing armor
    // hits, each 1 integer damage-unit. DpsTelemetrySystem reads this (not the
    // kill-only bulletKillCount) so build power reflects damage dealt, not just kills.
    this.bulletDamageCount = damageCount;

    // Latch this tick's bullet-kill count (Story 4.2). Captured here, at the end of
    // pass 2, so it reflects ONLY the enemies bullets destroyed this tick — before
    // BlackHoleSystem/BombSystem append their (unscored) removals to killedEnemies.
    // Read-only observability for the grid; changes no gameplay behavior.
    this.bulletKillCount = killedEnemies.length;
  }
}
