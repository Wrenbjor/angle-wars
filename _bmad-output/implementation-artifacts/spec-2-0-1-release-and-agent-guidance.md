---
title: '2.0.1 Release and Agent Guidance'
type: 'chore'
created: '2026-08-02'
status: 'done'
baseline_commit: '79b9ff5'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-title-version-and-semver-push-guard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository lacks root-level agent instructions explaining the new version workflow, and the completed version-display work has not yet been released as an installable Android build or published on `main`.

**Approach:** Add concise `AGENTS.md` and `CLAUDE.md` release guidance, explicitly bump synchronized metadata to `2.0.1`, rebuild and verify the Android APK, merge the reviewed feature branch into `main`, push it, and publish a GitHub `v2.0.1` release containing the APK.

## Boundaries & Constraints

**Always:** Treat `package.json` as version authority; use `npm run version:bump -- patch`; commit the documentation and release metadata on the feature branch; fetch before integrating; require tests, web build, metadata check, Capacitor sync, and Android debug assembly to pass; preserve the existing `main` history; use tag `v2.0.1`; attach the exact verified APK; confirm remote branch, tag, and release state after publication.

**Ask First:** Any history rewrite, force push, deletion of remote refs/releases, release version other than `2.0.1`, or unrelated changes discovered during integration.

**Never:** Push failing code; bypass the pre-push hook; commit generated `dist` or Android intermediate outputs; claim GitHub branch protection is configured when only a local hook exists; overwrite user changes; publish an APK not built from the released commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Agent onboarding | Fresh coding-agent session | Root instructions explain branch, SemVer, verification, APK, and publication workflow | Commands and policy agree with repository scripts |
| Release bump | Current version `2.0.0` | Package, lockfile, Android name become `2.0.1`; Android code increments once | Drift or invalid state stops before publication |
| Main integration | Remote `main` fetched and compatible | Reviewed feature history merges without rewriting history | Divergence/conflicts halt for explicit resolution |
| APK publication | Verified `app-debug.apk` from `v2.0.1` commit | GitHub release `v2.0.1` contains the APK asset | Missing GitHub authentication/tooling halts with exact blocker |

</frozen-after-approval>

## Code Map

- `AGENTS.md` -- primary repository instructions for coding agents.
- `CLAUDE.md` -- Claude-specific entry point aligned with primary instructions.
- `package.json`, `package-lock.json` -- authoritative SemVer and lock metadata.
- `android/app/build.gradle` -- Android `versionName` and monotonically increasing `versionCode`.
- `scripts/bump-version.mjs` -- supported synchronized bump command.
- `docs/mobile-build.md` -- detailed Android and release operations reference.
- `android/app/build/outputs/apk/debug/app-debug.apk` -- verified release attachment source.

## Tasks & Acceptance

**Execution:**
- [x] `AGENTS.md` -- define repository branch, SemVer, verification, APK, and GitHub publication practices.
- [x] `CLAUDE.md` -- point Claude to the same mandatory workflow without conflicting duplication.
- [x] Version metadata -- run the supported patch bump and confirm exact `2.0.1` synchronization.
- [x] Verification -- run full tests, web build, version check, Capacitor sync, and Android debug assembly.
- [x] Git/GitHub -- commit on the feature branch, integrate into updated `main`, push, tag, create the GitHub release, attach the verified APK, and verify remote state.

**Acceptance Criteria:**
- Given a new coding-agent session, when it reads the repository instructions, then it receives one consistent, executable release workflow and is warned that local hooks do not replace hosted branch protection.
- Given synchronized `2.0.1` metadata, when all release verification commands run, then every command succeeds and the rebuilt APK exists at the documented path.
- Given the release commit is integrated, when remote state is checked, then GitHub `main` contains it and release `v2.0.1` exposes the verified APK asset.

## Spec Change Log

## Design Notes

`AGENTS.md` is authoritative. `CLAUDE.md` should reference it and add only Claude-oriented reminders, preventing two instruction files from silently diverging. A debug APK is appropriate because that is the currently established, tested artifact; it must be labeled clearly as debug in the release asset and notes.

## Verification

**Commands:**
- `npm test` -- all regression tests pass.
- `npm run version:check` -- package, lockfile, and Android metadata are synchronized.
- `npm run build` -- production web bundle succeeds.
- `npx cap sync android` -- native project contains the current web build.
- `cd android && ./gradlew assembleDebug` -- latest debug APK builds successfully.
- `git status`, `git log`, `git ls-remote`, and `gh release view v2.0.1` -- local and hosted release state agree.

## Suggested Review Order

**Release policy**

- Establish one authoritative workflow for safe branches, versions, builds, and publication.
  [`AGENTS.md:1`](../../AGENTS.md#L1)

- Keep Claude guidance concise by delegating to the authoritative repository instructions.
  [`CLAUDE.md:1`](../../CLAUDE.md#L1)

**Release identity**

- Advance the package authority to the requested patch release.
  [`package.json:2`](../../package.json#L2)

- Keep Android identity monotonic and synchronized with package SemVer.
  [`build.gradle:38`](../../android/app/build.gradle#L38)

**Operational verification**

- Require exact-commit rebuilding and checksum validation across the published APK boundary.
  [`AGENTS.md:25`](../../AGENTS.md#L25)

- Capture the approved release contract and verification evidence.
  [`spec-2-0-1-release-and-agent-guidance.md:1`](spec-2-0-1-release-and-agent-guidance.md#L1)
