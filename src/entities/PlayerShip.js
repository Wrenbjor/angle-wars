import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  SHIP_RADIUS,
} from '../config/constants.js';

// PlayerShip — the shared player entity (plain data, Phaser-free).
//
// A single long-lived entity added to the World; the PlayerMovementSystem
// mutates it each fixed tick and ArenaScene syncs a placeholder sprite from it.
// Later stories build on this same shape: firing origin (1.3), homing target
// (1.4), collision (1.5). Deliberately a plain object — no ECS/component
// machinery beyond what the World already provides.
//
// Shape: { x, y, vx, vy, angle, radius }
//  - x, y     : position (px, arena/logical space)
//  - vx, vy   : velocity (px/s)
//  - angle    : facing (radians; clockwise-positive, y-down — matches Phaser
//               rotation and atan2(vy, vx), so no conversion is needed)
//  - radius   : half-extent (px) for arena clamping and collision

/**
 * Create the player ship spawned at arena center, at rest, facing +x.
 * @returns {{x:number, y:number, vx:number, vy:number, angle:number, radius:number}}
 */
export function createPlayerShip() {
  return {
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: SHIP_RADIUS,
  };
}
