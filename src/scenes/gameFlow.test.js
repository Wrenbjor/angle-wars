import { describe, it, expect } from 'vitest';
import {
  FLOW_STATES,
  FLOW_EVENTS,
  nextFlowState,
  sceneForState,
} from './gameFlow.js';

// gameFlow — the pure game-flow state machine (Story 5.3 / FR14). These node-only
// tests pin every row of the spec's I/O matrix, assert every illegal/unknown pair
// yields null, and — critically — assert the NO-DEAD-ENDS property directly: from
// every state a BFS over the transition table reaches both TITLE and PLAY, every
// state has at least one outgoing edge, and the terminal GAME_OVER offers BOTH
// RESTART and RETURN_TO_TITLE. That property IS the FR14 guarantee ("no dead ends;
// every terminal state offers restart AND return to title") encoded as a test.

const { TITLE, PLAY, GAME_OVER, SETTINGS } = FLOW_STATES;
const { START, OPEN_SETTINGS, CLOSE_SETTINGS, PLAYER_DIED, RESTART, RETURN_TO_TITLE } =
  FLOW_EVENTS;

describe('nextFlowState — I/O matrix (legal transitions)', () => {
  it('(TITLE, START) → PLAY', () => {
    expect(nextFlowState(TITLE, START)).toBe(PLAY);
  });
  it('(TITLE, OPEN_SETTINGS) → SETTINGS', () => {
    expect(nextFlowState(TITLE, OPEN_SETTINGS)).toBe(SETTINGS);
  });
  it('(SETTINGS, CLOSE_SETTINGS) → TITLE', () => {
    expect(nextFlowState(SETTINGS, CLOSE_SETTINGS)).toBe(TITLE);
  });
  it('(PLAY, PLAYER_DIED) → GAME_OVER', () => {
    expect(nextFlowState(PLAY, PLAYER_DIED)).toBe(GAME_OVER);
  });
  it('(GAME_OVER, RESTART) → PLAY', () => {
    expect(nextFlowState(GAME_OVER, RESTART)).toBe(PLAY);
  });
  it('(GAME_OVER, RETURN_TO_TITLE) → TITLE', () => {
    expect(nextFlowState(GAME_OVER, RETURN_TO_TITLE)).toBe(TITLE);
  });
});

describe('nextFlowState — illegal / unknown pairs → null', () => {
  it('(PLAY, OPEN_SETTINGS) → null (no settings from a live run)', () => {
    expect(nextFlowState(PLAY, OPEN_SETTINGS)).toBeNull();
  });
  it('(TITLE, RESTART) → null', () => {
    expect(nextFlowState(TITLE, RESTART)).toBeNull();
  });
  it('(SETTINGS, START) → null', () => {
    expect(nextFlowState(SETTINGS, START)).toBeNull();
  });
  it('(GAME_OVER, OPEN_SETTINGS) → null', () => {
    expect(nextFlowState(GAME_OVER, OPEN_SETTINGS)).toBeNull();
  });
  it('unknown state → null', () => {
    expect(nextFlowState(undefined, 'foo')).toBeNull();
    expect(nextFlowState('NOPE', START)).toBeNull();
  });
  it('unknown event on a known state → null', () => {
    expect(nextFlowState(TITLE, 'foo')).toBeNull();
  });

  it('prototype-chain keys never leak inherited members (state/event) → null', () => {
    // Without an Object.hasOwn gate, TRANSITIONS['toString'] / row['toString'] would
    // return the inherited Object.prototype.toString instead of null.
    expect(nextFlowState('toString', 'toString')).toBeNull();
    expect(nextFlowState('constructor', 'constructor')).toBeNull();
    expect(nextFlowState('__proto__', START)).toBeNull();
    expect(nextFlowState(TITLE, 'toString')).toBeNull();
    expect(nextFlowState(TITLE, 'constructor')).toBeNull();
  });
});

describe('sceneForState — state → scene key', () => {
  it('maps each state to its Phaser scene key', () => {
    expect(sceneForState(TITLE)).toBe('TitleScene');
    expect(sceneForState(PLAY)).toBe('ArenaScene');
    // GAME_OVER is an in-ArenaScene overlay sub-state → shares ArenaScene's key.
    expect(sceneForState(GAME_OVER)).toBe('ArenaScene');
    expect(sceneForState(SETTINGS)).toBe('SettingsScene');
  });
  it('returns null for an unknown state', () => {
    expect(sceneForState('NOPE')).toBeNull();
  });
  it('returns null for a prototype-chain key (no inherited-member leak)', () => {
    expect(sceneForState('constructor')).toBeNull();
    expect(sceneForState('toString')).toBeNull();
    expect(sceneForState('__proto__')).toBeNull();
  });
});

describe('no-dead-ends property (FR14)', () => {
  const ALL_STATES = [TITLE, PLAY, GAME_OVER, SETTINGS];
  const ALL_EVENTS = [
    START,
    OPEN_SETTINGS,
    CLOSE_SETTINGS,
    PLAYER_DIED,
    RESTART,
    RETURN_TO_TITLE,
  ];

  /** All states reachable from `start` via a BFS over the transition table. */
  function reachableFrom(start) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const s = queue.shift();
      for (const ev of ALL_EVENTS) {
        const next = nextFlowState(s, ev);
        if (next != null && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  it('every state can reach BOTH title and play', () => {
    for (const s of ALL_STATES) {
      const reachable = reachableFrom(s);
      expect(reachable.has(TITLE), `${s} should reach TITLE`).toBe(true);
      expect(reachable.has(PLAY), `${s} should reach PLAY`).toBe(true);
    }
  });

  it('every state has at least one outgoing edge (no dead end)', () => {
    for (const s of ALL_STATES) {
      const outgoing = ALL_EVENTS.filter((ev) => nextFlowState(s, ev) != null);
      expect(outgoing.length, `${s} should have >= 1 outgoing edge`).toBeGreaterThan(0);
    }
  });

  it('GAME_OVER (terminal) offers BOTH restart and return-to-title', () => {
    expect(nextFlowState(GAME_OVER, RESTART)).toBe(PLAY);
    expect(nextFlowState(GAME_OVER, RETURN_TO_TITLE)).toBe(TITLE);
  });
});
