import { getStorageDatabase } from "../chat/db/StorageDatabase";
import { formatLocalDayKey } from "../reading-stats/ReadingStatsStore";
import {
  getStartOfLocalWeek,
  READING_HEATMAP_WEEKS,
  readingSecondsToLevel,
} from "../reading-stats/ReadingStatsService";

export interface ChatDayCell {
  dayKey: string;
  date: Date;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface ChatActivitySnapshot {
  weekCount: number;
  cells: ChatDayCell[];
  messagesThisWeek: number;
  messagesLastWeek: number;
  userMessagesThisWeek: number;
  activeDaysThisWeek: number;
  totalUserMessages: number;
  totalAssistantMessages: number;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sumMessagesInDayKeyRange(
  daily: Record<string, { total: number }>,
  startKey: string,
  endKey: string,
): number {
  let total = 0;
  for (const [dayKey, day] of Object.entries(daily)) {
    if (dayKey < startKey || dayKey > endKey) {
      continue;
    }
    total += day.total;
  }
  return total;
}

async function loadDailyMessageCounts(
  minTimestamp: number,
): Promise<Record<string, { user: number; assistant: number; total: number }>> {
  const db = await getStorageDatabase().ensureInit();
  const rows =
    (await db.queryAsync(
      `SELECT timestamp, role
       FROM messages
       WHERE timestamp >= ?
         AND (api_only IS NULL OR api_only = 0)
         AND (is_system_notice IS NULL OR is_system_notice = 0)
         AND role IN ('user', 'assistant')`,
      [minTimestamp],
    )) || [];

  const daily: Record<string, { user: number; assistant: number; total: number }> =
    {};
  for (const row of rows) {
    const timestamp = Number((row as { timestamp: number }).timestamp);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    const role = String((row as { role: string }).role);
    const dayKey = formatLocalDayKey(new Date(timestamp));
    const bucket = daily[dayKey] || { user: 0, assistant: 0, total: 0 };
    if (role === "user") {
      bucket.user += 1;
    } else if (role === "assistant") {
      bucket.assistant += 1;
    }
    bucket.total = bucket.user + bucket.assistant;
    daily[dayKey] = bucket;
  }
  return daily;
}

export async function getChatActivitySnapshot(
  now = new Date(),
  weekCount = READING_HEATMAP_WEEKS,
): Promise<ChatActivitySnapshot> {
  const end = startOfLocalDay(now);
  const rangeStart = addLocalDays(end, -(weekCount * 7 - 1));
  const startSunday = addLocalDays(rangeStart, -rangeStart.getDay());
  const minTimestamp = startSunday.getTime();

  const daily = await loadDailyMessageCounts(minTimestamp);
  const maxDayMessages = Object.values(daily).reduce(
    (max, day) => Math.max(max, day.total),
    0,
  );

  const cells: ChatDayCell[] = [];
  for (let offset = 0; offset < weekCount * 7; offset += 1) {
    const date = addLocalDays(startSunday, offset);
    const dayKey = formatLocalDayKey(date);
    const day = daily[dayKey] || { user: 0, assistant: 0, total: 0 };
    cells.push({
      dayKey,
      date,
      userMessages: day.user,
      assistantMessages: day.assistant,
      totalMessages: day.total,
      level: readingSecondsToLevel(day.total, maxDayMessages),
    });
  }

  const weekStartKey = formatLocalDayKey(getStartOfLocalWeek(now));
  const todayKey = formatLocalDayKey(now);
  const prevWeekStart = formatLocalDayKey(
    getStartOfLocalWeek(addLocalDays(getStartOfLocalWeek(now), -1)),
  );
  const prevWeekEnd = formatLocalDayKey(
    addLocalDays(getStartOfLocalWeek(now), -1),
  );

  let userMessagesThisWeek = 0;
  let activeDaysThisWeek = 0;
  for (const [dayKey, day] of Object.entries(daily)) {
    if (dayKey < weekStartKey || dayKey > todayKey) {
      continue;
    }
    userMessagesThisWeek += day.user;
    if (day.total > 0) {
      activeDaysThisWeek += 1;
    }
  }

  const messagesThisWeek = sumMessagesInDayKeyRange(
    daily,
    weekStartKey,
    todayKey,
  );
  const messagesLastWeek = sumMessagesInDayKeyRange(
    daily,
    prevWeekStart,
    prevWeekEnd,
  );

  let totalUserMessages = 0;
  let totalAssistantMessages = 0;
  for (const day of Object.values(daily)) {
    totalUserMessages += day.user;
    totalAssistantMessages += day.assistant;
  }

  return {
    weekCount,
    cells,
    messagesThisWeek,
    messagesLastWeek,
    userMessagesThisWeek,
    activeDaysThisWeek,
    totalUserMessages,
    totalAssistantMessages,
  };
}
