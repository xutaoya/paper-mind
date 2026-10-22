export const DEFAULT_FLOATING_WINDOW_WIDTH = 420;
export const DEFAULT_FLOATING_WINDOW_HEIGHT = 600;
export const MIN_FLOATING_WINDOW_WIDTH = 320;
export const MIN_FLOATING_WINDOW_HEIGHT = 400;
export const MAX_FLOATING_WINDOW_WIDTH = 1200;
export const MAX_FLOATING_WINDOW_HEIGHT = 1000;

export interface FloatingWindowPosition {
  // Desktop pixels, so a saved position remains tied to the correct display.
  left: number;
  top: number;
}

export interface FloatingWindowScreen extends FloatingWindowPosition {
  width: number;
  height: number;
  cssToDesktopScale: number;
}

export function parseFloatingWindowPosition(
  saved: string | undefined,
): FloatingWindowPosition | undefined {
  if (!saved) return undefined;
  try {
    const position = JSON.parse(saved);
    if (
      position &&
      Number.isFinite(position.left) &&
      Number.isFinite(position.top)
    ) {
      return { left: position.left, top: position.top };
    }
  } catch {
    // Old installations have no position; malformed preferences use the default.
  }
  return undefined;
}

export function fitFloatingWindowToScreen(
  size: { width: number; height: number },
  position: FloatingWindowPosition,
  screen: FloatingWindowScreen,
): FloatingWindowPosition & { width: number; height: number } {
  const scale = screen.cssToDesktopScale;
  const width = Math.min(size.width, Math.floor(screen.width / scale));
  const height = Math.min(size.height, Math.floor(screen.height / scale));
  // Restore the whole window inside the work area (excluding the dock/taskbar).
  const left = Math.max(
    screen.left,
    Math.min(position.left, screen.left + screen.width - width * scale),
  );
  const top = Math.max(
    screen.top,
    Math.min(position.top, screen.top + screen.height - height * scale),
  );
  return {
    width,
    height,
    left: Math.round(left / scale),
    top: Math.round(top / scale),
  };
}

function clampDimension(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeFloatingWindowSize(
  width: number,
  height: number,
): { width: number; height: number } {
  return {
    width: clampDimension(
      width,
      MIN_FLOATING_WINDOW_WIDTH,
      MAX_FLOATING_WINDOW_WIDTH,
      DEFAULT_FLOATING_WINDOW_WIDTH,
    ),
    height: clampDimension(
      height,
      MIN_FLOATING_WINDOW_HEIGHT,
      MAX_FLOATING_WINDOW_HEIGHT,
      DEFAULT_FLOATING_WINDOW_HEIGHT,
    ),
  };
}

export function resolveFloatingWindowSize(
  savedWidth: number | undefined,
  savedHeight: number | undefined,
): { width: number; height: number } {
  return normalizeFloatingWindowSize(
    savedWidth ?? DEFAULT_FLOATING_WINDOW_WIDTH,
    savedHeight ?? DEFAULT_FLOATING_WINDOW_HEIGHT,
  );
}
