import { describe, expect, it } from 'vitest';
import {
  COLOR_LEVELUP_PANEL,
  LEVELUP_PANEL_ALPHA,
  COLOR_LEVELUP_PANEL_FOCUS,
  LEVELUP_PANEL_FOCUS_ALPHA,
  COLOR_LEVELUP_TEXT,
  LEVELUP_OVERLAY_ALPHA,
  LEVELUP_PANEL_BORDER_WIDTH,
  LEVELUP_PANEL_FOCUS_BORDER_WIDTH,
  COLOR_LEVELUP_ACTION,
  LEVELUP_ACTION_ALPHA,
  COLOR_LEVELUP_ACTION_DEPLETED,
  LEVELUP_ACTION_DEPLETED_ALPHA,
  COLOR_LEVELUP_ACTION_TEXT,
  COLOR_LEVELUP_ACTION_TEXT_DEPLETED,
} from './constants.js';
import {
  compositeColor,
  contrastRatio,
  relativeLuminance,
} from './visualContrast.js';

describe('visualContrast', () => {
  it('matches the WCAG black/white endpoints', () => {
    expect(relativeLuminance(0x000000)).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#fff', '#000')).toBe(21);
  });

  it('alpha-composites channels over black without byte rounding', () => {
    expect(compositeColor(0x804020, 0.5)).toEqual({
      r: 64,
      g: 32,
      b: 16,
    });
  });

  it('rejects malformed colors and out-of-range alpha', () => {
    expect(() => compositeColor('#ffff', 1)).toThrow(TypeError);
    expect(() => compositeColor(0xffffff, 1.01)).toThrow(RangeError);
    expect(() => relativeLuminance(0x1000000)).toThrow(RangeError);
  });
});

describe('ordinary level-up card accessibility palette', () => {
  const states = [
    ['resting', COLOR_LEVELUP_PANEL, LEVELUP_PANEL_ALPHA],
    ['focused', COLOR_LEVELUP_PANEL_FOCUS, LEVELUP_PANEL_FOCUS_ALPHA],
  ];

  it.each(states)('%s text is WCAG AA over both dark and brightest gameplay', (_name, fill, alpha) => {
    const backdrops = [
      0x000000,
      compositeColor(0x000000, LEVELUP_OVERLAY_ALPHA, 0xffffff),
    ];
    for (const backdrop of backdrops) {
      const renderedSurface = compositeColor(fill, alpha, backdrop);
      expect(contrastRatio(COLOR_LEVELUP_TEXT, renderedSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses dark surfaces instead of the vivid border hue as a focused fill', () => {
    expect(COLOR_LEVELUP_PANEL_FOCUS).not.toBe(0x33ff99);
    expect(relativeLuminance(COLOR_LEVELUP_PANEL)).toBeLessThan(0.1);
    expect(relativeLuminance(COLOR_LEVELUP_PANEL_FOCUS)).toBeLessThan(0.1);
  });

  it('identifies focus without color by increasing border thickness', () => {
    expect(LEVELUP_PANEL_FOCUS_BORDER_WIDTH).toBeGreaterThan(
      LEVELUP_PANEL_BORDER_WIDTH,
    );
  });

  it.each([
    ['enabled', COLOR_LEVELUP_ACTION, LEVELUP_ACTION_ALPHA, COLOR_LEVELUP_ACTION_TEXT],
    ['depleted', COLOR_LEVELUP_ACTION_DEPLETED, LEVELUP_ACTION_DEPLETED_ALPHA, COLOR_LEVELUP_ACTION_TEXT_DEPLETED],
  ])('%s action text remains WCAG AA across modal surfaces', (_name, fill, alpha, text) => {
    const surfaces = [
      0x000000,
      compositeColor(0x000000, LEVELUP_OVERLAY_ALPHA, 0xffffff),
      compositeColor(COLOR_LEVELUP_PANEL, LEVELUP_PANEL_ALPHA, 0x000000),
      compositeColor(COLOR_LEVELUP_PANEL_FOCUS, LEVELUP_PANEL_FOCUS_ALPHA, 0x000000),
    ];
    for (const surface of surfaces) {
      expect(contrastRatio(text, compositeColor(fill, alpha, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
