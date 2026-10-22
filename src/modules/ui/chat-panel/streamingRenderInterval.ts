/** Keep full Markdown snapshots, but rebuild large replies less frequently. */
export function getStreamingRenderInterval(
  contentLength: number,
  lastRenderDurationMs: number = 0,
): number {
  const sizeInterval =
    contentLength < 12000
      ? 240
      : contentLength < 48000
        ? 480
        : contentLength < 96000
          ? 720
          : 1000;
  return Math.min(1000, Math.max(sizeInterval, lastRenderDurationMs * 3));
}
