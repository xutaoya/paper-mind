export type StreamStopReason =
  | "tool_calls"
  | "end_turn"
  | "max_tokens"
  | "stop";

export function normalizeOpenAIFinishReason(
  finishReason: string | null | undefined,
): StreamStopReason {
  switch (finishReason) {
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "max_tokens";
    case "stop":
      return "stop";
    default:
      return "end_turn";
  }
}

export function normalizeAnthropicStopReason(
  stopReason: string | null | undefined,
): StreamStopReason {
  switch (stopReason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "max_tokens";
    default:
      return "end_turn";
  }
}
