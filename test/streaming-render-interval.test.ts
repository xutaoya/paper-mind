import { assert } from "chai";
import { getStreamingRenderInterval } from "../src/modules/ui/chat-panel/streamingRenderInterval.ts";

describe("streaming render budget", function () {
  it("keeps short replies responsive and reduces large snapshot rebuilds", function () {
    assert.equal(getStreamingRenderInterval(0), 240);
    assert.equal(getStreamingRenderInterval(11999), 240);
    assert.equal(getStreamingRenderInterval(12000), 480);
    assert.equal(getStreamingRenderInterval(48000), 720);
    assert.equal(getStreamingRenderInterval(96000), 1000);
    assert.equal(getStreamingRenderInterval(1000000), 1000);
  });

  it("allows expensive renders to settle without indefinitely delaying updates", function () {
    assert.equal(getStreamingRenderInterval(100, 200), 600);
    assert.equal(getStreamingRenderInterval(100, 2000), 1000);
    assert.equal(getStreamingRenderInterval(100, 0), 240);
  });
});
