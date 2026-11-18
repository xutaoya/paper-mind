import { assert } from "chai";
import { config } from "../package.json";
import { getBookmarkService } from "../src/modules/bookmarks";
import {
  createBookmarkManagerPanel,
  refreshBookmarkManagerPanel,
  setBookmarkManagerVisible,
} from "../src/modules/ui/chat-panel/BookmarkManagerPanel";
import { createElement } from "../src/modules/ui/chat-panel/ChatPanelBuilder";
import { lightTheme } from "../src/modules/ui/chat-panel/ChatPanelTheme";

describe("bookmark list in Zotero", function () {
  it("fits the visible lines of a title and preview inside the open button", async function () {
    const win = Zotero.getMainWindow();
    const doc = win.document;
    const host = createElement(doc, "div", {
      position: "fixed",
      width: "230px",
      height: "300px",
      top: "0",
      left: "0",
    });
    const addonDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "addon",
    );
    const service = getBookmarkService();
    const { listFolders, listBookmarks } = service;

    Object.defineProperty(globalThis, "addon", {
      configurable: true,
      get: () => Zotero[config.addonInstance],
    });
    service.listFolders = async () => [];
    service.listBookmarks = async () => [
      {
        id: "layout-bookmark",
        libraryId: Zotero.Libraries.userLibraryID,
        folderId: null,
        type: "message",
        title: "跨尺度特征对齐与语义先验如何引导红外和可见光图像融合",
        content: "多尺度特征对齐损失使用余弦相似度约束不同尺度的中间特征。",
        sessionId: "layout-session",
        messageId: "layout-message",
        itemKey: null,
        itemLibraryId: null,
        pageUrl: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    try {
      const actions = { onOpenBookmark: () => {} };
      host.append(createBookmarkManagerPanel(doc, lightTheme, actions));
      doc.documentElement.appendChild(host);
      setBookmarkManagerVisible(host, true);
      await refreshBookmarkManagerPanel(host, lightTheme, actions);

      const button = host.querySelector(".paperchat-bookmark-item-open")!;
      for (const selector of [
        ".paperchat-bookmark-item-title",
        ".paperchat-bookmark-item-preview",
      ]) {
        const text = button.querySelector(selector)!;
        const rect = text.getBoundingClientRect();
        const lineHeight = parseFloat(win.getComputedStyle(text).lineHeight);
        assert.isAtLeast(rect.height, 2 * lineHeight - 1, selector);
        assert.isAtMost(rect.bottom, button.getBoundingClientRect().bottom + 1);
      }
    } finally {
      host.remove();
      service.listFolders = listFolders;
      service.listBookmarks = listBookmarks;
      if (addonDescriptor) {
        Object.defineProperty(globalThis, "addon", addonDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "addon");
      }
    }
  });
});
