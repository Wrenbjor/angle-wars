import { describe, it, expect } from 'vitest';
import { MirrorReflectorSystem } from './MirrorReflectorSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { reflectVelocity } from './mirrorReflectorMath.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createMirrorReflector } from '../entities/MirrorReflector.js';
import { createPinwheel } from '../entities/Pinwheel.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  BULLET_RADIUS,
  SHIP_RADIUS,
  REFLECTOR_DRIFT_SPEED,
  REFLECTOR_SPIN_RATE,
  REFLECTOR_BAR_HALF_LENGTH,
  REFLECTOR_BAR_HALF_THICKNESS,
  REFLECTOR_WEIGHT_RADIUS,
  REFLECTOR_CENTER_KILL_RADIUS,
  REFLECTOR_SCORE,
  REFLECTOR_POOL_PREWARM,
  REFLECTOR_MAX_ACTIVE,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  PLAYER_START_LIVES,
  PLAYER_INVULN_MS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// The dumbbell's full reach (center → weight outer edge) — the wall-bounce/spawn inset.
const EFF = REFLECTOR_BAR_HALF_LENGTH + REFLECTOR_WEIGHT_RADIUS;
const MIN_X = ARENA_BORDER_INSET + EFF;
const MAX_X = ARENA_WIDTH - ARENA_BORDER_INSET - EFF;
const MIN_Y = ARENA_BORDER_INSET + EFF;
const MAX_Y = ARENA_HEIGHT - ARENA_BORDER_INSET - EFF;

// Deterministic rng cycling a fixed sequence in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Build a system with controllable shared state. The ship defaults FAR from the
// arena center so a reflector placed mid-arena is not accidentally center-destroyed.
function makeSystem({ rng, shipX = 100, shipY = 100 } = {}) {
  const ship = createPlayerShip();
  ship.x = shipX;
  ship.y = shipY;
  const bulletPool = new Pool(createBullet);
  const playerState = createPlayerState();
  const scoreState = createScoreState();
  const system = new MirrorReflectorSystem(
    ship,
    bulletPool,
    playerState,
    scoreState,
    rng || Math.random,
  );
  return { system, ship, bulletPool, playerState, scoreState };
}

// Directly place a live reflector in the pool (bypasses random spawn).
function placeReflector(system, x, y, vx = 0, vy = 0, angle = 0, telegraphMs = 0) {
  const r = system.enemyPool.acquire();
  r.x = x;
  r.y = y;
  r.vx = vx;
  r.vy = vy;
  r.angle = angle;
  r.telegraphMs = telegraphMs;
  return r;
}

function addBullet(bulletPool, x, y, vx, vy) {
  const b = bulletPool.acquire();
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  return b;
}

function activeReflectors(system) {
  const out = [];
  system.enemyPool.forEachActive((r) => out.push(r));
  return out;
}

describe('MirrorReflectorSystem — drift + spin + wall-bounce', () => {
  it('drifts by v·dtSec and advances angle by SPIN_RATE·dtSec (indifferent to the player)', () => {
    const { system } = makeSystem();
    const r = placeReflector(system, 640, 360, REFLECTOR_DRIFT_SPEED, 0, 0);
    system.fixedUpdate(DT);

    expect(r.x).toBeCloseTo(640 + REFLECTOR_DRIFT_SPEED * (DT / 1000), 9);
    expect(r.y).toBeCloseTo(360, 9);
    expect(r.angle).toBeCloseTo(REFLECTOR_SPIN_RATE * (DT / 1000), 9);
    expect(r.vx).toBe(REFLECTOR_DRIFT_SPEED); // no wall crossed
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(REFLECTOR_DRIFT_SPEED, 9);
  });

  it('bounces off the +x wall: clamps to MAX_X, negates vx, preserves |v|', () => {
    const { system } = makeSystem();
    const r = placeReflector(system, MAX_X - 0.5, 360, REFLECTOR_DRIFT_SPEED, 0, 0);
    system.fixedUpdate(DT);

    expect(r.x).toBe(MAX_X);
    expect(r.vx).toBe(-REFLECTOR_DRIFT_SPEED);
    expect(r.vy).toBe(0);
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(REFLECTOR_DRIFT_SPEED, 9);
  });

  it('bounces off the −y wall: clamps to MIN_Y, negates vy', () => {
    const { system } = makeSystem();
    const r = placeReflector(system, 640, MIN_Y + 0.5, 0, -REFLECTOR_DRIFT_SPEED, 0);
    system.fixedUpdate(DT);

    expect(r.y).toBe(MIN_Y);
    expect(r.vy).toBe(REFLECTOR_DRIFT_SPEED);
    expect(r.vx).toBe(0);
  });

  it('corner bounce: both x and y inset bounds cross in one tick → both vx and vy negate, |v| preserved', () => {
    // Guards the two INDEPENDENT if-blocks (x and y) against being collapsed into an
    // if / else-if that would reflect only one axis in a corner.
    const { system } = makeSystem();
    const v = REFLECTOR_DRIFT_SPEED / Math.SQRT2; // equal split, |v| == drift speed
    const r = placeReflector(system, MAX_X - 0.5, MAX_Y - 0.5, v, v, 0);
    system.fixedUpdate(DT);

    expect(r.x).toBe(MAX_X);
    expect(r.y).toBe(MAX_Y);
    expect(r.vx).toBeCloseTo(-v, 9);
    expect(r.vy).toBeCloseTo(-v, 9);
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(REFLECTOR_DRIFT_SPEED, 9);
  });

  it('drift + spin are frame-rate-independent (equal net displacement + angle for fine vs coarse ticks)', () => {
    const T = 480; // ms — 48×10 == 5×96
    function run(tickMs, ticks) {
      const { system } = makeSystem();
      const r = placeReflector(system, 300, 360, REFLECTOR_DRIFT_SPEED, 0, 0);
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return { dx: r.x - 300, angle: r.angle };
    }
    const fine = run(10, T / 10);
    const coarse = run(96, T / 96);
    expect(fine.dx).toBeCloseTo(coarse.dx, 9);
    expect(fine.dx).toBeCloseTo(REFLECTOR_DRIFT_SPEED * (T / 1000), 9);
    expect(fine.angle).toBeCloseTo(coarse.angle, 9);
    expect(fine.angle).toBeCloseTo(REFLECTOR_SPIN_RATE * (T / 1000), 9);
  });
});

describe('MirrorReflectorSystem — telegraph freeze / activate', () => {
  it('a telegraphing reflector is frozen + inert and counts down by dt', () => {
    const { system, scoreState, playerState } = makeSystem({ shipX: 640, shipY: 360 });
    // Ship sits exactly on the center, a bullet sits on the bar — both would fire if
    // active; while telegraphing NEITHER does.
    const r = placeReflector(system, 640, 360, REFLECTOR_DRIFT_SPEED, 0, 0, ENEMY_SPAWN_TELEGRAPH_MS);
    const b = addBullet(system.bulletPool, 640, 355, 0, 300);
    system.fixedUpdate(DT);

    // Frozen: position/velocity/angle untouched.
    expect(r.x).toBe(640);
    expect(r.y).toBe(360);
    expect(r.angle).toBe(0);
    expect(r.vx).toBe(REFLECTOR_DRIFT_SPEED);
    // Inert: no reflect, no destroy, no weight-kill.
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(300);
    expect(system.enemyPool.activeCount).toBe(1);
    expect(scoreState.score).toBe(0);
    expect(playerState.pendingDeath).toBe(false);
    // Only the telegraph advanced.
    expect(r.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
  });

  it('activates on the tick the telegraph reaches 0 (drifts + spins this same tick)', () => {
    const { system } = makeSystem();
    const r = placeReflector(system, 640, 360, REFLECTOR_DRIFT_SPEED, 0, 0, DT);
    system.fixedUpdate(DT);
    expect(r.telegraphMs).toBe(0);
    expect(r.x).toBeCloseTo(640 + REFLECTOR_DRIFT_SPEED * (DT / 1000), 9);
    expect(r.angle).toBeCloseTo(REFLECTOR_SPIN_RATE * (DT / 1000), 9);
  });
});

describe('MirrorReflectorSystem — bullet reflect off the bar', () => {
  it('mirrors an approaching bullet across the bar normal (|v| preserved), leaving it live + reflector undamaged', () => {
    const { system, bulletPool } = makeSystem();
    // Stationary reflector at mid-arena, bar ≈ horizontal (angle advances a hair from spin).
    const r = placeReflector(system, 640, 360, 0, 0, 0);
    const b = addBullet(bulletPool, 640, 355, 0, 300); // just above the bar, moving down
    const origVx = b.vx;
    const origVy = b.vy;
    const speedBefore = Math.hypot(b.vx, b.vy);

    system.fixedUpdate(DT);

    // Mirrored across the bar's realized (post-spin) unit normal.
    const nx = -Math.sin(r.angle);
    const ny = Math.cos(r.angle);
    const exp = reflectVelocity(origVx, origVy, nx, ny);
    expect(b.vx).toBeCloseTo(exp.vx, 6);
    expect(b.vy).toBeCloseTo(exp.vy, 6);
    // Normal component flipped: it was moving down (+y), now moving up.
    expect(b.vy).toBeLessThan(0);
    // Magnitude preserved.
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speedBefore, 6);
    // Bullet NOT consumed (stays a live player shot); reflector undamaged.
    expect(bulletPool.activeCount).toBe(1);
    expect(system.enemyPool.activeCount).toBe(1);
  });

  it('does NOT reflect a receding bullet (side·(v·n) ≥ 0) — no per-tick jitter', () => {
    const { system, bulletPool } = makeSystem();
    placeReflector(system, 640, 360, 0, 0, 0);
    const b = addBullet(bulletPool, 640, 355, 0, -300); // above the bar, moving away (up)
    system.fixedUpdate(DT);
    // Velocity untouched.
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(-300);
    expect(bulletPool.activeCount).toBe(1);
  });

  it('reflects a bullet at most once per tick across two overlapping bars (reusable Set)', () => {
    // Two parallel bars straddling the bullet: without the dedupe Set the first
    // reflect would send the bullet INTO the second bar (now approaching) and flip it
    // back to its original velocity. The Set stops the second reflect, so the bullet
    // ends up reflected exactly once (net downward → upward).
    const { system, bulletPool } = makeSystem();
    placeReflector(system, 640, 360, 0, 0, 0); // bar A (acquired first → visited first)
    placeReflector(system, 640, 350, 0, 0, 0); // bar C, 10px above
    const b = addBullet(bulletPool, 640, 355, 0, 300); // between the two bars, moving down
    const speedBefore = Math.hypot(b.vx, b.vy);

    system.fixedUpdate(DT);

    // Reflected once: moving up now (had it reflected twice it would be ≈ +300 again).
    expect(b.vy).toBeLessThan(0);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speedBefore, 6);
  });

  it('does NOT reflect an approaching bullet that is FAR from the bar (proximity gate)', () => {
    // A bullet approaching the bar-line but well OUTSIDE the reflect band
    // (BULLET_RADIUS + REFLECTOR_BAR_HALF_THICKNESS ≈ 10px) must pass through
    // untouched — the distance gate, not just the approaching gate, is load-bearing.
    // Every other bullet case sits ~5px from the bar (inside the band), so removing
    // the proximity gate would reflect EVERY approaching player bullet arena-wide and
    // nothing would fail; this pins that gate as a rejecter.
    const { system, bulletPool } = makeSystem();
    placeReflector(system, 640, 360, 0, 0, 0);
    const b = addBullet(bulletPool, 640, 200, 0, 300); // 160px above the bar, approaching
    system.fixedUpdate(DT);
    // Velocity untouched (far outside the band → no reflect).
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(300);
    expect(bulletPool.activeCount).toBe(1);
  });
});

describe('MirrorReflectorSystem — composed: a reflected bullet still destroys an enemy', () => {
  it('after reflecting, the same pooled bullet destroys an enemy through a REAL CollisionSystem', () => {
    const { system, bulletPool } = makeSystem();
    placeReflector(system, 640, 360, 0, 0, 0);
    const b = addBullet(bulletPool, 640, 355, 0, 300);
    system.fixedUpdate(DT); // bullet reflected, still active + player-owned

    expect(bulletPool.activeCount).toBe(1);

    // Drop an enemy on the (still-live) bullet and run the real shared collision seam.
    const pinwheelPool = new Pool(createPinwheel);
    const pw = pinwheelPool.acquire();
    pw.x = b.x;
    pw.y = b.y;
    const collision = new CollisionSystem(bulletPool, [pinwheelPool]);
    collision.fixedUpdate(DT);

    expect(pinwheelPool.activeCount).toBe(0); // enemy destroyed by the reflected shot
    expect(bulletPool.activeCount).toBe(0); // bullet consumed by the real collision
    expect(collision.killedEnemies).toContain(pw);
  });
});

describe('MirrorReflectorSystem — ship interactions (center-destroy vs weight-kill)', () => {
  it('ship through the center destroys the reflector for REFLECTOR_SCORE, no life lost', () => {
    const { system, scoreState, playerState } = makeSystem({ shipX: 640, shipY: 360 });
    placeReflector(system, 640, 360, 0, 0, 0); // center under the ship
    system.fixedUpdate(DT);

    expect(system.enemyPool.activeCount).toBe(0); // released to its pool
    expect(scoreState.score).toBe(REFLECTOR_SCORE); // flat payout credited directly
    expect(playerState.pendingDeath).toBe(false); // no life lost
  });

  it('ship overlapping a weight (center miss) sets pendingDeath, keeps the reflector, no score', () => {
    // Ship at the +x weight endpoint (48px from center > center-kill radius).
    const { system, scoreState, playerState } = makeSystem({
      shipX: 640 + REFLECTOR_BAR_HALF_LENGTH,
      shipY: 360,
    });
    placeReflector(system, 640, 360, 0, 0, 0);
    system.fixedUpdate(DT);

    expect(playerState.pendingDeath).toBe(true);
    expect(system.enemyPool.activeCount).toBe(1); // NOT released
    expect(scoreState.score).toBe(0); // no payout
  });

  it('ship overlapping the OTHER weight (−x endpoint) also sets pendingDeath (either weight kills)', () => {
    // The kill predicate is an OR over BOTH weight circles; the +x-weight test above
    // never exercises the −x (endpoint B) branch. Ship at the −x weight endpoint,
    // center miss (48px > center-kill radius). Dropping the second OR term would make
    // endpoint B silently harmless — this pins the spec'd "either weight kills".
    const { system, scoreState, playerState } = makeSystem({
      shipX: 640 - REFLECTOR_BAR_HALF_LENGTH,
      shipY: 360,
    });
    placeReflector(system, 640, 360, 0, 0, 0);
    system.fixedUpdate(DT);

    expect(playerState.pendingDeath).toBe(true);
    expect(system.enemyPool.activeCount).toBe(1); // NOT released
    expect(scoreState.score).toBe(0); // no payout
  });

  it('center-destroy ACCUMULATES the payout onto the prior score (+= not =)', () => {
    // Both center-destroy tests otherwise start from score 0, where `score += SCORE`
    // and `score = SCORE` are indistinguishable. Pre-seed a nonzero run score so an
    // overwrite regression (which would wipe the run's score on every reflector kill)
    // fails here.
    const { system, scoreState, playerState } = makeSystem({ shipX: 640, shipY: 360 });
    scoreState.score = 250; // prior run score
    placeReflector(system, 640, 360, 0, 0, 0); // center under the ship
    system.fixedUpdate(DT);

    expect(system.enemyPool.activeCount).toBe(0); // released
    expect(scoreState.score).toBe(250 + REFLECTOR_SCORE); // credit ADDED, not overwritten
    expect(playerState.pendingDeath).toBe(false);
  });

  it('center precedence: with BOTH the center AND a weight strictly overlapping, destroy wins (weight-first ordering would FAIL this)', () => {
    const cx = 640;
    const cy = 360;
    // Pre-set the angle so that AFTER the motion-pass spin (angle += SPIN_RATE·dtSec)
    // the +x weight lands EXACTLY on the +x axis at (cx+halfLen, cy). The negation
    // cancels the spin bit-exactly (same dtSec expression), so post-motion angle == 0.
    const preAngle = -(REFLECTOR_SPIN_RATE * (DT / 1000));
    // Ship on the +x axis at exactly the center-kill boundary from the center.
    const shipX = cx + REFLECTOR_CENTER_KILL_RADIUS;
    // Distance from that ship point to the +x weight, computed from the constants.
    const distToWeight = REFLECTOR_BAR_HALF_LENGTH - REFLECTOR_CENTER_KILL_RADIUS;
    // Precondition (from constants, not hardcoded): the ship point must ALSO satisfy the
    // weight-kill predicate (dist ≤ ship.radius + weight.radius), or the test would not
    // distinguish center-first from weight-first ordering.
    expect(distToWeight).toBeLessThanOrEqual(SHIP_RADIUS + REFLECTOR_WEIGHT_RADIUS);

    const { system, scoreState, playerState } = makeSystem({ shipX, shipY: cy });
    const r = placeReflector(system, cx, cy, 0, 0, preAngle);
    system.fixedUpdate(DT);

    // Confirm the realized geometry: both predicates hold at the ship position.
    const wax = cx + Math.cos(r.angle) * REFLECTOR_BAR_HALF_LENGTH; // +x weight, post-spin
    const way = cy + Math.sin(r.angle) * REFLECTOR_BAR_HALF_LENGTH;
    // center predicate: dist(ship, center) ≤ REFLECTOR_CENTER_KILL_RADIUS (boundary).
    expect(Math.hypot(shipX - cx, cy - cy)).toBeLessThanOrEqual(
      REFLECTOR_CENTER_KILL_RADIUS + 1e-9,
    );
    // weight predicate: dist(ship, +x weight) ≤ ship.radius + weight.radius (boundary).
    expect(Math.hypot(shipX - wax, cy - way)).toBeLessThanOrEqual(
      SHIP_RADIUS + REFLECTOR_WEIGHT_RADIUS + 1e-9,
    );

    // Center-destroy WINS over the also-satisfied weight-kill (weight-first would set
    // pendingDeath and leave the reflector alive — which these assertions reject).
    expect(system.enemyPool.activeCount).toBe(0);
    expect(scoreState.score).toBe(REFLECTOR_SCORE);
    expect(playerState.pendingDeath).toBe(false);
  });

  it('a telegraphing reflector with the ship on its center is inert (no destroy, no kill)', () => {
    const { system, scoreState, playerState } = makeSystem({ shipX: 640, shipY: 360 });
    const r = placeReflector(system, 640, 360, 0, 0, 0, ENEMY_SPAWN_TELEGRAPH_MS);
    system.fixedUpdate(DT);

    expect(system.enemyPool.activeCount).toBe(1); // not destroyed
    expect(scoreState.score).toBe(0);
    expect(playerState.pendingDeath).toBe(false);
    expect(r.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
  });
});

describe('MirrorReflectorSystem — composed: a weight-kill drives the REAL PlayerDeathSystem', () => {
  it('a weight contact → pendingDeath → a real PlayerDeathSystem life loss with respawn/invuln', () => {
    const { system, ship, playerState } = makeSystem({
      shipX: 640 + REFLECTOR_BAR_HALF_LENGTH,
      shipY: 360,
    });
    placeReflector(system, 640, 360, 0, 0, 0);
    system.fixedUpdate(DT); // sets pendingDeath (weight-kill)
    expect(playerState.pendingDeath).toBe(true);

    // The real death system consumes pendingDeath (the reflector is NOT in its pools).
    const death = new PlayerDeathSystem(ship, [], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS); // respawn invuln granted
    expect(playerState.pendingDeath).toBe(false); // consumed read-and-clear
  });
});

describe('MirrorReflectorSystem — spawn (placement / telegraph / speed / away-from-ship) + cap', () => {
  it('spawn() places one reflector on an arena edge inside the border, telegraphing, at the drift speed', () => {
    // Draw order: edge, position-along-edge, heading, initial angle.
    const system = makeSystem({ rng: seqRng([0.0, 0.5, 0.0, 0.0]) }).system;
    system.spawn();
    const [r] = activeReflectors(system);
    // Top edge, centered.
    expect(r.y).toBe(MIN_Y);
    expect(r.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
    // Telegraphing + at exactly the drift speed.
    expect(r.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(REFLECTOR_DRIFT_SPEED, 9);
    // Heading + initial angle come from the trailing rng draws.
    expect(r.vx).toBeCloseTo(Math.cos(0) * REFLECTOR_DRIFT_SPEED, 9);
    expect(r.angle).toBeCloseTo(0, 9);
  });

  it('spawn() re-rolls the placement away from the ship (≥ SPAWN_SAFE_RADIUS)', () => {
    const shipX = MIN_X + 0.5 * (MAX_X - MIN_X);
    const shipY = MIN_Y;
    // top-center (on ship) → re-roll → bottom-center (far); then heading + angle.
    const system = makeSystem({ rng: seqRng([0.0, 0.5, 0.25, 0.5, 0.37, 0.1]) }).system;
    system.spawn(shipX, shipY);
    const [r] = activeReflectors(system);
    const dx = r.x - shipX;
    const dy = r.y - shipY;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
  });

  it('spawn() is a no-op at/above REFLECTOR_MAX_ACTIVE (no acquire)', () => {
    const system = makeSystem({ rng: seqRng([0.0, 0.5, 0.0, 0.0]) }).system;
    for (let i = 0; i < REFLECTOR_MAX_ACTIVE; i++) system.spawn();
    expect(system.enemyPool.activeCount).toBe(REFLECTOR_MAX_ACTIVE);
    const freeBefore = system.enemyPool.freeCount;
    system.spawn(); // over the cap
    expect(system.enemyPool.activeCount).toBe(REFLECTOR_MAX_ACTIVE); // unchanged
    expect(system.enemyPool.freeCount).toBe(freeBefore); // nothing acquired
  });

  it('motion is ship-independent: identical reflectors step identically regardless of ship position', () => {
    // Two systems whose ships sit at VERY different (far) positions, with a
    // bit-identical seeded reflector in each. If the drift/spin ever read the ship, the
    // differing ship positions would diverge the two paths; they must stay identical.
    const a = makeSystem({ shipX: 100, shipY: 100 });
    const b = makeSystem({ shipX: ARENA_WIDTH - 100, shipY: ARENA_HEIGHT - 100 });
    const seed = () => [640, 360, REFLECTOR_DRIFT_SPEED * 0.6, REFLECTOR_DRIFT_SPEED * 0.8, 0.3];
    const ra = placeReflector(a.system, ...seed());
    const rb = placeReflector(b.system, ...seed());
    for (let i = 0; i < 20; i++) {
      a.system.fixedUpdate(DT);
      b.system.fixedUpdate(DT);
    }
    // Bit-identical motion (both ships are far, so no interaction fires in either).
    expect(ra.x).toBe(rb.x);
    expect(ra.y).toBe(rb.y);
    expect(ra.vx).toBe(rb.vx);
    expect(ra.vy).toBe(rb.vy);
    expect(ra.angle).toBe(rb.angle);
    // Sanity: the reflector actually moved (the run exercised real motion, not a no-op).
    expect(ra.x !== 640 || ra.y !== 360).toBe(true);
    // Both survived (no accidental center-destroy / weight-kill from the far ships).
    expect(a.system.enemyPool.activeCount).toBe(1);
    expect(b.system.enemyPool.activeCount).toBe(1);
  });

  it('canSpawn() flips false exactly at the per-type cap', () => {
    const system = makeSystem({ rng: seqRng([0.0, 0.5, 0.0, 0.0]) }).system;
    expect(system.canSpawn()).toBe(true); // empty pool → eligible
    for (let i = 0; i < REFLECTOR_MAX_ACTIVE - 1; i++) system.spawn();
    expect(system.canSpawn()).toBe(true); // still below the cap
    system.spawn(); // reaches the cap
    expect(system.enemyPool.activeCount).toBe(REFLECTOR_MAX_ACTIVE);
    expect(system.canSpawn()).toBe(false); // at the cap → ineligible
  });
});

describe('MirrorReflectorSystem — pool prewarm + steady-state reuse (NFR2)', () => {
  it('prewarms the pool and does not grow it over many steady-state steps', () => {
    const { system } = makeSystem();
    expect(system.enemyPool.freeCount).toBe(REFLECTOR_POOL_PREWARM);
    expect(system.enemyPool.activeCount).toBe(0);

    const rng = seqRng([0.0, 0.5, 0.0, 0.0]);
    system._rng = rng;
    for (let i = 0; i < 10; i++) system.spawn(); // capped at MAX_ACTIVE
    expect(system.enemyPool.activeCount).toBe(REFLECTOR_MAX_ACTIVE);
    // No growth: MAX_ACTIVE ≤ PREWARM, so active + free stays == prewarm.
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      REFLECTOR_POOL_PREWARM,
    );

    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      REFLECTOR_POOL_PREWARM,
    );
  });

  it('recycles a destroyed reflector instance on the next spawn (no allocation)', () => {
    const { system } = makeSystem({ shipX: 640, shipY: 360 });
    const r = placeReflector(system, 640, 360, 0, 0, 0); // under the ship
    system.fixedUpdate(DT); // center-destroy releases it
    expect(system.enemyPool.activeCount).toBe(0);

    system._rng = seqRng([0.0, 0.5, 0.0, 0.0]);
    system.spawn();
    const [recycled] = activeReflectors(system);
    expect(recycled).toBe(r); // reused, not freshly allocated
  });
});

describe('MirrorReflectorSystem — design invariants (tuning guards)', () => {
  it('keeps the center-kill zone strictly inside the bar (CENTER_KILL_RADIUS < BAR_HALF_LENGTH)', () => {
    // The spec documents this invariant so the "thread the needle" reward zone stays
    // disjoint from the lethal weights at the bar ends. It is otherwise only prose — a
    // post-launch tuner raising center-kill to/past the bar half-length would collapse
    // the thread-through into a free reward with nothing failing. This pins it.
    expect(REFLECTOR_CENTER_KILL_RADIUS).toBeLessThan(REFLECTOR_BAR_HALF_LENGTH);
  });
});

describe('createMirrorReflector factory', () => {
  it('returns a zeroed shape with an inactive telegraph and no radius/score fields', () => {
    const r = createMirrorReflector();
    expect(r).toEqual({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, telegraphMs: 0 });
  });
});
