import { assert } from "chai";
import { DatabaseSync } from "node:sqlite";
import { ChatManager } from "../src/modules/chat/ChatManager.ts";
import { SessionStorageService } from "../src/modules/chat/SessionStorageService.ts";
import { getStorageDatabase } from "../src/modules/chat/db/StorageDatabase.ts";
import { isLibraryWideSession } from "../src/modules/chat/session-scope.ts";
import { generateAgentRuntimeContextPrompt } from "../src/modules/chat/pdf-tools/promptGenerator.ts";
import type { ChatSession } from "../src/types/chat";
import { getActiveReaderItem } from "../src/modules/ui/chat-panel/ChatPanelManager.ts";
import { activatePanelTabSession } from "../src/modules/ui/chat-panel/PanelTabLifecycle.ts";

function session(
  id: string,
  overrides: Partial<ChatSession> = {},
): ChatSession {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    lastActiveItemKey: null,
    ...overrides,
  };
}

function managerFor(current: ChatSession, saved?: ChatSession) {
  const manager = Object.create(ChatManager.prototype) as any;
  const stored = new Map(
    [current, ...(saved ? [saved] : [])].map((s) => [s.id, s]),
  );
  let created = 0;
  manager.init = async () => undefined;
  manager.currentSession = current;
  manager.streamingSessions = new Map();
  manager.sessionStorage = {
    findLatestLibrarySessionId: async () =>
      [...stored.values()].find(isLibraryWideSession)?.id ?? null,
    findLatestSessionIdForItem: async (key: string) =>
      [...stored.values()].find((s) => s.lastActiveItemKey === key)?.id ?? null,
    loadSession: async (id: string) => stored.get(id) ?? null,
    createSession: async () => {
      created++;
      const value = session(`library-${created}`);
      stored.set(value.id, value);
      return value;
    },
    setActiveSession: async () => undefined,
    cleanupAbandonedDraftSessions: async () => 0,
    updateSessionMeta: async () => undefined,
  };
  manager.memoryManager = { onBeforeSessionSwitch: () => undefined };
  manager.maybeGenerateSessionTitle = () => undefined;
  manager.applySessionItemContext = (value: ChatSession) => {
    manager.currentItemKey = value.lastActiveItemKey;
  };
  manager.reconcileApprovalState = () => undefined;
  manager.reconcileUserInputRequestState = () => undefined;
  return { manager: manager as ChatManager, created: () => created };
}

describe("library-wide chat context", function () {
  let previousAddon: unknown;
  let previousZotero: unknown;

  beforeEach(function () {
    previousAddon = (globalThis as any).addon;
    previousZotero = (globalThis as any).Zotero;
    (globalThis as any).Zotero = { Libraries: { userLibraryID: 1 } };
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (requests: { id: string }[]) =>
              requests.map(({ id }) => ({ value: id, attributes: null })),
          },
        },
      },
    };
  });

  afterEach(function () {
    (globalThis as any).addon = previousAddon;
    (globalThis as any).Zotero = previousZotero;
  });

  it("does not reuse an empty paper draft as the library conversation", async function () {
    const paper = session("paper-draft", { lastActiveItemKey: "PAPER001" });
    const { manager, created } = managerFor(paper);
    const library = await manager.activateLibrarySession();
    assert.equal(created(), 1);
    assert.notEqual(library.id, paper.id);
    assert.isNull(library.lastActiveItemKey);
    assert.equal(paper.lastActiveItemKey, "PAPER001");
    assert.isNull(manager.getCurrentItemKey());
  });

  it("restores the saved library chat without bringing over the paper history", async function () {
    const paper = session("paper", { lastActiveItemKey: "PAPER001" });
    const saved = session("saved-library", {
      messages: [
        { id: "q", role: "user", content: "Compare my library", timestamp: 1 },
      ],
    });
    const { manager, created } = managerFor(paper, saved);
    assert.strictEqual(await manager.activateLibrarySession(), saved);
    assert.equal(created(), 0);
    assert.strictEqual(manager.getActiveSession(), saved);
  });

  it("reuses a current library draft across concurrent open requests", async function () {
    const { manager, created } = managerFor(session("library-draft"));
    const [first, second] = await Promise.all([
      manager.activateLibrarySession(),
      manager.activateLibrarySession(),
    ]);
    assert.strictEqual(first, second);
    assert.equal(created(), 0);
  });

  it("keeps collection and selection scopes separate from the entire library", async function () {
    const scoped = session("collection", { scopeItemKeys: ["PAPER001"] });
    assert.isFalse(isLibraryWideSession(scoped));
    assert.isFalse(isLibraryWideSession(null));
    const { manager } = managerFor(scoped);
    const library = await manager.activateLibrarySession();
    assert.isTrue(isLibraryWideSession(library));
    assert.deepEqual(scoped.scopeItemKeys, ["PAPER001"]);
  });

  it("switches PDF → library → PDF → library without reopening the panel", async function () {
    const paper = session("paper-history", { lastActiveItemKey: "PAPER001" });
    const library = session("library-history");
    const { manager, created } = managerFor(paper, library);
    const item = { key: "PAPER001", libraryID: 1 } as Zotero.Item;
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(
        await activatePanelTabSession(
          manager,
          null,
          "zotero-pane",
          "reader-1",
          false,
        ),
        library,
      );
      assert.isNull(manager.getCurrentItemKey());
      assert.strictEqual(
        await activatePanelTabSession(
          manager,
          item,
          "reader-1",
          "zotero-pane",
          false,
        ),
        paper,
      );
      assert.equal(manager.getCurrentItemKey(), "PAPER001");
    }
    assert.equal(created(), 0);
  });

  it("keeps an explicitly selected collection chat when the library tab has not changed", async function () {
    const scoped = session("selection", { scopeItemKeys: ["PAPER001"] });
    const { manager, created } = managerFor(scoped);
    for (const previous of [undefined, "zotero-pane"]) {
      assert.strictEqual(
        await activatePanelTabSession(
          manager,
          null,
          "zotero-pane",
          previous,
          false,
        ),
        scoped,
      );
    }
    assert.strictEqual(
      await activatePanelTabSession(
        manager,
        null,
        "zotero-pane",
        "reader-1",
        false,
        true,
      ),
      scoped,
    );
    assert.equal(created(), 0);
  });

  it("does not use an inactive PDF when the library tab is selected", function () {
    const runtime = globalThis as any;
    const previous = runtime.Zotero;
    const paper = { id: 12, key: "PAPER001" };
    const tabs = { selectedID: "zotero-pane" };
    runtime.Zotero = {
      getMainWindow: () => ({ Zotero_Tabs: tabs }),
      Reader: {
        getByTabID: (id: string) => (id === "reader-1" ? { itemID: 12 } : null),
      },
      Items: { get: () => paper },
    };
    try {
      assert.isNull(getActiveReaderItem());
      tabs.selectedID = "reader-1";
      assert.strictEqual(getActiveReaderItem(), paper);
    } finally {
      runtime.Zotero = previous;
    }
  });

  it("tells the model to retrieve across the library without pretending PDFs are preloaded", function () {
    const prompt = generateAgentRuntimeContextPrompt(undefined, {
      libraryScope: true,
    });
    assert.include(prompt, "=== LIBRARY CONTEXT ===");
    assert.include(prompt, "all collections");
    assert.include(prompt, "full texts have not been preloaded");
    assert.notInclude(
      generateAgentRuntimeContextPrompt(undefined, {}),
      "=== LIBRARY CONTEXT ===",
    );
  });

  it("finds the latest library history while excluding paper and collection sessions", async function () {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE sessions (id TEXT, last_active_item_key TEXT, scope_item_keys TEXT);
      CREATE TABLE session_meta (id TEXT, message_count INTEGER, updated_at INTEGER);
      INSERT INTO sessions VALUES ('library', NULL, NULL), ('paper', 'PAPER001', NULL),
        ('collection', NULL, '["PAPER001"]'), ('empty', NULL, NULL);
      INSERT INTO session_meta VALUES ('library', 2, 1), ('paper', 2, 4),
        ('collection', 2, 3), ('empty', 0, 5);`);
    const storage = getStorageDatabase();
    const original = storage.ensureInit;
    (storage as any).ensureInit = async () => ({
      queryAsync: async (sql: string) => db.prepare(sql).all(),
    });
    const sessions = Object.create(SessionStorageService.prototype) as any;
    sessions.init = async () => undefined;
    try {
      assert.equal(await sessions.findLatestLibrarySessionId(), "library");
    } finally {
      storage.ensureInit = original;
      db.close();
    }
  });
});
