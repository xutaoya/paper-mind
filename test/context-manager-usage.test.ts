import { assert } from "chai";
import type { ChatMessage, ChatSession } from "../src/types/chat.ts";
import {
  buildSessionContextUsageMessages,
  getSessionContextUsage,
} from "../src/modules/chat/ContextManager.ts";

function createSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "session-usage-test",
    title: "usage",
    messages,
    createdAt: 1,
    updatedAt: 2,
  };
}

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: "user", content, timestamp: 1 };
}

function assistantMessage(id: string, content: string): ChatMessage {
  return { id, role: "assistant", content, timestamp: 2 };
}

function toolMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: "tool",
    content,
    timestamp: 3,
    tool_call_id: "tool-call-1",
  };
}

describe("session context usage", function () {
  it("drops compacted history including intermediate tool messages", function () {
    const long = "token ".repeat(800);
    const session = createSession([
      userMessage("user-old", long),
      assistantMessage("assistant-old", long),
      toolMessage("tool-old", long),
      userMessage("user-new", "recent question"),
      assistantMessage("assistant-new", "recent answer"),
    ]);

    const beforeCompaction = getSessionContextUsage(session)?.usedTokens ?? 0;

    session.contextSummary = {
      id: "summary-1",
      content: "Older turns were about tooling and retrieval.",
      coveredMessageIds: ["user-old", "assistant-old", "tool-old"],
      createdAt: 10,
      messageCountAtCreation: session.messages.length,
      estimatedTokensAtCreation: beforeCompaction,
    };

    const afterCompaction = getSessionContextUsage(session)?.usedTokens ?? 0;
    const usageMessages = buildSessionContextUsageMessages(session).map(
      (message) => message.id,
    );

    assert.isBelow(afterCompaction, beforeCompaction);
    assert.deepEqual(usageMessages, ["user-new", "assistant-new"]);
  });

  it("ignores empty in-progress assistant placeholders", function () {
    const session = createSession([
      userMessage("user-1", "hello"),
      {
        id: "assistant-placeholder",
        role: "assistant",
        content: "",
        streamingState: "in_progress",
        timestamp: 2,
      },
    ]);

    const usage = getSessionContextUsage(session);
    const messageIds = buildSessionContextUsageMessages(session).map(
      (message) => message.id,
    );

    assert.isAbove(usage?.usedTokens ?? 0, 0);
    assert.deepEqual(messageIds, ["user-1"]);
  });
});
