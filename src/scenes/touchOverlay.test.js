import { describe, it, expect, vi } from 'vitest';
import { drawTouchOverlay, TOUCH_OVERLAY_STYLE } from './touchOverlay.js';
import {
  TOUCH_STICK_MAX_RADIUS,
  TOUCH_OVERLAY_KNOB_RADIUS,
  TOUCH_OVERLAY_LINE_WIDTH,
  TOUCH_OVERLAY_ALPHA,
  TOUCH_OVERLAY_BOMB_PRESSED_ALPHA,
  COLOR_TOUCH_STICK_BASE,
  COLOR_TOUCH_STICK_KNOB,
  COLOR_TOUCH_BOMB,
} from '../config/constants.js';

// drawTouchOverlay is the thin Phaser draw helper: it turns a touchControls snapshot
// into stroke/fill calls on a Graphics object. It touches no Phaser type directly, so
// a mock graphics that records its calls proves the wiring (a dropped stick, an
// inverted pressed-alpha, or a missing clear would be caught here rather than shipping
// silently — mirroring neonStyle / telegraphCue coverage of the render seam).

// A recording stand-in for a Phaser Graphics object.
function fakeGraphics() {
  return {
    clear: vi.fn(),
    lineStyle: vi.fn(),
    strokeCircle: vi.fn(),
    fillStyle: vi.fn(),
    fillCircle: vi.fn(),
  };
}

function snapshot({ move, aim, bombPressed = false } = {}) {
  return {
    move: move ?? { active: false, baseX: 0, baseY: 0, curX: 0, curY: 0 },
    aim: aim ?? { active: false, baseX: 0, baseY: 0, curX: 0, curY: 0 },
    bomb: { x: 640, y: 636, radius: 60, pressed: bombPressed },
  };
}

describe('TOUCH_OVERLAY_STYLE', () => {
  it('maps the centralized touch constants onto the style fields', () => {
    expect(TOUCH_OVERLAY_STYLE).toEqual({
      maxRadius: TOUCH_STICK_MAX_RADIUS,
      knobRadius: TOUCH_OVERLAY_KNOB_RADIUS,
      lineWidth: TOUCH_OVERLAY_LINE_WIDTH,
      alpha: TOUCH_OVERLAY_ALPHA,
      bombPressedAlpha: TOUCH_OVERLAY_BOMB_PRESSED_ALPHA,
      baseColor: COLOR_TOUCH_STICK_BASE,
      knobColor: COLOR_TOUCH_STICK_KNOB,
      bombColor: COLOR_TOUCH_BOMB,
    });
  });

  it('is frozen (immutable config read live each render frame)', () => {
    expect(Object.isFrozen(TOUCH_OVERLAY_STYLE)).toBe(true);
  });
});

describe('drawTouchOverlay', () => {
  it('always clears first, then draws the bomb button', () => {
    const g = fakeGraphics();
    drawTouchOverlay(g, snapshot(), TOUCH_OVERLAY_STYLE);
    expect(g.clear).toHaveBeenCalledTimes(1);
    // Bomb button fill at the rest alpha (not pressed).
    expect(g.fillStyle).toHaveBeenCalledWith(COLOR_TOUCH_BOMB, TOUCH_OVERLAY_ALPHA);
    expect(g.fillCircle).toHaveBeenCalledWith(640, 636, 60);
  });

  it('draws NO stick rings when both sticks are inactive', () => {
    const g = fakeGraphics();
    drawTouchOverlay(g, snapshot(), TOUCH_OVERLAY_STYLE);
    // Only the bomb button strokes a circle (its outline); no stick base rings.
    expect(g.strokeCircle).toHaveBeenCalledTimes(1);
    expect(g.strokeCircle).toHaveBeenCalledWith(640, 636, 60);
  });

  it('draws a base ring at MAX_RADIUS + a knob at the current point for an active move stick', () => {
    const g = fakeGraphics();
    drawTouchOverlay(
      g,
      snapshot({ move: { active: true, baseX: 200, baseY: 400, curX: 260, curY: 400 } }),
      TOUCH_OVERLAY_STYLE,
    );
    expect(g.strokeCircle).toHaveBeenCalledWith(200, 400, TOUCH_STICK_MAX_RADIUS);
    expect(g.fillCircle).toHaveBeenCalledWith(260, 400, TOUCH_OVERLAY_KNOB_RADIUS);
    // The base ring is stroked at the configured line width (observed at the seam).
    expect(g.lineStyle).toHaveBeenCalledWith(
      TOUCH_OVERLAY_LINE_WIDTH,
      COLOR_TOUCH_STICK_BASE,
      TOUCH_OVERLAY_ALPHA,
    );
  });

  it('draws both sticks when both are active', () => {
    const g = fakeGraphics();
    drawTouchOverlay(
      g,
      snapshot({
        move: { active: true, baseX: 200, baseY: 400, curX: 260, curY: 400 },
        aim: { active: true, baseX: 900, baseY: 300, curX: 900, curY: 240 },
      }),
      TOUCH_OVERLAY_STYLE,
    );
    // Two base rings + the bomb outline = 3 stroked circles.
    expect(g.strokeCircle).toHaveBeenCalledWith(200, 400, TOUCH_STICK_MAX_RADIUS);
    expect(g.strokeCircle).toHaveBeenCalledWith(900, 300, TOUCH_STICK_MAX_RADIUS);
    expect(g.strokeCircle).toHaveBeenCalledTimes(3);
  });

  it('brightens the bomb button while pressed', () => {
    const g = fakeGraphics();
    drawTouchOverlay(g, snapshot({ bombPressed: true }), TOUCH_OVERLAY_STYLE);
    expect(g.fillStyle).toHaveBeenCalledWith(COLOR_TOUCH_BOMB, TOUCH_OVERLAY_BOMB_PRESSED_ALPHA);
  });
});
