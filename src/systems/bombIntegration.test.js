import { describe, it, expect } from 'vitest';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { BlackHoleSystem } from './BlackHoleSystem.js';
import { BombSystem } from './BombSystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { Pool } from '../core/Pool.js';
import { InputState } from '../input/InputState.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createSeeker } from '../entities/Seeker.js';
import { createBullet } from '../entities/Bullet.js';
import {
  FIXED_STEP_MS,
  PLAYER_START_LIVES,
  SCORE_MULTIPLIER_START,
  BLACKHOLE_RADIUS,
  BLACKHOLE_HP,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Bomb tick-order integration (Story 3.2). The unit tests exercise BombSystem in
// isolation; this file composes the REAL systems over ONE shared ScoreState +
// ship + pools in the exact fixed-step order ArenaScene registers them —
//   CollisionSystem → ScoringSystem → BlackHoleSystem → BombSystem → PlayerDeath
// — and asserts the three load-bearing guarantees from the spec Design Notes that
// the placement (after Scoring, after BlackHole, before PlayerDeath) exists to
// provide:
//   (a) bomb-cleared kills are UNSCORED (BombSystem runs after ScoringSystem),
//   (b) a bomb genuinely RESCUES the player this same tick (before PlayerDeath),
//   (c) the Black Hole is NEVER cleared by a bomb (its holePool is not among the
//       four archetype enemyPools the bomb clears).
// Phaser-free, deterministic (fixed rng, hand-placed instances).

// Deterministic rng cycling a fixed sequence in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Compose the real five-system chain over one shared state. The seeker pool is
// the single archetype pool the bomb/collision/death seams share; the Black Hole
// owns its own holePool (deliberately NOT in enemyPools) and the death seam sees
// [...enemyPools, holePool], mirroring ArenaScene.
function makeComposed() {
  const ship = createPlayerShip();
  const inputState = new InputState();
  const bulletPool = new Pool(createBullet);
  const enemyPool = new Pool(createSeeker);
  const enemyPools = [enemyPool];
  const scoreState = createScoreState();
  const playerState = createPlayerState();

  const collisionSystem = new CollisionSystem(bulletPool, enemyPools);
  const scoringSystem = new ScoringSystem(collisionSystem, scoreState);
  const blackHoleSystem = new BlackHoleSystem(
    ship,
    bulletPool,
    enemyPools,
    enemyPool, // spawn pool for fed seekers (irrelevant here)
    scoreState,
    seqRng([0.5, 0.5]),
  );
  blackHoleSystem.collisionSystem = collisionSystem;
  const bombSystem = new BombSystem(
    inputState,
    enemyPools,
    collisionSystem,
    scoreState,
    ship,
  );
  const deathPools = [...enemyPools, blackHoleSystem.holePool];
  const playerDeathSystem = new PlayerDeathSystem(
    ship,
    deathPools,
    playerState,
    scoreState,
  );

  return {
    ship,
    inputState,
    bulletPool,
    enemyPool,
    scoreState,
    playerState,
    collisionSystem,
    scoringSystem,
    blackHoleSystem,
    bombSystem,
    playerDeathSystem,
  };
}

// One simulated fixed tick in ArenaScene's exact registration order.
function runTick(ctx) {
  ctx.collisionSystem.fixedUpdate(DT);
  ctx.scoringSystem.fixedUpdate(DT);
  ctx.blackHoleSystem.fixedUpdate(DT);
  ctx.bombSystem.fixedUpdate(DT);
  ctx.playerDeathSystem.fixedUpdate(DT);
}

// An ACTIVE (telegraphMs 0) seeker at (x,y).
function addSeeker(pool, x, y) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = 0;
  return s;
}

describe('Bomb integration — full tick chain in ArenaScene order', () => {
  it('(a) unscored clear: a detonation removes enemies without crediting score or advancing the multiplier', () => {
    const ctx = makeComposed();
    const { ship, inputState, enemyPool, scoreState } = ctx;
    // Ship parked far from the enemies so the death seam registers no contact.
    ship.x = 200;
    ship.y = 200;
    // Two active enemies to clear, away from the ship.
    addSeeker(enemyPool, 900, 500);
    addSeeker(enemyPool, 950, 520);
    // A climbed streak + accrued score, to prove NONE of it changes for bomb kills.
    scoreState.score = 500;
    scoreState.multiplier = 5;
    scoreState.multiplierKills = 2;
    const bombsBefore = scoreState.bombs;

    inputState.queueBomb();
    runTick(ctx);

    // Enemies cleared by the bomb.
    expect(enemyPool.activeCount).toBe(0);
    // Bomb spent.
    expect(scoreState.bombs).toBe(bombsBefore - 1);
    // UNSCORED: score + multiplier + progress all untouched (BombSystem runs after
    // ScoringSystem, which already ran this tick over only its bullet-kill report).
    expect(scoreState.score).toBe(500);
    expect(scoreState.multiplier).toBe(5);
    expect(scoreState.multiplierKills).toBe(2);
  });

  it('(a-crosstick) bomb-cleared kills stay UNSCORED on the FOLLOWING tick — CollisionSystem wipes the report before ScoringSystem re-reads it', () => {
    const ctx = makeComposed();
    const { ship, inputState, enemyPool, scoreState } = ctx;
    ship.x = 200;
    ship.y = 200;
    addSeeker(enemyPool, 900, 500);
    addSeeker(enemyPool, 950, 520);
    scoreState.score = 500;
    scoreState.multiplier = 5;
    scoreState.multiplierKills = 2;

    inputState.queueBomb();
    runTick(ctx); // detonation tick — enemies appended to killedEnemies, unscored
    // The bomb's entries are still on the report at the end of the detonation tick
    // (BombSystem runs last-but-one; nothing clears them this tick)…
    expect(ctx.collisionSystem.killedEnemies.length).toBe(2);
    expect(scoreState.score).toBe(500);

    // …and the NEXT tick must NOT score them: CollisionSystem resets killedEnemies
    // at the top of its fixedUpdate, so ScoringSystem never sees the bomb kills.
    runTick(ctx);
    expect(scoreState.score).toBe(500);
    expect(scoreState.multiplier).toBe(5);
    expect(scoreState.multiplierKills).toBe(2);
  });

  it('(b) same-tick rescue: a bomb clears an otherwise-lethal contact before the death check → player survives', () => {
    const ctx = makeComposed();
    const { ship, inputState, enemyPool, playerState } = ctx;
    ship.x = 400;
    ship.y = 400;
    playerState.invulnMs = 0; // NOT invulnerable → contact would be lethal
    addSeeker(enemyPool, 400, 400); // overlapping the ship (lethal contact)

    inputState.queueBomb();
    runTick(ctx);

    // The bomb cleared the enemy before PlayerDeathSystem ran → no death.
    expect(enemyPool.activeCount).toBe(0);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
    expect(playerState.gameOver).toBe(false);
  });

  it('(b-contrast) the SAME lethal contact with NO bomb kills the player (proving the rescue is real)', () => {
    const ctx = makeComposed();
    const { ship, enemyPool, playerState } = ctx;
    ship.x = 400;
    ship.y = 400;
    playerState.invulnMs = 0;
    addSeeker(enemyPool, 400, 400); // same overlapping lethal contact

    // No bomb queued this time.
    runTick(ctx);

    // The death seam works: a life is lost (and the enemy is not cleared).
    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(enemyPool.activeCount).toBe(1); // ship contact never destroys the enemy
  });

  it('(c) the Black Hole is never cleared by a bomb — only the four archetype pools are', () => {
    const ctx = makeComposed();
    const { ship, inputState, enemyPool, blackHoleSystem } = ctx;
    ship.x = 600;
    ship.y = 600;
    // A live, active hole in the BlackHoleSystem-owned holePool (NOT in enemyPools),
    // far from the ship and the enemy so it neither absorbs nor is contacted.
    const hole = blackHoleSystem.holePool.acquire();
    hole.x = 150;
    hole.y = 150;
    hole.radius = BLACKHOLE_RADIUS;
    hole.hp = BLACKHOLE_HP;
    hole.feed = 0;
    hole.telegraphMs = 0; // active
    // A regular archetype enemy, also clear of the hole's gravity, to prove the
    // bomb DID fire this tick.
    const seeker = addSeeker(enemyPool, 1000, 600);

    inputState.queueBomb();
    runTick(ctx);

    // The bomb fired (the archetype enemy is gone), routed through the shared
    // destruction seam — the seeker was appended to collisionSystem.killedEnemies.
    expect(enemyPool.activeCount).toBe(0);
    expect(ctx.collisionSystem.killedEnemies).toContain(seeker);
    // …but the Black Hole's pool is untouched — the hole stays lethal through the
    // detonation.
    expect(blackHoleSystem.holePool.activeCount).toBe(1);
    expect(hole.hp).toBe(BLACKHOLE_HP);
  });

  it('sanity: the composed chain leaves a fresh run at start values with no press', () => {
    const ctx = makeComposed();
    const { scoreState, playerState } = ctx;
    runTick(ctx);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(playerState.lives).toBe(PLAYER_START_LIVES);
  });
});
