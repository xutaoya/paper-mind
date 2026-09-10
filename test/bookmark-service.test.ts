import { assert } from "chai";
import {
  BookmarkRepository,
  deriveBookmarkTitle,
  deriveBookmarkTitleForAssistantReply,
} from "../src/modules/bookmarks/index.ts";
import {
  mergeAdjacentSourceGroups,
  mergeDuplicateMarkdownHeadings,
  stripReaderThinkingSection,
} from "../src/modules/bookmarks/bookmarkTurnContent.ts";

describe("bookmark service helpers", function () {
  it("derives a compact bookmark title from message content", function () {
    const title = deriveBookmarkTitle(
      "This is a long assistant reply that should be shortened for bookmark titles when it exceeds the display limit in the manager panel.",
    );
    assert.isTrue(title.length <= 72);
    assert.include(title, "assistant reply");
  });

  it("prefers the preceding user question as the default bookmark title", function () {
    const title = deriveBookmarkTitleForAssistantReply(
      [
        {
          id: "user-1",
          role: "user",
          content: "What is the main contribution of this paper?",
          timestamp: 1,
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "The main contribution is a new architecture.",
          timestamp: 2,
        },
      ],
      "assistant-1",
      "The main contribution is a new architecture.",
    );
    assert.include(title, "main contribution");
    assert.notInclude(title, "new architecture");
  });
});

describe("bookmark reader content", function () {
  it("merges duplicate markdown headings in reader content", function () {
    const merged = mergeDuplicateMarkdownHeadings(
      "### Paper: Example\n\n- first\n\n### Paper: Example\n\n- second",
    );
    assert.equal((merged.match(/### Paper: Example/g) || []).length, 1);
    assert.include(merged, "- first");
    assert.include(merged, "- second");
  });

  it("merges adjacent source groups with the same label", function () {
    const merged = mergeAdjacentSourceGroups(
      '<source-group type="paper" label="Example">first</source-group>\n<source-group type="paper" label="Example">second</source-group>',
    );
    assert.include(merged, "first");
    assert.include(merged, "second");
    assert.equal((merged.match(/<source-group\b/gi) || []).length, 1);
  });

  it("strips copied thinking sections from reader content", function () {
    const content = stripReaderThinkingSection(
      "## Thinking\n\ninternal chain\n\n## Answer\n\nfinal reply",
    );
    assert.equal(content, "## Answer\n\nfinal reply");
  });

  it("keeps regular assistant content unchanged", function () {
    const content = "Plain assistant reply without thinking.";
    assert.equal(stripReaderThinkingSection(content), content);
  });
});

describe("bookmark repository mapping", function () {
  it("exposes repository factory for a library id", function () {
    const originalZotero = (globalThis as { Zotero?: unknown }).Zotero;
    (globalThis as { Zotero?: unknown }).Zotero = {
      Libraries: { userLibraryID: 1 },
    };
    try {
      const repository = new BookmarkRepository(1);
      assert.equal((repository as { libraryId: number }).libraryId, 1);
    } finally {
      (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
    }
  });
});
