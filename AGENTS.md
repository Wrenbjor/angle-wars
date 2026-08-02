# Angle Wars repository instructions

These instructions are authoritative for coding agents working in this repository.

## Branch and change workflow

- Keep `main` releasable. Fetch first, update the intended base with a fast-forward-only operation, and create focused branches from that verified base.
- Fetch the remote before integrating a release. Preserve history: do not force-push, rewrite shared commits, or delete remote refs or releases without explicit approval.
- Preserve unrelated work in a dirty tree. Never commit generated `dist/`, Capacitor-copied web assets, Android intermediates, credentials, or signing material.
- A local Git hook is a useful guard, not branch protection. GitHub branch protection and required checks must be configured on GitHub separately.

## Versioning

`package.json` is the sole SemVer authority. Do not hand-edit release versions in multiple files. Create a release bump with:

```bash
npm run version:bump -- patch   # or minor / major
npm run version:check
```

The bump synchronizes `package.json`, `package-lock.json`, and Android `versionName`, and increments Android `versionCode` exactly once. Commit all synchronized metadata together. Release tags use `vMAJOR.MINOR.PATCH`.

`npm install`/`npm run prepare` installs the committed pre-push guard through `core.hooksPath`. The guard validates pushed commits and blocks stale release metadata on `main`; never bypass it with `--no-verify`. If hooks are missing, run `npm run prepare`. If a hook was previously bypassed, run `npm run version:check` before the next push.

## Required verification

Before integrating or publishing a release, run each command successfully:

```bash
npm ci
npm test
npm run version:check
npm run build
./node_modules/.bin/cap sync android
cd android && ./gradlew assembleDebug
```

The debug APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`. Run these checks from a clean worktree at the exact commit that will be tagged, then record the commit SHA and APK SHA-256. Never reuse or merely “confirm” an older artifact.

## Main and GitHub release workflow

1. Confirm the intended remote tag and GitHub release do not already exist; stop on any collision.
2. Complete and commit the feature branch, including the synchronized version bump.
3. Fetch again, fast-forward local `main` to `origin/main`, then integrate the reviewed branch with `--ff-only`; stop if that is impossible.
4. On final `main`, require a clean worktree and rerun the complete verification sequence. Record `git rev-parse HEAD` and the APK SHA-256.
5. Push `main` normally with hooks enabled. Create an annotated tag on that unchanged commit, then push the tag.
6. Publish a GitHub release for that tag with the newly rebuilt, clearly labeled debug APK attached.
7. Fetch and compare local `HEAD`, `origin/main`, and the peeled tag commit (`refs/tags/<tag>^{}`). Confirm the GitHub release uses that tag.
8. Download the published APK and require its SHA-256 to match the recorded local checksum.

For this repository's detailed native build, signing, and installation notes, see `docs/mobile-build.md`. Stop and ask before changing the intended release version, resolving an unexpected integration conflict, rewriting history, deleting published state, or publishing with failing checks.
