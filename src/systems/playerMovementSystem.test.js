import { describe, it, expect } from 'vitest';
import { PlayerMovementSystem } from './PlayerMovementSystem.js';
import { InputState } from '../input/InputState.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  SHIP_ACCEL,
  SHIP_MAX_SPEED,
  SHIP_RADIUS,
  SHIP_MIN_TURN_SPEED,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const DT_SEC = DT / 1000;

// Build a ship + input + system triad. `move` seeds the InputState via setMove
// (so it is unit-circle-clamped exactly as the real sampler would leave it).
function makeSystem({ ship: shipOverrides = {}, move = [0, 0] } = {}) {
  const ship = { ...createPlayerShip(), ...shipOverrides };
  const input = new InputState();
  input.setMove(move[0], move[1]);
  const system = new PlayerMovementSystem(ship, input);
  return { ship, input, system };
}

describe('PlayerMovementSystem', () => {
  it('thrust from rest: one tick gives vx>0, x increases, vx ≈ SHIP_ACCEL*dtSec', () => {
    const { ship, system } = makeSystem({ move: [1, 0] });
    const x0 = ship.x;
    system.fixedUpdate(DT);

    expect(ship.vx).toBeGreaterThan(0);
    expect(ship.x).toBeGreaterThan(x0);
    // Pre-drag impulse is SHIP_ACCEL*dtSec; drag shaves a hair off, so the
    // realized vx is just below that value but very close.
    const impulse = SHIP_ACCEL * DT_SEC;
    expect(ship.vx).toBeLessThanOrEqual(impulse + 1e-9);
    expect(ship.vx).toBeGreaterThan(impulse * 0.9);
  });

  it('diagonal is not faster: (1,1) intent yields the same accel magnitude as a cardinal', () => {
    const diag = makeSystem({ move: [1, 1] });
    const card = makeSystem({ move: [1, 0] });
    diag.system.fixedUpdate(DT);
    card.system.fixedUpdate(DT);

    const diagMag = Math.hypot(diag.ship.vx, diag.ship.vy);
    const cardMag = Math.hypot(card.ship.vx, card.ship.vy);
    // Equal magnitudes prove the diagonal was normalized (not √2× faster).
    expect(diagMag).toBeCloseTo(cardMag, 6);
    expect(diagMag).toBeLessThan(SHIP_ACCEL * DT_SEC * Math.SQRT2);
  });

  it('drag to stop: speed strictly decreases each tick toward ~0 and never reverses sign', () => {
    const { ship, system } = makeSystem({ ship: { vx: 300, vy: 0 }, move: [0, 0] });
    let prev = Math.hypot(ship.vx, ship.vy);
    for (let i = 0; i < 200; i++) {
      system.fixedUpdate(DT);
      const sp = Math.hypot(ship.vx, ship.vy);
      expect(sp).toBeLessThan(prev); // strictly decreasing
      expect(ship.vx).toBeGreaterThanOrEqual(0); // never reverses sign
      prev = sp;
    }
    expect(prev).toBeLessThan(1); // approached ~0
  });

  it('max-speed cap: speed never exceeds SHIP_MAX_SPEED and converges to it under sustained thrust', () => {
    // Reset position to center each tick so the ship never hits a wall; this
    // isolates the velocity cap from boundary clamping.
    const { ship, system } = makeSystem({ move: [1, 0] });
    for (let i = 0; i < 60; i++) {
      ship.x = ARENA_WIDTH / 2;
      ship.y = ARENA_HEIGHT / 2;
      system.fixedUpdate(DT);
      expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(SHIP_MAX_SPEED + 1e-6);
    }
    expect(Math.hypot(ship.vx, ship.vy)).toBeCloseTo(SHIP_MAX_SPEED, 3);
  });

  it('boundary clamp: driven past maxX, x is clamped and outward vx is zeroed', () => {
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { x: maxX - 1, vx: 1000, vy: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.x).toBeCloseTo(maxX, 9);
    expect(ship.vx).toBe(0);
  });

  it('boundary clamp: driven past minX, x is clamped and outward vx is zeroed', () => {
    const minX = ARENA_BORDER_INSET + SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { x: minX + 1, vx: -1000, vy: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.x).toBeCloseTo(minX, 9);
    expect(ship.vx).toBe(0);
  });

  it('boundary clamp: driven past maxY, y is clamped and outward vy is zeroed', () => {
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { y: maxY - 1, vy: 1000, vx: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.y).toBeCloseTo(maxY, 9);
    expect(ship.vy).toBe(0);
  });

  it('boundary clamp: driven past minY, y is clamped and outward vy is zeroed', () => {
    const minY = ARENA_BORDER_INSET + SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { y: minY + 1, vy: -1000, vx: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.y).toBeCloseTo(minY, 9);
    expect(ship.vy).toBe(0);
  });

  it('facing while moving: angle equals atan2(vy, vx) when speed is above the turn threshold', () => {
    const { ship, system } = makeSystem({ ship: { vx: 100, vy: 100 }, move: [0, 0] });
    system.fixedUpdate(DT);

    expect(Math.hypot(ship.vx, ship.vy)).toBeGreaterThan(SHIP_MIN_TURN_SPEED);
    expect(ship.angle).toBeCloseTo(Math.atan2(ship.vy, ship.vx), 12);
    expect(ship.angle).toBeCloseTo(Math.PI / 4, 6); // moving up-right
  });

  it('facing while stopped: angle is held (unchanged) when speed is below the turn threshold', () => {
    const priorAngle = 1.234;
    const { ship, system } = makeSystem({
      ship: { vx: 0, vy: 0, angle: priorAngle },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(SHIP_MIN_TURN_SPEED);
    expect(ship.angle).toBe(priorAngle);
  });

  it('radial deadzone: zero move intent produces no drift from rest', () => {
    const { ship, system } = makeSystem({ move: [0, 0] });
    const { x, y } = ship;
    system.fixedUpdate(DT);

    expect(ship.x).toBe(x);
    expect(ship.y).toBe(y);
    expect(ship.vx).toBe(0);
    expect(ship.vy).toBe(0);
  });
});
