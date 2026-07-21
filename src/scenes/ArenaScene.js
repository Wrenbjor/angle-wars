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
  COLOR_MIRROR_REFLECTOR,
  REFLECTOR_BAR_HALF_LENGTH,
  REFLECTOR_BAR_HALF_THICKNESS,
  REFLECTOR_WEIGHT_RADIUS,
  COLOR_DEBUG_TEXT,
  DEBUG_FONT,
  COLOR_HUD_TEXT,
  HUD_FONT,
  HUD_MARGIN,
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
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_TELEGRAPH_MIN_ALPHA,
  SPAWN_TELEGRAPH_MIN_SCALE,
  BOMB_SHOCKWAVE_MS,
  BOMB_SHOCKWAVE_MAX_RADIUS,
  COLOR_BOMB_SHOCKWAVE,
  SCREEN_FLASH_MS,
  COLOR_SCREEN_FLASH,
} from '../config/constants.js';
import { FixedTimestep } from '../core/FixedTimestep.js';
import { SimRateSampler } from '../core/SimRateSampler.js';
import { buildArenaWorld } from './buildArenaWorld.js';
import { PlayerInputSampler } from '../input/PlayerInputSampler.js';
import { PLAYER_INVULN_BLINK_MS } from '../config/constants.js';
import {
  spawnTelegraphProgress,
  telegraphAlpha,
  telegraphScale,
} from './telegraphCue.js';
import { drawTouchOverlay, TOUCH_OVERLAY_STYLE } from './touchOverlay.js';
import {
  readSafeAreaInsetsCss,
  logicalSafeInsets,
  computeMobileLayout,
  resolveDisplaySize,
} from './mobileLayout.js';
import { reflectorEndpoints } from '../systems/mirrorReflectorMath.js';
import { blackHoleInstability } from '../entities/BlackHole.js';
import {
  blackHolePulseColor,
  blackHolePulseAlpha,
} from './blackHoleRender.js';
import { applyAdditiveBlend, addNeonBloom } from './neonStyle.js';
import {
  detectMobile,
  readMobileEnv,
  resolveQualityProfile,
} from '../config/qualityProfile.js';
import { PAUSE_TITLE, PAUSE_PROMPT, togglePause } from './pauseControl.js';
import {
  GRID_FRAGMENT_SRC,
  buildGridUniforms,
  packGridUniforms,
} from './gridField.js';
import { particleAlpha } from './particleStyle.js';
import {
  shakeOffsetX,
  shakeOffsetY,
  flashAlpha,
  decayTrauma,
} from './screenShake.js';
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
    // --- Mobile quality profile (Story 7.4) ---------------------------------
    // Resolve the presentation-cost profile ONCE per create() (device-derived, never
    // per frame): detect mobile / the Capacitor WebView through the fail-safe boundary
    // (any missing/throwing host global degrades to the DESKTOP profile — create never
    // crashes), then map it to a frozen { particleMax, bloom, gridSpacing }. On desktop
    // every field equals today's constant, so the wiring below is byte-identical; on a
    // phone it scales the particle cap, the bloom fill cost, and the grid density DOWN
    // (NFR9, NFR1). It COMPOSES with — never replaces — Reduced Motion (read separately
    // below). Introduces zero new per-frame allocation.
    this._qualityProfile = resolveQualityProfile(
      detectMobile(readMobileEnv(typeof window !== 'undefined' ? window : null)),
    );

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
        new Phaser.Display.BaseShader('grid', GRID_FRAGMENT_SRC, undefined, buildGridUniforms(this._qualityProfile.gridSpacing)),
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
    // Build the entire simulation world — World + ship + input + states + pools
    // + the 20 systems in canonical registration order, with both load-bearing
    // late-binds — via the shared, Phaser-free factory. The scene assigns each
    // returned handle onto this.* (the render loop below reads them) and keeps all
    // Phaser/render setup (graphics, input sampler, audio engine, FixedTimestep)
    // inline. The factory is the seam that makes the load-bearing wiring headlessly
    // assertable (buildArenaWorld.test.js); create() cannot be unit-tested because
    // it needs a live Phaser context.
    const arena = buildArenaWorld({
      particleMax: this._qualityProfile.particleMax,
    });
    this.world = arena.world;
    this.ship = arena.ship;
    this.inputState = arena.inputState;
    this.scoreState = arena.scoreState;
    this.playerState = arena.playerState;
    this.enemyPools = arena.enemyPools;
    this.deathPools = arena.deathPools;
    this.highScoreStorage = arena.highScoreStorage;
    this.simClock = arena.simClock;
    this.playerMovementSystem = arena.playerMovementSystem;
    this.firingSystem = arena.firingSystem;
    this.enemySystem = arena.enemySystem;
    this.greenSquareSystem = arena.greenSquareSystem;
    this.pinwheelSystem = arena.pinwheelSystem;
    this.snakeSystem = arena.snakeSystem;
    this.mirrorReflectorSystem = arena.mirrorReflectorSystem;
    this.spawnDirector = arena.spawnDirector;
    this.collisionSystem = arena.collisionSystem;
    this.scoringSystem = arena.scoringSystem;
    this.blackHoleSystem = arena.blackHoleSystem;
    this.bombSystem = arena.bombSystem;
    this.extraLifeSystem = arena.extraLifeSystem;
    this.playerDeathSystem = arena.playerDeathSystem;
    this.highScoreSystem = arena.highScoreSystem;
    this.gridFieldSystem = arena.gridFieldSystem;
    this.particleSystem = arena.particleSystem;
    this.screenFeedbackSystem = arena.screenFeedbackSystem;
    this.audioDirector = arena.audioDirector;

    // Input sampler + placeholder graphics relocated here from inside the old
    // inline world build (the factory is Phaser-free, so these scene-only Phaser
    // concerns cannot live in it). Kept in their original creation order so the
    // display-object depth/z-order is unchanged: the input sampler (not a display
    // object), then the bullet, bomb-shockwave, and particle graphics — all after
    // the grid/border layers and before the enemy layers below. Each is cleared
    // and redrawn each render frame from its owning system's pool (Epic 4 replaces
    // these placeholders with the real aesthetic).
    // Touch twin-stick (Story 7.1): ensure the game-global touch-pointer pool can
    // track two floating sticks + a concurrent bomb tap. addPointer is CUMULATIVE and
    // the pool is game-global (survives scene.restart), so create() re-running on each
    // game-over→restart would otherwise pile pointers up (3→5→7→…→capped 10 with warns).
    // Raise idempotently: only add the shortfall to reach a fixed target of 3 touch
    // pointers (manager.pointersTotal counts touch pointers; the mouse is separate), a
    // no-op once satisfied.
    const TOUCH_POINTER_TARGET = 3;
    const touchPointerShortfall = TOUCH_POINTER_TARGET - this.input.manager.pointersTotal;
    if (touchPointerShortfall > 0) {
      this.input.addPointer(touchPointerShortfall);
    }
    this.inputSampler = new PlayerInputSampler(this, this.inputState, this.ship);
    this.bulletGraphics = this.add.graphics();
    this.bombShockwaveGraphics = this.add.graphics();
    this.particleGraphics = this.add.graphics();

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
    // Reduced motion (Story 6.1 / WCAG 2.3.1): read ONCE here at create() (never a
    // live re-read mid-run). When on, the render loop suppresses the grid warp, the
    // full-screen flash, and the camera shake — a presentation-only change; the sim,
    // its latches, particles, and audio stay byte-identical. A toggle on the settings
    // screen (reachable only from the title) therefore takes effect on the next run,
    // which is every fresh run and every scene.restart().
    this._reducedMotion = settings.reducedMotion;
    this.audioEngine.setMasterGain(effectiveVolume(this._volume, this._muted));
    // Reusable per-frame music-gain buffer so the render-loop mapping allocates
    // nothing (mirrors the zero-per-frame-allocation discipline).
    this._musicGains = new Array(AUDIO_MUSIC_LAYER_COUNT).fill(0);

    // Persist the current settings AND re-apply the effective master gain. Called
    // after every mute/volume change. Muted ⇒ effective gain 0 (silence) while the
    // sim, latches, and music voices keep running (only master gain is 0).
    const applyAudioSettings = () => {
      // Include _fullscreen and _reducedMotion (read-only passthroughs here) so an
      // in-run audio save never clobbers the fields the SettingsScene owns.
      this.settingsStorage.save({
        muted: this._muted,
        volume: this._volume,
        fullscreen: this._fullscreen,
        reducedMotion: this._reducedMotion,
      });
      this.audioEngine.setMasterGain(effectiveVolume(this._volume, this._muted));
    };
    // Keyboard controls (Story 5.3 later owns a settings UI): M toggles mute, and the
    // MINUS / PLUS keys step the volume by AUDIO_VOLUME_STEP (clamped 0..1). These
    // listeners live on the scene input plugin and are torn down/rebuilt across
    // restart (same as the ENTER/SPACE restart handlers below).
    // event.repeat guard (the Story 5.2 held-key lesson, matching SettingsScene and
    // the pause handler): these keys are bound via scene keyboard events with no
    // registered Key object, so Phaser does NOT suppress OS key auto-repeat — without
    // the guard, holding a key would step every repeat tick and the same control would
    // behave differently in-run vs on the settings screen. A single tap still steps
    // exactly once (the native KeyboardEvent has repeat === false).
    this.input.keyboard.on('keydown-M', (event) => {
      if (event && event.repeat) return;
      this._muted = !this._muted;
      applyAudioSettings();
    });
    this.input.keyboard.on('keydown-MINUS', (event) => {
      if (event && event.repeat) return;
      this._volume = adjustVolume(this._volume, -AUDIO_VOLUME_STEP);
      applyAudioSettings();
    });
    this.input.keyboard.on('keydown-PLUS', (event) => {
      if (event && event.repeat) return;
      this._volume = adjustVolume(this._volume, AUDIO_VOLUME_STEP);
      applyAudioSettings();
    });
    // Dispose the engine on scene shutdown (fires on scene.restart before the next
    // create()), tearing down the persistent music oscillators so a new run never
    // stacks another set on the shared audio context (leak-free restart).
    this.events.once('shutdown', () => {
      this.audioEngine.dispose();
      // Story 7.2: drop the scale `resize` listener so the responsive layout handler
      // does not leak across scene.restart (create() re-registers a fresh one).
      this.scale.off('resize', this._applyMobileLayout, this);
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
    // Mirror Reflectors (Story 6.3) are placeholder spinning dumbbells: a stroked bar
    // line between two filled weight circles, cleared and redrawn each render frame
    // from the reflector pool. Endpoints come from the pure reflectorEndpoints seam so
    // the drawn bar/weights track the exact geometry the system's collision tests use.
    // Zero per-frame allocation aside from the single endpoints object per reflector.
    this.reflectorGraphics = this.add.graphics();

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
        this.reflectorGraphics,
        this.bombShockwaveGraphics,
        this.particleGraphics,
        this.borderGraphics,
      ],
      Phaser.BlendModes.ADD,
    );
    addNeonBloom(this.cameras.main, this._qualityProfile.bloom);

    // --- Touch controls overlay (Story 7.1) ---------------------------------
    // The floating move/aim sticks + smart-bomb button, drawn each active render
    // frame from the sampler's Phaser-free snapshot (base ring + thumb knob per
    // active stick, plus the bomb button). Created AFTER every gameplay layer so the
    // controls read on top of the action, but BEFORE the flash/HUD/overlays so those
    // stay above it. Left in NORMAL blend (a UI element, not a neon gameplay layer).
    // Story 7.2 screen-anchors it: pinned setScrollFactor(0) so the camera shake never
    // drifts the drawn sticks/bomb button, paired with the sampler feeding the model
    // pointer.x/y (base-resolution, shake-free) — the two changes are a package.
    // Cleared when no touch is active / on pause, so nothing lingers.
    this.touchOverlayGraphics = this.add.graphics();
    this.touchOverlayGraphics.setScrollFactor(0);

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
        ARENA_BORDER_INSET + HUD_MARGIN,
        ARENA_BORDER_INSET + HUD_MARGIN,
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
      ARENA_WIDTH - ARENA_BORDER_INSET - HUD_MARGIN,
      ARENA_BORDER_INSET + HUD_MARGIN,
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
      .text(cx, cy + 60, 'Press Enter / Space / gamepad or click to restart    ·    T for Title', {
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
    // A pad-only player must also be able to restart (DW-31): any gamepad button
    // routes through the SAME guarded `restart` closure (shared `leaving` latch +
    // gameOver guard), so it fires only at game over and only once. The gamepad
    // plugin is present only when enabled in the game config, so it is guarded.
    // Restart-only by design — the keyboard `T` remains the sole title route.
    this.input.gamepad?.on('down', restart);

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
      this._simRateSampler = new SimRateSampler(1000);
    }

    // --- Responsive mobile layout, orientation & safe areas (Story 7.2) ------
    // Read the device safe-area insets, convert them through the FIT letterbox to
    // arena-logical units, and push the HUD / DEV debug readout / smart-bomb button
    // in from their edges so none is clipped or under a notch / rounded corner / home
    // indicator (FR21). Applied ONCE here after every UI object exists, then re-applied
    // on every scale `resize` (orientation change / rotate / window resize). With no
    // insets (desktop / no notch) the computed positions equal the fixed base
    // positions verbatim — zero regression. Allocation-free (computed at create + on
    // resize, never per render frame). The listener is torn down in `shutdown` above.
    this._applyMobileLayout();
    this.scale.on('resize', this._applyMobileLayout, this);
  }

  /**
   * Read the CSS safe-area insets, convert them to arena-logical units through the
   * FIT letterbox, and apply the resulting layout to the HUD, the DEV debug readout,
   * and the touch smart-bomb button. Called at the end of create() and on every scale
   * `resize`. Pure math lives in the Phaser-free mobileLayout seam; this method is the
   * thin Phaser boundary that reads the live parent size and writes the positions.
   */
  _applyMobileLayout() {
    // Parent (display) size drives the letterbox bars; fall back to the window if the
    // scale manager has not measured a parent yet (logicalSafeInsets guards ≤ 0).
    // Window-frame assumption: the env(safe-area-inset-*) insets and the FIT letterbox
    // bars are BOTH measured in the window frame, so mixing them is valid only while
    // #game fills the viewport — index.html guarantees a full-window parent (html/body
    // 100% + #game width/height 100%), so the parent frame IS the window frame here.
    // resolveDisplaySize commits to a single frame (parent, else window for BOTH axes)
    // so a half-measured parent can never mix a valid axis with a window axis.
    const { width: parentW, height: parentH } = resolveDisplaySize(this.scale.parentSize, window);
    const insetsCss = readSafeAreaInsetsCss(document, window.getComputedStyle.bind(window));
    const logical = logicalSafeInsets(insetsCss, parentW, parentH, ARENA_WIDTH, ARENA_HEIGHT);
    const layout = computeMobileLayout(logical);
    // The DEV debug readout is created only in a dev build (the whole block is
    // tree-shaken from a production bundle), so its repositioning must live behind the
    // SAME DEV gate — a production build never creates the readout to position.
    if (import.meta.env.DEV) {
      this.debugText.setPosition(layout.debug.x, layout.debug.y);
    }
    this.hudText.setPosition(layout.hud.x, layout.hud.y);
    this.inputSampler.setBombButton(layout.bomb.x, layout.bomb.y, layout.bomb.radius);
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
    if (this._paused) {
      // Story 7.1: clear the touch overlay while paused so no stick/knob lingers
      // frozen over the PAUSED screen, and drop all held touch state — the sampler's
      // touch listeners are frozen while paused, so a finger lifted during the pause
      // would never reconcile and would strand a stick (ship drifting on resume) or a
      // bomb latched at the pause edge (detonating on resume). resetTouch reconciles it.
      this.touchOverlayGraphics.clear();
      this.inputSampler.resetTouch();
      return;
    }

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
    // Reduced motion (Story 6.1 / AC2): still consume + decay the trauma latch above
    // (so the sim state resets identically), but write a ZERO scroll offset so the
    // view never kicks — a render-consumption-layer suppression only.
    this._shakePhase += delta;
    this._trauma = decayTrauma(this._trauma, delta);
    if (this._reducedMotion) {
      this.cameras.main.scrollX = 0;
      this.cameras.main.scrollY = 0;
    } else {
      this.cameras.main.scrollX = shakeOffsetX(this._trauma, this._shakePhase);
      this.cameras.main.scrollY = shakeOffsetY(this._trauma, this._shakePhase);
    }

    // Flash overlay: decay the flash countdown by real time and set the overlay
    // alpha from it (full at fire, fading to 0). Runs every frame regardless of the
    // sim gate so a game-over flash fades rather than freezing white over the screen.
    if (this._flashMs > 0) {
      this._flashMs -= delta;
      if (this._flashMs < 0) this._flashMs = 0;
    }
    // Reduced motion (Story 6.1 / AC2): still decay the flash countdown above (so the
    // latch resets identically), but force the overlay fully transparent so no
    // full-screen flash ever shows — render-consumption-layer suppression only.
    this.flashOverlay.setAlpha(
      this._reducedMotion ? 0 : flashAlpha(this._flashMs, SCREEN_FLASH_MS),
    );

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
    // Story 6.2: map the Black Hole instability LEVEL (max over active holes) into
    // the engine's rising-urgency cue gain — a hole nearing detonation sounds a
    // rising tension tone that falls silent when no hole is unstable. A level (read,
    // never consumed); the audible synthesis is the disclosed manual boundary.
    // Force 0 at game-over: maxInstability is only recomputed inside world.fixedUpdate,
    // which is gated off once gameOver, so a run that ends with a hole still unstable
    // would otherwise freeze the tone droning over the game-over screen.
    this.audioEngine.setBlackHoleUrgency(
      this.playerState.gameOver ? 0 : this.audioDirector.blackHoleInstability,
    );

    // Story 4.2: pack the grid system's live ripple + warp state into the shader's
    // uniforms once per render frame (zero allocation — Float32Array/{x,y,z} mutated
    // in place). All deformation is then computed on the GPU inside the fragment
    // shader; the CPU never deforms the grid.
    // Reduced motion (Story 6.1 / AC2): the third arg forces the packed warp z=0 in
    // the pure seam, flattening the black-hole grid bow without touching the sim;
    // ripple slots pack normally (the calmed ripple is the surviving readable cue).
    packGridUniforms(this.gridShader.uniforms, this.gridFieldSystem, this._reducedMotion);

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
    // circle per live hole at its current radius. Story 6.2: the fill color lerps
    // from the resting purple toward the unstable red and its alpha pulses faster +
    // deeper as the hole's instability (blackHoleInstability(radius)) rises toward
    // detonation — the escalating red-pulse telegraph. The pulse oscillates around
    // the telegraph fade-in alpha (so a spawning-in hole still fades + scales in
    // from its telegraphMs, and a fresh/stable hole at instability 0 does not pulse).
    // Placeholder shape only (Epic 4 / Story 4.2 adds the grid-warp aesthetic). Zero
    // per-frame allocation.
    const bhg = this.blackHoleGraphics;
    bhg.clear();
    this.blackHoleSystem.holePool.forEachActive((h) => {
      const p = spawnTelegraphProgress(h.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      const ratio = blackHoleInstability(h.radius);
      const baseAlpha = telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA);
      // Reduced motion (Story 6.1 / AC2, WCAG 2.3.1): keep the escalating red COLOR
      // as the static, readable instability cue, but suppress the TEMPORAL alpha
      // oscillation (no flashing in the seizure band) by passing this._reducedMotion.
      bhg.fillStyle(
        blackHolePulseColor(ratio),
        blackHolePulseAlpha(ratio, time, baseAlpha, this._reducedMotion),
      );
      bhg.fillCircle(h.x, h.y, h.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE));
    });

    // Redraw active mirror reflectors from the reflector pool: clear once, then per
    // live reflector a stroked bar line between two filled weight circles, drawn in
    // COLOR_MIRROR_REFLECTOR. The endpoints (and the drawn bar half-length + weight
    // radius) are scaled by telegraphScale and drawn at telegraphAlpha so a spawning-in
    // reflector fades + scales in from its telegraphMs (Story 2.6), and the spin reads
    // directly from each instance's own `angle`. Placeholder shape only (Epic 4 adds the
    // real chrome-dumbbell aesthetic). Endpoints via the pure reflectorEndpoints seam so
    // the drawn geometry tracks the values the system's collision tests use.
    const rfg = this.reflectorGraphics;
    rfg.clear();
    this.mirrorReflectorSystem.enemyPool.forEachActive((r) => {
      const p = spawnTelegraphProgress(r.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      const alpha = telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA);
      const scale = telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE);
      const ends = reflectorEndpoints(r.x, r.y, r.angle, REFLECTOR_BAR_HALF_LENGTH * scale);
      // Bar: a stroked line the reflect proximity band wide (2 × half-thickness).
      rfg.lineStyle(REFLECTOR_BAR_HALF_THICKNESS * 2 * scale, COLOR_MIRROR_REFLECTOR, alpha);
      rfg.beginPath();
      rfg.moveTo(ends.ax, ends.ay);
      rfg.lineTo(ends.bx, ends.by);
      rfg.strokePath();
      // Weights: a filled circle at each endpoint.
      rfg.fillStyle(COLOR_MIRROR_REFLECTOR, alpha);
      rfg.fillCircle(ends.ax, ends.ay, REFLECTOR_WEIGHT_RADIUS * scale);
      rfg.fillCircle(ends.bx, ends.by, REFLECTOR_WEIGHT_RADIUS * scale);
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

    // Story 7.1: draw the touch overlay from the sampler's snapshot while touch is
    // the driving input, else clear it. Runs at render rate after sample() (which
    // updated the touch model this frame). The draw helper self-clears, so a
    // released stick leaves no stale graphic; the else-clear covers the frame touch
    // ends and every non-touch frame (gamepad/kbm player never sees the overlay).
    if (this.inputSampler.isTouchActive()) {
      drawTouchOverlay(
        this.touchOverlayGraphics,
        this.inputSampler.touchSnapshot(),
        TOUCH_OVERLAY_STYLE,
      );
    } else {
      this.touchOverlayGraphics.clear();
    }

    // Sample sim ticks/sec roughly once per second so the readout is steady.
    // DEV-only: gated so a production build eliminates the sampling from the
    // per-frame path (mirrors the debug-text gate in create()).
    if (import.meta.env.DEV) {
      this._simRateSampler.update(delta, this.simClock.ticks);
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
          `sim ticks/s: ${this._simRateSampler.ticksPerSec.toFixed(1)}  (target ${(1000 / FIXED_STEP_MS).toFixed(1)})`,
          `sim ticks  : ${this.simClock.ticks}`,
          `sim time   : ${(this.simClock.simTimeMs / 1000).toFixed(1)}s`,
        ].join('\n'),
      );
    }
  }
}
