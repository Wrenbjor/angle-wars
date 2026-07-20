import Phaser from 'phaser';

// PreloadScene — asset-loading stage.
//
// There are no real assets yet (this epic uses placeholder vector shapes), so
// preload() is empty. The scene exists to establish the Boot → Preload → Title
// sequence that later stories load textures/audio into. Once loading completes,
// it starts TitleScene (the game's front door, Story 5.1), which in turn starts
// ArenaScene on a start gesture.
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    // No assets to load yet. Real textures/audio arrive in later stories.
  }

  create() {
    this.scene.start('TitleScene');
  }
}
