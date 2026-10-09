import { assert } from "chai";
import {
  buildAgentActivityItems,
  splitReasoningIntoLines,
} from "../src/modules/ui/chat-panel/AgentActivityPanel.ts";

describe("agent activity panel", function () {
  it("splits long single-paragraph reasoning into sentence lines", function () {
    const reasoning =
      "First sentence here with enough words to make the paragraph longer than the threshold. " +
      "Second sentence follows with additional detail about the same topic. " +
      "Third sentence ends the reasoning block for this test case.";
    const lines = splitReasoningIntoLines(reasoning);
    assert.isAtLeast(lines.length, 2);
    assert.include(lines[0], "First sentence");
  });

  it("builds mixed items with reasoning lines before tool calls", function () {
    const content = [
      '<tool-call status="completed" expand-key="ws-1">',
      "<tool-name>web_search</tool-name>",
      '<tool-args>{"query":"transformer attention"}</tool-args>',
      "<tool-status>Done</tool-status>",
      "<tool-result>query: transformer attention\nsources:\n- Attention Is All You Need — https://example.com</tool-result>",
      "</tool-call>",
    ].join("");

    const items = buildAgentActivityItems("Line one\nLine two", content);
    assert.equal(items.length, 3);
    assert.equal(items[0].kind, "text");
    assert.equal(items[1].kind, "text");
    assert.equal(items[2].kind, "tool");
    if (items[2].kind === "tool") {
      assert.equal(items[2].entry.toolName, "web_search");
      assert.equal(items[2].status, "complete");
    }
  });

  it("caps reasoning lines while working", function () {
    const reasoning = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join(
      "\n",
    );
    const items = buildAgentActivityItems(reasoning, "", { isWorking: true });
    assert.equal(items.filter((item) => item.kind === "text").length, 12);
    if (items[0].kind === "text") {
      assert.equal(items[0].content, "line 9");
    }
  });

  it("omits tool rows when execution plan already lists steps", function () {
    const content = [
      '<tool-call status="completed" expand-key="ra-1">',
      "<tool-name>read_artifact</tool-name>",
      "<tool-status>Done</tool-status>",
      "</tool-call>",
    ].join("");

    const items = buildAgentActivityItems("Thinking line", content, {
      hideToolActivityRows: true,
    });
    assert.deepEqual(
      items.map((item) => item.kind),
      ["text"],
    );
  });
});
