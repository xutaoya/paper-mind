import {
  formatReadingDate,
  formatReadingDuration,
  formatReadingDurationCompact,
  getReadingStatsSnapshot,
  getStartOfLocalWeek,
  isReadingTimeAccumulatingNow,
  type DayReadingItem,
  type ItemReadingEntry,
  type ReadingStatsSnapshot,
  type RecentlyAddedEntry,
} from "../../reading-stats";
import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import type { ThemeColors } from "./types";
import { isBookmarkManagerVisible } from "./BookmarkManagerPanel";
import { darkTheme, getCurrentTheme, isDarkMode } from "./ChatPanelTheme";
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
  createStatsToolbarIconButton,
  formatBarAxisDayLabel,
  formatWeekDeltaHint,
  shouldShowMonthOnBarAxis,
  bindStatsPanelResponsive,
  applyStatsPanelLayout,
  toggleStatsHelpPopover,
  updateStatsPanelSubtitle,
  type StatsPanelView,
} from "./stats/StatsPanelUi";
import {
  getChatActivitySnapshot,
  type ChatActivitySnapshot,
  type ChatDayCell,
} from "../../workflow-stats";
import { getBookmarkService } from "../../bookmarks";
const SVG_NS = "http://www.w3.org/2000/svg";

const PANEL_ID = "chat-reading-stats-panel";
const STATS_TOOLBAR_ID = "paperchat-stats-panel-toolbar";
const STATS_SUBTITLE_ID = "paperchat-stats-panel-subtitle";
const STATS_SWITCHER_HOST_ID = "paperchat-stats-view-switcher-host";
const STATS_CLOSE_BTN_ID = "chat-stats-close-btn";
const VIEW_HOST_READING = "stats-view-reading";
const VIEW_HOST_TOKEN = "stats-view-tokens";
const VIEW_HOST_CHAT = "stats-view-chat";
const readingStatusTimers = new WeakMap<HTMLElement, number>();

function stopReadingStatusUpdates(panel: HTMLElement): void {
  const timer = readingStatusTimers.get(panel);
  if (timer !== undefined)
    panel.ownerDocument.defaultView?.clearInterval(timer);
  readingStatusTimers.delete(panel);
}

function startReadingStatusUpdates(panel: HTMLElement): void {
  stopReadingStatusUpdates(panel);
  const win = panel.ownerDocument.defaultView;
  if (!win?.setInterval) return;
  let lastState = "";
  const update = (): void => {
    if (!panel.isConnected || panel.style.display !== "flex") {
      stopReadingStatusUpdates(panel);
      return;
    }
    const active = isReadingTimeAccumulatingNow();
    const view = readStatsView(panel);
    const state = `${view}:${active}`;
    if (state === lastState) return;
    lastState = state;
    const subtitle = panel.querySelector<HTMLElement>(`#${STATS_SUBTITLE_ID}`);
    if (subtitle)
      updateStatsPanelSubtitle(
        subtitle,
        panel.ownerDocument,
        getCurrentTheme(),
        view,
        active,
      );
  };
  update();
  readingStatusTimers.set(panel, win.setInterval(update, 1000));
}

/** Heatmap ramps live in CSS so light/dark themes stay in one palette. */
function heatLevels(prefix: string): readonly string[] {
  return [0, 1, 2, 3, 4].map((level) => `var(--stats-heat-${prefix}-${level})`);
}

const HEATMAP_LEVEL_COLORS = heatLevels("read");
const TOKEN_HEATMAP_LEVEL_COLORS = heatLevels("token");
const CHAT_HEATMAP_LEVEL_COLORS = heatLevels("chat");

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
  _theme: ThemeColors,
  cells: { date: Date }[],
  weekCount: number,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "flex",
    alignItems: "flex-start",
    gap: "3px",
    width: "100%",
    minHeight: "14px",
    marginBottom: "2px",
  });
  const corner = createElement(
    doc,
    "div",
    { width: "22px", flexShrink: "0" },
    { class: "paperchat-stats-calendar-corner", "aria-hidden": "true" },
  );
  row.appendChild(corner);

  const track = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
    columnGap: "3px",
    flex: "1",
    minWidth: "0",
    height: "14px",
  });

  const months: { week: number; date: Date }[] = [];
  for (let week = 0; week < weekCount; week += 1) {
    const cell = cells[week * 7];
    if (!cell) {
      continue;
    }
    const previous = months[months.length - 1]?.date;
    if (
      previous?.getMonth() === cell.date.getMonth() &&
      previous?.getFullYear() === cell.date.getFullYear()
    ) {
      continue;
    }
    months.push({ week, date: cell.date });
  }
  months.forEach(({ week, date }, index) => {
    const span = (months[index + 1]?.week ?? weekCount) - week;
    const label = createElement(doc, "div", {
      gridColumn: `${week + 1} / span ${span}`,
      minWidth: "0",
      overflow: "hidden",
      // Partial months at either edge may have only one or two columns.
      visibility: span < 3 ? "hidden" : "visible",
      fontSize: "10px",
      lineHeight: "14px",
      color: "var(--stats-muted)",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    const fullLabel = formatHeatmapMonthLabel(date);
    label.className = "paperchat-stats-month-label";
    label.dataset.fullLabel = fullLabel;
    label.dataset.compactLabel = String(date.getMonth() + 1);
    label.textContent = fullLabel;
    track.appendChild(label);
  });

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

function renderReadingTimeValue(element: HTMLElement, seconds: number): void {
  element.textContent = "";
  // Keep the existing localized duration, with quieter units than digits.
  for (const part of formatReadingDurationCompact(seconds)
    .split(/(\d+)/)
    .filter(Boolean)) {
    const span = createElement(element.ownerDocument, "span", {});
    span.className = /^\d+$/.test(part)
      ? "paperchat-stats-time-number"
      : "paperchat-stats-time-unit";
    span.textContent = part;
    element.appendChild(span);
  }
}

function createReadingWeekRhythm(
  doc: Document,
  snapshot: ReadingStatsSnapshot,
): HTMLElement {
  const rhythm = createElement(doc, "div", {});
  rhythm.className = "paperchat-stats-week-rhythm";
  const end = snapshot.rangeEnd;
  const start = getStartOfLocalWeek(end);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date, seconds: snapshot.dailySeconds[key] || 0 };
  });
  const maximum = Math.max(1, ...days.map((day) => day.seconds));
  for (const day of days) {
    const column = createElement(doc, "div", {});
    column.className = "paperchat-stats-week-day";
    const description = `${formatTooltipDate(day.date)}: ${formatReadingDuration(day.seconds)}`;
    column.title = description;
    column.setAttribute("aria-label", description);
    column.setAttribute("role", "img");
    if (day.date.toDateString() === end.toDateString())
      column.dataset.today = "true";
    if (day.date > end) column.dataset.future = "true";
    if (day.seconds <= 0) column.dataset.empty = "true";
    const track = createElement(doc, "div", {});
    track.className = "paperchat-stats-week-track";
    const bar = createElement(doc, "div", {});
    bar.className = "paperchat-stats-week-fill";
    bar.style.height = `${(day.seconds / maximum) * 100}%`;
    track.appendChild(bar);
    const label = createElement(doc, "span", {});
    label.textContent = day.date.toLocaleDateString(undefined, {
      weekday: "narrow",
    });
    column.appendChild(track);
    column.appendChild(label);
    rhythm.appendChild(column);
  }
  return rhythm;
}

function createStatsMetric(
  doc: Document,
  label: string,
  value: string,
  detail?: { hint?: string; hintTitle?: string },
): HTMLElement {
  const metric = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-stats-metric",
    },
  );
  const name = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-stats-metric-label",
    },
  );
  name.textContent = label;
  const amount = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-stats-metric-value",
    },
  );
  amount.textContent = value;
  metric.append(name, amount);
  if (detail?.hint) {
    const note = createElement(
      doc,
      "div",
      {},
      {
        class: "paperchat-stats-metric-hint",
      },
    );
    note.textContent = detail.hint;
    if (detail.hintTitle) note.title = detail.hintTitle;
    metric.appendChild(note);
  }
  return metric;
}

function appendStatsSection(
  host: HTMLElement,
  doc: Document,
  title: string,
  content: HTMLElement,
  options: { badge?: string } = {},
): HTMLElement {
  const section = createElement(
    doc,
    "section",
    {},
    { class: "paperchat-stats-card paperchat-stats-section" },
  );
  const head = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-card-head" },
  );
  const heading = createElement(
    doc,
    "h2",
    {},
    { class: "paperchat-stats-section-title" },
  );
  heading.textContent = title;
  head.appendChild(heading);
  if (options.badge) {
    const badge = createElement(
      doc,
      "span",
      {},
      { class: "paperchat-stats-card-badge" },
    );
    badge.textContent = options.badge;
    head.appendChild(badge);
  }
  section.append(head, content);
  host.appendChild(section);
  return section;
}

function createSplitBar(
  doc: Document,
  parts: Array<[number, string]>,
): HTMLElement {
  const bar = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-split", "aria-hidden": "true" },
  );
  for (const [value, color] of parts) {
    if (value <= 0) {
      continue;
    }
    bar.appendChild(
      createElement(doc, "span", { flex: String(value), background: color }),
    );
  }
  return bar;
}

function createLegendDot(
  doc: Document,
  color: string,
  label: string,
  value?: string,
): HTMLElement {
  const item = createElement(
    doc,
    "span",
    {},
    { class: "paperchat-stats-legend-item" },
  );
  const dot = createElement(
    doc,
    "span",
    { background: color },
    { class: "paperchat-stats-legend-dot" },
  );
  const name = createElement(doc, "span", {});
  name.textContent = label;
  item.append(dot, name);
  if (value) {
    const amount = createElement(
      doc,
      "span",
      {},
      { class: "paperchat-stats-legend-value" },
    );
    amount.textContent = value;
    item.appendChild(amount);
  }
  return item;
}

function createDayPopoverHeader(
  doc: Document,
  panel: HTMLElement,
  anchor: HTMLElement,
  theme: ThemeColors,
  date: Date,
): HTMLElement {
  const header = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-header" },
  );
  const dateEl = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-date" },
  );
  dateEl.textContent = formatTooltipDate(date);
  const close = createStatsToolbarIconButton(
    doc,
    theme,
    "close.svg",
    getString("chat-bookmark-close"),
    () => {
      closeHeatmapDayPopover(panel);
      anchor.focus({ preventScroll: true });
    },
  );
  close.classList.add("paperchat-stats-day-close");
  header.append(dateEl, close);
  return header;
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

function createStatsEmptyIcon(doc: Document): HTMLElement {
  const wrap = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-empty-icon", "aria-hidden": "true" },
  );

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const bars: Array<[string, string, string, string]> = [
    ["1.5", "8.5", "3", "5.5"],
    ["6.5", "5", "3", "9"],
    ["11.5", "2", "3", "12"],
  ];
  for (const [x, y, width, height] of bars) {
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    rect.setAttribute("rx", "1");
    rect.setAttribute("fill", "currentColor");
    svg.appendChild(rect);
  }
  wrap.appendChild(svg);
  return wrap;
}

function createEmptyHint(
  doc: Document,
  _theme: ThemeColors,
  text: string,
): HTMLElement {
  const wrap = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-empty" },
  );
  wrap.appendChild(createStatsEmptyIcon(doc));
  const hint = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-empty-hint" },
  );
  hint.textContent = text;
  wrap.appendChild(hint);
  return wrap;
}

function readingBarColor(rank: number): string {
  return rank === 1 ? "var(--stats-accent)" : "var(--stats-plot)";
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
  _theme: ThemeColors,
  rank: number,
  item: ItemReadingEntry,
  maxSeconds: number,
): HTMLElement {
  const row = createElement(
    doc,
    "div",
    {},
    {
      class:
        "paperchat-stats-bar-row paperchat-stats-list-row paperchat-stats-rank-row",
    },
  );
  row.dataset.rank = String(rank);

  const head = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-rank-heading" },
  );
  const indexEl = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-rank-index" },
  );
  indexEl.textContent = String(rank).padStart(2, "0");
  const titleEl = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-rank-title" },
  );
  titleEl.textContent = item.title;
  titleEl.title = item.title;
  const durationEl = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-rank-value" },
  );
  durationEl.textContent = formatReadingDurationCompact(item.totalSeconds);
  durationEl.title = formatReadingDuration(item.totalSeconds);
  head.append(indexEl, titleEl, durationEl);

  const track = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-rank-track" },
  );
  const ratio = item.totalSeconds / Math.max(maxSeconds, 1);
  const fill = createElement(
    doc,
    "div",
    { background: readingBarColor(rank) },
    { class: "paperchat-stats-read-bar-fill" },
  );
  track.appendChild(fill);
  revealBar(fill, ratio * 100);

  const metaEl = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-rank-meta" },
  );
  metaEl.textContent = getString("chat-stats-item-last-read", {
    args: { date: formatReadingDate(item.lastReadAt) },
  });

  row.append(head, track, metaEl);
  attachLiteratureRowAction(row, item.libraryID, item.itemKey);
  return row;
}

function formatItemTypeLabel(typeName: string): string {
  try {
    return Zotero.ItemTypes.getLocalizedString(typeName) || typeName;
  } catch {
    return typeName;
  }
}

function createRecentItemRow(
  doc: Document,
  _theme: ThemeColors,
  item: RecentlyAddedEntry,
): HTMLElement {
  const row = createElement(doc, "div", {
    padding: "8px 0",
  });
  row.className = "paperchat-stats-recent-row paperchat-stats-list-row";

  const main = createElement(doc, "div", {
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  const titleEl = createElement(doc, "div", {
    fontSize: "13px",
    fontWeight: "500",
    color: "var(--stats-text)",
    lineHeight: "1.4",
    overflow: "hidden",
    display: "-webkit-box",
    webkitLineClamp: "2",
    webkitBoxOrient: "vertical",
  });
  titleEl.textContent = item.title;
  titleEl.title = item.title;
  titleEl.className = "paperchat-stats-recent-title";
  const metaEl = createElement(doc, "div", {
    fontSize: "11px",
    color: "var(--stats-muted)",
    lineHeight: "1.3",
  });
  metaEl.textContent = formatItemTypeLabel(item.itemType);
  metaEl.className = "paperchat-stats-item-type";
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
  const list = createElement(doc, "div", {});
  list.className = "paperchat-stats-recent-list";
  const groups = new Map<string, HTMLElement>();
  for (const item of items) {
    const dateLabel = formatReadingDate(item.dateAdded);
    let group = groups.get(dateLabel);
    if (!group) {
      group = createElement(doc, "section", {}, { "aria-label": dateLabel });
      group.className = "paperchat-stats-date-group";
      const heading = createElement(
        doc,
        "div",
        {},
        { role: "heading", "aria-level": "3" },
      );
      heading.className = "paperchat-stats-date-heading";
      heading.textContent = dateLabel;
      group.appendChild(heading);
      groups.set(dateLabel, group);
      list.appendChild(group);
    }
    group.appendChild(createRecentItemRow(doc, theme, item));
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
  cell: ChatDayCell,
): void {
  if (cell.totalMessages <= 0) {
    return;
  }
  hideTokenBarHoverTooltip(panel);
  const doc = panel.ownerDocument;
  const tooltip = createElement(
    doc,
    "div",
    {},
    {
      id: TOKEN_BAR_HOVER_TOOLTIP_ID,
      class: "paperchat-stats-token-bar-tooltip",
    },
  );
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
  const popover = createElement(
    doc,
    "div",
    { position: "absolute", zIndex: "5" },
    {
      id: DAY_POPOVER_ID,
      class: "paperchat-stats-day-popover paperchat-stats-day-popover--reading",
      role: "dialog",
      "aria-label": formatTooltipDate(cellData.date),
    },
  );
  popover.appendChild(
    createDayPopoverHeader(doc, panel, cell, theme, cellData.date),
  );
  const summary = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-summary" },
  );
  const label = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-label" },
  );
  label.textContent = getString("chat-stats-chat-total");
  const total = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-total" },
  );
  if (cellData.totalMessages > 0) {
    total.textContent = String(cellData.totalMessages);
  } else {
    total.classList.add("paperchat-stats-day-total--empty");
    total.textContent = getString("chat-stats-chat-day-empty");
  }
  summary.append(label, total);
  popover.appendChild(summary);
  if (cellData.totalMessages > 0) {
    popover.appendChild(
      createSplitBar(doc, [
        [cellData.userMessages, "var(--stats-accent)"],
        [cellData.assistantMessages, "var(--stats-output)"],
      ]),
    );
    const legend = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-legend" },
    );
    legend.append(
      createLegendDot(
        doc,
        "var(--stats-accent)",
        getString("chat-stats-chat-user-total"),
        String(cellData.userMessages),
      ),
      createLegendDot(
        doc,
        "var(--stats-output)",
        getString("chat-stats-chat-assistant-total"),
        String(cellData.assistantMessages),
      ),
    );
    popover.appendChild(legend);
  }
  panel.appendChild(popover);
  positionDayPopover(panel, cell, popover);
}

function renderChatActivityHeatmap(
  doc: Document,
  theme: ThemeColors,
  chat: ChatActivitySnapshot,
): HTMLElement {
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
        : `${formatTooltipDate(cell.date)} · ${getString("chat-stats-chat-day-empty")}`,
    (panelEl, cellEl, cell) => {
      const source = cellByKey.get(cell.dayKey);
      if (source) {
        hideTokenBarHoverTooltip(panelEl);
        openChatActivityDayPopover(panelEl, cellEl, theme, source);
      }
    },
    CHAT_HEATMAP_LEVEL_COLORS,
    (panelEl, cellEl, cell) => {
      const source = cellByKey.get(cell.dayKey);
      if (source) {
        showChatDayHoverTooltip(panelEl, cellEl, source);
      }
    },
    (panelEl) => {
      hideTokenBarHoverTooltip(panelEl);
    },
  );
}

async function renderBookmarksOverview(
  doc: Document,
  theme: ThemeColors,
): Promise<HTMLElement> {
  const wrap = createElement(doc, "div", {});
  try {
    const service = getBookmarkService();
    const [folders, bookmarks] = await Promise.all([
      service.listFolders(),
      service.listBookmarks({ filter: "all", sort: "created_desc" }),
    ]);
    if (!bookmarks.length && !folders.length) {
      wrap.appendChild(
        createEmptyHint(doc, theme, getString("chat-stats-bookmarks-empty")),
      );
      return wrap;
    }
    const weekStart = getStartOfLocalWeek(new Date()).getTime();
    const thisWeek = bookmarks.filter(
      (bookmark) => bookmark.createdAt >= weekStart,
    ).length;
    const ledger = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-ledger paperchat-stats-ledger--tiles" },
    );
    ledger.append(
      createStatsMetric(
        doc,
        getString("chat-stats-bookmarks-total"),
        String(bookmarks.length),
      ),
      createStatsMetric(
        doc,
        getString("chat-stats-bookmarks-folders"),
        String(folders.length),
      ),
      createStatsMetric(
        doc,
        getString("chat-stats-bookmarks-this-week"),
        String(thisWeek),
      ),
    );
    wrap.appendChild(ledger);
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to load bookmark stats:", error);
    wrap.appendChild(
      createEmptyHint(doc, theme, getString("chat-stats-bookmarks-empty")),
    );
  }
  return wrap;
}

async function renderChatStats(
  doc: Document,
  theme: ThemeColors,
  host: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  host.textContent = "";
  host.dataset.helpText = getString("chat-stats-chat-footnote");
  const chat = await getChatActivitySnapshot();
  const total = chat.totalUserMessages + chat.totalAssistantMessages;
  const primary = createStatsMetric(
    doc,
    getString("chat-stats-chat-total"),
    String(total),
    buildChatWeekCardHint(chat),
  );
  primary.appendChild(
    createSplitBar(doc, [
      [chat.totalUserMessages, "var(--stats-accent)"],
      [chat.totalAssistantMessages, "var(--stats-output)"],
    ]),
  );
  const userMetric = createStatsMetric(
    doc,
    getString("chat-stats-chat-user-total"),
    String(chat.totalUserMessages),
  );
  userMetric.dataset.chatKind = "user";
  const assistantMetric = createStatsMetric(
    doc,
    getString("chat-stats-chat-assistant-total"),
    String(chat.totalAssistantMessages),
  );
  assistantMetric.dataset.chatKind = "assistant";
  const weekMetric = createStatsMetric(
    doc,
    getString("chat-stats-chat-this-week"),
    String(chat.messagesThisWeek),
  );
  weekMetric.dataset.chatKind = "week";
  host.appendChild(
    createOverview(doc, primary, [userMetric, assistantMetric, weekMetric]),
  );

  const activeDays = chat.cells.filter((cell) => cell.totalMessages > 0).length;
  const heat = createElement(doc, "div", {});
  heat.appendChild(renderChatActivityHeatmap(doc, theme, chat));
  const note = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-card-note" },
  );
  note.textContent = getString("chat-stats-chat-heatmap-hint");
  heat.appendChild(note);
  appendStatsSection(
    host,
    doc,
    getString("chat-stats-chat-activity-title"),
    heat,
    {
      badge: activeDays
        ? getString("chat-stats-active-days-badge", {
            args: { count: String(activeDays) },
          })
        : undefined,
    },
  );
  closeHeatmapDayPopover(panel);
  bindHeatmapDayPopoverDismiss(panel);

  appendStatsSection(
    host,
    doc,
    getString("chat-stats-bookmarks-overview-title"),
    await renderBookmarksOverview(doc, theme),
  );

  const footnote = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-footnote" },
  );
  footnote.textContent = getString("chat-stats-chat-footnote");
  host.appendChild(footnote);
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
  const popover = createElement(
    doc,
    "div",
    { position: "absolute", zIndex: "5" },
    {
      id: DAY_POPOVER_ID,
      class: "paperchat-stats-day-popover paperchat-stats-day-popover--reading",
      role: "dialog",
      "aria-label": formatTooltipDate(cellData.date),
    },
  );

  popover.appendChild(
    createDayPopoverHeader(doc, panel, cell, theme, cellData.date),
  );

  const summary = createElement(doc, "div", {});
  summary.className = "paperchat-stats-day-summary";
  const summaryLabel = createElement(doc, "div", {});
  summaryLabel.className = "paperchat-stats-day-label";
  summaryLabel.textContent = getString("chat-stats-day-reading-total");
  const total = createElement(doc, "div", {});
  total.className = "paperchat-stats-day-total";
  if (cellData.seconds > 0) {
    renderReadingTimeValue(total, cellData.seconds);
    total.title = formatReadingDuration(cellData.seconds);
  } else {
    total.classList.add("paperchat-stats-day-total--empty");
    total.textContent = getString("chat-stats-heatmap-day-none");
  }
  summary.appendChild(summaryLabel);
  summary.appendChild(total);
  popover.appendChild(summary);

  if (items.length) {
    const listHeading = createElement(doc, "div", {});
    listHeading.className = "paperchat-stats-day-list-heading";
    listHeading.textContent = getString("chat-stats-day-literature-count", {
      args: { count: String(items.length) },
    });
    popover.appendChild(listHeading);
    const list = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      marginTop: "8px",
    });
    list.className = "paperchat-stats-day-reading-list";
    for (const item of items) {
      const row = createElement(
        doc,
        "button",
        {
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "8px",
          width: "100%",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--stats-text)",
        },
        { type: "button" },
      ) as HTMLButtonElement;
      row.className = "paperchat-stats-day-reading-row";
      const titleEl = createElement(doc, "span", {});
      titleEl.textContent = item.title;
      titleEl.title = item.title;
      titleEl.className = "paperchat-stats-day-item-title";
      const durationEl = createElement(doc, "span", {
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      });
      durationEl.className = "paperchat-stats-day-item-duration";
      durationEl.textContent = formatReadingDurationCompact(item.seconds);
      durationEl.title = formatReadingDuration(item.seconds);
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
      color: "var(--stats-muted)",
      lineHeight: "1.4",
    });
    hint.textContent = getString("chat-stats-heatmap-day-no-items");
    hint.className = "paperchat-stats-day-note";
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
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !panel.querySelector(`#${DAY_POPOVER_ID}`)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = panel.querySelector<HTMLElement>(
      ".paperchat-reading-heatmap-cell--selected, .paperchat-stats-token-bar-column--selected",
    );
    closeHeatmapDayPopover(panel);
    anchor?.focus({ preventScroll: true });
  });
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
  _theme: ThemeColors,
  date: Date,
  seconds: number,
): void {
  if (seconds <= 0) {
    return;
  }
  hideTokenBarHoverTooltip(panel);
  const doc = panel.ownerDocument;
  const tooltip = createElement(
    doc,
    "div",
    {},
    {
      id: TOKEN_BAR_HOVER_TOOLTIP_ID,
      class: "paperchat-stats-token-bar-tooltip",
    },
  );
  tooltip.textContent = getString("chat-stats-heatmap-day-tooltip", {
    args: {
      date: formatTooltipDate(date),
      duration: formatReadingDuration(seconds),
    },
  });
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
  const hint = [weekLine, weekDelta].filter(Boolean).join(" · ");
  return {
    hint,
    hintTitle: details.length > 1 ? details.join(" · ") : undefined,
  };
}

function invalidateStatsViewCache(panel: HTMLElement): void {
  panel
    .querySelectorAll(
      `#${VIEW_HOST_READING}, #${VIEW_HOST_CHAT}, #${VIEW_HOST_TOKEN}`,
    )
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
  _theme: ThemeColors,
  day: TokenBarDay,
): void {
  if (day.totalTokens <= 0) {
    return;
  }
  hideTokenBarHoverTooltip(panel);
  const doc = panel.ownerDocument;
  const tooltip = createElement(
    doc,
    "div",
    {},
    {
      id: TOKEN_BAR_HOVER_TOOLTIP_ID,
      class: "paperchat-stats-token-bar-tooltip",
    },
  );
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
  const colors = levelColors ?? HEATMAP_LEVEL_COLORS;
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
  wrap.className = "paperchat-stats-heatmap";
  const viewport = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-calendar-scroll" },
  );
  const calendar = createElement(
    doc,
    "div",
    { minWidth: `${22 + weekCount * 12}px` },
    { class: "paperchat-stats-calendar" },
  );
  calendar.appendChild(renderMonthAxis(doc, theme, cells, weekCount));
  viewport.appendChild(calendar);
  wrap.appendChild(viewport);
  viewport.addEventListener("scroll", () => {
    const panel = wrap.closest<HTMLElement>(`#${PANEL_ID}`);
    if (panel) closeHeatmapDayPopover(panel);
  });

  const grid = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: gridColumns,
    columnGap: "3px",
    rowGap: "3px",
    alignItems: "center",
    width: "100%",
  });

  for (let row = 0; row < 7; row += 1) {
    const weekday = createElement(doc, "div", {
      fontSize: "9px",
      color: "var(--stats-muted)",
      lineHeight: "1.1",
    });
    weekday.className = "paperchat-stats-calendar-weekday";
    const weekdayDate = cells[row]?.date;
    const weekdayNumber = weekdayDate?.getDay();
    if (weekdayNumber === 1 || weekdayNumber === 3 || weekdayNumber === 5) {
      try {
        weekday.textContent = weekdayDate.toLocaleDateString(undefined, {
          weekday: "narrow",
        });
      } catch {
        weekday.textContent = ["日", "一", "二", "三", "四", "五", "六"][
          weekdayNumber
        ];
      }
    } else {
      weekday.textContent = "";
    }
    grid.appendChild(weekday);
    for (let week = 0; week < weekCount; week += 1) {
      const cellData = cells[week * 7 + row];
      const cell = createElement(doc, "div", {
        width: "100%",
        aspectRatio: "1",
        borderRadius: "1.5px",
        background: colors[cellData?.level ?? 0],
        cursor: "pointer",
        justifySelf: "stretch",
      });
      cell.className = "paperchat-reading-heatmap-cell";
      cell.dataset.level = String(cellData?.level ?? 0);
      if (cellData) {
        cell.setAttribute("role", "button");
        cell.tabIndex = 0;
        cell.setAttribute("aria-label", _describe(cellData));
        cell.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            cell.click();
          }
        });
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
  calendar.appendChild(grid);

  const legend = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
    marginTop: "4px",
    fontSize: "10px",
    color: "var(--stats-muted)",
  });
  legend.className = "paperchat-stats-heatmap-legend";
  const less = createElement(doc, "span", {});
  less.textContent = getString("chat-stats-heatmap-less");
  legend.appendChild(less);
  for (let level = 0; level < 5; level += 1) {
    const swatch = createElement(doc, "div", {
      width: "9px",
      height: "9px",
      borderRadius: "1.5px",
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
      const source = snapshot.cells.find(
        (entry) => entry.dayKey === cell.dayKey,
      );
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
      showReadingDayHoverTooltip(panel, cellEl, theme, cell.date, cell.value);
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
  if (visible) startReadingStatusUpdates(panel);
  else stopReadingStatusUpdates(panel);
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

type StatsView = StatsPanelView;

function readStatsView(panel: HTMLElement): StatsView {
  const view = panel.dataset.statsView;
  return view === "tokens" || view === "chat" ? view : "reading";
}

function syncStatsViewSwitcher(panel: HTMLElement, current: StatsView): void {
  panel
    .querySelectorAll<HTMLElement>("button[data-stats-view-id]")
    .forEach((tab) => {
      const selected = tab.getAttribute("data-stats-view-id") === current;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  const switcher = panel.querySelector<HTMLElement>(
    ".paperchat-stats-view-switcher",
  );
  if (switcher) {
    switcher.dataset.active = current;
  }
}

function createViewSwitcher(
  doc: Document,
  panel: HTMLElement,
  current: StatsView,
): HTMLElement {
  const bar = createElement(
    doc,
    "div",
    {},
    {
      class: "paperchat-stats-view-switcher",
      role: "tablist",
    },
  );
  const views: Array<[StatsView, string]> = [
    ["reading", getString("chat-stats-view-reading")],
    ["chat", getString("chat-stats-view-chat")],
    ["tokens", getString("chat-stats-view-tokens")],
  ];
  const select = (id: StatsView): void => {
    if (readStatsView(panel) === id) {
      return;
    }
    panel.dataset.statsView = id;
    syncStatsViewSwitcher(panel, id);
    void refreshReadingStatsPanel(panel, getCurrentTheme());
  };
  views.forEach(([id, label], index) => {
    const button = createElement(
      doc,
      "button",
      {},
      {
        type: "button",
        role: "tab",
        "data-stats-view-id": id,
      },
    ) as HTMLButtonElement;
    button.textContent = label;
    button.addEventListener("click", () => select(id));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const [nextId] = views[(index + step + views.length) % views.length];
      select(nextId);
      bar
        .querySelector<HTMLElement>(`[data-stats-view-id="${nextId}"]`)
        ?.focus();
    });
    bar.appendChild(button);
  });
  bar.dataset.active = current;
  syncStatsViewSwitcherButtons(bar, current);
  return bar;
}

function syncStatsViewSwitcherButtons(bar: HTMLElement, current: StatsView) {
  bar
    .querySelectorAll<HTMLElement>("button[data-stats-view-id]")
    .forEach((tab) => {
      const selected = tab.getAttribute("data-stats-view-id") === current;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
}

type TokenDayDetail =
  | TokenStatsSnapshot["cells"][number]
  | TokenStatsSnapshot["recentDays"][number];

function appendTokenIoLegendItem(
  doc: Document,
  _theme: ThemeColors,
  color: string,
  label: string,
  detail: string,
): HTMLElement {
  const item = createElement(doc, "div", {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "10px",
    color: "var(--stats-muted)",
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
  const inputColor = "var(--stats-token-in)";
  const outputColor = "var(--stats-output)";
  const inputPct = Math.round((inputTokens / total) * 100);
  const outputPct = Math.round((outputTokens / total) * 100);

  const block = createElement(doc, "div", {
    marginTop: "10px",
    paddingTop: "8px",
    borderTop: "1px solid var(--stats-border)",
  });
  block.className = "paperchat-stats-token-io-ratio";

  const heading = createElement(doc, "div", {
    fontSize: "11px",
    fontWeight: "600",
    color: "var(--stats-text-soft)",
    marginBottom: "6px",
  });
  heading.textContent = getString("chat-stats-token-io-ratio-title");
  block.appendChild(heading);

  const track = createElement(doc, "div", {
    display: "flex",
    height: "8px",
    borderRadius: "999px",
    overflow: "hidden",
    background: "var(--stats-inset)",
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
          count: formatTokenCount(inputTokens),
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
          count: formatTokenCount(outputTokens),
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
  _theme: ThemeColors,
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
    color: "var(--stats-text-soft)",
    marginBottom: "4px",
  });
  title.textContent = getString("chat-stats-token-day-models-title");
  list.appendChild(title);

  if (!models.length) {
    const empty = createElement(doc, "div", {
      fontSize: "11px",
      color: "var(--stats-muted)",
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
      borderTop: "1px solid var(--stats-border)",
      alignItems: "baseline",
    });
    const name = createElement(doc, "span", {
      fontSize: "12px",
      color: "var(--stats-text)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    name.textContent = model.model;
    name.title = model.model;
    const value = createElement(doc, "span", {
      fontSize: "11px",
      color: "var(--stats-muted)",
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
  const popover = createElement(
    doc,
    "div",
    { position: "absolute", zIndex: "5" },
    {
      id: DAY_POPOVER_ID,
      class: "paperchat-stats-day-popover paperchat-stats-day-popover--reading",
      role: "dialog",
      "aria-label": formatTooltipDate(cell.date),
    },
  );
  popover.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }
    event.preventDefault();
    closeHeatmapDayPopover(panel);
  });

  popover.appendChild(
    createDayPopoverHeader(doc, panel, cellEl, theme, cell.date),
  );

  const summary = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-summary" },
  );
  const summaryLabel = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-label" },
  );
  summaryLabel.textContent = getString("chat-stats-token-total");
  const summaryValue = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-day-total" },
  );
  if (cell.totalTokens > 0) {
    summaryValue.textContent = formatCompactTokenCount(cell.totalTokens);
    summaryValue.title = formatTokenCount(cell.totalTokens);
  } else {
    summaryValue.classList.add("paperchat-stats-day-total--empty");
    summaryValue.textContent = getString("chat-stats-heatmap-day-none");
  }
  summary.append(summaryLabel, summaryValue);
  popover.appendChild(summary);

  if (cell.totalTokens > 0) {
    if (cell.reasoningTokens > 0) {
      const reasoning = createElement(doc, "div", {
        marginTop: "6px",
        fontSize: "11px",
        color: "var(--stats-muted)",
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
  const tokenColors = TOKEN_HEATMAP_LEVEL_COLORS;
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
      const source = snapshot.cells.find(
        (entry) => entry.dayKey === cell.dayKey,
      );
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
      const source = snapshot.cells.find(
        (entry) => entry.dayKey === cell.dayKey,
      );
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
    gap: "10px",
  });
  if (!days.length) {
    return wrap;
  }
  const max = Math.max(...days.map((day) => day.totalTokens), 1);
  const chartRow = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "8px",
    alignItems: "stretch",
  });
  const scale = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-daily-scale" },
  );
  const scaleMax = createElement(doc, "span", { whiteSpace: "nowrap" });
  scaleMax.textContent = formatCompactTokenCount(max);
  const scaleMid = createElement(doc, "span", { whiteSpace: "nowrap" });
  scaleMid.textContent = formatCompactTokenCount(Math.round(max / 2));
  const scaleMin = createElement(doc, "span", {});
  scaleMin.textContent = "0";
  scale.append(scaleMax, scaleMid, scaleMin);

  const stage = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-daily-stage" },
  );
  const chart = createElement(
    doc,
    "div",
    {
      gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
    },
    { class: "paperchat-stats-daily-chart" },
  );
  const inputColor = "var(--stats-token-in)";
  const outputColor = "var(--stats-output)";
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    const column = createElement(doc, "div", {
      cursor: day.totalTokens > 0 ? "pointer" : "default",
    });
    column.className = "paperchat-stats-token-bar-column";
    if (day.totalTokens > 0) {
      column.setAttribute("role", "button");
      column.tabIndex = 0;
      column.setAttribute(
        "aria-label",
        `${formatTooltipDate(day.date)}: ${formatTokenCount(day.totalTokens)} Token`,
      );
      column.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          column.click();
        }
      });
    }
    const track = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-token-bar-track" },
    );
    const totalHeight = Math.round((day.totalTokens / max) * 100);
    const stack = createElement(doc, "div", {
      height: day.totalTokens > 0 ? `${Math.max(totalHeight, 8)}%` : "0%",
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
    const label = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-bar-axis-label" },
    );
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
  stage.appendChild(chart);
  chartRow.appendChild(scale);
  chartRow.appendChild(stage);
  wrap.appendChild(chartRow);
  wrap.addEventListener("mouseleave", () => {
    hideTokenBarHoverTooltip(panel);
  });

  const legend = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-legend paperchat-stats-legend--end" },
  );
  legend.append(
    createLegendDot(doc, inputColor, getString("chat-stats-token-input")),
    createLegendDot(doc, outputColor, getString("chat-stats-token-output")),
  );
  wrap.appendChild(legend);
  return wrap;
}

function renderTokenModelList(
  doc: Document,
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
  snapshot.models.forEach((model, index) => {
    const total = model.inputTokens + model.outputTokens;
    const row = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-bar-row paperchat-stats-model-row" },
    );
    row.dataset.rank = String(index + 1);
    const head = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-rank-heading" },
    );
    const indexEl = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-rank-index" },
    );
    indexEl.textContent = String(index + 1).padStart(2, "0");
    const name = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-rank-title" },
    );
    name.textContent = model.model;
    name.title = model.model;
    const value = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-rank-value" },
    );
    value.textContent = formatCompactTokenCount(total);
    value.title = getString("chat-stats-token-day-split", {
      args: {
        input: formatTokenCount(model.inputTokens),
        output: formatTokenCount(model.outputTokens),
      },
    });
    head.append(indexEl, name, value);

    const track = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-rank-track" },
    );
    const fill = createElement(
      doc,
      "div",
      {
        background:
          index === 0 ? "var(--stats-output)" : "var(--stats-token-in)",
      },
      { class: "paperchat-stats-read-bar-fill" },
    );
    track.appendChild(fill);
    revealBar(fill, (total / max) * 100);

    const split = createElement(
      doc,
      "div",
      {},
      { class: "paperchat-stats-rank-meta" },
    );
    split.textContent = getString("chat-stats-token-day-split", {
      args: {
        input: formatCompactTokenCount(model.inputTokens),
        output: formatCompactTokenCount(model.outputTokens),
      },
    });

    row.append(head, track, split);
    list.appendChild(row);
  });
  return list;
}

function createOverview(
  doc: Document,
  primary: HTMLElement,
  details: HTMLElement[],
): HTMLElement {
  const overview = createElement(
    doc,
    "section",
    {},
    { class: "paperchat-stats-overview" },
  );
  primary.classList.add("paperchat-stats-primary");
  const ledger = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-ledger" },
  );
  ledger.append(...details);
  overview.append(primary, ledger);
  return overview;
}

async function renderTokenStats(
  doc: Document,
  theme: ThemeColors,
  host: HTMLElement,
  panel: HTMLElement,
): Promise<void> {
  host.textContent = "";
  host.dataset.helpText = getString("chat-stats-help-token");
  const snapshot = await getTokenStatsSnapshot();
  if (snapshot.totalTokens <= 0) {
    host.appendChild(
      createEmptyHint(doc, theme, getString("chat-stats-token-empty")),
    );
    return;
  }
  const total = createStatsMetric(
    doc,
    getString("chat-stats-token-total"),
    formatCompactTokenCount(snapshot.totalTokens),
    buildTokenWeekCardHint(snapshot),
  );
  total.appendChild(
    createSplitBar(doc, [
      [snapshot.inputTokens, "var(--stats-token-in)"],
      [snapshot.outputTokens, "var(--stats-output)"],
    ]),
  );
  const metrics = [
    [getString("chat-stats-token-input"), snapshot.inputTokens, "input"],
    [getString("chat-stats-token-output"), snapshot.outputTokens, "output"],
  ] as const;
  const details = metrics.map(([label, count, kind]) => {
    const share = (count / snapshot.totalTokens) * 100;
    const metric = createStatsMetric(
      doc,
      label,
      formatCompactTokenCount(count),
      {
        hint: getString("chat-stats-token-share", {
          args: { percent: String(Math.round(share)) },
        }),
      },
    );
    metric.dataset.tokenKind = kind;
    return metric;
  });
  host.appendChild(createOverview(doc, total, details));

  appendStatsSection(
    host,
    doc,
    getString("chat-stats-token-daily-title"),
    renderTokenHeatmap(doc, theme, snapshot),
    {
      badge: snapshot.activeDays
        ? getString("chat-stats-active-days-badge", {
            args: { count: String(snapshot.activeDays) },
          })
        : undefined,
    },
  );

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
    appendStatsSection(
      host,
      doc,
      getString("chat-stats-token-models-title"),
      renderTokenModelList(doc, snapshot),
      { badge: String(snapshot.models.length) },
    );
  }
  const footnote = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-footnote" },
  );
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
  host.dataset.helpText = getString("chat-stats-help-reading", {
    args: {
      total: formatReadingDuration(snapshot.totalSecondsLastYear),
    },
  });
  const weekly = createStatsMetric(
    doc,
    getString("chat-stats-reading-this-week"),
    formatReadingDurationCompact(snapshot.totalSecondsThisWeek),
    buildReadingWeekCardHint(snapshot),
  );
  const value = weekly.querySelector<HTMLElement>(
    ".paperchat-stats-metric-value",
  )!;
  renderReadingTimeValue(value, snapshot.totalSecondsThisWeek);
  const weekRange = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-week-range" },
  );
  const weekStart = getStartOfLocalWeek(snapshot.rangeEnd);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  weekRange.textContent = `${format.format(weekStart)} – ${format.format(weekEnd)}`;
  weekly.append(weekRange, createReadingWeekRhythm(doc, snapshot));
  const { total, withReadingTime } = snapshot.literature;
  const coverage = total > 0 ? Math.round((withReadingTime / total) * 100) : 0;
  host.appendChild(
    createOverview(doc, weekly, [
      createStatsMetric(
        doc,
        getString("chat-stats-literature-total"),
        String(total),
      ),
      createStatsMetric(
        doc,
        getString("chat-stats-literature-read"),
        String(withReadingTime),
        total > 0
          ? {
              hint: getString("chat-stats-read-coverage", {
                args: { percent: String(coverage) },
              }),
            }
          : undefined,
      ),
    ]),
  );
  appendStatsSection(
    host,
    doc,
    getString("chat-stats-daily-reading-title"),
    renderHeatmap(doc, theme, snapshot),
    {
      badge:
        snapshot.totalSecondsLastYear > 0
          ? getString("chat-stats-six-months-total", {
              args: {
                total: formatReadingDurationCompact(
                  snapshot.totalSecondsLastYear,
                ),
              },
            })
          : undefined,
    },
  );
  closeHeatmapDayPopover(panel);
  bindHeatmapDayPopoverDismiss(panel);
  appendStatsSection(
    host,
    doc,
    getString("chat-stats-top-reading-title"),
    renderTopReadingList(doc, theme, snapshot.topReadItems),
    snapshot.topReadItems.length
      ? { badge: String(snapshot.topReadItems.length) }
      : undefined,
  );
  host.appendChild(
    createCollapsibleSection(
      doc,
      theme,
      getString("chat-stats-recent-added-title"),
      renderRecentlyAddedList(doc, theme, snapshot.recentlyAdded),
      {
        storageKey: "recentAddedCollapsedV1",
        defaultCollapsed: false,
        badge: snapshot.recentlyAdded.length
          ? String(snapshot.recentlyAdded.length)
          : undefined,
      },
    ),
  );

  const footnote = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-footnote" },
  );
  footnote.textContent = getString("chat-stats-reading-footnote", {
    args: {
      total: formatReadingDuration(snapshot.totalSecondsLastYear),
    },
  });
  host.appendChild(footnote);
}

function ensureViewHost(
  body: HTMLElement,
  doc: Document,
  id: string,
): HTMLElement {
  let host = body.querySelector(`#${id}`) as HTMLElement | null;
  if (!host) {
    host = createElement(doc, "div", {}, { id, class: "paperchat-stats-view" });
    body.appendChild(host);
  }
  return host;
}

export async function reapplyReadingStatsPanelTheme(
  container: HTMLElement,
  theme: ThemeColors,
): Promise<void> {
  const panel = getReadingStatsPanel(container);
  if (!panel || !isReadingStatsPanelVisible(container)) {
    return;
  }
  panel.dataset.theme = theme === darkTheme ? "dark" : "light";
  invalidateStatsViewCache(panel);
  await refreshReadingStatsPanel(panel, theme, { force: true });
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

  const switcherHost = panel.querySelector(
    `#${STATS_SWITCHER_HOST_ID}`,
  ) as HTMLElement | null;
  let switcher = switcherHost?.querySelector(
    ".paperchat-stats-view-switcher",
  ) as HTMLElement | null;
  if (switcherHost) {
    body.querySelector(".paperchat-stats-view-switcher")?.remove();
    if (!switcher) {
      switcher = createViewSwitcher(doc, panel, view);
      switcherHost.appendChild(switcher);
    } else {
      syncStatsViewSwitcher(panel, view);
    }
  }

  const hosts: Record<StatsView, HTMLElement> = {
    reading: ensureViewHost(body, doc, VIEW_HOST_READING),
    chat: ensureViewHost(body, doc, VIEW_HOST_CHAT),
    tokens: ensureViewHost(body, doc, VIEW_HOST_TOKEN),
  };
  for (const [id, host] of Object.entries(hosts)) {
    host.style.display = id === view ? "block" : "none";
  }
  panel.dataset.statsView = view;
  syncStatsViewSwitcher(panel, view);
  closeHeatmapDayPopover(panel);

  const host = hosts[view];
  if (force || host.dataset.built !== "1") {
    host.dataset.loading = "true";
    try {
      if (view === "tokens") {
        await renderTokenStats(doc, theme, host, panel);
      } else if (view === "chat") {
        await renderChatStats(doc, theme, host, panel);
      } else {
        await renderReadingStatsContent(doc, theme, host, panel);
      }
      host.dataset.built = "1";
    } catch (error) {
      ztoolkit.log("[ReadingStats] Failed to render stats view:", error);
    } finally {
      delete host.dataset.loading;
    }
    host.classList.remove("is-entering");
    void host.offsetWidth;
    host.classList.add("is-entering");
  }
  panel.dataset.statsHelpText = host.dataset.helpText || "";
  panel.querySelector("#paperchat-stats-help-popover")?.remove();

  const subtitle = panel.querySelector(
    `#${STATS_SUBTITLE_ID}`,
  ) as HTMLElement | null;
  if (subtitle) {
    updateStatsPanelSubtitle(
      subtitle,
      doc,
      theme,
      view,
      isReadingTimeAccumulatingNow(),
    );
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
      background: "var(--stats-bg)",
      zIndex: "10002",
    },
    { id: PANEL_ID },
  );
  panel.dataset.statsView = "reading";
  panel.dataset.statsLayout = "wide";
  panel.dataset.theme = isDarkMode() ? "dark" : "light";

  const toolbar = createElement(
    doc,
    "div",
    {
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      padding: "12px 14px 11px",
      borderBottom: "1px solid var(--stats-border)",
      background: "var(--stats-bg)",
      flexShrink: "0",
      minWidth: "0",
    },
    { id: STATS_TOOLBAR_ID },
  );
  toolbar.className = "paperchat-stats-panel-toolbar";

  const headerRow = createElement(doc, "div", {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "10px",
    minWidth: "0",
  });

  const brand = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-brand" },
  );
  const titleStack = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-title-stack" },
  );
  const title = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-panel-title" },
  );
  title.textContent = getString("chat-stats-title");
  const subtitle = createElement(
    doc,
    "div",
    {},
    { id: STATS_SUBTITLE_ID, class: "paperchat-stats-panel-subtitle" },
  );
  titleStack.append(title, subtitle);
  brand.append(titleStack);

  const actions = createElement(
    doc,
    "div",
    {},
    { class: "paperchat-stats-header-actions" },
  );
  const helpBtn = createStatsToolbarIconButton(
    doc,
    theme,
    "help.svg",
    getString("chat-stats-help"),
    () => {
      toggleStatsHelpPopover(
        toolbar,
        doc,
        getCurrentTheme(),
        panel.dataset.statsHelpText || "",
      );
    },
  );
  helpBtn.setAttribute("data-stats-help-trigger", "1");
  actions.appendChild(helpBtn);
  const refreshPanel = (): void => {
    void refreshReadingStatsPanel(panel, getCurrentTheme(), { force: true });
  };
  actions.appendChild(
    createStatsToolbarIconButton(
      doc,
      theme,
      "refresh.svg",
      getString("chat-stats-refresh"),
      refreshPanel,
    ),
  );
  const closeBtn = createStatsToolbarIconButton(
    doc,
    theme,
    "close.svg",
    getString("chat-bookmark-close"),
    onClose,
  );
  closeBtn.id = STATS_CLOSE_BTN_ID;
  actions.appendChild(closeBtn);
  headerRow.appendChild(brand);
  headerRow.appendChild(actions);

  const switcherHost = createElement(
    doc,
    "div",
    { minWidth: "0" },
    { id: STATS_SWITCHER_HOST_ID },
  );
  switcherHost.className = "paperchat-stats-view-switcher-host";

  toolbar.appendChild(headerRow);
  toolbar.appendChild(switcherHost);
  panel.appendChild(toolbar);

  const body = createElement(
    doc,
    "div",
    {
      flex: "1",
      minHeight: "0",
      overflow: "auto",
      position: "relative",
    },
    { id: "chat-reading-stats-panel-body" },
  );
  panel.appendChild(body);

  updateStatsPanelSubtitle(
    subtitle,
    doc,
    theme,
    "reading",
    isReadingTimeAccumulatingNow(),
  );

  return panel;
}
