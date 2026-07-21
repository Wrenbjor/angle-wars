import Phaser from 'phaser';
import { App } from '@capacitor/app';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  COLOR_BACKGROUND,
} from './config/constants.js';
import { BootScene } from './scenes/BootScene.js';
import { PreloadScene } from './scenes/PreloadScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { ArenaScene } from './scenes/ArenaScene.js';
import { SettingsScene } from './scenes/SettingsScene.js';
import {
  wireNativeLifecycle,
  makeLifecycleController,
} from './scenes/nativeLifecycle.js';

// Entry point: build the Phaser.Game config and start the scene chain.
//
// Renderer is forced to WEBGL (not AUTO/Canvas). The Scale manager uses the
// fixed logical arena size with FIT + CENTER_BOTH, so the canvas scales to the
// window while preserving the arena's aspect ratio (letterboxed, not stretched).
const config = {
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: COLOR_BACKGROUND,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
  },
  // Enable the gamepad input plugin so the left stick is readable by the
  // player input sampler. Keyboard is on by default; this opts in the pad.
  input: { gamepad: true },
  scene: [BootScene, PreloadScene, TitleScene, ArenaScene, SettingsScene],
};

const game = new Phaser.Game(config);

// --- Native lifecycle wiring (Story 7.5) ----------------------------------
// Make the app behave like a native app inside the Capacitor WebView: backgrounding
// or losing focus force-pauses an active run (so the player never dies while away —
// FR23), and the Android hardware back button pauses/resumes during a run or safely
// backgrounds otherwise (never an abrupt close). The pure decisions AND the
// controller's FR23 branch logic live (and are unit-tested) in nativeLifecycle;
// makeLifecycleController is the thin adapter over the live game, and
// wireNativeLifecycle is the fail-safe boundary (a missing plugin/method no-ops).
const controller = makeLifecycleController(game, App);

wireNativeLifecycle({
  app: App,
  doc: typeof document !== 'undefined' ? document : null,
  controller,
});
