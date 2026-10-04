import { applyBookmarkToolbarControlsTheme } from "./BookmarkToolbarTheme";
import { darkTheme } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

export function overlayPanelIconFilter(theme: ThemeColors): string {
  return theme === darkTheme
    ? "brightness(0) invert(0.88)"
    : "brightness(0) invert(0.42)";
}

function applyPanelChrome(
  panel: HTMLElement,
  theme: ThemeColors,
  bodySelector: string,
): void {
  panel.style.background = theme.chatHistoryBg;
  const chrome = panel.firstElementChild as HTMLElement | null;
  if (chrome) {
    chrome.style.background = theme.toolbarBg;
    chrome.style.borderBottom = `1px solid ${theme.borderColor}`;
    chrome.querySelectorAll("div, span").forEach((node) => {
      const el = node as HTMLElement;
      const weight = el.style.fontWeight;
      if (weight === "650" || weight === "600") {
        el.style.color = theme.textPrimary;
      }
    });
    const close = (chrome.querySelector(
      "#chat-stats-close-btn, #chat-bookmark-close-btn",
    ) ||
      chrome.querySelector("button:last-of-type")) as HTMLButtonElement | null;
    if (close) {
      close.style.color = theme.textMuted;
      const icon = close.querySelector("img");
      if (icon) {
        (icon as HTMLElement).style.filter = overlayPanelIconFilter(theme);
        (icon as HTMLElement).style.opacity = "0.82";
      }
    }
  }
  const body = panel.querySelector(bodySelector) as HTMLElement | null;
  if (body) {
    body.style.color = theme.textPrimary;
  }
}

export function applyOverlayPanelsShellTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const isDark = theme === darkTheme;
  const statsPanel = container.querySelector(
    "#chat-reading-stats-panel",
  ) as HTMLElement | null;
  if (statsPanel) {
    statsPanel.dataset.theme = isDark ? "dark" : "light";
    applyPanelChrome(
      statsPanel,
      theme,
      "#chat-reading-stats-panel-body",
    );
  }
  const bookmarkPanel = container.querySelector(
    "#chat-bookmark-panel",
  ) as HTMLElement | null;
  if (bookmarkPanel) {
    bookmarkPanel.dataset.theme = isDark ? "dark" : "light";
    applyPanelChrome(bookmarkPanel, theme, "#chat-bookmark-panel-body");
    applyBookmarkToolbarControlsTheme(bookmarkPanel, theme);
    const meta = bookmarkPanel.querySelector(
      "#chat-bookmark-toolbar-meta",
    ) as HTMLElement | null;
    if (meta) {
      meta.style.color = theme.textMuted;
    }
  }
}
