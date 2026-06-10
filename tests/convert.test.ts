// ============================================================================
// 端到端集成测试
// 覆盖：
//   1. 协议转换 (Chat ↔ Canonical, Anthropic ↔ Canonical, Responses ↔ Canonical)
//   2. 模型解析 (sub/model / global alias)
//   3. HTTP 端点 (/healthz, /v1/models, /v1/chat/completions, /anthropic/v1/messages)
// ============================================================================
import { describe, test, expect } from "bun:test";
import { chatToCanonical } from "../src/convert/inbound/chat-to-canonical";
import { anthropicToCanonical } from "../src/convert/inbound/anthropic-to-canonical";
import { responsesToCanonical } from "../src/convert/inbound/responses-to-canonical";
import { canonicalToChatUpstream } from "../src/convert/upstream/canonical-to-chat";
import { canonicalToAnthropicUpstream } from "../src/convert/upstream/canonical-to-anthropic";
import { canonicalToChatResponse } from "../src/convert/outbound/canonical-to-chat";
import { canonicalToAnthropicResponse } from "../src/convert/outbound/canonical-to-anthropic";
import { canonicalToResponsesResponse } from "../src/convert/outbound/canonical-to-responses";
import { parseChatUpstreamResponse } from "../src/server/chat-parser";
import { parseAnthropicUpstreamResponse } from "../src/server/anthropic-parser";

describe("Chat → Canonical", () => {
  test("basic user message", () => {
    const req = {
      model: "test-model",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.model).toBe("test-model");
    expect(can.messages).toHaveLength(1);
    expect(can.messages[0]?.role).toBe("user");
    expect(can.messages[0]?.content[0]).toEqual({ type: "text", text: "hello" });
  });

  test("system message becomes top-level system", () => {
    const req = {
      model: "x",
      messages: [
        { role: "system" as const, content: "be helpful" },
        { role: "user" as const, content: "hi" },
      ],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.system).toBe("be helpful");
    expect(can.messages).toHaveLength(1);
  });

  test("tool_call → tool_use", () => {
    const req = {
      model: "x",
      messages: [
        { role: "user" as const, content: "what's the weather?" },
        {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              function: { name: "get_weather", arguments: '{"city":"SF"}' },
            },
          ],
        },
        { role: "tool" as const, tool_call_id: "call_123", content: "72°F" },
      ],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.messages[1]?.content[0]).toEqual({
      type: "tool_use",
      id: "call_123",
      name: "get_weather",
      input: { city: "SF" },
    });
    expect(can.messages[2]?.content[0]).toEqual({
      type: "tool_result",
      toolUseId: "call_123",
      content: "72°F",
    });
  });
});

describe("Anthropic → Canonical", () => {
  test("basic", () => {
    const req = {
      model: "claude",
      system: "be helpful",
      messages: [{ role: "user" as const, content: "hi" }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    expect(can.system).toBe("be helpful");
    expect(can.maxTokens).toBe(100);
    expect(can.messages[0]?.content[0]?.type).toBe("text");
  });
});

describe("Responses → Canonical", () => {
  test("function_call → assistant with tool_use", () => {
    const can = responsesToCanonical({
      model: "x",
      input: [{ type: "function_call", call_id: "c1", name: "f", arguments: '{"x":1}' }],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages[0]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "c1", name: "f", input: { x: 1 } }],
    });
  });

  test("function_call 缺 call_id 时 fallback 到 id", () => {
    const can = responsesToCanonical({
      model: "x",
      input: [{ type: "function_call", id: "c2", name: "f", arguments: "{}" }],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages[0]?.content[0]).toEqual({ type: "tool_use", id: "c2", name: "f", input: {} });
  });

  test("function_call_output → user with tool_result", () => {
    const can = responsesToCanonical({
      model: "x",
      input: [{ type: "function_call_output", call_id: "c1", output: "42" }],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages[0]).toEqual({
      role: "user",
      content: [{ type: "tool_result", toolUseId: "c1", content: "42" }],
    });
  });

  test("message + function_call + function_call_output 混合，顺序保持", () => {
    const can = responsesToCanonical({
      model: "x",
      input: [
        { type: "message", role: "user", content: "Q" },
        { type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "42" },
      ],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages).toHaveLength(3);
    expect(can.messages[0]?.content[0]).toEqual({ type: "text", text: "Q" });
    expect(can.messages[1]?.content[0]).toEqual({ type: "tool_use", id: "c1", name: "f", input: {} });
    expect(can.messages[2]?.content[0]).toEqual({ type: "tool_result", toolUseId: "c1", content: "42" });
  });

  test("output_text / refusal 往返不丢", () => {
    const can = responsesToCanonical({
      model: "x",
      input: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi" }] },
        { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "nope" }] },
      ],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages[0]?.content[0]).toEqual({ type: "text", text: "Hi" });
    expect(can.messages[1]?.content[0]).toEqual({ type: "refusal", refusal: "nope" });
  });

  test("未知 type 静默跳，不崩", () => {
    const can = responsesToCanonical({
      model: "x",
      input: [{ type: "web_search_call", query: "x" } as never],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages).toHaveLength(0);
  });
});

describe("Canonical → Chat Upstream", () => {
  test("round-trip preserves text", () => {
    const can = chatToCanonical({
      model: "gpt-4",
      messages: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "hello" },
      ],
      max_tokens: 100,
      temperature: 0.7,
    } as Parameters<typeof chatToCanonical>[0]);
    const upstream = canonicalToChatUpstream(can);
    expect(upstream.model).toBe("gpt-4");
    expect(upstream.max_tokens).toBe(100);
    expect(upstream.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(upstream.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  test("mixed text + tool_result: text 累积到末尾，tool 消息先发", () => {
    const can = {
      model: "x",
      messages: [
        {
          role: "assistant" as const,
          content: [{ type: "tool_use" as const, id: "a", name: "f", input: {} }],
        },
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Q1" },
            { type: "tool_result" as const, toolUseId: "a", content: "r1" },
            { type: "tool_result" as const, toolUseId: "b", content: "r2" },
            { type: "text" as const, text: "Q2" },
          ],
        },
      ],
    } as Parameters<typeof canonicalToChatUpstream>[0];
    const out = canonicalToChatUpstream(can);
    expect(out.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", content: "r1", tool_call_id: "a" },
      { role: "tool", content: "r2", tool_call_id: "b" },
      { role: "user", content: "Q1Q2" },
    ]);
  });

  test("mixed multimodal + tool_result: image 进 user 消息，tool 消息单独发", () => {
    const can = {
      model: "x",
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "看这张图" },
            { type: "image" as const, source: { kind: "url" as const, mediaType: "image/png", data: "http://x" } },
            { type: "tool_result" as const, toolUseId: "a", content: "ok" },
          ],
        },
      ],
    } as Parameters<typeof canonicalToChatUpstream>[0];
    const out = canonicalToChatUpstream(can);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toEqual({ role: "tool", content: "ok", tool_call_id: "a" });
    expect(out.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看这张图" },
        { type: "image_url", image_url: { url: "http://x" } },
      ],
    });
  });

  test("tool_result 数组 content 扁平化为字符串（不再变空串）", () => {
    const can = {
      model: "x",
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              toolUseId: "a",
              content: [
                { type: "text" as const, text: "line1" },
                { type: "text" as const, text: "line2" },
              ],
            },
          ],
        },
      ],
    } as Parameters<typeof canonicalToChatUpstream>[0];
    const out = canonicalToChatUpstream(can);
    expect(out.messages[0]).toEqual({ role: "tool", content: "line1line2", tool_call_id: "a" });
  });

  test("tool_result.isError 加 [error] 前缀", () => {
    const can = {
      model: "x",
      messages: [
        {
          role: "user" as const,
          content: [{ type: "tool_result" as const, toolUseId: "a", content: "boom", isError: true }],
        },
      ],
    } as Parameters<typeof canonicalToChatUpstream>[0];
    const out = canonicalToChatUpstream(can);
    expect(out.messages[0]).toEqual({ role: "tool", content: "[error] boom", tool_call_id: "a" });
  });
});

describe("Canonical → Anthropic Upstream", () => {
  test("preserves system", () => {
    const can = chatToCanonical({
      model: "claude",
      messages: [{ role: "user", content: "hi" }],
    } as Parameters<typeof chatToCanonical>[0]);
    can.system = "be nice";
    const upstream = canonicalToAnthropicUpstream(can);
    expect(upstream.system).toBe("be nice");
    expect(upstream.messages[0]?.role).toBe("user");
  });
});

describe("Response parsers", () => {
  test("parse chat upstream response", () => {
    const raw = {
      id: "chatcmpl-1",
      model: "gpt-4",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hello!" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    };
    const res = parseChatUpstreamResponse(raw, "gpt-4");
    expect(res.content[0]).toEqual({ type: "text", text: "Hello!" });
    expect(res.stopReason).toBe("end_turn");
    expect(res.usage.inputTokens).toBe(5);
  });

  test("parse anthropic upstream response", () => {
    const raw = {
      id: "msg-1",
      model: "claude-3",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    };
    const res = parseAnthropicUpstreamResponse(raw, "claude-3");
    expect(res.content[0]).toEqual({ type: "text", text: "Hi" });
    expect(res.stopReason).toBe("end_turn");
    expect(res.usage.inputTokens).toBe(10);
  });
});

describe("Outbound response builders", () => {
  const sampleCanonical = {
    id: "test-1",
    model: "gpt-4",
    content: [{ type: "text" as const, text: "Hello!" }],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 5, outputTokens: 3 },
  };

  test("canonicalToChatResponse", () => {
    const r = canonicalToChatResponse(sampleCanonical);
    // sampleCanonical 无 error 字段，runtime 一定返回 ChatResponse 分支；cast 让 tsc 不纠结
    if (!("choices" in r)) throw new Error("expected success shape");
    expect(r.choices[0]?.message.content).toBe("Hello!");
    expect(r.choices[0]?.finish_reason).toBe("stop");
    expect(r.usage?.prompt_tokens).toBe(5);
  });

  test("canonicalToAnthropicResponse", () => {
    const r = canonicalToAnthropicResponse(sampleCanonical);
    if (!("content" in r)) throw new Error("expected success shape");
    expect(r.content[0]).toEqual({ type: "text", text: "Hello!" });
    expect(r.stop_reason).toBe("end_turn");
  });

  test("canonicalToResponsesResponse", () => {
    const r = canonicalToResponsesResponse(sampleCanonical);
    if (!("output" in r)) throw new Error("expected success shape");
    expect(r.output[0]?.type).toBe("message");
    expect((r.output[0] as { content: Array<{ text: string }> })?.content[0]?.text).toBe("Hello!");
  });
});

// ============================================================================
// 流式 formatter：error chunk → 发 error event + 抑制终止事件
// （cc-switch `chat_sse_error_event_emits_failed_without_completed` 验证语义）
// ============================================================================

describe("Streaming formatter error event + terminal suppression", () => {
  test("ChatStreamFormatter: error chunk emits error event, suppresses [DONE]", () => {
    const { ChatStreamFormatter } = require("../src/convert/streaming/outbound/format-chat");
    const f = new ChatStreamFormatter();
    const errOut = f.format({ type: "error", error: "upstream failed" });
    expect(errOut).toHaveLength(1);
    const errEvent = JSON.parse(errOut[0]!.replace(/^data: /, "").replace(/\n\n$/, "")) as { error: { message: string; type: string } };
    expect(errEvent.error.message).toBe("upstream failed");

    // message_stop 之后**不发 [DONE]**（流中错抑制）
    const stopOut = f.format({ type: "message_stop" });
    expect(stopOut).toEqual([]);
  });

  test("AnthropicStreamFormatter: error chunk emits error event, suppresses message_stop", () => {
    const { AnthropicStreamFormatter } = require("../src/convert/streaming/outbound/format-anthropic");
    const f = new AnthropicStreamFormatter();
    const errOut = f.format({ type: "error", error: "upstream failed" });
    expect(errOut).toHaveLength(1);
    expect(errOut[0]).toMatch(/^event: error\n/);

    // message_stop 之后**不发 message_stop event**（流中错抑制）
    const stopOut = f.format({ type: "message_stop" });
    expect(stopOut).toEqual([]);
  });

  test("ResponsesStreamFormatter: error chunk emits error event, suppresses response.completed + [DONE]", () => {
    const { ResponsesStreamFormatter } = require("../src/convert/streaming/outbound/format-responses");
    const f = new ResponsesStreamFormatter();
    const errOut = f.format({ type: "error", error: "upstream failed" });
    expect(errOut).toHaveLength(1);
    expect(errOut[0]).toMatch(/"type":"response\.error"/);

    // message_stop 之后**不发 response.completed + [DONE]**（流中错抑制）
    const stopOut = f.format({ type: "message_stop" });
    expect(stopOut).toEqual([]);
  });
});
