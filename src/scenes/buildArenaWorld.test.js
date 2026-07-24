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
  SHIELD_ABSORB_INVULN_MS,
  PLAYER_INVULN_MS,
  DASH_DURATION_MS,
  SPAWN_SAFE_RADIUS,
} from '../config/constants.js';
import { xpToNextLevel } from '../systems/LevelSystem.js';

// buildArenaWorld wiring coverage. The scene's create() inlines this exact build
// but cannot be unit-tested (it needs a live Phaser context); the factory is the
// Phaser-free seam that makes the load-bearing wiring headlessly assertable. This
// suite pins the currently-correct registration order, the enemyPools/deathPools
// composition, and both late-binds — so a reorder of addSystem calls or a swapped
// pool reference (the drift the deferred work flags) now fails a test.

// The canonical 26-system registration order (spec Design Notes; Story 6.3 added
// MirrorReflectorSystem in the enemy section, after SnakeSystem and before SpawnDirector;
// Story 8.1 added XpOrbSystem right after the BombSystem late-bind; Story 8.2 added
// LevelSystem right after XpOrbSystem; Story 8.3 added LevelUpSystem right after
// LevelSystem, before PlayerDeathSystem; Story 9.1 added DpsTelemetrySystem right
// after ScoringSystem, before BlackHoleSystem; Story 9.3 added ArmoredSystem in the
// enemy section, after MirrorReflectorSystem and before SpawnDirector; Story 10.4 added
// NaniteShieldSystem between ExtraLifeSystem and PlayerDeathSystem — a slot that is
// load-bearing in BOTH directions, see the shield's wiring test below; Story 10.5 added
// DashSystem immediately after CollisionSystem and before ScoringSystem — a slot that is
// load-bearing in THREE directions, see the dash's wiring tests below; Story 11.1 added
// OrbitBladeSystem immediately after DashSystem and before ScoringSystem; Story 11.2 added
// SeekerDroneSystem immediately after OrbitBladeSystem and before ScoringSystem; Story 11.3
// added MineLayerSystem immediately after SeekerDroneSystem and before ScoringSystem; Story
// 11.4 added PiercingLanceSystem immediately after MineLayerSystem and before ScoringSystem —
// the same load-bearing slot, see its wiring tests below).
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
  'DashSystem',
  'OrbitBladeSystem',
  'SeekerDroneSystem',
  'MineLayerSystem',
  'PiercingLanceSystem',
  'ScoringSystem',
  'DpsTelemetrySystem',
  'BlackHoleSystem',
  'BombSystem',
  'XpOrbSystem',
  'LevelSystem',
  'LevelUpSystem',
  'ExtraLifeSystem',
  'NaniteShieldSystem',
  'PlayerDeathSystem',
  'HighScoreSystem',
  'GridFieldSystem',
  'ParticleSystem',
  'ScreenFeedbackSystem',
  'AudioDirectorSystem',
];

// The full set of handles the factory RETURNS — the surface ArenaScene.create() draws
// from (src/scenes/ArenaScene.js). The scene cannot be unit-tested, so a dropped or
// renamed return key would surface only as an undefined this.* handle crashing the live
// render loop on the first frame. Pinning the contract here catches that drift headlessly.
//
// This is the factory's OUTPUT shape, deliberately a superset of what the scene assigns
// today: `playerStats` and `naniteShieldSystem` are published for consumers that do not
// exist yet (Epic 4's feedback work is the intended reader of the shield handle, via the
// absorbSeq latch). Do not "fix" the asymmetry by deleting a key — a published handle
// with no reader is the point.
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
  'dashSystem',
  'orbitBladeSystem',
  'seekerDroneSystem',
  'mineLayerSystem',
  'piercingLanceSystem',
  'scoringSystem',
  'dpsTelemetrySystem',
  'blackHoleSystem',
  'bombSystem',
  'xpOrbSystem',
  'levelSystem',
  'levelUpSystem',
  'extraLifeSystem',
  'naniteShieldSystem',
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

  it('registers the 31 systems in the canonical order (no-arg build, node env)', () => {
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

  it('constructs the naniteShieldSystem over enemyPools (not deathPools), between ExtraLife and PlayerDeath', () => {
    const ctx = buildArenaWorld();
    // The Lv5 break pulse's reach is the five COMBAT archetype pools — the SAME array
    // the factory returns, never deathPools. The Black Hole and the Mirror Reflector are
    // immune to AoE (the scoping BombSystem.detonateAt already applies), so handing the
    // shield a different or narrower list is a real regression that only an IDENTITY pin
    // catches: every behavioral case drives the seeker/green-square pools, which any
    // plausible wrong array still contains.
    expect(ctx.naniteShieldSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.naniteShieldSystem.enemyPools).not.toContain(
      ctx.blackHoleSystem.holePool,
    );
    expect(ctx.naniteShieldSystem.enemyPools).not.toContain(
      ctx.mirrorReflectorSystem.enemyPool,
    );
    // The shared ship + player-stat store, not copies.
    expect(ctx.naniteShieldSystem.ship).toBe(ctx.ship);
    expect(ctx.naniteShieldSystem.playerStats).toBe(ctx.playerStats);
    // The death seam holds THIS instance, and the slot is load-bearing in both
    // directions: after LevelUpSystem (the fold) and before PlayerDeathSystem (the read).
    expect(ctx.playerDeathSystem.shieldSystem).toBe(ctx.naniteShieldSystem);
    const order = ctx.world.systems.map((s) => s.constructor.name);
    expect(order.indexOf('NaniteShieldSystem')).toBeGreaterThan(
      order.indexOf('LevelUpSystem'),
    );
    expect(order.indexOf('NaniteShieldSystem')).toBeLessThan(
      order.indexOf('PlayerDeathSystem'),
    );
  });

  it('constructs the dashSystem in its load-bearing slot, over enemyPools and the shared handles', () => {
    const ctx = buildArenaWorld();
    // The sweep's reach is the five COMBAT archetype pools — the SAME array the factory
    // returns, never deathPools. The Black Hole and the Mirror Reflector are out of
    // scope (the scoping BombSystem.detonateAt / the shield pulse already apply), and
    // only an IDENTITY pin catches a narrower list: every behavioral case drives the
    // seeker pool, which any plausible wrong array still contains.
    expect(ctx.dashSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.dashSystem.enemyPools).not.toContain(ctx.blackHoleSystem.holePool);
    expect(ctx.dashSystem.enemyPools).not.toContain(ctx.mirrorReflectorSystem.enemyPool);
    // The shared ship / input / stat store / collision seam, not copies.
    expect(ctx.dashSystem.ship).toBe(ctx.ship);
    expect(ctx.dashSystem.inputState).toBe(ctx.inputState);
    expect(ctx.dashSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.dashSystem.collisionSystem).toBe(ctx.collisionSystem);
    // The three consumers hold THIS instance.
    expect(ctx.playerMovementSystem.dashSystem).toBe(ctx.dashSystem);
    expect(ctx.playerDeathSystem.dashSystem).toBe(ctx.dashSystem);
    expect(ctx.particleSystem.dashSystem).toBe(ctx.dashSystem);
    // …and the movement system reads the SAME store the fold mutates.
    expect(ctx.playerMovementSystem.playerStats).toBe(ctx.playerStats);
  });

  it('pins the DashSystem slot: immediately AFTER CollisionSystem and BEFORE ScoringSystem', () => {
    // Load-bearing in three directions. After CollisionSystem, so a dash kill appends to
    // latches that system has already RESET this tick; before ScoringSystem (and so
    // before DpsTelemetry / XpOrb / GridField / Particle), so the kill is scored and
    // produces its full feedback; and later than PlayerMovementSystem, which is why
    // movement reads the dash window one fixed step after it opens.
    const ctx = buildArenaWorld();
    const order = ctx.world.systems.map((s) => s.constructor.name);
    const dash = order.indexOf('DashSystem');
    expect(dash).toBe(order.indexOf('CollisionSystem') + 1);
    // Story 11.1 inserted OrbitBladeSystem immediately after DashSystem (mirroring the
    // dash's load-bearing slot); Story 11.2 inserted SeekerDroneSystem right after it; Story
    // 11.3 inserted MineLayerSystem right after that; Story 11.4 inserted PiercingLanceSystem
    // right after that — so ScoringSystem is now dash + 5.
    expect(order.indexOf('OrbitBladeSystem')).toBe(dash + 1);
    expect(order.indexOf('SeekerDroneSystem')).toBe(dash + 2);
    expect(order.indexOf('MineLayerSystem')).toBe(dash + 3);
    expect(order.indexOf('PiercingLanceSystem')).toBe(dash + 4);
    expect(order.indexOf('ScoringSystem')).toBe(dash + 5);
    expect(dash).toBeLessThan(order.indexOf('DpsTelemetrySystem'));
    expect(dash).toBeLessThan(order.indexOf('XpOrbSystem'));
    expect(dash).toBeLessThan(order.indexOf('GridFieldSystem'));
    expect(dash).toBeLessThan(order.indexOf('ParticleSystem'));
    expect(dash).toBeGreaterThan(order.indexOf('PlayerMovementSystem'));
  });

  it('constructs the orbitBladeSystem over enemyPools and the shared handles (Story 11.1)', () => {
    const ctx = buildArenaWorld();
    // The sweep's reach is the five COMBAT archetype pools — the SAME array the factory
    // returns, never deathPools. The Black Hole and the Mirror Reflector are out of scope
    // (the scoping DashSystem._sweep / the shield pulse already apply), and only an
    // IDENTITY pin catches a narrower list: every behavioral case drives the seeker pool,
    // which any plausible wrong array still contains.
    expect(ctx.orbitBladeSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.orbitBladeSystem.enemyPools).not.toContain(ctx.blackHoleSystem.holePool);
    expect(ctx.orbitBladeSystem.enemyPools).not.toContain(
      ctx.mirrorReflectorSystem.enemyPool,
    );
    // The shared ship / stat store / collision seam, not copies.
    expect(ctx.orbitBladeSystem.ship).toBe(ctx.ship);
    expect(ctx.orbitBladeSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.orbitBladeSystem.collisionSystem).toBe(ctx.collisionSystem);
  });

  it('pins the OrbitBladeSystem slot: immediately AFTER DashSystem and BEFORE ScoringSystem', () => {
    // Load-bearing exactly like the dash slot: after CollisionSystem so a blade kill
    // appends to latches already reset this tick; before ScoringSystem (and so before
    // DpsTelemetry / XpOrb / GridField / Particle) so the kill is scored and produces its
    // full feedback.
    const ctx = buildArenaWorld();
    const order = ctx.world.systems.map((s) => s.constructor.name);
    const orbit = order.indexOf('OrbitBladeSystem');
    expect(orbit).toBe(order.indexOf('DashSystem') + 1);
    // Story 11.2 inserted SeekerDroneSystem after OrbitBladeSystem; Story 11.3 inserted
    // MineLayerSystem after that; Story 11.4 inserted PiercingLanceSystem after that — so
    // ScoringSystem is now orbit + 4.
    expect(order.indexOf('SeekerDroneSystem')).toBe(orbit + 1);
    expect(order.indexOf('MineLayerSystem')).toBe(orbit + 2);
    expect(order.indexOf('PiercingLanceSystem')).toBe(orbit + 3);
    expect(order.indexOf('ScoringSystem')).toBe(orbit + 4);
    expect(orbit).toBeGreaterThan(order.indexOf('CollisionSystem'));
    expect(orbit).toBeLessThan(order.indexOf('DpsTelemetrySystem'));
    expect(orbit).toBeLessThan(order.indexOf('XpOrbSystem'));
    expect(orbit).toBeLessThan(order.indexOf('GridFieldSystem'));
    expect(orbit).toBeLessThan(order.indexOf('ParticleSystem'));
  });

  it('constructs the seekerDroneSystem over enemyPools and the shared handles (Story 11.2)', () => {
    const ctx = buildArenaWorld();
    // The target scan + shot sweep reach the five COMBAT archetype pools — the SAME array
    // the factory returns, never deathPools. The Black Hole and the Mirror Reflector are
    // out of scope (the scoping OrbitBladeSystem / DashSystem already apply).
    expect(ctx.seekerDroneSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.seekerDroneSystem.enemyPools).not.toContain(
      ctx.blackHoleSystem.holePool,
    );
    expect(ctx.seekerDroneSystem.enemyPools).not.toContain(
      ctx.mirrorReflectorSystem.enemyPool,
    );
    // The shared ship / stat store / collision seam, not copies.
    expect(ctx.seekerDroneSystem.ship).toBe(ctx.ship);
    expect(ctx.seekerDroneSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.seekerDroneSystem.collisionSystem).toBe(ctx.collisionSystem);
  });

  it('pins the SeekerDroneSystem slot: immediately AFTER OrbitBladeSystem and BEFORE ScoringSystem', () => {
    // Load-bearing exactly like the blade/dash slot: after CollisionSystem so a drone-shot
    // kill appends to latches already reset this tick; before ScoringSystem (and so before
    // DpsTelemetry / XpOrb / GridField / Particle) so the kill is scored and produces its
    // full feedback.
    const ctx = buildArenaWorld();
    const order = ctx.world.systems.map((s) => s.constructor.name);
    const drones = order.indexOf('SeekerDroneSystem');
    expect(drones).toBe(order.indexOf('OrbitBladeSystem') + 1);
    // Story 11.3 inserted MineLayerSystem after SeekerDroneSystem; Story 11.4 inserted
    // PiercingLanceSystem after that — so ScoringSystem is now drones + 3.
    expect(order.indexOf('MineLayerSystem')).toBe(drones + 1);
    expect(order.indexOf('PiercingLanceSystem')).toBe(drones + 2);
    expect(order.indexOf('ScoringSystem')).toBe(drones + 3);
    expect(drones).toBeGreaterThan(order.indexOf('CollisionSystem'));
    expect(drones).toBeLessThan(order.indexOf('DpsTelemetrySystem'));
    expect(drones).toBeLessThan(order.indexOf('XpOrbSystem'));
    expect(drones).toBeLessThan(order.indexOf('GridFieldSystem'));
    expect(drones).toBeLessThan(order.indexOf('ParticleSystem'));
  });

  it('constructs the mineLayerSystem over enemyPools and the shared handles (Story 11.3)', () => {
    const ctx = buildArenaWorld();
    // The detonation + pull reach the five COMBAT archetype pools — the SAME array the
    // factory returns, never deathPools. The Black Hole and the Mirror Reflector are out of
    // scope (the scoping SeekerDroneSystem / OrbitBladeSystem already apply).
    expect(ctx.mineLayerSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.mineLayerSystem.enemyPools).not.toContain(ctx.blackHoleSystem.holePool);
    expect(ctx.mineLayerSystem.enemyPools).not.toContain(
      ctx.mirrorReflectorSystem.enemyPool,
    );
    // The shared ship / stat store / collision seam, not copies.
    expect(ctx.mineLayerSystem.ship).toBe(ctx.ship);
    expect(ctx.mineLayerSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.mineLayerSystem.collisionSystem).toBe(ctx.collisionSystem);
  });

  it('pins the MineLayerSystem slot: immediately AFTER SeekerDroneSystem and BEFORE ScoringSystem', () => {
    // Load-bearing exactly like the drone/blade/dash slot: after CollisionSystem so a mine
    // kill appends to latches already reset this tick; before ScoringSystem (and so before
    // DpsTelemetry / XpOrb / GridField / Particle) so the kill is scored and produces its
    // full feedback.
    const ctx = buildArenaWorld();
    const order = ctx.world.systems.map((s) => s.constructor.name);
    const mine = order.indexOf('MineLayerSystem');
    expect(mine).toBe(order.indexOf('SeekerDroneSystem') + 1);
    // Story 11.4 inserted PiercingLanceSystem between MineLayerSystem and ScoringSystem, so
    // ScoringSystem is now mine + 2, not mine + 1.
    expect(order.indexOf('PiercingLanceSystem')).toBe(mine + 1);
    expect(order.indexOf('ScoringSystem')).toBe(mine + 2);
    expect(mine).toBeGreaterThan(order.indexOf('CollisionSystem'));
    expect(mine).toBeLessThan(order.indexOf('DpsTelemetrySystem'));
    expect(mine).toBeLessThan(order.indexOf('XpOrbSystem'));
    expect(mine).toBeLessThan(order.indexOf('GridFieldSystem'));
    expect(mine).toBeLessThan(order.indexOf('ParticleSystem'));
  });

  it('constructs the piercingLanceSystem over enemyPools and the shared handles (Story 11.4)', () => {
    const ctx = buildArenaWorld();
    // The bolt sweep + trail-node damage reach the five COMBAT archetype pools — the SAME array
    // the factory returns, never deathPools. The Black Hole and the Mirror Reflector are out of
    // scope (the scoping MineLayerSystem / SeekerDroneSystem already apply).
    expect(ctx.piercingLanceSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.piercingLanceSystem.enemyPools).not.toContain(ctx.blackHoleSystem.holePool);
    expect(ctx.piercingLanceSystem.enemyPools).not.toContain(
      ctx.mirrorReflectorSystem.enemyPool,
    );
    // The shared ship / stat store / collision seam, not copies.
    expect(ctx.piercingLanceSystem.ship).toBe(ctx.ship);
    expect(ctx.piercingLanceSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.piercingLanceSystem.collisionSystem).toBe(ctx.collisionSystem);
  });

  it('late-binds firingSystem.enemyPools to the combat pools for Lv5 Ricochet seek (Story 11.5)', () => {
    // Ricochet's Lv5 seek scans this.enemyPools inside FiringSystem; the reference is late-bound
    // AFTER enemyPools is assembled (FiringSystem is constructed before the pools exist). Bind it
    // to the SAME array the factory returns — never deathPools, never the immune reflector — so a
    // dropped or mis-targeted late-bind (seek silently a no-op, or homing toward a black hole /
    // the reflector) fails here, exactly like the sibling enemyPools consumers above.
    const ctx = buildArenaWorld();
    expect(ctx.firingSystem.enemyPools).toBe(ctx.enemyPools);
    expect(ctx.firingSystem.enemyPools).not.toContain(ctx.blackHoleSystem.holePool);
    expect(ctx.firingSystem.enemyPools).not.toContain(ctx.mirrorReflectorSystem.enemyPool);
  });

  it('pins the PiercingLanceSystem slot: immediately AFTER MineLayerSystem and BEFORE ScoringSystem', () => {
    // Load-bearing exactly like the mine/drone/blade/dash slot: after CollisionSystem so a lance
    // kill appends to latches already reset this tick; before ScoringSystem (and so before
    // DpsTelemetry / XpOrb / GridField / Particle) so the kill is scored and produces its full
    // feedback.
    const ctx = buildArenaWorld();
    const order = ctx.world.systems.map((s) => s.constructor.name);
    const lance = order.indexOf('PiercingLanceSystem');
    expect(lance).toBe(order.indexOf('MineLayerSystem') + 1);
    expect(order.indexOf('ScoringSystem')).toBe(lance + 1);
    expect(lance).toBeGreaterThan(order.indexOf('CollisionSystem'));
    expect(lance).toBeLessThan(order.indexOf('DpsTelemetrySystem'));
    expect(lance).toBeLessThan(order.indexOf('XpOrbSystem'));
    expect(lance).toBeLessThan(order.indexOf('GridFieldSystem'));
    expect(lance).toBeLessThan(order.indexOf('ParticleSystem'));
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

describe('buildArenaWorld — Nanite Shield through the ASSEMBLED world (Story 10.4)', () => {
  // The story's headline observable at the surface the intent states it at: a card pick
  // folds the SHARED playerStats, the shield syncs its live charge count off that fold
  // on the SAME tick, and the next lethal contact spends a charge instead of a life.
  //
  // The FIRST test drives the whole chain for real — XP → level crossings → the offers
  // the REAL weighted draw produced → queueSelection → LevelUpSystem's fold →
  // NaniteShieldSystem's max sync → PlayerDeathSystem's absorb — so a change to how a
  // selection is applied, or a reorder of the shield's registration slot, fails here.
  // The SECOND constructs the Lv5 owned state directly: it is about the BREAK PULSE's
  // effect on the live enemy pools, not a claim about the pick path (already covered
  // above), and reaching Lv5 through real draws would add a long setup pinning nothing new.

  // A small deterministic PRNG (mulberry32). The offer draw is weighted-without-
  // replacement over the shared `_rng`, so a CONSTANT rng would produce the identical
  // trio at every level and could never surface a different item; a seeded stream gives
  // real variety while keeping the run reproducible (no flaky "the card never showed up").
  function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Total XP required to have reached run level `level` (the real curve). */
  function xpForLevel(level) {
    let need = 0;
    for (let l = 1; l < level; l++) need += xpToNextLevel(l);
    return need;
  }

  it('offer → pick → fold → shield: a real lethal contact spends a CHARGE, not a life', () => {
    const ctx = buildArenaWorld({ rng: seededRng(20104) });
    expect(ctx.playerStats.shieldCharges).toBe(PLAYER_STATS_BASE.shieldCharges);
    expect(ctx.naniteShieldSystem.charges).toBe(0);
    expect(ctx.naniteShieldSystem.maxCharges).toBe(0);

    // Level up (through real banked XP and the real LevelSystem curve) until the REAL
    // weighted draw offers Nanite Shield. Nothing here reimplements the offer: when the
    // shield is not in the trio we pick a different card and level again. Bounded, so a
    // draw regression fails as "never offered" rather than hanging.
    let level = 1;
    let slot = -1;
    for (let attempt = 0; attempt < 20 && slot < 0; attempt++) {
      level += 1;
      // Bank just PAST the level threshold rather than exactly on it: `xpForLevel` sums
      // the curve in the same order LevelSystem subtracts it, so the exact boundary value
      // can land a float ULP short and derive the LOWER level (levels 6/9/10 do). +1 xp is
      // far below any level's span, so it robustly crosses without over-shooting.
      ctx.scoreState.xp = xpForLevel(level) + 1;
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      expect(ctx.levelSystem.level).toBe(level);
      expect(ctx.levelUpSystem.pendingSelections).toBeGreaterThanOrEqual(1);
      slot = ctx.levelUpSystem.currentOffer.findIndex((c) => c.id === 'nanite-shield');
      if (slot < 0) {
        ctx.levelUpSystem.queueSelection(0); // take something else and carry on
        ctx.world.fixedUpdate(FIXED_STEP_MS);
      }
    }
    expect(slot, 'the real weighted draw never offered nanite-shield').toBeGreaterThanOrEqual(0);

    // Pick it through the real latch. The pick tick runs LevelUpSystem's fold and THEN
    // NaniteShieldSystem's max sync (that registration order is what makes the charge
    // live immediately rather than one recharge away).
    ctx.levelUpSystem.queueSelection(slot);
    ctx.world.fixedUpdate(FIXED_STEP_MS);

    expect(ctx.progressionState.ownedCards['nanite-shield']).toBe(1);
    // The SHARED store carries the MAXIMA only — no live count is readable from it.
    expect(ctx.playerStats.shieldCharges).toBe(1);
    expect(ctx.playerStats.shieldRechargeMs).toBe(20000);
    expect(ctx.playerStats.shieldKnockback).toBe(0);
    // …and the system already holds the live charge, on the very tick of the pick.
    expect(ctx.naniteShieldSystem.maxCharges).toBe(1);
    expect(ctx.naniteShieldSystem.charges).toBe(1);
    // The same SHARED store instance, not a copy — no system was reconstructed.
    expect(ctx.naniteShieldSystem.playerStats).toBe(ctx.playerStats);
    expect(ctx.playerDeathSystem.shieldSystem).toBe(ctx.naniteShieldSystem);

    // Let the level-up landing i-frames lapse (bounded) so the next hit is real.
    for (let i = 0; i < 200 && ctx.playerState.invulnMs > 0; i++) {
      ctx.world.fixedUpdate(FIXED_STEP_MS);
    }
    expect(ctx.playerState.invulnMs).toBe(0);
    expect(ctx.naniteShieldSystem.charges).toBe(1); // nothing spent while safe

    // Park the ship well off arena center (so "not respawned" is observable) and put a
    // live seeker on top of it through the REAL archetype pool.
    ctx.ship.x = 420;
    ctx.ship.y = 260;
    ctx.ship.vx = 0;
    ctx.ship.vy = 0;
    const seeker = ctx.enemySystem.enemyPool.acquire();
    seeker.x = ctx.ship.x + 5;
    seeker.y = ctx.ship.y;
    seeker.vx = 0;
    seeker.vy = 0;
    seeker.telegraphMs = 0;

    const livesBefore = ctx.playerState.lives;
    const deathSeqBefore = ctx.playerDeathSystem.deathSeq;
    const multiplierBefore = ctx.scoreState.multiplier;
    const shipXBefore = ctx.ship.x;
    const shipYBefore = ctx.ship.y;
    ctx.world.fixedUpdate(FIXED_STEP_MS);

    // The charge paid for the hit — the life did not.
    expect(ctx.naniteShieldSystem.charges).toBe(0);
    expect(ctx.naniteShieldSystem.absorbSeq).toBe(1);
    expect(ctx.playerState.lives).toBe(livesBefore);
    expect(ctx.playerState.gameOver).toBe(false);
    expect(ctx.playerDeathSystem.deathSeq).toBe(deathSeqBefore); // no ripple/shake/SFX
    expect(ctx.scoreState.multiplier).toBe(multiplierBefore); // the streak survives
    expect(ctx.playerState.invulnMs).toBe(SHIELD_ABSORB_INVULN_MS);
    // NOT teleported to arena center — staying put is the value of the pick. Asserted as
    // the EXACT position it held, not merely "not the centre": a negative assertion against
    // one point cannot fail on a partial respawn, a nudge out of contact, or a knockback
    // that caught the ship — every regression this line exists to catch except one.
    expect(ctx.ship.x).toBe(shipXBefore);
    expect(ctx.ship.y).toBe(shipYBefore);
    // THAT enemy is still alive and unmoved-by-the-shield (a Lv1 absorb neither kills
    // nor pushes) — asserted on the instance, not on a pool count a fresh spawn could
    // mask.
    let seekerStillActive = false;
    ctx.enemySystem.enemyPool.forEachActive((s) => {
      if (s === seeker) seekerStillActive = true;
    });
    expect(seekerStillActive).toBe(true);
  });

  it('Lv5: the FINAL break pulses enemies away in the assembled world, killing none', () => {
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ctx.progressionState.ownedCards['nanite-shield'] = 5;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );
    expect(ctx.playerStats.shieldCharges).toBe(3);
    expect(ctx.playerStats.shieldKnockback).toBe(1);

    ctx.ship.x = 600;
    ctx.ship.y = 360;
    ctx.world.fixedUpdate(FIXED_STEP_MS); // the shield syncs its max off the fold
    expect(ctx.naniteShieldSystem.charges).toBe(3);

    // Burn two charges so the seam's absorb is the FINAL one (the only break that pulses).
    ctx.naniteShieldSystem.tryAbsorb();
    ctx.naniteShieldSystem.tryAbsorb();
    expect(ctx.naniteShieldSystem.charges).toBe(1);

    ctx.ship.x = 600;
    ctx.ship.y = 360;
    ctx.ship.vx = 0;
    ctx.ship.vy = 0;
    ctx.playerState.invulnMs = 0;
    const contact = ctx.enemySystem.enemyPool.acquire();
    contact.x = ctx.ship.x + 25;
    contact.y = ctx.ship.y;
    contact.telegraphMs = 0;
    // A second enemy inside the pulse radius but not in contact — it must be shoved too.
    const bystander = ctx.greenSquareSystem.enemyPool.acquire();
    bystander.x = ctx.ship.x;
    bystander.y = ctx.ship.y + 100;
    bystander.telegraphMs = 0;
    const livesBefore = ctx.playerState.lives;
    const scoreBefore = ctx.scoreState.score;

    ctx.world.fixedUpdate(FIXED_STEP_MS);

    expect(ctx.naniteShieldSystem.charges).toBe(0);
    expect(ctx.playerState.lives).toBe(livesBefore);
    // Both are now far outside contact range, on the far side from the ship — the push
    // ran AFTER every mover integrated, so nothing overwrote it this tick.
    expect(Math.hypot(contact.x - ctx.ship.x, contact.y - ctx.ship.y)).toBeGreaterThan(150);
    expect(contact.x).toBeGreaterThan(ctx.ship.x + 25);
    expect(bystander.y).toBeGreaterThan(ctx.ship.y + 100);
    // Inside the arena border, inset by each body's own radius.
    for (const e of [contact, bystander]) {
      expect(e.x).toBeGreaterThanOrEqual(ARENA_BORDER_INSET + e.radius);
      expect(e.x).toBeLessThanOrEqual(ARENA_WIDTH - ARENA_BORDER_INSET - e.radius);
      expect(e.y).toBeGreaterThanOrEqual(ARENA_BORDER_INSET + e.radius);
      expect(e.y).toBeLessThanOrEqual(ARENA_HEIGHT - ARENA_BORDER_INSET - e.radius);
    }
    // Nothing was killed, released or scored by the pulse. Asserted on the SPECIFIC
    // instances (a pool COUNT cannot fail on a release if the spawn director happens to
    // acquire in the same tick — the claim here is exact: the pulse releases nothing).
    const stillActive = new Set();
    ctx.enemySystem.enemyPool.forEachActive((s) => stillActive.add(s));
    ctx.greenSquareSystem.enemyPool.forEachActive((s) => stillActive.add(s));
    expect(stillActive.has(contact)).toBe(true);
    expect(stillActive.has(bystander)).toBe(true);
    expect(ctx.scoreState.score).toBe(scoreBefore);
  });
});

describe('buildArenaWorld — Afterburner through the ASSEMBLED world (Story 10.5)', () => {
  // The story's headline observables at the surface the intent states them at: a card
  // pick folds the SHARED playerStats, and from that instant the ship is measurably
  // faster, a dash button actually dashes, and a Lv4 dash kill pays out like a bullet
  // kill. The FIRST test drives the whole chain for real — XP → level crossings → the
  // offers the REAL weighted draw produced → queueSelection → LevelUpSystem's fold →
  // DashSystem → PlayerMovementSystem. The later tests construct the owned state
  // directly where the claim is about the EFFECT rather than the pick path (already
  // covered), so reaching Lv4/Lv5 through real draws would add long setup pinning nothing.

  function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function xpForLevel(level) {
    let need = 0;
    for (let l = 1; l < level; l++) need += xpToNextLevel(l);
    return need;
  }

  /**
   * Level up through REAL banked XP and the REAL weighted draw until Afterburner is in
   * the offer, then pick it. Bounded, so a draw regression fails as "never offered"
   * rather than hanging. Returns the ctx for chaining.
   */
  function pickAfterburnerForReal(ctx) {
    let level = 1;
    let slot = -1;
    for (let attempt = 0; attempt < 20 && slot < 0; attempt++) {
      level += 1;
      // Bank just PAST the level threshold rather than exactly on it: `xpForLevel` sums
      // the curve in the same order LevelSystem subtracts it, so the exact boundary value
      // can land a float ULP short and derive the LOWER level (levels 6/9/10 do). +1 xp is
      // far below any level's span, so it robustly crosses without over-shooting.
      ctx.scoreState.xp = xpForLevel(level) + 1;
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      expect(ctx.levelSystem.level).toBe(level);
      expect(ctx.levelUpSystem.pendingSelections).toBeGreaterThanOrEqual(1);
      slot = ctx.levelUpSystem.currentOffer.findIndex((c) => c.id === 'afterburner');
      if (slot < 0) {
        ctx.levelUpSystem.queueSelection(0);
        ctx.world.fixedUpdate(FIXED_STEP_MS);
      }
    }
    expect(slot, 'the real weighted draw never offered afterburner').toBeGreaterThanOrEqual(0);
    ctx.levelUpSystem.queueSelection(slot);
    ctx.world.fixedUpdate(FIXED_STEP_MS);
    return ctx;
  }

  /** Raise Afterburner to `level` through the REAL registry fold, no hand-written stats. */
  function ownAfterburner(ctx, level) {
    ctx.progressionState.ownedCards.afterburner = level;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );
    expect(ctx.playerStats.dashCooldownMs).toBeGreaterThan(0);
  }

  /**
   * Hold a direction to steady state through the WHOLE assembled world, so a regression
   * anywhere in registry → fold → movement is caught (driving PlayerMovementSystem
   * directly is the exact shape of the miss this story was re-specced to fix).
   *
   * Only POSITION is re-pinned each tick — to arena centre, keeping the arena clamp out
   * of the measurement — never velocity. The ship is also held invulnerable so a
   * spawned enemy cannot respawn it mid-measurement and zero the velocity we are
   * reading; that is a death-flow effect, not a movement one.
   */
  function measureTopSpeed(ctx, ticks = 200) {
    ctx.inputState.setMove(1, 0);
    for (let i = 0; i < ticks; i++) {
      ctx.ship.x = ARENA_WIDTH / 2;
      ctx.ship.y = ARENA_HEIGHT / 2;
      ctx.playerState.invulnMs = PLAYER_INVULN_MS;
      ctx.world.fixedUpdate(FIXED_STEP_MS);
    }
    return Math.hypot(ctx.ship.vx, ctx.ship.vy);
  }

  it('offer → pick → fold → dash: the REAL level-up path makes the ship dash', () => {
    const ctx = buildArenaWorld({ rng: seededRng(20105) });
    expect(ctx.playerStats.moveSpeedMult).toBe(PLAYER_STATS_BASE.moveSpeedMult);
    expect(ctx.dashSystem.dashEnabled()).toBe(false);

    pickAfterburnerForReal(ctx);
    expect(ctx.progressionState.ownedCards.afterburner).toBe(1);
    // Lv1 is a SPEED rung only — the dash is not owned yet.
    expect(ctx.playerStats.moveSpeedMult).toBeCloseTo(1.12, 10);
    expect(ctx.playerStats.dashCooldownMs).toBe(0);
    expect(ctx.dashSystem.dashEnabled()).toBe(false);

    // Take it to Lv2 through the same real fold (no hand-written ownedCards stats).
    ownAfterburner(ctx, 2);
    expect(ctx.dashSystem.dashEnabled()).toBe(true);
    // No system was reconstructed — the same SHARED store instance carried the upgrade.
    expect(ctx.dashSystem.playerStats).toBe(ctx.playerStats);

    // Park the ship, hold a direction, queue a dash through the real latch and step the
    // assembled world: the ship must travel the dash distance.
    ctx.playerState.invulnMs = 0;
    ctx.ship.x = ARENA_WIDTH / 2;
    ctx.ship.y = ARENA_HEIGHT / 2;
    ctx.ship.vx = 0;
    ctx.ship.vy = 0;
    const x0 = ctx.ship.x;
    ctx.inputState.setMove(1, 0);
    ctx.inputState.queueDash();

    let dashTicks = 0;
    for (let i = 0; i < 20; i++) {
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      if (ctx.dashSystem.movementActive) dashTicks += 1;
    }
    expect(ctx.dashSystem.dashSeq).toBe(1);
    expect(dashTicks).toBe(Math.ceil(DASH_DURATION_MS / FIXED_STEP_MS));
    const travelled = ctx.ship.x - x0;
    // Well past what ordinary movement could cover in the same ~0.33s, and clear of the
    // game's own "clear of the player" distance.
    expect(travelled).toBeGreaterThan(SPAWN_SAFE_RADIUS);
  });

  it('ACHIEVED SPEED: each rung is measurably distinct through registry → fold → movement', () => {
    // The end-to-end counterpart of the unit test: a regression ANYWHERE in the chain
    // (a re-authored registry rung, a fold slip, a movement change) is caught here.
    const expected = [520, 582.4, 624, 650, 650, 702];
    const measured = [];
    for (let level = 0; level <= 5; level++) {
      const ctx = buildArenaWorld({ rng: () => 0.5 });
      if (level > 0) ownAfterburnerLevel(ctx, level);
      measured.push(measureTopSpeed(ctx));
    }
    for (let i = 0; i < expected.length; i++) {
      expect(measured[i], `Afterburner Lv${i} achieved speed`).toBeCloseTo(expected[i], 3);
    }
    // Lv3 and Lv4 share a rung by design; every OTHER pair is distinguishable in play.
    const distinct = [measured[0], measured[1], measured[2], measured[3], measured[5]];
    for (let i = 1; i < distinct.length; i++) {
      expect(distinct[i] - distinct[i - 1]).toBeGreaterThan(1);
    }
  });

  /** Own Afterburner at `level` (0 = unowned) through the REAL registry fold. */
  function ownAfterburnerLevel(ctx, level) {
    ctx.progressionState.ownedCards.afterburner = level;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );
  }

  it('Lv4: an enemy on the dash path is KILLED, SCORED and drops an XP ORB', () => {
    // The property that distinguishes a dash kill from BombSystem's silent removal.
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ownAfterburner(ctx, 4);
    ctx.playerState.invulnMs = 0;
    ctx.ship.x = ARENA_WIDTH / 2;
    ctx.ship.y = ARENA_HEIGHT / 2;
    ctx.ship.vx = 0;
    ctx.ship.vy = 0;

    // A live seeker from the REAL archetype pool, placed ALONG the dash path but well
    // clear of the ship at rest — the dash has to travel into it. (Standing in contact
    // before the press would kill the player on the opening tick, which is correct: the
    // protected window is exactly the TRAVELLED window, so the tick before the ship
    // moves is deliberately not protected.)
    const seeker = ctx.enemySystem.enemyPool.acquire();
    seeker.x = ctx.ship.x + 100;
    seeker.y = ctx.ship.y;
    seeker.vx = 0;
    seeker.vy = 0;
    seeker.telegraphMs = 0;

    const scoreBefore = ctx.scoreState.score;
    const orbsBefore = ctx.xpOrbSystem.pool.activeCount;
    const particlesBefore = ctx.particleSystem.pool.activeCount;
    const activeRipples = () =>
      ctx.gridFieldSystem.ripples.filter((r) => r.active).length;
    const ripplesBefore = activeRipples();

    ctx.inputState.setMove(1, 0);
    ctx.inputState.queueDash();
    // Run the whole window: the dash opens on the first tick and travels into the
    // enemy a few ticks later. Track the orb PEAK — the dash leaves the ship right on
    // top of the drop, so the orb is magnet-collected within a few ticks and an
    // end-of-run count would read 0 for a drop that really happened.
    let orbPeak = orbsBefore;
    for (let i = 0; i < 14; i++) {
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      orbPeak = Math.max(orbPeak, ctx.xpOrbSystem.pool.activeCount);
    }

    // Killed and released, and it really was the DASH (no bullet reached it — the
    // firing system needs an active aim channel, which nothing set).
    let stillActive = false;
    ctx.enemySystem.enemyPool.forEachActive((s) => {
      if (s === seeker) stillActive = true;
    });
    expect(stillActive).toBe(false);
    // …scored through the ordinary per-kill seam…
    expect(ctx.scoreState.score).toBeGreaterThan(scoreBefore);
    // …an XP orb dropped (and, since the ship is right there, was banked)…
    expect(orbPeak).toBeGreaterThan(orbsBefore);
    expect(ctx.scoreState.xp).toBeGreaterThan(0);
    // …a particle burst sprayed and the grid rippled — the FULL kill feedback.
    expect(ctx.particleSystem.pool.activeCount).toBeGreaterThan(particlesBefore);
    expect(activeRipples()).toBeGreaterThan(ripplesBefore);
  });

  it('Lv4: an ARMORED survivor still credits the Story 9.2 DPS governor', () => {
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ownAfterburner(ctx, 4);
    ctx.playerState.invulnMs = 0;
    ctx.ship.x = ARENA_WIDTH / 2;
    ctx.ship.y = ARENA_HEIGHT / 2;

    const tank = ctx.armoredSystem.enemyPool.acquire();
    tank.x = ctx.ship.x + 100;
    tank.y = ctx.ship.y;
    tank.vx = 0;
    tank.vy = 0;
    tank.telegraphMs = 0;
    tank.hp = ARMORED_HP;

    ctx.inputState.setMove(1, 0);
    ctx.inputState.queueDash();
    for (let i = 0; i < 14; i++) ctx.world.fixedUpdate(FIXED_STEP_MS);

    expect(tank.hp).toBeLessThan(ARMORED_HP);
    expect(ctx.dpsTelemetrySystem.dps).toBeGreaterThan(0);
  });

  it('an UNOWNED build is byte-identical to pre-10.5 and a queued dash press is discarded', () => {
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    expect(ctx.dashSystem.dashEnabled()).toBe(false);
    expect(measureTopSpeed(ctx)).toBeCloseTo(520, 3);
    ctx.inputState.queueDash();
    ctx.world.fixedUpdate(FIXED_STEP_MS);
    expect(ctx.inputState.dashQueued).toBe(false); // consumed and discarded
    expect(ctx.dashSystem.active).toBe(false);
    expect(ctx.dashSystem.dashSeq).toBe(0);
  });
});

describe('buildArenaWorld — Orbit Blade through the ASSEMBLED world (Story 11.1)', () => {
  // The story's headline observables at the surface the intent states them at: a card pick
  // folds the SHARED playerStats, the OrbitBladeSystem syncs its live blade count off that
  // fold, and a blade contact routed through the shared applyPlayerDamage seam pays out
  // EXACTLY like a bullet kill — scored, an XP orb dropped, the full kill feedback — with the
  // armored one-shot that is the whole point of the item. The Epic-10 siblings (Spread
  // Cannon, Nanite Shield, Afterburner) each drive their headline through the assembled
  // world; orbitBladeSystem.test.js verifies the system in ISOLATION against a hand-built
  // collision seam, so these tests close that seam by observing the score/XP/kill OUTCOME
  // through the REAL registered pipeline (a source-discriminating regression in ScoringSystem
  // or XpOrbSystem, or a slot reorder, would pass every isolation test but fail here).

  function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function xpForLevel(level) {
    let need = 0;
    for (let l = 1; l < level; l++) need += xpToNextLevel(l);
    return need;
  }

  /** Raise Orbit Blade to `level` through the REAL registry fold, no hand-written stats. */
  function ownOrbitBlade(ctx, level) {
    ctx.progressionState.ownedCards['orbit-blade'] = level;
    recomputePlayerStats(
      ctx.levelUpSystem.playerStats,
      ctx.progressionState.ownedCards,
      ITEM_REGISTRY,
    );
    expect(ctx.playerStats.orbitBladeCount).toBeGreaterThan(0);
  }

  /** Return the single live blade after one settle tick (ship parked, invuln cleared). */
  function parkAndMaterialize(ctx) {
    ctx.playerState.invulnMs = 0;
    ctx.ship.x = ARENA_WIDTH / 2;
    ctx.ship.y = ARENA_HEIGHT / 2;
    ctx.ship.vx = 0;
    ctx.ship.vy = 0;
    ctx.world.fixedUpdate(FIXED_STEP_MS); // the system materialises + positions the blades
    let blade = null;
    ctx.orbitBladeSystem.pool.forEachActive((b) => {
      blade = b;
    });
    expect(blade, 'a blade should be live after the fold + first tick').not.toBeNull();
    return blade;
  }

  it('offer → pick → fold → system: the REAL level-up path gives the ship a live blade', () => {
    const ctx = buildArenaWorld({ rng: seededRng(11104) });
    expect(ctx.playerStats.orbitBladeCount).toBe(PLAYER_STATS_BASE.orbitBladeCount);
    expect(ctx.orbitBladeSystem.pool.activeCount).toBe(0);

    // Level up through real banked XP and the real weighted draw until Orbit Blade is offered,
    // then pick it. Bounded, so a draw regression fails as "never offered" rather than hanging.
    let level = 1;
    let slot = -1;
    for (let attempt = 0; attempt < 20 && slot < 0; attempt++) {
      level += 1;
      // Bank just PAST the threshold: `xpForLevel` sums the curve in the same order
      // LevelSystem subtracts it, so the exact boundary can land a float ULP short and derive
      // the LOWER level (levels 6/9/10 do). +1 xp crosses robustly without over-shooting.
      ctx.scoreState.xp = xpForLevel(level) + 1;
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      expect(ctx.levelSystem.level).toBe(level);
      expect(ctx.levelUpSystem.pendingSelections).toBeGreaterThanOrEqual(1);
      slot = ctx.levelUpSystem.currentOffer.findIndex((c) => c.id === 'orbit-blade');
      if (slot < 0) {
        ctx.levelUpSystem.queueSelection(0);
        ctx.world.fixedUpdate(FIXED_STEP_MS);
      }
    }
    expect(slot, 'the real weighted draw never offered orbit-blade').toBeGreaterThanOrEqual(0);

    // Pick it through the real latch. OrbitBladeSystem is registered BEFORE ScoringSystem and
    // thus long before LevelUpSystem — so on the PICK tick the system already ran against the
    // old fold, and LevelUpSystem's fold lands after it. Per the spec's Design Notes that is a
    // deliberate one-tick lag (the same one every in-band item system accepts): the fold is
    // live in the SHARED store immediately, but the blade materialises on the NEXT tick.
    ctx.levelUpSystem.queueSelection(slot);
    ctx.world.fixedUpdate(FIXED_STEP_MS);

    expect(ctx.progressionState.ownedCards['orbit-blade']).toBe(1);
    expect(ctx.playerStats.orbitBladeCount).toBe(1); // fold is live in the shared store now…
    expect(ctx.orbitBladeSystem.playerStats).toBe(ctx.playerStats); // shared store, not a copy
    expect(ctx.orbitBladeSystem.pool.activeCount).toBe(0); // …but the blade is one tick behind

    // The very next tick, the system reads the new fold and the blade is live.
    ctx.world.fixedUpdate(FIXED_STEP_MS);
    expect(ctx.orbitBladeSystem.pool.activeCount).toBe(1);
  });

  it('a blade contact KILLS a seeker, SCORES it and drops an XP ORB — the full bullet-kill feedback', () => {
    // The property that distinguishes a blade kill from BombSystem's silent, unscored removal.
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ownOrbitBlade(ctx, 1); // 1 blade, 90 dmg
    const blade = parkAndMaterialize(ctx);

    // Drop a live seeker from the REAL archetype pool exactly on the blade. The ship is at
    // arena centre, the blade (and the enemy) sit a ring-radius away, so the ship itself is
    // never in contact — the KILL is unambiguously the blade's, not a player-death.
    const seeker = ctx.enemySystem.enemyPool.acquire();
    seeker.x = blade.x;
    seeker.y = blade.y;
    seeker.vx = 0;
    seeker.vy = 0;
    seeker.telegraphMs = 0;

    const scoreBefore = ctx.scoreState.score;
    const orbsBefore = ctx.xpOrbSystem.pool.activeCount;
    const particlesBefore = ctx.particleSystem.pool.activeCount;
    const activeRipples = () =>
      ctx.gridFieldSystem.ripples.filter((r) => r.active).length;
    const ripplesBefore = activeRipples();

    // The blade barely rotates in a few ticks, so it stays overlapping and lands the hit.
    // Track the orb PEAK — a drop 56px from the ship may be magnet-collected within a few
    // ticks, and an end-of-run count could read 0 for a drop that really happened.
    let orbPeak = orbsBefore;
    for (let i = 0; i < 4; i++) {
      ctx.world.fixedUpdate(FIXED_STEP_MS);
      orbPeak = Math.max(orbPeak, ctx.xpOrbSystem.pool.activeCount);
    }

    // Killed and released (asserted on the instance, not a pool count a fresh spawn could mask).
    let stillActive = false;
    ctx.enemySystem.enemyPool.forEachActive((s) => {
      if (s === seeker) stillActive = true;
    });
    expect(stillActive).toBe(false);
    // …scored through the ordinary per-kill seam…
    expect(ctx.scoreState.score).toBeGreaterThan(scoreBefore);
    // …an XP orb dropped…
    expect(orbPeak).toBeGreaterThan(orbsBefore);
    // …and a particle burst sprayed and the grid rippled — the FULL kill feedback, identical
    // to a bullet kill, which is exactly what routing through applyPlayerDamage buys.
    expect(ctx.particleSystem.pool.activeCount).toBeGreaterThan(particlesBefore);
    expect(activeRipples()).toBeGreaterThan(ripplesBefore);
  });

  it('a Lv1 blade (90 dmg) ONE-SHOTS an armored (hp 5) through the assembled world — the melee full-damage answer', () => {
    const ctx = buildArenaWorld({ rng: () => 0.5 });
    ownOrbitBlade(ctx, 1); // 1 blade, 90 dmg — the very first rung already one-shots armor
    const blade = parkAndMaterialize(ctx);

    const tank = ctx.armoredSystem.enemyPool.acquire();
    tank.x = blade.x;
    tank.y = blade.y;
    tank.vx = 0;
    tank.vy = 0;
    tank.telegraphMs = 0;
    tank.hp = ARMORED_HP;

    const scoreBefore = ctx.scoreState.score;
    for (let i = 0; i < 4; i++) ctx.world.fixedUpdate(FIXED_STEP_MS);

    // Killed in ONE contact (5 ≤ 90+ε) and scored — the armored archetype that shrugs off
    // single-damage bullets dies to a single blade, through the SAME seam.
    let stillActive = false;
    ctx.armoredSystem.enemyPool.forEachActive((s) => {
      if (s === tank) stillActive = true;
    });
    expect(stillActive).toBe(false);
    expect(ctx.scoreState.score).toBeGreaterThan(scoreBefore);
  });
});
