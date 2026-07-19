import { describe, it, expect } from 'vitest';
import { CollisionSystem } from './CollisionSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import {
  FIXED_STEP_MS,
  BULLET_RADIUS,
  SEEKER_RADIUS,
  SEEKER_SCORE,
  GREEN_SQUARE_SCORE,
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

describe('createSeeker base value', () => {
  it('gives a fresh seeker the base SEEKER_SCORE value', () => {
    expect(createSeeker().score).toBe(SEEKER_SCORE);
  });

  it('gives a fresh green square the base GREEN_SQUARE_SCORE value', () => {
    expect(createGreenSquare().score).toBe(GREEN_SQUARE_SCORE);
  });
});
