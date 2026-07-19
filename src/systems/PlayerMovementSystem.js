import { System } from '../core/System.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SHIP_ACCEL,
  SHIP_MAX_SPEED,
  SHIP_DRAG_RETAIN_PER_SEC,
  SHIP_MIN_TURN_SPEED,
} from '../config/constants.js';

// PlayerMovementSystem — velocity-based ship movement (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, so feel is
// identical regardless of render frame rate. Semi-implicit Euler integration
// with input thrust, exponential (frame-rate-independent) drag, a max-speed
// cap, arena-interior clamping, and facing toward the direction of travel.
//
// All feel magnitudes come from centralized constants; nothing is inline.
export class PlayerMovementSystem extends System {
  /**
   * @param {{x:number,y:number,vx:number,vy:number,angle:number,radius:number}} ship
   * @param {import('../input/InputState.js').InputState} inputState
   */
  constructor(ship, inputState) {
    super();
    this.ship = ship;
    this.input = inputState;
  }

  /**
   * Advance the ship by one fixed step.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ship = this.ship;
    const dtSec = dt / 1000;

    // 1. Thrust from normalized intent (magnitude <= 1 — diagonal not faster).
    ship.vx += this.input.moveX * SHIP_ACCEL * dtSec;
    ship.vy += this.input.moveY * SHIP_ACCEL * dtSec;

    // 2. Exponential drag: frame-rate-independent smooth stop. `k` is the
    //    fraction of speed retained across this step.
    const k = Math.pow(SHIP_DRAG_RETAIN_PER_SEC, dtSec);
    ship.vx *= k;
    ship.vy *= k;

    // 3. Cap speed at the maximum (direction preserved).
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > SHIP_MAX_SPEED) {
      const f = SHIP_MAX_SPEED / sp;
      ship.vx *= f;
      ship.vy *= f;
    }

    // 4. Integrate position, then clamp to the arena interior. When clamped,
    //    zero only the velocity component pushing into the wall so it does not
    //    accumulate against the boundary.
    ship.x += ship.vx * dtSec;
    ship.y += ship.vy * dtSec;

    const minX = ARENA_BORDER_INSET + ship.radius;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - ship.radius;
    const minY = ARENA_BORDER_INSET + ship.radius;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - ship.radius;

    if (ship.x < minX) {
      ship.x = minX;
      if (ship.vx < 0) ship.vx = 0;
    } else if (ship.x > maxX) {
      ship.x = maxX;
      if (ship.vx > 0) ship.vx = 0;
    }
    if (ship.y < minY) {
      ship.y = minY;
      if (ship.vy < 0) ship.vy = 0;
    } else if (ship.y > maxY) {
      ship.y = maxY;
      if (ship.vy > 0) ship.vy = 0;
    }

    // 5. Face the direction of travel only when actually moving; below the
    //    threshold the last facing angle is held (no snap from velocity noise).
    if (Math.hypot(ship.vx, ship.vy) > SHIP_MIN_TURN_SPEED) {
      ship.angle = Math.atan2(ship.vy, ship.vx);
    }
  }
}
