import type { ToolCall } from "../../../types/tool";

export const OUTPUT_TRUNCATION_CONTINUATION_USER_MESSAGE =
  "Continue your previous answer from exactly where you stopped. Do not repeat content you already provided.";

export const REASONING_TRUNCATION_CONTINUATION_USER_MESSAGE =
  "Continue your reasoning and complete your answer from where you stopped. Do not repeat content you already provided.";

export function shouldContinueTruncatedOutput(result: {
  stopReason?: string;
  toolCalls?: ToolCall[];
  content?: string;
  reasoning?: string;
}): boolean {
  return (
    result.stopReason === "max_tokens" &&
    !result.toolCalls?.length &&
    (Boolean((result.content || "").trim()) ||
      Boolean((result.reasoning || "").trim()))
  );
}

export function getOutputTruncationContinuationUserMessage(
  partialContent: string,
  partialReasoning?: string,
): string {
  if (!partialContent.trim() && partialReasoning?.trim()) {
    return REASONING_TRUNCATION_CONTINUATION_USER_MESSAGE;
  }
  return OUTPUT_TRUNCATION_CONTINUATION_USER_MESSAGE;
}
