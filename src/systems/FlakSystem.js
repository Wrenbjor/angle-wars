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
    const warm = [];
    for (let i = 0; i < FLAK_FRAGMENT_POOL_PREWARM; i++) {
      warm.push(this.flakPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.flakPool.release(warm[i]);
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

    for (let i = 0; i < numFragments; i++) {
      if (this.flakPool.activeCount >= FLAK_MAX_LIVE_FRAGMENTS) {
        // Enforce hard live-fragment cap (NFR11 zero allocation)
        break;
      }
      const angle = (i / numFragments) * Math.PI * 2;
      const f = this.flakPool.acquire();
      f.x = x;
      f.y = y;
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
            }
            if (f.canAirburst) {
              const subMult = f.damage / FLAK_FRAGMENT_BASE_DAMAGE - 1;
              this.triggerAirburst(f.x, f.y, 4, subMult, false);
            }
            this.flakPool.release(f);
            break;
          }
        }
      }

      if (!hitEnemy) {
        if (f.lifetimeMs <= 0 || isOutsideArena(f.x, f.y)) {
          if (f.canAirburst) {
            const subMult = f.damage / FLAK_FRAGMENT_BASE_DAMAGE - 1;
            this.triggerAirburst(f.x, f.y, 4, subMult, false);
          }
          this.flakPool.release(f);
        }
      }
    }
  }
}
