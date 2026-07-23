import {
  SLOT_LIMIT_OFFENSE,
  SLOT_LIMIT_DEFENSE,
  CARD_OFFER_SIZE,
  CARD_WEIGHT_OWNED_MULT,
  CARD_WEIGHT_UNOWNED_MULT,
  CARD_WEIGHT_LEVEL1_MULT,
  CARD_WEIGHT_MIDTIER_MULT,
} from '../config/constants.js';

// cardOffer — the deterministic weighted-without-replacement card draw (Story 8.4,
// Phaser-free pure module).
//
// This replaces Story 8.3's fixed `PLACEHOLDER_CARDS.slice(0, 3)` offer-build seam
// with a real weighted draw: each candidate is weighted by the Epic-8 formula so the
// offer favors finishing owned builds (and mid-tier upgrades) over starting new ones,
// a track at its slot limit stops offering fresh cards in it, and the three cards are
// drawn distinct through the injected `_rng` stream (the SAME one the spawn systems
// use) so the offer is fully deterministic on the seedable stream.
//
// The draw mirrors SpawnDirector._pickAndSpawn: sum the positive weights, walk a
// running `rng()*total` subtraction to pick one band (a 0-weight card contributes no
// band and is never picked; a float guard awards an exact top-boundary hit to the
// last positive card), then remove the pick and repeat CARD_OFFER_SIZE times so the
// cards are distinct.
//
// `banishedIds` (default empty) is the Story 8.5 seam: a banished id gets a 0 banish
// multiplier. In NORMAL operation (the positive-weight pool has >= CARD_OFFER_SIZE
// cards — always true for the shipped 6+5 pool) a banished/zero-weight card is never
// offered. The ONLY exception is the unreachable safety-net fill (see drawCardOffer):
// in the impossible < CARD_OFFER_SIZE-positive state it may include a zero-weight card
// to preserve the exactly-three count — count-safety intentionally wins there over
// banish/zero-weight purity. Empty this story, so banishMultiplier === 1 for every
// card and nothing is zeroed by banish.

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
 * The Epic-8 per-candidate weight:
 *   rarity × (owned ? OWNED : UNOWNED) × (level===1 ? LEVEL1 : MIDTIER)
 *          × (trackFull && !owned ? 0 : 1) × banishMultiplier
 * where `level = ownedCards[id] ?? 0`, `owned = level >= 1`, `trackFull` = the count
 * of distinct owned ids in the candidate's track has reached that track's limit, and
 * banishMultiplier is 0 for a banished id else 1 (the Story 8.5 seam). A 0 weight
 * means the card is not offered.
 * @param {{ id: string, rarity: number, track: string }} card
 * @param {{ ownedCards: Object<string,number>, banishedIds?: (Set<string>|string[]),
 *           slotCounts: Object<string,number>, limits: Object<string,number> }} ctx
 * @returns {number} the weight (>= 0)
 */
export function cardWeight(card, { ownedCards, banishedIds, slotCounts, limits }) {
  const level = ownedCards[card.id] ?? 0;
  const owned = level >= 1;
  const ownedMult = owned ? CARD_WEIGHT_OWNED_MULT : CARD_WEIGHT_UNOWNED_MULT;
  const levelMult =
    level === 1 ? CARD_WEIGHT_LEVEL1_MULT : CARD_WEIGHT_MIDTIER_MULT;
  const limit = limits[card.track] ?? Infinity;
  const slotsFull = (slotCounts[card.track] ?? 0) >= limit;
  const slotFactor = slotsFull && !owned ? 0 : 1;
  const banishMultiplier = isBanished(banishedIds, card.id) ? 0 : 1;
  return card.rarity * ownedMult * levelMult * slotFactor * banishMultiplier;
}

/**
 * Draw exactly CARD_OFFER_SIZE distinct cards from `pool` by weighted-without-
 * replacement using the Epic-8 weight (see cardWeight). Deterministic: the same
 * `rng` sequence + same `progressionState` yields the identical cards in the identical
 * order. Every bit of randomness routes through the injected `rng`.
 *
 * If fewer than CARD_OFFER_SIZE positive-weight candidates exist (documented as
 * unreachable with the 6+5 pool even with both tracks full), the remaining slots are
 * filled deterministically from the not-yet-drawn cards in pool order so the result is
 * always exactly CARD_OFFER_SIZE — this keeps the 8.3 selection latch
 * (`currentOffer.length === 3`) intact against any future pool shrink.
 * @param {{ pool: ReadonlyArray<{ id:string, rarity:number, track:string }>,
 *           progressionState: { ownedCards: Object<string,number> },
 *           rng?: () => number, banishedIds?: (Set<string>|string[]) }} args
 * @returns {Array<object>} exactly CARD_OFFER_SIZE distinct cards
 */
export function drawCardOffer({
  pool,
  progressionState,
  rng = Math.random,
  banishedIds,
}) {
  const ownedCards = progressionState.ownedCards;

  // Derive per-track distinct-owned counts ONCE for this draw: for each owned id
  // (count >= 1), bump its track's count using the pool's id→track lookup.
  const trackOf = {};
  for (let i = 0; i < pool.length; i++) trackOf[pool[i].id] = pool[i].track;
  const slotCounts = {};
  for (const id in ownedCards) {
    if ((ownedCards[id] ?? 0) >= 1) {
      const track = trackOf[id];
      if (track != null) slotCounts[track] = (slotCounts[track] ?? 0) + 1;
    }
  }

  // Compute each card's weight once; candidates carries the not-yet-drawn cards in
  // pool order (splice preserves order), so both the draw and the fill are stable.
  const candidates = [];
  for (let i = 0; i < pool.length; i++) {
    candidates.push({
      card: pool[i],
      weight: cardWeight(pool[i], {
        ownedCards,
        banishedIds,
        slotCounts,
        limits: TRACK_LIMITS,
      }),
    });
  }

  const result = [];
  for (let draw = 0; draw < CARD_OFFER_SIZE; draw++) {
    // Sum the positive weights of the remaining candidates.
    let total = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].weight > 0) total += candidates[i].weight;
    }
    if (total <= 0) break; // no positive-weight candidate left — fill below.

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
    candidates.splice(picked, 1); // remove the pick so the three are distinct.
  }

  // Deterministic zero-weight fill safety net (documented unreachable with the 6+5
  // pool): top the result up to CARD_OFFER_SIZE from the undrawn cards in pool order.
  // This can only run in the impossible < CARD_OFFER_SIZE-positive state, and there it
  // deliberately prioritizes the exactly-three latch invariant over banish/zero-weight
  // purity — a zero-weight (even banished) card may be included to keep the count at
  // three rather than underflow the 8.3 `currentOffer.length === 3` latch.
  for (let i = 0; i < candidates.length && result.length < CARD_OFFER_SIZE; i++) {
    result.push(candidates[i].card);
  }

  return result;
}
