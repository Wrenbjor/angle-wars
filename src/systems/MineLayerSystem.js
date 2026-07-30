import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createMine } from '../entities/Mine.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  MINE_ARM_MS,
  MINE_DROP_PERIOD_FLOOR_MS,
  MINE_BASE_CAP,
  MINE_MAX_CAP,
  MINE_BASE_DETONATE_RADIUS,
  MINE_MAX_DETONATE_RADIUS,
  MINE_DETONATE_DAMAGE,
  MINE_PULL_RADIUS,
  MINE_PULL_STRENGTH,
  MINE_CHAIN_RADIUS,
  MINE_POOL_PREWARM,
  SINGULARITY_PULL_DURATION_MS,
  SINGULARITY_PULL_RADIUS,
  SINGULARITY_PULL_STRENGTH,
  SINGULARITY_DAMAGE_MULTIPLIER,
} from '../config/constants.js';

// MineLayerSystem — the Mine Layer's pooled timed mines + arm/pull/detonate/chain/drop
// (Story 11.3 / PRD §13.3), Phaser-free.
//
// Mine Layer is the third Epic-11 EXOTIC item and the first AoE-DETONATION entity: the
// kiting ship drops timed mines in its wake that ARM after a delay, then DETONATE on an
// approaching combat enemy — dealing FULL damage to every enemy in the blast. The SPLIT of
// responsibility mirrors SeekerDroneSystem / OrbitBladeSystem:
//   - the FOLD (state/PlayerStats.js) owns the DERIVED PARAMETERS — `mineDropPeriodMs`,
//     `mineCap`, `mineDetonateRadius`, `minePull` and `mineChain`;
//   - THIS system owns the live mine POOL and the drop ACCUMULATOR.
// They are split because `recomputePlayerStats` resets every field and re-derives the whole
// store on EVERY card pick: a live timer/pool kept there would be reset by picking any
// unrelated item.
//
// REGISTRATION SLOT (see scenes/buildArenaWorld.js) mirrors SeekerDroneSystem's exactly:
// AFTER CollisionSystem (its per-tick kill latches are already RESET this tick, so a mine
// kill lands in the fresh arrays) and BEFORE ScoringSystem (so a mine kill is SCORED and
// produces the full kill feedback — XP orb, ripple, spray, SFX). It also sits AFTER the
// movers (CollisionSystem is after them), which is why the Lv4 PULL is a POSITION nudge:
// a velocity force would be erased when the movers recompute velocity next tick, but a
// position nudge applied after they integrate accumulates and is dt-scaled for frame-rate
// independence (the BlackHoleSystem lesson).
//
// Each fixed step (fixedUpdate), in order:
//   1. READ + SANITIZE the fold (drop period 0/junk → unowned gate; cap clamped to
//      MINE_MAX_CAP; detonate radius; pull/chain flags — all for STAMPING new mines);
//   2. MATERIALIZE the non-telegraphing combat enemies (+ owners) once into hoisted scratch;
//   3. AGE every live mine (ageMs += dt) — a mine ARMS once ageMs >= armMs;
//   4. PULL (Lv4+): for each ARMED mine STAMPED with pull, nudge every combat enemy within
//      MINE_PULL_RADIUS toward the mine (position nudge, dt-scaled; no-op at core / outside);
//   5. DETONATE: for each ARMED mine an enemy has entered, mark it; process the detonation
//      set with a chain cascade (a chain-stamped mine's detonation adds adjacent ARMED mines
//      within MINE_CHAIN_RADIUS; each mine detonates at most once); for each detonating mine
//      apply its stamped damage to every combat enemy in its blast through
//      collisionSystem.applyPlayerDamage, guarding a shared per-tick hit Set so no enemy is
//      hit — or released — twice; release every detonated mine;
//   6. DROP cadence: only when owned (dropPeriod > 0), accumulate dt and while there is a
//      full period of banked credit, evict the OLDEST live mine while at cap, then acquire a
//      mine and stamp it at the ship's clamped position with the folded shape and ageMs = 0.
//
// Route every detonation hit through applyPlayerDamage, NEVER by decrementing hp / releasing
// the enemy directly (BombSystem's unconditional hp-ignoring release is the ANTI-pattern —
// it bypasses the kill latches). The stamped detonation damage (MINE_DETONATE_DAMAGE = 90)
// exceeds ARMORED_HP (5), so a mine one-shots the armored archetype: that is the melee/AoE
// FULL-damage (FR33) requirement, achieved purely by magnitude through the shared
// armor-respecting seam — exactly as the Orbit Blade's 90 is. Scoped to enemyPools (the five
// combat archetypes), never deathPools — the Black Hole and the Mirror Reflector are out of
// scope, the same scoping OrbitBladeSystem / SeekerDroneSystem use.
//
// Zero per-tick allocation on the steady path: mines recycle through the prewarmed pool; the
// age/pull/detonate/drop passes use hoisted collectors + length-reset scratch arrays + reused
// Sets (the CollisionSystem / SeekerDroneSystem convention).
export class MineLayerSystem extends System {
  /**
    * @param {{x:number,y:number}} ship The player ship — read for the drop origin (the wake).
    *   NEVER mutated here (the system only reads ship.x/y).
    * @param {import('../core/Pool.js').Pool[]} enemyPools The five COMBAT archetype pools the
    *   detonation + pull reach. Deliberately `enemyPools`, never `deathPools`: the Black Hole
    *   and the Mirror Reflector are out of scope, the same scoping OrbitBladeSystem /
    *   SeekerDroneSystem apply.
    * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The shared damage
    *   seam — every detonation hit goes through its `applyPlayerDamage`, so armor, scoring, XP
    *   and the kill latches behave exactly as for a bullet.
    * @param {Object<string,number>|null} [playerStats=null] The shared player-stat store the
    *   mine parameters are read from (optional — a null store means NO mines ever, i.e.
    *   exactly the pre-11.3 behavior).
    * @param {import('./GridFieldSystem.js').GridFieldSystem|null} [gridFieldSystem=null] Optional
    *   grid field system for implosion ripple emission (Story 12.8).
    */
  constructor(ship, enemyPools, collisionSystem, playerStats = null, gridFieldSystem = null) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;
    this.gridFieldSystem = gridFieldSystem;

    // The mine pool — the single source of active/free mine truth. Prewarmed so a drop never
    // hits the factory once running.
    this.pool = new Pool(createMine);
    const warm = [];
    for (let i = 0; i < MINE_POOL_PREWARM; i++) {
      warm.push(this.pool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.pool.release(warm[i]);
    }

    // Runtime drop accumulator (ms): dt is banked here while owned, drained one period per
    // drop. Held at 0 while unowned (the ownership gate), so the item going owned begins a
    // fresh cadence rather than dumping a backlog of drops the first tick.
    this._dropAccumMs = 0;

    // Reusable scratch for the live mine set — length-reset each use (no per-tick alloc).
    // Materialized once per tick to age/pull/detonate over a stable snapshot (releasing a
    // detonated mine mutates the pool's active Set, which forEachActive forbids; iterating a
    // materialized array is safe), and reused at drop time to find the oldest for eviction.
    this._mines = [];
    this._collectMine = (m) => this._mines.push(m);

    // Reusable sweep scratch so the detonation/pull path allocates nothing: the materialized
    // NON-telegraphing combat enemies and a parallel array of each one's owning pool (so a
    // kill's release routes to the correct pool) — the SeekerDroneSystem convention. The
    // collector SKIPS a telegraphing enemy, so a spawning-in enemy is never a pull target NOR
    // a detonation hit.
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      if (e.telegraphMs > 0) return;
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };

    // Reused detonation work-set: `_detonateList` is the cascade QUEUE (a chain adds adjacent
    // armed mines to it), `_detonateSet` marks each mine detonated-once so the cascade
    // terminates within the live mine count and no mine is released twice. Cleared each tick.
    this._detonateList = [];
    this._detonateSet = new Set();

    // Reused per-tick enemy hit Set (CollisionSystem's `_hitEnemies` pattern): an enemy
    // caught in overlapping blasts / a chain cascade is hit — and released — at most once.
    // Cleared each tick, so it is still reused (no per-tick allocation).
    this._hitEnemies = new Set();

    // Story 12.8 — Singularity Field: active flag set by fusion effect handler.
    // When true, armed mines that detect an enemy in blast radius transition to
    // "mini black hole" mode (pull phase → implosion → reset) instead of
    // immediate detonation.
    this.singularityFieldActive = false;

    // Simulation time accumulator in ms. Tracks the total elapsed simulation
    // time so implosion timers have an absolute reference point.
    this._simMs = 0;

    // Scratch array for tracking mines still in pull phase (so we can re-check
    // each tick without iterating the full mines list).
    this._singularityMines = [];
  }

  /**
   * The sanitized drop period (ms between mine drops) off the shared store — 0 means UNOWNED
   * (the ownership gate), else a positive value floored to MINE_DROP_PERIOD_FLOOR_MS. A
   * missing store, a missing field, a non-finite value, or a non-positive one all resolve to
   * 0 (no drops — the pre-11.3 behavior). A finite BUT tiny-positive value is clamped UP to
   * the floor so the drop `while` loop drains at most ~1 mine/tick. Allocates nothing.
   * @returns {number} 0 (unowned) or a period >= MINE_DROP_PERIOD_FLOOR_MS.
   * @private
   */
  _dropPeriodMs() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.mineDropPeriodMs;
    if (!Number.isFinite(v) || v <= 0) return 0;
    return v < MINE_DROP_PERIOD_FLOOR_MS ? MINE_DROP_PERIOD_FLOOR_MS : v;
  }

  /**
   * The sanitized live-mine cap off the shared store — an INTEGER in [1, MINE_MAX_CAP]. A
   * missing store, a missing field, or junk (NaN, Infinity, negative, fractional < 1)
   * resolves to MINE_BASE_CAP; a fractional value is floored; an absurdly large value is
   * clamped to MINE_MAX_CAP (a SAFETY guard — an unclamped 1e9 would let the live count grow
   * unbounded). Allocates nothing.
   * @returns {number} the sanitized cap (integer, 1..MINE_MAX_CAP).
   * @private
   */
  _cap() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return MINE_BASE_CAP;
    const v = ps.mineCap;
    if (!Number.isFinite(v)) return MINE_BASE_CAP;
    const n = Math.floor(v);
    if (n < 1) return MINE_BASE_CAP;
    return n > MINE_MAX_CAP ? MINE_MAX_CAP : n;
  }

  /**
   * The sanitized detonate (blast) radius (px) off the shared store — a positive value in
   * (0, MINE_MAX_DETONATE_RADIUS]. A missing store, a missing field, a non-finite value, or a
   * non-positive one all resolve to MINE_BASE_DETONATE_RADIUS; an absurdly large value is
   * clamped to MINE_MAX_DETONATE_RADIUS (a SAFETY guard). Allocates nothing.
   * @returns {number}
   * @private
   */
  _detonateRadius() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return MINE_BASE_DETONATE_RADIUS;
    const v = ps.mineDetonateRadius;
    if (!Number.isFinite(v) || v <= 0) return MINE_BASE_DETONATE_RADIUS;
    return v > MINE_MAX_DETONATE_RADIUS ? MINE_MAX_DETONATE_RADIUS : v;
  }

  /**
   * The sanitized pull flag off the shared store — 1 (on) or 0 (off). Pull is enabled only
   * by a finite value >= 1; a missing store/field or junk resolves to 0, so a corrupted store
   * can never spuriously enable the pull. Allocates nothing.
   * @returns {number} 1 when pull is on, else 0.
   * @private
   */
  _pull() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.minePull;
    return Number.isFinite(v) && v >= 1 ? 1 : 0;
  }

  /**
   * The sanitized chain flag off the shared store — 1 (on) or 0 (off). Same sanitizer shape
   * as `_pull`. Allocates nothing.
   * @returns {number} 1 when chain is on, else 0.
   * @private
   */
  _chain() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 0;
    const v = ps.mineChain;
    return Number.isFinite(v) && v >= 1 ? 1 : 0;
  }

  /**
   * Advance one fixed step: sanitize the fold, materialize the combat enemies, age the mines,
   * pull (Lv4+), detonate (+ chain cascade), then drop on cadence.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const pool = this.pool;
    const dtSec = dt / 1000;

    // (1) Read + sanitize the fold — the parameters STAMPED onto any mine dropped this tick.
    const dropPeriod = this._dropPeriodMs();
    const cap = this._cap();
    const detonateRadius = this._detonateRadius();
    const pullFlag = this._pull();
    const chainFlag = this._chain();

    // Track simulation time for implosion timer.
    this._simMs += dt;

    // (2) Materialize the combat enemies (+ owners) ONCE through the hoisted collector, which
    // skips a telegraphing (spawning-in) enemy — so it is never a pull target NOR a hit.
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

    // Materialize the live mines ONCE into a stable snapshot: the age/pull/detonate passes
    // iterate IT (releasing a detonated mine mutates the pool's active Set, which
    // forEachActive forbids — the snapshot array is a separate copy, so releasing while
    // iterating it is safe).
    const mines = this._mines;
    mines.length = 0;
    pool.forEachActive(this._collectMine);

    // (3) Age every live mine. A mine is ARMED once ageMs >= armMs.
    for (let i = 0; i < mines.length; i++) {
      mines[i].ageMs += dt;
    }

    // (4) PULL (Lv4+). For each ARMED mine STAMPED with pull, nudge every combat enemy within
    // MINE_PULL_RADIUS toward the mine as a POSITION nudge (the BlackHoleSystem model),
    // dt-scaled so it is frame-rate-independent. A no-op at the core (no direction, no NaN)
    // and outside the radius. Gated on a valid ship (a null ship suppresses the pull, mirror
    // of the drop guard). Uses the mine's STAMPED pull flag, so a Lv1 mine never pulls.
    const ship = this.ship;
    if (ship) {
      for (let i = 0; i < mines.length; i++) {
        const m = mines[i];
        if (m.pull < 1 || m.ageMs < m.armMs) continue; // unarmed or no-pull mine: inert
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          const dx = m.x - e.x;
          const dy = m.y - e.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < MINE_PULL_RADIUS) {
            const pull = MINE_PULL_STRENGTH * (1 - d / MINE_PULL_RADIUS) * dtSec;
            const inv = pull / d; // (pull magnitude) × unit(dx,dy)
            e.x += dx * inv;
            e.y += dy * inv;
          }
        }
      }
    }

    // (4b) SINGULARITY FIELD — pull phase. For each mine in pull mode, apply
    // gravity-like pull toward the mine. The pull formula is identical to the
    // Lv4 mine pull: strength × (1 - d/RADIUS) × dtSec.
    if (this.singularityFieldActive && ship) {
      for (let i = 0; i < mines.length; i++) {
        const m = mines[i];
        if (!m.isSingularity) continue;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          const dx = m.x - e.x;
          const dy = m.y - e.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < SINGULARITY_PULL_RADIUS) {
            const pull = SINGULARITY_PULL_STRENGTH * (1 - d / SINGULARITY_PULL_RADIUS) * dtSec;
            const inv = pull / d;
            e.x += dx * inv;
            e.y += dy * inv;
          }
        }
      }
    }

    // (5) DETONATE (+ chain cascade). First mark every ARMED mine an enemy has ENTERED. Then
    // process the detonation queue: a chain-stamped mine adds adjacent ARMED mines within
    // MINE_CHAIN_RADIUS, and each detonating mine damages every combat enemy in its blast
    // through applyPlayerDamage (guarded by the shared per-tick hit Set). Finally release
    // every detonated mine. Guards null pools / collisionSystem defensively.
    const cs = this.collisionSystem;
    const detonateList = this._detonateList;
    const detonateSet = this._detonateSet;
    const hitEnemies = this._hitEnemies;
    detonateList.length = 0;
    detonateSet.clear();
    hitEnemies.clear();

    // Trigger scan: an ARMED mine triggers (enters pull phase) if any combat enemy
    // center is within mine.detonateRadius + enemy.radius of it.
    // When singularityFieldActive is false: normal detonation.
    // When singularityFieldActive is true: transition to pull phase (mini black hole).
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      if (m.ageMs < m.armMs) continue; // unarmed → inert
      if (detonateSet.has(m)) continue;

      if (m.isSingularity) {
        // Already in pull phase — skip (pull already applied, waiting for implosion).
        continue;
      }

      if (this._enemyInBlast(m, enemies)) {
        if (this.singularityFieldActive) {
          // Transition to mini black hole pull phase.
          m.isSingularity = true;
          m.pullPhaseStartMs = this._simMs;
        } else {
          // Normal detonation.
          detonateSet.add(m);
          detonateList.push(m);
        }
      }
    }

    // Cascade + apply. `detonateList` may GROW as chain-stamped mines add neighbors; each is
    // added to `detonateSet` once, so the walk terminates within the live mine count.
    for (let i = 0; i < detonateList.length; i++) {
      const m = detonateList[i];
      // Chain (Lv5): a chain-stamped mine's detonation ignites adjacent ARMED mines.
      if (m.chain >= 1) {
        for (let k = 0; k < mines.length; k++) {
          const m2 = mines[k];
          if (m2 === m || detonateSet.has(m2)) continue;
          if (m2.ageMs < m2.armMs) continue; // only ARMED mines chain-detonate
          const dx = m2.x - m.x;
          const dy = m2.y - m.y;
          if (dx * dx + dy * dy <= MINE_CHAIN_RADIUS * MINE_CHAIN_RADIUS) {
            detonateSet.add(m2);
            detonateList.push(m2);
          }
        }
      }
      // Apply this mine's blast: every as-yet-unhit combat enemy in range takes ONE
      // applyPlayerDamage (armor/scoring/XP/kill-latches behave as for a bullet). Guarded by
      // the shared hit Set, so an enemy in overlapping blasts is hit — and released — once.
      if (pools && cs) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (hitEnemies.has(e)) continue;
          const dx = m.x - e.x;
          const dy = m.y - e.y;
          const rr = m.detonateRadius + e.radius;
          if (dx * dx + dy * dy <= rr * rr) {
            hitEnemies.add(e);
            cs.applyPlayerDamage(e, owners[j], m.damage);
          }
        }
      }
    }
    // Release every detonated mine (safe now — we are done iterating the snapshot).
    for (let i = 0; i < detonateList.length; i++) {
      pool.release(detonateList[i]);
    }

    // (5.5) SINGULARITY FIELD — implosion. Check all mines in pull phase. When
    // a mine reaches the pull lifetime, it implodes: AoE damage at 3× normal,
    // triggers a grid ripple, then resets to armed state (ageMs=0, isSingularity=false).
    if (this.singularityFieldActive) {
      const singularityMines = this._singularityMines;
      singularityMines.length = 0;

      for (let i = 0; i < mines.length; i++) {
        const m = mines[i];
        if (!m.isSingularity) continue;

        if (this._simMs - m.pullPhaseStartMs >= SINGULARITY_PULL_DURATION_MS) {
          // Implode.
          this._implode(m, pools);
        } else {
          // Still in pull phase — track for next tick's implosion check.
          singularityMines.push(m);
        }
      }
    }

    // (6) DROP cadence. Only when OWNED (dropPeriod > 0) AND with a valid ship (a mine is laid
    // at the ship's position — the wake). Accumulate dt, then while a full period is banked,
    // evict the OLDEST live mine while at cap (so the live count never exceeds it), acquire a
    // fresh mine, stamp it at the ship's clamped position with the folded shape + ageMs 0, and
    // decrement by the period. When unowned, hold the accumulator at 0.
    if (dropPeriod > 0 && ship) {
      this._dropAccumMs += dt;
      while (this._dropAccumMs >= dropPeriod) {
        // Evict the oldest while at/over cap, so acquiring never pushes the live count above
        // the cap (a while, not an if — a level DROP can leave the live set over the new cap).
        while (pool.activeCount >= cap) {
          this._evictOldest();
        }
        const mine = pool.acquire();
        // Clamp the drop origin into the arena interior so a wall-pressed ship never lays a
        // mine out of bounds (the SeekerDroneSystem spawn-clamp convention).
        mine.x = clamp(ship.x, ARENA_BORDER_INSET, ARENA_WIDTH - ARENA_BORDER_INSET);
        mine.y = clamp(ship.y, ARENA_BORDER_INSET, ARENA_HEIGHT - ARENA_BORDER_INSET);
        mine.ageMs = 0;
        mine.armMs = MINE_ARM_MS;
        mine.detonateRadius = detonateRadius;
        mine.damage = MINE_DETONATE_DAMAGE;
        mine.pull = pullFlag;
        mine.chain = chainFlag;
        this._dropAccumMs -= dropPeriod;
      }
    } else {
      // Unowned (or no ship): hold the accumulator at 0 so going owned starts a fresh cadence.
      this._dropAccumMs = 0;
    }
  }

  /**
   * True when any materialized combat enemy's center is within `mine.detonateRadius +
   * enemy.radius` of the mine — the detonation trigger test. Squared compare (no sqrt).
   * Allocates nothing.
   * @param {object} mine
   * @param {object[]} enemies The hoisted `_enemies` scratch (already telegraph-filtered).
   * @returns {boolean}
   * @private
   */
  _enemyInBlast(mine, enemies) {
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      const dx = mine.x - e.x;
      const dy = mine.y - e.y;
      const rr = mine.detonateRadius + e.radius;
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  }

  /**
    * Implode a singularity mine: deal AoE damage at 3× normal, trigger a grid
    * ripple at the mine's position, then reset the mine to an armed state
    * (not singularity) so it can enter pull mode again on next enemy contact.
    *
    * Uses `collisionSystem.applyPlayerDamage` for the AoE damage (armor/scoring/
    * XP/kill-latches behave correctly).
    *
    * @param {object} mine The mine to impode.
    * @param {import('../core/Pool.js').Pool[]} [pools] The combat enemy pools.
    */
  _implode(mine, pools) {
    // Emit a grid ripple at the implosion point.
    if (this.gridFieldSystem) {
      this.gridFieldSystem._emit(mine.x, mine.y);
    }

    // Apply AoE damage: 3× the base mine damage.
    if (pools && this.collisionSystem) {
      const implosionDamage = mine.damage * SINGULARITY_DAMAGE_MULTIPLIER;
      const enemies = this._enemies;
      const owners = this._owners;
      const hitEnemies = this._hitEnemies;
      hitEnemies.clear();
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (hitEnemies.has(e)) continue;
        const dx = mine.x - e.x;
        const dy = mine.y - e.y;
        const rr = mine.detonateRadius + e.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          hitEnemies.add(e);
          this.collisionSystem.applyPlayerDamage(e, owners[j], implosionDamage);
        }
      }
    }

    // Reset the mine: it becomes a normal armed mine again, ready for a new
    // cycle. The mine stays active (not in detonateList, so the release pass
    // above does NOT release it). On the next tick, when an enemy is in range,
    // it will detonate normally (since isSingularity is false).
    mine.isSingularity = false;
    mine.pullPhaseStartMs = 0;
    mine.ageMs = 0;
  }

  /**
    * Release the OLDEST live mine (max ageMs — a mine dropped earlier has aged longer) back to
    * the pool. Called before an over-cap drop so the live count stays bounded. Removal (not a
    * detonation) is the deterministic eviction half — no eviction-triggered chain cascade to
    * reason about, and it fully satisfies "live count stays bounded." Reuses the `_mines`
    * scratch (the age/pull/detonate passes have finished by drop time), so it allocates
   * nothing. A no-op if somehow no mine is active.
   * @private
   */
  _evictOldest() {
    const pool = this.pool;
    const mines = this._mines;
    mines.length = 0;
    pool.forEachActive(this._collectMine);
    let oldest = null;
    let oldestAge = -Infinity;
    for (let i = 0; i < mines.length; i++) {
      if (mines[i].ageMs > oldestAge) {
        oldestAge = mines[i].ageMs;
        oldest = mines[i];
      }
    }
    if (oldest) pool.release(oldest);
  }
}

/**
 * Clamp a scalar into `[lo, hi]`. Used to pull a wall-pressed ship's mine drop origin back
 * into the arena interior so a mine is never laid out of bounds.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
