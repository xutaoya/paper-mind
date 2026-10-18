import { assert } from "chai";
import {
  buildAgentActivityItems,
  createLiveTurnTokenTracker,
  splitReasoningIntoLines,
} from "../src/modules/ui/chat-panel/AgentActivityPanel.ts";
import { formatTokenCount } from "../src/utils/tokens.ts";

describe("agent activity panel", function () {
  it("keeps growing after a stale usage report from an earlier tool round", function () {
    const track = createLiveTurnTokenTracker();
    const usage = { totalTokens: 265 };
    assert.equal(track(usage, "x".repeat(40), ""), 265);
    assert.equal(track(usage, "x".repeat(80), ""), 275);
    assert.equal(track(usage, "x".repeat(120), ""), 285);
    assert.deepEqual(usage, { totalTokens: 265 });
  });

  it("counts newly generated text even when prompt usage exceeds its estimate", function () {
    const track = createLiveTurnTokenTracker();
    const usage = { inputTokens: 300_000, outputTokens: 265 };
    assert.equal(track(usage, "x".repeat(40), ""), 300_265);
    assert.equal(track(usage, "x".repeat(44), ""), 300_266);
    assert.equal(track(usage, "x".repeat(44), "abcd"), 300_267);
    assert.equal(formatTokenCount(300_267), (300_267).toLocaleString());
  });

  it("anchors to each new API report without counting the same text twice", function () {
    const track = createLiveTurnTokenTracker();
    assert.equal(track({ totalTokens: 265 }, "x".repeat(40), ""), 265);
    assert.equal(track({ totalTokens: 265 }, "x".repeat(80), ""), 275);
    assert.equal(track({ totalTokens: 550 }, "x".repeat(80), ""), 550);
    assert.equal(track({ totalTokens: 550 }, "x".repeat(120), ""), 560);
  });

  it("estimates both reasoning and answer output without billing tool-result cards", function () {
    const track = createLiveTurnTokenTracker();
    assert.equal(track(undefined, "abcd", "efgh"), 2);
    const card = `<tool-call status="completed"><tool-result>${"x".repeat(10_000)}</tool-result></tool-call>`;
    assert.equal(track(undefined, "abcd", `efgh${card}`), 2);
    assert.equal(track(undefined, "abcd", `efgh${card}ijkl`), 3);
  });

  it("does not freeze at rounded large-number display boundaries", function () {
    const track = createLiveTurnTokenTracker();
    for (const base of [10_000, 100_000, 1_000_000]) {
      assert.equal(track({ totalTokens: base }, "", ""), base);
      const next = track({ totalTokens: base }, "abcd", "");
      assert.equal(next, base + 1);
      assert.notEqual(formatTokenCount(next!), formatTokenCount(base));
    }
  });

  it("does not invent progress when neither text nor provider usage changes", function () {
    const track = createLiveTurnTokenTracker();
    const count = track({ totalTokens: 265 }, "abcd", "");
    for (let index = 0; index < 10; index++) {
      assert.equal(track({ totalTokens: 265 }, "abcd", ""), count);
    }
  });

  it("preserves a live estimate on correction and isolates a new turn", function () {
    const track = createLiveTurnTokenTracker();
    assert.equal(track(undefined, "x".repeat(8000), ""), 2000);
    assert.equal(track({ totalTokens: 265 }, "x".repeat(8000), ""), 2000);
    assert.equal(track({ totalTokens: 265 }, "replaced", ""), 2000);
    assert.isUndefined(createLiveTurnTokenTracker()(undefined, "", ""));
  });

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
    const reasoning = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
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
