// System — base class for simulation systems.
//
// A system encapsulates one slice of game logic (movement, firing, collision,
// scoring, …). The World owns a list of systems and calls `fixedUpdate` on
// each one at the fixed simulation cadence. Subclasses override `fixedUpdate`.
//
// Phaser-free by design. This is intentionally minimal — no component registry
// or ECS machinery — just the hook later systems plug into.
export class System {
  /**
   * Advance this system by one fixed step.
   * @param {number} dt   Constant fixed-step delta, in milliseconds.
   * @param {import('./World.js').World} world The world being simulated.
   */
  fixedUpdate(dt, world) {
    // Base no-op; subclasses implement per-step behavior.
  }
}
