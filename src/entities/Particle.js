// Particle — the pooled visual-effect particle (plain data, Phaser-free).
//
// Particles are the highest-churn "entity" in the game: bursts spray a dozen-plus
// at a time on every bullet kill and a trail emits continuously behind the moving
// ship. They live in an object Pool (owned by the ParticleSystem), NOT in
// world.entities, so there is no splice/indexOf churn and no gameplay coupling —
// a particle is pure view juice (Story 4.3). This factory only builds an instance
// when the pool cannot recycle a freed one; the ParticleSystem overwrites every
// field on emit, so the zeroed values here are just a well-defined starting shape.
//
// Shape: { x, y, vx, vy, ageMs, lifeMs, size, color }
//  - x, y    : position (px, arena/logical space)
//  - vx, vy  : velocity (px/s) — integrated each fixed step and decayed by drag
//  - ageMs   : elapsed lifetime (ms); the slot frees once ageMs >= lifeMs
//  - lifeMs  : total lifetime (ms) before the particle expires
//  - size    : draw radius (px) for the additive neon dot
//  - color   : fill color (0xRRGGBB) for the additive neon dot

/**
 * Create a zeroed particle. Used as the Pool factory; every field is overwritten
 * on emit by the ParticleSystem.
 * @returns {{x:number, y:number, vx:number, vy:number, ageMs:number, lifeMs:number, size:number, color:number}}
 */
export function createParticle() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ageMs: 0,
    lifeMs: 0,
    size: 0,
    color: 0,
  };
}
