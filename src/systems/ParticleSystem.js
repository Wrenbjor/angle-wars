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
  PARTICLE_DASH_TRAIL_INTERVAL_MS,
  PARTICLE_DASH_TRAIL_LIFETIME_MS,
  PARTICLE_DASH_TRAIL_SPEED,
  PARTICLE_DASH_TRAIL_SPREAD_RAD,
  PARTICLE_DASH_TRAIL_SIZE,
  PARTICLE_DASH_TRAIL_COLOR,
} from '../config/constants.js';

const TAU = Math.PI * 2;

// ParticleSystem — the Phaser-free simulation seam for pooled visual particles
// (Story 4.3): the signature "everything sprays sparks" juice (FR12, NFR2).
//
// Runs LAST in the world pipeline (registered after HighScoreSystem /
// GridFieldSystem), so within each fixed tick every input it reads is already
// final: collisionSystem.bulletKillCount (this tick's PLAYER-DAMAGE kills only —
// bullets, then the Story 10.5 dash sweep, both through applyPlayerDamage — before
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
//   2. emits a BURST of PARTICLE_BURST_COUNT particles per PLAYER-DAMAGE-killed enemy
//      at that kill's snapshot origin (bullet and dash kills ONLY — an absorb is not an
//      explosion and the bomb owns its own effect, exactly like the grid ripple),
//   3. emits a throttled thrust TRAIL: one particle per PARTICLE_TRAIL_INTERVAL_MS
//      of accumulated thrust time, drifting opposite the ship facing,
//   4. emits the Afterburner Lv5 BURNING DASH TRAIL (Story 10.5) on the same throttled
//      pattern, gated on DashSystem.trailActive() and streaming opposite the dash
//      direction. Cosmetic only — it damages nothing and leaves no zone.
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
   *   of this tick's PLAYER-DAMAGE kill coordinate snapshots: bulletKillX/Y[0 ..
   *   bulletKillCount) — bullets and the Story 10.5 dash sweep (recycle-proof,
   *   unlike the killedEnemies objects).
   * @param {{x:number,y:number,angle:number}} ship The player ship — read for the
   *   trail origin (post-move position) and facing. Observed, never mutated.
   * @param {{moveX:number,moveY:number}} inputState The shared move intent — read
   *   for the thrust gate. Observed, never mutated.
   * @param {() => number} [rng] Uniform [0,1) source (injected for deterministic
   *   tests). Defaults to Math.random.
   * @param {number} [maxParticles] Hard cap on simultaneously-live particles.
   *   Defaults to the desktop PARTICLE_MAX; ArenaScene injects the (smaller) mobile
   *   cap from the resolved quality profile (Story 7.4) so a phone GPU renders fewer
   *   particles. Byte-identical to today when omitted.
   * @param {import('./DashSystem.js').DashSystem|null} [dashSystem] The Afterburner dash
   *   runtime (Story 10.5). Read ONLY through `trailActive()` for the Lv5 burning trail
   *   and for the dash direction. Optional (slot 6) so every existing caller and test
   *   stub is unchanged; omitted means no dash trail ever.
   */
  constructor(
    collisionSystem,
    ship,
    inputState,
    rng = Math.random,
    maxParticles = PARTICLE_MAX,
    dashSystem = null,
  ) {
    super();
    this.collisionSystem = collisionSystem;
    this.ship = ship;
    this.inputState = inputState;
    this.rng = rng;
    // The live-particle soft cap this system enforces on both emission paths. A
    // frozen-profile value injected once at construction — never mutated per frame.
    // Guard the placeholder footgun (mirrors the `step > 0` trail guard below and
    // buildArenaWorld's rng coercion): the `= PARTICLE_MAX` default only catches
    // `undefined`, so an injected 0 (suppresses ALL emission), NaN, or negative falls
    // back to the desktop cap rather than silently breaking the particle system.
    this.maxParticles =
      Number.isFinite(maxParticles) && maxParticles > 0
        ? maxParticles
        : PARTICLE_MAX;

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

    // Story 10.5: the Afterburner dash runtime, and the Lv5 burning-trail throttle
    // accumulator (ms). Structurally identical to `_trailAccumMs` above — it rises by
    // dt while the dash is trailing and sheds one interval per emitted particle, and
    // resets to 0 the instant the dash is not trailing so the burn ends cleanly.
    this.dashSystem = dashSystem;
    this._dashTrailAccumMs = 0;
  }

  /**
   * Advance one fixed step: age/expire live particles, emit this tick's player-damage
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
    //     bulletKillX/Y[0 .. bulletKillCount) — bullets, then the Story 10.5 dash
    //     sweep. The count already excludes
    //     absorb/bomb-cleared removals (appended after the latch), so only genuine
    //     bullet explosions spray. The cap is honored per particle.
    const cs = this.collisionSystem;
    if (cs) {
      const n = cs.bulletKillCount;
      for (let k = 0; k < n; k++) {
        const x = cs.bulletKillX[k];
        const y = cs.bulletKillY[k];
        for (let c = 0; c < PARTICLE_BURST_COUNT; c++) {
          if (this.pool.activeCount >= this.maxParticles) break; // soft cap reached
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
            if (this.pool.activeCount >= this.maxParticles) continue; // capped: still drain
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

    // (4) Afterburner Lv5 BURNING DASH TRAIL (Story 10.5) — structurally identical to
    //     section (3): accumulate, guard a strictly-positive step, drain-while emitting
    //     one particle per interval, honour the cap by CONTINUING (so the accumulator
    //     still drains and a capped frame does not bank a burst for later), and reset
    //     the accumulator the instant the dash stops trailing.
    //
    //     The gate is `trailActive()`, which reads DashSystem's PUBLISHED
    //     `movementActive`, so the trail is laid on exactly the ticks the ship actually
    //     travelled — not one step early or one step late.
    //
    //     COSMETIC ONLY: this emits particles and nothing else. It deals no damage and
    //     leaves no lingering zone (a damaging ground trail would be the pooled-entity
    //     system Epic 11's Mine Layer owns).
    const dash = this.dashSystem;
    if (dash && ship) {
      if (dash.trailActive()) {
        this._dashTrailAccumMs += dt;
        const dashStep = PARTICLE_DASH_TRAIL_INTERVAL_MS;
        if (dashStep > 0) {
          while (this._dashTrailAccumMs >= dashStep) {
            this._dashTrailAccumMs -= dashStep;
            if (this.pool.activeCount >= this.maxParticles) continue; // capped: still drain
            // Stream OPPOSITE the dash direction, jittered by the spread. The dash
            // direction is the authoritative source (the ship's facing agrees during a
            // dash, but the direction is what the burst is actually travelling along).
            const spread =
              (this.rng() * 2 - 1) * PARTICLE_DASH_TRAIL_SPREAD_RAD;
            const heading = Math.atan2(-dash.dirY, -dash.dirX) + spread;
            this._emit(
              ship.x,
              ship.y,
              Math.cos(heading) * PARTICLE_DASH_TRAIL_SPEED,
              Math.sin(heading) * PARTICLE_DASH_TRAIL_SPEED,
              PARTICLE_DASH_TRAIL_LIFETIME_MS,
              PARTICLE_DASH_TRAIL_SIZE,
              PARTICLE_DASH_TRAIL_COLOR,
            );
          }
        }
      } else {
        this._dashTrailAccumMs = 0; // dash ended → burn ends cleanly
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
