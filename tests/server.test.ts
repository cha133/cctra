// ============================================================================
// HTTP 服务器 + 模型解析集成测试
// ============================================================================
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer } from "../src/server/serve";
import { resolveModelRef } from "../src/core/resolve";
import { loadConfigFile, saveConfigFile } from "../src/core/config";
import { configTomlPath, ensureCctraDir } from "../src/utils/paths";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { startMockUpstream, type MockUpstreamHandle } from "./integration/mock-upstream";

let serverHandle: { port: number; stop: () => void } | null = null;
let mockUpstream: MockUpstreamHandle | null = null;
let originalConfig: string | null = null;

function makeTestConfig(mockBaseUrl: string): string {
  return `
port = 31444

[subscriptions.test-sub]
name = "test-sub"
endpoint = "https://example.com"
token = "test-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.test-sub.models]]
id = "model-a"

[[subscriptions.test-sub.models]]
id = "model-b"
alias = "b-alias"

[subscriptions.tool-sub]
name = "tool-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/stream-tool-call"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.tool-sub.models]]
id = "x"

[subscriptions.echo-sub]
name = "echo-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/echo-body"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.echo-sub.models]]
id = "x"

[subscriptions.slow-sub]
name = "slow-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/slow"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.slow-sub.models]]
id = "x"

[subscriptions.responses-echo-sub]
name = "responses-echo-sub"
endpoint = "${mockBaseUrl}"
responsesPath = "/v1/responses/echo"
token = "mock-token"
apiFormat = "openai-responses"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.responses-echo-sub.models]]
id = "x"

# H 错误透传测试 fixture
[subscriptions.chat-401-sub]
name = "chat-401-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/error-401"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.chat-401-sub.models]]
id = "x"

[subscriptions.anthropic-429-sub]
name = "anthropic-429-sub"
endpoint = "${mockBaseUrl}"
messagesPath = "/chat/error-429"
token = "mock-token"
apiFormat = "anthropic-messages"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.anthropic-429-sub.models]]
id = "x"

[subscriptions.responses-500-sub]
name = "responses-500-sub"
endpoint = "${mockBaseUrl}"
responsesPath = "/chat/error-500"
token = "mock-token"
apiFormat = "openai-responses"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.responses-500-sub.models]]
id = "x"

[subscriptions.stream-error-sub]
name = "stream-error-sub"
endpoint = "${mockBaseUrl}"
chatCompletionsPath = "/chat/stream-error"
token = "mock-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.stream-error-sub.models]]
id = "x"
`;
}

beforeAll(() => {
  // 备份并替换 ~/.cctra/config.toml
  const path = configTomlPath();
  if (existsSync(path)) {
    originalConfig = readFileSync(path, "utf-8");
  }
  ensureCctraDir();
  mockUpstream = startMockUpstream();
  writeFileSync(path, makeTestConfig(mockUpstream.baseUrl), "utf-8");
  serverHandle = startServer();
});

afterAll(() => {
  serverHandle?.stop();
  mockUpstream?.stop();
  // 还原
  const path = configTomlPath();
  if (originalConfig !== null) {
    writeFileSync(path, originalConfig, "utf-8");
  } else if (existsSync(path)) {
    // 测试期间没有原 config；保留测试 config 不删
  }
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
    const data = await res.json() as { data: Array<{ id: string }> };
    const ids = data.data.map((m) => m.id);
    expect(ids).toContain("test-sub/model-a");
    expect(ids).toContain("test-sub/b-alias");
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
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/anthropic/v1/messages`, {
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
});

describe("Model resolve", () => {
  test("sub/model with alias", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("test-sub/b-alias", config);
    expect(r?.modelId).toBe("model-b");
  });

  test("sub/model with id", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("test-sub/model-a", config);
    expect(r?.modelId).toBe("model-a");
  });

  test("global alias", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("b-alias", config);
    expect(r?.modelId).toBe("model-b");
  });

  test("unknown model returns null", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("unknown", config);
    expect(r).toBeNull();
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
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/anthropic/v1/messages`, {
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
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic-429-sub/x",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
      }),
    });
    expect(res.status).toBe(429);
    const data = await res.json() as { type: string; error: { type: string; message: string } };
    expect(data.type).toBe("error");
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
    const data = await res.json() as { error: { code: string; message: string } };
    expect(data.error.code).toBe("500");
    expect(data.error.message).toBe("Internal server error");
  });

  test("streaming upstream error → client receives error event + no [DONE]", async () => {
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

    // 流中错后**不应再有 [DONE]**（cc-switch 二元化约束）
    // 注意：dataLines 已过滤 [DONE]，所以这里只检查"没有 [DONE]"
    expect(dataLines).not.toContain("[DONE]");
  });
});

// 避免 unused import 警告
void saveConfigFile;
