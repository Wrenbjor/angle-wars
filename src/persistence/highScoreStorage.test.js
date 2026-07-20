import { describe, it, expect } from 'vitest';
import { createHighScoreStorage } from './highScoreStorage.js';
import { HIGH_SCORE_STORAGE_KEY } from '../config/constants.js';

// highScoreStorage — the guarded browser-storage seam (Story 3.4 / FR11).
//
// These tests lock the guarded-port contract HEADLESSLY (node env, no jsdom) by
// injecting fake Storage-like objects: a real-ish in-memory map, a null store, and
// throwing stubs. They pin every row of the spec's storage edge-case matrix:
// valid parse, missing key, corrupt/empty/negative/zero → 0, correct write form,
// and no-throw degradation when the store is absent or throwing.

// A minimal in-memory Storage-like fake (getItem/setItem over a Map).
function makeFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    // Test-only introspection helper.
    _map: map,
  };
}

describe('createHighScoreStorage — load() parse/guard', () => {
  it('parses a valid stored integer', () => {
    const storage = makeFakeStorage({ [HIGH_SCORE_STORAGE_KEY]: '4200' });
    const port = createHighScoreStorage(storage);
    expect(port.load()).toBe(4200);
  });

  it('returns 0 when the key is missing', () => {
    const port = createHighScoreStorage(makeFakeStorage());
    expect(port.load()).toBe(0);
  });

  it('returns 0 for a corrupt / non-numeric value', () => {
    const port = createHighScoreStorage(
      makeFakeStorage({ [HIGH_SCORE_STORAGE_KEY]: 'abc' }),
    );
    expect(port.load()).toBe(0);
  });

  it('returns 0 for an empty string', () => {
    const port = createHighScoreStorage(
      makeFakeStorage({ [HIGH_SCORE_STORAGE_KEY]: '' }),
    );
    expect(port.load()).toBe(0);
  });

  it('returns 0 for a negative value', () => {
    const port = createHighScoreStorage(
      makeFakeStorage({ [HIGH_SCORE_STORAGE_KEY]: '-5' }),
    );
    expect(port.load()).toBe(0);
  });

  it('returns 0 for a stored zero', () => {
    const port = createHighScoreStorage(
      makeFakeStorage({ [HIGH_SCORE_STORAGE_KEY]: '0' }),
    );
    expect(port.load()).toBe(0);
  });

  it('parses the integer prefix of a mixed value (parseInt semantics)', () => {
    // "500abc" → 500; a real high score, not corrupt garbage.
    const port = createHighScoreStorage(
      makeFakeStorage({ [HIGH_SCORE_STORAGE_KEY]: '500abc' }),
    );
    expect(port.load()).toBe(500);
  });
});

describe('createHighScoreStorage — save() write form', () => {
  it('writes String(score) under the centralized key', () => {
    const storage = makeFakeStorage();
    const port = createHighScoreStorage(storage);
    port.save(12345);
    expect(storage._map.get(HIGH_SCORE_STORAGE_KEY)).toBe('12345');
  });

  it('a save is readable back through the same port (round-trip)', () => {
    const storage = makeFakeStorage();
    const port = createHighScoreStorage(storage);
    port.save(9001);
    expect(port.load()).toBe(9001);
  });
});

describe('createHighScoreStorage — degradation when storage is absent', () => {
  it('load() returns 0 with a null store', () => {
    const port = createHighScoreStorage(null);
    expect(port.load()).toBe(0);
  });

  it('save() is a no-op (no throw) with a null store', () => {
    const port = createHighScoreStorage(null);
    expect(() => port.save(500)).not.toThrow();
  });
});

describe('createHighScoreStorage — default-store acquisition never throws', () => {
  // The default parameter (defaultLocalStorage()) is evaluated at call time
  // OUTSIDE the per-method try/catch. In sandboxed iframes / storage-disabled
  // browsers, merely reading `globalThis.localStorage` throws SecurityError, so
  // the factory itself must not throw when called with no args — otherwise
  // ArenaScene.create() would crash at exactly the blocked-store case this module
  // exists to survive. We simulate that by making the property access throw.
  it('createHighScoreStorage() with a throwing globalThis.localStorage does not throw and degrades to a no-op', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: access to localStorage is denied');
      },
    });
    try {
      let port;
      expect(() => {
        port = createHighScoreStorage(); // no args → guarded default acquisition
      }).not.toThrow();
      expect(port.load()).toBe(0);
      expect(() => port.save(500)).not.toThrow();
    } finally {
      // Restore the original property so no other test observes the throwing stub.
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });
});

describe('createHighScoreStorage — degradation when storage throws', () => {
  const throwingStorage = {
    getItem() {
      throw new Error('blocked (private mode)');
    },
    setItem() {
      throw new Error('quota exceeded');
    },
  };

  it('load() returns 0 when getItem throws', () => {
    const port = createHighScoreStorage(throwingStorage);
    expect(port.load()).toBe(0);
  });

  it('save() swallows a throwing setItem (no throw)', () => {
    const port = createHighScoreStorage(throwingStorage);
    expect(() => port.save(500)).not.toThrow();
  });
});
