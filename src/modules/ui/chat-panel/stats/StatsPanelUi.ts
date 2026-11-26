import { config } from "../../../../../package.json";
import { getString } from "../../../../utils/locale";
import { createElement } from "../ChatPanelBuilder";
import { overlayPanelIconFilter } from "../OverlayPanelsTheme";
import { HTML_NS } from "../types";
import { createUiChevron, setUiChevronExpanded } from "../UiChevron";
import type { ThemeColors } from "../types";

const SVG_NS = "http://www.w3.org/2000/svg";
const STATS_READING_FILE = "paperchat-reading-stats.json";
const STATS_TOKEN_FILE = "paperchat-token-stats.json";

export type StatsPanelView = "reading" | "chat" | "tokens";

export type StatsIconKind =
  | "chart"
  | "refresh"
  | "close"
  | "help"
  | "reading"
  | "chat"
  | "tokens";

export function createStatsSvgIcon(
  doc: Document,
  kind: StatsIconKind,
  size = 15,
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `paperchat-stats-svg-icon is-${kind}`);

  const appendPath = (
    d: string,
    options: { strokeWidth?: string; fill?: string; opacity?: string } = {},
  ): void => {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    if (options.fill) {
      path.setAttribute("fill", options.fill);
    } else {
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", options.strokeWidth || "1.5");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    if (options.opacity) {
      path.setAttribute("opacity", options.opacity);
    }
    svg.appendChild(path);
  };

  if (kind === "chart") {
    const bars: Array<[string, string, string, string, string]> = [
      ["2", "8.5", "2.8", "5.5", "0.72"],
      ["6.6", "5.2", "2.8", "8.8", "0.86"],
      ["11.2", "2.2", "2.8", "11.8", "1"],
    ];
    for (const [x, y, width, height, opacity] of bars) {
      const rect = doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", width);
      rect.setAttribute("height", height);
      rect.setAttribute("rx", "1");
      rect.setAttribute("fill", "currentColor");
      rect.setAttribute("opacity", opacity);
      svg.appendChild(rect);
    }
    return svg;
  }

  if (kind === "refresh") {
    appendPath("M13.2 4.2v3.3H9.9", { strokeWidth: "1.55" });
    appendPath("M2.8 11.8V8.5h3.3", { strokeWidth: "1.55" });
    appendPath(
      "M12.9 7.5A5.2 5.2 0 0 0 4.2 4.4L3.1 5.5M3.1 8.5a5.2 5.2 0 0 0 8.7 3.1l1.1-1.1",
      { strokeWidth: "1.55" },
    );
    return svg;
  }

  if (kind === "close") {
    appendPath("M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6", {
      strokeWidth: "1.6",
    });
    return svg;
  }

  if (kind === "help") {
    const circle = doc.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "8");
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "6");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.45");
    svg.appendChild(circle);
    appendPath("M6.4 6.3a1.7 1.7 0 1 1 2.4 1.55c-.55.3-.8.65-.8 1.25", {
      strokeWidth: "1.45",
    });
    const dot = doc.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "8");
    dot.setAttribute("cy", "11.35");
    dot.setAttribute("r", "0.8");
    dot.setAttribute("fill", "currentColor");
    svg.appendChild(dot);
    return svg;
  }

  if (kind === "reading") {
    appendPath(
      "M2.3 3.6c1.8-.4 3.6-.1 5.7 1.1 2.1-1.2 3.9-1.5 5.7-1.1v8.7c-1.8-.35-3.6-.05-5.7 1.05-2.1-1.1-3.9-1.4-5.7-1.05V3.6Z",
      { strokeWidth: "1.4" },
    );
    appendPath("M8 4.7v8.6", { strokeWidth: "1.35" });
    return svg;
  }

  if (kind === "chat") {
    appendPath(
      "M3 3.4h10a1.4 1.4 0 0 1 1.4 1.4v5.4a1.4 1.4 0 0 1-1.4 1.4H6.6L3.4 13.8v-2.2H3a1.4 1.4 0 0 1-1.4-1.4V4.8A1.4 1.4 0 0 1 3 3.4Z",
      { strokeWidth: "1.4" },
    );
    return svg;
  }

  // tokens
  appendPath("M8 2.1 13.6 5.3 8 8.5 2.4 5.3 8 2.1Z", { strokeWidth: "1.4" });
  appendPath("M2.4 8.2 8 11.4l5.6-3.2", { strokeWidth: "1.4" });
  appendPath("M2.4 10.9 8 14.1l5.6-3.2", {
    strokeWidth: "1.4",
    opacity: "0.75",
  });
  return svg;
}

export function getLocalizedWeekdayLabels(): string[] {
  const base = new Date(2024, 0, 7);
  const labels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    try {
      labels.push(date.toLocaleDateString(undefined, { weekday: "narrow" }));
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

export function formatBarAxisDayLabel(date: Date, showMonth: boolean): string {
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

  const updated = createElement(doc, "span", {});
  updated.className = "paperchat-stats-updated-at";
  updated.textContent = formatUpdatedAt(options.updatedAt);
  toolsHost.appendChild(updated);

  toolsHost.appendChild(
    createIconToolButton(doc, getString("chat-stats-refresh"), () => {
      options.onRefresh();
    }),
  );
  toolsHost.appendChild(
    createIconToolButton(
      doc,
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
      getString("chat-stats-export-token-short"),
      () => {
        options.onExportToken();
      },
      getString("chat-stats-export-token"),
    ),
  );
  toolsHost.appendChild(
    createIconToolButton(doc, getString("chat-stats-help"), () => {
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
  label: string,
  onClick: () => void,
  tooltip?: string,
): HTMLButtonElement {
  const hint = tooltip || label;
  const button = createElement(
    doc,
    "button",
    {},
    {
      type: "button",
      class: "paperchat-stats-pill-action-btn",
      title: hint,
      "aria-label": hint,
    },
  ) as HTMLButtonElement;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

const STATS_HELP_ID = "paperchat-stats-help-popover";

export function toggleStatsHelpPopover(
  anchor: HTMLElement,
  doc: Document,
  _theme: ThemeColors,
  text: string,
): void {
  const existing = anchor.querySelector(`#${STATS_HELP_ID}`);
  if (existing) {
    existing.remove();
    return;
  }
  if (!text.trim()) {
    return;
  }
  const pop = createElement(
    doc,
    "div",
    {},
    {
      id: STATS_HELP_ID,
      class: "paperchat-stats-help-popover",
      role: "dialog",
    },
  );
  pop.textContent = text;
  const mount =
    (anchor.querySelector(".paperchat-stats-header-actions") as HTMLElement) ||
    anchor;
  mount.style.position = "relative";
  mount.appendChild(pop);
  const dismiss = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(`#${STATS_HELP_ID}`) ||
      target?.closest("[data-stats-help-trigger]")
    ) {
      return;
    }
    pop.remove();
    doc.removeEventListener("mousedown", dismiss, true);
  };
  doc.addEventListener("mousedown", dismiss, true);
}

export function createCollapsibleSection(
  doc: Document,
  _theme: ThemeColors,
  title: string,
  content: HTMLElement,
  options: {
    defaultCollapsed?: boolean;
    storageKey?: string;
    badge?: string;
  } = {},
): HTMLElement {
  const wrap = createElement(doc, "section", {});
  wrap.className = "paperchat-stats-card paperchat-stats-collapsible";

  const head = createElement(
    doc,
    "button",
    {},
    {
      type: "button",
      class: "paperchat-stats-collapsible-trigger",
    },
  ) as HTMLButtonElement;

  const titleGroup = createElement(
    doc,
    "span",
    {},
    { class: "paperchat-stats-collapsible-heading" },
  );
  const titleEl = createElement(
    doc,
    "span",
    {},
    { class: "paperchat-stats-section-title" },
  );
  titleEl.textContent = title;
  titleGroup.appendChild(titleEl);

  if (options.badge) {
    const badgeEl = createElement(
      doc,
      "span",
      {},
      { class: "paperchat-stats-card-badge" },
    );
    badgeEl.textContent = options.badge;
    titleGroup.appendChild(badgeEl);
  }

  const chevron = createUiChevron(doc, {
    className: "paperchat-stats-collapsible-chevron",
    kind: "right",
    size: 15,
    color: "currentColor",
    opacity: 0.65,
  });
  head.appendChild(titleGroup);
  head.appendChild(chevron);

  const body = createElement(doc, "div", {});
  body.className = "paperchat-stats-collapsible-body";
  body.appendChild(content);

  let collapsed = Boolean(options.defaultCollapsed);
  if (options.storageKey) {
    try {
      const stored = Zotero.Prefs.get(
        `extensions.${config.addonRef}.stats.${options.storageKey}`,
        true,
      ) as string | undefined;
      if (stored === "1" || stored === "0") {
        collapsed = stored === "1";
      }
    } catch {
      // ignore
    }
  }

  const apply = (): void => {
    wrap.dataset.collapsed = collapsed ? "true" : "false";
    body.style.display = collapsed ? "none" : "block";
    head.setAttribute("aria-expanded", String(!collapsed));
    setUiChevronExpanded(chevron, !collapsed);
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

export async function exportStatsJsonToClipboard(
  filename: string,
): Promise<boolean> {
  const path = PathUtils.join(Zotero.DataDirectory.dir, filename);
  try {
    if (!(await IOUtils.exists(path))) {
      return false;
    }
    const raw = await IOUtils.readJSON(path);
    const text = JSON.stringify(raw, null, 2);
    const clipboard = (
      Zotero.getMainWindow() as Window & { navigator?: Navigator }
    )?.navigator?.clipboard;
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
  const row = createElement(doc, "div", {});
  row.className = "paperchat-stats-tracker-status";
  fillReadingTrackerStatus(row, doc, theme, active);
  return row;
}

export function fillReadingTrackerStatus(
  host: HTMLElement,
  doc: Document,
  _theme: ThemeColors,
  active: boolean,
): void {
  host.textContent = "";
  host.dataset.tracking = active ? "active" : "paused";
  const dot = createElement(
    doc,
    "span",
    {},
    {
      class: "paperchat-stats-status-dot",
      "data-active": active ? "true" : "false",
    },
  );
  host.appendChild(dot);
  const text = createElement(
    doc,
    "span",
    {},
    { class: "paperchat-stats-status-text" },
  );
  text.textContent = active
    ? getString("chat-stats-tracking-active")
    : getString("chat-stats-tracking-paused");
  host.title = active
    ? getString("chat-stats-tracking-active")
    : getString("chat-stats-tracking-idle");
  host.appendChild(text);
}

export function updateStatsPanelSubtitle(
  subtitle: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  view: StatsPanelView,
  trackingActive: boolean,
): void {
  if (view === "tokens") {
    subtitle.className = "paperchat-stats-panel-subtitle";
    delete subtitle.dataset.tracking;
    subtitle.textContent = getString("chat-stats-header-subtitle-tokens");
    subtitle.removeAttribute?.("title");
    return;
  }
  if (view === "chat") {
    subtitle.className = "paperchat-stats-panel-subtitle";
    delete subtitle.dataset.tracking;
    subtitle.textContent = getString("chat-stats-header-subtitle-chat");
    subtitle.removeAttribute?.("title");
    return;
  }
  subtitle.className =
    "paperchat-stats-panel-subtitle paperchat-stats-panel-subtitle--status";
  fillReadingTrackerStatus(subtitle, doc, theme, trackingActive);
}

function resolveIconKind(iconFile: string): StatsIconKind | null {
  if (iconFile === "refresh.svg") return "refresh";
  if (iconFile === "close.svg") return "close";
  if (iconFile === "help.svg") return "help";
  if (iconFile === "chart.svg") return "chart";
  return null;
}

export function createStatsToolbarIconButton(
  doc: Document,
  theme: ThemeColors,
  iconFile: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = createElement(
    doc,
    "button",
    {},
    {
      type: "button",
      class: "paperchat-stats-icon-btn",
      title: label,
      "aria-label": label,
    },
  ) as HTMLButtonElement;

  const knownKind = resolveIconKind(iconFile);
  if (knownKind) {
    button.appendChild(
      createStatsSvgIcon(doc, knownKind, knownKind === "close" ? 14 : 15),
    );
  } else {
    const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
    icon.src = `chrome://${config.addonRef}/content/icons/${iconFile}`;
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    Object.assign(icon.style, {
      width: "15px",
      height: "15px",
      display: "block",
      opacity: "0.82",
      filter: overlayPanelIconFilter(theme),
    });
    button.appendChild(icon);
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (knownKind === "refresh") {
      button.classList.remove("is-spinning");
      void button.offsetWidth;
      button.classList.add("is-spinning");
      doc.defaultView?.setTimeout(() => {
        button.classList.remove("is-spinning");
      }, 520);
    }
    onClick();
  });
  return button;
}

const STATS_LAYOUT_MEDIUM_MAX = 350;
const STATS_LAYOUT_NARROW_MAX = 270;

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
