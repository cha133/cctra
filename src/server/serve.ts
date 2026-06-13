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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}
