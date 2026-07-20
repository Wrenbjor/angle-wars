---
title: 'Snake body segment bidirectional respacing'
type: 'bugfix'
created: '2026-07-20'
status: 'done'
baseline_revision: '08ba09efa67b390c4acf0fe9dd6869a3bb14025a'
final_revision: '83224217acc4e16fcf782c01e5fa8499cd5acc24'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `SnakeSystem`'s follow-the-leader constraint (`SnakeSystem.js` `_move`, ~lines 285–296) repositions a body segment only when `dist > SNAKE_SEGMENT_SPACING` — it pulls a stretched gap inward but never pushes a compressed gap back out. So a chain squeezed below the spacing stays clumped: after the head reverses off a wall and overruns its own trailing segments (DW-14), and after black-hole gravity compresses a chain below spacing (DW-21), the body can stay bunched indefinitely.

**Approach:** Make the constraint bidirectional. The existing geometry (`k = SPACING / dist`; `seg = leader − (dx,dy)·k`) already lands the segment at *exactly* SPACING behind its leader along the current leader→segment axis regardless of whether it started farther or closer — so re-string every non-degenerate gap each tick instead of only over-spaced ones. Keep the whole change inside `SnakeSystem._move`; guard the coincident (`dist === 0`) pair so no divide-by-zero occurs.

## Boundaries & Constraints

**Always:** The constraint stays a dt-free geometric position constraint (frame-rate independent). Each adjacent gap is set to exactly `SNAKE_SEGMENT_SPACING`, measured along the current leader→segment axis. The push preserves the segment's side of its leader (it moves along the same axis, never flips to the leader's far side). Every segment remains an individual pooled instance in `enemyPool` — respacing only mutates `x`/`y`, never identity, membership, or count, so all segments stay individually lethal/killable. Telegraph gating and the reap/split path are untouched.

**Block If:** Achieving re-separation appears to require reading `BlackHoleSystem` state, per-entity velocity, or any cross-system field into `SnakeSystem` — the spec forbids that coupling. HALT rather than introduce it.

**Never:** Touch `BlackHoleSystem` or its gravity nudge. Alter collision, reap/split, or telegraph logic. Introduce `dt`, per-segment velocity, spring/damping physics, or easing into the constraint (it must remain an instantaneous geometric snap). Reach into Epic 4 body rendering.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stretched gap (unchanged) | `dist > SPACING` | Segment pulled inward to exactly SPACING behind leader | No error expected |
| Compressed gap (new) | `0 < dist < SPACING` | Segment pushed outward to exactly SPACING along the leader→segment axis | No error expected |
| Already spaced | `dist === SPACING` | No-op (k = 1, position unchanged) | No error expected |
| Coincident pair | `dist === 0` (segment on its leader) | Segment left in place (no axis to push along); re-separates on a later tick once any motion opens a gap | No NaN / no divide-by-zero |

</intent-contract>

## Code Map

- `src/systems/SnakeSystem.js` -- `_move`'s follow-the-leader loop (~lines 285–296) is the sole production change: the `dist > SPACING` guard becomes a `dist > 0` guard.
- `src/systems/snakeSystem.test.js` -- existing follow-the-leader suite; the `does not move a follower already within SPACING` case (~lines 233–247) now encodes the *old* one-sided behavior and must be rewritten, plus a new compressed-chain re-separation case added.
- `src/config/constants.js` -- `SNAKE_SEGMENT_SPACING = 22`, `SNAKE_HEAD_SPEED = 120`, `FIXED_STEP_MS`; read-only reference.

## Tasks & Acceptance

**Execution:**
- `src/systems/SnakeSystem.js` -- In `_move`'s follow-the-leader loop, replace `if (dist > SNAKE_SEGMENT_SPACING)` with `if (dist > 0)` so the geometric snap runs for both stretched and compressed gaps; update the adjacent comment to describe the bidirectional (pull-in *and* push-out) behavior and the `dist === 0` skip. -- Bidirectional re-stringing resolves DW-14 and DW-21 with no cross-system coupling.
- `src/systems/snakeSystem.test.js` -- Rewrite the now-obsolete `does not move a follower already within SPACING` test to assert a compressed follower is pushed out to exactly SPACING; add a case that a whole chain clumped below SPACING re-separates to ~SPACING on every adjacent gap after several fixed steps; add a `dist === 0` coincident-pair case asserting positions stay finite (no NaN). -- Locks in the new bidirectional contract and the degenerate-pair guard.

**Acceptance Criteria:**
- Given a two-segment snake whose follower sits closer than SPACING behind its (already-moved) head, when `fixedUpdate` runs, then the follower ends at exactly `SNAKE_SEGMENT_SPACING` from the head along the head→follower axis.
- Given a chain whose adjacent gaps are all compressed below SPACING, when several fixed steps run, then every adjacent gap measures `≈ SNAKE_SEGMENT_SPACING`.
- Given a stretched gap (`dist > SPACING`), when `fixedUpdate` runs, then the pre-existing pull-inward-to-SPACING behavior is unchanged.
- Given a segment coincident with its leader (`dist === 0`), when `fixedUpdate` runs, then no coordinate becomes `NaN` and the segment stays finite.
- Given any compressed input, when the same steps run at two different fixed-step sizes, then the resulting gap geometry is identical (the constraint carries no `dt`).
- Given the respacing runs, then `enemyPool.activeCount` and each snake's segment membership are unchanged — every segment remains an individually killable pooled instance.

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[low]` `[patch]` Coincident-pair test never reached the `dist === 0` guard (head integrates before the follow loop, so `dist > 0` at the division); reworked it to place the follower at the head's post-integration position so the guard is load-bearing (NaN if removed), plus a second-tick assertion that the pair re-separates to SPACING.
  - `[low]` `[patch]` Stale `_emitRun` comment ("the follow constraint never pushes them apart") corrected for bidirectional respacing — a degenerate split axis now arises only from a truly coincident (`dist === 0`) pair or a wall fold.
  - `[low]` `[patch]` Added a DW-14 wall-bounce integration test exercising the real integrate + wall-reflect + follow path (head at `MAX_X - 1`, 4 segments, 30 steps): body re-strings to SPACING, `activeCount` stays 4 (every segment remains a live/killable pooled instance), no NaN.
  - `[low]` `[patch]` Added a dt-free gap-geometry test: an identical compressed chain stepped at `DT` and at `40` ms restores every inter-segment gap to SPACING, backing the dt-free AC without asserting (false) absolute-position equality.

## Design Notes

The one-line production change and its guard:

```js
// Follow-the-leader, head→tail: snap each segment to exactly the fixed
// spacing behind its already-updated leader — bidirectional. Pulls a
// stretched gap in AND pushes a compressed gap back out along the current
// leader→segment axis. Skip the coincident pair (dist 0 has no axis).
const dist = Math.hypot(dx, dy);
if (dist > 0) {
  const k = SNAKE_SEGMENT_SPACING / dist; // >1 pushes out, <1 pulls in, 1 no-op
  seg.x = leader.x - dx * k;
  seg.y = leader.y - dy * k;
}
```

`k = SPACING / dist` scales the leader→segment vector to length SPACING in place, so the same expression serves both directions; `dist === 0` is the only value that must be excluded. The `dist === 0` skip mirrors the reap's existing degenerate-axis handling (coincident first two segments fall back rather than derive a bogus east-pointing axis).

## Verification

**Commands:**
- `npm test` -- expected: full vitest suite passes, including the rewritten and new `snakeSystem.test.js` follow-the-leader cases.
- `npx vitest run src/systems/snakeSystem.test.js` -- expected: the SnakeSystem suite passes in isolation.

## Auto Run Result

Status: done

**Change:** Made `SnakeSystem`'s follow-the-leader constraint bidirectional. The one-sided `if (dist > SNAKE_SEGMENT_SPACING)` guard in `_move` became `if (dist > 0)`, so the existing `k = SPACING / dist` snap now re-strings both stretched (pull-in) and compressed (push-out) gaps to exactly `SNAKE_SEGMENT_SPACING`, with the coincident (`dist === 0`) pair skipped to avoid divide-by-zero. Resolves DW-14 (wall-reversal body crumple) and DW-21 (post-black-hole clump) with no coupling to `BlackHoleSystem`.

**Files changed:**
- `src/systems/SnakeSystem.js` -- follow-the-leader loop made bidirectional (`dist > 0` guard) + comment; `_emitRun` degenerate-axis comment corrected for the new behavior.
- `src/systems/snakeSystem.test.js` -- rewrote the obsolete within-SPACING test into a compressed push-out assertion; added compressed-chain re-separation, coincident-pair NaN-safety (guard now load-bearing), DW-14 wall-bounce integration, and dt-free gap-geometry tests.
- `_bmad-output/implementation-artifacts/spec-snake-body-segment-respacing.md` -- this spec.

**Review findings breakdown:** 4 patched (all low, applied this pass — see Review Triage Log), 1 deferred (below), 6 rejected (uncapped re-expansion / "unfair death" — a pre-existing motion-model property, pull-in already does larger single-tick jumps; "frame-rate independent" comment — defensible, the constraint carries no dt per step; 30-step-framing nitpick — test is correct and matches file convention; k=1 and sub-pixel-`dist` boundaries — measure-zero / unreachable at ~1e-307 with O(100) coordinates; off-axis flip — structurally guaranteed by the constraint).

**Deferred for the orchestrator to record (not written to the ledger per invocation instruction):**
- summary: Body segments are never wall-clamped, so the new outward push can drive a segment compressed against a wall up to ~SPACING past the arena border for a few ticks before it re-strings.
- evidence: Only the head is clamped (`_move` lines ~266-279); the old pull-only constraint always moved a segment toward its in-bounds leader, but the bidirectional push moves it outward along the leader axis. Reachable only via the narrow black-hole-against-wall geometry (the DW-14 wall-reversal path compresses interior, staying in bounds — verified by the new wall-bounce test); bounded by SPACING, transient, in a player-unreachable region. A clean fix (clamping the body) is a motion-model change the intent excludes ("keep the whole change inside SnakeSystem") and is entangled with the deferred snake wall-grind (Story 2.5) / Epic 4 body-rendering items.

**Follow-up review recommended:** false. Patched findings by severity: high 0, medium 0, low 4 → score `3×0 + 1×4 = 4` (< 5, no high).

**Verification:** `npm test` → 49 files / 762 tests passed. `npx vitest run src/systems/snakeSystem.test.js` → 40 tests passed. All four I/O-matrix rows are backed by passing tests (stretched pull-in, compressed push-out, at-SPACING no-op via the steady-state connected-body test, coincident `dist === 0` finite).

**Residual risks:** The deferred body-out-of-bounds excursion above (low, transient, player-unreachable). No other residual risk identified — collision, reap/split, and telegraph paths are untouched; the constraint remains dt-free and geometric.
