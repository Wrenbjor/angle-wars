import { describe, it, expect } from 'vitest';
import { World } from './World.js';
import { System } from './System.js';
import { FixedTimestep } from './FixedTimestep.js';
import { SimClockSystem } from '../systems/SimClockSystem.js';

const STEP = 10;
const MAX = 5;

// A system that records every fixedUpdate call for order/argument assertions.
class RecordingSystem extends System {
  constructor(name, log) {
    super();
    this.name = name;
    this.log = log;
  }

  fixedUpdate(dt, world) {
    this.log.push({ name: this.name, dt, world });
  }
}

describe('World', () => {
  it('runs systems in insertion order, passing (dt, world) each tick', () => {
    const world = new World();
    const log = [];
    world.addSystem(new RecordingSystem('a', log));
    world.addSystem(new RecordingSystem('b', log));

    world.fixedUpdate(STEP);

    expect(log.map((e) => e.name)).toEqual(['a', 'b']);
    expect(log.every((e) => e.dt === STEP)).toBe(true);
    expect(log.every((e) => e.world === world)).toBe(true);
  });

  it('calls each registered system exactly once per fixedUpdate', () => {
    const world = new World();
    const log = [];
    world.addSystem(new RecordingSystem('a', log));
    world.addSystem(new RecordingSystem('b', log));

    world.fixedUpdate(STEP);
    world.fixedUpdate(STEP);

    expect(log.filter((e) => e.name === 'a')).toHaveLength(2);
    expect(log.filter((e) => e.name === 'b')).toHaveLength(2);
  });

  it('addSystem throws when the argument lacks a fixedUpdate method', () => {
    const world = new World();
    expect(() => world.addSystem({})).toThrow(TypeError);
    expect(() => world.addSystem(null)).toThrow(TypeError);
  });

  it('addEntity appends and returns; removeEntity reports presence', () => {
    const world = new World();
    const e = { hp: 1 };
    expect(world.addEntity(e)).toBe(e);
    expect(world.entities).toContain(e);

    expect(world.removeEntity(e)).toBe(true);
    expect(world.entities).not.toContain(e);
    expect(world.removeEntity(e)).toBe(false); // already gone
    expect(world.removeEntity({})).toBe(false); // never present
  });

  it('drives SimClockSystem end-to-end through the fixed-timestep pipeline', () => {
    // Compose the real accumulator + world + system and feed variable deltas,
    // including one frame that hits the spiral cap, proving the whole
    // accumulator -> world.fixedUpdate -> system pipeline.
    const ft = new FixedTimestep(STEP, MAX);
    const world = new World();
    const clock = new SimClockSystem();
    world.addSystem(clock);

    const run = (deltaMs) => ft.advance(deltaMs, (dt) => world.fixedUpdate(dt));

    let expectedSteps = 0;
    expectedSteps += run(0.4 * STEP); // 0 steps, banks 0.4
    expectedSteps += run(1.0 * STEP); // 1 step (0.4 + 1.0 = 1.4 -> 1), 0.4 left
    expectedSteps += run(100 * STEP); // spiral cap: exactly MAX steps
    expectedSteps += run(2.0 * STEP); // 2 steps

    expect(expectedSteps).toBe(1 + MAX + 2);
    expect(clock.ticks).toBe(expectedSteps);
    expect(clock.simTimeMs).toBe(clock.ticks * STEP);
  });
});
