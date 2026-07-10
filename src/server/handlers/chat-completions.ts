// ============================================================================
// POST /v1/chat/completions 处理器
// ============================================================================
import type { Config } from "../../types";
import { chatToCanonical } from "../../convert/inbound/chat-to-canonical";
import { callUpstream, callUpstreamStream, UpstreamError } from "../upstream";
import { canonicalToChatResponse } from "../../convert/outbound/canonical-to-chat";
import { chatErrorBody } from "../error";
import { errorResponseToHttpStatus } from "../error-status";
import { resolveRoute } from "../../core/routing";
import { wrapWithKeepalive } from "../keepalive";
import { loadConfigFile } from "../../core/config";
import { logger } from "../../utils/logger";

export async function handleChatCompletions(req: Request): Promise<Response> {
  const config = loadConfigFile();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(chatErrorBody("Invalid JSON body"), { status: 400 });
  }
  const b = body as { model?: string };
  if (!b.model) {
    return Response.json(chatErrorBody("Missing 'model' field"), { status: 400 });
  }

  let route;
  try {
    route = resolveRoute(b.model, config);
  } catch (e) {
    return Response.json(chatErrorBody((e as Error).message), { status: 400 });
  }

  const canonical = chatToCanonical(body as Parameters<typeof chatToCanonical>[0]);
  // 用 route 的 upstreamModelId 覆盖（避免客户端用 alias 时传错）
  canonical.model = route.upstreamModelId;

  if (canonical.stream) {
    try {
      const { upstreamStream, parser, format } = await callUpstreamStream({
        route,
        canonical,
        clientFormat: "openai-chat",
        clientSignal: req.signal,
      });
      const cstream = parser(upstreamStream);
      const encoder = new TextEncoder();
      const inner = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of cstream) {
              for (const s of format(chunk)) controller.enqueue(encoder.encode(s));
            }
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`[chat-completions:stream] error: ${error.message}`);
            // 流已经返回 200，所有运行时异常都必须用协议内 error 事件通知客户端。
            // 发完 error 后直接关闭，不发送 [DONE]。
            const errEvent = `data: ${JSON.stringify({
              error: {
                message: error.message,
                type: "upstream_error",
                ...(e instanceof UpstreamError ? { code: e.status } : {}),
              },
            })}\n\n`;
            controller.enqueue(encoder.encode(errEvent));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(wrapWithKeepalive(inner), {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    } catch (e) {
      return Response.json(chatErrorBody((e as Error).message), { status: 500 });
    }
  }

  // 非流式
  try {
    const upstreamRes = await callUpstream({
      route, canonical, clientFormat: "openai-chat", clientSignal: req.signal,
    });
    const body = canonicalToChatResponse(upstreamRes);
    const httpStatus = errorResponseToHttpStatus(upstreamRes);
    return httpStatus !== undefined
      ? Response.json(body, { status: httpStatus })
      : Response.json(body);
  } catch (e) {
    return Response.json(chatErrorBody((e as Error).message), { status: 500 });
  }
}

// 抑制未用导入警告（config 未来会用）
void (null as unknown as Config);
