import { System } from '../core/System.js';

// AudioDirectorSystem — the Phaser-free simulation seam for sound (Story 4.5):
// event→SFX-request latches + a live adaptive-music intensity level.
//
// Runs LAST in the world pipeline (registered after ScreenFeedbackSystem), so
// within each fixed tick every source it reads is already final: the fire count
// (firingSystem.volleysFiredCount — fire EVENTS, falling back to shotsFiredCount on a
// pre-10.3 source), the bullet-kill count (collisionSystem.
// bulletKillCount — this tick's bullet kills, before BlackHole/Bomb appends), the
// spawn count (spawnDirector.spawnCount), the bomb shockwave rising edge
// (bombSystem.shockwaveMs), the death latch (playerDeathSystem.deathSeq increment),
// and the difficulty ramp (spawnDirector.progressAt). It is a PURE read-only
// observer — it mutates ONLY its own latch fields and never touches a pool, entity,
// score, life, death, or spawn state (exactly like GridFieldSystem / ParticleSystem
// / ScreenFeedbackSystem). It is the SAME-events-rendered-as-sound sibling of the
// grid ripple (4.2), the particle burst (4.3), and the screen juice (4.4).
//
// Each fixed step it turns those events into render-consumable latches:
//   - fire/kill/spawn: ACCUMULATING non-negative counts (+= each source this tick),
//     summed across sub-steps so a multi-sub-step frame is added up, then consumed
//     once by the render loop and reset,
//   - bomb/death: one-shot boolean flags raised on the shockwave rising edge / a
//     deathSeq increment (edge-detected, once per event),
//   - musicIntensity: a LEVEL (not an event) — the latest ramp progress (0 at run
//     start → 1 at ramp end), stored each step and read (never consumed/reset) by
//     the render loop, which maps it through audioMix.musicLayerGains to per-layer
//     gains (more difficulty ⇒ more music layers audible).
//
// Edge-detection prevs (_prevShockwaveMs / _prevDeathSeq) are seeded from the
// current source values at construction so no cue fires spuriously on the first
// tick (mirrors ScreenFeedbackSystem / GridFieldSystem). The render loop consumes
// the SFX latches (capped per type) into engine blips and maps the intensity into
// the engine's music-layer gains; the actual Web Audio synthesis lives in the
// browser-bound audioEngine (the disclosed manual-verification boundary).
export class AudioDirectorSystem extends System {
  /**
   * @param {import('./FiringSystem.js').FiringSystem} firingSystem Source of this
   *   tick's fire-event count (volleysFiredCount, falling back to shotsFiredCount when
   *   absent) — the fire SFX cue.
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem Source of
   *   this tick's bullet-kill count (bulletKillCount) — the kill SFX cue.
   * @param {import('./BombSystem.js').BombSystem} bombSystem Source of the bomb
   *   shockwave latch (shockwaveMs rising edge = a detonation) — the bomb SFX cue.
   * @param {import('./PlayerDeathSystem.js').PlayerDeathSystem} playerDeathSystem
   *   Source of the death latch (deathSeq increment) — the death SFX cue.
   * @param {import('./SpawnDirector.js').SpawnDirector} spawnDirector Source of this
   *   tick's spawn count (spawnCount) — the spawn SFX cue — AND the difficulty ramp
   *   (progressAt(elapsedMs)) that drives musicIntensity.
   * @param {import('./BlackHoleSystem.js').BlackHoleSystem} [blackHoleSystem] Source
   *   of the Black Hole instability LEVEL (maxInstability) — the rising-urgency cue
   *   (Story 6.2). Optional: when absent, blackHoleInstability reads 0.
   */
  constructor(
    firingSystem,
    collisionSystem,
    bombSystem,
    playerDeathSystem,
    spawnDirector,
    blackHoleSystem = null,
  ) {
    super();
    this.firingSystem = firingSystem;
    this.collisionSystem = collisionSystem;
    this.bombSystem = bombSystem;
    this.playerDeathSystem = playerDeathSystem;
    this.spawnDirector = spawnDirector;
    this.blackHoleSystem = blackHoleSystem;

    // Edge-detection previous-values, SEEDED from the current state so no spurious
    // cue fires on the first tick (mirrors ScreenFeedbackSystem's prev seeding).
    this._prevShockwaveMs = bombSystem ? bombSystem.shockwaveMs : 0;
    this._prevDeathSeq = playerDeathSystem ? playerDeathSystem.deathSeq : 0;

    // Render-consumable SFX latches (reset by consumeSfxRequests()). Counts
    // accumulate across sub-steps; bomb/death are one-shot flags.
    this._pendingFire = 0;
    this._pendingKill = 0;
    this._pendingSpawn = 0;
    this._bombPending = false;
    this._deathPending = false;

    // Live adaptive-music intensity LEVEL (0..1), stored each step from the ramp.
    // Read (never consumed) via the getter — the render loop maps it to layer gains.
    this._musicIntensity = 0;

    // Reused output object for consumeSfxRequests() so the once-per-frame consume
    // allocates nothing (mirrors the zero-per-frame-allocation discipline).
    this._sfxOut = { fire: 0, kill: 0, spawn: 0, bomb: false, death: false };
  }

  /**
   * Advance one fixed step: accumulate the fire/kill/spawn counts, edge-detect the
   * bomb/death flags, and store the latest music intensity from the ramp. Mutates
   * only this system's own latches.
   * @param {number} _dt Constant fixed-step delta (ms) — unused (the sources already
   *   carry this tick's per-tick counts/latches); kept for the System signature.
   */
  fixedUpdate(_dt) {
    // (1) Fire — accumulate this tick's fire EVENTS (read-only counter on FiringSystem).
    //     The cue counts VOLLEYS, not bullets: a gunshot is a per-trigger-pull event, and
    //     since Story 10.3 one pull can spawn up to 9 bullets (Spread Cannon Lv5). Read
    //     off `shotsFiredCount` — which now means BULLETS spawned — a spread build would
    //     enqueue 9 cues per interval and peg AUDIO_SFX_FIRE_MAX_PER_FRAME on every tick,
    //     turning a stream of shots into a flat wall of noise.
    //     `volleysFiredCount` is absent on pre-10.3 FiringSystem stubs, so fall back to
    //     `shotsFiredCount` there — identical for every single-bullet volley.
    //     The probe is `Number.isFinite`, NOT `!== undefined`: a `null` (or otherwise
    //     non-numeric) volley counter passes an `!== undefined` test and then fails
    //     `n > 0` silently, dropping the fire cue entirely while bullets were spawning.
    //     Requiring a real number falls back for every non-numeric value, so the worst
    //     case is the pre-10.3 per-bullet cue rather than SILENCE.
    //     The FALLBACK's own value is finiteness-checked too. `n > 0` is true for the
    //     string '4', and `this._pendingFire += '4'` on a numeric 0 yields the STRING
    //     '04' — every later tick then concatenates instead of adding, and
    //     consumeSfxRequests().fire hands a string to the render loop's
    //     AUDIO_SFX_FIRE_MAX_PER_FRAME comparison. Guarding only the volley counter
    //     moved that failure one branch down rather than removing it.
    const fs = this.firingSystem;
    if (fs) {
      const raw = Number.isFinite(fs.volleysFiredCount)
        ? fs.volleysFiredCount
        : fs.shotsFiredCount;
      const n = Number.isFinite(raw) ? raw : 0;
      if (n > 0) this._pendingFire += n;
    }

    // (2) Kill — accumulate this tick's bullet kills (the SAME source the grid ripple
    //     / particle burst / screen juice read, before BlackHole/Bomb appends).
    const cs = this.collisionSystem;
    if (cs) {
      const n = cs.bulletKillCount;
      if (n > 0) this._pendingKill += n;
    }

    // (3) Spawn — accumulate this tick's director spawns (one per director spawn,
    //     even when a Snake adds many segments).
    const sd = this.spawnDirector;
    if (sd) {
      const n = sd.spawnCount;
      if (n > 0) this._pendingSpawn += n;
    }

    // (4) Bomb detonation — one-shot flag on the shockwave rising edge. shockwaveMs
    //     only rises at a detonation (otherwise it decays), so the rising edge fires
    //     exactly once per bomb.
    const bs = this.bombSystem;
    if (bs) {
      if (bs.shockwaveMs > this._prevShockwaveMs) {
        this._bombPending = true;
      }
      this._prevShockwaveMs = bs.shockwaveMs;
    }

    // (5) Player death — one-shot flag on each deathSeq increment (both a respawning
    //     death and the final game-over death).
    const pds = this.playerDeathSystem;
    if (pds) {
      if (pds.deathSeq !== this._prevDeathSeq) {
        this._deathPending = true;
        this._prevDeathSeq = pds.deathSeq;
      }
    }

    // (6) Music intensity — the LEVEL, not an event: the latest ramp progress. Read
    //     (never consumed/reset) by the render loop each frame.
    if (sd && typeof sd.progressAt === 'function') {
      this._musicIntensity = sd.progressAt(sd.elapsedMs);
    }
  }

  /**
   * Read-and-reset the accumulated SFX requests since the last consume. Returns a
   * reused object (no per-frame allocation): fire/kill/spawn are non-negative counts,
   * bomb/death are booleans. All latches reset to 0/false after the read.
   * @returns {{fire:number, kill:number, spawn:number, bomb:boolean, death:boolean}}
   */
  consumeSfxRequests() {
    const out = this._sfxOut;
    out.fire = this._pendingFire;
    out.kill = this._pendingKill;
    out.spawn = this._pendingSpawn;
    out.bomb = this._bombPending;
    out.death = this._deathPending;
    this._pendingFire = 0;
    this._pendingKill = 0;
    this._pendingSpawn = 0;
    this._bombPending = false;
    this._deathPending = false;
    return out;
  }

  /**
   * Current adaptive-music intensity LEVEL in [0,1] — the latest SpawnDirector ramp
   * progress. A level, not an event: read every frame, never consumed or reset.
   * @returns {number}
   */
  get musicIntensity() {
    return this._musicIntensity;
  }

  /**
   * Current Black Hole instability LEVEL in [0,1] — the source BlackHoleSystem's
   * maxInstability (the max over active non-telegraphing holes). A level, not an
   * event: read every frame by the render loop (which maps it to the rising-urgency
   * audio cue), never consumed or reset. 0 when there is no BlackHoleSystem source
   * or no unstable hole. Mirrors musicIntensity.
   * @returns {number}
   */
  get blackHoleInstability() {
    return this.blackHoleSystem ? this.blackHoleSystem.maxInstability : 0;
  }
}
