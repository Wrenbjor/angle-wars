import { describe, it, expect } from 'vitest';
import {
  GRID_FRAGMENT_SRC,
  buildGridUniforms,
  packGridUniforms,
  colorToVec3,
} from './gridField.js';
import {
  GRID_SPACING,
  GRID_LINE_WIDTH,
  GRID_COLOR,
  GRID_MAX_RIPPLES,
  GRID_RIPPLE_DURATION_MS,
  GRID_RIPPLE_SPEED,
  GRID_RIPPLE_AMPLITUDE,
  GRID_RIPPLE_WAVELENGTH,
  GRID_WARP_MAX_DISPLACEMENT,
  GRID_WARP_RADIUS,
} from '../config/constants.js';

// A GridFieldSystem stand-in exposing just the fields packGridUniforms reads.
function fakeGridSystem(ripples, warp) {
  return { ripples, warp };
}

function makeRipples() {
  const r = new Array(GRID_MAX_RIPPLES);
  for (let i = 0; i < GRID_MAX_RIPPLES; i++) {
    r[i] = { active: false, x: 0, y: 0, ageMs: 0 };
  }
  return r;
}

describe('colorToVec3', () => {
  it('converts 0xRRGGBB to normalized [0,1] components', () => {
    expect(colorToVec3(0xffffff)).toEqual({ x: 1, y: 1, z: 1 });
    expect(colorToVec3(0x000000)).toEqual({ x: 0, y: 0, z: 0 });
    const v = colorToVec3(0x336699);
    expect(v.x).toBeCloseTo(0x33 / 255, 9);
    expect(v.y).toBeCloseTo(0x66 / 255, 9);
    expect(v.z).toBeCloseTo(0x99 / 255, 9);
  });
});

describe('buildGridUniforms — shape & types', () => {
  it('maps every static GRID_* tunable onto the documented uniform, with its type', () => {
    const u = buildGridUniforms();

    expect(u.uGridSpacing).toEqual({ type: '1f', value: GRID_SPACING });
    expect(u.uGridLineWidth).toEqual({ type: '1f', value: GRID_LINE_WIDTH });
    expect(u.uGridColor).toEqual({ type: '3f', value: colorToVec3(GRID_COLOR) });
    expect(u.uRippleDurationSec).toEqual({
      type: '1f',
      value: GRID_RIPPLE_DURATION_MS / 1000,
    });
    expect(u.uRippleSpeed).toEqual({ type: '1f', value: GRID_RIPPLE_SPEED });
    expect(u.uRippleAmplitude).toEqual({ type: '1f', value: GRID_RIPPLE_AMPLITUDE });
    expect(u.uRippleWavelength).toEqual({
      type: '1f',
      value: GRID_RIPPLE_WAVELENGTH,
    });
    expect(u.uWarpRadius).toEqual({ type: '1f', value: GRID_WARP_RADIUS });
    expect(u.uWarpMaxDisplacement).toEqual({
      type: '1f',
      value: GRID_WARP_MAX_DISPLACEMENT,
    });
  });

  it('uRipples is a 3fv Float32Array of length 3*GRID_MAX_RIPPLES seeded inactive', () => {
    const u = buildGridUniforms();
    expect(u.uRipples.type).toBe('3fv');
    expect(u.uRipples.value).toBeInstanceOf(Float32Array);
    expect(u.uRipples.value.length).toBe(3 * GRID_MAX_RIPPLES);
    // Every slot seeded inactive: ageSeconds (3rd component) = -1.
    for (let i = 0; i < GRID_MAX_RIPPLES; i++) {
      expect(u.uRipples.value[i * 3 + 2]).toBe(-1);
    }
  });

  it('uWarp is a 3f released target {x:0,y:0,z:0}', () => {
    const u = buildGridUniforms();
    expect(u.uWarp.type).toBe('3f');
    expect(u.uWarp.value).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('declares exactly the uniforms the GLSL fragment source references (config → GLSL)', () => {
    const u = buildGridUniforms();
    // Every custom uniform key must appear as a `uniform ... <key>` declaration in
    // the shader source, so the CPU-side config and the GLSL never drift apart.
    for (const key of Object.keys(u)) {
      const re = new RegExp(`uniform\\s+[\\w]+\\s+${key}\\b`);
      expect(GRID_FRAGMENT_SRC).toMatch(re);
    }
  });

  it('every custom uniform declared in the GLSL has a config key (GLSL → config)', () => {
    // The reverse direction, so the contract is bijective: a uniform added to the
    // shader but omitted from buildGridUniforms (it would silently default to 0 at
    // runtime) must fail here. Parse every `uniform <type> <name>` declaration, strip
    // any `[...]` array suffix, and exclude the Phaser-provided built-in `resolution`.
    const configKeys = new Set(Object.keys(buildGridUniforms()));
    const builtIns = new Set(['resolution']); // provided by Phaser's Shader pipeline
    const re = /uniform\s+\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g;
    const declared = [];
    let m;
    while ((m = re.exec(GRID_FRAGMENT_SRC)) !== null) {
      declared.push(m[1]);
    }
    // Sanity: we actually parsed some declarations.
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      if (builtIns.has(name)) continue;
      expect(configKeys.has(name)).toBe(true);
    }
  });

  it('injects GRID_MAX_RIPPLES into the GLSL as the ripple array size', () => {
    expect(GRID_FRAGMENT_SRC).toContain(`#define GRID_MAX_RIPPLES ${GRID_MAX_RIPPLES}`);
    expect(GRID_FRAGMENT_SRC).toContain('uniform vec3 uRipples[GRID_MAX_RIPPLES];');
  });

  it('returns a fresh Float32Array each call (no shared mutable state)', () => {
    const a = buildGridUniforms();
    const b = buildGridUniforms();
    expect(a.uRipples.value).not.toBe(b.uRipples.value);
  });
});

describe('packGridUniforms — ripple packing', () => {
  it('packs (x, y, ageSeconds) for active slots and -1 for inactive slots', () => {
    const uniforms = buildGridUniforms();
    const ripples = makeRipples();
    // Slot 0 active, slot 2 active, the rest inactive.
    ripples[0] = { active: true, x: 12, y: 34, ageMs: 500 };
    ripples[2] = { active: true, x: 56, y: 78, ageMs: 100 };
    const system = fakeGridSystem(ripples, { active: false, x: 0, y: 0, strength: 0 });

    packGridUniforms(uniforms, system);
    const arr = uniforms.uRipples.value;

    // Slot 0: active → (x, y, ageMs/1000).
    expect(arr[0]).toBeCloseTo(12, 5);
    expect(arr[1]).toBeCloseTo(34, 5);
    expect(arr[2]).toBeCloseTo(0.5, 6); // 500ms → 0.5s
    // Slot 1: inactive → sentinel.
    expect(arr[3]).toBe(0);
    expect(arr[4]).toBe(0);
    expect(arr[5]).toBe(-1);
    // Slot 2: active.
    expect(arr[6]).toBeCloseTo(56, 5);
    expect(arr[7]).toBeCloseTo(78, 5);
    expect(arr[8]).toBeCloseTo(0.1, 6);
    // Remaining slots: inactive sentinel.
    for (let i = 3; i < GRID_MAX_RIPPLES; i++) {
      expect(arr[i * 3 + 2]).toBe(-1);
    }
  });

  it('tolerates all-inactive slots (every age = -1)', () => {
    const uniforms = buildGridUniforms();
    const system = fakeGridSystem(makeRipples(), {
      active: false,
      x: 0,
      y: 0,
      strength: 0,
    });

    expect(() => packGridUniforms(uniforms, system)).not.toThrow();
    const arr = uniforms.uRipples.value;
    for (let i = 0; i < GRID_MAX_RIPPLES; i++) {
      expect(arr[i * 3 + 2]).toBe(-1);
    }
  });

  it('mutates the SAME Float32Array in place (zero per-frame allocation)', () => {
    const uniforms = buildGridUniforms();
    const arr = uniforms.uRipples.value;
    const system = fakeGridSystem(makeRipples(), {
      active: false,
      x: 0,
      y: 0,
      strength: 0,
    });

    packGridUniforms(uniforms, system);
    expect(uniforms.uRipples.value).toBe(arr); // same reference
  });

  it('clears a slot back to the sentinel once its ripple goes inactive', () => {
    const uniforms = buildGridUniforms();
    const ripples = makeRipples();
    ripples[0] = { active: true, x: 5, y: 6, ageMs: 200 };
    const system = fakeGridSystem(ripples, { active: false, x: 0, y: 0, strength: 0 });

    packGridUniforms(uniforms, system);
    expect(uniforms.uRipples.value[2]).toBeCloseTo(0.2, 6);

    // Ripple expires; re-pack → slot returns to the inactive sentinel.
    ripples[0].active = false;
    packGridUniforms(uniforms, system);
    expect(uniforms.uRipples.value[0]).toBe(0);
    expect(uniforms.uRipples.value[1]).toBe(0);
    expect(uniforms.uRipples.value[2]).toBe(-1);
  });
});

describe('packGridUniforms — warp packing', () => {
  it('packs (x, y, strength01) for an active warp', () => {
    const uniforms = buildGridUniforms();
    const system = fakeGridSystem(makeRipples(), {
      active: true,
      x: 640,
      y: 360,
      strength: 0.75,
    });

    packGridUniforms(uniforms, system);
    expect(uniforms.uWarp.value).toEqual({ x: 640, y: 360, z: 0.75 });
  });

  it('packs strength 0 for a released warp (active false)', () => {
    const uniforms = buildGridUniforms();
    const system = fakeGridSystem(makeRipples(), {
      active: false,
      x: 100,
      y: 200,
      strength: 0.9, // stale strength ignored while released
    });

    packGridUniforms(uniforms, system);
    expect(uniforms.uWarp.value.z).toBe(0);
  });

  it('mutates the SAME uWarp value object in place', () => {
    const uniforms = buildGridUniforms();
    const w = uniforms.uWarp.value;
    const system = fakeGridSystem(makeRipples(), {
      active: true,
      x: 1,
      y: 2,
      strength: 0.5,
    });

    packGridUniforms(uniforms, system);
    expect(uniforms.uWarp.value).toBe(w); // same reference
  });
});

describe('packGridUniforms — reduced motion (Story 6.1 / AC2)', () => {
  it('forces warp z=0 for an active warp when reduceMotion=true, while ripple slots pack normally', () => {
    const uniforms = buildGridUniforms();
    const ripples = makeRipples();
    ripples[0] = { active: true, x: 12, y: 34, ageMs: 500 };
    const system = fakeGridSystem(ripples, {
      active: true,
      x: 640,
      y: 360,
      strength: 0.75,
    });

    packGridUniforms(uniforms, system, true);

    // Warp suppressed: z forced to 0 regardless of the active warp state. x/y still
    // reflect the system (only strength is gated).
    expect(uniforms.uWarp.value.z).toBe(0);
    expect(uniforms.uWarp.value.x).toBe(640);
    expect(uniforms.uWarp.value.y).toBe(360);
    // Ripple packing is UNCHANGED — the calmed ripple is never suppressed.
    const arr = uniforms.uRipples.value;
    expect(arr[0]).toBeCloseTo(12, 5);
    expect(arr[1]).toBeCloseTo(34, 5);
    expect(arr[2]).toBeCloseTo(0.5, 6);
  });

  it('leaves the active warp z unchanged when reduceMotion is omitted (default false)', () => {
    const uniforms = buildGridUniforms();
    const system = fakeGridSystem(makeRipples(), {
      active: true,
      x: 640,
      y: 360,
      strength: 0.75,
    });

    packGridUniforms(uniforms, system);
    expect(uniforms.uWarp.value.z).toBe(0.75);
  });

  it('leaves the active warp z unchanged when reduceMotion=false is passed explicitly', () => {
    const uniforms = buildGridUniforms();
    const system = fakeGridSystem(makeRipples(), {
      active: true,
      x: 5,
      y: 6,
      strength: 0.4,
    });

    packGridUniforms(uniforms, system, false);
    expect(uniforms.uWarp.value.z).toBeCloseTo(0.4, 6);
  });
});
