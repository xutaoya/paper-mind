import { addImageAttachment, showPanel } from "./chat-panel";

type Selection = {
  startX: number;
  startY: number;
  page: HTMLElement;
};

type ReaderView = {
  _iframeWindow?: Window;
};

type ReaderInternal = {
  _lastView?: ReaderView;
  _primaryView?: ReaderView;
};

export function getReaderWindows(
  reader: _ZoteroTypes.ReaderInstance,
): Window[] {
  const internalReader = reader._internalReader as ReaderInternal | undefined;
  return Array.from(
    new Set(
      [
        internalReader?._lastView?._iframeWindow,
        internalReader?._primaryView?._iframeWindow,
        reader._iframeWindow as Window | undefined,
      ].filter((candidate): candidate is Window => Boolean(candidate)),
    ),
  );
}

export function resolveReaderDocument(
  reader: _ZoteroTypes.ReaderInstance,
): Document | null {
  const windows = getReaderWindows(reader);
  for (const readerWindow of windows) {
    const doc = readerWindow.document;
    if (doc?.querySelector("[data-page-number]")) {
      return doc;
    }
  }
  for (const readerWindow of windows) {
    const doc = readerWindow.document;
    if (doc?.querySelector(".page, .canvasWrapper canvas, canvas")) {
      return doc;
    }
  }
  return windows[0]?.document ?? null;
}

export function findPageElement(target: Element | null): HTMLElement | null {
  if (!target?.closest) return null;
  const page = target.closest("[data-page-number], .page");
  return page ? (page as HTMLElement) : null;
}

export function getPageCanvas(page: HTMLElement): HTMLCanvasElement | null {
  return page.querySelector(
    ".canvasWrapper canvas, canvas",
  ) as HTMLCanvasElement | null;
}

function getPageNumber(page: HTMLElement): string {
  return (
    page.getAttribute("data-page-number") || page.dataset.pageNumber || "1"
  );
}

function captureSelection(
  page: HTMLElement,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  const source = getPageCanvas(page);
  if (!source) return;
  const bounds = source.getBoundingClientRect();
  const left = Math.max(bounds.left, Math.min(startX, endX));
  const top = Math.max(bounds.top, Math.min(startY, endY));
  const right = Math.min(bounds.right, Math.max(startX, endX));
  const bottom = Math.min(bounds.bottom, Math.max(startY, endY));
  if (right - left < 8 || bottom - top < 8) return;

  const scaleX = source.width / bounds.width;
  const scaleY = source.height / bounds.height;
  const width = Math.round((right - left) * scaleX);
  const height = Math.round((bottom - top) * scaleY);
  const output = page.ownerDocument.createElement("canvas");
  output.width = width;
  output.height = height;
  try {
    output
      .getContext("2d")
      ?.drawImage(
        source,
        Math.round((left - bounds.left) * scaleX),
        Math.round((top - bounds.top) * scaleY),
        width,
        height,
        0,
        0,
        width,
        height,
      );
    const data = output.toDataURL("image/png").split(",")[1];
    if (!data) return;
    showPanel("reader_selection");
    addImageAttachment({
      type: "base64",
      data,
      mimeType: "image/png",
      name: `figure-screenshot-page-${getPageNumber(page)}.png`,
    });
  } catch (error) {
    ztoolkit.log(
      "[ReaderFigureScreenshot] Failed to capture selection:",
      error,
    );
  }
}

function startSelection(doc: Document): void {
  let selection: Selection | null = null;
  const previousBodyUserSelect = doc.body.style.userSelect;
  const previousDocumentUserSelect = doc.documentElement.style.userSelect;
  doc.body.style.userSelect = "none";
  doc.documentElement.style.userSelect = "none";

  const blockStyle = doc.createElement("style");
  blockStyle.setAttribute("data-paperchat-figure-screenshot", "true");
  blockStyle.textContent = `
    html, body, #viewerContainer, #viewer, .page {
      cursor: crosshair !important;
      user-select: none !important;
    }
    .textLayer, .textLayer span, .annotationLayer, .annotationEditorLayer {
      pointer-events: none !important;
      user-select: none !important;
      cursor: crosshair !important;
    }
  `;
  doc.head.appendChild(blockStyle);

  const overlay = doc.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.22)",
    cursor: "crosshair",
    pointerEvents: "auto",
    zIndex: "2147483646",
  });
  overlay.tabIndex = -1;
  const marquee = doc.createElement("div");
  Object.assign(marquee.style, {
    position: "fixed",
    display: "none",
    pointerEvents: "none",
    border: "1px solid #000",
    background: "rgba(255, 255, 255, 0.28)",
    boxSizing: "border-box",
    zIndex: "2147483647",
  });
  const prompt = doc.createElement("div");
  prompt.textContent = "拖拽选择图片区域，按 Esc 取消";
  Object.assign(prompt.style, {
    position: "fixed",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 18px",
    borderRadius: "8px",
    background: "rgba(0, 0, 0, 0.78)",
    color: "white",
    fontSize: "14px",
    fontWeight: "600",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  doc.body.appendChild(overlay);
  doc.body.appendChild(marquee);
  doc.body.appendChild(prompt);

  const resolveTargetUnderOverlay = (
    clientX: number,
    clientY: number,
  ): HTMLElement | null => {
    overlay.style.pointerEvents = "none";
    const target = doc.elementFromPoint(clientX, clientY) as HTMLElement | null;
    overlay.style.pointerEvents = "auto";
    return target;
  };

  const preventDefaultEvent = (event: Event) => {
    event.preventDefault();
  };

  const finish = (event: MouseEvent) => {
    if (!selection) return;
    event.preventDefault();
    event.stopPropagation();
    captureSelection(
      selection.page,
      selection.startX,
      selection.startY,
      event.clientX,
      event.clientY,
    );
    cleanup();
  };
  const move = (event: MouseEvent) => {
    if (!selection) return;
    event.preventDefault();
    event.stopPropagation();
    const left = Math.min(selection.startX, event.clientX);
    const top = Math.min(selection.startY, event.clientY);
    marquee.style.left = `${left}px`;
    marquee.style.top = `${top}px`;
    marquee.style.width = `${Math.abs(event.clientX - selection.startX)}px`;
    marquee.style.height = `${Math.abs(event.clientY - selection.startY)}px`;
    marquee.style.display = "block";
  };
  const begin = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = resolveTargetUnderOverlay(event.clientX, event.clientY);
    const page = findPageElement(target);
    if (!page || !getPageCanvas(page)) return;
    event.preventDefault();
    event.stopPropagation();
    doc.getSelection()?.removeAllRanges();
    selection = { startX: event.clientX, startY: event.clientY, page };
  };
  const cancel = (event: KeyboardEvent) => {
    if (event.key === "Escape") cleanup();
  };
  const cleanup = () => {
    overlay.removeEventListener("mousedown", begin, true);
    overlay.removeEventListener("mousemove", move, true);
    overlay.removeEventListener("mouseup", finish, true);
    doc.removeEventListener("selectstart", preventDefaultEvent, true);
    doc.removeEventListener("dragstart", preventDefaultEvent, true);
    doc.removeEventListener("keydown", cancel, true);
    doc.defaultView?.removeEventListener("keydown", cancel, true);
    Zotero.getMainWindow().removeEventListener("keydown", cancel, true);
    doc.body.style.userSelect = previousBodyUserSelect;
    doc.documentElement.style.userSelect = previousDocumentUserSelect;
    doc.getSelection()?.removeAllRanges();
    blockStyle.remove();
    overlay.remove();
    marquee.remove();
    prompt.remove();
  };
  overlay.addEventListener("mousedown", begin, true);
  overlay.addEventListener("mousemove", move, true);
  overlay.addEventListener("mouseup", finish, true);
  doc.addEventListener("selectstart", preventDefaultEvent, true);
  doc.addEventListener("dragstart", preventDefaultEvent, true);
  doc.addEventListener("keydown", cancel, true);
  doc.defaultView?.addEventListener("keydown", cancel, true);
  Zotero.getMainWindow().addEventListener("keydown", cancel, true);
  overlay.focus();
}

function getActivePdfReader(): _ZoteroTypes.ReaderInstance | null {
  const mainWindow = Zotero.getMainWindow() as Window & {
    Zotero_Tabs?: { selectedID: string };
  };
  const tabID = mainWindow.Zotero_Tabs?.selectedID;
  const reader = tabID ? Zotero.Reader.getByTabID(tabID) : null;
  if (!reader || reader.type !== "pdf") {
    return null;
  }
  return reader;
}

export function startReaderFigureScreenshot(): boolean {
  const reader = getActivePdfReader();
  if (!reader) return false;
  const doc = resolveReaderDocument(reader);
  if (!doc?.body) return false;
  reader.focus();
  startSelection(doc);
  return true;
}
