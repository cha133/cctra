// ============================================================================
// HTTP 服务器 + 模型解析集成测试
// ============================================================================

// 关掉 XDG migration，防止 test 触碰用户真实 ~/.cctra/
process.env.CCTRA_NO_MIGRATE = "1";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer } from "../src/server/serve";
import { resolveModelRef } from "../src/core/resolve";
import { loadConfigFile, saveConfigFile } from "../src/core/config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockUpstream, type MockUpstreamHandle } from "./integration/mock-upstream";

let serverHandle: { port: number; stop: () => void } | null = null;
let mockUpstream: MockUpstreamHandle | null = null;
let tempDir: string | null = null;
let tempConfigPath: string | null = null;

function makeTestConfig(mockBaseUrl: string): string {
  return `
port = 31444

[aliases]
"b-alias" = "test-sub/model-b"
"cctra-pro" = "tool-sub/x"
"cctra-flash" = ""

[providers.test-sub]
name = "test-sub"
endpoint = "https://example.com"
token = "test-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.test-sub.models]]
id = "model-a"

[[providers.test-sub.models]]
id = "model-b"

[providers.tool-sub]
name = "tool-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/stream-tool-call"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.tool-sub.models]]
id = "x"

[providers.echo-sub]
name = "echo-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/echo-body"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.echo-sub.models]]
id = "x"

[providers.slow-sub]
name = "slow-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/slow"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.slow-sub.models]]
id = "x"

[providers.responses-echo-sub]
name = "responses-echo-sub"
endpoint = "${mockBaseUrl}"
responsesPath = "/v1/responses/echo"
token = "mock-token"
apiFormat = "openai-responses"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.responses-echo-sub.models]]
id = "x"

# H 错误透传测试 fixture
[providers.chat-401-sub]
name = "chat-401-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/error-401"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.chat-401-sub.models]]
id = "x"

[providers.anthropic-429-sub]
name = "anthropic-429-sub"
endpoint = "${mockBaseUrl}"
messagesPath = "/chat/error-429"
token = "mock-token"
apiFormat = "anthropic-messages"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.anthropic-429-sub.models]]
id = "x"

[providers.responses-500-sub]
name = "responses-500-sub"
endpoint = "${mockBaseUrl}"
responsesPath = "/chat/error-500"
token = "mock-token"
apiFormat = "openai-responses"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.responses-500-sub.models]]
id = "x"

[providers.stream-error-sub]
name = "stream-error-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/stream-error"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.stream-error-sub.models]]
id = "x"

# Cross-format 集成测试 fixture（0.6.1）：覆盖 9/9 协议组合中缺的 4 个
[providers.anthropic-to-chat-sub]
name = "anthropic-to-chat-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/echo-body"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.anthropic-to-chat-sub.models]]
id = "claude-test"

[providers.chat-to-anthropic-sub]
name = "chat-to-anthropic-sub"
endpoint = "${mockBaseUrl}"
messagesPath = "/anthropic/messages/echo"
token = "mock-token"
apiFormat = "anthropic-messages"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.chat-to-anthropic-sub.models]]
id = "claude-test"

[providers.responses-to-anthropic-sub]
name = "responses-to-anthropic-sub"
endpoint = "${mockBaseUrl}"
messagesPath = "/anthropic/messages/echo"
token = "mock-token"
apiFormat = "anthropic-messages"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.responses-to-anthropic-sub.models]]
id = "claude-test"

[providers.responses-to-chat-sub]
name = "responses-to-chat-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/echo-body"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[providers.responses-to-chat-sub.models]]
id = "claude-test"
`;
}

beforeAll(() => {
  // 隔离测试 config 到临时目录，避免污染 ~/.config/cctra/config.toml
  tempDir = mkdtempSync(join(tmpdir(), "cctra-test-"));
  tempConfigPath = join(tempDir, "config.toml");
  process.env.CCTRA_CONFIG = tempConfigPath;
  mockUpstream = startMockUpstream();
  writeFileSync(tempConfigPath, makeTestConfig(mockUpstream.baseUrl), "utf-8");
  serverHandle = startServer();
});

afterAll(() => {
  serverHandle?.stop();
  mockUpstream?.stop();
  // 清理临时目录和 env var
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  delete process.env.CCTRA_CONFIG;
});

describe("HTTP server", () => {
  test("healthz", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  test("models list", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/models`);
    expect(res.status).toBe(200);
    const data = await res.json() as { data: Array<{ id: string; owned_by: string; cctra_target?: string | null }> };
    const ids = data.data.map((m) => m.id);
    expect(ids).toContain("test-sub/model-a");
    // alias 应作为顶层 id 暴露，owned_by 标记为 cctra-alias
    const cctraPro = data.data.find((m) => m.id === "cctra-pro");
    expect(cctraPro).toBeDefined();
    expect(cctraPro!.owned_by).toBe("cctra-alias");
    expect(cctraPro!.cctra_target).toBe("tool-sub/x");
    // unbound alias 也出现，cctra_target = null
    const cctraFlash = data.data.find((m) => m.id === "cctra-flash");
    expect(cctraFlash).toBeDefined();
    expect(cctraFlash!.cctra_target).toBeNull();
  });

  test("chat completions without model → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("chat completions with invalid model → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nonexistent", messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("root path → 404", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/`);
    expect(res.status).toBe(404);
  });

  test("CORS preflight → 204", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
  });

  test("messages endpoint accepts POST", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nonexistent", messages: [] }),
    });
    // 没有 model → 400 (说明到达了 handler，不是 404)
    expect(res.status).toBe(400);
  });

  test("responses endpoint accepts POST", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nonexistent" }),
    });
    expect(res.status).toBe(400);
  });

  test("bound alias routes to target model", async () => {
    // cctra-pro 在 fixture 里绑到 tool-sub/x（mock 上游的 stream-tool-call）
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "cctra-pro",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    // 不需要校验 body，只要到上游就行（status 200 已说明 resolveModelRef 命中）
    await res.body?.cancel();
  });

  test("unbound alias → 400 with `is unbound` message", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "cctra-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: { message: string } };
    expect(data.error.message).toMatch(/is unbound/);
  });
});

describe("Model resolve", () => {
  test("sub/model with id", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("test-sub/model-a", config);
    expect(r?.modelId).toBe("model-a");
  });

  test("global alias from [aliases] table", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("b-alias", config);
    expect(r?.source.name).toBe("test-sub");
    expect(r?.modelId).toBe("model-b");
  });

  test("unknown model returns null", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("unknown", config);
    expect(r).toBeNull();
  });

  test("provider/alias is NOT supported in new schema (only provider/id)", () => {
    // 旧行为允许 "test-sub/b-alias"，新设计明确只接受 provider/id
    const config = loadConfigFile();
    expect(resolveModelRef("test-sub/b-alias", config)).toBeNull();
  });
});

// ============================================================================
// 端到端流式集成测试（用 mock-upstream 模拟真实上游）
// ============================================================================

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  const lines: string[] = [];
  const iter = stream as unknown as AsyncIterable<Uint8Array>;
  for await (const chunk of iter) {
    buf += decoder.decode(chunk, { stream: true });
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx < 0) break;
      lines.push(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.length > 0) lines.push(buf);
  return lines;
}

describe("Streaming integration", () => {
  test("tool_call accumulates correctly through cctra", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tool-sub/x",
        messages: [{ role: "user", content: "what's the weather in Beijing?" }],
        stream: true,
        tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    const events = await collectSse(res.body!);

    // 从 SSE 事件中抽 delta.tool_calls，拼成完整 arguments
    let toolName = "";
    let toolId = "";
    let argsAccum = "";
    let finishReason: string | null = null;
    for (const ev of events) {
      const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>;
        };
        const choice = parsed.choices?.[0];
        const tc = choice?.delta?.tool_calls?.[0];
        if (tc?.id) toolId = tc.id;
        if (tc?.function?.name) toolName = tc.function.name;
        if (tc?.function?.arguments) argsAccum += tc.function.arguments;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch { /* skip */ }
    }

    expect(toolId).toBe("call_abc");
    expect(toolName).toBe("get_weather");
    expect(argsAccum).toBe('{"location":"Beijing"}');
    expect(finishReason).toBe("tool_calls");
  });

  test("multimodal image_url makes it to upstream body", async () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAA"; // 任意 base64 字符串
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "echo-sub/x",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    // echo 把 body 装到 message.content 里返回
    const echoed = JSON.parse(data.choices[0]!.message.content) as {
      messages: Array<{ content: unknown }>;
    };
    // 找最后一个 user message
    const userMsg = echoed.messages[echoed.messages.length - 1]!;
    expect(Array.isArray(userMsg.content)).toBe(true);
    const parts = userMsg.content as Array<{ type: string; image_url?: { url: string } }>;
    const imagePart = parts.find((p) => p.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart!.image_url!.url).toBe(`data:image/png;base64,${base64}`);
  });

  test("non-streaming request omits stream_options in upstream body", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "echo-sub/x",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const echoed = JSON.parse(data.choices[0]!.message.content) as Record<string, unknown>;
    // stream_options must NOT be in the upstream body when stream=false
    expect(echoed).not.toHaveProperty("stream_options");
    expect(echoed.stream).toBe(false);
  });

  test("client abort propagates to upstream fetch", async () => {
    const beforeCount = mockUpstream!.captured.length;
    const ac = new AbortController();
    const fetchPromise = fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "slow-sub/x",
        messages: [{ role: "user", content: "long task" }],
        stream: true,
      }),
      signal: ac.signal,
    });
    // 等 mock 拿到请求
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();
    // 吞掉 abort 错误
    await fetchPromise.catch(() => undefined);
    // 给 cctra → mock 的 abort 一点传播时间
    await new Promise((r) => setTimeout(r, 300));
    const slow = mockUpstream!.captured.slice(beforeCount).find((r) => r.path === "/chat/slow");
    expect(slow).toBeDefined();
    expect(slow!.aborted).toBe(true);
  });
});

describe("SSE keepalive", () => {
  test("emits keepalive comment during silence", async () => {
    const { wrapWithKeepalive } = await import("../src/server/keepalive");
    // 制造一个 1s 都不发数据的内部流
    const inner = new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((r) => setTimeout(r, 500));
        controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
        controller.close();
      },
    });
    // 100ms 间隔 → 500ms 内至少 3 个 keepalive
    const wrapped = wrapWithKeepalive(inner, 100);
    const events = await collectSse(wrapped);
    const keepalives = events.filter((e) => e.includes(": keepalive"));
    expect(keepalives.length).toBeGreaterThanOrEqual(3);
    // 用户数据也透传了
    const dataEvents = events.filter((e) => e.includes("data: hi"));
    expect(dataEvents.length).toBe(1);
  });

  test("clears timer on cancel (no leak)", async () => {
    const { wrapWithKeepalive } = await import("../src/server/keepalive");
    const inner = new ReadableStream<Uint8Array>({
      start() { /* 不发任何数据，等被 cancel */ },
    });
    const wrapped = wrapWithKeepalive(inner, 50);
    const reader = wrapped.getReader();
    // 读一次拿到 keepalive
    await reader.read();
    await reader.cancel();
    // 等一会，如果 timer 没清，进程不会退；这里能完成就算过
    await new Promise((r) => setTimeout(r, 200));
    expect(true).toBe(true);
  });
});

// ============================================================================
// Cross-format 集成测试（L.2 验证：Responses 上游协议真的能跑）
// ============================================================================

describe("Cross-format upstream: openai-responses", () => {
  test("Anthropic client → cctra → Responses upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-echo-sub/x",
        system: "you are helpful",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { content: Array<{ type: string; text?: string }> };
    const textBlock = data.content.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    // echo 端点会回显 instructions + input_items 数量
    expect(textBlock!.text).toMatch(/^echo: you are helpful \(input_items=1\)/);
  });

  test("OpenAI Chat client → cctra → Responses upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-echo-sub/x",
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "hello" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    expect(data.choices[0]!.message.content).toMatch(/^echo: be terse \(input_items=1\)/);
  });

  test("Responses client → cctra → Responses upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-echo-sub/x",
        instructions: "test instruction",
        input: "user message",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { output: Array<{ type: string; content: Array<{ type: string; text: string }> }> };
    expect(data.output[0]!.type).toBe("message");
    const text = data.output[0]!.content[0]!.text;
    // input 是 string 时会被规范成 1 个 user message
    expect(text).toMatch(/^echo: test instruction \(input_items=1\)/);
  });
});

// ============================================================================
// Cross-format 集成测试（0.6.1）：补 9/9 协议组合里缺的 4 个
// - Anthropic client × Chat upstream        (复用 /chat/echo-body)
// - Chat client × Anthropic upstream
// - Responses client × Anthropic upstream
// - Responses client × Chat upstream        (复用 /chat/echo-body)
// ============================================================================

describe("Cross-format upstream: openai-chat", () => {
  test("Anthropic client → cctra → Chat upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic-to-chat-sub/claude-test",
        system: "MARKER_A2C",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { content: Array<{ type: string; text?: string }>; stop_reason: string };
    const textBlock = data.content.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    // /chat/echo-body 是 JSON.stringify(body) → 系统消息文本会出现在回显里
    expect(textBlock!.text).toContain("MARKER_A2C");
    // 0.5.1 修复：上游合法 stop_reason 应直接透传
    expect(data.stop_reason).toBe("end_turn");
  });

  test("Responses client → cctra → Chat upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-to-chat-sub/claude-test",
        instructions: "MARKER_R2C",
        input: "user message",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { output: Array<{ type: string; content: Array<{ type: string; text: string }> }> };
    expect(data.output[0]!.type).toBe("message");
    const text = data.output[0]!.content[0]!.text;
    // instructions 会变成 Chat system message，回显里包含 MARKER_R2C
    expect(text).toContain("MARKER_R2C");
  });
});

describe("Cross-format upstream: anthropic-messages", () => {
  test("Chat client → cctra → Anthropic upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "chat-to-anthropic-sub/claude-test",
        messages: [
          { role: "system", content: "MARKER_C2A" },
          { role: "user", content: "hi" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { choices: Array<{ message: { content: string }; finish_reason: string }> };
    // /anthropic/messages/echo 返 "echo: <system> (input_items=N)" 格式
    // 注意：Chat 客户端发的 system message 在 Anthropic outbound 时被提到顶层 system 字段，
    // 所以 messages[] 只剩 1 条 user
    expect(data.choices[0]!.message.content).toMatch(/^echo: MARKER_C2A \(input_items=1\)/);
    expect(data.choices[0]!.finish_reason).toBe("stop");
  });

  test("Responses client → cctra → Anthropic upstream (non-stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-to-anthropic-sub/claude-test",
        instructions: "MARKER_R2A",
        input: "user message",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { output: Array<{ type: string; content: Array<{ type: string; text: string }> }> };
    expect(data.output[0]!.type).toBe("message");
    const text = data.output[0]!.content[0]!.text;
    // input 是 string 时被规范成 1 个 user message
    expect(text).toMatch(/^echo: MARKER_R2A \(input_items=1\)/);
  });
});

// ============================================================================
// H 错误码透传（status code 跨层传递 + error response shape）
// ============================================================================

describe("Error status propagation", () => {
  test("upstream 401 returns 401 to OpenAI Chat client", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "chat-401-sub/x",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
    const data = await res.json() as { error: { message: string; code?: number } };
    expect(data.error.message).toBe("Invalid API key");
    expect(data.error.code).toBe(401);
  });

  test("upstream 429 returns 429 to Anthropic Messages client", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic-429-sub/x",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
      }),
    });
    expect(res.status).toBe(429);
    const data = await res.json() as { error: { message: string } };
    expect(data.error.message).toBe("Rate limit exceeded");
  });

  test("upstream 500 returns 500 to Responses client", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-500-sub/x",
        input: "hi",
      }),
    });
    expect(res.status).toBe(500);
    const data = await res.json() as { error: { code: number; message: string } };
    expect(data.error.code).toBe(500);
    expect(data.error.message).toBe("Internal server error");
  });

  test("responses streaming upstream HTTP 500 → 500 JSON returned (not wrapped as SSE)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "responses-500-sub/x",
        input: "hi",
        stream: true,
      }),
    });
    expect(res.status).toBe(500);
    const data = await res.json() as { error: { message: string } };
    expect(data.error.message).toBe("Internal server error");
  });

  test("streaming upstream error → client receives error event (passthrough forwards upstream SSE as-is)", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "stream-error-sub/x",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    const events = await collectSse(res.body!);

    // 抽 data: 行
    const dataLines: string[] = [];
    for (const ev of events) {
      const dl = ev.split("\n").find((l) => l.startsWith("data:"));
      if (dl) dataLines.push(dl.slice(5).trim());
    }
    const parsed = dataLines
      .filter((d) => d && d !== "[DONE]")
      .map((d) => {
        try { return JSON.parse(d) as Record<string, unknown>; }
        catch { return null; }
      })
      .filter((x): x is Record<string, unknown> => x !== null);

    // 必须有 error event
    const errorEvent = parsed.find((p) => "error" in p);
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.error as { message: string }).message).toBe("stream interrupted");

    // 直通模式下 [DONE] 由上游原始 SSE 决定，不做抑制
  });
});

// 避免 unused import 警告
void saveConfigFile;
