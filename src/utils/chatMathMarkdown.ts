const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const HTML_NS = "http://www.w3.org/1999/xhtml";

export function normalizeMathContent(content: string): string {
  return content.replace(/\\_/g, "_");
}

export function containsInlineMathDelimiters(content: string): boolean {
  return /(^|[^\\])\$(?!\$)[^$\n]+?\$(?!\$)/m.test(content);
}

/**
 * Markdown treats 4+ spaces after a blockquote ordered-list marker as an
 * indented code block. Model-generated pseudo-nested steps often use deeper
 * indentation, which leaves inline math as literal $...$ inside <pre><code>.
 */
export function normalizeBlockquoteListIndentation(content: string): string {
  return content.replace(
    /(^|\n)([ \t]*>\s*\d+\.)\s{4,}/gm,
    (_, prefix, marker) => `${prefix}${marker}   `,
  );
}

export function deltaContainsMathMarkup(delta: string): boolean {
  return (
    delta.includes("$") || delta.includes("\\(") || delta.includes("\\[")
  );
}

export function repairIncompleteInlineMath(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      let mathOpen = false;
      let openIndex = -1;

      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "$") {
          continue;
        }

        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
          backslashes += 1;
        }
        if (backslashes % 2 === 1) {
          continue;
        }

        if (!mathOpen) {
          mathOpen = true;
          openIndex = index;
        } else {
          mathOpen = false;
          openIndex = -1;
        }
      }

      if (!mathOpen || openIndex < 0) {
        return line;
      }

      return `${line.slice(0, openIndex)}\\${line.slice(openIndex)}`;
    })
    .join("\n");
}

export function extractMathMLMarkup(katexHtml: string): string | null {
  const match = katexHtml.match(/<math\b[\s\S]*?<\/math>/i);
  return match?.[0] ?? null;
}

export function importMathMLIntoDocument(
  doc: Document,
  parent: HTMLElement,
  mathMarkup: string,
): boolean {
  const parser = new DOMParser();
  const mathDoc = parser.parseFromString(mathMarkup, "application/xml");
  if (mathDoc.querySelector("parsererror")) {
    return false;
  }

  const mathNode = mathDoc.documentElement;
  if (!mathNode || mathNode.localName !== "math") {
    return false;
  }

  const imported = doc.importNode(mathNode, true) as Element;
  if (!imported.namespaceURI) {
    imported.setAttribute("xmlns", MATH_NS);
  }
  parent.appendChild(imported);
  return true;
}

export function importKaTeXHtmlIntoDocument(
  doc: Document,
  parent: HTMLElement,
  htmlNamespace: string,
  katexHtml: string,
): boolean {
  const namespace = htmlNamespace || HTML_NS;
  const wrapped = `<div xmlns="${namespace}">${katexHtml}</div>`;

  try {
    const parsed = new DOMParser().parseFromString(
      wrapped,
      "application/xhtml+xml",
    );
    if (!parsed.querySelector("parsererror")) {
      const root = parsed.documentElement;
      while (root.firstChild) {
        parent.appendChild(doc.importNode(root.firstChild, true));
      }
      if (parent.lastChild) {
        return true;
      }
    }
  } catch {
    // Fall back to innerHTML below.
  }

  const container = doc.createElementNS(namespace, "span");
  container.innerHTML = katexHtml;
  if (!container.childNodes.length) {
    return false;
  }

  while (container.firstChild) {
    parent.appendChild(container.firstChild);
  }
  return true;
}
