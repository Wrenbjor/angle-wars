---
title: 'Story 8.2 — XP, Level Curve & Leveling'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: '5d70e7cdf3b0e1264d11ec428d01536099b53414'
final_revision: 'fbe2dfcb49f2ca9191fa1dea078a88fe616b481f'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 8.1 gave the run a cumulative XP total (`scoreState.xp`) but nothing consumes it — there is no level, no curve, no sense of progress. Epic 8's level-up loop needs the leveling spine before 8.3 can fire the card moment.

**Approach:** Add a Phaser-free `LevelSystem` that each fixed tick *derives* the player's level and in-level progress purely from the monotonic `scoreState.xp`, walking the fixed per-level curve `XP_to_next(n) = 8 + 6n + 0.55n²` (n = current level, run starts at level 1), carrying the remainder, and stopping at level 30 (further XP inert). Surface level + progress-to-next in the existing corner HUD. Strictly additive: `scoreState` and the v1 loop are untouched.

## Boundaries & Constraints

**Always:**
- Level is a pure deterministic function of `scoreState.xp`: same total ⇒ same level + in-level remainder, recomputed each tick (no accumulated per-tick delta state to drift). Zero per-frame allocation in the hot path.
- Level 1 is the run start. `XP_to_next(n)` uses n = the current level (the level being leveled *from*); remainder carries into the next level.
- Cap at `LEVEL_MAX = 30`; at the cap leveling stops and additional XP is inert (level never exceeds 30, no threshold consumed past it).
- Level-up must survive a non-final death and reset only on a fresh run — which falls out for free, since it is derived from `scoreState.xp` (already run-scoped, never reset on death, rebuilt to 0 on a fresh run).
- HUD shows current level and progress toward the next level in the corner readout, without occluding center play space.

**Block If:** (none — the curve, cap, and n-indexing are fully specified by the intent.)

**Never:**
- Do not mutate `scoreState.xp` or any other `scoreState` field, and do not change `createScoreState()` — 8.1's XP contract and its tests stay intact.
- Do not implement the level-up *moment* (time dilation, invulnerability, card UI) — that is Story 8.3. Expose only a minimal level-up-count seam for it.
- Do not touch v1 movement/firing/bombs/multiplier/death, and do not introduce any RNG (leveling is deterministic; the seedable stream is 8.4's concern).
- No graphical progress-bar widget this story — a textual `into/next` readout satisfies "progress shown" at the lowest layout/occlusion risk.

## I/O & Edge-Case Matrix

`need(L)` ≡ `xpToNextLevel(L)` = `8 + 6L + 0.55L²`; `need(1) = 14.55`, `need(2) = 22.2`.

| Scenario | Input / State (`scoreState.xp`) | Expected `LevelSystem` state | Notes |
|----------|--------------|---------------------------|----------------|
| Fresh run | `0` | `level 1`, `xpIntoLevel 0`, `xpToNext 14.55`, `atCap false` | levelsGainedThisTick 0 |
| Sub-threshold | `10` | `level 1`, `xpIntoLevel 10`, `xpToNext 14.55` | no level-up |
| One level, remainder carries | `20` | `level 2`, `xpIntoLevel 20−14.55 = 5.45`, `xpToNext 22.2` | levelsGainedThisTick 1 (first cross) |
| Exactly at threshold | `14.55` | `level 2`, `xpIntoLevel 0` | `≥` comparison levels up |
| Multi-level in one tick | `40` | `level 3` (40 ≥ 14.55+22.2 = 36.75), `xpIntoLevel 3.25` | levelsGainedThisTick = jump count on the crossing tick |
| At cap | `1e9` | `level 30`, `atCap true`, no threshold consumed past 30 | further XP inert |
| Persist across non-final death | xp unchanged by death | level/progress unchanged | derivation from unchanged xp |

</intent-contract>

## Code Map

- `src/config/constants.js` -- append `LEVEL_MAX` and the three curve coefficients (`XP_CURVE_BASE/LINEAR/QUAD`), each with a one-line rationale, after the XP block (~line 588).
- `src/systems/LevelSystem.js` -- **new** Phaser-free system extending `System`; exports the class + the pure helper `xpToNextLevel(level)`. Mirrors `XpOrbSystem`'s discipline (own public fields only, zero per-tick allocation).
- `src/scenes/buildArenaWorld.js` -- import `LevelSystem`; construct + `world.addSystem` immediately after `xpOrbSystem` (line 286); add `levelSystem` to the return object; bump the "21 systems" prose to 22.
- `src/scenes/ArenaScene.js` -- `this.levelSystem = arena.levelSystem`; append an `LV` line to the `hudText.setText(...)` template (after the existing `XP` line).
- `src/systems/levelSystem.test.js` -- **new** unit tests for every I/O-matrix row + the curve helper.
- `src/scenes/buildArenaWorld.test.js` -- insert `'LevelSystem'` into `CANONICAL_ORDER` (right after `'XpOrbSystem'`) + `'levelSystem'` into `RETURN_HANDLES`; bump the "21" prose to 22; add a wiring assertion.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- append `LEVEL_MAX = 30` (hard level cap — a full build; XP past it is inert), `XP_CURVE_BASE = 8`, `XP_CURVE_LINEAR = 6`, `XP_CURVE_QUAD = 0.55` (coefficients of `XP_to_next(n) = BASE + LINEAR·n + QUAD·n²`), matching file comment style.
- `src/systems/LevelSystem.js` -- new. Export `xpToNextLevel(level)` = `XP_CURVE_BASE + XP_CURVE_LINEAR*level + XP_CURVE_QUAD*level*level`. Class `LevelSystem extends System`, constructor `(scoreState)` storing the ref and initializing public fields (`level=1`, `xpIntoLevel=0`, `xpToNext=xpToNextLevel(1)`, `atCap=false`, `levelsGainedThisTick=0`, private `_prevLevel=1`). `fixedUpdate()`: recompute from `scoreState.xp` — `let level=1, into=scoreState.xp; while (level < LEVEL_MAX && into >= xpToNextLevel(level)) { into -= xpToNextLevel(level); level++; }`; then set `this.level=level`; if `level < LEVEL_MAX` set `atCap=false`, `xpIntoLevel=into`, `xpToNext=xpToNextLevel(level)`; else set `atCap=true`, `xpIntoLevel=0`, `xpToNext=0`; set `this.levelsGainedThisTick = level - this._prevLevel` and `this._prevLevel = level`. Loop uses locals only (≤29 iterations, no allocation). Doc-comment it as the leveling spine + the `levelsGainedThisTick` forward seam for 8.3.
- `src/scenes/buildArenaWorld.js` -- import `LevelSystem`; after `world.addSystem(xpOrbSystem)` construct `const levelSystem = new LevelSystem(scoreState)` (a comment noting it runs after XpOrbSystem so it reads this tick's final `xp`, and before PlayerDeathSystem so 8.3's invulnerability can gate later); `world.addSystem(levelSystem)`; add `levelSystem` to the return object; update the "21 systems" prose → 22.
- `src/scenes/ArenaScene.js` -- assign `this.levelSystem = arena.levelSystem`; in the `hudText.setText(...)` template append `` + `\nLV ${this.levelSystem.level}${this.levelSystem.atCap ? ' MAX' : ` ${Math.floor(this.levelSystem.xpIntoLevel)}/${Math.floor(this.levelSystem.xpToNext)}`}` `` (zero per-frame allocation beyond the existing template string).
- `src/systems/levelSystem.test.js` -- new; cover the curve helper values (`need(1)=14.55`, `need(2)=22.2`, `need(29)`), and every I/O-matrix row against a hand-built system with a plain `{xp}` stub: fresh, sub-threshold, one-level+carry, exact-threshold, multi-level-in-one-tick (+ `levelsGainedThisTick`), cap (level clamps at 30, further xp inert), and idempotent re-derivation (same xp twice ⇒ `levelsGainedThisTick` 0 on the second tick).
- `src/scenes/buildArenaWorld.test.js` -- insert `'LevelSystem'` right after `'XpOrbSystem'` in `CANONICAL_ORDER`; add `'levelSystem'` to `RETURN_HANDLES`; bump the "21"→"22" prose in the suite comments; add a test asserting `ctx.levelSystem` is defined and holds the shared `scoreState` (`ctx.levelSystem.scoreState === ctx.scoreState`) and starts at `level === 1`.

**Acceptance Criteria:**
- Given a run whose `scoreState.xp` reaches the threshold `XP_to_next(n) = 8 + 6n + 0.55n²` for the current level n, when the tick resolves, then `LevelSystem.level` increments and the remainder carries into the next level (`xpIntoLevel = xp − Σ consumed thresholds`), with a single big XP gain crossing multiple thresholds in one tick.
- Given accumulated XP that would exceed level 30's requirements, when the tick resolves, then `LevelSystem.level` is clamped at `LEVEL_MAX` (30), `atCap` is true, and no further threshold is consumed (additional XP is inert).
- Given a run in progress, when the HUD renders, then the corner readout shows the current level and progress toward the next level (`into/next`, or `MAX` at the cap) without occluding center play space.
- Given a non-final death that leaves `scoreState.xp` intact, when subsequent ticks run, then the level and progress are unchanged; given a fresh run rebuilds `scoreState` (xp 0), then level resets to 1.
- Given `npm test` and `npm run build`, when they run, then all existing suites still pass, the new `levelSystem` + extended `buildArenaWorld` wiring tests pass, and the production build resolves the new module/constants.

## Design Notes

**Derive, don't accumulate.** `scoreState.xp` is a monotonic run total (8.1 contract). Because per-level thresholds are fixed and the total only grows, level and in-level remainder are a *pure function* of the total — recompute by walking thresholds from 0 each tick (≤29 iterations, zero allocation). This needs no "xp consumed so far" state, so it can never drift out of sync, and death-persistence / fresh-run-reset come for free from `scoreState.xp`'s existing lifecycle. That is why `scoreState` is **not** modified (no `level` field) and `LevelSystem` owns its derived fields.

**n = current level, run starts at level 1.** The AC binds the threshold to "the current level"; genre convention (this is a survivors-like) starts the player at level 1. So `need(1)=14.55` is the level 1→2 gate.

**Text, not a bar.** The story voice says "level bar," but the binding AC only requires progress be "shown … without occluding." The entire HUD is corner text today; a graphical bar would add positioned Phaser graphics, mobile-layout integration, and occlusion risk with no unit-test surface. A `LV n into/next` line satisfies the AC additively (keeps 8.1's `XP total` line) at the lowest risk; a real bar is a later polish call.

**Ordering + the 8.3 seam.** Registered right after `XpOrbSystem` so it reads this tick's post-collect `xp`, and before `PlayerDeathSystem` so 8.3 can gate level-up invulnerability there without a reorder. `levelsGainedThisTick` (level delta this tick, ≥0) is exposed as the join point 8.3's card moment will edge-detect; 8.2 does not act on it.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including `levelSystem.test.js` and the extended `buildArenaWorld.test.js` (22 systems).
- `npm run build` -- expected: production Vite build succeeds (no unresolved imports from the new module/constants).

**Manual checks:**
- `npm run dev`, play a run: killing enemies raises `XP`, and once it crosses `~14.55` the HUD `LV` ticks to 2 with the progress fraction resetting and carrying the remainder; the level never exceeds 30.

## Spec Change Log

<!-- Append-only. Empty — no bad_spec loopback occurred. -->

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` HUD `LV` progress denominator floored (`ArenaScene.js`) — because the numerator is also floored, near a threshold the readout showed a false-full `14/14` for the fractional window before the level-up fired. Denominator changed to `Math.ceil(xpToNext)` so it never reads full early.
  - `[low]` `[patch]` `LevelSystem.fixedUpdate` recomputed `xpToNextLevel(level)` twice per loop iteration (condition + subtraction). Hoisted into a `need` local computed once per iteration and reused in both; behavior identical (no xp-caching added — the fresh-re-derive-each-tick design is preserved).
  - `[low]` `[patch]` `levelSystem.test.js` cap boundary was covered only at 1e9/1e12, so a `level < LEVEL_MAX` off-by-one in the reporting branch would pass. Added exact-cumulative-threshold cases from `capSum = Σ need(1..29)`: `capSum − 1` ⇒ level 29 non-cap; `capSum` ⇒ level 30 at cap. (Tests 1074 → 1076.)
- Rejected (noise / unreachable / out-of-scope-per-intent / per-convention): no HUD-render test for the `LV` line (codebase-wide Phaser HUD is inline + manually verified across all 21 systems; 8.1 adjudicated the identical finding as reject 3×; the data fields are fully unit-tested and the Verification manual check covers the render); finite/non-negative guard on `scoreState.xp` (reviewers' own reachability "low" — `xp` inits to 0 and `XpOrbSystem` only `+=` positive finite constants, upstream already finite-guarded → NaN/negative unreachable; over-defensive, 8.1 rejected this class repeatedly); negative `levelsGainedThisTick` and `_prevLevel=1` fresh-build assumption (both require `xp` to decrease or a resume/mid-run construction — neither exists; `xp` monotonic, fresh system per run); `levelsGainedThisTick` consume-every-tick contract (an 8.3 consumption concern — intent defers the level-up moment to 8.3 and states 8.2 only exposes the seam); `xpToNext=0` cap sentinel "divide landmine" (documented in the public-state block; sole consumer branches on `atCap`); ordering "only prose+count" (false premise — `CANONICAL_ORDER` asserts the exact ordered array, verified independently by the verification-gap layer; a neighbor-swap fails it); float "14.55"/"no drift" doc nit (the "no drift" claim is about not keeping accumulated delta state — true; `14.55` is fine shorthand); inert-XP-climbs-next-to-MAX feedback (out-of-scope UX polish — level 30 is rare and the `XP` line is 8.1's); loop early-return-on-unchanged-xp (reintroduces the drift-prone cached state the design deliberately avoids).

## Auto Run Result

Status: done
Blocking condition: none

**Summary of implemented change:** Story 8.2 adds `LevelSystem` — the leveling spine of Epic 8. Each fixed tick it *derives* the player's current level and in-level progress purely from the monotonic cumulative run XP total (`scoreState.xp`, established by 8.1), walking the fixed curve `XP_to_next(n) = 8 + 6n + 0.55n²` (n = current level, run starts at level 1), carrying the remainder, and stopping at `LEVEL_MAX = 30` (further XP inert). It also surfaces a HUD `LV {level} {into}/{next}` line (`MAX` at cap) and exposes `levelsGainedThisTick` as an unused forward seam for 8.3. Strictly additive: `scoreState` and `createScoreState()` are untouched (8.1's XP contract intact), no v1 loop behavior changes, and no RNG is introduced. Because level is a pure function of `scoreState.xp`, death-persistence and fresh-run-reset come for free.

**Files changed:**
- `src/systems/LevelSystem.js` — **new** Phaser-free `LevelSystem extends System` + exported pure helper `xpToNextLevel(level)`; zero per-tick allocation, ≤29-iteration derivation loop.
- `src/config/constants.js` — appended `LEVEL_MAX = 30`, `XP_CURVE_BASE = 8`, `XP_CURVE_LINEAR = 6`, `XP_CURVE_QUAD = 0.55`.
- `src/scenes/buildArenaWorld.js` — construct + register `LevelSystem` immediately after `XpOrbSystem` (reads post-collect `xp`; runs before `PlayerDeathSystem`); added to the return object; "21 systems" prose → 22.
- `src/scenes/ArenaScene.js` — assign `this.levelSystem`; append the `LV` HUD line (denominator `Math.ceil`).
- `src/systems/levelSystem.test.js` — **new** 12 tests: curve helper + every I/O-matrix row + the two cap-boundary cases added this pass.
- `src/scenes/buildArenaWorld.test.js` — `LevelSystem` inserted into `CANONICAL_ORDER` after `XpOrbSystem`, `levelSystem` into `RETURN_HANDLES`, "21"→"22" prose, a wiring assertion (shared `scoreState`, starts at level 1).

**Review findings breakdown (this pass, 4 layers — adversarial, edge-case, verification-gap, intent-alignment):** intent_gap 0, bad_spec 0, patch 3 (all low), defer 0, reject 10 (all low). All 3 patches applied and re-verified. See the `Review Triage Log` entry for the itemized reject rationale. The intent-alignment auditor confirmed the diff implements the strongest reading of all three ACs with no mechanics-level intent divergence.

**Follow-up review recommendation:** `false`. Patched findings by severity: high 0, medium 0, low 3. Score `3×0 + 1×3 = 3` (< 5) and no high patch → `followup_review_recommended: false`.

**Verification performed:** `npm test` → 60 files, 1076 tests pass (incl. `levelSystem.test.js` and the 22-system `buildArenaWorld.test.js`); `npm run build` → production Vite build succeeds. Re-run after the 3 patches (independently, not only via the subagent). The `npm run dev` manual HUD playtest is interactive and was not run — the HUD render follows the codebase-wide Phaser-untestable convention (its data fields are fully unit-tested).

**Residual risks:** None new. Latent items are all deliberate, intent-authorized choices: the `levelsGainedThisTick` / `xpToNext=0`-at-cap seams are for 8.3 (documented), the fresh-re-derive-each-tick design intentionally holds no cached xp state, and the HUD render is manually verified per convention.

**Residual artifacts (left in place, not part of the reviewed diff):** `_bmad-output/implementation-artifacts/spec-8-2-xp-level-curve-and-leveling.md` (this workflow's own status/triage bookkeeping) and `_bmad-output/implementation-artifacts/sprint-status.yaml` — both owned by the orchestrator, not committed by this run.
