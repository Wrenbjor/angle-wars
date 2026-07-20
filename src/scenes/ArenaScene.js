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
  COLOR_PINWHEEL,
  COLOR_SNAKE,
  COLOR_BLACK_HOLE,
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
  COLOR_PAUSE_OVERLAY,
  PAUSE_OVERLAY_ALPHA,
  COLOR_PAUSE_TEXT,
  PAUSE_TITLE_FONT,
  PAUSE_PROMPT_FONT,
  SPAWN_DIRECTOR_SEEKER_BASE_WEIGHT,
  SPAWN_DIRECTOR_SEEKER_PEAK_WEIGHT,
  SPAWN_DIRECTOR_GREEN_BASE_WEIGHT,
  SPAWN_DIRECTOR_GREEN_PEAK_WEIGHT,
  SPAWN_DIRECTOR_PINWHEEL_BASE_WEIGHT,
  SPAWN_DIRECTOR_PINWHEEL_PEAK_WEIGHT,
  SPAWN_DIRECTOR_SNAKE_BASE_WEIGHT,
  SPAWN_DIRECTOR_SNAKE_PEAK_WEIGHT,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_TELEGRAPH_MIN_ALPHA,
  SPAWN_TELEGRAPH_MIN_SCALE,
  BOMB_SHOCKWAVE_MS,
  BOMB_SHOCKWAVE_MAX_RADIUS,
  COLOR_BOMB_SHOCKWAVE,
  SCREEN_FLASH_MS,
  COLOR_SCREEN_FLASH,
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
import { PinwheelSystem } from '../systems/PinwheelSystem.js';
import { SnakeSystem } from '../systems/SnakeSystem.js';
import { SpawnDirector } from '../systems/SpawnDirector.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { ScoringSystem } from '../systems/ScoringSystem.js';
import { BlackHoleSystem } from '../systems/BlackHoleSystem.js';
import { BombSystem } from '../systems/BombSystem.js';
import { ExtraLifeSystem } from '../systems/ExtraLifeSystem.js';
import { PlayerDeathSystem } from '../systems/PlayerDeathSystem.js';
import { HighScoreSystem } from '../systems/HighScoreSystem.js';
import { createHighScoreStorage } from '../persistence/highScoreStorage.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createScoreState } from '../state/ScoreState.js';
import { PLAYER_INVULN_BLINK_MS } from '../config/constants.js';
import {
  spawnTelegraphProgress,
  telegraphAlpha,
  telegraphScale,
} from './telegraphCue.js';
import { applyAdditiveBlend, addNeonBloom } from './neonStyle.js';
import { PAUSE_TITLE, PAUSE_PROMPT, togglePause } from './pauseControl.js';
import {
  GRID_FRAGMENT_SRC,
  buildGridUniforms,
  packGridUniforms,
} from './gridField.js';
import { GridFieldSystem } from '../systems/GridFieldSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { particleAlpha } from './particleStyle.js';
import { ScreenFeedbackSystem } from '../systems/ScreenFeedbackSystem.js';
import {
  shakeOffsetX,
  shakeOffsetY,
  flashAlpha,
  decayTrauma,
} from './screenShake.js';
import { AudioDirectorSystem } from '../systems/AudioDirectorSystem.js';
import { AudioEngine } from '../audio/audioEngine.js';
import { createSettingsStorage } from '../persistence/settingsStorage.js';
import { FLOW_STATES, FLOW_EVENTS, nextFlowState, sceneForState } from './gameFlow.js';
import {
  musicLayerGains,
  effectiveVolume,
  adjustVolume,
} from '../audio/audioMix.js';
import {
  AUDIO_VOLUME_STEP,
  AUDIO_MUSIC_LAYER_COUNT,
  AUDIO_SFX_FIRE_MAX_PER_FRAME,
  AUDIO_SFX_KILL_MAX_PER_FRAME,
  AUDIO_SFX_SPAWN_MAX_PER_FRAME,
} from '../config/constants.js';

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
    // --- Deforming grid field (Story 4.2) -----------------------------------
    // The signature "living grid": ONE full-arena fragment-shader quad drawn on the
    // GPU, added FIRST so it renders BEHIND every entity/HUD. All ripple + warp
    // deformation happens inside the shader from custom uniforms; the CPU only writes
    // those uniforms (packGridUniforms, once per render frame). The BaseShader is
    // seeded with the uniform config from the Phaser-free gridField seam; per-frame
    // packing targets this.gridShader.uniforms (Phaser deep-copies the config into
    // the live GameObject at creation, so the live copy is the write target). Sized
    // to the arena with a top-left origin so fragment space maps 1:1 to arena pixels.
    this.gridShader = this.add
      .shader(
        new Phaser.Display.BaseShader('grid', GRID_FRAGMENT_SRC, undefined, buildGridUniforms()),
        0,
        0,
        ARENA_WIDTH,
        ARENA_HEIGHT,
      )
      .setOrigin(0, 0);

    // --- Arena border -------------------------------------------------------
    // Kept as an instance ref (this.borderGraphics) so the neon wiring below can
    // include it in the additive-blend layer list (Story 4.1).
    this.borderGraphics = this.add.graphics();
    this.borderGraphics.lineStyle(ARENA_BORDER_THICKNESS, COLOR_ARENA_BORDER, 1);
    this.borderGraphics.strokeRect(
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
    // PinwheelSystem owns its own pool-per-archetype (never merged into another
    // enemy pool). It runs after GreenSquareSystem and BEFORE CollisionSystem, and
    // is INDIFFERENT to the player — its constructor takes only an rng (no ship,
    // no bullet pool). Its trajectory is a constant-speed wandering drift that
    // bounces off the walls, never referencing the ship.
    this.pinwheelSystem = new PinwheelSystem();
    this.world.addSystem(this.pinwheelSystem);
    // SnakeSystem owns its own shared segment pool-per-archetype (never merged
    // into another enemy pool). It runs after PinwheelSystem and BEFORE
    // CollisionSystem, and is INDIFFERENT to the player — its constructor takes
    // only an rng (no ship, no bullet pool). It reads collisionSystem.killedEnemies
    // (late-bound below, after that system exists) only to split the chain where a
    // segment was destroyed the prior tick.
    this.snakeSystem = new SnakeSystem();
    this.world.addSystem(this.snakeSystem);
    // SpawnDirector is the SOLE spawn authority for the four combat archetypes
    // (each no longer self-spawns). It is added AFTER SnakeSystem and BEFORE
    // CollisionSystem so a fresh enemy exists for this tick's collision/death
    // exactly as the old end-of-update self-spawn did (spawned but un-moved this
    // tick). It owns the escalating ramp (interval floor + mix interpolation) and
    // the global active cap; a fresh instance each run (scene.restart) resets it
    // to the base ramp. Default rng (run-scoped randomness).
    this.spawnDirector = new SpawnDirector(
      [
        {
          system: this.enemySystem,
          baseWeight: SPAWN_DIRECTOR_SEEKER_BASE_WEIGHT,
          peakWeight: SPAWN_DIRECTOR_SEEKER_PEAK_WEIGHT,
        },
        {
          system: this.greenSquareSystem,
          baseWeight: SPAWN_DIRECTOR_GREEN_BASE_WEIGHT,
          peakWeight: SPAWN_DIRECTOR_GREEN_PEAK_WEIGHT,
        },
        {
          system: this.pinwheelSystem,
          baseWeight: SPAWN_DIRECTOR_PINWHEEL_BASE_WEIGHT,
          peakWeight: SPAWN_DIRECTOR_PINWHEEL_PEAK_WEIGHT,
        },
        {
          system: this.snakeSystem,
          baseWeight: SPAWN_DIRECTOR_SNAKE_BASE_WEIGHT,
          peakWeight: SPAWN_DIRECTOR_SNAKE_PEAK_WEIGHT,
        },
      ],
      // Default rng (run-scoped randomness); pass the ship so the director keeps
      // every spawn point ≥ SPAWN_SAFE_RADIUS from the player (Story 2.6). The
      // avoid point flows only as a spawn() argument — Pinwheel/Snake never store
      // the ship and stay player-indifferent in their motion.
      undefined,
      this.ship,
    );
    this.world.addSystem(this.spawnDirector);
    // The shared collision seam sees ALL archetype pools as an array, so a bullet
    // can destroy any enemy through one path (no per-type duplicate).
    this.enemyPools = [
      this.enemySystem.enemyPool,
      this.greenSquareSystem.enemyPool,
      this.pinwheelSystem.enemyPool,
      this.snakeSystem.enemyPool,
    ];
    this.collisionSystem = new CollisionSystem(
      this.firingSystem.bulletPool,
      this.enemyPools,
    );
    this.world.addSystem(this.collisionSystem);
    // Late-bind the collision system into the SnakeSystem now that it exists (the
    // segment pool had to be constructed first so the collision system could
    // reference it). Until this is set the snake's split reap is a guarded no-op.
    this.snakeSystem.collisionSystem = this.collisionSystem;

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

    // --- Black Hole hazard --------------------------------------------------
    // The Black Hole is a stationary, HP-based destructible — not a one-hit
    // enemy. It runs AFTER ScoringSystem (so absorbed enemies it appends to
    // collisionSystem.killedEnemies are removed but NOT scored) and BEFORE
    // PlayerDeathSystem (so its holePool joins the death list below). It owns its
    // own prewarmed holePool; it pulls the ship + bullets + enemies, feeds on and
    // is damaged by bullets, absorbs enemies (through the same killedEnemies seam
    // a bullet kill uses), grows + emits seekers at the edge, and on death credits
    // BLACKHOLE_SCORE directly to the shared ScoreState (created above). The
    // spawn target for fed seekers is the shared Seeker pool.
    this.blackHoleSystem = new BlackHoleSystem(
      this.ship,
      this.firingSystem.bulletPool,
      this.enemyPools,
      this.enemySystem.enemyPool,
      this.scoreState,
    );
    this.world.addSystem(this.blackHoleSystem);
    // Late-bind the collision system now that it exists (the hole pool had to be
    // constructed first). Until this is set, enemy absorption is a guarded no-op;
    // gravity and bullet feed still run.
    this.blackHoleSystem.collisionSystem = this.collisionSystem;

    // --- Smart bombs (Story 3.2) --------------------------------------------
    // BombSystem runs AFTER ScoringSystem + BlackHoleSystem and BEFORE
    // PlayerDeathSystem — the load-bearing tick position: (a) bomb-cleared enemies
    // it appends to collisionSystem.killedEnemies are removed but NOT scored (they
    // never reach the multiplier), (b) the score it reads for the +1-bomb 100k
    // award is fully settled this tick (it catches the black-hole payout too), and
    // (c) the clear removes enemies before the death check, so a bomb genuinely
    // rescues the player from an otherwise-lethal contact this tick — but ONLY
    // for the four cleared archetype pools; the Black Hole is NOT cleared and
    // stays lethal through a detonation. It consumes the latched bomb request from
    // the shared InputState, clears the four archetype pools (never the Black
    // Hole), and drives the placeholder shockwave.
    this.bombSystem = new BombSystem(
      this.inputState,
      this.enemyPools,
      this.collisionSystem,
      this.scoreState,
      this.ship,
    );
    this.world.addSystem(this.bombSystem);
    // The placeholder expanding shockwave ring, cleared and redrawn each render
    // frame from the BombSystem's sim-side countdown. Epic 4 replaces this with
    // the real shockwave + screen-shake aesthetic.
    this.bombShockwaveGraphics = this.add.graphics();

    // --- Player death / lives -----------------------------------------------
    // PlayerDeathSystem runs AFTER CollisionSystem so a seeker destroyed by a
    // bullet this tick is already released and cannot also kill the player. It
    // reads the ship, the enemy pools, and the shared PlayerState (lives,
    // invulnerability, game-over), which the render loop reads for the blink.
    // The Black Hole is lethal on contact too, so its holePool is appended to the
    // death list here (that seam reads only {x,y,radius} and never destroys the
    // collider) — but it is deliberately NOT in the CollisionSystem list above,
    // since one bullet must not one-shot a multi-hit hole.
    this.playerState = createPlayerState();

    // --- Extra lives (Story 3.3) --------------------------------------------
    // ExtraLifeSystem runs AFTER ScoringSystem + BlackHoleSystem + BombSystem and
    // BEFORE PlayerDeathSystem — the load-bearing tick position: (a) the score it
    // reads for the milestone award is fully settled this tick (it catches a kill's
    // award AND the black-hole payout with no one-tick lag), and (b) a life earned
    // this tick is banked before the death check, so a threshold-crossing kill on
    // the last life rescues the player from an otherwise-fatal contact this same
    // tick (1→2 award, then 2→1 death, respawn) — symmetric to a bomb clearing
    // enemies before the death check. It reads scoreState.score (never writes it)
    // and only ADDS to PlayerState.lives, the same counter deaths decrement; the
    // HUD already renders LIVES from that field, so no render change is needed.
    this.extraLifeSystem = new ExtraLifeSystem(this.scoreState, this.playerState);
    this.world.addSystem(this.extraLifeSystem);

    this.deathPools = [...this.enemyPools, this.blackHoleSystem.holePool];
    this.playerDeathSystem = new PlayerDeathSystem(
      this.ship,
      this.deathPools,
      this.playerState,
      // Story 3.1: the death seam resets the run multiplier on every death.
      this.scoreState,
    );
    this.world.addSystem(this.playerDeathSystem);

    // --- Persistent high score (Story 3.4) ----------------------------------
    // HighScoreSystem is registered LAST — AFTER PlayerDeathSystem — the
    // load-bearing tick position: PlayerDeathSystem sets playerState.gameOver
    // during its own fixedUpdate, and the world gate (`if (!gameOver)
    // world.fixedUpdate(dt)` below) only stops systems on the NEXT tick, so
    // running last lets this system observe game-over on the very tick it latches
    // and persist the high score then. On all later ticks the world is gated off,
    // and an internal write-once latch makes the save idempotent regardless. It
    // reads scoreState.score + playerState.gameOver (never writes either) and
    // funnels all localStorage access through the guarded port, which degrades to
    // a no-op when the store is unavailable so persistence never breaks the run.
    this.highScoreStorage = createHighScoreStorage();
    this.highScoreSystem = new HighScoreSystem(
      this.scoreState,
      this.playerState,
      this.highScoreStorage,
    );
    this.world.addSystem(this.highScoreSystem);

    // --- Deforming grid field system (Story 4.2) ----------------------------
    // Registered LAST — after HighScoreSystem — so within every fixed tick each
    // input it reads is already final: collisionSystem.bulletKillCount (this tick's
    // bullet kills, before BlackHole/Bomb appends), bombSystem's shockwave latch,
    // playerDeathSystem's death latch, and blackHoleSystem.holePool. It owns a
    // bounded ripple pool + a single warp target and only writes its own state (no
    // gameplay effect); the render loop packs that state into the grid shader's
    // uniforms. A fresh instance each run (scene.restart) resets the grid to calm.
    this.gridFieldSystem = new GridFieldSystem(
      this.collisionSystem,
      this.bombSystem,
      this.playerDeathSystem,
      this.blackHoleSystem.holePool,
    );
    this.world.addSystem(this.gridFieldSystem);

    // --- Pooled particle system (Story 4.3) ---------------------------------
    // Registered LAST — after GridFieldSystem — so within every fixed tick each
    // input it reads is already final: collisionSystem.bulletKillCount/bulletKillX/Y
    // (this tick's bullet kills only, with recycle-proof kill-time snapshots — the
    // SAME source the grid ripple reads), the post-move ship position/facing, and
    // the render-sampled inputState move intent. It owns its own particle Pool and
    // ONLY mutates that pool (no gameplay effect — a pure read-only observer). A
    // fresh instance each run (scene.restart) resets particles to none, matching
    // GridFieldSystem. The render loop draws its active pool as additive neon dots.
    this.particleSystem = new ParticleSystem(
      this.collisionSystem,
      this.ship,
      this.inputState,
    );
    this.world.addSystem(this.particleSystem);
    // Particles are additive-blend neon dots, cleared and redrawn each render frame
    // from the active pool (per-particle color + particleAlpha-derived alpha). Zero
    // per-frame allocation (mirrors the bullet render). Glows under the camera Bloom.
    this.particleGraphics = this.add.graphics();

    // --- Screen juice & feedback system (Story 4.4) -------------------------
    // Registered LAST — after ParticleSystem — so within every fixed tick each input
    // it reads is already final: collisionSystem.bulletKillCount (this tick's bullet
    // kills, the subtle per-kill nudge — the SAME source the grid ripple / particles
    // read), the bombSystem shockwave rising edge (bomb big event), the
    // playerDeathSystem.deathSeq increment (death big event), and the post-move ship
    // + enemy positions (the near-miss proximity scan). It is a PURE read-only
    // observer — it mutates ONLY its own latch fields (no pool, entity, score, life,
    // or death state). The render loop below consumes its latches into real-time
    // countdowns that drive the camera shake, the flash overlay, and the hit-stop
    // freeze. A fresh instance each run (scene.restart) resets the juice to calm,
    // matching GridFieldSystem / ParticleSystem.
    this.screenFeedbackSystem = new ScreenFeedbackSystem(
      this.collisionSystem,
      this.bombSystem,
      this.playerDeathSystem,
      this.ship,
      this.enemyPools,
    );
    this.world.addSystem(this.screenFeedbackSystem);

    // --- Sound & adaptive music system (Story 4.5) --------------------------
    // Registered LAST — after ScreenFeedbackSystem — so within every fixed tick each
    // event source it reads is already final: firingSystem.shotsFiredCount (fire),
    // collisionSystem.bulletKillCount (kill — the SAME source the grid ripple /
    // particles / screen juice read), spawnDirector.spawnCount (spawn), the bombSystem
    // shockwave rising edge (bomb), the playerDeathSystem.deathSeq increment (death),
    // and the spawnDirector difficulty ramp (musicIntensity). It is a PURE read-only
    // observer — it mutates ONLY its own latch fields (no pool, entity, score, life,
    // death, or spawn state). The render loop below consumes its SFX latches (capped
    // per type) into engine blips and maps musicIntensity → per-layer music gains. A
    // fresh instance each run (scene.restart) resets the audio cues to calm, matching
    // GridFieldSystem / ParticleSystem / ScreenFeedbackSystem.
    this.audioDirector = new AudioDirectorSystem(
      this.firingSystem,
      this.collisionSystem,
      this.bombSystem,
      this.playerDeathSystem,
      this.spawnDirector,
    );
    this.world.addSystem(this.audioDirector);

    // --- Audio engine + settings (Story 4.5) --------------------------------
    // The browser-bound procedural synth (Web Audio). Reuse Phaser's own audio
    // context so Phaser handles the autoplay-policy unlock/resume on the first user
    // gesture; a null/blocked context degrades the engine to a silent no-op (like the
    // guarded high-score store). Built fresh each create()/scene.restart() and
    // disposed on the scene `shutdown` event so its continuously-running music
    // oscillators never stack/leak across restarts.
    this.audioEngine = new AudioEngine(this.sound && this.sound.context);
    // Load persisted { muted, volume, fullscreen } through the consolidated guarded
    // port (defaults on a missing/corrupt/blocked store; a legacy {muted,volume}
    // payload loads with fullscreen defaulted) and apply the effective master gain
    // now. ArenaScene keeps its in-run M/-/+ audio behavior byte-identical; the only
    // change is the port and carrying _fullscreen as a READ-ONLY passthrough so a
    // save from here never clobbers the fullscreen field SettingsScene owns.
    this.settingsStorage = createSettingsStorage();
    const settings = this.settingsStorage.load();
    this._muted = settings.muted;
    this._volume = settings.volume;
    this._fullscreen = settings.fullscreen;
    this.audioEngine.setMasterGain(effectiveVolume(this._volume, this._muted));
    // Reusable per-frame music-gain buffer so the render-loop mapping allocates
    // nothing (mirrors the zero-per-frame-allocation discipline).
    this._musicGains = new Array(AUDIO_MUSIC_LAYER_COUNT).fill(0);

    // Persist the current settings AND re-apply the effective master gain. Called
    // after every mute/volume change. Muted ⇒ effective gain 0 (silence) while the
    // sim, latches, and music voices keep running (only master gain is 0).
    const applyAudioSettings = () => {
      // Include _fullscreen (a read-only passthrough here) so an in-run audio save
      // never clobbers the fullscreen field the SettingsScene owns.
      this.settingsStorage.save({
        muted: this._muted,
        volume: this._volume,
        fullscreen: this._fullscreen,
      });
      this.audioEngine.setMasterGain(effectiveVolume(this._volume, this._muted));
    };
    // Keyboard controls (Story 5.3 later owns a settings UI): M toggles mute, and the
    // MINUS / PLUS keys step the volume by AUDIO_VOLUME_STEP (clamped 0..1). These
    // listeners live on the scene input plugin and are torn down/rebuilt across
    // restart (same as the ENTER/SPACE restart handlers below).
    this.input.keyboard.on('keydown-M', () => {
      this._muted = !this._muted;
      applyAudioSettings();
    });
    this.input.keyboard.on('keydown-MINUS', () => {
      this._volume = adjustVolume(this._volume, -AUDIO_VOLUME_STEP);
      applyAudioSettings();
    });
    this.input.keyboard.on('keydown-PLUS', () => {
      this._volume = adjustVolume(this._volume, AUDIO_VOLUME_STEP);
      applyAudioSettings();
    });
    // Dispose the engine on scene shutdown (fires on scene.restart before the next
    // create()), tearing down the persistent music oscillators so a new run never
    // stacks another set on the shared audio context (leak-free restart).
    this.events.once('shutdown', () => {
      this.audioEngine.dispose();
    });

    // Seekers are placeholder blue vector shapes, cleared and redrawn each render
    // frame from the active pool. Epic 4 replaces this with the aesthetic.
    this.seekerGraphics = this.add.graphics();
    // Green squares are placeholder green filled squares, cleared and redrawn
    // each render frame from their pool. Epic 4 replaces this with the aesthetic.
    this.greenSquareGraphics = this.add.graphics();
    // Pinwheels are placeholder filled diamonds (a rotated square drawn as a
    // polygon), cleared and redrawn each render frame from their pool. Epic 4
    // replaces this with the real spinning-pinwheel aesthetic.
    this.pinwheelGraphics = this.add.graphics();
    // Reusable 4-point buffer for the diamond, mutated in place per pinwheel per
    // frame so the render pass allocates nothing (matches the seeker/green-square
    // zero-per-frame render discipline). Points are top/right/bottom/left.
    this._pinwheelPoints = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    // Snakes are placeholder filled circles (one per active segment), cleared and
    // redrawn each render frame from the shared segment pool. Epic 4 replaces this
    // with the real slithering-body aesthetic. Zero per-frame allocation.
    this.snakeGraphics = this.add.graphics();
    // Black holes are placeholder filled circles (the grid-warp visual is Epic 4 /
    // Story 4.2), cleared and redrawn each render frame from the hole pool. Drawn
    // from each instance's own (growing) radius so the shape tracks the gravity/
    // collision value. Zero per-frame allocation.
    this.blackHoleGraphics = this.add.graphics();

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

    // --- Neon aesthetic: additive blend + camera bloom (Story 4.1) ----------
    // View-only. Put every neon vector layer into additive blend so bright
    // shapes accumulate light over the near-black background (the Geometry Wars
    // glow), then register ONE camera-level Bloom post-FX pass so bright
    // elements bleed light across the whole frame. Both are configured ONCE here
    // (never per frame in update()), preserving the zero-per-frame render
    // discipline. The gameOverOverlay (a black dimming rect — additive black is
    // a no-op) and all text objects deliberately stay in NORMAL blend; the
    // camera bloom still gives text a subtle on-theme glow. Bloom at the camera
    // is a single screen-space pass whose cost is independent of entity count —
    // the load-bearing choice for holding 60 FPS in a busy arena (NFR1). The
    // Phaser.BlendModes.ADD value is injected so neonStyle.js stays Phaser-free.
    applyAdditiveBlend(
      [
        this.shipSprite,
        this.bulletGraphics,
        this.seekerGraphics,
        this.greenSquareGraphics,
        this.pinwheelGraphics,
        this.snakeGraphics,
        this.blackHoleGraphics,
        this.bombShockwaveGraphics,
        this.particleGraphics,
        this.borderGraphics,
      ],
      Phaser.BlendModes.ADD,
    );
    addNeonBloom(this.cameras.main);

    // --- Screen juice: flash overlay + render-owned countdowns (Story 4.4) ---
    // A full-view white rectangle, pinned with setScrollFactor(0) so it always
    // covers the view regardless of the camera shake, added AFTER every gameplay
    // layer so a flash washes over them (and BEFORE the debug/HUD/game-over text
    // built below, so those stay legible). Built once here; the render loop only
    // sets its alpha (0 = fully off) from the flash countdown. It stays in NORMAL
    // blend (not the additive neon layer) so the alpha reads as a plain wash.
    this.flashOverlay = this.add.graphics();
    this.flashOverlay.fillStyle(COLOR_SCREEN_FLASH, 1);
    this.flashOverlay.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.flashOverlay.setScrollFactor(0);
    this.flashOverlay.setAlpha(0);

    // Render-owned real-time countdowns for the juice. Owned at the render layer
    // (not the sim) so they play out and settle over real time even while the sim
    // is frozen (game-over or hit-stop) — a frozen full-screen flash must never
    // blank the game-over screen, and a sim frozen by its own hit-stop cannot count
    // itself back out. Fresh (zeroed) each create()/scene.restart() so no residual
    // shake/flash/hit-stop carries into a new run.
    this._trauma = 0;
    this._flashMs = 0;
    this._hitStopMs = 0;
    this._shakePhase = 0;

    // --- Debug readout (DEV-only) -------------------------------------------
    // Developer FPS/sim-ticks diagnostic. Gated behind import.meta.env.DEV so a
    // production `vite build` statically replaces the condition with `false` and
    // tree-shakes the whole readout out of the shipped bundle — players never see
    // it and it stays off the per-frame render path.
    if (import.meta.env.DEV) {
      this.debugText = this.add.text(
        ARENA_BORDER_INSET + 8,
        ARENA_BORDER_INSET + 8,
        '',
        { font: DEBUG_FONT, color: COLOR_DEBUG_TEXT },
      );
      // Pinned (scrollFactor 0): the Story 4.4 camera shake writes cameras.main
      // scrollX/Y, which would otherwise jitter these non-diegetic readouts. Keeping
      // the UI screen-fixed is readability over juice — the shake belongs to the
      // gameplay world, not the score/debug text.
      this.debugText.setScrollFactor(0);
    }

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
    // Pinned (scrollFactor 0) so the camera shake never jitters the readout.
    this.hudText.setScrollFactor(0);

    // --- Game-over overlay --------------------------------------------------
    // A dimming full-arena rectangle plus stacked title / final-score / restart
    // lines, created hidden and toggled on while PlayerState.gameOver. Built
    // once here; the render loop only sets visibility and the final-score text.
    this.gameOverOverlay = this.add.graphics();
    this.gameOverOverlay.fillStyle(COLOR_GAMEOVER_OVERLAY, GAMEOVER_OVERLAY_ALPHA);
    this.gameOverOverlay.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.gameOverOverlay.setVisible(false);
    // Pinned (scrollFactor 0): a death adds the largest shake trauma right as the
    // game-over screen appears, so the dimmer + text must stay screen-fixed rather
    // than jitter with the camera (readability over juice for non-diegetic UI).
    this.gameOverOverlay.setScrollFactor(0);

    const cx = ARENA_WIDTH / 2;
    const cy = ARENA_HEIGHT / 2;
    // Pinned (scrollFactor 0) so the camera shake never jitters these readouts —
    // readability over juice for non-diegetic UI.
    this.gameOverTitle = this.add
      .text(cx, cy - 60, 'GAME OVER', {
        font: GAMEOVER_TITLE_FONT,
        color: COLOR_GAMEOVER_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.gameOverScore = this.add
      .text(cx, cy, '', {
        font: GAMEOVER_SCORE_FONT,
        color: COLOR_GAMEOVER_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.gameOverPrompt = this.add
      .text(cx, cy + 60, 'Press Enter / Space or click to restart    ·    T for Title', {
        font: GAMEOVER_PROMPT_FONT,
        color: COLOR_GAMEOVER_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    // --- Restart input ------------------------------------------------------
    // Enter / Space / pointer begin a fresh run via scene.restart(), which
    // re-runs create() and rebuilds every run-scoped object (pools, ship,
    // PlayerState, ScoreState) from zero. Guarded to only fire while gameOver
    // so an in-run keypress/click never restarts the run. These listeners live
    // on the scene's input plugin and are torn down/rebuilt across restart.
    // A single shared one-shot latch across BOTH game-over exits (restart and
    // return-to-title) so a same-frame Enter+T can only fire ONE transition — the
    // first one wins and the destination is deterministic. It composes with (does
    // not replace) each handler's existing gameOver guard.
    let leaving = false;
    const restart = () => {
      if (leaving) return;
      if (this.playerState.gameOver) {
        leaving = true;
        this.scene.restart();
      }
    };
    this.input.keyboard.on('keydown-ENTER', restart);
    this.input.keyboard.on('keydown-SPACE', restart);
    this.input.on('pointerdown', restart);

    // --- Return to title (Story 5.3 / FR14: no dead ends) -------------------
    // A dedicated `T` key routes from the game-over overlay back to the title,
    // governed by the flow seam: (GAME_OVER, RETURN_TO_TITLE) → TITLE → the scene
    // key sceneForState names. Guarded on the seam result being non-null AND
    // playerState.gameOver (so an in-run press never leaves the arena) AND the shared
    // `leaving` latch (so a same-frame Enter+T is deterministic). Distinct from Story
    // 5.2's Esc/P pause (which still does nothing at game over).
    this.input.keyboard.on('keydown-T', () => {
      if (leaving) return;
      const target = sceneForState(
        nextFlowState(FLOW_STATES.GAME_OVER, FLOW_EVENTS.RETURN_TO_TITLE),
      );
      if (target && this.playerState.gameOver) {
        leaving = true;
        this.scene.start(target);
      }
    });

    // --- Pause overlay (Story 5.2) ------------------------------------------
    // A dimming full-arena rectangle plus a stacked "PAUSED" title and resume
    // prompt, created hidden and toggled on while this._paused. Built once here;
    // update() only sets its visibility. Mirrors the game-over overlay above.
    this._paused = false;
    this.pauseOverlay = this.add.graphics();
    this.pauseOverlay.fillStyle(COLOR_PAUSE_OVERLAY, PAUSE_OVERLAY_ALPHA);
    this.pauseOverlay.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.pauseOverlay.setVisible(false);
    // Pinned (scrollFactor 0) so a lingering camera shake never jitters the
    // dimmer/text — readability over juice for non-diegetic UI.
    this.pauseOverlay.setScrollFactor(0);
    this.pauseTitle = this.add
      .text(cx, cy - 30, PAUSE_TITLE, {
        font: PAUSE_TITLE_FONT,
        color: COLOR_PAUSE_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.pausePrompt = this.add
      .text(cx, cy + 30, PAUSE_PROMPT, {
        font: PAUSE_PROMPT_FONT,
        color: COLOR_PAUSE_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    // --- Pause input --------------------------------------------------------
    // Esc / P toggle pause via the pure togglePause seam. Bound on the scene's
    // keyboard events (the same boundary pattern as the M / restart handlers) so
    // the key still fires while paused — the update loop keeps running and only
    // the sim is gated. Guarded against game-over inside togglePause: a press
    // while gameOver is a no-op (game-over owns its own freeze + restart flow).
    const togglePauseInput = (event) => {
      // Ignore OS key auto-repeat: these keys are bound via scene keyboard
      // events with no registered Key object, so Phaser does NOT suppress
      // held-key repeats for us (each repeat has a distinct timestamp and
      // slips past the duplicate-event bailout). Without this guard, holding
      // Esc/P would flip _paused every repeat tick. A single tap still toggles
      // exactly once (the native KeyboardEvent has repeat === false).
      if (event && event.repeat) return;
      this._paused = togglePause(this._paused, this.playerState.gameOver);
      // On the transition INTO pause, settle the render-owned juice so the
      // PAUSED screen reads cleanly: the top-of-update gate returns before the
      // flash/shake countdowns decay, so a flash or camera shake in flight at
      // pause time would otherwise freeze — washing the overlay near-white or
      // holding a shake offset for the whole pause. Zeroing _flashMs makes the
      // next unpaused frame set flash alpha 0 naturally; the resume path is
      // untouched.
      if (this._paused) {
        this._flashMs = 0;
        this._trauma = 0;
        this.cameras.main.scrollX = 0;
        this.cameras.main.scrollY = 0;
      }
    };
    this.input.keyboard.on('keydown-ESC', togglePauseInput);
    this.input.keyboard.on('keydown-P', togglePauseInput);

    // Sampling state for a once-per-second sim ticks/sec measurement. DEV-only —
    // part of the debug readout, so it is initialized only when the readout exists.
    if (import.meta.env.DEV) {
      this._lastSampleTicks = 0;
      this._sampleAccumMs = 0;
      this._ticksPerSec = 0;
    }
  }

  /**
   * Phaser's render-rate update. It NEVER runs simulation logic directly —
   * it only feeds the render delta to the fixed-timestep accumulator, which
   * runs the world at the constant fixed rate.
   * @param {number} time  Absolute time (ms).
   * @param {number} delta Elapsed render time since last frame (ms).
   */
  update(time, delta) {
    // Story 5.2 pause gate (top of update): mirror the paused flag onto the
    // overlay, then — while paused — FREEZE the whole sim by returning before
    // any input sampling or sim/juice/audio advancement. No fixed step runs, no
    // input is buffered, and the render-owned countdowns do not decay, so the
    // last drawn frame stays on screen and the run resumes bit-identical. The
    // key handlers still fire because the update loop keeps running.
    this.pauseOverlay.setVisible(this._paused);
    this.pauseTitle.setVisible(this._paused);
    this.pausePrompt.setVisible(this._paused);
    if (this._paused) return;

    // Sample input (render rate) before advancing the sim so this frame's
    // fixed steps consume the latest move intent.
    this.inputSampler.sample();

    // Story 4.4 hit-stop: while the render-owned _hitStopMs countdown is running,
    // FREEZE the whole sim (skip feeding the fixed-timestep accumulator) and decay
    // the countdown by the real render delta. This composes with the game-over gate
    // inside the step callback below (game-over freezes the sim too). The countdown
    // MUST live at render level — a sim frozen by its own hit-stop cannot advance a
    // sim-side countdown back out of the freeze.
    if (this._hitStopMs > 0) {
      this._hitStopMs -= delta;
      if (this._hitStopMs < 0) this._hitStopMs = 0;
    } else {
      // Freeze the simulation on game over at sub-step granularity: each fixed
      // sub-step re-checks gameOver, so no system runs once death latches — even
      // mid-frame during multi-sub-step catch-up — keeping the final score stable.
      this.fixedTimestep.advance(delta, (dt) => {
        if (!this.playerState.gameOver) this.world.fixedUpdate(dt);
      });
    }

    // Story 4.4: pull the screen-feedback system's latches into the render-owned
    // countdowns, then advance them by the real render delta so they play out and
    // settle even while the sim is frozen (game-over / hit-stop). Trauma accumulates
    // (clamped to 1 so the shake stays bounded and settles promptly); a raised flash
    // or hit-stop request (re)arms its countdown to the full duration.
    this._trauma += this.screenFeedbackSystem.consumePendingTrauma();
    if (this._trauma > 1) this._trauma = 1;
    const flashRequest = this.screenFeedbackSystem.consumeFlashRequest();
    if (flashRequest > 0) this._flashMs = flashRequest;
    const hitStopRequest = this.screenFeedbackSystem.consumeHitStopRequest();
    if (hitStopRequest > 0) this._hitStopMs = hitStopRequest;

    // Camera shake: advance the oscillation phase by real time, decay the trauma,
    // and write the camera scroll offset from it. At trauma 0 the offset is exactly
    // 0, so the camera returns cleanly to center (no drift). The flash overlay is
    // pinned (setScrollFactor 0) so it covers the view regardless of this shake.
    this._shakePhase += delta;
    this._trauma = decayTrauma(this._trauma, delta);
    this.cameras.main.scrollX = shakeOffsetX(this._trauma, this._shakePhase);
    this.cameras.main.scrollY = shakeOffsetY(this._trauma, this._shakePhase);

    // Flash overlay: decay the flash countdown by real time and set the overlay
    // alpha from it (full at fire, fading to 0). Runs every frame regardless of the
    // sim gate so a game-over flash fades rather than freezing white over the screen.
    if (this._flashMs > 0) {
      this._flashMs -= delta;
      if (this._flashMs < 0) this._flashMs = 0;
    }
    this.flashOverlay.setAlpha(flashAlpha(this._flashMs, SCREEN_FLASH_MS));

    // Story 4.5: drive audio from the director's latches + intensity. Consume the
    // per-event SFX requests (a reused object — no per-frame allocation), capped per
    // accumulating type so a burst / multi-sub-step catch-up frame cannot flood the
    // mixer, and trigger one engine blip per allowed request; bomb/death are one-shot.
    // Then map the live music intensity (the difficulty ramp) through musicLayerGains
    // (into the reused buffer) to the engine's per-layer gains — more difficulty ⇒
    // more layers audible. The engine no-ops when its audio context is unavailable.
    const sfx = this.audioDirector.consumeSfxRequests();
    const fireN = Math.min(sfx.fire, AUDIO_SFX_FIRE_MAX_PER_FRAME);
    for (let i = 0; i < fireN; i++) this.audioEngine.playSfx('fire');
    const killN = Math.min(sfx.kill, AUDIO_SFX_KILL_MAX_PER_FRAME);
    for (let i = 0; i < killN; i++) this.audioEngine.playSfx('kill');
    const spawnN = Math.min(sfx.spawn, AUDIO_SFX_SPAWN_MAX_PER_FRAME);
    for (let i = 0; i < spawnN; i++) this.audioEngine.playSfx('spawn');
    if (sfx.bomb) this.audioEngine.playSfx('bomb');
    if (sfx.death) this.audioEngine.playSfx('death');
    this.audioEngine.setMusicLayerGains(
      musicLayerGains(this.audioDirector.musicIntensity, this._musicGains),
    );

    // Story 4.2: pack the grid system's live ripple + warp state into the shader's
    // uniforms once per render frame (zero allocation — Float32Array/{x,y,z} mutated
    // in place). All deformation is then computed on the GPU inside the fragment
    // shader; the CPU never deforms the grid.
    packGridUniforms(this.gridShader.uniforms, this.gridFieldSystem);

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
    // Story 2.6: a spawning-in seeker fades + scales in (per-instance alpha/radius
    // from its telegraphMs); an active seeker draws exactly as before (p==1).
    const sg = this.seekerGraphics;
    sg.clear();
    this.enemySystem.enemyPool.forEachActive((s) => {
      const p = spawnTelegraphProgress(s.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      sg.fillStyle(COLOR_SEEKER, telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA));
      sg.fillCircle(s.x, s.y, s.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE));
    });

    // Redraw active green squares from their pool: clear once, then a filled
    // green square centered on each live entity. Placeholder shape only (Epic 4
    // adds the aesthetic; aggro state is not visually distinguished yet).
    const gsg = this.greenSquareGraphics;
    gsg.clear();
    // Draw from each instance's own radius (matching the seeker render) so the
    // drawn square always tracks the value the collision seams actually use.
    // Story 2.6: a spawning-in square fades + scales in from its telegraphMs.
    this.greenSquareSystem.enemyPool.forEachActive((s) => {
      const p = spawnTelegraphProgress(s.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      gsg.fillStyle(COLOR_GREEN_SQUARE, telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA));
      const r = s.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE);
      gsg.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    });

    // Redraw active pinwheels from their pool: clear once, then a filled diamond
    // (axis-aligned rhombus) centered on each live entity. Placeholder shape only
    // (Epic 4 adds the real spinning-pinwheel aesthetic). Drawn from each
    // instance's own radius so the shape tracks the collision value.
    const pwg = this.pinwheelGraphics;
    pwg.clear();
    const pwPts = this._pinwheelPoints;
    // Story 2.6: a spawning-in pinwheel fades + scales in from its telegraphMs.
    this.pinwheelSystem.enemyPool.forEachActive((pw) => {
      const p = spawnTelegraphProgress(pw.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      pwg.fillStyle(COLOR_PINWHEEL, telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA));
      const r = pw.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE);
      // Mutate the reusable 4-point buffer in place (top/right/bottom/left) — no
      // per-frame allocation.
      pwPts[0].x = pw.x;
      pwPts[0].y = pw.y - r;
      pwPts[1].x = pw.x + r;
      pwPts[1].y = pw.y;
      pwPts[2].x = pw.x;
      pwPts[2].y = pw.y + r;
      pwPts[3].x = pw.x - r;
      pwPts[3].y = pw.y;
      pwg.fillPoints(pwPts, true);
    });

    // Redraw active snake segments from the shared segment pool: clear once, then
    // a filled circle per live segment (head and body alike). Placeholder shape
    // only (Epic 4 adds the real slithering aesthetic). Drawn from each instance's
    // own radius so the shape tracks the collision value.
    const skg = this.snakeGraphics;
    skg.clear();
    // Story 2.6: a spawning-in snake segment fades + scales in from its telegraphMs
    // (every segment shares the head's value, so the whole chain telegraphs as one).
    this.snakeSystem.enemyPool.forEachActive((seg) => {
      const p = spawnTelegraphProgress(seg.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      skg.fillStyle(COLOR_SNAKE, telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA));
      skg.fillCircle(seg.x, seg.y, seg.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE));
    });

    // Redraw active black holes from the hole pool: clear once, then a filled
    // circle per live hole at its current (growing) radius. Placeholder shape only
    // (Epic 4 / Story 4.2 adds the grid-warp aesthetic). Zero per-frame allocation.
    const bhg = this.blackHoleGraphics;
    bhg.clear();
    // Story 2.6: a spawning-in hole fades + scales in from its telegraphMs.
    this.blackHoleSystem.holePool.forEachActive((h) => {
      const p = spawnTelegraphProgress(h.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      bhg.fillStyle(COLOR_BLACK_HOLE, telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA));
      bhg.fillCircle(h.x, h.y, h.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE));
    });

    // Redraw the placeholder smart-bomb shockwave: a single stroked ring that
    // expands from 0 to BOMB_SHOCKWAVE_MAX_RADIUS and fades out as the sim-side
    // countdown decays. Cleared every frame; drawn only while the countdown runs.
    // Placeholder only (Epic 4 owns the real shockwave + screen-shake aesthetic).
    const swg = this.bombShockwaveGraphics;
    swg.clear();
    const swMs = this.bombSystem.shockwaveMs;
    if (swMs > 0) {
      // progress 0→1 over the countdown (1 at detonation, 0 as it ends).
      const t = Math.min(Math.max(swMs / BOMB_SHOCKWAVE_MS, 0), 1);
      const radius = BOMB_SHOCKWAVE_MAX_RADIUS * (1 - t);
      swg.lineStyle(ARENA_BORDER_THICKNESS, COLOR_BOMB_SHOCKWAVE, t);
      swg.strokeCircle(this.bombSystem.shockwaveX, this.bombSystem.shockwaveY, radius);
    }

    // Redraw active particles from the pool: clear once, then a filled neon dot per
    // live particle at its own color, size, and age-derived alpha (particleAlpha).
    // Additive blend + camera bloom make each dot glow. Rendering reads the sim
    // state; it never advances it. Zero per-frame allocation (mirrors the bullet
    // render). (Story 4.3)
    const ptg = this.particleGraphics;
    ptg.clear();
    this.particleSystem.pool.forEachActive((p) => {
      ptg.fillStyle(p.color, particleAlpha(p.ageMs, p.lifeMs));
      ptg.fillCircle(p.x, p.y, p.size);
    });

    // Sample sim ticks/sec roughly once per second so the readout is steady.
    // DEV-only: gated so a production build eliminates the sampling from the
    // per-frame path (mirrors the debug-text gate in create()).
    if (import.meta.env.DEV) {
      this._sampleAccumMs += delta;
      if (this._sampleAccumMs >= 1000) {
        const ticked = this.simClock.ticks - this._lastSampleTicks;
        this._ticksPerSec = (ticked * 1000) / this._sampleAccumMs;
        this._lastSampleTicks = this.simClock.ticks;
        this._sampleAccumMs = 0;
      }
    }

    // --- HUD + game-over overlay (render only; never advances the sim) -------
    // Read fresh each frame so a kill (score) or a death (lives) shows on the
    // very next frame.
    this.hudText.setText(
      `SCORE ${this.scoreState.score}\nMULT ${this.scoreState.multiplier}×\nBOMBS ${this.scoreState.bombs}\nLIVES ${this.playerState.lives}\nHIGH ${this.highScoreSystem.highScore}`,
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

    // DEV-only developer readout: the per-frame array + string build and setText
    // are gated so a production build tree-shakes them off the render path.
    if (import.meta.env.DEV) {
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
}
