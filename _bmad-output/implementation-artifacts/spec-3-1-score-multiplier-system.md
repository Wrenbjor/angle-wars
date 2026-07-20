---
title: 'Score Multiplier System'
type: 'feature'
created: '2026-07-19'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '419c9cf84f7900197f6fa877fc5b3ef357e2892f'
final_revision: 'b8a130a91f1b988d3cbaa3a60ea4d56d14c39d86'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Score is currently credited flat (enemy base value, never multiplied) and there is no streak reward for killing without dying — the RE1 "multiplier is the game" tension (FR7/FR8) is missing. Killing safely must matter and dying must hurt.

**Approach:** Introduce a run-economy multiplier that climbs on kills to a hard cap of 10×, multiplies every per-kill score award at the existing ScoringSystem seam, is shown on the HUD, and is reset to 1× the instant the player dies (at the existing PlayerDeathSystem death seam).

## Boundaries & Constraints

**Always:**
- Score awarded per kill = that enemy's base value × the current multiplier, applied at the single ScoringSystem per-kill seam (type-agnostic across all archetypes).
- The multiplier starts at 1×, increases only by killing without dying, and never exceeds a hard cap of 10×.
- The multiplier resets to 1× (and its kill-progress to 0) immediately on any player death — both a respawning death and the final game-over death.
- The multiplier is visible on the HUD and updates on the next render frame after it changes.
- All multiplier tuning values (cap, kills-per-step) are centralized tunable constants — no inline magic numbers.
- Motion/cadence stay frame-rate-independent: the multiplier advances on kill events (already fixed-step-driven), not on wall-clock time.
- Zero steady-state allocation on the scoring hot path (match the existing ScoringSystem discipline).

**Block If:**
- (none — the intent, ACs, and epic context fully determine the mechanic.)

**Never:**
- Do not multiply the Black Hole detonation event payout (`BLACKHOLE_SCORE`). It is a hazard-detonation event credit through a separate direct path, not an enemy-kill award through the ScoringSystem seam; it stays flat in this story.
- Do not add smart bombs, extra lives, or high-score persistence (Stories 3.2–3.4).
- Do not change the death/respawn/game-over lifecycle itself, enemy behavior, or the collision seam.
- Do not make the multiplier decay over time or on missed shots (RE1 loses it only on death).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No kills this tick | `killedEnemies = []`, multiplier m | score unchanged, multiplier m unchanged, progress unchanged | No error expected |
| One kill at 1× | one enemy (base b), multiplier 1 | `score += b × 1`; kill-progress advances by one | No error expected |
| One kill at m× | one enemy (base b), multiplier m | `score += b × m` | No error expected |
| Multiple kills one tick | N enemies, multiplier m (below cap) | each enemy scored at the multiplier in effect when it is processed (earlier kills may raise it for later ones this tick) | No error expected |
| Multiplier steps up | kills-per-step killed without dying | multiplier increases by one step; the triggering kill is scored at the pre-step multiplier | No error expected |
| Multiplier at cap | multiplier already 10× | further kills score at 10×; multiplier never exceeds 10× | No error expected |
| Respawning death | contact death, lives remain | multiplier → 1×, kill-progress → 0 (same tick as the life loss) | No error expected |
| Game-over death | contact death on last life | multiplier → 1×, kill-progress → 0 | No error expected |
| Death seam without score state | PlayerDeathSystem built without a scoreState | death flow runs unchanged; no multiplier reset attempted (guarded) | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- Scoring/run-economy section; add multiplier tunables next to `SEEKER_SCORE`. Stale "multiplier is Epic 3" comments here become current.
- `src/state/ScoreState.js` -- run-economy state factory; add `multiplier` + `multiplierKills`; export a `resetMultiplier` helper.
- `src/systems/ScoringSystem.js` -- the per-kill seam; multiply each award and advance the multiplier.
- `src/systems/PlayerDeathSystem.js` -- the death seam; reset the multiplier on each death. Constructor gains an optional `scoreState`.
- `src/scenes/ArenaScene.js` -- wire `scoreState` into `PlayerDeathSystem`; add the multiplier to the HUD text.
- `src/systems/scoringSystem.test.js` -- extend for multiplier scoring + progression + cap.
- `src/systems/playerDeathSystem.test.js` -- add multiplier-reset-on-death coverage.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- Add `SCORE_MULTIPLIER_START = 1`, `SCORE_MULTIPLIER_MAX = 10`, `SCORE_MULTIPLIER_KILLS_PER_STEP` (tunable placeholder, e.g. 5) to the run-economy section with a doc comment; refresh the now-stale "multiplier is Epic 3" note near `SEEKER_SCORE`. -- Centralize all multiplier tuning.
- `src/state/ScoreState.js` -- Extend the shape to `{ score, multiplier, multiplierKills }` (multiplier starts at `SCORE_MULTIPLIER_START`, progress at 0) and export `resetMultiplier(scoreState)` that sets multiplier back to `SCORE_MULTIPLIER_START` and progress to 0. -- Single source of truth for the multiplier's initial/reset value.
- `src/systems/ScoringSystem.js` -- For each enemy killed this tick: credit `base × scoreState.multiplier` at the current multiplier, then (only while below `SCORE_MULTIPLIER_MAX`) increment `multiplierKills`; on reaching `SCORE_MULTIPLIER_KILLS_PER_STEP`, reset progress to 0 and increment `multiplier` by one step (never past the cap). No per-tick allocation. -- Applies FR7 and drives FR8's climb through the one type-agnostic seam.
- `src/systems/PlayerDeathSystem.js` -- Add an optional 4th constructor param `scoreState = null`; in the death branch (both respawn and game-over), if `scoreState` is set, call `resetMultiplier(scoreState)`. -- Applies FR8's reset-on-death at the existing single death seam, non-breaking for callers that don't pass score state.
- `src/scenes/ArenaScene.js` -- Pass `this.scoreState` as the 4th arg to `new PlayerDeathSystem(...)`; add a multiplier line to the HUD `setText` (e.g. `MULT ${multiplier}×`). -- Wires the reset and makes the multiplier observable (FR8).
- `src/systems/scoringSystem.test.js` -- Extend to cover the I/O matrix rows: award = base × multiplier, progression after kills-per-step, cap at 10×, triggering kill scored at pre-step value, multiple archetypes multiplied by their own base × shared multiplier. -- Locks FR7/FR8 climb behavior.
- `src/systems/playerDeathSystem.test.js` -- Add cases: respawning death resets multiplier+progress to 1×/0; game-over death resets to 1×; a system built without a scoreState still runs the death flow unchanged. -- Locks FR8 reset behavior at the death seam.

**Acceptance Criteria:**
- Given a run in progress with multiplier m below the cap, when an enemy of base value b is killed, then the score increases by exactly `b × m` and the kill counts toward the next multiplier step.
- Given kills accumulate without a death, when the kills-per-step threshold is crossed, then the multiplier increases by one step and never exceeds 10×.
- Given any multiplier value, when the player dies (whether respawning or game-over), then the multiplier and its kill-progress reset to 1×/0 on that same tick.
- Given the game is running, when the multiplier changes, then the HUD shows the current multiplier on the next render frame.
- Given the existing death, collision, and scoring tests, when the suite runs, then all pre-existing behavior still passes (no regression to lives/respawn/game-over or flat black-hole payout).

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The cross-system same-tick ordering property ("keep the points, lose the streak") and the death-reset-through-a-shared-ScoreState were only unit-tested in isolation — added a Phaser-free integration test wiring the real ScoringSystem + PlayerDeathSystem over one shared ScoreState in the documented fixed-step order (Scoring → PlayerDeath), asserting a same-tick kill scores at the pre-death multiplier and the death then resets it to start, and that a climbed multiplier resets on death while the accrued score is retained.

## Design Notes

Ordering already guarantees correctness: the fixed-step system order is Collision → Scoring → BlackHole → PlayerDeath. So within one tick, kills are scored (and the multiplier climbs) first, then a death that same tick resets the multiplier — faithful to "you kept the points you earned, but lost the streak."

Multiplier is an integer 1..10 (RE1 fidelity; the RE2 uncapped multiplier is explicitly out of scope per the PRD). The kills-per-step counter carries no wasted kills within a step but is frozen once the cap is reached.

Scoring seam sketch (per killed enemy, in order):

```js
scoreState.score += killed[i].score * scoreState.multiplier;
if (scoreState.multiplier < SCORE_MULTIPLIER_MAX) {
  if (++scoreState.multiplierKills >= SCORE_MULTIPLIER_KILLS_PER_STEP) {
    scoreState.multiplierKills = 0;
    scoreState.multiplier += 1;
  }
}
```

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the extended scoring and death multiplier cases.
- `npm run build` -- expected: production build completes with no errors.

**Manual checks:**
- Run `npm run dev`, play: the HUD multiplier climbs to a cap of 10× as you kill without dying, score awards scale with it, and the instant you take a hit the multiplier snaps back to 1×.

## Auto Run Result

Status: done

### Summary
Implemented the RE1 score multiplier (FR7/FR8): a run multiplier that starts at 1×, climbs on kills to a hard cap of 10× (one step per `SCORE_MULTIPLIER_KILLS_PER_STEP` kills), multiplies every per-kill award at the single type-agnostic `ScoringSystem` seam, is shown on the HUD, and is wiped back to 1× (progress to 0) the instant the player dies — reset at the existing `PlayerDeathSystem` death seam over a shared `ScoreState`. The Black Hole detonation payout stays flat by design (an event payout, not a per-kill award).

### Files changed
- `src/config/constants.js` — added `SCORE_MULTIPLIER_START/MAX/KILLS_PER_STEP`; refreshed the now-current "multiplier is Epic 3" comments.
- `src/state/ScoreState.js` — extended state to `{ score, multiplier, multiplierKills }`; added `resetMultiplier` helper.
- `src/systems/ScoringSystem.js` — award `base × multiplier` per kill and advance the streak (capped, zero per-tick allocation).
- `src/systems/PlayerDeathSystem.js` — optional 4th `scoreState` param; reset the multiplier on every death (respawn and game-over), guarded.
- `src/scenes/ArenaScene.js` — wire `scoreState` into `PlayerDeathSystem`; add the `MULT n×` HUD line.
- `src/systems/scoringSystem.test.js` — multiplier scoring, progression, pre-step award, cap, climb-to-cap.
- `src/systems/playerDeathSystem.test.js` — reset on respawn/game-over death, no-reset without a death, null-scoreState back-compat.
- `src/systems/scoreMultiplierIntegration.test.js` (new) — composed Scoring→PlayerDeath over one shared `ScoreState`: "keep the points, lose the streak".

### Review findings breakdown
- Patches applied: 1 (medium) — added the composed-ordering integration test closing the load-bearing "keep points, lose streak" coverage gap (converged on by 3 review layers).
- Deferred: 1 (low) — the shared scoring seam's unguarded `.score` (`NaN`-poisoning risk) for a hypothetical future archetype lacking a numeric score; pre-existing latent, logged to `deferred-work.md`.
- Rejected: 9 (all low) — consistent-with-intent, by-design (post-launch tuning constants), speculative mis-config, cosmetic-doc, and out-of-scope feature suggestions (e.g. surfacing peak multiplier on the game-over screen).

### Follow-up review recommendation
false. This pass patched 1 medium, 0 high, 0 low → score = 3×1 + 1×0 = 3 (< 5, no high).

### Verification
- `npm test` — 18 files, 307 tests pass (scoring 15, death 23, new integration 3; all pre-existing suites green).
- `npm run build` — production build completes (the >500 kB chunk warning is the pre-existing Phaser bundle, unrelated).

### Residual risks
- The HUD line and the `ArenaScene` constructor wiring remain unverified by automated tests (Phaser scene; consistent with the repo-wide untested-scene pattern). The composed integration test locks the load-bearing cross-system ordering; the scene wire itself is one obvious line, correct today.
- Multiplier tuning values (`KILLS_PER_STEP = 5`) are placeholders to be tuned post-launch per the epic's intent.
