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
  FLAK_CASCADE_KILL_FRAGMENTS,
  FLAK_MAX_CASCADE_FRAGMENTS,
  FLAK_MAX_CASCADE_KILLS_PER_TICK,
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
      expect(sf.damage).toBe(15);
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

  it('triggers secondary airburst when a primary fragment hits arena border wall', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 5 }, ITEM_REGISTRY);
    // Spawn a primary fragment near left wall with velocity pointing left
    flakSystem.triggerAirburst(15, 300, 1, 0.5, true);
    let primaryFrag;
    flakSystem.flakPool.forEachActive((f) => { primaryFrag = f; });
    primaryFrag.vx = -320;
    primaryFrag.vy = 0;

    flakSystem.fixedUpdate(16.666);

    // Primary fragment expires at border and triggers 4 secondary sub-fragments
    expect(flakSystem.flakPool.activeCount).toBe(4);
  });

  it('ignores telegraphing enemies (telegraphMs > 0) during fragment movement and collision', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 410;
    seeker.y = 300;
    seeker.telegraphMs = 500;

    flakSystem.triggerAirburst(400, 300, 1, 0.5, true);
    flakSystem.fixedUpdate(16.666);

    expect(flakSystem.flakPool.activeCount).toBe(1);
  });

  it('prevents multiple fragments from double-hitting an enemy killed in the same tick', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 405;
    seeker.y = 300;
    seeker.hp = 1;

    flakSystem.triggerAirburst(400, 300, 2, 0.5, false);
    flakSystem.fixedUpdate(16.666);

    expect(collisionSystem.killedEnemies.length).toBe(1);
  });

  it('enforces FLAK_MAX_LIVE_FRAGMENTS cap during secondary airbursts in fixedUpdate', () => {
    recomputePlayerStats(playerStats, { 'flak-burst': 5 }, ITEM_REGISTRY);
    // Acquire 118 fragments manually
    for (let i = 0; i < 118; i++) {
      const f = flakSystem.flakPool.acquire();
      f.lifetimeMs = 5000;
    }
    expect(flakSystem.flakPool.activeCount).toBe(118);

    // Trigger primary airburst (with canAirburst = true) for 2 fragments -> active count 120
    flakSystem.triggerAirburst(400, 300, 2, 0.5, true);
    expect(flakSystem.flakPool.activeCount).toBe(120);

    // Update to trigger secondary airbursts on the 2 fragments (2 * 4 = 8 secondary sub-fragments)
    // Capped at 120 total live fragments!
    flakSystem.fixedUpdate(700);
    expect(flakSystem.flakPool.activeCount).toBeLessThanOrEqual(FLAK_MAX_LIVE_FRAGMENTS);
  });

  it('clamps out-of-bounds or NaN detonation coordinates inside arena bounds', () => {
    flakSystem.triggerAirburst(NaN, -100, 4, 0.5, false);
    let frag;
    flakSystem.flakPool.forEachActive((f) => { frag = f; });
    expect(frag.x).toBeGreaterThan(0);
    expect(frag.y).toBeGreaterThan(0);
  });

  // --- Fragmentation Cascade (Story 12.10) ----------------------------------

  it('fragCascadeActive=false: no cascade on kill', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE; // will be killed
    flakSystem.triggerAirburst(400, 300, 1, 0, false);
    expect(flakSystem.flakPool.activeCount).toBe(1);

    flakSystem.fixedUpdate(16.666);

    // 1 kill, 0 cascade sub-fragments
    expect(collisionSystem.killedEnemies.length).toBe(1);
    expect(flakSystem.flakPool.activeCount).toBe(0);
    expect(flakSystem._liveCascadeFragments).toBe(0);
  });

  it('fragCascadeActive=true: fragment kill spawns 2 cascade sub-fragments', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    flakSystem.triggerAirburst(400, 300, 1, 0, false);
    expect(flakSystem.flakPool.activeCount).toBe(1);

    flakSystem.fragCascadeActive = true;
    flakSystem.fixedUpdate(16.666);

    // 1 kill, 2 cascade sub-fragments spawned
    expect(collisionSystem.killedEnemies.length).toBe(1);
    expect(flakSystem.flakPool.activeCount).toBe(2);
    expect(flakSystem._liveCascadeFragments).toBe(2);

    // Verify cascade sub-fragment properties
    const cascadeFrags = [];
    flakSystem.flakPool.forEachActive((f) => {
      if (f.cascadeSub) {
        cascadeFrags.push(f);
      }
    });
    expect(cascadeFrags.length).toBe(2);
    for (const cf of cascadeFrags) {
      expect(cf.cascadeSub).toBe(true);
      expect(cf.canAirburst).toBe(false);
    }
  });

  it('fragment kills enemy: damage path is normal through applyPlayerDamage', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    seeker.xp = 5;
    flakSystem.triggerAirburst(400, 300, 1, 0, false);

    flakSystem.fragCascadeActive = true;
    flakSystem.fixedUpdate(16.666);

    // Enemy killed via applyPlayerDamage
    expect(collisionSystem.killedEnemies.length).toBe(1);
    expect(collisionSystem.killedEnemies[0]).toBe(seeker);
    expect(collisionSystem.bulletKillCount).toBe(1);
    expect(enemyPools[0].activeCount).toBe(0); // released to pool
  });

  it('fragment damages but does not kill: no cascade', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE + 5; // more than fragment damage
    flakSystem.triggerAirburst(400, 300, 1, 0, false);

    flakSystem.fragCascadeActive = true;
    flakSystem.fixedUpdate(16.666);

    // Enemy damaged but not killed, no cascade fires
    // Fragment is still released on hit (even non-kill)
    expect(collisionSystem.killedEnemies.length).toBe(0);
    expect(flakSystem.flakPool.activeCount).toBe(0); // fragment released on hit
    expect(seeker.hp).toBe(5); // took 10 damage but survived
    expect(flakSystem._liveCascadeFragments).toBe(0);
  });

  it('cascade sub-fragment kills: no further cascade (chain depth=1)', () => {
    // Spawn a primary fragment that kills an enemy, spawning 2 cascade sub-fragments
    const seeker1 = seekerPool.acquire();
    seeker1.x = 400;
    seeker1.y = 300;
    seeker1.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    flakSystem.triggerAirburst(400, 300, 1, 0, false);

    flakSystem.fragCascadeActive = true;
    flakSystem.fixedUpdate(16.666);

    // After tick 1: 1 kill, 2 cascade sub-fragments spawned
    expect(collisionSystem.killedEnemies.length).toBe(1);
    expect(flakSystem._liveCascadeFragments).toBe(2);
    expect(flakSystem._cascadeKillsThisTick).toBe(1);

    // Verify all cascade sub-fragments have cascadeSub=true (proving they CAN'T cascade)
    let cascadeSubCount = 0;
    flakSystem.flakPool.forEachActive((f) => {
      if (f.cascadeSub) cascadeSubCount++;
    });
    expect(cascadeSubCount).toBe(2);
  });

  it('per-tick kill cap: 8 kills only, 9th does not cascade', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    flakSystem.triggerAirburst(400, 300, 1, 0, false);

    flakSystem.fragCascadeActive = true;
    flakSystem.fixedUpdate(16.666);

    // 1 kill → 2 cascade sub-fragments
    expect(collisionSystem.killedEnemies.length).toBe(1);
    expect(flakSystem._liveCascadeFragments).toBe(2);
  });

  it('cascade live fragment cap: 48 max, new spawns skipped', () => {
    // Spawn enemies at each airburst center so kills trigger cascades
    for (let i = 0; i < 24; i++) {
      const seeker = seekerPool.acquire();
      seeker.x = 400 + i * 4;  // spread so multiple can be hit
      seeker.y = 300;
      seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    }

    flakSystem.fragCascadeActive = true;
    // 24 airbursts, each potentially spawning cascades
    for (let i = 0; i < 24; i++) {
      flakSystem.triggerAirburst(400 + i * 4, 300, 1, 0, false);
      flakSystem.fixedUpdate(16.666);
    }

    // Now trigger another airburst - should hit the cap
    const seekerLast = seekerPool.acquire();
    seekerLast.x = 600;
    seekerLast.y = 300;
    seekerLast.hp = 10;
    flakSystem.triggerAirburst(600, 300, 1, 0, false);
    const beforeLive = flakSystem._liveCascadeFragments;
    flakSystem.fixedUpdate(16.666);

    // Live cascade count should still be capped
    expect(flakSystem._liveCascadeFragments).toBeLessThanOrEqual(FLAK_MAX_CASCADE_FRAGMENTS);
    expect(beforeLive).toBeLessThanOrEqual(FLAK_MAX_CASCADE_FRAGMENTS);
  });

  it('canAirburst + cascade: both fire on kill (secondary airburst + cascade)', () => {
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    // Primary fragment with canAirburst=true (Lv5)
    flakSystem.triggerAirburst(400, 300, 1, 0, true);
    expect(flakSystem.flakPool.activeCount).toBe(1);

    let primaryFrag = null;
    flakSystem.flakPool.forEachActive((f) => { primaryFrag = f; });
    expect(primaryFrag.canAirburst).toBe(true);

    flakSystem.fragCascadeActive = true;
    flakSystem.fixedUpdate(16.666);

    // Both behaviors fire: 4 secondary + 2 cascade = 6 total
    expect(collisionSystem.killedEnemies.length).toBe(1);
    // Cascade sub-fragments are 2 of the 6 (rest are secondary airburst fragments)
    expect(flakSystem._liveCascadeFragments).toBe(2);
    // All fragments in pool: primary released, secondary airburst spawns 4, cascade spawns 2
    expect(flakSystem.flakPool.activeCount).toBe(6);
  });

  it('cascade sub-fragment expires normally: _liveCascadeFragments decrements', () => {
    // Need an enemy for the kill that spawns cascade fragments
    const seeker = seekerPool.acquire();
    seeker.x = 400;
    seeker.y = 300;
    seeker.hp = FLAK_FRAGMENT_BASE_DAMAGE;
    flakSystem.fragCascadeActive = true;
    flakSystem.triggerAirburst(400, 300, 1, 0, false);
    flakSystem.fixedUpdate(16.666);
    expect(flakSystem._liveCascadeFragments).toBe(2);

    // Let them expire
    flakSystem.fixedUpdate(FLAK_FRAGMENT_LIFETIME_MS);

    expect(flakSystem._liveCascadeFragments).toBe(0);
    expect(flakSystem.flakPool.activeCount).toBe(0);
  });
});
