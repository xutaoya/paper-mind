import { assert } from "chai";
import { createChatContainer } from "../src/modules/ui/chat-panel/ChatPanelBuilder.ts";
import { lightTheme } from "../src/modules/ui/chat-panel/ChatPanelTheme.ts";

class FakeElement {
  readonly style = {
    setProperty(name: string, value: string) {
      Object.assign(this, { [name]: value });
    },
  };
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
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

  addEventListener(): void {}

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
});
