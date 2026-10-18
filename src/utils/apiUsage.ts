import type { ChatMessageTurnUsage } from "../types/chat";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readReasoningTokensFromDetails(details: unknown): number | undefined {
  if (!isPlainObject(details)) {
    return undefined;
  }
  const reasoning = readFiniteNumber(details.reasoning_tokens);
  if (reasoning !== undefined) {
    return reasoning;
  }
  return readFiniteNumber(details.thinking_tokens);
}

/**
 * Extract provider-reported reasoning / thinking token usage when present.
 */
export function extractReasoningTokensFromUsage(
  usage: unknown,
): number | undefined {
  if (!isPlainObject(usage)) {
    return undefined;
  }

  const direct = readFiniteNumber(usage.reasoning_tokens);
  if (direct !== undefined) {
    return direct;
  }

  const fromCompletionDetails = readReasoningTokensFromDetails(
    usage.completion_tokens_details,
  );
  if (fromCompletionDetails !== undefined) {
    return fromCompletionDetails;
  }

  const fromOutputDetails = readReasoningTokensFromDetails(
    usage.output_tokens_details,
  );
  if (fromOutputDetails !== undefined) {
    return fromOutputDetails;
  }

  return undefined;
}

function readUsageNumber(
  usage: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = readFiniteNumber(usage[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Normalize a single provider usage payload into a turn delta.
 */
export function extractTurnTokenUsage(
  usage: unknown,
): ChatMessageTurnUsage | null {
  if (!isPlainObject(usage)) {
    return null;
  }

  const inputTokens = readUsageNumber(
    usage,
    "input_tokens",
    "prompt_tokens",
    "total_input_tokens",
  );
  const outputTokens = readUsageNumber(
    usage,
    "output_tokens",
    "completion_tokens",
    "total_output_tokens",
  );
  const totalTokens = readUsageNumber(usage, "total_tokens");
  const reasoningTokens = extractReasoningTokensFromUsage(usage);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
  };
}

function mergeUsageNumber(
  base: number | undefined,
  delta: number | undefined,
): number | undefined {
  const sum = (base ?? 0) + (delta ?? 0);
  return sum > 0 ? sum : undefined;
}

export function mergeTurnTokenUsage(
  base: ChatMessageTurnUsage | undefined,
  delta: ChatMessageTurnUsage,
): ChatMessageTurnUsage {
  return {
    inputTokens: mergeUsageNumber(base?.inputTokens, delta.inputTokens),
    outputTokens: mergeUsageNumber(base?.outputTokens, delta.outputTokens),
    reasoningTokens: mergeUsageNumber(
      base?.reasoningTokens,
      delta.reasoningTokens,
    ),
    totalTokens: mergeUsageNumber(base?.totalTokens, delta.totalTokens),
  };
}

export function getTurnTokenTotal(
  usage: ChatMessageTurnUsage | undefined,
): number | undefined {
  if (!usage) {
    return undefined;
  }

  const inputOutputTotal = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (inputOutputTotal > 0) {
    return inputOutputTotal;
  }
  if (usage.totalTokens && usage.totalTokens > 0) {
    return usage.totalTokens;
  }
  if (usage.reasoningTokens && usage.reasoningTokens > 0) {
    return usage.reasoningTokens;
  }
  return undefined;
}

export function applyTurnTokenUsage(
  target: {
    turnUsage?: ChatMessageTurnUsage;
    reasoningTokens?: number;
  },
  delta: ChatMessageTurnUsage,
): void {
  target.turnUsage = mergeTurnTokenUsage(target.turnUsage, delta);
  const reasoningTotal = target.turnUsage.reasoningTokens;
  if (reasoningTotal !== undefined) {
    target.reasoningTokens = reasoningTotal;
  }
}
