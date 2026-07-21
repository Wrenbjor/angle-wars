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
const { MOVE_DEADZONE, AIM_DEADZONE, ARENA_WIDTH, TOUCH_STICK_MAX_RADIUS, TOUCH_BOMB_BUTTON } =
  await import('../config/constants.js');

// A left-half / right-half touch x (owns the move / aim stick respectively).
const TOUCH_LEFT_X = 200;
const TOUCH_RIGHT_X = ARENA_WIDTH - 200;

/**
 * A fake gamepad. Sticks default to centered; buttons default to none pressed;
 * `connected` defaults to true; `mapping` defaults to the W3C 'standard' id
 * (override with e.g. `mapping: ''` to model a non-standard/unidentified pad).
 * Model a real Phaser mid-play DISCONNECT by passing `connected: false` (Phaser
 * keeps the stale pad object in its array with frozen stick values rather than
 * nulling it — getPad() guards on this flag).
 */
function makePad({ ls = { x: 0, y: 0 }, rs = { x: 0, y: 0 }, buttons = [], connected = true, mapping = 'standard' } = {}) {
  return {
    connected,
    mapping,
    leftStick: ls,
    rightStick: rs,
    buttons: buttons.map((pressed) => ({ pressed })),
  };
}

/**
 * Build a sampler over fully-mocked Phaser scene objects, returning handles to
 * drive it: the InputState it writes, the fake keys, the mutable pointer, the
 * mutable pad list, and a way to fire a gamepad 'down' event.
 *
 * The gamepad mock holds a LIST of pads (mirroring Phaser's gamepads array so a
 * pad can live at a non-zero slot — DW-34): `total` is the slot count and
 * `getAll()` returns the list. Pass a single `pad` for the common case or a
 * `pads` array for multi-slot scenarios; `setPad`/`setPads` mutate the list.
 */
function makeHarness({ pad = null, pads, ship = { x: 100, y: 100 }, pointerMoveTime = 0 } = {}) {
  // The active (mouse) pointer defaults to wasTouch:false — a mouse, so the existing
  // kbm behavior is byte-identical (the isKbmActive touch-gate reads !wasTouch).
  const pointer = { moveTime: pointerMoveTime, downTime: 0, isDown: false, worldX: 0, worldY: 0, wasTouch: false, id: 1 };
  const slot = { pads: pads ?? (pad ? [pad] : []) };
  const downListeners = [];
  // Touch pointer listeners the sampler registers via scene.input.on(...).
  const pointerListeners = {};
  let keys;

  const gamepad = {
    get total() {
      return slot.pads.length;
    },
    getPad: (i) => slot.pads[i] ?? null,
    getAll: () => slot.pads.slice(),
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
      // The scene input plugin's pointer-event bus (Story 7.1 touch listeners).
      on: (evt, fn) => {
        (pointerListeners[evt] ??= []).push(fn);
      },
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
      slot.pads = p ? [p] : [];
    },
    setPads: (arr) => {
      slot.pads = arr ?? [];
    },
    setPaused: (v) => {
      scene._paused = v;
    },
    // Fire the gamepad 'down' edge. Defaults the event's pad to the first
    // connected pad (falling back to the first slot), matching how Phaser hands
    // the active pad to the listener; override with an explicit `pad`.
    fireGamepadDown: (index, downPad) =>
      downListeners.forEach((fn) =>
        fn(downPad ?? slot.pads.find((p) => p && p.connected) ?? slot.pads[0], { index }),
      ),
    // Fire a touch pointer event (Story 7.1 / 7.2). Defaults to a touch pointer
    // (wasTouch:true); pass wasTouch:false to model a mouse event the touch
    // listeners must ignore. Story 7.2 screen-anchors touch, so the sampler now
    // reads pointer.x/y (base-resolution, shake-free) rather than worldX/worldY —
    // the fake pointer carries both (equal here, since there is no camera scroll).
    firePointer: (evt, { id = 2, x = 0, y = 0, worldX = x, worldY = y, wasTouch = true } = {}) =>
      (pointerListeners[evt] ?? []).forEach((fn) =>
        fn({ id, x, y, worldX, worldY, wasTouch }),
      ),
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

describe('PlayerInputSampler pad selection (DW-34)', () => {
  it('drives input from a connected pad at a NON-ZERO slot while index 0 is disconnected', () => {
    // Phaser does not compact its gamepads array on disconnect: index 0 can be a
    // stale disconnected pad while a reconnected pad lives at index 1. getPad()
    // must select the first CONNECTED pad, not hard-pin index 0 — otherwise the
    // reassigned pad drives nothing and the player is silently unbound.
    const dead = makePad({ connected: false, rs: { x: 0.9, y: 0 } }); // stale @ index 0
    const live = makePad({ ls: { x: 0.9, y: 0 }, rs: { x: 0, y: 0.9 } }); // @ index 1
    const h = makeHarness({ pads: [dead, live], ship: { x: 100, y: 100 } });
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM); // baseline

    h.sampler.sample();

    // The index-1 pad is selected and drives both channels.
    expect(h.sampler.getPad()).toBe(live);
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD);
    expect(h.input.moveX).toBeGreaterThan(0); // left stick from the index-1 pad
    expect(h.input.aimActive).toBe(true);
    expect(h.input.aimY).toBeCloseTo(1, 6); // right stick +y from the index-1 pad
  });

  it('returns null (falls back to KBM) when every slot is disconnected', () => {
    // Present-but-disconnected pads at every slot (total>0) must still yield null
    // so the sampler defensively falls back to keyboard/mouse.
    const h = makeHarness({
      pads: [makePad({ connected: false }), makePad({ connected: false })],
      ship: { x: 100, y: 100 },
    });

    h.sampler.sample();

    expect(h.sampler.getPad()).toBeNull();
  });
});

describe('PlayerInputSampler non-standard mapping diagnostic (DW-33)', () => {
  it('warns exactly once across repeated samples for a connected non-standard pad, and the bomb still binds', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const h = makeHarness({ pad: makePad({ mapping: '' }) }); // unidentified pad

      // Repeated frames must not re-warn: the diagnostic is once per instance.
      h.sampler.sample();
      h.sampler.sample();
      h.sampler.sample();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // The bumper still queues a bomb (best-effort binding on a non-standard pad).
      h.fireGamepadDown(4);
      expect(h.input.consumeBomb()).toBe(true);
      expect(h.input.consumeBomb()).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never warns for a connected standard pad', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const h = makeHarness({ pad: makePad({ mapping: 'standard' }) });

      h.sampler.sample();
      h.sampler.sample();

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('PlayerInputSampler touch twin-stick (Story 7.1)', () => {
  const R = TOUCH_STICK_MAX_RADIUS;

  it('acquires TOUCH and drives move from the left-half floating stick', () => {
    const h = makeHarness(); // no pad, no mouse activity
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM); // baseline

    h.firePointer('pointerdown', { id: 2, x: TOUCH_LEFT_X, y: 400 });
    h.firePointer('pointermove', { id: 2, x: TOUCH_LEFT_X + R, y: 400 }); // full +x

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.TOUCH);
    expect(h.input.moveX).toBeCloseTo(1, 6); // clamped to the unit circle
    expect(h.input.moveY).toBeCloseTo(0, 6);
  });

  it('clamps a full-diagonal move deflection to the unit circle (a diagonal is not faster than a cardinal)', () => {
    // Deflect a full radius on BOTH axes → raw intent (1,1), magnitude √2. The TOUCH
    // branch must route through InputState.setMove, whose unit-circle clamp brings the
    // magnitude back to 1 (≈0.707 per axis). A regression bypassing setMove would leave
    // magnitude √2 and this fails.
    const h = makeHarness();
    h.firePointer('pointerdown', { id: 2, x: TOUCH_LEFT_X, y: 400 });
    h.firePointer('pointermove', { id: 2, x: TOUCH_LEFT_X + R, y: 400 + R });

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.TOUCH);
    expect(Math.hypot(h.input.moveX, h.input.moveY)).toBeCloseTo(1, 6);
    expect(h.input.moveX).toBeCloseTo(Math.SQRT1_2, 6); // ≈0.707
    expect(h.input.moveY).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('drives aim + auto-fire from the right-half floating stick', () => {
    const h = makeHarness();

    h.firePointer('pointerdown', { id: 3, x: TOUCH_RIGHT_X, y: 300 });
    h.firePointer('pointermove', { id: 3, x: TOUCH_RIGHT_X, y: 240 }); // deflect up

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.TOUCH);
    expect(h.input.aimActive).toBe(true);
    expect(h.input.aimX).toBeCloseTo(0, 6);
    expect(h.input.aimY).toBeCloseTo(-1, 6);
  });

  it('two thumbs move and aim independently (move + aim channels both driven)', () => {
    const h = makeHarness();

    h.firePointer('pointerdown', { id: 2, x: TOUCH_LEFT_X, y: 400 });
    h.firePointer('pointerdown', { id: 3, x: TOUCH_RIGHT_X, y: 300 });
    h.firePointer('pointermove', { id: 2, x: TOUCH_LEFT_X + R, y: 400 });
    h.firePointer('pointermove', { id: 3, x: TOUCH_RIGHT_X, y: 240 });

    h.sampler.sample();

    expect(h.input.moveX).toBeCloseTo(1, 6);
    expect(h.input.aimActive).toBe(true);
    expect(h.input.aimY).toBeCloseTo(-1, 6);
  });

  it('a bomb-button tap latches exactly one bomb through queueBomb (held: no re-latch)', () => {
    const h = makeHarness();

    h.firePointer('pointerdown', { id: 9, x: TOUCH_BOMB_BUTTON.x, y: TOUCH_BOMB_BUTTON.y });
    h.sampler.sample(); // sampleBomb routes the touch latch → queueBomb
    expect(h.input.consumeBomb()).toBe(true);

    // Finger still down, no new down edge → no re-latch on the next frame.
    h.sampler.sample();
    expect(h.input.consumeBomb()).toBe(false);

    // A tap spawns no stick: no move, no aim.
    expect(h.input.moveX).toBe(0);
    expect(h.input.aimActive).toBe(false);
  });

  it('lifting all fingers rests the ship (move 0, aim cleared) while staying sticky-TOUCH', () => {
    const h = makeHarness();

    h.firePointer('pointerdown', { id: 2, x: TOUCH_LEFT_X, y: 400 });
    h.firePointer('pointermove', { id: 2, x: TOUCH_LEFT_X + R, y: 400 });
    h.firePointer('pointerdown', { id: 3, x: TOUCH_RIGHT_X, y: 300 });
    h.firePointer('pointermove', { id: 3, x: TOUCH_RIGHT_X, y: 240 });
    h.sampler.sample();
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.TOUCH);

    // All fingers lifted (one via pointerupoutside — a release off-canvas).
    h.firePointer('pointerup', { id: 2 });
    h.firePointer('pointerupoutside', { id: 3 });
    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.TOUCH); // sticky (zero devices active)
    expect(h.input.moveX).toBe(0);
    expect(h.input.moveY).toBe(0);
    expect(h.input.aimActive).toBe(false);
    expect(h.sampler.isTouchActive()).toBe(false);
  });

  it('hot-swaps TOUCH → KBM on a real mouse move, with no leftover touch aim', () => {
    const h = makeHarness({ ship: { x: 100, y: 100 } });

    // Establish TOUCH with an aimed stick.
    h.firePointer('pointerdown', { id: 3, x: TOUCH_RIGHT_X, y: 300 });
    h.firePointer('pointermove', { id: 3, x: TOUCH_RIGHT_X, y: 240 });
    h.sampler.sample();
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.TOUCH);

    // Lift the thumb, then a genuine mouse move (activePointer is a mouse).
    h.firePointer('pointerup', { id: 3 });
    h.pointer.moveTime = 1000; // wasTouch stays false (mouse)
    h.pointer.worldX = 100;
    h.pointer.worldY = 200;

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM);
    expect(h.input.aimActive).toBe(true); // mouse re-acquired aim
    expect(h.input.aimX).toBeCloseTo(0, 6);
    expect(h.input.aimY).toBeCloseTo(1, 6); // ship(100,100) → cursor(100,200)
  });

  it('a thumb never registers as the mouse: a touch-typed activePointer move does not flip a resting GAMEPAD to KBM', () => {
    // isKbmActive must gate its pointer-move/down signals on !wasTouch. Model a
    // touch that also became the activePointer (wasTouch:true) with a fresh moveTime
    // and a held press: neither may count as kbm activity, so a resting GAMEPAD
    // (sticks centered → gamepadActive false) stays sticky-GAMEPAD rather than being
    // hijacked to KBM by the thumb.
    const h = makeHarness({ pad: makePad({ ls: { x: 0, y: 0 }, rs: { x: 0, y: 0 } }) });
    h.sampler.activeMethod = INPUT_METHOD.GAMEPAD;
    h.pointer.wasTouch = true; // the active pointer's last event was a touch
    h.pointer.moveTime = 500; // a fresh move…
    h.pointer.isDown = true; // …and held down

    h.sampler.sample();

    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.GAMEPAD); // no false KBM flip
  });

  it('resetTouch drops a held stick so it does not strand (drifting move) after a pause', () => {
    const h = makeHarness();
    h.firePointer('pointerdown', { id: 2, x: TOUCH_LEFT_X, y: 400 });
    h.firePointer('pointermove', { id: 2, x: TOUCH_LEFT_X + R, y: 400 });
    h.sampler.sample();
    expect(h.input.moveX).toBeCloseTo(1, 6); // stick driving the ship

    // Entering pause reconciles held touch state (the listeners freeze, so a finger
    // lifted during pause would otherwise never release the stick).
    h.sampler.resetTouch();
    expect(h.sampler.isTouchActive()).toBe(false);

    // On resume, the next sample rests the ship (sticky-TOUCH, no held stick).
    h.sampler.sample();
    expect(h.input.moveX).toBe(0);
    expect(h.input.moveY).toBe(0);
  });

  it('respects the pause freeze: a bomb tap while paused latches nothing', () => {
    const h = makeHarness();

    h.setPaused(true);
    h.firePointer('pointerdown', { id: 9, x: TOUCH_BOMB_BUTTON.x, y: TOUCH_BOMB_BUTTON.y });
    h.setPaused(false);
    h.sampler.sample();
    expect(h.input.consumeBomb()).toBe(false); // nothing latched while paused

    // Unpaused, the same tap latches normally (parity with the gamepad bomb freeze).
    h.firePointer('pointerdown', { id: 9, x: TOUCH_BOMB_BUTTON.x, y: TOUCH_BOMB_BUTTON.y });
    h.sampler.sample();
    expect(h.input.consumeBomb()).toBe(true);
  });

  it('ignores mouse pointer events (wasTouch:false) so a click never spawns a touch stick', () => {
    const h = makeHarness();

    // A mouse-typed pointerdown/move in the left half must NOT feed the touch model.
    h.firePointer('pointerdown', { id: 1, x: TOUCH_LEFT_X, y: 400, wasTouch: false });
    h.firePointer('pointermove', { id: 1, x: TOUCH_LEFT_X + R, y: 400, wasTouch: false });

    expect(h.sampler.isTouchActive()).toBe(false);
    h.sampler.sample();
    expect(h.sampler.activeMethod).toBe(INPUT_METHOD.KBM); // never became TOUCH
  });

  it('exposes the touch render snapshot for the overlay', () => {
    const h = makeHarness();
    h.firePointer('pointerdown', { id: 2, x: TOUCH_LEFT_X, y: 400 });
    h.firePointer('pointermove', { id: 2, x: TOUCH_LEFT_X + 30, y: 410 });

    const snap = h.sampler.touchSnapshot();
    expect(snap.move.active).toBe(true);
    expect(snap.move.baseX).toBe(TOUCH_LEFT_X);
    expect(snap.move.curX).toBe(TOUCH_LEFT_X + 30);
  });
});

describe('PlayerInputSampler touch screen-anchoring + bomb rect (Story 7.2)', () => {
  const R = TOUCH_STICK_MAX_RADIUS;

  it('feeds the touch model pointer.x/y (screen space), NOT worldX/worldY (shake-affected)', () => {
    // Model a camera shake: pointer.x/y (base-resolution) stay at the stick while
    // worldX/worldY are offset by the shake scroll. The stick base + deflection must
    // derive from x/y only — otherwise the shake would double-count and drift the aim.
    const h = makeHarness();
    h.firePointer('pointerdown', {
      id: 2,
      x: TOUCH_LEFT_X,
      y: 400,
      worldX: TOUCH_LEFT_X + 500, // wildly different world coords (shake)
      worldY: 400 + 500,
    });
    h.firePointer('pointermove', {
      id: 2,
      x: TOUCH_LEFT_X + R, // one full radius +x in SCREEN space
      y: 400,
      worldX: TOUCH_LEFT_X + R + 500,
      worldY: 400 + 500,
    });

    h.sampler.sample();

    // Base (screen) TOUCH_LEFT_X, current TOUCH_LEFT_X + R → deflection exactly +R → move +1.
    expect(h.input.moveX).toBeCloseTo(1, 6);
    expect(h.input.moveY).toBeCloseTo(0, 6);
    // The snapshot base is the screen-space touch point, not the world one.
    expect(h.sampler.touchSnapshot().move.baseX).toBe(TOUCH_LEFT_X);
  });

  it('setBombButton passthrough moves the tap target: new center latches, old center does not', () => {
    const h = makeHarness();
    const nx = TOUCH_BOMB_BUTTON.x;
    const ny = TOUCH_BOMB_BUTTON.y - (TOUCH_BOMB_BUTTON.radius + 20); // raised clear of the old center

    h.sampler.setBombButton(nx, ny, TOUCH_BOMB_BUTTON.radius);

    // A tap at the OLD center no longer latches (outside the moved hit region).
    h.firePointer('pointerdown', { id: 9, x: TOUCH_BOMB_BUTTON.x, y: TOUCH_BOMB_BUTTON.y });
    h.sampler.sample();
    expect(h.input.consumeBomb()).toBe(false);

    // A tap at the NEW center latches exactly one bomb through queueBomb.
    h.firePointer('pointerdown', { id: 10, x: nx, y: ny });
    h.sampler.sample();
    expect(h.input.consumeBomb()).toBe(true);
    // And the overlay snapshot reflects the shifted rect.
    expect(h.sampler.touchSnapshot().bomb.y).toBe(ny);
  });
});
