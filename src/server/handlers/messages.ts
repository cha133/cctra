// ============================================================================
// POST /v1/messages 处理器
// ============================================================================
import { anthropicToCanonical } from "../../convert/inbound/anthropic-to-canonical";
import { callUpstream, callUpstreamStream, UpstreamError } from "../upstream";
import { canonicalToAnthropicResponse } from "../../convert/outbound/canonical-to-anthropic";
import { anthropicErrorBody } from "../error";
import { errorResponseToHttpStatus } from "../error-status";
import { resolveRoute } from "../../core/routing";
import { wrapWithKeepalive } from "../keepalive";
import { loadConfigFile } from "../../core/config";
import { logger } from "../../utils/logger";

export async function handleMessages(req: Request): Promise<Response> {
  const config = loadConfigFile();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(anthropicErrorBody("Invalid JSON body"), { status: 400 });
  }
  const b = body as { model?: string };
  if (!b.model) {
    return Response.json(anthropicErrorBody("Missing 'model' field"), { status: 400 });
  }

  let route;
  try {
    route = resolveRoute(b.model, config);
  } catch (e) {
    return Response.json(anthropicErrorBody((e as Error).message), { status: 400 });
  }

  const canonical = anthropicToCanonical(body as Parameters<typeof anthropicToCanonical>[0]);
  canonical.model = route.upstreamModelId;

  if (canonical.stream) {
    try {
      const { upstreamStream, parser, format } = await callUpstreamStream({
        route,
        canonical,
        clientFormat: "anthropic-messages",
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
            const msg = (e as Error).message;
            logger.error(`[messages:stream] error: ${msg}`);
            // 所有流式错误都转发给客户端，使用标准 Anthropic error type (api_error)
            // 让 Claude Code 能识别并正确处理，避免无限挂起
            const errEvent = `event: error\ndata: ${JSON.stringify({
              type: "error",
              error: { type: "api_error", message: msg },
            })}\n\n`;
            try { controller.enqueue(encoder.encode(errEvent)); } catch { /* 客户端已断开 */ }
          } finally {
            controller.close();
          }
        },
      });
      return new Response(wrapWithKeepalive(inner), {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    } catch (e) {
      return Response.json(anthropicErrorBody((e as Error).message), { status: 500 });
    }
  }

  try {
    const upstreamRes = await callUpstream({
      route, canonical, clientFormat: "anthropic-messages", clientSignal: req.signal,
    });
    const body = canonicalToAnthropicResponse(upstreamRes);
    const httpStatus = errorResponseToHttpStatus(upstreamRes);
    return httpStatus !== undefined
      ? Response.json(body, { status: httpStatus })
      : Response.json(body);
  } catch (e) {
    return Response.json(anthropicErrorBody((e as Error).message), { status: 500 });
  }
}
