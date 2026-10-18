export type AnalyticsEventProps = Record<string, unknown>;

export const ANALYTICS_EVENTS = {
  pluginStarted: "plugin_started",
  settingsOpened: "settings_opened",
  settingsProviderViewed: "settings_provider_viewed",
  chatPanelOpened: "chat_panel_opened",
  chatPanelClosed: "chat_panel_closed",
  chatSent: "chat_sent",
  chatCompleted: "chat_completed",
  chatModelSwitched: "chat_model_switched",
  signInCompleted: "sign_in_completed",
  paperChatPresentationEntryClicked: "paperchat_presentation_entry_clicked",
  paperChatPurchaseEntryClicked: "paperchat_purchase_entry_clicked",
  paperChatPurchaseButtonClicked: "paperchat_purchase_button_clicked",
  paperChatLowBalanceClicked: "paperchat_low_balance_clicked",
  paperChatQuotaError: "paperchat_quota_error",
  paperChatModelRerouted: "paperchat_model_rerouted",
  aiSummaryBatchStarted: "ai_summary_batch_started",
  aiSummaryDeepRequested: "ai_summary_deep_requested",
  aiSummaryQuickRequested: "ai_summary_quick_requested",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type PaperChatPresentationEntrySource = "chat_button" | "library_menu";
export type PaperChatProductCategory = string;
export type PaperChatPurchaseEntrySource = string;

export interface PaperChatPresentationEntryContext {
  item_key?: string;
  library_id?: number;
}

export interface PaperChatPurchaseEntryContext {
  source?: string;
}

export interface PaperChatPurchaseItemAnalytics {
  sku?: string;
  category?: PaperChatProductCategory;
}

export interface Analytics {
  track(eventName: string, props?: AnalyticsEventProps): void;
  destroy(): Promise<void>;
}

class NoopAnalyticsService implements Analytics {
  track(): void {}
  async destroy(): Promise<void> {}
}

let analyticsService: Analytics | null = null;

export function getAnalyticsService(): Analytics {
  if (!analyticsService) {
    analyticsService = new NoopAnalyticsService();
  }
  return analyticsService;
}

export async function destroyAnalyticsService(): Promise<void> {
  await analyticsService?.destroy();
  analyticsService = null;
}

export function trackPaperChatPresentationEntryClicked(
  ..._args: unknown[]
): void {}

export function trackPaperChatPurchaseButtonClicked(
  ..._args: unknown[]
): void {}
export function trackPaperChatPurchaseEntryClicked(..._args: unknown[]): void {}

export function buildErrorProps(
  reason: string,
  error?: unknown,
): AnalyticsEventProps {
  return {
    reason,
    error: error === undefined ? reason : String(error),
  };
}

export function extractStatusCode(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

export function isNetworkErrorMessage(message: string): boolean {
  return /network|fetch|timeout|offline/i.test(message);
}
