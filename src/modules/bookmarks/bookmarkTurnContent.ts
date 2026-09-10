import type { BookmarkRecord } from "../../types/bookmark";
import type { ChatMessage, ChatSession } from "../../types/chat";
import type { EvidenceRecord } from "../../types/evidence";
import { extractEditableUserMessageContent } from "../chat/user-message-edit";
import { extractSourceGroupFragments } from "../ui/chat-panel/MarkdownRenderer";

export interface BookmarkTurnContent {
  userContent: string | null;
  assistantContent: string;
  evidenceRecords?: EvidenceRecord[];
  assistantMessageId?: string;
}

type SourceGroupFragment = ReturnType<typeof extractSourceGroupFragments>[number];

/** Strip copied "## Thinking" sections from reader-facing assistant content. */
export function stripReaderThinkingSection(content: string): string {
  const trimmed = content.trim();
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine !== "## Thinking") {
    return trimmed;
  }
  return trimmed.replace(/^## Thinking\s*\r?\n[\s\S]*?(?:\r?\n\r?\n|$)/, "").trim();
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function serializeSourceGroupFragment(
  fragment: Extract<SourceGroupFragment, { kind: "source-group" }>,
): string {
  const attrs = [
    `type="${escapeXmlAttribute(fragment.type)}"`,
    `label="${escapeXmlAttribute(fragment.label)}"`,
  ];
  if (fragment.key) {
    attrs.push(`key="${escapeXmlAttribute(fragment.key)}"`);
  }
  if (fragment.url) {
    attrs.push(`url="${escapeXmlAttribute(fragment.url)}"`);
  }
  if (fragment.page != null) {
    attrs.push(`page="${String(fragment.page)}"`);
  }
  return `<source-group ${attrs.join(" ")}>${fragment.content}</source-group>`;
}

/** Merge consecutive source groups that point to the same paper/item. */
export function mergeAdjacentSourceGroups(content: string): string {
  const fragments = extractSourceGroupFragments(content);
  if (!fragments.some((fragment) => fragment.kind === "source-group")) {
    return content;
  }

  const merged: SourceGroupFragment[] = [];
  for (const fragment of fragments) {
    if (fragment.kind === "markdown") {
      merged.push(fragment);
      continue;
    }

    const last = merged[merged.length - 1];
    if (
      last?.kind === "source-group" &&
      last.type === fragment.type &&
      last.label === fragment.label &&
      (last.key || "") === (fragment.key || "")
    ) {
      last.content = [last.content.trim(), fragment.content.trim()]
        .filter(Boolean)
        .join("\n\n");
      continue;
    }
    merged.push({ ...fragment });
  }

  return merged
    .map((fragment) =>
      fragment.kind === "markdown"
        ? fragment.content
        : serializeSourceGroupFragment(fragment),
    )
    .filter((part) => part.trim())
    .join("\n\n");
}

/** Merge repeated markdown headings produced by bookmark copy formatting. */
export function mergeDuplicateMarkdownHeadings(content: string): string {
  const headingPattern = /^###\s+(.+)$/;
  const lines = content.split(/\r?\n/);
  const preamble: string[] = [];
  const sections: Array<{ title: string; lines: string[] }> = [];

  let index = 0;
  while (index < lines.length && !headingPattern.test(lines[index] ?? "")) {
    preamble.push(lines[index] ?? "");
    index += 1;
  }

  while (index < lines.length) {
    const match = lines[index]?.match(headingPattern);
    if (!match) {
      const lastSection = sections[sections.length - 1];
      if (lastSection) {
        lastSection.lines.push(lines[index] ?? "");
      } else {
        preamble.push(lines[index] ?? "");
      }
      index += 1;
      continue;
    }

    const title = match[1];
    index += 1;
    const bodyLines: string[] = [];
    while (index < lines.length && !headingPattern.test(lines[index] ?? "")) {
      bodyLines.push(lines[index] ?? "");
      index += 1;
    }

    const lastSection = sections[sections.length - 1];
    if (lastSection && lastSection.title === title) {
      if (bodyLines.some((line) => line.trim())) {
        if (lastSection.lines.some((line) => line.trim())) {
          lastSection.lines.push("");
        }
        lastSection.lines.push(...bodyLines);
      }
      continue;
    }

    sections.push({ title, lines: bodyLines });
  }

  const parts = [preamble.join("\n").trim()];
  for (const section of sections) {
    parts.push(`### ${section.title}`, section.lines.join("\n").trim());
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

export function prepareReaderAssistantContent(rawContent: string): string {
  const stripped = stripReaderThinkingSection(rawContent);
  if (/<source-group\b/i.test(stripped)) {
    return mergeAdjacentSourceGroups(stripped);
  }
  return mergeDuplicateMarkdownHeadings(stripped);
}

export function findPrecedingUserMessage(
  messages: ChatMessage[],
  assistantMessageId: string,
): ChatMessage | null {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId,
  );
  if (assistantIndex < 0) {
    return null;
  }
  for (let cursor = assistantIndex - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message.role === "user" && !message.isSystemNotice) {
      return message;
    }
  }
  return null;
}

export function resolveTurnContentFromSession(
  session: ChatSession | null,
  bookmark: BookmarkRecord,
): BookmarkTurnContent {
  const fallbackAssistant = prepareReaderAssistantContent(bookmark.content);
  if (!session || !bookmark.messageId) {
    return {
      userContent: null,
      assistantContent: fallbackAssistant,
    };
  }

  const assistant = session.messages.find(
    (message) => message.id === bookmark.messageId,
  );
  const user = findPrecedingUserMessage(session.messages, bookmark.messageId);
  const assistantContent = assistant
    ? prepareReaderAssistantContent(assistant.content)
    : fallbackAssistant;
  const userContent = user
    ? extractEditableUserMessageContent(user) || user.content
    : null;
  return {
    userContent,
    assistantContent: assistantContent || fallbackAssistant,
    evidenceRecords: assistant?.evidence,
    assistantMessageId: assistant?.id,
  };
}

export async function resolveBookmarkTurnContent(
  bookmark: BookmarkRecord,
  loadSession: (sessionId: string) => Promise<ChatSession | null>,
): Promise<BookmarkTurnContent> {
  if (!bookmark.sessionId || !bookmark.messageId) {
    return {
      userContent: null,
      assistantContent: prepareReaderAssistantContent(bookmark.content),
    };
  }

  try {
    const session = await loadSession(bookmark.sessionId);
    return resolveTurnContentFromSession(session, bookmark);
  } catch {
    return {
      userContent: null,
      assistantContent: prepareReaderAssistantContent(bookmark.content),
    };
  }
}
