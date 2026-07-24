import { describe, it, expect } from 'vitest';
import { OrbitBladeSystem } from './OrbitBladeSystem.js';
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
  SEEKER_RADIUS,
  ORBIT_BLADE_ORBIT_RADIUS,
  ORBIT_BLADE_RADIUS,
  ORBIT_BLADE_MAX_COUNT,
  ORBIT_BLADE_BASE_DAMAGE,
  ORBIT_BLADE_BASE_PERIOD_MS,
  ORBIT_BLADE_HIT_COOLDOWN_MS,
  ORBIT_BLADE_POOL_PREWARM,
  PLAYER_BULLET_BASE_DAMAGE,
  ARMORED_HP,
} from '../config/constants.js';

// Story 11.1 — OrbitBladeSystem owns the Orbit Blade's blade POOL + rotation PHASE while
// the shared playerStats store owns only the derived count/damage/period/radius-mult. This
// suite covers the rows of the story's I/O matrix that belong to this system: the count
// sync, the rotation geometry, the contact sweep through applyPlayerDamage (including the
// armored full-damage contrast), the re-hit cooldown, the telegraph skip, the junk
// sanitizers, and the steady-state zero-allocation invariant. The registration-slot and
// assembled-pipeline wiring lives in buildArenaWorld.test.js.

const DT = FIXED_STEP_MS;

// The per-level fold maps the real registry produces (pinned against the registry itself
// in playerStats.test.js — restated here as the system's input vocabulary).
const LV1 = { orbitBladeCount: 1, orbitBladeDamage: 90, orbitBladePeriodMs: 1200 };
const LV3 = { orbitBladeCount: 3, orbitBladeDamage: 90, orbitBladePeriodMs: 1000 };
const LV5 = {
  orbitBladeCount: 5,
  orbitBladeDamage: 126,
  orbitBladePeriodMs: 700,
  orbitBladeRadiusMult: 1.25,
};

/**
 * An orbit-blade system over a fresh centred ship, the given enemy pools, a real
 * CollisionSystem seam, and a real player-stat store seeded with the given fold fields
 * (the shape `recomputePlayerStats` produces). `stats === null` means NO store (the
 * pre-story path).
 */
function makeSystem(stats = {}, pools) {
  const ship = createPlayerShip();
  ship.x = ARENA_WIDTH / 2;
  ship.y = ARENA_HEIGHT / 2;
  const enemyPools = pools ?? [new Pool(createSeeker)];
  const collisionSystem = new CollisionSystem(new Pool(createBullet), enemyPools);
  const playerStats = stats === null ? null : { ...createPlayerStats(), ...stats };
  const system = new OrbitBladeSystem(ship, enemyPools, collisionSystem, playerStats);
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

function activeBlades(system) {
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

describe('OrbitBladeSystem — count sync from the fold', () => {
  it('an unowned build spawns NO blades and never touches an enemy', () => {
    const { enemyPool, collisionSystem, system, ship } = makeSystem();
    const e = addEnemy(enemyPool, ship.x, ship.y);
    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).toHaveLength(0);
    expect(collisionSystem.bulletDamageCount).toBe(0);
  });

  it('a NULL store means no blades ever, no throw (the pre-11.1 path)', () => {
    const { enemyPool, system, ship } = makeSystem(null);
    expect(system.playerStats).toBeNull();
    const e = addEnemy(enemyPool, ship.x + ORBIT_BLADE_ORBIT_RADIUS, ship.y);
    expect(() => {
      for (let i = 0; i < 100; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
    expect(isActive(enemyPool, e)).toBe(true);
  });

  it('Lv1 → exactly one blade at the ring radius', () => {
    const { ship, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    const [b] = activeBlades(system);
    expect(Math.hypot(b.x - ship.x, b.y - ship.y)).toBeCloseTo(ORBIT_BLADE_ORBIT_RADIUS, 9);
  });

  it('Lv3 → three blades evenly spaced ~2π/3 apart at the ring radius', () => {
    const { ship, system } = makeSystem(LV3);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(3);
    const blades = activeBlades(system);
    for (const b of blades) {
      expect(Math.hypot(b.x - ship.x, b.y - ship.y)).toBeCloseTo(ORBIT_BLADE_ORBIT_RADIUS, 9);
    }
    const angles = blades
      .map((b) => Math.atan2(b.y - ship.y, b.x - ship.x))
      .map((a) => (a < 0 ? a + Math.PI * 2 : a))
      .sort((p, q) => p - q);
    expect(angles[1] - angles[0]).toBeCloseTo((2 * Math.PI) / 3, 6);
    expect(angles[2] - angles[1]).toBeCloseTo((2 * Math.PI) / 3, 6);
  });

  it('a level RISE 1→3 mid-run reaches 3 blades with no factory allocation (prewarmed)', () => {
    const { playerStats, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    const total = system.pool.activeCount + system.pool.freeCount;
    expect(total).toBe(ORBIT_BLADE_POOL_PREWARM);

    Object.assign(playerStats, LV3); // the Lv3 pick folds
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(3);
    // No factory call — total capacity is still exactly the prewarm.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(total);
  });

  it('a level DROP releases the surplus blades back to the pool', () => {
    const { playerStats, system } = makeSystem(LV5);
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(5);
    const total = system.pool.activeCount + system.pool.freeCount;

    Object.assign(playerStats, LV1); // remnant/drop to a single blade
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(1);
    // Released, not destroyed: the surplus went back to the free list.
    expect(system.pool.activeCount + system.pool.freeCount).toBe(total);

    // …and all the way to nothing owned.
    Object.assign(playerStats, { orbitBladeCount: 0 });
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });

  it('Lv5 applies the +25% ring radius', () => {
    const { ship, system } = makeSystem(LV5);
    system.fixedUpdate(DT);
    const [b] = activeBlades(system);
    expect(Math.hypot(b.x - ship.x, b.y - ship.y)).toBeCloseTo(
      ORBIT_BLADE_ORBIT_RADIUS * 1.25,
      9,
    );
  });
});

describe('OrbitBladeSystem — rotation', () => {
  it('advances the shared phase and wraps it into [0, 2π)', () => {
    const { system } = makeSystem(LV1);
    expect(system._phaseRad).toBe(0);
    system.fixedUpdate(DT);
    // period 1200ms → 2π/1.2 rad/s × dt.
    const expectedStep = ((2 * Math.PI) / (1200 / 1000)) * (DT / 1000);
    expect(system._phaseRad).toBeCloseTo(expectedStep, 9);
    // Run well past a full revolution; the phase stays wrapped into [0, 2π).
    for (let i = 0; i < 300; i++) system.fixedUpdate(DT);
    expect(system._phaseRad).toBeGreaterThanOrEqual(0);
    expect(system._phaseRad).toBeLessThan(2 * Math.PI);
  });

  it('a smaller period spins faster (Lv5 0.7s vs Lv1 1.2s)', () => {
    const slow = makeSystem(LV1).system;
    const fast = makeSystem(LV5).system;
    slow.fixedUpdate(DT);
    fast.fixedUpdate(DT);
    expect(fast._phaseRad).toBeGreaterThan(slow._phaseRad);
  });

  it('leaves the phase untouched when no blades are owned', () => {
    const { system } = makeSystem();
    for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    expect(system._phaseRad).toBe(0);
  });

  it('the blade POSITION actually orbits — its real angle advances with the phase', () => {
    // The only assertion that ties `_phaseRad` to the blade's real x/y. A reposition that
    // dropped the phase term (frozen blades: a = i·step) would still pass every geometry
    // snapshot, both `_phaseRad` tests, and the sweep — but NOT this: over K ticks the
    // blade's own atan2 angle must advance by K × the per-tick angular step.
    const { ship, system } = makeSystem(LV1);
    system.fixedUpdate(DT);
    const [b0] = activeBlades(system);
    const a0 = Math.atan2(b0.y - ship.y, b0.x - ship.x);

    const K = 10;
    for (let i = 0; i < K; i++) system.fixedUpdate(DT);
    const [b1] = activeBlades(system);
    const a1 = Math.atan2(b1.y - ship.y, b1.x - ship.x);

    // period 1200ms → angular speed 2π/1.2 rad/s; K ticks of DT each. Well under a full
    // revolution (~0.87 rad), so no wrap to unwind.
    const perTick = ((2 * Math.PI) / (1200 / 1000)) * (DT / 1000);
    const advanced = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    expect(advanced).toBeCloseTo(K * perTick, 6);
    expect(advanced).toBeGreaterThan(0); // it MOVED (not frozen)
  });

  it('the ring TRACKS a moving ship — blades re-centre on the ship each tick, not a stale origin', () => {
    // Every geometry case above holds the ship at arena centre; the reposition reads
    // `ship.x/y` LIVE, so a regression that cached the ship origin (blades centred on where
    // the ship WAS) would pass all of them. Translate the ship between ticks and require the
    // ring to stay centred on its NEW position — for all three blades at once.
    const { ship, system } = makeSystem(LV3);
    system.fixedUpdate(DT);
    ship.x += 137;
    ship.y -= 89;
    system.fixedUpdate(DT);
    const blades = activeBlades(system);
    expect(blades).toHaveLength(3);
    for (const b of blades) {
      expect(Math.hypot(b.x - ship.x, b.y - ship.y)).toBeCloseTo(ORBIT_BLADE_ORBIT_RADIUS, 9);
    }
  });
});

describe('OrbitBladeSystem — contact sweep through applyPlayerDamage', () => {
  // Position the enemy exactly where a blade sits after the first tick, so the second
  // tick's sweep overlaps it deterministically (the blade moves only a few px per tick,
  // far under the blade+enemy contact radius).
  function placeOnBlade(system, pool, opts) {
    system.fixedUpdate(DT);
    const [b] = activeBlades(system);
    return addEnemy(pool, b.x, b.y, opts);
  }

  it('kills a one-hit enemy and reports it in killedEnemies (scores + drops XP downstream)', () => {
    const { enemyPool, collisionSystem, system } = makeSystem(LV1);
    const e = placeOnBlade(system, enemyPool);
    system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(false); // released via applyPlayerDamage
    expect(collisionSystem.killedEnemies).toContain(e);
    expect(collisionSystem.bulletKillCount).toBe(1);
  });

  it('kills an ARMORED (hp 5) in ONE contact — the full-damage melee answer', () => {
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system } = makeSystem(LV1, [armoredPool]);
    const a = placeOnBlade(system, armoredPool, { hp: ARMORED_HP });
    system.fixedUpdate(DT);
    // 5 ≤ 90 + ε → released in one contact.
    expect(isActive(armoredPool, a)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(a);
  });

  it('the melee-vs-projectile contrast: a single 1-damage bullet leaves the armored alive (hp 4)', () => {
    // The blade one-shots the armored (above); a lone bullet does not — the same armored,
    // the same shared seam, a different damage magnitude.
    const armoredPool = new Pool(createArmored);
    const { collisionSystem } = makeSystem(LV1, [armoredPool]);
    const a = armoredPool.acquire();
    a.hp = ARMORED_HP;
    const killed = collisionSystem.applyPlayerDamage(a, armoredPool, PLAYER_BULLET_BASE_DAMAGE);
    expect(killed).toBe(false);
    expect(a.hp).toBe(ARMORED_HP - 1); // 4 — survives
    expect(isActive(armoredPool, a)).toBe(true);
  });

  it('NEVER hits a telegraphing (spawning-in) enemy', () => {
    const { enemyPool, collisionSystem, system } = makeSystem(LV1);
    const e = placeOnBlade(system, enemyPool, { telegraphMs: 300 });
    for (let i = 0; i < 30; i++) system.fixedUpdate(DT);
    expect(isActive(enemyPool, e)).toBe(true);
    expect(collisionSystem.killedEnemies).not.toContain(e);
    expect(collisionSystem.bulletDamageCount).toBe(0);
  });

  it('re-hit guard: a SURVIVING enemy is hit at most once per ORBIT_BLADE_HIT_COOLDOWN_MS, not every tick', () => {
    // A slow spin keeps the (huge-hp) enemy continuously overlapping one blade, so the
    // only thing rate-limiting the hits is the cooldown. Over a fixed window the hit count
    // must track elapsed/cooldown, NOT the tick count.
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system } = makeSystem(
      { orbitBladeCount: 1, orbitBladeDamage: 90, orbitBladePeriodMs: 100000 },
      [armoredPool],
    );
    // Position a survivor (hp far above the blade damage) on the near-stationary blade.
    system.fixedUpdate(DT);
    const [b] = activeBlades(system);
    const a = addEnemy(armoredPool, b.x, b.y, { hp: 1e6 });

    const windowTicks = 60; // ~1000ms of sim time
    const before = collisionSystem.bulletDamageCount;
    for (let i = 0; i < windowTicks; i++) system.fixedUpdate(DT);
    const hits = collisionSystem.bulletDamageCount - before;

    // ~1000ms / 250ms cooldown → a handful of hits, never one-per-tick.
    const maxByCooldown = Math.ceil((windowTicks * DT) / ORBIT_BLADE_HIT_COOLDOWN_MS) + 1;
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(hits).toBeLessThanOrEqual(maxByCooldown);
    expect(hits).toBeLessThan(windowTicks); // the whole point — not every tick
    expect(isActive(armoredPool, a)).toBe(true); // still alive (it absorbed each hit)
  });

  it('the folded per-blade DAMAGE flows through the seam (hp −90 at Lv1, −126 at Lv5)', () => {
    // Every kill test only needs damage ≥ 5 (all shipped enemies are hp 5), so the folded
    // 90/126 is never observed through the seam. A high-hp survivor makes the decrement
    // itself the assertion — pinning `_damage()`'s value flowing into applyPlayerDamage.
    for (const [stats, dmg] of [
      [LV1, 90],
      [LV5, 126],
    ]) {
      const armoredPool = new Pool(createArmored);
      const { system } = makeSystem(stats, [armoredPool]);
      const a = placeOnBlade(system, armoredPool, { hp: 1e6 });
      system.fixedUpdate(DT); // one eligible hit
      expect(a.hp, `${dmg} damage`).toBe(1e6 - dmg);
      expect(isActive(armoredPool, a)).toBe(true); // survived (hp far above the damage)
    }
  });

  it('re-telegraphing CLEARS the re-hit stamp, so a recycled enemy is eligible again within the cooldown', () => {
    // Recycle-safety proof (PATCH 1): the stamp is an absolute-time window, so it is NOT
    // safe merely because "the clock increases". It is safe because a recycled enemy
    // re-telegraphs on spawn and the sweep clears its stamp while telegraphing. This drives
    // that path deterministically: hit → (cooldown blocks a re-hit) → telegraph clears the
    // stamp → hit AGAIN, all inside the original 250ms cooldown window.
    const armoredPool = new Pool(createArmored);
    const { collisionSystem, system } = makeSystem(
      { orbitBladeCount: 1, orbitBladeDamage: 90, orbitBladePeriodMs: 100000 },
      [armoredPool],
    );
    system.fixedUpdate(DT);
    const [b] = activeBlades(system);
    const a = addEnemy(armoredPool, b.x, b.y, { hp: 1e6 });

    // First eligible hit — the stamp is set to a finite elapsed time.
    let hits = collisionSystem.bulletDamageCount;
    system.fixedUpdate(DT);
    expect(collisionSystem.bulletDamageCount).toBe(hits + 1);
    expect(Number.isFinite(a._orbitBladeHitAt)).toBe(true);

    // The very next tick is well inside the cooldown → the guard blocks a re-hit.
    hits = collisionSystem.bulletDamageCount;
    system.fixedUpdate(DT);
    expect(collisionSystem.bulletDamageCount).toBe(hits); // no new hit — cooldown works

    // The enemy re-telegraphs (as a recycled instance does on spawn): the sweep clears its
    // stamp and leaves it un-hit while telegraphing.
    hits = collisionSystem.bulletDamageCount;
    a.telegraphMs = 300;
    system.fixedUpdate(DT);
    expect(a._orbitBladeHitAt).toBe(-Infinity); // stamp CLEARED
    expect(collisionSystem.bulletDamageCount).toBe(hits); // not hit while telegraphing

    // Telegraph over: hit AGAIN immediately, still deep inside the original cooldown window
    // (only ~4 ticks ≈ 67ms elapsed since the first hit) — so ONLY the reset can explain it.
    hits = collisionSystem.bulletDamageCount;
    a.telegraphMs = 0;
    system.fixedUpdate(DT);
    expect(collisionSystem.bulletDamageCount).toBe(hits + 1);
  });

  it('reaches every combat pool it was given (one shared collector)', () => {
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const { collisionSystem, system } = makeSystem(LV5, [seekers, squares]);
    system.fixedUpdate(DT);
    // Put an enemy of each archetype on two different blades.
    const blades = activeBlades(system);
    const s = addEnemy(seekers, blades[0].x, blades[0].y);
    const q = addEnemy(squares, blades[1].x, blades[1].y);
    system.fixedUpdate(DT);
    expect(isActive(seekers, s)).toBe(false);
    expect(isActive(squares, q)).toBe(false);
    expect(collisionSystem.killedEnemies).toContain(s);
    expect(collisionSystem.killedEnemies).toContain(q);
  });
});

describe('OrbitBladeSystem — sanitizers (SAFETY guards, never balance levers)', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk count (%s) → no blades at all', (_label, v) => {
    const { system } = makeSystem({
      orbitBladeCount: v,
      orbitBladeDamage: 90,
      orbitBladePeriodMs: 1200,
    });
    expect(() => {
      for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
  });

  it('a FRACTIONAL count is floored to whole blades', () => {
    const { system } = makeSystem({ ...LV1, orbitBladeCount: 2.7 });
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(2);
  });

  it('an ABSURD count clamps to ORBIT_BLADE_MAX_COUNT (the acquire loop stays bounded)', () => {
    const { system } = makeSystem({ ...LV1, orbitBladeCount: 1e9 });
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(ORBIT_BLADE_MAX_COUNT);
    expect(system._count()).toBe(ORBIT_BLADE_MAX_COUNT);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -5],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk damage (%s) → the base-damage fallback', (_label, v) => {
    const { system } = makeSystem({ ...LV1, orbitBladeDamage: v });
    expect(system._damage()).toBe(ORBIT_BLADE_BASE_DAMAGE);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -5],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk period (%s) → the base-period fallback, and the tick never throws', (_label, v) => {
    const { system } = makeSystem({ ...LV1, orbitBladePeriodMs: v });
    expect(system._periodMs()).toBe(ORBIT_BLADE_BASE_PERIOD_MS);
    expect(() => system.fixedUpdate(DT)).not.toThrow();
    expect(Number.isFinite(system._phaseRad)).toBe(true);
  });

  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -1],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('junk radius mult (%s) → a factor of 1 (the ring never collapses to 0/NaN)', (_label, v) => {
    const { ship, system } = makeSystem({ ...LV1, orbitBladeRadiusMult: v });
    system.fixedUpdate(DT);
    const [b] = activeBlades(system);
    expect(Number.isFinite(b.x)).toBe(true);
    expect(Number.isFinite(b.y)).toBe(true);
    expect(Math.hypot(b.x - ship.x, b.y - ship.y)).toBeCloseTo(ORBIT_BLADE_ORBIT_RADIUS, 9);
  });

  it('a MISSING store (legacy stub) means no blades ever, no throw', () => {
    const ship = createPlayerShip();
    const enemyPool = new Pool(createSeeker);
    const collisionSystem = new CollisionSystem(new Pool(createBullet), [enemyPool]);
    const system = new OrbitBladeSystem(ship, [enemyPool], collisionSystem);
    expect(system.playerStats).toBeNull();
    expect(() => {
      for (let i = 0; i < 100; i++) system.fixedUpdate(DT);
    }).not.toThrow();
    expect(system.pool.activeCount).toBe(0);
  });

  it('guards a null ship / pools / collisionSystem defensively (no-op, no throw)', () => {
    const playerStats = { ...createPlayerStats(), ...LV1 };
    const noShip = new OrbitBladeSystem(null, null, null, playerStats);
    expect(() => {
      for (let i = 0; i < 10; i++) noShip.fixedUpdate(DT);
    }).not.toThrow();
    // Blades are still synced to the count (the pool needs no ship), just not repositioned.
    expect(noShip.pool.activeCount).toBe(1);
  });
});

describe('OrbitBladeSystem — allocation', () => {
  it('allocates nothing per tick at a fixed level (hoisted collectors, reused scratch, stable pool)', () => {
    const enemyPool = new Pool(createArmored);
    const { system, ship } = makeSystem(LV5, [enemyPool]);
    // A survivor parked in the ring so the sweep runs a real hit path every eligible tick.
    addEnemy(enemyPool, ship.x + ORBIT_BLADE_ORBIT_RADIUS, ship.y, { hp: 1e9 });
    system.fixedUpdate(DT); // warm up (blade acquire + scratch growth)
    const collectEnemy = system._collectEnemy;
    const collectBlade = system._collectBlade;
    // The reusable scratch arrays — pinned by REFERENCE so a per-tick `this._enemies = []`
    // reallocation (which pool/closure/keys checks all miss) fails here. The contract is
    // length-reset in place, never a fresh array.
    const enemiesRef = system._enemies;
    const ownersRef = system._owners;
    const activeBladesRef = system._activeBlades;
    const total = system.pool.activeCount + system.pool.freeCount;
    const shape = Object.keys(system).sort();

    for (let i = 0; i < 600; i++) system.fixedUpdate(DT);

    // The blade pool is stable (no acquire/release at a held level, no factory growth)…
    expect(system.pool.activeCount).toBe(5);
    expect(system.pool.activeCount + system.pool.freeCount).toBe(total);
    // …the hoisted iteration callbacks are the SAME closures (never fresh arrows)…
    expect(system._collectEnemy).toBe(collectEnemy);
    expect(system._collectBlade).toBe(collectBlade);
    // …the scratch arrays are the SAME references (length-reset in place, never realloc)…
    expect(system._enemies).toBe(enemiesRef);
    expect(system._owners).toBe(ownersRef);
    expect(system._activeBlades).toBe(activeBladesRef);
    // …and no field was added to the instance across the run.
    expect(Object.keys(system).sort()).toEqual(shape);
  });
});
