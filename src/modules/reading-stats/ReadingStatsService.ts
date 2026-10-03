import {
  addReadingSeconds,
  formatLocalDayKey,
  loadReadingStats,
  type ItemReadingRef,
  type ReadingStatsFile,
} from "./ReadingStatsStore";
import { ensureZoteroStyleReadingImport } from "./ZoteroStyleReadingImport";

const LITERATURE_ITEM_TYPES = [
  "journalArticle",
  "conferencePaper",
  "preprint",
  "thesis",
  "report",
  "book",
  "bookSection",
] as const;

export interface LiteratureCounts {
  total: number;
  /** Items with non-empty Zotero Date Read. */
  markedRead: number;
  /** @deprecated Use markedRead — kept for compatibility. */
  read: number;
  /** Literature items with accumulated reading time (tracker or Style import). */
  withReadingTime: number;
}

export interface ReadingDayCell {
  dayKey: string;
  date: Date;
  seconds: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface DayReadingItem {
  title: string;
  seconds: number;
  libraryID: number;
  itemKey: string;
}

export interface ReadingStatsSnapshot {
  literature: LiteratureCounts;
  dailySeconds: Record<string, number>;
  cells: ReadingDayCell[];
  weekCount: number;
  rangeStart: Date;
  rangeEnd: Date;
  totalSecondsLastYear: number;
  totalSecondsThisWeek: number;
  activeDaysLastYear: number;
  maxDaySeconds: number;
  topReadItems: ItemReadingEntry[];
  recentlyAdded: RecentlyAddedEntry[];
  /** Day key -> papers read that day, longest first. */
  dayReadings: Record<string, DayReadingItem[]>;
}

export interface ItemReadingEntry {
  title: string;
  totalSeconds: number;
  lastReadAt: number;
  libraryID: number;
  itemKey: string;
}

export interface RecentlyAddedEntry {
  title: string;
  dateAdded: number;
  itemType: string;
  libraryID: number;
  itemKey: string;
}

export type { ItemReadingRef } from "./ReadingStatsStore";

function getItemDateAddedMs(item: Zotero.Item): number {
  const raw = item.dateAdded as Date | string | undefined;
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Map seconds to GitHub-style intensity levels. */
export function readingSecondsToLevel(
  seconds: number,
  maxSeconds: number,
): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0) {
    return 0;
  }
  if (maxSeconds <= 0) {
    return 1;
  }
  const ratio = seconds / maxSeconds;
  if (ratio >= 0.75) {
    return 4;
  }
  if (ratio >= 0.5) {
    return 3;
  }
  if (ratio >= 0.25) {
    return 2;
  }
  return 1;
}

export function formatReadingDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) {
    return `${safe}s`;
  }
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (remainMinutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainMinutes} min`;
}

/** Compact duration for narrow stat cards (single line). */
export function formatReadingDurationCompact(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) {
    return `${safe}s`;
  }
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (remainMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${remainMinutes}m`;
}

export function formatReadingDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

function resolveItemTitle(libraryID: number, itemKey: string): string {
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    if (!item || item.deleted) {
      return itemKey;
    }
    return item.getDisplayTitle() || itemKey;
  } catch {
    return itemKey;
  }
}

async function getTopReadItems(
  data: ReadingStatsFile,
  limit = 6,
): Promise<ItemReadingEntry[]> {
  const entries = Object.values(data.items)
    .filter((entry) => entry.totalSeconds > 0)
    .sort((left, right) => {
      if (right.totalSeconds !== left.totalSeconds) {
        return right.totalSeconds - left.totalSeconds;
      }
      return right.lastReadAt - left.lastReadAt;
    })
    .slice(0, limit);

  return entries.map((entry) => ({
    libraryID: entry.libraryID,
    itemKey: entry.itemKey,
    totalSeconds: entry.totalSeconds,
    lastReadAt: entry.lastReadAt,
    title: resolveItemTitle(entry.libraryID, entry.itemKey),
  }));
}

async function getRecentlyAddedLiterature(
  limit = 6,
  libraryId = Zotero.Libraries.userLibraryID,
): Promise<RecentlyAddedEntry[]> {
  const collected: RecentlyAddedEntry[] = [];
  try {
    for (const typeName of LITERATURE_ITEM_TYPES) {
      const search = new Zotero.Search({ libraryID: libraryId });
      search.addCondition("itemType", "is", typeName);
      const ids = await search.search();
      if (!ids.length) {
        continue;
      }
      const items = await Zotero.Items.getAsync(ids);
      for (const item of items) {
        if (!item || item.deleted) {
          continue;
        }
        const dateAdded = getItemDateAddedMs(item);
        collected.push({
          libraryID: item.libraryID,
          itemKey: item.key,
          title: item.getDisplayTitle() || item.key,
          dateAdded,
          itemType: typeName,
        });
      }
    }
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to list recent items:", error);
    return [];
  }

  return collected
    .sort((left, right) => right.dateAdded - left.dateAdded)
    .slice(0, limit);
}

export async function getLiteratureCounts(
  libraryId = Zotero.Libraries.userLibraryID,
): Promise<LiteratureCounts> {
  try {
    let total = 0;
    let read = 0;
    for (const typeName of LITERATURE_ITEM_TYPES) {
      const search = new Zotero.Search({ libraryID: libraryId });
      search.addCondition("itemType", "is", typeName);
      const ids = await search.search();
      if (!ids.length) {
        continue;
      }
      const items = await Zotero.Items.getAsync(ids);
      for (const item of items) {
        if (!item || item.deleted) {
          continue;
        }
        total += 1;
        const dateRead = item.getField("dateRead");
        if (dateRead && String(dateRead).trim()) {
          read += 1;
        }
      }
    }
    return { total, markedRead: read, read, withReadingTime: 0 };
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to count library items:", error);
    return { total: 0, markedRead: 0, read: 0, withReadingTime: 0 };
  }
}

async function countLiteratureWithReadingTime(
  data: ReadingStatsFile,
  libraryId = Zotero.Libraries.userLibraryID,
): Promise<number> {
  const keys = new Set<string>();
  for (const entry of Object.values(data.items)) {
    if (
      entry.totalSeconds > 0 &&
      entry.libraryID === libraryId &&
      entry.itemKey
    ) {
      keys.add(entry.itemKey);
    }
  }
  if (!keys.size) {
    return 0;
  }
  let count = 0;
  for (const itemKey of keys) {
    try {
      const item = Zotero.Items.getByLibraryAndKey(libraryId, itemKey);
      if (item && !item.deleted && item.isRegularItem?.()) {
        count += 1;
      }
    } catch {
      // skip invalid keys
    }
  }
  return count;
}

/** Number of weeks shown in the reading heatmap (fits narrow chat sidebar). */
export const READING_HEATMAP_WEEKS = 26;

function buildHeatmapCells(
  data: ReadingStatsFile,
  endDate: Date,
  weekCount = READING_HEATMAP_WEEKS,
): {
  cells: ReadingDayCell[];
  rangeStart: Date;
  rangeEnd: Date;
  maxDaySeconds: number;
  weekCount: number;
} {
  const end = startOfLocalDay(endDate);
  const start = addLocalDays(end, -(weekCount * 7 - 1));
  const startSunday = addLocalDays(start, -start.getDay());

  const maxDaySeconds = Object.values(data.dailySeconds).reduce(
    (max, value) => Math.max(max, value),
    0,
  );

  const cells: ReadingDayCell[] = [];
  for (let offset = 0; offset < weekCount * 7; offset += 1) {
    const date = addLocalDays(startSunday, offset);
    const dayKey = formatLocalDayKey(date);
    const seconds = data.dailySeconds[dayKey] || 0;
    cells.push({
      dayKey,
      date,
      seconds,
      level: readingSecondsToLevel(seconds, maxDaySeconds),
    });
  }

  return {
    cells,
    rangeStart: startSunday,
    rangeEnd: end,
    maxDaySeconds,
    weekCount,
  };
}

function buildDayReadings(
  data: ReadingStatsFile,
): Record<string, DayReadingItem[]> {
  const readings: Record<string, DayReadingItem[]> = {};
  for (const [dayKey, byItem] of Object.entries(data.dailyItems || {})) {
    const entries = Object.entries(byItem)
      .filter(([, seconds]) => seconds > 0)
      .map(([storageKey, seconds]) => {
        const record = data.items[storageKey];
        const [libraryRaw, itemKey = ""] = storageKey.split(":");
        const libraryID = record?.libraryID ?? Number(libraryRaw);
        const resolvedKey = record?.itemKey || itemKey;
        return {
          libraryID,
          itemKey: resolvedKey,
          seconds,
          title: resolveItemTitle(libraryID, resolvedKey),
        };
      })
      .sort((left, right) => right.seconds - left.seconds);
    if (entries.length) {
      readings[dayKey] = entries;
    }
  }
  return readings;
}

export async function getReadingStatsSnapshot(
  now = new Date(),
): Promise<ReadingStatsSnapshot> {
  await ensureZoteroStyleReadingImport();
  const data = await loadReadingStats();
  const baseLiterature = await getLiteratureCounts();
  const withReadingTime = await countLiteratureWithReadingTime(data);
  const literature: LiteratureCounts = {
    ...baseLiterature,
    withReadingTime,
  };
  const topReadItems = await getTopReadItems(data);
  const recentlyAdded = await getRecentlyAddedLiterature();
  const { cells, rangeStart, rangeEnd, maxDaySeconds, weekCount } =
    buildHeatmapCells(data, now);

  const weekStart = addLocalDays(startOfLocalDay(now), -now.getDay());
  let totalSecondsThisWeek = 0;
  let totalSecondsLastYear = 0;
  let activeDaysLastYear = 0;

  for (const cell of cells) {
    if (cell.seconds <= 0) {
      continue;
    }
    totalSecondsLastYear += cell.seconds;
    activeDaysLastYear += 1;
    if (cell.date >= weekStart && cell.date <= startOfLocalDay(now)) {
      totalSecondsThisWeek += cell.seconds;
    }
  }

  return {
    literature,
    dailySeconds: data.dailySeconds,
    cells,
    weekCount,
    rangeStart,
    rangeEnd,
    totalSecondsLastYear,
    totalSecondsThisWeek,
    activeDaysLastYear,
    maxDaySeconds,
    topReadItems,
    recentlyAdded,
    dayReadings: buildDayReadings(data),
  };
}

export async function recordReadingSeconds(
  seconds: number,
  itemRef?: ItemReadingRef,
): Promise<void> {
  await addReadingSeconds(seconds, formatLocalDayKey(), itemRef);
}
