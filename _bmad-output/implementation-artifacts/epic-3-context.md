# Epic 3 Context: Score, Multiplier, Bombs & Lives

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic implements the Retro Evolved economy that turns a competent twin-stick shooter into Geometry Wars: the score multiplier that climbs to 10x by killing without dying and is wiped back to 1x the instant the player dies, screen-clearing smart bombs, extra lives earned at score thresholds, and a high score that persists across sessions. It matters because the multiplier-reset-on-death loop is the non-negotiable soul of the game and the single biggest RE1-vs-RE2 distinction — this is where every prior system (kills, death, scoring, HUD) is wired into the risk/reward tension that makes dying at 10x actually hurt.

## Stories

- Story 3.1: Score Multiplier System
- Story 3.2: Smart Bombs
- Story 3.3: Extra Lives
- Story 3.4: Persistent High Score

## Requirements & Constraints

- Score per kill = enemy base value x current multiplier. Base per-type values were introduced earlier; this epic layers the multiplier onto every award.
- The multiplier increments on kills up to a hard cap of 10x, is shown on the HUD, and resets to 1x immediately on player death. This reset is the core design tension and must be felt, not just tracked.
- Smart bombs start at 3, are shown on the HUD, and each detonation destroys all on-screen enemies with an expanding shockwave and decrements the count by one. One additional bomb is awarded each time score crosses a multiple of 100,000.
- Extra lives are awarded when score crosses defined thresholds, with the HUD updating on award. Life count must stay consistent with the death/respawn system already in place, and reaching 0 lives still ends the game.
- On a finished run, if the final score beats the stored high score, the new value is written to local storage; the displayed high score reflects the persisted value across page reloads.
- Exact numeric tuning — score weights per enemy, multiplier step, life thresholds, bomb-award cadence beyond the 100k rule — starts from RE1 references and is tuned post-launch. Centralize these as tunable constants; never scatter magic numbers inline.

## Technical Decisions

- Engine: Phaser 3 (WebGL renderer); all high-churn entities remain pooled with zero per-frame allocation in the hot loop.
- Scoring, multiplier, bomb count, and lives are game-run state that should live in a scoring/economy system rather than being spread across entity code, so the death handler can reset the multiplier and the score handler can trigger bomb/life threshold awards from one place.
- Threshold-crossing awards (bombs at every 100k, extra lives at defined thresholds) must be detected on score change by comparing previous vs new totals so each boundary fires exactly once, even when a single kill jumps the score past a threshold.
- Persistence uses localStorage (the same mechanism reserved for settings); the high score is the only value persisted in this epic. Read on load, write on game over when beaten.
- The multiplier reset hooks into the existing player-death event; the smart-bomb screen clear reuses the existing enemy pool/destruction path (award score/multiplier consistently with normal kills per RE1 behavior as tuned).

## Cross-Story Dependencies

- Builds directly on Epic 1: the score/HUD, per-type base score values, the kill/scoring path, and the player death + lives + game-over flow. The multiplier, bomb, and life counters extend the existing HUD.
- Depends on Epic 2's enemy roster and spawn director being in place so there is a real, escalating stream of kills to drive the multiplier and score thresholds.
- Story 3.1 (multiplier) is foundational to 3.2 and 3.3 in that all three consume the running score total and hook the death event; the multiplier reset and the smart-bomb clear both interact with the death and enemy-destruction paths.
- Smart-bomb detonation currently uses placeholder feedback; the shockwave/screen-shake juice for it is delivered later in Epic 4. High-score display also surfaces on the title and game-over screens finalized in Epic 5.
