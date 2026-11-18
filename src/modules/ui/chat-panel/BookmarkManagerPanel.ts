import { getBookmarkService } from "../../bookmarks";
import type {
  BookmarkFilterType,
  BookmarkFolder,
  BookmarkRecord,
  BookmarkSortMode,
} from "../../../types/bookmark";
import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { copyToClipboard, createElement } from "./ChatPanelBuilder";
import { createUiChevron, setUiChevronExpanded } from "./UiChevron";
import {
  createBookmarkDragHandle,
  createBookmarkIconButton,
  createBookmarkRowIcon,
  createFolderIcon,
  openBookmarkConfirm,
  openBookmarkTextPrompt,
} from "./BookmarkUiPrompts";
import { sanitizeMessagePreview } from "./HistoryDropdown";
import type { ThemeColors } from "./types";
import { darkTheme, getCurrentTheme, isDarkMode } from "./ChatPanelTheme";

const bookmarkPanelActions = new WeakMap<HTMLElement, BookmarkManagerActions>();

export function attachBookmarkManagerActions(
  panel: HTMLElement,
  actions: BookmarkManagerActions,
): void {
  bookmarkPanelActions.set(panel, actions);
}

export async function reapplyBookmarkManagerPanelTheme(
  container: HTMLElement,
  theme: ThemeColors,
): Promise<void> {
  const panel = getBookmarkManagerPanel(container);
  if (!panel || !isBookmarkManagerVisible(container)) {
    return;
  }
  const actions = bookmarkPanelActions.get(panel);
  if (!actions) {
    return;
  }
  await refreshBookmarkManagerPanel(container, theme, actions);
}

const BOOKMARK_DROP_ROOT = "__bookmark_root__";
const BOOKMARK_DRAG_MIME = "application/x-paperchat-bookmark-id";
const FOLDER_DRAG_MIME = "application/x-paperchat-folder-id";
const FOLDER_DROP_EDGE_RATIO = 0.38;
const FOLDER_DROP_LINE_CLASS = "paperchat-bookmark-folder-drop-line";

interface BookmarkDropContext {
  panel: HTMLElement;
  theme: ThemeColors;
  actions: BookmarkManagerActions;
}

interface FolderTreeNode {
  folder: BookmarkFolder;
  children: FolderTreeNode[];
}

type DragPayload =
  | { type: "bookmark"; id: string }
  | { type: "folder"; id: string };

type FolderDropPlacement = "before" | "after" | "inside";

export interface BookmarkManagerActions {
  onOpenBookmark: (
    bookmark: BookmarkRecord,
    bookmarks: BookmarkRecord[],
    index: number,
  ) => void | Promise<void>;
  onJumpToChat?: (bookmark: BookmarkRecord) => void | Promise<void>;
  onClose?: () => void;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

interface BookmarkManagerState {
  filter: BookmarkFilterType;
  sort: BookmarkSortMode;
  query: string;
  expandedFolderIds: Set<string>;
  selectedFolderId: string | null;
  lastSearchResultCount?: number;
  lastTotalFolderCount?: number;
  lastTotalBookmarkCount?: number;
}

const PANEL_ID = "chat-bookmark-panel";
const BOOKMARK_SEARCH_INPUT_ID = "chat-bookmark-search-input";
const BOOKMARK_SEARCH_CLEAR_ID = "chat-bookmark-search-clear";
const BOOKMARK_TOOLBAR_META_ID = "chat-bookmark-toolbar-meta";
const BOOKMARK_TREE_TOGGLE_ID = "chat-bookmark-tree-toggle";
const BOOKMARK_SEARCH_DEBOUNCE_MS = 250;

const bookmarkSearchDebounceTimers = new WeakMap<
  HTMLElement,
  ReturnType<typeof setTimeout>
>();

function formatBookmarkDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function getBookmarkManagerPanel(
  container: HTMLElement,
): HTMLElement | null {
  return container.querySelector(`#${PANEL_ID}`) as HTMLElement | null;
}

function setComposerVisibleForBookmarkManager(
  container: HTMLElement,
  visible: boolean,
): void {
  const inputArea = container.querySelector(
    "#chat-input-area",
  ) as HTMLElement | null;
  if (inputArea) {
    inputArea.style.display = visible ? "flex" : "none";
  }

  const attachmentsPreview = container.querySelector(
    "#chat-attachments-preview",
  ) as HTMLElement | null;
  if (!attachmentsPreview) {
    return;
  }
  if (!visible) {
    if (!attachmentsPreview.dataset.bookmarkSuppressed) {
      attachmentsPreview.dataset.bookmarkSuppressed =
        attachmentsPreview.style.display || "";
    }
    attachmentsPreview.style.display = "none";
    return;
  }
  if (attachmentsPreview.dataset.bookmarkSuppressed !== undefined) {
    const previousDisplay = attachmentsPreview.dataset.bookmarkSuppressed;
    attachmentsPreview.style.display = previousDisplay;
    delete attachmentsPreview.dataset.bookmarkSuppressed;
  }
}

export function setBookmarkManagerVisible(
  container: HTMLElement,
  visible: boolean,
): void {
  const panel = getBookmarkManagerPanel(container);
  if (!panel) return;
  panel.style.display = visible ? "flex" : "none";
  setComposerVisibleForBookmarkManager(container, !visible);
}

export function isBookmarkManagerVisible(container: HTMLElement): boolean {
  const panel = getBookmarkManagerPanel(container);
  return panel?.style.display === "flex";
}

const BOOKMARK_MANAGER_TOAST_CLASS = "paperchat-bookmark-manager-toast";
const BOOKMARK_MANAGER_TOAST_MS = 3200;

export function showBookmarkManagerToast(
  panel: HTMLElement,
  message: string,
  kind: "error" | "success" = "error",
): void {
  const doc = panel.ownerDocument;
  if (!doc) {
    return;
  }
  panel.querySelector(`.${BOOKMARK_MANAGER_TOAST_CLASS}`)?.remove();

  const isError = kind === "error";
  const toast = createElement(
    doc,
    "div",
    {
      position: "absolute",
      top: "10px",
      left: "50%",
      transform: "translateX(-50%) translateY(-6px)",
      zIndex: "10020",
      maxWidth: "calc(100% - 24px)",
      padding: "8px 14px",
      borderRadius: "10px",
      fontSize: "12px",
      lineHeight: "1.45",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.16)",
      pointerEvents: "auto",
      cursor: "pointer",
      opacity: "0",
      whiteSpace: "normal",
      wordBreak: "break-word",
      transition: "opacity 0.2s ease, transform 0.2s ease",
      background: isError
        ? isDarkMode()
          ? "rgba(127, 29, 29, 0.92)"
          : "#fef2f2"
        : isDarkMode()
          ? "rgba(6, 78, 59, 0.92)"
          : "#ecfdf5",
      border: isError
        ? isDarkMode()
          ? "1px solid rgba(248, 113, 113, 0.45)"
          : "1px solid #fecaca"
        : isDarkMode()
          ? "1px solid rgba(52, 211, 153, 0.45)"
          : "1px solid #a7f3d0",
      color: isDarkMode() ? "#f4f4f5" : isError ? "#991b1b" : "#065f46",
    },
    {
      class: BOOKMARK_MANAGER_TOAST_CLASS,
      role: "status",
      "aria-live": "polite",
    },
  );
  toast.textContent = `${isError ? "⚠️" : "✓"} ${message}`;
  panel.appendChild(toast);

  const win = doc.defaultView ?? Zotero.getMainWindow();
  win.requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  const dismiss = () => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-6px)";
    win.setTimeout(() => toast.remove(), 200);
  };
  const timer = win.setTimeout(dismiss, BOOKMARK_MANAGER_TOAST_MS);
  toast.addEventListener("click", () => {
    win.clearTimeout(timer);
    dismiss();
  });
}

export async function refreshBookmarkManagerPanel(
  container: HTMLElement,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
): Promise<void> {
  const panel = getBookmarkManagerPanel(container);
  if (!panel || panel.style.display === "none") {
    return;
  }
  const state = getBookmarkManagerState(panel);
  syncBookmarkToolbarMeta(panel, state);
  await renderBookmarkManagerBody(panel, theme, actions, state);
}

function getBookmarkManagerState(panel: HTMLElement): BookmarkManagerState {
  const raw = panel.dataset.state;
  if (!raw) {
    const initial: BookmarkManagerState = {
      filter: "all",
      sort: "manual",
      query: "",
      expandedFolderIds: new Set<string>(),
      selectedFolderId: null,
    };
    panel.dataset.state = JSON.stringify({
      ...initial,
      expandedFolderIds: [],
    });
    return initial;
  }
  const parsed = JSON.parse(raw) as {
    filter: BookmarkFilterType;
    sort: BookmarkSortMode;
    query: string;
    expandedFolderIds: string[];
    selectedFolderId: string | null;
  };
  return {
    ...parsed,
    filter: "all",
    expandedFolderIds: new Set(parsed.expandedFolderIds || []),
  };
}

function setBookmarkManagerState(
  panel: HTMLElement,
  state: BookmarkManagerState,
): void {
  panel.dataset.state = JSON.stringify({
    ...state,
    expandedFolderIds: [...state.expandedFolderIds],
  });
}

function normalizeBookmarkSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function bookmarkMatchesSearch(
  bookmark: BookmarkRecord,
  query: string,
): boolean {
  const normalized = normalizeBookmarkSearchQuery(query);
  if (!normalized) {
    return true;
  }
  const haystack = `${bookmark.title}\n${bookmark.content}`.toLowerCase();
  return haystack.includes(normalized);
}

function folderNameMatchesSearch(
  folder: BookmarkFolder,
  query: string,
): boolean {
  const normalized = normalizeBookmarkSearchQuery(query);
  if (!normalized) {
    return false;
  }
  return folder.name.toLowerCase().includes(normalized);
}

function filterBookmarksForSearch(
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolder[],
  query: string,
): BookmarkRecord[] {
  const normalized = normalizeBookmarkSearchQuery(query);
  if (!normalized) {
    return bookmarks;
  }

  const folderNameMatchedIds = new Set(
    folders
      .filter((folder) => folderNameMatchesSearch(folder, query))
      .map((folder) => folder.id),
  );

  return bookmarks.filter(
    (bookmark) =>
      bookmarkMatchesSearch(bookmark, query) ||
      (bookmark.folderId != null &&
        folderNameMatchedIds.has(bookmark.folderId)),
  );
}

function collectVisibleFolderIds(
  folders: BookmarkFolder[],
  bookmarksByFolder: Map<string | null, BookmarkRecord[]>,
  query: string,
  filter: BookmarkFilterType = "all",
): Set<string> {
  const normalized = normalizeBookmarkSearchQuery(query);
  const restrictToMatching = normalized.length > 0 || filter !== "all";
  if (!restrictToMatching) {
    return new Set(folders.map((folder) => folder.id));
  }

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const relevantIds = new Set<string>();

  for (const folder of folders) {
    if (folderNameMatchesSearch(folder, query)) {
      relevantIds.add(folder.id);
    }
  }
  for (const [folderId, items] of bookmarksByFolder) {
    if (folderId && items.length > 0) {
      relevantIds.add(folderId);
    }
  }

  const visible = new Set<string>();
  for (const folderId of relevantIds) {
    let current = folderById.get(folderId);
    while (current) {
      visible.add(current.id);
      current = current.parentId ? folderById.get(current.parentId) : undefined;
    }
  }
  return visible;
}

function pruneFolderTree(
  nodes: FolderTreeNode[],
  visibleFolderIds: Set<string>,
): FolderTreeNode[] {
  const prune = (node: FolderTreeNode): FolderTreeNode | null => {
    const children = node.children
      .map(prune)
      .filter((child): child is FolderTreeNode => child !== null);
    if (!visibleFolderIds.has(node.folder.id) && children.length === 0) {
      return null;
    }
    return { folder: node.folder, children };
  };
  return nodes
    .map(prune)
    .filter((node): node is FolderTreeNode => node !== null);
}

function deriveBookmarkRowPreview(bookmark: BookmarkRecord): string | null {
  const raw = bookmark.content?.trim();
  if (!raw) {
    return null;
  }
  const cleaned = sanitizeMessagePreview(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }
  const title = bookmark.title.trim();
  if (cleaned === title || cleaned.startsWith(title)) {
    const remainder = cleaned.slice(title.length).trim();
    if (!remainder) {
      return null;
    }
    return remainder.length > 180 ? `${remainder.slice(0, 179)}…` : remainder;
  }
  return cleaned.length > 180 ? `${cleaned.slice(0, 179)}…` : cleaned;
}

function appendHighlightedText(
  parent: HTMLElement,
  text: string,
  query: string,
): void {
  const normalized = normalizeBookmarkSearchQuery(query);
  if (!normalized) {
    parent.textContent = text;
    return;
  }

  const lowerText = text.toLowerCase();
  let start = 0;
  let index = lowerText.indexOf(normalized, start);
  if (index < 0) {
    parent.textContent = text;
    return;
  }

  const doc = parent.ownerDocument!;
  while (index >= 0) {
    if (index > start) {
      parent.appendChild(doc.createTextNode(text.slice(start, index)));
    }
    const mark = createElement(doc, "mark");
    mark.textContent = text.slice(index, index + normalized.length);
    parent.appendChild(mark);
    start = index + normalized.length;
    index = lowerText.indexOf(normalized, start);
  }
  if (start < text.length) {
    parent.appendChild(doc.createTextNode(text.slice(start)));
  }
}

function createToolbarIconButton(
  doc: Document,
  iconName: string,
  title: string,
  id: string,
): HTMLButtonElement {
  const button = createElement(
    doc,
    "button",
    {},
    {
      type: "button",
      id,
      title,
      "aria-label": title,
      class: "paperchat-bookmark-toolbar-btn",
    },
  ) as HTMLButtonElement;
  button.appendChild(createBookmarkRowIcon(doc, iconName, 16));
  return button;
}

function syncBookmarkToolbarMeta(
  panel: HTMLElement,
  state: BookmarkManagerState,
): void {
  const searchInput = panel.querySelector(
    `#${BOOKMARK_SEARCH_INPUT_ID}`,
  ) as HTMLInputElement | null;
  const clearButton = panel.querySelector(
    `#${BOOKMARK_SEARCH_CLEAR_ID}`,
  ) as HTMLButtonElement | null;
  const meta = panel.querySelector(
    `#${BOOKMARK_TOOLBAR_META_ID}`,
  ) as HTMLElement | null;
  const treeToggle = panel.querySelector(
    `#${BOOKMARK_TREE_TOGGLE_ID}`,
  ) as HTMLButtonElement | null;

  if (searchInput && searchInput.value !== state.query) {
    searchInput.value = state.query;
  }
  if (clearButton) {
    clearButton.style.display = state.query.trim() ? "inline-flex" : "none";
  }
  if (meta) {
    const isSearchActive = normalizeBookmarkSearchQuery(state.query).length > 0;
    meta.textContent = isSearchActive
      ? getString("chat-bookmark-search-result-count", {
          args: { count: String(state.lastSearchResultCount ?? 0) },
        })
      : getString("chat-bookmark-manager-summary", {
          args: {
            folderCount: String(state.lastTotalFolderCount ?? 0),
            bookmarkCount: String(state.lastTotalBookmarkCount ?? 0),
          },
        });
  }
  if (treeToggle) {
    const hasExpandedFolders = state.expandedFolderIds.size > 0;
    const treeToggleTitle = hasExpandedFolders
      ? getString("chat-bookmark-collapse-all")
      : getString("chat-bookmark-expand-all");
    treeToggle.title = treeToggleTitle;
    treeToggle.setAttribute("aria-label", treeToggleTitle);
    const icon = treeToggle.querySelector("img");
    if (icon) {
      icon.src = `chrome://${config.addonRef}/content/icons/${
        hasExpandedFolders ? "collapse-text-input" : "expand-text-input"
      }.svg`;
    }
  }
}

function scheduleBookmarkSearch(
  panel: HTMLElement,
  onSearch: () => void | Promise<void>,
): void {
  const existing = bookmarkSearchDebounceTimers.get(panel);
  if (existing) {
    clearTimeout(existing);
  }
  bookmarkSearchDebounceTimers.set(
    panel,
    setTimeout(() => {
      bookmarkSearchDebounceTimers.delete(panel);
      void Promise.resolve(onSearch()).catch((error: unknown) => {
        ztoolkit.log("[BookmarkManager] Search refresh failed:", error);
      });
    }, BOOKMARK_SEARCH_DEBOUNCE_MS),
  );
}

async function renderBookmarkManagerBody(
  panel: HTMLElement,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
  state: BookmarkManagerState,
): Promise<void> {
  const body = panel.querySelector(
    "#chat-bookmark-panel-body",
  ) as HTMLElement | null;
  if (!body) return;

  const service = getBookmarkService();
  const folders = await service.listFolders();
  const allBookmarks = await service.listBookmarks({
    filter: state.filter,
    sort: state.sort,
  });
  const searchQuery = state.query;
  const isSearchActive = normalizeBookmarkSearchQuery(searchQuery).length > 0;
  const bookmarks = filterBookmarksForSearch(
    allBookmarks,
    folders,
    searchQuery,
  );
  state.lastSearchResultCount = bookmarks.length;
  state.lastTotalFolderCount = folders.length;
  state.lastTotalBookmarkCount = allBookmarks.length;
  setBookmarkManagerState(panel, state);
  syncBookmarkToolbarMeta(panel, state);

  const bookmarksByFolder = new Map<string | null, BookmarkRecord[]>();
  for (const bookmark of bookmarks) {
    const key = bookmark.folderId;
    const bucket = bookmarksByFolder.get(key) || [];
    bucket.push(bookmark);
    bookmarksByFolder.set(key, bucket);
  }

  const shouldPruneFolders = isSearchActive;
  const visibleFolderIds = collectVisibleFolderIds(
    folders,
    bookmarksByFolder,
    searchQuery,
    state.filter,
  );
  const folderTree = shouldPruneFolders
    ? pruneFolderTree(buildFolderTree(folders), visibleFolderIds)
    : buildFolderTree(folders);

  body.textContent = "";

  const dropContext: BookmarkDropContext = { panel, theme, actions };
  const doc = body.ownerDocument!;
  const rootBookmarks = bookmarksByFolder.get(null) || [];
  if (rootBookmarks.length > 0 || (!isSearchActive && folderTree.length > 0)) {
    body.appendChild(
      renderUngroupedSection(
        panel,
        doc,
        theme,
        actions,
        state,
        bookmarks,
        rootBookmarks,
        dropContext,
        searchQuery,
        isSearchActive,
      ),
    );
  }

  for (const node of folderTree) {
    body.appendChild(
      renderFolderTreeNode(
        panel,
        doc,
        theme,
        actions,
        state,
        node,
        0,
        bookmarks,
        bookmarksByFolder,
        dropContext,
        searchQuery,
        isSearchActive,
        visibleFolderIds,
      ),
    );
  }

  if (bookmarks.length === 0 && folderTree.length === 0) {
    const empty = createElement(
      doc,
      "div",
      {},
      {
        class: "paperchat-bookmark-empty",
      },
    );
    const icon = createBookmarkRowIcon(doc, "bookmark", 24);
    const title = createElement(doc, "strong");
    title.textContent = getString(
      isSearchActive
        ? "chat-bookmark-search-no-results"
        : "chat-bookmark-empty",
    );
    const hint = createElement(doc, "span");
    hint.textContent = getString(
      isSearchActive
        ? "chat-bookmark-search-empty-hint"
        : "chat-bookmark-empty-hint",
    );
    empty.append(icon, title, hint);
    body.appendChild(empty);
  }
}

function buildFolderTree(folders: BookmarkFolder[]): FolderTreeNode[] {
  const childrenByParent = new Map<string | null, BookmarkFolder[]>();
  for (const folder of folders) {
    const bucket = childrenByParent.get(folder.parentId) || [];
    bucket.push(folder);
    childrenByParent.set(folder.parentId, bucket);
  }
  const buildNodes = (parentId: string | null): FolderTreeNode[] =>
    (childrenByParent.get(parentId) || []).map((folder) => ({
      folder,
      children: buildNodes(folder.id),
    }));
  return buildNodes(null);
}

function normalizeDropFolderId(raw: string | undefined): string | null {
  if (!raw || raw === BOOKMARK_DROP_ROOT) {
    return null;
  }
  return raw;
}

function clearDropTargetStyle(element: HTMLElement): void {
  element.style.outline = "";
  element.style.background = "";
  element.style.boxShadow = "";
  element
    .querySelectorAll(`.${FOLDER_DROP_LINE_CLASS}`)
    .forEach((line) => line.remove());
  delete element.dataset.dropPlacement;
}

function applyDropTargetStyle(element: HTMLElement): void {
  element.style.outline = "2px dashed var(--bookmark-accent)";
  element.style.background = "var(--bookmark-accent-soft)";
}

function isFolderDragEvent(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes(FOLDER_DRAG_MIME);
}

function getFolderDropPlacement(
  row: HTMLElement,
  event: DragEvent,
): FolderDropPlacement {
  const rect = row.getBoundingClientRect();
  if (rect.height <= 0) {
    return "inside";
  }
  const ratio = (event.clientY - rect.top) / rect.height;
  if (ratio <= FOLDER_DROP_EDGE_RATIO) {
    return "before";
  }
  if (ratio >= 1 - FOLDER_DROP_EDGE_RATIO) {
    return "after";
  }
  return "inside";
}

function applyFolderDropIndicator(
  row: HTMLElement,
  placement: FolderDropPlacement,
): void {
  clearDropTargetStyle(row);
  row.dataset.dropPlacement = placement;
  if (placement === "inside") {
    applyDropTargetStyle(row);
    return;
  }

  row.style.position = "relative";
  const line = row.ownerDocument!.createElement("div");
  line.className = FOLDER_DROP_LINE_CLASS;
  Object.assign(line.style, {
    position: "absolute",
    left: "8px",
    right: "8px",
    height: "2px",
    borderRadius: "999px",
    background: "var(--bookmark-accent)",
    pointerEvents: "none",
    zIndex: "2",
  });
  line.style[placement === "before" ? "top" : "bottom"] = "-1px";
  row.appendChild(line);
}

function readDragPayload(event: DragEvent): DragPayload | null {
  const folderId = event.dataTransfer?.getData(FOLDER_DRAG_MIME)?.trim();
  if (folderId) {
    return { type: "folder", id: folderId };
  }
  const bookmarkId =
    event.dataTransfer?.getData(BOOKMARK_DRAG_MIME)?.trim() ||
    event.dataTransfer?.getData("text/plain")?.trim();
  if (bookmarkId) {
    return { type: "bookmark", id: bookmarkId };
  }
  return null;
}

async function rerenderBookmarkManager(
  context: BookmarkDropContext,
): Promise<void> {
  const state = getBookmarkManagerState(context.panel);
  await renderBookmarkManagerBody(
    context.panel,
    context.theme,
    context.actions,
    state,
  );
}

async function moveBookmarkToFolder(
  bookmarkId: string,
  targetFolderId: string | null,
  context: BookmarkDropContext,
): Promise<void> {
  const service = getBookmarkService();
  const bookmarks = await service.listBookmarks({
    filter: "all",
    sort: "created_desc",
  });
  const bookmark = bookmarks.find((entry) => entry.id === bookmarkId);
  if (!bookmark || bookmark.folderId === targetFolderId) {
    return;
  }
  await service.moveBookmark(bookmarkId, targetFolderId);
  const state = getBookmarkManagerState(context.panel);
  if (targetFolderId) {
    state.expandedFolderIds.add(targetFolderId);
  }
  setBookmarkManagerState(context.panel, state);
  await rerenderBookmarkManager(context);
  context.actions.onSuccess?.(
    getString("chat-bookmark-moved", { args: { title: bookmark.title } }),
  );
}

async function reorderFolderRelative(
  folderId: string,
  referenceFolderId: string,
  placement: "before" | "after",
  context: BookmarkDropContext,
): Promise<void> {
  const service = getBookmarkService();
  const folders = await service.listFolders();
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) {
    return;
  }
  try {
    await service.reorderFolder(folderId, referenceFolderId, placement);
  } catch (error) {
    context.actions.onError?.(
      error instanceof Error
        ? error.message
        : getString("chat-bookmark-folder-move-invalid"),
    );
    return;
  }
  const state = getBookmarkManagerState(context.panel);
  state.expandedFolderIds.add(folderId);
  setBookmarkManagerState(context.panel, state);
  await rerenderBookmarkManager(context);
  context.actions.onSuccess?.(
    getString("chat-bookmark-folder-reordered", {
      args: { title: folder.name },
    }),
  );
}

async function moveFolderToParent(
  folderId: string,
  targetParentId: string | null,
  context: BookmarkDropContext,
): Promise<void> {
  const service = getBookmarkService();
  const folders = await service.listFolders();
  const folder = folders.find((entry) => entry.id === folderId);
  if (
    !folder ||
    folder.parentId === targetParentId ||
    folderId === targetParentId
  ) {
    return;
  }
  try {
    await service.moveFolder(folderId, targetParentId);
  } catch (error) {
    context.actions.onError?.(
      error instanceof Error
        ? error.message
        : getString("chat-bookmark-folder-move-invalid"),
    );
    return;
  }
  const state = getBookmarkManagerState(context.panel);
  if (targetParentId) {
    state.expandedFolderIds.add(targetParentId);
  }
  state.expandedFolderIds.add(folderId);
  setBookmarkManagerState(context.panel, state);
  await rerenderBookmarkManager(context);
  context.actions.onSuccess?.(
    getString("chat-bookmark-folder-moved", { args: { title: folder.name } }),
  );
}

function attachFolderRowDropTarget(
  row: HTMLElement,
  folder: BookmarkFolder,
  context: BookmarkDropContext,
): void {
  const dropKey = folder.id;
  row.dataset.dropFolderId = dropKey;

  row.addEventListener("dragenter", (event) => {
    event.preventDefault();
  });
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    if (isFolderDragEvent(event)) {
      applyFolderDropIndicator(row, getFolderDropPlacement(row, event));
      return;
    }
    applyDropTargetStyle(row);
  });
  row.addEventListener("dragleave", (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && row.contains(related)) {
      return;
    }
    clearDropTargetStyle(row);
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const placement =
      (row.dataset.dropPlacement as FolderDropPlacement) || "inside";
    clearDropTargetStyle(row);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }
    if (payload.type === "bookmark") {
      void moveBookmarkToFolder(payload.id, folder.id, context);
      return;
    }
    if (payload.id === folder.id) {
      return;
    }
    if (placement === "inside") {
      void moveFolderToParent(payload.id, folder.id, context);
      return;
    }
    void reorderFolderRelative(payload.id, folder.id, placement, context);
  });
}

function attachTreeDropTarget(
  element: HTMLElement,
  folderId: string | null,
  context: BookmarkDropContext,
): void {
  const dropKey = folderId ?? BOOKMARK_DROP_ROOT;
  element.dataset.dropFolderId = dropKey;

  element.addEventListener("dragenter", (event) => {
    event.preventDefault();
  });
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    applyDropTargetStyle(element);
  });
  element.addEventListener("dragleave", (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && element.contains(related)) {
      return;
    }
    clearDropTargetStyle(element);
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDropTargetStyle(element);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }
    const targetFolderId = normalizeDropFolderId(
      element.dataset.dropFolderId || dropKey,
    );
    if (payload.type === "bookmark") {
      void moveBookmarkToFolder(payload.id, targetFolderId, context);
      return;
    }
    void moveFolderToParent(payload.id, targetFolderId, context);
  });
}

function attachBookmarkRowDrag(
  handle: HTMLElement,
  row: HTMLElement,
  bookmark: BookmarkRecord,
  context: BookmarkDropContext,
): void {
  handle.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) {
      return;
    }
    event.stopPropagation();
    event.dataTransfer.setData(BOOKMARK_DRAG_MIME, bookmark.id);
    event.dataTransfer.setData("text/plain", bookmark.id);
    event.dataTransfer.effectAllowed = "move";
    row.style.opacity = "0.55";
  });
  handle.addEventListener("dragend", () => {
    row.style.opacity = "1";
    context.panel
      .querySelectorAll(".paperchat-bookmark-row")
      .forEach((element) => {
        clearDropTargetStyle(element as HTMLElement);
      });
  });
}

function attachBookmarkRowDropTarget(
  row: HTMLElement,
  bookmark: BookmarkRecord,
  context: BookmarkDropContext,
): void {
  const accepts = (event: DragEvent) =>
    !isFolderDragEvent(event) &&
    Array.from(event.dataTransfer?.types || []).includes(BOOKMARK_DRAG_MIME);
  const placement = (event: DragEvent): "before" | "after" => {
    const rect = row.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  row.addEventListener("dragover", (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    applyFolderDropIndicator(row, placement(event));
  });
  row.addEventListener("dragleave", (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && row.contains(related)) return;
    clearDropTargetStyle(row);
  });
  row.addEventListener("drop", (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropTargetStyle(row);
    const payload = readDragPayload(event);
    if (!payload || payload.type !== "bookmark" || payload.id === bookmark.id)
      return;
    void (async () => {
      try {
        await getBookmarkService().reorderBookmark(
          payload.id,
          bookmark.id,
          placement(event),
        );
        const state = getBookmarkManagerState(context.panel);
        state.sort = "manual";
        setBookmarkManagerState(context.panel, state);
        await rerenderBookmarkManager(context);
        context.actions.onSuccess?.(getString("chat-bookmark-reordered"));
      } catch (error) {
        context.actions.onError?.(
          error instanceof Error
            ? error.message
            : getString("chat-bookmark-move-failed"),
        );
      }
    })();
  });
}

function attachFolderRowDrag(
  handle: HTMLElement,
  row: HTMLElement,
  folder: BookmarkFolder,
  panel: HTMLElement,
): void {
  handle.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) {
      return;
    }
    event.stopPropagation();
    event.dataTransfer.setData(FOLDER_DRAG_MIME, folder.id);
    event.dataTransfer.effectAllowed = "move";
    row.style.opacity = "0.55";
  });
  handle.addEventListener("dragend", () => {
    row.style.opacity = "1";
    panel
      .querySelectorAll(".paperchat-bookmark-folder-row")
      .forEach((element) => {
        clearDropTargetStyle(element as HTMLElement);
      });
  });
}

function openBookmarkReader(
  bookmark: BookmarkRecord,
  allBookmarks: BookmarkRecord[],
  actions: BookmarkManagerActions,
): void {
  if (
    bookmark.type !== "message" ||
    !bookmark.sessionId ||
    !bookmark.messageId
  ) {
    actions.onError?.(getString("chat-bookmark-open-unavailable"));
    return;
  }
  const index = allBookmarks.findIndex((entry) => entry.id === bookmark.id);
  if (index < 0) {
    actions.onError?.(getString("chat-bookmark-open-unavailable"));
    return;
  }
  void actions.onOpenBookmark(bookmark, allBookmarks, index);
}

function jumpToBookmarkChat(
  bookmark: BookmarkRecord,
  actions: BookmarkManagerActions,
): void {
  if (
    bookmark.type !== "message" ||
    !bookmark.sessionId ||
    !bookmark.messageId
  ) {
    actions.onError?.(getString("chat-bookmark-open-unavailable"));
    return;
  }
  if (!actions.onJumpToChat) {
    openBookmarkReader(bookmark, [bookmark], actions);
    return;
  }
  void Promise.resolve(actions.onJumpToChat(bookmark)).catch(
    (error: unknown) => {
      actions.onError?.(
        error instanceof Error
          ? error.message
          : getString("chat-bookmark-open-unavailable"),
      );
    },
  );
}

function createBookmarkRow(
  panel: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
  _state: BookmarkManagerState,
  allBookmarks: BookmarkRecord[],
  bookmark: BookmarkRecord,
  depth = 0,
  searchQuery = "",
): HTMLElement {
  const row = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-row",
      "data-bookmark-id": bookmark.id,
    },
  );
  row.style.setProperty("--bookmark-indent", `${Math.min(depth, 4) * 12}px`);
  attachBookmarkRowDropTarget(row, bookmark, { panel, theme, actions });

  const icon = createBookmarkRowIcon(
    doc,
    bookmark.type === "message" ? "quote" : "bookmark",
    16,
  );
  icon.className = "paperchat-bookmark-item-icon";
  const main = createElement(
    doc,
    "button",
    {},
    {
      class: "paperchat-bookmark-item-open",
      type: "button",
    },
  );
  const title = createElement(
    doc,
    "span",
    {},
    {
      class: "paperchat-bookmark-item-title",
      title: bookmark.title,
    },
  );
  appendHighlightedText(title, bookmark.title, searchQuery);
  main.appendChild(title);
  const previewText = deriveBookmarkRowPreview(bookmark);
  if (previewText) {
    const preview = createElement(
      doc,
      "span",
      {},
      {
        class: "paperchat-bookmark-item-preview",
      },
    );
    appendHighlightedText(preview, previewText, searchQuery);
    main.appendChild(preview);
  }

  const footer = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-item-footer",
    },
  );
  const date = createElement(
    doc,
    "span",
    {},
    {
      class: "paperchat-bookmark-item-date",
    },
  );
  date.textContent = formatBookmarkDate(bookmark.createdAt);

  const actionBar = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-row-actions",
    },
  );

  if (bookmark.type === "message") {
    actionBar.appendChild(
      createBookmarkIconButton(
        doc,
        theme,
        "quote",
        getString("chat-bookmark-open-in-chat"),
        () => jumpToBookmarkChat(bookmark, actions),
      ),
    );
  }
  actionBar.appendChild(
    createBookmarkIconButton(doc, theme, "copy", getString("chat-copy"), () => {
      copyToClipboard(bookmark.content || bookmark.title);
      actions.onSuccess?.(getString("chat-bookmark-copied"));
    }),
  );
  actionBar.appendChild(
    createBookmarkIconButton(
      doc,
      theme,
      "write",
      getString("chat-bookmark-edit"),
      async () => {
        const nextTitle = await openBookmarkTextPrompt(doc, theme, {
          title: getString("chat-bookmark-edit"),
          label: getString("chat-bookmark-field-title"),
          defaultValue: bookmark.title,
          confirmLabel: getString("chat-bookmark-save"),
        });
        if (!nextTitle) return;
        await getBookmarkService().updateBookmark(bookmark.id, {
          title: nextTitle.trim(),
        });
        await renderBookmarkManagerBody(
          panel,
          theme,
          actions,
          getBookmarkManagerState(panel),
        );
      },
    ),
  );
  const dragHandle = createBookmarkDragHandle(
    doc,
    theme,
    getString("chat-bookmark-drag-hint"),
  );
  attachBookmarkRowDrag(dragHandle, row, bookmark, { panel, theme, actions });
  actionBar.appendChild(dragHandle);
  actionBar.appendChild(
    createBookmarkIconButton(
      doc,
      theme,
      "trash",
      getString("chat-bookmark-delete"),
      async () => {
        const confirmed = await openBookmarkConfirm(doc, theme, {
          title: getString("chat-bookmark-delete"),
          message: getString("chat-bookmark-delete-confirm"),
          confirmLabel: getString("chat-bookmark-delete"),
          danger: true,
        });
        if (!confirmed) return;
        await getBookmarkService().deleteBookmark(bookmark.id);
        await renderBookmarkManagerBody(
          panel,
          theme,
          actions,
          getBookmarkManagerState(panel),
        );
      },
      { danger: true },
    ),
  );

  main.addEventListener("click", () => {
    openBookmarkReader(bookmark, allBookmarks, actions);
  });

  footer.append(date, actionBar);
  row.append(icon, main, footer);
  return row;
}

function createFolderRow(
  panel: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
  _state: BookmarkManagerState,
  folder: BookmarkFolder,
  bookmarkCount: number,
  expanded: boolean,
  depth: number,
  dropContext: BookmarkDropContext,
  searchQuery = "",
): HTMLElement {
  const row = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-folder-row",
      "data-folder-id": folder.id,
      "data-expanded": String(expanded),
    },
  );
  row.style.setProperty("--bookmark-indent", `${Math.min(depth, 4) * 12}px`);

  const toggle = createElement(
    doc,
    "button",
    {},
    {
      class: "paperchat-bookmark-folder-toggle",
      type: "button",
      "aria-expanded": String(expanded),
      title: folder.name,
    },
  );
  const chevron = createUiChevron(doc, {
    kind: "right",
    size: 12,
    color: "currentColor",
  });
  setUiChevronExpanded(chevron, expanded);
  const name = createElement(
    doc,
    "span",
    {},
    {
      class: "paperchat-bookmark-folder-name",
    },
  );
  appendHighlightedText(name, folder.name, searchQuery);
  toggle.append(chevron, createFolderIcon(doc, "16px"), name);
  toggle.addEventListener("click", async () => {
    const nextState = getBookmarkManagerState(panel);
    if (nextState.expandedFolderIds.has(folder.id)) {
      nextState.expandedFolderIds.delete(folder.id);
    } else {
      nextState.expandedFolderIds.add(folder.id);
    }
    const hadFocus = doc.activeElement === toggle;
    setBookmarkManagerState(panel, nextState);
    await renderBookmarkManagerBody(panel, theme, actions, nextState);
    if (hadFocus && (!doc.activeElement || doc.activeElement === doc.body)) {
      const buttons = Array.from(
        panel.querySelectorAll(".paperchat-bookmark-folder-toggle"),
      ) as HTMLButtonElement[];
      const nextToggle = buttons.find(
        (button) => button.parentElement?.dataset.folderId === folder.id,
      );
      nextToggle?.focus({ preventScroll: true });
    }
  });

  const count = createElement(
    doc,
    "span",
    {},
    {
      class: "paperchat-bookmark-folder-count",
    },
  );
  count.textContent = String(bookmarkCount);

  const actionBar = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-row-actions",
    },
  );

  actionBar.appendChild(
    createBookmarkIconButton(
      doc,
      theme,
      "folder-plus",
      getString("chat-bookmark-create-subfolder"),
      async () => {
        const nameInput = await openBookmarkTextPrompt(doc, theme, {
          title: getString("chat-bookmark-create-subfolder"),
          label: getString("chat-bookmark-new-folder-prompt"),
          confirmLabel: getString("chat-bookmark-save"),
        });
        if (!nameInput) return;
        await getBookmarkService().createSubFolder(folder.id, nameInput);
        const nextState = getBookmarkManagerState(panel);
        nextState.expandedFolderIds.add(folder.id);
        setBookmarkManagerState(panel, nextState);
        await renderBookmarkManagerBody(panel, theme, actions, nextState);
      },
    ),
  );
  actionBar.appendChild(
    createBookmarkIconButton(
      doc,
      theme,
      "write",
      getString("chat-bookmark-edit"),
      async () => {
        const nextName = await openBookmarkTextPrompt(doc, theme, {
          title: getString("chat-bookmark-edit"),
          label: getString("chat-bookmark-new-folder-prompt"),
          defaultValue: folder.name,
          confirmLabel: getString("chat-bookmark-save"),
        });
        if (!nextName) return;
        await getBookmarkService().renameFolder(folder.id, nextName);
        await renderBookmarkManagerBody(
          panel,
          theme,
          actions,
          getBookmarkManagerState(panel),
        );
      },
    ),
  );
  const dragHandle = createBookmarkDragHandle(
    doc,
    theme,
    getString("chat-bookmark-drag-hint"),
  );
  attachFolderRowDrag(dragHandle, row, folder, panel);
  actionBar.appendChild(dragHandle);
  actionBar.appendChild(
    createBookmarkIconButton(
      doc,
      theme,
      "trash",
      getString("chat-bookmark-delete"),
      async () => {
        const confirmed = await openBookmarkConfirm(doc, theme, {
          title: getString("chat-bookmark-delete"),
          message: getString("chat-bookmark-delete-folder-confirm"),
          confirmLabel: getString("chat-bookmark-delete"),
          danger: true,
        });
        if (!confirmed) return;
        await getBookmarkService().deleteFolder(folder.id);
        await renderBookmarkManagerBody(
          panel,
          theme,
          actions,
          getBookmarkManagerState(panel),
        );
      },
      { danger: true },
    ),
  );

  attachFolderRowDropTarget(row, folder, dropContext);
  row.append(toggle, count, actionBar);
  return row;
}

function renderUngroupedSection(
  panel: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
  state: BookmarkManagerState,
  allBookmarks: BookmarkRecord[],
  bookmarks: BookmarkRecord[],
  dropContext: BookmarkDropContext,
  searchQuery = "",
  _isSearchActive = false,
): HTMLElement {
  const section = createElement(
    doc,
    "section",
    {},
    {
      class: "paperchat-bookmark-ungrouped",
    },
  );
  const header = createElement(
    doc,
    "h3",
    {},
    {
      class: "paperchat-bookmark-ungrouped-heading",
    },
  );
  const label = createElement(doc, "span");
  label.textContent = getString("chat-bookmark-ungrouped");
  const count = createElement(
    doc,
    "span",
    {},
    {
      class: "paperchat-bookmark-folder-count",
    },
  );
  count.textContent = String(bookmarks.length);
  header.append(label, count);
  section.appendChild(header);
  attachTreeDropTarget(section, null, dropContext);
  attachTreeDropTarget(header, null, dropContext);
  for (const bookmark of bookmarks) {
    section.appendChild(
      createBookmarkRow(
        panel,
        doc,
        theme,
        actions,
        state,
        allBookmarks,
        bookmark,
        0,
        searchQuery,
      ),
    );
  }
  return section;
}

function renderFolderTreeNode(
  panel: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
  state: BookmarkManagerState,
  node: FolderTreeNode,
  depth: number,
  allBookmarks: BookmarkRecord[],
  bookmarksByFolder: Map<string | null, BookmarkRecord[]>,
  dropContext: BookmarkDropContext,
  searchQuery = "",
  isSearchActive = false,
  visibleFolderIds: Set<string> = new Set(),
): HTMLElement {
  const container = createElement(doc, "div");
  const folder = node.folder;
  const bookmarks = bookmarksByFolder.get(folder.id) || [];
  const expanded =
    isSearchActive && visibleFolderIds.has(folder.id)
      ? true
      : state.expandedFolderIds.has(folder.id);

  container.appendChild(
    createFolderRow(
      panel,
      doc,
      theme,
      actions,
      state,
      folder,
      bookmarks.length,
      expanded,
      depth,
      dropContext,
      searchQuery,
    ),
  );

  if (expanded) {
    for (const bookmark of bookmarks) {
      container.appendChild(
        createBookmarkRow(
          panel,
          doc,
          theme,
          actions,
          state,
          allBookmarks,
          bookmark,
          depth + 1,
          searchQuery,
        ),
      );
    }
    for (const child of node.children) {
      container.appendChild(
        renderFolderTreeNode(
          panel,
          doc,
          theme,
          actions,
          state,
          child,
          depth + 1,
          allBookmarks,
          bookmarksByFolder,
          dropContext,
          searchQuery,
          isSearchActive,
          visibleFolderIds,
        ),
      );
    }
  }

  return container;
}

export function createBookmarkManagerPanel(
  doc: Document,
  theme: ThemeColors,
  actions: BookmarkManagerActions,
): HTMLElement {
  const panel = createElement(
    doc,
    "div",
    {
      position: "absolute",
      inset: "0",
      display: "none",
      flexDirection: "column",
      zIndex: "10002",
    },
    { id: PANEL_ID },
  );
  panel.dataset.theme = theme === darkTheme ? "dark" : "light";

  const toolbar = createElement(
    doc,
    "header",
    {},
    {
      class: "paperchat-bookmark-toolbar",
    },
  );
  const headerRow = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-head",
    },
  );
  const brand = createElement(
    doc,
    "span",
    {
      maskImage: `url("chrome://${config.addonRef}/content/icons/bookmark.svg")`,
    },
    {
      class: "paperchat-bookmark-brand",
      "aria-hidden": "true",
    },
  );
  const headerMain = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-heading",
    },
  );
  const title = createElement(doc, "h2");
  title.textContent = getString("chat-bookmarks");
  const toolbarMeta = createElement(
    doc,
    "div",
    {},
    {
      id: BOOKMARK_TOOLBAR_META_ID,
      "aria-live": "polite",
    },
  );

  const closeBtn = createToolbarIconButton(
    doc,
    "close",
    getString("chat-bookmark-close"),
    "chat-bookmark-close-btn",
  );
  const searchRow = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-search-row",
    },
  );
  const searchWrap = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-bookmark-search-field",
    },
  );
  const searchInput = createElement(
    doc,
    "input",
    {},
    {
      id: BOOKMARK_SEARCH_INPUT_ID,
      type: "search",
      placeholder: getString("chat-bookmark-search-placeholder"),
      "aria-label": getString("chat-bookmark-search-placeholder"),
    },
  ) as HTMLInputElement;
  const searchClearBtn = createToolbarIconButton(
    doc,
    "close",
    getString("chat-bookmark-search-clear"),
    BOOKMARK_SEARCH_CLEAR_ID,
  );
  const treeToggleBtn = createToolbarIconButton(
    doc,
    "expand-text-input",
    getString("chat-bookmark-expand-all"),
    BOOKMARK_TREE_TOGGLE_ID,
  );
  const newFolderBtn = createToolbarIconButton(
    doc,
    "folder-plus",
    getString("chat-bookmark-new-folder"),
    "chat-bookmark-new-folder-btn",
  );
  const newFolderLabel = createElement(doc, "span");
  newFolderLabel.textContent = getString("chat-bookmark-new-folder");
  newFolderBtn.appendChild(newFolderLabel);

  const body = createElement(
    doc,
    "div",
    {},
    { id: "chat-bookmark-panel-body" },
  );

  const rerender = async () => {
    const state = getBookmarkManagerState(panel);
    await renderBookmarkManagerBody(panel, getCurrentTheme(), actions, state);
  };

  const applySearchQuery = async (query: string) => {
    const state = getBookmarkManagerState(panel);
    state.query = query;
    setBookmarkManagerState(panel, state);
    await rerender();
  };

  searchInput.addEventListener("input", () => {
    const nextQuery = searchInput.value;
    searchClearBtn.style.display = nextQuery.trim() ? "inline-flex" : "none";
    const state = getBookmarkManagerState(panel);
    state.query = nextQuery;
    setBookmarkManagerState(panel, state);
    scheduleBookmarkSearch(panel, () => applySearchQuery(nextQuery));
  });

  searchClearBtn.addEventListener("click", async () => {
    searchInput.value = "";
    searchClearBtn.style.display = "none";
    searchInput.focus();
    const debounceTimer = bookmarkSearchDebounceTimers.get(panel);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      bookmarkSearchDebounceTimers.delete(panel);
    }
    await applySearchQuery("");
  });

  closeBtn.addEventListener("click", () => {
    actions.onClose?.();
  });

  newFolderBtn.addEventListener("click", async () => {
    const name = await openBookmarkTextPrompt(doc, getCurrentTheme(), {
      title: getString("chat-bookmark-new-folder"),
      label: getString("chat-bookmark-new-folder-prompt"),
      confirmLabel: getString("chat-bookmark-save"),
    });
    if (!name) return;
    await getBookmarkService().createFolder(name);
    await rerender();
  });

  treeToggleBtn.addEventListener("click", async () => {
    const state = getBookmarkManagerState(panel);
    if (state.expandedFolderIds.size > 0) {
      state.expandedFolderIds = new Set<string>();
    } else {
      const folders = await getBookmarkService().listFolders();
      state.expandedFolderIds = new Set(folders.map((folder) => folder.id));
    }
    setBookmarkManagerState(panel, state);
    syncBookmarkToolbarMeta(panel, state);
    await rerender();
  });

  searchWrap.append(searchInput, searchClearBtn);
  searchRow.append(searchWrap, treeToggleBtn);
  headerMain.append(title, toolbarMeta);
  headerRow.append(brand, headerMain, newFolderBtn, closeBtn);
  toolbar.append(headerRow, searchRow);
  panel.appendChild(toolbar);
  panel.appendChild(body);
  syncBookmarkToolbarMeta(panel, getBookmarkManagerState(panel));
  return panel;
}
