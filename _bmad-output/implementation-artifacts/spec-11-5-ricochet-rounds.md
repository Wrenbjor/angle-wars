---
title: 'Story 11.5 — Ricochet Rounds'
type: 'feature'
created: '2026-07-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: 'e1f8c43ac82c7603f990d5f42f199f0afa8ef673'
final_revision: 'cd170aa'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** Epic 11's fifth exotic offense item and the first BASE-GUN MODIFIER of the epic. Ricochet Rounds makes the player's ordinary bullets bounce off the arena walls (once → twice) instead of despawning at the border, so shots that miss keep working; higher levels grow damage per bounce (+25%), bounce off enemies too, and — at Lv5 — raise the budget to 4 bounces and make bounced shots home toward the nearest enemy. It also unlocks the intended synergy with the Mirror Reflector (whose bars already reflect bullets for free) and is the Kaleidoscope fusion partner (Epic 12). Unlike the four prior Epic-11 items (Orbit Blade / Seeker Drones / Mine Layer / Piercing Lance), which are each a SEPARATE pooled entity system, Ricochet modifies the EXISTING base bullet — the same category as Overcharge and Spread Cannon, which already extend `FiringSystem` and `CollisionSystem` through `PlayerStats` folds.

**Approach:** Register `ricochet-rounds` as a data-driven offense item with four additive fold fields on `PlayerStats`; add a small pure helper `src/systems/ricochet.js` (sanitizers + reflection + damage-growth) reused by both hot systems. Stamp the ricochet parameters onto each bullet AT SPAWN (like `damage`, so an in-flight bullet keeps the behavior it was fired with). Reflect bullets off the arena border inside `FiringSystem` (its existing out-of-arena despawn seam), spend one bounce per reflection event, and grow the bullet's damage per bounce. In `CollisionSystem`, a Lv4+ bullet with budget left bounces OFF the enemy it hits (still dealing its damage) instead of being consumed. For Lv5, a bounced seeking bullet re-aims toward the nearest combat enemy each fixed step (`FiringSystem` gains a late-bound `enemyPools` reference, the same late-bind the codebase already uses for `snakeSystem.collisionSystem`). No new pool: ricochet bullets live in the existing `bulletPool`, never multiply, and always terminate.

## Boundaries & Constraints

**Always:**
- A bullet's ricochet parameters (`bouncesRemaining`, `dmgPerBounce`, `bounceOffEnemies`, `seek`) are STAMPED at spawn from the LIVE fold, in BOTH the base-volley and spread-volley paths — every `bulletPool.acquire()` in `FiringSystem`. A recycled bullet carries the previous shot's fields until re-stamped, so an unstamped path would leak stale bounce state (the same hazard `entities/Bullet.js` documents for `damage`). `FiringSystem` is the SOLE spawner into `bulletPool` (verified: `GreenSquareSystem`/`MirrorReflectorSystem` only READ it), so stamping there covers all bullets.
- Ownership gate is `ricochetBounces > 0`: a bullet stamped with `bouncesRemaining === 0` behaves EXACTLY as pre-11.5 — it despawns when it leaves the arena and is consumed on its first enemy hit. An unowned Ricochet, a `null` `playerStats`, or a corrupt fold must yield byte-identical pre-11.5 bullet behavior.
- One reflection EVENT spends exactly one bounce and grows damage exactly once, whether it flips one axis (a flat wall) or both (a corner) — a corner is one bounce, never two. Damage growth is multiplicative on the bullet's CURRENT stamped damage: `damage *= 1 + dmgPerBounce`. Growth applies to WALL and ENEMY bounces alike.
- Wall reflection reuses the existing arena-border geometry (`ARENA_BORDER_INSET`) and the `reflectVelocity` helper (`mirrorReflectorMath.js`); on a crossing, the bullet's velocity component(s) for the crossed side(s) flip and its position is clamped back to the border so it cannot re-trigger the same crossing next tick. Bullet SPEED is preserved by every reflection (reflection is an isometry).
- Enemy bounce (Lv4+) deals the hit's damage FIRST (recorded at the pre-growth value, resolved through the unchanged `applyPlayerDamage` seam so armor/scoring/XP/kill-latches behave exactly as for a normal bullet), THEN reflects the bullet off the enemy's surface normal, grows damage, and decrements the bounce — the bullet is NOT consumed and stays in the pool. A bounced bullet still hits at most ONE enemy per tick (`CollisionSystem`'s existing per-tick contract is preserved).
- Seek (Lv5) re-aims a bullet's velocity toward the nearest COMBAT enemy (`enemyPools`, skipping telegraphing enemies with `telegraphMs > 0`) each fixed step, but ONLY once the bullet has bounced at least once (`bounced === true`) and only when a target exists; with no target the velocity is unchanged so the bullet still travels straight to a wall. Speed is preserved.
- All ricochet work is zero-per-fixed-step allocation: sanitized fold parameters are resolved ONCE per tick (like `damage`/`ways`) and stamped per bullet; reflection writes velocity in place via the `out` form; `_nearestEnemy` reuses hoisted collectors. No new per-frame objects.
- Fold fields are sanitized against a corrupt store before use (mirroring the sibling sanitizers): `bounces` → integer in `[0, RICOCHET_MAX_BOUNCES]` (junk/negative → 0 = unowned); `dmgPerBounce` → finite `>= 0` clamped to `RICOCHET_DMG_PER_BOUNCE_MAX` (junk → 0); the two flags enabled only by a finite value `>= 1`.

**Block If:** none — the level curve, the reflection model, the unified wall+enemy bounce budget, the multiplicative damage growth, and the seek behavior are all resolved here.

**Never:**
- Never make a bullet MULTIPLY (that is the Kaleidoscope fusion, Epic 12): one shot stays one pooled bullet for its whole life. Live bullet count is bounded by fire cadence × max lifetime and every bullet eventually releases (bounce budget is finite; an exhausted bullet despawns at the next wall). This is the NFR11 guarantee.
- Never let the Mirror Reflector's existing free bullet reflect consume a ricochet bounce or vice-versa — the Mirror synergy is EMERGENT (ricochet keeps bullets alive longer to meet mirror bars); do not add special-case coupling between the two.
- Never change `applyPlayerDamage`, the armored damage model, scoring, or the v1 bullet↔enemy contract beyond the added "bounce instead of consume when flagged + budget" branch. A Ricochet bullet is a PROJECTILE: the armored archetype (Story 9.3) resists it exactly as it resists any bullet.
- Not in scope: the Kaleidoscope fusion behavior (only register `fusion: { partner: 'spread-cannon', epic: 'kaleidoscope' }` metadata), any audio/VFX beyond the bounced-bullet tint below, and any new bullet pool.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unowned / corrupt store | `playerStats` null, or `ricochetBounces` 0/NaN/negative | Bullets despawn at the arena border and are consumed on first enemy hit — byte-identical to pre-11.5 | Sanitizers fail safe to unowned |
| Lv1 wall bounce | Lv1 owned (bounces 1), a bullet reaches a wall | Velocity reflects, position clamps inside, one bounce spent; on reaching a wall AGAIN (budget 0) it despawns | No error expected |
| Lv2 two bounces | Lv2 owned (bounces 2), bullet reaches walls repeatedly | Reflects on the 1st and 2nd wall contact, despawns on the 3rd | No error expected |
| Lv3 damage per bounce | Lv3 owned (dmgPerBounce 0.25), bullet bounces then hits an enemy | The post-bounce hit deals `damage × 1.25^(bounces used)`; observable as armored hits-to-kill dropping after bounces | No error expected |
| Lv4 enemy bounce | Lv4 owned (bounceOffEnemies), bullet hits an unarmored enemy with budget left | Enemy is killed via `applyPlayerDamage`; the bullet reflects off it, spends a bounce, grows damage, stays live | No error expected |
| Lv4 enemy bounce, budget spent | Lv4 owned, bullet already at 0 bounces hits an enemy | Enemy killed and bullet CONSUMED (released) — exactly the pre-11.5 path | No error expected |
| Lv5 seek | Lv5 owned (seek), bullet has bounced once, a combat enemy present | Each tick the bullet re-aims toward the nearest enemy at unchanged speed; with no enemy it flies straight | No error expected |
| Corner hit | A bullet crosses both x and y borders in one step, budget left | Both velocity components flip, ONE bounce spent, damage grown once | No error expected |
| Pool cap under load | Many ricochet bullets live at once (Lv5, high fire rate) | Live bullet count stays within the pool; every bullet eventually releases; zero per-tick allocation | No error expected |

</intent-contract>

## Code Map

- `src/config/constants.js` -- add `RICOCHET_MAX_BOUNCES` (sanitizer clamp, anchor to `LANCE_MAX_PIERCE` 16), `RICOCHET_DMG_PER_BOUNCE_MAX` (corrupt-fold guard on the growth fraction), and `COLOR_RICOCHET` (bounced-bullet tint, in the color block near `COLOR_BULLET`), each with a brief rationale comment in the file's style.
- `src/state/PlayerStats.js` -- add the four ricochet fold fields to `PLAYER_STATS_BASE` next to the `lance*` block (all additive, base 0), with a doc comment mirroring the `lance*`/`mine*` blocks. The generic `recomputePlayerStats` fold picks them up with no per-item code.
- `src/config/itemRegistry.js` -- add the frozen `ricochet-rounds` def after `piercing-lance`, before the `// --- Defense ---` marker. Mirror the `piercing-lance` shape (direct per-level `stats` TOTALS, `desc` per PRD §13.4).
- `src/entities/Bullet.js` -- extend `createBullet()` with the ricochet fields at cold defaults (`bouncesRemaining: 0`, `dmgPerBounce: 0`, `bounceOffEnemies: false`, `seek: false`, `bounced: false`); extend the stamp-at-acquire doc-warning to cover them.
- `src/systems/ricochet.js` -- NEW pure helper. Fold sanitizers (`sanitizeBounces`, `sanitizeDmgPerBounce`, flag reads), a per-tick "resolve ricochet params" that returns the sanitized set, `stampRicochet(bullet, params)` (writes all fields + `bounced=false`), `reflectBulletOffWall(bullet)` (flip crossed components, clamp inside, grow damage, decrement — returns whether the bullet survives), and `reflectBulletOffEnemy(bullet, enemy)` (reflect off the enemy normal, grow damage, decrement). Reuse `reflectVelocity` from `mirrorReflectorMath.js`.
- `src/systems/FiringSystem.js` -- resolve ricochet params once per tick; stamp them on every spawned bullet (base AND spread paths); in `_collectExpired`, when an out-of-arena bullet has `bouncesRemaining > 0`, reflect it instead of releasing; add seek steering (re-aim bounced+seek bullets toward `_nearestEnemy`) into the advance step; add a late-bindable `enemyPools` field + `_nearestEnemy(x,y)` (mirror `SeekerDroneSystem`).
- `src/systems/CollisionSystem.js` -- REFERENCE `applyPlayerDamage` unchanged; in pass 1, when a hitting bullet has `bounceOffEnemies` and `bouncesRemaining > 0`, record the hit at the pre-growth damage, reflect the bullet off the enemy, grow/decrement, and do NOT add it to `hitBullets` (not consumed); otherwise the existing consume path.
- `src/scenes/buildArenaWorld.js` -- late-bind `firingSystem.enemyPools = enemyPools` after `enemyPools` is assembled (mirror the `snakeSystem.collisionSystem = collisionSystem` late-bind), with a comment.
- `src/scenes/ArenaScene.js` -- in the bullet render loop, draw a bullet with `bounced === true` in `COLOR_RICOCHET` (a distinct tint communicates the mechanic — the epic's visual-legibility requirement), else `COLOR_BULLET`. Sim-state-read-only.
- `src/systems/mirrorReflectorMath.js` -- REFERENCE for `reflectVelocity(vx,vy,nx,ny,out)` (zero-alloc reflect across a unit normal).
- `src/systems/SeekerDroneSystem.js` -- REFERENCE for `_nearestEnemy`, telegraph-skipping, and homing re-aim (speed-preserving).
- `src/systems/firingSystem.test.js` / `src/systems/collisionSystem.test.js` / `src/state/playerStats.test.js` -- REFERENCE test harnesses to extend.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add `RICOCHET_MAX_BOUNCES = 16`, `RICOCHET_DMG_PER_BOUNCE_MAX = 4`, `COLOR_RICOCHET` (a distinct neon tint, e.g. a warm hue vs. `COLOR_BULLET`) -- named tunables + color, anchored to siblings with rationale comments.
- `src/state/PlayerStats.js` -- add `ricochetBounces: 0`, `ricochetDmgPerBounce: 0`, `ricochetOffEnemies: 0`, `ricochetSeek: 0` to `PLAYER_STATS_BASE` (all additive, base 0), doc-commented like the `lance*` block; note `ricochetBounces` is the ownership gate and `ricochetDmgPerBounce` is a fraction (0.25 = +25%/bounce), NOT a `*Mult` field.
- `src/config/itemRegistry.js` -- add the frozen `ricochet-rounds` def (track `offense`, `rarity: 4`, `maxLevel: ITEM_MAX_LEVEL`, `guaranteeFromLevel: null`, `fusion: { partner: 'spread-cannon', epic: 'kaleidoscope' }`) with five per-level `stats` TOTALS: L1 `{ricochetBounces:1}`; L2 `{ricochetBounces:2}`; L3 `{ricochetBounces:2, ricochetDmgPerBounce:0.25}`; L4 `{ricochetBounces:2, ricochetDmgPerBounce:0.25, ricochetOffEnemies:1}`; L5 `{ricochetBounces:4, ricochetDmgPerBounce:0.25, ricochetOffEnemies:1, ricochetSeek:1}`. Player-facing `desc` per PRD §13.4 (bounce once / twice / +25%/bounce / bounce off enemies / 4 bounces + seek).
- `src/entities/Bullet.js` -- add the five ricochet fields at cold defaults to `createBullet()` and extend the stamp-at-acquire warning comment.
- `src/systems/ricochet.js` -- NEW helper implementing the sanitizers, per-tick param resolve, `stampRicochet`, `reflectBulletOffWall`, `reflectBulletOffEnemy` (all zero-alloc, `reflectVelocity`-based, damage grown multiplicatively once per bounce, corner = one bounce).
- `src/systems/FiringSystem.js` -- stamp ricochet on every acquired bullet (both volley paths); reflect out-of-arena bullets with budget instead of releasing; seek-steer bounced Lv5 bullets via `_nearestEnemy`; add the late-bindable `enemyPools`. The unowned/base path stays byte-identical.
- `src/systems/CollisionSystem.js` -- add the bounce-instead-of-consume branch in pass 1 for flagged bullets with budget; every other bullet path unchanged.
- `src/scenes/buildArenaWorld.js` -- late-bind `firingSystem.enemyPools = enemyPools`.
- `src/scenes/ArenaScene.js` -- render bounced bullets in `COLOR_RICOCHET`.
- `src/systems/ricochet.test.js` -- NEW unit tests for the helper: sanitizers (junk/negative/over-cap), stamp overwrites stale fields, wall reflect (component flip + clamp + one-bounce-per-event + corner), damage growth multiplicative, enemy reflect, budget-exhaustion release signal.
- `src/systems/firingSystem.test.js` -- extend: unowned bullet despawns as before; Lv1/Lv2 bounce counts; stamp on both base and spread volleys; seek re-aim toward nearest (and straight when no target); pool never grows unbounded and all bullets eventually release under sustained Lv5 fire.
- `src/systems/collisionSystem.test.js` -- extend: Lv4 bullet kills + bounces (stays live), budget-spent bullet is consumed, one-enemy-per-tick preserved, damage recorded pre-growth, unowned bullet consumed as before.
- `src/state/playerStats.test.js` -- extend: fold values per level against the SHIPPED registry equal 1/0/0/0, 2/0/0/0, 2/0.25/0/0, 2/0.25/1/0, 4/0.25/1/1 for bounces/dmgPerBounce/offEnemies/seek.

**Acceptance Criteria:**
- Given Ricochet is unowned (or `playerStats` null), when the sim steps, then bullets despawn at the arena border and are consumed on their first enemy hit exactly as before this story.
- Given Lv1 owned, when a bullet reaches an arena wall, then its velocity reflects (speed preserved), its position stays inside the border, one bounce is spent, and on the NEXT wall contact it despawns.
- Given Lv2 owned, when a bullet travels across the arena, then it reflects off the first and second walls it meets and despawns on the third.
- Given Lv3 owned, when a bullet has bounced and then hits an armored enemy, then the damage applied is the bullet's grown value (`base_damage × 1.25` per bounce), observable as armored hits-to-kill dropping after bounces.
- Given Lv4 owned and a bullet with budget left, when it hits an unarmored combat enemy, then the enemy is killed through `applyPlayerDamage`, the bullet reflects off it, spends a bounce, and remains active; a bullet with 0 budget is consumed instead.
- Given Lv5 owned and a bullet that has bounced at least once, when combat enemies are present, then the bullet re-aims toward the nearest each fixed step at unchanged speed; when none are present it travels straight.
- Given a bullet crosses a corner (both borders in one step) with budget, when it reflects, then both velocity components flip but only one bounce is spent and damage grows once.
- Given sustained Lv5 fire, when many ricochet bullets are live, then the live bullet count stays within the pool cap, no per-tick allocation occurs, and every bullet eventually releases.
- Given the item at each level 1→5, when `recomputePlayerStats` folds the owned build, then `ricochetBounces`/`ricochetDmgPerBounce`/`ricochetOffEnemies`/`ricochetSeek` equal 1/0/0/0, 2/0/0/0, 2/0.25/0/0, 2/0.25/1/0, 4/0.25/1/1 respectively.
- Given the full test suite, when `npm test` runs, then all tests pass and the v1 firing/collision behavior is unchanged for an unowned build.

## Design Notes

**Why modify the base gun, not a new pooled system.** The four prior Epic-11 items are separate pooled projectile/entity systems, and Piercing Lance's spec explicitly forbade touching `FiringSystem`/`CollisionSystem` — because a *separate* projectile must not make the *base* bullet pierce. Ricochet is the opposite category: its whole intent is that the player's ORDINARY bullets bounce. That is a base-gun modifier, exactly like Overcharge (`damageMult`/`fireRateMult`) and Spread Cannon (`spreadWays`/`spreadArcDeg`), both of which already read `PlayerStats` folds inside `FiringSystem`. The epic context lists Ricochet under the "firing" seam. So extending `FiringSystem`/`CollisionSystem` here is correct and intended, not a violation of the lance's (item-specific) constraint.

**Stamp-at-spawn, not read-live.** Ricochet params are stamped onto each bullet at fire time (resolved once per tick, then written per bullet) so an in-flight bullet keeps the behavior it was fired with — identical to how `damage` is handled and why a mid-run upgrade never retroactively changes bullets already on screen. It also makes the unowned path a pure `bouncesRemaining === 0` check with zero live-store reads in the hot advance/collision loops.

**Unified bounce budget; multiplicative growth; corner = one bounce.** `ricochetBounces` is a single budget spent by wall AND enemy reflections alike (the AC's "bounces" is one number: 1→2→2→2→4). Growth is `damage *= 1 + dmgPerBounce` per reflection event — "+25% dmg per bounce" read as compounding on the bullet's current stamped damage (a self-contained, testable rule). A corner crossing flips both axes but is one physical bounce, so it spends one budget unit and grows damage once — decided here so the budget can't be silently halved near corners.

**Seek needs enemies in FiringSystem.** `enemyPools` is assembled after `FiringSystem` is constructed, so it is late-bound onto the system (the same pattern `buildArenaWorld` already uses for `snakeSystem.collisionSystem`). FiringSystem runs before `EnemySystem` each tick, so homing reads enemy positions one tick stale — negligible at the fixed step and acceptable for a homing feel (the sibling homing items tolerate the same class of staleness). The scan is gated to Lv5 bullets that have already bounced, so the common case pays nothing.

**Termination / NFR11.** A ricochet bullet never multiplies, so live count is bounded by `fire_rate × max_lifetime`. Every bullet terminates: the bounce budget is finite, and an exhausted bullet leaves the arena at the next wall (constant-speed straight flight guarantees a wall). A homing bullet either bounces off enemies (spending budget) or, when the arena empties, flies straight to a wall — so seek cannot create an immortal orbiter. The existing `BULLET_POOL_PREWARM` (640) is ample; reflection is in-place (`reflectVelocity` `out` form) and params resolve once per tick, so the hot path stays zero-allocation.

**Mirror Reflector synergy is emergent.** The reflector's bars already reflect player bullets for free (`MirrorReflectorSystem`, magnitude-preserving, non-consuming). Ricochet keeps bullets alive longer, so they encounter more bars — the synergy the AC calls out — with no coupling code between the two systems.

## Verification

**Commands:**
- `npx vitest run src/systems/ricochet.test.js` -- expected: all new helper tests pass.
- `npx vitest run src/systems/firingSystem.test.js src/systems/collisionSystem.test.js src/state/playerStats.test.js` -- expected: extended suites pass; unowned bullet behavior unchanged.
- `npm test` -- expected: the whole suite passes with no regressions in the v1 firing/collision behavior.
- `npm run build` -- expected: the production build succeeds (no import/name errors from the new module).

## Spec Change Log

No spec amendments — no `bad_spec`/`intent_gap` loopback occurred. Review findings were resolved as additive patches (see Review Triage Log and Auto Run Result).

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` `reflectBulletOffEnemy` reflected the bullet's velocity but never separated it from the enemy, so a SURVIVING enemy (armored, hp > damage) could be re-collided on the following tick — spending another bounce and dealing compounding damage, and at Lv5 seek re-aiming back to drill one target. Added a position push-out onto the enemy surface (`enemy.radius + bullet.radius` along the contact normal) after reflection, plus a deterministic reverse-and-push for the coincident (`mag === 0`) degenerate case; added two helper tests (post-bounce separation distance + speed preserved; coincident reversal).
  - `[low]` `[patch]` `_nearestEnemy`'s min-distance comparison was exercised only against single-enemy seek fixtures. Added a two-enemy seek test asserting a bounced Lv5 bullet re-aims toward the CLOSER enemy.
  - `[low]` `[patch]` The seek target collector's telegraph-skip (`telegraphMs > 0`) was untested (all fixtures used `telegraphMs: 0`). Added a seek test with a telegraphing-only enemy asserting straight flight.

## Auto Run Result

Status: done

### 2026-07-24 — Implementation + review pass

**Summary:** Implemented Story 11.5 (Ricochet Rounds), the epic's first BASE-GUN MODIFIER: the player's ordinary bullets bounce off arena walls (Lv1 once → Lv2 twice), grow +25% damage per bounce (Lv3), bounce off enemies too (Lv4), and at Lv5 raise the budget to 4 bounces with bounced shots homing toward the nearest enemy. It folds onto the existing base bullet via `PlayerStats` + `FiringSystem`/`CollisionSystem` (the Overcharge/Spread Cannon category), not a new pooled system, with a pure `src/systems/ricochet.js` helper holding the reflection/stamp/sanitizer logic. Four review layers (Blind Hunter / adversarial, Edge Case Hunter, Verification Gap, Intent Alignment) ran in parallel at Opus capability over the diff since baseline `e1f8c43`. Three findings were fixed as additive patches (1 medium, 2 low); the remaining findings were rejected as by-design, near-zero-measure, cosmetic, or consistent with established codebase precedent. No spec amendment, no intent gap, no deferrals.

**Files changed:**
- `src/config/constants.js` — `RICOCHET_MAX_BOUNCES` (16), `RICOCHET_DMG_PER_BOUNCE_MAX` (4), `COLOR_RICOCHET` tint.
- `src/state/PlayerStats.js` — four additive fold fields (`ricochetBounces`/`ricochetDmgPerBounce`/`ricochetOffEnemies`/`ricochetSeek`).
- `src/config/itemRegistry.js` — the `ricochet-rounds` def (offense, rarity 4, fusion `spread-cannon`→`kaleidoscope`), per-level TOTALS 1/2/2/2/4 bounces etc.
- `src/entities/Bullet.js` — five ricochet fields at cold defaults + stamp-at-acquire warning.
- `src/systems/ricochet.js` — NEW pure helper (sanitizers, resolve/stamp, wall + enemy reflection with push-out, multiplicative growth).
- `src/systems/FiringSystem.js` — per-tick param resolve + per-bullet stamp (both volleys), wall reflection at the despawn seam, Lv5 seek steering, late-bindable `enemyPools` + `_nearestEnemy`.
- `src/systems/CollisionSystem.js` — bounce-instead-of-consume branch (pre-growth damage recorded, reflect, keep live).
- `src/scenes/buildArenaWorld.js` — late-bind `firingSystem.enemyPools = enemyPools`.
- `src/scenes/ArenaScene.js` — bounced bullets render in `COLOR_RICOCHET`.
- Tests: NEW `src/systems/ricochet.test.js` (21); extended `firingSystem.test.js` / `collisionSystem.test.js` / `playerStats.test.js`; plus count/ordering fixups in `itemRegistry.test.js` / `cardOffer.test.js` / `levelUpSystem.test.js` (adding the 9th offense item shifts their arithmetic).

**Review findings breakdown:** patches applied 3 (medium 1, low 2); deferred 0; rejected 12 (low 12). Rejected classes: pool peak 676 > 640 prewarm (consistent with the documented lazy-grow design — the prewarm covers normal play, not worst-case pinball; MirrorReflectorSystem already makes lifetime unbounded; ricochet never MULTIPLIES bullets and the pool drains fully to 0, empirically verified); seek re-aims at just-hit enemy (by-design homing, mitigated by the push-out patch); duplicated `bouncesRemaining > 0` gate (defensive redundancy); a second same-tick bullet phasing through an already-hit surviving enemy (near-zero-measure, inherited one-hit-per-tick contract); fractional flag folds disabling flags (no shipped content produces a fractional fold; sibling `>= 1` convention); bounced tint not clearing on budget exhaustion (cosmetic, Epic 4 owns aesthetic); seek trapping bullets against wall-adjacent enemies (bounded, terminates); zero-per-tick-allocation AC lacking a direct assertion (proxied by the pool-no-grow tests, the lance precedent); with-enemies seek termination untested in isolation (depends on CollisionSystem consuming enemy-bounces — its pieces are tested and full-world drain to 0 was empirically confirmed); the Mirror-Reflector-synergy surface being emergent/unverified (the spec's explicit, defensible design choice — the AC enumerates only walls and enemies as ricochet surfaces).

**Follow-up review recommendation:** true. Patched this pass: high 0, medium 1, low 2 → score `3×1 + 1×2 = 5` (≥ 5) → true.

**Verification performed:**
- `npx vitest run src/systems/ricochet.test.js src/systems/firingSystem.test.js src/systems/collisionSystem.test.js src/state/playerStats.test.js` — 280 passed (ricochet 21, firing 129, collision 79, playerStats 51).
- `npm test` — 1999 passed, 74 files, no regressions (v1 firing/collision unchanged for the unowned build).
- `npm run build` — production build succeeded (109 modules).
- Empirical probe (temporary, removed): worst authored build (Spread Lv5 9-way + fireRateMult 1.7 + Ricochet Lv5) peaked at 676 concurrent bullets and drained fully to 0 after fire stopped — bounded, terminating, one-time lazy grow then zero-alloc, exactly the accepted pattern.

**Residual risks:**
- Seek termination for a homing bullet depends on `CollisionSystem` consuming enemy contacts (spending budget); in isolation a Lv5 seek bullet can orbit a never-dying enemy. In the assembled world (`FiringSystem` → `CollisionSystem` ordering, and enemies that actually die) this always terminates — empirically confirmed. Documented, not a defect.
- The worst-case build exceeds `BULLET_POOL_PREWARM` (676 > 640) by a small margin, triggering a one-time lazy pool growth then returning to zero-allocation — consistent with the constant's own documented design (it covers normal play, not worst-case pinball).
- `COLOR_RICOCHET` is a placeholder tint distinct from the base bullet; Epic 4 owns the final aesthetic.
