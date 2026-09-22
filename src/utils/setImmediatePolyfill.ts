/**
 * JSZip (and some bundled deps) call Node's setImmediate directly. Gecko's
 * main window does not provide it, which breaks MinerU zip extraction.
 */
export function ensureSetImmediate(): void {
  const global = globalThis as Record<string, unknown>;
  if (typeof global.setImmediate === "function") {
    return;
  }

  global.setImmediate = (callback: () => void) =>
    setTimeout(() => {
      callback();
    }, 0);

  global.clearImmediate = (handle: unknown) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  };
}

ensureSetImmediate();
