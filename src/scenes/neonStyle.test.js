import { describe, it, expect, vi } from 'vitest';
import * as neonStyle from './neonStyle.js';
import { applyAdditiveBlend } from './neonStyle.js';

// A stand-in for Phaser.BlendModes.ADD (value 1) — injected so the helper stays
// Phaser-free.
const ADD = 1;

// A fake neon layer: records each setBlendMode call.
function fakeLayer() {
  return { setBlendMode: vi.fn() };
}

describe('applyAdditiveBlend', () => {
  it('calls setBlendMode(ADD) exactly once on every layer and returns the list', () => {
    const layers = [fakeLayer(), fakeLayer(), fakeLayer()];
    const result = applyAdditiveBlend(layers, ADD);

    for (const layer of layers) {
      expect(layer.setBlendMode).toHaveBeenCalledTimes(1);
      expect(layer.setBlendMode).toHaveBeenCalledWith(ADD);
    }
    expect(result).toBe(layers);
  });

  it('tolerates an empty list: no calls, returns [] without throwing', () => {
    const empty = [];
    expect(() => applyAdditiveBlend(empty, ADD)).not.toThrow();
    expect(applyAdditiveBlend(empty, ADD)).toBe(empty);
  });
});

describe('camera-wide bloom removal', () => {
  it('does not expose a camera post-FX registration helper', () => {
    expect(neonStyle).not.toHaveProperty('addNeonBloom');
  });
});
