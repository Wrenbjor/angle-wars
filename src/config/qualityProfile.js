// qualityProfile — pure, Phaser-free device-quality seam (Story 7.4).
//
// The game ships one binary presentation-cost profile chosen at ArenaScene.create():
// the DESKTOP defaults, or a MOBILE profile that scales the particle cap, the camera
// bloom fill cost, and the grid line density DOWN so a mid-range mobile GPU inside the
// Capacitor WebView holds the 60 FPS target under peak load (NFR9, NFR1). This module
// owns that decision as three small pieces, isolated from Phaser and from any
// @capacitor/* package so it runs headlessly in the node vitest env:
//
//   - detectMobile(env)         a PURE predicate over an injected env shape,
//   - readMobileEnv(win)        a thin, fail-safe browser boundary that builds that
//                               env from the runtime-injected `window` globals,
//   - resolveQualityProfile(m)  maps the boolean to a FROZEN { particleMax, bloom,
//                               gridSpacing } profile.
//
// The split mirrors mobileLayout.js (readSafeAreaInsetsCss / lockLandscape): the pure
// math is exhaustively unit-testable, and the boundary try/catch-degrades to a
// desktop-shaped env on any missing/throwing host global, so a resolve at create()
// can NEVER crash. The DESKTOP branch returns values byte-identical to today's
// PARTICLE_MAX / NEON_BLOOM / GRID_SPACING, so non-mobile play is a zero regression.

import {
  PARTICLE_MAX,
  GRID_SPACING,
  MOBILE_PARTICLE_MAX,
  MOBILE_NEON_BLOOM_BLUR_STRENGTH,
  MOBILE_NEON_BLOOM_STRENGTH,
  MOBILE_NEON_BLOOM_STEPS,
  MOBILE_GRID_SPACING,
} from './constants.js';
import { NEON_BLOOM } from '../scenes/neonStyle.js';

// The desktop-shaped env every fail-safe path degrades to: no Capacitor, a fine
// (non-coarse) primary pointer, no touch, and an empty UA — detectMobile → false.
const DESKTOP_ENV = Object.freeze({
  capacitorNative: false,
  coarsePointer: false,
  maxTouchPoints: 0,
  userAgent: '',
});

// Mobile user-agent signal. Corroborates the coarse-pointer + touch input signals so
// a touch-capable DESKTOP (e.g. a touchscreen laptop with a mouse) is not
// misclassified as a phone. Case-insensitive; covers the mainstream mobile UAs.
const MOBILE_UA_RE =
  /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile|webOS/i;

/**
 * Pure predicate: does this env describe a mobile / Capacitor-native runtime?
 * Capacitor-native short-circuits to true (the game is definitively on a device).
 * Otherwise it requires ALL THREE web signals together — a coarse primary pointer, a
 * positive touch-point count, AND a mobile user agent — so a fine-pointer desktop, or
 * a touch-capable laptop whose UA is a desktop UA, degrades to the desktop profile.
 * Never throws; a null/undefined env is desktop.
 * @param {{capacitorNative?:boolean, coarsePointer?:boolean, maxTouchPoints?:number, userAgent?:string}} env
 * @returns {boolean}
 */
export function detectMobile(env) {
  if (!env) return false;
  if (env.capacitorNative === true) return true;
  const coarse = env.coarsePointer === true;
  const touch =
    typeof env.maxTouchPoints === 'number' && env.maxTouchPoints > 0;
  const mobileUa =
    typeof env.userAgent === 'string' && MOBILE_UA_RE.test(env.userAgent);
  return coarse && touch && mobileUa;
}

/**
 * Injectable, fail-safe browser boundary: read the mobile-detection signals off the
 * runtime-injected `window` and return the plain env shape detectMobile consumes.
 * Reads `window.Capacitor?.isNativePlatform?.()` (the WebView-injected global — this
 * module imports NO @capacitor/* package), `matchMedia('(pointer: coarse)')`,
 * `navigator.maxTouchPoints`, and `navigator.userAgent`. Fail-safe like
 * mobileLayout.readSafeAreaInsetsCss / lockLandscape: any absent or throwing host
 * global degrades the WHOLE read to the desktop-shaped env, so it NEVER throws.
 * @param {(Window & typeof globalThis)|null|undefined} win  e.g. window
 * @returns {{capacitorNative:boolean, coarsePointer:boolean, maxTouchPoints:number, userAgent:string}}
 */
export function readMobileEnv(win) {
  if (!win) return { ...DESKTOP_ENV };

  // Read the native signal FIRST, in its own guarded step, so a LATER throw from
  // matchMedia / navigator can never erase a confirmed Capacitor-native device down to
  // the heavy desktop profile (the exact opposite of intent). A throw/absent Capacitor
  // here is simply `false`.
  let capacitorNative = false;
  try {
    const cap = win.Capacitor;
    capacitorNative = !!(
      cap &&
      typeof cap.isNativePlatform === 'function' &&
      cap.isNativePlatform()
    );
  } catch {
    capacitorNative = false;
  }

  // Then the web input signals, in a SEPARATE guard. A throw here (an old/strict WebView
  // that raises on matchMedia / navigator access) falls back to the desktop-safe values
  // while PRESERVING the already-resolved capacitorNative — never crashes create().
  try {
    let coarsePointer = false;
    if (typeof win.matchMedia === 'function') {
      const mq = win.matchMedia('(pointer: coarse)');
      coarsePointer = !!(mq && mq.matches);
    }

    const nav = win.navigator;
    const maxTouchPoints =
      nav && typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0;
    const userAgent =
      nav && typeof nav.userAgent === 'string' ? nav.userAgent : '';

    return { capacitorNative, coarsePointer, maxTouchPoints, userAgent };
  } catch {
    return {
      capacitorNative,
      coarsePointer: false,
      maxTouchPoints: 0,
      userAgent: '',
    };
  }
}

/**
 * Resolve the frozen quality profile from the mobile boolean. DESKTOP returns the
 * canonical desktop tunables verbatim (byte-identical to PARTICLE_MAX / NEON_BLOOM /
 * GRID_SPACING — the reused, already-frozen NEON_BLOOM object). MOBILE returns the
 * scaled-down profile sourced from the MOBILE_* constants: a smaller particle cap, a
 * cheaper bloom (fewer steps + lower blur/strength, SAME color/offsets), and a coarser
 * grid spacing. Both the profile and its nested bloom are frozen so no downstream
 * consumer can mutate the shared config. Introduces zero per-frame allocation — it is
 * called ONCE per create().
 * @param {boolean} mobile
 * @returns {Readonly<{particleMax:number, bloom:Readonly<{color:number, offsetX:number, offsetY:number, blurStrength:number, strength:number, steps:number}>, gridSpacing:number}>}
 */
export function resolveQualityProfile(mobile) {
  if (mobile) {
    return Object.freeze({
      particleMax: MOBILE_PARTICLE_MAX,
      // Keep the desktop bloom color + offsets (they carry no fill cost); scale only
      // the load-bearing fill knobs (blur/strength/steps) down.
      bloom: Object.freeze({
        ...NEON_BLOOM,
        blurStrength: MOBILE_NEON_BLOOM_BLUR_STRENGTH,
        strength: MOBILE_NEON_BLOOM_STRENGTH,
        steps: MOBILE_NEON_BLOOM_STEPS,
      }),
      gridSpacing: MOBILE_GRID_SPACING,
    });
  }
  // DESKTOP: the verbatim desktop constants. NEON_BLOOM is reused directly (already
  // frozen) so the desktop bloom is byte-identical to today's registration.
  return Object.freeze({
    particleMax: PARTICLE_MAX,
    bloom: NEON_BLOOM,
    gridSpacing: GRID_SPACING,
  });
}
