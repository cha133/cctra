// ============================================================================
// In-process Mock Upstream Server
// ---------------------------------------------------------------------------
// 启动一个 bun.serve()，按路径分发不同行为：
//   POST /chat/stream-tool-call    模拟 OpenAI Chat 流式 tool_call（多 chunk arguments）
//   POST /chat/stream-text         普通流式 text
//   POST /chat/echo-body           回显请求体（验证 multimodal）
//   POST /chat/slow                慢响应（每 N 秒一个 chunk）
//   POST /chat/track-abort         记录请求是否被 abort
//   GET  /v1/models                返回固定模型列表
// ============================================================================

export interface CapturedRequest {
  path: string;
  body: unknown;
  aborted: boolean;
  receivedAt: number;
}

export interface MockUpstreamHandle {
  port: number;
  baseUrl: string;
  captured: CapturedRequest[];
  stop: () => void;
}

export function startMockUpstream(): MockUpstreamHandle {
  const captured: CapturedRequest[] = [];

  const server = Bun.serve({
    port: 0, // random
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;
      const rec: CapturedRequest = { path, body: null, aborted: false, receivedAt: Date.now() };
      captured.push(rec);

      // 捕获 body
      let body: unknown = null;
      if (req.method === "POST") {
        try {
          const txt = await req.text();
          try { body = JSON.parse(txt); } catch { body = txt; }
        } catch { body = null; }
      }
      rec.body = body;

      // 监听 abort
      req.signal.addEventListener("abort", () => { rec.aborted = true; });

      if (path === "/chat/stream-tool-call") return chatStreamToolCall();
      if (path === "/chat/stream-text") return chatStreamText();
      if (path === "/chat/echo-body") return jsonEcho(body);
      if (path === "/chat/slow") return chatSlowStream(req.signal);
      if (path === "/chat/track-abort") return chatSlowStream(req.signal);
      if (path === "/v1/models") return Response.json({ data: [{ id: "mock-model" }] });

      return new Response("not found", { status: 404 });
    },
  });

  return {
    port: server.port ?? 0,
    baseUrl: `http://127.0.0.1:${server.port}`,
    captured,
    stop: () => server.stop(true),
  };
}

// ---------- Stream factories ----------

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** 模拟 OpenAI Chat 流式 tool_call：first delta 带 id+name+空 arguments，后续多块 arguments，finish_reason=tool_calls */
function chatStreamToolCall(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // role
      controller.enqueue(encoder.encode(sseChunk({
        id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "mock",
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      })));
      // tool_call 首块：id + name + 空 arguments
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: "" } }] } }],
      })));
      // arguments 增量 3 块
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"loc' } }] } }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ation":"' } }] } }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'Beijing"}' } }] } }],
      })));
      // finish
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function chatStreamText(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function jsonEcho(body: unknown): Response {
  // 模拟 OpenAI Chat 非流式响应，外层包装一下 body 作为 echoed metadata 返回
  return Response.json({
    id: "chatcmpl-echo",
    object: "chat.completion",
    created: 1,
    model: "mock",
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(body) },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

/** 慢流：发起一个 stream 但很久才结束；用于测 keepalive + abort */
function chatSlowStream(signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { role: "assistant", content: "tick" }, finish_reason: null }],
      })));
      // 模拟 30s 静默
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); });
      });
      if (!signal.aborted) {
        controller.enqueue(encoder.encode(sseChunk({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      try { controller.close(); } catch { /* 已关 */ }
    },
    cancel() { /* nothing — signal 监听里已处理 */ },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
