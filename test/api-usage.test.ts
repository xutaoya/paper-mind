import assert from "node:assert/strict";
import {
  extractReasoningTokensFromUsage,
  extractTurnTokenUsage,
  getTurnTokenTotal,
  mergeTurnTokenUsage,
} from "../src/utils/apiUsage.ts";

describe("API usage", function () {
  describe("extractReasoningTokensFromUsage", function () {
    it("reads reasoning_tokens from completion_tokens_details", function () {
      assert.equal(
        extractReasoningTokensFromUsage({
          completion_tokens: 600,
          completion_tokens_details: { reasoning_tokens: 576 },
        }),
        576,
      );
    });

    it("reads top-level reasoning_tokens", function () {
      assert.equal(
        extractReasoningTokensFromUsage({ reasoning_tokens: 128 }),
        128,
      );
    });

    it("reads thinking_tokens from Anthropic output_tokens_details", function () {
      assert.equal(
        extractReasoningTokensFromUsage({
          output_tokens: 3800,
          output_tokens_details: { thinking_tokens: 2100 },
        }),
        2100,
      );
    });

    it("returns undefined when usage is missing", function () {
      assert.equal(extractReasoningTokensFromUsage(null), undefined);
      assert.equal(extractReasoningTokensFromUsage({}), undefined);
    });
  });

  describe("turn token usage", function () {
    it("extracts input and output tokens from provider usage", function () {
      assert.deepEqual(
        extractTurnTokenUsage({
          prompt_tokens: 1200,
          completion_tokens: 340,
        }),
        {
          inputTokens: 1200,
          outputTokens: 340,
          totalTokens: undefined,
          reasoningTokens: undefined,
        },
      );
    });

    it("merges usage across multiple provider rounds", function () {
      const merged = mergeTurnTokenUsage(
        { inputTokens: 1000, outputTokens: 200 },
        { inputTokens: 500, outputTokens: 150, reasoningTokens: 80 },
      );
      assert.deepEqual(merged, {
        inputTokens: 1500,
        outputTokens: 350,
        reasoningTokens: 80,
        totalTokens: undefined,
      });
      assert.equal(getTurnTokenTotal(merged), 1850);
    });
  });
});
