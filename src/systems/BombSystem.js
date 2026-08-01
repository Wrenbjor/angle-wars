import { System } from '../core/System.js';
import {
  BOMB_AWARD_SCORE_INTERVAL,
  BOMB_SHOCKWAVE_MS,
  BOMB_SHOCKWAVE_MAX_RADIUS,
} from '../config/constants.js';

// BombSystem — smart-bomb detonation + score-threshold award (Phaser-free).
//
// Extended in Story 11.9 (Bomb Capacitor) to read playerStats:
//   - extraBombs: syncs extra bombs on level pick.
//   - bombAwardInterval: dynamic score threshold for +1 bomb (75k at Lv2+, 50k at Lv4+).
//   - bombRadiusMult: scales shockwave effective radius (1.3x at Lv1+).
//   - bombStunMs: stuns surviving combat enemies (2s at Lv3+).
//   - bombXpOrbs: drops XP orbs at detonation origin (5 orbs at Lv4+).
//   - bombDamageFieldMs: sustains a lingering damage field (3s at Lv5).
export class BombSystem extends System {
  /**
   * @param {import('../input/InputState.js').InputState} inputState Shared input
   *   seam; the latched bomb request is consumed (reads-and-clears) each step.
   * @param {import('../core/Pool.js').Pool[]} enemyPools Every combat-archetype
   *   enemy pool (their active instances are cleared on a detonation).
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem The
   *   collision system whose public killedEnemies report is the reconciliation
   *   seam bomb-cleared enemies are appended to.
   * @param {{score:number, bombs:number}} scoreState Shared run economy — bombs is
   *   decremented on a detonation and incremented on each 100k crossing; score is
   *   read (never written) for the award.
   * @param {{x:number,y:number}} ship The player ship — the shockwave origin.
   * @param {Object<string, number>|null} [playerStats=null] Shared player stats store.
   * @param {Object|null} [xpOrbSystem=null] Shared XP orb system for orb drops.
   * @param {import('../core/Pool.js').Pool[]} [bombEnemyPools=enemyPools] Target
   *   extension used only for queued player smart bombs.
   */
  constructor(inputState, enemyPools, collisionSystem, scoreState, ship, playerStats = null, xpOrbSystem = null, bombEnemyPools = enemyPools) {
    super();
    this.inputState = inputState;
    this.enemyPools = enemyPools;
    // Kept separate from enemyPools because detonateAt is also reused by the
    // unstable Black Hole and Revenant clears. Only a queued player bomb opts
    // into this preassembled extension (which may include special hazards).
    this.bombEnemyPools = bombEnemyPools;
    this.collisionSystem = collisionSystem;
    this.scoreState = scoreState;
    this.ship = ship;
    this.playerStats = playerStats;
    this.xpOrbSystem = xpOrbSystem;

    this._syncedExtraBombs = 0;
    this._scoreCursor = scoreState.score;

    this.shockwaveMs = 0;
    this.shockwaveX = 0;
    this.shockwaveY = 0;
    this.effectiveRadius = BOMB_SHOCKWAVE_MAX_RADIUS;

    this.stunRemainingMs = 0;
    this.damageFieldMs = 0;
    this.damageFieldX = 0;
    this.damageFieldY = 0;
    this.damageFieldRadius = 0;

    this._enemies = [];
    this._owners = [];
    this._currentPool = null;
    this._collectEnemy = (e) => {
      this._enemies.push(e);
      this._owners.push(this._currentPool);
    };
  }

  /**
   * Advance one fixed step: award threshold bombs, then (if requested and armed)
   * detonate, then decay shockwave, stun, and damage field countdowns.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ss = this.scoreState;

    // (0) Extra bombs sync from playerStats delta
    if (this.playerStats) {
      const rawExtra = this.playerStats.extraBombs;
      const extraBombs = Number.isFinite(rawExtra) && rawExtra >= 0 ? Math.floor(rawExtra) : 0;
      if (extraBombs > this._syncedExtraBombs) {
        this.scoreState.bombs += (extraBombs - this._syncedExtraBombs);
        this._syncedExtraBombs = extraBombs;
      } else if (extraBombs < this._syncedExtraBombs) {
        this._syncedExtraBombs = extraBombs;
      }
    }

    // (1) Threshold award: +1 bomb per interval boundary crossed since cursor.
    const rawInterval = this.playerStats?.bombAwardInterval;
    const interval = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : BOMB_AWARD_SCORE_INTERVAL;
    const score = ss.score;
    if (this._currentInterval === undefined) {
      this._currentInterval = interval;
    } else if (this._currentInterval !== interval) {
      if (score > 0) {
        const oldEarned = Math.floor(score / this._currentInterval);
        const newEarned = Math.floor(score / interval);
        if (newEarned > oldEarned) {
          ss.bombs += (newEarned - oldEarned);
        }
      }
      this._currentInterval = interval;
    }
    if (score > this._scoreCursor) {
      const crossed =
        Math.floor(score / interval) -
        Math.floor(this._scoreCursor / interval);
      if (crossed > 0) ss.bombs += crossed;
      this._scoreCursor = score;
    }

    // (2) Detonation: consume latch
    const requested = this.inputState.consumeBomb();
    if (requested && ss.bombs > 0) {
      this.detonateAt(this.ship.x, this.ship.y, this.bombEnemyPools);
      ss.bombs -= 1;
    }

    // (3) Decay shockwave countdown
    if (this.shockwaveMs > 0) {
      this.shockwaveMs -= dt;
      if (this.shockwaveMs < 0) this.shockwaveMs = 0;
    }

    // (4) Stun countdown & active enemy stun refresh
    if (this.stunRemainingMs > 0) {
      this.stunRemainingMs -= dt;
      if (this.stunRemainingMs < 0) this.stunRemainingMs = 0;
      const rem = this.stunRemainingMs;
      for (let p = 0; p < this.enemyPools.length; p++) {
        this.enemyPools[p].forEachActive((e) => {
          e.stunMs = Math.max(e.stunMs || 0, rem);
        });
      }
    }

    // (5) Lingering damage field decay & enemy clearing
    if (this.damageFieldMs > 0) {
      this.damageFieldMs -= dt;
      if (this.damageFieldMs < 0) this.damageFieldMs = 0;
      const radiusSq = this.damageFieldRadius * this.damageFieldRadius;
      const dfX = this.damageFieldX;
      const dfY = this.damageFieldY;
      const enemies = this._enemies;
      const owners = this._owners;
      enemies.length = 0;
      owners.length = 0;
      for (let p = 0; p < this.enemyPools.length; p++) {
        const pool = this.enemyPools[p];
        pool.forEachActive((e) => {
          const dx = e.x - dfX;
          const dy = e.y - dfY;
          if (dx * dx + dy * dy <= radiusSq) {
            enemies.push(e);
            owners.push(pool);
          }
        });
      }
      const killed = this.collisionSystem.killedEnemies;
      for (let i = 0; i < enemies.length; i++) {
        owners[i].release(enemies[i]);
        killed.push(enemies[i]);
      }
    }
  }

  /**
   * The reusable smart-bomb screen clear, originated at (x, y).
   * @param {number} x Shockwave origin x (px).
   * @param {number} y Shockwave origin y (px).
   * @param {import('../core/Pool.js').Pool[]} [pools=this.enemyPools] Pools cleared;
   *   external/reused clears default to ordinary enemies.
   */
  detonateAt(x, y, pools = this.enemyPools) {
    const rawMult = this.playerStats?.bombRadiusMult;
    const mult = Number.isFinite(rawMult) && rawMult >= 1 ? rawMult : 1;
    const effectiveRadius = BOMB_SHOCKWAVE_MAX_RADIUS * mult;
    this.effectiveRadius = effectiveRadius;

    const enemies = this._enemies;
    const owners = this._owners;
    enemies.length = 0;
    owners.length = 0;
    for (let p = 0; p < pools.length; p++) {
      this._currentPool = pools[p];
      pools[p].forEachActive(this._collectEnemy);
    }

    const killed = this.collisionSystem.killedEnemies;
    for (let i = 0; i < enemies.length; i++) {
      owners[i].release(enemies[i]);
      killed.push(enemies[i]);
    }

    this.shockwaveMs = BOMB_SHOCKWAVE_MS;
    this.shockwaveX = x;
    this.shockwaveY = y;

    // Lv3+ Stun
    const rawStun = this.playerStats?.bombStunMs;
    const stunMs = Number.isFinite(rawStun) && rawStun >= 0 ? rawStun : 0;
    if (stunMs > 0) {
      this.stunRemainingMs = stunMs;
    }

    // Lv4+ XP Orbs
    const rawOrbs = this.playerStats?.bombXpOrbs;
    const orbCount = Number.isFinite(rawOrbs) && rawOrbs >= 0 ? Math.floor(rawOrbs) : 0;
    if (orbCount > 0 && this.xpOrbSystem && typeof this.xpOrbSystem.spawnOrb === 'function') {
      for (let i = 0; i < orbCount; i++) {
        this.xpOrbSystem.spawnOrb(x, y, 1);
      }
    }

    // Lv5+ Lingering Damage Field
    const rawFieldMs = this.playerStats?.bombDamageFieldMs;
    const fieldMs = Number.isFinite(rawFieldMs) && rawFieldMs >= 0 ? rawFieldMs : 0;
    if (fieldMs > 0) {
      this.damageFieldMs = fieldMs;
      this.damageFieldX = x;
      this.damageFieldY = y;
      this.damageFieldRadius = effectiveRadius;
    }
  }
}
