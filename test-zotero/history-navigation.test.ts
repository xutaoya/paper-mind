import { assert } from "chai";
import { config } from "../package.json";
import type { ChatMessage } from "../src/types/chat";
import { lightTheme } from "../src/modules/ui/chat-panel/ChatPanelTheme";
import {
  cancelPendingHistoryRender,
  ensureRenderedMessage,
  findRenderedMessageElement,
  renderMessages,
  scrollMessageToViewportStart,
} from "../src/modules/ui/chat-panel/MessageRenderer";
import { navigateToQuotedMessage } from "../src/modules/ui/chat-panel/ChatPanelManager";

describe("target-first history navigation in Zotero", function () {
  this.timeout(10000);
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let doc: Document;
  let host: HTMLElement;
  let history: HTMLElement;
  let messages: ChatMessage[];
  const ids = () =>
    Array.from(
      history.querySelectorAll<HTMLElement>("[data-message-id]"),
      (element) => element.dataset.messageId!,
    );
  const frame = () =>
    new Promise<void>((resolve) =>
      doc.defaultView!.requestAnimationFrame(() => resolve()),
    );
  async function frames() {
    for (let index = 0; index < 5; index++) await frame();
  }

  before(function () {
    for (const name of ["addon", "ztoolkit"]) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () =>
          name === "addon"
            ? Zotero[config.addonInstance]
            : Zotero[config.addonInstance].data.ztoolkit,
      });
    }
  });

  after(function () {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  });

  beforeEach(function () {
    doc = Zotero.getMainWindow().document;
    host = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    host.className = "chat-container";
    Object.assign(host.style, {
      position: "fixed",
      left: "80px",
      top: "140px",
      width: "420px",
      height: "400px",
      zIndex: "10000",
      background: "white",
    });
    history = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    history.id = "chat-history";
    Object.assign(history.style, {
      height: "100%",
      overflow: "auto",
      padding: "16px",
      boxSizing: "border-box",
    });
    host.appendChild(history);
    doc.documentElement.appendChild(host);
    const answer =
      "## 论文分析\n\n**关键结论**：保留原有格式。\n\n$$x_{t-1}=\\frac{1}{\\sqrt{\\alpha_t}}(x_t-\\beta_t\\theta(x_t))+\\sigma_t z$$\n\n" +
      "这是需要完整显示的论文解释。\n\n".repeat(12);
    messages = Array.from({ length: 60 }, (_, index) => [
      {
        id: `user-${index}`,
        role: "user" as const,
        content: `第 ${index + 1} 个问题`,
        timestamp: 1,
      },
      {
        id: `assistant-${index}`,
        role: "assistant" as const,
        content: answer,
        timestamp: 1,
      },
    ]).flat();
    renderMessages(history, null, messages, lightTheme);
  });

  afterEach(function () {
    cancelPendingHistoryRender(history);
    host.remove();
  });

  it("paints the chosen message first and keeps real MathML while loading only neighbours", async function () {
    try {
      assert.lengthOf(ids(), 2);
      const target = await new Promise<HTMLElement | null>((resolve) => {
        ensureRenderedMessage(history, "assistant-5", resolve);
      });
      assert.isNotNull(target);
      assert.deepEqual(ids(), ["assistant-5", "user-59", "assistant-59"]);
      assert.isNotNull(
        target!.querySelector("math"),
        "math is rendered, not a raw LaTeX tail",
      );
      scrollMessageToViewportStart(history, "assistant-5");
      await frames();
      assert.deepEqual(ids(), [
        "user-5",
        "assistant-5",
        "user-6",
        "user-59",
        "assistant-59",
      ]);
      assert.lengthOf(history.querySelectorAll(".paperchat-history-gap"), 2);
    } catch (error) {
      throw readableError(error);
    }
  });

  it("keeps the selected short question at the same position when a long answer loads below it", async function () {
    try {
      await new Promise<void>((resolve) => {
        ensureRenderedMessage(history, "user-5", () => resolve());
      });
      const initialTarget = scrollMessageToViewportStart(history, "user-5")!;
      const targetTop = initialTarget.getBoundingClientRect().top;
      await frames();
      const target = findRenderedMessageElement(history, "user-5")!;
      assert.closeTo(
        target.getBoundingClientRect().top,
        targetTop,
        2,
        "context loading must not move the reading position",
      );
      assert.isNotNull(
        history.querySelector('[data-message-id="assistant-5"] math'),
      );
    } catch (error) {
      throw readableError(error);
    }
  });

  it("drops stale jumps, including a cancelled quote jump, without rebuilding history or showing an error", async function () {
    try {
      const errors: string[] = [];
      let rerenders = 0;
      const session = { id: "test-navigation", messages };
      const context = {
        container: host,
        chatManager: {
          getActiveSession: () => session,
          getSessionById: async () => session,
        },
        appendError: (error: string) => errors.push(error),
        renderMessages: () => {
          rerenders++;
        },
      };
      const quotedJump = navigateToQuotedMessage(context as any, {
        sessionId: session.id,
        messageId: "assistant-5",
        role: "assistant",
        preview: "论文解释",
        contentSnapshot: "论文解释",
        timestamp: 1,
      });
      // Allow session lookup to queue the quote's first render frame.
      await Promise.resolve();
      const target = await new Promise<HTMLElement | null>((resolve) => {
        ensureRenderedMessage(history, "user-20", resolve);
      });
      assert.isNotNull(target);
      scrollMessageToViewportStart(history, "user-20");
      assert.isFalse(await quotedJump);
      await frames();
      assert.isNull(findRenderedMessageElement(history, "assistant-5"));
      assert.isNotNull(findRenderedMessageElement(history, "user-20"));
      assert.lengthOf(errors, 0);
      assert.equal(rerenders, 0);
    } catch (error) {
      throw readableError(error);
    }
  });
});

function readableError(error: unknown): Error {
  const failure = new Error(String(error));
  Object.defineProperty(failure, "message", {
    value: String(error),
    enumerable: true,
  });
  return failure;
}
