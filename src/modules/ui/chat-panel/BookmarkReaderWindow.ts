import { config } from "../../../../package.json";
import {
  type BookmarkTurnContent,
  prepareReaderAssistantContent,
  resolveBookmarkTurnContent,
} from "../../bookmarks/bookmarkTurnContent";
import type { BookmarkRecord } from "../../../types/bookmark";
import type { ChatSession } from "../../../types/chat";
import type { QuotedMessageRef } from "../../../types/chat";
import type { ConversationDeletionListener } from "../../chat/ChatManager";
import {
  deriveBookmarkTitle,
  isPersistedBookmarkRecord,
} from "../../bookmarks";
import { getString } from "../../../utils/locale";
import { isWindowAlive } from "../../../utils/window";
import { copyToClipboard, createElement } from "./ChatPanelBuilder";
import { darkTheme, getCurrentTheme } from "./ChatPanelTheme";
import { createEvidenceMarkdownAction } from "./EvidenceMarkdownAction";
import { renderMarkdownToElement } from "./MarkdownRenderer";
import type { ThemeColors } from "./types";
import { createUiChevron } from "./UiChevron";
import { sanitizeMessagePreview } from "./HistoryDropdown";
import { setupChatHistorySelectionQuote } from "./ChatHistorySelectionQuote";
import { bindWindowPinButton, createWindowPinIcon } from "./FloatingWindowPin";

const READER_WINDOW_NAME = "paperchat-bookmark-reader";
const READER_HOST_ID = "bookmark-reader-root";
const READER_OUTLINE_TOGGLE_ID = "chat-bookmark-reader-outline-toggle";
const READER_OUTLINE_PANEL_ID = "chat-bookmark-reader-outline-panel";
const READER_BOOKMARK_BTN_ID = "chat-bookmark-reader-bookmark";
const READER_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

interface ReaderHeading {
  level: number;
  text: string;
  element: HTMLElement;
}

interface ReaderOutlineController {
  dispose: () => void;
}

const readerOutlineControllers = new WeakMap<
  HTMLElement,
  ReaderOutlineController
>();

export type BookmarkReaderToggleResult =
  | { status: "saved"; bookmark: BookmarkRecord }
  | { status: "removed" }
  | { status: "cancelled" };

/** Host document for bookmark UI opened from the reader window. */
export interface BookmarkReaderDialogHost {
  document: Document;
  theme: ThemeColors;
  present?: () => void;
}

export interface BookmarkReaderActions {
  onJumpToChat: (quote: QuotedMessageRef) => void | Promise<void>;
  onQuoteAssistantExcerpt?: (
    messageId: string,
    excerpt: string,
  ) => void | Promise<void>;
  onClose: () => void;
  onCopySuccess?: (message: string) => void;
  loadSession?: (sessionId: string) => Promise<ChatSession | null>;
  subscribeToConversationDeletion?: (
    listener: ConversationDeletionListener,
  ) => () => void;
  isBookmarkSaved?: (bookmark: BookmarkRecord) => Promise<boolean>;
  onToggleBookmark?: (
    bookmark: BookmarkRecord,
    host: BookmarkReaderDialogHost,
  ) => Promise<BookmarkReaderToggleResult>;
  onBookmarkError?: (message: string) => void;
}

interface ReaderOpenState {
  bookmarks: BookmarkRecord[];
  startIndex: number;
  actions: BookmarkReaderActions;
}

let readerWindow: Window | null = null;
let activeOpenState: ReaderOpenState | null = null;
let renderGeneration = 0;
let unsubscribeFromConversationDeletion: (() => void) | undefined;
const readerHosts = new WeakMap<HTMLElement, Window>();

function toQuotedMessageRef(bookmark: BookmarkRecord): QuotedMessageRef | null {
  if (
    bookmark.type !== "message" ||
    !bookmark.sessionId ||
    !bookmark.messageId
  ) {
    return null;
  }
  return {
    sessionId: bookmark.sessionId,
    messageId: bookmark.messageId,
    role: "assistant",
    preview: bookmark.title,
    contentSnapshot: bookmark.content,
    timestamp: bookmark.createdAt,
  };
}

function readerIconMask(iconName: string): string {
  return `url("chrome://${config.addonRef}/content/icons/${iconName}.svg")`;
}

function createIconButton(
  doc: Document,
  id: string,
  title: string,
  iconName?: string,
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
      class: "paperchat-reader-button",
    },
  ) as HTMLButtonElement;
  if (iconName) {
    button.appendChild(
      createElement(
        doc,
        "span",
        {
          maskImage: readerIconMask(iconName),
        },
        { class: "paperchat-reader-icon", "aria-hidden": "true" },
      ),
    );
  }
  return button;
}

function setReaderBookmarkButtonState(
  button: HTMLButtonElement | null,
  isSaved: boolean,
): void {
  if (!button) return;
  button.title = getString(
    isSaved
      ? "chat-bookmark-reader-toggle-remove"
      : "chat-bookmark-reader-toggle-save",
  );
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(isSaved));
  const icon = button.firstElementChild as HTMLElement | null;
  if (icon)
    icon.style.maskImage = readerIconMask(
      isSaved ? "bookmark-filled" : "bookmark",
    );
}

function collectReaderHeadings(
  markdownRoot: HTMLElement | null,
): ReaderHeading[] {
  if (!markdownRoot) {
    return [];
  }
  const headings: ReaderHeading[] = [];
  markdownRoot.querySelectorAll(READER_HEADING_SELECTOR).forEach((node) => {
    const element = node as HTMLElement;
    const level = Number(element.tagName.slice(1));
    const text = element.textContent?.trim() || "";
    if (!text) {
      return;
    }
    if (!element.id) {
      element.id = `paperchat-reader-heading-${headings.length}`;
    }
    headings.push({ level, text, element });
  });
  return headings;
}

function resolveActiveHeadingIndex(
  scrollContainer: HTMLElement,
  headings: ReaderHeading[],
): number {
  if (headings.length === 0) {
    return -1;
  }
  const maxScrollTop =
    scrollContainer.scrollHeight - scrollContainer.clientHeight;
  if (maxScrollTop > 0 && scrollContainer.scrollTop >= maxScrollTop - 1) {
    return headings.length - 1;
  }
  const containerTop = scrollContainer.getBoundingClientRect().top;
  const anchor = containerTop + 72;
  let activeIndex = 0;
  for (let index = 0; index < headings.length; index += 1) {
    const top = headings[index].element.getBoundingClientRect().top;
    if (top <= anchor) {
      activeIndex = index;
    }
  }
  return activeIndex;
}

function scrollReaderToHeading(
  scrollContainer: HTMLElement,
  heading: ReaderHeading,
): void {
  const paddingTop = 16;
  const containerRect = scrollContainer.getBoundingClientRect();
  const headingRect = heading.element.getBoundingClientRect();
  const relativeTop =
    scrollContainer.scrollTop + (headingRect.top - containerRect.top);
  const maxScrollTop = Math.max(
    0,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  const targetScrollTop = Math.min(
    Math.max(0, relativeTop - paddingTop),
    maxScrollTop,
  );
  scrollContainer.scrollTo({
    top: targetScrollTop,
    behavior: scrollContainer.ownerDocument.defaultView?.matchMedia(
      "(prefers-reduced-motion: reduce)",
    )?.matches
      ? "auto"
      : "smooth",
  });
}

function setupReaderOutline(
  host: HTMLElement,
  scrollContainer: HTMLElement,
): void {
  readerOutlineControllers.get(host)?.dispose();
  readerOutlineControllers.delete(host);

  const panel = host.querySelector(
    `#${READER_OUTLINE_PANEL_ID}`,
  ) as HTMLElement;
  const toggle = host.querySelector(
    `#${READER_OUTLINE_TOGGLE_ID}`,
  ) as HTMLButtonElement;
  const list = panel.querySelector(
    ".paperchat-reader-outline-list",
  ) as HTMLElement;
  const markdownRoot = scrollContainer.querySelector(
    ".paperchat-reader-section--assistant .paperchat-reader-markdown",
  ) as HTMLElement | null;
  const headings = collectReaderHeadings(markdownRoot);
  list.replaceChildren();
  toggle.hidden = headings.length === 0;
  if (!headings.length) {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    return;
  }

  const doc = host.ownerDocument;
  const wide = doc.defaultView?.matchMedia("(min-width: 720px)");
  const setVisible = (visible: boolean) => {
    panel.hidden = !visible;
    toggle.setAttribute("aria-expanded", String(visible));
  };
  const syncVisibility = () => {
    setVisible(
      host.dataset.outlineOpen === undefined
        ? Boolean(wide?.matches)
        : host.dataset.outlineOpen === "true",
    );
  };
  const onToggle = () => {
    host.dataset.outlineOpen = String(panel.hidden);
    syncVisibility();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !panel.hidden && !wide?.matches) {
      host.dataset.outlineOpen = "false";
      syncVisibility();
      toggle.focus();
    }
  };

  const firstLevel = Math.min(...headings.map(({ level }) => level));
  const items = headings.map((heading, index) => {
    const item = createElement(
      doc,
      "button",
      {},
      {
        type: "button",
        class: "paperchat-reader-outline-item",
        title: heading.text,
      },
    );
    item.style.setProperty(
      "--reader-outline-indent",
      `${(heading.level - firstLevel) * 9}px`,
    );
    item.textContent = heading.text;
    item.addEventListener("click", () => {
      scrollReaderToHeading(scrollContainer, heading);
      setActive(index);
      if (!wide?.matches) {
        host.dataset.outlineOpen = "false";
        syncVisibility();
        toggle.focus();
      }
    });
    list.appendChild(item);
    return item;
  });
  let active = -1;
  const setActive = (next: number) => {
    if (next === active) return;
    items[active]?.removeAttribute("aria-current");
    items[next]?.setAttribute("aria-current", "location");
    active = next;
    if (!panel.hidden) {
      items[next]?.scrollIntoView?.({ block: "nearest" });
    }
  };
  const onScroll = () =>
    setActive(resolveActiveHeadingIndex(scrollContainer, headings));
  scrollContainer.addEventListener("scroll", onScroll, { passive: true });
  toggle.addEventListener("click", onToggle);
  host.addEventListener("keydown", onEscape);
  wide?.addEventListener("change", syncVisibility);
  syncVisibility();
  onScroll();

  readerOutlineControllers.set(host, {
    dispose: () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      toggle.removeEventListener("click", onToggle);
      host.removeEventListener("keydown", onEscape);
      wide?.removeEventListener("change", syncVisibility);
    },
  });
}

function renderReaderQuestion(doc: Document, question: string): HTMLElement {
  const details = createElement(
    doc,
    "details",
    {},
    {
      class: "paperchat-reader-question",
    },
  );
  const summary = createElement(doc, "summary");
  summary.append(
    createUiChevron(doc, { kind: "right", size: 14, opacity: 1 }),
    getString("chat-bookmark-reader-user-message"),
  );
  const body = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-reader-question-text",
    },
  );
  body.textContent = question;
  details.append(summary, body);
  return details;
}

function updateReaderTitle(
  host: HTMLElement,
  bookmark: BookmarkRecord,
  question?: string | null,
): void {
  const readerLabel = getString("chat-bookmark-reader-title");
  let label = bookmark.title.trim() || readerLabel;
  if (
    question &&
    label === deriveBookmarkTitle(question) &&
    label !== sanitizeMessagePreview(question)
  ) {
    label =
      getReaderPaperTitle(bookmark) ||
      getReaderAnswerTitle(host) ||
      readerLabel;
  }
  const heading = host.querySelector(
    "#chat-bookmark-reader-title",
  ) as HTMLElement;
  heading.textContent = label;
  heading.title = label;
  host.ownerDocument.title =
    label === readerLabel ? label : `${readerLabel} - ${label}`;
}

function getReaderPaperTitle(bookmark: BookmarkRecord): string {
  if (!bookmark.itemKey) return "";
  try {
    const libraryId = bookmark.itemLibraryId ?? bookmark.libraryId;
    const item = Zotero.Items.getByLibraryAndKey(libraryId, bookmark.itemKey);
    return item
      ? String((item.parentItem ?? item).getField("title") || "").trim()
      : "";
  } catch {
    return "";
  }
}

function getReaderAnswerTitle(host: HTMLElement): string {
  const answer = host.querySelector(".paperchat-reader-markdown");
  const heading = answer
    ?.querySelector(READER_HEADING_SELECTOR)
    ?.textContent?.trim();
  const paragraph = answer?.querySelector("p")?.textContent?.trim();
  const firstSentence = paragraph
    ?.split(/[。！？!?]|\.(?=\s|$)/u, 1)[0]
    ?.trim();
  const summary = heading || firstSentence;
  return summary ? deriveBookmarkTitle(summary) : "";
}

function updateReaderProgress(
  host: HTMLElement,
  scrollContainer: HTMLElement,
): void {
  const maxScrollTop =
    scrollContainer.scrollHeight - scrollContainer.clientHeight;
  if (maxScrollTop <= 4) {
    host.style.setProperty("--reader-progress", "0");
    host.dataset.scrollable = "false";
    return;
  }
  const progress = Math.min(
    1,
    Math.max(0, scrollContainer.scrollTop / maxScrollTop),
  );
  host.style.setProperty("--reader-progress", progress.toFixed(4));
  host.dataset.scrollable = "true";
}

function paintReaderBody(
  host: HTMLElement,
  turn: BookmarkTurnContent,
  readerActions?: BookmarkReaderActions,
): void {
  const evidenceAction = turn.evidenceRecords?.length
    ? createEvidenceMarkdownAction({
        onError: (error) => {
          readerActions?.onBookmarkError?.(
            `${getString("chat-open-source-failed")}: ${error.message}`,
          );
        },
      })
    : undefined;
  const body = host.querySelector(
    "#chat-bookmark-reader-body",
  ) as HTMLElement | null;
  if (!body) {
    ztoolkit.log("[BookmarkReader] Body element not found");
    return;
  }

  body.textContent = "";
  const doc = body.ownerDocument!;

  const contentWrap = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-reader-content",
    },
  );
  const question = turn.userContent?.trim();
  if (question) {
    contentWrap.appendChild(renderReaderQuestion(doc, question));
  }

  const answer = createElement(
    doc,
    "section",
    {},
    {
      class: "paperchat-reader-section--assistant",
    },
  );
  if (turn.assistantMessageId) {
    answer.dataset.messageId = turn.assistantMessageId;
  }
  const label = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-reader-section-label",
    },
  );
  if (turn.sourceMissing) {
    label.dataset.state = "archived";
  }
  label.textContent = getString(
    turn.sourceMissing
      ? "chat-bookmark-reader-saved-copy"
      : "chat-bookmark-reader-assistant-message",
  );
  const markdown = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-reader-markdown",
    },
  );
  const content = turn.assistantContent.trim();
  if (!content) {
    markdown.textContent = getString("chat-bookmark-reader-empty-content");
  } else {
    try {
      renderMarkdownToElement(markdown, content, turn.assistantMessageId, {
        suppressToolCallCards: true,
        evidenceRecords: turn.evidenceRecords,
        evidenceAction,
      });
    } catch (error) {
      ztoolkit.log("[BookmarkReader] Markdown render failed:", error);
      markdown.textContent = content;
    }
  }
  answer.append(label, markdown);
  contentWrap.appendChild(answer);
  body.appendChild(contentWrap);
  setupReaderOutline(host, body);
  updateReaderProgress(host, body);
}

function updateReaderPosition(
  host: HTMLElement,
  bookmarks: BookmarkRecord[],
  index: number,
): void {
  const footerPosition = host.querySelector(
    "#chat-bookmark-reader-footer-position",
  ) as HTMLElement | null;
  const label = `${index + 1} / ${bookmarks.length}`;
  if (footerPosition) {
    footerPosition.textContent = label;
    footerPosition.parentElement!.hidden = bookmarks.length < 2;
  }

  const prevBtn = host.querySelector(
    "#chat-bookmark-reader-prev",
  ) as HTMLButtonElement | null;
  const nextBtn = host.querySelector(
    "#chat-bookmark-reader-next",
  ) as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = index <= 0;
  if (nextBtn) nextBtn.disabled = index >= bookmarks.length - 1;
}

function getReaderDialogHost(host: HTMLElement): BookmarkReaderDialogHost {
  const win = readerHosts.get(host) ?? readerWindow;
  return {
    document: host.ownerDocument,
    theme: getCurrentTheme(),
    present: () => {
      if (win && isWindowAlive(win)) {
        bringReaderWindowToFront(win);
      }
    },
  };
}

function buildReaderShell(
  host: HTMLElement,
  theme: ThemeColors,
  win: Window,
): void {
  readerOutlineControllers.get(host)?.dispose();
  readerOutlineControllers.delete(host);
  const doc = host.ownerDocument;
  host.dataset.theme = theme === darkTheme ? "dark" : "light";

  const header = createElement(
    doc,
    "header",
    {},
    {
      class: "paperchat-reader-header",
    },
  );
  const title = createElement(
    doc,
    "h1",
    {},
    { id: "chat-bookmark-reader-title" },
  );
  const actions = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-reader-actions" },
  );

  const outlineToggle = createIconButton(
    doc,
    READER_OUTLINE_TOGGLE_ID,
    getString("chat-bookmark-reader-outline"),
    "right-bar",
  );
  outlineToggle.hidden = true;
  outlineToggle.setAttribute("aria-controls", READER_OUTLINE_PANEL_ID);
  outlineToggle.setAttribute("aria-expanded", "false");
  const bookmarkBtn = createIconButton(
    doc,
    READER_BOOKMARK_BTN_ID,
    getString("chat-bookmark-reader-toggle-save"),
    "bookmark",
  );
  bookmarkBtn.setAttribute("aria-pressed", "false");
  const pinBtn = createIconButton(
    doc,
    "chat-bookmark-reader-pin",
    getString("chat-pin-window"),
  );
  pinBtn.appendChild(createWindowPinIcon(doc));
  bindWindowPinButton(pinBtn, win, (message) => win.alert(message));
  actions.append(
    outlineToggle,
    bookmarkBtn,
    createIconButton(
      doc,
      "chat-bookmark-reader-jump",
      getString("chat-bookmark-reader-jump-to-chat"),
      "quote",
    ),
    createIconButton(
      doc,
      "chat-bookmark-reader-copy",
      getString("chat-copy"),
      "copy",
    ),
    createElement(
      doc,
      "span",
      {},
      { class: "paperchat-reader-divider", "aria-hidden": "true" },
    ),
    pinBtn,
    createIconButton(
      doc,
      "chat-bookmark-reader-close",
      getString("chat-bookmark-close"),
      "close",
    ),
  );
  const progressBar = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-reader-progress", "aria-hidden": "true" },
  );
  header.append(title, actions, progressBar);

  const bodyWrap = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-reader-body-wrap" },
  );
  const body = createElement(
    doc,
    "main",
    {},
    { id: "chat-bookmark-reader-body" },
  );
  const outline = createElement(
    doc,
    "nav",
    {},
    {
      id: READER_OUTLINE_PANEL_ID,
      "aria-label": getString("chat-bookmark-reader-outline"),
    },
  );
  outline.hidden = true;
  const outlineHeading = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-reader-outline-heading" },
  );
  outlineHeading.textContent = getString("chat-bookmark-reader-outline");
  outline.append(
    outlineHeading,
    createElement(doc, "div", {}, { class: "paperchat-reader-outline-list" }),
  );
  bodyWrap.append(body, outline);

  const footer = createElement(
    doc,
    "footer",
    {},
    { class: "paperchat-reader-footer" },
  );
  const previous = createIconButton(
    doc,
    "chat-bookmark-reader-prev",
    getString("chat-bookmark-reader-previous"),
  );
  previous.appendChild(
    createUiChevron(doc, { kind: "right", size: 16, opacity: 1 }),
  );
  const next = createIconButton(
    doc,
    "chat-bookmark-reader-next",
    getString("chat-bookmark-reader-next"),
  );
  next.appendChild(
    createUiChevron(doc, { kind: "right", size: 16, opacity: 1 }),
  );
  const position = createElement(
    doc,
    "span",
    {},
    {
      id: "chat-bookmark-reader-footer-position",
      "aria-live": "polite",
    },
  );
  footer.append(previous, position, next);
  host.replaceChildren(header, bodyWrap, footer);
}

function bindReaderEvents(host: HTMLElement, state: ReaderOpenState): void {
  let { bookmarks } = state;
  let currentIndex = state.startIndex;
  const generation = renderGeneration;
  let pageRequest = 0;
  let currentTurn: BookmarkTurnContent | undefined;
  let bookmarkPending = false;
  const bookmarkBtn = host.querySelector(
    `#${READER_BOOKMARK_BTN_ID}`,
  ) as HTMLButtonElement | null;
  const copyBtn = host.querySelector<HTMLButtonElement>(
    "#chat-bookmark-reader-copy",
  )!;
  const jumpBtn = host.querySelector<HTMLButtonElement>(
    "#chat-bookmark-reader-jump",
  )!;
  const readerBody = host.querySelector<HTMLElement>(
    "#chat-bookmark-reader-body",
  )!;
  const loadSession = state.actions.loadSession;

  const syncBookmarkButton = async (
    bookmark: BookmarkRecord,
    request: number,
  ) => {
    if (!bookmarkBtn) return;
    if (
      !state.actions.isBookmarkSaved ||
      !state.actions.onToggleBookmark ||
      !bookmark.sessionId ||
      !bookmark.messageId
    ) {
      bookmarkBtn.hidden = true;
      return;
    }
    bookmarkBtn.hidden = false;
    try {
      const isSaved = await state.actions.isBookmarkSaved(bookmark);
      if (generation !== renderGeneration || request !== pageRequest) {
        return;
      }
      setReaderBookmarkButtonState(bookmarkBtn, isSaved);
    } catch (error) {
      ztoolkit.log("[BookmarkReader] Failed to resolve bookmark state:", error);
    }
  };

  const showBookmarkAt = async (index: number) => {
    if (index < 0 || index >= bookmarks.length) {
      ztoolkit.log(
        "[BookmarkReader] Invalid bookmark index:",
        index,
        bookmarks.length,
      );
      return;
    }

    const request = ++pageRequest;
    currentIndex = index;
    currentTurn = undefined;
    const bookmark = bookmarks[currentIndex];
    updateReaderPosition(host, bookmarks, currentIndex);
    updateReaderTitle(host, bookmark);
    copyBtn.disabled = true;
    jumpBtn.disabled = true;
    if (bookmarkBtn) bookmarkBtn.disabled = true;
    readerBody.replaceChildren();
    readerBody.scrollTop = 0;
    host.style.setProperty("--reader-progress", "0");
    host.dataset.scrollable = "false";
    setupReaderOutline(host, readerBody);
    const turn = loadSession
      ? await resolveBookmarkTurnContent(bookmark, loadSession)
      : {
          userContent: null,
          assistantContent: prepareReaderAssistantContent(bookmark.content),
          assistantMessageId: bookmark.messageId ?? undefined,
        };
    if (generation !== renderGeneration || request !== pageRequest) return;
    if (
      (turn.sourceMissing || turn.sourceUnreadable) &&
      !isPersistedBookmarkRecord(bookmark)
    ) {
      removeDeletedReplies((entry) => entry === bookmark);
      return;
    }
    currentTurn = turn;
    paintReaderBody(host, turn, state.actions);
    updateReaderTitle(host, bookmark, turn.userContent);
    copyBtn.disabled = !turn.assistantContent;
    jumpBtn.disabled = Boolean(
      turn.sourceMissing || !toQuotedMessageRef(bookmark),
    );
    if (bookmarkBtn) {
      bookmarkBtn.disabled = bookmarkPending;
      setReaderBookmarkButtonState(
        bookmarkBtn,
        isPersistedBookmarkRecord(bookmark),
      );
    }
    void syncBookmarkButton(bookmark, request);
  };

  const removeDeletedReplies = (
    wasDeleted: (entry: BookmarkRecord) => boolean,
  ) => {
    const current = bookmarks[currentIndex];
    if (!bookmarks.some(wasDeleted)) return;
    const keep = (entry: BookmarkRecord) =>
      isPersistedBookmarkRecord(entry) || !wasDeleted(entry);
    const nextIndex = bookmarks.slice(0, currentIndex).filter(keep).length;
    bookmarks = bookmarks.filter(keep);
    if (!bookmarks.length) {
      closeBookmarkReader(readerHosts.get(host));
    } else if (wasDeleted(current)) {
      void showBookmarkAt(Math.min(nextIndex, bookmarks.length - 1));
    } else {
      currentIndex = nextIndex;
      updateReaderPosition(host, bookmarks, currentIndex);
    }
  };

  unsubscribeFromConversationDeletion =
    state.actions.subscribeToConversationDeletion?.((sessionId, ids) =>
      removeDeletedReplies(
        (entry) =>
          entry.sessionId === sessionId &&
          (!ids || Boolean(entry.messageId && ids.has(entry.messageId))),
      ),
    );

  host
    .querySelector(`#${READER_BOOKMARK_BTN_ID}`)
    ?.addEventListener("click", () => {
      if (
        !bookmarkBtn ||
        !state.actions.onToggleBookmark ||
        bookmarkBtn.disabled ||
        !currentTurn
      ) {
        return;
      }
      const bookmark = bookmarks[currentIndex];
      bookmarkPending = true;
      bookmarkBtn.disabled = true;
      bookmarkBtn.style.cursor = "wait";
      bookmarkBtn.style.opacity = "0.6";
      void Promise.resolve(
        state.actions.onToggleBookmark(bookmark, getReaderDialogHost(host)),
      )
        .then(async (result) => {
          if (generation !== renderGeneration) {
            return;
          }
          if (result.status === "cancelled") {
            return;
          }
          const index = bookmarks.indexOf(bookmark);
          if (index < 0) return;
          if (result.status === "saved") {
            bookmarks[index] = result.bookmark;
            state.actions.onCopySuccess?.(
              getString("chat-bookmark-saved", {
                args: { title: result.bookmark.title },
              }),
            );
            if (index === currentIndex)
              setReaderBookmarkButtonState(bookmarkBtn, true);
            return;
          }
          state.actions.onCopySuccess?.(getString("chat-bookmark-removed"));
          if (isPersistedBookmarkRecord(bookmark)) {
            bookmarks.splice(index, 1);
            if (!bookmarks.length) {
              const win =
                readerHosts.get(host) ?? host.ownerDocument.defaultView;
              closeBookmarkReader(win);
              return;
            }
            if (index === currentIndex) {
              await showBookmarkAt(Math.min(index, bookmarks.length - 1));
            } else {
              if (index < currentIndex) currentIndex -= 1;
              updateReaderPosition(host, bookmarks, currentIndex);
            }
            return;
          }
          if (index === currentIndex)
            setReaderBookmarkButtonState(bookmarkBtn, false);
        })
        .catch((error: unknown) => {
          ztoolkit.log("[BookmarkReader] Toggle bookmark failed:", error);
          state.actions.onBookmarkError?.(
            error instanceof Error
              ? error.message
              : getString("chat-bookmark-save-failed"),
          );
        })
        .finally(() => {
          bookmarkPending = false;
          if (generation !== renderGeneration || !bookmarkBtn) {
            return;
          }
          bookmarkBtn.disabled = !currentTurn;
          bookmarkBtn.style.cursor = "pointer";
          bookmarkBtn.style.opacity = "1";
        });
    });

  host
    .querySelector("#chat-bookmark-reader-prev")
    ?.addEventListener("click", () => {
      if (currentIndex > 0) {
        void showBookmarkAt(currentIndex - 1);
      }
    });
  host
    .querySelector("#chat-bookmark-reader-next")
    ?.addEventListener("click", () => {
      if (currentIndex < bookmarks.length - 1) {
        void showBookmarkAt(currentIndex + 1);
      }
    });
  jumpBtn.addEventListener("click", () => {
    const quote = toQuotedMessageRef(bookmarks[currentIndex]);
    if (!quote) return;
    void Promise.resolve(state.actions.onJumpToChat(quote));
  });
  readerBody.addEventListener(
    "scroll",
    () => updateReaderProgress(host, readerBody),
    { passive: true },
  );
  let copyTimer: number | undefined;
  copyBtn.addEventListener("click", () => {
    if (!currentTurn?.assistantContent) return;
    copyToClipboard(currentTurn.assistantContent);
    state.actions.onCopySuccess?.(getString("chat-bookmark-copied"));
    copyBtn.dataset.copied = "true";
    const win = host.ownerDocument.defaultView;
    if (copyTimer !== undefined) win?.clearTimeout(copyTimer);
    copyTimer = win?.setTimeout(() => {
      delete copyBtn.dataset.copied;
    }, 900);
  });
  host
    .querySelector("#chat-bookmark-reader-close")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const win = readerHosts.get(host) ?? host.ownerDocument.defaultView;
      closeBookmarkReader(win);
    });

  if (state.actions.onQuoteAssistantExcerpt) {
    setupChatHistorySelectionQuote(readerBody, (quote) => {
      void Promise.resolve(
        state.actions.onQuoteAssistantExcerpt?.(quote.messageId, quote.excerpt),
      );
    });
  }

  void showBookmarkAt(currentIndex);
}

function mountReaderWindow(win: Window, state: ReaderOpenState): void {
  if (win.closed) {
    return;
  }

  const host = win.document.getElementById(READER_HOST_ID);
  if (!host) {
    ztoolkit.log("[BookmarkReader] Root element not found");
    return;
  }

  renderGeneration += 1;
  unsubscribeFromConversationDeletion?.();
  unsubscribeFromConversationDeletion = undefined;
  activeOpenState = state;
  readerHosts.set(host, win);
  win.document.documentElement.style.display = "";
  const theme = getCurrentTheme();
  buildReaderShell(host, theme, win);
  bindReaderEvents(host, state);
}

function isReaderWindow(win: Window): boolean {
  if (!isWindowAlive(win)) {
    return false;
  }
  if (win.name === READER_WINDOW_NAME) {
    return true;
  }
  try {
    return (
      win.document?.documentURI?.includes("bookmark-reader.xhtml") ?? false
    );
  } catch {
    return false;
  }
}

function findExistingReaderWindow(): Window | null {
  if (readerWindow && isWindowAlive(readerWindow)) {
    return readerWindow;
  }

  try {
    const enumerator = Services.wm.getEnumerator("");
    while (enumerator.hasMoreElements()) {
      const candidate = enumerator.getNext() as Window;
      if (isReaderWindow(candidate)) {
        return candidate;
      }
    }
  } catch (error) {
    ztoolkit.log("[BookmarkReader] find existing window failed:", error);
  }

  return null;
}

function restoreReaderWindowVisibility(win: Window): void {
  if (!isWindowAlive(win)) {
    return;
  }
  try {
    win.document.documentElement.style.display = "";
    const root = win.document.getElementById(READER_HOST_ID);
    if (root) {
      root.style.display = "";
    }
  } catch (error) {
    ztoolkit.log("[BookmarkReader] restore visibility failed:", error);
  }
}

function bringReaderWindowToFront(win: Window): void {
  if (!isWindowAlive(win)) {
    return;
  }
  restoreReaderWindowVisibility(win);
  try {
    win.focus();
  } catch (error) {
    ztoolkit.log("[BookmarkReader] focus failed:", error);
  }
}

function resolveReaderWindow(targetWin?: Window | null): Window | null {
  const candidates = [targetWin, readerWindow, findExistingReaderWindow()];
  for (const candidate of candidates) {
    if (candidate && isWindowAlive(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hideReaderWindow(win: Window): void {
  const root = win.document.getElementById(READER_HOST_ID);
  if (root) {
    root.textContent = "";
    root.style.display = "none";
  }
  win.document.documentElement.style.display = "none";
  win.blur();
  Zotero.getMainWindow()?.focus();
}

function finalizeBookmarkReaderClose(actions?: BookmarkReaderActions): void {
  unsubscribeFromConversationDeletion?.();
  unsubscribeFromConversationDeletion = undefined;
  if (readerWindow && !readerWindow.closed) {
    const host = readerWindow.document.getElementById(READER_HOST_ID);
    if (host) {
      readerOutlineControllers.get(host)?.dispose();
      readerOutlineControllers.delete(host);
    }
  }
  readerWindow = null;
  activeOpenState = null;
  actions?.onClose();
  renderGeneration += 1;
}

export function closeBookmarkReader(targetWin?: Window | null): void {
  const actions = activeOpenState?.actions;
  const win = resolveReaderWindow(targetWin);
  if (!win) {
    finalizeBookmarkReaderClose(actions);
    return;
  }

  try {
    win.close();
  } catch (error) {
    ztoolkit.log("[BookmarkReader] window.close() failed:", error);
  }

  if (!win.closed) {
    hideReaderWindow(win);
  }

  finalizeBookmarkReaderClose(actions);
}

export function isBookmarkReaderOpen(): boolean {
  return Boolean(findExistingReaderWindow());
}

export async function openBookmarkReader(
  bookmarks: BookmarkRecord[],
  startIndex: number,
  actions: BookmarkReaderActions,
): Promise<void> {
  if (!bookmarks.length || startIndex < 0 || startIndex >= bookmarks.length) {
    return;
  }

  const state: ReaderOpenState = {
    bookmarks: bookmarks.map((bookmark) => ({ ...bookmark })),
    startIndex,
    actions,
  };

  const existing = findExistingReaderWindow();
  if (existing) {
    readerWindow = existing;
    mountReaderWindow(existing, state);
    bringReaderWindowToFront(existing);
    return;
  }

  const mainWindow = Zotero.getMainWindow();
  if (!mainWindow) {
    return;
  }

  const width = 760;
  const height = 640;
  const left = mainWindow.screenX + (mainWindow.outerWidth - width) / 2;
  const top = mainWindow.screenY + (mainWindow.outerHeight - height) / 2;

  const win = mainWindow.openDialog(
    `chrome://${config.addonRef}/content/bookmark-reader.xhtml`,
    READER_WINDOW_NAME,
    `chrome,centerscreen,resizable=yes,width=${width},height=${height},left=${left},top=${top}`,
  );

  if (!win) {
    return;
  }

  readerWindow = win;

  const onReady = () => {
    if (win.closed) {
      return;
    }
    mountReaderWindow(win, state);
    bringReaderWindowToFront(win);
  };

  win.addEventListener("unload", () => {
    if (readerWindow !== win) {
      return;
    }
    const actions = activeOpenState?.actions;
    finalizeBookmarkReaderClose(actions);
  });

  if (win.document.readyState === "complete") {
    onReady();
  } else {
    win.addEventListener("load", onReady, { once: true });
  }
}
