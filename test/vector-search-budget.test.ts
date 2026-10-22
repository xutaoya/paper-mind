import { assert } from "chai";
import { VectorStore } from "../src/modules/embedding/VectorStore.ts";
import { cosineSimilarity } from "../src/modules/embedding/utils/cosine.ts";

describe("bounded vector search", function () {
  let originalToolkit: unknown;

  beforeEach(function () {
    originalToolkit = (globalThis as any).ztoolkit;
    (globalThis as any).ztoolkit = { log: () => undefined };
  });

  afterEach(function () {
    (globalThis as any).ztoolkit = originalToolkit;
  });

  function row(id: number, vector: number[], model = "model", key = "A") {
    return {
      search_rowid: id,
      model_id: model,
      item_key: key,
      chunk_index: id,
      text: `chunk ${id}`,
      vector: new Uint8Array(new Float32Array(vector).buffer),
      metadata: JSON.stringify({ page: id }),
    };
  }

  function setup(rows: ReturnType<typeof row>[]) {
    const store = new VectorStore();
    const batches: number[] = [];
    const queries: { sql: string; params: unknown[] }[] = [];
    (store as any).db = {
      queryAsync: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        const filterCount = sql.includes("item_key IN")
          ? params.length - (sql.includes("MAX(rowid)") ? 1 : 4)
          : 0;
        const filtered = rows.filter(
          (entry) =>
            entry.model_id === params[0] &&
            (!filterCount ||
              params.slice(1, filterCount + 1).includes(entry.item_key)),
        );
        if (sql.includes("MAX(rowid)"))
          return [
            {
              max_rowid: Math.max(
                0,
                ...filtered.map((entry) => entry.search_rowid),
              ),
            },
          ];
        assert.include(sql, "ORDER BY rowid LIMIT ?");
        const [cursor, max, limit] = params.slice(-3) as number[];
        const batch = filtered
          .filter(
            (entry) => entry.search_rowid > cursor && entry.search_rowid <= max,
          )
          .slice(0, limit);
        batches.push(batch.length);
        return batch;
      },
    };
    return { store, batches, queries };
  }

  it("matches exhaustive ranking across batches while respecting model/item filters", async function () {
    const rows = Array.from({ length: 1300 }, (_, index) =>
      row(
        index + 1,
        [1, ((index * 17) % 1301) / 1000],
        index % 7 === 0 ? "other" : "model",
        index % 3 === 0 ? "B" : "A",
      ),
    );
    const { store, batches } = setup(rows);
    const result = await store.search([1, 0], {
      modelId: "model",
      itemKeys: ["A"],
      topK: 11,
      minScore: 0.8,
    });
    const expected = rows
      .filter((entry) => entry.model_id === "model" && entry.item_key === "A")
      .map((entry) => ({
        entry,
        score: cosineSimilarity([1, 0], new Float32Array(entry.vector.buffer)),
      }))
      .filter(({ score }) => score >= 0.8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 11);
    assert.deepEqual(
      result.map((entry) => entry.chunkIndex),
      expected.map(({ entry }) => entry.chunk_index),
    );
    assert.deepEqual(
      result.map((entry) => entry.page),
      result.map((entry) => entry.chunkIndex),
    );
    assert.isAbove(batches.length, 2);
    assert.isAtMost(Math.max(...batches), 256);
  });

  it("keeps equal scores stable across batch boundaries and skips corrupt rows", async function () {
    const rows = Array.from({ length: 520 }, (_, index) =>
      row(index + 1, [1, 0]),
    );
    rows[0].vector = new Uint8Array(3);
    rows[1].vector = new Uint8Array(0);
    rows[2].vector = new Uint8Array(new Float32Array([1]).buffer);
    rows[3].text = "";
    rows[4].metadata = "broken JSON";
    const { store } = setup(rows);
    const result = await store.search([1, 0], { modelId: "model", topK: 300 });
    assert.lengthOf(result, 300);
    assert.equal(result[0].chunkIndex, 5);
    assert.isUndefined(result[0].page);
    assert.equal(result[299].chunkIndex, 304);
  });

  it("handles unaligned BLOBs and avoids expanding aligned vectors to number arrays", function () {
    const store = new VectorStore() as any;
    const aligned = new Uint8Array(new Float32Array([1.5, -2]).buffer);
    const vector = store.blobToVector(aligned);
    assert.instanceOf(vector, Float32Array);
    assert.strictEqual(vector.buffer, aligned.buffer);
    const unaligned = new Uint8Array(aligned.length + 1);
    unaligned.set(aligned, 1);
    assert.deepEqual(
      Array.from(store.blobToVector(unaligned.subarray(1))),
      [1.5, -2],
    );
    assert.deepEqual(
      Array.from(store.blobToVector(Array.from(aligned))),
      [1.5, -2],
    );
  });

  it("does not scan for invalid/empty requests or when the model has no rows", async function () {
    const { store, queries } = setup([]);
    for (const topK of [0, -1, Number.NaN, Infinity]) {
      assert.deepEqual(
        await store.search([1, 0], { modelId: "model", topK }),
        [],
      );
    }
    assert.deepEqual(await store.search([], { modelId: "model" }), []);
    assert.deepEqual(await store.search([1, 0]), []);
    assert.lengthOf(queries, 0);
    assert.deepEqual(await store.search([1, 0], { modelId: "model" }), []);
    assert.lengthOf(queries, 1);
  });
});
