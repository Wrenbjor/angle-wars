import { describe, it, expect } from 'vitest';
import { GridFieldSystem } from './GridFieldSystem.js';
import {
  FIXED_STEP_MS,
  GRID_MAX_RIPPLES,
  GRID_RIPPLE_DURATION_MS,
  BLACKHOLE_MAX_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// --- Phaser-free fakes for the four sources the system reads -----------------

// CollisionSystem stand-in: the shared kill report + this tick's bullet-kill count
// + the parallel coordinate snapshots the grid actually reads. bulletKillX/Y are
// derived from the killed list's coords up to bulletKillCount (mirroring the real
// system, which snapshots kill coordinates at kill time so a later pool-recycle of
// the enemy object can't corrupt the origin).
function fakeCollision(killedEnemies = [], bulletKillCount = 0) {
  const bulletKillX = [];
  const bulletKillY = [];
  for (let i = 0; i < bulletKillCount; i++) {
    bulletKillX.push(killedEnemies[i].x);
    bulletKillY.push(killedEnemies[i].y);
  }
  return { killedEnemies, bulletKillCount, bulletKillX, bulletKillY };
}

// BombSystem stand-in: the shockwave latch (rising edge = detonation).
function fakeBomb(shockwaveMs = 0, shockwaveX = 0, shockwaveY = 0) {
  return { shockwaveMs, shockwaveX, shockwaveY };
}

// PlayerDeathSystem stand-in: the death latch.
function fakeDeath(deathSeq = 0, deathX = 0, deathY = 0) {
  return { deathSeq, deathX, deathY };
}

// holePool stand-in: forEachActive over a plain list of holes.
function fakeHolePool(holes = []) {
  return {
    holes,
    forEachActive(fn) {
      for (const h of this.holes) fn(h);
    },
  };
}

function hole(x, y, radius, telegraphMs = 0) {
  return { x, y, radius, telegraphMs };
}

function activeRipples(system) {
  return system.ripples.filter((r) => r.active);
}

describe('GridFieldSystem — explosion (bullet-kill) ripples', () => {
  it('emits one ripple per bullet kill at each kill origin, age 0', () => {
    const cs = fakeCollision(
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
      2,
    );
    const system = new GridFieldSystem(cs, fakeBomb(), fakeDeath(), fakeHolePool());

    system.fixedUpdate(DT);

    const active = activeRipples(system);
    expect(active.length).toBe(2);
    // Fresh ripples this tick are at age 0 (they are emitted after the advance pass).
    for (const r of active) expect(r.ageMs).toBe(0);
    // Origins match the kill points.
    const origins = active.map((r) => `${r.x},${r.y}`).sort();
    expect(origins).toEqual(['10,20', '30,40']);
  });

  it('ignores absorb/bomb-cleared appends beyond bulletKillCount', () => {
    // 2 bullet kills, then 3 more entries appended (indices 2..4) by later systems.
    const killed = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 }, // absorbed / bomb-cleared — NOT an explosion
      { x: 4, y: 4 },
      { x: 5, y: 5 },
    ];
    const cs = fakeCollision(killed, 2);
    const system = new GridFieldSystem(cs, fakeBomb(), fakeDeath(), fakeHolePool());

    system.fixedUpdate(DT);

    const active = activeRipples(system);
    expect(active.length).toBe(2);
    const origins = active.map((r) => `${r.x},${r.y}`).sort();
    expect(origins).toEqual(['1,1', '2,2']);
  });

  it('emits no explosion ripples when bulletKillCount is 0', () => {
    const cs = fakeCollision([{ x: 9, y: 9 }], 0); // present but not bullet kills
    const system = new GridFieldSystem(cs, fakeBomb(), fakeDeath(), fakeHolePool());

    system.fixedUpdate(DT);

    expect(activeRipples(system).length).toBe(0);
  });

  it('uses the latched coordinate snapshots, not the (recyclable) killedEnemies objects', () => {
    // A bullet kill at (250,175). The enemy object is released to its pool this tick
    // and a later same-tick system re-acquires it and overwrites x/y to a spawn edge.
    // The grid must ripple at the LATCHED kill point, not the recycled position.
    const killed = [{ x: 250, y: 175 }];
    const cs = fakeCollision(killed, 1); // snapshots capture (250,175)
    const system = new GridFieldSystem(cs, fakeBomb(), fakeDeath(), fakeHolePool());

    // Simulate the recycle: the killedEnemies object is mutated after the count/latch.
    killed[0].x = 12;
    killed[0].y = 9999;

    system.fixedUpdate(DT);

    const active = activeRipples(system);
    expect(active.length).toBe(1);
    expect(active[0].x).toBe(250); // latched kill point, not the recycled 12
    expect(active[0].y).toBe(175); // latched kill point, not the recycled 9999
  });
});

describe('GridFieldSystem — bomb ripple (rising edge)', () => {
  it('emits exactly one ripple at the detonation origin on the rising edge', () => {
    const bomb = fakeBomb(0, 500, 300);
    const system = new GridFieldSystem(
      fakeCollision(),
      bomb,
      fakeDeath(),
      fakeHolePool(),
    );

    // Detonation: shockwaveMs rises 0 -> N with origin (500,300).
    bomb.shockwaveMs = 300;
    system.fixedUpdate(DT);

    let active = activeRipples(system);
    expect(active.length).toBe(1);
    expect(active[0].x).toBe(500);
    expect(active[0].y).toBe(300);

    // As it decays, no second ripple fires.
    bomb.shockwaveMs = 240;
    system.fixedUpdate(DT);
    active = activeRipples(system);
    expect(active.length).toBe(1); // still just the one (now aged)
  });

  it('does not fire on the first tick from a pre-seeded shockwave (prev seeded)', () => {
    // Constructed while a shockwave is already mid-decay — prev is seeded from it, so
    // no spurious ripple; only a genuine later rising edge emits.
    const bomb = fakeBomb(200, 100, 100);
    const system = new GridFieldSystem(
      fakeCollision(),
      bomb,
      fakeDeath(),
      fakeHolePool(),
    );

    bomb.shockwaveMs = 160; // continued decay, not a rise
    system.fixedUpdate(DT);
    expect(activeRipples(system).length).toBe(0);
  });
});

describe('GridFieldSystem — death ripple (deathSeq edge)', () => {
  it('emits one ripple at the death point per deathSeq increment', () => {
    const death = fakeDeath(0, 0, 0);
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      death,
      fakeHolePool(),
    );

    death.deathSeq = 1;
    death.deathX = 640;
    death.deathY = 360;
    system.fixedUpdate(DT);

    const active = activeRipples(system);
    expect(active.length).toBe(1);
    expect(active[0].x).toBe(640);
    expect(active[0].y).toBe(360);

    // No new death → no new ripple.
    system.fixedUpdate(DT);
    expect(activeRipples(system).length).toBe(1);

    // Another death → another ripple.
    death.deathSeq = 2;
    death.deathX = 100;
    death.deathY = 200;
    system.fixedUpdate(DT);
    expect(activeRipples(system).length).toBe(2);
  });

  it('does not fire on the first tick from a pre-seeded deathSeq', () => {
    const death = fakeDeath(5, 10, 10); // run mid-flight
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      death,
      fakeHolePool(),
    );

    system.fixedUpdate(DT); // deathSeq unchanged → no ripple
    expect(activeRipples(system).length).toBe(0);
  });
});

describe('GridFieldSystem — ripple advance + expire', () => {
  it('advances an active ripple by dt and expires it at the lifetime', () => {
    const cs = fakeCollision([{ x: 50, y: 50 }], 1);
    const system = new GridFieldSystem(cs, fakeBomb(), fakeDeath(), fakeHolePool());

    // Tick 1: emit the ripple (age 0 after emission this tick).
    system.fixedUpdate(DT);
    expect(activeRipples(system).length).toBe(1);
    expect(activeRipples(system)[0].ageMs).toBe(0);

    // Stop emitting; subsequent ticks only advance it.
    cs.bulletKillCount = 0;
    system.fixedUpdate(DT);
    expect(activeRipples(system)[0].ageMs).toBeCloseTo(DT, 9);

    // Run until just past the lifetime — the slot goes inactive.
    let guard = 0;
    while (activeRipples(system).length > 0 && guard < 10000) {
      system.fixedUpdate(DT);
      guard += 1;
    }
    expect(activeRipples(system).length).toBe(0);
    // Expired at/after the configured duration.
    expect(guard * DT).toBeGreaterThanOrEqual(GRID_RIPPLE_DURATION_MS - DT);
  });
});

describe('GridFieldSystem — ripple overflow', () => {
  it('overwrites the oldest slot when all are active; count stays <= cap', () => {
    // Emit GRID_MAX_RIPPLES ripples across successive ticks so they have DISTINCT
    // ages, then one more — the oldest (largest ageMs) must be recycled. Each tick
    // the grid reads the current bulletKillX/Y snapshot (one bullet kill per tick).
    const cs = fakeCollision([{ x: 0, y: 0 }], 1);
    const system = new GridFieldSystem(cs, fakeBomb(), fakeDeath(), fakeHolePool());

    // Fill every slot, one per tick, each at a unique origin so we can track them.
    for (let i = 0; i < GRID_MAX_RIPPLES; i++) {
      cs.bulletKillX[0] = i; // distinct origin per emission
      cs.bulletKillY[0] = i;
      system.fixedUpdate(DT);
    }
    expect(activeRipples(system).length).toBe(GRID_MAX_RIPPLES);
    // The oldest ripple is the first emitted (origin 0,0) — it has the largest age.
    expect(system.ripples.some((r) => r.x === 0 && r.y === 0)).toBe(true);

    // One more emission with all slots active → recycle the OLDEST (origin 0,0).
    cs.bulletKillX[0] = 999;
    cs.bulletKillY[0] = 999;
    system.fixedUpdate(DT);

    // Count never exceeds the cap (an overwrite, not a growth).
    expect(activeRipples(system).length).toBe(GRID_MAX_RIPPLES);
    expect(system.ripples.length).toBe(GRID_MAX_RIPPLES);
    // The newest ripple (999,999) exists at age 0...
    const newest = system.ripples.find((r) => r.x === 999 && r.y === 999);
    expect(newest).toBeTruthy();
    expect(newest.ageMs).toBe(0);
    // ...and the previously-oldest ripple (origin 0,0) was the one recycled away.
    expect(system.ripples.some((r) => r.x === 0 && r.y === 0)).toBe(false);
  });
});

describe('GridFieldSystem — warp tracking', () => {
  it('warps toward an alive non-telegraphing hole; strength = radius/MAX clamped', () => {
    const r = 35;
    const pool = fakeHolePool([hole(700, 400, r, 0)]);
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      fakeDeath(),
      pool,
    );

    system.fixedUpdate(DT);

    expect(system.warp.active).toBe(true);
    expect(system.warp.x).toBe(700);
    expect(system.warp.y).toBe(400);
    expect(system.warp.strength).toBeCloseTo(r / BLACKHOLE_MAX_RADIUS, 9);
  });

  it('clamps strength to 1 for a radius at/above BLACKHOLE_MAX_RADIUS', () => {
    const pool = fakeHolePool([hole(0, 0, BLACKHOLE_MAX_RADIUS, 0)]);
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      fakeDeath(),
      pool,
    );

    system.fixedUpdate(DT);
    expect(system.warp.strength).toBe(1);
  });

  it('releases (strength 0) while the only hole is still telegraphing', () => {
    const pool = fakeHolePool([hole(100, 100, 40, 250)]); // telegraphMs > 0
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      fakeDeath(),
      pool,
    );

    system.fixedUpdate(DT);
    expect(system.warp.active).toBe(false);
    expect(system.warp.strength).toBe(0);
  });

  it('releases (strength 0) when the hole pool is empty', () => {
    const pool = fakeHolePool([]);
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      fakeDeath(),
      pool,
    );

    // Start with a hole so warp activates, then remove it.
    pool.holes = [hole(50, 50, 40, 0)];
    system.fixedUpdate(DT);
    expect(system.warp.active).toBe(true);

    pool.holes = [];
    system.fixedUpdate(DT);
    expect(system.warp.active).toBe(false);
    expect(system.warp.strength).toBe(0);
  });

  it('targets the largest-radius hole when more than one is alive', () => {
    const pool = fakeHolePool([hole(10, 10, 30, 0), hole(90, 90, 60, 0)]);
    const system = new GridFieldSystem(
      fakeCollision(),
      fakeBomb(),
      fakeDeath(),
      pool,
    );

    system.fixedUpdate(DT);
    expect(system.warp.x).toBe(90);
    expect(system.warp.y).toBe(90);
    expect(system.warp.strength).toBeCloseTo(60 / BLACKHOLE_MAX_RADIUS, 9);
  });
});

describe('GridFieldSystem — construction seeds edge-detection prevs', () => {
  it('fires no ripple on the very first tick when nothing changed', () => {
    const system = new GridFieldSystem(
      fakeCollision([], 0),
      fakeBomb(0, 0, 0),
      fakeDeath(0, 0, 0),
      fakeHolePool(),
    );
    system.fixedUpdate(DT);
    expect(activeRipples(system).length).toBe(0);
    expect(system.warp.active).toBe(false);
  });
});
