import { describe, it, expect } from 'vitest';
import {
  SETTINGS_TITLE,
  SETTINGS_HINT,
  formatVolume,
  formatToggle,
} from './settingsMenu.js';

// settingsMenu — the Phaser-free settings content/format seam (Story 5.3). These
// node-only tests pin the spec's I/O matrix rows for formatVolume/formatToggle
// (happy + edge inputs) and assert the content constants are non-empty strings.

describe('formatVolume (I/O matrix)', () => {
  it('formats a mid volume as a whole percent', () => {
    expect(formatVolume(0.6)).toBe('VOLUME  60%');
  });
  it('formats 0 and 1 endpoints', () => {
    expect(formatVolume(0)).toBe('VOLUME  0%');
    expect(formatVolume(1)).toBe('VOLUME  100%');
  });
  it('rounds to the nearest whole percent', () => {
    expect(formatVolume(0.555)).toBe('VOLUME  56%');
  });
  it('coerces NaN to 0%', () => {
    expect(formatVolume(NaN)).toBe('VOLUME  0%');
  });
  it('coerces a negative value to 0%', () => {
    expect(formatVolume(-0.5)).toBe('VOLUME  0%');
  });
  it('clamps an out-of-range value to 100%', () => {
    expect(formatVolume(5)).toBe('VOLUME  100%');
  });
  it('coerces undefined to 0%', () => {
    expect(formatVolume(undefined)).toBe('VOLUME  0%');
  });
  it('coerces Infinity to 0%', () => {
    expect(formatVolume(Infinity)).toBe('VOLUME  0%');
  });
});

describe('formatToggle (I/O matrix)', () => {
  it('formats an ON toggle', () => {
    expect(formatToggle('MUTE', true)).toBe('MUTE  ON');
  });
  it('formats an OFF toggle', () => {
    expect(formatToggle('FULLSCREEN', false)).toBe('FULLSCREEN  OFF');
  });
  it('coerces truthy/falsy non-booleans', () => {
    expect(formatToggle('MUTE', 1)).toBe('MUTE  ON');
    expect(formatToggle('MUTE', 0)).toBe('MUTE  OFF');
  });
});

describe('settings content constants', () => {
  it('SETTINGS_TITLE is a non-empty string', () => {
    expect(typeof SETTINGS_TITLE).toBe('string');
    expect(SETTINGS_TITLE.length).toBeGreaterThan(0);
  });
  it('SETTINGS_HINT is a non-empty string naming the keys', () => {
    expect(typeof SETTINGS_HINT).toBe('string');
    expect(SETTINGS_HINT.length).toBeGreaterThan(0);
  });
  it('SETTINGS_HINT names the Reduced Motion toggle key (Story 6.1)', () => {
    expect(SETTINGS_HINT).toContain('Reduced Motion');
    expect(SETTINGS_HINT).toContain('R');
  });
});
