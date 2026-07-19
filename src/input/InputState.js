import { clampToUnitCircle, normalizeToUnit } from './inputMath.js';

// InputState — the render↔sim seam for move + aim intent (Phaser-free).
//
// The input sampler writes the current normalized move intent and aim direction
// here at render rate; the PlayerMovementSystem and FiringSystem read them at
// the fixed simulation rate. Both are *levels* (current direction), not edge
// events, so sampling at render rate and consuming at sim rate is correct for
// continuous movement and continuous auto-fire.
//
// Aim is a separate channel from move so the player can fly one direction while
// firing another (the twin-stick core).
export class InputState {
  constructor() {
    /** Normalized move intent X in [-1, 1], magnitude <= 1. */
    this.moveX = 0;
    /** Normalized move intent Y in [-1, 1], magnitude <= 1. */
    this.moveY = 0;
    /** Unit aim direction X (0 when inactive). */
    this.aimX = 0;
    /** Unit aim direction Y (0 when inactive). */
    this.aimY = 0;
    /** True when a valid aim direction is present (non-zero input). */
    this.aimActive = false;
  }

  /**
   * Store a move intent, clamped to the unit circle so a diagonal is never
   * faster than a cardinal (magnitude never exceeds 1).
   * @param {number} x
   * @param {number} y
   */
  setMove(x, y) {
    const { x: cx, y: cy } = clampToUnitCircle(x, y);
    this.moveX = cx;
    this.moveY = cy;
  }

  /**
   * Store an aim direction. Only the direction matters, so the input is
   * normalized to a unit vector; a zero-magnitude input is treated as no aim
   * (inactive) so firing stops rather than shooting in a stale direction.
   * @param {number} x
   * @param {number} y
   */
  setAim(x, y) {
    const { x: ux, y: uy, mag } = normalizeToUnit(x, y);
    if (mag === 0) {
      this.clearAim();
      return;
    }
    this.aimX = ux;
    this.aimY = uy;
    this.aimActive = true;
  }

  /** Reset aim to inactive (no firing). */
  clearAim() {
    this.aimX = 0;
    this.aimY = 0;
    this.aimActive = false;
  }

  /** Reset move intent and aim to rest. */
  clear() {
    this.moveX = 0;
    this.moveY = 0;
    this.clearAim();
  }
}
