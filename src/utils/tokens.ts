/**
 * Rough token estimate for UI display (not billing-accurate).
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(estimateTextTokenUnits(text) / 12);
}

function estimateTextTokenUnits(text: string): number {
  let units = text.length * 3;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      units += 5;
    }
  }
  return units;
}

/** Estimate appended chunks without rescanning the whole text or rounding each delta. */
export function createTextTokenEstimator(): (text: string) => number {
  let previous = "";
  let units = 0;
  return (text) => {
    if (text !== previous) {
      units = text.startsWith(previous)
        ? units + estimateTextTokenUnits(text.slice(previous.length))
        : estimateTextTokenUnits(text);
      previous = text;
    }
    return Math.ceil(units / 12);
  };
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
