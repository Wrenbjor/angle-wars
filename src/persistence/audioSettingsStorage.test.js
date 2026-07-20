import { describe, it, expect } from 'vitest';
import { createAudioSettingsStorage } from './audioSettingsStorage.js';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  AUDIO_MUTED_DEFAULT,
  AUDIO_MASTER_VOLUME_DEFAULT,
} from '../config/constants.js';

// audioSettingsStorage — the guarded {muted, volume} browser-storage seam (Story
// 4.5). These tests lock the guarded-port contract HEADLESSLY (node env, no jsdom)
// by injecting fake Storage-like objects: an in-memory map, a null store, and
// throwing stubs. They pin every row of the spec's storage edge-case matrix: default
// (empty), valid, corrupt/non-JSON, out-of-range volume clamp, round-trip save, and
// no-throw degradation when the store is absent or throwing.

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
    _map: map, // test-only introspection
  };
}

describe('createAudioSettingsStorage — load() defaults', () => {
  it('returns the defaults for an empty store (missing key)', () => {
    const port = createAudioSettingsStorage(makeFakeStorage());
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });

  it('returns the defaults for an empty-string value', () => {
    const port = createAudioSettingsStorage(
      makeFakeStorage({ [AUDIO_SETTINGS_STORAGE_KEY]: '' }),
    );
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });
});

describe('createAudioSettingsStorage — load() valid + coercion', () => {
  it('parses a valid stored {muted, volume}', () => {
    const port = createAudioSettingsStorage(
      makeFakeStorage({
        [AUDIO_SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: true, volume: 0.3 }),
      }),
    );
    expect(port.load()).toEqual({ muted: true, volume: 0.3 });
  });

  it('clamps an out-of-range stored volume into [0,1]', () => {
    const hi = createAudioSettingsStorage(
      makeFakeStorage({
        [AUDIO_SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: false, volume: 5 }),
      }),
    );
    expect(hi.load()).toEqual({ muted: false, volume: 1 });

    const lo = createAudioSettingsStorage(
      makeFakeStorage({
        [AUDIO_SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: false, volume: -2 }),
      }),
    );
    expect(lo.load()).toEqual({ muted: false, volume: 0 });
  });

  it('falls back to defaults for wrong-typed fields (non-boolean muted / non-number volume)', () => {
    const port = createAudioSettingsStorage(
      makeFakeStorage({
        [AUDIO_SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: 'yes', volume: 'loud' }),
      }),
    );
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });
});

describe('createAudioSettingsStorage — load() corrupt / non-JSON', () => {
  it('returns the defaults for a non-JSON value', () => {
    const port = createAudioSettingsStorage(
      makeFakeStorage({ [AUDIO_SETTINGS_STORAGE_KEY]: 'not json' }),
    );
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });

  it('returns the defaults for a JSON primitive (not an object)', () => {
    const port = createAudioSettingsStorage(
      makeFakeStorage({ [AUDIO_SETTINGS_STORAGE_KEY]: '42' }),
    );
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });
});

describe('createAudioSettingsStorage — save() round-trip + write form', () => {
  it('writes JSON under the centralized key and reads back through the port', () => {
    const storage = makeFakeStorage();
    const port = createAudioSettingsStorage(storage);
    port.save({ muted: true, volume: 0.25 });
    expect(storage._map.get(AUDIO_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ muted: true, volume: 0.25 }),
    );
    expect(port.load()).toEqual({ muted: true, volume: 0.25 });
  });

  it('clamps the volume it writes', () => {
    const storage = makeFakeStorage();
    const port = createAudioSettingsStorage(storage);
    port.save({ muted: false, volume: 9 });
    expect(port.load()).toEqual({ muted: false, volume: 1 });
  });
});

describe('createAudioSettingsStorage — degradation when storage is absent', () => {
  it('load() returns defaults with a null store', () => {
    const port = createAudioSettingsStorage(null);
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });

  it('save() is a no-op (no throw) with a null store', () => {
    const port = createAudioSettingsStorage(null);
    expect(() => port.save({ muted: true, volume: 0.5 })).not.toThrow();
  });
});

describe('createAudioSettingsStorage — default-store acquisition never throws', () => {
  // The default parameter (defaultLocalStorage()) is evaluated at call time OUTSIDE
  // the per-method try/catch. In sandboxed iframes / storage-disabled browsers,
  // merely reading `globalThis.localStorage` throws SecurityError, so the factory
  // itself must not throw when called with no args — otherwise ArenaScene.create()
  // would crash at exactly the blocked-store case this module exists to survive.
  it('createAudioSettingsStorage() with a throwing globalThis.localStorage does not throw and degrades to defaults', () => {
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
        port = createAudioSettingsStorage(); // no args → guarded default acquisition
      }).not.toThrow();
      expect(port.load()).toEqual({
        muted: AUDIO_MUTED_DEFAULT,
        volume: AUDIO_MASTER_VOLUME_DEFAULT,
      });
      expect(() => port.save({ muted: true, volume: 0.5 })).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });
});

describe('createAudioSettingsStorage — degradation when storage throws', () => {
  const throwingStorage = {
    getItem() {
      throw new Error('blocked (private mode)');
    },
    setItem() {
      throw new Error('quota exceeded');
    },
  };

  it('load() returns defaults when getItem throws', () => {
    const port = createAudioSettingsStorage(throwingStorage);
    expect(port.load()).toEqual({
      muted: AUDIO_MUTED_DEFAULT,
      volume: AUDIO_MASTER_VOLUME_DEFAULT,
    });
  });

  it('save() swallows a throwing setItem (no throw)', () => {
    const port = createAudioSettingsStorage(throwingStorage);
    expect(() => port.save({ muted: true, volume: 0.5 })).not.toThrow();
  });
});
