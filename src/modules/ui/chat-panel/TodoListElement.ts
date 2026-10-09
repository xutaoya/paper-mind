import type {
  ExecutionPlan,
  ExecutionPlanStatus,
  ExecutionPlanStep,
  ExecutionPlanStepStatus,
} from "../../../types/chat";
import { getString } from "../../../utils/locale";
import {
  getAgentUiSemanticColors,
  getExecutionPlanCardSurface,
} from "./AgentUiTheme";
import { HTML_NS } from "./types";
import { createUiChevron, setUiChevronExpanded } from "./UiChevron";
import type { ThemeColors } from "./types";

export type TodoItemStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "cancelled";

export interface TodoListItem {
  id: string;
  title: string;
  status: TodoItemStatus;
  detail?: string;
}

const TODO_LIST_ROOT_CLASS = "paperchat-todo-list-root";
const TODO_LIST_MAX_HEIGHT_PX = 248;
const RECOVERY_STEP_PREFIX = "replan:";

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

function prefersReducedMotion(doc: Document): boolean {
  const view = (doc.defaultView ?? Zotero.getMainWindow()) as Window | null;
  return Boolean(view?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

export function mapStepStatusToTodoStatus(
  status: ExecutionPlanStepStatus,
): TodoItemStatus {
  switch (status) {
    case "in_progress":
      return "in-progress";
    case "completed":
      return "completed";
    case "denied":
    case "failed":
      return "cancelled";
    default:
      return "pending";
  }
}

export function mapExecutionPlanToTodoItems(
  plan: ExecutionPlan,
): TodoListItem[] {
  return plan.steps.map((step) => mapExecutionStepToTodoItem(step));
}

function mapExecutionStepToTodoItem(step: ExecutionPlanStep): TodoListItem {
  const status = mapStepStatusToTodoStatus(step.status);
  const title =
    step.title?.trim() ||
    step.toolName?.trim() ||
    getString("chat-todo-list-untitled-step");
  const detail =
    status === "cancelled"
      ? step.error || step.detail
      : status === "in-progress"
        ? step.detail
        : undefined;

  return {
    id: step.id,
    title,
    status,
    detail: detail?.trim() || undefined,
  };
}

function createStatusIcon(
  doc: Document,
  theme: ThemeColors,
  status: TodoItemStatus,
): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("paperchat-todo-status-icon");
  svg.classList.add(`paperchat-todo-status-icon--${status}`);

  const baseCircle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
  baseCircle.setAttribute("cx", "12");
  baseCircle.setAttribute("cy", "12");
  baseCircle.setAttribute("r", "9");
  baseCircle.setAttribute("fill", "none");
  baseCircle.setAttribute("stroke", "currentColor");
  baseCircle.setAttribute("stroke-width", "1.5");
  if (status === "pending") {
    baseCircle.setAttribute("stroke-dasharray", "2 3");
  }
  svg.appendChild(baseCircle);

  if (status === "in-progress") {
    const arc = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    arc.setAttribute("cx", "12");
    arc.setAttribute("cy", "12");
    arc.setAttribute("r", "9");
    arc.setAttribute("fill", "none");
    arc.setAttribute("stroke", "currentColor");
    arc.setAttribute("stroke-width", "2");
    arc.setAttribute("stroke-linecap", "round");
    arc.classList.add("paperchat-todo-status-arc");
    svg.appendChild(arc);
  }

  if (status === "completed") {
    const check = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    check.setAttribute("d", "M7.5 12.25 10.5 15.25 16.75 8.75");
    check.setAttribute("fill", "none");
    check.setAttribute("stroke", "currentColor");
    check.setAttribute("stroke-width", "2");
    check.setAttribute("stroke-linecap", "round");
    check.setAttribute("stroke-linejoin", "round");
    svg.appendChild(check);
  }

  if (status === "cancelled") {
    const cross = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    cross.setAttribute("d", "M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5");
    cross.setAttribute("fill", "none");
    cross.setAttribute("stroke", "currentColor");
    cross.setAttribute("stroke-width", "2");
    cross.setAttribute("stroke-linecap", "round");
    svg.appendChild(cross);
  }

  svg.style.color =
    status === "cancelled"
      ? getAgentUiSemanticColors().cancelled
      : status === "in-progress"
        ? theme.textPrimary
        : theme.textMuted;

  return svg;
}

function createHeaderIcon(
  doc: Document,
  theme: ThemeColors,
  allComplete: boolean,
): HTMLElement {
  const semantic = getAgentUiSemanticColors();
  const wrap = createElement(doc, "span", {
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    fontSize: "14px",
    lineHeight: "1",
  });
  wrap.className = "paperchat-todo-header-icon";
  wrap.textContent = allComplete ? "✓" : "☰";
  wrap.style.color = allComplete ? semantic.success : theme.textMuted;
  return wrap;
}

function renderTodoItems(
  doc: Document,
  theme: ThemeColors,
  list: HTMLOListElement,
  items: TodoListItem[],
): void {
  list.replaceChildren();

  for (const item of items) {
    const row = createElement(doc, "li", {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      minHeight: "36px",
      padding: "4px 6px",
      borderRadius: "12px",
      minWidth: "0",
    });
    row.className = "paperchat-todo-item";
    row.setAttribute("data-todo-status", item.status);

    row.appendChild(createStatusIcon(doc, theme, item.status));

    const titleWrap = createElement(doc, "span", {
      flex: "1",
      minWidth: "0",
      fontSize: "13px",
      lineHeight: "1.35",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color:
        item.status === "pending"
          ? theme.textMuted
          : item.status === "completed" || item.status === "cancelled"
            ? theme.textMuted
            : theme.textPrimary,
      opacity:
        item.status === "completed"
          ? "0.72"
          : item.status === "cancelled"
            ? "0.65"
            : item.status === "pending"
              ? "0.8"
              : "1",
      textDecoration: item.status === "completed" ? "line-through" : "none",
    });
    titleWrap.textContent = item.title;
    row.appendChild(titleWrap);

    if (item.detail) {
      const detail = createElement(doc, "span", {
        flexShrink: "0",
        maxWidth: "42%",
        fontSize: "12px",
        lineHeight: "1.35",
        color: theme.textMuted,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        opacity: "0.72",
      });
      detail.textContent = item.detail;
      row.appendChild(detail);
    }

    list.appendChild(row);
  }
}

function scrollTodoViewportToEnd(viewport: HTMLElement, doc: Document): void {
  const reduce = prefersReducedMotion(doc);
  if (viewport.scrollHeight <= viewport.clientHeight) {
    return;
  }
  if (typeof viewport.scrollTo === "function") {
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: reduce ? "auto" : "smooth",
    });
    return;
  }
  viewport.scrollTop = viewport.scrollHeight;
}

function resolvePlanTitle(plan: ExecutionPlan): string {
  const summary = plan.summary?.trim();
  if (summary) {
    return summary;
  }
  const hasRecovery = plan.steps.some((step) =>
    step.id.startsWith(RECOVERY_STEP_PREFIX),
  );
  if (hasRecovery) {
    return getString("chat-todo-list-recovering-title");
  }
  return getString("chat-todo-list-title");
}

export function collapseTodoListElement(root: HTMLElement): void {
  if (root.getAttribute("data-open") === "false") {
    return;
  }
  root.setAttribute("data-user-open", "false");
  root.setAttribute("data-open", "false");
  applyTodoListOpenUi(root);
}

function applyTodoListOpenUi(root: HTMLElement): void {
  const open = root.getAttribute("data-open") !== "false";
  const chevron = root.querySelector(
    ".paperchat-todo-list-chevron",
  ) as HTMLElement | null;
  if (chevron) {
    setUiChevronExpanded(chevron, open);
  }

  const body = root.querySelector(
    ".paperchat-todo-list-body",
  ) as HTMLElement | null;
  if (body) {
    body.style.maxHeight = open ? `${TODO_LIST_MAX_HEIGHT_PX}px` : "0px";
    body.style.opacity = open ? "1" : "0";
  }

  const trigger = root.querySelector(
    ".paperchat-todo-list-trigger",
  ) as HTMLElement | null;
  trigger?.setAttribute("aria-expanded", open ? "true" : "false");
}

function syncTodoListOpenState(
  root: HTMLElement,
  allComplete: boolean,
  collapseOnComplete: boolean,
  planStatus: ExecutionPlanStatus,
): void {
  const wasComplete = root.getAttribute("data-all-complete") === "true";
  const userOpen = root.getAttribute("data-user-open");
  let open =
    userOpen === "true"
      ? true
      : userOpen === "false"
        ? false
        : root.getAttribute("data-open") !== "false";

  const shouldCollapse =
    allComplete && collapseOnComplete && planStatus === "completed";
  if (!wasComplete && shouldCollapse) {
    open = false;
    root.setAttribute("data-user-open", "false");
  }
  if (wasComplete && !allComplete) {
    open = true;
    root.removeAttribute("data-user-open");
  }

  root.setAttribute("data-open", open ? "true" : "false");
  root.setAttribute("data-all-complete", allComplete ? "true" : "false");
  applyTodoListOpenUi(root);
}

function syncTodoListContent(
  root: HTMLElement,
  doc: Document,
  theme: ThemeColors,
  plan: ExecutionPlan,
): void {
  const items = mapExecutionPlanToTodoItems(plan);
  const completed = items.filter((item) => item.status === "completed").length;
  const allComplete = items.length > 0 && completed === items.length;
  const collapseOnComplete = root.getAttribute("data-collapse-on-complete") !== "false";

  const titleEl = root.querySelector(
    ".paperchat-todo-list-title",
  ) as HTMLElement | null;
  if (titleEl) {
    titleEl.textContent = resolvePlanTitle(plan);
  }

  const countEl = root.querySelector(
    ".paperchat-todo-list-count",
  ) as HTMLElement | null;
  if (countEl) {
    const semantic = getAgentUiSemanticColors();
    countEl.textContent = `${completed}/${items.length}`;
    countEl.style.color = allComplete ? semantic.success : theme.textMuted;
    countEl.setAttribute("data-complete", allComplete ? "true" : "false");
  }

  const headerIcon = root.querySelector(
    ".paperchat-todo-header-icon",
  ) as HTMLElement | null;
  if (headerIcon) {
    const semantic = getAgentUiSemanticColors();
    headerIcon.textContent = allComplete ? "✓" : "☰";
    headerIcon.style.color = allComplete ? semantic.success : theme.textMuted;
    headerIcon.setAttribute("data-complete", allComplete ? "true" : "false");
  }

  const list = root.querySelector(
    ".paperchat-todo-list-items",
  ) as HTMLOListElement | null;
  if (list) {
    const previousCount = Number(root.getAttribute("data-item-count") || "0");
    renderTodoItems(doc, theme, list, items);
    root.setAttribute("data-item-count", String(items.length));
    if (items.length !== previousCount) {
      const viewport = root.querySelector(
        ".paperchat-todo-list-viewport",
      ) as HTMLElement | null;
      if (viewport) {
        scrollTodoViewportToEnd(viewport, doc);
      }
    }
  }

  syncTodoListOpenState(root, allComplete, collapseOnComplete, plan.status);
}

export function createTodoListElement(
  doc: Document,
  theme: ThemeColors,
  plan: ExecutionPlan,
  options?: {
    defaultOpen?: boolean;
    collapseOnComplete?: boolean;
  },
): HTMLElement {
  const defaultOpen = options?.defaultOpen ?? true;
  const collapseOnComplete = options?.collapseOnComplete ?? true;
  const items = mapExecutionPlanToTodoItems(plan);
  const completed = items.filter((item) => item.status === "completed").length;
  const allComplete = items.length > 0 && completed === items.length;
  const surface = getExecutionPlanCardSurface(theme);

  const root = createElement(
    doc,
    "section",
    {
      display: "block",
      width: "100%",
      minWidth: "0",
      borderRadius: "12px",
      border: `1px solid ${surface.border}`,
      background: surface.background,
      boxShadow: surface.boxShadow,
      boxSizing: "border-box",
      overflow: "hidden",
    },
    {
      class: `paperchat-todo-list paperchat-todo-list--docked ${TODO_LIST_ROOT_CLASS}`,
      "data-open": defaultOpen && !(allComplete && collapseOnComplete) ? "true" : "false",
      "data-collapse-on-complete": collapseOnComplete ? "true" : "false",
      "data-all-complete": allComplete ? "true" : "false",
      "data-item-count": String(items.length),
      "aria-label": getString("chat-todo-list-aria-label"),
    },
  );

  const trigger = createElement(
    doc,
    "button",
    {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      width: "100%",
      minHeight: "44px",
      padding: "0 14px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      textAlign: "left",
      boxSizing: "border-box",
    },
    {
      type: "button",
      class: "paperchat-todo-list-trigger",
      "aria-expanded": defaultOpen ? "true" : "false",
    },
  );

  trigger.appendChild(createHeaderIcon(doc, theme, allComplete));
  const headerIconEl = trigger.querySelector(
    ".paperchat-todo-header-icon",
  ) as HTMLElement | null;
  headerIconEl?.setAttribute("data-complete", allComplete ? "true" : "false");

  const title = createElement(doc, "span", {
    flex: "1",
    minWidth: "0",
    fontSize: "14px",
    fontWeight: "600",
    lineHeight: "1.35",
    color: theme.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    opacity: "0.92",
  });
  title.className = "paperchat-todo-list-title";
  title.textContent = resolvePlanTitle(plan);
  trigger.appendChild(title);

  const semantic = getAgentUiSemanticColors();
  const count = createElement(doc, "span", {
    flexShrink: "0",
    fontSize: "12px",
    fontWeight: "600",
    lineHeight: "1.2",
    fontVariantNumeric: "tabular-nums",
    color: allComplete ? semantic.success : theme.textMuted,
  });
  count.className = "paperchat-todo-list-count";
  count.setAttribute("data-complete", allComplete ? "true" : "false");
  count.textContent = `${completed}/${items.length}`;
  trigger.appendChild(count);

  const chevron = createUiChevron(doc, {
    className: "paperchat-todo-list-chevron",
    size: 16,
    color: theme.textMuted,
    opacity: 0.55,
  });
  setUiChevronExpanded(
    chevron,
    defaultOpen && !(allComplete && collapseOnComplete),
  );
  trigger.appendChild(chevron);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = root.getAttribute("data-open") !== "false";
    const nextOpen = !open;
    root.setAttribute("data-open", nextOpen ? "true" : "false");
    root.setAttribute("data-user-open", nextOpen ? "true" : "false");
    applyTodoListOpenUi(root);
  });

  root.appendChild(trigger);

  const body = createElement(doc, "div", {
    overflow: "hidden",
    transition: "max-height 0.22s ease, opacity 0.18s ease",
    maxHeight:
      defaultOpen && !(allComplete && collapseOnComplete)
        ? `${TODO_LIST_MAX_HEIGHT_PX}px`
        : "0px",
    opacity: defaultOpen && !(allComplete && collapseOnComplete) ? "1" : "0",
  });
  body.className = "paperchat-todo-list-body";

  const viewport = createElement(doc, "div", {
    maxHeight: `${TODO_LIST_MAX_HEIGHT_PX}px`,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "0 8px 8px",
    boxSizing: "border-box",
  });
  viewport.className = "paperchat-todo-list-viewport";

  const list = doc.createElementNS(HTML_NS, "ol") as HTMLOListElement;
  list.className = "paperchat-todo-list-items";
  list.style.margin = "0";
  list.style.padding = "0";
  list.style.listStyle = "none";
  list.setAttribute("aria-live", "polite");
  renderTodoItems(doc, theme, list, items);
  viewport.appendChild(list);
  body.appendChild(viewport);
  root.appendChild(body);

  return root;
}

export function updateTodoListElement(
  root: HTMLElement,
  theme: ThemeColors,
  plan: ExecutionPlan,
): void {
  const doc = root.ownerDocument;
  if (!doc) {
    return;
  }
  syncTodoListContent(root, doc, theme, plan);
}
