import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { build } from 'vite';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Artifact-surface build test (NFR6). Unlike buildConfig.test.js — which imports
// the vite.config object and regex-matches source text — this test runs the REAL
// Vite production build via the programmatic build() API (inheriting the project
// vite.config.js: base './', manualChunks phaser split, target es2022) into a
// hermetic temp outDir, then asserts against the emitted dist/ files themselves.
// A config that parsed correctly but produced a broken bundle (absolute asset
// paths, a merged Phaser chunk, or an un-tree-shaken debug readout) is caught
// here where it would slip past the config/source guards.

// Project root is two dirs up from src/build/ — the programmatic build resolves
// vite.config.js from here so the config under test is the one that runs.
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

// Deterministic (pid-suffixed, no Date.now/Math.random) absolute temp outDir
// OUTSIDE the project so a test run never clobbers a developer's real
// `npm run build` output in dist/.
const outDir = path.join(tmpdir(), `angle-wars-build-artifact-${process.pid}`);

let indexHtml;
let assetFiles;

beforeAll(async () => {
  // The real `npm run build` runs `vite build` in a fresh process where NODE_ENV
  // is unset, so Vite defaults it to 'production' → import.meta.env.DEV resolves
  // to false → the DEV-gated debug readout is tree-shaken out. Vitest, however,
  // has already set process.env.NODE_ENV='test', and Vite only defaults NODE_ENV
  // when it is unset AND derives import.meta.env.DEV purely from
  // (process.env.NODE_ENV === 'production'). Without forcing it here the
  // programmatic build would run in dev mode and KEEP the debug strings — the
  // opposite of the production artifact this test exists to inspect. Force
  // production for the duration of the build (restoring after) so the emitted
  // files are mode-equivalent to `npm run build`.
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({
      root: projectRoot,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
      },
    });
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
  indexHtml = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assetFiles = readdirSync(path.join(outDir, 'assets'));
}, 180000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('build artifact — relative asset paths (NFR6)', () => {
  it('references every asset with a relative ./ path — none server-absolute or external', () => {
    // Collect every src=/href= attribute value from the emitted index.html.
    const refs = [];
    for (const m of indexHtml.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
      refs.push(m[1]);
    }

    // An empty match set must fail, not vacuously pass. Counted BEFORE filtering
    // so an all-anchor / all-inline page still fails the non-empty guard.
    expect(refs.length).toBeGreaterThan(0);

    // Skip refs that are legitimately not relative filesystem asset paths:
    // data: URIs (Vite inlines small assets under assetsInlineLimit), in-page
    // anchors (#...), mailto:, and blob:. The remaining refs are real emitted
    // asset paths that MUST be relative.
    const skip = (ref) =>
      ref.startsWith('data:') ||
      ref.startsWith('#') ||
      ref.startsWith('mailto:') ||
      ref.startsWith('blob:');

    for (const ref of refs) {
      if (skip(ref)) continue;
      expect(ref.startsWith('./')).toBe(true);
      // Redundant with the ./ check but pins the matrix's explicit prohibitions.
      expect(ref.startsWith('/')).toBe(false);
      expect(/^https?:/i.test(ref)).toBe(false);
    }
  });
});

describe('build artifact — separate content-hashed Phaser vendor chunk (NFR6)', () => {
  it('emits exactly one phaser-<hash>.js and a distinct index-<hash>.js, both wired into index.html', () => {
    // Require a content-hash-length suffix ({8,}) — Vite's default hash is 8
    // base64url chars. A non-hashed name like `phaser-vendor.js` would break the
    // cross-deploy caching this split exists for, so it must NOT satisfy the filter.
    const phaserChunks = assetFiles.filter((f) => /^phaser-[A-Za-z0-9_-]{8,}\.js$/.test(f));
    const appChunks = assetFiles.filter((f) => /^index-[A-Za-z0-9_-]{8,}\.js$/.test(f));

    expect(phaserChunks).toHaveLength(1);
    expect(appChunks.length).toBeGreaterThanOrEqual(1);

    const phaserChunk = phaserChunks[0];
    const appChunk = appChunks[0];

    // Phaser (~95% of the bundle bytes) must genuinely live in its own vendor
    // chunk, not be merged/duplicated into the app chunk. A byte-size comparison
    // proves the bulk actually moved out: the phaser chunk is far larger than the
    // app chunk (>2× is a conservative floor for a ~1.4 MB vs ~50 kB split).
    const phaserSize = statSync(path.join(outDir, 'assets', phaserChunk)).size;
    const appSize = statSync(path.join(outDir, 'assets', appChunk)).size;
    expect(phaserSize).toBeGreaterThan(appSize * 2);

    // The split must be wired into the loaded graph, not an orphan file.
    expect(indexHtml).toContain(phaserChunk);
  });
});

describe('build artifact — debug readout tree-shaken from app chunk (NFR6)', () => {
  it('drops render FPS / sim ticks/s while keeping the GAME OVER positive control', () => {
    const appChunks = assetFiles.filter((f) => /^index-[A-Za-z0-9_-]{8,}\.js$/.test(f));
    expect(appChunks.length).toBeGreaterThanOrEqual(1);

    // Read ALL app chunks and join them — readdirSync order is filesystem-
    // dependent, so picking [0] would be nondeterministic and would miss a debug
    // string that leaked into a second index-*.js chunk.
    const appChunkText = appChunks
      .map((f) => readFileSync(path.join(outDir, 'assets', f), 'utf8'))
      .join('\n');

    // Guard against a vacuous pass: the app chunks must be non-empty AND must
    // contain ArenaScene gameplay code (the plain 'GAME OVER' literal that
    // survives minification). Only then does the debug strings' absence prove
    // tree-shaking (Vite statically resolving import.meta.env.DEV to false and
    // dropping the guarded branch) rather than ArenaScene simply not being here.
    expect(appChunkText.length).toBeGreaterThan(0);
    expect(appChunkText).toContain('GAME OVER');

    expect(appChunkText).not.toContain('render FPS');
    expect(appChunkText).not.toContain('sim ticks/s');

    // Defensive backstop: the debug strings must not leak into ANY emitted JS
    // chunk (e.g. the vendor chunk or a future extra split), not just the app
    // chunks. Scan every *.js asset and assert both strings are absent.
    const allJsText = assetFiles
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(path.join(outDir, 'assets', f), 'utf8'))
      .join('\n');
    expect(allJsText).not.toContain('render FPS');
    expect(allJsText).not.toContain('sim ticks/s');
  });
});
