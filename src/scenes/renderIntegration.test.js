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
