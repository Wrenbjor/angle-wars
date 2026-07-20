import { describe, it, expect } from 'vitest';
import { PAUSE_TITLE, PAUSE_PROMPT, togglePause } from './pauseControl.js';

describe('togglePause (I/O matrix)', () => {
  it('pauses a live run', () => {
    expect(togglePause(false, false)).toBe(true);
  });

  it('resumes a paused run', () => {
    expect(togglePause(true, false)).toBe(false);
  });

  it('cannot pause at game over', () => {
    expect(togglePause(false, true)).toBe(false);
  });

  it('defensively forces unpaused when paused + game over', () => {
    expect(togglePause(true, true)).toBe(false);
  });
});

describe('pause overlay content constants', () => {
  it('PAUSE_TITLE is a non-empty string', () => {
    expect(typeof PAUSE_TITLE).toBe('string');
    expect(PAUSE_TITLE.length).toBeGreaterThan(0);
  });

  it('PAUSE_PROMPT is a non-empty string', () => {
    expect(typeof PAUSE_PROMPT).toBe('string');
    expect(PAUSE_PROMPT.length).toBeGreaterThan(0);
  });
});
