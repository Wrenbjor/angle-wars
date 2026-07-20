import { describe, it, expect } from 'vitest';
import { buildArenaWorld } from './buildArenaWorld.js';
import { FIXED_STEP_MS } from '../config/constants.js';

// buildArenaWorld wiring coverage. The scene's create() inlines this exact build
// but cannot be unit-tested (it needs a live Phaser context); the factory is the
// Phaser-free seam that makes the load-bearing wiring headlessly assertable. This
// suite pins the currently-correct registration order, the enemyPools/deathPools
// composition, and both late-binds — so a reorder of addSystem calls or a swapped
// pool reference (the drift the deferred work flags) now fails a test.

// The canonical 19-system registration order (spec Design Notes).
const CANONICAL_ORDER = [
  'SimClockSystem',
  'PlayerMovementSystem',
  'FiringSystem',
  'EnemySystem',
  'GreenSquareSystem',
  'PinwheelSystem',
  'SnakeSystem',
  'SpawnDirector',
  'CollisionSystem',
  'ScoringSystem',
  'BlackHoleSystem',
  'BombSystem',
  'ExtraLifeSystem',
  'PlayerDeathSystem',
  'HighScoreSystem',
  'GridFieldSystem',
  'ParticleSystem',
  'ScreenFeedbackSystem',
  'AudioDirectorSystem',
];

// The full set of handles ArenaScene.create() destructures off the factory return
// and assigns onto this.* (src/scenes/ArenaScene.js). The scene cannot be unit-tested,
// so a dropped or renamed return key would surface only as an undefined this.* handle
// crashing the live render loop on the first frame. Pinning the contract here catches
// that drift headlessly.
const RETURN_HANDLES = [
  'world',
  'ship',
  'inputState',
  'scoreState',
  'playerState',
  'enemyPools',
  'deathPools',
  'highScoreStorage',
  'simClock',
  'playerMovementSystem',
  'firingSystem',
  'enemySystem',
  'greenSquareSystem',
  'pinwheelSystem',
  'snakeSystem',
  'spawnDirector',
  'collisionSystem',
  'scoringSystem',
  'blackHoleSystem',
  'bombSystem',
  'extraLifeSystem',
  'playerDeathSystem',
  'highScoreSystem',
  'gridFieldSystem',
  'particleSystem',
  'screenFeedbackSystem',
  'audioDirector',
];

describe('buildArenaWorld — ordered-system factory wiring', () => {
  it('exposes every handle the scene render loop consumes (no dropped/renamed return key)', () => {
    const ctx = buildArenaWorld();
    for (const key of RETURN_HANDLES) {
      expect(ctx[key], `factory return is missing handle "${key}"`).toBeDefined();
    }
  });

  it('registers the 19 systems in the canonical order (no-arg build, node env)', () => {
    const ctx = buildArenaWorld();
    expect(ctx.world.systems.map((s) => s.constructor.name)).toEqual(
      CANONICAL_ORDER,
    );
  });

  it('does not throw with no args and defaults the high-score port', () => {
    let ctx;
    expect(() => {
      ctx = buildArenaWorld();
    }).not.toThrow();
    // createHighScoreStorage() returns a guarded port with load/save (no-ops when
    // localStorage is absent, as in the node env) — never undefined.
    expect(typeof ctx.highScoreStorage.load).toBe('function');
    expect(typeof ctx.highScoreStorage.save).toBe('function');
    expect(ctx.highScoreSystem.storage).toBe(ctx.highScoreStorage);
  });

  it('builds enemyPools as the 4 archetype pools, identity-matched to each system', () => {
    const ctx = buildArenaWorld();
    expect(ctx.enemyPools).toHaveLength(4);
    expect(ctx.enemyPools[0]).toBe(ctx.enemySystem.enemyPool);
    expect(ctx.enemyPools[1]).toBe(ctx.greenSquareSystem.enemyPool);
    expect(ctx.enemyPools[2]).toBe(ctx.pinwheelSystem.enemyPool);
    expect(ctx.enemyPools[3]).toBe(ctx.snakeSystem.enemyPool);
  });

  it('builds deathPools as [...enemyPools, holePool] — the hole pool appended, not inside enemyPools', () => {
    const ctx = buildArenaWorld();
    expect(ctx.deathPools).toEqual([
      ...ctx.enemyPools,
      ctx.blackHoleSystem.holePool,
    ]);
    // Last entry is the hole pool…
    expect(ctx.deathPools[ctx.deathPools.length - 1]).toBe(
      ctx.blackHoleSystem.holePool,
    );
    // …and the hole pool is NOT among the four archetype enemyPools (one bullet
    // must not one-shot a multi-hit hole via the collision list).
    expect(ctx.enemyPools).not.toContain(ctx.blackHoleSystem.holePool);
  });

  it('applies both load-bearing late-binds to the same collisionSystem', () => {
    const ctx = buildArenaWorld();
    expect(ctx.snakeSystem.collisionSystem).toBe(ctx.collisionSystem);
    expect(ctx.blackHoleSystem.collisionSystem).toBe(ctx.collisionSystem);
  });

  it('constructs the collisionSystem over enemyPools (not deathPools)', () => {
    const ctx = buildArenaWorld();
    // CollisionSystem holds the array of archetype pools it scans; it must be the
    // same enemyPools array the factory returns (the hole pool is deliberately
    // excluded so a bullet cannot one-shot the hole).
    expect(ctx.collisionSystem.enemyPools).toBe(ctx.enemyPools);
  });

  it('honors an injected rng — every rng-taking system receives it', () => {
    const rng = () => 0.42;
    const ctx = buildArenaWorld({ rng });
    expect(ctx.enemySystem._rng).toBe(rng);
    expect(ctx.greenSquareSystem._rng).toBe(rng);
    expect(ctx.pinwheelSystem._rng).toBe(rng);
    expect(ctx.snakeSystem._rng).toBe(rng);
    expect(ctx.spawnDirector._rng).toBe(rng);
    expect(ctx.blackHoleSystem._rng).toBe(rng);
    expect(ctx.particleSystem.rng).toBe(rng);
  });

  it('survives a headless run — ticking the assembled world does not throw', () => {
    const { world } = buildArenaWorld({ rng: () => 0.5 });
    expect(() => {
      for (let i = 0; i < 120; i++) world.fixedUpdate(FIXED_STEP_MS);
    }).not.toThrow();
  });

  it('honors an injected high-score port', () => {
    const highScoreStorage = { load: () => 1234, save: () => {} };
    const ctx = buildArenaWorld({ highScoreStorage });
    expect(ctx.highScoreStorage).toBe(highScoreStorage);
    expect(ctx.highScoreSystem.storage).toBe(highScoreStorage);
    // The system seeded its display from the injected port's stored high.
    expect(ctx.highScoreSystem.highScore).toBe(1234);
  });
});
