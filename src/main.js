import Phaser from 'phaser';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  COLOR_BACKGROUND,
} from './config/constants.js';
import { BootScene } from './scenes/BootScene.js';
import { PreloadScene } from './scenes/PreloadScene.js';
import { ArenaScene } from './scenes/ArenaScene.js';

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
  scene: [BootScene, PreloadScene, ArenaScene],
};

new Phaser.Game(config);
