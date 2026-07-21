// touchOverlay — the thin Phaser draw helper for the touch controls (Story 7.1).
//
// Isolates the graphics calls that render the touch overlay from the Phaser-free
// touchControls model, mirroring the telegraphCue / neonStyle discipline: the model
// produces a snapshot (bases + current touch points + bomb rect), this helper turns
// it into stroke/fill calls on a Phaser Graphics object. It touches NO Phaser type
// directly — it only calls the graphics methods a caller passes in — so it stays
// headless-testable in vitest (a mock graphics that records its calls).
//
// Draws (per redraw): a base ring at MAX_RADIUS + a thumb knob at the current point
// for EACH active stick, plus the smart-bomb button (brighter while pressed). Fixed
// logical-coordinate placeholder styling only — the real aesthetic and device-aware
// placement are Epic 4 / Story 7.2.

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

/**
 * The overlay draw style, built from the centralized TOUCH_OVERLAY_* / COLOR_TOUCH_*
 * constants so the draw helper carries no inline magic numbers. Frozen: immutable
 * config read live on every render frame.
 * @type {{maxRadius:number, knobRadius:number, lineWidth:number, alpha:number,
 *   bombPressedAlpha:number, baseColor:number, knobColor:number, bombColor:number}}
 */
export const TOUCH_OVERLAY_STYLE = Object.freeze({
  maxRadius: TOUCH_STICK_MAX_RADIUS,
  knobRadius: TOUCH_OVERLAY_KNOB_RADIUS,
  lineWidth: TOUCH_OVERLAY_LINE_WIDTH,
  alpha: TOUCH_OVERLAY_ALPHA,
  bombPressedAlpha: TOUCH_OVERLAY_BOMB_PRESSED_ALPHA,
  baseColor: COLOR_TOUCH_STICK_BASE,
  knobColor: COLOR_TOUCH_STICK_KNOB,
  bombColor: COLOR_TOUCH_BOMB,
});

/** Draw one floating stick: a base ring at MAX_RADIUS + a thumb knob at the touch. */
function drawStick(graphics, stick, style) {
  graphics.lineStyle(style.lineWidth, style.baseColor, style.alpha);
  graphics.strokeCircle(stick.baseX, stick.baseY, style.maxRadius);
  graphics.fillStyle(style.knobColor, style.alpha);
  graphics.fillCircle(stick.curX, stick.curY, style.knobRadius);
}

/**
 * Clear and redraw the touch overlay from a touchControls snapshot: the base ring +
 * thumb knob for each ACTIVE stick and the smart-bomb button. Self-clearing so a
 * released stick leaves no stale graphic.
 * @param {Phaser.GameObjects.Graphics} graphics The overlay graphics object.
 * @param {ReturnType<import('../input/touchControls.js').TouchControls['snapshot']>}
 *   snapshot The model's render snapshot.
 * @param {typeof TOUCH_OVERLAY_STYLE} style The draw style.
 */
export function drawTouchOverlay(graphics, snapshot, style) {
  graphics.clear();
  if (snapshot.move.active) drawStick(graphics, snapshot.move, style);
  if (snapshot.aim.active) drawStick(graphics, snapshot.aim, style);

  const bomb = snapshot.bomb;
  const bombAlpha = bomb.pressed ? style.bombPressedAlpha : style.alpha;
  graphics.fillStyle(style.bombColor, bombAlpha);
  graphics.fillCircle(bomb.x, bomb.y, bomb.radius);
  graphics.lineStyle(style.lineWidth, style.bombColor, style.alpha);
  graphics.strokeCircle(bomb.x, bomb.y, bomb.radius);
}
