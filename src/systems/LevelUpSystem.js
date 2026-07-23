import { System } from '../core/System.js';
import { PLACEHOLDER_CARDS } from '../config/cards.js';
import {
  LEVELUP_INVULN_FLOOR,
  LEVELUP_LANDING_INVULN_MS,
} from '../config/constants.js';
import { applyCard } from '../state/ProgressionState.js';
import { drawCardOffer } from './cardOffer.js';

// LevelUpSystem — the sim-side state machine of the Epic 8 level-up moment (Story 8.3,
// Phaser-free).
//
// Story 8.2's LevelSystem exposed `levelsGainedThisTick` (≥1 on a crossing tick) but
// did nothing with it. This system is that seam's first consumer: it edge-detects the
// level-up, enqueues one OWED selection per level crossed (a multi-level jump owes
// multiple picks, drained one card at a time), holds the player invulnerable while any
// selection is pending, and offers a fixed placeholder trio the render loop draws.
//
// It runs AFTER LevelSystem (so it reads THIS tick's levelsGainedThisTick) and BEFORE
// PlayerDeathSystem (so topping invulnMs up gates death the same tick, reusing the
// existing i-frame gate — no death/collision edit, no new PlayerState field). It is
// strictly additive: it reads levelSystem.levelsGainedThisTick + playerState.invulnMs,
// and writes only pendingSelections / currentOffer / playerState.invulnMs / (on a pick)
// progressionState. On each offer (re)build it performs Story 8.4's deterministic
// weighted-without-replacement draw (drawCardOffer) through the injected `_rng` stream
// — favoring owned builds / mid-tier upgrades and honoring per-track slot limits —
// instead of the old fixed placeholder trio.
//
// The choice is LATCHED, not applied directly: the overlay (render loop) calls
// queueSelection(index); fixedUpdate consumes the latch and applies the card — mirroring
// the InputState bomb latch, keeping all state mutation deterministic and inside the tick
// so the whole machine is unit-testable via plain ticks. Pending is a COUNT (not a bool)
// so a multi-level jump — or an orb collected mid-slow-mo that crosses another threshold
// — owes multiple picks.
//
// Zero steady-state allocation on the idle path: when nothing is pending, fixedUpdate
// touches no allocation (currentOffer is only (re)built on a crossing/post-pick tick,
// never every tick).
export class LevelUpSystem extends System {
  /**
   * @param {{levelsGainedThisTick:number}} levelSystem The Story 8.2 leveling spine —
   *   read-only here for its per-tick level-crossing delta (the edge-detect seam).
   * @param {{invulnMs:number}} playerState Shared player lifecycle state — its invuln
   *   window is re-armed each pending tick (reusing PlayerDeathSystem's i-frame gate).
   * @param {{ownedCards:Object<string,number>, debugStat:number}} progressionState
   *   Shared run-scoped card progression — a selection applies its card here, and its
   *   ownership drives the weighted offer draw.
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for the weighted
   *   offer draw (Story 8.4). Threaded from buildArenaWorld so the offer routes through
   *   the SAME seedable stream the spawn systems use; injectable so the draw is
   *   deterministic and unit-testable.
   */
  constructor(levelSystem, playerState, progressionState, rng = Math.random) {
    super();
    this.levelSystem = levelSystem;
    this.playerState = playerState;
    this.progressionState = progressionState;
    this._rng = rng;
    // Number of owed selections not yet drained (a COUNT, not a bool).
    this.pendingSelections = 0;
    // The three cards currently offered (empty while none pending), rebuilt by the
    // Story 8.4 weighted draw on each crossing/post-pick tick.
    this.currentOffer = [];
    // One-slot choice latch (mirrors the bomb latch): the overlay writes an index;
    // fixedUpdate reads-and-clears it. null = no choice queued.
    this._queuedChoice = null;
  }

  /**
   * True while one or more selections are pending — the overlay is open, time is
   * dilated, and the player is held invulnerable. Derived from the pending count.
   */
  get selectionActive() {
    return this.pendingSelections > 0;
  }

  /**
   * Latch a card selection from the overlay (render loop). Idempotent within a
   * fixed-step window: only the FIRST call before the next fixedUpdate is honored
   * (mirrors the bomb latch), so multiple confirm edges in one frame yield one pick.
   * @param {number} index The chosen card index (0..2).
   */
  queueSelection(index) {
    if (this._queuedChoice === null) this._queuedChoice = index;
  }

  /**
   * Advance one fixed step: (1) consume any latched choice and apply the card,
   * (2) edge-detect this tick's level crossings and enqueue owed picks, (3) while
   * pending, (re)build the offer if needed and re-arm the invuln floor.
   */
  fixedUpdate() {
    // (1) Consume the latched choice (read-and-clear). Apply it ONLY when a
    // selection is actually pending, an offer of three is present, and the index is
    // a valid slot — otherwise it is a guarded no-op (invalid index / none pending),
    // no throw. A valid pick applies the card, drains one owed selection, and clears
    // the offer so step (3) rebuilds a fresh three if more remain.
    if (this._queuedChoice !== null) {
      const index = this._queuedChoice;
      this._queuedChoice = null;
      if (
        this.pendingSelections > 0 &&
        this.currentOffer.length === 3 &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < 3
      ) {
        applyCard(this.progressionState, this.currentOffer[index]);
        this.pendingSelections--;
        this.currentOffer = [];
        // When this pick empties the queue, grant a longer LANDING invulnerability so
        // the ship — held stationary while the swarm crawled onto it during the
        // selection — gets a fair escape window on drop-back to full speed (not just
        // the thin per-tick floor). If more picks remain, step (3) keeps re-arming the
        // floor as usual. A same-tick fresh level crossing (step 2) only re-adds to the
        // queue; the higher landing value survives its floor top-up. Take the MAX with
        // the current window so a larger invuln already in flight (e.g. a fresh
        // PLAYER_INVULN_MS respawn shield mid-run) is never shrunk by the landing grant.
        if (this.pendingSelections === 0) {
          this.playerState.invulnMs = Math.max(
            this.playerState.invulnMs,
            LEVELUP_LANDING_INVULN_MS,
          );
        }
      }
    }

    // (2) Edge-detect the level-up: enqueue exactly the number of levels crossed on
    // THIS tick (0 on a non-crossing tick, so no re-enqueue after the crossing).
    if (this.levelSystem.levelsGainedThisTick > 0) {
      this.pendingSelections += this.levelSystem.levelsGainedThisTick;
    }

    // (3) While a selection is pending: (re)build the offer when it is empty (the
    // crossing tick or a post-pick tick with more owed), and top the invuln window
    // up to the floor so the player is unhittable for the whole (indefinite)
    // selection — reusing the existing PlayerDeathSystem i-frame gate. When nothing
    // is pending, clear the offer (overlay closed, time restored).
    if (this.pendingSelections > 0) {
      if (this.currentOffer.length === 0) {
        // Story 8.4: a fresh weighted-without-replacement draw through the injected
        // `_rng`, reflecting the just-updated ownership (a post-pick tick of a
        // multi-level jump re-draws against the newly owned card). Returns a NEW array
        // per call, preserving the 8.3 freshOffer focus-reset (keyed on array identity).
        this.currentOffer = drawCardOffer({
          pool: PLACEHOLDER_CARDS,
          progressionState: this.progressionState,
          rng: this._rng,
        });
      }
      if (this.playerState.invulnMs < LEVELUP_INVULN_FLOOR) {
        this.playerState.invulnMs = LEVELUP_INVULN_FLOOR;
      }
    } else {
      this.currentOffer = [];
    }
  }
}
