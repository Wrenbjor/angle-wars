import Phaser from 'phaser';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  COLOR_TITLE_TEXT_STRING,
  TITLE_FONT,
  COLOR_TITLE_HISCORE,
  TITLE_HISCORE_FONT,
  COLOR_TITLE_CONTROLS,
  TITLE_CONTROLS_FONT,
  MENU_CONTROL_FILL,
  MENU_CONTROL_FILL_PRESSED,
  MENU_CONTROL_STROKE,
  MENU_CONTROL_TEXT,
  MENU_CONTROL_FONT,
} from '../config/constants.js';
import { createHighScoreStorage } from '../persistence/highScoreStorage.js';
import { APP_VERSION_LABEL } from '../config/appVersion.js';
import { applyAdditiveBlend } from './neonStyle.js';
import {
  TITLE_TEXT,
  START_PROMPT,
  SETTINGS_PROMPT,
  CONTROLS_LINES,
  formatHighScore,
} from './titleScreen.js';
import {
  FLOW_STATES,
  FLOW_EVENTS,
  nextFlowState,
  sceneForState,
} from './gameFlow.js';
import { MENU_ACTIONS, titleControlLayout } from './menuControls.js';

// TitleScene — the game's front door (Story 5.1 / FR14).
//
// Sits between Preload and Arena in the scene chain: it shows the neon "ANGLE
// WARS" title, the persisted high score, a start prompt, and the basic controls,
// then starts a fresh ArenaScene run on a Play input (Enter / Space / Play button /
// gamepad button). Because starting is one user gesture, the audio unlock that
// ArenaScene relies on keeps working unchanged.
//
// This scene is a thin view layer: all text content and the high-score
// formatting live in the Phaser-free titleScreen.js seam, and it reads the
// persisted score only through the guarded highScoreStorage port (never
// localStorage directly). It reads state only — it never persists or mutates
// anything. The governing title ⇄ play ⇄ game-over state machine is Story 5.3's
// job; this is just the seam that story builds on.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const cx = ARENA_WIDTH / 2;
    const cy = ARENA_HEIGHT / 2;

    // --- Neon hero title ----------------------------------------------------
    // Centered "ANGLE WARS". Put into additive blend (like ArenaScene's neon
    // vector layers) so it reads as a bright neon sign, distinct from the plain
    // normal-blend text below.
    this.titleText = this.add
      .text(cx, cy - 120, TITLE_TEXT, {
        font: TITLE_FONT,
        color: COLOR_TITLE_TEXT_STRING,
        align: 'center',
      })
      .setOrigin(0.5);

    // --- High score (read through the guarded port) -------------------------
    // load() never throws and degrades to 0 on a missing/blocked store;
    // formatHighScore coerces it to the display line.
    const highScore = createHighScoreStorage().load();
    this.hiScoreText = this.add
      .text(cx, cy - 30, formatHighScore(highScore), {
        font: TITLE_HISCORE_FONT,
        color: COLOR_TITLE_HISCORE,
        align: 'center',
      })
      .setOrigin(0.5);

    this.menuButtons = new Map();

    // --- Controls -----------------------------------------------------------
    // One stacked block describing only the controls that exist today.
    this.controlsText = this.add
      .text(cx, 610, CONTROLS_LINES.join('\n'), {
        font: TITLE_CONTROLS_FONT,
        color: COLOR_TITLE_CONTROLS,
        align: 'center',
      })
      .setOrigin(0.5);

    // Package-derived build identity, centered inside the arena's bottom safe margin.
    this.versionText = this.add
      .text(cx, ARENA_HEIGHT - 24, APP_VERSION_LABEL, {
        font: '14px monospace',
        color: COLOR_TITLE_CONTROLS,
        align: 'center',
      })
      .setOrigin(0.5, 1);

    // --- Neon aesthetic -----------------------------------------------------
    // Mirror ArenaScene's neon wiring: the hero title uses additive blend so
    // saturated strokes accumulate like a neon sign. Normal-blend supporting text
    // stays crisp; no camera-wide bloom washes the finished frame toward white.
    // Phaser.BlendModes.ADD is injected so neonStyle.js stays Phaser-free.
    applyAdditiveBlend([this.titleText], Phaser.BlendModes.ADD);

    // --- Explicit title actions --------------------------------------------
    // Any start gesture launches a fresh ArenaScene run — scene.start('ArenaScene')
    // runs ArenaScene.create(), which rebuilds all run state from zero. Enter /
    // Space / Play button / gamepad button all route here. The gamepad plugin is only
    // present when enabled in the game config, so its listener is guarded. A
    // one-shot latch prevents two gestures in one frame (or OS key auto-repeat)
    // from calling scene.start more than once.
    let started = false;
    const start = (event) => {
      // event.repeat guard (the Story 5.2 held-key lesson): a held Enter that closed
      // the SettingsScene (Esc/Enter) starts THIS scene, and the key is still down —
      // OS auto-repeat would then deliver keydown-ENTER to this fresh instance (whose
      // `started` latch is false) and immediately start a run, skipping the title. A
      // single tap still fires once (repeat === false). Pointer/gamepad events carry
      // no `.repeat`, so the guard is a no-op for them.
      if (event && event.repeat) return;
      if (started) return;
      // Route the start gesture through the flow seam: (TITLE, START) → PLAY →
      // 'ArenaScene'. The scene stays a thin adapter — the seam owns the decision.
      const target = sceneForState(
        nextFlowState(FLOW_STATES.TITLE, FLOW_EVENTS.START),
      );
      if (!target) return; // illegal transition → guarded no-op
      started = true;
      this.scene.start(target);
    };
    const openSettings = (event) => {
      if (event && event.repeat) return;
      if (started) return;
      const target = sceneForState(nextFlowState(FLOW_STATES.TITLE, FLOW_EVENTS.OPEN_SETTINGS));
      if (!target) return;
      started = true;
      this.scene.start(target);
    };
    const activate = (action, event) => action === MENU_ACTIONS.PLAY ? start(event) : openSettings(event);
    for (const control of titleControlLayout()) {
      const bg = this.add.rectangle(control.x, control.y, control.width, control.height, MENU_CONTROL_FILL)
        .setStrokeStyle(3, MENU_CONTROL_STROKE).setInteractive({ useHandCursor: true });
      const label = this.add.text(control.x, control.y, control.action === MENU_ACTIONS.PLAY ? START_PROMPT : SETTINGS_PROMPT, { font: MENU_CONTROL_FONT, color: MENU_CONTROL_TEXT }).setOrigin(0.5);
      let pressedPointerId = null;
      bg.on('pointerdown', (pointer) => {
        if (pressedPointerId !== null) return;
        pressedPointerId = pointer.id;
        bg.setFillStyle(MENU_CONTROL_FILL_PRESSED);
      });
      bg.on('pointerup', (pointer) => {
        if (pointer.id !== pressedPointerId) return;
        pressedPointerId = null;
        bg.setFillStyle(MENU_CONTROL_FILL);
        activate(control.action, pointer);
      });
      bg.on('pointerout', () => {
        pressedPointerId = null;
        bg.setFillStyle(MENU_CONTROL_FILL);
      });
      this.menuButtons.set(control.action, { bg, label });
    }
    this.input.keyboard.on('keydown-ENTER', start);
    this.input.keyboard.on('keydown-SPACE', start);
    this.input.gamepad?.on('down', start);

    // --- Settings input -----------------------------------------------------
    // `S` opens the SettingsScene through the flow seam: (TITLE, OPEN_SETTINGS) →
    // SETTINGS → 'SettingsScene'. Guarded so an illegal/unknown transition is a
    // no-op. Shares the SAME `started` one-shot latch as the start gesture, so a
    // same-frame start+S fires only ONE scene.start (the first wins) and never lands
    // the player in the wrong scene. The latch is set only AFTER the seam returns a
    // non-null target, so a no-op S never blocks a subsequent start.
    this.input.keyboard.on('keydown-S', openSettings);
  }
}
