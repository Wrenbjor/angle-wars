import { BULLET_RADIUS, PLAYER_BULLET_BASE_DAMAGE } from '../config/constants.js';

// Bullet — the pooled high-churn entity (plain data, Phaser-free).
//
// Bullets are the single highest-churn entity in the game: spawned and
// despawned many times per second. They live in an object Pool (owned by the
// FiringSystem), NOT in world.entities, so there is no splice/indexOf churn.
// This factory only builds an instance when the pool cannot recycle a freed
// one; the FiringSystem (re)initializes the fields in place on every acquire,
// so the zeroed values here are just a well-defined starting shape.
//
// Shape: { x, y, vx, vy, radius, damage, bouncesRemaining, dmgPerBounce,
//          bounceOffEnemies, seek, bounced, pierceRemaining }
//  - x, y   : position (px, arena/logical space)
//  - vx, vy : velocity (px/s) — set from aim direction × BULLET_SPEED
//  - radius : half-extent (px) for the placeholder shape and Story 1.4
//             collision. NOT the spawn nose offset — the FiringSystem spawns
//             bullets from the ship's radius (SHIP_RADIUS), not this.
//  - damage : damage dealt to a finite-`hp` enemy; stamped per spawn by
//             `FiringSystem` from `base × damageMult` (Story 10.2). Carried on the
//             instance so an in-flight bullet keeps the damage it was FIRED with —
//             a mid-run upgrade never retroactively strengthens bullets already on
//             screen.
//  - bouncesRemaining / dmgPerBounce / bounceOffEnemies / seek : the Ricochet Rounds
//             parameters (Story 11.5), STAMPED per spawn by `FiringSystem` from the LIVE
//             ricochet fold (systems/ricochet.js `stampRicochet`), for exactly the reason
//             `damage` is: an in-flight bullet keeps the bounce behaviour it was fired with,
//             and the unowned path is a pure `bouncesRemaining === 0` check with no live-store
//             read in the hot advance/collision loops. `bouncesRemaining` is the OWNERSHIP GATE
//             — a bullet stamped with 0 despawns at the border and is consumed on its first hit
//             exactly as pre-11.5.
//  - bounced : runtime flag set true by the FIRST wall/enemy reflection (also reset to false by
//             `stampRicochet` on every spawn), gating the Lv5 seek re-aim (only a bullet that has
//             bounced seeks) and the bounced-bullet render tint (COLOR_RICOCHET).
//
//             The value set below is ONLY the cold-instance default: the Pool
//             factory runs on a COLD acquire, and `Pool.release` resets nothing, so
//             a RECYCLED bullet still carries the PREVIOUS shot's damage until the
//             spawning code overwrites it. `FiringSystem` stamps `damage` on every
//             spawn, which is what makes the field correct in practice.
//
//             ⚠ ANY future bullet source (Story 10.3's Spread Cannon, and anything
//             else acquiring from this pool) MUST stamp `damage` at acquire. A stale
//             carry-over is finite and positive, so it passes `CollisionSystem`'s
//             `Number.isFinite(b.damage) && b.damage > 0` fallback undetected — the
//             collision side CANNOT catch this for you, and the symptom is a bullet
//             silently dealing some earlier shot's damage.
//
//             ⚠ The SAME stamp-at-acquire obligation applies to the FIVE Ricochet fields
//             (Story 11.5): a recycled bullet still carries the PREVIOUS shot's
//             `bouncesRemaining` / `dmgPerBounce` / `bounceOffEnemies` / `seek` / `bounced`
//             until re-stamped, so an unstamped acquire path would leak stale BOUNCE state —
//             an unowned bullet inheriting a prior Lv5 shot's budget would pinball off walls it
//             should despawn at. `FiringSystem` is the SOLE spawner into this pool, and it
//             calls `stampRicochet` on EVERY acquire (base AND spread volley paths), which is
//             what keeps these fields correct in practice.

/**
 * Create a zeroed bullet with its collision radius, base damage, and cold-default Ricochet
 * fields set. Used as the Pool factory (COLD acquires only); fields are overwritten on spawn.
 * The ricochet defaults are the UNOWNED shape (0 budget, no growth, no enemy-bounce, no seek,
 * not yet bounced) so even a foreign/unstamped consumer of a cold bullet sees pre-11.5 behaviour.
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, damage:number,
 *   bouncesRemaining:number, dmgPerBounce:number, bounceOffEnemies:boolean, seek:boolean,
 *   bounced:boolean, pierceRemaining:number}}
 */
export function createBullet() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: BULLET_RADIUS,
    damage: PLAYER_BULLET_BASE_DAMAGE,
    // Ricochet Rounds (Story 11.5) — cold defaults = unowned. Stamped per spawn by
    // FiringSystem's `stampRicochet` from the live ricochet fold.
    bouncesRemaining: 0,
    dmgPerBounce: 0,
    bounceOffEnemies: false,
    seek: false,
    bounced: false,
    // Flak Burst (Story 11.6) — cold defaults = unowned. Stamped per spawn by FiringSystem
    // from the live flak fold.
    isFlak: false,
    flakFragments: 0,
    flakDamageMult: 0,
    flakSecondaryAirburst: 0,
    // Sunburst (Story 12.6) — cold default = 0 (no pierce).
    // >0 means the bullet pierces through enemies, decrementing on each hit.
    // Consumed only when pierceRemaining reaches 0 or it exits the arena.
    pierceRemaining: 0,
  };
}

