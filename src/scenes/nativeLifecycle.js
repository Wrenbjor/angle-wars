// nativeLifecycle — pure decisions + guarded wiring for the native app lifecycle
// (Story 7.5).
//
// The game runs inside the Capacitor WebView but must behave like a native app:
// backgrounding it must auto-pause an active run (so the player never dies while
// away — FR23), the Android hardware back button must pause/resume or safely
// background (never an abrupt close), and the screen-wake decision must track
// active play only.
//
// The three `decide*` functions are PURE (no Phaser, no `@capacitor/*`, no host
// global) so every row of the I/O matrix is headlessly unit-testable. The single
// impure export — wireNativeLifecycle — is the guarded boundary that registers the
// Capacitor `App` (`appStateChange` / `backButton`) and `document`
// (`visibilitychange`) listeners, routes each event through the pure decisions to
// the injected `controller`, and returns an unsubscribe. The plugin object and the
// document are INJECTED by main.js (the untestable adapter layer, like Phaser), so
// this module imports no `@capacitor/*` package.

/**
 * Decide whether a background / focus-loss event should force-pause the run. True
 * only while a run is actively playing (run active AND not already paused); a
 * game-over, title, or already-paused state is folded into `runActive:false` /
 * `paused:true` by the caller and yields false (a no-op). This is force-pause, never
 * a toggle — foreground does NOT auto-resume (the run resumes via the existing pause
 * flag when the player dismisses it), so they are never dropped straight into danger.
 * @param {{runActive:boolean, paused:boolean}} state
 * @returns {boolean} true → force-pause the run; false → no-op.
 */
export function decideBackgroundPause({ runActive, paused } = {}) {
  return !!(runActive && !paused);
}

/**
 * Decide the Android hardware back-button action. During a run it pauses (playing)
 * or resumes (paused) via the existing togglePause flow; otherwise (title / settings
 * / game-over) it minimizes — a safe, reversible, state-preserving background (like
 * Home), NEVER an abrupt close. `App.exitApp()` is never in the vocabulary.
 * @param {{runActive:boolean, paused:boolean}} state
 * @returns {'pause'|'resume'|'minimize'}
 */
export function decideBackButton({ runActive, paused } = {}) {
  if (runActive) return paused ? 'resume' : 'pause';
  return 'minimize';
}

/**
 * Decide whether the screen wake lock should be held. Desired only while the player
 * is actively playing: run active AND not paused AND not game-over. Paused, at
 * game-over, or outside the arena releases the lock so the display can sleep. NOT
 * gated by Reduced Motion (that flag governs motion feel, not screen sleep).
 * @param {{runActive:boolean, paused:boolean, gameOver:boolean}} state
 * @returns {boolean} true → hold the wake lock; false → release it.
 */
export function decideKeepAwake({ runActive, paused, gameOver } = {}) {
  return !!(runActive && !paused && !gameOver);
}

/**
 * Remove a Capacitor listener handle. `App.addListener` returns a
 * `Promise<PluginListenerHandle>` on a real device but a test fake may return the
 * handle synchronously, so accept either. Fail-safe: null / absent `.remove` / a
 * throw all degrade to a no-op.
 * @param {unknown} handle
 */
function removeHandle(handle) {
  try {
    if (!handle) return;
    if (typeof handle.then === 'function') {
      handle
        .then((h) => {
          if (h && typeof h.remove === 'function') h.remove();
        })
        .catch(() => {});
    } else if (typeof handle.remove === 'function') {
      handle.remove();
    }
  } catch {
    // never throw
  }
}

/**
 * Wire the native lifecycle: register the Capacitor `App` `appStateChange` /
 * `backButton` listeners and the `document` `visibilitychange` listener, routing
 * each through the pure decisions above to the injected `controller`. Every step is
 * guarded — a missing `app`/`doc`/method, or a throwing callback body, is skipped
 * and never throws (mirroring the mobileLayout boundaries). Returns an unsubscribe
 * that removes every listener it registered.
 *
 * The `controller` is the adapter over the live scene (built in main.js), exposing:
 *   - `isRunActive()` → boolean (arena active AND not game-over)
 *   - `isPaused()`    → boolean
 *   - `forcePause()`  → force the run paused (background auto-pause)
 *   - `pause()` / `resume()` → toggle pause via the existing flow (back button)
 *   - `minimize()`    → `App.minimizeApp()` safe background (back button at root)
 *
 * @param {{app?:object, doc?:Document, controller?:object}} deps
 * @returns {() => void} unsubscribe — removes every registered listener.
 */
export function wireNativeLifecycle({ app, doc, controller } = {}) {
  const cleanups = [];

  // Route a background / focus-loss signal to the force-pause decision.
  const onBackground = () => {
    try {
      if (
        decideBackgroundPause({
          runActive: controller.isRunActive(),
          paused: controller.isPaused(),
        })
      ) {
        controller.forcePause();
      }
    } catch {
      // never throw out of a native/DOM callback (missing controller method, etc.)
    }
  };

  // Capacitor App: appStateChange (isActive:false = backgrounded) + the hardware
  // back button. addListener is feature-detected and its registration guarded.
  if (app && typeof app.addListener === 'function') {
    try {
      const stateHandle = app.addListener('appStateChange', (state) => {
        if (state && state.isActive === false) onBackground();
      });
      cleanups.push(() => removeHandle(stateHandle));
    } catch {
      // addListener threw — skip this listener, never throw
    }
    try {
      const backHandle = app.addListener('backButton', () => {
        try {
          const action = decideBackButton({
            runActive: controller.isRunActive(),
            paused: controller.isPaused(),
          });
          if (action === 'pause') controller.pause();
          else if (action === 'resume') controller.resume();
          else controller.minimize();
        } catch {
          // never throw out of the native callback
        }
      });
      cleanups.push(() => removeHandle(backHandle));
    } catch {
      // skip, never throw
    }
  }

  // document visibilitychange: the WebView also loses focus / hides here (a second
  // background signal beside appStateChange). Both route to the same force-pause.
  if (doc && typeof doc.addEventListener === 'function') {
    const onVisibility = () => {
      if (doc.hidden) onBackground();
    };
    try {
      doc.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => {
        try {
          doc.removeEventListener('visibilitychange', onVisibility);
        } catch {
          // never throw
        }
      });
    } catch {
      // skip, never throw
    }
  }

  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // never throw
      }
    }
    cleanups.length = 0;
  };
}

/**
 * Build the native-lifecycle controller: the thin adapter over the live game that
 * wireNativeLifecycle drives. It holds the real FR23 branch logic (resolve the live
 * ArenaScene, compute run-active, the guarded force-pause, back-button pause/resume,
 * and the safe minimize) so it is unit-testable against a fake game + scene, not just
 * regex-pinned in main.js. Pause/resume/force-pause ALL route through the scene's
 * `setPaused(...)` so the render-juice settle runs (a mid-bomb background/back pause
 * never freezes a near-white flash / held camera offset on the PAUSED overlay).
 *
 * @param {{scene:{getScene:(k:string)=>object, isActive:(k:string)=>boolean}}} game
 *   The Phaser.Game (or a fake exposing the same `scene.getScene`/`scene.isActive`).
 * @param {{minimizeApp?:()=>unknown}} App The Capacitor `App` plugin (injected).
 * @returns {{isRunActive:()=>boolean, isPaused:()=>boolean, forcePause:()=>void,
 *   pause:()=>void, resume:()=>void, minimize:()=>void}}
 */
export function makeLifecycleController(game, App) {
  // Resolve the live, ACTIVE ArenaScene instance (or null when the run is not on
  // screen — title / settings / not yet started).
  const arena = () => {
    const scene = game.scene.getScene('ArenaScene');
    return scene && game.scene.isActive('ArenaScene') ? scene : null;
  };
  return {
    // A run is "active" only while the arena is on screen AND not game-over (game-over
    // owns its own freeze/restart flow — it is never auto-paused or back-paused).
    isRunActive() {
      const s = arena();
      return !!(s && s.playerState && !s.playerState.gameOver);
    },
    isPaused() {
      const s = arena();
      return !!(s && s._paused);
    },
    // Background auto-pause: FORCE the run paused (never a toggle). Guarded so a
    // game-over / already-paused state is a no-op; foreground never auto-resumes.
    forcePause() {
      const s = arena();
      if (s && s.playerState && !s.playerState.gameOver && !s._paused) {
        s.setPaused(true);
      }
    },
    // Back button in a run: explicit pause (guarded off game-over) / resume.
    pause() {
      const s = arena();
      if (s && s.playerState && !s.playerState.gameOver) s.setPaused(true);
    },
    resume() {
      const s = arena();
      if (s) s.setPaused(false);
    },
    // Back button at the root (title / settings / game-over): safe background, NEVER a
    // close. App.minimizeApp() backgrounds the app (like Home) — reversible and
    // state-preserving. The app is never abruptly closed.
    minimize() {
      if (App && typeof App.minimizeApp === 'function') {
        try {
          App.minimizeApp();
        } catch {
          // never throw — no-op on an unsupported host
        }
      }
    },
  };
}
