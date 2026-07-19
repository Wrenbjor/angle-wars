import Phaser from 'phaser';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  ARENA_BORDER_THICKNESS,
  FIXED_STEP_MS,
  MAX_SUB_STEPS,
  COLOR_ARENA_BORDER,
  COLOR_DEBUG_TEXT,
  DEBUG_FONT,
} from '../config/constants.js';
import { World } from '../core/World.js';
import { FixedTimestep } from '../core/FixedTimestep.js';
import { SimClockSystem } from '../systems/SimClockSystem.js';

// ArenaScene — the playable stage (shell version).
//
// Responsibilities for this story:
//  - draw the bounded arena border,
//  - own a World + FixedTimestep and drive world.fixedUpdate(dt) from Phaser's
//    variable-rate update(), so the simulation is decoupled from render,
//  - show a debug readout comparing render FPS to simulation ticks/sec, making
//    the decoupling observable.
export class ArenaScene extends Phaser.Scene {
  constructor() {
    super('ArenaScene');
  }

  create() {
    // --- Arena border -------------------------------------------------------
    const g = this.add.graphics();
    g.lineStyle(ARENA_BORDER_THICKNESS, COLOR_ARENA_BORDER, 1);
    g.strokeRect(
      ARENA_BORDER_INSET,
      ARENA_BORDER_INSET,
      ARENA_WIDTH - ARENA_BORDER_INSET * 2,
      ARENA_HEIGHT - ARENA_BORDER_INSET * 2,
    );

    // --- Simulation ---------------------------------------------------------
    // The fixed-timestep accumulator releases banked render time to the world
    // in constant FIXED_STEP_MS slices; the spiral guard caps catch-up steps.
    this.fixedTimestep = new FixedTimestep(FIXED_STEP_MS, MAX_SUB_STEPS);
    this.world = new World();
    // SimClockSystem gives the pipeline a real, observable job (tick counting).
    this.simClock = new SimClockSystem();
    this.world.addSystem(this.simClock);

    // --- Debug readout ------------------------------------------------------
    this.debugText = this.add.text(
      ARENA_BORDER_INSET + 8,
      ARENA_BORDER_INSET + 8,
      '',
      { font: DEBUG_FONT, color: COLOR_DEBUG_TEXT },
    );

    // Sampling state for a once-per-second sim ticks/sec measurement.
    this._lastSampleTicks = 0;
    this._sampleAccumMs = 0;
    this._ticksPerSec = 0;
  }

  /**
   * Phaser's render-rate update. It NEVER runs simulation logic directly —
   * it only feeds the render delta to the fixed-timestep accumulator, which
   * runs the world at the constant fixed rate.
   * @param {number} time  Absolute time (ms).
   * @param {number} delta Elapsed render time since last frame (ms).
   */
  update(time, delta) {
    this.fixedTimestep.advance(delta, (dt) => this.world.fixedUpdate(dt));

    // Sample sim ticks/sec roughly once per second so the readout is steady.
    this._sampleAccumMs += delta;
    if (this._sampleAccumMs >= 1000) {
      const ticked = this.simClock.ticks - this._lastSampleTicks;
      this._ticksPerSec = (ticked * 1000) / this._sampleAccumMs;
      this._lastSampleTicks = this.simClock.ticks;
      this._sampleAccumMs = 0;
    }

    const renderFps = Math.round(this.game.loop.actualFps);
    this.debugText.setText(
      [
        `render FPS : ${renderFps}`,
        `sim ticks/s: ${this._ticksPerSec.toFixed(1)}  (target ${(1000 / FIXED_STEP_MS).toFixed(1)})`,
        `sim ticks  : ${this.simClock.ticks}`,
        `sim time   : ${(this.simClock.simTimeMs / 1000).toFixed(1)}s`,
      ].join('\n'),
    );
  }
}
