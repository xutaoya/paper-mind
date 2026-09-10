import type { ChatMessage } from "../../types/chat";
import { extractEditableUserMessageContent } from "../chat/user-message-edit";
import { sanitizeMessagePreview } from "../ui/chat-panel/HistoryDropdown";
import { getString } from "../../utils/locale";
import { findPrecedingUserMessage } from "./bookmarkTurnContent";
import type {
  BookmarkExportPayload,
  BookmarkFilterType,
  BookmarkFolder,
  BookmarkRecord,
  BookmarkSortMode,
  CreateBookmarkInput,
} from "../../types/bookmark";
import { getBookmarkRepository } from "./BookmarkRepository";

export function canBookmarkAssistantReply(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.streamingState === undefined &&
    Boolean(message.content.trim())
  );
}

export function deriveBookmarkTitle(content: string): string {
  const cleaned = sanitizeMessagePreview(content).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return getString("chat-bookmark-untitled");
  }
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

export function deriveBookmarkTitleForAssistantReply(
  messages: readonly ChatMessage[],
  assistantMessageId: string,
  fallbackContent = "",
): string {
  const user = findPrecedingUserMessage(
    [...messages],
    assistantMessageId,
  );
  if (user) {
    const question =
      extractEditableUserMessageContent(user) || user.content.trim();
    if (question) {
      return deriveBookmarkTitle(question);
    }
  }
  return deriveBookmarkTitle(fallbackContent);
}

export class BookmarkService {
  constructor(private readonly libraryId: number) {}

  private repository() {
    return getBookmarkRepository(this.libraryId);
  }

  async listFolders(): Promise<BookmarkFolder[]> {
    return this.repository().listFolders();
  }

  async createFolder(
    name: string,
    parentId: string | null = null,
  ): Promise<BookmarkFolder> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error(getString("chat-bookmark-folder-name-required"));
    }
    return this.repository().createFolder(trimmed, parentId);
  }

  async createSubFolder(
    parentId: string,
    name: string,
  ): Promise<BookmarkFolder> {
    return this.createFolder(name, parentId);
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error(getString("chat-bookmark-folder-name-required"));
    }
    await this.repository().renameFolder(folderId, trimmed);
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.repository().deleteFolder(folderId);
  }

  async moveFolder(
    folderId: string,
    parentId: string | null,
  ): Promise<void> {
    const folders = await this.listFolders();
    if (folderId === parentId) {
      return;
    }
    if (parentId && this.isFolderDescendant(parentId, folderId, folders)) {
      throw new Error(getString("chat-bookmark-folder-move-invalid"));
    }
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder || folder.parentId === parentId) {
      return;
    }
    await this.repository().moveFolder(folderId, parentId);
  }

  async reorderFolder(
    folderId: string,
    referenceFolderId: string,
    placement: "before" | "after",
  ): Promise<void> {
    const folders = await this.listFolders();
    const reference = folders.find((entry) => entry.id === referenceFolderId);
    const dragged = folders.find((entry) => entry.id === folderId);
    if (!reference || !dragged || folderId === referenceFolderId) {
      return;
    }

    const targetParentId = reference.parentId;
    if (targetParentId === folderId) {
      throw new Error(getString("chat-bookmark-folder-move-invalid"));
    }
    if (
      targetParentId &&
      this.isFolderDescendant(targetParentId, folderId, folders)
    ) {
      throw new Error(getString("chat-bookmark-folder-move-invalid"));
    }

    const siblings = folders
      .filter((entry) => entry.parentId === targetParentId)
      .sort((left, right) => left.sortOrder - right.sortOrder);
    const currentIndex = siblings.findIndex((entry) => entry.id === folderId);
    const referenceIndex = siblings.findIndex(
      (entry) => entry.id === referenceFolderId,
    );
    if (
      currentIndex >= 0 &&
      referenceIndex >= 0 &&
      dragged.parentId === targetParentId
    ) {
      const targetIndex =
        placement === "before" ? referenceIndex : referenceIndex + 1;
      const adjustedTargetIndex =
        currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      if (currentIndex === adjustedTargetIndex) {
        return;
      }
    }

    await this.repository().reorderFolder(folderId, referenceFolderId, placement);
  }

  private isFolderDescendant(
    candidateId: string,
    ancestorId: string,
    folders: BookmarkFolder[],
  ): boolean {
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    let current = folderById.get(candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) {
        return true;
      }
      current = folderById.get(current.parentId);
    }
    return false;
  }

  async listBookmarks(options: {
    folderId?: string | null;
    filter: BookmarkFilterType;
    query?: string;
    sort: BookmarkSortMode;
  }): Promise<BookmarkRecord[]> {
    return this.repository().listBookmarks({
      folderId: options.folderId,
      type: options.filter === "all" ? "all" : options.filter,
      query: options.query,
      sort: options.sort,
    });
  }

  async saveMessageBookmark(input: {
    title: string;
    content: string;
    folderId?: string | null;
    sessionId: string;
    messageId: string;
    itemKey?: string | null;
    itemLibraryId?: number | null;
  }): Promise<BookmarkRecord> {
    const title = input.title.trim() || deriveBookmarkTitle(input.content);
    if (!title) {
      throw new Error(getString("chat-bookmark-title-required"));
    }
    const payload: CreateBookmarkInput = {
      folderId: input.folderId ?? null,
      type: "message",
      title,
      content: input.content,
      sessionId: input.sessionId,
      messageId: input.messageId,
      itemKey: input.itemKey ?? null,
      itemLibraryId: input.itemLibraryId ?? null,
    };
    return this.repository().createBookmark(payload);
  }

  async updateBookmark(
    bookmarkId: string,
    patch: Partial<Pick<BookmarkRecord, "title" | "content" | "folderId">>,
  ): Promise<void> {
    await this.repository().updateBookmark(bookmarkId, patch);
  }

  async moveBookmark(
    bookmarkId: string,
    folderId: string | null,
  ): Promise<void> {
    await this.repository().updateBookmark(bookmarkId, { folderId });
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    await this.repository().deleteBookmark(bookmarkId);
  }

  async countBookmarksInFolder(folderId: string): Promise<number> {
    return this.repository().countBookmarksInFolder(folderId);
  }

  async exportAll(): Promise<BookmarkExportPayload> {
    const folders = await this.listFolders();
    const bookmarks = await this.repository().listBookmarks({
      sort: "created_desc",
    });
    return {
      version: 1,
      exportedAt: Date.now(),
      folders,
      bookmarks,
    };
  }

  async importAll(payload: BookmarkExportPayload): Promise<void> {
    if (payload.version !== 1 || !Array.isArray(payload.folders) || !Array.isArray(payload.bookmarks)) {
      throw new Error(getString("chat-bookmark-import-invalid"));
    }
    await this.repository().replaceAll(payload.folders, payload.bookmarks);
  }
}

const services = new Map<number, BookmarkService>();

export function getBookmarkService(
  libraryId = Zotero.Libraries.userLibraryID,
): BookmarkService {
  let service = services.get(libraryId);
  if (!service) {
    service = new BookmarkService(libraryId);
    services.set(libraryId, service);
  }
  return service;
}
