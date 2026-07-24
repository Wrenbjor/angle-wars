import { describe, it, expect } from 'vitest';
import { PlayerMovementSystem } from './PlayerMovementSystem.js';
import { InputState } from '../input/InputState.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  SHIP_ACCEL,
  SHIP_MAX_SPEED,
  SHIP_RADIUS,
  SHIP_MIN_TURN_SPEED,
  SHIP_DRAG_RETAIN_PER_SEC,
  MOVE_SPEED_MULT_MAX,
  DASH_SPEED,
  DASH_DURATION_MS,
  SPAWN_SAFE_RADIUS,
  BLACKHOLE_GRAVITY_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const DT_SEC = DT / 1000;

// Build a ship + input + system triad. `move` seeds the InputState via setMove
// (so it is unit-circle-clamped exactly as the real sampler would leave it).
function makeSystem({ ship: shipOverrides = {}, move = [0, 0] } = {}) {
  const ship = { ...createPlayerShip(), ...shipOverrides };
  const input = new InputState();
  input.setMove(move[0], move[1]);
  const system = new PlayerMovementSystem(ship, input);
  return { ship, input, system };
}

describe('PlayerMovementSystem', () => {
  it('thrust from rest: one tick gives vx>0, x increases, vx ≈ SHIP_ACCEL*dtSec', () => {
    const { ship, system } = makeSystem({ move: [1, 0] });
    const x0 = ship.x;
    system.fixedUpdate(DT);

    expect(ship.vx).toBeGreaterThan(0);
    expect(ship.x).toBeGreaterThan(x0);
    // Pre-drag impulse is SHIP_ACCEL*dtSec; drag shaves a hair off, so the
    // realized vx is just below that value but very close.
    const impulse = SHIP_ACCEL * DT_SEC;
    expect(ship.vx).toBeLessThanOrEqual(impulse + 1e-9);
    expect(ship.vx).toBeGreaterThan(impulse * 0.9);
  });

  it('diagonal is not faster: (1,1) intent yields the same accel magnitude as a cardinal', () => {
    const diag = makeSystem({ move: [1, 1] });
    const card = makeSystem({ move: [1, 0] });
    diag.system.fixedUpdate(DT);
    card.system.fixedUpdate(DT);

    const diagMag = Math.hypot(diag.ship.vx, diag.ship.vy);
    const cardMag = Math.hypot(card.ship.vx, card.ship.vy);
    // Equal magnitudes prove the diagonal was normalized (not √2× faster).
    expect(diagMag).toBeCloseTo(cardMag, 6);
    expect(diagMag).toBeLessThan(SHIP_ACCEL * DT_SEC * Math.SQRT2);
  });

  it('drag to stop: speed strictly decreases each tick toward ~0 and never reverses sign', () => {
    const { ship, system } = makeSystem({ ship: { vx: 300, vy: 0 }, move: [0, 0] });
    let prev = Math.hypot(ship.vx, ship.vy);
    for (let i = 0; i < 200; i++) {
      system.fixedUpdate(DT);
      const sp = Math.hypot(ship.vx, ship.vy);
      expect(sp).toBeLessThan(prev); // strictly decreasing
      expect(ship.vx).toBeGreaterThanOrEqual(0); // never reverses sign
      prev = sp;
    }
    expect(prev).toBeLessThan(1); // approached ~0
  });

  it('max-speed cap: speed never exceeds SHIP_MAX_SPEED and converges to it under sustained thrust', () => {
    // Reset position to center each tick so the ship never hits a wall; this
    // isolates the velocity cap from boundary clamping.
    const { ship, system } = makeSystem({ move: [1, 0] });
    for (let i = 0; i < 60; i++) {
      ship.x = ARENA_WIDTH / 2;
      ship.y = ARENA_HEIGHT / 2;
      system.fixedUpdate(DT);
      expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(SHIP_MAX_SPEED + 1e-6);
    }
    expect(Math.hypot(ship.vx, ship.vy)).toBeCloseTo(SHIP_MAX_SPEED, 3);
  });

  it('boundary clamp: driven past maxX, x is clamped and outward vx is zeroed', () => {
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { x: maxX - 1, vx: 1000, vy: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.x).toBeCloseTo(maxX, 9);
    expect(ship.vx).toBe(0);
  });

  it('boundary clamp: driven past minX, x is clamped and outward vx is zeroed', () => {
    const minX = ARENA_BORDER_INSET + SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { x: minX + 1, vx: -1000, vy: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.x).toBeCloseTo(minX, 9);
    expect(ship.vx).toBe(0);
  });

  it('boundary clamp: driven past maxY, y is clamped and outward vy is zeroed', () => {
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { y: maxY - 1, vy: 1000, vx: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.y).toBeCloseTo(maxY, 9);
    expect(ship.vy).toBe(0);
  });

  it('boundary clamp: driven past minY, y is clamped and outward vy is zeroed', () => {
    const minY = ARENA_BORDER_INSET + SHIP_RADIUS;
    const { ship, system } = makeSystem({
      ship: { y: minY + 1, vy: -1000, vx: 0 },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(ship.y).toBeCloseTo(minY, 9);
    expect(ship.vy).toBe(0);
  });

  it('facing while moving: angle equals atan2(vy, vx) when speed is above the turn threshold', () => {
    const { ship, system } = makeSystem({ ship: { vx: 100, vy: 100 }, move: [0, 0] });
    system.fixedUpdate(DT);

    expect(Math.hypot(ship.vx, ship.vy)).toBeGreaterThan(SHIP_MIN_TURN_SPEED);
    expect(ship.angle).toBeCloseTo(Math.atan2(ship.vy, ship.vx), 12);
    expect(ship.angle).toBeCloseTo(Math.PI / 4, 6); // moving up-right
  });

  it('facing while stopped: angle is held (unchanged) when speed is below the turn threshold', () => {
    const priorAngle = 1.234;
    const { ship, system } = makeSystem({
      ship: { vx: 0, vy: 0, angle: priorAngle },
      move: [0, 0],
    });
    system.fixedUpdate(DT);

    expect(Math.hypot(ship.vx, ship.vy)).toBeLessThanOrEqual(SHIP_MIN_TURN_SPEED);
    expect(ship.angle).toBe(priorAngle);
  });

  it('radial deadzone: zero move intent produces no drift from rest', () => {
    const { ship, system } = makeSystem({ move: [0, 0] });
    const { x, y } = ship;
    system.fixedUpdate(DT);

    expect(ship.x).toBe(x);
    expect(ship.y).toBe(y);
    expect(ship.vx).toBe(0);
    expect(ship.vy).toBe(0);
  });
});

// --- Afterburner (Story 10.5) -----------------------------------------------
// The whole point of these tests is that they measure the ship's ACHIEVED velocity.
// A test that pins `cap === SHIP_MAX_SPEED * mult` (or the fold value) passes against
// the broken implementation that scaled ONLY the cap — under which Lv2, Lv3, Lv4 and
// Lv5 all topped out at a flat 597.7 px/s while their cards read +20/+25/+25/+35%.
// Measure hypot(vx, vy), never an expression built from the constants.

/** A movement system with an Afterburner-folded stat store and an optional dash. */
function makeAfterburner({ mult, move = [1, 0], dashSystem = null } = {}) {
  const ship = createPlayerShip();
  const input = new InputState();
  input.setMove(move[0], move[1]);
  const playerStats = mult === undefined ? null : { moveSpeedMult: mult };
  const system = new PlayerMovementSystem(ship, input, playerStats, dashSystem);
  return { ship, input, system, playerStats };
}

/**
 * Drive the system to steady state under a held unit input, re-centering the ship each
 * tick so the arena clamp never interferes, and return the measured speed.
 */
function achievedSpeed(system, ship, ticks = 200) {
  for (let i = 0; i < ticks; i++) {
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    system.fixedUpdate(DT);
  }
  return Math.hypot(ship.vx, ship.vy);
}

// The five shipped rungs (Afterburner Lv1..Lv5), plus the no-item base.
const RUNGS = [
  { label: 'base', mult: 1, expected: 520.0 },
  { label: 'Lv1', mult: 1.12, expected: 582.4 },
  { label: 'Lv2', mult: 1.2, expected: 624.0 },
  { label: 'Lv3', mult: 1.25, expected: 650.0 },
  { label: 'Lv4', mult: 1.25, expected: 650.0 },
  { label: 'Lv5', mult: 1.35, expected: 702.0 },
];

describe('PlayerMovementSystem — Afterburner ACHIEVED top speed (Story 10.5)', () => {
  it('reaches SHIP_MAX_SPEED × mult at EVERY shipped rung (measured, not derived)', () => {
    for (const { label, mult, expected } of RUNGS) {
      const { ship, system } = makeAfterburner({ mult });
      const measured = achievedSpeed(system, ship);
      expect(measured, `${label} achieved speed`).toBeCloseTo(expected, 3);
      // Restate the relationship independently of the hardcoded figure above.
      expect(measured, `${label} vs SHIP_MAX_SPEED × mult`).toBeCloseTo(
        SHIP_MAX_SPEED * mult,
        3,
      );
    }
  });

  it('the DISTINCT rungs are pairwise distinct — the property the broken build failed', () => {
    // Under the cap-only implementation Lv2..Lv5 ALL measured 597.7 px/s.
    const distinctMults = [1, 1.12, 1.2, 1.25, 1.35];
    const speeds = distinctMults.map((mult) => {
      const { ship, system } = makeAfterburner({ mult });
      return achievedSpeed(system, ship);
    });
    for (let i = 0; i < speeds.length; i++) {
      for (let j = i + 1; j < speeds.length; j++) {
        expect(
          Math.abs(speeds[i] - speeds[j]),
          `rungs ${distinctMults[i]} and ${distinctMults[j]} are indistinguishable`,
        ).toBeGreaterThan(1);
      }
    }
    // …and they are strictly increasing.
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
    }
  });

  it('the drag equilibrium stays strictly ABOVE the cap at every rung (so the cap binds)', () => {
    // Computed from the constants, not hardcoded: k = retain^dt, equilibrium =
    // accel·dt·k/(1−k). Scaling accel moves BOTH sides by `mult`, so the inequality
    // holds at every multiplier — including the safety clamp.
    const k = Math.pow(SHIP_DRAG_RETAIN_PER_SEC, DT_SEC);
    for (const mult of [1, 1.12, 1.2, 1.25, 1.35, MOVE_SPEED_MULT_MAX]) {
      const equilibrium = (SHIP_ACCEL * mult * DT_SEC * k) / (1 - k);
      const cap = SHIP_MAX_SPEED * mult;
      expect(equilibrium, `equilibrium at mult ${mult}`).toBeGreaterThan(cap);
    }
  });

  it('time-to-95%-of-top-speed is IDENTICAL (in ticks) across all five rungs', () => {
    // The claim "the profile scales in SPEED, not in TIME": drag is untouched, so the
    // whole velocity curve is the base curve times `mult`.
    const ticksTo95 = [1, 1.12, 1.2, 1.25, 1.35].map((mult) => {
      const { ship, system } = makeAfterburner({ mult });
      const target = 0.95 * SHIP_MAX_SPEED * mult;
      for (let i = 1; i <= 600; i++) {
        ship.x = ARENA_WIDTH / 2;
        ship.y = ARENA_HEIGHT / 2;
        system.fixedUpdate(DT);
        if (Math.hypot(ship.vx, ship.vy) >= target) return i;
      }
      return -1;
    });
    expect(ticksTo95[0]).toBeGreaterThan(0);
    for (const t of ticksTo95) expect(t).toBe(ticksTo95[0]);
  });

  it('scales the THRUST term too — the first tick from rest is mult× the base tick', () => {
    const base = makeAfterburner({ mult: 1 });
    const fast = makeAfterburner({ mult: 1.35 });
    base.system.fixedUpdate(DT);
    fast.system.fixedUpdate(DT);
    expect(fast.ship.vx / base.ship.vx).toBeCloseTo(1.35, 9);
  });

  it('stopping behaviour (coast-down in TIME) is unchanged at every rung', () => {
    // Drag is untouched, so the number of ticks to shed a given FRACTION of speed is
    // identical — the ship gets faster, not floatier.
    const ticksToTenth = [1, 1.2, 1.35].map((mult) => {
      const { ship, system } = makeAfterburner({ mult, move: [0, 0] });
      ship.vx = 500 * mult;
      const target = ship.vx * 0.1;
      for (let i = 1; i <= 600; i++) {
        ship.x = ARENA_WIDTH / 2;
        ship.y = ARENA_HEIGHT / 2;
        system.fixedUpdate(DT);
        if (Math.hypot(ship.vx, ship.vy) <= target) return i;
      }
      return -1;
    });
    expect(ticksToTenth[0]).toBeGreaterThan(0);
    for (const t of ticksToTenth) expect(t).toBe(ticksToTenth[0]);
  });
});

describe('PlayerMovementSystem — moveSpeedMult sanitizer (Story 10.5)', () => {
  it('a MISSING store leaves the pre-10.5 profile exactly (measured)', () => {
    const withStore = makeAfterburner({ mult: 1 });
    const noStore = makeAfterburner({}); // playerStats === null
    expect(achievedSpeed(noStore.system, noStore.ship)).toBeCloseTo(
      achievedSpeed(withStore.system, withStore.ship),
      9,
    );
    expect(noStore.system._moveSpeedMult()).toBe(1);
  });

  it('every JUNK value falls back to base 1 (measured, not by cap value)', () => {
    const baseline = (() => {
      const h = makeAfterburner({ mult: 1 });
      return achievedSpeed(h.system, h.ship);
    })();
    for (const v of [NaN, Infinity, -Infinity, 0, -1, undefined, '1.5', null]) {
      const { ship, system } = makeAfterburner({ mult: v });
      expect(system._moveSpeedMult(), `mult ${String(v)}`).toBe(1);
      expect(achievedSpeed(system, ship), `mult ${String(v)}`).toBeCloseTo(baseline, 9);
    }
  });

  it('clamps an absurd multiplier to MOVE_SPEED_MULT_MAX', () => {
    const { ship, system } = makeAfterburner({ mult: 1e9 });
    expect(system._moveSpeedMult()).toBe(MOVE_SPEED_MULT_MAX);
    expect(achievedSpeed(system, ship)).toBeCloseTo(
      SHIP_MAX_SPEED * MOVE_SPEED_MULT_MAX,
      3,
    );
  });

  it('a TWO-ARG construction is byte-identical to the pre-10.5 system', () => {
    const ship = createPlayerShip();
    const input = new InputState();
    input.setMove(1, 0.4);
    const twoArg = new PlayerMovementSystem(ship, input);

    const ship2 = createPlayerShip();
    const input2 = new InputState();
    input2.setMove(1, 0.4);
    const fourArg = new PlayerMovementSystem(ship2, input2, null, null);

    for (let i = 0; i < 120; i++) {
      twoArg.fixedUpdate(DT);
      fourArg.fixedUpdate(DT);
    }
    expect(ship.vx).toBe(ship2.vx);
    expect(ship.vy).toBe(ship2.vy);
    expect(ship.x).toBe(ship2.x);
    expect(ship.y).toBe(ship2.y);
    expect(ship.angle).toBe(ship2.angle);
  });
});

describe('PlayerMovementSystem — the dash branch (Story 10.5)', () => {
  /** A minimal dash stand-in: this system reads only `active`, `dirX`, `dirY`. */
  function fakeDash(dirX, dirY, active = true) {
    return { active, dirX, dirY };
  }

  it('sets a CONSTANT velocity for the window regardless of the held intent', () => {
    // Held intent points the OPPOSITE way — the dash must ignore it entirely.
    const dash = fakeDash(1, 0);
    const { ship, system } = makeAfterburner({ mult: 1.35, move: [-1, 0], dashSystem: dash });
    for (let i = 0; i < 11; i++) {
      ship.x = ARENA_WIDTH / 2;
      ship.y = ARENA_HEIGHT / 2;
      system.fixedUpdate(DT);
      expect(ship.vx).toBe(DASH_SPEED);
      expect(ship.vy).toBe(0);
    }
  });

  it('SUPPRESSES thrust and drag for the window (speed is exactly DASH_SPEED)', () => {
    const dash = fakeDash(0, 1);
    const { ship, system } = makeAfterburner({ mult: 1, move: [1, 0], dashSystem: dash });
    ship.vx = 400; // pre-existing velocity is overwritten, not blended
    ship.vy = 0;
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    system.fixedUpdate(DT);
    expect(Math.hypot(ship.vx, ship.vy)).toBe(DASH_SPEED);
    expect(ship.vx).toBe(0);
    expect(ship.vy).toBe(DASH_SPEED);
  });

  it('faces the DASH direction (DASH_SPEED is far above the turn threshold)', () => {
    const dash = fakeDash(0, -1);
    const { ship, system } = makeAfterburner({ mult: 1, move: [1, 0], dashSystem: dash });
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    system.fixedUpdate(DT);
    expect(DASH_SPEED).toBeGreaterThan(SHIP_MIN_TURN_SPEED);
    expect(ship.angle).toBeCloseTo(Math.atan2(-1, 0), 9);
  });

  it('still applies the arena clamp, and the window is not ended by a wall', () => {
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SHIP_RADIUS;
    const dash = fakeDash(1, 0);
    const { ship, system } = makeAfterburner({ mult: 1, move: [0, 0], dashSystem: dash });
    ship.x = maxX - 1;
    ship.y = ARENA_HEIGHT / 2;
    // Grind at the wall for the whole window: the clamp zeroes the wall-ward velocity,
    // and the dash branch re-applies it on the very next tick.
    for (let i = 0; i < 11; i++) {
      system.fixedUpdate(DT);
      expect(ship.x).toBeCloseTo(maxX, 9);
      expect(ship.vx).toBe(0); // zeroed by the clamp AFTER travelling into it
      expect(dash.active).toBe(true); // the window is DashSystem's, not the wall's
    }
  });

  it('an inactive dash leaves the ordinary path untouched', () => {
    const dash = fakeDash(1, 0, false);
    const withDash = makeAfterburner({ mult: 1.2, move: [1, 0], dashSystem: dash });
    const without = makeAfterburner({ mult: 1.2, move: [1, 0] });
    expect(achievedSpeed(withDash.system, withDash.ship)).toBeCloseTo(
      achievedSpeed(without.system, without.ship),
      9,
    );
  });

  it('travels ~238px over the window, clearing SPAWN_SAFE_RADIUS and under BLACKHOLE_GRAVITY_RADIUS', () => {
    // ~238px is the REALIZED travel (238.33px): 11 whole fixed steps at DASH_SPEED × dt.
    // The nominal DASH_SPEED × DASH_DURATION_MS product is 234px, computed here
    // independently as the lower bound. The two sizing properties the constants block
    // claims are asserted against the REALIZED figure, since that is what the ship moves.
    const dash = fakeDash(1, 0);
    const { ship, system } = makeAfterburner({ mult: 1, move: [0, 0], dashSystem: dash });
    ship.x = ARENA_WIDTH / 2;
    ship.y = ARENA_HEIGHT / 2;
    const x0 = ship.x;
    const ticks = Math.ceil(DASH_DURATION_MS / DT);
    for (let i = 0; i < ticks; i++) system.fixedUpdate(DT);
    const travelled = ship.x - x0;
    const nominal = (DASH_SPEED * DASH_DURATION_MS) / 1000;
    expect(nominal).toBeCloseTo(234, 6);
    // Quantized to whole fixed steps the realized travel is a touch above the nominal.
    expect(travelled).toBeGreaterThanOrEqual(nominal);
    expect(travelled).toBeLessThan(nominal + DT_SEC * DASH_SPEED + 1e-6);
    // The two sizing claims, both measured against the realized travel.
    expect(travelled).toBeGreaterThan(SPAWN_SAFE_RADIUS);
    expect(travelled).toBeLessThan(BLACKHOLE_GRAVITY_RADIUS);
  });
});
