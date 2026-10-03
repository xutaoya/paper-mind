import { getPref, setPref } from "../../utils/prefs";
import {
  formatLocalDayKey,
  itemReadingStorageKey,
  loadReadingStats,
  saveReadingStats,
  type ReadingStatsFile,
} from "./ReadingStatsStore";

/** Ethereal Style (zotero-style) preference namespace. */
const STYLE_PREFS_ROOT = "extensions.zotero.zoterostyle";
const STYLE_ADDON_REF = "zoterostyle";

const ZOTERO_ITEM_KEY_PATTERN = /^[A-Z0-9]{8}$/;

/** Read a Style plugin pref (path differs by Zotero version / registration). */
export function readZoteroStylePref(suffix: string): string | undefined {
  const keys = [
    `${STYLE_PREFS_ROOT}.${suffix}`,
    `${STYLE_ADDON_REF}.${suffix}`,
    `extensions.${STYLE_ADDON_REF}.${suffix}`,
  ];
  for (const prefKey of keys) {
    for (const global of [true, false] as const) {
      try {
        const raw = Zotero.Prefs.get(prefKey, global) as string | undefined;
        if (raw != null && String(raw).trim()) {
          return String(raw).trim();
        }
      } catch {
        // try next key
      }
    }
  }
  return undefined;
}

export interface ZoteroStyleReadingTimeBlock {
  page?: number;
  data?: Record<string, number>;
}

export type ZoteroStyleProgressMap = Record<
  string,
  { readingTime?: ZoteroStyleReadingTimeBlock }
>;

let importPromise: Promise<void> | null = null;

export function sumZoteroStyleReadingSeconds(
  data: Record<string, number> | undefined,
): number {
  if (!data) {
    return 0;
  }
  let total = 0;
  for (const value of Object.values(data)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      total += value;
    }
  }
  return Math.round(total);
}

export function parseZoteroStyleProgressMap(
  raw: unknown,
): ZoteroStyleProgressMap {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw as ZoteroStyleProgressMap;
}

function getStyleStorageMode(): "file" | "note" | null {
  try {
    const mode = readZoteroStylePref("storage.in");
    if (mode === "file" || mode === "note") {
      return mode;
    }
  } catch {
    // Style not installed or prefs unavailable
  }
  return null;
}

function findItemByKeyAcrossLibraries(itemKey: string): Zotero.Item | null {
  try {
    for (const library of Zotero.Libraries.getAll()) {
      const item = Zotero.Items.getByLibraryAndKey(
        library.libraryID,
        itemKey,
      );
      if (item && !item.deleted) {
        return item;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function getItemDateModifiedMs(item: Zotero.Item): number {
  const raw = item.dateModified as Date | string | undefined;
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function resolveStyleJsonPath(configured: string): Promise<string | null> {
  const trimmed = configured.trim();
  if (!trimmed) {
    return null;
  }
  const withJson = trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
  const leafName = withJson.includes("/")
    ? withJson.slice(withJson.lastIndexOf("/") + 1)
    : withJson;

  const candidates: string[] = [trimmed, withJson];
  try {
    const dataDir = Zotero.DataDirectory.dir;
    candidates.push(
      PathUtils.join(dataDir, trimmed),
      PathUtils.join(dataDir, withJson),
      PathUtils.join(dataDir, leafName),
    );
    const temp = Zotero.getTempDirectory();
    const tempParent = temp.path.replace(temp.leafName, "");
    candidates.push(
      PathUtils.join(tempParent, leafName),
      PathUtils.join(tempParent, withJson),
    );
  } catch {
    // continue with absolute paths only
  }

  const seen = new Set<string>();
  try {
    for (const path of candidates) {
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      if (await IOUtils.exists(path)) {
        return path;
      }
    }
  } catch (error) {
    ztoolkit.log("[ReadingStats] Style JSON path resolve failed:", error);
  }
  return null;
}

async function loadStyleProgressFromFile(): Promise<{
  map: ZoteroStyleProgressMap;
  fingerprint: string;
} | null> {
  const configured = readZoteroStylePref("storage.filename");
  if (!configured) {
    return null;
  }
  const path = await resolveStyleJsonPath(configured);
  if (!path) {
    return null;
  }
  try {
    const raw = await IOUtils.readJSON(path);
    const map = parseZoteroStyleProgressMap(raw);
    let fingerprint = `file:${path}`;
    try {
      const info = await IOUtils.stat(path);
      fingerprint = `file:${path}:${info.lastModified}:${info.size}`;
    } catch {
      // keep path-only fingerprint
    }
    return { map, fingerprint };
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to read Style progress JSON:", error);
    return null;
  }
}

function parseStyleNotePayload(
  noteHtml: string,
): { itemKey: string; readingTime?: ZoteroStyleReadingTimeBlock } | null {
  const plain = noteHtml.replace(/<[^>]+>/g, "");
  const jsonStart = plain.indexOf("{");
  if (jsonStart < 0) {
    return null;
  }
  const prefix = plain.slice(0, jsonStart).trim();
  const itemKey =
    prefix.split(/\s+/)[0]?.trim().toUpperCase() ||
    prefix.slice(0, 8).toUpperCase();
  if (!ZOTERO_ITEM_KEY_PATTERN.test(itemKey)) {
    return null;
  }
  try {
    const payload = JSON.parse(plain.slice(jsonStart)) as {
      readingTime?: ZoteroStyleReadingTimeBlock;
    };
    return { itemKey, readingTime: payload.readingTime };
  } catch {
    return null;
  }
}

async function findStyleAddonItem(): Promise<Zotero.Item | null> {
  try {
    const prefKey = Zotero.Prefs.get("Zotero.AddonItem.key", true) as string;
    if (prefKey) {
      const fromPref = findItemByKeyAcrossLibraries(prefKey);
      if (fromPref) {
        return fromPref;
      }
    }
    const search = new Zotero.Search();
    search.addCondition("title", "contains", "Addon Item");
    const ids = await search.search();
    if (!ids.length) {
      return null;
    }
    const items = await Zotero.Items.getAsync(ids);
    return items.find((item) => item && !item.deleted) || null;
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to locate Style Addon Item:", error);
    return null;
  }
}

async function loadStyleProgressFromNotes(): Promise<{
  map: ZoteroStyleProgressMap;
  fingerprint: string;
} | null> {
  const addonItem = await findStyleAddonItem();
  if (!addonItem) {
    return null;
  }
  const map: ZoteroStyleProgressMap = {};
  let totalSeconds = 0;
  try {
    const noteIds = addonItem.getNotes();
    for (const noteId of noteIds) {
      const idInfo = Zotero.Items.getLibraryAndKeyFromID(noteId);
      if (!idInfo) {
        continue;
      }
      const noteItem = Zotero.Items.getByLibraryAndKey(
        idInfo.libraryID,
        idInfo.key,
      );
      if (!noteItem || noteItem.deleted) {
        continue;
      }
      const parsed = parseStyleNotePayload(String(noteItem.note || ""));
      if (!parsed?.readingTime?.data) {
        continue;
      }
      const seconds = sumZoteroStyleReadingSeconds(parsed.readingTime.data);
      if (seconds <= 0) {
        continue;
      }
      map[parsed.itemKey] = { readingTime: parsed.readingTime };
      totalSeconds += seconds;
    }
  } catch (error) {
    ztoolkit.log("[ReadingStats] Failed to read Style progress notes:", error);
    return null;
  }
  if (!Object.keys(map).length) {
    return null;
  }
  const fingerprint = `note:${addonItem.key}:${Object.keys(map).length}:${totalSeconds}`;
  return { map, fingerprint };
}

async function loadStyleProgressSource(): Promise<{
  map: ZoteroStyleProgressMap;
  fingerprint: string;
} | null> {
  const mode = getStyleStorageMode();
  const hasFilename = Boolean(readZoteroStylePref("storage.filename"));

  if (mode === "file" || hasFilename) {
    const fromFile = await loadStyleProgressFromFile();
    if (fromFile) {
      return fromFile;
    }
  }
  if (mode === "note" || mode !== "file" || hasFilename) {
    return loadStyleProgressFromNotes();
  }
  return null;
}

function mergeStyleIntoStats(
  data: ReadingStatsFile,
  map: ZoteroStyleProgressMap,
): boolean {
  let changed = false;
  for (const [rawKey, block] of Object.entries(map)) {
    const itemKey = rawKey.toUpperCase();
    if (!ZOTERO_ITEM_KEY_PATTERN.test(itemKey)) {
      continue;
    }
    const total = sumZoteroStyleReadingSeconds(block?.readingTime?.data);
    if (total <= 0) {
      continue;
    }
    const item = findItemByKeyAcrossLibraries(itemKey);
    if (!item || item.deleted) {
      continue;
    }
    const literatureItem = item.isRegularItem?.()
      ? item
      : item.parentItem && !item.parentItem.deleted
        ? item.parentItem
        : null;
    if (!literatureItem) {
      continue;
    }

    const ref = {
      libraryID: literatureItem.libraryID,
      itemKey: literatureItem.key,
    };
    const storageKey = itemReadingStorageKey(ref);
    const lastReadAt = getItemDateModifiedMs(literatureItem) || Date.now();
    const existing = data.items[storageKey];

    if (existing) {
      const nextTotal = Math.max(existing.totalSeconds, total);
      const nextLastRead = Math.max(existing.lastReadAt, lastReadAt);
      if (
        nextTotal !== existing.totalSeconds ||
        nextLastRead !== existing.lastReadAt
      ) {
        data.items[storageKey] = {
          ...existing,
          totalSeconds: nextTotal,
          lastReadAt: nextLastRead,
        };
        changed = true;
      }
      continue;
    }

    data.items[storageKey] = {
      libraryID: ref.libraryID,
      itemKey: ref.itemKey,
      totalSeconds: total,
      lastReadAt,
    };
    const dayKey = formatLocalDayKey(new Date(lastReadAt));
    data.dailySeconds[dayKey] = (data.dailySeconds[dayKey] || 0) + total;
    const dayItems = data.dailyItems[dayKey] || {};
    dayItems[storageKey] = (dayItems[storageKey] || 0) + total;
    data.dailyItems[dayKey] = dayItems;
    changed = true;
  }
  return changed;
}

async function runZoteroStyleReadingImport(): Promise<void> {
  if (typeof Zotero === "undefined" || !Zotero.initializationPromise) {
    return;
  }
  await Zotero.initializationPromise;

  const source = await loadStyleProgressSource();
  if (!source) {
    return;
  }

  const storedFingerprint =
    (getPref("readingStatsStyleImportFingerprint") as string) || "";
  if (storedFingerprint && storedFingerprint === source.fingerprint) {
    return;
  }

  const data = await loadReadingStats();
  const changed = mergeStyleIntoStats(data, source.map);
  if (changed) {
    await saveReadingStats(data);
    ztoolkit.log(
      `[ReadingStats] Imported reading time from Zotero Style (${Object.keys(source.map).length} entries)`,
    );
  }
  setPref("readingStatsStyleImportFingerprint", source.fingerprint);
}

/** One-time (per Style source fingerprint) import from Ethereal Style reading progress. */
export function ensureZoteroStyleReadingImport(): Promise<void> {
  if (!importPromise) {
    importPromise = runZoteroStyleReadingImport().catch((error: unknown) => {
      importPromise = null;
      ztoolkit.log("[ReadingStats] Zotero Style import failed:", error);
    });
  }
  return importPromise;
}
