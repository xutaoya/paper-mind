import { assert } from "chai";
import { AgentRuntime } from "../src/modules/chat/agent-runtime/AgentRuntime.ts";
import { buildUserMessageContent } from "../src/modules/chat/user-message-content.ts";
import { AnthropicProvider } from "../src/modules/providers/AnthropicProvider.ts";
import {
  getContextManager,
  estimateRequestTokens,
  assertRequestFitsContext,
  buildSessionContextUsageMessages,
} from "../src/modules/chat/ContextManager.ts";
import { getProviderManager } from "../src/modules/providers/index.ts";
import type { ChatMessage, ChatSession } from "../src/types/chat";

const message = (
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage => ({ id, role, content, timestamp: 1 });
const session = (messages: ChatMessage[]): ChatSession => ({
  id: "integrity",
  messages,
  createdAt: 1,
  updatedAt: 1,
});

describe("chat request integrity", function () {
  let originalZotero: unknown;
  let originalToolkit: unknown;
  let manager: ReturnType<typeof getProviderManager>;
  let originalProvider: typeof manager.getActiveProvider;
  const prefs: Record<string, unknown> = {};

  beforeEach(function () {
    originalZotero = (globalThis as any).Zotero;
    originalToolkit = (globalThis as any).ztoolkit;
    Object.assign(prefs, {
      contextEnableSummary: true,
      contextAutoCompactWindowTokens: 40000,
      contextAutoCompactBufferTokens: 13000,
      contextMaxRecentPairs: 10,
    });
    (globalThis as any).Zotero = {
      Prefs: {
        get: (key: string) => prefs[key.split(".").at(-1)!],
        set: () => {},
      },
    };
    (globalThis as any).ztoolkit = { log: () => {} };
    manager = getProviderManager();
    originalProvider = manager.getActiveProvider;
    manager.getActiveProvider = () =>
      ({
        config: { id: "test", defaultModel: "test", maxTokens: 8192 },
        isReady: () => true,
      }) as any;
  });

  afterEach(function () {
    manager.getActiveProvider = originalProvider;
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).ztoolkit = originalToolkit;
  });

  it("combines selection, PDF, files and question without replacing any source", function () {
    const files = [
      { name: "notes.txt", content: "FILE_TEXT", type: "text" },
    ] as any;
    const content = buildUserMessageContent("QUESTION", {
      selectedText: "SELECTION",
      selectedFromPdf: true,
      pdfText: "PDF_TEXT",
      files,
    });
    for (const source of ["SELECTION", "PDF_TEXT", "FILE_TEXT", "QUESTION"])
      assert.include(content, source);
    assert.equal(content.split("QUESTION").length, 2);
    const payload = message("user", "user", content);
    assert.isBelow(
      estimateRequestTokens([{ ...payload, files }]) -
        estimateRequestTokens([payload]),
      30,
    );
  });

  it("checks tools and system context even when conversation alone fits", function () {
    const messages = [message("user", "user", "hello")];
    assert.doesNotThrow(() =>
      assertRequestFitsContext(messages, session(messages)),
    );
    assert.throws(
      () =>
        assertRequestFitsContext(messages, session(messages), [
          { description: "x".repeat(100000) },
        ]),
      "上下文预算",
    );
    assert.throws(
      () =>
        assertRequestFitsContext(
          messages,
          session(messages),
          [],
          "x".repeat(100000),
        ),
      "上下文预算",
    );
  });

  it("chunks a single oversized old message, retaining its tail and the latest question", async function () {
    const oldContent = "中".repeat(65000) + "TAIL_MARKER";
    const chat = session([
      message("old", "user", oldContent),
      message("answer", "assistant", "answer"),
      message("latest", "user", "KEEP_QUESTION"),
    ]);
    const requests: ChatMessage[][] = [];
    const provider = {
      ...manager.getActiveProvider()!,
      chatCompletion: async (messages: ChatMessage[]) => {
        requests.push(messages);
        return "A concise summary.";
      },
    };
    assert.isTrue(
      await getContextManager().compactBeforeSendIfNeeded(chat, undefined, {
        provider,
      }),
    );
    assert.isAbove(requests.length, 1);
    assert.isTrue(
      requests.some((batch) =>
        batch.some((msg) => msg.content.includes("TAIL_MARKER")),
      ),
    );
    assert.notInclude(chat.contextSummary!.coveredMessageIds, "latest");
    assert.equal(chat.messages[0].content, oldContent);
    assert.include(
      buildSessionContextUsageMessages(chat).map((msg) => msg.id),
      "latest",
    );
    assert.notInclude(
      buildSessionContextUsageMessages(chat).map((msg) => msg.id),
      "old",
    );
  });

  it("compacts for added request context and removes complete historical tool pairs", async function () {
    const chat = session([
      message("old", "user", "x".repeat(20000)),
      message("answer", "assistant", "answer"),
      {
        ...message("call", "assistant", ""),
        apiOnly: true,
        tool_calls: [
          {
            id: "tc",
            type: "function",
            function: { name: "get_pages", arguments: "{}" },
          },
        ],
      },
      {
        ...message("result", "tool", "source"),
        apiOnly: true,
        tool_call_id: "tc",
      },
      message("latest", "user", "KEEP"),
    ]);
    const provider = {
      ...manager.getActiveProvider()!,
      chatCompletion: async () => "Summary",
    };
    assert.isFalse(
      await getContextManager().compactBeforeSendIfNeeded(chat, undefined, {
        provider,
      }),
    );
    assert.isTrue(
      await getContextManager().compactBeforeSendIfNeeded(chat, undefined, {
        provider,
        additionalTokens: 15000,
      }),
    );
    const ids = buildSessionContextUsageMessages(chat).map((msg) => msg.id);
    assert.notInclude(ids, "call");
    assert.notInclude(ids, "result");
    assert.include(ids, "latest");
  });

  it("keeps original coverage if any summary chunk fails", async function () {
    const chat = session([
      message("old", "user", "中".repeat(65000)),
      message("latest", "user", "KEEP"),
    ]);
    let calls = 0;
    const provider = {
      ...manager.getActiveProvider()!,
      chatCompletion: async () => {
        if (++calls === 2) throw new Error("network");
        return "Summary";
      },
    };
    assert.isFalse(
      await getContextManager().compactBeforeSendIfNeeded(chat, undefined, {
        provider,
      }),
    );
    assert.isUndefined(chat.contextSummary);
    assert.isFalse(chat.contextState!.summaryInProgress);
  });

  it("cancels summary work without committing partial coverage", async function () {
    const chat = session([
      message("old", "user", "中".repeat(65000)),
      message("latest", "user", "KEEP"),
    ]);
    const controller = new AbortController();
    let calls = 0;
    const provider = {
      ...manager.getActiveProvider()!,
      chatCompletion: async (
        _messages: ChatMessage[],
        signal?: AbortSignal,
      ) => {
        assert.strictEqual(signal, controller.signal);
        calls++;
        controller.abort();
        return "Summary";
      },
    };
    try {
      await getContextManager().compactBeforeSendIfNeeded(chat, undefined, {
        provider,
        abortSignal: controller.signal,
      });
      assert.fail("Expected cancellation");
    } catch (error) {
      assert.equal((error as Error).name, "AbortError");
    }
    assert.equal(calls, 1);
    assert.isUndefined(chat.contextSummary);
  });

  for (const streaming of [false, true]) {
    const mode = streaming ? "streaming" : "non-streaming";

    it(`keeps PDF request options throughout ${mode} tool rounds`, async function () {
      const chat = session([message("user", "user", "read paper")]);
      const assistant = message("assistant", "assistant", "");
      chat.messages.push(assistant);
      const requestOptions = {
        pdfAttachment: {
          data: "PDF",
          mimeType: "application/pdf",
          name: "paper.pdf",
        },
        pdfAttachmentMessageId: "user",
      };
      const received: any[] = [];
      const runtime = new AgentRuntime(
        {
          updateMessageContent: async () => {},
          updateSessionMeta: async () => {},
          saveSession: async () => {},
        } as any,
        {
          isSessionActive: () => false,
          isSessionTracked: () => true,
          formatToolCallCard: () => "",
          generateId: (() => {
            let id = 0;
            return () => `generated-${++id}`;
          })(),
        } as any,
        {
          createExecutionBatches: (requests: any[]) => [requests],
          executeBatch: async (requests: any[]) =>
            requests.map((request) => ({
              toolCall: request.toolCall,
              status: "completed",
              content: "paper text",
            })),
        } as any,
      ) as any;
      runtime.getMaxIterations = () => 2;
      const result = (options: any) => {
        received.push(options);
        return received.length === 1
          ? {
              content: "",
              toolCalls: [
                {
                  id: "read",
                  type: "function",
                  function: { name: "get_pages", arguments: '{"pages":"1"}' },
                },
              ],
              stopReason: "tool_calls",
            }
          : { content: "Final answer", stopReason: "end_turn" };
      };
      const provider = {
        config: { id: "test", type: "anthropic", defaultModel: "test" },
        chatCompletionWithTools: async (
          _messages: unknown,
          _tools: unknown,
          _signal: unknown,
          options: unknown,
        ) => result(options),
        streamChatCompletionWithTools: async (
          _messages: unknown,
          _tools: unknown,
          callbacks: any,
          _signal: unknown,
          options: unknown,
        ) => callbacks.onComplete(result(options)),
      };
      const options = {
        provider,
        requestOptions,
        currentMessages: [...chat.messages],
        assistantMessage: assistant,
        pdfWasAttached: true,
        summaryTriggered: false,
        tools: [
          {
            type: "function",
            function: {
              name: "get_pages",
              description: "read",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        sendingSession: chat,
      };
      if (streaming) await runtime.executeStreamingToolLoop(options);
      else await runtime.executeNonStreamingToolLoop(options);
      assert.lengthOf(received, 2);
      for (const request of received) {
        assert.strictEqual(request.pdfAttachment, requestOptions.pdfAttachment);
        assert.equal(request.pdfAttachmentMessageId, "user");
      }
    });
  }

  for (const streaming of [false, true]) {
    const mode = streaming ? "streaming" : "non-streaming";

    it(`sends raw PDF on the correct user message (${mode})`, async function () {
      const provider = new AnthropicProvider({
        id: "test",
        name: "test",
        type: "anthropic",
        enabled: true,
        isBuiltin: false,
        order: 0,
        apiKey: "test",
        baseUrl: "https://example.test",
        defaultModel: "test",
        availableModels: ["test"],
      });
      const originalFetch = globalThis.fetch;
      const requests: any[] = [];
      globalThis.fetch = async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return streaming
          ? new Response(
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                content: [{ type: "text", text: "ok" }],
                stop_reason: "end_turn",
              }),
              { status: 200 },
            );
      };
      const messages = [
        message("old", "user", "old"),
        message("answer", "assistant", "answer"),
        message("current", "user", "read PDF"),
        { ...message("tool", "tool", "result"), tool_call_id: "tc" },
      ];
      const options = {
        pdfAttachment: {
          data: "JVBERi0=",
          mimeType: "application/pdf",
          name: "paper.pdf",
        },
        pdfAttachmentMessageId: "current",
      };
      try {
        if (streaming)
          await provider.streamChatCompletionWithTools(
            messages,
            [],
            {
              onChunk: () => {},
              onComplete: () => {},
              onError: (error) => {
                throw error;
              },
            } as any,
            undefined,
            options,
          );
        else
          await provider.chatCompletionWithTools(
            messages,
            [],
            undefined,
            options,
          );
        assert.equal(requests.length, 1);
        assert.equal(requests[0].messages[0].content, "old");
        assert.equal(requests[0].messages[2].content[0].type, "document");
        assert.equal(
          requests[0].messages[2].content[0].source.data,
          "JVBERi0=",
        );
        assert.equal(requests[0].messages[3].content[0].type, "tool_result");
        assert.equal(messages[2].content, "read PDF");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});
