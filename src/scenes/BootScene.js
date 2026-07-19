import Phaser from 'phaser';

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
    this.scene.start('PreloadScene');
  }
}
