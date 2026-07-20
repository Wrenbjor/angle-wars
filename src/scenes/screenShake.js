// screenShake — pure, Phaser-free render-math for the screen juice (Story 4.4).
//
// The camera-shake offset, the flash overlay alpha, and the trauma decay are all
// scalar math. Keeping them here (NOT inline in ArenaScene, which imports Phaser
// and so cannot be unit-tested) gives the feel automated coverage — an inverted or
// unclamped curve would be caught rather than shipping silently. ArenaScene owns
// the render-level countdowns and feeds them through these functions each frame.
// Zero allocation — every function is a scalar map. Imports NO Phaser (mirrors
// particleStyle.js / telegraphCue.js / neonStyle.js).

import {
  SCREEN_SHAKE_MAX_OFFSET,
  SCREEN_SHAKE_FREQ_X,
  SCREEN_SHAKE_FREQ_Y,
  SCREEN_SHAKE_TRAUMA_DECAY_PER_SEC,
} from '../config/constants.js';

/** Clamp a value to [0, 1]. @private */
function clamp01(t) {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * Horizontal camera shake offset (px) for the given trauma and render phase.
 * 0 at trauma 0; magnitude scales with trauma (trauma-squared for a soft ramp,
 * the classic "trauma" shake model) and oscillates with the phase; the absolute
 * value never exceeds SCREEN_SHAKE_MAX_OFFSET (trauma is clamped to [0,1] and the
 * sine is bounded by 1). At rest (trauma 0) the offset is exactly 0, so the camera
 * returns cleanly to center with no drift.
 * @param {number} trauma Current shake trauma (accumulated, clamped to [0,1] here).
 * @param {number} phase Render-time phase (ms) driving the oscillation.
 * @returns {number} horizontal offset in [-MAX, MAX]
 */
export function shakeOffsetX(trauma, phase) {
  const shake = clamp01(trauma);
  const mag = shake * shake;
  return SCREEN_SHAKE_MAX_OFFSET * mag * Math.sin(phase * SCREEN_SHAKE_FREQ_X);
}

/**
 * Vertical camera shake offset (px). Same model as shakeOffsetX but on its own
 * frequency so the two axes decorrelate (a shake, not a diagonal slide).
 * @param {number} trauma Current shake trauma (clamped to [0,1] here).
 * @param {number} phase Render-time phase (ms) driving the oscillation.
 * @returns {number} vertical offset in [-MAX, MAX]
 */
export function shakeOffsetY(trauma, phase) {
  const shake = clamp01(trauma);
  const mag = shake * shake;
  return SCREEN_SHAKE_MAX_OFFSET * mag * Math.sin(phase * SCREEN_SHAKE_FREQ_Y);
}

/**
 * Flash overlay alpha for the current flash countdown. 1 when flashMs == duration
 * (just fired), falling linearly to 0 as flashMs reaches 0 (faded), clamped to
 * [0, 1]. Tolerates flashMs > duration (stays clamped at 1) and a non-positive
 * duration (degenerate → 0, no divide-by-zero) so a mis-set placeholder never
 * yields a negative or NaN alpha.
 * @param {number} flashMs Remaining flash countdown (ms).
 * @param {number} flashDurationMs Total flash duration (ms).
 * @returns {number} alpha in [0, 1]
 */
export function flashAlpha(flashMs, flashDurationMs) {
  if (!(flashDurationMs > 0)) return 0; // guard divide-by-zero / degenerate → off
  let a = flashMs / flashDurationMs;
  if (a < 0) a = 0;
  else if (a > 1) a = 1;
  return a;
}

/**
 * Decay trauma over one render frame: trauma − DECAY_PER_SEC · dtMs/1000, clamped
 * at 0 (never negative). Real-time driven so the shake settles even while the sim
 * is frozen (game-over / hit-stop).
 * @param {number} trauma Current trauma.
 * @param {number} dtMs Elapsed render time this frame (ms).
 * @returns {number} decayed trauma, >= 0
 */
export function decayTrauma(trauma, dtMs) {
  let t = trauma - SCREEN_SHAKE_TRAUMA_DECAY_PER_SEC * (dtMs / 1000);
  if (t < 0) t = 0;
  return t;
}
