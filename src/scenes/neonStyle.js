// neonStyle — Phaser-free config/apply seam for the neon aesthetic (Story 4.1).
//
// The signature neon look is two view-only render-wiring changes: put the neon
// vector layers into additive blend, and register ONE camera-level Bloom post-FX
// pass. Both are expressed here as small, side-effect-only functions over the
// minimal shapes they touch, so the wiring has automated coverage — a dropped or
// reordered bloom parameter, or a missed layer, is caught by neonStyle.test.js
// rather than shipping silently.
//
// This module imports Phaser NOTHING (mirrors constants.js / telegraphCue.js):
// the additive blend-mode value (Phaser.BlendModes.ADD) is INJECTED by the caller
// so the helper stays headless-testable in vitest/jsdom, and the bloom is applied
// by forwarding the config tuple to a camera the caller passes in. Configuration
// happens once in ArenaScene.create(); nothing here runs per frame.

import {
  NEON_BLOOM_COLOR,
  NEON_BLOOM_OFFSET_X,
  NEON_BLOOM_OFFSET_Y,
  NEON_BLOOM_BLUR_STRENGTH,
  NEON_BLOOM_STRENGTH,
  NEON_BLOOM_STEPS,
} from '../config/constants.js';

/**
 * The camera Bloom configuration, built from the centralized NEON_BLOOM_*
 * constants. Field order mirrors the Phaser
 * addBloom(color, offsetX, offsetY, blurStrength, strength, steps) signature so
 * addNeonBloom can forward it positionally with no re-ordering.
 * @type {{color: number, offsetX: number, offsetY: number, blurStrength: number, strength: number, steps: number}}
 */
// Frozen: NEON_BLOOM is immutable config read live by addNeonBloom on every
// create()/scene.restart(); freezing prevents a stray mutation elsewhere from
// leaking into a later run's bloom registration.
export const NEON_BLOOM = Object.freeze({
  color: NEON_BLOOM_COLOR,
  offsetX: NEON_BLOOM_OFFSET_X,
  offsetY: NEON_BLOOM_OFFSET_Y,
  blurStrength: NEON_BLOOM_BLUR_STRENGTH,
  strength: NEON_BLOOM_STRENGTH,
  steps: NEON_BLOOM_STEPS,
});

/**
 * Put every neon vector layer into additive blend so bright shapes accumulate
 * light over the dark background (the Geometry Wars glow). The additive
 * blend-mode value is injected by the caller (Phaser.BlendModes.ADD) so this
 * module stays Phaser-free. Each layer's setBlendMode is called exactly once.
 * @param {Array<{setBlendMode: function}>} layers The neon render layers.
 * @param {number} blendAdd The additive blend-mode value (Phaser.BlendModes.ADD).
 * @returns {Array<{setBlendMode: function}>} The same layers list (for chaining).
 */
export function applyAdditiveBlend(layers, blendAdd) {
  for (const layer of layers) {
    layer.setBlendMode(blendAdd);
  }
  return layers;
}

/**
 * Register ONE Bloom post-FX pass on the given camera from NEON_BLOOM. Cost is a
 * single screen-space pass independent of entity count (this is why it holds
 * 60 FPS in a busy arena). Forwards the NEON_BLOOM tuple positionally in the
 * documented addBloom order.
 * @param {{postFX: {addBloom: function}}} camera The camera (cameras.main).
 * @returns {*} The Bloom FX controller returned by addBloom.
 */
export function addNeonBloom(camera) {
  return camera.postFX.addBloom(
    NEON_BLOOM.color,
    NEON_BLOOM.offsetX,
    NEON_BLOOM.offsetY,
    NEON_BLOOM.blurStrength,
    NEON_BLOOM.strength,
    NEON_BLOOM.steps,
  );
}
