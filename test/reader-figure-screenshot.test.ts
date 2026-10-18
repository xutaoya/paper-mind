import { assert } from "chai";
import {
  findPageElement,
  getReaderWindows,
  resolveReaderDocument,
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
});
