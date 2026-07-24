import { describe, it, expect } from 'vitest';
import {
  applyRadialDeadzone,
  clampToUnitCircle,
  normalizeToUnit,
  isBombButton,
  isDashButton,
  isStandardMapping,
  mappingWarning,
  GAMEPAD_STANDARD_MAPPING,
} from './inputMath.js';
import { InputState } from './InputState.js';
import {
  MOVE_DEADZONE,
  AIM_DEADZONE,
  GAMEPAD_BOMB_BUTTONS,
  GAMEPAD_DASH_BUTTONS,
} from '../config/constants.js';

const DZ = 0.25;

describe('applyRadialDeadzone', () => {
  it('returns (0,0) for a dead-center stick', () => {
    expect(applyRadialDeadzone(0, 0, DZ)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0,0) inside the deadzone and at its exact edge', () => {
    expect(applyRadialDeadzone(0.1, 0.1, DZ)).toEqual({ x: 0, y: 0 }); // mag ≈0.14
    expect(applyRadialDeadzone(DZ, 0, DZ)).toEqual({ x: 0, y: 0 }); // at edge
  });

  it('rescales so response starts at 0 at the deadzone edge (no jump)', () => {
    // Just past the edge → near-zero magnitude, not a jump to ~0.25.
    const justPast = applyRadialDeadzone(DZ + 1e-6, 0, DZ);
    expect(justPast.x).toBeGreaterThan(0);
    expect(justPast.x).toBeLessThan(1e-5);

    // Halfway (0.5 on a 0.25 deadzone) → (0.5-0.25)/(1-0.25) = 1/3.
    const mid = applyRadialDeadzone(0.5, 0, DZ);
    expect(mid.x).toBeCloseTo(1 / 3, 6);
    expect(mid.y).toBe(0);
  });

  it('reaches magnitude 1 at the unit circle and preserves direction', () => {
    const full = applyRadialDeadzone(1, 0, DZ);
    expect(full.x).toBeCloseTo(1, 6);
    expect(full.y).toBeCloseTo(0, 6);

    // A diagonal on the unit circle keeps its direction, magnitude → 1.
    const diag = applyRadialDeadzone(0.6, 0.8, DZ);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 6);
    expect(diag.y / diag.x).toBeCloseTo(0.8 / 0.6, 6);
  });

  it('clamps a stick reported beyond the unit circle to magnitude 1', () => {
    const over = applyRadialDeadzone(1, 1, DZ); // raw mag ≈1.41
    expect(Math.hypot(over.x, over.y)).toBeCloseTo(1, 6);
  });
});

describe('clampToUnitCircle', () => {
  it('scales down a vector whose magnitude exceeds 1', () => {
    expect(clampToUnitCircle(1, 1)).toEqual({
      x: 1 / Math.SQRT2,
      y: 1 / Math.SQRT2,
    });
    const r = clampToUnitCircle(3, 4); // mag 5 → (0.6, 0.8)
    expect(r.x).toBeCloseTo(0.6, 9);
    expect(r.y).toBeCloseTo(0.8, 9);
  });

  it('leaves a vector at or within the unit circle untouched', () => {
    expect(clampToUnitCircle(0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(clampToUnitCircle(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('normalizeToUnit', () => {
  it('returns the zero vector with mag 0 for a zero-length input', () => {
    expect(normalizeToUnit(0, 0)).toEqual({ x: 0, y: 0, mag: 0 });
  });

  it('normalizes to unit length and reports the original magnitude', () => {
    const r = normalizeToUnit(3, 4); // mag 5 → (0.6, 0.8)
    expect(r.x).toBeCloseTo(0.6, 9);
    expect(r.y).toBeCloseTo(0.8, 9);
    expect(r.mag).toBeCloseTo(5, 9);
  });

  it('preserves direction while scaling to magnitude 1', () => {
    const r = normalizeToUnit(-100, 0);
    expect(r.x).toBeCloseTo(-1, 9);
    expect(r.y).toBe(0);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(1, 9);
  });

  it('leaves an already-unit vector at magnitude 1', () => {
    const r = normalizeToUnit(0, 1);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(1, 9);
    expect(r.mag).toBeCloseTo(1, 9);
  });
});

describe('per-channel deadzone split (MOVE vs AIM)', () => {
  it('keeps AIM larger than MOVE so a probe between them splits', () => {
    expect(AIM_DEADZONE).toBeGreaterThan(MOVE_DEADZONE);

    // Probe magnitude derived from the constants (not hardcoded), so a re-tune
    // of either deadzone cannot break this behavioral assertion.
    const probe = (MOVE_DEADZONE + AIM_DEADZONE) / 2;

    // Right stick @ AIM_DEADZONE → dead (no aim rotation from a brushed stick).
    expect(applyRadialDeadzone(probe, 0, AIM_DEADZONE)).toEqual({ x: 0, y: 0 });
    // Left stick @ MOVE_DEADZONE → non-zero (the ship still moves).
    expect(applyRadialDeadzone(probe, 0, MOVE_DEADZONE).x).toBeGreaterThan(0);
  });
});

describe('isStandardMapping', () => {
  it('is true only for the exact W3C "standard" mapping id', () => {
    expect(isStandardMapping('standard')).toBe(true);
    expect(isStandardMapping(GAMEPAD_STANDARD_MAPPING)).toBe(true);
  });

  it('is false for an empty, unidentified, or other mapping', () => {
    expect(isStandardMapping('')).toBe(false);
    expect(isStandardMapping(undefined)).toBe(false);
    expect(isStandardMapping('xr-standard')).toBe(false);
  });
});

describe('isBombButton', () => {
  it('is true for either bumper (indices 4 and 5) on the standard mapping', () => {
    expect(isBombButton(4, 'standard')).toBe(true);
    expect(isBombButton(5, 'standard')).toBe(true);
  });

  it('is false for face buttons, sticks, and undefined on the standard mapping', () => {
    expect(isBombButton(0, 'standard')).toBe(false); // A / face
    expect(isBombButton(10, 'standard')).toBe(false); // a stick click
    expect(isBombButton(undefined, 'standard')).toBe(false);
  });

  it('treats a missing/undefined mapping as a non-standard best-effort binding (bumpers still bind)', () => {
    // A missing mapping arg flows through the non-standard branch, identical to
    // how isStandardMapping / mappingWarning classify undefined — so the three
    // seams never disagree on the same input. The bumpers still bind best-effort.
    expect(isBombButton(4)).toBe(true);
    expect(isBombButton(5)).toBe(true);
    expect(isBombButton(0)).toBe(false);
    expect(isBombButton(undefined)).toBe(false);
  });

  it('classifies a missing mapping coherently with mappingWarning (warns yet still binds)', () => {
    // Coherence lock: the same missing mapping that yields a non-null diagnostic
    // must NOT be silently treated as standard by the bomb path.
    expect(mappingWarning(undefined)).not.toBeNull();
    expect(isBombButton(4, undefined)).toBe(true);
  });

  it('binds the bumpers best-effort on a non-standard / unidentified pad', () => {
    // No reliable programmatic remap for an unknown pad exists; refusing to bind
    // would leave the bomb unreachable, so the bumper indices still map through.
    expect(isBombButton(4, '')).toBe(true);
    expect(isBombButton(5, '')).toBe(true);
    // Non-bumper indices remain non-bomb regardless of mapping.
    expect(isBombButton(0, '')).toBe(false);
  });
});

describe('mappingWarning', () => {
  it('returns null for the standard mapping (no diagnostic needed)', () => {
    expect(mappingWarning('standard')).toBeNull();
    expect(mappingWarning(GAMEPAD_STANDARD_MAPPING)).toBeNull();
  });

  it('returns a non-null diagnostic string for a non-standard / empty mapping', () => {
    expect(typeof mappingWarning('')).toBe('string');
    expect(mappingWarning('')).not.toBeNull();
    expect(typeof mappingWarning('some-oem-pad')).toBe('string');
  });

  it('names BOTH bound actions\' indices (Story 10.5)', () => {
    // The diagnostic exists so an unbindable action is DISCOVERABLE; naming only one
    // of the two bound actions makes it half-true.
    const msg = mappingWarning('some-oem-pad');
    for (const i of GAMEPAD_BOMB_BUTTONS) expect(msg).toContain(String(i));
    for (const i of GAMEPAD_DASH_BUTTONS) expect(msg).toContain(String(i));
  });
});

describe('isDashButton (Story 10.5)', () => {
  it('accepts the configured stick-click indices on the standard mapping', () => {
    expect(isDashButton(10, 'standard')).toBe(true);
    expect(isDashButton(11, 'standard')).toBe(true);
    expect(GAMEPAD_DASH_BUTTONS).toEqual([10, 11]);
  });

  it('rejects the ANALOG TRIGGERS (6/7) — Phaser Button.threshold defaults to 1', () => {
    // The triggers are analog axes surfaced as buttons, and Phaser's default
    // `Button.threshold` of 1 means a partially-pulled trigger never fires 'down' and
    // never reports `pressed`. Binding the dash there would ship a DEAD control. This
    // assertion exists so a future "the triggers would be nicer" change trips a test
    // instead of shipping that bug.
    expect(isDashButton(6, 'standard')).toBe(false);
    expect(isDashButton(7, 'standard')).toBe(false);
    expect(isDashButton(6)).toBe(false);
    expect(isDashButton(7)).toBe(false);
  });

  it('rejects every index another action already claims', () => {
    for (const i of [0, 1, 2, 3]) expect(isDashButton(i, 'standard')).toBe(false); // confirm
    for (const i of GAMEPAD_BOMB_BUTTONS) expect(isDashButton(i, 'standard')).toBe(false);
    for (const i of [14, 15]) expect(isDashButton(i, 'standard')).toBe(false); // card nav
    expect(isDashButton(undefined, 'standard')).toBe(false);
  });

  it('falls back to the SAME indices on a non-standard / missing mapping (best effort)', () => {
    // Mirrors isBombButton's documented fallback: refusing to bind would leave the
    // dash unreachable, which is strictly worse than a possible misbind that
    // mappingWarning makes discoverable.
    expect(isDashButton(10)).toBe(true);
    expect(isDashButton(11, '')).toBe(true);
    expect(isDashButton(10, 'some-oem-pad')).toBe(true);
    expect(isDashButton(0, '')).toBe(false);
  });

  it('never overlaps isBombButton on any index', () => {
    for (let i = 0; i < 20; i++) {
      expect(
        isBombButton(i, 'standard') && isDashButton(i, 'standard'),
        `index ${i} is claimed by both actions`,
      ).toBe(false);
    }
  });
});

describe('InputState — the dash latch (Story 10.5)', () => {
  it('queueDash latches and consumeDash reads-and-clears', () => {
    const s = new InputState();
    expect(s.dashQueued).toBe(false);
    expect(s.consumeDash()).toBe(false);
    s.queueDash();
    expect(s.dashQueued).toBe(true);
    expect(s.consumeDash()).toBe(true);
    expect(s.dashQueued).toBe(false);
    expect(s.consumeDash()).toBe(false);
  });

  it('is IDEMPOTENT within a step: repeated queues still yield ONE dash', () => {
    const s = new InputState();
    s.queueDash();
    s.queueDash();
    s.queueDash();
    expect(s.consumeDash()).toBe(true);
    expect(s.consumeDash()).toBe(false);
  });

  it('clear() deliberately does NOT clear it (the modal drain must consumeDash)', () => {
    const s = new InputState();
    s.queueDash();
    s.queueBomb();
    s.clear();
    expect(s.dashQueued).toBe(true);
    expect(s.bombQueued).toBe(true);
  });

  it('is INDEPENDENT of the bomb latch', () => {
    const s = new InputState();
    s.queueDash();
    expect(s.consumeBomb()).toBe(false);
    expect(s.consumeDash()).toBe(true);
    s.queueBomb();
    expect(s.consumeDash()).toBe(false);
    expect(s.consumeBomb()).toBe(true);
  });
});

describe('InputState.setAim / clearAim', () => {
  it('normalizes a non-zero aim to a unit direction and marks it active', () => {
    const s = new InputState();
    s.setAim(0, 10);
    expect(s.aimActive).toBe(true);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBeCloseTo(1, 9);
    expect(Math.hypot(s.aimX, s.aimY)).toBeCloseTo(1, 9);
  });

  it('treats a zero-magnitude aim as inactive (no stale direction)', () => {
    const s = new InputState();
    s.setAim(3, 4); // active first
    s.setAim(0, 0);
    expect(s.aimActive).toBe(false);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBe(0);
  });

  it('clearAim() resets the aim channel to inactive', () => {
    const s = new InputState();
    s.setAim(1, 0);
    s.clearAim();
    expect(s.aimActive).toBe(false);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBe(0);
  });

  it('clear() also clears the aim channel', () => {
    const s = new InputState();
    s.setMove(1, 0);
    s.setAim(0, 1);
    s.clear();
    expect(s.moveX).toBe(0);
    expect(s.moveY).toBe(0);
    expect(s.aimActive).toBe(false);
    expect(s.aimX).toBe(0);
    expect(s.aimY).toBe(0);
  });
});

describe('InputState.setMove', () => {
  it('normalizes a raw keyboard diagonal to the unit circle (not faster)', () => {
    const s = new InputState();
    s.setMove(1, 1);
    expect(Math.hypot(s.moveX, s.moveY)).toBeCloseTo(1, 9);
    expect(s.moveX).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(s.moveY).toBeCloseTo(1 / Math.SQRT2, 9);
  });

  it('stores a sub-unit intent unchanged', () => {
    const s = new InputState();
    s.setMove(0.3, 0.4);
    expect(s.moveX).toBeCloseTo(0.3, 9);
    expect(s.moveY).toBeCloseTo(0.4, 9);
  });

  it('clear() resets intent to rest', () => {
    const s = new InputState();
    s.setMove(1, 0);
    s.clear();
    expect(s.moveX).toBe(0);
    expect(s.moveY).toBe(0);
  });
});
