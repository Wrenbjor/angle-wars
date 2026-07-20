import { describe, it, expect } from 'vitest';
import {
  musicLayerGains,
  effectiveVolume,
  clampVolume,
  adjustVolume,
} from './audioMix.js';
import {
  AUDIO_MUSIC_LAYER_COUNT,
  AUDIO_MUSIC_LAYER_MAX_GAIN,
} from '../config/constants.js';

// audioMix — the pure, Phaser-free audio math (Story 4.5). These tests lock every
// I/O-matrix row headlessly: the layer-gain curve (length/band/clamp/monotonic and
// more-layers-audible-as-intensity-rises) and the volume/mute helpers.

// Count how many layers are audible (> 0) at a given intensity.
function audibleLayers(intensity) {
  return musicLayerGains(intensity).filter((g) => g > 0).length;
}

describe('audioMix.musicLayerGains — shape + bounds', () => {
  it('returns an array of length AUDIO_MUSIC_LAYER_COUNT', () => {
    expect(musicLayerGains(0)).toHaveLength(AUDIO_MUSIC_LAYER_COUNT);
    expect(musicLayerGains(0.5)).toHaveLength(AUDIO_MUSIC_LAYER_COUNT);
    expect(musicLayerGains(1)).toHaveLength(AUDIO_MUSIC_LAYER_COUNT);
  });

  it('every gain stays within [0, AUDIO_MUSIC_LAYER_MAX_GAIN]', () => {
    for (const intensity of [0, 0.13, 0.37, 0.5, 0.88, 1, 1.5, -0.3]) {
      for (const g of musicLayerGains(intensity)) {
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(AUDIO_MUSIC_LAYER_MAX_GAIN);
      }
    }
  });

  it('all layers silent at intensity 0 and all at peak at intensity 1', () => {
    for (const g of musicLayerGains(0)) expect(g).toBe(0);
    for (const g of musicLayerGains(1)) {
      expect(g).toBeCloseTo(AUDIO_MUSIC_LAYER_MAX_GAIN, 9);
    }
  });

  it('brings MORE layers up as intensity rises (more difficulty ⇒ more layers)', () => {
    // Sample rising intensities; the count of audible layers never decreases and
    // ends strictly greater than it starts.
    let prev = audibleLayers(0);
    let sawIncrease = false;
    for (let p = 0.05; p <= 1.00001; p += 0.05) {
      const n = audibleLayers(p);
      expect(n).toBeGreaterThanOrEqual(prev);
      if (n > prev) sawIncrease = true;
      prev = n;
    }
    expect(sawIncrease).toBe(true);
    expect(audibleLayers(1)).toBeGreaterThan(audibleLayers(0));
  });

  it('each layer gain is monotonic non-decreasing in intensity', () => {
    const prev = musicLayerGains(0);
    for (let p = 0.05; p <= 1.00001; p += 0.05) {
      const cur = musicLayerGains(p);
      for (let i = 0; i < AUDIO_MUSIC_LAYER_COUNT; i++) {
        expect(cur[i]).toBeGreaterThanOrEqual(prev[i] - 1e-9);
        prev[i] = cur[i];
      }
    }
  });

  it('clamps an out-of-range intensity (>1 acts as 1, <0 acts as 0)', () => {
    for (let i = 0; i < AUDIO_MUSIC_LAYER_COUNT; i++) {
      expect(musicLayerGains(5)[i]).toBeCloseTo(AUDIO_MUSIC_LAYER_MAX_GAIN, 9);
      expect(musicLayerGains(-5)[i]).toBe(0);
    }
  });

  it('maps layer 0 to fade in FIRST and layer N-1 LAST (exact index→band mapping)', () => {
    const n = AUDIO_MUSIC_LAYER_COUNT;
    // An intensity inside layer 0's band [0, 1/n]: only layer 0 has begun, the top
    // layer is still fully silent. This pins the direction of the mapping — a
    // reversed layer→index assignment (top layer first) would fail here.
    const lowInBand0 = 0.5 / n;
    const early = musicLayerGains(lowInBand0);
    expect(early[0]).toBeGreaterThan(0);
    expect(early[n - 1]).toBe(0);

    // An intensity inside the LAST band [(n-1)/n, 1]: the top layer is now audible.
    const inLastBand = (n - 1) / n + 0.5 / n;
    expect(musicLayerGains(inLastBand)[n - 1]).toBeGreaterThan(0);
  });

  it('is NaN-safe: a NaN intensity yields an all-zero array of the right length', () => {
    const gains = musicLayerGains(NaN);
    expect(gains).toHaveLength(AUDIO_MUSIC_LAYER_COUNT);
    for (const g of gains) expect(g).toBe(0);
  });

  it('fills and returns a provided reusable buffer (no allocation)', () => {
    const buf = new Array(AUDIO_MUSIC_LAYER_COUNT).fill(-1);
    const out = musicLayerGains(1, buf);
    expect(out).toBe(buf); // same reference, filled in place
    expect(out).toHaveLength(AUDIO_MUSIC_LAYER_COUNT);
    for (const g of out) expect(g).toBeCloseTo(AUDIO_MUSIC_LAYER_MAX_GAIN, 9);
  });
});

describe('audioMix.effectiveVolume — mute / passthrough / clamp', () => {
  it('passes the volume through when not muted', () => {
    expect(effectiveVolume(0.6, false)).toBe(0.6);
  });
  it('is 0 when muted', () => {
    expect(effectiveVolume(0.6, true)).toBe(0);
  });
  it('clamps an over-range volume to 1', () => {
    expect(effectiveVolume(2, false)).toBe(1);
  });
  it('clamps an under-range volume to 0', () => {
    expect(effectiveVolume(-1, false)).toBe(0);
  });
});

describe('audioMix.adjustVolume — step + clamp', () => {
  it('steps up by the delta', () => {
    expect(adjustVolume(0.6, 0.1)).toBeCloseTo(0.7, 9);
  });
  it('clamps a step past 1 to 1', () => {
    expect(adjustVolume(0.95, 0.1)).toBe(1);
  });
  it('clamps a step below 0 to 0', () => {
    expect(adjustVolume(0.05, -0.1)).toBe(0);
  });
});

describe('audioMix.clampVolume — clamp to [0,1]', () => {
  it('passes an in-range value through', () => {
    expect(clampVolume(0.5)).toBe(0.5);
  });
  it('clamps above 1', () => {
    expect(clampVolume(1.5)).toBe(1);
  });
  it('clamps below 0', () => {
    expect(clampVolume(-0.2)).toBe(0);
  });
  it('is NaN-safe (NaN → 0), so no NaN gain ever reaches the engine', () => {
    expect(clampVolume(NaN)).toBe(0);
  });
});
