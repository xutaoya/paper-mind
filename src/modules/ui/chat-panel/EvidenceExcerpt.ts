import { HTML_NS } from "./types";
import { findEvidenceMath, renderEvidenceMath } from "./EvidenceMath";

type ExcerptBlock = {
  kind: "page-header" | "heading" | "paragraph";
  text: string;
};

// Require explicit journal metadata so ordinary opening prose stays untouched.
const JOURNAL_HEADER =
  /^\s*(?:\d{1,6}\s+)?[A-Z][A-Z0-9\s&(),./'’–—-]{8,}?\bVOL(?:UME)?\.?\s*\d+[A-Z0-9\s,;:()./-]{0,80}?\b(?:19|20)\d{2}\b[\t ]*(?:\r?\n)?/;
const SECTION_HEADING =
  /^(?:[A-Z]\.|[IVXLCDM]+\.|\d+(?:\.\d+)+\.?|\d+[.)]|[a-z]\))\s+\S/;

function isSectionHeading(line: string): boolean {
  const text = line.trim();
  return (
    text.length <= 160 &&
    SECTION_HEADING.test(text) &&
    !/[$\\=^_<>，,;；?!。！？]/.test(text) &&
    !/[.]$/.test(text)
  );
}

/** Partition only at explicit boundaries; joining block text recovers the quote. */
export function splitEvidenceExcerpt(text: string): ExcerptBlock[] {
  const blocks: ExcerptBlock[] = [];
  const header = text.match(JOURNAL_HEADER)?.[0];
  if (header) blocks.push({ kind: "page-header", text: header });
  const remainder = text.slice(header?.length || 0);
  const lines = remainder.match(/[^\n]*\n|[^\n]+$/g) || [];
  const math = findEvidenceMath(remainder);
  let offset = 0;
  let paragraph = "";
  const flush = (): void => {
    if (!paragraph) return;
    if (!paragraph.trim() && blocks.length) {
      blocks[blocks.length - 1].text += paragraph;
    } else {
      blocks.push({ kind: "paragraph", text: paragraph });
    }
    paragraph = "";
  };
  for (const line of lines) {
    const insideMath = math.some(
      (span) => offset > span.start && offset < span.end,
    );
    if (!insideMath && isSectionHeading(line)) {
      flush();
      blocks.push({ kind: "heading", text: line });
    } else {
      paragraph += line;
      if (!insideMath && !line.trim()) flush();
    }
    offset += line.length;
  }
  flush();
  return blocks;
}

export function renderEvidenceExcerpt(
  host: HTMLElement,
  text: string,
  mutedColor: string,
): { needsSourcePreview: boolean } {
  host.textContent = "";
  let needsSourcePreview = false;
  const blocks = splitEvidenceExcerpt(text);
  blocks.forEach((block, index) => {
    const node = host.ownerDocument.createElementNS(
      HTML_NS,
      "p",
    ) as HTMLElement;
    node.setAttribute("data-evidence-text-block", block.kind);
    const spans = findEvidenceMath(block.text);
    let cursor = 0;
    for (const span of spans) {
      node.appendChild(
        host.ownerDocument.createTextNode(block.text.slice(cursor, span.start)),
      );
      const formula = host.ownerDocument.createElementNS(
        HTML_NS,
        "span",
      ) as HTMLElement;
      formula.setAttribute(
        "data-evidence-math",
        span.displayMode ? "display" : "inline",
      );
      formula.setAttribute("title", block.text.slice(span.start, span.end));
      Object.assign(
        formula.style,
        span.displayMode
          ? {
              display: "block",
              overflowX: "auto",
              maxWidth: "100%",
              padding: "8px 0",
              whiteSpace: "nowrap",
              overflowWrap: "normal",
              textAlign: "left",
            }
          : {
              display: "inline-block",
              maxWidth: "100%",
              overflowX: "auto",
              verticalAlign: "middle",
              overflowWrap: "normal",
            },
      );
      if (!renderEvidenceMath(formula, span)) {
        formula.textContent = block.text.slice(span.start, span.end);
        formula.setAttribute("data-evidence-math-fallback", "true");
        formula.style.whiteSpace = "pre-wrap";
        needsSourcePreview = true;
      }
      node.appendChild(formula);
      cursor = span.end;
    }
    node.appendChild(
      host.ownerDocument.createTextNode(block.text.slice(cursor)),
    );
    const plainText = spans.reduceRight(
      (value, span) => value.slice(0, span.start) + value.slice(span.end),
      block.text,
    );
    if (
      /\\(?:\[|\(|frac|mathcal|mathbb|begin|sum|int)|\$\$|[A-Za-z}]\s*[_^]|[∑∏∫√∈ℝ]/.test(
        plainText,
      )
    ) {
      needsSourcePreview = true;
    }
    Object.assign(node.style, {
      margin: index === blocks.length - 1 ? "0" : "0 0 12px",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
    });
    if (block.kind === "page-header") {
      Object.assign(node.style, {
        color: mutedColor,
        fontSize: "11px",
        lineHeight: "1.55",
      });
    } else if (block.kind === "heading") {
      Object.assign(node.style, { fontWeight: "650", lineHeight: "1.55" });
    }
    host.appendChild(node);
  });
  return { needsSourcePreview };
}
