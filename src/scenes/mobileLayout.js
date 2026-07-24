// mobileLayout — pure, Phaser-free responsive-layout seam (Story 7.2).
//
// The whole safe-area / letterbox layout math lives here, isolated from any Phaser
// type so it can be unit-tested headlessly — mirroring the inputMath / touchControls
// convention. ArenaScene is the SOLE Phaser boundary: it reads the four CSS
// safe-area insets (via the injectable readSafeAreaInsetsCss boundary), converts
// them to arena-logical units through the FIT letterbox (logicalSafeInsets), and
// maps them to inset-adjusted positions for the HUD, the DEV debug readout, the
// smart-bomb button and the dash button (computeMobileLayout). BootScene requests the best-effort
// landscape lock (lockLandscape). No Phaser import here.
//
// The crux is the letterbox conversion: Phaser's FIT + CENTER_BOTH scales the fixed
// ARENA_WIDTH×ARENA_HEIGHT arena by s = min(parentW/ARENA_WIDTH, parentH/ARENA_HEIGHT)
// and centers it, leaving symmetric black bars. A safe-area inset measured from the
// window edge only intrudes into the drawn game by max(0, insetCss − bar) CSS px,
// = /s logical units — so an inset smaller than its bar lands in the black bar
// (contributes zero) rather than over the arena.

import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  HUD_MARGIN,
  TOUCH_BOMB_BUTTON,
  TOUCH_DASH_BUTTON,
} from '../config/constants.js';

/**
 * Parse a CSS pixel length (e.g. `'44px'`) to a number. Anything non-numeric —
 * `''`, `undefined`, a bare `'NaNpx'`, a missing unit — collapses to 0, so a
 * platform that does not report `env(safe-area-inset-*)` insets nothing.
 * @param {string|number|undefined} v
 * @returns {number}
 */
export function parseInsetPx(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert the four CSS-pixel safe-area insets to arena-logical inset units through
 * the FIT letterbox. `s` is the FIT scale; the symmetric bars are the black
 * letterbox margins on each axis. Each edge insets the UI only by the part of its
 * CSS inset that intrudes PAST its bar, divided by `s`. A pre-layout / degenerate
 * display size (parentW or parentH ≤ 0) yields all-zero insets (no divide-by-zero;
 * a later resize re-applies with a real size).
 * @param {{top:number,right:number,bottom:number,left:number}} insetsCss
 * @param {number} parentW  Live display/parent width (CSS px).
 * @param {number} parentH  Live display/parent height (CSS px).
 * @param {number} logicalW Arena logical width (ARENA_WIDTH).
 * @param {number} logicalH Arena logical height (ARENA_HEIGHT).
 * @returns {{top:number,right:number,bottom:number,left:number}}
 */
export function logicalSafeInsets(insetsCss, parentW, parentH, logicalW, logicalH) {
  if (!(parentW > 0) || !(parentH > 0)) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const s = Math.min(parentW / logicalW, parentH / logicalH);
  const barX = (parentW - logicalW * s) / 2;
  const barY = (parentH - logicalH * s) / 2;
  return {
    top: Math.max(0, insetsCss.top - barY) / s,
    right: Math.max(0, insetsCss.right - barX) / s,
    bottom: Math.max(0, insetsCss.bottom - barY) / s,
    left: Math.max(0, insetsCss.left - barX) / s,
  };
}

/**
 * Map the logical safe-area insets to inset-adjusted positions for the DEV debug
 * readout (top-left), the HUD (top-right, right-anchored), the smart-bomb button
 * (bottom-center) and the Afterburner dash button (bottom row, right of the bomb —
 * Story 10.5). Each is pushed IN from its edge by the logical inset for that edge, so
 * none is clipped or under a notch / rounded corner / home indicator. With all-zero
 * insets (desktop / no notch) the result equals today's fixed positions verbatim for
 * every entry INCLUDING the dash (zero regression). The bomb and the dash each keep
 * their fixed x + radius and are only raised by the bottom inset — correct for the
 * dash because its right rim sits 560px in from the right edge (ARENA_WIDTH 1560 minus
 * its x + radius, 1000), so no plausible right inset can reach it. `m` is the
 * arena-border-inset + HUD margin the text sits at.
 * @param {{top:number,right:number,bottom:number,left:number}} logicalInsets
 * @returns {{debug:{x:number,y:number}, hud:{x:number,y:number},
 *   bomb:{x:number,y:number,radius:number}, dash:{x:number,y:number,radius:number}}}
 */
export function computeMobileLayout(logicalInsets) {
  const { top, right, bottom, left } = logicalInsets;
  const m = ARENA_BORDER_INSET + HUD_MARGIN;
  return {
    debug: { x: m + left, y: m + top },
    hud: { x: ARENA_WIDTH - m - right, y: m + top },
    bomb: {
      x: TOUCH_BOMB_BUTTON.x,
      y: TOUCH_BOMB_BUTTON.y - bottom,
      radius: TOUCH_BOMB_BUTTON.radius,
    },
    dash: {
      x: TOUCH_DASH_BUTTON.x,
      y: TOUCH_DASH_BUTTON.y - bottom,
      radius: TOUCH_DASH_BUTTON.radius,
    },
  };
}

/**
 * Injectable browser boundary: read the four `env(safe-area-inset-*)` values by
 * probing a throwaway element whose paddings are set to those env() functions, then
 * reading + parsing the computed paddings. `env(...)` is only non-zero when the
 * viewport meta carries `viewport-fit=cover` (see index.html). The doc + getStyle
 * are injected so the math above (and this boundary) stay headlessly assertable.
 * Defaults every edge to 0 on a platform that does not report insets.
 * @param {Document} doc
 * @param {(el:Element)=>CSSStyleDeclaration} getStyle
 * @returns {{top:number,right:number,bottom:number,left:number}}
 */
export function readSafeAreaInsetsCss(doc, getStyle) {
  // Fail-safe like lockLandscape: any missing host / probe throw defaults every edge
  // to 0 (the JSDoc contract), so a platform that cannot be probed insets nothing
  // rather than crashing the create()/resize layout pass.
  const host = doc.body || doc.documentElement;
  if (!host) return { top: 0, right: 0, bottom: 0, left: 0 };
  let probe = null;
  try {
    probe = doc.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.paddingTop = 'env(safe-area-inset-top)';
    probe.style.paddingRight = 'env(safe-area-inset-right)';
    probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
    probe.style.paddingLeft = 'env(safe-area-inset-left)';
    host.appendChild(probe);
    const cs = getStyle(probe);
    return {
      top: parseInsetPx(cs.paddingTop),
      right: parseInsetPx(cs.paddingRight),
      bottom: parseInsetPx(cs.paddingBottom),
      left: parseInsetPx(cs.paddingLeft),
    };
  } catch {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  } finally {
    // Remove on EVERY path (including a throw after appendChild) so a throwing host —
    // e.g. getStyle raising — cannot accumulate orphan probe nodes across the
    // create()/resize layout passes this runs on. The happy path removes here too.
    if (probe && probe.remove) probe.remove();
  }
}

/**
 * Injectable browser boundary: best-effort landscape lock. Feature-detected and
 * fail-safe — a no-op when the Screen Orientation API (or its `lock`) is absent, and
 * the lock promise's rejection (unsupported platform / not fullscreen) is swallowed.
 * It must never throw. Returns whether a lock was attempted (true) or the API was
 * absent (false).
 * @param {ScreenOrientation|null|undefined} orientation
 * @returns {boolean}
 */
export function lockLandscape(orientation) {
  if (!orientation?.lock) return false;
  try {
    const locking = orientation.lock('landscape');
    // Swallow the async rejection (unsupported platform / not fullscreen). Guard the
    // `.catch` on a truthy-but-non-thenable return (older / prefixed API shapes) so
    // it is never invoked on a non-promise.
    if (locking && typeof locking.catch === 'function') locking.catch(() => {});
  } catch {
    // Some platforms throw synchronously instead of rejecting; swallow so the
    // never-throws contract holds — BootScene.create() has no try/catch around this.
  }
  return true;
}

/**
 * Resolve the live display size that drives the FIT letterbox, committing to a SINGLE
 * coordinate frame. Prefers the scale manager's measured parent size; falls back to
 * the window for BOTH axes when the parent is unmeasured or degenerate (either dim
 * ≤ 0), rather than mixing a valid parent axis with a window axis — a mixed frame
 * would corrupt the FIT-scale/bar math. Phaser-free so the frame selection (the
 * load-bearing input to logicalSafeInsets) is headlessly unit-testable.
 * @param {{width:number,height:number}|null|undefined} parentSize  e.g. scale.parentSize
 * @param {{innerWidth:number,innerHeight:number}} win  e.g. window
 * @returns {{width:number,height:number}}
 */
export function resolveDisplaySize(parentSize, win) {
  const hasParent = !!parentSize && parentSize.width > 0 && parentSize.height > 0;
  return hasParent
    ? { width: parentSize.width, height: parentSize.height }
    : { width: win.innerWidth, height: win.innerHeight };
}
