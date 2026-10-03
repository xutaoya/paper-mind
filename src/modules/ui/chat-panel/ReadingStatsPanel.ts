import { config } from "../../../../package.json";
import {
  formatReadingDate,
  formatReadingDuration,
  formatReadingDurationCompact,
  getReadingStatsSnapshot,
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
import { formatCompactTokenCount } from "../../../utils/tokens";
import {
  getTokenStatsSnapshot,
  type TokenStatsSnapshot,
} from "../../token-stats/TokenStatsStore";

const PANEL_ID = "chat-reading-stats-panel";

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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    label.textContent = formatHeatmapMonthLabel(cell.date);
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
    card.style.animationDelay = reduced ? "0ms" : `${index * 70}ms`;
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
    runCountUp(valueEls[2], 680, (p) => {
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

function createStatCard(
  doc: Document,
  theme: ThemeColors,
  label: string,
  value: string,
  options?: {
    progress?: number;
    valueMuted?: boolean;
    hint?: string;
    valueTone?: "default" | "progress" | "time";
  },
): HTMLElement {
  const card = createElement(doc, "div", {
    flex: "1",
    minWidth: "0",
    padding: "10px 10px 9px",
    borderRadius: "12px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.inputBg,
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
      fontSize: "9px",
      color: theme.textMuted,
      lineHeight: "1.3",
    });
    hintEl.textContent = options.hint;
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
): HTMLElement {
  const title = createElement(doc, "div", {
    fontSize: "12px",
    fontWeight: "600",
    color: theme.textSecondary,
    marginTop: "20px",
    marginBottom: "2px",
    paddingBottom: "6px",
    borderBottom: `1px solid ${theme.borderColor}`,
  });
  title.className = "paperchat-stats-section-title";
  title.textContent = text;
  return title;
}

function createEmptyHint(doc: Document, theme: ThemeColors, text: string): HTMLElement {
  const hint = createElement(doc, "div", {
    padding: "10px 0 4px",
    color: theme.textMuted,
    fontSize: "12px",
    lineHeight: "1.5",
  });
  hint.className = "paperchat-stats-empty-hint";
  hint.textContent = text;
  return hint;
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
  row.className = "paperchat-stats-bar-row";

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
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  row.className = "paperchat-stats-timeline-item";
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

const DAY_POPOVER_ID = "chat-reading-stats-day-popover";

function closeHeatmapDayPopover(panel: HTMLElement): void {
  panel.querySelector(`#${DAY_POPOVER_ID}`)?.remove();
  panel
    .querySelectorAll(".paperchat-reading-heatmap-cell--selected")
    .forEach((node) => {
      node.classList.remove("paperchat-reading-heatmap-cell--selected");
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

function renderContributionHeatmap(
  doc: Document,
  theme: ThemeColors,
  cells: ContributionCell[],
  weekCount: number,
  describe: (cell: ContributionCell) => string,
  onSelect: (
    panel: HTMLElement,
    cellEl: HTMLElement,
    cell: ContributionCell,
  ) => void,
  levelColors?: readonly string[],
): HTMLElement {
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
      row === 1 || row === 3 || row === 5 ? WEEKDAY_LABELS[row] : "";
    grid.appendChild(weekday);
    for (let week = 0; week < weekCount; week += 1) {
      const cellData = cells[week * 7 + row];
      const cell = createElement(doc, "div", {
        width: "100%",
        aspectRatio: "1",
        maxHeight: "9px",
        borderRadius: "2px",
        background: colors[cellData?.level ?? 0],
        cursor: "pointer",
        justifySelf: "stretch",
      });
      cell.className = "paperchat-reading-heatmap-cell";
      cell.dataset.level = String(cellData?.level ?? 0);
      if (cellData) {
        cell.title = describe(cellData);
        cell.setAttribute("role", "button");
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
      openHeatmapDayPopover(
        panel,
        cellEl,
        theme,
        source,
        snapshot.dayReadings[cell.dayKey] || [],
      );
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
      { type: "button", role: "tab" },
    ) as HTMLButtonElement;
    button.textContent = label;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.addEventListener("click", () => {
      if (readStatsView(panel) === id) {
        return;
      }
      panel.dataset.statsView = id;
      void refreshReadingStatsPanel(panel, theme);
    });
    bar.appendChild(button);
  }
  return bar;
}

function openTokenDayPopover(
  panel: HTMLElement,
  cellEl: HTMLElement,
  theme: ThemeColors,
  cell: TokenStatsSnapshot["cells"][number],
): void {
  closeHeatmapDayPopover(panel);
  cellEl.classList.add("paperchat-reading-heatmap-cell--selected");
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
  });
  summary.textContent =
    cell.totalTokens > 0
      ? formatCompactTokenCount(cell.totalTokens)
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
        input: formatCompactTokenCount(cell.inputTokens),
        output: formatCompactTokenCount(cell.outputTokens),
      },
    });
    popover.appendChild(split);
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
      openTokenDayPopover(panel, cellEl, theme, source);
    },
    tokenColors,
  );
}

function renderTokenDailyChart(
  doc: Document,
  theme: ThemeColors,
  days: TokenStatsSnapshot["recentDays"],
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
  const chart = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
    gap: "4px",
    alignItems: "end",
    height: "88px",
  });
  const inputColor = isDarkMode() ? "#c4b5fd" : "#ddd6fe";
  const outputColor = isDarkMode() ? "#8b5cf6" : "#7c3aed";
  for (const day of days) {
    const column = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      alignItems: "stretch",
      height: "100%",
      minWidth: "0",
    });
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
    label.textContent = String(day.date.getDate());
    column.title = `${formatTooltipDate(day.date)} · ${formatCompactTokenCount(day.totalTokens)}`;
    column.appendChild(track);
    column.appendChild(label);
    chart.appendChild(column);
  }
  wrap.appendChild(chart);

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
  const list = createElement(doc, "div", {});
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
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
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
    head.appendChild(name);
    head.appendChild(value);
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
    row.appendChild(track);
    list.appendChild(row);
  });
  return list;
}

async function renderTokenStats(
  doc: Document,
  theme: ThemeColors,
  body: HTMLElement,
): Promise<void> {
  const snapshot = await getTokenStatsSnapshot();
  const cards = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "14px",
  });
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-token-total"),
      formatCompactTokenCount(snapshot.totalTokens),
      {
        hint: getString("chat-stats-token-week", {
          args: { total: formatCompactTokenCount(snapshot.weekTokens) },
        }),
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
      { valueTone: "time" },
    ),
  );
  cards.appendChild(
    createStatCard(
      doc,
      theme,
      getString("chat-stats-token-output"),
      formatCompactTokenCount(snapshot.outputTokens),
      { valueTone: "progress" },
    ),
  );
  body.appendChild(cards);
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
        640,
        (progress) => {
          element.textContent = formatCompactTokenCount(
            Math.round(targets[index] * progress),
          );
        },
        () => pulseStatValue(element),
      );
    });
  }

  body.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-token-daily-title")),
  );
  body.appendChild(renderTokenHeatmap(doc, theme, snapshot));

  body.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-token-bars-title")),
  );
  body.appendChild(renderTokenDailyChart(doc, theme, snapshot.recentDays));

  if (snapshot.models.length) {
    body.appendChild(
      createSectionTitle(doc, theme, getString("chat-stats-token-models-title")),
    );
    body.appendChild(renderTokenModelList(doc, theme, snapshot));
  }

  const footnote = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    marginTop: "12px",
    lineHeight: "1.45",
  });
  footnote.textContent = getString("chat-stats-token-footnote");
  body.appendChild(footnote);
}

export async function refreshReadingStatsPanel(
  panel: HTMLElement,
  theme: ThemeColors,
): Promise<void> {
  const body = panel.querySelector(
    "#chat-reading-stats-panel-body",
  ) as HTMLElement | null;
  if (!body) {
    return;
  }
  body.textContent = "";
  const doc = body.ownerDocument!;
  const view = readStatsView(panel);
  body.appendChild(createViewSwitcher(doc, theme, panel, view));
  if (view === "tokens") {
    closeHeatmapDayPopover(panel);
    await renderTokenStats(doc, theme, body);
    return;
  }
  const snapshot = await getReadingStatsSnapshot();
  const cards = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "14px",
  });
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
        hint: getString("chat-stats-reading-active-days", {
          args: { count: String(snapshot.activeDaysLastYear) },
        }),
        valueTone: "time",
      },
    ),
  );

  const sectionTitle = createElement(doc, "div", {
    fontSize: "13px",
    fontWeight: "600",
    color: theme.textPrimary,
    marginBottom: "8px",
  });
  sectionTitle.textContent = getString("chat-stats-daily-reading-title");

  const footnote = createElement(doc, "div", {
    fontSize: "11px",
    color: theme.textMuted,
    marginTop: "10px",
    lineHeight: "1.45",
  });
  footnote.textContent = getString("chat-stats-reading-footnote", {
    args: {
      total: formatReadingDuration(snapshot.totalSecondsLastYear),
    },
  });

  body.appendChild(cards);
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
  body.appendChild(sectionTitle);
  body.appendChild(renderHeatmap(doc, theme, snapshot));
  closeHeatmapDayPopover(panel);
  bindHeatmapDayPopoverDismiss(panel);
  body.appendChild(footnote);
  body.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-top-reading-title")),
  );
  body.appendChild(renderTopReadingList(doc, theme, snapshot.topReadItems));
  body.appendChild(
    createSectionTitle(doc, theme, getString("chat-stats-recent-added-title")),
  );
  body.appendChild(renderRecentlyAddedList(doc, theme, snapshot.recentlyAdded));
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

  const header = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: `1px solid ${theme.borderColor}`,
    background: theme.toolbarBg,
    flexShrink: "0",
  });
  const title = createElement(doc, "div", {
    fontSize: "15px",
    fontWeight: "650",
    color: theme.textPrimary,
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

  const body = createElement(
    doc,
    "div",
    {
      flex: "1",
      minHeight: "0",
      overflow: "auto",
      padding: "14px",
    },
    { id: "chat-reading-stats-panel-body" },
  );

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);
  panel.appendChild(body);
  return panel;
}
