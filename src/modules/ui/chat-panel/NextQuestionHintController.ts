import { getString } from "../../../utils/locale";
import {
  createAbortController,
  type ManagedAbortController,
} from "../../../utils/abort";
import { getNextQuestionHintService } from "../../chat/next-question-hint";
import { syncComposerHintOffset } from "./ContextItemBanner";
import { dispatchInputEvent } from "./ChatPanelBuilder";
import type { ChatMessage } from "../../../types/chat";
import type {
  NextQuestionHint,
  NextQuestionHintReadingContext,
} from "../../chat/next-question-hint";
import type { ChatPanelContext } from "./types";

const CONTROLLER_KEY = "__paperchatNextQuestionHintController";
const HOST_HINT_KEY = "__paperchatNextQuestionHintState";
const RECENT_COMPLETION_WINDOW_MS = 2 * 60 * 1000;

type HostElement = HTMLElement & {
  [CONTROLLER_KEY]?: NextQuestionHintController;
  [HOST_HINT_KEY]?: NextQuestionHint;
};

function scheduleNextFrame(callback: () => void, doc: Document): void {
  const view = (doc.defaultView ?? Zotero.getMainWindow()) as Window | null;
  if (view && typeof view.requestAnimationFrame === "function") {
    view.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function setInputPlaceholder(input: HTMLTextAreaElement, placeholder: string): void {
  input.placeholder = placeholder;
  if (placeholder) {
    input.setAttribute("placeholder", placeholder);
  } else {
    input.removeAttribute("placeholder");
  }
}

export class NextQuestionHintController {
  private readonly service = getNextQuestionHintService();
  private input: HTMLTextAreaElement | null;
  private wrapper: HTMLElement | null;
  private hintLayer: HTMLElement | null;
  private hintTextEl: HTMLElement | null;
  private hintActionEl: HTMLElement | null;
  private originalPlaceholder: string;
  private hint: NextQuestionHint | null = null;
  private generationController: ManagedAbortController | null = null;
  private generationAssistantMessageId: string | null = null;
  private isComposing = false;
  private disposed = false;

  private readonly onWrapperKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.shiftKey || !this.isHintActive()) {
      return;
    }
    const target = event.target as Node | null;
    if (!target || !this.wrapper?.contains(target)) {
      return;
    }
    if (this.input && target === this.input) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.input?.focus();
    this.acceptHint();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.hint) {
      event.preventDefault();
      event.stopPropagation();
      this.dismissHint();
      return;
    }

    if (event.key !== "Tab" || event.shiftKey) {
      return;
    }

    if (!this.isHintActive()) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    this.acceptHint();
  };

  private readonly onInput = () => {
    if (this.input?.value.trim()) {
      this.generationController?.abort();
      this.dismissHint();
    } else {
      this.syncVisibility();
    }
  };

  private readonly onPaste = () => {
    this.generationController?.abort();
    this.dismissHint();
  };

  private readonly onCompositionStart = () => {
    this.isComposing = true;
  };

  private readonly onCompositionEnd = () => {
    this.isComposing = false;
  };

  private readonly onFocus = () => {
    this.syncVisibility();
    const doc = this.input?.ownerDocument;
    if (!doc) {
      return;
    }
    scheduleNextFrame(() => {
      if (!this.disposed) {
        this.syncVisibility();
      }
    }, doc);
  };

  constructor(private context: ChatPanelContext) {
    const inputElements = findChatInputElements(context.container);
    this.input = inputElements.input;
    this.wrapper = inputElements.wrapper;

    if (!this.input || !this.wrapper) {
      this.hintLayer = null;
      this.hintTextEl = null;
      this.hintActionEl = null;
      this.originalPlaceholder = "";
      return;
    }

    this.originalPlaceholder = this.input.placeholder;
    this.ensureWrapperPositioning();
    this.hintLayer = this.createHintLayer();
    this.hintTextEl = this.hintLayer.querySelector(
      "[data-next-question-hint-text]",
    ) as HTMLElement | null;
    this.hintActionEl = this.hintLayer.querySelector(
      "[data-next-question-hint-action]",
    ) as HTMLElement | null;
    this.wrapper.appendChild(this.hintLayer);
    syncComposerHintOffset(this.context.container);
    this.bindEvents();
    this.restoreHintFromHost();
  }

  static ensureAttached(
    context: ChatPanelContext,
  ): NextQuestionHintController | null {
    const host = context.container as HostElement;
    const existing = host[CONTROLLER_KEY];
    if (existing && !existing.disposed && existing.rebindToContainer(context)) {
      return existing;
    }
    return NextQuestionHintController.attach(context);
  }

  static attach(context: ChatPanelContext): NextQuestionHintController | null {
    const host = context.container as HostElement;
    host[CONTROLLER_KEY]?.dispose({ persistHint: true });
    const controller = new NextQuestionHintController(context);
    if (!controller.isReady()) {
      controller.dispose();
      delete host[CONTROLLER_KEY];
      return null;
    }
    host[CONTROLLER_KEY] = controller;
    return controller;
  }

  static get(container: HTMLElement): NextQuestionHintController | null {
    const host = container as HostElement;
    const controller = host[CONTROLLER_KEY];
    if (!controller) {
      return null;
    }
    if (!controller.isReady()) {
      controller.dispose({ persistHint: true });
      delete host[CONTROLLER_KEY];
      return null;
    }
    return controller;
  }

  static detach(container: HTMLElement | null): void {
    if (!container) {
      return;
    }
    const host = container as HostElement;
    host[CONTROLLER_KEY]?.dispose();
    delete host[CONTROLLER_KEY];
  }

  async requestForLatestCompletion(
    options: { maxAssistantAgeMs?: number } = {},
  ): Promise<void> {
    if (this.disposed || !this.input || !this.wrapper) {
      return;
    }

    if (this.input.value.trim() || this.isMentionPopupVisible()) {
      return;
    }

    const sessionAtRequest = this.context.chatManager.getActiveSession();
    if (
      !sessionAtRequest ||
      hasLatestAssistantResponseInProgress(sessionAtRequest)
    ) {
      return;
    }
    const lastAssistantAtRequest =
      getLastCompletedAssistantMessage(sessionAtRequest);
    if (!lastAssistantAtRequest) {
      return;
    }
    if (
      options.maxAssistantAgeMs &&
      Date.now() - lastAssistantAtRequest.timestamp > options.maxAssistantAgeMs
    ) {
      return;
    }

    if (this.hint?.assistantMessageId === lastAssistantAtRequest.id) {
      this.syncVisibility();
      return;
    }

    if (this.generationController) {
      if (this.generationAssistantMessageId === lastAssistantAtRequest.id) {
        return;
      }
      this.generationController.abort();
      this.generationController = null;
      this.generationAssistantMessageId = null;
    }

    this.dismissHint({ markDismissed: false });

    const generationController = createAbortController();
    this.generationController = generationController;
    this.generationAssistantMessageId = lastAssistantAtRequest.id;

    const outcome = await this.service.generateForCompletion({
      session: sessionAtRequest,
      currentInputValue: this.input.value,
      readingContext: buildReadingContext(this.context, sessionAtRequest),
      signal: generationController.signal,
    });

    if (
      this.disposed ||
      generationController.aborted ||
      this.generationController !== generationController
    ) {
      if (this.generationController === generationController) {
        this.generationController = null;
        this.generationAssistantMessageId = null;
      }
      return;
    }
    this.generationController = null;
    this.generationAssistantMessageId = null;

    if (outcome.status !== "generated") {
      return;
    }

    const activeSession = this.context.chatManager.getActiveSession();
    if (
      activeSession?.id !== outcome.hint.sessionId ||
      getLastCompletedAssistantMessage(activeSession)?.id !==
        outcome.hint.assistantMessageId ||
      hasLatestAssistantResponseInProgress(activeSession) ||
      this.input.value.trim() ||
      this.isMentionPopupVisible()
    ) {
      return;
    }

    this.showHint(outcome.hint);
  }

  dispose(options: { persistHint?: boolean } = {}): void {
    if (this.disposed) {
      return;
    }
    if (options.persistHint) {
      this.persistHintOnHost();
    } else {
      this.clearPersistedHintOnHost();
    }
    this.disposed = true;
    this.generationController?.abort();
    this.generationController = null;
    this.generationAssistantMessageId = null;
    this.unbindEvents();
    this.restorePlaceholder();
    this.hintLayer?.remove();
    this.hint = null;
    this.hintLayer = null;
    this.hintTextEl = null;
    this.hintActionEl = null;
    this.input = null;
    this.wrapper = null;
  }

  rebindToContainer(context: ChatPanelContext): boolean {
    if (this.disposed) {
      return false;
    }
    this.context = context;
    const { input, wrapper } = findChatInputElements(context.container);
    if (!input || !wrapper) {
      return false;
    }
    if (input === this.input && wrapper === this.wrapper && input.isConnected) {
      this.syncVisibility();
      return true;
    }
    this.unbindEvents();
    this.input = input;
    this.wrapper = wrapper;
    if (!this.originalPlaceholder) {
      this.originalPlaceholder = input.placeholder;
    }
    this.ensureWrapperPositioning();
    if (!this.hintLayer) {
      this.hintLayer = this.createHintLayer();
      this.hintTextEl = this.hintLayer.querySelector(
        "[data-next-question-hint-text]",
      ) as HTMLElement | null;
      this.hintActionEl = this.hintLayer.querySelector(
        "[data-next-question-hint-action]",
      ) as HTMLElement | null;
    }
    if (this.hintLayer.parentNode !== wrapper) {
      wrapper.appendChild(this.hintLayer);
    }
    if (this.hint) {
      if (this.hintTextEl) {
        this.hintTextEl.textContent = this.hint.text;
      }
      if (this.hintActionEl) {
        this.hintActionEl.textContent = getString("chat-next-question-hint-tab");
      }
    }
    syncComposerHintOffset(context.container);
    this.bindEvents();
    this.syncVisibility();
    return true;
  }

  private isHintActive(): boolean {
    if (this.disposed || this.isComposing || !this.hint || !this.input) {
      return false;
    }
    if (this.hint.expiresAt <= Date.now()) {
      return false;
    }
    if (this.isMentionPopupVisible()) {
      return false;
    }
    if (this.input.value.trim()) {
      return false;
    }
    return true;
  }

  private isReady(): boolean {
    return (
      !this.disposed &&
      !!this.input &&
      !!this.wrapper &&
      !!this.hintLayer &&
      !!this.hintTextEl &&
      !!this.hintActionEl
    );
  }

  private bindEvents(): void {
    this.input?.addEventListener("keydown", this.onKeyDown, true);
    this.input?.addEventListener("input", this.onInput);
    this.input?.addEventListener("paste", this.onPaste);
    this.input?.addEventListener("compositionstart", this.onCompositionStart);
    this.input?.addEventListener("compositionend", this.onCompositionEnd);
    this.input?.addEventListener("focus", this.onFocus);
    this.wrapper?.addEventListener("keydown", this.onWrapperKeyDown, true);
  }

  private unbindEvents(): void {
    this.input?.removeEventListener("keydown", this.onKeyDown, true);
    this.input?.removeEventListener("input", this.onInput);
    this.input?.removeEventListener("paste", this.onPaste);
    this.input?.removeEventListener(
      "compositionstart",
      this.onCompositionStart,
    );
    this.input?.removeEventListener("compositionend", this.onCompositionEnd);
    this.input?.removeEventListener("focus", this.onFocus);
    this.wrapper?.removeEventListener("keydown", this.onWrapperKeyDown, true);
  }

  private persistHintOnHost(): void {
    const host = this.context.container as HostElement;
    if (this.hint && this.hint.expiresAt > Date.now()) {
      host[HOST_HINT_KEY] = this.hint;
      return;
    }
    delete host[HOST_HINT_KEY];
  }

  private clearPersistedHintOnHost(): void {
    delete (this.context.container as HostElement)[HOST_HINT_KEY];
  }

  private restoreHintFromHost(): void {
    const persisted = (this.context.container as HostElement)[HOST_HINT_KEY];
    if (
      !persisted ||
      persisted.expiresAt <= Date.now() ||
      this.input?.value.trim()
    ) {
      return;
    }
    this.showHint(persisted);
  }

  private showHint(hint: NextQuestionHint): void {
    if (!this.hintLayer || !this.hintTextEl || !this.hintActionEl) {
      return;
    }
    this.hint = hint;
    this.hintTextEl.textContent = hint.text;
    this.hintActionEl.textContent = getString("chat-next-question-hint-tab");
    this.persistHintOnHost();
    this.syncVisibility();
  }

  private acceptHint(): void {
    if (!this.hint || !this.input) {
      return;
    }
    const accepted = this.hint;
    this.service.markAccepted(accepted);
    this.clearHint();
    this.input.value = accepted.text;
    this.input.focus();
    this.input.setSelectionRange(accepted.text.length, accepted.text.length);
    dispatchInputEvent(this.input);
  }

  private dismissHint(options: { markDismissed?: boolean } = {}): void {
    const shouldMark = options.markDismissed !== false;
    if (this.hint && shouldMark) {
      this.service.markDismissed(this.hint);
    }
    this.clearHint();
  }

  private clearHint(): void {
    this.hint = null;
    this.clearPersistedHintOnHost();
    if (this.hintTextEl) {
      this.hintTextEl.textContent = "";
    }
    this.syncVisibility();
  }

  private syncVisibility(): void {
    if (!this.hintLayer) {
      return;
    }
    const isExpired = this.hint ? this.hint.expiresAt <= Date.now() : false;
    if (isExpired) {
      this.dismissHint();
      return;
    }
    const visible =
      !!this.hint &&
      !this.disposed &&
      !this.input?.value.trim() &&
      !this.isMentionPopupVisible();
    this.hintLayer.style.display = visible ? "flex" : "none";
    this.hintLayer.setAttribute("aria-hidden", visible ? "false" : "true");
    if (visible) {
      syncComposerHintOffset(this.context.container);
    }
    this.syncNativePlaceholder();
  }

  private isMentionPopupVisible(): boolean {
    const popup = this.context.container.querySelector(
      "#chat-mention-popup",
    ) as HTMLElement | null;
    return !!popup && popup.style.display === "block";
  }

  private ensureWrapperPositioning(): void {
    if (!this.wrapper) {
      return;
    }
    if (!this.wrapper.style.position) {
      this.wrapper.style.position = "relative";
    }
  }

  private createHintLayer(): HTMLElement {
    const doc = this.context.container.ownerDocument;
    const theme = this.context.getTheme();
    const layer = doc.createElement("div");
    layer.id = "chat-next-question-hint";
    layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, {
      display: "none",
      position: "absolute",
      left: "14px",
      right: "12px",
      top: "var(--chat-composer-hint-top, 12px)",
      height: "18px",
      alignItems: "center",
      gap: "8px",
      pointerEvents: "none",
      zIndex: "3",
      color: theme.textMuted,
      fontSize: "14px",
      lineHeight: "18px",
      opacity: "0.72",
    });

    const text = doc.createElement("span");
    text.setAttribute("data-next-question-hint-text", "true");
    Object.assign(text.style, {
      flex: "1",
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    const action = doc.createElement("span");
    action.setAttribute("data-next-question-hint-action", "true");
    Object.assign(action.style, {
      flexShrink: "0",
      fontSize: "11px",
      lineHeight: "16px",
      color: theme.textSecondary,
      opacity: "0.85",
    });

    layer.appendChild(text);
    layer.appendChild(action);
    return layer;
  }

  private shouldHideNativePlaceholder(): boolean {
    return !!this.hint && !this.input?.value.trim();
  }

  private syncNativePlaceholder(): void {
    if (!this.input) {
      return;
    }
    setInputPlaceholder(
      this.input,
      this.shouldHideNativePlaceholder() ? "" : this.originalPlaceholder,
    );
  }

  private restorePlaceholder(): void {
    if (this.input) {
      setInputPlaceholder(this.input, this.originalPlaceholder);
    }
  }
}

export function requestNextQuestionHintAfterRecentRender(
  container: HTMLElement | null,
): void {
  if (!container) {
    return;
  }
  void NextQuestionHintController.get(container)
    ?.requestForLatestCompletion({
      maxAssistantAgeMs: RECENT_COMPLETION_WINDOW_MS,
    })
    .catch((error) => {
      ztoolkit.log("[NextQuestionHint] render request failed:", error);
    });
}

function getLastCompletedAssistantMessage(
  session: ReturnType<ChatPanelContext["chatManager"]["getActiveSession"]>,
): ChatMessage | null {
  if (!session) {
    return null;
  }
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (
      message.role === "assistant" &&
      !message.streamingState &&
      !message.apiOnly &&
      !message.isSystemNotice
    ) {
      return message;
    }
  }
  return null;
}

function findChatInputElements(container: HTMLElement): {
  input: HTMLTextAreaElement | null;
  wrapper: HTMLElement | null;
} {
  const inputs = Array.from(
    container.querySelectorAll("#chat-message-input"),
  ) as HTMLTextAreaElement[];
  let visibleInput: HTMLTextAreaElement | null = null;
  for (let index = inputs.length - 1; index >= 0; index--) {
    if (isElementVisible(inputs[index])) {
      visibleInput = inputs[index];
      break;
    }
  }
  visibleInput ||= inputs[inputs.length - 1] || null;
  const wrapper =
    (visibleInput?.closest("#chat-input-wrapper") as HTMLElement | null) ||
    null;
  return { input: visibleInput, wrapper };
}

function isElementVisible(element: HTMLElement): boolean {
  const win = element.ownerDocument.defaultView;
  if (!win) {
    return false;
  }
  const style = win.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function hasLatestAssistantResponseInProgress(
  session: ReturnType<ChatPanelContext["chatManager"]["getActiveSession"]>,
): boolean {
  if (!session) {
    return false;
  }
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message.role === "assistant" && !message.apiOnly) {
      return message.streamingState === "in_progress";
    }
  }
  return false;
}

function buildReadingContext(
  context: ChatPanelContext,
  session: NonNullable<
    ReturnType<ChatPanelContext["chatManager"]["getActiveSession"]>
  >,
): NextQuestionHintReadingContext | undefined {
  const activeReaderContext = readActiveReaderContext();
  const item =
    getItemByLibraryKey(
      session.lastActiveItemKey,
      session.lastActiveItemLibraryID,
    ) ||
    resolveTopLevelItem(context.getCurrentItem()) ||
    activeReaderContext.item;
  const canUseActiveReaderContext =
    !!activeReaderContext.item &&
    (!item?.key ||
      (activeReaderContext.item.key === item.key &&
        activeReaderContext.item.libraryID === item.libraryID));
  const readerProgress = canUseActiveReaderContext
    ? activeReaderContext.progress
    : undefined;
  const selectedText =
    (canUseActiveReaderContext ? activeReaderContext.selectedText : null) ||
    getRecentSelectedText(session.messages) ||
    context.getAttachmentState().pendingSelectedText ||
    undefined;

  const metadata = item ? buildItemReadingContext(item) : {};
  const readingContext: NextQuestionHintReadingContext = {
    ...metadata,
    selectedText,
    currentPage: readerProgress?.currentPage,
    pageCount: readerProgress?.pageCount,
  };

  return hasReadingContext(readingContext) ? readingContext : undefined;
}

function buildItemReadingContext(
  item: Zotero.Item,
): NextQuestionHintReadingContext {
  const target = resolveTopLevelItem(item) || item;
  const title =
    readItemField(target, "title") || target.attachmentFilename || undefined;
  const authors = readItemAuthors(target);
  const year =
    readItemField(target, "year") || readItemField(target, "date")?.slice(0, 4);
  const abstract = readItemField(target, "abstractNote");
  const tags = readItemTags(target);

  return {
    itemKey: target.key || item.key,
    title,
    authors: authors.length ? authors : undefined,
    year,
    abstract,
    tags: tags.length ? tags : undefined,
  };
}

function getItemByLibraryKey(
  itemKey: string | null | undefined,
  libraryID: number = Zotero.Libraries.userLibraryID,
): Zotero.Item | null {
  if (!itemKey) {
    return null;
  }
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey) as
      | Zotero.Item
      | false;
    return resolveTopLevelItem(item || null);
  } catch (error) {
    ztoolkit.log("[NextQuestionHint] failed to resolve item context:", error);
    return null;
  }
}

function resolveTopLevelItem(
  item: Zotero.Item | null | undefined,
): Zotero.Item | null {
  if (!item) {
    return null;
  }
  if ((item.isAttachment?.() || item.isNote?.()) && item.parentItemID) {
    const parent = Zotero.Items.get(item.parentItemID) as Zotero.Item | false;
    return parent || item;
  }
  return item;
}

function readItemField(item: Zotero.Item, field: string): string | undefined {
  const value = item.getField?.(field) as string | undefined;
  return value?.trim() || undefined;
}

function readItemAuthors(item: Zotero.Item): string[] {
  try {
    const creators = item.getCreators?.() || [];
    return creators
      .map(
        (creator: { name?: string; firstName?: string; lastName?: string }) =>
          creator.name ||
          `${creator.firstName || ""} ${creator.lastName || ""}`,
      )
      .map((name) => name.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readItemTags(item: Zotero.Item): string[] {
  try {
    return (item.getTags?.() || [])
      .map((tag: { tag?: string }) => tag.tag?.trim() || "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getRecentSelectedText(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const selectedText = message.selectedText?.trim();
    if (message.role === "user" && !message.apiOnly && selectedText) {
      return selectedText;
    }
  }
  return null;
}

interface ActiveReaderContext {
  item: Zotero.Item | null;
  selectedText: string | null;
  progress?: {
    currentPage?: number;
    pageCount?: number;
  };
}

function readActiveReaderContext(): ActiveReaderContext {
  try {
    const reader = getActiveReader();
    const item = getReaderTopLevelItem(reader);
    const toolkitSelectedText = reader
      ? ztoolkit.Reader.getSelectedText(reader)
      : "";
    const iframeSelection = (reader as any)?._iframeWindow
      ?.getSelection?.()
      ?.toString?.();
    return {
      item,
      selectedText: normalizeContextText(
        toolkitSelectedText || iframeSelection,
      ),
      progress: readReaderProgress(reader),
    };
  } catch {
    return {
      item: null,
      selectedText: null,
    };
  }
}

function getReaderTopLevelItem(
  reader: _ZoteroTypes.ReaderInstance | null,
): Zotero.Item | null {
  if (!reader?.itemID) {
    return null;
  }
  const item = Zotero.Items.get(reader.itemID) as Zotero.Item | false;
  return resolveTopLevelItem(item || null);
}

function readReaderProgress(reader: _ZoteroTypes.ReaderInstance | null):
  | {
      currentPage?: number;
      pageCount?: number;
    }
  | undefined {
  try {
    const pdfApp = (reader as any)?._iframeWindow?.PDFViewerApplication;
    const currentPage = Number(
      pdfApp?.pdfViewer?.currentPageNumber || pdfApp?.page || 0,
    );
    const pageCount = Number(
      pdfApp?.pdfViewer?.pagesCount || pdfApp?.pagesCount || 0,
    );
    if (!Number.isFinite(currentPage) || currentPage <= 0) {
      return undefined;
    }
    return {
      currentPage,
      pageCount:
        Number.isFinite(pageCount) && pageCount > 0 ? pageCount : undefined,
    };
  } catch {
    return undefined;
  }
}

function getActiveReader(): _ZoteroTypes.ReaderInstance | null {
  const selectedID = Zotero.getMainWindow().Zotero_Tabs?.selectedID;
  return selectedID ? Zotero.Reader?.getByTabID(selectedID) || null : null;
}

function normalizeContextText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function hasReadingContext(context: NextQuestionHintReadingContext): boolean {
  return Boolean(
    context.itemKey ||
    context.title ||
    context.authors?.length ||
    context.year ||
    context.abstract ||
    context.tags?.length ||
    context.selectedText ||
    context.currentPage,
  );
}
