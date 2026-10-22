import { assert } from "chai";
import { config } from "../package.json";
import { getPref, setPref } from "../src/utils/prefs";
import {
  getFloatingWindowOpenFeatures,
  setupFloatingWindowBoundsPersistence,
} from "../src/modules/ui/chat-panel/FloatingWindowState";

describe("floating window placement in Zotero", function () {
  this.timeout(10000);
  let win: Window | undefined;
  let stop: (() => void) | undefined;
  let savedWidth: number;
  let savedHeight: number;
  let savedPosition: string;

  before(function () {
    savedWidth = getPref("floatingWindowWidth");
    savedHeight = getPref("floatingWindowHeight");
    savedPosition = getPref("floatingWindowPosition");
  });

  after(function () {
    stop?.();
    win?.close();
    setPref("floatingWindowWidth", savedWidth);
    setPref("floatingWindowHeight", savedHeight);
    setPref("floatingWindowPosition", savedPosition);
  });

  async function open() {
    const main = Zotero.getMainWindow();
    const features = getFloatingWindowOpenFeatures(main);
    assert.notInclude(features, "centerscreen");
    win = (main as any).openDialog(
      `chrome://${config.addonRef}/content/chatWindow.xhtml`,
      "paperchat-floating-placement-test",
      features,
    );
    await new Promise<void>((resolve) =>
      win!.addEventListener("load", () => resolve(), { once: true }),
    );
    await new Promise<void>((resolve) => win!.setTimeout(resolve, 100));
    stop = setupFloatingWindowBoundsPersistence(win!);
    return win!;
  }

  it("restores the exact outer size and moved position over repeated close/reopen cycles", async function () {
    setPref("floatingWindowWidth", 500);
    setPref("floatingWindowHeight", 650);
    setPref("floatingWindowPosition", "");
    const first = await open();
    const screen = first.screen;
    first.resizeTo(520, 700);
    first.moveTo(screen.availLeft + 80, screen.availTop + 70);
    await new Promise<void>((resolve) => first.setTimeout(resolve, 100));
    const expected = {
      width: first.outerWidth,
      height: first.outerHeight,
      left: first.screenX,
      top: first.screenY,
    };
    for (let i = 0; i < 2; i++) {
      if (i > 0) stop!();
      stop = undefined;
      win!.close();
      win = undefined;
      const next = await open();
      try {
        assert.closeTo(next.outerWidth, expected.width, 1, "outer width");
        assert.closeTo(next.outerHeight, expected.height, 1, "outer height");
        assert.closeTo(next.screenX, expected.left, 1, "screen X");
        assert.closeTo(next.screenY, expected.top, 1, "screen Y");
      } catch (error) {
        const failure = new Error(String(error));
        Object.defineProperty(failure, "message", {
          value: String(error),
          enumerable: true,
        });
        throw failure;
      }
    }
  });
});
