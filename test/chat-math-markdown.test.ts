import { assert } from "chai";
import {
  containsInlineMathDelimiters,
  deltaContainsMathMarkup,
  extractMathMLMarkup,
  normalizeBlockquoteListIndentation,
  normalizeMathContent,
  repairIncompleteInlineMath,
} from "../src/utils/chatMathMarkdown.ts";
import katex from "katex";

describe("chat math markdown helpers", function () {
  it("normalizes escaped underscores inside math content", function () {
    assert.equal(normalizeMathContent("D(\\Phi\\_F)"), "D(\\Phi_F)");
  });

  it("escapes unclosed inline math delimiters on a line", function () {
    assert.equal(
      repairIncompleteInlineMath("5. 计算 $\\Phi_F$ 与 $(\\Phi_V + \\Phi_"),
      "5. 计算 $\\Phi_F$ 与 \\$(\\Phi_V + \\Phi_",
    );
  });

  it("detects math markup in streaming deltas", function () {
    assert.isTrue(deltaContainsMathMarkup(" 与 $D(\\Phi_F)$"));
    assert.isFalse(deltaContainsMathMarkup("plain text only"));
  });

  it("normalizes deep blockquote list indentation that would become code blocks", function () {
    const input = "> 5.     用公式(13)计算 $\\Phi_F$ 之间的损失";
    assert.equal(
      normalizeBlockquoteListIndentation(input),
      "> 5.   用公式(13)计算 $\\Phi_F$ 之间的损失",
    );
  });

  it("detects inline math delimiters in prose", function () {
    assert.isTrue(containsInlineMathDelimiters("计算 $D(\\Phi_F)$ 的损失"));
    assert.isFalse(containsInlineMathDelimiters("plain text only"));
  });

  it("extracts MathML from KaTeX output", function () {
    const html = katex.renderToString("D(\\Phi_F)", {
      displayMode: false,
      output: "mathml",
      throwOnError: false,
    });
    const math = extractMathMLMarkup(html);
    assert.match(math || "", /^<math\b/);
    assert.include(math || "", "D(\\Phi_F)");
  });
});
