import { describe, it, expect } from 'vitest';
import { PlayerDeathSystem } from './PlayerDeathSystem.js';
import { createPlayerState } from '../state/PlayerState.js';
import { createScoreState, resetMultiplier } from '../state/ScoreState.js';
import { createPlayerStats, recomputePlayerStats } from '../state/PlayerStats.js';
import { ITEM_REGISTRY } from '../config/itemRegistry.js';
import { PLAYER_INVULN_MS, SCORE_MULTIPLIER_START } from '../config/constants.js';

function createDummyShip() {
  return { x: 100, y: 100, vx: 0, vy: 0, angle: 0, radius: 16 };
}

describe('Reinforced Hull — System & State Integration (Story 11.8)', () => {
  it('unowned: standard 2s respawn i-frames and full 1x multiplier reset on death', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState(); // lives: 3, invulnMs: 0
    const scoreState = createScoreState();
    scoreState.multiplier = 8;
    scoreState.multiplierKills = 3;
    const playerStats = createPlayerStats();

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    // Trigger programmatic death
    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);

    expect(playerState.lives).toBe(2);
    expect(playerState.invulnMs).toBe(PLAYER_INVULN_MS); // 2000ms
    expect(scoreState.multiplier).toBe(SCORE_MULTIPLIER_START); // 1
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('Lv1 owned: grants +1 life on pick, retains 2s respawn i-frames, full multiplier reset on death', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState(); // lives: 3
    const scoreState = createScoreState();
    scoreState.multiplier = 4;
    const playerStats = createPlayerStats();

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    // Initial tick with unowned stats
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(3);

    // Recompute stats to Lv1 Reinforced Hull
    recomputePlayerStats(playerStats, { 'reinforced-hull': 1 }, ITEM_REGISTRY);
    expect(playerStats.extraLives).toBe(1);
    expect(playerStats.respawnIFramesMs).toBe(0);

    // Next fixed update syncs extra lives delta
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(4); // 3 + 1

    // Additional ticks do not re-grant lives
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(4);

    // Trigger death
    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(3);
    expect(playerState.invulnMs).toBe(2000);
    expect(scoreState.multiplier).toBe(1);
  });

  it('Lv2 owned: respawn invulnerability increases to 3.5s (3500ms)', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    const playerStats = createPlayerStats();

    recomputePlayerStats(playerStats, { 'reinforced-hull': 2 }, ITEM_REGISTRY);
    expect(playerStats.extraLives).toBe(1);
    expect(playerStats.respawnIFramesMs).toBe(1500);

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    // First tick syncs extra lives (+1 live)
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(4);

    // Trigger death
    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(3);
    expect(playerState.invulnMs).toBe(2000 + 1500); // 3500ms (3.5s)
  });

  it('Lv3 owned: grants second extra life (total +2 extra lives)', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState(); // starting lives 3
    const scoreState = createScoreState();
    const playerStats = createPlayerStats();

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    // Pick Lv1
    recomputePlayerStats(playerStats, { 'reinforced-hull': 1 }, ITEM_REGISTRY);
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(4);

    // Pick Lv3
    recomputePlayerStats(playerStats, { 'reinforced-hull': 3 }, ITEM_REGISTRY);
    expect(playerStats.extraLives).toBe(2);
    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(5); // 3 + 2 = 5
  });

  it('Lv4 owned: softens multiplier reset on death to 50%', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    scoreState.multiplier = 8;
    scoreState.multiplierKills = 4;
    const playerStats = createPlayerStats();

    recomputePlayerStats(playerStats, { 'reinforced-hull': 4 }, ITEM_REGISTRY);
    expect(playerStats.softenMultiplierReset).toBe(1);

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    deathSystem.fixedUpdate(16.6); // sync extra lives

    // Trigger death with 8x multiplier
    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);

    expect(scoreState.multiplier).toBe(4); // 8 * 0.5 = 4
    expect(scoreState.multiplierKills).toBe(0);

    // Reset invulnerability to test second death with odd multiplier 5x
    playerState.invulnMs = 0;
    scoreState.multiplier = 5;
    scoreState.multiplierKills = 2;

    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);

    expect(scoreState.multiplier).toBe(2); // Math.floor(5 * 0.5) = 2
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('Lv4 owned: multiplier at 1x on death remains clamped at 1x', () => {
    const scoreState = createScoreState();
    scoreState.multiplier = 1;
    scoreState.multiplierKills = 3;
    const playerStats = { softenMultiplierReset: 1 };

    resetMultiplier(scoreState, playerStats);

    expect(scoreState.multiplier).toBe(1); // Math.max(1, Math.floor(1 * 0.5)) = 1
    expect(scoreState.multiplierKills).toBe(0);
  });

  it('Lv5 owned: grants third extra life (3 extra, 4 max lives from base 1), 3.5s i-frames, and 50% multiplier reset', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState();
    playerState.lives = 1; // start with 1 life
    const scoreState = createScoreState();
    scoreState.multiplier = 10;
    const playerStats = createPlayerStats();

    recomputePlayerStats(playerStats, { 'reinforced-hull': 5 }, ITEM_REGISTRY);
    expect(playerStats.extraLives).toBe(3);
    expect(playerStats.respawnIFramesMs).toBe(1500);
    expect(playerStats.softenMultiplierReset).toBe(1);

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(4); // 1 + 3 = 4 total max lives

    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);

    expect(playerState.lives).toBe(3);
    expect(playerState.invulnMs).toBe(3500);
    expect(scoreState.multiplier).toBe(5);
  });

  it('sanitization: clamps invalid or non-finite values safely', () => {
    const ship = createDummyShip();
    const playerState = createPlayerState();
    const scoreState = createScoreState();
    scoreState.multiplier = 6;
    const playerStats = {
      extraLives: 99, // out of range, should clamp to 3
      respawnIFramesMs: -500, // negative, should clamp to 0
      softenMultiplierReset: NaN, // non-finite, should evaluate as disabled
    };

    const deathSystem = new PlayerDeathSystem(
      ship,
      [],
      playerState,
      scoreState,
      null,
      null,
      playerStats,
    );

    deathSystem.fixedUpdate(16.6);
    expect(playerState.lives).toBe(6); // 3 + 3 clamped

    playerState.pendingDeath = true;
    deathSystem.fixedUpdate(16.6);

    expect(playerState.invulnMs).toBe(2000); // 2000 + 0
    expect(scoreState.multiplier).toBe(1); // NaN soften -> standard reset to 1
  });
});
