// audioMix — pure, Phaser-free audio math for Story 4.5.
//
// The adaptive-music layer gains and the volume/mute math are all scalar/array
// maps. Keeping them here (NOT inline in ArenaScene, which imports Phaser and so
// cannot be unit-tested, nor in the browser-bound audioEngine) gives the feel
// automated coverage — an inverted layer curve or an unclamped volume would be
// caught rather than shipping silently. ArenaScene feeds musicIntensity /
// {muted, volume} through these functions each frame / on each change. Imports NO
// Phaser (mirrors screenShake.js / particleStyle.js / neonStyle.js).

import {
  AUDIO_MUSIC_LAYER_COUNT,
  AUDIO_MUSIC_LAYER_MAX_GAIN,
} from '../config/constants.js';

/**
 * Clamp a value to [0, 1], NaN-safe. This is the sole defensive clamp for the whole
 * mix seam, so a NaN input (which would otherwise sail through a `< 0` / `> 1` pair
 * and produce NaN gains that make setTargetAtTime(NaN) throw) must map to 0. The
 * `!(t > 0)` guard catches NaN, negatives, and 0 alike. @private
 */
function clamp01(t) {
  if (!(t > 0)) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * Per-layer gains for the adaptive music at a given difficulty intensity.
 *
 * Returns an array of AUDIO_MUSIC_LAYER_COUNT gains. Layer i fades in linearly over
 * its own intensity band [i/N, (i+1)/N] from 0 up to AUDIO_MUSIC_LAYER_MAX_GAIN, then
 * holds. So at intensity 0 every layer is silent; as intensity rises, progressively
 * more layers become audible (layer 0 first, layer N-1 last, fully on at intensity 1)
 * — "more difficulty ⇒ more music layers." Each layer's gain is monotonic
 * non-decreasing in intensity and clamped to [0, MAX_GAIN].
 *
 * @param {number} intensity Difficulty intensity in [0,1] (clamped here).
 * @param {number[]} [out] Optional reusable output array (filled + returned) so the
 *   per-frame render loop allocates nothing; a fresh array is created when omitted.
 * @returns {number[]} array of length AUDIO_MUSIC_LAYER_COUNT, each in [0, MAX_GAIN]
 */
export function musicLayerGains(intensity, out) {
  const n = AUDIO_MUSIC_LAYER_COUNT;
  const gains = out || new Array(n);
  const p = clamp01(intensity);
  const bandWidth = 1 / n;
  for (let i = 0; i < n; i++) {
    // Fraction this layer has faded in within its own [i/n, (i+1)/n] band.
    const frac = clamp01((p - i * bandWidth) / bandWidth);
    gains[i] = frac * AUDIO_MUSIC_LAYER_MAX_GAIN;
  }
  gains.length = n; // trim any excess if a longer reusable buffer was passed
  return gains;
}

/**
 * Clamp a raw volume to the valid master-volume range [0, 1].
 * @param {number} v
 * @returns {number} v clamped to [0, 1]
 */
export function clampVolume(v) {
  return clamp01(v);
}

/**
 * Effective output gain for the current volume + mute state: 0 when muted (silence),
 * else the clamped volume. Muting yields exact silence while the sim, latches, and
 * music voices keep running — only the master gain is 0.
 * @param {number} volume Raw master volume.
 * @param {boolean} muted Whether audio is muted.
 * @returns {number} effective gain in [0, 1]
 */
export function effectiveVolume(volume, muted) {
  return muted ? 0 : clamp01(volume);
}

/**
 * Step a volume by a delta (up or down) and clamp back into [0, 1]. Used by the
 * volume-up/down keys (delta = ±AUDIO_VOLUME_STEP).
 * @param {number} current Current volume.
 * @param {number} delta Signed step to apply.
 * @returns {number} the new volume clamped to [0, 1]
 */
export function adjustVolume(current, delta) {
  return clamp01(current + delta);
}
