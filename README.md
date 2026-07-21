# Angle Wars

A twin-stick arena shooter built with [Phaser 3](https://phaser.io/) (WebGL) and
[Vite](https://vite.dev/). This is the engine shell: a bounded arena rendered on
a WebGL canvas, driven by a fixed-timestep simulation that is decoupled from the
render frame rate.

## Requirements

- [Node.js](https://nodejs.org/) 18+ and npm.

## Getting started

```bash
npm install     # install dependencies (Phaser, Vite, Vitest)
npm run dev      # start the dev server; open the printed URL
```

You should see a WebGL canvas with a bounded rectangular arena centered in the
window. Resizing the window letterboxes the canvas (preserving aspect ratio)
rather than stretching it. A small debug readout shows render FPS alongside the
simulation tick rate — the sim rate holds steady near `1000 / FIXED_STEP_MS`
regardless of how fast frames render, demonstrating the render/sim decoupling.

## Scripts

| Command           | What it does                                              |
| ----------------- | -------------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server with hot reload.               |
| `npm run build`   | Produce a static production bundle in `dist/`.           |
| `npm run preview` | Serve the built `dist/` bundle locally.                  |
| `npm test`        | Run the Vitest unit tests headlessly (`Pool`, `FixedTimestep`, `World`). |
| `npm run cap:sync`| Copy the built `dist/` into the native (Capacitor) projects + update native deps. |
| `npm run cap:copy`| Copy the built `dist/` into the native projects (assets only, no dep update). |

## Mobile (Capacitor)

The game is wrapped as native iOS/Android apps with
[Capacitor](https://capacitorjs.com/). The native shells load the same
production `dist/` bundle — there is no separate mobile codebase. After a build,
sync the bundle into the native projects:

```bash
npm run build      # produce dist/
npm run cap:sync   # copy dist/ into android/ and ios/
```

Full toolchain prerequisites (Android SDK + JDK 17; macOS + Xcode + CocoaPods for
iOS), the open/build/run flow, and the manual end-to-end device acceptance
checklist live in [`docs/mobile-build.md`](docs/mobile-build.md).

## Project layout

```
index.html                     # page hosting the game mount
src/
  main.js                      # Phaser.Game config (WEBGL, FIT/CENTER_BOTH) + scene chain
  config/constants.js          # centralized tunable constants (no inline magic numbers)
  scenes/
    BootScene.js               # init -> PreloadScene
    PreloadScene.js            # asset stage (no assets yet) -> ArenaScene
    ArenaScene.js              # arena border + fixed-timestep world + debug readout
  core/                        # Phaser-free, unit-testable primitives
    FixedTimestep.js           # accumulator; runs sim at a constant dt
    Pool.js                    # zero-alloc object pool for high-churn entities
    World.js                   # entities + systems container
    System.js                  # base system with fixedUpdate(dt, world) hook
  systems/
    SimClockSystem.js          # example system: counts sim ticks / sim time
```

The `core/` modules never import Phaser, so they run headlessly under Vitest.
