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
// answer a strong build instead of letting it trivialize the late game.
//
// Story 9.4 transient-boost seam: applyBoost(magnitude, durationMs) folds a
// linearly-decaying transient into `dps` — the SINGLE signal the governor
// consumes — so a sudden power spike (Epic 13's cheat-code rewards) routes
// through the already-validated 9.2 slew limiter + 9.3 armored gating with NO
// new director input and NO second balancing surface (epic + NFR8: "no new
// balancing surface"). The boost is expressed in the governor's native units
// (damage/sec), added on TOP of the pure rolling estimate: with no boost applied
// `dps` is byte-identical to the 9.1 signal. The transient drains by SIM TIME
// (dt), reaching 0 at exactly `durationMs` for any tick size (frame-rate-
// independent), and is allocation-free (scalar fields only). Epic 13 calls this
// same method with the GOVERNOR_BOOST_* defaults — the hook is its whole footprint.
//
// It is a PURE observer. Each fixed step it reads exactly one input —
// collisionSystem.bulletDamageCount, the already-latched count of PLAYER-DAMAGE
// HITS that dealt damage this tick (bomb clears and black-hole absorptions are
// excluded, since those are consumables/hazards, not sustained weapon output) —
// and writes only its own fields. It mutates no pool, score, xp, or player state.
// It is registered AFTER CollisionSystem — and after the Story 10.5 DashSystem, which
// appends through the same applyPlayerDamage helper — so bulletDamageCount is final
// for the tick.
//
// Story 9.3 refinement: the source is bulletDamageCount, not bulletKillCount, so
// crediting is per damaging HIT rather than per KILL. For a one-shot enemy a hit IS
// a kill (identical to the v1 measure), but a non-killing hit into ARMORED hp still
// credits 1 — so build power reflects damage POURED INTO armor, not just kills, and
// the Story 9.2 governor does not sag against a wall of armor. This realizes the
// refinement the constant comment reserved without changing this system's shape.
// Crediting an INTEGER per hit (never a fraction per kill) keeps every ring slot an
// integer, so the estimator stays exact — the deferred-work float-drift risk of
// fractional per-kill armor crediting is avoided by construction.
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
// blur the 10s contract. One damaging HIT = one damage unit is the honest measure
// (== one kill for the one-shot archetypes; a non-killing armor hit still credits
// 1), crediting build power through this same `dps` surface — the Story 9.3
// refinement, delivered without changing this system's shape.
//
// Zero per-frame allocation: the ring is a single Float64Array allocated ONCE in
// the constructor; fixedUpdate allocates no arrays/objects/closures — it evicts
// and replaces the current slot in O(1) via a running sum.
export class DpsTelemetrySystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem
   *   The sibling collision system whose latched per-tick bulletDamageCount is the
   *   telemetry source (READ-ONLY here) — every PLAYER-DAMAGE hit routed through its
   *   applyPlayerDamage helper: bullets, then the Story 10.5 dash sweep.
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
    // the window PLUS any live transient boost (Story 9.4). Starts at 0 (empty
    // window, no boost) and is recomputed each tick.
    this.dps = 0;

    // --- Story 9.4 transient-boost seam -----------------------------------
    // Public: the live boost component currently folded into `dps` (in the same
    // damage/sec units). Mirrors `this.dps` so a DEV readout can show the spike
    // and its fade. 0 == no boost, so `dps` == the pure rolling estimate.
    this.boostDps = 0;
    // Private: how fast the reservoir drains, in boost-units per ms of sim time.
    // Re-derived on every applyBoost() so the CURRENT reservoir empties over the
    // NEW durationMs (drain × dur == reservoir ⇒ reaches 0 at exactly durationMs).
    this._boostDrainPerMs = 0;
  }

  /**
   * Apply a transient power boost (Story 9.4) — the single reusable entry point
   * Epic 13's Generosity Engine calls with the GOVERNOR_BOOST_* defaults. The
   * magnitude is added to `boostDps` (which folds into `dps`), so the governor's
   * 9.2 slew response + 9.3 gating answer it with no new balancing surface.
   * Stacking is additive: the drain rate is re-derived so the COMBINED reservoir
   * empties over the new `durationMs`. Invalid input (magnitude/durationMs ≤ 0 or
   * non-finite) is a silent no-op — the hook never reduces or poisons `dps`.
   * @param {number} magnitude Boost size in damage-units/sec (> 0).
   * @param {number} durationMs Linear fade time in sim ms (> 0).
   */
  applyBoost(magnitude, durationMs) {
    // Require FINITE positive values. This rejects NaN/undefined/negatives/zero AND
    // +Infinity in one guard: a `+Infinity` magnitude would make `boostDps` Infinity
    // and next tick `Infinity − Infinity = NaN` would stick `dps` at NaN forever
    // (the decay is gated on `boostDps > 0`, and `NaN > 0` is false, so nothing
    // recovers it); an infinite `durationMs` would give a 0 drain that never fades.
    // So a bad call can never poison `dps` with NaN/Infinity nor drive `boostDps`
    // negative — it is a silent no-op.
    if (
      !Number.isFinite(magnitude) ||
      magnitude <= 0 ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      return;
    }
    this.boostDps += magnitude; // stack additively
    this._boostDrainPerMs = this.boostDps / durationMs; // empties over durationMs
  }

  /**
   * Advance one fixed step: decay any live boost by sim time, fold this tick's
   * player-damage hits into the rolling window, and recompute `dps`. O(1), zero
   * allocation.
   * @param {number} dt Constant fixed-step delta (ms). The rolling window advances
   *   per TICK (one ring slot per fixed step, dt-independent); the Story 9.4 boost
   *   drains per dt of SIM TIME so it fades in exactly durationMs at any tick size.
   */
  fixedUpdate(dt) {
    // Story 9.4: drain the transient boost by SIM TIME (frame-rate-independent).
    // Total drain over durationMs is _boostDrainPerMs × durationMs == boostDps₀,
    // so it reaches 0 at exactly durationMs; the clamp stops it going negative.
    if (this.boostDps > 0) {
      this.boostDps -= this._boostDrainPerMs * dt;
      if (this.boostDps < 0) this.boostDps = 0;
    }
    // This tick's damage: PLAYER-DAMAGE hits × the per-hit damage unit (Story 9.3 — a
    // non-killing armor hit counts as 1 unit, same as a kill). Story 10.5 WIDENED that
    // contract: the count is every hit that went through CollisionSystem
    // .applyPlayerDamage — bullets, then the Afterburner Lv4+ dash sweep — and still
    // EXCLUDES the unscored bomb/black-hole removals, so those never inflate the
    // signal. (The `bulletDamageCount` name is kept: six consumers read these latches
    // and renaming was explicitly out of scope.)
    const dmg = this.collisionSystem.bulletDamageCount * DPS_DAMAGE_PER_KILL;
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
    // Fold the live boost (Story 9.4) on TOP of the pure rolling estimate — the
    // governor already reads `.dps`. With boostDps 0 this is byte-identical to 9.1.
    this.dps = this._sum / windowSec + this.boostDps;
  }
}
