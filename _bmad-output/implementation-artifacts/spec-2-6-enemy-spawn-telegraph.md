---
title: 'Story 2.6 — Enemy Spawn Telegraph'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '0f118afb1a7c2317ce0f940c27a9ff5ad6380ed3'
final_revision: '3815de1d1f47cfcfdb9c4c32e963e65cc066ebaa'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Enemies become active and lethal the instant they spawn. A swarm enemy (or a black hole placed at a random interior point — see `BlackHoleSystem._spawnOne`'s own "spawn-safety is Story 2.6's" note) can appear on or next to the ship and kill it with no warning, which is exactly the "killed by an enemy that appeared on top of me" failure the player is promised protection from (FR5, epic "safe spawn telegraphing").

**Approach:** Give every enemy archetype a brief per-instance **spawn telegraph** state: on spawn it carries a `telegraphMs` countdown; while `telegraphMs > 0` the instance is *non-lethal to the player* and its owning system *freezes its behavior* (no movement/homing/wander/slither/gravity/feed) — it only renders a spawn-in cue (fade + scale). When the countdown reaches 0 the instance activates: normal behavior and lethal contact begin together. The single non-lethality seam is `PlayerDeathSystem`, which skips any enemy with `telegraphMs > 0` (all death-pool instances share the uniform shape). Independently, add **spawn-point ship-avoidance**: every spawn placement re-rolls (bounded) to keep the point at least `SPAWN_SAFE_RADIUS` from the ship — the SpawnDirector supplies the ship position to each `spawn()`, and the Black Hole self-spawn/fed-seeker paths use their own ship reference.

## Boundaries & Constraints

**Always:**
- `telegraphMs > 0` ⟺ **telegraphing**: (a) non-lethal to the player — `PlayerDeathSystem` skips the instance; (b) frozen — its owning system skips that instance's behavior tick. This holds for ALL archetypes: Seeker, Green Square, Pinwheel, Snake segments, Black Hole, and Black-Hole-fed seekers.
- The countdown advances ONLY by fixed-step `dt` (never render time), so the telegraph duration is frame-rate-independent. Decrement lives in each owning system's `fixedUpdate`; clamp at 0.
- Activation is a single transition: on the tick `telegraphMs` decrements to `≤ 0`, the instance is clamped to 0 and both begins normal behavior AND becomes lethal that same tick (movers run before `PlayerDeathSystem`, so the order is consistent). Before that tick it is frozen and non-lethal.
- Every enemy spawn sets `telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS`. Every enemy factory initializes `telegraphMs: 0` (a spawned-and-active default; systems overwrite on spawn).
- Spawn-point ship-avoidance: each spawn placement re-rolls up to `SPAWN_PLACEMENT_MAX_ATTEMPTS` times to keep the chosen point ≥ `SPAWN_SAFE_RADIUS` from the ship's current position. Bounded — if every attempt is too close (player boxed into a corner), accept the last candidate; NEVER loop unboundedly.
- The SpawnDirector is the sole avoidance-coordinate source for its four archetypes: it holds the ship and passes `ship.x, ship.y` to each `system.spawn(avoidX, avoidY)`. The Black Hole self-spawn and fed-seeker paths use `this.ship` directly.
- Pinwheel and Snake receive the avoid point as `spawn()` ARGUMENTS only — they store no ship and remain player-indifferent in their behavior (movement never reads the ship).
- All new tunables are centralized `constants.js` values (telegraph duration, safe radius, max attempts, render min-alpha/min-scale) — placeholders, tuned post-launch, no inline magic numbers.
- The spawn-in telegraph renders a visible cue (fade via alpha + scale) derived from `telegraphMs`; active instances (`telegraphMs ≤ 0`) render exactly as today.

**Block If:**
- Making `PlayerDeathSystem` telegraph-aware would require changing the shared enemy `{x,y,radius}` shape contract by more than adding the one `telegraphMs` field, OR giving the SpawnDirector the ship would force a change to the load-bearing world run-order (movers → collision → scoring → black hole → death). Either signals a hidden conflict — HALT with specifics.

**Never:**
- Do not change any enemy's motion/behavior math (homing, flee/aggro, wander, drift/bounce, slither, follow-the-leader, split/reap, gravity, feed/grow) beyond gating it on `telegraphMs`.
- Do not change the fixed-step system ordering in `ArenaScene`/`World`.
- Do not alter `CollisionSystem` or bullet↔enemy behavior. Telegraphing swarm enemies REMAIN destroyable by bullets (a deliberate pre-emptive-clear affordance); the Black Hole's own bullet damage is part of its frozen behavior tick and is therefore paused during its telegraph (a spawning hole is briefly invulnerable). This is intentional, not an oversight.
- Do not give `PinwheelSystem`/`SnakeSystem` a stored ship reference or make their movement depend on the player.
- Do not implement the Epic 4 aesthetic — the telegraph visual is a placeholder fade/scale only.
- Do not add despawn/aging, difficulty changes, a score multiplier, or any ramp/mix change (Epic 3 / Story 2.5 territory).

## I/O & Edge-Case Matrix

Scope: one `fixedUpdate(dt)` step of the named system (constructed over fakes/pools as its tests already do), or one call to a pure placement helper. `TELE = ENEMY_SPAWN_TELEGRAPH_MS`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Telegraphing enemy non-lethal (AC1) | ship overlapping an enemy with `telegraphMs > 0` | `PlayerDeathSystem`: no life lost, no respawn, no game-over | none |
| Active enemy still lethal (AC2) | ship overlapping an enemy with `telegraphMs == 0` | life deducted / death flow as today | none |
| Mixed overlap | ship overlaps one telegraphing + one active enemy | exactly one death, caused by the active one; the telegraphing one is skipped | none |
| Telegraph expiry becomes lethal (AC2) | enemy at ship, `telegraphMs = one dt`, run one `PlayerDeathSystem` step after its mover decremented it to 0 | lethal that step | none |
| Countdown by dt only | telegraphing instance, N mover steps of `dt` | `telegraphMs` decreases by `dt` per step, clamped at 0; identical elapsed via fine vs coarse dt reaches 0 at the same elapsed | clamp ≥ 0 |
| Seeker frozen while telegraphing (AC1) | active seeker offset from ship, `telegraphMs = TELE` | `EnemySystem.fixedUpdate`: position unchanged; `telegraphMs -= dt` | none |
| Seeker homes after activation (AC2) | same seeker after `telegraphMs` reaches 0 | homes toward the ship as before | none |
| Green square frozen while telegraphing | telegraphing square with a bullet inside its threat radius | no aggro latch, no move; `telegraphMs -= dt` | none |
| Pinwheel frozen while telegraphing | telegraphing pinwheel | no wander re-roll, no drift; `telegraphMs -= dt` | none |
| Snake whole-chain frozen (AC1) | snake whose head `telegraphMs > 0` | `SnakeSystem._move`: every segment position unchanged; every segment's `telegraphMs -= dt` | none |
| Snake activates as a chain (AC2) | snake head `telegraphMs` reaches 0 | head slithers + body follows as before; all segments lethal | none |
| Black hole frozen while telegraphing (AC1) | telegraphing hole near the ship + bullets | `BlackHoleSystem`: no gravity pull, no absorb/feed/grow, no detonation; `telegraphMs -= dt`; not lethal via death seam | none |
| Black hole activates (AC2) | hole `telegraphMs` reaches 0 | gravity/feed/grow resume; lethal on contact | none |
| Spawn set + placement safe (AC3) | `EnemySystem.spawn(avoidX, avoidY)` where the default edge roll lands within `SPAWN_SAFE_RADIUS` of avoid | returns a point ≥ `SPAWN_SAFE_RADIUS` from avoid (re-rolled) and sets `telegraphMs = TELE`, `vx=vy=0` | bounded attempts |
| Spawn without avoid | `spawn()` with undefined avoid args | first roll accepted (no re-roll); `telegraphMs = TELE` | none |
| Placement boxed-in | avoid point such that every candidate is within `SPAWN_SAFE_RADIUS` | returns the last candidate after `SPAWN_PLACEMENT_MAX_ATTEMPTS`; never loops forever | bounded fallback |
| Director forwards ship (AC3) | `SpawnDirector` built with a ship, one spawn fires | the picked archetype's `spawn` is called with `(ship.x, ship.y)` | none |
| Director without ship | `SpawnDirector` built with no ship (existing tests) | `spawn()` called with no/undefined avoid args (back-compat) | none |
| Black-hole spawn avoids ship (AC3) | `_spawnOne` with ship near the default interior roll | hole placed ≥ `SPAWN_SAFE_RADIUS` from ship (bounded), `telegraphMs = TELE` | bounded attempts |
| Fed seeker telegraphs + avoids | a feed triggers `_spawnSeekerAtEdge` | emitted seeker has `telegraphMs = TELE` and is placed ≥ `SPAWN_SAFE_RADIUS` from ship (bounded) | bounded attempts |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ADD `ENEMY_SPAWN_TELEGRAPH_MS`, `SPAWN_SAFE_RADIUS`, `SPAWN_PLACEMENT_MAX_ATTEMPTS`, and render tunables `SPAWN_TELEGRAPH_MIN_ALPHA`, `SPAWN_TELEGRAPH_MIN_SCALE`. Placeholders, no inline magic numbers.
- `src/systems/spawnPlacement.js` -- NEW pure, Phaser-free helper module. `pickSafeEdgePlacement(rng, radius, avoidX, avoidY, safeRadius, maxAttempts)` → `{ edge, t, x, y }` (the established edge placement: fixed axis pinned at `INSET+radius`, free axis uniform along the edge; `edge` returned so the snake derives its heading). `pickSafeInteriorPlacement(rng, radius, avoidX, avoidY, safeRadius, maxAttempts)` → `{ x, y }` for the hole. Both re-roll while the candidate is within `safeRadius` of a *finite* `(avoidX, avoidY)`, up to `maxAttempts`, returning the last candidate if all fail; when `avoidX`/`avoidY` are undefined/non-finite, return the first roll unchanged.
- `src/entities/{Seeker,GreenSquare,Pinwheel,SnakeSegment,BlackHole}.js` -- ADD `telegraphMs: 0` to each factory's returned shape + doc the field.
- `src/systems/EnemySystem.js` -- `fixedUpdate`: telegraph guard at the top of the per-seeker callback (decrement, clamp, `return` while still telegraphing). `spawn(avoidX, avoidY)`: place via `pickSafeEdgePlacement`, set `telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS`.
- `src/systems/GreenSquareSystem.js` -- same: guard at the very top of the per-square callback (before threat/aggro), and `spawn(avoidX, avoidY)` via the helper + set telegraph.
- `src/systems/PinwheelSystem.js` -- same: guard at the top of the per-pinwheel callback, `spawn(avoidX, avoidY)` via the helper (edge/t) then its own heading draw + set telegraph.
- `src/systems/SnakeSystem.js` -- `_move`: per snake, if `head.telegraphMs > 0` decrement EVERY segment's `telegraphMs` by `dt` (clamp 0) and `continue` while the head is still telegraphing; else move as today. `spawn(avoidX, avoidY)`: head placement via `pickSafeEdgePlacement`, set `telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS` on every spawned segment.
- `src/systems/BlackHoleSystem.js` -- per-hole loop: telegraph guard at the top (decrement, `continue` while telegraphing — skips gravity/absorb/feed/grow/detonation). `_spawnOne`: interior placement via `pickSafeInteriorPlacement` using `this.ship`, set `telegraphMs`. `_spawnSeekerAtEdge`: edge placement via `pickSafeEdgePlacement` using `this.ship`, set `telegraphMs`.
- `src/systems/SpawnDirector.js` -- add an optional `ship` param (3rd, after `rng`, default `null`); `_pickAndSpawn` calls `system.spawn(ship.x, ship.y)` when a ship is set, else `spawn()` (back-compat).
- `src/scenes/ArenaScene.js` -- pass `this.ship` to the `SpawnDirector`; in `update()`, apply the telegraph render cue (per-instance alpha + scaled radius from `telegraphMs`) in every enemy render block (seeker, green square, pinwheel, snake, black hole). Zero per-frame allocation preserved.
- `src/systems/spawnPlacement.test.js` -- NEW; unit-test the helper rows (re-roll away from avoid, ≥ safeRadius when possible, bounded fallback, no-avoid path, interior variant).
- `src/systems/playerDeathSystem.test.js` -- UPDATE; add telegraph non-lethality rows (telegraphing skipped, active still lethal, mixed overlap, expiry becomes lethal).
- `src/systems/{enemy,greenSquare,pinwheel,snake,blackHole}System.test.js` -- UPDATE; migrate `spawn()` callers to `spawn(avoidX, avoidY)` where asserting avoidance, add freeze-while-telegraphing + countdown + telegraph-set-on-spawn rows (snake: whole-chain). Black hole: telegraph freeze + fed-seeker telegraph/avoid + spawn avoid.
- `src/systems/spawnDirector.test.js` -- UPDATE; add a row asserting the director forwards `ship.x, ship.y` to the picked `spawn` (existing no-ship rows unchanged).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the telegraph duration, safe radius, max attempts, and render min-alpha/min-scale constants -- centralized placeholders.
- `src/systems/spawnPlacement.js` -- implement the two pure safe-placement helpers with bounded re-roll -- one testable placement seam reused by every spawner.
- `src/entities/{Seeker,GreenSquare,Pinwheel,SnakeSegment,BlackHole}.js` -- add `telegraphMs: 0` to each shape -- the uniform per-instance telegraph field the death seam reads.
- `src/systems/EnemySystem.js`, `GreenSquareSystem.js`, `PinwheelSystem.js` -- freeze-while-telegraphing guard + `spawn(avoidX, avoidY)` via the helper + set telegraph -- non-lethal, frozen spawn-in for the edge archetypes.
- `src/systems/SnakeSystem.js` -- whole-chain freeze + per-segment countdown + telegraph on every spawned segment + safe head placement -- the multi-segment archetype telegraphs and activates as one body.
- `src/systems/BlackHoleSystem.js` -- per-hole telegraph freeze + safe interior self-spawn + fed-seeker telegraph/avoid -- the hazard honors both the telegraph and the spawn-safety deferred to this story.
- `src/systems/SpawnDirector.js` -- optional ship, forward `(ship.x, ship.y)` to `spawn()` -- the director owns spawn-point avoidance for its four archetypes.
- `src/scenes/ArenaScene.js` -- wire the ship into the director; render the fade/scale telegraph cue per instance -- integrates the visible telegraph + avoidance into the running game.
- `src/systems/spawnPlacement.test.js` + updates to `playerDeathSystem`, `enemy/greenSquare/pinwheel/snake/blackHole System`, and `spawnDirector` tests -- unit-test every I/O-matrix row.

**Acceptance Criteria:**
- Given an enemy of any archetype is spawning (`telegraphMs > 0`), when the ship overlaps it, then no life is lost and no death occurs, and the enemy renders a spawn-in fade/scale cue while its behavior stays frozen (AC1).
- Given a telegraphing enemy, when its `telegraphMs` countdown (advanced only by fixed-step dt) reaches 0, then on that same tick it begins its normal behavior and can kill the ship on contact (AC2).
- Given the SpawnDirector places one of its four archetypes, when it chooses the spawn point, then the point is kept at least `SPAWN_SAFE_RADIUS` from the ship's current position (bounded re-roll), and the Black Hole self-spawn likewise avoids the ship (AC3).
- Given equal elapsed sim time reached via fine vs. coarse fixed steps, when telegraph countdowns are compared, then they reach activation at the same elapsed time (frame-rate-independent).

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` An ACTIVE Black Hole's gravity `_pull` and enemy-absorb loops had no `telegraphMs` guard, so a "frozen" telegraphing enemy could be dragged (violating the `Always: telegraphing = frozen` invariant) or absorbed mid-telegraph — and gravity could slide a frozen enemy onto the ship so it activated in-contact. Added `if (e.telegraphMs > 0) continue;` to both loops (ship + bullets still pulled/absorbed normally) so a telegraphing enemy is inert to the hole until it activates; added blackHoleSystem tests for the no-pull and no-absorb cases plus their post-activation counterparts.
  - `[medium]` `[patch]` The spawn-in telegraph render cue (AC1's "visibly warn" headline) lived entirely in `ArenaScene` (Phaser-coupled) and had zero automated coverage — an inverted mapping would ship silently. Extracted the pure cue math into a Phaser-free `src/scenes/telegraphCue.js` (`spawnTelegraphProgress`/`telegraphAlpha`/`telegraphScale`), wired `ArenaScene` to it unchanged, and unit-tested the progress mapping direction + clamp and the alpha/scale endpoints.
  - `[low]` `[patch]` Both `spawnPlacement` helpers used `maxAttempts` directly as the loop bound; a non-positive value would skip the loop and return the zero-initialized `{x:0,y:0}` (an off-arena corner spawn). Clamped the bound to `Math.max(1, …)` and added a spawnPlacement test proving a `maxAttempts <= 0` call still returns a valid on-edge/interior candidate.
  - `[low]` `[patch]` The Black-Hole-fed-seeker avoidance test picked an rng landing far from the (centered) ship on the first roll, so dropping `this.ship` in `_spawnSeekerAtEdge` would have survived. Added a fed-seeker test placing the ship on the first edge candidate, asserting the emitted seeker re-rolled to ≥ `SPAWN_SAFE_RADIUS`.

### 2026-07-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` AC2's headline invariant ("the same tick the countdown reaches 0, the enemy begins normal behavior AND becomes lethal") was verified only as two isolated half-proofs — `playerDeathSystem.test.js` hand-set `telegraphMs = 0` between two death steps with the comment "simulated here", and the mover tests proved decrement-to-0 separately — so a future reorder or off-by-one in a mover's clamp could break the cross-system coupling with every suite still green. Added a `PlayerDeathSystem — composed with the real EnemySystem mover` describe block that runs the actual `EnemySystem` mover and the death seam over a SHARED pool: one test asserts the tick the mover zeroes the telegraph is the tick contact turns lethal (no simulated flag), a control asserts a still-telegraphing enemy stays frozen-in-place AND non-lethal after a real mover step. (playerDeathSystem now 19 tests, all green.)
  - `[low]` `[patch]` `telegraphCue.test.js`'s clamp test was titled "p == 1 (clamped) when telegraphMs > fullMs" while it correctly asserts `.toBe(0)` (progress floors at 0 when the countdown exceeds full) — a mislabel that risked a future maintainer "correcting" the assertion toward the wrong value. Renamed the title to "p == 0 (clamped to the floor) when telegraphMs > fullMs" to match the assertion.
- rejected (not defects — intent-sanctioned, placeholder, or theoretical/covered-elsewhere):
  - Telegraphing swarm enemies remain bullet-killable while a telegraphing Black Hole is briefly invulnerable — the `Never` boundary states this asymmetry verbatim as intentional (CollisionSystem untouched; the hole's bullet damage is part of its frozen tick).
  - No activation grace / same-tick lethality when the player is overlapping at activation, and the boxed-in fallback accepting the last (possibly-close) candidate — the intent explicitly designs activation as a single transition and explicitly accepts the last candidate when boxed in, with the telegraph as the primary safety and avoidance as a bounded second layer.
  - `SPAWN_SAFE_RADIUS` (200) < `BLACKHOLE_GRAVITY_RADIUS` (340), telegraph render scale (0.4 floor) vs full collision radius, and cue alpha/scale floor perceptibility — all governed by tunables/aesthetics the intent flags as post-launch placeholders (Epic 4 owns the aesthetic).
  - Snake spawn-avoidance checks only the head (trailing body segments may land near the ship) — avoidance is the bounded secondary layer around the single per-spawn avoid point; the telegraph (whole-chain) is the primary guarantee.
  - `hasAvoid` requiring both coords finite / `NaN` safeRadius, `dt == 0`/`NaN` stalling the countdown, and `maxAttempts | 0` int32 truncation — theoretical fail-safe paths with no reachable trigger under the constant fixed step and the current constants (already floored via `Math.max(1, …)`).
  - Five near-identical telegraph gates + the per-segment Snake variant (maintainability), and avoidance perturbing the shared RNG draw stream (reproducibility) — a deliberate "freeze lives with the owner" design and a non-issue absent any seeded-replay feature; neither is a defect.
  - Tautological `expect(system.ship).toBeUndefined()` player-indifference assertions and the Phaser-coupled ArenaScene render-cue/ship-forwarding wiring being unit-untestable — player-indifference is covered by the existing deterministic-motion tests, and the scene wiring is a manual-check surface the spec's Verification section already documents.

## Design Notes

**One non-lethality seam.** `PlayerDeathSystem` already tests the ship against a LIST of enemy pools reading only the uniform `{x,y,radius}` shape. Adding a single `if (s.telegraphMs > 0) continue;` there makes every archetype non-lethal while telegraphing through one line — no per-type duplication. The field defaults to 0 in every factory, so any instance not explicitly telegraphed is lethal exactly as today.

**Freeze lives with the owner; countdown lives with the owner.** Each system already iterates its own pool each tick, so the decrement + behavior-skip go at the top of that existing loop — no new system, no new ordering constraint. Because movers run before `PlayerDeathSystem` in the fixed step, the tick that decrements `telegraphMs` to 0 is the same tick the enemy first moves and first becomes lethal — behavior and lethality begin together (AC2). Guard shape:
```js
if (s.telegraphMs > 0) {
  s.telegraphMs -= dt;
  if (s.telegraphMs > 0) return;   // still telegraphing → frozen
  s.telegraphMs = 0;               // just activated → fall through to normal behavior
}
```
The Snake is one body: gate on the head, but decrement EVERY segment so the per-segment field the death seam reads stays in lockstep (fragments from a mid-telegraph split inherit identical values, so gating on each fragment's head is still correct).

**Spawn-point avoidance without breaking player-indifference.** The four director archetypes get the avoid point as `spawn()` arguments supplied by the director (which holds the ship) — Pinwheel/Snake never store the ship, so their movement stays player-indifferent. The Black Hole self-spawns (not via the director) and uses its existing `this.ship`. All placement re-rolls are bounded (`SPAWN_PLACEMENT_MAX_ATTEMPTS`) and fall back to the last candidate, so a corner-boxed player can never hang the spawn loop — the telegraph is the primary safety guarantee, avoidance is the second layer.

**Bullets are intentionally untouched.** Telegraph gates player-lethality and each archetype's own behavior tick. Swarm bullet-kills live in the separate `CollisionSystem` (left unchanged), so a frozen telegraphing swarm enemy can still be shot early. The hole's bullet damage is part of its own (frozen) tick, so a spawning hole is briefly invulnerable. Both are deliberate and documented in Boundaries.

**Render cue (view-only).** Per instance, `p = 1 - clamp(telegraphMs / ENEMY_SPAWN_TELEGRAPH_MS, 0, 1)`; draw with `alpha = MIN_ALPHA + (1-MIN_ALPHA)*p` and radius `× (MIN_SCALE + (1-MIN_SCALE)*p)`. For active instances `p == 1` → alpha 1, scale 1 (today's rendering). `fillStyle` is set per-instance (a call, not an allocation), preserving the zero-per-frame-allocation render discipline.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `spawnPlacement.test.js`, the telegraph rows added to `playerDeathSystem` and the five enemy-system suites, and the director-forwards-ship row; `collisionSystem.test.js` unchanged and green.
- `npm run build` -- expected: production build succeeds (the pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: newly spawned enemies of every type visibly fade/scale in for a brief window and do NOT kill the ship if it is on top of them during that window; after the window they snap to normal motion and become lethal. Flying the ship into a corner never produces an enemy spawning exactly on it; black holes never appear on the ship. Restarting after game over behaves the same from a fresh ramp.

## Auto Run Result

Status: done (follow-up review pass — the spec was already `done`; this was a fresh review of the committed change, per the `done` → review routing).

**Implemented change (reviewed):** Story 2.6 — per-enemy spawn telegraph (`telegraphMs` countdown: non-lethal via the single `PlayerDeathSystem` seam + frozen behavior in each owning system while telegraphing; single-transition activation) plus bounded spawn-point ship-avoidance (`spawnPlacement.js` helpers, `SpawnDirector` ship-forwarding, Black Hole self-spawn/fed-seeker avoidance) and a placeholder fade/scale render cue (`telegraphCue.js`). No production behavior was changed in this review pass.

**Files changed in this review pass:**
- `src/systems/playerDeathSystem.test.js` — added a `composed with the real EnemySystem mover` describe block (2 tests) that runs the actual mover + death seam over a shared pool, replacing reliance on a hand-set `telegraphMs = 0` to verify AC2's same-tick activation coupling.
- `src/scenes/telegraphCue.test.js` — corrected a mislabeled clamp-test title ("p == 1" → "p == 0 (clamped to the floor)") to match its `.toBe(0)` assertion.

**Review findings breakdown:** 2 patches applied (1 medium, 1 low — both test-hardening, no production code touched); 0 deferred; 14 rejected (intent-sanctioned design decisions, placeholder tunables/aesthetics, or theoretical/covered-elsewhere concerns — see the follow-up Review Triage Log entry). No `intent_gap`, no `bad_spec` — the code faithfully implements a complete, explicit intent.

**Follow-up review recommendation:** false. Patched this pass: 1 medium + 1 low → score `3×1 + 1×1 = 4` (< 5), no high severity.

**Verification performed:** `npm test` — 17 files, 291 tests all pass (playerDeathSystem 19 tests incl. the 2 new composed tests; telegraphCue 12 tests; collisionSystem unchanged and green). `npm run build` — production build succeeded (Phaser chunk-size advisory only, not a failure).

**Residual risks:** The AC1 render cue and the ArenaScene ship-to-director wiring remain Phaser-coupled and are covered only by the spec's manual `npm run dev` checks (the pure math is unit-tested via `telegraphCue.js`); this is an accepted, documented surface, not a regression. Gameplay-tuning values (`SPAWN_SAFE_RADIUS` vs `BLACKHOLE_GRAVITY_RADIUS`, cue alpha/scale floors) are intentional post-launch placeholders.

