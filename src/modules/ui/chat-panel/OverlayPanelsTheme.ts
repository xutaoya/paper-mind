import { darkTheme } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

export function overlayPanelIconFilter(theme: ThemeColors): string {
  return theme === darkTheme
    ? "brightness(0) invert(0.88)"
    : "brightness(0) invert(0.42)";
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
  }
  const bookmarkPanel = container.querySelector(
    "#chat-bookmark-panel",
  ) as HTMLElement | null;
  if (bookmarkPanel) {
    bookmarkPanel.dataset.theme = isDark ? "dark" : "light";
  }
}
