---
title: 'DW-26: Guard the shared per-kill scoring award against a non-finite base score'
type: 'bugfix'
created: '2026-07-20'
status: 'done'
baseline_revision: '642a6412b4242dd5a2bb408a18f5a3abafd86e1a'
final_revision: 'ac993f94595132d3d5234927fb57627940761a27'
review_loop_iteration: 0
followup_review_recommended: false # patched: high 0, medium 0, low 1 → score 1 (< 5)
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `ScoringSystem.fixedUpdate` credits each killed enemy with `killed[i].score * multiplier` (`src/systems/ScoringSystem.js:58`) with no guard on `.score`. Every archetype credits through this one type-agnostic seam, so a future enemy pooled without a numeric `score` field would award `NaN`, permanently poisoning `ScoreState.score` — the HUD and game-over screen then render `NaN` for the rest of the run. The gap is real for the seam's stated contract but not reachable today (all four current factories carry a finite numeric `score`).

**Approach:** Guard the award with `Number.isFinite(killed[i].score)`: credit the score only when the base is a finite number, otherwise skip the credit for that enemy. Leave the multiplier-progress advancement untouched, so behavior for the four current numeric-score archetypes is byte-for-byte unchanged and only the latent NaN path is closed.

## Boundaries & Constraints

**Always:** Preserve the existing per-kill award and multiplier behavior for every enemy whose `score` is a finite number. The guard must reject `NaN`, `Infinity`, `-Infinity`, `undefined`, and non-number values (exactly `Number.isFinite`'s contract). The system stays Phaser-free and allocation-free per tick.

**Block If:** The intent would require deciding whether a scoreless kill should still advance the multiplier streak in a way that changes current behavior — it does not; leave the streak logic as-is.

**Never:** Do not change how the four current archetypes are scored. Do not throw or log in the hot path. Do not alter the multiplier step/cap logic, `ScoreState`, the enemy factories, or `CollisionSystem`. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Finite base score (current archetypes) | `killed = [{score: 25}]`, `multiplier = m` | `score += 25 * m`; streak advances one | No error expected |
| Scoreless enemy killed | `killed = [{}]` (no `score`) or `{score: NaN}` | `score` unchanged (award skipped); no `NaN` introduced | Award silently skipped |
| Mixed tick: scoreless + numeric | `killed = [{}, {score: 10}]`, `m = 1` | `score += 10`; the scoreless entry contributes nothing | Only the finite entry credited |

</intent-contract>

## Code Map

- `src/systems/ScoringSystem.js` -- `fixedUpdate` holds the unguarded award at line 58; the sole change site.
- `src/systems/scoringSystem.test.js` -- existing I/O-matrix unit suite; extend with the scoreless-kill cases.
- `src/entities/Seeker.js`, `GreenSquare.js`, `Pinwheel.js`, `SnakeSegment.js` -- the four current factories, each carrying a finite numeric `score`; read-only reference confirming the guard is a no-op for them.

## Tasks & Acceptance

**Execution:**
- `src/systems/ScoringSystem.js` -- Wrap the `ss.score += killed[i].score * ss.multiplier` award in an `if (Number.isFinite(killed[i].score))` guard so a non-finite base score is skipped; leave the multiplier-progress block after it unchanged. Update the adjacent comment to note the finite-score guard.
- `src/systems/scoringSystem.test.js` -- Add cases proving the guard: (1) a lone scoreless killed enemy leaves `score` at 0 and introduces no `NaN`; (2) a mixed tick of a scoreless entry plus a real archetype credits only the finite base.

**Acceptance Criteria:**
- Given a killed enemy whose `score` is a finite number, when `fixedUpdate` runs, then the credited score equals the pre-guard result for the same input (behavior unchanged).
- Given a killed enemy with no `score` field (or `score` set to `NaN`/`Infinity`), when `fixedUpdate` runs, then `ScoreState.score` is unchanged and `Number.isNaN(scoreState.score)` is false.
- Given a single tick containing both a scoreless entry and a numeric-score archetype, when `fixedUpdate` runs, then `score` increases by exactly the finite entry's base × multiplier.

## Design Notes

Guard the award only — not the streak. The multiplier advancement (`++ss.multiplierKills`) is integer arithmetic unaffected by a bad `score`; whether a scoreless kill counts toward the streak is unspecified by the intent, so the streak block is left exactly as-is to keep the change minimal and current behavior identical. `Number.isFinite` is preferred over `typeof x === 'number'` because it also rejects `NaN`/`Infinity`, closing the whole poison surface in one predicate.

```js
for (let i = 0; i < killed.length; i++) {
  // Award at the multiplier in effect; skip a non-finite base score so a
  // future scoreless archetype cannot poison ScoreState.score with NaN.
  if (Number.isFinite(killed[i].score)) {
    ss.score += killed[i].score * ss.multiplier;
  }
  if (ss.multiplier < SCORE_MULTIPLIER_MAX) { /* unchanged */ }
}
```

## Verification

**Commands:**
- `npx vitest run src/systems/scoringSystem.test.js` -- expected: all existing cases plus the new scoreless-kill cases pass.
- `npx vitest run` -- expected: full suite green (no regression in dependent scoring/HUD tests).

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 12
- addressed_findings:
  - `[low]` `[patch]` All four review layers converged: the finite-score guard wraps only the score credit, so a scoreless kill still advances the multiplier streak, yet the two new tests asserted only `score`, leaving the multiplier dimension of the scoreless path unpinned (regression-gap). The streak behavior itself is the spec's intended, documented decision (Design Notes) — not a defect — so the fix was test-only: pinned `multiplierKills`/`multiplier` in both scoreless-kill tests to lock in the documented behavior. No production code changed.

Rejected (on the intent's own scope authority — the intent targets the `.score` award and prescribes `Number.isFinite`): scoreless kill advancing the multiplier as a *behavior* defect (intended per Design Notes); `null`/`undefined` array-entry TypeError (pre-existing deref, `killedEnemies` never holds null — not confidently reachable); numeric-string score silently dropped (intent prescribed `Number.isFinite`; no archetype uses string scores); `Number.isFinite` rejecting `Infinity` (desirable) and negative scores passing (out of scope, no negative-score archetype); "speculative dead code"/hot-path cost (intent explicitly hardens the seam for future consumers); comment drift + Contract-block not updated + redundant NaN assertions + `{}` fixture realism + missing requirement linkage (cosmetic/noise); multi-tick "rest of a run" persistence not directly tested (covered by existing cross-tick accumulation tests plus the single-tick no-NaN proof).

## Auto Run Result

Status: done

**Summary:** Hardened the shared per-kill scoring seam (`ScoringSystem.fixedUpdate`) against a non-finite base `score`. The award `killed[i].score * multiplier` is now wrapped in an `if (Number.isFinite(killed[i].score))` guard, so a future enemy archetype pooled without a numeric `score` can no longer poison `ScoreState.score` with `NaN` for the rest of a run. The multiplier-streak logic is deliberately left unchanged. Behavior for the four current numeric-score archetypes (Seeker, Green Square, Pinwheel, Snake) is byte-for-byte unchanged; only the latent NaN path is closed.

**Files changed:**
- `src/systems/ScoringSystem.js` — wrapped the score-award line in a `Number.isFinite` guard; updated the adjacent comment. Multiplier block untouched.
- `src/systems/scoringSystem.test.js` — added two scoreless-kill cases (lone `{}`; mixed `{}` + seeker) proving no NaN poison and only-finite crediting, each now also pinning the multiplier-streak dimension.

**Review findings:** 1 patch applied (low — test-only assertions pinning the documented multiplier behavior); 0 deferred; 12 rejected (out of scope on the intent's authority, or cosmetic/noise). Details in the Review Triage Log above.

**Follow-up review recommended:** false. Patched findings this pass: high 0, medium 0, low 1. Score `3×0 + 1×1 = 1` (< 5) and no high-severity patch.

**Verification:**
- `npx vitest run src/systems/scoringSystem.test.js` — 17 passed (was 15; +2 new cases, each carrying the added multiplier assertions).
- `npx vitest run` — full suite green, 758 passed across 49 files, no regressions.
- Independently confirmed the diff: guard is a pure no-op for finite scores; the four current factories all carry a numeric `score`.

**Residual risks:** None of note. The guard adds one `Number.isFinite` branch per kill on the hot path — negligible and consistent with the system's per-tick zero-allocation profile. Per spec, a hypothetical future scoreless kill still advances the multiplier streak (unspecified by intent, deliberately left as current behavior); this is now test-pinned rather than accidental.
