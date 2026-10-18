import { assert } from "chai";
import type { ChatMessage } from "../src/modules/chat/index.ts";
import { resolveConversationTurnSlice } from "../src/modules/chat/conversation-turn.ts";

function message(id: string, role: ChatMessage["role"]): ChatMessage {
  return {
    id,
    role,
    content: id,
    timestamp: 1,
  };
}

describe("conversation turn slice", function () {
  it("returns the user turn and following assistant/tool messages", function () {
    const messages = [
      message("user-1", "user"),
      message("assistant-1", "assistant"),
      message("user-2", "user"),
      message("tool-1", "tool"),
      message("assistant-2", "assistant"),
    ];

    assert.deepEqual(resolveConversationTurnSlice(messages, "assistant-1"), {
      start: 0,
      end: 2,
    });
    assert.deepEqual(resolveConversationTurnSlice(messages, "assistant-2"), {
      start: 2,
      end: 5,
    });
  });
});
