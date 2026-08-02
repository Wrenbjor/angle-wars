import { describe, expect, it } from 'vitest';
import { GAME_OVER_ACTION, hitTestGameOverControls } from './gameOverControls.js';

const controls = [
  { action: GAME_OVER_ACTION.RESTART, x: 100, y: 200, width: 80, height: 40 },
  { action: GAME_OVER_ACTION.TITLE, x: 220, y: 200, width: 80, height: 40 },
];

describe('gameOverControls', () => {
  it('maps each button, including its visible boundary, to its named action', () => {
    expect(hitTestGameOverControls(100, 200, controls)).toBe(GAME_OVER_ACTION.RESTART);
    expect(hitTestGameOverControls(180, 180, controls)).toBe(GAME_OVER_ACTION.TITLE);
    expect(hitTestGameOverControls(260, 220, controls)).toBe(GAME_OVER_ACTION.TITLE);
  });

  it('returns null for off-button and invalid points', () => {
    expect(hitTestGameOverControls(160, 200, controls)).toBeNull();
    expect(hitTestGameOverControls(Number.NaN, 200, controls)).toBeNull();
    expect(hitTestGameOverControls(100, 200, null)).toBeNull();
  });

  it('does not leak an unknown action through the routing seam', () => {
    expect(hitTestGameOverControls(0, 0, [{ action: 'erase', x: 0, y: 0, width: 10, height: 10 }])).toBeNull();
  });

  it('ignores controls with invalid or non-positive geometry', () => {
    expect(hitTestGameOverControls(0, 0, [
      { action: GAME_OVER_ACTION.RESTART, x: 0, y: 0, width: Infinity, height: 10 },
      { action: GAME_OVER_ACTION.TITLE, x: 0, y: 0, width: 0, height: 10 },
    ])).toBeNull();
  });
});
