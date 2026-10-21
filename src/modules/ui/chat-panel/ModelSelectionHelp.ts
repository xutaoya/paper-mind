import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import { createUiChevron, setUiChevronExpanded } from "./UiChevron";
import type { ThemeColors } from "./types";

export function applyModelSelectionHelpTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const help =
    container.getAttribute("id") === "chat-model-selection-help"
      ? container
      : (container.querySelector(
          "#chat-model-selection-help",
        ) as HTMLElement | null);
  if (!help) return;
  help.style.setProperty("--model-help-muted", theme.textSecondary);
  help.style.setProperty("--model-help-text", theme.textSecondary);
  help.style.setProperty("--model-help-active", theme.textPrimary);
  help.style.setProperty("--model-help-background", theme.dropdownBg);
  help.style.setProperty("--model-help-border", theme.borderColor);
  help.style.setProperty("--model-help-focus", theme.textSecondary);
}

export function createModelSelectionHelp(
  doc: Document,
  theme: ThemeColors,
): HTMLElement {
  const help = createElement(
    doc,
    "div",
    {
      padding: "8px 12px",
      borderTop: "1px solid var(--model-help-border)",
      color: "var(--model-help-muted)",
      background: "var(--model-help-background)",
      flex: "0 0 auto",
      maxHeight: "inherit",
      boxSizing: "border-box",
      minHeight: "0",
      overflowY: "auto",
    },
    { id: "chat-model-selection-help" },
  );
  const toggle = createElement(
    doc,
    "button",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      width: "100%",
      minWidth: "0",
      maxHeight: "none",
      height: "auto",
      margin: "0",
      padding: "4px 8px",
      boxSizing: "border-box",
      border: "none",
      borderRadius: "4px",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      textAlign: "left",
      appearance: "none",
      outline: "none",
      fontFamily: "inherit",
      fontSize: "12px",
      lineHeight: "16px",
    },
    {
      id: "chat-model-selection-help-toggle",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": "chat-model-selection-help-content",
    },
  );
  const label = createElement(doc, "span");
  label.textContent = getString("chat-switch-model-help-label");
  const chevron = createUiChevron(doc, { kind: "right", size: 12 });
  toggle.appendChild(label);
  toggle.appendChild(chevron);
  const content = createElement(
    doc,
    "div",
    {
      display: "grid",
      gridTemplateRows: "0fr",
      opacity: "0",
      fontSize: "12px",
      lineHeight: "16px",
      color: "var(--model-help-text)",
      overflowWrap: "anywhere",
    },
    {
      id: "chat-model-selection-help-content",
      class: "chat-model-help-reveal",
      "aria-hidden": "true",
      inert: "",
    },
  );
  const clipped = createElement(doc, "div", {
    minHeight: "0",
    overflow: "hidden",
  });
  const text = createElement(doc, "div", { padding: "4px 8px 8px" });
  text.textContent = getString("chat-switch-model-help");
  clipped.appendChild(text);
  content.appendChild(clipped);
  let isExpanded = false;
  const setExpanded = (expanded: boolean) => {
    isExpanded = expanded;
    content.style.gridTemplateRows = expanded ? "1fr" : "0fr";
    content.style.opacity = expanded ? "1" : "0";
    content.setAttribute("aria-hidden", String(!expanded));
    if (expanded) content.removeAttribute("inert");
    else content.setAttribute("inert", "");
    toggle.setAttribute("aria-expanded", String(expanded));
    setUiChevronExpanded(chevron, expanded);
  };
  help.addEventListener("mouseenter", () => {
    toggle.style.color = "var(--model-help-active)";
  });
  help.addEventListener("mouseleave", () => {
    toggle.style.color = "inherit";
  });
  toggle.addEventListener("focus", () => {
    toggle.style.boxShadow = toggle.matches(":focus-visible")
      ? "0 0 0 2px var(--model-help-focus)"
      : "none";
  });
  toggle.addEventListener("blur", () => {
    toggle.style.boxShadow = "none";
  });
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setExpanded(!isExpanded);
  });
  toggle.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
  });
  help.appendChild(toggle);
  help.appendChild(content);
  applyModelSelectionHelpTheme(help, theme);
  return help;
}
