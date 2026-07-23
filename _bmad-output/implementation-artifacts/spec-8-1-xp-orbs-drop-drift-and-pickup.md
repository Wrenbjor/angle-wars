---
title: 'Story 8.1 — XP Orbs: Drop, Drift & Pickup'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: 'cde4a338e9f6f6d9f85ba6cc70981ffbc021af0d'
final_revision: '8ae14d99c204d3e679712e19a7480bb4aada50ae'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The v1 loop has no progression economy. Epic 8 builds the level-up loop on top of the untouched v1 game; its first brick is XP orbs — kills must drop collectible XP so combat feeds progression and leaving orbs behind is a real risk/reward choice.

**Approach:** Add a new **XP economy** parallel to the existing `score` economy: every enemy death that *credits score today* also drops one pooled XP orb carrying a small per-type XP value. A new pooled, Phaser-free `XpOrbSystem` (modeled on `ParticleSystem`) advances orbs — drifting toward the ship only when the ship is within a pickup radius, collecting on contact — and credits the run's XP total, scaled by the current multiplier. Purely additive: the v1 loop is unchanged.

## Boundaries & Constraints

**Always:**
- XP is a **separate economy from score** (new small values: Seeker 1, Green Square 2, Pinwheel 2, Snake body 1 / head 3, Black Hole defused 25, Mirror center-kill 15) — never derived from `score`.
- Orbs drop from **exactly the seams that credit score today**: bullet kills (Seeker/Green/Pinwheel/Snake), Black-Hole **implosion** ("defused"), and Mirror-Reflector **center-kill**. Bomb-cleared and black-hole-**absorbed** enemies credit no score today and therefore drop **no** XP (economy parity).
- One orb per death, carrying that death's full per-type XP value.
- Zero per-frame allocation on the steady-state path (pool reuse; reusable scratch arrays; recycle-safe coordinate snapshots) — mirror the `ParticleSystem`/`CollisionSystem` discipline.
- Live orbs are bounded by a pooled cap; a spawn that would exceed the cap is skipped (the `ParticleSystem` precedent). Orbs on the floor **never time out**.
- On collect, credit `orb.value × (1 + multiplier / XP_MULTIPLIER_DIVISOR)` using the multiplier **at collect time**; accumulate as a float (no rounding).
- Run XP total is run-scoped like `score`: rebuilt from zero on a fresh run, **not** reset on death (`resetMultiplier` stays untouched).

**Block If:**
- The economy-parity reading (bomb/absorb kills drop no XP) is contradicted by a stated requirement — HALT (`intent gap`).

**Never:**
- Do not modify v1 movement, firing, bombs, multiplier, scoring, or death behavior.
- Do not introduce new gameplay randomness — Story 8.1 has none; the seedable-RNG seam belongs to later stories (8.4). No `Math.random` added.
- Do not build the level curve, leveling, HUD level bar, or card UI (Stories 8.2–8.5).
- Do not put the orb pool on any other system; each system owns its own pool — cross-system drops flow through per-tick report arrays.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bullet kill | `collisionSystem.bulletKillCount` k with `bulletKillX/Y/Xp` snapshots | One orb spawned per kill at the snapshot coords with that kill's `xp` value | Non-finite `xp` snapshot → 0 (guard, like scoring's finite-score guard) |
| Snake head vs body | head segment killed vs body segment killed | Head drops value 3, body drops value 1 | Pooled segment reused across snakes → `spawn()` re-sets every segment's `xp` explicitly |
| Black Hole defused | hole radius ≤ min → implosion | One orb (value 25) at the hole's position | Coords snapshotted at detection (before release) — recycle-safe |
| Mirror center-kill | ship reaches reflector center | One orb (value 15) at reflector center | Coords pushed at center-destroy; per-tick report reset each tick |
| Bomb / absorb kill | enemy released by bomb or black-hole absorb | **No** orb dropped (unscored → no XP) | n/a |
| Orb outside pickup radius | ship dist > `XP_PICKUP_RADIUS` | Orb stays put; persists indefinitely (no timeout) | n/a |
| Orb within pickup radius | ship dist ≤ `XP_PICKUP_RADIUS`, > collect radius | Orb moves toward ship by `XP_ORB_DRIFT_SPEED·dt` | n/a |
| Orb on contact | ship dist ≤ `SHIP_RADIUS + XP_ORB_RADIUS` | Collected: `scoreState.xp += value × (1 + mult/20)`; orb released to pool | n/a |
| Cap reached | `pool.activeCount ≥ XP_ORB_MAX` | New-orb spawn skipped this tick | n/a |
| Multiplier scaling | value 2 collected at mult 10 | credits 3.0 (`2 × 1.5`); at mult 1 credits 2.1 (`2 × 1.05`) | Non-finite mult impossible (v1 invariant) |

</intent-contract>

## Code Map

- `src/entities/XpOrb.js` -- **new** pooled orb factory `createXpOrb()` → `{x,y,value}` (mirror `Particle.js`).
- `src/systems/XpOrbSystem.js` -- **new** pooled Phaser-free system: advance/drift/collect + spawn from the three drop reports (mirror `ParticleSystem.js` structure/discipline).
- `src/config/constants.js` -- append XP values, pickup radius, drift speed, orb radius, live-orb cap, multiplier divisor, orb color.
- `src/state/ScoreState.js` -- add `xp: 0` to `createScoreState()`; leave `resetMultiplier` untouched.
- `src/entities/Seeker.js`, `GreenSquare.js`, `Pinwheel.js`, `SnakeSegment.js` -- add `xp` field to each factory + update shape comment.
- `src/systems/SnakeSystem.js` -- in `spawn()`'s segment loop, set every segment's `xp` (`i===0 ? SNAKE_HEAD_XP : SNAKE_SEGMENT_XP`).
- `src/systems/CollisionSystem.js` -- add `bulletKillXp[]` snapshot parallel to `bulletKillX/Y` (captured in pass 2, non-finite→0).
- `src/systems/BlackHoleSystem.js` -- add per-tick `defusedX[]/defusedY[]` report; reset each tick; push hole coords at implosion detection.
- `src/systems/MirrorReflectorSystem.js` -- add per-tick `centerKillX[]/centerKillY[]` report; reset each tick; push center coords on center-destroy.
- `src/scenes/buildArenaWorld.js` -- construct/register `XpOrbSystem` after `BombSystem`; return `xpOrbSystem` handle; bump "20 systems" comment → 21.
- `src/scenes/ArenaScene.js` -- assign handle; add `xpOrbGraphics` (in the additive-neon layer list); render active orbs each frame; add `XP` line to the HUD readout.
- `src/systems/xpOrbSystem.test.js` -- **new** unit tests for the I/O matrix.
- `src/scenes/buildArenaWorld.test.js` -- extend `CANONICAL_ORDER` (21) + `RETURN_HANDLES` (+`xpOrbSystem`) + a wiring assertion.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- append: `SEEKER_XP=1`, `GREEN_SQUARE_XP=2`, `PINWHEEL_XP=2`, `SNAKE_SEGMENT_XP=1`, `SNAKE_HEAD_XP=3`, `BLACKHOLE_DEFUSED_XP=25`, `MIRROR_CENTER_KILL_XP=15`, `XP_ORB_MAX=512`, `XP_ORB_RADIUS=4`, `XP_PICKUP_RADIUS=120`, `XP_ORB_DRIFT_SPEED=320`, `XP_MULTIPLIER_DIVISOR=20`, `COLOR_XP_ORB=0x00ffaa` (each with a one-line rationale comment, matching file style).
- `src/entities/XpOrb.js` -- new factory returning `{x:0,y:0,value:0}`; doc comment mirroring `Particle.js` (pool-owned, fields overwritten on spawn).
- `src/state/ScoreState.js` -- add `xp: 0` to the returned object + document it as the run XP total (run-scoped, not reset on death); update the shape comment.
- `src/entities/Seeker.js` / `GreenSquare.js` / `Pinwheel.js` / `SnakeSegment.js` -- add `xp: <TYPE>_XP` to each factory return + shape comment. (Snake default `SNAKE_SEGMENT_XP`; head override happens in `spawn()`.)
- `src/systems/SnakeSystem.js` -- import `SNAKE_HEAD_XP`, `SNAKE_SEGMENT_XP`; in the `spawn()` segment loop set `seg.xp = i === 0 ? SNAKE_HEAD_XP : SNAKE_SEGMENT_XP` for **every** segment (a recycled ex-head must be reset to body value).
- `src/systems/CollisionSystem.js` -- add `this.bulletKillXp = []` (constructor, with the other snapshot arrays); reset its length alongside `bulletKillX/Y`; in pass 2 push `Number.isFinite(s.xp) ? s.xp : 0` alongside the coordinate snapshot.
- `src/systems/BlackHoleSystem.js` -- add public `this.defusedX = []`, `this.defusedY = []`; reset both `.length = 0` at the top of `fixedUpdate`; in the detection pass where `implodeHoles.push(hole)` runs, also push `hole.x`/`hole.y`.
- `src/systems/MirrorReflectorSystem.js` -- add public `this.centerKillX = []`, `this.centerKillY = []`; reset both where `_releaseReflectors.length = 0` is reset each tick; in `_interact`'s center-destroy branch push `r.x`/`r.y`.
- `src/systems/XpOrbSystem.js` -- new system. Constructor `(collisionSystem, blackHoleSystem, mirrorReflectorSystem, ship, scoreState, maxOrbs = XP_ORB_MAX)`; own `this.pool = new Pool(createXpOrb)`; guard `maxOrbs` finite-&->0 (else default). `fixedUpdate(dt)`: (1) materialize active orbs into reusable scratch, for each compute ship distance — if ≤ `XP_PICKUP_RADIUS` move toward ship by `XP_ORB_DRIFT_SPEED·dt/1000`; if ≤ `SHIP_RADIUS + XP_ORB_RADIUS` credit `scoreState.xp += value × (1 + scoreState.multiplier / XP_MULTIPLIER_DIVISOR)` and collect into an expired-scratch, release in a second pass; (2) spawn from reports honoring the cap — bullet kills (`bulletKillX/Y/Xp[0..bulletKillCount)`), defused holes (value `BLACKHOLE_DEFUSED_XP`), center-kills (value `MIRROR_CENTER_KILL_XP`). Advance-then-spawn ordering (fresh orb waits one tick, like `ParticleSystem`).
- `src/scenes/buildArenaWorld.js` -- import `XpOrbSystem`; construct after `bombSystem`'s late-bind with the shared `collisionSystem, blackHoleSystem, mirrorReflectorSystem, ship, scoreState`; `world.addSystem(...)`; add `xpOrbSystem` to the return object; update the "20 systems" prose to 21.
- `src/scenes/ArenaScene.js` -- `this.xpOrbSystem = arena.xpOrbSystem`; create `this.xpOrbGraphics = this.add.graphics()` alongside the other pooled-entity graphics and include it in the `applyAdditiveBlend([...])` list; in the render loop clear it and draw a filled `COLOR_XP_ORB` circle of `XP_ORB_RADIUS` per active orb (mirror the particle render, zero per-frame allocation); append `\nXP ${Math.floor(this.scoreState.xp)}` to the `hudText.setText(...)` template.
- `src/systems/xpOrbSystem.test.js` -- new; cover every I/O-matrix row (drop-from-each-seam, drift-gate, collect+multiplier-scaling at mult 1 and 10, no-timeout persistence over many ticks, cap-skip, and no-drop for a non-reported death). Use a hand-built system with stub report objects + a plain ship/scoreState.
- `src/scenes/buildArenaWorld.test.js` -- insert `'XpOrbSystem'` into `CANONICAL_ORDER` right after `'BombSystem'`; add `'xpOrbSystem'` to `RETURN_HANDLES`; add a test asserting the system holds the shared `ship`/`scoreState`/`collisionSystem`/`blackHoleSystem`/`mirrorReflectorSystem`; update the "20"→"21" prose in the suite comments.

**Acceptance Criteria:**
- Given a Seeker/Green/Pinwheel/Snake is bullet-killed, when the tick resolves, then exactly one orb appears at the kill position carrying that type's XP value (Seeker 1, Green 2, Pinwheel 2, snake body 1, snake head 3), from the pooled system with no per-frame allocation.
- Given a black hole implodes ("defused"), when the tick resolves, then one orb worth 25 XP appears at the hole's position; given a bomb detonation or a black-hole absorb removes enemies, then no XP orbs appear for those removals.
- Given a Mirror Reflector center-kill, when it resolves, then one orb worth 15 XP appears at the reflector center.
- Given orbs on the floor and the ship outside the pickup radius, when many ticks pass, then the orbs remain (no timeout) up to the live-orb cap; when the ship comes within the pickup radius, then orbs drift toward it and are collected on contact.
- Given the current multiplier m, when an orb of value v is collected, then `scoreState.xp` increases by `v × (1 + m/20)` (e.g. v=2 at m=10 → +3.0), with the total surviving a (non-final) death.
- Given `npm test`, when the suite runs, then all existing suites still pass and the new XP-orb + extended wiring tests pass.

## Design Notes

**Economy parity is the load-bearing decision.** AC1's per-type list enumerates *scored* deaths — including the two named special cases (Black Hole **defused**, Mirror **center-kill**) that credit `score` directly — and pointedly omits bomb/absorb removals, which credit no score today. XP therefore mirrors the exact `score` seams. This also avoids a bomb-farming / hole-farming XP exploit and keeps XP a genuine reward economy (reinforced by AC4 tying XP to the multiplier bonus).

**Drop position is recycle-safe by construction.** Bullet-kill coords already snapshot into `bulletKillX/Y` because a killed enemy object can be recycled; `bulletKillXp` extends that same snapshot for the value. Black-hole and mirror reports push primitive coords at detect/kill time (before any pool release), so no aliasing.

**Drift is a per-tick distance gate, not a magnet latch** — matches AC2/AC3's literal "within the pickup radius drift toward … outside … persist." An orb the ship approaches then leaves stops drifting. No `drifting` field needed.

Golden shape of the collect credit (fractional, collect-time multiplier):
```js
scoreState.xp += orb.value * (1 + scoreState.multiplier / XP_MULTIPLIER_DIVISOR);
```

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including `xpOrbSystem.test.js` and the extended `buildArenaWorld.test.js`.
- `npm run build` -- expected: production Vite build succeeds (no unresolved imports from the new modules/constants).

**Manual checks:**
- `npm run dev`, play a run: killing enemies leaves teal orbs; walking near them pulls them in and the HUD `XP` climbs; orbs left far away stay on the floor; a defused black hole and a mirror center-kill each leave a bright orb.

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` XpOrbSystem drift overshoot — a drift step that would reach/pass the ship now COLLECTS the orb that tick, so a future-tuned larger `XP_ORB_DRIFT_SPEED` can't overshoot the collect band, oscillate the orb across the ship, and permanently hold a cap slot.
  - `[low]` `[patch]` BlackHoleSystem `defusedX/Y` producer test — implosion pushes hole coords, detonation/no-defuse tick stays empty (economy parity + reset).
  - `[low]` `[patch]` MirrorReflectorSystem `centerKillX/Y` producer test — center-destroy pushes center coords, weight-kill stays empty (+ reset).
  - `[low]` `[patch]` Enemy factory `xp`-default assertions added (Seeker/Green/Pinwheel) so a regressed factory can't silently drop 0-XP orbs behind the finite-guard.
  - `[medium]` `[patch]` New `xpOrbIntegration.test.js` — real `buildArenaWorld` world: a real bullet kill → orb → collect credits `scoreState.xp` by `value × (1 + mult/20)`; a bomb-cleared kill credits none; `createScoreState().xp === 0` (guards the xp:0 → NaN regression).
- Rejected (noise/per-spec/hypothetical): cap-starvation & cap-income-death (AC mandates no-timeout; 512 cap unreachable in real play), collect-time-multiplier "exploit" (AC4-specified behavior), "separate economy" wording (no behavioral contradiction — values are separate, the multiplier input is shared per AC4), order-enforced-by-test-only (the established codebase pattern for all 21 systems), `XP_MULTIPLIER_DIVISOR` zero-guard & value-0 skip (fixed design constant / cannot fire under shipped factories — over-defensive), `XP_ORB_RADIUS` comment nit, HUD `Math.floor` shows-0 (false premise — min orb 1 × 1.05 floors to 1), `bulletKillCount` array-length bound (hypothetical; consistent with the existing ParticleSystem read).

### 2026-07-23 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 15: (high 0, medium 2, low 13)
- addressed_findings:
  - `[low]` `[patch]` `xpOrbSystem.test.js` diagonal-drift test — the sole drift test used a horizontal offset (dy=0), so the y-component of the drift update was never observed; added a (60,80)/dist-100 approach asserting both axes move by the unit-vector·step (regression guard for a dropped/duplicated/sign-flipped y term).
  - `[low]` `[patch]` `xpOrbSystem.test.js` cross-seam cap test — the cap `break` in the defuse and mirror spawn loops was never exercised (only the bullet-loop cap was); added a maxOrbs:2 / 3-defuse + 1-mirror case that fails if either later-seam break regresses.
  - `[medium]` `[patch]` `xpOrbIntegration.test.js` end-to-end defuse + mirror seams — only the bullet-kill seam was proven end-to-end; the black-hole-defuse (25) and mirror-center-kill (15) seams were verified only as producer-half + stubbed-consumer-half. Added real-implosion → orb → collect and real-center-destroy → orb → collect through the composed `buildArenaWorld` chain (and added `mirrorReflectorSystem.fixedUpdate` to the integration `runTick`, a no-op without live reflectors).
- Rejected (noise/per-spec/out-of-scope/hypothetical): cap+no-timeout economy stall & fixed spawn-order high-value starvation (AC-mandated no-timeout; 512 cap unreachable in real play), `scoreState`/multiplier/`XP_MULTIPLIER_DIVISOR`/`XP_ORB_DRIFT_SPEED` finite-guards (matrix declares non-finite mult impossible; fixed design constants — over-defensive, consistent with the prior pass), value-0 orb skip (finite-guarded, cannot fire under shipped factories), XP absent from the game-over overlay & 6-line HUD mobile fit (progression UI is scoped to 8.2–8.5; the XP readout line is intent-authorized and the fit concern is speculative), XP float-vs-`Math.floor` display drift (intent mandates float accumulation), no `reset()`/`clear()` seam & straight-line drift through hazards (future-story concerns, not defects), overshoot-collect branch untested (defensive future-tuning guard, unreachable under any shipped constant — testing it requires mocking the constants module, over-engineering).

### 2026-07-23 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - none
- Convergence note: this third pass (4 layers — adversarial, edge-case, verification-gap, intent-alignment) surfaced **no new real defect**. The intent-alignment auditor independently confirmed the load-bearing economy-parity premise holds (`BlackHoleSystem` implosion & `MirrorReflectorSystem` center-kill do credit `score`; bomb-clear & black-hole-absorb credit none and never enter `bulletKillCount`), so the Block-If never fires. Every finding re-raised an item both prior passes already adjudicated with the same reasoning, or was cosmetic/hypothetical/over-defensive that the intent explicitly resolves. The spec has converged.
- Rejected (re-raised / noise / per-spec / hypothetical / out-of-scope): cap silently breaks parity headline (intent explicitly authorizes cap-skip; 512 unreachable in real play — 2× prior reject), `XP_MULTIPLIER_DIVISOR` divide-by-zero guard (fixed design constant = 20 — 2× prior reject), finite-guard on credit for `o.value`+`multiplier` (matrix declares non-finite mult impossible; bullet `xp` already snapshot-guarded; defuse/mirror are constants — 2× prior reject), null-`ship`/null-`scoreState` asymmetric guards (hard wiring invariants; hypothetical teardown races), overshoot-collect couples collect radius to drift speed **and** its branch is untested (deliberate future-tuning dead-code guard added in follow-up pass 1, unreachable at shipped `step≈5.33px < collectR 20px` — 1× prior reject), "scaled by the multiplier" comment nit (formula is AC4-exact), black-hole-absorb parity untested (identical mechanism to the already-end-to-end-tested bomb-clear case — the "unscored removal → no XP" invariant is already pinned), 6-line HUD mobile fit (speculative — 1× prior reject), no-timeout + cap = opt-out-able economy (AC-mandated no-timeout — 2× prior reject), asymmetric finite-guard across seams (constant-sourced seams carry no per-instance data), XP single observable sink / no game-over surface (progression UI scoped to 8.2–8.5 — 1× prior reject), `ArenaScene` render/HUD unverified by executing test (matches the whole codebase's Phaser-untestable convention across all 21 systems; covered by the Verification section's manual checks — reviewer flagged it as a soft gap, not a defect).

## Auto Run Result

Status: done
Blocking condition: none

**Trigger:** Follow-up review pass on a `done` spec (`followup_review_recommended: true` from the prior pass). Routed via step-01 `done` → step-04 with `review_loop_iteration` reset to 0.

**Summary of implemented change:** Story 8.1 adds a pooled, Phaser-free `XpOrbSystem` and a new XP economy running parallel to `score` — enemies that credit score today (bullet kills, black-hole "defused" implosion, mirror center-kill) each drop one pooled XP orb; orbs drift toward the ship only within `XP_PICKUP_RADIUS`, collect on contact, and credit `scoreState.xp += value × (1 + multiplier/20)` as an unrounded float. Bomb-cleared and black-hole-absorbed (unscored) removals drop no orb. Purely additive; the v1 loop is untouched. **No code changed in this review pass** (patch: 0).

**Files changed (already committed at `8ae14d9`, unchanged this pass):** new `XpOrb.js`, `XpOrbSystem.js`, `xpOrbSystem.test.js`, `xpOrbIntegration.test.js`; `constants.js` (XP values/radii/speed/cap/divisor/color), `ScoreState.js` (`xp:0`), `Seeker/GreenSquare/Pinwheel/SnakeSegment.js` (+`xp` field), `SnakeSystem.js` (head/body xp reset), `CollisionSystem.js` (`bulletKillXp[]`), `BlackHoleSystem.js` (`defusedX/Y[]`), `MirrorReflectorSystem.js` (`centerKillX/Y[]`), `buildArenaWorld.js` (register system, 20→21), `ArenaScene.js` (orb render + HUD XP line); wiring/producer tests extended across `buildArenaWorld.test.js`, `collisionSystem/blackHoleSystem/mirrorReflectorSystem/snakeSystem/greenSquareSystem/pinwheelSystem.test.js`.

**Review findings breakdown (this pass, 4 layers):** intent_gap 0, bad_spec 0, patch 0, defer 0, reject 14 (all low). No patches applied; no items deferred. All 14 rejects re-raise items adjudicated in the two prior passes or are cosmetic/hypothetical/over-defensive that the intent explicitly resolves — the intent-alignment auditor independently confirmed the economy-parity Block-If premise holds. See the `Review Triage Log` follow-up-2 entry for the itemized reject rationale.

**Follow-up review recommendation:** `false`. Patched findings this pass by severity: high 0, medium 0, low 0. Score `3×0 + 1×0 = 0` (< 5) and no high patch → `followup_review_recommended: false`. The spec has converged: three passes, no surviving defect.

**Verification performed:** No code delta this pass, so no verification re-run was mandated (the patch branch never fired). The reviewed diff is byte-identical to `final_revision 8ae14d9`, whose `npm test` / `npm run build` green state was established by the prior passes. `git status` confirms zero uncommitted `src/` changes.

**Residual risks:** None new. The only latent items are deliberate, intent-authorized design choices (cap-skip at 512, no orb timeout, the unreachable overshoot-collect future-guard) and the codebase-wide convention that Phaser render/HUD is manually verified rather than unit-tested.

**Residual artifacts (left in place, not part of the reviewed diff):** `_bmad-output/implementation-artifacts/spec-8-1-xp-orbs-drop-drift-and-pickup.md` (this workflow's own status/triage bookkeeping) and `_bmad-output/implementation-artifacts/sprint-status.yaml` — both owned by the orchestrator, not committed by this run.


