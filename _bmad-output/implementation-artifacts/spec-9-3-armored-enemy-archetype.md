---
title: 'Story 9.3 — Armored Enemy Archetype'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: '690f6940d488ec623ac93e8598d78f50090d1980'
final_revision: '4f88d2dcd1327ea179a1b8477481f97ef87410b0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Every combat enemy is one-shot (no HP; `CollisionSystem` releases on the first bullet touch), so a pure-projectile build clears the whole swarm trivially and there is no late-game pressure to diversify into melee/AoE. Epic 9 needs the armored archetype — the counter that keeps melee/mine/AoE builds relevant — and it must not corrupt the just-shipped 9.2 governor's build-power signal.

**Approach:** Introduce a new **Armored** enemy archetype (own entity + system + pool) that spawns through the existing SpawnDirector + telegraph seam, gated to appear once a run passes ~15:00 **or** build power (director `pressure`) crosses a threshold. Give it multi-hit `hp`; make **only the projectile path** (`CollisionSystem`) decrement `hp` and release at 0, so projectiles deal *reduced* effective damage (N hits to kill) while the AoE/melee paths (smart bomb, black hole) — which already release enemies unconditionally regardless of `hp` — deal *full* damage for free. Each projectile **hit** (killing or not) credits one integer damage-unit to a new `CollisionSystem.bulletDamageCount`, which `DpsTelemetrySystem` reads instead of `bulletKillCount` — so damage poured into armor still registers as build power and the governor stays honest (the refinement the DpsTelemetry comment reserves for this story). Per-hit integer crediting keeps the DPS ring integer-valued, avoiding the float-drift the deferred ledger feared.

## Boundaries & Constraints

**Always:**
- The armored enemy takes **reduced damage from projectiles** (survives `ARMORED_HP` bullet hits) and **full damage from melee/AoE** (one smart-bomb clear or black-hole absorption kills it regardless of remaining `hp`). It is **never immune** to anything.
- The projectile-vs-AoE distinction is a **per-damage-source modifier keyed on the source path**, not a new pipeline: HP is decremented **only** in `CollisionSystem` (the bullet seam); `BombSystem.detonateAt` and `BlackHoleSystem` stay unconditional releases (unchanged) and therefore remain full-damage by construction.
- Existing one-hit archetypes stay **byte-identical**: an enemy with no `hp` field (or `hp <= 1`) is released on its first bullet hit exactly as today. `CollisionSystem`'s per-tick invariants are preserved (one bullet consumed per hit; an enemy is damaged at most once per tick; kills reported once).
- The armored enemy spawns **telegraphed** (carries `telegraphMs`, set on spawn; frozen + non-lethal while it counts down) and is **lethal on contact** once active — both achieved by joining the shared `enemyPools` array and honoring `telegraphMs` in its mover (the uniform telegraph seam already covers `PlayerDeathSystem`).
- Eligibility gate is `elapsedMs >= ARMORED_MIN_ELAPSED_MS || pressure >= ARMORED_PRESSURE_THRESHOLD`, read from a **late-bound** back-reference to the `SpawnDirector` via the director's existing no-arg `canSpawn()` hook (mirrors the Mirror Reflector's cap opt-out). Unbound ⇒ `canSpawn()` returns `false` (never spawns without its gate source).
- **DPS honesty:** each bullet hit that deals damage (armored survivor OR any kill) increments `CollisionSystem.bulletDamageCount` by 1 (integer). `DpsTelemetrySystem` sources this new count. `bulletKillCount` / `bulletKillX/Y/Xp` keep their **kill-only** semantics (score, XP orbs, grid ripples unchanged — a non-killing armor hit drops no orb, scores nothing, emits no kill-ripple).
- Runs on the fixed step only (Σ `dt`); frame-rate-independent by construction. Zero per-tick allocation on the steady-state path (pool prewarm; reused scratch; no new arrays/objects/closures in any `fixedUpdate`).

**Block If:**
- (none — the archetype's behavior (slow homing chaser), the HP model (integer per-hit decrement in the projectile seam only), the AoE = full-damage-for-free asymmetry, the telemetry refinement (per-hit integer credit via a new count), and the spawn gate (time OR pressure via late-bound `canSpawn`) are all resolved here from the epic + the in-repo reserved seams. No unattended decision remains.)

**Never:**
- Do NOT add HP/armor to any existing archetype, and do NOT touch `BombSystem` or `BlackHoleSystem` (they are already unconditional = full damage). Do NOT add a melee/mine damage source — none exists until Epics 10–12; "full damage from melee/AoE" is satisfied today by the bomb + black hole paths.
- Do NOT change `bulletKillCount` semantics or the kill snapshot arrays; do NOT redirect XP-orb / grid-ripple / scoring off kills. The DPS refinement is a **separate** new count.
- Do NOT introduce fractional/float per-kill damage crediting (the ledger's float-drift risk) — credit integer damage **per hit**.
- Do NOT reshape `DpsTelemetrySystem`'s structure (ring / running sum / `count × DPS_DAMAGE_PER_KILL`) — only change which count it reads and update its comment.
- Do NOT change the SpawnDirector's archetype-generic logic, `intervalAt`/`weightAt`/`effectiveInterval`, or the governor; the armored enemy is a 6th spawnable + a `canSpawn` opt-out, nothing more.
- Do NOT introduce wall-clock time; advance on the fixed step only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Projectile hits armored | armored `hp = ARMORED_HP`, one bullet overlaps | `hp` decremented by 1, enemy **survives** (not released, not in `killedEnemies`), bullet consumed, `bulletDamageCount += 1` | No error expected |
| Projectile kills armored | armored at `hp === 1`, one bullet overlaps | released to armored pool, pushed to `killedEnemies` + kill snapshots (score/XP), `bulletDamageCount += 1`, `bulletKillCount += 1` | No error expected |
| One-hit enemy (regression) | seeker with no `hp` field, one bullet overlaps | released on first hit (byte-identical to v1); `bulletDamageCount += 1` (== a kill) | No error expected |
| Smart bomb vs armored | armored with `hp > 1` in a pool, bomb detonates | armored released (full damage — one hit), appended to `killedEnemies` after the kill latch; unscored (bomb path); no `bulletDamageCount` credit | No error expected |
| Black hole vs armored | armored overlaps an absorbing hole | armored released (full damage — one absorption) regardless of `hp` | No error expected |
| Telegraphing armored | fresh armored, `telegraphMs > 0` | frozen (mover skips) + non-lethal to ship (`PlayerDeathSystem` skips it); renders spawn-in cue | No error expected |
| Spawn gate closed | `elapsedMs < MIN` and `pressure < THRESHOLD` | `canSpawn()` false ⇒ weight zeroed ⇒ armored never picked; its share flows to eligible archetypes | No error expected |
| Spawn gate via build power | `elapsedMs < MIN` but `pressure >= THRESHOLD` | `canSpawn()` true ⇒ armored eligible before 15:00 (strong build answered early) | No error expected |
| Director back-ref unbound | `armoredSystem.spawnDirector === null` | `canSpawn()` returns false (never spawns without its gate source) | No error expected |
| Contact with active armored | active (non-telegraphing) armored overlaps ship | lethal on contact through the shared death seam (one life) | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add an Armored feel/config block (radius, speed, hp, score, xp, prewarm, color) beside the other archetypes, the two spawn-gate tunables, and the `SPAWN_DIRECTOR_ARMORED_*_WEIGHT` pair in the Spawn Director section.
- `src/entities/Armored.js` -- **new** pooled-entity factory `createArmored()` returning the uniform shape **plus** `hp`: `{x,y,vx,vy,radius,score,xp,telegraphMs,hp}`. Mirrors `src/entities/Seeker.js`.
- `src/systems/ArmoredSystem.js` -- **new** system: owns `enemyPool` (prewarmed), a slow homing `fixedUpdate` mover honoring `telegraphMs` (mirror `EnemySystem`), `spawn(avoidX, avoidY)` that sets `hp = ARMORED_HP` + `telegraphMs`, a late-bound `spawnDirector` back-ref (default `null`), and `canSpawn()` reading it.
- `src/systems/CollisionSystem.js` -- the **only** projectile-damage change: pass 2 decrements `hp` for hits where `hp > 1` (survive), else releases (kill); add public `bulletDamageCount` (per-tick hit count). Preserves all existing kill/consume invariants.
- `src/systems/DpsTelemetrySystem.js` -- read `collisionSystem.bulletDamageCount` instead of `bulletKillCount`; update the class comment (integer per-hit crediting realizes the reserved 9.3 refinement; no shape change).
- `src/scenes/buildArenaWorld.js` -- construct + register `ArmoredSystem` in the enemy section (after `MirrorReflectorSystem`, before `SpawnDirector`); add `armoredSystem.enemyPool` to `enemyPools` (wires collision + both AoE paths + `deathPools`); add a 6th spawnable entry; late-bind `armoredSystem.spawnDirector = spawnDirector`; return the handle.
- `src/scenes/ArenaScene.js` -- assign `this.armoredSystem = arena.armoredSystem` (~234-242); create `this.armoredGraphics = this.add.graphics()` beside the other enemy graphics (~416); add a `forEachActive` render loop (mirror the seeker loop) using `COLOR_ARMORED`, the telegraph cue, and a remaining-HP visual (`s.hp / ARMORED_HP`).
- `src/systems/collisionSystem.test.js` -- existing one-hit tests must stay green; add armored-HP cases.
- `src/systems/dpsTelemetrySystem.test.js` -- repoint the stub to `bulletDamageCount`; existing exact-equality assertions stay valid (integer); add an armor-hit-credits-damage case.
- `src/systems/armoredSystem.test.js` -- **new**: mover/telegraph/spawn/`canSpawn` gating.
- `src/scenes/buildArenaWorld.test.js` -- add wiring assertions (armored pool in `enemyPools`/`deathPools`, 6th spawnable, back-ref late-bound); canonical system order/count updated by +1.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add: `ARMORED_RADIUS = 20`, `ARMORED_SPEED = 70`, `ARMORED_HP = 5` (bullet hits to kill — tunable), `ARMORED_SCORE = 300`, `ARMORED_XP = 4`, `ARMORED_POOL_PREWARM = 8`, `COLOR_ARMORED = 0x9aa4b2` (steel), `ARMORED_MIN_ELAPSED_MS = 900000` (15:00), `ARMORED_PRESSURE_THRESHOLD = 1.0` (build-power alt gate), and `SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT = 3` / `SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT = 3` (flat — the temporal/pressure `canSpawn` gate holds it back, not the 2-min weight ramp; comment this). Comment each as a tunable placeholder.
- `src/entities/Armored.js` -- new `createArmored()` returning `{x:0,y:0,vx:0,vy:0,radius:ARMORED_RADIUS,score:ARMORED_SCORE,xp:ARMORED_XP,telegraphMs:0,hp:ARMORED_HP}`. Header comment mirrors `Seeker.js`, documenting `hp` as the projectile-only durability (AoE/melee ignore it) reset every spawn.
- `src/systems/ArmoredSystem.js` -- new `ArmoredSystem extends System`. Constructor: `(ship, rng = Math.random)`, own `enemyPool = new Pool(createArmored)` prewarmed `ARMORED_POOL_PREWARM`, `this.spawnDirector = null`. `fixedUpdate(dt)`: for each active instance, honor the telegraph gate (decrement `telegraphMs`, return while > 0, snap to 0 on activation) then home toward the ship at `ARMORED_SPEED` (reuse the Seeker homing math incl. coincident-guard). `spawn(avoidX, avoidY)`: acquire, `pickSafeEdgePlacement(this._rng, ARMORED_RADIUS, avoidX, avoidY, SPAWN_SAFE_RADIUS, SPAWN_PLACEMENT_MAX_ATTEMPTS)`, set `vx=vy=0`, `hp = ARMORED_HP`, `telegraphMs = ENEMY_SPAWN_TELEGRAPH_MS`. `canSpawn()`: `const d = this.spawnDirector; return d != null && (d.elapsedMs >= ARMORED_MIN_ELAPSED_MS || d.pressure >= ARMORED_PRESSURE_THRESHOLD);`.
- `src/systems/CollisionSystem.js` -- in the constructor add `this.bulletDamageCount = 0;` (documented: per-tick count of player-bullet hits that dealt damage — kills PLUS non-killing armor hits; the honest build-power figure `DpsTelemetrySystem` reads). Reset it to 0 at the top of `fixedUpdate` alongside `killedEnemies`. In **pass 2**, for each `hitEnemies` member: increment a local `damageCount`; if `Number.isFinite(s.hp) && s.hp > 1` then `s.hp -= 1` (armored survivor — do NOT release/report); else run the existing kill path unchanged (push `killedEnemies`, snapshot `bulletKillX/Y/Xp`, `owners[j].release(s)`). After the loop set `this.bulletDamageCount = damageCount`. `bulletKillCount = killedEnemies.length` stays as-is. Pass 1 (hit marking / bullet-consume / one-hit-per-enemy-per-tick) is unchanged.
- `src/systems/DpsTelemetrySystem.js` -- change the source line to `const dmg = this.collisionSystem.bulletDamageCount * DPS_DAMAGE_PER_KILL;`. Update the class comment: crediting is now per damaging HIT (== per kill for one-shot enemies; a non-killing armor hit still credits 1), realizing the reserved Story 9.3 refinement without changing this system's shape; integer per-hit crediting keeps the ring integer-valued.
- `src/scenes/buildArenaWorld.js` -- import `ArmoredSystem` + the `SPAWN_DIRECTOR_ARMORED_*_WEIGHT` constants; construct `const armoredSystem = new ArmoredSystem(ship, _rng)` and `world.addSystem(armoredSystem)` in the enemy section after `mirrorReflectorSystem` and before `spawnDirector`; add it as a 6th spawnable `{ system: armoredSystem, baseWeight: SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT, peakWeight: SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT }`; add `armoredSystem.enemyPool` to the `enemyPools` array (this single addition wires collision, bomb, black-hole, and `deathPools`); after the director is constructed, late-bind `armoredSystem.spawnDirector = spawnDirector` (comment: the time/pressure spawn gate source); add `armoredSystem` to the returned handles. Update the header count comment (23 → 24 systems).
- `src/scenes/ArenaScene.js` -- assign `this.armoredSystem = arena.armoredSystem`; create `this.armoredGraphics = this.add.graphics()` beside the other enemy graphics (same add order/depth band); add a `forEachActive` render loop mirroring the seeker loop — `COLOR_ARMORED`, telegraph alpha/scale from `telegraphMs`, filled shape at `s.radius`, plus a remaining-durability cue driven by `s.hp / ARMORED_HP` (e.g. an inner fill or ring that shrinks as `hp` drops). Zero per-frame allocation (reuse any point buffer as the pinwheel loop does if a polygon is used).
- `src/systems/armoredSystem.test.js` -- new: telegraph freeze/activation (frozen while `telegraphMs > 0`, homes after), slow homing toward a moving ship, `spawn()` sets `hp === ARMORED_HP` + telegraph + safe placement, `canSpawn()` gating (false when unbound; false before MIN with low pressure; true at/after MIN; true when `pressure >= THRESHOLD` before MIN), and a zero-alloc guard over many ticks.
- `src/systems/collisionSystem.test.js` -- keep all existing one-hit assertions green; add: an armored enemy (`hp = N`) survives N−1 bullet hits (each `bulletDamageCount === 1`, not in `killedEnemies`, `hp` decremented) and is released on the Nth (in `killedEnemies`, `bulletKillCount === 1`, snapshot recorded); a one-hit enemy still credits `bulletDamageCount === 1` on its killing hit; mixed tick (one-shot kill + armored survivor) reports `bulletDamageCount === 2`, `bulletKillCount === 1`.
- `src/systems/dpsTelemetrySystem.test.js` -- repoint the stub collision system to expose `bulletDamageCount`; existing exact-equality/decay assertions stay valid; add: a tick with a non-killing armor hit (`bulletDamageCount === 1`, `bulletKillCount === 0`) still advances `dps` by exactly `1/windowSec` (build-power stays honest against armor).
- `src/scenes/buildArenaWorld.test.js` -- assert `ctx.enemyPools` and `ctx.deathPools` include `ctx.armoredSystem.enemyPool`; the director's spawnables include the armored system; `ctx.armoredSystem.spawnDirector === ctx.spawnDirector` (back-ref late-bound); update the canonical system order/count (+1).

**Acceptance Criteria:**
- Given a run past `ARMORED_MIN_ELAPSED_MS` (or `pressure >= ARMORED_PRESSURE_THRESHOLD`), when the director picks the armored archetype, then it spawns telegraphed (frozen + non-lethal until `telegraphMs` reaches 0) and, once active, homes toward the ship and is lethal on contact.
- Given an active armored enemy with `hp = ARMORED_HP`, when it is hit by player bullets, then it survives `ARMORED_HP` hits (each hit decrements `hp` and credits `bulletDamageCount`, dropping no orb / no score / no kill-ripple) and is destroyed only on the hit that would take `hp` to 0 — meaningfully harder than a one-hit enemy, never immune.
- Given an armored enemy caught by a smart bomb or absorbed by a black hole, when that AoE resolves, then the armored enemy is destroyed in that single event regardless of remaining `hp` (full damage), exactly as any other enemy.
- Given the player pours projectile fire into armor, when `DpsTelemetrySystem` recomputes, then each damaging hit credits one integer damage-unit through `bulletDamageCount`, so the governor's build-power signal reflects damage dealt (not just kills) and does not sag against armor; the DPS ring stays integer-valued (no float drift).
- Given an existing one-hit archetype (no `hp`), when a bullet hits it, then it is released on the first hit exactly as before this story (all prior `CollisionSystem` tests green), and `BombSystem`/`BlackHoleSystem` behavior is unchanged.

## Spec Change Log

(No bad_spec loopback occurred — empty.)

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 3: (high 0, medium 0, low 3)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` Armored `score`/`xp` were unverified: the `createArmored base values` test is named for hp+score+xp but asserted only `hp`, so a copy-paste swap of the factory's adjacent `score`/`xp` lines would ship a warped late-game economy with a green suite (Scoring/XpOrb credit type-agnostically). Added `expect(a.score).toBe(ARMORED_SCORE)` / `expect(a.xp).toBe(ARMORED_XP)`.
  - `[low]` `[patch]` Pinned the deliberate "an enemy is damaged at most once per tick" invariant for armored (the Set-based one-hit-per-enemy pass-1 contract): a new test fires 3 bullets over one `hp=5` armored in one tick and asserts `hp` drops by exactly 1, `bulletDamageCount === 1`, armored still active, one bullet consumed. Closes the untested surface the adversarial/edge layers flagged — without changing the specified design (no dishonesty: `bulletDamageCount` credits damage *dealt*, which the mechanic caps at 1/tick/armored; unlanded bullets deal nothing).
  - `[low]` `[patch]` `canSpawn()` gating was only tested against a stub director, so a future rename of `SpawnDirector.elapsedMs`/`pressure` would silently disable the archetype (stub stays green). Added a `buildArenaWorld.test.js` assertion running `canSpawn()` against the REAL director: false at a fresh build, true after `spawnDirector._elapsedMs = ARMORED_MIN_ELAPSED_MS`.
  - `[low]` `[patch]` The `SPAWN_DIRECTOR_ARMORED_*_WEIGHT` comment justified the flat weights by "ramp saturated before 15:00", which is false for the build-power arm (can open the gate pre-saturation). Corrected: `base === peak` makes `weightAt` flat at every ramp progress, so the ramp is moot in BOTH the time arm and the early-opening pressure arm.

## Design Notes

The projectile-vs-AoE asymmetry needs **no `kind` enum** — it falls out of where HP is checked. Only the bullet seam decrements `hp`; the AoE paths already release unconditionally:

```js
// CollisionSystem.fixedUpdate, pass 2 (replaces the unconditional release)
let damageCount = 0;
for (let j = 0; j < enemies.length; j++) {
  const s = enemies[j];
  if (!hitEnemies.has(s)) continue;
  damageCount++;                             // every hit = 1 integer damage-unit
  if (Number.isFinite(s.hp) && s.hp > 1) {   // armored: absorb one hit, survive
    s.hp -= 1;
    continue;                                // NOT released, NOT a kill
  }
  killedEnemies.push(s);                     // one-shot / final armor hit = kill (unchanged path)
  bulletKillX.push(s.x); bulletKillY.push(s.y);
  bulletKillXp.push(Number.isFinite(s.xp) ? s.xp : 0);
  owners[j].release(s);
}
this.bulletDamageCount = damageCount;        // DpsTelemetry reads this (hits, not kills)
this.bulletKillCount = killedEnemies.length; // unchanged (score/XP/grid stay kill-only)
```

Why per-hit integer crediting (not fractional per-kill): deferred entry (`deferred-work.md:359`) warned that fractional per-kill armor crediting would drift the DPS running-sum into slightly-negative floats and break the exact-equality decay tests. Crediting **1 per hit** keeps every ring slot an integer, so the estimator stays exact — and it is the honest measure of build power (damage output), which is what the 9.2 governor consumes. This also resolves the armored half of `deferred-work.md:372`: the build-power-gated armored spawn (`canSpawn` on `pressure`) *is* the "harder mix under a strong build" answer.

Gating uses the director's own `canSpawn()` opt-out (already honored at `SpawnDirector.js:259`) with a late-bound back-ref — the Mirror Reflector cap precedent, and the same late-bind shape as `spawnDirector.dpsTelemetry`. Weights are flat (`base === peak`) because the 2-minute weight ramp is fully saturated long before the 15-minute time gate opens, so the ramp is moot; `canSpawn` is the real gate.

## Verification

**Commands:**
- `npx vitest run src/systems/armoredSystem.test.js` -- expected: new mover/telegraph/spawn/canSpawn tests pass.
- `npx vitest run src/systems/collisionSystem.test.js` -- expected: all existing one-hit tests green + new armored-HP/`bulletDamageCount` tests pass.
- `npx vitest run src/systems/dpsTelemetrySystem.test.js` -- expected: repointed stub, existing exact-equality tests still pass + armor-hit-credits-damage test passes.
- `npx vitest run src/scenes/buildArenaWorld.test.js` -- expected: updated canonical order/count + armored wiring assertions pass.
- `npx vitest run` -- expected: full suite green (no regression).
- `npx vite build` -- expected: production build succeeds; the DEV-only readouts tree-shake out.

## Auto Run Result

Status: done

**Summary:** Implemented Story 9.3 — the Armored enemy archetype: the late-run counter that keeps melee/AoE builds relevant against pure-projectile builds. Added a new `Armored` entity + `ArmoredSystem` (a slow homing chaser with per-instance `hp`) that spawns through the existing SpawnDirector + telegraph seam, gated to appear once a run passes ~15:00 **or** build power (director `pressure`) crosses a threshold (`canSpawn()` reading a late-bound director back-ref — the Mirror Reflector opt-out precedent). The projectile-vs-AoE asymmetry falls out of *where* HP is checked — **no `kind` enum**: `CollisionSystem` (the bullet seam) is the only place `hp` is decremented (survive while `hp > 1`, else the unchanged kill path), so projectiles deal *reduced* effective damage (5 hits to kill), while `BombSystem`/`BlackHoleSystem` — which already release enemies unconditionally regardless of `hp` — deal *full* damage untouched. To keep the Story 9.2 governor honest, each damaging bullet **hit** (killing or not) credits one **integer** damage-unit to a new `CollisionSystem.bulletDamageCount`, which `DpsTelemetrySystem` now reads instead of `bulletKillCount`; per-hit integer crediting keeps the DPS ring integer-valued, sidestepping the float-drift the deferred ledger feared. Kill-only signals (`bulletKillCount`, XP orbs, grid ripples, scoring) are unchanged. Adding the armored pool to the shared `enemyPools` array wired collision, both AoE paths, `deathPools`, and screen-feedback in one line.

**Files changed:**
- `src/config/constants.js` — Armored feel/config block (`ARMORED_RADIUS=20`, `ARMORED_SPEED=70`, `ARMORED_HP=5`, `ARMORED_SCORE=300`, `ARMORED_XP=4`, `ARMORED_POOL_PREWARM=8`, `ARMORED_MIN_ELAPSED_MS=900000`, `ARMORED_PRESSURE_THRESHOLD=1.0`, `COLOR_ARMORED=0x9aa4b2`), flat `SPAWN_DIRECTOR_ARMORED_BASE/PEAK_WEIGHT=3` (comment corrected in review).
- `src/entities/Armored.js` — new `createArmored()` (uniform shape + `hp`).
- `src/systems/ArmoredSystem.js` — new system: prewarmed pool, slow homing mover honoring `telegraphMs`, `spawn()` (hp + telegraph + safe placement), late-bound `spawnDirector` back-ref, `canSpawn()` (time-OR-pressure; false when unbound).
- `src/systems/CollisionSystem.js` — new public `bulletDamageCount` (per-tick damaging-hit count); pass 2 credits 1 per hit and decrements `hp` for a finite `hp > 1` (survive), else the unchanged kill/release path.
- `src/systems/DpsTelemetrySystem.js` — reads `bulletDamageCount` (no structural change); comment updated to per-hit crediting.
- `src/scenes/buildArenaWorld.js` — construct/register `ArmoredSystem` (after MirrorReflector, before SpawnDirector), 6th spawnable, armored pool added to `enemyPools`, late-bind `armoredSystem.spawnDirector`, returned handle, header count updated (25 systems).
- `src/scenes/ArenaScene.js` — handle, `armoredGraphics`, zero-alloc render loop (telegraph cue + a durability core scaling with `hp/ARMORED_HP`).
- Tests: new `src/systems/armoredSystem.test.js`; armored-HP + `bulletDamageCount` + one-hit-per-tick cases in `collisionSystem.test.js`; repointed stub + armor-hit-credits-build in `dpsTelemetrySystem.test.js`; direct AoE-over-armored (full damage + no dps credit) in `bombSystem.test.js`/`blackHoleSystem.test.js`; armored wiring + real-director `canSpawn` in `buildArenaWorld.test.js`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 3 deferred entries (below).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `9-3-armored-enemy-archetype`: backlog → done.

**Review findings breakdown:** 4 layers (Blind Hunter, Edge-Case Hunter, Verification-Gap, Intent-Alignment). intent_gap 0, bad_spec 0, patch 4 (all low), defer 3, reject 5.
- **Patched (4, all low):** (1) armored `score`/`xp` were unverified (the base-values test named for them checked only `hp`) — pinned `a.score`/`a.xp` so a factory line-swap can't ship a warped economy green; (2) pinned the specified "damaged at most once per tick" invariant for armored (3 bullets over one `hp=5` armored in a tick → `hp` drops 1, `bulletDamageCount` 1, one bullet consumed) — no design change, since `bulletDamageCount` credits damage *dealt* which the mechanic caps at 1/tick/armored (unlanded bullets deal nothing, so no dishonesty); (3) `canSpawn()` was only stub-tested — added a real-director assertion so a future `elapsedMs`/`pressure` rename can't silently disable the archetype; (4) corrected the flat-weight comment (moot because `base===peak` makes `weightAt` flat, not "ramp saturated before 15:00" which is false for the pressure arm).
- **Deferred (3):** (1) no per-type armored active cap — slow+durable armored could crowd the global 60 cap (balance for 9.4/playtest; not unbounded since armored are killable, unlike the reflector); (2) AoE kills of armored award no score/XP (pre-existing economy parity for bomb/black-hole) — revisit when Epic 11 melee/mine lands; (3) forward bet — Epic 11 melee/mine damage sources must route through a full-damage/unconditional-release path, not the `CollisionSystem` hp seam, or they'd silently inherit *reduced* damage (violating FR33).
- **Rejected (5):** duck-typed `hp>1` discrimination (unreachable — per-archetype pools never carry stale `hp`; matches the seam's type-agnostic convention); `ARMORED_HP=1` assert (over-defensive tunable); pressure-arm eligibility flicker (the slew limiter already prevents rapid toggling; gradual on/off is the intended adaptive behavior); `DPS_DAMAGE_PER_KILL` rename (deliberate spec decision to avoid the ripple; single-use constant); armored damageable while telegraphing (pre-existing consistent behavior — all archetypes are; intent only requires non-lethal-to-player during telegraph).

Note: this story's per-hit **integer** crediting and its build-power-gated armored spawn also **resolve by design** two prior deferred concerns — `spec-9-1`'s fractional-per-kill float-drift risk (avoided: crediting is integer-per-hit) and `spec-9-2`'s "dps→mix" question (the build-power `canSpawn` gate *is* the harder-mix-under-a-strong-build answer). Those legacy entries are left in the ledger for the sweep to reconcile.

**Follow-up review recommendation:** false. Patched this pass: 0 high, 0 medium, 4 low → score `3×0 + 1×4 = 4` (< 5), no high severity.

**Verification performed:**
- `npx vitest run src/systems/armoredSystem.test.js` — 20 passed.
- `npx vitest run src/systems/collisionSystem.test.js` — 36 passed (all prior one-hit tests green).
- `npx vitest run src/systems/dpsTelemetrySystem.test.js` — 9 passed.
- `npx vitest run src/systems/bombSystem.test.js` — 22 passed; `npx vitest run src/systems/blackHoleSystem.test.js` — 44 passed (direct AoE-over-armored full-damage coverage).
- `npx vitest run src/scenes/buildArenaWorld.test.js` — 23 passed.
- `npx vitest run` — **1204 passed (66 files)**, full suite green.
- `npx vite build` — production build succeeds; the DEV-only readouts + `hp` durability cue ship without breaking the bundle.

**Residual risks:** Low. The damage asymmetry is structural (HP read only at the bullet seam; AoE paths unconditional), so "full damage from melee/AoE" is guaranteed by construction for the existing bomb/black-hole sources and directly tested. The main open items are forward-looking and deferred: armored saturation balance (9.4/playtest) and the Epic-11 architectural requirement that future melee/mine sources use a full-damage path. The 15:00 time gate and pressure gate are unit-tested (`canSpawn` against both a stub and the real director) rather than via a long headless run, consistent with the existing time-gated test strategy.
