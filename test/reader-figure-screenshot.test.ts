import { assert } from "chai";
import {
  findPageElement,
  getReaderWindows,
  resolveReaderDocument,
  startReaderFigureScreenshot,
} from "../src/modules/ui/ReaderFigureScreenshot.ts";

function createReaderWindow(
  pages: Array<{ pageNumber: string; withCanvas?: boolean }>,
): Window {
  const document = {
    querySelector(selector: string) {
      if (selector.includes("data-page-number")) {
        return pages.length > 0 ? { tagName: "DIV" } : null;
      }
      if (
        selector.includes(".page") ||
        selector.includes("canvas") ||
        selector.includes("canvasWrapper")
      ) {
        return pages.some((page) => page.withCanvas)
          ? { tagName: "CANVAS" }
          : null;
      }
      return null;
    },
    body: {},
  };
  return { document } as Window;
}

describe("reader figure screenshot", function () {
  it("prefers the reader window that contains PDF pages", function () {
    const outer = createReaderWindow([]);
    const inner = createReaderWindow([{ pageNumber: "1", withCanvas: true }]);
    const reader = {
      _iframeWindow: outer,
      _internalReader: {
        _lastView: { _iframeWindow: inner },
      },
    } as _ZoteroTypes.ReaderInstance;

    assert.deepEqual(getReaderWindows(reader), [inner, outer]);
    assert.equal(resolveReaderDocument(reader), inner.document);
  });

  it("finds page containers by data-page-number", function () {
    const page = {
      getAttribute(name: string) {
        return name === "data-page-number" ? "3" : null;
      },
      closest(selector: string) {
        return selector.includes("data-page-number") ||
          selector.includes(".page")
          ? page
          : null;
      },
    };

    assert.equal(findPageElement(page as unknown as Element), page);
  });

  class SelectionElement extends EventTarget {
    readonly style: Record<string, string> = {};
    readonly attributes = new Map<string, string>();
    readonly children: SelectionElement[] = [];
    parentElement: SelectionElement | null = null;
    tabIndex = -1;
    textContent = "";

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }

    appendChild(child: SelectionElement): SelectionElement {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    remove(): void {
      const siblings = this.parentElement?.children;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }

    focus(): void {}
  }

  function dispatchSelectionMouse(
    target: EventTarget,
    type: string,
    clientX: number,
    clientY: number,
  ): void {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, clientX, clientY });
    target.dispatchEvent(event);
  }

  describe("reader figure screenshot selection overlay", function () {
    let previousZotero: unknown;
    let doc: any;
    let sourceCanvas: any;
    let drawCalls: unknown[][];

    beforeEach(function () {
      previousZotero = (globalThis as any).Zotero;
      drawCalls = [];
      const win = Object.assign(new EventTarget(), {
        Zotero_Tabs: { selectedID: "reader-tab" },
      });
      sourceCanvas = {
        width: 800,
        height: 1200,
        getBoundingClientRect: () => ({
          left: 20,
          top: 40,
          right: 420,
          bottom: 640,
          width: 400,
          height: 600,
        }),
      };
      doc = Object.assign(new EventTarget(), {
        body: new SelectionElement(),
        head: new SelectionElement(),
        documentElement: new SelectionElement(),
        defaultView: win,
        getSelection: () => ({ removeAllRanges() {} }),
        createElement: (tag: string) => {
          if (tag !== "canvas") return new SelectionElement();
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              drawImage: (...args: unknown[]) => drawCalls.push(args),
            }),
            // Avoid opening the real chat panel while verifying canvas cropping.
            toDataURL: () => "data:image/png;base64,",
          };
        },
      });
      const page = {
        ownerDocument: doc,
        querySelector: () => sourceCanvas,
        closest: () => page,
      };
      doc.querySelector = () => page;
      doc.elementFromPoint = () => page;
      doc.body.style.userSelect = "text";
      doc.documentElement.style.userSelect = "auto";
      const reader = {
        type: "pdf",
        _iframeWindow: { document: doc },
        focus() {},
      };
      (globalThis as any).Zotero = {
        getMainWindow: () => win,
        Reader: { getByTabID: () => reader },
      };
    });

    afterEach(function () {
      const escape = Object.assign(new Event("keydown"), { key: "Escape" });
      doc.dispatchEvent(escape);
      (globalThis as any).Zotero = previousZotero;
    });

    it("clears the full-screen dimmer inside the selection and shades only outside", function () {
      assert.isTrue(startReaderFigureScreenshot());
      const [overlay, marquee] = doc.body.children as SelectionElement[];
      assert.equal(overlay.style.background, "rgba(0, 0, 0, 0.4)");
      dispatchSelectionMouse(overlay, "mousedown", 80, 100);
      dispatchSelectionMouse(overlay, "mousemove", 300, 240);

      assert.equal(overlay.style.background, "transparent");
      assert.equal(marquee.style.background, "transparent");
      assert.include(marquee.style.boxShadow, "rgba(0, 0, 0, 0.55)");
      assert.equal(marquee.style.width, "220px");
      assert.equal(marquee.style.height, "140px");
      assert.equal(marquee.style.pointerEvents, "none");
      assert.lengthOf(marquee.children, 4);
    });

    it("captures only the original PDF canvas, then removes the selection UI", function () {
      startReaderFigureScreenshot();
      const [overlay] = doc.body.children as SelectionElement[];
      dispatchSelectionMouse(overlay, "mousedown", 80, 100);
      dispatchSelectionMouse(overlay, "mousemove", 300, 240);
      dispatchSelectionMouse(overlay, "mouseup", 300, 240);

      assert.deepEqual(drawCalls, [
        [sourceCanvas, 120, 120, 440, 280, 0, 0, 440, 280],
      ]);
      assert.isEmpty(doc.body.children);
      assert.isEmpty(doc.head.children);
      assert.equal(doc.body.style.userSelect, "text");
      assert.equal(doc.documentElement.style.userSelect, "auto");
    });

    it("restores the page and removes the dimmer when Escape is pressed", function () {
      startReaderFigureScreenshot();
      const [overlay] = doc.body.children as SelectionElement[];
      dispatchSelectionMouse(overlay, "mousedown", 300, 240);
      dispatchSelectionMouse(overlay, "mousemove", 80, 100);
      const escape = new Event("keydown");
      Object.assign(escape, { key: "Escape" });
      doc.dispatchEvent(escape);

      assert.isEmpty(drawCalls);
      assert.isEmpty(doc.body.children);
      assert.isEmpty(doc.head.children);
      assert.equal(doc.body.style.userSelect, "text");
      assert.equal(doc.documentElement.style.userSelect, "auto");
      dispatchSelectionMouse(overlay, "mousemove", 400, 400);
      assert.isEmpty(doc.body.children);
    });
  });
});
