const PRESERVE_TOKEN_PREFIX = "PAPERCHAT_PRESERVE_";
const PRESERVE_TOKEN_SUFFIX = "_END";

function escapeMathHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(text: string): string {
  return escapeMathHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function shouldUseBlockMath(latex: string): boolean {
  return latex.includes("\n") || /\\tag\b/.test(latex);
}

/** Zotero note-editor math_inline serialization. */
function zoteroInlineMathHtml(latex: string): string {
  return `<span class="math">$${escapeMathHtml(latex)}$</span>`;
}

/** Zotero note-editor math_display serialization. */
function zoteroBlockMathHtml(latex: string): string {
  return `<pre class="math">$$${escapeMathHtml(latex)}$$</pre>`;
}

function preserveToken(preserved: string[], html: string): string {
  preserved.push(html);
  return `${PRESERVE_TOKEN_PREFIX}${preserved.length - 1}${PRESERVE_TOKEN_SUFFIX}`;
}

export function preserveEmphasisInMarkdownForNotes(
  content: string,
  preserved: string[],
): string {
  let processed = content.replace(
    /\*\*([^*\n]+?)\*\*/g,
    (match, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return match;
      }
      return preserveToken(
        preserved,
        `<strong>${escapeHtml(trimmed)}</strong>`,
      );
    },
  );
  processed = processed.replace(/__([^_\n]+?)__/g, (match, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return match;
    }
    return preserveToken(preserved, `<strong>${escapeHtml(trimmed)}</strong>`);
  });
  return processed;
}

export function renderMathInMarkdownForNotes(
  content: string,
  options: {
    renderCodeBlock: (match: string) => string;
    renderInlineCode: (match: string) => string;
  },
): { processed: string; preserved: string[] } {
  const preserved: string[] = [];
  let processed = content;

  const preserve = (html: string): string => preserveToken(preserved, html);

  processed = processed.replace(/```[\s\S]*?```/g, (match) => {
    return preserve(options.renderCodeBlock(match));
  });
  processed = processed.replace(/`[^`]+`/g, (match) => {
    return preserve(options.renderInlineCode(match));
  });

  processed = processed.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_, math) => `$$${math}$$`,
  );
  processed = processed.replace(/\\\((.*?)\\\)/g, (_, math) => `$${math}$`);

  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
    const trimmed = (math as string).trim();
    if (!trimmed) {
      return match;
    }
    // Single-line display math without \tag → inline node to reduce block gaps.
    if (!shouldUseBlockMath(trimmed)) {
      return preserve(zoteroInlineMathHtml(trimmed));
    }
    return preserve(zoteroBlockMathHtml(trimmed));
  });

  processed = processed.replace(/\$([^$\n]+?)\$/g, (match, math) => {
    const trimmed = (math as string).trim();
    if (!trimmed) {
      return match;
    }
    if (shouldUseBlockMath(trimmed)) {
      return preserve(zoteroBlockMathHtml(trimmed));
    }
    return preserve(zoteroInlineMathHtml(trimmed));
  });

  return { processed, preserved };
}

export function restorePreservedNoteMarkup(
  html: string,
  preserved: string[],
): string {
  return html.replace(
    new RegExp(`${PRESERVE_TOKEN_PREFIX}(\\d+)${PRESERVE_TOKEN_SUFFIX}`, "g"),
    (_, index) => preserved[parseInt(index, 10)] ?? "",
  );
}

export function unwrapBlockMathParagraphs(html: string): string {
  return html.replace(
    /<p>(\s*(?:<br\s*\/?>\s*)*)(<pre class="math">[\s\S]*?<\/pre>)(\s*(?:<br\s*\/?>\s*)*)<\/p>/gi,
    "$2",
  );
}
