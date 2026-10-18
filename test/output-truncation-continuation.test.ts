import { assert } from "chai";
import {
  getOutputTruncationContinuationUserMessage,
  REASONING_TRUNCATION_CONTINUATION_USER_MESSAGE,
  shouldContinueTruncatedOutput,
} from "../src/modules/chat/agent-runtime/outputTruncationContinuation.ts";

describe("output truncation continuation", function () {
  it("continues when reasoning-only output hits max_tokens", function () {
    assert.isTrue(
      shouldContinueTruncatedOutput({
        stopReason: "max_tokens",
        content: "",
        reasoning: "Still thinking about the paper...",
      }),
    );
  });

  it("does not continue when there is no partial output", function () {
    assert.isFalse(
      shouldContinueTruncatedOutput({
        stopReason: "max_tokens",
        content: "",
        reasoning: "",
      }),
    );
  });

  it("uses a reasoning-specific continuation prompt when content is empty", function () {
    assert.equal(
      getOutputTruncationContinuationUserMessage("", "Partial reasoning chain"),
      REASONING_TRUNCATION_CONTINUATION_USER_MESSAGE,
    );
  });
});
