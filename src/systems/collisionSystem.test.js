import { describe, it, expect } from 'vitest';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import { createArmored } from '../entities/Armored.js';
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
