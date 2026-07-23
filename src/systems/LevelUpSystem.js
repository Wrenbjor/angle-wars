import { System } from '../core/System.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import {
  LEVELUP_INVULN_FLOOR,
  LEVELUP_LANDING_INVULN_MS,
  REROLL_LEVEL_GRANTS,
} from '../config/constants.js';
import { applyCard } from '../state/ProgressionState.js';
import { recomputePlayerStats } from '../state/PlayerStats.js';
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
// Story 10.3: that offer can now contain a GUARANTEED card. The draw is passed this
// system's current run level (`levelSystem.level`), and an unowned item whose definition
// carries `guaranteeFromLevel <= level` is reserved a slot before the weighted loop runs
// — PRD §13.3's "Spread Cannon is always offered by Lv3". It consumes no rng() and is
// subordinate to every exclusion, so a banished/maxed/remnant/slot-full card is still
// never offered and an offer may still be SHORT.
//
// The choice is LATCHED, not applied directly: the overlay (render loop) calls
// queueSelection(index); fixedUpdate consumes the latch and applies the card — mirroring
// the InputState bomb latch, keeping all state mutation deterministic and inside the tick
// so the whole machine is unit-testable via plain ticks. Pending is a COUNT (not a bool)
// so a multi-level jump — or an orb collected mid-slow-mo that crosses another threshold
// — owes multiple picks.
//
// Story 8.5 layers two more latched build-shaping tools onto the same idiom, consumed in
// fixedUpdate AFTER the pick and BEFORE the level-cross edge-detect:
//   - queueReroll()      : while a 3-card selection is active and progressionState has a
//     reroll charge, spend one and clear currentOffer so step (3) redraws a fresh weighted
//     trio (same rng stream, weights/slots/banished honored). pendingSelections is
//     unchanged — the same pick is still owed, the player still invulnerable. At 0 charges
//     it is a guarded no-op that spends nothing.
//   - queueBanish(index) : while a 3-card selection is active, the index is a valid slot,
//     and a banish charge remains, add currentOffer[index].id to progressionState.banishedIds,
//     spend one charge, and clear currentOffer so the redraw EXCLUDES the banished id (its
//     8.4 weight zeroes). A banished id never appears in any offer again this run. At 0
//     charges / an invalid index it is a guarded no-op.
// Additionally, on a level-crossing tick, +1 reroll charge is granted for each
// REROLL_LEVEL_GRANTS threshold the tick crosses INTO (multi-level-jump-safe via
// prevLevel = level - levelsGainedThisTick). Consumption order: pick → reroll → banish →
// level-cross grant/enqueue → offer rebuild + invuln re-arm. Because reroll/banish require
// a 3-card offer, a same-tick pick (which empties the offer) makes them no-op that tick.
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
   * @param {{ownedCards:Object<string,number>, debugStat:number,
   *   rerollCharges:number, banishCharges:number, banishedIds:Set<string>}} progressionState
   *   Shared run-scoped card progression — a selection applies its card here, its
   *   ownership drives the weighted offer draw, and (Story 8.5) its reroll/banish charges
   *   and banished-id set drive the reroll/banish tools + grants.
   * @param {ReadonlyArray<{ id:string, rarity:number, track:string, maxLevel:number }>} [registry=ITEM_REGISTRY]
   *   The item registry the offer draws from (Story 10.1) — the ONE definition source
   *   the offer/application/owned-state/level all read. Injectable so tests can drive a
   *   synthetic pool; defaults to the shipped ITEM_REGISTRY.
   * @param {Object<string, number>} [playerStats] The runtime modifier store recomputed
   *   after each pick via the PlayerStats fold (Story 10.1). Optional so the pre-10.1
   *   test stubs that omit it still run (the fold is skipped when absent).
   * @param {() => number} [rng=Math.random] Injectable RNG in [0,1) for the weighted
   *   offer draw (Story 8.4). Threaded from buildArenaWorld so the offer routes through
   *   the SAME seedable stream the spawn systems use; injectable so the draw is
   *   deterministic and unit-testable.
   */
  constructor(
    levelSystem,
    playerState,
    progressionState,
    registry = ITEM_REGISTRY,
    playerStats = null,
    rng = Math.random,
  ) {
    super();
    // Story 10.1 inserted `registry` (and `playerStats`) at positional slots 4/5 — slot 4
    // is where `rng` used to live. A stale caller threading its rng here would make
    // `pool.length` undefined, so every draw returns an EMPTY offer and the empty-offer
    // auto-drain would silently swallow every owed pick for the whole run — no throw, no
    // visible failure. Fail loudly at construction instead.
    if (!Array.isArray(registry)) {
      throw new TypeError(
        'LevelUpSystem: `registry` (arg 4) must be an array of item definitions — ' +
          'note that `rng` moved to arg 6 in Story 10.1.',
      );
    }
    // Same trap one slot over: a caller that threaded `rng` at arg 5 would pass the
    // check above (registry is fine) and bind its rng to `playerStats`, leaving `rng`
    // defaulted to Math.random — the offer silently leaves the SEEDABLE stream and the
    // fold writes stat fields onto the rng function, with nothing thrown. `playerStats`
    // is a plain object or absent; a function is never valid here.
    if (playerStats != null && typeof playerStats !== 'object') {
      throw new TypeError(
        'LevelUpSystem: `playerStats` (arg 5) must be a PlayerStats object or omitted — ' +
          'note that `rng` moved to arg 6 in Story 10.1.',
      );
    }
    this.levelSystem = levelSystem;
    this.playerState = playerState;
    this.progressionState = progressionState;
    this.registry = registry;
    this.playerStats = playerStats;
    this._rng = rng;
    // Number of owed selections not yet drained (a COUNT, not a bool).
    this.pendingSelections = 0;
    // The three cards currently offered (empty while none pending), rebuilt by the
    // Story 8.4 weighted draw on each crossing/post-pick tick.
    this.currentOffer = [];
    // One-slot choice latch (mirrors the bomb latch): the overlay writes an index;
    // fixedUpdate reads-and-clears it. null = no choice queued.
    this._queuedChoice = null;
    // Story 10.3: one-shot "skip the offer guarantee on the NEXT rebuild", raised when a
    // PAID reroll is consumed and cleared by the rebuild that reads it — so a spent
    // charge can actually replace the guaranteed card instead of redrawing around it.
    this._suppressGuaranteeOnce = false;
    // Story 8.5 one-slot latches (same read-and-cleared-in-the-tick idiom):
    //  - _queuedReroll : a boolean flag set by queueReroll(), consumed once per tick.
    //  - _queuedBanish : the slot index set by queueBanish(index), or null when none.
    this._queuedReroll = false;
    this._queuedBanish = null;
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
   * Latch a reroll request from the overlay (Story 8.5). One-slot, like the choice
   * latch: only the FIRST call before the next fixedUpdate is honored (multiple
   * presses in one frame yield one reroll). fixedUpdate reads-and-clears it and, if a
   * charge is available while a 3-card selection is active, spends it and redraws the
   * trio; otherwise it is a guarded no-op that spends nothing.
   */
  queueReroll() {
    this._queuedReroll = true;
  }

  /**
   * Latch a banish request for the card at `index` from the overlay (Story 8.5).
   * One-slot: only the FIRST call before the next fixedUpdate is honored. fixedUpdate
   * reads-and-clears it and, if a charge is available while a 3-card selection is
   * active and the index is a valid slot, banishes that card's id and redraws the trio
   * excluding it; otherwise it is a guarded no-op that spends nothing.
   * @param {number} index The focused card index (0..2).
   */
  queueBanish(index) {
    if (this._queuedBanish === null) this._queuedBanish = index;
  }

  /**
   * Advance one fixed step: (1) consume any latched choice and apply the card,
   * (1b) consume a latched reroll then a latched banish (Story 8.5) — each guarded on
   * an active 3-card offer + a positive matching charge, clearing currentOffer for the
   * step-(3) rebuild, (2) edge-detect this tick's level crossings, grant reroll charges
   * for each threshold crossed, and enqueue owed picks, (3) while pending, (re)build the
   * offer if needed and re-arm the invuln floor.
   */
  fixedUpdate() {
    // (1) Consume the latched choice (read-and-clear). Apply it ONLY when a
    // selection is actually pending, a non-empty offer is present (Story 10.1: the
    // offer is variable length, 1..CARD_OFFER_SIZE), and the index is a valid slot
    // within it — otherwise a guarded no-op (invalid index / none pending), no throw.
    // A valid pick applies the card (re-folding PlayerStats), drains one owed
    // selection, and clears the offer so step (3) rebuilds if more remain.
    if (this._queuedChoice !== null) {
      const index = this._queuedChoice;
      this._queuedChoice = null;
      if (
        this.pendingSelections > 0 &&
        this.currentOffer.length >= 1 &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < this.currentOffer.length
      ) {
        applyCard(this.progressionState, this.currentOffer[index]);
        // Story 10.1: re-fold the runtime modifier store from the (now-updated) owned
        // set — the ONLY place the fold runs (on a level change, never per frame).
        if (this.playerStats) {
          recomputePlayerStats(
            this.playerStats,
            this.progressionState.ownedCards,
            this.registry,
          );
        }
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

    // (1b) Consume the reroll latch, then the banish latch (Story 8.5), in that order.
    // Both read-and-clear their latch and are honored ONLY while a selection is active,
    // a NON-EMPTY offer is present (Story 10.1: variable length, not necessarily 3), and
    // the matching charge is positive (a banish also requires a valid slot index within
    // the offer) — otherwise a guarded no-op that spends no charge and does not throw. On
    // success each clears currentOffer so step (3) redraws a fresh weighted offer
    // (reroll: respecting weights/slots/banished; banish: also excluding the
    // just-banished id). pendingSelections is left unchanged: the same pick is still owed
    // and the player stays invulnerable. Because both require a non-empty offer, a
    // same-tick pick above (which empties the offer) makes them no-op this tick.
    if (this._queuedReroll) {
      this._queuedReroll = false;
      if (
        this.selectionActive &&
        this.currentOffer.length >= 1 &&
        this.progressionState.rerollCharges > 0
      ) {
        this.progressionState.rerollCharges--;
        this.currentOffer = [];
        // Story 10.3: a PAID reroll suppresses the offer guarantee for the redraw it
        // triggers. Without this the reservation deterministically refills slot 0 with
        // the same guaranteed card, so from run level 3 onward with Spread Cannon
        // unowned the player spends a charge and only 2 of 3 slots actually reroll —
        // with banish as the sole way out. The flag is ONE-SHOT: the very next offer
        // rebuild consumes it, so the guarantee returns on the following rebuild (the
        // next level-up, or a post-pick rebuild) while the item stays unowned. "Always
        // offered by Lv3" is therefore unaffected; only the paid redraw is exempt.
        this._suppressGuaranteeOnce = true;
      }
    }
    if (this._queuedBanish !== null) {
      const index = this._queuedBanish;
      this._queuedBanish = null;
      if (
        this.selectionActive &&
        this.currentOffer.length >= 1 &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < this.currentOffer.length &&
        this.progressionState.banishCharges > 0
      ) {
        this.progressionState.banishedIds.add(this.currentOffer[index].id);
        this.progressionState.banishCharges--;
        this.currentOffer = [];
      }
    }

    // (2) Edge-detect the level-up: enqueue exactly the number of levels crossed on
    // THIS tick (0 on a non-crossing tick, so no re-enqueue after the crossing), and
    // (Story 8.5) grant +1 reroll charge for each REROLL_LEVEL_GRANTS threshold the tick
    // crosses INTO. prevLevel = level - levelsGainedThisTick; a threshold T is crossed
    // this tick iff prevLevel < T <= level — correct for a multi-level jump spanning
    // several thresholds, firing exactly once each (level is monotonic, no re-cross).
    if (this.levelSystem.levelsGainedThisTick > 0) {
      const prevLevel =
        this.levelSystem.level - this.levelSystem.levelsGainedThisTick;
      for (let i = 0; i < REROLL_LEVEL_GRANTS.length; i++) {
        const T = REROLL_LEVEL_GRANTS[i];
        if (prevLevel < T && T <= this.levelSystem.level) {
          this.progressionState.rerollCharges++;
        }
      }
      this.pendingSelections += this.levelSystem.levelsGainedThisTick;
    }

    // (3) While a selection is pending: (re)build the offer when it is empty (the
    // crossing tick or a post-pick tick with more owed), and top the invuln window
    // up to the floor so the player is unhittable for the whole (indefinite)
    // selection — reusing the existing PlayerDeathSystem i-frame gate. When nothing
    // is pending, clear the offer (overlay closed, time restored).
    if (this.pendingSelections > 0) {
      if (this.currentOffer.length === 0) {
        // Story 8.4/10.1: a fresh weighted-without-replacement draw through the injected
        // `_rng` from the injected registry, reflecting the just-updated ownership (a
        // post-pick tick of a multi-level jump re-draws against the newly owned card).
        // Returns a NEW array per call, preserving the 8.3 freshOffer focus-reset (keyed
        // on array identity). The offer is VARIABLE LENGTH (0..CARD_OFFER_SIZE): only
        // eligible cards, no excluded card padded in (Story 10.1 exclusion purity).
        // Story 10.3: the CURRENT run level drives the offer guarantee — an unowned,
        // otherwise-eligible item whose `guaranteeFromLevel` the run has reached is
        // reserved a slot before the weighted draw (no rng consumed). Read live off the
        // level spine, so the guarantee holds on every rebuild from the threshold
        // onward, not only on the crossing tick.
        // A pending one-shot reroll suppression (set when a PAID reroll was consumed
        // above) makes this ONE rebuild ignore the guarantee — read and cleared here, so
        // the next rebuild is guaranteed again.
        const suppressed = this._suppressGuaranteeOnce;
        this._suppressGuaranteeOnce = false;
        this.currentOffer = drawCardOffer({
          pool: this.registry,
          progressionState: this.progressionState,
          rng: this._rng,
          banishedIds: this.progressionState.banishedIds,
          // Suppression is signalled with an explicit -Infinity rather than `undefined`:
          // relying on the callee's destructuring default made the suppression depend on
          // a default two files away (which already changed once this story, 0 →
          // -Infinity) and read at the call site as "no argument" rather than "no
          // guarantee". -Infinity satisfies no finite threshold either way.
          runLevel: suppressed ? -Infinity : this.levelSystem.level,
        });
      }
      // Story 10.1 empty-offer AUTO-DRAIN: an EMPTY eligible pool (0 cards — every owned
      // item maxed, or all banished) drains ALL owed picks with NO card applied, grants
      // the landing invuln (as on a normal final pick), and closes the overlay. Without
      // this, pendingSelections would stay > 0 with an empty offer and hold the player
      // invulnerable forever on an overlay with no pickable card.
      if (this.currentOffer.length === 0) {
        this.pendingSelections = 0;
        this.playerState.invulnMs = Math.max(
          this.playerState.invulnMs,
          LEVELUP_LANDING_INVULN_MS,
        );
        this.currentOffer = [];
        return;
      }
      if (this.playerState.invulnMs < LEVELUP_INVULN_FLOOR) {
        this.playerState.invulnMs = LEVELUP_INVULN_FLOOR;
      }
    } else {
      this.currentOffer = [];
    }
  }
}
