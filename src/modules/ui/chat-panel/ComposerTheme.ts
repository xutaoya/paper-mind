/**
 * Composer chrome theme — quick-action chips, input shell, toolbar icons.
 */

import { darkTheme, isDarkMode } from "./ChatPanelTheme";
import type { ThemeColors } from "./types";

function isDarkTheme(theme: ThemeColors): boolean {
  return theme === darkTheme || isDarkMode();
}

function composerIconFilter(isDark: boolean): string {
  return isDark ? "brightness(0) invert(0.88)" : "brightness(0) invert(0.42)";
}

export function applyQuickActionsTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const isDark = isDarkTheme(theme);
  const chipBackground = isDark ? theme.buttonBg : theme.inputBg;
  const chipShadow = isDark ? "none" : "0 1px 2px rgba(0,0,0,0.04)";
  const iconFilter = composerIconFilter(isDark);

  container.querySelectorAll(".chat-quick-action-chip").forEach((node) => {
    const chip = node as HTMLElement;
    chip.style.background = chipBackground;
    chip.style.borderColor = theme.borderColor;
    chip.style.color = theme.textPrimary;
    chip.style.boxShadow = chipShadow;

    chip.querySelectorAll("img").forEach((icon) => {
      (icon as HTMLElement).style.filter = iconFilter;
    });

    const deleteBtn = chip.querySelector(
      ".chat-quick-action-delete",
    ) as HTMLElement | null;
    if (deleteBtn) {
      deleteBtn.style.background = isDark ? theme.dropdownBg : theme.inputBg;
      deleteBtn.style.borderColor = theme.borderColor;
    }
  });

  container.querySelectorAll(".chat-quick-action-add").forEach((node) => {
    const button = node as HTMLElement;
    button.style.background = chipBackground;
    button.style.borderColor = theme.borderColor;
    button.style.color = theme.textMuted;
    button.querySelectorAll("img").forEach((icon) => {
      (icon as HTMLElement).style.filter = iconFilter;
    });
  });
}

export function applyModelSelectorTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const isDark = isDarkTheme(theme);
  const chipBackground = isDark ? theme.buttonBg : theme.inputBg;
  const chipShadow = isDark ? "none" : "0 1px 2px rgba(0,0,0,0.04)";

  const modelSelectorLabel = container.querySelector(
    "#chat-model-selector-label",
  ) as HTMLElement | null;
  if (modelSelectorLabel) {
    modelSelectorLabel.style.color = theme.textSecondary;
  }

  const modelSelectorHelp = container.querySelector(
    "#chat-model-selector-help",
  ) as HTMLElement | null;
  if (modelSelectorHelp) {
    modelSelectorHelp.style.borderColor = theme.inputBorderColor;
    modelSelectorHelp.style.color = theme.textSecondary;
    modelSelectorHelp.style.background = "transparent";
  }

  const modelSelectorTooltip = container.querySelector(
    "#chat-model-selector-tooltip",
  ) as HTMLElement | null;
  if (modelSelectorTooltip) {
    modelSelectorTooltip.style.background = theme.dropdownBg;
    modelSelectorTooltip.style.borderColor = theme.borderColor;
    modelSelectorTooltip.style.color = theme.textPrimary;
    modelSelectorTooltip.style.boxShadow = isDark
      ? "0 8px 22px rgba(0,0,0,0.45)"
      : "0 6px 18px rgba(0,0,0,0.22)";
  }

  const modelSelectorBtn = container.querySelector(
    "#chat-model-selector-btn",
  ) as HTMLButtonElement | null;
  if (modelSelectorBtn) {
    modelSelectorBtn.style.appearance = "none";
    modelSelectorBtn.style.setProperty("-moz-appearance", "none");
    modelSelectorBtn.style.background = chipBackground;
    modelSelectorBtn.style.border = `1px solid ${theme.borderColor}`;
    modelSelectorBtn.style.color = theme.textPrimary;
    modelSelectorBtn.style.boxShadow = chipShadow;
  }

  const modelSelectorText = container.querySelector(
    "#chat-model-selector-text",
  ) as HTMLElement | null;
  if (modelSelectorText) {
    modelSelectorText.style.color = theme.textPrimary;
  }

  const modelDropdown = container.querySelector(
    "#chat-model-dropdown",
  ) as HTMLElement | null;
  if (modelDropdown) {
    modelDropdown.style.background = theme.dropdownBg;
    modelDropdown.style.borderColor = theme.borderColor;
    modelDropdown.style.boxShadow = isDark
      ? "0 10px 28px rgba(0,0,0,0.45)"
      : "0 8px 24px rgba(0,0,0,0.16)";
  }

  container.querySelectorAll(".chat-model-dropdown-item").forEach((node) => {
    const item = node as HTMLElement;
    item.style.color = theme.textPrimary;
    item.style.background = "transparent";
  });
  container
    .querySelectorAll(".chat-model-dropdown-item.is-active")
    .forEach((node) => {
      const item = node as HTMLElement;
      item.style.background = isDark ? theme.buttonHoverBg : theme.hoverBg;
      item.style.color = theme.textPrimary;
    });
}

export function applyComposerChromeTheme(
  container: HTMLElement,
  theme: ThemeColors,
): void {
  const isDark = isDarkTheme(theme);
  const iconFilter = composerIconFilter(isDark);

  const inputWrapper = container.querySelector(
    "#chat-input-wrapper",
  ) as HTMLElement | null;
  if (inputWrapper?.parentElement) {
    const inputArea = inputWrapper.parentElement as HTMLElement;
    inputArea.style.background = theme.inputAreaBg;
    inputArea.style.borderTopColor = theme.borderColor;
  }

  const editBanner = container.querySelector(
    "#chat-edit-message-banner",
  ) as HTMLElement | null;
  if (editBanner) {
    editBanner.style.color = theme.textSecondary;
  }

  const editCancel = container.querySelector(
    "#chat-edit-message-cancel",
  ) as HTMLElement | null;
  if (editCancel) {
    editCancel.style.color = theme.textMuted;
  }

  const composerIconIds = [
    "#chat-upload-file",
    "#chat-panel-mode-btn",
    "#chat-summarize-conversation-note",
    "#chat-clear-conversation",
    "#chat-debug-context-btn",
  ];
  for (const selector of composerIconIds) {
    const button = container.querySelector(selector) as HTMLElement | null;
    button?.querySelectorAll("img").forEach((icon) => {
      (icon as HTMLElement).style.filter = iconFilter;
    });
  }

  const sendIcon = container.querySelector(
    "#chat-send-icon",
  ) as HTMLElement | null;
  if (sendIcon) {
    sendIcon.style.filter = isDark ? "brightness(0)" : "brightness(0) invert(1)";
  }

  applyQuickActionsTheme(container, theme);
  applyModelSelectorTheme(container, theme);
}

export function resolveQuickActionChipTheme(theme: ThemeColors): {
  background: string;
  boxShadow: string;
  iconFilter: string;
} {
  const isDark = isDarkTheme(theme);
  return {
    background: isDark ? theme.buttonBg : theme.inputBg,
    boxShadow: isDark ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
    iconFilter: composerIconFilter(isDark),
  };
}
