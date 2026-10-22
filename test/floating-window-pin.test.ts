import { assert } from "chai";
import { setFloatingWindowPinned } from "../src/modules/ui/chat-panel/FloatingWindowPin.ts";

describe("floating window pin native adapters", function () {
  const runtime = globalThis as Record<string, any>;
  const globals = ["Components", "ChromeUtils", "Zotero"];
  let previous: unknown[];
  let calls: Array<{ name: string; args: unknown[] }>;
  let libraryClosed: number;
  let openedLibraries: string[];
  let level: number;
  let windowPosSuccess: boolean;
  let reportedLevel: number | undefined;
  let appWindow: Record<string, any>;
  let win: Window;

  beforeEach(function () {
    previous = globals.map((name) => runtime[name]);
    calls = [];
    libraryClosed = 0;
    openedLibraries = [];
    level = 0;
    windowPosSuccess = true;
    reportedLevel = undefined;
    appWindow = {
      QueryInterface: () => ({ nativeHandle: "0x123456789abcdef" }),
    };
    win = {
      closed: false,
      docShell: {
        treeOwner: {
          QueryInterface: () => ({ getInterface: () => appWindow }),
        },
      },
    } as unknown as Window;
    runtime.Components = { interfaces: {} };
    runtime.Zotero = { isMac: true, isWin: false };
    const ctypes = {
      default_abi: "default",
      winapi_abi: "winapi",
      void_t: "void",
      long: "long",
      int: "int",
      uint32_t: "uint32",
      char: { ptr: "char*" },
      UInt64: (value: string) => value,
      voidptr_t: (value: string) => value,
      intptr_t: (value: number) => value,
      cast: (value: unknown) => value,
      open: (name: string) => {
        openedLibraries.push(name);
        return {
          close: () => libraryClosed++,
          declare: (name: string, _abi: unknown, result: unknown) => {
            return (...args: unknown[]) => {
              calls.push({ name, args });
              if (name === "sel_registerName") return args[0];
              if (name === "objc_msgSend") {
                if (result === "void") level = Number(args[2]);
                else return { toString: () => String(reportedLevel ?? level) };
              }
              if (name === "SetWindowPos") return windowPosSuccess ? 1 : 0;
            };
          },
        };
      },
    };
    runtime.ChromeUtils = { importESModule: () => ({ ctypes }) };
  });

  afterEach(function () {
    globals.forEach((name, index) => (runtime[name] = previous[index]));
  });

  it("changes the Cocoa level in place and releases the library after each call", function () {
    setFloatingWindowPinned(win, true);
    assert.equal(level, 3);
    setFloatingWindowPinned(win, false);
    assert.equal(level, 0);
    assert.deepEqual(openedLibraries, ["libobjc.A.dylib", "libobjc.A.dylib"]);
    assert.equal(libraryClosed, 2);
    assert.equal(
      calls.find((call) => call.name === "objc_msgSend")?.args[0],
      "0x123456789abcdef",
    );
  });

  it("changes Windows topmost state without moving, resizing or activating", function () {
    runtime.Zotero = { isMac: false, isWin: true };
    setFloatingWindowPinned(win, true);
    setFloatingWindowPinned(win, false);
    assert.deepEqual(
      calls.map((call) => call.args.slice(1)),
      [
        [-1, 0, 0, 0, 0, 0x13],
        [-2, 0, 0, 0, 0, 0x13],
      ],
    );
    assert.equal(libraryClosed, 2);
  });

  it("reports a failed native call and still closes the library", function () {
    runtime.Zotero = { isMac: false, isWin: true };
    windowPosSuccess = false;
    assert.throws(
      () => setFloatingWindowPinned(win, true),
      "SetWindowPos failed",
    );
    assert.equal(libraryClosed, 1);
  });

  it("detects a Cocoa level mismatch instead of reporting a successful pin", function () {
    reportedLevel = 0;
    assert.throws(
      () => setFloatingWindowPinned(win, true),
      "level did not change",
    );
    assert.equal(libraryClosed, 1);
  });

  it("requests keep-above from the Linux window manager", function () {
    runtime.Zotero = { isMac: false, isWin: false };
    setFloatingWindowPinned(win, true);
    setFloatingWindowPinned(win, false);
    assert.deepEqual(
      calls.map((call) => [call.name, call.args[1]]),
      [
        ["gdk_window_set_keep_above", 1],
        ["gdk_window_set_keep_above", 0],
      ],
    );
    assert.equal(libraryClosed, 2);
  });

  it("uses the supported legacy z-level API without loading native libraries", function () {
    Object.assign(appWindow, { zLevel: 5, raisedZ: 6, normalZ: 5 });
    setFloatingWindowPinned(win, true);
    assert.equal(appWindow.zLevel, 6);
    setFloatingWindowPinned(win, false);
    assert.equal(appWindow.zLevel, 5);
    assert.isEmpty(openedLibraries);
  });

  it("does not call native code for a closed window or invalid native handle", function () {
    assert.throws(
      () => setFloatingWindowPinned({ closed: true } as Window, true),
      "closed",
    );
    for (const handle of ["", "0x0", "0x000", "not-a-pointer"]) {
      appWindow.QueryInterface = () => ({ nativeHandle: handle });
      assert.throws(
        () => setFloatingWindowPinned(win, true),
        "no native handle",
      );
    }
    assert.isEmpty(openedLibraries);
  });
});
