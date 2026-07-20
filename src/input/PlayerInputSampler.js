import Phaser from 'phaser';
import { applyRadialDeadzone } from './inputMath.js';
import { INPUT_DEADZONE } from '../config/constants.js';

// PlayerInputSampler — the thin Phaser input boundary.
//
// The only Phaser-tied piece of the input path. Each render frame it reads the
// gamepad left stick (with a radial deadzone) when a pad is connected and
// engaged, otherwise falls back to WASD/arrow keys, writing the resulting
// normalized move intent into a Phaser-free InputState. In the same pass it
// samples the aim channel — gamepad right stick (deadzoned) with priority, else
// the mouse pointer's world position relative to the ship — into that same
// InputState. Both the movement and firing systems consume it at sim rate. No
// movement/firing math lives here.
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

    // WASD + arrow keys, plus the smart-bomb key. addKeys returns Key objects
    // with live `isDown` (and usable with Phaser.Input.Keyboard.JustDown for a
    // one-shot edge). The bomb is bound to Shift (KC.SHIFT is the generic Shift
    // keycode — either Shift key fires it) — deliberately NOT Enter/Space/pointer,
    // which are the game-over restart inputs — so a detonation can never double as
    // a restart. A dedicated non-restart key is the real constraint; gamepad bomb
    // and rebinding are Epic 5 input polish.
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
  }

  /**
   * Return the connected+engaged gamepad, or null. The gamepad plugin is only
   * present when enabled in the game config (input.gamepad = true).
   * @returns {Phaser.Input.Gamepad.Gamepad|null}
   */
  getPad() {
    const gp = this.scene.input.gamepad;
    if (!gp || gp.total === 0) return null;
    return gp.getPad(0) ?? null;
  }

  /**
   * Sample current input and write the move intent + aim direction into the
   * InputState. Called once per render frame (a level, not an edge event).
   */
  sample() {
    const pad = this.getPad();
    this.sampleMove(pad);
    this.sampleAim(pad);
    this.sampleBomb();
  }

  /**
   * Latch a smart-bomb request on the bomb key's just-pressed EDGE. JustDown
   * returns true exactly once per physical press (it consumes the key's internal
   * edge state), so holding the key does not re-queue every frame — one press,
   * one latched request the BombSystem consumes at sim rate. Gamepad bomb input
   * is Epic 5 input polish; this is the keyboard boundary only.
   */
  sampleBomb() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.bomb)) {
      this.input.queueBomb();
    }
  }

  /**
   * Write the move intent from the gamepad left stick (deadzoned) or keyboard.
   * @param {Phaser.Input.Gamepad.Gamepad|null} pad
   */
  sampleMove(pad) {
    // Gamepad left stick takes priority when it reports intent past the
    // deadzone. Below the deadzone we fall through to the keyboard so a
    // connected-but-idle pad does not suppress WASD/arrows.
    if (pad) {
      const ls = pad.leftStick;
      const { x, y } = applyRadialDeadzone(ls.x, ls.y, INPUT_DEADZONE);
      if (x !== 0 || y !== 0) {
        this.input.setMove(x, y);
        return;
      }
    }

    // Keyboard fallback: (right - left, down - up). setMove clamps the diagonal
    // to the unit circle so it is not faster than a cardinal.
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
   * Write the aim direction. Gamepad right stick past the deadzone takes
   * priority; otherwise the mouse pointer's world position relative to the ship
   * is the complete fallback. setAim normalizes to a unit direction and treats
   * a zero-length vector as no aim (firing stops).
   * @param {Phaser.Input.Gamepad.Gamepad|null} pad
   */
  sampleAim(pad) {
    // Gamepad right stick aims when pushed past the deadzone.
    if (pad) {
      const rs = pad.rightStick;
      const { x, y } = applyRadialDeadzone(rs.x, rs.y, INPUT_DEADZONE);
      if (x !== 0 || y !== 0) {
        this.input.setAim(x, y);
        return;
      }
    }

    // Mouse fallback: aim from the ship toward the cursor. worldX/worldY are in
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
