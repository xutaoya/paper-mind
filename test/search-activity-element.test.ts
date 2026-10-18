import { assert } from "chai";
import {
  measureTextOverflow,
  parseSearchQueryFromEntry,
  parseSearchSources,
  resolveTooltipMaxWidth,
} from "../src/modules/ui/chat-panel/SearchActivityElement.ts";
import type { ParsedToolCallEntry } from "../src/modules/ui/chat-panel/MarkdownRenderer.ts";

describe("search activity element", function () {
  it("parses hosted web search sources with title and url", function () {
    const sources = parseSearchSources(
      [
        "query: accessible animation patterns for React",
        "sources:",
        "- Google for Developers — https://developers.google.com",
        "- GitHub — https://github.com",
      ].join("\n"),
    );

    assert.equal(sources.length, 2);
    assert.equal(sources[0].title, "Google for Developers");
    assert.equal(sources[0].domain, "developers.google.com");
    assert.equal(sources[1].url, "https://github.com");
  });

  it("reads query from tool args", function () {
    const entry: ParsedToolCallEntry = {
      status: "calling",
      toolName: "web_search",
      statusText: "Calling...",
      toolArgs: JSON.stringify({ query: "transformer attention" }),
    };
    assert.equal(parseSearchQueryFromEntry(entry), "transformer attention");
  });

  it("reads query from display-format tool args", function () {
    const entry: ParsedToolCallEntry = {
      status: "calling",
      toolName: "web_search",
      statusText: "Calling...",
      toolArgs: 'query="transformer attention", source="web"',
    };
    assert.equal(parseSearchQueryFromEntry(entry), "transformer attention");
  });

  it("reads query from tool result when args are empty", function () {
    const entry: ParsedToolCallEntry = {
      status: "calling",
      toolName: "web_search",
      statusText: "Searching...",
      toolArgs: "",
      toolResult: "query: accessible animation patterns for React\nsources:",
    };
    assert.equal(
      parseSearchQueryFromEntry(entry),
      "accessible animation patterns for React",
    );
  });

  it("prefers full tool-result query over truncated tool args", function () {
    const entry: ParsedToolCallEntry = {
      status: "completed",
      toolName: "web_search",
      statusText: "Done",
      toolArgs: 'query="short tru..."',
      toolResult:
        "query: MambaDFuse github repository code repository full query text\nsources:\n- GitHub — https://github.com",
    };
    assert.equal(
      parseSearchQueryFromEntry(entry),
      "MambaDFuse github repository code repository full query text",
    );
  });

  it("reads query from raw json tool args", function () {
    const longQuery =
      "MambaDFuse github repository code Mamba-based Dual-phase Multimodal Fusion";
    const entry: ParsedToolCallEntry = {
      status: "calling",
      toolName: "web_search",
      statusText: "Calling...",
      toolArgs: JSON.stringify({ query: longQuery, source: "web" }),
    };
    assert.equal(parseSearchQueryFromEntry(entry), longQuery);
  });

  it("prefers the longest non-truncated query candidate", function () {
    const fullQuery =
      "SFMFusion Spatial-Frequency Enhanced Mamba github repository";
    const entry: ParsedToolCallEntry = {
      status: "completed",
      toolName: "web_search",
      statusText: "Done",
      toolArgs: `query="${fullQuery.slice(0, 24)}..."`,
      toolResult: `query: ${fullQuery}\nsources:\n- GitHub — https://github.com`,
    };
    assert.equal(parseSearchQueryFromEntry(entry), fullQuery);
  });

  it("caps tooltip width to the viewport", function () {
    const win = { innerWidth: 320 } as Window;
    assert.equal(resolveTooltipMaxWidth(win), 304);
    assert.equal(resolveTooltipMaxWidth({ innerWidth: 1200 } as Window), 420);
  });

  it("falls back to text length when layout metrics are unavailable", function () {
    const el = {
      clientWidth: 180,
      scrollWidth: 180,
      scrollHeight: 40,
      ownerDocument: {
        defaultView: null,
        documentElement: null,
        body: null,
      },
    } as unknown as HTMLElement;
    assert.isFalse(measureTextOverflow(el, "short query"));
    assert.isTrue(measureTextOverflow(el, "x".repeat(60)));
  });
});
