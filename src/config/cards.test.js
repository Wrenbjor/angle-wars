import { describe, it, expect } from 'vitest';
import { PLACEHOLDER_CARDS } from './cards.js';

// Story 8.3 — the placeholder card registry invariants. Epic 8's fixed offer is
// exactly three distinct frozen cards; Epic 10 replaces the content (these
// invariants guard the shape the level-up loop depends on).

describe('PLACEHOLDER_CARDS — registry invariants', () => {
  it('has exactly three cards', () => {
    expect(PLACEHOLDER_CARDS).toHaveLength(3);
  });

  it('every card has a distinct id', () => {
    const ids = PLACEHOLDER_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every card has a non-empty title and a numeric statDelta', () => {
    for (const card of PLACEHOLDER_CARDS) {
      expect(typeof card.title).toBe('string');
      expect(card.title.length).toBeGreaterThan(0);
      expect(typeof card.statDelta).toBe('number');
      expect(Number.isFinite(card.statDelta)).toBe(true);
    }
  });

  it('the registry and every entry are frozen (shared immutable pool)', () => {
    expect(Object.isFrozen(PLACEHOLDER_CARDS)).toBe(true);
    for (const card of PLACEHOLDER_CARDS) {
      expect(Object.isFrozen(card)).toBe(true);
    }
  });
});
