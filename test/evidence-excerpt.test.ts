import { assert } from "chai";
import { splitEvidenceExcerpt } from "../src/modules/ui/chat-panel/EvidenceExcerpt.ts";

describe("evidence excerpt layout", function () {
  it("separates journal metadata, a section heading and original paragraphs", function () {
    const quote =
      "6336 IEEE TRANSACTIONS ON IMAGE\nPROCESSING, VOL. 35, 2026\nC. Stage II: Semantic Prior Diffusion Model\nIn Stage II, we develop a semantic prior diffusion model.\nIt restores high-quality semantic priors.\n\nUnder degraded imaging conditions, low-quality priors may deviate.\n";
    const blocks = splitEvidenceExcerpt(quote);
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["page-header", "heading", "paragraph", "paragraph"],
    );
    assert.include(blocks[0].text, "VOL. 35, 2026");
    assert.equal(
      blocks[1].text.trim(),
      "C. Stage II: Semantic Prior Diffusion Model",
    );
    assert.include(blocks[2].text, "\nIt restores");
    assert.equal(blocks.map((block) => block.text).join(""), quote);
  });

  it("preserves content and order when a header was flattened into the first line", function () {
    const quote =
      "6336 IEEE TRANSACTIONS ON IMAGE PROCESSING, VOL. 35, 2026 C. Stage II: Semantic Prior Diffusion Model In Stage II, we develop a model.";
    const blocks = splitEvidenceExcerpt(quote);
    assert.equal(blocks[0].kind, "page-header");
    assert.equal(blocks[1].kind, "paragraph");
    assert.equal(blocks.map((block) => block.text).join(""), quote);
  });

  it("does not invent paragraph breaks or repair damaged formulas", function () {
    const quote =
      "In Stage II, we develop a model. Under degraded conditions, priors may deviate. F_i ^ k = M_f(F_ir, F_vi).";
    assert.deepEqual(splitEvidenceExcerpt(quote), [
      { kind: "paragraph", text: quote },
    ]);
  });

  it("keeps blank lines and heading-like text inside a display equation together", function () {
    const quote =
      "Before.\n\n$$\\begin{aligned}\nx &= y \\\\\n\nC. Stage II\n\\end{aligned}$$\n\nAfter.";
    const blocks = splitEvidenceExcerpt(quote);
    assert.equal(blocks.length, 3);
    assert.include(blocks[1].text, "C. Stage II");
    assert.equal(blocks.map((block) => block.text).join(""), quote);
  });

  it("keeps equations, figure captions and ordinary prose out of heading detection", function () {
    for (const quote of [
      "F. x = y\n",
      "Fig. 1. Overall architecture\n",
      "C. This is a complete sentence.\n",
      "IEEE standards are discussed in this volume, published in 2026.\n",
      "<script>alert(1)</script>\n",
    ]) {
      const blocks = splitEvidenceExcerpt(quote);
      assert.deepEqual(blocks, [{ kind: "paragraph", text: quote }]);
    }
  });

  it("recognizes standalone numbered headings and retains every original separator", function () {
    for (const quote of [
      "\n3.2 Loss Functions\n\nFirst paragraph.\n\nSecond paragraph.",
      "III. EXPERIMENTS\r\n\r\nThe settings are described below.\r\n",
      "1) Network Architectures:\nThe network contains two branches.\n",
    ]) {
      const blocks = splitEvidenceExcerpt(quote);
      assert.isTrue(blocks.some((block) => block.kind === "heading"));
      assert.equal(blocks.map((block) => block.text).join(""), quote);
    }
  });
});
