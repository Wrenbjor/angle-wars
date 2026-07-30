import { describe, it, expect } from 'vitest';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createArmored } from '../entities/Armored.js';
import { createPlayerStats, recomputePlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import {
  FIXED_STEP_MS,
  BULLET_RADIUS,
  SEEKER_RADIUS,
  SEEKER_SCORE,
  SEEKER_XP,
  GREEN_SQUARE_SCORE,
  ARMORED_HP,
  ARMORED_SCORE,
  ARMORED_XP,
  PLAYER_BULLET_BASE_DAMAGE,
  PLAYER_BULLET_MIN_DAMAGE,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Build a bullet pool, an enemy pool, and a collision system over them. The
// collision seam takes an ARRAY of enemy pools (one per archetype); the single
// seeker pool is the common case, wrapped in a one-element list.
function makeSystem() {
  const bulletPool = new Pool(createBullet);
  const enemyPool = new Pool(createSeeker);
  const system = new CollisionSystem(bulletPool, [enemyPool]);
  return { bulletPool, enemyPool, system };
}

function addBullet(pool, x, y) {
  const b = pool.acquire();
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
  return b;
}

function addSeeker(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  return s;
}

describe('CollisionSystem', () => {
  it('releases both when a bullet overlaps a seeker', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100, 100); // fully overlapping
    expect(bulletPool.activeCount).toBe(1);
    expect(enemyPool.activeCount).toBe(1);

    system.fixedUpdate(DT);

    expect(enemyPool.activeCount).toBe(0);
    expect(bulletPool.activeCount).toBe(0);
    // Released, not lost: available for reuse.
    expect(enemyPool.freeCount).toBe(1);
    expect(bulletPool.freeCount).toBe(1);
  });

  it('reuses the same hoisted bullet-collector reference across ticks (NFR2)', () => {
    // The collector is a stable constructor instance field, not a fresh per-tick
    // closure — so forEachActive allocates no arrow per tick.
    const { system } = makeSystem();
    const ref = system._collectBullet;
    system.fixedUpdate(DT);
    expect(system._collectBullet).toBe(ref);
  });

  it('does nothing when the bullet is far from the seeker', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 0, 0);
    addSeeker(enemyPool, 500, 500);

    system.fixedUpdate(DT);

    expect(bulletPool.activeCount).toBe(1);
    expect(enemyPool.activeCount).toBe(1);
  });

  it('counts an exact boundary touch (distance == rb + rs) as a hit', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    const r = BULLET_RADIUS + SEEKER_RADIUS;
    // Place centers exactly r apart along +x.
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100 + r, 100);

    system.fixedUpdate(DT);

    expect(bulletPool.activeCount).toBe(0);
    expect(enemyPool.activeCount).toBe(0);
  });

  it('does not hit just beyond the boundary (distance slightly > rb + rs)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    const r = BULLET_RADIUS + SEEKER_RADIUS;
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100 + r + 0.001, 100);

    system.fixedUpdate(DT);

    expect(bulletPool.activeCount).toBe(1);
    expect(enemyPool.activeCount).toBe(1);
  });

  it('one bullet over two seekers destroys exactly one, then is consumed', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 200, 200);
    addSeeker(enemyPool, 200, 200); // both overlap the bullet
    addSeeker(enemyPool, 200, 200);

    system.fixedUpdate(DT);

    // Exactly one seeker destroyed; the bullet consumed.
    expect(enemyPool.activeCount).toBe(1);
    expect(bulletPool.activeCount).toBe(0);
  });

  it('two bullets over one seeker: seeker released once, one bullet survives', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    const b1 = addBullet(bulletPool, 300, 300);
    const b2 = addBullet(bulletPool, 300, 300);
    addSeeker(enemyPool, 300, 300);

    system.fixedUpdate(DT);

    // Seeker destroyed exactly once (no double-release corrupts the pool).
    expect(enemyPool.activeCount).toBe(0);
    expect(enemyPool.freeCount).toBe(1);
    // One bullet consumed, the other still active.
    expect(bulletPool.activeCount).toBe(1);
    expect(bulletPool.freeCount).toBe(1);
    // The surviving bullet is one of the two originals.
    const survivors = [];
    bulletPool.forEachActive((b) => survivors.push(b));
    expect(survivors.length).toBe(1);
    expect(survivors[0] === b1 || survivors[0] === b2).toBe(true);
  });

  it('allocates nothing on the steady-state path (reusable scratch/sets)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 0, 0);
    addSeeker(enemyPool, 500, 500);
    // Repeated ticks with no hits must not grow either pool.
    for (let i = 0; i < 50; i++) system.fixedUpdate(DT);
    expect(bulletPool.activeCount + bulletPool.freeCount).toBe(1);
    expect(enemyPool.activeCount + enemyPool.freeCount).toBe(1);
  });
});

describe('CollisionSystem.killedEnemies reporting', () => {
  it('reports the destroyed seeker when a bullet overlaps one', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    const s = addSeeker(enemyPool, 100, 100);

    system.fixedUpdate(DT);

    expect(system.killedEnemies.length).toBe(1);
    expect(system.killedEnemies[0]).toBe(s);
    // Pools still released as before.
    expect(enemyPool.activeCount).toBe(0);
    expect(bulletPool.activeCount).toBe(0);
  });

  it('reports no kills when the bullet is far from the seeker', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 0, 0);
    addSeeker(enemyPool, 500, 500);

    system.fixedUpdate(DT);

    expect(system.killedEnemies.length).toBe(0);
  });

  it('resets the report between ticks (a prior kill is cleared)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    // Tick A: one kill.
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100, 100);
    system.fixedUpdate(DT);
    expect(system.killedEnemies.length).toBe(1);

    // Tick B: no overlap remains (both released in A) — report clears to empty.
    system.fixedUpdate(DT);
    expect(system.killedEnemies.length).toBe(0);
  });

  it('reports two kills when two bullets each destroy a distinct seeker', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 400, 400);
    addSeeker(enemyPool, 100, 100);
    addSeeker(enemyPool, 400, 400);

    system.fixedUpdate(DT);

    expect(system.killedEnemies.length).toBe(2);
    expect(enemyPool.activeCount).toBe(0);
  });
});

describe('CollisionSystem.bulletKillCount latch (Story 4.2)', () => {
  it('starts at 0 before any tick', () => {
    const { system } = makeSystem();
    expect(system.bulletKillCount).toBe(0);
  });

  it('equals the number of bullet kills this tick', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 400, 400);
    addSeeker(enemyPool, 100, 100);
    addSeeker(enemyPool, 400, 400);

    system.fixedUpdate(DT);

    expect(system.bulletKillCount).toBe(2);
    expect(system.bulletKillCount).toBe(system.killedEnemies.length);
  });

  it('captures per-kill coordinate snapshots in bulletKillX/Y, one per bullet kill', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 400, 400);
    addSeeker(enemyPool, 100, 100);
    addSeeker(enemyPool, 400, 400);

    system.fixedUpdate(DT);

    expect(system.bulletKillX.length).toBe(2);
    expect(system.bulletKillY.length).toBe(2);
    // The snapshots hold the kill coordinates (order matches killedEnemies).
    for (let k = 0; k < system.bulletKillCount; k++) {
      expect(system.bulletKillX[k]).toBe(system.killedEnemies[k].x);
      expect(system.bulletKillY[k]).toBe(system.killedEnemies[k].y);
    }
    // The set of captured coords is exactly the two kill points.
    const coords = system.bulletKillX
      .map((x, i) => `${x},${system.bulletKillY[i]}`)
      .sort();
    expect(coords).toEqual(['100,100', '400,400']);
  });

  it('snapshots each bullet kill xp into bulletKillXp, parallel to bulletKillX/Y (Story 8.1)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    // Two overlapping bullet↔seeker pairs → two bullet kills. Give each seeker a
    // DISTINCT xp so the parallel mapping is provable regardless of Set-iteration order.
    const s1 = addSeeker(enemyPool, 100, 100);
    s1.xp = 4;
    const s2 = addSeeker(enemyPool, 400, 400);
    s2.xp = 9;
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 400, 400);

    system.fixedUpdate(DT);

    expect(system.bulletKillCount).toBe(2);
    // One xp entry per bullet kill, the same length as the coordinate snapshots.
    expect(system.bulletKillXp.length).toBe(2);
    expect(system.bulletKillXp.length).toBe(system.bulletKillX.length);
    // bulletKillXp[k] equals the killed enemy's xp — verified per-kill against the
    // parallel coordinate snapshot (100→4, 400→9), so order cannot mask a mismatch.
    for (let k = 0; k < system.bulletKillCount; k++) {
      expect(system.bulletKillXp[k]).toBe(system.killedEnemies[k].xp);
      const expected = system.bulletKillX[k] === 100 ? 4 : 9;
      expect(system.bulletKillXp[k]).toBe(expected);
    }
  });

  it('guards a non-finite killed-enemy xp to 0 in bulletKillXp (undefined / NaN)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    // A pooled/malformed instance whose xp is not a finite number must snapshot as 0
    // (the Number.isFinite(s.xp) ? s.xp : 0 guard), never propagate undefined/NaN.
    const s1 = addSeeker(enemyPool, 100, 100);
    s1.xp = undefined;
    const s2 = addSeeker(enemyPool, 400, 400);
    s2.xp = NaN;
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 400, 400);

    system.fixedUpdate(DT);

    expect(system.bulletKillCount).toBe(2);
    expect(system.bulletKillXp).toEqual([0, 0]);
  });

  it('snapshots survive a later recycle of the killed enemy object (Story 4.2)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 250, 175);
    addSeeker(enemyPool, 250, 175); // one bullet kill

    system.fixedUpdate(DT);
    expect(system.bulletKillX[0]).toBe(250);
    expect(system.bulletKillY[0]).toBe(175);

    // The killed seeker is released to the pool; simulate a later same-tick system
    // re-acquiring it and overwriting its position (e.g. a black-hole feed-spawn).
    const recycled = enemyPool.acquire();
    recycled.x = 12; // moved to a spawn edge
    recycled.y = 9999;
    // The coordinate snapshot is unaffected — it captured the kill point, not a ref.
    expect(system.bulletKillX[0]).toBe(250);
    expect(system.bulletKillY[0]).toBe(175);
  });

  it('is 0 on a tick with no bullet kills', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 0, 0);
    addSeeker(enemyPool, 500, 500); // far — no hit

    system.fixedUpdate(DT);

    expect(system.bulletKillCount).toBe(0);
  });

  it('is NOT changed by later systems appending to killedEnemies (absorb/bomb)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100, 100); // one bullet kill

    system.fixedUpdate(DT);
    expect(system.bulletKillCount).toBe(1);
    expect(system.killedEnemies.length).toBe(1);

    // Simulate BlackHoleSystem/BombSystem appending their (unscored) removals to the
    // shared kill report AFTER CollisionSystem ran — the latch must not move, so the
    // grid's [0 .. bulletKillCount) slice stays pure bullet kills.
    system.killedEnemies.push({ x: 1, y: 2 }, { x: 3, y: 4 });
    expect(system.bulletKillCount).toBe(1);
    expect(system.killedEnemies.length).toBe(3);
    // The coordinate snapshots are likewise unaffected by later killedEnemies appends.
    expect(system.bulletKillX.length).toBe(1);
    expect(system.bulletKillY.length).toBe(1);
    expect(system.bulletKillX[0]).toBe(100);
    expect(system.bulletKillY[0]).toBe(100);
  });

  it('re-latches each tick (a prior tick\'s count does not carry over)', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    // Tick A: one kill.
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100, 100);
    system.fixedUpdate(DT);
    expect(system.bulletKillCount).toBe(1);

    // Tick B: nothing overlaps → count resets to 0.
    system.fixedUpdate(DT);
    expect(system.bulletKillCount).toBe(0);
  });
});

describe('CollisionSystem — multiple archetype pools', () => {
  // Build a bullet pool plus TWO enemy pools (a seeker pool and a green-square
  // pool) and a collision system spanning both.
  function makeMultiSystem() {
    const bulletPool = new Pool(createBullet);
    const seekerPool = new Pool(createSeeker);
    const greenPool = new Pool(createGreenSquare);
    const system = new CollisionSystem(bulletPool, [seekerPool, greenPool]);
    return { bulletPool, seekerPool, greenPool, system };
  }

  it('destroys a green square in the second pool and releases it to that pool', () => {
    const { bulletPool, seekerPool, greenPool, system } = makeMultiSystem();
    addBullet(bulletPool, 250, 250);
    const g = greenPool.acquire();
    g.x = 250;
    g.y = 250; // overlapping the bullet

    system.fixedUpdate(DT);

    // The green square is released to ITS pool (not the seeker pool), the bullet
    // is consumed, and the square is reported in the shared kill report.
    expect(greenPool.activeCount).toBe(0);
    expect(greenPool.freeCount).toBe(1);
    expect(seekerPool.activeCount).toBe(0);
    expect(bulletPool.activeCount).toBe(0);
    expect(system.killedEnemies.length).toBe(1);
    expect(system.killedEnemies[0]).toBe(g);
  });

  it('one bullet destroys at most one enemy across BOTH pools', () => {
    const { bulletPool, seekerPool, greenPool, system } = makeMultiSystem();
    addBullet(bulletPool, 300, 300);
    const s = addSeeker(seekerPool, 300, 300); // overlapping
    const g = greenPool.acquire();
    g.x = 300;
    g.y = 300; // also overlapping

    system.fixedUpdate(DT);

    // Exactly one enemy destroyed across the two pools; the other survives.
    const seekerAlive = seekerPool.activeCount;
    const greenAlive = greenPool.activeCount;
    expect(seekerAlive + greenAlive).toBe(1);
    expect(system.killedEnemies.length).toBe(1);
    expect(bulletPool.activeCount).toBe(0);
    // The survivor is whichever the bullet did not consume.
    void s;
    void g;
  });

  it('two bullets each destroy a distinct enemy, one per pool', () => {
    const { bulletPool, seekerPool, greenPool, system } = makeMultiSystem();
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 500, 500);
    addSeeker(seekerPool, 100, 100);
    const g = greenPool.acquire();
    g.x = 500;
    g.y = 500;

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(0);
    expect(greenPool.activeCount).toBe(0);
    expect(bulletPool.activeCount).toBe(0);
    expect(system.killedEnemies.length).toBe(2);
  });
});

describe('CollisionSystem — armored HP (projectile-only durability, Story 9.3)', () => {
  // A bullet pool + a dedicated armored pool (its own owning pool so releases route
  // correctly) + a collision system spanning it. Armored carry an `hp` field; only
  // the projectile path here decrements it.
  function makeArmoredSystem() {
    const bulletPool = new Pool(createBullet);
    const armoredPool = new Pool(createArmored);
    const system = new CollisionSystem(bulletPool, [armoredPool]);
    return { bulletPool, armoredPool, system };
  }

  function addArmored(pool, x, y, hp = ARMORED_HP) {
    const s = pool.acquire();
    s.x = x;
    s.y = y;
    s.vx = 0;
    s.vy = 0;
    s.hp = hp;
    return s;
  }

  it('starts bulletDamageCount at 0 before any tick', () => {
    const { system } = makeArmoredSystem();
    expect(system.bulletDamageCount).toBe(0);
  });

  it('an armored (hp = N) survives N−1 hits then dies on the Nth — each hit credits bulletDamageCount', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const N = ARMORED_HP;
    expect(N).toBeGreaterThan(1); // the archetype is multi-hit by contract
    const s = addArmored(armoredPool, 200, 200, N);

    // First N−1 hits: the armored ABSORBS each — hp drops by 1, it is NOT released and
    // NOT reported as a kill, but each damaging hit credits exactly 1 to bulletDamageCount.
    for (let hit = 1; hit <= N - 1; hit++) {
      addBullet(bulletPool, 200, 200); // a fresh bullet overlapping it (last was consumed)
      system.fixedUpdate(DT);
      expect(s.hp).toBe(N - hit); // decremented once per hit
      expect(armoredPool.activeCount).toBe(1); // survived — still active
      expect(system.killedEnemies).not.toContain(s); // NOT a kill
      expect(system.killedEnemies.length).toBe(0);
      expect(system.bulletKillCount).toBe(0); // kill-only latch stays 0 on a survive
      expect(system.bulletDamageCount).toBe(1); // but damage WAS dealt
      expect(bulletPool.activeCount).toBe(0); // the bullet was consumed
    }

    // The Nth hit (hp === 1) runs the UNCHANGED kill path: released, reported, snapshotted.
    expect(s.hp).toBe(1);
    addBullet(bulletPool, 200, 200);
    system.fixedUpdate(DT);
    expect(armoredPool.activeCount).toBe(0); // killed
    expect(armoredPool.freeCount).toBe(1); // released to its pool
    expect(system.killedEnemies).toContain(s);
    expect(system.bulletKillCount).toBe(1);
    expect(system.bulletDamageCount).toBe(1); // the killing hit also credits 1
    // Kill snapshots recorded at the kill point (Story 4.2 / 8.1 path unchanged).
    expect(system.bulletKillX[0]).toBe(200);
    expect(system.bulletKillY[0]).toBe(200);
    expect(system.bulletKillXp.length).toBe(1);
  });

  it('damages an armored AT MOST once per tick — 3 bullets over one armored drop hp by exactly 1, consume exactly 1 bullet', () => {
    // Pins the deliberate "an enemy is damaged at most once per tick" invariant for
    // the armored path: three bullets all overlapping ONE armored in the same tick
    // must still only decrement hp by 1 (not 3) and consume only the first bullet —
    // pass 1's hitEnemies dedupe is what makes multi-hit HP well-defined per tick.
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 400, 400, 5);
    addBullet(bulletPool, 400, 400);
    addBullet(bulletPool, 400, 400);
    addBullet(bulletPool, 400, 400);

    system.fixedUpdate(DT);

    expect(s.hp).toBe(4); // dropped by exactly 1, not 3
    expect(system.bulletDamageCount).toBe(1); // one damaging hit this tick
    expect(armoredPool.activeCount).toBe(1); // survived
    expect(system.killedEnemies.length).toBe(0); // not a kill
    // Exactly one bullet consumed; the other two find no unhit target and stay active.
    expect(bulletPool.activeCount).toBe(2);
    expect(bulletPool.freeCount).toBe(1);
  });

  it('a one-hit enemy (no hp field) still credits bulletDamageCount === 1 on its killing hit', () => {
    const { bulletPool, enemyPool, system } = makeSystem();
    addBullet(bulletPool, 100, 100);
    addSeeker(enemyPool, 100, 100); // one-shot: no hp field

    system.fixedUpdate(DT);

    expect(system.bulletKillCount).toBe(1);
    expect(system.bulletDamageCount).toBe(1); // a kill IS a damaging hit
    expect(enemyPool.activeCount).toBe(0);
  });

  it('an armored with hp <= 1 is one-shot exactly like a one-hit enemy (never immune)', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 150, 150, 1); // final-hp armored

    addBullet(bulletPool, 150, 150);
    system.fixedUpdate(DT);

    expect(armoredPool.activeCount).toBe(0); // released on the first hit
    expect(system.killedEnemies).toContain(s);
    expect(system.bulletKillCount).toBe(1);
    expect(system.bulletDamageCount).toBe(1);
  });

  it('a mixed tick (one-shot kill + armored survivor) reports bulletDamageCount 2, bulletKillCount 1', () => {
    // One bullet pool, two enemy pools: a one-shot seeker and a durable armored, each
    // overlapped by its own bullet. The seeker dies; the armored survives (hp > 1). Both
    // are damaging hits, but only the seeker is a kill.
    const bulletPool = new Pool(createBullet);
    const seekerPool = new Pool(createSeeker);
    const armoredPool = new Pool(createArmored);
    const system = new CollisionSystem(bulletPool, [seekerPool, armoredPool]);

    const seeker = addSeeker(seekerPool, 100, 100);
    const armored = armoredPool.acquire();
    armored.x = 500;
    armored.y = 500;
    armored.hp = 3;
    addBullet(bulletPool, 100, 100);
    addBullet(bulletPool, 500, 500);

    system.fixedUpdate(DT);

    // Two damaging hits this tick…
    expect(system.bulletDamageCount).toBe(2);
    // …but only one KILL (the seeker); the armored absorbed its hit.
    expect(system.bulletKillCount).toBe(1);
    expect(system.killedEnemies.length).toBe(1);
    expect(system.killedEnemies[0]).toBe(seeker);
    expect(seekerPool.activeCount).toBe(0); // seeker killed
    expect(armoredPool.activeCount).toBe(1); // armored survived
    expect(armored.hp).toBe(2); // decremented once
  });

  it('re-latches bulletDamageCount each tick (a prior tick\'s damage does not carry over)', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    addArmored(armoredPool, 200, 200, ARMORED_HP);
    addBullet(bulletPool, 200, 200);
    system.fixedUpdate(DT);
    expect(system.bulletDamageCount).toBe(1);

    // Tick B: nothing overlaps (bullet consumed) → count resets to 0.
    system.fixedUpdate(DT);
    expect(system.bulletDamageCount).toBe(0);
  });

  it('a smart-bomb-style unconditional release ignores hp (AoE = full damage) — modeled by the death path, not here', () => {
    // The CollisionSystem is the ONLY place hp is decremented. The AoE paths
    // (BombSystem.detonateAt, BlackHoleSystem) release enemies unconditionally, so an
    // armored with hp > 1 is destroyed in one event regardless of hp. This asserts the
    // invariant this seam relies on: a direct pool.release() drops the armored whatever
    // its hp — the collision seam never gets a say in the AoE path.
    const { armoredPool } = makeArmoredSystem();
    const s = addArmored(armoredPool, 300, 300, ARMORED_HP);
    expect(armoredPool.activeCount).toBe(1);
    armoredPool.release(s); // the unconditional AoE release
    expect(armoredPool.activeCount).toBe(0); // gone in one event, hp untouched/ignored
    expect(s.hp).toBe(ARMORED_HP);
  });
});

describe('CollisionSystem — per-bullet damage (Story 10.2, Overcharge)', () => {
  // Same harness as the armored-HP suite, plus a damage-carrying bullet helper. Every
  // bullet the FiringSystem spawns is stamped with `base × damageMult`; this seam
  // decrements a finite-`hp` enemy by THAT value instead of a hardcoded 1.
  function makeArmoredSystem() {
    const bulletPool = new Pool(createBullet);
    const armoredPool = new Pool(createArmored);
    const system = new CollisionSystem(bulletPool, [armoredPool]);
    return { bulletPool, armoredPool, system };
  }

  function addArmored(pool, x, y, hp = ARMORED_HP) {
    const s = pool.acquire();
    s.x = x;
    s.y = y;
    s.vx = 0;
    s.vy = 0;
    s.hp = hp;
    return s;
  }

  // A bullet stamped exactly as FiringSystem would (base × damageMult).
  function addDamagingBullet(pool, x, y, damage) {
    const b = addBullet(pool, x, y);
    b.damage = damage;
    return b;
  }

  it('the COLD factory shape carries the base damage unit', () => {
    // Cold acquire only. Pool.release resets nothing, so a RECYCLED bullet still
    // carries the previous shot's damage until it is stamped again — see the
    // stamp-at-acquire obligation on the Bullet factory, and the FiringSystem test
    // that pins the stamp actually happening on every recycled acquire.
    expect(createBullet().damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
  });

  it('damageMult 1.25 kills an ARMORED_HP enemy in 4 hits (base still takes 5)', () => {
    // The headline observable: Overcharge Lv2's 1.25x crosses the 5-hp division
    // boundary — ceil(5 / 1.25) = 4, one fewer hit than base's ceil(5 / 1) = 5.
    const dmg = PLAYER_BULLET_BASE_DAMAGE * 1.25;
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 200, 200, ARMORED_HP);

    let hits = 0;
    while (armoredPool.activeCount > 0 && hits < 20) {
      addDamagingBullet(bulletPool, 200, 200, dmg);
      system.fixedUpdate(DT);
      hits++;
    }
    expect(hits).toBe(4);
    expect(system.killedEnemies).toContain(s);
    expect(system.bulletKillCount).toBe(1);

    // Base damage: the same enemy still takes the full ARMORED_HP hits.
    const base = makeArmoredSystem();
    addArmored(base.armoredPool, 200, 200, ARMORED_HP);
    let baseHits = 0;
    while (base.armoredPool.activeCount > 0 && baseHits < 20) {
      addBullet(base.bulletPool, 200, 200); // factory damage = base unit
      base.system.fixedUpdate(DT);
      baseHits++;
    }
    expect(baseHits).toBe(ARMORED_HP);
    expect(hits).toBeLessThan(baseHits);
  });

  it('decrements hp by the HITTING bullet\'s damage (fractional hp is well-defined)', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 300, 300, ARMORED_HP); // 5

    addDamagingBullet(bulletPool, 300, 300, 1.25);
    system.fixedUpdate(DT);
    expect(s.hp).toBeCloseTo(3.75, 10);
    expect(armoredPool.activeCount).toBe(1); // survived
    expect(system.bulletDamageCount).toBe(1); // still ONE integer hit-unit

    addDamagingBullet(bulletPool, 300, 300, 1.25);
    system.fixedUpdate(DT);
    expect(s.hp).toBeCloseTo(2.5, 10);

    addDamagingBullet(bulletPool, 300, 300, 1.25);
    system.fixedUpdate(DT);
    expect(s.hp).toBeCloseTo(1.25, 10);
    // Still alive, and LEFT sitting at exactly hp === damage: the survive test runs
    // BEFORE the decrement, so this hit found hp 2.5 (> 1.25) and absorbed. The NEXT
    // hit finds hp === damage, fails the survive test, and kills — see the
    // "hp exactly equal is a kill" test below.
    expect(armoredPool.activeCount).toBe(1);
  });

  it('kills when hp <= the hitting damage (hp exactly equal is a kill, not a 0-hp survivor)', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 400, 400, 1.25);
    addDamagingBullet(bulletPool, 400, 400, 1.25);
    system.fixedUpdate(DT);
    // `hp > damage` survives; equality falls through to the kill path, so no enemy
    // can be left stranded at exactly 0 hp.
    expect(armoredPool.activeCount).toBe(0);
    expect(system.killedEnemies).toContain(s);
    expect(system.bulletKillCount).toBe(1);
    expect(system.bulletDamageCount).toBe(1);
  });

  it('a single overwhelming hit kills outright (no negative hp survivor)', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 250, 250, ARMORED_HP);
    addDamagingBullet(bulletPool, 250, 250, ARMORED_HP + 3);
    system.fixedUpdate(DT);
    expect(armoredPool.activeCount).toBe(0);
    expect(system.killedEnemies).toContain(s);
    expect(system.bulletDamageCount).toBe(1); // still exactly one integer hit-unit
  });

  it.each([
    ['missing', undefined],
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -3],
    ['Infinity', Infinity],
    ['a string', '2'],
  ])(
    'falls back to PLAYER_BULLET_BASE_DAMAGE for a bullet whose damage is %s',
    (_label, value) => {
      // Hand-built fixtures and any non-FiringSystem bullet source keep the v1
      // one-hit-one-unit contract.
      const { bulletPool, armoredPool, system } = makeArmoredSystem();
      const s = addArmored(armoredPool, 200, 200, ARMORED_HP);
      const b = addBullet(bulletPool, 200, 200);
      if (value === undefined) delete b.damage;
      else b.damage = value;

      system.fixedUpdate(DT);

      expect(s.hp).toBe(ARMORED_HP - PLAYER_BULLET_BASE_DAMAGE);
      expect(armoredPool.activeCount).toBe(1);
      expect(system.bulletDamageCount).toBe(1);
    },
  );

  it('a one-shot enemy (no hp field) dies on the first hit at ANY damage', () => {
    for (const dmg of [PLAYER_BULLET_BASE_DAMAGE, 1.15, 1.6, 0.25]) {
      const { bulletPool, enemyPool, system } = makeSystem();
      const s = addSeeker(enemyPool, 100, 100); // no hp field
      addDamagingBullet(bulletPool, 100, 100, dmg);

      system.fixedUpdate(DT);

      expect(enemyPool.activeCount).toBe(0);
      expect(system.killedEnemies).toContain(s);
      expect(system.bulletKillCount).toBe(1);
      expect(system.bulletDamageCount).toBe(1);
      // Kill snapshots (coords + XP) recorded exactly as before.
      expect(system.bulletKillX[0]).toBe(100);
      expect(system.bulletKillY[0]).toBe(100);
      expect(system.bulletKillXp.length).toBe(1);
    }
  });

  it('two bullets over one armored in a tick: hp drops by exactly ONE bullet\'s damage', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 400, 400, ARMORED_HP);
    addDamagingBullet(bulletPool, 400, 400, 1.6);
    addDamagingBullet(bulletPool, 400, 400, 1.6);

    system.fixedUpdate(DT);

    expect(s.hp).toBeCloseTo(ARMORED_HP - 1.6, 10); // one decrement, not two
    expect(system.bulletDamageCount).toBe(1);
    expect(bulletPool.activeCount).toBe(1); // the second bullet stays active
    expect(bulletPool.freeCount).toBe(1); // exactly one consumed
  });

  it('applies the claiming bullet\'s damage when bullets of DIFFERENT damage overlap one armored', () => {
    // Pass 1 claims an enemy with the FIRST bullet that overlaps it (iteration order),
    // and pass 2 must apply THAT bullet's damage — not the last-seen or a default.
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 500, 500, 10);
    const first = addDamagingBullet(bulletPool, 500, 500, 1.6);
    addDamagingBullet(bulletPool, 500, 500, 1.15);

    system.fixedUpdate(DT);

    expect(s.hp).toBeCloseTo(10 - 1.6, 10); // the FIRST bullet's damage
    expect(bulletPool.activeCount).toBe(1);
    // The consumed one is the claimer.
    let stillActive = null;
    bulletPool.forEachActive((b) => {
      stillActive = b;
    });
    expect(stillActive).not.toBe(first);
  });

  it('bulletDamageCount stays an integer hit count under fractional damage (DPS ring unchanged)', () => {
    // Story 9.2's governor is calibrated on hits/sec: crediting fractional damage here
    // would re-tune it and re-open the float-drift hazard. Two armored survivors hit in
    // one tick must report exactly 2, whatever the per-bullet damage.
    const bulletPool = new Pool(createBullet);
    const armoredPool = new Pool(createArmored);
    const system = new CollisionSystem(bulletPool, [armoredPool]);
    const a = addArmored(armoredPool, 100, 100, ARMORED_HP);
    const b = addArmored(armoredPool, 600, 600, ARMORED_HP);
    addDamagingBullet(bulletPool, 100, 100, 1.6);
    addDamagingBullet(bulletPool, 600, 600, 1.15);

    system.fixedUpdate(DT);

    expect(system.bulletDamageCount).toBe(2);
    expect(Number.isInteger(system.bulletDamageCount)).toBe(true);
    expect(system.bulletKillCount).toBe(0);
    expect(a.hp).toBeCloseTo(ARMORED_HP - 1.6, 10);
    expect(b.hp).toBeCloseTo(ARMORED_HP - 1.15, 10);
  });

  // Hits to kill an enemy starting at `hp`, driven by a fresh system per run.
  function hitsToKill(hp, damage) {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    addArmored(armoredPool, 200, 200, hp);
    let hits = 0;
    while (armoredPool.activeCount > 0 && hits < 50) {
      addDamagingBullet(bulletPool, 200, 200, damage);
      system.fixedUpdate(DT);
      hits++;
    }
    expect(armoredPool.activeCount).toBe(0); // never bailed on the guard
    return hits;
  }

  it.each([
    // hp is an EXACT multiple of a damage value with no exact binary representation.
    // Naive `hp > dmg` lets a few-ULP residue survive as a phantom sliver, costing an
    // extra hit (8 / 1.6 → 6 instead of 5). HP_EPSILON is what makes the arithmetic
    // read the way a balance tuner expects.
    [8, 1.6, 5],
    [6.75, 1.35, 5],
    [4.5, 1.5, 3],
    [5.6, 1.4, 4],
  ])(
    'kills in exactly ceil(hp/dmg) when hp is an exact multiple (hp %s / dmg %s → %s hits)',
    (hp, damage, expected) => {
      expect(hitsToKill(hp, damage)).toBe(expected);
    },
  );

  it.each([
    // Base plus all five Overcharge rungs against an ARMORED_HP (5) enemy, with the
    // damage derived from the REAL registry via the REAL fold — not from literals —
    // so an authoring change to the numbers shows up here as a changed ladder.
    //
    // Read this ladder honestly: Lv1 (1.15x) is INERT — ceil(5 / 1.15) = 5, the same
    // as base — and the damage rung SATURATES at Lv2, because every value from 1.25x
    // to 1.6x lands in ceil(5 / d) = 4. That is what the PRD-mandated numbers produce
    // against the current one-shot roster (Armored is the game's only hp bearer); it
    // is a balance observation logged to the deferred-work ledger, not a defect, and
    // it resolves as HP-bearing content lands. Do NOT "fix" it by editing the
    // authored numbers or ARMORED_HP — this test exists to keep the real resolution
    // visible rather than hidden behind the single rung that happens to move.
    [0, 5],
    [1, 5],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
  ])(
    'Overcharge Lv%i takes exactly %i hits to kill an ARMORED_HP enemy',
    (level, expectedHits) => {
      const ps = createPlayerStats();
      recomputePlayerStats(ps, level > 0 ? { overcharge: level } : {}, ITEM_REGISTRY);
      const damage = PLAYER_BULLET_BASE_DAMAGE * ps.damageMult;
      expect(hitsToKill(ARMORED_HP, damage)).toBe(expectedHits);
      // Cross-check against the closed form the balance comment quotes.
      expect(expectedHits).toBe(Math.ceil(ARMORED_HP / damage));
    },
  );

  it('a higher Overcharge level never takes MORE hits to kill (monotonic ladder)', () => {
    let prev = Infinity;
    for (const level of [0, 1, 2, 3, 4, 5]) {
      const ps = createPlayerStats();
      recomputePlayerStats(ps, level > 0 ? { overcharge: level } : {}, ITEM_REGISTRY);
      const hits = hitsToKill(ARMORED_HP, PLAYER_BULLET_BASE_DAMAGE * ps.damageMult);
      expect(hits).toBeLessThanOrEqual(prev);
      prev = hits;
    }
  });

  it('leaves no phantom sliver: the killing hit is the one that reaches 0, not the one after', () => {
    // The residue this guards is real — assert it exists so the test cannot silently
    // become vacuous if the float behavior changes.
    const residue = 8 - 1.6 - 1.6 - 1.6 - 1.6 - 1.6;
    expect(residue).not.toBe(0); // ~4.44e-16 — positive, hence the epsilon
    expect(Math.abs(residue)).toBeLessThan(1e-9);
    expect(hitsToKill(8, 1.6)).toBe(5);
  });

  it.each([
    ['a denormal', 5e-324],
    ['1e-17 (below ulp(5))', 1e-17],
    ['1e-12', 1e-12],
  ])(
    'floors %s stamped damage so a finite-hp enemy stays KILLABLE',
    (_label, tinyDamage) => {
      // Unfloored this is not "very slow", it is NEVER: `hp -= dmg` is an exact float
      // no-op once dmg < ulp(hp), so hp never moves and the survive branch is taken
      // forever while bulletDamageCount keeps crediting the DPS governor a hit per
      // tick. The clamp is the damage-side counterpart of FIRE_INTERVAL_FLOOR_MS.
      const expectedHits = Math.ceil(ARMORED_HP / PLAYER_BULLET_MIN_DAMAGE); // 500
      const { bulletPool, armoredPool, system } = makeArmoredSystem();
      addArmored(armoredPool, 200, 200, ARMORED_HP);
      let hits = 0;
      while (armoredPool.activeCount > 0 && hits < expectedHits + 10) {
        addDamagingBullet(bulletPool, 200, 200, tinyDamage);
        system.fixedUpdate(DT);
        hits++;
      }
      expect(armoredPool.activeCount).toBe(0); // killable at all — the whole point
      expect(hits).toBe(expectedHits); // clamped to the floor, so ceil(hp / floor)
    },
  );

  it('does NOT clamp a damage at or above the floor (the floor is not a balance lever)', () => {
    // Every authored value is >= the base unit (1), 100x above the floor, so the
    // clamp must be invisible to real content.
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const s = addArmored(armoredPool, 200, 200, ARMORED_HP);
    // Strictly ABOVE the floor: at exactly the floor, Math.max(floor, d) === d whether
    // the clamp is present or absent, so the assertion could not fail for the property
    // in the title. 3x the floor is still far below every authored value.
    const above = PLAYER_BULLET_MIN_DAMAGE * 3;
    addDamagingBullet(bulletPool, 200, 200, above);
    system.fixedUpdate(DT);
    expect(s.hp).toBeCloseTo(ARMORED_HP - above, 12);
    expect(PLAYER_BULLET_MIN_DAMAGE).toBeLessThan(PLAYER_BULLET_BASE_DAMAGE);
    expect(PLAYER_BULLET_MIN_DAMAGE).toBeGreaterThan(0);
  });

  it('reuses the hit-enemy Map across ticks, pre-cleared (no per-tick allocation)', () => {
    const { bulletPool, armoredPool, system } = makeArmoredSystem();
    const ref = system._hitEnemies;
    expect(ref).toBeInstanceOf(Map);
    addArmored(armoredPool, 200, 200, ARMORED_HP);
    addDamagingBullet(bulletPool, 200, 200, 1.25);
    system.fixedUpdate(DT);
    expect(system._hitEnemies).toBe(ref);
    expect(ref.size).toBe(1);
    // A tick with no overlap clears it (a stale entry would double-damage next tick).
    system.fixedUpdate(DT);
    expect(system._hitEnemies).toBe(ref);
    expect(ref.size).toBe(0);
  });
});

describe('createArmored base values (Story 9.3)', () => {
  it('gives a fresh armored full hp, base score, and base xp', () => {
    const a = createArmored();
    expect(a.hp).toBe(ARMORED_HP);
    // Distinguished from the one-hit archetypes by carrying a finite hp > 1.
    expect(Number.isFinite(a.hp)).toBe(true);
    expect(a.hp).toBeGreaterThan(1);
    // The per-type economy is carried on each instance (score/xp) — pin both so a
    // copy-paste swap of the factory's adjacent score/xp lines cannot ship a warped
    // economy with a green suite.
    expect(a.score).toBe(ARMORED_SCORE);
    expect(a.xp).toBe(ARMORED_XP);
  });
});

describe('createSeeker base value', () => {
  it('gives a fresh seeker the base SEEKER_SCORE value', () => {
    expect(createSeeker().score).toBe(SEEKER_SCORE);
  });

  it('gives a fresh seeker the base SEEKER_XP value (Story 8.1)', () => {
    expect(createSeeker().xp).toBe(SEEKER_XP);
  });

  it('gives a fresh green square the base GREEN_SQUARE_SCORE value', () => {
    expect(createGreenSquare().score).toBe(GREEN_SQUARE_SCORE);
  });
});

// --- applyPlayerDamage: the single player-damage path (Story 10.5) -----------
// Pass 2 was extracted verbatim into this public helper so a LATER system (DashSystem)
// can append kills through the SAME armor-respecting path bullets use. The existing
// bullet-vs-armor / bullet-vs-one-shot coverage above is the byte-identity proof — it
// passes UNEDITED against the extracted implementation. These cases pin the helper's own
// contract, and in particular that it stays correct when called MORE THAN ONCE outside
// fixedUpdate (the dash's usage), which is what the counter-increment rewrite enabled.
describe('CollisionSystem — applyPlayerDamage (the shared damage path)', () => {
  it('returns TRUE and reports a full kill for a one-shot enemy', () => {
    const { enemyPool, system } = makeSystem();
    const e = addSeeker(enemyPool, 100, 200);
    e.xp = 9;
    const killed = system.applyPlayerDamage(e, enemyPool, 1);
    expect(killed).toBe(true);
    expect(system.killedEnemies).toEqual([e]);
    expect(system.bulletKillCount).toBe(1);
    expect(system.bulletDamageCount).toBe(1);
    expect(system.bulletKillX).toEqual([100]);
    expect(system.bulletKillY).toEqual([200]);
    expect(system.bulletKillXp).toEqual([9]);
    expect(enemyPool.activeCount).toBe(0);
  });

  it('returns FALSE for an armored survivor: hp drops, no kill, but damage IS credited', () => {
    const armoredPool = new Pool(createArmored);
    const system = new CollisionSystem(new Pool(createBullet), [armoredPool]);
    const e = armoredPool.acquire();
    e.hp = ARMORED_HP;
    const killed = system.applyPlayerDamage(e, armoredPool, 1);
    expect(killed).toBe(false);
    expect(e.hp).toBeCloseTo(ARMORED_HP - 1, 10);
    expect(system.killedEnemies).toHaveLength(0);
    expect(system.bulletKillCount).toBe(0);
    expect(system.bulletDamageCount).toBe(1); // the Story 9.2 governor still sees it
    expect(armoredPool.activeCount).toBe(1);
  });

  it('keeps the counters and the parallel snapshots INDEX-ALIGNED across repeated calls', () => {
    // The dash's usage: several calls outside fixedUpdate, interleaving survivors and
    // kills. `bulletKillCount` must count KILLS only, and index k of every snapshot
    // array must belong to the k-th kill.
    const seekers = new Pool(createSeeker);
    const armored = new Pool(createArmored);
    const system = new CollisionSystem(new Pool(createBullet), [seekers, armored]);
    const a = addSeeker(seekers, 1, 2);
    a.xp = 11;
    const tank = armored.acquire();
    tank.hp = ARMORED_HP;
    const b = addSeeker(seekers, 3, 4);
    b.xp = 22;

    expect(system.applyPlayerDamage(a, seekers, 1)).toBe(true);
    expect(system.applyPlayerDamage(tank, armored, 1)).toBe(false);
    expect(system.applyPlayerDamage(b, seekers, 1)).toBe(true);

    expect(system.bulletKillCount).toBe(2);
    expect(system.bulletDamageCount).toBe(3);
    expect(system.killedEnemies).toEqual([a, b]);
    expect(system.bulletKillX).toEqual([1, 3]);
    expect(system.bulletKillY).toEqual([2, 4]);
    expect(system.bulletKillXp).toEqual([11, 22]);
    // killedEnemies[0 .. bulletKillCount) is exactly the player-damage kills.
    expect(system.killedEnemies.slice(0, system.bulletKillCount)).toEqual([a, b]);
  });

  it('routes each kill to the pool it was GIVEN, not to a guessed owner', () => {
    const seekers = new Pool(createSeeker);
    const squares = new Pool(createGreenSquare);
    const system = new CollisionSystem(new Pool(createBullet), [seekers, squares]);
    const s = addSeeker(seekers, 0, 0);
    const g = squares.acquire();
    system.applyPlayerDamage(s, seekers, 1);
    system.applyPlayerDamage(g, squares, 1);
    expect(seekers.activeCount).toBe(0);
    expect(squares.activeCount).toBe(0);
    expect(seekers.freeCount).toBe(1);
    expect(squares.freeCount).toBe(1);
  });

  it('guards a NON-FINITE xp to 0 (a malformed instance never poisons the XP snapshot)', () => {
    const { enemyPool, system } = makeSystem();
    const e = addSeeker(enemyPool, 0, 0);
    e.xp = NaN;
    system.applyPlayerDamage(e, enemyPool, 1);
    expect(system.bulletKillXp).toEqual([0]);
  });

  it('the top-of-tick reset is the ONLY place the counters are zeroed', () => {
    // Helper-appended state from a later system must survive to end-of-tick (so it is
    // scored / rippled / orbed) and then be cleared by the NEXT fixedUpdate.
    const { enemyPool, system } = makeSystem();
    system.fixedUpdate(DT);
    const e = addSeeker(enemyPool, 0, 0);
    system.applyPlayerDamage(e, enemyPool, 1); // "a later system this tick"
    expect(system.bulletKillCount).toBe(1);
    expect(system.killedEnemies).toHaveLength(1);
    system.fixedUpdate(DT);
    expect(system.bulletKillCount).toBe(0);
    expect(system.bulletDamageCount).toBe(0);
    expect(system.killedEnemies).toHaveLength(0);
    expect(system.bulletKillX).toHaveLength(0);
  });
});

// --- Story 11.5 (Ricochet Rounds): bounce-off-enemy instead of consume ------------
describe('CollisionSystem — Ricochet enemy bounce (Story 11.5)', () => {
  // Bullet + seeker (one-shot) and armored (hp) pools, each its own owning pool.
  function makeRicochetSystem() {
    const bulletPool = new Pool(createBullet);
    const seekerPool = new Pool(createSeeker);
    const armoredPool = new Pool(createArmored);
    const system = new CollisionSystem(bulletPool, [seekerPool, armoredPool]);
    return { bulletPool, seekerPool, armoredPool, system };
  }

  function addRicochetBullet(pool, x, y, opts = {}) {
    const b = pool.acquire();
    b.x = x;
    b.y = y;
    b.vx = 900; // moving +x, so a leftward enemy normal reflects it to -x
    b.vy = 0;
    b.damage = opts.damage ?? 1;
    b.dmgPerBounce = opts.dmgPerBounce ?? 0;
    b.bounceOffEnemies = opts.bounceOffEnemies ?? false;
    b.bouncesRemaining = opts.bouncesRemaining ?? 0;
    b.bounced = false;
    return b;
  }

  function addSeekerAt(pool, x, y) {
    const s = pool.acquire();
    s.x = x;
    s.y = y;
    s.vx = 0;
    s.vy = 0;
    return s;
  }

  function addArmoredAt(pool, x, y, hp = ARMORED_HP) {
    const s = pool.acquire();
    s.x = x;
    s.y = y;
    s.vx = 0;
    s.vy = 0;
    s.hp = hp;
    return s;
  }

  it('Lv4 bullet with budget KILLS a one-shot enemy AND bounces off it (stays live)', () => {
    const { bulletPool, seekerPool, system } = makeRicochetSystem();
    const b = addRicochetBullet(bulletPool, 95, 100, {
      bounceOffEnemies: true,
      bouncesRemaining: 2,
      dmgPerBounce: 0.25,
      damage: 4,
    });
    addSeekerAt(seekerPool, 100, 100); // overlaps the bullet (dist 5 <= r)

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(0); // enemy killed via applyPlayerDamage
    expect(bulletPool.activeCount).toBe(1); // bullet NOT consumed
    expect(b.bouncesRemaining).toBe(1); // one bounce spent
    expect(b.bounced).toBe(true);
    expect(b.damage).toBeCloseTo(5, 9); // grown once: 4 * 1.25
    expect(b.vx).toBeCloseTo(-900, 6); // reflected off the leftward surface normal
    expect(system.bulletKillCount).toBe(1); // kill still scored/reported
  });

  it('a bullet with budget SPENT (0) is CONSUMED on the enemy hit — the pre-11.5 path', () => {
    const { bulletPool, seekerPool, system } = makeRicochetSystem();
    addRicochetBullet(bulletPool, 95, 100, {
      bounceOffEnemies: true,
      bouncesRemaining: 0, // exhausted
      damage: 4,
    });
    addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(0); // enemy killed
    expect(bulletPool.activeCount).toBe(0); // bullet consumed (released)
  });

  it('an unowned bullet (no enemy-bounce flag) is consumed exactly as before this story', () => {
    const { bulletPool, seekerPool, system } = makeRicochetSystem();
    addRicochetBullet(bulletPool, 95, 100, {
      bounceOffEnemies: false, // unowned / not enemy-bouncing
      bouncesRemaining: 2, // budget present but the flag gates it
      damage: 1,
    });
    addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(0);
    expect(bulletPool.activeCount).toBe(0); // consumed
  });

  it('a bounced bullet still hits at most ONE enemy per tick', () => {
    const { bulletPool, seekerPool, system } = makeRicochetSystem();
    addRicochetBullet(bulletPool, 100, 100, {
      bounceOffEnemies: true,
      bouncesRemaining: 3,
      damage: 4,
    });
    // Two enemies at the same overlapping spot.
    addSeekerAt(seekerPool, 100, 100);
    addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(1); // exactly ONE killed this tick
    expect(bulletPool.activeCount).toBe(1); // bullet survives (one bounce spent)
  });

  it('records the enemy hit at the PRE-growth damage (armored takes the arrival value)', () => {
    const { bulletPool, armoredPool, system } = makeRicochetSystem();
    const b = addRicochetBullet(bulletPool, 95, 100, {
      bounceOffEnemies: true,
      bouncesRemaining: 2,
      dmgPerBounce: 0.25,
      damage: 4,
    });
    const armored = addArmoredAt(armoredPool, 100, 100, ARMORED_HP); // hp 5

    system.fixedUpdate(DT);

    // The hit applied 4 (pre-growth), so the armored SURVIVES at hp 1 (not killed).
    expect(armoredPool.activeCount).toBe(1);
    expect(armored.hp).toBeCloseTo(ARMORED_HP - 4, 9); // 5 - 4 = 1
    // The bullet then grew to 5 and stays live with a bounce spent.
    expect(b.damage).toBeCloseTo(5, 9);
    expect(b.bouncesRemaining).toBe(1);
    expect(bulletPool.activeCount).toBe(1);
  });
});

// --- Story 12.6 (Sunburst): bullet piercing --------------------------------
describe('CollisionSystem — bullet piercing (Story 12.6)', () => {
  function makePierceSystem() {
    const bulletPool = new Pool(createBullet);
    const seekerPool = new Pool(createSeeker);
    const system = new CollisionSystem(bulletPool, [seekerPool]);
    return { bulletPool, seekerPool, system };
  }

  function addPiercingBullet(pool, x, y, opts = {}) {
    const b = pool.acquire();
    b.x = x;
    b.y = y;
    b.vx = 900;
    b.vy = 0;
    b.damage = opts.damage ?? 1;
    b.pierceRemaining = opts.pierceRemaining ?? 0;
    return b;
  }

  it('pierceRemaining=2: first hit, bullet NOT consumed, pierce decremented to 1', () => {
    const { bulletPool, seekerPool, system } = makePierceSystem();
    const b = addPiercingBullet(bulletPool, 95, 100, { pierceRemaining: 2 });
    const s = addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    // Seeker has no .hp (one-shot by default); verify kill via pool state.
    expect(seekerPool.activeCount).toBe(0); // enemy killed
    expect(bulletPool.activeCount).toBe(1); // bullet NOT consumed
    expect(b.pierceRemaining).toBe(1); // decremented by 1
    expect(system.bulletKillCount).toBe(1); // kill still scored
  });

  it('pierceRemaining=1: second hit, bullet consumed, pierce decremented to 0', () => {
    const { bulletPool, seekerPool, system } = makePierceSystem();
    const b = addPiercingBullet(bulletPool, 95, 100, { pierceRemaining: 1 });
    addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(0); // enemy killed
    expect(bulletPool.activeCount).toBe(0); // bullet consumed
    expect(b.pierceRemaining).toBe(0); // decremented to 0
    expect(system.bulletKillCount).toBe(1);
  });

  it('pierceRemaining=0: normal one-hit consume', () => {
    const { bulletPool, seekerPool, system } = makePierceSystem();
    const b = addPiercingBullet(bulletPool, 95, 100, { pierceRemaining: 0 });
    addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    expect(seekerPool.activeCount).toBe(0);
    expect(bulletPool.activeCount).toBe(0); // consumed as normal
    expect(b.pierceRemaining).toBe(0);
  });

  it('pierceRemaining=3: high pierce, bullet NOT consumed after first hit', () => {
    const { bulletPool, seekerPool, system } = makePierceSystem();
    const b = addPiercingBullet(bulletPool, 95, 100, { pierceRemaining: 3 });
    addSeekerAt(seekerPool, 100, 100);

    system.fixedUpdate(DT);

    expect(bulletPool.activeCount).toBe(1); // bullet NOT consumed
    expect(b.pierceRemaining).toBe(2); // decremented from 3 to 2
  });

  it('ring bullet exits arena: released on arena exit, pierceRemaining unchanged', () => {
    // A pierce bullet that never hits any enemy should still be usable normally.
    // This tests that a bullet with pierceRemaining > 0 that doesn't hit an enemy
    // passes through the collision system unchanged (not added to hitBullets).
    const { bulletPool, seekerPool, system } = makePierceSystem();
    // Place seeker far from bullet so it never collides
    addSeekerAt(seekerPool, 800, 800);
    // Place the bullet away from any enemy
    const b = addPiercingBullet(bulletPool, 100, 100, { pierceRemaining: 2 });
    b.vx = 900;

    system.fixedUpdate(DT);

    // The bullet should still be active (no collision happened) and pierce unchanged
    expect(bulletPool.activeCount).toBe(1);
    expect(b.pierceRemaining).toBe(2);
    // The bullet is NOT in hitBullets since it didn't hit anything
    expect(system._hitBullets.has(b)).toBe(false);
  });
});

function addSeekerAt(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  return s;
}
