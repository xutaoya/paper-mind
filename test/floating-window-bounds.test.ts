import { assert } from "chai";
import {
  DEFAULT_FLOATING_WINDOW_HEIGHT,
  DEFAULT_FLOATING_WINDOW_WIDTH,
  MAX_FLOATING_WINDOW_HEIGHT,
  MAX_FLOATING_WINDOW_WIDTH,
  MIN_FLOATING_WINDOW_HEIGHT,
  MIN_FLOATING_WINDOW_WIDTH,
  normalizeFloatingWindowSize,
  resolveFloatingWindowSize,
  parseFloatingWindowPosition,
  fitFloatingWindowToScreen,
} from "../src/modules/ui/chat-panel/floatingWindowBounds.ts";

describe("floating window bounds", function () {
  it("returns defaults when saved size is missing or invalid", function () {
    assert.deepEqual(resolveFloatingWindowSize(undefined, undefined), {
      width: DEFAULT_FLOATING_WINDOW_WIDTH,
      height: DEFAULT_FLOATING_WINDOW_HEIGHT,
    });
    assert.deepEqual(resolveFloatingWindowSize(0, -10), {
      width: DEFAULT_FLOATING_WINDOW_WIDTH,
      height: DEFAULT_FLOATING_WINDOW_HEIGHT,
    });
  });

  it("clamps saved size into supported bounds", function () {
    assert.deepEqual(resolveFloatingWindowSize(900, 700), {
      width: 900,
      height: 700,
    });
    assert.deepEqual(resolveFloatingWindowSize(100, 200), {
      width: MIN_FLOATING_WINDOW_WIDTH,
      height: MIN_FLOATING_WINDOW_HEIGHT,
    });
    assert.deepEqual(resolveFloatingWindowSize(2000, 2000), {
      width: MAX_FLOATING_WINDOW_WIDTH,
      height: MAX_FLOATING_WINDOW_HEIGHT,
    });
  });

  it("rounds fractional resize values", function () {
    assert.deepEqual(normalizeFloatingWindowSize(501.6, 612.2), {
      width: 502,
      height: 612,
    });
  });

  it("accepts zero and negative monitor coordinates but rejects invalid positions", function () {
    assert.deepEqual(parseFloatingWindowPosition('{"left":0,"top":-200}'), {
      left: 0,
      top: -200,
    });
    for (const saved of [
      undefined,
      "",
      "invalid",
      "null",
      "{}",
      '{"left":"10","top":20}',
      '{"left":1e400,"top":10}',
    ]) {
      assert.isUndefined(parseFloatingWindowPosition(saved));
    }
  });

  it("keeps saved placement on a display to the left of the main monitor", function () {
    assert.deepEqual(
      fitFloatingWindowToScreen(
        { width: 420, height: 600 },
        { left: -1200, top: 100 },
        {
          left: -1440,
          top: 25,
          width: 1440,
          height: 875,
          cssToDesktopScale: 1,
        },
      ),
      { left: -1200, top: 100, width: 420, height: 600 },
    );
  });

  it("brings a disconnected-monitor placement back into the available work area", function () {
    assert.deepEqual(
      fitFloatingWindowToScreen(
        { width: 420, height: 600 },
        { left: 3000, top: -500 },
        { left: 0, top: 25, width: 1440, height: 875, cssToDesktopScale: 1 },
      ),
      { left: 1020, top: 25, width: 420, height: 600 },
    );
  });

  it("converts desktop coordinates to target-screen CSS pixels", function () {
    assert.deepEqual(
      fitFloatingWindowToScreen(
        { width: 500, height: 600 },
        { left: 2400, top: 150 },
        {
          left: 1920,
          top: 0,
          width: 1920,
          height: 1440,
          cssToDesktopScale: 1.5,
        },
      ),
      { left: 1600, top: 100, width: 500, height: 600 },
    );
  });

  it("fits large saved sizes onto a smaller screen", function () {
    assert.deepEqual(
      fitFloatingWindowToScreen(
        { width: 1200, height: 1000 },
        { left: 50, top: 50 },
        { left: 0, top: 25, width: 800, height: 575, cssToDesktopScale: 1 },
      ),
      { left: 0, top: 25, width: 800, height: 575 },
    );
  });
});
