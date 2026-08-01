---
title: '12.15 — Chain Reaction (Bomb Capacitor Lv5 + Flak Burst Lv3 → bomb kills trigger mini-bomb cascade)'
type: 'feature'
created: '2026-07-31'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_revision: ''
final_revision: ''
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-11-critical-resonance.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-14-revenant.md'
  - '{project-root}/src/systems/BombSystem.js'
  - '{project-root}/src/systems/FlakSystem.js'
  - '{project-root}/src/systems/CollisionSystem.js'
  - '{project-root}/src/scenes/buildArenaWorld.js'
  - '{project-root}/src/config/constants.js'
  - '{project-root}/src/config/itemRegistry.js'
  - '{project-root}/src/systems/fusionSystem.js'
warnings: []
---

## Intent

**Problem:** Story 12.1 wired the fusion framework with a stub for Chain Reaction.
The Epic — Bomb Capacitor Lv5 + Flak Burst Lv3 → Chain Reaction — is not yet
functional. When fused, every enemy killed by a smart-bomb detonation triggers
a mini-bomb cascade at the kill position.

**Approach:** Capture kill positions in **BombSystem.detainateAt()** (snapshot
enemy x/y before release), then immediately spawn mini-bomb shockwaves at each
kill position within `CHAIN_REACTION_MINI_BOMB_RADIUS` (300px), clearing nearby
survivors. Bound cascade count by NFR11 via a max-live counter. Register the
effect handler in buildArenaWorld.js.

## Boundaries & Constraints

**Always:**
- Chain Reaction only triggers on kills caused by `BombSystem.detainateAt()` —
  bullet kills, flak fragment kills, mine detonations, and all other damage
  paths are NOT cascade sources.
- Mini-bomb shockwaves use `CHAIN_REACTION_MINI_BOMB_RADIUS` (300px, 1/3 of
  a standard bomb's 900px radius) for a mid-range clear, not a screen-clear.
- Mini-bombs DO NOT chain further (one level only) — cascading mini-bombs
  killing enemies do NOT spawn a second-level cascade.
- NFR11 bounding: max `CHAIN_REACTION_MAX_LIVE` (12) mini-bomb cascades per
  detonation. If the cap is reached, remaining kill positions are skipped.
- Mini-bomb kills are appended to `collisionSystem.killedEnemies`, so they
  are scored by ScoringSystem (like main bomb kills).
- Bomb Capacitor stats (radius *mult, stun, xpOrbs, damageField) still apply
  to the main bomb — Chain Reaction only adds mini-bombs for each kill, it
  does not change the primary detonation.
- Mini-bombs do NOT apply bomb enhancements (stun, xpOrbs, damageField) —
  they provide kill clearance + visual shockwave only.
- NFR5: mini-bomb visual reuses the existing `shockwaveMs/shockwaveX/shockwaveY`
  countdown on BombSystem.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering or audio for Chain Reaction mini-bombs — Story 12.2
  covers Fusion UX visuals/audio.
- Modify Bomb count — mini-bombs are costless cascade, they do not decrement
  `scoreState.bombs`.
- Modify BombSystem's main `detainateAt` release behavior — scoring, XP orbs,
  stun and damage field all fire normally. Mini-bombs are an ADD-ON path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path: bomb kills 5 enemies | Chain Reaction fused, bomb released, 5 enemies in radius | 5 mini-bombs spawned at kill positions; each clears enemies within 300px; bounded by CHAIN_REACTION_MAX_LIVE | No error expected |
| Bomb kills 0 enemies | Chain Reaction fused, bomb in empty corner | 0 mini-bombs (no kill positions) | No error expected |
| Massive kill of 20 enemies | Chain Reaction fused | Exactly 12 mini-bomb cascades (cap); 8 dropped | NFR11 cap enforced |
| No Chain Reaction (plain bomb) | Chain Reaction not fused | Standard bomb detonation only; no cascade | No error expected |
| Bomb with Bomb Capacitor Lv1 + Chain Reaction | Lv1 Bomb (1.3x radius) + Chain Reaction | Main bomb fires; 5 kills spawn 5 mini-bombs at 300px radius (not scaled by bombRadiusMult) | No error expected |
| Chain Reaction + Revenant | Both fused | Revenant triggers on death (bomb at death point + multiplier kept); Chain Reaction triggers on bomb presses; independent effects | No error expected |

## Code Map

- `src/config/constants.js` -- MODIFY -- add `CHAIN_REACTION_MINI_BOMB_RADIUS` (= 300) and `CHAIN_REACTION_MAX_LIVE` (= 12)
- `src/systems/BombSystem.js` -- MODIFY -- add `chainReactionActive` field; in `detainateAt()`, capture kill positions, then spawn mini-bombs; add `_spawnMiniBombs()` private method
- `src/scenes/buildArenaWorld.js` -- MODIFY -- register `'chain-reaction'` effect handler
- `src/systems/fusionSystem.js` -- MODIFY -- update chain-reaction stub comment
- `src/systems/bombSystem.test.js` -- NEW -- unit tests for Chain Reaction cascade

## Tasks & Acceptance

### Task 1: Add Chain Reaction constants

Add to `src/config/constants.js` (after Revenant constants, ~line 854):

```js
// --- Chain Reaction (Story 12.15 / Epic 12 — defense Epic) -------------------
// Radius (px) of each mini-bomb shockwave spawned on a bomb-kill.
// 300px is roughly 1/3 of a standard smart-bomb (900px), providing a
// mid-range cascade clear without screen-clear intensity.
export const CHAIN_REACTION_MINI_BOMB_RADIUS = 300;
// Hard cap on cascade mini-bomb count per detonation (NFR11 bounding).
export const CHAIN_REACTION_MAX_LIVE = 12;
```

### Task 2: Modify BombSystem — add chainReactionActive and mini-bomb cascade

**Constructor — add chainReactionActive field:**

Add after line 55 (damage field state):
```js
    // Story 12.15 — Chain Reaction: true when fused. Triggers a mini-bomb
    // cascade at each kill position from detainateAt (ONE level only).
    this.chainReactionActive = false;
```

**In `detainateAt()` — capture kill positions and spawn mini-bombs:**

After the existing enemy collection (before the release block), capture positions:
```js
    // Story 12.15 — Chain Reaction: snapshot kill positions before release
    let crPositions = null;
    if (this.chainReactionActive) {
      crPositions = new Array(enemies.length * 2);
      let pi = 0;
      for (let i = 0; i < enemies.length; i++) {
        crPositions[pi++] = enemies[i].x;
        crPositions[pi++] = enemies[i].y;
      }
    }
```

Then at the end of `detainateAt()`, after existing stun/xpOrbs/damageField blocks:
```js
    // Story 12.15 — Chain Reaction: mini-bomb cascade at kill positions
    if (crPositions) {
      this._spawnMiniBombs(crPositions);
    }
```

**Add `_spawnMiniBombs()` private method:**

Append to BombSystem class:
```js
   // Story 12.15 — Chain Reaction: mini-bomb cascade from kill positions.
   // Each kill position spawns one mini-bomb (up to max cascade cap) that
   // clears enemies within CHAIN_REACTION_MINI_BOMB_RADIUS. Mini-bombs do NOT
   // chain further and do NOT consume bombs.
   _spawnMiniBombs(positions) {
     const radiusSq = CHAIN_REACTION_MINI_BOMB_RADIUS * CHAIN_REACTION_MINI_BOMB_RADIUS;
     const cs = this.collisionSystem;
     const killed = cs.killedEnemies;
     const maxCascade = CHAIN_REACTION_MAX_LIVE;
     let spawned = 0;

     for (let i = 0; i < positions.length && spawned < maxCascade; i += 2) {
       const mx = positions[i];
       const my = positions[i + 1];
       let anyKilled = false;

       for (let p = 0; p < this.enemyPools.length; p++) {
         const pool = this.enemyPools[p];
         pool.forEachActive((e) => {
           const dx = e.x - mx;
           const dy = e.y - my;
           if (dx * dx + dy * dy <= radiusSq) {
             killed.push(e);
             pool.release(e);
             anyKilled = true;
           }
         });
       }

       if (anyKilled) {
         this.shockwaveMs = BOMB_SHOCKWAVE_MS;
         this.shockwaveX = mx;
         this.shockwaveY = my;
         spawned++;
       }
     }
   }
```

### Task 3: Wire chain-reaction effect in buildArenaWorld.js

After the revenant effect handler (~line 681), register:
```js
    // Story 12.15 — Chain Reaction effect wiring.
    // After fusion resolution sets 'chain-reaction' in ownedCards,
    // enable the bomb-kill mini-bomb cascade on bombSystem.
    FusionSystem.registerEffect(
      'chain-reaction',
      () => {
        bombSystem.chainReactionActive = true;
      },
    );
```

### Task 4: Update fusionSystem.js stub comment

Change line 188 from:
```js
    effect: () => {}, // Stub — Epic 12.14 wires bomb cascade effect
```
To:
```js
    effect: () => {}, // Story 12.15 — wires chainReactionActive on bombSystem
```

### Task 5: Update itemRegistry tests if needed

Verify that `chain-reaction` is included in any `EXPECTED_IDS` or `fusionEpicIds`
arrays in `src/config/itemRegistry.test.js`.

### Task 6: Tests

Create `src/systems/bombSystem.test.js`:
- **chainReactionActive=false: no mini-bombs** — call `detainateAt()` with chainReactionActive=false, mock 5 enemies in range. Verify no shockwaveMs set (or shockwaveMs stays at 0 from main detonation)
- **chainReactionActive=true: mini-bombs at kill positions** — set chainReactionActive=true, `detainateAt()`. Verify `_spawnMiniBombs` iterates kill positions and clears survivors
- **chainReactionActive=true: cap respected** — 20 kill positions, verify exactly 12 mini-bombs spawned
- **chainReactionActive=true: no bombs consumed** — verify scoreState.bombs decremented by exactly 1
- **chainReactionActive=true: kills scored** — verify mini-bomb kills pushed to collisionSystem.killedEnemies
- **chainReactionActive=true: no double-chain** — killer of survivors does not spawn mini-bombs
- **no enemy kills: no mini-bombs** — `detainateAt()` in empty area, verify no cascade

**Acceptance Criteria:**
- Given Chain Reaction is fused, when a bomb explodes and kills enemies, then mini-bombs spawn at each kill position within CHAIN_REACTION_MINI_BOMB_RADIUS
- Given mini-bombs are spawned, when no survivors are within range, then no shockwaveMs is set for that mini-bomb
- Given 20 bomb kills with Chain Reaction active, when mini-bombs are spawned, then exactly 12 mini-bombs fire (CHAIN_REACTION_MAX_LIVE cap)
- Given Chain Reaction is fused, when a bomb explodes, then scoreState.bombs is decremented by exactly 1 (not per mini-bomb)
- Given Chain Reaction is fused, when a mini-bomb kills enemies, then those kills are appended to collisionSystem.killedEnemies (scored normally)
- Given Chain Reaction is fused, when a mini-bomb kills enemies, then those mini-bombs do NOT spawn additional mini-bombs (single level cascade only)

## Spec Change Log

| Date | Change |
|------|--------|
| 2026-07-31 | Drafted per story spec |

## Verification

**Commands:**
- `npm test` -- expected: all existing tests pass + new Chain Reaction tests pass.
