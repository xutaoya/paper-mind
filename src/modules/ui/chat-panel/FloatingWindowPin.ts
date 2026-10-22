import { getString } from "../../../utils/locale";
import { showChatPanelToast } from "./ChatPanelToast";

/** Change the existing native window, without reloading the conversation. */
export function setFloatingWindowPinned(win: Window, pinned: boolean): void {
  if (win.closed) throw new Error("Floating window is closed");
  const Ci = Components.interfaces;
  const owner = (win as any).docShell.treeOwner;
  const appWindow = owner
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIAppWindow);
  // Zotero 7 / older Gecko still exposes the scriptable z-level API.
  if ("zLevel" in appWindow) {
    appWindow.zLevel = pinned ? appWindow.raisedZ : appWindow.normalZ;
    return;
  }

  // New Gecko only exposes alwaysontop at creation time. Use the native handle
  // rather than recreating the window and interrupting drafts / streaming.
  const handle = appWindow.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
  if (!/^0x[0-9a-f]+$/i.test(handle) || /^0x0+$/i.test(handle)) {
    throw new Error("Floating window has no native handle");
  }
  const { ctypes } = ChromeUtils.importESModule(
    "resource://gre/modules/ctypes.sys.mjs",
  );
  const nativeWindow = ctypes.voidptr_t(ctypes.UInt64(handle));
  const library = ctypes.open(
    Zotero.isMac
      ? "libobjc.A.dylib"
      : Zotero.isWin
        ? "user32.dll"
        : "libgdk-3.so.0",
  );
  try {
    if (Zotero.isMac) {
      const selector = library.declare(
        "sel_registerName",
        ctypes.default_abi,
        ctypes.voidptr_t,
        ctypes.char.ptr,
      );
      const setLevel = library.declare(
        "objc_msgSend",
        ctypes.default_abi,
        ctypes.void_t,
        ctypes.voidptr_t,
        ctypes.voidptr_t,
        ctypes.long,
      );
      const getLevel = library.declare(
        "objc_msgSend",
        ctypes.default_abi,
        ctypes.long,
        ctypes.voidptr_t,
        ctypes.voidptr_t,
      );
      // NSFloatingWindowLevel / NSNormalWindowLevel (not modal or screen-saver).
      const level = pinned ? 3 : 0;
      setLevel(nativeWindow, selector("setLevel:"), level);
      const actualLevel = Number(
        String(getLevel(nativeWindow, selector("level"))),
      );
      if (actualLevel !== level) {
        throw new Error(`Native window level did not change: ${actualLevel}`);
      }
    } else if (Zotero.isWin) {
      const setWindowPos = library.declare(
        "SetWindowPos",
        ctypes.winapi_abi,
        ctypes.int,
        ctypes.voidptr_t,
        ctypes.voidptr_t,
        ctypes.int,
        ctypes.int,
        ctypes.int,
        ctypes.int,
        ctypes.uint32_t,
      );
      const insertAfter = ctypes.cast(
        ctypes.intptr_t(pinned ? -1 : -2),
        ctypes.voidptr_t,
      );
      // HWND_TOPMOST / HWND_NOTOPMOST; do not move, resize or steal focus.
      if (!setWindowPos(nativeWindow, insertAfter, 0, 0, 0, 0, 0x13)) {
        throw new Error("SetWindowPos failed");
      }
    } else {
      const setKeepAbove = library.declare(
        "gdk_window_set_keep_above",
        ctypes.default_abi,
        ctypes.void_t,
        ctypes.voidptr_t,
        ctypes.int,
      );
      setKeepAbove(nativeWindow, pinned ? 1 : 0);
    }
  } finally {
    library.close();
  }
}

export function setupFloatingWindowPin(
  container: HTMLElement,
  win: Window,
): void {
  const button = container.querySelector<HTMLButtonElement>(
    "#chat-window-pin-btn",
  );
  if (!button) return;
  button.style.display = "flex";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pinned = button.getAttribute("aria-pressed") !== "true";
    try {
      setFloatingWindowPinned(win, pinned);
      button.setAttribute("aria-pressed", String(pinned));
      const label = getString(pinned ? "chat-unpin-window" : "chat-pin-window");
      button.title = label;
      button.setAttribute("aria-label", label);
    } catch (error) {
      ztoolkit.log("Failed to change floating window pin", error);
      showChatPanelToast(
        container,
        getString("chat-pin-window-failed"),
        "error",
      );
    }
  });
}
