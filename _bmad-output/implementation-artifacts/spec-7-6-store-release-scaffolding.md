---
title: 'Store Release Scaffolding'
type: 'feature'
created: '2026-07-21'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: 'd54228488bd78d4b5e1c8826ba33f77b6a73b740'
final_revision: 'f5cf236481e80ee14bb39d235b250e2716ed4d2d'
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The native iOS/Android shells (Stories 7.3–7.5) still ship the default **Capacitor placeholder** launcher icons and splash screens, the Android activity has no landscape lock in its manifest, iOS still advertises Portrait as a supported orientation, and there is no signing/build configuration or store-submission documentation. Angle Wars therefore cannot be submitted to the App Store or Google Play as itself (NFR10).

**Approach:** Add a committed brand source (`resources/icon.svg`, an emblem-only neon mark) and a deterministic ImageMagick-based generator (`scripts/gen-mobile-assets.sh`, wired as `npm run assets:mobile`) that rasterizes it into every required iOS + Android icon/splash density, replacing the placeholders with branded, correctly-sized, correctly-alpha'd assets. Set the store manifests correctly (Android `screenOrientation` landscape lock + minimal permission set; iOS landscape-only orientations; display name / bundle id already correct — pinned by tests). Scaffold a real, gracefully-degrading Android release `signingConfig` (reads a gitignored `keystore.properties`, unsigned when absent so CI/dev builds still work) plus a committed `keystore.properties.example` and `ios/ExportOptions.plist.example`, and document the full store-release/signing flow in `docs/mobile-build.md`. Everything here is config, committed assets, and docs — no gameplay/`src/` runtime change.

## Boundaries & Constraints

**Always:**
- **One brand source, generated fan-out.** `resources/icon.svg` is the single source of truth; `scripts/gen-mobile-assets.sh` derives every native asset from it via `convert`. Re-running the script is idempotent and reproduces the committed assets. The script hard-codes the Capacitor density table (dimensions below) so output dims are exact, not inferred.
- **Correct alpha & depth per target.** The iOS `AppIcon-512@2x.png` (1024×1024) and every opaque icon/splash are flattened onto the brand background with alpha stripped (App Store rejects icons with an alpha channel). The Android adaptive **foreground** layer (`ic_launcher_foreground.png`) keeps its alpha (transparent around the emblem). All PNGs are 8-bit.
- **Android density set** (`android/app/src/main/res/`): `ic_launcher.png` + `ic_launcher_round.png` at mdpi 48, hdpi 72, xhdpi 96, xxhdpi 144, xxxhdpi 192; `ic_launcher_foreground.png` at mdpi 108, hdpi 162, xhdpi 216, xxhdpi 324, xxxhdpi 432; `splash.png` in `drawable/` (480×320) and each `drawable-land-*` (mdpi 480×320, hdpi 800×480, xhdpi 1280×720, xxhdpi 1600×960, xxxhdpi 1920×1280) + `drawable-port-*` (mdpi 320×480, hdpi 480×800, xhdpi 720×1280, xxhdpi 960×1600, xxxhdpi 1280×1920). These are exactly the paths/dims already present — every existing placeholder is overwritten, none added or orphaned.
- **iOS asset set:** overwrite `AppIcon-512@2x.png` (single universal 1024, Xcode derives the rest) and the three `Splash.imageset/splash-2732x2732*.png` (2732×2732). `Contents.json` is left structurally intact.
- **Landscape lock in the manifests.** Add `android:screenOrientation="sensorLandscape"` to `MainActivity`. In iOS `Info.plist` restrict the iPhone `UISupportedInterfaceOrientations` array to `LandscapeLeft` + `LandscapeRight` only (drop Portrait). Consistent with the Story 7.2 JS landscape lock — the manifests must not contradict it.
- **Minimal, correct identity.** Display name "Angle Wars" and app/bundle id `com.wrenbjor.anglewars` are already set on both platforms and stay pinned by tests. Android permissions stay exactly `{INTERNET}` (no IAP/ads → no extra permissions); tests assert the exact set so a stray permission fails.
- **Signing is a scaffold, not secrets.** Android `build.gradle` gains a `release` `signingConfig` that loads `rootProject.file("keystore.properties")` only when it exists and applies `signingConfig signingConfigs.release` to `buildTypes.release` only then — absent the file the release build is simply unsigned (dev/CI stay green). Commit `android/keystore.properties.example` and `ios/ExportOptions.plist.example`; never commit a real keystore/`.jks`/`keystore.properties`.

**Block If:**
- (none anticipated — additive store scaffolding over the shipped native shell. The one interpretive choice, "icons/splash exist across densities" ⇒ *branded* assets not the shipped Capacitor placeholders, is resolved from the epic goal ("app icons and splash screens ... for Angle Wars") in Design Notes, not left open. Real on-device signing, `gradlew bundleRelease`/`xcodebuild archive`, and visual branding QA are a documented manual boundary, not a block.)

**Never:**
- Do NOT change gameplay, `src/` runtime code, `capacitor.config.json`, the sim/scoring/input, or the synced web bundle. This story is icons, manifests, signing scaffold, and docs only.
- Do NOT commit any real keystore, `*.jks`/`*.keystore`, `keystore.properties`, provisioning profile, or `.p12`. Only `*.example` templates are committed.
- Do NOT add IAP/ads SDKs, permissions, or config (explicit epic non-goal).
- Do NOT claim a real signed store artifact, on-device install, or visual branding review was produced here — this Linux host has no Android SDK / JDK 21 / macOS+Xcode / device. Do not fabricate device or submission results.
- Do NOT introduce a runtime dependency on ImageMagick — it is a build-time generator tool only; the generated PNGs are committed so no consumer needs `convert`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generate assets | `npm run assets:mobile` with `resources/icon.svg` present | every Android + iOS icon/splash path written at its exact density; re-run reproduces identical dims | missing `convert` → script exits non-zero with a clear message |
| iOS app icon alpha | inspect `AppIcon-512@2x.png` | 1024×1024, 8-bit, **no alpha channel** (PNG color type ≠ 6) | — |
| Adaptive foreground alpha | inspect `ic_launcher_foreground.png` (any density) | correct density dims, **has alpha** (color type 6) | — |
| Android orientation | parse `AndroidManifest.xml` | `MainActivity` has `android:screenOrientation="sensorLandscape"` | — |
| iOS orientation | parse `Info.plist` iPhone `UISupportedInterfaceOrientations` | contains both Landscape values, does NOT contain Portrait | — |
| Android permissions | parse `AndroidManifest.xml` `uses-permission` | exactly `{android.permission.INTERNET}` | any extra/removed permission fails |
| Signing present | `keystore.properties` exists at android root | `signingConfigs.release` populated + applied to `buildTypes.release` | — |
| Signing absent | `keystore.properties` missing | release build configured but unsigned; no Gradle error | file-exists guard skips the block |
| Secrets ignored | `git check-ignore` on `keystore.properties` / `*.jks` | ignored | — |

</intent-contract>

## Code Map

- `resources/icon.svg` -- NEW committed brand source: emblem-only neon angular mark (cyan primary + magenta accent) on near-black `#05060a`. Pure geometry (polygons/strokes) so ImageMagick's internal SVG renderer rasterizes it without an rsvg/inkscape delegate. Single source of truth for all icons + splash.
- `scripts/gen-mobile-assets.sh` -- NEW generator: rasterizes `resources/icon.svg` with `convert`, applies a blur+composite neon glow, and emits every path in the Android + iOS density tables (opaque/flatten for icons+splash, alpha-preserving for the adaptive foreground, `-depth 8` throughout). Fails fast if `convert` is absent. Overwrites the committed placeholders in place.
- `package.json` -- add `"assets:mobile": "bash scripts/gen-mobile-assets.sh"` to `scripts`.
- `android/app/src/main/AndroidManifest.xml` -- add `android:screenOrientation="sensorLandscape"` to the `MainActivity` `<activity>`; permission set unchanged (`INTERNET` only).
- `android/app/build.gradle` -- load `rootProject.file("keystore.properties")`; add `signingConfigs.release` (populated only when the file exists) and apply it to `buildTypes.release` under the same guard.
- `android/keystore.properties.example` -- NEW committed template (`storeFile`/`storePassword`/`keyAlias`/`keyPassword` with placeholder values).
- `android/.gitignore` -- uncomment the `*.jks`/`*.keystore` lines and add `keystore.properties` so real signing secrets are never committed.
- `ios/App/App/Info.plist` -- restrict the iPhone `UISupportedInterfaceOrientations` array to `LandscapeLeft` + `LandscapeRight` (remove Portrait). Display name unchanged.
- `ios/ExportOptions.plist.example` -- NEW committed template for `xcodebuild -exportArchive` (app-store method, manual-vs-automatic signing keys documented inline).
- `android/app/src/main/res/**`, `ios/App/App/Assets.xcassets/**` -- regenerated branded PNGs (output of the generator; committed).
- `docs/mobile-build.md` -- add a "Store release" section: asset regeneration (`npm run assets:mobile`), versioning (`versionCode`/`versionName`, `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`), Android keystore creation + `keystore.properties` + `./gradlew bundleRelease` (AAB), and iOS archive/export via Xcode / `xcodebuild` + `ExportOptions.plist`.
- `src/build/storeRelease.test.js` -- NEW headless test (mirrors `capacitorConfig.test.js`): parses PNG IHDR bytes to assert every icon/splash density + dims + alpha rule; asserts manifest orientation + exact permission set; iOS landscape-only orientations; the signing scaffold + gitignore + `.example` templates; the generator script + `assets:mobile` script + `resources/icon.svg` presence; and the docs store-release section. No image/native dep.

## Tasks & Acceptance

**Execution:**
- `resources/icon.svg` -- author the emblem-only neon brand mark (IM-renderable geometry only).
- `scripts/gen-mobile-assets.sh` -- implement the density-table generator (glow, per-target alpha/flatten, `-depth 8`, `convert`-absent guard). Run it and commit the regenerated branded PNGs.
- `package.json` -- add the `assets:mobile` script.
- `android/app/src/main/AndroidManifest.xml` -- add the `sensorLandscape` orientation lock.
- `android/app/build.gradle` -- add the guarded release `signingConfig`.
- `android/keystore.properties.example` + `android/.gitignore` -- add the template; ignore the real secrets.
- `ios/App/App/Info.plist` -- landscape-only iPhone orientations.
- `ios/ExportOptions.plist.example` -- add the export template.
- `docs/mobile-build.md` -- add the "Store release" section.
- `src/build/storeRelease.test.js` -- cover every I/O-matrix row and the manifest/signing/docs pins.

**Acceptance Criteria:**
- Given `resources/icon.svg` and `npm run assets:mobile`, when the generator runs, then every Android icon (`ic_launcher`/`ic_launcher_round`/`ic_launcher_foreground` across mdpi–xxxhdpi) and splash (`drawable` + all `land`/`port` densities) and every iOS icon/splash file is written at its exact required dimension, the iOS app icon has no alpha channel and the adaptive foreground does, and re-running reproduces the same dimensions. (NFR10)
- Given the store manifests, when they are read, then Android `MainActivity` is `screenOrientation="sensorLandscape"` with exactly the `INTERNET` permission, iOS iPhone orientations are landscape-only (no Portrait), and display name "Angle Wars" + id `com.wrenbjor.anglewars` are set on both platforms. (NFR10)
- Given a `keystore.properties` at the Android root, when a release build runs, then it is signed via `signingConfigs.release`; given the file is absent, then the release build is configured but unsigned and Gradle does not error; and `keystore.properties`/`*.jks`/`*.keystore` are gitignored while `keystore.properties.example` + `ios/ExportOptions.plist.example` are committed. (NFR10)
- Given `docs/mobile-build.md`, when read, then it documents branded-asset regeneration, version bumping, Android keystore + AAB signing, and iOS archive/export — sufficient to produce a store-uploadable artifact on a properly equipped machine. (NFR10)
- Given `npx vitest run` and `npm run build`, when they execute, then the full existing suite plus `storeRelease.test.js` pass and the production build still succeeds (no `src/` runtime change).
- Given a properly equipped machine (Android SDK/JDK 21; macOS/Xcode + signing identity) and the documented flow, when a release build is produced, then it yields a store-uploadable signed AAB / `.ipa` and the branding renders correctly on device. **[Manual — not verifiable on this Linux host (no SDK/JDK 21/macOS/Xcode/device); the automated gates above prove the asset dimensions/alpha, manifest correctness, the signing scaffold, and the docs — same manual boundary as Stories 7.3–7.5.]**

## Spec Change Log

<!-- Append-only. Empty — no bad_spec loopback occurred. -->

## Review Triage Log

### 2026-07-21 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 1
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` `ios/App/App/Info.plist` — the iPhone orientation array was landscape-locked but `UISupportedInterfaceOrientations~ipad` still listed Portrait + PortraitUpsideDown, so on iPad the landscape-only game would launch/rotate into portrait (an App Store reject). Reduced the `~ipad` array to LandscapeLeft/Right only and extended `storeRelease.test.js` to pin it. (adversarial + edge-case)
  - `[medium]` `[patch]` `android/app/build.gradle` — the release-signing guard was `keystorePropertiesFile.exists()` only, so a `keystore.properties` present but missing a key fed `file(null)` into `signingConfigs.release` and broke **all** builds (incl. debug) at Gradle configuration time. Added `def hasKeystore = exists() && all four keys present` and guarded both the `signingConfigs.release` population and the `buildTypes.release.signingConfig` wiring on it; tightened the test to assert the guard **inside** the `signingConfigs.release` body (the prior buildTypes-only regex left the inner guard unverified). (edge-case + verification-gap)
  - `[medium]` `[patch]` `src/build/storeRelease.test.js` — every PNG assertion checked only IHDR geometry, so deleting the `<polyline>` emblems from `resources/icon.svg` → solid `#05060a` squares would ship blank assets with all tests green (gutting the story's "branded, not placeholder" deliverable). Added headless byte-size content floors on a representative asset of each type at its largest density (branded assets are 1–2 orders of magnitude larger than a solid fill: e.g. iOS icon 82 KB vs 415 B blank), catching the emblem-deletion mutation. (verification-gap + adversarial)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the `ic_launcher_background.xml` change (#FFFFFF → #05060A, the layer the transparent adaptive foreground composites over) was verified by nothing; reverting it → dark emblem on a white field on Android 8+ with tests still green. Added a color assertion on that file. (verification-gap)
  - `[low]` `[patch]` `ios/App/App/Info.plist` — `UIRequiredDeviceCapabilities` still listed the 32-bit `armv7` (stale Capacitor-template default; App Store builds are 64-bit). Changed to `arm64` and pinned it in the test. (adversarial)
  - `[low]` `[patch]` `scripts/gen-mobile-assets.sh` — `gen_icon`/`gen_fg`/`gen_splash` wrote into the iOS asset and android splash land/port dirs without creating them (only the mipmap loop + `drawable/` got `mkdir -p`), so under `set -euo pipefail` a single missing target dir aborted the whole regen. Added `mkdir -p "$(dirname ...)"` in each emitter. (edge-case)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the "no alpha" opaque check excluded only colorType 6/4, but palette (colorType 3, used by the mdpi icons) can carry a `tRNS` transparency chunk the IHDR-only parser never inspected. Hardened: assert the iOS AppIcon is colorType exactly 2 (RGB) for the App-Store alpha rule, and scan the chunk stream to assert no `tRNS` on the opaque Android icons/splashes (current assets pass — the generator uses `-alpha off`). (adversarial + edge-case + verification-gap)
  - `[low]` `[patch]` `docs/mobile-build.md` + `android/keystore.properties.example` — the docs said keep the keystore "outside the repo" while the template's `storeFile=release.jks` resolves relative to `android/app`, so following the docs literally broke signing. Documented the resolution rule and recommended an absolute path for an out-of-repo keystore in both places. (adversarial)
- deferred: 1 — Android 12+ system SplashScreen display mechanism (see `deferred-work.md`).
- rejected (summary): new files showing as untracked in the review snapshot (a pre-commit artifact — Finalize stages all diff files, tracked + untracked); `versionCode` monotonic-increment not CI-enforced (documented in the release runbook; there is no release-CI pipeline, and the intent asks for *documented* build config, which the docs provide); asset generation "idempotent only w.r.t. dimensions, no committed byte-hash / regen-check" (the spec deliberately scopes idempotency to dimensions; byte-reproducibility is a nice-to-have not required by the intent); `-fuzz 6% -transparent` knockout keyed on the exact brand-bg hex could fringe the emblem if the background darkens (works today; a future bg change is speculative, and the foreground alpha spans 0→opaque correctly); iOS `ExportOptions.plist.example` "only checked for the `app-store` string" (it is a static committed template on the disclosed iOS manual boundary — over-verifying static template text adds no protection).

### 2026-07-21 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0 (see note)
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` `android/app/build.gradle` — `keystoreProperties.load()` ran unguarded inside the top-level `if (exists())`, *before* the `hasKeystore` completeness guard. A malformed `keystore.properties` (e.g. a Windows path `storeFile=C:\utils\release.jks`, where `\u` is an invalid unicode escape) makes `Properties.load()` throw `IllegalArgumentException` at Gradle configuration time, aborting **every** build type incl. debug/CI — the exact "breaks all builds" class the prior pass's null-key guard did *not* close (that guard only covers the load-succeeds-but-key-missing path). Wrapped the load in try/catch (via `withInputStream`), clearing the props and warning on parse failure so it degrades to unsigned. (edge-case)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the "guards on a completeness check" test asserted the four keystore keys via an unscoped order-only regex `/'storeFile'…'keyPassword'/` over the whole gradle file; those same four tokens also appear in the `signingConfigs.release` assignment block, so shrinking the `.every` completeness list (e.g. to `['storeFile']`) would leave the test green while reopening the partial-keystore bug. Scoped the assertion to the `def hasKeystore = … .every {` expression slice and checked each key inside it. (verification-gap — broken-verification)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the spec claims the display name is "pinned by tests" on **both** platforms, but only iOS `CFBundleDisplayName` was asserted; the Android launcher label (`@string/app_name`) value was pinned by nothing. Added an assertion that `strings.xml` `app_name` == "Angle Wars". (adversarial)
- defer note: the Android 12+ system-SplashScreen finding (branded full-bleed splash PNGs not rendered via the inherited `Theme.SplashScreen` background-only wiring; targetSdk 36) recurred this pass (adversarial + intent-alignment), but it is a pre-existing Capacitor-scaffold issue already logged in `deferred-work.md` from the prior pass — not re-logged, per orchestrator ownership of existing ledger entries.
- rejected (summary): generator not byte-deterministic / no regen-hash (idempotency is deliberately scoped to *dimensions* by the intent, not bytes — already rejected prior pass); adaptive-foreground emblem may exceed the circular-mask safe zone, iOS splash storyboard content-mode letterbox risk, adaptive-foreground fuzz-knockout hard halo edge, `ic_launcher_round` not pre-masked to a circle (API 24-25), byte-floor doesn't catch a wrong-but-branded image (all subjective visual quality — the intent explicitly discloses on-device visual branding QA as the manual boundary); `minifyEnabled false` for the release AAB (R8/minify is outside this story's stated intent — icons/manifests/signing/docs only — and enabling it without Phaser-aware proguard rules risks breakage); `hasKeystore` doesn't validate `storeFile` resolves to a real file (the contract promises only unsigned-when-*absent*; a loud sign-time failure on a present-but-misconfigured file is acceptable); brand-bg hex duplicated across files (maintainability; the rendered file is pinned; a future bg change is speculative); `convert`-vs-`magick`/IM7/`policy.xml` portability and WSL `convert.exe` shadowing (build-time-only tool; the PNGs are committed so no consumer needs it, and it demonstrably works on this host); Gradle signing block + generator verified by source-grep not execution (the disclosed manual boundary — no JDK 21/Gradle/SDK/device on this Linux host).

### 2026-07-21 — Review pass (follow-up #2)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 0, low 6)
- defer: 1
- reject: 18
- addressed_findings:
  - `[low]` `[patch]` `android/keystore.properties.example` — the comment claimed "The `release.jks` placeholder below only works if the keystore actually sits in android/app/", but the follow-up pass had already changed the placeholder value to an absolute path (`/absolute/path/to/anglewars-release.jks`), so the comment referenced a placeholder that no longer exists. Rewrote the comment to describe the actual absolute placeholder and the bare-relative-name-resolves-under-android/app caveat. (adversarial)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the iPhone-orientation test's comment asserted the `~ipad` array "legitimately keeps Portrait", directly contradicting both the shipped `Info.plist` (iPad is landscape-only since the first pass) and the immediately following iPad-landscape-only assertion; a maintainer trusting the comment could "restore" iPad Portrait and silently break the lock. Corrected the comment to say the ~ipad variant is landscape-locked too, asserted in the next test. (adversarial + intent-alignment)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the three iOS `Splash.imageset` PNGs were asserted only on dims + bit-depth, while the Android splashes pin the "alpha stripped" invariant (colorType ≠ 6/4 + no `tRNS`); a regenerated RGBA iOS splash would have shipped green against the intent's "every opaque icon/splash flattened, alpha stripped" constraint. Added the same three opacity assertions to the iOS splash loop. (verification-gap)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — `keystore.properties.example`'s key names were pinned by nothing (only existence + not-ignored + the iOS `app-store` string were checked), yet `build.gradle`'s `hasKeystore` guard requires exactly `storeFile`/`storePassword`/`keyAlias`/`keyPassword`; renaming a key in the template (→ a copied `keystore.properties` the guard silently rejects → an unsigned release with no error) stayed green. Added an assertion that the template declares exactly those four keys. (verification-gap)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the brand neon palette (`#12e6ff` cyan, `#ff2ea6` magenta) and the generator's load-bearing flags (`BG="#05060a"`, `-depth 8`, `-alpha off`) were asserted nowhere; because the dims/alpha tests read the committed PNGs (unchanged on a source-only edit), recolouring the emblem in `resources/icon.svg` or flipping the generator background to white would ship off-brand/spec-violating assets on the next `npm run assets:mobile` with all tests green. Pinned the cyan/magenta strokes + `<polyline>` geometry in the SVG test and the three flags in the generator-script test (symmetric with the already-present `#05060a` check). (verification-gap + intent-alignment)
  - `[low]` `[patch]` `src/build/storeRelease.test.js` — the `sensorLandscape` lock was verified by two unscoped `manifest.toContain(...)` checks not coupled to the `MainActivity` element, so moving the attribute onto another `<activity>` (or into a comment) would keep both green while the landscape lock was gone. Scoped the assertion to the `MainActivity` `<activity>` element itself (matching the display-name test's discipline). (verification-gap)
- deferred: 1 — repo-root `.gitignore` does not ignore `*.jks`/`*.keystore`/`keystore.properties` (only `android/.gitignore` does); a signing secret dropped outside `android/` would not be caught (see `deferred-work.md`).
- defer note: the Android 12+ system-SplashScreen finding (branded full-bleed splash PNGs not rendered via the inherited `Theme.SplashScreen` background-only wiring; targetSdk 36) recurred again this pass (adversarial + edge-case + intent-alignment) but is already logged in `deferred-work.md` from the first pass — not re-logged, per orchestrator ownership of existing ledger entries.
- rejected (summary): fail-loud vs graceful-degrade on a present-but-broken keystore (the intent explicitly scopes unsigned to *absent* and prioritizes dev/CI staying green — already litigated); `storeFile` resolves relative to `android/app` not `android/` + non-`\u` backslash-escape corruption + `hasKeystore` doesn't stat the `.jks` (all present-but-misconfigured → a loud sign-time failure is acceptable per the contract; docs already recommend an absolute path — already rejected prior pass); `minifyEnabled false` (R8 outside the icons/manifests/signing/docs scope — already rejected); `allowBackup="true"` unexamined (out of the manifest orientation/permissions/identity scope, no sensitive data); "exactly INTERNET" checks the source not the merged manifest (merging needs an SDK build — the disclosed manual boundary; the intent anchors the check to the source manifest — already rejected class); `isIgnored()` shells to `git check-ignore` (the suite is a repo-local gate; git is always present where it runs); `ExportOptions method=app-store` "deprecated" (still valid; static template on the disclosed iOS manual boundary — already rejected class); `versionCode` not CI-enforced (documented; no release-CI pipeline — already rejected prior pass); no env-var/CI-secret signing path (beyond the intent's `keystore.properties` mechanism; no release-CI); `convert`-vs-`magick`/IM7 + SVG-delegate determinism + orphan iOS dir on a missing platform (build-time-only tool, committed PNGs, `ios/` is committed — already rejected class); brand-bg hex duplicated across files (maintainability; rendered file pinned — already rejected prior pass); exact `colorType===2`/`===6` brittle to a different IM encoding (the exact truecolour/RGBA pins are a *deliberate* App-Store-no-alpha / foreground-alpha hardening from prior passes — loosening weakens the guarantee, and a regen mismatch fails loud, not silent); gradle-test brace-indent regexes brittle to a reformat (the tight scoping was a deliberate follow-up-pass fix; the failure is loud and visible); PNG chunk-walker advancing past a malformed length (committed assets are well-formed — not a plausible regression); `armv7`→`arm64` rides along out of the stated iOS scope (a correct, tested, deliberate prior-pass NFR10 fix, not a defect).

## Design Notes

- **"Icons/splash exist across densities" ⇒ branded, not placeholders.** The shipped shell already technically has icons/splash at every density, but they are Capacitor's default logo. The epic goal names "app icons and splash screens ... for Angle Wars"; a store submission carrying Capacitor's mark would be rejected and is plainly not the intent. So the deliverable is *branded* assets. This is the reading the epic goal selects, not an open choice.
- **Why ImageMagick + a committed SVG, not `@capacitor/assets`.** `@capacitor/assets` pulls `sharp` (native binaries) — fragile to install in an unattended run. `convert` is already present on this host and renders simple SVG geometry via its internal MSVG renderer (verified). Committing the generated PNGs means no consumer ever needs ImageMagick — it is a build-time tool only.
- **Emblem-only brand mark (no wordmark text).** The mark is pure geometry so IM needs no font/rsvg delegate, and an emblem-only splash matches the game's "text-is-vectors" neon aesthetic and avoids fighting the native launch storyboard. Wordmark text is deliberately omitted to keep the generator font-independent and robust.
- **Alpha rules are load-bearing.** App Store review rejects app icons that contain an alpha channel, so the iOS 1024 icon is `-background '#05060a' -flatten -alpha off`. The Android adaptive foreground layer *must* keep alpha (it composites over the separate background layer), so it is generated on a transparent canvas. The test parses the PNG IHDR color-type byte to enforce both.
- **Signing scaffold degrades gracefully.** The standard Android pattern — load `keystore.properties` behind a `file.exists()` guard and apply `signingConfig` only when present — keeps unattended/CI release builds working (unsigned) while giving a real signed path the moment a developer drops in their keystore. Secrets live only in gitignored files; the repo carries `.example` templates.
- **iOS single-size app icon is sufficient.** Xcode 14+ accepts a single universal 1024 App Icon and derives every home-screen/settings/store size, which is how Capacitor generated `AppIcon.appiconset`. Rebranding the one 1024 satisfies the iOS side of the density AC.

## Verification

**Commands:**
- `npm run assets:mobile` -- expected: exits 0; regenerates every Android + iOS icon/splash at its density; `git status` shows the branded PNGs changed.
- `npx vitest run` -- expected: full suite green including `src/build/storeRelease.test.js` (PNG dims/alpha, manifest orientation + permissions, iOS landscape-only, signing scaffold, gitignore, `.example` templates, docs section); no regression in the existing suite.
- `npm run build` -- expected: production Vite build still succeeds (no `src/` runtime change).

**Manual checks (cannot run on this Linux host — no Android SDK/JDK 21/macOS/Xcode/device):**
- On an SDK-equipped machine: drop a real keystore + `keystore.properties`, run `cd android && ./gradlew bundleRelease` → a signed `.aab` uploadable to Google Play; confirm the branded launcher icon + splash render on a device/emulator, locked to landscape.
- On macOS/Xcode: archive the iOS app and export with `ExportOptions.plist` (app-store method) → a signed `.ipa` uploadable to App Store Connect; confirm the branded icon + splash and landscape lock on a device.

## Auto Run Result

Status: done

**Summary:** Follow-up review pass (#2) over the committed Story 7.6 store-release scaffolding (baseline `d542284` → HEAD). Four review layers ran in parallel (adversarial / edge-case / verification-gap / intent-alignment). No intent gaps or spec defects — the change faithfully implements the intent; all findings were test/doc/template hardening or out-of-scope-per-intent noise. Six low-severity patches applied (no runtime/`src/` gameplay code touched), one new item deferred, the Android-12+ SplashScreen finding recognized as already-logged (not re-logged).

**Files changed this pass:**
- `src/build/storeRelease.test.js` — iOS splash alpha-stripped assertions; pin `keystore.properties.example`'s four keys; pin brand neon palette (`#12e6ff`/`#ff2ea6`) + `<polyline>` geometry in the SVG test and generator flags (`BG="#05060a"`, `-depth 8`, `-alpha off`); scope the `sensorLandscape` check to the `MainActivity` element; fix the stale `~ipad`-"keeps Portrait" comment.
- `android/keystore.properties.example` — corrected the comment that referenced a `release.jks` placeholder no longer present (value is an absolute path).
- `_bmad-output/implementation-artifacts/spec-7-6-store-release-scaffolding.md` — Review Triage Log entry, status, `final_revision`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — one new defer entry (root-level `.gitignore` secret-ignore scope).

**Findings breakdown:** intent_gap 0 · bad_spec 0 · patch 6 (high 0, medium 0, low 6) · defer 1 · reject 18.
- Patches applied: the six listed above.
- Deferred (1): repo-root `.gitignore` does not ignore `*.jks`/`*.keystore`/`keystore.properties` (only `android/.gitignore` does).
- Rejected (18): fail-loud-vs-degrade on a present-but-broken keystore, relative `storeFile`/backslash/no-stat (present-but-misconfigured → loud sign-time failure acceptable per contract), `minifyEnabled false`, `allowBackup`, source-vs-merged manifest permission check, `git check-ignore` env coupling, `app-store` "deprecation", `versionCode` CI enforcement, env-var signing path, `convert`/IM7/delegate/orphan-dir, duplicated brand-bg hex, exact colorType brittleness (deliberate hardening), gradle-regex reformat brittleness, PNG-walker corrupt-input, `armv7`→`arm64` ride-along. (Full rationale in the Review Triage Log.)

**Follow-up review recommended:** `true` — patched this pass: high 0, medium 0, low 6; score = 3×0 + 1×6 = 6 (≥ 5).

**Verification performed:**
- `npx vitest run src/build/storeRelease.test.js` → 55/55 passed (new assertions included).
- `npx vitest run` (full suite) → 1029/1029 passed across 57 files; no regression.
- `npm run build` → production Vite build succeeded (no `src/` runtime change).

**Residual risks:** the store-readiness surface (actual signed AAB/`.ipa`, on-device landscape + branded-icon/splash rendering, Android-12+ system splash) remains the disclosed manual boundary — unverifiable on this Linux host (no Android SDK/JDK 21/macOS/Xcode/device). `sprint-status.yaml` was left modified in the working tree (orchestrator-owned bookkeeping, not part of this change) — residual artifact, not committed.

