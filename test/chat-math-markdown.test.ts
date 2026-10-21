import { assert } from "chai";
import {
  containsInlineMathDelimiters,
  deltaContainsMathMarkup,
  extractMathMLMarkup,
  normalizeBlockquoteListIndentation,
  normalizeMathContent,
  preserveStrongEmphasisAsHtml,
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

  it("preserves bold spans that markdown-it would leave as literal asterisks", function () {
    const input =
      '下面从**核心思想**、架构、关键设计到**为什么它能提供"全特征"**逐层说明。';
    const processed = preserveStrongEmphasisAsHtml(input);
    assert.include(
      processed,
      "<strong>为什么它能提供&quot;全特征&quot;</strong>",
    );
    assert.notInclude(processed, '**为什么它能提供"全特征"**');
    assert.include(processed, "**核心思想**");
  });

  it("preserves quoted bold spans before fullwidth colons", function () {
    const input =
      '它表达的是**"四维图像张量如何被摊平成一个可以做矩阵乘法的二维矩阵"**：';
    const processed = preserveStrongEmphasisAsHtml(input);
    assert.include(
      processed,
      "<strong>&quot;四维图像张量如何被摊平成一个可以做矩阵乘法的二维矩阵&quot;</strong>",
    );
    assert.notInclude(processed, '**"四维图像张量');
  });

  it("preserves quoted bold spans before ascii colons and at line end", function () {
    const input = '对应**"转置"这个动作**: 以及 **"把列搬到行的位置"**';
    const processed = preserveStrongEmphasisAsHtml(input);
    assert.include(processed, "<strong>&quot;转置&quot;这个动作</strong>");
    assert.include(processed, "<strong>&quot;把列搬到行的位置&quot;</strong>");
    assert.notInclude(processed, '**"转置"');
  });

  it("leaves ordinary bold markdown unchanged", function () {
    const input = "这是 **普通加粗** 文本";
    assert.equal(preserveStrongEmphasisAsHtml(input), input);
  });

  it("preserves parenthesized bold labels immediately after CJK text", function () {
    for (const label of [
      "(b) Attention Parallel Feature Mixer",
      "（b）注意力并行特征混合器",
    ]) {
      assert.equal(
        preserveStrongEmphasisAsHtml(`与**${label}**（APFM 模块）。`),
        `与<strong>${label}</strong>（APFM 模块）。`,
      );
    }
  });

  it("leaves spaced and escaped parenthesized bold labels unchanged", function () {
    for (const input of [
      "与 **(b) Attention Parallel Feature Mixer**（APFM 模块）。",
      String.raw`与\**(b) Attention Parallel Feature Mixer\**（APFM 模块）。`,
    ]) {
      assert.equal(preserveStrongEmphasisAsHtml(input), input);
    }
  });

  it("preserves multiplication-led iteration labels after CJK text", function () {
    for (const label of ["×(T−1)", "×(T-1)", "×（T−1）"]) {
      for (const separator of ["", " "]) {
        assert.equal(
          preserveStrongEmphasisAsHtml(
            `上方标注**${label}**${separator}的自环箭头表示迭代重复。`,
          ),
          `上方标注<strong>${label}</strong>${separator}的自环箭头表示迭代重复。`,
        );
      }
    }
  });

  it("preserves bold operator-only labels after CJK text", function () {
    for (const operator of ["+", "−", "×", "⊙", "="]) {
      assert.equal(
        preserveStrongEmphasisAsHtml(`二者在底部**${operator}** 节点相加。`),
        `二者在底部<strong>${operator}</strong> 节点相加。`,
      );
    }
  });

  it("escapes HTML inside repaired parenthesized bold labels", function () {
    assert.equal(
      preserveStrongEmphasisAsHtml(
        '与**(b) <img src=x onerror="alert(1)">**。',
      ),
      "与<strong>(b) &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</strong>。",
    );
  });

  it("preserves bold spans immediately followed by CJK text", function () {
    const input = "提出**弹性权重巩固（EWC）**通过正则化";
    const processed = preserveStrongEmphasisAsHtml(input);
    assert.include(processed, "<strong>弹性权重巩固（EWC）</strong>");
    assert.notInclude(processed, "**弹性权重巩固（EWC）**");
  });
});
