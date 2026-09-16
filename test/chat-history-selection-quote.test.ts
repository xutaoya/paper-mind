import { assert } from "chai";
import { resolveAssistantSelectionQuote } from "../src/modules/ui/chat-panel/ChatHistorySelectionQuote.ts";

class FakeText {
  constructor(
    public data: string,
    public parent: FakeElement | null = null,
  ) {}

  get nodeType() {
    return 3;
  }

  get parentElement() {
    return this.parent;
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  textChild: FakeText | null = null;

  constructor(
    tag: string,
    options?: { class?: string; attrs?: Record<string, string> },
  ) {
    if (options?.class) {
      options.class.split(/\s+/).forEach((name) => this.classes.add(name));
    }
    this.attrs = { ...(options?.attrs || {}) };
    if (tag) {
      this.attrs.tag = tag;
    }
  }

  get nodeType() {
    return 1;
  }

  get parentElement() {
    return this.parent;
  }

  appendChild(child: FakeElement | FakeText): void {
    if (child instanceof FakeElement) {
      child.parent = this;
      this.children.push(child);
      return;
    }
    child.parent = this;
    this.textChild = child;
  }

  contains(node: FakeElement): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  closest(selector: string): FakeElement | null {
    const required = selector
      .split(".")
      .filter(Boolean)
      .map((token) => token.trim());
    const matches = required.every((token) => this.classes.has(token));
    if (matches) {
      return this;
    }
    return this.parent?.closest(selector) || null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith("[") && selector.endsWith("]")) {
      const attr = selector.slice(1, -1);
      const walk = (node: FakeElement): FakeElement | null => {
        if (node.attrs[attr]) return node;
        for (const child of node.children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    }
    return null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

class FakeSelection {
  isCollapsed = false;
  rangeCount = 1;
  anchorNode: FakeText | null = null;
  focusNode: FakeText | null = null;

  constructor(
    public excerpt: string,
    anchor: FakeText,
    focus: FakeText,
  ) {
    this.anchorNode = anchor;
    this.focusNode = focus;
  }

  toString(): string {
    return this.excerpt;
  }
}

describe("resolveAssistantSelectionQuote", function () {
  it("accepts selections inside a completed assistant reply", function () {
    const history = new FakeElement("div", { attrs: { id: "chat-history" } });
    const message = new FakeElement("div", {
      class: "chat-message assistant-message",
      attrs: { "data-message-id": "assistant-1" },
    });
    const bubble = new FakeElement("div", { class: "chat-bubble" });
    const text = new FakeText("Decoder D maps features back.");
    bubble.appendChild(text);
    message.appendChild(bubble);
    history.appendChild(message);

    const selection = new FakeSelection(
      "Decoder D",
      text,
      text,
    ) as unknown as Selection;

    const quote = resolveAssistantSelectionQuote(
      history as unknown as HTMLElement,
      selection,
    );
    assert.deepEqual(quote, {
      messageId: "assistant-1",
      excerpt: "Decoder D",
    });
  });

  it("accepts selections inside bookmark reader assistant sections", function () {
    const history = new FakeElement("div");
    const message = new FakeElement("section", {
      class: "paperchat-reader-section paperchat-reader-section--assistant",
      attrs: { "data-message-id": "assistant-reader" },
    });
    const body = new FakeElement("div", { class: "paperchat-reader-section-body" });
    const text = new FakeText("SSM branch output");
    body.appendChild(text);
    message.appendChild(body);
    history.appendChild(message);

    const selection = new FakeSelection(
      "SSM branch",
      text,
      text,
    ) as unknown as Selection;

    const quote = resolveAssistantSelectionQuote(
      history as unknown as HTMLElement,
      selection,
    );
    assert.deepEqual(quote, {
      messageId: "assistant-reader",
      excerpt: "SSM branch",
    });
  });

  it("rejects selections outside assistant replies or while streaming", function () {
    const history = new FakeElement("div");
    const userMessage = new FakeElement("div", {
      class: "chat-message user-message",
      attrs: { "data-message-id": "user-1" },
    });
    const userText = new FakeText("question");
    userMessage.appendChild(userText);
    history.appendChild(userMessage);

    const userSelection = new FakeSelection(
      "question",
      userText,
      userText,
    ) as unknown as Selection;
    assert.isNull(
      resolveAssistantSelectionQuote(
        history as unknown as HTMLElement,
        userSelection,
      ),
    );

    const streaming = new FakeElement("div", {
      class: "chat-message assistant-message",
      attrs: { "data-message-id": "assistant-stream" },
    });
    streaming.appendChild(
      new FakeElement("div", {
        attrs: { "data-streaming-content-for": "assistant-stream" },
      }),
    );
    const streamText = new FakeText("partial");
    streaming.appendChild(streamText);
    history.appendChild(streaming);

    const streamSelection = new FakeSelection(
      "partial",
      streamText,
      streamText,
    ) as unknown as Selection;
    assert.isNull(
      resolveAssistantSelectionQuote(
        history as unknown as HTMLElement,
        streamSelection,
      ),
    );
  });
});
