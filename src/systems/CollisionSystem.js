import { System } from '../core/System.js';
import {
  PLAYER_BULLET_BASE_DAMAGE,
  PLAYER_BULLET_MIN_DAMAGE,
  HP_EPSILON,
} from '../config/constants.js';

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
// pool so the release routes correctly, and a pre-cleared reusable Set + Map track
// hits (the Map carries each hit enemy's claiming-bullet damage — Story 10.2).
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
    // Reusable pre-cleared hit-tracking structures, so a bullet that already hit is
    // skipped and an enemy already hit this tick is skipped.
    this._hitBullets = new Set();
    // enemy → the DAMAGE of the bullet that claimed it this tick (Story 10.2). A Map
    // rather than a Set (or a parallel array) because pass 2 iterates ENEMIES, not
    // bullets, and needs the damage of whichever bullet claimed each one. `.has()`
    // reads are unchanged; the Map is `.clear()`ed each tick, so it is still reused
    // (no per-tick allocation).
    this._hitEnemies = new Map();

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
          // Record the HITTING bullet's damage against this enemy (Story 10.2).
          // Resolved defensively in two steps. FALLBACK: a bullet with no `damage`
          // field (a hand-built fixture, or any non-FiringSystem bullet source) or a
          // non-finite / non-positive value uses the named base unit, so the v1
          // one-hit-one-unit contract is preserved for every such bullet. CLAMP: a
          // finite, positive but TINY damage is floored at PLAYER_BULLET_MIN_DAMAGE,
          // because `hp -= dmg` makes no progress at all once dmg falls below
          // ulp(hp) — an unclamped 1e-12 leaves an armored enemy alive after every
          // hit, forever, while still crediting the DPS governor a hit per tick.
          hitEnemies.set(
            s,
            Number.isFinite(b.damage) && b.damage > 0
              ? Math.max(PLAYER_BULLET_MIN_DAMAGE, b.damage)
              : PLAYER_BULLET_BASE_DAMAGE,
          );
          break; // bullet consumed — at most one enemy per bullet
        }
      }
    }

    // Pass 2: resolve each marked hit (safe to mutate the pools now). Every hit
    // credits ONE integer damage-unit to `damageCount` (the honest per-hit build-
    // power figure — Story 9.3; deliberately a HIT COUNT, not the scaled damage, so
    // the DPS ring stays integer-valued and the Story 9.2 governor keeps its
    // hits/sec calibration). An ARMORED survivor (a finite hp GREATER than the
    // hitting bullet's damage, beyond the HP_EPSILON rounding guard) ABSORBS the
    // hit: hp drops by that damage and the enemy is NOT released and NOT reported as
    // a kill (drops no orb / no score / no kill-ripple — a non-killing armor hit). A
    // one-hit enemy (no hp field, or an hp the hit meets or exceeds — the armored's
    // final hit) runs the existing kill path UNCHANGED: record it in the public kill
    // report + snapshots for the ScoringSystem/grid/XP and release it to its OWNING
    // pool. Iterate the parallel arrays so each release routes to the pool that owns
    // that instance.
    //
    // The rounding tolerance exists because scaled damage is rarely binary-exact:
    // repeated `hp -= dmg` leaves a few-ULP positive residue, so an hp that is an
    // exact multiple of the per-hit damage would survive one EXTRA hit on rounding
    // noise alone (hp 8 / dmg 1.6 → 6 hits instead of 5). Comparing against
    // `dmg + HP_EPSILON` kills that residual sliver on the hit that should have
    // finished it. At the base damage unit (1) hp is integral and the epsilon is
    // inert, so the pre-10.2 behavior is untouched.
    //
    // KNOWN LIMIT (see the ledger). The residue accumulates in proportion to
    // ulp(STARTING hp) x hit count, while HP_EPSILON is absolute — so the guard holds
    // only while hp stays O(10^3) or below. Measured: hp 6750 / dmg 1.35 is correct at
    // 5000 hits; hp 67500 / dmg 1.35 takes 50001 instead of 50000. A tolerance scaled
    // by the CURRENT hp does NOT fix this and was tried and rejected: by the deciding
    // comparison hp has fallen to ~dmg, so the relative term is ~1e-12 while the
    // accumulated residue is ~4e-8. A durable fix has to stop the accumulation (integer
    // or fixed-point hp), not widen the tolerance. ARMORED_HP is 5 and Epic 11 is the
    // first content that could approach the limit, so this is recorded, not guessed at.
    let damageCount = 0;
    for (let j = 0; j < enemies.length; j++) {
      const s = enemies[j];
      if (hitEnemies.has(s)) {
        damageCount++; // every hit = 1 integer damage-unit (armor survivor OR kill)
        const dmg = hitEnemies.get(s); // the hitting bullet's damage (Story 10.2)
        if (Number.isFinite(s.hp) && s.hp > dmg + HP_EPSILON) {
          // Armored survivor: absorb this bullet's damage and live. NOT released,
          // NOT a kill. At the base damage unit (1) this is byte-for-byte the
          // pre-10.2 `hp > 1` / `hp -= 1` branch.
          s.hp -= dmg;
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
