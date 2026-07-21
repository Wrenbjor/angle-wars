import { describe, it, expect, vi } from 'vitest';
import {
  HAPTIC_STYLE,
  pulseHaptic,
  emitHaptic,
  acquireWakeLock,
  releaseWakeLock,
} from './nativeFeel.js';

// nativeFeel is the fail-safe boundary seam (Story 7.5): a Capacitor Haptics pulse
// and the Screen Wake Lock, each behind a feature-detect + try/catch that degrades
// to a no-op and NEVER throws. These tests cover every boundary row of the spec's
// I/O matrix — normal call, absent host global, and a throwing/rejecting host — plus
// the shared HAPTIC_STYLE constants.

describe('nativeFeel — HAPTIC_STYLE constants', () => {
  it('exposes the three intensity styles matching Capacitor ImpactStyle values', () => {
    expect(HAPTIC_STYLE.HEAVY).toBe('HEAVY');
    expect(HAPTIC_STYLE.MEDIUM).toBe('MEDIUM');
    expect(HAPTIC_STYLE.LIGHT).toBe('LIGHT');
  });
});

describe('nativeFeel — pulseHaptic (haptics boundary)', () => {
  it('calls haptics.impact({ style }) exactly once for a valid plugin', () => {
    const impact = vi.fn();
    pulseHaptic({ impact }, HAPTIC_STYLE.HEAVY);
    expect(impact).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith({ style: 'HEAVY' });
  });

  it('no-ops (never throws) when the plugin is null/undefined or lacks .impact', () => {
    expect(() => pulseHaptic(null, HAPTIC_STYLE.MEDIUM)).not.toThrow();
    expect(() => pulseHaptic(undefined, HAPTIC_STYLE.MEDIUM)).not.toThrow();
    expect(() => pulseHaptic({}, HAPTIC_STYLE.MEDIUM)).not.toThrow();
  });

  it('swallows a throwing impact (never throws)', () => {
    const impact = vi.fn(() => {
      throw new Error('no haptic motor');
    });
    expect(() => pulseHaptic({ impact }, HAPTIC_STYLE.LIGHT)).not.toThrow();
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejecting impact promise (no unhandled rejection, never throws)', async () => {
    const impact = vi.fn(() => Promise.reject(new Error('no motor')));
    expect(() => pulseHaptic({ impact }, HAPTIC_STYLE.HEAVY)).not.toThrow();
    // Let the swallowed rejection settle — no unhandled rejection should escape.
    await Promise.resolve();
    expect(impact).toHaveBeenCalledTimes(1);
  });
});

describe('nativeFeel — emitHaptic (reduced-motion gate)', () => {
  it('fires the pulse once when reduced motion is off', () => {
    const impact = vi.fn();
    emitHaptic(false, { impact }, HAPTIC_STYLE.MEDIUM);
    expect(impact).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
  });

  it('suppresses the pulse entirely when reduced motion is on', () => {
    const impact = vi.fn();
    emitHaptic(true, { impact }, HAPTIC_STYLE.MEDIUM);
    expect(impact).not.toHaveBeenCalled();
  });

  it('never throws when suppressed with a null plugin', () => {
    expect(() => emitHaptic(true, null, HAPTIC_STYLE.LIGHT)).not.toThrow();
  });
});

describe('nativeFeel — acquireWakeLock (wake-lock boundary)', () => {
  it('requests the screen lock and returns the sentinel', () => {
    const sentinel = { release: vi.fn() };
    const request = vi.fn(() => sentinel);
    const out = acquireWakeLock({ wakeLock: { request } });
    expect(request).toHaveBeenCalledWith('screen');
    expect(out).toBe(sentinel);
  });

  it('returns null when navigator / navigator.wakeLock / .request is absent', () => {
    expect(acquireWakeLock(null)).toBeNull();
    expect(acquireWakeLock(undefined)).toBeNull();
    expect(acquireWakeLock({})).toBeNull();
    expect(acquireWakeLock({ wakeLock: {} })).toBeNull();
  });

  it('returns null and never throws when request throws synchronously', () => {
    const request = vi.fn(() => {
      throw new Error('not allowed');
    });
    let out;
    expect(() => {
      out = acquireWakeLock({ wakeLock: { request } });
    }).not.toThrow();
    expect(out).toBeNull();
  });

  it('swallows a rejected request promise (never throws, returns the promise)', async () => {
    const request = vi.fn(() => Promise.reject(new Error('hidden')));
    let out;
    expect(() => {
      out = acquireWakeLock({ wakeLock: { request } });
    }).not.toThrow();
    // The returned thenable resolves without an unhandled rejection escaping.
    await Promise.resolve();
    expect(out).not.toBeNull();
  });
});

describe('nativeFeel — acquireWakeLock involuntary-release recovery (onRelease)', () => {
  // A sentinel fake that captures its one-shot 'release' listener so the test can
  // simulate a platform-triggered release (thermal / battery-saver).
  function releasableSentinel() {
    const s = {
      _release: null,
      release: vi.fn(),
      addEventListener: vi.fn((event, cb) => {
        if (event === 'release') s._release = cb;
      }),
    };
    return s;
  }

  it('invokes onRelease when the resolved sentinel fires its release event', () => {
    const sentinel = releasableSentinel();
    const onRelease = vi.fn();
    acquireWakeLock({ wakeLock: { request: () => sentinel } }, onRelease);

    expect(sentinel._release).toBeTypeOf('function');
    sentinel._release(); // platform releases the lock mid-play
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('resolves a promise-of-sentinel before attaching the release listener', async () => {
    const sentinel = releasableSentinel();
    const onRelease = vi.fn();
    acquireWakeLock({ wakeLock: { request: () => Promise.resolve(sentinel) } }, onRelease);

    await Promise.resolve();
    await Promise.resolve();
    expect(sentinel._release).toBeTypeOf('function');
    sentinel._release();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('never throws when the sentinel lacks addEventListener or it throws', () => {
    const onRelease = vi.fn();
    // Sentinel without addEventListener (e.g. a bare release-only fake).
    expect(() =>
      acquireWakeLock({ wakeLock: { request: () => ({ release: vi.fn() }) } }, onRelease),
    ).not.toThrow();
    // addEventListener throws.
    const throwing = {
      addEventListener: () => {
        throw new Error('boom');
      },
    };
    expect(() =>
      acquireWakeLock({ wakeLock: { request: () => throwing } }, onRelease),
    ).not.toThrow();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('swallows a throwing onRelease callback (never throws)', () => {
    const sentinel = releasableSentinel();
    acquireWakeLock({ wakeLock: { request: () => sentinel } }, () => {
      throw new Error('handler blew up');
    });
    expect(() => sentinel._release()).not.toThrow();
  });

  it('does not attach a listener when onRelease is omitted', () => {
    const sentinel = releasableSentinel();
    acquireWakeLock({ wakeLock: { request: () => sentinel } });
    expect(sentinel.addEventListener).not.toHaveBeenCalled();
  });
});

describe('nativeFeel — releaseWakeLock (wake-lock boundary)', () => {
  it('releases a resolved sentinel', () => {
    const release = vi.fn();
    releaseWakeLock({ release });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('no-ops (never throws) for null/undefined or a sentinel without .release', () => {
    expect(() => releaseWakeLock(null)).not.toThrow();
    expect(() => releaseWakeLock(undefined)).not.toThrow();
    expect(() => releaseWakeLock({})).not.toThrow();
  });

  it('swallows a throwing release (never throws)', () => {
    const release = vi.fn(() => {
      throw new Error('already released');
    });
    expect(() => releaseWakeLock({ release })).not.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('resolves a promise-of-sentinel and releases it', async () => {
    const release = vi.fn();
    releaseWakeLock(Promise.resolve({ release }));
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected promise-of-sentinel (never throws)', async () => {
    expect(() => releaseWakeLock(Promise.reject(new Error('gone')))).not.toThrow();
    await Promise.resolve();
  });
});
