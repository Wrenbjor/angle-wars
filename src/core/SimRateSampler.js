// SimRateSampler — a once-per-window sim-tick rate meter.
//
// The render loop advances at a variable rate while the simulation ticks at a
// constant fixed rate. To make that decoupling observable, the DEV readout wants
// a steady "sim ticks/sec" number rather than a jittery per-frame estimate. This
// stateful accumulator banks render delta and, once the window elapses, computes
// the rate from the ticks that actually accrued over the real accumulated time.
//
// Phaser-free by design (a sibling of FixedTimestep) so it can be unit-tested
// headlessly. Faithful extraction of the original inline sampling math: no
// NaN/negative delta guard on update() — Phaser guarantees a finite delta, and
// this is a DEV-only diagnostic, so it mirrors the original code exactly. Only
// the constructor fails fast, matching FixedTimestep.
export class SimRateSampler {
  /**
   * @param {number} windowMs Sampling window, in milliseconds.
   */
  constructor(windowMs) {
    // Fail fast on a mis-set constant — a zero/NaN/negative window would either
    // never fire a sample or divide nonsensically. Mirrors FixedTimestep.
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('SimRateSampler: windowMs must be a finite number > 0');
    }
    this.windowMs = windowMs;
    this.accumMs = 0;
    this.lastTicks = 0;
    this.ticksPerSec = 0;
  }

  /**
   * Bank `deltaMs` of render time. Once the accumulator reaches the window,
   * compute ticks/sec from the ticks that elapsed over the REAL accumulated
   * time (not the nominal window — the accumulator is >= windowMs when it
   * fires), latch the current tick count, and zero the accumulator.
   *
   * @param {number} deltaMs Elapsed render time since the last call.
   * @param {number} ticks   Current absolute simulation tick count.
   * @returns {number} The current ticksPerSec (updated only when a sample fires).
   */
  update(deltaMs, ticks) {
    this.accumMs += deltaMs;
    if (this.accumMs >= this.windowMs) {
      this.ticksPerSec = ((ticks - this.lastTicks) * 1000) / this.accumMs;
      this.lastTicks = ticks;
      this.accumMs = 0;
    }
    return this.ticksPerSec;
  }

  /** Discard all sampling state (e.g. on scene reset). */
  reset() {
    this.accumMs = 0;
    this.lastTicks = 0;
    this.ticksPerSec = 0;
  }
}
