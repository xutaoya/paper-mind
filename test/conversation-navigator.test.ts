import { assert } from "chai";
import type { ChatMessage } from "../src/modules/chat/index.ts";
import {
  buildConversationTurns,
  buildMessagePreview,
  resolveActiveRailItemId,
  resolveActiveTurnIndex,
  resolveEvenTurnRailRatio,
  resolvePreviewRailTickScale,
  resolveRailFocusIndex,
  resolveRailTickVisual,
  truncateConversationPreview,
  truncateMessageText,
} from "../src/modules/ui/chat-panel/ConversationNavigator.ts";

function message(
  id: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "user",
    content: "hello",
    timestamp: 1,
    ...overrides,
  };
}

describe("conversation navigator", function () {
  it("groups visible user turns with the first assistant preview", function () {
    const turns = buildConversationTurns([
      message("user-1", { content: "First question" }),
      message("assistant-1", {
        role: "assistant",
        content: "First answer",
      }),
      message("tool-1", {
        role: "tool",
        content: "tool output",
        tool_call_id: "call-1",
      }),
      message("assistant-2", {
        role: "assistant",
        content: "Second answer",
      }),
      message("user-2", { content: "Follow up" }),
      message("assistant-3", {
        role: "assistant",
        content: "Follow up answer",
      }),
      message("hidden", {
        role: "assistant",
        content: "hidden",
        apiOnly: true,
      }),
    ]);

    assert.lengthOf(turns, 2);
    assert.equal(turns[0].anchorMessageId, "user-1");
    assert.equal(turns[0].userPreview, "First question");
    assert.equal(turns[0].assistantPreview, "First answer");
    assert.equal(turns[1].anchorMessageId, "user-2");
    assert.equal(turns[1].assistantPreview, "Follow up answer");
  });

  it("builds beUI-style preview labels and descriptions", function () {
    const preview = buildMessagePreview(
      "Short question",
      "Short assistant answer",
    );
    assert.equal(preview.label, "Short question");
    assert.equal(preview.description, "Short assistant answer");

    const longUser = `${"question ".repeat(12).trim()} extra words`;
    const longPreview = buildMessagePreview(longUser, "Assistant body");
    assert.match(longPreview.label, /…$/);
    assert.equal(longPreview.description, "Assistant body");
  });

  it("strips tool-call markup from previews", function () {
    const turns = buildConversationTurns([
      message("user-1", { content: "Make slides" }),
      message("assistant-1", {
        role: "assistant",
        content:
          '<tool-call status="calling"><tool-name>presentation</tool-name></tool-call>Generating',
      }),
    ]);

    assert.equal(turns[0].assistantPreview, "Generating");
  });

  it("truncates long previews with an ellipsis", function () {
    const preview = truncateMessageText("a".repeat(90), 20);
    assert.isAtMost(preview.length, 21);
    assert.match(preview, /…$/);
    assert.equal(
      truncateConversationPreview("hello world"),
      truncateMessageText("hello world", 88),
    );
  });

  it("spaces turn ticks evenly along the rail", function () {
    assert.equal(resolveEvenTurnRailRatio(0, 4), 0);
    assert.equal(resolveEvenTurnRailRatio(3, 4), 1);
    assert.equal(resolveEvenTurnRailRatio(0, 1), 0.5);
  });

  it("prefers hover focus over scroll-active focus", function () {
    assert.equal(resolveRailFocusIndex(2, 4), 4);
    assert.equal(resolveRailFocusIndex(2, -1), 2);
  });

  it("scales nearby ticks into a hover pyramid", function () {
    assert.equal(resolvePreviewRailTickScale(2, 2), 1);
    assert.equal(resolvePreviewRailTickScale(1, 2), 0.68);
    assert.equal(resolvePreviewRailTickScale(0, 2), 0.44);
    assert.equal(resolvePreviewRailTickScale(5, 2), 0.25);
  });

  it("uses compact ticks while idle and expands them when engaged", function () {
    const idle = resolveRailTickVisual({
      index: 1,
      activeIndex: 1,
      focusIndex: 1,
      engaged: false,
    });
    const idleInactive = resolveRailTickVisual({
      index: 0,
      activeIndex: 1,
      focusIndex: 1,
      engaged: false,
    });
    const engaged = resolveRailTickVisual({
      index: 1,
      activeIndex: 1,
      focusIndex: 1,
      engaged: true,
    });

    assert.equal(idle.width, 6);
    assert.isBelow(idleInactive.opacity, idle.opacity);
    assert.isAbove(engaged.width, idle.width);
    assert.equal(engaged.opacity, 1);
  });

  it("resolves the active rail item from the viewport center", function () {
    const turns = buildConversationTurns([
      message("user-1", { content: "One" }),
      message("user-2", { content: "Two" }),
      message("user-3", { content: "Three" }),
    ]);
    const items = turns.map((turn, index) => ({
      id: turn.anchorMessageId,
      label: turn.userPreview,
      ariaLabel: `message ${index + 1}`,
    }));

    const makeMessageElement = (id: string, top: number) => ({
      getAttribute: (name: string) => (name === "data-message-id" ? id : null),
      getBoundingClientRect: () => ({
        top,
        height: 80,
        bottom: top + 80,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }),
    });

    const history = {
      scrollTop: 250,
      scrollHeight: 800,
      clientHeight: 200,
      children: [
        makeMessageElement("user-1", 120),
        makeMessageElement("user-2", 180),
        makeMessageElement("user-3", 320),
      ],
      getBoundingClientRect: () => ({
        top: 100,
        height: 200,
        bottom: 300,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLElement;

    assert.equal(resolveActiveRailItemId(items, history), "user-2");
    assert.equal(resolveActiveTurnIndex(turns, history), 1);
  });
});
