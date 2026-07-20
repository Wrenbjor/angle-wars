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
    /**
     * Latched smart-bomb request (Story 3.2): the render↔sim edge seam for the
     * discrete bomb press. The Phaser input boundary sets it on the key's
     * just-down edge (queueBomb); the BombSystem reads-and-clears it once per
     * fixed step (consumeBomb). A latch (not a level) so one key press yields at
     * most one detonation regardless of how many render frames the key is held or
     * how many key edges land within a single fixed-step window.
     */
    this.bombQueued = false;
  }

  /**
   * Latch a smart-bomb request. Called at the Phaser input boundary on the bomb
   * key's just-down edge. Idempotent within a fixed-step window — repeated calls
   * before the next consumeBomb still yield a single latched request.
   */
  queueBomb() {
    this.bombQueued = true;
  }

  /**
   * Consume the latched smart-bomb request: return whether one was queued and
   * clear the latch (reads-and-clears) so the same press never detonates twice.
   * Called once per fixed step by the BombSystem.
   * @returns {boolean} true if a bomb press was pending this step.
   */
  consumeBomb() {
    const queued = this.bombQueued;
    this.bombQueued = false;
    return queued;
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
