import { assert } from "chai";
import { NextQuestionHintController } from "../src/modules/ui/chat-panel/NextQuestionHintController.ts";
import { getNextQuestionHintService } from "../src/modules/chat/next-question-hint/index.ts";
import type { ChatPanelContext } from "../src/modules/ui/chat-panel/types.ts";

class HintElement {
  readonly style = {
    display: "",
    position: "",
    setProperty: (_name: string, _value: string) => undefined,
  };
  readonly attributes = new Map<string, string>();
  readonly children: HintElement[] = [];
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  parentNode: HintElement | null = null;
  id = "";
  className = "";
  textContent = "";
  value = "";
  placeholder = "询问关于论文的问题…";
  isConnected = true;
  selectionStart = 0;
  selectionEnd = 0;

  constructor(readonly ownerDocument: HintDocument) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: HintElement): void {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
  }

  insertBefore(child: HintElement, anchor: HintElement): void {
    child.remove();
    child.parentNode = this;
    this.children.splice(this.children.indexOf(anchor), 0, child);
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.children.splice(
        this.parentNode.children.indexOf(this),
        1,
      );
    }
    this.parentNode = null;
  }

  get nextElementSibling(): HintElement | null {
    const siblings = this.parentNode?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  querySelectorAll(selector: string): HintElement[] {
    return this.children.flatMap((child) => [
      ...(selector === `#${child.id}` ||
      (selector.startsWith("[") && child.attributes.has(selector.slice(1, -1)))
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector: string): HintElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector: string): HintElement | null {
    return selector === `#${this.id}`
      ? this
      : this.parentNode?.closest(selector) || null;
  }

  contains(node: HintElement): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }

  getBoundingClientRect() {
    return { width: 300, height: 44 };
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, details: Record<string, unknown> = {}) {
    const event = {
      type,
      target: this,
      button: 0,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation: () => undefined,
      stopImmediatePropagation: () => undefined,
      ...details,
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
    return event;
  }

  dispatchEvent(event: Event): boolean {
    return !this.emit(event.type).defaultPrevented;
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
    this.emit("focus");
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class HintDocument {
  activeElement: HintElement | null = null;
  readonly frames: Array<() => void> = [];
  readonly defaultView = {
    Event,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    requestAnimationFrame: (callback: () => void) => this.frames.push(callback),
  };

  createElement(): HintElement {
    return new HintElement(this);
  }

  flushFrames(): void {
    this.frames.splice(0).forEach((callback) => callback());
  }
}

describe("next question hint interactions", function () {
  let service: ReturnType<typeof getNextQuestionHintService>;
  let originalAddon: unknown;
  let originalNow: typeof Date.now;
  let originalAccepted: typeof service.markAccepted;
  let originalDismissed: typeof service.markDismissed;
  let now: number;
  let doc: HintDocument;
  let container: HintElement;
  let input: HintElement;
  let controller: NextQuestionHintController;
  let layer: HintElement;
  let session: { id: string; messages: any[] };
  let context: ChatPanelContext;
  let accepted: number;
  let inputEvents: number;
  const text = "这篇论文的方法有哪些局限？";

  beforeEach(function () {
    service = getNextQuestionHintService();
    originalAddon = (globalThis as any).addon;
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: (requests: Array<{ id: string }>) =>
              requests.map(({ id }) => ({ value: id, attributes: null })),
          },
        },
      },
    };
    originalNow = Date.now;
    now = 1_000_000;
    Date.now = () => now;
    originalAccepted = service.markAccepted;
    originalDismissed = service.markDismissed;
    accepted = 0;
    service.markAccepted = () => accepted++;
    service.markDismissed = () => undefined;
    doc = new HintDocument();
    container = new HintElement(doc);
    const wrapper = new HintElement(doc);
    wrapper.id = "chat-input-wrapper";
    input = new HintElement(doc);
    input.id = "chat-message-input";
    wrapper.appendChild(input);
    container.appendChild(wrapper);
    session = {
      id: "session-1",
      messages: [{ id: "assistant-1", role: "assistant", timestamp: now }],
    };
    (container as any).__paperchatNextQuestionHintState = {
      id: "hint-1",
      text,
      sessionId: session.id,
      assistantMessageId: "assistant-1",
      createdAt: now,
      expiresAt: now + 120_000,
    };
    context = {
      container,
      getTheme: () => ({}),
      chatManager: { getActiveSession: () => session },
    } as unknown as ChatPanelContext;
    controller = NextQuestionHintController.attach(context)!;
    layer = container.querySelector("#chat-next-question-hint")!;
    inputEvents = 0;
    input.addEventListener("input", () => inputEvents++);
  });

  afterEach(function () {
    controller.dispose();
    Date.now = originalNow;
    service.markAccepted = originalAccepted;
    service.markDismissed = originalDismissed;
    (globalThis as any).addon = originalAddon;
  });

  it("accepts clicks without global browser event constructors", function () {
    assert.doesNotThrow(() => layer.emit("click"));
    assert.equal(input.value, text);
    assert.equal(input.selectionStart, text.length);
    assert.equal(inputEvents, 1);
    assert.equal(accepted, 1);
  });

  it("keeps a displayed hint usable after two minutes when focusing and pressing Tab", function () {
    now += 5 * 60_000;
    input.focus();
    doc.flushFrames();
    assert.equal(layer.style.display, "flex");
    const event = input.emit("keydown", { key: "Tab" });
    assert.isTrue(event.defaultPrevented);
    assert.equal(input.value, text);
  });

  it("accepts a still-visible hint by mouse after two minutes", function () {
    now += 5 * 60_000;
    layer.emit("mousedown");
    layer.emit("click");
    assert.equal(input.value, text);
    assert.equal(accepted, 1);
    assert.equal(inputEvents, 1);
  });

  it("keeps the hint visible on immediate focus without filling automatically", function () {
    input.focus();
    doc.flushFrames();
    assert.equal(input.value, "");
    assert.equal(layer.style.display, "flex");
    assert.equal(input.emit("keydown", { key: "Tab" }).defaultPrevented, true);
    assert.equal(input.value, text);
  });

  it("ignores right-clicks but supports keyboard activation of the hint", function () {
    layer.emit("mousedown", { button: 2 });
    layer.emit("click", { button: 2 });
    assert.equal(input.value, "");
    layer.emit("keydown", { key: "Enter" });
    assert.equal(input.value, text);
  });

  it("dismisses on Escape or typing without overwriting the user's text", function () {
    input.emit("keydown", { key: "Escape" });
    assert.equal(layer.style.display, "none");
    assert.equal(input.placeholder, "询问关于论文的问题…");
    input.value = "我自己的问题";
    input.emit("input");
    input.emit("keydown", { key: "Tab" });
    assert.equal(input.value, "我自己的问题");
    assert.equal(accepted, 0);
  });

  it("does not intercept Shift-Tab or IME composition", function () {
    input.emit("keydown", { key: "Tab", shiftKey: true });
    input.emit("compositionstart");
    input.emit("keydown", { key: "Tab" });
    assert.equal(input.value, "");
    input.emit("compositionend");
    input.emit("keydown", { key: "Tab", isComposing: true });
    assert.equal(input.value, "");
    input.emit("keydown", { key: "Tab" });
    assert.equal(input.value, text);
  });

  it("invalidates hints when the active conversation changes", function () {
    session = { id: "session-2", messages: [] };
    layer.emit("mousedown");
    assert.equal(input.value, "");
    assert.equal(layer.style.display, "none");
    assert.equal(accepted, 0);
  });

  it("invalidates a hint when a newer user turn starts", function () {
    session.messages.push({ id: "user-2", role: "user" });
    input.focus();
    doc.flushFrames();
    assert.equal(layer.style.display, "none");
    assert.isFalse(input.emit("keydown", { key: "Tab" }).defaultPrevented);
  });

  it("preserves displayed hints across composer reattachment after two minutes", function () {
    now += 5 * 60_000;
    controller = NextQuestionHintController.attach(context)!;
    layer = container.querySelector("#chat-next-question-hint")!;
    input.focus();
    input.emit("keydown", { key: "Tab" });
    assert.equal(input.value, text);
  });
});
