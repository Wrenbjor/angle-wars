import { System } from '../core/System.js';
import {
  SPAWN_DIRECTOR_BASE_INTERVAL_MS,
  SPAWN_DIRECTOR_MIN_INTERVAL_MS,
  SPAWN_DIRECTOR_RAMP_DURATION_MS,
  SPAWN_DIRECTOR_MAX_ACTIVE,
} from '../config/constants.js';

// SpawnDirector — the single escalating spawn authority for the four one-hit
// combat archetypes (Seeker, Green Square, Pinwheel, Snake). Phaser-free.
//
// The four combat systems no longer self-spawn: each keeps its pool + movement
// and exposes a public `spawn()`. This director owns WHEN and WHICH:
//   - a continuous difficulty ramp derived purely from elapsed sim time
//     (`_elapsedMs` = Σ fixed-step dt, so it is frame-rate-independent). The
//     spawn interval falls monotonically from BASE to a MIN floor at
//     RAMP_DURATION and holds flat after; each archetype's mix weight
//     interpolates linearly from its base weight to its peak over the same ramp.
//   - a global active-instance cap: before each spawn it sums the active count
//     across the four governed pools and skips (discarding that interval's banked
//     time) when the total is at/above MAX_ACTIVE. It never despawns live enemies.
//   - per-run reset by reconstruction: `scene.restart()` rebuilds this object at
//     elapsed 0 (the base ramp), so no explicit reset is needed.
//
// The Black Hole is a distinct, locally-capped hazard on its own Story-2.4
// self-spawn — deliberately NOT in this swarm mix.
//
// The steady-state path allocates nothing: the `_weights` scratch buffer is
// reused, and the active-count sum and weighted pick never build new arrays.
export class SpawnDirector extends System {
  /**
   * @param {{ system: { spawn: () => void, enemyPool: { activeCount: number } },
   *           baseWeight: number, peakWeight: number }[]} spawnables The governed
   *   archetypes. Each `system` exposes a public `spawn()` and an `enemyPool`
   *   whose `activeCount` feeds the global cap.
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for the
   *   weighted archetype pick; injectable so selection is unit-testable.
   * @param {{x:number,y:number}|null} [ship=null] The player ship (Story 2.6). When
   *   set, the director is the sole spawn-point ship-avoidance coordinate source
   *   for its four archetypes: it passes `ship.x, ship.y` to each `spawn()` so the
   *   placement re-rolls away from the ship. When null, `spawn()` is called with no
   *   avoid args (back-compat). The archetypes never store the ship — it flows only
   *   as a `spawn()` argument, so Pinwheel/Snake stay player-indifferent.
   */
  constructor(spawnables, rng = Math.random, ship = null) {
    super();
    this._spawnables = spawnables;
    this._rng = rng;
    this._ship = ship;

    // Elapsed sim time (Σ dt) — the sole input to the ramp. Advances only by dt.
    this._elapsedMs = 0;
    // Spawn-interval accumulator (ms). Advances only by dt. Starts at 0 so the
    // first spawn fires after one full (base) interval.
    this._accumMs = 0;

    // Reusable weight scratch, refilled each spawn from the interpolated weights.
    // Its reference is stable for the director's lifetime — zero per-tick alloc.
    this._weights = new Array(spawnables.length).fill(0);

    // Public read-only observability latch (Story 4.5): the number of director
    // spawns THIS tick (one per actual spawn — a Snake adding many segments still
    // counts as ONE spawn event). Reset at the top of every fixedUpdate (so an empty
    // tick reports 0 and a spawn is never counted twice), then ++ once per spawn in
    // _pickAndSpawn. Read by the AudioDirectorSystem (spawn SFX source) — mirrors
    // CollisionSystem.bulletKillCount. Purely observational: it never affects the
    // spawn cadence, cap, mix, or placement.
    this.spawnCount = 0;
  }

  /** Elapsed sim time in ms (Σ of every dt seen). Read-only accessor. */
  get elapsedMs() {
    return this._elapsedMs;
  }

  /** Current spawn interval (ms) at the director's current elapsed time. */
  get currentInterval() {
    return this.intervalAt(this._elapsedMs);
  }

  /**
   * Ramp progress p = clamp(elapsed / RAMP_DURATION, 0, 1) — a pure function of
   * elapsed, so the value at a given elapsed time is identical regardless of the
   * tick size that reached it.
   * @param {number} elapsedMs
   * @returns {number} p in [0,1]
   */
  progressAt(elapsedMs) {
    const p = elapsedMs / SPAWN_DIRECTOR_RAMP_DURATION_MS;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return p;
  }

  /**
   * Spawn interval (ms) at a given elapsed time: linear from BASE (p=0) down to
   * MIN (p=1), clamped flat at MIN after. Monotonic non-increasing in elapsed.
   * @param {number} elapsedMs
   * @returns {number}
   */
  intervalAt(elapsedMs) {
    const p = this.progressAt(elapsedMs);
    return (
      SPAWN_DIRECTOR_BASE_INTERVAL_MS -
      (SPAWN_DIRECTOR_BASE_INTERVAL_MS - SPAWN_DIRECTOR_MIN_INTERVAL_MS) * p
    );
  }

  /**
   * Interpolated weight for one archetype at a given elapsed time: linear from
   * baseWeight (p=0) to peakWeight (p=1). A pure function of elapsed.
   * @param {number} baseWeight
   * @param {number} peakWeight
   * @param {number} elapsedMs
   * @returns {number}
   */
  weightAt(baseWeight, peakWeight, elapsedMs) {
    const p = this.progressAt(elapsedMs);
    return baseWeight + (peakWeight - baseWeight) * p;
  }

  /**
   * Advance one fixed step: accumulate elapsed + banked time, then fire one spawn
   * per elapsed interval (subject to the global cap).
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    // Ramp inputs advance ONLY by dt (never render time) so escalation is
    // frame-rate-independent. Elapsed is fixed for the duration of this tick, so
    // the interval is computed once from it (not re-derived per banked interval).
    this._elapsedMs += dt;
    this._accumMs += dt;

    // Reset the per-tick spawn report (Story 4.5) so a tick with no spawns reports 0
    // and a prior tick's spawns are never re-counted.
    this.spawnCount = 0;

    const interval = this.intervalAt(this._elapsedMs);
    while (this._accumMs >= interval) {
      this._accumMs -= interval;
      // Global cap gate: at/above the cap, skip the spawn and discard this
      // interval's banked time (already subtracted above — not re-tried next
      // tick), mirroring the Black Hole's by-design at-cap behavior.
      //
      // This is a SOFT cap: the check runs BEFORE the spawn and a single picked
      // archetype can add more than one instance (a Snake adds
      // SNAKE_SEGMENT_COUNT segments at once). So one spawn taken at MAX_ACTIVE-1
      // may push the summed total to at most MAX_ACTIVE + (largest per-spawn
      // cost) - 1; the gate then blocks the NEXT spawn. The overshoot is bounded
      // and intentional (matching the Black Hole's check-before discipline), not
      // a hard real-time ceiling — a per-archetype cost pre-check is deliberately
      // avoided to keep the gate a single cheap sum.
      if (this._totalActive() >= SPAWN_DIRECTOR_MAX_ACTIVE) continue;
      this._pickAndSpawn();
    }
  }

  /**
   * Sum of active instances across the four governed pools (a snake counts as its
   * live segments). No allocation — a running sum over the spawnable list.
   * @returns {number}
   * @private
   */
  _totalActive() {
    const spawnables = this._spawnables;
    let sum = 0;
    for (let i = 0; i < spawnables.length; i++) {
      sum += spawnables[i].system.enemyPool.activeCount;
    }
    return sum;
  }

  /**
   * Pick one archetype by the CURRENT interpolated weights and call its `spawn()`.
   * Refills the reused `_weights` buffer, then walks a running `rng()*total`
   * subtraction — no per-tick arrays, no sort. A weight of 0 contributes no band,
   * so a 0-weight archetype is never selected. A no-op if every weight is 0.
   * @private
   */
  _pickAndSpawn() {
    const spawnables = this._spawnables;
    const weights = this._weights;
    const elapsed = this._elapsedMs;

    let total = 0;
    for (let i = 0; i < spawnables.length; i++) {
      const w = this.weightAt(
        spawnables[i].baseWeight,
        spawnables[i].peakWeight,
        elapsed,
      );
      weights[i] = w;
      total += w;
    }
    if (total <= 0) return; // no positive-weight archetype — nothing to spawn

    // Story 2.6: forward the ship position as the avoid point when the director
    // holds a ship, else call spawn() with no avoid args (back-compat). The ship
    // is passed only as an argument — the archetypes never store it.
    const ship = this._ship;

    let r = this._rng() * total;
    for (let i = 0; i < spawnables.length; i++) {
      r -= weights[i];
      if (r < 0) {
        if (ship) spawnables[i].system.spawn(ship.x, ship.y);
        else spawnables[i].system.spawn();
        this.spawnCount++; // Story 4.5 read-only spawn-event counter
        return;
      }
    }
    // Float guard: if rng()*total lands exactly on the top boundary (r never went
    // negative), award the spawn to the last positive-weight archetype.
    for (let i = spawnables.length - 1; i >= 0; i--) {
      if (weights[i] > 0) {
        if (ship) spawnables[i].system.spawn(ship.x, ship.y);
        else spawnables[i].system.spawn();
        this.spawnCount++; // Story 4.5 read-only spawn-event counter
        return;
      }
    }
  }
}
