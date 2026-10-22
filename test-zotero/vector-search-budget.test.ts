import { assert } from "chai";
import { config } from "../package.json";
import { VectorStore } from "../src/modules/embedding/VectorStore";
import { cosineSimilarity } from "../src/modules/embedding/utils/cosine";

describe("batched vector search in Zotero SQLite", function () {
  this.timeout(15000);
  const modelId = "memory-budget-test-model";
  const itemKey = "MEMTEST1";
  let descriptor: PropertyDescriptor | undefined;
  let store: VectorStore;

  before(async function () {
    descriptor = Object.getOwnPropertyDescriptor(globalThis, "ztoolkit");
    Object.defineProperty(globalThis, "ztoolkit", {
      configurable: true,
      get: () => Zotero[config.addonInstance].data.ztoolkit,
    });
    store = new VectorStore();
    await store.init();
    await store.deleteByModel(itemKey, modelId);
  });

  after(async function () {
    await store?.deleteByModel(itemKey, modelId);
    await store?.close();
    if (descriptor) Object.defineProperty(globalThis, "ztoolkit", descriptor);
    else delete (globalThis as any).ztoolkit;
  });

  it("reads real BLOBs across multiple pages and returns the same topK", async function () {
    try {
      const entries = Array.from({ length: 1025 }, (_, index) => ({
        id: `memory-budget-test-${index}`,
        itemKey,
        modelId,
        chunkIndex: index,
        text: `Memory test chunk ${index}`,
        vector: [1, ((index * 17) % 1027) / 1000],
        metadata: { page: index + 1 },
        createdAt: 1,
      }));
      await store.upsert(entries);
      const actual = await store.search([1, 0], {
        modelId,
        itemKeys: [itemKey],
        topK: 9,
      });
      const expected = entries
        .map((entry) => ({
          entry,
          score: cosineSimilarity([1, 0], new Float32Array(entry.vector)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 9);
      assert.deepEqual(
        actual.map((entry) => entry.chunkIndex),
        expected.map(({ entry }) => entry.chunkIndex),
      );
      assert.deepEqual(
        actual.map((entry) => entry.page),
        expected.map(({ entry }) => entry.metadata.page),
      );
    } catch (error) {
      const failure = new Error(String(error));
      Object.defineProperty(failure, "message", {
        value: String(error),
        enumerable: true,
      });
      throw failure;
    }
  });
});
