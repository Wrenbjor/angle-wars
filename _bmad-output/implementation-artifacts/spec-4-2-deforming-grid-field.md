---
title: 'Story 4.2 — Deforming Grid Field'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'a60d11b5a54b2aecd30e71e266d9e8a0567c4055'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: 'e1d8906a8b9f4738f2aa1ef3f1aaf800c76eea88'
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The play area has no floor grid — the signature Geometry Wars "living grid" that ripples from explosions and bends into gravity wells is absent (NFR5, FR13). The Black Hole (Story 2.4) shipped with a placeholder circle and no grid-distortion visual.

**Approach:** Add a GPU-rendered neon grid that fills the arena, drawn by ONE full-arena `Phaser.GameObjects.Shader` (a single fragment-shader quad, added behind every entity). All deformation happens in the shader from per-frame uniforms — never per-vertex on the CPU. A new Phaser-free `GridFieldSystem` (registered LAST in the world pipeline) owns a bounded set of decaying **ripple** slots and a single **warp** target: each fixed tick it emits a ripple per bullet-killed enemy, per bomb detonation, and per player death, advances/expires ripples, and tracks the active Black Hole as the warp source (released when the hole is gone). A pure `gridField.js` seam builds and packs those into the shader's uniform arrays each render frame. Two tiny sim-side latches are added so ripple origins are exact: `CollisionSystem.bulletKillCount` (isolate bullet kills from later absorb/bomb appends) and a `PlayerDeathSystem` death latch (capture the death point before respawn moves the ship).

## Boundaries & Constraints

**Always:**
- The grid is **GPU-rendered**: ONE `Phaser.GameObjects.Shader` covering the arena (`0,0` → `ARENA_WIDTH×ARENA_HEIGHT`, origin top-left), added FIRST in `create()` so it renders behind all entities/HUD. All ripple + warp displacement is computed **inside the fragment shader** from uniforms. No per-vertex or per-pixel CPU deformation; the CPU only writes uniforms.
- Zero per-frame allocation on the hot path: ripple slots are a fixed-size pool (`GRID_MAX_RIPPLES`); uniform payloads are pre-allocated `Float32Array`s mutated in place by `packGridUniforms`; `GridFieldSystem` uses reusable scratch (mirrors `CollisionSystem`/`BombSystem`).
- `GridFieldSystem` runs **LAST** in the world pipeline (after `HighScoreSystem`), so within each fixed tick every input is final: `collisionSystem.killedEnemies[0 .. bulletKillCount)` = this tick's bullet kills only; the bomb shockwave latch, the player-death latch, and `holePool` are all current (no one-tick lag).
- Ripple triggers map 1:1 to the three named events: **explosion** = each enemy destroyed by a player bullet this tick (`killedEnemies` up to `bulletKillCount`); **bomb** = one ripple at the detonation origin on the shockwave rising edge; **death** = one ripple at the player's death point. Enemies absorbed by a Black Hole or cleared by a bomb do NOT each emit a ripple (absorb ≠ explosion; the bomb's own single ripple represents the detonation).
- Warp source is the active Black Hole: `GridFieldSystem` reads `holePool` and warps toward it while a NON-telegraphing hole is alive; strength scales with the hole's current radius; the warp releases (strength → 0) the same tick the hole is destroyed or while it is still telegraphing (frozen, no gravity yet). With `BLACKHOLE_MAX_ACTIVE = 1` there is at most one; if more ever exist, pick the largest-radius hole.
- All grid/ripple/warp tunables (`GRID_*`) are centralized in `constants.js` as documented post-launch placeholders and passed to the shader as uniforms (colors converted `0xRRGGBB` → `vec3` in the pure seam). No magic numbers in the GLSL and none inline at the `ArenaScene` call site — mirrors the `NEON_BLOOM_*` discipline.
- Ripple origins and the warp target are in arena/world pixels; the shader maps world→fragment space itself. The grid renders under the existing camera Bloom (Story 4.1) so it glows without any per-object FX.

**Block If:**
- `Phaser.GameObjects.Shader` (`this.add.shader`) or its auto-synced custom-uniform mechanism (`3fv`/`2fv`/`1f` uniforms mutated per frame, verified present in Phaser 3.90) is not actually available, OR rendering a fragment-shader quad requires changing the forced-WEBGL renderer in `main.js`. Either is a platform mismatch — HALT with specifics.

**Never:**
- Do not implement other Epic 4 effects: no pooled particle system (4.3), no camera shake / hit-stop / flash (4.4), no audio (4.5). Only the grid + its ripple/warp.
- Do not change gameplay/simulation behavior. The `CollisionSystem.bulletKillCount` and `PlayerDeathSystem` death-latch additions are **read-only observability** — they must not alter kills, scoring, lives, respawn, invulnerability, or the game-over flow. No new entity geometry, no collision/gravity change to the Black Hole.
- Do not deform the grid on the CPU (no per-vertex mesh walk), add per-object bloom, or reconfigure the shader/uniform set per frame beyond writing values into the pre-allocated arrays.

## I/O & Edge-Case Matrix

Scope: pure calls over fakes (no Phaser). `GridFieldSystem` is Phaser-free; `gridField.js` imports no Phaser. Ripple/warp packing is verified without a GL context.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Explosion ripples | tick with `killedEnemies=[{x:10,y:20},{x:30,y:40}]`, `bulletKillCount=2` | two ripple slots active at (10,20) and (30,40), age 0 | none |
| Absorb/bomb-clear ignored | `killedEnemies` has 2 bullet kills then 3 appended (indices 2..4), `bulletKillCount=2` | only the first 2 become ripples | none |
| Bomb ripple on edge | bomb latch `shockwaveMs` rises 0→N with origin (x,y) | exactly one ripple at (x,y); no second ripple while it decays | none |
| Death ripple on edge | `deathSeq` increments with `deathX,deathY` | one ripple at (deathX,deathY) per increment | none |
| Ripple advance + expire | active ripple with `ageMs`, tick `dt` | `ageMs += dt`; slot goes inactive when `ageMs ≥ GRID_RIPPLE_DURATION_MS` | none |
| Ripple overflow | emit when all `GRID_MAX_RIPPLES` slots active | oldest (max `ageMs`) slot is overwritten; count stays ≤ cap | none |
| Warp present | one alive hole `telegraphMs=0`, radius r | warp active at hole (x,y), strength = clamp(r/`BLACKHOLE_MAX_RADIUS`,0,1) | none |
| Warp telegraphing | only hole has `telegraphMs>0` | warp inactive (strength 0) | none |
| Warp released | `holePool` empty | warp strength 0 | none |
| Warp pick largest | two holes radii 30 and 60 | warp targets the radius-60 hole | none |
| Pack ripples | state with mixed active/inactive slots | `uRipples` Float32Array packs (x, y, ageSeconds) per active slot; inactive slot age = -1 (shader skips) | tolerates all-inactive |
| Pack warp | active/released warp | `uWarp` = (x, y, strength01); released → strength 0 | none |
| Build uniforms | `buildGridUniforms()` | object with keys/types matching the GLSL (`uRipples` 3fv len `3*GRID_MAX_RIPPLES`, `uWarp` 3f, static `GRID_*` uniforms), colors as `vec3` from constants | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ADD a "Deforming grid field (Story 4.2)" section: `GRID_SPACING`, `GRID_LINE_WIDTH`, `GRID_COLOR` (0xRRGGBB), `GRID_MAX_RIPPLES`, `GRID_RIPPLE_DURATION_MS`, `GRID_RIPPLE_SPEED`, `GRID_RIPPLE_AMPLITUDE`, `GRID_RIPPLE_WAVELENGTH`, `GRID_WARP_MAX_DISPLACEMENT`, `GRID_WARP_RADIUS` (= `BLACKHOLE_GRAVITY_RADIUS`). Documented post-launch placeholders.
- `src/systems/GridFieldSystem.js` -- NEW Phaser-free `System`. Owns `ripples` (fixed `GRID_MAX_RIPPLES` slots `{active,x,y,ageMs}`) and `warp` (`{active,x,y,strength}`). Ctor takes `collisionSystem`, `bombSystem`, `playerDeathSystem`, `holePool`. `fixedUpdate(dt)`: advance/expire ripples; emit bullet-kill / bomb-edge / death-edge ripples; recompute warp from `holePool`. Reusable scratch, no per-tick alloc. Tracks `_prevShockwaveMs`, `_prevDeathSeq` for edge detection.
- `src/scenes/gridField.js` -- NEW Phaser-free render seam: `GRID_FRAGMENT_SRC` (GLSL string), `buildGridUniforms()` (returns the Phaser uniforms config with pre-allocated `Float32Array`s + static `GRID_*`/color-`vec3` values), `packGridUniforms(uniforms, gridFieldSystem)` (writes ripple slots + warp into the arrays; active → ageSeconds, inactive → -1). Imports NO Phaser (mirrors `neonStyle.js`).
- `src/systems/CollisionSystem.js` -- ADD `this.bulletKillCount = 0` (ctor) and set it to `killedEnemies.length` at the end of `fixedUpdate` (after pass 2, before later systems append). Read-only observability; no behavior change.
- `src/systems/PlayerDeathSystem.js` -- ADD `this.deathSeq = 0; this.deathX = 0; this.deathY = 0;` (ctor); in the death branch, before respawn, capture `deathX/deathY = ship.x/ship.y` and `deathSeq += 1` (both respawn and game-over deaths). Read-only observability; no behavior change.
- `src/scenes/ArenaScene.js` -- in `create()`: build the grid `this.add.shader(new Phaser.Display.BaseShader('grid', GRID_FRAGMENT_SRC, undefined, buildGridUniforms()), ...)` sized to the arena, added FIRST (behind entities), `setOrigin(0,0)`; construct `GridFieldSystem` (passing the existing systems + `blackHoleSystem.holePool`) and `world.addSystem` it LAST; in `update()` after `advance()`, call `packGridUniforms(this.gridShader.uniforms, this.gridFieldSystem)` once (zero alloc). No other render changes.
- `src/systems/gridFieldSystem.test.js` -- NEW; unit-test the `GridFieldSystem` I/O rows (emission sources, advance/expire, overflow, warp pick/release).
- `src/scenes/gridField.test.js` -- NEW; unit-test `buildGridUniforms` shape/types and `packGridUniforms` (ripple/warp packing, inactive sentinel).
- `src/systems/collisionSystem.test.js` -- UPDATE; assert `bulletKillCount` equals the bullet-kill count and is unaffected by later appends.
- `src/systems/playerDeathSystem.test.js` -- UPDATE; assert the death latch fires once per death at the pre-respawn ship position for both respawn and game-over deaths.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the `GRID_*` section -- centralized tunables, no inline magic numbers.
- `src/systems/CollisionSystem.js` -- expose `bulletKillCount` -- lets the grid isolate bullet-kill explosions from absorb/bomb appends without reordering the tick.
- `src/systems/PlayerDeathSystem.js` -- add the death latch (`deathSeq`, `deathX`, `deathY`) captured pre-respawn -- gives the death ripple its exact origin (the ship teleports to center on respawn).
- `src/systems/GridFieldSystem.js` -- implement ripple pool + warp tracking + fixed-step emission/advance -- the Phaser-free simulation seam for the deforming grid.
- `src/scenes/gridField.js` -- implement `GRID_FRAGMENT_SRC`, `buildGridUniforms`, `packGridUniforms` -- the Phaser-free shader-source + uniform bridge (GLSL draws grid, applies ripple/warp from uniforms).
- `src/scenes/ArenaScene.js` -- create the grid shader behind entities, register `GridFieldSystem` last, pack uniforms per frame -- integrates the GPU grid into the running game with no per-frame CPU deformation.
- `src/systems/gridFieldSystem.test.js`, `src/scenes/gridField.test.js` -- unit-test every I/O-matrix row.
- `src/systems/collisionSystem.test.js`, `src/systems/playerDeathSystem.test.js` -- extend to cover the new latches.

**Acceptance Criteria:**
- Given the game is running, when the arena renders, then a neon grid field fills the play area drawn on the GPU by a single fragment-shader quad behind all entities (NFR5) — confirmed via `npm run dev`; automated seam: `buildGridUniforms` produces the shader's declared uniform set (`gridField.test.js`).
- Given an enemy is destroyed by a bullet, a bomb detonates, or the player dies, when it happens, then the grid ripples outward from that point — confirmed via `npm run dev`; automated seam: `GridFieldSystem` emits exactly one ripple at the correct origin for each trigger (bullet kills only up to `bulletKillCount`, one per bomb edge, one per death edge) per `gridFieldSystem.test.js`.
- Given a Black Hole is present and exerting gravity (Story 2.4), when it is active, then the grid visibly warps toward it and releases when the hole is destroyed (FR13) — confirmed via `npm run dev`; automated seam: `GridFieldSystem.warp` is active at the hole while a non-telegraphing hole lives and strength returns to 0 when `holePool` empties (`gridFieldSystem.test.js`).
- Given a busy arena with the grid, ripples, and a warp all active, when the frame renders, then the effect holds the 60 FPS target (NFR1) — confirmed via the in-game FPS readout; architecturally supported because deformation is a single GPU pass whose cost is independent of enemy/ripple count (bounded uniform arrays, zero per-frame CPU deformation).
- Given the grid ships, when the simulation runs, then gameplay is unchanged — the same kills, scores, lives, deaths, and game-over as before (the new latches are read-only) — confirmed by the existing suites remaining green.

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 10: (high 0, medium 2, low 8)
- addressed_findings:
  - `[medium]` `[patch]` Recycled-object aliasing: `GridFieldSystem` read explosion origins from `collisionSystem.killedEnemies[i]` at end-of-tick, but `CollisionSystem` releases bullet-killed enemies to their pools mid-tick and `BlackHoleSystem._spawnSeekerAtEdge()` (runs before the grid) can `acquire()` a just-freed seeker and overwrite its `x/y` — so a bullet-kill coinciding with a black-hole feed-spawn placed the ripple at the spawn edge, not the kill point. Fixed by latching the bullet-kill coordinates in `CollisionSystem` at kill time (new reusable `bulletKillX`/`bulletKillY` arrays, filled in pass 2 alongside `killedEnemies`); `GridFieldSystem` now emits explosion ripples from those coordinate snapshots, never from the recycled objects. Also removes the theoretical `killed[i]` undefined-deref if the latch and array ever desynced.
  - `[low]` `[patch]` The `gridField.test.js` "declares exactly the uniforms" test was one-directional (asserted each config key appears in the GLSL, but not that every GLSL custom uniform has a config key), so a future shader uniform missing from `buildGridUniforms` (defaulting to 0 at runtime) would ship green. Added the reverse assertion: parse `uniform <type> <name>` declarations out of `GRID_FRAGMENT_SRC`, exclude the Phaser built-in `resolution`, and assert each remaining custom uniform has a matching `buildGridUniforms` key — the contract is now bijective.
- rejected (not defects — no reachable trigger, or intent-sanctioned aesthetics/tunables verified manually; the substantive ones recorded as residual risks):
  - **Bomb rising-edge misses a detonation on two ADJACENT fixed ticks** — unreachable: the bomb request is one-per-press (edge-triggered) and `consumeBomb()` reads-and-clears each frame, so two detonations cannot land on consecutive 16.7ms ticks; a second detonation during a still-active shockwave IS detected because `shockwaveMs` jumps up from its decayed value. Recorded as a residual risk.
  - **No spatial ripple envelope (whole-arena shimmer), mediump precision at arena-scale coords, fixed 16-iteration fragment loop (NFR1 fill cost)** — GLSL shape/precision/perf matters that cannot run under vitest/jsdom; the spec deliberately scopes all visual fidelity + the absolute FPS budget to the manual `npm run dev` pass and Epic 5 Story 5.5 (performance hardening + web build). `GRID_MAX_RIPPLES` is a cheap in-place perf/quality lever. Recorded as residual risks for the manual pass.
  - **A `GRID_*` divisor/spacing tuned to 0 would NaN the whole quad** — no shipped trigger (every constant is non-zero); an invalid 0 is self-evident in the same controller-in-hand tuning session the epic describes.
  - **Warp pops to base strength (no ease-in) on hole activation; grid freezes mid-deform on game-over** — cosmetic and intent-consistent: the freeze matches the established "sim freezes on game-over" behavior (the placeholder bomb shockwave already freezes identically) and shows only under the dimming overlay; warp feel is a Story 4.4 juice/tuning concern.
  - **Unguarded `shader.uniforms` deref; death handling relies on one-death-per-tick** — no reachable trigger: `main.js` forces `Phaser.WEBGL` (the shader's uniforms are deep-copied synchronously at creation) and `PlayerDeathSystem` structurally breaks after one death per tick (bumping `deathSeq` by at most 1). Mid-run WebGL context loss is a pre-existing engine-wide concern, not this story's.
  - **The `shader.uniforms`-is-the-live-copy assumption is unit-untested** — the disclosed Phaser/GL manual boundary; the pure seams carry the automated coverage and `npm run dev` confirms actual deformation (recorded as a residual risk).

## Design Notes

**Why run LAST + two latches.** Reading effect events at end-of-tick makes every input final within the tick (no one-tick lag, no reordering of the carefully-ordered pipeline). But `killedEnemies` is appended-to by `BlackHoleSystem` (absorbs) and `BombSystem` (clears) after `CollisionSystem`; `bulletKillCount` (captured at the end of `CollisionSystem.fixedUpdate`, before those appends) lets the grid slice `killedEnemies[0 .. bulletKillCount)` = pure bullet kills at end-of-tick, since the array is only ever appended, never reordered. The death point is lost after `PlayerDeathSystem` respawns the ship to center, so it is latched at the moment of the lethal overlap (mirrors `BombSystem`'s `shockwaveX/Y/shockwaveMs`). Both latches are read-only; gameplay is untouched.

**Edge detection.** Bomb: emit when `bombSystem.shockwaveMs > _prevShockwaveMs` (it only rises at detonation; otherwise decays) → one ripple per detonation at `shockwaveX/Y`. Death: emit when `playerDeathSystem.deathSeq !== _prevDeathSeq`. Prevs are seeded from current state at construction so no spurious ripple fires on the first tick.

**Ripple slots.** Fixed `GRID_MAX_RIPPLES` array (bounded uniform size = bounded GPU cost). Emit into any inactive slot, else overwrite the oldest (max `ageMs`). Advance ages by the fixed `dt`; a slot with `ageMs ≥ GRID_RIPPLE_DURATION_MS` goes inactive. `packGridUniforms` writes `(x, y, ageSeconds)` per active slot and `ageSeconds = -1` for inactive so the shader skips it with no branch cost.

**Shader.** `GRID_FRAGMENT_SRC` draws grid lines at `GRID_SPACING` in fragment space, displacing the sampled coordinate by the sum of active ripple contributions (a radial wave: ring radius `= age·GRID_RIPPLE_SPEED`, envelope `1 − age/duration`, `GRID_RIPPLE_AMPLITUDE`/`GRID_RIPPLE_WAVELENGTH`) plus a gravity pull toward `uWarp.xy` within `GRID_WARP_RADIUS` scaled by `uWarp.z` and `GRID_WARP_MAX_DISPLACEMENT`. All constants arrive as uniforms; world→fragment mapping (y-flip) is done in-shader. GLSL cannot run under vitest/jsdom (no WebGL), so the shader itself is a manual `npm run dev` check — the pure seams (`GridFieldSystem`, `gridField` packing/config) carry the automated coverage, matching the Story 4.1 / 2.6 precedent.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new `gridFieldSystem.test.js` and `gridField.test.js`; updated `collisionSystem.test.js` / `playerDeathSystem.test.js` pass; all other existing suites unchanged and green (gameplay-neutral change).
- `npm run build` -- expected: production build succeeds (pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: a neon grid fills the arena behind the entities and glows under bloom. Destroying an enemy, detonating a bomb, and dying each send a ripple outward from that point. When a Black Hole is present the grid bows toward it and snaps back (releases) when it is destroyed. The FPS readout holds at/near 60 with a busy arena, grid, ripples, and a warp all active.

## Auto Run Result

Status: done

**Implemented change:** Story 4.2 — Deforming Grid Field. A GPU-rendered neon grid now fills the arena, drawn by ONE full-arena `Phaser.GameObjects.Shader` (a single fragment-shader quad added FIRST in `create()`, behind every entity/HUD). All deformation runs in the fragment shader from per-frame uniforms — the CPU never walks vertices. A new Phaser-free `GridFieldSystem` (registered LAST in the world pipeline) owns a bounded pool of decaying ripple slots and a single warp target: each fixed tick it emits an explosion ripple per bullet-killed enemy, a ripple on each bomb detonation, and a ripple at each player death, advances/expires ripples by the fixed dt, and warps toward the largest alive non-telegraphing Black Hole (strength ∝ radius), releasing when the hole is gone. The pure `gridField.js` seam holds the GLSL source and packs the system's live state into the shader's uniform Float32Arrays each render frame (zero per-frame allocation). Two read-only sim-side latches give the ripples exact origins: `CollisionSystem` now snapshots each bullet-kill's coordinates (`bulletKillCount` + `bulletKillX/Y`, recycle-proof) and `PlayerDeathSystem` latches the death point (`deathSeq`/`deathX`/`deathY`) before respawn. The grid inherits the Story 4.1 camera Bloom, so it glows with no per-object FX.

**Files changed:**
- `src/config/constants.js` — added the documented "Deforming grid field (Story 4.2)" section: the ten `GRID_*` tunables (`SPACING`, `LINE_WIDTH`, `COLOR`, `MAX_RIPPLES`, `RIPPLE_DURATION_MS`, `RIPPLE_SPEED`, `RIPPLE_AMPLITUDE`, `RIPPLE_WAVELENGTH`, `WARP_MAX_DISPLACEMENT`, `WARP_RADIUS`=`BLACKHOLE_GRAVITY_RADIUS`) as post-launch placeholders.
- `src/systems/GridFieldSystem.js` — NEW Phaser-free system: bounded ripple pool + single warp target; end-of-tick edge-detected emission (bullet-kill coords / bomb rising edge / death seq) and largest-alive-non-telegraphing-hole warp with clamped strength; zero per-tick allocation; edge prevs seeded at construction.
- `src/scenes/gridField.js` — NEW Phaser-free seam: `GRID_FRAGMENT_SRC` (GLSL grid + in-shader ripple/warp deformation, world→fragment y-flip, `#define GRID_MAX_RIPPLES`), `buildGridUniforms` (Phaser `{type,value}` config with pre-allocated `Float32Array` + `vec3` colors), `packGridUniforms` (in-place per-frame packing, `-1` inactive sentinel), `colorToVec3`.
- `src/systems/CollisionSystem.js` — added read-only `bulletKillCount` + recycle-proof `bulletKillX`/`bulletKillY` coordinate snapshots (captured in pass 2, before later systems append/recycle); no gameplay change.
- `src/systems/PlayerDeathSystem.js` — added the read-only death latch (`deathSeq`, `deathX`, `deathY`) captured pre-respawn for both respawning and game-over deaths; no gameplay change.
- `src/scenes/ArenaScene.js` — creates the grid `Shader` first (behind all layers, arena-sized, origin 0,0), registers `GridFieldSystem` last, and packs uniforms once per render frame after `advance()`.
- `src/systems/gridFieldSystem.test.js`, `src/scenes/gridField.test.js` — NEW; cover every I/O-matrix row (emission sources incl. the coordinate-snapshot/recycle case, advance/expire, overflow, warp present/telegraphing/released/pick-largest; uniform build/pack, bijective config↔GLSL contract).
- `src/systems/collisionSystem.test.js`, `src/systems/playerDeathSystem.test.js` — extended to cover the new latches (counts, coordinate snapshots, snapshot-survives-recycle, pre-respawn origin, once-per-death, no-latch cases).

**Review findings breakdown:** 2 patches applied (1 medium — the recycled-object aliasing correctness fix; 1 low — bijective uniform-contract test); 0 intent_gap; 0 bad_spec; 0 deferred; 10 rejected (no reachable trigger, or intent-sanctioned aesthetics/perf verified manually — see the Review Triage Log).

**Follow-up review recommendation:** false. Patched this pass: 0 high, 1 medium, 1 low → score `3×1 + 1×1 = 4` (< 5), no high severity.

**Verification performed:** `npm test` — 28 files, 425 tests all pass (including the new `gridFieldSystem.test.js` and `gridField.test.js`; extended `collisionSystem.test.js` / `playerDeathSystem.test.js`; all other suites unchanged and green, confirming gameplay is unchanged). `npm run build` — production build succeeds (pre-existing Phaser chunk-size advisory only). Matrix Test Audit: every I/O row is covered by a test that ran and passed. The Phaser 3.90 `Shader`/`BaseShader` API and its auto-synced custom-uniform mechanism (`3fv`/`3f`/`1f`) were confirmed against the Phaser source; `main.js` already forces `Phaser.WEBGL`, so no Block-If triggered.

**Residual risks (unverifiable in this environment; all on the manual `npm run dev` checklist):**
- The GLSL fragment shader cannot execute under vitest/jsdom, so the actual rendered grid, ripple propagation, gravity warp, glow under bloom, and the busy-arena 60 FPS target are confirmed only by the in-browser manual pass — the automated tests cover the sim + uniform seams, not rendered pixels or frame timing (a disclosed limitation matching the Story 4.1 / 2.6 precedent). The `shader.uniforms`-is-the-live-copy assumption gates whether the grid deforms at all, so the manual pass must confirm actual deformation, not merely that a grid renders.
- Ripple visual shape is a first pass: the shader applies the radial wave with a time envelope but no spatial (distance-from-wavefront) attenuation, so a single explosion currently reads more as a whole-arena concentric shimmer than a tightly localized ring — a GLSL/tuning refinement best judged with a controller in hand.
- `precision mediump float` is fine on the desktop mid-range target but could wobble grid lines at arena-scale coordinates on true-fp16 (mobile/integrated) GPUs; and the fragment shader loops `GRID_MAX_RIPPLES` (16) times per pixel every frame regardless of activity. Both are bounded by design; the absolute frame-budget audit and mobile/web hardening belong to Epic 5 Story 5.5, and lowering `GRID_MAX_RIPPLES` is a cheap in-place lever if the manual pass shows FPS pressure.
- Bomb ripple edge-detection uses the shockwave rising edge; two detonations on two ADJACENT 16.7ms fixed ticks would drop the second ripple, but that is unreachable via the one-per-press (edge-triggered, read-and-cleared) bomb input.
