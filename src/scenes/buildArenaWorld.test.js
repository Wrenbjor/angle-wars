import { describe, it, expect } from 'vitest';
import { buildArenaWorld } from './buildArenaWorld.js';
import {
  FIXED_STEP_MS,
  PARTICLE_MAX,
  SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT,
  SPAWN_DIRECTOR_REFLECTOR_PEAK_WEIGHT,
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
} from '../config/constants.js';

// buildArenaWorld wiring coverage. The scene's create() inlines this exact build
// but cannot be unit-tested (it needs a live Phaser context); the factory is the
// Phaser-free seam that makes the load-bearing wiring headlessly assertable. This
// suite pins the currently-correct registration order, the enemyPools/deathPools
// composition, and both late-binds — so a reorder of addSystem calls or a swapped
// pool reference (the drift the deferred work flags) now fails a test.

// The canonical 24-system registration order (spec Design Notes; Story 6.3 added
// MirrorReflectorSystem in the enemy section, after SnakeSystem and before SpawnDirector;
// Story 8.1 added XpOrbSystem right after the BombSystem late-bind; Story 8.2 added
// LevelSystem right after XpOrbSystem; Story 8.3 added LevelUpSystem right after
// LevelSystem, before PlayerDeathSystem; Story 9.1 added DpsTelemetrySystem right
// after ScoringSystem, before BlackHoleSystem).
const CANONICAL_ORDER = [
  'SimClockSystem',
  'PlayerMovementSystem',
  'FiringSystem',
  'EnemySystem',
  'GreenSquareSystem',
  'PinwheelSystem',
  'SnakeSystem',
  'MirrorReflectorSystem',
  'SpawnDirector',
  'CollisionSystem',
  'ScoringSystem',
  'DpsTelemetrySystem',
  'BlackHoleSystem',
  'BombSystem',
  'XpOrbSystem',
  'LevelSystem',
  'LevelUpSystem',
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
  'progressionState',
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
  'mirrorReflectorSystem',
  'spawnDirector',
  'collisionSystem',
  'scoringSystem',
  'dpsTelemetrySystem',
  'blackHoleSystem',
  'bombSystem',
  'xpOrbSystem',
  'levelSystem',
  'levelUpSystem',
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

  it('registers the 24 systems in the canonical order (no-arg build, node env)', () => {
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

  it('wires the Mirror Reflector (Story 6.3): 5th spawnable, pool absent from enemyPools/deathPools, shared state', () => {
    const ctx = buildArenaWorld();
    // Returned as its own handle.
    expect(ctx.mirrorReflectorSystem).toBeDefined();
    // The reflector pool is deliberately in NEITHER shared circle-collision list — it
    // is immune to gunfire (CollisionSystem), bombs (BombSystem clears enemyPools), and
    // black-hole absorption, and its lethal region is the weights, not a uniform circle.
    expect(ctx.enemyPools).not.toContain(ctx.mirrorReflectorSystem.enemyPool);
    expect(ctx.deathPools).not.toContain(ctx.mirrorReflectorSystem.enemyPool);
    // The reflector is the FIFTH governed SpawnDirector spawnable, so it spawns through
    // the same director + telegraph and counts toward the global cap.
    const spawnables = ctx.spawnDirector._spawnables;
    expect(spawnables).toHaveLength(5);
    expect(spawnables[4].system).toBe(ctx.mirrorReflectorSystem);
    // …wired with its centralized base/peak mix weights (so the director interpolates
    // the reflector's share correctly across the difficulty ramp).
    expect(spawnables[4].baseWeight).toBe(SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT);
    expect(spawnables[4].peakWeight).toBe(SPAWN_DIRECTOR_REFLECTOR_PEAK_WEIGHT);
    // ship / bulletPool / playerState / scoreState are the SAME shared instances the
    // rest of the world uses (a center-destroy credits scoreState.score; a weight-kill
    // sets playerState.pendingDeath; the reflect reads the shared bullet pool).
    expect(ctx.mirrorReflectorSystem.ship).toBe(ctx.ship);
    expect(ctx.mirrorReflectorSystem.bulletPool).toBe(ctx.firingSystem.bulletPool);
    expect(ctx.mirrorReflectorSystem.playerState).toBe(ctx.playerState);
    expect(ctx.mirrorReflectorSystem.scoreState).toBe(ctx.scoreState);
  });

  it('wires the DpsTelemetrySystem (Story 9.1) over the shared collisionSystem, dps starting at 0', () => {
    const ctx = buildArenaWorld();
    // Returned as its own handle.
    expect(ctx.dpsTelemetrySystem).toBeDefined();
    // Its telemetry source is the SAME shared collision system the rest of the
    // world uses — it reads that seam's latched per-tick bulletKillCount.
    expect(ctx.dpsTelemetrySystem.collisionSystem).toBe(ctx.collisionSystem);
    // Fresh build: the rolling estimate starts empty.
    expect(ctx.dpsTelemetrySystem.dps).toBe(0);
  });

  it('wires the XpOrbSystem (Story 8.1) with the shared drop-report sources + ship + scoreState', () => {
    const ctx = buildArenaWorld();
    // Returned as its own handle.
    expect(ctx.xpOrbSystem).toBeDefined();
    // Its three drop-report sources are the SAME shared system instances the rest of
    // the world uses (bullet-kill snapshots, defuse report, center-kill report), so it
    // reads each seam's this-tick report directly.
    expect(ctx.xpOrbSystem.collisionSystem).toBe(ctx.collisionSystem);
    expect(ctx.xpOrbSystem.blackHoleSystem).toBe(ctx.blackHoleSystem);
    expect(ctx.xpOrbSystem.mirrorReflectorSystem).toBe(ctx.mirrorReflectorSystem);
    // ship / scoreState are the SAME shared instances (drift/collect distance reads the
    // ship; a collect credits scoreState.xp).
    expect(ctx.xpOrbSystem.ship).toBe(ctx.ship);
    expect(ctx.xpOrbSystem.scoreState).toBe(ctx.scoreState);
  });

  it('wires the LevelSystem (Story 8.2) with the shared scoreState, starting at level 1', () => {
    const ctx = buildArenaWorld();
    // Returned as its own handle.
    expect(ctx.levelSystem).toBeDefined();
    // It derives the level from the SAME shared scoreState the rest of the world's
    // XP economy writes (read-only here — no scoreState.level field).
    expect(ctx.levelSystem.scoreState).toBe(ctx.scoreState);
    // Fresh run starts at level 1.
    expect(ctx.levelSystem.level).toBe(1);
  });

  it('wires the LevelUpSystem (Story 8.3) with the shared levelSystem / playerState / progressionState', () => {
    const ctx = buildArenaWorld();
    // Returned as its own handle.
    expect(ctx.levelUpSystem).toBeDefined();
    // Its three refs are the SAME shared instances the rest of the world uses: it
    // edge-detects levelSystem.levelsGainedThisTick, re-arms playerState.invulnMs, and
    // applies a picked card to progressionState.
    expect(ctx.levelUpSystem.levelSystem).toBe(ctx.levelSystem);
    expect(ctx.levelUpSystem.playerState).toBe(ctx.playerState);
    expect(ctx.levelUpSystem.progressionState).toBe(ctx.progressionState);
    // Fresh run: run-scoped progression starts empty (rebuilt fresh per run, never
    // reset on death — mirrors scoreState.xp), with the Story 8.5 reroll/banish charge
    // economies at their starting values and an empty banished set.
    expect(ctx.progressionState.ownedCards).toEqual({});
    expect(ctx.progressionState.debugStat).toBe(0);
    expect(ctx.progressionState.rerollCharges).toBe(REROLL_INITIAL_CHARGES);
    expect(ctx.progressionState.banishCharges).toBe(BANISH_INITIAL_CHARGES);
    expect(ctx.progressionState.banishedIds).toBeInstanceOf(Set);
    expect(ctx.progressionState.banishedIds.size).toBe(0);
  });

  it('applies both load-bearing collision late-binds to the same collisionSystem', () => {
    const ctx = buildArenaWorld();
    expect(ctx.snakeSystem.collisionSystem).toBe(ctx.collisionSystem);
    expect(ctx.blackHoleSystem.collisionSystem).toBe(ctx.collisionSystem);
  });

  it('late-binds the bombSystem into the BlackHoleSystem (Story 6.2 detonation screen clear)', () => {
    const ctx = buildArenaWorld();
    // The hole detonation reuses bombSystem.detonateAt; the bomb system is
    // constructed after the black-hole system, so it must be late-bound in.
    expect(ctx.blackHoleSystem.bombSystem).toBe(ctx.bombSystem);
  });

  it('shares the one playerState into BOTH the BlackHoleSystem and the PlayerDeathSystem (Story 6.2)', () => {
    const ctx = buildArenaWorld();
    // A detonation sets playerState.pendingDeath (BlackHoleSystem) and the death
    // system consumes it — they must be the SAME instance, and the same one the
    // factory returns.
    expect(ctx.blackHoleSystem.playerState).toBe(ctx.playerState);
    expect(ctx.playerDeathSystem.playerState).toBe(ctx.playerState);
  });

  it('wires the AudioDirectorSystem with the BlackHoleSystem urgency source (Story 6.2)', () => {
    const ctx = buildArenaWorld();
    expect(ctx.audioDirector.blackHoleSystem).toBe(ctx.blackHoleSystem);
  });

  it('threads the ExtraLifeSystem into the ScreenFeedbackSystem (Story 7.5 haptic edge)', () => {
    const ctx = buildArenaWorld();
    // The extra-life LIGHT haptic pulse depends on ScreenFeedbackSystem edge-detecting
    // ExtraLifeSystem.awardSeq — so the 6th constructor arg must be the SAME instance.
    // Without this, dropping/reordering/nulling it would silently kill the pulse.
    expect(ctx.screenFeedbackSystem.extraLifeSystem).toBe(ctx.extraLifeSystem);
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
    expect(ctx.mirrorReflectorSystem._rng).toBe(rng);
    expect(ctx.spawnDirector._rng).toBe(rng);
    expect(ctx.blackHoleSystem._rng).toBe(rng);
    expect(ctx.particleSystem.rng).toBe(rng);
    expect(ctx.levelUpSystem._rng).toBe(rng);
  });

  it('survives a headless run — ticking the assembled world does not throw', () => {
    const { world } = buildArenaWorld({ rng: () => 0.5 });
    expect(() => {
      for (let i = 0; i < 120; i++) world.fixedUpdate(FIXED_STEP_MS);
    }).not.toThrow();
  });

  it('threads an injected particleMax into the ParticleSystem cap (Story 7.4)', () => {
    const ctx = buildArenaWorld({ particleMax: 300 });
    expect(ctx.particleSystem.maxParticles).toBe(300);
  });

  it('defaults the ParticleSystem cap to PARTICLE_MAX when particleMax is omitted', () => {
    const ctx = buildArenaWorld();
    expect(ctx.particleSystem.maxParticles).toBe(PARTICLE_MAX);
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
