import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createFlakFragment } from '../entities/FlakFragment.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FLAK_FRAGMENT_RADIUS,
  FLAK_FRAGMENT_SPEED,
  FLAK_FRAGMENT_LIFETIME_MS,
  FLAK_FRAGMENT_BASE_DAMAGE,
  FLAK_MAX_LIVE_FRAGMENTS,
  FLAK_FRAGMENT_POOL_PREWARM,
  FLAK_CASCADE_KILL_FRAGMENTS,
  FLAK_MAX_CASCADE_FRAGMENTS,
  FLAK_MAX_CASCADE_KILLS_PER_TICK,
} from '../config/constants.js';

/**
 * True when a point's center has crossed the drawn arena border (the inset boundary).
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

/**
 * FlakSystem — manages active fragments, radial airburst spawning, fixed-step movement,
 * wall/lifetime expiration, Lv5 secondary airbursts, and enemy collision (Story 11.6).
 */
export class FlakSystem extends System {
  /**
   * @param {{x:number, y:number}} ship
   * @param {import('../core/Pool.js').Pool[]} enemyPools
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem
   * @param {Object<string, number>|null} [playerStats=null]
   */
  constructor(ship, enemyPools, collisionSystem, playerStats = null) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.collisionSystem = collisionSystem;
    this.playerStats = playerStats;

    // Fragment object pool — hard capped to FLAK_MAX_LIVE_FRAGMENTS (120)
    this.flakPool = new Pool(createFlakFragment);
    for (let i = 0; i < FLAK_FRAGMENT_POOL_PREWARM; i++) {
      this.flakPool.release(this.flakPool.acquire());
    }

    // Reusable scratch for active fragments
    this._fragments = [];
    this._collectFragment = (f) => this._fragments.push(f);

    // Reusable scratch for combat enemies
    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      if (e.telegraphMs > 0) return;
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };

    // Per-tick kill guard so an enemy killed by one fragment isn't double-hit in the same tick
    this._killedThisTick = new Set();

    // Story 12.10 — Fragmentation Cascade: active flag set by fusion effect handler.
    // When true, primary fragments that KILL an enemy trigger an airburst of 2
    // cascade sub-fragments at the kill position (in addition to any canAirburst behavior).
    this.fragCascadeActive = false;
    // Per-tick kill counter for cascade — resets every fixedUpdate.
    this._cascadeKillsThisTick = 0;
    // Counter of currently live cascade sub-fragments for NFR11 bounding.
    this._liveCascadeFragments = 0;
  }

  /**
   * Trigger an airburst detonation at (x, y), spawning `count` fragments radially.
   * @param {number} x Detonation center x
   * @param {number} y Detonation center y
   * @param {number} count Fragment count (clamped [0, 32])
   * @param {number} damageMult Fragment damage multiplier fraction (>= 0)
   * @param {boolean} canAirburst True if primary fragment can secondary airburst on hit/expire
   */
  triggerAirburst(x, y, count, damageMult, canAirburst) {
    const rawCount = Number.isFinite(count) ? Math.floor(count) : 0;
    const numFragments = Math.min(Math.max(rawCount, 0), 32);
    if (numFragments <= 0) return;

    const mult = Number.isFinite(damageMult) && damageMult > 0 ? damageMult : 0;
    const damage = FLAK_FRAGMENT_BASE_DAMAGE * (1 + mult);

    const safeX = Number.isFinite(x) ? x : ARENA_WIDTH / 2;
    const safeY = Number.isFinite(y) ? y : ARENA_HEIGHT / 2;
    const insetMargin = ARENA_BORDER_INSET + FLAK_FRAGMENT_RADIUS + 2;

    const spawnX = Math.max(
      insetMargin,
      Math.min(ARENA_WIDTH - insetMargin, safeX),
    );
    const spawnY = Math.max(
      insetMargin,
      Math.min(ARENA_HEIGHT - insetMargin, safeY),
    );

    for (let i = 0; i < numFragments; i++) {
      if (this.flakPool.activeCount >= FLAK_MAX_LIVE_FRAGMENTS) {
        // Enforce hard live-fragment cap (NFR11 zero allocation)
        break;
      }
      const angle = (i / numFragments) * Math.PI * 2;
      const f = this.flakPool.acquire();
      f.x = spawnX;
      f.y = spawnY;
      f.vx = Math.cos(angle) * FLAK_FRAGMENT_SPEED;
      f.vy = Math.sin(angle) * FLAK_FRAGMENT_SPEED;
      f.radius = FLAK_FRAGMENT_RADIUS;
      f.damage = damage;
      f.lifetimeMs = FLAK_FRAGMENT_LIFETIME_MS;
      f.canAirburst = !!canAirburst;
    }
  }

  /**
   * Fixed-step update: integrate active fragments, check enemy collisions,
   * handle wall/lifetime expiration, and trigger Lv5 secondary airbursts.
   * @param {number} dt Delta time in ms
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;
    const pools = this.enemyPools;
    const cs = this.collisionSystem;

    this._killedThisTick.clear();
    // Story 12.10 — Fragmentation Cascade: reset per-tick kill counter.
    this._cascadeKillsThisTick = 0;

    // Materialize combat enemies
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

    // Materialize active fragments
    const fragments = this._fragments;
    fragments.length = 0;
    this.flakPool.forEachActive(this._collectFragment);

    for (let i = 0; i < fragments.length; i++) {
      const f = fragments[i];
      f.x += f.vx * dtSec;
      f.y += f.vy * dtSec;
      f.lifetimeMs -= dt;

      let hitEnemy = false;
      if (pools && cs) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (this._killedThisTick.has(e)) continue;

          const dx = f.x - e.x;
          const dy = f.y - e.y;
          const rr = f.radius + e.radius;
          if (dx * dx + dy * dy <= rr * rr) {
            hitEnemy = true;
            const wasKilled = cs.applyPlayerDamage(e, owners[j], f.damage);
            if (wasKilled) {
              this._killedThisTick.add(e);

              // Story 12.10 — Fragmentation Cascade:
              // on kill, spawn 2 cascade sub-fragments (one-level cascade)
              if (this.fragCascadeActive &&
                  this._cascadeKillsThisTick < FLAK_MAX_CASCADE_KILLS_PER_TICK &&
                  this._liveCascadeFragments < FLAK_MAX_CASCADE_FRAGMENTS) {
                this._spawnCascadeFragments(f.x, f.y, f.vx, f.vy);
                this._cascadeKillsThisTick += 1;
              }
            }
            // On hit: release fragment, optionally secondary airburst
            if (f.canAirburst) {
              const fx = f.x;
              const fy = f.y;
              const subMult = Math.max(0, f.damage / FLAK_FRAGMENT_BASE_DAMAGE - 1);
              this.flakPool.release(f);
              this._releaseCascade(f);
              this.triggerAirburst(fx, fy, 4, subMult, false);
            } else {
              this.flakPool.release(f);
              this._releaseCascade(f);
            }
            break;
          }
        }
      }

      if (!hitEnemy) {
        if (f.lifetimeMs <= 0 || isOutsideArena(f.x, f.y)) {
          if (f.canAirburst) {
            const fx = f.x;
            const fy = f.y;
            const subMult = Math.max(0, f.damage / FLAK_FRAGMENT_BASE_DAMAGE - 1);
            this.flakPool.release(f);
            this._releaseCascade(f);
            this.triggerAirburst(fx, fy, 4, subMult, false);
          } else {
            this.flakPool.release(f);
            this._releaseCascade(f);
          }
        }
      }
    }
  }

  /**
   * Story 12.10 — Fragmentation Cascade: spawn 2 cascade sub-fragments at the
   * given position, launched perpendicular to the parent's velocity to avoid
   * duplicating the parent's arc. Sub-fragments are marked cascadeSub=true so
   * they do NOT cascade further, bounding the chain to exactly 2 levels.
   * @private
   */
  _spawnCascadeFragments(x, y, parentVx, parentVy) {
    for (let i = 0; i < FLAK_CASCADE_KILL_FRAGMENTS; i++) {
      if (this.flakPool.activeCount >= FLAK_MAX_LIVE_FRAGMENTS ||
          this._liveCascadeFragments >= FLAK_MAX_CASCADE_FRAGMENTS) {
        break;
      }
      // Launch perpendicular to parent velocity (±90°), alternating sides.
      const sign = i % 2 === 0 ? 1 : -1;
      const mag = Math.sqrt(parentVx * parentVx + parentVy * parentVy) || FLAK_FRAGMENT_SPEED;
      const nx = -parentVy / mag * sign;
      const ny = parentVx / mag * sign;
      const f = this.flakPool.acquire();
      f.x = x;
      f.y = y;
      f.vx = nx * FLAK_FRAGMENT_SPEED;
      f.vy = ny * FLAK_FRAGMENT_SPEED;
      f.damage = FLAK_FRAGMENT_BASE_DAMAGE;
      f.lifetimeMs = FLAK_FRAGMENT_LIFETIME_MS;
      f.canAirburst = false;      // sub-fragments never airburst
      f.cascadeSub = true;        // sub-fragments never cascade on kill
      this._liveCascadeFragments += 1;
    }
  }

  /**
   * Story 12.10 — Called when a fragment is released back to pool.
   * Tracks live cascade count so NFR11 cap is accurate.
   * @param {Object} f Fragment being released
   * @private
   */
  _releaseCascade(f) {
    if (f.cascadeSub) {
      this._liveCascadeFragments = Math.max(0, this._liveCascadeFragments - 1);
    }
  }
}
