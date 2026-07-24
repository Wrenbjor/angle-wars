import {
  FLAK_FRAGMENT_RADIUS,
  FLAK_FRAGMENT_BASE_DAMAGE,
  FLAK_FRAGMENT_LIFETIME_MS,
} from '../config/constants.js';

/**
 * FlakFragment — pooled entity for Flak Burst radial fragments (Story 11.6).
 *
 * Shape: { x, y, vx, vy, radius, damage, lifetimeMs, canAirburst }
 * @returns {{x:number, y:number, vx:number, vy:number, radius:number, damage:number, lifetimeMs:number, canAirburst:boolean}}
 */
export function createFlakFragment() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: FLAK_FRAGMENT_RADIUS,
    damage: FLAK_FRAGMENT_BASE_DAMAGE,
    lifetimeMs: FLAK_FRAGMENT_LIFETIME_MS,
    canAirburst: false,
  };
}
