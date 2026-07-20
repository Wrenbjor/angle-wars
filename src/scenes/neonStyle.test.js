import { describe, it, expect, vi } from 'vitest';
import { NEON_BLOOM, applyAdditiveBlend, addNeonBloom } from './neonStyle.js';
import {
  NEON_BLOOM_COLOR,
  NEON_BLOOM_OFFSET_X,
  NEON_BLOOM_OFFSET_Y,
  NEON_BLOOM_BLUR_STRENGTH,
  NEON_BLOOM_STRENGTH,
  NEON_BLOOM_STEPS,
} from '../config/constants.js';

// A stand-in for Phaser.BlendModes.ADD (value 1) — injected so the helper stays
// Phaser-free.
const ADD = 1;

// A fake neon layer: records each setBlendMode call.
function fakeLayer() {
  return { setBlendMode: vi.fn() };
}

describe('NEON_BLOOM (config ↔ constants mapping)', () => {
  it('maps every NEON_BLOOM_* constant onto the documented field, in order', () => {
    expect(NEON_BLOOM).toEqual({
      color: NEON_BLOOM_COLOR,
      offsetX: NEON_BLOOM_OFFSET_X,
      offsetY: NEON_BLOOM_OFFSET_Y,
      blurStrength: NEON_BLOOM_BLUR_STRENGTH,
      strength: NEON_BLOOM_STRENGTH,
      steps: NEON_BLOOM_STEPS,
    });
  });

  it('exposes exactly the six addBloom fields in the addBloom order', () => {
    expect(Object.keys(NEON_BLOOM)).toEqual([
      'color',
      'offsetX',
      'offsetY',
      'blurStrength',
      'strength',
      'steps',
    ]);
  });

  it('is frozen (immutable config read live on every create()/restart())', () => {
    expect(Object.isFrozen(NEON_BLOOM)).toBe(true);
  });
});

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

describe('addNeonBloom', () => {
  it('forwards the NEON_BLOOM tuple to camera.postFX.addBloom in the documented order', () => {
    const controller = { id: 'bloom-controller' };
    const addBloom = vi.fn().mockReturnValue(controller);
    const fakeCamera = { postFX: { addBloom } };

    const returned = addNeonBloom(fakeCamera);

    expect(addBloom).toHaveBeenCalledTimes(1);
    expect(addBloom).toHaveBeenCalledWith(
      NEON_BLOOM.color,
      NEON_BLOOM.offsetX,
      NEON_BLOOM.offsetY,
      NEON_BLOOM.blurStrength,
      NEON_BLOOM.strength,
      NEON_BLOOM.steps,
    );
    // returns whatever the camera's addBloom returns (the FX controller).
    expect(returned).toBe(controller);
  });

  it('forwards fields to addBloom positions in documented order — verified with distinct values', async () => {
    // The other order assertions use the real constants, whose fixture values
    // collide (offsetX==offsetY==1, blurStrength==strength==1.2), so a within-pair
    // swap would ship green. Re-import neonStyle over a mocked constants module
    // with DISTINCT sentinels so each addBloom position (and NEON_BLOOM field) is
    // pinned individually. The reset/unmock restores the real module for the rest.
    vi.resetModules();
    vi.doMock('../config/constants.js', () => ({
      NEON_BLOOM_COLOR: 0x111111,
      NEON_BLOOM_OFFSET_X: 2,
      NEON_BLOOM_OFFSET_Y: 3,
      NEON_BLOOM_BLUR_STRENGTH: 4,
      NEON_BLOOM_STRENGTH: 5,
      NEON_BLOOM_STEPS: 6,
    }));
    try {
      const mod = await import('./neonStyle.js');
      const addBloom = vi.fn();
      mod.addNeonBloom({ postFX: { addBloom } });
      // distinct values pin each position: color, offsetX, offsetY, blurStrength, strength, steps
      expect(addBloom).toHaveBeenCalledWith(0x111111, 2, 3, 4, 5, 6);
      expect(mod.NEON_BLOOM).toEqual({
        color: 0x111111,
        offsetX: 2,
        offsetY: 3,
        blurStrength: 4,
        strength: 5,
        steps: 6,
      });
    } finally {
      vi.doUnmock('../config/constants.js');
      vi.resetModules();
    }
  });
});
