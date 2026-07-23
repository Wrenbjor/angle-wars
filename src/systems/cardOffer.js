import {
  SLOT_LIMIT_OFFENSE,
  SLOT_LIMIT_DEFENSE,
  CARD_OFFER_SIZE,
  CARD_WEIGHT_OWNED_MULT,
  CARD_WEIGHT_UNOWNED_MULT,
  CARD_WEIGHT_LEVEL1_MULT,
  CARD_WEIGHT_MIDTIER_MULT,
} from '../config/constants.js';
import {
  slotOccupancy,
  isMaxedAtLevel,
  hasRemnant,
} from '../state/ProgressionState.js';

// cardOffer — the deterministic weighted-without-replacement card draw (Story 8.4,
// extended by Story 10.1; Phaser-free pure module).
//
// Each candidate is weighted by the Epic-8 formula so the offer favors finishing owned
// builds (and mid-tier upgrades) over starting new ones, a track at its slot limit
// stops offering fresh cards in it, and the cards are drawn distinct through the
// injected `_rng` stream (the SAME one the spawn systems use) so the offer is fully
// deterministic on the seedable stream.
//
// The draw mirrors SpawnDirector._pickAndSpawn: sum the positive weights, walk a
// running `rng()*total` subtraction to pick one band (a 0-weight card contributes no
// band and is never picked; a float guard awards an exact top-boundary hit to the
// last positive card), then remove the pick and repeat up to CARD_OFFER_SIZE times so
// the cards are distinct.
//
// EXCLUSION PURITY (Story 10.1): a card is EXCLUDED (weight 0) when it is banished
// (Story 8.5), maxed (level >= maxLevel), a fusion remnant, or an unowned card in a
// full track. drawCardOffer returns ONLY the drawn positive-weight (eligible) cards —
// a VARIABLE-LENGTH array of 0..CARD_OFFER_SIZE — and NEVER pads an excluded card in to
// reach a count. When fewer than CARD_OFFER_SIZE cards are eligible the offer is SHORT
// (2, 1, or 0). This resolves the old exactly-three invariant, which was unsatisfiable
// against Story 8.5 banish-permanence once >= 2 of the Epic-10 items are excluded — the
// former zero-weight "fill safety net" (which re-surfaced banished/excluded cards) is
// deleted. Count-safety must never win over exclusion purity. An EMPTY (0-eligible)
// offer is drained by LevelUpSystem (the owed pick auto-drains, no card applied).
//
// OFFER GUARANTEE (Story 10.3): an item definition may carry `guaranteeFromLevel`, the
// run level from which the offer RESERVES it a slot while it is still UNOWNED — PRD
// §13.3's "Spread Cannon is always offered by Lv3" onboarding beat, expressed as data on
// the definition rather than as a special case in the draw. The reservation happens
// BEFORE the weighted loop and consumes NO rng() call, so an inactive guarantee leaves
// the draw stream bit-identical to the pre-10.3 draw for the same seed.
//
// The guarantee is strictly SUBORDINATE to exclusion: it can only move a candidate whose
// ordinary weight is already > 0, so a banished (Story 8.5 permanence), maxed, remnant,
// or unowned-in-a-full-track item is NOT offered, guarantee or not — it can never
// resurrect a zero-weight card. It also holds from the threshold level ONWARD (not only
// on the crossing level-up) for as long as the item stays unowned.

// Per-track distinct-owned slot limits, keyed by a card's `track`.
const TRACK_LIMITS = {
  offense: SLOT_LIMIT_OFFENSE,
  defense: SLOT_LIMIT_DEFENSE,
};

/**
 * True when `id` is in the banished set (Story 8.5 seam). Accepts a Set, an array,
 * or a null/undefined (empty) set; anything else is treated as empty.
 * @param {Set<string>|string[]|null|undefined} banishedIds
 * @param {string} id
 * @returns {boolean}
 */
function isBanished(banishedIds, id) {
  if (!banishedIds) return false;
  if (typeof banishedIds.has === 'function') return banishedIds.has(id);
  if (Array.isArray(banishedIds)) return banishedIds.includes(id);
  return false;
}

/**
 * The Epic-8 per-candidate weight, extended by Story 10.1 with maxed/remnant exclusion:
 *   rarity × (owned ? OWNED : UNOWNED) × (level===1 ? LEVEL1 : MIDTIER)
 *          × (trackFull && !owned ? 0 : 1) × banishMultiplier × exclusionMultiplier
 * where `level = ownedCards[id] ?? 0`, `owned = level >= 1`, `trackFull` = the count
 * of distinct owned ids in the candidate's track has reached that track's limit,
 * banishMultiplier is 0 for a banished id else 1, and exclusionMultiplier is 0 when the
 * card is MAXED (`level >= card.maxLevel`) or a REMNANT else 1. A 0 weight means the
 * card is not offered. (A card without a `maxLevel` — e.g. a legacy synthetic fixture —
 * is never maxed: `level >= undefined` is false.)
 * @param {{ id: string, rarity: number, track: string, maxLevel?: number }} card
 * @param {{ ownedCards: Object<string,number>, banishedIds?: (Set<string>|string[]),
 *           remnantIds?: (Set<string>|string[]),
 *           slotCounts: Object<string,number>, limits: Object<string,number> }} ctx
 * @returns {number} the weight (>= 0)
 */
export function cardWeight(
  card,
  { ownedCards, banishedIds, remnantIds, slotCounts, limits },
) {
  const level = ownedCards[card.id] ?? 0;
  const owned = level >= 1;
  const ownedMult = owned ? CARD_WEIGHT_OWNED_MULT : CARD_WEIGHT_UNOWNED_MULT;
  const levelMult =
    level === 1 ? CARD_WEIGHT_LEVEL1_MULT : CARD_WEIGHT_MIDTIER_MULT;
  const limit = limits[card.track] ?? Infinity;
  const slotsFull = (slotCounts[card.track] ?? 0) >= limit;
  const slotFactor = slotsFull && !owned ? 0 : 1;
  const banishMultiplier = isBanished(banishedIds, card.id) ? 0 : 1;
  // Story 10.1: a maxed item (level at/above its cap) or a fusion remnant is never
  // offered. maxLevel is read from the item DEFINITION (the one source of truth), and
  // both predicates come from the SHARED ProgressionState primitives that back the
  // exposed isMaxed/isRemnant queries — so the offer and the query surface can never
  // disagree about which items are excluded.
  const maxed = isMaxedAtLevel(level, card);
  const remnant = hasRemnant(remnantIds, card.id);
  const exclusionMultiplier = maxed || remnant ? 0 : 1;
  return (
    card.rarity *
    ownedMult *
    levelMult *
    slotFactor *
    banishMultiplier *
    exclusionMultiplier
  );
}

/**
 * Draw up to CARD_OFFER_SIZE distinct positive-weight (eligible) cards from `pool` by
 * weighted-without-replacement using the Epic-8 weight (see cardWeight). Deterministic:
 * the same `rng` sequence + same `progressionState` yields the identical cards in the
 * identical order. Every bit of randomness routes through the injected `rng`.
 *
 * Story 10.1 — the offer is VARIABLE LENGTH and EXCLUSION-PURE: it returns ONLY the
 * drawn eligible cards (a `0..CARD_OFFER_SIZE`-length array). When fewer than
 * CARD_OFFER_SIZE cards are eligible the offer is SHORT; when none are eligible it is
 * EMPTY (`[]`). An excluded card (banished / maxed / remnant / unowned-in-full-track) is
 * NEVER padded in to reach a count — the former zero-weight fill safety net is removed.
 * NOTE on the two exclusion sets: `remnantIds` is read off `progressionState`, but
 * `banishedIds` is the SEPARATE top-level argument — `progressionState.banishedIds` is
 * NOT read here (the Story 8.5 callers thread it explicitly). Passing it only on
 * `progressionState` yields ZERO banish exclusion.
 *
 * Story 10.3 — `runLevel` drives the OFFER GUARANTEE (see the module header): each
 * candidate carrying a finite `guaranteeFromLevel <= runLevel` that is still UNOWNED and
 * still ELIGIBLE (weight > 0) is moved into the result, in registry order, before the
 * weighted loop runs and without consuming an rng() draw. It defaults to -Infinity, NOT
 * 0: an absent run level must be unable to satisfy ANY finite threshold, and a 0 default
 * would let an item authored with `guaranteeFromLevel: 0` reserve a slot for every legacy
 * or synthetic-pool caller that omits the argument — precisely the regression the
 * "an inactive guarantee leaves the draw bit-identical" property exists to prevent.
 * @param {{ pool: ReadonlyArray<{ id:string, rarity:number, track:string, maxLevel?:number,
 *             guaranteeFromLevel?: number|null }>,
 *           progressionState: { ownedCards: Object<string,number>,
 *             remnantIds?: (Set<string>|string[]) },
 *           rng?: () => number, banishedIds?: (Set<string>|string[]),
 *           runLevel?: number }} args
 * @returns {Array<object>} 0..CARD_OFFER_SIZE distinct eligible cards, guaranteed cards
 *   first (in registry order), then the weighted draw order.
 */
export function drawCardOffer({
  pool,
  progressionState,
  rng = Math.random,
  banishedIds,
  // An OMITTED run level must not be able to satisfy any threshold, including a
  // `guaranteeFromLevel: 0`. -Infinity says that in the value itself; the reservation
  // loop's Number.isFinite gate independently rejects it (and every other non-numeric
  // level), so the two agree. An EXPLICIT `runLevel: 0` is finite and still honors a
  // zero threshold.
  runLevel = -Infinity,
}) {
  const ownedCards = progressionState.ownedCards;
  const remnantIds = progressionState.remnantIds;

  // Per-track distinct-owned counts via the ONE shared helper (read by both cardOffer
  // and the fusion/query surface — never duplicated). The pool IS the registry, so its
  // id→track mapping is authoritative.
  const slotCounts = slotOccupancy(progressionState, pool);

  // Compute each card's weight once; candidates carries the not-yet-drawn cards.
  const candidates = [];
  for (let i = 0; i < pool.length; i++) {
    candidates.push({
      card: pool[i],
      weight: cardWeight(pool[i], {
        ownedCards,
        banishedIds,
        remnantIds,
        slotCounts,
        limits: TRACK_LIMITS,
      }),
    });
  }

  const result = [];

  // Story 10.3 — PRE-DRAW GUARANTEE RESERVATION. Walk the candidates in REGISTRY order
  // (deterministic, and independent of the rng stream) and move each guaranteed one into
  // the result. Three conditions, all of which must hold:
  //   - `weight > 0`  : the guarantee is EXCLUSION-SUBORDINATE. A banished / maxed /
  //     remnant / unowned-in-a-full-track item weighs 0 and stays out — Story 8.5 banish
  //     permanence and Story 10.1 exclusion purity outrank the guarantee, so a banished
  //     Spread Cannon is never offered again. This is also why the reservation can never
  //     resurrect a zero-weight card back into the offer.
  //   - level 0       : the guarantee exists to get the item OWNED. Once it is owned it
  //     competes on its ordinary weight like everything else (an owned item's upgrades
  //     are already favored by the OWNED multiplier).
  //   - a finite `guaranteeFromLevel <= runLevel` : holds from the threshold level ONWARD
  //     while unowned, not only on the crossing level-up. A missing/null field (every
  //     other item, and every legacy/synthetic pool card) is not finite, so it never
  //     reserves.
  // No rng() is consumed here, so an INACTIVE guarantee leaves the draw stream
  // bit-identical to pre-10.3. The cap keeps a hypothetical many-guarantee registry from
  // overflowing the offer.
  for (let i = 0; i < candidates.length && result.length < CARD_OFFER_SIZE; i++) {
    const { card, weight } = candidates[i];
    if (weight <= 0) continue;
    if ((ownedCards[card.id] ?? 0) >= 1) continue;
    const from = card.guaranteeFromLevel;
    // BOTH operands must be real numbers. `guaranteeFromLevel` was always checked, but a
    // bare `runLevel >= from` coerces the other side: a string level ('9') or a `null`
    // (which a destructuring default does NOT replace — it only fires on `undefined`)
    // compares as a number and activates a guarantee, defeating the `-Infinity` default
    // whose entire job is that an absent run level cannot satisfy ANY finite threshold.
    if (!Number.isFinite(from) || !Number.isFinite(runLevel)) continue;
    if (runLevel < from) continue;
    result.push(card);
    candidates.splice(i, 1); // out of the draw so the offer stays distinct
    i--;
  }

  // The weighted loop now fills only the REMAINING slots.
  for (let draw = result.length; draw < CARD_OFFER_SIZE; draw++) {
    // Sum the positive weights of the remaining candidates.
    let total = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].weight > 0) total += candidates[i].weight;
    }
    // No positive-weight candidate left — the offer is complete (SHORT or EMPTY). This
    // is the exclusion-pure stop: nothing is padded in to reach CARD_OFFER_SIZE.
    if (total <= 0) break;

    // Walk a running rng()*total subtraction; a 0-weight card contributes no band.
    let r = rng() * total;
    let picked = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].weight <= 0) continue;
      r -= candidates[i].weight;
      if (r < 0) {
        picked = i;
        break;
      }
    }
    // Float guard: an exact top-boundary hit (r never went negative) is awarded to
    // the last positive-weight candidate.
    if (picked === -1) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].weight > 0) {
          picked = i;
          break;
        }
      }
    }

    result.push(candidates[picked].card);
    candidates.splice(picked, 1); // remove the pick so the cards are distinct.
  }

  return result;
}
