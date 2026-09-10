import { config } from "../../../../package.json";
import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import type { ThemeColors } from "./types";
import { HTML_NS } from "./types";

const BOOKMARK_DIALOG_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  minWidth: "72px",
  lineHeight: "1.2",
  boxSizing: "border-box",
  appearance: "none",
};

export function createBookmarkDialogButton(
  doc: Document,
  label: string,
  styles: Partial<CSSStyleDeclaration>,
  attributes: Record<string, string> = { type: "button" },
): HTMLButtonElement {
  const button = createElement(
    doc,
    "button",
    {
      ...BOOKMARK_DIALOG_BUTTON_STYLE,
      ...styles,
    },
    attributes,
  ) as HTMLButtonElement;
  button.textContent = label;
  return button;
}

export function createFolderIcon(
  doc: Document,
  size = "16px",
): HTMLImageElement {
  const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  icon.src = `chrome://${config.addonRef}/content/icons/folder.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: size,
    height: size,
    display: "block",
    flexShrink: "0",
  });
  return icon;
}

export function createBookmarkIconButton(
  doc: Document,
  theme: ThemeColors,
  iconName: string,
  title: string,
  onClick: () => void | Promise<void>,
  options: { danger?: boolean; size?: number } = {},
): HTMLButtonElement {
  const size = options.size ?? 28;
  const iconSize = Math.max(14, size - 12);
  const button = createElement(
    doc,
    "button",
    {
      width: `${size}px`,
      height: `${size}px`,
      minWidth: `${size}px`,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      background: "transparent",
      borderRadius: "6px",
      cursor: "pointer",
      padding: "0",
      appearance: "none",
      color: options.danger ? "#dc2626" : theme.textMuted,
      transition: "background 0.15s ease, color 0.15s ease, transform 0.15s ease",
    },
    { type: "button", title, "aria-label": title },
  ) as HTMLButtonElement;
  const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  icon.src = `chrome://${config.addonRef}/content/icons/${iconName}.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: `${iconSize}px`,
    height: `${iconSize}px`,
    display: "block",
    pointerEvents: "none",
    opacity: options.danger ? "0.92" : "0.88",
  });
  button.appendChild(icon);
  button.addEventListener("mouseenter", () => {
    button.style.background = options.danger ? "#fef2f2" : theme.buttonHoverBg;
    button.style.transform = "translateY(-1px)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "transparent";
    button.style.transform = "translateY(0)";
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    void Promise.resolve(onClick()).catch((error: unknown) => {
      ztoolkit.log("[BookmarkUi] Icon action failed:", error);
    });
  });
  return button;
}

export function createBookmarkRowCheckbox(doc: Document): HTMLInputElement {
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  Object.assign(checkbox.style, {
    width: "16px",
    height: "16px",
    margin: "0",
    flexShrink: "0",
    cursor: "pointer",
    accentColor: "#2563eb",
  });
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  return checkbox;
}

export function createBookmarkPrimaryButton(
  doc: Document,
  label: string,
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const button = createElement(
    doc,
    "button",
    {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      borderRadius: "999px",
      padding: "6px 12px",
      fontSize: "12px",
      fontWeight: "600",
      lineHeight: "1.2",
      cursor: "pointer",
      background: "#2563eb",
      color: "#ffffff",
      whiteSpace: "nowrap",
      flexShrink: "0",
    },
    { type: "button" },
  ) as HTMLButtonElement;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    void Promise.resolve(onClick()).catch((error: unknown) => {
      ztoolkit.log("[BookmarkUi] Primary action failed:", error);
    });
  });
  return button;
}

export function createBookmarkRowIcon(
  doc: Document,
  iconName: string,
  size = 18,
): HTMLImageElement {
  const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  icon.src = `chrome://${config.addonRef}/content/icons/${iconName}.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: `${size}px`,
    height: `${size}px`,
    display: "block",
    flexShrink: "0",
  });
  return icon;
}

export function createBookmarkDragHandle(
  doc: Document,
  theme: ThemeColors,
  title: string,
): HTMLElement {
  const handle = createElement(
    doc,
    "div",
    {
      width: "20px",
      height: "28px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: "0",
      cursor: "grab",
      borderRadius: "6px",
      opacity: "0.55",
      transition: "opacity 0.15s ease, background 0.15s ease",
    },
    {
      class: "paperchat-bookmark-drag-handle",
      title,
      "aria-label": title,
      draggable: "true",
    },
  );
  const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
  icon.src = `chrome://${config.addonRef}/content/icons/drag-handle.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: "14px",
    height: "14px",
    display: "block",
    pointerEvents: "none",
  });
  handle.appendChild(icon);
  handle.addEventListener("mouseenter", () => {
    handle.style.opacity = "1";
    handle.style.background = theme.buttonHoverBg;
  });
  handle.addEventListener("mouseleave", () => {
    handle.style.opacity = "0.55";
    handle.style.background = "transparent";
  });
  return handle;
}

export function createFolderLabel(
  doc: Document,
  name: string,
  options: { iconSize?: string; gap?: string } = {},
): HTMLElement {
  const row = createElement(doc, "span", {
    display: "inline-flex",
    alignItems: "center",
    gap: options.gap || "8px",
    minWidth: "0",
  });
  row.appendChild(createFolderIcon(doc, options.iconSize));
  const text = createElement(doc, "span", {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  text.textContent = name;
  row.appendChild(text);
  return row;
}

function mountOverlay(doc: Document): HTMLElement {
  const overlay = doc.createElementNS(HTML_NS, "div") as HTMLElement;
  overlay.className = "paperchat-bookmark-prompt-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "2147483647",
    padding: "24px",
  });
  doc.documentElement.appendChild(overlay);
  return overlay;
}

function createPromptShell(
  doc: Document,
  theme: ThemeColors,
  title: string,
): { overlay: HTMLElement; dialog: HTMLElement; body: HTMLElement; footer: HTMLElement } {
  const overlay = mountOverlay(doc);
  const dialog = doc.createElementNS(HTML_NS, "div") as HTMLElement;
  Object.assign(dialog.style, {
    width: "min(380px, 100%)",
    background: theme.dropdownBg,
    color: theme.textPrimary,
    borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
    border: `1px solid ${theme.borderColor}`,
    overflow: "hidden",
  });

  const header = createElement(doc, "div", {
    padding: "16px 18px 8px",
    fontSize: "16px",
    fontWeight: "600",
  });
  header.textContent = title;

  const body = createElement(doc, "div", {
    padding: "8px 18px 12px",
    display: "grid",
    gap: "10px",
  });

  const footer = createElement(doc, "div", {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "12px 18px 16px",
    borderTop: `1px solid ${theme.borderColor}`,
  });

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  return { overlay, dialog, body, footer };
}

function createFooterButton(
  doc: Document,
  theme: ThemeColors,
  label: string,
  primary = false,
  danger = false,
): HTMLButtonElement {
  return createBookmarkDialogButton(
    doc,
    label,
    {
      border: primary ? "none" : `1px solid ${theme.borderColor}`,
      background: primary ? (danger ? "#dc2626" : "#2563eb") : theme.buttonBg,
      color: primary ? "#fff" : theme.textPrimary,
      borderRadius: "10px",
      padding: primary ? "8px 16px" : "8px 14px",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: primary ? "600" : "500",
    },
    { type: "button" },
  );
}

export function openBookmarkTextPrompt(
  doc: Document,
  theme: ThemeColors,
  options: {
    title: string;
    label: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, body, footer } = createPromptShell(
      doc,
      theme,
      options.title,
    );

    const label = createElement(doc, "label", {
      fontSize: "13px",
      color: theme.textSecondary,
    });
    label.textContent = options.label;

    const input = doc.createElementNS(HTML_NS, "input") as HTMLInputElement;
    input.type = "text";
    input.value = options.defaultValue || "";
    Object.assign(input.style, {
      width: "100%",
      boxSizing: "border-box",
      border: `1px solid ${theme.inputBorderColor}`,
      borderRadius: "10px",
      padding: "10px 12px",
      fontSize: "14px",
      background: theme.inputBg,
      color: theme.textPrimary,
      outline: "none",
    });

    const finish = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    const cancelBtn = createFooterButton(
      doc,
      theme,
      options.cancelLabel || getString("chat-bookmark-cancel"),
    );
    const confirmBtn = createFooterButton(
      doc,
      theme,
      options.confirmLabel || getString("chat-bookmark-save"),
      true,
    );

    cancelBtn.addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => {
      const value = input.value.trim();
      finish(value || null);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finish(null);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmBtn.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });

    body.appendChild(label);
    body.appendChild(input);
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    input.focus();
    input.select();
  });
}

export function openBookmarkConfirm(
  doc: Document,
  theme: ThemeColors,
  options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    const { overlay, body, footer } = createPromptShell(
      doc,
      theme,
      options.title,
    );

    const message = createElement(doc, "div", {
      fontSize: "14px",
      lineHeight: "1.5",
      color: theme.textSecondary,
      whiteSpace: "pre-wrap",
    });
    message.textContent = options.message;

    const finish = (confirmed: boolean) => {
      overlay.remove();
      resolve(confirmed);
    };

    const cancelBtn = createFooterButton(
      doc,
      theme,
      options.cancelLabel || getString("chat-bookmark-cancel"),
    );
    const confirmBtn = createFooterButton(
      doc,
      theme,
      options.confirmLabel || getString("chat-bookmark-delete"),
      true,
      options.danger,
    );

    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finish(false);
      }
    });

    body.appendChild(message);
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
  });
}

export function showBookmarkError(
  doc: Document,
  theme: ThemeColors,
  message: string,
): void {
  const { overlay, body, footer } = createPromptShell(
    doc,
    theme,
    getString("chat-bookmark-save-failed"),
  );
  const text = createElement(doc, "div", {
    fontSize: "14px",
    lineHeight: "1.5",
    color: theme.textSecondary,
    whiteSpace: "pre-wrap",
  });
  text.textContent = message;
  const closeBtn = createFooterButton(
    doc,
    theme,
    getString("chat-bookmark-close"),
    true,
  );
  closeBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  body.appendChild(text);
  footer.appendChild(closeBtn);
}
