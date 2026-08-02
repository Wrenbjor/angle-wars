# Claude repository entry point

Read and follow `AGENTS.md` before making changes. It is the authoritative repository workflow; this file intentionally does not duplicate it.

In particular, use the repository's synchronized version commands, keep release work off `main` until reviewed and verified, run every required web/native check, and publish only an APK built from the exact released commit. Do not treat the local pre-push hook as GitHub branch protection and do not bypass it.
