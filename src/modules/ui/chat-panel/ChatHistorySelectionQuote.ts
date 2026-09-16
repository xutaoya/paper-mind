/**
 * Floating "quote selection" affordance when the user highlights text inside
 * a completed assistant reply in chat history.
 */

import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { getCurrentTheme } from "./ChatPanelTheme";

const POPUP_CLASS = "paperchat-chat-selection-quote-popup";
const ASSISTANT_MESSAGE_SELECTORS = [
  ".chat-message.assistant-message",
  ".paperchat-reader-section--assistant",
];
const STREAMING_CONTENT_SELECTOR = "[data-streaming-content-for]";

export type AssistantSelectionQuote = {
  messageId: string;
  excerpt: string;
};

function nodeParentElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === 1) {
    return node as Element;
  }
  return node.parentElement;
}

function resolveAssistantMessageRoot(node: Node | null): HTMLElement | null {
  const element = nodeParentElement(node);
  if (!element) {
    return null;
  }
  for (const selector of ASSISTANT_MESSAGE_SELECTORS) {
    const match = element.closest(selector) as HTMLElement | null;
    if (match) {
      return match;
    }
  }
  return null;
}

export function resolveAssistantSelectionQuote(
  selectionRoot: HTMLElement,
  selection: Selection | null | undefined,
): AssistantSelectionQuote | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return null;
  }

  const excerpt = selection.toString().replace(/\u00a0/g, " ").trim();
  if (!excerpt) {
    return null;
  }

  const anchorMessage = resolveAssistantMessageRoot(selection.anchorNode);
  const focusMessage = resolveAssistantMessageRoot(selection.focusNode);
  if (
    !anchorMessage ||
    !focusMessage ||
    anchorMessage !== focusMessage ||
    !selectionRoot.contains(anchorMessage)
  ) {
    return null;
  }

  if (anchorMessage.querySelector(STREAMING_CONTENT_SELECTOR)) {
    return null;
  }

  const messageId = anchorMessage.getAttribute("data-message-id")?.trim();
  if (!messageId) {
    return null;
  }

  return { messageId, excerpt };
}

function resolveOverlayMount(selectionRoot: HTMLElement): HTMLElement {
  const chatViewport = selectionRoot.closest(
    "#chat-viewport",
  ) as HTMLElement | null;
  if (chatViewport) {
    return chatViewport;
  }

  const readerWrap = selectionRoot.closest(
    ".paperchat-reader-body-wrap",
  ) as HTMLElement | null;
  if (readerWrap) {
    return readerWrap;
  }

  return selectionRoot;
}

function ensureOverlayPositioning(overlayMount: HTMLElement): void {
  const view = overlayMount.ownerDocument?.defaultView;
  if (!view) {
    overlayMount.style.position = "relative";
    return;
  }
  const position = view.getComputedStyle(overlayMount)?.position ?? "";
  if (!position || position === "static") {
    overlayMount.style.position = "relative";
  }
}

function removeExistingPopup(mount: ParentNode): void {
  mount.querySelectorAll(`.${POPUP_CLASS}`).forEach((node) => {
    node.parentElement?.removeChild(node);
  });
}

function positionPopup(
  popup: HTMLElement,
  selectionRect: DOMRect,
  overlayMount: HTMLElement,
): void {
  const margin = 8;
  const mountRect = overlayMount.getBoundingClientRect();
  const width = popup.offsetWidth || 120;
  const height = popup.offsetHeight || 32;
  const boundsWidth = overlayMount.clientWidth || mountRect.width;
  const boundsHeight = overlayMount.clientHeight || mountRect.height;

  let left =
    selectionRect.left - mountRect.left + selectionRect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, boundsWidth - width - margin));

  let top = selectionRect.top - mountRect.top - height - margin;
  if (top < margin) {
    top = selectionRect.bottom - mountRect.top + margin;
  }
  top = Math.max(margin, Math.min(top, boundsHeight - height - margin));

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function buildSelectionQuoteButton(doc: Document): HTMLButtonElement {
  const theme = getCurrentTheme();
  const button = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  button.type = "button";
  button.className = POPUP_CLASS;
  const label = getString("chat-quote-selection");
  button.title = getString("chat-quote-selection-tooltip");
  button.setAttribute("aria-label", button.title);

  Object.assign(button.style, {
    position: "absolute",
    zIndex: "24",
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "8px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg,
    color: theme.textPrimary,
    boxShadow: theme.composerShadow || "0 4px 16px rgba(0,0,0,0.12)",
    cursor: "pointer",
    fontSize: "12px",
    lineHeight: "1.3",
    fontFamily: "inherit",
    maxWidth: "min(280px, calc(100vw - 16px))",
  });

  const icon = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "img",
  ) as HTMLImageElement;
  icon.src = `chrome://${config.addonRef}/content/icons/quote.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: "14px",
    height: "14px",
    flexShrink: "0",
  });

  const text = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  text.textContent = label;

  button.append(icon, text);
  return button;
}

export function setupChatHistorySelectionQuote(
  selectionRoot: HTMLElement,
  onQuoteSelection: (quote: AssistantSelectionQuote) => void,
): () => void {
  const doc = selectionRoot.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    return () => undefined;
  }
  const overlayMount = resolveOverlayMount(selectionRoot);
  ensureOverlayPositioning(overlayMount);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let activeQuote: AssistantSelectionQuote | null = null;

  const hidePopup = (): void => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    activeQuote = null;
    removeExistingPopup(overlayMount);
  };

  const scheduleHide = (): void => {
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hidePopup();
    }, 0);
  };

  const showPopup = (quote: AssistantSelectionQuote): void => {
    const selection = win.getSelection();
    if (!selection || selection.rangeCount < 1) {
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return;
    }

    removeExistingPopup(overlayMount);
    activeQuote = quote;

    const button = buildSelectionQuoteButton(doc);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!activeQuote) {
        return;
      }
      onQuoteSelection(activeQuote);
      win.getSelection()?.removeAllRanges();
      hidePopup();
    });

    overlayMount.appendChild(button);
    positionPopup(button, rect, overlayMount);
  };

  const updateFromSelection = (): void => {
    const selection = win.getSelection();
    const quote = resolveAssistantSelectionQuote(selectionRoot, selection);
    if (!quote) {
      hidePopup();
      return;
    }
    showPopup(quote);
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as Node | null;
    if (target && (target as Element).closest?.(`.${POPUP_CLASS}`)) {
      return;
    }
    hidePopup();
  };

  const onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as Node | null;
    if (target && (target as Element).closest?.(`.${POPUP_CLASS}`)) {
      return;
    }
    setTimeout(updateFromSelection, 0);
  };

  const onSelectionChange = (): void => {
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed) {
      scheduleHide();
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (
      event.key !== "Shift" &&
      !/^(Arrow|Home|End|PageUp|PageDown)/.test(event.key)
    ) {
      return;
    }
    setTimeout(updateFromSelection, 0);
  };

  const onScroll = (): void => {
    hidePopup();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      hidePopup();
    }
  };

  selectionRoot.addEventListener("mousedown", onMouseDown);
  selectionRoot.addEventListener("mouseup", onMouseUp);
  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("keyup", onKeyUp, true);
  selectionRoot.addEventListener("scroll", onScroll, true);
  win.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", onScroll);
  doc.addEventListener("keydown", onKeyDown, true);

  return () => {
    hidePopup();
    selectionRoot.removeEventListener("mousedown", onMouseDown);
    selectionRoot.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("keyup", onKeyUp, true);
    selectionRoot.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", onScroll);
    doc.removeEventListener("keydown", onKeyDown, true);
  };
}
