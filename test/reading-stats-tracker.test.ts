import { assert } from "chai";
import { isReadingTimeAccumulatingNow } from "../src/modules/reading-stats/ReadingStatsTracker.ts";
import { setReadingStatsPanelVisible } from "../src/modules/ui/chat-panel/ReadingStatsPanel.ts";

describe("reading tracker window focus", function () {
  let originalZotero: unknown;
  let originalServices: unknown;
  let mainFocus: boolean;
  let selectedType: string;
  let floatingFocus: boolean;
  let floatingURI: string;
  let standaloneFocus: boolean;
  let deleted: boolean;

  beforeEach(function () {
    originalZotero = (globalThis as any).Zotero;
    originalServices = (globalThis as any).Services;
    mainFocus = true;
    selectedType = "reader";
    floatingFocus = false;
    standaloneFocus = false;
    deleted = false;
    floatingURI = "chrome://paperchat/content/chatWindow.xhtml";
    const reader = { itemID: 42, tabID: "reader-tab" };
    const parent = {
      key: "PAPER001",
      libraryID: 1,
      get deleted() {
        return deleted;
      },
    };
    (globalThis as any).Zotero = {
      getMainWindow: () => ({
        document: { hasFocus: () => mainFocus },
        Zotero_Tabs: { selectedID: "reader-tab", selectedType },
      }),
      Reader: {
        getByTabID: () => reader,
        _readers: [
          reader,
          {
            itemID: 43,
            _window: { document: { hasFocus: () => standaloneFocus } },
          },
        ],
      },
      Items: {
        get: () => ({ isPDFAttachment: () => true, parentItem: parent }),
      },
    };
    (globalThis as any).Services = {
      wm: {
        getEnumerator: () => {
          let remaining = true;
          return {
            hasMoreElements: () => remaining,
            getNext: () => {
              remaining = false;
              return {
                document: {
                  documentURI: floatingURI,
                  hasFocus: () => floatingFocus,
                },
              };
            },
          };
        },
      },
    };
  });

  afterEach(function () {
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).Services = originalServices;
  });

  it("keeps timing while the PDF is active in the main window", function () {
    assert.isTrue(isReadingTimeAccumulatingNow());
  });

  it("keeps timing when focus moves from the PDF to PaperMind", function () {
    mainFocus = false;
    floatingFocus = true;
    assert.isTrue(isReadingTimeAccumulatingNow());
    floatingFocus = false;
    assert.isFalse(isReadingTimeAccumulatingNow());
  });

  it("pauses when another application or Zotero preferences has focus", function () {
    mainFocus = false;
    assert.isFalse(isReadingTimeAccumulatingNow());
    floatingFocus = true;
    floatingURI = "chrome://zotero/content/preferences/preferences.xhtml";
    assert.isFalse(isReadingTimeAccumulatingNow());
  });

  it("does not count a library tab or deleted paper from an open floating window", function () {
    mainFocus = false;
    floatingFocus = true;
    selectedType = "library";
    assert.isFalse(isReadingTimeAccumulatingNow());
    selectedType = "reader";
    deleted = true;
    assert.isFalse(isReadingTimeAccumulatingNow());
  });

  it("recognizes a focused standalone reader while the main library is inactive", function () {
    mainFocus = false;
    selectedType = "library";
    standaloneFocus = true;
    assert.isTrue(isReadingTimeAccumulatingNow());
  });

  it("updates an open stats panel on focus changes and stops polling when hidden", function () {
    const originalAddon = (globalThis as any).addon;
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (requests: any[]) =>
              requests.map(({ id }) => ({ value: id })),
          },
        },
      },
    };
    let tick!: () => void;
    let cleared = false;
    const doc = {
      defaultView: {
        setInterval: (callback: () => void) => {
          tick = callback;
          return 1;
        },
        clearInterval: () => {
          cleared = true;
        },
      },
      createElementNS: () => element(),
    };
    function element(): any {
      const node: any = {
        ownerDocument: doc,
        style: {},
        dataset: {},
        children: [],
        appendChild: (child: any) => node.children.push(child),
        setAttribute: () => {},
      };
      Object.defineProperty(node, "textContent", {
        set: (text: string) => {
          node.children = text ? [{ textContent: text }] : [];
        },
        get: () =>
          node.children.map((child: any) => child.textContent).join(""),
      });
      return node;
    }
    const subtitle = element();
    const panel = element();
    panel.isConnected = true;
    panel.querySelector = () => subtitle;
    const container = {
      querySelector: (selector: string) =>
        selector === "#chat-reading-stats-panel" ? panel : null,
    } as unknown as HTMLElement;
    try {
      setReadingStatsPanelVisible(container, true);
      assert.include(subtitle.textContent, "tracking-active");
      mainFocus = false;
      tick();
      assert.include(subtitle.textContent, "tracking-paused");
      floatingFocus = true;
      tick();
      assert.include(subtitle.textContent, "tracking-active");
      panel.dataset.statsView = "tokens";
      subtitle.removeAttribute = () => {};
      tick();
      assert.include(subtitle.textContent, "subtitle-tokens");
      setReadingStatsPanelVisible(container, false);
      assert.isTrue(cleared);
    } finally {
      (globalThis as any).addon = originalAddon;
    }
  });
});
