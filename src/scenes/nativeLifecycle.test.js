import { describe, it, expect, vi } from 'vitest';
import {
  decideBackgroundPause,
  decideBackButton,
  decideKeepAwake,
  wireNativeLifecycle,
  makeLifecycleController,
} from './nativeLifecycle.js';

// nativeLifecycle is the pure-decision + guarded-wiring seam (Story 7.5). The three
// decide* functions are pure (every I/O-matrix row below); wireNativeLifecycle is the
// guarded boundary that registers the Capacitor App + document listeners, routes each
// through the decisions to the injected controller, and returns an unsubscribe. Its
// rows cover the routing, the unsubscribe, and the never-throws fail-safety (absent
// app/doc, throwing controller methods).

describe('nativeLifecycle — decideBackgroundPause', () => {
  it('force-pauses only a running, non-paused run', () => {
    expect(decideBackgroundPause({ runActive: true, paused: false })).toBe(true);
  });
  it('is a no-op at title/game-over (runActive false) or already paused', () => {
    expect(decideBackgroundPause({ runActive: false, paused: false })).toBe(false);
    expect(decideBackgroundPause({ runActive: true, paused: true })).toBe(false);
    expect(decideBackgroundPause({ runActive: false, paused: true })).toBe(false);
  });
});

describe('nativeLifecycle — decideBackButton', () => {
  it('pauses while playing, resumes while paused (during a run)', () => {
    expect(decideBackButton({ runActive: true, paused: false })).toBe('pause');
    expect(decideBackButton({ runActive: true, paused: true })).toBe('resume');
  });
  it('minimizes when not in a run (title/settings/game-over), regardless of paused', () => {
    expect(decideBackButton({ runActive: false, paused: false })).toBe('minimize');
    expect(decideBackButton({ runActive: false, paused: true })).toBe('minimize');
  });
});

describe('nativeLifecycle — decideKeepAwake', () => {
  it('is desired only during active, non-paused, non-game-over play', () => {
    expect(decideKeepAwake({ runActive: true, paused: false, gameOver: false })).toBe(true);
  });
  it('releases when run-inactive, paused, or at game-over', () => {
    expect(decideKeepAwake({ runActive: false, paused: false, gameOver: false })).toBe(false);
    expect(decideKeepAwake({ runActive: true, paused: true, gameOver: false })).toBe(false);
    expect(decideKeepAwake({ runActive: true, paused: false, gameOver: true })).toBe(false);
  });
});

// --- wireNativeLifecycle fakes -----------------------------------------------

// Capacitor App stand-in: addListener captures the callback + returns a removable
// handle (synchronous here; the boundary also accepts a promise-of-handle).
function fakeApp() {
  const listeners = {};
  const handles = {};
  return {
    addListener: vi.fn((event, cb) => {
      listeners[event] = cb;
      const handle = { remove: vi.fn() };
      handles[event] = handle;
      return handle;
    }),
    _emit(event, payload) {
      if (listeners[event]) listeners[event](payload);
    },
    _handle(event) {
      return handles[event];
    },
  };
}

// document stand-in: addEventListener captures the visibilitychange handler; `hidden`
// is toggled by the test before emitting.
function fakeDoc() {
  const listeners = {};
  return {
    hidden: false,
    addEventListener: vi.fn((event, cb) => {
      listeners[event] = cb;
    }),
    removeEventListener: vi.fn(),
    _emit(event) {
      if (listeners[event]) listeners[event]();
    },
  };
}

function fakeController(overrides = {}) {
  return {
    isRunActive: vi.fn(() => true),
    isPaused: vi.fn(() => false),
    forcePause: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    minimize: vi.fn(),
    ...overrides,
  };
}

describe('nativeLifecycle — wireNativeLifecycle (background auto-pause)', () => {
  it('force-pauses on appStateChange isActive:false while playing', () => {
    const app = fakeApp();
    const controller = fakeController();
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    app._emit('appStateChange', { isActive: false });
    expect(controller.forcePause).toHaveBeenCalledTimes(1);
  });

  it('does NOT pause on appStateChange isActive:true (foreground)', () => {
    const app = fakeApp();
    const controller = fakeController();
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    app._emit('appStateChange', { isActive: true });
    expect(controller.forcePause).not.toHaveBeenCalled();
  });

  it('does NOT pause on background when already paused (decideBackgroundPause false)', () => {
    const app = fakeApp();
    const controller = fakeController({ isPaused: vi.fn(() => true) });
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    app._emit('appStateChange', { isActive: false });
    expect(controller.forcePause).not.toHaveBeenCalled();
  });

  it('force-pauses on document visibilitychange when hidden', () => {
    const doc = fakeDoc();
    const controller = fakeController();
    wireNativeLifecycle({ app: fakeApp(), doc, controller });

    doc.hidden = true;
    doc._emit('visibilitychange');
    expect(controller.forcePause).toHaveBeenCalledTimes(1);
  });

  it('ignores a visibilitychange that leaves the document visible', () => {
    const doc = fakeDoc();
    const controller = fakeController();
    wireNativeLifecycle({ app: fakeApp(), doc, controller });

    doc.hidden = false;
    doc._emit('visibilitychange');
    expect(controller.forcePause).not.toHaveBeenCalled();
  });
});

describe('nativeLifecycle — wireNativeLifecycle (back button)', () => {
  it('routes the back button to pause while playing', () => {
    const app = fakeApp();
    const controller = fakeController();
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    app._emit('backButton', {});
    expect(controller.pause).toHaveBeenCalledTimes(1);
    expect(controller.resume).not.toHaveBeenCalled();
    expect(controller.minimize).not.toHaveBeenCalled();
  });

  it('routes the back button to resume while paused', () => {
    const app = fakeApp();
    const controller = fakeController({ isPaused: vi.fn(() => true) });
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    app._emit('backButton', {});
    expect(controller.resume).toHaveBeenCalledTimes(1);
    expect(controller.pause).not.toHaveBeenCalled();
  });

  it('routes the back button to minimize outside a run (never a close)', () => {
    const app = fakeApp();
    const controller = fakeController({ isRunActive: vi.fn(() => false) });
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    app._emit('backButton', {});
    expect(controller.minimize).toHaveBeenCalledTimes(1);
    expect(controller.pause).not.toHaveBeenCalled();
    expect(controller.resume).not.toHaveBeenCalled();
  });
});

describe('nativeLifecycle — wireNativeLifecycle (unsubscribe + fail-safety)', () => {
  it('unsubscribe removes every registered listener', () => {
    const app = fakeApp();
    const doc = fakeDoc();
    const controller = fakeController();
    const unsubscribe = wireNativeLifecycle({ app, doc, controller });

    unsubscribe();

    expect(app._handle('appStateChange').remove).toHaveBeenCalledTimes(1);
    expect(app._handle('backButton').remove).toHaveBeenCalledTimes(1);
    expect(doc.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
  });

  it('handles a promise-returning addListener for the unsubscribe', async () => {
    const removed = vi.fn();
    const app = {
      addListener: vi.fn(() => Promise.resolve({ remove: removed })),
    };
    const unsubscribe = wireNativeLifecycle({ app, doc: fakeDoc(), controller: fakeController() });
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(removed).toHaveBeenCalled();
  });

  it('never throws when app and doc are absent, and its unsubscribe is a no-op', () => {
    let unsubscribe;
    expect(() => {
      unsubscribe = wireNativeLifecycle({ controller: fakeController() });
    }).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('never throws when handling with no args at all', () => {
    expect(() => wireNativeLifecycle()).not.toThrow();
  });

  it('swallows a throwing controller method inside a callback (never throws)', () => {
    const app = fakeApp();
    const controller = fakeController({
      isRunActive: vi.fn(() => {
        throw new Error('scene gone');
      }),
    });
    wireNativeLifecycle({ app, doc: fakeDoc(), controller });

    expect(() => app._emit('appStateChange', { isActive: false })).not.toThrow();
    expect(() => app._emit('backButton', {})).not.toThrow();
  });
});

// --- makeLifecycleController fakes -------------------------------------------

// A fake scene exposing the surface the controller reads/writes: the paused flag,
// playerState.gameOver, and the setPaused entry point (spied; updates _paused).
function fakeScene({ gameOver = false, paused = false } = {}) {
  return {
    _paused: paused,
    playerState: { gameOver },
    setPaused: vi.fn(function setPaused(p) {
      this._paused = p;
    }),
  };
}

// A fake Phaser.Game exposing scene.getScene / scene.isActive.
function fakeGame(scene, { active = true } = {}) {
  return {
    scene: {
      getScene: vi.fn(() => scene),
      isActive: vi.fn(() => active),
    },
  };
}

function fakeAppPlugin(overrides = {}) {
  return { minimizeApp: vi.fn(), ...overrides };
}

describe('nativeLifecycle — makeLifecycleController (FR23 branch logic)', () => {
  it('isRunActive is true for an active, non-game-over scene', () => {
    const c = makeLifecycleController(fakeGame(fakeScene()), fakeAppPlugin());
    expect(c.isRunActive()).toBe(true);
  });

  it('isRunActive is false at game-over', () => {
    const c = makeLifecycleController(fakeGame(fakeScene({ gameOver: true })), fakeAppPlugin());
    expect(c.isRunActive()).toBe(false);
  });

  it('isRunActive is false when the scene is not active', () => {
    const c = makeLifecycleController(fakeGame(fakeScene(), { active: false }), fakeAppPlugin());
    expect(c.isRunActive()).toBe(false);
  });

  it('isRunActive is false when no ArenaScene is resolved', () => {
    const c = makeLifecycleController(fakeGame(null), fakeAppPlugin());
    expect(c.isRunActive()).toBe(false);
  });

  it('isPaused reflects the scene _paused flag', () => {
    expect(makeLifecycleController(fakeGame(fakeScene({ paused: true })), fakeAppPlugin()).isPaused()).toBe(true);
    expect(makeLifecycleController(fakeGame(fakeScene({ paused: false })), fakeAppPlugin()).isPaused()).toBe(false);
  });

  it('forcePause force-pauses an active, non-paused run via setPaused(true)', () => {
    const scene = fakeScene();
    makeLifecycleController(fakeGame(scene), fakeAppPlugin()).forcePause();
    expect(scene.setPaused).toHaveBeenCalledWith(true);
    expect(scene._paused).toBe(true);
  });

  it('forcePause is a no-op at game-over', () => {
    const scene = fakeScene({ gameOver: true });
    makeLifecycleController(fakeGame(scene), fakeAppPlugin()).forcePause();
    expect(scene.setPaused).not.toHaveBeenCalled();
  });

  it('forcePause is a no-op when already paused', () => {
    const scene = fakeScene({ paused: true });
    makeLifecycleController(fakeGame(scene), fakeAppPlugin()).forcePause();
    expect(scene.setPaused).not.toHaveBeenCalled();
  });

  it('pause() sets paused true and is guarded off game-over', () => {
    const scene = fakeScene();
    makeLifecycleController(fakeGame(scene), fakeAppPlugin()).pause();
    expect(scene.setPaused).toHaveBeenCalledWith(true);

    const over = fakeScene({ gameOver: true });
    makeLifecycleController(fakeGame(over), fakeAppPlugin()).pause();
    expect(over.setPaused).not.toHaveBeenCalled();
  });

  it('resume() sets paused false', () => {
    const scene = fakeScene({ paused: true });
    makeLifecycleController(fakeGame(scene), fakeAppPlugin()).resume();
    expect(scene.setPaused).toHaveBeenCalledWith(false);
    expect(scene._paused).toBe(false);
  });

  it('minimize calls App.minimizeApp and NEVER exitApp', () => {
    const app = fakeAppPlugin({ exitApp: vi.fn() });
    makeLifecycleController(fakeGame(fakeScene()), app).minimize();
    expect(app.minimizeApp).toHaveBeenCalledTimes(1);
    expect(app.exitApp).not.toHaveBeenCalled();
  });

  it('minimize is guarded (never throws) when App / minimizeApp is absent', () => {
    expect(() => makeLifecycleController(fakeGame(fakeScene()), null).minimize()).not.toThrow();
    expect(() => makeLifecycleController(fakeGame(fakeScene()), {}).minimize()).not.toThrow();
  });
});
