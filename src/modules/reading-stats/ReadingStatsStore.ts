const STATS_FILE = "paperchat-reading-stats.json";

export interface ItemReadingRecord {
  libraryID: number;
  itemKey: string;
  totalSeconds: number;
  lastReadAt: number;
}

export interface ReadingStatsFile {
  version: 2;
  /** Local calendar day (YYYY-MM-DD) -> accumulated active reading seconds. */
  dailySeconds: Record<string, number>;
  /** `${libraryID}:${itemKey}` -> per-item reading totals. */
  items: Record<string, ItemReadingRecord>;
  /** Day key -> item storage key -> seconds read that day. */
  dailyItems: Record<string, Record<string, number>>;
}

export interface ItemReadingRef {
  libraryID: number;
  itemKey: string;
}

function getStatsPath(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, STATS_FILE);
}

function emptyStats(): ReadingStatsFile {
  return { version: 2, dailySeconds: {}, items: {}, dailyItems: {} };
}

export function itemReadingStorageKey(ref: ItemReadingRef): string {
  return `${ref.libraryID}:${ref.itemKey}`;
}

function pruneOldDays(data: ReadingStatsFile, keepDays = 400): void {
  const keys = Object.keys(data.dailySeconds).sort();
  if (keys.length <= keepDays) {
    return;
  }
  for (const key of keys.slice(0, keys.length - keepDays)) {
    delete data.dailySeconds[key];
    delete data.dailyItems[key];
  }
}

function normalizeLoadedStats(raw: unknown): ReadingStatsFile {
  if (!raw || typeof raw !== "object") {
    return emptyStats();
  }
  const record = raw as {
    version?: number;
    dailySeconds?: Record<string, number>;
    items?: Record<string, ItemReadingRecord>;
    dailyItems?: Record<string, Record<string, number>>;
  };
  if (record.version === 2 && typeof record.dailySeconds === "object") {
    return {
      version: 2,
      dailySeconds: { ...record.dailySeconds },
      items: { ...(record.items || {}) },
      dailyItems: { ...(record.dailyItems || {}) },
    };
  }
  if (record.version === 1 && typeof record.dailySeconds === "object") {
    return {
      version: 2,
      dailySeconds: { ...record.dailySeconds },
      items: {},
      dailyItems: {},
    };
  }
  return emptyStats();
}

export function formatLocalDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function loadReadingStats(): Promise<ReadingStatsFile> {
  const path = getStatsPath();
  try {
    if (!(await IOUtils.exists(path))) {
      return emptyStats();
    }
    const raw = await IOUtils.readJSON(path);
    return normalizeLoadedStats(raw);
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to load stats:", error);
    return emptyStats();
  }
}

export async function saveReadingStats(data: ReadingStatsFile): Promise<void> {
  pruneOldDays(data);
  const path = getStatsPath();
  try {
    await IOUtils.writeJSON(path, data);
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to save stats:", error);
  }
}

export async function addReadingSeconds(
  seconds: number,
  dayKey = formatLocalDayKey(),
  itemRef?: ItemReadingRef,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return;
  }
  const rounded = Math.round(seconds);
  const data = await loadReadingStats();
  data.dailySeconds[dayKey] = (data.dailySeconds[dayKey] || 0) + rounded;

  if (itemRef?.itemKey) {
    const storageKey = itemReadingStorageKey(itemRef);
    const existing = data.items[storageKey];
    const now = Date.now();
    data.items[storageKey] = {
      libraryID: itemRef.libraryID,
      itemKey: itemRef.itemKey,
      totalSeconds: (existing?.totalSeconds || 0) + rounded,
      lastReadAt: now,
    };
    const dayItems = data.dailyItems[dayKey] || {};
    dayItems[storageKey] = (dayItems[storageKey] || 0) + rounded;
    data.dailyItems[dayKey] = dayItems;
  }

  await saveReadingStats(data);
}
