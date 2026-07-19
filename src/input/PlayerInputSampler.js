import Phaser from 'phaser';
import { applyRadialDeadzone } from './inputMath.js';
import { INPUT_DEADZONE } from '../config/constants.js';

// PlayerInputSampler — the thin Phaser input boundary.
//
// The only Phaser-tied piece of the input path. Each render frame it reads the
// gamepad left stick (with a radial deadzone) when a pad is connected and
// engaged, otherwise falls back to WASD/arrow keys, and writes the resulting
// normalized move intent into a Phaser-free InputState that the movement system
// consumes at sim rate. No movement math lives here.
export class PlayerInputSampler {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./InputState.js').InputState} inputState
   */
  constructor(scene, inputState) {
    this.scene = scene;
    this.input = inputState;

    // WASD + arrow keys. addKeys returns Key objects with live `isDown`.
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
   * Sample current input and write the move intent into the InputState.
   * Called once per render frame (a level, not an edge event).
   */
  sample() {
    // Gamepad left stick takes priority when it reports intent past the
    // deadzone. Below the deadzone we fall through to the keyboard so a
    // connected-but-idle pad does not suppress WASD/arrows.
    const pad = this.getPad();
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
}
