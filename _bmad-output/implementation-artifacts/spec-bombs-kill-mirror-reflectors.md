---
title: 'Bombs Kill Mirror Reflectors'
type: 'bugfix'
created: '2026-08-01'
status: 'done'
baseline_commit: 'c355305'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Smart bombs clear ordinary enemies but leave the floating Mirror Reflector barbells alive, making the bomb’s screen-clearing promise feel inconsistent.

**Approach:** Include the Mirror Reflector pool in the target set used specifically by `BombSystem`, so every real bomb detonation releases active reflectors through the same pooled kill-reconciliation path as other bomb targets.

## Boundaries & Constraints

**Always:** A bomb detonation must remove every active reflector exactly once, return each instance to its owning pool, and report the removal through the existing bomb kill seam. Preserve pooling and zero steady-state allocation. Keep the reflector pool outside ordinary bullet collision and player-contact death lists.

**Ask First:** Any special bomb-only score or XP reward for reflectors, a partial/radius-based bomb clear, or changes to reflector spawn balance.

**Never:** Make bullets damage reflectors, make black-hole absorption or unrelated weapon/AoE systems target reflectors, remove center-thread or barbell-weight interactions, or duplicate/reimplement `BombSystem.detonateAt` inside the reflector system.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Active reflector | One or more active reflectors when a bomb detonates | Every reflector is released and appears once in the existing killed-enemy report | No active reflector is double-released |
| Mixed enemies | Reflectors and ordinary enemies are active | The same detonation clears both sets through their owning pools | Pool ownership remains correct across heterogeneous targets |
| No reflectors | Reflector pool is empty | Ordinary bomb clearing and bomb consumption remain unchanged | Empty pool is a no-op |
| Non-bomb damage | Bullet, black hole, player contact, or unrelated AoE occurs | Reflector’s existing immunity/special interactions remain unchanged | Reflector pool stays excluded from those target lists |

</frozen-after-approval>

## Code Map

- `src/scenes/buildArenaWorld.js` -- assembles shared combat pools and constructs `BombSystem`; currently excludes the reflector pool from all circle seams.
- `src/systems/BombSystem.js` -- owner-aware screen-clear sweep; must distinguish queued smart bombs from reused non-player clears.
- `src/systems/BlackHoleSystem.js` -- reuses `detonateAt` for unstable-hole screen clears, which must remain reflector-excluding.
- `src/systems/PlayerDeathSystem.js` -- reuses `detonateAt` for Revenant death clears, which must remain reflector-excluding.
- `src/scenes/buildArenaWorld.test.js` -- assembled-world coverage for reflector pool scope and real system ordering.
- `src/systems/bombSystem.test.js` -- unit coverage for heterogeneous pool clearing and kill reporting.
- `src/config/constants.js` -- reflector comments currently document obsolete bomb immunity.

## Tasks & Acceptance

**Execution:**
- [x] `src/systems/BombSystem.js` -- add a preassembled bomb-only target extension used only when `fixedUpdate` consumes a queued player smart bomb; keep `detonateAt` callers and Bomb Capacitor stun/damage-field loops on ordinary pools.
- [x] `src/scenes/buildArenaWorld.js` -- inject the reflector pool through that bomb-only extension without broadening shared `enemyPools`.
- [x] `src/scenes/buildArenaWorld.js` and `src/config/constants.js` -- document queued-bomb vulnerability while retaining reflector exclusion from all reused/non-bomb clears.
- [x] `src/scenes/buildArenaWorld.test.js` -- prove a real queued bomb clears ordinary and reflector enemies while pool membership, reporting, and ordinary collision/death exclusions remain correct.
- [x] `src/systems/bombSystem.test.js` -- pin heterogeneous owner release, repeated recycling, default external `detonateAt` exclusion, and queued-bomb inclusion.
- [x] `src/systems/blackHoleSystem.test.js` and `src/systems/playerDeathSystem.test.js` -- regression-test that unstable-hole and Revenant screen clears leave reflectors untouched.

**Acceptance Criteria:**
- Given active ordinary enemies and Mirror Reflectors, when a smart bomb detonates, then all are removed through their correct pools in that fixed tick.
- Given the same bomb kill, when downstream kill observers inspect the existing report, then each removed reflector occurs exactly once without a new special scoring or XP path.
- Given no bomb detonation, when bullets, black holes, contact-death checks, or unrelated AoE systems run, then reflector behavior remains unchanged.
- Given repeated spawning and bombing, when reflector instances are recycled, then total pool membership remains stable and no double-release occurs.

## Spec Change Log

- 2026-08-01 review loop 1: Acceptance audit found that injecting the reflector-inclusive list as `BombSystem.enemyPools` also broadened black-hole and Revenant calls to `detonateAt`, violating the frozen bomb-only boundary. Tasks now require separate ordinary and queued-player-bomb target compositions plus explicit reused-clear regressions. Avoid the known-bad single-list design. KEEP the dedicated pool composition, owner-aware release path, exact-once/recycling coverage, and ordinary collision/death exclusions from the first derivation.

## Design Notes

Use a dedicated `bombEnemyPools` composition rather than broadening `enemyPools`. The latter is shared by collision, black-hole, death, dash, weapon, shield, telemetry, and feedback systems, and would silently remove the reflector’s bespoke geometry contract everywhere. `BombSystem` already tracks each collected entity’s owning pool, so no new kill algorithm is necessary.

## Verification

**Commands:**
- `npm test -- --run src/systems/bombSystem.test.js src/scenes/buildArenaWorld.test.js` -- bomb and assembled-world regressions pass.
- `npm test` -- full suite passes.
- `npm run build` -- production bundle succeeds.

**Manual checks:**
- Spawn a floating reflector barbell, trigger a smart bomb, and confirm it disappears with the rest of the screen clear while ordinary bullets still reflect from subsequent barbells.

## Suggested Review Order

**Bomb-only targeting boundary**

- Separate queued-bomb targets preserve the behavior of shared screen-clear callers.
  [`BombSystem.js:35`](../../src/systems/BombSystem.js#L35)

- Queued player bombs explicitly select the reflector-inclusive pool composition.
  [`BombSystem.js:119`](../../src/systems/BombSystem.js#L119)

- Default detonation callers retain the ordinary enemy pool boundary.
  [`BombSystem.js:178`](../../src/systems/BombSystem.js#L178)

**World assembly**

- Assemble reflector targeting without broadening collision or death pool membership.
  [`buildArenaWorld.js:306`](../../src/scenes/buildArenaWorld.js#L306)

- Inject the dedicated target composition into the bomb system.
  [`buildArenaWorld.js:555`](../../src/scenes/buildArenaWorld.js#L555)

**Regression coverage**

- Unit tests pin exact-once clearing, recycling, and external-call exclusion.
  [`bombSystem.test.js:74`](../../src/systems/bombSystem.test.js#L74)

- Assembled-world coverage verifies real bomb consumption and heterogeneous clearing.
  [`buildArenaWorld.test.js:210`](../../src/scenes/buildArenaWorld.test.js#L210)

- Black-hole detonation remains unable to remove reflectors.
  [`blackHoleSystem.test.js:495`](../../src/systems/blackHoleSystem.test.js#L495)

- Revenant clears remain on the ordinary detonation contract.
  [`playerDeathSystem.test.js:1509`](../../src/systems/playerDeathSystem.test.js#L1509)
