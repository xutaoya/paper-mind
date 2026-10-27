import { getString } from "../../../utils/locale";
import { chatColors } from "../../../utils/colors";
import { isDarkMode } from "./ChatPanelTheme";
import { HTML_NS } from "./types";

const installedDocuments = new WeakSet<Document>();
const SOURCE_SELECTOR = "[data-math-preview-source]";
const PREVIEW_ID = "paperchat-math-formula-preview";
const referenceTargets = new WeakMap<HTMLElement, HTMLElement>();
const EQUATION_NUMBER = "(?:[A-Za-z]\\.)?\\d+(?:\\.\\d+)*[A-Za-z]?";
const EQUATION_REFERENCE_PREFIX = new RegExp(
  `(?:公式|方程(?:式)?|等式|表达式|算式|式子|\\beq(?:uation)?s?\\.?|(?:^|[\\s:：，,；;。！？!?（(]|如|由|见|从|按|用|的|下|上|即|根据|通过|结合|代入|参照|参考|利用|依据)式)\\s*(?:[（(]\\s*${EQUATION_NUMBER}\\s*[)）]\\s*(?:[,，、\\-–—~～]|\\b(?:and|or)\\b|和|及|与|至|到)\\s*)*$`,
  "i",
);

export function isEquationReferenceContext(prefix: string): boolean {
  // Matching a number is insufficient: require an explicit equation cue.
  return EQUATION_REFERENCE_PREFIX.test(prefix);
}

/** Only explicit labels count; f(12) must not be mistaken for equation 12. */
export function getMathEquationNumber(latex: string): string | null {
  const tag = latex.match(
    new RegExp(`\\\\tag\\*?\\s*\\{\\s*\\(?(${EQUATION_NUMBER})\\)?\\s*\\}`),
  );
  if (tag) return tag[1].toLowerCase();
  const trailing = latex.match(
    new RegExp(
      `\\\\(?:qquad|quad|hfill)\\s*(?:\\\\text\\s*\\{)?\\s*\\((${EQUATION_NUMBER})\\)\\s*\\}?\\s*$`,
    ),
  );
  return trailing?.[1].toLowerCase() ?? null;
}

/** Bind references only to numbered formulas in this rendered answer. */
export function bindMathEquationReferences(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (!doc.defaultView || typeof doc.createTreeWalker !== "function") return;
  const equations = new Map<string, HTMLElement>();
  const ambiguous = new Set<string>();
  root
    .querySelectorAll<HTMLElement>("[data-equation-number]")
    .forEach((node) => {
      const number = node.getAttribute("data-equation-number")!;
      if (equations.has(number)) ambiguous.add(number);
      else equations.set(number, node);
    });
  for (const number of ambiguous) equations.delete(number);
  if (equations.size === 0) return;

  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const texts: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (
      !node.parentElement?.closest(
        "h1, h2, h3, h4, h5, h6, math, pre, code, button, a, [data-math-preview-source], [data-equation-number]",
      )
    ) {
      texts.push(node as Text);
    }
  }
  for (const text of texts) {
    const pattern = new RegExp(`[（(]\\s*(${EQUATION_NUMBER})\\s*[)）]`, "g");
    if (!pattern.test(text.data)) continue;
    pattern.lastIndex = 0;
    // Markdown emphasis may split "Fig. 2" and "(2)" into separate text nodes.
    const block =
      text.parentElement?.closest("p, li, td, th, h1, h2, h3, h4, h5, h6") ||
      root;
    const range = doc.createRange();
    range.selectNodeContents(block);
    range.setEnd(text, 0);
    const precedingText = range.toString();
    let match: RegExpExecArray | null;
    let start = 0;
    const fragment = doc.createDocumentFragment();
    while ((match = pattern.exec(text.data))) {
      const target = equations.get(match[1].toLowerCase());
      if (
        !target ||
        !isEquationReferenceContext(
          precedingText + text.data.slice(0, match.index),
        )
      ) {
        continue;
      }
      fragment.appendChild(
        doc.createTextNode(text.data.slice(start, match.index)),
      );
      const reference = doc.createElementNS(HTML_NS, "span") as HTMLElement;
      reference.textContent = match[0];
      reference.setAttribute("data-equation-reference", match[1]);
      enableEquationReferencePreview(reference, target);
      fragment.appendChild(reference);
      start = pattern.lastIndex;
    }
    if (start > 0) {
      fragment.appendChild(doc.createTextNode(text.data.slice(start)));
      text.parentNode?.replaceChild(fragment, text);
    }
  }
}

function elementFromTarget(target: EventTarget | null): Element | null {
  const node = target as Node | null;
  return node?.nodeType === 1 ? (node as Element) : node?.parentElement || null;
}

/** Delegate once per document; clone MathML only while a preview is visible. */
export function enableEquationReferencePreview(
  element: HTMLElement,
  formula: HTMLElement,
): void {
  referenceTargets.set(element, formula);
  element.setAttribute("data-math-preview-source", "true");
  element.setAttribute("tabindex", "0");
  const mode = element.closest("[data-theme]")?.getAttribute("data-theme");
  const dark = mode ? mode === "dark" : isDarkMode();
  element.style.color = dark ? "#58a6ff" : chatColors.markdownLink;
  element.style.textDecoration = "none";
  element.style.cursor = "pointer";

  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view || installedDocuments.has(doc)) return;
  installedDocuments.add(doc);

  let source: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;

  const cancelHide = (): void => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  };

  const close = (): void => {
    clearTimeout(showTimer);
    showTimer = undefined;
    cancelHide();
    observer?.disconnect();
    observer = undefined;
    source?.removeAttribute("aria-describedby");
    source = null;
    preview?.remove();
    preview = null;
  };

  const show = (candidate: HTMLElement): void => {
    showTimer = undefined;
    if (source !== candidate || !candidate.isConnected) {
      close();
      return;
    }
    const formula = referenceTargets.get(candidate);
    const math = formula?.querySelector("math");
    if (!math || !formula?.isConnected) {
      close();
      return;
    }

    const mode = candidate.closest("[data-theme]")?.getAttribute("data-theme");
    const dark = mode ? mode === "dark" : isDarkMode();
    const margin = 12;
    const gap = 6;
    const viewportWidth = view.innerWidth || doc.documentElement.clientWidth;
    const viewportHeight = view.innerHeight || doc.documentElement.clientHeight;
    const card = doc.createElementNS(HTML_NS, "div") as HTMLElement;
    card.id = PREVIEW_ID;
    card.setAttribute("role", "tooltip");
    card.setAttribute("aria-label", getString("chat-math-preview"));
    Object.assign(card.style, {
      position: "fixed",
      zIndex: "2147483000",
      boxSizing: "border-box",
      width: "max-content",
      maxWidth: `${Math.max(1, Math.min(640, viewportWidth - margin * 2))}px`,
      maxHeight: `${Math.max(1, Math.min(360, viewportHeight - margin * 2))}px`,
      overflow: "auto",
      padding: "16px 20px",
      border: `1px solid ${dark ? "#444850" : "#dfe2e7"}`,
      borderRadius: "10px",
      background: dark ? "#25272b" : "#ffffff",
      color: dark ? "#eceef1" : "#20242b",
      boxShadow: dark
        ? "0 8px 28px rgba(0, 0, 0, 0.4)"
        : "0 8px 28px rgba(15, 23, 42, 0.14)",
      fontSize: "24px",
      lineHeight: "1.6",
      whiteSpace: "nowrap",
      overflowWrap: "normal",
      wordBreak: "normal",
      scrollbarWidth: "thin",
      scrollbarColor: `${dark ? "#646974" : "#b4bac4"} transparent`,
      visibility: "hidden",
    });
    const enlarged = math.cloneNode(true) as MathMLElement;
    enlarged.setAttribute("display", "block");
    Object.assign(enlarged.style, {
      margin: "0",
      fontSize: "1em",
      width: "max-content",
    });
    card.appendChild(enlarged);
    (doc.body || doc.documentElement).appendChild(card);
    preview = card;

    const anchor = candidate.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const left = Math.max(
      margin,
      Math.min(anchor.left, viewportWidth - rect.width - margin),
    );
    const below = anchor.bottom + gap;
    const above = anchor.top - rect.height - gap;
    const top =
      below + rect.height <= viewportHeight - margin
        ? below
        : Math.max(margin, above);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.style.visibility = "visible";
    candidate.setAttribute("aria-describedby", PREVIEW_ID);

    // Streaming rerenders and panel teardown must not leave an orphan overlay.
    observer = new view.MutationObserver(() => {
      if (!candidate.isConnected || !formula.isConnected) close();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  };

  const enter = (target: EventTarget | null, immediate = false): void => {
    const element = elementFromTarget(target);
    if (element && preview?.contains(element)) {
      cancelHide();
      return;
    }
    const candidate = element?.closest(SOURCE_SELECTOR) as HTMLElement | null;
    if (!candidate) return;
    if (source === candidate) {
      cancelHide();
      return;
    }
    close();
    source = candidate;
    if (immediate) show(candidate);
    else showTimer = setTimeout(() => show(candidate), 200);
  };

  const leave = (target: EventTarget | null): void => {
    if (!source) return;
    const element = elementFromTarget(target);
    if (
      (element && (source.contains(element) || preview?.contains(element))) ||
      doc.activeElement === source
    ) {
      return;
    }
    cancelHide();
    hideTimer = setTimeout(close, 150);
  };

  doc.addEventListener("pointerover", (event) => enter(event.target));
  doc.addEventListener("pointerout", (event) => leave(event.relatedTarget));
  doc.addEventListener("focusin", (event) => enter(event.target, true));
  doc.addEventListener("focusout", (event) => leave(event.relatedTarget));
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  doc.addEventListener(
    "scroll",
    (event) => {
      const target = elementFromTarget(event.target);
      if (target && preview?.contains(target)) return;
      close();
    },
    true,
  );
  doc.addEventListener("pointerdown", (event) => {
    const target = elementFromTarget(event.target);
    if (target && (source?.contains(target) || preview?.contains(target)))
      return;
    close();
  });
  view.addEventListener("resize", close);
  view.addEventListener("blur", close);
  view.addEventListener("pagehide", close);
}
