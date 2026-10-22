import { getPref, setPref } from "../../../utils/prefs";
import {
  fitFloatingWindowToScreen,
  normalizeFloatingWindowSize,
  parseFloatingWindowPosition,
  resolveFloatingWindowSize,
  type FloatingWindowScreen,
} from "./floatingWindowBounds";

type ChromeWindow = Window & {
  desktopToDeviceScale?: number;
  windowState?: number;
  STATE_NORMAL?: number;
};

function cssToDesktopScale(win: ChromeWindow): number {
  const scale = win.devicePixelRatio / (win.desktopToDeviceScale ?? NaN);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function getSavedFloatingWindowBounds(mainWindow: Window) {
  const size = resolveFloatingWindowSize(
    getPref("floatingWindowWidth"),
    getPref("floatingWindowHeight"),
  );
  const scale = cssToDesktopScale(mainWindow);
  const position = parseFloatingWindowPosition(
    getPref("floatingWindowPosition"),
  ) ?? {
    left:
      (mainWindow.screenX + (mainWindow.outerWidth - size.width) / 2) * scale,
    top:
      (mainWindow.screenY + (mainWindow.outerHeight - size.height) / 2) * scale,
  };
  let screen: FloatingWindowScreen;
  try {
    const manager = (Components.classes as any)[
      "@mozilla.org/gfx/screenmanager;1"
    ].getService(Components.interfaces.nsIScreenManager) as nsIScreenManager;
    const target = manager.screenForRect(
      Math.round(position.left),
      Math.round(position.top),
      1,
      1,
    );
    const left = { value: 0 },
      top = { value: 0 };
    const width = { value: 0 },
      height = { value: 0 };
    target.GetAvailRectDisplayPix(left, top, width, height);
    screen = {
      left: left.value,
      top: top.value,
      width: width.value,
      height: height.value,
      cssToDesktopScale:
        target.defaultCSSScaleFactor / target.contentsScaleFactor,
    };
    if (
      screen.width <= 0 ||
      screen.height <= 0 ||
      !Number.isFinite(screen.cssToDesktopScale) ||
      screen.cssToDesktopScale <= 0
    ) {
      throw new Error("Invalid screen work area");
    }
  } catch {
    // Keep the window accessible on the main display if screen enumeration fails.
    const available = mainWindow.screen;
    screen = {
      left: available.availLeft * scale,
      top: available.availTop * scale,
      width: available.availWidth * scale,
      height: available.availHeight * scale,
      cssToDesktopScale: scale,
    };
  }
  return fitFloatingWindowToScreen(size, position, screen);
}

export function getFloatingWindowOpenFeatures(mainWindow: Window): string {
  const { width, height, left, top } = getSavedFloatingWindowBounds(mainWindow);
  // Stored dimensions include native window chrome; width/height would instead
  // resize the inner content and add the title bar again on every reopening.
  return `chrome,dialog=no,resizable=yes,outerWidth=${width},outerHeight=${height},left=${left},top=${top}`;
}

export function persistFloatingWindowBounds(win: ChromeWindow): void {
  // Do not replace the user's normal placement with minimized/maximized bounds.
  if (
    win.fullScreen ||
    (win.windowState !== undefined &&
      win.windowState !== (win.STATE_NORMAL ?? 3)) ||
    ![win.outerWidth, win.outerHeight, win.screenX, win.screenY].every(
      Number.isFinite,
    ) ||
    win.outerWidth <= 0 ||
    win.outerHeight <= 0
  )
    return;
  const { width, height } = normalizeFloatingWindowSize(
    win.outerWidth,
    win.outerHeight,
  );
  const scale = cssToDesktopScale(win);
  setPref("floatingWindowWidth", width);
  setPref("floatingWindowHeight", height);
  setPref(
    "floatingWindowPosition",
    JSON.stringify({
      left: Math.round(win.screenX * scale),
      top: Math.round(win.screenY * scale),
    }),
  );
}

export function setupFloatingWindowBoundsPersistence(win: Window): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      persistFloatingWindowBounds(win);
    }, 300);
  };
  const saveBeforeClose = () => persistFloatingWindowBounds(win);
  win.addEventListener("resize", scheduleSave);
  win.addEventListener("blur", scheduleSave);
  // Native window geometry may already be unavailable during unload.
  win.addEventListener("beforeunload", saveBeforeClose);
  const stop = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    win.removeEventListener("resize", scheduleSave);
    win.removeEventListener("blur", scheduleSave);
    win.removeEventListener("beforeunload", saveBeforeClose);
    win.removeEventListener("unload", stop);
    // Moving alone need not trigger resize: always capture the final position.
    persistFloatingWindowBounds(win);
  };
  win.addEventListener("unload", stop);
  return stop;
}
