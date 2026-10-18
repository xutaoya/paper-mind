import type { ParsedToolCallEntry } from "./MarkdownRenderer";
import { getAgentUiSemanticColors } from "./AgentUiTheme";
import { getString } from "../../../utils/locale";
import { HTML_NS } from "./types";
import type { ThemeColors } from "./types";

export const SEARCH_TOOL_NAMES = new Set([
  "web_search",
  "search_scholarly_sources",
]);

export type SearchActivityStatus = "complete" | "active";

export interface SearchSourcePreview {
  title: string;
  url: string;
  domain: string;
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

function isTextTruncated(el: HTMLElement, fullText?: string): boolean {
  if (el.clientWidth <= 0) {
    return false;
  }
  if (
    el.scrollWidth > el.clientWidth + 1 ||
    el.scrollHeight > el.clientHeight + 1
  ) {
    return true;
  }
  const text = (fullText ?? el.textContent ?? "").trim();
  if (!text) {
    return false;
  }
  return measureTextOverflow(el, text);
}

export function measureTextOverflow(el: HTMLElement, text: string): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    return text.length > 48;
  }

  const style = win.getComputedStyle(el);
  if (!style) {
    return text.length > 48;
  }

  const mount = (doc.documentElement ?? doc.body) as HTMLElement | null;
  if (!mount) {
    return text.length > 48;
  }

  const probe = doc.createElementNS(HTML_NS, "span") as HTMLElement;
  probe.textContent = text;
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "nowrap",
    font: style.font,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
  });
  mount.appendChild(probe);
  const singleLineWidth = probe.offsetWidth;
  mount.removeChild(probe);

  if (singleLineWidth > el.clientWidth + 1) {
    return true;
  }

  const lineClampValue = Number.parseInt(style.webkitLineClamp || "", 10);
  if (!Number.isFinite(lineClampValue) || lineClampValue <= 0) {
    return false;
  }

  const multiProbe = doc.createElementNS(HTML_NS, "span") as HTMLElement;
  multiProbe.textContent = text;
  Object.assign(multiProbe.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    display: "block",
    width: `${el.clientWidth}px`,
    font: style.font,
    lineHeight: style.lineHeight,
    wordBreak: style.wordBreak,
    whiteSpace: "normal",
  });
  mount.appendChild(multiProbe);
  const lineHeight =
    Number.parseFloat(style.lineHeight) ||
    Number.parseFloat(style.fontSize) * 1.45;
  const overflows = multiProbe.offsetHeight > lineHeight * lineClampValue + 1;
  mount.removeChild(multiProbe);
  return overflows;
}

export function resolveTooltipMaxWidth(win: Window, margin = 8): number {
  const viewportWidth =
    win.innerWidth ||
    win.document.documentElement.clientWidth ||
    win.document.body?.clientWidth ||
    420;
  return Math.min(420, Math.max(160, viewportWidth - margin * 2));
}

type TooltipContext = {
  doc: Document;
  mount: HTMLElement;
  win: Window;
};

type TooltipMountState = {
  el: HTMLElement;
  scrollHide: (() => void) | null;
};

const tooltipStateByMount = new WeakMap<HTMLElement, TooltipMountState>();
let activeTooltipContext: TooltipContext | null = null;

const TOOLTIP_STYLES: Record<string, string> = {
  position: "fixed",
  zIndex: "2147483647",
  display: "none",
  width: "max-content",
  maxWidth: "420px",
  padding: "6px 10px",
  borderRadius: "8px",
  fontSize: "12px",
  lineHeight: "1.4",
  fontWeight: "400",
  color: "#f8fafc",
  background: "rgba(15, 23, 42, 0.92)",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
  whiteSpace: "normal",
  wordBreak: "break-word",
  overflow: "visible",
  textOverflow: "clip",
  pointerEvents: "none",
};

function resolveTooltipContext(anchor: HTMLElement): TooltipContext {
  const doc = anchor.ownerDocument;
  const win = (doc.defaultView ?? Zotero.getMainWindow()) as Window;
  const mount = (doc.documentElement ?? doc.body) as HTMLElement;
  return { doc, mount, win };
}

function getTooltipEl(ctx: TooltipContext): HTMLElement {
  let state = tooltipStateByMount.get(ctx.mount);
  if (!state) {
    const el = ctx.doc.createElementNS(HTML_NS, "div") as HTMLElement;
    el.className = "paperchat-fixed-tooltip";
    el.setAttribute("role", "tooltip");
    Object.assign(el.style, TOOLTIP_STYLES);
    ctx.mount.appendChild(el);
    state = { el, scrollHide: null };
    tooltipStateByMount.set(ctx.mount, state);
  }
  return state.el;
}

function positionTooltip(
  tip: HTMLElement,
  anchor: HTMLElement,
  win: Window,
): void {
  const anchorRect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 6;

  tip.style.display = "block";
  tip.style.visibility = "hidden";
  tip.style.maxWidth = `${resolveTooltipMaxWidth(win, margin)}px`;
  tip.style.left = "0";
  tip.style.top = "0";

  const tipRect = tip.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.top - tipRect.height - gap;

  if (top < margin) {
    top = anchorRect.bottom + gap;
  }

  const maxLeft = Math.max(margin, win.innerWidth - tipRect.width - margin);
  left = Math.min(Math.max(left, margin), maxLeft);
  const maxTop = Math.max(margin, win.innerHeight - tipRect.height - margin);
  top = Math.min(Math.max(top, margin), maxTop);

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.style.visibility = "visible";
}

function hideFixedTooltip(ctx?: TooltipContext): void {
  const target = ctx ?? activeTooltipContext;
  if (!target) {
    return;
  }

  const state = tooltipStateByMount.get(target.mount);
  if (!state) {
    activeTooltipContext = null;
    return;
  }

  state.el.style.display = "none";
  if (state.scrollHide) {
    target.doc.removeEventListener("scroll", state.scrollHide, true);
    state.scrollHide = null;
  }

  if (!ctx || activeTooltipContext?.mount === target.mount) {
    activeTooltipContext = null;
  }
}

function showFixedTooltip(anchor: HTMLElement, text: string): void {
  const ctx = resolveTooltipContext(anchor);
  hideFixedTooltip();
  activeTooltipContext = ctx;

  const tip = getTooltipEl(ctx);
  const state = tooltipStateByMount.get(ctx.mount);
  if (!state) {
    return;
  }

  if (state.scrollHide) {
    ctx.doc.removeEventListener("scroll", state.scrollHide, true);
    state.scrollHide = null;
  }

  tip.textContent = text;
  positionTooltip(tip, anchor, ctx.win);
  scheduleAfterLayout(ctx.doc, () => {
    if (
      activeTooltipContext?.mount !== ctx.mount ||
      tip.style.display === "none"
    ) {
      return;
    }
    positionTooltip(tip, anchor, ctx.win);
    if (state.scrollHide) {
      return;
    }
    state.scrollHide = () => hideFixedTooltip(ctx);
    ctx.doc.addEventListener("scroll", state.scrollHide, true);
  });
}

function bindTruncationTooltip(
  host: HTMLElement,
  measureEl: HTMLElement,
  fullText: string,
): void {
  if (!fullText.trim()) {
    return;
  }

  host.style.cursor = "help";

  const show = () => {
    if (isTextTruncated(measureEl, fullText) || fullText.length > 28) {
      showFixedTooltip(host, fullText);
    }
  };

  host.addEventListener("mouseenter", show);
  host.addEventListener("mouseleave", () => hideFixedTooltip());
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().replace(/^[^A-Za-z0-9_-]+/u, "");
}

export function isSearchToolName(toolName: string): boolean {
  return SEARCH_TOOL_NAMES.has(normalizeToolName(toolName));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] || url;
  }
}

function unquoteUrl(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseSourceLine(body: string): SearchSourcePreview | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    const url = urlMatch[0].replace(/[),.;]+$/u, "");
    const title = trimmed
      .replace(url, "")
      .replace(/\s*[—-]\s*$/u, "")
      .trim();
    const domain = extractDomain(url);
    return {
      title: title || domain,
      url,
      domain,
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = trimmed;
    const domain = extractDomain(url);
    return { title: domain, url, domain };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { title: trimmed, url: "", domain: trimmed };
  }

  return null;
}

function parseQueryFromToolArgsDisplay(args: string): string | null {
  const trimmed = args.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        query?: string;
        queries?: string[];
      };
      if (typeof parsed.query === "string" && parsed.query.trim()) {
        return parsed.query.trim();
      }
      if (Array.isArray(parsed.queries) && parsed.queries[0]) {
        return String(parsed.queries[0]).trim();
      }
    } catch {
      // fall through to display format
    }
  }

  const quoted = trimmed.match(
    /\bquery=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/,
  );
  if (quoted) {
    return (quoted[1] ?? quoted[2] ?? "").replace(/\\"/g, '"').trim();
  }

  const bare = trimmed.match(/\bquery=([^,]+)/);
  if (bare?.[1]) {
    return bare[1].replace(/^["']|["']$/g, "").trim();
  }

  return null;
}

function parseQueryFromRawArgs(args: string): string | null {
  const trimmed = args.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      query?: string;
      queries?: string[];
    };
    if (typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim();
    }
    if (Array.isArray(parsed.queries) && parsed.queries[0]) {
      return String(parsed.queries[0]).trim();
    }
  } catch {
    return null;
  }
  return null;
}

function looksTruncatedQuery(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.endsWith("...") || trimmed.endsWith("…");
}

function pickLongestSearchQuery(candidates: string[]): string {
  if (candidates.length === 0) {
    return "";
  }
  const nonTruncated = candidates.filter(
    (candidate) => !looksTruncatedQuery(candidate),
  );
  const pool = nonTruncated.length > 0 ? nonTruncated : candidates;
  return pool.reduce((longest, current) =>
    current.length > longest.length ? current : longest,
  );
}

export function parseSearchQueryFromEntry(entry: ParsedToolCallEntry): string {
  const result = entry.toolResult || "";
  const candidates: string[] = [];

  const hostedQuery = result.match(/^query:\s*(.+)$/m);
  if (hostedQuery?.[1]) {
    candidates.push(hostedQuery[1].trim());
  }

  const webSearchMatch = result.match(
    /(?:Web|Scholarly) search results for "([^"]+)"/i,
  );
  if (webSearchMatch?.[1]) {
    candidates.push(webSearchMatch[1].trim());
  }

  if (entry.toolArgs) {
    const fromRawArgs = parseQueryFromRawArgs(entry.toolArgs);
    if (fromRawArgs) {
      candidates.push(fromRawArgs);
    }

    const fromArgs = parseQueryFromToolArgsDisplay(entry.toolArgs);
    if (fromArgs) {
      candidates.push(fromArgs);
    }
  }

  return pickLongestSearchQuery(candidates);
}

export function parseSearchSources(toolResult?: string): SearchSourcePreview[] {
  if (!toolResult) {
    return [];
  }

  const sources: SearchSourcePreview[] = [];
  const seen = new Set<string>();
  let inWebSourceBlock = false;

  for (const line of toolResult.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed === "Web source URLs:") {
      inWebSourceBlock = true;
      continue;
    }
    if (trimmed === "End web source URLs") {
      inWebSourceBlock = false;
      continue;
    }
    if (trimmed === "sources:") {
      continue;
    }

    if (inWebSourceBlock && trimmed.startsWith("- ")) {
      const url = unquoteUrl(trimmed.slice(2));
      if (!/^https?:\/\//i.test(url)) {
        continue;
      }
      const domain = extractDomain(url);
      const key = url.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      sources.push({ title: domain, url, domain });
      continue;
    }

    if (!trimmed.startsWith("- ")) {
      continue;
    }

    const parsed = parseSourceLine(trimmed.slice(2));
    if (!parsed) {
      continue;
    }
    const key = (parsed.url || parsed.title).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sources.push(parsed);
  }

  return sources.slice(0, 4);
}

function createDomainFavicon(
  doc: Document,
  domain: string,
  theme: ThemeColors,
): HTMLElement {
  const wrap = createElement(doc, "span", {
    width: "16px",
    height: "16px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    borderRadius: "4px",
    overflow: "hidden",
    background: theme.inputBg,
    fontSize: "10px",
    fontWeight: "600",
    color: theme.textMuted,
    lineHeight: "1",
  });
  wrap.className = "paperchat-search-source-favicon";

  if (!domain) {
    wrap.textContent = "?";
    return wrap;
  }

  const img = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  img.alt = "";
  img.width = 16;
  img.height = 16;
  img.style.display = "block";
  img.style.width = "16px";
  img.style.height = "16px";
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  img.addEventListener("error", () => {
    img.remove();
    wrap.textContent = domain.charAt(0).toUpperCase();
  });
  wrap.appendChild(img);
  return wrap;
}

function createSearchSourceRow(
  doc: Document,
  theme: ThemeColors,
  source: SearchSourcePreview,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: "0",
    lineHeight: "1.35",
  });
  row.className = "paperchat-search-source-row";

  row.appendChild(createDomainFavicon(doc, source.domain, theme));

  const titleHost = createElement(doc, "span", {
    flex: "1",
    minWidth: "0",
    position: "relative",
  });
  const title = createElement(doc, "span", {
    display: "block",
    fontSize: "12px",
    fontWeight: "500",
    color: theme.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  title.className = "paperchat-search-source-title";
  title.textContent = source.title;
  titleHost.appendChild(title);
  bindTruncationTooltip(titleHost, title, source.title);
  row.appendChild(titleHost);

  const domainHost = createElement(doc, "span", {
    flexShrink: "0",
    maxWidth: "42%",
    position: "relative",
  });
  const domain = createElement(doc, "span", {
    display: "block",
    fontSize: "11px",
    color: theme.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  domain.className = "paperchat-search-source-domain";
  domain.textContent = source.domain;
  domainHost.appendChild(domain);
  bindTruncationTooltip(domainHost, domain, source.url || source.domain);
  row.appendChild(domainHost);

  return row;
}

export function createSearchActivityElement(
  doc: Document,
  theme: ThemeColors,
  entry: ParsedToolCallEntry,
  itemId: string,
  status: SearchActivityStatus,
): HTMLElement {
  const isScholarly =
    normalizeToolName(entry.toolName) === "search_scholarly_sources";
  const isActive = status === "active";
  const isError = entry.status === "error";
  const query = parseSearchQueryFromEntry(entry);
  const sources = parseSearchSources(entry.toolResult);
  const contentSig = `${entry.toolArgs ?? ""}\n${entry.toolResult ?? ""}\n${entry.statusText ?? ""}`;

  const row = createElement(
    doc,
    "div",
    {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      margin: "6px 0 4px",
      padding: "2px 0",
      minWidth: "0",
    },
    {
      "data-agent-activity-row": "search",
      "data-agent-activity-item-id": itemId,
      "data-agent-step-status": status,
      "data-tool-card-status": entry.status,
      "data-search-content-sig": contentSig,
    },
  );
  row.className =
    "paperchat-agent-activity-row paperchat-agent-activity-search-row";

  if (isActive && !isError) {
    const statusLabel = createElement(doc, "span", {
      fontSize: "12px",
      fontWeight: "500",
      color: theme.textMuted,
      lineHeight: "1.4",
    });
    statusLabel.textContent = getString(
      isScholarly
        ? "chat-agent-activity-searching-scholarly"
        : "chat-agent-activity-searching-web",
    );
    row.appendChild(statusLabel);
  }

  if (query) {
    const queryRow = createElement(doc, "div", {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      minWidth: "0",
      position: "relative",
    });
    const icon = createElement(doc, "span", {
      flexShrink: "0",
      fontSize: "13px",
      color: theme.textMuted,
      opacity: "0.9",
      lineHeight: "1",
    });
    icon.textContent = "⌕";
    const queryEl = createElement(doc, "span", {
      flex: "1",
      minWidth: "0",
      fontSize: "12px",
      lineHeight: "1.45",
      color: theme.textSecondary,
      overflow: "hidden",
      display: "-webkit-box",
      WebkitLineClamp: "2",
      WebkitBoxOrient: "vertical",
      wordBreak: "break-word",
    });
    queryEl.className = "paperchat-search-query-text";
    queryEl.textContent = query;
    bindTruncationTooltip(queryRow, queryEl, query);
    queryRow.appendChild(icon);
    queryRow.appendChild(queryEl);
    row.appendChild(queryRow);
  }

  if (sources.length > 0) {
    const list = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      paddingTop: "1px",
    });
    for (const source of sources) {
      list.appendChild(createSearchSourceRow(doc, theme, source));
    }
    row.appendChild(list);
  }

  if (isError) {
    const errorEl = createElement(doc, "span", {
      fontSize: "11px",
      color: getAgentUiSemanticColors().error,
    });
    errorEl.setAttribute("data-agent-tool-status-text", "true");
    errorEl.textContent = entry.statusText;
    row.appendChild(errorEl);
  }

  return row;
}
