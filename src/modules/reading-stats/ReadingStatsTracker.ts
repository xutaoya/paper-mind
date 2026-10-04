import { recordReadingSeconds } from "./ReadingStatsService";
import type { ItemReadingRef } from "./ReadingStatsStore";
import { ensureZoteroStyleReadingImport } from "./ZoteroStyleReadingImport";

const TICK_MS = 15_000;
const MAX_DELTA_MS = 60_000;

let timerId: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;

function getActiveReaderLiteratureItem(): Zotero.Item | null {
  const mainWindow = Zotero.getMainWindow() as Window & {
    Zotero_Tabs?: { selectedID?: string; selectedType?: string };
    document?: Document;
  };
  if (!mainWindow?.document?.hasFocus?.()) {
    return null;
  }
  const tabs = mainWindow.Zotero_Tabs;
  if (!tabs?.selectedID) {
    return null;
  }
  if (tabs.selectedType && tabs.selectedType !== "reader") {
    return null;
  }
  const reader = Zotero.Reader?.getByTabID?.(tabs.selectedID);
  if (!reader?.itemID) {
    return null;
  }
  try {
    const item = Zotero.Items.get(reader.itemID);
    if (!item || item.deleted) {
      return null;
    }
    if (item.isPDFAttachment?.()) {
      const parent = item.parentItem;
      return parent && !parent.deleted ? parent : null;
    }
    if (item.isRegularItem?.()) {
      return item;
    }
    const parent = item.parentItem;
    return parent && !parent.deleted ? parent : null;
  } catch {
    return null;
  }
}

function toItemRef(item: Zotero.Item): ItemReadingRef {
  return {
    libraryID: item.libraryID,
    itemKey: item.key,
  };
}

function onTick(): void {
  const now = Date.now();
  if (lastTickAt <= 0) {
    lastTickAt = now;
    return;
  }
  const deltaMs = now - lastTickAt;
  lastTickAt = now;
  const literatureItem = getActiveReaderLiteratureItem();
  if (!literatureItem) {
    return;
  }
  if (deltaMs <= 0 || deltaMs > MAX_DELTA_MS) {
    return;
  }
  void recordReadingSeconds(deltaMs / 1000, toItemRef(literatureItem)).catch(
    (error: unknown) => {
      ztoolkit.log("[ReadingStats] Failed to record reading time:", error);
    },
  );
}

export function isReadingStatsTrackerRunning(): boolean {
  return timerId !== null;
}

export function isReadingTimeAccumulatingNow(): boolean {
  return getActiveReaderLiteratureItem() !== null;
}

export function startReadingStatsTracker(): void {
  if (timerId !== null) {
    return;
  }
  void ensureZoteroStyleReadingImport();
  lastTickAt = Date.now();
  timerId = setInterval(onTick, TICK_MS);
  ztoolkit.log("[ReadingStats] Tracker started");
}

export function stopReadingStatsTracker(): void {
  if (timerId === null) {
    return;
  }
  clearInterval(timerId);
  timerId = null;
  lastTickAt = 0;
  ztoolkit.log("[ReadingStats] Tracker stopped");
}
