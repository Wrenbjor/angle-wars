import { describe, it, expect } from 'vitest';
import { XpOrbSystem } from './XpOrbSystem.js';
import {
  FIXED_STEP_MS,
  XP_ORB_MAX,
  XP_ORB_RADIUS,
  XP_PICKUP_RADIUS,
  XP_ORB_DRIFT_SPEED,
  XP_MULTIPLIER_DIVISOR,
  BLACKHOLE_DEFUSED_XP,
  MIRROR_CENTER_KILL_XP,
  SHIP_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// --- Phaser-free stubs -------------------------------------------------------

// CollisionSystem stand-in: this tick's bullet-kill count + the parallel coordinate
// AND xp snapshots the orb system reads. The arrays may hold MORE entries than
// bulletKillCount (later systems append absorb/bomb removals); the system must read
// only the first bulletKillCount.
function fakeCollision(bulletKillCount = 0, xs = [], ys = [], xps = []) {
  return {
    bulletKillCount,
    bulletKillX: xs,
    bulletKillY: ys,
    bulletKillXp: xps,
  };
}

// BlackHoleSystem stand-in: this tick's defuse (safe-implosion) report.
function fakeBlackHole(defusedX = [], defusedY = []) {
  return { defusedX, defusedY };
}

// MirrorReflectorSystem stand-in: this tick's center-kill report.
function fakeMirror(centerKillX = [], centerKillY = []) {
  return { centerKillX, centerKillY };
}

function fakeShip(x = 0, y = 0) {
  return { x, y };
}

function fakeScore(multiplier = 1) {
  return { xp: 0, multiplier };
}

// A far-away ship so orbs neither drift nor collect (isolates spawn/persistence).
function farShip() {
  return fakeShip(100000, 100000);
}

function activeOrbs(system) {
  const out = [];
  system.pool.forEachActive((o) => out.push(o));
  return out;
}

// Seed a live orb directly into the pool (bypassing the spawn reports) so the
// advance/drift/collect path can be tested in isolation.
function seedOrb(system, x, y, value) {
  const o = system.pool.acquire();
  o.x = x;
  o.y = y;
  o.value = value;
  return o;
}

function build({
  collision = fakeCollision(),
  blackHole = fakeBlackHole(),
  mirror = fakeMirror(),
  ship = farShip(),
  score = fakeScore(),
  maxOrbs,
} = {}) {
  return {
    system: new XpOrbSystem(collision, blackHole, mirror, ship, score, maxOrbs),
    ship,
    score,
  };
}

// ---------------------------------------------------------------------------

describe('XpOrbSystem — drop from each scored-death seam', () => {
  it('drops one orb per bullet kill at the snapshot coords carrying that kill xp', () => {
    // Seeker 1, Green 2, Pinwheel 2, snake body 1, snake head 3 — the per-type list.
    const collision = fakeCollision(
      5,
      [10, 20, 30, 40, 50],
      [11, 21, 31, 41, 51],
      [1, 2, 2, 1, 3],
    );
    const { system } = build({ collision });

    system.fixedUpdate(DT);

    const orbs = activeOrbs(system).sort((a, b) => a.x - b.x);
    expect(orbs.length).toBe(5);
    expect(orbs.map((o) => o.x)).toEqual([10, 20, 30, 40, 50]);
    expect(orbs.map((o) => o.y)).toEqual([11, 21, 31, 41, 51]);
    // Head drops value 3, body value 1 — the orb carries the exact snapshot value.
    expect(orbs.map((o) => o.value)).toEqual([1, 2, 2, 1, 3]);
  });

  it('reads only the first bulletKillCount entries (ignores appended absorb/bomb removals)', () => {
    // Arrays hold 3 entries but only 1 is a bullet kill; the other 2 are later-appended
    // unscored removals the orb system must NOT drop.
    const collision = fakeCollision(1, [10, 20, 30], [10, 20, 30], [2, 9, 9]);
    const { system } = build({ collision });

    system.fixedUpdate(DT);

    const orbs = activeOrbs(system);
    expect(orbs.length).toBe(1);
    expect(orbs[0].value).toBe(2);
  });

  it('drops one BLACKHOLE_DEFUSED_XP orb per defused hole at its position', () => {
    const blackHole = fakeBlackHole([300], [400]);
    const { system } = build({ blackHole });

    system.fixedUpdate(DT);

    const orbs = activeOrbs(system);
    expect(orbs.length).toBe(1);
    expect(orbs[0].x).toBe(300);
    expect(orbs[0].y).toBe(400);
    expect(orbs[0].value).toBe(BLACKHOLE_DEFUSED_XP);
  });

  it('drops one MIRROR_CENTER_KILL_XP orb per center-kill at the reflector center', () => {
    const mirror = fakeMirror([500], [600]);
    const { system } = build({ mirror });

    system.fixedUpdate(DT);

    const orbs = activeOrbs(system);
    expect(orbs.length).toBe(1);
    expect(orbs[0].x).toBe(500);
    expect(orbs[0].y).toBe(600);
    expect(orbs[0].value).toBe(MIRROR_CENTER_KILL_XP);
  });

  it('drops NO orb when no seam reports a death (bomb/absorb removals report nothing)', () => {
    // Every report empty — the economy-parity case: an unscored removal drops no XP.
    const { system, score } = build();

    system.fixedUpdate(DT);

    expect(activeOrbs(system).length).toBe(0);
    expect(score.xp).toBe(0);
  });
});

describe('XpOrbSystem — drift gate (per-tick distance, not a magnet latch)', () => {
  it('leaves an orb outside the pickup radius untouched', () => {
    const ship = fakeShip(0, 0);
    const { system } = build({ ship });
    const orb = seedOrb(system, XP_PICKUP_RADIUS + 50, 0, 1);

    system.fixedUpdate(DT);

    // Still active, unmoved (no timeout, no drift beyond the pickup radius).
    expect(activeOrbs(system).length).toBe(1);
    expect(orb.x).toBe(XP_PICKUP_RADIUS + 50);
    expect(orb.y).toBe(0);
  });

  it('drifts an orb inside the pickup radius toward the ship by DRIFT_SPEED·dt', () => {
    const ship = fakeShip(0, 0);
    const { system } = build({ ship });
    // Inside pickup (120), beyond collect (SHIP_RADIUS + XP_ORB_RADIUS).
    const startX = 100;
    const orb = seedOrb(system, startX, 0, 1);

    system.fixedUpdate(DT);

    const step = XP_ORB_DRIFT_SPEED * (DT / 1000);
    expect(activeOrbs(system).length).toBe(1); // not yet collected
    expect(orb.x).toBeCloseTo(startX - step, 6);
    expect(orb.y).toBeCloseTo(0, 6);
  });

  it('drifts along BOTH axes for a diagonal approach (unit-vector direction preserved)', () => {
    // A non-axis-aligned offset: dx and dy both non-zero so the y-component of the
    // drift update is actually observed. (3,4,5) triangle scaled to dist 100, inside
    // pickup (120) and well beyond collect (20). Catches a dropped/duplicated/sign-
    // flipped y term that a purely-horizontal orb (dy === 0) can never surface.
    const ship = fakeShip(0, 0);
    const { system } = build({ ship });
    const startX = 60;
    const startY = 80; // dist = 100
    const orb = seedOrb(system, startX, startY, 1);

    system.fixedUpdate(DT);

    const step = XP_ORB_DRIFT_SPEED * (DT / 1000);
    const frac = 1 - step / 100; // remaining fraction of the unit vector to the ship
    expect(activeOrbs(system).length).toBe(1); // drifted, not collected
    expect(orb.x).toBeCloseTo(startX * frac, 6);
    expect(orb.y).toBeCloseTo(startY * frac, 6);
    // Both components moved toward the ship (regression guard for the y term).
    expect(orb.x).toBeLessThan(startX);
    expect(orb.y).toBeLessThan(startY);
    // Straight-line distance covered equals one drift step.
    expect(Math.hypot(startX - orb.x, startY - orb.y)).toBeCloseTo(step, 6);
  });
});

describe('XpOrbSystem — collect + multiplier scaling', () => {
  it('credits value × (1 + mult/20) at collect time and releases the orb (mult 10)', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(10);
    const { system } = build({ ship, score });
    // Within the collect radius.
    seedOrb(system, SHIP_RADIUS + XP_ORB_RADIUS - 1, 0, 2);

    system.fixedUpdate(DT);

    // 2 × (1 + 10/20) = 3.0
    expect(score.xp).toBeCloseTo(2 * (1 + 10 / XP_MULTIPLIER_DIVISOR), 9);
    expect(score.xp).toBeCloseTo(3.0, 9);
    // Orb released back to the pool on collect.
    expect(activeOrbs(system).length).toBe(0);
  });

  it('credits value × (1 + mult/20) at mult 1 → +2.1 for value 2', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(1);
    const { system } = build({ ship, score });
    seedOrb(system, 0, 0, 2);

    system.fixedUpdate(DT);

    expect(score.xp).toBeCloseTo(2.1, 9);
    expect(activeOrbs(system).length).toBe(0);
  });

  it('accumulates as a float across multiple collects (no rounding)', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(1);
    const { system } = build({ ship, score });
    seedOrb(system, 0, 0, 1);
    seedOrb(system, 1, 0, 1);

    system.fixedUpdate(DT);

    // 2 orbs × 1 × 1.05 = 2.1 (fractional, unrounded).
    expect(score.xp).toBeCloseTo(2.1, 9);
  });
});

describe('XpOrbSystem — advance-then-spawn ordering', () => {
  it('does not collect a freshly spawned orb on its spawn tick (waits one tick)', () => {
    const ship = fakeShip(0, 0);
    const score = fakeScore(1);
    // A bullet kill reported exactly on the ship — the orb spawns after the advance
    // pass, so it must NOT be collected this tick.
    const collision = fakeCollision(1, [0], [0], [5]);
    const { system } = build({ collision, ship, score });

    system.fixedUpdate(DT);
    expect(activeOrbs(system).length).toBe(1);
    expect(score.xp).toBe(0);

    // Next tick (report now empty) collects it.
    collision.bulletKillCount = 0;
    system.fixedUpdate(DT);
    expect(activeOrbs(system).length).toBe(0);
    expect(score.xp).toBeCloseTo(5 * 1.05, 9);
  });
});

describe('XpOrbSystem — no timeout (orbs persist)', () => {
  it('keeps a floor orb alive & unmoved across many ticks with the ship far away', () => {
    const { system } = build({ ship: farShip() });
    const orb = seedOrb(system, 400, 300, 2);

    for (let i = 0; i < 1000; i++) system.fixedUpdate(DT);

    expect(activeOrbs(system).length).toBe(1);
    expect(orb.x).toBe(400);
    expect(orb.y).toBe(300);
    expect(orb.value).toBe(2);
  });
});

describe('XpOrbSystem — cap', () => {
  it('skips spawns that would exceed the live-orb cap', () => {
    // Cap 2; report 5 bullet kills far from the ship — only 2 orbs spawn.
    const collision = fakeCollision(
      5,
      [10, 20, 30, 40, 50],
      [0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1],
    );
    const { system } = build({ collision, maxOrbs: 2 });

    system.fixedUpdate(DT);

    expect(activeOrbs(system).length).toBe(2);
  });

  it('honors the cap in the defuse AND mirror spawn loops, not just the bullet loop', () => {
    // Cap 2, reached via the LATER seams: 0 bullet kills, 3 defused holes (exceeds the
    // cap → the defuse-loop break must fire on the 3rd), 1 center-kill (cap already full
    // → the mirror-loop break must fire immediately). If either break were removed a 3rd
    // orb would spawn, so this assertion fails on a regression in the defuse OR mirror
    // cap guard — the bullet-only cap test above cannot catch that.
    const blackHole = fakeBlackHole([1, 2, 3], [0, 0, 0]);
    const mirror = fakeMirror([4], [0]);
    const { system } = build({ blackHole, mirror, maxOrbs: 2 });

    system.fixedUpdate(DT);

    const orbs = activeOrbs(system);
    expect(orbs.length).toBe(2); // capped: the 3rd defuse orb + the mirror orb skipped
    expect(orbs.every((o) => o.value === BLACKHOLE_DEFUSED_XP)).toBe(true);
  });

  it('defaults a non-finite / non-positive maxOrbs to XP_ORB_MAX (placeholder guard)', () => {
    expect(new XpOrbSystem(null, null, null, null, null, 0).maxOrbs).toBe(
      XP_ORB_MAX,
    );
    expect(new XpOrbSystem(null, null, null, null, null, -5).maxOrbs).toBe(
      XP_ORB_MAX,
    );
    expect(new XpOrbSystem(null, null, null, null, null, NaN).maxOrbs).toBe(
      XP_ORB_MAX,
    );
    // Omitted → the default cap.
    expect(new XpOrbSystem(null, null, null, null, null).maxOrbs).toBe(
      XP_ORB_MAX,
    );
    // A valid positive value passes through.
    expect(new XpOrbSystem(null, null, null, null, null, 8).maxOrbs).toBe(8);
  });
});

describe('XpOrbSystem — combined seams in one tick', () => {
  it('drops orbs from all three seams in a single tick, honoring the cap globally', () => {
    const collision = fakeCollision(2, [1, 2], [0, 0], [1, 2]);
    const blackHole = fakeBlackHole([3], [0]);
    const mirror = fakeMirror([4], [0]);
    const { system } = build({ collision, blackHole, mirror });

    system.fixedUpdate(DT);

    const orbs = activeOrbs(system).sort((a, b) => a.x - b.x);
    expect(orbs.map((o) => o.value)).toEqual([
      1,
      2,
      BLACKHOLE_DEFUSED_XP,
      MIRROR_CENTER_KILL_XP,
    ]);
  });
});
