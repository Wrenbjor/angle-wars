import { describe, it, expect } from 'vitest';
import {
  detectMobile,
  readMobileEnv,
  resolveQualityProfile,
} from './qualityProfile.js';
import { NEON_BLOOM } from '../scenes/neonStyle.js';
import { PARTICLE_MAX, GRID_SPACING } from './constants.js';

// qualityProfile — pure device-quality seam (Story 7.4). Covers every I/O-matrix
// detection + profile row: detectMobile over Capacitor / touch-phone / desktop envs,
// readMobileEnv's fail-safe boundary (absent + throwing host globals → desktop), and
// resolveQualityProfile's mobile-scaled vs. byte-identical-desktop frozen profiles.

describe('detectMobile — pure predicate', () => {
  it('returns true for a Capacitor-native env (short-circuits on capacitorNative)', () => {
    expect(detectMobile({ capacitorNative: true })).toBe(true);
    // Even with otherwise desktop-looking web signals, native wins.
    expect(
      detectMobile({
        capacitorNative: true,
        coarsePointer: false,
        maxTouchPoints: 0,
        userAgent: 'X11; Linux',
      }),
    ).toBe(true);
  });

  it('returns true for a coarse-pointer + touch + mobile-UA env', () => {
    expect(
      detectMobile({
        coarsePointer: true,
        maxTouchPoints: 5,
        userAgent:
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile',
      }),
    ).toBe(true);
  });

  it('returns false for a desktop env (fine pointer, no touch, desktop UA)', () => {
    expect(
      detectMobile({
        coarsePointer: false,
        maxTouchPoints: 0,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
      }),
    ).toBe(false);
  });

  it('requires ALL three web signals — a touch-capable desktop UA is NOT mobile', () => {
    // A touchscreen laptop: coarse + touch present, but a desktop UA → desktop profile.
    expect(
      detectMobile({
        coarsePointer: true,
        maxTouchPoints: 10,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
      }),
    ).toBe(false);
    // Mobile UA but no coarse pointer / no touch → still desktop (any missing signal).
    expect(
      detectMobile({
        coarsePointer: false,
        maxTouchPoints: 0,
        userAgent: 'Android Mobile',
      }),
    ).toBe(false);
  });

  it('never throws on a null/undefined/empty env (degrades to false)', () => {
    expect(detectMobile(null)).toBe(false);
    expect(detectMobile(undefined)).toBe(false);
    expect(detectMobile({})).toBe(false);
  });
});

describe('readMobileEnv — fail-safe browser boundary', () => {
  it('reads a Capacitor-native window into capacitorNative=true', () => {
    const env = readMobileEnv({
      Capacitor: { isNativePlatform: () => true },
      matchMedia: () => ({ matches: true }),
      navigator: { maxTouchPoints: 5, userAgent: 'Android Mobile' },
    });
    expect(env.capacitorNative).toBe(true);
    expect(detectMobile(env)).toBe(true);
  });

  it('reads a touch-phone window into the coarse/touch/UA signals', () => {
    const env = readMobileEnv({
      matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }),
      navigator: { maxTouchPoints: 5, userAgent: 'Linux; Android 13 Mobile' },
    });
    expect(env).toEqual({
      capacitorNative: false,
      coarsePointer: true,
      maxTouchPoints: 5,
      userAgent: 'Linux; Android 13 Mobile',
    });
    expect(detectMobile(env)).toBe(true);
  });

  it('reads a desktop window into a desktop-shaped env (detectMobile → false)', () => {
    const env = readMobileEnv({
      matchMedia: () => ({ matches: false }),
      navigator: { maxTouchPoints: 0, userAgent: 'X11; Linux x86_64' },
    });
    expect(env).toEqual({
      capacitorNative: false,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: 'X11; Linux x86_64',
    });
    expect(detectMobile(env)).toBe(false);
  });

  it('returns a desktop-shaped env when win is null/undefined (never throws)', () => {
    const desktop = {
      capacitorNative: false,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: '',
    };
    expect(readMobileEnv(null)).toEqual(desktop);
    expect(readMobileEnv(undefined)).toEqual(desktop);
    expect(detectMobile(readMobileEnv(null))).toBe(false);
  });

  it('degrades to desktop when host globals are ABSENT (no matchMedia / navigator)', () => {
    const env = readMobileEnv({}); // window with nothing on it
    expect(env).toEqual({
      capacitorNative: false,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: '',
    });
    expect(detectMobile(env)).toBe(false);
  });

  it('degrades to desktop when a host global THROWS (never propagates)', () => {
    const throwingWin = {
      get Capacitor() {
        throw new Error('boom');
      },
      matchMedia: () => {
        throw new Error('boom');
      },
      get navigator() {
        throw new Error('boom');
      },
    };
    let env;
    expect(() => {
      env = readMobileEnv(throwingWin);
    }).not.toThrow();
    expect(env).toEqual({
      capacitorNative: false,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: '',
    });
    expect(detectMobile(env)).toBe(false);
  });

  it('degrades to desktop when matchMedia throws mid-read (partial host failure)', () => {
    const env = readMobileEnv({
      Capacitor: { isNativePlatform: () => false },
      matchMedia: () => {
        throw new Error('unsupported');
      },
      navigator: { maxTouchPoints: 5, userAgent: 'Android Mobile' },
    });
    // The web-signal probe degrades on the throw to desktop-safe values (native false).
    expect(env).toEqual({
      capacitorNative: false,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: '',
    });
  });

  it('PRESERVES a confirmed native signal even when matchMedia throws afterward', () => {
    // An old/strict Capacitor WebView: isNativePlatform() confirms native, but a later
    // matchMedia access throws. The confirmed native signal must NOT be erased down to
    // the heavy desktop profile — capacitorNative stays true and detectMobile → true.
    const env = readMobileEnv({
      Capacitor: { isNativePlatform: () => true },
      matchMedia: () => {
        throw new Error('unsupported');
      },
      navigator: { maxTouchPoints: 5, userAgent: 'Android Mobile' },
    });
    expect(env.capacitorNative).toBe(true);
    // The thrown web-signal read falls back to desktop-safe values, native preserved.
    expect(env).toEqual({
      capacitorNative: true,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: '',
    });
    expect(detectMobile(env)).toBe(true);
  });

  it('tolerates a Capacitor global without isNativePlatform (defaults native=false)', () => {
    const env = readMobileEnv({
      Capacitor: {},
      matchMedia: () => ({ matches: false }),
      navigator: { maxTouchPoints: 0, userAgent: 'X11' },
    });
    expect(env.capacitorNative).toBe(false);
  });
});

describe('resolveQualityProfile — mobile profile', () => {
  const mobile = resolveQualityProfile(true);

  it('scales the particle cap below the desktop PARTICLE_MAX', () => {
    expect(mobile.particleMax).toBeLessThan(PARTICLE_MAX);
  });

  it('lowers the bloom cost: fewer steps, blur/strength no higher', () => {
    expect(mobile.bloom.steps).toBeLessThan(NEON_BLOOM.steps);
    // STRICTLY less costly (the documented MOBILE_* invariant), not merely ≤.
    expect(mobile.bloom.blurStrength).toBeLessThan(NEON_BLOOM.blurStrength);
    expect(mobile.bloom.strength).toBeLessThan(NEON_BLOOM.strength);
    // Color + offsets carry no fill cost, so they are kept identical to desktop.
    expect(mobile.bloom.color).toBe(NEON_BLOOM.color);
    expect(mobile.bloom.offsetX).toBe(NEON_BLOOM.offsetX);
    expect(mobile.bloom.offsetY).toBe(NEON_BLOOM.offsetY);
  });

  it('coarsens the grid (spacing exceeds the desktop GRID_SPACING)', () => {
    expect(mobile.gridSpacing).toBeGreaterThan(GRID_SPACING);
  });

  it('freezes the profile and its nested bloom', () => {
    expect(Object.isFrozen(mobile)).toBe(true);
    expect(Object.isFrozen(mobile.bloom)).toBe(true);
  });

  it('exposes the same six bloom fields as NEON_BLOOM (a complete addBloom tuple)', () => {
    expect(Object.keys(mobile.bloom).sort()).toEqual(
      Object.keys(NEON_BLOOM).sort(),
    );
  });
});

describe('resolveQualityProfile — desktop profile (zero regression)', () => {
  const desktop = resolveQualityProfile(false);

  it('particleMax equals the desktop PARTICLE_MAX', () => {
    expect(desktop.particleMax).toBe(PARTICLE_MAX);
  });

  it('bloom deep-equals NEON_BLOOM', () => {
    expect(desktop.bloom).toEqual(NEON_BLOOM);
  });

  it('gridSpacing equals the desktop GRID_SPACING', () => {
    expect(desktop.gridSpacing).toBe(GRID_SPACING);
  });

  it('freezes the profile', () => {
    expect(Object.isFrozen(desktop)).toBe(true);
  });
});
