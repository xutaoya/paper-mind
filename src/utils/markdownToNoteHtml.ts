import MarkdownIt from "markdown-it";
import { normalizeBlockquoteListIndentation } from "./chatMathMarkdown";
import {
  preserveEmphasisInMarkdownForNotes,
  renderMathInMarkdownForNotes,
  restorePreservedNoteMarkup,
  unwrapBlockMathParagraphs,
} from "./renderMathInMarkdownForNotes";

const noteMarkdown = new MarkdownIt({
  html: false,
  breaks: true,
  xhtmlOut: true,
  linkify: true,
  typographer: true,
});

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatNoteDateTime(date: Date = new Date()): string {
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

const NOTE_DATETIME_HEADING_REGEX =
  /<h1\b[^>]*>[\s\S]*?\b\d{2}\/\d{2}\/\d{4},\s*\d{2}:\d{2}:\d{2}\b[\s\S]*?<\/h1>/gi;
const PAPERCHAT_NOTES_HEADING_REGEX =
  /<h1\b[^>]*>\s*PaperChat Notes\s*<\/h1>/gi;

export function stripNoteHeadingMarkers(html: string): string {
  return html
    .replace(NOTE_DATETIME_HEADING_REGEX, "")
    .replace(PAPERCHAT_NOTES_HEADING_REGEX, "")
    .trim();
}

export function withLeadingNoteHeading(html: string, title: string): string {
  const heading = `<h1>${escapeHtml(title)}</h1>`;
  const body = stripNoteHeadingMarkers(html);
  return body ? `${heading}\n${body}` : heading;
}

function isMathOnlyLine(line: string): boolean {
  return /^\s*(\$\$[\s\S]+\$\$|\$[^$\n]+\$)\s*$/.test(line);
}

export function separateMathParagraphs(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = lines[index - 1];
    if (
      index > 0 &&
      isMathOnlyLine(previous) &&
      isMathOnlyLine(line) &&
      result[result.length - 1]?.trim() !== ""
    ) {
      result.push("");
    }
    result.push(line);
  }
  return result.join("\n");
}

/** @deprecated Use separateMathParagraphs instead. */
export function compactMathLineSpacing(markdown: string): string {
  return separateMathParagraphs(markdown);
}

function normalizeEmphasisDelimiters(markdown: string): string {
  let normalized = markdown.replace(
    /\*\*([^*\n]+?)[ \t]+\*\*/g,
    (_, text: string) => `**${text.trimEnd()}**`,
  );
  normalized = normalized.replace(
    /\*\*[ \t]+([^*\n]+?)\*\*/g,
    (_, text: string) => `**${text.trimStart()}**`,
  );
  normalized = normalized.replace(
    /__([^_\n]+?)[ \t]+__/g,
    (_, text: string) => `__${text.trimEnd()}__`,
  );
  normalized = normalized.replace(
    /__[ \t]+([^_\n]+?)__/g,
    (_, text: string) => `__${text.trimStart()}__`,
  );
  normalized = normalized.replace(
    /(?<!\*)\*([^*\n]+?)[ \t]+\*(?!\*)/g,
    (_, text: string) => `*${text.trimEnd()}*`,
  );
  normalized = normalized.replace(
    /(?<!\*)\*[ \t]+([^*\n]+?)\*(?!\*)/g,
    (_, text: string) => `*${text.trimStart()}*`,
  );
  return normalized;
}

export function normalizeMarkdownForNotes(markdown: string): string {
  return normalizeEmphasisDelimiters(markdown);
}

export function markdownToNoteHtml(markdown: string): string {
  const trimmed = separateMathParagraphs(
    normalizeMarkdownForNotes(
      normalizeBlockquoteListIndentation(markdown.trim()),
    ),
  );
  if (!trimmed) {
    return "";
  }
  const { processed, preserved } = renderMathInMarkdownForNotes(trimmed, {
    renderCodeBlock: (match) => noteMarkdown.render(match),
    renderInlineCode: (match) => noteMarkdown.renderInline(match),
  });
  const withEmphasis = preserveEmphasisInMarkdownForNotes(processed, preserved);
  const html = noteMarkdown.render(withEmphasis).trim();
  return unwrapBlockMathParagraphs(
    restorePreservedNoteMarkup(html, preserved),
  );
}
