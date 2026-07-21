---
title: 'Mobile Performance Profile'
type: 'feature'
created: '2026-07-21'
status: 'done'
baseline_revision: '99f7ae52d8c9e16de7bd8fdc7a5e18d10a7db08e'
final_revision: '699eec2'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The game now runs inside the Capacitor WebView (Story 7.3), but the bloom/grid/particle stack is tuned for a desktop GPU: `PARTICLE_MAX=2000`, a 4-step camera bloom fill pass, and a 48px grid. Nothing detects it is running on a phone, so a mid-range mobile GPU under peak load (max enemies + thousands of particles + bombs + bloom + grid warp) risks sustained hitching (NFR9, NFR1).

**Approach:** Add a Phaser-free quality-profile seam that (1) detects mobile / the Capacitor WebView at init behind an injectable, fail-safe browser boundary, and (2) resolves a frozen quality profile that scales the particle cap, the bloom cost (blur/strength/steps), and the grid resolution (line spacing) down from the desktop defaults — all sourced from NEW mobile constants in the existing centralized `constants.js`. The profile is resolved ONCE in `ArenaScene.create()` and threaded into the three existing consumption seams (each gaining an optional param that defaults to the desktop constant, so desktop is byte-identical). No per-frame path is touched; no gameplay/sim/feel changes.

## Boundaries & Constraints

**Always:**
- The new mobile-scaled values live as `MOBILE_*` constants in `src/config/constants.js` (documented placeholders, "tuned post-launch", mirroring the existing NEON_BLOOM_*/GRID_*/PARTICLE_* discipline — no inline magic numbers). Each mobile value MUST be strictly less costly than its desktop counterpart (smaller particle cap, fewer bloom steps + lower blur/strength, larger/coarser grid spacing).
- The profile is resolved exactly once per `create()` (device-derived, not per frame) and introduces ZERO new per-frame allocation (NFR2). The profile object is frozen.
- Detection is a PURE predicate over an injected env shape plus a separate injectable browser boundary (`window`), fail-safe like `mobileLayout.lockLandscape`/`readSafeAreaInsetsCss`: any missing global or throw degrades to the DESKTOP profile (never crashes create). The pure module imports NO Phaser and NO `@capacitor/*` package — it reads the runtime-injected `window.Capacitor` global through the boundary only.
- The DESKTOP branch (`resolveQualityProfile(false)`) returns values byte-identical to today's `PARTICLE_MAX` / `NEON_BLOOM` / `GRID_SPACING`, so non-mobile play is a zero regression.
- The profile composes with — never replaces — Reduced Motion: `ArenaScene` keeps reading `settings.reducedMotion` once at create and still suppresses grid warp / flash / shake independently. Settings persistence through `settingsStorage` stays unchanged and best-effort.
- Each consumption seam gains an OPTIONAL param defaulting to the desktop constant: `ParticleSystem(collisionSystem, ship, inputState, rng, maxParticles = PARTICLE_MAX)`, `addNeonBloom(camera, bloomConfig = NEON_BLOOM)`, `buildGridUniforms(gridSpacing = GRID_SPACING)`, and `buildArenaWorld({ rng, highScoreStorage, particleMax })`.

**Block If:**
- (none anticipated — additive, orthogonal scaling over an already-shipping build; no ambiguous decision needs a human. The device-GPU framerate measurement is a documented manual boundary, not a block.)

**Never:**
- Do NOT add a user-facing "graphics quality" toggle/UI or persist the mobile profile as a setting — it is auto-derived from device detection each session (deterministic), distinct from the persisted Reduced-Motion/audio settings it composes with.
- Do NOT mutate/reassign the existing `const` exports, change `Pool` semantics, alter any pool prewarm, or touch gameplay, spawning, scoring, movement, firing, audio, or the fixed-step sim. This is presentation-cost tuning + detection only.
- Do NOT claim the on-device framerate is verified here, and do NOT fabricate device/emulator FPS numbers — this Linux host has no phone GPU/WebView.
- Do NOT change the desktop-observable output (particle count, bloom look, grid density) in any way.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Capacitor native | env `{ capacitorNative: true }` | `detectMobile` → `true` | — |
| Touch phone | env `{ coarsePointer: true, maxTouchPoints: 5, userAgent: '…Android…' }` | `detectMobile` → `true` | — |
| Desktop | env `{ coarsePointer: false, maxTouchPoints: 0, userAgent: '…X11…' }` | `detectMobile` → `false` | — |
| Boundary throws | `readMobileEnv(win)` where `win.matchMedia`/`navigator` throw or are absent | returns a desktop-shaped env → `detectMobile` → `false` | Never throws |
| Mobile profile | `resolveQualityProfile(true)` | `particleMax < PARTICLE_MAX`, `bloom.steps < NEON_BLOOM.steps` (and blur/strength ≤), `gridSpacing > GRID_SPACING`; frozen | — |
| Desktop profile | `resolveQualityProfile(false)` | `particleMax === PARTICLE_MAX`, `bloom` deep-equals `NEON_BLOOM`, `gridSpacing === GRID_SPACING` | — |
| Grid spacing inject | `buildGridUniforms(72)` | `uGridSpacing.value === 72`; `buildGridUniforms()` → `GRID_SPACING` | — |
| Bloom inject | `addNeonBloom(camera, mobileBloom)` | forwards `mobileBloom` fields positionally to `camera.postFX.addBloom`; default forwards `NEON_BLOOM` | — |
| Particle cap inject | `new ParticleSystem(cs, ship, input, rng, 300)` under sustained emission | live particles never exceed 300; omitting the arg caps at `PARTICLE_MAX` | — |
| World cap thread | `buildArenaWorld({ particleMax: 300 })` | `particleSystem.maxParticles === 300`; omitted → `PARTICLE_MAX` | — |

</intent-contract>

## Code Map

- `src/config/qualityProfile.js` -- NEW pure, Phaser-free seam: `detectMobile(env)` predicate, `readMobileEnv(win)` guarded browser boundary (reads `window.Capacitor?.isNativePlatform?.()`, `matchMedia('(pointer: coarse)')`, `navigator.maxTouchPoints`, `navigator.userAgent`), and `resolveQualityProfile(mobile)` → frozen `{ particleMax, bloom, gridSpacing }`.
- `src/config/constants.js` -- add a "Mobile performance profile (Story 7.4)" block: `MOBILE_PARTICLE_MAX`, `MOBILE_NEON_BLOOM_BLUR_STRENGTH`, `MOBILE_NEON_BLOOM_STRENGTH`, `MOBILE_NEON_BLOOM_STEPS`, `MOBILE_GRID_SPACING` (documented placeholders).
- `src/systems/ParticleSystem.js` -- constructor gains `maxParticles = PARTICLE_MAX`; the two `PARTICLE_MAX` cap reads (~L137, ~L175) become `this.maxParticles`.
- `src/scenes/neonStyle.js` -- `addNeonBloom(camera, bloomConfig = NEON_BLOOM)`; forward `bloomConfig` fields positionally.
- `src/scenes/gridField.js` -- `buildGridUniforms(gridSpacing = GRID_SPACING)`; `uGridSpacing.value` uses the param.
- `src/scenes/buildArenaWorld.js` -- accept `particleMax` in the options bag; thread it into `new ParticleSystem(...)`.
- `src/scenes/ArenaScene.js` -- resolve `this._qualityProfile = resolveQualityProfile(detectMobile(readMobileEnv(window)))` at the top of `create()` (before the grid shader at ~L122); pass `profile.gridSpacing` to `buildGridUniforms`, `{ particleMax: profile.particleMax }` to `buildArenaWorld`, and `profile.bloom` to `addNeonBloom` (~L368).
- `src/config/qualityProfile.test.js` -- NEW: cover every I/O-matrix detection + profile row.
- `src/systems/particleSystem.test.js`, `src/scenes/neonStyle.test.js`, `src/scenes/gridField.test.js`, `src/scenes/buildArenaWorld.test.js` -- extend for the injected-param rows + default-equals-desktop regression.

## Tasks & Acceptance

**Execution:**
- `src/config/constants.js` -- add the five `MOBILE_*` constants with doc comments (each strictly cheaper than its desktop pair).
- `src/config/qualityProfile.js` -- implement `detectMobile`, `readMobileEnv`, `resolveQualityProfile` per the Code Map; freeze the returned profile and its `bloom`; desktop branch returns the desktop constants verbatim.
- `src/systems/ParticleSystem.js` -- add the `maxParticles` param + field; swap both cap reads to `this.maxParticles`.
- `src/scenes/neonStyle.js` -- add the `bloomConfig` param to `addNeonBloom`; forward its fields positionally.
- `src/scenes/gridField.js` -- add the `gridSpacing` param to `buildGridUniforms`; use it for `uGridSpacing`.
- `src/scenes/buildArenaWorld.js` -- thread `particleMax` from the options bag into `ParticleSystem`.
- `src/scenes/ArenaScene.js` -- resolve the profile once at create() and wire it into the three seams.
- `src/config/qualityProfile.test.js` (+ extend the four existing suites) -- unit-test every I/O-matrix row, incl. every default-equals-desktop regression.

**Acceptance Criteria:**
- Given the quality-profile seam, when `resolveQualityProfile(true)` is called, then it returns a frozen profile whose `particleMax` is below `PARTICLE_MAX`, whose `bloom.steps` is below `NEON_BLOOM.steps` (blur/strength no higher), and whose `gridSpacing` exceeds `GRID_SPACING` — all sourced from the `MOBILE_*` constants (NFR9).
- Given a non-mobile env, when the profile is resolved, then it deep-equals the desktop `PARTICLE_MAX` / `NEON_BLOOM` / `GRID_SPACING` (zero desktop regression).
- Given `detectMobile`, when fed a Capacitor-native env, a coarse-pointer+touch+mobile-UA env, and a desktop env, then it returns `true`, `true`, `false` respectively; and `readMobileEnv` never throws when its host globals are absent or throwing (degrades to desktop).
- Given the three seams, when `buildGridUniforms(s)`, `addNeonBloom(cam, cfg)`, and `new ParticleSystem(…, cap)` receive an injected value, then `uGridSpacing` equals `s`, `addBloom` is called with `cfg`'s fields positionally, and live particles never exceed `cap`; and each with its arg omitted reproduces today's desktop constant exactly (no per-frame allocation added — the ParticleSystem steady-state no-growth invariant holds under a mobile cap).
- Given `buildArenaWorld({ particleMax })`, when constructed, then `particleSystem.maxParticles` equals the passed cap, and defaults to `PARTICLE_MAX` when omitted.
- Given `npx vitest run` and `npm run build`, when they execute, then the full existing suite plus the new/extended tests pass and the production build succeeds.
- Given a mid-range phone GPU inside the Capacitor WebView under peak load (max enemies, particles, bombs, bloom, grid warp), when a run is played, then the mobile profile is active and the game holds the 60 FPS NFR1 target without sustained hitching, and Reduced-Motion / audio settings still apply and persist across sessions. **[Manual — not verifiable on this Linux host (no phone GPU/WebView); the automated gates above prove detection, the scaled profile, and the zero-allocation wiring, this AC proves the on-device framerate — same manual boundary as Story 7.3's device build and Story 5.5's NFR1.]**

## Spec Change Log

<!-- Append-only. Empty — no bad_spec loopback occurred. -->

## Review Triage Log

### 2026-07-21 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 2
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` `src/config/qualityProfile.js` — `readMobileEnv`'s single try/catch discarded a confirmed `capacitorNative:true` if `matchMedia`/`navigator` threw afterward, downgrading a real Capacitor-native device (the epic's shipped target) to the heavy desktop profile. Split into two guards: native is resolved first and preserved even when the later coarse/touch/UA reads throw (they fall back to desktop-safe values). Added a test — native + throwing `matchMedia` → `capacitorNative:true`, `detectMobile`→true. All three code reviewers flagged the over-broad catch; the native-preserving fix also closes the untested native+throw path.
  - `[low]` `[patch]` `src/scenes/ArenaScene.js` — `create()` referenced the bare `window` global, which would `ReferenceError` in a window-less host BEFORE `readMobileEnv`'s null-guard could run, contradicting the never-crashes contract. Now `readMobileEnv(typeof window !== 'undefined' ? window : null)`.
  - `[low]` `[patch]` `src/systems/ParticleSystem.js` — the `maxParticles = PARTICLE_MAX` default only guarded `undefined`; an injected `0` suppressed all emission and `NaN`/negative never capped. Validated with `Number.isFinite(maxParticles) && maxParticles > 0 ? maxParticles : PARTICLE_MAX`, mirroring the file's existing `step > 0` placeholder guard and `buildArenaWorld`'s rng coercion; test covers the `0`/`NaN`/negative fallback.
  - `[low]` `[patch]` `src/scenes/gridField.js` — the `gridSpacing` param's default only guarded `undefined`; a `0`/negative would NaN the shader's spacing `mod` math. Guarded to a finite-positive value before packing `uGridSpacing`; test covers the fallback.
  - `[low]` `[patch]` `src/config/qualityProfile.test.js` — the mobile bloom test asserted only `<=` for blur/strength while the constants block documents a STRICTLY-less-costly invariant; tightened to `toBeLessThan` (current 0.8/0.9 vs desktop 1.2 pass), so a future edit neutralizing the bloom savings now fails.
- deferred (see `deferred-work.md`): (1) web-build iPad/desktop-UA mobile misdetection — the packaged Capacitor app is unaffected (native short-circuit); only the browser build on Mac-UA touch devices misses the profile; a Mac-UA + `maxTouchPoints>1` heuristic is the candidate refinement. (2) TitleScene/SettingsScene still register desktop bloom on mobile — the profile is arena-scoped by intent, so menu adoption is an open scope question.
- rejected (summary): ArenaScene composition integration harness for the three-seam field-threading (the standing manual-verification boundary — a live-Phaser scene-render surface deferred 15+ times as orchestrator-owned per Story 5.5's explicit "do NOT build an ArenaScene/World integration harness"; the field-threading was verified correct by diff inspection this pass, and `particleMax` already routes through the assertable `buildArenaWorld` factory); NFR9/60-FPS "unmeasured placeholder" (the disclosed manual device boundary — the spec anchors the framerate AC at the true device surface and marks it manual, exactly like Story 7.3's device build and 5.5's NFR1; it does not claim verification); no runtime FPS fallback / no user-facing quality toggle (out of scope on the intent's AC1 static-profile reading and the spec's explicit Never — the intent-alignment auditor confirmed the diff implements the defensible static-profile reading); grid-spacing lever yields negligible GPU savings (the intent names "grid resolution" as one of the three knobs — implementing it faithfully via a coarser uniform is correct; its magnitude is on-device tuning of a documented placeholder); config→scenes import of `NEON_BLOOM` (works today and neonStyle is contractually Phaser-free — importing "Phaser NOTHING" is its documented invariant — and the byte-identical frozen-object reuse for the desktop branch is a deliberate benefit); strict-boolean `capacitorNative === true` short-circuit (`readMobileEnv` normalizes the flag to a real boolean before `detectMobile` ever sees it; the pure predicate's contract is fed normalized envs).

### 2026-07-21 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 13
- addressed_findings:
  - none
- notes: Follow-up review pass on the already-`done`, already-committed story (re-review triggered by the orchestrator). Four layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran over the committed diff since `99f7ae5`. No code changed; `npx vitest run` green (897 tests). Every finding re-confirmed the prior pass's triage:
    - already-deferred, not re-deferred (would duplicate an existing ledger entry, which the orchestrator owns): (a) web-build iPad/desktop-UA mobile misdetection — already logged in `deferred-work.md` (native short-circuits correctly; only the browser build on Mac-UA touch devices misses the profile); (b) TitleScene/SettingsScene desktop bloom on mobile — already logged (profile is arena-scoped by intent).
    - rejected as out-of-scope by intent authority: NFR9/60-FPS "unverified" (intent marks the framerate AC Manual and forbids claiming device verification — the spec claims none); no user-facing quality toggle / no adaptive runtime downgrade (intent `Never`: do NOT add a graphics-quality toggle/UI); Capacitor→mobile short-circuit "assumes weak GPU" (this is the intent's explicit I/O row `capacitorNative:true → true`); ArenaScene create() composition integration harness (the standing orchestrator-owned live-Phaser boundary, rejected 15+ stories and by the prior pass — `particleMax` already routes through the assertable `buildArenaWorld` factory).
    - rejected as speculative / preference / comment-nuance (no current-behavior defect): mobile-bloom `{...NEON_BLOOM}` spread admitting a hypothetical future cost field (current override is correct; keys-equal + strictly-less tests pin today's shape); `maxParticles` 0/NaN/neg fallback to `PARTICLE_MAX` "wrong direction" (only reachable via a misconfigured constant — impossible with the shipped 800 — and `PARTICLE_MAX` is the intent's documented default); silent coercion lacking a dev `console.warn`; grid-cost comment wording; MOBILE_* ratio derivation (documented post-launch placeholders); desktop-branch shared frozen `NEON_BLOOM` reference (deliberate byte-identical reuse per Design Notes).

## Design Notes

- **Why a resolve-once profile, not mutable constants.** The tunables are `const` module exports imported directly by systems; they cannot be reassigned. Instead each consumption seam already funnels through one function (`addNeonBloom`, `buildGridUniforms`) or constructor (`ParticleSystem`); giving each an optional param that defaults to the desktop const lets `ArenaScene.create()` inject the scaled value with zero desktop regression and zero per-frame cost. This mirrors the existing optional-injection pattern in `buildArenaWorld` (`rng`, `highScoreStorage`).
- **Why detection is split pure-predicate + boundary.** `detectMobile(env)` is pure and exhaustively unit-testable; `readMobileEnv(window)` is the thin guarded boundary (try/catch → desktop-shaped env on any throw), exactly like `mobileLayout.readSafeAreaInsetsCss`/`lockLandscape`. The pure module stays `@capacitor/*`-free and reads the runtime-injected `window.Capacitor` global, so it runs headlessly in the node vitest env.
- **Why grid "resolution" = line spacing.** The grid is one full-arena fragment quad; a coarser `GRID_SPACING` draws fewer neon lines (less smoothstep fill) without touching the shader's compiled `GRID_MAX_RIPPLES` `#define` — the low-risk, honest "resolution down" knob. Bloom `steps` is the load-bearing GPU win (a screen-space fill pass); halving it roughly halves that cost.
- **Why the framerate AC is manual.** A phone-GPU/WebView measurement cannot run on this Linux host. The automatable proxy is: detection + scaled profile (unit-tested) and resolve-once wiring (no per-frame allocation, reinforced by the existing steady-state pool no-growth test now exercised under a mobile cap). Anchoring the device AC at a headless proxy would be dishonest — kept at the true surface, marked manual, per the Story 7.2/7.3/5.5 precedent.

## Verification

**Commands:**
- `npx vitest run` -- expected: full suite green incl. the new `qualityProfile` suite and the extended particle/neon/grid/buildArenaWorld suites; no regression in the existing ~860 tests.
- `npm run build` -- expected: production Vite build succeeds and `dist` is produced.

**Manual checks (cannot run on this Linux host):**
- On a mid-range Android/iOS device via the Story 7.3 native build: play a peak-load late run inside the WebView; confirm smooth framerate (no sustained hitching), the reduced particle/grid/bloom density is active, and Reduced-Motion / volume settings still apply and persist across app restarts.

## Auto Run Result

Status: done

**Summary.** Follow-up review pass (dev-auto re-review of an already-`done`, already-committed story). No code changed this pass. A Phaser-free quality-profile seam (Story 7.4) detects mobile / the Capacitor WebView at `ArenaScene.create()` and threads a frozen `{ particleMax, bloom, gridSpacing }` profile — sourced from new `MOBILE_*` constants — into the three existing consumption seams (each defaulting to its desktop constant, so desktop is byte-identical). This pass re-reviewed that committed change across four layers and confirmed the prior triage stands.

**Files changed (this pass).** Only the spec's review record:
- `spec-7-4-mobile-performance-profile.md` — appended the follow-up triage-log entry, set `status: done`, `followup_review_recommended: false`, `final_revision: 699eec2`.

(The story's code — `src/config/constants.js`, `src/config/qualityProfile.js` + test, `src/systems/ParticleSystem.js` + test, `src/scenes/neonStyle.js` + test, `src/scenes/gridField.js` + test, `src/scenes/buildArenaWorld.js` + test, `src/scenes/ArenaScene.js` — was implemented and committed by the prior run; unchanged here.)

**Review findings breakdown.** 4 layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) over the committed diff since `99f7ae5`. 13 distinct findings after dedup:
- patches applied: 0
- deferred: 0 new (the 2 genuinely-real gaps — iPad/desktop-UA web-build misdetection, and menu-scene desktop bloom on mobile — are already in `deferred-work.md` from the prior pass; re-deferring would duplicate orchestrator-owned entries)
- rejected: 13 (out-of-scope by intent authority: framerate/NFR9 is a disclosed Manual AC, user-facing quality toggle is an explicit `Never`, Capacitor→mobile is the specified I/O row, create() integration harness is the standing orchestrator-owned Phaser boundary; plus speculative/preference items — future bloom-field spread, fallback direction, coercion warning, comment wording, placeholder ratios, shared frozen-bloom reuse)

**Follow-up review recommendation:** `false`. This pass's patched findings: high 0, medium 0, low 0. Score = 3×0 + 1×0 = 0 (< 5), no high patch → false.

**Verification performed.** `npx vitest run` → 54 files, 897 tests, all passing (incl. the `qualityProfile` suite and the extended particle/neon/grid/buildArenaWorld suites). No code was modified this pass, so this confirms the committed state is green. `npm run build` not re-run this pass (no source changed; the build-artifact test `buildArtifact.test.js` passed within the suite). Device-framerate AC remains Manual (no phone GPU/WebView on this Linux host) — not claimed verified.

**Residual risks.**
- Device framerate (NFR9/NFR1) is unverified on this host by design — the `MOBILE_*` values are documented post-launch placeholders; on-device tuning is required.
- Two known, ledger-tracked gaps remain open (orchestrator-owned): web-build iPad/desktop-UA misdetection (native app unaffected) and menu-scene bloom not scaled on mobile.
- Residual artifact (left in place, not part of this change): `_bmad-output/implementation-artifacts/sprint-status.yaml` is modified in the working tree (orchestrator-owned, pre-existing before this session).

