import { assert } from "chai";
import { testModelSpeed } from "../src/modules/preferences/ModelSpeedTest.ts";

describe("ModelSpeedTest", function () {
  let originalFetch: typeof fetch;
  let originalAddon: unknown;

  beforeEach(function () {
    originalFetch = globalThis.fetch;
    originalAddon = (globalThis as { addon?: unknown }).addon;
    (globalThis as { addon?: unknown }).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (messages: Array<{ id: string }>) =>
              messages.map((message) => ({
                value: message.id,
              })),
          },
        },
      },
    };
  });

  afterEach(function () {
    globalThis.fetch = originalFetch;
    (globalThis as { addon?: unknown }).addon = originalAddon;
  });

  it("returns latency for openai-compatible providers", async function () {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Hi" } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch;

    const result = await testModelSpeed(
      {
        id: "custom-1",
        name: "4api",
        type: "custom",
        enabled: true,
        isBuiltin: false,
        order: 0,
        apiKey: "token",
        baseUrl: "https://example.com/v1",
        defaultModel: "claude-opus-4-6",
        availableModels: ["claude-opus-4-6"],
      },
      "claude-opus-4-6",
    );

    assert.isTrue(result.success);
    assert.isAtLeast(result.latencyMs, 0);
  });

  it("reports missing credentials", async function () {
    const result = await testModelSpeed(
      {
        id: "custom-1",
        name: "4api",
        type: "custom",
        enabled: true,
        isBuiltin: false,
        order: 0,
        apiKey: "",
        baseUrl: "",
        defaultModel: "",
        availableModels: [],
      },
      "claude-opus-4-6",
    );

    assert.isFalse(result.success);
    assert.equal(result.latencyMs, 0);
    assert.isString(result.error);
  });
});
