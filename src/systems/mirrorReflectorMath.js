// mirrorReflectorMath — pure, Phaser-free geometry helpers for the Mirror
// Reflector (dumbbell) hazard (Story 6.3).
//
// These three helpers hold the reflector's genuinely-new collision math so it lives
// in ONE testable seam instead of inline in the (Phaser-coupled) scene or duplicated
// between the system and the renderer:
//   - `reflectorEndpoints` — the two weight endpoints of the spinning bar. Shared by
//     the MirrorReflectorSystem (bullet/ship tests) and ArenaScene (drawing the
//     dumbbell).
//   - `closestPointOnSegment` — the closest point on the bar segment to a bullet, for
//     the bullet↔bar proximity test. Takes an optional `out` object so the hot path
//     can reuse a scratch (zero steady-state allocation); omit it for a fresh object.
//   - `reflectVelocity` — mirror a velocity across a UNIT normal (v − 2(v·n)n),
//     magnitude preserved.
// All are pure functions of their scalar args — no engine dependency, no shared
// state — so they unit-test directly.

/**
 * The two weight endpoints of a reflector's bar: the bar lies along (cos, sin)·angle
 * through the center (x, y); the weights sit at ±halfLen along it. Returns
 * `{ ax, ay, bx, by }` where A is the +axis endpoint and B the −axis endpoint.
 * @param {number} x Center x.
 * @param {number} y Center y.
 * @param {number} angle Spin angle (radians).
 * @param {number} halfLen Bar half-length (center → each weight).
 * @returns {{ax:number, ay:number, bx:number, by:number}}
 */
export function reflectorEndpoints(x, y, angle, halfLen) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    ax: x + c * halfLen,
    ay: y + s * halfLen,
    bx: x - c * halfLen,
    by: y - s * halfLen,
  };
}

/**
 * The point on segment AB closest to P=(px,py). Projects P onto the infinite line
 * through A→B, clamping the projection parameter to [0,1] so the result never leaves
 * the segment (a degenerate zero-length segment returns A). Writes into `out` when
 * provided (zero allocation for the per-tick reflect scan), else returns a fresh
 * object.
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {{x:number, y:number}} [out] Optional reusable output object.
 * @returns {{x:number, y:number}}
 */
export function closestPointOnSegment(px, py, ax, ay, bx, by, out) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const x = ax + abx * t;
  const y = ay + aby * t;
  if (out) {
    out.x = x;
    out.y = y;
    return out;
  }
  return { x, y };
}

/**
 * Mirror a velocity across a UNIT normal n=(nx,ny): v' = v − 2(v·n)n. The magnitude
 * is preserved (a reflection is an isometry). Assumes n is already a unit vector
 * (the reflector always passes its fixed unit bar normal (−sinθ, cosθ), so there is
 * no divide-by-zero and no need to normalize here). A velocity tangential to the bar
 * (v·n == 0) is returned unchanged.
 * Writes into `out` when provided (zero allocation for the per-tick reflect hot
 * path), else returns a fresh object.
 * @param {number} vx
 * @param {number} vy
 * @param {number} nx Unit normal x.
 * @param {number} ny Unit normal y.
 * @param {{vx:number, vy:number}} [out] Optional reusable output object.
 * @returns {{vx:number, vy:number}}
 */
export function reflectVelocity(vx, vy, nx, ny, out) {
  const d = vx * nx + vy * ny;
  const rx = vx - 2 * d * nx;
  const ry = vy - 2 * d * ny;
  if (out) {
    out.vx = rx;
    out.vy = ry;
    return out;
  }
  return { vx: rx, vy: ry };
}
