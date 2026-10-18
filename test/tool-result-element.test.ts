import { assert } from "chai";
import {
  buildToolResultCopyText,
  getToolResultContentSignature,
  mapToolCallStatusToResultStatus,
  resolveToolResultDefaultOpen,
} from "../src/modules/ui/chat-panel/ToolResultElement.ts";
import type { ParsedToolCallEntry } from "../src/modules/ui/chat-panel/MarkdownRenderer.ts";

describe("tool result element", function () {
  const baseEntry: ParsedToolCallEntry = {
    status: "completed",
    toolName: "get_paper_section",
    toolArgs: '{"section":"methods"}',
    statusText: "Done",
    toolResult: "Section content here",
  };

  it("maps tool call statuses to result statuses", function () {
    assert.equal(mapToolCallStatusToResultStatus("calling"), "running");
    assert.equal(mapToolCallStatusToResultStatus("completed"), "success");
    assert.equal(mapToolCallStatusToResultStatus("error"), "error");
  });

  it("builds a stable content signature", function () {
    const sig = getToolResultContentSignature(baseEntry);
    assert.include(sig, "completed");
    assert.include(sig, "Section content here");
  });

  it("builds copy text from args and result", function () {
    const text = buildToolResultCopyText(baseEntry);
    assert.include(text, '{"section":"methods"}');
    assert.include(text, "Section content here");
  });

  it("opens while running and collapses after completion by default", function () {
    assert.isTrue(resolveToolResultDefaultOpen("running", "active", true));
    assert.isFalse(resolveToolResultDefaultOpen("success", "complete", true));
  });
});
