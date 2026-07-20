import {
  COLOR_BLACK_HOLE,
  COLOR_BLACK_HOLE_UNSTABLE,
  BLACKHOLE_PULSE_HZ,
  BLACKHOLE_PULSE_ALPHA_DEPTH,
} from '../config/constants.js';

// blackHoleRender — pure, Phaser-free Black Hole instability render-cue math
// (Story 6.2).
//
// As a hole's instability (blackHoleInstability(radius), 0..1) rises toward
// detonation, its body shifts from the resting purple COLOR_BLACK_HOLE toward the
// alarming red COLOR_BLACK_HOLE_UNSTABLE and its alpha pulses faster and deeper.
// That instability→color/alpha mapping lives here (NOT inline in ArenaScene, which
// imports Phaser and so cannot be unit-tested) so the escalating-red-pulse telegraph
// has automated coverage — an inverted or dead pulse would be caught rather than
// shipping silently. ArenaScene imports these and feeds them the per-hole instability
// ratio. Zero allocation — both are scalar functions. Imports NO Phaser (mirrors
// telegraphCue.js / particleStyle.js / neonStyle.js).

/**
 * @param {number} v value to clamp
 * @param {number} lo lower bound
 * @param {number} hi upper bound
 * @returns {number} v clamped to [lo, hi]
 */
function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Body fill color for a hole at the given instability ratio: a per-channel linear
 * interpolation from COLOR_BLACK_HOLE (ratio 0, resting purple) to
 * COLOR_BLACK_HOLE_UNSTABLE (ratio 1, alarming red). The ratio is clamped to [0,1],
 * so ratio 0 returns exactly COLOR_BLACK_HOLE and ratio 1 exactly
 * COLOR_BLACK_HOLE_UNSTABLE. Returns a packed 0xRRGGBB integer.
 * @param {number} ratio Instability in [0,1] (clamped).
 * @returns {number} packed 0xRRGGBB color
 */
export function blackHolePulseColor(ratio) {
  const t = clamp(ratio, 0, 1);
  const r0 = (COLOR_BLACK_HOLE >> 16) & 0xff;
  const g0 = (COLOR_BLACK_HOLE >> 8) & 0xff;
  const b0 = COLOR_BLACK_HOLE & 0xff;
  const r1 = (COLOR_BLACK_HOLE_UNSTABLE >> 16) & 0xff;
  const g1 = (COLOR_BLACK_HOLE_UNSTABLE >> 8) & 0xff;
  const b1 = COLOR_BLACK_HOLE_UNSTABLE & 0xff;
  const r = Math.round(r0 + (r1 - r0) * t);
  const g = Math.round(g0 + (g1 - g0) * t);
  const b = Math.round(b0 + (b1 - b0) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Body draw alpha for a hole at the given instability ratio and animation time.
 * At ratio 0 the alpha is STEADY at baseAlpha (a resting hole does not pulse,
 * independent of timeMs). As the ratio rises, the alpha oscillates around baseAlpha
 * with a swing depth (BLACKHOLE_PULSE_ALPHA_DEPTH·ratio) and rate
 * (BLACKHOLE_PULSE_HZ·ratio cycles/sec) that both grow with instability, so the
 * pulse gets deeper and faster as detonation nears. Clamped to [0,1].
 *
 * Reduced motion (Story 6.1 / WCAG 2.3.1): when `reduceMotion` is true the TEMPORAL
 * oscillation is suppressed — the alpha is held STEADY at baseAlpha (no sine
 * flashing, so nothing lands in the seizure band) while the escalating red COLOR
 * (blackHolePulseColor, a static value) still reads as the non-motion instability
 * cue. This mirrors the sibling reduced-motion gates (flash / camera-shake /
 * grid-warp): reduced motion changes what MOVES, not whether the feedback reads.
 * @param {number} ratio Instability in [0,1] (clamped).
 * @param {number} timeMs Animation time (ms) — e.g. the scene clock.
 * @param {number} baseAlpha The resting alpha the pulse oscillates around.
 * @param {boolean} [reduceMotion=false] When true, suppress the oscillation (steady baseAlpha).
 * @returns {number} alpha in [0,1]
 */
export function blackHolePulseAlpha(ratio, timeMs, baseAlpha, reduceMotion = false) {
  const t = clamp(ratio, 0, 1);
  const depth = BLACKHOLE_PULSE_ALPHA_DEPTH * t;
  // No pulse at rest (depth 0) OR under reduced motion → steady baseAlpha.
  if (depth === 0 || reduceMotion) return clamp(baseAlpha, 0, 1);
  const rateHz = BLACKHOLE_PULSE_HZ * t;
  const phase = 2 * Math.PI * rateHz * (timeMs / 1000);
  const a = baseAlpha * (1 + depth * Math.sin(phase));
  return clamp(a, 0, 1);
}
