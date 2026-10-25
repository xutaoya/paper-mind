/** Defer DOM work and return a disposer usable when a panel closes. */
export function scheduleChatFrame(
  view: Window | null | undefined,
  callback: () => void,
): () => void {
  if (view?.requestAnimationFrame && view.cancelAnimationFrame) {
    const id = view.requestAnimationFrame(callback);
    return () => view.cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}
