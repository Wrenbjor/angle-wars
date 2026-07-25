import { describe, it, expect } from 'vitest';
import { BombSystem } from './BombSystem.js';
import { Pool } from '../core/Pool.js';
import { InputState } from '../input/InputState.js';
import { createSeeker } from '../entities/Seeker.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerStats, recomputePlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import { FIXED_STEP_MS, BOMB_SHOCKWAVE_MAX_RADIUS } from '../config/constants.js';
import { EnemySystem } from './EnemySystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { createPlayerState } from '../state/PlayerState.js';

const DT = FIXED_STEP_MS;

function setupBombCapacitorTest({ level = 0, score = 0 } = {}) {
  const inputState = new InputState();
  const enemyPool = new Pool(createSeeker);
  const collisionSystem = { killedEnemies: [] };
  const scoreState = createScoreState();
  scoreState.score = score;
  const ship = createPlayerShip();
  const playerStats = createPlayerStats();
  if (level > 0) {
    recomputePlayerStats(playerStats, { 'bomb-capacitor': level }, ITEM_REGISTRY);
  }
  const spawnedOrbs = [];
  const xpOrbSystem = {
    spawnOrb: (x, y, value) => {
      spawnedOrbs.push({ x, y, value });
    },
    _spawn: (x, y, value) => {
      spawnedOrbs.push({ x, y, value });
    },
  };
  const system = new BombSystem(
    inputState,
    [enemyPool],
    collisionSystem,
    scoreState,
    ship,
    playerStats,
    xpOrbSystem,
  );
  return {
    system,
    inputState,
    enemyPool,
    collisionSystem,
    scoreState,
    ship,
    playerStats,
    xpOrbSystem,
    spawnedOrbs,
  };
}

describe('Bomb Capacitor System — Story 11.9', () => {
  it('unowned / default: 100k threshold, 900px radius, 0 extra bombs, no stun, no orb drop, no damage field', () => {
    const { system, scoreState, inputState } = setupBombCapacitorTest({ level: 0 });
    const initialBombs = scoreState.bombs; // 3
    system.fixedUpdate(DT);

    // Extra bombs not granted
    expect(scoreState.bombs).toBe(initialBombs);
    // Effective radius is default 900
    expect(system.effectiveRadius).toBe(BOMB_SHOCKWAVE_MAX_RADIUS);

    // Score 99k -> no bomb
    scoreState.score = 99000;
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(initialBombs);

    // Score 100k -> +1 bomb
    scoreState.score = 100000;
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(initialBombs + 1);

    // Detonation produces default shockwave, no orbs, no stun, no damage field
    inputState.queueBomb();
    system.fixedUpdate(DT);
    expect(system.effectiveRadius).toBe(900);
    expect(system.stunRemainingMs).toBe(0);
    expect(system.damageFieldMs).toBe(0);
  });

  it('Lv1: grants +1 extra bomb on pick, effective shockwave radius is 1170px (1.3x)', () => {
    const { system, scoreState, inputState } = setupBombCapacitorTest({ level: 1 });
    const initialBombs = 3;

    system.fixedUpdate(DT);
    // +1 extra bomb granted immediately on sync
    expect(scoreState.bombs).toBe(initialBombs + 1);

    inputState.queueBomb();
    system.fixedUpdate(DT);
    // Shockwave effective radius is 900 * 1.3 = 1170
    expect(system.effectiveRadius).toBeCloseTo(1170);
  });

  it('Lv2: dynamic threshold interval (+1 bomb awarded every 75,000 points scored)', () => {
    const { system, scoreState } = setupBombCapacitorTest({ level: 2 });
    system.fixedUpdate(DT);
    const baseBombs = scoreState.bombs;

    // Score reaches 75k -> +1 bomb awarded
    scoreState.score = 75000;
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(baseBombs + 1);

    // Score reaches 150k -> +1 bomb awarded
    scoreState.score = 150000;
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(baseBombs + 2);
  });

  it('Lv3: +1 extra bomb (total +2), 2s survivor stun applied to combat enemies', () => {
    const { system, scoreState, inputState, enemyPool, ship } = setupBombCapacitorTest({ level: 3 });
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(3 + 2);

    const enemySystem = new EnemySystem(ship);

    // Trigger bomb detonation
    inputState.queueBomb();
    system.fixedUpdate(DT);
    expect(system.stunRemainingMs).toBeCloseTo(2000 - DT);

    // A combat enemy present / entering during the stun window
    const seeker = enemyPool.acquire();
    seeker.x = 200;
    seeker.y = 200;
    seeker.telegraphMs = 0;

    const playerState = createPlayerState();
    const deathSystem = new PlayerDeathSystem(ship, [enemyPool], playerState);

    // Next tick: BombSystem updates stun window and stamps seeker.stunMs
    system.fixedUpdate(DT);
    expect(seeker.stunMs).toBeGreaterThan(0);

    // Enemy system updates while stunned: seeker stays frozen (vx/vy zero)
    enemySystem.fixedUpdate(DT);
    expect(seeker.vx).toBe(0);
    expect(seeker.vy).toBe(0);

    // Player death system checks contact: seeker is non-lethal while stunned
    ship.x = 200;
    ship.y = 200;
    deathSystem.fixedUpdate(DT);
    expect(playerState.lives).toBe(3); // Contact death skipped
  });

  it('Lv4: 50k threshold interval, detonation spawns 5 XP orbs around detonation point', () => {
    const { system, scoreState, inputState, spawnedOrbs } = setupBombCapacitorTest({ level: 4 });
    system.fixedUpdate(DT);
    const baseBombs = scoreState.bombs;

    // Score reaches 50k -> +1 bomb
    scoreState.score = 50000;
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(baseBombs + 1);

    // Detonate
    inputState.queueBomb();
    system.fixedUpdate(DT);

    // 5 XP orbs spawned
    expect(spawnedOrbs.length).toBe(5);
    for (const orb of spawnedOrbs) {
      expect(orb.x).toBe(system.ship.x);
      expect(orb.y).toBe(system.ship.y);
      expect(orb.value).toBe(1);
    }
  });

  it('Lv5: +2 extra bombs (total +4), 3s lingering damage field clearing entering enemies', () => {
    const { system, scoreState, inputState, enemyPool, collisionSystem } = setupBombCapacitorTest({ level: 5 });
    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(3 + 4);

    inputState.queueBomb();
    system.fixedUpdate(DT);
    expect(system.damageFieldMs).toBeCloseTo(3000 - DT);
    expect(system.damageFieldRadius).toBeCloseTo(1170);

    // Spawn an entering enemy within damage field radius
    const seeker = enemyPool.acquire();
    seeker.x = system.ship.x + 100;
    seeker.y = system.ship.y + 100;
    seeker.telegraphMs = 0;

    // Next tick: lingering damage field clears the entering enemy
    system.fixedUpdate(DT);
    expect(enemyPool.activeCount).toBe(0);
    expect(collisionSystem.killedEnemies).toContain(seeker);
  });

  it('handles sanitization of malformed playerStats gracefully', () => {
    const inputState = new InputState();
    const enemyPool = new Pool(createSeeker);
    const collisionSystem = { killedEnemies: [] };
    const scoreState = createScoreState();
    const ship = createPlayerShip();

    const malformedStats = {
      extraBombs: -5,
      bombRadiusMult: 'invalid',
      bombAwardInterval: -100,
      bombStunMs: NaN,
      bombXpOrbs: -3,
      bombDamageFieldMs: null,
    };

    const system = new BombSystem(
      inputState,
      [enemyPool],
      collisionSystem,
      scoreState,
      ship,
      malformedStats,
    );

    system.fixedUpdate(DT);
    expect(scoreState.bombs).toBe(3); // extraBombs clamped >= 0
    expect(system.effectiveRadius).toBe(900); // bombRadiusMult fallback >= 1

    inputState.queueBomb();
    system.fixedUpdate(DT);

    expect(system.stunRemainingMs).toBe(0);
    expect(system.damageFieldMs).toBe(0);
  });
});
