// FixedTimestep — decouples simulation from render.
//
// Render frames arrive at a variable rate (30fps, 60fps, 144fps, or lurching
// after a stall). Gameplay, however, must advance in constant slices so that
// feel is identical on every display. This accumulator banks the elapsed
// render delta and releases it to the simulation in whole `stepMs` chunks.
//
// Phaser-free by design so it can be unit-tested headlessly.
export class FixedTimestep {
  /**
   * @param {number} stepMs      Constant simulation slice, in milliseconds.
   * @param {number} maxSubSteps Cap on sub-steps per advance() (spiral guard).
   */
  constructor(stepMs, maxSubSteps) {
    // Fail fast on a mis-set constant — a zero/NaN step would silently freeze
    // the simulation (the while-loop never advances) with no error surfaced.
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      throw new RangeError('FixedTimestep: stepMs must be a finite number > 0');
    }
    if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) {
      throw new RangeError('FixedTimestep: maxSubSteps must be an integer >= 1');
    }
    this.stepMs = stepMs;
    this.maxSubSteps = maxSubSteps;
    this.accumulator = 0;
  }

  /**
   * Bank `deltaMs` of render time and run `fn(stepMs)` for each whole step it
   * unlocks, up to `maxSubSteps`. If the cap is hit, the leftover backlog is
   * dropped (not carried), preventing a spiral of death after a long stall.
   *
   * @param {number} deltaMs   Elapsed render time since the last call.
   * @param {(dt:number)=>void} fn Per-tick callback; receives the constant step.
   * @returns {number} The number of fixed steps executed this call.
   */
  advance(deltaMs, fn) {
    // Reject a NaN/negative delta up front: a single NaN would permanently
    // freeze the accumulator; a negative delta would stall it. Zero is a valid
    // no-op and passes through.
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      return 0;
    }
    this.accumulator += deltaMs;
    let steps = 0;
    while (this.accumulator >= this.stepMs && steps < this.maxSubSteps) {
      fn(this.stepMs);
      this.accumulator -= this.stepMs;
      steps++;
    }
    // Hit the sub-step cap with genuine backlog still queued (>= one step):
    // drop it so we don't spiral. A legitimate sub-step remainder (< stepMs)
    // is preserved for the next frame.
    if (steps === this.maxSubSteps && this.accumulator >= this.stepMs) {
      this.accumulator = 0;
    }
    return steps;
  }

  /**
   * Interpolation factor in [0, 1) — how far the accumulator sits between the
   * last completed step and the next. Useful later for render interpolation.
   * @returns {number}
   */
  get alpha() {
    // stepMs > 0 is guaranteed by the constructor; clamp the numerator so a
    // (defensively) negative accumulator never yields a negative alpha.
    return Math.max(0, this.accumulator) / this.stepMs;
  }

  /** Discard any banked time (e.g. on scene reset). */
  reset() {
    this.accumulator = 0;
  }
}
