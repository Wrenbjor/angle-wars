import { describe, it, expect } from 'vitest';
import { LevelSystem, xpToNextLevel } from './LevelSystem.js';
import { LEVEL_MAX } from '../config/constants.js';

// Story 8.2 — the leveling spine. The system DERIVES level + in-level progress
// purely from scoreState.xp each tick, so every case here drives a plain {xp} stub
// (no Phaser, no World) and asserts the public fields after one fixedUpdate().

// A minimal scoreState stand-in: LevelSystem reads only `.xp`.
function stub(xp = 0) {
  return { xp };
}

describe('xpToNextLevel — the per-level XP curve', () => {
  it('gives the specified early-level gate values', () => {
    // need(n) = 8 + 6n + 0.55n²
    expect(xpToNextLevel(1)).toBeCloseTo(14.55, 10); // 8 + 6 + 0.55
    expect(xpToNextLevel(2)).toBeCloseTo(22.2, 10); // 8 + 12 + 2.2
  });

  it('is monotonically increasing (quadratic term dominates)', () => {
    expect(xpToNextLevel(29)).toBeCloseTo(8 + 6 * 29 + 0.55 * 29 * 29, 10);
    expect(xpToNextLevel(29)).toBeGreaterThan(xpToNextLevel(2));
  });
});

describe('LevelSystem — derived level + progress from scoreState.xp', () => {
  it('fresh run (xp 0): level 1, no progress, not at cap', () => {
    const sys = new LevelSystem(stub(0));
    sys.fixedUpdate();
    expect(sys.level).toBe(1);
    expect(sys.xpIntoLevel).toBe(0);
    expect(sys.xpToNext).toBeCloseTo(14.55, 10);
    expect(sys.atCap).toBe(false);
    expect(sys.levelsGainedThisTick).toBe(0);
  });

  it('sub-threshold (xp 10): stays level 1, progress accrues', () => {
    const sys = new LevelSystem(stub(10));
    sys.fixedUpdate();
    expect(sys.level).toBe(1);
    expect(sys.xpIntoLevel).toBeCloseTo(10, 10);
    expect(sys.xpToNext).toBeCloseTo(14.55, 10);
    expect(sys.levelsGainedThisTick).toBe(0);
  });

  it('one level with remainder carry (xp 20): level 2, carries 5.45', () => {
    const sys = new LevelSystem(stub(20));
    sys.fixedUpdate();
    expect(sys.level).toBe(2);
    expect(sys.xpIntoLevel).toBeCloseTo(20 - 14.55, 10); // 5.45
    expect(sys.xpToNext).toBeCloseTo(22.2, 10);
    expect(sys.atCap).toBe(false);
    expect(sys.levelsGainedThisTick).toBe(1);
  });

  it('exactly at threshold (xp 14.55): >= levels up, zero into next', () => {
    const sys = new LevelSystem(stub(14.55));
    sys.fixedUpdate();
    expect(sys.level).toBe(2);
    expect(sys.xpIntoLevel).toBeCloseTo(0, 10);
    expect(sys.levelsGainedThisTick).toBe(1);
  });

  it('multi-level in one tick (xp 40): level 3, remainder carries, delta = jump', () => {
    // 40 ≥ 14.55 + 22.2 = 36.75, but < 36.75 + need(3)=30.95 → stops at level 3.
    const sys = new LevelSystem(stub(40));
    sys.fixedUpdate();
    expect(sys.level).toBe(3);
    expect(sys.xpIntoLevel).toBeCloseTo(40 - (14.55 + 22.2), 10); // 3.25
    expect(sys.levelsGainedThisTick).toBe(2); // crossed 1→2→3 on this first tick
  });

  it('at cap (huge xp): clamps at LEVEL_MAX, atCap true, further xp inert', () => {
    const sys = new LevelSystem(stub(1e9));
    sys.fixedUpdate();
    expect(sys.level).toBe(LEVEL_MAX);
    expect(sys.level).toBe(30);
    expect(sys.atCap).toBe(true);
    expect(sys.xpIntoLevel).toBe(0);
    expect(sys.xpToNext).toBe(0);
    // No threshold consumed past the cap — even more xp changes nothing.
    sys.scoreState.xp = 1e12;
    sys.fixedUpdate();
    expect(sys.level).toBe(30);
    expect(sys.atCap).toBe(true);
    expect(sys.levelsGainedThisTick).toBe(0); // already at cap last tick
  });

  // The exact XP total to ARRIVE at level 30 = Σ need(1..29). Boundary-tests the
  // `level < LEVEL_MAX` reporting branch (an off-by-one there would slip past the
  // 1e9/1e12 cases above, which are both deep past the cap).
  const capSum = Array.from({ length: 29 }, (_, i) =>
    xpToNextLevel(i + 1),
  ).reduce((a, b) => a + b, 0);

  it('just below cap (capSum − 1): level 29, not at cap, progress accrues into 30', () => {
    const sys = new LevelSystem(stub(capSum - 1));
    sys.fixedUpdate();
    expect(sys.level).toBe(29);
    expect(sys.atCap).toBe(false);
    expect(sys.xpToNext).toBeCloseTo(xpToNextLevel(29), 10);
    expect(sys.xpIntoLevel).toBeGreaterThan(0);
  });

  it('exact cap arrival (capSum): level 30, at cap, no in-level progress', () => {
    const sys = new LevelSystem(stub(capSum));
    sys.fixedUpdate();
    expect(sys.level).toBe(30);
    expect(sys.atCap).toBe(true);
    expect(sys.xpIntoLevel).toBe(0);
    expect(sys.xpToNext).toBe(0);
  });

  it('idempotent re-derivation: same xp twice ⇒ levelsGainedThisTick 0 on the 2nd tick', () => {
    const s = stub(20);
    const sys = new LevelSystem(s);
    sys.fixedUpdate();
    expect(sys.level).toBe(2);
    expect(sys.levelsGainedThisTick).toBe(1);
    // xp unchanged (e.g. a non-final death leaves it intact): re-deriving is stable.
    sys.fixedUpdate();
    expect(sys.level).toBe(2);
    expect(sys.xpIntoLevel).toBeCloseTo(5.45, 10);
    expect(sys.levelsGainedThisTick).toBe(0);
  });

  it('persist across a non-final death: xp intact ⇒ level/progress unchanged', () => {
    const s = stub(40);
    const sys = new LevelSystem(s);
    sys.fixedUpdate();
    const beforeLevel = sys.level;
    const beforeInto = sys.xpIntoLevel;
    // Death does not touch scoreState.xp; subsequent ticks re-derive the same state.
    sys.fixedUpdate();
    expect(sys.level).toBe(beforeLevel);
    expect(sys.xpIntoLevel).toBeCloseTo(beforeInto, 10);
    expect(sys.levelsGainedThisTick).toBe(0);
  });
});
