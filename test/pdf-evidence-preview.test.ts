import { assert } from "chai";
import {
  loadPdfEvidencePreview,
  PdfEvidencePreviewError,
} from "../src/modules/ui/chat-panel/PdfEvidencePreview.ts";
import { runInNewContext } from "node:vm";
import { createPdfPassageEvidenceRecord } from "../src/modules/chat/evidence/index.ts";

describe("PDF evidence page preview", function () {
  let originalZotero: unknown;
  let originalComponents: unknown;
  let record: NonNullable<ReturnType<typeof createPdfPassageEvidenceRecord>>;
  const item = {
    id: 42,
    isAttachment: () => true,
    isPDFAttachment: () => true,
  } as unknown as Zotero.Item;

  beforeEach(function () {
    originalZotero = (globalThis as any).Zotero;
    originalComponents = (globalThis as any).Components;
    record = createPdfPassageEvidenceRecord({
      itemKey: "PDFTEST1",
      page: 6,
      quote: "Source formula",
      toolCallId: "read",
      resultIndex: 1,
    })!;
  });

  afterEach(function () {
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).Components = originalComponents;
  });

  function fixture(pending = false, requireRealmOptions = false) {
    const RealmObject = runInNewContext("Object") as ObjectConstructor;
    const requested: number[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,cGFnZQ==",
    };
    let cancelled = false;
    let renderSize: { width: number; height: number } | undefined;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let lastViewport: { width: number; height: number };
    const page = {
      getViewport: (options: { scale: number }) => {
        if (requireRealmOptions)
          assert.strictEqual(
            Object.getPrototypeOf(options),
            RealmObject.prototype,
            "PDF.js must receive viewport options from its own realm",
          );
        const { scale } = options;
        lastViewport = { width: 800 * scale, height: 1200 * scale };
        return lastViewport;
      },
      render: (options: any) => {
        if (requireRealmOptions)
          assert.strictEqual(
            Object.getPrototypeOf(options),
            RealmObject.prototype,
            "PDF.js must receive render options from its own realm",
          );
        const { viewport } = options;
        assert.strictEqual(
          viewport,
          lastViewport,
          "preserve the native PDF viewport identity",
        );
        renderSize = viewport;
        began();
        return {
          promise: pending ? new Promise(() => {}) : Promise.resolve(),
          cancel: () => {
            cancelled = true;
          },
        };
      },
    };
    const win = {
      Object: RealmObject,
      document: { createElementNS: () => canvas },
      PDFViewerApplication: {
        pdfDocument: {
          numPages: 10,
          getPage: async (number: number) => {
            requested.push(number);
            return page;
          },
        },
      },
    };
    (globalThis as any).Zotero = {
      Reader: {
        _readers: [
          {
            itemID: 999,
            type: "pdf",
            _iframeWindow: {
              PDFViewerApplication: {
                pdfDocument: { getPage: () => assert.fail("Wrong attachment") },
              },
            },
          },
          {
            itemID: 42,
            type: "pdf",
            _internalReader: {
              _lastView: { _iframeWindow: { ...win, wrappedJSObject: win } },
            },
          },
        ],
      },
    };
    return {
      requested,
      canvas,
      started,
      cancelled: () => cancelled,
      size: () => renderSize,
      window: win,
    };
  }

  it("uses the recorded page of the matching PDF and releases its bounded canvas", async function () {
    const f = fixture();
    const src = await loadPdfEvidencePreview(
      record,
      item,
      new AbortController().signal,
    );
    assert.equal(src, "data:image/png;base64,cGFnZQ==");
    assert.deepEqual(f.requested, [6]);
    assert.isAtMost(f.size()!.width, 1400);
    assert.isAtMost(f.size()!.height, 2000);
    assert.equal(f.canvas.width, 0);
    assert.equal(f.canvas.height, 0);
  });

  it("cancels an in-flight PDF render when its popover is dismissed", async function () {
    const f = fixture(true);
    const controller = new AbortController();
    const request = loadPdfEvidencePreview(
      record,
      item,
      controller.signal,
    ).catch(() => null);
    await f.started;
    controller.abort();
    assert.isNull(await request);
    assert.isTrue(f.cancelled());
    assert.equal(f.canvas.width, 0);
  });

  it("passes viewport and render options in the PDF window's JavaScript realm", async function () {
    fixture(false, true);
    assert.equal(
      await loadPdfEvidencePreview(record, item),
      "data:image/png;base64,cGFnZQ==",
    );
  });

  it("unwraps Firefox Xray results after the page promise resolves", async function () {
    const f = fixture(false, true);
    const pdf = f.window.PDFViewerApplication.pdfDocument;
    const nativePage = await pdf.getPage(6);
    const nativeResults = new WeakMap<object, object>();
    const wrap = (value: object): any => {
      const wrapper = Object.create(null);
      nativeResults.set(wrapper, value);
      return wrapper;
    };
    class NativePage {
      getViewport(options: { scale: number }) {
        return wrap(nativePage.getViewport(options));
      }
      render(options: any) {
        return wrap(nativePage.render(options));
      }
    }
    const pageWrapper = wrap(new NativePage());
    assert.isUndefined(
      pageWrapper.getViewport,
      "Xray hides class prototype methods",
    );
    pdf.getPage = async () => pageWrapper;
    (globalThis as any).Components = {
      utils: {
        waiveXrays: (value: object) => nativeResults.get(value) || value,
      },
    };
    assert.equal(
      await loadPdfEvidencePreview(record, item),
      "data:image/png;base64,cGFnZQ==",
    );
    assert.equal(f.canvas.width, 0);
  });

  it("uses wrappedJSObject when the plugin scope has no Components global", async function () {
    const f = fixture();
    const pdf = f.window.PDFViewerApplication.pdfDocument;
    const page = await pdf.getPage(6);
    pdf.getPage = async () => ({ wrappedJSObject: page }) as any;
    (globalThis as any).Components = undefined;
    assert.equal(
      await loadPdfEvidencePreview(record, item),
      "data:image/png;base64,cGFnZQ==",
    );
  });

  it("waits for the PDF view before reading its iframe window", async function () {
    const f = fixture();
    const reader = (globalThis as any).Zotero.Reader._readers[1];
    const view: any = {};
    view.initializedPromise = Promise.resolve().then(() => {
      view._iframeWindow = f.window;
    });
    reader._internalReader = { _primaryView: view };
    assert.equal(
      await loadPdfEvidencePreview(record, item),
      "data:image/png;base64,cGFnZQ==",
    );
  });

  async function expectFailure(
    promise: Promise<unknown>,
    code: PdfEvidencePreviewError["code"],
  ): Promise<void> {
    let failure: unknown;
    try {
      await promise;
    } catch (error) {
      failure = error;
    }
    assert.instanceOf(failure, PdfEvidencePreviewError);
    assert.equal((failure as PdfEvidencePreviewError).code, code);
  }

  it("can render when no DOM abort signal is available", async function () {
    const f = fixture();
    assert.equal(
      await loadPdfEvidencePreview(record, item),
      "data:image/png;base64,cGFnZQ==",
    );
    assert.deepEqual(f.requested, [6]);
  });

  it("does not substitute another page when location data is missing or out of range", async function () {
    const f = fixture();
    for (const page of [undefined, 0, -1, 100])
      await expectFailure(
        loadPdfEvidencePreview(
          { ...record, page },
          item,
          new AbortController().signal,
        ),
        "page",
      );
    assert.isEmpty(f.requested);
  });

  it("does not open another reader when the matching PDF is unavailable", async function () {
    (globalThis as any).Zotero = {
      Reader: {
        _readers: [],
        open: () => assert.fail("Unexpected reader navigation"),
      },
    };
    await expectFailure(
      loadPdfEvidencePreview(record, item, new AbortController().signal),
      "reader",
    );
  });

  it("reports an unloaded PDF separately from a render failure", async function () {
    const f = fixture();
    (f.window as any).PDFViewerApplication = undefined;
    (
      globalThis as any
    ).Zotero.Reader._readers[1]._internalReader._lastView._iframeWindow.PDFViewerApplication =
      undefined;
    await expectFailure(loadPdfEvidencePreview(record, item), "initializing");
    fixture();
    const win = (globalThis as any).Zotero.Reader._readers[1]._internalReader
      ._lastView._iframeWindow.wrappedJSObject;
    win.PDFViewerApplication.pdfDocument.getPage = async () => {
      throw new Error("PDF page request failed");
    };
    await expectFailure(loadPdfEvidencePreview(record, item), "render");
  });
});
