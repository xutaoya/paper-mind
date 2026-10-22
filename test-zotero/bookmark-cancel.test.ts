import { assert } from "chai";
import { config } from "../package.json";
import { getBookmarkService } from "../src/modules/bookmarks";
import { openBookmarkSaveDialog } from "../src/modules/ui/chat-panel/BookmarkSaveDialog";
import { lightTheme } from "../src/modules/ui/chat-panel/ChatPanelTheme";
import { createMessageElement } from "../src/modules/ui/chat-panel/MessageRenderer";
import { createChatContainer } from "../src/modules/ui/chat-panel/ChatPanelBuilder";
import { attachConversationNavigator } from "../src/modules/ui/chat-panel/ConversationNavigator";
import { getString } from "../src/utils/locale";

describe("bookmark cancellation in Zotero", function () {
  this.timeout(5000);
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let service: ReturnType<typeof getBookmarkService>;
  let originalListFolders: typeof service.listFolders;
  let originalSave: typeof service.saveMessageBookmark;
  let host: HTMLElement;
  let button: HTMLButtonElement;
  let doc: Document;
  let saves: number;

  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 50; i++) {
      if (check()) return;
      await wait();
    }
    assert.fail("Bookmark action did not settle");
  }

  before(function () {
    for (const name of ["addon", "ztoolkit"]) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () =>
          name === "addon"
            ? Zotero[config.addonInstance]
            : Zotero[config.addonInstance].data.ztoolkit,
      });
    }
    service = getBookmarkService();
    originalListFolders = service.listFolders;
    originalSave = service.saveMessageBookmark;
  });

  after(function () {
    service.listFolders = originalListFolders;
    service.saveMessageBookmark = originalSave;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  });

  beforeEach(function () {
    doc = Zotero.getMainWindow().document;
    saves = 0;
    service.listFolders = async () => [
      {
        id: "folder-mamba",
        name: "mamba",
        libraryId: 1,
        parentId: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "folder-transformer",
        name: "Transformer",
        libraryId: 1,
        parentId: null,
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    service.saveMessageBookmark = async (input) => {
      saves++;
      return { id: "test-bookmark", title: input.title } as any;
    };
    host = createMessageElement(
      doc,
      {
        id: "cancel-test-message",
        role: "assistant",
        content: "Test answer",
        timestamp: 1,
      },
      lightTheme,
      false,
      false,
      undefined,
      undefined,
      {
        onBookmarkMessage: async (_id, onDialogPresent) => {
          await openBookmarkSaveDialog(
            doc,
            lightTheme,
            {
              defaultTitle: "Test question",
              content: "Test answer",
              sessionId: "test-session",
              messageId: "cancel-test-message",
            },
            { onPresent: onDialogPresent },
          );
        },
      },
    );
    doc.documentElement.appendChild(host);
    button = host.querySelector(".bookmark-message-btn") as HTMLButtonElement;
  });

  afterEach(function () {
    doc
      .querySelectorAll(".paperchat-bookmark-dialog-overlay")
      .forEach((overlay) => overlay.remove());
    host.remove();
  });

  it("does not let the engaged conversation rail cover the bookmark click area", async function () {
    const message = host;
    message.remove();
    host = createChatContainer(doc, lightTheme);
    Object.assign(host.style, {
      display: "block",
      position: "fixed",
      left: "60px",
      top: "120px",
      width: "360px",
      height: "420px",
      zIndex: "10000",
    });
    doc.documentElement.appendChild(host);
    const root = host.querySelector(".chat-panel-root") as HTMLElement;
    const viewport = host.querySelector("#chat-viewport") as HTMLElement;
    const history = host.querySelector("#chat-history") as HTMLElement;
    root.replaceChildren(viewport);
    history.replaceChildren(message);
    Object.assign(message.style, {
      position: "absolute",
      top: "300px",
      margin: "0",
      left: doc.defaultView!.getComputedStyle(history).paddingLeft,
    });
    const controller = attachConversationNavigator(
      viewport,
      history,
      lightTheme,
    );
    try {
      controller.update(
        Array.from({ length: 4 }, (_, i) => ({
          id: `rail-user-${i}`,
          role: "user" as const,
          content: `Question ${i}`,
          timestamp: i,
        })),
        lightTheme,
      );
      await wait();
      controller.syncScroll();
      const rail = host.querySelector("#chat-conversation-nav") as HTMLElement;
      assert.equal(rail.style.width, "32px");
      for (let attempt = 0; attempt < 3; attempt++) {
        const rect = button.getBoundingClientRect();
        const hit = doc.elementFromPoint(
          rect.left + 1,
          rect.top + rect.height / 2,
        ) as HTMLElement;
        assert.strictEqual(hit?.closest(".bookmark-message-btn"), button);
        (hit.closest("button") as HTMLButtonElement).click();
        await waitFor(
          () => !!doc.querySelector(".paperchat-bookmark-dialog-overlay"),
        );
        const cancel = [
          ...doc.querySelectorAll(".paperchat-bookmark-dialog button"),
        ].find(
          (node) => node.textContent === getString("chat-bookmark-cancel"),
        )!;
        cancel.click();
        assert.isNull(doc.querySelector(".paperchat-bookmark-dialog-overlay"));
        controller.syncScroll();
      }
      const rect = button.getBoundingClientRect();
      for (const x of [
        rect.left + 1,
        rect.left + rect.width / 2,
        rect.right - 1,
      ]) {
        const hit = doc.elementFromPoint(
          x,
          rect.top + rect.height / 2,
        ) as HTMLElement;
        assert.strictEqual(
          hit?.closest(".bookmark-message-btn"),
          button,
          `bookmark point x=${x} was blocked by ${hit?.className}`,
        );
      }
      const tick = host.querySelector(
        ".chat-conversation-nav-tick-button",
      ) as HTMLElement;
      const tickRect = tick.getBoundingClientRect();
      message.style.top = `${Number.parseFloat(message.style.top) + tickRect.top + tickRect.height / 2 - rect.top - rect.height / 2}px`;
      const aligned = button.getBoundingClientRect();
      assert.strictEqual(
        doc
          .elementFromPoint(aligned.left + 1, aligned.top + aligned.height / 2)
          ?.closest(".bookmark-message-btn"),
        button,
        "expanded tick buttons must not cover the action row either",
      );
      assert.strictEqual(
        doc
          .elementFromPoint(
            tickRect.left + 2,
            tickRect.top + tickRect.height / 2,
          )
          ?.closest(".chat-conversation-nav-tick-button"),
        tick,
      );
    } finally {
      controller.dispose();
    }
  });

  for (const method of [
    "cancel",
    "close",
    "backdrop",
    "escape",
    "removed",
  ] as const) {
    const title = `allows reopening and saving after ${method}`;

    it(title, async function () {
      for (let attempt = 0; attempt < 3; attempt++) {
        button.click();
        await waitFor(
          () => !!doc.querySelector(".paperchat-bookmark-dialog-overlay"),
        );
        const overlay = doc.querySelector(
          ".paperchat-bookmark-dialog-overlay",
        ) as HTMLElement;
        assert.isFalse(
          button.disabled,
          "launcher must already be unlocked while the modal is open",
        );
        assert.isNull(button.getAttribute("data-busy"));
        button.click();
        await wait();
        assert.lengthOf(
          doc.querySelectorAll(".paperchat-bookmark-dialog-overlay"),
          1,
          "programmatic clicks behind the modal must not open duplicates",
        );
        if (method === "cancel") {
          const cancel = [...overlay.querySelectorAll("button")].find(
            (node) => node.textContent === getString("chat-bookmark-cancel"),
          )!;
          cancel.click();
        } else if (method === "close") {
          (overlay.querySelector("button") as HTMLButtonElement).click();
        } else if (method === "backdrop") {
          overlay.click();
        } else if (method === "escape") {
          const win = doc.defaultView!;
          overlay.querySelector("input")!.dispatchEvent(
            new win.KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        } else {
          overlay.remove();
        }
        await waitFor(() => !button.disabled);
        assert.isNull(button.getAttribute("data-busy"));
        assert.isNull(doc.querySelector(".paperchat-bookmark-dialog-overlay"));
        assert.equal(saves, 0);
      }
      button.click();
      await waitFor(
        () => !!doc.querySelector(".paperchat-bookmark-dialog-overlay"),
      );
      const save = [
        ...doc.querySelectorAll(".paperchat-bookmark-dialog button"),
      ].find((node) => node.textContent === getString("chat-bookmark-save"))!;
      save.click();
      await waitFor(
        () => !doc.querySelector(".paperchat-bookmark-dialog-overlay"),
      );
      assert.isFalse(button.disabled);
      assert.equal(saves, 1);
    });
  }
});
