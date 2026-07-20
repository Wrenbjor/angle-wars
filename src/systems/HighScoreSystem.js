import { System } from '../core/System.js';

// HighScoreSystem — persistent local high score (Story 3.4 / FR11, Phaser-free).
//
// The last piece of the Epic 3 RE1 economy: a personal best that survives a page
// reload. On construction it reads the stored high through the injected guarded
// port (`storage.load()`), seeds the live-tracked display from it, and each fixed
// step tracks the run's best score. On the game-over EDGE it writes the new high
// back through the port exactly ONCE, and only when the run actually beat the
// stored value.
//
// Tick placement — registered AFTER PlayerDeathSystem. PlayerDeathSystem sets
// playerState.gameOver during its own fixedUpdate; ArenaScene.update gates the
// world with `if (!gameOver) world.fixedUpdate(dt)`, which stops every system on
// the NEXT tick — but within the LATCHING tick every system after
// PlayerDeathSystem still runs. So running last lets this system observe gameOver
// on the very tick it becomes true and persist then; on all later ticks the world
// is gated off, so no second persist is possible. The `_persisted` latch makes the
// write idempotent regardless (integration tests call fixedUpdate directly,
// ungated). Same gate reasoning the ExtraLifeSystem design notes rely on.
//
// Write-once, only-when-beaten. `score` is monotonic (ScoringSystem and the
// black-hole payout only add; the death reset touches the multiplier, never the
// score), so the live-tracked `highScore` equals the final score at game-over.
// Comparing it against the baseline read at construction (`_storedHighScore`)
// yields exactly "final exceeds stored" for the write gate — no redundant write
// of an equal/lower value.
//
// It reads scoreState.score and playerState.gameOver (NEVER writes either) and
// touches no other run state. Zero steady-state allocation on the per-tick path
// (integer compares + one guarded write on the single game-over tick).
export class HighScoreSystem extends System {
  /**
   * @param {{score:number}} scoreState Shared run-economy state — score is READ
   *   (never written) to live-track the run's best.
   * @param {{gameOver:boolean}} playerState Shared player lifecycle state —
   *   gameOver is READ (never written) as the persist edge.
   * @param {{load:()=>number, save:(score:number)=>void}} storage The injected
   *   guarded high-score port (a real localStorage-backed adapter in ArenaScene;
   *   a fake in tests).
   */
  constructor(scoreState, playerState, storage) {
    super();
    this.scoreState = scoreState;
    this.playerState = playerState;
    this.storage = storage;

    // Baseline read once at construction: the persisted high score this run must
    // beat to trigger a write. A fresh instance per run (scene.restart rebuilds
    // every system) re-reads the freshly-persisted value.
    this._storedHighScore = storage.load();
    // The live-tracked, displayed high score. Starts at the persisted baseline so
    // on a fresh run (score 0) the HUD shows the persisted value; it then climbs
    // to track the running best each tick.
    this.highScore = this._storedHighScore;
    // Write-once latch: guarantees at most one save per run on the game-over edge.
    this._persisted = false;
  }

  /**
   * Advance one fixed step: live-track the best score; on the game-over edge,
   * persist the new high once — only when the run beat the stored value.
   * @param {number} _dt Constant fixed-step delta, in milliseconds (unused — the
   *   high score is time-independent, driven purely by the monotonic score).
   */
  fixedUpdate(_dt) {
    const score = this.scoreState.score;
    // Live-track the running best (score is monotonic, so this only ever climbs).
    if (score > this.highScore) {
      this.highScore = score;
    }

    // Persist exactly once, on the game-over edge, and only when the CURRENT
    // stored value was actually beaten (strict `>` — an equal final score is not a
    // "beat"). The stored value is RE-READ here rather than compared against the
    // construction-time baseline: localStorage is shared across browser tabs, so a
    // second tab constructed with a stale baseline could otherwise clobber a higher
    // score another tab already persisted. Re-reading defends against that
    // concurrent-tab write. In a single-tab run load() returns the same value seen
    // at construction, so every single-tab result is unchanged.
    if (this.playerState.gameOver && !this._persisted) {
      this._persisted = true;
      const current = this.storage.load();
      if (this.highScore > current) {
        this.storage.save(this.highScore);
        this._storedHighScore = this.highScore;
      }
    }
  }
}
