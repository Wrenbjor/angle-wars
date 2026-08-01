import { System } from '../core/System.js';
import { reflectBulletOffEnemy } from './ricochet.js';
import {
  PLAYER_BULLET_BASE_DAMAGE,
  PLAYER_BULLET_MIN_DAMAGE,
  HP_EPSILON,
  CRITICAL_RESONANCE_CRIT_CHANCE,
  CRITICAL_RESONANCE_CRIT_MULT,
  CRITICAL_RESONANCE_XP_REFUND,
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
    this.flakSystem = null;

    // Story 12.11 — late-bound references for Critical Resonance.
    // scoreState: for XP refund on crit kills.
    this.scoreState = null;
    // gridFieldSystem: for ripple emission on crit hits.
    this.gridFieldSystem = null;
    // _critHits: parallel Map from enemy → {x, y} for crit kills that need ripple + XP.
    // Carries hit-position info from pass 1 into pass 2's kill handling.
    this._critHits = new Map();

    // Story 12.16 — late-bound Stasis Lock references (set from buildArenaWorld.js).
    // stasisLockXpOrbSystem: the StasisLockSystem instance for spawning extra XP orbs on frozen kills.
    this.stasisLockXpOrbSystem = null;
    // stasisFreezeActive: true while Stasis Lock freeze window is active (frozen enemies take 2× damage).
    this.stasisFreezeActive = false;


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

    // Public read-only observability latch (Story 4.2): the number of enemies killed
    // by PLAYER DAMAGE this tick. The array is only ever appended to, never reordered,
    // so killedEnemies[0 .. bulletKillCount) is exactly this tick's player-damage
    // kills — still contiguous, and still EXCLUDING the unscored BlackHoleSystem
    // absorbs / BombSystem clears that are appended to the same shared array
    // afterwards. The GridFieldSystem reads this to emit one explosion ripple per such
    // kill. Purely observational — it never affects kills, scoring, lives, or any pool.
    //
    // ⚠ CONTRACT WIDENED in Story 10.5, name deliberately KEPT. It used to mean
    // "bullet kills"; it now means "kills through applyPlayerDamage" — bullets first
    // (pass 2 below), then the Afterburner dash's Lv4+ contact sweep. The `bulletKill*`
    // / `bulletDamageCount` names are unchanged because SIX consumer systems read them
    // and renaming is not that story's scope; read them as "player damage".
    //
    // Any FUTURE producer of player-damage kills must (a) append through
    // `applyPlayerDamage`, never by hand, so the counters and the parallel snapshot
    // arrays stay index-aligned, and (b) be registered BETWEEN this system and
    // ScoringSystem — earlier and its kills land in arrays this system then resets,
    // later and they are never scored.
    this.bulletKillCount = 0;

    // Public read-only observability latch (Story 9.3): the per-tick count of
    // PLAYER-DAMAGE hits that landed this tick (bullets, plus the Story 10.5 dash
    // sweep — the same widened contract as bulletKillCount above) — every hit,
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
    // position of the k-th player-damage kill, captured AT KILL TIME. Snapshots are load-
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
    // 0 and a prior tick's count never carries over. Both counters are now INCREMENTED
    // by applyPlayerDamage (Story 10.5) rather than assigned at the end of pass 2, so
    // a later same-tick producer (DashSystem) appending through the same helper keeps
    // them correct — which makes this top-of-tick reset the ONLY place they are zeroed.
    this.bulletDamageCount = 0;
    this.bulletKillCount = 0;
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
          // Record the HITTING bullet's damage against this enemy (Story 10.2), at the
          // bullet's CURRENT (pre-growth) stamped value — resolved BEFORE any ricochet
          // reflection below grows it, so a bounced bullet's enemy hit deals the damage it
          // arrived with, not its next-bounce value.
          // Resolved defensively in two steps. FALLBACK: a bullet with no `damage`
          // field (a hand-built fixture, or any non-FiringSystem bullet source) or a
          // non-finite / non-positive value uses the named base unit, so the v1
          // one-hit-one-unit contract is preserved for every such bullet. CLAMP: a
          // finite, positive but TINY damage is floored at PLAYER_BULLET_MIN_DAMAGE,
          // because `hp -= dmg` makes no progress at all once dmg falls below
          // ulp(hp) — an unclampable 1e-12 leaves an armored enemy alive after every
          // hit, forever, while still crediting the DPS governor a hit per tick.
          let hitDmg = Number.isFinite(b.damage) && b.damage > 0
            ? Math.max(PLAYER_BULLET_MIN_DAMAGE, b.damage)
            : PLAYER_BULLET_BASE_DAMAGE;
          // Story 12.11 — Critical Resonance: on hit, check for crit.
          // If the bullet has resonanceActive and the roll succeeds, apply 3× damage
          // and track the hit position for ripple emission in pass 2.
          if (b.resonanceActive && Math.random() < CRITICAL_RESONANCE_CRIT_CHANCE) {
            hitDmg *= CRITICAL_RESONANCE_CRIT_MULT;
            this._critHits.set(s, { x: s.x, y: s.y });
          }
          hitEnemies.set(s, hitDmg);
          // Flak Burst (Story 11.6): airburst on enemy hit
          if (b.isFlak) {
            b.isFlak = false;
            if (this.flakSystem) {
              this.flakSystem.triggerAirburst(
                b.x,
                b.y,
                b.flakFragments,
                b.flakDamageMult,
                b.flakSecondaryAirburst >= 1,
              );
            }
          }
          // Ricochet Rounds (Story 11.5): a bullet flagged to bounce off enemies WITH budget
          // left reflects OFF the enemy it hit (still dealing the damage recorded above),
          // grows its damage, spends a bounce, and STAYS LIVE — it is NOT added to hitBullets
          // and so is not consumed. Sunburst (Story 12.6) pierce also decrements on bounce
          // off an enemy (the bullet reflects AND pierces), then stays alive.
          if (b.bounceOffEnemies && b.bouncesRemaining > 0) {
            reflectBulletOffEnemy(b, s);
            // Also decrement pierse so a bullet with both Ricochet + Sunburst
            // doesn't achieve unlimited pierce via bounce-pierce cycle.
            if (b.pierceRemaining > 0) {
              b.pierceRemaining = Math.max(0, b.pierceRemaining - 1);
            }
          }
          // Sunburst (Story 12.6): ring bullets with pierceRemaining > 0 DO NOT
          // get consumed on enemy hit — they pierce through to the next enemy.
          else if (b.pierceRemaining > 1) {
            b.pierceRemaining -= 1;
            // Bullet stays alive — NOT added to hitBullets.
          }
          // Non-piercing bullet (pierceRemaining === 0) or last-pierce bullet (pierceRemaining === 1):
          // consumed after this hit. Decrement to 0 to reflect the bullet being done.
          else {
            if (b.pierceRemaining === 1) {
              b.pierceRemaining = 0;
            }
            hitBullets.add(b);
          }
          break;

        }
      }
    }

    // Pass 2: resolve each marked hit (safe to mutate the pools now) by delegating to
    // `applyPlayerDamage` — the SHARED armor-respecting damage path (Story 10.5)
    // extracted verbatim from what used to be inline here, so bullet behavior is
    // byte-identical and the dash cannot drift from it. Every hit credits ONE integer
    // damage-unit to `bulletDamageCount` (the honest per-hit build-power figure —
    // Story 9.3; deliberately a HIT COUNT, not the scaled damage, so the DPS ring
    // stays integer-valued and the Story 9.2 governor keeps its hits/sec calibration).
    // An ARMORED survivor (a finite hp GREATER than the hitting bullet's damage,
    // beyond the HP_EPSILON rounding guard) ABSORBS the hit: hp drops by that damage
    // and the enemy is NOT released and NOT reported as a kill (drops no orb / no
    // score / no kill-ripple — a non-killing armor hit). A one-hit enemy (no hp field,
    // or an hp the hit meets or exceeds — the armored's final hit) runs the kill path:
    // record it in the public kill report + snapshots for the ScoringSystem/grid/XP
    // and release it to its OWNING pool. Iterate the parallel arrays so each release
    // routes to the pool that owns that instance.
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
    for (let j = 0; j < enemies.length; j++) {
      const s = enemies[j];
      if (hitEnemies.has(s)) {
        // The hitting bullet's damage (Story 10.2), routed through the SHARED helper
        // so a bullet and a dash resolve armor identically (Story 10.5).
        const wasKilled = this.applyPlayerDamage(s, owners[j], hitEnemies.get(s));
        // Story 12.11 — Critical Resonance: emit grid ripple and refund XP for crit kills.
        if (wasKilled) {
          const critInfo = this._critHits.get(s);
          if (critInfo) {
            // Emit a grid ripple at the crit hit position.
            if (this.gridFieldSystem) {
              this.gridFieldSystem._emit(critInfo.x, critInfo.y);
            }
            // Refund XP for the crit kill.
            if (this.scoreState) {
              this.scoreState.xp += CRITICAL_RESONANCE_XP_REFUND;
            }
            this._critHits.delete(s);
          }
        }
      }
    }
    for (const b of hitBullets) {
      this.bulletPool.release(b);
    }
  }

  /**
   * Resolve ONE unit of PLAYER DAMAGE against one enemy — the single armor-respecting
   * damage path (Story 10.5, extracted verbatim from pass 2 above).
   *
   * Called by pass 2 for every bullet hit, and by DashSystem for every Lv4+ dash
   * contact. Extracting it is what makes an armored enemy behave IDENTICALLY whether a
   * bullet or a dash hits it, instead of a bespoke second copy drifting out of step —
   * and it is deliberately NOT the BombSystem's `hp`-ignoring outright release.
   *
   * Effects, in order:
   *   1. credits ONE integer damage-unit to `bulletDamageCount` (the honest per-hit
   *      build-power figure Story 9.3's DPS governor reads — a HIT COUNT, not the
   *      scaled damage, so the ring stays integer-valued);
   *   2. ARMORED SURVIVOR (a finite hp GREATER than `damage`, beyond the HP_EPSILON
   *      rounding guard): hp drops by `damage`, the enemy is NOT released and NOT
   *      reported as a kill (no orb / no score / no kill-ripple) — returns false;
   *   3. otherwise KILL: appended to `killedEnemies` with its parallel x/y/xp
   *      snapshots, released to its OWNING pool, and `bulletKillCount` INCREMENTED —
   *      returns true.
   *
   * `bulletKillCount` / `bulletDamageCount` are incremented HERE rather than assigned
   * at the end of pass 2, precisely so a LATER system appending through this helper
   * keeps both counters correct and the snapshot arrays index-aligned.
   * @param {{x:number,y:number,hp?:number,xp?:number}} enemy The enemy taking damage.
   * @param {import('../core/Pool.js').Pool} ownerPool The pool that owns it (a kill
   *   releases there).
   * @param {number} damage The damage this hit deals.
   * @returns {boolean} true if the enemy was KILLED, false if it survived (armor).
   */
  applyPlayerDamage(enemy, ownerPool, damage) {
    // every hit = 1 integer damage-unit (armor survivor OR kill)
    this.bulletDamageCount += 1;
    // Story 12.16 — Stasis Lock: double damage while frozen.
    const effectiveDamage = this.stasisFreezeActive ? damage * 2 : damage;
    if (Number.isFinite(enemy.hp) && enemy.hp > effectiveDamage + HP_EPSILON) {
      // Armored survivor: absorb this hit's damage and live. NOT released, NOT a
      // kill. At the base damage unit (1) this is byte-for-byte the pre-10.2
      // `hp > 1` / `hp -= 1` branch.
      enemy.hp -= effectiveDamage;
      return false;
    }
    this.killedEnemies.push(enemy);
    // Snapshot the kill coordinates NOW, before releasing the object to its pool —
    // a later same-tick acquire() could overwrite enemy.x/y (Story 4.2).
    this.bulletKillX.push(enemy.x);
    this.bulletKillY.push(enemy.y);
    // Snapshot the XP value too (Story 8.1), guarded to a finite number → 0 (mirrors
    // scoring's finite-score guard) so a malformed instance can never credit a
    // non-finite XP amount downstream.
    this.bulletKillXp.push(Number.isFinite(enemy.xp) ? enemy.xp : 0);
    ownerPool.release(enemy);
    this.bulletKillCount += 1;
    // Story 12.16 — Stasis Lock: spawn extra XP orb for frozen kill.
    const isFrozen = this.stasisFreezeActive;
    if (isFrozen && this.stasisLockXpOrbSystem) {
      this.stasisLockXpOrbSystem.spawnExtraXpOrb(
        enemy.x, enemy.y, Number.isFinite(enemy.xp) ? enemy.xp : 0,
      );
    }
    return true;
  }
}
