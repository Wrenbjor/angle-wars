// touchControls — pure, Phaser-free floating twin-stick + bomb-button model.
//
// The whole touch input logic (which finger owns which stick, deflection → move
// intent, deflection → aim direction with the hold-to-fire retention, the one-tap
// bomb latch, and the render snapshot) lives here, isolated from any Phaser type so
// it can be unit-tested headlessly — mirroring the inputMath / inputMethod
// convention. PlayerInputSampler is the SOLE Phaser boundary: it feeds this model
// pointer id/down/move/up (in arena logical space) and reads back the vectors it
// writes through InputState (which does the unit-circle clamp / normalize), so the
// movement / firing / bomb systems need no changes.
//
// Floating sticks: each stick's base anchors at its FIRST-touch point (not a fixed
// on-screen position); deflection = current − base. Left screen half owns the move
// stick, right half owns the aim stick, split at ARENA_WIDTH / 2. A tap inside the
// bomb button rect latches one bomb and spawns no stick.
//
// Zero per-frame allocation: all state and the returned move/aim/snapshot objects
// are persistent instance fields, mutated in place (NFR2/NFR9).

import { normalizeToUnit } from './inputMath.js';
import {
  ARENA_WIDTH,
  TOUCH_STICK_MAX_RADIUS,
  TOUCH_STICK_DEADZONE,
  TOUCH_BOMB_BUTTON,
} from '../config/constants.js';

export class TouchControls {
  constructor() {
    // One floating stick per half. `id` is the owning pointer id while `active`.
    // For the aim stick, `dir` + `hasDir` retain the last non-zero unit direction
    // so "hold to fire" stays true even as the thumb drifts back to the origin.
    this._moveStick = {
      active: false,
      id: null,
      baseX: 0,
      baseY: 0,
      curX: 0,
      curY: 0,
    };
    this._aimStick = {
      active: false,
      id: null,
      baseX: 0,
      baseY: 0,
      curX: 0,
      curY: 0,
      dirX: 0,
      dirY: 0,
      hasDir: false,
    };
    // Bomb: latched on the down edge inside the button rect; the owning pointer id
    // is tracked only so the button reads as "pressed" until that finger lifts (and
    // so its move/up events are ignored — a bomb tap spawns no stick).
    this._bombPointerId = null;
    this._bombLatched = false;

    // Persistent return objects (no per-frame allocation).
    this._moveOut = { x: 0, y: 0 };
    this._aimOut = { x: 0, y: 0, active: false };
    this._snap = {
      move: { active: false, baseX: 0, baseY: 0, curX: 0, curY: 0 },
      aim: { active: false, baseX: 0, baseY: 0, curX: 0, curY: 0 },
      bomb: {
        x: TOUCH_BOMB_BUTTON.x,
        y: TOUCH_BOMB_BUTTON.y,
        radius: TOUCH_BOMB_BUTTON.radius,
        pressed: false,
      },
    };
  }

  /**
   * Drop ALL held touch state: both sticks released (move + aim inactive, aim
   * direction cleared) and the bomb latch/owner cleared. Called when the sampler's
   * pointer listeners are frozen (Story 5.2 pause), where a finger lifted during the
   * freeze would never reconcile — leaving a stick `active` with a stale deflection
   * (ship drifting with no finger down on resume) or a bomb latched at the pause edge.
   */
  reset() {
    this._moveStick.active = false;
    this._moveStick.id = null;
    this._aimStick.active = false;
    this._aimStick.id = null;
    this._aimStick.hasDir = false;
    this._aimStick.dirX = 0;
    this._aimStick.dirY = 0;
    this._bombPointerId = null;
    this._bombLatched = false;
  }

  /** Whether (x, y) lies within the smart-bomb button's circular hit region. */
  _insideBomb(x, y) {
    const dx = x - TOUCH_BOMB_BUTTON.x;
    const dy = y - TOUCH_BOMB_BUTTON.y;
    return dx * dx + dy * dy <= TOUCH_BOMB_BUTTON.radius * TOUCH_BOMB_BUTTON.radius;
  }

  /**
   * A finger touched down. The bomb button is checked FIRST (it straddles the
   * half split), then the point is classified by half: left → move stick, right →
   * aim stick. Each stick anchors on its first touch and ignores further touches
   * while already owned (the base is the floating anchor for the whole gesture).
   * @param {number} id Pointer id.
   * @param {number} x Arena-logical x (pointer.worldX).
   * @param {number} y Arena-logical y (pointer.worldY).
   */
  onPointerDown(id, x, y) {
    if (this._insideBomb(x, y)) {
      // One bomb per tap, no stick. Idempotent within a frame (the sampler's
      // consumeBomb collapses to one queueBomb, at parity with the keyboard latch).
      this._bombLatched = true;
      this._bombPointerId = id;
      return;
    }
    if (x < ARENA_WIDTH / 2) {
      if (!this._moveStick.active) {
        this._moveStick.active = true;
        this._moveStick.id = id;
        this._moveStick.baseX = x;
        this._moveStick.baseY = y;
        this._moveStick.curX = x;
        this._moveStick.curY = y;
      }
      return;
    }
    if (!this._aimStick.active) {
      this._aimStick.active = true;
      this._aimStick.id = id;
      this._aimStick.baseX = x;
      this._aimStick.baseY = y;
      this._aimStick.curX = x;
      this._aimStick.curY = y;
      // Reset the retained direction: aim stays inactive until the FIRST non-zero
      // deflection (a centered press does not fire, mirroring the gamepad stick).
      this._aimStick.dirX = 0;
      this._aimStick.dirY = 0;
      this._aimStick.hasDir = false;
    }
  }

  /**
   * A finger moved. Updates only the owning stick's current point. For the aim
   * stick, a deflection past the origin deadzone (re)latches the retained unit
   * direction; a sub-deadzone drift leaves the last direction untouched (so a
   * thumb returning toward center keeps firing the last aimed way while held).
   * @param {number} id Pointer id.
   * @param {number} x Arena-logical x.
   * @param {number} y Arena-logical y.
   */
  onPointerMove(id, x, y) {
    if (this._moveStick.active && id === this._moveStick.id) {
      this._moveStick.curX = x;
      this._moveStick.curY = y;
      return;
    }
    if (this._aimStick.active && id === this._aimStick.id) {
      this._aimStick.curX = x;
      this._aimStick.curY = y;
      const dx = x - this._aimStick.baseX;
      const dy = y - this._aimStick.baseY;
      const { x: ux, y: uy, mag } = normalizeToUnit(dx, dy);
      if (mag > TOUCH_STICK_DEADZONE) {
        this._aimStick.dirX = ux;
        this._aimStick.dirY = uy;
        this._aimStick.hasDir = true;
      }
    }
  }

  /**
   * A finger lifted (pointerup / pointerupoutside). Releases whichever role it
   * owned: a released move stick zeroes intent; a released aim stick clears its
   * retained direction (firing stops); a released bomb finger clears the pressed
   * state. Matching by id, so lifting one thumb never disturbs the other.
   * @param {number} id Pointer id.
   */
  onPointerUp(id) {
    if (this._moveStick.active && id === this._moveStick.id) {
      this._moveStick.active = false;
      this._moveStick.id = null;
    }
    if (this._aimStick.active && id === this._aimStick.id) {
      this._aimStick.active = false;
      this._aimStick.id = null;
      this._aimStick.hasDir = false;
      this._aimStick.dirX = 0;
      this._aimStick.dirY = 0;
    }
    if (id === this._bombPointerId) {
      this._bombPointerId = null;
    }
  }

  /**
   * Current raw move intent = deflection / TOUCH_STICK_MAX_RADIUS (InputState.setMove
   * clamps it to the unit circle). Zero when no move stick is held or the deflection
   * is within the origin deadzone. Returns a persistent object — read it immediately.
   * @returns {{x:number, y:number}}
   */
  moveVector() {
    const out = this._moveOut;
    out.x = 0;
    out.y = 0;
    if (!this._moveStick.active) return out;
    const dx = this._moveStick.curX - this._moveStick.baseX;
    const dy = this._moveStick.curY - this._moveStick.baseY;
    if (Math.hypot(dx, dy) <= TOUCH_STICK_DEADZONE) return out;
    out.x = dx / TOUCH_STICK_MAX_RADIUS;
    out.y = dy / TOUCH_STICK_MAX_RADIUS;
    return out;
  }

  /**
   * Current aim direction: the retained last non-zero unit deflection while the aim
   * stick is held (active = true), else inactive. Returns a persistent object —
   * read it immediately. InputState.setAim normalizes again and treats a zero vector
   * as no aim, so the raw unit direction here is written verbatim.
   * @returns {{x:number, y:number, active:boolean}}
   */
  aimVector() {
    const out = this._aimOut;
    if (this._aimStick.active && this._aimStick.hasDir) {
      out.x = this._aimStick.dirX;
      out.y = this._aimStick.dirY;
      out.active = true;
    } else {
      out.x = 0;
      out.y = 0;
      out.active = false;
    }
    return out;
  }

  /**
   * Read-and-clear the smart-bomb latch (exactly-one-tap semantics): returns whether
   * a bomb was tapped since the last call and clears it. The sampler routes a true
   * result to InputState.queueBomb, at parity with the keyboard/gamepad edge latch.
   * @returns {boolean}
   */
  consumeBomb() {
    const latched = this._bombLatched;
    this._bombLatched = false;
    return latched;
  }

  /**
   * Whether touch is driving this frame: any stick held, or a finger on the bomb
   * button. Fed into resolveActiveMethod as `touchActive`, and gates the overlay
   * render. Lifting all fingers makes this false (the sampler then writes move → 0
   * and aim → inactive while the method stays sticky-TOUCH).
   * @returns {boolean}
   */
  isActive() {
    return (
      this._moveStick.active ||
      this._aimStick.active ||
      this._bombPointerId !== null
    );
  }

  /**
   * A render snapshot (persistent object, mutated in place) for the overlay: each
   * stick's base + current point and active flag, and the bomb button rect + pressed
   * state. No Phaser types — the draw helper turns this into graphics calls.
   * @returns {{move:{active:boolean,baseX:number,baseY:number,curX:number,curY:number},
   *   aim:{active:boolean,baseX:number,baseY:number,curX:number,curY:number},
   *   bomb:{x:number,y:number,radius:number,pressed:boolean}}}
   */
  snapshot() {
    const s = this._snap;
    s.move.active = this._moveStick.active;
    s.move.baseX = this._moveStick.baseX;
    s.move.baseY = this._moveStick.baseY;
    s.move.curX = this._moveStick.curX;
    s.move.curY = this._moveStick.curY;
    s.aim.active = this._aimStick.active;
    s.aim.baseX = this._aimStick.baseX;
    s.aim.baseY = this._aimStick.baseY;
    s.aim.curX = this._aimStick.curX;
    s.aim.curY = this._aimStick.curY;
    s.bomb.pressed = this._bombPointerId !== null;
    return s;
  }
}
