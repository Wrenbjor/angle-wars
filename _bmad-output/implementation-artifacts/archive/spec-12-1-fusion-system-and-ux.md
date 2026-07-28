---
title: 'Fusion System & UX'
type: 'feature'
created: '2026-07-27'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'f8263f623c3a278ec5cda69650d69441478b9203'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/prd.md'
warnings: []
---

## Intent

**Problem:** The game has 14 items registered in the fusion tech tree (Epic 11), each with a `fusion.partner` and `fusion.epic` in the item registry. But there is no fusion detection, no HUD badge, no guaranteed Epic card, and no remnant consumption logic. The fusion spine of v2 progression is entirely stubbed.

**Approach:** Add the fusion system as five coordinated changes: (1) a pure-function `checkFusionConditions()` that scans the registry and reports which items are fusion-ready, (2) a HUD badge rendering path in ArenaScene that shows a ⚡ FUSION READY flash when any item is ready, (3) modification of `LevelUpSystem.fixedUpdate()` to guarantee an Epic card when a fusion-ready item is selected, (4) fusion resolution that replaces the Lv5 item with its Epic and downgrades the partner to a Lv3 remnant, and (5) a visual distinction on the level-up overlay card panel for fusion-ready cards (gold border glow).

## Boundaries & Constraints

**Always:**
- Fusion detection must be a pure function `checkFusionConditions(progressionState, registry)` returning `{ itemId, fusion }` or null — no side effects, no rendering logic.
- The Lv3 remnant freeze MUST not change `ownedCards[id]` above `ITEM_REMNANT_LEVEL`. `markRemnant()` from ProgressionState.js handles this.
- The `remnantIds` Set already exists; remnant items are excluded from offers (cardOffer.js already does this).
- FUSION READY badge appears IMMEDIATELY on condition satisfaction, not at the next frame or level-up. It persists until a level-up occurs.
- Each fusion field in the registry uses one of three partner patterns: a specific item id (e.g. `'overcharge'`), `'any-2-offense-lv5'`, or `'any-defense-lv5'`.

**Block If:**
- The exact visual design of the gold card panel / particle aura / audio sting — these are UX decisions deferred to Story 12.2 (proof Epics implement the visuals; 12.1 handles the data + HUD badge trigger).

**Never:**
- Do NOT implement any specific Epic upgrade effect (chain lightning, railgun beam, phase armor intangibility). Those belong to Story 12.2+.
- Do NOT modify the item registry to add new Epic entries. Epic card definitions go in 12.2.
- Do NOT change the card offer weighting algorithm — fusion only affects offer content (guaranteed slot), not the draw weights.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fusion just satisfied | Lv5 item + Lv3 partner → condition met | `checkFusionConditions` returns the fusion entry; `fusionReadyItems` Map updates; HUD shows badge | No error expected |
| No fusions possible | No item at Lv5, or no partner at Lv3+ | `checkFusionConditions` returns null; HUD shows nothing | No error expected |
| Multiple fusions ready | Two different items each satisfy their fusion condition | Both appear in `fusionReadyItems`; HUD shows the badge (single badge, not per-item) | No error expected |
| Partner consumed mid-check | Fusion applied, partner becomes remnant, check re-runs | `checkFusionConditions` no longer returns that fusion (partner is now remnant, `isMaxed` returns false) | Graceful — remnant guards prevent double-consumption |
| Generic partner: any-2-offense-lv5 | Overcharge Lv5 + 2 any offense items Lv5 | Fusion condition satisfied; consuming the 2 offense items (mark both as remnant) | No error expected |
| Any-defense-lv5 pattern | Chrono Field Lv5 + 2 any defense items Lv5 | Fusion condition satisfied | No error expected |
| Card offer when fusion ready | No existing owned-card offer available | Offer includes a guaranteed fusion Epic entry (not drawn from registry pool) | If no eligible fusion, falls through to normal offer |
| Level-up during fusion ready | Player levels up while FUSION READY badge visible | Card offer shows a guaranteed fusion card at slot 0; selecting it triggers fusion resolution | No error expected |

## Code Map

- `src/config/itemRegistry.js` -- Each item entry has `fusion: { partner, epic }`. 13 of 14 items have fusion defined (Reinforced Hull missing). Shape is already frozen; 12.1 reads it.
- `src/state/ProgressionState.js` -- `remnantIds`, `markRemnant()`, `getLevel()`, `isMaxed()`, `isRemnant()`, `isOwned()`. No `fusionReadyItems` field yet.
- `src/systems/LevelUpSystem.js` -- `fixedUpdate()` applies card picks, builds `currentOffer`. Must be augmented to guarantee fusion Epic cards and resolve fusion on selection.
- `src/systems/cardOffer.js` -- `drawCardOffer()` weighted draw. Must be aware that a fusion-ready card takes a guaranteed slot (not drawn).
- `src/scenes/ArenaScene.js:1719` -- HUD render loop showing score/multiplier/etc. Must add fusion-ready badge output.
- `src/scenes/ArenaScene.js:1793` -- Level-up overlay construction. Cards drawn in a loop; the fusion card should be visually distinct on the overlay (but actual gold card rendering deferred to 12.2).
- `src/config/constants.js:1462` -- `ITEM_REMNANT_LEVEL = 3`. Already defined.
- `src/config/constants.js:1879-1883` -- HUD styling constants. Need to add FUSION badge color/style constants.

## Tasks & Acceptance

**Execution:**

- `src/state/ProgressionState.js` -- Add `fusionReadyItems` Map tracking `{ itemId: fusion }` entries; export `setFusionReady()` / `clearFusionReady()` / `hasFusionReady()` helpers.
- `src/state/ProgressionState.js` -- Export `checkFusionConditions(progressionState, registry)` pure function that iterates all registry entries, checks if `item.fusion` exists, then validates the partner requirement (specific id, any-2-offense-lv5, any-defense-lv5), returning null or the matching fusion entry.
- `src/systems/LevelUpSystem.js:231` -- After a card is applied (step 1, line ~231) and pending-- (line 251), call `checkFusionConditions(progressionState, registry)` and update the fusion-ready state via `setFusionReady() / clearFusionReady()`.
- `src/systems/LevelUpSystem.js:341` -- In the offer rebuild path (step 3), if a fusion is ready, build a fusion Epic card entry (a synthetic `{ id: '<epic-name>', title: '<Epic Name>', fusion: true }`) that takes slot 0 of the offer. Otherwise fall through to the normal draw.
- `src/systems/LevelUpSystem.js:231-267` -- When the resolved card is a fusion Epic card (has `fusion: true`), execute fusion resolution: replace the source item with its Epic name in `ownedCards`, call `markRemnant(progressionState, partnerId)` on the fusion partner, then clear fusion-ready state. Do NOT apply the card via `applyCard()` — fusion replaces/remnant does the work directly.
- `src/scenes/ArenaScene.js:1719` -- Add FUSION READY badge rendering in the HUD loop: a text element reading `⚡ FUSION READY` shown whenever `progressionState.hasFusionReady()` is true. Use `COLOR_FUSION_TEXT` (new constant, e.g. `#ffff00`) at `HUD_FONT` size, positioned beside or below the existing HUD text.
- `src/config/constants.js` -- Add `COLOR_FUSION_TEXT = '#ffff00'` (bright gold/yellow), `FUSION_BADGE_TEXT` or derive dynamically, and a `FUSION_READY_PULSE_INTERVAL_MS` constant.
- `src/config/itemRegistry.js` -- Add `fusion: { partner: 'bomb-capacitor', epic: 'revenant' }` to Reinforced Hull entry (currently missing). Also add `fusion: { partner: 'any-defense-lv5', epic: 'stasis-lock' }` to Chrono Field entry (currently missing).

**Acceptance Criteria:**

- `checkFusionConditions()` returns the correct fusion entry when an item is Lv5 and its partner is Lv3+, and returns null otherwise
- `checkFusionConditions()` correctly handles the `'any-2-offense-lv5'` pattern (any 2 offense items at Lv5 satisfy) and `'any-defense-lv5'` pattern
- `fusionReadyItems` is populated/updated when conditions change, and cleared after a fusion card is selected
- When a fusion is ready and the player levels up, the card offer contains a guaranteed fusion Epic card at slot 0
- Selecting a fusion Epic card replaces the Lv5 item in `ownedCards` with the Epic name, marks the partner as a remnant, decrements `pendingSelections`, and rebuilds the offer (or drains if no picks remain)
- The partner is correctly marked as a Lv3 remnant: its level is clamped to `ITEM_REMNANT_LEVEL`, and it is added to `remnantIds`
- A remnant item is never re-offered in subsequent level-ups (verified by existing cardOffer exclusion logic)
- The HUD renders the ⚡ FUSION READY badge whenever any fusion is ready
- When no fusions are ready, the badge does not render (hidden, not shown as empty)
- Double-consumption guard: applying a fusion does not attempt to remnant an already-remnant partner

## Spec Change Log

## Review Triage Log

## Design Notes

### Fusion data flow
```
LevelUpSystem fixedUpdate():
  (1) consume latched card selection
  (2) if card was a normal item → applyCard → recomputePlayerStats
  (3) if card was a fusion Epic card → resolveFusion() instead:
      a. Replace source item: progressionState.ownedCards[sourceItemId] = epicId
      b. Mark partner as remnant: markRemnant(progressionState, partnerId)
      c. Clear any fusion-ready state
  (4) drain pendingSelections
  (5) rebuild offer (or auto-drain if queue empty)
```

### checkFusionConditions signature
```
checkFusionConditions({
  ownedCards: Object<string, number>,   // id → level
  remnantIds: Set<string>,              // frozen items
  registry: ReadonlyArray<ItemDef>
}): { itemId: string, fusion: { partner: string, epic: string } } | null
```

### The fusion-ready state
The fusion-ready state lives in `ProgressionState.fusionReadyItems: Map<string, { itemId, fusion }>`. It maps `epicName` → `{ itemId, fusion }`. There are two public queries:
- `hasFusionReady(state)` → boolean (used by HUD badge rendering)
- `getFusionReadyEpic(state)` → `{ itemId, fusion }` entry (used by offer generation and resolution)

There should be a single canonical `checkFusionConditions()` call site — either invoked from the ArenaScene render loop (after each frame's HUD rebuild) or from LevelUpSystem on every post-pick tick. The safest spot is the LevelUpSystem `fixedUpdate()` call site, since all fusion-relevant state changes flow through it. The HUD badge should read from `hasFusionReady()` and not trigger its own check, to avoid double-rendering and ensure state is always in sync.

### Partner consumption for generic patterns
For `any-2-offense-lv5`: the fusion check identifies ANY 2 offense items at Lv5 as the partner. When resolved, BOTH are marked as remnant. For `any-defense-lv5`: same pattern with defense items. For a specific partner id: only that specific item is remnanted.

### Synthetic Epic cards
The fusion Epic card offered during level-up is a synthetic object (not from the registry), structured as:
```
{ id: 'tesla-circuit', title: 'Tesla Circuit', fusion: true, epicName: 'Tesla Circuit', sourceItem: 'orbit-blade', partnerItem: 'overcharge' }
```

## Verification

**Commands:**
- `npx eslint src/` -- expected: no lint errors
- `node --experimental-vm-modules node_modules/.bin/jest --testPathPattern="ProgressionState|LevelUpSystem" --no-coverage` -- expected: all tests pass

**Manual checks:**
- In-game: level an item to Lv5 while its partner is Lv3+, verify ⚡ FUSION READY badge appears on HUD
- Level up after fusion-ready, verify fusion Epic card appears at slot 0 with distinctive styling (gold border at minimum)
- Select fusion card, verify source item name changes to Epic name on subsequent HUD, partner is frozen at Lv3, partner never appears in offer again
- Verify `remnantIds` contains the correct partner id after fusion
