---
title: 'Story 9.1 — Player DPS Telemetry'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: 'd3aa8dfcff74ede1e7b59854bd42774e2f05ef0d'
final_revision: '652b5f2b5994292bac8c0c1ef47258b1622eedbc'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The v1 spawn director scales only on elapsed time, so a strong build trivializes the late game. Epic 9 needs a live signal of *build power* — how much damage the player is actually dealing — but no such measurement exists.

**Approach:** Add a `DpsTelemetrySystem` that maintains a rolling ~10-second estimate of player weapon damage, fed each fixed tick by the collision seam's bullet-kill report. This story delivers ONLY the telemetry (the producer); Story 9.2 is the first consumer.

## Boundaries & Constraints

**Always:**
- The estimate updates inside the fixed-timestep loop (`fixedUpdate`), so it is framerate-independent by construction — its value after T simulated seconds depends only on tick count, never on render FPS.
- Zero per-frame allocation: the window buffer is allocated once at construction; `fixedUpdate` allocates no arrays/objects/closures.
- The window is a rolling ~10s average: a single kill contributes only its averaged share (never a per-tick spike), and a sustained change in output tracks in/out gradually over the window.
- The system is a pure observer: it writes only its own fields and reads `collisionSystem.bulletKillCount` (the already-latched, bomb/black-hole-excluded player bullet-kill count). It must not mutate any pool, score, xp, or player state.
- It is registered after `CollisionSystem` (so `bulletKillCount` is final this tick) and returned from `buildArenaWorld`; run-scoped (fresh per run, like the other systems).

**Block If:**
- (none — the damage model, source, and window are resolved below; no unattended decision remains.)

**Never:**
- Do NOT implement spawn-director scaling, damping, or any consumer of the estimate (Story 9.2).
- Do NOT add enemy HP / armor or multi-hit damage (Story 9.3) — the v1 one-shot model stands: one bullet-kill = one damage unit.
- Do NOT count bomb clears or black-hole absorptions — those are consumables/hazards, not sustained weapon output.
- Do NOT introduce wall-clock time (`Date.now`, `performance.now`) — advance on the fixed step only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No kills this tick | `bulletKillCount === 0` | 0 added to window; `dps` reflects only decay | No error expected |
| Single isolated kill | one tick with `bulletKillCount === 1`, then silence | `dps` rises to `1 / 10` (0.1) and holds flat for the window, then drops to 0 after ~10s — never spikes above 0.1 | No error expected |
| Sustained output | `K` damage-units/sec for ≥10s | `dps` converges to ~`K`, ramping ~linearly over the window; after output stops, decays to 0 over ~10s | No error expected |
| Output change mid-run | rate goes R1 → R2 | `dps` tracks from R1 toward R2 gradually across the window (no instantaneous jump) | No error expected |
| Framerate independence | same tick sequence driven headless vs any render cadence | identical `dps` for identical tick count | No error expected |

</intent-contract>

## Code Map

- `src/systems/CollisionSystem.js` -- source: exposes `bulletKillCount` (player bullet kills this tick, bomb/black-hole removals excluded), latched at end of its `fixedUpdate`. READ-ONLY here.
- `src/systems/ScoringSystem.js` -- sibling kill-consumer + placement anchor (register the new system immediately after it).
- `src/systems/SimClockSystem.js` -- pattern reference: a minimal system holding its own read-only telemetry fields.
- `src/scenes/buildArenaWorld.js` -- wiring: construct + register the new system after `ScoringSystem`, add to the return object.
- `src/scenes/buildArenaWorld.test.js` -- pins the canonical system order (`CANONICAL_ORDER`), return handles (`RETURN_HANDLES`), and the "23 systems" count — all must move to 24.
- `src/scenes/ArenaScene.js` -- assign the handle (~line 245) and add a DEV-only readout line (~line 1654).
- `src/config/constants.js` -- add `DPS_WINDOW_MS` and `DPS_DAMAGE_PER_KILL`; `FIXED_STEP_MS` already present.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `export const DPS_WINDOW_MS = 10000;` and `export const DPS_DAMAGE_PER_KILL = 1;` with comments (window length; the v1 one-shot "one kill = one damage unit", flagged as the Story 9.3 refinement seam).
- `src/systems/DpsTelemetrySystem.js` (NEW) -- a `System` subclass constructed with the `collisionSystem`. In the constructor derive `N = max(1, round(DPS_WINDOW_MS / FIXED_STEP_MS))`, allocate `this._ring = new Float64Array(N)` once, init `this._i = 0`, `this._sum = 0`, `this.dps = 0`, `this.windowMs = DPS_WINDOW_MS`. Each `fixedUpdate`: compute `dmg = collisionSystem.bulletKillCount * DPS_DAMAGE_PER_KILL`; evict-and-replace the current ring slot (`_sum -= ring[_i]; ring[_i] = dmg; _sum += dmg`); advance `_i = (_i + 1) % N`; set `this.dps = this._sum / (DPS_WINDOW_MS / 1000)`. No allocation in `fixedUpdate`.
- `src/scenes/buildArenaWorld.js` -- import + construct `new DpsTelemetrySystem(collisionSystem)`, `world.addSystem(...)` immediately after `scoringSystem`, and add `dpsTelemetrySystem` to the returned object.
- `src/scenes/ArenaScene.js` -- `this.dpsTelemetrySystem = arena.dpsTelemetrySystem;` beside the other handles, and add a DEV-gated readout line ``` `dps        : ${this.dpsTelemetrySystem.dps.toFixed(1)}` ``` to the existing `debugText.setText([...])` array.
- `src/systems/dpsTelemetrySystem.test.js` (NEW) -- unit-test every I/O Matrix row over a stub `{ bulletKillCount }` source: zero-tick decay, single-kill non-spike + expiry after N ticks, sustained-rate convergence, mid-run tracking, and framerate independence (same `dps` for the same tick count). Assert the ring is a single pre-allocated `Float64Array` and `dps` starts at 0.
- `src/scenes/buildArenaWorld.test.js` -- update `CANONICAL_ORDER` (insert `'DpsTelemetrySystem'` after `'ScoringSystem'`), `RETURN_HANDLES` (add `'dpsTelemetrySystem'`), the "23 systems" count/comment → 24, and add a wiring test asserting `ctx.dpsTelemetrySystem.collisionSystem === ctx.collisionSystem` and `ctx.dpsTelemetrySystem.dps === 0` on a fresh build.

**Acceptance Criteria:**
- Given the world is built, when the systems are enumerated, then `DpsTelemetrySystem` appears exactly once, immediately after `ScoringSystem`, and is returned as `dpsTelemetrySystem`.
- Given a fresh run, when no damage has been dealt, then `dps === 0`.
- Given `K` damage-units per second sustained for the full window, when the window is full, then `dps` equals `K` (within floating tolerance), and it reached `K` by ramping across the window rather than jumping.
- Given the identical bullet-kill tick sequence, when driven headlessly at any cadence, then the resulting `dps` is identical (depends only on tick count).

## Spec Change Log

(No bad_spec loopback occurred — empty.)

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 2: (high 0, medium 2, low 0)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `dps` divided by the nominal `DPS_WINDOW_MS` while the ring spans the rounded `N × FIXED_STEP_MS` slots; the constructor's `N ≥ 1` clamp (meant to prevent divide-by-zero) was not honored by the divisor, so a retuned tiny/zero/negative window would yield Infinity/NaN/negative `dps`. Fixed to divide by the actual ring span (`this._ring.length * FIXED_STEP_MS / 1000`) in `DpsTelemetrySystem.js` — byte-identical at default constants (600 × (1000/60) = 10000 ms exactly), divide-safe and exact under any retuning. Updated the test's `WINDOW_SEC` derivation to track the real ring span. Full suite green (1162 passed).

## Design Notes

Tick-indexed ring (fixed timestep ⇒ one slot per fixed step ⇒ exact real-time window):

```js
// constructor — allocate ONCE
const N = Math.max(1, Math.round(DPS_WINDOW_MS / FIXED_STEP_MS)); // 600 @ 60Hz
this._ring = new Float64Array(N);
this._i = 0; this._sum = 0; this.dps = 0;

// fixedUpdate — O(1), zero alloc
const dmg = this.collisionSystem.bulletKillCount * DPS_DAMAGE_PER_KILL;
this._sum -= this._ring[this._i];   // evict slot from ~10s ago
this._ring[this._i] = dmg; this._sum += dmg;
this._i = (this._i + 1) % N;
this.dps = this._sum / (DPS_WINDOW_MS / 1000);
```

Why a rolling sum, not an EMA: the story specifies a "rolling 10-second window", and the window itself is the smoother — a single kill can only ever add `1/10` to `dps`, so it can never spike; layering an EMA on top would double-smooth and blur the 10s contract. `bulletKillCount` is chosen (not `killedEnemies`) because it is the count of *player bullet* kills only, already excluding bomb/black-hole removals — sustained weapon output is exactly the build-power signal 9.2 wants. One kill = one damage unit is the honest v1 measure (all enemies one-shot); Story 9.3's armored HP will refine crediting through the same `dps` surface without changing this system's shape.

## Verification

**Commands:**
- `npx vitest run src/systems/dpsTelemetrySystem.test.js` -- expected: all new unit tests pass.
- `npx vitest run src/scenes/buildArenaWorld.test.js` -- expected: 24-system order + new wiring test pass.
- `npx vitest run` -- expected: full suite green (no regression from the +1 system).
- `npx vite build` -- expected: production build succeeds and the DEV readout line tree-shakes out (gated by `import.meta.env.DEV`).

## Auto Run Result

Status: done

**Summary:** Implemented Story 9.1 — Player DPS Telemetry: a new pure-observer `DpsTelemetrySystem` maintaining a rolling ~10-second estimate of player weapon output (damage-units/sec) over a tick-indexed `Float64Array` ring, folded each fixed step from `collisionSystem.bulletKillCount`. Producer-only — nothing consumes `dps` yet (Story 9.2). Zero per-frame allocation, framerate-independent by construction (fixed-timestep, `dt` ignored), and spike-free on single hits because the 10s window is itself the smoother.

**Files changed:**
- `src/systems/DpsTelemetrySystem.js` (NEW) — the rolling-window estimator; O(1)/zero-alloc `fixedUpdate`, `dps` normalized by the ring's actual span.
- `src/systems/dpsTelemetrySystem.test.js` (NEW) — 8 tests covering every I/O-matrix row (zero-tick decay, single-kill non-spike + expiry, sustained-rate ramp/convergence, mid-run tracking, framerate independence) + zero-alloc and pure-observer guards.
- `src/config/constants.js` — added `DPS_WINDOW_MS = 10000` and `DPS_DAMAGE_PER_KILL = 1` (the latter flagged as the Story 9.3 refinement seam).
- `src/scenes/buildArenaWorld.js` — construct + register the system after `ScoringSystem`; add to the return object.
- `src/scenes/buildArenaWorld.test.js` — canonical order 23→24 (`DpsTelemetrySystem` after `ScoringSystem`), new return handle, new wiring test.
- `src/scenes/ArenaScene.js` — assign the handle + a DEV-gated `dps` readout line (tree-shaken from production).
- `_bmad-output/implementation-artifacts/epic-9-context.md` (NEW) — compiled epic-9 planning context.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 2 deferred entries (below).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `9-1-player-dps-telemetry`: backlog → done.

**Review findings breakdown:** 4 layers (Blind Hunter, Edge-Case Hunter, Verification-Gap, Intent-Alignment). intent_gap 0, bad_spec 0, patch 1 (medium), defer 2, reject 6.
- **Patched (1, medium):** `dps` divisor used the nominal `DPS_WINDOW_MS` while the ring spans the rounded `N × FIXED_STEP_MS`; the constructor's `N ≥ 1` clamp was not honored by the divisor (a retuned tiny/zero/negative window → Infinity/NaN/negative `dps`). Fixed to divide by the actual ring span — byte-identical at default constants, divide-safe/exact under retuning; coupled test derivation updated.
- **Deferred (2):** (1) running-sum float drift + exact-equality test fragility once Story 9.3 adds fractional per-kill damage (not reachable under the current integer model); (2) `dps` decays during the level-up time-dilation — a Story 9.2 consumer-design consideration.
- **Rejected (6):** single-hit comment is accurate; the framerate test is a valid dt-regression guard (Verification-Gap reviewer confirmed); `windowMs` is a documented read-only field; no `reset()` matches the codebase's fresh-per-run convention; `bulletKillCount` is structurally a finite non-negative int; registration order is guarded by the canonical-order test like every other system.
- Intent-Alignment was descriptive: the "damage → bullet-kill × 1" mapping is an *acknowledged*, epic-context-resolved divergence (armored HP deferred to 9.3 via the `DPS_DAMAGE_PER_KILL` seam), not an intent gap.

**Follow-up review recommendation:** false. Patched this pass: 1 medium, 0 high, 0 low → score `3×1 + 1×0 = 3` (< 5), no high severity.

**Verification performed:**
- `npx vitest run src/systems/dpsTelemetrySystem.test.js` — 8 passed.
- `npx vitest run src/scenes/buildArenaWorld.test.js` — 21 passed.
- `npx vitest run` — 1162 passed (65 files), full suite green (re-run after the patch).
- `npx vite build` — production build succeeds; the `dps` DEV readout line tree-shakes out of the shipped bundle.

**Residual risks:** Low. The system is a pure read-only observer registered after `CollisionSystem`, so it cannot affect gameplay. Window math is derived from constants (not hardcoded), so a future tune won't silently break assertions. The one modeling assumption — one bullet-kill = one damage unit — is the intended v1 measure and the explicit Story 9.3 seam. The two deferred items are logged for Stories 9.2 / 9.3.
