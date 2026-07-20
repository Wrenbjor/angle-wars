import {
  AUDIO_SETTINGS_STORAGE_KEY,
  AUDIO_MUTED_DEFAULT,
  AUDIO_MASTER_VOLUME_DEFAULT,
} from '../config/constants.js';
import { clampVolume } from '../audio/audioMix.js';

// audioSettingsStorage — the guarded browser-storage seam for {muted, volume}
// (Story 4.5). Mirrors highScoreStorage exactly: `localStorage` is a browser global
// absent from the `node` test env (see vite.config.js — environment: 'node', no
// jsdom) and can be present-but-blocked at runtime (private mode, quota, disabled
// cookies), so ALL access is funneled through this one tiny factory whose every
// read/write is try/catch-wrapped to degrade to a no-op / defaults when the store is
// missing, blocked, or throwing.
//
// Persistence is strictly best-effort: it NEVER throws. A blocked store must not
// break the run or the render loop — `load()` yields the defaults, `save()` is
// silently ignored. ArenaScene instantiates the real localStorage-backed port; unit
// tests inject a fake `{ getItem, setItem }` (or a throwing / null Storage).
//
// This is an interim, isolated port with its OWN key — Story 5.3 owns the
// consolidated settings model and will absorb it; keeping it tiny makes that later
// consolidation a move, not a rewrite.

// Guarded acquisition of the browser localStorage handle for the factory's default.
// Merely READING `globalThis.localStorage` throws a SecurityError in sandboxed
// iframes / storage-disabled browsers — the exact blocked-store case this module
// exists to survive. Because a default parameter is evaluated at call time OUTSIDE
// the per-method try/catch below, that read must be wrapped HERE, or
// `createAudioSettingsStorage()` (called with no args in ArenaScene) would throw and
// crash the scene before the port is ever built. Returns null on any failure so the
// `if (!storage)` guards then degrade to defaults / a no-op.
function defaultLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The default settings — used on a missing key, corrupt data, or a blocked/absent
 * store. Rebuilt per call so the returned object is never shared/mutated.
 * @returns {{muted: boolean, volume: number}}
 * @private
 */
function defaults() {
  return { muted: AUDIO_MUTED_DEFAULT, volume: AUDIO_MASTER_VOLUME_DEFAULT };
}

/**
 * Create a guarded audio-settings persistence port over a Storage-like object.
 *
 * @param {Storage|null} [storage=defaultLocalStorage()] A Storage-like object
 *   exposing `getItem(key)` / `setItem(key, value)`. Defaults to the browser
 *   `localStorage` global via `defaultLocalStorage()`, whose acquisition is itself
 *   guarded so even a SecurityError on reading the property degrades to `null`
 *   (never throws). Injectable so tests can pass a fake, a throwing stub, or `null`.
 * @returns {{ load: () => {muted:boolean, volume:number},
 *             save: (settings:{muted:boolean, volume:number}) => void }} The guarded
 *   port: `load()` returns the persisted `{muted, volume}` (defaults on any
 *   missing/corrupt/out-of-range/failing read, volume clamped to [0,1]);
 *   `save({muted, volume})` best-effort writes it as JSON, ignoring any failure.
 */
export function createAudioSettingsStorage(storage = defaultLocalStorage()) {
  return {
    /**
     * Read the persisted audio settings.
     * @returns {{muted: boolean, volume: number}} The stored settings, with `muted`
     *   coerced to the default unless it is a real boolean and `volume` clamped to
     *   [0,1] (default unless it is a finite number). Returns the defaults for a
     *   missing key, empty/corrupt/non-JSON value, absent store, or any throw.
     */
    load() {
      try {
        // A null/undefined store (node/SSR, or explicitly injected null) → defaults.
        if (!storage) return defaults();
        const raw = storage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
        // Missing key (getItem → null) or empty string → defaults.
        if (raw == null || raw === '') return defaults();
        const parsed = JSON.parse(raw); // throws on non-JSON → caught below
        if (!parsed || typeof parsed !== 'object') return defaults();
        // muted: only a real boolean counts; anything else falls back to the default.
        const muted =
          typeof parsed.muted === 'boolean' ? parsed.muted : AUDIO_MUTED_DEFAULT;
        // volume: only a finite number counts (clamped to [0,1] so an out-of-range
        // stored value is corrected rather than defaulted); else the default.
        const volume = Number.isFinite(parsed.volume)
          ? clampVolume(parsed.volume)
          : AUDIO_MASTER_VOLUME_DEFAULT;
        return { muted, volume };
      } catch {
        // Blocked/throwing store or corrupt (non-JSON) value → defaults.
        return defaults();
      }
    },

    /**
     * Best-effort persist the audio settings as JSON. Any failure (absent store,
     * quota, security throw) is swallowed — persistence never breaks the run.
     * @param {{muted: boolean, volume: number}} settings The settings to persist.
     */
    save(settings) {
      try {
        if (!storage) return;
        storage.setItem(
          AUDIO_SETTINGS_STORAGE_KEY,
          JSON.stringify({ muted: !!settings.muted, volume: clampVolume(settings.volume) }),
        );
      } catch {
        // Quota exceeded / blocked store → silently ignore.
      }
    },
  };
}
