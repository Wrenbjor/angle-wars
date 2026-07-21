// nativeFeel — fail-safe boundary seam for tactile feedback + keep-awake (Story 7.5).
//
// Every native/browser touch the "game feel" layer needs — a Capacitor Haptics
// pulse and the Screen Wake Lock — lives here behind a guarded boundary that
// feature-detects, wraps the call in try/catch, and degrades to a no-op. It NEVER
// throws, so a missing plugin / unsupported WebView / rejected request can never
// crash create()/update()/bootstrap. This mirrors mobileLayout.lockLandscape:
// inject the host object, guard it, swallow failures.
//
// It imports NO `@capacitor/*` package and NO Phaser: the plugin object and the
// `navigator` are INJECTED by the untestable adapter layer (ArenaScene), so this
// module stays headlessly unit-testable (nativeFeel.test.js). The HAPTIC_STYLE
// constants are the single source of truth for the impact styles, shared with the
// pure ScreenFeedbackSystem aggregation.

/**
 * The Capacitor Haptics impact styles this game uses, keyed by intensity. The
 * values match Capacitor's `ImpactStyle` enum string values, so a pulse can be
 * fired as `haptics.impact({ style })` with no lookup. Death → HEAVY, bomb →
 * MEDIUM, extra life → LIGHT.
 * @type {{HEAVY:'HEAVY', MEDIUM:'MEDIUM', LIGHT:'LIGHT'}}
 */
export const HAPTIC_STYLE = {
  HEAVY: 'HEAVY',
  MEDIUM: 'MEDIUM',
  LIGHT: 'LIGHT',
};

/**
 * Fire a single short haptic pulse through the injected Capacitor Haptics plugin.
 * Feature-detected and fail-safe (mirror of lockLandscape): a null plugin, an
 * absent `.impact`, or a throwing call all degrade to a no-op. It never throws.
 * @param {{impact?:(opts:{style:string})=>unknown}|null|undefined} haptics The
 *   injected `@capacitor/haptics` `Haptics` plugin (or null on an unsupported host).
 * @param {string} style One of HAPTIC_STYLE.*.
 */
export function pulseHaptic(haptics, style) {
  if (!haptics || typeof haptics.impact !== 'function') return; // feature-detect → no-op
  try {
    // impact() returns a Promise on the real plugin; the try/catch only traps a
    // synchronous throw, so swallow the async rejection too (guarded on a thenable
    // return) or an unsupported-motor rejection would surface as an unhandled rejection.
    const p = haptics.impact({ style }); // fire-and-forget
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // never throw — device/web fallback absent
  }
}

/**
 * Reduced-Motion-gated haptic pulse (Story 7.5). The single decision point for
 * whether a drained pulse actually buzzes: it fires the fail-safe Haptics boundary
 * ONLY when Reduced Motion is off — output-layer suppression exactly like the
 * screen-shake / flash gates. Pure over its `reducedMotion` arg so both arms are
 * unit-testable (the ArenaScene sink is a thin closure over it). Never throws.
 * @param {boolean} reducedMotion When true, suppress the pulse entirely.
 * @param {{impact?:(opts:{style:string})=>unknown}|null|undefined} haptics
 * @param {string} style One of HAPTIC_STYLE.*.
 */
export function emitHaptic(reducedMotion, haptics, style) {
  if (reducedMotion) return;
  pulseHaptic(haptics, style);
}

/**
 * Attach a one-shot `release` listener to a wake-lock sentinel so an INVOLUNTARY
 * platform release (thermal / battery-saver, with no visibilitychange) invokes
 * `onRelease` — letting the caller re-acquire while still in play. The sentinel may
 * be a promise (real WebView) or a resolved sentinel (test fake); both are handled.
 * Fully guarded — a null sentinel, absent `.addEventListener`, or any throw degrades
 * to a no-op and never throws.
 * @param {unknown} sentinel
 * @param {() => void} onRelease
 */
function attachReleaseListener(sentinel, onRelease) {
  if (typeof onRelease !== 'function' || !sentinel) return;
  const addOnce = (s) => {
    if (!s || typeof s.addEventListener !== 'function') return;
    try {
      s.addEventListener(
        'release',
        () => {
          try {
            onRelease();
          } catch {
            // never throw out of the release callback
          }
        },
        { once: true },
      );
    } catch {
      // never throw — addEventListener absent / throwing host
    }
  };
  try {
    if (typeof sentinel.then === 'function') {
      sentinel.then(addOnce).catch(() => {});
    } else {
      addOnce(sentinel);
    }
  } catch {
    // never throw
  }
}

/**
 * Request the screen wake lock through the injected `navigator`. Feature-detected
 * and fail-safe: an absent `navigator.wakeLock`, an absent `.request`, or a
 * throwing call returns null; the async rejection (not visible / not allowed) is
 * swallowed. It never throws. Returns whatever `request('screen')` yields — a
 * `WakeLockSentinel` promise on a real WebView, or a plain sentinel from a test
 * fake — which releaseWakeLock() below accepts either way, or null on failure.
 *
 * `onRelease` (optional) is invoked once if the sentinel is released — by us OR by
 * the platform — so the caller can re-acquire while still playing (Story 7.5).
 * @param {{wakeLock?:{request?:(type:string)=>unknown}}|null|undefined} nav
 * @param {() => void} [onRelease] one-shot callback on sentinel release.
 * @returns {unknown|null} the sentinel/promise, or null when unavailable.
 */
export function acquireWakeLock(nav, onRelease) {
  const wl = nav && nav.wakeLock;
  if (!wl || typeof wl.request !== 'function') return null; // feature-detect → null
  try {
    const sentinel = wl.request('screen');
    // Swallow the async rejection (e.g. document not visible / policy) so an
    // unhandled rejection never escapes — guarded on a thenable return only.
    if (sentinel && typeof sentinel.catch === 'function') sentinel.catch(() => {});
    // Recover from an involuntary platform release (never throws).
    attachReleaseListener(sentinel, onRelease);
    return sentinel ?? null;
  } catch {
    return null; // synchronous throw on an unsupported host
  }
}

/**
 * Release a wake lock previously acquired via acquireWakeLock. Accepts either a
 * resolved sentinel (`.release()`) or the promise-of-sentinel a real WebView
 * returns (resolve then release). Fail-safe: null / absent `.release` / a throw
 * all degrade to a no-op, and the promise path swallows its rejection. Never throws.
 * @param {unknown|null|undefined} sentinel The value acquireWakeLock returned.
 */
export function releaseWakeLock(sentinel) {
  if (!sentinel) return;
  try {
    if (typeof sentinel.then === 'function') {
      // Promise-of-sentinel (real WakeLock API): resolve, then release.
      sentinel
        .then((s) => {
          if (s && typeof s.release === 'function') s.release();
        })
        .catch(() => {});
    } else if (typeof sentinel.release === 'function') {
      sentinel.release(); // already a resolved sentinel (test fake / synchronous host)
    }
  } catch {
    // never throw — release on an unsupported / already-released lock
  }
}
