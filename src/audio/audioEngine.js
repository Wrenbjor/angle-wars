import {
  AUDIO_MUSIC_LAYER_COUNT,
  AUDIO_MUSIC_BASE_FREQ,
  AUDIO_MUSIC_GAIN_SMOOTHING,
  AUDIO_URGENCY_FREQ,
  AUDIO_URGENCY_MAX_GAIN,
  AUDIO_SFX_FIRE_FREQ,
  AUDIO_SFX_FIRE_MS,
  AUDIO_SFX_FIRE_GAIN,
  AUDIO_SFX_KILL_FREQ,
  AUDIO_SFX_KILL_MS,
  AUDIO_SFX_KILL_GAIN,
  AUDIO_SFX_SPAWN_FREQ,
  AUDIO_SFX_SPAWN_MS,
  AUDIO_SFX_SPAWN_GAIN,
  AUDIO_SFX_BOMB_FREQ,
  AUDIO_SFX_BOMB_MS,
  AUDIO_SFX_BOMB_GAIN,
  AUDIO_SFX_DEATH_FREQ,
  AUDIO_SFX_DEATH_MS,
  AUDIO_SFX_DEATH_GAIN,
  AUDIO_SFX_FUSION_FREQ,
  AUDIO_SFX_FUSION_MS,
  AUDIO_SFX_FUSION_GAIN,
} from '../config/constants.js';

// audioEngine — the browser-bound procedural synth for Story 4.5 (Web Audio API).
//
// This codebase has ZERO art/audio assets — every visual is drawn procedurally — so
// audio is SYNTHESISED, not loaded: this engine builds a master GainNode, a fixed
// set of continuously-running oscillator "music" voices, and one-shot enveloped
// "blip" oscillators per SFX event. It is the disclosed MANUAL-VERIFICATION BOUNDARY
// (the 4.1–4.4 render-wiring precedent): the Web Audio globals (AudioContext,
// oscillators, gains) are browser-bound and absent under vitest/node, so the
// Phaser-free AudioDirectorSystem + audioMix + settingsStorage carry the
// automated coverage while this engine is exercised by `npm run dev`.
//
// GUARDED: the constructor takes an AudioContext or null. A null/absent/blocked
// context (or any node it fails to build) degrades EVERY method to a silent no-op
// (mirrors the guarded highScoreStorage) — audio never throws into or blocks the
// sim/render loop. Reusing Phaser's `this.sound.context` lets Phaser handle the
// autoplay-policy unlock/resume on the first user gesture. Imports NO Phaser; reads
// only AUDIO_* constants for its magnitudes.
//
// The continuously-running music voices are built ONCE (in the ctor) and torn down
// by dispose() (called on the scene `shutdown` event) so a scene.restart() never
// stacks another set of oscillators on the shared context.
export class AudioEngine {
  /**
   * @param {AudioContext|null} audioContext A Web Audio context (Phaser's
   *   `this.sound.context`) or null. Null → the whole engine is a no-op.
   */
  constructor(audioContext) {
    this._ctx = audioContext || null;
    this._master = null;
    /** @type {{osc: OscillatorNode, gain: GainNode}[]} */
    this._layers = [];
    // Story 6.2 Black Hole urgency voice: one continuously-running oscillator whose
    // gain tracks the hole instability level (setBlackHoleUrgency). Built once, torn
    // down by dispose(). Null when the engine is a no-op.
    this._urgency = null;
    this._disposed = false;

    // Per-SFX synthesis table (freq Hz, duration ms, peak gain), keyed by type.
    // Read by playSfx(); built once so a blip is a constant-time lookup.
    this._sfx = {
      fire: { freq: AUDIO_SFX_FIRE_FREQ, ms: AUDIO_SFX_FIRE_MS, gain: AUDIO_SFX_FIRE_GAIN },
      kill: { freq: AUDIO_SFX_KILL_FREQ, ms: AUDIO_SFX_KILL_MS, gain: AUDIO_SFX_KILL_GAIN },
      spawn: { freq: AUDIO_SFX_SPAWN_FREQ, ms: AUDIO_SFX_SPAWN_MS, gain: AUDIO_SFX_SPAWN_GAIN },
      bomb: { freq: AUDIO_SFX_BOMB_FREQ, ms: AUDIO_SFX_BOMB_MS, gain: AUDIO_SFX_BOMB_GAIN },
      death: { freq: AUDIO_SFX_DEATH_FREQ, ms: AUDIO_SFX_DEATH_MS, gain: AUDIO_SFX_DEATH_GAIN },
      // Story 12.2: rising 4-tone fanfare arpeggio (440 → 554 → 660 → 880 Hz).
      // Total duration is AUDIO_SFX_FUSION_MS split across 4 overlapping tones.
      fusion: { freq: AUDIO_SFX_FUSION_FREQ, ms: AUDIO_SFX_FUSION_MS, gain: AUDIO_SFX_FUSION_GAIN },
    };

    if (!this._ctx) return; // no context → no-op engine

    try {
      // Master gain: every voice + blip routes through this into the destination, so
      // setMasterGain() (from effectiveVolume) is the single volume/mute control.
      this._master = this._ctx.createGain();
      this._master.gain.value = 0; // start silent; ArenaScene applies the loaded volume
      this._master.connect(this._ctx.destination);

      // Continuously-running music voices: one oscillator per layer, each through its
      // own gain (driven by setMusicLayerGains) into master. Built once and left
      // running for the engine's life; only their gains change with intensity.
      for (let i = 0; i < AUDIO_MUSIC_LAYER_COUNT; i++) {
        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = AUDIO_MUSIC_BASE_FREQ * (i + 1); // harmonic stack
        gain.gain.value = 0; // silent until intensity brings the layer in
        osc.connect(gain);
        gain.connect(this._master);
        osc.start();
        this._layers.push({ osc, gain });
      }

      // Black Hole urgency voice (Story 6.2): a single continuously-running tone
      // above the music drone, silent by default; its gain is driven by
      // setBlackHoleUrgency(level) so a hole nearing detonation sounds a rising
      // tension cue. Built once alongside the music voices.
      {
        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = AUDIO_URGENCY_FREQ;
        gain.gain.value = 0; // silent until an unstable hole raises it
        osc.connect(gain);
        gain.connect(this._master);
        osc.start();
        this._urgency = { osc, gain };
      }
    } catch {
      // Any node-build failure → fully degrade to a no-op (tear down what exists).
      this._safeDispose();
    }
  }

  /**
   * Play a short enveloped one-shot blip for an SFX event type ('fire' | 'kill' |
   * 'spawn' | 'bomb' | 'death'). A no-op when the engine is disabled/disposed or the
   * type is unknown. Creates a per-event oscillator + gain (one-shot Web Audio nodes
   * are single-use and auto-collected after they stop) — this is the Web Audio idiom
   * for discrete events, not per-frame sim/render allocation.
   * @param {string} type The SFX type.
   */
  playSfx(type) {
    if (!this._ctx || !this._master || this._disposed) return;
    const spec = this._sfx[type];
    if (!spec) return;
    try {
      if (type === 'fusion') {
        // Rising 4-tone ascending major-triad arpeggio (Story 12.2): 
        // 440 → 554 → 660 → 880 Hz, ~100ms each with slight overlap.
        this._playFusionArpeggio(spec.gain, spec.ms, this._ctx.currentTime);
        return;
      }
      const now = this._ctx.currentTime;
      const durSec = spec.ms / 1000;
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.frequency.setValueAtTime(spec.freq, now);
      // Bomb + death are longer, "descending" impacts: sweep the frequency down over
      // the envelope for a boom / falling tone; the short cues hold a flat pitch.
      if (type === 'bomb' || type === 'death') {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(spec.freq * 0.25, 1),
          now + durSec,
        );
      }
      // Amplitude envelope: quick attack to peak, exponential decay to ~silence.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(spec.gain, now + Math.min(0.01, durSec));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
      osc.connect(gain);
      gain.connect(this._master);
      osc.start(now);
      osc.stop(now + durSec);
    } catch {
      // A rejected schedule (e.g. context not yet resumed) never breaks the frame.
    }
  }

  /**
   * Play the fusion-ready rising arpeggio (Story 12.2): 4 overlapping ascending tones
   //  440 → 554 → 660 → 880 Hz, each ~100ms, with quick attack/slow decay per tone.
   *   Produces a heroic "fanfare" sound — distinct from all other SFX.
   * @private
   */
  _playFusionArpeggio(peakGain, totalMs, now) {
    // Four tones of an ascending major triad, each ~100ms with slight overlap.
    const tones = [440, 554, 660, 880];
    const perTone = Math.max(totalMs / 4, 80); // at least 80ms per tone
    for (let i = 0; i < tones.length; i++) {
      const freq = tones[i];
      const start = now + i * (perTone / 1000) * 0.7; // slight overlap (0.7× spacing)
      const durSec = (perTone + 30) / 1000; // each tone extends slightly past end
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Quick attack to peak, gentle decay — bright and clear.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + durSec);
      osc.connect(gain);
      gain.connect(this._master);
      osc.start(start);
      osc.stop(start + durSec);
    }
  }

  /**
   * Set the per-layer music gains (from audioMix.musicLayerGains). Smoothed via
   * setTargetAtTime so intensity changes glide rather than click. Extra/missing
   * entries are ignored (bounded to the built layer count). No-op when disabled.
   * @param {number[]} gains Array of per-layer target gains.
   */
  setMusicLayerGains(gains) {
    if (!this._ctx || this._disposed || !gains) return;
    try {
      const now = this._ctx.currentTime;
      const layers = this._layers;
      const n = Math.min(layers.length, gains.length);
      for (let i = 0; i < n; i++) {
        layers[i].gain.gain.setTargetAtTime(gains[i], now, AUDIO_MUSIC_GAIN_SMOOTHING);
      }
    } catch {
      // Never let a scheduling error break the render loop.
    }
  }

  /**
   * Set the Black Hole urgency-cue gain from an instability LEVEL in [0,1] (Story
   * 6.2): the continuously-running urgency voice's gain glides to
   * level·AUDIO_URGENCY_MAX_GAIN, so a hole nearing detonation rises in tension and
   * a defused/absent hole (level 0) falls silent. Smoothed via setTargetAtTime.
   * No-op when disabled/disposed. This is the audible half of the disclosed
   * manual-verification boundary.
   * @param {number} level Instability in [0,1] (clamped).
   */
  setBlackHoleUrgency(level) {
    if (!this._ctx || !this._urgency || this._disposed) return;
    try {
      let l = Number.isFinite(level) ? level : 0;
      if (l < 0) l = 0;
      else if (l > 1) l = 1;
      this._urgency.gain.gain.setTargetAtTime(
        l * AUDIO_URGENCY_MAX_GAIN,
        this._ctx.currentTime,
        AUDIO_MUSIC_GAIN_SMOOTHING,
      );
    } catch {
      // Never let a scheduling error break the render loop.
    }
  }

  /**
   * Set the master output gain (from audioMix.effectiveVolume — 0 when muted). No-op
   * when disabled/disposed.
   * @param {number} gain Effective master gain in [0,1].
   */
  setMasterGain(gain) {
    if (!this._master || this._disposed) return;
    try {
      const g = Number.isFinite(gain) ? gain : 0;
      this._master.gain.setTargetAtTime(g, this._ctx.currentTime, 0.01);
    } catch {
      // Fall back to a direct set if scheduling is unavailable.
      try {
        this._master.gain.value = Number.isFinite(gain) ? gain : 0;
      } catch {
        // Give up silently — audio must never throw.
      }
    }
  }

  /**
   * Stop + disconnect the continuously-running music voices and the master node, so a
   * scene.restart() never stacks another set of oscillators on the shared context.
   * Idempotent and safe to call on a disabled engine. Called on the scene `shutdown`.
   */
  dispose() {
    this._disposed = true;
    this._safeDispose();
  }

  /**
   * Tear down every built node, swallowing any error (a stopped/disconnected node can
   * throw on re-stop). Shared by dispose() and the ctor's build-failure path.
   * @private
   */
  _safeDispose() {
    const layers = this._layers;
    for (let i = 0; i < layers.length; i++) {
      try {
        layers[i].osc.stop();
      } catch {
        // already stopped / not started — ignore
      }
      try {
        layers[i].osc.disconnect();
      } catch {
        // ignore
      }
      try {
        layers[i].gain.disconnect();
      } catch {
        // ignore
      }
    }
    this._layers = [];
    if (this._urgency) {
      try {
        this._urgency.osc.stop();
      } catch {
        // already stopped / not started — ignore
      }
      try {
        this._urgency.osc.disconnect();
      } catch {
        // ignore
      }
      try {
        this._urgency.gain.disconnect();
      } catch {
        // ignore
      }
      this._urgency = null;
    }
    if (this._master) {
      try {
        this._master.disconnect();
      } catch {
        // ignore
      }
      this._master = null;
    }
  }
}
