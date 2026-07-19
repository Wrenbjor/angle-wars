import { clampToUnitCircle } from './inputMath.js';

// InputState — the render↔sim seam for move intent (Phaser-free).
//
// The input sampler writes the current normalized move intent here at render
// rate; the PlayerMovementSystem reads it at the fixed simulation rate. Intent
// is a *level* (current direction), not an edge event, so sampling at render
// rate and consuming at sim rate is correct for continuous movement.
export class InputState {
  constructor() {
    /** Normalized move intent X in [-1, 1], magnitude <= 1. */
    this.moveX = 0;
    /** Normalized move intent Y in [-1, 1], magnitude <= 1. */
    this.moveY = 0;
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

  /** Reset intent to rest. */
  clear() {
    this.moveX = 0;
    this.moveY = 0;
  }
}
