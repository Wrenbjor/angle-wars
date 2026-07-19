import { describe, it, expect, vi } from 'vitest';
import { Pool } from './Pool.js';

describe('Pool', () => {
  it('reuses the same instance on acquire -> release -> acquire', () => {
    // Matrix: Pool reuse — the recycled instance is returned, no new alloc.
    let created = 0;
    const pool = new Pool(() => ({ id: created++ }));

    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();

    expect(b).toBe(a); // same recycled instance
    expect(created).toBe(1); // factory ran only once — no reuse-path allocation
    expect(pool.activeCount).toBe(1);
    expect(pool.freeCount).toBe(0);
  });

  it('grows on demand when the free list is empty', () => {
    // Matrix: Pool grows on demand — factory creates, activeCount increments.
    const factory = vi.fn(() => ({}));
    const pool = new Pool(factory);

    expect(pool.activeCount).toBe(0);
    const a = pool.acquire();
    const b = pool.acquire();

    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(pool.activeCount).toBe(2);
    expect(pool.freeCount).toBe(0);
  });

  it('tracks active and free counts across release', () => {
    const pool = new Pool(() => ({}));
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.activeCount).toBe(2);

    expect(pool.release(a)).toBe(true);
    expect(pool.activeCount).toBe(1);
    expect(pool.freeCount).toBe(1);

    // Releasing an already-idle instance is a no-op and does not corrupt state.
    expect(pool.release(a)).toBe(false);
    expect(pool.freeCount).toBe(1);
    expect(pool.activeCount).toBe(1);
    expect(b).toBeDefined();
  });

  it('release of an unknown object is a no-op', () => {
    const pool = new Pool(() => ({}));
    expect(pool.release({})).toBe(false);
    expect(pool.freeCount).toBe(0);
  });

  it('forEachActive visits every checked-out instance', () => {
    const pool = new Pool(() => ({}));
    const a = pool.acquire();
    const b = pool.acquire();
    const seen = new Set();
    pool.forEachActive((o) => seen.add(o));
    expect(seen.has(a)).toBe(true);
    expect(seen.has(b)).toBe(true);
    expect(seen.size).toBe(2);
  });

  it('throws when constructed without a factory function', () => {
    expect(() => new Pool()).toThrow(TypeError);
  });

  it('throws when the factory returns a nullish value', () => {
    const pool = new Pool(() => null);
    expect(() => pool.acquire()).toThrow(TypeError);
  });

  it('clear() empties both active and free lists', () => {
    const pool = new Pool(() => ({}));
    const a = pool.acquire();
    pool.acquire();
    pool.release(a);
    expect(pool.activeCount).toBe(1);
    expect(pool.freeCount).toBe(1);

    pool.clear();
    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(0);
  });
});
