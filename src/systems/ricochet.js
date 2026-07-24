import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  RICOCHET_MAX_BOUNCES,
  RICOCHET_DMG_PER_BOUNCE_MAX,
} from '../config/constants.js';
import { reflectVelocity } from './mirrorReflectorMath.js';

// ricochet — pure, Phaser-free helpers for Ricochet Rounds (Story 11.5 / PRD §13.4).
//
// Ricochet is the epic's first BASE-GUN MODIFIER: it folds onto the EXISTING base bullet
// (like Overcharge / Spread Cannon) rather than owning a separate pooled system. It therefore
// has NO runtime system state of its own — its whole behaviour is a set of parameters STAMPED
// onto each bullet at spawn plus two reflection operations. This module holds that logic in ONE
// testable seam so the two hot systems (FiringSystem for wall reflection + seek; CollisionSystem
// for enemy bounce) reuse it instead of duplicating the math:
//   - `sanitizeBounces` / `sanitizeDmgPerBounce` / the flag reads — fold sanitizers that fail
//     SAFE to unowned/off against a corrupt store (mirroring the sibling item sanitizers);
//   - `resolveRicochetParams(playerStats, out)` — resolve the whole sanitized set ONCE per tick
//     into a reused `out` object (zero per-tick allocation, like `damage`/`ways`);
//   - `stampRicochet(bullet, params)` — write all fields + `bounced = false` onto a freshly
//     acquired bullet (a recycled bullet carries the previous shot's fields until re-stamped);
//   - `reflectBulletOffWall(bullet)` — flip the crossed velocity component(s), clamp the bullet
//     back inside the border, grow its damage, spend one bounce; returns whether it was kept;
//   - `reflectBulletOffEnemy(bullet, enemy)` — reflect off the enemy's surface normal, grow
//     damage, spend one bounce.
// Every reflection is a speed-preserving isometry (a corner flips both axes but is ONE bounce),
// and damage grows MULTIPLICATIVELY on the bullet's current stamped damage, exactly once per
// reflection event. All helpers allocate nothing on the hot path (reflections write velocity in
// place; the enemy reflect reuses `reflectVelocity`'s `out` form with the bullet itself as out).

/**
 * The sanitized bounce BUDGET off the shared store — an INTEGER in [0, RICOCHET_MAX_BOUNCES].
 * A missing store, a missing field, a non-finite value, or a negative one all resolve to 0
 * (unowned — the pre-11.5 gun); an absurdly large value clamps to RICOCHET_MAX_BOUNCES (a SAFETY
 * guard so a corrupted fold can never stamp an unbounded budget). Allocates nothing.
 * @param {Object<string, number>|null|undefined} playerStats
 * @returns {number} integer in [0, RICOCHET_MAX_BOUNCES]
 */
export function sanitizeBounces(playerStats) {
  if (playerStats === null || playerStats === undefined) return 0;
  const v = playerStats.ricochetBounces;
  if (!Number.isFinite(v)) return 0;
  const n = Math.floor(v);
  if (n < 0) return 0;
  return n > RICOCHET_MAX_BOUNCES ? RICOCHET_MAX_BOUNCES : n;
}

/**
 * The sanitized per-bounce damage-growth FRACTION off the shared store — a finite number in
 * [0, RICOCHET_DMG_PER_BOUNCE_MAX]. A missing store/field, a non-finite value, or a negative one
 * all resolve to 0 (no growth); an absurd value clamps to RICOCHET_DMG_PER_BOUNCE_MAX. This is a
 * FRACTION (0.25 = +25%/bounce), NOT a finished multiplier. Allocates nothing.
 * @param {Object<string, number>|null|undefined} playerStats
 * @returns {number} finite in [0, RICOCHET_DMG_PER_BOUNCE_MAX]
 */
export function sanitizeDmgPerBounce(playerStats) {
  if (playerStats === null || playerStats === undefined) return 0;
  const v = playerStats.ricochetDmgPerBounce;
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > RICOCHET_DMG_PER_BOUNCE_MAX ? RICOCHET_DMG_PER_BOUNCE_MAX : v;
}

/**
 * Read one Ricochet flag off the shared store as a boolean. Enabled ONLY by a finite value
 * >= 1; a missing store/field or junk resolves to false, so a corrupted store can never
 * spuriously enable the enemy-bounce or seek behaviour. Allocates nothing.
 * @param {Object<string, number>|null|undefined} playerStats
 * @param {string} key 'ricochetOffEnemies' | 'ricochetSeek'
 * @returns {boolean}
 */
export function readRicochetFlag(playerStats, key) {
  if (playerStats === null || playerStats === undefined) return false;
  const v = playerStats[key];
  return Number.isFinite(v) && v >= 1;
}

/**
 * Resolve the whole sanitized ricochet parameter set ONCE per tick into a reused `out` object
 * (the FiringSystem owns one instance and passes it every tick — zero per-tick allocation, the
 * `damage`/`ways` convention). Returns `out`.
 * @param {Object<string, number>|null|undefined} playerStats
 * @param {{bouncesRemaining:number, dmgPerBounce:number, bounceOffEnemies:boolean,
 *   seek:boolean}} out Reusable output object.
 * @returns {{bouncesRemaining:number, dmgPerBounce:number, bounceOffEnemies:boolean,
 *   seek:boolean}}
 */
export function resolveRicochetParams(playerStats, out) {
  out.bouncesRemaining = sanitizeBounces(playerStats);
  out.dmgPerBounce = sanitizeDmgPerBounce(playerStats);
  out.bounceOffEnemies = readRicochetFlag(playerStats, 'ricochetOffEnemies');
  out.seek = readRicochetFlag(playerStats, 'ricochetSeek');
  return out;
}

/**
 * Stamp the resolved ricochet params onto a freshly acquired bullet, resetting `bounced` to
 * false. Overwrites every ricochet field so a RECYCLED bullet cannot leak the previous shot's
 * bounce state (the same stamp-at-acquire obligation `damage` documents in entities/Bullet.js).
 * @param {{bouncesRemaining:number, dmgPerBounce:number, bounceOffEnemies:boolean, seek:boolean,
 *   bounced:boolean}} bullet
 * @param {{bouncesRemaining:number, dmgPerBounce:number, bounceOffEnemies:boolean,
 *   seek:boolean}} params
 * @returns {void}
 */
export function stampRicochet(bullet, params) {
  bullet.bouncesRemaining = params.bouncesRemaining;
  bullet.dmgPerBounce = params.dmgPerBounce;
  bullet.bounceOffEnemies = params.bounceOffEnemies;
  bullet.seek = params.seek;
  bullet.bounced = false;
}

/**
 * Grow a bullet's stamped damage MULTIPLICATIVELY by its per-bounce fraction and spend one
 * bounce, marking it bounced. Shared by the wall and enemy reflectors so growth is applied
 * IDENTICALLY (exactly once per reflection event). Mutates the bullet in place.
 * @param {{damage:number, dmgPerBounce:number, bouncesRemaining:number, bounced:boolean}} bullet
 * @returns {void}
 */
function spendBounce(bullet) {
  bullet.damage *= 1 + bullet.dmgPerBounce;
  bullet.bouncesRemaining -= 1;
  bullet.bounced = true;
}

/**
 * Reflect a bullet that has crossed the arena border off the wall(s) it crossed: flip the
 * velocity component for each crossed axis, clamp the bullet's position back onto the border so
 * it cannot re-trigger the SAME crossing next tick, grow its damage, and spend ONE bounce. A
 * CORNER crossing (both x and y borders in one step) flips BOTH components but is still ONE
 * reflection event — one bounce, one growth. Speed is preserved (a reflection is an isometry).
 *
 * Fails SAFE: a bullet with no budget (`bouncesRemaining <= 0`) is NOT mutated and returns
 * false, so the caller releases it — byte-identical to the pre-11.5 border despawn. A reflected
 * bullet returns true (kept alive).
 * @param {{x:number, y:number, vx:number, vy:number, damage:number, dmgPerBounce:number,
 *   bouncesRemaining:number, bounced:boolean}} bullet
 * @returns {boolean} true if the bullet was reflected (kept), false if it has no budget (release).
 */
export function reflectBulletOffWall(bullet) {
  if (!(bullet.bouncesRemaining > 0)) return false;
  const maxX = ARENA_WIDTH - ARENA_BORDER_INSET;
  const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET;
  // Flip + clamp per crossed axis. Both branches can fire in one call (a corner); that is still
  // ONE reflection event, so the growth/decrement below runs exactly once.
  if (bullet.x < ARENA_BORDER_INSET) {
    bullet.x = ARENA_BORDER_INSET;
    bullet.vx = -bullet.vx;
  } else if (bullet.x > maxX) {
    bullet.x = maxX;
    bullet.vx = -bullet.vx;
  }
  if (bullet.y < ARENA_BORDER_INSET) {
    bullet.y = ARENA_BORDER_INSET;
    bullet.vy = -bullet.vy;
  } else if (bullet.y > maxY) {
    bullet.y = maxY;
    bullet.vy = -bullet.vy;
  }
  spendBounce(bullet);
  return true;
}

/**
 * Reflect a bullet off the enemy it hit: mirror its velocity across the enemy's surface normal
 * (the unit vector from the enemy center to the bullet center) via `reflectVelocity`, PUSH the
 * bullet out onto the enemy's surface along that contact normal so it starts the next tick
 * already clear of the overlap band, grow its damage, and spend ONE bounce. Speed is preserved.
 * The push-out matters for a SURVIVING enemy (armored, hp > damage): without it the bullet would
 * still overlap the enemy next tick and re-collide — dealing damage and spending a bounce again
 * (and at Lv5 seek would re-aim straight back into it, drilling one target). For a coincident
 * bullet (degenerate zero normal) the separation direction is the reversed velocity (or +x if the
 * velocity is also zero), a DETERMINISTIC choice rather than leaving it stuck on the enemy.
 * Mutates the bullet in place; allocates nothing (`reflectVelocity` writes into the bullet itself
 * via its `out` form).
 * @param {{x:number, y:number, vx:number, vy:number, radius:number, damage:number,
 *   dmgPerBounce:number, bouncesRemaining:number, bounced:boolean}} bullet
 * @param {{x:number, y:number, radius:number}} enemy
 * @returns {void}
 */
export function reflectBulletOffEnemy(bullet, enemy) {
  const sep = enemy.radius + bullet.radius; // surface-of-contact distance to push out to
  const nx = bullet.x - enemy.x;
  const ny = bullet.y - enemy.y;
  const mag = Math.hypot(nx, ny);
  if (mag > 0) {
    const ux = nx / mag;
    const uy = ny / mag;
    // reflectVelocity reads vx/vy from its first two args (captured before it writes), so
    // passing the bullet as `out` mirrors its velocity in place with no allocation.
    reflectVelocity(bullet.vx, bullet.vy, ux, uy, bullet);
    // Push the bullet out onto the enemy surface along the contact normal, clear of the band.
    bullet.x = enemy.x + ux * sep;
    bullet.y = enemy.y + uy * sep;
  } else {
    // Coincident with the enemy center: no contact normal. Reverse the velocity for a
    // deterministic outbound direction, then push out along it (or +x if the velocity is zero).
    bullet.vx = -bullet.vx;
    bullet.vy = -bullet.vy;
    const vmag = Math.hypot(bullet.vx, bullet.vy);
    if (vmag > 0) {
      bullet.x = enemy.x + (bullet.vx / vmag) * sep;
      bullet.y = enemy.y + (bullet.vy / vmag) * sep;
    } else {
      bullet.x = enemy.x + sep;
      bullet.y = enemy.y;
    }
  }
  spendBounce(bullet);
}
