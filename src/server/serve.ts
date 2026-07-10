// ============================================================================
// HTTP 服务器入口：Bun.serve() + 路由表
// ============================================================================
import { handleChatCompletions } from "./handlers/chat-completions";
import { handleResponses } from "./handlers/responses";
import { handleMessages } from "./handlers/messages";
import { handleModels } from "./handlers/models";
import { loadConfigFile } from "../core/config";
import { logger } from "../utils/logger";

export function startServer(portOverride?: number): { port: number; stop: () => void } {
  const config = loadConfigFile();
  const port = portOverride ?? config.port;

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    development: false,

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // CORS 预检
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(),
        });
      }

      // 健康检查
      if (url.pathname === "/healthz") {
        return Response.json({ ok: true, port });
      }

      // OpenAI Chat Completions
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        return handleChatCompletions(req);
      }

      // OpenAI Responses
      if (url.pathname === "/v1/responses" && req.method === "POST") {
        return handleResponses(req);
      }

      // Anthropic Messages
      if (url.pathname === "/v1/messages/count_tokens" && req.method === "POST") {
        return handleCountTokens(req);
      }

      if (url.pathname === "/v1/messages" && req.method === "POST") {
        return handleMessages(req);
      }

      // Models listing
      if (url.pathname === "/v1/models" && req.method === "GET") {
        return handleModels();
      }

      // 未匹配的路径一律 404
      return new Response(`Not Found: ${url.pathname}`, {
        status: 404,
        headers: corsHeaders(),
      });
    },
  });

  const actualPort = server.port ?? port;
  logger.info(`cctra listening on http://127.0.0.1:${actualPort}`);

  return {
    port: actualPort,
    stop: () => server.stop(),
  };
}

/**
 * 估算输入的 token 数量（从 JSON body 的文本内容）。
 * Anthropic count_tokens API 的替代实现。
 * 不准确但足够用于 token 展示和上下文窗口管理。
 */
function estimateInputTokens(body: unknown): number {
  let totalChars = 0;

  function addText(value: unknown): void {
    if (typeof value === "string") {
      totalChars += value.length;
    } else if (Array.isArray(value)) {
      for (const item of value) addText(item);
    } else if (value && typeof value === "object") {
      for (const val of Object.values(value as Record<string, unknown>)) {
        if (typeof val === "string") totalChars += val.length;
        else if (val && typeof val === "object") addText(val);
      }
    }
  }

  addText(body);
  // 通用估算：约 3.5 字符/Token（混合中英文 + JSON 结构开销）
  return Math.max(1, Math.ceil(totalChars / 3.5));
}

async function handleCountTokens(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const inputTokens = estimateInputTokens(body);
    return Response.json({ input_tokens: inputTokens });
  } catch {
    return Response.json(
      { error: { type: "invalid_request_error", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}
