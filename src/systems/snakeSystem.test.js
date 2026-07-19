import { describe, it, expect } from 'vitest';
import { SnakeSystem } from './SnakeSystem.js';
import { CollisionSystem } from './CollisionSystem.js';
import { ScoringSystem } from './ScoringSystem.js';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { Pool } from '../core/Pool.js';
import { createBullet } from '../entities/Bullet.js';
import { createSnakeSegment } from '../entities/SnakeSegment.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import { createScoreState } from '../state/ScoreState.js';
import { createPlayerState } from '../state/PlayerState.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
  FIXED_STEP_MS,
  SNAKE_SEGMENT_RADIUS,
  SNAKE_HEAD_SPEED,
  SNAKE_SEGMENT_SPACING,
  SNAKE_SEGMENT_COUNT,
  SNAKE_SLITHER_AMPLITUDE_RAD,
  SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC,
  SNAKE_SEGMENT_POOL_PREWARM,
  SNAKE_SEGMENT_SCORE,
  PLAYER_INVULN_MS,
  PLAYER_START_LIVES,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;
const DT_SEC = DT / 1000;

// Arena bounce bounds (inset by the segment radius), shared by several tests.
const MIN_X = ARENA_BORDER_INSET + SNAKE_SEGMENT_RADIUS;
const MAX_X = ARENA_WIDTH - ARENA_BORDER_INSET - SNAKE_SEGMENT_RADIUS;
const MIN_Y = ARENA_BORDER_INSET + SNAKE_SEGMENT_RADIUS;
const MAX_Y = ARENA_HEIGHT - ARENA_BORDER_INSET - SNAKE_SEGMENT_RADIUS;

// Deterministic rng that cycles through a fixed sequence of values in [0,1).
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// The Snake is indifferent to the player: the system takes ONLY an rng.
function makeSystem(rng = seqRng([0.1, 0.5])) {
  return new SnakeSystem(rng);
}

// Directly place a live snake (bypassing random spawn) as a straight chain of
// `count` segments laid out `SPACING` apart along −heading behind the head at
// (hx,hy). Returns the pushed snake struct. Acquires from the system's pool so
// the segments are real pooled instances (routable through the shared seams).
function placeSnake(system, hx, hy, headingRad, count, slitherPhaseRad = 0) {
  const tdx = -Math.cos(headingRad);
  const tdy = -Math.sin(headingRad);
  const segments = [];
  for (let i = 0; i < count; i++) {
    const seg = system.enemyPool.acquire();
    seg.x = hx + tdx * SNAKE_SEGMENT_SPACING * i;
    seg.y = hy + tdy * SNAKE_SEGMENT_SPACING * i;
    seg.vx = 0;
    seg.vy = 0;
    segments.push(seg);
  }
  const snake = { segments, headingRad, slitherPhaseRad };
  system.snakes.push(snake);
  return snake;
}

// A collision-system stand-in that just carries a killedEnemies report, so the
// split reap can be driven with an explicit set of killed segments.
function killReport(killed) {
  return { killedEnemies: killed };
}

describe('SnakeSystem — head slither drift (indifferent to the player)', () => {
  it('at phase 0 moves the head +x by HEAD_SPEED·dtSec (eff = base, sin 0) and advances phase', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 640, 360, 0, 1, 0); // lone head, heading +x
    system.fixedUpdate(DT);
    const head = snake.segments[0];

    // eff = base + sin(0)·amp = base = 0 → pure +x drift.
    expect(head.x).toBeCloseTo(640 + SNAKE_HEAD_SPEED * DT_SEC, 9);
    expect(head.y).toBeCloseTo(360, 9);
    // Phase advanced by ANG_VEL·dtSec.
    expect(snake.slitherPhaseRad).toBeCloseTo(
      SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC * DT_SEC,
      9,
    );
  });

  it('drifts purely from its own slither state — the system exposes no ship', () => {
    const system = makeSystem();
    expect(system.ship).toBeUndefined();
    const snake = placeSnake(system, 400, 400, Math.PI / 2, 1, 0); // heading +y
    system.fixedUpdate(DT);
    const head = snake.segments[0];
    // eff = π/2 (sin 0) → pure +y drift, unrelated to any player position.
    expect(head.x).toBeCloseTo(400, 9);
    expect(head.y).toBeCloseTo(400 + SNAKE_HEAD_SPEED * DT_SEC, 9);
  });

  it('traces a curved serpentine path, not a straight line (AC1)', () => {
    // Base heading +x, phase 0, mid-arena so no wall is reached. eff sweeps
    // base + sin(phase)·amp with amp=π/4, so cos(eff) > 0 throughout (x always
    // advances) while sin(eff) drives a y weave that reverses over a full cycle.
    const system = makeSystem();
    const snake = placeSnake(system, 300, 360, 0, 1, 0);
    const head = snake.segments[0];
    const startX = head.x;
    const startY = head.y;

    // Steps to sweep the phase through a HALF cycle (phase crosses π): with
    // ANG_VEL=3.0 rad/s and DT≈16.67ms, ~ceil(π/(3·DT_SEC)) ≈ 63 steps.
    const halfSteps = Math.ceil(Math.PI / (SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC * DT_SEC));
    for (let i = 0; i < halfSteps; i++) system.fixedUpdate(DT);

    // (a) x advanced — the head moves forward along its base heading.
    expect(head.x).toBeGreaterThan(startX);
    // (b) y deviated above the start (sin(eff) > 0 while phase ∈ (0, π)) — proof
    //     the path is NOT a straight +x line.
    expect(head.y).toBeGreaterThan(startY + 1);

    // Continue to a FULL cycle (phase ≈ 2π): the weave returns y near the start
    // while x keeps advancing — the serpentine signature.
    const peakY = head.y;
    const halfCycleX = head.x;
    for (let i = 0; i < halfSteps; i++) system.fixedUpdate(DT);
    expect(head.x).toBeGreaterThan(halfCycleX); // x keeps advancing
    expect(head.y).toBeCloseTo(startY, 0); // y weaves back toward the start line
    expect(head.y).toBeLessThan(peakY); // and came back down from the peak
  });
});

describe('SnakeSystem — slither phase cadence (frame-rate independence)', () => {
  it('accumulated slither phase over elapsed sim time is tick-size independent', () => {
    const T = 1200; // ms; divisible by both tick sizes below
    const expected = (SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC * T) / 1000;

    function runPhase(tickMs) {
      const system = makeSystem();
      // Mid-arena, small enough T that no wall is reached.
      const snake = placeSnake(system, 640, 360, 0, 1, 0);
      const ticks = Math.round(T / tickMs);
      for (let i = 0; i < ticks; i++) system.fixedUpdate(tickMs);
      return snake.slitherPhaseRad;
    }

    const fine = runPhase(DT);
    const coarse = runPhase(40);
    expect(fine).toBeCloseTo(expected, 9);
    expect(coarse).toBeCloseTo(expected, 9);
    expect(fine).toBeCloseTo(coarse, 9);
  });
});

describe('SnakeSystem — head wall bounce (reflection of the base heading)', () => {
  it('bounces off the +x wall: clamps to maxX, reflects heading → π − heading', () => {
    const system = makeSystem();
    // Just inside maxX, heading +x (phase 0 → eff = heading), fast enough to cross.
    const snake = placeSnake(system, MAX_X - 1, 360, 0, 1, 0);
    system.fixedUpdate(DT);
    const head = snake.segments[0];
    expect(head.x).toBe(MAX_X);
    expect(snake.headingRad).toBeCloseTo(Math.PI - 0, 9);
  });

  it('bounces off the −x wall: clamps to minX, reflects heading → π − heading', () => {
    const system = makeSystem();
    // Just inside minX, heading −x (π), phase 0 → eff = π → moves −x.
    const snake = placeSnake(system, MIN_X + 1, 360, Math.PI, 1, 0);
    system.fixedUpdate(DT);
    const head = snake.segments[0];
    expect(head.x).toBe(MIN_X);
    expect(snake.headingRad).toBeCloseTo(Math.PI - Math.PI, 9); // → 0
  });

  it('bounces off the +y wall: clamps to maxY, reflects heading → −heading', () => {
    const system = makeSystem();
    // Just inside maxY, heading +y (π/2), phase 0 → eff = π/2 → moves +y.
    const snake = placeSnake(system, 640, MAX_Y - 1, Math.PI / 2, 1, 0);
    system.fixedUpdate(DT);
    const head = snake.segments[0];
    expect(head.y).toBe(MAX_Y);
    expect(snake.headingRad).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('bounces off the −y wall: clamps to minY, reflects heading → −heading', () => {
    const system = makeSystem();
    // Just inside minY, heading −y (−π/2), phase 0 → eff = −π/2 → moves −y.
    const snake = placeSnake(system, 640, MIN_Y + 1, -Math.PI / 2, 1, 0);
    system.fixedUpdate(DT);
    const head = snake.segments[0];
    expect(head.y).toBe(MIN_Y);
    expect(snake.headingRad).toBeCloseTo(Math.PI / 2, 9); // −(−π/2)
  });

  it('corner bounce: both axes reflect in one step (x-block then y-block)', () => {
    const system = makeSystem();
    // Just inside the +x/+y corner, heading π/4 (up-right), phase 0 → eff = π/4,
    // fast enough to cross both bounds in one step.
    const snake = placeSnake(system, MAX_X - 1, MAX_Y - 1, Math.PI / 4, 1, 0);
    system.fixedUpdate(DT);
    const head = snake.segments[0];
    expect(head.x).toBe(MAX_X);
    expect(head.y).toBe(MAX_Y);
    // x-block runs first: π − π/4 = 3π/4. Then y-block: −(3π/4) = −3π/4.
    expect(snake.headingRad).toBeCloseTo(-(3 * Math.PI) / 4, 9);
  });
});

describe('SnakeSystem — follow-the-leader (geometric, dt-free)', () => {
  it('snaps a far follower to exactly SPACING behind the (moved) head', () => {
    const system = makeSystem();
    // 2-segment snake but with the follower far behind (200px), collinear on x.
    const snake = placeSnake(system, 400, 360, 0, 1, 0); // start as lone head
    const follower = system.enemyPool.acquire();
    follower.x = 200; // 200px behind the head, far more than SPACING
    follower.y = 360;
    snake.segments.push(follower);

    system.fixedUpdate(DT);
    const head = snake.segments[0];
    // After the head's tiny slither move, the follower is snapped to exactly
    // SPACING behind it along the head→follower line.
    const dist = Math.hypot(head.x - follower.x, head.y - follower.y);
    expect(dist).toBeCloseTo(SNAKE_SEGMENT_SPACING, 6);
  });

  it('does not move a follower already within SPACING of its leader', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 1, 0); // lone head
    const follower = system.enemyPool.acquire();
    follower.x = 400; // co-located with the head (dist 0 < SPACING)
    follower.y = 360;
    snake.segments.push(follower);
    const fx = follower.x;
    const fy = follower.y;

    system.fixedUpdate(DT);
    // The head drifts ~2px away (still < SPACING), so the follower is not pulled.
    expect(follower.x).toBe(fx);
    expect(follower.y).toBe(fy);
  });

  it('moves as a connected body: every adjacent gap collapses toward SPACING (AC1)', () => {
    // Spread the body far apart, then run several steps: the head→tail pull draws
    // each segment to exactly SPACING behind its leader (a connected body).
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 1, 0); // lone head
    for (let i = 1; i < 4; i++) {
      const seg = system.enemyPool.acquire();
      seg.x = 400 - i * 100; // 100px gaps (>> SPACING)
      seg.y = 360;
      snake.segments.push(seg);
    }
    for (let s = 0; s < 30; s++) system.fixedUpdate(DT);

    const segs = snake.segments;
    for (let i = 1; i < segs.length; i++) {
      const d = Math.hypot(segs[i - 1].x - segs[i].x, segs[i - 1].y - segs[i].y);
      // Each gap is pulled to exactly SPACING (never exceeds it once collapsed).
      expect(d).toBeCloseTo(SNAKE_SEGMENT_SPACING, 4);
    }
  });
});

describe('SnakeSystem — split on kill (fragmentation)', () => {
  it('a mid-body kill splits the snake into two independent snakes at the gap (AC3)', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 5, 0.4); // s0..s4
    const [s0, s1, s2, s3, s4] = snake.segments;

    // Simulate the collision system having killed the middle segment last tick.
    system.enemyPool.release(s2); // collision releases the killed segment
    system.collisionSystem = killReport([s2]);

    system.fixedUpdate(DT);

    expect(system.snakes.length).toBe(2);
    const front = system.snakes[0];
    const back = system.snakes[1];
    // Front run keeps the original struct + head state (s0,s1).
    expect(front).toBe(snake);
    expect(front.segments).toEqual([s0, s1]);
    expect(front.slitherPhaseRad).not.toBe(0); // carried the original phase forward
    // Back run is a NEW snake (s3,s4) that re-headed from its body axis.
    expect(back).not.toBe(snake);
    expect(back.segments).toEqual([s3, s4]);
    // The killed segment is gone from every snake.
    for (const sk of system.snakes) expect(sk.segments).not.toContain(s2);
  });

  it('head kill: the front run is empty and the next survivor becomes a new head', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 4, 0);
    const [s0, s1, s2, s3] = snake.segments;

    system.enemyPool.release(s0); // head killed
    system.collisionSystem = killReport([s0]);
    system.fixedUpdate(DT);

    expect(system.snakes.length).toBe(1);
    const only = system.snakes[0];
    // The original head-owning struct is gone; the survivor run is a new snake.
    expect(only).not.toBe(snake);
    expect(only.segments[0]).toBe(s1); // s1 is the new head
    expect(only.segments).toEqual([s1, s2, s3]);
  });

  it('re-derives the new head heading from the body axis (direction second→head)', () => {
    const system = makeSystem();
    // A back run whose body axis points along +x: head s3 at x=200, s4 behind at x=100.
    const snake = placeSnake(system, 400, 360, 0, 5, 0);
    const segs = snake.segments;
    // Reposition the back two so the axis is unambiguous BEFORE the kill.
    segs[3].x = 200;
    segs[3].y = 360;
    segs[4].x = 100;
    segs[4].y = 360;

    system.enemyPool.release(segs[2]);
    system.collisionSystem = killReport([segs[2]]);
    // Freeze just the reap so we read the re-derived heading before the move step
    // integrates it (call the private reap directly).
    system._reap();

    const back = system.snakes[1];
    // heading = atan2(head.y − next.y, head.x − next.x) = atan2(0, 100) = 0 (+x).
    expect(back.headingRad).toBeCloseTo(0, 9);
  });

  it('degenerate split axis (coincident first two survivors) inherits the parent heading', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 5, 0);
    snake.headingRad = 1.234; // a distinctive finite parent heading
    const segs = snake.segments;
    // Force the back run's first two survivors (s3, s4) to share a position so the
    // re-derived body axis is degenerate (atan2(0,0) would return 0 by accident).
    segs[4].x = segs[3].x;
    segs[4].y = segs[3].y;

    system.enemyPool.release(segs[2]);
    system.collisionSystem = killReport([segs[2]]);
    system._reap();

    const back = system.snakes[1];
    expect(back.segments).toEqual([segs[3], segs[4]]);
    expect(Number.isFinite(back.headingRad)).toBe(true);
    expect(back.headingRad).toBe(snake.headingRad); // fell back to the parent heading
  });

  it('a multi-kill in one tick splits into three fragments at the two gaps', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 6, 0); // s0..s5
    const [s0, s1, s2, s3, s4, s5] = snake.segments;

    // Kill two non-adjacent segments (s1 and s3) in the same prior tick.
    system.enemyPool.release(s1);
    system.enemyPool.release(s3);
    system.collisionSystem = killReport([s1, s3]);
    system._reap();

    expect(system.snakes.length).toBe(3);
    // Runs, in order: [s0] (keeps original struct), [s2], [s4,s5].
    expect(system.snakes[0]).toBe(snake); // runStartIdx 0 reuses the struct
    expect(system.snakes[0].segments).toEqual([s0]);
    expect(system.snakes[1].segments).toEqual([s2]);
    expect(system.snakes[2].segments).toEqual([s4, s5]);
  });

  it('a lone trailing fragment inherits the parent base heading (finite)', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 5, 0); // s0..s4
    snake.headingRad = -0.5; // distinctive finite parent heading
    const [, , , s3, s4] = snake.segments;

    // Kill s3 so the tail is a single-segment run [s4].
    system.enemyPool.release(s3);
    system.collisionSystem = killReport([s3]);
    system._reap();

    // Front run keeps the struct ([s0,s1,s2]); back run is the lone [s4].
    const lone = system.snakes[system.snakes.length - 1];
    expect(lone.segments).toEqual([s4]);
    expect(Number.isFinite(lone.headingRad)).toBe(true);
    expect(lone.headingRad).toBe(snake.headingRad);
  });

  it('whole snake killed: it is removed from the active snake list', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 3, 0);
    const all = snake.segments.slice();
    for (const seg of all) system.enemyPool.release(seg);
    system.collisionSystem = killReport(all);

    system.fixedUpdate(DT);
    expect(system.snakes.length).toBe(0);
  });

  it('reap is a guarded no-op until the collision system is late-bound', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 3, 0);
    expect(system.collisionSystem).toBeNull();
    // No collision system → no split even if segments were (externally) freed.
    system.fixedUpdate(DT);
    expect(system.snakes.length).toBe(1);
    expect(system.snakes[0]).toBe(snake);
  });

  it('foreign-archetype kills never match a snake segment (identity lookup)', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 400, 360, 0, 4, 0);
    // A killed instance from some other pool — same shape, different identity.
    const foreign = createSnakeSegment();
    system.collisionSystem = killReport([foreign]);
    system.fixedUpdate(DT);
    expect(system.snakes.length).toBe(1);
    expect(system.snakes[0].segments.length).toBe(4);
  });
});

describe('SnakeSystem — spawn telegraph (whole-chain, Story 2.6)', () => {
  it('spawn() sets telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS on EVERY segment', () => {
    const system = makeSystem(seqRng([0.0, 0.5]));
    system.spawn();
    const snake = system.snakes[0];
    expect(snake.segments.length).toBe(SNAKE_SEGMENT_COUNT);
    for (const seg of snake.segments) {
      expect(seg.telegraphMs).toBe(ENEMY_SPAWN_TELEGRAPH_MS);
    }
  });

  it('freezes the WHOLE chain while the head telegraphs and counts every segment down by dt (AC1)', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 640, 360, 0, 3, 0); // heading +x
    // A follower placed far behind so an ACTIVE move would pull it in — proving
    // the follow-the-leader constraint is also skipped while frozen.
    const far = snake.segments[2];
    far.x = 200;
    far.y = 360;
    for (const seg of snake.segments) seg.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
    const head = snake.segments[0];

    system.fixedUpdate(DT);

    // Head did not slither, the far follower was not pulled — the chain is frozen.
    expect(head.x).toBe(640);
    expect(head.y).toBe(360);
    expect(far.x).toBe(200);
    expect(far.y).toBe(360);
    // Slither phase did not advance (the move step never ran).
    expect(snake.slitherPhaseRad).toBe(0);
    // EVERY segment's countdown advanced in lockstep.
    for (const seg of snake.segments) {
      expect(seg.telegraphMs).toBeCloseTo(ENEMY_SPAWN_TELEGRAPH_MS - DT, 9);
    }
  });

  it('activates as one body on the tick the head telegraph reaches 0 (AC2)', () => {
    const system = makeSystem();
    const snake = placeSnake(system, 640, 360, 0, 3, 0); // heading +x, phase 0
    for (const seg of snake.segments) seg.telegraphMs = DT; // one step from activation

    system.fixedUpdate(DT);

    const head = snake.segments[0];
    // The head slithered this same tick (eff = base +x at phase 0 → moves +x).
    expect(head.x).toBeCloseTo(640 + SNAKE_HEAD_SPEED * DT_SEC, 9);
    // The slither phase advanced (move step ran) and all segments are now active.
    expect(snake.slitherPhaseRad).toBeCloseTo(
      SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC * DT_SEC,
      9,
    );
    for (const seg of snake.segments) expect(seg.telegraphMs).toBe(0);
  });

  it('spawn-point avoidance: re-rolls the head placement away from a ship on the default candidate (AC3)', () => {
    const shipX = MIN_X + 0.5 * (MAX_X - MIN_X);
    const shipY = MIN_Y;
    // top-center head (on ship) → re-roll → bottom-center head (far).
    const system = makeSystem(seqRng([0.0, 0.5, 0.25, 0.5]));
    system.spawn(shipX, shipY);
    const head = system.snakes[0].segments[0];
    const dx = head.x - shipX;
    const dy = head.y - shipY;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
  });

  it('the system never stores a ship — the avoid point is a spawn() argument only', () => {
    const system = makeSystem();
    system.spawn(100, 100);
    expect(system.ship).toBeUndefined();
  });
});

describe('SnakeSystem — no self-spawn / public spawn / placement', () => {
  it('fixedUpdate never spawns on its own, over many intervals with no director', () => {
    const system = makeSystem();
    for (let i = 0; i < 2000; i++) system.fixedUpdate(DT);
    expect(system.snakes.length).toBe(0);
    expect(system.enemyPool.activeCount).toBe(0);
  });

  it('public spawn() pushes exactly one full SEGMENT_COUNT chain per call', () => {
    const system = makeSystem();
    system.spawn();
    expect(system.snakes.length).toBe(1);
    expect(system.enemyPool.activeCount).toBe(SNAKE_SEGMENT_COUNT);
    system.spawn();
    expect(system.snakes.length).toBe(2);
    expect(system.enemyPool.activeCount).toBe(SNAKE_SEGMENT_COUNT * 2);
  });

  it('spawns a full SEGMENT_COUNT chain on an edge with the head inside, body trailing outward', () => {
    // Top edge (edge index 0), free-axis t=0.5 → head at (mid, MIN_Y), heading +y.
    const system = makeSystem(seqRng([0.0, 0.5]));
    system.spawn();
    expect(system.snakes.length).toBe(1);
    const snake = system.snakes[0];
    expect(snake.segments.length).toBe(SNAKE_SEGMENT_COUNT);

    const head = snake.segments[0];
    expect(head.y).toBe(MIN_Y); // head pinned just inside the top edge
    expect(head.x).toBeCloseTo(MIN_X + 0.5 * (MAX_X - MIN_X), 6);
    expect(snake.headingRad).toBeCloseTo(Math.PI / 2, 9); // points into the arena
    // Body trails outward (above the top edge): each segment SPACING further out.
    for (let i = 1; i < snake.segments.length; i++) {
      expect(snake.segments[i].x).toBeCloseTo(head.x, 6);
      expect(snake.segments[i].y).toBeCloseTo(head.y - i * SNAKE_SEGMENT_SPACING, 6);
    }
  });

  it('places the head on each of the four edges with the correct inward heading', () => {
    const cases = [
      { rng: [0.0, 0.5], axis: 'y', at: MIN_Y, heading: Math.PI / 2 }, // top
      { rng: [0.25, 0.5], axis: 'y', at: MAX_Y, heading: -Math.PI / 2 }, // bottom
      { rng: [0.5, 0.5], axis: 'x', at: MIN_X, heading: 0 }, // left
      { rng: [0.75, 0.5], axis: 'x', at: MAX_X, heading: Math.PI }, // right
    ];
    for (const c of cases) {
      const system = makeSystem(seqRng(c.rng));
      system.spawn();
      const snake = system.snakes[0];
      const head = snake.segments[0];
      expect(head[c.axis]).toBe(c.at);
      expect(snake.headingRad).toBeCloseTo(c.heading, 9);
    }
  });
});

describe('SnakeSystem — pool prewarm (NFR2)', () => {
  it('prewarms the shared segment pool and acquires from it on spawn', () => {
    const system = makeSystem();
    expect(system.enemyPool.freeCount).toBe(SNAKE_SEGMENT_POOL_PREWARM);
    expect(system.enemyPool.activeCount).toBe(0);

    system.spawn();
    expect(system.enemyPool.activeCount).toBe(SNAKE_SEGMENT_COUNT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      SNAKE_SEGMENT_POOL_PREWARM,
    );
  });

  it('does not grow the pool over many steady-state move steps after a few spawns', () => {
    const system = makeSystem();
    for (let i = 0; i < 3; i++) system.spawn();
    for (let i = 0; i < 500; i++) system.fixedUpdate(DT);
    expect(system.enemyPool.activeCount + system.enemyPool.freeCount).toBe(
      SNAKE_SEGMENT_POOL_PREWARM,
    );
    // No self-spawn added any; segments only leave via kills (none here).
    expect(system.enemyPool.activeCount).toBe(SNAKE_SEGMENT_COUNT * 3);
  });
});

describe('createSnakeSegment factory', () => {
  it('returns a zeroed uniform {x,y,vx,vy,radius,score} shape', () => {
    const seg = createSnakeSegment();
    expect(seg.x).toBe(0);
    expect(seg.y).toBe(0);
    expect(seg.vx).toBe(0);
    expect(seg.vy).toBe(0);
    expect(seg.radius).toBe(SNAKE_SEGMENT_RADIUS);
    expect(seg.score).toBe(SNAKE_SEGMENT_SCORE);
    expect(seg.telegraphMs).toBe(0); // spawned-and-active default (Story 2.6)
  });
});

describe('SnakeSystem — AC3: bullet kill + scoring through the real shared seams', () => {
  it('a bullet over a segment releases it, consumes the bullet, and credits SNAKE_SEGMENT_SCORE', () => {
    const system = makeSystem();
    const segmentPool = system.enemyPool;
    const snake = placeSnake(system, 400, 400, 0, 5, 0);
    const target = snake.segments[2]; // a middle segment

    // A real bullet overlapping the target segment.
    const bulletPool = new Pool(createBullet);
    const b = bulletPool.acquire();
    b.x = target.x;
    b.y = target.y;

    // The REAL collision + scoring seams over an array containing the segment pool.
    const collision = new CollisionSystem(bulletPool, [segmentPool]);
    const scoreState = createScoreState();
    const scoring = new ScoringSystem(collision, scoreState);

    collision.fixedUpdate(DT);
    scoring.fixedUpdate(DT);

    expect(collision.killedEnemies).toContain(target); // reported killed
    expect(bulletPool.activeCount).toBe(0); // bullet consumed
    expect(segmentPool.activeCount).toBe(4); // the target was released
    expect(scoreState.score).toBe(SNAKE_SEGMENT_SCORE); // scored its own base value

    // Next SnakeSystem step drops the killed segment from its snake (split).
    system.collisionSystem = collision;
    system.fixedUpdate(DT);
    for (const sk of system.snakes) expect(sk.segments).not.toContain(target);
  });
});

describe('SnakeSystem — AC2: ship contact through the real PlayerDeathSystem', () => {
  it('a non-invulnerable ship over ANY segment triggers the standard death flow, segment survives', () => {
    const system = makeSystem();
    const segmentPool = system.enemyPool;
    const ship = createPlayerShip();
    ship.x = 300;
    ship.y = 300;
    const snake = placeSnake(system, 300, 300, 0, 5, 0);
    // Overlap the ship with a BODY segment (not the head) to prove any part is lethal.
    const body = snake.segments[3];
    body.x = 300;
    body.y = 300;

    const playerState = createPlayerState();
    const death = new PlayerDeathSystem(ship, [segmentPool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(PLAYER_START_LIVES - 1);
    expect(playerState.gameOver).toBe(false);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS); // respawn invuln granted
    // Ship contact never destroys the segment (all 5 placed segments remain).
    expect(segmentPool.activeCount).toBe(5);
  });

  it('game-over on the last life (at most one death per step, multiple segments overlapping)', () => {
    const system = makeSystem();
    const segmentPool = system.enemyPool;
    const ship = createPlayerShip();
    ship.x = 300;
    ship.y = 300;
    const snake = placeSnake(system, 300, 300, 0, 5, 0);
    // Force two segments onto the ship — still only ONE death this step.
    snake.segments[0].x = 300;
    snake.segments[0].y = 300;
    snake.segments[1].x = 300;
    snake.segments[1].y = 300;

    const playerState = createPlayerState();
    playerState.lives = 1; // last life
    const death = new PlayerDeathSystem(ship, [segmentPool], playerState);
    death.fixedUpdate(DT);

    expect(playerState.lives).toBe(0);
    expect(playerState.gameOver).toBe(true);
  });
});
