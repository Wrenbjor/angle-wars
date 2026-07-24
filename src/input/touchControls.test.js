import { describe, it, expect } from 'vitest';
import { TouchControls } from './touchControls.js';
import {
  ARENA_WIDTH,
  TOUCH_STICK_MAX_RADIUS,
  TOUCH_STICK_DEADZONE,
  TOUCH_BOMB_BUTTON,
  TOUCH_DASH_BUTTON,
} from '../config/constants.js';

// TouchControls is the Phaser-free floating twin-stick + bomb model. It is driven
// by pointer id/down/move/up in arena logical space and exposes raw move/aim vectors
// (InputState.setMove/setAim do the clamp/normalize downstream), a one-tap bomb
// latch, an is-active flag, and a render snapshot. These tests cover every row of the
// spec's I/O & edge-case matrix, deriving coordinates from the centralized constants
// so a re-tune of the radius/deadzone/geometry cannot silently break the assertions.

// A left-half point (owns the move stick) and a right-half point (owns the aim
// stick), both well clear of the bomb button so classification is unambiguous.
const LEFT_X = 200;
const RIGHT_X = 900;
const R = TOUCH_STICK_MAX_RADIUS;

describe('TouchControls — move stick (left half)', () => {
  it('drag: deflection / MAX_RADIUS drives move intent (row: move stick drag)', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400); // base at first touch
    t.onPointerMove(1, LEFT_X + R, 400); // deflect one full radius +x

    const m = t.moveVector();
    expect(m.x).toBeCloseTo(1, 6); // moveX ≈ 1
    expect(m.y).toBeCloseTo(0, 6); // moveY ≈ 0
  });

  it('half a radius of deflection is half intent (proportional)', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400);
    t.onPointerMove(1, LEFT_X, 400 + R / 2); // deflect +y half a radius

    const m = t.moveVector();
    expect(m.x).toBeCloseTo(0, 6);
    expect(m.y).toBeCloseTo(0.5, 6);
  });

  it('a deflection within the origin deadzone yields zero intent (no drift)', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400);
    t.onPointerMove(1, LEFT_X + TOUCH_STICK_DEADZONE - 1, 400); // inside deadzone

    const m = t.moveVector();
    expect(m.x).toBe(0);
    expect(m.y).toBe(0);
  });

  it('no move stick held → zero intent', () => {
    const t = new TouchControls();
    const m = t.moveVector();
    expect(m.x).toBe(0);
    expect(m.y).toBe(0);
  });
});

describe('TouchControls — aim stick (right half)', () => {
  it('drag up: unit deflection direction, aim active (row: aim stick drag up)', () => {
    const t = new TouchControls();
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X, 240); // 60px up

    const a = t.aimVector();
    expect(a.active).toBe(true);
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.y).toBeCloseTo(-1, 6); // straight up
  });

  it('held, thumb returns to center: retains last non-zero dir, stays active (row: aim held)', () => {
    const t = new TouchControls();
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X, 240); // deflect up → dir (0,-1)
    t.onPointerMove(2, RIGHT_X, 300); // thumb back to base (deflection 0)

    const a = t.aimVector();
    expect(a.active).toBe(true); // still firing while held
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.y).toBeCloseTo(-1, 6); // retained last non-zero direction
  });

  it('pressed, never deflected: inactive (row: aim pressed, never deflected)', () => {
    const t = new TouchControls();
    t.onPointerDown(2, RIGHT_X, 300); // held, no movement

    const a = t.aimVector();
    expect(a.active).toBe(false); // no firing in an undefined direction
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
  });

  it('a sub-deadzone jitter before any real deflection does not activate aim', () => {
    const t = new TouchControls();
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X + 1, 300); // 1px < deadzone

    expect(t.aimVector().active).toBe(false);
  });

  it('re-aims to the newest direction as the thumb sweeps past the deadzone', () => {
    const t = new TouchControls();
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X, 240); // up → (0,-1)
    t.onPointerMove(2, RIGHT_X + 60, 300); // right → (1,0)

    const a = t.aimVector();
    expect(a.x).toBeCloseTo(1, 6);
    expect(a.y).toBeCloseTo(0, 6);
  });
});

describe('TouchControls — smart-bomb button', () => {
  const BX = TOUCH_BOMB_BUTTON.x;
  const BY = TOUCH_BOMB_BUTTON.y;

  it('tap held: exactly ONE latch per tap, no re-latch while held, no stick (row: bomb button tap held)', () => {
    const t = new TouchControls();
    t.onPointerDown(9, BX, BY); // down inside the button
    // Held many frames (no re-latch): consume once → true, then false.
    expect(t.consumeBomb()).toBe(true);
    expect(t.consumeBomb()).toBe(false);
    expect(t.consumeBomb()).toBe(false);
    // No aim stick spawned even though the button sits in the right half zone.
    expect(t.aimVector().active).toBe(false);
    expect(t.moveVector().x).toBe(0);
    // The finger still down reads as touch-active + pressed in the snapshot.
    expect(t.isActive()).toBe(true);
    expect(t.snapshot().bomb.pressed).toBe(true);
  });

  it('releasing the bomb finger clears pressed + touch-active', () => {
    const t = new TouchControls();
    t.onPointerDown(9, BX, BY);
    t.consumeBomb();
    t.onPointerUp(9);
    expect(t.isActive()).toBe(false);
    expect(t.snapshot().bomb.pressed).toBe(false);
  });

  it('bomb-rect classification wins over the left/right half split', () => {
    // The button center is at ARENA_WIDTH/2; a down there must latch a bomb, not
    // spawn a stick, regardless of which half the exact pixel falls in.
    const t = new TouchControls();
    t.onPointerDown(9, BX, BY);
    expect(t.consumeBomb()).toBe(true);
    expect(t.moveVector().x).toBe(0);
    expect(t.aimVector().active).toBe(false);
  });

  it('no tap → nothing latched', () => {
    const t = new TouchControls();
    expect(t.consumeBomb()).toBe(false);
  });
});

describe('TouchControls — multi-touch + release', () => {
  it('two thumbs resolve independently from their own pointers (row: two thumbs at once)', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400); // move pointer A, left half
    t.onPointerDown(2, RIGHT_X, 300); // aim pointer B, right half
    t.onPointerMove(1, LEFT_X + R, 400); // A deflects +x
    t.onPointerMove(2, RIGHT_X, 240); // B deflects up

    const m = t.moveVector();
    const a = t.aimVector();
    expect(m.x).toBeCloseTo(1, 6);
    expect(m.y).toBeCloseTo(0, 6);
    expect(a.active).toBe(true);
    expect(a.y).toBeCloseTo(-1, 6);

    // Moving A does not disturb B's aim and vice-versa.
    t.onPointerMove(1, LEFT_X, 400 + R); // A now +y
    expect(t.moveVector().y).toBeCloseTo(1, 6);
    expect(t.aimVector().y).toBeCloseTo(-1, 6); // B unchanged
  });

  it('all fingers lifted: move zero, aim inactive, not active (row: all fingers lifted)', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400);
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(1, LEFT_X + R, 400);
    t.onPointerMove(2, RIGHT_X, 240);

    t.onPointerUp(1);
    t.onPointerUp(2);

    expect(t.moveVector().x).toBe(0);
    expect(t.moveVector().y).toBe(0);
    expect(t.aimVector().active).toBe(false);
    expect(t.isActive()).toBe(false);
  });

  it('lifting one thumb leaves the other stick intact', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400);
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X, 240);

    t.onPointerUp(1); // release move only

    expect(t.moveVector().x).toBe(0);
    expect(t.aimVector().active).toBe(true); // aim stick still held
    expect(t.isActive()).toBe(true);
  });

  it('a second finger on an already-owned half is ignored (first-touch anchors the stick)', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400); // owns the move stick, base (200,400)
    t.onPointerDown(3, LEFT_X + 300, 400); // a second left-half touch — ignored
    // Moving the SECOND pointer must not move the stick (it isn't the owner).
    t.onPointerMove(3, LEFT_X + 300 + R, 400);
    expect(t.moveVector().x).toBe(0);
    // The owner still drives it.
    t.onPointerMove(1, LEFT_X + R, 400);
    expect(t.moveVector().x).toBeCloseTo(1, 6);
  });

  it('classifies by half: left → move, right → aim', () => {
    const t = new TouchControls();
    t.onPointerDown(1, ARENA_WIDTH / 2 - 1, 400); // just left of center
    t.onPointerDown(2, ARENA_WIDTH / 2 + 1, 400); // just right of center (clear of bomb Y)
    t.onPointerMove(1, ARENA_WIDTH / 2 - 1 - R, 400);
    t.onPointerMove(2, ARENA_WIDTH / 2 + 1 + R, 400);
    expect(t.moveVector().x).toBeCloseTo(-1, 6); // left stick deflected -x
    expect(t.aimVector().active).toBe(true); // right stick aimed
    expect(t.aimVector().x).toBeCloseTo(1, 6);
  });
});

describe('TouchControls — reset (pause reconciliation)', () => {
  it('drops both sticks and the bomb latch so nothing strands or detonates', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400);
    t.onPointerMove(1, LEFT_X + R, 400); // move stick deflected
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X, 240); // aim stick deflected
    t.onPointerDown(9, TOUCH_BOMB_BUTTON.x, TOUCH_BOMB_BUTTON.y); // bomb latched + held
    expect(t.isActive()).toBe(true);

    t.reset();

    expect(t.moveVector().x).toBe(0);
    expect(t.moveVector().y).toBe(0);
    expect(t.aimVector().active).toBe(false);
    expect(t.isActive()).toBe(false);
    expect(t.consumeBomb()).toBe(false); // the pause-edge latch is dropped, not fired
  });
});

describe('TouchControls — setBombButton (Story 7.2 safe-area shift)', () => {
  it('row: moving the bomb rect shifts BOTH the hit region and the snapshot together', () => {
    const t = new TouchControls();
    const nx = TOUCH_BOMB_BUTTON.x;
    const ny = TOUCH_BOMB_BUTTON.y - 21; // raised by a bottom home-indicator inset
    t.setBombButton(nx, ny, TOUCH_BOMB_BUTTON.radius);

    // A tap at the NEW center latches a bomb…
    t.onPointerDown(9, nx, ny);
    expect(t.consumeBomb()).toBe(true);
    // …and the snapshot reflects the new center + radius.
    const s = t.snapshot();
    expect(s.bomb.x).toBe(nx);
    expect(s.bomb.y).toBe(ny);
    expect(s.bomb.radius).toBe(TOUCH_BOMB_BUTTON.radius);
  });

  it('a tap at the PRE-shift center no longer latches once the rect moves off it', () => {
    const t = new TouchControls();
    // Shift the button far enough that the old center is outside the new radius.
    t.setBombButton(
      TOUCH_BOMB_BUTTON.x,
      TOUCH_BOMB_BUTTON.y - (TOUCH_BOMB_BUTTON.radius + 20),
      TOUCH_BOMB_BUTTON.radius,
    );
    // Tap at the ORIGINAL center: no longer inside the moved hit region → no latch.
    t.onPointerDown(9, TOUCH_BOMB_BUTTON.x, TOUCH_BOMB_BUTTON.y);
    expect(t.consumeBomb()).toBe(false);
  });

  it('defaults the radius to the current value when omitted', () => {
    const t = new TouchControls();
    t.setBombButton(300, 300); // radius omitted → keeps TOUCH_BOMB_BUTTON.radius
    expect(t.snapshot().bomb.radius).toBe(TOUCH_BOMB_BUTTON.radius);
    // The hit region is centered on the new point at the retained radius.
    t.onPointerDown(9, 300, 300 + TOUCH_BOMB_BUTTON.radius - 1); // just inside
    expect(t.consumeBomb()).toBe(true);
  });
});

describe('TouchControls — snapshot', () => {
  it('reports each active stick base + current point and the bomb rect', () => {
    const t = new TouchControls();
    t.onPointerDown(1, LEFT_X, 400);
    t.onPointerMove(1, LEFT_X + 30, 410);
    t.onPointerDown(2, RIGHT_X, 300);
    t.onPointerMove(2, RIGHT_X - 20, 260);

    const s = t.snapshot();
    expect(s.move.active).toBe(true);
    expect(s.move.baseX).toBe(LEFT_X);
    expect(s.move.baseY).toBe(400);
    expect(s.move.curX).toBe(LEFT_X + 30);
    expect(s.move.curY).toBe(410);
    expect(s.aim.active).toBe(true);
    expect(s.aim.baseX).toBe(RIGHT_X);
    expect(s.aim.curX).toBe(RIGHT_X - 20);
    expect(s.bomb.x).toBe(TOUCH_BOMB_BUTTON.x);
    expect(s.bomb.y).toBe(TOUCH_BOMB_BUTTON.y);
    expect(s.bomb.radius).toBe(TOUCH_BOMB_BUTTON.radius);
    expect(s.bomb.pressed).toBe(false);
  });

  it('inactive sticks report active:false', () => {
    const t = new TouchControls();
    const s = t.snapshot();
    expect(s.move.active).toBe(false);
    expect(s.aim.active).toBe(false);
  });

  it('returns the same persistent object each call (zero per-frame allocation)', () => {
    const t = new TouchControls();
    expect(t.snapshot()).toBe(t.snapshot());
    // moveVector / aimVector likewise reuse a persistent object.
    expect(t.moveVector()).toBe(t.moveVector());
    expect(t.aimVector()).toBe(t.aimVector());
  });
});

// --- Afterburner dash button (Story 10.5) ------------------------------------
// The dash mirrors the bomb's plumbing exactly, PLUS an OWNERSHIP GATE the bomb does
// not need: the bomb is always available, the dash is a purchased capability. While the
// gate is closed the button does not exist as far as the player is concerned.
const DASH_X = TOUCH_DASH_BUTTON.x;
const DASH_Y = TOUCH_DASH_BUTTON.y;

/** A TouchControls with the dash OWNED (what Afterburner Lv2+ produces). */
function ownedDash() {
  const t = new TouchControls();
  t.setDashEnabled(true);
  return t;
}

describe('TouchControls — the dash button ownership gate', () => {
  it('defaults to CLOSED: a tap in the dash region spawns an ordinary aim stick', () => {
    const t = new TouchControls();
    t.onPointerDown(1, DASH_X, DASH_Y);
    // Pre-10.5 behavior exactly: the full right half is aim area again.
    expect(t.snapshot().aim.active).toBe(true);
    expect(t.consumeDash()).toBe(false);
    expect(t.isActive()).toBe(true); // …because of the STICK, not the dash
  });

  it('publishes enabled:false in the snapshot so the overlay skips drawing it', () => {
    const t = new TouchControls();
    expect(t.snapshot().dash.enabled).toBe(false);
    t.setDashEnabled(true);
    expect(t.snapshot().dash.enabled).toBe(true);
  });

  it('opening the gate restores EVERY dash behavior', () => {
    const t = ownedDash();
    t.onPointerDown(1, DASH_X, DASH_Y);
    expect(t.snapshot().aim.active).toBe(false); // no stick spawned
    expect(t.snapshot().dash.pressed).toBe(true);
    expect(t.isActive()).toBe(true);
    expect(t.consumeDash()).toBe(true);
  });

  it('closing the gate with a latch PENDING clears it (no stale press fires later)', () => {
    const t = ownedDash();
    t.onPointerDown(1, DASH_X, DASH_Y);
    t.setDashEnabled(false);
    expect(t.consumeDash()).toBe(false);
    expect(t.snapshot().dash.pressed).toBe(false);
    expect(t.isActive()).toBe(false);
  });

  it('while CLOSED, isActive() ignores the dash entirely', () => {
    const t = new TouchControls();
    // Force the internal owner id as a paranoid check that the gate, not just the
    // hit test, is what keeps isActive() honest.
    t._dashPointerId = 9;
    expect(t.isActive()).toBe(false);
  });
});

describe('TouchControls — dash button (owned)', () => {
  it('a tap inside the rect latches ONE dash and spawns no stick', () => {
    const t = ownedDash();
    t.onPointerDown(1, DASH_X, DASH_Y);
    expect(t.moveVector()).toEqual({ x: 0, y: 0 });
    expect(t.aimVector().active).toBe(false);
    expect(t.consumeDash()).toBe(true);
  });

  it('consumeDash reads-and-clears (one tap can never dash twice)', () => {
    const t = ownedDash();
    t.onPointerDown(1, DASH_X, DASH_Y);
    expect(t.consumeDash()).toBe(true);
    expect(t.consumeDash()).toBe(false);
  });

  it('a point just OUTSIDE the rim spawns an aim stick instead', () => {
    const t = ownedDash();
    t.onPointerDown(1, DASH_X + TOUCH_DASH_BUTTON.radius + 1, DASH_Y);
    expect(t.consumeDash()).toBe(false);
    expect(t.snapshot().aim.active).toBe(true);
  });

  it('the pressed flag clears when that finger lifts, and stays independent of the bomb', () => {
    const t = ownedDash();
    t.onPointerDown(1, TOUCH_BOMB_BUTTON.x, TOUCH_BOMB_BUTTON.y);
    t.onPointerDown(2, DASH_X, DASH_Y);
    expect(t.snapshot().bomb.pressed).toBe(true);
    expect(t.snapshot().dash.pressed).toBe(true);
    t.onPointerUp(2);
    expect(t.snapshot().bomb.pressed).toBe(true);
    expect(t.snapshot().dash.pressed).toBe(false);
  });

  it('reset() clears the dash latch and owner (pause reconciliation)', () => {
    const t = ownedDash();
    t.onPointerDown(1, DASH_X, DASH_Y);
    t.reset();
    expect(t.consumeDash()).toBe(false);
    expect(t.snapshot().dash.pressed).toBe(false);
    expect(t.isActive()).toBe(false);
  });

  it('setDashButton moves the hit region AND the snapshot rect together', () => {
    const t = ownedDash();
    t.setDashButton(300, 200, 40);
    const s = t.snapshot().dash;
    expect(s).toMatchObject({ x: 300, y: 200, radius: 40 });
    t.onPointerDown(1, 300, 200);
    expect(t.consumeDash()).toBe(true);
    // The OLD center is no longer the dash button.
    t.onPointerDown(2, DASH_X, DASH_Y);
    expect(t.consumeDash()).toBe(false);
  });

  it('setDashButton with the radius omitted keeps the current radius', () => {
    const t = ownedDash();
    t.setDashButton(300, 200);
    expect(t.snapshot().dash.radius).toBe(TOUCH_DASH_BUTTON.radius);
  });
});

describe('TouchControls — the shipped bomb and dash rects do not overlap', () => {
  it('leaves clear space between the two rims, so the fixed hit-test order is unobservable', () => {
    const gap =
      Math.hypot(
        TOUCH_DASH_BUTTON.x - TOUCH_BOMB_BUTTON.x,
        TOUCH_DASH_BUTTON.y - TOUCH_BOMB_BUTTON.y,
      ) -
      TOUCH_DASH_BUTTON.radius -
      TOUCH_BOMB_BUTTON.radius;
    expect(gap).toBeGreaterThan(0);
    // And a tap on either center hits only that button.
    const t = ownedDash();
    t.onPointerDown(1, TOUCH_BOMB_BUTTON.x, TOUCH_BOMB_BUTTON.y);
    expect(t.consumeBomb()).toBe(true);
    expect(t.consumeDash()).toBe(false);
    t.onPointerDown(2, DASH_X, DASH_Y);
    expect(t.consumeDash()).toBe(true);
    expect(t.consumeBomb()).toBe(false);
  });

  it('the dash button sits far enough from the RIGHT edge that no safe-area inset reaches it', () => {
    // Why mobileLayout raises it by the BOTTOM inset only.
    const clearance = ARENA_WIDTH - (TOUCH_DASH_BUTTON.x + TOUCH_DASH_BUTTON.radius);
    expect(clearance).toBeGreaterThan(200);
  });
});
