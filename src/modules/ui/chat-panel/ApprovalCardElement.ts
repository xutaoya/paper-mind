import type { ToolApprovalState } from "../../../types/chat";
import type { ToolApprovalResolution } from "../../../types/tool";
import { getString } from "../../../utils/locale";
import { formatToolDisplayLabel } from "./MarkdownRenderer";
import {
  getAgentBadgeColors,
  getAgentUiSemanticColors,
  type AgentBadgeTone,
} from "./AgentUiTheme";
import { HTML_NS } from "./types";
import type { ThemeColors } from "./types";

type ToolApprovalRequest = ToolApprovalState["pendingRequests"][number];

export type ToolApprovalCardBanner = {
  kind: "waiting_approval" | "approval_resolved";
  title: string;
  detail: string;
  subdetail?: string;
  statusLabel?: string;
  accentColor?: string;
  approvalRequest?: ToolApprovalRequest;
};

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

function formatRiskLevel(
  riskLevel: ToolApprovalRequest["descriptor"]["riskLevel"],
): string {
  switch (riskLevel) {
    case "read":
      return getString("chat-banner-risk-read");
    case "network":
      return getString("chat-banner-risk-network");
    case "write":
      return getString("chat-banner-risk-write");
    case "memory":
      return getString("chat-banner-risk-memory");
    case "high_cost":
      return getString("chat-banner-risk-high-cost");
    default:
      return riskLevel;
  }
}

function summarizeApprovalArgs(args: Record<string, unknown>): string {
  if (typeof args.query === "string" && args.query.trim()) {
    return args.query.trim();
  }
  const entries = Object.entries(args).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) {
    return "—";
  }
  return entries
    .slice(0, 2)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${text.length > 48 ? `${text.slice(0, 48)}…` : text}`;
    })
    .join(" · ");
}

function createMetaRow(
  doc: Document,
  theme: ThemeColors,
  label: string,
  value: string,
): HTMLElement {
  const row = createElement(doc, "div", {
    display: "grid",
    gridTemplateColumns: "52px minmax(0, 1fr)",
    alignItems: "start",
    gap: "10px",
    padding: "4px 0",
    minWidth: "0",
  });
  const labelEl = createElement(doc, "span", {
    color: theme.textMuted,
    fontSize: "11px",
    lineHeight: "1.35",
  });
  labelEl.className = "paperchat-approval-card-meta-label";
  labelEl.textContent = label;
  const valueEl = createElement(doc, "span", {
    color: theme.textPrimary,
    fontSize: "11px",
    lineHeight: "1.35",
    minWidth: "0",
    wordBreak: "break-word",
    opacity: "0.88",
  });
  valueEl.className = "paperchat-approval-card-meta-value";
  valueEl.textContent = value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function createStatusBadge(
  doc: Document,
  label: string,
  tone: AgentBadgeTone,
): HTMLElement {
  const colors = getAgentBadgeColors(tone);

  const badge = createElement(doc, "span", {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 8px",
    borderRadius: "999px",
    border: `1px solid ${colors.border}`,
    background: colors.background,
    color: colors.color,
    fontSize: "11px",
    fontWeight: "600",
    lineHeight: "1.3",
    whiteSpace: "nowrap",
    flexShrink: "0",
  });
  badge.className = "paperchat-approval-status-badge";
  badge.setAttribute("data-badge-tone", tone);
  badge.textContent = label;
  return badge;
}

function createApprovalButton(
  doc: Document,
  theme: ThemeColors,
  label: string,
  variant: "primary" | "secondary" | "ghost",
  onClick?: () => void,
): HTMLButtonElement {
  const button = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "30px",
    padding: variant === "primary" ? "0 14px" : "0 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: variant === "primary" ? "600" : "500",
    lineHeight: "1.2",
    cursor: onClick ? "pointer" : "default",
    opacity: onClick ? "1" : "0.6",
    border:
      variant === "ghost"
        ? "1px solid transparent"
        : `1px solid ${theme.borderColor}`,
    background:
      variant === "primary"
        ? theme.sendButtonBg
        : variant === "secondary"
          ? theme.inputBg
          : "transparent",
    color:
      variant === "primary"
        ? theme.sendButtonText
        : variant === "ghost"
          ? theme.textMuted
          : theme.textPrimary,
    whiteSpace: "nowrap",
  });
  button.className = `paperchat-approval-card-btn paperchat-approval-card-btn--${variant}`;
  button.disabled = !onClick;
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

function createApprovalActions(
  doc: Document,
  theme: ThemeColors,
  request: ToolApprovalRequest,
  approvalActions?: {
    onResolveApproval: (
      requestId: string,
      resolution: ToolApprovalResolution,
    ) => void | Promise<void>;
  },
): HTMLElement {
  const actions = createElement(doc, "div", {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    marginTop: "12px",
  });

  const specs: Array<{
    label: string;
    resolution: ToolApprovalResolution;
    variant: "primary" | "secondary" | "ghost";
  }> = [
    {
      label: getString("chat-banner-allow-once"),
      resolution: { verdict: "allow", scope: "once" },
      variant: "primary",
    },
    {
      label: getString("chat-banner-session"),
      resolution: { verdict: "allow", scope: "session" },
      variant: "secondary",
    },
    {
      label: getString("chat-banner-always"),
      resolution: { verdict: "allow", scope: "always" },
      variant: "secondary",
    },
    {
      label: getString("chat-banner-deny"),
      resolution: { verdict: "deny", scope: "once" },
      variant: "ghost",
    },
  ];

  for (const spec of specs) {
    actions.appendChild(
      createApprovalButton(
        doc,
        theme,
        spec.label,
        spec.variant,
        approvalActions
          ? () => {
              void approvalActions.onResolveApproval(
                request.id,
                spec.resolution,
              );
            }
          : undefined,
      ),
    );
  }

  return actions;
}

export function createToolApprovalCardElement(
  doc: Document,
  theme: ThemeColors,
  banner: ToolApprovalCardBanner,
  approvalActions?: {
    onResolveApproval: (
      requestId: string,
      resolution: ToolApprovalResolution,
    ) => void | Promise<void>;
  },
): HTMLElement {
  const request = banner.approvalRequest;
  const isPending = banner.kind === "waiting_approval" && Boolean(request);
  const isResolved = banner.kind === "approval_resolved";
  const semantic = getAgentUiSemanticColors();
  const wasAllowed =
    isResolved &&
    (banner.accentColor === semantic.successStrong ||
      banner.accentColor === "#15803d");

  const card = createElement(
    doc,
    "div",
    {
      display: "flex",
      flexDirection: "column",
      gap: "0",
      padding: "12px 14px",
      borderRadius: "16px",
      background: theme.inputAreaBg,
      border: `1px solid ${theme.borderColor}`,
      boxSizing: "border-box",
      minWidth: "0",
    },
    {
      class: "paperchat-approval-card",
      "data-approval-card-kind": banner.kind,
      "data-approval-verdict": isResolved
        ? wasAllowed
          ? "allowed"
          : "denied"
        : "pending",
    },
  );

  const headerRow = createElement(doc, "div", {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    minWidth: "0",
  });

  const icon = createElement(doc, "span", {
    width: "18px",
    height: "18px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    fontSize: "13px",
    lineHeight: "1",
    color: isResolved
      ? wasAllowed
        ? semantic.successStrong
        : semantic.errorStrong
      : theme.textMuted,
    marginTop: "1px",
  });
  icon.className = "paperchat-approval-card-icon";
  icon.textContent = isResolved ? (wasAllowed ? "✓" : "×") : "◫";
  headerRow.appendChild(icon);

  const titleWrap = createElement(doc, "div", {
    display: "flex",
    flexDirection: "column",
    gap: "0",
    minWidth: "0",
    flex: "1",
  });

  const titleRow = createElement(doc, "div", {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    minWidth: "0",
  });

  const title = createElement(doc, "h3", {
    margin: "0",
    padding: "0",
    flex: "1",
    minWidth: "0",
    fontSize: "15px",
    fontWeight: "600",
    lineHeight: "1.35",
    color: theme.textPrimary,
  });
  title.textContent = isPending
    ? getString("chat-approval-card-title", {
        args: {
          tool: formatToolDisplayLabel(request!.toolName),
        },
      })
    : banner.title;

  titleRow.appendChild(title);

  if (banner.statusLabel) {
    titleRow.appendChild(
      createStatusBadge(
        doc,
        banner.statusLabel,
        isResolved ? (wasAllowed ? "success" : "error") : "pending",
      ),
    );
  }
  titleWrap.appendChild(titleRow);

  const descriptionText = isPending
    ? request!.descriptor.description || banner.detail
    : banner.detail;
  if (descriptionText) {
    const description = createElement(doc, "p", {
      margin: "4px 0 0",
      padding: "0",
      fontSize: "13px",
      lineHeight: "1.45",
      color: theme.textSecondary,
    });
    description.textContent = descriptionText;
    titleWrap.appendChild(description);
  }

  headerRow.appendChild(titleWrap);
  card.appendChild(headerRow);

  if (isPending && request) {
    const meta = createElement(doc, "div", {
      display: "flex",
      flexDirection: "column",
      gap: "0",
      marginTop: "10px",
      paddingTop: "8px",
      borderTop: `1px solid ${theme.borderColor}`,
    });
    meta.className = "paperchat-approval-card-meta";
    meta.appendChild(
      createMetaRow(
        doc,
        theme,
        getString("chat-approval-card-tool-label"),
        formatToolDisplayLabel(request.toolName),
      ),
    );
    meta.appendChild(
      createMetaRow(
        doc,
        theme,
        getString("chat-approval-card-risk-label"),
        formatRiskLevel(request.descriptor.riskLevel),
      ),
    );
    meta.appendChild(
      createMetaRow(
        doc,
        theme,
        getString("chat-approval-card-args-label"),
        summarizeApprovalArgs(request.request.args),
      ),
    );
    card.appendChild(meta);
    card.appendChild(
      createApprovalActions(doc, theme, request, approvalActions),
    );
  }

  if (isResolved) {
    const result = createElement(doc, "p", {
      margin: "8px 0 0",
      padding: "0",
      fontSize: "13px",
      lineHeight: "1.45",
      color: theme.textMuted,
    });
    result.textContent = banner.subdetail
      ? `${banner.detail} · ${banner.subdetail}`
      : banner.detail;
    card.appendChild(result);
  }

  return card;
}
