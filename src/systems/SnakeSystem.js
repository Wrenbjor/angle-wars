import { System } from '../core/System.js';
import { Pool } from '../core/Pool.js';
import { createSnakeSegment } from '../entities/SnakeSegment.js';
import { pickSafeEdgePlacement } from './spawnPlacement.js';
import {
  SNAKE_SEGMENT_RADIUS,
  SNAKE_HEAD_SPEED,
  SNAKE_SEGMENT_SPACING,
  SNAKE_SEGMENT_COUNT,
  SNAKE_SLITHER_AMPLITUDE_RAD,
  SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC,
  SNAKE_SEGMENT_POOL_PREWARM,
  ENEMY_SPAWN_TELEGRAPH_MS,
  SPAWN_SAFE_RADIUS,
  SPAWN_PLACEMENT_MAX_ATTEMPTS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_BORDER_INSET,
} from '../config/constants.js';

// SnakeSystem — the Snake archetype: split-on-kill + slither/follow (Phaser-free).
//
// Runs inside world.fixedUpdate(dt) at the constant fixed step (after the other
// enemy systems, BEFORE the CollisionSystem), so slither cadence and motion are
// identical regardless of render frame rate. Owns ONE shared segment
// Pool (the single source of active/free truth — segments are NOT in
// world.entities; the pool is exposed as `enemyPool` for the collision/death
// systems and the renderer). Also exposes `snakes`: the active snake structs
// { segments[], headingRad, slitherPhaseRad } where segments[0] is the head.
//
// The Snake is INDIFFERENT to the player: this system never reads the ship or the
// bullet pool for motion. Its ONLY cross-system read is `collisionSystem.killedEnemies`
// (the same post-collision reaction seam the ScoringSystem consumes) to detect
// which of its segments were destroyed the PRIOR tick and split the chain. Because
// this system runs before the CollisionSystem, that report is last tick's kills;
// collisionSystem is late-bound by the scene (the pool must exist before the
// collision system that references it), so the reap is a guarded no-op until set.
//
// Each fixed step, in order:
//   1. Reap/split: for each snake, partition its segment list into maximal
//      contiguous runs of survivors (identity lookup against the killed set —
//      foreign archetypes' kills never match). The run containing the original
//      head (index 0) keeps the original struct + head state; each later run
//      becomes a new snake whose head re-derives headingRad from the body axis
//      (or inherits the base heading if it is a lone segment). A snake reduced to
//      zero segments is removed.
//   2. Move: per snake, advance the slither phase, integrate the head along its
//      slither-modulated heading, reflect the BASE heading off the walls (clamp +
//      reflect), then pull each body segment head→tail to exactly the fixed
//      spacing behind its leader (a geometric, dt-free position constraint).
//
// This system NO LONGER self-spawns: the SpawnDirector is the sole spawn
// authority and drives the public `spawn()` (its old `_spawnOne`), which still
// pushes a full SEGMENT_COUNT chain on a random arena edge, its segments trailing
// outward behind an inward-pointing head.
//
// The steady-state move path allocates nothing: the pool recycles freed instances
// and the prewarm builds the free list up front. Snake-struct / segment-array
// allocation happens ONLY on spawn and split events, never per frame.
export class SnakeSystem extends System {
  /**
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for the spawn
   *   edge and placement; injectable so spawn cadence/placement are unit-testable.
   *   NO ship or bullet pool — the snake is indifferent to the player.
   */
  constructor(rng = Math.random) {
    super();
    this._rng = rng;

    /** Shared pool of snake segments — the single source of active/free truth
     *  (public for the collision/death systems and the renderer). */
    this.enemyPool = new Pool(createSnakeSegment);
    // Prewarm: build the free list up front so steady-state spawns never hit the
    // factory (no allocation once running). Acquire then release so the instances
    // land on the free stack.
    const warm = [];
    for (let i = 0; i < SNAKE_SEGMENT_POOL_PREWARM; i++) {
      warm.push(this.enemyPool.acquire());
    }
    for (let i = 0; i < warm.length; i++) {
      this.enemyPool.release(warm[i]);
    }

    /** Active snakes. Each: { segments: Segment[], headingRad, slitherPhaseRad }.
     *  segments[0] is the head. Public for the renderer. */
    this.snakes = [];

    // Late-bound by the scene AFTER the collision system is constructed (the pool
    // must exist first). Until set, the reap is a guarded no-op.
    this.collisionSystem = null;

    // Reusable scratch for the reap so a kill-free tick allocates nothing: the
    // killed-set lookup and the rebuilt snake list. Split events allocate the run
    // arrays / new snake structs (not per frame).
    this._killedSet = new Set();
    this._nextSnakes = [];
  }

  /**
   * Advance one fixed step: reap/split, then slither+integrate+follow each snake.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    this._reap();
    this._move(dt);
  }

  /**
   * Split each snake at the segments destroyed the prior tick. Reads
   * collisionSystem.killedEnemies (the established post-collision reaction seam);
   * a guarded no-op until the collision system is late-bound and when there were
   * no kills. Partitions each affected snake's segment list into maximal
   * contiguous runs of survivors: the run at original index 0 keeps the original
   * struct + head state; each later run becomes a new snake. A snake reduced to
   * zero segments is dropped.
   * @private
   */
  _reap() {
    const cs = this.collisionSystem;
    if (!cs) return;
    const killed = cs.killedEnemies;
    if (!killed || killed.length === 0) return; // fast path — no allocation

    // Identity set of everything killed this-tick-prior (any archetype). Foreign
    // archetypes' instances simply never match our segments.
    const killedSet = this._killedSet;
    killedSet.clear();
    for (let i = 0; i < killed.length; i++) killedSet.add(killed[i]);

    const snakes = this.snakes;
    const next = this._nextSnakes;
    next.length = 0;

    for (let si = 0; si < snakes.length; si++) {
      const snake = snakes[si];
      const segs = snake.segments;

      // Does this snake own any killed segment? If not, carry it through untouched.
      let anyKilled = false;
      for (let i = 0; i < segs.length; i++) {
        if (killedSet.has(segs[i])) {
          anyKilled = true;
          break;
        }
      }
      if (!anyKilled) {
        next.push(snake);
        continue;
      }

      // Partition into maximal runs of survivors. Sentinel at i===segs.length
      // closes a trailing run.
      let run = null;
      let runStartIdx = -1;
      for (let i = 0; i <= segs.length; i++) {
        const boundary = i === segs.length || killedSet.has(segs[i]);
        if (!boundary) {
          if (run === null) {
            run = [];
            runStartIdx = i;
          }
          run.push(segs[i]);
        } else if (run !== null) {
          this._emitRun(run, runStartIdx, snake, next);
          run = null;
        }
      }
      // Any snake with all segments killed emits no runs → removed.
    }

    // Swap the rebuilt list into place (in place — the array reference is stable).
    snakes.length = 0;
    for (let i = 0; i < next.length; i++) snakes.push(next[i]);
    next.length = 0;
  }

  /**
   * Emit one surviving run into the rebuilt snake list. The run containing the
   * original head (starts at index 0) reuses the original struct so the head's
   * base heading + slither phase carry through unchanged. Every later run becomes
   * a new snake whose head re-derives its base heading from the body axis
   * (direction from the second segment to the new head), or inherits the parent's
   * base heading if it is a lone segment; the slither phase is inherited for
   * continuity.
   * @private
   */
  _emitRun(run, runStartIdx, parent, out) {
    if (runStartIdx === 0) {
      // Original head survived: keep the struct and its head state.
      parent.segments = run;
      out.push(parent);
      return;
    }
    // A later run: new snake. Re-derive the base heading from the direction the
    // body trails behind the new head (head minus the next segment). A lone
    // segment has no body axis — and exactly-coincident first two segments have
    // a degenerate axis where atan2(0,0) would return 0 and point the fragment
    // due-east arbitrarily. Bidirectional respacing pushes any non-coincident
    // compressed pair apart, so a degenerate axis now arises only from a truly
    // coincident (dist === 0) pair — which the follow loop's `dist > 0` guard
    // leaves unseparated — or a wall fold. Both cases inherit the parent's base
    // heading instead.
    let headingRad;
    const dx = run.length >= 2 ? run[0].x - run[1].x : 0;
    const dy = run.length >= 2 ? run[0].y - run[1].y : 0;
    if (run.length >= 2 && (dx !== 0 || dy !== 0)) {
      headingRad = Math.atan2(dy, dx);
    } else {
      headingRad = parent.headingRad;
    }
    out.push({
      segments: run,
      headingRad,
      slitherPhaseRad: parent.slitherPhaseRad,
    });
  }

  /**
   * Slither + integrate + wall-reflect each head, then follow-the-leader each body.
   * @private
   */
  _move(dt) {
    const dtSec = dt / 1000;

    // Arena bounce bounds (inset by the radius so a segment stays fully inside).
    const minX = ARENA_BORDER_INSET + SNAKE_SEGMENT_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_BORDER_INSET - SNAKE_SEGMENT_RADIUS;
    const minY = ARENA_BORDER_INSET + SNAKE_SEGMENT_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_BORDER_INSET - SNAKE_SEGMENT_RADIUS;

    const snakes = this.snakes;
    for (let si = 0; si < snakes.length; si++) {
      const snake = snakes[si];
      const segs = snake.segments;
      if (segs.length === 0) continue; // defensive — reaped snakes never appear here
      const head = segs[0];

      // Story 2.6 telegraph gate — the Snake is ONE body: gate the whole chain on
      // the HEAD's telegraph, but decrement EVERY segment's countdown in lockstep
      // (by the fixed-step dt, clamped at 0) so the per-segment field the death
      // seam reads stays consistent (and fragments from a mid-telegraph split
      // inherit identical values). While the head is still telegraphing the whole
      // chain is frozen (no slither/integrate/follow) and non-lethal. On the tick
      // the head reaches 0 the chain falls through and moves + becomes lethal.
      if (head.telegraphMs > 0) {
        for (let i = 0; i < segs.length; i++) {
          segs[i].telegraphMs -= dt;
          if (segs[i].telegraphMs < 0) segs[i].telegraphMs = 0;
        }
        if (head.telegraphMs > 0) continue; // still telegraphing → frozen chain
      }

      // Slither: use the CURRENT phase for the effective heading (so a phase of 0
      // means pure base-heading motion), THEN advance the phase by dt. The phase
      // accumulates ANG_VEL·dtSec/step, so its value over elapsed sim time is
      // tick-size independent.
      const eff =
        snake.headingRad +
        Math.sin(snake.slitherPhaseRad) * SNAKE_SLITHER_AMPLITUDE_RAD;
      snake.slitherPhaseRad += SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC * dtSec;

      // Integrate the head along the slither-modulated heading at a constant speed.
      head.x += Math.cos(eff) * SNAKE_HEAD_SPEED * dtSec;
      head.y += Math.sin(eff) * SNAKE_HEAD_SPEED * dtSec;

      // Wall bounce: clamp the head to the crossed bound AND reflect the BASE
      // heading (the slither continues on top of it). Corners reflect both axes.
      if (head.x < minX) {
        head.x = minX;
        snake.headingRad = Math.PI - snake.headingRad;
      } else if (head.x > maxX) {
        head.x = maxX;
        snake.headingRad = Math.PI - snake.headingRad;
      }
      if (head.y < minY) {
        head.y = minY;
        snake.headingRad = -snake.headingRad;
      } else if (head.y > maxY) {
        head.y = maxY;
        snake.headingRad = -snake.headingRad;
      }

      // Follow-the-leader, head→tail: snap each segment to exactly the fixed
      // spacing behind its already-updated leader — bidirectional. Pulls a
      // stretched gap in AND pushes a compressed gap back out along the current
      // leader→segment axis. Skip the coincident pair (dist 0 has no axis). A
      // geometric constraint with no dt — frame-rate independent by construction.
      for (let i = 1; i < segs.length; i++) {
        const leader = segs[i - 1];
        const seg = segs[i];
        const dx = leader.x - seg.x;
        const dy = leader.y - seg.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          const k = SNAKE_SEGMENT_SPACING / dist; // >1 pushes out, <1 pulls in, 1 no-op
          seg.x = leader.x - dx * k;
          seg.y = leader.y - dy * k;
        }
      }
    }
  }

  /**
   * Spawn one snake on a random arena edge: the head is pinned just inside the
   * edge pointing INWARD (perpendicular to the edge), and its SEGMENT_COUNT
   * segments trail outward behind it at the fixed spacing (partly outside the
   * border — the body is pulled in as the head slithers inward). Story 2.6: the
   * head placement re-rolls (bounded) to keep the point ≥ SPAWN_SAFE_RADIUS from
   * the ship, and EVERY spawned segment starts frozen + non-lethal for
   * ENEMY_SPAWN_TELEGRAPH_MS (the whole chain telegraphs and activates as one
   * body). Public: the SpawnDirector is the sole caller during a run, supplying
   * the ship position as (avoidX, avoidY); the avoid point is a spawn() ARGUMENT
   * only — the Snake stores no ship and stays player-indifferent in its motion.
   * Called with no avoid args the first roll is accepted (back-compat).
   * @param {number} [avoidX] Ship x to keep the spawn away from.
   * @param {number} [avoidY] Ship y to keep the spawn away from.
   */
  spawn(avoidX, avoidY) {
    // Edge placement (edge draw + position draw, re-rolled to avoid the ship);
    // the returned `edge` derives the inward heading — same draw order as pre-2.6.
    const p = pickSafeEdgePlacement(
      this._rng,
      SNAKE_SEGMENT_RADIUS,
      avoidX,
      avoidY,
      SPAWN_SAFE_RADIUS,
      SPAWN_PLACEMENT_MAX_ATTEMPTS,
    );
    const hx = p.x;
    const hy = p.y;

    let headingRad;
    if (p.edge === 0) {
      headingRad = Math.PI / 2; // top edge → point down, into the arena
    } else if (p.edge === 1) {
      headingRad = -Math.PI / 2; // bottom edge → point up, into the arena
    } else if (p.edge === 2) {
      headingRad = 0; // left edge → point right, into the arena
    } else {
      headingRad = Math.PI; // right edge → point left, into the arena
    }

    // Trailing direction: opposite the head's heading. Segment i sits i spacings
    // behind the head along this direction.
    const tdx = -Math.cos(headingRad);
    const tdy = -Math.sin(headingRad);

    const segments = [];
    for (let i = 0; i < SNAKE_SEGMENT_COUNT; i++) {
      const seg = this.enemyPool.acquire();
      seg.x = hx + tdx * SNAKE_SEGMENT_SPACING * i;
      seg.y = hy + tdy * SNAKE_SEGMENT_SPACING * i;
      seg.vx = 0;
      seg.vy = 0;
      // Telegraph every segment identically: the chain freezes + activates as one.
      seg.telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS;
      segments.push(seg);
    }

    this.snakes.push({ segments, headingRad, slitherPhaseRad: 0 });
  }
}
