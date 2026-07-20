import { HIGH_SCORE_STORAGE_KEY } from '../config/constants.js';

// highScoreStorage — the single guarded browser-storage seam (Story 3.4 / FR11).
//
// The whole codebase keeps simulation logic in Phaser-free, node-testable systems
// and isolates browser globals in ArenaScene. `localStorage` is a browser global
// absent from the `node` test env (see vite.config.js — environment: 'node', no
// jsdom), and it can also be present-but-blocked at runtime (private mode, quota,
// disabled cookies). So ALL access to it is funneled through this one tiny factory,
// which returns a `{ load, save }` port whose every read/write is try/catch-wrapped
// to degrade to a no-op when the store is missing, blocked, or throwing.
//
// Persistence is strictly best-effort: it NEVER throws. A blocked store must not
// break the run or the render loop — `load()` yields 0, `save()` is silently
// ignored. ArenaScene instantiates the real localStorage-backed port; unit and
// integration tests inject a fake `{ load, save }` (or a fake Storage here).
//
// The high score is the ONLY value persisted this epic; settings/other values are
// out of scope.

// Guarded acquisition of the browser localStorage handle for the factory's
// default. Merely READING the `globalThis.localStorage` property throws a
// SecurityError in sandboxed iframes / storage-disabled browsers — the exact
// blocked-store case this module exists to survive. Because a default parameter
// is evaluated at call time OUTSIDE the per-method try/catch below, that read
// must be wrapped HERE, or `createHighScoreStorage()` (called with no args in
// ArenaScene) would throw and crash the scene before the port is ever built.
// Returns null on any failure so the `if (!storage)` guards then degrade to a
// no-op.
function defaultLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a guarded high-score persistence port over a Storage-like object.
 *
 * @param {Storage|null} [storage=defaultLocalStorage()] A Storage-like object
 *   exposing `getItem(key)` / `setItem(key, value)`. Defaults to the browser
 *   `localStorage` global via `defaultLocalStorage()`, whose acquisition is itself
 *   guarded so even a SecurityError on reading the property degrades to `null`
 *   (never throws). Injectable so tests can pass a fake, a throwing stub, or `null`.
 * @returns {{ load: () => number, save: (score:number) => void }} The guarded port:
 *   `load()` returns the stored high score as a non-negative integer (0 on any
 *   missing/corrupt/failing read); `save(score)` best-effort writes it, ignoring
 *   any failure.
 */
export function createHighScoreStorage(storage = defaultLocalStorage()) {
  return {
    /**
     * Read the persisted high score.
     * @returns {number} A finite integer > 0 parsed from the stored value, else 0
     *   — for a missing key, an empty/corrupt/non-numeric/zero/negative value, an
     *   absent store, or any throw during access.
     */
    load() {
      try {
        // A null/undefined store (node/SSR, or explicitly injected null) → 0.
        if (!storage) return 0;
        const raw = storage.getItem(HIGH_SCORE_STORAGE_KEY);
        // Missing key (getItem → null) or empty string → 0.
        if (raw == null) return 0;
        const value = Number.parseInt(raw, 10);
        // Only a finite, strictly-positive integer is a real high score; NaN,
        // Infinity, 0, and negatives all read as "nothing stored" → 0.
        return Number.isFinite(value) && value > 0 ? value : 0;
      } catch {
        // Blocked/throwing store (private mode, security policy) → no-op read.
        return 0;
      }
    },

    /**
     * Best-effort persist the high score. Any failure (absent store, quota,
     * security throw) is swallowed — persistence never breaks the run.
     * @param {number} score The value to persist (written as its string form).
     */
    save(score) {
      try {
        if (!storage) return;
        storage.setItem(HIGH_SCORE_STORAGE_KEY, String(score));
      } catch {
        // Quota exceeded / blocked store → silently ignore.
      }
    },
  };
}
