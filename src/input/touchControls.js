// touchControls — pure, Phaser-free floating twin-stick + bomb-button model.
//
// The whole touch input logic (which finger owns which stick, deflection → move
// intent, deflection → aim direction with the hold-to-fire retention, the one-tap
// bomb latch, and the render snapshot) lives here, isolated from any Phaser type so
// it can be unit-tested headlessly — mirroring the inputMath / inputMethod
// convention. PlayerInputSampler is the SOLE Phaser boundary: it feeds this model
// pointer id/down/move/up (in base-resolution / screen space — pointer.x/y, the
// 1280×720 logical unit space but WITHOUT camera-shake scroll; Story 7.2) and reads back the vectors it
// writes through InputState (which does the unit-circle clamp / normalize), so the
// movement / firing / bomb systems need no changes.
//
// Floating sticks: each stick's base anchors at its FIRST-touch point (not a fixed
// on-screen position); deflection = current − base. Left screen half owns the move
// stick, right half owns the aim stick, split at ARENA_WIDTH / 2. A tap inside the
// bomb button rect latches one bomb and spawns no stick; a tap inside the DASH button
// rect does the same for the Afterburner dash (Story 10.5) — but ONLY while the dash
// is owned, see the `_dashEnabled` ownership gate.
//
// Zero per-frame allocation: all state and the returned move/aim/snapshot objects
// are persistent instance fields, mutated in place (NFR2/NFR9).

import { normalizeToUnit } from './inputMath.js';
import {
  ARENA_WIDTH,
  TOUCH_STICK_MAX_RADIUS,
  TOUCH_STICK_DEADZONE,
  TOUCH_BOMB_BUTTON,
  TOUCH_DASH_BUTTON,
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

    // Runtime smart-bomb button rect (Story 7.2). Defaults to the fixed
    // TOUCH_BOMB_BUTTON constant; ArenaScene's safe-area layout shifts it via
    // setBombButton so the drawn button clears a bottom home indicator. This is the
    // SINGLE source of truth for both the hit region (_insideBomb) and the drawn
    // position (snapshot), so they can never drift apart when the layout moves it.
    this._bombButton = {
      x: TOUCH_BOMB_BUTTON.x,
      y: TOUCH_BOMB_BUTTON.y,
      radius: TOUCH_BOMB_BUTTON.radius,
    };

    // Dash (Story 10.5): the same latch + owner-id pair as the bomb, with the same
    // one-tap semantics.
    this._dashPointerId = null;
    this._dashLatched = false;

    // Runtime dash button rect, defaulting to TOUCH_DASH_BUTTON and shifted by
    // ArenaScene's safe-area layout via setDashButton — the SINGLE source of truth for
    // both the hit region (_insideDash) and the drawn position (snapshot), exactly as
    // the bomb's rect is.
    //
    // The two rects MUST NOT OVERLAP. The shipped geometry leaves 56px of clear gap
    // between the rims (168px apart, radii 60 and 52), which is why onPointerDown can
    // test them in a FIXED order (bomb first, then dash) without the order ever being
    // observable. A layout change that narrows that gap to an overlap would make the
    // fixed order matter — re-check it here if either rect moves.
    this._dashButton = {
      x: TOUCH_DASH_BUTTON.x,
      y: TOUCH_DASH_BUTTON.y,
      radius: TOUCH_DASH_BUTTON.radius,
    };

    // OWNERSHIP GATE (Story 10.5) — nothing the bomb needs, because the bomb is always
    // available while the dash is a PURCHASED capability (Afterburner Lv2+). While this
    // is false the dash button does not exist at all as far as the player is concerned:
    // `_insideDash` returns false so a tap in that region falls straight through to the
    // ordinary right-half aim stick exactly as pre-10.5, `snapshot().dash.enabled` is
    // false so the overlay skips drawing it, and `isActive()` ignores the dash latch.
    //
    // WHY gate it: a permanently-drawn button would cost EVERY touch player a 52px-radius
    // disc of right-half aim-stick area for an action most runs never unlock.
    //
    // ArenaScene pushes this every render frame from `dashSystem.dashEnabled()`, so the
    // button appears the moment a card pick grants the dash.
    this._dashEnabled = false;

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
      dash: {
        x: TOUCH_DASH_BUTTON.x,
        y: TOUCH_DASH_BUTTON.y,
        radius: TOUCH_DASH_BUTTON.radius,
        pressed: false,
        // The ownership gate, published so the overlay's draw decision and this
        // model's hit-test read ONE flag and can never disagree.
        enabled: false,
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
    this._dashPointerId = null;
    this._dashLatched = false;
  }

  /**
   * Reposition the smart-bomb button's hit region + drawn rect (Story 7.2). Driven
   * from ArenaScene's safe-area layout so the button clears a bottom home indicator.
   * A single runtime rect backs both the hit test and the snapshot, so the tap
   * target and the drawn button stay identical after a shift.
   * @param {number} x New center x (arena-logical).
   * @param {number} y New center y (arena-logical).
   * @param {number} [radius] New radius (defaults to the current radius).
   */
  setBombButton(x, y, radius = this._bombButton.radius) {
    this._bombButton.x = x;
    this._bombButton.y = y;
    this._bombButton.radius = radius;
  }

  /** Whether (x, y) lies within the smart-bomb button's circular hit region. */
  _insideBomb(x, y) {
    const b = this._bombButton;
    const dx = x - b.x;
    const dy = y - b.y;
    return dx * dx + dy * dy <= b.radius * b.radius;
  }

  /**
   * Reposition the dash button's hit region + drawn rect (Story 10.5), mirroring
   * setBombButton: one runtime rect backs both the hit test and the snapshot, so the
   * tap target and the drawn button stay identical after a safe-area shift.
   * @param {number} x New center x (arena-logical).
   * @param {number} y New center y (arena-logical).
   * @param {number} [radius] New radius (defaults to the current radius).
   */
  setDashButton(x, y, radius = this._dashButton.radius) {
    this._dashButton.x = x;
    this._dashButton.y = y;
    this._dashButton.radius = radius;
  }

  /**
   * Set the dash button's OWNERSHIP GATE (Story 10.5). ArenaScene pushes this every
   * render frame from `dashSystem.dashEnabled()` — a per-frame push, not a one-shot at
   * create, because the dash is unlocked MID-RUN by a card pick.
   *
   * Flipping it OFF clears any pending latch and owner id, so a press caught at the
   * transition cannot fire later. In shipped play the fold is monotonic and the gate
   * never goes true→false, but the guard is cheap and keeps the flag one-directional
   * only by policy rather than by assumption.
   * @param {boolean} on Whether the dash is currently owned.
   */
  setDashEnabled(on) {
    const next = !!on;
    if (!next) {
      this._dashLatched = false;
      this._dashPointerId = null;
    }
    this._dashEnabled = next;
  }

  /**
   * Whether (x, y) lies within the dash button's circular hit region — and the dash is
   * actually OWNED. While the gate is closed this is always false, so the region falls
   * straight through to the ordinary right-half aim stick exactly as pre-10.5.
   */
  _insideDash(x, y) {
    if (!this._dashEnabled) return false;
    const d = this._dashButton;
    const dx = x - d.x;
    const dy = y - d.y;
    return dx * dx + dy * dy <= d.radius * d.radius;
  }

  /**
   * A finger touched down. The bomb button is checked FIRST (it straddles the
   * half split), then the dash button (Story 10.5 — right half, but it must claim
   * its disc before the half split spawns an aim stick), then the point is
   * classified by half: left → move stick, right → aim stick. Each stick anchors on
   * its first touch and ignores further touches while already owned (the base is the
   * floating anchor for the whole gesture).
   *
   * The bomb/dash order is FIXED but not observable: the shipped rects are 56px
   * apart at the rims (see `_dashButton`), so no point can satisfy both tests.
   * @param {number} id Pointer id.
   * @param {number} x Base-resolution / screen x (pointer.x) — logical units without camera-shake scroll.
   * @param {number} y Base-resolution / screen y (pointer.y) — logical units without camera-shake scroll.
   */
  onPointerDown(id, x, y) {
    if (this._insideBomb(x, y)) {
      // One bomb per tap, no stick. Idempotent within a frame (the sampler's
      // consumeBomb collapses to one queueBomb, at parity with the keyboard latch).
      this._bombLatched = true;
      this._bombPointerId = id;
      return;
    }
    if (this._insideDash(x, y)) {
      // One dash per tap, no stick — the bomb's semantics exactly. Only reachable
      // while the ownership gate is open (see `_insideDash`).
      this._dashLatched = true;
      this._dashPointerId = id;
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
   * @param {number} x Base-resolution / screen x (pointer.x) — logical units without camera-shake scroll.
   * @param {number} y Base-resolution / screen y (pointer.y) — logical units without camera-shake scroll.
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
    if (id === this._dashPointerId) {
      this._dashPointerId = null;
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
   * Read-and-clear the dash latch (exactly-one-tap semantics), mirroring consumeBomb.
   * The sampler routes a true result to InputState.queueDash, at parity with the
   * keyboard/gamepad edge latch. A latch can only exist while the ownership gate was
   * open when the tap landed, and closing the gate clears it (see setDashEnabled).
   * @returns {boolean}
   */
  consumeDash() {
    const latched = this._dashLatched;
    this._dashLatched = false;
    return latched;
  }

  /**
   * Whether touch is driving this frame: any stick held, or a finger on the bomb
   * button, or — while the dash is OWNED — a finger on the dash button. Fed into
   * resolveActiveMethod as `touchActive`, and gates the overlay render. Lifting all
   * fingers makes this false (the sampler then writes move → 0 and aim → inactive
   * while the method stays sticky-TOUCH).
   *
   * The dash term is gated by `_dashEnabled` so a build that cannot dash behaves
   * byte-identically to pre-10.5 here — and because `_insideDash` already refuses to
   * set the owner id while the gate is closed, the two guards agree by construction.
   * @returns {boolean}
   */
  isActive() {
    return (
      this._moveStick.active ||
      this._aimStick.active ||
      this._bombPointerId !== null ||
      (this._dashEnabled && this._dashPointerId !== null)
    );
  }

  /**
   * A render snapshot (persistent object, mutated in place) for the overlay: each
   * stick's base + current point and active flag, and the bomb button rect + pressed
   * state. No Phaser types — the draw helper turns this into graphics calls.
   * @returns {{move:{active:boolean,baseX:number,baseY:number,curX:number,curY:number},
   *   aim:{active:boolean,baseX:number,baseY:number,curX:number,curY:number},
   *   bomb:{x:number,y:number,radius:number,pressed:boolean},
   *   dash:{x:number,y:number,radius:number,pressed:boolean,enabled:boolean}}}
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
    // Reflect the runtime bomb rect (Story 7.2) so the drawn button tracks the
    // safe-area-shifted hit region — a single source of truth for both.
    s.bomb.x = this._bombButton.x;
    s.bomb.y = this._bombButton.y;
    s.bomb.radius = this._bombButton.radius;
    s.bomb.pressed = this._bombPointerId !== null;
    // Reflect the runtime dash rect + the ownership gate (Story 10.5). `enabled` is
    // the SAME flag `_insideDash` reads, so the drawn button and the tap target can
    // never disagree about whether the dash exists.
    s.dash.x = this._dashButton.x;
    s.dash.y = this._dashButton.y;
    s.dash.radius = this._dashButton.radius;
    s.dash.pressed = this._dashPointerId !== null;
    s.dash.enabled = this._dashEnabled;
    return s;
  }
}
