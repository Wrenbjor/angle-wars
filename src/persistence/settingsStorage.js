import {
  SETTINGS_STORAGE_KEY,
  AUDIO_MUTED_DEFAULT,
  AUDIO_MASTER_VOLUME_DEFAULT,
  SETTINGS_FULLSCREEN_DEFAULT,
} from '../config/constants.js';
import { clampVolume } from '../audio/audioMix.js';

// settingsStorage — the single guarded browser-storage seam for the consolidated
// { muted, volume, fullscreen } settings object (Story 5.3).
//
// This ABSORBS the former audio-only audioSettingsStorage port: it is structurally
// identical (guarded defaultLocalStorage(), per-method try/catch, never throws) and
// REUSES the same localStorage key VALUE (SETTINGS_STORAGE_KEY ===
// 'angleWars.audioSettings'), so a previously stored {muted,volume} payload still
// parses and simply gains a defaulted `fullscreen` — a rename + superset, NOT a data
// migration. `localStorage` is a browser global absent from the `node` test env (see
// vite.config.js — environment: 'node', no jsdom) and can be present-but-blocked at
// runtime (private mode, quota, disabled cookies), so ALL access is funneled through
// this one factory whose every read/write is try/catch-wrapped to degrade to
// defaults / a no-op when the store is missing, blocked, or throwing.
//
// Persistence is strictly best-effort: it NEVER throws. A blocked store must not
// break the run or the render loop — `load()` yields the defaults, `save()` is
// silently ignored. Both SettingsScene (owns all three fields) and ArenaScene (which
// carries fullscreen through untouched) instantiate the real localStorage-backed
// port; unit tests inject a fake `{ getItem, setItem }` (or a throwing / null Storage).

// Guarded acquisition of the browser localStorage handle for the factory's default.
// Merely READING `globalThis.localStorage` throws a SecurityError in sandboxed
// iframes / storage-disabled browsers — the exact blocked-store case this module
// exists to survive. Because a default parameter is evaluated at call time OUTSIDE
// the per-method try/catch below, that read must be wrapped HERE, or
// `createSettingsStorage()` (called with no args in the scenes) would throw and crash
// the scene before the port is ever built. Returns null on any failure so the
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
 * @returns {{muted: boolean, volume: number, fullscreen: boolean}}
 * @private
 */
function defaults() {
  return {
    muted: AUDIO_MUTED_DEFAULT,
    volume: AUDIO_MASTER_VOLUME_DEFAULT,
    fullscreen: SETTINGS_FULLSCREEN_DEFAULT,
  };
}

/**
 * Create a guarded settings persistence port over a Storage-like object.
 *
 * @param {Storage|null} [storage=defaultLocalStorage()] A Storage-like object
 *   exposing `getItem(key)` / `setItem(key, value)`. Defaults to the browser
 *   `localStorage` global via `defaultLocalStorage()`, whose acquisition is itself
 *   guarded so even a SecurityError on reading the property degrades to `null`
 *   (never throws). Injectable so tests can pass a fake, a throwing stub, or `null`.
 * @returns {{ load: () => {muted:boolean, volume:number, fullscreen:boolean},
 *             save: (settings:{muted:boolean, volume:number, fullscreen:boolean}) => void }}
 *   The guarded port: `load()` returns the persisted `{muted, volume, fullscreen}`
 *   (defaults per field on any missing/corrupt/out-of-range/failing read, volume
 *   clamped to [0,1], and a legacy `{muted,volume}` payload accepted with fullscreen
 *   defaulted); `save({muted, volume, fullscreen})` best-effort writes the whole
 *   object as JSON, ignoring any failure.
 */
export function createSettingsStorage(storage = defaultLocalStorage()) {
  return {
    /**
     * Read the persisted settings.
     * @returns {{muted: boolean, volume: number, fullscreen: boolean}} The stored
     *   settings: `muted`/`fullscreen` coerced to their defaults unless they are real
     *   booleans, and `volume` clamped to [0,1] (default unless it is a finite
     *   number). Returns the defaults for a missing key, empty/corrupt/non-JSON value,
     *   absent store, or any throw. A legacy `{muted,volume}` payload loads with
     *   `fullscreen` defaulted (the key value is reused, so old data still parses).
     */
    load() {
      try {
        // A null/undefined store (node/SSR, or explicitly injected null) → defaults.
        if (!storage) return defaults();
        const raw = storage.getItem(SETTINGS_STORAGE_KEY);
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
        // fullscreen: only a real boolean counts (a legacy payload has no such field,
        // and any non-boolean is coerced to the default off).
        const fullscreen =
          typeof parsed.fullscreen === 'boolean'
            ? parsed.fullscreen
            : SETTINGS_FULLSCREEN_DEFAULT;
        return { muted, volume, fullscreen };
      } catch {
        // Blocked/throwing store or corrupt (non-JSON) value → defaults.
        return defaults();
      }
    },

    /**
     * Best-effort persist the whole settings object as JSON. Any failure (absent
     * store, quota, security throw) is swallowed — persistence never breaks the run.
     * Writing the WHOLE object each time means no writer clobbers another's field.
     * @param {{muted: boolean, volume: number, fullscreen: boolean}} settings
     */
    save(settings) {
      try {
        if (!storage) return;
        storage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify({
            muted: !!settings.muted,
            volume: clampVolume(settings.volume),
            fullscreen: !!settings.fullscreen,
          }),
        );
      } catch {
        // Quota exceeded / blocked store → silently ignore.
      }
    },
  };
}
