import { describe, it, expect, vi } from 'vitest';

// PlayerInputSampler is the thin Phaser boundary, but its decision logic (active
// -method gating, the centered-stick clearAim bleed-fix, the disconnect fix, and
// the gamepad-bomb listener) is testable headlessly: scene.input.* is mockable
// and InputState is Phaser-free. We mock the tiny Phaser surface the sampler
// touches (KeyCodes for addKeys, JustDown for the keyboard bomb — which we do
// not exercise here, so it always reports false).
vi.mock('phaser', () => ({
  default: {
    Input: {
      Keyboard: {
        KeyCodes: {
          W: 'W', S: 'S', A: 'A', D: 'D',
          UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT',
          SHIFT: 'SHIFT',
        },
        JustDown: () => false,
      },
    },
  },
}));

const { PlayerInputSampler } = await import('./PlayerInputSampler.js');
const { InputState } = await import('./InputState.js');
const { INPUT_METHOD } = await import('./inputMethod.js');
const { MOVE_DEADZONE, AIM_DEADZONE } = await import('../config/constants.js');

/**
 * A fake gamepad. Sticks default to centered; buttons default to none pressed;
 * `connected` defaults to true. Model a real Phaser mid-play DISCONNECT by
 * passing `connected: false` (Phaser keeps the stale pad object in its array with
 * frozen stick values rather than nulling it — getPad() guards on this flag).
 */
function makePad({ ls = { x: 0, y: 0 }, rs = { x: 0, y: 0 }, buttons = [], connected = true } = {}) {
  return {
    connected,
    leftStick: ls,
    rightStick: rs,
    buttons: buttons.map((pressed) => ({ pressed })),
  };
}

/**
 * Build a sampler over fully-mocked Phaser scene objects, returning handles to
 * drive it: the InputState it writes, the fake keys, the mutable pointer, the
 * mutable pad slot, and a way to fire a gamepad 'down' event.
 */
function makeHarness({ pad = null, ship = { x: 100, y: 100 }, pointerMoveTime = 0 } = {}) {
  const pointer = { moveTime: pointerMoveTime, downTime: 0, isDown: false, worldX: 0, worldY: 0 };
  const slot = { pad };
  const downListeners = [];
  let keys;

  const gamepad = {
    get total() {
      return slot.pad ? 1 : 0;
    },
    getPad: () => slot.pad,
    on: (evt, fn) => {
      if (evt === 'down') downListeners.push(fn);
    },
  };

  const scene = {
    _paused: false,
    input: {
      activePointer: pointer,
      keyboard: {
        addKeys: (config) => {
          keys = {};
          for (const name of Object.keys(config)) keys[name] = { isDown: false };
          return keys;
        },
      },
      gamepad,
    },
  };

  const input = new InputState();
  const sampler = new PlayerInputSampler(scene, input, ship);

  return {
    sampler,
    input,
    pointer,
    ship,
    keys,
    setPad: (p) => {
      slot.pad = p;
    },
    setPaused: (v) => {
      scene._paused = v;
    },
    fireGamepadDown: (index) =>
      downListeners.forEach((fn) => fn(slot.pad, { index })),
  };
}

describe('PlayerInputSampler active-method gating', () => {
  it('(a) on GAMEPAD, a resting left stick yields zero move with NO keyboard leak', () => {
    // Right stick pushed keeps the gamepad the active device even though a key
    // reports down (both-active → sticky GAMEPAD); the left stick rests.
    const h = makeHarness({ pad: makePad({ ls: { x: 0, y: 0 }, rs: { x: 0.9, y: 0 } }) });
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;
    h.keys.left.isDown = true; // keyboard says "move left" — must be ignored
    h.keys.up.isDown = true;

    h.sampler.sample();

    expect(h.input.moveX).toBe(0);
    expect(h.input.moveY).toBe(0);
  });

  it('(b) on GAMEPAD, a centered right stick clears aim (does NOT snap to the mouse)', () => {
    // Left stick pushed keeps GAMEPAD active; the right stick is centered while
    // the mouse sits at a stale far-away position.
    const h = makeHarness({ pad: makePad({ ls: { x: 0.9, y: 0 }, rs: { x: 0, y: 0 } }) });
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;
    h.pointer.moveTime = 500; // mouse was engaged at some earlier point
    h.pointer.worldX = 999;
    h.pointer.worldY = 999;

    h.sampler.sample();

    expect(h.input.aimActive).toBe(false);
    expect(h.input.aimX).toBe(0);
    expect(h.input.aimY).toBe(0);
  });

  it('(c) hot-swaps KBM → GAMEPAD on stick activity, then back to KBM on a mouse move', () => {
    const h = makeHarness({
      pad: makePad({ ls: { x: 0.9, y: 0 }, rs: { x: 0, y: 0.9 } }),
      ship: { x: 100, y: 100 },
    });
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM); // baseline

    // Gamepad-only activity → flip to GAMEPAD; move from left stick, aim from right.
    h.sampler.sample();
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD);
    expect(h.input.moveX).toBeGreaterThan(0);
    expect(h.input.aimActive).toBe(true);
    expect(h.input.aimY).toBeCloseTo(1, 6); // right stick pointed +y

    // Now rest the sticks and move the mouse → flip back to KBM; mouse aims.
    h.setPad(makePad({ ls: { x: 0, y: 0 }, rs: { x: 0, y: 0 } }));
    h.pointer.moveTime = 1000; // a real mouse move this frame
    h.pointer.worldX = 100; // straight below the ship at (100,100)
    h.pointer.worldY = 200;

    h.sampler.sample();
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM);
    expect(h.input.aimActive).toBe(true);
    expect(h.input.aimX).toBeCloseTo(0, 6);
    expect(h.input.aimY).toBeCloseTo(1, 6); // ship(100,100) → cursor(100,200)
  });

  it('(d) on gamepad disconnect while sticky-GAMEPAD, aim clears (no stale-cursor snap)', () => {
    // No pad, but the method is still sticky GAMEPAD and the mouse was engaged
    // earlier (moveTime already accounted for, so no new pointer-move this frame).
    const h = makeHarness({ pad: null, ship: { x: 100, y: 100 } });
    h.pointer.moveTime = 500;
    h.pointer.worldX = 999;
    h.pointer.worldY = 999;
    h.sampler._lastPointerMoveTime = 500; // no fresh mouse move
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD); // sticky, no new input
    expect(h.input.aimActive).toBe(false); // cleared, NOT snapped to (999,999)
  });

  it('(f) the per-channel deadzone split is wired at the sampler: a stick between MOVE and AIM deadzone moves but does not aim', () => {
    // Probe magnitude derived from the constants (not hardcoded), so a re-tune of
    // either deadzone cannot break this behavioral assertion. This guards the
    // headline AC at the SAMPLER surface (inputMath.test.js only proves it for
    // applyRadialDeadzone with explicit args): if sampleAim regressed to
    // MOVE_DEADZONE, or the two constants were swapped, a brushed right stick
    // would rotate aim — the exact bug this story fixes — and this test fails.
    const probe = (MOVE_DEADZONE + AIM_DEADZONE) / 2;
    const h = makeHarness({ pad: makePad({ ls: { x: probe, y: 0 }, rs: { x: probe, y: 0 } }) });
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;

    h.sampler.sample();

    expect(h.input.moveX).toBeGreaterThan(0); // left stick past MOVE_DEADZONE → moves
    expect(h.input.aimActive).toBe(false); // right stick within AIM_DEADZONE → no aim
  });

  it('(g) seeds _lastPointerMoveTime from the LIVE pointer so a pre-existing moveTime is not misread as a fresh mouse move', () => {
    // Pointer already carries a moveTime (mouse used before a scene restart).
    // Seeding from the live pointer (not 0) means the first sample with
    // gamepad-only activity is NOT hijacked to KBM by that stale timestamp.
    const h = makeHarness({
      pad: makePad({ ls: { x: 0.9, y: 0 }, rs: { x: 0, y: 0.9 } }),
      pointerMoveTime: 500,
    });
    expect(h.sampler._lastPointerMoveTime).toBe(500); // seeded from live pointer, not 0

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD); // no false KBM flip
  });

  it('(h) a held bomb bumper counts as gamepad activity (resolves method to GAMEPAD with resting sticks)', () => {
    // Sticks resting, but the left bumper (index 4) is held → isGamepadActive
    // must be true so the pad takes/keeps ownership while bombing.
    const h = makeHarness({ pad: makePad({ buttons: [false, false, false, false, true] }) });
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM); // baseline

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD);
  });

  it('(j) a real mid-play disconnect (stale pad, connected:false) clears aim and does NOT lock into GAMEPAD', () => {
    // Phaser does not null a disconnected pad — it leaves the stale object in its
    // array with FROZEN stick values. Here the pad is still "present" (total>0)
    // with its right stick frozen deflected, but connected:false. getPad() must
    // treat it as no-pad: sampleAim clears (no snap to the stale mouse cursor),
    // AND isGamepadActive is false so the frozen stick can't pin sticky-GAMEPAD —
    // a subsequent mouse move recovers to KBM instead of locking the player.
    const h = makeHarness({ pad: null, ship: { x: 100, y: 100 } });
    h.pointer.moveTime = 500;
    h.pointer.worldX = 999;
    h.pointer.worldY = 999;
    h.sampler._lastPointerMoveTime = 500; // no fresh mouse move
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;
    // Disconnected pad retained with a deflected right stick (the dangerous case).
    h.setPad(makePad({ rs: { x: 0.9, y: 0 }, connected: false }));

    h.sampler.sample();

    expect(h.input.aimActive).toBe(false); // cleared, NOT snapped to (999,999)

    // A real mouse move now recovers to KBM (the frozen stick did not veto it).
    h.pointer.moveTime = 1000;
    h.pointer.worldX = 100;
    h.pointer.worldY = 200;
    h.sampler.sample();
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM);
    expect(h.input.aimActive).toBe(true); // mouse re-acquired aim
  });

  it('(k) aiming with ONLY the right stick (left resting) acquires GAMEPAD from the KBM baseline', () => {
    // Guards the isGamepadActive right-stick branch as the SOLE trigger: a
    // stationary twin-stick player who only pushes the right stick to aim/fire
    // must take gamepad ownership. Other tests always co-push the left stick or
    // pre-set the method, so a regression in this branch would otherwise ship green.
    const h = makeHarness({
      pad: makePad({ ls: { x: 0, y: 0 }, rs: { x: 0, y: 0.9 } }),
      ship: { x: 100, y: 100 },
    });
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM); // baseline

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD);
    expect(h.input.aimActive).toBe(true);
    expect(h.input.aimY).toBeCloseTo(1, 6);
  });

  it('(l) pressing a movement key (no mouse move) flips a resting GAMEPAD back to KBM', () => {
    // Guards the isKbmActive keyDown branch as the KBM-acquisition source: the
    // GAMEPAD→KBM flip is elsewhere only ever driven by pointer movement, so a
    // regression dropping the keyDown term would leave a player who sets the pad
    // down and switches to WASD stuck in sticky-GAMEPAD with dead controls.
    const h = makeHarness({ pad: makePad({ ls: { x: 0, y: 0 }, rs: { x: 0, y: 0 } }) });
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;
    h.keys.left.isDown = true; // WASD move, no mouse activity

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM);
    expect(h.input.moveX).toBeLessThan(0); // keyboard branch drives the move
  });

  it('(m) a held pointer button (no mouse move) flips a resting GAMEPAD back to KBM', () => {
    // Guards the isKbmActive p.isDown branch as the KBM-acquisition source.
    const h = makeHarness({ pad: makePad({ ls: { x: 0, y: 0 }, rs: { x: 0, y: 0 } }) });
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;
    h.pointer.isDown = true; // mouse button held, no moveTime change

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM);
  });
});

describe('PlayerInputSampler gamepad bomb listener', () => {
  it('(e) a bumper press queues exactly one bomb; a face button queues none', () => {
    const h = makeHarness({ pad: makePad() });

    // Left bumper (index 4) → one queued bomb, consumed once.
    h.fireGamepadDown(4);
    expect(h.input.consumeBomb()).toBe(true);
    expect(h.input.consumeBomb()).toBe(false);

    // Face button (index 0) → nothing queued.
    h.fireGamepadDown(0);
    expect(h.input.consumeBomb()).toBe(false);

    // Right bumper (index 5) → also queues a bomb.
    h.fireGamepadDown(5);
    expect(h.input.consumeBomb()).toBe(true);
    expect(h.input.consumeBomb()).toBe(false);
  });

  it('(i) a bumper press while paused queues no bomb (respects the pause freeze)', () => {
    // Story 5.2 pause freezes sample() (so the keyboard bomb is frozen); the
    // async gamepad listener must honor the same freeze, or a bumper tapped
    // while paused would detonate on resume — asymmetric with Shift and wasteful.
    const h = makeHarness({ pad: makePad() });

    h.setPaused(true);
    h.fireGamepadDown(4); // left bumper while paused → nothing latched
    expect(h.input.consumeBomb()).toBe(false);

    // Unpaused, the same press latches normally (parity restored).
    h.setPaused(false);
    h.fireGamepadDown(4);
    expect(h.input.consumeBomb()).toBe(true);
    expect(h.input.consumeBomb()).toBe(false);
  });
});
