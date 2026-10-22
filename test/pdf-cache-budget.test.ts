import { assert } from "chai";
import type { PdfToolManager } from "../src/modules/chat/pdf-tools/PdfToolManager";

describe("PDF structure cache memory budget", function () {
  let manager: PdfToolManager;
  let cache: any;
  let originalZotero: unknown;
  let originalToolkit: unknown;

  beforeEach(async function () {
    originalZotero = (globalThis as any).Zotero;
    originalToolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = { Prefs: { get: () => undefined } };
    (globalThis as any).ztoolkit = { log: () => undefined };
    const { PdfToolManager } =
      await import("../src/modules/chat/pdf-tools/PdfToolManager.ts");
    manager = new PdfToolManager();
    cache = manager as any;
  });

  afterEach(function () {
    manager?.clearCache();
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).ztoolkit = originalToolkit;
  });

  function paper(content = "body") {
    return {
      metadata: {},
      fullText: content,
      sections: [],
      pages: [],
      pageCount: 1,
    };
  }

  it("evicts by byte budget as well as the document count", function () {
    const structure = paper("x".repeat(100));
    const bytes = cache.estimateCacheBytes(structure);
    cache.MAX_CACHE_BYTES = bytes * 2;
    for (const key of ["A", "B", "C"]) cache.addToCache(key, 1, structure);
    assert.deepEqual([...cache.paperCache.keys()], ["B", "C"]);
    assert.equal(cache.cachedBytes, bytes * 2);
    cache.MAX_CACHE_SIZE = 1;
    cache.addToCache("D", 1, structure);
    assert.deepEqual([...cache.paperCache.keys()], ["D"]);
  });

  it("returns oversized papers without retaining them or evicting small papers", async function () {
    cache.MAX_CACHE_BYTES = cache.estimateCacheBytes(paper()) + 10;
    cache.addToCache("A", 1, paper());
    const oversized = paper("x".repeat(10000));
    cache.getItemByKey = () => ({
      id: 2,
      isAttachment: () => true,
      isPDFAttachment: () => true,
      attachmentText: Promise.resolve("large paper"),
    });
    cache.parsePaperStructure = () => oversized;
    assert.strictEqual(await manager.extractAndParsePaper("B"), oversized);
    assert.deepEqual([...cache.paperCache.keys()], ["A"]);
  });

  it("treats cache hits as recent and reaccounts lazily enriched outlines", async function () {
    const structure = paper();
    const bytes = cache.estimateCacheBytes(structure);
    cache.MAX_CACHE_BYTES = bytes * 2 + 100;
    cache.addToCache("A", 1, structure);
    cache.addToCache("B", 2, paper());
    await manager.extractAndParsePaper("A");
    cache.addToCache("C", 3, paper());
    assert.deepEqual([...cache.paperCache.keys()], ["A", "C"]);
    cache.enrichWithNativeOutline = async (value: any) => {
      value.nativeOutline = [{ title: "outline".repeat(1000), children: [] }];
    };
    assert.strictEqual(
      await manager.extractAndParsePaper("A", true),
      structure,
    );
    assert.deepEqual([...cache.paperCache.keys()], ["C"]);
    assert.equal(cache.cachedBytes, bytes);
  });

  it("expires idle entries without requiring another PDF request", async function () {
    cache.CACHE_TTL = 10;
    cache.addToCache("A", 1, paper());
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cache.paperCache.size, 0);
    assert.equal(cache.cachedBytes, 0);
    assert.isNull(cache.cacheExpiryTimer);
  });

  it("releases accounting and expiry timers on invalidation and shutdown", function () {
    for (const key of ["A", "1:A", "2:A", "B"])
      cache.addToCache(key, 1, paper());
    manager.invalidateCache("A");
    assert.deepEqual([...cache.paperCache.keys()], ["B"]);
    assert.equal(cache.cachedBytes, cache.estimateCacheBytes(paper()));
    manager.clearCache();
    assert.equal(cache.cachedBytes, 0);
    assert.isNull(cache.cacheExpiryTimer);
  });
});
