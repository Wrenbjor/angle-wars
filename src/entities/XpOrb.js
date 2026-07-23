// XpOrb — the pooled XP orb (plain data, Phaser-free).
//
// Orbs are a high-churn "entity" (Story 8.1): one drops on every scored enemy
// death and each is released back to the pool the instant the ship collects it.
// They live in an object Pool (owned by the XpOrbSystem), NOT in world.entities,
// so there is no splice/indexOf churn and no gameplay coupling — an orb is pure
// progression currency. This factory only builds an instance when the pool cannot
// recycle a freed one; the XpOrbSystem overwrites every field on spawn, so the
// zeroed values here are just a well-defined starting shape.
//
// Shape: { x, y, value }
//  - x, y  : position (px, arena/logical space)
//  - value : the XP this orb credits on pickup (a per-type base — the collect
//            credit scales it by the current multiplier at collect time)

/**
 * Create a zeroed XP orb. Used as the Pool factory; every field is overwritten
 * on spawn by the XpOrbSystem.
 * @returns {{x:number, y:number, value:number}}
 */
export function createXpOrb() {
  return {
    x: 0,
    y: 0,
    value: 0,
  };
}
