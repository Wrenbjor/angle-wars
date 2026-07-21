import Phaser from 'phaser';
import { lockLandscape } from './mobileLayout.js';

// BootScene — first scene in the chain.
//
// In a fuller game this is where global settings (input, scale, plugins) are
// initialized before any assets load. For the shell it does the minimum and
// hands off to PreloadScene.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    // Story 7.2: request a best-effort landscape lock at boot. Feature-detected and
    // fail-safe (no-op / rejection swallowed when the Screen Orientation API is
    // absent or the platform rejects — e.g. desktop or not fullscreen); it never
    // throws. Hard native enforcement is Stories 7.3 / 7.6. `screen` may be undefined
    // in a non-browser (test) context, so it is guarded.
    lockLandscape(typeof screen !== 'undefined' ? screen.orientation : null);
    this.scene.start('PreloadScene');
  }
}
