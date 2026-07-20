---
title: 'Persistent High Score'
type: 'feature'
created: '2026-07-19'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: 'aea04d89b418f61f9f609881f9855baf43aaf9c7'
baseline_revision: 'bfc3fd12a24bb76e5455f046df0cf72b7d738d38'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** FR11 ("persistent local high score") does not exist. Nothing survives a page reload — a great run leaves no mark, so the player has no personal best to chase. This is the last piece of the Epic 3 RE1 economy.

**Approach:** Add a browser-only `localStorage` persistence port (guarded so a blocked/absent store degrades to a no-op) plus a Phaser-free `HighScoreSystem` that reads the stored high at construction, live-tracks the run's best score for the HUD, and — on the tick game-over latches — writes the new high back through the port **once**, but only when the run actually beat the stored value. The HUD gains a `HIGH` line; the system runs **after** `PlayerDeathSystem` so it observes `gameOver` the same tick it is set (the whole-world gate only stops the *next* tick).

## Boundaries & Constraints

**Always:**
- The high score persists via `localStorage` under a single centralized key constant. On a finished run, if the final score **exceeds** the stored high score, the new value is written; the displayed high score reflects the persisted value across page reloads (FR11).
- All `localStorage` access is funneled through one guarded port (`src/persistence/highScoreStorage.js`). Every read/write is wrapped so a missing/blocked/throwing store (private mode, quota, node/SSR) degrades to a no-op: `load()` → `0`, `save()` → silently ignored. A corrupt, non-numeric, zero, or negative stored value reads as `0`.
- `HighScoreSystem` is Phaser-free and takes an **injected** `{load, save}` port (a real localStorage-backed adapter in `ArenaScene`; a fake in tests), so it stays headlessly testable in the node test env (no jsdom).
- The write happens **exactly once per run**, on the game-over edge, and only when `finalScore > storedHighScore`. `score` is monotonic (only ever increases), so the run's live-tracked best equals the final score.
- `HighScoreSystem` runs **after** `PlayerDeathSystem` in the fixed-step order so it sees `gameOver` on the same tick it latches. It reads `ScoreState.score` and `PlayerState.gameOver` (never writes either) and touches no other run state.
- The displayed high score (`this.highScore`) starts at the persisted baseline and climbs to track the running best each tick, so on a fresh run (score 0) it equals the persisted value.
- Zero steady-state allocation on the per-tick path (integer compares + one guarded write on the single game-over tick).

**Block If:**
- (none — FR11, the ACs, and the epic context fully determine the mechanic. The storage key string and the read-guard policy are ordinary delegated implementation choices, not intent gaps.)

**Never:**
- Do not persist anything other than the high score (settings and other values are out of scope this epic).
- Do not write on every tick or every death — only on the game-over edge, and only when the stored value was beaten (no redundant re-write of an equal/lower value).
- Do not throw on any storage failure — persistence is strictly best-effort; a blocked store must not break the run or the render loop.
- Do not mutate `ScoreState.score`, the multiplier, bombs, lives, or the death/game-over lifecycle. `HighScoreSystem` is read-only against the run economy.
- Do not build the polished title / game-over high-score presentation — that is finalized in Epic 5. This story's display surface is the existing HUD `HIGH` line only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh run, nothing stored | `load()` returns 0 (empty key) | `highScore` starts 0; HUD shows `HIGH 0` | No error expected |
| Run beats stored high, then game-over | stored `H`; final `score = S > H` | on the game-over tick `save(S)` called once; `highScore == S` | No error expected |
| Run ends below stored high | stored `H`; final `score = S ≤ H` | `save` NOT called; `highScore == H` (persisted value still shown) | No error expected |
| Final score exactly equals stored | stored `H`; `score == H` | not a "beat" (`>` only) → no write; `highScore == H` | No error expected |
| Live climb during a run | `score` rises past `highScore` mid-run | `highScore` tracks the running best each tick (before game-over) | No error expected |
| Persist idempotency | game-over, then more `fixedUpdate` calls | `save` invoked at most once for the run | No error expected |
| Load after reload | previously saved `S` under the key | `load()` returns `S`; HUD shows `HIGH S` on a fresh run | No error expected |
| Corrupt / negative / non-numeric stored value | key holds `"abc"`, `""`, `"-5"`, `"0"` | `load()` returns 0 | Guarded parse → 0 |
| localStorage absent or throwing | `storage` null, or getItem/setItem throw | `load()` → 0; `save()` → no-op, no throw | try/catch → no-op |

</intent-contract>

## Code Map

- `src/config/constants.js` -- run-economy section; add `HIGH_SCORE_STORAGE_KEY` (the single localStorage key) with a doc comment. No other new constant (HUD reuses the existing `HIGH` line).
- `src/persistence/highScoreStorage.js` (new) -- `createHighScoreStorage(storage = globalThis.localStorage)` factory returning a guarded `{load, save}` port. All access try/catch-wrapped; `load` parses/validates to a non-negative integer (0 on any failure).
- `src/systems/HighScoreSystem.js` (new) -- Phaser-free `System` subclass. Constructor `(scoreState, playerState, storage)`: seed `highScore` + baseline from `storage.load()`. `fixedUpdate`: live-track the best; on the game-over edge persist once when beaten.
- `src/scenes/ArenaScene.js` -- construct `createHighScoreStorage()` + `new HighScoreSystem(...)`, `addSystem` it AFTER `playerDeathSystem` (last), and add `HIGH ${this.highScoreSystem.highScore}` to the HUD `setText` template.
- `src/persistence/highScoreStorage.test.js` (new) -- unit-cover the port's parse/guard/failure rows against a fake Storage.
- `src/systems/highScoreSystem.test.js` (new) -- unit-cover the system's I/O matrix against a fake port.
- `src/systems/highScoreIntegration.test.js` (new) -- compose the real Scoring→…→PlayerDeath→HighScore chain over one shared state to lock the after-PlayerDeath tick placement (beat persists on the same latching tick; a losing run persists nothing).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- Add `export const HIGH_SCORE_STORAGE_KEY = 'angleWars.highScore';` in the run-economy section with a doc comment (the only persisted value this epic; centralized so the key lives in one place). -- Centralize the storage key.
- `src/persistence/highScoreStorage.js` (new) -- `createHighScoreStorage(storage = globalThis.localStorage)` → `{ load, save }`. `load()`: guarded `getItem`, `Number.parseInt(raw, 10)`, return it only when finite and `> 0`, else `0`; try/catch → `0`. `save(score)`: guarded `setItem(KEY, String(score))`; try/catch → ignore. Default param allows injecting a fake in tests. -- The single browser seam, degrading to a no-op when storage is unavailable.
- `src/systems/HighScoreSystem.js` (new) -- `System` subclass. Constructor `(scoreState, playerState, storage)`: `this._storedHighScore = storage.load()`; `this.highScore = this._storedHighScore`; `this._persisted = false`. `fixedUpdate(_dt)`: `if (score > this.highScore) this.highScore = score;` then on `playerState.gameOver && !this._persisted`: set `_persisted = true` and, only if `this.highScore > this._storedHighScore`, `storage.save(this.highScore)` and update `_storedHighScore`. Phaser-free; zero per-tick allocation. -- The whole mechanic at one seam; write-once, only-when-beaten.
- `src/scenes/ArenaScene.js` -- Import `createHighScoreStorage` and `HighScoreSystem`; construct `this.highScoreStorage = createHighScoreStorage()` and `this.highScoreSystem = new HighScoreSystem(this.scoreState, this.playerState, this.highScoreStorage)`; `world.addSystem` it AFTER `this.playerDeathSystem` (so it observes game-over the same tick) with a comment explaining the placement. Add `\nHIGH ${this.highScoreSystem.highScore}` to the `hudText.setText` template. -- Wire the system last and surface the high score on the HUD.
- `src/persistence/highScoreStorage.test.js` (new) -- Cover: valid parse; missing key → 0; corrupt/empty/negative/zero → 0; `save` writes `String(score)` under the key; null storage → load 0 / save no-throw; throwing getItem/setItem → load 0 / save no-throw. -- Locks the guarded-port contract headlessly.
- `src/systems/highScoreSystem.test.js` (new) -- Cover the I/O matrix with a fake port: constructor loads baseline; fresh-run starts 0 and climbs; beat → save once with new high; loss → no save, display stays at persisted; exact-equal → no save; idempotent persist across extra ticks. -- Locks FR11 write/display logic.
- `src/systems/highScoreIntegration.test.js` (new) -- Compose real `CollisionSystem→ScoringSystem→…→PlayerDeathSystem→HighScoreSystem` over one shared `ScoreState`+`PlayerState` in ArenaScene order with a fake port: (a) a kill that pushes the score above the stored high on the same tick a last-life lethal contact ends the run → HighScoreSystem persists the beaten score that same latching tick; (b) a last-life death with the score never beating the stored high persists nothing. -- Pins the after-PlayerDeath placement the write rests on.

**Acceptance Criteria:**
- Given a finished run whose final score exceeds the stored high score, when the run reaches game-over, then the new high score is written to `localStorage` exactly once through the guarded port (FR11).
- Given a finished run whose final score does not exceed the stored high score, when the run reaches game-over, then nothing is written and the stored high score is unchanged.
- Given the game loads (a fresh run), when the HUD is shown, then the `HIGH` value reflects the value persisted in `localStorage`, so a previously saved high score survives a page reload (FR11).
- Given `localStorage` is unavailable or throws on access, when the game loads or a run ends, then reads yield `0` and writes are silently ignored — the run and render loop are unaffected (no throw).
- Given the existing scoring, death, black-hole, bomb, multiplier, and extra-life suites, when the suite runs, then all pre-existing behavior still passes (no regression; `HighScoreSystem` never mutates the score, lives, or lifecycle).

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `createHighScoreStorage`'s default parameter `storage = globalThis.localStorage` was evaluated at call time OUTSIDE the try/catch guards, so a browser that throws `SecurityError` on merely reading the `localStorage` property (sandboxed iframe / storage disabled) would crash `createHighScoreStorage()` → `ArenaScene.create()` — the exact blocked-store case the module's "never throws / degrades to a no-op" contract was written to survive. Fixed: resolve the global inside a guarded `defaultLocalStorage()` helper (try/catch → `null`) and default the param to it; per-method guards unchanged; injected fake/`null` still overrides. Added a unit test stubbing a throwing `globalThis.localStorage` getter and asserting the factory does not throw and the port degrades to a no-op.
  - `[low]` `[patch]` `HighScoreSystem` gated the game-over write against `_storedHighScore` captured once at construction; because `localStorage` is shared across tabs, a second tab holding a stale baseline could persist a LOWER score over a HIGHER one another tab wrote. Fixed: re-read `this.storage.load()` at the write moment and save only when the run's high strictly exceeds that freshly-read value (single-tab behavior unchanged). Added a concurrent-tab unit test asserting a stale run does not clobber a higher stored value.

## Design Notes

**Why a guarded port + injected dependency.** The whole codebase keeps behavior in Phaser-free, node-testable systems and isolates browser/Phaser concerns in `ArenaScene`. `localStorage` is a browser global absent from the `node` test env (see `vite.config.js` — `environment: 'node'`, no jsdom). So the IO lives in one tiny guarded module (`createHighScoreStorage`) that `ArenaScene` instantiates, and `HighScoreSystem` takes the resulting `{load, save}` port as an injected dependency — a fake in unit/integration tests. This mirrors how every other system takes its collaborators by constructor injection.

**Tick placement — after `PlayerDeathSystem`.** `PlayerDeathSystem` sets `playerState.gameOver` during its own `fixedUpdate`. `ArenaScene.update` gates the world with `if (!gameOver) world.fixedUpdate(dt)`, which stops every system on the *next* tick — but within the *latching* tick every system after `PlayerDeathSystem` still runs. So registering `HighScoreSystem` last lets it observe `gameOver` on the very tick it becomes true and persist then; on all later ticks the world is gated off, so no second persist is possible. The `_persisted` latch makes the write idempotent regardless (integration tests call `fixedUpdate` directly, ungated). This is the same gate reasoning the `ExtraLifeSystem` design notes rely on.

**Write-once, only-when-beaten.** `score` is monotonic (ScoringSystem and the black-hole payout only add; the death reset touches the multiplier, never the score), so the live-tracked `highScore` equals the final score at game-over. Comparing it against the baseline read at construction (`_storedHighScore`) yields exactly "final exceeds stored" for the write gate — no redundant write of an equal/lower value, satisfying AC1/AC2 precisely.

**Display surface.** The HUD `HIGH` line is the only display this story adds; the polished title/game-over high-score presentation is explicitly Epic 5 per the epic context. On a fresh run `highScore == storage.load()`, so the HUD shows the persisted value on load (the cross-reload AC); it then climbs live as the run's score passes it.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `highScoreStorage`, `highScoreSystem`, and `highScoreIntegration` tests; no regression in the scoring/death/bomb/black-hole/multiplier/extra-life suites.
- `npm run build` -- expected: production build completes with no errors.

**Manual checks:**
- Run `npm run dev`; the HUD shows `HIGH 0` on a first-ever load. Play, drive the score up, and die: reload the page — the HUD `HIGH` now shows the score from the previous run. Play a worse run and die: the `HIGH` value is unchanged after reload.

## Auto Run Result

Status: done

Summary: Implemented FR11 (Story 3.4 Persistent High Score) — the last piece of the Epic 3 RE1 economy. A guarded browser-storage port (`createHighScoreStorage`) funnels all `localStorage` access through one seam whose every access (including acquiring the store handle) is try/catch-wrapped, so a missing/blocked/throwing store degrades to a no-op (`load()` → 0, `save()` ignored) and never throws. A Phaser-free `HighScoreSystem` reads the stored high at construction, seeds the live-tracked HUD value from it, tracks the run's best each fixed step, and on the game-over edge writes the new high back through the port exactly once — re-reading the current stored value at the write moment and saving only when the run strictly beat it (defends single-tab and concurrent-tab cases). Wired into `ArenaScene` LAST (after `PlayerDeathSystem`) so it observes `gameOver` on the same tick it latches, before the whole-world gate freezes the sim; the HUD gained a `HIGH` line. Reads score + gameOver, never writes either. The polished title/game-over high-score presentation is explicitly deferred to Epic 5 (Story 5.1); the always-on HUD `HIGH` line satisfies the literal "shown / reflects the persisted value across page reloads" AC.

Files changed this run:
- `src/config/constants.js` — added `HIGH_SCORE_STORAGE_KEY = 'angleWars.highScore'` (the single persisted key) with a doc comment.
- `src/persistence/highScoreStorage.js` (new) — the guarded `{load, save}` port; `load()` parses/validates to a finite positive integer (0 on any failure); a guarded `defaultLocalStorage()` helper acquires the store handle without ever throwing.
- `src/systems/HighScoreSystem.js` (new) — the Phaser-free high-score system: seed from `load()`, live-track the best, write-once-when-beaten on the game-over edge with a re-read to defend concurrent-tab clobbering.
- `src/scenes/ArenaScene.js` — constructed the storage + system, `addSystem`'d it after `PlayerDeathSystem` with a placement comment, and added `HIGH ${...}` to the HUD text.
- `src/persistence/highScoreStorage.test.js` (new) — 14 tests: parse/guard matrix, write form, round-trip, null/throwing-store degradation, and the throwing-default-global guard.
- `src/systems/highScoreSystem.test.js` (new) — 10 tests: baseline seed, live climb, beat/loss/exact-equal, idempotent persist, same-tick persist, and the concurrent-tab no-clobber case.
- `src/systems/highScoreIntegration.test.js` (new) — 2 tests composing the real Collision→…→PlayerDeath→HighScore chain in ArenaScene order (beat persists on the latching tick; a losing run persists nothing).
- `_bmad-output/implementation-artifacts/deferred-work.md` — one new defer entry (unpinned real ArenaScene system order — the repo-wide untested-scene gap).

Review findings breakdown: patch 2 (medium 1, low 1), defer 1 (low), reject 9 (all low); intent_gap 0, bad_spec 0.

Follow-up review recommendation: false — patched findings this pass: 0 high, 1 medium, 1 low; score = 3×1 + 1×1 = 4 (< 5), no high.

Verification performed:
- `npm test` → 25 files, 373 tests pass (highScoreStorage 14, highScoreSystem 10, highScoreIntegration 2). No regression in the scoring/death/bomb/black-hole/multiplier/extra-life suites.
- `npm run build` → production build succeeded (vite, no errors; the >500 kB chunk-size notice is pre-existing Phaser-bundle size, unrelated).
- Matrix Test Audit: every I/O & Edge-Case Matrix row maps to a covering test that ran and passed.

Residual risks: the deferred unpinned-tick-order gap (a future `ArenaScene` reorder of `HighScoreSystem` before `PlayerDeathSystem` would ship green while never persisting the high score) — the same repo-wide untested-scene gap tracked since Story 1.1. The real browser `localStorage` behind the guarded default is deliberately untested in the node env; its contract is exercised through injected fakes and the throwing-getter guard test. The polished game-over/title high-score presentation is intentionally left to Epic 5 (Story 5.1).
