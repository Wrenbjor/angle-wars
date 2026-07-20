// particleStyle — pure, Phaser-free particle render-cue math (Story 4.3).
//
// A particle fades out over its life: it draws at full alpha the instant it is
// emitted and vanishes as it reaches its lifetime. That age→alpha mapping lives
// here (NOT inline in ArenaScene, which imports Phaser and so cannot be
// unit-tested) so the fade has automated coverage — an inverted or unclamped
// curve would be caught rather than shipping silently. ArenaScene imports this and
// feeds it each live particle's ageMs/lifeMs. Zero allocation — a scalar function.
// Imports NO Phaser (mirrors telegraphCue.js / neonStyle.js).

/**
 * Draw alpha for one particle: 1 at age 0 (just emitted), falling linearly to 0
 * at age >= lifeMs (fully faded), clamped to [0, 1]. Tolerates age > life (stays
 * clamped at 0) and a non-positive lifeMs (treated as already expired → 0) so a
 * degenerate particle never yields a negative or NaN alpha.
 * @param {number} ageMs Elapsed particle lifetime (ms).
 * @param {number} lifeMs Total particle lifetime (ms).
 * @returns {number} alpha in [0, 1]
 */
export function particleAlpha(ageMs, lifeMs) {
  if (!(lifeMs > 0)) return 0; // guard divide-by-zero / degenerate → fully faded
  let a = 1 - ageMs / lifeMs;
  if (a < 0) a = 0; // age >= life (or beyond) → fully faded
  else if (a > 1) a = 1; // age < 0 (shouldn't happen) → clamp to full
  return a;
}
