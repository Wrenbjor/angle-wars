import { describe, it, expect } from 'vitest';
import { ScreenFeedbackSystem } from './ScreenFeedbackSystem.js';
import { HAPTIC_STYLE } from '../scenes/nativeFeel.js';
import {
  FIXED_STEP_MS,
  SCREEN_SHAKE_TRAUMA_BOMB,
  SCREEN_SHAKE_TRAUMA_DEATH,
  SCREEN_SHAKE_TRAUMA_KILL,
  SCREEN_SHAKE_TRAUMA_NEARMISS,
  SCREEN_FLASH_MS,
  SCREEN_HITSTOP_MS,
  SCREEN_NEARMISS_RADIUS,
  SCREEN_NEARMISS_COOLDOWN_MS,
} from '../config/constants.js';

const DT = FIXED_STEP_MS;

// --- Phaser-free fakes for the sources the system reads ----------------------

// CollisionSystem stand-in: only bulletKillCount is read (the per-kill nudge).
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
// enemyPool stand-in: forEachActive over a plain list of enemies.
function fakePool(enemies = []) {
  return {
    enemies,
    forEachActive(fn) {
      for (const e of this.enemies) fn(e);
    },
  };
}
function enemy(x, y, radius = 14, telegraphMs = 0) {
  return { x, y, radius, telegraphMs };
}
function makeShip() {
  return { x: 100, y: 100, radius: 16 };
}

// ExtraLifeSystem stand-in: only awardSeq is read (the extra-life haptic edge).
function fakeExtraLife(awardSeq = 0) {
  return { awardSeq };
}

// A helper that builds a system with all sources wired. `extraLife` is the optional
// trailing source (Story 7.5); omitted → null (byte-identical to the pre-7.5 arity).
function build({
  collision = fakeCollision(0),
  bomb = fakeBomb(0),
  death = fakeDeath(0),
  ship = makeShip(),
  pools = [fakePool()],
  extraLife = null,
} = {}) {
  return new ScreenFeedbackSystem(collision, bomb, death, ship, pools, extraLife);
}

// Drain the pending haptic pulses into an array (the render-loop sink stand-in).
function drainToArray(sys) {
  const out = [];
  sys.drainHapticPulses((style) => out.push(style));
  return out;
}

// Ship at (100,100) r16, enemy r14 → overlap lower bound = 30, near-miss band is
// (30, 70]. An enemy 50px away is in-band; 10px overlaps; 100px is too far.
const IN_BAND = () => enemy(150, 100); // dist 50
const OVERLAP = () => enemy(110, 100); // dist 10 (< 30)
const TOO_FAR = () => enemy(200, 100); // dist 100 (> 70)

describe('ScreenFeedbackSystem — bomb detonation (big event)', () => {
  it('adds the bomb trauma and raises flash + hit-stop on the shockwave rising edge', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });

    bomb.shockwaveMs = 300; // detonation: rising edge
    sys.fixedUpdate(DT);

    expect(sys.consumePendingTrauma()).toBeCloseTo(SCREEN_SHAKE_TRAUMA_BOMB, 9);
    expect(sys.consumeFlashRequest()).toBe(SCREEN_FLASH_MS);
    expect(sys.consumeHitStopRequest()).toBe(SCREEN_HITSTOP_MS);
  });

  it('does not re-fire as the shockwave decays (no falling/steady edge)', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });

    bomb.shockwaveMs = 300;
    sys.fixedUpdate(DT);
    sys.consumePendingTrauma();
    sys.consumeFlashRequest();
    sys.consumeHitStopRequest();

    bomb.shockwaveMs = 250; // decay, not a rise
    sys.fixedUpdate(DT);
    expect(sys.consumePendingTrauma()).toBe(0);
    expect(sys.consumeFlashRequest()).toBe(0);
    expect(sys.consumeHitStopRequest()).toBe(0);
  });
});

describe('ScreenFeedbackSystem — player death (big event, harder than a bomb)', () => {
  it('adds the death trauma and raises flash + hit-stop on each deathSeq increment', () => {
    const death = fakeDeath(0);
    const sys = build({ death });

    death.deathSeq = 1;
    sys.fixedUpdate(DT);

    expect(sys.consumePendingTrauma()).toBeCloseTo(SCREEN_SHAKE_TRAUMA_DEATH, 9);
    expect(sys.consumeFlashRequest()).toBe(SCREEN_FLASH_MS);
    expect(sys.consumeHitStopRequest()).toBe(SCREEN_HITSTOP_MS);
  });

  it('death trauma exceeds bomb trauma (severity-proportional)', () => {
    expect(SCREEN_SHAKE_TRAUMA_DEATH).toBeGreaterThan(SCREEN_SHAKE_TRAUMA_BOMB);
  });
});

describe('ScreenFeedbackSystem — bullet kills (subtle nudge only)', () => {
  it('adds per-kill trauma with NO flash and NO hit-stop', () => {
    const sys = build({ collision: fakeCollision(3) });

    sys.fixedUpdate(DT);

    expect(sys.consumePendingTrauma()).toBeCloseTo(3 * SCREEN_SHAKE_TRAUMA_KILL, 9);
    expect(sys.consumeFlashRequest()).toBe(0);
    expect(sys.consumeHitStopRequest()).toBe(0);
  });

  it('adds nothing when there were no bullet kills', () => {
    const sys = build({ collision: fakeCollision(0) });
    sys.fixedUpdate(DT);
    expect(sys.consumePendingTrauma()).toBe(0);
  });
});

describe('ScreenFeedbackSystem — near-miss (throttled subtle nudge only)', () => {
  it('registers one near-miss for an in-band enemy, sets the cooldown, no flash/hit-stop', () => {
    const sys = build({ pools: [fakePool([IN_BAND()])] });

    sys.fixedUpdate(DT);

    expect(sys.consumePendingTrauma()).toBeCloseTo(SCREEN_SHAKE_TRAUMA_NEARMISS, 9);
    expect(sys.consumeFlashRequest()).toBe(0);
    expect(sys.consumeHitStopRequest()).toBe(0);
  });

  it('throttles: an in-band enemy again before the cooldown elapses adds nothing', () => {
    const sys = build({ pools: [fakePool([IN_BAND()])] });

    sys.fixedUpdate(DT); // registers, cooldown set
    sys.consumePendingTrauma();

    sys.fixedUpdate(DT); // still in band, but cooldown has not elapsed
    expect(sys.consumePendingTrauma()).toBe(0);
  });

  it('re-fires once the cooldown has fully elapsed', () => {
    const sys = build({ pools: [fakePool([IN_BAND()])] });

    sys.fixedUpdate(DT); // registers
    sys.consumePendingTrauma();

    // Advance enough ticks to drain SCREEN_NEARMISS_COOLDOWN_MS.
    const ticks = Math.ceil(SCREEN_NEARMISS_COOLDOWN_MS / DT) + 1;
    let total = 0;
    for (let i = 0; i < ticks; i++) {
      sys.fixedUpdate(DT);
      total += sys.consumePendingTrauma();
    }
    // Exactly one further near-miss fired across the drain span.
    expect(total).toBeCloseTo(SCREEN_SHAKE_TRAUMA_NEARMISS, 9);
  });

  it('excludes a telegraphing enemy', () => {
    const sys = build({ pools: [fakePool([enemy(150, 100, 14, 250)])] }); // in-band but telegraphing
    sys.fixedUpdate(DT);
    expect(sys.consumePendingTrauma()).toBe(0);
  });

  it('excludes an enemy overlapping the ship collision radius', () => {
    const sys = build({ pools: [fakePool([OVERLAP()])] });
    sys.fixedUpdate(DT);
    expect(sys.consumePendingTrauma()).toBe(0);
  });

  it('excludes an enemy beyond the near-miss radius', () => {
    const sys = build({ pools: [fakePool([TOO_FAR()])] });
    sys.fixedUpdate(DT);
    expect(sys.consumePendingTrauma()).toBe(0);
  });

  it('registers at most one near-miss even with several in-band enemies', () => {
    const sys = build({
      pools: [fakePool([IN_BAND(), enemy(100, 150), enemy(60, 100)])],
    });
    sys.fixedUpdate(DT);
    expect(sys.consumePendingTrauma()).toBeCloseTo(SCREEN_SHAKE_TRAUMA_NEARMISS, 9);
  });
});

describe('ScreenFeedbackSystem — seeded edge-detection prevs', () => {
  it('fires nothing on the first tick when constructed mid-run (no new edge)', () => {
    const bomb = fakeBomb(200); // shockwave already decaying
    const death = fakeDeath(5); // deaths already happened
    const sys = build({ bomb, death });

    bomb.shockwaveMs = 160; // continued decay, not a rise
    sys.fixedUpdate(DT);

    expect(sys.consumePendingTrauma()).toBe(0);
    expect(sys.consumeFlashRequest()).toBe(0);
    expect(sys.consumeHitStopRequest()).toBe(0);
  });
});

describe('ScreenFeedbackSystem — multiple events in one tick', () => {
  it('sums all trauma and raises flash + hit-stop once', () => {
    const bomb = fakeBomb(0);
    const sys = build({
      collision: fakeCollision(2),
      bomb,
      pools: [fakePool([IN_BAND()])],
    });

    bomb.shockwaveMs = 300; // bomb edge
    sys.fixedUpdate(DT);

    expect(sys.consumePendingTrauma()).toBeCloseTo(
      SCREEN_SHAKE_TRAUMA_BOMB +
        2 * SCREEN_SHAKE_TRAUMA_KILL +
        SCREEN_SHAKE_TRAUMA_NEARMISS,
      9,
    );
    expect(sys.consumeFlashRequest()).toBe(SCREEN_FLASH_MS);
    expect(sys.consumeHitStopRequest()).toBe(SCREEN_HITSTOP_MS);
  });
});

describe('ScreenFeedbackSystem — consume resets', () => {
  it('a second consume with no new event returns 0 / no request', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });

    bomb.shockwaveMs = 300;
    sys.fixedUpdate(DT);

    // First consume drains the latches.
    expect(sys.consumePendingTrauma()).toBeGreaterThan(0);
    expect(sys.consumeFlashRequest()).toBe(SCREEN_FLASH_MS);
    expect(sys.consumeHitStopRequest()).toBe(SCREEN_HITSTOP_MS);

    // Second consume (no new fixedUpdate/event) returns nothing.
    expect(sys.consumePendingTrauma()).toBe(0);
    expect(sys.consumeFlashRequest()).toBe(0);
    expect(sys.consumeHitStopRequest()).toBe(0);
  });
});

describe('ScreenFeedbackSystem — haptic aggregation + drain (Story 7.5)', () => {
  it('aggregates one HEAVY pulse on a death edge, drained then empty', () => {
    const death = fakeDeath(0);
    const sys = build({ death });

    death.deathSeq = 1;
    sys.fixedUpdate(DT);

    expect(drainToArray(sys)).toEqual([HAPTIC_STYLE.HEAVY]);
    // Drain empties the buffer — a second drain emits nothing.
    expect(drainToArray(sys)).toEqual([]);
  });

  it('aggregates one MEDIUM pulse on a bomb detonation edge', () => {
    const bomb = fakeBomb(0);
    const sys = build({ bomb });

    bomb.shockwaveMs = 300;
    sys.fixedUpdate(DT);

    expect(drainToArray(sys)).toEqual([HAPTIC_STYLE.MEDIUM]);
  });

  it('aggregates one LIGHT pulse on an extra-life award edge', () => {
    const extraLife = fakeExtraLife(0);
    const sys = build({ extraLife });

    extraLife.awardSeq = 1;
    sys.fixedUpdate(DT);

    expect(drainToArray(sys)).toEqual([HAPTIC_STYLE.LIGHT]);
  });

  it('collapses a multi-life award tick to a single LIGHT pulse (edge, not per-life)', () => {
    const extraLife = fakeExtraLife(0);
    const sys = build({ extraLife });

    extraLife.awardSeq = 3; // three lives awarded this tick
    sys.fixedUpdate(DT);

    expect(drainToArray(sys)).toEqual([HAPTIC_STYLE.LIGHT]);
  });

  it('emits nothing when no edge fired', () => {
    const sys = build();
    sys.fixedUpdate(DT);
    expect(drainToArray(sys)).toEqual([]);
  });

  it('aggregates all three edges landing in one tick', () => {
    const bomb = fakeBomb(0);
    const death = fakeDeath(0);
    const extraLife = fakeExtraLife(0);
    const sys = build({ bomb, death, extraLife });

    bomb.shockwaveMs = 300;
    death.deathSeq = 1;
    extraLife.awardSeq = 1;
    sys.fixedUpdate(DT);

    const out = drainToArray(sys);
    expect(out).toHaveLength(3);
    expect(out).toContain(HAPTIC_STYLE.HEAVY);
    expect(out).toContain(HAPTIC_STYLE.MEDIUM);
    expect(out).toContain(HAPTIC_STYLE.LIGHT);
  });

  it('seeds the extra-life prev so a mid-run construction fires nothing on an unchanged tick', () => {
    const extraLife = fakeExtraLife(5); // constructed after 5 lives already awarded
    const sys = build({ extraLife });

    sys.fixedUpdate(DT); // awardSeq unchanged this tick
    expect(drainToArray(sys)).toEqual([]);
  });

  it('never aggregates an extra-life pulse when no extraLifeSystem is injected', () => {
    const sys = build(); // extraLife defaults to null
    sys.fixedUpdate(DT);
    expect(drainToArray(sys)).toEqual([]);
  });

  it('accumulates pulses across sub-steps between drains (one drain per frame)', () => {
    const death = fakeDeath(0);
    const sys = build({ death });

    death.deathSeq = 1; // first sub-step: death edge
    sys.fixedUpdate(DT);
    death.deathSeq = 2; // second sub-step (same frame): another death edge
    sys.fixedUpdate(DT);

    // Both pulses survive to the single end-of-frame drain.
    expect(drainToArray(sys)).toEqual([HAPTIC_STYLE.HEAVY, HAPTIC_STYLE.HEAVY]);
  });
});

describe('ScreenFeedbackSystem — gameplay neutrality (pure observer)', () => {
  it('mutates none of the sources it reads after a busy tick', () => {
    const collision = fakeCollision(2);
    const bomb = fakeBomb(0);
    const death = fakeDeath(0);
    const ship = makeShip();
    const en = IN_BAND();
    const sys = new ScreenFeedbackSystem(collision, bomb, death, ship, [
      fakePool([en]),
    ]);

    bomb.shockwaveMs = 300; // bomb edge + 2 kills + near-miss all fire this tick

    const shipSnap = { ...ship };
    const enemySnap = { ...en };

    sys.fixedUpdate(DT);

    // Ship and enemy positions/state untouched (read-only observer).
    expect(ship).toEqual(shipSnap);
    expect(en).toEqual(enemySnap);
    // Source latches untouched by the observer (it only reads them).
    expect(collision.bulletKillCount).toBe(2);
    expect(bomb.shockwaveMs).toBe(300);
    expect(death.deathSeq).toBe(0);
  });
});
