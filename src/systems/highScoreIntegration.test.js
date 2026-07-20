import { describe, it, expect } from 'vitest';
import { buildArenaWorld } from '../scenes/buildArenaWorld.js';
import { FIXED_STEP_MS } from '../config/constants.js';

const DT = FIXED_STEP_MS;

// Persistent-high-score tick-order integration (Story 3.4). The unit tests
// exercise HighScoreSystem in isolation; this file composes the REAL systems over
// ONE shared ScoreState + PlayerState + ship + pools in the EXACT fixed-step order
// ArenaScene registers them —
//   CollisionSystem → ScoringSystem → BlackHoleSystem → BombSystem →
//   ExtraLifeSystem → PlayerDeath → HighScore
// — and pins the load-bearing placement HighScoreSystem rests on: registered AFTER
// PlayerDeathSystem, so it observes gameOver on the SAME tick that a last-life
// lethal contact latches it, and persists the beaten score that same latching tick.
//   (a) a kill pushes the score above the stored high on the SAME tick a last-life
//       lethal contact ends the run → HighScoreSystem persists the beaten score
//       that same latching tick.
//   (b) a last-life death whose score never beat the stored high persists nothing.
// Phaser-free, deterministic (hand-placed instances + a fixed rng).

// Deterministic rng cycling a fixed sequence in [0,1). The Black Hole never spawns
// in these tests (its interval ≫ one DT), so this only pins determinism.
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// A fake guarded port recording save()s, seeded with a stored high.
function makeFakePort(stored = 0) {
  return {
    stored,
    saves: [],
    load() {
      return this.stored;
    },
    save(score) {
      this.saves.push(score);
      this.stored = score;
    },
  };
}

// Compose the real chain via the shared factory — the SAME construction (order,
// pools, late-binds) ArenaScene uses — injecting the fake high-score port so the
// HighScoreSystem (registered LAST, after PlayerDeathSystem — the placement under
// test) persists through it. This also fixes the prior drift where
// PlayerDeathSystem was hand-wired with enemyPools; the factory wires it with
// deathPools ([...enemyPools, holePool]). runTick drives a curated subset over
// hand-placed entities, so the factory is used for CONSTRUCTION only.
function makeComposed({ storedHigh = 0 } = {}) {
  const port = makeFakePort(storedHigh);
  const ctx = buildArenaWorld({
    rng: seqRng([0.5, 0.5]),
    highScoreStorage: port,
  });
  return {
    ...ctx,
    port,
    bulletPool: ctx.firingSystem.bulletPool,
    enemyPool: ctx.enemySystem.enemyPool,
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
  ctx.highScoreSystem.fixedUpdate(DT);
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

describe('High-score integration — full tick chain in ArenaScene order', () => {
  it('(a) a beating kill on the last-life game-over tick persists the beaten score that same latching tick', () => {
    const storedHigh = 100;
    const ctx = makeComposed({ storedHigh });
    const { ship, bulletPool, enemyPool, scoreState, playerState, port, highScoreSystem } = ctx;
    ship.x = 400;
    ship.y = 400;
    playerState.lives = 1; // LAST life
    playerState.invulnMs = 0; // vulnerable → the overlapping enemy is lethal

    // The display seeded from the persisted baseline on this fresh run.
    expect(highScoreSystem.highScore).toBe(storedHigh);

    // Enemy A: killed by a bullet this tick; its award pushes the running score
    // above the stored high. Parked far from the ship so it is NOT the lethal
    // contact — the bullet destroys it before the death check. Score kept well
    // below the first life threshold so no extra life rescues the player.
    const scoreAward = 400;
    scoreState.score = 300;
    addSeeker(enemyPool, 900, 500, scoreAward);
    addBullet(bulletPool, 900, 500);

    // Enemy B: a SEPARATE active enemy overlapping the ship → the lethal contact.
    addSeeker(enemyPool, 400, 400);

    runTick(ctx);

    const finalScore = 300 + scoreAward; // 700, at 1× on a fresh run
    // The run ended on the last life…
    expect(playerState.gameOver).toBe(true);
    expect(playerState.lives).toBe(0);
    expect(scoreState.score).toBe(finalScore);
    // …and HighScoreSystem — running AFTER PlayerDeathSystem — observed game-over
    // the same tick, tracked the beaten score, and persisted it exactly once.
    expect(port.saves).toEqual([finalScore]);
    expect(highScoreSystem.highScore).toBe(finalScore);
  });

  it('(b) a last-life death whose score never beat the stored high persists nothing', () => {
    const storedHigh = 8000;
    const ctx = makeComposed({ storedHigh });
    const { ship, enemyPool, scoreState, playerState, port, highScoreSystem } = ctx;
    ship.x = 400;
    ship.y = 400;
    playerState.lives = 1; // LAST life
    playerState.invulnMs = 0;

    // A modest run that never beats the persisted high; no kill this tick.
    scoreState.score = 3000;

    // A lethal contact overlapping the ship, with no bullet to kill it.
    addSeeker(enemyPool, 400, 400);

    runTick(ctx);

    // The run ended…
    expect(playerState.gameOver).toBe(true);
    expect(playerState.lives).toBe(0);
    // …but nothing was persisted and the display stays at the persisted value.
    expect(port.saves).toEqual([]);
    expect(highScoreSystem.highScore).toBe(storedHigh);
  });
});
