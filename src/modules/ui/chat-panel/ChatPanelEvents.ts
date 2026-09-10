/**
 * ChatPanelEvents - Event handlers for the chat panel
 */

import { config } from "../../../../package.json";
import type { ChatPanelContext, AttachmentState, SessionInfo } from "./types";
import { createElement, copyToClipboard, dispatchInputEvent } from "./ChatPanelBuilder";
import { updateContextItemBannerForItem } from "./ContextItemBanner";
import {
  positionContextWindowUsageTooltip,
  scheduleContextWindowUsageRefresh,
  updateContextWindowUsageDisplay,
} from "./ContextWindowIndicator";
import { renderQuickActionsBar } from "./QuickActionsController";
import { getCurrentTheme } from "./ChatPanelTheme";
import {
  createHistoryDropdownState,
  refreshHistoryDropdownSearch,
  populateHistoryDropdown,
  setupHistoryDropdownSearch,
  setupClickOutsideHandler,
  toggleHistoryDropdown,
} from "./HistoryDropdown";
import { getString } from "../../../utils/locale";
import { getProviderManager } from "../../providers";
import { getPref, setPref } from "../../../utils/prefs";
import {
  formatModelLabel,
} from "../../preferences/ModelsFetcher";
import {
  createBookmarkManagerPanel,
  getBookmarkManagerPanel,
  isBookmarkManagerVisible,
  refreshBookmarkManagerPanel,
  setBookmarkManagerVisible,
} from "./BookmarkManagerPanel";
import {
  getChatManager,
  navigateToQuotedMessage,
  openBookmarkReaderForContext,
  type PanelMode,
} from "./ChatPanelManager";
import type { BookmarkManagerActions } from "./BookmarkManagerPanel";
import type { BookmarkRecord } from "../../../types/bookmark";
import { startReaderFigureScreenshot } from "../ReaderFigureScreenshot";
import {
  MentionSelector,
  type MentionResource,
  findMentionAtCursor,
  formatMentionReference,
} from "./MentionSelector";
import {
  disposeConversationNavigator,
  ensureConversationNavigator,
} from "./ConversationNavigator";
import {
  scrollToAndHighlightMessage,
  scrollChatHistoryToBottom,
  shouldAutoScrollChatHistory,
  updateChatHistoryAutoScrollState,
  updateChatHistoryScrollBottomButton,
} from "./MessageRenderer";
import {
  ANALYTICS_EVENTS,
  getAnalyticsService,
  trackPaperChatPresentationEntryClicked,
} from "../../analytics";
import {
  hasConversationMessages,
  shouldResetSummaryButtonBusyState,
} from "./NoteSummaryActions";
import type {
  ChatMessage,
  ChatSession,
  ImageAttachment,
  QuotedMessageRef,
} from "../../chat";
import {
  sessionTurnQueue,
  type QueuedTurn,
  type TurnRunResult,
} from "./SessionTurnQueue";
import { UserMessageEditController } from "./UserMessageEditController";

// Import getActiveReaderItem from the manager module to avoid circular dependency
// This is set by ChatPanelManager during initialization
let getActiveReaderItemFn: (() => Zotero.Item | null) | null = null;

// Toggle panel mode function reference (set by ChatPanelManager)
let togglePanelModeFn: (() => void) | null = null;

const CONVERSATION_SUMMARY_TURN_PREFIX = "conversation-summary-";
let queuedTurnSequence = 0;
const MESSAGE_INPUT_MIN_HEIGHT = 60;
const MESSAGE_INPUT_MAX_HEIGHT = 140;
const CHAT_HISTORY_BOTTOM_STICKY_THRESHOLD = 24;

function updateConversationSummaryButtonPresentation(
  button: HTMLButtonElement,
  isRunning: boolean,
): void {
  const icon = button.querySelector("img") as HTMLElement | null;
  if (isRunning) {
    button.setAttribute("aria-busy", "true");
    button.title = getString("chat-stop-generating");
    button.setAttribute("aria-label", button.title);
    button.style.cursor = "pointer";
    button.style.opacity = "1";
    if (icon) {
      icon.removeAttribute("src");
      icon.style.display = "flex";
      icon.style.alignItems = "center";
      icon.style.justifyContent = "center";
      icon.style.width = "12px";
      icon.style.height = "12px";
      icon.style.background = "currentColor";
      icon.style.borderRadius = "2px";
    }
    return;
  }

  button.removeAttribute("aria-busy");
  button.title = getString("chat-summarize-conversation-note");
  button.setAttribute("aria-label", button.title);
  button.style.cursor = "pointer";
  button.style.opacity = "1";
  if (icon) {
    icon.setAttribute(
      "src",
      `chrome://${config.addonRef}/content/icons/write.svg`,
    );
    icon.style.display = "block";
    icon.style.width = "16px";
    icon.style.height = "16px";
    icon.style.background = "";
    icon.style.borderRadius = "";
  }
}

function resetConversationSummaryButtonBusyState(
  button: HTMLButtonElement,
): void {
  button.removeAttribute("data-summary-session-id");
  updateConversationSummaryButtonPresentation(button, false);
}

function isConversationSummaryRunning(sessionId: string): boolean {
  const snapshot = sessionTurnQueue.snapshot(sessionId);
  return (
    snapshot.status === "running" &&
    snapshot.activeTurnId?.startsWith(CONVERSATION_SUMMARY_TURN_PREFIX) === true
  );
}

function hasQueuedConversationSummary(sessionId: string): boolean {
  const snapshot = sessionTurnQueue.snapshot(sessionId);
  return snapshot.queued.some((turn) =>
    turn.id.startsWith(CONVERSATION_SUMMARY_TURN_PREFIX),
  );
}

export function syncConversationSummaryButtonState(
  container: HTMLElement,
  chatManager: ChatPanelContext["chatManager"],
): void {
  const button = container.querySelector(
    "#chat-summarize-conversation-note",
  ) as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  const session = chatManager.getActiveSession();
  const isRunning = session
    ? isConversationSummaryRunning(session.id) ||
      hasQueuedConversationSummary(session.id)
    : false;
  updateConversationSummaryButtonPresentation(button, isRunning);
}

export function updateConversationNoteSummaryButton(
  container: HTMLElement,
  messages: ChatMessage[],
  sessionId?: string,
  supportsToolCalling: boolean = false,
): void {
  const button = container.querySelector(
    "#chat-summarize-conversation-note",
  ) as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  const busySessionId = button.getAttribute("data-summary-session-id");
  if (shouldResetSummaryButtonBusyState(busySessionId, sessionId)) {
    resetConversationSummaryButtonBusyState(button);
  }
  button.style.display =
    supportsToolCalling && hasConversationMessages(messages)
      ? "inline-flex"
      : "none";
}

interface AttachmentPreviewActions {
  onRemoveImage?: (index: number) => void;
  onRemoveQuote?: (index: number) => void;
  onRemoveSelectedText?: () => void;
  onNavigateQuote?: (quote: QuotedMessageRef) => void | Promise<void>;
}

const PENDING_SELECTED_TEXT_PREVIEW_CHARACTERS = 80;

function createPendingSelectedTextPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= PENDING_SELECTED_TEXT_PREVIEW_CHARACTERS) {
    return normalized;
  }
  return `${normalized
    .slice(0, Math.max(0, PENDING_SELECTED_TEXT_PREVIEW_CHARACTERS - 3))
    .trimEnd()}...`;
}

function clearPendingQuotedMessages(context: ChatPanelContext): void {
  const state = context.getAttachmentState();
  if (state.pendingQuotedMessages.length === 0) return;
  state.pendingQuotedMessages = [];
  context.setAttachmentState(state);
  context.updateAttachmentsPreview();
}

/** Keep session-bound composer state aligned after any programmatic switch. */
export function syncSessionNavigationState(
  context: ChatPanelContext,
  sendButton: HTMLButtonElement | null,
  chatManager: ChatPanelContext["chatManager"],
): void {
  clearPendingQuotedMessages(context);
  syncSendButtonState(sendButton, chatManager);
}

function trackChatModelSwitched(props: Record<string, string | boolean>): void {
  getAnalyticsService().track(ANALYTICS_EVENTS.chatModelSwitched, props);
}

function focusTextarea(input: HTMLTextAreaElement | null | undefined): void {
  if (!input) return;

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
}

function resizeMessageInput(
  messageInput: HTMLTextAreaElement | null | undefined,
  chatHistory?: HTMLElement | null,
): void {
  if (!messageInput) {
    return;
  }

  const previousChatHistoryHeight = chatHistory?.clientHeight ?? 0;
  const previousChatHistoryScrollTop = chatHistory?.scrollTop ?? 0;
  const previousBottomOffset = chatHistory
    ? chatHistory.scrollHeight -
      chatHistory.scrollTop -
      chatHistory.clientHeight
    : 0;

  messageInput.style.height = `${MESSAGE_INPUT_MIN_HEIGHT}px`;
  const measuredHeight = messageInput.scrollHeight;
  const nextHeight = Math.max(
    MESSAGE_INPUT_MIN_HEIGHT,
    Math.min(measuredHeight, MESSAGE_INPUT_MAX_HEIGHT),
  );
  messageInput.style.height = `${nextHeight}px`;
  messageInput.style.overflowY =
    measuredHeight > MESSAGE_INPUT_MAX_HEIGHT ? "auto" : "hidden";

  if (!chatHistory) {
    return;
  }

  const nextChatHistoryHeight = chatHistory.clientHeight;
  if (nextChatHistoryHeight === previousChatHistoryHeight) {
    return;
  }

  if (
    previousBottomOffset <= CHAT_HISTORY_BOTTOM_STICKY_THRESHOLD &&
    shouldAutoScrollChatHistory(chatHistory)
  ) {
    scrollChatHistoryToBottom(chatHistory);
    return;
  }

  const heightDelta = previousChatHistoryHeight - nextChatHistoryHeight;
  chatHistory.scrollTop = Math.max(
    0,
    previousChatHistoryScrollTop + heightDelta,
  );
}

/**
 * Set the getActiveReaderItem function reference
 * Called by ChatPanelManager to avoid circular imports
 */
export function setActiveReaderItemFn(fn: () => Zotero.Item | null): void {
  getActiveReaderItemFn = fn;
}

/**
 * Set the togglePanelMode function reference
 * Called by ChatPanelManager to avoid circular imports
 */
export function setTogglePanelModeFn(fn: () => void): void {
  togglePanelModeFn = fn;
}

/**
 * Update panel mode button icon based on current mode
 */
export function updatePanelModeButtonIcon(
  container: HTMLElement,
  mode: PanelMode,
): void {
  const panelModeIcon = container.querySelector(
    "#chat-panel-mode-icon",
  ) as HTMLImageElement;
  const panelModeBtn = container.querySelector(
    "#chat-panel-mode-btn",
  ) as HTMLButtonElement;
  if (panelModeIcon && panelModeBtn) {
    // split.svg for sidebar mode (click to switch to floating)
    // right-bar.svg for floating mode (click to switch to sidebar)
    panelModeIcon.src =
      mode === "sidebar"
        ? `chrome://${config.addonRef}/content/icons/split.svg`
        : `chrome://${config.addonRef}/content/icons/right-bar.svg`;
    panelModeBtn.title =
      mode === "sidebar"
        ? getString("chat-switch-to-floating")
        : getString("chat-switch-to-sidebar");
  }
}

/**
 * Get the active reader item
 */
function getActiveReaderItem(): Zotero.Item | null {
  if (getActiveReaderItemFn) {
    return getActiveReaderItemFn();
  }
  return null;
}

/**
 * Fetch check-in status and update the check-in button in the user bar.
 * Call this once on init (if logged in) and after a successful login.
 */
export async function refreshCheckinDisplay(
  container: HTMLElement,
): Promise<void> {
  const checkinBtn = container.querySelector(
    "#chat-checkin-btn",
  ) as HTMLButtonElement | null;
  if (checkinBtn) {
    checkinBtn.style.display = "none";
  }
}

export function createPresentationButtonLaunchHandler(
  context: Pick<ChatPanelContext, "launchPresentation" | "appendError">,
  presentationBtn: Pick<HTMLButtonElement, "setAttribute" | "removeAttribute">,
  trackEntryClick: (repeatClick: boolean) => void = (repeatClick) =>
    trackPaperChatPresentationEntryClicked(
      getAnalyticsService(),
      "chat_button",
      { repeat_click: repeatClick },
    ),
): () => void {
  let pendingLaunch: Promise<boolean> | null = null;

  return () => {
    trackEntryClick(pendingLaunch !== null);
    if (pendingLaunch) {
      // Re-enter the shared coordinator so it can focus the existing settings
      // window. The original invocation remains responsible for reporting a
      // failure, which avoids duplicate error messages for the same Promise.
      void context.launchPresentation().catch(() => undefined);
      return;
    }

    presentationBtn.setAttribute("aria-busy", "true");
    const launch = context.launchPresentation();
    pendingLaunch = launch;
    void launch
      .catch((error) => {
        ztoolkit.log("[Chat] Failed to launch presentation:", error);
        context.appendError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (pendingLaunch === launch) {
          pendingLaunch = null;
          presentationBtn.removeAttribute("aria-busy");
        }
      });
  };
}

/**
 * Setup all event handlers for the chat panel
 */
export function setupEventHandlers(context: ChatPanelContext): () => void {
  const { container, chatManager } = context;

  // Disposers for listeners attached to long-lived targets (document/window).
  // Element-scoped listeners are freed with their nodes, but listeners on the
  // document or window outlive the panel and must be removed on teardown to
  // avoid leaking them (and the DOM they close over) on every panel rebuild.
  const disposers: Array<() => void> = [];
  const userMessageEditController = UserMessageEditController.attach(context);

  const openPluginPreferencesSafely = (): void => {
    Zotero.Utilities.Internal.openPreferences("paperchat-prefpane");
  };

  // Get DOM elements
  const messageInput = container.querySelector(
    "#chat-message-input",
  ) as HTMLTextAreaElement;
  const sendButton = container.querySelector(
    "#chat-send-button",
  ) as HTMLButtonElement;
  const newChatBtn = container.querySelector("#chat-new") as HTMLButtonElement;
  const uploadFileBtn = container.querySelector(
    "#chat-upload-file",
  ) as HTMLButtonElement;
  const figureScreenshotBtn = container.querySelector(
    "#chat-figure-screenshot-btn",
  ) as HTMLButtonElement | null;
  const historyBtn = container.querySelector(
    "#chat-history-btn",
  ) as HTMLButtonElement;
  const bookmarksBtn = container.querySelector(
    "#chat-bookmarks-btn",
  ) as HTMLButtonElement;
  const chatViewport = container.querySelector(
    "#chat-viewport",
  ) as HTMLElement | null;
  const summarizeConversationBtn = container.querySelector(
    "#chat-summarize-conversation-note",
  ) as HTMLButtonElement | null;
  const clearConversationBtn = container.querySelector(
    "#chat-clear-conversation",
  ) as HTMLButtonElement | null;
  const debugContextBtn = container.querySelector(
    "#chat-debug-context-btn",
  ) as HTMLButtonElement;
  const historyDropdown = container.querySelector(
    "#chat-history-dropdown",
  ) as HTMLElement;
  const attachmentsPreview = container.querySelector(
    "#chat-attachments-preview",
  ) as HTMLElement;
  const chatHistory = container.querySelector(
    "#chat-history",
  ) as HTMLElement | null;
  const scrollBottomBtn = container.querySelector(
    "#chat-scroll-bottom-btn",
  ) as HTMLButtonElement | null;
  const emptyState = container.querySelector(
    "#chat-empty-state",
  ) as HTMLElement;
  let conversationNavigator: ReturnType<typeof ensureConversationNavigator> = null;
  let submitPending = false;
  const submitMessage = async (): Promise<void> => {
    if (submitPending) return;
    submitPending = true;
    try {
      await sendMessage(context, messageInput, sendButton, attachmentsPreview);
    } finally {
      submitPending = false;
    }
  };
  const runQuickActionPrompt = async (prompt: string): Promise<void> => {
    if (submitPending) return;
    submitPending = true;
    try {
      await sendMessage(
        context,
        messageInput,
        sendButton,
        attachmentsPreview,
        prompt,
      );
    } finally {
      submitPending = false;
    }
  };
  void renderQuickActionsBar(context, getCurrentTheme(), runQuickActionPrompt);
  const turnQueue = container.querySelector(
    "#chat-turn-queue",
  ) as HTMLElement | null;

  disposers.push(
    sessionTurnQueue.subscribe((sessionId) => {
      const session = chatManager.getActiveSession();
      if (session?.id !== sessionId) return;
      syncSendButtonState(sendButton, chatManager);
      syncConversationSummaryButtonState(container, chatManager);
      context.renderMessages(session.messages);
    }),
  );
  syncSendButtonState(sendButton, chatManager);

  turnQueue?.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest(
      "button[data-queue-action]",
    ) as HTMLButtonElement | null;
    const session = chatManager.getActiveSession();
    const turnId = button?.getAttribute("data-turn-id");
    const action = button?.getAttribute("data-queue-action");
    if (!session || !turnId || !action) return;

    if (action === "delete") {
      sessionTurnQueue.remove(session.id, turnId);
      return;
    }
    if (action === "edit") {
      const draft = context.getAttachmentState();
      if (
        messageInput.value.trim() ||
        draft.pendingImages.length ||
        draft.pendingFiles.length ||
        draft.pendingSelectedText ||
        draft.pendingQuotedMessages.length
      ) {
        context.appendError(getString("chat-queue-draft-conflict"));
        return;
      }
      const turn = sessionTurnQueue.remove(session.id, turnId);
      if (!turn) return;
      messageInput.value = turn.draft.content;
      context.setAttachmentState(turn.draft.attachmentState);
      context.updateAttachmentsPreview();
      resizeMessageInput(messageInput, chatHistory);
      focusTextarea(messageInput);
      return;
    }
    if (action === "guide") {
      void sessionTurnQueue.guide(session.id, turnId).catch((error) => {
        context.appendError(
          error instanceof Error ? error.message : String(error),
        );
      });
    }
  });

  if (chatHistory) {
    chatHistory.addEventListener("scroll", () => {
      updateChatHistoryAutoScrollState(chatHistory);
      conversationNavigator?.syncScroll();
    });
    updateChatHistoryScrollBottomButton(chatHistory);
  }

  scrollBottomBtn?.addEventListener("click", () => {
    if (!chatHistory) return;
    scrollChatHistoryToBottom(chatHistory);
  });

  // History dropdown state
  const historyState = createHistoryDropdownState();
  let historySearchDisposer: (() => void) | null = null;
  const historyIntegration = { disposed: false };
  let historyBackfillStarted = false;
  let historyNavigationToken = 0;
  let historyNavigationTail: Promise<void> = Promise.resolve();
  let pendingHistoryMessageTarget: {
    sessionId: string;
    messageId: string;
    navigationToken: number;
  } | null = null;
  let historyNotice: HTMLElement | null = null;
  let historyNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHistoryNotice = (): void => {
    if (historyNoticeTimer) {
      clearTimeout(historyNoticeTimer);
      historyNoticeTimer = null;
    }
    historyNotice?.remove();
    historyNotice = null;
  };

  const showHistoryNotice = (message: string): void => {
    const doc = container.ownerDocument;
    if (!doc || historyIntegration.disposed) return;
    clearHistoryNotice();
    const theme = getCurrentTheme();
    const notice = createElement(
      doc,
      "div",
      {
        position: "absolute",
        top: "58px",
        left: "16px",
        right: "16px",
        zIndex: "10010",
        padding: "9px 12px",
        border: `1px solid ${theme.borderColor}`,
        borderRadius: "8px",
        background: theme.dropdownBg,
        color: theme.textPrimary,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
        fontSize: "12px",
        lineHeight: "18px",
        textAlign: "center",
        pointerEvents: "none",
      },
      {
        class: "chat-history-search-local-notice",
        role: "status",
        "aria-live": "polite",
      },
    );
    notice.textContent = message;
    container.appendChild(notice);
    historyNotice = notice;
    historyNoticeTimer = setTimeout(clearHistoryNotice, 2800);
  };

  const showHistoryTargetMissingNotice = (): void => {
    showHistoryNotice(getString("chat-history-search-target-missing"));
  };

  const invalidateHistoryNavigation = (): void => {
    historyNavigationToken += 1;
    pendingHistoryMessageTarget = null;
    clearHistoryNotice();
  };

  const reportHistoryNavigationError = (error: unknown): void => {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = rawMessage.trim() || getString("unknown");
    ztoolkit.log("[ChatPanel] History navigation/search error:", error);
    showHistoryNotice(message);
  };

  const openHistorySession = (
    sessionId: string,
    target?: { messageId: string },
  ): Promise<void> => {
    const navigationToken = ++historyNavigationToken;
    clearHistoryNotice();
    pendingHistoryMessageTarget = target
      ? { sessionId, messageId: target.messageId, navigationToken }
      : null;
    if (historyDropdown) historyDropdown.style.display = "none";

    const operation = historyNavigationTail.then(async () => {
      if (
        historyIntegration.disposed ||
        navigationToken !== historyNavigationToken
      ) {
        return;
      }

      ztoolkit.log("Loading session:", sessionId);
      const loadedSession = await chatManager.switchSession(sessionId);
      if (
        historyIntegration.disposed ||
        navigationToken !== historyNavigationToken
      ) {
        return;
      }
      if (!loadedSession) {
        pendingHistoryMessageTarget = null;
        if (target) showHistoryTargetMissingNotice();
        return;
      }

      syncSessionNavigationState(context, sendButton, chatManager);
      userMessageEditController.cancelEdit({ clearComposer: true });
      const itemKey = loadedSession.lastActiveItemKey;
      if (itemKey) {
        const libraryID =
          loadedSession.lastActiveItemLibraryID ??
          Zotero.Libraries.userLibraryID;
        const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
        if (item) {
          context.setCurrentItem(item as Zotero.Item);
          await context.updatePdfCheckboxVisibility(item as Zotero.Item);
        } else {
          context.setCurrentItem(null);
          await context.updatePdfCheckboxVisibility(null);
        }
      } else {
        context.setCurrentItem(null);
        await context.updatePdfCheckboxVisibility(null);
      }

      if (
        historyIntegration.disposed ||
        navigationToken !== historyNavigationToken
      ) {
        return;
      }

      const activeSession = chatManager.getActiveSession() || loadedSession;
      context.renderMessages(activeSession.messages);
      context.renderExecutionPlan(activeSession.executionPlan);
      updateModelSelectorDisplay(container);

      const renderFinalSession = (): void => {
        if (
          historyIntegration.disposed ||
          navigationToken !== historyNavigationToken
        ) {
          return;
        }
        const latestSession = chatManager.getActiveSession();
        if (!latestSession || latestSession.id !== sessionId) {
          pendingHistoryMessageTarget = null;
          return;
        }

        context.renderMessages(latestSession.messages, () => {
          const pendingTarget = pendingHistoryMessageTarget;
          if (
            !target ||
            !pendingTarget ||
            historyIntegration.disposed ||
            navigationToken !== historyNavigationToken ||
            pendingTarget.navigationToken !== navigationToken ||
            pendingTarget.sessionId !== sessionId ||
            pendingTarget.messageId !== target.messageId
          ) {
            return;
          }

          const found = chatHistory
            ? scrollToAndHighlightMessage(chatHistory, target.messageId)
            : null;
          pendingHistoryMessageTarget = null;
          if (!found) showHistoryTargetMissingNotice();
        });
        context.renderExecutionPlan(latestSession.executionPlan);
        updateModelSelectorDisplay(container);
      };

      const view = container.ownerDocument?.defaultView;
      if (view && typeof view.requestAnimationFrame === "function") {
        view.requestAnimationFrame(renderFinalSession);
      } else {
        setTimeout(renderFinalSession, 0);
      }
    });

    historyNavigationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.catch((error) => {
      if (navigationToken === historyNavigationToken) {
        pendingHistoryMessageTarget = null;
      }
      throw error;
    });
  };

  if (historyDropdown && container.ownerDocument) {
    historySearchDisposer = setupHistoryDropdownSearch(
      historyDropdown,
      container.ownerDocument,
      historyState,
      getCurrentTheme(),
      {
        searchGroups: (input) => chatManager.searchHistoryGroups(input),
        searchSessionMatches: (input) =>
          chatManager.searchHistorySessionMatches(input),
        onSelectTitleMatch: (sessionId) => openHistorySession(sessionId),
        onSelectMessageMatch: (sessionId, messageId) =>
          openHistorySession(sessionId, { messageId }),
        onSearchError: reportHistoryNavigationError,
      },
    );
  }

  // Send button
  sendButton?.addEventListener("click", async () => {
    ztoolkit.log("Send button clicked");
    const activeSession = chatManager.getActiveSession();
    if (
      activeSession &&
      sessionTurnQueue.snapshot(activeSession.id).status === "running" &&
      !messageInput.value.trim()
    ) {
      await sessionTurnQueue.stop(activeSession.id);
      syncSendButtonState(sendButton, chatManager);
      focusTextarea(messageInput);
      return;
    }
    await submitMessage();
  });

  // Input keydown - Enter sends now or queues behind the active turn.
  messageInput?.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Check if mention popup is open - if so, let mention selector handle Enter
      const mentionPopup = container.querySelector(
        "#chat-mention-popup",
      ) as HTMLElement;
      if (mentionPopup && mentionPopup.style.display === "block") {
        // Mention popup is open, don't send message (mention selector will handle it)
        return;
      }

      e.preventDefault();
      ztoolkit.log("Enter key pressed to send");
      void submitMessage();
    }
  });

  // Input auto-resize
  messageInput?.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      userMessageEditController.getEditingUserMessageId()
    ) {
      event.preventDefault();
      userMessageEditController.cancelEdit({ clearComposer: true });
    }
  });

  messageInput?.addEventListener("input", () => {
    resizeMessageInput(messageInput, chatHistory);
    syncSendButtonState(sendButton, chatManager);
  });

  // Set current item when input is focused
  messageInput?.addEventListener("focus", () => {
    const currentItem = context.getCurrentItem();
    if (!currentItem) {
      const item = getActiveReaderItem();
      if (item) {
        context.setCurrentItem(item);
      }
    }
  });

  // Handle Ctrl+C / Cmd+C for copying selected text
  container.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      const win = container.ownerDocument?.defaultView;
      const selection = win?.getSelection();
      const selectedText = selection?.toString();
      if (selectedText && selectedText.trim().length > 0) {
        e.preventDefault();
        copyToClipboard(selectedText);
        ztoolkit.log(
          "Copied selected text via Ctrl+C:",
          selectedText.substring(0, 50),
        );
      }
    }
  });

  // Make container focusable for keyboard events
  if (!container.hasAttribute("tabindex")) {
    container.setAttribute("tabindex", "-1");
  }

  resizeMessageInput(messageInput, chatHistory);

  // New chat button - create a new session
  newChatBtn?.addEventListener("click", async () => {
    ztoolkit.log("New chat button clicked");
    invalidateHistoryNavigation();
    userMessageEditController.cancelEdit({ clearComposer: true });

    // Create a new session
    const newSession = await chatManager.createNewSession();

    // The new session has its own queue state.
    syncSendButtonState(sendButton, chatManager);

    // Update current item from reader if available
    const item = getActiveReaderItem();
    if (item) {
      context.setCurrentItem(item);
      chatManager.setCurrentItemKey(item.key, item.libraryID);
    } else {
      context.setCurrentItem(null);
      chatManager.setCurrentItemKey(null);
    }

    // Clear attachments
    context.clearAttachments();
    context.updateAttachmentsPreview();

    context.renderMessages(newSession.messages);
    context.renderExecutionPlan(newSession.executionPlan);
    updateModelSelectorDisplay(container);

    ztoolkit.log("New session created:", newSession.id);
  });

  clearConversationBtn?.addEventListener("click", async () => {
    const session = chatManager.getActiveSession();
    if (!session?.messages.length) return;
    const confirmed = container.ownerDocument.defaultView?.confirm(
      getString("chat-clear-conversation-confirm"),
    );
    if (!confirmed) return;
    sessionTurnQueue.clear(session.id);
    invalidateHistoryNavigation();
    userMessageEditController.cancelEdit({ clearComposer: true });
    await chatManager.clearCurrentSession();
    context.clearAttachments();
    context.updateAttachmentsPreview();
    context.renderMessages([]);
    context.renderExecutionPlan(undefined);
    syncSendButtonState(sendButton, chatManager);
  });

  summarizeConversationBtn?.addEventListener("click", async () => {
    const session = chatManager.getActiveSession();
    if (!session) {
      return;
    }

    if (
      isConversationSummaryRunning(session.id) ||
      hasQueuedConversationSummary(session.id)
    ) {
      await sessionTurnQueue.stop(session.id);
      const snapshot = sessionTurnQueue.snapshot(session.id);
      for (const turn of snapshot.queued) {
        if (turn.id.startsWith(CONVERSATION_SUMMARY_TURN_PREFIX)) {
          sessionTurnQueue.remove(session.id, turn.id);
        }
      }
      resetConversationSummaryButtonBusyState(summarizeConversationBtn);
      syncConversationSummaryButtonState(container, chatManager);
      syncSendButtonState(sendButton, chatManager);
      return;
    }

    if (sessionTurnQueue.snapshot(session.id).status === "running") {
      return;
    }

    const summaryLabel = getString("chat-summarize-conversation-note");
    const summaryRunner = createTurnRunner({
      manager: chatManager,
      resolveSession: () => chatManager.getActiveSession() || session,
      send: async () => {
        await context.summarizeConversationToNote();
        return true;
      },
    });
    const turn: QueuedTurn = {
      id: `${CONVERSATION_SUMMARY_TURN_PREFIX}${Date.now()}-${++queuedTurnSequence}`,
      content: summaryLabel,
      draft: {
        content: summaryLabel,
        attachmentState: {
          pendingImages: [],
          pendingFiles: [],
          pendingSelectedText: null,
          pendingQuotedMessages: [],
        },
      },
      run: async (): Promise<TurnRunResult> => {
        summarizeConversationBtn.setAttribute(
          "data-summary-session-id",
          session.id,
        );
        syncConversationSummaryButtonState(container, chatManager);
        syncSendButtonState(sendButton, chatManager);
        try {
          return await summaryRunner();
        } finally {
          resetConversationSummaryButtonBusyState(summarizeConversationBtn);
          syncConversationSummaryButtonState(container, chatManager);
          syncSendButtonState(sendButton, chatManager);
        }
      },
      cancel: () => chatManager.cancelSessionTurn(session.id),
      onError: (error) => {
        if (chatManager.getActiveSession()?.id === session.id) {
          context.appendError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    };

    if (!sessionTurnQueue.enqueue(session.id, turn)) {
      context.appendError(getString("chat-queue-full"));
      return;
    }

    syncConversationSummaryButtonState(container, chatManager);
    syncSendButtonState(sendButton, chatManager);
  });

  debugContextBtn?.addEventListener("click", async () => {
    const originalText = debugContextBtn.textContent || "CTX";
    debugContextBtn.disabled = true;
    debugContextBtn.textContent = "...";
    let resetImmediately = true;
    try {
      const filePath = await chatManager.exportCurrentDebugContext(
        context.getCurrentItem(),
      );
      copyToClipboard(filePath);
      debugContextBtn.textContent = "\u2713";
      debugContextBtn.title = getString("chat-debug-context-exported");
      resetImmediately = false;
      setTimeout(() => {
        debugContextBtn.textContent = originalText;
        debugContextBtn.title = getString("chat-debug-context-export");
        debugContextBtn.disabled = false;
      }, 1600);
    } catch (error) {
      context.appendError(
        error instanceof Error ? error.message : String(error),
      );
      debugContextBtn.textContent = originalText;
    } finally {
      if (resetImmediately) {
        debugContextBtn.disabled = false;
      }
    }
  });

  // Upload file button - supports both images and text files
  uploadFileBtn?.addEventListener("click", async () => {
    ztoolkit.log("Upload file button clicked");
    const fp = new ztoolkit.FilePicker("Select File", "open", [
      [
        "All supported",
        "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.txt;*.md;*.json;*.xml;*.csv;*.log",
      ],
      ["Images", "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp"],
      ["Text files", "*.txt;*.md;*.json;*.xml;*.csv;*.log"],
    ]);
    const filePath = await fp.open();
    if (filePath) {
      const ext = filePath.toLowerCase().split(".").pop() || "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

      const extractor = chatManager.getPdfExtractor();
      const attachmentState = context.getAttachmentState();

      if (imageExts.includes(ext)) {
        // Handle as image
        const result = await extractor.imageFileToBase64(filePath);
        if (result) {
          const fileName = filePath.split(/[/\\]/).pop() || "image";
          ztoolkit.log(
            "[User Upload] Image uploaded:",
            fileName,
            "mimeType:",
            result.mimeType,
            "data length:",
            result.data.length,
          );
          attachmentState.pendingImages.push({
            type: "base64",
            data: result.data,
            mimeType: result.mimeType,
            name: fileName,
          });
          context.setAttachmentState(attachmentState);
          context.updateAttachmentsPreview();
        } else {
          ztoolkit.log("[User Upload] Failed to read image file:", filePath);
        }
      } else {
        // Handle as text file
        const fileContent = await extractor.readTextFile(filePath);
        if (fileContent) {
          const fileName = filePath.split(/[/\\]/).pop() || "file.txt";
          ztoolkit.log(
            "[User Upload] Text file uploaded:",
            fileName,
            "content length:",
            fileContent.length,
          );
          attachmentState.pendingFiles.push({
            name: fileName,
            content: fileContent.substring(0, 50000),
            type: "text",
          });
          context.setAttachmentState(attachmentState);
          context.updateAttachmentsPreview();
        } else {
          ztoolkit.log("[User Upload] Failed to read text file:", filePath);
        }
      }
    }
  });

  figureScreenshotBtn?.addEventListener("click", () => {
    if (!startReaderFigureScreenshot()) {
      context.appendError(getString("chat-reader-figure-screenshot-no-pdf"));
    }
  });

  const createBookmarkManagerActions = (): BookmarkManagerActions => ({
    onOpenBookmark: (_bookmark, bookmarks, index) =>
      openBookmarkReaderForContext(context, bookmarks, index),
    onJumpToChat: async (bookmark: BookmarkRecord) => {
      if (!bookmark.sessionId || !bookmark.messageId) {
        context.appendError(getString("chat-bookmark-open-unavailable"));
        return;
      }
      setBookmarkManagerVisible(container, false);
      await navigateToQuotedMessage(context, {
        sessionId: bookmark.sessionId,
        messageId: bookmark.messageId,
        role: "assistant",
        preview: bookmark.title,
        contentSnapshot: bookmark.content || bookmark.title,
        timestamp: bookmark.createdAt,
      });
    },
    onClose: () => {
      setBookmarkManagerVisible(container, false);
      if (historyDropdown) {
        historyDropdown.style.display = "none";
      }
    },
    onError: (message) => context.appendError(message),
    onSuccess: (message) => context.appendSuccess(message),
  });

  let bookmarkPanel = getBookmarkManagerPanel(container);
  if (!bookmarkPanel && chatViewport) {
    bookmarkPanel = createBookmarkManagerPanel(
      container.ownerDocument!,
      getCurrentTheme(),
      createBookmarkManagerActions(),
    );
    chatViewport.appendChild(bookmarkPanel);
  }

  bookmarksBtn?.addEventListener("click", async () => {
    if (!bookmarkPanel) return;
    const willShow = !isBookmarkManagerVisible(container);
    setBookmarkManagerVisible(container, willShow);
    if (willShow && historyDropdown) {
      historyDropdown.style.display = "none";
    }
    if (willShow) {
      await refreshBookmarkManagerPanel(
        container,
        getCurrentTheme(),
        createBookmarkManagerActions(),
      );
    }
  });

  // History button - toggle dropdown with pagination
  historyBtn?.addEventListener("click", async () => {
    ztoolkit.log("History button clicked");
    if (!historyDropdown) return;

    if (isBookmarkManagerVisible(container)) {
      setBookmarkManagerVisible(container, false);
    }

    const isNowVisible = toggleHistoryDropdown(historyDropdown, historyBtn);
    if (!isNowVisible) return;

    if (!historyBackfillStarted) {
      historyBackfillStarted = true;
      chatManager.startSearchHistoryBackfill();
    }

    // Populate ordinary history first. For an active query the dropdown keeps
    // its cached groups/scroll position visible while this refresh runs.
    await refreshHistoryDropdown();
  });

  // Helper function to refresh history dropdown
  const refreshHistoryDropdown = async () => {
    if (!historyDropdown || historyIntegration.disposed) return;

    const sessions = await chatManager.getAllSessions();
    if (historyIntegration.disposed) return;
    const theme = getCurrentTheme();

    populateHistoryDropdown(
      historyDropdown,
      container.ownerDocument!,
      sessions,
      historyState,
      theme,
      // onSelect callback
      (session: SessionInfo) => {
        void openHistorySession(session.id).catch(reportHistoryNavigationError);
      },
      // onDelete callback
      async (session: SessionInfo) => {
        ztoolkit.log("Deleting session:", session.id);
        const deletingActiveSession =
          chatManager.getActiveSession()?.id === session.id;
        sessionTurnQueue.clear(session.id);
        await chatManager.deleteSession(session.id);
        if (deletingActiveSession) {
          clearPendingQuotedMessages(context);
        }

        const activeSession = chatManager.getActiveSession();
        const itemKey = activeSession?.lastActiveItemKey;
        if (itemKey) {
          const libraryID =
            activeSession?.lastActiveItemLibraryID ??
            Zotero.Libraries.userLibraryID;
          const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
          if (item) {
            context.setCurrentItem(item as Zotero.Item);
            await context.updatePdfCheckboxVisibility(item as Zotero.Item);
          } else {
            context.setCurrentItem(null);
            await context.updatePdfCheckboxVisibility(null);
          }
        } else {
          context.setCurrentItem(null);
          await context.updatePdfCheckboxVisibility(null);
        }

        if (activeSession) {
          context.renderMessages(activeSession.messages);
        } else if (chatHistory && emptyState) {
          chatHistory.textContent = "";
          chatHistory.appendChild(emptyState);
          emptyState.style.display = "flex";
          updateConversationNoteSummaryButton(container, [], undefined, false);
        }
        updateModelSelectorDisplay(container);
        syncSendButtonState(sendButton, chatManager);

        // Refresh the dropdown to reflect the deletion
        await refreshHistoryDropdown();
      },
      async (session: SessionInfo, title: string | null) => {
        await chatManager.updateSessionTitle(session.id, title, "user");
        await refreshHistoryDropdown();
      },
    );

    // Empty/short queries remain on the ordinary list. An active query keeps
    // cached results visible and refreshes against the latest revision. A
    // hidden dropdown keeps its cache without doing foreground search work.
    if (historyDropdown.style.display !== "none") {
      await refreshHistoryDropdownSearch(historyDropdown);
    }
  };

  chatManager.setSessionListUpdateCallback(refreshHistoryDropdown);

  // Close dropdown when clicking outside
  if (historyDropdown && historyBtn) {
    setupClickOutsideHandler(container, historyDropdown, historyBtn);
  }

  // Model selector
  const modelSelectorBtn = container.querySelector(
    "#chat-model-selector-btn",
  ) as HTMLButtonElement;
  const modelDropdown = container.querySelector(
    "#chat-model-dropdown",
  ) as HTMLElement;

  if (modelSelectorBtn && modelDropdown) {
    // Initialize model selector text
    updateModelSelectorDisplay(container);

    // Toggle model dropdown
    modelSelectorBtn.addEventListener("click", () => {
      const isVisible = modelDropdown.style.display === "block";
      if (isVisible) {
        closeModelDropdown(modelDropdown);
      } else {
        populateModelDropdown(container, modelDropdown, context);
        positionModelDropdown(modelDropdown, modelSelectorBtn);
        modelDropdown.style.display = "block";
      }
    });

    // Close model dropdown when clicking outside
    const ownerDoc = container.ownerDocument;
    const closeModelDropdownOnOutsideClick = (e: Event): void => {
      const target = e.target as HTMLElement;
      if (
        !modelSelectorBtn.contains(target) &&
        !modelDropdown.contains(target)
      ) {
        closeModelDropdown(modelDropdown);
      }
    };
    ownerDoc?.addEventListener("click", closeModelDropdownOnOutsideClick);
    disposers.push(() =>
      ownerDoc?.removeEventListener("click", closeModelDropdownOnOutsideClick),
    );
  }

  const contextUsageBtn = container.querySelector(
    "#chat-context-usage-btn",
  ) as HTMLButtonElement | null;
  const contextUsageTooltip = container.querySelector(
    "#chat-context-usage-tooltip",
  ) as HTMLElement | null;
  if (contextUsageBtn && contextUsageTooltip) {
    const showContextUsageTooltip = () => {
      updateContextWindowUsageDisplay(
        container,
        getCurrentTheme(),
        getChatManager().getActiveSession(),
      );
      contextUsageTooltip.style.display = "flex";
      contextUsageTooltip.style.visibility = "hidden";
      positionContextWindowUsageTooltip(container);
      contextUsageTooltip.style.visibility = "visible";
    };
    const hideContextUsageTooltip = () => {
      contextUsageTooltip.style.display = "none";
    };

    const onContextUsageEnter = () => {
      contextUsageBtn.style.background = getCurrentTheme().buttonHoverBg;
      showContextUsageTooltip();
    };
    const onContextUsageLeave = () => {
      contextUsageBtn.style.background = "transparent";
      hideContextUsageTooltip();
    };

    contextUsageBtn.addEventListener("mouseenter", onContextUsageEnter);
    contextUsageBtn.addEventListener("mouseleave", onContextUsageLeave);
    contextUsageBtn.addEventListener("focus", showContextUsageTooltip);
    contextUsageBtn.addEventListener("blur", hideContextUsageTooltip);
    disposers.push(() => {
      contextUsageBtn.removeEventListener("mouseenter", onContextUsageEnter);
      contextUsageBtn.removeEventListener("mouseleave", onContextUsageLeave);
      contextUsageBtn.removeEventListener("focus", showContextUsageTooltip);
      contextUsageBtn.removeEventListener("blur", hideContextUsageTooltip);
    });
  }

  // Settings button - open preferences
  const settingsBtn = container.querySelector(
    "#chat-settings-btn",
  ) as HTMLButtonElement;
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      ztoolkit.log("Settings button clicked");
      openPluginPreferencesSafely();
    });

    // Hover effect
    settingsBtn.addEventListener("mouseenter", () => {
      settingsBtn.style.background = getCurrentTheme().dropdownItemHoverBg;
    });
    settingsBtn.addEventListener("mouseleave", () => {
      settingsBtn.style.background = "transparent";
    });
  }

  // User bar settings button (visible when not logged in) - open preferences
  const userBarSettingsBtn = container.querySelector(
    "#chat-user-bar-settings-btn",
  ) as HTMLButtonElement;
  if (userBarSettingsBtn) {
    userBarSettingsBtn.addEventListener("click", () => {
      ztoolkit.log("User bar settings button clicked");
      openPluginPreferencesSafely();
    });

    // Hover effect
    userBarSettingsBtn.addEventListener("mouseenter", () => {
      userBarSettingsBtn.style.background = "rgba(255, 255, 255, 0.3)";
    });
    userBarSettingsBtn.addEventListener("mouseleave", () => {
      userBarSettingsBtn.style.background = "rgba(255, 255, 255, 0.15)";
    });
  }

  // Panel mode toggle button - switch between sidebar and floating mode
  const panelModeBtn = container.querySelector(
    "#chat-panel-mode-btn",
  ) as HTMLButtonElement;
  if (panelModeBtn) {
    panelModeBtn.addEventListener("click", () => {
      ztoolkit.log("Panel mode toggle button clicked");
      if (togglePanelModeFn) {
        togglePanelModeFn();
      }
    });
  }

  // @ Mention selector
  disposers.push(setupMentionSelector(context));

  // Conversation navigator (non-critical; must not block panel controls)
  try {
    conversationNavigator = ensureConversationNavigator(
      container,
      getCurrentTheme(),
    );
    disposers.push(() => disposeConversationNavigator(container));
  } catch (error) {
    ztoolkit.log("[ChatPanel] Conversation navigator init failed:", error);
  }

  ztoolkit.log("Event listeners attached to buttons");

  return () => {
    if (historyIntegration.disposed) return;
    historyIntegration.disposed = true;
    invalidateHistoryNavigation();
    historySearchDisposer?.();
    historySearchDisposer = null;
    clearHistoryNotice();
    disposers.forEach((dispose) => dispose());
    disposers.length = 0;
  };
}

const PENDING_IMAGE_HOVER_PREVIEW_ATTR = "data-paperchat-image-hover-preview";

function clearPendingImageHoverPreviews(doc: Document): void {
  if (typeof doc.querySelectorAll !== "function") {
    return;
  }
  doc
    .querySelectorAll(`[${PENDING_IMAGE_HOVER_PREVIEW_ATTR}]`)
    .forEach((node) => {
      node.remove();
    });
}

/**
 * Show an enlarged preview when hovering a pending image attachment chip.
 */
function attachPendingImageHoverPreview(
  anchor: HTMLElement,
  imageSrc: string,
  doc: Document,
): { cleanup: () => void } {
  let preview: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const removePreview = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    preview?.remove();
    preview = null;
  };

  const positionPreview = () => {
    if (!preview) return;
    const rect = anchor.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const viewportWidth = doc.defaultView?.innerWidth ?? previewRect.width;
    const viewportHeight = doc.defaultView?.innerHeight ?? previewRect.height;
    const left = Math.max(
      8,
      Math.min(rect.left, viewportWidth - previewRect.width - 8),
    );
    let top = rect.top - previewRect.height - 8;
    if (top < 8) {
      top = Math.min(rect.bottom + 8, viewportHeight - previewRect.height - 8);
    }
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  };

  const showPreview = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    removePreview();
    const theme = getCurrentTheme();
    const viewportWidth = doc.defaultView?.innerWidth ?? 800;
    const viewportHeight = doc.defaultView?.innerHeight ?? 600;
    preview = createElement(doc, "div", {
      position: "fixed",
      zIndex: "2147483647",
      padding: "6px",
      borderRadius: "8px",
      background: theme.containerBg,
      border: `1px solid ${theme.borderColor}`,
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      pointerEvents: "none",
    });
    preview.setAttribute(PENDING_IMAGE_HOVER_PREVIEW_ATTR, "true");
    const image = createElement(
      doc,
      "img",
      {
        display: "block",
        maxWidth: `${Math.min(480, Math.round(viewportWidth * 0.8))}px`,
        maxHeight: `${Math.min(360, Math.round(viewportHeight * 0.6))}px`,
        width: "auto",
        height: "auto",
        objectFit: "contain",
        borderRadius: "4px",
      },
      { src: imageSrc, alt: "" },
    );
    preview.appendChild(image);
    doc.documentElement.appendChild(preview);
    positionPreview();
    image.addEventListener("load", positionPreview);
  };

  anchor.style.cursor = "zoom-in";
  anchor.addEventListener("mouseenter", showPreview);
  anchor.addEventListener("mouseleave", () => {
    hideTimer = setTimeout(removePreview, 80);
  });

  return { cleanup: removePreview };
}

/**
 * Update attachments preview display
 */
export function updateAttachmentsPreviewDisplay(
  container: HTMLElement,
  attachmentState: AttachmentState,
  actions: AttachmentPreviewActions = {},
): void {
  const attachmentsPreview = container.querySelector(
    "#chat-attachments-preview",
  ) as HTMLElement;
  if (!attachmentsPreview) return;

  const doc = container.ownerDocument!;
  clearPendingImageHoverPreviews(doc);
  attachmentsPreview.textContent = "";
  const theme = getCurrentTheme();

  const createTag = (): HTMLElement =>
    createElement(doc, "span", {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      minWidth: "0",
      maxWidth: "100%",
      background: theme.inputBg,
      border: `1px solid ${theme.borderColor}`,
      borderRadius: "6px",
      padding: "4px 8px",
      fontSize: "11px",
      color: theme.textSecondary,
    });

  const createLabel = (text: string): HTMLElement => {
    const label = createElement(doc, "span", {
      minWidth: "0",
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
    });
    label.textContent = text;
    return label;
  };

  const createRemoveButton = (
    label: string,
    onRemove: () => void,
  ): HTMLElement => {
    const removeBtn = createElement(
      doc,
      "button",
      {
        flex: "0 0 auto",
        width: "18px",
        height: "18px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        padding: "0",
        cursor: "pointer",
        fontSize: "12px",
        color: theme.textSecondary,
        opacity: "0.7",
        lineHeight: "1",
      },
      { type: "button", "aria-label": label },
    );
    removeBtn.textContent = "x";
    removeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    });
    removeBtn.addEventListener("mouseenter", () => {
      removeBtn.style.opacity = "1";
    });
    removeBtn.addEventListener("mouseleave", () => {
      removeBtn.style.opacity = "0.7";
    });
    return removeBtn;
  };

  attachmentState.pendingQuotedMessages.forEach((quote, index) => {
    const tag = createTag();
    tag.setAttribute("class", "pending-quoted-message");
    tag.setAttribute("data-quoted-message-id", quote.messageId);
    tag.setAttribute("title", quote.preview);
    tag.appendChild(
      createLabel(`${getString("chat-quoted-reply")}: ${quote.preview}`),
    );
    if (actions.onRemoveQuote) {
      tag.appendChild(
        createRemoveButton(getString("chat-remove-quoted-reply"), () =>
          actions.onRemoveQuote?.(index),
        ),
      );
    }
    if (actions.onNavigateQuote) {
      tag.setAttribute("role", "button");
      tag.setAttribute("tabindex", "0");
      tag.style.cursor = "pointer";
      const navigate = () => {
        void Promise.resolve(actions.onNavigateQuote?.(quote)).catch(
          (error: unknown) => {
            ztoolkit.log("[ChatPanel] Quote navigation failed:", error);
          },
        );
      };
      tag.addEventListener("click", navigate);
      tag.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        navigate();
      });
    }
    attachmentsPreview.appendChild(tag);
  });

  if (attachmentState.pendingSelectedText) {
    const selectedText = attachmentState.pendingSelectedText;
    const preview = createPendingSelectedTextPreview(selectedText);
    const tag = createTag();
    tag.setAttribute("class", "pending-selected-text");
    tag.setAttribute("title", selectedText);
    tag.appendChild(
      createLabel(`${getString("chat-reader-selected-text")}: ${preview}`),
    );
    if (actions.onRemoveSelectedText) {
      tag.appendChild(
        createRemoveButton(getString("chat-remove-reader-selected-text"), () =>
          actions.onRemoveSelectedText?.(),
        ),
      );
    }
    attachmentsPreview.appendChild(tag);
  }

  const getImageSrc = (image: ImageAttachment): string =>
    image.type === "base64"
      ? `data:${image.mimeType};base64,${image.data}`
      : image.data;

  attachmentState.pendingImages.forEach((image, index) => {
    const tag = createTag();
    tag.setAttribute("class", "pending-image-attachment");
    const imageSrc = getImageSrc(image);
    tag.appendChild(
      createElement(
        doc,
        "img",
        {
          flex: "0 0 auto",
          width: "32px",
          height: "32px",
          borderRadius: "4px",
          objectFit: "cover",
          background: theme.buttonBg,
        },
        {
          src: imageSrc,
          alt: image.name || "Attached image",
          title: image.name || "Attached image",
        },
      ),
    );
    tag.appendChild(createLabel(image.name || "image"));
    const hoverPreview = attachPendingImageHoverPreview(tag, imageSrc, doc);
    if (actions.onRemoveImage) {
      tag.appendChild(
        createRemoveButton(`Remove ${image.name || "image"}`, () => {
          hoverPreview.cleanup();
          actions.onRemoveImage?.(index);
        }),
      );
    }
    attachmentsPreview.appendChild(tag);
  });

  for (const file of attachmentState.pendingFiles) {
    const tag = createTag();
    tag.appendChild(createLabel(file.name));
    attachmentsPreview.appendChild(tag);
  }

  const attachmentCount =
    attachmentState.pendingQuotedMessages.length +
    attachmentState.pendingImages.length +
    attachmentState.pendingFiles.length +
    (attachmentState.pendingSelectedText ? 1 : 0);
  attachmentsPreview.style.display = attachmentCount > 0 ? "flex" : "none";
}

function renderTurnQueue(container: HTMLElement, sessionId?: string): void {
  const queue = container.querySelector(
    "#chat-turn-queue",
  ) as HTMLElement | null;
  if (!queue) return;

  const turns = sessionId ? sessionTurnQueue.snapshot(sessionId).queued : [];
  queue.textContent = "";
  queue.style.display = turns.length ? "flex" : "none";

  const theme = getCurrentTheme();
  for (const turn of turns) {
    const row = createElement(queue.ownerDocument, "div", {
      display: "flex",
      alignItems: "center",
      minHeight: "20px",
      padding: "1px 0",
      gap: "4px",
      color: theme.textSecondary,
      fontSize: "11px",
    });
    const preview = createElement(queue.ownerDocument, "span", {
      flex: "1",
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    preview.textContent = turn.content;
    preview.title = turn.content;
    row.appendChild(preview);

    for (const [action, label] of [
      ["edit", getString("chat-queue-edit")],
      ["guide", getString("chat-queue-guide")],
      ["delete", getString("chat-queue-delete")],
    ] as const) {
      const button = createElement(
        queue.ownerDocument,
        "button",
        {
          flex: "0 0 auto",
          padding: "1px 2px",
          border: "none",
          background: "transparent",
          color: theme.textSecondary,
          cursor: "pointer",
          fontSize: "11px",
        },
        {
          type: "button",
          title: label,
          "aria-label": label,
          "data-turn-id": turn.id,
          "data-queue-action": action,
        },
      );
      button.textContent = label;
      row.appendChild(button);
    }
    queue.appendChild(row);
  }
}

function updateSendButtonPresentation(
  sendButton: HTMLButtonElement,
  isRunning: boolean,
): void {
  const icon = sendButton.querySelector(
    "#chat-send-icon",
  ) as HTMLElement | null;
  sendButton.disabled = false;
  sendButton.style.opacity = "1";
  sendButton.style.cursor = "pointer";
  sendButton.title = isRunning
    ? getString("chat-stop-generating")
    : getString("chat-send");
  sendButton.setAttribute("aria-label", sendButton.title);

  if (!icon) {
    return;
  }

  if (icon.tagName.toLowerCase() === "img") {
    const imageIcon = icon as HTMLElement;
    if (isRunning) {
      imageIcon.removeAttribute("src");
      imageIcon.style.display = "flex";
      imageIcon.style.alignItems = "center";
      imageIcon.style.justifyContent = "center";
      imageIcon.style.width = "12px";
      imageIcon.style.height = "12px";
      imageIcon.style.background = "currentColor";
      imageIcon.style.borderRadius = "2px";
    } else {
      imageIcon.setAttribute(
        "src",
        `chrome://${config.addonRef}/content/icons/send.svg`,
      );
      imageIcon.style.display = "block";
      imageIcon.style.width = "16px";
      imageIcon.style.height = "16px";
      imageIcon.style.background = "";
      imageIcon.style.borderRadius = "";
    }
    return;
  }

  icon.textContent = isRunning ? "■" : "↑";
  icon.style.fontSize = isRunning ? "12px" : "16px";
  icon.style.fontWeight = "700";
}

export function syncSendButtonState(
  sendButton: HTMLButtonElement | null,
  chatManager: ChatPanelContext["chatManager"],
): void {
  if (!sendButton) return;
  const activeSession = chatManager.getActiveSession();
  const root = sendButton.closest(".chat-panel-root") as HTMLElement | null;
  const input = root?.querySelector(
    "#chat-message-input",
  ) as HTMLTextAreaElement | null;
  const isRunning = activeSession
    ? sessionTurnQueue.snapshot(activeSession.id).status === "running"
    : false;
  updateSendButtonPresentation(sendButton, isRunning && !input?.value.trim());
  if (root) renderTurnQueue(root, activeSession?.id);
}

function createTurnRunner(options: {
  manager: ChatPanelContext["chatManager"];
  resolveSession: () => ChatSession;
  send: (session: ChatSession) => Promise<boolean>;
}): () => Promise<TurnRunResult> {
  const run = async (retryErrorId?: string): Promise<TurnRunResult> => {
    const session = options.resolveSession();
    const previousErrorIds = new Set(
      session.messages
        .filter((message) => message.role === "error")
        .map((message) => message.id),
    );
    const accepted = retryErrorId
      ? await options.manager.retryFailedTurn(session.id, retryErrorId)
      : await options.send(session);
    if (!accepted) return { accepted: false };

    const error = [...options.resolveSession().messages]
      .reverse()
      .find(
        (message) =>
          message.role === "error" && !previousErrorIds.has(message.id),
      );
    return error
      ? {
          accepted: true,
          errorId: error.id,
          retry: () => run(error.id),
        }
      : { accepted: true };
  };
  return () => run();
}

/**
 * Send a message
 * PDF is automatically detected and attached if the item has a PDF
 */
async function sendMessage(
  context: ChatPanelContext,
  messageInput: HTMLTextAreaElement | null,
  sendButton: HTMLButtonElement | null,
  _attachmentsPreview: HTMLElement | null,
  presetContent?: string,
): Promise<void> {
  const { chatManager } = context;
  const chatHistory = context.container.querySelector(
    "#chat-history",
  ) as HTMLElement | null;
  const session = chatManager.getActiveSession();
  if (!session) return;

  try {
    const content = presetContent?.trim() || messageInput?.value?.trim();
    if (!content) return;

    const editController = UserMessageEditController.get(context.container);
    if (editController && !(await editController.prepareEditResend())) {
      return;
    }
    const editUserMessageId =
      editController?.consumePendingResendUserMessageId() ?? undefined;

    // Get active reader item first (used for PDF attachment)
    const activeReaderItem = getActiveReaderItem();

    // Use current item or fall back to active reader
    let item = context.getCurrentItem();
    if (!item) {
      item = activeReaderItem;
      if (item) {
        context.setCurrentItem(item);
      }
    }

    // Check provider authentication/readiness
    const providerManager = getProviderManager();
    const activeProviderId = providerManager.getActiveProviderId();
    const activeProvider = providerManager.getActiveProvider();

    if (!activeProvider?.isReady()) {
      ztoolkit.log("Provider not ready:", activeProviderId);
      throw new Error(getString("chat-error-no-provider"));
    }

    const attachmentState = context.getAttachmentState();
    const shouldAttachPdf = activeReaderItem !== null;
    const attachmentOptions = {
      images:
        attachmentState.pendingImages.length > 0
          ? attachmentState.pendingImages
          : undefined,
      files:
        attachmentState.pendingFiles.length > 0
          ? attachmentState.pendingFiles
          : undefined,
      selectedText: attachmentState.pendingSelectedText || undefined,
      quotedMessages:
        attachmentState.pendingQuotedMessages.length > 0
          ? attachmentState.pendingQuotedMessages
          : undefined,
    };

    // Determine target item: use active reader if attaching PDF, otherwise use chat context
    let targetItem = item;
    if (shouldAttachPdf) {
      targetItem = activeReaderItem;
      context.setCurrentItem(activeReaderItem!);
    }

    // Set current item for global chat if needed
    if (!targetItem || targetItem.id === 0) {
      if (!context.getCurrentItem()) {
        context.setCurrentItem({ id: 0 } as Zotero.Item);
      }
    }

    let retainedSession = session;
    const resolveSession = () => {
      const current = chatManager.getActiveSession();
      if (current?.id === session.id) retainedSession = current;
      return retainedSession;
    };
    const run = createTurnRunner({
      manager: chatManager,
      resolveSession,
      send: async (targetSession) => {
        const accepted = await chatManager.sendMessage(content, {
          item: targetItem,
          attachPdf: shouldAttachPdf,
          targetSession,
          reuseUserMessageId: editUserMessageId,
          editExistingUserMessage: !!editUserMessageId,
          ...attachmentOptions,
        });
        return accepted;
      },
    });
    const turn: QueuedTurn = {
      id: `${Date.now()}-${++queuedTurnSequence}`,
      content,
      draft: { content, attachmentState },
      run,
      cancel: () => chatManager.cancelSessionTurn(session.id),
      onError: (error) => {
        if (chatManager.getActiveSession()?.id === session.id) {
          context.appendError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    };
    if (!sessionTurnQueue.enqueue(session.id, turn)) {
      const queueFullMessage = getString("chat-queue-full");
      const queueFullMessageExists = Array.from(
        context.container.querySelectorAll(
          ".error-message-wrapper .message-content",
        ),
      ).some((element) => element?.textContent === `⚠️ ${queueFullMessage}`);
      if (!queueFullMessageExists) {
        context.appendError(queueFullMessage);
      }
      return;
    }

    if (messageInput) {
      messageInput.value = "";
      resizeMessageInput(messageInput, chatHistory);
    }
    context.clearAttachments();
    context.updateAttachmentsPreview();
  } catch (error) {
    ztoolkit.log("Error in sendMessage:", error);
    context.appendError(error instanceof Error ? error.message : String(error));
  } finally {
    syncSendButtonState(sendButton, chatManager);
    focusTextarea(messageInput);
  }
}

/**
 * Update user bar display
 * Only shows user bar when PaperChat provider is active
 */
export function updateUserBarDisplay(container: HTMLElement): void {
  const userBar = container.querySelector("#chat-user-bar") as HTMLElement | null;
  if (userBar) {
    userBar.style.display = "none";
  }
}

/**
 * Update PDF checkbox visibility (deprecated - checkbox removed)
 * PDF is now auto-detected and attached via tool calling.
 * Also refreshes the context item banner above the composer.
 */
export async function updatePdfCheckboxVisibilityForItem(
  container: HTMLElement,
  item: Zotero.Item | null,
  chatManager: { hasPdfAttachment(item: Zotero.Item): Promise<boolean> },
): Promise<void> {
  await updateContextItemBannerForItem(container, item, chatManager);
}

/**
 * Focus the message input
 */
export function focusInput(container: HTMLElement): void {
  const messageInput = container.querySelector(
    "#chat-message-input",
  ) as HTMLTextAreaElement;
  focusTextarea(messageInput);
}

/**
 * Update model selector display with current model
 */
export function updateModelSelectorDisplay(container: HTMLElement): void {
  const modelSelectorText = container.querySelector(
    "#chat-model-selector-text",
  ) as HTMLElement | null;
  const session = getChatManager().getActiveSession();
  const refreshContextUsage = () => {
    updateContextWindowUsageDisplay(container, getCurrentTheme(), session);
  };

  if (!modelSelectorText) {
    refreshContextUsage();
    return;
  }

  const providerManager = getProviderManager();
  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider) {
    modelSelectorText.textContent = getString("chat-select-model");
    refreshContextUsage();
    return;
  }

  const currentModel = getPref("model") as string;
  if (currentModel) {
    const modelShort = formatModelLabel(
      currentModel,
      providerManager.getActiveProviderId() || undefined,
    );
    modelSelectorText.textContent = `${activeProvider.getName()}: ${modelShort}`;
  } else {
    modelSelectorText.textContent = activeProvider.getName();
  }
  refreshContextUsage();
}

export function refreshContextWindowUsageForContainer(
  container: HTMLElement,
): void {
  scheduleContextWindowUsageRefresh(
    container,
    getCurrentTheme(),
    getChatManager().getActiveSession(),
  );
}

/**
 * Populate model dropdown with providers and their models
 */
function closeModelDropdown(dropdown: HTMLElement): void {
  dropdown.style.display = "none";
}

function positionModelDropdown(
  dropdown: HTMLElement,
  anchorBtn: HTMLElement,
): void {
  const root = dropdown.parentElement;
  const rootRect = root?.getBoundingClientRect();
  const anchorRect = anchorBtn.getBoundingClientRect();
  if (!rootRect) {
    return;
  }

  const margin = 8;
  const gap = 6;
  const preferredWidth = 240;
  const width = Math.min(
    preferredWidth,
    Math.max(180, rootRect.width - margin * 2),
  );
  let left = anchorRect.left - rootRect.left;
  if (left + width > rootRect.width - margin) {
    left = Math.max(margin, rootRect.width - width - margin);
  }
  if (left < margin) {
    left = margin;
  }

  const bottom = Math.max(gap, rootRect.bottom - anchorRect.top + gap);
  const maxHeight = Math.max(120, anchorRect.top - rootRect.top - margin - gap);

  dropdown.style.left = `${left}px`;
  dropdown.style.right = "auto";
  dropdown.style.top = "auto";
  dropdown.style.bottom = `${bottom}px`;
  dropdown.style.width = `${width}px`;
  dropdown.style.maxHeight = `${Math.min(280, maxHeight)}px`;
}

function populateModelDropdown(
  container: HTMLElement,
  dropdown: HTMLElement,
  context: ChatPanelContext,
): void {
  const doc = container.ownerDocument!;
  const theme = getCurrentTheme();
  dropdown.textContent = "";
  dropdown.style.overflowX = "hidden";
  dropdown.style.overflowY = "auto";

  const providerManager = getProviderManager();
  const providers = providerManager.getConfiguredProviders();
  const activeProviderId = providerManager.getActiveProviderId();

  for (const provider of providers) {
    const config = provider.config;
    const models = config.availableModels || [];
    const isActiveProvider = config.id === activeProviderId;

    const sectionHeader = createElement(doc, "div", {
      padding: "8px 12px",
      fontSize: "11px",
      fontWeight: "600",
      color: theme.textMuted,
      background: theme.buttonBg,
      borderBottom: `1px solid ${theme.borderColor}`,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    });
    sectionHeader.textContent = provider.getName();
    dropdown.appendChild(sectionHeader);

    if (models.length === 0) {
      // No models - show placeholder
      const noModels = createElement(doc, "div", {
        padding: "8px 12px",
        fontSize: "12px",
        color: theme.textMuted,
        fontStyle: "italic",
      });
      noModels.textContent = getString("chat-no-models");
      dropdown.appendChild(noModels);
    } else {
      // List models
      for (const model of models) {
        const currentModel = getPref("model") as string;
        const isCurrentModel = isActiveProvider && model === currentModel;

        const modelItem = createElement(doc, "div", {
          padding: "8px 12px",
          fontSize: "12px",
          color: isCurrentModel
            ? theme.inputFocusBorderColor
            : theme.textPrimary,
          cursor: "pointer",
          background: isCurrentModel
            ? theme.dropdownItemHoverBg
            : "transparent",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        });

        // Checkmark for current model
        if (isCurrentModel) {
          const check = createElement(doc, "span", {
            color: theme.inputFocusBorderColor,
            fontWeight: "bold",
          });
          check.textContent = "✓";
          modelItem.appendChild(check);
        }

        const modelName = createElement(doc, "span", {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        });
        modelName.textContent = formatModelLabel(model, config.id);
        modelItem.appendChild(modelName);

        // Hover effect
        modelItem.addEventListener("mouseenter", () => {
          if (!isCurrentModel) {
            modelItem.style.background = theme.dropdownItemHoverBg;
          }
        });
        modelItem.addEventListener("mouseleave", () => {
          if (!isCurrentModel) {
            modelItem.style.background = "transparent";
          }
        });

        // Click to select model
        modelItem.addEventListener("click", async () => {
          const previousProviderId = providerManager.getActiveProviderId();
          const previousModel = getPref("model") as string | undefined;

          try {
            // Switch provider if needed
            if (!isActiveProvider) {
              providerManager.setActiveProvider(config.id);
            }

            // Set model
            setPref("model", model);

            // Update provider config
            providerManager.updateProviderConfig(config.id, {
              defaultModel: model,
            });

            trackChatModelSwitched({
              source: "model_dropdown",
              previous_provider: previousProviderId || "unknown",
              provider: config.id,
              previous_model: previousModel || "",
              model,
            });

            // Update display and close dropdown
            updateModelSelectorDisplay(container);
            closeModelDropdown(dropdown);

            // Update user bar (provider might have changed)
            context.updateUserBar();

            ztoolkit.log(`Model switched to: ${config.id}/${model}`);
          } catch (error) {
            context.appendError(
              error instanceof Error ? error.message : String(error),
            );
          }
        });

        dropdown.appendChild(modelItem);
      }
    }
  }

  // If no providers configured
  if (providers.length === 0) {
    const noProviders = createElement(doc, "div", {
      padding: "12px",
      fontSize: "12px",
      color: theme.textMuted,
      textAlign: "center",
    });
    noProviders.textContent = getString("chat-configure-provider");
    dropdown.appendChild(noProviders);
  }
}

// ========== @ Mention Selector ==========

/**
 * Setup @ mention selector for the chat input
 * When user types @, show a popup to select resources (Items, Attachments, Notes)
 * Selected resource will be inserted as @[title](library:ID,key:XXX) when the
 * library identity is available.
 */
function setupMentionSelector(context: ChatPanelContext): () => void {
  const { container } = context;
  const theme = getCurrentTheme();

  const messageInput = container.querySelector(
    "#chat-message-input",
  ) as HTMLTextAreaElement;
  const mentionPopup = container.querySelector(
    "#chat-mention-popup",
  ) as HTMLElement;

  if (!messageInput || !mentionPopup) {
    ztoolkit.log("[MentionSelector] Required elements not found");
    return () => {};
  }

  // Create and initialize the MentionSelector
  const mentionSelector = new MentionSelector(
    mentionPopup,
    theme,
    (resource: MentionResource) => {
      if (editingMentionRange) {
        // Replace existing mention
        replaceMentionInInput(messageInput, editingMentionRange, resource);
        editingMentionRange = null;
      } else {
        // Insert new mention
        insertMentionIntoInput(messageInput, resource);
      }
      ztoolkit.log(
        `[MentionSelector] Selected: ${resource.type}/${resource.key} - ${resource.title}`,
      );
    },
  );

  // Track the position where @ was typed
  let mentionStartPos = -1;
  // Track if we're editing an existing @[...] mention
  let editingMentionRange: { start: number; end: number } | null = null;
  // Track if we're in IME composition mode
  let isComposing = false;

  // Helper to close popup and reset state
  const closeMentionPopup = () => {
    mentionSelector.hide();
    mentionStartPos = -1;
    editingMentionRange = null;
  };

  // Check if cursor is inside an existing @[...] mention and reopen popup
  const checkCursorInMention = async () => {
    if (mentionSelector.isVisible()) return;
    const cursorPos = messageInput.selectionStart;
    const text = messageInput.value;
    const mention = findMentionAtCursor(text, cursorPos);
    if (!mention) return;

    editingMentionRange = { start: mention.start, end: mention.end };
    mentionStartPos = mention.start + 1;
    try {
      await mentionSelector.show();
      // Verify edit mode wasn't cancelled while loading resources
      if (editingMentionRange) {
        mentionSelector.filterImmediate(mention.title);
      }
    } catch {
      // Resource loading failed, reset state
      closeMentionPopup();
    }
  };

  // Helper function to update filter based on current input state
  const updateMentionFilter = (immediate: boolean = false) => {
    if (!mentionSelector.isVisible()) return;

    const cursorPos = messageInput.selectionStart;
    const text = messageInput.value;
    const beforeCursor = text.substring(0, cursorPos);
    const atPos = beforeCursor.lastIndexOf("@");

    // @ was deleted or cursor moved before @
    if (atPos === -1 || (mentionStartPos >= 0 && atPos < mentionStartPos - 1)) {
      closeMentionPopup();
      return;
    }

    // Extract query after @
    const query = beforeCursor.substring(atPos + 1);

    // If query contains space or newline, close popup (user finished mention)
    if (/[\s\n]/.test(query)) {
      closeMentionPopup();
      return;
    }

    // Update filter
    if (immediate) {
      mentionSelector.filterImmediate(query);
    } else {
      mentionSelector.filter(query);
    }
  };

  // Handle IME composition events (for Chinese/Japanese/Korean input)
  messageInput.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  messageInput.addEventListener("compositionend", () => {
    isComposing = false;
    // After IME composition ends, update filter with the composed text
    if (mentionSelector.isVisible()) {
      updateMentionFilter(true); // immediate update for IME
    }
  });

  // Handle input events - detect @ typing
  messageInput.addEventListener("input", (e: Event) => {
    const inputEvent = e as InputEvent;
    const cursorPos = messageInput.selectionStart;

    // If editing an existing mention and user types, close popup
    if (editingMentionRange && mentionSelector.isVisible()) {
      closeMentionPopup();
      // Fall through to check if user typed a new @
    }

    // Skip filter updates during IME composition (wait for compositionend)
    if (isComposing) {
      // Only trigger popup for explicit @ input during composition, and only if not already visible
      if (!mentionSelector.isVisible() && inputEvent.data === "@") {
        mentionStartPos = cursorPos;
        mentionSelector.show();
      }
      return;
    }

    // Check if @ was just typed (and popup not already visible)
    if (inputEvent.data === "@" && !mentionSelector.isVisible()) {
      mentionStartPos = cursorPos;
      mentionSelector.show();
      return;
    }

    // If popup is visible, update the filter
    if (mentionSelector.isVisible()) {
      updateMentionFilter(false);
    }
  });

  // Handle keydown events for mention navigation and shortcuts
  messageInput.addEventListener("keydown", (e: KeyboardEvent) => {
    // Cmd+Backspace (Mac) or Ctrl+Backspace (Windows) to delete @[...] mention
    if (e.key === "Backspace" && (e.metaKey || e.ctrlKey)) {
      const cursorPos = messageInput.selectionStart;
      const text = messageInput.value;
      const mention = findMentionAtCursor(text, cursorPos);
      if (mention) {
        e.preventDefault();
        e.stopPropagation();
        // Close popup first to prevent input event side effects
        if (mentionSelector.isVisible()) {
          closeMentionPopup();
        }
        // Delete the mention and any trailing space
        let deleteEnd = mention.end;
        if (text[deleteEnd] === " ") deleteEnd++;
        const before = text.substring(0, mention.start);
        const after = text.substring(deleteEnd);
        messageInput.value = before + after;
        messageInput.setSelectionRange(mention.start, mention.start);
        // Trigger input event for auto-resize
        dispatchInputEvent(messageInput);
        return;
      }
    }

    if (!mentionSelector.isVisible()) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        mentionSelector.moveDown();
        break;

      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        mentionSelector.moveUp();
        break;

      case "Enter":
        // If mention popup is visible, select instead of sending
        e.preventDefault();
        e.stopPropagation();
        mentionSelector.selectCurrent();
        mentionStartPos = -1;
        editingMentionRange = null;
        break;

      case "Tab":
        e.preventDefault();
        e.stopPropagation();
        mentionSelector.selectCurrent();
        mentionStartPos = -1;
        editingMentionRange = null;
        break;

      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeMentionPopup();
        break;

      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End":
        if (editingMentionRange) {
          // In edit mode: close popup if cursor leaves the mention
          setTimeout(() => {
            const pos = messageInput.selectionStart;
            const txt = messageInput.value;
            const m = findMentionAtCursor(txt, pos);
            if (!m) {
              closeMentionPopup();
            }
          }, 0);
        } else {
          // Normal mode: update filter after cursor moves
          setTimeout(() => updateMentionFilter(true), 0);
        }
        break;
    }
  });

  // Handle mouse clicks that might change cursor position
  messageInput.addEventListener("click", () => {
    if (mentionSelector.isVisible()) {
      setTimeout(() => {
        if (editingMentionRange) {
          // In edit mode: keep popup open if cursor is still in the mention
          const cursorPos = messageInput.selectionStart;
          const text = messageInput.value;
          const mention = findMentionAtCursor(text, cursorPos);
          if (!mention) {
            closeMentionPopup();
          }
        } else {
          updateMentionFilter(true);
        }
      }, 0);
    } else {
      // Check if cursor landed inside an existing mention
      setTimeout(() => checkCursorInMention(), 0);
    }
  });

  // Close popup when clicking outside
  const ownerDoc = container.ownerDocument;
  const closeMentionOnOutsideClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (
      mentionSelector.isVisible() &&
      !mentionPopup.contains(target) &&
      target !== messageInput
    ) {
      closeMentionPopup();
    }
  };
  ownerDoc?.addEventListener("click", closeMentionOnOutsideClick);

  // Close popup when input loses focus (with small delay to allow popup clicks)
  messageInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (mentionSelector.isVisible() && !mentionPopup.matches(":hover")) {
        closeMentionPopup();
      }
    }, 150);
  });

  // Detect cursor movement into existing mentions (via arrow keys)
  messageInput.addEventListener("keyup", (e: KeyboardEvent) => {
    if (mentionSelector.isVisible()) return;
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "Backspace",
        "Delete",
      ].includes(e.key)
    ) {
      checkCursorInMention();
    }
  });

  ztoolkit.log("[MentionSelector] Setup complete");

  return () =>
    ownerDoc?.removeEventListener("click", closeMentionOnOutsideClick);
}

/**
 * Insert a mention into the input at the current cursor position
 * Replaces @query with @[title]
 */
function insertMentionIntoInput(
  input: HTMLTextAreaElement,
  resource: MentionResource,
): void {
  const text = input.value;
  const cursorPos = input.selectionStart;

  // Find the @ position before cursor
  const beforeCursor = text.substring(0, cursorPos);
  const atPos = beforeCursor.lastIndexOf("@");

  if (atPos === -1) return;

  // Preserve the selected library so model-driven PPT launches cannot bind a
  // same-key paper from the wrong Zotero library.
  const mentionText = `${formatMentionReference(resource)} `;

  // Replace @query with the library-aware mention marker.
  const beforeAt = text.substring(0, atPos);
  const afterCursor = text.substring(cursorPos);

  input.value = beforeAt + mentionText + afterCursor;

  // Move cursor after the mention
  const newCursorPos = atPos + mentionText.length;
  input.setSelectionRange(newCursorPos, newCursorPos);
  focusTextarea(input);

  // Trigger input event for auto-resize
  dispatchInputEvent(input);
}

/**
 * Replace an existing @[...] mention in the input with a new resource
 */
function replaceMentionInInput(
  input: HTMLTextAreaElement,
  range: { start: number; end: number },
  resource: MentionResource,
): void {
  const text = input.value;
  const mentionText = `${formatMentionReference(resource)} `;
  const before = text.substring(0, range.start);
  // Skip trailing space after the old mention if present
  let afterStart = range.end;
  if (text[afterStart] === " ") afterStart++;
  const after = text.substring(afterStart);

  input.value = before + mentionText + after;

  // Move cursor after the new mention
  const newCursorPos = range.start + mentionText.length;
  input.setSelectionRange(newCursorPos, newCursorPos);
  focusTextarea(input);

  // Trigger input event for auto-resize
  dispatchInputEvent(input);
}
