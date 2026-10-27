import { assert } from "chai";
import {
  enableEquationReferencePreview,
  getMathEquationNumber,
  isEquationReferenceContext,
} from "../src/modules/ui/chat-panel/MathFormulaPreview.ts";

class PreviewElement {
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: PreviewElement[] = [];
  parentElement: PreviewElement | null = null;
  id = "";

  constructor(
    readonly ownerDocument: PreviewDocument,
    readonly tagName: string,
  ) {}

  readonly nodeType = 1;
  get isConnected(): boolean {
    return (
      this === this.ownerDocument.documentElement ||
      !!this.parentElement?.isConnected
    );
  }
  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
  }
  getAttribute(key: string): string | null {
    return this.attributes.get(key) ?? null;
  }
  removeAttribute(key: string): void {
    this.attributes.delete(key);
  }
  appendChild(child: PreviewElement): PreviewElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(element: PreviewElement): boolean {
    return (
      element === this || this.children.some((child) => child.contains(element))
    );
  }
  closest(selector: string): PreviewElement | null {
    if (this.attributes.has(selector.slice(1, -1))) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelector(tag: string): PreviewElement | null {
    for (const child of this.children) {
      if (child.tagName === tag) return child;
      const found = child.querySelector(tag);
      if (found) return found;
    }
    return null;
  }
  cloneNode(): PreviewElement {
    const clone = new PreviewElement(this.ownerDocument, this.tagName);
    for (const child of this.children) clone.appendChild(child.cloneNode());
    return clone;
  }
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left || "280");
    const top = Number.parseFloat(this.style.top || "200");
    const width = Math.min(500, Number.parseFloat(this.style.maxWidth || "40"));
    const height = 72;
    return {
      left,
      top,
      width,
      height,
      bottom: top + height,
      right: left + width,
    };
  }
}

class PreviewDocument {
  readonly listeners = new Map<string, Array<(event: any) => void>>();
  readonly observers = new Set<() => void>();
  readonly documentElement = new PreviewElement(this, "html");
  readonly body = this.documentElement.appendChild(
    new PreviewElement(this, "body"),
  );
  activeElement: PreviewElement | null = null;
  readonly defaultView = {
    innerWidth: 320,
    innerHeight: 240,
    addEventListener: (type: string, listener: (event: any) => void) =>
      this.addEventListener(type, listener),
    MutationObserver: class {
      constructor(protected readonly callback: () => void) {}
      observe(): void {}
      disconnect(): void {}
    },
  };
  constructor() {
    const observers = this.observers;
    this.defaultView.MutationObserver = class extends (
      this.defaultView.MutationObserver
    ) {
      observe = () => observers.add(this.callback);
      disconnect = () => observers.delete(this.callback);
    };
  }
  createElementNS(_namespace: string, tag: string): PreviewElement {
    return new PreviewElement(this, tag);
  }
  addEventListener(type: string, listener: (event: any) => void): void {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(
    type: string,
    target: unknown,
    details: Record<string, unknown> = {},
  ): void {
    for (const listener of this.listeners.get(type) || [])
      listener({ target, ...details });
  }
  get preview(): PreviewElement | undefined {
    return this.body.children.find(
      (node) => node.id === "paperchat-math-formula-preview",
    );
  }
  source(): PreviewElement {
    const source = this.body.appendChild(new PreviewElement(this, "span"));
    source.setAttribute("data-theme", "light");
    source.appendChild(new PreviewElement(this, "span"));
    const formula = this.body.appendChild(new PreviewElement(this, "div"));
    formula.appendChild(new PreviewElement(this, "math"));
    enableEquationReferencePreview(
      source as unknown as HTMLElement,
      formula as unknown as HTMLElement,
    );
    return source;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("equation reference hover preview", function () {
  let originalAddon: unknown;
  let doc: PreviewDocument;
  let source: PreviewElement;

  beforeEach(function () {
    originalAddon = (globalThis as any).addon;
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: () => [{ value: "公式预览", attributes: null }],
          },
        },
      },
    };
    doc = new PreviewDocument();
    source = doc.source();
  });

  afterEach(function () {
    doc.emit("pagehide", doc);
    (globalThis as any).addon = originalAddon;
  });

  it("lazily previews the referenced MathML and dismisses with Escape", async function () {
    doc.emit("pointerover", source.children[0]);
    assert.isUndefined(doc.preview);
    await wait(250);
    assert.isDefined(doc.preview);
    assert.notStrictEqual(
      doc.preview!.children[0],
      doc.body.querySelector("math"),
    );
    assert.equal(doc.preview!.children[0].tagName, "math");
    assert.equal(source.getAttribute("aria-describedby"), doc.preview!.id);
    doc.emit("keydown", source, { key: "Escape" });
    assert.isUndefined(doc.preview);
    assert.isNull(source.getAttribute("aria-describedby"));
    assert.equal(doc.observers.size, 0);
  });

  it("does not flash a preview when the pointer passes quickly", async function () {
    doc.emit("pointerover", source);
    doc.emit("pointerout", source, { relatedTarget: null });
    await wait(250);
    assert.isUndefined(doc.preview);
    assert.equal(doc.observers.size, 0);
  });

  it("allows entering and scrolling the preview, but closes on outside scrolling", async function () {
    doc.emit("focusin", source);
    const preview = doc.preview!;
    doc.emit("pointerout", source, { relatedTarget: null });
    doc.emit("pointerover", preview);
    await wait(180);
    assert.strictEqual(doc.preview, preview);
    doc.emit("scroll", preview);
    assert.strictEqual(doc.preview, preview);
    doc.emit("scroll", doc);
    assert.isUndefined(doc.preview);
  });

  it("keeps one preview and one listener set when moving between references", function () {
    doc.emit("focusin", source);
    const first = doc.preview!;
    const next = doc.source();
    next.setAttribute("data-theme", "dark");
    doc.emit("focusin", next);
    assert.isFalse(first.isConnected);
    assert.equal(doc.preview!.style.background, "#25272b");
    assert.isNull(source.getAttribute("aria-describedby"));
    assert.equal(doc.listeners.get("pointerover")!.length, 1);
    assert.equal(doc.observers.size, 1);
  });

  it("removes orphan previews and observers after a streaming rerender", function () {
    doc.emit("focusin", source);
    source.remove();
    for (const callback of [...doc.observers]) callback();
    assert.isUndefined(doc.preview);
    assert.equal(doc.observers.size, 0);
    assert.isNull(source.getAttribute("aria-describedby"));
  });

  it("closes when the referenced formula disappears while its reference remains", function () {
    doc.emit("focusin", source);
    doc.body.querySelector("math")!.parentElement!.remove();
    for (const callback of [...doc.observers]) callback();
    assert.isTrue(source.isConnected);
    assert.isUndefined(doc.preview);
    assert.equal(doc.observers.size, 0);
  });

  it("fits the preview within a narrow viewport and closes on resize", function () {
    doc.emit("focusin", source);
    const rect = doc.preview!.getBoundingClientRect();
    assert.isAtLeast(rect.left, 12);
    assert.isAtMost(rect.right, 308);
    assert.isAtLeast(rect.top, 12);
    assert.isAtMost(rect.bottom, 228);
    doc.emit("resize", doc);
    assert.isUndefined(doc.preview);
  });

  describe("equation number recognition", function () {
    it("does not confuse figure and table labels with equation references", function () {
      for (const prefix of [
        "如Fig. 2",
        "如 Fig. 2 ",
        "如 Figure 2 ",
        "见 FIG. 2(1)、",
        "如图2",
        "见图 2（1）、",
        "参见图 ",
        "表 2 ",
        "Table 2 ",
        "Figs. 2 and ",
        "算法 ",
        "Conv",
      ]) {
        assert.isFalse(isEquationReferenceContext(prefix), prefix);
      }
    });

    it("leaves title numbers, list markers, years and other non-equation contexts alone", function () {
      for (const prefix of [
        "",
        "  ",
        "标题 ",
        "步骤 ",
        "第一个模块 ",
        "文献 ",
        "Section ",
        "Chapter ",
        "Algorithm ",
        "定义 ",
        "例如 ",
        "普通方式 ",
        "输入格式 ",
        "训练模式 ",
        "Fig. 2 shows the result, which can be computed using ",
        "由公式 (2) 可知，第 ",
      ]) {
        assert.isFalse(isEquationReferenceContext(prefix), prefix);
      }
    });

    it("keeps equation references after figure discussions and in reference lists", function () {
      for (const prefix of [
        "最终如式 ",
        "由公式",
        "根据 Eq. ",
        "see Equation ",
        "Eqs. ",
        "式 (1)、",
        "由公式（1）、（2）和",
        "Eqs. (1)–",
        "Equations (1), (2) and ",
        "将其代入式",
        "该表达式 ",
        "另一个回答的式 ",
        "见下式 ",
        "该式子 ",
        "如图2所示，结合式 ",
        "Fig. 2 shows the result. As given in Eq. ",
      ]) {
        assert.isTrue(isEquationReferenceContext(prefix), prefix);
      }
    });

    it("recognizes explicit tags, suffixes and spaced trailing numbers", function () {
      assert.equal(
        getMathEquationNumber(String.raw`F_i=Conv(F)\tag{12}`),
        "12",
      );
      assert.equal(getMathEquationNumber(String.raw`a=b\tag*{(12a)}`), "12a");
      assert.equal(getMathEquationNumber(String.raw`a=b\tag{A.1}`), "a.1");
      assert.equal(getMathEquationNumber(String.raw`a=b\qquad (12)`), "12");
      assert.equal(
        getMathEquationNumber(String.raw`a=b\quad\text{(12)}`),
        "12",
      );
    });

    it("does not infer labels from function arguments or ordinary numbers", function () {
      for (const formula of [
        "f(12)",
        "x=12",
        "x+(12)",
        String.raw`\frac{1}{12}`,
      ]) {
        assert.isNull(getMathEquationNumber(formula));
      }
    });
  });
});
