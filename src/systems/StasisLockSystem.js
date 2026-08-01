import { System } from '../core/System.js';
import { STASIS_LOCK_FREEZE_MS, STASIS_LOCK_COOLDOWN_MS } from '../config/constants.js';

// StasisLockSystem — periodic 12s cooldown → 1.5s freeze (Story 12.16).
export class StasisLockSystem extends System {
  constructor(enemyPools, xpOrbSystem) {
    super();
    this.enemyPools = enemyPools;
    this.xpOrbSystem = xpOrbSystem;
    this.active = false;
    this.cooldownTimer = STASIS_LOCK_COOLDOWN_MS;
    this.freezeTimer = 0;
    // Late-bound: set from buildArenaWorld.js after construction.
    this.collisionSystem = null;
  }

  fixedUpdate(dt) {
    if (!this.active || !this.collisionSystem) return;

    // If we're in a freeze window, handle it first.
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt;
      if (this.freezeTimer <= 0) {
        this.freezeTimer = 0;
        this.collisionSystem.stasisFreezeActive = false;
      } else {
        // Re-apply stunMs each tick so enemies don't escape
        const remaining = this.freezeTimer;
        for (let p = 0; p < this.enemyPools.length; p++) {
          const pool = this.enemyPools[p];
          if (pool && typeof pool.forEachActive === 'function') {
            pool.forEachActive((e) => {
              e.stunMs = Math.max(e.stunMs || 0, remaining);
            });
          }
        }
      }
      return;
    }

    // Not freezing: check if cooldown elapsed → trigger freeze.
    this.cooldownTimer -= dt;
    if (this.cooldownTimer > 0) {
      this.collisionSystem.stasisFreezeActive = false;
      return;
    }

    // Cooldown elapsed → trigger freeze.
    this.freezeTimer = STASIS_LOCK_FREEZE_MS;
    this.cooldownTimer = STASIS_LOCK_COOLDOWN_MS;

    for (let p = 0; p < this.enemyPools.length; p++) {
      const pool = this.enemyPools[p];
      if (pool && typeof pool.forEachActive === 'function') {
        pool.forEachActive((e) => {
          e.stunMs = Math.max(e.stunMs || 0, STASIS_LOCK_FREEZE_MS);
        });
      }
    }
    this.collisionSystem.stasisFreezeActive = true;
  }

  spawnExtraXpOrb(x, y, xpExtra) {
    if (this.xpOrbSystem && typeof this.xpOrbSystem.spawnOrb === 'function') {
      this.xpOrbSystem.spawnOrb(x, y, xpExtra);
    }
  }
}
