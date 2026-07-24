import { describe, it, expect } from 'vitest';
import {
  sanitizeBounces,
  sanitizeDmgPerBounce,
  readRicochetFlag,
  resolveRicochetParams,
  stampRicochet,
  reflectBulletOffWall,
  reflectBulletOffEnemy,
} from './ricochet.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  RICOCHET_MAX_BOUNCES,
  RICOCHET_DMG_PER_BOUNCE_MAX,
} from '../config/constants.js';

// Story 11.5 — Ricochet Rounds pure-helper unit tests. Everything here is a pure function of
// its args (no engine, no system), so it tests directly: fold sanitizers fail-safe to unowned,
// stamping overwrites stale fields, wall/enemy reflection flips + clamps + grows damage
// multiplicatively, a corner is ONE bounce, and an exhausted budget releases.

// A minimal bullet fixture in the Bullet.js shape the helpers read/write.
function makeBullet(overrides = {}) {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 4,
    damage: 1,
    bouncesRemaining: 0,
    dmgPerBounce: 0,
    bounceOffEnemies: false,
    seek: false,
    bounced: false,
    ...overrides,
  };
}

describe('sanitizeBounces', () => {
  it('reads a valid integer budget through unchanged', () => {
    expect(sanitizeBounces({ ricochetBounces: 1 })).toBe(1);
    expect(sanitizeBounces({ ricochetBounces: 4 })).toBe(4);
  });

  it('floors a fractional value to a whole budget', () => {
    expect(sanitizeBounces({ ricochetBounces: 2.9 })).toBe(2);
  });

  it('fails safe to 0 (unowned) for a null store, missing field, junk, or negative', () => {
    expect(sanitizeBounces(null)).toBe(0);
    expect(sanitizeBounces(undefined)).toBe(0);
    expect(sanitizeBounces({})).toBe(0);
    expect(sanitizeBounces({ ricochetBounces: NaN })).toBe(0);
    expect(sanitizeBounces({ ricochetBounces: Infinity })).toBe(0);
    expect(sanitizeBounces({ ricochetBounces: -3 })).toBe(0);
    expect(sanitizeBounces({ ricochetBounces: '4' })).toBe(0);
  });

  it('clamps an absurd budget to RICOCHET_MAX_BOUNCES', () => {
    expect(sanitizeBounces({ ricochetBounces: 1e9 })).toBe(RICOCHET_MAX_BOUNCES);
    expect(sanitizeBounces({ ricochetBounces: RICOCHET_MAX_BOUNCES + 1 })).toBe(
      RICOCHET_MAX_BOUNCES,
    );
  });
});

describe('sanitizeDmgPerBounce', () => {
  it('reads a valid growth fraction through unchanged', () => {
    expect(sanitizeDmgPerBounce({ ricochetDmgPerBounce: 0.25 })).toBe(0.25);
    expect(sanitizeDmgPerBounce({ ricochetDmgPerBounce: 0 })).toBe(0);
  });

  it('fails safe to 0 for a null store, missing field, junk, or negative', () => {
    expect(sanitizeDmgPerBounce(null)).toBe(0);
    expect(sanitizeDmgPerBounce({})).toBe(0);
    expect(sanitizeDmgPerBounce({ ricochetDmgPerBounce: NaN })).toBe(0);
    expect(sanitizeDmgPerBounce({ ricochetDmgPerBounce: -0.5 })).toBe(0);
  });

  it('clamps an absurd fraction to RICOCHET_DMG_PER_BOUNCE_MAX', () => {
    expect(sanitizeDmgPerBounce({ ricochetDmgPerBounce: 1e6 })).toBe(
      RICOCHET_DMG_PER_BOUNCE_MAX,
    );
  });
});

describe('readRicochetFlag', () => {
  it('is true only for a finite value >= 1', () => {
    expect(readRicochetFlag({ ricochetOffEnemies: 1 }, 'ricochetOffEnemies')).toBe(true);
    expect(readRicochetFlag({ ricochetSeek: 2 }, 'ricochetSeek')).toBe(true);
  });

  it('is false for a null store, missing field, 0, or junk', () => {
    expect(readRicochetFlag(null, 'ricochetSeek')).toBe(false);
    expect(readRicochetFlag({}, 'ricochetSeek')).toBe(false);
    expect(readRicochetFlag({ ricochetSeek: 0 }, 'ricochetSeek')).toBe(false);
    expect(readRicochetFlag({ ricochetSeek: 0.5 }, 'ricochetSeek')).toBe(false);
    expect(readRicochetFlag({ ricochetSeek: NaN }, 'ricochetSeek')).toBe(false);
  });
});

describe('resolveRicochetParams', () => {
  it('resolves the whole sanitized set into the passed out object and returns it', () => {
    const out = { bouncesRemaining: 0, dmgPerBounce: 0, bounceOffEnemies: false, seek: false };
    const store = {
      ricochetBounces: 4,
      ricochetDmgPerBounce: 0.25,
      ricochetOffEnemies: 1,
      ricochetSeek: 1,
    };
    const returned = resolveRicochetParams(store, out);
    expect(returned).toBe(out); // same object, mutated in place (zero-alloc)
    expect(out).toEqual({
      bouncesRemaining: 4,
      dmgPerBounce: 0.25,
      bounceOffEnemies: true,
      seek: true,
    });
  });

  it('resolves a null store to the unowned set', () => {
    const out = { bouncesRemaining: 9, dmgPerBounce: 9, bounceOffEnemies: true, seek: true };
    resolveRicochetParams(null, out);
    expect(out).toEqual({
      bouncesRemaining: 0,
      dmgPerBounce: 0,
      bounceOffEnemies: false,
      seek: false,
    });
  });
});

describe('stampRicochet', () => {
  it('overwrites every stale ricochet field and resets bounced to false', () => {
    // A recycled bullet still carrying a prior Lv5 shot's fields.
    const bullet = makeBullet({
      bouncesRemaining: 4,
      dmgPerBounce: 0.25,
      bounceOffEnemies: true,
      seek: true,
      bounced: true,
    });
    stampRicochet(bullet, {
      bouncesRemaining: 0,
      dmgPerBounce: 0,
      bounceOffEnemies: false,
      seek: false,
    });
    expect(bullet.bouncesRemaining).toBe(0);
    expect(bullet.dmgPerBounce).toBe(0);
    expect(bullet.bounceOffEnemies).toBe(false);
    expect(bullet.seek).toBe(false);
    expect(bullet.bounced).toBe(false);
  });
});

describe('reflectBulletOffWall', () => {
  it('flips the crossed X component, clamps inside, spends one bounce, marks bounced', () => {
    const b = makeBullet({ x: ARENA_BORDER_INSET - 5, y: 300, vx: -900, vy: 0, bouncesRemaining: 2 });
    const kept = reflectBulletOffWall(b);
    expect(kept).toBe(true);
    expect(b.vx).toBe(900); // flipped
    expect(b.vy).toBe(0);
    expect(b.x).toBe(ARENA_BORDER_INSET); // clamped onto the border (no longer outside)
    expect(b.bouncesRemaining).toBe(1);
    expect(b.bounced).toBe(true);
  });

  it('preserves speed on reflection (an isometry)', () => {
    const b = makeBullet({ x: ARENA_WIDTH - ARENA_BORDER_INSET + 3, y: 100, vx: 600, vy: 400, bouncesRemaining: 1 });
    const before = Math.hypot(b.vx, b.vy);
    reflectBulletOffWall(b);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(before, 9);
    expect(b.x).toBe(ARENA_WIDTH - ARENA_BORDER_INSET);
  });

  it('treats a CORNER (both borders crossed) as ONE bounce, flipping both components once', () => {
    const b = makeBullet({
      x: ARENA_BORDER_INSET - 2,
      y: ARENA_BORDER_INSET - 2,
      vx: -500,
      vy: -500,
      damage: 4,
      dmgPerBounce: 0.25,
      bouncesRemaining: 2,
    });
    reflectBulletOffWall(b);
    expect(b.vx).toBe(500);
    expect(b.vy).toBe(500);
    expect(b.x).toBe(ARENA_BORDER_INSET);
    expect(b.y).toBe(ARENA_BORDER_INSET);
    expect(b.bouncesRemaining).toBe(1); // ONE bounce, not two
    expect(b.damage).toBeCloseTo(5, 9); // ONE growth: 4 * 1.25
  });

  it('grows damage multiplicatively — compounding across bounces', () => {
    const b = makeBullet({ x: ARENA_BORDER_INSET - 1, y: 300, vx: -900, vy: 0, damage: 4, dmgPerBounce: 0.25, bouncesRemaining: 3 });
    reflectBulletOffWall(b);
    expect(b.damage).toBeCloseTo(5, 9); // 4 * 1.25
    // Send it back out the same wall and reflect again.
    b.x = ARENA_BORDER_INSET - 1;
    reflectBulletOffWall(b);
    expect(b.damage).toBeCloseTo(6.25, 9); // 5 * 1.25 (compounding)
  });

  it('returns false and does NOT mutate a bullet with no budget (release signal)', () => {
    const b = makeBullet({ x: ARENA_BORDER_INSET - 5, y: 300, vx: -900, vy: 0, damage: 4, bouncesRemaining: 0 });
    const snapshot = { ...b };
    const kept = reflectBulletOffWall(b);
    expect(kept).toBe(false);
    expect(b).toEqual(snapshot); // untouched — the caller releases it
  });
});

describe('reflectBulletOffEnemy', () => {
  it('reflects the velocity across the enemy surface normal, preserving speed', () => {
    // Bullet directly left of the enemy, moving right INTO it → reflects to moving left.
    const b = makeBullet({ x: 90, y: 100, vx: 300, vy: 0, bouncesRemaining: 2 });
    const enemy = { x: 100, y: 100, radius: 14 };
    const before = Math.hypot(b.vx, b.vy);
    reflectBulletOffEnemy(b, enemy);
    expect(b.vx).toBeCloseTo(-300, 9); // reversed off the horizontal normal
    expect(b.vy).toBeCloseTo(0, 9);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(before, 9);
    expect(b.bouncesRemaining).toBe(1);
    expect(b.bounced).toBe(true);
  });

  it('grows damage once and spends one bounce', () => {
    const b = makeBullet({ x: 90, y: 100, vx: 300, vy: 0, damage: 6, dmgPerBounce: 0.25, bouncesRemaining: 4 });
    reflectBulletOffEnemy(b, { x: 100, y: 100, radius: 14 });
    expect(b.damage).toBeCloseTo(7.5, 9); // 6 * 1.25
    expect(b.bouncesRemaining).toBe(3);
  });

  it('pushes the bullet OUT onto the enemy surface (clear of the overlap band), speed preserved', () => {
    // A SURVIVING enemy must not re-collide next tick: the bullet is repositioned to distance
    // exactly enemy.radius + bullet.radius from the enemy center along the contact normal.
    const enemy = { x: 100, y: 100, radius: 14 };
    const b = makeBullet({ x: 105, y: 100, vx: -300, vy: 0, radius: 4, bouncesRemaining: 2 });
    const before = Math.hypot(b.vx, b.vy);
    reflectBulletOffEnemy(b, enemy);
    const dist = Math.hypot(b.x - enemy.x, b.y - enemy.y);
    expect(dist).toBeCloseTo(enemy.radius + b.radius, 9); // no longer inside the band
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(before, 9); // isometry
  });

  it('coincident enemy: reverses velocity, repositions outside the radius, still spends + grows', () => {
    const enemy = { x: 100, y: 100, radius: 14 };
    const b = makeBullet({ x: 100, y: 100, vx: 200, vy: 100, radius: 4, damage: 4, dmgPerBounce: 0.25, bouncesRemaining: 1 });
    reflectBulletOffEnemy(b, enemy);
    expect(b.vx).toBe(-200); // reversed (deterministic outbound direction)
    expect(b.vy).toBe(-100);
    const dist = Math.hypot(b.x - enemy.x, b.y - enemy.y);
    expect(dist).toBeCloseTo(enemy.radius + b.radius, 9); // pushed clear
    expect(b.damage).toBeCloseTo(5, 9);
    expect(b.bouncesRemaining).toBe(0);
  });
});
