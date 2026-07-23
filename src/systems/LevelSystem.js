import { System } from '../core/System.js';
import {
  LEVEL_MAX,
  XP_CURVE_BASE,
  XP_CURVE_LINEAR,
  XP_CURVE_QUAD,
} from '../config/constants.js';

/**
 * The XP → level threshold for a given level: the amount of in-level XP needed to
 * cross FROM `level` INTO the next level. n = the current level (the level being
 * leveled from); the run starts at level 1, so `xpToNextLevel(1)` is the 1→2 gate.
 *
 *   XP_to_next(n) = BASE + LINEAR·n + QUAD·n²
 *
 * Pure (no state), exported for the unit tests and any future readout. e.g.
 * need(1) = 8 + 6 + 0.55 = 14.55; need(2) = 8 + 12 + 2.2 = 22.2.
 *
 * @param {number} level The current level (leveled from).
 * @returns {number} The in-level XP required to reach the next level.
 */
export function xpToNextLevel(level) {
  return XP_CURVE_BASE + XP_CURVE_LINEAR * level + XP_CURVE_QUAD * level * level;
}

// LevelSystem — the leveling spine of the Epic 8 level-up loop (Story 8.2, Phaser-free).
//
// Story 8.1 gave the run a monotonic cumulative XP total (`scoreState.xp`); this
// system is the first consumer. Each fixed tick it DERIVES the player's current
// level and in-level progress purely from `scoreState.xp` — it holds no accumulated
// per-tick delta state that could drift. Because the per-level thresholds are fixed
// and the XP total only grows, level + in-level remainder are a pure function of the
// total: walk the curve from level 1, subtracting each threshold the total clears,
// until the remainder falls short or the cap is hit.
//
// Strictly additive: it READS `scoreState.xp` and writes only its own public fields.
// It never mutates `scoreState` (no `level` field there — 8.1's XP contract and tests
// stay intact), touches no v1 loop behavior, and introduces no RNG. Death-persistence
// and fresh-run-reset come for free: `scoreState.xp` is run-scoped (never reset on a
// non-final death, rebuilt to 0 on a fresh run), so the derived level follows it.
//
// Public derived state (recomputed every tick):
//   - level              current level, 1 .. LEVEL_MAX
//   - xpIntoLevel        XP accumulated into the current level (0 at the cap)
//   - xpToNext           XP needed to reach the next level (0 at the cap)
//   - atCap              true once level === LEVEL_MAX (further XP inert)
//   - levelsGainedThisTick  # of levels crossed on THIS tick (≥0) — the forward seam
//     Story 8.3's level-up moment (time dilation / invulnerability / card UI) will
//     edge-detect. 8.2 computes it but does NOT act on it.
//
// Zero per-tick allocation: the derivation loop uses locals only and runs ≤29
// iterations (bounded by LEVEL_MAX). Mirrors XpOrbSystem's discipline (own public
// fields only, no allocation on the hot path).
export class LevelSystem extends System {
  /**
   * @param {{xp:number}} scoreState Shared run economy — read-only here. The current
   *   level is derived from `scoreState.xp` each tick; this system never writes it.
   */
  constructor(scoreState) {
    super();
    this.scoreState = scoreState;
    // Derived public state (fresh run: level 1, no progress, cap not reached).
    this.level = 1;
    this.xpIntoLevel = 0;
    this.xpToNext = xpToNextLevel(1);
    this.atCap = false;
    // Levels crossed on the most recent tick — the 8.3 edge-detect seam (0 to start).
    this.levelsGainedThisTick = 0;
    // Previous tick's level, for the per-tick delta above (starts at the run start).
    this._prevLevel = 1;
  }

  /**
   * Re-derive level + in-level progress from `scoreState.xp`. Walks the fixed curve
   * from level 1, carrying the remainder, stopping at LEVEL_MAX. Locals only — no
   * allocation, ≤29 iterations.
   */
  fixedUpdate() {
    let level = 1;
    let into = this.scoreState.xp;
    // Hoist the threshold: evaluate the curve once per iteration and reuse it in
    // both the comparison and the subtraction (same value, one call).
    let need = xpToNextLevel(level);
    while (level < LEVEL_MAX && into >= need) {
      into -= need;
      level++;
      need = xpToNextLevel(level);
    }

    this.level = level;
    if (level < LEVEL_MAX) {
      this.atCap = false;
      this.xpIntoLevel = into;
      this.xpToNext = xpToNextLevel(level);
    } else {
      // At the cap: leveling stops, additional XP is inert. No in-level progress.
      this.atCap = true;
      this.xpIntoLevel = 0;
      this.xpToNext = 0;
    }

    this.levelsGainedThisTick = level - this._prevLevel;
    this._prevLevel = level;
  }
}
