---
title: 'Story 4.5 — Sound and Adaptive Music'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: '9b74ca4dcf3698218ffc5333db27f666bd4ca6f3'
final_revision: '3139df28ae500cdebc2bc26e2269b3d6a1afeba6'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The game is silent (FR13, NFR: immersion). Gameplay events (fire, kill, death, bomb, spawn) already fire recycle-proof latches the grid/particles/screen-juice read, but nothing turns them into sound; there is no music, and no mute/volume control. Epic 4 is the "everything glows, everything moves" pillar — it must also *sound* like Retro Evolved.

**Approach:** Mirror the Story 4.2/4.3/4.4 seam structure. Add a Phaser-free `AudioDirectorSystem` (registered LAST, after `ScreenFeedbackSystem`) that observes the SAME event sources — `firingSystem.shotsFiredCount` (fire), `collisionSystem.bulletKillCount` (kill), the `bombSystem.shockwaveMs` rising edge (bomb), the `playerDeathSystem.deathSeq` increment (death), and a new `spawnDirector.spawnCount` (spawn) — into render-consumable SFX-request latches, and reads the `SpawnDirector` difficulty ramp (`progressAt(elapsedMs)`) into a live `musicIntensity` level. A pure `audioMix.js` seam holds the intensity→layer-gain and volume/mute math. A guarded `audioSettingsStorage.js` port persists `{muted, volume}` (mirrors `highScoreStorage`, its own key; Story 5.3 later consolidates settings). Because there are ZERO art assets in this codebase (all visuals are procedurally drawn), audio is procedurally synthesised too: a browser-bound `audioEngine.js` (Web Audio API via Phaser's `this.sound.context`; the disclosed manual-verification boundary, exactly like the ArenaScene render wiring) produces the SFX blips and the continuously-running adaptive-music voices. `ArenaScene` wires it: consume the SFX latches (capped per frame) → trigger engine SFX; map `musicIntensity` → layer gains → engine; own mute/volume keys that update, persist, and re-apply master gain; dispose the engine on scene shutdown.

## Boundaries & Constraints

**Always:**
- **Runs LAST, read-only:** `AudioDirectorSystem` registers after `ScreenFeedbackSystem`, so every source it reads is final within the tick. It mutates ONLY its own latch fields — no pool, entity, score, life, death, or spawn state changes (a pure observer, exactly like `GridFieldSystem`/`ParticleSystem`/`ScreenFeedbackSystem`).
- **Event→SFX mapping:** each fixed step accumulate `+firingSystem.shotsFiredCount` into pending fire, `+collisionSystem.bulletKillCount` into pending kill, `+spawnDirector.spawnCount` into pending spawn; raise a one-shot bomb flag on the `bombSystem.shockwaveMs` rising edge and a one-shot death flag on each `playerDeathSystem.deathSeq` increment. Accumulate across sub-steps so a multi-sub-step frame is summed, then consumed once by the render loop.
- **Edge seeding:** `_prevShockwaveMs`/`_prevDeathSeq` are seeded from the current source values at construction so no cue fires spuriously on the first tick (mirrors `ScreenFeedbackSystem`).
- **Adaptive music = the difficulty ramp:** `musicIntensity` is the latest `spawnDirector.progressAt(spawnDirector.elapsedMs)` (0 at run start → 1 at ramp end), stored each fixed step and exposed as a getter. It is a LEVEL, not an event: read (never consumed/reset) by the render loop, which maps it through `audioMix.musicLayerGains` to per-layer gains. More difficulty ⇒ more music layers audible.
- **Latches consumed by the render loop:** `consumeSfxRequests()` returns `{fire, kill, spawn, bomb, death}` (fire/kill/spawn are non-negative counts; bomb/death are booleans) and resets all to 0/false. `ArenaScene` triggers at most `AUDIO_SFX_*_MAX_PER_FRAME` sounds per SFX type per frame (fire/kill/spawn) and one bomb/death sound, so a burst cannot flood the mixer.
- **Mute/volume respected + persisted:** `ArenaScene` loads `{muted, volume}` via `audioSettingsStorage` in `create()`; a mute key toggles `muted`, two volume keys step `volume` by `AUDIO_VOLUME_STEP` (clamped 0..1 via `audioMix.adjustVolume`); every change persists via the port AND re-applies `audioEngine.setMasterGain(effectiveVolume(volume, muted))`. Muted ⇒ effective gain 0 (silence) but the sim, latches, and music voices keep running (only master gain is 0).
- **Procedural synthesis, guarded:** `audioEngine.js` takes an `AudioContext` (Phaser's `this.sound.context`) or `null`; a null/absent/blocked context degrades EVERY method to a silent no-op (mirrors the guarded `highScoreStorage`). It imports NO Phaser and reads only `AUDIO_*` constants for its magnitudes. Continuously-running music voices are built once; `dispose()` stops + disconnects them.
- **Fresh + leak-free per run:** a new `AudioDirectorSystem` (seeded prevs, zeroed latches) each `create()`/`scene.restart()`. The previous run's `AudioEngine` is disposed on the scene `shutdown` event so its persistent music oscillators never stack/leak across restarts.
- All tunables are `AUDIO_*` in `constants.js` as documented post-launch placeholders (mirrors `GRID_*`/`PARTICLE_*`/`SCREEN_*`): master-volume default, volume step, muted default, storage key, music layer count/max-gain/base-freq/gain-smoothing, and per-SFX freq/duration/gain + per-frame caps. No magic numbers inline in the system, the mix seam, the engine, or the `ArenaScene` call sites.

**Block If:**
- Nothing new gates this story. If a genuinely unresolvable platform mismatch surfaces during implementation (e.g. Phaser exposes neither a Web Audio context nor a usable fallback), HALT with specifics — but none is anticipated (a null context simply degrades to silence).

**Never:**
- Do NOT change any simulation/gameplay behavior. Reading the fire/kill/bomb/death/spawn sources and the ramp is observation only — no firing, kills, scoring, lives, respawn, spawning, or the game-over flow may change. The `shotsFiredCount`/`spawnCount` additions to `FiringSystem`/`SpawnDirector` are pure read-only counters (reset+increment), like `CollisionSystem.bulletKillCount`; they must not alter cadence, cap, mix, or placement.
- Do NOT load audio FILES or add an asset pipeline — there are no assets in this project; synthesis is procedural (Web Audio). Do NOT build a settings UI/menu (Story 5.3 owns settings) — mute/volume are keyboard-driven this story. Do NOT let audio throw into or block the render/sim loop, and do NOT allocate on the per-tick / per-frame hot path.

## I/O & Edge-Case Matrix

Scope: pure calls over fakes (no Phaser, no Web Audio). `AudioDirectorSystem`, `audioMix.js`, and `audioSettingsStorage.js` are Phaser-free and node-testable; sources are faked like `screenFeedbackSystem.test.js`. `audioEngine.js` + the `ArenaScene` wiring are the disclosed manual-verification boundary (Web Audio absent under node).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fire event | `shotsFiredCount=2` this tick | `consumeSfxRequests().fire === 2` | none |
| Kill event | `bulletKillCount=3` | `.kill === 3` | none |
| Spawn event | `spawnCount=1` | `.spawn === 1` | none |
| Bomb edge | `shockwaveMs` rises 0→N | `.bomb === true` (raised once) | none |
| Death edge | `deathSeq` increments | `.death === true` (raised once) | none |
| Multi-sub-step sum | two ticks, fire 1 then 2, no consume between | `.fire === 3` | none |
| Seeded prevs | constructed mid-run (shockwave decaying, deathSeq>0) | first tick, no new edge → `.bomb === false`, `.death === false` | none |
| Consume resets | consume, then consume again with no new event | all counts 0, bomb/death false | none |
| Music intensity | `spawnDirector` at elapsed 0 / mid-ramp / past ramp | `musicIntensity` === 0 / progress / 1 (not reset by consume) | none |
| Gameplay neutral | fire+kill+spawn+bomb+death one tick | ship, enemies, bullets, kill count, score, lives, spawn cadence all unchanged after `fixedUpdate` | none |
| `musicLayerGains(i)` | i=0 / i=1 / i mid | array length `AUDIO_MUSIC_LAYER_COUNT`; each in [0, `MAX_GAIN`]; more layers > 0 as i rises; monotonic non-decreasing per layer | clamps |
| `effectiveVolume(v,muted)` | (0.6,false) / (0.6,true) / (2,false) / (-1,false) | 0.6 / 0 / clamp 1 / clamp 0 | clamps 0..1 |
| `adjustVolume(v,d)` | (0.6,+0.1) / (0.95,+0.1) / (0.05,-0.1) | 0.7 / clamp 1 / clamp 0 | clamps 0..1 |
| `clampVolume(v)` | 0.5 / 1.5 / -0.2 | 0.5 / 1 / 0 | clamps |
| Settings load default | store empty | `{muted:AUDIO_MUTED_DEFAULT, volume:AUDIO_MASTER_VOLUME_DEFAULT}` | defaults |
| Settings load valid | store `{"muted":true,"volume":0.3}` | `{muted:true, volume:0.3}` | none |
| Settings load corrupt | store `"not json"` / out-of-range volume | defaults / volume clamped | swallow, default |
| Settings save/blocked | `save()` with throwing/absent store | no throw (best-effort no-op) | swallowed |
| `FiringSystem.shotsFiredCount` | aim active, one interval elapses | `=== 1` this tick, resets next tick | none |
| `SpawnDirector.spawnCount` | one spawn fires this tick | `=== 1`, resets next tick; 0 when capped/no-spawn | none |

</intent-contract>

## Code Map

- `src/config/constants.js` -- ADD an "Audio & adaptive music (Story 4.5)" section + `AUDIO_SETTINGS_STORAGE_KEY = 'angleWars.audioSettings'`: `AUDIO_MASTER_VOLUME_DEFAULT`, `AUDIO_VOLUME_STEP`, `AUDIO_MUTED_DEFAULT`; music: `AUDIO_MUSIC_LAYER_COUNT`, `AUDIO_MUSIC_LAYER_MAX_GAIN`, `AUDIO_MUSIC_BASE_FREQ`, `AUDIO_MUSIC_GAIN_SMOOTHING`; per-SFX (fire/kill/spawn/bomb/death) `_FREQ`/`_MS`/`_GAIN`; per-frame caps `AUDIO_SFX_FIRE_MAX_PER_FRAME`/`_KILL_MAX_PER_FRAME`/`_SPAWN_MAX_PER_FRAME`. Documented placeholders (mirrors the `SCREEN_*` section).
- `src/systems/AudioDirectorSystem.js` -- NEW Phaser-free read-only `System`. Ctor `(firingSystem, collisionSystem, bombSystem, playerDeathSystem, spawnDirector)`. Seeds `_prevShockwaveMs`/`_prevDeathSeq`. `fixedUpdate(dt)`: accumulate fire/kill/spawn counts, edge-detect bomb/death flags, store `_musicIntensity` from the ramp. Public: `consumeSfxRequests()` (returns `{fire,kill,spawn,bomb,death}`, resets), `get musicIntensity()`.
- `src/audio/audioMix.js` -- NEW Phaser-free math seam: `musicLayerGains(intensity)` (→ array of `AUDIO_MUSIC_LAYER_COUNT` gains, layer i fading in over its `[i/N, (i+1)/N]` band up to `AUDIO_MUSIC_LAYER_MAX_GAIN`, clamped), `effectiveVolume(volume, muted)` (0 if muted else `clampVolume`), `clampVolume(v)`, `adjustVolume(current, delta)`. Imports NO Phaser (mirrors `screenShake.js`).
- `src/persistence/audioSettingsStorage.js` -- NEW guarded port (mirrors `highScoreStorage.js`): `createAudioSettingsStorage(storage = defaultLocalStorage())` → `{ load(): {muted, volume}, save({muted, volume}): void }`. Guarded acquisition; `load()` parses JSON and returns clamped/typed values, defaults on missing/corrupt/blocked; `save()` best-effort, never throws.
- `src/audio/audioEngine.js` -- NEW browser-bound synth (Web Audio API; the disclosed manual-verification boundary). Ctor `(audioContext | null)`. Builds a master `GainNode` + `AUDIO_MUSIC_LAYER_COUNT` continuously-running oscillator voices (each through its own gain into master). `playSfx(type)` (short enveloped blip per type from the `AUDIO_SFX_*` constants), `setMusicLayerGains(gains)` (smoothed via `setTargetAtTime`), `setMasterGain(gain)`, `dispose()`. A null/absent context degrades every method to a no-op. Imports NO Phaser; reads only `AUDIO_*` constants.
- `src/scenes/ArenaScene.js` -- construct `AudioDirectorSystem(...)` and `world.addSystem` it LAST (after `ScreenFeedbackSystem`); build `this.audioEngine = new AudioEngine(this.sound && this.sound.context)`; load `{muted, volume}` via `createAudioSettingsStorage()` and apply the master gain; add mute (`M`) + volume-down/up key handlers that update state, persist via the port, and re-apply `effectiveVolume`; in `update()` after the sim advances, consume the SFX latches (capped per type) → `audioEngine.playSfx(...)`, and map `audioDirector.musicIntensity` → `musicLayerGains` → `audioEngine.setMusicLayerGains(...)`; dispose the engine on the scene `shutdown` event (leak-free restart).
- `src/systems/FiringSystem.js` -- ADD a per-tick `shotsFiredCount` latch (init 0; reset to 0 at top of `fixedUpdate`; `++` per bullet spawned) — read-only observation seam, gameplay-neutral (mirrors `CollisionSystem.bulletKillCount`).
- `src/systems/SpawnDirector.js` -- ADD a per-tick `spawnCount` latch (init 0; reset to 0 at top of `fixedUpdate`; `++` once per actual spawn in `_pickAndSpawn`) — read-only, gameplay-neutral (one director spawn = one spawn event, even when a Snake adds many segments).
- `src/systems/audioDirectorSystem.test.js` -- NEW; unit-test every system I/O-matrix row (fire/kill/spawn counts, bomb/death edges, multi-sub-step sum, seeded prevs, consume-reset, music-intensity read, gameplay neutrality) with fakes.
- `src/audio/audioMix.test.js` -- NEW; unit-test `musicLayerGains` (length/band/clamp/monotonic/more-layers-as-intensity-rises), `effectiveVolume` (mute/passthrough/clamp), `adjustVolume` (step/clamp), `clampVolume` (clamp).
- `src/persistence/audioSettingsStorage.test.js` -- NEW; unit-test load (default/valid/corrupt/out-of-range) and save (best-effort/blocked/throwing store) with a fake + throwing Storage.
- `src/systems/firingSystem.test.js`, `src/systems/spawnDirector.test.js` -- EXTEND with cases for the new `shotsFiredCount` / `spawnCount` latches (increments on spawn, resets each tick, 0 when nothing spawns / capped).

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the `AUDIO_*` section + `AUDIO_SETTINGS_STORAGE_KEY` -- centralized tunables, no inline magic numbers.
- `src/systems/FiringSystem.js` -- add the read-only `shotsFiredCount` per-tick latch -- the fire-event source for the audio director (gameplay-neutral).
- `src/systems/SpawnDirector.js` -- add the read-only `spawnCount` per-tick latch -- the spawn-event source (one event per director spawn; gameplay-neutral).
- `src/systems/AudioDirectorSystem.js` -- implement the read-only event→SFX-latch + music-intensity system -- the Phaser-free simulation seam for audio.
- `src/audio/audioMix.js` -- implement `musicLayerGains`, `effectiveVolume`, `clampVolume`, `adjustVolume` -- the Phaser-free audio math.
- `src/persistence/audioSettingsStorage.js` -- implement the guarded `{muted, volume}` persistence port -- best-effort, never throws (mirrors `highScoreStorage`).
- `src/audio/audioEngine.js` -- implement the procedural Web Audio synth (SFX blips + adaptive-music voices + master gain + dispose), null-context-safe -- the browser-bound audio output (manual-verification boundary).
- `src/scenes/ArenaScene.js` -- register the director last, build + wire the engine, load/apply/persist mute+volume via keys, drive SFX + music from the latches/intensity, dispose on shutdown -- integrates audio with zero per-frame allocation and no gameplay change.
- `src/systems/audioDirectorSystem.test.js`, `src/audio/audioMix.test.js`, `src/persistence/audioSettingsStorage.test.js` -- unit-test every I/O-matrix row.
- `src/systems/firingSystem.test.js`, `src/systems/spawnDirector.test.js` -- extend with the new-latch cases.

**Acceptance Criteria:**
- Given gameplay events (fire, kill, death, bomb, spawn), when they occur, then appropriate SFX play — confirmed via `npm run dev`; automated seam: `AudioDirectorSystem` accumulates the correct per-event counts and raises the bomb/death edge flags exactly on the shockwave rising edge / `deathSeq` increment, and the `FiringSystem.shotsFiredCount` / `SpawnDirector.spawnCount` latches track spawns (`audioDirectorSystem.test.js`, `firingSystem.test.js`, `spawnDirector.test.js`).
- Given a run intensifies, when difficulty ramps, then the background music intensity adapts — confirmed via `npm run dev`; automated seam: `musicIntensity` tracks the `SpawnDirector` ramp progress and `musicLayerGains` brings additional layers up as intensity rises (`audioDirectorSystem.test.js`, `audioMix.test.js`).
- Given the player wants quiet, when they toggle mute or change volume, then audio respects the setting and it persists across runs/reloads — confirmed via `npm run dev` (toggle, restart/reload, setting retained); automated seam: `effectiveVolume`/`adjustVolume` compute the correct gain (0 when muted) and `audioSettingsStorage` round-trips `{muted, volume}` and degrades safely on a blocked/corrupt store (`audioMix.test.js`, `audioSettingsStorage.test.js`).
- Given audio intensity is tuned, when configured, then every magnitude (volumes, step, music layer count/gain/freq, per-SFX freq/duration/gain, per-frame caps) is a centralized `AUDIO_*` constant — verified by the constants section and the seam/system/engine reading only those.
- Given audio ships, when the simulation runs, then gameplay is unchanged — the same fire cadence, spawns, kills, scores, lives, deaths, and game-over as before (read-only observers + gameplay-neutral counters) — confirmed by the existing suites remaining green and the gameplay-neutrality test.

## Spec Change Log

_No amendments — no bad_spec loopback occurred._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` `clamp01` in `audioMix.js` passed NaN through (`NaN < 0` and `NaN > 1` both false → NaN gains → a thrown `setTargetAtTime(NaN)`). Hardened the sole mix-seam clamp to `if (!(t > 0)) return 0` (NaN/negatives/0 → 0) and added a NaN test. Verified all prior clamp behavior unchanged.
  - `[low]` `[patch]` `musicLayerGains` layer→index mapping was unpinned — a reversed fade order passed every (order-agnostic) test. Added an exact per-index assertion pinning layer 0 audible first (its band `[0, 1/N]`) and layer N-1 last. Code was already correct; this closes a broken-verification gap.
  - `[low]` `[patch]` `musicIntensity` "live level across ticks" was never verified (every test single-ticked a fresh instance) — a first-tick-only latch would pass. Added a two-tick rising-`elapsedMs` test asserting the level moves 0 → ~0.5. Code correct; regression gap closed.
  - `[low]` `[patch]` `SpawnDirector.spawnCount` float-guard fallback branch (line ~218) was untested (all tests used `seqRng([0.0])`, resolving in the first loop). Added a test with `rng: () => 1` forcing the fallback path. Code correct; regression gap closed.
  - `[low]` `[patch]` Repeated bomb/death cues were uncovered (single-edge tests only) — a once-per-lifetime latch would pass. Added second-detonation and second-death tests. Code uses rolling prevs (correct); regression gap closed.
- rejected (not defects — intent-sanctioned readings/tunables, shipped conventions, or the disclosed manual-verification boundary; substantive ones recorded as residual risks):
  - **Music intensity tracks the time-based difficulty ramp, not live on-screen danger; plateaus at 1 after the ramp** — the `SpawnDirector` ramp IS this game's difficulty escalation, so AC2 ("as difficulty ramps") is satisfied by the intended reading; a live-danger signal is a design enhancement beyond the intent.
  - **Music is silent at run start (all layers 0 at intensity 0)** — on-intent ("music that builds with the action"); SFX still fire immediately, and the layer gains/bands are documented `AUDIO_*` placeholders. Residual risk (playtest tuning).
  - **Black-hole absorbs / bomb-cleared enemies produce no per-kill SFX** — intent-sanctioned narrow "kill" = `collisionSystem.bulletKillCount`, the SAME convention the shipped grid ripple (4.2) / particles (4.3) / screen juice (4.4) use; bomb has its own cue. Residual risk.
  - **Same-tick double-bomb detonation missed (strict `shockwaveMs > prev`), death via `!==`** — mirrors the shipped `ScreenFeedbackSystem` (4.4) / `GridFieldSystem` (4.2) edge-detection exactly; a human cannot detonate two bombs within one 16.7 ms fixed step and `deathSeq` is monotonic. Residual risk.
  - **No defensive `ctx.resume()` / procedural audio bypasses Phaser's master gain** — reusing Phaser's `this.sound.context` is the spec's chosen approach (Phaser handles the autoplay-unlock/resume for its own context); this engine is the sole audio source (all-procedural, no Phaser-loaded sounds). The Web Audio path is the disclosed manual-verification boundary. Residual risk.
  - **No mute/volume on-screen UI or feedback, `=`-key volume-up discoverability, music holds at max on game-over, synchronous save on each keypress, per-frame SFX caps drop excess** — settings UI/affordance is explicitly deferred to Story 5.3 (per the intent parenthetical); the caps/game-over behavior are intent-sanctioned tunable `AUDIO_*` placeholders; the guarded per-keypress save writes a tiny payload. Residual risks where substantive.
  - **The audible-output surface (SFX emitted, music audible, mute silences, setting round-trips in-browser) has no automated coverage** — the disclosed manual-verification boundary (`audioEngine.js` + `ArenaScene` wiring; Web Audio and Phaser are absent under vitest/node), identical to the 4.1/4.2/4.3/4.4 precedent; the Phaser-free director + `audioMix` + storage seams carry the automated coverage. Residual risk.

### 2026-07-20 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - none
- rejected (follow-up pass; four review layers — adversarial, edge-case, verification-gap, intent-alignment — re-run against the shipped diff. All findings are intent-sanctioned residual risks or noise; most re-surface items already rejected in the first pass. Verification re-confirmed: `npm test` 540/540 green, `npm run build` succeeds):
  - **Per-frame SFX caps drop the over-cap remainder rather than deferring it; audible feedback thins during the busiest combat** — intent explicitly prescribes "triggers at most `AUDIO_SFX_*_MAX_PER_FRAME` per type per frame so a burst cannot flood the mixer"; dropping excess is the sanctioned anti-flood behavior. Residual risk (playtest tuning).
  - **`audioEngine.js` (Web Audio synth) and the `ArenaScene` render/input wiring — including the inline SFX-cap loop and the M/`-`/`=` mute/volume key handlers — carry no automated coverage** — the disclosed manual-verification boundary (the 4.1–4.4 precedent); Web Audio + Phaser are absent under vitest/node. The Phaser-free director + `audioMix` + storage seams hold the automated coverage. Residual risk.
  - **`playSfx` amplitude envelope would misbehave if a future `AUDIO_SFX_*_MS` ≤ 10 ms or `*_GAIN` = 0 were configured** — non-issue with shipped constants (all `_MS` 60–600 ms, all `_GAIN` 0.12–0.5), and the whole method is `try/catch`-wrapped so any future bad tune degrades to silence, never throwing into the loop (intent: audio must not throw into/block the loop). The magnitudes are documented tunable placeholders. Residual risk.
  - **Bomb cue can miss two detonations ~1 fixed-tick (~16 ms) apart** — `shockwaveMs` saturates at `BOMB_SHOCKWAVE_MS` then decays within the tick, so two consecutive detonation ticks read the same value and the strict-`>` rising edge sees no rise. The intent explicitly prescribes "rising edge on `bombSystem.shockwaveMs`," mirroring the shipped `GridFieldSystem` (4.2) / `ScreenFeedbackSystem` (4.4) edge detection; two bomb detonations within one fixed step are not reachable by human input. Residual risk (sharper restatement of the first pass's same-tick rejection).
  - **Music holds at the frozen intensity on the game-over screen (drone continues until mute)** — the game-over gate freezes the sim, and `musicIntensity` is a per-frame LEVEL the render loop keeps mapping; the intent does not specify a game-over fade, and the mute key still silences. Intent-sanctioned tunable behavior (Story 5.3 owns settings/UX). Residual risk.
  - **`setMusicLayerGains` re-issues `setTargetAtTime` every render frame; keyboard-only volume/mute with no on-screen indicator; synchronous `localStorage` write per keypress; 5-arg positional director ctor with guarded (silent-degrading) source reads; `musicLayerGains` `out`-buffer length unvalidated; `muted` read as strict boolean vs. `!!muted` on write** — noise or matches-shipped-convention: `setTargetAtTime` per-frame is a standard idempotent re-anchor on the disclosed boundary; on-screen settings UI is explicitly deferred to Story 5.3; per-keypress save writes a tiny guarded payload (mirrors `highScoreStorage`); positional guarded ctors mirror every other system in the codebase; the `out` buffer is always exactly `AUDIO_MUSIC_LAYER_COUNT` at the sole call site; and `save()` only ever writes canonical booleans so the strict-boolean read round-trips every value this port produces. No present defect.
  - **Intent-alignment audit (descriptive):** the diff faithfully implements the intent; the only divergence is a proof-surface offset — AC1–AC3 expectations physically live at `audioEngine.js` + the `ArenaScene` wiring while the automated tests sit one layer upstream on the pure/Phaser-free seams. This IS the disclosed manual-verification boundary (Reading A), the intended and documented design. No prescriptive finding.

## Design Notes

**Why procedural synthesis (no assets).** This codebase has ZERO art assets — the ship, bullets, enemies, grid, and particles are all drawn procedurally (`graphics.fill*`, a GPU shader). `PreloadScene.preload()` is empty. Loading audio files would be the only asset pipeline in the project and would leave binary blobs the repo has no place for. Synthesising SFX/music with the Web Audio API keeps the "no assets, everything generated" identity and needs no build/asset wiring. The synth is a faithful reading of "SFX play / music adapts," not a shortcut.

**Why the same sources + last-in-pipeline.** The fire/kill/bomb/death/spawn events already have recycle-proof, edge-detected latches; reading them at end-of-tick (registered LAST, after `ScreenFeedbackSystem`) means no one-tick lag and no new sim plumbing beyond the two pure counters. The grid ripple, the particle burst, the screen shake, and now the sound are all renderings of the SAME events.

**Why the ramp drives music.** The `SpawnDirector`'s `progressAt(elapsedMs)` IS the difficulty ramp (spawn interval + enemy mix escalation both key off it). Reusing it as the single music-intensity signal makes "music adapts as difficulty ramps" literally true, with no second notion of difficulty to keep in sync.

**Why render-side engine + dispose.** Web Audio (`AudioContext`, oscillators, gains) is browser-bound and absent under vitest/node — so the actual synthesis is the disclosed manual boundary (the 4.1–4.4 precedent), while the Phaser-free director + `audioMix` + storage carry the automated coverage. Continuously-running music voices must be torn down on `scene.restart()` (the `shutdown` event → `dispose()`), or every restart would stack another set of oscillators on the shared context. Reusing Phaser's `this.sound.context` lets Phaser handle the autoplay-policy unlock/resume on first user gesture; a null/blocked context degrades to silence like the guarded high-score store.

**Settings storage is interim.** `{muted, volume}` persists through its own guarded port + key now; Story 5.3 owns the consolidated settings model and will absorb it (per the epic's cross-story note). Keeping it a tiny isolated port mirrors `highScoreStorage` and makes that later consolidation a move, not a rewrite.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new `audioDirectorSystem.test.js`, `audioMix.test.js`, `audioSettingsStorage.test.js` and the extended `firingSystem.test.js` / `spawnDirector.test.js`; every other existing suite unchanged and green (gameplay-neutral change).
- `npm run build` -- expected: production build succeeds (pre-existing Phaser chunk-size advisory is not a failure).

**Manual checks:**
- `npm run dev`: firing gives a rapid tick, each kill a pop, an enemy spawn a chirp, a bomb a low boom, and death a descending tone; as a run drags on and difficulty ramps, more music layers fade in (fuller/busier); pressing `M` mutes/unmutes and the two volume keys step volume audibly; after muting (or setting a volume) then reloading/restarting, the setting is retained; a busy late-game arena with bloom, grid warp, dense particles, screen shake AND audio all active holds the FPS readout at/near 60; no audio errors in the console and no residual/stacked music after several restarts.

## Auto Run Result

Status: done (follow-up review pass; a `done` spec re-entered dev-auto and routed to a fresh review, per step-01).

**Summary of implemented change:** Story 4.5 adds procedurally-synthesised sound + adaptive music to the silent game, mirroring the 4.2/4.3/4.4 observer-seam structure. A Phaser-free read-only `AudioDirectorSystem` (registered LAST) accumulates fire/kill/spawn counts and edge-detects bomb/death cues from the same event sources the grid/particles/screen-juice already read, and exposes a `musicIntensity` level from the `SpawnDirector` difficulty ramp. Pure `audioMix.js` holds the intensity→layer-gain and volume/mute math; a guarded `audioSettingsStorage.js` port persists `{muted, volume}`; a browser-bound `audioEngine.js` (Web Audio) synthesises SFX blips and continuously-running music voices; `ArenaScene` wires it all (capped SFX per frame, intensity→gains, M/`-`/`=` keys that persist + re-apply master gain, engine disposal on `shutdown`). Two read-only, gameplay-neutral counters (`FiringSystem.shotsFiredCount`, `SpawnDirector.spawnCount`) feed the director.

**Files changed** (all committed in `bf1f9fe`; this follow-up pass added no code):
- `src/config/constants.js` — `AUDIO_*` tunables section + settings storage key.
- `src/systems/FiringSystem.js` / `src/systems/SpawnDirector.js` — read-only per-tick `shotsFiredCount` / `spawnCount` latches.
- `src/systems/AudioDirectorSystem.js` — read-only event→SFX-latch + music-intensity observer.
- `src/audio/audioMix.js` — `musicLayerGains` / `effectiveVolume` / `clampVolume` / `adjustVolume`.
- `src/persistence/audioSettingsStorage.js` — guarded `{muted, volume}` port.
- `src/audio/audioEngine.js` — procedural Web Audio synth (manual-verification boundary).
- `src/scenes/ArenaScene.js` — director registration + engine wiring + keys + dispose.
- `src/systems/audioDirectorSystem.test.js`, `src/audio/audioMix.test.js`, `src/persistence/audioSettingsStorage.test.js`, and extended `firingSystem.test.js` / `spawnDirector.test.js` — unit coverage.

**Review findings breakdown (this pass):** 0 intent_gap, 0 bad_spec, 0 patch applied, 0 deferred, 14 rejected (all `low`). Four review layers re-run (adversarial, edge-case, verification-gap, intent-alignment). Every finding is an intent-sanctioned residual risk (per-frame SFX-cap drop, disclosed manual-verification boundary for `audioEngine.js`/`ArenaScene` wiring, bomb rising-edge on `shockwaveMs`, game-over music hold, keyboard-only controls) or noise; most re-surface first-pass rejections. See the follow-up Review Triage Log entry for the full rationale.

**Follow-up review recommendation:** `false` — 0 findings triaged `patch` this pass (score 0: high 0, medium 0, low 0).

**Verification performed:** `npm test` → 540/540 pass across 35 files (incl. `audioDirectorSystem`, `audioMix`, `audioSettingsStorage`, extended `firingSystem`/`spawnDirector`). `npm run build` → succeeds (pre-existing Phaser chunk-size advisory only). Shipped `AUDIO_SFX_*` constants confirmed safe for the `playSfx` envelope (all `_MS` 60–600 ms, all `_GAIN` 0.12–0.5) and the method is `try/catch`-guarded.

**Residual risks:** audible output (SFX emitted, music audible, mute silences, settings round-trip in-browser) rests on the disclosed manual-verification boundary — Web Audio + Phaser are absent under vitest/node, so `npm run dev` is the confirmation path. Audio magnitudes / per-frame caps / game-over music behavior are documented tunable `AUDIO_*` placeholders pending playtest. Settings storage is interim (Story 5.3 consolidates settings/UX).

**Residual artifacts (not part of this change):** `_bmad-output/implementation-artifacts/sprint-status.yaml` was already modified in the working tree before this run began (orchestrator-owned); left in place.

