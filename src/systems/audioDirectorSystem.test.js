import { describe, it, expect } from 'vitest';
import { AudioDirectorSystem } from './AudioDirectorSystem.js';
import {
  FIXED_STEP_MS,
  SPAWN_DIRECTOR_RAMP_DURATION_MS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// --- Phaser-free fakes for the sources the system reads ----------------------

// FiringSystem stand-in: only shotsFiredCount is read (the fire cue).
function fakeFiring(shotsFiredCount = 0) {
  return { shotsFiredCount };
}
// CollisionSystem stand-in: only bulletKillCount is read (the kill cue).
function fakeCollision(bulletKillCount = 0) {
  return { bulletKillCount };
}
// BombSystem stand-in: the shockwave latch (rising edge = detonation).
function fakeBomb(shockwaveMs = 0) {
  return { shockwaveMs };
}
// PlayerDeathSystem stand-in: the death latch (deathSeq increment = a death).
function fakeDeath(deathSeq = 0) {
  return { deathSeq };
}
// SpawnDirector stand-in: spawnCount (spawn cue) + the ramp (elapsedMs/progressAt
// drive musicIntensity). progressAt mirrors the real clamped ramp progress.
function fakeSpawnDirector({ spawnCount = 0, elapsedMs = 0 } = {}) {
  return {
    spawnCount,
    elapsedMs,
    progressAt(e) {
      const p = e / SPAWN_DIRECTOR_RAMP_DURATION_MS;
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      return p;
    },
  };
}

// BlackHoleSystem stand-in: only maxInstability is read (the urgency LEVEL).
function fakeBlackHole(maxInstability = 0) {
  return { maxInstability };
}

// Build a system with all five sources wired (each individually overridable). The
// optional 6th blackHoleSystem source defaults to omitted (so blackHoleInstability
// reads 0) unless a test passes one.
function build({
  firing = fakeFiring(0),
  collision = fakeCollision(0),
  bomb = fakeBomb(0),
  death = fakeDeath(0),
  spawn = fakeSpawnDirector(),
  blackHole,
} = {}) {
  return new AudioDirectorSystem(firing, collision, bomb, death, spawn, blackHole);
}

describe('AudioDirectorSystem — fire/kill/spawn counts', () => {
  it('accumulates the fire count from shotsFiredCount', () => {
    const sys = build({ firing: fakeFiring(2) });
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().fire).toBe(2);
  });

  it('accumulates the kill count from bulletKillCount', () => {
    const sys = build({ collision: fakeCollision(3) });
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().kill).toBe(3);
  });

  it('accumulates the spawn count from spawnCount', () => {
    const sys = build({ spawn: fakeSpawnDirector({ spawnCount: 1 }) });
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().spawn).toBe(1);
  });

  it('reports 0 counts on an empty tick', () => {
    const sys = build();
    sys.fixedUpdate(DT);
    const r = sys.consumeSfxRequests();
    expect(r.fire).toBe(0);
    expect(r.kill).toBe(0);
    expect(r.spawn).toBe(0);
  });
});

describe('AudioDirectorSystem — bomb/death edges', () => {
  it('raises the bomb flag once on the shockwave rising edge', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });
    bomb.shockwaveMs = 300; // detonation: rising edge
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().bomb).toBe(true);
  });

  it('does not re-raise the bomb flag as the shockwave decays', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });
    bomb.shockwaveMs = 300;
    sys.fixedUpdate(DT);
    sys.consumeSfxRequests();
    bomb.shockwaveMs = 250; // decay, not a rise
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().bomb).toBe(false);
  });

  it('raises the death flag once on a deathSeq increment', () => {
    const death = fakeDeath(0);
    const sys = build({ death });
    death.deathSeq = 1;
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().death).toBe(true);
  });

  it('does not re-raise the death flag when deathSeq is unchanged', () => {
    const death = fakeDeath(0);
    const sys = build({ death });
    death.deathSeq = 1;
    sys.fixedUpdate(DT);
    sys.consumeSfxRequests();
    sys.fixedUpdate(DT); // deathSeq still 1, no new death
    expect(sys.consumeSfxRequests().death).toBe(false);
  });

  it('raises the bomb flag again on a SECOND detonation (not a once-per-lifetime latch)', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });

    bomb.shockwaveMs = 300; // first detonation: rising edge
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().bomb).toBe(true);

    bomb.shockwaveMs = 0; // shockwave fully decays
    sys.fixedUpdate(DT);
    sys.consumeSfxRequests();

    bomb.shockwaveMs = 300; // second detonation: rising edge again
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().bomb).toBe(true);
  });

  it('raises the death flag again on a SECOND death (not a once-per-lifetime latch)', () => {
    const death = fakeDeath(0);
    const sys = build({ death });

    death.deathSeq = 1; // first death
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().death).toBe(true);

    death.deathSeq = 2; // second death
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().death).toBe(true);
  });
});

describe('AudioDirectorSystem — multi-sub-step sum (no consume between)', () => {
  it('sums fire counts across two ticks (1 then 2) into 3', () => {
    const firing = fakeFiring(1);
    const sys = build({ firing });
    sys.fixedUpdate(DT); // +1
    firing.shotsFiredCount = 2;
    sys.fixedUpdate(DT); // +2
    expect(sys.consumeSfxRequests().fire).toBe(3);
  });

  it('sums kill and spawn counts across sub-steps too', () => {
    const collision = fakeCollision(2);
    const spawn = fakeSpawnDirector({ spawnCount: 1 });
    const sys = build({ collision, spawn });
    sys.fixedUpdate(DT);
    collision.bulletKillCount = 1;
    spawn.spawnCount = 2;
    sys.fixedUpdate(DT);
    const r = sys.consumeSfxRequests();
    expect(r.kill).toBe(3);
    expect(r.spawn).toBe(3);
  });
});

describe('AudioDirectorSystem — seeded edge-detection prevs', () => {
  it('fires no bomb/death cue on the first tick when constructed mid-run (no new edge)', () => {
    const bomb = fakeBomb(200); // shockwave already decaying
    const death = fakeDeath(5); // deaths already happened
    const sys = build({ bomb, death });
    bomb.shockwaveMs = 160; // continued decay, not a rise
    sys.fixedUpdate(DT);
    const r = sys.consumeSfxRequests();
    expect(r.bomb).toBe(false);
    expect(r.death).toBe(false);
  });
});

describe('AudioDirectorSystem — consume resets', () => {
  it('a second consume with no new event returns zeroed counts + false flags', () => {
    const bomb = fakeBomb(0);
    const sys = build({ firing: fakeFiring(2), bomb });
    bomb.shockwaveMs = 300;
    sys.fixedUpdate(DT);

    // First consume drains the latches.
    const first = sys.consumeSfxRequests();
    expect(first.fire).toBe(2);
    expect(first.bomb).toBe(true);

    // Second consume (no new fixedUpdate/event) returns nothing.
    const second = sys.consumeSfxRequests();
    expect(second.fire).toBe(0);
    expect(second.kill).toBe(0);
    expect(second.spawn).toBe(0);
    expect(second.bomb).toBe(false);
    expect(second.death).toBe(false);
  });
});

describe('AudioDirectorSystem — music intensity (a level, not consumed)', () => {
  it('is 0 at elapsed 0 (run start)', () => {
    const sys = build({ spawn: fakeSpawnDirector({ elapsedMs: 0 }) });
    sys.fixedUpdate(DT);
    expect(sys.musicIntensity).toBe(0);
  });

  it('is the ramp progress mid-ramp', () => {
    const elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS / 2;
    const sys = build({ spawn: fakeSpawnDirector({ elapsedMs }) });
    sys.fixedUpdate(DT);
    expect(sys.musicIntensity).toBeCloseTo(0.5, 9);
  });

  it('clamps to 1 past the ramp end', () => {
    const elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS * 3;
    const sys = build({ spawn: fakeSpawnDirector({ elapsedMs }) });
    sys.fixedUpdate(DT);
    expect(sys.musicIntensity).toBe(1);
  });

  it('is NOT reset by consumeSfxRequests (a level, read every frame)', () => {
    const elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS / 2;
    const sys = build({ spawn: fakeSpawnDirector({ elapsedMs }) });
    sys.fixedUpdate(DT);
    sys.consumeSfxRequests();
    expect(sys.musicIntensity).toBeCloseTo(0.5, 9);
  });

  it('tracks the LATEST ramp each tick (not a first-tick-only latch)', () => {
    // One instance ticked twice as the ramp rises: the level must follow, so a
    // first-tick-only latch (stored once at construction/first step) would fail.
    const spawn = fakeSpawnDirector({ elapsedMs: 0 });
    const sys = build({ spawn });
    sys.fixedUpdate(DT);
    expect(sys.musicIntensity).toBe(0);

    spawn.elapsedMs = SPAWN_DIRECTOR_RAMP_DURATION_MS / 2; // ramp climbs
    sys.fixedUpdate(DT);
    expect(sys.musicIntensity).toBeCloseTo(spawn.progressAt(spawn.elapsedMs), 9);
    expect(sys.musicIntensity).toBeCloseTo(0.5, 9);
  });
});

describe('AudioDirectorSystem — black-hole instability (a level, not consumed) (Story 6.2)', () => {
  it('reflects blackHoleSystem.maxInstability as a level', () => {
    const blackHole = fakeBlackHole(0.42);
    const sys = build({ blackHole });
    sys.fixedUpdate(DT);
    expect(sys.blackHoleInstability).toBeCloseTo(0.42, 9);
  });

  it('is 0 when constructed with no blackHoleSystem source', () => {
    const sys = build(); // no blackHole passed → optional source absent
    sys.fixedUpdate(DT);
    expect(sys.blackHoleInstability).toBe(0);
  });

  it('tracks the LATEST maxInstability (read live, not a first-tick latch)', () => {
    const blackHole = fakeBlackHole(0.1);
    const sys = build({ blackHole });
    sys.fixedUpdate(DT);
    expect(sys.blackHoleInstability).toBeCloseTo(0.1, 9);
    blackHole.maxInstability = 0.8; // the hole grows more unstable
    expect(sys.blackHoleInstability).toBeCloseTo(0.8, 9);
  });

  it('is NOT reset by consumeSfxRequests (a level, read every frame)', () => {
    const blackHole = fakeBlackHole(0.5);
    const sys = build({ blackHole });
    sys.fixedUpdate(DT);
    sys.consumeSfxRequests();
    expect(sys.blackHoleInstability).toBeCloseTo(0.5, 9);
  });
});

describe('AudioDirectorSystem — gameplay neutrality (pure observer)', () => {
  it('mutates none of the sources it reads after a busy tick', () => {
    const firing = fakeFiring(2);
    const collision = fakeCollision(3);
    const bomb = fakeBomb(0);
    const death = fakeDeath(0);
    const spawn = fakeSpawnDirector({ spawnCount: 1, elapsedMs: 1000 });
    const sys = new AudioDirectorSystem(firing, collision, bomb, death, spawn);

    bomb.shockwaveMs = 300; // bomb edge fires this tick
    death.deathSeq = 1; // death edge fires this tick

    sys.fixedUpdate(DT);

    // Every source field is left exactly as the observer found it (read-only).
    expect(firing.shotsFiredCount).toBe(2);
    expect(collision.bulletKillCount).toBe(3);
    expect(spawn.spawnCount).toBe(1);
    expect(spawn.elapsedMs).toBe(1000);
    expect(bomb.shockwaveMs).toBe(300);
    expect(death.deathSeq).toBe(1);
  });
});

describe('AudioDirectorSystem — the fire cue counts VOLLEYS, not bullets (Story 10.3)', () => {
  // A gunshot is a per-trigger-pull EVENT. Since Story 10.3 one pull can spawn up to 9
  // bullets (Spread Cannon Lv5), so the cue reads `volleysFiredCount`; `shotsFiredCount`
  // keeps its honest meaning (bullets spawned) for every other consumer.
  it('a 9-bullet volley enqueues exactly ONE fire cue', () => {
    const sys = build({ firing: { shotsFiredCount: 9, volleysFiredCount: 1 } });
    sys.fixedUpdate(DT);
    // Read off the BULLET count instead, this would be 9 — enqueuing 9 cues per tick and
    // pegging the render loop's per-frame cap on EVERY tick, a flat wall of noise.
    expect(sys.consumeSfxRequests().fire).toBe(1);
  });

  it.each([
    ['null', null],
    ['a string', '1'],
    ['NaN', NaN],
  ])(
    'falls back to shotsFiredCount for a NON-NUMERIC volley counter (%s) — never silence',
    (_label, bad) => {
      // An `!== undefined` probe would take the volley branch for all of these and then
      // silently drop the cue (`null > 0` is false), so bullets spawn with no gunshot.
      // Requiring a real number degrades to the pre-10.3 per-bullet cue instead.
      const sys = build({ firing: { shotsFiredCount: 4, volleysFiredCount: bad } });
      sys.fixedUpdate(DT);
      expect(sys.consumeSfxRequests().fire).toBe(4);
    },
  );

  it.each([
    ['a string', '4'],
    ['null', null],
    ['NaN', NaN],
    ['undefined', undefined],
  ])(
    'a NON-NUMERIC fallback counter (%s) contributes 0, never a string _pendingFire',
    (_label, bad) => {
      // The fallback's own value has to be finiteness-checked as well. `'4' > 0` is
      // true, and `0 += '4'` yields the STRING '04' — every later tick concatenates
      // instead of adding, and consumeSfxRequests().fire hands a string to the render
      // loop's AUDIO_SFX_FIRE_MAX_PER_FRAME comparison. Guarding only the volley
      // counter moved that failure one branch down rather than removing it.
      const firing = { shotsFiredCount: bad, volleysFiredCount: null };
      const sys = build({ firing });
      sys.fixedUpdate(DT);
      sys.fixedUpdate(DT);
      const fire = sys.consumeSfxRequests().fire;
      expect(fire).toBe(0);
      expect(typeof fire).toBe('number');

      // And a real number on a later tick still accumulates numerically, rather than
      // onto a poisoned string accumulator.
      firing.shotsFiredCount = 3;
      sys.fixedUpdate(DT);
      expect(sys.consumeSfxRequests().fire).toBe(3);
    },
  );

  it('two volleys banked in one tick enqueue TWO cues (one per trigger interval)', () => {
    const sys = build({ firing: { shotsFiredCount: 18, volleysFiredCount: 2 } });
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().fire).toBe(2);
  });

  it('a stub exposing ONLY shotsFiredCount still works (pre-10.3 fallback)', () => {
    // Every single-bullet volley makes the two counters identical, so the fallback is
    // exactly the pre-10.3 behavior for a source that predates volleysFiredCount.
    const sys = build({ firing: fakeFiring(2) });
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().fire).toBe(2);
  });

  it('volleysFiredCount 0 with bullets spawned reports no cue (the counter, not the bullets)', () => {
    // A defensive shape check: the cue follows the volley latch, never the bullet latch.
    const sys = build({ firing: { shotsFiredCount: 9, volleysFiredCount: 0 } });
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().fire).toBe(0);
  });

  it('accumulates volleys across sub-steps and resets on consume', () => {
    const firing = { shotsFiredCount: 9, volleysFiredCount: 1 };
    const sys = build({ firing });
    sys.fixedUpdate(DT);
    firing.volleysFiredCount = 2;
    firing.shotsFiredCount = 18;
    sys.fixedUpdate(DT);
    expect(sys.consumeSfxRequests().fire).toBe(3);
    expect(sys.consumeSfxRequests().fire).toBe(0);
  });
});
