import { assert } from "chai";
import { getBookmarkService } from "../src/modules/bookmarks/index.ts";
import { openBookmarkSaveDialog } from "../src/modules/ui/chat-panel/BookmarkSaveDialog.ts";
import { lightTheme } from "../src/modules/ui/chat-panel/ChatPanelTheme.ts";

class DialogElement {
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: DialogElement[] = [];
  readonly listeners = new Map<string, (event: any) => unknown>();
  parentNode: DialogElement | null = null;
  className = "";
  value = "";
  private text = "";

  constructor(
    readonly ownerDocument: DialogDocument,
    readonly tagName: string,
  ) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.text = value;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: DialogElement): void {
    child.parentNode = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parentNode)
      this.parentNode.children.splice(
        this.parentNode.children.indexOf(this),
        1,
      );
    this.parentNode = null;
  }

  addEventListener(type: string, handler: (event: any) => unknown): void {
    this.listeners.set(type, handler);
  }

  async click(): Promise<void> {
    await this.listeners.get("click")?.({ target: this });
  }

  focus(): void {}
  select(): void {}
}

class DialogDocument {
  readonly documentElement = new DialogElement(this, "html");

  createElementNS(_namespace: string, tag: string): DialogElement {
    return new DialogElement(this, tag);
  }
}

function findButton(root: DialogElement, label: string): DialogElement {
  if (root.tagName === "button" && root.textContent.includes(label))
    return root;
  for (const child of root.children) {
    try {
      return findButton(child, label);
    } catch {
      /* search next branch */
    }
  }
  throw new Error(`Button not found: ${label}`);
}

describe("bookmark save destination", function () {
  let originalAddon: unknown;
  let originalZotero: unknown;
  let service: ReturnType<typeof getBookmarkService>;
  let originalList: typeof service.listFolders;
  let originalSave: typeof service.saveMessageBookmark;
  let folders: any[];
  let saved: Array<Parameters<typeof service.saveMessageBookmark>[0]>;
  let doc: DialogDocument;

  beforeEach(function () {
    originalAddon = (globalThis as any).addon;
    originalZotero = (globalThis as any).Zotero;
    (globalThis as any).Zotero = {
      Libraries: { userLibraryID: 1 },
      getMainWindow: () => null,
    };
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (requests: Array<{ id: string }>) =>
              requests.map(({ id }) => ({ value: id, attributes: null })),
          },
        },
      },
    };
    service = getBookmarkService(1);
    originalList = service.listFolders;
    originalSave = service.saveMessageBookmark;
    folders = [
      { id: "folder-1", name: "mamba" },
      { id: "folder-2", name: "Transformer" },
    ];
    saved = [];
    service.listFolders = async () => folders;
    service.saveMessageBookmark = async (input) => {
      saved.push(input);
      return { id: "saved-1", title: input.title } as any;
    };
    doc = new DialogDocument();
  });

  afterEach(function () {
    service.listFolders = originalList;
    service.saveMessageBookmark = originalSave;
    (globalThis as any).addon = originalAddon;
    (globalThis as any).Zotero = originalZotero;
  });

  async function open() {
    const result = openBookmarkSaveDialog(
      doc as unknown as Document,
      lightTheme,
      {
        defaultTitle: "User question",
        content: "Assistant reply",
        sessionId: "session-1",
        messageId: "message-1",
      },
    );
    await Promise.resolve();
    return { result };
  }

  it("allows selecting Ungrouped even when folders exist", async function () {
    const { result } = await open();
    await findButton(doc.documentElement, "chat-bookmark-no-group").click();
    assert.equal(
      findButton(doc.documentElement, "chat-bookmark-no-group").attributes.get(
        "aria-pressed",
      ),
      "true",
    );
    await findButton(
      doc.documentElement,
      "paperchat-chat-bookmark-save",
    ).click();
    assert.deepEqual(await result, {
      bookmarkId: "saved-1",
      title: "User question",
    });
    assert.isNull(saved[0].folderId);
    assert.equal(saved[0].content, "Assistant reply");
  });

  it("offers and selects Ungrouped when no folders exist", async function () {
    folders = [];
    const { result } = await open();
    const ungrouped = findButton(doc.documentElement, "chat-bookmark-no-group");
    assert.equal(ungrouped.attributes.get("aria-pressed"), "true");
    await findButton(
      doc.documentElement,
      "paperchat-chat-bookmark-save",
    ).click();
    await result;
    assert.isNull(saved[0].folderId);
  });

  it("can switch from Ungrouped back to a normal folder", async function () {
    const { result } = await open();
    await findButton(doc.documentElement, "chat-bookmark-no-group").click();
    await findButton(doc.documentElement, "Transformer").click();
    assert.equal(
      findButton(doc.documentElement, "chat-bookmark-no-group").attributes.get(
        "aria-pressed",
      ),
      "false",
    );
    await findButton(
      doc.documentElement,
      "paperchat-chat-bookmark-save",
    ).click();
    await result;
    assert.equal(saved[0].folderId, "folder-2");
  });

  it("does not save when cancelled after selecting Ungrouped", async function () {
    const { result } = await open();
    await findButton(doc.documentElement, "chat-bookmark-no-group").click();
    await findButton(
      doc.documentElement,
      "paperchat-chat-bookmark-cancel",
    ).click();
    assert.isNull(await result);
    assert.lengthOf(saved, 0);
    assert.lengthOf(doc.documentElement.children, 0);
  });
});
