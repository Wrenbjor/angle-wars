import { describe, it, expect } from 'vitest';
import { GreenSquareSystem } from './GreenSquareSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import {
  FIXED_STEP_MS, GREEN_SQUARE_CHASE_SPEED, GREEN_SQUARE_POOL_PREWARM,
  GREEN_SQUARE_AVOID_RADIUS, ENEMY_SPAWN_TELEGRAPH_MS,
} from '../config/constants.js';

function place(system, x = 200, y = 200) {
  const s = system.enemyPool.acquire();
  Object.assign(s, { x, y, vx: 0, vy: 0, telegraphMs: 0, stunMs: 0 });
  return s;
}

describe('GreenSquareSystem — pursuit with predictive bullet avoidance', () => {
  it('continuously pursues at the authored chase speed with no nearby bullet', () => {
    const bullets = new Pool(createBullet);
    const system = new GreenSquareSystem({ x: 600, y: 200 }, bullets, () => 0.5);
    const s = place(system);
    system.fixedUpdate(FIXED_STEP_MS);
    expect(s.vx).toBeCloseTo(GREEN_SQUARE_CHASE_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
  });

  it('steers away from the nearest predicted trajectory, then resumes pursuit', () => {
    const bullets = new Pool(createBullet);
    const system = new GreenSquareSystem({ x: 600, y: 200 }, bullets, () => 0.5);
    const s = place(system);
    const b = bullets.acquire();
    Object.assign(b, { x: s.x, y: s.y - GREEN_SQUARE_AVOID_RADIUS / 2, vx: 0, vy: 100 });
    system.fixedUpdate(FIXED_STEP_MS);
    expect(Number.isFinite(s.vx) && Number.isFinite(s.vy)).toBe(true);
    expect(s.vy).toBeGreaterThan(0);
    bullets.release(b);
    system.fixedUpdate(FIXED_STEP_MS);
    expect(s.vx).toBeGreaterThan(0);
    expect(Math.abs(s.vy)).toBeLessThan(GREEN_SQUARE_CHASE_SPEED);
  });

  it('evades a fast collision-course bullet before the lookahead endpoint', () => {
    const bullets = new Pool(createBullet);
    const system = new GreenSquareSystem({ x: 600, y: 200 }, bullets, () => 0.5);
    const s = place(system);
    const b = bullets.acquire();
    Object.assign(b, { x: 100, y: 200, vx: 900, vy: 0 });
    system.fixedUpdate(FIXED_STEP_MS);
    expect(Math.abs(s.vy)).toBeGreaterThan(0);
  });

  it('does not evade a bullet moving away from the square', () => {
    const bullets = new Pool(createBullet);
    const system = new GreenSquareSystem({ x: 600, y: 200 }, bullets, () => 0.5);
    const s = place(system);
    const b = bullets.acquire();
    Object.assign(b, { x: 100, y: 200, vx: -900, vy: 0 });
    system.fixedUpdate(FIXED_STEP_MS);
    expect(s.vx).toBeCloseTo(GREEN_SQUARE_CHASE_SPEED, 6);
    expect(s.vy).toBeCloseTo(0, 6);
  });

  it('is frame-step independent during unobstructed pursuit', () => {
    const run = (dt, count) => {
      const system = new GreenSquareSystem({ x: 1000, y: 200 }, new Pool(createBullet), () => 0.5);
      const s = place(system);
      for (let i = 0; i < count; i++) system.fixedUpdate(dt);
      return s.x;
    };
    expect(run(10, 40)).toBeCloseTo(run(20, 20), 8);
  });

  it('multiple and zero-distance bullet threats remain finite and deterministic', () => {
    const run = () => {
      const bullets = new Pool(createBullet);
      const system = new GreenSquareSystem({ x: 500, y: 400 }, bullets, () => 0.5);
      const s = place(system, 300, 300);
      for (let i = 0; i < 3; i++) {
        const b = bullets.acquire(); Object.assign(b, { x: 300 + i, y: 300, vx: -i, vy: i });
      }
      system.fixedUpdate(FIXED_STEP_MS);
      return [s.x, s.y, s.vx, s.vy];
    };
    expect(run()).toEqual(run());
    expect(run().every(Number.isFinite)).toBe(true);
  });

  it('clamps at walls without reflecting, allowing bullet pressure to pin it', () => {
    const bullets = new Pool(createBullet);
    const system = new GreenSquareSystem({ x: 2000, y: 200 }, bullets, () => 0.5);
    const s = place(system, 1521, 200);
    system.fixedUpdate(FIXED_STEP_MS);
    expect(s.x).toBe(1521);
    expect(s.vx).toBeGreaterThan(0);
  });

  it('telegraphs, resets recycled state, and prewarms its pool', () => {
    const system = new GreenSquareSystem({ x: 500, y: 300 }, new Pool(createBullet), () => 0.5);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(GREEN_SQUARE_POOL_PREWARM);
    system.spawn();
    let spawned;
    system.enemyPool.forEachActive((s) => { spawned = s; });
    expect(spawned.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(spawned.aggro).toBe(true);
    expect(spawned.vx).toBe(0);
  });
});
