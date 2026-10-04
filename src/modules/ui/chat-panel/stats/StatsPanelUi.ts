import { config } from "../../../../../package.json";
import { getString } from "../../../../utils/locale";
import { createElement } from "../ChatPanelBuilder";
import type { ThemeColors } from "../types";

const STATS_READING_FILE = "paperchat-reading-stats.json";
const STATS_TOKEN_FILE = "paperchat-token-stats.json";

export function getLocalizedWeekdayLabels(): string[] {
  const base = new Date(2024, 0, 7);
  const labels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    try {
      labels.push(
        date.toLocaleDateString(undefined, { weekday: "narrow" }),
      );
    } catch {
      labels.push(["S", "M", "T", "W", "T", "F", "S"][i] ?? "");
    }
  }
  return labels;
}

export function shouldShowMonthOnBarAxis(
  date: Date,
  previous: Date | null,
): boolean {
  if (!previous) {
    return date.getDate() === 1;
  }
  return date.getMonth() !== previous.getMonth();
}

export function formatBarAxisDayLabel(
  date: Date,
  showMonth: boolean,
): string {
  if (!showMonth) {
    return String(date.getDate());
  }
  try {
    const month = new Intl.DateTimeFormat(undefined, {
      month: "numeric",
    }).format(date);
    return `${month}/${date.getDate()}`;
  } catch {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
}

export function formatWeekDeltaHint(
  thisWeek: number,
  lastWeek: number,
  formatValue: (value: number) => string,
): string {
  if (thisWeek <= 0 && lastWeek <= 0) {
    return "";
  }
  const diff = thisWeek - lastWeek;
  if (diff === 0) {
    return getString("chat-stats-week-same-as-last");
  }
  const sign = diff > 0 ? "+" : "-";
  return getString("chat-stats-week-vs-last", {
    args: { delta: `${sign}${formatValue(Math.abs(diff))}` },
  });
}

export function appendStatsPanelToolbar(
  toolsHost: HTMLElement,
  header: HTMLElement,
  panel: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  options: {
    updatedAt: Date;
    onRefresh: () => void;
    onExportReading: () => void;
    onExportToken: () => void;
  },
): void {
  toolsHost.textContent = "";

  const updated = createElement(doc, "span", {
    fontSize: "11px",
    color: theme.textMuted,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    marginRight: "auto",
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  updated.className = "paperchat-stats-updated-at";
  updated.textContent = formatUpdatedAt(options.updatedAt);
  toolsHost.appendChild(updated);

  toolsHost.appendChild(
    createIconToolButton(doc, theme, getString("chat-stats-refresh"), () => {
      options.onRefresh();
    }),
  );
  toolsHost.appendChild(
    createIconToolButton(
      doc,
      theme,
      getString("chat-stats-export-reading-short"),
      () => {
        options.onExportReading();
      },
      getString("chat-stats-export-reading"),
    ),
  );
  toolsHost.appendChild(
    createIconToolButton(
      doc,
      theme,
      getString("chat-stats-export-token-short"),
      () => {
        options.onExportToken();
      },
      getString("chat-stats-export-token"),
    ),
  );
  toolsHost.appendChild(
    createIconToolButton(doc, theme, getString("chat-stats-help"), () => {
      toggleStatsHelpPopover(
        header,
        doc,
        theme,
        panel.dataset.statsHelpText || "",
      );
    }),
  );
}

function formatUpdatedAt(date: Date): string {
  try {
    return getString("chat-stats-updated-at", {
      args: {
        time: date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    });
  } catch {
    return "";
  }
}

function createIconToolButton(
  doc: Document,
  theme: ThemeColors,
  label: string,
  onClick: () => void,
  tooltip?: string,
): HTMLButtonElement {
  const hint = tooltip || label;
  const button = createElement(
    doc,
    "button",
    {
      height: "28px",
      padding: "0 8px",
      border: `1px solid ${theme.borderColor}`,
      borderRadius: "6px",
      background: "transparent",
      color: theme.textSecondary,
      fontSize: "11px",
      fontWeight: "550",
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: "0",
    },
    { type: "button", title: hint, "aria-label": hint },
  ) as HTMLButtonElement;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

const STATS_HELP_ID = "paperchat-stats-help-popover";

function toggleStatsHelpPopover(
  header: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  text: string,
): void {
  const existing = header.querySelector(`#${STATS_HELP_ID}`);
  if (existing) {
    existing.remove();
    return;
  }
  const pop = createElement(doc, "div", {
    position: "absolute",
    top: "48px",
    right: "12px",
    zIndex: "8",
    maxWidth: "min(320px, calc(100% - 24px))",
    padding: "10px 12px",
    borderRadius: "10px",
    border: `1px solid ${theme.borderColor}`,
    background: theme.dropdownBg || theme.inputBg,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
    fontSize: "11px",
    lineHeight: "1.5",
    color: theme.textSecondary,
    whiteSpace: "pre-wrap",
  });
  pop.id = STATS_HELP_ID;
  pop.textContent = text;
  header.style.position = "relative";
  header.appendChild(pop);
  const dismiss = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(`#${STATS_HELP_ID}`) || target?.closest("button")) {
      return;
    }
    pop.remove();
    doc.removeEventListener("mousedown", dismiss, true);
  };
  doc.addEventListener("mousedown", dismiss, true);
}

export function createCollapsibleSection(
  doc: Document,
  theme: ThemeColors,
  title: string,
  content: HTMLElement,
  options: { defaultCollapsed?: boolean; storageKey?: string } = {},
): HTMLElement {
  const wrap = createElement(doc, "div", {
    marginTop: "4px",
    marginBottom: "8px",
  });
  wrap.className = "paperchat-stats-collapsible";

  const head = createElement(
    doc,
    "button",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      padding: "8px 0",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: theme.textPrimary,
      fontSize: "13px",
      fontWeight: "600",
      textAlign: "left",
    },
    { type: "button" },
  ) as HTMLButtonElement;

  const titleEl = createElement(doc, "span", {});
  titleEl.textContent = title;
  const chevron = createElement(doc, "span", {
    fontSize: "11px",
    color: theme.textMuted,
    transform: "rotate(0deg)",
    transition: "transform 0.15s ease",
  });
  chevron.textContent = "▾";
  chevron.className = "paperchat-stats-collapsible-chevron";
  head.appendChild(titleEl);
  head.appendChild(chevron);

  const body = createElement(doc, "div", {
    display: "block",
    overflow: "hidden",
  });
  body.className = "paperchat-stats-collapsible-body";
  body.appendChild(content);

  let collapsed = Boolean(options.defaultCollapsed);
  if (options.storageKey) {
    try {
      collapsed =
        (Zotero.Prefs.get(
          `extensions.${config.addonRef}.stats.${options.storageKey}`,
          true,
        ) as string) === "1";
    } catch {
      // ignore
    }
  }

  const apply = (): void => {
    body.style.display = collapsed ? "none" : "block";
    chevron.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
  };
  apply();

  head.addEventListener("click", () => {
    collapsed = !collapsed;
    apply();
    if (options.storageKey) {
      try {
        Zotero.Prefs.set(
          `extensions.${config.addonRef}.stats.${options.storageKey}`,
          collapsed ? "1" : "0",
          true,
        );
      } catch {
        // ignore
      }
    }
  });

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

export async function exportStatsJsonToClipboard(filename: string): Promise<boolean> {
  const path = PathUtils.join(Zotero.DataDirectory.dir, filename);
  try {
    if (!(await IOUtils.exists(path))) {
      return false;
    }
    const raw = await IOUtils.readJSON(path);
    const text = JSON.stringify(raw, null, 2);
    const clipboard =
      (Zotero.getMainWindow() as Window & { navigator?: Navigator })
        ?.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
    return false;
  } catch (error) {
    ztoolkit.log("[ReadingStats] Export failed:", error);
    return false;
  }
}

export function createReadingTrackerStatus(
  doc: Document,
  theme: ThemeColors,
  active: boolean,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
    padding: "0 2px",
    fontSize: "11px",
    lineHeight: "1.35",
    color: active ? (theme.sendButtonBg || "#16a34a") : theme.textMuted,
  });
  row.className = "paperchat-stats-tracker-status";
  const dot = createElement(doc, "span", {
    width: "6px",
    height: "6px",
    borderRadius: "999px",
    flexShrink: "0",
    background: active ? "#22c55e" : theme.textMuted,
    opacity: active ? "1" : "0.55",
  });
  row.appendChild(dot);
  const text = createElement(doc, "span", {});
  text.textContent = active
    ? getString("chat-stats-tracking-active")
    : getString("chat-stats-tracking-idle");
  row.appendChild(text);
  return row;
}

const STATS_LAYOUT_MEDIUM_MAX = 340;
const STATS_LAYOUT_NARROW_MAX = 260;

export type StatsPanelLayout = "wide" | "medium" | "narrow";

export function resolveStatsPanelLayout(width: number): StatsPanelLayout {
  if (width < STATS_LAYOUT_NARROW_MAX) {
    return "narrow";
  }
  if (width < STATS_LAYOUT_MEDIUM_MAX) {
    return "medium";
  }
  return "wide";
}

export function applyStatsPanelLayout(panel: HTMLElement): void {
  const body = panel.querySelector(
    "#chat-reading-stats-panel-body",
  ) as HTMLElement | null;
  const width = body?.clientWidth ?? panel.clientWidth;
  const layout = resolveStatsPanelLayout(width);
  panel.dataset.statsLayout = layout;

  const compactMonths = layout === "narrow" || layout === "medium";
  panel.querySelectorAll(".paperchat-stats-month-label").forEach((node) => {
    const label = node as HTMLElement;
    const full = label.dataset.fullLabel || label.textContent || "";
    const compact = label.dataset.compactLabel || full;
    label.textContent = compactMonths ? compact : full;
  });
}

export function bindStatsPanelResponsive(panel: HTMLElement): void {
  if (panel.dataset.statsResponsiveBound === "1") {
    applyStatsPanelLayout(panel);
    return;
  }
  panel.dataset.statsResponsiveBound = "1";

  const body = panel.querySelector(
    "#chat-reading-stats-panel-body",
  ) as HTMLElement | null;
  const target = body ?? panel;
  applyStatsPanelLayout(panel);

  const view = target.ownerDocument?.defaultView;
  const ResizeObserverCtor = view?.ResizeObserver;
  if (!ResizeObserverCtor) {
    return;
  }
  const observer = new ResizeObserverCtor(() => {
    applyStatsPanelLayout(panel);
  });
  observer.observe(target);
}

export { STATS_READING_FILE, STATS_TOKEN_FILE };
