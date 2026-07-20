---
title: 'Build-artifact verification test (DW-35)'
type: 'refactor'
created: '2026-07-20'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false # patched high 0, medium 0, low 4 → 3×0 + 1×4 = 4 (<5)
context: []
warnings: [oversized]
baseline_revision: '0a5dbd40477bcb919fb4bc635df5345b87bc5080'
final_revision: '37e1540c5d79a5c46815d86b31c5e031cb0889db'
---

<intent-contract>

## Intent

**Problem:** Story 5.5's NFR6 build-correctness ACs (relative `./` asset paths, a content-hashed *separate* Phaser vendor chunk, and tree-shaken `render FPS` / `sim ticks/s` debug strings) are verified one surface below where they live — `buildConfig.test.js` imports the `vite.config` object and regex-matches `main.js` / `ArenaScene.js` source text, never the emitted `dist/` artifact. A config that parsed correctly but produced a broken bundle (absolute asset paths, a merged Phaser chunk, or an un-tree-shaken debug readout) would pass the whole suite. The `npm run build` verification command proves the artifact by hand, but nothing automated asserts against it.

**Approach:** Add one automated build-then-inspect integration test that runs the real Vite build (via Vite's programmatic `build()` API, inheriting the project `vite.config.js`) into a hermetic temp `outDir` in a `beforeAll`, then asserts against the emitted `dist/` files themselves: relative `./assets/...` references in `index.html`, a content-hashed `phaser-<hash>.js` vendor chunk distinct from the app chunk, and the absence of the debug strings in the minified app chunk — anchored by a positive-control gameplay string so the absence proves tree-shaking, not a missing chunk. NFR1 (60 FPS) and NFR7 (live resize/letterbox) stay manual/perf-harness territory and are out of scope.

## Boundaries & Constraints

**Always:**
- The test MUST run the real Vite production build, not re-parse config or source. Invoke Vite's programmatic `build()` from the `vite` package with the project root, so the resolved `vite.config.js` (base, `manualChunks`, target) is inherited — override only `build.outDir` (a hermetic temp dir), `build.emptyOutDir: true`, and `logLevel` (`'silent'`/`'error'`). Do the build once in a `beforeAll` with a generous hook timeout (≥120000 ms); clean the temp dir in `afterAll`.
- Build into a temp directory OUTSIDE the project `dist/` (e.g. under `os.tmpdir()`), so running the suite never clobbers a developer's real `npm run build` output. Compute an absolute temp path deterministically from `import.meta`/pid — never from `Date.now()`/`Math.random()` (keep it reproducible and cleanup-safe).
- Relative-path assertion: parse the emitted `index.html`, collect every `src=`/`href=` asset reference, and assert each one begins with `./` (i.e. `./assets/...`) — none is server-absolute (`/assets/...`, a leading `/`) or an external URL (`http`). Assert at least one asset reference was found (an empty match set must fail, not vacuously pass).
- Vendor-split assertion: assert `dist/assets/` contains exactly one file matching `/^phaser-[A-Za-z0-9_-]+\.js$/` (the content-hashed Phaser vendor chunk) AND at least one distinct app chunk matching `/^index-[A-Za-z0-9_-]+\.js$/`; the two filenames MUST differ. Assert `index.html` references the Phaser chunk (its `phaser-<hash>.js` filename appears in the HTML) so the split is actually wired into the loaded graph.
- Debug tree-shaking assertion: read the app chunk (`index-<hash>.js`) text and assert it contains NEITHER `render FPS` NOR `sim ticks/s`. Guard against a vacuous pass: first assert the app chunk exists and is non-empty, then assert a positive-control gameplay string that SHOULD survive minification (`GAME OVER`, a plain string literal in `ArenaScene`) IS present — so the debug strings' absence demonstrably means they were tree-shaken out of a chunk that does contain ArenaScene code.

**Block If:**
- (none anticipated — additive test coverage over an already-shippable, already-reviewed build. No ambiguous decision requires a human.)

**Never:**
- Do NOT modify `vite.config.js`, `src/main.js`, `src/scenes/ArenaScene.js`, or any production/build source. This is test-only; the build is already correct.
- Do NOT weaken, rewrite, or remove the existing `buildConfig.test.js` config/source-surface assertions — they are complementary (fast config guards). The new test ADDS the artifact-surface layer.
- Do NOT shell out to `npm run build`/`npx` as the primary mechanism (subprocess/PATH/ordering fragility the ledger flagged); build in-process via the programmatic API so the test is self-contained and order-independent.
- Do NOT assert NFR1 (60 FPS) or NFR7 (live canvas resize/letterbox visibility) — those remain the documented manual/perf-harness boundary.

## I/O & Edge-Case Matrix

Emitted `dist/` artifact (produced once by the real Vite build in `beforeAll`):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Relative asset paths | built `index.html` | every `src`/`href` asset ref starts with `./`; none server-absolute or external; ≥1 ref found | non-empty match set required (empty ⇒ fail) |
| Separate vendor chunk | built `dist/assets/` | exactly one `phaser-<hash>.js` and ≥1 distinct `index-<hash>.js`; filenames differ; Phaser filename referenced in `index.html` | missing/merged chunk ⇒ fail |
| Debug tree-shaken | built app `index-<hash>.js` text | contains neither `render FPS` nor `sim ticks/s`; positive control `GAME OVER` present; chunk non-empty | vacuous pass blocked by positive control |

</intent-contract>

## Code Map

- `src/build/buildArtifact.test.js` -- NEW node-env vitest integration test. `beforeAll` runs Vite's programmatic `build()` into a temp `outDir`; the three `it` blocks read the emitted `index.html` + `assets/*.js` and assert the NFR6 artifact invariants; `afterAll` removes the temp dir.
- `vite.config.js` -- reference only (inherited by the programmatic build for `base: './'`, `manualChunks: { phaser: ['phaser'] }`, `target: es2022`, `outDir`). NOT edited.
- `src/scenes/ArenaScene.js` -- reference only. Source of the DEV-gated debug strings (`render FPS`, `sim ticks/s`, inside `if (import.meta.env.DEV)` blocks) that must be tree-shaken, and of the positive-control `GAME OVER` literal. NOT edited.
- `src/build/buildConfig.test.js` -- existing config/source-surface guards (relative base, manualChunks presence, DEV-gate strip check). Complementary; unchanged.
- `package.json` -- `test: vitest run`; `build: vite build`. The new test file is picked up by `test.include: ['src/**/*.test.js']`. Reference only.

## Tasks & Acceptance

**Execution:**
- `src/build/buildArtifact.test.js` -- ADD the integration test. Import `build` from `vite`, `readFileSync`/`readdirSync`/`rmSync` from `node:fs`, `os.tmpdir`, and path helpers. In `beforeAll` (timeout ≥120000): resolve project root from `import.meta.url`, pick a deterministic absolute temp `outDir` under `os.tmpdir()` (suffix with `process.pid`, no `Date.now`/`Math.random`), and `await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } })`. Read `index.html` and list `assets/`. Three `it` blocks implement the I/O-matrix rows exactly (relative paths, separate content-hashed Phaser chunk referenced by the HTML, debug strings tree-shaken with the `GAME OVER` positive control + non-empty-chunk guard). `afterAll` removes the temp dir with `rmSync(outDir, { recursive: true, force: true })`.

**Acceptance Criteria:**
- Given the real Vite production build emitted to a temp `outDir`, when the test parses `index.html`, then every asset `src`/`href` reference is relative (begins with `./`), at least one reference exists, and none is server-absolute or an external URL. (NFR6)
- Given the emitted `dist/assets/`, when the test lists it, then there is exactly one content-hashed `phaser-<hash>.js` vendor chunk and at least one distinct `index-<hash>.js` app chunk, their filenames differ, and the Phaser chunk filename appears in `index.html`. (NFR6)
- Given the emitted app chunk, when the test reads its text, then it contains neither `render FPS` nor `sim ticks/s`, while the positive-control gameplay literal `GAME OVER` IS present and the chunk is non-empty — proving the debug readout was tree-shaken from a chunk that does carry ArenaScene code. (NFR6)
- Given the existing `buildConfig.test.js` and the rest of the suite, when `npm test` runs, then all pre-existing tests still pass unchanged (the new test only adds coverage). (regression guard)

## Spec Change Log

_No bad_spec loopbacks — spec unchanged through review (0 intent_gap, 0 bad_spec). All review findings resolved as in-diff patches or rejections._

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` The vendor-chunk test's `expect(appChunks).not.toContain(phaserChunk)` was a tautology — `index-*` and `phaser-*` filters are disjoint by prefix, so it could never fail and proved nothing about the split. Replaced with a byte-size comparison (`statSync`): the phaser chunk must be `> 2×` the app chunk, proving Phaser's ~95%-of-bytes bulk genuinely moved into its own vendor chunk rather than being merged/duplicated into the app chunk.
  - `[low]` `[patch]` The debug tree-shaking test scanned only `appChunks[0]` — `readdirSync` order is filesystem-dependent, so with a second `index-*.js` chunk the pick was nondeterministic and a leaked debug string in another chunk would pass unseen. Now reads/joins ALL app chunks for the positive control + negative assertions, and adds a defensive backstop scanning EVERY emitted `*.js` asset for the debug strings.
  - `[low]` `[patch]` The relative-path check would false-fail a spec-compliant build that inlined a small asset as a `data:` URI (or added an in-page `#` anchor). Now counts refs before filtering (non-empty guard preserved), then skips `data:`/`#`/`mailto:`/`blob:` refs before asserting `./`, keeping the server-absolute/external prohibitions for real asset paths.
  - `[low]` `[patch]` The chunk-name regexes (`[A-Za-z0-9_-]+`) accepted ANY suffix, so a non-hashed `phaser-vendor.js` (which breaks the cross-deploy caching the split exists for) would pass despite the "content-hashed" AC. Tightened both to require a hash-length suffix (`{8,}`, Vite's default 8-char base64url hash) in the vendor and debug tests.
- rejected (11): the `GAME OVER` positive control being "vacuous" (the verification-gap layer confirmed it sound — if the DEV block shipped, the same chunk holding `GAME OVER` would hold the debug strings and fail; the intent names exactly these two strings, and a dev-mode counter-build is disproportionate); "use `mode:'production'` instead of mutating `NODE_ENV`" (factually wrong — Vitest presets `NODE_ENV=test`, which Vite's `isProduction` prioritizes over `mode`, so the `NODE_ENV` override is load-bearing and correct; it is restored in `finally` and Vitest isolates test files by worker); the `indexHtml.toContain(phaserChunk)` modulePreload assumption (modulePreload is Vite's default and not disabled in this config; the HTML-wiring check is itself intent-relevant); hardcoded `assets/` dir throwing on a custom `assetsDir` (default, not configured — speculative); the heavyweight build running inside `npm test` (spec Design Notes explicitly accept the measured ~4.9s single-build cost as the intended trade for closing the artifact-surface gap); the 180000ms timeout "magic number" (ample headroom over the spec's ≥120000 floor); `refs.length>0` not asserting a concrete entry script (the vendor-chunk test already asserts both chunks exist and Phaser is wired into the HTML); the pid-keyed temp dir leaving orphans (the spec mandates deterministic pid naming with no `Date.now`/`Math.random`; `emptyOutDir` + `afterAll` handle the normal path; `mkdtemp` would violate the no-random constraint); and the intent-alignment layer's three descriptive divergences — additive rather than replacing `buildConfig.test.js` (the spec's Never-constraint forbids weakening it), inspecting a temp `outDir` rather than literal `dist/` (the `outDir: 'dist'` invariant remains asserted at the config surface in `buildConfig.test.js`, and the temp dir is a deliberate no-clobber choice), and internal debug identifiers verified at the source surface (the intent scoped the artifact check to the two named display strings; `buildConfig.test.js`'s DEV-strip covers the identifiers).

## Design Notes

Why programmatic `build()` over `execSync('npm run build')`: the ledger's own reason flagged "build-before-test ordering" as the fragility that kept this on the manual boundary. Building in-process inside `beforeAll` makes the test self-contained and order-independent — it produces the artifact it inspects, so there is no external ordering to get wrong, and it inherits the very `vite.config.js` under test (any real config regression surfaces in the emitted files). The temp `outDir` keeps it hermetic: a test run never overwrites a developer's `npm run build` output in `dist/`.

Why the positive control: asserting only "the debug string is absent" is a false-negative trap — it also passes if ArenaScene never made it into the app chunk at all. Pinning a gameplay literal (`GAME OVER`) that must survive minification proves the chunk genuinely contains ArenaScene source, so the debug strings' absence is real tree-shaking (Vite statically resolving `import.meta.env.DEV` to `false` and dropping the guarded branch), not vacuous.

Cost/placement: the test runs one real build (~4 s locally) inside the standard `npm test` suite. That is the intended trade — closing the artifact-surface gap requires an actual build — and the generous hook timeout absorbs slower CI. The fast config/source guards in `buildConfig.test.js` remain the first line; this is the artifact-level backstop.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including the new `src/build/buildArtifact.test.js` (3 artifact assertions green) and every pre-existing test unchanged. The run performs one real Vite build into a temp dir and cleans it up.
- `npm run build` -- expected: still succeeds unchanged; `dist/` emits `index.html` + a separate content-hashed `phaser-<hash>.js` and `index-<hash>.js` under `assets/` with relative `./assets/...` references and no chunk-size warning (confirms the artifact the test inspects matches the real build).

**Manual checks:**
- Confirm no developer `dist/` clobbering: after `npm test`, a pre-existing `dist/` from a prior `npm run build` is untouched (the test built into `os.tmpdir()`), and the temp dir is removed.

## Auto Run Result

Status: done

**Summary of implemented change:** Closes DW-35 by adding one automated build-then-inspect integration test (`src/build/buildArtifact.test.js`) that runs the REAL Vite production build via the programmatic `build()` API into a hermetic temp `outDir` and asserts NFR6 build-correctness at the emitted-artifact surface — where Story 5.5 previously only asserted at the `vite.config`/source-text surface. Three assertions: (1) every `index.html` asset ref is relative `./` (non-filesystem refs like `data:`/anchors skipped, server-absolute/external prohibited); (2) a separate content-hash-named `phaser-<hash>.js` vendor chunk exists, is `>2×` the app chunk by bytes (proving the ~95%-of-bytes engine bulk actually split out), and is wired into `index.html`; (3) the DEV-gated debug strings `render FPS` / `sim ticks/s` are tree-shaken from all app chunks and every emitted JS asset, anchored by the `GAME OVER` positive control so the absence proves genuine tree-shaking. NFR1 (60 FPS) and NFR7 (live resize/letterbox) remain the documented manual/perf-harness boundary, out of scope.

**Files changed:**
- `src/build/buildArtifact.test.js` (NEW) — node-env Vitest integration test: `beforeAll` forces `NODE_ENV=production` (Vitest presets `test`, which Vite's `isProduction` prioritizes over `mode`) around a programmatic `build()` into a pid-suffixed `os.tmpdir()` dir; three artifact assertions; `afterAll` removes the temp dir.

**Review findings breakdown:** patch 4 (low 4), defer 0, reject 11 (low 11), intent_gap 0, bad_spec 0. All four patches (dead-assertion → byte-size split proof; single-chunk scan → all-chunks + all-JS backstop; `data:`/anchor false-fail guard; content-hash-length regex tightening) were applied in-diff and verified. See the `## Review Triage Log` entry for the full rejection rationale.

**Follow-up review recommendation:** false (patched high 0, medium 0, low 4 → 3×0 + 1×4 = 4, below the 5 threshold).

**Verification performed:**
- `npm test` → 46 files, **657 tests passed**, including `src/build/buildArtifact.test.js` (3 assertions, one real production build ~4.9 s). No pre-existing test changed.
- `npm run build` → succeeds; emits `dist/index.html` + separate content-hashed `phaser-0YPJO2g1.js` (1,481 kB vendor chunk) and `index-*.js` (~51 kB app chunk) under `assets/` with relative `./assets/...` refs and no chunk-size warning — the artifact the test inspects matches the real build.
- No-clobber / no-leak check → no `angle-wars-build-artifact-*` temp dir left in `os.tmpdir()` after the run; the developer `dist/` (gitignored) is not part of the reviewed change.

**Residual risks:**
- The test builds once per `npm test` run (~4.9 s); an intended cost per Design Notes, absorbed by the ≥120000 ms hook timeout on slower CI.
- The `NODE_ENV=production` override is process-global for the build's duration; restored in `finally` and isolated by Vitest's per-file workers, so cross-file leakage risk is negligible.
- Speculative future config changes (custom `assetsDir`, disabled `modulePreload`) were reviewed and rejected as out of scope — none is configured today; if introduced they would surface as loud, diagnosable test failures rather than silent false results.
