/**
 * Global UI Color Constants
 *
 * Centralized color definitions for consistent styling across the plugin.
 * Use these instead of hardcoded color values.
 */

// ============================================
// Semantic Colors
// ============================================

export const colors = {
  // Primary accent colors
  primary: "#6b7280",
  primaryDark: "#4b5563",
  primaryLight: "#f3f4f6",
  primaryBorder: "#d1d5db",

  // Status colors
  success: "#2e7d32",
  successLight: "#4caf50",
  error: "#c62828",
  errorLight: "#ffebee",
  errorBorder: "#f44336",

  // Interactive colors
  link: "#0066cc",
  linkHover: "#0078d4",
  selection: "#0060df",
  selectionText: "#ffffff",

  // Neutral backgrounds
  bgLight: "#f5f5f5",
  bgLighter: "#f7f7f8",
  bgHover: "#e8e8e8",
  bgCode: "#f4f4f4",
  bgCodeDark: "#1e1e1e",

  // Borders
  border: "#e0e0e0",
  borderLight: "#eee",
  borderDark: "#ddd",

  // Text colors
  textPrimary: "#333333",
  textSecondary: "#555555",
  textMuted: "#666666",
  textLight: "#888888",
  textPlaceholder: "#999999",

  // Input/form colors
  inputBorder: "#ccc",
  inputBg: "#ffffff",

  // Badge colors
  badgeBg: "#e3f2fd",
  badgeText: "#1976d2",

  // Gradient for user messages
  userGradient: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
} as const;

// ============================================
// Preference Panel Specific
// ============================================

export const prefColors = {
  // Provider list
  providerItemHover: colors.bgHover,
  providerItemSelected: colors.selection,
  providerItemSelectedText: colors.selectionText,
  statusDot: colors.successLight,

  // Test results
  testSuccess: colors.success,
  testError: colors.error,

  // User status
  userLoggedIn: colors.success,
  userLoggedOut: colors.textMuted,

  // Custom badge
  customBadgeBg: colors.badgeBg,
  customBadgeText: colors.badgeText,
} as const;

// ============================================
// Auth Dialog Specific
// ============================================

export const authColors = {
  // Tabs
  tabActive: colors.linkHover,
  tabInactive: "transparent",

  // Buttons
  buttonPrimary: colors.linkHover,
  buttonPrimaryText: "#ffffff",
  buttonSecondary: colors.bgLight,
  buttonSecondaryText: colors.textPrimary,
  buttonSecondaryBorder: colors.inputBorder,

  // Links
  link: colors.linkHover,

  // Form
  inputBorder: colors.inputBorder,

  // Messages
  successBg: "#efe",
  successText: "#060",
  successBorder: "#cfc",
  errorBg: "#fee",
  errorText: "#c00",
  errorBorder: "#fcc",
} as const;

// ============================================
// Chat Panel Additional Colors
// ============================================

export interface FeedbackBubbleColors {
  background: string;
  border: string;
  color: string;
}

const feedbackBubbleColors = {
  light: {
    error: {
      background: "#fff3f3",
      border: "#ffcdd2",
      color: "#d32f2f",
    },
    success: {
      background: authColors.successBg,
      border: authColors.successBorder,
      color: authColors.successText,
    },
  },
  dark: {
    error: {
      background: "rgba(248, 113, 113, 0.14)",
      border: "rgba(248, 113, 113, 0.28)",
      color: "#fca5a5",
    },
    success: {
      background: "rgba(74, 222, 128, 0.14)",
      border: "rgba(74, 222, 128, 0.28)",
      color: "#86efac",
    },
  },
} as const;

export function resolveFeedbackBubbleColors(
  kind: "error" | "success",
  isDark: boolean,
): FeedbackBubbleColors {
  const palette = isDark
    ? feedbackBubbleColors.dark
    : feedbackBubbleColors.light;
  return palette[kind];
}

export const chatColors = {
  // User message gradient
  userBubble: colors.userGradient,
  userBubbleText: "#ffffff",

  // Error message (light defaults; prefer resolveFeedbackBubbleColors)
  errorBubbleBg: colors.errorLight,
  errorBubbleBorder: colors.errorBorder,
  errorBubbleText: colors.error,

  // Success message (light defaults; prefer resolveFeedbackBubbleColors)
  successBubbleBg: authColors.successBg,
  successBubbleBorder: authColors.successBorder,
  successBubbleText: authColors.successText,

  // History dropdown
  historyAccent: colors.primary,
  loadMoreBg: colors.primaryLight,
  emptyText: colors.textPlaceholder,

  // Attachment tags
  attachmentBg: colors.inputBg,
  attachmentBorder: colors.primaryBorder,
  attachmentText: colors.textSecondary,

  // Markdown elements
  markdownLink: colors.link,
  codeBlockBg: colors.bgCode,
  codeInlineBg: "#f0f0f0",
  tableBg: colors.bgLight,
  tableBorder: colors.borderDark,
  blockquoteBorder: colors.inputBorder,
  blockquoteText: colors.textMuted,
  hrBorder: colors.borderDark,
} as const;

// Type exports for TypeScript support
export type Colors = typeof colors;
export type PrefColors = typeof prefColors;
export type AuthColors = typeof authColors;
export type ChatColors = typeof chatColors;
