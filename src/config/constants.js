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
// The Black Hole (Epic 2's signature high-risk object) is a stationary, HP-based
// destructible hazard — NOT a one-hit enemy. Each fixed step it applies an
// attractive POSITION nudge to every nearby ship/bullet/enemy (linear
// inverse-distance falloff, dt-scaled, so it survives the movers that integrate
// x += v·dt and never assign absolute positions), FEEDS on bullets/enemies that
// reach its body (growing its radius, clamped, and periodically emitting a fresh
// seeker at the arena edge), takes bullet damage toward destruction, and on death
// credits a big score payout and is removed. All values are tunable placeholders
// (tuned post-launch); every cadence/motion value derives from the fixed-step dt
// so it is frame-rate-independent.

// Initial collision/gravity-source radius (px) of a freshly spawned hole, also
// the placeholder circle radius and the interior-spawn inset margin.
export const BLACKHOLE_RADIUS = 26;
// Hard cap (px) on the radius as the hole feeds and grows — the body never
// exceeds this no matter how much it devours (clamped each feed).
export const BLACKHOLE_MAX_RADIUS = 70;
// Gravity reach (px): entities strictly inside this distance from the hole center
// are pulled; anything at or beyond it is unaffected.
export const BLACKHOLE_GRAVITY_RADIUS = 340;
// Gravity strength (px/s) at the core. The per-step pull magnitude is
// STRENGTH·(1 − d/GRAVITY_RADIUS)·dtSec, so it is strongest near the core and
// fades linearly to zero at the radius, and scales with dt (frame-rate-independent).
export const BLACKHOLE_GRAVITY_STRENGTH = 300;
// Hit points: total bullet damage required to destroy the hole (multi-hit, the
// opposite of the one-shot enemies — this is why the hole is NOT in the
// CollisionSystem pool list; BlackHoleSystem owns its own bullet test).
export const BLACKHOLE_HP = 40;
// Damage one absorbed bullet deals to the hole's hp. BLACKHOLE_HP / this ≈ the
// bullet hits needed to detonate it.
export const BLACKHOLE_BULLET_DAMAGE = 2;
// Radius growth (px) per feed (each absorbed bullet or enemy), clamped at
// BLACKHOLE_MAX_RADIUS.
export const BLACKHOLE_GROWTH_PER_FEED = 1.5;
// Feeds required to emit one new seeker: every this-many absorptions the hole
// spawns a fresh seeker at a random arena EDGE (not the core — otherwise its own
// gravity would suck the newborn straight back in and re-feed, a runaway loop).
export const BLACKHOLE_FEED_PER_SPAWN = 4;
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
// Detonation payout: score credited directly to ScoreState when a hole is
// destroyed. An event payout (not a per-tick one-hit kill), so it is added to the
// shared score surface directly, NEVER through the killedEnemies/ScoringSystem
// seam and so NEVER multiplied by the run multiplier — this hazard credit stays
// flat by design (the multiplier applies only to enemy-kill awards at the seam).
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

// --- Colors (0xRRGGBB) ------------------------------------------------------
export const COLOR_BACKGROUND = 0x0a0a12;
export const COLOR_ARENA_BORDER = 0x33ff99;
export const COLOR_SHIP = 0x66ccff;
export const COLOR_BULLET = 0xffee66;
export const COLOR_SEEKER = 0x3366ff;
export const COLOR_GREEN_SQUARE = 0x66ff33;
export const COLOR_PINWHEEL = 0xff66cc;
export const COLOR_SNAKE = 0xffaa33;
// Placeholder fill for the Black Hole body (the grid-warp visual is Epic 4 /
// Story 4.2 — this is a plain filled circle only).
export const COLOR_BLACK_HOLE = 0x9933ff;
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
// the ring races outward from the origin over the ripple's life.
export const GRID_RIPPLE_SPEED = 480;
// Ripple displacement amplitude (px): the peak sideways push a ripple applies to
// the sampled grid coordinate, scaled by an age envelope (fades to 0 at expiry).
export const GRID_RIPPLE_AMPLITUDE = 14;
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
