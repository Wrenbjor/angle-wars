import { describe, it, expect } from 'vitest';
import { createSettingsStorage } from './settingsStorage.js';
import {
  SETTINGS_STORAGE_KEY,
  AUDIO_MUTED_DEFAULT,
  AUDIO_MASTER_VOLUME_DEFAULT,
  SETTINGS_FULLSCREEN_DEFAULT,
} from '../config/constants.js';

// settingsStorage — the consolidated guarded { muted, volume, fullscreen }
// browser-storage seam (Story 5.3, absorbing the former audio-only port). These
// tests lock the guarded-port contract HEADLESSLY (node env, no jsdom) by injecting
// fake Storage-like objects: an in-memory map, a null store, and throwing stubs. They
// pin every row of the spec's storage edge-case matrix: defaults (empty/blocked/
// corrupt), a three-field round-trip, a legacy {muted,volume} load, the volume clamp,
// non-boolean fullscreen/muted coercion, and no-throw degradation.

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

const DEFAULTS = {
  muted: AUDIO_MUTED_DEFAULT,
  volume: AUDIO_MASTER_VOLUME_DEFAULT,
  fullscreen: SETTINGS_FULLSCREEN_DEFAULT,
};

describe('createSettingsStorage — load() defaults', () => {
  it('returns the defaults for an empty store (missing key)', () => {
    const port = createSettingsStorage(makeFakeStorage());
    expect(port.load()).toEqual(DEFAULTS);
  });

  it('returns the defaults for an empty-string value', () => {
    const port = createSettingsStorage(
      makeFakeStorage({ [SETTINGS_STORAGE_KEY]: '' }),
    );
    expect(port.load()).toEqual(DEFAULTS);
  });

  it('returns the defaults for a non-JSON value', () => {
    const port = createSettingsStorage(
      makeFakeStorage({ [SETTINGS_STORAGE_KEY]: 'not json' }),
    );
    expect(port.load()).toEqual(DEFAULTS);
  });

  it('returns the defaults for a JSON primitive (not an object)', () => {
    const port = createSettingsStorage(
      makeFakeStorage({ [SETTINGS_STORAGE_KEY]: '42' }),
    );
    expect(port.load()).toEqual(DEFAULTS);
  });
});

describe('createSettingsStorage — load() valid + coercion', () => {
  it('parses a valid stored {muted, volume, fullscreen}', () => {
    const port = createSettingsStorage(
      makeFakeStorage({
        [SETTINGS_STORAGE_KEY]: JSON.stringify({
          muted: true,
          volume: 0.3,
          fullscreen: true,
        }),
      }),
    );
    expect(port.load()).toEqual({ muted: true, volume: 0.3, fullscreen: true });
  });

  it('clamps an out-of-range stored volume into [0,1]', () => {
    const hi = createSettingsStorage(
      makeFakeStorage({
        [SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: false, volume: 5, fullscreen: false }),
      }),
    );
    expect(hi.load()).toEqual({ muted: false, volume: 1, fullscreen: false });

    const lo = createSettingsStorage(
      makeFakeStorage({
        [SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: false, volume: -2, fullscreen: false }),
      }),
    );
    expect(lo.load()).toEqual({ muted: false, volume: 0, fullscreen: false });
  });

  it('falls back to defaults for wrong-typed fields (non-boolean muted / non-number volume / non-boolean fullscreen)', () => {
    const port = createSettingsStorage(
      makeFakeStorage({
        [SETTINGS_STORAGE_KEY]: JSON.stringify({
          muted: 'yes',
          volume: 'loud',
          fullscreen: 'on',
        }),
      }),
    );
    expect(port.load()).toEqual(DEFAULTS);
  });
});

describe('createSettingsStorage — legacy {muted, volume} payload', () => {
  it('reuses the exact legacy key VALUE so old data is not orphaned', () => {
    // Pinned to the LITERAL: changing the constant's value would silently reset every
    // user's persisted settings (the round-trip tests below would stay green because
    // they seed + read through the same constant), so lock the value here.
    expect(SETTINGS_STORAGE_KEY).toBe('angleWars.audioSettings');
  });

  it('loads a legacy audio-only payload with fullscreen defaulted off', () => {
    // The key VALUE is reused unchanged, so a pre-5.3 {muted,volume} blob still parses.
    const port = createSettingsStorage(
      makeFakeStorage({
        [SETTINGS_STORAGE_KEY]: JSON.stringify({ muted: true, volume: 0.25 }),
      }),
    );
    expect(port.load()).toEqual({
      muted: true,
      volume: 0.25,
      fullscreen: SETTINGS_FULLSCREEN_DEFAULT,
    });
  });

  it('loads a Story 4.5 payload seeded under the HARDCODED legacy key literal', () => {
    // Seed under the raw string a Story 4.5 audioSettingsStorage would have written —
    // NOT via the constant — so this proves migration compat survives a constant edit:
    // a legacy {muted,volume} (no fullscreen) at 'angleWars.audioSettings' still loads
    // its muted/volume, with fullscreen defaulted false.
    const port = createSettingsStorage(
      makeFakeStorage({
        'angleWars.audioSettings': JSON.stringify({ muted: true, volume: 0.4 }),
      }),
    );
    expect(port.load()).toEqual({ muted: true, volume: 0.4, fullscreen: false });
  });
});

describe('createSettingsStorage — save() round-trip + write form', () => {
  it('writes the whole object as JSON under the key and reads it back', () => {
    const storage = makeFakeStorage();
    const port = createSettingsStorage(storage);
    port.save({ muted: true, volume: 0.25, fullscreen: true });
    expect(storage._map.get(SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ muted: true, volume: 0.25, fullscreen: true }),
    );
    expect(port.load()).toEqual({ muted: true, volume: 0.25, fullscreen: true });
  });

  it('clamps the volume it writes and coerces booleans', () => {
    const storage = makeFakeStorage();
    const port = createSettingsStorage(storage);
    port.save({ muted: 1, volume: 9, fullscreen: 0 });
    expect(port.load()).toEqual({ muted: true, volume: 1, fullscreen: false });
  });
});

describe('createSettingsStorage — degradation when storage is absent', () => {
  it('load() returns defaults with a null store', () => {
    const port = createSettingsStorage(null);
    expect(port.load()).toEqual(DEFAULTS);
  });

  it('save() is a no-op (no throw) with a null store', () => {
    const port = createSettingsStorage(null);
    expect(() => port.save({ muted: true, volume: 0.5, fullscreen: true })).not.toThrow();
  });
});

describe('createSettingsStorage — default-store acquisition never throws', () => {
  // The default parameter (defaultLocalStorage()) is evaluated at call time OUTSIDE
  // the per-method try/catch. In sandboxed iframes / storage-disabled browsers,
  // merely reading `globalThis.localStorage` throws SecurityError, so the factory
  // itself must not throw when called with no args — otherwise a scene create()
  // would crash at exactly the blocked-store case this module exists to survive.
  it('createSettingsStorage() with a throwing globalThis.localStorage does not throw and degrades to defaults', () => {
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
        port = createSettingsStorage(); // no args → guarded default acquisition
      }).not.toThrow();
      expect(port.load()).toEqual(DEFAULTS);
      expect(() =>
        port.save({ muted: true, volume: 0.5, fullscreen: true }),
      ).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });
});

describe('createSettingsStorage — degradation when storage throws', () => {
  const throwingStorage = {
    getItem() {
      throw new Error('blocked (private mode)');
    },
    setItem() {
      throw new Error('quota exceeded');
    },
  };

  it('load() returns defaults when getItem throws', () => {
    const port = createSettingsStorage(throwingStorage);
    expect(port.load()).toEqual(DEFAULTS);
  });

  it('save() swallows a throwing setItem (no throw)', () => {
    const port = createSettingsStorage(throwingStorage);
    expect(() =>
      port.save({ muted: true, volume: 0.5, fullscreen: true }),
    ).not.toThrow();
  });
});
