// telegraphCue — pure, Phaser-free spawn-telegraph render-cue math (Story 2.6).
//
// The spawn-in fade/scale cue is a view-only mapping from an instance's
// telegraph countdown to a draw alpha + a draw-radius scale. It lives here (NOT
// inline in ArenaScene, which imports Phaser and so cannot be unit-tested) so the
// "visibly warn" mechanism has automated coverage — an inverted mapping would be
// caught rather than shipping silently. ArenaScene imports these and feeds them
// its centralized constants; the rendered output is identical to the prior inline
// math. Zero allocation — all three are scalar functions.

/**
 * Telegraph render progress for one instance: p in [0,1] where 0 is the instant
 * of spawn and 1 is fully active. p = 1 − clamp(telegraphMs / fullMs, 0, 1).
 * Zero/negative-safe: telegraphMs ≤ 0 → 1 (active, today's rendering); fullMs ≤ 0
 * → 1 (avoid divide-by-zero).
 * @param {number} telegraphMs Remaining telegraph countdown (ms).
 * @param {number} fullMs Full telegraph duration (ms).
 * @returns {number} p in [0,1]
 */
export function spawnTelegraphProgress(telegraphMs, fullMs) {
  if (!(telegraphMs > 0)) return 1; // active (or NaN-safe) → fully drawn
  if (!(fullMs > 0)) return 1; // guard divide-by-zero → fully drawn
  let f = telegraphMs / fullMs;
  if (f > 1) f = 1; // clamp: an overlong countdown never dips below p=0
  return 1 - f;
}

/**
 * Draw alpha from progress: minAlpha at p=0 (just spawned) up to 1 at p=1 (active).
 * @param {number} p Progress in [0,1].
 * @param {number} minAlpha Alpha floor at spawn.
 * @returns {number}
 */
export function telegraphAlpha(p, minAlpha) {
  return minAlpha + (1 - minAlpha) * p;
}

/**
 * Draw-radius scale from progress: minScale at p=0 up to 1 at p=1 (full radius).
 * @param {number} p Progress in [0,1].
 * @param {number} minScale Scale floor at spawn.
 * @returns {number}
 */
export function telegraphScale(p, minScale) {
  return minScale + (1 - minScale) * p;
}
