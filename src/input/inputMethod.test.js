import { describe, it, expect } from 'vitest';
import { INPUT_METHOD, resolveActiveMethod } from './inputMethod.js';

const { KBM, GAMEPAD } = INPUT_METHOD;

describe('resolveActiveMethod', () => {
  it('picks up the gamepad when only the pad is active', () => {
    expect(
      resolveActiveMethod(KBM, { gamepadActive: true, kbmActive: false }),
    ).toBe(GAMEPAD);
  });

  it('returns to keyboard/mouse when only kbm is active', () => {
    expect(
      resolveActiveMethod(GAMEPAD, { gamepadActive: false, kbmActive: true }),
    ).toBe(KBM);
  });

  it('stays on the gamepad when neither device is active (sticky idle)', () => {
    expect(
      resolveActiveMethod(GAMEPAD, { gamepadActive: false, kbmActive: false }),
    ).toBe(GAMEPAD);
  });

  it('keeps prev when both devices are active same frame (sticky contention)', () => {
    expect(
      resolveActiveMethod(GAMEPAD, { gamepadActive: true, kbmActive: true }),
    ).toBe(GAMEPAD);
    // And the mirror: contention while on KBM keeps KBM.
    expect(
      resolveActiveMethod(KBM, { gamepadActive: true, kbmActive: true }),
    ).toBe(KBM);
  });

  it('stays on kbm from the baseline when idle (sticky idle)', () => {
    expect(
      resolveActiveMethod(KBM, { gamepadActive: false, kbmActive: false }),
    ).toBe(KBM);
  });
});
