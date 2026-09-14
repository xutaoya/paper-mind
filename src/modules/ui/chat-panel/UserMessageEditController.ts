import type { ChatMessage } from "../../chat";
import {
  attachmentStateFromUserMessage,
  extractEditableUserMessageContent,
} from "../../chat/user-message-edit";
import { getString } from "../../../utils/locale";
import { dispatchInputEvent } from "./ChatPanelBuilder";
import { sessionTurnQueue } from "./SessionTurnQueue";
import type { AttachmentState, ChatPanelContext } from "./types";

const controllers = new WeakMap<HTMLElement, UserMessageEditController>();

function hasComposerDraft(
  messageInput: HTMLTextAreaElement | null,
  attachmentState: AttachmentState,
): boolean {
  return Boolean(
    messageInput?.value.trim() ||
      attachmentState.pendingImages.length ||
      attachmentState.pendingFiles.length ||
      attachmentState.pendingSelectedText ||
      attachmentState.pendingQuotedMessages.length,
  );
}

export class UserMessageEditController {
  private editingUserMessageId: string | null = null;
  private pendingResendUserMessageId: string | null = null;

  constructor(private readonly context: ChatPanelContext) {}

  static attach(context: ChatPanelContext): UserMessageEditController {
    let controller = controllers.get(context.container);
    if (!controller) {
      controller = new UserMessageEditController(context);
      controllers.set(context.container, controller);
      controller.bindCancelButton();
    }
    return controller;
  }

  static get(container: HTMLElement): UserMessageEditController | null {
    return controllers.get(container) ?? null;
  }

  getEditingUserMessageId(): string | null {
    return this.editingUserMessageId;
  }

  consumePendingResendUserMessageId(): string | null {
    const messageId = this.pendingResendUserMessageId;
    this.pendingResendUserMessageId = null;
    return messageId;
  }

  beginEdit(message: ChatMessage): boolean {
    if (message.role !== "user" || message.isSystemNotice) {
      return false;
    }

    const session = this.context.chatManager.getActiveSession();
    if (!session) {
      return false;
    }

    const queueSnapshot = sessionTurnQueue.snapshot(session.id);
    if (queueSnapshot.status === "running" || queueSnapshot.queued.length > 0) {
      this.context.appendError(getString("chat-edit-message-busy"));
      return false;
    }

    const hasInProgressAssistant = session.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.streamingState === "in_progress",
    );
    if (
      hasInProgressAssistant ||
      this.context.chatManager.hasActiveSessionTurn(session.id)
    ) {
      this.context.appendError(getString("chat-edit-message-busy"));
      return false;
    }

    if (queueSnapshot.failureErrorId) {
      sessionTurnQueue.clear(session.id);
    }

    if (session.userInputRequestState?.pendingRequests.length) {
      this.context.appendError(getString("chat-edit-message-pending-input"));
      return false;
    }

    const container = this.context.container;
    const messageInput = container.querySelector(
      "#chat-message-input",
    ) as HTMLTextAreaElement | null;
    const isSameMessage = this.editingUserMessageId === message.id;
    if (
      !isSameMessage &&
      hasComposerDraft(messageInput, this.context.getAttachmentState())
    ) {
      this.context.appendError(getString("chat-queue-draft-conflict"));
      return false;
    }

    this.editingUserMessageId = message.id;
    if (messageInput) {
      messageInput.value = extractEditableUserMessageContent(message);
    }
    this.context.setAttachmentState(attachmentStateFromUserMessage(message));
    this.context.updateAttachmentsPreview();
    this.syncComposerUi();
    if (messageInput) {
      dispatchInputEvent(messageInput);
    }
    this.context.renderMessages(session.messages);
    this.syncComposerUi();
    messageInput?.focus();
    return true;
  }

  cancelEdit(options: { clearComposer?: boolean } = {}): void {
    if (!this.editingUserMessageId) {
      return;
    }
    this.editingUserMessageId = null;
    this.pendingResendUserMessageId = null;
    if (options.clearComposer) {
      const messageInput = this.context.container.querySelector(
        "#chat-message-input",
      ) as HTMLTextAreaElement | null;
      if (messageInput) {
        messageInput.value = "";
      }
      this.context.clearAttachments();
      this.context.updateAttachmentsPreview();
    }
    this.syncComposerUi();
    const session = this.context.chatManager.getActiveSession();
    if (session) {
      this.context.renderMessages(session.messages);
      this.syncComposerUi();
    }
  }

  async prepareEditResend(): Promise<boolean> {
    const editingUserMessageId = this.editingUserMessageId;
    if (!editingUserMessageId) {
      return true;
    }

    const session = this.context.chatManager.getActiveSession();
    if (!session) {
      return false;
    }

    sessionTurnQueue.clear(session.id);
    const truncated =
      await this.context.chatManager.truncateSessionAfterUserMessage(
        session.id,
        editingUserMessageId,
      );
    if (!truncated) {
      this.context.appendError(getString("chat-edit-message-failed"));
      return false;
    }

    this.pendingResendUserMessageId = editingUserMessageId;
    this.editingUserMessageId = null;
    this.syncComposerUi();
    return true;
  }

  private bindCancelButton(): void {
    const cancelButton = this.context.container.querySelector(
      "#chat-edit-message-cancel",
    ) as HTMLButtonElement | null;
    if (!cancelButton || cancelButton.dataset.bound === "true") {
      return;
    }
    cancelButton.dataset.bound = "true";
    cancelButton.addEventListener("click", () => {
      this.cancelEdit({ clearComposer: true });
    });
  }

  private syncComposerUi(): void {
    const container = this.context.container;
    const inputWrapper = container.querySelector(
      "#chat-input-wrapper",
    ) as HTMLElement | null;
    const banner = container.querySelector(
      "#chat-edit-message-banner",
    ) as HTMLElement | null;
    const bannerText = container.querySelector(
      "#chat-edit-message-banner-text",
    ) as HTMLElement | null;
    const editing = this.editingUserMessageId !== null;

    inputWrapper?.classList.toggle("chat-composer--editing", editing);
    if (!banner) {
      return;
    }
    banner.style.display = editing ? "flex" : "none";
    if (editing && bannerText) {
      bannerText.textContent = getString("chat-edit-message-banner");
    }
  }
}
