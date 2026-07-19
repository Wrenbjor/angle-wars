// World — the simulation container.
//
// Holds the live entities and the ordered list of systems that operate on
// them. Each fixed step, `fixedUpdate(dt)` runs every registered system in
// insertion order. Entities are deliberately untyped here (plain objects the
// systems agree on); this story only needs the structure, not a schema.
//
// Phaser-free by design so the simulation can be driven and tested headlessly.
export class World {
  constructor() {
    /** @type {object[]} live entities the systems operate on. */
    this.entities = [];
    /** @type {import('./System.js').System[]} systems, run in order. */
    this.systems = [];
  }

  /**
   * Register a system. Systems run in the order they are added.
   * @param {import('./System.js').System} system
   * @returns {import('./System.js').System} the added system, for chaining.
   */
  addSystem(system) {
    // Validate the contract at the call site, not deep inside the per-tick
    // loop where a bad system would fail obscurely every frame.
    if (typeof system?.fixedUpdate !== 'function') {
      throw new TypeError('system must implement fixedUpdate(dt, world)');
    }
    this.systems.push(system);
    return system;
  }

  /**
   * Add an entity to the world.
   * @param {object} entity
   * @returns {object} the added entity.
   */
  addEntity(entity) {
    this.entities.push(entity);
    return entity;
  }

  /**
   * Remove an entity from the world if present.
   * @param {object} entity
   * @returns {boolean} true if the entity was found and removed.
   */
  removeEntity(entity) {
    const i = this.entities.indexOf(entity);
    if (i === -1) {
      return false;
    }
    this.entities.splice(i, 1);
    return true;
  }

  /**
   * Advance the simulation by one fixed step, running every system.
   *
   * WARNING: a system's `fixedUpdate` must NOT add or remove systems on this
   * world during the tick. The loop re-reads `this.systems.length` each
   * iteration, so a mid-tick `addSystem` would run the new system this same
   * tick and a removal would shift indices and skip a system. Defer any
   * registration changes until after the step completes.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    // Indexed loop: no allocation, stable order.
    for (let i = 0; i < this.systems.length; i++) {
      this.systems[i].fixedUpdate(dt, this);
    }
  }
}
