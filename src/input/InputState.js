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
    /**
     * Latched Afterburner DASH request (Story 10.5): the render↔sim edge seam for
     * the discrete dash press, byte-for-byte mirroring `bombQueued`. The Phaser
     * input boundary sets it on the dash key's / gamepad button's just-down edge
     * (or the touch button's tap — queueDash); DashSystem reads-and-clears it once
     * per fixed step (consumeDash). A latch (not a level) so one press yields at
     * most one dash regardless of how many render frames the button is held or how
     * many edges land within a single fixed-step window.
     *
     * ⚠ `clear()` deliberately does NOT clear this (nor `bombQueued`) — it resets
     * only the continuous move/aim levels. ArenaScene's level-up-modal drain must
     * therefore call `consumeDash()` explicitly beside `consumeBomb()`, or a dash
     * queued under the card overlay would fire when the overlay closes.
     */
    this.dashQueued = false;
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
   * Latch an Afterburner dash request. Called at the Phaser input boundary on the
   * dash key's / gamepad button's just-down edge, or from the touch button's one-tap
   * latch. Idempotent within a fixed-step window — repeated calls before the next
   * consumeDash still yield a single latched request.
   */
  queueDash() {
    this.dashQueued = true;
  }

  /**
   * Consume the latched dash request: return whether one was queued and clear the
   * latch (reads-and-clears) so the same press never dashes twice. Called once per
   * fixed step by the DashSystem — UNCONDITIONALLY, so a press arriving during the
   * cooldown or mid-dash is discarded rather than buffered into the next opening.
   * @returns {boolean} true if a dash press was pending this step.
   */
  consumeDash() {
    const queued = this.dashQueued;
    this.dashQueued = false;
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
