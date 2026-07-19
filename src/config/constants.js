// Centralized tunable constants for Angle Wars.
//
// Every magic number that governs feel, layout, or simulation cadence lives
// here so it can be tuned in one place. Nothing in this file imports Phaser,
// keeping it usable from both the engine scenes and the headless unit tests.

// --- Arena (logical/design resolution) --------------------------------------
// The fixed logical size the game is authored against. Phaser's Scale.FIT
// mode scales this to the window while CENTER_BOTH letterboxes it, so the
// aspect ratio is preserved at any window size.
export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;

// Border inset (px, logical) and thickness for the drawn arena boundary.
export const ARENA_BORDER_INSET = 24;
export const ARENA_BORDER_THICKNESS = 4;

// --- Simulation -------------------------------------------------------------
// Fixed-timestep cadence. The simulation advances in constant slices of
// FIXED_STEP_MS regardless of render frame rate. 1000/16.6667 ≈ 60 ticks/sec.
export const FIXED_STEP_MS = 1000 / 60;

// Spiral-of-death guard: the most fixed sub-steps allowed to run for a single
// render frame. Beyond this the leftover backlog is dropped rather than
// accumulated, so a long stall (tab backgrounded, GC pause) cannot cascade
// into an ever-growing catch-up loop.
export const MAX_SUB_STEPS = 5;

// --- Player ship (feel) -----------------------------------------------------
// Velocity-based movement model. All values are tunable; motion is
// frame-rate-independent (see PlayerMovementSystem) so these read in real-world
// units: pixels per second (speed) and pixels per second squared (accel).

// Thrust: acceleration applied per second while full move-intent is held.
export const SHIP_ACCEL = 2600;
// Hard cap on ship speed (px/s); sustained thrust converges to this.
export const SHIP_MAX_SPEED = 520;
// Fraction of speed retained after one input-free second (0..1). Exponential
// drag interpolates this per fixed step, so the stop is smooth and
// frame-rate-independent. Smaller = snappier stop.
export const SHIP_DRAG_RETAIN_PER_SEC = 0.015;
// Below this speed (px/s) the ship is treated as effectively stopped: its
// facing angle is held rather than snapped from near-zero velocity noise.
export const SHIP_MIN_TURN_SPEED = 6;
// Collision/half-extent radius (px) used for arena clamping and the placeholder
// vector shape. Later stories reuse this for firing origin and collision.
export const SHIP_RADIUS = 16;

// --- Input ------------------------------------------------------------------
// Radial deadzone for the gamepad left stick: intent magnitudes at or below
// this are dropped to zero (no drift), and response is rescaled to start at 0
// at the deadzone edge so there is no jump. The right stick (aim) reuses it.
export const INPUT_DEADZONE = 0.25;

// --- Firing / bullets (feel) ------------------------------------------------
// Continuous auto-fire: while the aim channel is active the FiringSystem spawns
// one bullet every FIRE_INTERVAL_MS of accumulated fixed-step time, so the
// shots-per-second are identical regardless of render frame rate. Lower =
// faster stream. 1000/FIRE_INTERVAL_MS ≈ shots per second.
export const FIRE_INTERVAL_MS = 90;
// Bullet travel speed (px/s). Velocity derives ONLY from the aim direction ×
// this speed — never from the ship's velocity (the FR1 independence guarantee).
export const BULLET_SPEED = 900;
// Bullet collision/half-extent radius (px), also the placeholder circle radius.
// Reused by Story 1.4 collision. NOTE: this is NOT the spawn nose offset — the
// FiringSystem emits bullets from the ship's radius (SHIP_RADIUS), not this.
export const BULLET_RADIUS = 4;
// Idle bullet instances prewarmed into the pool at construction, so the steady
// state never has to allocate. Sized above the worst-case simultaneous in-flight
// count (interval, speed, arena span).
export const BULLET_POOL_PREWARM = 64;

// --- Blue Seeker enemy (feel) -----------------------------------------------
// The Seeker spawns at a random arena edge and homes toward the ship's current
// position every fixed step at a constant speed (no acceleration/turn cap), so
// its path curves naturally as the player moves. All values are tunable.

// Homing speed (px/s). Velocity each tick = unit(ship − seeker) × this.
export const SEEKER_SPEED = 140;
// Collision/half-extent radius (px), also the placeholder shape radius and the
// spawn inset margin so a fresh seeker sits fully inside the drawn border.
export const SEEKER_RADIUS = 14;
// Spawn cadence (ms): the EnemySystem spawns one seeker per this much accumulated
// fixed-step time, so spawns-per-second are frame-rate-independent. Lower = more.
export const SEEKER_SPAWN_INTERVAL_MS = 1200;
// Idle seeker instances prewarmed into the pool at construction so the expected
// steady state never allocates. Sized for the expected steady-state peak alive
// count under continuous auto-fire; there is no max-alive cap yet (a true cap
// arrives with the Epic 2 spawn director), so beyond this the pool grows lazily
// — still no per-frame allocation once warm, just a one-time factory call.
export const SEEKER_POOL_PREWARM = 32;

// --- Green Square enemy (feel) ----------------------------------------------
// The Green Square (Epic 2's first archetype) spawns at a random arena edge and
// FLEES directly away from the ship until provoked. When an active player bullet
// passes within GREEN_SQUARE_THREAT_RADIUS of it, it LATCHES to aggressive for
// the rest of its life and homes directly toward the ship (mirroring the
// Seeker's homing math). All values are tunable; motion/threat/spawn all derive
// from the fixed-step dt, so they are frame-rate-independent.

// Collision/half-extent radius (px), also the placeholder square half-size and
// the spawn inset margin so a fresh square sits fully inside the drawn border.
export const GREEN_SQUARE_RADIUS = 15;
// Flee speed (px/s) while unprovoked. Velocity each tick = unit(square − ship) ×
// this (directly away from the player).
export const GREEN_SQUARE_FLEE_SPEED = 120;
// Chase speed (px/s) once aggressive. Velocity each tick = unit(ship − square) ×
// this (directly toward the player). Faster than the flee so a provoked square
// actually closes distance.
export const GREEN_SQUARE_CHASE_SPEED = 200;
// Threat radius (px): an active bullet whose center lies within this distance of
// a fleeing square provokes it (a deterministic proxy for "fired toward it").
// Deliberately larger than BULLET_RADIUS + GREEN_SQUARE_RADIUS so a NEAR MISS
// provokes while a direct hit destroys (the latch is recorded before collision).
export const GREEN_SQUARE_THREAT_RADIUS = 90;
// Spawn cadence (ms): one square spawns per this much accumulated fixed-step
// time, so spawns-per-second are frame-rate-independent. Lower = more.
export const GREEN_SQUARE_SPAWN_INTERVAL_MS = 1600;
// Idle instances prewarmed into the pool at construction so the steady state
// never allocates (mirrors the Seeker pool prewarm; grows lazily beyond it).
export const GREEN_SQUARE_POOL_PREWARM = 32;
// Base score awarded per Green Square kill, carried on each instance and summed
// unmultiplied by the ScoringSystem (the multiplier is Epic 3 — never fold it in).
export const GREEN_SQUARE_SCORE = 150;

// --- Player death / lives (feel) --------------------------------------------
// Player lifecycle: lives, respawn invulnerability, and the invuln blink. All
// tunable; the invulnerability window and its blink are tracked in milliseconds
// against the fixed-step dt so they are frame-rate-independent.

// Starting lives at the beginning of a run.
export const PLAYER_START_LIVES = 3;
// Respawn invulnerability window (ms): after a death that respawns the ship,
// enemy contact does no harm for this long. Counted down by the fixed-step dt.
export const PLAYER_INVULN_MS = 2000;
// Blink cadence (ms) for the invulnerability indication: the ship sprite's alpha
// toggles every this-many ms of remaining invulnerability. Purely a render cue
// derived from sim state (invulnMs) — no separate render timer.
export const PLAYER_INVULN_BLINK_MS = 120;

// --- Scoring / run economy --------------------------------------------------
// Base score awarded per Blue Seeker kill. This is the enemy's own per-type
// base value (carried on each Seeker instance) summed across kills each tick —
// NEVER multiplied here. The score multiplier is deliberately deferred to
// Epic 3 / Story 3.1; do not fold a multiplier into this value.
export const SEEKER_SCORE = 100;

// --- Colors (0xRRGGBB) ------------------------------------------------------
export const COLOR_BACKGROUND = 0x0a0a12;
export const COLOR_ARENA_BORDER = 0x33ff99;
export const COLOR_SHIP = 0x66ccff;
export const COLOR_BULLET = 0xffee66;
export const COLOR_SEEKER = 0x3366ff;
export const COLOR_GREEN_SQUARE = 0x66ff33;

// --- Debug readout ----------------------------------------------------------
export const COLOR_DEBUG_TEXT = '#88ffcc';
export const DEBUG_FONT = '14px monospace';

// --- HUD (score + lives readout) --------------------------------------------
// The live HUD text drawn each render frame in ArenaScene. Placeholder styling
// only (Epic 4 owns the signature aesthetic); centralized so layout/feel is
// tunable in one place.
export const COLOR_HUD_TEXT = '#e6f2ff';
export const HUD_FONT = '20px monospace';

// --- Game-over overlay ------------------------------------------------------
// Shown when PlayerState.gameOver is true: a dimming full-arena rectangle plus
// final-score and restart-prompt text. Placeholder styling only (Epic 4).
// Overlay fill color and its alpha (0..1) for the dimming rectangle.
export const COLOR_GAMEOVER_OVERLAY = 0x000000;
export const GAMEOVER_OVERLAY_ALPHA = 0.65;
// Text color shared by the game-over title, final score, and restart prompt.
export const COLOR_GAMEOVER_TEXT = '#ffffff';
// Fonts for the three stacked lines of the game-over screen.
export const GAMEOVER_TITLE_FONT = '48px monospace';
export const GAMEOVER_SCORE_FONT = '28px monospace';
export const GAMEOVER_PROMPT_FONT = '20px monospace';
