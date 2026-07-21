import { describe, it, expect } from 'vitest';
import { INPUT_METHOD, resolveActiveMethod } from './inputMethod.js';

const { KBM, GAMEPAD, TOUCH } = INPUT_METHOD;

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

// Story 7.1: TOUCH is the third method resolved by the SAME generalized rule
// (exactly one active → switch; zero or 2+ active → keep prev). Exposes INPUT_METHOD.
describe('INPUT_METHOD', () => {
  it('exposes the three input methods', () => {
    expect(INPUT_METHOD.KBM).toBe('kbm');
    expect(INPUT_METHOD.GAMEPAD).toBe('gamepad');
    expect(INPUT_METHOD.TOUCH).toBe('touch');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(INPUT_METHOD)).toBe(true);
  });
});

describe('resolveActiveMethod — 3-way sticky (Story 7.1)', () => {
  it('picks up TOUCH when only touch is active', () => {
    expect(
      resolveActiveMethod(KBM, {
        gamepadActive: false,
        kbmActive: false,
        touchActive: true,
      }),
    ).toBe(TOUCH);
  });

  it('switches away from TOUCH when exactly one other device is active (hot-swap out)', () => {
    // Touch lifted (touchActive false) and the mouse takes over → KBM.
    expect(
      resolveActiveMethod(TOUCH, {
        gamepadActive: false,
        kbmActive: true,
        touchActive: false,
      }),
    ).toBe(KBM);
    // Or the gamepad takes over → GAMEPAD.
    expect(
      resolveActiveMethod(TOUCH, {
        gamepadActive: true,
        kbmActive: false,
        touchActive: false,
      }),
    ).toBe(GAMEPAD);
  });

  it('keeps prev (sticky) when NO device is active — e.g. all fingers lifted stays TOUCH', () => {
    expect(
      resolveActiveMethod(TOUCH, {
        gamepadActive: false,
        kbmActive: false,
        touchActive: false,
      }),
    ).toBe(TOUCH);
  });

  it('keeps prev (sticky) on contention when 2+ devices are active at once', () => {
    // touch + kbm (a stray mouse move while a thumb is down) → keep prev.
    expect(
      resolveActiveMethod(TOUCH, {
        gamepadActive: false,
        kbmActive: true,
        touchActive: true,
      }),
    ).toBe(TOUCH);
    // all three active → still keep prev.
    expect(
      resolveActiveMethod(GAMEPAD, {
        gamepadActive: true,
        kbmActive: true,
        touchActive: true,
      }),
    ).toBe(GAMEPAD);
  });
});

// The generalized rule MUST stay byte-for-byte backward compatible with the old
// two-arg callers: an ABSENT touchActive (undefined) is falsy → filtered out, so
// the gamepad/kbm resolution is identical to the pre-7.1 behavior.
describe('resolveActiveMethod — backward compat with an absent touchActive', () => {
  it('gamepad-only (no touchActive key) → GAMEPAD', () => {
    expect(
      resolveActiveMethod(KBM, { gamepadActive: true, kbmActive: false }),
    ).toBe(GAMEPAD);
  });

  it('kbm-only (no touchActive key) → KBM', () => {
    expect(
      resolveActiveMethod(GAMEPAD, { gamepadActive: false, kbmActive: true }),
    ).toBe(KBM);
  });

  it('both-active (no touchActive key) → sticky prev', () => {
    expect(
      resolveActiveMethod(GAMEPAD, { gamepadActive: true, kbmActive: true }),
    ).toBe(GAMEPAD);
  });

  it('neither-active (no touchActive key) → sticky prev', () => {
    expect(
      resolveActiveMethod(KBM, { gamepadActive: false, kbmActive: false }),
    ).toBe(KBM);
  });
});
