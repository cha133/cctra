// ============================================================================
// In-process Mock Upstream Server
// ---------------------------------------------------------------------------
// 启动一个 bun.serve()，按路径分发不同行为：
//   POST /chat/stream-tool-call    模拟 OpenAI Chat 流式 tool_call（多 chunk arguments）
//   POST /chat/stream-text         普通流式 text
//   POST /chat/echo-body           回显请求体（验证 multimodal）
//   POST /chat/slow                慢响应（每 N 秒一个 chunk）
//   POST /chat/track-abort         记录请求是否被 abort
//   POST /chat/error-401/429/500   返回 4xx/5xx 错误（验证错误码透传）
//   POST /chat/stream-error        返回 200 + SSE error event（验证流中错不发终止事件）
//   POST /chat/stream-throw        返回会让 Chat 流解析器抛普通 Error 的合法 SSE
//   POST /anthropic/messages/echo  回显 system + messages 数（cross-format 测试用）
//   POST /v1/responses/echo        回显 instructions + input 数（cross-format 测试用）
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
      // 错误端点（验证 H 错误码透传）
      if (path === "/chat/error-401") return chatErrorResponse(401, "Invalid API key");
      if (path === "/chat/error-429") return chatErrorResponse(429, "Rate limit exceeded");
      if (path === "/chat/error-500") return chatErrorResponse(500, "Internal server error");
      if (path === "/chat/stream-error") return chatStreamError();
      if (path === "/chat/stream-throw") return chatStreamThrow();
      // Anthropic Messages 路径（cross-format 测试用：验 cctra 转发到 Anthropic-messages 上游）
      if (path === "/anthropic/messages/echo") return anthropicEcho(body);
      // OpenAI Responses 路径（验证 L.2 上游协议修复）
      if (path === "/v1/responses/echo") return responsesEcho(body);
      if (path === "/v1/responses/stream-text") return responsesStreamText();
      if (path === "/v1/responses/stream-tool-call") return responsesStreamToolCall();
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

/** 4xx/5xx 错误响应：返回 JSON `{error: {message, type, code}}` 加对应 status */
function chatErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: "api_error", code: status } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 200 + text/event-stream + 中途发 `data: {"error":...}` chunk（验证流中错不发终止事件）*/
function chatStreamError(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 先发一段正常 content
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }],
      })));
      // 中途发 error chunk
      controller.enqueue(encoder.encode(sseChunk({
        error: { message: "stream interrupted", type: "api_error" },
      })));
      // 模拟某些上游会再发 [DONE]（验证 formatter 抑制）
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

/** 200 + 合法 SSE，但 tool_calls wire shape 错误，令流解析器抛普通 TypeError。 */
function chatStreamThrow(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        choices: [{ index: 0, delta: { tool_calls: 42 }, finish_reason: null }],
      })));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

// ---------- Anthropic Messages 模拟 ----------

/** 从 Anthropic request body 提取 system 文本（兼容 string 或 array-of-blocks 形态） */
function extractSystemText(body: unknown): string {
  const sys = (body as { system?: string | Array<{ text?: string }> } | null)?.system;
  if (typeof sys === "string") return sys;
  if (Array.isArray(sys)) return sys.map((b) => b?.text ?? "").join("");
  return "";
}

/** 非流式：回显 system + messages 数作为 output_text（cross-format 测试用） */
function anthropicEcho(body: unknown): Response {
  const sysText = extractSystemText(body);
  const inputCount = Array.isArray((body as { messages?: unknown[] } | null)?.messages)
    ? (body as { messages: unknown[] }).messages.length
    : 0;
  return Response.json({
    id: "msg_test_echo",
    type: "message",
    role: "assistant",
    model: "mock-anthropic",
    content: [{ type: "text", text: `echo: ${sysText} (input_items=${inputCount})` }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 10 },
  });
}

// ---------- OpenAI Responses 模拟 ----------

/** SSE 行：OpenAI Responses 事件以 `event:` + `data:` 双行组成 */
function responsesEvent(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 非流式：回显 `instructions` 作为 output_text */
function responsesEcho(body: unknown): Response {
  const b = body as { instructions?: string; input?: unknown[] };
  return Response.json({
    id: "resp_mock_echo",
    object: "response",
    created_at: Date.now(),
    status: "completed",
    model: "mock-responses",
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: `echo: ${b.instructions ?? ""} (input_items=${(b.input ?? []).length})` }],
    }],
    usage: { input_tokens: 5, output_tokens: 10 },
  });
}

/** 流式：返回 1 段文本（response.created → output_text.delta → completed） */
function responsesStreamText(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(responsesEvent("response.created", {
        type: "response.created",
        response: { id: "resp_mock_text", object: "response", status: "in_progress", output: [] },
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: "msg_mock",
        output_index: 0,
        delta: "Hello",
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: "msg_mock",
        output_index: 0,
        delta: " world",
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.completed", {
        type: "response.completed",
        response: { id: "resp_mock_text", status: "completed", usage: { input_tokens: 5, output_tokens: 10 } },
      })));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

/** 流式：返回 1 个 function_call */
function responsesStreamToolCall(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(responsesEvent("response.created", {
        type: "response.created",
        response: { id: "resp_mock_tc", object: "response", status: "in_progress", output: [] },
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", id: "fc_mock", call_id: "call_xyz", name: "get_time", arguments: "" },
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: "fc_mock",
        output_index: 0,
        delta: '{"tz"',
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: "fc_mock",
        output_index: 0,
        delta: '":"UTC"}',
      })));
      controller.enqueue(encoder.encode(responsesEvent("response.completed", {
        type: "response.completed",
        response: { id: "resp_mock_tc", status: "completed", usage: { input_tokens: 5, output_tokens: 10 } },
      })));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
