/**
 * Shared semantic colors and theme refresh for beUI-style agent UI surfaces.
 */

import { isDarkMode } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

export type AgentBadgeTone = "pending" | "success" | "error";

export interface AgentBadgeColors {
  color: string;
  border: string;
  background: string;
}

export interface AgentUiSemanticColors {
  success: string;
  successStrong: string;
  error: string;
  errorStrong: string;
  warning: string;
  cancelled: string;
  running: string;
  successSurface: string;
  errorSurface: string;
  toolResultPanelBg: string;
  toolResultPanelBorder: string;
  toolResultTextOpacity: string;
}

const agentUiSemanticColors = {
  light: {
    success: "#16a34a",
    successStrong: "#15803d",
    error: "#dc2626",
    errorStrong: "#b91c1c",
    warning: "#b45309",
    cancelled: "#e11d48",
    running: "#2563eb",
    successSurface: "rgba(34, 197, 94, 0.16)",
    errorSurface: "rgba(239, 68, 68, 0.14)",
    toolResultPanelBg: "rgba(15, 23, 42, 0.05)",
    toolResultPanelBorder: "rgba(15, 23, 42, 0.08)",
    toolResultTextOpacity: "0.88",
  },
  dark: {
    success: "#4ade80",
    successStrong: "#86efac",
    error: "#f87171",
    errorStrong: "#fca5a5",
    warning: "#fbbf24",
    cancelled: "#fb7185",
    running: "#60a5fa",
    successSurface: "rgba(74, 222, 128, 0.14)",
    errorSurface: "rgba(248, 113, 113, 0.14)",
    toolResultPanelBg: "rgba(255, 255, 255, 0.06)",
    toolResultPanelBorder: "rgba(255, 255, 255, 0.1)",
    toolResultTextOpacity: "0.9",
  },
} satisfies Record<"light" | "dark", AgentUiSemanticColors>;

const agentBadgeColors = {
  light: {
    pending: {
      color: "#b45309",
      border: "rgba(245, 158, 11, 0.3)",
      background: "rgba(245, 158, 11, 0.1)",
    },
    success: {
      color: "#15803d",
      border: "rgba(34, 197, 94, 0.3)",
      background: "rgba(34, 197, 94, 0.1)",
    },
    error: {
      color: "#b91c1c",
      border: "rgba(239, 68, 68, 0.3)",
      background: "rgba(239, 68, 68, 0.1)",
    },
  },
  dark: {
    pending: {
      color: "#fbbf24",
      border: "rgba(251, 191, 36, 0.28)",
      background: "rgba(251, 191, 36, 0.12)",
    },
    success: {
      color: "#86efac",
      border: "rgba(74, 222, 128, 0.28)",
      background: "rgba(74, 222, 128, 0.12)",
    },
    error: {
      color: "#fca5a5",
      border: "rgba(248, 113, 113, 0.28)",
      background: "rgba(248, 113, 113, 0.12)",
    },
  },
} satisfies Record<"light" | "dark", Record<AgentBadgeTone, AgentBadgeColors>>;

export function getAgentUiSemanticColors(): AgentUiSemanticColors {
  return isDarkMode()
    ? agentUiSemanticColors.dark
    : agentUiSemanticColors.light;
}

export function getAgentBadgeColors(tone: AgentBadgeTone): AgentBadgeColors {
  const palette = isDarkMode() ? agentBadgeColors.dark : agentBadgeColors.light;
  return palette[tone];
}

export function applyAgentActivityTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const dark = isDarkMode();
  container.querySelectorAll(".paperchat-agent-activity").forEach((node) => {
    const panel = node as HTMLElement;
    panel.classList.toggle("paperchat-agent-activity--dark", dark);

    const summary = panel.querySelector(
      ".paperchat-agent-activity-summary",
    ) as HTMLElement | null;
    if (summary) {
      summary.style.color = theme.textMuted;
    }

    panel.querySelectorAll(".paperchat-agent-activity-live-tokens").forEach(
      (token) => {
        (token as HTMLElement).style.color = theme.textMuted;
      },
    );

    panel.querySelectorAll(".paperchat-agent-activity-text-row").forEach(
      (row) => {
        (row as HTMLElement).style.color = theme.textMuted;
      },
    );

    panel
      .querySelectorAll(".paperchat-agent-activity-reasoning-stream")
      .forEach((row) => {
        (row as HTMLElement).style.color = theme.textMuted;
      });
  });
}

export function applySearchActivityTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const semantic = getAgentUiSemanticColors();
  container
    .querySelectorAll(".paperchat-agent-activity-search-row")
    .forEach((row) => {
      const el = row as HTMLElement;
      el.querySelectorAll("[data-agent-tool-status-text]").forEach((status) => {
        (status as HTMLElement).style.color = semantic.error;
      });
      el.querySelectorAll(".paperchat-search-query-text").forEach((node) => {
        (node as HTMLElement).style.color = theme.textSecondary;
      });
      el.querySelectorAll(".paperchat-search-source-title").forEach((node) => {
        (node as HTMLElement).style.color = theme.textPrimary;
      });
      el.querySelectorAll(".paperchat-search-source-domain").forEach((node) => {
        (node as HTMLElement).style.color = theme.textMuted;
      });
    });
}

export function getExecutionPlanCardSurface(theme: ThemeColors): {
  background: string;
  border: string;
  boxShadow: string;
} {
  const dark = isDarkMode() || theme.containerBg === "#1e1e1e";
  if (dark) {
    return {
      background: "rgba(255, 255, 255, 0.05)",
      border: "rgba(255, 255, 255, 0.12)",
      boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
    };
  }
  return {
    background: theme.toolbarBg,
    border: "rgba(15, 23, 42, 0.1)",
    boxShadow:
      "0 1px 2px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.03)",
  };
}

export function applyTodoListTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const semantic = getAgentUiSemanticColors();
  const surface = getExecutionPlanCardSurface(theme);
  container.querySelectorAll(".paperchat-todo-list-root").forEach((node) => {
    const root = node as HTMLElement;
    root.style.background = surface.background;
    root.style.borderColor = surface.border;
    root.style.boxShadow = surface.boxShadow;

    const title = root.querySelector(".paperchat-todo-list-title") as
      | HTMLElement
      | null;
    if (title) {
      title.style.color = theme.textPrimary;
    }

    const count = root.querySelector(".paperchat-todo-list-count") as
      | HTMLElement
      | null;
    if (count) {
      const allComplete = root.getAttribute("data-all-complete") === "true";
      count.style.color = allComplete ? semantic.success : theme.textMuted;
    }

    const chevron = root.querySelector(".paperchat-todo-list-chevron") as
      | HTMLElement
      | null;
    if (chevron) {
      chevron.style.color = theme.textMuted;
    }

    const headerIcon = root.querySelector(".paperchat-todo-header-icon") as
      | HTMLElement
      | null;
    if (headerIcon) {
      const allComplete = root.getAttribute("data-all-complete") === "true";
      headerIcon.style.color = allComplete ? semantic.success : theme.textMuted;
    }

    root.querySelectorAll(".paperchat-todo-item").forEach((item) => {
      const row = item as HTMLElement;
      const status = row.getAttribute("data-todo-status");
      const titleWrap = row.querySelector("span:nth-child(2)") as
        | HTMLElement
        | null;
      const detail = row.querySelector("span:nth-child(3)") as HTMLElement | null;
      const icon = row.querySelector(".paperchat-todo-status-icon") as
        | SVGSVGElement
        | null;

      if (icon) {
        icon.style.color =
          status === "cancelled"
            ? semantic.cancelled
            : status === "in-progress"
              ? theme.textPrimary
              : theme.textMuted;
      }

      if (titleWrap) {
        titleWrap.style.color =
          status === "pending" || status === "completed" || status === "cancelled"
            ? theme.textMuted
            : theme.textPrimary;
      }

      if (detail) {
        detail.style.color = theme.textMuted;
      }
    });
  });
}

export function applyApprovalCardTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const semantic = getAgentUiSemanticColors();
  container.querySelectorAll(".paperchat-approval-card").forEach((node) => {
    const card = node as HTMLElement;
    card.style.background = theme.inputAreaBg;
    card.style.borderColor = theme.borderColor;

    const verdict = card.getAttribute("data-approval-verdict");
    const icon = card.querySelector(".paperchat-approval-card-icon") as
      | HTMLElement
      | null;
    if (icon) {
      icon.style.color =
        verdict === "allowed"
          ? semantic.successStrong
          : verdict === "denied"
            ? semantic.errorStrong
            : theme.textMuted;
    }

    card.querySelectorAll("h3, p, span").forEach((textNode) => {
      const el = textNode as HTMLElement;
      if (el.classList.contains("paperchat-approval-status-badge")) {
        return;
      }
      if (el.tagName === "H3") {
        el.style.color = theme.textPrimary;
        return;
      }
      if (el.closest(".paperchat-approval-card-meta-label")) {
        el.style.color = theme.textMuted;
        return;
      }
      if (el.closest(".paperchat-approval-card-meta-value")) {
        el.style.color = theme.textPrimary;
        return;
      }
      if (el.tagName === "P") {
        el.style.color =
          card.getAttribute("data-approval-card-kind") === "approval_resolved"
            ? theme.textMuted
            : theme.textSecondary;
      }
    });

    card.querySelectorAll(".paperchat-approval-status-badge").forEach(
      (badge) => {
        const el = badge as HTMLElement;
        const tone = (el.getAttribute("data-badge-tone") ||
          "pending") as AgentBadgeTone;
        const colors = getAgentBadgeColors(tone);
        el.style.color = colors.color;
        el.style.borderColor = colors.border;
        el.style.background = colors.background;
      },
    );

    const meta = card.querySelector(".paperchat-approval-card-meta") as
      | HTMLElement
      | null;
    if (meta) {
      meta.style.borderTopColor = theme.borderColor;
    }

    card.querySelectorAll(".paperchat-approval-card-btn").forEach((btn) => {
      const button = btn as HTMLButtonElement;
      const variant = button.className.includes("--primary")
        ? "primary"
        : button.className.includes("--ghost")
          ? "ghost"
          : "secondary";
      if (variant === "primary") {
        button.style.background = theme.sendButtonBg;
        button.style.color = theme.sendButtonText;
        button.style.borderColor = theme.borderColor;
      } else if (variant === "ghost") {
        button.style.color = theme.textMuted;
      } else {
        button.style.background = theme.inputBg;
        button.style.color = theme.textPrimary;
        button.style.borderColor = theme.borderColor;
      }
    });
  });
}

export function applyMessageTimeSeparatorTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  container.querySelectorAll(".chat-message-time-separator").forEach((node) => {
    (node as HTMLElement).style.color = theme.textMuted;
  });
}

export function applyAgentUiTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  applyAgentActivityTheme(container, theme);
  applySearchActivityTheme(container, theme);
  applyTodoListTheme(container, theme);
  applyApprovalCardTheme(container, theme);
  applyMessageTimeSeparatorTheme(container, theme);
}
