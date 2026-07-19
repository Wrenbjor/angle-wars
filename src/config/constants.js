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

// --- Colors (0xRRGGBB) ------------------------------------------------------
export const COLOR_BACKGROUND = 0x0a0a12;
export const COLOR_ARENA_BORDER = 0x33ff99;
export const COLOR_SHIP = 0x66ccff;
export const COLOR_BULLET = 0xffee66;
export const COLOR_SEEKER = 0x3366ff;

// --- Debug readout ----------------------------------------------------------
export const COLOR_DEBUG_TEXT = '#88ffcc';
export const DEBUG_FONT = '14px monospace';
