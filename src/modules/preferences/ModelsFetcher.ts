/**
 * Model display helpers for the preferences and chat UI.
 */

export function formatModelLabel(model: string, _providerId?: string): string {
  return model;
}

/** Chat composer pill: model name first, provider name second. */
export function formatChatModelSelectorSummary(
  providerName: string,
  modelLabel: string,
): string {
  return `${modelLabel}: ${providerName}`;
}
