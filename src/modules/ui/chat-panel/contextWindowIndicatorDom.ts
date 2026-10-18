import { getContextRingTrackColor } from "./ContextWindowIndicator";
import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import type { ThemeColors } from "./types";

const RING_SIZE = 18;
const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function createContextWindowUsageIndicator(
  doc: Document,
  theme: ThemeColors,
): HTMLElement {
  const root = createElement(
    doc,
    "div",
    {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      flexShrink: "0",
    },
    { id: "chat-context-usage" },
  );

  const button = createElement(
    doc,
    "button",
    {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "32px",
      height: "32px",
      minWidth: "32px",
      minHeight: "32px",
      flex: "0 0 32px",
      boxSizing: "border-box",
      padding: "0",
      border: "none",
      borderRadius: "50%",
      background: "transparent",
      cursor: "help",
      flexShrink: "0",
      transition: "background 0.15s ease",
    },
    {
      id: "chat-context-usage-btn",
      type: "button",
      "aria-label": getString("chat-context-window-label"),
    },
  );

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(RING_SIZE));
  svg.setAttribute("height", String(RING_SIZE));
  svg.setAttribute("viewBox", `0 0 ${RING_SIZE} ${RING_SIZE}`);
  svg.setAttribute("aria-hidden", "true");

  const track = doc.createElementNS(svgNS, "circle");
  track.setAttribute("id", "chat-context-usage-ring-track");
  track.setAttribute("cx", String(RING_SIZE / 2));
  track.setAttribute("cy", String(RING_SIZE / 2));
  track.setAttribute("r", String(RING_RADIUS));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke-width", "2");
  track.setAttribute("stroke", getContextRingTrackColor(theme));
  track.setAttribute("stroke-opacity", "0.9");

  const progress = doc.createElementNS(svgNS, "circle");
  progress.setAttribute("id", "chat-context-usage-ring-progress");
  progress.setAttribute("cx", String(RING_SIZE / 2));
  progress.setAttribute("cy", String(RING_SIZE / 2));
  progress.setAttribute("r", String(RING_RADIUS));
  progress.setAttribute("fill", "none");
  progress.setAttribute("stroke-width", "2");
  progress.setAttribute("stroke-linecap", "round");
  progress.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
  progress.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
  progress.setAttribute(
    "transform",
    `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`,
  );
  progress.setAttribute("stroke", theme.textPrimary);
  progress.style.transition = "stroke-dashoffset 0.25s ease, stroke 0.15s ease";

  svg.appendChild(track);
  svg.appendChild(progress);
  button.appendChild(svg);

  const tooltip = createElement(
    doc,
    "div",
    {
      display: "none",
      position: "fixed",
      left: "0",
      top: "0",
      minWidth: "200px",
      maxWidth: "260px",
      padding: "10px 12px",
      border: `1px solid ${theme.borderColor}`,
      borderRadius: "12px",
      background: theme.dropdownBg,
      color: theme.textPrimary,
      boxShadow: "0 10px 28px rgba(15, 23, 42, 0.16)",
      fontSize: "12px",
      lineHeight: "18px",
      zIndex: "10012",
      pointerEvents: "none",
      flexDirection: "column",
      gap: "4px",
    },
    { id: "chat-context-usage-tooltip", role: "tooltip" },
  );

  const title = createElement(
    doc,
    "div",
    {
      fontSize: "12px",
      fontWeight: "600",
      lineHeight: "18px",
    },
    { id: "chat-context-usage-title" },
  );
  const percent = createElement(
    doc,
    "div",
    {
      fontSize: "12px",
      lineHeight: "18px",
    },
    { id: "chat-context-usage-percent" },
  );
  const tokens = createElement(
    doc,
    "div",
    {
      fontSize: "12px",
      lineHeight: "18px",
    },
    { id: "chat-context-usage-tokens" },
  );

  tooltip.appendChild(title);
  tooltip.appendChild(percent);
  tooltip.appendChild(tokens);

  root.appendChild(button);
  root.appendChild(tooltip);
  return root;
}
