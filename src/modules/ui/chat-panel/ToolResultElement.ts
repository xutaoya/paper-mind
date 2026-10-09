import { copyToClipboard } from "./ChatPanelBuilder";
import { isDarkMode } from "./ChatPanelTheme";
import { getAgentUiSemanticColors, type AgentUiSemanticColors } from "./AgentUiTheme";
import {
  formatToolDisplayLabel,
  type ParsedToolCallEntry,
} from "./MarkdownRenderer";
import {
  getToolCallCardExpandKey,
  isToolCallGroupExpanded,
  setToolCallGroupExpanded,
} from "./ToolCallGroupExpandState";
import { getString } from "../../../utils/locale";
import { HTML_NS } from "./types";
import { createUiChevron, setUiChevronExpanded } from "./UiChevron";
import type { ThemeColors } from "./types";

export type ToolResultActivityStatus = "complete" | "active";
export type ToolResultStatus = "running" | "success" | "error" | "cancelled";

const TOOL_RESULT_MAX_HEIGHT_PX = 180;
const TOOL_RESULT_USER_OPEN_ATTR = "data-user-open";
const TOOL_RESULT_CONTENT_SIG_ATTR = "data-tool-result-content-sig";

type ToolResultPalette = Pick<
  AgentUiSemanticColors,
  | "running"
  | "success"
  | "error"
  | "cancelled"
  | "toolResultPanelBg"
  | "toolResultPanelBorder"
  | "toolResultTextOpacity"
> & { errorText: string };

export function getToolResultPalette(): ToolResultPalette {
  const semantic = getAgentUiSemanticColors();
  return {
    running: semantic.running,
    success: semantic.success,
    error: semantic.error,
    cancelled: semantic.cancelled,
    errorText: semantic.error,
    toolResultPanelBg: semantic.toolResultPanelBg,
    toolResultPanelBorder: semantic.toolResultPanelBorder,
    toolResultTextOpacity: semantic.toolResultTextOpacity,
  };
}

function createElement(
  doc: Document,
  tag: string,
  styles: Record<string, string>,
  attrs?: Record<string, string>,
): HTMLElement {
  const el = doc.createElementNS(HTML_NS, tag) as HTMLElement;
  Object.assign(el.style, styles);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

function prefersReducedMotion(doc: Document): boolean {
  const view = (doc.defaultView ?? Zotero.getMainWindow()) as Window | null;
  return Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

export function mapToolCallStatusToResultStatus(
  status: ParsedToolCallEntry["status"],
): ToolResultStatus {
  if (status === "calling") {
    return "running";
  }
  if (status === "error") {
    return "error";
  }
  return "success";
}

export function getToolResultContentSignature(entry: ParsedToolCallEntry): string {
  return `${entry.status}\n${entry.toolArgs ?? ""}\n${entry.toolResult ?? ""}\n${entry.statusText ?? ""}`;
}

export function buildToolResultCopyText(entry: ParsedToolCallEntry): string {
  const parts: string[] = [];
  if (entry.toolArgs?.trim()) {
    parts.push(entry.toolArgs.trim());
  }
  if (entry.toolResult?.trim()) {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(entry.toolResult.trim());
  }
  if (!parts.length && entry.statusText?.trim()) {
    parts.push(entry.statusText.trim());
  }
  return parts.join("\n");
}

export function resolveToolResultDefaultOpen(
  resultStatus: ToolResultStatus,
  activityStatus: ToolResultActivityStatus,
  hasDetails: boolean,
): boolean {
  if (!hasDetails) {
    return false;
  }
  if (activityStatus === "active" || resultStatus === "running") {
    return true;
  }
  return false;
}

function getStatusLabel(status: ToolResultStatus): string {
  switch (status) {
    case "running":
      return getString("chat-tool-result-running");
    case "success":
      return getString("chat-tool-result-completed");
    case "error":
      return getString("chat-tool-result-failed");
    default:
      return getString("chat-tool-result-cancelled");
  }
}

function getStatusColor(status: ToolResultStatus, palette: ToolResultPalette): string {
  switch (status) {
    case "running":
      return palette.running;
    case "success":
      return palette.success;
    case "error":
      return palette.error;
    default:
      return palette.cancelled;
  }
}

function getExpandStateKey(
  messageId: string | undefined,
  itemId: string,
): string | null {
  return getToolCallCardExpandKey(messageId, `activity-${itemId}`);
}

function resolveToolResultOpen(
  root: HTMLElement,
  expandKey: string | null,
  defaultOpen: boolean,
): boolean {
  const userOpen = root.getAttribute(TOOL_RESULT_USER_OPEN_ATTR);
  if (userOpen === "true") {
    return true;
  }
  if (userOpen === "false") {
    return false;
  }
  if (expandKey && isToolCallGroupExpanded(expandKey)) {
    return true;
  }
  return defaultOpen;
}

function applyToolResultOpenUi(root: HTMLElement, open: boolean): void {
  const disclosure = root.querySelector(
    "[data-tool-result-disclosure]",
  ) as HTMLElement | null;
  const chevron = root.querySelector(
    ".paperchat-tool-result-chevron",
  ) as HTMLElement | null;
  const trigger = root.querySelector(
    ".paperchat-tool-result-trigger",
  ) as HTMLElement | null;

  if (disclosure) {
    disclosure.style.maxHeight = open ? `${TOOL_RESULT_MAX_HEIGHT_PX}px` : "0px";
    disclosure.style.opacity = open ? "1" : "0";
    disclosure.style.pointerEvents = open ? "auto" : "none";
  }
  if (chevron) {
    setUiChevronExpanded(chevron, open);
  }
  trigger?.setAttribute("aria-expanded", open ? "true" : "false");
  root.setAttribute("data-open", open ? "true" : "false");
}

function scrollToolResultViewportToEnd(viewport: HTMLElement, doc: Document): void {
  if (viewport.scrollHeight <= viewport.clientHeight) {
    return;
  }
  const reduce = prefersReducedMotion(doc);
  if (typeof viewport.scrollTo === "function") {
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: reduce ? "auto" : "smooth",
    });
    return;
  }
  viewport.scrollTop = viewport.scrollHeight;
}

function createStatusIcon(
  doc: Document,
  status: ToolResultStatus,
): HTMLElement {
  const icon = createElement(doc, "span", {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "12px",
    height: "12px",
    flexShrink: "0",
    fontSize: "10px",
    lineHeight: "1",
  });
  icon.setAttribute("data-tool-result-status-icon", status);

  if (status === "running") {
    icon.className = "paperchat-tool-result-spinner";
    icon.textContent = "◌";
    return icon;
  }
  if (status === "success") {
    icon.textContent = "✓";
    return icon;
  }
  if (status === "error") {
    icon.textContent = "✕";
    return icon;
  }
  icon.textContent = "⊘";
  return icon;
}

function createOutputSection(
  doc: Document,
  theme: ThemeColors,
  palette: ToolResultPalette,
  entry: ParsedToolCallEntry,
  resultStatus: ToolResultStatus,
): HTMLElement {
  const wrap = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: "0",
  });

  if (entry.toolArgs?.trim()) {
    const argsBlock = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      minWidth: "0",
    });
    const argsLabel = createElement(doc, "span", {
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: theme.textMuted,
      opacity: "0.8",
    });
    argsLabel.textContent = getString("chat-tool-result-args-label");
    argsLabel.setAttribute("data-tool-result-args-label", "true");
    argsBlock.appendChild(argsLabel);

    const argsPre = createElement(doc, "pre", {
      margin: "0",
      padding: "0",
      fontFamily: '"SF Mono", Monaco, Consolas, monospace',
      fontSize: "11px",
      lineHeight: "1.45",
      color: theme.textSecondary,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    });
    argsPre.setAttribute("data-tool-result-args", "true");
    argsPre.textContent = entry.toolArgs;
    argsBlock.appendChild(argsPre);
    wrap.appendChild(argsBlock);
  }

  const outputText =
    entry.toolResult?.trim() ||
    (resultStatus === "running" ? entry.statusText : "") ||
    "";
  if (outputText) {
    const outputBlock = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      minWidth: "0",
    });
    if (entry.toolArgs?.trim() || entry.toolResult?.trim()) {
      const outputLabel = createElement(doc, "span", {
        fontSize: "10px",
        fontWeight: "600",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: theme.textMuted,
        opacity: "0.8",
      });
      outputLabel.textContent = getString("chat-tool-result-output-label");
      outputLabel.setAttribute("data-tool-result-output-label", "true");
      outputBlock.appendChild(outputLabel);
    }

    const outputPre = createElement(doc, "pre", {
      margin: "0",
      padding: "0",
      fontFamily: '"SF Mono", Monaco, Consolas, monospace',
      fontSize: "11px",
      lineHeight: "1.45",
      color: resultStatus === "error" ? palette.errorText : theme.textPrimary,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      opacity: resultStatus === "error" ? "0.95" : palette.toolResultTextOpacity,
    });
    outputPre.setAttribute("data-tool-result-output", "true");
    outputPre.textContent = outputText;
    outputBlock.appendChild(outputPre);
    wrap.appendChild(outputBlock);
  }

  return wrap;
}

function bindToolResultInteractions(
  root: HTMLElement,
  doc: Document,
  expandKey: string | null,
  canToggle: boolean,
  resultStatus: ToolResultStatus,
): void {
  const trigger = root.querySelector(
    ".paperchat-tool-result-trigger",
  ) as HTMLButtonElement | null;
  const viewport = root.querySelector(
    "[data-tool-result-viewport]",
  ) as HTMLElement | null;
  const copyButton = root.querySelector(
    "[data-tool-result-copy]",
  ) as HTMLButtonElement | null;

  if (trigger && canToggle) {
    trigger.addEventListener("click", () => {
      const nextOpen = root.getAttribute("data-open") !== "true";
      root.setAttribute(TOOL_RESULT_USER_OPEN_ATTR, nextOpen ? "true" : "false");
      if (expandKey) {
        setToolCallGroupExpanded(expandKey, nextOpen);
      }
      applyToolResultOpenUi(root, nextOpen);
      if (nextOpen && viewport) {
        scheduleAfterLayout(doc, () => scrollToolResultViewportToEnd(viewport, doc));
      }
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const argsEl = root.querySelector("[data-tool-result-args]");
      const outputEl = root.querySelector("[data-tool-result-output]");
      const parts: string[] = [];
      if (argsEl?.textContent?.trim()) {
        parts.push(argsEl.textContent.trim());
      }
      if (outputEl?.textContent?.trim()) {
        if (parts.length > 0) {
          parts.push("");
        }
        parts.push(outputEl.textContent.trim());
      }
      const copyText = parts.join("\n");
      if (!copyText) {
        return;
      }
      copyToClipboard(copyText);
      copyButton.textContent = getString("chat-tool-result-copied");
      const win = doc.defaultView ?? Zotero.getMainWindow();
      win?.setTimeout(() => {
        copyButton.textContent = getString("chat-tool-result-copy");
      }, 1600);
    });
  }

  if (viewport && resultStatus === "running") {
    scheduleAfterLayout(doc, () => scrollToolResultViewportToEnd(viewport, doc));
  }
}

function scheduleAfterLayout(doc: Document, callback: () => void): void {
  const win = doc.defaultView;
  if (win?.requestAnimationFrame) {
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(callback);
    });
    return;
  }
  setTimeout(callback, 0);
}

function populateToolResultElement(
  root: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  entry: ParsedToolCallEntry,
  itemId: string,
  activityStatus: ToolResultActivityStatus,
  messageId?: string,
): void {
  const resultStatus = mapToolCallStatusToResultStatus(entry.status);
  const hasDetails = Boolean(
    entry.toolArgs?.trim() || entry.toolResult?.trim() || entry.statusText?.trim(),
  );
  const canToggle =
    hasDetails &&
    (resultStatus === "running" ||
      resultStatus === "error" ||
      Boolean(entry.toolResult?.trim()) ||
      Boolean(entry.toolArgs?.trim()));
  const expandKey = getExpandStateKey(messageId, itemId);
  const defaultOpen = resolveToolResultDefaultOpen(
    resultStatus,
    activityStatus,
    canToggle,
  );
  const open = resolveToolResultOpen(root, expandKey, defaultOpen);
  const palette = getToolResultPalette();
  const dark = isDarkMode();

  root.replaceChildren();
  root.className =
    "paperchat-agent-activity-row paperchat-agent-activity-tool-row paperchat-tool-result";
  if (dark) {
    root.classList.add("paperchat-tool-result--dark");
  }
  root.setAttribute("data-agent-activity-row", "tool");
  root.setAttribute("data-agent-activity-item-id", itemId);
  root.setAttribute(
    "data-agent-step-status",
    activityStatus === "active" ? "active" : "complete",
  );
  root.setAttribute("data-tool-card-status", entry.status);
  root.setAttribute(TOOL_RESULT_CONTENT_SIG_ATTR, getToolResultContentSignature(entry));
  root.setAttribute("data-tool-result-status", resultStatus);

  const trigger = doc.createElementNS(
    HTML_NS,
    "button",
  ) as HTMLButtonElement;
  trigger.type = "button";
  trigger.className = "paperchat-tool-result-trigger";
  Object.assign(trigger.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minHeight: "32px",
    padding: "2px 6px",
    margin: "0",
    border: "none",
    borderRadius: "6px",
    background: "transparent",
    cursor: canToggle ? "pointer" : "default",
    color: theme.textPrimary,
    font: "inherit",
    textAlign: "left",
  });
  trigger.disabled = !canToggle;

  const kindIcon = createElement(doc, "span", {
    width: "16px",
    height: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    fontSize: "12px",
    color: theme.textMuted,
    opacity: "0.72",
  });
  kindIcon.textContent = "⚙";
  trigger.appendChild(kindIcon);

  const title = createElement(doc, "span", {
    flex: "1",
    minWidth: "0",
    fontSize: "12px",
    fontWeight: "500",
    color: theme.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    opacity: "0.92",
  });
  title.textContent = formatToolDisplayLabel(entry.toolName);
  trigger.appendChild(title);

  const statusBadge = createElement(doc, "span", {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: "0",
    fontSize: "11px",
    fontWeight: "500",
    color: getStatusColor(resultStatus, palette),
  });
  statusBadge.setAttribute("data-tool-result-status-badge", "true");
  statusBadge.appendChild(createStatusIcon(doc, resultStatus));
  const statusText = createElement(doc, "span", {});
  statusText.textContent = getStatusLabel(resultStatus);
  statusBadge.appendChild(statusText);
  trigger.appendChild(statusBadge);

  if (canToggle) {
    const chevron = createUiChevron(doc, {
      className: "paperchat-tool-result-chevron",
      size: 16,
      color: theme.textMuted,
      opacity: 0.55,
    });
    setUiChevronExpanded(chevron, open);
    trigger.appendChild(chevron);
  }

  root.appendChild(trigger);

  if (canToggle) {
    const disclosure = createElement(
      doc,
      "div",
      {
        overflow: "hidden",
        transition: "max-height 0.18s ease, opacity 0.18s ease",
        paddingLeft: "22px",
        paddingRight: "4px",
      },
      { "data-tool-result-disclosure": "true" },
    );

    const panel = createElement(doc, "div", {
      marginTop: "2px",
      marginBottom: "4px",
      borderRadius: "10px",
      background: palette.toolResultPanelBg,
      border: `1px solid ${palette.toolResultPanelBorder}`,
      overflow: "hidden",
    });
    panel.className = "paperchat-tool-result-panel";

    const viewport = createElement(
      doc,
      "div",
      {
        maxHeight: `${TOOL_RESULT_MAX_HEIGHT_PX - 36}px`,
        overflowY: "auto",
        padding: "10px 12px",
      },
      { "data-tool-result-viewport": "true" },
    );
    viewport.appendChild(
      createOutputSection(doc, theme, palette, entry, resultStatus),
    );
    panel.appendChild(viewport);

    const copyText = buildToolResultCopyText(entry);
    if (copyText) {
      const footer = createElement(doc, "div", {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 8px 8px",
      });
      const copyButton = doc.createElementNS(
        HTML_NS,
        "button",
      ) as HTMLButtonElement;
      copyButton.type = "button";
      copyButton.className = "paperchat-tool-result-copy";
      copyButton.setAttribute("data-tool-result-copy", "true");
      Object.assign(copyButton.style, {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: "4px 8px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: "500",
        color: theme.textMuted,
      });
      copyButton.textContent = getString("chat-tool-result-copy");
      footer.appendChild(copyButton);
      panel.appendChild(footer);
    }

    disclosure.appendChild(panel);
    root.appendChild(disclosure);
  }

  applyToolResultOpenUi(root, open);
  bindToolResultInteractions(
    root,
    doc,
    expandKey,
    canToggle,
    resultStatus,
  );
}

export function createToolResultActivityElement(
  doc: Document,
  theme: ThemeColors,
  entry: ParsedToolCallEntry,
  itemId: string,
  activityStatus: ToolResultActivityStatus,
  messageId?: string,
): HTMLElement {
  const root = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    minWidth: "0",
    margin: "2px 0",
  });
  populateToolResultElement(
    root,
    doc,
    theme,
    entry,
    itemId,
    activityStatus,
    messageId,
  );
  return root;
}

export function updateToolResultActivityElement(
  root: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  entry: ParsedToolCallEntry,
  activityStatus: ToolResultActivityStatus,
  messageId?: string,
): boolean {
  const nextSig = getToolResultContentSignature(entry);
  const currentSig = root.getAttribute(TOOL_RESULT_CONTENT_SIG_ATTR) ?? "";
  const previousResultStatus = root.getAttribute("data-tool-result-status");
  const nextResultStatus = mapToolCallStatusToResultStatus(entry.status);
  const itemId = root.getAttribute("data-agent-activity-item-id") ?? "";

  if (currentSig === nextSig) {
    return false;
  }

  const wasRunning = previousResultStatus === "running";
  const isCompleteNow = nextResultStatus !== "running";
  const userOpen = root.getAttribute(TOOL_RESULT_USER_OPEN_ATTR);
  const expandKey = getExpandStateKey(messageId, itemId);

  if (wasRunning && isCompleteNow && userOpen !== "true") {
    root.setAttribute(TOOL_RESULT_USER_OPEN_ATTR, "false");
    if (expandKey) {
      setToolCallGroupExpanded(expandKey, false);
    }
  }

  populateToolResultElement(
    root,
    doc,
    theme,
    entry,
    itemId,
    activityStatus,
    messageId,
  );
  return true;
}

export function applyToolResultTheme(
  root: HTMLElement,
  theme: ThemeColors,
): void {
  const palette = getToolResultPalette();
  const dark = isDarkMode();
  root.classList.toggle("paperchat-tool-result--dark", dark);

  const resultStatus =
    (root.getAttribute("data-tool-result-status") as ToolResultStatus | null) ??
    "success";

  const trigger = root.querySelector(
    ".paperchat-tool-result-trigger",
  ) as HTMLElement | null;
  if (trigger) {
    trigger.style.color = theme.textPrimary;
  }

  const title = trigger?.querySelector("span:nth-child(2)") as HTMLElement | null;
  if (title) {
    title.style.color = theme.textPrimary;
  }

  const kindIcon = trigger?.firstElementChild as HTMLElement | null;
  if (kindIcon) {
    kindIcon.style.color = theme.textMuted;
  }

  const chevron = root.querySelector(
    ".paperchat-tool-result-chevron",
  ) as HTMLElement | null;
  if (chevron) {
    chevron.style.color = theme.textMuted;
  }

  const badge = root.querySelector(
    "[data-tool-result-status-badge]",
  ) as HTMLElement | null;
  if (badge) {
    badge.style.color = getStatusColor(resultStatus, palette);
  }

  const panel = root.querySelector(
    ".paperchat-tool-result-panel",
  ) as HTMLElement | null;
  if (panel) {
    panel.style.background = palette.toolResultPanelBg;
    panel.style.border = `1px solid ${palette.toolResultPanelBorder}`;
  }

  root.querySelectorAll("[data-tool-result-args]").forEach((node) => {
    (node as HTMLElement).style.color = theme.textSecondary;
  });

  root.querySelectorAll("[data-tool-result-output]").forEach((node) => {
    const el = node as HTMLElement;
    el.style.color =
      resultStatus === "error" ? palette.errorText : theme.textPrimary;
    el.style.opacity =
      resultStatus === "error" ? "0.95" : palette.toolResultTextOpacity;
  });

  root.querySelectorAll("[data-tool-result-copy]").forEach((node) => {
    (node as HTMLElement).style.color = theme.textMuted;
  });

  root.querySelectorAll(
    "[data-tool-result-args-label], [data-tool-result-output-label]",
  ).forEach((node) => {
    (node as HTMLElement).style.color = theme.textMuted;
  });
}

export function getActivityMessageId(list: HTMLElement): string | undefined {
  const panel = list.closest("[data-agent-activity-for]") as HTMLElement | null;
  return panel?.getAttribute("data-agent-activity-for") ?? undefined;
}
