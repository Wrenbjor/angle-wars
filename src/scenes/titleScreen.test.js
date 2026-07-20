import { describe, it, expect } from 'vitest';
import {
  TITLE_TEXT,
  START_PROMPT,
  SETTINGS_PROMPT,
  CONTROLS_LINES,
  formatHighScore,
} from './titleScreen.js';

describe('formatHighScore (I/O matrix)', () => {
  it('formats a stored high score', () => {
    expect(formatHighScore(12345)).toBe('HIGH SCORE 12345');
  });

  it('formats a zero (no stored score) score', () => {
    expect(formatHighScore(0)).toBe('HIGH SCORE 0');
  });

  it('coerces a negative value to 0', () => {
    expect(formatHighScore(-5)).toBe('HIGH SCORE 0');
  });

  it('coerces NaN to 0', () => {
    expect(formatHighScore(NaN)).toBe('HIGH SCORE 0');
  });

  it('floors a fractional value', () => {
    expect(formatHighScore(3.9)).toBe('HIGH SCORE 3');
  });

  it('coerces undefined to 0', () => {
    expect(formatHighScore(undefined)).toBe('HIGH SCORE 0');
  });

  it('coerces Infinity to 0', () => {
    expect(formatHighScore(Infinity)).toBe('HIGH SCORE 0');
  });

  it('coerces -Infinity to 0', () => {
    expect(formatHighScore(-Infinity)).toBe('HIGH SCORE 0');
  });
});

describe('title-screen content constants', () => {
  it('TITLE_TEXT is the non-empty hero title', () => {
    expect(typeof TITLE_TEXT).toBe('string');
    expect(TITLE_TEXT.length).toBeGreaterThan(0);
    expect(TITLE_TEXT).toBe('ANGLE WARS');
  });

  it('START_PROMPT is a non-empty string', () => {
    expect(typeof START_PROMPT).toBe('string');
    expect(START_PROMPT.length).toBeGreaterThan(0);
  });

  it('SETTINGS_PROMPT is a non-empty string naming the S key', () => {
    expect(typeof SETTINGS_PROMPT).toBe('string');
    expect(SETTINGS_PROMPT.length).toBeGreaterThan(0);
    expect(SETTINGS_PROMPT).toContain('S');
  });

  it('CONTROLS_LINES is a non-empty array of non-empty strings', () => {
    expect(Array.isArray(CONTROLS_LINES)).toBe(true);
    expect(CONTROLS_LINES.length).toBeGreaterThan(0);
    for (const line of CONTROLS_LINES) {
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
