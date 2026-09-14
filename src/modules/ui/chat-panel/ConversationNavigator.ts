/**
 * ConversationNavigator - beUI MessageScroller rail + PreviewRail for chat history.
 *
 * Mirrors beUI navigation="rail": evenly spaced ticks on the right, pyramid hover
 * scaling, floating preview card, viewport-center active tracking, and centered
 * scroll-to-message behavior.
 */

import type { ChatMessage } from "../../../types/chat";
import { selectChatMessagePresentations } from "../../chat/message-presentation";
import {
  findRenderedMessageElement,
  scrollMessageToViewportStart,
} from "./MessageRenderer";
import { sanitizeMessagePreview } from "./HistoryDropdown";
import { createElement } from "./ChatPanelBuilder";
import { getString } from "../../../utils/locale";
import { getCurrentTheme, isDarkMode } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

const NAV_ROOT_ID = "chat-conversation-nav";
const NAV_RAIL_CLASS = "chat-conversation-nav-rail";
const NAV_TICKS_CLASS = "chat-conversation-nav-ticks";
const NAV_PREVIEW_ID = "chat-conversation-nav-preview";
const NAV_TICK_BUTTON_CLASS = "chat-conversation-nav-tick-button";
const NAV_TICK_MARK_CLASS = "chat-conversation-nav-tick-mark";

const PREVIEW_TITLE_LENGTH = 56;
const PREVIEW_DESCRIPTION_LENGTH = 88;
const FOLLOW_THRESHOLD_PX = 56;
const RAIL_ITEM_SIZE_PX = 14;
const RAIL_WIDTH_PX = 32;
const RAIL_IDLE_WIDTH_PX = 12;
const TICK_BASE_WIDTH_PX = 16;
const IDLE_TICK_WIDTH_PX = 6;
const IDLE_TICK_OPACITY = 0.3;
const IDLE_ACTIVE_TICK_OPACITY = 0.72;
const TICK_HEIGHT_PX = 2;
const RAIL_ENGAGE_HIDE_DELAY_MS = 900;
const TICK_TRANSITION =
  "width 220ms cubic-bezier(0.34, 1.2, 0.64, 1), opacity 180ms ease, color 180ms ease";
const NAV_ROOT_IDLE_CLASS = "chat-conversation-nav--idle";
const NAV_ROOT_ENGAGED_CLASS = "chat-conversation-nav--engaged";

export interface ConversationTurn {
  anchorMessageId: string;
  userPreview: string;
  assistantPreview: string;
}

export interface PreviewRailItem {
  id: string;
  label: string;
  description?: string;
  ariaLabel?: string;
}

export function truncateMessageText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  const excerpt = normalized.slice(0, limit);
  const boundary = excerpt.lastIndexOf(" ");
  const end =
    boundary > limit * 0.65 ? boundary : limit;
  return `${excerpt.slice(0, end).trim()}…`;
}

/** @deprecated Use truncateMessageText for beUI-aligned previews. */
export function truncateConversationPreview(
  text: string,
  maxLength: number = PREVIEW_DESCRIPTION_LENGTH,
): string {
  return truncateMessageText(text, maxLength);
}

export function buildMessagePreview(
  userPreview: string,
  assistantPreview: string,
): Pick<PreviewRailItem, "label" | "description"> {
  const text = userPreview.replace(/\s+/g, " ").trim();
  if (!text) {
    return { label: "Message" };
  }

  if (text.length <= PREVIEW_TITLE_LENGTH) {
    return {
      label: text,
      description: assistantPreview
        ? truncateMessageText(assistantPreview, PREVIEW_DESCRIPTION_LENGTH)
        : undefined,
    };
  }

  const titleExcerpt = text.slice(0, PREVIEW_TITLE_LENGTH);
  const titleBoundary = titleExcerpt.lastIndexOf(" ");
  const titleEnd =
    titleBoundary > PREVIEW_TITLE_LENGTH * 0.65
      ? titleBoundary
      : PREVIEW_TITLE_LENGTH;
  const label = `${text.slice(0, titleEnd).trim()}…`;
  const responseText = assistantPreview || text.slice(titleEnd).trim();
  return {
    label,
    description: responseText
      ? truncateMessageText(responseText, PREVIEW_DESCRIPTION_LENGTH)
      : undefined,
  };
}

export function buildConversationTurns(
  messages: ChatMessage[],
): ConversationTurn[] {
  const visible = selectChatMessagePresentations(messages).map(
    (presentation) => presentation.message,
  );
  const turns: ConversationTurn[] = [];

  let index = 0;
  while (index < visible.length) {
    const message = visible[index];
    if (message.role !== "user") {
      index += 1;
      continue;
    }

    let assistantPreview = "";
    let nextIndex = index + 1;
    while (nextIndex < visible.length && visible[nextIndex].role !== "user") {
      const candidate = visible[nextIndex];
      if (candidate.role === "assistant" && !assistantPreview) {
        assistantPreview = sanitizeMessagePreview(candidate.content);
      }
      nextIndex += 1;
    }

    turns.push({
      anchorMessageId: message.id,
      userPreview: sanitizeMessagePreview(message.content),
      assistantPreview,
    });
    index = nextIndex;
  }

  return turns;
}

export function buildPreviewRailItems(
  turns: ConversationTurn[],
): PreviewRailItem[] {
  return turns.map((turn, index) => {
    const preview = buildMessagePreview(
      turn.userPreview,
      turn.assistantPreview,
    );
    return {
      id: turn.anchorMessageId,
      label: preview.label,
      description: preview.description,
      ariaLabel: getString("chat-conversation-nav-item", {
        args: {
          index: String(index + 1),
          total: String(turns.length),
        },
      }),
    };
  });
}

/** Evenly distribute rail ticks along the rail height. */
export function resolveEvenTurnRailRatio(
  turnIndex: number,
  turnCount: number,
): number {
  if (turnCount <= 0) return 0;
  if (turnCount === 1) return 0.5;
  return turnIndex / (turnCount - 1);
}

export function resolveActiveRailItemIndex(
  items: PreviewRailItem[],
  chatHistory: HTMLElement,
  followThreshold: number = FOLLOW_THRESHOLD_PX,
): number {
  const activeId = resolveActiveRailItemId(items, chatHistory, followThreshold);
  return items.findIndex((item) => item.id === activeId);
}

/** Hover/focus wins; otherwise pyramid follows the scroll-active tick. */
export function resolveRailFocusIndex(
  activeIndex: number,
  highlightedIndex: number,
): number {
  if (highlightedIndex >= 0) return highlightedIndex;
  return activeIndex;
}

export function resolvePreviewRailTickScale(
  itemIndex: number,
  highlightedIndex: number,
): number {
  if (highlightedIndex < 0) return 0.25;
  if (itemIndex === highlightedIndex) return 1;
  const distance = Math.abs(itemIndex - highlightedIndex);
  if (distance === 1) return 0.68;
  if (distance === 2) return 0.44;
  return 0.25;
}

export function resolveRailTickVisual(options: {
  index: number;
  activeIndex: number;
  focusIndex: number;
  engaged: boolean;
  baseWidth?: number;
}): { width: number; opacity: number; emphasized: boolean } {
  if (!options.engaged) {
    const isActive = options.index === options.activeIndex;
    return {
      width: IDLE_TICK_WIDTH_PX,
      opacity: isActive ? IDLE_ACTIVE_TICK_OPACITY : IDLE_TICK_OPACITY,
      emphasized: isActive,
    };
  }

  const scale = resolvePreviewRailTickScale(options.index, options.focusIndex);
  const isFocused = options.index === options.focusIndex;
  return {
    width: Math.max(
      4,
      Math.round((options.baseWidth ?? TICK_BASE_WIDTH_PX) * scale),
    ),
    opacity: isFocused ? 1 : 0.45,
    emphasized: isFocused,
  };
}

export function resolveActiveRailItemId(
  items: PreviewRailItem[],
  chatHistory: HTMLElement,
  followThreshold: number = FOLLOW_THRESHOLD_PX,
): string {
  if (items.length === 0) return "";

  if (chatHistory.scrollTop <= followThreshold) {
    return items[0].id;
  }

  const distanceFromEnd =
    chatHistory.scrollHeight -
    chatHistory.scrollTop -
    chatHistory.clientHeight;
  if (distanceFromEnd <= followThreshold) {
    return items.at(-1)?.id ?? "";
  }

  const viewportRect = chatHistory.getBoundingClientRect();
  const viewportCenter = viewportRect.top + viewportRect.height / 2;
  let nearestId = items[0].id;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const element = findRenderedMessageElement(chatHistory, item.id);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const messageCenter = rect.top + rect.height / 2;
    const distance = Math.abs(messageCenter - viewportCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = item.id;
    }
  }

  return nearestId;
}

/** @deprecated Use resolveActiveRailItemId for beUI-aligned active tracking. */
export function resolveActiveTurnIndex(
  turns: ConversationTurn[],
  chatHistory: HTMLElement,
): number {
  const items: PreviewRailItem[] = turns.map((turn) => ({
    id: turn.anchorMessageId,
    label: turn.userPreview,
  }));
  const activeId = resolveActiveRailItemId(items, chatHistory);
  return turns.findIndex((turn) => turn.anchorMessageId === activeId);
}

export interface ConversationNavigatorController {
  update(messages: ChatMessage[], themeOverride?: ThemeColors): void;
  syncScroll(): void;
  dispose(): void;
}

interface NavigatorElements {
  root: HTMLElement;
  rail: HTMLElement;
  ticks: HTMLElement;
  preview: HTMLElement;
}

function shouldShowNavigator(items: PreviewRailItem[]): boolean {
  return items.length > 0;
}

function haveSameRailItems(
  previous: PreviewRailItem[],
  next: PreviewRailItem[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((item, index) => item.id === next[index]?.id);
}

function resolveNavigatorTheme(theme?: ThemeColors): ThemeColors {
  return theme ?? getCurrentTheme();
}

function applyPreviewTextTheme(preview: HTMLElement, theme: ThemeColors): void {
  const title = preview.querySelector(
    "[data-nav-preview='title']",
  ) as HTMLElement | null;
  const description = preview.querySelector(
    "[data-nav-preview='description']",
  ) as HTMLElement | null;
  if (title) {
    title.style.color = theme.textPrimary;
  }
  if (description) {
    description.style.color = theme.textSecondary;
  }
}

function applyNavigatorTheme(elements: NavigatorElements, theme: ThemeColors) {
  elements.root.style.color = theme.textMuted;
  elements.preview.style.background = theme.dropdownBg;
  elements.preview.style.color = theme.textPrimary;
  elements.preview.style.borderColor = theme.borderColor;
  elements.preview.style.boxShadow = isDarkMode()
    ? "0 12px 32px rgba(0, 0, 0, 0.5)"
    : "0 10px 28px rgba(15, 23, 42, 0.16)";
  applyPreviewTextTheme(elements.preview, theme);
}

function hidePreview(elements: NavigatorElements): void {
  elements.preview.style.display = "none";
  elements.preview.replaceChildren();
}

function renderPreviewCard(
  doc: Document,
  preview: HTMLElement,
  item: PreviewRailItem,
  theme: ThemeColors,
): void {
  preview.replaceChildren();
  const label = createElement(
    doc,
    "div",
    {
      fontSize: "12px",
      lineHeight: "18px",
      fontWeight: "600",
      color: theme.textPrimary,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    { "data-nav-preview": "title" },
  );
  label.textContent = item.label;
  label.title = item.label;
  preview.appendChild(label);

  if (item.description) {
    const description = createElement(
      doc,
      "div",
      {
        fontSize: "12px",
        lineHeight: "18px",
        fontWeight: "400",
        color: theme.textSecondary,
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "-webkit-box",
        webkitBoxOrient: "vertical",
        webkitLineClamp: "2",
        whiteSpace: "normal",
      },
      { "data-nav-preview": "description" },
    );
    description.textContent = item.description;
    description.title = item.description;
    preview.appendChild(description);
  }
}

function positionPreviewCard(
  elements: NavigatorElements,
  itemIndex: number,
): void {
  const viewportRect = elements.root.parentElement?.getBoundingClientRect();
  const navRect = elements.root.getBoundingClientRect();
  if (!viewportRect) return;

  const button = elements.ticks.querySelector(
    `[data-turn-index="${itemIndex}"]`,
  ) as HTMLElement | null;
  const anchorY = button
    ? button.getBoundingClientRect().top + button.offsetHeight / 2
    : navRect.top + navRect.height / 2;

  elements.preview.style.display = "flex";
  elements.preview.style.left = `${Math.round(navRect.right + 10)}px`;
  elements.preview.style.top = `${Math.round(
    Math.min(
      viewportRect.bottom - 12,
      Math.max(viewportRect.top + 12, anchorY),
    ),
  )}px`;
  elements.preview.style.transform = "translateY(-50%)";
}

function updateRailTickVisuals(
  elements: NavigatorElements,
  items: PreviewRailItem[],
  theme: ThemeColors,
  activeIndex: number,
  highlightedIndex: number,
  engaged: boolean,
): void {
  const focusIndex = resolveRailFocusIndex(activeIndex, highlightedIndex);
  const buttons = elements.ticks.querySelectorAll(
    `.${NAV_TICK_BUTTON_CLASS}`,
  );

  elements.ticks.style.justifyItems = "start";
  elements.root.style.width = engaged
    ? `${RAIL_WIDTH_PX}px`
    : `${RAIL_IDLE_WIDTH_PX}px`;
  elements.rail.style.width = engaged
    ? `${RAIL_WIDTH_PX}px`
    : `${RAIL_IDLE_WIDTH_PX}px`;

  buttons.forEach((node, index) => {
    const button = node as HTMLElement;
    const item = items[index];
    if (!item) return;

    const visual = resolveRailTickVisual({
      index,
      activeIndex,
      focusIndex,
      engaged,
    });
    const mark = button.querySelector(
      `.${NAV_TICK_MARK_CLASS}`,
    ) as HTMLElement | null;

    button.style.color = visual.emphasized ? theme.textPrimary : theme.textMuted;
    if (mark) {
      mark.style.width = `${visual.width}px`;
      mark.style.opacity = String(visual.opacity);
    }
  });
}

function renderRailTicks(
  elements: NavigatorElements,
  items: PreviewRailItem[],
  theme: ThemeColors,
): void {
  const doc = elements.ticks.ownerDocument;
  if (!doc) return;

  elements.ticks.replaceChildren();
  elements.ticks.style.display = "grid";
  elements.ticks.style.gridTemplateRows = items.length
    ? `repeat(${items.length}, ${RAIL_ITEM_SIZE_PX}px)`
    : "";
  elements.ticks.style.alignContent = "center";
  elements.ticks.style.justifyItems = "start";

  items.forEach((item, index) => {
    const button = createElement(
      doc,
      "button",
      {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        width: "100%",
        height: `${RAIL_ITEM_SIZE_PX}px`,
        padding: "0",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: theme.textMuted,
      },
      {
        type: "button",
        class: NAV_TICK_BUTTON_CLASS,
        "data-turn-index": String(index),
        "data-turn-id": item.id,
        "aria-label": item.ariaLabel || item.label,
      },
    );

    const mark = createElement(
      doc,
      "span",
      {
        display: "block",
        width: `${TICK_BASE_WIDTH_PX}px`,
        height: `${TICK_HEIGHT_PX}px`,
        borderRadius: "999px",
        background: "currentColor",
        opacity: "0.45",
        transformOrigin: "left center",
        transition: TICK_TRANSITION,
      },
      { class: NAV_TICK_MARK_CLASS, "aria-hidden": "true" },
    );

    button.appendChild(mark);
    elements.ticks.appendChild(button);
  });
}

function scrollToRailItem(
  chatHistory: HTMLElement,
  items: PreviewRailItem[],
  index: number,
): void {
  const item = items[index];
  if (!item) return;

  scrollMessageToViewportStart(chatHistory, item.id);
}

export function attachConversationNavigator(
  chatViewport: HTMLElement,
  chatHistory: HTMLElement,
  theme: ThemeColors,
): ConversationNavigatorController {
  const doc = chatViewport.ownerDocument;
  let items: PreviewRailItem[] = [];
  let activeIndex = 0;
  let highlightedIndex = -1;
  let hidePreviewTimer: ReturnType<typeof setTimeout> | null = null;
  let engageHideTimer: ReturnType<typeof setTimeout> | null = null;
  let isRailEngaged = false;
  let isPointerOverRail = false;
  let mounted = false;

  chatViewport.querySelector(`#${NAV_ROOT_ID}`)?.remove();
  chatViewport.querySelector(`#${NAV_PREVIEW_ID}`)?.remove();

  const root = createElement(
    doc,
    "div",
    {
      position: "absolute",
      top: "8px",
      bottom: "8px",
      left: "2px",
      right: "auto",
      width: `${RAIL_WIDTH_PX}px`,
      zIndex: "3",
      pointerEvents: "none",
      display: "none",
      alignItems: "stretch",
      justifyContent: "flex-start",
    },
    {
      id: NAV_ROOT_ID,
      role: "navigation",
      "aria-label": getString("chat-conversation-nav-label"),
    },
  );

  const rail = createElement(
    doc,
    "div",
    {
      position: "relative",
      display: "flex",
      width: `${RAIL_WIDTH_PX}px`,
      height: "100%",
      minHeight: "0",
      alignItems: "stretch",
      justifyContent: "flex-start",
    },
    { class: NAV_RAIL_CLASS },
  );

  const ticks = createElement(
    doc,
    "div",
    {
      display: "grid",
      width: "100%",
      height: "100%",
      alignContent: "center",
      justifyItems: "start",
      pointerEvents: "auto",
    },
    { class: NAV_TICKS_CLASS },
  );

  const preview = createElement(
    doc,
    "div",
    {
      display: "none",
      position: "fixed",
      zIndex: "10012",
      minWidth: "220px",
      maxWidth: "280px",
      padding: "10px 12px",
      border: "1px solid",
      borderRadius: "12px",
      pointerEvents: "none",
      flexDirection: "column",
      gap: "4px",
    },
    { id: NAV_PREVIEW_ID, role: "tooltip" },
  );

  rail.appendChild(ticks);
  root.appendChild(rail);

  const elements: NavigatorElements = { root, rail, ticks, preview };
  applyNavigatorTheme(elements, resolveNavigatorTheme(theme));

  const mount = () => {
    if (mounted) return;
    mounted = true;
    chatViewport.appendChild(root);
    chatViewport.appendChild(preview);
    setRailEngaged(false);
  };

  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    hidePreview(elements);
    root.remove();
    preview.remove();
  };

  const clearHidePreviewTimer = () => {
    if (hidePreviewTimer) {
      clearTimeout(hidePreviewTimer);
      hidePreviewTimer = null;
    }
  };

  const clearEngageHideTimer = () => {
    if (engageHideTimer) {
      clearTimeout(engageHideTimer);
      engageHideTimer = null;
    }
  };

  const setRailEngaged = (engaged: boolean) => {
    if (isRailEngaged === engaged) return;
    isRailEngaged = engaged;
    root.classList.toggle(NAV_ROOT_IDLE_CLASS, !engaged);
    root.classList.toggle(NAV_ROOT_ENGAGED_CLASS, engaged);
    refreshTickVisuals();
  };

  const engageRail = () => {
    clearEngageHideTimer();
    setRailEngaged(true);
  };

  const scheduleRailIdle = () => {
    clearEngageHideTimer();
    engageHideTimer = setTimeout(() => {
      engageHideTimer = null;
      if (!isPointerOverRail) {
        setRailEngaged(false);
      }
    }, RAIL_ENGAGE_HIDE_DELAY_MS);
  };

  const refreshTickVisuals = () => {
    updateRailTickVisuals(
      elements,
      items,
      getCurrentTheme(),
      activeIndex,
      highlightedIndex,
      isRailEngaged,
    );
  };

  const scheduleHidePreview = () => {
    clearHidePreviewTimer();
    hidePreviewTimer = setTimeout(() => {
      highlightedIndex = -1;
      hidePreview(elements);
      refreshTickVisuals();
    }, 120);
  };

  const showPreviewForItem = (index: number) => {
    clearHidePreviewTimer();
    highlightedIndex = index;
    const item = items[index];
    if (!item) return;
    const activeTheme = getCurrentTheme();
    applyNavigatorTheme(elements, activeTheme);
    renderPreviewCard(doc, preview, item, activeTheme);
    positionPreviewCard(elements, index);
    refreshTickVisuals();
  };

  const renderTickMarks = () => {
    renderRailTicks(elements, items, getCurrentTheme());
    refreshTickVisuals();
  };

  const updateActiveItem = () => {
    if (items.length === 0) return;
    const nextActiveIndex = resolveActiveRailItemIndex(items, chatHistory);
    if (nextActiveIndex >= 0) {
      activeIndex = nextActiveIndex;
    }
    refreshTickVisuals();
    if (highlightedIndex >= 0) {
      positionPreviewCard(elements, highlightedIndex);
    }
  };

  const onScroll = () => {
    engageRail();
    scheduleRailIdle();
    updateActiveItem();
  };

  const onRootEnter = () => {
    isPointerOverRail = true;
    engageRail();
    clearHidePreviewTimer();
  };
  const onRootLeave = () => {
    isPointerOverRail = false;
    scheduleHidePreview();
    scheduleRailIdle();
  };

  const resolveTickIndex = (target: EventTarget | null): number => {
    const button = (target as HTMLElement | null)?.closest?.(
      `.${NAV_TICK_BUTTON_CLASS}`,
    ) as HTMLElement | null;
    if (!button) return -1;
    const index = Number(button.getAttribute("data-turn-index"));
    return Number.isFinite(index) ? index : -1;
  };

  const onTicksPointerOver = (event: Event) => {
    const index = resolveTickIndex(event.target);
    if (index >= 0) showPreviewForItem(index);
  };

  const onTicksFocusIn = (event: Event) => {
    const index = resolveTickIndex(event.target);
    if (index >= 0) showPreviewForItem(index);
  };

  const onTicksClick = (event: Event) => {
    const index = resolveTickIndex(event.target);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    scrollToRailItem(chatHistory, items, index);
    activeIndex = index;
    refreshTickVisuals();
  };

  ticks.addEventListener("mouseover", onTicksPointerOver);
  ticks.addEventListener("focusin", onTicksFocusIn);
  ticks.addEventListener("click", onTicksClick);
  root.addEventListener("mouseenter", onRootEnter);
  root.addEventListener("mouseleave", onRootLeave);

  return {
    update(messages: ChatMessage[], themeOverride?: ThemeColors) {
      const activeTheme = resolveNavigatorTheme(themeOverride);
      const nextItems = buildPreviewRailItems(buildConversationTurns(messages));
      const structureChanged = !haveSameRailItems(items, nextItems);
      items = nextItems;

      if (!shouldShowNavigator(items)) {
        unmount();
        return;
      }

      mount();
      root.style.display = "flex";
      applyNavigatorTheme(elements, activeTheme);

      if (structureChanged) {
        activeIndex = Math.max(
          0,
          resolveActiveRailItemIndex(items, chatHistory),
        );
        const renderStructure = () => {
          renderTickMarks();
          if (highlightedIndex >= items.length) {
            highlightedIndex = -1;
            hidePreview(elements);
          } else if (highlightedIndex >= 0) {
            showPreviewForItem(highlightedIndex);
          }
        };
        const view = chatHistory.ownerDocument?.defaultView;
        if (view?.requestAnimationFrame) {
          view.requestAnimationFrame(renderStructure);
        } else {
          renderStructure();
        }
        return;
      }

      updateActiveItem();
    },
    syncScroll() {
      onScroll();
    },
    dispose() {
      clearHidePreviewTimer();
      clearEngageHideTimer();
      ticks.removeEventListener("mouseover", onTicksPointerOver);
      ticks.removeEventListener("focusin", onTicksFocusIn);
      ticks.removeEventListener("click", onTicksClick);
      root.removeEventListener("mouseenter", onRootEnter);
      root.removeEventListener("mouseleave", onRootLeave);
      unmount();
    },
  };
}

const navigatorControllers = new WeakMap<
  HTMLElement,
  ConversationNavigatorController
>();

export function ensureConversationNavigator(
  container: HTMLElement,
  theme: ThemeColors,
): ConversationNavigatorController | null {
  const chatViewport = container.querySelector("#chat-viewport") as
    | HTMLElement
    | null;
  const chatHistory = container.querySelector("#chat-history") as
    | HTMLElement
    | null;
  if (!chatViewport || !chatHistory) return null;

  const existing = navigatorControllers.get(container);
  if (existing) return existing;

  const controller = attachConversationNavigator(
    chatViewport,
    chatHistory,
    theme,
  );
  navigatorControllers.set(container, controller);
  return controller;
}

export function syncConversationNavigator(
  container: HTMLElement,
  messages: ChatMessage[],
  theme: ThemeColors,
): void {
  ensureConversationNavigator(container, theme)?.update(messages, theme);
}

export function disposeConversationNavigator(container: HTMLElement): void {
  const controller = navigatorControllers.get(container);
  controller?.dispose();
  navigatorControllers.delete(container);
}

export function updateConversationNavigatorTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const chatViewport = container.querySelector("#chat-viewport") as
    | HTMLElement
    | null;
  const root = chatViewport?.querySelector(`#${NAV_ROOT_ID}`) as
    | HTMLElement
    | null;
  const preview = chatViewport?.querySelector(`#${NAV_PREVIEW_ID}`) as
    | HTMLElement
    | null;
  if (!root || !preview) return;

  const rail = root.querySelector(`.${NAV_RAIL_CLASS}`) as HTMLElement;
  const activeTheme = resolveNavigatorTheme(theme);
  applyNavigatorTheme({ root, rail, ticks: root, preview }, activeTheme);
}
