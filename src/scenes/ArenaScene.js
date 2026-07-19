import Phaser from 'phaser';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  ARENA_BORDER_THICKNESS,
  FIXED_STEP_MS,
  MAX_SUB_STEPS,
  COLOR_ARENA_BORDER,
  COLOR_SHIP,
  SHIP_RADIUS,
  COLOR_BULLET,
  COLOR_SEEKER,
  COLOR_GREEN_SQUARE,
  COLOR_DEBUG_TEXT,
  DEBUG_FONT,
  COLOR_HUD_TEXT,
  HUD_FONT,
  COLOR_GAMEOVER_OVERLAY,
  GAMEOVER_OVERLAY_ALPHA,
  COLOR_GAMEOVER_TEXT,
  GAMEOVER_TITLE_FONT,
  GAMEOVER_SCORE_FONT,
  GAMEOVER_PROMPT_FONT,
} from '../config/constants.js';
import { World } from '../core/World.js';
import { FixedTimestep } from '../core/FixedTimestep.js';
import { SimClockSystem } from '../systems/SimClockSystem.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { InputState } from '../input/InputState.js';
import { PlayerInputSampler } from '../input/PlayerInputSampler.js';
import { PlayerMovementSystem } from '../systems/PlayerMovementSystem.js';
import { FiringSystem } from '../systems/FiringSystem.js';
import { EnemySystem } from '../systems/EnemySystem.js';
import { GreenSquareSystem } from '../systems/GreenSquareSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { ScoringSystem } from '../systems/ScoringSystem.js';
import { PlayerDeathSystem } from '../systems/PlayerDeathSystem.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createScoreState } from '../state/ScoreState.js';
import { PLAYER_INVULN_BLINK_MS } from '../config/constants.js';

// ArenaScene — the playable stage (shell version).
//
// Responsibilities for this story:
//  - draw the bounded arena border,
//  - own a World + FixedTimestep and drive world.fixedUpdate(dt) from Phaser's
//    variable-rate update(), so the simulation is decoupled from render,
//  - show a debug readout comparing render FPS to simulation ticks/sec, making
//    the decoupling observable.
export class ArenaScene extends Phaser.Scene {
  constructor() {
    super('ArenaScene');
  }

  create() {
    // --- Arena border -------------------------------------------------------
    const g = this.add.graphics();
    g.lineStyle(ARENA_BORDER_THICKNESS, COLOR_ARENA_BORDER, 1);
    g.strokeRect(
      ARENA_BORDER_INSET,
      ARENA_BORDER_INSET,
      ARENA_WIDTH - ARENA_BORDER_INSET * 2,
      ARENA_HEIGHT - ARENA_BORDER_INSET * 2,
    );

    // --- Simulation ---------------------------------------------------------
    // The fixed-timestep accumulator releases banked render time to the world
    // in constant FIXED_STEP_MS slices; the spiral guard caps catch-up steps.
    this.fixedTimestep = new FixedTimestep(FIXED_STEP_MS, MAX_SUB_STEPS);
    this.world = new World();
    // SimClockSystem gives the pipeline a real, observable job (tick counting).
    this.simClock = new SimClockSystem();
    this.world.addSystem(this.simClock);

    // --- Player -------------------------------------------------------------
    // The ship is a plain entity moved by the (Phaser-free) movement system
    // inside the fixed-timestep loop. Input is sampled at render rate into a
    // shared InputState the movement system reads at sim rate.
    this.ship = createPlayerShip();
    this.world.addEntity(this.ship);
    this.inputState = new InputState();
    this.inputSampler = new PlayerInputSampler(this, this.inputState, this.ship);
    this.world.addSystem(new PlayerMovementSystem(this.ship, this.inputState));

    // --- Firing -------------------------------------------------------------
    // Added after movement so bullets spawn from the ship's post-move position
    // this tick. Owns its own bullet pool (not world.entities); ArenaScene only
    // reads that pool to render, never runs firing math in the render callback.
    this.firingSystem = new FiringSystem(this.ship, this.inputState);
    this.world.addSystem(this.firingSystem);
    // Bullets are placeholder vector circles, cleared and redrawn each render
    // frame from the active pool. Epic 4 replaces this with the aesthetic.
    this.bulletGraphics = this.add.graphics();

    // --- Enemies ------------------------------------------------------------
    // EnemySystem must run after PlayerMovementSystem so seekers home toward the
    // ship's post-move position this tick (firing does not move the ship);
    // CollisionSystem must run after both FiringSystem and EnemySystem so it sees
    // post-move bullet and seeker positions. Both own no world entities — the
    // enemy pool is the single source of active/free truth, read here only to
    // render (never sim in render).
    this.enemySystem = new EnemySystem(this.ship);
    this.world.addSystem(this.enemySystem);
    // GreenSquareSystem owns its own pool-per-archetype (never merged into the
    // Seeker pool). It runs after EnemySystem and BEFORE CollisionSystem so a
    // provoking latch (bullet within the threat radius) is recorded before a hit
    // can release the square; it reads the bullet pool for that threat detection.
    this.greenSquareSystem = new GreenSquareSystem(
      this.ship,
      this.firingSystem.bulletPool,
    );
    this.world.addSystem(this.greenSquareSystem);
    // The shared collision seam sees ALL archetype pools as an array, so a bullet
    // can destroy any enemy through one path (no per-type duplicate).
    this.enemyPools = [
      this.enemySystem.enemyPool,
      this.greenSquareSystem.enemyPool,
    ];
    this.collisionSystem = new CollisionSystem(
      this.firingSystem.bulletPool,
      this.enemyPools,
    );
    this.world.addSystem(this.collisionSystem);

    // --- Scoring ------------------------------------------------------------
    // ScoringSystem runs immediately after CollisionSystem so this tick's kills
    // (collisionSystem.killedEnemies) are already recorded, and before
    // PlayerDeathSystem — order: …→ Collision → Scoring → PlayerDeath. It owns
    // no pool; it credits each killed enemy's own base value (any archetype)
    // into the shared ScoreState the HUD/game-over screen read. Rebuilt from
    // zero on restart.
    this.scoreState = createScoreState();
    this.scoringSystem = new ScoringSystem(this.collisionSystem, this.scoreState);
    this.world.addSystem(this.scoringSystem);

    // --- Player death / lives -----------------------------------------------
    // PlayerDeathSystem runs AFTER CollisionSystem so a seeker destroyed by a
    // bullet this tick is already released and cannot also kill the player. It
    // reads the ship, the enemy pool, and the shared PlayerState (lives,
    // invulnerability, game-over), which the render loop reads for the blink.
    this.playerState = createPlayerState();
    this.playerDeathSystem = new PlayerDeathSystem(
      this.ship,
      this.enemyPools,
      this.playerState,
    );
    this.world.addSystem(this.playerDeathSystem);
    // Seekers are placeholder blue vector shapes, cleared and redrawn each render
    // frame from the active pool. Epic 4 replaces this with the aesthetic.
    this.seekerGraphics = this.add.graphics();
    // Green squares are placeholder green filled squares, cleared and redrawn
    // each render frame from their pool. Epic 4 replaces this with the aesthetic.
    this.greenSquareGraphics = this.add.graphics();

    // Placeholder vector shape: a triangle with its nose along +x, drawn once
    // in local space (centered on 0,0) and transformed per frame from the ship
    // entity. Epic 4 replaces this with the signature aesthetic.
    this.shipSprite = this.add.graphics();
    this.shipSprite.fillStyle(COLOR_SHIP, 1);
    this.shipSprite.beginPath();
    this.shipSprite.moveTo(SHIP_RADIUS, 0);
    this.shipSprite.lineTo(-SHIP_RADIUS * 0.7, SHIP_RADIUS * 0.7);
    this.shipSprite.lineTo(-SHIP_RADIUS * 0.7, -SHIP_RADIUS * 0.7);
    this.shipSprite.closePath();
    this.shipSprite.fillPath();
    this.shipSprite.setPosition(this.ship.x, this.ship.y);
    this.shipSprite.rotation = this.ship.angle;

    // --- Debug readout ------------------------------------------------------
    this.debugText = this.add.text(
      ARENA_BORDER_INSET + 8,
      ARENA_BORDER_INSET + 8,
      '',
      { font: DEBUG_FONT, color: COLOR_DEBUG_TEXT },
    );

    // --- HUD (score + lives) ------------------------------------------------
    // Live readout of the run economy + remaining lives, top-right so it does
    // not overlap the top-left debug readout. Refreshed each render frame from
    // ScoreState/PlayerState so a kill or a death shows on the next frame.
    // Placeholder styling only (Epic 4 owns the aesthetic).
    this.hudText = this.add.text(
      ARENA_WIDTH - ARENA_BORDER_INSET - 8,
      ARENA_BORDER_INSET + 8,
      '',
      { font: HUD_FONT, color: COLOR_HUD_TEXT, align: 'right' },
    );
    this.hudText.setOrigin(1, 0);

    // --- Game-over overlay --------------------------------------------------
    // A dimming full-arena rectangle plus stacked title / final-score / restart
    // lines, created hidden and toggled on while PlayerState.gameOver. Built
    // once here; the render loop only sets visibility and the final-score text.
    this.gameOverOverlay = this.add.graphics();
    this.gameOverOverlay.fillStyle(COLOR_GAMEOVER_OVERLAY, GAMEOVER_OVERLAY_ALPHA);
    this.gameOverOverlay.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.gameOverOverlay.setVisible(false);

    const cx = ARENA_WIDTH / 2;
    const cy = ARENA_HEIGHT / 2;
    this.gameOverTitle = this.add
      .text(cx, cy - 60, 'GAME OVER', {
        font: GAMEOVER_TITLE_FONT,
        color: COLOR_GAMEOVER_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.gameOverScore = this.add
      .text(cx, cy, '', {
        font: GAMEOVER_SCORE_FONT,
        color: COLOR_GAMEOVER_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.gameOverPrompt = this.add
      .text(cx, cy + 60, 'Press Enter / Space or click to restart', {
        font: GAMEOVER_PROMPT_FONT,
        color: COLOR_GAMEOVER_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);

    // --- Restart input ------------------------------------------------------
    // Enter / Space / pointer begin a fresh run via scene.restart(), which
    // re-runs create() and rebuilds every run-scoped object (pools, ship,
    // PlayerState, ScoreState) from zero. Guarded to only fire while gameOver
    // so an in-run keypress/click never restarts the run. These listeners live
    // on the scene's input plugin and are torn down/rebuilt across restart.
    const restart = () => {
      if (this.playerState.gameOver) {
        this.scene.restart();
      }
    };
    this.input.keyboard.on('keydown-ENTER', restart);
    this.input.keyboard.on('keydown-SPACE', restart);
    this.input.on('pointerdown', restart);

    // Sampling state for a once-per-second sim ticks/sec measurement.
    this._lastSampleTicks = 0;
    this._sampleAccumMs = 0;
    this._ticksPerSec = 0;
  }

  /**
   * Phaser's render-rate update. It NEVER runs simulation logic directly —
   * it only feeds the render delta to the fixed-timestep accumulator, which
   * runs the world at the constant fixed rate.
   * @param {number} time  Absolute time (ms).
   * @param {number} delta Elapsed render time since last frame (ms).
   */
  update(time, delta) {
    // Sample input (render rate) before advancing the sim so this frame's
    // fixed steps consume the latest move intent.
    this.inputSampler.sample();

    // Freeze the simulation on game over at sub-step granularity: each fixed
    // sub-step re-checks gameOver, so no system runs once death latches — even
    // mid-frame during multi-sub-step catch-up — keeping the final score stable.
    this.fixedTimestep.advance(delta, (dt) => {
      if (!this.playerState.gameOver) this.world.fixedUpdate(dt);
    });

    // Sync the placeholder sprite from the ship entity each render frame.
    this.shipSprite.setPosition(this.ship.x, this.ship.y);
    this.shipSprite.rotation = this.ship.angle;
    // Blink the ship while invulnerable to signal the invulnerable state. The
    // toggle derives purely from sim state (invulnMs), so it needs no separate
    // render timer; alpha is solid (1) the instant the window reaches 0.
    const invulnMs = this.playerState.invulnMs;
    this.shipSprite.alpha =
      invulnMs > 0 && Math.floor(invulnMs / PLAYER_INVULN_BLINK_MS) % 2 === 1
        ? 0.25
        : 1;

    // Redraw active bullets from the pool: clear once, then a filled circle per
    // live bullet. Rendering reads the sim state; it never advances it.
    const bg = this.bulletGraphics;
    bg.clear();
    bg.fillStyle(COLOR_BULLET, 1);
    this.firingSystem.bulletPool.forEachActive((b) => {
      bg.fillCircle(b.x, b.y, b.radius);
    });

    // Redraw active seekers from the enemy pool: clear once, then a filled blue
    // circle per live seeker. Placeholder shape only (Epic 4 adds the aesthetic).
    const sg = this.seekerGraphics;
    sg.clear();
    sg.fillStyle(COLOR_SEEKER, 1);
    this.enemySystem.enemyPool.forEachActive((s) => {
      sg.fillCircle(s.x, s.y, s.radius);
    });

    // Redraw active green squares from their pool: clear once, then a filled
    // green square centered on each live entity. Placeholder shape only (Epic 4
    // adds the aesthetic; aggro state is not visually distinguished yet).
    const gsg = this.greenSquareGraphics;
    gsg.clear();
    gsg.fillStyle(COLOR_GREEN_SQUARE, 1);
    // Draw from each instance's own radius (matching the seeker render) so the
    // drawn square always tracks the value the collision seams actually use.
    this.greenSquareSystem.enemyPool.forEachActive((s) => {
      gsg.fillRect(s.x - s.radius, s.y - s.radius, s.radius * 2, s.radius * 2);
    });

    // Sample sim ticks/sec roughly once per second so the readout is steady.
    this._sampleAccumMs += delta;
    if (this._sampleAccumMs >= 1000) {
      const ticked = this.simClock.ticks - this._lastSampleTicks;
      this._ticksPerSec = (ticked * 1000) / this._sampleAccumMs;
      this._lastSampleTicks = this.simClock.ticks;
      this._sampleAccumMs = 0;
    }

    // --- HUD + game-over overlay (render only; never advances the sim) -------
    // Read fresh each frame so a kill (score) or a death (lives) shows on the
    // very next frame.
    this.hudText.setText(
      `SCORE ${this.scoreState.score}\nLIVES ${this.playerState.lives}`,
    );

    const over = this.playerState.gameOver;
    this.gameOverOverlay.setVisible(over);
    this.gameOverTitle.setVisible(over);
    this.gameOverScore.setVisible(over);
    this.gameOverPrompt.setVisible(over);
    if (over) {
      // The frozen (final) score — stable because the sim no longer advances.
      this.gameOverScore.setText(`FINAL SCORE ${this.scoreState.score}`);
    }

    const renderFps = Math.round(this.game.loop.actualFps);
    this.debugText.setText(
      [
        `render FPS : ${renderFps}`,
        `sim ticks/s: ${this._ticksPerSec.toFixed(1)}  (target ${(1000 / FIXED_STEP_MS).toFixed(1)})`,
        `sim ticks  : ${this.simClock.ticks}`,
        `sim time   : ${(this.simClock.simTimeMs / 1000).toFixed(1)}s`,
      ].join('\n'),
    );
  }
}
