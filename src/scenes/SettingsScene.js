import Phaser from 'phaser';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  COLOR_SETTINGS_TITLE_STRING,
  SETTINGS_TITLE_FONT,
  COLOR_SETTINGS_ITEM,
  SETTINGS_ITEM_FONT,
  COLOR_SETTINGS_HINT,
  SETTINGS_HINT_FONT,
  AUDIO_VOLUME_STEP,
} from '../config/constants.js';
import { createSettingsStorage } from '../persistence/settingsStorage.js';
import { AudioEngine } from '../audio/audioEngine.js';
import { effectiveVolume, adjustVolume } from '../audio/audioMix.js';
import { applyAdditiveBlend, addNeonBloom } from './neonStyle.js';
import {
  SETTINGS_TITLE,
  SETTINGS_HINT,
  formatVolume,
  formatToggle,
} from './settingsMenu.js';
import {
  FLOW_STATES,
  FLOW_EVENTS,
  nextFlowState,
  sceneForState,
} from './gameFlow.js';

// SettingsScene — the settings surface reached from the title with `S` (Story 5.3 /
// FR14). It exposes volume, mute, and fullscreen, each applying IMMEDIATELY and
// persisting on the same keypress: volume/mute re-apply the effective master gain to
// this scene's own live AudioEngine and play a short confirmation blip (audible
// immediacy); fullscreen calls this.scale.toggleFullscreen() (visible immediacy).
// Every change writes the WHOLE { muted, volume, fullscreen } object through the
// guarded settingsStorage port, so no write clobbers another field.
//
// This scene is a thin view/adapter layer: all text content + formatting live in the
// Phaser-free settingsMenu.js seam, all volume/mute math in audioMix.js, all decision
// routing in the gameFlow.js seam, and all persistence behind the settingsStorage
// port (never localStorage directly). Navigation is keyboard-only this story (Story
// 5.4 owns gamepad polish); Esc / Enter return to the title through the flow seam.
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super('SettingsScene');
  }

  create() {
    const cx = ARENA_WIDTH / 2;
    const cy = ARENA_HEIGHT / 2;

    // --- Load persisted settings through the guarded port -------------------
    // load() never throws and degrades to defaults on a missing/corrupt/blocked
    // store; a legacy {muted,volume} payload loads with fullscreen defaulted off.
    this._settings = createSettingsStorage();
    const loaded = this._settings.load();
    this._muted = loaded.muted;
    this._volume = loaded.volume;
    // Reduced motion (Story 6.1): a plain persisted preference (unlike fullscreen,
    // which is seeded from the live display state). Read straight from the port; a
    // legacy payload without the field loads it defaulted off. Its effect (grid warp
    // / flash / shake suppression) is applied by ArenaScene at run start — this scene
    // only owns the toggle + label + persistence.
    this._reducedMotion = loaded.reducedMotion;
    // Seed fullscreen from the LIVE display state (the scale manager is the source
    // of truth, matching the enterfullscreen/leavefullscreen reconcilers below), NOT
    // the persisted preference. Fullscreen is deliberately never auto-restored at
    // boot, so a stored `true` would otherwise render "FULLSCREEN ON" while the
    // window is actually windowed — a lying label that also makes the first `F` press
    // appear inverted. `loaded.fullscreen` is still parsed by the port so old data
    // round-trips; the label just reflects reality instead of a stale preference.
    this._fullscreen = this.scale.isFullscreen;

    // --- Live audio for immediate feedback ----------------------------------
    // The title/settings screens have no live run audio, so this scene owns its own
    // guarded AudioEngine purely so a volume/mute change is AUDIBLE at once (a short
    // blip at the new effective gain). The engine constructs silent (master + music
    // at gain 0) and setMusicLayerGains is never called, so ONLY the explicit
    // per-change blip sounds — a muted / zero-volume state yields an inaudible blip
    // (correct feedback), and a missing/blocked audio context degrades it to a no-op.
    // Disposed on shutdown (mirrors ArenaScene) so no oscillators leak.
    this.audioEngine = new AudioEngine(this.sound && this.sound.context);
    this.audioEngine.setMasterGain(effectiveVolume(this._volume, this._muted));
    this.events.once('shutdown', () => {
      this.audioEngine.dispose();
    });

    // --- Neon hero title ----------------------------------------------------
    // Additive blend (like TitleScene / ArenaScene neon layers) so it reads as a
    // bright neon sign, plus one camera-level Bloom pass for the on-theme halo.
    this.titleText = this.add
      .text(cx, cy - 140, SETTINGS_TITLE, {
        font: SETTINGS_TITLE_FONT,
        color: COLOR_SETTINGS_TITLE_STRING,
        align: 'center',
      })
      .setOrigin(0.5);

    // --- Setting lines (from the Phaser-free formatters) --------------------
    // Re-spaced for the 4th (Reduced Motion) line so no line overlaps the next or
    // the hint (Story 6.1): volume cy-60, mute cy-20, fullscreen cy+20, reduced
    // motion cy+60, hint cy+130.
    this.volumeText = this.add
      .text(cx, cy - 60, formatVolume(this._volume), {
        font: SETTINGS_ITEM_FONT,
        color: COLOR_SETTINGS_ITEM,
        align: 'center',
      })
      .setOrigin(0.5);
    this.muteText = this.add
      .text(cx, cy - 20, formatToggle('MUTE', this._muted), {
        font: SETTINGS_ITEM_FONT,
        color: COLOR_SETTINGS_ITEM,
        align: 'center',
      })
      .setOrigin(0.5);
    this.fullscreenText = this.add
      .text(cx, cy + 20, formatToggle('FULLSCREEN', this._fullscreen), {
        font: SETTINGS_ITEM_FONT,
        color: COLOR_SETTINGS_ITEM,
        align: 'center',
      })
      .setOrigin(0.5);
    this.reducedMotionText = this.add
      .text(cx, cy + 60, formatToggle('REDUCED MOTION', this._reducedMotion), {
        font: SETTINGS_ITEM_FONT,
        color: COLOR_SETTINGS_ITEM,
        align: 'center',
      })
      .setOrigin(0.5);

    // --- Key hint -----------------------------------------------------------
    this.hintText = this.add
      .text(cx, cy + 130, SETTINGS_HINT, {
        font: SETTINGS_HINT_FONT,
        color: COLOR_SETTINGS_HINT,
        align: 'center',
      })
      .setOrigin(0.5);

    applyAdditiveBlend([this.titleText], Phaser.BlendModes.ADD);
    addNeonBloom(this.cameras.main);

    // --- Apply + persist helper --------------------------------------------
    // Re-apply the effective master gain, play a short confirmation blip at the new
    // gain (inaudible when muted / at zero volume — correct feedback), refresh the
    // audio lines, and persist the WHOLE object so no field is clobbered.
    const applyAudio = () => {
      this.audioEngine.setMasterGain(effectiveVolume(this._volume, this._muted));
      this.audioEngine.playSfx('fire');
      this.volumeText.setText(formatVolume(this._volume));
      this.muteText.setText(formatToggle('MUTE', this._muted));
      this._persist();
    };

    // --- Settings keys ------------------------------------------------------
    // event.repeat guard (the Story 5.2 held-key lesson): these keys are bound via
    // scene keyboard events with no registered Key object, so Phaser does NOT
    // suppress OS key auto-repeat — without the guard, holding a key would step every
    // repeat tick. A single tap still steps exactly once (repeat === false).
    this.input.keyboard.on('keydown-MINUS', (event) => {
      if (event && event.repeat) return;
      this._volume = adjustVolume(this._volume, -AUDIO_VOLUME_STEP);
      applyAudio();
    });
    this.input.keyboard.on('keydown-PLUS', (event) => {
      if (event && event.repeat) return;
      this._volume = adjustVolume(this._volume, AUDIO_VOLUME_STEP);
      applyAudio();
    });
    this.input.keyboard.on('keydown-M', (event) => {
      if (event && event.repeat) return;
      this._muted = !this._muted;
      applyAudio();
    });
    // Fullscreen: request the toggle only (visible immediacy). The browser requires
    // this user gesture to ENTER fullscreen; the preference is NOT auto-restored at
    // boot (applied on the toggle keypress only). The label + persisted value are NOT
    // flipped optimistically here — Phaser's scale manager is the SOURCE OF TRUTH, so
    // the enterfullscreen/leavefullscreen handlers below reconcile the real state.
    // This keeps the label and stored value honest even if the browser denies/defers
    // the request or the user leaves fullscreen natively (F11 / click-away / Esc).
    this.input.keyboard.on('keydown-F', (event) => {
      if (event && event.repeat) return;
      this.scale.toggleFullscreen();
    });
    // Reduced motion (Story 6.1): flip the flag, refresh the label, and persist the
    // WHOLE object. Same event.repeat guard as the other keys (no registered Key
    // object, so Phaser does not suppress OS auto-repeat). A pure preference toggle:
    // there is no live effect to apply here — ArenaScene reads it once at run start,
    // so the change takes effect on the next run (settings are reachable only from
    // the title).
    this.input.keyboard.on('keydown-R', (event) => {
      if (event && event.repeat) return;
      this._reducedMotion = !this._reducedMotion;
      this.reducedMotionText.setText(
        formatToggle('REDUCED MOTION', this._reducedMotion),
      );
      this._persist();
    });
    // Reconcile _fullscreen with the REAL display state from the scale manager, then
    // refresh the label and persist. Fires on both key-driven and native transitions.
    const syncFullscreen = (on) => {
      this._fullscreen = on;
      this.fullscreenText.setText(formatToggle('FULLSCREEN', this._fullscreen));
      this._persist();
    };
    const onEnterFullscreen = () => syncFullscreen(true);
    const onLeaveFullscreen = () => syncFullscreen(false);
    this.scale.on('enterfullscreen', onEnterFullscreen);
    this.scale.on('leavefullscreen', onLeaveFullscreen);
    // The scale manager is game-global (outlives this scene), so remove these
    // listeners on shutdown or they would accumulate on each settings visit.
    this.events.once('shutdown', () => {
      this.scale.off('enterfullscreen', onEnterFullscreen);
      this.scale.off('leavefullscreen', onLeaveFullscreen);
    });

    // --- Back to title (through the flow seam) ------------------------------
    // Esc / Enter close settings. Route through nextFlowState so the transition is
    // governed by the state machine (SETTINGS + CLOSE_SETTINGS → TITLE), then start
    // the scene the seam names. A one-shot latch prevents a double-start.
    let closing = false;
    const close = (event) => {
      if (event && event.repeat) return;
      if (closing) return;
      const target = sceneForState(
        nextFlowState(FLOW_STATES.SETTINGS, FLOW_EVENTS.CLOSE_SETTINGS),
      );
      if (!target) return; // illegal transition → guarded no-op
      closing = true;
      this.scene.start(target);
    };
    this.input.keyboard.on('keydown-ESC', close);
    this.input.keyboard.on('keydown-ENTER', close);
  }

  /**
   * Persist the whole { muted, volume, fullscreen, reducedMotion } object through the
   * guarded port (best-effort; never throws). Writing all fields each time keeps a
   * save from clobbering another field. @private
   */
  _persist() {
    this._settings.save({
      muted: this._muted,
      volume: this._volume,
      fullscreen: this._fullscreen,
      reducedMotion: this._reducedMotion,
    });
  }
}
