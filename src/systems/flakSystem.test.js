import { describe, it, expect, beforeEach } from 'vitest';
import { FlakSystem } from './FlakSystem.js';
import { FiringSystem } from './FiringSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { InputState } from '../input/InputState.js';
import { createPlayerStats, recomputePlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import { createSeeker } from '../entities/Seeker.js';
import { createArmored } from '../entities/Armored.js';
import {
  FLAK_FRAGMENT_RADIUS,
  FLAK_FRAGMENT_SPEED,
  FLAK_FRAGMENT_LIFETIME_MS,
  FLAK_FRAGMENT_BASE_DAMAGE,
  FLAK_MAX_LIVE_FRAGMENTS,
  ARMORED_HP,
} from '../config/constants.js';

describe('FlakSystem & Flak Burst Mechanics (Story 11.6)', () => {
  let ship;
  let inputState;
  let playerStats;
  let firingSystem;
  let seekerPool;
  let armoredPool;
  let enemyPools;
  let collisionSystem;
  let flakSystem;

  beforeEach(() => {
    ship = createPlayerShip();
    inputState = new InputState();
    playerStats = createPlayerStats();
    firingSystem = new FiringSystem(ship, inputState, playerStats);

    seekerPool = new Pool(createSeeker);
    armoredPool = new Pool(createArmored);
    enemyPools = [seekerPool, armoredPool];

    collisionSystem = new CollisionSystem(firingSystem.bulletPool, enemyPools);
    flakSystem = new FlakSystem(ship, enemyPools, collisionSystem, playerStats);

    firingSystem.flakSystem = flakSystem;
    collisionSystem.flakSystem = flakSystem;
  });

  it('unowned Flak Burst (flakCadence === 0) yields standard bullets with no airbursts', () => {
    inputState.setAim(1, 0); // aim right

    // Fire 10 shots
    for (let i = 0; i < 10; i++) {
      firingSystem._accumMs = 90;
      firingSystem.fixedUpdate(16.666);
    }

    expect(firingSystem.shotsFiredCount).toBe(1);
    let activeBullets = [];
    firingSystem.bulletPool.forEachActive((b) => activeBullets.push(b));
    for (const b of activeBullets) {
      expect(b.isFlak).toBe(false);
    }

    // Advance bullets until they hit the arena border
    for (let tick = 0; tick < 200; tick++) {
      firingSystem.fixedUpdate(16.666);
      flakSystem.fixedUpdate(16.666);
    }

    expect(flakSystem.flakPool.activeCount).toBe(0);
  });

  it('Lv1 owned: 5th shot airbursts on wall into 6 fragments radially in 360°', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 1 }, ITEM_REGISTRY);
    inputState.setAim(1, 0);

    const bulletsFired = [];
    for (let i = 0; i < 5; i++) {
      firingSystem._accumMs = 90;
      firingSystem.fixedUpdate(16.666);
      firingSystem.bulletPool.forEachActive((b) => {
        if (!bulletsFired.includes(b)) bulletsFired.push(b);
      });
    }

    expect(bulletsFired.length).toBe(5);
    expect(bulletsFired[0].isFlak).toBe(false);
    expect(bulletsFired[1].isFlak).toBe(false);
    expect(bulletsFired[2].isFlak).toBe(false);
    expect(bulletsFired[3].isFlak).toBe(false);
    expect(bulletsFired[4].isFlak).toBe(true);
    expect(bulletsFired[4].flakFragments).toBe(6);

    inputState.clear();
    // Let the 5th shot reach the wall and expire
    for (let tick = 0; tick < 200; tick++) {
      firingSystem.fixedUpdate(16.666);
    }

    // 6 primary fragments spawned!
    expect(flakSystem.flakPool.activeCount).toBe(6);

    const fragments = [];
    flakSystem.flakPool.forEachActive((f) => fragments.push(f));

    // Verify 360° radial distribution and speed
    for (let i = 0; i < fragments.length; i++) {
      const f = fragments[i];
      const angle = (i / 6) * Math.PI * 2;
      expect(f.vx).toBeCloseTo(Math.cos(angle) * FLAK_FRAGMENT_SPEED);
      expect(f.vy).toBeCloseTo(Math.sin(angle) * FLAK_FRAGMENT_SPEED);
      expect(f.damage).toBe(FLAK_FRAGMENT_BASE_DAMAGE);
      expect(f.canAirburst).toBe(false);
    }
  });

  it('Lv2 owned: every 4th shot airbursts into 8 fragments', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 2 }, ITEM_REGISTRY);
    inputState.setAim(1, 0);

    const flakFlags = [];
    for (let i = 0; i < 4; i++) {
      firingSystem._accumMs = 90;
      firingSystem.fixedUpdate(16.666);
      let latestBullet;
      firingSystem.bulletPool.forEachActive((b) => {
        latestBullet = b;
      });
      flakFlags.push(latestBullet.isFlak);
    }

    expect(flakFlags).toEqual([false, false, false, true]);

    inputState.clear();
    // Let 4th bullet hit wall
    for (let tick = 0; tick < 200; tick++) {
      firingSystem.fixedUpdate(16.666);
    }

    expect(flakSystem.flakPool.activeCount).toBe(8);
  });

  it('Lv3 fragment damage (+50%) routes through applyPlayerDamage and one-shots armored enemy', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 3 }, ITEM_REGISTRY);

    // Place an armored enemy in front of detonation
    const armored = armoredPool.acquire();
    armored.x = 400;
    armored.y = 300;
    armored.radius = 20;
    armored.hp = ARMORED_HP; // 5

    // Trigger airburst at (390, 300) with Lv3 stats (damageMult = 0.5 -> damage = 15)
    flakSystem.triggerAirburst(390, 300, 6, 0.5, false);

    // Advance FlakSystem so fragment moves and hits armored enemy
    flakSystem.fixedUpdate(16.666);

    // Armored enemy should be killed in 1 hit (15 damage > 5 HP)
    expect(armoredPool.activeCount).toBe(0);
    expect(collisionSystem.killedEnemies).toContain(armored);
  });

  it('Lv4 owned: every 3rd shot airbursts into 12 fragments', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 4 }, ITEM_REGISTRY);
    inputState.setAim(1, 0);

    const flakFlags = [];
    for (let i = 0; i < 3; i++) {
      firingSystem._accumMs = 90;
      firingSystem.fixedUpdate(16.666);
      let latestBullet;
      firingSystem.bulletPool.forEachActive((b) => {
        latestBullet = b;
      });
      flakFlags.push(latestBullet.isFlak);
    }

    expect(flakFlags).toEqual([false, false, true]);

    inputState.clear();
    // Let 3rd bullet hit wall
    for (let tick = 0; tick < 200; tick++) {
      firingSystem.fixedUpdate(16.666);
    }

    expect(flakSystem.flakPool.activeCount).toBe(12);
  });


  it('Lv5 secondary airbursts: primary fragments airburst ONCE into 4 sub-fragments; sub-fragments do not airburst again', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 5 }, ITEM_REGISTRY);

    // Trigger primary airburst with canAirburst = true at center of screen
    flakSystem.triggerAirburst(400, 300, 6, 0.5, true);

    expect(flakSystem.flakPool.activeCount).toBe(6);

    // Let primary fragments expire due to lifetime
    for (let tick = 0; tick < 40; tick++) {
      flakSystem.fixedUpdate(16.666);
    }

    // Each of the 6 primary fragments airbursts into 4 secondary fragments = 24 secondary fragments!
    expect(flakSystem.flakPool.activeCount).toBe(24);

    let secondaryFragments = [];
    flakSystem.flakPool.forEachActive((f) => secondaryFragments.push(f));
    for (const sf of secondaryFragments) {
      expect(sf.canAirburst).toBe(false);
    }

    // Let secondary fragments expire due to lifetime
    for (let tick = 0; tick < 40; tick++) {
      flakSystem.fixedUpdate(16.666);
    }

    // Secondary fragments do NOT airburst again, so active fragments drop to 0!
    expect(flakSystem.flakPool.activeCount).toBe(0);
  });

  it('live fragment count is hard capped at FLAK_MAX_LIVE_FRAGMENTS (120) with zero allocation', () => {
    // Attempt to trigger many airbursts exceeding 120
    for (let i = 0; i < 20; i++) {
      flakSystem.triggerAirburst(400, 300, 12, 0.5, true);
    }

    // Active count must not exceed 120
    expect(flakSystem.flakPool.activeCount).toBe(FLAK_MAX_LIVE_FRAGMENTS);
  });

  it('flak bullet airbursts on enemy impact in CollisionSystem', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 1 }, ITEM_REGISTRY);
    inputState.setAim(1, 0);

    // Spawn an enemy in front of ship
    const seeker = seekerPool.acquire();
    seeker.x = ship.x + 50;
    seeker.y = ship.y;
    seeker.radius = 14;

    // Fire 5 shots so 5th is flak
    for (let i = 0; i < 5; i++) {
      firingSystem._accumMs = 90;
      firingSystem.fixedUpdate(16.666);
    }

    // Move non-flak bullets away and 5th bullet to hit seeker
    let flakBullet;
    firingSystem.bulletPool.forEachActive((b) => {
      if (b.isFlak) {
        flakBullet = b;
        b.x = seeker.x;
        b.y = seeker.y;
      } else {
        b.x = -1000;
        b.y = -1000;
      }
    });
    expect(flakBullet).toBeDefined();

    // Run CollisionSystem
    collisionSystem.fixedUpdate(16.666);

    // Flak bullet should have airburst on collision
    expect(flakBullet.isFlak).toBe(false);
    expect(flakSystem.flakPool.activeCount).toBe(6);
  });

  it('Lv5 primary fragment secondary airbursts on enemy impact in FlakSystem', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 5 }, ITEM_REGISTRY);

    // Place an enemy right next to primary fragment trajectory
    const seeker = seekerPool.acquire();
    seeker.x = 410;
    seeker.y = 300;
    seeker.radius = 14;

    // Trigger primary airburst near enemy
    flakSystem.triggerAirburst(400, 300, 1, 0.5, true);
    expect(flakSystem.flakPool.activeCount).toBe(1);

    let primaryFrag;
    flakSystem.flakPool.forEachActive((f) => { primaryFrag = f; });
    // Point fragment towards seeker
    primaryFrag.vx = 320;
    primaryFrag.vy = 0;

    // Tick FlakSystem
    flakSystem.fixedUpdate(16.666);

    // Primary fragment should have hit enemy and triggered secondary airburst (4 sub-fragments)
    expect(flakSystem.flakPool.activeCount).toBe(4);
  });

  it('flak cadence tracking and stamping under multi-bullet spread-cannon volleys', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 1, 'spread-cannon': 1 }, ITEM_REGISTRY); // 3-way spread, 5th shot flak
    inputState.setAim(1, 0);

    let flakBulletsCount = 0;
    // Fire two 3-way volleys (6 bullets total). The 5th bullet overall should be flak.
    for (let v = 0; v < 2; v++) {
      firingSystem._accumMs = 90;
      firingSystem.fixedUpdate(16.666);
    }

    firingSystem.bulletPool.forEachActive((b) => {
      if (b.isFlak) flakBulletsCount++;
    });

    expect(flakBulletsCount).toBe(1);
  });
});
