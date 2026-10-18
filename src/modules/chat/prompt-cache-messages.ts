import type { ChatMessage } from "../../types/chat";

export const PAPER_CONTEXT_MESSAGE_ID = "paper-context";
export const RUNTIME_CONTEXT_MESSAGE_ID = "runtime-context";
export const CACHE_CHECKPOINT_MESSAGE_ID = "cache-checkpoint";
export const CACHE_CHECKPOINT_HISTORY_MESSAGE_ID = "cache-checkpoint-history";
export const RUNTIME_CONTEXT_HISTORY_MESSAGE_ID = "runtime-context-history";

export const RUNTIME_CONTEXT_USER_PREFIX =
  "[Agent runtime context — not a user message]\n\n";

export const CACHE_CHECKPOINT_CONTENT =
  "Prompt cache checkpoint. This is not user content or an instruction.";

export function isPaperContextMessage(
  message: Pick<ChatMessage, "id">,
): boolean {
  return message.id === PAPER_CONTEXT_MESSAGE_ID;
}

export function isCacheCheckpointMessage(
  message: Pick<ChatMessage, "id">,
): boolean {
  return (
    message.id === CACHE_CHECKPOINT_MESSAGE_ID ||
    message.id === CACHE_CHECKPOINT_HISTORY_MESSAGE_ID
  );
}

export function isRuntimeContextMessage(
  message: Pick<ChatMessage, "id">,
): boolean {
  return (
    message.id === RUNTIME_CONTEXT_MESSAGE_ID ||
    message.id === RUNTIME_CONTEXT_HISTORY_MESSAGE_ID
  );
}

export function formatRuntimeContextUserContent(content: string): string {
  if (content.startsWith(RUNTIME_CONTEXT_USER_PREFIX)) {
    return content;
  }
  return `${RUNTIME_CONTEXT_USER_PREFIX}${content}`;
}

export function buildCacheCheckpointMessage(
  timestamp = Date.now(),
): ChatMessage {
  return {
    id: CACHE_CHECKPOINT_MESSAGE_ID,
    role: "system",
    content: CACHE_CHECKPOINT_CONTENT,
    timestamp,
  };
}

export function buildRuntimeContextMessage(
  content: string,
  timestamp = Date.now(),
): ChatMessage {
  return {
    id: RUNTIME_CONTEXT_MESSAGE_ID,
    role: "user",
    content: formatRuntimeContextUserContent(content),
    timestamp,
  };
}
