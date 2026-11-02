/** Zoom only the original-page image; ordinary trackpad scrolling stays native. */
export function setupEvidencePreviewZoom(
  viewport: HTMLElement,
  image: HTMLImageElement,
): void {
  let scale = 1;
  viewport.setAttribute("data-evidence-image-viewport", "true");
  Object.assign(viewport.style, {
    overflow: "auto",
    maxHeight: "min(360px, 45vh)",
    scrollbarWidth: "thin",
    overscrollBehavior: "contain",
  });
  image.setAttribute("draggable", "false");

  const zoom = (next: number, clientX?: number, clientY?: number): void => {
    const previous = scale;
    scale = Math.max(1, Math.min(4, next));
    if (scale === previous) return;
    const rect =
      clientX !== undefined ? viewport.getBoundingClientRect() : null;
    const x = rect ? clientX! - rect.left : (viewport.clientWidth || 0) / 2;
    const y = rect ? clientY! - rect.top : (viewport.clientHeight || 0) / 2;
    const left = viewport.scrollLeft || 0;
    const top = viewport.scrollTop || 0;
    image.style.width = `${scale * 100}%`;
    image.style.cursor = scale > 1 ? "zoom-out" : "zoom-in";
    image.setAttribute("aria-pressed", String(scale > 1));
    image.setAttribute("data-evidence-zoom", String(scale));
    // Keep the point beneath the gesture stationary as the image size changes.
    viewport.scrollLeft = scale === 1 ? 0 : (left + x) * (scale / previous) - x;
    viewport.scrollTop = scale === 1 ? 0 : (top + y) * (scale / previous) - y;
  };
  const toggle = (): void => zoom(scale > 1 ? 1 : 2.5);
  image.addEventListener("click", toggle);
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  viewport.addEventListener(
    "wheel",
    (event) => {
      // Firefox reports a trackpad pinch as Ctrl+wheel, even without a key press.
      if (!event.ctrlKey || !Number.isFinite(event.deltaY) || !event.deltaY)
        return;
      event.preventDefault();
      event.stopPropagation();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight || 200
            : 1;
      const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
      zoom(scale * Math.exp(-delta * 0.01), event.clientX, event.clientY);
    },
    { passive: false },
  );
}
