import { assert } from "chai";
import { config } from "../package.json";
import { getPref, setPref } from "../src/utils/prefs";
import { getProviderManager } from "../src/modules/providers";
import {
  getChatManager,
  hidePanel,
  isPanelShown,
  showPanel,
  unregisterAll,
} from "../src/modules/ui/chat-panel/ChatPanelManager";

describe("panel memory lifecycle in Zotero", function () {
  this.timeout(15000);
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let originalOpen: (...args: any[]) => Window;
  let main: any;
  let opened: Window | null = null;
  let savedMode: ReturnType<typeof getPref<"panelMode">>;

  async function waitFor(check: () => boolean, phase: string) {
    for (let index = 0; index < 100; index++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.fail(
      `Panel ${phase} did not settle: opened=${!!opened}, closed=${opened?.closed}, shown=${isPanelShown()}, uri=${opened?.document.documentURI}, input=${!!opened?.document.querySelector("#chat-message-input")}, callback=${typeof (getChatManager() as any).onStreamingUpdate}`,
    );
  }

  before(function () {
    for (const name of ["addon", "ztoolkit"]) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () =>
          name === "addon"
            ? Zotero[config.addonInstance]
            : Zotero[config.addonInstance].data.ztoolkit,
      });
    }
    savedMode = getPref("panelMode");
    main = Zotero.getMainWindow();
    originalOpen = main.openDialog;
    main.openDialog = function (...args: any[]) {
      const win = originalOpen.apply(this, args);
      if (String(args[0]).endsWith("/chatWindow.xhtml")) opened = win;
      return win;
    };
  });

  after(async function () {
    await unregisterAll();
    main.openDialog = originalOpen;
    setPref("panelMode", savedMode || "sidebar");
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  });

  it("releases UI callbacks after native close and after repeated reopen/close", async function () {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        setPref("panelMode", "floating");
        showPanel();
        await waitFor(
          () =>
            !!opened?.document.querySelector("#chat-message-input") &&
            typeof (getChatManager() as any).onStreamingUpdate === "function",
          `open ${attempt}`,
        );
        assert.isTrue(isPanelShown());
        const manager = getChatManager() as any;
        assert.isFunction(
          (getProviderManager() as any).onProviderChangeCallback,
        );
        if (attempt % 2 === 0) opened!.close();
        else hidePanel();
        await waitFor(
          () => !isPanelShown() && !manager.onStreamingUpdate,
          `close ${attempt}`,
        );
        for (const callback of [
          "onStreamingUpdate",
          "onMessageUpdate",
          "onReasoningUpdate",
          "onMessageComplete",
          "onError",
          "onRuntimeEvent",
          "onSessionListUpdate",
        ]) {
          assert.isUndefined(manager[callback], `released ${callback}`);
        }
        assert.isUndefined(
          (getProviderManager() as any).onProviderChangeCallback,
        );
      }
    } catch (error) {
      const failure = new Error(String(error));
      Object.defineProperty(failure, "message", {
        value: String(error),
        enumerable: true,
      });
      throw failure;
    }
  });

  it("does not restore callbacks when initialization finishes after close", async function () {
    const manager = getChatManager() as any;
    const originalInit = manager.init;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    manager.init = async () => {
      await gate;
      await originalInit.call(manager);
    };
    try {
      setPref("panelMode", "floating");
      showPanel();
      await waitFor(
        () => typeof manager.onStreamingUpdate === "function",
        "delayed init",
      );
      opened!.close();
      await waitFor(() => !manager.onStreamingUpdate, "close during init");
      release();
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.isUndefined(manager.onMessageUpdate);
      assert.isUndefined(manager.onSessionListUpdate);
      assert.isUndefined(
        (getProviderManager() as any).onProviderChangeCallback,
      );
    } finally {
      release();
      manager.init = originalInit;
      hidePanel();
    }
  });
});
