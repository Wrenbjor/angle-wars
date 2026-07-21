// gridField — Phaser-free shader-source + uniform bridge for the deforming grid
// field (Story 4.2).
//
// This module holds the GLSL fragment source that draws the neon grid and applies
// all ripple + warp deformation on the GPU, plus the two pure functions that build
// and per-frame update the shader's custom-uniform config. It imports Phaser
// NOTHING (mirrors neonStyle.js / constants.js): the uniform config is a plain
// object of Phaser's documented `{ type, value }` shape, so it is fully unit-testable
// in vitest/jsdom without a GL context. GLSL itself cannot run under jsdom, so the
// shader is verified manually (npm run dev); these pure seams carry the automated
// coverage (matching the Story 4.1 / 2.6 precedent).
//
// Uniform layout (must match the GLSL declarations below):
//   uGridSpacing         1f   grid line spacing (px)
//   uGridLineWidth       1f   grid line half-width (px)
//   uGridColor           3f   grid line color (normalized RGB vec3)
//   uRippleDurationSec   1f   ripple lifetime (seconds)
//   uRippleSpeed         1f   ripple ring expansion speed (px/sec)
//   uRippleAmplitude     1f   ripple peak displacement (px)
//   uRippleWavelength    1f   ripple spatial period (px)
//   uWarpRadius          1f   warp reach (px)
//   uWarpMaxDisplacement 1f   warp peak displacement (px)
//   uRipples             3fv  GRID_MAX_RIPPLES × (x, y, ageSeconds); age < 0 = inactive
//   uWarp                3f   (x, y, strength01)

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

/**
 * Convert an 0xRRGGBB integer color to a normalized RGB triple for a vec3 uniform.
 * @param {number} rgb Packed 0xRRGGBB color.
 * @returns {{x:number,y:number,z:number}} Components in [0,1].
 */
export function colorToVec3(rgb) {
  return {
    x: ((rgb >> 16) & 0xff) / 255,
    y: ((rgb >> 8) & 0xff) / 255,
    z: (rgb & 0xff) / 255,
  };
}

// The GLSL fragment source. GRID_MAX_RIPPLES is injected from the constant as a
// #define (the ONLY compile-time array size GLSL ES 1.00 requires) — it is the
// named constant, not a magic number; every tunable arrives as a uniform. The grid
// is drawn in world/arena space (top-left origin, y down); the default Phaser
// vertex shader hands us `fragCoord` with y flipped (y up) and `resolution` = the
// quad size, so we map fragCoord back to world space here (the world→fragment
// y-flip is done in-shader, as the spec requires).
export const GRID_FRAGMENT_SRC = `precision mediump float;

#define GRID_MAX_RIPPLES ${GRID_MAX_RIPPLES}

uniform vec2 resolution;
varying vec2 fragCoord;

uniform float uGridSpacing;
uniform float uGridLineWidth;
uniform vec3  uGridColor;

uniform float uRippleDurationSec;
uniform float uRippleSpeed;
uniform float uRippleAmplitude;
uniform float uRippleWavelength;

uniform float uWarpRadius;
uniform float uWarpMaxDisplacement;

uniform vec3 uRipples[GRID_MAX_RIPPLES];
uniform vec3 uWarp;

const float TAU = 6.28318530718;
const float EPS = 0.0001;

void main() {
    // fragCoord is y-up (default Phaser vertex shader flips it); map back to world
    // space (y-down, top-left origin) so ripple/warp origins in arena pixels match.
    vec2 world = vec2(fragCoord.x, resolution.y - fragCoord.y);

    // Accumulate the displacement applied to the SAMPLED grid coordinate.
    vec2 disp = vec2(0.0);

    // Ripples: each active slot contributes an outward radial sine wave whose ring
    // radius races out at uRippleSpeed and whose amplitude fades over its life.
    for (int i = 0; i < GRID_MAX_RIPPLES; i++) {
        vec3 rip = uRipples[i];
        float age = rip.z;
        if (age < 0.0) {
            continue; // inactive slot (sentinel)
        }
        vec2 toFrag = world - rip.xy;
        float dist = length(toFrag);
        if (dist < EPS) {
            continue;
        }
        float ringRadius = age * uRippleSpeed;
        float envelope = 1.0 - age / uRippleDurationSec;
        if (envelope < 0.0) {
            envelope = 0.0;
        }
        float wave = sin((dist - ringRadius) / uRippleWavelength * TAU);
        disp += (toFrag / dist) * wave * uRippleAmplitude * envelope;
    }

    // Warp: pull the sampled coordinate toward the Black Hole within uWarpRadius,
    // strongest at the core (linear falloff), scaled by the hole's strength (0..1).
    float wStrength = uWarp.z;
    if (wStrength > 0.0) {
        vec2 toWarp = uWarp.xy - world;
        float d = length(toWarp);
        if (d > EPS && d < uWarpRadius) {
            float falloff = 1.0 - d / uWarpRadius;
            disp += (toWarp / d) * falloff * uWarpMaxDisplacement * wStrength;
        }
    }

    vec2 sampled = world + disp;

    // Grid lines: distance to the nearest line along each axis, at uGridSpacing.
    vec2 g = mod(sampled, uGridSpacing);
    vec2 distToLine = min(g, uGridSpacing - g);
    float line = min(distToLine.x, distToLine.y);
    float intensity = 1.0 - smoothstep(0.0, uGridLineWidth, line);

    gl_FragColor = vec4(uGridColor * intensity, intensity);
}
`;

/**
 * Build the shader's custom-uniform config in Phaser's documented `{ type, value }`
 * shape. Static GRID_* values are baked in once; uRipples is a pre-allocated
 * Float32Array (3 floats per slot) seeded all-inactive (ageSeconds = -1); uWarp is
 * a mutable {x,y,z} released at strength 0. packGridUniforms mutates these in place
 * every render frame (zero per-frame allocation).
 *
 * NOTE: Phaser deep-copies this config into the live Shader GameObject at creation,
 * so per-frame packing must target `shader.uniforms` (the live copy), not the object
 * returned here — see ArenaScene.
 *
 * `gridSpacing` defaults to the desktop GRID_SPACING, so an omitted arg is byte-identical
 * to today's grid. ArenaScene injects the resolved quality profile's gridSpacing
 * (Story 7.4) — the mobile variant is COARSER (larger spacing), drawing fewer neon
 * lines (less smoothstep fill) for the weaker mobile GPU. It changes only the uniform
 * value; the compiled shader (its GRID_MAX_RIPPLES #define) is untouched.
 * @param {number} [gridSpacing] Grid line spacing in px (defaults to GRID_SPACING).
 * @returns {object} The uniforms config for `new Phaser.Display.BaseShader(...)`.
 */
export function buildGridUniforms(gridSpacing = GRID_SPACING) {
  // Guard the placeholder footgun: the `= GRID_SPACING` default only catches
  // `undefined`, so a 0 / negative / NaN spacing would reach the shader and NaN its
  // `mod(sampled, uGridSpacing)` line math. Fall back to the desktop spacing instead.
  const spacing =
    Number.isFinite(gridSpacing) && gridSpacing > 0 ? gridSpacing : GRID_SPACING;
  const uRipples = new Float32Array(3 * GRID_MAX_RIPPLES);
  // Seed every slot inactive: ageSeconds (the 3rd component) = -1 so the shader
  // skips it. x/y stay 0 and are irrelevant while inactive.
  for (let i = 0; i < GRID_MAX_RIPPLES; i++) {
    uRipples[i * 3 + 2] = -1;
  }
  return {
    uGridSpacing: { type: '1f', value: spacing },
    uGridLineWidth: { type: '1f', value: GRID_LINE_WIDTH },
    uGridColor: { type: '3f', value: colorToVec3(GRID_COLOR) },
    uRippleDurationSec: { type: '1f', value: GRID_RIPPLE_DURATION_MS / 1000 },
    uRippleSpeed: { type: '1f', value: GRID_RIPPLE_SPEED },
    uRippleAmplitude: { type: '1f', value: GRID_RIPPLE_AMPLITUDE },
    uRippleWavelength: { type: '1f', value: GRID_RIPPLE_WAVELENGTH },
    uWarpRadius: { type: '1f', value: GRID_WARP_RADIUS },
    uWarpMaxDisplacement: { type: '1f', value: GRID_WARP_MAX_DISPLACEMENT },
    uRipples: { type: '3fv', value: uRipples },
    uWarp: { type: '3f', value: { x: 0, y: 0, z: 0 } },
  };
}

/**
 * Write the GridFieldSystem's live ripple + warp state into a uniforms config in
 * place (no allocation). Each active ripple slot packs (x, y, ageSeconds); an
 * inactive slot packs ageSeconds = -1 (the sentinel the shader skips). The warp
 * packs (x, y, strength01); a released warp packs strength 0.
 *
 * When `reduceMotion` is true (Story 6.1 / AC2, an accessibility preference read
 * once at ArenaScene.create()), the packed warp strength is forced to 0 regardless
 * of the system's warp state, so the black-hole grid bow flattens at render time —
 * a presentation-only suppression that never touches GridFieldSystem or the sim.
 * Ripple packing is UNCHANGED: the (globally calmed) ripple is the surviving
 * readable non-motion cue and is deliberately never suppressed by the toggle.
 * @param {object} uniforms The LIVE shader uniforms (shape from buildGridUniforms).
 * @param {import('../systems/GridFieldSystem.js').GridFieldSystem} gridFieldSystem
 * @param {boolean} [reduceMotion=false] When true, force the packed warp z (strength)
 *   to 0 (flatten the black-hole bow); ripple slots are packed normally regardless.
 */
export function packGridUniforms(uniforms, gridFieldSystem, reduceMotion = false) {
  const arr = uniforms.uRipples.value;
  const ripples = gridFieldSystem.ripples;
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    const base = i * 3;
    if (r.active) {
      arr[base] = r.x;
      arr[base + 1] = r.y;
      arr[base + 2] = r.ageMs / 1000; // ageSeconds
    } else {
      arr[base] = 0;
      arr[base + 1] = 0;
      arr[base + 2] = -1; // inactive sentinel
    }
  }

  const warp = gridFieldSystem.warp;
  const w = uniforms.uWarp.value;
  w.x = warp.x;
  w.y = warp.y;
  // Reduced motion flattens the warp at the render-consumption layer (force z=0)
  // without touching the system's warp target, keeping the sim byte-identical.
  w.z = reduceMotion ? 0 : warp.active ? warp.strength : 0;
}
