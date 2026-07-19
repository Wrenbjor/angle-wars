---
title: 'Story 1.3 — Twin-Stick Firing'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '54978d7425457b102020acf5d5b89f9b9e97daa8'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '232312d473c9913c7b2ea436169051f36354adee'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The player ship (Story 1.2) moves and faces its travel direction, but it cannot aim or shoot. There is no aim input, no bullets, and no pooled high-churn entity — the "shoot one way while flying another" core of twin-stick play is missing, and later stories (1.4 Seeker destruction, collision) have no bullets to build on.

**Approach:** Add an independent aim channel and continuous auto-fire. A thin Phaser input layer samples an aim direction each render frame (gamepad **right** stick with radial deadzone; **mouse** pointer position as the complete fallback) into the shared `InputState`. A Phaser-free `FiringSystem`, run inside the fixed-timestep loop, owns a bullet `Pool`, spawns bullets at a fixed cadence in the aim direction (independent of movement), advances them, and despawns them back to the pool when they cross the arena boundary. `ArenaScene` renders active bullets from placeholder vector shapes.

## Boundaries & Constraints

**Always:**
- Aim is fully independent of movement: bullet velocity derives **only** from the aim direction × a fixed bullet speed — never from the ship's velocity or move intent. The player can fire one direction while flying another.
- Firing is continuous auto-fire at a fixed cadence while aim is active — no manual trigger/button. Cadence is driven by accumulating the constant fixed-step `dt` in the `FiringSystem`, so shots-per-second are identical regardless of render frame rate.
- Bullets are drawn from an object `Pool` (one pool per high-churn type). The steady-state spawn/despawn path allocates nothing per frame: reuse via `pool.acquire()`/`pool.release()`, initialize fields in place, and use a reusable scratch buffer for deferred releases. The pool is prewarmed at construction.
- A bullet is despawned and returned to the pool when its center crosses the arena border (the drawn inset boundary) on any side.
- All firing/bullet math (cadence spawn, integration, boundary despawn) lives in the Phaser-free `FiringSystem` and runs only inside `world.fixedUpdate(dt)`, driven by the constant fixed-step `dt` (`dtSec = dt/1000`).
- Every tunable magnitude (fire interval, bullet speed, bullet radius, prewarm count, color) is a named constant in `src/config/constants.js` — no inline magic numbers.
- Pure firing/bullet math and aim-vector normalization must be unit-testable headlessly under Vitest (no Phaser import in `FiringSystem`, `Bullet`, `InputState`, `inputMath`).

**Block If:**
- (none anticipated — this story adds to an existing, installed toolchain and established patterns.)

**Never:**
- Do not implement enemies, collision, bullet-vs-enemy destruction, player death, score, or HUD — later stories (1.4–1.6). This story only spawns/flies/despawns bullets; nothing is hit yet.
- Do not add particle trails, muzzle flash, bloom, screen shake, or any signature aesthetic — placeholder vector shape only (Epic 4).
- Do not add a fire button, charge/burst mechanics, ammo, spread, or weapon types — single continuous stream only.
- Do not add bullets to `world.entities` (churn/splitting cost) — the bullet `Pool` is the single source of active/free truth; expose it for the later collision system.
- Do not add input remapping/config or gamepad hot-swap polish — deferred to Story 5.4.

## I/O & Edge-Case Matrix

Behavior of `FiringSystem.fixedUpdate(dt)` given a ship, an `InputState`, and its bullet pool:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First shot on active aim | `aimActive`, empty pool | one bullet spawned on the first active tick (accumulator seeded to fire immediately) | No error expected |
| Fixed cadence | `aimActive` held for `T` ms of ticks | bullet count ≈ `floor(T / FIRE_INTERVAL_MS)` (± the seeded first shot); independent of tick size | No error expected |
| Aim direction | `aimActive`, aim `(0,1)`, ship `vx=999` | spawned bullet `vx == 0`, `vy == BULLET_SPEED` — ship velocity is NOT inherited (FR1) | No error expected |
| Spawn origin | `aimActive`, ship at `(x,y)`, aim unit `(ax,ay)` | bullet spawns at `(x + ax*radius, y + ay*radius)` (emerges from the nose) | No error expected |
| Inactive aim | `aimActive == false` | no bullet spawned this tick; in-flight bullets still advance | No error expected |
| Bullet flight | active bullet, no new aim | position integrates by `v*dtSec` each tick; count unchanged until boundary | No error expected |
| Boundary despawn | bullet center past inset on any side | bullet released to pool (`activeCount` decreases, `freeCount` increases); reused on next spawn | No error expected |
| Pool reuse (no alloc) | despawn then spawn | second spawn recycles the freed instance (no growth) — `freeCount` drops, `activeCount` rises | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- EDIT: add firing/bullet constants (`FIRE_INTERVAL_MS`, `BULLET_SPEED`, `BULLET_RADIUS`, `BULLET_POOL_PREWARM`, `COLOR_BULLET`).
- `src/entities/Bullet.js` -- NEW (Phaser-free): `createBullet()` → `{ x, y, vx, vy, radius }` pool factory (zeroed; `radius = BULLET_RADIUS`). The shared bullet shape Story 1.4 collision reuses.
- `src/input/inputMath.js` -- EDIT: add pure `normalizeToUnit(x, y)` → `{ x, y, mag }` (unit vector, or zero when `mag === 0`).
- `src/input/InputState.js` -- EDIT: add aim channel — `aimX`, `aimY`, `aimActive`; `setAim(x, y)` (normalizes via `normalizeToUnit`; zero magnitude → inactive); `clearAim()`; `clear()` also clears aim.
- `src/input/PlayerInputSampler.js` -- EDIT: also sample aim each render frame — gamepad **right** stick (deadzoned) with priority, else **mouse** pointer world position minus ship position; write via `inputState.setAim`. Needs a ship reference.
- `src/systems/FiringSystem.js` -- NEW (Phaser-free): the AC-bearing system. Owns `bulletPool` (prewarmed); fixed-cadence spawn in aim direction from the ship origin, per-tick bullet integration, boundary despawn back to the pool, zero per-frame allocation.
- `src/scenes/ArenaScene.js` -- EDIT: pass the ship to `PlayerInputSampler`; create the `FiringSystem` and add it to the world (after movement); render active bullets each render frame via a cleared/redrawn `Graphics`.
- `src/systems/firingSystem.test.js` -- NEW: unit tests for every I/O & edge-case matrix row.
- `src/input/inputMath.test.js` -- EDIT: add `normalizeToUnit` tests and `InputState.setAim`/`clearAim` tests.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `FIRE_INTERVAL_MS`, `BULLET_SPEED`, `BULLET_RADIUS`, `BULLET_POOL_PREWARM`, `COLOR_BULLET` with documented, tunable defaults -- keeps all feel/layout magnitudes centralized.
- `src/entities/Bullet.js` -- implement `createBullet()` returning a zeroed bullet with `radius = BULLET_RADIUS` -- the pooled high-churn entity.
- `src/input/inputMath.js` -- implement `normalizeToUnit(x, y)` (returns unit vector + magnitude; `{0,0,0}` when zero) -- pure aim normalization, reused by `setAim`.
- `src/input/InputState.js` -- add the aim channel and `setAim`/`clearAim`; clear aim in `clear()` -- the render↔sim seam the firing system reads.
- `src/input/PlayerInputSampler.js` -- sample aim: right stick past the deadzone takes priority; otherwise mouse pointer world coords minus ship position; write via `setAim` -- the thin Phaser aim boundary.
- `src/systems/FiringSystem.js` -- implement `fixedUpdate(dt)`: advance + boundary-despawn existing bullets, then (while `aimActive`) accumulate `dt` and spawn at `FIRE_INTERVAL_MS` cadence in the aim direction from the ship nose; own and prewarm `bulletPool`; no per-frame allocation -- the fixed-timestep firing logic.
- `src/scenes/ArenaScene.js` -- pass the ship to the sampler, add the `FiringSystem` to the world after movement, and each render frame clear a `Graphics` and draw a placeholder circle for every active bullet -- delivers on-screen firing without running sim in the render callback.
- `src/systems/firingSystem.test.js` -- unit-test every I/O matrix row -- proves the firing AC logic headlessly.
- `src/input/inputMath.test.js` -- unit-test `normalizeToUnit` and `InputState.setAim`/`clearAim` -- proves aim math headlessly.

**Acceptance Criteria:**
- Given a running game, when the player provides aim input (gamepad right stick or mouse position), then the ship fires bullets continuously in the aim direction at a fixed cadence, independent of its movement direction (FR1, FR2).
- Given the ship is both moving and aiming, when it fires, then bullet velocity comes only from the aim direction × `BULLET_SPEED` and does not inherit the ship's velocity.
- Given bullets are fired rapidly, when many exist at once, then they are drawn from an object pool with no per-frame allocation on the steady-state spawn/despawn path (NFR2).
- Given a bullet reaches the arena edge, when its center crosses the boundary, then it is despawned and returned to the pool (FR3).
- Given the codebase, when a reviewer inspects it, then `FiringSystem`, `Bullet`, `InputState`, and `inputMath` are Phaser-free, the firing system runs inside `world.fixedUpdate(dt)`, and the firing + aim math are covered by passing unit tests.
- Given `npm test` and `npm run build`, when they run, then all unit tests pass and the production build completes, both with exit code 0.

## Spec Change Log

_No entries — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 1
- reject: 10
- addressed_findings:
  - `[low]` `[patch]` Mouse aim fired before any input: `sampleAim`'s mouse fallback wrote `setAim` unconditionally, and Phaser's `activePointer` defaults to `(0,0)` before the pointer moves — so a keyboard+mouse launch auto-fired toward the top-left corner, and an idle-right-stick gamepad player fired toward the stale `(0,0)` cursor. Gated the mouse fallback on pointer engagement (`moveTime > 0 || downTime > 0`), else `clearAim()`. (Deduped three converging reports.)
  - `[low]` `[patch]` Doc/code mismatch: `constants.js` and `Bullet.js` described `BULLET_RADIUS` as the spawn nose offset, but `FiringSystem` spawns from `SHIP_RADIUS`. Corrected both comments (radius is the placeholder/collision half-extent only); no math changed.
  - `[low]` `[patch]` NFR2 no-alloc-under-load was asserted only by the prewarm literal; the recycle test exercised a single bullet. Added a sustained-fire test asserting `freeCount === BULLET_POOL_PREWARM` post-construction and `activeCount + freeCount <= BULLET_POOL_PREWARM` across 400 ticks (pool never grows past the prewarm → factory never runs post-construction).
- deferred:
  - `PlayerInputSampler.sampleAim` — the aim-acquisition path (right-stick deadzone priority; mouse `worldX/worldY − ship` fallback), the surface the primary AC literally names, has no automated coverage; every firing test seeds `input.setAim(...)` directly. Two review layers (verification-gap, intent-alignment) converged. Recorded to `deferred-work.md` — it is the deliberately-thin Phaser boundary the spec scoped out of headless testing (mirrors the Story 1.1 render-integration and Story 1.2 movement-sampler deferrals), and closing it needs scene/input mocking beyond this story's captured intent (orchestrator-owned).
- rejected (noise / speculative / out-of-scope on the intent's authority / not a present defect):
  - Non-finite (NaN/Infinity) aim producing un-cullable, pool-leaking bullets — the browser Gamepad API and Phaser pointer yield finite doubles; precedent-rejected as speculative in Story 1.2's identical NaN-axis finding.
  - Freshly-spawned bullet rendering one frame past the border — unreachable: the ship center is clamped to `inset + radius` on each axis and the per-axis nose offset is `≤ radius`, so a spawn point at most touches the border exactly, and `isOutsideArena` uses strict inequalities.
  - No `Pool.clear()` teardown on scene shutdown/restart — no restart path exists yet; the later story that introduces restart owns its teardown (precedent-rejected in Story 1.2).
  - No `FIRE_INTERVAL_MS > 0` guard (infinite spawn loop if tuned to 0/negative) — speculative tuner misuse of a constant-driven positive value (same class as Story 1.2's rejected deadzone-range validation).
  - Same-tick bullet stacking if `FIRE_INTERVAL_MS < FIXED_STEP_MS` — speculative future tuning; masked and correct for realistic values (90 ms ≫ 16.7 ms).
  - Rapid-fire by flicking aim across the deadzone (seed-to-fire-immediately on every re-activation) — a deliberate, spec-documented responsiveness choice; marginal to trigger and there is no scoring/DPS to exploit in this epic.
  - Cadence test drives a `dt` the production path never emits — the cadence logic is proven at the unit level and the render→sim frame-rate independence is separately covered by `fixedTimestep.test.js`; a real regression in either would fail an existing suite.
  - Stale ship reference if Story 1.5 respawns via a new entity — speculative future work; the ship is an established single long-lived entity (mutated in place), matching Story 1.2's design.
  - Aim deadzone rescale discarded by the subsequent unit-normalization — a micro-inefficiency with no behavioral effect (direction is preserved; only the threshold matters).
  - Per-frame closure allocation in the bullet-draw render callback — NFR2 targets the sim spawn/despawn path (satisfied); a single closure per render frame is negligible and consistent with the pre-existing `fixedUpdate` callback.

## Design Notes

Fire cadence (fixed-step accumulator inside `FiringSystem`, `dtSec = dt/1000`):

```js
// advance + despawn existing bullets first (runs even when aim is inactive)
this._expired.length = 0;                 // reusable scratch — no per-frame alloc
pool.forEachActive((b) => {
  b.x += b.vx * dtSec; b.y += b.vy * dtSec;
  if (outsideArena(b.x, b.y)) this._expired.push(b);   // center vs ARENA_BORDER_INSET
});
for (let i = 0; i < this._expired.length; i++) pool.release(this._expired[i]);

// then spawn at fixed cadence while aiming
if (input.aimActive) {
  this._accumMs += dt;
  while (this._accumMs >= FIRE_INTERVAL_MS) {
    const b = pool.acquire();              // recycles a freed instance
    b.x = ship.x + input.aimX * ship.radius;
    b.y = ship.y + input.aimY * ship.radius;
    b.vx = input.aimX * BULLET_SPEED;
    b.vy = input.aimY * BULLET_SPEED;
    this._accumMs -= FIRE_INTERVAL_MS;
  }
} else {
  this._accumMs = FIRE_INTERVAL_MS;        // ready to fire immediately on re-aim; no backlog
}
```

Constructor seeds `_accumMs = FIRE_INTERVAL_MS` so the first active tick fires at once (responsive), and resetting to the interval when inactive prevents a burst after a pause. Releases are deferred to a second pass because `Pool.forEachActive` forbids mutating the active set mid-iteration. Bullets are pool-managed, **not** in `world.entities`, to avoid `splice`/`indexOf` churn; the pool is exposed (`firingSystem.bulletPool`) for Story 1.4's collision. Bullet velocity excludes ship velocity by construction — that is the FR1 independence guarantee. Mouse aim uses `pointer.worldX/worldY` (arena/logical space via the FIT camera) so it matches the ship's coordinate space; gamepad aim uses the **right** stick (left stick is movement).

## Verification

**Commands:**
- `npm test` -- expected: exit 0; all suites pass, including the new `firingSystem` tests and the extended `inputMath` tests.
- `npm run build` -- expected: exit 0; `dist/` bundle emitted.

**Manual checks (if no CLI):**
- `npm run dev`: with a gamepad, the right stick fires a continuous stream in the aimed direction while the left stick flies the ship elsewhere; with keyboard+mouse, the ship auto-fires toward the cursor (once the mouse has moved) while WASD flies it; bullets stream from the ship nose, travel straight, and vanish exactly at the arena border.

## Auto Run Result

Status: done

**Summary:** Implemented Story 1.3 — Twin-Stick Firing. Added an independent aim channel to the shared `InputState` (`aimX`/`aimY`/`aimActive` via `setAim`/`clearAim`, backed by a pure `normalizeToUnit` helper) and extended the thin Phaser `PlayerInputSampler` to sample aim each render frame: gamepad **right** stick (radial deadzone) with priority, else the mouse pointer's world position relative to the ship. A Phaser-free `FiringSystem`, run inside `world.fixedUpdate(dt)`, owns a prewarmed bullet `Pool` (bullets live in the pool, not `world.entities`), spawns bullets at a fixed cadence in the aim direction from the ship nose, advances them, and despawns them back to the pool when their center crosses the arena border. Bullet velocity derives **only** from the aim direction × `BULLET_SPEED` — never the ship's velocity (the FR1 independence guarantee). `ArenaScene` renders active bullets as placeholder vector circles each render frame. All feel magnitudes are centralized constants. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel against the diff since baseline `54978d7`; the intent-alignment audit confirmed the sim engine (cadence/pooling/independence/despawn) matches the intent, with no intent_gap and no bad_spec.

**Files changed (reviewed code diff):**
- `src/config/constants.js` — added `FIRE_INTERVAL_MS`, `BULLET_SPEED`, `BULLET_RADIUS`, `BULLET_POOL_PREWARM`, `COLOR_BULLET` (patched: corrected the `BULLET_RADIUS` comment re: spawn offset).
- `src/entities/Bullet.js` — NEW (Phaser-free): `createBullet()` pool factory → `{x,y,vx,vy,radius}` (patched: corrected the radius doc line).
- `src/input/inputMath.js` — NEW helper `normalizeToUnit(x,y)` → `{x,y,mag}`.
- `src/input/InputState.js` — added the aim channel (`aimX`/`aimY`/`aimActive`, `setAim`, `clearAim`); `clear()` clears aim.
- `src/input/PlayerInputSampler.js` — split into `sampleMove`/`sampleAim`; aim = right-stick priority, else mouse-minus-ship (patched: gated the mouse fallback on pointer engagement).
- `src/systems/FiringSystem.js` — NEW (Phaser-free): the AC-bearing firing/bullet-lifecycle system with a prewarmed pool and zero per-frame allocation.
- `src/scenes/ArenaScene.js` — wired the ship into the sampler, added `FiringSystem` after movement, and render active bullets via a cleared/redrawn `Graphics`.
- `src/input/inputMath.test.js` — added `normalizeToUnit` + `InputState.setAim`/`clearAim`/`clear` tests.
- `src/systems/firingSystem.test.js` — NEW: 9 tests covering every I/O matrix row plus the patched NFR2 no-growth-under-load test.

**Review findings breakdown:** patch 3 (low 3) · defer 1 · reject 10 · intent_gap 0 · bad_spec 0.
- Patched (3): mouse aim fired toward the top-left corner before any input (gated the mouse fallback on pointer engagement); `BULLET_RADIUS` doc/code mismatch on the spawn nose offset (comment-only); NFR2 no-alloc-under-load asserted only by the prewarm literal (added a sustained-fire pool-no-growth test).
- Deferred (1, → `deferred-work.md`): `PlayerInputSampler.sampleAim` aim-acquisition path (right-stick priority + mouse-minus-ship fallback + engagement gate) has no automated coverage — the surface the primary AC names; the deliberately-thin Phaser boundary needing scene/input mocking (orchestrator-owned; mirrors the 1.1/1.2 sampler deferrals).
- Rejected (10): NaN/non-finite aim (platform yields finite doubles — 1.2 precedent); spawn one-frame overspawn (unreachable given the ship clamp vs nose offset + strict inequalities); no pool teardown (no restart path yet — 1.2 precedent); `FIRE_INTERVAL_MS > 0` guard (speculative tuner misuse); interval-below-step stacking (speculative); rapid-fire-on-reaim (deliberate documented cadence, no scoring to exploit); cadence-test dt (logic + FixedTimestep independence separately covered); stale ship ref (speculative 1.5); aim deadzone rescale nit; render-closure alloc nit (NFR2 targets the sim path).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 3 → score = 3×0 + 1×3 = 3 (< 5, no high).

**Verification performed:**
- `npm test` → 62/62 pass across 6 files (pool 8, fixedTimestep 11, world 5, inputMath 18, firingSystem 9, playerMovementSystem 11), exit 0. Re-run after the patches also green.
- `npm run build` → exit 0; `dist/` bundle emitted (the >500 kB Phaser chunk-size warning is expected and out of scope).
- Matrix Test Audit: all 8 I/O matrix rows covered by tests that ran and passed.

**Residual risks / artifacts:**
- The deferred aim-sampler coverage gap remains open (tracked in `deferred-work.md`) — a wrong stick, inverted subtraction, or screen-vs-world coord mistake in `sampleAim` would not be caught by the current headless suite; `npm run dev` is the only live-input verification.
- Feel constants (`FIRE_INTERVAL_MS=90`, `BULLET_SPEED=900`, `BULLET_RADIUS=4`, `BULLET_POOL_PREWARM=64`) are first-pass defaults; the epic expects hand-tuning post-launch. Peak simultaneous in-flight is ~17 (≈11 shots/s × ~1.5 s max traversal), comfortably under the 64 prewarm.
- Residual working-tree artifacts left in place (not part of the reviewed code diff; orchestrator-owned): this spec file, the modified `deferred-work.md`, and `sprint-status.yaml` (still lists `1-3-...: backlog` — the orchestrator owns the status flip, per the Story 1.1/1.2 convention).
- `final_revision` recorded in frontmatter after the commit below.
