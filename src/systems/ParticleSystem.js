import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createParticle } from '../entities/Particle.js';
import {
  PARTICLE_MAX,
  PARTICLE_BURST_COUNT,
  PARTICLE_BURST_SPEED_MIN,
  PARTICLE_BURST_SPEED_MAX,
  PARTICLE_BURST_LIFETIME_MS,
  PARTICLE_BURST_SIZE,
  PARTICLE_BURST_COLOR,
  PARTICLE_DRAG_RETAIN_PER_SEC,
  PARTICLE_THRUST_MIN_INTENT,
  PARTICLE_TRAIL_INTERVAL_MS,
  PARTICLE_TRAIL_LIFETIME_MS,
  PARTICLE_TRAIL_SPEED,
  PARTICLE_TRAIL_SPREAD_RAD,
  PARTICLE_TRAIL_SIZE,
  PARTICLE_TRAIL_COLOR,
} from '../config/constants.js';

const TAU = Math.PI * 2;

// ParticleSystem — the Phaser-free simulation seam for pooled visual particles
// (Story 4.3): the signature "everything sprays sparks" juice (FR12, NFR2).
//
// Runs LAST in the world pipeline (registered after HighScoreSystem /
// GridFieldSystem), so within each fixed tick every input it reads is already
// final: collisionSystem.bulletKillCount (this tick's bullet kills only, before
// BlackHole/Bomb append their own removals), the recycle-proof
// collisionSystem.bulletKillX/Y kill-time coordinate SNAPSHOTS (the same source
// Story 4.2's grid ripples use), the post-move ship position/facing, and the
// render-sampled inputState move intent. It owns a Pool of plain particle objects
// and ONLY mutates its own pool — no kills, scoring, lives, movement, or firing is
// touched. It is a pure read-only observer.
//
// Each fixed step it:
//   1. advances every live particle (age += dt, integrate by velocity, decay
//      velocity by exponential drag) and expires those past their lifetime,
//   2. emits a BURST of PARTICLE_BURST_COUNT particles per bullet-killed enemy at
//      that kill's snapshot origin (bullet kills ONLY — an absorb is not an
//      explosion and the bomb owns its own effect, exactly like the grid ripple),
//   3. emits a throttled thrust TRAIL: one particle per PARTICLE_TRAIL_INTERVAL_MS
//      of accumulated thrust time, drifting opposite the ship facing.
//
// Bounded: live particles never exceed PARTICLE_MAX; an emission that would exceed
// the cap is skipped. "Thousands live" is the cap + pool reuse, not unbounded growth.
//
// Zero steady-state allocation: advance materializes the active set into a reusable
// scratch array (Pool.forEachActive forbids releasing mid-iteration), integrates in
// place, collects expired into a second reusable array, and releases them in a
// second pass — the CollisionSystem scratch pattern. Emission acquire()s from the
// pool (reusing a freed particle; the factory allocates only while growing).
export class ParticleSystem extends System {
  /**
   * @param {import('./CollisionSystem.js').CollisionSystem} collisionSystem Source
   *   of this tick's bullet-kill coordinate snapshots: bulletKillX/Y[0 ..
   *   bulletKillCount) (recycle-proof, unlike the killedEnemies objects).
   * @param {{x:number,y:number,angle:number}} ship The player ship — read for the
   *   trail origin (post-move position) and facing. Observed, never mutated.
   * @param {{moveX:number,moveY:number}} inputState The shared move intent — read
   *   for the thrust gate. Observed, never mutated.
   * @param {() => number} [rng] Uniform [0,1) source (injected for deterministic
   *   tests). Defaults to Math.random.
   */
  constructor(collisionSystem, ship, inputState, rng = Math.random) {
    super();
    this.collisionSystem = collisionSystem;
    this.ship = ship;
    this.inputState = inputState;
    this.rng = rng;

    // The particle pool — the single source of active/free truth. Lazy growth;
    // reuse on the hot path (no per-tick allocation once warm).
    this.pool = new Pool(createParticle);

    // Reusable advance scratch: the materialized active set and the expired set,
    // both length-reset each tick (no per-tick allocation). `_collect` is a hoisted
    // closure so forEachActive reuses one arrow instead of allocating per tick.
    this._active = [];
    this._expired = [];
    this._collect = (p) => this._active.push(p);

    // Thrust-trail throttle accumulator (ms). Rises by dt while thrust intent is at
    // or above the threshold and sheds one interval per emitted particle; resets to
    // 0 the instant intent drops below the threshold so the trail ends cleanly.
    this._trailAccumMs = 0;
  }

  /**
   * Advance one fixed step: age/expire live particles, emit this tick's bullet-kill
   * bursts, and emit the throttled thrust trail.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const dtSec = dt / 1000;

    // (1) Advance + expire. Materialize the active set first (releasing mid-
    //     iteration over the pool's active Set is unsafe), integrate in place, then
    //     release expired particles in a second pass.
    const active = this._active;
    const expired = this._expired;
    active.length = 0;
    expired.length = 0;
    this.pool.forEachActive(this._collect);

    // Velocity retained this step from the per-second drag: retain^(dt/1000).
    const dragFactor = Math.pow(PARTICLE_DRAG_RETAIN_PER_SEC, dtSec);
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      p.ageMs += dt;
      // Integrate position with the CURRENT velocity, then decay the velocity —
      // so a burst flings out fast and slows as it fades.
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vx *= dragFactor;
      p.vy *= dragFactor;
      if (p.ageMs >= p.lifeMs) {
        expired.push(p);
      }
    }
    for (let i = 0; i < expired.length; i++) {
      this.pool.release(expired[i]);
    }

    // (2) Bullet-kill bursts. Read the recycle-proof coordinate SNAPSHOTS
    //     bulletKillX/Y[0 .. bulletKillCount) — the count already excludes
    //     absorb/bomb-cleared removals (appended after the latch), so only genuine
    //     bullet explosions spray. The cap is honored per particle.
    const cs = this.collisionSystem;
    if (cs) {
      const n = cs.bulletKillCount;
      for (let k = 0; k < n; k++) {
        const x = cs.bulletKillX[k];
        const y = cs.bulletKillY[k];
        for (let c = 0; c < PARTICLE_BURST_COUNT; c++) {
          if (this.pool.activeCount >= PARTICLE_MAX) break; // soft cap reached
          const heading = this.rng() * TAU;
          const speed =
            PARTICLE_BURST_SPEED_MIN +
            this.rng() * (PARTICLE_BURST_SPEED_MAX - PARTICLE_BURST_SPEED_MIN);
          this._emit(
            x,
            y,
            Math.cos(heading) * speed,
            Math.sin(heading) * speed,
            PARTICLE_BURST_LIFETIME_MS,
            PARTICLE_BURST_SIZE,
            PARTICLE_BURST_COLOR,
          );
        }
      }
    }

    // (3) Thrust trail. Throttled to one particle per PARTICLE_TRAIL_INTERVAL_MS of
    //     accumulated thrust time; a large catch-up dt emits a bounded number. When
    //     intent falls below the threshold the accumulator resets so the trail stops
    //     immediately. Intent is constant across a frame's sub-steps (sampled once at
    //     render rate), so per-sub-step accumulation is correct.
    const input = this.inputState;
    const ship = this.ship;
    if (input && ship) {
      const intent = Math.hypot(input.moveX, input.moveY);
      if (intent >= PARTICLE_THRUST_MIN_INTENT) {
        this._trailAccumMs += dt;
        // Guard the throttle loop: PARTICLE_TRAIL_INTERVAL_MS is a "tuned later"
        // placeholder — a mis-set value of 0 or negative would keep the condition
        // permanently true while the subtraction never reduces the accumulator, an
        // infinite loop that hard-freezes the game. Only drain a strictly-positive
        // interval; behavior for the shipped value is identical.
        const step = PARTICLE_TRAIL_INTERVAL_MS;
        if (step > 0) {
          while (this._trailAccumMs >= step) {
            this._trailAccumMs -= step;
            if (this.pool.activeCount >= PARTICLE_MAX) continue; // capped: still drain
            // Drift opposite the ship's facing (angle + PI), jittered by the spread.
            const spread = (this.rng() * 2 - 1) * PARTICLE_TRAIL_SPREAD_RAD;
            const heading = ship.angle + Math.PI + spread;
            this._emit(
              ship.x,
              ship.y,
              Math.cos(heading) * PARTICLE_TRAIL_SPEED,
              Math.sin(heading) * PARTICLE_TRAIL_SPEED,
              PARTICLE_TRAIL_LIFETIME_MS,
              PARTICLE_TRAIL_SIZE,
              PARTICLE_TRAIL_COLOR,
            );
          }
        }
      } else {
        this._trailAccumMs = 0; // thrust released → trail ends cleanly
      }
    }
  }

  /**
   * Acquire a particle from the pool (reusing a freed slot before the factory
   * grows) and overwrite every field. Allocates nothing on the reuse path.
   * @private
   */
  _emit(x, y, vx, vy, lifeMs, size, color) {
    const p = this.pool.acquire();
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.ageMs = 0;
    p.lifeMs = lifeMs;
    p.size = size;
    p.color = color;
    return p;
  }
}
