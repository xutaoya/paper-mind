import { assert } from "chai";
import type { ChatMessage } from "../src/modules/chat/index.ts";
import {
  attachmentStateFromUserMessage,
  extractEditableUserMessageContent,
  findUserMessageIndex,
} from "../src/modules/chat/user-message-edit.ts";

function userMessage(
  id: string,
  content: string,
  extras: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: 1,
    ...extras,
  };
}

describe("user message edit helpers", function () {
  it("extracts the visible question from stored transport wrappers", function () {
    const message = userMessage(
      "user-1",
      '[Selected text from PDF]:\n"alpha"\n\n[Question]:\nWhat is 2D-SSM?',
      { selectedText: "alpha" },
    );

    assert.equal(extractEditableUserMessageContent(message), "What is 2D-SSM?");
  });

  it("restores attachments from the original user message", function () {
    const message = userMessage("user-1", "hello", {
      selectedText: "alpha",
      quotedMessages: [
        {
          messageId: "assistant-1",
          sessionId: "session-1",
          preview: "preview",
        },
      ],
      images: [{ data: "aW1n", mimeType: "image/png", name: "shot.png" }],
    });

    assert.deepEqual(attachmentStateFromUserMessage(message), {
      pendingImages: message.images,
      pendingFiles: [],
      pendingSelectedText: "alpha",
      pendingQuotedMessages: message.quotedMessages,
    });
  });

  it("finds a user message index in mixed history", function () {
    const messages: ChatMessage[] = [
      userMessage("user-1", "first"),
      { id: "assistant-1", role: "assistant", content: "ok", timestamp: 2 },
      userMessage("user-2", "second"),
    ];

    assert.equal(findUserMessageIndex(messages, "user-2"), 2);
    assert.equal(findUserMessageIndex(messages, "missing"), -1);
  });
});
