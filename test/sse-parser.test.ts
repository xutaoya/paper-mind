import { assert } from "chai";
import {
  parseSSEStream,
  parseSSEStreamWithToolCalling,
  type SSEToolCallingEvent,
} from "../src/modules/providers/SSEParser.ts";

function readerFromSSE(
  chunks: string[],
): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }).getReader();
}

describe("SSEParser", function () {
  it("keeps alternating Bailian answer and reasoning deltas in separate channels", async function () {
    const deltas = [
      { reasoning_content: "先检查论文。", content: null },
      { reasoning_content: null, content: "**Fig4" },
      { reasoning_content: "再核对训练步骤。", content: "**：训练流程。" },
      { reasoning_content: null, content: "完整结论。" },
    ];
    const chunks = deltas.map(
      (delta) =>
        `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`,
    );
    chunks.push(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    );
    const events: SSEToolCallingEvent[] = [];
    await parseSSEStreamWithToolCalling(readerFromSSE(chunks), "openai", {
      onEvent: (event) => events.push(event),
    });
    assert.equal(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.text)
        .join(""),
      "**Fig4**：训练流程。完整结论。",
    );
    assert.equal(
      events
        .filter((event) => event.type === "reasoning_delta")
        .map((event) => event.text)
        .join(""),
      "先检查论文。再核对训练步骤。",
    );
    assert.deepEqual(events.at(-1), { type: "done", stopReason: "stop" });

    const text: string[] = [];
    const reasoning: string[] = [];
    await parseSSEStream(readerFromSSE(chunks), "openai", {
      onText: (chunk) => text.push(chunk),
      onReasoning: (chunk) => reasoning.push(chunk),
      onDone: () => undefined,
    });
    assert.equal(text.join(""), "**Fig4**：训练流程。完整结论。");
    assert.equal(reasoning.join(""), "先检查论文。再核对训练步骤。");
  });

  it("preserves a final answer chunk and truncation signal without a trailing newline", async function () {
    const sse = `data: ${JSON.stringify({
      choices: [
        { delta: { content: "**Fig4**：最后一段。" }, finish_reason: "length" },
      ],
    })}`;
    const events: SSEToolCallingEvent[] = [];
    await parseSSEStreamWithToolCalling(readerFromSSE([sse]), "openai", {
      onEvent: (event) => events.push(event),
    });
    assert.deepEqual(events, [
      { type: "text_delta", text: "**Fig4**：最后一段。" },
      { type: "done", stopReason: "max_tokens" },
    ]);

    const text: string[] = [];
    await parseSSEStream(readerFromSSE([sse]), "openai", {
      onText: (chunk) => text.push(chunk),
      onDone: () => undefined,
    });
    assert.equal(text.join(""), "**Fig4**：最后一段。");
  });

  it("parses OpenAI-compatible tool calls packaged with finish_reason", async function () {
    const events: SSEToolCallingEvent[] = [];
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "",
              reasoning: "I should call the tool.",
              tool_calls: [
                {
                  index: 0,
                  id: "chatcmpl-tool-test",
                  type: "function",
                  function: {
                    name: "get_current_weather",
                    arguments: '{"location":"Shanghai, China"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];

    await parseSSEStreamWithToolCalling(readerFromSSE(sse), "openai", {
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events, [
      { type: "reasoning_delta", text: "I should call the tool." },
      {
        type: "tool_call_start",
        index: 0,
        id: "chatcmpl-tool-test",
        name: "get_current_weather",
      },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsDelta: '{"location":"Shanghai, China"}',
      },
      { type: "done", stopReason: "tool_calls" },
    ]);
  });

  it("keeps OpenAI-style split tool call chunks working", async function () {
    const events: SSEToolCallingEvent[] = [];
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "search" },
                },
              ],
            },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"query"' },
                },
              ],
            },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':"resnet"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];

    await parseSSEStreamWithToolCalling(readerFromSSE(sse), "openai", {
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events, [
      { type: "tool_call_start", index: 0, id: "call_1", name: "search" },
      { type: "tool_call_delta", index: 0, argumentsDelta: '{"query"' },
      { type: "tool_call_delta", index: 0, argumentsDelta: ':"resnet"}' },
      { type: "done", stopReason: "tool_calls" },
    ]);
  });

  it("ignores repeated OpenAI-compatible tool call starts for the same index", async function () {
    const events: SSEToolCallingEvent[] = [];
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "search", arguments: '{"query"' },
                },
              ],
            },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "search", arguments: ':"resnet"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}\n\n`,
    ];

    await parseSSEStreamWithToolCalling(readerFromSSE(sse), "openai", {
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events, [
      { type: "tool_call_start", index: 0, id: "call_1", name: "search" },
      { type: "tool_call_delta", index: 0, argumentsDelta: '{"query"' },
      { type: "tool_call_delta", index: 0, argumentsDelta: ':"resnet"}' },
      { type: "done", stopReason: "tool_calls" },
    ]);
  });

  it("reads OpenAI-compatible reasoning from delta.reasoning", async function () {
    const reasoning: string[] = [];
    const text: string[] = [];

    await parseSSEStream(
      readerFromSSE([
        `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { reasoning: "thinking", content: "answer" },
            },
          ],
        })}\n\n`,
        "data: [DONE]\n\n",
      ]),
      "openai",
      {
        onText: (chunk) => text.push(chunk),
        onReasoning: (text) => reasoning.push(text),
        onDone: () => undefined,
      },
    );

    assert.deepEqual(reasoning, ["thinking"]);
    assert.deepEqual(text, ["answer"]);
  });

  it("skips bare data: keep-alive lines without erroring the stream", async function () {
    const text: string[] = [];
    const errors: Error[] = [];
    let done = false;

    await parseSSEStream(
      readerFromSSE([
        "data:\n\n",
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: "after keep-alive" } }],
        })}\n\n`,
        "data:\n\n",
        "data: [DONE]\n\n",
      ]),
      "openai",
      {
        onText: (chunk) => text.push(chunk),
        onDone: () => {
          done = true;
        },
        onError: (error) => errors.push(error),
      },
    );

    assert.deepEqual(text, ["after keep-alive"]);
    assert.deepEqual(errors, []);
    assert.isTrue(done);
  });

  it("does not let Anthropic message_stop overwrite tool_use completion", async function () {
    const events: SSEToolCallingEvent[] = [];
    const sse = [
      `event: content_block_start\n`,
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "search",
        },
      })}\n\n`,
      `event: content_block_delta\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"query":"resnet"}',
        },
      })}\n\n`,
      `event: message_delta\n`,
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
      })}\n\n`,
      `event: message_stop\n`,
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ];

    await parseSSEStreamWithToolCalling(readerFromSSE(sse), "anthropic", {
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events, [
      { type: "tool_call_start", index: 0, id: "toolu_1", name: "search" },
      {
        type: "tool_call_delta",
        index: 0,
        argumentsDelta: '{"query":"resnet"}',
      },
      { type: "done", stopReason: "tool_calls" },
    ]);
  });

  it("maps OpenAI length finish_reason to max_tokens", async function () {
    const events: SSEToolCallingEvent[] = [];
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { content: "partial answer" },
            finish_reason: "length",
          },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];

    await parseSSEStreamWithToolCalling(readerFromSSE(sse), "openai", {
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events, [
      { type: "text_delta", text: "partial answer" },
      { type: "done", stopReason: "max_tokens" },
    ]);
  });
});
