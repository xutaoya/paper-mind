import { darkTheme, isDarkMode } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

function toolbarIconFilter(theme: ThemeColors): string {
  return theme === darkTheme
    ? "brightness(0) invert(0.88)"
    : "brightness(0) invert(0.42)";
}

const BOOKMARK_SEARCH_INPUT_ID = "chat-bookmark-search-input";

export function bookmarkToolbarControlSurface(theme: ThemeColors): {
  background: string;
  border: string;
  boxShadow: string;
} {
  if (isDarkMode()) {
    return {
      background: "rgba(255, 255, 255, 0.06)",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      boxShadow: "none",
    };
  }
  return {
    background: theme.inputBg,
    border: `1px solid ${theme.inputBorderColor}`,
    boxShadow: theme.composerShadow,
  };
}

export function applyBookmarkToolbarControlsTheme(
  panel: HTMLElement,
  theme: ThemeColors,
): void {
  const surface = bookmarkToolbarControlSurface(theme);
  const search = panel.querySelector(
    `#${BOOKMARK_SEARCH_INPUT_ID}`,
  ) as HTMLInputElement | null;
  if (search) {
    search.style.background = surface.background;
    search.style.border = surface.border;
    search.style.color = theme.textPrimary;
    search.style.boxShadow = surface.boxShadow;
    search.style.colorScheme = isDarkMode() ? "dark" : "light";
    if (search.ownerDocument.activeElement !== search) {
      search.style.borderColor = isDarkMode()
        ? "rgba(255, 255, 255, 0.12)"
        : theme.inputBorderColor;
    }
  }
  panel.querySelectorAll(".paperchat-bookmark-toolbar-btn").forEach((node) => {
    const button = node as HTMLButtonElement;
    button.style.background = surface.background;
    button.style.border = surface.border;
    button.style.boxShadow = surface.boxShadow;
    button.style.color = theme.textMuted;
    button.querySelectorAll("img").forEach((icon) => {
      (icon as HTMLElement).style.filter = toolbarIconFilter(theme);
    });
  });
}
