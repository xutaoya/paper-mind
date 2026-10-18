import type { ChatMessage } from "../../types/chat";
import type { AttachmentState } from "../ui/chat-panel/types";

export function extractEditableUserMessageContent(
  message: ChatMessage,
): string {
  if (message.role !== "user" || message.isSystemNotice) {
    return "";
  }
  if (message.selectedText) {
    return (
      message.content.split("[Question]:").pop()?.trim() || message.content
    );
  }
  if (message.content.includes("[Question]:")) {
    return (
      message.content.split("[Question]:").pop()?.trim() || message.content
    );
  }
  return message.content;
}

export function attachmentStateFromUserMessage(
  message: ChatMessage,
): AttachmentState {
  return {
    pendingImages: message.images ? [...message.images] : [],
    pendingFiles: message.files ? [...message.files] : [],
    pendingSelectedText: message.selectedText ?? null,
    pendingQuotedMessages: message.quotedMessages
      ? [...message.quotedMessages]
      : [],
  };
}

export function findUserMessageIndex(
  messages: ChatMessage[],
  userMessageId: string,
): number {
  return messages.findIndex(
    (message) => message.id === userMessageId && message.role === "user",
  );
}
