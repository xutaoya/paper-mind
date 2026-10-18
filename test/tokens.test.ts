import assert from "node:assert/strict";
import {
  createTextTokenEstimator,
  estimateTextTokens,
} from "../src/utils/tokens.ts";

describe("estimateTextTokens", function () {
  it("returns 0 for empty text", function () {
    assert.equal(estimateTextTokens(""), 0);
  });

  it("estimates English text roughly by character count", function () {
    assert.equal(estimateTextTokens("abcd"), 1);
    assert.equal(estimateTextTokens("hello world"), 3);
  });

  it("estimates CJK text with a denser token ratio", function () {
    assert.equal(estimateTextTokens("你好"), 2);
  });

  it("matches a full estimate for tiny streamed chunks without rounding each chunk", function () {
    const estimate = createTextTokenEstimator();
    let text = "";
    for (const char of "abc你好defかなカナ\n🙂 ghij") {
      text += char;
      assert.equal(estimate(text), estimateTextTokens(text));
    }
  });

  it("recalculates replaced text and resets on empty text", function () {
    const estimate = createTextTokenEstimator();
    assert.equal(estimate("abcd"), 1);
    assert.equal(estimate("你好世界"), estimateTextTokens("你好世界"));
    assert.equal(estimate(""), 0);
    assert.equal(estimate("efgh"), 1);
  });

  it("preserves the original estimate ratios over long mixed text", function () {
    const text = "reading 阅读 かな カナ\n".repeat(10_000);
    const count = (
      text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []
    ).length;
    assert.equal(
      estimateTextTokens(text),
      Math.ceil(count / 1.5 + (text.length - count) / 4),
    );
  });
});
