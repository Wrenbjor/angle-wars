import { describe, it, expect } from 'vitest';
import { ParticleSystem } from './ParticleSystem.js';
import {
  FIXED_STEP_MS,
  PARTICLE_MAX,
  PARTICLE_BURST_COUNT,
  PARTICLE_BURST_SPEED_MIN,
  PARTICLE_BURST_SPEED_MAX,
  PARTICLE_BURST_LIFETIME_MS,
  PARTICLE_BURST_COLOR,
  PARTICLE_DRAG_RETAIN_PER_SEC,
  PARTICLE_THRUST_MIN_INTENT,
  PARTICLE_TRAIL_INTERVAL_MS,
  PARTICLE_TRAIL_SPEED,
  PARTICLE_TRAIL_COLOR,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// --- Phaser-free fakes -------------------------------------------------------

// CollisionSystem stand-in: this tick's bullet-kill count + the parallel coordinate
// snapshots the particle system reads. bulletKillX/Y may hold MORE entries than
// bulletKillCount (later systems append absorb/bomb removals); the system must read
// only the first bulletKillCount.
function fakeCollision(bulletKillCount = 0, xs = [], ys = []) {
  return { bulletKillCount, bulletKillX: xs, bulletKillY: ys };
}

function fakeShip(x = 0, y = 0, angle = 0) {
  return { x, y, angle };
}

function fakeInput(moveX = 0, moveY = 0) {
  return { moveX, moveY };
}

// Deterministic rng: constant value (headings/speeds reproducible).
function constRng(v = 0.5) {
  return () => v;
}

// Deterministic rng: cycles a fixed sequence.
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function activeParticles(system) {
  const out = [];
  system.pool.forEachActive((p) => out.push(p));
  return out;
}

// ---------------------------------------------------------------------------

describe('ParticleSystem — bullet-kill bursts', () => {
  it('emits PARTICLE_BURST_COUNT particles per bullet kill at each snapshot origin, age 0', () => {
    const cs = fakeCollision(2, [10, 30], [20, 40]);
    const system = new ParticleSystem(cs, fakeShip(), fakeInput(), constRng(0.5));

    system.fixedUpdate(DT);

    const active = activeParticles(system);
    expect(active.length).toBe(2 * PARTICLE_BURST_COUNT);
    // Half at each origin (rng is constant → no position change on the emit tick).
    expect(active.filter((p) => p.x === 10 && p.y === 20).length).toBe(
      PARTICLE_BURST_COUNT,
    );
    expect(active.filter((p) => p.x === 30 && p.y === 40).length).toBe(
      PARTICLE_BURST_COUNT,
    );
    // Fresh this tick: age 0 (emitted after the advance pass), burst lifetime/color.
    for (const p of active) {
      expect(p.ageMs).toBe(0);
      expect(p.lifeMs).toBe(PARTICLE_BURST_LIFETIME_MS);
      expect(p.color).toBe(PARTICLE_BURST_COLOR);
      // Speed within [MIN, MAX].
      const speed = Math.hypot(p.vx, p.vy);
      expect(speed).toBeGreaterThanOrEqual(PARTICLE_BURST_SPEED_MIN - 1e-9);
      expect(speed).toBeLessThanOrEqual(PARTICLE_BURST_SPEED_MAX + 1e-9);
    }
  });

  it('derives heading + speed from the injected rng', () => {
    // heading = rng()*2PI, speed = MIN + rng()*(MAX-MIN); two rng draws per particle.
    const cs = fakeCollision(1, [100], [200]);
    const rng = seqRng([0.25, 0.75]); // first particle: heading=0.25*2PI, speed at 0.75
    const system = new ParticleSystem(cs, fakeShip(), fakeInput(), rng);

    system.fixedUpdate(DT);

    const first = activeParticles(system)[0];
    const heading = 0.25 * Math.PI * 2;
    const speed =
      PARTICLE_BURST_SPEED_MIN + 0.75 * (PARTICLE_BURST_SPEED_MAX - PARTICLE_BURST_SPEED_MIN);
    expect(first.vx).toBeCloseTo(Math.cos(heading) * speed, 6);
    expect(first.vy).toBeCloseTo(Math.sin(heading) * speed, 6);
  });

  it('ignores absorb/bomb removals beyond bulletKillCount', () => {
    // 5 kill snapshots present, but only 2 are bullet kills — the rest were appended
    // by later systems (absorb/bomb) and must NOT burst.
    const cs = fakeCollision(2, [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    const system = new ParticleSystem(cs, fakeShip(), fakeInput(), constRng(0.5));

    system.fixedUpdate(DT);

    const active = activeParticles(system);
    expect(active.length).toBe(2 * PARTICLE_BURST_COUNT);
    // Only origins (1,1) and (2,2) appear; (3,3)/(4,4)/(5,5) emit nothing.
    expect(active.every((p) => p.x <= 2)).toBe(true);
    expect(active.some((p) => p.x === 3)).toBe(false);
  });

  it('emits nothing when bulletKillCount is 0', () => {
    const cs = fakeCollision(0, [9], [9]); // snapshot present but not a bullet kill
    const system = new ParticleSystem(cs, fakeShip(), fakeInput(), constRng(0.5));
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });
});

describe('ParticleSystem — advance / integrate / drag / expire', () => {
  it('ages and integrates position by the current velocity', () => {
    const system = new ParticleSystem(fakeCollision(), fakeShip(), fakeInput());
    const p = system.pool.acquire();
    p.x = 100;
    p.y = 200;
    p.vx = 50;
    p.vy = -30;
    p.ageMs = 0;
    p.lifeMs = 100000;

    system.fixedUpdate(DT);

    expect(p.ageMs).toBe(DT);
    // Position integrates with the ORIGINAL velocity (drag applied after).
    expect(p.x).toBeCloseTo(100 + 50 * (DT / 1000), 9);
    expect(p.y).toBeCloseTo(200 + -30 * (DT / 1000), 9);
  });

  it('decays velocity by exponential drag: v *= retain^(dt/1000)', () => {
    const system = new ParticleSystem(fakeCollision(), fakeShip(), fakeInput());
    const p = system.pool.acquire();
    p.x = 0;
    p.y = 0;
    p.vx = 200;
    p.vy = 120;
    p.ageMs = 0;
    p.lifeMs = 100000;

    system.fixedUpdate(DT);

    const factor = Math.pow(PARTICLE_DRAG_RETAIN_PER_SEC, DT / 1000);
    expect(p.vx).toBeCloseTo(200 * factor, 6);
    expect(p.vy).toBeCloseTo(120 * factor, 6);
  });

  it('expires a particle once ageMs reaches lifeMs, releasing the slot', () => {
    const system = new ParticleSystem(fakeCollision(), fakeShip(), fakeInput());
    const p = system.pool.acquire();
    p.ageMs = 0;
    p.lifeMs = DT; // one tick reaches the lifetime exactly
    expect(system.pool.activeCount).toBe(1);

    system.fixedUpdate(DT);

    expect(system.pool.activeCount).toBe(0);
    expect(system.pool.freeCount).toBe(1); // released back to the pool
  });
});

describe('ParticleSystem — soft cap (PARTICLE_MAX)', () => {
  it('emits no new particles when at the cap; activeCount stays <= PARTICLE_MAX', () => {
    const cs = fakeCollision(1, [0], [0]);
    const system = new ParticleSystem(cs, fakeShip(), fakeInput(), constRng(0.5));
    // Fill the pool to the cap with non-expiring particles.
    for (let i = 0; i < PARTICLE_MAX; i++) {
      const p = system.pool.acquire();
      p.ageMs = 0;
      p.lifeMs = Infinity;
    }
    expect(system.pool.activeCount).toBe(PARTICLE_MAX);

    system.fixedUpdate(DT); // a burst is due but the cap is reached

    expect(system.pool.activeCount).toBe(PARTICLE_MAX);
  });

  it('emits no trail particles when at the cap; activeCount stays <= PARTICLE_MAX', () => {
    // The trail path has the same cap guard as the burst path — pin it too. Sustained
    // thrust intent (1,0) crosses the trail interval, but the pool is already full.
    const system = new ParticleSystem(
      fakeCollision(),
      fakeShip(0, 0, 0),
      fakeInput(1, 0),
      constRng(0.5),
    );
    for (let i = 0; i < PARTICLE_MAX; i++) {
      const p = system.pool.acquire();
      p.ageMs = 0;
      p.lifeMs = Infinity;
    }
    expect(system.pool.activeCount).toBe(PARTICLE_MAX);

    // Enough accumulated time to cross the trail interval (a trail is due).
    system.fixedUpdate(PARTICLE_TRAIL_INTERVAL_MS + DT);

    expect(system.pool.activeCount).toBe(PARTICLE_MAX);
  });
});

describe('ParticleSystem — gameplay neutrality (read-only observer)', () => {
  it('mutates only its own pool — never the ship, input, or collision inputs', () => {
    // One tick that exercises BOTH read paths: a bullet kill (burst reads the
    // snapshots) AND thrust intent above threshold (trail reads ship + input).
    const ship = fakeShip(640, 360, 1.2);
    const input = fakeInput(1, 0);
    const cs = fakeCollision(1, [123], [456]);
    const system = new ParticleSystem(cs, ship, input, constRng(0.5));

    // Snapshot every observed input field before the tick.
    const shipBefore = { x: ship.x, y: ship.y, angle: ship.angle };
    const inputBefore = { moveX: input.moveX, moveY: input.moveY };
    const killCountBefore = cs.bulletKillCount;

    // Cross the trail interval so the trail path also runs this tick.
    system.fixedUpdate(PARTICLE_TRAIL_INTERVAL_MS + DT);

    // Every observed input field is unchanged — the system read, never wrote them.
    expect(ship.x).toBe(shipBefore.x);
    expect(ship.y).toBe(shipBefore.y);
    expect(ship.angle).toBe(shipBefore.angle);
    expect(input.moveX).toBe(inputBefore.moveX);
    expect(input.moveY).toBe(inputBefore.moveY);
    expect(cs.bulletKillCount).toBe(killCountBefore);

    // Only its own pool changed (both paths emitted this tick).
    expect(system.pool.activeCount).toBeGreaterThan(0);
  });
});

describe('ParticleSystem — thrust trail', () => {
  it('emits one trail particle at the ship, drifting opposite the ship facing, once an interval is crossed', () => {
    const ship = fakeShip(300, 300, 0); // facing +x → trail drifts toward -x
    const input = fakeInput(1, 0); // full thrust intent (>= threshold)
    const system = new ParticleSystem(fakeCollision(), ship, input, constRng(0.5));

    // constRng(0.5) → spread = (0.5*2 - 1)*SPREAD = 0, so heading is exactly opposite.
    // Tick 1: accum = DT (< interval) → no emit yet (throttle).
    system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);

    // Tick 2: accum = 2*DT (>= interval) → exactly one emit.
    system.fixedUpdate(DT);
    const active = activeParticles(system);
    expect(active.length).toBe(1);
    const t = active[0];
    expect(t.x).toBe(300);
    expect(t.y).toBe(300);
    expect(t.ageMs).toBe(0);
    expect(t.color).toBe(PARTICLE_TRAIL_COLOR);
    // Opposite ship.angle (0) → heading PI → velocity (-SPEED, 0).
    expect(t.vx).toBeCloseTo(-PARTICLE_TRAIL_SPEED, 6);
    expect(t.vy).toBeCloseTo(0, 6);
  });

  it('does not emit until a whole interval is accumulated', () => {
    // Choose a dt so a single tick is below the interval.
    const smallDt = PARTICLE_TRAIL_INTERVAL_MS / 3;
    const system = new ParticleSystem(
      fakeCollision(),
      fakeShip(0, 0, 0),
      fakeInput(1, 0),
      constRng(0.5),
    );
    system.fixedUpdate(smallDt);
    expect(system.pool.activeCount).toBe(0); // 1/3 interval → nothing yet
    system.fixedUpdate(smallDt);
    expect(system.pool.activeCount).toBe(0); // 2/3 interval → still nothing
    system.fixedUpdate(smallDt);
    expect(system.pool.activeCount).toBe(1); // whole interval crossed → one particle
  });

  it('stops immediately and resets the accumulator when thrust drops below the threshold', () => {
    const input = fakeInput(1, 0);
    const system = new ParticleSystem(
      fakeCollision(),
      fakeShip(0, 0, 0),
      input,
      constRng(0.5),
    );
    // Build up some (sub-interval) accumulated thrust.
    system.fixedUpdate(PARTICLE_TRAIL_INTERVAL_MS / 2);
    expect(system._trailAccumMs).toBeGreaterThan(0);

    // Drop below the intent threshold.
    input.moveX = 0;
    input.moveY = 0;
    system.fixedUpdate(DT);

    expect(system.pool.activeCount).toBe(0); // no trail while not thrusting
    expect(system._trailAccumMs).toBe(0); // accumulator reset cleanly
  });

  it('does not emit a trail when intent is below PARTICLE_THRUST_MIN_INTENT', () => {
    const belowIntent = PARTICLE_THRUST_MIN_INTENT / 2;
    const system = new ParticleSystem(
      fakeCollision(),
      fakeShip(0, 0, 0),
      fakeInput(belowIntent, 0),
      constRng(0.5),
    );
    // Even over many ticks, sub-threshold intent never emits.
    for (let i = 0; i < 20; i++) system.fixedUpdate(DT);
    expect(system.pool.activeCount).toBe(0);
  });
});

describe('ParticleSystem — zero-alloc reuse', () => {
  it('reuses a freed slot on the next emission before growing the pool', () => {
    const cs = fakeCollision(1, [0], [0]);
    const system = new ParticleSystem(cs, fakeShip(), fakeInput(), constRng(0.5));
    // A particle that expires on the coming tick.
    const p1 = system.pool.acquire();
    p1.ageMs = 0;
    p1.lifeMs = DT;
    p1.color = 0x000000;
    expect(system.pool.freeCount).toBe(0);

    // This tick: advance expires p1 (released), then the burst emits — the FIRST
    // acquire must reuse p1 rather than the factory allocating a fresh object.
    system.fixedUpdate(DT);

    // p1 is active again (reused) and carries the fresh burst fields.
    const active = activeParticles(system);
    expect(active).toContain(p1);
    expect(p1.color).toBe(PARTICLE_BURST_COLOR);
    expect(p1.ageMs).toBe(0);
    // Reuse consumed the single free slot before any growth (else freeCount === 1).
    expect(system.pool.freeCount).toBe(0);
  });
});
