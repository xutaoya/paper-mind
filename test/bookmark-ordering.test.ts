import { assert } from "chai";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookmarkRepository } from "../src/modules/bookmarks/BookmarkRepository.ts";
import { BookmarkService } from "../src/modules/bookmarks/BookmarkService.ts";
import {
  getStorageDatabase,
  resetStorageDatabaseForTests,
  SCHEMA_VERSION,
} from "../src/modules/chat/db/StorageDatabase.ts";

describe("bookmark ordering persistence", function () {
  let sqlite: DatabaseSync;
  let repository: BookmarkRepository;
  let originalZtoolkit: unknown;
  let adapter: {
    queryAsync: (sql: string, params?: unknown[]) => Promise<any[]>;
    closeDatabase: () => Promise<void>;
  };

  beforeEach(async function () {
    originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).ztoolkit = { log: () => undefined };
    await resetStorageDatabaseForTests();
    sqlite = new DatabaseSync(":memory:");
    adapter = {
      async queryAsync(sql, params = []) {
        const statement = sqlite.prepare(sql);
        if (/^\s*(SELECT|PRAGMA)/i.test(sql)) {
          return statement.all(...(params as any[]));
        }
        statement.run(...(params as any[]));
        return [];
      },
      async closeDatabase() {
        sqlite.close();
      },
    };
    const storage = getStorageDatabase() as any;
    storage.db = adapter;
    await storage.createTables(adapter);
    await storage.initSchemaVersion(adapter);
    repository = new BookmarkRepository(1);
  });

  afterEach(async function () {
    await resetStorageDatabaseForTests();
    (globalThis as any).ztoolkit = originalZtoolkit;
  });

  function seed(
    id: string,
    folder: string | null,
    created: number,
    library = 1,
  ) {
    sqlite
      .prepare(
        `INSERT INTO bookmarks
       (id, library_id, folder_id, type, title, content, created_at, updated_at)
       VALUES (?, ?, ?, 'message', ?, ?, ?, ?)`,
      )
      .run(id, library, folder, id, `Content ${id}`, created, created);
  }

  async function ids(folderId: string | null = "folder-1") {
    const bookmarks = await new BookmarkRepository(1).listBookmarks({
      sort: "manual",
    });
    return bookmarks
      .filter((bookmark) => bookmark.folderId === folderId)
      .map((bookmark) => bookmark.id);
  }

  it("keeps legacy bookmarks in newest-first order until reordered", async function () {
    seed("a", "folder-1", 30);
    seed("b", "folder-1", 20);
    seed("c", "folder-1", 10);
    assert.deepEqual(await ids(), ["a", "b", "c"]);
  });

  it("moves upward and downward within a folder without changing creation dates", async function () {
    seed("a", "folder-1", 30);
    seed("b", "folder-1", 20);
    seed("c", "folder-1", 10);
    await new BookmarkService(1).reorderBookmark("c", "a", "before");
    assert.deepEqual(await ids(), ["c", "a", "b"]);
    await repository.reorderBookmark("c", "b", "after");
    assert.deepEqual(await ids(), ["a", "b", "c"]);
    const dates = sqlite
      .prepare("SELECT id, created_at FROM bookmarks ORDER BY id")
      .all();
    assert.deepEqual(
      dates.map((row) => row.created_at),
      [30, 20, 10],
    );
  });

  it("supports ungrouped bookmarks without moving folder contents", async function () {
    seed("a", null, 30);
    seed("b", null, 20);
    seed("other", "folder-1", 10);
    await repository.reorderBookmark("a", "b", "after");
    assert.deepEqual(await ids(null), ["b", "a"]);
    assert.deepEqual(await ids(), ["other"]);
  });

  it("inserts cross-folder moves at the selected position", async function () {
    seed("a", "folder-1", 30);
    seed("b", "folder-1", 20);
    seed("c", "folder-2", 10);
    await repository.reorderBookmark("c", "a", "after");
    assert.deepEqual(await ids(), ["a", "c", "b"]);
    assert.deepEqual(await ids("folder-2"), []);
  });

  it("ignores self-drops, deleted targets and other libraries", async function () {
    seed("a", "folder-1", 30);
    seed("b", "folder-1", 20);
    seed("foreign", "folder-1", 10, 2);
    await repository.reorderBookmark("a", "a", "after");
    await repository.reorderBookmark("a", "deleted", "after");
    await repository.reorderBookmark("a", "foreign", "before");
    assert.deepEqual(await ids(), ["a", "b"]);
    assert.isNull(
      sqlite.prepare("SELECT sort_order FROM bookmarks WHERE id = 'a'").get()!
        .sort_order,
    );
  });

  it("preserves manual order through export/import and still supports date sorting", async function () {
    seed("a", "folder-1", 30);
    seed("b", "folder-1", 20);
    await repository.reorderBookmark("b", "a", "before");
    const service = new BookmarkService(1);
    const exported = await service.exportAll();
    await service.importAll(exported);
    assert.deepEqual(await ids(), ["b", "a"]);
    const chronological = await repository.listBookmarks({
      sort: "created_desc",
    });
    assert.deepEqual(
      chronological.map((bookmark) => bookmark.id),
      ["a", "b"],
    );
  });

  it("rolls back a partially failed reorder", async function () {
    seed("a", "folder-1", 30);
    seed("b", "folder-1", 20);
    const query = adapter.queryAsync;
    let writes = 0;
    adapter.queryAsync = async (sql, params) => {
      if (sql.includes("UPDATE bookmarks") && ++writes === 2)
        throw new Error("write failed");
      return query(sql, params);
    };
    try {
      await repository.reorderBookmark("b", "a", "before");
      assert.fail("Expected a write failure");
    } catch (error) {
      assert.equal((error as Error).message, "write failed");
    }
    assert.deepEqual(await ids(), ["a", "b"]);
    assert.isNull(
      sqlite.prepare("SELECT sort_order FROM bookmarks WHERE id = 'a'").get()!
        .sort_order,
    );
  });

  it("migrates v18 bookmarks without changing their contents or dates", async function () {
    seed("legacy", "folder-1", 123);
    sqlite.exec(
      "ALTER TABLE bookmarks DROP COLUMN sort_order; UPDATE schema_version SET version = 18",
    );
    const storage = getStorageDatabase() as any;
    await storage.initSchemaVersion(adapter);
    await storage.initSchemaVersion(adapter);
    assert.equal(
      sqlite.prepare("SELECT version FROM schema_version").get()!.version,
      SCHEMA_VERSION,
    );
    const [bookmark] = await repository.listBookmarks({ sort: "manual" });
    assert.equal(bookmark.content, "Content legacy");
    assert.equal(bookmark.createdAt, 123);
    assert.equal(bookmark.updatedAt, 123);
    assert.isNull(bookmark.sortOrder);
  });

  it("retains the order after closing and reopening a database file", async function () {
    const directory = mkdtempSync(join(tmpdir(), "paperchat-bookmark-order-"));
    const path = join(directory, "storage.sqlite");
    try {
      seed("a", "folder-1", 30);
      seed("b", "folder-1", 20);
      await repository.reorderBookmark("b", "a", "before");
      sqlite.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
      await resetStorageDatabaseForTests();
      sqlite = new DatabaseSync(path);
      const storage = getStorageDatabase() as any;
      storage.db = adapter;
      await storage.initSchemaVersion(adapter);
      assert.deepEqual(await ids(), ["b", "a"]);
    } finally {
      await resetStorageDatabaseForTests();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back the schema change if recording the new version fails", async function () {
    seed("legacy", "folder-1", 123);
    sqlite.exec(
      "ALTER TABLE bookmarks DROP COLUMN sort_order; UPDATE schema_version SET version = 18",
    );
    const query = adapter.queryAsync;
    adapter.queryAsync = async (sql, params) => {
      if (sql.includes("UPDATE schema_version"))
        throw new Error("version write failed");
      return query(sql, params);
    };
    try {
      await (getStorageDatabase() as any).initSchemaVersion(adapter);
      assert.fail("Expected a version write failure");
    } catch (error) {
      assert.equal((error as Error).message, "version write failed");
    }
    assert.equal(
      sqlite.prepare("SELECT version FROM schema_version").get()!.version,
      18,
    );
    assert.isFalse(
      sqlite
        .prepare("PRAGMA table_info(bookmarks)")
        .all()
        .some((row) => row.name === "sort_order"),
    );
    assert.equal(
      sqlite.prepare("SELECT content FROM bookmarks").get()!.content,
      "Content legacy",
    );
  });
});
