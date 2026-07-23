import { System } from '../core/System.js';
import {
  DPS_WINDOW_MS,
  DPS_DAMAGE_PER_KILL,
  FIXED_STEP_MS,
} from '../config/constants.js';

// DpsTelemetrySystem — a rolling ~10-second estimate of player weapon output
// (Story 9.1 / Epic 9). Phaser-free by design.
//
// This is the PRODUCER of the build-power signal: how much damage the player is
// actually dealing, measured live so Story 9.2's adaptive spawn director can
// answer a strong build instead of letting it trivialize the late game. This
// story delivers ONLY the telemetry — nothing consumes `dps` yet.
//
// It is a PURE observer. Each fixed step it reads exactly one input —
// collisionSystem.bulletKillCount, the already-latched count of PLAYER bullet
// kills this tick (bomb clears and black-hole absorptions are excluded, since
// those are consumables/hazards, not sustained weapon output) — and writes only
// its own fields. It mutates no pool, score, xp, or player state. It is
// registered AFTER CollisionSystem so bulletKillCount is final for the tick.
//
// Frame-rate independence: the estimate advances only on the fixed step, so its
// value after T simulated seconds depends solely on the tick count, never on the
// render cadence. No wall-clock time (Date.now / performance.now) is ever read.
//
// Rolling window, not an EMA: the fixed timestep gives exactly one ring slot per
// fixed step, so a tick-indexed ring of N = round(DPS_WINDOW_MS / FIXED_STEP_MS)
// slots spans a real-time window of N × FIXED_STEP_MS (== DPS_WINDOW_MS exactly
// when the window is an integer multiple of the step, e.g. 600 × (1000/60) ms =
// 10000 ms at the defaults). `dps` is the window sum divided by that ACTUAL span
// in seconds — never the nominal DPS_WINDOW_MS — so normalization stays exact and
// divide-safe even if the tunable constants are retuned. A single kill can only
// ever add 1 / (span seconds) to `dps` — it can never spike on an individual hit, and a
// sustained change in output ramps in/out gradually across the full window. The
// window itself is the smoother; layering an EMA on top would double-smooth and
// blur the 10s contract. One kill = one damage unit is the honest v1 measure
// (all enemies one-shot); Story 9.3's armored HP refines crediting through this
// same `dps` surface without changing this system's shape.
//
// Zero per-frame allocation: the ring is a single Float64Array allocated ONCE in
// the constructor; fixedUpdate allocates no arrays/objects/closures — it evicts
// and replaces the current slot in O(1) via a running sum.
export class DpsTelemetrySystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem
   *   The sibling collision system whose latched per-tick bulletKillCount is the
   *   telemetry source (READ-ONLY here).
   */
  constructor(collisionSystem) {
    super();
    this.collisionSystem = collisionSystem;

    // One ring slot per fixed step ⇒ the ring spans exactly DPS_WINDOW_MS of
    // simulated time. Clamped to at least 1 so a degenerate window never yields
    // an empty ring (and never a divide-by-zero on the modulo). 600 @ 60Hz.
    const N = Math.max(1, Math.round(DPS_WINDOW_MS / FIXED_STEP_MS));
    // Allocated ONCE — never re-allocated in the hot loop.
    this._ring = new Float64Array(N);
    // Write cursor: the slot filled THIS tick (holding the value from ~N ticks
    // ago, evicted before it is overwritten).
    this._i = 0;
    // Running sum of every slot in the ring, maintained incrementally so `dps`
    // is O(1) per tick (no per-tick reduction over the window).
    this._sum = 0;
    // Window length, exposed read-only for a consumer/debug readout.
    this.windowMs = DPS_WINDOW_MS;
    // Public read-only estimate: player damage-units per second, averaged over
    // the window. Starts at 0 (empty window) and is recomputed each tick.
    this.dps = 0;
  }

  /**
   * Advance one fixed step: fold this tick's bullet-kill damage into the rolling
   * window and recompute `dps`. O(1), zero allocation.
   * @param {number} _dt Constant fixed-step delta (ms) — the telemetry advances
   *   per tick, not per dt (one ring slot per fixed step); dt is unused.
   */
  fixedUpdate(_dt) {
    // This tick's damage: player bullet kills × the per-kill damage unit. The
    // count is the already-latched bullet-only figure (bomb/black-hole removals
    // excluded), so bomb clears and absorptions never inflate the signal.
    const dmg = this.collisionSystem.bulletKillCount * DPS_DAMAGE_PER_KILL;
    // Evict the slot from ~DPS_WINDOW_MS ago, write this tick's damage in its
    // place, and keep the running sum consistent — all against the same slot.
    this._sum -= this._ring[this._i];
    this._ring[this._i] = dmg;
    this._sum += dmg;
    // Advance the cursor circularly (N ≥ 1, so the modulo is always defined).
    this._i = (this._i + 1) % this._ring.length;
    // dps = total damage over the window ÷ window length in seconds. Normalize by
    // the ACTUAL ring span (slots × step), never the nominal DPS_WINDOW_MS: when
    // the window is not an exact integer multiple of the step, or when the tunable
    // constants are retuned tiny/zero/negative, the ring's real span is what the
    // sum was accumulated over — and the constructor's N ≥ 1 clamp makes that span
    // always > 0, so the divisor can never go 0/negative → dps stays finite. A
    // single kill contributes 1 / (span seconds) → never a spike.
    const windowSec = (this._ring.length * FIXED_STEP_MS) / 1000;
    this.dps = this._sum / windowSec;
  }
}
