/**
 * Rough token estimate for UI display (not billing-accurate).
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }
  const cjkCount = (
    text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []
  ).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

/** Compact display for token counts, e.g. 2711 → "2.7k", 1.2M → "1.2M". */
export function formatCompactTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return value >= 10
      ? `${Math.round(value)}M`
      : `${Math.round(value * 10) / 10}M`;
  }
  if (tokens >= 1000) {
    const value = tokens / 1000;
    return value >= 10
      ? `${Math.round(value)}k`
      : `${Math.round(value * 10) / 10}k`;
  }
  return String(Math.round(tokens));
}

/** Exact token count for tooltips and detail popovers. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  return Math.round(tokens).toLocaleString();
}

/** Prefer provider usage when higher; otherwise grow with streamed reasoning text. */
export function resolveReasoningTokenCount(
  reasoning: string,
  apiReasoningTokens?: number,
): number {
  const estimated = estimateTextTokens(reasoning);
  if (apiReasoningTokens === undefined) {
    return estimated;
  }
  return Math.max(apiReasoningTokens, estimated);
}
