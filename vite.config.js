import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version)) {
  throw new Error(`Invalid package version for build: ${String(packageJson.version)}`);
}

// Vite build + Vitest unit-test config.
// The pure-logic modules (Pool, FixedTimestep, World, System, constants) are
// Phaser-free, so tests run headlessly in the default node environment — no
// jsdom needed.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  // Relative base so the built bundle works when served from any subpath.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Split Phaser (~95% of the bundle) into its own content-hashed vendor
        // chunk so it is cached across deploys — an app-code change re-hashes only
        // the small app chunk, not the large engine chunk.
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
    // Raised deliberately above the split app+vendor chunk sizes so the routine
    // "Some chunks are larger than 500 kB" warning (Phaser is legitimately large)
    // does not fire on every build.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
