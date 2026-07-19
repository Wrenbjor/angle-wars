---
title: 'Story 1.5 — Player Death and Collision'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '055cabf84ad3ffc5e2ffdba557b88a4dbd56ba9d'
final_revision: 'f6d769f8305224cd2d7f4290061c6b0b3618f42a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Seekers home toward the ship but pass through it harmlessly (Story 1.4): there is no death, no lives, no respawn, and no game-over, so the arena has no stakes and Story 1.6 (score/HUD/game-over) has no lives/death system to build on.

**Approach:** Add a `PlayerState` (lives, invulnerability countdown, game-over flag) and a Phaser-free `PlayerDeathSystem` that, each fixed step, counts down the invulnerability window and — when the player is vulnerable — tests the ship against active seekers (circle-circle). On a lethal hit it deducts a life and either respawns the ship at arena center with a fresh invulnerability window (lives remain) or transitions to game-over (last life). `ArenaScene` creates the state, registers the system after `CollisionSystem`, and blinks the ship while invulnerable.

## Boundaries & Constraints

**Always:**
- All death/collision/invulnerability math runs only inside `world.fixedUpdate(dt)`, driven by the constant fixed-step `dt`, so the invulnerability window and behavior are identical regardless of render frame rate. The window is tracked in milliseconds (`invulnMs`) decremented by `dt` and clamped at `0` (never negative).
- Ship↔enemy collision is circle-circle: lethal when center distance `≤ ship.radius + seeker.radius` (boundary counts, mirroring `CollisionSystem`).
- At most one death per fixed step: multiple overlapping seekers in one tick cost exactly one life (one respawn, one invulnerability grant), not one per seeker.
- Death flow: `lives -= 1`; if `lives > 0`, respawn the ship at arena center (position and velocity reset to the canonical spawn via `createPlayerShip()`) and set `invulnMs = PLAYER_INVULN_MS`; if `lives` reaches `0`, set `gameOver = true` and do **not** respawn or grant invulnerability.
- While `invulnMs > 0` the player is invulnerable: enemy contact does no harm (no life lost, no respawn) and the invulnerability still counts down.
- Once `gameOver` is true the system does nothing further (no negative lives, no further respawn).
- `PlayerDeathSystem` runs **after** `CollisionSystem` so a seeker destroyed by a bullet this tick cannot also kill the player, and after `PlayerMovementSystem`/`EnemySystem` so it sees post-move ship and seeker positions. Final order: SimClock → PlayerMovement → Firing → Enemy → Collision → PlayerDeath.
- Every tunable magnitude (starting lives, invulnerability duration, blink cadence) is a named constant in `src/config/constants.js` — no inline magic numbers.
- `PlayerState` and `PlayerDeathSystem` are Phaser-free and unit-testable headlessly under Vitest.

**Block If:**
- (none anticipated — this story adds to established pool/system/state patterns already in the codebase.)

**Never:**
- Do not destroy, clear, or reset seekers on death — bullets destroy enemies (Story 1.4); ship contact only kills the player. The respawn invulnerability window is the specified mechanism for respawning among live seekers.
- Do not build the game-over **screen**, final-score display, or restart — Story 1.6 / Epic 5. This story only sets the `gameOver` state flag.
- Do not freeze/pause other systems (movement, firing, enemy spawning) on game-over — the game-flow state machine and screen own that (Story 1.6 / Epic 5).
- Do not implement score, HUD, or multiplier — Story 1.6 / Epic 3.
- Do not add extra-lives-at-score-thresholds — Epic 3 (`3-3`).
- Do not add particle bursts, screen shake, flash, or death aesthetic — placeholder blink only (Epic 4).
- Do not grant an initial spawn invulnerability at game start (unspecified; the first seeker only spawns after one interval, so none is needed).

## I/O & Edge-Case Matrix

`PlayerDeathSystem.fixedUpdate(dt)` — constructed with `(ship, enemyPool, playerState)`:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lethal contact | ship overlaps a seeker; `invulnMs == 0`, `lives == 3`, not game-over | `lives == 2`; ship reset to arena center with `vx==vy==0`; `invulnMs == PLAYER_INVULN_MS`; the seeker stays active (not released) | No error expected |
| No contact | ship far from every seeker; `invulnMs == 0` | no life lost, ship unmoved by this system, `gameOver` false | No error expected |
| Contact while invulnerable | ship overlaps a seeker; `invulnMs > 0` | no life lost, no respawn, ship not moved to center; `invulnMs` decremented by `dt` (not reset) | No error expected |
| Boundary touch | center distance exactly `== ship.radius + seeker.radius`, vulnerable | counts as a lethal hit (uses `≤`) | No error expected |
| Invuln countdown / frame-rate independence | `invulnMs = PLAYER_INVULN_MS`, run for `PLAYER_INVULN_MS` of ticks via fine vs coarse `dt`, contact present throughout | `invulnMs` reaches `0` after ≈ the same elapsed sim time regardless of tick size (never negative); no death occurs until it hits `0` | No error expected |
| Multiple seekers, one tick | ship overlaps two seekers; vulnerable, `lives == 3` | exactly one death: `lives == 2`, one respawn, one `invulnMs` grant | No error expected |
| Last life → game-over | ship overlaps a seeker; vulnerable, `lives == 1` | `lives == 0`, `gameOver == true`, ship NOT respawned, `invulnMs` not granted | No error expected |
| After game-over | `gameOver == true`, ship overlaps a seeker | no change: `lives` stays `0` (no negative), no respawn, system early-returns | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- EDIT: add `PLAYER_START_LIVES`, `PLAYER_INVULN_MS`, `PLAYER_INVULN_BLINK_MS`.
- `src/state/PlayerState.js` -- NEW (Phaser-free): `createPlayerState()` → `{ lives: PLAYER_START_LIVES, invulnMs: 0, gameOver: false }`. Plain-data player lifecycle state, mirroring the `PlayerShip`/`InputState` shared-state pattern; read by the scene for the invuln indication and (later) the HUD/game-over.
- `src/systems/PlayerDeathSystem.js` -- NEW (Phaser-free): owns no pool/state; reads `(ship, enemyPool, playerState)`. Each fixed step counts down invulnerability, then (if vulnerable and not game-over) tests ship vs active seekers and applies the death flow. Uses a reusable scratch array (mirrors `CollisionSystem`) — zero steady-state allocation.
- `src/scenes/ArenaScene.js` -- EDIT: create `PlayerState`; register `PlayerDeathSystem` after `CollisionSystem`; blink the ship sprite's alpha while `invulnMs > 0`.
- `src/systems/playerDeathSystem.test.js` -- NEW: unit tests for every I/O & edge-case matrix row.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `PLAYER_START_LIVES` (3), `PLAYER_INVULN_MS` (~2000), `PLAYER_INVULN_BLINK_MS` (~120) with documented, tunable defaults -- keeps all feel magnitudes centralized.
- `src/state/PlayerState.js` -- implement `createPlayerState()` returning `{ lives, invulnMs: 0, gameOver: false }` -- the shared player lifecycle state.
- `src/systems/PlayerDeathSystem.js` -- implement `fixedUpdate(dt)`: early-return on game-over; decrement `invulnMs` (clamp ≥ 0); if still invulnerable, return; else materialize active seekers into reusable scratch, test circle-circle with early break on first overlap, and apply the death flow (life--, respawn+invuln or game-over) -- the ship↔enemy death seam.
- `src/scenes/ArenaScene.js` -- create `PlayerState`, `addSystem(new PlayerDeathSystem(ship, enemySystem.enemyPool, playerState))` after `CollisionSystem`, and each render frame set the ship sprite alpha to blink while `playerState.invulnMs > 0` (solid at 0) -- wires death into the sim and makes the invulnerable state visible.
- `src/systems/playerDeathSystem.test.js` -- unit-test every matrix row -- proves death/respawn/invuln/game-over headlessly.

**Acceptance Criteria:**
- Given the ship and a seeker in the arena, when the seeker's center comes within `ship.radius + seeker.radius` of the ship and the player is vulnerable, then a life is deducted and (if lives remain) the ship respawns at arena center with a fresh invulnerability window (FR6, FR12).
- Given the player has just respawned, when a seeker contacts the ship within the invulnerability window, then no life is lost and the ship's invulnerable state is indicated on screen (FR12).
- Given the player has 1 life, when a seeker kills them, then `lives` becomes `0` and `PlayerState.gameOver` becomes true and no respawn occurs (FR12).
- Given the codebase, when a reviewer inspects it, then `PlayerState` and `PlayerDeathSystem` are Phaser-free, the system runs inside `world.fixedUpdate(dt)` after `CollisionSystem`, and the death/respawn/invulnerability/game-over logic is covered by passing unit tests.
- Given `npm test` and `npm run build`, when they run, then all unit tests pass and the production build completes, both with exit code 0.

## Spec Change Log

_No entries — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1
- reject: 12
- addressed_findings:
  - none
- deferred:
  - The `ArenaScene` player-death wiring/render surface — the load-bearing `PlayerDeathSystem`-after-`CollisionSystem` registration order (so a seeker a bullet destroys this tick cannot also kill the player) and the invulnerability blink render (`shipSprite.alpha` from `invulnMs`) — has no automated coverage. Two review layers (adversarial, verification-gap) converged; every `playerDeathSystem` test builds the system standalone with no `CollisionSystem` and no `World`/`ArenaScene`, so a reorder of the `addSystem` calls or a broken blink formula would ship green. Recorded to `deferred-work.md` — the same deliberately-thin Phaser/scene integration boundary deferred by Stories 1.1–1.4 (orchestrator-owned scene/World harness).
- rejected (out-of-scope on the intent's authority / precedent-rejected / not a present defect):
  - `gameOver` flag is set but nothing in `ArenaScene` consumes it — no game-over screen, no sim freeze, no restart. Out of scope on the intent's own decomposition: Story 1.6 owns "a game-over screen shows the final score and offers restart"; Story 5.3 owns the game-flow state machine (title → play → game over → restart). Story 1.5's AC3 is "transitions to a game-over **state**," which the flag satisfies. (Converged: adversarial, edge-case, intent-alignment.)
  - Input/movement/firing not disabled after game-over — same authority: the sim-freeze/flow control is the game-flow state machine (Story 5.3) and the game-over screen (Story 1.6), not this story.
  - `lives` never displayed on screen — the HUD showing "remaining lives" is a literal Story 1.6 acceptance criterion.
  - No initial spawn invulnerability at game start — not referenced by the intent (AC2 is respawn invulnerability); and unreachable as a defect since the first seeker only spawns after `SEEKER_SPAWN_INTERVAL_MS`, so nothing can contact the ship at t=0. Same speculative class as prior-story rejects.
  - Per-tick arrow-closure allocation in `forEachActive((s) => seekers.push(s))` contradicts "zero steady-state allocation" — precedent-rejected identically in Stories 1.3/1.4; matches the shipped `CollisionSystem` pattern exactly; the no-alloc guarantee targets the pooled-entity path and a single V8-optimizable closure per tick is accepted precedent.
  - The "allocates nothing" test only asserts pool `activeCount + freeCount` — identical to the accepted `collisionSystem.test.js` no-alloc test; it verifies the actual NFR2 guarantee (pooled entities never grow/allocate), which is what "zero per-frame allocation in the hot loop" means; the closure is separate and precedent-accepted.
  - Respawn constructs a throwaway ship via `createPlayerShip()` to read the spawn point — a deliberate spec choice (arena-center defined in one place); death is a rare discrete event, not a per-frame hot-path allocation, so this is not an NFR2 concern.
  - Respawn resets only `x,y,vx,vy,angle`, not `radius`/future fields — `radius` is the invariant `SHIP_RADIUS` (resetting is a no-op); "future fields" is speculative for the current ship shape.
  - Discrete circle-circle collision can tunnel a fast seeker — unreachable at shipped constants: `SEEKER_SPEED` 140 px/s × ~16.7 ms ≈ 2.3 px/tick « the 30 px combined radius (`SHIP_RADIUS` 16 + `SEEKER_RADIUS` 14); precedent-rejected in Story 1.4 (circle-circle point-in-time deliberately scoped).
  - No `dt <= 0` guard on the invulnerability countdown — `dt` is always the constant `FIXED_STEP_MS` from `FixedTimestep`; no existing system validates `dt`; same speculative non-production-`dt` class rejected in Stories 1.2–1.4.
  - Invuln blink "frame-rate-independent" comment / truncated final blink segment (`2000/120` not integral) — the blink derives purely from the fixed-step-tracked `invulnMs`, so its sim-time cadence is frame-rate-independent; the partial final segment is cosmetic and imperceptible.
  - Respawn to fixed arena center can chain deaths if seekers cluster there — the respawn invulnerability window is the intent-specified mechanism (AC2) for respawning among live seekers; the player has ~2 s and full control to relocate. Clearing/repositioning seekers on respawn would invent behavior the intent does not specify (`Never`: "Do not destroy, clear, or reset seekers on death"). (Converged: adversarial, edge-case.)

## Design Notes

Dedicated `PlayerDeathSystem` (not an extension of `CollisionSystem`): the player lifecycle — lives, invulnerability, game-over — is a distinct concern from `CollisionSystem`'s pure "release hit pooled entities" role, and folding lifecycle state into it would balloon that system. This matches the one-system-per-concern architecture (Movement, Firing, Enemy, Collision). Running it *after* `CollisionSystem` is load-bearing: a seeker you destroy with a bullet this tick is released before the death test, so it cannot also kill you.

Fixed-step shape (`invulnMs` in ms so the window is frame-rate-independent):

```js
fixedUpdate(dt) {
  const ps = this.playerState;
  if (ps.gameOver) return;                       // run ended — do nothing
  if (ps.invulnMs > 0) {                          // count down (clamp ≥ 0)
    ps.invulnMs -= dt;
    if (ps.invulnMs < 0) ps.invulnMs = 0;
    return;                                       // invulnerable: no lethal contact
  }
  const ship = this.ship, seekers = this._seekers;
  seekers.length = 0;
  this.enemyPool.forEachActive((s) => seekers.push(s));   // reusable scratch (CollisionSystem pattern)
  for (let i = 0; i < seekers.length; i++) {
    const s = seekers[i], dx = ship.x - s.x, dy = ship.y - s.y, r = ship.radius + s.radius;
    if (dx * dx + dy * dy <= r * r) {             // lethal — one death per tick
      ps.lives -= 1;
      if (ps.lives > 0) {
        const sp = createPlayerShip();
        ship.x = sp.x; ship.y = sp.y; ship.vx = 0; ship.vy = 0; ship.angle = sp.angle;
        ps.invulnMs = PLAYER_INVULN_MS;
      } else { ps.lives = 0; ps.gameOver = true; }
      break;
    }
  }
}
```

Note the invulnerable branch `return`s after counting down, so the window ends and the first vulnerable tick are distinct steps (a one-tick boundary, imperceptible). Respawn copies the canonical spawn from `createPlayerShip()` so arena-center lives in one place. The invuln blink in `ArenaScene` derives purely from sim state — `Math.floor(playerState.invulnMs / PLAYER_INVULN_BLINK_MS) % 2` toggling the sprite alpha — so no separate render timer is needed; alpha is solid when `invulnMs == 0`.

## Verification

**Commands:**
- `npm test` -- expected: exit 0; all suites pass, including the new `playerDeathSystem` tests.
- `npm run build` -- expected: exit 0; `dist/` bundle emitted.

**Manual checks (if no CLI):**
- `npm run dev`: let a seeker reach the ship — the ship flips to center and blinks briefly; during the blink further seeker contact is harmless; after the blink ends contact kills again. Repeat until lives are exhausted; the last death sets game-over (no respawn) — the visible game-over screen arrives in Story 1.6.

## Auto Run Result

Status: done

**Summary:** Implemented Story 1.5 — Player Death and Collision. Added a shared, Phaser-free `PlayerState` (`lives`, `invulnMs`, `gameOver`) and a Phaser-free `PlayerDeathSystem` run inside `world.fixedUpdate(dt)` **after** `CollisionSystem` (so a seeker a bullet destroys this tick cannot also kill the player). Each fixed step the system early-returns on game-over, counts the respawn-invulnerability window down by `dt` (clamped ≥ 0) and returns while still invulnerable, otherwise tests the ship against active seekers (circle-circle, lethal when center distance ≤ `ship.radius + seeker.radius`, boundary inclusive) with an early break so overlapping seekers cost exactly one life. On a lethal hit it deducts a life and either respawns the ship at arena center (canonical spawn via `createPlayerShip()`, velocity zeroed) with a fresh `PLAYER_INVULN_MS` window, or — on the last life — sets `gameOver = true` with no respawn. Seekers are never destroyed on ship contact (bullets destroy enemies; the invulnerability window is the specified mechanism for respawning among live seekers). `ArenaScene` creates the state, registers the system after `CollisionSystem`, and blinks the ship sprite's alpha while invulnerable (derived purely from `invulnMs`). All feel magnitudes are centralized constants. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel against the diff since baseline `055cabf`; no intent_gap and no bad_spec were found.

**Files changed (reviewed code diff):**
- `src/config/constants.js` — added `PLAYER_START_LIVES` (3), `PLAYER_INVULN_MS` (2000), `PLAYER_INVULN_BLINK_MS` (120) in a new "Player death / lives" section, documented and tunable.
- `src/state/PlayerState.js` — NEW (Phaser-free): `createPlayerState()` → `{ lives, invulnMs: 0, gameOver: false }`.
- `src/systems/PlayerDeathSystem.js` — NEW (Phaser-free): invuln countdown + ship↔seeker circle-circle death flow (life--, respawn+invuln or game-over), one death per tick, reusable scratch (no steady-state pooled-entity allocation).
- `src/scenes/ArenaScene.js` — create `PlayerState`; register `PlayerDeathSystem(ship, enemySystem.enemyPool, playerState)` after `CollisionSystem`; blink ship alpha while `invulnMs > 0`.
- `src/systems/playerDeathSystem.test.js` — NEW: 10 tests covering every I/O matrix row (lethal contact, no contact, contact-while-invulnerable, exact-boundary touch, just-beyond, frame-rate-independent countdown fine-vs-coarse dt, multiple-seekers-one-tick, last-life game-over, after-game-over early-return, no-alloc).

**Review findings breakdown:** patch 0 · defer 1 · reject 12 · intent_gap 0 · bad_spec 0.
- Patched (0): none.
- Deferred (1, → `deferred-work.md`): the `ArenaScene` player-death wiring/render integration surface — the load-bearing `PlayerDeathSystem`-after-`CollisionSystem` registration order and the invuln blink render — has no automated coverage (adversarial + verification-gap converged); the same deliberately-thin Phaser/scene boundary deferred by Stories 1.1–1.4 (orchestrator-owned).
- Rejected (12): `gameOver` flag not consumed by the scene / no game-over screen / no sim-freeze / no restart (out of scope on the intent's own decomposition — Story 1.6 owns the game-over screen, Story 5.3 the game-flow state machine; 1.5's AC3 is "transitions to a game-over **state**"); input/firing not disabled post-game-over (5.3/1.6); lives not displayed (1.6 HUD AC); no initial spawn invulnerability (not in intent; unreachable at t=0 — no enemy exists yet); per-tick closure alloc (1.3/1.4 precedent; matches `CollisionSystem`); no-alloc test checks pool counts only (matches accepted `collisionSystem` test; verifies the real NFR2 guarantee); respawn throwaway-ship alloc (deliberate; death is rare, not hot-loop); partial field reset (`radius` invariant; future-field speculative); collision tunneling (unreachable — 2.3 px/tick « 30 px combined radius; 1.4 precedent); no `dt<=0` guard (`dt` is the constant fixed step; precedent); blink comment / truncated final blink (cosmetic; comment defensible); respawn-center death spiral (invuln is the intent-specified mechanism; clearing seekers would invent behavior the `Never` list forbids).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 0 → score = 3×0 + 1×0 = 0 (< 5, no high).

**Verification performed:**
- `npm test` → 89/89 pass across 9 files (adds `playerDeathSystem` 10), exit 0.
- `npm run build` → exit 0; `dist/` bundle emitted (the >500 kB Phaser chunk-size warning is expected and out of scope).
- Matrix Test Audit: all 8 `PlayerDeathSystem` I/O matrix rows covered by tests that ran and passed (plus bonus just-beyond-boundary and no-alloc cases).

**Residual risks / artifacts:**
- The deferred `ArenaScene` player-death wiring/render coverage gap remains open (tracked in `deferred-work.md`): a reorder of the `addSystem` calls (PlayerDeath before Collision) or a broken blink formula would pass the whole headless suite yet be wrong in-game; `npm run dev` is the only live-integration verification.
- `PlayerState.gameOver` is set but has no in-game consequence yet (no screen, no sim-freeze) — deliberately deferred to Story 1.6 (game-over screen) and Story 5.3 (game-flow state machine) per the epic decomposition. Feel constants (`PLAYER_START_LIVES=3`, `PLAYER_INVULN_MS=2000`, `PLAYER_INVULN_BLINK_MS=120`) are first-pass defaults for hand-tuning.
- Residual working-tree artifacts left in place (not part of the reviewed code diff; orchestrator-owned): this spec file, the modified `deferred-work.md`, and `sprint-status.yaml` (still lists `1-5-...: backlog` — the orchestrator owns the status flip, per the Story 1.1–1.4 convention).
- `final_revision` recorded in frontmatter after the commit below.
