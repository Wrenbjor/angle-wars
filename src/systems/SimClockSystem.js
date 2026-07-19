import { System } from '../core/System.js';

// SimClockSystem — the foundational example system.
//
// It gives the fixed-timestep pipeline a real, observable job: counting the
// number of simulation ticks and the total simulated time. ArenaScene's debug
// readout compares this tick rate against the render FPS to make the
// render/simulation decoupling visible. Later stories add real systems
// (movement, firing, collision) alongside it.
//
// Phaser-free by design.
export class SimClockSystem extends System {
  constructor() {
    super();
    /** Total fixed steps executed since construction. */
    this.ticks = 0;
    /** Total simulated time, in milliseconds. */
    this.simTimeMs = 0;
  }

  /**
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    this.ticks++;
    this.simTimeMs += dt;
  }
}
