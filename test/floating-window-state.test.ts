import { assert } from "chai";
import { config } from "../package.json";
import {
  getSavedFloatingWindowBounds,
  persistFloatingWindowBounds,
  setupFloatingWindowBoundsPersistence,
} from "../src/modules/ui/chat-panel/FloatingWindowState.ts";

describe("floating window state persistence", function () {
  const runtime = globalThis as Record<string, any>;
  let previousZotero: unknown;
  let previousComponents: unknown;
  let prefs: Map<string, unknown>;
  let win: any;
  let listeners: Map<string, () => void>;
  let screenRequests: number[][];
  const key = (name: string) => `${config.prefsPrefix}.${name}`;

  beforeEach(function () {
    previousZotero = runtime.Zotero;
    previousComponents = runtime.Components;
    prefs = new Map();
    runtime.Zotero = {
      Prefs: {
        get: (name: string) => prefs.get(name),
        set: (name: string, value: unknown) => prefs.set(name, value),
      },
    };
    screenRequests = [];
    runtime.Components = {
      interfaces: {},
      classes: {
        "@mozilla.org/gfx/screenmanager;1": {
          getService: () => ({
            screenForRect: (...args: number[]) => {
              screenRequests.push(args);
              return {
                defaultCSSScaleFactor: 2,
                contentsScaleFactor: 2,
                GetAvailRectDisplayPix: (...out: Array<{ value: number }>) =>
                  [0, 25, 1440, 875].forEach(
                    (value, i) => (out[i].value = value),
                  ),
              };
            },
          }),
        },
      },
    };
    listeners = new Map();
    win = {
      outerWidth: 520,
      outerHeight: 680,
      screenX: 120,
      screenY: 80,
      devicePixelRatio: 2,
      desktopToDeviceScale: 2,
      windowState: 3,
      STATE_NORMAL: 3,
      fullScreen: false,
      screen: {
        availLeft: 0,
        availTop: 25,
        availWidth: 1440,
        availHeight: 875,
      },
      addEventListener: (name: string, callback: () => void) =>
        listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
  });

  afterEach(function () {
    runtime.Zotero = previousZotero;
    runtime.Components = previousComponents;
  });

  it("saves dimensions and final position even after moving without resizing", function () {
    const stop = setupFloatingWindowBoundsPersistence(win);
    win.screenX = 650;
    win.screenY = 140;
    stop();
    assert.equal(prefs.get(key("floatingWindowWidth")), 520);
    assert.equal(prefs.get(key("floatingWindowHeight")), 680);
    assert.equal(
      prefs.get(key("floatingWindowPosition")),
      '{"left":650,"top":140}',
    );
    assert.deepEqual(getSavedFloatingWindowBounds(win), {
      width: 520,
      height: 680,
      left: 650,
      top: 140,
    });
    assert.isEmpty([...listeners]);
    win.screenX = 10;
    stop();
    assert.equal(
      prefs.get(key("floatingWindowPosition")),
      '{"left":650,"top":140}',
    );
  });

  it("centers only the first opening or a malformed position", function () {
    win.outerWidth = 1200;
    win.outerHeight = 850;
    assert.deepEqual(getSavedFloatingWindowBounds(win), {
      width: 420,
      height: 600,
      left: 510,
      top: 205,
    });
    prefs.set(key("floatingWindowPosition"), "broken-json");
    assert.deepEqual(getSavedFloatingWindowBounds(win), {
      width: 420,
      height: 600,
      left: 510,
      top: 205,
    });
  });

  it("stores desktop pixels and locates the saved display without using the main window position", function () {
    win.desktopToDeviceScale = 1;
    persistFloatingWindowBounds(win);
    assert.equal(
      prefs.get(key("floatingWindowPosition")),
      '{"left":240,"top":160}',
    );
    win.screenX = 900;
    getSavedFloatingWindowBounds(win);
    assert.deepEqual(screenRequests, [[240, 160, 1, 1]]);
  });

  it("does not overwrite normal placement with minimized, maximized or fullscreen geometry", function () {
    persistFloatingWindowBounds(win);
    const saved = [...prefs];
    for (const state of [1, 2, 4]) {
      win.windowState = state;
      win.screenX = -32000;
      persistFloatingWindowBounds(win);
      assert.deepEqual([...prefs], saved);
    }
    win.windowState = 3;
    win.fullScreen = true;
    persistFloatingWindowBounds(win);
    assert.deepEqual([...prefs], saved);
  });

  it("flushes a pending resize save once at close and removes its timer", async function () {
    const stop = setupFloatingWindowBoundsPersistence(win);
    listeners.get("resize")!();
    stop();
    win.screenX = 999;
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(
      prefs.get(key("floatingWindowPosition")),
      '{"left":120,"top":80}',
    );
  });

  it("saves before native geometry disappears during unload", function () {
    setupFloatingWindowBoundsPersistence(win);
    win.screenX = 700;
    win.screenY = 120;
    listeners.get("beforeunload")!();
    win.outerWidth = 0;
    win.outerHeight = 0;
    listeners.get("unload")!();
    assert.equal(prefs.get(key("floatingWindowWidth")), 520);
    assert.equal(
      prefs.get(key("floatingWindowPosition")),
      '{"left":700,"top":120}',
    );
    assert.isEmpty([...listeners]);
  });

  it("falls back to the main monitor work area if native screen lookup is unavailable", function () {
    runtime.Components = undefined;
    prefs.set(key("floatingWindowPosition"), '{"left":3000,"top":2000}');
    assert.deepEqual(getSavedFloatingWindowBounds(win), {
      width: 420,
      height: 600,
      left: 1020,
      top: 300,
    });
  });

  it("does not save invalid closing-window geometry", function () {
    for (const invalid of [0, NaN, Infinity]) {
      win.outerWidth = invalid;
      persistFloatingWindowBounds(win);
    }
    assert.isEmpty([...prefs]);
  });
});
