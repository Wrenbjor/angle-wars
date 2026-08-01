// neonStyle — Phaser-free config/apply seam for the neon aesthetic (Story 4.1).
//
// The signature neon look comes from saturated source colors accumulating on
// selected vector layers through additive blending. It deliberately does not use a
// camera-wide post-FX pass: a full-frame bloom composites white light over gameplay
// and UI together, washing out the palette and reducing text contrast.
//
// This module imports Phaser NOTHING (mirrors constants.js / telegraphCue.js):
// the additive blend-mode value (Phaser.BlendModes.ADD) is INJECTED by the caller
// so the helper stays headless-testable in vitest/jsdom. Configuration happens once
// in each scene's create(); nothing here runs per frame.

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
