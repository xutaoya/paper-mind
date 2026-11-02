import type { EvidenceRecord } from "../../../types/evidence";
import { findPdfAttachment } from "./PdfQuoteNavigator";
import { HTML_NS } from "./types";
import { isAbortRequested, raceWithAbort } from "../../../utils/abort";

interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    background: string;
  }): { promise: Promise<unknown>; cancel(): void };
}

type PdfWindow = Window & {
  Object?: ObjectConstructor;
  wrappedJSObject?: PdfWindow;
  PDFViewerApplication?: {
    pdfDocument?: { numPages: number; getPage(page: number): Promise<PdfPage> };
  };
};

export class PdfEvidencePreviewError extends Error {
  constructor(
    readonly code: "attachment" | "reader" | "initializing" | "page" | "render",
    cause?: unknown,
  ) {
    super(`PDF preview failed: ${code}`, { cause });
    this.name = "PdfEvidencePreviewError";
  }
}

/** Reapply the waiver to trusted reader objects returned across async boundaries. */
function pdfObject<T extends object>(value: T): T {
  if (typeof Components !== "undefined" && Components.utils?.waiveXrays) {
    return Components.utils.waiveXrays(value);
  }
  return (value as { wrappedJSObject?: T }).wrappedJSObject || value;
}

// PDF.js runs in a content compartment. Its methods cannot read arbitrary
// objects from the privileged plugin sandbox; retain native viewport/DOM refs.
function pdfOptions<T extends object>(win: PdfWindow, values: T): T {
  const ObjectCtor = (win.wrappedJSObject || win).Object;
  return Object.assign(ObjectCtor ? new ObjectCtor() : {}, values);
}

/** Render only the recorded page of the matching open PDF, without navigating. */
export async function loadPdfEvidencePreview(
  record: EvidenceRecord,
  sourceItem: Zotero.Item,
  signal?: AbortSignal,
): Promise<string | null> {
  if (
    !Number.isSafeInteger(record.page) ||
    (record.page || 0) < 1 ||
    isAbortRequested(signal)
  ) {
    if (isAbortRequested(signal)) return null;
    throw new PdfEvidencePreviewError("page");
  }
  const attachment = await raceWithAbort(
    () => findPdfAttachment(sourceItem),
    signal,
  );
  if (!attachment) throw new PdfEvidencePreviewError("attachment");
  const readers = Object.values(Zotero.Reader?._readers || {}).filter(
    (reader) => reader.itemID === attachment.id && reader.type === "pdf",
  );
  if (!readers.length) throw new PdfEvidencePreviewError("reader");
  let failure = new PdfEvidencePreviewError("initializing");
  for (const reader of readers) {
    if (reader._initPromise)
      await raceWithAbort(() => reader._initPromise, signal);
    type View = {
      _iframeWindow?: PdfWindow;
      initializedPromise?: Promise<unknown>;
    };
    const internal = reader._internalReader as
      | {
          _lastView?: View;
          _primaryView?: View;
          _secondaryView?: View;
        }
      | undefined;
    const views = new Set([
      internal?._primaryView,
      internal?._lastView,
      internal?._secondaryView,
      { _iframeWindow: reader._iframeWindow as PdfWindow | undefined },
    ]);
    for (const view of views) {
      if (!view) continue;
      try {
        if (view.initializedPromise)
          await raceWithAbort(() => view.initializedPromise!, signal);
        const win = view._iframeWindow;
        if (!win) continue;
        const pdf = (
          win.wrappedJSObject?.PDFViewerApplication || win.PDFViewerApplication
        )?.pdfDocument;
        if (!pdf) continue;
        if (record.page! > pdf.numPages) {
          failure = new PdfEvidencePreviewError("page");
          continue;
        }
        const page = pdfObject(
          await raceWithAbort(() => pdf.getPage(record.page!), signal),
        );
        const original = pdfObject(
          page.getViewport(pdfOptions(win, { scale: 1 })),
        );
        if (
          !(original.width > 0 && original.height > 0) ||
          !Number.isFinite(original.width + original.height)
        )
          throw new Error("Invalid PDF viewport");
        const viewport = pdfObject(
          page.getViewport(
            pdfOptions(win, {
              scale: Math.min(2, 1400 / original.width, 2000 / original.height),
            }),
          ),
        );
        const canvas = win.document.createElementNS(
          HTML_NS,
          "canvas",
        ) as HTMLCanvasElement;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          const context = canvas.getContext("2d");
          if (isAbortRequested(signal)) return null;
          if (!context) throw new Error("Canvas 2D context unavailable");
          const task = pdfObject(
            page.render(
              pdfOptions(win, {
                canvas,
                canvasContext: context,
                viewport,
                background: "#ffffff",
              }),
            ),
          );
          const rendered = Promise.resolve(task.promise);
          void rendered.catch(() => {});
          try {
            await raceWithAbort(() => rendered, signal);
            return isAbortRequested(signal)
              ? null
              : canvas.toDataURL("image/png");
          } finally {
            if (isAbortRequested(signal)) task.cancel();
          }
        } finally {
          canvas.width = canvas.height = 0;
        }
      } catch (error) {
        if (isAbortRequested(signal)) throw error;
        failure =
          error instanceof PdfEvidencePreviewError
            ? error
            : new PdfEvidencePreviewError("render", error);
      }
    }
  }
  throw failure;
}
