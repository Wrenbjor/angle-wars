import { defineConfig } from 'vite';

// Vite build + Vitest unit-test config.
// The pure-logic modules (Pool, FixedTimestep, World, System, constants) are
// Phaser-free, so tests run headlessly in the default node environment — no
// jsdom needed.
export default defineConfig({
  // Relative base so the built bundle works when served from any subpath.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
