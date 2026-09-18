import { config } from "../../../../package.json";
import {
  prepareReaderAssistantContent,
  resolveBookmarkTurnContent,
} from "../../bookmarks/bookmarkTurnContent";
import type { EvidenceRecord } from "../../../types/evidence";
import type { BookmarkRecord } from "../../../types/bookmark";
import type { ChatSession } from "../../../types/chat";
import type { QuotedMessageRef } from "../../../types/chat";
import { isPersistedBookmarkRecord } from "../../bookmarks";
import { getString } from "../../../utils/locale";
import { isWindowAlive } from "../../../utils/window";
import { createBookmarkDialogButton } from "./BookmarkUiPrompts";
import { copyToClipboard, createElement } from "./ChatPanelBuilder";
import { darkTheme, getCurrentTheme, isDarkMode } from "./ChatPanelTheme";
import { renderMarkdownToElement } from "./MarkdownRenderer";
import type { ThemeColors } from "./types";
import { HTML_NS } from "./types";
import { setupChatHistorySelectionQuote } from "./ChatHistorySelectionQuote";

const READER_WINDOW_NAME = "paperchat-bookmark-reader";
const READER_HOST_ID = "bookmark-reader-root";
const READER_BODY_WRAP_ID = "chat-bookmark-reader-body-wrap";
const READER_OUTLINE_RAIL_ID = "chat-bookmark-reader-outline-rail";
const READER_OUTLINE_PANEL_ID = "chat-bookmark-reader-outline-panel";
const READER_BOOKMARK_BTN_ID = "chat-bookmark-reader-bookmark";

interface ReaderHeading {
  level: number;
  text: string;
  element: HTMLElement;
}

interface ReaderOutlineController {
  dispose: () => void;
}

const readerOutlineControllers = new WeakMap<HTMLElement, ReaderOutlineController>();

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

function createIconButton(
  doc: Document,
  theme: ThemeColors,
  iconName: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = createElement(
    doc,
    "button",
    {
      width: "32px",
      height: "32px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: `1px solid ${theme.borderColor}`,
      background: theme.buttonBg,
      borderRadius: "8px",
      cursor: "pointer",
      padding: "0",
      appearance: "none",
    },
    { type: "button", title, "aria-label": title },
  ) as HTMLButtonElement;
  const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  icon.src = `chrome://${config.addonRef}/content/icons/${iconName}.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: "16px",
    height: "16px",
    display: "block",
    pointerEvents: "none",
    filter: isDarkMode()
      ? "brightness(0) invert(0.88)"
      : "brightness(0) invert(0.35)",
  });
  button.appendChild(icon);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function readerBookmarkIconUrl(filled: boolean): string {
  const name = filled ? "bookmark-filled" : "bookmark";
  return `chrome://${config.addonRef}/content/icons/${name}.svg`;
}

function readerBookmarkIconFilter(filled: boolean): string {
  if (filled) {
    return "none";
  }
  return isDarkMode()
    ? "brightness(0) invert(0.88)"
    : "brightness(0) invert(0.35)";
}

function setReaderBookmarkButtonState(
  button: HTMLButtonElement | null,
  isSaved: boolean,
): void {
  if (!button) {
    return;
  }
  const saveLabel = getString("chat-bookmark-reader-toggle-save");
  const removeLabel = getString("chat-bookmark-reader-toggle-remove");
  button.classList.toggle("is-saved", isSaved);
  button.title = isSaved ? removeLabel : saveLabel;
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", isSaved ? "true" : "false");
  const icon = button.querySelector("img");
  if (icon) {
    icon.src = readerBookmarkIconUrl(isSaved);
    icon.style.filter = readerBookmarkIconFilter(isSaved);
    icon.style.opacity = isSaved ? "1" : "0.72";
    icon.style.transform = isSaved ? "scale(1.08)" : "scale(1)";
  }
}

function injectReaderStyles(doc: Document): void {
  if (doc.getElementById("paperchat-reader-style")) {
    return;
  }
  const style = doc.createElement("style");
  style.id = "paperchat-reader-style";
  style.textContent = `
    .paperchat-reader-content {
      max-width: 760px;
      margin: 0 auto;
    }
    .paperchat-reader-section {
      margin-bottom: 18px;
    }
    .paperchat-reader-section-label {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: none;
    }
    .paperchat-reader-section-body {
      border-radius: 14px;
      padding: 16px 18px;
      font-size: 14px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
    .paperchat-reader-section--user .paperchat-reader-section-body {
      border-left: 3px solid #2563eb;
      white-space: pre-wrap;
    }
    .paperchat-reader-section--assistant .paperchat-reader-section-body {
      padding: 12px 14px;
    }
    .paperchat-reader-markdown > :first-child {
      margin-top: 0;
    }
    .paperchat-reader-markdown > :last-child {
      margin-bottom: 0;
    }
    .paperchat-reader-markdown h1,
    .paperchat-reader-markdown h2,
    .paperchat-reader-markdown h3,
    .paperchat-reader-markdown h4 {
      margin: 1.1em 0 0.55em;
      line-height: 1.35;
      scroll-margin-top: 16px;
    }
    .paperchat-reader-markdown p,
    .paperchat-reader-markdown ul,
    .paperchat-reader-markdown ol,
    .paperchat-reader-markdown blockquote,
    .paperchat-reader-markdown pre {
      margin: 0.65em 0;
    }
    .paperchat-reader-markdown ul,
    .paperchat-reader-markdown ol {
      padding-left: 1.35em;
    }
    .paperchat-reader-markdown li + li {
      margin-top: 0.25em;
    }
    .paperchat-reader-markdown .md-table-scroll {
      overflow-x: auto;
      overflow-y: visible;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 10px;
      margin: 0.8em 0;
    }
    .paperchat-reader-markdown table,
    .paperchat-reader-markdown .md-table {
      width: 100%;
      max-width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin: 0;
      font-size: 13px;
      line-height: 1.45;
    }
    .paperchat-reader-markdown th,
    .paperchat-reader-markdown td {
      border: 1px solid rgba(148, 163, 184, 0.45);
      padding: 8px 10px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .paperchat-reader-markdown th:first-child,
    .paperchat-reader-markdown td:first-child {
      width: 2.6em;
      max-width: 3.2em;
      text-align: center;
      white-space: nowrap;
    }
    .paperchat-reader-markdown th:nth-child(2),
    .paperchat-reader-markdown td:nth-child(2) {
      width: 4.8em;
      max-width: 6.5em;
      text-align: center;
      white-space: nowrap;
    }
    .paperchat-reader-markdown blockquote {
      margin-left: 0;
      padding-left: 12px;
    }
    .paperchat-reader-body-wrap {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
    }
    .paperchat-reader-outline-rail {
      position: absolute;
      top: 18px;
      right: 10px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
    }
    .paperchat-reader-outline-rail.is-empty {
      display: none;
    }
    .paperchat-reader-outline-tick {
      width: 18px;
      height: 3px;
      border: none;
      border-radius: 999px;
      background: #d1d5db;
      padding: 0;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }
    .paperchat-reader-outline-tick.is-active {
      background: #2563eb;
      transform: scaleX(1.08);
    }
    .paperchat-reader-outline-tick:hover {
      background: #93c5fd;
    }
    .paperchat-reader-outline-panel {
      position: absolute;
      top: 18px;
      right: 44px;
      z-index: 5;
      width: min(320px, calc(100% - 72px));
      max-height: min(420px, calc(100% - 36px));
      overflow: auto;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
      padding: 8px;
      box-sizing: border-box;
    }
    .paperchat-reader-outline-panel.is-empty {
      display: none;
    }
    .paperchat-reader-outline-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: inherit;
      text-align: left;
      padding: 8px 10px;
      cursor: pointer;
      font: inherit;
      box-sizing: border-box;
    }
    .paperchat-reader-outline-item:hover {
      background: #f8fafc;
    }
    .paperchat-reader-outline-item.is-active {
      background: #eff6ff;
      color: #2563eb;
    }
    .paperchat-reader-outline-level {
      flex: 0 0 auto;
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      line-height: 1.2;
    }
    .paperchat-reader-outline-item.is-active .paperchat-reader-outline-level {
      color: #60a5fa;
    }
    .paperchat-reader-outline-title {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 13px;
      line-height: 1.45;
      color: #334155;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .paperchat-reader-outline-item.is-active .paperchat-reader-outline-title {
      color: #2563eb;
      font-weight: 600;
    }
    .paperchat-reader-bookmark-btn img {
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .paperchat-reader-bookmark-btn.is-saved {
      background: #fef3c7 !important;
      border-color: #f59e0b !important;
      box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.35);
    }
    .paperchat-reader-bookmark-btn.is-saved img {
      opacity: 1 !important;
      filter: none !important;
    }
    [data-theme="dark"] .paperchat-reader-outline-panel {
      background: rgba(37, 37, 37, 0.98);
      border-color: rgba(75, 85, 99, 0.65);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      color: #e5e7eb;
    }
    [data-theme="dark"] .paperchat-reader-outline-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    [data-theme="dark"] .paperchat-reader-outline-item.is-active {
      background: rgba(59, 130, 246, 0.22);
      color: #93c5fd;
    }
    [data-theme="dark"] .paperchat-reader-outline-title {
      color: #d1d5db;
    }
    [data-theme="dark"] .paperchat-reader-outline-item.is-active .paperchat-reader-outline-title {
      color: #93c5fd;
    }
    [data-theme="dark"] .paperchat-reader-bookmark-btn.is-saved {
      background: rgba(245, 158, 11, 0.32) !important;
      border-color: #fbbf24 !important;
      box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.45);
    }
  `;
  doc.head.appendChild(style);
}

function collectReaderHeadings(markdownRoot: HTMLElement | null): ReaderHeading[] {
  if (!markdownRoot) {
    return [];
  }
  const headings: ReaderHeading[] = [];
  markdownRoot.querySelectorAll("h1, h2, h3, h4").forEach((node) => {
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
    behavior: "smooth",
  });
}

function setReaderOutlineActive(
  rail: HTMLElement,
  panel: HTMLElement,
  activeIndex: number,
): void {
  rail.querySelectorAll(".paperchat-reader-outline-tick").forEach((node, index) => {
    node.classList.toggle("is-active", index === activeIndex);
  });
  panel.querySelectorAll(".paperchat-reader-outline-item").forEach((node, index) => {
    node.classList.toggle("is-active", index === activeIndex);
  });
}

function setupReaderOutline(
  host: HTMLElement,
  scrollContainer: HTMLElement,
): void {
  readerOutlineControllers.get(host)?.dispose();

  const rail = host.querySelector(
    `#${READER_OUTLINE_RAIL_ID}`,
  ) as HTMLElement | null;
  const panel = host.querySelector(
    `#${READER_OUTLINE_PANEL_ID}`,
  ) as HTMLElement | null;
  const markdownRoot = scrollContainer.querySelector(
    ".paperchat-reader-section--assistant .paperchat-reader-markdown",
  ) as HTMLElement | null;
  if (!rail || !panel) {
    return;
  }

  const headings = collectReaderHeadings(markdownRoot);
  rail.textContent = "";
  panel.textContent = "";
  rail.classList.toggle("is-empty", headings.length === 0);
  panel.classList.toggle("is-empty", headings.length === 0);
  if (headings.length === 0) {
    return;
  }

  const doc = host.ownerDocument!;
  let hidePanelTimer: ReturnType<typeof setTimeout> | null = null;

  const showPanel = () => {
    if (hidePanelTimer) {
      clearTimeout(hidePanelTimer);
      hidePanelTimer = null;
    }
    panel.style.display = "block";
  };

  const scheduleHidePanel = () => {
    if (hidePanelTimer) {
      clearTimeout(hidePanelTimer);
    }
    hidePanelTimer = setTimeout(() => {
      panel.style.display = "none";
      hidePanelTimer = null;
    }, 180);
  };

  headings.forEach((heading, index) => {
    const tick = createElement(
      doc,
      "button",
      {},
      {
        type: "button",
        class: "paperchat-reader-outline-tick",
        title: heading.text,
        "aria-label": heading.text,
      },
    );
    tick.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollReaderToHeading(scrollContainer, heading);
      setReaderOutlineActive(rail, panel, index);
      showPanel();
    });
    rail.appendChild(tick);

    const item = createElement(
      doc,
      "button",
      {},
      {
        type: "button",
        class: "paperchat-reader-outline-item",
      },
    );
    const level = createElement(
      doc,
      "span",
      {},
      { class: "paperchat-reader-outline-level" },
    );
    level.textContent = `H${heading.level}`;
    const title = createElement(
      doc,
      "span",
      {},
      { class: "paperchat-reader-outline-title" },
    );
    title.textContent = heading.text;
    item.appendChild(level);
    item.appendChild(title);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollReaderToHeading(scrollContainer, heading);
      setReaderOutlineActive(rail, panel, index);
    });
    panel.appendChild(item);
  });

  rail.setAttribute("aria-label", getString("chat-bookmark-reader-outline"));
  panel.setAttribute("aria-label", getString("chat-bookmark-reader-outline"));

  const updateActiveFromScroll = () => {
    const activeIndex = resolveActiveHeadingIndex(scrollContainer, headings);
    if (activeIndex >= 0) {
      setReaderOutlineActive(rail, panel, activeIndex);
    }
  };

  const onScroll = () => {
    updateActiveFromScroll();
  };
  scrollContainer.addEventListener("scroll", onScroll, { passive: true });

  rail.addEventListener("mouseenter", showPanel);
  rail.addEventListener("mouseleave", scheduleHidePanel);
  panel.addEventListener("mouseenter", showPanel);
  panel.addEventListener("mouseleave", scheduleHidePanel);
  rail.addEventListener("focusin", showPanel);
  rail.addEventListener("focusout", scheduleHidePanel);

  updateActiveFromScroll();

  readerOutlineControllers.set(host, {
    dispose: () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      if (hidePanelTimer) {
        clearTimeout(hidePanelTimer);
      }
      panel.style.display = "none";
    },
  });
}

function renderReaderSection(
  doc: Document,
  theme: ThemeColors,
  label: string,
  content: string,
  asMarkdown: boolean,
  options: {
    variant: "user" | "assistant";
    messageId?: string;
    evidenceRecords?: EvidenceRecord[];
  },
): HTMLElement {
  const section = createElement(doc, "section", {
    marginBottom: "18px",
  });
  section.className = `paperchat-reader-section paperchat-reader-section--${options.variant}`;
  if (options.variant === "assistant" && options.messageId) {
    section.setAttribute("data-message-id", options.messageId);
  }

  const heading = createElement(doc, "div", {
    marginBottom: "8px",
    fontSize: "12px",
    fontWeight: "600",
    color: theme.textMuted,
    letterSpacing: "0.02em",
  });
  heading.className = "paperchat-reader-section-label";
  heading.textContent = label;

  const body = createElement(doc, "div", {
    border: `1px solid ${theme.borderColor}`,
    background:
      options.variant === "user" ? theme.inputBg : theme.assistantBubbleBg,
    color: theme.textPrimary,
  });
  body.className = "paperchat-reader-section-body";
  if (asMarkdown) {
    body.classList.add("paperchat-reader-markdown");
  }

  const normalized = content.trim();
  if (!normalized) {
    body.textContent = getString("chat-bookmark-reader-empty-content");
  } else if (asMarkdown) {
    try {
      renderMarkdownToElement(body, normalized, options.messageId, {
        suppressToolCallCards: true,
        evidenceRecords: options.evidenceRecords,
      });
    } catch (error) {
      ztoolkit.log("[BookmarkReader] Markdown render failed:", error);
      body.textContent = normalized;
    }
  } else {
    body.textContent = normalized;
  }

  section.appendChild(heading);
  section.appendChild(body);
  return section;
}

function paintReaderBody(
  host: HTMLElement,
  theme: ThemeColors,
  turn: {
    userContent: string | null;
    assistantContent: string;
    evidenceRecords?: EvidenceRecord[];
    assistantMessageId?: string;
  },
): void {
  const body = host.querySelector(
    "#chat-bookmark-reader-body",
  ) as HTMLElement | null;
  if (!body) {
    ztoolkit.log("[BookmarkReader] Body element not found");
    return;
  }

  body.textContent = "";
  const doc = body.ownerDocument!;
  injectReaderStyles(doc);

  const contentWrap = createElement(doc, "div", {});
  contentWrap.className = "paperchat-reader-content";

  if (turn.userContent?.trim()) {
    contentWrap.appendChild(
      renderReaderSection(
        doc,
        theme,
        getString("chat-bookmark-reader-user-message"),
        turn.userContent,
        false,
        { variant: "user" },
      ),
    );
  }

  contentWrap.appendChild(
    renderReaderSection(
      doc,
      theme,
      getString("chat-bookmark-reader-assistant-message"),
      turn.assistantContent || "",
      true,
      {
        variant: "assistant",
        messageId: turn.assistantMessageId,
        evidenceRecords: turn.evidenceRecords,
      },
    ),
  );
  body.appendChild(contentWrap);
  const bodyWrap = host.querySelector(
    `#${READER_BODY_WRAP_ID}`,
  ) as HTMLElement | null;
  if (bodyWrap) {
    setupReaderOutline(host, body);
  }
}

function updateReaderPosition(
  host: HTMLElement,
  bookmarks: BookmarkRecord[],
  index: number,
): void {
  const footerPosition = host.querySelector(
    "#chat-bookmark-reader-footer-position",
  ) as HTMLElement | null;
  const label = `${index + 1}/${bookmarks.length}`;
  if (footerPosition) footerPosition.textContent = label;

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

function buildReaderShell(host: HTMLElement, theme: ThemeColors): void {
  const doc = host.ownerDocument!;
  host.dataset.theme = getCurrentTheme() === darkTheme ? "dark" : "light";

  Object.assign(host.style, {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    background: theme.chatHistoryBg,
    overflow: "hidden",
  });

  while (host.firstChild) {
    host.removeChild(host.firstChild);
  }

  const header = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 14px",
    borderBottom: `1px solid ${theme.borderColor}`,
    background: theme.toolbarBg,
    flexShrink: "0",
  });

  const headerLeft = createElement(doc, "div", {
    display: "grid",
    gap: "2px",
    minWidth: "0",
    flex: "1",
  });
  const readerLabel = createElement(doc, "div", {
    fontSize: "15px",
    fontWeight: "600",
    color: theme.textPrimary,
  });
  readerLabel.textContent = getString("chat-bookmark-reader-title");
  const title = createElement(
    doc,
    "div",
    {
      fontSize: "13px",
      color: theme.textSecondary,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      minWidth: "0",
    },
    { id: "chat-bookmark-reader-title" },
  );
  headerLeft.appendChild(readerLabel);
  headerLeft.appendChild(title);

  const headerActions = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: "0",
  });
  const bookmarkBtn = createIconButton(
    doc,
    theme,
    "bookmark",
    getString("chat-bookmark-reader-toggle-save"),
    () => undefined,
  );
  bookmarkBtn.id = READER_BOOKMARK_BTN_ID;
  bookmarkBtn.classList.add("paperchat-reader-bookmark-btn");
  bookmarkBtn.setAttribute("aria-pressed", "false");
  const jumpBtn = createIconButton(
    doc,
    theme,
    "quote",
    getString("chat-bookmark-reader-jump-to-chat"),
    () => undefined,
  );
  jumpBtn.id = "chat-bookmark-reader-jump";
  const copyBtn = createIconButton(
    doc,
    theme,
    "copy",
    getString("chat-copy"),
    () => undefined,
  );
  copyBtn.id = "chat-bookmark-reader-copy";
  const closeBtn = createIconButton(
    doc,
    theme,
    "close",
    getString("chat-bookmark-close"),
    () => undefined,
  );
  closeBtn.id = "chat-bookmark-reader-close";
  headerActions.appendChild(bookmarkBtn);
  headerActions.appendChild(jumpBtn);
  headerActions.appendChild(copyBtn);
  headerActions.appendChild(closeBtn);

  header.appendChild(headerLeft);
  header.appendChild(headerActions);

  const bodyWrap = createElement(doc, "div", {}, { id: READER_BODY_WRAP_ID });
  bodyWrap.className = "paperchat-reader-body-wrap";

  const body = createElement(
    doc,
    "div",
    {
      flex: "1 1 auto",
      minHeight: "0",
      overflowY: "auto",
      padding: "18px 44px 24px 20px",
      background: theme.chatHistoryBg,
      width: "100%",
      boxSizing: "border-box",
    },
    { id: "chat-bookmark-reader-body" },
  );

  const outlineRail = createElement(
    doc,
    "div",
    {},
    { id: READER_OUTLINE_RAIL_ID },
  );
  outlineRail.className = "paperchat-reader-outline-rail is-empty";

  const outlinePanel = createElement(
    doc,
    "div",
    { display: "none" },
    { id: READER_OUTLINE_PANEL_ID },
  );
  outlinePanel.className = "paperchat-reader-outline-panel is-empty";

  bodyWrap.appendChild(body);
  bodyWrap.appendChild(outlineRail);
  bodyWrap.appendChild(outlinePanel);

  const footer = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "10px 14px 14px",
    borderTop: `1px solid ${theme.borderColor}`,
    background: theme.toolbarBg,
    flexShrink: "0",
  });

  const prevBtn = createBookmarkDialogButton(
    doc,
    "‹",
    {
      border: `1px solid ${theme.borderColor}`,
      background: theme.buttonBg,
      color: theme.textPrimary,
      borderRadius: "999px",
      width: "34px",
      height: "34px",
      minWidth: "34px",
      padding: "0",
      fontSize: "18px",
      lineHeight: "1",
      cursor: "pointer",
    },
    { type: "button", id: "chat-bookmark-reader-prev" },
  );
  const footerPosition = createElement(
    doc,
    "div",
    {
      fontSize: "12px",
      color: theme.textMuted,
      minWidth: "48px",
      textAlign: "center",
    },
    { id: "chat-bookmark-reader-footer-position" },
  );
  const nextBtn = createBookmarkDialogButton(
    doc,
    "›",
    {
      border: `1px solid ${theme.borderColor}`,
      background: theme.buttonBg,
      color: theme.textPrimary,
      borderRadius: "999px",
      width: "34px",
      height: "34px",
      minWidth: "34px",
      padding: "0",
      fontSize: "18px",
      lineHeight: "1",
      cursor: "pointer",
    },
    { type: "button", id: "chat-bookmark-reader-next" },
  );
  footer.appendChild(prevBtn);
  footer.appendChild(footerPosition);
  footer.appendChild(nextBtn);

  host.appendChild(header);
  host.appendChild(bodyWrap);
  host.appendChild(footer);
}

function bindReaderEvents(host: HTMLElement, state: ReaderOpenState): void {
  const bookmarks = state.bookmarks;
  let currentIndex = state.startIndex;
  const generation = renderGeneration;
  const bookmarkBtn = host.querySelector(
    `#${READER_BOOKMARK_BTN_ID}`,
  ) as HTMLButtonElement | null;

  const syncBookmarkButton = async (bookmark: BookmarkRecord) => {
    if (
      !state.actions.isBookmarkSaved ||
      !state.actions.onToggleBookmark ||
      !bookmark.sessionId ||
      !bookmark.messageId
    ) {
      if (bookmarkBtn) {
        bookmarkBtn.style.display = "none";
      }
      return;
    }
    if (bookmarkBtn) {
      bookmarkBtn.style.display = "inline-flex";
    }
    try {
      const isSaved = await state.actions.isBookmarkSaved(bookmark);
      if (generation !== renderGeneration) {
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

    currentIndex = index;
    const bookmark = bookmarks[currentIndex];
    const theme = getCurrentTheme();

    updateReaderPosition(host, bookmarks, currentIndex);
    const title = host.querySelector(
      "#chat-bookmark-reader-title",
    ) as HTMLElement | null;
    if (title) {
      title.textContent = bookmark.title;
    }
    if (readerWindow && !readerWindow.closed) {
      readerWindow.document.title = `${getString("chat-bookmark-reader-title")} - ${bookmark.title}`;
    }

    paintReaderBody(host, theme, {
      userContent: null,
      assistantContent: prepareReaderAssistantContent(bookmark.content),
      assistantMessageId: bookmark.messageId ?? undefined,
    });

    const loadSession =
      state.actions.loadSession ?? (async () => null as ChatSession | null);
    try {
      const turn = await resolveBookmarkTurnContent(bookmark, loadSession);
      if (generation !== renderGeneration) {
        return;
      }
      paintReaderBody(host, theme, turn);
    } catch (error) {
      ztoolkit.log("[BookmarkReader] Failed to resolve turn content:", error);
    }

    void syncBookmarkButton(bookmark);
  };

  host
    .querySelector(`#${READER_BOOKMARK_BTN_ID}`)
    ?.addEventListener("click", () => {
      if (
        !bookmarkBtn ||
        !state.actions.onToggleBookmark ||
        bookmarkBtn.disabled
      ) {
        return;
      }
      const bookmark = bookmarks[currentIndex];
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
          if (result.status === "saved") {
            bookmarks[currentIndex] = result.bookmark;
            state.actions.onCopySuccess?.(
              getString("chat-bookmark-saved", {
                args: { title: result.bookmark.title },
              }),
            );
            setReaderBookmarkButtonState(bookmarkBtn, true);
            return;
          }
          state.actions.onCopySuccess?.(getString("chat-bookmark-removed"));
          if (isPersistedBookmarkRecord(bookmark)) {
            bookmarks.splice(currentIndex, 1);
            if (!bookmarks.length) {
              const win = readerHosts.get(host) ?? host.ownerDocument.defaultView;
              closeBookmarkReader(win);
              return;
            }
            const nextIndex = Math.min(currentIndex, bookmarks.length - 1);
            await showBookmarkAt(nextIndex);
            return;
          }
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
          if (generation !== renderGeneration || !bookmarkBtn) {
            return;
          }
          bookmarkBtn.disabled = false;
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
  host
    .querySelector("#chat-bookmark-reader-jump")
    ?.addEventListener("click", () => {
      const quote = toQuotedMessageRef(bookmarks[currentIndex]);
      if (!quote) return;
      void Promise.resolve(state.actions.onJumpToChat(quote));
    });
  host
    .querySelector("#chat-bookmark-reader-copy")
    ?.addEventListener("click", async () => {
      const loadSession =
        state.actions.loadSession ?? (async () => null as ChatSession | null);
      const turn = await resolveBookmarkTurnContent(
        bookmarks[currentIndex],
        loadSession,
      );
      copyToClipboard(turn.assistantContent || bookmarks[currentIndex].content);
      state.actions.onCopySuccess?.(getString("chat-bookmark-copied"));
    });
  host
    .querySelector("#chat-bookmark-reader-close")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const win = readerHosts.get(host) ?? host.ownerDocument.defaultView;
      closeBookmarkReader(win);
    });

  const readerBody = host.querySelector(
    "#chat-bookmark-reader-body",
  ) as HTMLElement | null;
  if (readerBody && state.actions.onQuoteAssistantExcerpt) {
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
  activeOpenState = state;
  readerHosts.set(host, win);
  win.document.documentElement.style.display = "";
  const theme = getCurrentTheme();
  buildReaderShell(host, theme);
  bindReaderEvents(host, state);
  win.document.title = getString("chat-bookmark-reader-title");
}

function isReaderWindow(win: Window): boolean {
  if (!isWindowAlive(win)) {
    return false;
  }
  if (win.name === READER_WINDOW_NAME) {
    return true;
  }
  try {
    return win.document?.documentURI?.includes("bookmark-reader.xhtml") ?? false;
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

function raiseChromeWindow(win: Window): void {
  try {
    const Ci = Components.interfaces;
    const requestor = win as unknown as {
      QueryInterface: (uuid: unknown) => {
        getInterface: (uuid: unknown) => {
          QueryInterface: (uuid: unknown) => {
            getInterface: (uuid: unknown) => { zLevel: number };
          };
        };
      };
    };
    const baseWindow = requestor
      .QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIWebNavigation)
      .QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIBaseWindow);
    // nsIBaseWindow.raisedZ
    baseWindow.zLevel = 3;
  } catch (error) {
    ztoolkit.log("[BookmarkReader] raise window failed:", error);
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
  raiseChromeWindow(win);
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
