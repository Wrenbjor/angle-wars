// Centralized tunable constants for Angle Wars.
//
// Every magic number that governs feel, layout, or simulation cadence lives
// here so it can be tuned in one place. Nothing in this file imports Phaser,
// keeping it usable from both the engine scenes and the headless unit tests.

// --- Arena (logical/design resolution) --------------------------------------
// The fixed logical size the game is authored against. Phaser's Scale.FIT
// mode scales this to the window while CENTER_BOTH letterboxes it, so the
// aspect ratio is preserved at any window size.
//
// Width is 1560 (not 1280): a 1560×720 arena is 19.5:9, matching modern tall
// phones (e.g. Galaxy S25 Ultra, 2340×1080) so Scale.FIT fills the screen edge-
// to-edge with no letterbox bars. Height stays 720. On a classic 16:9 display
// this letterboxes with thin top/bottom bars instead — an accepted trade for a
// full-bleed phone experience. (Fully per-device-adaptive width is a possible
// future refinement; a fixed design resolution keeps the headless sim + tests
// deterministic.)
export const ARENA_WIDTH = 1560;
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

// --- Player DPS telemetry (Story 9.1 / Epic 9) ------------------------------
// The DpsTelemetrySystem maintains a rolling estimate of player weapon output
// (the build-power signal Story 9.2's adaptive spawn director consumes). The
// estimate is a rolling average over the last DPS_WINDOW_MS of simulated time,
// advanced ONLY by the fixed step (never wall-clock), so it is frame-rate-
// independent by construction. Both values are tunable placeholders.
//
// Rolling-window length (ms). A single kill contributes only its averaged share
// (1 / (window in seconds)) so the estimate can never spike on an individual
// hit, and a sustained change in output tracks in/out gradually over the window.
export const DPS_WINDOW_MS = 10000;
// v1 one-shot damage model: one player bullet-kill == one damage unit (every
// enemy is one-shot today). This is the Story 9.3 refinement seam — armored HP
// will refine per-kill crediting through this same constant + the `dps` surface
// without changing the telemetry system's shape.
export const DPS_DAMAGE_PER_KILL = 1;

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
// Per-channel radial deadzones for the gamepad sticks: intent magnitudes at or
// below the channel's deadzone are dropped to zero (no drift), and the response
// is rescaled to start at 0 at the deadzone edge so there is no jump. Both feed
// the shared applyRadialDeadzone. The AIM deadzone is deliberately LARGER than
// the MOVE deadzone: aim rotation from a barely-touched/resting right stick is
// more visible (it swings the fire vector) than a tiny translation, so a resting
// or brushed right stick must never rotate the fire direction.
export const MOVE_DEADZONE = 0.25;
export const AIM_DEADZONE = 0.3;
// Gamepad button indices (standard mapping) that trigger a smart bomb: the two
// shoulder bumpers (LB=4, RB=5). Either fires the bomb, mirroring "either Shift"
// on the keyboard. Edge-triggered through InputState.queueBomb (one press → one
// detonation); never polled and re-queued per frame.
export const GAMEPAD_BOMB_BUTTONS = [4, 5];

// --- Touch twin-stick controls (Story 7.1) ----------------------------------
// The touch input method (INPUT_METHOD.TOUCH): a left-half floating move stick, a
// right-half floating aim stick (held → auto-fire), and one on-screen smart-bomb
// button. All geometry is in base-resolution / screen space (pointer.x/y — the
// 1280×720 logical unit space without camera-shake scroll, see Story 7.2), split at
// ARENA_WIDTH / 2, so a screen touch classifies into the correct half shake-stably.
// Device-specific placement / thumb reach / safe areas landed in Story 7.2: these
// base values are inset-adjusted at RUNTIME (the smart-bomb button via setBombButton
// off the mobileLayout safe-area seam; the sticks float to the thumb inherently), so
// they are live-adjusted rather than "tuned later" — no magic numbers in the touch
// model or the overlay draw helper.

// Floating-stick reach (px, logical): the deflection distance that maps to full
// (magnitude 1) move intent. deflection / this feeds InputState.setMove, which
// clamps to the unit circle; the aim stick normalizes its deflection to a unit
// direction so this value does not affect aim, only move gain and the drawn ring.
export const TOUCH_STICK_MAX_RADIUS = 120;
// Origin deadzone (px, logical): a deflection at or within this of the stick base
// produces no move intent and registers no aim direction, so a resting/jittering
// thumb neither drifts the ship nor rotates the fire vector (mirrors the gamepad
// radial deadzone intent, expressed in pixels of thumb travel).
export const TOUCH_STICK_DEADZONE = 10;
// Smart-bomb button geometry (center + radius, px, logical). A pointerdown whose
// point is within `radius` of (x, y) latches exactly one bomb (no stick spawned),
// regardless of how long it is held. Placed bottom-center — a neutral zone the
// bomb-first classification claims before the left/right half split. Tuned later.
export const TOUCH_BOMB_BUTTON = {
  x: ARENA_WIDTH / 2,
  y: ARENA_HEIGHT - 84,
  radius: 60,
};
// Touch overlay draw style (view-only placeholder; Epic 4 / Story 7.2 own the real
// aesthetic). The base ring is drawn at each active stick's base at MAX_RADIUS; the
// thumb knob follows the current touch point at KNOB_RADIUS. Colors are 0xRRGGBB and
// alpha is 0..1. PRESSED_ALPHA brightens the bomb button while a finger holds it.
export const TOUCH_OVERLAY_KNOB_RADIUS = 40;
export const TOUCH_OVERLAY_LINE_WIDTH = 3;
export const TOUCH_OVERLAY_ALPHA = 0.35;
export const TOUCH_OVERLAY_BOMB_PRESSED_ALPHA = 0.6;
export const COLOR_TOUCH_STICK_BASE = 0x66ccff;
export const COLOR_TOUCH_STICK_KNOB = 0xffffff;
export const COLOR_TOUCH_BOMB = 0xff66cc;

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
// Idle instances prewarmed into the pool at construction so the steady state
// never allocates (mirrors the Seeker pool prewarm; grows lazily beyond it).
export const GREEN_SQUARE_POOL_PREWARM = 32;
// Base score awarded per Green Square kill, carried on each instance. The
// ScoringSystem multiplies this base by the run multiplier at the shared per-kill
// seam; keep this a flat per-type base — never fold the multiplier into it.
export const GREEN_SQUARE_SCORE = 150;

// --- Pinwheel / Wanderer enemy (feel) ---------------------------------------
// The Pinwheel (Epic 2's "Wanderer") spawns at a random arena edge with a random
// heading and drifts at a CONSTANT speed along a pseudo-random (wandering) path:
// it periodically re-rolls its heading by a bounded random turn and BOUNCES
// (reflects) off the arena walls. Unlike the Seeker (homes) and Green Square
// (flees/aggros), it is INDIFFERENT to the player — it never reads the ship or
// bullets. All values are tunable; wander cadence, motion, and spawn all derive
// from the fixed-step dt, so they are frame-rate-independent.

// Collision/half-extent radius (px), also the placeholder diamond half-size and
// the spawn/bounce inset margin so a pinwheel sits fully inside the drawn border.
export const PINWHEEL_RADIUS = 14;
// Drift speed (px/s). Magnitude of the velocity vector, PRESERVED across wander
// turns (rotation) and wall bounces (component negation) — the drifter never
// speeds up or stalls.
export const PINWHEEL_DRIFT_SPEED = 130;
// Wander cadence (ms): every this much accumulated fixed-step time, a pinwheel
// re-rolls its heading by a bounded random turn. Per-instance accumulator, so
// the re-roll COUNT over elapsed sim time is tick-size independent. Lower = more
// frequent heading changes (twitchier wander).
export const PINWHEEL_WANDER_INTERVAL_MS = 700;
// Max heading turn per wander (radians). Each re-roll rotates the velocity by a
// uniform random angle in [−this, +this]. Larger = more erratic meander.
export const PINWHEEL_WANDER_MAX_TURN_RAD = Math.PI / 6; // 30°
// Idle instances prewarmed into the pool at construction so the steady state
// never allocates (mirrors the Seeker/Green Square pools; grows lazily beyond it).
export const PINWHEEL_POOL_PREWARM = 32;
// Base score awarded per Pinwheel kill, carried on each instance. The
// ScoringSystem multiplies this base by the run multiplier at the shared per-kill
// seam; keep this a flat per-type base — never fold the multiplier into it.
export const PINWHEEL_SCORE = 125;

// --- Snake enemy (feel) -----------------------------------------------------
// The Snake (Epic 2's large threat) is a chain of pooled segments that follows a
// self-propelled slithering head. The head drifts at a CONSTANT speed along a
// serpentine path (its heading oscillates sinusoidally) and BOUNCES (reflects)
// off the arena walls; each following segment geometrically trails the one ahead
// at a fixed spacing. Like the Pinwheel it is INDIFFERENT to the player — the
// SnakeSystem never reads the ship or bullets for motion. Every segment (head
// included) is a uniform {x,y,vx,vy,radius,score} instance in ONE shared segment
// pool, so it plugs into the existing enemyPools seams for lethal-on-contact and
// bullet-kill+score with no seam changes. Killing a mid-body segment splits the
// snake into two independent snakes ("breaks apart"). All values are tunable;
// slither cadence and spawn all derive from the fixed-step dt, so they are
// frame-rate-independent.

// Collision/half-extent radius (px) of one segment, also the placeholder circle
// radius and the spawn/bounce inset margin so a segment sits inside the border.
export const SNAKE_SEGMENT_RADIUS = 12;
// Head drift speed (px/s). The head advances by this along its (slither-modulated)
// heading every fixed step; the constant speed reads as a steady slither.
export const SNAKE_HEAD_SPEED = 120;
// Fixed spacing (px) each body segment is pulled to behind the one ahead of it
// (the follow-the-leader constraint distance). A touch under 2×radius so the
// drawn segments overlap into a connected-looking body.
export const SNAKE_SEGMENT_SPACING = 22;
// Number of segments in a freshly spawned snake, head (segments[0]) included.
export const SNAKE_SEGMENT_COUNT = 8;
// Slither amplitude (radians): the peak deviation of the head's effective heading
// from its base heading. eff = base + sin(phase)·amplitude, so the head weaves
// ±this around the direction it is travelling.
export const SNAKE_SLITHER_AMPLITUDE_RAD = Math.PI / 4; // 45°
// Slither angular velocity (radians per SECOND): how fast the slither phase
// advances. phase += this·dtSec, so the accumulated phase over elapsed sim time
// is tick-size independent (a frame-rate-independent slither cadence).
export const SNAKE_SLITHER_ANG_VEL_RAD_PER_SEC = 3.0;
// Idle SEGMENT instances prewarmed into the shared segment pool at construction
// so the steady state never allocates on the move path (grows lazily beyond it,
// only on spawn events — mirrors the other archetype pools). Sized for several
// full snakes at once (SEGMENT_COUNT each).
export const SNAKE_SEGMENT_POOL_PREWARM = 64;
// Base score awarded per killed SEGMENT (head or body), carried on each instance.
// The ScoringSystem multiplies this base by the run multiplier at the shared
// per-kill seam; keep this a flat per-type base — never fold the multiplier in.
// A whole snake is worth SEGMENT_COUNT × this (× the multiplier in effect).
export const SNAKE_SEGMENT_SCORE = 75;

// --- Mirror Reflector (Dumbbell) hazard (feel / geometry / economy) ----------
// The Mirror Reflector (Story 6.3) is the one hazard that RESISTS firepower. It
// is rendered as a spinning DUMBBELL: two lethal weights joined by a bar. Like a
// pooled Pinwheel it DRIFTS at a constant speed and BOUNCES off the inset walls,
// and additionally SPINS (angle advances every fixed step) — all dt-driven, so
// motion is frame-rate-independent. It is INDIFFERENT to the player's aim. What
// makes it distinct:
//   - It is IMMUNE to gunfire: a player bullet striking the BAR is REFLECTED
//     (velocity mirrored across the bar's normal, |v| preserved) and stays a live
//     player shot — the reflector takes no damage. So it is deliberately NOT in the
//     CollisionSystem / BombSystem / BlackHole / PlayerDeathSystem shared-circle
//     seams (it has no uniform {x,y,radius} lethal circle — its lethal region is the
//     two weights). It owns its own bullet/ship tests in MirrorReflectorSystem.
//   - It is destroyed ONLY by flying the ship through its CENTER point (a flat score
//     payout, credited directly to scoreState.score like the Black Hole implosion —
//     never through the ScoringSystem multiplier seam).
//   - Touching EITHER weight kills the player through the normal death flow (sets
//     playerState.pendingDeath, the Story 6.2 seam; PlayerDeathSystem consumes it).
// All values are tunable placeholders (tuned post-launch); no inline magic numbers.

// Drift speed (px/s). Magnitude of the velocity vector, PRESERVED across wall
// bounces (component negation) — the dumbbell never speeds up or stalls.
export const REFLECTOR_DRIFT_SPEED = 110;
// Spin rate (radians per SECOND): angle += this·dtSec every fixed step, so the
// accumulated rotation over elapsed sim time is tick-size independent (a
// frame-rate-independent spin). The bar/weights rotate about the center point.
export const REFLECTOR_SPIN_RATE = 1.8;
// Bar half-length (px): the distance from the center to EACH weight endpoint (the
// bar is the segment between the two endpoints, total length 2×this). Invariant:
// must be > REFLECTOR_CENTER_KILL_RADIUS so the center-kill zone sits inside the
// bar, disjoint from the weight ends in the common case.
export const REFLECTOR_BAR_HALF_LENGTH = 48;
// Bar half-thickness (px): the reflect proximity band. A bullet reflects when its
// center is within BULLET_RADIUS + this of the bar segment (a thin metal bar).
export const REFLECTOR_BAR_HALF_THICKNESS = 6;
// Weight radius (px): the collision radius of EACH lethal end weight. Ship contact
// with either weight (dist ≤ ship.radius + this) is a weight-kill.
export const REFLECTOR_WEIGHT_RADIUS = 14;
// Center-kill radius (px): the ship destroys the reflector by threading its center
// (dist(ship, center) ≤ this). Kept < REFLECTOR_BAR_HALF_LENGTH so the reward zone
// sits inside the bar, disjoint from the weights in the common case — a real
// "thread the needle" window, not an accidental brush.
export const REFLECTOR_CENTER_KILL_RADIUS = 18;
// Flat score payout for threading the center. Credited DIRECTLY to scoreState.score
// (an event payout like the Black Hole safe-implosion) — never through the
// killedEnemies/ScoringSystem seam, so it is NEVER multiplied by the run multiplier.
export const REFLECTOR_SCORE = 500;
// Idle instances prewarmed into the pool at construction so the steady state never
// allocates (grows lazily beyond it, only on spawn events — mirrors the other pools).
export const REFLECTOR_POOL_PREWARM = 4;
// Per-type active cap enforced in spawn(): spawn() is a no-op at/above this. Because
// the reflector is UNKILLABLE by fire/bombs, without a self-cap it would pile up (the
// SpawnDirector has only a GLOBAL cap). Bounds the O(reflectors × bullets) reflect scan.
export const REFLECTOR_MAX_ACTIVE = 3;
// Documented deferred tunable (Story 6.3): whether a reflected bullet can harm the
// player. Defaults false — reflected bullets stay the same pooled PLAYER bullets and
// are harmless to the player by construction (no ship-vs-player-bullet seam exists).
// Wiring the harm-player branch (a NEW seam) is deferred post-launch; this constant
// is defined now so the intent is centralized and discoverable.
export const REFLECTED_BULLET_HARMS_PLAYER = false;

// --- Armored enemy (feel / durability / spawn gate) (Story 9.3 / Epic 9) -----
// The Armored enemy is the late-run counter that keeps melee/mine/AoE builds
// relevant against a pure-projectile build. It is a slow homing chaser (mirrors
// the Seeker's homing) with multi-hit `hp`: ONLY the projectile path
// (CollisionSystem) decrements `hp` and releases at 0, so projectiles deal
// REDUCED effective damage (ARMORED_HP hits to kill) while the AoE/melee paths
// (smart bomb, black hole) — which release enemies unconditionally regardless of
// `hp` — deal FULL damage for free. It is NEVER immune to anything. It spawns
// through the SAME SpawnDirector + telegraph seam as every other archetype, gated
// to appear only once a run passes ~15:00 OR build power (director `pressure`)
// crosses a threshold (via the director's late-bound canSpawn() opt-out — the
// Mirror Reflector cap precedent). All values are tunable placeholders (tuned
// post-launch), mirroring the SEEKER_*/REFLECTOR_* discipline.

// Collision/half-extent radius (px), also the placeholder shape radius and the
// spawn inset margin so a fresh armored sits fully inside the drawn border.
export const ARMORED_RADIUS = 20;
// Homing speed (px/s). Velocity each tick = unit(ship − armored) × this. Slow
// (below the Seeker) — it is a durable bruiser, not a fast chaser.
export const ARMORED_SPEED = 70;
// Bullet hits to kill: the armored survives (ARMORED_HP − 1) projectile hits and
// is destroyed on the ARMORED_HP-th. ONLY the CollisionSystem (bullet) path reads
// this; the AoE/melee paths ignore it (full damage — one hit). Tunable.
export const ARMORED_HP = 5;
// Base score awarded per Armored kill, carried on each instance. The ScoringSystem
// multiplies this base by the run multiplier at the shared per-kill seam; keep this
// a flat per-type base — never fold the multiplier into it. Higher than the one-hit
// archetypes (it is a tougher kill).
export const ARMORED_SCORE = 300;
// Base per-type XP value dropped as an orb when this armored is bullet-KILLED (the
// final hit). A non-killing armor hit drops no orb (kill-only economy).
export const ARMORED_XP = 4;
// Idle instances prewarmed into the pool at construction so the steady state never
// allocates (grows lazily beyond it, only on spawn events — mirrors the other pools).
export const ARMORED_POOL_PREWARM = 8;
// Spawn gate — TIME arm: the armored becomes eligible once elapsed sim time reaches
// this (~15:00). Until then (and below the pressure arm) canSpawn() is false so the
// director never picks it — its share flows to the eligible archetypes. Tunable.
export const ARMORED_MIN_ELAPSED_MS = 900000; // 15:00
// Spawn gate — BUILD-POWER arm: the armored is ALSO eligible (even before
// ARMORED_MIN_ELAPSED_MS) once the director's `pressure` reaches this, so a strong
// build is answered early with the diversify-or-struggle counter. Tunable.
export const ARMORED_PRESSURE_THRESHOLD = 1.0;

// --- Spawn Director (escalation / mix / cap) --------------------------------
// The SpawnDirector is the SOLE spawn authority for the four one-hit combat
// archetypes (Seeker, Green Square, Pinwheel, Snake). It owns a continuous
// difficulty ramp driven purely by elapsed sim time (Σ fixed-step dt, so it is
// frame-rate-independent): the spawn interval shrinks from BASE toward MIN and
// each archetype's mix weight interpolates from its BASE toward its PEAK over the
// ramp duration, then holds flat. A global active-instance cap bounds peak load.
// All values are tunable placeholders (tuned post-launch). The Black Hole is a
// separately-capped hazard and is NOT part of this swarm mix.

// Spawn interval (ms) at run start (elapsed 0): the light opening trickle.
export const SPAWN_DIRECTOR_BASE_INTERVAL_MS = 1500;
// Spawn interval (ms) floor, reached at RAMP_DURATION and held flat thereafter —
// the fastest the swarm ever spawns. The interval is monotonic non-increasing.
export const SPAWN_DIRECTOR_MIN_INTERVAL_MS = 350;
// Ramp duration (ms): the elapsed sim time over which the interval falls from
// BASE to MIN and every mix weight interpolates from BASE to PEAK. Past this the
// difficulty holds at its peak (an endless steady peak, never a reset).
export const SPAWN_DIRECTOR_RAMP_DURATION_MS = 120000; // 2 minutes
// Global active-instance cap summed across the four director pools (a snake
// counts as its live segments — the honest per-frame cost). At or above this the
// director skips the spawn and discards that interval's banked time (mirrors the
// Black Hole's at-cap behavior). Bounds peak load so the ever-rising spawn rate
// cannot break the frame budget; it never despawns already-active enemies.
export const SPAWN_DIRECTOR_MAX_ACTIVE = 60;

// Per-archetype mix weights: the relative selection likelihood at the START of
// the ramp (BASE, elapsed 0) and at its PEAK (elapsed >= RAMP_DURATION). A weight
// of 0 makes an archetype unselectable at that point. The Snake's BASE is 0 (held
// back early) and PEAK is positive (present late) so the mix observably shifts
// toward tougher combinations as a run wears on.
export const SPAWN_DIRECTOR_SEEKER_BASE_WEIGHT = 5;
export const SPAWN_DIRECTOR_SEEKER_PEAK_WEIGHT = 4;
export const SPAWN_DIRECTOR_GREEN_BASE_WEIGHT = 3;
export const SPAWN_DIRECTOR_GREEN_PEAK_WEIGHT = 4;
export const SPAWN_DIRECTOR_PINWHEEL_BASE_WEIGHT = 1;
export const SPAWN_DIRECTOR_PINWHEEL_PEAK_WEIGHT = 3;
export const SPAWN_DIRECTOR_SNAKE_BASE_WEIGHT = 0;
export const SPAWN_DIRECTOR_SNAKE_PEAK_WEIGHT = 2;
// The Mirror Reflector (Story 6.3) is a fifth governed spawnable. It is NOT a
// one-hit archetype (immune to fire/bombs), but it spawns through the SAME director
// + telegraph and counts toward the global cap like any other. Held back early
// (BASE 0) and present late (PEAK positive) so the mix shifts toward the
// positioning-and-nerve challenge as a run wears on.
export const SPAWN_DIRECTOR_REFLECTOR_BASE_WEIGHT = 0;
export const SPAWN_DIRECTOR_REFLECTOR_PEAK_WEIGHT = 2;
// The Armored enemy (Story 9.3) is a sixth governed spawnable. Its mix weight is
// FLAT (base === peak): because base === peak, weightAt() returns the same value at
// every ramp progress p, so the 2-minute weight ramp is a no-op for the armored in
// BOTH gate arms — the always-late time arm AND the possibly-early build-power
// (pressure) arm, which can open the gate before the ramp would even saturate. The
// flat base===peak (not ramp saturation) is what makes the ramp moot. The real
// hold-back is the temporal/pressure canSpawn() gate: it zeroes this weight until the
// run passes ARMORED_MIN_ELAPSED_MS OR pressure crosses ARMORED_PRESSURE_THRESHOLD.
// Tunable placeholders.
export const SPAWN_DIRECTOR_ARMORED_BASE_WEIGHT = 3;
export const SPAWN_DIRECTOR_ARMORED_PEAK_WEIGHT = 3;

// --- Build-adaptive spawn governor (Story 9.2 / Epic 9) ---------------------
// The damped adaptive rate lever layered onto the v1 time ramp above. The
// SpawnDirector consumes the rolling player DPS signal (Story 9.1) through a
// slew-rate-limited `pressure` scalar that shortens the effective spawn interval
// BELOW the v1 curve: effectiveInterval = intervalAt(elapsed) / (1 + pressure),
// with pressure >= 0 so the v1 interval is a HARD FLOOR (adaptive only ever adds
// pressure, never removes it; pressure 0 == byte-identical v1 behavior). All three
// are tunable placeholders (tuned post-launch), mirroring the SPAWN_DIRECTOR_*
// discipline — no inline magic numbers on the governor path.

// DPS that maps to +1.0 pressure (the interval halves at this sustained output).
// The pressure target is clamp(dps / this, 0, MAX_PRESSURE), so a linear read of
// build power into rate pressure.
export const SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE = 8;
// Pressure cap: the fastest the adaptive layer ever drives the rate is
// floor/(1+MAX), i.e. up to 3× the v1 spawn rate. With the existing MAX_ACTIVE
// cap this bound is the death-spiral guard — no separate min-interval clamp.
export const SPAWN_DIRECTOR_MAX_PRESSURE = 2;
// Slew-rate limit: the most |Δpressure| may change per millisecond of fixed-step
// time. A full 0→MAX swing takes ≈ MAX / this ms ≈ 10s (matching the ~10s DPS
// window), so the governor tracks build power smoothly and cannot overshoot or
// oscillate toward a constant target (monotonic by construction).
export const SPAWN_DIRECTOR_PRESSURE_SLEW_PER_MS = 0.0002;

// --- Governor boost hook (Story 9.4) ----------------------------------------
// The single reusable transient-boost seam that proves the Epic 9 governor
// answers a sudden power spike (power-in → threat-out) and re-settles as it
// fades. A boost is folded into the SAME `dps` signal the governor already
// consumes (DpsTelemetrySystem.applyBoost), so the whole 9.2 slew response +
// 9.3 armored gating answer with NO new balancing surface — no new director
// input, no second pressure knob. Both values are tunable placeholders (tuned
// post-launch), mirroring the SPAWN_DIRECTOR_* discipline. Epic 13's Generosity
// Engine wires its real cheat-code rewards to applyBoost() with THESE defaults,
// reusing the identical, already-validated governor path.

// Boost magnitude in damage-units/sec — the cheat-code stand-in. The boost ADDS
// to the live rolling dps, so at SPAWN_DIRECTOR_DPS_PRESSURE_REFERENCE=8 the
// pressure target is (dps + 24)/8 ≥ 24/8 = 3 — always at least 3, clamped to
// SPAWN_DIRECTOR_MAX_PRESSURE=2: a clear, bounded, saturating spike (it saturates
// at least as hard as the standalone figure, harder still atop existing output).
export const GOVERNOR_BOOST_DPS = 24;
// Boost fade time (ms): the transient decays linearly to 0 over this span of sim
// time (frame-rate-independent). ~run-length, comparable to the 10s DPS window.
export const GOVERNOR_BOOST_DURATION_MS = 8000;

// --- Enemy spawn telegraph / spawn-point safety (Story 2.6) ------------------
// Every freshly spawned enemy of every archetype (Seeker, Green Square,
// Pinwheel, Snake segments, Black Hole, and Black-Hole-fed seekers) carries a
// brief per-instance telegraph countdown. While it runs the instance is
// NON-LETHAL to the player (PlayerDeathSystem skips it) and FROZEN (its owning
// system skips its behavior tick) — it only renders a spawn-in cue. When the
// countdown reaches 0 the instance activates: normal behavior and lethal contact
// begin together. All values are tunable placeholders (tuned post-launch); the
// countdown advances ONLY by fixed-step dt, so the window is frame-rate-independent.

// Telegraph duration (ms): how long a fresh enemy stays frozen + non-lethal
// before activating. A brief safe window — the primary "no enemy on top of me"
// guarantee (FR5). Counted down by the owning system's fixed-step dt.
export const ENEMY_SPAWN_TELEGRAPH_MS = 600;
// Spawn-point ship-avoidance radius (px): the second safety layer. Each spawn
// placement re-rolls to keep the chosen point at least this far from the ship's
// current position, so a fresh enemy does not materialize on/next to the player.
export const SPAWN_SAFE_RADIUS = 200;
// Bounded re-roll cap: the most placement attempts a single spawn makes to land
// outside SPAWN_SAFE_RADIUS. If every attempt is too close (player boxed into a
// corner) the last candidate is accepted — the loop is NEVER unbounded (the
// telegraph is the primary guarantee; avoidance is best-effort within this cap).
export const SPAWN_PLACEMENT_MAX_ATTEMPTS = 8;
// Telegraph render cue (view-only): a spawning instance fades in (alpha) and
// scales up (radius) from these floors to full over the telegraph window. Per
// instance p = 1 − clamp(telegraphMs/ENEMY_SPAWN_TELEGRAPH_MS, 0, 1); alpha =
// MIN_ALPHA + (1−MIN_ALPHA)·p, radius × (MIN_SCALE + (1−MIN_SCALE)·p). At p==1
// (active) alpha 1 / scale 1 — today's rendering. Placeholders (Epic 4 owns the
// real aesthetic).
export const SPAWN_TELEGRAPH_MIN_ALPHA = 0.15;
export const SPAWN_TELEGRAPH_MIN_SCALE = 0.4;

// --- Black Hole hazard (feel / economy) -------------------------------------
// The Black Hole (Epic 2's signature high-risk object, reworked in Story 6.2) is
// a stationary, UNSTABLE ticking bomb — NOT a one-hit enemy and no longer an
// HP-based destructible. Each fixed step it applies an attractive POSITION nudge
// to every nearby ship/bullet/enemy (linear inverse-distance falloff, dt-scaled,
// so it survives the movers that integrate x += v·dt and never assign absolute
// positions) and ABSORBS the bullets/enemies that reach its body. Absorbed enemies
// GROW its radius toward an unstable threshold; absorbed player bullets SHRINK it
// toward a floor. `radius` is the single instability metric: crossing
// BLACKHOLE_UNSTABLE_RADIUS DETONATES (a smart-bomb screen clear that also costs
// the player a life), while shrinking to BLACKHOLE_MIN_RADIUS is a safe IMPLOSION
// that destroys it for its score payout. There is NO passive time-based growth and
// NO feed-driven seeker emission — the instability clock is the hole's only threat.
// All values are tunable placeholders (tuned post-launch); every cadence/motion
// value derives from the fixed-step dt so it is frame-rate-independent.

// Initial collision/gravity-source radius (px) of a freshly spawned hole, also
// the placeholder circle radius and the interior-spawn inset margin. This is the
// instability floor of the escalation curve (blackHoleInstability == 0 here).
export const BLACKHOLE_RADIUS = 26;
// Unstable threshold (px): the radius at/above which the hole DETONATES (screen
// clear + life cost). It is the largest radius a hole reaches — the instability
// ceiling (blackHoleInstability == 1 here). Absorbed enemies grow the radius
// toward this; must be > BLACKHOLE_RADIUS.
export const BLACKHOLE_UNSTABLE_RADIUS = 70;
// Safe-implosion floor (px): the radius at/below which sustained player fire has
// shrunk the hole enough to safely defuse it (score payout + removal, no blast).
// Must be < BLACKHOLE_RADIUS so a freshly spawned hole is not already imploding.
export const BLACKHOLE_MIN_RADIUS = 12;
// Gravity reach (px): entities strictly inside this distance from the hole center
// are pulled; anything at or beyond it is unaffected.
export const BLACKHOLE_GRAVITY_RADIUS = 340;
// Gravity strength (px/s) at the core. The per-step pull magnitude is
// STRENGTH·(1 − d/GRAVITY_RADIUS)·dtSec, so it is strongest near the core and
// fades linearly to zero at the radius, and scales with dt (frame-rate-independent).
export const BLACKHOLE_GRAVITY_STRENGTH = 300;
// Radius growth (px) per absorbed enemy — the instability the hole gains each time
// it devours matter. BLACKHOLE_RADIUS + n·this reaching BLACKHOLE_UNSTABLE_RADIUS
// is roughly the enemies-to-detonation count if the player ignores it.
export const BLACKHOLE_GROWTH_PER_ABSORB = 4;
// Radius shrink (px) per absorbed player bullet — the inverse of feeding. Sustained
// fire drives the radius down toward BLACKHOLE_MIN_RADIUS for the safe implosion;
// (BLACKHOLE_RADIUS − BLACKHOLE_MIN_RADIUS) / this ≈ the bullets to defuse a fresh hole.
export const BLACKHOLE_SHRINK_PER_BULLET = 1;
// Self-spawn cadence (ms): one hole spawns per this much accumulated fixed-step
// time (subject to the max-active cap), so spawns are frame-rate-independent.
// Long — the hole is a rare, signature hazard.
export const BLACKHOLE_SPAWN_INTERVAL_MS = 14000;
// Per-archetype active cap: a sanity guard so the O(holes × entities) gravity
// pass stays bounded (default 1 = one hole at a time, matching RE1's rare-hazard
// feel). This is NOT the spawn director's global cap/mix/ramp (Story 2.5).
export const BLACKHOLE_MAX_ACTIVE = 1;
// Idle hole instances prewarmed into the pool at construction so the steady state
// never allocates on the gravity/absorb path (grows lazily beyond it, only on
// spawn events — mirrors the other archetype pools).
export const BLACKHOLE_POOL_PREWARM = 2;
// Safe-implosion payout: score credited directly to ScoreState when the player
// shrinks a hole to BLACKHOLE_MIN_RADIUS and it safely implodes. An event payout
// (not a per-tick one-hit kill), so it is added to the shared score surface
// directly, NEVER through the killedEnemies/ScoringSystem seam and so NEVER
// multiplied by the run multiplier — this hazard credit stays flat by design (the
// multiplier applies only to enemy-kill awards at the seam). A DETONATION pays
// nothing: letting the hole blow costs a life, defusing it banks this.
export const BLACKHOLE_SCORE = 1000;

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
// base value (carried on each Seeker instance) summed across kills each tick.
// The ScoringSystem multiplies this base by the current run multiplier (below)
// at the single per-kill seam; the base value itself stays a flat per-type
// constant here — do not fold a multiplier into this value.
export const SEEKER_SCORE = 100;

// Score multiplier (Story 3.1): the RE1 run economy. Every per-kill award at the
// ScoringSystem seam is base × the current multiplier. The multiplier starts at
// START, climbs one step for every KILLS_PER_STEP kills without dying, is hard
// capped at MAX, and is reset to START the instant the player dies. All tuning
// lives here — no inline magic numbers on the scoring hot path.
// Initial (and post-death reset) multiplier value.
export const SCORE_MULTIPLIER_START = 1;
// Hard cap: the multiplier never exceeds this (RE1 fidelity, 10× ceiling).
export const SCORE_MULTIPLIER_MAX = 10;
// Kills required to advance the multiplier by one step (tunable placeholder,
// tuned post-launch). Progress carries no wasted kills within a step but is
// frozen once the cap is reached.
export const SCORE_MULTIPLIER_KILLS_PER_STEP = 5;

// Smart bombs (Story 3.2): the RE1 emergency screen-clear economy. A run starts
// with BOMB_START_COUNT bombs (run-economy state on ScoreState, reset only on a
// fresh run — never on death). A bomb press with ≥1 bomb destroys every active
// enemy across the four archetype pools through the shared kill seam (removed but
// UNSCORED — a defensive cost, not a reward) and decrements the count by one. One
// extra bomb is awarded for each BOMB_AWARD_SCORE_INTERVAL boundary the running
// score crosses (FR9 specifies NO cap). All tuning lives here — no inline magic
// numbers on the detonation/award path.
// Starting (and fresh-run) bomb count.
export const BOMB_START_COUNT = 3;
// Score interval (points): +1 bomb per this-many-point boundary the running score
// crosses (detected against a monotonic cursor so each boundary fires once even
// when a single kill jumps past several intervals).
export const BOMB_AWARD_SCORE_INTERVAL = 100000;
// Placeholder shockwave countdown (ms): how long the expanding-ring cue runs after
// a detonation. A sim-side countdown (mirrors telegraphMs / invulnMs) the render
// loop reads; the real shockwave + screen-shake juice is Epic 4.
export const BOMB_SHOCKWAVE_MS = 300;
// Placeholder shockwave peak radius (px): the ring expands from 0 to this over the
// countdown. Placeholder only (Epic 4 owns the real aesthetic).
export const BOMB_SHOCKWAVE_MAX_RADIUS = 900;

// Extra lives (Story 3.3 / FR10): the RE1 milestone reward. Unlike bombs (a
// repeating +1 every BOMB_AWARD_SCORE_INTERVAL), extra lives come from a DEFINED
// FINITE ASCENDING LIST of milestone scores — each entry grants exactly one life
// the first time the running score reaches or passes it (detected against a
// monotonic index cursor so each fires once, even when one tick jumps past
// several). The list is finite, so it bounds total awards naturally — there is NO
// life cap and NO clamp (FR10 specifies neither). The award only ever ADDS to the
// single PlayerState.lives counter that deaths decrement; it never resets on death.
// Ascending, tunable placeholders (RE1-derived, tuned post-launch) — no inline
// magic numbers on the award path.
export const LIFE_AWARD_SCORE_THRESHOLDS = [100000, 250000, 500000, 1000000];

// Persistent high score (Story 3.4 / FR11): the single localStorage key under
// which the run's best score is stored across page reloads. The high score is
// the ONLY value persisted this epic; centralizing the key here keeps the one
// browser-storage seam (src/persistence/highScoreStorage.js) reading and writing
// the same slot. Namespaced so it never collides with unrelated app storage.
export const HIGH_SCORE_STORAGE_KEY = 'angleWars.highScore';

// --- XP economy / orbs (Story 8.1 / Epic 8 progression) ---------------------
// The level-up loop's first brick: a SEPARATE economy from `score`. Every enemy
// death that credits score today ALSO drops one pooled XP orb carrying a small
// per-type XP value; the orb drifts to the ship only within a pickup radius,
// collects on contact, and credits the run's XP total scaled by the current
// multiplier. Purely additive to the v1 loop. XpOrbSystem (the Phaser-free sim
// seam) owns a Pool of plain orb objects, advances/drifts/collects them each
// fixed step with zero steady-state allocation, and is bounded by XP_ORB_MAX
// (a spawn that would exceed the cap is skipped — the ParticleSystem precedent).
// Every value here is a documented post-launch placeholder (tuned later),
// mirroring the SCORE_* / PARTICLE_* discipline — no inline magic numbers.

// Per-type base XP values (NEVER derived from `score`). Carried on each enemy
// instance (bullet-kill archetypes) or supplied as an event value (black-hole
// defuse / mirror center-kill). Small integers so leaving orbs behind is a real
// choice. One orb per scored death, carrying that death's full per-type value.
export const SEEKER_XP = 1;
export const GREEN_SQUARE_XP = 2;
export const PINWHEEL_XP = 2;
export const SNAKE_SEGMENT_XP = 1;
export const SNAKE_HEAD_XP = 3;
// Event-payout XP: the Black Hole safe IMPLOSION ("defused") and the Mirror
// Reflector CENTER-KILL each drop one orb of this value (mirroring their flat
// direct-to-score payouts). A bomb-cleared or black-hole-ABSORBED enemy credits
// no score today and therefore drops NO XP (economy parity).
export const BLACKHOLE_DEFUSED_XP = 25;
export const MIRROR_CENTER_KILL_XP = 15;

// Hard cap on simultaneously-live orbs. A spawn that would exceed this is skipped
// this tick (the ParticleSystem precedent), so the pool + per-frame render cost is
// bounded. Orbs on the floor NEVER time out — the cap is the only bound.
export const XP_ORB_MAX = 512;
// Orb draw / collision radius (px) for the additive neon dot and the contact test.
export const XP_ORB_RADIUS = 4;
// Pickup radius (px): an orb within this distance of the ship drifts toward it;
// outside it the orb stays put (persists indefinitely). A per-tick distance gate,
// not a magnet latch — an orb the ship approaches then leaves stops drifting.
export const XP_PICKUP_RADIUS = 120;
// Orb drift speed (px/s) toward the ship while within the pickup radius.
export const XP_ORB_DRIFT_SPEED = 320;
// Multiplier scaling divisor: on collect, XP credited is
// value × (1 + multiplier / this), using the multiplier at collect time.
export const XP_MULTIPLIER_DIVISOR = 20;
// Orb fill color (0xRRGGBB): a teal/green neon that reads as XP once the camera
// bloom bleeds it — distinct from the warm particle sparks and the enemy hues.
export const COLOR_XP_ORB = 0x00ffaa;

// --- Leveling (Story 8.2 / Epic 8 progression) ------------------------------
// Hard level cap — a full build. Leveling stops at this level; XP earned past it
// is inert (level never exceeds LEVEL_MAX, no further threshold consumed).
export const LEVEL_MAX = 30;
// Per-level XP curve coefficients: XP_to_next(n) = BASE + LINEAR·n + QUAD·n²,
// where n is the current level being leveled FROM (run starts at level 1). The
// quadratic term makes each successive level cost progressively more; the base +
// linear terms keep the early levels quick. e.g. need(1)=14.55, need(2)=22.2.
export const XP_CURVE_BASE = 8;
export const XP_CURVE_LINEAR = 6;
export const XP_CURVE_QUAD = 0.55;

// --- Level-up moment & card UI (Story 8.3 / Epic 8 progression) --------------
// When the derived level crosses a threshold (LevelSystem.levelsGainedThisTick),
// the run enters a level-up moment: world time DILATES to a slow crawl (not a
// freeze — the swarm stays visible), the player is held invulnerable, and a
// modal three-card overlay opens. The sim-side state machine lives in the
// Phaser-free LevelUpSystem; ArenaScene owns the overlay render + dilation +
// input. All values are tunable placeholders (tuned post-launch), mirroring the
// SCORE_* / overlay-style discipline — no inline magic numbers.

// World time-scale while a selection is pending: the render delta fed to
// fixedTimestep.advance is scaled by this, so the whole world advances at 0.15×
// real time (a slow-mo, NOT a hard pause — the swarm keeps crawling). The
// per-step dt stays FIXED_STEP_MS, so every system integrates a bit-identical
// slice; only the STEP RATE slows.
export const LEVELUP_TIME_SCALE = 0.15;
// Invuln floor (ms) re-armed each pending tick so the player is unhittable for the
// whole (indefinite) selection. Comfortably above FIXED_STEP_MS (one tick's drain
// in PlayerDeathSystem) so a re-arm always survives a tick, with a small residual
// left as a brief landing grace after the overlay closes.
export const LEVELUP_INVULN_FLOOR = 200;
// Landing invulnerability (ms) granted the instant the LAST owed pick empties the
// queue. Longer than the per-tick floor so the ship — stationary while the swarm
// crawled onto it during the selection — gets a fair window to escape on drop-back
// to full speed (avoids an unavoidable death the frame the overlay closes).
export const LEVELUP_LANDING_INVULN_MS = 800;
// Open-grace (ms) after the card overlay opens during which CONFIRM (not navigation)
// is ignored, so a confirm edge already in flight when a level-up fires mid-combat
// (a mashed gamepad button / held Enter-Space / a tap) does not instantly pick the
// default card before the player registers the cards. Render-owned countdown.
export const LEVELUP_CONFIRM_GRACE_MS = 180;

// --- Level-up card overlay style (Story 8.3) --------------------------------
// The modal card overlay: a dimming full-arena rect (reusing COLOR_PAUSE_OVERLAY),
// a "LEVEL UP" heading, three card panels each with a title, and a prompt line.
// Placeholder styling only (Epic 4 owns the signature aesthetic; Epic 10 owns the
// real card content). Mirrors the PAUSE_* / GAMEOVER_* overlay style blocks.
// Overlay dim alpha (0..1) for the dimming rectangle (fill reuses COLOR_PAUSE_OVERLAY).
export const LEVELUP_OVERLAY_ALPHA = 0.6;
// Card panel fill color + alpha at rest, and the brighter/thicker focused variant
// (the selected card, the bomb-pressed idiom).
export const COLOR_LEVELUP_PANEL = 0x113322;
export const LEVELUP_PANEL_ALPHA = 0.5;
export const COLOR_LEVELUP_PANEL_FOCUS = 0x33ff99;
export const LEVELUP_PANEL_FOCUS_ALPHA = 0.85;
// Panel border color + line widths (the focused panel strokes thicker/brighter).
export const COLOR_LEVELUP_PANEL_BORDER = 0x33ff99;
export const LEVELUP_PANEL_BORDER_WIDTH = 2;
export const LEVELUP_PANEL_FOCUS_BORDER_WIDTH = 5;
// Text color shared by the heading, card titles, and prompt.
export const COLOR_LEVELUP_TEXT = '#e6fff2';
// Fonts for the heading, each card's title, and the prompt line.
export const LEVELUP_HEADING_FONT = '48px monospace';
export const LEVELUP_CARD_TITLE_FONT = '22px monospace';
export const LEVELUP_PROMPT_FONT = '20px monospace';
// Card rect geometry (px, logical): each panel's width/height and the gap between
// adjacent panels. Three panels are laid out centered horizontally.
export const LEVELUP_CARD_WIDTH = 300;
export const LEVELUP_CARD_HEIGHT = 200;
export const LEVELUP_CARD_GAP = 40;
// Vertical offset (px) of the prompt line below the panels' BOTTOM edge. Named so the
// prompt draw AND the reroll/banish action row (LEVELUP_ACTION_Y_OFFSET is measured
// relative to it) stay in sync — a single source for that spacing (Story 8.5).
export const LEVELUP_PROMPT_Y_OFFSET = 50;

// --- Weighted card offer & slot limits (Story 8.4 / Epic 8 progression) ------
// The level-up offer is a deterministic weighted-without-replacement draw of
// CARD_OFFER_SIZE distinct cards from the placeholder pool, routed through the
// same injected `_rng` stream the spawn systems use. Each candidate's weight is
// `rarity × (owned ? OWNED : UNOWNED) × (level===1 ? LEVEL1 : MIDTIER) × (trackFull
// && !owned ? 0 : 1) × banishMultiplier`, so the offer favors finishing owned
// builds (and mid-tier upgrades) over starting new ones, and a full track stops
// offering fresh cards in it. All values are tunable placeholders (tuned post-
// launch; Epic 10 owns the real registry) — no inline magic numbers in the draw.

// Per-track distinct-owned slot limits: once this many DISTINCT cards in a track
// are owned, no UNOWNED card in that track is offered (its weight zeroes). Offense
// caps at 5, defense at 4 — the Epic-8 "a run commits to a build" ceiling.
export const SLOT_LIMIT_OFFENSE = 5;
export const SLOT_LIMIT_DEFENSE = 4;
// The MAXIMUM offer size — the draw returns UP TO this many distinct eligible cards.
// Story 10.1 dropped the former "exactly three" invariant: the offer is variable length
// (0..CARD_OFFER_SIZE) and NEVER pads an excluded (banished/maxed/remnant/slot-full)
// card in to reach a count; when fewer are eligible it is SHORT, and a zero-eligible
// offer auto-drains (see LevelUpSystem/cardOffer). LevelUpSystem's guards now test
// `currentOffer.length >= 1` / `index < currentOffer.length`, and the ArenaScene overlay
// clamps its focus-wrap to the current offer length — no hardcoded 3 remains on those
// paths.
export const CARD_OFFER_SIZE = 3;
// Ownership weight factor: an already-owned card is this much more likely than an
// unowned one (favors finishing owned builds over starting new ones).
export const CARD_WEIGHT_OWNED_MULT = 2.2;
// Ownership weight factor for an unowned (level 0) card — the neutral baseline.
export const CARD_WEIGHT_UNOWNED_MULT = 1.0;
// Level factor for a just-started card (level === 1): the neutral rung, so a
// freshly-owned card is favored by ownership but not yet by the mid-tier bump.
export const CARD_WEIGHT_LEVEL1_MULT = 1.0;
// Level factor for any card NOT at level 1 (unowned level 0 or mid-tier levels
// 2+): the bump that, combined with ownership, favors finishing mid-tier builds.
export const CARD_WEIGHT_MIDTIER_MULT = 1.4;

// --- Item & upgrade framework (Story 10.1 / Epic 10) ------------------------
// The data-driven item registry (src/config/itemRegistry.js) replaces the Epic-8
// placeholder pool: each item is one definition (id/name/track/rarity + five
// per-level effect descriptors + fusion metadata) that the card offer, on-pick
// application, owned-state, and current level all read from. An item's LEVEL is
// its owned count (ownedCards[id]) capped at ITEM_MAX_LEVEL; a maxed item is
// never re-offered (cardWeight 0). ITEM_REMNANT_LEVEL is the frozen level a maxed
// item drops to when consumed by a fusion (Epic 12 owns the consumption; this
// story only tracks + exposes the remnant state). Both are tunable placeholders.
// Every item levels 1→5 (a full build), matching PRD §13.3/§13.4.
export const ITEM_MAX_LEVEL = 5;
// The level a fusion-consumed (remnant) item is frozen at — keeps its Lv3 stats,
// no longer upgradable (PRD §13.6). The plumbing lands here; Epic 12 consumes it.
export const ITEM_REMNANT_LEVEL = 3;

// --- Reroll & Banish (Story 8.5 / Epic 8 progression) ------------------------
// The two build-shaping tools layered onto the 8.3/8.4 draft: REROLL redraws the
// offered trio (a limited charge economy that grows with the run) and BANISH
// permanently drops a card from this run's offer pool. Both are run-scoped
// resources on ProgressionState (created fresh per run, never touched by death),
// consumed via LevelUpSystem latches while a selection is active. All values are
// tunable placeholders (Epic 14 owns real meta-progression) — no inline magic
// numbers on the reroll/banish path.

// Reroll charges a fresh run starts with. A reroll spends one charge and redraws
// the trio (respecting weights/slots/banished); at 0 it is a guarded no-op.
export const REROLL_INITIAL_CHARGES = 1;
// Banish charges a fresh run has. A banish adds the focused card's id to the run's
// banished set (never offered again) and spends one charge; at 0 it is a no-op.
export const BANISH_INITIAL_CHARGES = 2;
// Levels that each grant +1 reroll charge on the tick the player crosses INTO them
// (a single multi-level jump spanning several thresholds grants one per threshold).
// Frozen so no consumer can mutate the shared list.
export const REROLL_LEVEL_GRANTS = Object.freeze([10, 15, 20]);

// --- Reroll/Banish overlay action-button style (Story 8.5) -------------------
// Two labelled action controls (Reroll / Banish) rendered below the card panels in
// the level-up overlay, each showing its remaining charge count with an enabled vs
// depleted (count 0) look. Placeholder styling only (Epic 4 owns the real aesthetic;
// Epic 10 owns the real draft UX). Mirrors the LEVELUP_* card-panel style block.
// Enabled button fill color + alpha (a warm amber that reads as an actionable tool
// distinct from the green card panels once bloom bleeds it).
export const COLOR_LEVELUP_ACTION = 0x332211;
export const LEVELUP_ACTION_ALPHA = 0.6;
// Depleted (count 0) fill color + alpha: dimmer/greyer so a spent action reads as
// clearly unavailable at a glance.
export const COLOR_LEVELUP_ACTION_DEPLETED = 0x1a1a1a;
export const LEVELUP_ACTION_DEPLETED_ALPHA = 0.4;
// Button border color + width (enabled). The depleted variant reuses the depleted
// text color for a uniformly dimmed look.
export const COLOR_LEVELUP_ACTION_BORDER = 0xffaa55;
export const LEVELUP_ACTION_BORDER_WIDTH = 2;
// Button label color: bright when enabled, dimmed grey when depleted.
export const COLOR_LEVELUP_ACTION_TEXT = '#ffddaa';
export const COLOR_LEVELUP_ACTION_TEXT_DEPLETED = '#666666';
// Button label font.
export const LEVELUP_ACTION_FONT = '18px monospace';
// Button rect geometry (px, logical): each control's width/height, the gap between
// the two controls, and the vertical offset of the control row below the prompt line
// (which itself sits LEVELUP_CARD_HEIGHT + LEVELUP_PROMPT_Y_OFFSET below the panels' top).
export const LEVELUP_ACTION_WIDTH = 260;
export const LEVELUP_ACTION_HEIGHT = 54;
export const LEVELUP_ACTION_GAP = 40;
export const LEVELUP_ACTION_Y_OFFSET = 90;

// Per-card banish glyph (Story 8.5): a small tappable target in the TOP-RIGHT corner of
// each card panel so a touch/mouse player can banish a SPECIFIC card (the focus-based
// bottom Banish button only ever targets the focused slot, which touch cannot move
// without also committing a pick). Keyboard `B` / gamepad LB still banish the focused
// card. The glyph reuses the action-button colors (enabled amber / depleted grey) for a
// consistent "tool" read; only its geometry + label font are new. Size/margin in px.
export const LEVELUP_CARD_BANISH_SIZE = 40;
export const LEVELUP_CARD_BANISH_MARGIN = 10;
export const LEVELUP_CARD_BANISH_FONT = '20px monospace';
// The banish glyph label (kept ASCII so it renders reliably under the bloom pass).
export const LEVELUP_CARD_BANISH_GLYPH = 'X';

// --- Colors (0xRRGGBB) ------------------------------------------------------
export const COLOR_BACKGROUND = 0x0a0a12;
export const COLOR_ARENA_BORDER = 0x33ff99;
export const COLOR_SHIP = 0x66ccff;
export const COLOR_BULLET = 0xffee66;
export const COLOR_SEEKER = 0x3366ff;
export const COLOR_GREEN_SQUARE = 0x66ff33;
export const COLOR_PINWHEEL = 0xff66cc;
export const COLOR_SNAKE = 0xffaa33;
// Mirror Reflector (Story 6.3): a pale chrome/steel hue that reads as a polished
// mirror-metal dumbbell once the camera bloom bleeds it — distinct from the pink
// Pinwheel and the purple Black Hole. Used for both the bar line and the two weights.
export const COLOR_MIRROR_REFLECTOR = 0xccddff;
// Armored enemy (Story 9.3): a cold steel-grey that reads as heavy plate armor once
// the camera bloom bleeds it — distinct from the blue Seeker and chrome Reflector.
// The render draws a remaining-durability cue on top of this base fill.
export const COLOR_ARMORED = 0x9aa4b2;
// Placeholder fill for the Black Hole body at rest (instability 0). The grid-warp
// visual is Epic 4 / Story 4.2; Story 6.2 lerps this toward COLOR_BLACK_HOLE_UNSTABLE
// and pulses its alpha as the hole nears detonation.
export const COLOR_BLACK_HOLE = 0x9933ff;
// Black Hole body fill at full instability (radius == BLACKHOLE_UNSTABLE_RADIUS):
// an alarming red the resting purple lerps toward as detonation approaches. The
// escalating red pulse is the render half of the instability telegraph (Story 6.2).
export const COLOR_BLACK_HOLE_UNSTABLE = 0xff2233;
// Black Hole instability pulse (view-only, Story 6.2): as instability rises 0→1
// the body's alpha oscillates faster and deeper. HZ is the pulse rate (cycles per
// second) at full instability; ALPHA_DEPTH is the peak fractional alpha swing at
// full instability. Both scale linearly with instability, so a resting hole
// (instability 0) does not pulse at all. Placeholders (tuned post-launch).
export const BLACKHOLE_PULSE_HZ = 3.5;
export const BLACKHOLE_PULSE_ALPHA_DEPTH = 0.35;
// Placeholder stroke for the smart-bomb expanding shockwave ring (Story 3.2). The
// real shockwave aesthetic is Epic 4 — this is a plain stroked circle only.
export const COLOR_BOMB_SHOCKWAVE = 0xffffff;

// --- Neon aesthetic / bloom (Story 4.1) -------------------------------------
// The signature Geometry Wars "everything glows and bleeds light" look (NFR4).
// It is produced two ways, both wired in ArenaScene.create() once (never per
// frame): (1) the neon vector layers are put into additive blend so bright
// shapes accumulate light over the near-black COLOR_BACKGROUND, and (2) ONE
// camera-level Bloom post-FX pass (cameras.main.postFX.addBloom) bleeds that
// light across the whole frame. Registering bloom once at the camera makes its
// cost a single screen-space pass independent of entity count — the load-bearing
// performance decision for the busy-arena 60 FPS target (NFR1). These six values
// are the addBloom(color, offsetX, offsetY, blurStrength, strength, steps) tuple
// in that exact order. All are tunable placeholders (tuned post-launch); no
// inline magic numbers live at the ArenaScene call site.
// Bloom tint (0xRRGGBB): white keeps every neon hue's own color while adding a
// bright halo around it.
export const NEON_BLOOM_COLOR = 0xffffff;
// Horizontal / vertical bloom offset (Phaser defaults 1). How far the sampled
// bright pixels are spread when the glow is composited.
export const NEON_BLOOM_OFFSET_X = 1;
export const NEON_BLOOM_OFFSET_Y = 1;
// Blur strength of the bloom pass (Phaser default 1): how soft/wide the halo is.
export const NEON_BLOOM_BLUR_STRENGTH = 1.2;
// Blend strength of the bloom pass (Phaser default 1): how intensely the glow is
// added back over the frame. Slightly above 1 for a visible neon bleed.
export const NEON_BLOOM_STRENGTH = 1.2;
// Number of bloom steps (Phaser default 4, must be an integer): more steps = a
// smoother, wider glow at a higher fill cost. Kept modest to protect NFR1.
export const NEON_BLOOM_STEPS = 4;

// --- Deforming grid field (Story 4.2) ---------------------------------------
// The signature Geometry Wars "living grid": a neon floor grid that fills the
// arena, ripples outward from explosions/bombs/deaths, and bows toward an active
// Black Hole (NFR5, FR13). It is drawn entirely on the GPU by ONE full-arena
// fragment-shader quad (see src/scenes/gridField.js) added behind all entities;
// ALL deformation happens in the shader from these values, passed as uniforms —
// the CPU never walks vertices. GridFieldSystem (the Phaser-free sim seam) owns a
// bounded ripple pool and a single warp target and only writes uniforms. Every
// value here is a documented post-launch placeholder (tuned later), mirroring the
// NEON_BLOOM_* discipline — no inline magic numbers in the GLSL or at the call site.

// Grid line spacing (px, arena space): the gap between adjacent grid lines.
export const GRID_SPACING = 48;
// Grid line half-width (px) used by the shader's smoothstep — larger = thicker,
// softer lines. The camera Bloom (Story 4.1) turns these into glowing neon lines.
export const GRID_LINE_WIDTH = 1.5;
// Grid line color (0xRRGGBB). Converted to a normalized vec3 in the pure seam and
// passed to the shader; a dim blue that reads as neon once bloom bleeds it.
export const GRID_COLOR = 0x1b3f7a;
// Ripple pool size: the fixed number of concurrent ripple slots (a bounded uniform
// array => bounded GPU cost, independent of how many explosions occur). Emitting
// past this overwrites the oldest ripple.
export const GRID_MAX_RIPPLES = 16;
// Ripple lifetime (ms): a ripple advances by the fixed-step dt and expires (its
// slot frees) once its age reaches this. Counted in sim time (frame-rate-independent).
export const GRID_RIPPLE_DURATION_MS = 900;
// Ripple ring expansion speed (px/sec): the radial wavefront radius = age·this, so
// the ring races outward from the origin over the ripple's life. Retuned markedly
// lower (Story 6.1 / AC1) so the kill-ripple's reach is subtler yet still readable —
// strictly positive, never disabled.
export const GRID_RIPPLE_SPEED = 300;
// Ripple displacement amplitude (px): the peak sideways push a ripple applies to
// the sampled grid coordinate, scaled by an age envelope (fades to 0 at expiry).
// Retuned markedly lower (Story 6.1 / AC1) so the kill-ripple reads as a calm,
// subtle deformation instead of a distractingly loud warp — strictly positive
// (still readable feedback), never zeroed.
export const GRID_RIPPLE_AMPLITUDE = 6;
// Ripple wavelength (px): the spatial period of the radial sine wave — smaller =
// tighter concentric rings.
export const GRID_RIPPLE_WAVELENGTH = 60;
// Warp peak displacement (px): the strongest pull the grid feels at a Black Hole's
// core, scaled down by distance falloff and the hole's current strength (0..1).
export const GRID_WARP_MAX_DISPLACEMENT = 60;
// Warp reach (px): grid points strictly inside this distance of the hole are pulled
// toward it; anything at/beyond is unaffected. Matched to the hole's gravity radius
// so the visual warp footprint equals the actual gravity footprint (Story 2.4).
export const GRID_WARP_RADIUS = BLACKHOLE_GRAVITY_RADIUS;

// --- Pooled particle system (Story 4.3) -------------------------------------
// The signature Geometry Wars "everything sprays sparks" juice (FR12, NFR2): a
// pool-backed particle system that emits a neon BURST per bullet-killed enemy and
// a throttled thrust TRAIL behind the moving ship. ParticleSystem (the Phaser-free
// sim seam) owns a Pool of plain particle objects, advances/expires them each
// fixed step with zero steady-state allocation, and is bounded by PARTICLE_MAX so
// "thousands live" is supported by the cap + pool reuse (never unbounded growth).
// ArenaScene renders every live particle as an additive-blend neon dot glowing
// under the single Story 4.1 camera Bloom. Every value here is a documented
// post-launch placeholder (tuned later), mirroring the GRID_* / NEON_BLOOM_*
// discipline — no inline magic numbers in the system or at the render call site.

// Hard cap on simultaneously-live particles. Emission that would exceed this is
// skipped, so the pool (and per-frame render cost) is bounded — this is what
// makes "thousands live" safe for NFR1 rather than an unbounded leak.
export const PARTICLE_MAX = 2000;
// Number of particles sprayed per bullet-killed enemy (one burst per kill).
export const PARTICLE_BURST_COUNT = 14;
// Burst speed range (px/s): each burst particle gets a uniform random speed in
// [MIN, MAX] along a uniform random heading, so the spray disperses radially.
export const PARTICLE_BURST_SPEED_MIN = 60;
export const PARTICLE_BURST_SPEED_MAX = 280;
// Burst particle lifetime (ms): it ages by the fixed-step dt and its slot frees
// once ageMs reaches this (frame-rate-independent).
export const PARTICLE_BURST_LIFETIME_MS = 620;
// Burst particle draw radius (px) for the additive neon dot.
export const PARTICLE_BURST_SIZE = 2.5;
// Burst particle color (0xRRGGBB): a warm neon that reads as an explosion spark
// once the camera bloom bleeds it.
export const PARTICLE_BURST_COLOR = 0xffdd55;
// Velocity retained after one second of drift (0..1): particle velocity decays by
// this factor per second (exponential drag, interpolated per fixed step), so a
// burst flings out fast then slows as it fades. Smaller = quicker settle.
export const PARTICLE_DRAG_RETAIN_PER_SEC = 0.02;
// Thrust-intent threshold: the ship leaves a trail only while
// hypot(moveX, moveY) >= this, so a resting/near-still stick emits nothing.
export const PARTICLE_THRUST_MIN_INTENT = 0.2;
// Trail throttle (ms): while thrusting, ONE trail particle is emitted per this
// much accumulated fixed-step time (frame-rate-independent cadence). Lower =
// denser trail.
export const PARTICLE_TRAIL_INTERVAL_MS = 24;
// Trail particle lifetime (ms): shorter than the burst so the trail is a tight
// fading ribbon rather than a lingering cloud.
export const PARTICLE_TRAIL_LIFETIME_MS = 420;
// Trail particle drift speed (px/s), directed opposite the ship's facing (± the
// spread below) so the trail streams out behind the ship.
export const PARTICLE_TRAIL_SPEED = 90;
// Trail heading spread (radians): each trail particle's heading is jittered by a
// uniform random angle in [−this, +this] around "opposite the ship facing" so the
// ribbon has a little natural width.
export const PARTICLE_TRAIL_SPREAD_RAD = Math.PI / 12; // 15°
// Trail particle draw radius (px) for the additive neon dot.
export const PARTICLE_TRAIL_SIZE = 2;
// Trail particle color (0xRRGGBB): the ship's own neon hue so the trail reads as
// its thruster wash.
export const PARTICLE_TRAIL_COLOR = 0x66ccff;

// --- Screen juice & feedback (Story 4.4) ------------------------------------
// The signature Geometry Wars "screen-feel" payoff (FR12, NFR2): the camera
// shakes, the screen flashes, and the action hit-stops on impact. ScreenFeedback
// System (the Phaser-free sim seam) observes the SAME event sources the grid
// ripple (4.2) and particle burst (4.3) read — collisionSystem.bulletKillCount
// (kills), bombSystem.shockwaveMs rising edge (bomb), playerDeathSystem.deathSeq
// increment (death) — plus a throttled near-miss proximity scan, and turns them
// into three render-consumable latches: pending shake trauma, a flash request, and
// a hit-stop request. Big events (bomb + death) get shake + flash + hit-stop; small
// events (kills + near-misses) get a subtle shake nudge ONLY. The screenShake.js
// pure seam holds the trauma→offset / flash-alpha / trauma-decay math; ArenaScene
// owns the real-time countdowns (so they settle even while the sim is frozen on
// game-over). Every value here is a documented post-launch placeholder (tuned
// later), mirroring the GRID_* / PARTICLE_* discipline — no inline magic numbers in
// the system, the seam, or the ArenaScene call sites.

// Max camera shake offset (px) at peak. shakeOffsetX/Y scale from 0 (trauma 0) up
// to this bound (|offset| never exceeds it), so the whole view kicks by at most
// this many pixels.
export const SCREEN_SHAKE_MAX_OFFSET = 24;
// Shake oscillation frequencies (radians per ms of render time) for the X and Y
// axes. Different values decorrelate the two axes so the kick reads as a shake
// rather than a diagonal slide.
export const SCREEN_SHAKE_FREQ_X = 0.045;
export const SCREEN_SHAKE_FREQ_Y = 0.037;
// Trauma decay rate (trauma units per second): how fast a shake settles back to
// rest. decayTrauma subtracts this × dtSec each frame, clamped at 0. Larger =
// snappier settle.
export const SCREEN_SHAKE_TRAUMA_DECAY_PER_SEC = 1.8;
// Per-event trauma weights (0..1 scale; the render clamps accumulated trauma to 1).
// Death shakes HARDER than a bomb (magnitude proportional to event severity); a
// kill and a near-miss are subtle nudges that accumulate in a busy arena.
export const SCREEN_SHAKE_TRAUMA_BOMB = 0.55;
export const SCREEN_SHAKE_TRAUMA_DEATH = 0.85;
export const SCREEN_SHAKE_TRAUMA_KILL = 0.08;
export const SCREEN_SHAKE_TRAUMA_NEARMISS = 0.12;
// Flash duration (ms): how long the full-screen flash overlay fades from full to
// zero after a big event. Brief so it emphasizes without obscuring play.
export const SCREEN_FLASH_MS = 120;
// Flash overlay color (0xRRGGBB): a white wash over the whole view on a big event.
export const COLOR_SCREEN_FLASH = 0xffffff;
// Hit-stop duration (ms): how long the whole sim freezes on a big event to sell the
// impact. Counted down at render level (a frozen sim cannot count itself back out).
// Short — a momentary hitch, not a stall.
export const SCREEN_HITSTOP_MS = 60;
// Near-miss proximity radius (px): a non-telegraphing enemy whose center is closer
// than this to the ship (but not overlapping its collision radius) registers a
// near-miss nudge. The fuzzy part of the intent — a tunable placeholder.
export const SCREEN_NEARMISS_RADIUS = 70;
// Near-miss throttle cooldown (ms): after one near-miss fires, no further near-miss
// registers until this much sim time elapses. A single global cooldown avoids
// per-tick spam and needs no per-enemy identity tracking (recycle-safe).
export const SCREEN_NEARMISS_COOLDOWN_MS = 400;

// --- Audio & adaptive music (Story 4.5) -------------------------------------
// The signature Geometry Wars "everything sounds like Retro Evolved" payoff
// (FR13, NFR: immersion). There are ZERO art/audio assets in this project — every
// visual is procedurally drawn — so audio is procedurally SYNTHESISED too (Web
// Audio API), with no asset pipeline. AudioDirectorSystem (the Phaser-free sim
// seam) observes the SAME event sources the grid ripple (4.2) / particles (4.3) /
// screen juice (4.4) read — firingSystem.shotsFiredCount (fire),
// collisionSystem.bulletKillCount (kill), spawnDirector.spawnCount (spawn),
// bombSystem.shockwaveMs rising edge (bomb), playerDeathSystem.deathSeq increment
// (death) — into render-consumable SFX-request latches, and reads the SpawnDirector
// difficulty ramp (progressAt) into a live musicIntensity level. audioMix.js holds
// the intensity→layer-gain and volume/mute math; settingsStorage.js persists
// {muted, volume, fullscreen}; audioEngine.js is the browser-bound synth (SFX blips + adaptive
// music voices). Every value here is a documented post-launch placeholder (tuned
// later), mirroring the GRID_* / PARTICLE_* / SCREEN_* discipline — no inline magic
// numbers in the system, the mix seam, the engine, or the ArenaScene call sites.

// Master volume default (0..1): the effective output gain at run start when not
// muted. Persisted per-player via settingsStorage and re-applied on load.
export const AUDIO_MASTER_VOLUME_DEFAULT = 0.6;
// Volume step (0..1): how much each volume-up/down key press moves the master
// volume, clamped to [0,1] (audioMix.adjustVolume).
export const AUDIO_VOLUME_STEP = 0.1;
// Muted default: whether a fresh player (no stored setting) starts muted.
export const AUDIO_MUTED_DEFAULT = false;
// The single localStorage key under which the consolidated settings object
// { muted, volume, fullscreen } persists (its own slot, mirroring
// HIGH_SCORE_STORAGE_KEY). Story 5.3 consolidated the former audio-only port into
// settingsStorage.js; the key VALUE is REUSED unchanged ('angleWars.audioSettings')
// so previously stored {muted,volume} payloads still load (fullscreen defaults off)
// — a rename + superset, not a data migration. Namespaced so it never collides with
// unrelated app storage.
export const SETTINGS_STORAGE_KEY = 'angleWars.audioSettings';

// Number of continuously-running adaptive-music layers (oscillator voices). More
// difficulty ⇒ more layers audible; each layer i fades in over its [i/N, (i+1)/N]
// intensity band (audioMix.musicLayerGains).
export const AUDIO_MUSIC_LAYER_COUNT = 4;
// Peak gain (0..1) any single music layer reaches once fully faded in. Kept low so
// the layered voices sit under the SFX rather than drowning them.
export const AUDIO_MUSIC_LAYER_MAX_GAIN = 0.12;
// Base oscillator frequency (Hz) of the lowest music layer; higher layers are
// harmonics of it (layer i ⇒ BASE_FREQ × (i+1)). 55 Hz ≈ A1, a deep drone floor.
export const AUDIO_MUSIC_BASE_FREQ = 55;
// Music layer-gain smoothing time constant (seconds) for the engine's
// setTargetAtTime ramp, so intensity changes glide rather than click.
export const AUDIO_MUSIC_GAIN_SMOOTHING = 0.4;

// Black Hole urgency cue (Story 6.2): a single continuously-running oscillator
// voice whose gain rises with the hole's instability level (0..1), so a hole
// nearing detonation sounds a rising tension tone that vanishes when no hole is
// unstable. FREQ is its pitch (Hz — a tense mid-high tone above the music drone);
// MAX_GAIN is the peak gain at full instability (kept modest so it sits under the
// SFX). The engine reuses AUDIO_MUSIC_GAIN_SMOOTHING for its glide. Placeholders
// (tuned post-launch) — the audible cue is the disclosed manual-verification boundary.
export const AUDIO_URGENCY_FREQ = 660;
export const AUDIO_URGENCY_MAX_GAIN = 0.14;

// Per-SFX synthesis: oscillator frequency (Hz), envelope duration (ms), and peak
// gain (0..1) of each event's short enveloped blip. Fire is a rapid high tick, kill
// a mid pop, spawn a high chirp, bomb a low boom, death a longer descending tone.
export const AUDIO_SFX_FIRE_FREQ = 880;
export const AUDIO_SFX_FIRE_MS = 60;
export const AUDIO_SFX_FIRE_GAIN = 0.12;
export const AUDIO_SFX_KILL_FREQ = 440;
export const AUDIO_SFX_KILL_MS = 120;
export const AUDIO_SFX_KILL_GAIN = 0.25;
export const AUDIO_SFX_SPAWN_FREQ = 1200;
export const AUDIO_SFX_SPAWN_MS = 90;
export const AUDIO_SFX_SPAWN_GAIN = 0.15;
export const AUDIO_SFX_BOMB_FREQ = 80;
export const AUDIO_SFX_BOMB_MS = 500;
export const AUDIO_SFX_BOMB_GAIN = 0.5;
export const AUDIO_SFX_DEATH_FREQ = 300;
export const AUDIO_SFX_DEATH_MS = 600;
export const AUDIO_SFX_DEATH_GAIN = 0.4;

// Per-frame SFX caps: the most blips of each accumulating SFX type (fire/kill/spawn)
// the render loop triggers in a single frame, so a burst (or a multi-sub-step catch-up
// frame) cannot flood the mixer with dozens of overlapping voices. Bomb/death are
// one-shot booleans and need no count cap.
export const AUDIO_SFX_FIRE_MAX_PER_FRAME = 2;
export const AUDIO_SFX_KILL_MAX_PER_FRAME = 4;
export const AUDIO_SFX_SPAWN_MAX_PER_FRAME = 3;

// --- Debug readout ----------------------------------------------------------
export const COLOR_DEBUG_TEXT = '#88ffcc';
export const DEBUG_FONT = '14px monospace';

// --- HUD (score + lives readout) --------------------------------------------
// The live HUD text drawn each render frame in ArenaScene. Placeholder styling
// only (Epic 4 owns the signature aesthetic); centralized so layout/feel is
// tunable in one place.
export const COLOR_HUD_TEXT = '#e6f2ff';
export const HUD_FONT = '20px monospace';
// Edge margin (px, logical) between the arena border inset and the HUD / DEV debug
// readout text. Centralized (Story 7.2) so the mobile-layout seam is the single
// source of the HUD/debug offsets — replaces the former inline `+ 8` in ArenaScene.
export const HUD_MARGIN = 8;

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

// --- Pause overlay (Story 5.2) ----------------------------------------------
// Shown while the player has paused a live run: a dimming full-arena rectangle
// plus a "PAUSED" title and resume prompt. Mirrors the game-over overlay block
// above. Placeholder styling only (Epic 4 owns the signature aesthetic).
// Overlay fill color and its alpha (0..1) for the dimming rectangle.
export const COLOR_PAUSE_OVERLAY = 0x000000;
export const PAUSE_OVERLAY_ALPHA = 0.55;
// Text color shared by the pause title and resume prompt.
export const COLOR_PAUSE_TEXT = '#ffffff';
// Fonts for the two stacked lines of the pause overlay.
export const PAUSE_TITLE_FONT = '48px monospace';
export const PAUSE_PROMPT_FONT = '20px monospace';

// --- Title screen (Story 5.1) -----------------------------------------------
// The front-door TitleScene shown between Preload and Arena: the neon "ANGLE
// WARS" hero title, the persisted high score, a start prompt, and the basic
// controls. The title's colors and fonts are centralized here so its feel is
// tunable in one place (matching the HUD / game-over blocks above).
// The hero title is put into additive blend so it reads as a bright neon sign;
// its color is a Phaser text `color` string.
export const COLOR_TITLE_TEXT_STRING = '#33ffee';
export const TITLE_FONT = '72px monospace';
// The persisted high-score line (from formatHighScore(load())).
export const COLOR_TITLE_HISCORE = '#e6f2ff';
export const TITLE_HISCORE_FONT = '28px monospace';
// The "press start" prompt inviting any start input.
export const COLOR_TITLE_PROMPT = '#ffd23f';
export const TITLE_PROMPT_FONT = '24px monospace';
// The basic-controls lines (move / aim-fire / bomb / mute-volume).
export const COLOR_TITLE_CONTROLS = '#88ffcc';
export const TITLE_CONTROLS_FONT = '18px monospace';

// --- Settings screen (Story 5.3) --------------------------------------------
// The SettingsScene reached from the title with `S`: a neon "SETTINGS" hero
// title plus stacked volume / mute / fullscreen lines and a key hint, each
// applying + persisting immediately. Colors and fonts are centralized here so
// its feel is tunable in one place (mirroring the TITLE_* block above); no
// inline magic values live in the scene.
// The hero title is put into additive blend so it reads as a bright neon sign;
// its color is a Phaser text `color` string.
export const COLOR_SETTINGS_TITLE_STRING = '#33ffee';
export const SETTINGS_TITLE_FONT = '64px monospace';
// The volume / mute / fullscreen setting lines (from the settingsMenu formatters).
export const COLOR_SETTINGS_ITEM = '#e6f2ff';
export const SETTINGS_ITEM_FONT = '28px monospace';
// The key-hint line naming the controls.
export const COLOR_SETTINGS_HINT = '#88ffcc';
export const SETTINGS_HINT_FONT = '18px monospace';
// Whether a fresh player (no stored setting) starts in fullscreen. Browsers
// forbid entering fullscreen without a user gesture, so this preference is
// applied on the toggle keypress only — never auto-restored at page load.
export const SETTINGS_FULLSCREEN_DEFAULT = false;
// Whether a fresh player (no stored setting) starts with reduced motion on
// (Story 6.1 / WCAG 2.3.1). Persisted as a superset field of the consolidated
// { muted, volume, fullscreen, reducedMotion } settings object under the SAME
// SETTINGS_STORAGE_KEY (defaulted false so legacy payloads still load). When on,
// ArenaScene suppresses the grid warp, full-screen flash, and camera shake at
// render time; it is read once at ArenaScene.create() (never live re-read mid-run).
export const SETTINGS_REDUCED_MOTION_DEFAULT = false;

// --- Mobile performance profile (Story 7.4) ---------------------------------
// The mobile-scaled counterparts of the desktop presentation-cost tunables. When
// the game detects it is running on a phone / inside the Capacitor WebView (see
// src/config/qualityProfile.js), resolveQualityProfile() sources these values
// instead of the desktop PARTICLE_MAX / NEON_BLOOM_* / GRID_SPACING, scaling the
// particle cap, the bloom fill cost, and the grid line density DOWN so a mid-range
// mobile GPU under peak load holds the 60 FPS target (NFR9, NFR1). The profile is
// resolved ONCE per ArenaScene.create() (device-derived, never per frame) and
// threaded into the three existing consumption seams, each of which defaults to its
// desktop constant so non-mobile play is byte-identical. Every value here is a
// documented post-launch placeholder (tuned on-device post-launch — this Linux host
// has no phone GPU to measure), mirroring the NEON_BLOOM_* / GRID_* / PARTICLE_*
// discipline. INVARIANT: each MOBILE_* value MUST be strictly less costly than its
// desktop counterpart — a smaller particle cap, fewer bloom steps + lower blur/
// strength, and a larger/coarser grid spacing.

// Mobile hard cap on simultaneously-live particles (< PARTICLE_MAX): a smaller pool
// and per-frame render cost for the weaker mobile fill rate.
export const MOBILE_PARTICLE_MAX = 800;
// Mobile bloom blur strength (<= NEON_BLOOM_BLUR_STRENGTH): a tighter, cheaper halo.
export const MOBILE_NEON_BLOOM_BLUR_STRENGTH = 0.8;
// Mobile bloom blend strength (<= NEON_BLOOM_STRENGTH): a slightly dimmer bleed.
export const MOBILE_NEON_BLOOM_STRENGTH = 0.9;
// Mobile bloom steps (< NEON_BLOOM_STEPS, integer): the load-bearing GPU win — the
// bloom fill pass is screen-space, so halving the step count roughly halves its cost.
export const MOBILE_NEON_BLOOM_STEPS = 2;
// Mobile grid line spacing (> GRID_SPACING): a coarser grid draws fewer neon lines
// (less smoothstep fill) — the honest "grid resolution down" knob, without touching
// the shader's compiled GRID_MAX_RIPPLES #define.
export const MOBILE_GRID_SPACING = 72;
