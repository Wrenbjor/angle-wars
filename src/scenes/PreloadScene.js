import Phaser from 'phaser';

// PreloadScene — asset-loading stage.
//
// There are no real assets yet (this epic uses placeholder vector shapes), so
// preload() is empty. The scene exists to establish the Boot → Preload → Arena
// sequence that later stories load textures/audio into. Once loading completes,
// it starts ArenaScene.
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    // No assets to load yet. Real textures/audio arrive in later stories.
  }

  create() {
    this.scene.start('ArenaScene');
  }
}
