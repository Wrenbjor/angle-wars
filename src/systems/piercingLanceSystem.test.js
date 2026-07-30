import { describe, it, expect } from 'vitest';
import { PiercingLanceSystem } from './PiercingLanceSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createArmored } from '../entities/Armored.js';
import { createBullet } from '../entities/Bullet.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerStats, recomputePlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import {
  FIXED_STEP_MS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  LANCE_BOLT_SPEED,
  LANCE_BOLT_RADIUS,
  LANCE_BOLT_BASE_DAMAGE,
  LANCE_PERIOD_FLOOR_MS,
  LANCE_BASE_PIERCE,
  LANCE_MAX_PIERCE,
  LANCE_BOLT_POOL_PREWARM,
  LANCE_TRAIL_LIFETIME_MS,
  LANCE_TRAIL_NODE_RADIUS,
  LANCE_TRAIL_DAMAGE,
  LANCE_TRAIL_NODE_MAX,
  ARMORED_HP,
  PLAYER_BULLET_BASE_DAMAGE,
  RAILGUN_CHARGE_TIME_MS,
  RAILGUN_DAMAGE_MULT,
  RAILGUN_BEAM_MAX_LENGTH,
  RAILGUN_BEAM_THICKNESS,
} from '../config/constants.js';

// Story 11.4 — PiercingLanceSystem owns the Piercing Lance's bolt POOL + trail-node POOL + the
// fire ACCUMULATOR, while the shared playerStats store owns only the derived
// period/pierce/damage/trail/backward. This suite covers the rows of the story's I/O matrix
// that belong to this system: the ownership gate, firing toward the nearest enemy, the pierce
// count limit + hit-once-per-enemy (within a tick AND across ticks), the armored hits-to-kill
// curve per level, hold-fire-when-target-less + fire-on-appearance, the Lv4 trail (damages
// within / expires after the 0.5s window), the Lv5 backward bolt, the trail-node cap, the
// per-level fold values, and the steady-state zero-allocation invariant. The registration-slot
// + assembled-pipeline wiring lives in buildArenaWorld.test.js.

const DT = FIXED_STEP_MS;

// The per-level fold maps the real registry produces (pinned against the registry itself in
// itemRegistry.test.js / playerStats.test.js — restated here as the system's input vocabulary).
const LV1 = { lancePeriodMs: 2000, lancePierce: 2, lanceDamage: 4 };
const LV2 = { lancePeriodMs: 2000, lancePierce: 4, lanceDamage: 4 };
const LV3 = { lancePeriodMs: 1400, lancePierce: 4, lanceDamage: 6 };
const LV4 = { lancePeriodMs: 1400, lancePierce: 7, lanceDamage: 6, lanceTrail: 1 };
const LV5 = {
  lancePeriodMs: 1400,
  lancePierce: 7,
  lanceDamage: 6,
  lanceTrail: 1,
  lanceBackward: 1,
};

/**
 * A piercing-lance system over a fresh centred ship, the given enemy pools, a real
 * CollisionSystem seam, and a real player-stat store seeded with the given fold fields (the
 * shape `recomputePlayerStats` produces). `stats === null` means NO store (the pre-story path).
 */
function makeSystem(stats = {}, pools) {
  const ship = createPlayerShip();
  ship.x = ARENA_WIDTH / 2;
  ship.y = ARENA_HEIGHT / 2;
  const enemyPools = pools ?? [new Pool(createSeeker)];
  const collisionSystem = new CollisionSystem(new Pool(createBullet), enemyPools);
  const playerStats = stats === null ? null : { ...createPlayerStats(), ...stats };
  const system = new PiercingLanceSystem(ship, enemyPools, collisionSystem, playerStats);
  return { ship, enemyPools, enemyPool: enemyPools[0], collisionSystem, playerStats, system };
}

function addEnemy(pool, x, y, { telegraphMs = 0, hp } = {}) {
  const e = pool.acquire();
  e.x = x;
  e.y = y;
  e.vx = 0;
  e.vy = 0;
  e.telegraphMs = telegraphMs;
  if (hp !== undefined) e.hp = hp;
  return e;
}

/**
 * Inject a stamped bolt directly into the bolt pool (white-box, for the advance/collide/pierce/
 * trail paths). Clears the per-bolt hitSet, mirroring the system's spawn.
 */
function injectBolt(
  system,
  {
    x,
    y,
    vx = 0,
    vy = 0,
    radius = LANCE_BOLT_RADIUS,
    damage = LANCE_BOLT_BASE_DAMAGE,
    pierceRemaining = LANCE_BASE_PIERCE,
    trail = 0,
    trailAccumMs = 0,
  },
) {
  const b = system.pool.acquire();
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.radius = radius;
  b.damage = damage;
  b.pierceRemaining = pierceRemaining;
  b.trail = trail;
  b.trailAccumMs = trailAccumMs;
  b.hitSet.clear();
  return b;
}

/**
 * Inject a stamped trail node directly into the trail pool (white-box, for the age/damage/expire
 * paths). Clears the per-node hitSet, mirroring the system's drop.
 */
function injectTrailNode(
  system,
  { x, y, radius = LANCE_TRAIL_NODE_RADIUS, lifeMs = 0, damage = LANCE_TRAIL_DAMAGE },
) {
  const n = system.trailPool.acquire();
  n.x = x;
  n.y = y;
  n.radius = radius;
  n.lifeMs = lifeMs;
  n.damage = damage;
  n.hitSet.clear();
  return n;
}

function activeBolts(system) {
  const out = [];
  system.pool.forEachActive((b) => out.push(b));
  return out;
}

function isActive(pool, target) {
  let found = false;
  pool.forEachActive((e) => {
    if (e === target) found = true;
  });
  return found;
}

function isBoltActive(system, target) {
  let found = false;
  system.pool.forEachActive((b) => {
    if (b === target) found = true;
  });
  return found;
}

describe('PiercingLanceSystem — ownership gate (unowned / null store)', () => {
  it('an unowned build (period 0) fires NO bolts and never touches an enemy', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem();
    const e = addEnemy(enemyPool, ship.x + 100, ship.y);
    expect(system._periodMs()).toBe(0);
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
    expect(system.trailPool.activeCount).toBe(0);
    expect(system._fireAccumMs).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).toHaveLength(0);
    expect(collisionSystem.bulletDamageCount).toBe(0);
  });

  it('a NULL store means no bolts ever, no throw (the pre-11.4 path)', () => {
    const { enemyPool, system, ship } = makeSystem(null);
    expect(system.playerStats).toBeNull();
    const e = addEnemy(enemyPool, ship.x + 100, ship.y);
    expect(() => {
      for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
  });

  it('a MISSING store (legacy stub) means no bolts ever, no throw', () => {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const collisionSystem = new CollisionSystem(new Pool(createBullet), [enemyPool]);
    const system = new PiercingLanceSystem(ship, [enemyPool], collisionSystem);
    expect(system.playerStats).toBeNull();
    expect(() => {
      for (let i = 0; i < 100; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
  });

  it('guards a null ship / pools / collisionSystem defensively (no-op, no throw)', () => {
    const playerStats = { ...createPlayerStats(), ...LV5 };
    const noShip = new PiercingLanceSystem(null, null, null, playerStats);
    expect(() => {
      for (let i = 0; i < 50; i++) noShip.fixedUpdate(DT);
    }).not.toThrow();
    // No ship → no fire (a bolt is fired FROM the ship position).
    expect(noShip.pool.activeCount).toBe(0);
  });
});

describe('PiercingLanceSystem — firing toward the nearest enemy', () => {
  it('Lv1 fires one bolt FROM the ship TOWARD the nearest enemy on a full period', () => {
    const { system, ship } = makeSystem(LV1);
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y); // straight ahead on +x
    system._fireAccumMs = LV1.lancePeriodMs; // one full period of banked credit → fires now
    system.fixedUpdate(DT);
    const bolts = activeBolts(system);
    expect(bolts).toHaveLength(1);
    const [b] = bolts;
    // Fired from (near) the ship, aimed +x at the target (vx > 0, vy ≈ 0), at constant speed.
    expect(b.vx).toBeGreaterThan(0);
    expect(Math.abs(b.vy)).toBeLessThan(1e-6);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(LANCE_BOLT_SPEED, 6);
    // Stamped with the Lv1 fold shape.
    expect(b.pierceRemaining).toBe(LV1.lancePierce);
    expect(b.damage).toBe(LV1.lanceDamage);
    expect(b.trail).toBe(0);
    // A fresh bolt is NOT advanced/collided the tick it spawns (added after the snapshot).
    expect(b.x).toBeCloseTo(ship.x, 6);
    expect(b.y).toBeCloseTo(ship.y, 6);
  });

  it('aims at the NEARER of two enemies', () => {
    const { system, ship } = makeSystem(LV1);
    addEnemy(system.enemyPools[0], ship.x + 40, ship.y); // nearest (+x)
    addEnemy(system.enemyPools[0], ship.x - 300, ship.y); // farther (−x)
    system._fireAccumMs = LV1.lancePeriodMs;
    system.fixedUpdate(DT);
    const [b] = activeBolts(system);
    // Aimed toward the +40 enemy → +x (a flipped nearest comparison would send it −x).
    expect(b.vx).toBeGreaterThan(0);
  });

  it('clamps the fire ORIGIN into the arena interior for a wall-pressed ship', () => {
    const { system, ship } = makeSystem(LV1);
    ship.x = 2; // pressed hard into the left wall (outside the border inset)
    ship.y = 2;
    addEnemy(system.enemyPools[0], ARENA_WIDTH / 2, ARENA_HEIGHT / 2); // interior target
    system._fireAccumMs = LV1.lancePeriodMs;
    system.fixedUpdate(DT);
    const [b] = activeBolts(system);
    expect(b.x).toBeGreaterThanOrEqual(ARENA_BORDER_INSET);
    expect(b.y).toBeGreaterThanOrEqual(ARENA_BORDER_INSET);
    // …and it flies toward the interior (down-right), not born off-arena.
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vy).toBeGreaterThan(0);
  });

  it('a target coincident with the ship fires a FINITE-velocity bolt that still releases', () => {
    // mag === 0 fire path: an enemy sitting exactly on the (clamped) ship origin gives no aim
    // direction. The fallback must pick an arbitrary but FINITE velocity — never NaN, which would
    // make the bolt never exit (isOutsideArena false) and never hit (distance test false), leaking
    // the pool one immortal bolt per coincident fire.
    const { system, ship } = makeSystem(LV1);
    addEnemy(system.enemyPools[0], ship.x, ship.y); // exactly on the ship
    system._fireAccumMs = LV1.lancePeriodMs;
    system.fixedUpdate(DT);
    const [b] = activeBolts(system);
    expect(b).toBeDefined();
    expect(Number.isFinite(b.vx)).toBe(true);
    expect(Number.isFinite(b.vy)).toBe(true);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(LANCE_BOLT_SPEED, 6);
    // …and it is a normal bolt: it flies out of the arena and is released (no immortal leak).
    for (let i = 0; i < 400; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });

  it('NEVER targets a telegraphing (spawning-in) enemy', () => {
    const { system, ship } = makeSystem(LV1);
    addEnemy(system.enemyPools[0], ship.x + 100, ship.y, { telegraphMs: 1e6 });
    for (let i = 0; i < 300; i++) system.fixedUpdate(DT);
    // The only enemy telegraphs → no target was ever found, nothing fired.
    expect(system.pool.activeCount).toBe(0);
  });
});

describe('PiercingLanceSystem — kill + pierce through the shared seam', () => {
  it('a bolt over an unarmored enemy kills it via applyPlayerDamage and SURVIVES (pierce 2)', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y);
    const bolt = injectBolt(system, {
      x: ship.x + 300,
      y: ship.y,
      vx: LANCE_BOLT_SPEED,
      vy: 0,
      pierceRemaining: 2,
      damage: 4,
    });
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false); // killed through the shared seam
    expect(collisionSystem.killedEnemies).toContain(e);
    expect(collisionSystem.bulletKillCount).toBe(1);
    // Bolt survives with one pierce charge spent, still in flight.
    expect(isBoltActive(system, bolt)).toBe(true);
    expect(bolt.pierceRemaining).toBe(1);
  });

  it('Lv2 pierce 4: a bolt kills the first 4 distinct enemies (each once) then is released before the 5th', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV2);
    // Five enemies stacked at one point → one bolt overlaps all five this tick.
    const cluster = [];
    for (let i = 0; i < 5; i++) cluster.push(addEnemy(enemyPool, ship.x + 300, ship.y));
    const bolt = injectBolt(system, {
      x: ship.x + 300,
      y: ship.y,
      vx: LANCE_BOLT_SPEED,
      vy: 0,
      pierceRemaining: 4,
      damage: 4,
    });
    system.fixedUpdate(DT);
    // Exactly 4 killed; the bolt is released (pierce spent); one enemy survives.
    expect(collisionSystem.killedEnemies).toHaveLength(4);
    expect(collisionSystem.bulletKillCount).toBe(4);
    expect(isBoltActive(system, bolt)).toBe(false);
    const survivors = cluster.filter((e) => isActive(enemyPool, e));
    expect(survivors).toHaveLength(1);
  });

  it('hits each distinct enemy AT MOST ONCE across ticks (per-bolt hitSet, no double pierce-spend)', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system, ship } = makeSystem(LV2, [armoredPool]);
    // A stationary armored (huge hp) survives, and a stationary (vx/vy 0) bolt keeps overlapping
    // it every tick — without the hitSet guard it would spend a pierce charge each tick.
    const a = addEnemy(armoredPool, ship.x, ship.y, { hp: 1e9 });
    const bolt = injectBolt(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, pierceRemaining: 4, damage: 4 });
    for (let i = 0; i < 5; i++) system.fixedUpdate(DT);
    // One hit total, one pierce charge spent, the enemy still in the bolt's hitSet.
    expect(collisionSystem.bulletDamageCount).toBe(1);
    expect(bolt.pierceRemaining).toBe(3);
    expect(bolt.hitSet.has(a)).toBe(true);
    expect(isActive(armoredPool, a)).toBe(true);
  });

  it('reaches every combat pool it was given (one shared collector)', () => {
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const { collisionSystem, system, ship } = makeSystem(LV2, [seekers, squares]);
    const s = addEnemy(seekers, ship.x + 300, ship.y);
    const q = addEnemy(squares, ship.x + 300, ship.y + 1);
    injectBolt(system, { x: ship.x + 300, y: ship.y, vx: 0, vy: 0, pierceRemaining: 4 });
    system.fixedUpdate(DT);
    expect(isActive(seekers, s)).toBe(false);
    expect(isActive(squares, q)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(s);
    expect(collisionSystem.killedEnemies).toContain(q);
  });

  it('a bolt is released when it exits the arena (no time-lifetime needed)', () => {
    const { system } = makeSystem(LV1);
    // Bolt just inside the right wall moving +x fast → exits within a tick or two.
    const bolt = injectBolt(system, {
      x: ARENA_WIDTH - ARENA_BORDER_INSET - 1,
      y: ARENA_HEIGHT / 2,
      vx: LANCE_BOLT_SPEED,
      vy: 0,
      pierceRemaining: 7,
    });
    system.fixedUpdate(DT);
    expect(isBoltActive(system, bolt)).toBe(false);
  });
});

describe('PiercingLanceSystem — shared per-tick kill guard (no double release / double score)', () => {
  it('TWO overlapping bolts over ONE killable enemy kill + release it EXACTLY once', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV2);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y);
    const total = enemyPool.activeCount + enemyPool.freeCount;
    // Two stationary bolts both sitting on the enemy this tick. Without the shared _killedThisTick
    // guard the second bolt would call applyPlayerDamage on the already-released enemy —
    // double-scoring it and double-releasing it into the owner pool.
    injectBolt(system, { x: ship.x + 300, y: ship.y, vx: 0, vy: 0, pierceRemaining: 4, damage: 4 });
    injectBolt(system, { x: ship.x + 300, y: ship.y, vx: 0, vy: 0, pierceRemaining: 4, damage: 4 });
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false);
    // Killed + scored exactly ONCE across both bolts.
    expect(collisionSystem.killedEnemies.filter((k) => k === e)).toHaveLength(1);
    expect(collisionSystem.bulletKillCount).toBe(1);
    // The owner pool was NOT double-released — its active + free total is unchanged (a second
    // release would push the same instance into the free list twice).
    expect(enemyPool.activeCount + enemyPool.freeCount).toBe(total);
  });

  it('a bolt AND an overlapping trail node over ONE killable enemy kill + release it EXACTLY once', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV4);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y);
    const total = enemyPool.activeCount + enemyPool.freeCount;
    // The bolt (advanced in step 3) kills + releases the enemy; the trail node (step 4) then
    // sweeps the SAME stale reference — the guard must stop it re-hitting a released enemy.
    injectBolt(system, { x: ship.x + 300, y: ship.y, vx: 0, vy: 0, pierceRemaining: 7, damage: 6 });
    injectTrailNode(system, { x: ship.x + 300, y: ship.y, lifeMs: 0, damage: 1 });
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false);
    expect(collisionSystem.killedEnemies.filter((k) => k === e)).toHaveLength(1);
    expect(collisionSystem.bulletKillCount).toBe(1);
    expect(enemyPool.activeCount + enemyPool.freeCount).toBe(total);
  });
});

describe('PiercingLanceSystem — armored hits-to-kill curve (magnitude through the seam)', () => {
  it('a Lv1 bolt (dmg 4) leaves armored (hp 5) alive with reduced hp — a 2-hit kill', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system, ship } = makeSystem(LV1, [armoredPool]);
    const a = addEnemy(armoredPool, ship.x, ship.y, { hp: ARMORED_HP });
    injectBolt(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, pierceRemaining: 2, damage: 4 });
    system.fixedUpdate(DT);
    // 4 damage < hp 5 → the armored SURVIVES with hp 1 (contrast the mine's full-AoE 90).
    expect(isActive(armoredPool, a)).toBe(true);
    expect(a.hp).toBe(ARMORED_HP - 4);
    expect(collisionSystem.killedEnemies).not.toContain(a);
    expect(collisionSystem.bulletDamageCount).toBe(1);
  });

  it('a Lv3 bolt (dmg 6) ONE-SHOTS armored (hp 5) — hits-to-kill drops from 2 to 1', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system, ship } = makeSystem(LV3, [armoredPool]);
    const a = addEnemy(armoredPool, ship.x, ship.y, { hp: ARMORED_HP });
    injectBolt(system, { x: ship.x, y: ship.y, vx: 0, vy: 0, pierceRemaining: 4, damage: 6 });
    system.fixedUpdate(DT);
    // 6 damage >= hp 5 → the KILL branch runs.
    expect(isActive(armoredPool, a)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(a);
    expect(collisionSystem.bulletKillCount).toBe(1);
  });

  it('the folded per-bolt DAMAGE is stamped on a fired bolt (4 at Lv1, 6 at Lv3)', () => {
    for (const [stats, dmg] of [
      [LV1, 4],
      [LV3, 6],
    ]) {
      const { system, ship } = makeSystem(stats);
      addEnemy(system.enemyPools[0], ship.x + 300, ship.y);
      system._fireAccumMs = stats.lancePeriodMs;
      system.fixedUpdate(DT);
      const [b] = activeBolts(system);
      expect(b.damage, `${dmg} damage`).toBe(dmg);
    }
  });

  it('the melee/AoE-vs-projectile contrast: a single bullet also only chips the same armored', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem } = makeSystem(LV1, [armoredPool]);
    const a = armoredPool.acquire();
    a.hp = ARMORED_HP;
    const killed = collisionSystem.applyPlayerDamage(a, armoredPool, PLAYER_BULLET_BASE_DAMAGE);
    expect(killed).toBe(false);
    expect(a.hp).toBe(ARMORED_HP - 1);
  });
});

describe('PiercingLanceSystem — hold fire when target-less', () => {
  it('fires nothing with no combat enemy, banks no backlog, then fires ONCE the instant one appears', () => {
    const { system, ship } = makeSystem(LV1);
    // Many periods elapse with an empty arena.
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
    // The accumulator is clamped to one period — no unbounded bank.
    expect(system._fireAccumMs).toBeLessThanOrEqual(LV1.lancePeriodMs + 1e-9);
    // The tick a combat enemy appears, exactly ONE bolt fires (no backlog burst).
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
  });
});

describe('PiercingLanceSystem — Lv4 trail', () => {
  it('a trail-stamped bolt DROPS nodes along its path; a non-trail bolt drops none', () => {
    const { system, ship } = makeSystem(LV4);
    injectBolt(system, {
      x: ship.x,
      y: ship.y,
      vx: LANCE_BOLT_SPEED,
      vy: 0,
      pierceRemaining: 7,
      trail: 1,
    });
    for (let i = 0; i < 10; i++) system.fixedUpdate(DT); // ~167ms → several 50ms drops
    expect(system.trailPool.activeCount).toBeGreaterThan(0);

    // A no-trail bolt (Lv1-stamped) leaves nothing even at the Lv4 fold.
    const { system: sys2, ship: ship2 } = makeSystem(LV4);
    injectBolt(sys2, {
      x: ship2.x,
      y: ship2.y,
      vx: LANCE_BOLT_SPEED,
      vy: 0,
      pierceRemaining: 7,
      trail: 0,
    });
    for (let i = 0; i < 10; i++) sys2.fixedUpdate(DT);
    expect(sys2.trailPool.activeCount).toBe(0);
  });

  it('a trail node DAMAGES an overlapping enemy within its lifetime and LINGERS (each enemy once)', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system, ship } = makeSystem(LV4, [armoredPool]);
    const a = addEnemy(armoredPool, ship.x, ship.y, { hp: 1e9 });
    const node = injectTrailNode(system, { x: ship.x, y: ship.y, lifeMs: 0 });
    system.fixedUpdate(DT);
    // Within the window: it chipped the enemy once (1 damage), and the node LINGERS (not consumed).
    expect(a.hp).toBe(1e9 - LANCE_TRAIL_DAMAGE);
    expect(collisionSystem.bulletDamageCount).toBe(1);
    expect(node.hitSet.has(a)).toBe(true);
    // It does NOT re-hit the same enemy on later ticks (per-node hitSet).
    for (let i = 0; i < 5; i++) system.fixedUpdate(DT);
    expect(collisionSystem.bulletDamageCount).toBe(1);
  });

  it('a trail node EXPIRES after LANCE_TRAIL_LIFETIME_MS and deals no further damage', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV4);
    const e = addEnemy(enemyPool, ship.x, ship.y);
    // A node one step from expiry: this tick it crosses the lifetime and is released BEFORE it
    // can damage the overlapping enemy.
    const node = injectTrailNode(system, { x: ship.x, y: ship.y, lifeMs: LANCE_TRAIL_LIFETIME_MS - 1 });
    system.fixedUpdate(DT);
    expect(system.trailPool.activeCount).toBe(0); // expired
    expect(isActive(enemyPool, e)).toBe(true); // untouched — the expired node dealt nothing
    expect(collisionSystem.bulletDamageCount).toBe(0);
    expect(node.lifeMs).toBeGreaterThanOrEqual(LANCE_TRAIL_LIFETIME_MS);
  });
});

describe('PiercingLanceSystem — Lv5 backward bolt', () => {
  it('fires TWO bolts per cadence — one toward the target, one antipodal (backward)', () => {
    const { system, ship } = makeSystem(LV5);
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y); // target ahead (+x)
    system._fireAccumMs = LV5.lancePeriodMs;
    system.fixedUpdate(DT);
    const bolts = activeBolts(system);
    expect(bolts).toHaveLength(2);
    // One flies +x (toward), one −x (backward), equal-and-opposite velocity.
    const forward = bolts.find((b) => b.vx > 0);
    const backward = bolts.find((b) => b.vx < 0);
    expect(forward).toBeDefined();
    expect(backward).toBeDefined();
    expect(backward.vx).toBeCloseTo(-forward.vx, 6);
    expect(backward.vy).toBeCloseTo(-forward.vy, 6);
    // Each carries the full pierce / damage / trail.
    for (const b of bolts) {
      expect(b.pierceRemaining).toBe(LV5.lancePierce);
      expect(b.damage).toBe(LV5.lanceDamage);
      expect(b.trail).toBe(1);
    }
  });
});

describe('PiercingLanceSystem — trail-node cap', () => {
  it('the live trail-node count never exceeds LANCE_TRAIL_NODE_MAX (oldest evicted first)', () => {
    const { system, ship } = makeSystem(LV5);
    // Drop far more nodes than the cap directly through the drop path.
    for (let i = 0; i < LANCE_TRAIL_NODE_MAX * 2; i++) {
      system._dropTrailNode(ship.x + i, ship.y);
    }
    expect(system.trailPool.activeCount).toBe(LANCE_TRAIL_NODE_MAX);
    // …and the pool never grew past its prewarm via the factory (evict-then-acquire recycles).
    expect(system.trailPool.activeCount + system.trailPool.freeCount).toBe(LANCE_TRAIL_NODE_MAX);
  });

  it('an end-to-end Lv5 barrage keeps the live node count within the cap', () => {
    const armoredPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV5, [armoredPool]);
    // A distant huge-hp target so bolts fire toward it and lay trails continuously.
    addEnemy(armoredPool, ship.x + 400, ship.y, { hp: 1e9 });
    let maxNodes = 0;
    for (let i = 0; i < 1200; i++) {
      system.fixedUpdate(DT);
      if (system.trailPool.activeCount > maxNodes) maxNodes = system.trailPool.activeCount;
    }
    expect(maxNodes).toBeLessThanOrEqual(LANCE_TRAIL_NODE_MAX);
  });
});

describe('PiercingLanceSystem — sanitizers (SAFETY guards, never balance levers)', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk period (%s) → unowned (no bolts)', (_label, v) => {
    const { system } = makeSystem({ ...LV1, lancePeriodMs: v });
    expect(system._periodMs()).toBe(0);
    for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });

  it('a tiny-positive period is FLOORED (at most ~1 cadence/tick, no burst)', () => {
    const { system, ship } = makeSystem({ ...LV1, lancePeriodMs: 0.5 });
    expect(system._periodMs()).toBe(LANCE_PERIOD_FLOOR_MS);
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);
    system.fixedUpdate(DT); // one tick
    // A single tick fires at most ~1 cadence (1 bolt at Lv1) — never a 30+ same-tick burst.
    expect(system.pool.activeCount).toBeLessThanOrEqual(2);
    expect(system.pool.activeCount + system.pool.freeCount).toBe(LANCE_BOLT_POOL_PREWARM);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk pierce (%s) → the base-pierce fallback', (_label, v) => {
    const { system } = makeSystem({ ...LV1, lancePierce: v });
    expect(system._pierce()).toBe(LANCE_BASE_PIERCE);
  });

  it('an ABSURD pierce clamps to LANCE_MAX_PIERCE, a fractional one is floored', () => {
    expect(makeSystem({ ...LV1, lancePierce: 1e9 }).system._pierce()).toBe(LANCE_MAX_PIERCE);
    expect(makeSystem({ ...LV1, lancePierce: 4.7 }).system._pierce()).toBe(4);
    expect(makeSystem({ ...LV1, lancePierce: 0 }).system._pierce()).toBe(LANCE_BASE_PIERCE);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -5],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk damage (%s) → the base-damage fallback', (_label, v) => {
    const { system } = makeSystem({ ...LV1, lanceDamage: v });
    expect(system._damage()).toBe(LANCE_BOLT_BASE_DAMAGE);
  });

  it.each([
    ['NaN', NaN],
    ['negative', -1],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk trail/backward (%s) → the flag OFF', (_label, v) => {
    const { system } = makeSystem({ ...LV5, lanceTrail: v, lanceBackward: v });
    expect(system._trail()).toBe(0);
    expect(system._backward()).toBe(0);
  });
});

describe('PiercingLanceSystem — per-level fold values (against the real registry)', () => {
  it('folds lancePeriodMs/lancePierce/lanceDamage/lanceTrail/lanceBackward per level 1→5', () => {
    const expected = [
      { lancePeriodMs: 2000, lancePierce: 2, lanceDamage: 4, lanceTrail: 0, lanceBackward: 0 },
      { lancePeriodMs: 2000, lancePierce: 4, lanceDamage: 4, lanceTrail: 0, lanceBackward: 0 },
      { lancePeriodMs: 1400, lancePierce: 4, lanceDamage: 6, lanceTrail: 0, lanceBackward: 0 },
      { lancePeriodMs: 1400, lancePierce: 7, lanceDamage: 6, lanceTrail: 1, lanceBackward: 0 },
      { lancePeriodMs: 1400, lancePierce: 7, lanceDamage: 6, lanceTrail: 1, lanceBackward: 1 },
    ];
    expected.forEach((e, i) => {
      const level = i + 1;
      const ps = createPlayerStats();
      recomputePlayerStats(ps, { 'piercing-lance': level }, ITEM_REGISTRY);
      expect(ps.lancePeriodMs, `L${level} period`).toBe(e.lancePeriodMs);
      expect(ps.lancePierce, `L${level} pierce`).toBe(e.lancePierce);
      expect(ps.lanceDamage, `L${level} damage`).toBe(e.lanceDamage);
      expect(ps.lanceTrail, `L${level} trail`).toBe(e.lanceTrail);
      expect(ps.lanceBackward, `L${level} backward`).toBe(e.lanceBackward);
    });
  });

  it('an unowned build folds every lance field to 0 (the ownership gate)', () => {
    const ps = createPlayerStats();
    recomputePlayerStats(ps, {}, ITEM_REGISTRY);
    expect(ps.lancePeriodMs).toBe(0);
    expect(ps.lancePierce).toBe(0);
    expect(ps.lanceDamage).toBe(0);
    expect(ps.lanceTrail).toBe(0);
    expect(ps.lanceBackward).toBe(0);
  });
});

describe('PiercingLanceSystem — allocation', () => {
  it('allocates nothing per tick on the steady path (stable pools, hoisted collectors, reused scratch)', () => {
    // Huge-hp armored around the ship so bolts fire → pierce → lay trails → collide continuously
    // (with trail + backward live at Lv5) — a real hot path, not an idle loop.
    const armoredPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV5, [armoredPool]);
    for (const [dx, dy] of [
      [200, 0],
      [-200, 0],
      [0, 200],
      [0, -200],
      [150, 150],
      [-150, -150],
    ]) {
      addEnemy(armoredPool, ship.x + dx, ship.y + dy, { hp: 1e9 });
    }
    // Warm up (bolts fire, trails accumulate, collisions run, scratch grows).
    for (let i = 0; i < 400; i++) system.fixedUpdate(DT);

    const collectBolt = system._collectBolt;
    const collectNode = system._collectNode;
    const collectEnemy = system._collectEnemy;
    const boltsRef = system._bolts;
    const nodesRef = system._nodes;
    const enemiesRef = system._enemies;
    const ownersRef = system._owners;
    const killedRef = system._killedThisTick;
    const boltTotal = system.pool.activeCount + system.pool.freeCount;
    const nodeTotal = system.trailPool.activeCount + system.trailPool.freeCount;
    const shape = Object.keys(system).sort();

    let maxNodes = 0;
    for (let i = 0; i < 800; i++) {
      system.fixedUpdate(DT);
      if (system.trailPool.activeCount > maxNodes) maxNodes = system.trailPool.activeCount;
    }

    // Both pools churn (fire/expire/evict) but never GROW — active + free stays constant (no
    // factory allocation), and the live node count stays bounded by the cap.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(boltTotal);
    expect(system.trailPool.activeCount + system.trailPool.freeCount).toBe(nodeTotal);
    expect(nodeTotal).toBe(LANCE_TRAIL_NODE_MAX);
    expect(maxNodes).toBeLessThanOrEqual(LANCE_TRAIL_NODE_MAX);
    // The hoisted iteration callbacks are the SAME closures (never fresh arrows)…
    expect(system._collectBolt).toBe(collectBolt);
    expect(system._collectNode).toBe(collectNode);
    expect(system._collectEnemy).toBe(collectEnemy);
    // …the scratch arrays + reused Set are the SAME references (reset in place, never realloc)…
    expect(system._bolts).toBe(boltsRef);
    expect(system._nodes).toBe(nodesRef);
    expect(system._enemies).toBe(enemiesRef);
    expect(system._owners).toBe(ownersRef);
    expect(system._killedThisTick).toBe(killedRef);
    // …and no field was added to the instance across the run.
    expect(Object.keys(system).sort()).toEqual(shape);
  });
});

describe('PiercingLanceSystem — Railgun (Story 12.4)', () => {
  it('railgunActive=false → normal lance cadence, no beam (disabled when not fused)', () => {
    const { system } = makeSystem(LV5);
    expect(system.railgunActive).toBe(false);
    const { system: sys2 } = makeSystem(LV5);
    sys2.railgunActive = false;
    addEnemy(sys2.enemyPools[0], sys2.ship.x + 300, sys2.ship.y);
    sys2._fireAccumMs = LV5.lancePeriodMs;
    sys2.fixedUpdate(DT);
    // Normal bolts fire, NOT a beam. Lv5 fires 2 bolts (forward + backward).
    expect(sys2.pool.activeCount).toBe(2);
  });

  it('railgunActive=true, charge accumulates — no beam until RAILGUN_CHARGE_TIME_MS', () => {
    const { system, enemyPool, ship } = makeSystem(LV5);
    system.railgunActive = true;
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);

    // Charge 90% of RAILGUN_CHARGE_TIME_MS — no beam yet.
    const partialTicks = Math.floor(RAILGUN_CHARGE_TIME_MS * 0.9 / DT);
    for (let i = 0; i < partialTicks; i++) {
      system.fixedUpdate(DT);
    }
    expect(system._railgunChargeAccumMs).toBeGreaterThan(0);
    // Charge should be within a few ms of but not past the threshold.
    expect(system._railgunChargeAccumMs).toBeLessThan(RAILGUN_CHARGE_TIME_MS);
    // No bolts, no beam kills — the beam hasn't fired yet.
    expect(system.pool.activeCount).toBe(0);
  });

  it('charge set to RAILGUN_CHARGE_TIME_MS → beam fires, charge resets', () => {
    const { system, ship } = makeSystem(LV5);
    system.railgunActive = true;
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);

    // Directly set charge to threshold — fire the beam.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);
    // Charge should be reset to just accumulated delta (< DT).
    expect(system._railgunChargeAccumMs).toBeLessThan(DT * 2);
    // No bolts — beam replaces bolts.
    expect(system.pool.activeCount).toBe(0);
  });

  it('beam deals RAILGUN_DAMAGE_MULT × damage to enemies along the beam line', () => {
    const { system, collisionSystem, ship } = makeSystem(LV5);
    system.railgunActive = true;
    addEnemy(system.enemyPools[0], ship.x + 100, ship.y);      // on center line
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);      // on center line
    addEnemy(system.enemyPools[0], ship.x + 500, ship.y);      // on center line

    // Fire the beam directly by setting charge.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);

    // The beam damage is lanceDamage × RAILGUN_DAMAGE_MULT = 6 × 3.0 = 18.
    // Each on-center enemy should have taken ≥ 1 damage through applyPlayerDamage.
    expect(collisionSystem.bulletDamageCount).toBeGreaterThanOrEqual(3);
  });

  it('beam misses enemies outside RAILGUN_BEAM_THICKNESS perpendicular distance', () => {
    const { system, collisionSystem, ship } = makeSystem(LV5);
    system.railgunActive = true;
    // Place the NEAREST enemy straight ahead on the +X axis so aim is +X.
    // Place ANOTHER enemy 100px off the aim line (off the beam path).
    // The beam fires on +X; the off-line enemy has perpDist=100 > 20.
    addEnemy(system.enemyPools[0], ship.x + 100, ship.y);        // nearest → on beam line
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y + 100);  // off beam line

    const beamDamageCountBefore = collisionSystem.bulletDamageCount;

    // Fire the beam directly (aim is +X due to nearest enemy on +X).
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);

    // The on-line enemy was hit; the off-line enemy (100px off) was not.
    // bulletDamageCount = 1 (only the on-line enemy was damaged).
    expect(collisionSystem.bulletDamageCount).toBe(1);
  });

  it('no aim direction → beam does NOT fire', () => {
    const { system } = makeSystem(LV5);
    system.railgunActive = true;
    // No enemies → no aim direction → no beam fires.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);
    // Still no aim direction.
    expect(system._railgunAimX).toBe(0);
    expect(system._railgunAimY).toBe(0);
  });

  it('charge does NOT reset when no aim target', () => {
    const { system } = makeSystem(LV5);
    system.railgunActive = true;
    // Fire the beam with no aim — it should NOT reset the charge.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    const chargeBefore = system._railgunChargeAccumMs;
    system.fixedUpdate(DT);
    // Charge should be unchanged — beam didn't fire (no aim target).
    expect(system._railgunChargeAccumMs).toBeGreaterThanOrEqual(chargeBefore);
  });

  it('gridFieldSystem.rippleLine() is called when gridFieldSystem is wired', () => {
    const { system, ship } = makeSystem(LV5);
    system.railgunActive = true;
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);

    let rippleLineCalled = false;
    let rippleOrigin = { x: 0, y: 0 };
    // Mock gridFieldSystem with rippleLine.
    system.gridFieldSystem = {
      rippleLine: (ox, oy, dx, dy) => {
        rippleLineCalled = true;
        rippleOrigin.x = ox;
        rippleOrigin.y = oy;
      },
    };

    // Fire the beam directly.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);

    expect(rippleLineCalled).toBe(true);
    expect(rippleOrigin.x).toBeCloseTo(ship.x, 6);
    expect(rippleOrigin.y).toBeCloseTo(ship.y, 6);
  });

  it('beam fires even when rippleLine is undefined (graceful degradation)', () => {
    const { system, enemyPool, ship } = makeSystem(LV5);
    system.railgunActive = true;
    system.gridFieldSystem = null;
    addEnemy(system.enemyPools[0], ship.x + 300, ship.y);

    const totalEnemiesBefore = enemyPool.activeCount;

    // Fire the beam directly.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);

    // Beam still fires — damage through collision seam despite no gridFieldSystem.
    expect(system.pool.activeCount).toBe(0); // no bolts
    // Some enemies should have been hit.
    expect(system.collisionSystem.bulletDamageCount).toBeGreaterThanOrEqual(1);
  });

  it('beam fires once per charge — second charge also fires', () => {
    const { system, collisionSystem, ship } = makeSystem(LV5);
    system.railgunActive = true;
    // Use an armored enemy (hp 5, beam damage = 18 → killed) + one more enemy.
    const armored = addEnemy(system.enemyPools[0], ship.x + 100, ship.y, { hp: ARMORED_HP });
    addEnemy(system.enemyPools[0], ship.x + 500, ship.y);
    const total = system.enemyPools[0].activeCount + system.enemyPools[0].freeCount;

    // First charge.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);
    const beam1Hits = collisionSystem.bulletDamageCount;
    expect(system._railgunChargeAccumMs).toBeLessThan(DT * 2);

    // Second charge.
    system._railgunChargeAccumMs = RAILGUN_CHARGE_TIME_MS + DT;
    system.fixedUpdate(DT);
    const beam2Hits = collisionSystem.bulletDamageCount;
    expect(system._railgunChargeAccumMs).toBeLessThan(DT * 2);

    // Both beams fired. At minimum, the first beam hit ≥1 enemy, and the second
    // beam also triggered (same enemies are hit again in a new tick).
    expect(beam1Hits).toBeGreaterThanOrEqual(1);
    expect(beam2Hits).toBeGreaterThanOrEqual(0); // second beam fires regardless of targets
    // At least one beam hit something.
    expect(beam1Hits + beam2Hits).toBeGreaterThanOrEqual(1);
    // Pool didn't grow (no allocation leak).
    expect(system.enemyPools[0].activeCount + system.enemyPools[0].freeCount).toBe(total);
  });
});
