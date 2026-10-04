import { config } from "../../../../package.json";
import {
  formatReadingDate,
  formatReadingDuration,
  formatReadingDurationCompact,
  getReadingStatsSnapshot,
  isReadingTimeAccumulatingNow,
  type DayReadingItem,
  type ItemReadingEntry,
  type ReadingStatsSnapshot,
  type RecentlyAddedEntry,
} from "../../reading-stats";
import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import { HTML_NS } from "./types";
import type { ThemeColors } from "./types";
import { isBookmarkManagerVisible } from "./BookmarkManagerPanel";
import { isDarkMode } from "./ChatPanelTheme";
import {
  formatCompactTokenCount,
  formatTokenCount,
} from "../../../utils/tokens";
import {
  getTokenStatsSnapshot,
  type TokenBarDay,
  type TokenModelRecord,
  type TokenStatsSnapshot,
} from "../../token-stats/TokenStatsStore";
import {
  createCollapsibleSection,
  createReadingTrackerStatus,
  formatBarAxisDayLabel,
  formatWeekDeltaHint,
  getLocalizedWeekdayLabels,
  shouldShowMonthOnBarAxis,
  bindStatsPanelResponsive,
  applyStatsPanelLayout,
} from "./stats/StatsPanelUi";
import {
  getChatActivitySnapshot,
  type ChatActivitySnapshot,
  type ChatDayCell,
} from "../../workflow-stats";
const SVG_NS = "http://www.w3.org/2000/svg";

const PANEL_ID = "chat-reading-stats-panel";
const VIEW_HOST_READING = "stats-view-reading";
const VIEW_HOST_TOKEN = "stats-view-tokens";

function getReadingAccent(theme: ThemeColors): string {
  return theme.sendButtonBg || "#2563eb";
}

const HEATMAP_LEVEL_COLORS_LIGHT = [
  "#ebedf0",
  "#c6e48b",
  "#7bc96f",
  "#239a3b",
  "#196127",
] as const;

const HEATMAP_LEVEL_COLORS_DARK = [
  "#2d333b",
  "#0e4429",
  "#006d32",
  "#26a641",
  "#39d353",
] as const;

/** Token heatmap uses indigo/violet, separate from reading green. */
const TOKEN_HEATMAP_LEVEL_COLORS_LIGHT = [
  "#ebedf0",
  "#ddd6fe",
  "#a78bfa",
  "#7c3aed",
  "#5b21b6",
] as const;

const TOKEN_HEATMAP_LEVEL_COLORS_DARK = [
  "#2d333b",
  "#2e1065",
  "#5b21b6",
  "#7c3aed",
  "#a78bfa",
] as const;

/** Chat activity heatmap — blue, distinct from reading green. */
const CHAT_HEATMAP_LEVEL_COLORS_LIGHT = [
  "#ebedf0",
  "#bfdbfe",
  "#60a5fa",
  "#2563eb",
  "#1e40af",
] as const;

const CHAT_HEATMAP_LEVEL_COLORS_DARK = [
  "#2d333b",
  "#1e3a5f",
  "#1d4ed8",
  "#2563eb",
  "#60a5fa",
] as const;

function formatTooltipDate(date: Date): string {
  try {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatHeatmapMonthLabel(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
    }).format(date);
  } catch {
    return `${date.getMonth() + 1}`;
  }
}

function renderMonthAxis(
  doc: Document,
  theme: ThemeColors,
  cells: { date: Date }[],
  weekCount: number,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "flex",
    alignItems: "flex-start",
    gap: "2px",
    width: "100%",
    minHeight: "14px",
    marginBottom: "2px",
  });
  row.appendChild(createElement(doc, "div", { width: "22px", flexShrink: "0" }));

  const track = createElement(doc, "div", {
    position: "relative",
    flex: "1",
    minWidth: "0",
    height: "14px",
  });

  let lastMonth = -1;
  for (let week = 0; week < weekCount; week += 1) {
    const cell = cells[week * 7];
    if (!cell) {
      continue;
    }
    const month = cell.date.getMonth();
    if (month === lastMonth) {
      continue;
    }
    lastMonth = month;
    const label = createElement(doc, "div", {
      position: "absolute",
      top: "0",
      left: `${(week / weekCount) * 100}%`,
      transform: "translateX(-1px)",
      fontSize: "10px",
      lineHeight: "14px",
      color: theme.textMuted,
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    const fullLabel = formatHeatmapMonthLabel(cell.date);
    label.className = "paperchat-stats-month-label";
    label.dataset.fullLabel = fullLabel;
    label.dataset.compactLabel = String(cell.date.getMonth() + 1);
    label.textContent = fullLabel;
    track.appendChild(label);
  }

  row.appendChild(track);
  return row;
}

function prefersReducedMotion(doc: Document): boolean {
  try {
    const view = doc.defaultView;
    if (!view) {
      return false;
    }
    const mql = view.matchMedia("(prefers-reduced-motion: reduce)");
    return mql?.matches ?? false;
  } catch {
    return false;
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function runCountUp(
  element: HTMLElement,
  durationMs: number,
  render: (progress: number) => void,
  onComplete?: () => void,
): void {
  const win = element.ownerDocument.defaultView;
  if (!win) {
    onComplete?.();
    return;
  }
  const start = win.performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    render(easeOutCubic(t));
    if (t < 1) {
      win.requestAnimationFrame(tick);
    } else {
      onComplete?.();
    }
  };
  win.requestAnimationFrame(tick);
}

function pulseStatValue(element: HTMLElement): void {
  element.classList.remove("paperchat-stats-metric-value--pulse");
  void element.offsetWidth;
  element.classList.add("paperchat-stats-metric-value--pulse");
}

function animateMetricCards(
  doc: Document,
  cards: HTMLElement[],
  values: {
    total: number;
    withReadingTime: number;
    literatureTotal: number;
    weekSeconds: number;
    progressPercent: number;
  },
): void {
  const reduced = prefersReducedMotion(doc);
  cards.forEach((card, index) => {
    card.classList.add("paperchat-stats-metric-card--enter");
    card.style.animationDelay = reduced ? "0ms" : `${index * 50}ms`;
  });

  if (reduced) {
    return;
  }

  const valueEls = cards.map((card) =>
    card.querySelector(".paperchat-stats-metric-value"),
  ) as (HTMLElement | null)[];
  const progressFill = cards[1]?.querySelector(
    ".paperchat-stats-progress-fill",
  ) as HTMLElement | null;

  if (valueEls[0]) {
    valueEls[0].textContent = "0";
    runCountUp(valueEls[0], 520, (p) => {
      valueEls[0]!.textContent = String(
        Math.round(values.total * p),
      );
    }, () => pulseStatValue(valueEls[0]!));
  }

  if (valueEls[1]) {
    const denom = values.literatureTotal;
    valueEls[1].textContent = denom > 0 ? `0/${denom}` : "0";
    runCountUp(valueEls[1], 620, (p) => {
      const num = Math.round(values.withReadingTime * p);
      valueEls[1]!.textContent =
        denom > 0 ? `${num}/${denom}` : String(num);
    }, () => pulseStatValue(valueEls[1]!));
  }

  if (progressFill) {
    progressFill.style.width = "0%";
    winDelay(doc, 80, () => {
      progressFill.style.width = `${Math.min(
        100,
        Math.max(values.progressPercent, values.progressPercent > 0 ? 5 : 0),
      )}%`;
    });
  }

  if (valueEls[2]) {
    valueEls[2].textContent = formatReadingDurationCompact(0);
    runCountUp(valueEls[2], 500, (p) => {
      valueEls[2]!.textContent = formatReadingDurationCompact(
        Math.round(values.weekSeconds * p),
      );
    }, () => pulseStatValue(valueEls[2]!));
  }
}

function winDelay(doc: Document, ms: number, fn: () => void): void {
  doc.defaultView?.setTimeout(fn, ms);
}

function getStatValueColor(
  tone: "default" | "progress" | "time",
  theme: ThemeColors,
  muted?: boolean,
): string {
  if (muted) {
    return theme.textMuted;
  }
  if (isDarkMode()) {
    switch (tone) {
      case "progress":
        return "#34d399";
      case "time":
        return "#a5b4fc";
      default:
        return theme.sendButtonText === "#ffffff"
          ? "#f8fafc"
          : theme.textPrimary;
    }
  }
  switch (tone) {
    case "progress":
      return "#059669";
    case "time":
      return "#4f46e5";
    default:
      return getReadingAccent(theme);
  }
}

function metricCardBorder(theme: ThemeColors): string {
  return isDarkMode()
    ? "1px solid rgba(255, 255, 255, 0.08)"
    : `1px solid ${theme.borderColor}`;
}

function createStatCard(
  doc: Document,
  theme: ThemeColors,
  label: string,
  value: string,
  options?: {
    progress?: number;
    valueMuted?: boolean;
    hint?: string;
    hintTitle?: string;
    valueTone?: "default" | "progress" | "time";
  },
): HTMLElement {
  const card = createElement(doc, "div", {
    flex: "1",
    minWidth: "0",
    minHeight: "76px",
    padding: "10px 10px 9px",
    borderRadius: "12px",
    border: metricCardBorder(theme),
    background: isDarkMode()
      ? "rgba(255, 255, 255, 0.03)"
      : theme.inputBg,
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    boxShadow: isDarkMode()
      ? "none"
      : "0 1px 2px rgba(15, 23, 42, 0.04)",
  });
  card.className = "paperchat-stats-metric-card";

  const labelEl = createElement(doc, "div", {
    fontSize: "10px",
    fontWeight: "600",
    color: theme.textMuted,
    lineHeight: "1.25",
  });
  labelEl.textContent = label;

  const valueEl = createElement(doc, "div", {
    fontSize: "18px",
    fontWeight: "700",
    color: getStatValueColor(
      options?.valueTone ?? "default",
      theme,
      options?.valueMuted,
    ),
    lineHeight: "1.15",
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    wordBreak: "keep-all",
  });
  valueEl.textContent = value;
  valueEl.className = "paperchat-stats-metric-value";

  card.appendChild(labelEl);
  card.appendChild(valueEl);

  if (options?.progress != null && options.progress >= 0) {
    const accent = getReadingAccent(theme);
    const track = createElement(doc, "div", {
      height: "3px",
      borderRadius: "999px",
      background: isDarkMode()
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(15, 23, 42, 0.06)",
      overflow: "hidden",
      marginTop: "2px",
    });
    const targetWidth = Math.min(
      100,
      Math.max(options.progress, options.progress > 0 ? 5 : 0),
    );
    const fill = createElement(doc, "div", {
      height: "100%",
      width: "0%",
      borderRadius: "999px",
      background: accent,
      opacity: isDarkMode() ? "0.85" : "0.75",
    });
    fill.className = "paperchat-stats-progress-fill";
    fill.dataset.targetWidth = String(targetWidth);
    if (prefersReducedMotion(doc)) {
      fill.style.width = `${targetWidth}%`;
    }
    track.appendChild(fill);
    card.appendChild(track);
  }

  if (options?.hint) {
    const hintEl = createElement(doc, "div", {
      fontSize: "10px",
      color: theme.textMuted,
      lineHeight: "1.35",
      marginTop: "auto",
    });
    hintEl.className = "paperchat-stats-metric-hint";
    hintEl.textContent = options.hint;
    if (options.hintTitle) {
      hintEl.title = options.hintTitle;
    }
    card.appendChild(hintEl);
  }

  return card;
}

function createReadingProgressStatCard(
  doc: Document,
  theme: ThemeColors,
  snapshot: ReadingStatsSnapshot,
): HTMLElement {
  const { total, withReadingTime } = snapshot.literature;
  const ratio = total > 0 ? withReadingTime / total : 0;
  const value =
    total > 0 ? `${withReadingTime}/${total}` : String(withReadingTime);

  return createStatCard(
    doc,
    theme,
    getString("chat-stats-literature-read"),
    value,
    {
      progress: ratio * 100,
      valueMuted: withReadingTime === 0 && total > 0,
      valueTone: "progress",
    },
  );
}

function createSectionTitle(
  doc: Document,
  theme: ThemeColors,
  text: string,
  options?: { first?: boolean },
): HTMLElement {
  const title = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "650",
    color: theme.textSecondary,
    marginTop: options?.first ? "4px" : "18px",
    marginBottom: "8px",
    paddingBottom: "6px",
    borderBottom: isDarkMode()
      ? "1px solid rgba(255, 255, 255, 0.08)"
      : `1px solid ${theme.borderColor}`,
    letterSpacing: "0.01em",
  });
  title.className = "paperchat-stats-section-title";
  title.textContent = text;
  return title;
}

function attachLiteratureRowAction(
  row: HTMLElement,
  libraryID: number,
  itemKey: string,
): void {
  row.classList.add("paperchat-stats-list-row");
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  const activate = (): void => {
    focusLiteratureItem(libraryID, itemKey);
  };
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
}

function createStatsEmptyIcon(doc: Document, theme: ThemeColors): HTMLElement {
  const wrap = createElement(doc, "div", {
    display: "flex",
    justifyContent: "center",
    marginBottom: "10px",
    color: theme.textMuted,
    opacity: "0.5",
  });
  wrap.className = "paperchat-stats-empty-icon";
  wrap.setAttribute("aria-hidden", "true");

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const bars: Array<[string, string, string, string]> = [
    ["1.5", "8", "3", "6.5"],
    ["6.5", "4.5", "3", "10"],
    ["11.5", "1.5", "3", "13"],
  ];
  for (const [x, y, width, height] of bars) {
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    rect.setAttribute("rx", "0.8");
    rect.setAttribute("fill", "currentColor");
    svg.appendChild(rect);
  }
  wrap.appendChild(svg);
  return wrap;
}

function createEmptyHint(doc: Document, theme: ThemeColors, text: string): HTMLElement {
  const wrap = createElement(doc, "div", {
    padding: "28px 16px 20px",
    textAlign: "center",
    borderRadius: "12px",
    border: isDarkMode()
      ? "1px dashed rgba(255, 255, 255, 0.1)"
      : `1px dashed ${theme.borderColor}`,
    background: isDarkMode()
      ? "rgba(255, 255, 255, 0.02)"
      : "rgba(15, 23, 42, 0.02)",
  });
  wrap.className = "paperchat-stats-empty";
  wrap.appendChild(createStatsEmptyIcon(doc, theme));
  const hint = createElement(doc, "div", {
    color: theme.textMuted,
    fontSize: "12px",
    lineHeight: "1.55",
    maxWidth: "280px",
    margin: "0 auto",
  });
  hint.className = "paperchat-stats-empty-hint";
  hint.textContent = text;
  wrap.appendChild(hint);
  return wrap;
}

function readingBarColor(rank: number): string {
  const palette = isDarkMode()
    ? ["#39d353", "#26a641", "#006d32", "#0e4429"]
    : ["#196127", "#239a3b", "#7bc96f", "#9be9a8"];
  return palette[Math.min(rank - 1, palette.length - 1)] ?? palette[palette.length - 1];
}

function revealBar(fill: HTMLElement, percent: number): void {
  const width = `${Math.min(100, Math.max(percent, percent > 0 ? 8 : 0))}%`;
  if (prefersReducedMotion(fill.ownerDocument)) {
    fill.style.width = width;
    return;
  }
  fill.style.width = "0%";
  fill.ownerDocument.defaultView?.requestAnimationFrame(() => {
    fill.style.width = width;
  });
}

function createReadingRankRow(
  doc: Document,
  theme: ThemeColors,
  rank: number,
  item: ItemReadingEntry,
  maxSeconds: number,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 0 8px",
  });
  row.className = "paperchat-stats-bar-row paperchat-stats-list-row";

  const head = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) auto",
    columnGap: "8px",
    alignItems: "baseline",
  });
  const indexEl = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "650",
    color: readingBarColor(rank),
    fontVariantNumeric: "tabular-nums",
  });
  indexEl.textContent = String(rank);
  const titleEl = createElement(doc, "div", {
    fontSize: "13px",
    fontWeight: "550",
    color: theme.textPrimary,
    lineHeight: "1.35",
    overflow: "hidden",
    display: "-webkit-box",
    webkitLineClamp: "2",
    webkitBoxOrient: "vertical",
  });
  titleEl.textContent = item.title;
  titleEl.title = item.title;
  const durationEl = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "650",
    color: readingBarColor(1),
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  });
  durationEl.textContent = formatReadingDuration(item.totalSeconds);
  head.appendChild(indexEl);
  head.appendChild(titleEl);
  head.appendChild(durationEl);

  const track = createElement(doc, "div", {
    height: "8px",
    borderRadius: "999px",
    background: isDarkMode()
      ? "rgba(255, 255, 255, 0.06)"
      : "rgba(15, 23, 42, 0.06)",
    overflow: "hidden",
  });
  const ratio = item.totalSeconds / Math.max(maxSeconds, 1);
  const fill = createElement(doc, "div", {
    height: "100%",
    width: "0%",
    borderRadius: "999px",
    background: readingBarColor(rank),
  });
  fill.className = "paperchat-stats-read-bar-fill";
  track.appendChild(fill);
  revealBar(fill, ratio * 100);

  const metaEl = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    lineHeight: "1.3",
  });
  metaEl.textContent = getString("chat-stats-item-last-read", {
    args: { date: formatReadingDate(item.lastReadAt) },
  });

  row.appendChild(head);
  row.appendChild(track);
  row.appendChild(metaEl);
  attachLiteratureRowAction(row, item.libraryID, item.itemKey);
  return row;
}

function formatItemTypeLabel(typeName: string): string {
  try {
    const typeID = Zotero.ItemTypes.getID(typeName);
    const name = typeID ? Zotero.ItemTypes.getName(typeID) : typeName;
    return name || typeName;
  } catch {
    return typeName;
  }
}

function createDateStamp(
  doc: Document,
  theme: ThemeColors,
  timestamp: number,
): HTMLElement {
  const date = new Date(timestamp);
  const stamp = createElement(doc, "div", {
    width: "40px",
    minHeight: "44px",
    borderRadius: "10px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.inputBg,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    position: "relative",
    zIndex: "1",
  });
  stamp.className = "paperchat-stats-date-stamp";
  const month = createElement(doc, "div", {
    fontSize: "9px",
    fontWeight: "600",
    color: theme.textMuted,
    lineHeight: "1.1",
    letterSpacing: "0.02em",
  });
  try {
    month.textContent = date.toLocaleDateString(undefined, { month: "short" });
  } catch {
    month.textContent = `${date.getMonth() + 1}`;
  }
  const day = createElement(doc, "div", {
    fontSize: "16px",
    fontWeight: "700",
    color: theme.textPrimary,
    lineHeight: "1.1",
    fontVariantNumeric: "tabular-nums",
  });
  day.textContent = String(date.getDate());
  stamp.appendChild(month);
  stamp.appendChild(day);
  stamp.title = formatReadingDate(timestamp);
  return stamp;
}

function createRecentItemRow(
  doc: Document,
  theme: ThemeColors,
  item: RecentlyAddedEntry,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "40px minmax(0, 1fr)",
    columnGap: "12px",
    alignItems: "start",
    paddingBottom: "14px",
    position: "relative",
  });
  row.className = "paperchat-stats-timeline-item paperchat-stats-list-row";
  row.appendChild(createDateStamp(doc, theme, item.dateAdded));

  const main = createElement(doc, "div", {
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    paddingTop: "4px",
  });
  const titleEl = createElement(doc, "div", {
    fontSize: "13px",
    fontWeight: "550",
    color: theme.textPrimary,
    lineHeight: "1.4",
    overflow: "hidden",
    display: "-webkit-box",
    webkitLineClamp: "2",
    webkitBoxOrient: "vertical",
  });
  titleEl.textContent = item.title;
  titleEl.title = item.title;
  const metaEl = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    lineHeight: "1.3",
  });
  metaEl.textContent = formatItemTypeLabel(item.itemType);
  main.appendChild(titleEl);
  main.appendChild(metaEl);
  row.appendChild(main);
  attachLiteratureRowAction(row, item.libraryID, item.itemKey);
  return row;
}

function renderTopReadingList(
  doc: Document,
  theme: ThemeColors,
  items: ItemReadingEntry[],
): HTMLElement {
  const wrap = createElement(doc, "div", {});
  if (!items.length) {
    wrap.appendChild(
      createEmptyHint(doc, theme, getString("chat-stats-top-reading-empty")),
    );
    return wrap;
  }
  const list = createElement(doc, "div", {});
  list.className = "paperchat-stats-bar-list";
  const maxSeconds = Math.max(...items.map((entry) => entry.totalSeconds), 1);
  items.forEach((item, index) => {
    list.appendChild(
      createReadingRankRow(doc, theme, index + 1, item, maxSeconds),
    );
  });
  wrap.appendChild(list);
  return wrap;
}

function renderRecentlyAddedList(
  doc: Document,
  theme: ThemeColors,
  items: RecentlyAddedEntry[],
): HTMLElement {
  const wrap = createElement(doc, "div", {});
  if (!items.length) {
    wrap.appendChild(
      createEmptyHint(doc, theme, getString("chat-stats-recent-added-empty")),
    );
    return wrap;
  }
  const list = createElement(doc, "div", {
    paddingTop: "12px",
  });
  list.className = "paperchat-stats-timeline";
  for (const item of items) {
    list.appendChild(createRecentItemRow(doc, theme, item));
  }
  wrap.appendChild(list);
  return wrap;
}

function buildChatWeekCardHint(chat: ChatActivitySnapshot): {
  hint?: string;
  hintTitle?: string;
} {
  const weekLine = getString("chat-stats-chat-week-messages", {
    args: { count: String(chat.messagesThisWeek) },
  });
  const details: string[] = [weekLine];
  const weekDelta = formatWeekDeltaHint(
    chat.messagesThisWeek,
    chat.messagesLastWeek,
    (value) => String(value),
  );
  if (weekDelta) {
    details.push(weekDelta);
  }
  if (chat.activeDaysThisWeek > 0) {
    details.push(
      getString("chat-stats-chat-active-days", {
        args: { count: String(chat.activeDaysThisWeek) },
      }),
    );
  }
  return {
    hint: weekDelta || weekLine,
    hintTitle: details.length > 1 ? details.join(" · ") : undefined,
  };
}

function showChatDayHoverTooltip(
  panel: HTMLElement,
  anchor: HTMLElement,
  theme: ThemeColors,
  cell: ChatDayCell,
): void {
  if (cell.totalMessages <= 0) {
    return;
  }
  hideTokenBarHoverTooltip(panel);
  const doc = panel.ownerDocument;
  const tooltip = createElement(doc, "div", {
    position: "absolute",
    zIndex: "6",
    pointerEvents: "none",
    maxWidth: "min(260px, calc(100% - 16px))",
    padding: "6px 10px",
    borderRadius: "8px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.14)",
    fontSize: "11px",
    color: theme.textSecondary,
  });
  tooltip.id = TOKEN_BAR_HOVER_TOOLTIP_ID;
  tooltip.textContent = getString("chat-stats-chat-day-tooltip", {
    args: {
      date: formatTooltipDate(cell.date),
      total: String(cell.totalMessages),
      user: String(cell.userMessages),
      assistant: String(cell.assistantMessages),
    },
  });
  panel.appendChild(tooltip);
  positionBarHoverTooltip(panel, anchor, tooltip);
}

function openChatActivityDayPopover(
  panel: HTMLElement,
  cell: HTMLElement,
  theme: ThemeColors,
  cellData: ChatDayCell,
): void {
  closeHeatmapDayPopover(panel);
  cell.classList.add("paperchat-reading-heatmap-cell--selected");
  const doc = panel.ownerDocument;
  const popover = createElement(doc, "div", {
    position: "absolute",
    zIndex: "5",
    width: "220px",
    maxWidth: "calc(100% - 16px)",
    padding: "10px 10px 8px",
    borderRadius: "10px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
  });
  popover.id = DAY_POPOVER_ID;
  popover.className = "paperchat-stats-day-popover";
  popover.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }
    event.preventDefault();
    closeHeatmapDayPopover(panel);
  });

  const dateEl = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "650",
    color: theme.textPrimary,
    lineHeight: "1.35",
  });
  dateEl.textContent = formatTooltipDate(cellData.date);
  popover.appendChild(dateEl);

  const totalEl = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    marginTop: "4px",
    lineHeight: "1.4",
  });
  totalEl.textContent =
    cellData.totalMessages > 0
      ? getString("chat-stats-chat-day-detail", {
          args: {
            total: String(cellData.totalMessages),
            user: String(cellData.userMessages),
            assistant: String(cellData.assistantMessages),
          },
        })
      : getString("chat-stats-heatmap-empty-day");
  popover.appendChild(totalEl);

  panel.appendChild(popover);
  positionDayPopover(panel, cell, popover);
}

function renderChatActivityHeatmap(
  doc: Document,
  theme: ThemeColors,
  chat: ChatActivitySnapshot,
): HTMLElement {
  const colors = isDarkMode()
    ? CHAT_HEATMAP_LEVEL_COLORS_DARK
    : CHAT_HEATMAP_LEVEL_COLORS_LIGHT;
  const cells: ContributionCell[] = chat.cells.map((cell) => ({
    dayKey: cell.dayKey,
    date: cell.date,
    value: cell.totalMessages,
    level: cell.level,
  }));
  const cellByKey = new Map(chat.cells.map((cell) => [cell.dayKey, cell]));
  return renderContributionHeatmap(
    doc,
    theme,
    cells,
    chat.weekCount,
    (cell) =>
      cell.value > 0
        ? getString("chat-stats-chat-day-tooltip-short", {
            args: {
              date: formatTooltipDate(cell.date),
              total: String(cell.value),
            },
          })
        : `${formatTooltipDate(cell.date)} · ${getString("chat-stats-heatmap-empty-day")}`,
    (panelEl, cellEl, cell) => {
      const source = cellByKey.get(cell.dayKey);
      if (!source) {
        return;
      }
      openChatActivityDayPopover(panelEl, cellEl, theme, source);
    },
    colors,
    (panelEl, cellEl, cell) => {
      const source = cellByKey.get(cell.dayKey);
      if (!source) {
        return;
      }
      showChatDayHoverTooltip(panelEl, cellEl, theme, source);
    },
    (panelEl) => {
      hideTokenBarHoverTooltip(panelEl);
    },
  );
}

function renderChatActivitySection(
  doc: Document,
  theme: ThemeColors,
  chat: ChatActivitySnapshot,
): HTMLElement {
  const wrap = createElement(doc, "div", {});
  const cards = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  });
  cards.className = "paperchat-stats-metric-grid";
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-chat-user-total"),
      String(chat.totalUserMessages),
      { valueTone: "default" },
    ),
  );
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-chat-assistant-total"),
      String(chat.totalAssistantMessages),
      { valueTone: "default" },
    ),
  );
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-chat-this-week"),
      String(chat.messagesThisWeek),
      {
        ...buildChatWeekCardHint(chat),
        valueTone: "default",
      },
    ),
  );
  wrap.appendChild(cards);
  wrap.appendChild(renderChatActivityHeatmap(doc, theme, chat));
  const hint = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    marginTop: "6px",
    lineHeight: "1.45",
  });
  hint.textContent = getString("chat-stats-chat-heatmap-hint");
  wrap.appendChild(hint);
  return wrap;
}

const DAY_POPOVER_ID = "chat-reading-stats-day-popover";
const TOKEN_BAR_HOVER_TOOLTIP_ID = "chat-token-bar-hover-tooltip";

function closeHeatmapDayPopover(panel: HTMLElement): void {
  hideTokenBarHoverTooltip(panel);
  panel.querySelector(`#${DAY_POPOVER_ID}`)?.remove();
  panel
    .querySelectorAll(
      ".paperchat-reading-heatmap-cell--selected, .paperchat-stats-token-bar-column--selected",
    )
    .forEach((node) => {
      node.classList.remove(
        "paperchat-reading-heatmap-cell--selected",
        "paperchat-stats-token-bar-column--selected",
      );
    });
}

function focusLiteratureItem(libraryID: number, itemKey: string): void {
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    const pane = Zotero.getActiveZoteroPane?.();
    if (!item || !pane?.selectItem) {
      return;
    }
    void Promise.resolve(pane.selectItem(item.id));
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to select item:", error);
  }
}

function openHeatmapDayPopover(
  panel: HTMLElement,
  cell: HTMLElement,
  theme: ThemeColors,
  cellData: ReadingStatsSnapshot["cells"][number],
  items: DayReadingItem[],
): void {
  closeHeatmapDayPopover(panel);
  cell.classList.add("paperchat-reading-heatmap-cell--selected");
  const doc = panel.ownerDocument;
  const popover = createElement(doc, "div", {
    position: "absolute",
    zIndex: "5",
    width: "220px",
    maxWidth: "calc(100% - 16px)",
    padding: "10px 10px 8px",
    borderRadius: "10px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
  });
  popover.id = DAY_POPOVER_ID;
  popover.className = "paperchat-stats-day-popover";
  popover.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }
    event.preventDefault();
    closeHeatmapDayPopover(panel);
  });

  const dateEl = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "650",
    color: theme.textPrimary,
    lineHeight: "1.35",
  });
  dateEl.textContent = formatTooltipDate(cellData.date);
  popover.appendChild(dateEl);

  const summary = createElement(doc, "div", {
    marginTop: "4px",
    fontSize: "12px",
    color: theme.textSecondary,
  });
  summary.textContent =
    cellData.seconds > 0
      ? formatReadingDuration(cellData.seconds)
      : getString("chat-stats-heatmap-day-none");
  popover.appendChild(summary);

  if (items.length) {
    const list = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      marginTop: "8px",
    });
    for (const item of items) {
      const row = createElement(
        doc,
        "button",
        {
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "8px",
          width: "100%",
          padding: "6px 0",
          border: "none",
          borderTop: `1px solid ${theme.borderColor}`,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: theme.textPrimary,
        },
        { type: "button" },
      ) as HTMLButtonElement;
      const titleEl = createElement(doc, "span", {
        fontSize: "12px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      titleEl.textContent = item.title;
      titleEl.title = item.title;
      const durationEl = createElement(doc, "span", {
        fontSize: "11px",
        color: theme.textMuted,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      });
      durationEl.textContent = formatReadingDuration(item.seconds);
      row.appendChild(titleEl);
      row.appendChild(durationEl);
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        focusLiteratureItem(item.libraryID, item.itemKey);
      });
      list.appendChild(row);
    }
    popover.appendChild(list);
  } else if (cellData.seconds > 0) {
    const hint = createElement(doc, "div", {
      marginTop: "6px",
      fontSize: "11px",
      color: theme.textMuted,
      lineHeight: "1.4",
    });
    hint.textContent = getString("chat-stats-heatmap-day-no-items");
    popover.appendChild(hint);
  }

  panel.appendChild(popover);
  positionDayPopover(panel, cell, popover);
}

function bindHeatmapDayPopoverDismiss(panel: HTMLElement): void {
  if (panel.dataset.dayPopoverBound === "1") {
    return;
  }
  panel.dataset.dayPopoverBound = "1";
  const doc = panel.ownerDocument;
  doc.addEventListener(
    "mousedown",
    (event) => {
      if (!panel.isConnected || panel.style.display === "none") {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (target.closest(`#${DAY_POPOVER_ID}`)) {
        return;
      }
      if (target.closest(".paperchat-reading-heatmap-cell")) {
        return;
      }
      if (target.closest(".paperchat-stats-token-bar-column")) {
        return;
      }
      closeHeatmapDayPopover(panel);
    },
    true,
  );
}

interface ContributionCell {
  dayKey: string;
  date: Date;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
}

function positionDayPopover(
  panel: HTMLElement,
  cell: HTMLElement,
  popover: HTMLElement,
): void {
  const panelBox = panel.getBoundingClientRect();
  const cellBox = cell.getBoundingClientRect();
  const popBox = popover.getBoundingClientRect();
  let left = cellBox.left - panelBox.left;
  let top = cellBox.bottom - panelBox.top + 6;
  if (left + popBox.width > panelBox.width - 8) {
    left = Math.max(8, panelBox.width - popBox.width - 8);
  }
  if (top + popBox.height > panelBox.height - 8) {
    top = Math.max(8, cellBox.top - panelBox.top - popBox.height - 6);
  }
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function hideTokenBarHoverTooltip(panel: HTMLElement): void {
  panel.querySelector(`#${TOKEN_BAR_HOVER_TOOLTIP_ID}`)?.remove();
}

function showReadingDayHoverTooltip(
  panel: HTMLElement,
  anchor: HTMLElement,
  theme: ThemeColors,
  date: Date,
  seconds: number,
): void {
  if (seconds <= 0) {
    return;
  }
  hideTokenBarHoverTooltip(panel);
  const doc = panel.ownerDocument;
  const tooltip = createElement(doc, "div", {
    position: "absolute",
    zIndex: "6",
    pointerEvents: "none",
    maxWidth: "min(240px, calc(100% - 16px))",
    padding: "6px 10px",
    borderRadius: "8px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.14)",
    fontSize: "11px",
    color: theme.textSecondary,
  });
  tooltip.id = TOKEN_BAR_HOVER_TOOLTIP_ID;
  tooltip.className = "paperchat-stats-token-bar-tooltip";
  tooltip.textContent =
    seconds > 0
      ? getString("chat-stats-heatmap-day-tooltip", {
          args: {
            date: formatTooltipDate(date),
            duration: formatReadingDuration(seconds),
          },
        })
      : `${formatTooltipDate(date)} · ${getString("chat-stats-heatmap-empty-day")}`;
  panel.appendChild(tooltip);
  positionBarHoverTooltip(panel, anchor, tooltip);
}

function formatDayKeyLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) {
    return dayKey;
  }
  try {
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dayKey;
  }
}

function buildReadingWeekCardHint(snapshot: ReadingStatsSnapshot): {
  hint: string;
  hintTitle?: string;
} {
  const primary =
    snapshot.activeDaysThisWeek > 0
      ? getString("chat-stats-reading-active-days", {
          args: { count: String(snapshot.activeDaysThisWeek) },
        })
      : getString("chat-stats-reading-active-days-none");
  const details: string[] = [];
  const weekDelta = formatWeekDeltaHint(
    snapshot.totalSecondsThisWeek,
    snapshot.totalSecondsLastWeek,
    formatReadingDurationCompact,
  );
  if (weekDelta) {
    details.push(weekDelta);
  }
  if (snapshot.readingStreakDays > 0) {
    details.push(
      getString("chat-stats-streak-days", {
        args: { count: String(snapshot.readingStreakDays) },
      }),
    );
  }
  if (
    snapshot.totalSecondsThisWeek <= 0 &&
    snapshot.lastReadingDayKey &&
    (snapshot.dailySeconds[snapshot.lastReadingDayKey] || 0) > 0
  ) {
    details.push(
      getString("chat-stats-last-reading-day", {
        args: {
          date: formatDayKeyLabel(snapshot.lastReadingDayKey),
          duration: formatReadingDurationCompact(
            snapshot.dailySeconds[snapshot.lastReadingDayKey] || 0,
          ),
        },
      }),
    );
  }
  const hintTitle = details.length
    ? `${primary} · ${details.join(" · ")}`
    : undefined;
  const hint =
    details[0] && snapshot.activeDaysThisWeek > 0
      ? `${primary} · ${details[0]}`
      : primary;
  return { hint, hintTitle };
}

function buildTokenWeekCardHint(snapshot: TokenStatsSnapshot): {
  hint: string;
  hintTitle?: string;
} {
  const weekLine = getString("chat-stats-token-week", {
    args: { total: formatCompactTokenCount(snapshot.weekTokens) },
  });
  const details: string[] = [weekLine];
  const weekDelta = formatWeekDeltaHint(
    snapshot.weekTokens,
    snapshot.lastWeekTokens,
    formatCompactTokenCount,
  );
  if (weekDelta) {
    details.push(weekDelta);
  }
  if (snapshot.tokenStreakDays > 0) {
    details.push(
      getString("chat-stats-streak-days", {
        args: { count: String(snapshot.tokenStreakDays) },
      }),
    );
  }
  const hint = weekDelta || weekLine;
  return {
    hint,
    hintTitle: details.length > 1 ? details.join(" · ") : undefined,
  };
}

function invalidateStatsViewCache(panel: HTMLElement): void {
  panel
    .querySelectorAll(`#${VIEW_HOST_READING}, #${VIEW_HOST_TOKEN}`)
    .forEach((node) => {
      (node as HTMLElement).dataset.built = "0";
    });
}

function positionBarHoverTooltip(
  panel: HTMLElement,
  anchor: HTMLElement,
  tooltip: HTMLElement,
): void {
  const panelBox = panel.getBoundingClientRect();
  const anchorBox = anchor.getBoundingClientRect();
  const tipBox = tooltip.getBoundingClientRect();
  let left =
    anchorBox.left - panelBox.left + (anchorBox.width - tipBox.width) / 2;
  let top = anchorBox.top - panelBox.top - tipBox.height - 6;
  left = Math.max(8, Math.min(left, panelBox.width - tipBox.width - 8));
  if (top < 6) {
    top = anchorBox.bottom - panelBox.top + 6;
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTokenBarHoverTooltip(
  panel: HTMLElement,
  anchor: HTMLElement,
  theme: ThemeColors,
  day: TokenBarDay,
): void {
  if (day.totalTokens <= 0) {
    return;
  }
  hideTokenBarHoverTooltip(panel);
  const doc = panel.ownerDocument;
  const tooltip = createElement(doc, "div", {
    position: "absolute",
    zIndex: "6",
    pointerEvents: "none",
    maxWidth: "min(240px, calc(100% - 16px))",
    padding: "8px 10px",
    borderRadius: "8px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.14)",
    fontVariantNumeric: "tabular-nums",
  });
  tooltip.id = TOKEN_BAR_HOVER_TOOLTIP_ID;
  tooltip.className = "paperchat-stats-token-bar-tooltip";
  tooltip.textContent = getString("chat-stats-token-day-tooltip", {
    args: {
      date: formatTooltipDate(day.date),
      total: formatCompactTokenCount(day.totalTokens),
    },
  });

  panel.appendChild(tooltip);
  positionBarHoverTooltip(panel, anchor, tooltip);
}

function renderContributionHeatmap(
  doc: Document,
  theme: ThemeColors,
  cells: ContributionCell[],
  weekCount: number,
  _describe: (cell: ContributionCell) => string,
  onSelect: (
    panel: HTMLElement,
    cellEl: HTMLElement,
    cell: ContributionCell,
  ) => void,
  levelColors?: readonly string[],
  onCellEnter?: (
    panel: HTMLElement,
    cellEl: HTMLElement,
    cell: ContributionCell,
  ) => void,
  onCellLeave?: (panel: HTMLElement) => void,
): HTMLElement {
  const weekdayLabels = getLocalizedWeekdayLabels();
  const colors =
    levelColors ??
    (isDarkMode() ? HEATMAP_LEVEL_COLORS_DARK : HEATMAP_LEVEL_COLORS_LIGHT);
  const labelCol = "22px";
  const gridColumns = `${labelCol} repeat(${weekCount}, minmax(0, 1fr))`;
  const wrap = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
  });
  wrap.appendChild(renderMonthAxis(doc, theme, cells, weekCount));

  const grid = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: gridColumns,
    gridTemplateRows: "repeat(7, minmax(0, 1fr))",
    columnGap: "2px",
    rowGap: "2px",
    alignItems: "stretch",
    width: "100%",
  });

  for (let row = 0; row < 7; row += 1) {
    const weekday = createElement(doc, "div", {
      fontSize: "9px",
      color: theme.textMuted,
      lineHeight: "1.1",
      alignSelf: "center",
    });
    weekday.textContent =
      row === 1 || row === 3 || row === 5 ? weekdayLabels[row] : "";
    grid.appendChild(weekday);
    for (let week = 0; week < weekCount; week += 1) {
      const cellData = cells[week * 7 + row];
      const cell = createElement(doc, "div", {
        width: "100%",
        aspectRatio: "1",
        maxHeight: "11px",
        borderRadius: "2px",
        background: colors[cellData?.level ?? 0],
        cursor: "pointer",
        justifySelf: "stretch",
      });
      cell.className = "paperchat-reading-heatmap-cell";
      cell.dataset.level = String(cellData?.level ?? 0);
      if (cellData) {
        cell.setAttribute("role", "button");
        cell.addEventListener("mouseenter", () => {
          const panel = wrap.closest(`#${PANEL_ID}`) as HTMLElement | null;
          if (!panel || !onCellEnter) {
            return;
          }
          onCellEnter(panel, cell, cellData);
        });
        cell.addEventListener("mouseleave", () => {
          const panel = wrap.closest(`#${PANEL_ID}`) as HTMLElement | null;
          if (!panel) {
            return;
          }
          onCellLeave?.(panel);
        });
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          const panel = wrap.closest(`#${PANEL_ID}`) as HTMLElement | null;
          if (!panel) {
            return;
          }
          if (
            cell.classList.contains("paperchat-reading-heatmap-cell--selected")
          ) {
            closeHeatmapDayPopover(panel);
            return;
          }
          onSelect(panel, cell, cellData);
        });
      }
      grid.appendChild(cell);
    }
  }
  wrap.appendChild(grid);

  const legend = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
    marginTop: "4px",
    fontSize: "10px",
    color: theme.textMuted,
  });
  const less = createElement(doc, "span", {});
  less.textContent = getString("chat-stats-heatmap-less");
  legend.appendChild(less);
  for (let level = 0; level < 5; level += 1) {
    const swatch = createElement(doc, "div", {
      width: "9px",
      height: "9px",
      borderRadius: "2px",
      background: colors[level],
      flexShrink: "0",
    });
    legend.appendChild(swatch);
  }
  const more = createElement(doc, "span", {});
  more.textContent = getString("chat-stats-heatmap-more");
  legend.appendChild(more);
  wrap.addEventListener("mouseleave", () => {
    const panel = wrap.closest(`#${PANEL_ID}`) as HTMLElement | null;
    if (panel) {
      onCellLeave?.(panel);
    }
  });
  wrap.appendChild(legend);
  return wrap;
}

function renderHeatmap(
  doc: Document,
  theme: ThemeColors,
  snapshot: ReadingStatsSnapshot,
): HTMLElement {
  const cells: ContributionCell[] = snapshot.cells.map((cell) => ({
    dayKey: cell.dayKey,
    date: cell.date,
    value: cell.seconds,
    level: cell.level,
  }));
  return renderContributionHeatmap(
    doc,
    theme,
    cells,
    snapshot.weekCount,
    (cell) =>
      cell.value > 0
        ? getString("chat-stats-heatmap-day-tooltip", {
            args: {
              date: formatTooltipDate(cell.date),
              duration: formatReadingDuration(cell.value),
            },
          })
        : `${formatTooltipDate(cell.date)} · ${getString("chat-stats-heatmap-empty-day")}`,
    (panel, cellEl, cell) => {
      const source = snapshot.cells.find((entry) => entry.dayKey === cell.dayKey);
      if (!source) {
        return;
      }
      hideTokenBarHoverTooltip(panel);
      openHeatmapDayPopover(
        panel,
        cellEl,
        theme,
        source,
        snapshot.dayReadings[cell.dayKey] || [],
      );
    },
    undefined,
    (panel, cellEl, cell) => {
      showReadingDayHoverTooltip(
        panel,
        cellEl,
        theme,
        cell.date,
        cell.value,
      );
    },
    (panel) => {
      hideTokenBarHoverTooltip(panel);
    },
  );
}

export function getReadingStatsPanel(
  container: HTMLElement,
): HTMLElement | null {
  return container.querySelector(`#${PANEL_ID}`) as HTMLElement | null;
}

export function isReadingStatsPanelVisible(container: HTMLElement): boolean {
  const panel = getReadingStatsPanel(container);
  return panel?.style.display === "flex";
}

export function setReadingStatsPanelVisible(
  container: HTMLElement,
  visible: boolean,
): void {
  const panel = getReadingStatsPanel(container);
  if (!panel) {
    return;
  }
  panel.style.display = visible ? "flex" : "none";
  const inputArea = container.querySelector(
    "#chat-input-area",
  ) as HTMLElement | null;
  if (!inputArea) {
    return;
  }
  if (visible) {
    inputArea.style.display = "none";
    return;
  }
  if (!isBookmarkManagerVisible(container)) {
    inputArea.style.display = "flex";
  }
}

type StatsView = "reading" | "tokens";

function readStatsView(panel: HTMLElement): StatsView {
  return panel.dataset.statsView === "tokens" ? "tokens" : "reading";
}

function syncStatsViewSwitcher(
  panel: HTMLElement,
  theme: ThemeColors,
  current: StatsView,
): void {
  const bar = panel.querySelector(".paperchat-stats-view-switcher");
  if (!bar) {
    return;
  }
  bar.querySelectorAll("button[data-stats-view-id]").forEach((node) => {
    const button = node as HTMLButtonElement;
    const id = button.dataset.statsViewId as StatsView;
    const selected = id === current;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.style.background = selected ? theme.inputBg : "transparent";
    button.style.color = selected ? theme.textPrimary : theme.textMuted;
  });
}

function createViewSwitcher(
  doc: Document,
  theme: ThemeColors,
  panel: HTMLElement,
  current: StatsView,
): HTMLElement {
  const bar = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "2px",
    padding: "2px",
    marginBottom: "14px",
    borderRadius: "10px",
    border: `1px solid ${theme.borderColor}`,
    background: isDarkMode()
      ? "rgba(255, 255, 255, 0.04)"
      : "rgba(15, 23, 42, 0.04)",
  });
  bar.className = "paperchat-stats-view-switcher";
  bar.setAttribute("role", "tablist");
  const views: Array<[StatsView, string]> = [
    ["reading", getString("chat-stats-view-reading")],
    ["tokens", getString("chat-stats-view-tokens")],
  ];
  for (const [id, label] of views) {
    const selected = current === id;
    const button = createElement(
      doc,
      "button",
      {
        border: "none",
        borderRadius: "8px",
        padding: "6px 8px",
        fontSize: "12px",
        fontWeight: "650",
        cursor: "pointer",
        background: selected ? theme.inputBg : "transparent",
        color: selected ? theme.textPrimary : theme.textMuted,
        boxShadow: selected ? "0 1px 2px rgba(15, 23, 42, 0.06)" : "none",
      },
      {
        type: "button",
        role: "tab",
        "data-stats-view-id": id,
      },
    ) as HTMLButtonElement;
    button.textContent = label;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.addEventListener("click", () => {
      if (readStatsView(panel) === id) {
        return;
      }
      panel.dataset.statsView = id;
      syncStatsViewSwitcher(panel, theme, id);
      void refreshReadingStatsPanel(panel, theme);
    });
    bar.appendChild(button);
  }
  return bar;
}

type TokenDayDetail = TokenStatsSnapshot["cells"][number] | TokenStatsSnapshot["recentDays"][number];

function appendTokenIoLegendItem(
  doc: Document,
  theme: ThemeColors,
  color: string,
  label: string,
  detail: string,
): HTMLElement {
  const item = createElement(doc, "div", {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "10px",
    color: theme.textMuted,
    lineHeight: "1.3",
  });
  const swatch = createElement(doc, "span", {
    width: "8px",
    height: "8px",
    borderRadius: "2px",
    background: color,
    flexShrink: "0",
  });
  const name = createElement(doc, "span", { fontWeight: "550" });
  name.textContent = label;
  const value = createElement(doc, "span", {
    fontVariantNumeric: "tabular-nums",
  });
  value.textContent = detail;
  item.appendChild(swatch);
  item.appendChild(name);
  item.appendChild(value);
  return item;
}

function appendTokenIoRatioBar(
  doc: Document,
  theme: ThemeColors,
  parent: HTMLElement,
  inputTokens: number,
  outputTokens: number,
): void {
  const total = inputTokens + outputTokens;
  if (total <= 0) {
    return;
  }
  const inputColor = isDarkMode() ? "#c4b5fd" : "#ddd6fe";
  const outputColor = isDarkMode() ? "#8b5cf6" : "#7c3aed";
  const inputPct = Math.round((inputTokens / total) * 100);
  const outputPct = Math.round((outputTokens / total) * 100);

  const block = createElement(doc, "div", {
    marginTop: "10px",
    paddingTop: "8px",
    borderTop: `1px solid ${theme.borderColor}`,
  });
  block.className = "paperchat-stats-token-io-ratio";

  const heading = createElement(doc, "div", {
    fontSize: "11px",
    fontWeight: "600",
    color: theme.textSecondary,
    marginBottom: "6px",
  });
  heading.textContent = getString("chat-stats-token-io-ratio-title");
  block.appendChild(heading);

  const track = createElement(doc, "div", {
    display: "flex",
    height: "8px",
    borderRadius: "999px",
    overflow: "hidden",
    background: isDarkMode()
      ? "rgba(255, 255, 255, 0.06)"
      : "rgba(15, 23, 42, 0.06)",
  });
  track.setAttribute("role", "img");
  track.setAttribute(
    "aria-label",
    getString("chat-stats-token-io-ratio-aria", {
      args: {
        input: String(inputPct),
        output: String(outputPct),
      },
    }),
  );
  if (inputTokens > 0) {
    track.appendChild(
      createElement(doc, "div", {
        flex: String(inputTokens),
        background: inputColor,
        minWidth: "2px",
      }),
    );
  }
  if (outputTokens > 0) {
    track.appendChild(
      createElement(doc, "div", {
        flex: String(outputTokens),
        background: outputColor,
        minWidth: "2px",
      }),
    );
  }
  block.appendChild(track);

  const legend = createElement(doc, "div", {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "6px",
  });
  legend.appendChild(
    appendTokenIoLegendItem(
      doc,
      theme,
      inputColor,
      getString("chat-stats-token-input"),
      getString("chat-stats-token-io-legend-value", {
        args: {
          count: formatCompactTokenCount(inputTokens),
          percent: String(inputPct),
        },
      }),
    ),
  );
  legend.appendChild(
    appendTokenIoLegendItem(
      doc,
      theme,
      outputColor,
      getString("chat-stats-token-output"),
      getString("chat-stats-token-io-legend-value", {
        args: {
          count: formatCompactTokenCount(outputTokens),
          percent: String(outputPct),
        },
      }),
    ),
  );
  block.appendChild(legend);
  parent.appendChild(block);
}

function appendTokenDayModelList(
  doc: Document,
  theme: ThemeColors,
  parent: HTMLElement,
  models: TokenModelRecord[],
): void {
  const list = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    marginTop: "8px",
    maxHeight: "180px",
    overflowY: "auto",
  });
  const title = createElement(doc, "div", {
    fontSize: "11px",
    fontWeight: "600",
    color: theme.textSecondary,
    marginBottom: "4px",
  });
  title.textContent = getString("chat-stats-token-day-models-title");
  list.appendChild(title);

  if (!models.length) {
    const empty = createElement(doc, "div", {
      fontSize: "11px",
      color: theme.textMuted,
      lineHeight: "1.4",
    });
    empty.textContent = getString("chat-stats-token-day-no-models");
    list.appendChild(empty);
    parent.appendChild(list);
    return;
  }

  for (const model of models) {
    const row = createElement(doc, "div", {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: "8px",
      padding: "6px 0",
      borderTop: `1px solid ${theme.borderColor}`,
      alignItems: "baseline",
    });
    const name = createElement(doc, "span", {
      fontSize: "12px",
      color: theme.textPrimary,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    name.textContent = model.model;
    name.title = model.model;
    const value = createElement(doc, "span", {
      fontSize: "11px",
      color: theme.textMuted,
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    value.textContent = getString("chat-stats-token-day-split", {
      args: {
        input: formatCompactTokenCount(model.inputTokens),
        output: formatCompactTokenCount(model.outputTokens),
      },
    });
    value.title = getString("chat-stats-token-day-split", {
      args: {
        input: formatTokenCount(model.inputTokens),
        output: formatTokenCount(model.outputTokens),
      },
    });
    row.appendChild(name);
    row.appendChild(value);
    list.appendChild(row);
  }
  parent.appendChild(list);
}

function openTokenDayPopover(
  panel: HTMLElement,
  cellEl: HTMLElement,
  theme: ThemeColors,
  cell: TokenDayDetail,
  modelsForDay: TokenModelRecord[],
): void {
  closeHeatmapDayPopover(panel);
  cellEl.classList.add("paperchat-stats-token-bar-column--selected");
  if (cellEl.classList.contains("paperchat-reading-heatmap-cell")) {
    cellEl.classList.add("paperchat-reading-heatmap-cell--selected");
  }
  const doc = panel.ownerDocument;
  const popover = createElement(doc, "div", {
    position: "absolute",
    zIndex: "5",
    width: "240px",
    maxWidth: "calc(100% - 16px)",
    padding: "10px 10px 8px",
    borderRadius: "10px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
  });
  popover.id = DAY_POPOVER_ID;
  popover.className = "paperchat-stats-day-popover";
  popover.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }
    event.preventDefault();
    closeHeatmapDayPopover(panel);
  });

  const dateEl = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "650",
    color: theme.textPrimary,
    lineHeight: "1.35",
  });
  dateEl.textContent = formatTooltipDate(cell.date);
  popover.appendChild(dateEl);

  const summary = createElement(doc, "div", {
    marginTop: "4px",
    fontSize: "12px",
    color: theme.textSecondary,
    fontVariantNumeric: "tabular-nums",
  });
  summary.textContent =
    cell.totalTokens > 0
      ? getString("chat-stats-token-day-total", {
          args: { total: formatTokenCount(cell.totalTokens) },
        })
      : getString("chat-stats-heatmap-day-none");
  popover.appendChild(summary);

  if (cell.totalTokens > 0) {
    const split = createElement(doc, "div", {
      marginTop: "6px",
      fontSize: "11px",
      color: theme.textMuted,
      lineHeight: "1.4",
    });
    split.textContent = getString("chat-stats-token-day-split", {
      args: {
        input: formatTokenCount(cell.inputTokens),
        output: formatTokenCount(cell.outputTokens),
      },
    });
    popover.appendChild(split);
    if (cell.reasoningTokens > 0) {
      const reasoning = createElement(doc, "div", {
        marginTop: "4px",
        fontSize: "11px",
        color: theme.textMuted,
        lineHeight: "1.4",
      });
      reasoning.textContent = getString("chat-stats-token-reasoning", {
        args: { count: formatTokenCount(cell.reasoningTokens) },
      });
      popover.appendChild(reasoning);
    }
    appendTokenIoRatioBar(
      doc,
      theme,
      popover,
      cell.inputTokens,
      cell.outputTokens,
    );
    appendTokenDayModelList(doc, theme, popover, modelsForDay);
  }

  panel.appendChild(popover);
  positionDayPopover(panel, cellEl, popover);
}

function renderTokenHeatmap(
  doc: Document,
  theme: ThemeColors,
  snapshot: TokenStatsSnapshot,
): HTMLElement {
  const tokenColors = isDarkMode()
    ? TOKEN_HEATMAP_LEVEL_COLORS_DARK
    : TOKEN_HEATMAP_LEVEL_COLORS_LIGHT;
  const cells: ContributionCell[] = snapshot.cells.map((cell) => ({
    dayKey: cell.dayKey,
    date: cell.date,
    value: cell.totalTokens,
    level: cell.level,
  }));
  return renderContributionHeatmap(
    doc,
    theme,
    cells,
    snapshot.weekCount,
    (cell) =>
      cell.value > 0
        ? getString("chat-stats-token-day-tooltip", {
            args: {
              date: formatTooltipDate(cell.date),
              total: formatCompactTokenCount(cell.value),
            },
          })
        : `${formatTooltipDate(cell.date)} · ${getString("chat-stats-heatmap-day-none")}`,
    (panel, cellEl, cell) => {
      const source = snapshot.cells.find((entry) => entry.dayKey === cell.dayKey);
      if (!source) {
        return;
      }
      hideTokenBarHoverTooltip(panel);
      openTokenDayPopover(
        panel,
        cellEl,
        theme,
        source,
        snapshot.modelsByDay[cell.dayKey] || [],
      );
    },
    tokenColors,
    (panel, cellEl, cell) => {
      const source = snapshot.cells.find((entry) => entry.dayKey === cell.dayKey);
      if (!source || source.totalTokens <= 0) {
        return;
      }
      showTokenBarHoverTooltip(panel, cellEl, theme, source);
    },
    (panel) => {
      hideTokenBarHoverTooltip(panel);
    },
  );
}

function renderTokenDailyChart(
  doc: Document,
  theme: ThemeColors,
  panel: HTMLElement,
  days: TokenStatsSnapshot["recentDays"],
  modelsByDay: TokenStatsSnapshot["modelsByDay"],
): HTMLElement {
  const wrap = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  });
  if (!days.length) {
    return wrap;
  }
  const max = Math.max(...days.map((day) => day.totalTokens), 1);
  const chartRow = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "6px",
    alignItems: "stretch",
  });
  const scale = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: "104px",
    paddingBottom: "14px",
    fontSize: "9px",
    lineHeight: "1",
    color: theme.textMuted,
    fontVariantNumeric: "tabular-nums",
    minWidth: "28px",
  });
  const scaleMax = createElement(doc, "span", { whiteSpace: "nowrap" });
  scaleMax.textContent = formatCompactTokenCount(max);
  scale.appendChild(scaleMax);
  const scaleMin = createElement(doc, "span", {});
  scaleMin.textContent = "0";
  scale.appendChild(scaleMin);
  const chart = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
    gap: "4px",
    alignItems: "end",
    height: "104px",
  });
  const inputColor = isDarkMode() ? "#c4b5fd" : "#ddd6fe";
  const outputColor = isDarkMode() ? "#8b5cf6" : "#7c3aed";
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    const column = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      alignItems: "stretch",
      height: "100%",
      minWidth: "0",
      cursor: day.totalTokens > 0 ? "pointer" : "default",
    });
    column.className = "paperchat-stats-token-bar-column";
    if (day.totalTokens > 0) {
      column.setAttribute("role", "button");
    }
    const track = createElement(doc, "div", {
      flex: "1",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      minHeight: "0",
    });
    const totalHeight = Math.round((day.totalTokens / max) * 100);
    const stack = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column-reverse",
      height: day.totalTokens > 0 ? `${Math.max(totalHeight, 8)}%` : "0%",
      borderRadius: "3px 3px 1px 1px",
      overflow: "hidden",
    });
    stack.className = "paperchat-stats-token-bar";
    if (day.outputTokens > 0) {
      stack.appendChild(
        createElement(doc, "div", {
          flex: String(day.outputTokens),
          background: outputColor,
          minHeight: "2px",
        }),
      );
    }
    if (day.inputTokens > 0) {
      stack.appendChild(
        createElement(doc, "div", {
          flex: String(day.inputTokens),
          background: inputColor,
          minHeight: "2px",
        }),
      );
    }
    track.appendChild(stack);
    const label = createElement(doc, "div", {
      marginTop: "4px",
      fontSize: "9px",
      lineHeight: "1",
      textAlign: "center",
      color: theme.textMuted,
      fontVariantNumeric: "tabular-nums",
    });
    const showMonth = shouldShowMonthOnBarAxis(
      day.date,
      dayIndex > 0 ? days[dayIndex - 1].date : null,
    );
    label.textContent = formatBarAxisDayLabel(day.date, showMonth);
    column.addEventListener("mouseenter", () => {
      showTokenBarHoverTooltip(panel, stack, theme, day);
    });
    column.addEventListener("mouseleave", () => {
      hideTokenBarHoverTooltip(panel);
    });
    column.addEventListener("click", (event) => {
      event.stopPropagation();
      if (day.totalTokens <= 0) {
        return;
      }
      hideTokenBarHoverTooltip(panel);
      if (
        column.classList.contains("paperchat-stats-token-bar-column--selected")
      ) {
        closeHeatmapDayPopover(panel);
        return;
      }
      openTokenDayPopover(
        panel,
        column,
        theme,
        day,
        modelsByDay[day.dayKey] || [],
      );
    });
    column.appendChild(track);
    column.appendChild(label);
    chart.appendChild(column);
  }
  chartRow.appendChild(scale);
  chartRow.appendChild(chart);
  wrap.appendChild(chartRow);
  wrap.addEventListener("mouseleave", () => {
    hideTokenBarHoverTooltip(panel);
  });

  const legend = createElement(doc, "div", {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    fontSize: "10px",
    color: theme.textMuted,
  });
  for (const [color, text] of [
    [inputColor, getString("chat-stats-token-input")],
    [outputColor, getString("chat-stats-token-output")],
  ] as const) {
    const item = createElement(doc, "div", {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
    });
    const swatch = createElement(doc, "span", {
      width: "8px",
      height: "8px",
      borderRadius: "2px",
      background: color,
    });
    const name = createElement(doc, "span", {});
    name.textContent = text;
    item.appendChild(swatch);
    item.appendChild(name);
    legend.appendChild(item);
  }
  wrap.appendChild(legend);
  return wrap;
}

function renderTokenModelList(
  doc: Document,
  theme: ThemeColors,
  snapshot: TokenStatsSnapshot,
): HTMLElement {
  const list = createElement(doc, "div", {
    maxHeight: "280px",
    overflowY: "auto",
  });
  list.className = "paperchat-stats-bar-list";
  const max = Math.max(
    ...snapshot.models.map((model) => model.inputTokens + model.outputTokens),
    1,
  );
  snapshot.models.forEach((model) => {
    const total = model.inputTokens + model.outputTokens;
    const row = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      padding: "10px 0 8px",
    });
    row.className = "paperchat-stats-bar-row";
    const head = createElement(doc, "div", {
      display: "flex",
      justifyContent: "space-between",
      gap: "8px",
      alignItems: "baseline",
    });
    const name = createElement(doc, "div", {
      fontSize: "13px",
      fontWeight: "550",
      color: theme.textPrimary,
      lineHeight: "1.35",
      overflow: "hidden",
      display: "-webkit-box",
      webkitLineClamp: "2",
      webkitBoxOrient: "vertical",
    });
    name.textContent = model.model;
    name.title = model.model;
    const value = createElement(doc, "div", {
      fontSize: "12px",
      fontWeight: "650",
      color: isDarkMode() ? "#a5b4fc" : "#4f46e5",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    value.textContent = formatCompactTokenCount(total);
    value.title = getString("chat-stats-token-day-split", {
      args: {
        input: formatTokenCount(model.inputTokens),
        output: formatTokenCount(model.outputTokens),
      },
    });
    head.appendChild(name);
    head.appendChild(value);
    const split = createElement(doc, "div", {
      fontSize: "10px",
      color: theme.textMuted,
      lineHeight: "1.35",
    });
    split.textContent = getString("chat-stats-token-day-split", {
      args: {
        input: formatCompactTokenCount(model.inputTokens),
        output: formatCompactTokenCount(model.outputTokens),
      },
    });
    const track = createElement(doc, "div", {
      height: "6px",
      borderRadius: "999px",
      background: isDarkMode()
        ? "rgba(255, 255, 255, 0.06)"
        : "rgba(15, 23, 42, 0.06)",
      overflow: "hidden",
    });
    const fill = createElement(doc, "div", {
      height: "100%",
      width: "0%",
      borderRadius: "999px",
      background: isDarkMode() ? "#818cf8" : "#4f46e5",
    });
    fill.className = "paperchat-stats-read-bar-fill";
    track.appendChild(fill);
    revealBar(fill, (total / max) * 100);
    row.appendChild(head);
    row.appendChild(split);
    row.appendChild(track);
    list.appendChild(row);
  });
  return list;
}

async function renderTokenStats(
  doc: Document,
  theme: ThemeColors,
  host: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  host.textContent = "";
  const snapshot = await getTokenStatsSnapshot();
  if (snapshot.totalTokens <= 0) {
    host.appendChild(
      createEmptyHint(doc, theme, getString("chat-stats-token-empty")),
    );
    return;
  }
  const cards = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  });
  cards.className = "paperchat-stats-metric-grid";
  const tokenTotal = snapshot.totalTokens;
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-token-total"),
      formatCompactTokenCount(snapshot.totalTokens),
      {
        ...buildTokenWeekCardHint(snapshot),
        valueTone: "default",
      },
    ),
  );
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-token-input"),
      formatCompactTokenCount(snapshot.inputTokens),
      {
        valueTone: "time",
        hint:
          tokenTotal > 0
            ? getString("chat-stats-token-share", {
                args: {
                  percent: String(
                    Math.round((snapshot.inputTokens / tokenTotal) * 100),
                  ),
                },
              })
            : undefined,
      },
    ),
  );
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-token-output"),
      formatCompactTokenCount(snapshot.outputTokens),
      {
        valueTone: "progress",
        hint:
          tokenTotal > 0
            ? getString("chat-stats-token-share", {
                args: {
                  percent: String(
                    Math.round((snapshot.outputTokens / tokenTotal) * 100),
                  ),
                },
              })
            : undefined,
      },
    ),
  );
  host.appendChild(cards);
  if (!prefersReducedMotion(doc)) {
    const values = cards.querySelectorAll(".paperchat-stats-metric-value");
    const targets = [
      snapshot.totalTokens,
      snapshot.inputTokens,
      snapshot.outputTokens,
    ];
    values.forEach((node, index) => {
      const element = node as HTMLElement;
      element.textContent = formatCompactTokenCount(0);
      runCountUp(
        element,
        480,
        (progress) => {
          element.textContent = formatCompactTokenCount(
            Math.round(targets[index] * progress),
          );
        },
        () => pulseStatValue(element),
      );
    });
  }

  host.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-token-daily-title"), {
      first: true,
    }),
  );
  host.appendChild(renderTokenHeatmap(doc, theme, snapshot));

  host.appendChild(
    createCollapsibleSection(
      doc,
      theme,
      getString("chat-stats-token-bars-title"),
      renderTokenDailyChart(
        doc,
        theme,
        panel,
        snapshot.recentDays,
        snapshot.modelsByDay,
      ),
      { storageKey: "tokenBarsCollapsedV2", defaultCollapsed: false },
    ),
  );
  bindHeatmapDayPopoverDismiss(panel);

  if (snapshot.models.length) {
    host.appendChild(
      createSectionTitle(doc, theme, getString("chat-stats-token-models-title")),
    );
    host.appendChild(renderTokenModelList(doc, theme, snapshot));
  }
  const footnote = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    marginTop: "12px",
    lineHeight: "1.45",
  });
  footnote.className = "paperchat-stats-footnote";
  footnote.textContent = getString("chat-stats-token-footnote");
  host.appendChild(footnote);
}

async function renderReadingStatsContent(
  doc: Document,
  theme: ThemeColors,
  host: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  host.textContent = "";
  const snapshot = await getReadingStatsSnapshot();
  host.appendChild(
    createReadingTrackerStatus(
      doc,
      theme,
      isReadingTimeAccumulatingNow(),
    ),
  );
  const cards = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  });
  cards.className = "paperchat-stats-metric-grid";
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-literature-total"),
      String(snapshot.literature.total),
      { valueTone: "default" },
    ),
  );
  cards.appendChild(createReadingProgressStatCard(doc, theme, snapshot));
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-reading-this-week"),
      formatReadingDurationCompact(snapshot.totalSecondsThisWeek),
      {
        ...buildReadingWeekCardHint(snapshot),
        valueTone: "time",
      },
    ),
  );

  host.appendChild(cards);
  animateMetricCards(
    doc,
    Array.from(cards.children) as HTMLElement[],
    {
      total: snapshot.literature.total,
      withReadingTime: snapshot.literature.withReadingTime,
      literatureTotal: snapshot.literature.total,
      weekSeconds: snapshot.totalSecondsThisWeek,
      progressPercent:
        snapshot.literature.total > 0
          ? (snapshot.literature.withReadingTime /
              snapshot.literature.total) *
            100
          : 0,
    },
  );
  host.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-daily-reading-title"), {
      first: true,
    }),
  );
  host.appendChild(renderHeatmap(doc, theme, snapshot));
  closeHeatmapDayPopover(panel);
  bindHeatmapDayPopoverDismiss(panel);
  host.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-top-reading-title")),
  );
  host.appendChild(renderTopReadingList(doc, theme, snapshot.topReadItems));
  host.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-recent-added-title")),
  );
  host.appendChild(renderRecentlyAddedList(doc, theme, snapshot.recentlyAdded));

  const chatActivity = await getChatActivitySnapshot();
  host.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-chat-activity-title")),
  );
  host.appendChild(renderChatActivitySection(doc, theme, chatActivity));
  closeHeatmapDayPopover(panel);
  bindHeatmapDayPopoverDismiss(panel);

  const footnote = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    marginTop: "12px",
    lineHeight: "1.45",
  });
  footnote.className = "paperchat-stats-footnote";
  footnote.textContent = getString("chat-stats-reading-footnote", {
    args: {
      total: formatReadingDuration(snapshot.totalSecondsLastYear),
    },
  });
  host.appendChild(footnote);
}

export async function refreshReadingStatsPanel(
  panel: HTMLElement,
  theme: ThemeColors,
  options: { force?: boolean } = {},
): Promise<void> {
  const body = panel.querySelector(
    "#chat-reading-stats-panel-body",
  ) as HTMLElement | null;
  if (!body) {
    return;
  }
  const doc = body.ownerDocument!;
  const view = readStatsView(panel);
  const force = options.force === true;
  if (force) {
    invalidateStatsViewCache(panel);
  }

  let switcher = body.querySelector(
    ".paperchat-stats-view-switcher",
  ) as HTMLElement | null;
  if (!switcher) {
    body.textContent = "";
    switcher = createViewSwitcher(doc, theme, panel, view);
    body.appendChild(switcher);
  }

  let readingHost = body.querySelector(
    `#${VIEW_HOST_READING}`,
  ) as HTMLElement | null;
  let tokenHost = body.querySelector(`#${VIEW_HOST_TOKEN}`) as HTMLElement | null;
  if (!readingHost) {
    readingHost = createElement(doc, "div", {}, { id: VIEW_HOST_READING });
    body.appendChild(readingHost);
  }
  if (!tokenHost) {
    tokenHost = createElement(doc, "div", {}, { id: VIEW_HOST_TOKEN });
    body.appendChild(tokenHost);
  }

  readingHost.style.display = view === "reading" ? "block" : "none";
  tokenHost.style.display = view === "tokens" ? "block" : "none";
  syncStatsViewSwitcher(panel, theme, view);

  if (view === "tokens") {
    closeHeatmapDayPopover(panel);
    if (force || tokenHost.dataset.built !== "1") {
      await renderTokenStats(doc, theme, tokenHost, panel);
      tokenHost.dataset.built = "1";
    }
  } else if (force || readingHost.dataset.built !== "1") {
    await renderReadingStatsContent(doc, theme, readingHost, panel);
    readingHost.dataset.built = "1";
  }

  bindStatsPanelResponsive(panel);
  applyStatsPanelLayout(panel);
}

export function createReadingStatsPanel(
  doc: Document,
  theme: ThemeColors,
  onClose: () => void,
): HTMLElement {
  const panel = createElement(
    doc,
    "div",
    {
      position: "absolute",
      inset: "0",
      display: "none",
      flexDirection: "column",
      background: theme.chatHistoryBg,
      zIndex: "10002",
    },
    { id: PANEL_ID },
  );
  panel.dataset.statsLayout = "wide";

  const header = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "12px 14px",
    borderBottom: `1px solid ${theme.borderColor}`,
    background: theme.toolbarBg,
    flexShrink: "0",
    minWidth: "0",
  });
  const title = createElement(doc, "div", {
    fontSize: "15px",
    fontWeight: "650",
    color: theme.textPrimary,
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  title.textContent = getString("chat-stats-title");

  const closeBtn = createElement(
    doc,
    "button",
    {
      width: "32px",
      height: "32px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      borderRadius: "8px",
      background: "transparent",
      cursor: "pointer",
      padding: "0",
      color: theme.textMuted,
    },
    {
      type: "button",
      title: getString("chat-bookmark-close"),
      "aria-label": getString("chat-bookmark-close"),
    },
  ) as HTMLButtonElement;
  const closeIcon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  closeIcon.src = `chrome://${config.addonRef}/content/icons/close.svg`;
  closeIcon.alt = "";
  Object.assign(closeIcon.style, { width: "14px", height: "14px" });
  closeBtn.appendChild(closeIcon);
  closeBtn.addEventListener("click", onClose);

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = createElement(
    doc,
    "div",
    {
      flex: "1",
      minHeight: "0",
      overflow: "auto",
      padding: "12px 12px 16px",
      position: "relative",
    },
    { id: "chat-reading-stats-panel-body" },
  );

  panel.appendChild(header);
  panel.appendChild(body);
  return panel;
}
