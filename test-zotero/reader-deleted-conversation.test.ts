import { assert } from "chai";
import { config } from "../package.json";
import { getBookmarkService } from "../src/modules/bookmarks";
import { SessionStorageService } from "../src/modules/chat/SessionStorageService";
import { closeBookmarkReader } from "../src/modules/ui/chat-panel/BookmarkReaderWindow";
import {
  getChatManager,
  openBookmarkReaderForContext,
  openMessageTurnReader,
} from "../src/modules/ui/chat-panel/ChatPanelManager";
import type { ChatPanelContext } from "../src/modules/ui/chat-panel/types";
import type { ChatMessage } from "../src/types/chat";
import { getString } from "../src/utils/locale";

function getVisibleReader(): Document | undefined {
  const windows = Services.wm.getEnumerator("");
  while (windows.hasMoreElements()) {
    const win = windows.getNext() as Window;
    if (win.name !== "paperchat-bookmark-reader" || win.closed) continue;
    const root = win.document.getElementById("bookmark-reader-root");
    if (root?.firstChild && root.style.display !== "none") return win.document;
  }
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Reader did not reflect the conversation change");
}

describe("reader after conversation deletion", function () {
  this.timeout(10000);
  const globals = new Map<string, PropertyDescriptor | undefined>();

  before(function () {
    for (const name of ["addon", "ztoolkit"]) {
      globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => {
          const plugin = Zotero[config.addonInstance];
          return name === "addon" ? plugin : plugin.data.ztoolkit;
        },
      });
    }
  });

  after(function () {
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  it("prunes deleted replies from an open reader and keeps explicitly saved bookmarks", async function () {
    const manager = getChatManager();
    const storage = new SessionStorageService();
    const service = getBookmarkService();
    const session = await storage.createSession();
    const turns: ChatMessage[] = ["First", "Second", "Third"].flatMap(
      (label, index): ChatMessage[] => [
        {
          id: `${session.id}-question-${index}`,
          role: "user",
          content: `${label} question`,
          timestamp: index * 2 + 1,
        },
        {
          id: `${session.id}-reply-${index}`,
          role: "assistant",
          content: `${label} answer`,
          timestamp: index * 2 + 2,
        },
      ],
    );
    const hiddenReplies: ChatMessage[] = [
      {
        id: `${session.id}-empty`,
        role: "assistant",
        content: "",
        timestamp: 7,
      },
      {
        id: `${session.id}-internal`,
        role: "assistant",
        content: "Internal model context",
        apiOnly: true,
        timestamp: 8,
      },
      {
        id: `${session.id}-tool-only`,
        role: "assistant",
        content:
          '<tool-call status="completed"><tool-name>read_pdf</tool-name><tool-status>Done</tool-status></tool-call>',
        timestamp: 9,
      },
    ];
    const snapshot = await service.saveMessageBookmark({
      title: "Saved second answer",
      content: "Saved copy of the second answer",
      sessionId: session.id,
      messageId: turns[3].id,
    });
    const context = {
      chatManager: manager,
      appendError: (message: string) => assert.fail(message),
    } as ChatPanelContext;
    const readerText = () =>
      getVisibleReader()?.getElementById("chat-bookmark-reader-body")
        ?.textContent;

    try {
      await storage.saveSession({
        ...session,
        messages: [...turns.slice(0, 4), ...hiddenReplies, ...turns.slice(4)],
      });
      await manager.switchSession(session.id);
      await openMessageTurnReader(context, turns[3].id);
      await waitFor(() => Boolean(readerText()?.includes("Second answer")));
      assert.equal(
        getVisibleReader()?.getElementById(
          "chat-bookmark-reader-footer-position",
        )?.textContent,
        "2 / 3",
      );

      assert.isTrue(
        await manager.deleteConversationTurn(session.id, turns[1].id),
      );
      assert.equal(
        getVisibleReader()?.getElementById(
          "chat-bookmark-reader-footer-position",
        )?.textContent,
        "1 / 2",
      );
      assert.include(readerText(), "Second answer");
      assert.isTrue(
        await manager.deleteConversationTurn(session.id, turns[3].id),
      );
      await waitFor(() => Boolean(readerText()?.includes("Third answer")));
      assert.notInclude(readerText(), "Second answer");

      await manager.clearCurrentSession();
      await waitFor(() => !getVisibleReader());
      await openBookmarkReaderForContext(context, [snapshot], 0);
      await waitFor(() => Boolean(readerText()?.includes(snapshot.content)));
      assert.include(
        readerText(),
        getString("chat-bookmark-reader-saved-copy"),
      );
      const jump = getVisibleReader()?.getElementById(
        "chat-bookmark-reader-jump",
      ) as HTMLButtonElement;
      assert.isTrue(jump.disabled);
    } finally {
      try {
        closeBookmarkReader();
      } finally {
        try {
          await service.deleteBookmark(snapshot.id);
        } finally {
          await manager.deleteSession(session.id);
        }
      }
    }
  });
});
