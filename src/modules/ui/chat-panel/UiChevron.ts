import { HTML_NS } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

export type UiChevronKind = "down" | "right";

export interface CreateUiChevronOptions {
  className?: string;
  kind?: UiChevronKind;
  size?: number;
  color?: string;
  opacity?: number;
}

export function createUiChevron(
  doc: Document,
  options: CreateUiChevronOptions = {},
): HTMLElement {
  const kind = options.kind ?? "down";
  const size = options.size ?? 16;
  const wrap = doc.createElementNS(HTML_NS, "span") as HTMLElement;
  wrap.className = ["paperchat-ui-chevron", options.className]
    .filter(Boolean)
    .join(" ");
  wrap.setAttribute("aria-hidden", "true");
  wrap.dataset.chevronKind = kind;
  Object.assign(wrap.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    flexShrink: "0",
    color: options.color ?? "currentColor",
    opacity: String(options.opacity ?? 0.58),
    transition:
      "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease",
    lineHeight: "0",
  });

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("focusable", "false");

  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    kind === "right"
      ? "M6.25 4.5 9.75 8 6.25 11.5"
      : "M4.5 6.25 8 9.75 11.5 6.25",
  );
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.65");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  wrap.appendChild(svg);
  return wrap;
}

/** `expanded` = section open (down chevron rotates 180°, right chevron 90°). */
export function setUiChevronExpanded(
  chevron: HTMLElement,
  expanded: boolean,
): void {
  const kind = chevron.dataset.chevronKind ?? "down";
  if (kind === "right") {
    chevron.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
    return;
  }
  chevron.style.transform = expanded ? "rotate(180deg)" : "rotate(0deg)";
}
