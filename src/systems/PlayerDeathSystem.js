import { System } from '../core/System.js';
import { createPlayerShip } from '../entities/PlayerShip.js';
import {
  PLAYER_INVULN_MS,
  SHIELD_ABSORB_INVULN_MS,
} from '../config/constants.js';
import { resetMultiplier } from '../state/ScoreState.js';

// PlayerDeathSystem — ship↔enemy death, lives, respawn, invulnerability, and the
// game-over flag (Phaser-free).
//
// Runs inside world.fixedUpdate(dt), AFTER CollisionSystem (so an enemy killed
// by a bullet this tick is already released and cannot also kill the player) and
// after PlayerMovementSystem/EnemySystem/GreenSquareSystem (so it sees post-move
// ship and enemy positions). It owns no pool/state — it reads the ship entity,
// the enemy pools, and the shared PlayerState it is given.
//
// The enemy pools are a LIST so every archetype (Blue Seeker, Green Square, and
// future Epic-2 enemies) is lethal on contact through this one seam (FR6) — no
// per-type duplicate. Every enemy shares the uniform {x,y,radius,telegraphMs}
// shape, so this seam reads only those fields and stays type-agnostic (a Green
// Square kills on contact regardless of its aggro state). Story 2.6: an instance
// still telegraphing its spawn (telegraphMs > 0) is skipped — the single
// non-lethality seam that makes every archetype safe while spawning in.
//
// Each fixed step:
//   1. If the run is over (gameOver), do nothing.
//   2. Count the invulnerability window down by dt (clamped at 0). While it is
//      still > 0 the player is invulnerable — return without any contact test.
//   3. Otherwise test the ship against the active enemies of every pool
//      (circle-circle) and, on the first overlap, apply the death flow: deduct a
//      life and either respawn at arena center with a fresh invulnerability
//      window (lives remain) or set game-over (last life). At most ONE death per
//      fixed step (break on first).
//
// Story 10.4 (Nanite Shield) inserts ONE branch at the top of that shared death
// flow: with an optional shield system injected and a live charge available, the
// hit is ABSORBED instead — one charge is spent, a short SHIELD_ABSORB_INVULN_MS
// window is granted, and the body returns before any of the above. No life, no
// respawn (the ship stays exactly where it was), no multiplier reset, no deathSeq
// bump. Because it sits inside the SHARED body it covers BOTH the contact path and
// the programmatic `pendingDeath` path identically, and because it sits INSIDE
// _applyDeath — after the game-over/invuln guards its callers already passed — a
// charge can never be spent while the player was already safe.
//
// Story 10.5 (Afterburner) adds TWO dash seams. (a) An i-frame GATE in fixedUpdate,
// between the invulnerability countdown and the `forced` branch: while a Lv3+ dash
// window is open the player takes no lethal contact at all — no life, no deathSeq, no
// multiplier reset, and no shield charge (the gate returns before _applyDeath, so the
// dash is the cheaper defense and is used first). It counts nothing down; DashSystem
// owns the window. (b) A `dashSystem.cancel()` inside the shared death body, so a death
// during an UNPROTECTED (Lv2) dash closes the window with the death — otherwise the
// respawn re-parks the ship at arena centre and the movement dash branch flings it back
// out during its invulnerability.
//
// Circle-circle lethal when center distance ≤ ship.radius + enemy.radius
// (boundary counts, mirroring CollisionSystem). Enemies are never destroyed here
// — ship contact only kills the player; bullets destroy enemies (Story 1.4).
//
// Zero steady-state allocation: a reusable scratch array materializes the union
// of the pools' active sets each tick (iterating a Set directly can't be indexed).
export class PlayerDeathSystem extends System {
  /**
   * @param {{x:number,y:number,vx:number,vy:number,angle:number,radius:number}} ship
   *   The player ship entity (mutated on respawn).
   * @param {import('../core/Pool.js').Pool[]} enemyPools Array of enemy pools
   *   (one per archetype) whose active instances are tested against the ship.
   * @param {{lives:number, invulnMs:number, gameOver:boolean}} playerState
   *   Shared player lifecycle state (mutated here).
   * @param {{multiplier:number, multiplierKills:number}|null} [scoreState=null]
   *   Optional shared run-economy state. When provided, the multiplier and its
   *   kill-progress are reset to their start values on every death (both a
   *   respawning death and the final game-over death) — the RE1 lose-the-streak
   *   rule (FR8). Optional so callers without a score surface stay unbroken.
   * @param {{tryAbsorb:() => boolean}|null} [shieldSystem=null]
   *   Optional Nanite Shield runtime (Story 10.4). When provided, every death that
   *   reaches the shared body first offers the hit to `tryAbsorb()`; a spent charge
   *   replaces the whole life/respawn/multiplier flow. Optional (slot 5, mirroring
   *   `scoreState` at slot 4) so every existing caller and test stub is unchanged and
   *   a build with no shield behaves byte-for-byte as it did pre-10.4.
   * @param {{iFramesActive:() => boolean, cancel:() => void}|null} [dashSystem=null]
   *   Optional Afterburner dash runtime (Story 10.5). When provided, an active Lv3+
   *   dash makes the player invulnerable for the window, and every death CANCELS an
   *   in-flight dash. Optional (slot 6, mirroring `shieldSystem` at slot 5) so every
   *   existing caller and test stub is unchanged and a build with no dash behaves
   *   byte-for-byte as it did pre-10.5.
   * @param {{extraLives?:number, respawnIFramesMs?:number, softenMultiplierReset?:number}|null} [playerStats=null]
   *   Optional runtime player-stat modifier store (Story 11.8 — Reinforced Hull).
   *   When provided, extra lives delta is synced on level up, respawn i-frames scale by
   *   `respawnIFramesMs`, and `resetMultiplier` receives `playerStats` to soften reset.
   */
  constructor(
    ship,
    enemyPools,
    playerState,
    scoreState = null,
    shieldSystem = null,
    dashSystem = null,
    playerStats = null,
  ) {
    super();
    this.ship = ship;
    this.enemyPools = enemyPools;
    this.playerState = playerState;
    this.scoreState = scoreState;
    this.shieldSystem = shieldSystem;
    this.dashSystem = dashSystem;
    this.playerStats = playerStats;

    const rawInit = playerStats?.extraLives;
    this._syncedExtraLives = Number.isFinite(rawInit) ? Math.max(0, Math.min(3, Math.floor(rawInit))) : 0;

    // Public read-only observability latch (Story 4.2): the player's death point.
    // On every death (both a respawning death and the final game-over death) the
    // ship's position AT THE MOMENT OF THE LETHAL CONTACT is captured here, BEFORE
    // the respawn teleports the ship to arena center, and deathSeq is bumped. The
    // GridFieldSystem (which runs later in the tick) emits one death ripple per
    // deathSeq increment at (deathX, deathY). Purely observational — capturing these
    // never changes lives, respawn, invulnerability, scoring, or the game-over flow.
    this.deathSeq = 0;
    this.deathX = 0;
    this.deathY = 0;

    // Reusable scratch: materialized union of active enemies, refilled each tick.
    this._enemies = [];
    // Hoisted collect callback so the per-pool `forEachActive` reuses one closure
    // instead of allocating a fresh arrow per pool per tick.
    this._collectEnemy = (s) => this._enemies.push(s);
  }

  /**
   * Advance one fixed step: count down invulnerability, then (if vulnerable)
   * test ship vs seekers and apply the death flow.
   * @param {number} dt Constant fixed-step delta, in milliseconds.
   */
  fixedUpdate(dt) {
    const ps = this.playerState;

    // Story 11.8 (Reinforced Hull) — sync extra lives delta when playerStats.extraLives increases.
    if (this.playerStats && !ps.gameOver) {
      const rawExtra = this.playerStats.extraLives;
      const extra = Number.isFinite(rawExtra) ? Math.max(0, Math.min(3, Math.floor(rawExtra))) : 0;
      if (extra > this._syncedExtraLives) {
        const delta = extra - this._syncedExtraLives;
        ps.lives += delta;
        this._syncedExtraLives = extra;
      } else if (extra < this._syncedExtraLives) {
        this._syncedExtraLives = extra;
      }
    }

    // Story 6.2: consume the one-tick programmatic-death REQUEST read-and-clear at
    // the very top (the InputState.consumeBomb idiom), BEFORE the guards. Clearing
    // it here means a detonation during invulnerability or after game-over is both
    // SUPPRESSED (the guards below return) AND dropped this tick — never deferred to
    // a later, vulnerable tick.
    const forced = ps.pendingDeath;
    ps.pendingDeath = false;

    // Run ended — do nothing further (no negative lives, no further respawn). A
    // forced death after game-over is suppressed (flag already cleared above).
    if (ps.gameOver) {
      return;
    }

    // Invulnerable: count the window down (clamp ≥ 0) and take no lethal contact.
    // The window ending and the first vulnerable tick are distinct steps. A forced
    // death during invulnerability is suppressed (flag already cleared above).
    if (ps.invulnMs > 0) {
      ps.invulnMs -= dt;
      if (ps.invulnMs < 0) {
        ps.invulnMs = 0;
      }
      return;
    }

    // Story 10.5 — DASH I-FRAMES (Afterburner Lv3+). Placed AFTER the invuln countdown
    // and BEFORE the `forced` branch, which gives it exactly the semantics the invuln
    // window already has: the contact scan is skipped AND a `pendingDeath` requested
    // this tick is suppressed and DROPPED (it was read-and-cleared at the very top),
    // never deferred to a later, vulnerable tick.
    //
    // It deliberately counts NOTHING down — DashSystem owns the window, and consuming
    // `invulnMs` here would silently shorten a respawn's protection. And because it
    // returns before _applyDeath(), a dash through an enemy spends no shield charge:
    // the dash is the cheaper defense and it is used first.
    //
    // `iFramesActive()` reads DashSystem's PUBLISHED `movementActive`, so the protected
    // ticks are exactly the ticks PlayerMovementSystem applied dash velocity — no
    // unprotected leading tick, and (the defect this replaces) no unprotected trailing
    // tick at the tail of the travel.
    if (this.dashSystem && this.dashSystem.iFramesActive()) {
      return;
    }

    // Vulnerable + a programmatic death was requested this tick: apply the SAME
    // death flow as a contact death and return before the contact scan (at most one
    // death per step). The death point is the ship's current position.
    if (forced) {
      this._applyDeath();
      return;
    }

    // Vulnerable: materialize the union of active enemies into reusable scratch
    // (no alloc) — every archetype pool contributes its live instances.
    const ship = this.ship;
    const enemies = this._enemies;
    enemies.length = 0;
    const pools = this.enemyPools;
    for (let p = 0; p < pools.length; p++) {
      pools[p].forEachActive(this._collectEnemy);
    }

    // Test circle-circle; the first overlap is a lethal hit. At most one death
    // per tick — break so overlapping enemies cost exactly one life.
    for (let i = 0; i < enemies.length; i++) {
      const s = enemies[i];
      // Story 2.6: a telegraphing (spawning-in) enemy of ANY archetype is
      // non-lethal — skip it. The uniform telegraphMs field defaults to 0
      // (active/lethal) in every factory, so this one line makes every archetype
      // safe while telegraphing through this single shared seam.
      if (s.telegraphMs > 0 || s.stunMs > 0) continue;
      const dx = ship.x - s.x;
      const dy = ship.y - s.y;
      const r = ship.radius + s.radius;
      // Squared compare avoids a sqrt; ≤ so a boundary touch counts.
      if (dx * dx + dy * dy <= r * r) {
        this._applyDeath();
        break;
      }
    }
  }

  /**
   * The shared death-flow body: latch the death point, deduct a life, respawn (or
   * game-over on the last life), and reset the run multiplier. Reused by BOTH the
   * ship↔enemy contact path and the Story 6.2 programmatic (`pendingDeath`) path —
   * the SAME life/respawn/invulnerability/multiplier-reset semantics either way.
   * Callers guarantee the guards (not game-over, not invulnerable) have already
   * passed and apply at most one death per tick.
   *
   * Story 10.4: the Nanite Shield absorb is the FIRST thing here, before the death
   * latch — see the block comment inside.
   * @private
   */
  _applyDeath() {
    const ship = this.ship;
    const ps = this.playerState;

    // Story 10.4 — Nanite Shield absorb. Placed at the very top of the SHARED body so
    // it covers BOTH the ship↔enemy contact path AND the programmatic `pendingDeath`
    // path (a Black Hole detonation, Story 6.2; a Mirror Reflector weight-kill, Story
    // 6.3). Those producers exist specifically to route the SAME death flow subject to
    // the SAME guards, and the level-up i-frame gate already protects both uniformly —
    // the shield is another guard on that one flow, not a second one beside it.
    //
    // An absorb costs a CHARGE and nothing else: `lives` is unchanged, `gameOver` is
    // never set, the ship is NOT teleported to arena center, the multiplier is NOT
    // reset, and `deathSeq` is NOT bumped — so the grid death ripple, the death
    // screen-shake and the death SFX cue all stay silent. Keeping the streak and the
    // position is the whole value of the pick.
    //
    // The i-frame grant is FORCED, not decorative: the lethal test runs every fixed
    // step against a still-overlapping enemy, so with no window a 3-charge shield
    // drains in 3 ticks and the player dies anyway. Assigned DIRECTLY (not via
    // Math.max) because this body is only ever reached with `invulnMs === 0` — the
    // caller returns early while any window is in flight — so there is never a larger
    // window to shrink, and this matches the `ps.invulnMs = PLAYER_INVULN_MS` respawn
    // assignment below. That same caller guard is also why a charge can never be spent
    // while the player was already safe, and why the game-over / invuln checks stay
    // where they are in fixedUpdate rather than being duplicated here.
    if (this.shieldSystem && this.shieldSystem.tryAbsorb()) {
      ps.invulnMs = SHIELD_ABSORB_INVULN_MS;
      return;
    }

    // Story 10.5 — a death CANCELS an in-flight dash. Only reachable for an UNPROTECTED
    // dash (Lv2 owns the dash but no i-frames; a Lv3+ window returned in fixedUpdate
    // above), and placed inside the SHARED body so it covers BOTH the contact path and
    // the programmatic `pendingDeath` path, exactly as the rest of _applyDeath does.
    //
    // Without it the window survives the death: the respawn below re-parks the ship at
    // arena centre and the movement dash branch immediately flings it ~238px back out
    // during its invulnerability. `cancel()` does NOT refund the cooldown — the dash was
    // spent.
    this.dashSystem?.cancel();

    // Story 4.2 death latch: capture the death point BEFORE the respawn below
    // teleports the ship to arena center, so the grid's death ripple originates
    // at the exact lethal-contact position. Fires for both a respawning death
    // and the final game-over death. Read-only — changes no death behavior.
    this.deathX = ship.x;
    this.deathY = ship.y;
    this.deathSeq += 1;
    ps.lives -= 1;
    if (ps.lives > 0) {
      // Respawn: copy the canonical spawn so arena-center lives in one place.
      const sp = createPlayerShip();
      ship.x = sp.x;
      ship.y = sp.y;
      ship.vx = 0;
      ship.vy = 0;
      ship.angle = sp.angle;
      const rawBonus = this.playerStats?.respawnIFramesMs;
      const bonusMs = Number.isFinite(rawBonus) && rawBonus >= 0 ? rawBonus : 0;
      const newInvuln = PLAYER_INVULN_MS + bonusMs;
      ps.invulnMs = Math.max(ps.invulnMs || 0, newInvuln);
    } else {
      // Last life: game-over. Do not respawn or grant invulnerability.
      ps.lives = 0;
      ps.gameOver = true;
    }
    // FR8: wipe the run multiplier (and its progress) the instant the player
    // dies — both a respawning death and the final game-over death. Guarded
    // so a system built without a score surface still runs the death flow
    // unchanged. Score itself is untouched: you keep the points, lose the streak.
    if (this.scoreState) {
      resetMultiplier(this.scoreState, this.playerStats);
    }
  }
}
