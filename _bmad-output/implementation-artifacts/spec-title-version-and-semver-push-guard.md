---
title: 'Title Version and SemVer Push Guard'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_commit: 'edc61fa'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Players cannot identify the installed build from the title screen, and release metadata can drift across the web package and Android shell when changes are pushed.

**Approach:** Display the package SemVer at the bottom center of the title screen and add a committed, automatically installed pre-push guard plus an explicit bump command so version changes remain synchronized and reviewable.

## Boundaries & Constraints

**Always:** Treat `package.json` as the SemVer source of truth; display exactly that build-time value; keep the label centered and inside the arena bottom safe margin; synchronize `package-lock.json`, Android `versionName`, and monotonically increasing `versionCode`; install the committed hook through the existing npm lifecycle; preserve ordinary feature-branch pushes when metadata is valid.

**Ask First:** Adding a hosted release service, publishing packages, creating GitHub releases automatically, or changing the current `vMAJOR.MINOR.PATCH` tag convention.

**Never:** Silently rewrite or commit files during `git push`; derive versions from wall-clock time; hard-code a separate UI version; require Husky or another runtime dependency; allow a push to `main` whose package version is not newer than the latest reachable SemVer release tag.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Title render | Package version `2.0.1` | Bottom-center label reads `v2.0.1` | Invalid build-time version fails the version tests/build |
| Explicit bump | `npm run version:bump -- patch|minor|major` | Package, lockfile, Android name/code update together | Invalid bump exits non-zero without partial writes |
| Feature push | Valid synchronized metadata | Push proceeds without forcing a release bump | Drift blocks with corrective command |
| Main push | Commits exist after latest `vX.Y.Z` tag | Package SemVer must be greater than that tag | Stale/equal version blocks before network update |
| Fresh install | Repository has Git and npm lifecycle runs | `core.hooksPath` points to committed `.githooks` | Non-Git/archive install warns and continues |

</frozen-after-approval>

## Code Map

- `vite.config.js` -- inject the package version into browser and Vitest builds.
- `src/config/appVersion.js` -- validate/format the build-time version without Phaser.
- `src/scenes/TitleScene.js` -- render the bottom-center version label.
- `scripts/bump-version.mjs` -- atomically synchronize web and Android release metadata.
- `scripts/check-semver.mjs` -- pre-push consistency and main-release gate.
- `.githooks/pre-push` -- portable Git entry point forwarding push refs to the checker.
- `scripts/install-git-hooks.mjs` -- configure the repository-local hooks path from npm prepare.
- `docs/mobile-build.md` -- document bump, hook, and recovery workflow.

## Tasks & Acceptance

**Execution:**
- [x] `vite.config.js`, `src/config/appVersion.js`, `src/config/appVersion.test.js` -- expose one validated package-version value to runtime code.
- [x] `src/scenes/TitleScene.js`, `src/scenes/renderIntegration.test.js` -- render and pin a centered bottom version label.
- [x] `scripts/bump-version.mjs`, `scripts/check-semver.mjs` and focused tests -- implement synchronized SemVer bumping and push validation with failure-safe writes.
- [x] `.githooks/pre-push`, `scripts/install-git-hooks.mjs`, `package.json` -- install and run the dependency-free guard automatically.
- [x] `docs/mobile-build.md` -- document version policy, commands, main-push enforcement, and hook bypass recovery.

**Acceptance Criteria:**
- Given any production or test build, when the title scene renders, then its bottom-center label matches `package.json` as `vMAJOR.MINOR.PATCH`.
- Given each supported bump level, when the bump command succeeds, then all web/Android metadata is synchronized and Android `versionCode` increases exactly once.
- Given a pre-push invocation, when metadata is inconsistent or a main push would reuse the latest release version, then the push is blocked with a specific recovery command and no files are changed.
- Given a clean install in a Git checkout, when npm prepare runs, then the committed pre-push hook becomes active without third-party dependencies.

## Spec Change Log

## Design Notes

A push hook should validate, never mutate history. Version creation remains an explicit command so its diff can be reviewed and committed. The hook enforces synchronized metadata on every push and requires a newer SemVer only when the destination is `main`; feature branches remain independently pushable.

## Verification

**Commands:**
- `npm test` -- all UI, version-script, hook, and existing regression tests pass.
- `npm run version:check` -- current release metadata is synchronized.
- `npm run build` -- the browser bundle contains the package-derived version.
- `npx cap sync android && (cd android && ./gradlew assembleDebug)` -- Android still packages successfully.

**Manual checks:**
- Open the title screen on desktop and phone; verify a subtle `vX.Y.Z` label is centered above the bottom safe edge.

## Suggested Review Order

**Push-time release safety**

- Validate metadata from each pushed commit and gate main against reachable releases.
  [`check-semver.mjs:33`](../../scripts/check-semver.mjs#L33)

- Install committed hooks without silently replacing an existing hook configuration.
  [`install-git-hooks.mjs:3`](../../scripts/install-git-hooks.mjs#L3)

**Version synchronization**

- Apply explicit SemVer bumps across package, lockfile, and Android metadata.
  [`bump-version.mjs:7`](../../scripts/bump-version.mjs#L7)

- Centralize strict parsing, synchronization checks, and failure-safe file replacement.
  [`version-utils.mjs:5`](../../scripts/version-utils.mjs#L5)

**Player-visible build identity**

- Inject and reject invalid package versions before browser artifacts are emitted.
  [`vite.config.js:4`](../../vite.config.js#L4)

- Render the package-derived version at the title screen's bottom center.
  [`TitleScene.js:108`](../../src/scenes/TitleScene.js#L108)

**Verification and operations**

- Exercise bumps, pushed-commit validation, release gating, and no-write failures.
  [`versionScripts.test.js:24`](../../src/build/versionScripts.test.js#L24)

- Document the explicit release workflow and pre-push recovery path.
  [`mobile-build.md:90`](../../docs/mobile-build.md#L90)
