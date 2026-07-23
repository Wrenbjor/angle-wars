# Epic 8 Context: The Level-Up Loop (XP, Curve & Card UI)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build the progression *skeleton* on top of the untouched v1 loop: XP orbs that drop on kill and drift into the ship, a level curve, a time-dilated level-up moment, and a weighted three-card draft with slot limits, reroll, and banish — all proven end-to-end with **placeholder cards** before any real item exists. Enemies dropping XP and the player leveling and drafting a card is the whole deliverable; the cards do nothing yet but stack a debug stat. Critically, this epic plants the **seedable-RNG seam**: all spawn and card-offer randomness routes through one seedable stream from day one, so the daily-run capstone (Epic 15) is additive rather than a rewrite. Progression is strictly additive — a player who dismisses every card still plays the full v1 game unchanged.

## Stories

- Story 8.1: XP Orbs — Drop, Drift & Pickup
- Story 8.2: XP, Level Curve & Leveling
- Story 8.3: The Level-Up Moment & Card UI
- Story 8.4: Weighted Card Offer & Slot Limits
- Story 8.5: Reroll & Banish

## Requirements & Constraints

- **XP orbs:** Enemies drop XP orb(s) on death worth per-type value — Blue Seeker 1, Green Square 2, Pinwheel 2, Snake segment 1 / head 3, Black Hole defused 25, Mirror Reflector center-kill 15. Orbs within the pickup radius drift toward the ship and collect on contact, adding to the run's XP total. Orbs outside the radius persist on the floor (no timeout — the collect-or-abandon tension is the point).
- **Multiplier scaling:** XP credited on pickup is scaled by `× (1 + mult/20)` (10× multiplier → 1.5× XP).
- **Level curve:** `XP_to_next(n) = 8 + 6n + 0.55n²`; remainder carries to the next level. Cap at **level 30** (a full build) — further XP is inert. Most runs die at level 12–18; the ceiling should feel distant. HUD shows current level and progress toward next without occluding critical play space.
- **Level-up moment:** time dilates to **0.15×** (not a hard pause); arena and swarm stay visible and crawling behind the UI; player is invulnerable for the full selection. Exactly three cards; selecting one applies it, closes the UI, and restores normal time. In this epic a picked card applies a debug stat delta and records ownership.
- **Offer weighting:** `weight = base_rarity × (owned?2.2:1.0) × (level_1_of_5?1.0:1.4) × (slots_full && !owned ? 0 : 1) × banish_multiplier`. Draw three without duplicates from the seedable stream. Weighting favors finishing owned builds over starting new ones and favors mid-tier upgrades.
- **Slot limits:** 5 offense, 4 defense. When a track is full, only upgrades to already-owned items in that track are offered — no dead offers for un-ownable new items.
- **Reroll:** starts at 1 per run, +1 at levels 10, 15, 20; a reroll draws a fresh three (respecting weights/slots) and consumes a charge. **Banish:** 2 per run; permanently removes a card from this run's offer pool. When charges are depleted, the action is unavailable and clearly shown as such.
- **Pooling / performance:** orbs come from a pooled system with **zero per-frame allocation** in the hot loop; live orbs respect a pooled cap. (Aligns with the project-wide object-pooling and bounded-live-count constraints.)
- **Determinism:** same seed + same run state yields the same three offered cards (deterministic offers).

## Technical Decisions

- **Single seedable RNG stream (load-bearing).** All spawn *and* card-offer randomness must route through one seedable stream from the very first story. This is the seam the daily-run feature (Epic 15) plugs into later; getting it in now makes that epic additive rather than a rewrite. Do not use ad-hoc `Math.random()` for any gameplay/offer randomness.
- **Additive over v1.** Do not modify movement, firing, bombs, multiplier, or death behavior. XP/leveling/draft are layered on top; the v1 loop must remain playable if every card is dismissed.
- **Placeholder cards this epic.** Cards record ownership and apply a debug stat delta only — the real item/upgrade framework and content arrive in Epic 10. Design the ownership/level/slot state so Epic 10's data-driven registry can replace the placeholders without reworking the draft loop.
- **Pooled orb system** consistent with existing high-churn entity pooling (bullets, enemies, particles): pre-allocated, zero per-frame allocation, hard live-orb cap.
- **Reuse existing seams:** the multiplier value (for XP scaling), the death/kill event that already awards score (as the XP-drop trigger), and the pause/time-scaling machinery (for the 0.15× dilation and invulnerability window).

## UX & Interaction Patterns

- The level-up is a *charged beat, not a jarring stop*: world slows to 0.15× so the swarm keeps crawling behind the card UI — the player sees exactly what they'll be dropped back into. Player is invulnerable and the run clock reflects dilated time while a pick is pending.
- Three cards, one pick; selecting restores normal time immediately.
- Reroll and banish are surfaced as build-shaping tools with visible remaining-charge state; depleted actions read as clearly unavailable.
- XP orbs left on the floor are a deliberate risk/reward signal — chase value into danger or abandon it.

## Cross-Story Dependencies

- **Within the epic (spine-first):** 8.1 (orbs) → 8.2 (curve/leveling) → 8.3 (level-up moment + card UI) → 8.4 (weighted offer + slots) → 8.5 (reroll/banish). The seedable-RNG stream introduced for orb/spawn randomness (8.1) is the same stream 8.4's deterministic offers depend on.
- **Depends on shipped v1 systems:** enemy death/kill events and per-type identity, the score multiplier, the HUD, and the pause/time-scale system.
- **Feeds forward:** Epic 9's adaptive spawn director consumes the same seedable stream; Epic 10 replaces the placeholder cards with the real item/upgrade registry and reads this epic's owned/level/slot/remnant state; Epic 15 (daily runs) builds on the seedable seam.
