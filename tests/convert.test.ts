// ============================================================================
// 端到端集成测试
// 覆盖：
//   1. 协议转换 (Chat ↔ Canonical, Anthropic ↔ Canonical, Responses ↔ Canonical)
//   2. 模型解析 (sub/model / global alias)
//   3. HTTP 端点 (/healthz, /v1/models, /v1/chat/completions, /v1/messages, /v1/responses)
// ============================================================================
import { describe, test, expect } from "bun:test";
import { chatToCanonical } from "../src/convert/inbound/chat-to-canonical";
import { anthropicToCanonical } from "../src/convert/inbound/anthropic-to-canonical";
import { responsesToCanonical } from "../src/convert/inbound/responses-to-canonical";
import { canonicalToChatUpstream } from "../src/convert/upstream/canonical-to-chat";
import { canonicalToAnthropicUpstream } from "../src/convert/upstream/canonical-to-anthropic";
import { canonicalToResponses } from "../src/convert/upstream/canonical-to-responses";
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

  test("未知 type input item 占位 text + extras 保留原始 payload（forward-compat 兜底）", () => {
    // 0.6.0 行为升级：原「静默跳」改为保留原始 payload，避免未来 OpenAI 加新 item type 时信息丢失
    const can = responsesToCanonical({
      model: "x",
      input: [{ type: "web_search_call", query: "x" } as never],
    } as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages).toHaveLength(1);
    expect(can.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "[unknown_input_item:web_search_call]",
      extras: { openaiResponses: { originalPayload: { type: "web_search_call", query: "x" } } },
    });
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

// ============================================================================
// Anthropic 路径保真：top-level / block-level / system extras + 未知 type 兜底 + stop_reason 映射
// 上一轮审计发现的 5 个洞 + TODO.md "5min" 修复
// ============================================================================

describe("Anthropic passthrough fidelity", () => {
  test("top-level unknown fields (e.g. metadata) land in extras.anthropic and round-trip", () => {
    const req = {
      model: "claude-3",
      messages: [{ role: "user" as const, content: "hi" }],
      max_tokens: 100,
      metadata: { user_id: "u-42" },
      context_management: { edits: [] },
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    expect(can.extras?.anthropic).toEqual({
      metadata: { user_id: "u-42" },
      context_management: { edits: [] },
    });

    const upstream = canonicalToAnthropicUpstream(can);
    expect(upstream.metadata).toEqual({ user_id: "u-42" });
    expect(upstream.context_management).toEqual({ edits: [] });
  });

  test("block-level cache_control on text round-trips (prompt caching)", () => {
    const req = {
      model: "claude-3",
      messages: [{
        role: "user" as const,
        content: [{
          type: "text" as const,
          text: "hello",
          cache_control: { type: "ephemeral" },
        }],
      }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    const upstream = canonicalToAnthropicUpstream(can);
    expect(upstream.messages[0]?.content).toEqual([{
      type: "text",
      text: "hello",
      cache_control: { type: "ephemeral" },
    }]);
  });

  test("block-level cache_control on tool_result round-trips (most impactful caching case)", () => {
    const req = {
      model: "claude-3",
      messages: [{
        role: "user" as const,
        content: [{
          type: "tool_result" as const,
          tool_use_id: "tu-1",
          content: "result data",
          cache_control: { type: "ephemeral" },
        }],
      }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    const upstream = canonicalToAnthropicUpstream(can);
    expect(upstream.messages[0]?.content).toEqual([{
      type: "tool_result",
      tool_use_id: "tu-1",
      content: "result data",
      cache_control: { type: "ephemeral" },
    }]);
  });

  test("system array with cache_control round-trips: upstream emits array form, cache_control preserved", () => {
    const req = {
      model: "claude-3",
      system: [
        { type: "text" as const, text: "first chunk", cache_control: { type: "ephemeral" } },
        { type: "text" as const, text: "second chunk" },
      ],
      messages: [{ role: "user" as const, content: "hi" }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    const upstream = canonicalToAnthropicUpstream(can);
    expect(Array.isArray(upstream.system)).toBe(true);
    expect(upstream.system).toEqual([
      { type: "text", text: "first chunk", cache_control: { type: "ephemeral" } },
      { type: "text", text: "second chunk" },
    ]);
  });

  test("system array without cache_control flattens to string (back-compat, zero regression)", () => {
    const req = {
      model: "claude-3",
      system: [{ type: "text" as const, text: "a" }, { type: "text" as const, text: "b" }],
      messages: [{ role: "user" as const, content: "hi" }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    const upstream = canonicalToAnthropicUpstream(can);
    expect(upstream.system).toBe("ab");
  });

  test("redacted_thinking inbound → canonical placeholder + extras; upstream emits text", () => {
    const req = {
      model: "claude-3",
      messages: [{
        role: "assistant" as const,
        content: [{ type: "redacted_thinking" as const, data: "encrypted-blob-xyz" }],
      }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    expect(can.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "[redacted_thinking]",
      extras: { anthropic: { data: "encrypted-blob-xyz" } },
    });
    const upstream = canonicalToAnthropicUpstream(can);
    // 单 text block 但有 extras → 不走字符串短路，必须 emit 数组形态才能透传 data
    expect(upstream.messages[0]?.content).toEqual([{
      type: "text",
      text: "[redacted_thinking]",
      data: "encrypted-blob-xyz",
    }]);
  });

  test("unknown block type is preserved as text + extras (forward-compat, no silent drop)", () => {
    const req = {
      model: "claude-3",
      messages: [{
        role: "user" as const,
        content: [{
          // 假装是未来 Anthropic 加的 server_tool_use 之类
          type: "foo_bar_block" as const,
          custom_field: "preserve-me",
        } as never],
      }],
      max_tokens: 100,
    };
    const can = anthropicToCanonical(req as Parameters<typeof anthropicToCanonical>[0]);
    expect(can.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "[unknown_block:foo_bar_block]",
      extras: { anthropic: { custom_field: "preserve-me" } },
    });
    const upstream = canonicalToAnthropicUpstream(can);
    // 单 text block 但有 extras → 不走字符串短路，emit 数组形态以透传 custom_field
    expect(upstream.messages[0]?.content).toEqual([{
      type: "text",
      text: "[unknown_block:foo_bar_block]",
      custom_field: "preserve-me",
    }]);
  });

  test("parseAnthropicUpstreamResponse handles redacted_thinking", () => {
    const raw = {
      id: "msg-1",
      model: "claude-3",
      content: [{ type: "redacted_thinking", data: "encrypted-blob-xyz" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    };
    const res = parseAnthropicUpstreamResponse(raw, "claude-3");
    expect(res.content[0]).toEqual({
      type: "text",
      text: "[redacted_thinking]",
      extras: { anthropic: { data: "encrypted-blob-xyz" } },
    });
  });
});

// ============================================================================
// TODO.md "5min" 修复：stop_reason error → refusal（canonical / streaming）
// ============================================================================

describe("Anthropic stop_reason mapping (error → refusal)", () => {
  test("canonicalToAnthropicResponse maps stopReason=error to stop_reason=refusal", () => {
    const res = canonicalToAnthropicResponse({
      id: "test",
      model: "claude-3",
      content: [{ type: "text" as const, text: "" }],
      stopReason: "error",
      usage: { inputTokens: 1, outputTokens: 0 },
    });
    if (!("content" in res)) throw new Error("expected success shape");
    expect(res.stop_reason).toBe("refusal");
  });

  test("canonicalToAnthropicResponse passes through legal stop_reasons unchanged", () => {
    for (const sr of ["end_turn", "max_tokens", "stop_sequence", "tool_use"] as const) {
      const res = canonicalToAnthropicResponse({
        id: "test",
        model: "claude-3",
        content: [{ type: "text" as const, text: "" }],
        stopReason: sr,
        usage: { inputTokens: 1, outputTokens: 0 },
      });
      if (!("content" in res)) throw new Error("expected success shape");
      expect(res.stop_reason).toBe(sr);
    }
  });

  test("AnthropicStreamFormatter maps message_delta.stop_reason=error to refusal in SSE output", () => {
    const { AnthropicStreamFormatter } = require("../src/convert/streaming/outbound/format-anthropic");
    const f = new AnthropicStreamFormatter();
    const out = f.format({
      type: "message_delta",
      delta: { stop_reason: "error", stop_sequence: null },
    });
    expect(out).toHaveLength(1);
    const event = out[0]!;
    const dataLine = event.split("\n").find((l: string) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length)) as { delta: { stop_reason: string } };
    expect(parsed.delta.stop_reason).toBe("refusal");
  });
});

// ============================================================================
// Chat 路径保真：top-level / per-message / per-part extras + 未知 part 兜底
// 同款修复扩到 OpenAI Chat 路径（P.1）
// ============================================================================

describe("Chat passthrough fidelity", () => {
  test("top-level unknown fields land in extras.openaiChat and round-trip", () => {
    const req = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hi" }],
      max_tokens: 100,
      metadata: { user_id: "u-42" },
      seed: 12345,
      response_format: { type: "json_object" },
      parallel_tool_calls: false,
      service_tier: "priority",
      prediction: { type: "content", content: "draft" },
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.extras?.openaiChat).toEqual({
      metadata: { user_id: "u-42" },
      seed: 12345,
      response_format: { type: "json_object" },
      parallel_tool_calls: false,
      service_tier: "priority",
      prediction: { type: "content", content: "draft" },
    });

    const upstream = canonicalToChatUpstream(can);
    expect(upstream.metadata).toEqual({ user_id: "u-42" });
    expect(upstream.seed).toBe(12345);
    expect(upstream.response_format).toEqual({ type: "json_object" });
    expect(upstream.parallel_tool_calls).toBe(false);
    expect(upstream.service_tier).toBe("priority");
    expect(upstream.prediction).toEqual({ type: "content", content: "draft" });
  });

  test("top-level newer fields (n / stream_options / logprobs) round-trip", () => {
    const req = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hi" }],
      n: 3,
      stream_options: { include_usage: true },
      logprobs: true,
      top_logprobs: 5,
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    const upstream = canonicalToChatUpstream(can);
    expect(upstream.n).toBe(3);
    expect(upstream.stream_options).toEqual({ include_usage: true });
    expect(upstream.logprobs).toBe(true);
    expect(upstream.top_logprobs).toBe(5);
  });

  test("assistant message-level extras (name / legacy function_call) round-trip", () => {
    const req = {
      model: "gpt-4",
      messages: [{
        role: "assistant" as const,
        content: "ok",
        name: "bot-1",
        function_call: { name: "legacy_fn", arguments: "{}" },
      }],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.messages[0]?.extras?.openaiChat).toEqual({
      name: "bot-1",
      function_call: { name: "legacy_fn", arguments: "{}" },
    });
    const upstream = canonicalToChatUpstream(can);
    expect(upstream.messages[0]?.name).toBe("bot-1");
    expect((upstream.messages[0] as { function_call?: unknown }).function_call).toEqual({ name: "legacy_fn", arguments: "{}" });
  });

  test("user message-level extras (name) round-trip", () => {
    const req = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hi", name: "alice" }],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.messages[0]?.extras?.openaiChat).toEqual({ name: "alice" });
    const upstream = canonicalToChatUpstream(can);
    expect(upstream.messages[0]?.name).toBe("alice");
  });

  test("tool message-level extras → tool_result block (§5.B), round-trips back to tool message", () => {
    // 关键决策：tool msg 级 extras 挂到 tool_result block 而不是 user message
    // outbound synthesize tool message 时 mergeExtras 还原回 tool message 形态
    const req = {
      model: "gpt-4",
      messages: [
        {
          role: "assistant" as const,
          content: null,
          tool_calls: [{ id: "c1", type: "function" as const, function: { name: "f", arguments: "{}" } }],
        },
        { role: "tool" as const, tool_call_id: "c1", content: "42", name: "tool-1" },
      ],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    // tool msg 的 extras 挂在 user.tool_result block 上
    expect(can.messages[1]?.content[0]?.extras?.openaiChat).toEqual({ name: "tool-1" });
    const upstream = canonicalToChatUpstream(can);
    // outbound: tool message 上重新出现 name 字段
    expect(upstream.messages[1]).toEqual({
      role: "tool",
      content: "42",
      tool_call_id: "c1",
      name: "tool-1",
    });
  });

  test("image_url part-level extras (detail) round-trip", () => {
    const req = {
      model: "gpt-4",
      messages: [{
        role: "user" as const,
        content: [
          { type: "image_url" as const, image_url: { url: "http://img" }, detail: "high" } as never,
        ],
      }],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.messages[0]?.content[0]?.extras?.openaiChat).toEqual({ detail: "high" });
    const upstream = canonicalToChatUpstream(can);
    const parts = upstream.messages[0]?.content as Array<{ type: string; image_url: { url: string }; detail?: string }>;
    expect(parts[0]).toEqual({
      type: "image_url",
      image_url: { url: "http://img" },
      detail: "high",
    });
  });

  test("unknown content part type preserved as text + extras (forward-compat, no silent drop)", () => {
    const req = {
      model: "gpt-4",
      messages: [{
        role: "user" as const,
        content: [
          { type: "input_audio", input_audio: { data: "base64-blob", format: "wav" } } as never,
        ],
      }],
    };
    const can = chatToCanonical(req as Parameters<typeof chatToCanonical>[0]);
    expect(can.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "[unknown_part:input_audio]",
      extras: { openaiChat: { input_audio: { data: "base64-blob", format: "wav" } } },
    });
  });
});

// ============================================================================
// Responses 路径保真：top-level / per-item extras + 未知 item 兜底 + M.4 index signatures
// 同款修复扩到 OpenAI Responses 路径（P.2 + M.4）
// ============================================================================

describe("Responses passthrough fidelity", () => {
  test("top-level unknown fields land in extras.openaiResponses and round-trip", () => {
    const req = {
      model: "gpt-5",
      input: [{ type: "message" as const, role: "user" as const, content: "hi" }],
      background: true,
      include: ["reasoning.encrypted_content"],
      metadata: { user_id: "u-42" },
      parallel_tool_calls: false,
      service_tier: "priority",
      store: false,
      text: { format: { type: "json_object" } },
      tool_choice: "required",
      truncation: "auto",
    };
    const can = responsesToCanonical(req as Parameters<typeof responsesToCanonical>[0]);
    expect(can.extras?.openaiResponses).toEqual({
      background: true,
      include: ["reasoning.encrypted_content"],
      metadata: { user_id: "u-42" },
      parallel_tool_calls: false,
      service_tier: "priority",
      store: false,
      text: { format: { type: "json_object" } },
      tool_choice: "required",
      truncation: "auto",
    });

    const upstream = canonicalToResponses(can);
    expect(upstream.background).toBe(true);
    expect(upstream.include).toEqual(["reasoning.encrypted_content"]);
    expect(upstream.metadata).toEqual({ user_id: "u-42" });
    expect(upstream.store).toBe(false);
    expect(upstream.tool_choice).toBe("required");
  });

  test("top-level newer fields (safety_identifier / prompt_cache_key / prompt) round-trip", () => {
    const req = {
      model: "gpt-5",
      input: [{ type: "message" as const, role: "user" as const, content: "hi" }],
      safety_identifier: "sid-1",
      prompt_cache_key: "cache-key-1",
      prompt: { id: "prompt-template-1", variables: {} },
    };
    const can = responsesToCanonical(req as Parameters<typeof responsesToCanonical>[0]);
    const upstream = canonicalToResponses(can);
    expect(upstream.safety_identifier).toBe("sid-1");
    expect(upstream.prompt_cache_key).toBe("cache-key-1");
    expect(upstream.prompt).toEqual({ id: "prompt-template-1", variables: {} });
  });

  test("message input item level extras round-trip", () => {
    const req = {
      model: "gpt-5",
      input: [{
        type: "message" as const,
        role: "user" as const,
        content: "hi",
        id: "msg-1",
        status: "completed",
      } as never],
    };
    const can = responsesToCanonical(req as Parameters<typeof responsesToCanonical>[0]);
    expect(can.messages[0]?.extras?.openaiResponses).toEqual({ id: "msg-1", status: "completed" });
    const upstream = canonicalToResponses(can);
    const item = upstream.input[0] as { id?: string; status?: string };
    expect(item.id).toBe("msg-1");
    expect(item.status).toBe("completed");
  });

  test("function_call input item level extras (status) round-trip", () => {
    const req = {
      model: "gpt-5",
      input: [{
        type: "function_call" as const,
        call_id: "c1",
        name: "f",
        arguments: "{}",
        status: "completed",
      } as never],
    };
    const can = responsesToCanonical(req as Parameters<typeof responsesToCanonical>[0]);
    // function_call 的 extras 挂在 tool_use block 上
    expect(can.messages[0]?.content[0]?.extras?.openaiResponses).toEqual({ status: "completed" });
    const upstream = canonicalToResponses(can);
    const item = upstream.input[0] as { type: string; status?: string };
    expect(item.type).toBe("function_call");
    expect(item.status).toBe("completed");
  });

  test("function_call_output input item level extras round-trip", () => {
    const req = {
      model: "gpt-5",
      input: [{
        type: "function_call_output" as const,
        call_id: "c1",
        output: "42",
        status: "completed",
      } as never],
    };
    const can = responsesToCanonical(req as Parameters<typeof responsesToCanonical>[0]);
    // function_call_output 的 extras 挂在 tool_result block 上
    expect(can.messages[0]?.content[0]?.extras?.openaiResponses).toEqual({ status: "completed" });
    const upstream = canonicalToResponses(can);
    const item = upstream.input[0] as { type: string; status?: string };
    expect(item.type).toBe("function_call_output");
    expect(item.status).toBe("completed");
  });

  test("canonicalToResponses top-level unknown fields spread (upstream baseline)", () => {
    // Responses 路径之前完全无 upstream 测试，这里同步补 baseline
    const can = {
      model: "gpt-5",
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
      stream: false,
      extras: { openaiResponses: { background: true, store: false } },
    };
    const upstream = canonicalToResponses(can);
    expect(upstream.background).toBe(true);
    expect(upstream.store).toBe(false);
    expect(upstream.input).toHaveLength(1);
  });

  test("bucket isolation: tool_use block extras.anthropic does NOT leak into Responses upstream", () => {
    // 验证 extras 按协议桶隔离：anthropic 桶里的字段不会泄露到 openaiResponses upstream
    const can = {
      model: "gpt-5",
      messages: [{
        role: "assistant" as const,
        content: [{
          type: "tool_use" as const,
          id: "c1",
          name: "f",
          input: {},
          extras: { anthropic: { cache_control: { type: "ephemeral" } } },
        }],
      }],
      stream: false,
    };
    const upstream = canonicalToResponses(can);
    const item = upstream.input[0] as { type: string; cache_control?: unknown };
    expect(item.type).toBe("function_call");
    expect(item.cache_control).toBeUndefined();
  });
});
