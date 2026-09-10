export type BookmarkType = "message" | "page";

export type BookmarkSortMode = "created_desc" | "title_asc";

export type BookmarkFilterType = "all" | BookmarkType;

export interface BookmarkFolder {
  id: string;
  libraryId: number;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkRecord {
  id: string;
  libraryId: number;
  folderId: string | null;
  type: BookmarkType;
  title: string;
  content: string;
  sessionId: string | null;
  messageId: string | null;
  itemKey: string | null;
  itemLibraryId: number | null;
  pageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateBookmarkInput {
  folderId?: string | null;
  type: BookmarkType;
  title: string;
  content: string;
  sessionId?: string | null;
  messageId?: string | null;
  itemKey?: string | null;
  itemLibraryId?: number | null;
  pageUrl?: string | null;
}

export interface BookmarkExportPayload {
  version: 1;
  exportedAt: number;
  folders: BookmarkFolder[];
  bookmarks: BookmarkRecord[];
}
