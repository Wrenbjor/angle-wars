// Pool — a generic object pool with zero per-frame allocation on the reuse path.
//
// High-churn entities (bullets, enemies) are acquired and released many times
// per second. Allocating a fresh object each time creates GC pressure that
// shows up as frame hitches. This pool keeps a stack of idle instances and an
// active set; `acquire()` recycles an idle instance when one exists and only
// falls back to the factory when the free list is empty (lazy growth).
//
// Phaser-free by design so it can be unit-tested headlessly.
export class Pool {
  /**
   * @param {() => T} factory Creates a new instance when none can be recycled.
   * @template T
   */
  constructor(factory) {
    if (typeof factory !== 'function') {
      throw new TypeError('Pool requires a factory function');
    }
    this._factory = factory;
    /** @type {T[]} idle instances available for reuse (stack). */
    this._free = [];
    /** @type {Set<T>} instances currently checked out. */
    this._active = new Set();
  }

  /**
   * Check out an instance. Recycles an idle one if available (no allocation),
   * otherwise creates one via the factory. The caller is responsible for
   * (re)initializing the returned instance's fields.
   * @returns {T}
   */
  acquire() {
    // Reuse path: pop() mutates in place — no allocation, no rest/spread.
    const obj = this._free.length > 0 ? this._free.pop() : this._factory();
    // Fail fast on a broken factory rather than tracking garbage as active.
    if (obj == null) {
      throw new TypeError('Pool factory returned a nullish value');
    }
    this._active.add(obj);
    return obj;
  }

  /**
   * Return an instance to the pool for later reuse. Only instances that are
   * currently active are accepted; releasing an unknown/idle object is a no-op
   * so double-release cannot corrupt the free stack.
   * @param {T} obj
   * @returns {boolean} true if the instance was active and has been released.
   */
  release(obj) {
    if (!this._active.delete(obj)) {
      return false;
    }
    this._free.push(obj);
    return true;
  }

  /** Number of instances currently checked out. */
  get activeCount() {
    return this._active.size;
  }

  /** Number of idle instances available for reuse. */
  get freeCount() {
    return this._free.length;
  }

  /**
   * Iterate the active instances, invoking `fn(instance)` for each. Useful for
   * systems that update every live entity without materializing an array.
   *
   * WARNING: `fn` must NOT `release()` the currently-visited instance, nor
   * otherwise add/remove active entries during iteration — mutating the active
   * Set mid-iteration is unsafe. Defer any releases until after iteration
   * completes (e.g. collect them into a list and release in a second pass).
   * @param {(obj:T)=>void} fn
   */
  forEachActive(fn) {
    for (const obj of this._active) {
      fn(obj);
    }
  }

  /**
   * Release every instance and empty both lists. Intended for scene
   * teardown/restart so no pooled instances leak across runs.
   */
  clear() {
    this._free.length = 0;
    this._active.clear();
  }
}
