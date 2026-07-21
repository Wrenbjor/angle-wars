import Phaser from 'phaser';
import {
  applyRadialDeadzone,
  isBombButton,
  mappingWarning,
} from './inputMath.js';
import { INPUT_METHOD, resolveActiveMethod } from './inputMethod.js';
import { TouchControls } from './touchControls.js';
import {
  MOVE_DEADZONE,
  AIM_DEADZONE,
  GAMEPAD_BOMB_BUTTONS,
} from '../config/constants.js';

// PlayerInputSampler — the thin Phaser input boundary.
//
// The only Phaser-tied piece of the input path. Each render frame it resolves
// the ACTIVE INPUT METHOD (gamepad vs keyboard/mouse) from this frame's device
// activity via the pure resolveActiveMethod seam, then GATES both channels by
// it: on GAMEPAD it reads the left stick (move) and right stick (aim) with their
// per-channel radial deadzones; otherwise it reads WASD/arrows (move) and the
// mouse pointer (aim). Gating — rather than the old per-channel fall-through —
// is what makes hot-swap explicit and kills cross-device aim bleed: a released
// right stick on the gamepad clearAim()s (firing stops) instead of snapping the
// aim to a stale mouse cursor. The resolved intent is written into a Phaser-free
// InputState the movement/firing/bomb systems consume at sim rate; no
// movement/firing math lives here. Smart bomb is edge-triggered from both the
// keyboard (Shift) and either gamepad bumper.
//
// The active-method resolution is sticky (see resolveActiveMethod): a frame with
// both or neither device active keeps the current method, so control does not
// flicker while inputs rest or briefly contend.
export class PlayerInputSampler {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./InputState.js').InputState} inputState
   * @param {{x:number,y:number}} ship Ship entity (aim origin for mouse aim).
   */
  constructor(scene, inputState, ship) {
    this.scene = scene;
    this.input = inputState;
    this.ship = ship;

    // Keyboard/mouse is the baseline until a pad shows activity.
    this.activeMethod = INPUT_METHOD.KBM;
    // Last observed pointer moveTime, so a frame's "pointer moved since last
    // frame" (a kbm-activity signal) can be detected by a change in this value.
    // Seed from the LIVE pointer, not 0: activePointer.moveTime is a game-clock
    // timestamp that survives a scene restart, so seeding 0 after a restart
    // where the mouse was already used would read as a spurious pointer-move on
    // the first sample() (one frame of false KBM activation for a gamepad player).
    this._lastPointerMoveTime = scene.input.activePointer.moveTime;

    // Once-per-instance latch for the non-standard-mapping diagnostic (DW-33):
    // sample() warns at most once when a connected non-standard pad is present,
    // so the warning does not repeat every render frame.
    this._mappingWarned = false;

    // WASD + arrow keys, plus the smart-bomb key. addKeys returns Key objects
    // with live `isDown` (and usable with Phaser.Input.Keyboard.JustDown for a
    // one-shot edge). The bomb is bound to Shift (KC.SHIFT is the generic Shift
    // keycode — either Shift key fires it) — deliberately NOT Enter/Space/pointer,
    // which are the game-over restart inputs — so a detonation can never double as
    // a restart. On the gamepad the bomb is either bumper (GAMEPAD_BOMB_BUTTONS),
    // wired below as an edge listener at parity with the keyboard latch.
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.keys = scene.input.keyboard.addKeys({
      up: KC.W,
      down: KC.S,
      left: KC.A,
      right: KC.D,
      arrowUp: KC.UP,
      arrowDown: KC.DOWN,
      arrowLeft: KC.LEFT,
      arrowRight: KC.RIGHT,
      bomb: KC.SHIFT,
    });

    // Gamepad smart-bomb: latch on the button's just-pressed EDGE via the
    // gamepad 'down' event (the same edge pattern TitleScene uses for start), so
    // holding a bumper cannot re-queue every frame — one press, one latched
    // request the BombSystem consumes at sim rate, at parity with Shift. The
    // plugin is only present when gamepad input is enabled in the game config, so
    // the listener is guarded. Filtered by the pure isBombButton so only a
    // configured bumper index queues a bomb.
    //
    // Respect the Story 5.2 pause freeze: while the scene is _paused the update
    // loop returns before sample(), so the keyboard bomb (sampleBomb) is frozen.
    // This listener is async and bypasses that loop, so it must gate on the same
    // flag — otherwise a bumper press while paused would latch a bomb that
    // detonates on resume (asymmetric with a frozen Shift, and a wasted bomb).
    scene.input.gamepad?.on('down', (pad, button) => {
      // Pass the pad's mapping so isBombButton is mapping-aware (DW-33): the
      // standard mapping uses the canonical bumper indices, a non-standard pad
      // falls back to the same indices as a documented best-effort.
      if (!this.scene._paused && isBombButton(button.index, pad?.mapping)) {
        this.input.queueBomb();
      }
    });

    // Touch twin-stick (Story 7.1): the Phaser-free floating-stick + bomb model.
    // The sampler is the SOLE Phaser boundary, so ALL touch pointer events are
    // routed into the model here, in SCREEN / base-resolution space (pointer.x/y).
    // Story 7.2 screen-anchors touch: pointer.x/y exclude the camera shake scroll
    // (worldX/worldY include it), and the overlay graphics is pinned scrollFactor(0),
    // so hit-testing and drawing stay shake-stable and inside the safe area. These
    // two changes (coords + scrollFactor) are a package — one without the other
    // regresses shake behavior. The half-split at ARENA_WIDTH/2 and the deflection
    // math are unchanged (base-resolution space still maps the split correctly).
    // Each listener is guarded two ways, mirroring the gamepad bomb listener above:
    //  - the Story 5.2 pause freeze (this.scene._paused): while paused, update()
    //    returns before sample(), so buffering touch here would let it apply on
    //    resume — freeze it at the source for parity with the frozen keyboard.
    //  - a TOUCH-only gate (pointer.wasTouch): a mouse pointer (wasTouch === false)
    //    must NOT feed the touch model, and — symmetrically — a thumb must never
    //    read as the mouse (see isKbmActive). Phaser's pinned 3.90 exposes the
    //    touch/mouse discriminator as `pointer.wasTouch` (+ `wasCanceled`), NOT a
    //    DOM-style `pointerType`; this is the surface the intent's block-if requires.
    this.touch = new TouchControls();
    scene.input.on('pointerdown', (pointer) => {
      if (this.scene._paused || !pointer.wasTouch) return;
      this.touch.onPointerDown(pointer.id, pointer.x, pointer.y);
    });
    scene.input.on('pointermove', (pointer) => {
      if (this.scene._paused || !pointer.wasTouch) return;
      this.touch.onPointerMove(pointer.id, pointer.x, pointer.y);
    });
    const onTouchUp = (pointer) => {
      if (this.scene._paused || !pointer.wasTouch) return;
      this.touch.onPointerUp(pointer.id);
    };
    // pointerupoutside fires when a finger lifts outside the game canvas — without
    // it a stick released off-canvas would stay stuck active (ship drifting on).
    scene.input.on('pointerup', onTouchUp);
    scene.input.on('pointerupoutside', onTouchUp);
  }

  /**
   * Whether touch is driving this frame (any stick held or a finger on the bomb
   * button). ArenaScene reads this to decide whether to draw or clear the overlay.
   * @returns {boolean}
   */
  isTouchActive() {
    return this.touch.isActive();
  }

  /**
   * The touch overlay render snapshot (a persistent object — read it immediately).
   * ArenaScene feeds it to the drawTouchOverlay helper each active frame.
   * @returns {ReturnType<TouchControls['snapshot']>}
   */
  touchSnapshot() {
    return this.touch.snapshot();
  }

  /**
   * Drop all held touch state (both sticks + the bomb latch). ArenaScene calls this
   * when entering pause: the touch pointer listeners are frozen while paused, so a
   * finger lifted during the pause would never reconcile and would strand a stick
   * (drifting on resume) or a bomb latched at the pause edge (detonating on resume).
   */
  resetTouch() {
    this.touch.reset();
  }

  /**
   * Reposition the touch smart-bomb button (Story 7.2 safe-area layout). A thin
   * passthrough to the touch model, which owns the single runtime bomb rect backing
   * both the hit region and the drawn button. ArenaScene calls this from
   * _applyMobileLayout at create and on every scale resize.
   * @param {number} x New center x (arena-logical).
   * @param {number} y New center y (arena-logical).
   * @param {number} [radius] New radius (defaults to the current radius).
   */
  setBombButton(x, y, radius) {
    this.touch.setBombButton(x, y, radius);
  }

  /**
   * Return the currently-connected gamepad, or null. The gamepad plugin is only
   * present when enabled in the game config (input.gamepad = true).
   *
   * Guard on the LIVE connection flag, not just presence: Phaser does not remove
   * a disconnected pad from its gamepads array (refreshPads() `continue`s past
   * the null navigator slot), so getPad(0) keeps returning a stale pad with
   * FROZEN stick/button values after a mid-play disconnect. Without this guard, a
   * stick deflected at the moment of disconnect would read as ongoing gamepad
   * activity forever — locking the ship into sticky-GAMEPAD, auto-firing a frozen
   * direction with no way back to the mouse. Returning null on a dead pad is what
   * lets the sampler fall back to keyboard/mouse defensively (the intent's
   * disconnect requirement).
   *
   * Select the first *connected* pad rather than hard-pinning index 0 (DW-34):
   * a pad reassigned to a non-zero navigator slot after a disconnect+reconnect
   * would otherwise drive nothing. The `total === 0` short-circuit and the
   * connected-guard are unchanged — a dead/disconnected pad still yields null,
   * preserving the sticky-GAMEPAD freeze fix.
   * @returns {Phaser.Input.Gamepad.Gamepad|null}
   */
  getPad() {
    const gp = this.scene.input.gamepad;
    if (!gp || gp.total === 0) return null;
    const pad = gp.getAll().find((p) => p && p.connected);
    return pad ?? null;
  }

  /**
   * Emit the non-standard-mapping diagnostic at most once per sampler instance
   * when a connected pad reports a mapping the browser could not fit to the W3C
   * 'standard' layout (DW-33). Makes the mapping-awareness observable for the
   * whole pad (sticks + bomb): a possible bomb-button misbind (see
   * isBombButton's best-effort fallback) becomes discoverable in the console
   * rather than silent. Emits at most once per instance, on the FIRST
   * non-standard sighting; a standard pad never warns and is simply re-checked
   * (cheaply) each frame. The latch prevents warning SPAM, not per-frame
   * execution — it is set only when a warning fires, so a non-standard pad
   * hot-swapped in after a standard one still warns the first time it is seen.
   * @param {Phaser.Input.Gamepad.Gamepad|null} pad
   */
  warnOnNonStandardMapping(pad) {
    if (this._mappingWarned || !pad) return;
    const warning = mappingWarning(pad.mapping);
    if (warning) {
      this._mappingWarned = true;
      console.warn(warning);
    }
  }

  /**
   * Sample current input and write the move intent + aim direction into the
   * InputState. Called once per render frame (a level, not an edge event).
   *
   * Resolves the active input method FIRST (from this frame's per-device
   * activity), then gates the move/aim channels by it so the channels always
   * follow the last-used device.
   */
  sample() {
    const pad = this.getPad();
    this.warnOnNonStandardMapping(pad);

    const gamepadActive = this.isGamepadActive(pad);
    const kbmActive = this.isKbmActive();
    const touchActive = this.touch.isActive();
    this.activeMethod = resolveActiveMethod(this.activeMethod, {
      gamepadActive,
      kbmActive,
      touchActive,
    });

    this.sampleMove(pad);
    this.sampleAim(pad);
    this.sampleBomb();
  }

  /**
   * Whether the gamepad is driving this frame: a pad is present AND the left
   * stick is past MOVE_DEADZONE, or the right stick is past AIM_DEADZONE, or a
   * configured bomb button is held. Used only to resolve the active method.
   * @param {Phaser.Input.Gamepad.Gamepad|null} pad
   * @returns {boolean}
   */
  isGamepadActive(pad) {
    if (!pad) return false;
    const ls = pad.leftStick;
    const move = applyRadialDeadzone(ls.x, ls.y, MOVE_DEADZONE);
    if (move.x !== 0 || move.y !== 0) return true;
    const rs = pad.rightStick;
    const aim = applyRadialDeadzone(rs.x, rs.y, AIM_DEADZONE);
    if (aim.x !== 0 || aim.y !== 0) return true;
    return GAMEPAD_BOMB_BUTTONS.some((i) => pad.buttons?.[i]?.pressed);
  }

  /**
   * Whether keyboard/mouse is driving this frame: any WASD/arrow key down, or
   * the bomb key down, or the pointer moved since last frame, or the pointer is
   * down. Advances the stored pointer moveTime, so it must be called once per
   * frame. Used only to resolve the active method.
   * @returns {boolean}
   */
  isKbmActive() {
    const k = this.keys;
    const keyDown =
      k.up.isDown ||
      k.down.isDown ||
      k.left.isDown ||
      k.right.isDown ||
      k.arrowUp.isDown ||
      k.arrowDown.isDown ||
      k.arrowLeft.isDown ||
      k.arrowRight.isDown ||
      k.bomb.isDown;

    const p = this.scene.input.activePointer;
    // A thumb must never register as the mouse (no cross-device aim bleed): gate
    // the pointer-move and pointer-down signals on this pointer NOT being a touch.
    // Phaser 3.90 exposes the discriminator as `pointer.wasTouch` (true = the last
    // event was a touch), not a DOM `pointerType`; a mouse pointer has wasTouch ===
    // false and an unseeded test pointer leaves it undefined — both read as "mouse"
    // (!wasTouch), so the keyboard/mouse behavior is unchanged. The stored moveTime
    // still advances every frame (touch or mouse) so the change-detection stays honest.
    const isMousePointer = !p.wasTouch;
    const pointerMoved =
      p.moveTime > 0 && p.moveTime !== this._lastPointerMoveTime && isMousePointer;
    this._lastPointerMoveTime = p.moveTime;

    return keyDown || pointerMoved || (p.isDown && isMousePointer);
  }

  /**
   * Latch a smart-bomb request on the bomb key's just-pressed EDGE. JustDown
   * returns true exactly once per physical press (it consumes the key's internal
   * edge state), so holding the key does not re-queue every frame — one press,
   * one latched request the BombSystem consumes at sim rate. The gamepad bumper
   * bomb is wired as its own edge listener in the constructor.
   */
  sampleBomb() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.bomb)) {
      this.input.queueBomb();
    }
    // Touch smart-bomb: read-and-clear the model's one-tap latch and route it
    // through the same queueBomb seam (one tap → one detonation), at parity with
    // the keyboard/gamepad edge latch. Consumed every frame regardless of the
    // active method (like the gamepad bomb listener), since tapping the button also
    // makes touchActive true and flips the method to TOUCH this same frame.
    if (this.touch.consumeBomb()) {
      this.input.queueBomb();
    }
  }

  /**
   * Write the move intent. Gated by the active method: on GAMEPAD (with a pad
   * present) the left stick drives movement through MOVE_DEADZONE — below the
   * deadzone the move is exactly zero with NO keyboard fall-through (a resting
   * stick does not drift, and does not let stale keys leak in). Otherwise the
   * keyboard branch drives movement.
   * @param {Phaser.Input.Gamepad.Gamepad|null} pad
   */
  sampleMove(pad) {
    if (this.activeMethod === INPUT_METHOD.TOUCH) {
      // Touch: the floating move stick's deflection / MAX_RADIUS. setMove clamps to
      // the unit circle (a diagonal is never faster than a cardinal). A released
      // stick yields (0,0), so lifting all fingers rests the ship even while the
      // method stays sticky-TOUCH.
      const m = this.touch.moveVector();
      this.input.setMove(m.x, m.y);
      return;
    }
    if (this.activeMethod === INPUT_METHOD.GAMEPAD && pad) {
      const ls = pad.leftStick;
      const { x, y } = applyRadialDeadzone(ls.x, ls.y, MOVE_DEADZONE);
      // Below the deadzone → exactly zero (no drift); no keyboard fall-through
      // while the gamepad is the active device.
      this.input.setMove(x, y);
      return;
    }

    // Keyboard: (right - left, down - up). setMove clamps the diagonal to the
    // unit circle so it is not faster than a cardinal.
    const k = this.keys;
    const left = k.left.isDown || k.arrowLeft.isDown;
    const right = k.right.isDown || k.arrowRight.isDown;
    const up = k.up.isDown || k.arrowUp.isDown;
    const down = k.down.isDown || k.arrowDown.isDown;

    const mx = (right ? 1 : 0) - (left ? 1 : 0);
    const my = (down ? 1 : 0) - (up ? 1 : 0);
    this.input.setMove(mx, my);
  }

  /**
   * Write the aim direction. Gated by the active method: on GAMEPAD (with a pad
   * present) the right stick aims through AIM_DEADZONE — a centered stick
   * clearAim()s (firing stops) rather than falling through to the mouse, which
   * is the cross-device aim-bleed fix. Otherwise the mouse pointer's world
   * position relative to the ship aims, preserving the engaged-gate so aim stays
   * inactive until the mouse is actually used. setAim normalizes to a unit
   * direction and treats a zero-length vector as no aim (firing stops).
   * @param {Phaser.Input.Gamepad.Gamepad|null} pad
   */
  sampleAim(pad) {
    if (this.activeMethod === INPUT_METHOD.TOUCH) {
      // Touch: the aim stick's retained unit direction drives auto-fire while held;
      // it is inactive before the first deflection and after release (firing stops).
      // setAim normalizes again and treats a zero vector as no aim.
      const a = this.touch.aimVector();
      if (a.active) {
        this.input.setAim(a.x, a.y);
      } else {
        this.input.clearAim();
      }
      return;
    }
    if (this.activeMethod === INPUT_METHOD.GAMEPAD) {
      // Gamepad disconnected mid-play but the method is still sticky-GAMEPAD:
      // clear aim (firing stops) rather than falling through to the mouse and
      // snapping to a stale cursor. The mouse re-acquires aim only once the
      // player makes a real mouse move, which flips activeMethod to KBM via
      // isKbmActive(). (The move channel's keyboard fall-through here is benign:
      // no keys held → zero.)
      if (!pad) {
        this.input.clearAim();
        return;
      }
      const rs = pad.rightStick;
      const { x, y } = applyRadialDeadzone(rs.x, rs.y, AIM_DEADZONE);
      if (x !== 0 || y !== 0) {
        this.input.setAim(x, y);
      } else {
        // Centered right stick → no aim (firing stops). No mouse fall-through:
        // that fall-through was the stale-cursor aim bleed this story fixes.
        this.input.clearAim();
      }
      return;
    }

    // Mouse: aim from the ship toward the cursor. worldX/worldY are in
    // arena/logical space (the FIT camera maps the pointer there), matching the
    // ship's coordinate space. Only trust the pointer once it has actually been
    // engaged — Phaser's activePointer defaults to (0,0) before any input, which
    // would otherwise auto-fire toward the top-left corner on launch (and for a
    // gamepad player who never touches the mouse). Keyboard is a move-only
    // fallback, not an aim device, so no aim until the mouse moves is correct.
    const p = this.scene.input.activePointer;
    if (p.moveTime > 0 || p.downTime > 0) {
      this.input.setAim(p.worldX - this.ship.x, p.worldY - this.ship.y);
    } else {
      this.input.clearAim();
    }
  }
}
