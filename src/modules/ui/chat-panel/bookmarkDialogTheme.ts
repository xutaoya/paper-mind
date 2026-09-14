import { isDarkMode } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

export interface BookmarkSelectionColors {
  selectedBg: string;
  selectedBorder: string;
  accent: string;
  overlayBg: string;
  saveButtonBg: string;
  saveButtonColor: string;
}

export function getBookmarkDialogColors(theme: ThemeColors): BookmarkSelectionColors {
  const dark = isDarkMode();
  if (dark) {
    return {
      selectedBg: "rgba(59, 130, 246, 0.22)",
      selectedBorder: "#3b82f6",
      accent: "#60a5fa",
      overlayBg: "rgba(0, 0, 0, 0.62)",
      saveButtonBg: theme.sendButtonBg,
      saveButtonColor: theme.sendButtonText,
    };
  }
  return {
    selectedBg: "#eff6ff",
    selectedBorder: "#93c5fd",
    accent: "#2563eb",
    overlayBg: "rgba(15, 23, 42, 0.45)",
    saveButtonBg: "#2563eb",
    saveButtonColor: "#ffffff",
  };
}

export function getBookmarkFolderRowStyle(
  theme: ThemeColors,
  selected: boolean,
): { border: string; background: string; checkColor: string } {
  const colors = getBookmarkDialogColors(theme);
  if (!selected) {
    return {
      border: `1px solid ${theme.borderColor}`,
      background: theme.inputBg,
      checkColor: "transparent",
    };
  }
  return {
    border: `1px solid ${colors.selectedBorder}`,
    background: colors.selectedBg,
    checkColor: colors.accent,
  };
}
