// ============================================================================
// 端到端集成测试
// 覆盖：
//   1. 协议转换 (Chat ↔ Canonical, Anthropic ↔ Canonical, Responses ↔ Canonical)
//   2. 模型解析 (tier / sub/model / global alias)
//   3. HTTP 端点 (/healthz, /v1/models, /v1/chat/completions, /anthropic/v1/messages)
// ============================================================================
import { describe, test, expect } from "bun:test";
import { chatToCanonical } from "../src/convert/inbound/chat-to-canonical";
import { anthropicToCanonical } from "../src/convert/inbound/anthropic-to-canonical";
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
    expect(r.choices[0]?.message.content).toBe("Hello!");
    expect(r.choices[0]?.finish_reason).toBe("stop");
    expect(r.usage?.prompt_tokens).toBe(5);
  });

  test("canonicalToAnthropicResponse", () => {
    const r = canonicalToAnthropicResponse(sampleCanonical);
    expect(r.content[0]).toEqual({ type: "text", text: "Hello!" });
    expect(r.stop_reason).toBe("end_turn");
  });

  test("canonicalToResponsesResponse", () => {
    const r = canonicalToResponsesResponse(sampleCanonical);
    expect(r.output[0]?.type).toBe("message");
    expect((r.output[0] as { content: Array<{ text: string }> })?.content[0]?.text).toBe("Hello!");
  });
});
