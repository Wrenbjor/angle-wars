import { describe, it, expect, vi } from 'vitest';
import {
  parseInsetPx,
  logicalSafeInsets,
  computeMobileLayout,
  readSafeAreaInsetsCss,
  lockLandscape,
  resolveDisplaySize,
} from './mobileLayout.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  HUD_MARGIN,
  TOUCH_BOMB_BUTTON,
  TOUCH_DASH_BUTTON,
} from '../config/constants.js';

// mobileLayout is the Phaser-free responsive-layout seam (Story 7.2): CSS→logical
// safe-area conversion through the FIT letterbox, the HUD/debug/bomb placement, and
// the two injectable browser boundaries. These tests cover every row of the spec's
// I/O & edge-case matrix, deriving expected values from the centralized constants so
// a re-tune of the arena/margin/bomb geometry cannot silently break the assertions.

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
// The base text margin the HUD/debug sit at (arena border inset + HUD margin).
const M = ARENA_BORDER_INSET + HUD_MARGIN;

describe('mobileLayout — parseInsetPx', () => {
  it('parses a CSS px length to a number', () => {
    expect(parseInsetPx('44px')).toBe(44);
    expect(parseInsetPx('21.5px')).toBeCloseTo(21.5, 6);
    expect(parseInsetPx('0px')).toBe(0);
  });

  it('collapses empty / undefined / NaN / unitless-garbage to 0', () => {
    expect(parseInsetPx('')).toBe(0);
    expect(parseInsetPx(undefined)).toBe(0);
    expect(parseInsetPx('NaNpx')).toBe(0);
    expect(parseInsetPx('abc')).toBe(0);
  });
});

describe('mobileLayout — logicalSafeInsets (letterbox conversion)', () => {
  it('row: notch intrudes PAST the letterbox bar → positive logical inset', () => {
    // Pillarboxed: parentW 1760 @ parentH 720 → s = 1, barX = (1760 − 1560)/2 = 100.
    // A left inset of 144 CSS px intrudes 44 px past the 100 px bar → 44/1 logical.
    const out = logicalSafeInsets({ ...NO_INSETS, left: 144 }, 1760, 720, ARENA_WIDTH, ARENA_HEIGHT);
    expect(out.left).toBeCloseTo(44, 6);
  });

  it('row: notch sits INSIDE the letterbox bar → clamped to zero logical inset', () => {
    // Same geometry (barX = 100); a left inset of 44 lands entirely in the bar → 0.
    const out = logicalSafeInsets({ ...NO_INSETS, left: 44 }, 1760, 720, ARENA_WIDTH, ARENA_HEIGHT);
    expect(out.left).toBe(0);
  });

  it('divides the intruding part by the FIT scale (s ≠ 1)', () => {
    // parentW 3520 @ parentH 1440 → s = min(2.256, 2) = 2, barX = (3520 − 3120)/2 = 200.
    // A left inset of 344 intrudes 144 past the bar → 144/2 = 72 logical.
    const out = logicalSafeInsets({ ...NO_INSETS, left: 344 }, 3520, 1440, ARENA_WIDTH, ARENA_HEIGHT);
    expect(out.left).toBeCloseTo(72, 6);
  });

  it('row: home indicator (bottom) intrudes with a zero bottom bar', () => {
    // Letterboxed (bars on top/bottom): parentW 1560 @ parentH 800 → s = min(1, 1.111) = 1,
    // barY = (800 − 720)/2 = 40. A bottom inset of 61 intrudes 21 past the 40 bar → 21 logical.
    const out = logicalSafeInsets({ ...NO_INSETS, bottom: 61 }, 1560, 800, ARENA_WIDTH, ARENA_HEIGHT);
    expect(out.bottom).toBeCloseTo(21, 6);
  });

  it('row: desktop / no notch → all logical insets zero', () => {
    const out = logicalSafeInsets(NO_INSETS, 1920, 1080, ARENA_WIDTH, ARENA_HEIGHT);
    expect(out).toEqual(NO_INSETS);
  });

  it('row: zero / negative display size → all zero (no divide-by-zero)', () => {
    const insets = { top: 44, right: 44, bottom: 44, left: 44 };
    expect(logicalSafeInsets(insets, 0, 720, ARENA_WIDTH, ARENA_HEIGHT)).toEqual(NO_INSETS);
    expect(logicalSafeInsets(insets, 1280, 0, ARENA_WIDTH, ARENA_HEIGHT)).toEqual(NO_INSETS);
    expect(logicalSafeInsets(insets, -1, -1, ARENA_WIDTH, ARENA_HEIGHT)).toEqual(NO_INSETS);
  });

  it('converts all four edges independently', () => {
    // Exact-fit (parent == logical): s = 1, both bars 0 → each edge passes through 1:1.
    const out = logicalSafeInsets(
      { top: 10, right: 20, bottom: 30, left: 40 },
      ARENA_WIDTH,
      ARENA_HEIGHT,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );
    expect(out).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
  });
});

describe('mobileLayout — computeMobileLayout (placement)', () => {
  it('row: desktop (all insets 0) → HUD / debug / bomb at today’s fixed positions', () => {
    const layout = computeMobileLayout(NO_INSETS);
    expect(layout.debug).toEqual({ x: M, y: M });
    expect(layout.hud).toEqual({ x: ARENA_WIDTH - M, y: M });
    expect(layout.bomb).toEqual({
      x: TOUCH_BOMB_BUTTON.x,
      y: TOUCH_BOMB_BUTTON.y,
      radius: TOUCH_BOMB_BUTTON.radius,
    });
  });

  it('pushes the debug readout in from the top-left by the top/left insets', () => {
    const layout = computeMobileLayout({ ...NO_INSETS, top: 12, left: 34 });
    expect(layout.debug).toEqual({ x: M + 34, y: M + 12 });
  });

  it('pushes the HUD in from the top-right by the top/right insets', () => {
    const layout = computeMobileLayout({ ...NO_INSETS, top: 12, right: 34 });
    expect(layout.hud).toEqual({ x: ARENA_WIDTH - M - 34, y: M + 12 });
  });

  it('row: home indicator raises the bomb button center by the bottom inset (x + radius unchanged)', () => {
    const layout = computeMobileLayout({ ...NO_INSETS, bottom: 21 });
    expect(layout.bomb.x).toBe(TOUCH_BOMB_BUTTON.x);
    expect(layout.bomb.y).toBe(TOUCH_BOMB_BUTTON.y - 21);
    expect(layout.bomb.radius).toBe(TOUCH_BOMB_BUTTON.radius);
  });

  // --- Afterburner dash button (Story 10.5) --------------------------------
  it('row: desktop (all insets 0) → the dash button at today’s fixed position verbatim', () => {
    const layout = computeMobileLayout(NO_INSETS);
    expect(layout.dash).toEqual({
      x: TOUCH_DASH_BUTTON.x,
      y: TOUCH_DASH_BUTTON.y,
      radius: TOUCH_DASH_BUTTON.radius,
    });
  });

  it('raises the dash button by the BOTTOM inset only (x + radius unchanged)', () => {
    const layout = computeMobileLayout({ ...NO_INSETS, bottom: 21 });
    expect(layout.dash.x).toBe(TOUCH_DASH_BUTTON.x);
    expect(layout.dash.y).toBe(TOUCH_DASH_BUTTON.y - 21);
    expect(layout.dash.radius).toBe(TOUCH_DASH_BUTTON.radius);
  });

  it('a RIGHT inset never reaches the dash button (it sits far in from that edge)', () => {
    // The reason the dash gets the bomb's bottom-inset-only treatment rather than a
    // right-anchored one.
    const layout = computeMobileLayout({ ...NO_INSETS, right: 60 });
    expect(layout.dash.x).toBe(TOUCH_DASH_BUTTON.x);
    expect(ARENA_WIDTH - (TOUCH_DASH_BUTTON.x + TOUCH_DASH_BUTTON.radius)).toBeGreaterThan(
      200,
    );
  });

  it('moves the bomb and the dash TOGETHER (the bottom row stays a row)', () => {
    const layout = computeMobileLayout({ ...NO_INSETS, bottom: 34 });
    expect(layout.dash.y - layout.bomb.y).toBe(
      TOUCH_DASH_BUTTON.y - TOUCH_BOMB_BUTTON.y,
    );
  });
});

describe('mobileLayout — readSafeAreaInsetsCss (injectable boundary)', () => {
  it('injects a probe, reads + parses the four env() paddings, then removes it', () => {
    const probe = { style: {}, remove: vi.fn() };
    const appendChild = vi.fn();
    const doc = { createElement: vi.fn(() => probe), body: { appendChild } };
    const getStyle = vi.fn(() => ({
      paddingTop: '10px',
      paddingRight: '0px',
      paddingBottom: '21px',
      paddingLeft: '44px',
    }));

    const insets = readSafeAreaInsetsCss(doc, getStyle);

    expect(insets).toEqual({ top: 10, right: 0, bottom: 21, left: 44 });
    // The probe was appended, measured, and cleaned up.
    expect(appendChild).toHaveBeenCalledWith(probe);
    expect(getStyle).toHaveBeenCalledWith(probe);
    expect(probe.remove).toHaveBeenCalledTimes(1);
    // The probe's paddings are the four env(safe-area-inset-*) functions.
    expect(probe.style.paddingTop).toBe('env(safe-area-inset-top)');
    expect(probe.style.paddingRight).toBe('env(safe-area-inset-right)');
    expect(probe.style.paddingBottom).toBe('env(safe-area-inset-bottom)');
    expect(probe.style.paddingLeft).toBe('env(safe-area-inset-left)');
  });

  it('defaults every edge to 0 when the platform reports no insets', () => {
    const probe = { style: {}, remove: vi.fn() };
    const doc = { createElement: () => probe, body: { appendChild: vi.fn() } };
    const getStyle = () => ({}); // no paddings reported at all
    expect(readSafeAreaInsetsCss(doc, getStyle)).toEqual(NO_INSETS);
  });

  it('row: a probe/getStyle throw → returns zeros AND removes the probe (no orphan leak)', () => {
    // getStyle throws AFTER the probe is appended — the fail-safe must both default to
    // zero AND clean up the node, or every resize/create pass would leak a hidden div.
    const probe = { style: {}, remove: vi.fn() };
    const appendChild = vi.fn();
    const doc = { createElement: () => probe, body: { appendChild } };
    const getStyle = () => {
      throw new Error('getComputedStyle unavailable');
    };
    expect(() => readSafeAreaInsetsCss(doc, getStyle)).not.toThrow();
    expect(readSafeAreaInsetsCss(doc, getStyle)).toEqual(NO_INSETS);
    // The probe was appended then removed on the throw path (finally), so nothing leaks.
    expect(appendChild).toHaveBeenCalledWith(probe);
    expect(probe.remove).toHaveBeenCalled();
  });

  it('row: missing host (no body / documentElement) → zeros, never touches the DOM', () => {
    const createElement = vi.fn();
    const doc = { createElement, body: null, documentElement: null };
    expect(readSafeAreaInsetsCss(doc, () => ({}))).toEqual(NO_INSETS);
    expect(createElement).not.toHaveBeenCalled();
  });
});

describe('mobileLayout — lockLandscape (injectable boundary)', () => {
  it('row: API present → calls lock("landscape") once and returns true', () => {
    const lock = vi.fn(() => Promise.resolve());
    expect(lockLandscape({ lock })).toBe(true);
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('row: API absent → no-op, returns false, never throws', () => {
    expect(lockLandscape(null)).toBe(false);
    expect(lockLandscape(undefined)).toBe(false);
    expect(lockLandscape({})).toBe(false); // present object, but no .lock
  });

  it('row: lock rejects (unsupported / not fullscreen) → rejection swallowed, never throws', async () => {
    const rejection = Promise.reject(new Error('not fullscreen'));
    const lock = vi.fn(() => rejection);
    expect(() => lockLandscape({ lock })).not.toThrow();
    // Let the microtask settle; the ?.catch must have consumed it (no unhandled reject).
    await Promise.resolve();
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('tolerates a lock() that returns no promise (older API shape)', () => {
    const lock = vi.fn(() => undefined); // ?.catch short-circuits
    expect(() => lockLandscape({ lock })).not.toThrow();
    expect(lockLandscape({ lock })).toBe(true);
  });

  it('row: lock() throws synchronously (some platforms) → swallowed, returns true, never throws', () => {
    const lock = vi.fn(() => {
      throw new Error('NotSupportedError');
    });
    expect(() => lockLandscape({ lock })).not.toThrow();
    expect(lockLandscape({ lock })).toBe(true);
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('tolerates a lock() returning a truthy non-thenable (no .catch) without throwing', () => {
    const lock = vi.fn(() => true); // truthy but not a promise — .catch must be guarded
    expect(() => lockLandscape({ lock })).not.toThrow();
    expect(lockLandscape({ lock })).toBe(true);
  });
});

describe('mobileLayout — resolveDisplaySize (single-frame selection)', () => {
  const win = { innerWidth: 1920, innerHeight: 1080 };

  it('prefers a fully-measured parent size', () => {
    expect(resolveDisplaySize({ width: 1280, height: 720 }, win)).toEqual({ width: 1280, height: 720 });
  });

  it('falls back to the window for BOTH axes when parent is absent', () => {
    expect(resolveDisplaySize(null, win)).toEqual({ width: 1920, height: 1080 });
    expect(resolveDisplaySize(undefined, win)).toEqual({ width: 1920, height: 1080 });
  });

  it('does NOT mix frames: a half-measured parent (one axis ≤ 0) falls back to the window on BOTH', () => {
    // If width is 0 but height is valid, taking height from the parent and width from
    // the window would corrupt the FIT scale — so both must come from the window.
    expect(resolveDisplaySize({ width: 0, height: 720 }, win)).toEqual({ width: 1920, height: 1080 });
    expect(resolveDisplaySize({ width: 1280, height: 0 }, win)).toEqual({ width: 1920, height: 1080 });
  });
});
