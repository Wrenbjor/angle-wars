---
title: '12.2 — Fusion UX (HUD ⚡ FUSION READY badge, gold Epic card with particle aura + recipe text, audio sting on ready + on pick)'
type: 'feature'
created: '2026-07-29'
status: 'in-review'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '6c92c9a2c20a872469a10a2416dd5276a105dfa4'
final_revision: ''
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md' # Epic 12 story descriptions
  - '{project-root}/_bmad-output/planning-artifacts/prd.md' # PRD §13.6 Fusion UX spec
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md' # Fusion mechanics + tree context
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-1-fusion-core.md' # Fusion sim-side framework (parent story)
  - '{project-root}/src/scenes/ArenaScene.js' # HUD rendering + level-up card drawing
  - '{project-root}/src/systems/AudioDirectorSystem.js' # SFX event latches
  - '{project-root}/src/audio/audioEngine.js' # Web Audio synthesis
  - '{project-root}/src/systems/ParticleSystem.js' # Pooled particle emission
  - '{project-root}/src/config/constants.js' # All style/audio constants
---

<!-- Story 12.2 — Fusion UX
The sim-side fusion framework is Story 12.1. This story adds the visual + audio
feedback that makes fusion feel like the "event of the run."

From PRD §13.6:
  "When both conditions are met, the next level-up guarantees the Epic card in slot 1,
   rendered differently — gold border, particle aura, the fusion recipe shown beneath,
   a distinct audio sting. It replaces the Lv5 item; the fusion partner is consumed to a
   Lv3 remnant. A ⚡ FUSION READY badge appears on the HUD the moment the condition is
   satisfied. The anticipation between 'ready' and the next level-up is a genuine tension
   spike — protect it."
-->

## Intent

**Problem:** FusionCore (Story 12.1) has the full recipe registry, condition detection,
offer guarantee, and resolution plumbing — but the player has **zero feedback** that a
fusion is ready. The UX story adds five distinct layers:
1. A **⚡ FUSION READY** badge on the HUD that appears the instant the fusion condition is met.
2. **Gold border + particle aura** on the Epic card in the level-up offer.
3. **Fusion recipe text** beneath the Epic card.
4. A **distinct audio sting** when the fusion condition is first detected (the tension
   event).
5. A **second audio sting** when the player actually chooses the Epic card (the payoff).

The anticipation (badge → level-up → gold card → payoff) is the tension spike the PRD
calls for. Every layer reinforces that a fusion is a *big deal*.

**Appro:** Extend existing render paths rather than creating new systems:
- HUD badge: add a separate `this.fusionBadge` Phaser.text object alongside the HUD text,
  positioned top-left, toggled visible in the `update()` loop.
- Gold card: modify the card-panel graphics rendering to detect `card.isEpicCard` and
  draw a gold-styled border with gradient fill.
- Recipe text: draw the recipe description below the card title, only for fusion cards.
- Particle aura: add a public `emitBurst()` to ParticleSystem so the render loop can
  fire golden particles from the card UI each frame while the level-up overlay is open
  AND a fusion card is in slot 0.
- Audio sting: add `fusionsReady` latch to AudioDirectorSystem (consumed by the render
  loop once per frame → triggers `audioEngine.playSfx('fusion')`), and a separate
  `fusionPick` latch for the card-selection event. SFX specs: a rising arpeggio (4
  ascending tones) with a bright attack, distinct from kill/merge/death.

## Boundaries & Constraints

**Always:**
- HUD badge text is `⚡ FUSION READY` with the ⚡ emoji as the lightning bolt.
- The Epic card in slot 0 is the **only** card with gold styling (other cards remain green).
- The particle aura on the gold card is a continuous emission (several particles per
  frame while the overlay is open with fusion), bounded by the global particle cap.
- Audio stings are one-shot events consumed once per edge (matching the bomb/death latch
  pattern). The fusion-ready sting fires when the condition transitions from false→true;
  the fusion-pick sting fires once when the Epic card is applied.
- Story stubs in FusionSystem are untouched — Epic effects remain no-ops.

**Block If:** None. All design decisions specified below.

**Never:**
- Modify FusionSystem (12.1) — sim-side condition detection stays pure query.
- Implement any Epic effect (that is 12.3–12.16).
- Add new game mechanics (only visual/audio feedback is in scope).
- Add Phaser scene nodes directly to the particle system — use the existing ParticleSystem.

## Code Map

- `src/scenes/ArenaScene.js` -- HUD text + card panel rendering + particle emission for fusion aura -- EXTEND
- `src/systems/AudioDirectorSystem.js` -- fusionsReady/fusionPick latches and edge detection -- EXTEND
- `src/audio/audioEngine.js` -- SFX type 'fusion' (rising arpeggio sting) -- EXTEND
- `src/systems/ParticleSystem.js` -- public `emitBurst(x, y, count, color, maxSize)` method -- EXTEND
- `src/config/constants.js` -- HUD badge font, gold color, particle burst constants -- EXTEND
- `src/systems/fusionSystem.test.js` -- no changes (sim-side is test-covered by 12.1)
- `src/systems/levelUpSystem.test.js` -- no changes (sim-side is test-covered by 12.1)

## Tasks & Acceptance

**Implementation:**

- `src/config/constants.js` -- MODIFY — add:
  - `COLOR_FUSION_GOLD = 0xffcc00` (gold card border)
  - `COLOR_FUSION_GOLD_TEXT = '#ffcc00'` (gold text for card title)
  - `FUSION_BADGE_FONT = '16px monospace'` (smaller than HUD for badge)
  - `COLOR_FUSION_BADGE = '#ffcc00'` (gold badge text)
  - `FUSION_BADGE_MARGIN = 16` (inset from left edge)
  - `AUDIO_SFX_FUSION_FREQ = 880` (starting freq for rising arpeggio)
  - `AUDIO_SFX_FUSION_MS = 400` (100ms × 4 tones)
  - `AUDIO_SFX_FUSION_GAIN = 0.35`
  - `FUSION_PARTICLE_COUNT = 4` (particles per aura frame)
  - `FUSION_PARTICLE_COLOR = 0xffdd44` (golden particle color)

- `src/systems/AudioDirectorSystem.js` -- EXTEND — add:
  - `_prevFusionReadyCount` for edge-detection (the sim calls `this.fusionsReady = true` via a latch when a new fusion becomes ready)
  - `_fusionPickPending` for one-shot fusion-pick event
  - `setFusionsReady(ready)` public latch: when `true`, increments `_pendingFusions` counter for edge detection
  - `setFusionPick()` public latch for edge detection
  - New field in `_sfxOut`: `fusionsReady: boolean`, `fusionPick: boolean`
  - `consumeSfxRequests()` adds these to the output object

  Edge-detection: the sim (ArenaScene update loop) calls `audioDirector.setFusionsReady(true)` once per frame while fusion is ready. The first time it's true (prev was false), a _pendingFusions counter increments. On `consumeSfxRequests()`, `fusionsReady: true` when `_pendingFusions > 0`. This ensures the sting fires exactly once when the condition transitions from not-ready → ready.

- `src/audio/audioEngine.js` -- EXTEND — add:
  - `fusion` entry to `_sfx`: `{ freq: 880, ms: 400, gain: 0.35 }`
  - `playSfx` logic for 'fusion': a **rising 4-tone arpeggio** (ascending major triad
    pattern) — each tone is ~100ms, starting at ~440 Hz and rising in steps: 440 → 554 → 660 → 880 Hz.
    The arpeggio plays as four oscillators with offset start times.
    This is distinctly heroic/fanfare rather than like any existing SFX.

- `src/systems/ParticleSystem.js` -- EXTEND — add:
  - `emitBurst(x, y, count, color, maxSize = PARTICLE_BURST_SIZE, speedMin = PARTICLE_BURST_SPEED_MIN * 0.7, speedMax = PARTICLE_BURST_SPEED_MAX * 0.7, lifeMs = PARTICLE_BURST_LIFETIME_MS * 0.8)` -- a public wrapper that emits particles radially like the kill bursts, with configurable params. Uses the same pool acquisition pattern.

- `src/scenes/ArenaScene.js` -- EXTEND — add:
  - `this.fusionBadge = this.add.text(...)` in `create()`: a small text object positioned
    top-left of the arena, initially invisible. `this.fusionBadge.setScrollFactor(0)` so it
    stays pinned during camera shake/zoom.
  - In `update()`: read `this.fusionSystem.getReadyFusion(...)` to check if fusion is ready.
    Toggle `this.fusionBadge.visible` and update text with the fusion name if ready.
  - In `update()`: read `audioDirector.fusionsReady` via `consumeSfxRequests()` (add to latched fields).
    Trigger `audioEngine.playSfx('fusion')` when `fusionsReady` is true.
  - In `update()`: detect fusion card pick (via `levelUpSystem.currentOffer[0]?.isEpicCard`
    being picked) and set `audioDirector.setFusionPick()` which triggers a second sting.
  - Modify card panel drawing (in `update()` where `cardPanelGraphics` is drawn) to:
    - Detect if slot 0 is an epic card (`offer[0]?.isEpicCard`)
    - Draw golden border, gold gradient fill, and golden particle aura from the card center
  - Emission of particles: each frame while level-up overlay is open AND a fusion card is
    offered, emit FUSION_PARTICLE_COUNT golden particles from the card center (slot 0's
    rect center) using `particleSystem.emitBurst(cardRect.cx, cardRect.cy, ...)`

**Acceptance Criteria:**

AC1 — **HUD ⚡ FUSION READY badge appears on condition satisfaction:**
- Given a fusion condition is satisfied (e.g. orbit-blade Lv5 + overcharge Lv3),
  When the game renders the HUD,
  Then a gold `⚡ FUSION READY` badge text appears at the top-left of the arena,
  And the badge shows the Fusion Epic's name (e.g. "Tesla Circuit").
- Given no fusion condition is satisfied,
  When the game renders the HUD,
  Then the badge is invisible.

AC2 — **Gold Epic card in level-up offer:**
- Given a level-up offer with a fused Epic card in slot 0,
  When the card panels are drawn,
  Then the fusion card has a gold border, a golden-tinted fill, golden title text,
  And the fusion recipe (primary item → Epic name via partner) is displayed beneath the title.
- Given a non-fusion card,
  When it is drawn,
  Then it retains its existing styling (green border, no gold).

AC3 — **Particle aura on gold card:**
- Given a fusion card is offered,
  When the level-up overlay is open,
  Then golden particles continuously emit from the fusion card's area (4 per frame),
  And the particle count respects the global particle cap (NFR2, NFR11).

AC4 — **Audio stings:**
- Given a fusion condition becomes satisfied for the first time,
  When the game renders,
  Then a rising 4-tone arpeggio (fanfare-style) plays exactly once via audioEngine.playSfx('fusion').
- Given the player picks the Epic card,
  When applyCard resolves the fusion,
  Then a second distinct audio sting plays (the "payoff" cue).
- Given the audio is muted,
  When any fusion event fires,
  Then no sound plays (respects volume/mute settings).

## Verification

**Commands:**
- `npm test` -- expected: all 12.1 fusion tests pass + no regressions.
- `npm run build` -- expected: production build succeeds.
- Manual: start a run, build orbit-blade + overcharge to fusion-ready, verify the HUD
  badge appears, go to level-up, verify gold card rendering + particle aura, verify
  audio stings play.

---

## Data Model

### Fusion Badge Text

```
"⚡ FUSION READY"          // when no fusion name available
"⚡ FUSION READY — Tesla Circuit"  // with fusion name
```

### Fusion Recipe Text (card description)

```
"Orbit Blade Lv5 + Overcharge Lv3"  // shown beneath card title
```

---

## Spec Change Log

(empty until first review loopback)

## Review Triage Log

### 2026-07-29 — Planning stage

## Design Notes

### Edge-detection for fusion-ready audio sting mirrors bomb/death pattern

The AudioDirectorSystem uses `_prevShockwaveMs` / `_prevDeathSeq` pattern for bomb/death.
For fusion, we use a simpler approach: the ArenaScene update loop calls
`audioDirector.setFusionsReady(true)` every frame the fusion is ready. AudioDirectorSystem
tracks `_prevFusionReady: boolean` and edge-detects the first frame it becomes true,
setting `_pendingFusions = 1` for that transition. On consumeSfxRequests(), the latch
`fusionsReady: true` is returned once, then reset. Subsequent frames don't trigger
because the edge has been consumed.

If the fusion condition becomes satisfied again (rare scenario: a player un-owns a Lv5
item then re-owns it via some future mechanic), the next edge → new sting.

For the **fusion-pick sting**, the pattern is simpler: the sim (LevelUpSystem or
ArenaScene) calls `audioDirector.setFusionPick()` once when the Epic card is applied.
AudioDirectorSystem edge-detects it and returns `fusionPick: true` on the next consume.

### Particle aura as a continuous effect

The golden particle aura on the fusion card runs every frame while the level-up overlay
is open AND the fusion card is in slot 0. Each frame emits 4 particles from the card
center with a random radial direction and golden color. Particles are pooled and bounded
by the global `PARTICLE_MAX` cap, so this cannot affect performance.

The emission is deliberately subtle — particles should be a shimmering halo, not a
firework. Lower speed range (0.7x of normal burst) and slightly shorter lifetime than
kill bursts.

### Card recipe text

The recipe text shows the fusion formula: "Primary Lv5 + Partner Lv3 → Epic Name".
This is rendered as a small text element below the card title, within the card panel
bounds. The FusionSystem recipe objects already store `primaryItemId`, `partnerItemId`,
and `name`, so the LevelUpSystem can pass this alongside the epic card.

No sim-side changes are needed — the LevelUpSystem already builds the epic card with
all recipe metadata in `_checkAndReserveFusionOfferCard()`. The ArenaScene reads
`offer[0].fusionRecipeId` and looks up the recipe from FusionSystem to display the text.

### Why not add to LevelUpSystem?

LevelUpSystem is the sim-side system that runs in the Phaser-free headless pipeline.
Rendering decisions (gold color, particle emission, text layout) belong in the render
layer (ArenaScene), not the sim. The sim only provides data: the currentOffer array with
isEpicCard flags. ArenaScene reads these flags and decides how to render.

### Audio sting design

The fusion-ready sting uses a 4-tone ascending arpeggio: 440 → 554 → 660 → 880 Hz.
Each tone is ~100ms, overlapping slightly. The overall effect is a heroic "fanfare"
— distinct from the bomb's descending boom, the death's falling tone, and the kill's
bright blip. The fusion-pick sting is slightly different: a faster arpeggio with
higher starting frequency and shorter duration (300ms vs 400ms) to signal the "payoff"
rather than the "anticipation".

## Auto Run Result

**Status:** in-review

**Summary:** Implemented the Fusion UX (Story 12.2 / Epic 12): gold ⚡ FUSION READY HUD badge, gold-styled Epic card with recipe text, particle aura shimmer, and rising arpeggio audio stings for fusion-ready and fusion-pick events.

**Files changed:**
- `src/config/constants.js` — Added fusion UX constants (gold colors, badge font, particle params, AUDIO_SFX_FUSION_*)
- `src/audio/audioEngine.js` — Added 'fusion' SFX: rising 4-tone arpeggio (440→554→660→880 Hz, 400ms)
- `src/systems/AudioDirectorSystem.js` — Extended: `setFusionsReady()`, `setFusionPick()` latches with edge-detection, new `fusionsReady`/`fusionPick` fields in `consumeSfxRequests()` output
- `src/systems/ParticleSystem.js` — Added public `emitBurst(x, y, count, color, maxSize, speedMin, speedMax, lifeMs)` method
- `src/scenes/ArenaScene.js` — Extended: fusion badge text object (top-left HUD), gold styling for fusion Epic card (slot 0), recipe description text beneath card title, golden particle aura emission (4/frame bounded by cap), audio sting triggers on fusion-ready detection and fusion card pick

**Verification:** `npm test` → 2148 tests pass (79 files, 0 failures). `npm run build` → production build succeeds (112 modules). New tests: 6 audio-director fusion audio tests + 3 particle-system emitBurst tests.

**Review findings:** none yet — awaiting review pass.

## Spec Change Log

### 2026-07-29 — Implementation (Step 03)
- Added 40 lines across 5 files (constants, audio engine, audio director, particle system, arena scene)
- Added 9 new tests across 2 test files
- No sim-side changes (FusionSystem, LevelUpSystem untouched)
- All rendering/UI in ArenaScene as planned
