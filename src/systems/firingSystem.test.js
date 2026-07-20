import { describe, it, expect } from 'vitest';
import { FiringSystem } from './FiringSystem.js';
import { InputState } from '../input/InputState.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  FIRE_INTERVAL_MS,
  BULLET_SPEED,
  BULLET_POOL_PREWARM,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Build a ship + input + firing-system triad. `aim` seeds the aim channel via
// setAim (normalized exactly as the real sampler would leave it).
function makeSystem({ ship: shipOverrides = {}, aim = null } = {}) {
  const ship = { ...createPlayerShip(), ...shipOverrides };
  const input = new InputState();
  if (aim) {
    input.setAim(aim[0], aim[1]);
  }
  const system = new FiringSystem(ship, input);
  return { ship, input, system };
}

// Materialize the active bullets into an array (tests only — the hot path never
// allocates like this).
function activeBullets(system) {
  const out = [];
  system.bulletPool.forEachActive((b) => out.push(b));
  return out;
}

describe('FiringSystem', () => {
  it('spawns one bullet on the first active tick (seeded accumulator)', () => {
    const { system } = makeSystem({ aim: [0, 1] });
    expect(system.bulletPool.activeCount).toBe(0);
    system.fixedUpdate(DT);
    expect(system.bulletPool.activeCount).toBe(1);
  });

  it('fires at a fixed cadence independent of tick size', () => {
    const T = 900; // ms of held aim

    // Count total spawns via an acquire spy — bullets despawn as they leave the
    // arena, so activeCount would undercount the shots actually fired.
    function countSpawns(system, tickMs, ticks) {
      let spawns = 0;
      const orig = system.bulletPool.acquire.bind(system.bulletPool);
      system.bulletPool.acquire = () => {
        spawns++;
        return orig();
      };
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return spawns;
    }

    // Fine ticks: DT-sized slices summing to exactly T.
    const fine = makeSystem({ aim: [1, 0] });
    const fineCount = countSpawns(fine.system, DT, Math.round(T / DT));

    // Coarse ticks: interval-sized slices summing to the same T.
    const coarse = makeSystem({ aim: [1, 0] });
    const coarseCount = countSpawns(
      coarse.system,
      FIRE_INTERVAL_MS,
      Math.round(T / FIRE_INTERVAL_MS),
    );

    // Both tick sizes fire the same number of shots.
    expect(fineCount).toBe(coarseCount);
    // ≈ floor(T / FIRE_INTERVAL_MS), ± the seeded first shot.
    const base = Math.floor(T / FIRE_INTERVAL_MS);
    expect(fineCount).toBeGreaterThanOrEqual(base);
    expect(fineCount).toBeLessThanOrEqual(base + 1);
  });

  it('bullet velocity comes only from aim, never the ship velocity (FR1)', () => {
    const { system } = makeSystem({
      ship: { vx: 999, vy: -777 },
      aim: [0, 1],
    });
    system.fixedUpdate(DT);
    const [b] = activeBullets(system);
    expect(b.vx).toBe(0);
    expect(b.vy).toBeCloseTo(BULLET_SPEED, 6);
  });

  it('spawns from the ship nose along the aim direction', () => {
    const ax = 0.6;
    const ay = 0.8; // already a unit vector
    const { ship, system } = makeSystem({
      ship: { x: 400, y: 300 },
      aim: [ax, ay],
    });
    system.fixedUpdate(DT);
    const [b] = activeBullets(system);
    // A bullet spawns after the integrate pass, so on its spawn tick it sits
    // exactly at the nose origin (x + ax*radius, y + ay*radius) — no travel yet.
    expect(b.x).toBeCloseTo(ship.x + ax * ship.radius, 6);
    expect(b.y).toBeCloseTo(ship.y + ay * ship.radius, 6);
  });

  it('spawns nothing while aim is inactive, but keeps in-flight bullets moving', () => {
    // Fire one bullet, then release aim.
    const { input, system } = makeSystem({ aim: [1, 0] });
    system.fixedUpdate(DT);
    expect(system.bulletPool.activeCount).toBe(1);
    const [b] = activeBullets(system);
    const xBefore = b.x;

    input.clearAim();
    system.fixedUpdate(DT);
    // No new spawn...
    expect(system.bulletPool.activeCount).toBe(1);
    // ...but the existing bullet still advanced.
    expect(b.x).toBeGreaterThan(xBefore);
    expect(b.x).toBeCloseTo(xBefore + BULLET_SPEED * (DT / 1000), 6);
  });

  it('integrates bullet position by v*dtSec each tick, count unchanged pre-boundary', () => {
    const { input, system } = makeSystem({
      ship: { x: 200, y: 360 },
      aim: [1, 0],
    });
    system.fixedUpdate(DT); // spawn
    input.clearAim();
    const [b] = activeBullets(system);
    const dtSec = DT / 1000;
    const start = b.x;
    system.fixedUpdate(DT);
    system.fixedUpdate(DT);
    expect(b.x).toBeCloseTo(start + 2 * BULLET_SPEED * dtSec, 6);
    expect(system.bulletPool.activeCount).toBe(1);
  });

  it('despawns a bullet back to the pool when its center crosses the border', () => {
    // Ship hugging the right interior wall, aiming right: the bullet leaves the
    // arena within a few ticks.
    const nearRight = ARENA_WIDTH - ARENA_BORDER_INSET - 1;
    const { input, system } = makeSystem({
      ship: { x: nearRight, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
    });
    system.fixedUpdate(DT); // spawn (already just past the inset via nose offset + travel)
    input.clearAim(); // isolate: no further spawns

    // Advance until it despawns.
    let guard = 0;
    while (system.bulletPool.activeCount > 0 && guard < 100) {
      system.fixedUpdate(DT);
      guard++;
    }
    expect(system.bulletPool.activeCount).toBe(0);
    expect(system.bulletPool.freeCount).toBeGreaterThan(0);
  });

  it('never grows the pool past the prewarm under sustained fire (NFR2)', () => {
    // At construction the pool is fully prewarmed and nothing is checked out.
    const { system } = makeSystem({
      ship: { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
    });
    expect(system.bulletPool.freeCount).toBe(BULLET_POOL_PREWARM);
    expect(system.bulletPool.activeCount).toBe(0);

    // Hold aim active for a sustained run. Ship centered so bullets leave the
    // arena and despawn, keeping peak in-flight well under the prewarm. If total
    // capacity ever exceeded the prewarm, the factory ran — i.e. the steady
    // state allocated. Assert it never does, on every tick.
    for (let i = 0; i < 400; i++) {
      system.fixedUpdate(DT);
      expect(
        system.bulletPool.activeCount + system.bulletPool.freeCount,
      ).toBeLessThanOrEqual(BULLET_POOL_PREWARM);
    }
  });

  // --- Story 4.5: read-only shotsFiredCount latch (the fire-event source) -----
  it('shotsFiredCount tracks the bullets spawned this tick (1 per fire interval)', () => {
    const { system } = makeSystem({ aim: [0, 1] });
    // Fresh system reports 0 before any tick.
    expect(system.shotsFiredCount).toBe(0);
    // First active tick fires exactly one bullet (seeded accumulator).
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(1);
  });

  it('shotsFiredCount resets to 0 each tick (per-tick latch, not cumulative)', () => {
    const { input, system } = makeSystem({ aim: [0, 1] });
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(1);
    // A tick with no new spawn (aim released) reports 0, not the prior 1.
    input.clearAim();
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(0);
  });

  it('shotsFiredCount is 0 on a tick that spawns nothing (aim inactive)', () => {
    const { system } = makeSystem(); // no aim
    system.fixedUpdate(DT);
    expect(system.shotsFiredCount).toBe(0);
  });

  it('shotsFiredCount counts every bullet in a multi-spawn (coarse) tick', () => {
    // A tick larger than several fire intervals banks multiple spawns in one step.
    const { system } = makeSystem({ aim: [1, 0] });
    system.fixedUpdate(FIRE_INTERVAL_MS * 3);
    // Seeded accumulator + 3 intervals of banked time → the count matches the
    // bullets actually spawned this tick (never a stale value).
    expect(system.shotsFiredCount).toBe(system.bulletPool.activeCount);
    expect(system.shotsFiredCount).toBeGreaterThan(1);
  });

  it('recycles a freed bullet on the next spawn (no pool growth)', () => {
    const nearRight = ARENA_WIDTH - ARENA_BORDER_INSET - 1;
    const { ship, input, system } = makeSystem({
      ship: { x: nearRight, y: ARENA_HEIGHT / 2 },
      aim: [1, 0],
    });
    const totalBefore = system.bulletPool.activeCount + system.bulletPool.freeCount;

    // Fire + fly a bullet out of the arena.
    system.fixedUpdate(DT);
    input.clearAim();
    let guard = 0;
    while (system.bulletPool.activeCount > 0 && guard < 100) {
      system.fixedUpdate(DT);
      guard++;
    }
    const freeAfterDespawn = system.bulletPool.freeCount;
    expect(freeAfterDespawn).toBeGreaterThan(0);

    // Re-aim into the arena interior and spawn again: free drops, active rises,
    // and the pool did not grow.
    ship.x = ARENA_WIDTH / 2;
    input.setAim(0, 1);
    system.fixedUpdate(DT);
    expect(system.bulletPool.activeCount).toBe(1);
    expect(system.bulletPool.freeCount).toBe(freeAfterDespawn - 1);
    const totalAfter = system.bulletPool.activeCount + system.bulletPool.freeCount;
    expect(totalAfter).toBe(totalBefore);
  });
});
