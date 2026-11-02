import { assert } from "chai";
import {
  findEvidenceMath,
  renderEvidenceMath,
} from "../src/modules/ui/chat-panel/EvidenceMath.ts";

describe("evidence formula rendering", function () {
  it("recognizes all four explicit math delimiters without changing the evidence", function () {
    const text =
      "Prior $p_s$ and \\(F_i\\).\n$$\\frac{a_i}{b^2}\\tag{12}$$\n\\[x+y\\]";
    const spans = findEvidenceMath(text);
    assert.deepEqual(
      spans.map((span) => span.content),
      ["p_s", "F_i", "\\frac{a_i}{b^2}\\tag{12}", "x+y"],
    );
    assert.deepEqual(
      spans.map((span) => span.displayMode),
      [false, false, true, true],
    );
    assert.equal(
      text.slice(spans[2].start, spans[2].end),
      "$$\\frac{a_i}{b^2}\\tag{12}$$",
    );
  });

  it("leaves currencies, escaped delimiters, code and incomplete math literal", function () {
    for (const text of [
      "Costs $20 and $30.",
      "Escaped \\$x\\$",
      "`$x$` and ```\n$$y$$\n```",
      "$$\\frac{x}{y}",
      "\\(x+1",
      "$x\ny$",
      "$ x $",
      "F_i ^ k = M_f",
    ]) {
      assert.isEmpty(findEvidenceMath(text), text);
    }
  });

  it("does not end a formula at an escaped dollar", function () {
    assert.equal(findEvidenceMath("$x+\\$+y$")[0].content, "x+\\$+y");
  });

  it("renders valid subscripts, fractions and equation labels to native MathML", function () {
    const original = (globalThis as any).DOMParser;
    let markup = "";
    (globalThis as any).DOMParser = class {
      parseFromString(value: string) {
        markup = value;
        return {
          querySelector: () => null,
          documentElement: {
            localName: "math",
            namespaceURI: "http://www.w3.org/1998/Math/MathML",
          },
        };
      }
    };
    try {
      const imported: unknown[] = [];
      const node = {
        ownerDocument: { importNode: (value: unknown) => value },
        appendChild: (value: unknown) => imported.push(value),
      };
      const span = findEvidenceMath("$$\\frac{a_i}{b^2}\\tag{12}$$")[0];
      assert.isTrue(renderEvidenceMath(node as unknown as HTMLElement, span));
      assert.include(markup, "<mfrac>");
      assert.include(markup, "<msub>");
      assert.include(markup, "<msup>");
      assert.include(markup, "12");
      assert.lengthOf(imported, 1);
    } finally {
      (globalThis as any).DOMParser = original;
    }
  });

  it("rejects malformed formulas instead of repairing or guessing their content", function () {
    const node = {
      ownerDocument: {},
      appendChild: () => assert.fail("Unexpected formula"),
    };
    for (const latex of ["\\frac{x}{", "\\unknownEvidenceCommand{x}"]) {
      assert.isFalse(
        renderEvidenceMath(node as unknown as HTMLElement, {
          start: 0,
          end: latex.length,
          content: latex,
          displayMode: true,
        }),
      );
    }
  });
});
