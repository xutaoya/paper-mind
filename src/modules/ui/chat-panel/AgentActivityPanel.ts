/**
 * Agent Activity — beUI-inspired timeline for reasoning and tool calls.
 */

import { isDarkMode } from "./ChatPanelTheme";
import { getString } from "../../../utils/locale";
import { getTurnTokenTotal } from "../../../utils/apiUsage";
import { formatCompactTokenCount, estimateTextTokens } from "../../../utils/tokens";
import type { ChatMessageTurnUsage } from "../../../types/chat";
import type { ThemeColors } from "./types";
import { HTML_NS } from "./types";
import { createUiChevron, setUiChevronExpanded } from "./UiChevron";
import {
  isPresentationToolCallEntry,
  parseToolCallFragments,
  type ParsedToolCallEntry,
} from "./MarkdownRenderer";
import {
  createSearchActivityElement,
  isSearchToolName,
} from "./SearchActivityElement";
import {
  createToolResultActivityElement,
  getActivityMessageId,
  getToolResultContentSignature,
  updateToolResultActivityElement,
} from "./ToolResultElement";

const ACTIVITY_MAX_HEIGHT_PX = 180;
const ACTIVITY_STARTED_AT_ATTR = "data-agent-activity-started-at";
const ACTIVITY_ENDED_AT_ATTR = "data-agent-activity-ended-at";
const ACTIVITY_TURN_USAGE_ATTR = "data-agent-turn-usage";
const AGENT_ACTIVITY_THINKING_LABEL = "Thinking...";
const MAX_REASONING_LINES_WHILE_WORKING = 12;

const agentActivityStyledDocuments = new WeakSet<Document>();

function ensureAgentActivityStyles(doc: Document): void {
  if (agentActivityStyledDocuments.has(doc)) {
    return;
  }
  agentActivityStyledDocuments.add(doc);
  const style = doc.createElementNS(HTML_NS, "style") as HTMLElement;
  style.setAttribute("data-paperchat-agent-activity-styles", "true");
  style.textContent = `
@keyframes paperchat-agent-activity-bg-sweep {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@keyframes paperchat-agent-activity-beam-sweep {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(280%); }
}
@media (prefers-reduced-motion: reduce) {
  .paperchat-agent-activity-shimmer,
  .paperchat-agent-activity-thinking-beam {
    animation: none !important;
  }
}`;
  const target = doc.head || doc.documentElement || doc.body;
  target?.appendChild(style);
}

function prefersReducedMotion(doc: Document): boolean {
  const view = (doc.defaultView ?? Zotero.getMainWindow()) as Window | null;
  return Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function createThinkingShimmerLabel(doc: Document, dark: boolean): HTMLElement {
  ensureAgentActivityStyles(doc);
  const muted = dark ? "#a1a1aa" : "#71717a";
  const beamGradient = dark
    ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.95) 50%, transparent 100%)"
    : "linear-gradient(90deg, transparent 0%, rgba(255,255,255,1) 50%, transparent 100%)";
  const animate = !prefersReducedMotion(doc);

  const wrap = createElement(doc, "span", {
    position: "relative",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: "500",
    lineHeight: "1.4",
    color: muted,
  });
  wrap.className = "paperchat-agent-activity-shimmer";
  wrap.setAttribute("data-agent-activity-thinking-label", "true");

  const text = createElement(doc, "span", {
    position: "relative",
    zIndex: "1",
  });
  text.textContent = AGENT_ACTIVITY_THINKING_LABEL;
  wrap.appendChild(text);

  const mask = createElement(doc, "span", {
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "2",
  });
  const beam = createElement(doc, "span", {
    position: "absolute",
    top: "-10%",
    left: "0",
    width: "50%",
    height: "120%",
    background: beamGradient,
    opacity: dark ? "0.55" : "0.75",
    mixBlendMode: dark ? "screen" : "overlay",
  });
  beam.className = "paperchat-agent-activity-thinking-beam";
  if (animate) {
    beam.style.animation =
      "paperchat-agent-activity-beam-sweep 1.8s ease-in-out infinite";
  }
  mask.appendChild(beam);
  wrap.appendChild(mask);

  return wrap;
}

function scheduleNextFrame(doc: Document, callback: () => void): void {
  const view = (doc.defaultView ?? Zotero.getMainWindow()) as Window | null;
  if (view && typeof view.requestAnimationFrame === "function") {
    view.requestAnimationFrame(callback);
    return;
  }
  if (view && typeof view.setTimeout === "function") {
    view.setTimeout(callback, 0);
    return;
  }
  setTimeout(callback, 0);
}

export function getAgentActivityContainerSelector(messageId: string): string {
  return `[data-agent-activity-for="${messageId}"]`;
}

export function getStreamingReasoningSelector(messageId: string): string {
  return `[data-streaming-reasoning-for="${messageId}"]`;
}

export function getStreamingReasoningContainerSelector(
  messageId: string,
): string {
  return `[data-streaming-reasoning-container-for="${messageId}"]`;
}

export interface AgentActivityPanelOptions {
  messageId: string;
  reasoning: string;
  content: string;
  isWorking: boolean;
  /** Wall-clock start of this turn (e.g. preceding user message time). */
  activityStartedAt?: number;
  /** Wall-clock end when the assistant turn finished (assistant message timestamp). */
  activityEndedAt?: number;
  turnUsage?: ChatMessageTurnUsage;
  /** Hide per-tool rows when the docked execution plan already lists steps. */
  hideToolActivityRows?: boolean;
}

const HIDE_TOOL_ACTIVITY_ATTR = "data-hide-tool-activity-rows";

function shouldHideToolActivityRows(host: HTMLElement): boolean {
  return host.getAttribute(HIDE_TOOL_ACTIVITY_ATTR) === "true";
}

function removeToolActivityRows(list: HTMLElement): void {
  list
    .querySelectorAll(
      '[data-agent-activity-row="tool"], [data-agent-activity-row="search"], .paperchat-tool-result',
    )
    .forEach((node) => node.remove());
}

function parseTurnUsageAttribute(
  raw: string | null,
): ChatMessageTurnUsage | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as ChatMessageTurnUsage;
  } catch {
    return undefined;
  }
}

function setTurnUsageAttribute(
  panel: HTMLElement,
  turnUsage?: ChatMessageTurnUsage,
): void {
  if (turnUsage && getTurnTokenTotal(turnUsage)) {
    panel.setAttribute(ACTIVITY_TURN_USAGE_ATTR, JSON.stringify(turnUsage));
    return;
  }
  panel.removeAttribute(ACTIVITY_TURN_USAGE_ATTR);
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

function normalizeReasoningText(reasoning: string): string {
  return reasoning
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean)
    .join("\n");
}

function extractToolEntries(content: string): ParsedToolCallEntry[] {
  return parseToolCallFragments(content)
    .filter(
      (fragment): fragment is Extract<typeof fragment, { kind: "tool" }> =>
        fragment.kind === "tool",
    )
    .map((fragment) => fragment.entry)
    .filter((entry) => !isPresentationToolCallEntry(entry));
}

function formatActivityDuration(seconds: number): string {
  const safe = Math.max(1, Math.round(seconds));
  if (safe < 60) {
    return getString("chat-agent-activity-duration-sec", {
      args: { n: String(safe) },
    });
  }
  const totalMinutes = Math.floor(safe / 60);
  if (totalMinutes < 60) {
    return getString("chat-agent-activity-duration-min", {
      args: { n: String(totalMinutes) },
    });
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return getString("chat-agent-activity-duration-hour", {
      args: { n: String(hours) },
    });
  }
  return getString("chat-agent-activity-duration-hour-min", {
    args: { h: String(hours), m: String(minutes) },
  });
}

function resolveActivityDurationSeconds(
  startedAt: number,
  endedAt: number | undefined,
  isWorking: boolean,
): number {
  let end = isWorking ? Date.now() : endedAt;
  if (end == null || !Number.isFinite(end)) {
    end = Date.now();
  }
  if (!Number.isFinite(startedAt)) {
    return 1;
  }
  if (end < startedAt) {
    // Historical render without a reliable start time — avoid showing "1s" forever.
    end = startedAt;
  }
  const seconds = Math.round((end - startedAt) / 1000);
  return Math.max(1, seconds);
}

function formatActivitySummary(
  reasoningLineCount: number,
  toolCount: number,
  durationSeconds: number,
  turnUsage?: ChatMessageTurnUsage,
): string {
  const duration = formatActivityDuration(durationSeconds);
  let summary: string;
  if (reasoningLineCount > 0 && toolCount > 0) {
    summary = getString("chat-agent-activity-summary-mixed", {
      args: { duration, tools: toolCount },
    });
  } else if (toolCount > 0) {
    summary = getString("chat-agent-activity-summary-tools", {
      args: { count: toolCount, duration },
    });
  } else {
    summary = getString("chat-agent-activity-summary-thought", {
      args: { duration },
    });
  }

  const totalTokens = getTurnTokenTotal(turnUsage);
  if (!totalTokens) {
    return summary;
  }

  return `${summary}${getString("chat-agent-activity-token-suffix", {
    args: { tokens: formatCompactTokenCount(totalTokens) },
  })}`;
}

function getLiveTurnTokenDisplay(
  turnUsage: ChatMessageTurnUsage | undefined,
  reasoning: string,
): number | undefined {
  const apiTotal = getTurnTokenTotal(turnUsage);
  if (apiTotal) {
    return apiTotal;
  }
  const normalizedReasoning = reasoning.trim();
  if (!normalizedReasoning) {
    return undefined;
  }
  return estimateTextTokens(normalizedReasoning);
}

function syncActivityHeaderTokens(
  container: HTMLElement,
  isWorking: boolean,
  turnUsage: ChatMessageTurnUsage | undefined,
  reasoning: string,
): void {
  const liveTokens = container.querySelector(
    "[data-agent-activity-live-tokens]",
  ) as HTMLElement | null;
  if (!liveTokens) {
    return;
  }

  if (!isWorking) {
    liveTokens.style.display = "none";
    liveTokens.textContent = "";
    return;
  }

  const total = getLiveTurnTokenDisplay(turnUsage, reasoning);
  if (!total) {
    liveTokens.style.display = "none";
    liveTokens.textContent = "";
    return;
  }

  liveTokens.textContent = getString("chat-agent-activity-token-suffix", {
    args: { tokens: formatCompactTokenCount(total) },
  });
  liveTokens.style.display = "inline";
}

type ActivityItemStatus = "complete" | "active";

type AgentActivityTextItem = {
  kind: "text";
  id: string;
  content: string;
};

type AgentActivityToolItem = {
  kind: "tool";
  id: string;
  entry: ParsedToolCallEntry;
  status: ActivityItemStatus;
};

type AgentActivityItem = AgentActivityTextItem | AgentActivityToolItem;

function normalizeToolName(toolName: string): string {
  return toolName.trim().replace(/^[^A-Za-z0-9_-]+/u, "");
}

export function splitReasoningIntoLines(reasoning: string): string[] {
  const normalized = normalizeReasoningText(reasoning);
  if (!normalized) {
    return [];
  }
  if (normalized.includes("\n")) {
    return normalized.split("\n");
  }
  if (normalized.length > 120) {
    return normalized
      .split(/(?<=[.!?。！？])\s+/u)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [normalized];
}

export interface BuildAgentActivityItemsOptions {
  isWorking?: boolean;
  hideToolActivityRows?: boolean;
}

export function buildAgentActivityItems(
  reasoning: string,
  content: string,
  options: BuildAgentActivityItemsOptions = {},
): AgentActivityItem[] {
  const items: AgentActivityItem[] = [];
  let lines = splitReasoningIntoLines(reasoning);
  if (options.isWorking && lines.length > MAX_REASONING_LINES_WHILE_WORKING) {
    lines = lines.slice(-MAX_REASONING_LINES_WHILE_WORKING);
  }

  for (let index = 0; index < lines.length; index++) {
    items.push({
      kind: "text",
      id: `text-${index}`,
      content: lines[index],
    });
  }

  if (!options.hideToolActivityRows) {
    const tools = extractToolEntries(content);
    for (let index = 0; index < tools.length; index++) {
      const entry = tools[index];
      items.push({
        kind: "tool",
        id: entry.expandKey || `tool-${index}-${entry.toolName}`,
        entry,
        status: entry.status === "calling" ? "active" : "complete",
      });
    }
  }
  return items;
}

function renderTextRow(
  doc: Document,
  theme: ThemeColors,
  item: AgentActivityTextItem,
): HTMLElement {
  const row = createElement(
    doc,
    "div",
    {
      padding: "4px 6px",
      fontSize: "12px",
      lineHeight: "1.5",
      color: theme.textMuted,
      borderRadius: "6px",
      wordBreak: "break-word",
    },
    {
      "data-agent-activity-row": "text",
      "data-agent-activity-item-id": item.id,
    },
  );
  row.className = "paperchat-agent-activity-row paperchat-agent-activity-text-row";
  row.textContent = item.content;
  return row;
}

function renderSearchRow(
  doc: Document,
  theme: ThemeColors,
  item: AgentActivityToolItem,
): HTMLElement {
  return createSearchActivityElement(
    doc,
    theme,
    item.entry,
    item.id,
    item.status,
  );
}

function renderActivityItems(
  doc: Document,
  theme: ThemeColors,
  list: HTMLElement,
  items: AgentActivityItem[],
): { reasoningLines: number; toolCount: number } {
  list.textContent = "";
  let reasoningLines = 0;
  let toolCount = 0;
  const messageId = getActivityMessageId(list);

  for (const item of items) {
    if (item.kind === "text") {
      reasoningLines++;
      list.appendChild(renderTextRow(doc, theme, item));
      continue;
    }
    toolCount++;
    if (isSearchToolName(item.entry.toolName)) {
      list.appendChild(renderSearchRow(doc, theme, item));
    } else {
      list.appendChild(
        createToolResultActivityElement(
          doc,
          theme,
          item.entry,
          item.id,
          item.status,
          messageId,
        ),
      );
    }
  }

  return { reasoningLines, toolCount };
}

function getToolActivityId(entry: ParsedToolCallEntry, index: number): string {
  if (entry.expandKey) {
    return entry.expandKey;
  }
  return `tool-${index}-${normalizeToolName(entry.toolName)}`;
}

function buildToolActivityItem(
  entry: ParsedToolCallEntry,
  id: string,
): AgentActivityToolItem {
  return {
    kind: "tool",
    id,
    entry,
    status: entry.status === "calling" ? "active" : "complete",
  };
}

function renderToolActivityRow(
  doc: Document,
  theme: ThemeColors,
  list: HTMLElement,
  item: AgentActivityToolItem,
): HTMLElement {
  if (isSearchToolName(item.entry.toolName)) {
    return renderSearchRow(doc, theme, item);
  }
  return createToolResultActivityElement(
    doc,
    theme,
    item.entry,
    item.id,
    item.status,
    getActivityMessageId(list),
  );
}

function getSearchActivityContentSig(entry: ParsedToolCallEntry): string {
  return `${entry.toolArgs ?? ""}\n${entry.toolResult ?? ""}\n${entry.statusText ?? ""}`;
}

function updateToolActivityRow(
  row: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  list: HTMLElement,
  item: AgentActivityToolItem,
): void {
  const nextStatus = item.status;
  const currentStatus = row.getAttribute("data-agent-step-status");
  const currentToolStatus = row.getAttribute("data-tool-card-status");

  if (isSearchToolName(item.entry.toolName)) {
    const nextSig = getSearchActivityContentSig(item.entry);
    const currentSig = row.getAttribute("data-search-content-sig") ?? "";
    if (
      currentStatus === nextStatus &&
      currentToolStatus === item.entry.status &&
      currentSig === nextSig
    ) {
      return;
    }
    const nextRow = renderToolActivityRow(doc, theme, list, item);
    nextRow.setAttribute("data-search-content-sig", nextSig);
    row.replaceWith(nextRow);
    return;
  }

  const nextSig = getToolResultContentSignature(item.entry);
  const currentSig = row.getAttribute("data-tool-result-content-sig") ?? "";
  if (
    currentStatus === nextStatus &&
    currentToolStatus === item.entry.status &&
    currentSig === nextSig
  ) {
    return;
  }

  if (row.classList.contains("paperchat-tool-result")) {
    updateToolResultActivityElement(
      row,
      doc,
      theme,
      item.entry,
      item.status,
      getActivityMessageId(list),
    );
    row.setAttribute("data-agent-step-status", item.status);
    return;
  }

  row.replaceWith(renderToolActivityRow(doc, theme, list, item));
}

function ensureReasoningStreamElement(
  doc: Document,
  theme: ThemeColors,
  list: HTMLElement,
): HTMLElement {
  let reasoningEl = list.querySelector(
    '[data-agent-activity-reasoning-stream="true"]',
  ) as HTMLElement | null;
  if (reasoningEl) {
    return reasoningEl;
  }

  reasoningEl = createElement(
    doc,
    "div",
    {
      padding: "4px 6px",
      fontSize: "12px",
      lineHeight: "1.5",
      color: theme.textMuted,
      borderRadius: "6px",
      wordBreak: "break-word",
      whiteSpace: "pre-wrap",
    },
    {
      "data-agent-activity-reasoning-stream": "true",
      "data-agent-activity-item-id": "reasoning-stream",
    },
  );
  reasoningEl.className =
    "paperchat-agent-activity-row paperchat-agent-activity-text-row paperchat-agent-activity-reasoning-stream";

  const firstTool = list.querySelector(
    '[data-agent-activity-row="tool"], [data-agent-activity-row="search"]',
  );
  if (firstTool) {
    list.insertBefore(reasoningEl, firstTool);
  } else {
    list.appendChild(reasoningEl);
  }
  return reasoningEl;
}

function pinReasoningStreamBeforeTools(list: HTMLElement): void {
  const reasoningEl = list.querySelector(
    '[data-agent-activity-reasoning-stream="true"]',
  );
  if (!reasoningEl) {
    return;
  }
  const firstTool = list.querySelector(
    '[data-agent-activity-row="tool"], [data-agent-activity-row="search"]',
  );
  if (firstTool && reasoningEl.nextSibling !== firstTool) {
    list.insertBefore(reasoningEl, firstTool);
  }
}

function syncActivityRowsIncremental(
  doc: Document,
  theme: ThemeColors,
  list: HTMLElement,
  reasoning: string,
  content: string,
): { reasoningLines: number; toolCount: number } {
  let lines = splitReasoningIntoLines(reasoning);
  const reasoningLines = lines.length;
  if (lines.length > MAX_REASONING_LINES_WHILE_WORKING) {
    lines = lines.slice(-MAX_REASONING_LINES_WHILE_WORKING);
  }
  const reasoningText = lines.join("\n");

  if (reasoningText) {
    const reasoningEl = ensureReasoningStreamElement(doc, theme, list);
    if (reasoningEl.textContent !== reasoningText) {
      reasoningEl.textContent = reasoningText;
    }
    reasoningEl.style.display = "block";
  } else {
    const reasoningEl = list.querySelector(
      '[data-agent-activity-reasoning-stream="true"]',
    ) as HTMLElement | null;
    if (reasoningEl) {
      reasoningEl.style.display = "none";
    }
  }

  pinReasoningStreamBeforeTools(list);

  const hideTools = shouldHideToolActivityRows(list);
  if (hideTools) {
    removeToolActivityRows(list);
    return { reasoningLines, toolCount: 0 };
  }

  const tools = extractToolEntries(content);
  for (let index = 0; index < tools.length; index++) {
    const entry = tools[index];
    const toolId = getToolActivityId(entry, index);
    const item = buildToolActivityItem(entry, toolId);
    const existing = list.querySelector(
      `[data-agent-activity-item-id="${toolId}"]`,
    ) as HTMLElement | null;
    if (existing) {
      updateToolActivityRow(existing, doc, theme, list, item);
      continue;
    }
    list.appendChild(renderToolActivityRow(doc, theme, list, item));
  }

  pinReasoningStreamBeforeTools(list);

  return { reasoningLines, toolCount: tools.length };
}

function syncActivityRows(
  doc: Document,
  theme: ThemeColors,
  list: HTMLElement,
  reasoning: string,
  content: string,
  isWorking: boolean,
): { reasoningLines: number; toolCount: number } {
  const hideTools = shouldHideToolActivityRows(list);
  if (isWorking) {
    return syncActivityRowsIncremental(doc, theme, list, reasoning, content);
  }

  const items = buildAgentActivityItems(reasoning, content, {
    isWorking,
    hideToolActivityRows: hideTools,
  });
  if (hideTools) {
    removeToolActivityRows(list);
  }
  return renderActivityItems(doc, theme, list, items);
}

function syncViewportScroll(
  viewport: HTMLElement,
  content: HTMLElement,
  isWorking: boolean,
): void {
  content.style.transform = "translateY(0)";
  const contentHeight = content.scrollHeight;
  const viewportHeight = viewport.clientHeight;
  const capped = contentHeight > viewportHeight;
  if (!capped) {
    viewport.style.maskImage = "";
    viewport.style.webkitMaskImage = "";
    viewport.style.overflowY = "hidden";
    viewport.scrollTop = 0;
    return;
  }

  if (isWorking) {
    viewport.style.overflowY = "auto";
    viewport.style.maskImage =
      "linear-gradient(to bottom, transparent, black 14px)";
    viewport.style.webkitMaskImage = viewport.style.maskImage;
    const doc = viewport.ownerDocument;
    scheduleNextFrame(doc, () => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return;
  }

  viewport.style.overflowY = "hidden";
  viewport.scrollTop = 0;
  viewport.style.maskImage =
    "linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent)";
  viewport.style.webkitMaskImage = viewport.style.maskImage;
}

function setDisclosureOpen(
  disclosure: HTMLElement,
  viewport: HTMLElement,
  open: boolean,
  isWorking: boolean,
): void {
  disclosure.style.display = open || isWorking ? "block" : "none";
  viewport.style.height = isWorking
    ? `${ACTIVITY_MAX_HEIGHT_PX}px`
    : open
      ? `${Math.min(
          ACTIVITY_MAX_HEIGHT_PX,
          (disclosure.querySelector("[data-agent-activity-list]") as HTMLElement)
            ?.offsetHeight || 0,
        )}px`
      : "0px";
}

export function createAgentActivityPanel(
  doc: Document,
  theme: ThemeColors,
  options: AgentActivityPanelOptions,
): HTMLElement {
  const startedAt = options.activityStartedAt ?? Date.now();
  const endedAt = options.activityEndedAt;
  const container = createElement(
    doc,
    "div",
    {
      marginBottom: "10px",
      maxWidth: "100%",
    },
    {
      class: "paperchat-agent-activity",
      "data-agent-activity-for": options.messageId,
      "data-streaming-reasoning-container-for": options.messageId,
      [ACTIVITY_STARTED_AT_ATTR]: String(startedAt),
      ...(endedAt != null
        ? { [ACTIVITY_ENDED_AT_ATTR]: String(endedAt) }
        : {}),
      ...(options.hideToolActivityRows
        ? { [HIDE_TOOL_ACTIVITY_ATTR]: "true" }
        : {}),
    },
  );

  const header = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    minHeight: "28px",
    gap: "6px",
  });
  header.className = "paperchat-agent-activity-header";

  const workingLabel = createThinkingShimmerLabel(doc, isDarkMode());

  const liveTokens = createElement(
    doc,
    "span",
    {
      display: "none",
      fontSize: "12px",
      fontWeight: "500",
      color: theme.textMuted,
      flexShrink: "0",
      whiteSpace: "nowrap",
    },
    { "data-agent-activity-live-tokens": "true" },
  );
  liveTokens.className = "paperchat-agent-activity-live-tokens";

  const summaryButton = doc.createElementNS(
    HTML_NS,
    "button",
  ) as HTMLButtonElement;
  Object.assign(summaryButton.style, {
    display: "none",
    alignItems: "center",
    gap: "4px",
    padding: "2px 4px",
    margin: "0",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "500",
    color: theme.textMuted,
    fontFamily: "inherit",
    textAlign: "left",
  });
  summaryButton.type = "button";
  summaryButton.className = "paperchat-agent-activity-summary";

  const chevron = createUiChevron(doc, {
    size: 14,
    opacity: 0.55,
  });

  const summaryText = createElement(doc, "span", {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  summaryText.setAttribute("data-agent-activity-summary-text", "true");
  summaryButton.appendChild(summaryText);
  summaryButton.appendChild(chevron);

  header.appendChild(workingLabel);
  header.appendChild(liveTokens);
  header.appendChild(summaryButton);
  container.appendChild(header);

  const disclosure = createElement(doc, "div", {
    overflow: "hidden",
    transition: "height 0.18s ease",
  });
  disclosure.setAttribute("data-agent-activity-disclosure", "true");

  const viewport = createElement(doc, "div", {
    overflow: "hidden",
    maxHeight: `${ACTIVITY_MAX_HEIGHT_PX}px`,
  });
  viewport.className = "paperchat-agent-activity-viewport";

  const list = createElement(doc, "div", {
    padding: "4px 2px 6px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  });
  list.setAttribute("data-agent-activity-list", "true");
  list.setAttribute("data-streaming-reasoning-for", options.messageId);
  list.setAttribute("data-streaming-reasoning-role", "body");
  if (options.hideToolActivityRows) {
    list.setAttribute(HIDE_TOOL_ACTIVITY_ATTR, "true");
  }

  viewport.appendChild(list);
  disclosure.appendChild(viewport);
  container.appendChild(disclosure);

  const stats = syncActivityRows(
    doc,
    theme,
    list,
    options.reasoning,
    options.content,
    options.isWorking,
  );

  if (options.isWorking) {
    container.classList.add("paperchat-agent-activity--working");
  }
  if (isDarkMode()) {
    container.classList.add("paperchat-agent-activity--dark");
  }

  let expanded = options.isWorking;
  setDisclosureOpen(disclosure, viewport, expanded, options.isWorking);

  if (options.isWorking) {
    workingLabel.style.display = "inline-block";
    summaryButton.style.display = "none";
  } else {
    workingLabel.style.display = "none";
    summaryButton.style.display = "inline-flex";
    summaryText.textContent = formatActivitySummary(
      stats.reasoningLines,
      stats.toolCount,
      resolveActivityDurationSeconds(startedAt, endedAt, false),
      options.turnUsage,
    );
    expanded = false;
    setDisclosureOpen(disclosure, viewport, expanded, false);
  }

  const updateSummary = () => {
    const isWorkingNow =
      container.getAttribute("data-agent-working") === "true";
    const currentStats = syncActivityRows(
      doc,
      theme,
      list,
      container.getAttribute("data-agent-reasoning") || options.reasoning,
      container.getAttribute("data-agent-content") || options.content,
      isWorkingNow,
    );
    const started = Number(container.getAttribute(ACTIVITY_STARTED_AT_ATTR)) || startedAt;
    const endedRaw = container.getAttribute(ACTIVITY_ENDED_AT_ATTR);
    const ended = endedRaw ? Number(endedRaw) : endedAt;
    const duration = resolveActivityDurationSeconds(
      started,
      Number.isFinite(ended) ? ended : undefined,
      isWorkingNow,
    );
    summaryText.textContent = formatActivitySummary(
      currentStats.reasoningLines,
      currentStats.toolCount,
      duration,
      parseTurnUsageAttribute(
        container.getAttribute(ACTIVITY_TURN_USAGE_ATTR),
      ),
    );
    syncActivityHeaderTokens(
      container,
      isWorkingNow,
      parseTurnUsageAttribute(container.getAttribute(ACTIVITY_TURN_USAGE_ATTR)),
      container.getAttribute("data-agent-reasoning") || options.reasoning,
    );
    syncViewportScroll(viewport, list, isWorkingNow);
    if (isWorkingNow) {
      setDisclosureOpen(disclosure, viewport, true, true);
    }
  };

  container.setAttribute("data-agent-reasoning", options.reasoning);
  container.setAttribute("data-agent-content", options.content);
  setTurnUsageAttribute(container, options.turnUsage);

  summaryButton.addEventListener("click", () => {
    expanded = !expanded;
    setUiChevronExpanded(chevron, expanded);
    setDisclosureOpen(disclosure, viewport, expanded, false);
    if (expanded) {
      scheduleNextFrame(doc, () => {
        syncViewportScroll(viewport, list, false);
        viewport.style.overflowY = "auto";
      });
    } else {
      viewport.style.overflowY = "hidden";
    }
  });

  summaryButton.addEventListener("mouseenter", () => {
    summaryButton.style.color = theme.textPrimary;
  });
  summaryButton.addEventListener("mouseleave", () => {
    summaryButton.style.color = theme.textMuted;
  });

  scheduleNextFrame(doc, () => {
    syncViewportScroll(viewport, list, options.isWorking);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        syncViewportScroll(
          viewport,
          list,
          container.getAttribute("data-agent-working") === "true",
        );
      });
      observer.observe(list);
    }
  });

  container.setAttribute(
    "data-agent-working",
    options.isWorking ? "true" : "false",
  );
  (container as HTMLElement & { __updateAgentActivity?: () => void }).__updateAgentActivity =
    updateSummary;
  updateSummary();

  return container;
}

export function updateAgentActivityPanel(
  container: HTMLElement,
  messageId: string,
  reasoning: string,
  content: string,
  isWorking: boolean,
  turnUsage?: ChatMessageTurnUsage,
  hideToolActivityRows = false,
): void {
  const activityPanel = container.querySelector(
    getAgentActivityContainerSelector(messageId),
  ) as (HTMLElement & { __updateAgentActivity?: () => void }) | null;

  if (!activityPanel) {
    return;
  }

  activityPanel.setAttribute("data-agent-reasoning", reasoning);
  activityPanel.setAttribute("data-agent-content", content);
  activityPanel.setAttribute("data-agent-working", isWorking ? "true" : "false");
  activityPanel.setAttribute(
    HIDE_TOOL_ACTIVITY_ATTR,
    hideToolActivityRows ? "true" : "false",
  );
  const activityList = activityPanel.querySelector(
    "[data-agent-activity-list]",
  ) as HTMLElement | null;
  activityList?.setAttribute(
    HIDE_TOOL_ACTIVITY_ATTR,
    hideToolActivityRows ? "true" : "false",
  );
  setTurnUsageAttribute(activityPanel, turnUsage);
  activityPanel.classList.toggle("paperchat-agent-activity--working", isWorking);

  const hasContent =
    Boolean(reasoning.trim()) ||
    (!hideToolActivityRows && content.includes("<tool-call"));
  activityPanel.style.display = hasContent || isWorking ? "block" : "none";

  const workingLabel = activityPanel.querySelector(
    "[data-agent-activity-thinking-label]",
  ) as HTMLElement | null;
  const summaryButton = activityPanel.querySelector(
    ".paperchat-agent-activity-summary",
  ) as HTMLElement | null;

  if (isWorking) {
    workingLabel && (workingLabel.style.display = "inline-block");
    summaryButton && (summaryButton.style.display = "none");
    activityPanel.classList.remove("paperchat-agent-activity--complete");
    const disclosure = activityPanel.querySelector(
      "[data-agent-activity-disclosure]",
    ) as HTMLElement | null;
    const viewport = activityPanel.querySelector(
      ".paperchat-agent-activity-viewport",
    ) as HTMLElement | null;
    if (disclosure && viewport) {
      setDisclosureOpen(disclosure, viewport, true, true);
    }
  } else {
    if (!activityPanel.hasAttribute(ACTIVITY_ENDED_AT_ATTR)) {
      activityPanel.setAttribute(ACTIVITY_ENDED_AT_ATTR, String(Date.now()));
    }
    workingLabel && (workingLabel.style.display = "none");
    summaryButton && (summaryButton.style.display = "inline-flex");
    activityPanel.classList.add("paperchat-agent-activity--complete");
    const disclosure = activityPanel.querySelector(
      "[data-agent-activity-disclosure]",
    ) as HTMLElement | null;
    const viewport = activityPanel.querySelector(
      ".paperchat-agent-activity-viewport",
    ) as HTMLElement | null;
    if (disclosure && viewport) {
      setDisclosureOpen(disclosure, viewport, false, false);
    }
  }

  activityPanel.__updateAgentActivity?.();
}

export function finalizeAgentActivityPanel(
  container: HTMLElement,
  messageId: string,
  reasoning: string,
  content: string,
  turnUsage?: ChatMessageTurnUsage,
): void {
  const activityPanel = container.querySelector(
    getAgentActivityContainerSelector(messageId),
  ) as HTMLElement & { __updateAgentActivity?: () => void };
  if (!activityPanel) {
    return;
  }

  activityPanel.setAttribute("data-agent-reasoning", reasoning);
  activityPanel.setAttribute("data-agent-content", content);
  activityPanel.setAttribute("data-agent-working", "false");
  activityPanel.setAttribute(ACTIVITY_ENDED_AT_ATTR, String(Date.now()));
  setTurnUsageAttribute(activityPanel, turnUsage);

  const workingLabel = activityPanel.querySelector(
    "[data-agent-activity-thinking-label]",
  ) as HTMLElement | null;
  const summaryButton = activityPanel.querySelector(
    ".paperchat-agent-activity-summary",
  ) as HTMLElement | null;
  const disclosure = activityPanel.querySelector(
    "[data-agent-activity-disclosure]",
  ) as HTMLElement | null;
  const viewport = activityPanel.querySelector(
    ".paperchat-agent-activity-viewport",
  ) as HTMLElement | null;

  workingLabel && (workingLabel.style.display = "none");
  summaryButton && (summaryButton.style.display = "inline-flex");

  activityPanel.__updateAgentActivity?.();

  if (disclosure && viewport) {
    setDisclosureOpen(disclosure, viewport, false, false);
  }
}
