import type { ChatSession } from "../../../types/chat";
import { getSessionContextUsage } from "../../chat/ContextManager";
import { getString } from "../../../utils/locale";
import { formatCompactTokenCount } from "../../../utils/tokens";
import type { ThemeColors } from "./types";

export { formatCompactTokenCount };

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const refreshTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function getContextRingTrackColor(theme: ThemeColors): string {
  return theme.borderColor;
}

function updateProgressRing(
  ring: SVGCircleElement,
  percent: number,
  theme: ThemeColors,
): void {
  const clamped = Math.min(100, Math.max(0, percent));
  ring.setAttribute(
    "stroke-dashoffset",
    String(RING_CIRCUMFERENCE * (1 - clamped / 100)),
  );
  ring.setAttribute("stroke", theme.textPrimary);
}

export function updateContextWindowUsageDisplay(
  container: HTMLElement,
  theme: ThemeColors,
  session: ChatSession | null,
): void {
  const root = container.querySelector(
    "#chat-context-usage",
  ) as HTMLElement | null;
  const button = container.querySelector(
    "#chat-context-usage-btn",
  ) as HTMLButtonElement | null;
  const tooltip = container.querySelector(
    "#chat-context-usage-tooltip",
  ) as HTMLElement | null;
  const titleEl = container.querySelector(
    "#chat-context-usage-title",
  ) as HTMLElement | null;
  const percentEl = container.querySelector(
    "#chat-context-usage-percent",
  ) as HTMLElement | null;
  const tokensEl = container.querySelector(
    "#chat-context-usage-tokens",
  ) as HTMLElement | null;
  const ringTrack = container.querySelector(
    "#chat-context-usage-ring-track",
  ) as SVGCircleElement | null;
  const ringProgress = container.querySelector(
    "#chat-context-usage-ring-progress",
  ) as SVGCircleElement | null;

  if (
    !root ||
    !button ||
    !tooltip ||
    !titleEl ||
    !percentEl ||
    !tokensEl ||
    !ringTrack ||
    !ringProgress
  ) {
    return;
  }

  const usage = getSessionContextUsage(session);
  if (!usage) {
    root.style.display = "none";
    button.setAttribute("aria-hidden", "true");
    return;
  }

  root.style.display = "inline-flex";
  button.removeAttribute("aria-hidden");
  ringTrack.setAttribute("stroke", getContextRingTrackColor(theme));
  updateProgressRing(ringProgress, usage.usedPercent, theme);

  titleEl.textContent = getString("chat-context-window-label");
  percentEl.textContent = getString("chat-context-window-used-percent", {
    args: {
      percent: String(usage.usedPercent),
      remaining: String(usage.remainingPercent),
    },
  });
  tokensEl.textContent = getString("chat-context-window-used-tokens", {
    args: {
      used: formatCompactTokenCount(usage.usedTokens),
      total: formatCompactTokenCount(usage.totalTokens),
    },
  });

  tooltip.style.background = theme.dropdownBg;
  tooltip.style.borderColor = theme.borderColor;
  tooltip.style.color = theme.textPrimary;
  tooltip.style.boxShadow = "0 10px 28px rgba(15, 23, 42, 0.16)";
  titleEl.style.color = theme.textPrimary;
  percentEl.style.color = theme.textSecondary;
  tokensEl.style.color = theme.textSecondary;

  const tooltipVisible = tooltip.style.display !== "none";
  if (tooltipVisible) {
    positionContextWindowUsageTooltip(container);
  }
}

export function scheduleContextWindowUsageRefresh(
  container: HTMLElement,
  theme: ThemeColors,
  session: ChatSession | null,
  delayMs = 120,
): void {
  const existing = refreshTimers.get(container);
  if (existing) {
    clearTimeout(existing);
  }
  refreshTimers.set(
    container,
    setTimeout(() => {
      refreshTimers.delete(container);
      updateContextWindowUsageDisplay(container, theme, session);
    }, delayMs),
  );
}

export function clearContextWindowUsageRefresh(container: HTMLElement): void {
  const existing = refreshTimers.get(container);
  if (existing) {
    clearTimeout(existing);
    refreshTimers.delete(container);
  }
}

export function positionContextWindowUsageTooltip(
  container: HTMLElement,
): void {
  const button = container.querySelector(
    "#chat-context-usage-btn",
  ) as HTMLElement | null;
  const tooltip = container.querySelector(
    "#chat-context-usage-tooltip",
  ) as HTMLElement | null;
  if (!button || !tooltip || tooltip.style.display === "none") {
    return;
  }

  const doc = container.ownerDocument;
  const rect = button.getBoundingClientRect();
  const win = doc.defaultView;
  const viewportWidth = win?.innerWidth ?? 320;
  const tooltipWidth = tooltip.offsetWidth || 220;
  const tooltipHeight = tooltip.offsetHeight || 88;
  const left = Math.max(
    8,
    Math.min(rect.left, viewportWidth - tooltipWidth - 8),
  );
  const top = Math.max(8, rect.top - tooltipHeight - 10);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
