import { assert } from "chai";
import { destroyAuthManager } from "../src/modules/auth";
import { destroyEmbeddingProviderFactory } from "../src/modules/embedding";
import {
  destroyProviderManager,
  getProviderManager,
} from "../src/modules/providers";

describe("embedding provider factory", function () {
  let originalZotero: unknown;
  let originalZtoolkit: unknown;
  let originalAddon: unknown;
  let originalFetch: unknown;
  let originalEnv: unknown;
  let hadEnv: boolean;
  let prefStore: Map<string, unknown>;

  beforeEach(function () {
    originalZotero = (globalThis as any).Zotero;
    originalZtoolkit = (globalThis as any).ztoolkit;
    originalAddon = (globalThis as any).addon;
    originalFetch = (globalThis as any).fetch;
    originalEnv = (globalThis as any).__env__;
    hadEnv = Object.prototype.hasOwnProperty.call(globalThis, "__env__");

    prefStore = new Map<string, unknown>([
      ["extensions.zotero.paperchat.apiKey", "sk-test"],
      ["extensions.zotero.paperchat.userId", 1],
      ["extensions.zotero.paperchat.username", "tester"],
      [
        "extensions.zotero.paperchat.paperchatModelsCache",
        JSON.stringify(["text-embedding-v4", "claude-haiku-4-5-20251001"]),
      ],
    ]);
    (globalThis as any).__env__ = "development";

    (globalThis as any).Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key),
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
          return true;
        },
        clear: (key: string) => {
          prefStore.delete(key);
          return true;
        },
      },
      Libraries: {
        userLibraryID: 1,
      },
      DataDirectory: {
        dir: "/tmp",
      },
    };
    (globalThis as any).ztoolkit = {
      log: () => undefined,
    };
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: () => [{ value: "", attributes: [] }],
          },
        },
      },
    };
  });

  afterEach(function () {
    destroyEmbeddingProviderFactory();
    destroyAuthManager();
    destroyProviderManager();
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).ztoolkit = originalZtoolkit;
    (globalThis as any).addon = originalAddon;
    (globalThis as any).fetch = originalFetch;
    if (hadEnv) {
      (globalThis as any).__env__ = originalEnv;
    } else {
      delete (globalThis as any).__env__;
    }
  });

  it("resolves the configured OpenAI provider without probing the embeddings endpoint", async function () {
    const manager = getProviderManager();
    manager.updateProviderConfig("openai", {
      enabled: true,
      apiKey: "sk-test",
    } as any);
    manager.setActiveProvider("openai");
    let fetchCalls = 0;
    (globalThis as any).fetch = async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called while resolving provider");
    };

    const { getEmbeddingProviderFactory } =
      await import("../src/modules/embedding/EmbeddingProviderFactory");
    const factory = getEmbeddingProviderFactory();
    const provider = await factory.getProvider();

    assert.isNotNull(provider);
    assert.equal(provider?.type, "openai");
    assert.include(provider?.modelId || "", "openai:");
    assert.equal(fetchCalls, 0);
  });

  it("uses the configured OpenAI base URL and reuses the resolved provider", async function () {
    const manager = getProviderManager();
    manager.updateProviderConfig("openai", {
      enabled: true,
      apiKey: "sk-test",
      baseUrl: "http://localhost:9002/v1",
    } as any);
    manager.setActiveProvider("openai");
    const urls: string[] = [];
    (globalThis as any).fetch = async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1], index: 0 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const { getEmbeddingProviderFactory } =
      await import("../src/modules/embedding/EmbeddingProviderFactory");
    const provider = await getEmbeddingProviderFactory().getProvider();
    assert.isNotNull(provider);

    await provider!.embed("first");
    assert.strictEqual(
      await getEmbeddingProviderFactory().getProvider(),
      provider,
    );
    await provider!.embed("second");

    assert.deepEqual(urls, [
      "http://localhost:9002/v1/embeddings",
      "http://localhost:9002/v1/embeddings",
    ]);
  });
});
