import type { ChatMessageTurnUsage } from "../../types/chat";
import {
  getStartOfLocalWeek,
  READING_HEATMAP_WEEKS,
  readingSecondsToLevel,
} from "../reading-stats/ReadingStatsService";
import { formatLocalDayKey } from "../reading-stats/ReadingStatsStore";

const STATS_FILE = "paperchat-token-stats.json";

export interface TokenDayRecord {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface TokenModelRecord extends TokenDayRecord {
  model: string;
}

interface TokenStatsFile {
  version: 2;
  daily: Record<string, TokenDayRecord>;
  /** Lifetime totals per model. */
  models: Record<string, TokenModelRecord>;
  /** Per calendar day, per model usage (for day detail popovers). */
  dailyModels: Record<string, Record<string, TokenModelRecord>>;
}

export interface TokenBarDay {
  dayKey: string;
  date: Date;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface TokenHeatCell {
  dayKey: string;
  date: Date;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface TokenStatsSnapshot {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  weekTokens: number;
  lastWeekTokens: number;
  tokenStreakDays: number;
  activeDays: number;
  weekCount: number;
  cells: TokenHeatCell[];
  recentDays: TokenBarDay[];
  models: TokenModelRecord[];
  modelsByDay: Record<string, TokenModelRecord[]>;
}

function emptyStats(): TokenStatsFile {
  return { version: 2, daily: {}, models: {}, dailyModels: {} };
}

function emptyDay(): TokenDayRecord {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
}

function getStatsPath(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, STATS_FILE);
}

function addCount(base: number, delta: number | undefined): number {
  if (!delta || !Number.isFinite(delta) || delta <= 0) {
    return base;
  }
  return base + Math.round(delta);
}

function normalize(raw: unknown): TokenStatsFile {
  if (!raw || typeof raw !== "object") {
    return emptyStats();
  }
  const record = raw as {
    version?: number;
    daily?: Record<string, TokenDayRecord>;
    models?: Record<string, TokenModelRecord>;
    dailyModels?: Record<string, Record<string, TokenModelRecord>>;
  };
  if (record.version === 2) {
    return {
      version: 2,
      daily: { ...(record.daily || {}) },
      models: { ...(record.models || {}) },
      dailyModels: { ...(record.dailyModels || {}) },
    };
  }
  if (record.version === 1) {
    return {
      version: 2,
      daily: { ...(record.daily || {}) },
      models: { ...(record.models || {}) },
      dailyModels: {},
    };
  }
  return emptyStats();
}

function sortModelsByTotal(
  entries: TokenModelRecord[],
): TokenModelRecord[] {
  return entries
    .filter((entry) => entry.inputTokens + entry.outputTokens > 0)
    .sort(
      (left, right) =>
        right.inputTokens +
        right.outputTokens -
        (left.inputTokens + left.outputTokens),
    );
}

function buildModelsByDay(
  dailyModels: Record<string, Record<string, TokenModelRecord>>,
): Record<string, TokenModelRecord[]> {
  const modelsByDay: Record<string, TokenModelRecord[]> = {};
  for (const [dayKey, models] of Object.entries(dailyModels)) {
    const list = sortModelsByTotal(Object.values(models));
    if (list.length) {
      modelsByDay[dayKey] = list;
    }
  }
  return modelsByDay;
}

async function loadTokenStats(): Promise<TokenStatsFile> {
  const path = getStatsPath();
  try {
    if (!(await IOUtils.exists(path))) {
      return emptyStats();
    }
    return normalize(await IOUtils.readJSON(path));
  } catch (error) {
    ztoolkit.log("[TokenStats] Failed to load stats:", error);
    return emptyStats();
  }
}

async function saveTokenStats(data: TokenStatsFile): Promise<void> {
  const keys = Object.keys(data.daily).sort();
  if (keys.length > 400) {
    for (const key of keys.slice(0, keys.length - 400)) {
      delete data.daily[key];
      delete data.dailyModels[key];
    }
  }
  try {
    await IOUtils.writeJSON(getStatsPath(), data);
  } catch (error) {
    ztoolkit.log("[TokenStats] Failed to save stats:", error);
  }
}

export function usageHasTokens(usage: ChatMessageTurnUsage): boolean {
  return (
    (usage.inputTokens ?? 0) > 0 ||
    (usage.outputTokens ?? 0) > 0 ||
    (usage.reasoningTokens ?? 0) > 0 ||
    (usage.totalTokens ?? 0) > 0
  );
}

function applyUsageToDayRecord(
  existing: TokenDayRecord,
  input: number | undefined,
  output: number | undefined,
  reasoning: number | undefined,
): void {
  existing.inputTokens = addCount(existing.inputTokens, input);
  existing.outputTokens = addCount(existing.outputTokens, output);
  existing.reasoningTokens = addCount(existing.reasoningTokens, reasoning);
}

export async function recordTokenUsage(
  usage: ChatMessageTurnUsage,
  model?: string,
): Promise<void> {
  if (!usageHasTokens(usage)) {
    return;
  }
  const data = await loadTokenStats();
  const dayKey = formatLocalDayKey();
  const day = data.daily[dayKey] || emptyDay();
  let input = usage.inputTokens;
  let output = usage.outputTokens;
  if ((input ?? 0) <= 0 && (output ?? 0) <= 0 && (usage.totalTokens ?? 0) > 0) {
    output = usage.totalTokens;
  }
  day.inputTokens = addCount(day.inputTokens, input);
  day.outputTokens = addCount(day.outputTokens, output);
  day.reasoningTokens = addCount(day.reasoningTokens, usage.reasoningTokens);
  data.daily[dayKey] = day;

  const modelName = model?.trim();
  if (modelName) {
    const existing = data.models[modelName] || {
      ...emptyDay(),
      model: modelName,
    };
    applyUsageToDayRecord(
      existing,
      input,
      output,
      usage.reasoningTokens,
    );
    data.models[modelName] = existing;

    const dayModels = data.dailyModels[dayKey] || {};
    const dayModel = dayModels[modelName] || {
      ...emptyDay(),
      model: modelName,
    };
    applyUsageToDayRecord(
      dayModel,
      input,
      output,
      usage.reasoningTokens,
    );
    dayModels[modelName] = dayModel;
    data.dailyModels[dayKey] = dayModels;
  }

  await saveTokenStats(data);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sumTokensInDayKeyRange(
  daily: Record<string, TokenDayRecord>,
  startKey: string,
  endKey: string,
): number {
  let total = 0;
  for (const [dayKey, day] of Object.entries(daily)) {
    if (dayKey < startKey || dayKey > endKey) {
      continue;
    }
    total += day.inputTokens + day.outputTokens;
  }
  return total;
}

function computeTokenStreak(
  daily: Record<string, TokenDayRecord>,
  now: Date,
): number {
  let cursor = startOfLocalDay(now);
  const todayKey = formatLocalDayKey(cursor);
  const todayTotal =
    (daily[todayKey]?.inputTokens || 0) + (daily[todayKey]?.outputTokens || 0);
  if (todayTotal <= 0) {
    cursor = addLocalDays(cursor, -1);
  }
  let streak = 0;
  for (let guard = 0; guard < 4000; guard += 1) {
    const key = formatLocalDayKey(cursor);
    const day = daily[key];
    const total = (day?.inputTokens || 0) + (day?.outputTokens || 0);
    if (total <= 0) {
      break;
    }
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }
  return streak;
}

export async function getTokenStatsSnapshot(
  now = new Date(),
  weekCount = READING_HEATMAP_WEEKS,
): Promise<TokenStatsSnapshot> {
  const data = await loadTokenStats();
  const modelsByDay = buildModelsByDay(data.dailyModels);
  const end = startOfLocalDay(now);
  const weekStartKey = formatLocalDayKey(getStartOfLocalWeek(now));
  const todayKey = formatLocalDayKey(now);
  const prevWeekStart = formatLocalDayKey(
    getStartOfLocalWeek(addLocalDays(getStartOfLocalWeek(now), -1)),
  );
  const prevWeekEnd = formatLocalDayKey(
    addLocalDays(getStartOfLocalWeek(now), -1),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let activeDays = 0;

  for (const [, day] of Object.entries(data.daily)) {
    const total = day.inputTokens + day.outputTokens;
    inputTokens += day.inputTokens;
    outputTokens += day.outputTokens;
    reasoningTokens += day.reasoningTokens;
    if (total > 0) {
      activeDays += 1;
    }
  }

  const weekTokens = sumTokensInDayKeyRange(data.daily, weekStartKey, todayKey);
  const lastWeekTokens = sumTokensInDayKeyRange(
    data.daily,
    prevWeekStart,
    prevWeekEnd,
  );
  const tokenStreakDays = computeTokenStreak(data.daily, now);

  const rangeStart = addLocalDays(end, -(weekCount * 7 - 1));
  const startSunday = addLocalDays(rangeStart, -rangeStart.getDay());
  const maxDayTokens = Object.values(data.daily).reduce(
    (max, day) => Math.max(max, day.inputTokens + day.outputTokens),
    0,
  );
  const cells: TokenHeatCell[] = [];
  for (let offset = 0; offset < weekCount * 7; offset += 1) {
    const date = addLocalDays(startSunday, offset);
    const dayKey = formatLocalDayKey(date);
    const day = data.daily[dayKey] || emptyDay();
    const totalTokens = day.inputTokens + day.outputTokens;
    cells.push({
      dayKey,
      date,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      reasoningTokens: day.reasoningTokens,
      totalTokens,
      level: readingSecondsToLevel(totalTokens, maxDayTokens),
    });
  }

  const recentDays: TokenBarDay[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = addLocalDays(end, -offset);
    const dayKey = formatLocalDayKey(date);
    const day = data.daily[dayKey] || emptyDay();
    recentDays.push({
      dayKey,
      date,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      reasoningTokens: day.reasoningTokens,
      totalTokens: day.inputTokens + day.outputTokens,
    });
  }

  const models = sortModelsByTotal(Object.values(data.models));

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens,
    weekTokens,
    lastWeekTokens,
    tokenStreakDays,
    activeDays,
    weekCount,
    cells,
    recentDays,
    models,
    modelsByDay,
  };
}
