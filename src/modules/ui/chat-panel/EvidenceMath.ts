import katex from "katex";
import {
  extractMathMLMarkup,
  importMathMLIntoDocument,
} from "../../../utils/chatMathMarkdown";

export interface EvidenceMathSpan {
  start: number;
  end: number;
  content: string;
  displayMode: boolean;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  while (index > 0 && text[--index] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

/** Only complete, explicit delimiters count; never repair extracted evidence. */
export function findEvidenceMath(text: string): EvidenceMathSpan[] {
  const spans: EvidenceMathSpan[] = [];
  for (let index = 0; index < text.length; index++) {
    if (isEscaped(text, index)) continue;
    if (text[index] === "`") {
      const fence = text.slice(index).match(/^`+/)![0];
      const end = text.indexOf(fence, index + fence.length);
      if (end >= 0) index = end + fence.length - 1;
      continue;
    }
    const opener = text.startsWith("\\[", index)
      ? "\\["
      : text.startsWith("\\(", index)
        ? "\\("
        : text.startsWith("$$", index)
          ? "$$"
          : text[index] === "$"
            ? "$"
            : null;
    if (!opener) continue;
    const closer = opener === "\\[" ? "\\]" : opener === "\\(" ? "\\)" : opener;
    const displayMode = opener === "$$" || opener === "\\[";
    const start = index + opener.length;
    let end = text.indexOf(closer, start);
    while (end >= 0 && isEscaped(text, end)) {
      end = text.indexOf(closer, end + closer.length);
    }
    if (end < 0) {
      index += opener.length - 1;
      continue;
    }
    const content = text.slice(start, end);
    if (
      !content.trim() ||
      (!displayMode && content.includes("\n")) ||
      (opener === "$" &&
        (/^\s|\s$/.test(content) || /[\d$]/.test(text[end + 1] || "")))
    ) {
      index += opener.length - 1;
      continue;
    }
    spans.push({
      start: index,
      end: end + closer.length,
      content,
      displayMode,
    });
    index = end + closer.length - 1;
  }
  return spans;
}

export function renderEvidenceMath(
  node: HTMLElement,
  span: EvidenceMathSpan,
): boolean {
  try {
    const markup = extractMathMLMarkup(
      katex.renderToString(span.content, {
        displayMode: span.displayMode,
        output: "mathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxSize: 16,
        maxExpand: 200,
      }),
    );
    return (
      !!markup && importMathMLIntoDocument(node.ownerDocument, node, markup)
    );
  } catch {
    return false;
  }
}
