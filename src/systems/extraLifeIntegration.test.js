import { describe, it, expect } from 'vitest';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { BlackHoleSystem } from './BlackHoleSystem.js';
import { BombSystem } from './BombSystem.js';
import { ExtraLifeSystem } from './ExtraLifeSystem.js';
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
  SCORE_MULTIPLIER_START,
  LIFE_AWARD_SCORE_THRESHOLDS,
  BLACKHOLE_SCORE,
  BLACKHOLE_BULLET_DAMAGE,
  BLACKHOLE_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const T1 = LIFE_AWARD_SCORE_THRESHOLDS[0];

// Extra-life tick-order integration (Story 3.3). The unit tests exercise
// ExtraLifeSystem in isolation; this file composes the REAL systems over ONE
// shared ScoreState + PlayerState + ship + pools in the exact fixed-step order
// ArenaScene registers them —
//   CollisionSystem → ScoringSystem → BlackHoleSystem → BombSystem →
//   ExtraLifeSystem → PlayerDeath
// — and pins the load-bearing placement (after Scoring/BlackHole/Bomb so the score
// is fully settled, before PlayerDeath so an earned life is banked before the death
// check):
//   (a) a same-tick threshold-crossing kill on the LAST life banks the life before
//       the death check → the player respawns and the run continues (not game over);
//   (b) a last-life lethal contact with NO threshold crossed still ends the game at
//       0 lives, exactly as today;
//   (c) a black-hole detonation whose payout carries the score across a threshold
//       awards the life that SAME tick — ExtraLifeSystem runs after BlackHoleSystem,
//       so the payout is caught with no one-tick lag (the settled-score guarantee).
// Phaser-free, deterministic (hand-placed instances + a fixed rng).

// Deterministic rng cycling a fixed sequence in [0,1). The Black Hole never spawns
// in these tests (its interval ≫ one DT), so this only pins determinism.
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

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
  // BlackHoleSystem sits after Scoring and before Bomb, exactly as ArenaScene
  // registers it; its detonation payout is credited to the shared scoreState, and
  // the collision system is late-bound as the scene does. A fresh hole pool has no
  // active holes, so it is inert (behavior-neutral) for the cases that add none.
  const blackHoleSystem = new BlackHoleSystem(
    ship,
    bulletPool,
    enemyPools,
    enemyPool, // fed-seeker target pool (the shared seeker pool), as ArenaScene
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
  // Constructed at score 0 (fresh-run semantics) → cursor seeded past no
  // thresholds, so the first crossing this run awards, mirroring ArenaScene.
  const extraLifeSystem = new ExtraLifeSystem(scoreState, playerState);
  const playerDeathSystem = new PlayerDeathSystem(
    ship,
    enemyPools,
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
    extraLifeSystem,
    playerDeathSystem,
  };
}

// One simulated fixed tick in ArenaScene's exact registration order.
function runTick(ctx) {
  ctx.collisionSystem.fixedUpdate(DT);
  ctx.scoringSystem.fixedUpdate(DT);
  ctx.blackHoleSystem.fixedUpdate(DT);
  ctx.bombSystem.fixedUpdate(DT);
  ctx.extraLifeSystem.fixedUpdate(DT);
  ctx.playerDeathSystem.fixedUpdate(DT);
}

// An ACTIVE (telegraphMs 0) seeker at (x,y) with an optional per-instance score.
function addSeeker(pool, x, y, score) {
  const s = pool.acquire();
  s.x = x;
  s.y = y;
  s.vx = 0;
  s.vy = 0;
  s.telegraphMs = 0;
  if (score !== undefined) s.score = score;
  return s;
}

// A bullet parked directly over (x,y) so CollisionSystem destroys the enemy there.
function addBullet(pool, x, y) {
  const b = pool.acquire();
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
  return b;
}

describe('Extra-life integration — full tick chain in ArenaScene order', () => {
  it('(a) same-tick rescue: a threshold-crossing kill on the last life banks the life before the death check → player respawns, run continues', () => {
    const ctx = makeComposed();
    const { ship, bulletPool, enemyPool, scoreState, playerState } = ctx;
    ship.x = 400;
    ship.y = 400;
    playerState.lives = 1; // LAST life
    playerState.invulnMs = 0; // vulnerable → the overlapping enemy is lethal

    // Enemy A: killed by a bullet this tick; its score pushes the running score
    // across the first life threshold. Parked far from the ship so it is NOT the
    // lethal contact — the bullet destroys it before the death check.
    const scoreAward = 500;
    scoreState.score = T1 - scoreAward; // one kill at 1× lands exactly on T1
    addSeeker(enemyPool, 900, 500, scoreAward);
    addBullet(bulletPool, 900, 500);

    // Enemy B: a SEPARATE active enemy overlapping the ship → the lethal contact.
    addSeeker(enemyPool, 400, 400);

    runTick(ctx);

    // The kill crossed T1: ExtraLife banked +1 (1→2) BEFORE the death check, which
    // then consumed one on enemy B's lethal contact (2→1) → respawn, run continues.
    expect(scoreState.score).toBeGreaterThanOrEqual(T1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.lives).toBe(1); // 1 (+1 award) (−1 death) = 1, respawned
    expect(playerState.invulnMs).toBeGreaterThan(0); // respawn granted invuln
  });

  it('(b) contrast: a last-life lethal contact with NO threshold crossed still ends the game at 0 lives', () => {
    const ctx = makeComposed();
    const { ship, enemyPool, scoreState, playerState } = ctx;
    ship.x = 400;
    ship.y = 400;
    playerState.lives = 1; // LAST life
    playerState.invulnMs = 0;

    // Score sits just below the first threshold and no kill occurs this tick, so
    // ExtraLifeSystem awards nothing.
    scoreState.score = T1 - 1;

    // A lethal contact overlapping the ship, with no bullet to kill it.
    addSeeker(enemyPool, 400, 400);

    runTick(ctx);

    // No life earned → the last-life death ends the run at 0, exactly as today.
    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
    expect(scoreState.score).toBe(T1 - 1); // ExtraLife never wrote the score
  });

  it('(c) black-hole payout crosses a threshold → the life is awarded that SAME tick (no one-tick lag)', () => {
    const ctx = makeComposed();
    const { ship, bulletPool, blackHoleSystem, scoreState, playerState } = ctx;
    // Ship parked far from the hole so gravity/contact are irrelevant.
    ship.x = 1000;
    ship.y = 600;

    // A live, active hole one absorb away from detonation (hp == one bullet's
    // damage), placed away from the ship. A bullet parked over its body is absorbed
    // by BlackHoleSystem this tick → hp → 0 → BLACKHOLE_SCORE payout.
    const hole = blackHoleSystem.holePool.acquire();
    hole.x = 200;
    hole.y = 200;
    hole.radius = BLACKHOLE_RADIUS;
    hole.hp = BLACKHOLE_BULLET_DAMAGE; // one absorb detonates it
    hole.feed = 0;
    hole.telegraphMs = 0; // active
    const b = bulletPool.acquire();
    b.x = 200;
    b.y = 200;
    b.vx = 0;
    b.vy = 0;

    // Seed the score so ONLY the black-hole payout carries it across the first
    // threshold (nothing else scores this tick).
    scoreState.score = T1 - BLACKHOLE_SCORE;
    const livesBefore = playerState.lives;

    runTick(ctx);

    // The hole detonated (payout credited) and the score reached the threshold…
    expect(blackHoleSystem.holePool.activeCount).toBe(0);
    expect(scoreState.score).toBeGreaterThanOrEqual(T1);
    // …and ExtraLifeSystem — running AFTER BlackHoleSystem — banked the life the
    // same tick, with no one-tick lag.
    expect(playerState.lives).toBe(livesBefore + 1);
    expect(playerState.gameOver).toBe(false);
  });

  it('sanity: the composed chain leaves a fresh run at start values with no kill and no contact', () => {
    const ctx = makeComposed();
    const { scoreState, playerState } = ctx;
    runTick(ctx);
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START);
    expect(playerState.gameOver).toBe(false);
    // No threshold crossed → lives unchanged from the fresh-run start.
    expect(playerState.lives).toBe(createPlayerState().lives);
  });
});
