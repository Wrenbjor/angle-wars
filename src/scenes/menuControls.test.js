import { describe, expect, it } from 'vitest';
import {
  MENU_ACTIONS,
  acceptMenuActivation,
  controlsInsideArena,
  hitTestMenuControls,
  isMenuAction,
  settingsControlLayout,
  switchViewModel,
  titleControlLayout,
} from './menuControls.js';

describe('menuControls', () => {
  it('keeps finite touch-sized controls in the arena', () => {
    for (const controls of [titleControlLayout(), settingsControlLayout()]) {
      expect(controlsInsideArena(controls)).toBe(true);
    }
  });

  it('hit tests inclusive edges and rejects malformed controls and points', () => {
    const play = titleControlLayout()[0];
    expect(hitTestMenuControls([play], play.x - play.width / 2, play.y)?.action)
      .toBe(MENU_ACTIONS.PLAY);
    expect(hitTestMenuControls([play], Infinity, play.y)).toBeNull();
    expect(hitTestMenuControls([{ ...play, action: 'bad' }], play.x, play.y)).toBeNull();
    expect(hitTestMenuControls([{ ...play, width: Infinity }], play.x, play.y)).toBeNull();
    expect(hitTestMenuControls(null, play.x, play.y)).toBeNull();
  });

  it('validates actions and gives switches text plus geometry', () => {
    expect(isMenuAction(MENU_ACTIONS.BACK)).toBe(true);
    expect(isMenuAction('bad')).toBe(false);
    expect(switchViewModel('MUTE', true))
      .toEqual({ label: 'MUTE  ON', on: true, thumbSide: 'right' });
    expect(switchViewModel('MUTE', false).label).toContain('OFF');
  });

  it('accepts at most one mixed-input activation per frame', () => {
    expect(acceptMenuActivation(-1, 42)).toEqual({ accepted: true, nextFrame: 42 });
    expect(acceptMenuActivation(42, 42)).toEqual({ accepted: false, nextFrame: 42 });
    expect(acceptMenuActivation(42, 43)).toEqual({ accepted: true, nextFrame: 43 });
  });
});
