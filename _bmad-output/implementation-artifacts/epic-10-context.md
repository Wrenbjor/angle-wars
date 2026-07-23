# Epic 10 Context: Core Arsenal — Stat-Stackers

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic ships the first four real arsenal items — Overcharge, Spread Cannon, Nanite Shield, and Afterburner — at all five levels, replacing the placeholder cards from the level-up draft (Epic 8). Just as important, it lays the reusable data-driven item/upgrade framework (registry, per-level effect application, owned-state, slot occupancy, and Lv3-remnant state) that Epics 11 and 12 build on. These four items are chosen first deliberately: each stacks numbers onto seams that already exist in the shipped v1 core (global damage/fire-rate, the firing seam, a shield on the death/collision path, and the movement seam) with no new entity systems required. The point is to prove that stat-stacking feels good and the draft loop is fun before any exotic behavior or pooled-entity systems are written.

## Stories

- Story 10.1: Item & Upgrade Framework
- Story 10.2: Overcharge
- Story 10.3: Spread Cannon
- Story 10.4: Nanite Shield
- Story 10.5: Afterburner

## Requirements & Constraints

- A single item definition is the source of truth for each item: track (offense/defense), base rarity weight, five per-level effects, and its fusion partner + Epic. The card offer, on-pick application, owned-state, and current level must all read from that one definition — adding items should be content, not new plumbing.
- Upgrading an owned item (via a picked card) increments its level and applies that level's effect delta through the relevant gameplay system. No per-frame allocation may be introduced in the hot loop.
- The framework must track and expose per-item state — owned, current level, maxed (Lv5), and reduced-to-Lv3-remnant — to both the card-offer weighting and the fusion checks. The remnant state (a maxed item consumed by a fusion, frozen at Lv3 stats and no longer upgradable) is consumed by Epic 12 but the plumbing lands here.
- Slot limits: 5 offense weapons, 4 defense items. Once a track is full, only upgrades to already-owned items in that track are offered (no dead offers for un-ownable new items). The offer weight formula already in place is `base_rarity × (owned?2.2:1.0) × (level_1_of_5?1.0:1.4) × (slots_full && !owned ? 0 : 1) × banish_multiplier`.
- Overcharge occupies an offense slot and is the common fusion key (feeds three Epics); it behaves as a normal offense item using its base rarity weight. Its levels apply globally to the player's fire: +15% dmg → +25% dmg/+10% rate → +35%/+20% → +45%/+30% → +60%/+40%.
- Spread Cannon is the base-weapon evolution and must obey the always-offered-by-Lv3 rule: if the player has not evolved the base weapon by ~run level 3, Spread Cannon Lv1 is offered. Its levels fire through the existing firing seam: 3-way/12° → 5-way/16° → +30% fire rate → 7-way/22° → 9-way/+35% dmg.
- Nanite Shield integrates with the v1 death/collision path — a shielded hit consumes a charge instead of costing a life. Levels: absorb 1 hit/20s recharge → 15s → 2 charges → 10s → 3 charges + a knockback pulse that pushes nearby enemies back when the final charge breaks at Lv5.
- Afterburner feeds the existing movement seam. Levels: +12% speed → +20% + a dash on button (3s cd) → +25% + dash i-frames → 2s cd + dash damages on contact → +35% + a burning dash trail. At Lv3+ the dash i-frames prevent death during the dash window; at Lv4+ the dash damages enemies it passes through.
- The framework/architecture must be clean and extensible enough that later arsenal and fusion work bolts on without a rewrite.

## Technical Decisions

- Data-driven registry pattern: items are declarative definitions, and the draft/upgrade/fusion systems all consume the same registry. This is the shared plumbing that Epics 11–12 extend with content only.
- Effect application flows through existing v1 gameplay seams rather than new systems: global fire modifiers (Overcharge), the firing seam (Spread Cannon, twin-stick auto-fire cadence), the death/collision + lives path (Nanite Shield), and the twin-stick movement seam (Afterburner). No new pooled-entity systems are introduced in this epic.
- Zero per-frame allocation constraint applies to effect application and upgrades — recompute or cache derived stats on level change, not every frame.
- Slot occupancy and remnant state are first-class in the framework and are read by the offer weighting and (forward-looking) fusion checks; this epic wires the state even though fusion consumption itself lands in Epic 12.

## UX & Interaction Patterns

- These items surface through the existing level-up draft: time dilates to 0.15× (not a hard pause), the arena stays visible and crawling behind the card UI, the player is invulnerable during selection, and three weighted cards are offered — pick one. This epic replaces the placeholder cards with real item cards.
- The always-offered-by-Lv3 guarantee for Spread Cannon is a deliberate onboarding beat — the base weapon reliably evolves early so a run's default firing scales into the mid-game.

## Cross-Story Dependencies

- Story 10.1 (framework) is the foundation for 10.2–10.5; the four item stories register into and apply through it.
- Depends on Epic 8: the card-offer/draft system, weighted offer logic, slot limits, and reroll/banish already exist; this epic swaps placeholder cards for real definitions and reads the Story 8.4 offer path.
- Forward dependency: the registry, owned/maxed/remnant state, and slot occupancy laid here are the substrate for Epic 11 (exotic items + new pooled-entity systems) and Epic 12 (the fusion tech tree, which consumes maxed items into Lv3 remnants and reads fusion partner/Epic data from these same definitions).
