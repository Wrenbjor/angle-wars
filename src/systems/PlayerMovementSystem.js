import { System } from '../core/System.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  SHIP_ACCEL,
  SHIP_MAX_SPEED,
  SHIP_DRAG_RETAIN_PER_SEC,
  SHIP_MIN_TURN_SPEED,
  MOVE_SPEED_MULT_MAX,
  DASH_SPEED,
} from '../config/constants.js';

// PlayerMovementSystem — velocity-based ship movement (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step, so feel is
// identical regardless of render frame rate. Semi-implicit Euler integration
// with input thrust, exponential (frame-rate-independent) drag, a max-speed
// cap, arena-interior clamping, and facing toward the direction of travel.
//
// All feel magnitudes come from centralized constants; nothing is inline.
//
// Story 10.5 (Afterburner) adds two optional injections and keeps this system the SOLE
// writer of ship.vx/vy/x/y:
//   - `playerStats` supplies `moveSpeedMult`, applied to BOTH the thrust acceleration
//     AND the speed cap (see `_moveSpeedMult` and step 1/3 below);
//   - `dashSystem` supplies the dash WINDOW and DIRECTION; when its window is open,
//     steps 1–3 are replaced by a constant-velocity burst and steps 4–5 run unchanged.
//     DashSystem owns the window and the damage sweep; this system owns the motion.
export class PlayerMovementSystem extends System {
  /**
   * @param {{x:number,y:number,vx:number,vy:number,angle:number,radius:number}} ship
   * @param {import('../input/InputState.js').InputState} inputState
   * @param {Object<string,number>|null} [playerStats=null] The shared player-stat store
   *   `moveSpeedMult` is read from (Story 10.5). Optional (slot 3) so every existing
   *   caller and test stub is unchanged; a null store means the pre-10.5 profile exactly.
   * @param {import('./DashSystem.js').DashSystem|null} [dashSystem=null] The dash
   *   runtime (Story 10.5). Optional (slot 4) for the same reason.
   */
  constructor(ship, inputState, playerStats = null, dashSystem = null) {
    super();
    this.ship = ship;
    this.input = inputState;
    this.playerStats = playerStats;
    this.dashSystem = dashSystem;
  }

  /**
   * The sanitized movement-speed multiplier off the shared store — the FiringSystem._mult
   * shape with an added safety clamp. A missing store, a missing field, or junk (NaN,
   * Infinity, 0, negative) all resolve to 1, i.e. exactly the pre-10.5 profile; an absurd
   * value is clamped to MOVE_SPEED_MULT_MAX so a corrupted store cannot make the ship
   * uncontrollable. At 1 both products below are their bare constants, so the no-item
   * path is byte-identical. Allocates nothing.
   * @returns {number} the sanitized multiplier, in (0, MOVE_SPEED_MULT_MAX].
   */
  _moveSpeedMult() {
    const ps = this.playerStats;
    if (ps === null || ps === undefined) return 1;
    const v = ps.moveSpeedMult;
    if (!Number.isFinite(v) || v <= 0) return 1;
    return v > MOVE_SPEED_MULT_MAX ? MOVE_SPEED_MULT_MAX : v;
  }

  /**
   * Advance the ship by one fixed step.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ship = this.ship;
    const dtSec = dt / 1000;

    // Story 10.5 — DASH BRANCH. `dashSystem.active` is read one tick after DashSystem
    // set it: DashSystem is registered after CollisionSystem (so its kills reach the
    // live per-tick kill latches), which necessarily puts it LATER in the tick than this
    // system. That one-fixed-step lag is deterministic and is exactly what DashSystem
    // republishes as `movementActive` for every other consumer, so the protected /
    // damaged / trailing windows match the ticks travelled here.
    //
    // The burst is CONSTANT-VELOCITY: thrust and drag are deliberately skipped, because
    // letting either touch it would make the travel distance depend on which way the
    // stick happens to be held. Steps 4 (integrate + arena clamp) and 5 (facing) still
    // run below for BOTH branches — facing is already correct during a dash since
    // DASH_SPEED is far above SHIP_MIN_TURN_SPEED. The clamp zeroes the wall-ward
    // velocity component, but this branch re-applies it next tick, so a dash into a wall
    // GRINDS at the boundary for the rest of the window rather than ending it early.
    if (this.dashSystem && this.dashSystem.active) {
      ship.vx = this.dashSystem.dirX * DASH_SPEED;
      ship.vy = this.dashSystem.dirY * DASH_SPEED;
    } else {
      // Read the multiplier ONCE and apply it at BOTH ends of the velocity profile.
      //
      // WHY BOTH. The cap is not the ship's real speed limit whenever the thrust/drag
      // equilibrium sits lower. With k = SHIP_DRAG_RETAIN_PER_SEC^dt = 0.93240, the
      // fixed point of `v ← (v + accel·dt)·k` is `accel·dt·k/(1−k)` = 597.7 px/s at the
      // base accel. The base cap of 520 sits BELOW that, so today the cap binds — but
      // raise the cap ALONE and it stops binding at mult ≈ 1.149, so Lv2 (624), Lv3/Lv4
      // (650) and Lv5 (702) would all top out at a flat 597.7 and four of the item's
      // five rungs would be indistinguishable in play. Scaling accel by the SAME factor
      // moves the equilibrium to 597.7 × mult, which is above 520 × mult for every
      // positive multiplier, so the cap binds at EVERY rung and the achieved top speed
      // really is SHIP_MAX_SPEED × mult.
      //
      // Two properties fall out: at mult === 1 both products are their bare constants,
      // so the no-item path is byte-identical; and because the profile scales in SPEED
      // rather than in TIME, time-to-top-speed and stopping-distance-in-time are
      // unchanged at every rung (the ship gets faster, not floatier). Step 2's drag `k`
      // is therefore left EXACTLY as it is.
      const mult = this._moveSpeedMult();

      // 1. Thrust from normalized intent (magnitude <= 1 — diagonal not faster).
      const accel = SHIP_ACCEL * mult;
      ship.vx += this.input.moveX * accel * dtSec;
      ship.vy += this.input.moveY * accel * dtSec;

      // 2. Exponential drag: frame-rate-independent smooth stop. `k` is the
      //    fraction of speed retained across this step. Deliberately UNSCALED.
      const k = Math.pow(SHIP_DRAG_RETAIN_PER_SEC, dtSec);
      ship.vx *= k;
      ship.vy *= k;

      // 3. Cap speed at the (scaled) maximum (direction preserved).
      const cap = SHIP_MAX_SPEED * mult;
      const sp = Math.hypot(ship.vx, ship.vy);
      if (sp > cap) {
        const f = cap / sp;
        ship.vx *= f;
        ship.vy *= f;
      }
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
