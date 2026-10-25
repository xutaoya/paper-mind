import { getItemTitleSmart } from "../../../utils/common";
import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import type { ThemeColors } from "./types";
import type { ChatSession } from "../../../types/chat";
import { isLibraryWideSession } from "../../chat/session-scope";

const BANNER_ID = "chat-context-item-banner";
const BADGE_ID = "chat-context-item-badge";
const TITLE_ID = "chat-context-item-title";

const PDF_BADGE_BG_LIGHT = "rgba(225, 29, 72, 0.1)";
const PDF_BADGE_BG_DARK = "rgba(251, 113, 133, 0.16)";
const PDF_BADGE_TEXT_LIGHT = "#be123c";
const PDF_BADGE_TEXT_DARK = "#fda4af";

function getItemCreatorMeta(item: Zotero.Item): string | null {
  const creators = item.getCreators?.() || [];
  if (!creators.length) {
    return null;
  }
  const first = creators[0];
  const name = [first.lastName, first.firstName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!name) {
    return null;
  }
  const author = creators.length > 1 ? `${name} et al.` : name;
  const date = String(item.getField?.("date") || "");
  const year = date.match(/\d{4}/)?.[0];
  return year ? `${author} · ${year}` : author;
}

function resolveContextItem(item: Zotero.Item): Zotero.Item {
  if (item.isAttachment?.() && item.parentItemID && !item.isPDFAttachment?.()) {
    const parent = Zotero.Items.get(item.parentItemID);
    if (parent) {
      return parent;
    }
  }
  return item;
}

function buildCompactLine(
  title: string,
  creatorMeta: string | null,
  hasPdf: boolean,
): string {
  const parts = [title];
  if (creatorMeta) {
    parts.push(creatorMeta);
  } else if (!hasPdf) {
    parts.push(getString("chat-context-item-no-pdf"));
  }
  return parts.join(" · ");
}

function syncComposerInputPadding(
  container: HTMLElement,
  visible: boolean,
): void {
  const input = container.querySelector(
    "#chat-message-input",
  ) as HTMLTextAreaElement | null;
  if (!input) {
    return;
  }
  input.style.paddingTop = visible ? "8px" : "14px";
}

export function syncComposerHintOffset(container: HTMLElement): void {
  const wrapper = container.querySelector(
    "#chat-input-wrapper",
  ) as HTMLElement | null;
  const banner = container.querySelector(`#${BANNER_ID}`) as HTMLElement | null;
  if (!wrapper) {
    return;
  }

  const bannerVisible =
    !!banner && banner.style.display !== "none" && banner.offsetHeight > 0;
  const inputPaddingTop = bannerVisible ? 8 : 14;
  const top =
    bannerVisible && banner
      ? banner.offsetHeight + inputPaddingTop
      : inputPaddingTop;

  wrapper.style.setProperty("--chat-composer-hint-top", `${top}px`);
}

export function createContextItemBanner(
  doc: Document,
  theme: ThemeColors,
): HTMLElement {
  const banner = createElement(
    doc,
    "div",
    {
      display: "none",
      alignItems: "center",
      flexShrink: "0",
      gap: "8px",
      padding: "6px 14px 2px",
      background: "transparent",
      cursor: "pointer",
      boxSizing: "border-box",
      outline: "none",
    },
    {
      id: BANNER_ID,
      role: "button",
      tabindex: "0",
      "aria-live": "polite",
    },
  );

  const badge = createElement(
    doc,
    "span",
    {
      flexShrink: "0",
      padding: "1px 6px",
      borderRadius: "4px",
      fontSize: "9px",
      fontWeight: "700",
      lineHeight: "14px",
      letterSpacing: "0.06em",
      background: PDF_BADGE_BG_LIGHT,
      color: PDF_BADGE_TEXT_LIGHT,
    },
    { id: BADGE_ID },
  );
  badge.textContent = "PDF";

  const title = createElement(
    doc,
    "span",
    {
      minWidth: "0",
      flex: "1",
      fontSize: "12px",
      lineHeight: "16px",
      fontWeight: "500",
      color: theme.textMuted,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    { id: TITLE_ID },
  );

  banner.appendChild(badge);
  banner.appendChild(title);
  banner.dataset.dark = String(theme.containerBg === "#1e1e1e");

  banner.addEventListener("mouseenter", () => {
    title.style.color = theme.textSecondary;
  });
  banner.addEventListener("mouseleave", () => {
    title.style.color = theme.textMuted;
  });
  banner.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      banner.click();
    }
  });

  return banner;
}

export function applyContextItemBannerTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const banner = container.querySelector(`#${BANNER_ID}`) as HTMLElement | null;
  if (!banner) {
    return;
  }

  const title = container.querySelector(`#${TITLE_ID}`) as HTMLElement | null;
  if (title) {
    title.style.color = theme.textMuted;
  }

  const badge = container.querySelector(`#${BADGE_ID}`) as HTMLElement | null;
  if (badge) {
    const dark = theme.containerBg === "#1e1e1e";
    banner.dataset.dark = String(dark);
    const library = banner.dataset.contextKind === "library";
    badge.style.background = library
      ? "rgba(59, 130, 246, 0.12)"
      : dark
        ? PDF_BADGE_BG_DARK
        : PDF_BADGE_BG_LIGHT;
    badge.style.color = library
      ? dark
        ? "#93c5fd"
        : "#2563eb"
      : dark
        ? PDF_BADGE_TEXT_DARK
        : PDF_BADGE_TEXT_LIGHT;
  }
}

export async function updateContextItemBannerForItem(
  container: HTMLElement,
  item: Zotero.Item | null,
  chatManager: {
    hasPdfAttachment(item: Zotero.Item): Promise<boolean>;
    getActiveSession?(): ChatSession | null;
  },
): Promise<void> {
  const banner = container.querySelector(`#${BANNER_ID}`) as HTMLElement | null;
  const titleEl = container.querySelector(`#${TITLE_ID}`) as HTMLElement | null;
  const badgeEl = container.querySelector(`#${BADGE_ID}`) as HTMLElement | null;
  if (!banner || !titleEl || !badgeEl) {
    return;
  }
  banner.dataset.itemRequest = String(item?.id || "");
  const input = container.querySelector<HTMLTextAreaElement>(
    "#chat-message-input",
  );

  if (!item?.id) {
    const library = isLibraryWideSession(
      chatManager.getActiveSession?.() ?? null,
    );
    banner.dataset.contextKind = library ? "library" : "";
    banner.style.display = library ? "flex" : "none";
    banner.removeAttribute("data-item-id");
    banner.onclick = null;
    banner.style.cursor = "default";
    banner.setAttribute("role", "note");
    banner.removeAttribute("tabindex");
    if (library) {
      const label = getString("chat-context-library-label");
      titleEl.textContent = label;
      titleEl.title = getString("chat-context-library-tooltip");
      banner.setAttribute("aria-label", label);
      badgeEl.textContent = getString("chat-context-library-badge");
      badgeEl.style.opacity = "1";
      badgeEl.style.background = "rgba(59, 130, 246, 0.12)";
      badgeEl.style.color =
        banner.dataset.dark === "true" ? "#93c5fd" : "#2563eb";
    }
    if (input)
      input.placeholder = getString(
        library ? "chat-library-input-placeholder" : "chat-input-placeholder",
      );
    syncComposerInputPadding(container, library);
    syncComposerHintOffset(container);
    return;
  }

  const contextItem = resolveContextItem(item);
  const hasPdf = await chatManager.hasPdfAttachment(contextItem);
  if (banner.dataset.itemRequest !== String(item.id)) return;
  const title = getItemTitleSmart(contextItem);
  const creatorMeta = getItemCreatorMeta(contextItem);
  const line = buildCompactLine(title, creatorMeta, hasPdf);
  const tooltip = [title, creatorMeta].filter(Boolean).join("\n");

  titleEl.textContent = line;
  titleEl.title = tooltip;
  badgeEl.textContent = hasPdf ? "PDF" : "—";
  badgeEl.style.opacity = hasPdf ? "1" : "0.45";
  const dark = banner.dataset.dark === "true";
  badgeEl.style.background = dark ? PDF_BADGE_BG_DARK : PDF_BADGE_BG_LIGHT;
  badgeEl.style.color = dark ? PDF_BADGE_TEXT_DARK : PDF_BADGE_TEXT_LIGHT;
  banner.dataset.contextKind = "item";
  banner.style.cursor = "pointer";
  banner.setAttribute("role", "button");
  banner.setAttribute("tabindex", "0");
  if (input) input.placeholder = getString("chat-input-placeholder");

  banner.style.display = "flex";
  syncComposerInputPadding(container, true);
  syncComposerHintOffset(container);
  banner.setAttribute("data-item-id", String(contextItem.id));
  banner.setAttribute(
    "aria-label",
    getString("chat-context-item-open", { args: { title } }),
  );
  banner.onclick = () => {
    try {
      const ZoteroPane = ztoolkit.getGlobal("ZoteroPane");
      ZoteroPane?.selectItem?.(contextItem.id);
    } catch (error) {
      ztoolkit.log("[ContextItemBanner] Failed to open item:", error);
    }
  };
}
