import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import {
  deleteQuickAction,
  loadQuickActions,
  reorderQuickActionsByIds,
  upsertQuickAction,
} from "../../chat/quick-actions";
import type { QuickAction } from "../../chat/quick-actions";
import type { ChatPanelContext, ThemeColors } from "./types";
import { HTML_NS } from "./types";
import { createElement } from "./ChatPanelBuilder";
import { openQuickActionEditDialog } from "./QuickActionEditDialog";
import {
  applyQuickActionsTheme,
  resolveQuickActionChipTheme,
} from "./ComposerTheme";

const CHIP_CLASS = "chat-quick-action-chip";
const ADD_BUTTON_CLASS = "chat-quick-action-add";
const DRAG_THRESHOLD_PX = 6;

export async function renderQuickActionsBar(
  context: ChatPanelContext,
  theme: ThemeColors,
  runPrompt: (prompt: string) => Promise<void>,
  actions: QuickAction[] = loadQuickActions(),
): Promise<void> {
  const bar = context.container.querySelector(
    "#chat-quick-actions-bar",
  ) as HTMLElement | null;
  if (!bar) {
    return;
  }

  while (bar.firstChild) {
    bar.removeChild(bar.firstChild);
  }

  for (const action of actions) {
    bar.appendChild(
      createQuickActionChip(context, theme, action, runPrompt, bar),
    );
  }

  bar.appendChild(createQuickActionManageButton(context, theme, runPrompt));

  const hasShortcuts = bar.childElementCount > 0;
  bar.style.display = hasShortcuts ? "flex" : "none";
  bar.classList.toggle("is-visible", hasShortcuts);

  const scrollBottomBtn = context.container.querySelector(
    "#chat-scroll-bottom-btn",
  ) as HTMLElement | null;
  if (scrollBottomBtn) {
    scrollBottomBtn.style.bottom = hasShortcuts ? "62px" : "16px";
  }

  if (hasShortcuts) {
    applyQuickActionsTheme(context.container, theme);
  }
}

function createQuickActionChip(
  context: ChatPanelContext,
  theme: ThemeColors,
  action: QuickAction,
  runPrompt: (prompt: string) => Promise<void>,
  bar: HTMLElement,
): HTMLElement {
  const chipTheme = resolveQuickActionChipTheme(theme);
  const chip = createElement(
    context.container.ownerDocument,
    "div",
    {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      padding: "5px 12px",
      borderRadius: "999px",
      border: `1px solid ${theme.borderColor}`,
      background: chipTheme.background,
      color: theme.textPrimary,
      cursor: "grab",
      fontSize: "12px",
      lineHeight: "1.3",
      boxShadow: chipTheme.boxShadow,
      maxWidth: "100%",
      whiteSpace: "nowrap",
      userSelect: "none",
      position: "relative",
    },
    {
      class: CHIP_CLASS,
      role: "button",
      tabindex: "0",
      title: `${getString("chat-quick-action-run-title", {
        args: { label: action.label },
      })} · ${getString("chat-quick-action-reorder")}`,
      "data-action-id": action.id,
    },
  );

  const label = createElement(context.container.ownerDocument, "span", {
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
  });
  label.textContent = action.label;

  const editBtn = createElement(
    context.container.ownerDocument,
    "span",
    {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "16px",
      height: "16px",
      borderRadius: "4px",
      opacity: "0.72",
      flexShrink: "0",
      cursor: "pointer",
    },
    {
      class: "chat-quick-action-edit",
      title: getString("chat-quick-action-edit-title"),
      role: "button",
      tabindex: "0",
    },
  );
  const editIcon = context.container.ownerDocument.createElementNS(
    HTML_NS,
    "img",
  ) as HTMLImageElement;
  editIcon.src = `chrome://${config.addonRef}/content/icons/config.svg`;
  editIcon.alt = "";
  editIcon.style.width = "12px";
  editIcon.style.height = "12px";
  editIcon.style.pointerEvents = "none";
  editIcon.style.filter = chipTheme.iconFilter;
  editBtn.appendChild(editIcon);

  const deleteBtn = createElement(
    context.container.ownerDocument,
    "span",
    {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      position: "absolute",
      right: "-7px",
      top: "-7px",
      width: "15px",
      height: "15px",
      borderRadius: "50%",
      background: theme.dropdownBg,
      border: `1px solid ${theme.borderColor}`,
      opacity: "0",
      transition: "opacity 0.15s ease",
      cursor: "pointer",
    },
    {
      class: "chat-quick-action-delete",
      title: getString("chat-quick-action-delete"),
      role: "button",
      tabindex: "0",
    },
  );
  const deleteIcon = context.container.ownerDocument.createElementNS(
    HTML_NS,
    "img",
  ) as HTMLImageElement;
  deleteIcon.src = `chrome://${config.addonRef}/content/icons/close.svg`;
  deleteIcon.alt = "";
  deleteIcon.style.width = "12px";
  deleteIcon.style.height = "12px";
  deleteIcon.style.pointerEvents = "none";
  deleteIcon.style.filter = chipTheme.iconFilter;
  deleteBtn.appendChild(deleteIcon);

  chip.appendChild(label);
  chip.appendChild(editBtn);
  chip.appendChild(deleteBtn);

  enableChipReorder(chip, bar, theme);

  const activateChip = (event: Event) => {
    if (chip.dataset.suppressClick === "1") {
      event.preventDefault();
      event.stopPropagation();
      delete chip.dataset.suppressClick;
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest(".chat-quick-action-delete")) {
      event.preventDefault();
      event.stopPropagation();
      void confirmAndDeleteQuickAction(context, theme, action, runPrompt);
      return;
    }
    if (target?.closest(".chat-quick-action-edit")) {
      event.preventDefault();
      event.stopPropagation();
      void openQuickActionEditor(context, theme, action, runPrompt);
      return;
    }
    event.preventDefault();
    void runPrompt(action.prompt);
  };

  chip.addEventListener("click", activateChip);
  chip.addEventListener("mouseenter", () => {
    deleteBtn.style.opacity = "0.85";
  });
  chip.addEventListener("mouseleave", () => {
    deleteBtn.style.opacity = "0";
  });
  chip.addEventListener("focusin", () => {
    deleteBtn.style.opacity = "0.85";
  });
  chip.addEventListener("focusout", () => {
    deleteBtn.style.opacity = "0";
  });
  chip.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    activateChip(event);
  });

  editBtn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openQuickActionEditor(context, theme, action, runPrompt);
  });

  deleteBtn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void confirmAndDeleteQuickAction(context, theme, action, runPrompt);
  });

  return chip;
}

function enableChipReorder(
  chip: HTMLElement,
  bar: HTMLElement,
  theme: ThemeColors,
): void {
  const doc = chip.ownerDocument;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let ghost: HTMLElement | null = null;

  const resetChipStyle = () => {
    const chipTheme = resolveQuickActionChipTheme(theme);
    chip.style.opacity = "1";
    chip.style.cursor = "grab";
    chip.style.boxShadow = chipTheme.boxShadow;
    chip.style.borderColor = theme.borderColor;
  };

  const removeGhost = () => {
    ghost?.parentElement?.removeChild(ghost);
    ghost = null;
  };

  const onMouseMove = (event: MouseEvent) => {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      chip.dataset.suppressClick = "1";
      chip.style.opacity = "0.35";
      chip.style.cursor = "grabbing";
      ghost = createChipGhost(chip, theme);
      ghost.style.left = `${event.clientX - offsetX}px`;
      ghost.style.top = `${event.clientY - offsetY}px`;
      doc.documentElement.appendChild(ghost);
    }

    event.preventDefault();

    if (ghost) {
      ghost.style.left = `${event.clientX - offsetX}px`;
      ghost.style.top = `${event.clientY - offsetY}px`;
    }

    const hovered = doc.elementFromPoint(
      event.clientX,
      event.clientY,
    ) as HTMLElement | null;
    const target = hovered?.closest(`.${CHIP_CLASS}`) as HTMLElement | null;
    if (!target || target === chip || target.parentElement !== bar) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const insertBefore = event.clientX < rect.left + rect.width / 2;
    bar.insertBefore(chip, insertBefore ? target : target.nextSibling);
    keepAddButtonLast(bar);
  };

  const onMouseUp = () => {
    doc.removeEventListener("mousemove", onMouseMove, true);
    doc.removeEventListener("mouseup", onMouseUp, true);
    removeGhost();
    if (!dragging) {
      return;
    }
    dragging = false;
    resetChipStyle();
    keepAddButtonLast(bar);
    persistChipOrder(bar);
  };

  chip.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(".chat-quick-action-edit") ||
      target?.closest(".chat-quick-action-delete")
    ) {
      return;
    }
    const rect = chip.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragging = false;
    doc.addEventListener("mousemove", onMouseMove, true);
    doc.addEventListener("mouseup", onMouseUp, true);
  });
}

function createChipGhost(chip: HTMLElement, theme: ThemeColors): HTMLElement {
  const rect = chip.getBoundingClientRect();
  const ghost = chip.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-action-id");
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.boxSizing = "border-box";
  ghost.style.margin = "0";
  ghost.style.opacity = "0.92";
  ghost.style.cursor = "grabbing";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "10050";
  ghost.style.boxShadow = "0 8px 20px rgba(0,0,0,0.18)";
  ghost.style.borderColor = theme.inputFocusBorderColor;
  return ghost;
}

function keepAddButtonLast(bar: HTMLElement): void {
  const addButton = bar.querySelector(
    `.${ADD_BUTTON_CLASS}`,
  ) as HTMLElement | null;
  if (addButton && addButton !== bar.lastElementChild) {
    bar.appendChild(addButton);
  }
}

function persistChipOrder(bar: HTMLElement): void {
  const ids = Array.from(bar.querySelectorAll(`.${CHIP_CLASS}`))
    .map((node) => (node as HTMLElement).dataset.actionId || "")
    .filter(Boolean);
  reorderQuickActionsByIds(ids);
}

function createQuickActionManageButton(
  context: ChatPanelContext,
  theme: ThemeColors,
  runPrompt: (prompt: string) => Promise<void>,
): HTMLElement {
  const chipTheme = resolveQuickActionChipTheme(theme);
  const button = createElement(
    context.container.ownerDocument,
    "button",
    {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "28px",
      height: "28px",
      minWidth: "28px",
      minHeight: "28px",
      padding: "0",
      boxSizing: "border-box",
      borderRadius: "50%",
      border: `1px dashed ${theme.borderColor}`,
      background: chipTheme.background,
      color: theme.textMuted,
      cursor: "pointer",
      flexShrink: "0",
      appearance: "none",
    },
    {
      class: ADD_BUTTON_CLASS,
      type: "button",
      title: getString("chat-quick-action-add"),
      "aria-label": getString("chat-quick-action-add"),
    },
  );
  const plusIcon = context.container.ownerDocument.createElementNS(
    HTML_NS,
    "img",
  ) as HTMLImageElement;
  plusIcon.src = `chrome://${config.addonRef}/content/icons/plus.svg`;
  plusIcon.alt = "";
  plusIcon.style.width = "14px";
  plusIcon.style.height = "14px";
  plusIcon.style.display = "block";
  plusIcon.style.pointerEvents = "none";
  plusIcon.style.filter = chipTheme.iconFilter;
  button.appendChild(plusIcon);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    void openQuickActionEditor(
      context,
      theme,
      {
        id: "",
        label: "",
        prompt: "",
      },
      runPrompt,
    );
  });
  return button;
}

async function confirmAndDeleteQuickAction(
  context: ChatPanelContext,
  theme: ThemeColors,
  action: QuickAction,
  runPrompt: (prompt: string) => Promise<void>,
): Promise<void> {
  const win = Zotero.getMainWindow();
  if (!win) {
    return;
  }
  const confirmed = Services.prompt.confirm(
    win as unknown as mozIDOMWindowProxy,
    getString("chat-quick-action-delete"),
    getString("chat-quick-action-delete-confirm", {
      args: { label: action.label },
    }),
  );
  if (!confirmed) {
    return;
  }
  const actions = deleteQuickAction(action.id);
  await renderQuickActionsBar(context, theme, runPrompt, actions);
}

async function openQuickActionEditor(
  context: ChatPanelContext,
  theme: ThemeColors,
  action: QuickAction,
  runPrompt: (prompt: string) => Promise<void>,
): Promise<void> {
  const result = await openQuickActionEditDialog(action.id ? action : null);
  if (result.deleted && action.id) {
    const actions = deleteQuickAction(action.id);
    await renderQuickActionsBar(context, theme, runPrompt, actions);
    return;
  }
  if (!result.saved || !result.action) {
    return;
  }
  const actions = upsertQuickAction(result.action);
  await renderQuickActionsBar(context, theme, runPrompt, actions);
}
