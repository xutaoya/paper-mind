import { getStorageDatabase } from "../chat/db/StorageDatabase";
import type {
  BookmarkFolder,
  BookmarkRecord,
  BookmarkSortMode,
  BookmarkType,
  CreateBookmarkInput,
} from "../../types/bookmark";

function generateBookmarkId(prefix: "bm" | "bf"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function mapFolderRow(row: Record<string, unknown>): BookmarkFolder {
  return {
    id: String(row.id),
    libraryId: Number(row.library_id),
    name: String(row.name),
    parentId: row.parent_id ? String(row.parent_id) : null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapBookmarkRow(row: Record<string, unknown>): BookmarkRecord {
  return {
    id: String(row.id),
    libraryId: Number(row.library_id),
    folderId: row.folder_id ? String(row.folder_id) : null,
    type: String(row.type) as BookmarkType,
    title: String(row.title),
    content: String(row.content ?? ""),
    sessionId: row.session_id ? String(row.session_id) : null,
    messageId: row.message_id ? String(row.message_id) : null,
    itemKey: row.item_key ? String(row.item_key) : null,
    itemLibraryId:
      row.item_library_id == null ? null : Number(row.item_library_id),
    pageUrl: row.page_url ? String(row.page_url) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class BookmarkRepository {
  constructor(private readonly libraryId: number) {}

  async listFolders(): Promise<BookmarkFolder[]> {
    const db = await getStorageDatabase().ensureInit();
    const rows =
      (await db.queryAsync(
        `SELECT id, library_id, name, parent_id, sort_order, created_at, updated_at
         FROM bookmark_folders
         WHERE library_id = ?
         ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
        [this.libraryId],
      )) || [];
    return rows.map((row) => mapFolderRow(row as Record<string, unknown>));
  }

  async createFolder(name: string, parentId: string | null = null): Promise<BookmarkFolder> {
    const db = await getStorageDatabase().ensureInit();
    const now = Date.now();
    const folder: BookmarkFolder = {
      id: generateBookmarkId("bf"),
      libraryId: this.libraryId,
      name: name.trim(),
      parentId,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.queryAsync(
      `INSERT INTO bookmark_folders (
        id, library_id, name, parent_id, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        folder.id,
        folder.libraryId,
        folder.name,
        folder.parentId,
        folder.sortOrder,
        folder.createdAt,
        folder.updatedAt,
      ],
    );
    return folder;
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    const db = await getStorageDatabase().ensureInit();
    await db.queryAsync(
      `UPDATE bookmark_folders
       SET name = ?, updated_at = ?
       WHERE id = ? AND library_id = ?`,
      [name.trim(), Date.now(), folderId, this.libraryId],
    );
  }

  async deleteFolder(folderId: string): Promise<void> {
    await getStorageDatabase().executeTransaction(async (tx) => {
      const rows =
        (await tx.queryAsync(
          `SELECT parent_id
           FROM bookmark_folders
           WHERE id = ? AND library_id = ?`,
          [folderId, this.libraryId],
        )) || [];
      const parentId = rows[0]?.parent_id ? String(rows[0].parent_id) : null;
      await tx.queryAsync(
        `UPDATE bookmark_folders
         SET parent_id = ?, updated_at = ?
         WHERE parent_id = ? AND library_id = ?`,
        [parentId, Date.now(), folderId, this.libraryId],
      );
      await tx.queryAsync(
        `UPDATE bookmarks
         SET folder_id = NULL, updated_at = ?
         WHERE folder_id = ? AND library_id = ?`,
        [Date.now(), folderId, this.libraryId],
      );
      await tx.queryAsync(
        `DELETE FROM bookmark_folders WHERE id = ? AND library_id = ?`,
        [folderId, this.libraryId],
      );
    });
  }

  async moveFolder(
    folderId: string,
    parentId: string | null,
  ): Promise<void> {
    const db = await getStorageDatabase().ensureInit();
    const now = Date.now();
    await db.queryAsync(
      `UPDATE bookmark_folders
       SET parent_id = ?, sort_order = ?, updated_at = ?
       WHERE id = ? AND library_id = ?`,
      [parentId, now, now, folderId, this.libraryId],
    );
  }

  async reorderFolder(
    folderId: string,
    referenceFolderId: string,
    placement: "before" | "after",
  ): Promise<void> {
    const folders = await this.listFolders();
    const dragged = folders.find((entry) => entry.id === folderId);
    const reference = folders.find((entry) => entry.id === referenceFolderId);
    if (!dragged || !reference || folderId === referenceFolderId) {
      return;
    }

    const targetParentId = reference.parentId;
    const siblings = folders
      .filter(
        (entry) => entry.parentId === targetParentId && entry.id !== folderId,
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          }),
      );

    let insertIndex = siblings.findIndex((entry) => entry.id === referenceFolderId);
    if (insertIndex < 0) {
      return;
    }
    if (placement === "after") {
      insertIndex += 1;
    }

    const reordered = [...siblings];
    reordered.splice(insertIndex, 0, { ...dragged, parentId: targetParentId });

    const now = Date.now();
    await getStorageDatabase().executeTransaction(async (tx) => {
      for (let index = 0; index < reordered.length; index += 1) {
        const folder = reordered[index];
        await tx.queryAsync(
          `UPDATE bookmark_folders
           SET parent_id = ?, sort_order = ?, updated_at = ?
           WHERE id = ? AND library_id = ?`,
          [targetParentId, now + index, now, folder.id, this.libraryId],
        );
      }
    });
  }

  async listBookmarks(options: {
    folderId?: string | null;
    type?: BookmarkType | "all";
    query?: string;
    sort: BookmarkSortMode;
  }): Promise<BookmarkRecord[]> {
    const db = await getStorageDatabase().ensureInit();
    const clauses = ["library_id = ?"];
    const params: unknown[] = [this.libraryId];

    if (options.folderId) {
      clauses.push("folder_id = ?");
      params.push(options.folderId);
    }
    if (options.type && options.type !== "all") {
      clauses.push("type = ?");
      params.push(options.type);
    }
    if (options.query?.trim()) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLikePattern(options.query.trim())}%`;
      params.push(pattern, pattern);
    }

    const orderBy =
      options.sort === "title_asc"
        ? "title COLLATE NOCASE ASC, created_at DESC"
        : "created_at DESC";

    const rows =
      (await db.queryAsync(
        `SELECT id, library_id, folder_id, type, title, content,
                session_id, message_id, item_key, item_library_id, page_url,
                created_at, updated_at
         FROM bookmarks
         WHERE ${clauses.join(" AND ")}
         ORDER BY ${orderBy}`,
        params,
      )) || [];
    return rows.map((row) => mapBookmarkRow(row as Record<string, unknown>));
  }

  async createBookmark(input: CreateBookmarkInput): Promise<BookmarkRecord> {
    const db = await getStorageDatabase().ensureInit();
    const now = Date.now();
    const bookmark: BookmarkRecord = {
      id: generateBookmarkId("bm"),
      libraryId: this.libraryId,
      folderId: input.folderId ?? null,
      type: input.type,
      title: input.title.trim(),
      content: input.content,
      sessionId: input.sessionId ?? null,
      messageId: input.messageId ?? null,
      itemKey: input.itemKey ?? null,
      itemLibraryId: input.itemLibraryId ?? null,
      pageUrl: input.pageUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.queryAsync(
      `INSERT INTO bookmarks (
        id, library_id, folder_id, type, title, content,
        session_id, message_id, item_key, item_library_id, page_url,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookmark.id,
        bookmark.libraryId,
        bookmark.folderId,
        bookmark.type,
        bookmark.title,
        bookmark.content,
        bookmark.sessionId,
        bookmark.messageId,
        bookmark.itemKey,
        bookmark.itemLibraryId,
        bookmark.pageUrl,
        bookmark.createdAt,
        bookmark.updatedAt,
      ],
    );
    return bookmark;
  }

  async updateBookmark(
    bookmarkId: string,
    patch: Partial<
      Pick<BookmarkRecord, "title" | "content" | "folderId">
    >,
  ): Promise<void> {
    const db = await getStorageDatabase().ensureInit();
    const fields: string[] = ["updated_at = ?"];
    const params: unknown[] = [Date.now()];
    if (patch.title !== undefined) {
      fields.push("title = ?");
      params.push(patch.title.trim());
    }
    if (patch.content !== undefined) {
      fields.push("content = ?");
      params.push(patch.content);
    }
    if (patch.folderId !== undefined) {
      fields.push("folder_id = ?");
      params.push(patch.folderId);
    }
    params.push(bookmarkId, this.libraryId);
    await db.queryAsync(
      `UPDATE bookmarks SET ${fields.join(", ")} WHERE id = ? AND library_id = ?`,
      params,
    );
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    const db = await getStorageDatabase().ensureInit();
    await db.queryAsync(
      `DELETE FROM bookmarks WHERE id = ? AND library_id = ?`,
      [bookmarkId, this.libraryId],
    );
  }

  async countBookmarksInFolder(folderId: string): Promise<number> {
    const db = await getStorageDatabase().ensureInit();
    const rows =
      (await db.queryAsync(
        `SELECT COUNT(*) AS cnt FROM bookmarks WHERE folder_id = ? AND library_id = ?`,
        [folderId, this.libraryId],
      )) || [];
    return Number(rows[0]?.cnt ?? 0);
  }

  async replaceAll(
    folders: BookmarkFolder[],
    bookmarks: BookmarkRecord[],
  ): Promise<void> {
    await getStorageDatabase().executeTransaction(async (tx) => {
      await tx.queryAsync(`DELETE FROM bookmarks WHERE library_id = ?`, [
        this.libraryId,
      ]);
      await tx.queryAsync(`DELETE FROM bookmark_folders WHERE library_id = ?`, [
        this.libraryId,
      ]);
      for (const folder of folders) {
        await tx.queryAsync(
          `INSERT INTO bookmark_folders (
            id, library_id, name, parent_id, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            folder.id,
            this.libraryId,
            folder.name,
            folder.parentId,
            folder.sortOrder,
            folder.createdAt,
            folder.updatedAt,
          ],
        );
      }
      for (const bookmark of bookmarks) {
        await tx.queryAsync(
          `INSERT INTO bookmarks (
            id, library_id, folder_id, type, title, content,
            session_id, message_id, item_key, item_library_id, page_url,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookmark.id,
            this.libraryId,
            bookmark.folderId,
            bookmark.type,
            bookmark.title,
            bookmark.content,
            bookmark.sessionId,
            bookmark.messageId,
            bookmark.itemKey,
            bookmark.itemLibraryId,
            bookmark.pageUrl,
            bookmark.createdAt,
            bookmark.updatedAt,
          ],
        );
      }
    });
  }
}

const repositories = new Map<number, BookmarkRepository>();

export function getBookmarkRepository(
  libraryId = Zotero.Libraries.userLibraryID,
): BookmarkRepository {
  let repository = repositories.get(libraryId);
  if (!repository) {
    repository = new BookmarkRepository(libraryId);
    repositories.set(libraryId, repository);
  }
  return repository;
}
