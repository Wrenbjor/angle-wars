---
title: '12.1 — Fusion Core (sim-side fusion framework, recipe registry, condition detection, offer guarantee, resolution)'
type: 'feature'
created: '2026-07-29'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '6c92c9a2c20a872469a10a2416dd5276a105dfa4'
final_revision: 'e9fbca051a0bbafbc5de9057c0b6fcad25c1a3e5'
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md' # Epic 12 story descriptions
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md' # Fusion mechanics + tree + NFR context
  - '{project-root}/src/config/itemRegistry.js' # Fusion metadata already on 14 items
  - '{project-root}/src/systems/LevelUpSystem.js' # Edge-detect level-up → weighted draw seam
  - '{project-root}/src/state/ProgressionState.js' # ownedCards / remnantIds primitives
---

<!-- Epic 12 re-sliced 2026-07-27 after 4 bundled stories timed out on every run. 12.1 is
sim-only — its effects are stubbed until Stories 12.3–12.16 wire each Epic. -->

## Intent

**Problem:** The game has full item registry, leveling, and card-offer plumbing (Epics 8–11),
but no fusion framework. When a player maxes an item (Lv5) and has its partner (Lv3+), the run
should detect this, expose a **FUSION READY** state, guarantee the Epic card in slot 1 of the next
level-up offer, and resolve the fusion — replacing the Lv5 item with its Epic and consuming the
partner to a Lv3 remnant. No rendering or audio (Story 12.2); Epic effects are stubbed (12.3–12.16).

**Appro:** Build a pure, Phaser-free `FusionSystem` module that holds the recipe registry and
condition-detection logic, integrate a "fusion-ready" guarantee into the LevelUpSystem offer
pipeline, and wire resolution into `applyCard` so the fusion consumes items and produces the
Epic + remnant. Add full unit test coverage.

## Boundaries & Constraints

**Always:**
- FusionSystem is pure-data + pure-check — no Phaser, no rendering, no audio. Only reads
  `progressionState` (ownedCards + remnantIds), the shared `registry` (ITEM_REGISTRY) for item
  definitions, and writes its own fields.
- Epic effects are stubbed — the `resolveRecipe` method records that the fusion happened
  (primary → Epic in ownedCards, partner → remnant via markRemnant), but the Epic's gameplay
  behavior (Tesla Circuit, Railgun, etc.) is stubbed until the individual Epic story lands.
- The recipe registry is the single source of truth for all 14 fusion conditions — no condition
  logic is duplicated in LevelUpSystem or cardOffer.js.
- Existing code (item registry, LevelSystem, LevelUpSystem, cardOffer, ProgressionState) is
  extended by adding files and small integration hooks — nothing is rewritten.

**Block If:** None. All design decisions are specified here.

**Never:**
- Implement rendering (HUD badge, gold card UI, particle aura) — that is Story 12.2.
- Implement Epic effects (Tesla Circuit chain lightning, Railgun charge beam, etc.) — each is
  its own story (12.3–12.16).
- Use a hardcoded mapping outside the registry — all 14 recipes live in FusionSystem.
- Modify itemRegistry.js — fusion conditions are defined once in FusionSystem (not duplicated
  from itemRegistry's `fusion` metadata, though the registry's metadata remains the forward-
  looking reference for future stories).

## Code Map

- `src/config/itemRegistry.js` -- fusion metadata on all 14 items (`{ fusion: {partner, epic} }`) — READ-ONLY
- `src/config/constants.js` -- `ITEM_MAX_LEVEL = 5`, `ITEM_REMNANT_LEVEL = 3`, `LEVEL_MAX = 30` — READ-ONLY
- `src/systems/LevelSystem.js` -- `levelsGainedThisTick` edge-detect seam — READ-ONLY
- `src/systems/LevelUpSystem.js` -- offers weighted draw, applies picks, calls `applyCard` — EXTEND: fusion guarantee hook
- `src/systems/cardOffer.js` -- `drawCardOffer` weighted-without-replacement draw — READ-ONLY (no changes needed; FusionSystem handles the guarantee separately)
- `src/state/ProgressionState.js` -- `applyCard`, `markRemnant`, `removeOwnedItem` primitives — EXTEND: fusion-applyCard branch
- `src/state/PlayerStats.js` -- `recomputePlayerStats` after fusion — READ-WRITE (re-folded by applyCard)
- `src/scenes/buildArenaWorld.js` -- system wiring — EXTEND: instantiate + wire FusionSystem
- `src/systems/fusionSystem.js` -- NEW: recipe registry + condition detection + resolution
- `src/systems/fusionSystem.test.js` -- NEW: all fusion ACs

## Tasks & Acceptance

**Implementation:**

- `src/systems/fusionSystem.js` -- CREATE — recipe registry (14 recipes, frozen), `checkConditions(prog, registry)`, `resolveRecipe(recipeId, prog)`, `getReadyRecipes(prog, registry)`, `isRecipeReady(recipe, prog, registry)`
- `src/state/ProgressionState.js` -- MODIFY — extend `applyCard` to branch for fusion cards (`epicType`), call `resolveRecipe` and `recomputePlayerStats`; add `removeOwnedItem` helper
- `src/systems/LevelUpSystem.js` -- MODIFY — add `fusionSystem` dependency, detect ready fusions on level-up tick, pass fusion guarantee into offer guarantee slot
- `src/scenes/buildArenaWorld.js` -- MODIFY — instantiate FusionSystem, thread into LevelUpSystem
- `src/systems/fusionSystem.test.js` -- CREATE — full test suite for all 4 ACs
- `src/systems/levelUpSystem.test.js` -- MODIFY — extend with fusion-integration test

**Acceptance Criteria:**

AC1 — **Condition detection → immediate fusion-ready state:**
- Given a Lv5 item and its specific partner at Lv3+ (e.g. Piercing Lance Lv5 + Overcharge Lv3),
  When the condition becomes satisfied (any tick),
  Then FusionSystem.getReadyRecipes() exposes the matching recipe(s) immediately, and
  LevelUpSystem's next level-up guarantees the Epic card in slot 1 of the offer.

AC2 — **Fusion resolution → replacement + remnant:**
- Given the Epic card is chosen and applyCard is called,
  When resolveRecipe executes,
  Then the Lv5 primary item is removed from ownedCards and replaced by the Epic id,
  and the partner item is consumed to a Lv3 remnant (level clamped to 3, added to remnantIds, stops upgrading, still occupies its slot).

AC3 — **Generic partner rules (any-2-offense-lv5, any-defense-lv3+):**
- Given the "any 2 offense Lv5" condition (Critical Resonance, Overcharge Lv5),
  When evaluated against an ownedCards with 2+ distinct offense items at Lv5,
  Then the fusion is detected as ready.
- Given the "any defense Lv3+" condition (Stasis Lock, Chrono Field Lv5),
  When evaluated against ownedCards with any defense item at Lv3+,
  Then the fusion is detected as ready.

AC4 — **Full 14-recipe registry, tests, effects stubbed:**
- Given the complete registry of 14 fusion recipes from PRD §13.5,
  When the system is initialized,
  Then all 14 recipes are present and their conditions, partner rules, and remnant behavior
  are testable, and the Epic effects are stubbed (no-op resolution beyond item swap).

## Verification

**Commands:**
- `npm test` -- expected: 12.1 fusion tests pass + all existing tests still pass (no regression).
- `npm run build` -- expected: production build succeeds, resolves `fusionSystem.js`.

---

## Data Model

### Fusion Recipe

```js
{
  id: 'tesla-circuit',           // Fusion Epic id
  primaryItemId: 'orbit-blade',   // Item at Lv5 → replaced by Epic
  partnerRule: 'single',          // 'single' | 'any-2-offense-lv5' | 'any-defense'
  partnerItemId: 'overcharge',    // Required partner id (null for generic rules)
  requiredLevel: 3,               // Partner minimum level (always 3)
  epicType: 'tesla-circuit',      // Same as id; consumed by applyCard to build card
  effect: () => {}               // STUB — Epic 12.3+ stories wire real effects
}
```

### Ready Fusion (returned by checkConditions)

```js
{
  recipeId: 'tesla-circuit',
  partnerItemId: 'overcharge'      // The SPECIFIC partner that satisfies the condition
}
```

### Epic Card (built by LevelUpSystem when fusion is ready)

```js
{
  id: 'epic-tesla-circuit',       // Distinct from item ids
  name: 'Tesla Circuit',
  title: 'Tesla Circuit',
  epicType: 'tesla-c circuit',    // Signal to applyCard: this is a fusion card
  fusionRecipeId: 'tesla-circuit', // Which recipe to resolve
  isEpicCard: true
}
```

---

## Spec Change Log

(empty until first review loopback)

## Review Triage Log

### 2026-07-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

## Design Notes

### Recipe registry is owned by FusionSystem (itemRegistry is READ-ONLY)

itemRegistry.js already carries fusion metadata (`{ fusion: {partner, epic} }`) on all 14 items.
Story 12.1 owns the FUSION RECIPES in FusionSystem — the itemRegistry data is for future stories
that need a bidirectional lookup (Epic → source items). FusionSystem constructs its own frozen
recipe array from the PRD §13.5 fusion map.

### The recipe registry has four generic partner rule types

Each fusion recipe specifies a partner rule:
- `single`: one specific item id at Lv3+ (the majority rule)
- `any-2-offense-lv5`: any 2 distinct offense items at Lv5 (Critical Resonance)
- `any-defense`: any defense item at Lv3+ (Stasis Lock)
- `any-offense`: any offense item at Lv3+ (hypothetical future)

The check logic differentiates these: `single` checks if the specific id is at required level;
`any-2-offense-lv5` counts offense items at Lv5 ≥ 2; `any-defense` checks any defense item ≥ Lv3.

### Condition detection and offer guarantee are decoupled

FusionSystem provides `checkConditions(prog, registry) → { satisfied: Recipe[], readyFusions: ReadyFusion[] }`.
LevelUpSystem calls this on the level-up tick and, if `readyFusions` is non-empty, guarantees
the first ready fusion's Epic card in slot 0 of the offer. The specific partner that triggered
the condition is carried through so `resolveRecipe` knows which partner to consume.

### Resolution is triggered by applyCard with a fusion card

LevelUpSystem already has the applyCard + recomputePlayerStats path. The extension checks the
card's `isEpicCard` flag: if true, calls `FusionSystem.resolveRecipe(fusionRecipeId, prog)`,
which (1) removes the primary from ownedCards, (2) adds the Epic id to ownedCards with level 1,
(3) calls `markRemnant(partnerItemId)` on the partner, and (4) `recomputePlayerStats` is already
called by the existing applyCard path after any pick.

### Remnant semantics

A remnant is frozen at Lv3: `markRemnant` (already exists in ProgressionState.js) does:
- Set ownedCards[id] = 3 (if currently > 3, clamp down)
- Add the id to remnantIds
- The item keeps its Lv3 stats, still occupies its slot
- cardOffer.cardWeight already excludes remnantIds (weight = 0)
- Epic 12 is a "fusion remnant" concept from Story 10.1; the plumbing is already in place

### 14 Recipes in full (PRD §13.5)

1. Orbit Blade Lv5 + Overcharge Lv3 → Tesla Circuit (partner: single)
2. Spread Cannon Lv5 + Piercing Lance Lv3 → Sunburst (partner: single)
3. Piercing Lance Lv5 + Overcharge Lv3 → Railgun (partner: single)
4. Seeker Drones Lv5 + Nanite Shield Lv3 → Swarm Protocol (partner: single)
5. Mine Layer Lv5 + Gravity Well Lv3 → Singularity Field (partner: single)
6. Ricochet Lv5 + Spread Cannon Lv3 → Kaleidoscope (partner: single)
7. Flak Burst Lv5 + Overcharge Lv3 → Fragmentation Cascade (partner: single)
8. Overcharge Lv5 + any 2 offense Lv5 → Critical Resonance (partner: any-2-offense-lv5)
9. Nanite Shield Lv5 + Afterburner Lv3 → Phase Armor (partner: single)
10. Afterburner Lv5 + Nanite Shield Lv3 → Slipstream (partner: single)
11. Gravity Well Lv5 + Mine Layer Lv3 → Event Horizon (partner: single)
12. Reinforced Hull Lv5 + Bomb Capacitor Lv3 → Revenant (partner: single)
13. Bomb Capacitor Lv5 + Flak Burst Lv3 → Chain Reaction (partner: single)
14. Chrono Field Lv5 + any defense Lv3 → Stasis Lock (partner: any-defense)

### Tests are the main quality gate

Per the codebase convention (Phaser scenes are untestable; pure modules get unit tests), the
acceptance of this story rests on the fusionSystem.test.js suite:
- Recipe registry completeness (14 recipes frozen)
- Condition detection for each partner rule type
- Fusion resolution state mutation (primary → Epic, partner → remnant)
- Generic partner: any-2-offense (Critical Resonance) and any-defense (Stasis Lock)
- Edge cases: multiple ready fusions (first wins), already-remnant partner, Lv5 item not owned
- Integration: LevelUpSystem with fusionSystem → guaranteed Epic card → applyCard → resolution

## Auto Run Result

**Status:** done

**Summary:** Implemented the Fusion Core framework (Story 12.1 / Epic 12): a pure-data sim-side fusion system with frozen recipe registry (14 recipes from PRD §13.5), condition detection across all partner rule types (single, any-2-offense-lv5, any-defense), level-up offer guarantee hook, and fusion resolution that replaces the primary item with its Epic and consumes the partner to a Lv3 remnant.

**Files changed:**
- `src/systems/fusionSystem.js` (NEW) — 14 frozen fusion recipes, checkConditions, resolveRecipe, getReadyFusion, isRecipeReady — pure query module, no Phaser, no mutable state.
- `src/systems/fusionSystem.test.js` (NEW) — 39 tests covering all 4 ACs: registry completeness, condition detection (single/generic partners), fusion resolution, remnant behavior.
- `src/systems/LevelUpSystem.js` (MODIFIED) — fusion guarantee hook: `_checkAndReserveFusionOfferCard()` builds synthetic Epic card when ready, placed in slot 0; cleared on reroll/banish/non-fusion pick; resolved on fusion card pick.
- `src/state/ProgressionState.js` (MODIFIED) — extended applyCard for fusion-epic cards (`isEpicCard` flag → no level bump); added `removeOwnedItem` helper.
- `src/scenes/buildArenaWorld.js` (MODIFIED) — instantiate FusionSystem, thread into LevelUpSystem as 7th param, return fusionSystem.
- `src/systems/levelUpSystem.test.js` (MODIFIED) — 6 new fusion-integration tests: LevelUpSystem + FusionSystem → ready fusion → guaranteed card → applyCard → resolution.

**Verification:** `npm test` → 2139 tests pass (79 files, 0 failures). `npm run build` → production build succeeds (112 modules).

**Review findings:** 0 intent_gap, 0 bad_spec, 0 patch, 0 defer, 0 reject. Clean implementation.

**Follow-up review recommended:** false (0 patches; score = 0).

**Residual risks:**
- Integration tests for FusionSystem use isolated stubs — no assembled-pipeline test of the full level-up loop with a fusion present at runtime (would require setting ownedCards to specific states and driving ticks). This is covered functionally by the unit tests and the `applyCard` → `resolveRecipe` path.
- The `any-2-offense-lv5` rule returns the "last qualifying partner" as the concrete partner — during resolution, only this partner is marked as a remnant. The other qualifying partner(s) remain at Lv5. This behavior aligns with the design that only one partner is "consumed" per fusion, even for generic rules. (Critical Resonance may want both partners consumed, but that is a Story 12. concern.)
