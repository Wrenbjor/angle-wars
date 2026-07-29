import {
  SPAWN_DIRECTOR_SEEKER_BASE_WEIGHT,
  SPAWN_DIRECTOR_SEEKER_PEAK_WEIGHT,
  SPAWN_DIRECTOR_GREEN_BASE_WEIGHT,
  SPAWN_DIRECTOR_GREEN_PEAK_WEIGHT,
  SPAWN_DIRECTOR_PINWHEEL_BASE_WEIGHT,
  SPAWN_DIRECTOR_PINWHEEL_PEAK_WEIGHT,
  SPAWN_DIRECTOR_SNAKE_BASE_WEIGHT,
  SPAWN_DIRECTOR_SNAKE_PEAK_WEIGHT,
  SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT,
  SPAWN_DIRECTOR_REFLECTOR_PEAK_WEIGHT,
  SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT,
  SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT,
} from '../config/constants.js';
import { World } from '../core/World.js';
import { SimClockSystem } from '../systems/SimClockSystem.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { InputState } from '../input/InputState.js';
import { PlayerMovementSystem } from '../systems/PlayerMovementSystem.js';
import { FiringSystem } from '../systems/FiringSystem.js';
import { EnemySystem } from '../systems/EnemySystem.js';
import { GreenSquareSystem } from '../systems/GreenSquareSystem.js';
import { PinwheelSystem } from '../systems/PinwheelSystem.js';
import { SnakeSystem } from '../systems/SnakeSystem.js';
import { MirrorReflectorSystem } from '../systems/MirrorReflectorSystem.js';
import { ArmoredSystem } from '../systems/ArmoredSystem.js';
import { SpawnDirector } from '../systems/SpawnDirector.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { DashSystem } from '../systems/DashSystem.js';
import { OrbitBladeSystem } from '../systems/OrbitBladeSystem.js';
import { SeekerDroneSystem } from '../systems/SeekerDroneSystem.js';
import { MineLayerSystem } from '../systems/MineLayerSystem.js';
import { PiercingLanceSystem } from '../systems/PiercingLanceSystem.js';
import { FlakSystem } from '../systems/FlakSystem.js';

import { ScoringSystem } from '../systems/ScoringSystem.js';
import { DpsTelemetrySystem } from '../systems/DpsTelemetrySystem.js';
import { BlackHoleSystem } from '../systems/BlackHoleSystem.js';
import { BombSystem } from '../systems/BombSystem.js';
import { ExtraLifeSystem } from '../systems/ExtraLifeSystem.js';
import { NaniteShieldSystem } from '../systems/NaniteShieldSystem.js';
import { PlayerDeathSystem } from '../systems/PlayerDeathSystem.js';
import { HighScoreSystem } from '../systems/HighScoreSystem.js';
import { createHighScoreStorage } from '../persistence/highScoreStorage.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createScoreState } from '../state/ScoreState.js';
import { GridFieldSystem } from '../systems/GridFieldSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { XpOrbSystem } from '../systems/XpOrbSystem.js';
import { LevelSystem } from '../systems/LevelSystem.js';
import { LevelUpSystem } from '../systems/LevelUpSystem.js';
import { FusionSystem } from '../systems/fusionSystem.js';
import { createProgressionState } from '../state/ProgressionState.js';
import { createPlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import { ScreenFeedbackSystem } from '../systems/ScreenFeedbackSystem.js';
import { AudioDirectorSystem } from '../systems/AudioDirectorSystem.js';

// buildArenaWorld — the shared, Phaser-free ordered-system factory.
//
// This is the verbatim extraction of the world-construction code that
// ArenaScene.create() used to inline: the same World, the same ship + input +
// state + pools, the SAME 30 systems registered in the SAME order (Story 6.3 added
// the MirrorReflectorSystem in the enemy section; Story 8.1 added the XpOrbSystem
// after the BombSystem late-bind; Story 8.2 added the LevelSystem right after it;
// Story 8.3 added the LevelUpSystem right after LevelSystem; Story 9.1 added the
// DpsTelemetrySystem right after ScoringSystem; Story 9.3 added the ArmoredSystem in
// the enemy section, after MirrorReflectorSystem and before SpawnDirector; Story 10.4
// added the NaniteShieldSystem after ExtraLifeSystem and before PlayerDeathSystem;
// Story 10.5 added the DashSystem immediately after CollisionSystem and before
// ScoringSystem; Story 11.1 added the OrbitBladeSystem immediately after DashSystem and
// before ScoringSystem, mirroring the dash's load-bearing slot; Story 11.2 added the
// SeekerDroneSystem immediately after OrbitBladeSystem and before ScoringSystem, the same
// load-bearing slot; Story 11.3 added the MineLayerSystem immediately after SeekerDroneSystem
// and before ScoringSystem, the same load-bearing slot; Story 11.4 added the
// PiercingLanceSystem immediately after MineLayerSystem and before ScoringSystem, the same
// load-bearing slot), the same
// enemyPools / deathPools composition (the reflector pool is deliberately in NEITHER;
// the armored pool IS in both), and both load-bearing
// late-binds
// (snakeSystem.collisionSystem and blackHoleSystem.collisionSystem). It imports
// ZERO Phaser symbols so it runs headlessly in the node vitest env, which is
// what makes the load-bearing wiring assertable (the scene itself needs a live
// Phaser context and cannot be unit-tested).
//
// The scene consumes it for CONSTRUCTION and assigns each returned handle onto
// this.* (keeping all Phaser/render setup — graphics, input sampler, audio
// engine, FixedTimestep — inline). The integration tests consume it for
// CONSTRUCTION only, then drive a curated subset of the chain over hand-placed
// entities.
//
// rng: when omitted (or not a function), undefined flows to each rng-taking
// system so its own `= Math.random` default applies (matching the scene's
// original behavior); when a function is provided, the SAME rng is threaded into
// every rng-taking system. NOTE: a stateful/seeded rng passed here is SHARED
// across all rng-taking systems, so a headless `world.fixedUpdate` run interleaves
// their draws — inject per-system streams if independent sequences matter.
// highScoreStorage: when omitted or null, defaults to createHighScoreStorage()
// (the guarded localStorage port that no-ops when the store is unavailable).
// particleMax: the live-particle cap threaded into the ParticleSystem. When omitted,
// ParticleSystem's own `= PARTICLE_MAX` default applies (byte-identical to today);
// ArenaScene passes the resolved quality profile's (smaller) mobile cap (Story 7.4),
// mirroring the existing optional-injection pattern (rng / highScoreStorage).
export function buildArenaWorld({ rng, highScoreStorage, particleMax } = {}) {
  // Coerce the injected rng once: only a function is honored, so a null/non-function
  // value falls back to each system's own `= Math.random` default (undefined), the
  // same as the no-arg path — never stored raw to throw deep inside a tick.
  const _rng = typeof rng === 'function' ? rng : undefined;
  const world = new World();
  // SimClockSystem gives the pipeline a real, observable job (tick counting).
  const simClock = new SimClockSystem();
  world.addSystem(simClock);

  // --- Player -------------------------------------------------------------
  // The ship is a plain entity moved by the (Phaser-free) movement system
  // inside the fixed-timestep loop. Input is sampled at render rate into a
  // shared InputState the movement system reads at sim rate.
  const ship = createPlayerShip();
  world.addEntity(ship);
  const inputState = new InputState();

  // Runtime player-stat modifier store (Story 10.1): folded from the owned build on
  // each card pick (LevelUpSystem, wired far below), read by the item gameplay seams
  // (Epic 10.2–10.5). Plain data with NO dependencies, so it is created here — above
  // the movement + firing systems — purely so the ONE instance can be threaded into
  // their constructors (Story 10.2: fire cadence + per-bullet damage; Story 10.5:
  // Afterburner's moveSpeedMult). The fold mutates this object IN PLACE, so every
  // consumer holding this reference sees an upgrade with no system reconstruction.
  // Run-scoped, never touched by death.
  const playerStats = createPlayerStats();

  const playerMovementSystem = new PlayerMovementSystem(
    ship,
    inputState,
    // Story 10.5: Afterburner's moveSpeedMult scales BOTH thrust and the speed cap.
    playerStats,
    // Story 10.5: the dash system is LATE-BOUND below (it cannot exist yet — it needs
    // enemyPools and CollisionSystem, which need the whole enemy section first).
    null,
  );
  world.addSystem(playerMovementSystem);

  // --- Firing -------------------------------------------------------------
  // Added after movement so bullets spawn from the ship's post-move position
  // this tick. Owns its own bullet pool (not world.entities). Reads the SHARED
  // playerStats store (Story 10.2) for its effective cadence + stamped bullet damage.
  const firingSystem = new FiringSystem(ship, inputState, playerStats);
  world.addSystem(firingSystem);

  // --- Enemies ------------------------------------------------------------
  // EnemySystem must run after PlayerMovementSystem so seekers home toward the
  // ship's post-move position this tick (firing does not move the ship);
  // CollisionSystem must run after both FiringSystem and EnemySystem so it sees
  // post-move bullet and seeker positions.
  const enemySystem = new EnemySystem(ship, playerStats, _rng);
  world.addSystem(enemySystem);
  // GreenSquareSystem owns its own pool-per-archetype (never merged into the
  // Seeker pool). It runs after EnemySystem and BEFORE CollisionSystem so a
  // provoking latch (bullet within the threat radius) is recorded before a hit
  // can release the square; it reads the bullet pool for that threat detection.
  const greenSquareSystem = new GreenSquareSystem(
    ship,
    firingSystem.bulletPool,
    playerStats,
    _rng,
  );
  world.addSystem(greenSquareSystem);
  // PinwheelSystem owns its own pool-per-archetype (never merged into another
  // enemy pool). It runs after GreenSquareSystem and BEFORE CollisionSystem, and
  // is INDIFFERENT to the player — its constructor takes only an rng (no ship,
  // no bullet pool).
  const pinwheelSystem = new PinwheelSystem(playerStats, _rng);
  world.addSystem(pinwheelSystem);
  // SnakeSystem owns its own shared segment pool-per-archetype (never merged
  // into another enemy pool). It runs after PinwheelSystem and BEFORE
  // CollisionSystem, and is INDIFFERENT to the player. It reads
  // collisionSystem.killedEnemies (late-bound below) only to split the chain
  // where a segment was destroyed the prior tick.
  const snakeSystem = new SnakeSystem(playerStats, _rng);
  world.addSystem(snakeSystem);
  // The shared run-economy and player-lifecycle states are created HERE (Story 6.3),
  // before the enemy-section systems that need them. Both are plain-data objects with
  // no dependencies; nothing reads them until later systems run. The MirrorReflector
  // needs BOTH (a center-destroy credits scoreState.score; a weight-kill sets
  // playerState.pendingDeath), so their creation moved up from the Scoring/Black-Hole
  // sections to keep the one shared instance flowing into every consumer.
  const scoreState = createScoreState();
  const playerState = createPlayerState();
  // Run-scoped card-progression state (Story 8.3): card ownership + the placeholder
  // debug stat. Built beside scoreState/playerState — a plain-data object with no
  // dependencies; the LevelUpSystem (below) mutates it on a card selection. Never
  // touched by the death path, so it resets on a fresh run and survives a non-final
  // death (mirrors scoreState.xp).
  const progressionState = createProgressionState();
  // (playerStats — the runtime modifier store that used to be created here — now
  // lives above the Firing section so the ONE instance can be passed into
  // FiringSystem's constructor. Same object, same lifetime; only the creation point
  // moved. LevelUpSystem still folds into it below.)
  // MirrorReflectorSystem (Story 6.3) owns its own reflector pool (never merged into
  // another enemy pool, and deliberately NOT shared into the CollisionSystem /
  // BombSystem / BlackHole / PlayerDeathSystem circle seams — it is immune to gunfire,
  // bombs, and black-hole absorption, and its lethal region is the weights). It runs
  // after SnakeSystem and BEFORE the SpawnDirector (so it is a spawnable) and BEFORE
  // CollisionSystem/PlayerDeathSystem (so a weight-kill's pendingDeath is consumed the
  // SAME tick). It reads the ship + bullet pool for its reflect/ship tests but is
  // player-indifferent in its MOTION.
  const mirrorReflectorSystem = new MirrorReflectorSystem(
    ship,
    firingSystem.bulletPool,
    playerState,
    scoreState,
    playerStats,
    _rng,
  );
  world.addSystem(mirrorReflectorSystem);
  // ArmoredSystem (Story 9.3) owns its own armored pool (a uniform {x,y,radius,...}
  // enemy PLUS an `hp` field). Unlike the reflector it IS a standard circle-collision
  // enemy: its pool joins enemyPools below, so a single addition wires collision, both
  // AoE paths, and the death seam. It is a slow homing chaser whose distinction is
  // projectile-only durability (CollisionSystem decrements hp; the AoE paths ignore
  // it). It runs after MirrorReflectorSystem and BEFORE the SpawnDirector (so it is a
  // spawnable) and BEFORE CollisionSystem (so a fresh armored exists for this tick's
  // collision/death). Its spawn is gated by a late-bound canSpawn() reading the
  // director's elapsed/pressure (wired after the director is constructed).
  const armoredSystem = new ArmoredSystem(ship, playerStats, _rng);
  world.addSystem(armoredSystem);
  // SpawnDirector is the SOLE spawn authority for the four combat archetypes
  // (each no longer self-spawns). It is added AFTER SnakeSystem and BEFORE
  // CollisionSystem so a fresh enemy exists for this tick's collision/death
  // exactly as the old end-of-update self-spawn did. It owns the escalating
  // ramp and the global active cap.
  const spawnDirector = new SpawnDirector(
    [
      {
        system: enemySystem,
        baseWeight: SPAWN_DIRECTOR_SEEKER_BASE_WEIGHT,
        peakWeight: SPAWN_DIRECTOR_SEEKER_PEAK_WEIGHT,
      },
      {
        system: greenSquareSystem,
        baseWeight: SPAWN_DIRECTOR_GREEN_BASE_WEIGHT,
        peakWeight: SPAWN_DIRECTOR_GREEN_PEAK_WEIGHT,
      },
      {
        system: pinwheelSystem,
        baseWeight: SPAWN_DIRECTOR_PINWHEEL_BASE_WEIGHT,
        peakWeight: SPAWN_DIRECTOR_PINWHEEL_PEAK_WEIGHT,
      },
      {
        system: snakeSystem,
        baseWeight: SPAWN_DIRECTOR_SNAKE_BASE_WEIGHT,
        peakWeight: SPAWN_DIRECTOR_SNAKE_PEAK_WEIGHT,
      },
      // Fifth governed spawnable (Story 6.3): the Mirror Reflector. NOT a one-hit
      // archetype, but it spawns through the same director + telegraph and counts
      // toward the global cap. Its own REFLECTOR_MAX_ACTIVE self-cap (enforced in its
      // spawn()) bounds it independently, since it is unkillable by fire.
      {
        system: mirrorReflectorSystem,
        baseWeight: SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT,
        peakWeight: SPAWN_DIRECTOR_REFLECTOR_PEAK_WEIGHT,
      },
      // Sixth governed spawnable (Story 9.3): the Armored enemy. A standard
      // circle-collision archetype (its pool IS in enemyPools) with flat mix weights
      // (base === peak) — its temporal/pressure canSpawn() gate, not the 2-minute
      // weight ramp, holds it back until ~15:00 or a strong build (director pressure).
      {
        system: armoredSystem,
        baseWeight: SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT,
        peakWeight: SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT,
      },
    ],
    // rng (run-scoped randomness); pass the ship so the director keeps every
    // spawn point ≥ SPAWN_SAFE_RADIUS from the player (Story 2.6). The avoid
    // point flows only as a spawn() argument — Pinwheel/Snake never store the
    // ship and stay player-indifferent in their motion.
    _rng,
    ship,
  );
  world.addSystem(spawnDirector);
  // Late-bind the SpawnDirector back-reference into the ArmoredSystem now that the
  // director exists (Story 9.3): its canSpawn() reads the director's elapsed/pressure
  // for the time-OR-build-power spawn gate. Mirrors the spawnDirector.dpsTelemetry
  // late-bind. Until this is set canSpawn() returns false (the armored never spawns
  // without its gate source).
  armoredSystem.spawnDirector = spawnDirector;
  // The shared collision seam sees ALL archetype pools as an array, so a bullet
  // can destroy any enemy through one path (no per-type duplicate). The armored pool
  // joins the list too (Story 9.3): this single addition wires it into the collision
  // seam, the bomb clear, the black-hole absorption, and the deathPools below.
  const enemyPools = [
    enemySystem.enemyPool,
    greenSquareSystem.enemyPool,
    pinwheelSystem.enemyPool,
    snakeSystem.enemyPool,
    armoredSystem.enemyPool,
  ];
  // Late-bind the combat enemy pools onto the FiringSystem for Ricochet Rounds Lv5 seek
  // steering (Story 11.5): enemyPools is assembled HERE, after FiringSystem was constructed,
  // the same late-bind pattern snakeSystem.collisionSystem uses below. Until this is set the
  // seek scan is a guarded no-op (a null enemyPools keeps the pre-11.5 behaviour).
  firingSystem.enemyPools = enemyPools;
  const collisionSystem = new CollisionSystem(
    firingSystem.bulletPool,
    enemyPools,
  );
  world.addSystem(collisionSystem);
  // Late-bind the collision system into the SnakeSystem now that it exists (the
  // segment pool had to be constructed first so the collision system could
  // reference it). Until this is set the snake's split reap is a guarded no-op.
  snakeSystem.collisionSystem = collisionSystem;

  // --- Afterburner dash (Story 10.5) --------------------------------------
  // Registered IMMEDIATELY after CollisionSystem and BEFORE ScoringSystem. That slot is
  // load-bearing in THREE directions:
  //   - AFTER CollisionSystem, so a Lv4+ dash kill appends to per-tick kill latches that
  //     system has ALREADY RESET this tick (registering earlier would drop them into
  //     arrays about to be cleared);
  //   - BEFORE ScoringSystem — and therefore before DpsTelemetrySystem, XpOrbSystem,
  //     GridFieldSystem and ParticleSystem — so a dash kill is SCORED and produces the
  //     full kill feedback (XP orb, ripple, spray, SFX), unlike BombSystem's
  //     deliberately silent removal;
  //   - necessarily LATER than PlayerMovementSystem, which is why movement reads the
  //     dash window one fixed step after it opens (see DashSystem's `movementActive`).
  // Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools`.
  const dashSystem = new DashSystem(
    ship,
    inputState,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  world.addSystem(dashSystem);
  // Late-bind the dash into the movement system now that it exists (the same pattern as
  // snakeSystem.collisionSystem above): PlayerMovementSystem is registered at slot 2,
  // long before enemyPools/CollisionSystem exist, yet it is the SOLE writer of the
  // ship's velocity and must apply the dash burst. Until this is set the dash branch is
  // a guarded no-op and movement is exactly the pre-10.5 path.
  playerMovementSystem.dashSystem = dashSystem;

  // --- Orbit Blade (Story 11.1 / Epic 11) ---------------------------------
  // The first Epic-11 EXOTIC item: a ring of rotating melee blades. Owns its own blade
  // Pool + the accumulating rotation phase (the shared playerStats store owns only the
  // derived count/damage/period/radius-mult). Registered IMMEDIATELY after DashSystem and
  // BEFORE ScoringSystem — mirroring the dash's load-bearing slot exactly:
  //   - AFTER CollisionSystem, so a blade kill appends to per-tick kill latches that
  //     system has ALREADY RESET this tick (registering earlier would drop them into
  //     arrays about to be cleared);
  //   - BEFORE ScoringSystem — and therefore before DpsTelemetrySystem, XpOrbSystem,
  //     GridFieldSystem and ParticleSystem — so a blade kill is SCORED and produces the
  //     full kill feedback (XP orb, ripple, spray, SFX), exactly like a bullet kill.
  // Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools` — the Black
  // Hole and the Mirror Reflector are out of scope (the same scoping DashSystem._sweep /
  // NaniteShieldSystem._pulse apply). Routes every hit through
  // collisionSystem.applyPlayerDamage, so armor/scoring/XP behave as for a bullet — which
  // is what makes a 90-damage blade a FULL-damage kill against the armored archetype.
  const orbitBladeSystem = new OrbitBladeSystem(
    ship,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  world.addSystem(orbitBladeSystem);

  // --- Seeker Drones (Story 11.2 / Epic 11) -------------------------------
  // The second Epic-11 EXOTIC item: autonomous shooters that ride a ring around the ship
  // and fire pooled shots (Lv4+ HOMING) at the nearest combat enemy on their own cadence.
  // Owns TWO pooled systems — the drone Pool + the shot Pool — plus the per-drone fire
  // accumulators and the ring's rotation phase (the shared playerStats store owns only the
  // derived count/damage/period/homing). Registered IMMEDIATELY after OrbitBladeSystem and
  // BEFORE ScoringSystem — the same load-bearing slot the blade and the dash use:
  //   - AFTER CollisionSystem, so a drone-shot kill appends to per-tick kill latches that
  //     system has ALREADY RESET this tick (registering earlier would drop them into arrays
  //     about to be cleared);
  //   - BEFORE ScoringSystem — and therefore before DpsTelemetrySystem, XpOrbSystem,
  //     GridFieldSystem and ParticleSystem — so a drone kill is SCORED and produces the full
  //     kill feedback (XP orb, ripple, spray, SFX), exactly like a bullet kill.
  // Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools` — the Black Hole
  // and the Mirror Reflector are out of scope (the same scoping OrbitBladeSystem /
  // DashSystem apply). Routes every hit through collisionSystem.applyPlayerDamage, so a shot
  // is a PROJECTILE the armored archetype resists exactly as it resists a bullet.
  const seekerDroneSystem = new SeekerDroneSystem(
    ship,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  world.addSystem(seekerDroneSystem);

  // --- Mine Layer (Story 11.3 / Epic 11) ----------------------------------
  // The third Epic-11 EXOTIC item and the first AoE-DETONATION entity: the kiting ship drops
  // timed mines in its wake that arm, then detonate on an approaching enemy, dealing FULL AoE
  // damage. Owns its own mine Pool + the drop accumulator (the shared playerStats store owns
  // only the derived drop-period/cap/detonate-radius/pull/chain). Registered IMMEDIATELY after
  // SeekerDroneSystem and BEFORE ScoringSystem — the same load-bearing slot the drone, the
  // blade and the dash use:
  //   - AFTER CollisionSystem, so a mine kill appends to per-tick kill latches that system has
  //     ALREADY RESET this tick (registering earlier would drop them into arrays about to be
  //     cleared);
  //   - BEFORE ScoringSystem — and therefore before DpsTelemetrySystem, XpOrbSystem,
  //     GridFieldSystem and ParticleSystem — so a mine kill is SCORED and produces the full
  //     kill feedback (XP orb, ripple, spray, SFX), exactly like a bullet kill;
  //   - AFTER the movers (CollisionSystem is after them), which is why the Lv4 pull is a
  //     POSITION nudge that accumulates instead of being erased next tick.
  // Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools` — the Black Hole
  // and the Mirror Reflector are out of scope (the same scoping SeekerDroneSystem /
  // OrbitBladeSystem apply). Routes every detonation hit through
  // collisionSystem.applyPlayerDamage, so a 90-damage AoE detonation is a FULL-damage kill
  // against the armored archetype (unlike the projectile-resisted drone shot).
  const mineLayerSystem = new MineLayerSystem(
    ship,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  world.addSystem(mineLayerSystem);

  // --- Piercing Lance (Story 11.4 / Epic 11) ------------------------------
  // The fourth Epic-11 EXOTIC item and the first PIERCING projectile: a slow, heavy bolt
  // auto-fired on a cadence FROM the ship TOWARD the nearest combat enemy that punches THROUGH a
  // line of enemies (pierce 2 → 7), so a dense column clears in one shot. Owns its own bolt Pool
  // + a Lv4+ trail-node Pool + the fire accumulator (the shared playerStats store owns only the
  // derived period/pierce/damage/trail/backward). Registered IMMEDIATELY after MineLayerSystem
  // and BEFORE ScoringSystem — the same load-bearing slot the mine, drone, blade and dash use:
  //   - AFTER CollisionSystem, so a lance kill appends to per-tick kill latches that system has
  //     ALREADY RESET this tick (registering earlier would drop them into arrays about to be
  //     cleared);
  //   - BEFORE ScoringSystem — and therefore before DpsTelemetrySystem, XpOrbSystem,
  //     GridFieldSystem and ParticleSystem — so a lance kill is SCORED and produces the full
  //     kill feedback (XP orb, ripple, spray, SFX), exactly like a bullet kill.
  // Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools` — the Black Hole and
  // the Mirror Reflector are out of scope (the same scoping MineLayerSystem / SeekerDroneSystem
  // apply). Routes every hit (bolt or trail node) through collisionSystem.applyPlayerDamage, so a
  // bolt is a PROJECTILE the armored archetype resists exactly as it resists a bullet — its Lv3+
  // one-shot of armored is purely by MAGNITUDE (lanceDamage 6 > ARMORED_HP 5), not an armor
  // bypass (unlike the mine's full-damage AoE detonation).
  const piercingLanceSystem = new PiercingLanceSystem(
    ship,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  world.addSystem(piercingLanceSystem);

  // --- Flak Burst (Story 11.6 / Epic 11) ----------------------------------
  // The sixth Epic-11 EXOTIC item and second BASE-GUN MODIFIER of the epic: turns every Nth
  // bullet fired into an airburst shell that detonates on enemy impact or wall contact into
  // a radial cluster of fragments. Owns its own fragment Pool (the shared playerStats store
  // owns only the derived cadence/fragments/damageMult/secondary-airburst). Registered
  // IMMEDIATELY after PiercingLanceSystem and BEFORE ScoringSystem — the same load-bearing
  // slot the lance, mine, drone, blade and dash use:
  //   - AFTER CollisionSystem, so a fragment kill appends to per-tick kill latches that system
  //     has ALREADY RESET this tick;
  //   - BEFORE ScoringSystem — and therefore before DpsTelemetrySystem, XpOrbSystem,
  //     GridFieldSystem and ParticleSystem — so a fragment kill is SCORED and produces the
  //     full kill feedback (XP orb, ripple, spray, SFX), exactly like a bullet kill.
  // Scoped to `enemyPools` (the five COMBAT archetypes), never `deathPools`. Routes every
  // hit through collisionSystem.applyPlayerDamage, so a 10+ damage fragment is a FULL-damage
  // kill against the armored archetype (15 damage at Lv3+ > ARMORED_HP 5).
  const flakSystem = new FlakSystem(
    ship,
    enemyPools,
    collisionSystem,
    playerStats,
  );
  world.addSystem(flakSystem);
  firingSystem.flakSystem = flakSystem;
  collisionSystem.flakSystem = flakSystem;


  // --- Scoring ------------------------------------------------------------
  // ScoringSystem runs immediately after CollisionSystem so this tick's kills
  // are already recorded, and before PlayerDeathSystem. It owns no pool; it
  // credits each killed enemy's own base value into the shared ScoreState (created
  // up in the enemy section, Story 6.3, so the MirrorReflector can share it).
  const scoringSystem = new ScoringSystem(collisionSystem, scoreState);
  world.addSystem(scoringSystem);

  // --- Player DPS telemetry (Story 9.1 / Epic 9) --------------------------
  // A pure observer that maintains a rolling ~10s estimate of player weapon
  // output (the build-power signal Story 9.2's adaptive spawn director will
  // consume). Registered immediately AFTER CollisionSystem/ScoringSystem so it
  // reads THIS tick's FINAL collisionSystem.bulletKillCount (the bullet-only
  // count, bomb/black-hole removals excluded). It writes only its own fields —
  // it mutates no pool, score, xp, or player state. Nothing consumes `dps` yet.
  const dpsTelemetrySystem = new DpsTelemetrySystem(collisionSystem);
  world.addSystem(dpsTelemetrySystem);
  // Close the adaptive loop (Story 9.2): late-bind the DPS telemetry into the
  // SpawnDirector's build-adaptive rate governor now that the telemetry system
  // exists (mirrors the snakeSystem.collisionSystem late-bind). The director runs
  // EARLIER in the tick than the telemetry, so its governor reads LAST tick's dps
  // — a harmless, causally-necessary one-tick lag. Until this is set the governor
  // reads dps as 0 (pressure stays 0 → byte-identical v1 behavior).
  spawnDirector.dpsTelemetry = dpsTelemetrySystem;

  // The shared player lifecycle state (playerState) was likewise created up in the
  // enemy section (Story 6.3): the MirrorReflectorSystem, the BlackHoleSystem (a
  // detonation sets playerState.pendingDeath), and the PlayerDeathSystem (consumes it)
  // all share the one instance, so a reflector weight-kill, a detonation, and a contact
  // death route through the same state.

  // --- Black Hole hazard --------------------------------------------------
  // The Black Hole is a stationary, UNSTABLE ticking bomb (Story 6.2). It runs
  // AFTER ScoringSystem (so absorbed enemies it appends to collisionSystem.
  // killedEnemies are removed but NOT scored), BEFORE BombSystem (so a detonation
  // can late-bind bombSystem and reuse its detonateAt screen clear), and BEFORE
  // PlayerDeathSystem (so its holePool joins the death list below AND a detonation's
  // pendingDeath is consumed the same tick). It shares the one playerState.
  const blackHoleSystem = new BlackHoleSystem(
    ship,
    firingSystem.bulletPool,
    enemyPools,
    scoreState,
    playerState,
    playerStats,
    _rng,
  );
  world.addSystem(blackHoleSystem);
  // Late-bind the collision system now that it exists (the hole pool had to be
  // constructed first). Until this is set, enemy absorption is a guarded no-op;
  // gravity and bullet-shrink still run.
  blackHoleSystem.collisionSystem = collisionSystem;

  // --- Smart bombs (Story 3.2) --------------------------------------------
  // BombSystem runs AFTER ScoringSystem + BlackHoleSystem and BEFORE
  // PlayerDeathSystem. It consumes the latched bomb request from the shared
  // InputState, clears the four archetype pools (never the Black Hole), and
  // drives the placeholder shockwave.
  const bombSystem = new BombSystem(
    inputState,
    enemyPools,
    collisionSystem,
    scoreState,
    ship,
    playerStats,
  );
  world.addSystem(bombSystem);
  // Late-bind the bomb system into the BlackHoleSystem (constructed earlier, so it
  // runs first). A hole detonation reuses bombSystem.detonateAt for the identical
  // screen clear. Until this is set a detonation still costs a life + releases the
  // hole; only its screen clear is a guarded no-op. Mirrors the collisionSystem late-bind.
  blackHoleSystem.bombSystem = bombSystem;

  // --- XP orbs (Story 8.1 / Epic 8 progression) ---------------------------
  // The level-up loop's first brick: a SEPARATE economy from `score`. Constructed
  // AFTER the bombSystem late-bind so all three of its drop-report sources already
  // exist and have run THIS tick by the time it ticks — the CollisionSystem's
  // bulletKillX/Y/Xp snapshots, the BlackHoleSystem's defusedX/Y report, and the
  // MirrorReflectorSystem's centerKillX/Y report (all populated earlier in the same
  // fixed tick). It owns its own orb Pool and mutates ONLY that pool + scoreState.xp
  // (a near read-only observer); it drops no XP for bomb-cleared / black-hole-absorbed
  // removals (economy parity). Shares the one ship + scoreState the rest of the world uses.
  const xpOrbSystem = new XpOrbSystem(
    collisionSystem,
    blackHoleSystem,
    mirrorReflectorSystem,
    ship,
    scoreState,
    undefined,
    playerStats,
    enemyPools,
  );
  world.addSystem(xpOrbSystem);
  bombSystem.xpOrbSystem = xpOrbSystem;

  // --- Leveling (Story 8.2 / Epic 8 progression) --------------------------
  // The leveling spine: derives the player's current level + in-level progress
  // purely from scoreState.xp each tick (no accumulated delta state to drift).
  // Registered AFTER XpOrbSystem so it reads this tick's FINAL xp (post-collect),
  // and BEFORE PlayerDeathSystem so Story 8.3's level-up invulnerability can gate
  // there without a later reorder. Reads scoreState only; writes its own fields.
  const levelSystem = new LevelSystem(scoreState);
  world.addSystem(levelSystem);

  // --- Level-up moment & card draft (Story 8.3 / Epic 8 progression) -------
  // The level-up state machine: edge-detects LevelSystem.levelsGainedThisTick,
  // enqueues one owed selection per level crossed, holds the player invulnerable
  // while any selection is pending, and offers a weighted seeded trio (Story 8.4's
  // deterministic weighted-without-replacement draw, routed through the shared `_rng`).
   // Runs AFTER LevelSystem so it reads THIS tick's levelsGainedThisTick, and BEFORE
   // PlayerDeathSystem so its invuln top-up gates death the SAME tick (reusing the
   // existing i-frame gate — no death/collision edit). Writes only its own fields +
   // playerState.invulnMs + (on a pick) progressionState.
   // Story 12.1 — Fusion Core: instantiate the fusion system (pure query module) and
   // thread it into LevelUpSystem so level-up offers guarantee Epic cards when ready.
   const fusionSystem = new FusionSystem();
   const levelUpSystem = new LevelUpSystem(
     levelSystem,
     playerState,
     progressionState,
     ITEM_REGISTRY,
     playerStats,
     _rng,
     fusionSystem,
   );
   world.addSystem(levelUpSystem);

  // --- Player death / lives -----------------------------------------------
  // PlayerDeathSystem runs AFTER CollisionSystem so a seeker destroyed by a
  // bullet this tick is already released and cannot also kill the player. The
  // Black Hole is lethal on contact too, so its holePool is appended to the
  // death list here — but it is deliberately NOT in the CollisionSystem list.

  // --- Extra lives (Story 3.3) --------------------------------------------
  // ExtraLifeSystem runs AFTER ScoringSystem + BlackHoleSystem + BombSystem and
  // BEFORE PlayerDeathSystem. It reads scoreState.score (never writes it) and
  // only ADDS to PlayerState.lives.
  const extraLifeSystem = new ExtraLifeSystem(scoreState, playerState);
  world.addSystem(extraLifeSystem);

  // --- Nanite Shield (Story 10.4) -----------------------------------------
  // Owns the shield's RUNTIME state (the live charge count + the recharge timer);
  // the shared playerStats store owns only the derived MAXIMA. Its slot is
  // load-bearing in BOTH directions:
  //   - AFTER LevelUpSystem, the ONLY place recomputePlayerStats runs, so a pick made
  //     this tick is already folded when the shield syncs its max — the charge the card
  //     just granted is live on the very tick it was picked;
  //   - BEFORE PlayerDeathSystem, so tryAbsorb() reads a count that is current for
  //     this tick rather than one step stale.
  // Given `enemyPools` (NOT deathPools) — the Lv5 break pulse only ever displaces the
  // five combat archetypes; the Black Hole and the Mirror Reflector are immune to AoE,
  // the same scoping BombSystem.detonateAt applies.
  const naniteShieldSystem = new NaniteShieldSystem(ship, enemyPools, playerStats);
  world.addSystem(naniteShieldSystem);

  const deathPools = [...enemyPools, blackHoleSystem.holePool];
  const playerDeathSystem = new PlayerDeathSystem(
    ship,
    deathPools,
    playerState,
    // Story 3.1: the death seam resets the run multiplier on every death.
    scoreState,
    // Story 10.4: the shield gets first refusal on every death that reaches the
    // shared body — both the contact path and the programmatic pendingDeath path.
    naniteShieldSystem,
    // Story 10.5: a Lv3+ dash window suppresses lethal contact entirely, and every
    // death CANCELS an in-flight dash (so a respawn is never flung back out).
    dashSystem,
    // Story 11.8: Reinforced Hull stats (extra lives, respawn i-frames, multiplier softening).
    playerStats,
  );
  world.addSystem(playerDeathSystem);

  // --- Persistent high score (Story 3.4) ----------------------------------
  // HighScoreSystem is registered LAST — AFTER PlayerDeathSystem — so it
  // observes game-over on the very tick it latches and persists the high score
  // then. It funnels all localStorage access through the guarded port, which
  // degrades to a no-op when the store is unavailable.
  const port =
    highScoreStorage == null ? createHighScoreStorage() : highScoreStorage;
  const highScoreSystem = new HighScoreSystem(scoreState, playerState, port);
  world.addSystem(highScoreSystem);

  // --- Deforming grid field system (Story 4.2) ----------------------------
  // Registered LAST — after HighScoreSystem — so within every fixed tick each
  // input it reads is already final. It owns a bounded ripple pool + a single
  // warp target and only writes its own state (no gameplay effect).
  const gridFieldSystem = new GridFieldSystem(
    collisionSystem,
    bombSystem,
    playerDeathSystem,
    blackHoleSystem.holePool,
  );
  world.addSystem(gridFieldSystem);

  // --- Pooled particle system (Story 4.3) ---------------------------------
  // Registered LAST — after GridFieldSystem — so within every fixed tick each
  // input it reads is already final. It owns its own particle Pool and ONLY
  // mutates that pool (no gameplay effect — a pure read-only observer).
  const particleSystem = new ParticleSystem(
    collisionSystem,
    ship,
    inputState,
    _rng,
    particleMax,
    // Story 10.5: the Lv5 burning dash trail (cosmetic only) reads this system's
    // published window through trailActive().
    dashSystem,
  );
  world.addSystem(particleSystem);

  // --- Screen juice & feedback system (Story 4.4) -------------------------
  // Registered LAST — after ParticleSystem — so within every fixed tick each
  // input it reads is already final. It is a PURE read-only observer — it
  // mutates ONLY its own latch fields.
  const screenFeedbackSystem = new ScreenFeedbackSystem(
    collisionSystem,
    bombSystem,
    playerDeathSystem,
    ship,
    enemyPools,
    // Story 7.5: the extra-life award latch source, so the system can edge-detect a
    // life earned and aggregate its LIGHT haptic pulse. extraLifeSystem was
    // constructed above (Story 3.3 section), so the one instance flows here too.
    extraLifeSystem,
  );
  world.addSystem(screenFeedbackSystem);

  // --- Sound & adaptive music system (Story 4.5) --------------------------
  // Registered LAST — after ScreenFeedbackSystem — so within every fixed tick
  // each event source it reads is already final. It is a PURE read-only
  // observer — it mutates ONLY its own latch fields.
  const audioDirector = new AudioDirectorSystem(
    firingSystem,
    collisionSystem,
    bombSystem,
    playerDeathSystem,
    spawnDirector,
    blackHoleSystem,
  );
  world.addSystem(audioDirector);

  return {
    world,
    ship,
    inputState,
    scoreState,
    playerState,
    progressionState,
    playerStats,
    enemyPools,
    deathPools,
    highScoreStorage: port,
    simClock,
    playerMovementSystem,
    firingSystem,
    enemySystem,
    greenSquareSystem,
    pinwheelSystem,
    snakeSystem,
    mirrorReflectorSystem,
    armoredSystem,
    spawnDirector,
    collisionSystem,
    dashSystem,
    orbitBladeSystem,
    seekerDroneSystem,
    mineLayerSystem,
    piercingLanceSystem,
    flakSystem,

    scoringSystem,
    dpsTelemetrySystem,
    blackHoleSystem,
    bombSystem,
    xpOrbSystem,
    levelSystem,
    levelUpSystem,
    extraLifeSystem,
    naniteShieldSystem,
    playerDeathSystem,
    highScoreSystem,
    gridFieldSystem,
    particleSystem,
    screenFeedbackSystem,
    audioDirector,
    fusionSystem,
  };
}
