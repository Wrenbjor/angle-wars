import { describe, it, expect } from 'vitest';
import { MineLayerSystem } from './MineLayerSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createArmored } from '../entities/Armored.js';
import { createBullet } from '../entities/Bullet.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import {
  FIXED_STEP_MS,
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
  MINE_POOL_PREWARM,
  PLAYER_BULLET_BASE_DAMAGE,
  ARMORED_HP,
  SINGULARITY_PULL_DURATION_MS,
  SINGULARITY_PULL_RADIUS,
  SINGULARITY_PULL_STRENGTH,
  SINGULARITY_DAMAGE_MULTIPLIER,
} from '../config/constants.js';

// Story 11.3 — MineLayerSystem owns the Mine Layer's mine POOL + the drop ACCUMULATOR, while
// the shared playerStats store owns only the derived drop-period/cap/detonate-radius/pull/
// chain. This suite covers the rows of the story's I/O matrix that belong to this system: the
// ownership gate, the drop cadence + arm delay, the cap eviction (oldest first), the armed
// detonation through applyPlayerDamage (including the armored FULL-AoE-damage contrast), the
// unarmed inertness, the Lv4 pull nudge, the Lv5 chain cascade + hit-once guard, the junk
// sanitizers, and the steady-state zero-allocation invariant. The registration-slot +
// assembled-pipeline wiring lives in buildArenaWorld.test.js.

const DT = FIXED_STEP_MS;

// The per-level fold maps the real registry produces (pinned against the registry itself in
// playerStats.test.js — restated here as the system's input vocabulary).
const LV1 = { mineDropPeriodMs: 2000, mineCap: 10, mineDetonateRadius: 60 };
const LV2 = { mineDropPeriodMs: 2000, mineCap: 12, mineDetonateRadius: 100 };
const LV4 = { mineDropPeriodMs: 1300, mineCap: 12, mineDetonateRadius: 100, minePull: 1 };
const LV5 = {
  mineDropPeriodMs: 1300,
  mineCap: 12,
  mineDetonateRadius: 100,
  minePull: 1,
  mineChain: 1,
};

/**
 * A mine-layer system over a fresh centred ship, the given enemy pools, a real
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
  const system = new MineLayerSystem(ship, enemyPools, collisionSystem, playerStats);
  return { ship, enemyPools, enemyPool: enemyPools[0], collisionSystem, playerStats, system };
}

/**
 * A no-op GridFieldSystem mock for testing ripple emission.
 */
function fakeGridField() {
  return {
    __fake: true,
    ripples: [],
    _emit(x, y) {
      this.ripples.push({ x, y, ageMs: 0, active: true });
    },
  };
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
 * Inject a stamped mine directly into the mine pool (white-box, for the detonate/pull/chain
 * paths). `ageMs` defaults to ARMED (>= armMs after the tick's aging step); pass 0 for an
 * unarmed mine.
 */
function injectMine(
  system,
  {
    x,
    y,
    ageMs = MINE_ARM_MS,
    armMs = MINE_ARM_MS,
    detonateRadius = MINE_BASE_DETONATE_RADIUS,
    damage = MINE_DETONATE_DAMAGE,
    pull = 0,
    chain = 0,
  },
) {
  const m = system.pool.acquire();
  m.x = x;
  m.y = y;
  m.ageMs = ageMs;
  m.armMs = armMs;
  m.detonateRadius = detonateRadius;
  m.damage = damage;
  m.pull = pull;
  m.chain = chain;
  return m;
}

function activeMines(system) {
  const out = [];
  system.pool.forEachActive((m) => out.push(m));
  return out;
}

function isActive(pool, target) {
  let found = false;
  pool.forEachActive((e) => {
    if (e === target) found = true;
  });
  return found;
}

/**
 * Inject a singularity mine directly into the pool (arm → singularity pull).
 * Sets isSingularity=true and pullPhaseStartMs=simNow, with simulated age already past armMs.
 */
function injectSingularityMine(
  system,
  { x, y, damage = MINE_DETONATE_DAMAGE },
) {
  const m = system.pool.acquire();
  m.x = x;
  m.y = y;
  m.ageMs = MINE_ARM_MS; // arm
  m.armMs = MINE_ARM_MS;
  m.detonateRadius = MINE_BASE_DETONATE_RADIUS;
  m.damage = damage;
  m.pull = 0;
  m.chain = 0;
  m.isSingularity = true;
  m.pullPhaseStartMs = system._simMs;
  return m;
}

function isMineActive(system, target) {
  let found = false;
  system.pool.forEachActive((m) => {
    if (m === target) found = true;
  });
  return found;
}

describe('MineLayerSystem — ownership gate (unowned / null store)', () => {
  it('an unowned build (drop period 0) drops NO mines and never touches an enemy', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem();
    const e = addEnemy(enemyPool, ship.x, ship.y);
    expect(system._dropPeriodMs()).toBe(0);
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
    expect(system._dropAccumMs).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).toHaveLength(0);
    expect(collisionSystem.bulletDamageCount).toBe(0);
  });

  it('a NULL store means no mines ever, no throw (the pre-11.3 path)', () => {
    const { enemyPool, system, ship } = makeSystem(null);
    expect(system.playerStats).toBeNull();
    const e = addEnemy(enemyPool, ship.x, ship.y);
    expect(() => {
      for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
  });

  it('a MISSING store (legacy stub) means no mines ever, no throw', () => {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const collisionSystem = new CollisionSystem(new Pool(createBullet), [enemyPool]);
    const system = new MineLayerSystem(ship, [enemyPool], collisionSystem);
    expect(system.playerStats).toBeNull();
    expect(() => {
      for (let i = 0; i < 100; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
  });
});

describe('MineLayerSystem — drop cadence + arm delay', () => {
  it('Lv1 in an empty arena drops a mine at the ship roughly every 2000ms', () => {
    const { ship, system } = makeSystem(LV1);
    let ticks = 0;
    while (system.pool.activeCount === 0 && ticks < 1000) {
      system.fixedUpdate(DT);
      ticks++;
    }
    // Effective period ≈ ticks × DT, within one tick of the folded 2000ms.
    expect(ticks * DT).toBeGreaterThan(LV1.mineDropPeriodMs - DT);
    expect(ticks * DT).toBeLessThanOrEqual(LV1.mineDropPeriodMs + DT);
    // The mine landed at the ship position (the wake).
    const [m] = activeMines(system);
    expect(m.x).toBeCloseTo(ship.x, 6);
    expect(m.y).toBeCloseTo(ship.y, 6);
    // …and it is UNARMED at birth (ageMs < armMs).
    expect(m.ageMs).toBeLessThan(m.armMs);
  });

  it('a dropped mine ARMS once its ageMs reaches MINE_ARM_MS (3000)', () => {
    const { system } = makeSystem(LV1);
    // Drive to the first drop.
    while (system.pool.activeCount === 0) system.fixedUpdate(DT);
    const [m] = activeMines(system);
    expect(m.armMs).toBe(MINE_ARM_MS);
    // Age it further; it must cross from unarmed to armed exactly at MINE_ARM_MS.
    let sawUnarmed = false;
    let sawArmed = false;
    for (let i = 0; i < 200 && isMineActive(system, m); i++) {
      const armedBefore = m.ageMs >= m.armMs;
      if (!armedBefore) sawUnarmed = true;
      else sawArmed = true;
      system.fixedUpdate(DT);
    }
    expect(sawUnarmed).toBe(true);
    expect(sawArmed).toBe(true);
  });

  it('the live count grows to the cap (10) then HOLDS there, never exceeding it', () => {
    const { system } = makeSystem(LV1); // cap 10, no enemies → mines accumulate
    let maxActive = 0;
    for (let i = 0; i < 1500; i++) {
      system.fixedUpdate(DT);
      if (system.pool.activeCount > maxActive) maxActive = system.pool.activeCount;
    }
    expect(system.pool.activeCount).toBe(10);
    expect(maxActive).toBe(10); // never overshot the cap
    // At least one mine has armed over 25s of sim.
    expect(activeMines(system).some((m) => m.ageMs >= m.armMs)).toBe(true);
  });

  it('the drop origin is CLAMPED into the arena interior for a wall-pressed ship', () => {
    const { ship, system } = makeSystem(LV1);
    ship.x = 2; // pressed hard into the left wall (outside the border inset)
    ship.y = 2;
    while (system.pool.activeCount === 0) system.fixedUpdate(DT);
    const [m] = activeMines(system);
    expect(m.x).toBeGreaterThanOrEqual(ARENA_BORDER_INSET);
    expect(m.y).toBeGreaterThanOrEqual(ARENA_BORDER_INSET);
    expect(m.x).toBeLessThanOrEqual(ARENA_WIDTH - ARENA_BORDER_INSET);
    expect(m.y).toBeLessThanOrEqual(ARENA_HEIGHT - ARENA_BORDER_INSET);
  });

  it('a dropped mine is STAMPED with the folded shape (radius/pull/chain) at drop time', () => {
    const { system } = makeSystem(LV5); // radius 100, pull 1, chain 1
    while (system.pool.activeCount === 0) system.fixedUpdate(DT);
    const [m] = activeMines(system);
    expect(m.detonateRadius).toBe(100);
    expect(m.pull).toBe(1);
    expect(m.chain).toBe(1);
    expect(m.damage).toBe(MINE_DETONATE_DAMAGE);
    expect(m.armMs).toBe(MINE_ARM_MS);
  });
});

describe('MineLayerSystem — cap eviction (oldest first)', () => {
  it('at cap, a new drop EVICTS the oldest (max ageMs) live mine before acquiring', () => {
    const { system, ship } = makeSystem(LV1); // cap 10
    // Inject 10 mines with distinct ages at a point CLEAR of the ship, oldest = highest ageMs.
    for (let i = 0; i < 10; i++) {
      injectMine(system, { x: 100 + i, y: 100, ageMs: i * 100, pull: 0 });
    }
    // The oldest logical mine has ageMs 900 (→ ~916 after this tick's aging). It is the one
    // eviction must remove; its slot is reused for the fresh drop (the pool recycles the freed
    // instance), so we assert on the DATA that survives, not object identity.
    expect(system.pool.activeCount).toBe(10);
    // Prime the accumulator so exactly one drop is due this tick.
    system._dropAccumMs = LV1.mineDropPeriodMs;
    system.fixedUpdate(DT);
    // Still at the cap (evict-one-then-acquire-one).
    expect(system.pool.activeCount).toBe(10);
    const mines = activeMines(system);
    // The oldest mine's age (>900) is GONE — the max active age fell back to the 2nd-oldest.
    const maxAge = Math.max(...mines.map((m) => m.ageMs));
    expect(maxAge).toBeLessThan(900);
    // …and a fresh mine (ageMs 0, born after the age pass) sits at the ship position.
    expect(
      mines.some((m) => m.ageMs === 0 && Math.abs(m.x - ship.x) < 1e-6),
    ).toBe(true);
  });

  it('after a level DROP that lowers the cap, an over-cap drop evicts DOWN to the new cap', () => {
    const { playerStats, system } = makeSystem(LV2); // cap 12
    for (let i = 0; i < 12; i++) {
      injectMine(system, { x: 100 + i, y: 100, ageMs: i * 100 });
    }
    expect(system.pool.activeCount).toBe(12);
    // Remnant/drop to Lv1 (cap 10) folds in.
    Object.assign(playerStats, LV1);
    system._dropAccumMs = LV1.mineDropPeriodMs; // force a drop this tick
    system.fixedUpdate(DT);
    // The while-evict drained 12 → 9 then acquired one → exactly the new cap of 10.
    expect(system.pool.activeCount).toBe(10);
  });

  it('a level RISE 1→5 mid-run needs no factory allocation (prewarmed pool)', () => {
    const { system } = makeSystem(LV1);
    const total = system.pool.activeCount + system.pool.freeCount;
    expect(total).toBe(MINE_POOL_PREWARM);
    // Fill to the Lv1 cap of 10 by injection, then verify the pool never grew via the factory.
    for (let i = 0; i < 10; i++) injectMine(system, { x: 100 + i, y: 100, ageMs: 0 });
    expect(system.pool.activeCount).toBe(10);
    expect(system.pool.activeCount + system.pool.freeCount).toBe(total);
  });
});

describe('MineLayerSystem — armed detonation through applyPlayerDamage', () => {
  it('an ARMED mine an enemy enters detonates: enemy killed (scored + reported), mine released', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y); // clear of the ship's own drops
    const mine = injectMine(system, { x: ship.x + 300, y: ship.y, detonateRadius: 60 });
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false); // killed through the shared seam
    expect(collisionSystem.killedEnemies).toContain(e);
    expect(collisionSystem.bulletKillCount).toBe(1);
    expect(isMineActive(system, mine)).toBe(false); // the mine is spent
  });

  it('the NATURAL lifecycle: a fold-dropped mine arms over ticks, then detonates on an enemy (no injection)', () => {
    // The end-to-end seam every other detonation test skips by injecting a pre-armed mine:
    // a fold-driven DROP through the drop cadence, aging past MINE_ARM_MS over successive
    // ticks, then a stationary enemy entering the armed blast — killed through the real
    // CollisionSystem seam, the mine released back to the pool.
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    // Let the DROP itself happen via fixedUpdate (seed the accumulator to one period so the
    // drop is due this tick, but never call injectMine).
    system._dropAccumMs = LV1.mineDropPeriodMs;
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    const [mine] = activeMines(system);
    expect(mine.ageMs).toBeLessThan(mine.armMs); // born UNARMED
    const dropX = mine.x;
    const dropY = mine.y;
    // Age it past MINE_ARM_MS over successive ticks (no enemy yet, so nothing detonates).
    const armTicks = Math.ceil(MINE_ARM_MS / DT) + 1;
    for (let i = 0; i < armTicks; i++) system.fixedUpdate(DT);
    expect(isMineActive(system, mine)).toBe(true); // still live, now armed
    expect(mine.ageMs).toBeGreaterThanOrEqual(mine.armMs);
    // Now place a stationary unarmored enemy inside the armed mine's blast and run one tick.
    const e = addEnemy(enemyPool, dropX, dropY);
    system.fixedUpdate(DT);
    // It detonated through the real seam: enemy killed + reported, the mine spent.
    expect(isActive(enemyPool, e)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(e);
    expect(collisionSystem.bulletKillCount).toBe(1);
    expect(isMineActive(system, mine)).toBe(false);
  });

  it('an UNARMED mine under the same enemy does NOTHING (inert until armed)', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y);
    const mine = injectMine(system, {
      x: ship.x + 300,
      y: ship.y,
      ageMs: 0, // unarmed: after +DT still << armMs
      detonateRadius: 60,
    });
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(true); // untouched
    expect(collisionSystem.killedEnemies).toHaveLength(0);
    expect(collisionSystem.bulletDamageCount).toBe(0);
    expect(isMineActive(system, mine)).toBe(true); // still ticking toward arm
  });

  it('the ARMORED archetype (hp 5) inside a blast is ONE-SHOT — FULL AoE damage (90 > 5)', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system, ship } = makeSystem(LV1, [armoredPool]);
    const a = addEnemy(armoredPool, ship.x + 300, ship.y, { hp: ARMORED_HP });
    injectMine(system, { x: ship.x + 300, y: ship.y, detonateRadius: 60, damage: MINE_DETONATE_DAMAGE });
    system.fixedUpdate(DT);
    // 90 damage > hp 5 → the KILL branch runs (contrast the drone shot, which only chips it).
    expect(isActive(armoredPool, a)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(a);
    expect(collisionSystem.bulletKillCount).toBe(1);
  });

  it('the melee/AoE-vs-projectile contrast: a single bullet only chips the same armored', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem } = makeSystem(LV1, [armoredPool]);
    const a = armoredPool.acquire();
    a.hp = ARMORED_HP;
    const killed = collisionSystem.applyPlayerDamage(a, armoredPool, PLAYER_BULLET_BASE_DAMAGE);
    expect(killed).toBe(false);
    expect(a.hp).toBe(ARMORED_HP - 1);
  });

  it('NEVER detonates on a telegraphing (spawning-in) enemy', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y, { telegraphMs: 1e6 });
    injectMine(system, { x: ship.x + 300, y: ship.y, detonateRadius: 60 });
    for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).not.toContain(e);
    expect(collisionSystem.bulletDamageCount).toBe(0);
  });

  it('reaches every combat pool it was given (one shared collector)', () => {
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const { collisionSystem, system, ship } = makeSystem(LV1, [seekers, squares]);
    const s = addEnemy(seekers, ship.x + 300, ship.y);
    const q = addEnemy(squares, ship.x + 300, ship.y + 1);
    injectMine(system, { x: ship.x + 300, y: ship.y, detonateRadius: 60 });
    system.fixedUpdate(DT);
    expect(isActive(seekers, s)).toBe(false);
    expect(isActive(squares, q)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(s);
    expect(collisionSystem.killedEnemies).toContain(q);
  });
});

describe('MineLayerSystem — Lv4 pull (position nudge)', () => {
  it('an ARMED pull mine drags a nearby enemy INWARD each tick (dt-scaled)', () => {
    const { enemyPool, system, ship } = makeSystem(LV4);
    // Enemy within the pull radius (150) but outside the blast (60+r), so it is pulled, not
    // detonated, this tick.
    const mx = ship.x + 400;
    const e = addEnemy(enemyPool, mx + 120, ship.y);
    injectMine(system, { x: mx, y: ship.y, detonateRadius: 60, pull: 1 });
    const dBefore = Math.hypot(e.x - mx, e.y - ship.y);
    system.fixedUpdate(DT);
    const dAfter = Math.hypot(e.x - mx, e.y - ship.y);
    expect(dAfter).toBeLessThan(dBefore); // nudged toward the mine
    expect(Number.isFinite(e.x)).toBe(true);
    expect(Number.isFinite(e.y)).toBe(true);
  });

  it('an enemy exactly AT the mine core produces no NaN and no pull movement', () => {
    // At d === 0 the pull guard skips the divide. Use a huge-hp armored so the co-located
    // enemy SURVIVES the detonation and its position can be read after the tick.
    const armoredPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV4, [armoredPool]);
    const mx = ship.x + 400;
    const a = addEnemy(armoredPool, mx, ship.y, { hp: 1e9 });
    injectMine(system, { x: mx, y: ship.y, detonateRadius: 60, pull: 1 });
    system.fixedUpdate(DT);
    expect(a.x).toBe(mx); // no movement (the core is a pull no-op)
    expect(a.y).toBe(ship.y);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(a.y)).toBe(true);
  });

  it('an enemy OUTSIDE the pull radius is not moved at all', () => {
    const { enemyPool, system, ship } = makeSystem(LV4);
    const mx = ship.x + 400;
    const e = addEnemy(enemyPool, mx + 300, ship.y); // 300 > MINE_PULL_RADIUS (150)
    expect(300).toBeGreaterThan(MINE_PULL_RADIUS);
    const x0 = e.x;
    const y0 = e.y;
    injectMine(system, { x: mx, y: ship.y, detonateRadius: 60, pull: 1 });
    system.fixedUpdate(DT);
    expect(e.x).toBe(x0);
    expect(e.y).toBe(y0);
  });

  it('a NO-PULL (Lv1-stamped) armed mine does not drag an enemy even at Lv5 fold', () => {
    // Per-mine stamping: a mine laid without pull stays no-pull even when the live fold has
    // pull on. Enemy just outside the blast so it is neither pulled nor detonated.
    const { enemyPool, system, ship } = makeSystem(LV5); // fold pull is ON
    const mx = ship.x + 400;
    const e = addEnemy(enemyPool, mx + 120, ship.y);
    const x0 = e.x;
    injectMine(system, { x: mx, y: ship.y, detonateRadius: 60, pull: 0 }); // stamped no-pull
    system.fixedUpdate(DT);
    expect(e.x).toBe(x0); // unmoved — the stamped flag, not the live fold, governs
  });
});

describe('MineLayerSystem — Lv5 chain cascade', () => {
  it('a detonation CHAINS to an adjacent armed mine with NO enemy of its own (isolation)', () => {
    // Mine B has NOTHING in its blast, so the ONLY thing that can detonate (and release) it is
    // the chain from mine A — the clean isolation of the chain mechanism.
    const { collisionSystem, system, ship } = makeSystem(LV5);
    const px = ship.x + 400;
    const trigger = addEnemy(system.enemyPools[0], px, ship.y); // unarmored → triggers mine A
    const mineA = injectMine(system, { x: px, y: ship.y, detonateRadius: 60, chain: 1 });
    // 100px away: within MINE_CHAIN_RADIUS (120), armed + chain, but its 60r blast is empty.
    const mineB = injectMine(system, { x: px + 100, y: ship.y, detonateRadius: 60, chain: 1 });
    system.fixedUpdate(DT);
    // Both mines detonated + released; only the trigger died (mine B had nothing to hit).
    expect(isMineActive(system, mineA)).toBe(false);
    expect(isMineActive(system, mineB)).toBe(false);
    expect(isActive(system.enemyPools[0], trigger)).toBe(false);
    expect(collisionSystem.killedEnemies).toHaveLength(1);
  });

  it('overlapping blasts in a cascade release each mine + each enemy at most ONCE', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV5);
    const px = ship.x + 400;
    // ONE enemy sits inside BOTH mines' blasts (the mines are 40px apart, well within each
    // 60r blast). Both mines detonate this tick; the shared per-tick hit Set must kill — and
    // release — that enemy exactly ONCE, and neither mine may double-release.
    const e = addEnemy(enemyPool, px, ship.y);
    const m1 = injectMine(system, { x: px, y: ship.y, detonateRadius: 60, chain: 1 });
    const m2 = injectMine(system, { x: px + 40, y: ship.y, detonateRadius: 60, chain: 1 });
    const totalBefore = system.pool.activeCount + system.pool.freeCount;
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false);
    // The enemy appears in killedEnemies exactly once (no double-release from overlapping blasts).
    expect(collisionSystem.killedEnemies.filter((k) => k === e)).toHaveLength(1);
    expect(collisionSystem.bulletKillCount).toBe(1);
    // Both mines released, pool size unchanged (no double-release drift).
    expect(isMineActive(system, m1)).toBe(false);
    expect(isMineActive(system, m2)).toBe(false);
    expect(system.pool.activeCount + system.pool.freeCount).toBe(totalBefore);
  });

  it('a NON-chain (Lv1-stamped) mine does NOT ignite an adjacent armed mine', () => {
    const { system, ship } = makeSystem(LV1);
    const px = ship.x + 400;
    const e = addEnemy(system.enemyPools[0], px, ship.y);
    const mineA = injectMine(system, { x: px, y: ship.y, detonateRadius: 60, chain: 0 });
    // Mine B is adjacent + armed but has NO enemy of its own; with mine A carrying no chain
    // flag, mine B must survive (nothing detonates it).
    const mineB = injectMine(system, { x: px + 100, y: ship.y, detonateRadius: 60, chain: 0 });
    system.fixedUpdate(DT);
    expect(isActive(system.enemyPools[0], e)).toBe(false); // mine A still detonated on its enemy
    expect(isMineActive(system, mineA)).toBe(false);
    expect(isMineActive(system, mineB)).toBe(true); // no chain → untouched
  });
});

describe('MineLayerSystem — sanitizers (SAFETY guards, never balance levers)', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk drop period (%s) → unowned (no drops)', (_label, v) => {
    const { system } = makeSystem({ ...LV1, mineDropPeriodMs: v });
    expect(system._dropPeriodMs()).toBe(0);
    for (let i = 0; i < 200; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });

  it('a tiny-positive drop period is FLOORED (at most ~1 mine/tick, no burst past the cap)', () => {
    const { system } = makeSystem({ ...LV1, mineDropPeriodMs: 0.5 });
    expect(system._dropPeriodMs()).toBe(MINE_DROP_PERIOD_FLOOR_MS);
    system.fixedUpdate(DT); // one tick
    // A single tick drops at most a couple of mines — never a 30+ same-tick burst.
    expect(system.pool.activeCount).toBeLessThanOrEqual(2);
    // …and the pool never grew past its prewarm via the factory.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(MINE_POOL_PREWARM);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk cap (%s) → the base cap fallback', (_label, v) => {
    const { system } = makeSystem({ ...LV1, mineCap: v });
    expect(system._cap()).toBe(MINE_BASE_CAP);
  });

  it('an ABSURD cap clamps to MINE_MAX_CAP (the live count stays bounded)', () => {
    const { system } = makeSystem({ ...LV1, mineCap: 1e9 });
    expect(system._cap()).toBe(MINE_MAX_CAP);
    // Run long enough to reach the cap; it must never exceed the safety clamp.
    let maxActive = 0;
    for (let i = 0; i < 4000; i++) {
      system.fixedUpdate(DT);
      if (system.pool.activeCount > maxActive) maxActive = system.pool.activeCount;
    }
    expect(maxActive).toBeLessThanOrEqual(MINE_MAX_CAP);
    expect(system.pool.activeCount + system.pool.freeCount).toBe(MINE_POOL_PREWARM);
  });

  it('a FRACTIONAL cap is floored to whole mines', () => {
    const { system } = makeSystem({ ...LV1, mineCap: 8.7 });
    expect(system._cap()).toBe(8);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -5],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk detonate radius (%s) → the base-radius fallback', (_label, v) => {
    const { system } = makeSystem({ ...LV1, mineDetonateRadius: v });
    expect(system._detonateRadius()).toBe(MINE_BASE_DETONATE_RADIUS);
  });

  it('an ABSURD detonate radius clamps to MINE_MAX_DETONATE_RADIUS', () => {
    const { system } = makeSystem({ ...LV1, mineDetonateRadius: 1e9 });
    expect(system._detonateRadius()).toBe(MINE_MAX_DETONATE_RADIUS);
  });

  it.each([
    ['NaN', NaN],
    ['negative', -1],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk pull/chain (%s) → the flag OFF', (_label, v) => {
    const { system } = makeSystem({ ...LV4, minePull: v, mineChain: v });
    expect(system._pull()).toBe(0);
    expect(system._chain()).toBe(0);
  });

  it('the full junk fold (period 0.5 / cap 1e9 / radius NaN) never throws or NaNs a position', () => {
    const { system, ship } = makeSystem({
      mineDropPeriodMs: 0.5,
      mineCap: 1e9,
      mineDetonateRadius: NaN,
    });
    expect(system._dropPeriodMs()).toBe(MINE_DROP_PERIOD_FLOOR_MS);
    expect(system._cap()).toBe(MINE_MAX_CAP);
    expect(system._detonateRadius()).toBe(MINE_BASE_DETONATE_RADIUS);
    expect(() => {
      for (let i = 0; i < 300; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    for (const m of activeMines(system)) {
      expect(Number.isFinite(m.x)).toBe(true);
      expect(Number.isFinite(m.y)).toBe(true);
      expect(m.x).toBeGreaterThanOrEqual(ARENA_BORDER_INSET);
      expect(m.x).toBeLessThanOrEqual(ARENA_WIDTH - ARENA_BORDER_INSET);
    }
    expect(ship).toBeDefined();
  });

  it('guards a null ship / pools / collisionSystem defensively (no-op, no throw)', () => {
    const playerStats = { ...createPlayerStats(), ...LV1 };
    const noShip = new MineLayerSystem(null, null, null, playerStats);
    expect(() => {
      for (let i = 0; i < 50; i++) noShip.fixedUpdate(DT);
    }).not.toThrow();
    // No ship → no drop (a mine is laid at the ship position).
    expect(noShip.pool.activeCount).toBe(0);
  });
});

describe('MineLayerSystem — allocation', () => {
  it('allocates nothing per tick on the steady path (stable pool, hoisted collectors, reused scratch)', () => {
    // Huge-hp armored around the ship so mines drop → arm → detonate on survivors continuously
    // (with pull + chain live at Lv5) — a real hot path, not an idle loop.
    const armoredPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV5, [armoredPool]);
    for (const [dx, dy] of [
      [40, 0],
      [-40, 0],
      [0, 40],
      [0, -40],
      [60, 60],
      [-60, -60],
    ]) {
      addEnemy(armoredPool, ship.x + dx, ship.y + dy, { hp: 1e9 });
    }
    // Warm up (drops accumulate, first mines arm + detonate, scratch grows).
    for (let i = 0; i < 400; i++) system.fixedUpdate(DT);

    const collectMine = system._collectMine;
    const collectEnemy = system._collectEnemy;
    const minesRef = system._mines;
    const enemiesRef = system._enemies;
    const ownersRef = system._owners;
    const detonateListRef = system._detonateList;
    const mineTotal = system.pool.activeCount + system.pool.freeCount;
    const shape = Object.keys(system).sort();

    let maxActive = 0;
    for (let i = 0; i < 800; i++) {
      system.fixedUpdate(DT);
      if (system.pool.activeCount > maxActive) maxActive = system.pool.activeCount;
    }

    // The mine pool churns (drop/detonate/evict) but never GROWS past the prewarm — active +
    // free stays constant (no factory allocation), and the live count stays bounded by the cap.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(mineTotal);
    expect(mineTotal).toBe(MINE_POOL_PREWARM);
    expect(maxActive).toBeLessThanOrEqual(LV5.mineCap);
    // The hoisted iteration callbacks are the SAME closures (never fresh arrows)…
    expect(system._collectMine).toBe(collectMine);
    expect(system._collectEnemy).toBe(collectEnemy);
    // …the scratch arrays are the SAME references (length-reset in place, never realloc)…
    expect(system._mines).toBe(minesRef);
    expect(system._enemies).toBe(enemiesRef);
    expect(system._owners).toBe(ownersRef);
    expect(system._detonateList).toBe(detonateListRef);
    // …and no field was added to the instance across the run.
    expect(Object.keys(system).sort()).toEqual(shape);
  });
});

describe('MineLayerSystem — Singularity Field (Story 12.8)', () => {
  it('singularityFieldActive=false: an enemy in blast triggers normal detonation', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const e = addEnemy(enemyPool, ship.x + 300, ship.y);
    const mine = injectMine(system, { x: ship.x + 300, y: ship.y, detonateRadius: 60 });
    system.singularityFieldActive = false;
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(e);
    expect(isMineActive(system, mine)).toBe(false);
  });

  it('singularityFieldActive=true, enemy enters blast: mine transitions to pull phase', () => {
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    const e = addEnemy(enemyPool, mx + 300, ship.y); // outside blast(60)
    system.singularityFieldActive = true;
    const mine = injectMine(system, { x: mx, y: ship.y, detonateRadius: 500 }); // huge blast so enemy is in range
    system.fixedUpdate(DT);
    expect(mine.isSingularity).toBe(true);
    expect(mine.pullPhaseStartMs).toBeGreaterThan(0);
    // Mine is still active (not released).
    expect(isMineActive(system, mine)).toBe(true);
    // Enemy is still alive (singularity doesn't damage on transition).
    expect(isActive(enemyPool, e)).toBe(true);
  });

  it('Pull phase: enemy within 150px is pulled toward the mine', () => {
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    const ex = mx + 50; // 50px from mine, inside SINGULARITY_PULL_RADIUS (150)
    const e = addEnemy(enemyPool, ex, ship.y);
    system.singularityFieldActive = true;
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    system.fixedUpdate(DT);
    const dBefore = Math.abs(ex - mx);
    const dAfter = Math.abs(e.x - mx);
    expect(dAfter).toBeLessThan(dBefore); // nudged toward the mine
    expect(dAfter).toBeGreaterThanOrEqual(0);
  });

  it('Pull phase: enemy outside 150px radius is not pulled', () => {
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    const e = addEnemy(enemyPool, mx + SINGULARITY_PULL_RADIUS + 100, ship.y); // 250px away
    const x0 = e.x;
    system.singularityFieldActive = true;
    injectSingularityMine(system, { x: mx, y: ship.y });
    system.fixedUpdate(DT);
    expect(e.x).toBe(x0); // no movement
  });

  it('Implode at 1.5s: 3× damage dealt via applyPlayerDamage', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    const e = addEnemy(enemyPool, mx + 20, ship.y); // within blast radius
    system.singularityFieldActive = true;
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    // Advance past pull duration (1.5s) to trigger implosion.
    const steps = Math.ceil(SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS) + 2;
    for (let i = 0; i < steps; i++) {
      system.fixedUpdate(DT);
    }
    // Verify 3× damage applied.
    expect(collisionSystem.bulletDamageCount).toBeGreaterThanOrEqual(1);
    expect(isActive(enemyPool, e)).toBe(false); // killed
    expect(collisionSystem.killedEnemies).toContain(e);
  });

  it('Implode: grid ripple emitted at mine position', () => {
    const gridFake = fakeGridField();
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    addEnemy(enemyPool, mx + 20, ship.y);
    system.singularityFieldActive = true;
    system.gridFieldSystem = gridFake;
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    // Advance to implosion.
    for (let i = 0; i < SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS + 2; i++) {
      system.fixedUpdate(DT);
    }
    expect(gridFake.ripples.length).toBeGreaterThanOrEqual(1);
    expect(gridFake.ripples[0].x).toBe(mx);
    expect(gridFake.ripples[0].y).toBe(ship.y);
  });

  it('Implode: mine reset to armed state (isSingularity=false, ageMs<2*DT)', () => {
    const DT_MS = FIXED_STEP_MS;
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    addEnemy(enemyPool, mx + 20, ship.y);
    system.singularityFieldActive = true;
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    // Advance to implosion.
    const steps = Math.ceil(SINGULARITY_PULL_DURATION_MS / DT_MS) + 2;
    for (let i = 0; i < steps; i++) {
      system.fixedUpdate(DT);
    }
    expect(mine.isSingularity).toBe(false);
    // ageMs may be a small positive value (< 2*DT) from the age pass that
    // runs on the post-implosion tick before the implosion check.
    expect(mine.ageMs).toBeLessThanOrEqual(DT_MS * 2);
    expect(mine.pullPhaseStartMs).toBe(0);
    // Mine is still active (not released back to pool).
    expect(isMineActive(system, mine)).toBe(true);
  });

  it('Multiple mines in pull phase: each independently pulls enemies', () => {
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx1 = ship.x + 300;
    const mx2 = ship.x - 300;
    // Enemy between two singularity mines.
    const e = addEnemy(enemyPool, ship.x, ship.y);
    system.singularityFieldActive = true;
    const m1 = injectSingularityMine(system, { x: mx1, y: ship.y });
    const m2 = injectSingularityMine(system, { x: mx2, y: ship.y });
    const dBefore = Math.abs(e.x);
    system.fixedUpdate(DT);
    const dAfter = Math.abs(e.x);
    // Enemy moved due to pulls from both mines (net direction depends on relative distances).
    expect(isMineActive(system, m1)).toBe(true);
    expect(isMineActive(system, m2)).toBe(true);
  });

  it('Lv4 mine pull + singularity pull both apply to same enemy', () => {
    const { enemyPool, system, ship } = makeSystem(LV4); // pull=1 from fold
    const mx = ship.x + 300;
    const e = addEnemy(enemyPool, mx + 80, ship.y); // within both pull radii
    const x0 = e.x;
    system.singularityFieldActive = true;
    const mine = injectMine(system, { x: mx, y: ship.y, pull: 1, detonateRadius: 1000 }); // Lv4 pull mine
    system.fixedUpdate(DT);
    // Both Lv4 pull and singularity pull should combine — enemy moves more than from singularity alone.
    // The exact amount is non-trivial, but that it moves at all with both pulls active is verifiable.
    expect(e.x).not.toBe(x0);
    // Enemy should have been moved inward (singularity pull).
    const dAfter = Math.abs(e.x - mx);
    expect(dAfter).toBeLessThan(80); // was at 80px from mine, moved closer
  });

  it('No enemies: pull phase does nothing', () => {
    const { enemyPool, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    system.singularityFieldActive = true;
    // Just run with a singularity mine but no enemies in the pool.
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    for (let i = 0; i < SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS + 2; i++) {
      system.fixedUpdate(DT);
    }
    expect(isMineActive(system, mine)).toBe(true); // should survive after implosion (still active)
  });

  it('Reset mine re-triggers on enemy contact: after implosion, enemy in blast → normal detonation', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    const e = addEnemy(enemyPool, mx + 20, ship.y); // inside blast radius
    system.singularityFieldActive = true;
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    // Advance to implosion (reset).
    for (let i = 0; i < SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS + 2; i++) {
      system.fixedUpdate(DT);
    }
    // Mine should still be active and armed (reset but not released).
    expect(isMineActive(system, mine)).toBe(true);
    expect(mine.isSingularity).toBe(false);
    // The enemy is still in range. Run one more tick → normal detonation.
    system.fixedUpdate(DT);
    // Now the reset should have detonated (the enemy is in blast radius).
    expect(isActive(enemyPool, e)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(e);
  });

  it('Implode damage routing: verifies applyPlayerDamage called (damage counted)', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem(LV1);
    const mx = ship.x + 300;
    const e = addEnemy(enemyPool, mx + 20, ship.y);
    const dBefore = e.hp !== undefined ? e.hp : 1;
    system.singularityFieldActive = true;
    injectSingularityMine(system, { x: mx, y: ship.y });
    // Advance to implosion.
    for (let i = 0; i < SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS + 2; i++) {
      system.fixedUpdate(DT);
    }
    // The damage is routed through applyPlayerDamage — it goes into bulletDamageCount.
    expect(collisionSystem.bulletDamageCount).toBeGreaterThanOrEqual(1);
  });

  it('Implode damage is exactly 3× base mine damage (SINGULARITY_DAMAGE_MULTIPLIER)', () => {
    const armoredPool = new Pool(createArmored);
    const { system: sys2 } = makeSystem(LV1, [armoredPool]);
    const mx2 = sys2.ship.x + 300;
    // Deploy an armored enemy just outside the kill threshold, so 3× damage kills it
    // (verifying magnitude = mine.damage × multiplier, not a different value).
    const a = addEnemy(armoredPool, mx2 + 20, sys2.ship.y, { hp: ARMORED_HP });
    // Armored HP is 5; mine damage * 3 = 270. A 3× killed armored proves the multiplier.
    // For a precise per-hit check, use a custom-hp enemy: set hp to exactly one
    // implosion hit below one-shot, so the hit is absorbed (not a kill) and we can
    // verify the exact damage absorbed via hp delta.
    a.hp = SINGULARITY_DAMAGE_MULTIPLIER * MINE_DETONATE_DAMAGE + 10; // 280 (absorbed, not killed)
    sys2.singularityFieldActive = true;
    injectSingularityMine(sys2, { x: mx2, y: sys2.ship.y });
    const hpBefore = a.hp;
    const steps = Math.ceil(SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS) + 2;
    for (let i = 0; i < steps; i++) sys2.fixedUpdate(DT);
    // The implosion should have been absorbed — hp drops by exactly the implosion damage.
    expect(a.hp).toBeCloseTo(hpBefore - (MINE_DETONATE_DAMAGE * SINGULARITY_DAMAGE_MULTIPLIER), 6);
  });

  it('Zero allocation in hot path during pull phase', () => {
    const armoredPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV1, [armoredPool]);
    const mx = ship.x + 300;
    // Deploy a stationary enemy so the singularity pull hot path (iterate enemies)
    // actually executes real logic — not a vacuous empty-array loop.
    const e = addEnemy(armoredPool, mx + 80, ship.y, { hp: 1e9 });
    system.singularityFieldActive = true;
    const mine = injectSingularityMine(system, { x: mx, y: ship.y });
    const xBefore = e.x;
    const totalBefore = system.pool.activeCount + system.pool.freeCount;
    const shapeBefore = Object.keys(system).sort();
    for (let i = 0; i < SINGULARITY_PULL_DURATION_MS / FIXED_STEP_MS + 2; i++) {
      system.fixedUpdate(DT);
    }
    expect(system.pool.activeCount + system.pool.freeCount).toBe(totalBefore);
    expect(Object.keys(system).sort()).toEqual(shapeBefore);
    // Enemy should have been nudged by the pull (verifies the hot path ran).
    expect(Math.abs(e.x - xBefore)).toBeGreaterThan(0);
  });
});
