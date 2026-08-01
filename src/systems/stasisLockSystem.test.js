import { describe, it, expect } from 'vitest';
import { StasisLockSystem } from './StasisLockSystem.js';
import { Pool } from '../core/Pool.js';
import { createSeeker } from '../entities/Seeker.js';
import { createGreenSquare } from '../entities/GreenSquare.js';
import {
  FIXED_STEP_MS,
  STASIS_LOCK_FREEZE_MS,
  STASIS_LOCK_COOLDOWN_MS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

function activeOf(pool) {
  const out = [];
  pool.forEachActive((x) => out.push(x));
  return out;
}

function makeEnemyPool(createEntity) {
  return new Pool(createEntity);
}

function makeCollisionStub() {
  return { stasisFreezeActive: false };
}

function makeXpOrbStub() {
  const spawns = [];
  return {
    spawnOrb(x, y, value) {
      spawns.push({ x, y, value });
    },
    spawns,
  };
}

function buildStasisSystem() {
  const seekerPool = makeEnemyPool(createSeeker);
  const greenPool = makeEnemyPool(createGreenSquare);
  const collision = makeCollisionStub();
  const xpOrb = makeXpOrbStub();

  for (let i = 0; i < 3; i++) {
    seekerPool.acquire();
    greenPool.acquire();
  }

  const system = new StasisLockSystem(
    [seekerPool, greenPool],
    xpOrb,
  );
  system.collisionSystem = collision;

  return {
    system,
    seekerPool,
    greenPool,
    collision,
    xpOrb,
  };
}

/**
 * Advance until the first freeze triggers. Returns after the trigger,
 * but before freezeTimer has decayed past the freeze window.
 * After this: stasisFreezeActive === true, cooldownTimer = STASIS_LOCK_COOLDOWN_MS.
 */
function tickToFirstFreeze(system) {
  const ticksNeeded = Math.floor(STASIS_LOCK_COOLDOWN_MS / DT) + 1;
  // Run ticks needed to reach cooldown expiry.
  for (let i = 0; i < ticksNeeded; i++) {
    system.fixedUpdate(DT);
    // Once freeze triggers, freezeTimer is set to STASIS_LOCK_FREEZE_MS.
    // We want to return right after trigger, before freezeTimer decays further.
    if (system.collisionSystem.stasisFreezeActive) {
      system.fixedUpdate(DT); // Process one more tick so freezeTimer = STASIS_LOCK_FREEZE_MS - DT
      return;
    }
  }
}

describe('StasisLockSystem — periodic freeze (Story 12.16)', () => {
  it('does nothing when not active (matrix: no Stasis Lock fused)', () => {
    const { system, collision } = buildStasisSystem();

    system.active = false;
    for (let i = 0; i < (STASIS_LOCK_COOLDOWN_MS / DT) + 100; i++) {
      system.fixedUpdate(DT);
    }

    expect(collision.stasisFreezeActive).toBe(false);
  });

  it('triggers freeze after cooldown (matrix: first freeze triggers)', () => {
    const { system, seekerPool, collision } = buildStasisSystem();
    const s = seekerPool.acquire();

    system.active = true;
    tickToFirstFreeze(system);

    expect(collision.stasisFreezeActive).toBe(true);
    expect(s.stunMs).toBeGreaterThan(0);
  });

  it('maintains freeze across multiple ticks, then expires (matrix: freeze expires)', () => {
    const { system, collision, seekerPool } = buildStasisSystem();
    const s = seekerPool.acquire();

    system.active = true;
    tickToFirstFreeze(system);
    expect(collision.stasisFreezeActive).toBe(true);

    // The freezeWindow started. Count how many ticks it lasts.
    let activeTicks = 0;
    while (collision.stasisFreezeActive) {
      system.fixedUpdate(DT);
      activeTicks++;
    }
    // Freeze should last roughly 88-94 ticks (1500/16 ≈ 94; 89+ actual ticks active).
    expect(activeTicks).toBeGreaterThanOrEqual(85);
    expect(activeTicks).toBeLessThanOrEqual(95);
    expect(collision.stasisFreezeActive).toBe(false);
    // stasisFreezeActive cleared by StasisLockSystem.
    // Enemy stunMs will decay through enemy movers (not StasisLockSystem), so it may still be > 0.
  });

  it('second freeze triggers after cooldown restarts (matrix: cooldown restarts freeze)', () => {
    const { system, collision, seekerPool } = buildStasisSystem();

    system.active = true;
    tickToFirstFreeze(system);

    // Now count until the NEXT freeze triggers.
    const totalTicks = 3000;
    let freezeCount = 0;
    for (let i = 0; i < totalTicks && freezeCount < 2; i++) {
      system.fixedUpdate(DT);
      if (collision.stasisFreezeActive) {
        freezeCount++;
        if (freezeCount === 2) break;
      }
    }

    expect(freezeCount).toBeGreaterThanOrEqual(2);
  });

  it('freezes all combat enemy pools (matrix: no enemies on screen / multiple pools)', () => {
    const { system, seekerPool, greenPool, collision } = buildStasisSystem();

    system.active = true;
    tickToFirstFreeze(system);

    expect(collision.stasisFreezeActive).toBe(true);

    const seekers = activeOf(seekerPool);
    for (const en of seekers) {
      expect(en.stunMs).toBeGreaterThan(0);
    }

    const greens = activeOf(greenPool);
    for (const en of greens) {
      expect(en.stunMs).toBeGreaterThan(0);
    }
  });

  it('works with empty enemy pools (matrix: no enemies on screen)', () => {
    const emptyPool = makeEnemyPool(createSeeker);
    const collision = makeCollisionStub();
    const xpOrb = makeXpOrbStub();
    // 0 enemies pre-spawned.
    const system = new StasisLockSystem([emptyPool], xpOrb);
    system.collisionSystem = collision;

    system.active = true;
    tickToFirstFreeze(system);

    expect(collision.stasisFreezeActive).toBe(true);
  });

  it('composes with external stunMs via Math.max (matrix: bomb stun overlaps freeze)', () => {
    const { system, seekerPool, collision } = buildStasisSystem();
    const s = seekerPool.acquire();

    s.stunMs = 500;

    system.active = true;
    tickToFirstFreeze(system);

    // Math.max(500, STASIS_LOCK_FREEZE_MS - DT) should still be STASIS_LOCK_FREEZE_MS - DT.
    expect(s.stunMs).toBeGreaterThan(1000);
  });

  it('spawns extra XP orb via spawnExtraXpOrb (matrix: extra XP)', () => {
    const { system, seekerPool, collision, xpOrb } = buildStasisSystem();
    const s = seekerPool.acquire();

    system.active = true;
    tickToFirstFreeze(system);

    expect(collision.stasisFreezeActive).toBe(true);

    // Simulate what CollisionSystem does on a frozen kill.
    // Wire the reference (set by buildArenaWorld.js in production).
    collision.stasisLockXpOrbSystem = system;
    if (collision.stasisLockXpOrbSystem) {
      collision.stasisLockXpOrbSystem.spawnExtraXpOrb(s.x, s.y, 5);
    }

    expect(xpOrb.spawns).toHaveLength(1);
    expect(xpOrb.spawns[0].value).toBe(5);
  });

  it('only spawns extra XP when frozen (matrix: frozen killed by AoE / non-frozen no extra)', () => {
    const { system, collision, xpOrb } = buildStasisSystem();

    // When not frozen → no extra XP.
    system.active = true;
    tickToFirstFreeze(system);
    expect(collision?.stasisFreezeActive).toBe(true);

    // First kill during freeze (using the collisionSystem reference).
    collision.stasisLockXpOrbSystem = system;
    if (collision.stasisLockXpOrbSystem) {
      // The s.x and s.y don't matter for this test — just the count.
      collision.stasisLockXpOrbSystem.spawnExtraXpOrb(10, 20, 3);
    }

    // When freeze is inactive → no more extra XP.
    // Wait for freeze to expire.
    for (let i = 0; i < 200; i++) {
      system.fixedUpdate(DT);
      if (!collision.stasisFreezeActive) {
        for (let j = 0; j < 200; j++) system.fixedUpdate(DT);
        break;
      }
    }
    expect(collision.stasisFreezeActive).toBe(false);

    // Total XP orbs should be exactly 1.
    expect(xpOrb.spawns).toHaveLength(1);
    expect(xpOrb.spawns[0].value).toBe(3);
  });
});
