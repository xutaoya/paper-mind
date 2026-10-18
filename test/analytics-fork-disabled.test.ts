import { assert } from "chai";
import {
  destroyAnalyticsService,
  getAnalyticsService,
} from "../src/modules/analytics/index.ts";

describe("analytics fork policy", function () {
  afterEach(async function () {
    await destroyAnalyticsService();
  });

  it("does not inspect event metadata when telemetry is disabled", async function () {
    const props = {
      get userId(): string {
        throw new Error("preferences unavailable");
      },
    };
    const service = getAnalyticsService();
    assert.doesNotThrow(() => service.track("plugin_started", props));
    await service.destroy();
  });

  it("can recreate the disabled service after shutdown", async function () {
    const original = getAnalyticsService();
    await destroyAnalyticsService();
    const recreated = getAnalyticsService();
    assert.notStrictEqual(recreated, original);
    assert.doesNotThrow(() => recreated.track("plugin_started"));
  });

  it("does not initialize upstream telemetry in the PaperMind fork", async function () {
    const service = getAnalyticsService();
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      service.track("plugin_started", { source: "test" });
      await service.destroy();
      assert.isFalse(fetchCalled);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
