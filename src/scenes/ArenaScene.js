import Phaser from 'phaser';
import { Haptics } from '@capacitor/haptics';
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
  COLOR_RICOCHET,
  COLOR_SEEKER,
  COLOR_GREEN_SQUARE,
  COLOR_PINWHEEL,
  COLOR_SNAKE,
  COLOR_MIRROR_REFLECTOR,
  COLOR_ARMORED,
  ARMORED_HP,
  REFLECTOR_BAR_HALF_LENGTH,
  REFLECTOR_BAR_HALF_THICKNESS,
  REFLECTOR_WEIGHT_RADIUS,
  COLOR_XP_ORB,
  XP_ORB_RADIUS,
  COLOR_ORBIT_BLADE,
  ORBIT_BLADE_RADIUS,
  COLOR_SEEKER_DRONE,
  SEEKER_DRONE_RADIUS,
  COLOR_DRONE_SHOT,
  SEEKER_DRONE_SHOT_RADIUS,
  COLOR_MINE_ARMED,
  COLOR_MINE_UNARMED,
  MINE_RADIUS,
  COLOR_LANCE_BOLT,
  COLOR_LANCE_TRAIL,
  LANCE_BOLT_RADIUS,
  LANCE_TRAIL_NODE_RADIUS,
  COLOR_FLAK_FRAGMENT,
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
  LEVELUP_TIME_SCALE,
  LEVELUP_CONFIRM_GRACE_MS,
  MOVE_DEADZONE,
  LEVELUP_OVERLAY_ALPHA,
  COLOR_LEVELUP_PANEL,
  LEVELUP_PANEL_ALPHA,
  COLOR_LEVELUP_PANEL_FOCUS,
  LEVELUP_PANEL_FOCUS_ALPHA,
  COLOR_LEVELUP_PANEL_BORDER,
  LEVELUP_PANEL_BORDER_WIDTH,
  LEVELUP_PANEL_FOCUS_BORDER_WIDTH,
  COLOR_LEVELUP_TEXT,
  LEVELUP_HEADING_FONT,
  LEVELUP_CARD_TITLE_FONT,
  LEVELUP_PROMPT_FONT,
  LEVELUP_CARD_WIDTH,
  LEVELUP_CARD_HEIGHT,
  LEVELUP_CARD_GAP,
  LEVELUP_PROMPT_Y_OFFSET,
  LEVELUP_CARD_BANISH_SIZE,
  LEVELUP_CARD_BANISH_MARGIN,
  LEVELUP_CARD_BANISH_FONT,
  LEVELUP_CARD_BANISH_GLYPH,
  COLOR_LEVELUP_ACTION,
  LEVELUP_ACTION_ALPHA,
  COLOR_LEVELUP_ACTION_DEPLETED,
  LEVELUP_ACTION_DEPLETED_ALPHA,
  COLOR_LEVELUP_ACTION_BORDER,
  LEVELUP_ACTION_BORDER_WIDTH,
  COLOR_LEVELUP_ACTION_TEXT,
  COLOR_LEVELUP_ACTION_TEXT_DEPLETED,
  LEVELUP_ACTION_FONT,
  LEVELUP_ACTION_WIDTH,
  LEVELUP_ACTION_HEIGHT,
  LEVELUP_ACTION_GAP,
  LEVELUP_ACTION_Y_OFFSET,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_TELEGRAPH_MIN_ALPHA,
  SPAWN_TELEGRAPH_MIN_SCALE,
  BOMB_SHOCKWAVE_MS,
  BOMB_SHOCKWAVE_MAX_RADIUS,
  COLOR_BOMB_SHOCKWAVE,
  SCREEN_FLASH_MS,
  COLOR_SCREEN_FLASH,
  GOVERNOR_BOOST_DPS,
  GOVERNOR_BOOST_DURATION_MS,
} from '../config/constants.js';
import { FixedTimestep } from '../core/FixedTimestep.js';
import { SimRateSampler } from '../core/SimRateSampler.js';
import { buildArenaWorld } from './buildArenaWorld.js';
import { PlayerInputSampler } from '../input/PlayerInputSampler.js';
import { INPUT_METHOD } from '../input/inputMethod.js';
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
import { decideKeepAwake } from './nativeLifecycle.js';
import {
  emitHaptic,
  acquireWakeLock,
  releaseWakeLock,
} from './nativeFeel.js';
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
    // + the 21 systems in canonical registration order, with both load-bearing
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
    this.armoredSystem = arena.armoredSystem;
    this.spawnDirector = arena.spawnDirector;
    this.collisionSystem = arena.collisionSystem;
    // Story 10.5: the Afterburner dash runtime. Held so the per-frame render can push
    // its ownership state into the touch dash button's gate (see update()).
    this.dashSystem = arena.dashSystem;
    // Story 11.1: the Orbit Blade runtime. Held so the per-frame render can draw one
    // filled circle per active blade from its pool.
    this.orbitBladeSystem = arena.orbitBladeSystem;
    // Story 11.2: the Seeker Drones runtime. Held so the per-frame render can draw one
    // filled circle per active drone AND per active shot from its two pools.
    this.seekerDroneSystem = arena.seekerDroneSystem;
    // Story 11.3: the Mine Layer runtime. Held so the per-frame render can draw one filled
    // circle per active mine from its pool, armed-vs-unarmed by colour.
    this.mineLayerSystem = arena.mineLayerSystem;
    // Story 11.4: the Piercing Lance runtime. Held so the per-frame render can draw one filled
    // circle per active bolt AND per active trail node from its two pools.
    this.piercingLanceSystem = arena.piercingLanceSystem;
    // Story 11.6: the Flak Burst runtime. Held so the per-frame render can draw one filled
    // circle per active fragment from its pool.
    this.flakSystem = arena.flakSystem;
    this.scoringSystem = arena.scoringSystem;

    this.dpsTelemetrySystem = arena.dpsTelemetrySystem;
    this.blackHoleSystem = arena.blackHoleSystem;
    this.bombSystem = arena.bombSystem;
    this.xpOrbSystem = arena.xpOrbSystem;
    this.levelSystem = arena.levelSystem;
    this.levelUpSystem = arena.levelUpSystem;
    this.progressionState = arena.progressionState;
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

    // --- Native feel + keep-awake (Story 7.5) --------------------------------
    // Keep-awake edge state: the wake lock is requested/released only when the
    // desired-awake boolean flips (never per frame), tracked here + released on
    // shutdown so a held lock never leaks across a scene.restart. The sentinel is
    // whatever acquireWakeLock returns (a WakeLockSentinel promise on device, null
    // on an unsupported host); releaseWakeLock accepts either.
    this._displayAwake = false;
    this._wakeSentinel = null;
    // Reused scratch for the per-frame decideKeepAwake call so the keep-awake path
    // allocates nothing per frame (NFR2). runActive is always true inside a running
    // ArenaScene; paused/gameOver are refreshed each frame before the decision.
    this._keepAwakeState = { runActive: true, paused: false, gameOver: false };
    // One-shot recovery from an INVOLUNTARY wake-lock release (thermal / battery-saver,
    // no visibilitychange): drop the intent latch so the next update() re-acquires while
    // still in play. Stable bound closure (created once, not per frame).
    this._onWakeLockReleased = () => {
      this._displayAwake = false;
    };
    // Stable bound haptic sink (created ONCE per create(), not per frame — no
    // per-frame allocation). ArenaScene ALWAYS drains the pulses each frame
    // (deterministic); emitHaptic is the pure Reduced-Motion gate that only touches the
    // fail-safe Haptics boundary when Reduced Motion is off — output-layer suppression
    // exactly like screen-shake/flash (the drain still empties either way).
    // `this._reducedMotion` is read live at call time through the closure.
    this._drainHapticSink = (style) => emitHaptic(this._reducedMotion, Haptics, style);

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
      // Story 7.5: release the screen wake lock on shutdown (scene.restart / leaving
      // the arena) so a lock held during play never leaks across runs. Fail-safe: a
      // null sentinel is a no-op.
      releaseWakeLock(this._wakeSentinel);
      this._wakeSentinel = null;
      this._displayAwake = false;
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
    // Armored enemies (Story 9.3) are placeholder filled steel circles, cleared and
    // redrawn each render frame from the ArmoredSystem's pool. On top of the base
    // fill an inner durability disc shrinks with remaining hp (s.hp / ARMORED_HP), so
    // a battered armored reads visibly closer to death. Epic 4 replaces this with the
    // real armored aesthetic. Zero per-frame allocation (mirrors the seeker render).
    this.armoredGraphics = this.add.graphics();
    // XP orbs (Story 8.1) are placeholder filled teal dots (one per active orb),
    // cleared and redrawn each render frame from the XpOrbSystem's pool. Drawn above
    // the enemy layers so a dropped pickup reads clearly. Epic 8 later stories own the
    // real aesthetic. Zero per-frame allocation (mirrors the particle/bullet render).
    this.xpOrbGraphics = this.add.graphics();
    // Orbit Blade blades (Story 11.1) are placeholder filled neon dots (one per active
    // blade), cleared and redrawn each render frame from the OrbitBladeSystem's pool. Drawn
    // above the enemy/xp layers and just below the ship — the ring hugs the ship, so it
    // reads as the player's own weapon. Epic 4 owns the real aesthetic. Zero per-frame
    // allocation (mirrors the xp-orb/particle render).
    this.orbitBladeGraphics = this.add.graphics();
    // Seeker Drone drones + shots (Story 11.2) are placeholder filled neon dots (one per
    // active drone, one per active shot), cleared and redrawn each render frame from the
    // SeekerDroneSystem's two pools. Drawn above the enemy/xp layers with the drones — the
    // ring hugs the ship like the blades, and the shots read as the player's own fire. Epic
    // 4 owns the real aesthetic. Zero per-frame allocation (mirrors the orbit-blade render).
    this.seekerDroneGraphics = this.add.graphics();
    this.droneShotGraphics = this.add.graphics();
    // Mine Layer mines (Story 11.3) are placeholder filled neon dots (one per active mine),
    // cleared and redrawn each render frame from the MineLayerSystem's pool. Coloured
    // COLOR_MINE_ARMED when armed (ageMs >= armMs) else COLOR_MINE_UNARMED, so armed-vs-unarmed
    // reads at a glance (the epic's UX note). Drawn above the enemy/xp layers with the other
    // exotic weapons; reads sim state only. Epic 4 owns the real aesthetic. Zero per-frame
    // allocation (mirrors the orbit-blade/drone render).
    this.mineGraphics = this.add.graphics();
    // Piercing Lance bolts + trail nodes (Story 11.4) are placeholder filled neon dots (one per
    // active bolt, one per active trail node), cleared and redrawn each render frame from the
    // PiercingLanceSystem's two pools. The bolt is a hot-violet LANCE_BOLT_RADIUS dot; the trail
    // node a dimmer, wider LANCE_TRAIL_NODE_RADIUS dot, so a bolt's fading wake reads at a
    // glance (the epic's legibility note). Drawn above the enemy/xp layers with the other exotic
    // weapons; reads sim state only. Epic 4 owns the real aesthetic. Zero per-frame allocation
    // (mirrors the mine/drone render).
    this.lanceBoltGraphics = this.add.graphics();
    this.lanceTrailGraphics = this.add.graphics();
    this.flakGraphics = this.add.graphics();

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
        this.armoredGraphics,
        this.xpOrbGraphics,
        this.orbitBladeGraphics,
        this.seekerDroneGraphics,
        this.droneShotGraphics,
        this.mineGraphics,
        this.lanceTrailGraphics,
        this.lanceBoltGraphics,
        this.flakGraphics,
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

      // --- Governor boost trigger (Story 9.4, DEV-only) --------------------
      // Press G to fire a large transient power spike into the SAME `dps` signal
      // the governor consumes (the reusable applyBoost hook Epic 13 will drive):
      // the DEV `dps`/`boost`/`pressure` readout climbs then re-settles over the
      // fade window, so the spike is observable live. Inside import.meta.env.DEV
      // so a production build statically drops both the handler and the readout.
      this.input.keyboard.on('keydown-G', (event) => {
        // Ignore OS key auto-repeat (Story 5.2 held-key lesson) so holding G does
        // not stack a fresh boost every repeat frame — one press, one spike.
        if (event && event.repeat) return;
        this.dpsTelemetrySystem.applyBoost(
          GOVERNOR_BOOST_DPS,
          GOVERNOR_BOOST_DURATION_MS,
        );
      });
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
      // Story 8.3: while the level-up overlay is open, Esc/P must not ENTER pause (the
      // modal selection owns the moment — a dilation, not a freeze). But RESUMING must
      // stay allowed: a forced pause (visibilitychange / backgrounding, desktop web
      // included) can fire mid-selection, and a paused sim early-returns update() before
      // LevelUpSystem drains the pick — so if Esc/P could not resume, selectionActive
      // would stick true forever (deadlock). Suppress only the enter-pause edge.
      if (this.levelUpSystem.selectionActive && !this._paused) return;
      // Route through setPaused so the render-juice settle runs on the pause edge —
      // shared with the native lifecycle (background / back-button) pause path.
      this.setPaused(togglePause(this._paused, this.playerState.gameOver));
    };
    this.input.keyboard.on('keydown-ESC', togglePauseInput);
    this.input.keyboard.on('keydown-P', togglePauseInput);

    // --- Level-up card overlay (Story 8.3) ----------------------------------
    // The modal three-card draft shown while LevelUpSystem.selectionActive: a dim
    // full-arena rect (reusing COLOR_PAUSE_OVERLAY), a "LEVEL UP" heading, three card
    // panels + titles, and a prompt line. Created hidden + pinned setScrollFactor(0),
    // layered ABOVE the pause/game-over overlays (built last here). The render loop
    // toggles visibility, redraws the panels (focus highlight), and sets the titles +
    // prompt. All positions are computed once here (no per-frame layout).
    this._cardFocus = 0;
    // Render-owned level-up UI state (mirrors the flash/hit-stop render countdowns):
    //  - _wasSelectionActive : previous frame's selectionActive, for the false→true
    //    edge that resets focus + arms the confirm-grace.
    //  - _lastOffer          : the currentOffer identity last seen, so a FRESH offer
    //    after a pick (multi-level jump) also resets focus + re-arms the grace.
    //  - _cardConfirmGraceMs : real-time countdown during which CONFIRM is ignored.
    //  - _padNavLatched      : edge latch so a held d-pad/stick direction steps the
    //    focus once per press, not every polled frame.
    this._wasSelectionActive = false;
    this._lastOffer = null;
    this._cardConfirmGraceMs = 0;
    this._padNavLatched = false;
    // Precompute the three panel rects (top-left x/y + size + center), centered
    // horizontally around cx and vertically around cy — reused for both the draw and
    // the pointer hit-test so the drawn geometry IS the touch target.
    const cardsTotalW = LEVELUP_CARD_WIDTH * 3 + LEVELUP_CARD_GAP * 2;
    const cardsStartX = cx - cardsTotalW / 2;
    const cardPanelY = cy - LEVELUP_CARD_HEIGHT / 2;
    this._cardRects = [];
    // Story 8.5: a per-card banish glyph rect in each panel's TOP-RIGHT corner — the
    // touch/mouse affordance to banish a SPECIFIC card (hit-tested BEFORE the card-commit
    // rect so a tap on it banishes rather than picks). Same index as _cardRects[i].
    this._cardBanishRects = [];
    for (let i = 0; i < 3; i++) {
      const rx = cardsStartX + i * (LEVELUP_CARD_WIDTH + LEVELUP_CARD_GAP);
      this._cardRects.push({
        x: rx,
        y: cardPanelY,
        w: LEVELUP_CARD_WIDTH,
        h: LEVELUP_CARD_HEIGHT,
        cx: rx + LEVELUP_CARD_WIDTH / 2,
        cy: cardPanelY + LEVELUP_CARD_HEIGHT / 2,
      });
      const bx =
        rx + LEVELUP_CARD_WIDTH - LEVELUP_CARD_BANISH_MARGIN - LEVELUP_CARD_BANISH_SIZE;
      const by = cardPanelY + LEVELUP_CARD_BANISH_MARGIN;
      this._cardBanishRects.push({
        x: bx,
        y: by,
        w: LEVELUP_CARD_BANISH_SIZE,
        h: LEVELUP_CARD_BANISH_SIZE,
        cx: bx + LEVELUP_CARD_BANISH_SIZE / 2,
        cy: by + LEVELUP_CARD_BANISH_SIZE / 2,
      });
    }
    // Dimming rect (reuses the pause overlay color).
    this.levelUpOverlay = this.add.graphics();
    this.levelUpOverlay.fillStyle(COLOR_PAUSE_OVERLAY, LEVELUP_OVERLAY_ALPHA);
    this.levelUpOverlay.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.levelUpOverlay.setVisible(false);
    this.levelUpOverlay.setScrollFactor(0);
    // Panel graphics: one Graphics cleared + redrawn each frame (the focused panel
    // strokes brighter/thicker — the bomb-pressed idiom).
    this.cardPanelGraphics = this.add.graphics();
    this.cardPanelGraphics.setScrollFactor(0);
    this.cardPanelGraphics.setVisible(false);
    // "LEVEL UP" heading above the panels.
    this.levelUpHeading = this.add
      .text(cx, cardPanelY - 60, 'LEVEL UP', {
        font: LEVELUP_HEADING_FONT,
        color: COLOR_LEVELUP_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    // One title Text per panel, centered on each card.
    this.cardTitles = this._cardRects.map((r) =>
      this.add
        .text(r.cx, r.cy, '', {
          font: LEVELUP_CARD_TITLE_FONT,
          color: COLOR_LEVELUP_TEXT,
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setVisible(false),
    );
    // Story 8.5: one banish-glyph label per card, centered on its top-right glyph rect.
    // Drawn (with its rect) in the card-panel render loop; dimmed when banishCharges===0.
    this.cardBanishLabels = this._cardBanishRects.map((b) =>
      this.add
        .text(b.cx, b.cy, LEVELUP_CARD_BANISH_GLYPH, {
          font: LEVELUP_CARD_BANISH_FONT,
          color: COLOR_LEVELUP_ACTION_TEXT,
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setVisible(false),
    );
    // Prompt line below the panels (text set per-frame from the active input method).
    this.levelUpPrompt = this.add
      .text(cx, cardPanelY + LEVELUP_CARD_HEIGHT + LEVELUP_PROMPT_Y_OFFSET, '', {
        font: LEVELUP_PROMPT_FONT,
        color: COLOR_LEVELUP_TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    // --- Reroll / Banish action controls (Story 8.5) ------------------------
    // Two labelled action buttons (index 0 = Reroll, index 1 = Banish) below the prompt,
    // each showing its remaining charge count with an enabled vs depleted (count 0) look.
    // Precompute the two rects (top-left x/y + size + center), centered horizontally
    // around cx — reused for both the draw and the pointer hit-test so the drawn geometry
    // IS the touch target (mirrors the card-rect idiom). Redrawn each frame in update().
    const actionsTotalW = LEVELUP_ACTION_WIDTH * 2 + LEVELUP_ACTION_GAP;
    const actionsStartX = cx - actionsTotalW / 2;
    const actionY =
      cardPanelY +
      LEVELUP_CARD_HEIGHT +
      LEVELUP_PROMPT_Y_OFFSET +
      LEVELUP_ACTION_Y_OFFSET;
    this._actionRects = [];
    for (let i = 0; i < 2; i++) {
      const rx = actionsStartX + i * (LEVELUP_ACTION_WIDTH + LEVELUP_ACTION_GAP);
      this._actionRects.push({
        kind: i === 0 ? 'reroll' : 'banish',
        x: rx,
        y: actionY,
        w: LEVELUP_ACTION_WIDTH,
        h: LEVELUP_ACTION_HEIGHT,
        cx: rx + LEVELUP_ACTION_WIDTH / 2,
        cy: actionY + LEVELUP_ACTION_HEIGHT / 2,
      });
    }
    // Panel graphics for the two buttons: one Graphics cleared + redrawn each frame with
    // the enabled/depleted fill+border keyed to the matching live charge count.
    this.actionPanelGraphics = this.add.graphics();
    this.actionPanelGraphics.setScrollFactor(0);
    this.actionPanelGraphics.setVisible(false);
    // One label Text per button, centered on each rect (text + color set per-frame from
    // the live charge count — dimmed when depleted).
    this.actionLabels = this._actionRects.map((r) =>
      this.add
        .text(r.cx, r.cy, '', {
          font: LEVELUP_ACTION_FONT,
          color: COLOR_LEVELUP_ACTION_TEXT,
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setVisible(false),
    );

    // --- Level-up card input ------------------------------------------------
    // Card nav + confirm across keyboard, gamepad, AND touch, each guarded on
    // selectionActive (a no-op otherwise, so the same keys never affect a normal run)
    // AND !this._paused — a forced pause (blur/backgrounding, desktop web included)
    // can fire MID-selection with the overlay hidden but these event listeners still
    // live; without the pause guard a window-refocus pointerdown lands (by click
    // position, not focus) inside a now-invisible card rect and silently latches a
    // blind pick applied on resume, and a resume-reflex ENTER/SPACE/face-button does
    // the same. The pause guard makes every card input a no-op while paused.
    // Also guarded — for keys — by the event.repeat guard (the held-key lesson). Keyboard:
    // LEFT/RIGHT + A/D move the focus (wrap 0..2); ENTER/SPACE confirm. Gamepad: the
    // FACE buttons (indices 0..3) confirm while d-pad/left-stick horizontal navigate
    // (polled in update() with an edge latch — bound below), so a directional input
    // never doubles as confirm. Touch/mouse: a pointerdown hit-test on the three rects
    // selects that card. CONFIRM is additionally ignored during the brief open-grace
    // (this._cardConfirmGraceMs) so a confirm edge already in flight when a level-up
    // fires mid-combat cannot instantly pick the default card. These compose with
    // (never replace) the game-over restart handlers on the same keys/pointer/pad —
    // each guards its own condition (selectionActive here, gameOver there), which are
    // mutually exclusive (the player is invulnerable, not game-over, during a level-up).
    const moveCardFocus = (dir) => {
      // Story 10.1: the offer is variable length (0..CARD_OFFER_SIZE), so wrap the focus
      // against the CURRENT offer length rather than a hardcoded 3 — focus never lands on
      // an unrendered panel. Guarded when the offer is empty (nothing to focus).
      const len = this.levelUpSystem.currentOffer.length;
      if (len <= 0) return;
      this._cardFocus = (this._cardFocus + dir + len) % len;
    };
    // Expose for the update() gamepad-nav poll (bound to `this` so both paths share it).
    this._moveCardFocus = moveCardFocus;
    const cardNavLeft = (event) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (event && event.repeat) return;
      moveCardFocus(-1);
    };
    const cardNavRight = (event) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (event && event.repeat) return;
      moveCardFocus(1);
    };
    const cardConfirm = (event) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (event && event.repeat) return;
      if (this._cardConfirmGraceMs > 0) return;
      this.levelUpSystem.queueSelection(this._cardFocus);
    };
    // Story 8.5: R rerolls the trio, B banishes the focused card. Guarded exactly like
    // the confirm (selectionActive + !paused + not-during-grace + no OS auto-repeat) so
    // the same keys never affect a normal run. The LevelUpSystem latch enforces the
    // charge economy — a keypress with no charge is a guarded sim-side no-op.
    const cardReroll = (event) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (event && event.repeat) return;
      if (this._cardConfirmGraceMs > 0) return;
      this.levelUpSystem.queueReroll();
    };
    const cardBanish = (event) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (event && event.repeat) return;
      if (this._cardConfirmGraceMs > 0) return;
      this.levelUpSystem.queueBanish(this._cardFocus);
    };
    this.input.keyboard.on('keydown-LEFT', cardNavLeft);
    this.input.keyboard.on('keydown-A', cardNavLeft);
    this.input.keyboard.on('keydown-RIGHT', cardNavRight);
    this.input.keyboard.on('keydown-D', cardNavRight);
    this.input.keyboard.on('keydown-ENTER', cardConfirm);
    this.input.keyboard.on('keydown-SPACE', cardConfirm);
    this.input.keyboard.on('keydown-R', cardReroll);
    this.input.keyboard.on('keydown-B', cardBanish);
    // Gamepad confirm: FACE buttons only (standard-mapping indices 0..3), so d-pad /
    // stick horizontal are free to NAVIGATE (polled in update()) rather than confirm.
    // Edge-triggered via the 'down' event; grace-gated like the keyboard/touch confirm.
    // The pad plugin is present only when enabled, so it is guarded.
    // Story 8.5: the shoulder buttons drive the two tools — LB (index 4) banishes the
    // focused card, RB (index 5) rerolls — so the face buttons stay confirm-only and a
    // directional input still navigates. Grace-gated like the confirm; the LevelUpSystem
    // latches enforce the charge economy.
    this.input.gamepad?.on('down', (pad, button) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (this._cardConfirmGraceMs > 0) return;
      const idx = button && button.index;
      if (idx >= 0 && idx <= 3) {
        this.levelUpSystem.queueSelection(this._cardFocus);
      } else if (idx === 4) {
        this.levelUpSystem.queueBanish(this._cardFocus);
      } else if (idx === 5) {
        this.levelUpSystem.queueReroll();
      }
    });
    // Touch/mouse: a pointerdown inside a card rect selects it (grace-gated). Base-
    // resolution pointer.x/y (shake-free, overlay pinned scrollFactor 0) mirrors the
    // touchControls hit-test, so the drawn panels ARE the hit targets.
    this.input.on('pointerdown', (pointer) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (this._cardConfirmGraceMs > 0) return;
      const px = pointer.x;
      const py = pointer.y;
      // Story 10.1: the offer is variable length, but _cardRects/_cardBanishRects are a
      // fixed 3. Clamp BOTH hit-test loops to the LIVE offer length so a tap in a hidden
      // (short/empty-offer) panel's region can never set focus, select, or banish an
      // out-of-range slot — mirroring the keyboard/gamepad focus-wrap clamp.
      const shown = Math.min(
        this._cardRects.length,
        this.levelUpSystem.currentOffer.length,
      );
      // Story 8.5: the per-card banish glyph (top-right of each panel) is hit-tested
      // FIRST and short-circuits — a tap on it banishes THAT card (a specific target the
      // focus-based banish cannot reach on touch) and must NOT also commit a pick. The
      // return fires even when depleted so a tap on the glyph never falls through to a
      // pick; queueBanish is only called when a charge remains (the sim latch also guards
      // it). This is the touch/mouse banish path; keyboard B / gamepad LB stay focus-based.
      for (let i = 0; i < shown; i++) {
        const b = this._cardBanishRects[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          if (this.progressionState.banishCharges > 0) {
            this.levelUpSystem.queueBanish(i);
          }
          return;
        }
      }
      for (let i = 0; i < shown; i++) {
        const r = this._cardRects[i];
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          this._cardFocus = i;
          this.levelUpSystem.queueSelection(i);
          break;
        }
      }
    });
    // Story 8.5: a pointerdown inside the bottom REROLL button latches a reroll (reroll
    // needs no target). Same base-resolution hit-test as the card rects (overlay pinned
    // scrollFactor 0) so the drawn button IS the touch target; grace-gated and pause-
    // guarded like the card confirm. The LevelUpSystem latch is the sole charge authority
    // — a tap on the depleted (dimmed) button is a guarded no-op there. The bottom BANISH
    // button is deliberately NOT pointer-hittable: it banishes the FOCUSED slot, which a
    // touch/mouse player cannot aim without also committing a pick, so it would always
    // waste a charge on slot 0. Pointer banishing is the per-card glyph above; the bottom
    // Banish button stays a keyboard-B / gamepad-LB affordance + live charge readout.
    this.input.on('pointerdown', (pointer) => {
      if (!this.levelUpSystem.selectionActive || this._paused) return;
      if (this._cardConfirmGraceMs > 0) return;
      const px = pointer.x;
      const py = pointer.y;
      for (let i = 0; i < this._actionRects.length; i++) {
        const r = this._actionRects[i];
        if (r.kind !== 'reroll') continue;
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          this.levelUpSystem.queueReroll();
          break;
        }
      }
    });

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
    // Story 10.5: the dash button gets the same safe-area treatment as the bomb (raised
    // by the bottom inset only — it sits far enough from the right edge that no right
    // inset can reach it).
    this.inputSampler.setDashButton(layout.dash.x, layout.dash.y, layout.dash.radius);
  }

  /**
   * Set the paused flag AND, on the transition INTO pause, settle the render-owned
   * juice so the PAUSED screen reads cleanly. The top-of-update gate returns before
   * the flash/shake countdowns decay, so a flash or camera shake in flight at pause
   * time would otherwise freeze — washing the overlay near-white or holding a shake
   * offset for the whole pause. Zeroing _flashMs makes the next unpaused frame set
   * flash alpha 0 naturally; the resume path is untouched. This is the SINGLE pause
   * entry point shared by the keyboard handler AND the native lifecycle controller
   * (background auto-pause / hardware back button), so every pause path settles
   * identically (a mid-bomb background pause never freezes a near-white overlay).
   * @param {boolean} paused The next paused state.
   */
  setPaused(paused) {
    this._paused = paused;
    if (paused) {
      this._flashMs = 0;
      this._trauma = 0;
      this.cameras.main.scrollX = 0;
      this.cameras.main.scrollY = 0;
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
    // Story 7.5: native feel + keep-awake. Keep-awake is evaluated HERE at the TOP of
    // update() BEFORE the pause early-return, so the wake lock is released on the pause
    // edge (desired-awake flips false while paused). The haptic drain is NOT here — it
    // runs later, BELOW the pause early-return, co-located with the flash/shake consumes,
    // so a paused frame drains nothing and a buzz lands on the same frame as its cue.
    //
    // Keep-awake (edge-triggered): the ArenaScene is running whenever update() fires,
    // so run-active is true here; decideKeepAwake then reduces to !paused && !gameOver.
    // The wake lock is requested/released ONLY when the desired boolean flips, never
    // per frame. Not gated by Reduced Motion (that governs motion, not screen sleep).
    const keepAwakeState = this._keepAwakeState;
    keepAwakeState.paused = this._paused;
    keepAwakeState.gameOver = this.playerState.gameOver;
    const desiredAwake = decideKeepAwake(keepAwakeState);
    if (desiredAwake !== this._displayAwake) {
      this._displayAwake = desiredAwake;
      if (desiredAwake) {
        this._wakeSentinel = acquireWakeLock(
          typeof navigator !== 'undefined' ? navigator : null,
          this._onWakeLockReleased,
        );
      } else {
        releaseWakeLock(this._wakeSentinel);
        this._wakeSentinel = null;
      }
    }

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
      // Story 8.3: hide the level-up overlay while paused. A forced pause can fire
      // MID-selection (its visibility is toggled AFTER this early-return), so without
      // this the card modal would render stacked UNDER the PAUSED overlay. The
      // per-frame card render re-shows it on resume (selectionActive is still true).
      // Placed BEFORE the touch reconcile so the Story 7.1 `resetTouch(); return;`
      // pause-edge idiom stays adjacent.
      this.levelUpOverlay.setVisible(false);
      this.levelUpHeading.setVisible(false);
      this.cardPanelGraphics.setVisible(false);
      this.levelUpPrompt.setVisible(false);
      for (let i = 0; i < this.cardTitles.length; i++) {
        this.cardTitles[i].setVisible(false);
      }
      // Story 8.5: hide the reroll/banish controls + per-card banish glyphs too (re-shown
      // on resume by the per-frame render while selectionActive is still true).
      this.actionPanelGraphics.setVisible(false);
      for (let i = 0; i < this.actionLabels.length; i++) {
        this.actionLabels[i].setVisible(false);
      }
      for (let i = 0; i < this.cardBanishLabels.length; i++) {
        this.cardBanishLabels[i].setVisible(false);
      }
      this.touchOverlayGraphics.clear();
      this.inputSampler.resetTouch();
      // Story 10.5: drain any dash already latched into the SHARED InputState. The
      // resetTouch() above clears only the TouchControls model's latch — once sample()
      // has copied a press into inputState.dashQueued (a frame that produced zero fixed
      // steps leaves it sitting there), nothing else drains it: clear() deliberately
      // does not, and the only other consumeDash() is in the level-up-modal branch. A
      // dash latched on such a frame and then paused would otherwise fire the instant
      // the run resumed and spend the full cooldown — contradicting this story's AC
      // that a press while paused fires nothing and is not buffered.
      //
      // NOTE: `bombQueued` has the IDENTICAL gap here. It is pre-existing (Story 3.2 /
      // 5.2) and deliberately left alone — out of scope for this story.
      this.inputState.consumeDash();
      return;
    }

    // Sample input (render rate) before advancing the sim so this frame's
    // fixed steps consume the latest move intent.
    this.inputSampler.sample();

    // Story 8.3: while the level-up card overlay is open, suppress gameplay input so
    // the ship idles (no move/aim/fire) and the shared nav keys (arrows / A-D) never
    // also steer the ship, and drop any queued bomb so a bomb never fires from under
    // the modal. The nav/confirm handlers run on the scene input plugin, independent
    // of this cleared InputState. Done AFTER sample() and BEFORE the fixed-step advance
    // so this tick reads the cleared intent.
    if (this.levelUpSystem.selectionActive) {
      this.inputState.clear();
      this.inputState.consumeBomb();
      // Story 10.5: drain the dash latch too — `clear()` deliberately clears only the
      // continuous move/aim levels, so without this an Afterburner dash queued under
      // the card overlay would fire the instant the overlay closed.
      this.inputState.consumeDash();
    }

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
      // Story 8.3: while a level-up selection is pending, DILATE world time to a slow
      // crawl by scaling the render delta fed to the accumulator (the swarm stays
      // visible — a slow-mo, not a freeze). The per-step dt stays FIXED_STEP_MS, so
      // every system integrates a bit-identical slice; only the STEP RATE slows.
      // Hit-stop (a hard freeze) still wins above; game-over freezes inside the step.
      const timeScale = this.levelUpSystem.selectionActive ? LEVELUP_TIME_SCALE : 1;
      // Freeze the simulation on game over at sub-step granularity: each fixed
      // sub-step re-checks gameOver, so no system runs once death latches — even
      // mid-frame during multi-sub-step catch-up — keeping the final score stable.
      this.fixedTimestep.advance(delta * timeScale, (dt) => {
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

    // Story 7.5 haptic drain: consume the pulses this frame's fixed steps aggregated,
    // co-located with the shake/flash consumes BELOW the pause gate's early return (so
    // it runs only on active, non-paused frames) and AFTER the fixed-step advance — so a
    // death/bomb/extra-life buzz fires on the SAME frame as its shake/flash rather than
    // one frame late. Always drains (deterministic); the sink's emitHaptic gate suppresses
    // the actual buzz under Reduced Motion while the buffer still empties.
    this.screenFeedbackSystem.drainHapticPulses(this._drainHapticSink);

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
    // live bullet. Rendering reads the sim state; it never advances it. Story 11.5: a
    // BOUNCED Ricochet bullet draws in COLOR_RICOCHET (a distinct warm tint communicates
    // the mechanic — the epic's visual-legibility requirement); a fresh bullet stays
    // COLOR_BULLET. The per-bullet fillStyle reads the stamped `bounced` flag, no allocation.
    const bg = this.bulletGraphics;
    bg.clear();
    this.firingSystem.bulletPool.forEachActive((b) => {
      bg.fillStyle(b.bounced ? COLOR_RICOCHET : COLOR_BULLET, 1);
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

    // Redraw active armored enemies from the ArmoredSystem pool: clear once, then
    // per live armored a filled steel circle at COLOR_ARMORED, plus an inner disc
    // whose radius scales with remaining durability (s.hp / ARMORED_HP) so a battered
    // armored reads visibly closer to death. Story 2.6: a spawning-in armored fades +
    // scales in from its telegraphMs (same seam as every archetype). Placeholder shape
    // only (Epic 4 adds the aesthetic). Drawn from each instance's own radius so the
    // shape tracks the collision value. Zero per-frame allocation (mirrors the seeker).
    const amg = this.armoredGraphics;
    amg.clear();
    this.armoredSystem.enemyPool.forEachActive((s) => {
      const p = spawnTelegraphProgress(s.telegraphMs, ENEMY_SPAWN_TELEGRAPH_MS);
      const alpha = telegraphAlpha(p, SPAWN_TELEGRAPH_MIN_ALPHA);
      const r = s.radius * telegraphScale(p, SPAWN_TELEGRAPH_MIN_SCALE);
      // Base plate (dimmer) so the brighter durability core reads on top of it.
      amg.fillStyle(COLOR_ARMORED, alpha * 0.5);
      amg.fillCircle(s.x, s.y, r);
      // Durability core: a brighter inner disc shrinking from full radius to 0 as hp
      // drops from ARMORED_HP to 0 (guarded to a finite ratio in [0,1]).
      const hpRatio = Number.isFinite(s.hp)
        ? Math.min(Math.max(s.hp / ARMORED_HP, 0), 1)
        : 1;
      if (hpRatio > 0) {
        amg.fillStyle(COLOR_ARMORED, alpha);
        amg.fillCircle(s.x, s.y, r * hpRatio);
      }
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

    // Redraw active XP orbs from the pool: clear once, then a filled teal dot of
    // XP_ORB_RADIUS per live orb. Additive blend + camera bloom make each orb glow.
    // Rendering reads the sim state; it never advances it. Zero per-frame allocation
    // (mirrors the particle/bullet render). (Story 8.1)
    const xog = this.xpOrbGraphics;
    xog.clear();
    xog.fillStyle(COLOR_XP_ORB, 1);
    this.xpOrbSystem.pool.forEachActive((o) => {
      xog.fillCircle(o.x, o.y, XP_ORB_RADIUS);
    });

    // Redraw active Orbit Blades from the pool: clear once, then a filled neon dot of
    // ORBIT_BLADE_RADIUS per live blade at its synced ring position. Additive blend +
    // camera bloom make each blade glow. Rendering reads the sim state; it never advances
    // it. Zero per-frame allocation (mirrors the xp-orb/particle render). (Story 11.1)
    const obg = this.orbitBladeGraphics;
    obg.clear();
    obg.fillStyle(COLOR_ORBIT_BLADE, 1);
    this.orbitBladeSystem.pool.forEachActive((b) => {
      obg.fillCircle(b.x, b.y, ORBIT_BLADE_RADIUS);
    });

    // Redraw active Seeker Drones + their shots from the two pools: clear once each, then a
    // filled neon dot per live drone at its synced ring position and per live shot at its
    // in-flight position. Additive blend + camera bloom make each glow. Rendering reads the
    // sim state; it never advances it. Zero per-frame allocation (mirrors the orbit-blade
    // render). (Story 11.2)
    const sdg = this.seekerDroneGraphics;
    sdg.clear();
    sdg.fillStyle(COLOR_SEEKER_DRONE, 1);
    this.seekerDroneSystem.pool.forEachActive((d) => {
      sdg.fillCircle(d.x, d.y, SEEKER_DRONE_RADIUS);
    });
    const dsg = this.droneShotGraphics;
    dsg.clear();
    dsg.fillStyle(COLOR_DRONE_SHOT, 1);
    this.seekerDroneSystem.shotPool.forEachActive((s) => {
      dsg.fillCircle(s.x, s.y, SEEKER_DRONE_SHOT_RADIUS);
    });

    // Redraw active Mines from the pool: clear once, then a filled MINE_RADIUS dot per live
    // mine, coloured COLOR_MINE_ARMED once armed (ageMs >= armMs) else COLOR_MINE_UNARMED — so
    // armed-vs-unarmed reads at a glance (the epic UX note). fillStyle is re-set per mine so
    // the two colours can interleave in one pass. Additive blend + camera bloom make each mine
    // glow. Rendering reads the sim state; it never advances it. Zero per-frame allocation
    // (mirrors the orbit-blade/drone render). (Story 11.3)
    const mg = this.mineGraphics;
    mg.clear();
    this.mineLayerSystem.pool.forEachActive((m) => {
      mg.fillStyle(m.ageMs >= m.armMs ? COLOR_MINE_ARMED : COLOR_MINE_UNARMED, 1);
      mg.fillCircle(m.x, m.y, MINE_RADIUS);
    });

    // Redraw active Piercing Lance bolts + trail nodes from the two pools: clear each once, then
    // a dimmer wider COLOR_LANCE_TRAIL dot per live trail node (drawn under the bolts, as the
    // fading wake) and a hot-violet COLOR_LANCE_BOLT dot per live bolt. Additive blend + camera
    // bloom make each glow. Rendering reads the sim state; it never advances it. Zero per-frame
    // allocation (mirrors the mine/drone render). (Story 11.4)
    const ltg = this.lanceTrailGraphics;
    ltg.clear();
    ltg.fillStyle(COLOR_LANCE_TRAIL, 1);
    this.piercingLanceSystem.trailPool.forEachActive((n) => {
      ltg.fillCircle(n.x, n.y, LANCE_TRAIL_NODE_RADIUS);
    });
    const lbg = this.lanceBoltGraphics;
    lbg.clear();
    lbg.fillStyle(COLOR_LANCE_BOLT, 1);
    this.piercingLanceSystem.pool.forEachActive((b) => {
      lbg.fillCircle(b.x, b.y, LANCE_BOLT_RADIUS);
    });

    // Redraw active Flak fragments from the pool: clear once, then a filled dot per live
    // fragment in COLOR_FLAK_FRAGMENT. Additive blend + camera bloom make each fragment glow.
    // (Story 11.6)
    const flg = this.flakGraphics;
    flg.clear();
    if (this.flakSystem && this.flakSystem.flakPool) {
      flg.fillStyle(COLOR_FLAK_FRAGMENT, 1);
      if (!this._drawFlakFragment) {
        this._drawFlakFragment = (f) => this.flakGraphics.fillCircle(f.x, f.y, f.radius);
      }
      this.flakSystem.flakPool.forEachActive(this._drawFlakFragment);
    }


    // Story 7.1: draw the touch overlay from the sampler's snapshot while touch is
    // the driving input, else clear it. Runs at render rate after sample() (which
    // updated the touch model this frame). The draw helper self-clears, so a
    // released stick leaves no stale graphic; the else-clear covers the frame touch
    // ends and every non-touch frame (gamepad/kbm player never sees the overlay).
    // Story 10.5: push the dash button's OWNERSHIP GATE every render frame, from the
    // same place the overlay is redrawn. A per-frame push, not a one-shot at create:
    // the dash is unlocked MID-RUN by a card pick, so the button has to appear the
    // moment the fold grants it (and the hit region must open on the same frame).
    this.inputSampler.setDashEnabled(this.dashSystem.dashEnabled());

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
      `SCORE ${this.scoreState.score}\nMULT ${this.scoreState.multiplier}×\nBOMBS ${this.scoreState.bombs}\nLIVES ${this.playerState.lives}\nHIGH ${this.highScoreSystem.highScore}\nXP ${Math.floor(this.scoreState.xp)}\nLV ${this.levelSystem.level}${this.levelSystem.atCap ? ' MAX' : ` ${Math.floor(this.levelSystem.xpIntoLevel)}/${Math.ceil(this.levelSystem.xpToNext)}`}`,
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

    // --- Level-up card overlay (render only; never advances the sim) ---------
    // Story 8.3: while a selection is pending, show the dim + heading + three panels
    // (the focused one brighter/thicker) with the currentOffer titles, and a prompt
    // keyed to the active input method. Hidden (and the panels cleared) otherwise.
    const cardsOpen = this.levelUpSystem.selectionActive;
    const offer = this.levelUpSystem.currentOffer;
    // Edge handling: on the false→true rise (a fresh overlay) OR when a fresh offer
    // replaces a picked one mid multi-level jump (currentOffer identity change while
    // active), reset the focus to the first card and (re)arm the confirm-grace so an
    // in-flight confirm edge does not instantly pick, and drop the pad-nav latch.
    const roseActive = cardsOpen && !this._wasSelectionActive;
    const freshOffer = cardsOpen && offer !== this._lastOffer;
    if (roseActive || freshOffer) {
      this._cardFocus = 0;
      this._cardConfirmGraceMs = LEVELUP_CONFIRM_GRACE_MS;
      this._padNavLatched = false;
    }
    // On the true→false CLOSE edge, reconcile touch the same way the pause edge does
    // (resetTouch above). A card tap shares pointerdown with the twin-stick sampler, so
    // a finger still held when the overlay closes leaves a stick anchored — masked by
    // inputState.clear() only while selectionActive. Without this drop, that stale stick
    // would steer/aim the ship the instant time returns to full speed.
    const fellActive = !cardsOpen && this._wasSelectionActive;
    if (fellActive) {
      this.inputSampler.resetTouch();
    }
    this._wasSelectionActive = cardsOpen;
    this._lastOffer = offer;
    // Decay the confirm-grace by real render delta (render-owned countdown, like the
    // flash / hit-stop countdowns, so it settles even under time dilation).
    if (this._cardConfirmGraceMs > 0) {
      this._cardConfirmGraceMs -= delta;
      if (this._cardConfirmGraceMs < 0) this._cardConfirmGraceMs = 0;
    }
    // Gamepad navigation (edge-latched): while the overlay is open, poll the pad's
    // d-pad horizontal + left-stick horizontal and step the focus ONCE per press (a
    // held direction does not scroll). Confirm stays on the FACE buttons (bound in
    // create()), so a directional input navigates rather than confirms. Navigation is
    // allowed during the confirm-grace — only CONFIRM is held off.
    if (cardsOpen) {
      const pad = this.inputSampler.getPad();
      if (pad) {
        const dpadLeft = pad.buttons && pad.buttons[14] && pad.buttons[14].pressed;
        const dpadRight = pad.buttons && pad.buttons[15] && pad.buttons[15].pressed;
        const sx = pad.leftStick ? pad.leftStick.x : 0;
        let dir = 0;
        if (dpadLeft || sx <= -MOVE_DEADZONE) dir = -1;
        else if (dpadRight || sx >= MOVE_DEADZONE) dir = 1;
        if (dir !== 0) {
          if (!this._padNavLatched) {
            this._moveCardFocus(dir);
            this._padNavLatched = true;
          }
        } else {
          this._padNavLatched = false;
        }
      } else {
        this._padNavLatched = false;
      }
    }
    this.levelUpOverlay.setVisible(cardsOpen);
    this.levelUpHeading.setVisible(cardsOpen);
    this.cardPanelGraphics.setVisible(cardsOpen);
    this.levelUpPrompt.setVisible(cardsOpen);
    const cpg = this.cardPanelGraphics;
    cpg.clear();
    // Story 8.5: a banished-charge-depleted look for the per-card glyphs (shared across
    // all three cards — a single banish counter gates them all).
    const banishDepleted = this.progressionState.banishCharges <= 0;
    for (let i = 0; i < this._cardRects.length; i++) {
      const r = this._cardRects[i];
      const title = this.cardTitles[i];
      const banishLabel = this.cardBanishLabels[i];
      const shown = cardsOpen && i < offer.length;
      title.setVisible(shown);
      banishLabel.setVisible(shown);
      if (!shown) continue;
      const focused = i === this._cardFocus;
      cpg.fillStyle(
        focused ? COLOR_LEVELUP_PANEL_FOCUS : COLOR_LEVELUP_PANEL,
        focused ? LEVELUP_PANEL_FOCUS_ALPHA : LEVELUP_PANEL_ALPHA,
      );
      cpg.fillRect(r.x, r.y, r.w, r.h);
      cpg.lineStyle(
        focused ? LEVELUP_PANEL_FOCUS_BORDER_WIDTH : LEVELUP_PANEL_BORDER_WIDTH,
        COLOR_LEVELUP_PANEL_BORDER,
        1,
      );
      cpg.strokeRect(r.x, r.y, r.w, r.h);
      title.setText(offer[i].title);
      // Per-card banish glyph in the top-right corner: enabled amber when a banish
      // charge remains, dimmed grey when depleted (reads as clearly unavailable).
      const b = this._cardBanishRects[i];
      cpg.fillStyle(
        banishDepleted ? COLOR_LEVELUP_ACTION_DEPLETED : COLOR_LEVELUP_ACTION,
        banishDepleted ? LEVELUP_ACTION_DEPLETED_ALPHA : LEVELUP_ACTION_ALPHA,
      );
      cpg.fillRect(b.x, b.y, b.w, b.h);
      cpg.lineStyle(
        LEVELUP_ACTION_BORDER_WIDTH,
        banishDepleted ? COLOR_LEVELUP_ACTION_DEPLETED : COLOR_LEVELUP_ACTION_BORDER,
        1,
      );
      cpg.strokeRect(b.x, b.y, b.w, b.h);
      banishLabel.setColor(
        banishDepleted ? COLOR_LEVELUP_ACTION_TEXT_DEPLETED : COLOR_LEVELUP_ACTION_TEXT,
      );
    }
    if (cardsOpen) {
      const method = this.inputSampler.activeMethod;
      this.levelUpPrompt.setText(
        method === INPUT_METHOD.TOUCH
          ? `Tap a card to choose  ·  tap ${LEVELUP_CARD_BANISH_GLYPH} on a card to banish  ·  tap Reroll`
          : method === INPUT_METHOD.GAMEPAD
            ? 'Stick / D-pad to choose  ·  A confirm  ·  RB reroll  ·  LB banish'
            : '← → or A / D to choose  ·  Enter / Space confirm  ·  R reroll  ·  B banish',
      );
    }

    // Story 8.5: draw the two reroll/banish action buttons with live charge counts and
    // an enabled vs depleted (count 0) look. Redrawn each frame like the card panels: a
    // depleted control reads as clearly unavailable (dimmed fill/border/label). The
    // LevelUpSystem latch is the sole charge authority, so a press on a depleted button
    // is a guarded no-op there — the styling is purely a render cue.
    this.actionPanelGraphics.setVisible(cardsOpen);
    const apg = this.actionPanelGraphics;
    apg.clear();
    for (let i = 0; i < this._actionRects.length; i++) {
      const r = this._actionRects[i];
      const label = this.actionLabels[i];
      label.setVisible(cardsOpen);
      if (!cardsOpen) continue;
      const count =
        r.kind === 'reroll'
          ? this.progressionState.rerollCharges
          : this.progressionState.banishCharges;
      const depleted = count <= 0;
      apg.fillStyle(
        depleted ? COLOR_LEVELUP_ACTION_DEPLETED : COLOR_LEVELUP_ACTION,
        depleted ? LEVELUP_ACTION_DEPLETED_ALPHA : LEVELUP_ACTION_ALPHA,
      );
      apg.fillRect(r.x, r.y, r.w, r.h);
      apg.lineStyle(
        LEVELUP_ACTION_BORDER_WIDTH,
        depleted ? COLOR_LEVELUP_ACTION_DEPLETED : COLOR_LEVELUP_ACTION_BORDER,
        1,
      );
      apg.strokeRect(r.x, r.y, r.w, r.h);
      label.setColor(
        depleted ? COLOR_LEVELUP_ACTION_TEXT_DEPLETED : COLOR_LEVELUP_ACTION_TEXT,
      );
      label.setText(
        `${r.kind === 'reroll' ? 'Reroll' : 'Banish'} (${count})`,
      );
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
          `cards      : ${Object.keys(this.progressionState.ownedCards).length}  stat ${this.progressionState.debugStat}`,
          `dps        : ${this.dpsTelemetrySystem.dps.toFixed(1)}`,
          `boost      : ${this.dpsTelemetrySystem.boostDps.toFixed(1)}`,
          `pressure   : ${this.spawnDirector.pressure.toFixed(2)}`,
        ].join('\n'),
      );
    }
  }
}
