import { resolveFeedbackBubbleColors } from "../../../utils/colors";
import { isDarkMode } from "./ChatPanelTheme";

const TOAST_AUTO_DISMISS_MS = 3200;
const TOAST_VIEWPORT_PADDING_PX = 8;

export interface ChatPanelToastOptions {
  anchor?: HTMLElement | null;
}

function resolveDocumentView(doc: Document): Window | null {
  return (doc.defaultView ?? Zotero.getMainWindow()) as Window | null;
}

function scheduleNextFrame(callback: () => void, doc: Document): void {
  const view = resolveDocumentView(doc);
  if (view && typeof view.requestAnimationFrame === "function") {
    view.requestAnimationFrame(callback);
    return;
  }
  scheduleTimeout(callback, 0, doc);
}

function scheduleTimeout(
  callback: () => void,
  delayMs: number,
  doc: Document,
): number {
  const view = resolveDocumentView(doc);
  if (view && typeof view.setTimeout === "function") {
    return view.setTimeout(callback, delayMs);
  }
  return setTimeout(callback, delayMs) as unknown as number;
}

function clearScheduledTimeout(timerId: number, doc: Document): void {
  const view = resolveDocumentView(doc);
  if (view && typeof view.clearTimeout === "function") {
    view.clearTimeout(timerId);
    return;
  }
  clearTimeout(timerId);
}

function positionChatPanelToast(
  toast: HTMLElement,
  viewport: HTMLElement,
  anchor?: HTMLElement | null,
): void {
  const viewportHeight = viewport.clientHeight;
  let top = TOAST_VIEWPORT_PADDING_PX;

  if (anchor) {
    const viewportRect = viewport.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const relativeTop =
      anchorRect.top - viewportRect.top + TOAST_VIEWPORT_PADDING_PX;
    const maxTop = Math.max(
      TOAST_VIEWPORT_PADDING_PX,
      viewportHeight - toast.offsetHeight - TOAST_VIEWPORT_PADDING_PX,
    );
    top = Math.min(Math.max(relativeTop, TOAST_VIEWPORT_PADDING_PX), maxTop);
  }

  toast.style.top = `${top}px`;
}

export function showChatPanelToast(
  container: HTMLElement | null,
  message: string,
  kind: "success" | "error",
  options: ChatPanelToastOptions = {},
): void {
  if (!container) {
    return;
  }

  const viewport = container.querySelector(
    "#chat-viewport",
  ) as HTMLElement | null;
  const doc = container.ownerDocument;
  if (!viewport || !doc) {
    return;
  }

  viewport.querySelector(".chat-panel-toast")?.remove();

  const isError = kind === "error";
  const feedbackColors = resolveFeedbackBubbleColors(kind, isDarkMode());
  const toast = doc.createElement("div");
  toast.className = `chat-panel-toast chat-panel-toast-${kind}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = `${isError ? "⚠️" : "✓"} ${message}`;
  toast.style.background = feedbackColors.background;
  toast.style.border = `1px solid ${feedbackColors.border}`;
  toast.style.color = feedbackColors.color;

  viewport.appendChild(toast);
  positionChatPanelToast(toast, viewport, options.anchor);

  scheduleNextFrame(() => {
    positionChatPanelToast(toast, viewport, options.anchor);
    toast.classList.add("is-visible");
  }, doc);

  const dismiss = (): void => {
    toast.classList.remove("is-visible");
    scheduleTimeout(() => toast.remove(), 200, doc);
  };

  const timer = scheduleTimeout(dismiss, TOAST_AUTO_DISMISS_MS, doc);
  toast.addEventListener("click", () => {
    clearScheduledTimeout(timer, doc);
    dismiss();
  });
}
