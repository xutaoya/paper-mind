import { assert } from "chai";
import { createChatContainer } from "../src/modules/ui/chat-panel/ChatPanelBuilder.ts";
import {
  darkTheme,
  lightTheme,
} from "../src/modules/ui/chat-panel/ChatPanelTheme.ts";
import {
  createModelSelectionHelp,
  applyModelSelectionHelpTheme,
} from "../src/modules/ui/chat-panel/ModelSelectionHelp.ts";
import { setupFloatingWindowPin } from "../src/modules/ui/chat-panel/FloatingWindowPin.ts";
import { updateContextItemBannerForItem } from "../src/modules/ui/chat-panel/ContextItemBanner.ts";
import type { ChatSession } from "../src/types/chat";

class FakeElement {
  readonly style = {
    setProperty(name: string, value: string) {
      Object.assign(this, { [name]: value });
    },
  };
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<(event: any) => void>>();
  parentElement: FakeElement | null = null;
  textContent = "";

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  emit(type: string, details: Record<string, unknown> = {}): void {
    this.listeners.get(type)?.forEach((listener) =>
      listener({
        stopPropagation: () => undefined,
        preventDefault: () => undefined,
        ...details,
      }),
    );
  }

  matches(selector: string): boolean {
    return selector === ":focus-visible";
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const simpleSelectors = selector.split(",").map((part) => part.trim());
    const matches = (element: FakeElement): boolean =>
      simpleSelectors.some((part) => {
        if (part.startsWith("#") && !part.includes(" ")) {
          return element.getAttribute("id") === part.slice(1);
        }
        if (part.startsWith(".") && !part.includes(" ")) {
          return (element.getAttribute("class") || "")
            .split(/\s+/)
            .includes(part.slice(1));
        }
        return !part.includes(" ") && element.tagName === part.toLowerCase();
      });
    const result: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      for (const child of element.children) {
        if (matches(child)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement(this, "html");

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

describe("chat panel toolbar", function () {
  const runtime = globalThis as Record<string, any>;
  let previousAddon: unknown;
  let previousZotero: unknown;

  beforeEach(function () {
    previousAddon = runtime.addon;
    previousZotero = runtime.Zotero;
    runtime.addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (requests: Array<{ id: string }>) =>
              requests.map(({ id }) => ({ value: id, attributes: null })),
          },
        },
      },
    };
    runtime.Zotero = {
      Prefs: { get: () => false },
      getMainWindow: () => ({
        matchMedia: () => ({ matches: true }),
      }),
    };
  });

  afterEach(function () {
    runtime.addon = previousAddon;
    runtime.Zotero = previousZotero;
  });

  it("does not expose the PPT generation action", function () {
    const doc = new FakeDocument();
    const container = createChatContainer(
      doc as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    const presentation = container.querySelector("#chat-generate-presentation");

    assert.isNull(presentation);
  });

  it("shows the entire-library context without loading a selected paper PDF", async function () {
    const container = createChatContainer(
      new FakeDocument() as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    await updateContextItemBannerForItem(
      container as unknown as HTMLElement,
      null,
      {
        getActiveSession: () => ({ lastActiveItemKey: null }) as ChatSession,
        hasPdfAttachment: async () => {
          throw new Error("A library context must not load a PDF");
        },
      },
    );
    const banner = container.querySelector("#chat-context-item-banner")!;
    assert.equal(banner.style.display, "flex");
    assert.equal(banner.dataset.contextKind, "library");
    assert.equal(banner.getAttribute("role"), "note");
    assert.include(
      container.querySelector("#chat-context-item-title")!.textContent,
      "chat-context-library-label",
    );
    assert.include(
      (container.querySelector("#chat-message-input") as any).placeholder,
      "chat-library-input-placeholder",
    );
  });

  it("ignores a stale PDF lookup after switching to the library context", async function () {
    const container = createChatContainer(
      new FakeDocument() as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    let finish!: (hasPdf: boolean) => void;
    const manager = {
      getActiveSession: () => ({ lastActiveItemKey: null }) as ChatSession,
      hasPdfAttachment: () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    };
    const pending = updateContextItemBannerForItem(
      container as unknown as HTMLElement,
      { id: 12 } as Zotero.Item,
      manager,
    );
    await updateContextItemBannerForItem(
      container as unknown as HTMLElement,
      null,
      manager,
    );
    finish(true);
    await pending;
    assert.equal(
      container.querySelector("#chat-context-item-banner")!.dataset.contextKind,
      "library",
    );
  });

  it("places the sidebar/floating toggle at the far left of the toolbar", function () {
    const doc = new FakeDocument();
    const container = createChatContainer(
      doc as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    const primary = container.querySelector("#chat-toolbar-primary-actions");
    const panelMode = container.querySelector("#chat-panel-mode-btn");

    assert.isNotNull(primary);
    assert.strictEqual(panelMode?.parentElement, primary);
    assert.equal(
      primary?.children[0]?.getAttribute("id"),
      "chat-panel-mode-btn",
    );
  });

  it("does not reserve a separate model-help button or tooltip in the composer", function () {
    const doc = new FakeDocument();
    const container = createChatContainer(
      doc as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    assert.isNull(container.querySelector("#chat-model-selector-help"));
    assert.isNull(container.querySelector("#chat-model-selector-tooltip"));
  });

  it("hides the pin in the sidebar and toggles the native level in a floating window", function () {
    const doc = new FakeDocument();
    const container = createChatContainer(
      doc as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    const button = container.querySelector("#chat-window-pin-btn")!;
    assert.equal(button.style.display, "none");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.isNotNull(button.querySelector("svg"));
    const appWindow = { zLevel: 5, raisedZ: 6, normalZ: 5 };
    const previousComponents = runtime.Components;
    runtime.Components = { interfaces: { nsIAppWindow: {} } };
    try {
      setupFloatingWindowPin(
        container as unknown as HTMLElement,
        {
          closed: false,
          docShell: {
            treeOwner: {
              QueryInterface: () => ({ getInterface: () => appWindow }),
            },
          },
        } as unknown as Window,
      );
      assert.equal(button.style.display, "flex");
      for (let i = 0; i < 3; i++) {
        button.emit("click");
        assert.equal(appWindow.zLevel, 6);
        assert.equal(button.getAttribute("aria-pressed"), "true");
        assert.equal(
          button.getAttribute("aria-label"),
          "paperchat-chat-unpin-window",
        );
        button.emit("click");
        assert.equal(appWindow.zLevel, 5);
        assert.equal(button.getAttribute("aria-pressed"), "false");
        assert.equal(
          button.getAttribute("aria-label"),
          "paperchat-chat-pin-window",
        );
      }
    } finally {
      runtime.Components = previousComponents;
    }
  });

  it("keeps model guidance collapsed on hover, pointer leave and keyboard focus", function () {
    const doc = new FakeDocument();
    const help = createModelSelectionHelp(
      doc as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    const toggle = help.querySelector("#chat-model-selection-help-toggle")!;
    const content = help.querySelector("#chat-model-selection-help-content")!;
    assert.equal(help.style.flex, "0 0 auto");
    assert.equal(help.style.maxHeight, "inherit");
    assert.equal(content.style.gridTemplateRows, "0fr");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    help.emit("mouseenter");
    assert.equal(content.style.gridTemplateRows, "0fr");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    help.emit("mouseleave");
    toggle.emit("focus");
    assert.equal(content.style.gridTemplateRows, "0fr");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  });

  it("toggles on click and Escape without forcing layout or scrolling", function () {
    const doc = new FakeDocument();
    const help = createModelSelectionHelp(
      doc as unknown as Document,
      lightTheme,
    ) as unknown as FakeElement;
    const toggle = help.querySelector("#chat-model-selection-help-toggle")!;
    const content = help.querySelector("#chat-model-selection-help-content")!;
    const menu = new FakeElement(doc, "div");
    menu.appendChild(help);
    menu.getBoundingClientRect = () => {
      throw new Error("Unexpected layout read");
    };
    content.getBoundingClientRect = () => {
      throw new Error("Unexpected layout read");
    };
    toggle.emit("click");
    help.emit("mouseleave");
    assert.equal(content.style.gridTemplateRows, "1fr");
    assert.equal(content.getAttribute("aria-hidden"), "false");
    assert.isNull(content.getAttribute("inert"));
    toggle.emit("click");
    assert.equal(content.style.gridTemplateRows, "0fr");
    toggle.emit("focus");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    toggle.emit("click");
    toggle.emit("keydown", { key: "Escape" });
    assert.equal(content.style.gridTemplateRows, "0fr");
    assert.equal(content.getAttribute("aria-hidden"), "true");
    assert.equal(content.getAttribute("inert"), "");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  });

  it("updates guidance colors when the menu switches to dark mode", function () {
    const doc = new FakeDocument();
    const help = createModelSelectionHelp(
      doc as unknown as Document,
      lightTheme,
    );
    applyModelSelectionHelpTheme(help, darkTheme);
    assert.equal(
      (help.style as any)["--model-help-text"],
      darkTheme.textSecondary,
    );
    assert.equal(
      (help.style as any)["--model-help-active"],
      darkTheme.textPrimary,
    );
  });
});
