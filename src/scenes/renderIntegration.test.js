import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Render-integration smoke test (DW-2). Pins the Boot→Preload→…→Arena scene
// chain and the render→sim decoupling wiring against SOURCE TEXT.
//
// These modules cannot be imported headlessly: `phaser` throws `window is not
// defined` on import in the node test env, and `main.js` constructs a
// `new Phaser.Game(...)` at module load (needs a DOM). So — following the
// `buildConfig.test.js` convention for Phaser-coupled invariants — every check
// below asserts against the file's source text rather than the loaded module.
//
// This file COMPLEMENTS `buildConfig.test.js` (which pins the WEBGL / Scale.FIT /
// CENTER_BOTH positives): here we pin the scene chain, the render→sim decoupling,
// and the not-AUTO negative that buildConfig lacks.

function readSrc(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('render-integration — scene chain (main.js)', () => {
  const mainSrc = readSrc('../main.js');

  it('registers scenes in order Boot→Preload→Title→Arena→Settings', () => {
    expect(mainSrc).toMatch(
      /scene:\s*\[\s*BootScene\s*,\s*PreloadScene\s*,\s*TitleScene\s*,\s*ArenaScene\s*,\s*SettingsScene\s*\]/,
    );
  });

  it('forces the WEBGL renderer and never falls back to Phaser.AUTO', () => {
    expect(mainSrc).toMatch(/type:\s*Phaser\.WEBGL/);
    // The not-AUTO negative: a flip to Phaser.AUTO (Canvas fallback) must fail.
    expect(mainSrc).not.toContain('Phaser.AUTO');
  });
});

describe('render-integration — Boot→Preload→Title handoffs', () => {
  it('BootScene.create() starts PreloadScene', () => {
    expect(readSrc('./BootScene.js')).toMatch(/this\.scene\.start\(\s*['"]PreloadScene['"]\s*\)/);
  });

  it('PreloadScene.create() starts TitleScene', () => {
    expect(readSrc('./PreloadScene.js')).toMatch(/this\.scene\.start\(\s*['"]TitleScene['"]\s*\)/);
  });
});

describe('render-integration — sim-rate sampler wiring (ArenaScene)', () => {
  // Pins that ArenaScene is actually WIRED to the extracted SimRateSampler with
  // the correct arg order and a per-frame update() call. The SimRateSampler unit
  // tests only exercise the class in isolation, so an arg-swap
  // (update(ticks, delta)) or a dropped per-frame call would ship a broken DEV
  // readout while the whole suite stays green. These source-text checks make a
  // mis-wire fail the suite rather than only surfacing as a wrong DEV number.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('constructs the sampler with the 1000 ms window', () => {
    expect(arenaSrc).toMatch(/this\._simRateSampler\s*=\s*new SimRateSampler\(\s*1000\s*\)/);
  });

  it('drives the sampler per frame with delta first, then ticks', () => {
    expect(arenaSrc).toMatch(
      /this\._simRateSampler\.update\(\s*delta\s*,\s*this\.simClock\.ticks\s*\)/,
    );
  });
});

describe('render-integration — reduced-motion wiring (ArenaScene, Story 6.1)', () => {
  // Pins all four load-bearing reduced-motion wirings in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the sim-rate/decoupling
  // checks above — these are SOURCE-TEXT assertions. A regression that dropped any of
  // these would silently disable the accessibility feature (AC2) or silently reset the
  // user's saved preference to false, while the rest of the suite stayed green.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('passes this._reducedMotion as the third arg to packGridUniforms (warp flatten)', () => {
    expect(arenaSrc).toMatch(
      /packGridUniforms\(\s*this\.gridShader\.uniforms\s*,\s*this\.gridFieldSystem\s*,\s*this\._reducedMotion\s*\)/,
    );
  });

  it('zeroes the camera scroll under reduced motion, keeping the shake offsets on the else path', () => {
    // The reduced-motion branch forces scrollX/scrollY to 0 (no camera kick).
    expect(arenaSrc).toMatch(
      /if\s*\(\s*this\._reducedMotion\s*\)\s*\{[\s\S]*?this\.cameras\.main\.scrollX\s*=\s*0\s*;[\s\S]*?this\.cameras\.main\.scrollY\s*=\s*0\s*;[\s\S]*?\}/,
    );
    // The non-reduced path must still write the computed shake offsets — so a
    // regression that dropped the else branch (killing the shake entirely) fails.
    expect(arenaSrc).toMatch(
      /this\.cameras\.main\.scrollX\s*=\s*shakeOffsetX\(/,
    );
    expect(arenaSrc).toMatch(
      /this\.cameras\.main\.scrollY\s*=\s*shakeOffsetY\(/,
    );
  });

  it('gates the flash-overlay alpha on reduced motion (flash forced off)', () => {
    expect(arenaSrc).toMatch(
      /this\.flashOverlay\.setAlpha\(\s*[\s\S]*?this\._reducedMotion\s*\?\s*0\s*:/,
    );
  });

  it('carries reducedMotion through the in-run applyAudioSettings save (no clobber)', () => {
    // The in-run M / - / + save must include reducedMotion: as a read-only passthrough,
    // or an audio change would clobber the persisted preference back to false.
    expect(arenaSrc).toMatch(
      /this\.settingsStorage\.save\(\{[\s\S]*?reducedMotion:\s*this\._reducedMotion[\s\S]*?\}\)/,
    );
  });

  it('gates the black-hole pulse oscillation on reduced motion (Story 6.2 AC / WCAG 2.3.1)', () => {
    // The seizure-band alpha flashing must honor reduced motion: this._reducedMotion
    // is threaded as the 4th arg to blackHolePulseAlpha so the pulse holds steady
    // (color still escalates). A regression that dropped this would flash red at up
    // to BLACKHOLE_PULSE_HZ with no opt-out while the suite stayed green.
    expect(arenaSrc).toMatch(
      /blackHolePulseAlpha\(\s*ratio\s*,\s*time\s*,\s*baseAlpha\s*,\s*this\._reducedMotion\s*\)/,
    );
  });
});

describe('render-integration — black-hole instability wiring (ArenaScene, Story 6.2)', () => {
  // Pins the load-bearing Story 6.2 render/audio wiring in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the reduced-motion /
  // sim-rate checks above — these are SOURCE-TEXT assertions. The pure helpers
  // (blackHolePulseColor/Alpha, blackHoleInstability) and the sim level
  // (maxInstability / AudioDirectorSystem.blackHoleInstability) carry their own unit
  // coverage; the visible red pulse + audible urgency cue are the disclosed manual
  // boundary, so these assertions guard only that the scene actually calls them.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('fills each hole with blackHolePulseColor at blackHolePulseAlpha off its instability ratio', () => {
    // The per-hole ratio comes from blackHoleInstability(h.radius)…
    expect(arenaSrc).toMatch(/blackHoleInstability\(\s*h\.radius\s*\)/);
    // …and drives the pulse color + alpha at the current animation time.
    expect(arenaSrc).toMatch(/blackHolePulseColor\(\s*ratio\s*\)/);
    expect(arenaSrc).toMatch(/blackHolePulseAlpha\(\s*ratio\s*,\s*time\s*,/);
  });

  it('maps audioDirector.blackHoleInstability into the audio engine urgency cue, forced to 0 at game-over', () => {
    // The urgency level is fed to the engine each frame, but gated to 0 on game-over
    // (maxInstability is only recomputed inside the gameOver-gated world.fixedUpdate,
    // so an unstable-hole run-end would otherwise freeze the tone droning).
    expect(arenaSrc).toMatch(
      /this\.audioEngine\.setBlackHoleUrgency\(\s*this\.playerState\.gameOver\s*\?\s*0\s*:\s*this\.audioDirector\.blackHoleInstability\s*,?\s*\)/,
    );
  });
});

describe('render-integration — mirror-reflector render wiring (ArenaScene, Story 6.3)', () => {
  // Pins the load-bearing Story 6.3 dumbbell render pass in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the reduced-motion /
  // black-hole checks above — these are SOURCE-TEXT assertions. The pure geometry seam
  // (reflectorEndpoints) carries its own unit coverage; the visible spinning dumbbell is
  // the disclosed manual boundary, so these assertions guard only that the scene actually
  // draws it from the pool with the telegraph cue and joins the additive/bloom layer.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('computes each reflector bar via the reflectorEndpoints seam scaled by telegraphScale', () => {
    // Endpoints come from the pure seam, with the bar half-length scaled by the
    // telegraph scale so a spawning-in reflector fades + scales in.
    expect(arenaSrc).toMatch(
      /reflectorEndpoints\(\s*r\.x\s*,\s*r\.y\s*,\s*r\.angle\s*,\s*REFLECTOR_BAR_HALF_LENGTH\s*\*\s*scale\s*\)/,
    );
    // The per-reflector telegraph progress drives both the alpha and the scale.
    expect(arenaSrc).toMatch(/telegraphAlpha\(\s*p\s*,\s*SPAWN_TELEGRAPH_MIN_ALPHA\s*\)/);
    expect(arenaSrc).toMatch(/telegraphScale\(\s*p\s*,\s*SPAWN_TELEGRAPH_MIN_SCALE\s*\)/);
  });

  it('draws the reflector bar + weights in COLOR_MIRROR_REFLECTOR from the reflector pool', () => {
    // Iterates the reflector pool's active set…
    expect(arenaSrc).toMatch(
      /this\.mirrorReflectorSystem\.enemyPool\.forEachActive\(/,
    );
    // …stroking the bar line and filling the weights in the reflector color.
    expect(arenaSrc).toMatch(/lineStyle\([\s\S]*?COLOR_MIRROR_REFLECTOR/);
    expect(arenaSrc).toMatch(/fillStyle\(\s*COLOR_MIRROR_REFLECTOR\s*,\s*alpha\s*\)/);
  });

  it('joins the reflector graphics to the additive/bloom neon layer list', () => {
    // The reflectorGraphics object must be in the applyAdditiveBlend list so the
    // dumbbell glows under the single camera bloom like every other neon layer.
    expect(arenaSrc).toMatch(
      /applyAdditiveBlend\(\s*\[[\s\S]*?this\.reflectorGraphics[\s\S]*?\]/,
    );
  });
});

describe('render-integration — render→sim decoupling (ArenaScene.update)', () => {
  const arenaSrc = readSrc('./ArenaScene.js');

  it('advances the sim only through this.fixedTimestep.advance(delta, ...)', () => {
    expect(arenaSrc).toMatch(/this\.fixedTimestep\.advance\(\s*delta\s*,/);
  });

  it('steps the world exactly once, and only inside the gameOver-gated callback', () => {
    // The load-bearing decoupling guard: a second, direct `world.fixedUpdate`
    // call added to update() (stepping the sim from the render loop) would push
    // this count above 1 and fail. The lone call must be the gameOver-gated form
    // fed the fixed step `dt` — never `delta`, never on game over.
    const occurrences = arenaSrc.match(/this\.world\.fixedUpdate\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(arenaSrc).toMatch(
      /if\s*\(\s*!this\.playerState\.gameOver\s*\)\s*this\.world\.fixedUpdate\(\s*dt\s*\)/,
    );
  });
});
