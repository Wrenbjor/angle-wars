import { describe, it, expect } from 'vitest';
import { buildArenaWorld } from './buildArenaWorld.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import { PLAYER_STATS_BASE, recomputePlayerStats } from '../state/PlayerStats.js';
import {
  FIRE_INTERVAL_MS,
  PLAYER_BULLET_BASE_DAMAGE,
  FIXED_STEP_MS,
  PARTICLE_MAX,
  SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT,
  SPAWN_DIRECTOR_REFLECTOR_PEAK_WEIGHT,
  SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT,
  SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT,
  ARMORED_HP,
  ARMORED_MIN_ELAPSED_MS,
  REROLL_INITIAL_CHARGES,
  BANISH_INITIAL_CHARGES,
  GOVERNOR_BOOST_DPS,
  GOVERNOR_BOOST_DURATION_MS,
  SPAWN_DIRECTOR_MAX_PRESSURE,
  BULLET_SPEED,
  BULLET_POOL_PREWARM,
  SPREAD_CANNON_GUARANTEE_LEVEL,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
} from '../config/constants.js';
import { xpToNextLevel } from '../systems/LevelSystem.js';

// buildArenaWorld wiring coverage. The scene's create() inlines this exact build
// but cannot be unit-tested (it needs a live Phaser context); the factory is the
// Phaser-free seam that makes the load-bearing wiring headlessly assertable. This
// suite pins the currently-correct registration order, the enemyPools/deathPools
// composition, and both late-binds — so a reorder of addSystem calls or a swapped
// pool reference (the drift the deferred work flags) now fails a test.

// The canonical 25-system registration order (spec Design Notes; Story 6.3 added
// MirrorReflectorSystem in the enemy section, after SnakeSystem and before SpawnDirector;
// Story 8.1 added XpOrbSystem right after the BombSystem late-bind; Story 8.2 added
// LevelSystem right after XpOrbSystem; Story 8.3 added LevelUpSystem right after
// LevelSystem, before PlayerDeathSystem; Story 9.1 added DpsTelemetrySystem right
// after ScoringSystem, before BlackHoleSystem; Story 9.3 added ArmoredSystem in the
// enemy section, after MirrorReflectorSystem and before SpawnDirector).
const CANONICAL_ORDER = [
  'SimClockSystem',
  'PlayerMovementSystem',
  'FiringSystem',
  'EnemySystem',
  'GreenSquareSystem',
  'PinwheelSystem',
  'SnakeSystem',
  'MirrorReflectorSystem',
  'ArmoredSystem',
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
  'playerStats',
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
  'armoredSystem',
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

  it('registers the 25 systems in the canonical order (no-arg build, node env)', () => {
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

  it('builds enemyPools as the 5 archetype pools, identity-matched to each system', () => {
    const ctx = buildArenaWorld();
    expect(ctx.enemyPools).toHaveLength(5);
    expect(ctx.enemyPools[0]).toBe(ctx.enemySystem.enemyPool);
    expect(ctx.enemyPools[1]).toBe(ctx.greenSquareSystem.enemyPool);
    expect(ctx.enemyPools[2]).toBe(ctx.pinwheelSystem.enemyPool);
    expect(ctx.enemyPools[3]).toBe(ctx.snakeSystem.enemyPool);
    // Story 9.3: the armored pool IS a standard circle-collision archetype, so it
    // joins enemyPools (unlike the reflector) — this single addition wires it into
    // the collision seam, both AoE paths, and deathPools.
    expect(ctx.enemyPools[4]).toBe(ctx.armoredSystem.enemyPool);
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
    expect(spawnables).toHaveLength(6);
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
    // Story 9.2 closes the adaptive loop: the SpawnDirector's governor is late-bound
    // to the SAME shared telemetry instance (the director reads its `dps` each tick).
    expect(ctx.spawnDirector.dpsTelemetry).toBe(ctx.dpsTelemetrySystem);
  });

  it('wires the Armored enemy (Story 9.3): 6th spawnable, pool IN enemyPools/deathPools, back-ref late-bound', () => {
    const ctx = buildArenaWorld();
    // Returned as its own handle.
    expect(ctx.armoredSystem).toBeDefined();
    // Unlike the reflector, the armored IS a standard circle-collision archetype, so
    // its pool is in BOTH shared lists (collision one-shots the one-hit archetypes and
    // decrements the armored's hp; the death seam / AoE paths release it unconditionally).
    expect(ctx.enemyPools).toContain(ctx.armoredSystem.enemyPool);
    expect(ctx.deathPools).toContain(ctx.armoredSystem.enemyPool);
    // The armored is the SIXTH governed SpawnDirector spawnable (spawns through the same
    // director + telegraph, counts toward the global cap), with its flat mix weights.
    const spawnables = ctx.spawnDirector._spawnables;
    expect(spawnables).toHaveLength(6);
    expect(spawnables[5].system).toBe(ctx.armoredSystem);
    expect(spawnables[5].baseWeight).toBe(SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT);
    expect(spawnables[5].peakWeight).toBe(SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT);
    // The canSpawn() time/pressure gate reads a LATE-BOUND back-ref to the director —
    // wired AFTER the director is constructed (the same shared instance).
    expect(ctx.armoredSystem.spawnDirector).toBe(ctx.spawnDirector);
    // ship is the SAME shared instance the rest of the world homes/avoids against.
    expect(ctx.armoredSystem.ship).toBe(ctx.ship);
  });

  it('canSpawn() reads the REAL SpawnDirector fields: closed at elapsed 0 / pressure 0, opened at the time gate', () => {
    const ctx = buildArenaWorld();
    // The stub tests (armoredSystem.test.js) pin the gate LOGIC against a fake director;
    // this pins it against the ACTUAL SpawnDirector field names (elapsedMs / pressure),
    // so a future rename of those fields — which the stub would miss — fails HERE.
    // Fresh build: elapsed 0, pressure 0 → gate closed.
    expect(ctx.armoredSystem.canSpawn()).toBe(false);
    // Advance the real director's elapsed clock to the time gate (the getter reads the
    // private accumulator); the armored is now eligible via the time arm.
    ctx.spawnDirector._elapsedMs = ARMORED_MIN_ELAPSED_MS;
    expect(ctx.armoredSystem.canSpawn()).toBe(true);
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
    // Story 10.1: an empty remnant set too.
    expect(ctx.progressionState.remnantIds).toBeInstanceOf(Set);
    expect(ctx.progressionState.remnantIds.size).toBe(0);
  });

  it('wires the LevelUpSystem (Story 10.1) with the shared item registry + playerStats store', () => {
    const ctx = buildArenaWorld();
    // The offer draws from the shipped ITEM_REGISTRY (the ONE definition source), and the
    // runtime modifier store is the SAME instance the factory returns (so the on-pick
    // fold and the item gameplay seams read one store).
    expect(ctx.levelUpSystem.registry).toBe(ITEM_REGISTRY);
    expect(ctx.levelUpSystem.playerStats).toBe(ctx.playerStats);
    // Fresh run: the store is at its base (every field at its base value).
    expect(ctx.playerStats).toEqual({ ...PLAYER_STATS_BASE });
  });

  it('wires the FiringSystem (Story 10.2) with the SAME playerStats instance LevelUpSystem folds', () => {
    const ctx = buildArenaWorld();
    // One store, three holders: the ctx handle, the fold's target, and the firing seam.
    // If the factory ever handed the firing system a copy, a card pick would fold into
    // an object nothing reads and Overcharge would be inert.
    expect(ctx.firingSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.firingSystem.playerStats).toBe(ctx.levelUpSystem.playerStats);
    // At base, the firing seam is exactly the pre-10.2 cadence.
    expect(ctx.firingSystem._fireIntervalMs()).toBe(FIRE_INTERVAL_MS);
  });

  it('an Overcharge fold changes the firing seam through the shared store, with no reconstruction', () => {
    // The end-to-end path this story exists for: registry stats → fold → the ONE store
    // → the firing seam's cadence + stamped bullet damage. Nothing is re-constructed.
    const ctx = buildArenaWorld();
    const firingSystem = ctx.firingSystem;

    // Baseline: hold aim and step the world; the bullet carries the base damage unit
    // and the cadence is the base interval.
    ctx.inputState.setAim(0, 1);
    ctx.world.fixedUpdate(FIXED_STEP_MS);
    let spawned = [];
    firingSystem.bulletPool.forEachActive((b) => spawned.push(b));
    expect(spawned.length).toBeGreaterThan(0);
    for (const b of spawned) expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
    const baseInterval = firingSystem._fireIntervalMs();
    expect(baseInterval).toBe(FIRE_INTERVAL_MS);
    const systemsBefore = ctx.world.systems.slice();

    // The card pick: own Overcharge at Lv5 and fold the REAL registry into the SHARED
    // store, exactly as LevelUpSystem does on a selection.
    ctx.progressionState.ownedCards.overcharge = 5;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );
    expect(ctx.playerStats.damageMult).toBeCloseTo(1.6, 10);
    expect(ctx.playerStats.fireRateMult).toBeCloseTo(1.4, 10);

    // No system was replaced or re-added by the pick — the SAME instances still run.
    // IDENTITY, not deep equality: `toEqual` would deep-walk the live system graph
    // (pools, reusable Maps/Sets, cross-system late-binds) and would happily pass for
    // a freshly constructed but structurally similar replacement — which is exactly
    // the regression this assertion exists to catch.
    expect(ctx.world.systems).toHaveLength(systemsBefore.length);
    systemsBefore.forEach((s, i) => expect(ctx.world.systems[i]).toBe(s));
    // The very same FiringSystem instance now reports the tighter cadence…
    expect(firingSystem._fireIntervalMs()).toBeCloseTo(FIRE_INTERVAL_MS / 1.4, 10);
    expect(firingSystem._fireIntervalMs()).toBeLessThan(baseInterval);

    // …and the NEXT bullets it spawns carry the upgraded damage.
    const before = new Set(spawned);
    // Step the way the REAL loop does: FixedTimestep only ever calls
    // world.fixedUpdate(stepMs), so a single oversized step would exercise a
    // multi-interval-banking path the running game never produces.
    for (let i = 0; i < 4; i++) ctx.world.fixedUpdate(FIXED_STEP_MS);
    spawned = [];
    firingSystem.bulletPool.forEachActive((b) => spawned.push(b));
    const fresh = spawned.filter((b) => !before.has(b));
    expect(fresh.length).toBeGreaterThan(0);
    for (const b of fresh) expect(b.damage).toBeCloseTo(1.6, 10);
  });

  it('kills an armored in FEWER hits at Overcharge Lv5 — through the ASSEMBLED pipeline', () => {
    // The story's headline observable, driven at the surface the intent states it at:
    // a player STAT goes in, an enemy DEATH comes out. Every other test proves one
    // half — FiringSystem's stamp against a hand-built store, or CollisionSystem's
    // decrement against a hand-stamped fixture bullet. No test drove a REAL
    // FiringSystem-spawned bullet into a REAL CollisionSystem, so the join was pinned
    // only by the stamp formula the ladder test re-derives as a literal of its own. If
    // the stamp ever changed shape (rounding, a different base, a per-source
    // multiplier), both halves would stay green while "Overcharge kills armored
    // enemies faster" quietly stopped being true.
    function isActive(pool, target) {
      let found = false;
      pool.forEachActive((e) => {
        if (e === target) found = true;
      });
      return found;
    }

    function hitsToKill(overchargeLevel) {
      const ctx = buildArenaWorld();
      if (overchargeLevel > 0) {
        ctx.progressionState.ownedCards.overcharge = overchargeLevel;
        recomputePlayerStats(
          ctx.levelUpSystem.playerStats,
          ctx.progressionState.ownedCards,
          ITEM_REGISTRY,
        );
      }
      const armored = ctx.armoredSystem.enemyPool.acquire();
      armored.hp = ARMORED_HP;
      ctx.inputState.setAim(0, 1);
      let hits = 0;
      for (let tick = 0; tick < 500; tick++) {
        // Park the armored on the ship's nose so every spawned bullet reaches it, and
        // re-pin it each tick so ArmoredSystem's homing never carries it out of the
        // firing line. Only the DAMAGE PATH is under test here, not pursuit.
        armored.x = ctx.ship.x;
        armored.y = ctx.ship.y + ctx.ship.radius;
        armored.vx = 0;
        armored.vy = 0;
        ctx.world.fixedUpdate(FIXED_STEP_MS);
        hits += ctx.collisionSystem.bulletDamageCount;
        if (!isActive(ctx.armoredSystem.enemyPool, armored)) return hits;
      }
      throw new Error('the armored never died — the damage path is not connected');
    }

    // Base: the pre-10.2 contract, unchanged. Lv5: strictly fewer hits.
    const base = hitsToKill(0);
    const lv5 = hitsToKill(5);
    expect(base).toBe(ARMORED_HP); // 5 hits at 1 damage per hit
    expect(lv5).toBe(Math.ceil(ARMORED_HP / 1.6)); // 4 at damageMult 1.6
    expect(lv5).toBeLessThan(base);
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

  // --- Story 9.4: governor answers a transient power spike end-to-end (DW-368) ---
  // This is the load-bearing integration proof: build the ACTUAL assembled world,
  // fire a large boost through the reusable applyBoost hook, and step the WHOLE
  // world.fixedUpdate loop. Because the boost enters the SAME `dps` the governor
  // already consumes, the telemetry→director loop answers automatically — and a
  // stuck-at-zero governor (the DW-368 risk of the loop never being stepped
  // end-to-end) would fail here instead of shipping green.
  it('answers a transient boost end-to-end then re-settles (Story 9.4 governor validation)', () => {
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    const { world, spawnDirector, dpsTelemetrySystem } = ctx;

    // Fresh build: the assembled loop is at rest — v1 floor, no boost.
    expect(spawnDirector.pressure).toBe(0);
    expect(dpsTelemetrySystem.boostDps).toBe(0);

    // Fire a large transient spike into the SAME dps signal the governor consumes
    // (the reusable hook Epic 13 will drive with these same defaults) — no new
    // director input, no second pressure knob.
    dpsTelemetrySystem.applyBoost(GOVERNOR_BOOST_DPS, GOVERNOR_BOOST_DURATION_MS);

    // Step the WHOLE assembled world across the fade window, tracking peak pressure.
    // Stepping ctx.world.fixedUpdate (not a hand-picked subset) is the whole point:
    // it proves the real telemetry→director wiring is live, not stuck at zero.
    const fadeTicks = Math.ceil(GOVERNOR_BOOST_DURATION_MS / FIXED_STEP_MS);
    let peakPressure = 0;
    for (let t = 0; t < fadeTicks; t++) {
      world.fixedUpdate(FIXED_STEP_MS);
      if (spawnDirector.pressure > peakPressure) {
        peakPressure = spawnDirector.pressure;
      }
    }

    // The director ANSWERED the spike SUBSTANTIVELY: with the shipped
    // GOVERNOR_BOOST_DPS/DURATION over this fade window the observed peak is ≈1.043
    // (≈half of MAX_PRESSURE=2), reached ~tick 313. Assert a robust lower bound well
    // off the floor (0.75) so a stuck/barely-moving governor fails — `> 0` would let
    // a 0.001 twitch pass. Still bounded by the MAX clamp (never unbounded).
    expect(peakPressure).toBeGreaterThan(0.75);
    expect(peakPressure).toBeLessThanOrEqual(SPAWN_DIRECTOR_MAX_PRESSURE);

    // Exactly durationMs of sim time has elapsed → the boost is fully faded, no
    // residue folded into dps.
    expect(dpsTelemetrySystem.boostDps).toBe(0);

    // Let the symmetric slew relax now the boost is gone.
    for (let t = 0; t < fadeTicks; t++) world.fixedUpdate(FIXED_STEP_MS);

    // Re-settled TOWARD THE FLOOR, not merely "dropped a hair": with no residual dps
    // the observed final pressure is exactly 0. Assert it fell well below half the
    // peak AND is approaching the floor (< 0.05) — proving the spike read as a thrill
    // that passed, not a permanent difficulty step. A governor that answered but
    // never relaxed (asymmetric/stuck-high) fails here.
    expect(spawnDirector.pressure).toBeLessThan(peakPressure * 0.5);
    expect(spawnDirector.pressure).toBeLessThan(0.05);
  });
});

describe('buildArenaWorld — Spread Cannon through the ASSEMBLED world (Story 10.3)', () => {
  // The story's headline observable at the surface the intent states it at: a card pick
  // folds the SHARED playerStats, and the very next volley through the REAL FiringSystem
  // fires that level's bullet count across that level's cone.
  //
  // The FIRST test drives the whole chain for real — XP → level crossing → the drawn
  // offer → queueSelection → LevelUpSystem's fold → the volley — so a change to how a
  // selection is applied fails here. The SECOND constructs the Lv5+Lv5 owned state
  // directly: it is a pool-capacity (NFR2) test that needs a maxed build, not a claim
  // about the pick path, and reaching Lv5 on two items through real XP would add a long
  // setup that pins nothing the first test does not already cover.

  // The SIGNED angle (degrees) of a bullet's velocity relative to the aim direction.
  function offsetDeg(bullet, ax, ay) {
    const dx = bullet.vx / BULLET_SPEED;
    const dy = bullet.vy / BULLET_SPEED;
    return (Math.atan2(ax * dy - ay * dx, ax * dx + ay * dy) * 180) / Math.PI;
  }

  function activeBullets(ctx) {
    const out = [];
    ctx.firingSystem.bulletPool.forEachActive((b) => out.push(b));
    return out;
  }

  it('offer → pick → fold → volley: the REAL level-up path yields 3 bullets at −6° / 0° / +6°', () => {
    // The story's headline chain, driven END TO END through the assembled world. Nothing
    // here reimplements the pick: the level crossing comes from real XP through the real
    // LevelSystem, the offer comes from the real LevelUpSystem draw (including the Story
    // 10.3 guarantee), the pick goes through the real queueSelection latch, and the fold
    // is the one LevelUpSystem runs on that selection. A change to how a selection is
    // applied breaks THIS test, which is exactly what a hand-written
    // `ownedCards[id] = 1; recomputePlayerStats(...)` could not do.
    const ctx = buildArenaWorld();
    const ax = 0;
    const ay = 1;

    // Baseline: the assembled world still fires ONE bullet with nothing owned.
    ctx.inputState.setAim(ax, ay);
    ctx.world.fixedUpdate(FIXED_STEP_MS);
    expect(activeBullets(ctx)).toHaveLength(1);
    expect(ctx.firingSystem.volleysFiredCount).toBe(1);
    expect(ctx.firingSystem.shotsFiredCount).toBe(1);
    const systemsBefore = ctx.world.systems.slice();

    // Bank enough REAL xp to cross into the guarantee level, and let LevelSystem derive
    // it. (xp is the run economy the orb pickups feed; the level is a pure function of
    // it, so this is the same input path a played run produces.)
    let need = 0;
    for (let l = 1; l < SPREAD_CANNON_GUARANTEE_LEVEL; l++) need += xpToNextLevel(l);
    ctx.scoreState.xp = need;
    ctx.world.fixedUpdate(FIXED_STEP_MS);
    expect(ctx.levelSystem.level).toBe(SPREAD_CANNON_GUARANTEE_LEVEL);
    expect(ctx.levelUpSystem.pendingSelections).toBeGreaterThanOrEqual(1);

    // The GUARANTEE put Spread Cannon in the offer the real draw produced — the offer the
    // overlay would render. Pick it through the real latch.
    const slot = ctx.levelUpSystem.currentOffer.findIndex(
      (c) => c.id === 'spread-cannon',
    );
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(ctx.playerStats.spreadWays).toBe(0); // not folded yet
    ctx.levelUpSystem.queueSelection(slot);
    ctx.world.fixedUpdate(FIXED_STEP_MS);

    // The real pick recorded ownership and ran the real fold into the SHARED store.
    expect(ctx.progressionState.ownedCards['spread-cannon']).toBe(1);
    expect(ctx.playerStats.spreadWays).toBe(3);
    expect(ctx.playerStats.spreadArcDeg).toBe(12);

    // No system was replaced or re-added by the pick — the SAME instances still run.
    expect(ctx.world.systems).toHaveLength(systemsBefore.length);
    systemsBefore.forEach((s, i) => expect(ctx.world.systems[i]).toBe(s));

    // Step the way the REAL loop does (FixedTimestep only ever calls
    // world.fixedUpdate(stepMs)) until the next volley lands.
    // Derived from the constants, not a magic literal: a volley is due within one
    // interval, so ceil(interval / step) + 1 ticks always contains one. A hardcoded
    // count would start failing as a "the fan is broken" assertion if FIRE_INTERVAL_MS
    // were raised, pointing the next maintainer at FiringSystem instead of the wait.
    const maxWaitTicks = Math.ceil(FIRE_INTERVAL_MS / FIXED_STEP_MS) + 1;
    let volley = [];
    for (let i = 0; i < maxWaitTicks; i++) {
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      if (ctx.firingSystem.volleysFiredCount > 0) {
        // The volley is the LAST shotsFiredCount instances in the pool's active-set
        // order (Set iteration is insertion order, and FiringSystem acquires this
        // volley's bullets last within the tick, in fan order).
        //
        // NOT a set-difference against a pre-tick snapshot: the pool is LIFO
        // (Pool.release pushes, Pool.acquire pops) and FiringSystem releases expired
        // bullets BEFORE it spawns in the same fixedUpdate — so a bullet retired on
        // the volley tick is the FIRST instance the volley re-acquires. It would be
        // present in the snapshot, get filtered out of its own volley, and redden
        // this as `expect([...2 items]).toHaveLength(3)` — an assertion pointing at
        // the spread fan rather than at the identification. That masking depends
        // only on flight time exceeding the wait, so a smaller arena, a faster
        // bullet, or a moved spawn point would expose it.
        const n = ctx.firingSystem.shotsFiredCount;
        volley = activeBullets(ctx).slice(-n);
        break; // stop on the spawn tick — the counters are per-tick latches
      }
    }
    // ONE volley, THREE bullets — the counter split the audio cue depends on.
    expect(ctx.firingSystem.volleysFiredCount).toBe(1);
    expect(ctx.firingSystem.shotsFiredCount).toBe(3);
    expect(volley).toHaveLength(3);

    const offsets = volley.map((b) => offsetDeg(b, ax, ay)).sort((p, q) => p - q);
    expect(offsets[0]).toBeCloseTo(-6, 9);
    expect(offsets[1]).toBeCloseTo(0, 9);
    expect(offsets[2]).toBeCloseTo(6, 9);
    for (const b of volley) {
      // Unit-speed, and the damage stamp the real FiringSystem applied — not re-derived.
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BULLET_SPEED, 9);
      expect(b.damage).toBe(PLAYER_BULLET_BASE_DAMAGE);
    }
  });

  it('Spread Cannon Lv5 + Overcharge Lv5: 9 bullets at 1.95 damage, pool never runs the factory', () => {
    // Seeded: this case asserts an NFR2 pool invariant across 600 ticks of a LIVE world
    // (enemy spawns, black-hole placement, reflector placement all read the injected
    // rng). Left on Math.random the invariant would be checked against a different
    // world every run — detection of a future overrun becomes statistical, i.e. a
    // flaky red on the story's headline invariant that a re-run makes go away.
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ctx.progressionState.ownedCards['spread-cannon'] = 5;
    ctx.progressionState.ownedCards.overcharge = 5;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );
    // The two items stack ADDITIVELY on the shared fire rungs.
    expect(ctx.playerStats.fireRateMult).toBeCloseTo(1.7, 10);
    expect(ctx.playerStats.damageMult).toBeCloseTo(1.95, 10);
    expect(ctx.playerStats.spreadWays).toBe(9);

    const pool = ctx.firingSystem.bulletPool;
    const prewarmTotal = pool.activeCount + pool.freeCount;
    expect(prewarmTotal).toBe(BULLET_POOL_PREWARM);

    ctx.inputState.setAim(0, 1);
    let sawVolley = false;
    let cuedVolleys = 0;
    let cuedFire = 0;
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      if (ctx.firingSystem.volleysFiredCount > 0) {
        sawVolley = true;
        expect(ctx.firingSystem.shotsFiredCount).toBe(
          ctx.firingSystem.volleysFiredCount * 9,
        );
        cuedVolleys += ctx.firingSystem.volleysFiredCount;
      }
      // The fire CUE through the REAL seam: buildArenaWorld constructs the
      // AudioDirectorSystem over this same FiringSystem instance, so consuming the
      // latch here reads what the render loop would play. Asserting it in the
      // assembled world (not against a hand-built {shotsFiredCount, volleysFiredCount}
      // literal) is what makes the counter NAME load-bearing: renaming or dropping
      // volleysFiredCount sends the director down its Number.isFinite fallback to the
      // per-BULLET count, which would make this 9x and fail here instead of silently
      // shipping 9 gunshots per trigger-pull (the story's explicit "Never").
      cuedFire += ctx.audioDirector.consumeSfxRequests().fire;
      // NFR2 through the ASSEMBLED pipeline: no system in the real world order makes the
      // Pool factory run at the worst authorable build. NOTE this is a WIRING check, not
      // a sizing pin — createPlayerShip() spawns at the arena CENTRE (ARENA_WIDTH/2,
      // ARENA_HEIGHT/2) and this aims straight down, so the flight is a half-height run
      // and the measured peak in-flight here is ~63, far under the prewarm. The prewarm's
      // SIZING is pinned in firingSystem.test.js, which fires along the inset diagonal
      // and the arena width.
      expect(pool.activeCount + pool.freeCount).toBe(prewarmTotal);
      peak = Math.max(peak, pool.activeCount);
    }
    expect(sawVolley).toBe(true);
    // ONE gunshot per trigger-pull across the whole run, at 9 bullets per pull.
    expect(cuedVolleys).toBeGreaterThan(0);
    expect(cuedFire).toBe(cuedVolleys);
    // Pin the geometry claim the comment above makes, so it cannot silently drift into
    // a long-flight case (which would make this a sizing pin it is not documented as).
    expect(peak).toBeLessThan(BULLET_POOL_PREWARM / 4);
    for (const b of activeBullets(ctx)) expect(b.damage).toBeCloseTo(1.95, 10);
  });

  it('a 9-way build with mirrors and a black hole live still never runs the pool factory', () => {
    // The prewarm's derivation is a STRAIGHT-LINE flight bound; its stated margin exists
    // for the two systems that break that assumption — MirrorReflectorSystem reflects
    // player bullets WITHOUT consuming them, and BlackHoleSystem curves and slows them.
    // Neither was exercised at a 9-way build, so the margin the comment sells was the one
    // thing nothing checked. This drives both, from the worst corner, with aim toggling
    // every tick (the volley-rate term the sizing is derived against).
    //
    // Seeded: reflector edge placement, black-hole placement and enemy spawns all read
    // the injected rng, so an unseeded build would check the prewarm against a different
    // world every run — statistical detection (a flaky red) on the exact NFR2 invariant
    // this story raised the constant to protect.
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ctx.progressionState.ownedCards['spread-cannon'] = 5;
    ctx.progressionState.ownedCards.overcharge = 5;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );

    const pool = ctx.firingSystem.bulletPool;
    const prewarmTotal = pool.activeCount + pool.freeCount;
    expect(prewarmTotal).toBe(BULLET_POOL_PREWARM);

    // Worst geometry: the inset corner, firing across the arena diagonal.
    ctx.ship.x = ARENA_BORDER_INSET;
    ctx.ship.y = ARENA_BORDER_INSET;
    const dx = ARENA_WIDTH - 2 * ARENA_BORDER_INSET;
    const dy = ARENA_HEIGHT - 2 * ARENA_BORDER_INSET;
    const len = Math.hypot(dx, dy);

    // Put reflectors in the field up front. Called with NO avoid args deliberately:
    // spawn(avoidX, avoidY) is an AVOID point, not a placement target, so passing the
    // ship would push every reflector at least SPAWN_SAFE_RADIUS away from the one
    // corner all of this build's bullets originate from — the opposite of what a case
    // about reflect-extended flight wants. BlackHoleSystem self-spawns on its own
    // cadence, so 3000 ticks (50 s of sim) covers holes without poking it.
    for (let i = 0; i < 3; i++) ctx.mirrorReflectorSystem.spawn();
    expect(ctx.mirrorReflectorSystem.enemyPool.activeCount).toBe(3);

    let peak = 0;
    let reflectTicks = 0;
    let holeTicks = 0;
    for (let i = 0; i < 3000; i++) {
      // Toggle the aim channel every tick — the non-aiming branch re-seeds the
      // accumulator, so this is the highest volley rate the input surface can produce.
      if (i % 2 === 0) ctx.inputState.setAim(dx / len, dy / len);
      else ctx.inputState.setAim(0, 0);
      ctx.ship.x = ARENA_BORDER_INSET;
      ctx.ship.y = ARENA_BORDER_INSET;
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      peak = Math.max(peak, pool.activeCount);
      // The two systems this case exists for actually PARTICIPATED. MirrorReflectorSystem
      // clears its per-tick reflect Set at the top of each fixedUpdate, so reading it
      // after the step counts this tick's reflects; BlackHoleSystem's holePool is its
      // active-hole truth. Without these the only assertions here are pool capacity and
      // `peak > 200`, both of which straight-line flight satisfies on its own — control-
      // verified: with the reflector spawns removed the case still passed at peak 436, so
      // a reflect regression (an inverted REFLECTOR_MAX_ACTIVE guard, a dropped bullet-bar
      // reflect) or a BLACKHOLE_SPAWN_INTERVAL_MS raised past the 50 s simulated here
      // would leave the prewarm's ONLY reflector/black-hole-aware guard silently gone.
      if (ctx.mirrorReflectorSystem._reflected.size > 0) reflectTicks++;
      if (ctx.blackHoleSystem.holePool.activeCount > 0) holeTicks++;
      // The factory never runs: total capacity is still exactly the prewarm.
      expect(pool.activeCount + pool.freeCount).toBe(prewarmTotal);
    }
    expect(reflectTicks).toBeGreaterThan(0);
    expect(holeTicks).toBeGreaterThan(0);
    // Guard against the case silently degrading into a short-flight geometry that would
    // pass for the wrong reason (the same trap the firingSystem NFR2 cases pin against).
    expect(peak).toBeGreaterThan(200);
    // Pin the actual headroom, not just "some flight happened". This is the number the
    // prewarm's +29% margin is sold as covering, so a retune that erodes it fails HERE
    // rather than at the capacity assertion once it has already overrun.
    expect(peak).toBeLessThan(BULLET_POOL_PREWARM);
  });
});
