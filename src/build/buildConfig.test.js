import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import viteConfig from '../../vite.config.js';

// Build-config invariants (NFR6/NFR7). The Vite config is imported directly and
// asserted in the default node test environment (it is Phaser-free). `src/main.js`
// cannot be imported headlessly — it constructs a `new Phaser.Game(...)` at module
// load, and Phaser needs a DOM — so its Scale invariants are asserted against its
// source text (the config object is not exported).
describe('build config — static/subpath hosting (NFR6)', () => {
  it('uses a relative base so the bundle works from any subpath', () => {
    expect(viteConfig.base).toBe('./');
  });

  it('targets es2022 and outputs to dist/', () => {
    expect(viteConfig.build.target).toBe('es2022');
    expect(viteConfig.build.outDir).toBe('dist');
  });
});

describe('build config — vendor split + chunk-size limit (NFR6)', () => {
  it('routes phaser into its own content-hashed vendor chunk', () => {
    const manualChunks = viteConfig.build.rollupOptions.output.manualChunks;
    expect(manualChunks).toBeDefined();
    expect(manualChunks.phaser).toContain('phaser');
  });

  it('raises the chunk-size warning limit above the split app chunk', () => {
    expect(viteConfig.build.chunkSizeWarningLimit).toBeGreaterThanOrEqual(1600);
  });
});

describe('main.js — responsive canvas scaling (NFR7)', () => {
  const mainSrc = readFileSync(
    fileURLToPath(new URL('../main.js', import.meta.url)),
    'utf8',
  );

  it('keeps the Phaser Scale config FIT + CENTER_BOTH at the fixed arena size', () => {
    expect(mainSrc).toMatch(/mode:\s*Phaser\.Scale\.FIT/);
    expect(mainSrc).toMatch(/autoCenter:\s*Phaser\.Scale\.CENTER_BOTH/);
    expect(mainSrc).toMatch(/width:\s*ARENA_WIDTH/);
    expect(mainSrc).toMatch(/height:\s*ARENA_HEIGHT/);
  });

  it('forces the WEBGL renderer', () => {
    expect(mainSrc).toMatch(/type:\s*Phaser\.WEBGL/);
  });
});

// Remove every `if (import.meta.env.DEV) { ... }` block from the source via
// balanced-brace matching (find the marker, walk braces to the matching close,
// delete that span). Template-literal `${...}` interpolations are internally
// balanced, so naive brace counting nets out correctly.
function stripDevBlocks(src) {
  const marker = 'if (import.meta.env.DEV) {';
  let out = src;
  let idx;
  while ((idx = out.indexOf(marker)) !== -1) {
    const braceStart = idx + marker.length - 1; // index of the opening '{'
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < out.length; i++) {
      const ch = out[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) throw new Error('unbalanced import.meta.env.DEV block');
    out = out.slice(0, idx) + out.slice(end + 1);
  }
  return out;
}

describe('ArenaScene — debug readout stays DEV-gated (production safety)', () => {
  const arenaSrc = readFileSync(
    fileURLToPath(new URL('../scenes/ArenaScene.js', import.meta.url)),
    'utf8',
  );

  it('gates the debug readout behind import.meta.env.DEV (marker present)', () => {
    // Sanity: the strip helper below is only meaningful if the gate actually
    // exists — this also catches a future accidental removal of the gate.
    expect(arenaSrc).toMatch(/import\.meta\.env\.DEV/);
  });

  it('has no debug-readout reference outside a DEV gate (production build cannot crash)', () => {
    // In a production `vite build`, import.meta.env.DEV is statically false, so the
    // debug readout is never created. Any debug reference living OUTSIDE a DEV gate
    // would then hit an undefined `this.debugText` (or sampling field) at runtime —
    // a crash that no vitest run catches (vitest runs with DEV=true). Strip every
    // DEV block and assert none of the debug identifiers survive.
    const stripped = stripDevBlocks(arenaSrc);
    for (const id of ['debugText', '_simRateSampler', '_ticksPerSec', '_sampleAccumMs', '_lastSampleTicks']) {
      expect(stripped).not.toContain(id);
    }
  });
});
