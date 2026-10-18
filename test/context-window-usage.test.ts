import { assert } from "chai";
import {
  formatCompactTokenCount,
  resolveReasoningTokenCount,
} from "../src/utils/tokens.ts";

describe("context window usage", function () {
  it("formats token counts compactly", function () {
    assert.equal(formatCompactTokenCount(0), "0");
    assert.equal(formatCompactTokenCount(999), "999");
    assert.equal(formatCompactTokenCount(2711), "2.7k");
    assert.equal(formatCompactTokenCount(57_000), "57k");
    assert.equal(formatCompactTokenCount(950_000), "950k");
    assert.equal(formatCompactTokenCount(1_200_000), "1.2M");
    assert.equal(formatCompactTokenCount(12_000_000), "12M");
  });

  it("grows reasoning token count with streamed text after a stale API usage", function () {
    const longReasoning = "x".repeat(4000);
    assert.isAbove(resolveReasoningTokenCount(longReasoning, 718), 718);
    assert.equal(resolveReasoningTokenCount("", 718), 718);
  });
});
