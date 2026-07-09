// ============================================================================
// POST /v1/responses 处理器
// ============================================================================
import { responsesToCanonical } from "../../convert/inbound/responses-to-canonical";
import { callUpstream, callUpstreamStream, UpstreamError } from "../upstream";
import { canonicalToResponsesResponse } from "../../convert/outbound/canonical-to-responses";
import { responsesErrorBody } from "../error";
import { errorResponseToHttpStatus } from "../error-status";
import { resolveRoute } from "../../core/routing";
import { loadConfigFile } from "../../core/config";
import { logger } from "../../utils/logger";

export async function handleResponses(req: Request): Promise<Response> {
  const config = loadConfigFile();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(responsesErrorBody("Invalid JSON body"), { status: 400 });
  }
  const b = body as { model?: string };
  if (!b.model) {
    return Response.json(responsesErrorBody("Missing 'model' field"), { status: 400 });
  }

  let route;
  try {
    route = resolveRoute(b.model, config);
  } catch (e) {
    return Response.json(responsesErrorBody((e as Error).message), { status: 400 });
  }

  const canonical = responsesToCanonical(body as Parameters<typeof responsesToCanonical>[0]);
  canonical.model = route.upstreamModelId;

  if (canonical.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let stopped = false;
        const ka = encoder.encode(": keepalive\n\n");
        const kaTimer = setInterval(() => {
          if (stopped) return;
          try { controller.enqueue(ka); } catch { stopped = true; }
        }, 2_000);

        try {
          const { upstreamStream, parser, format } = await callUpstreamStream({
            route, canonical, clientFormat: "openai-responses", clientSignal: req.signal,
          });
          const cstream = parser(upstreamStream);
          for await (const chunk of cstream) {
            if (stopped) break;
            for (const s of format(chunk)) controller.enqueue(encoder.encode(s));
          }
        } catch (e) {
          const msg = (e as Error).message;
          const errName = (e as Error).name;
          logger.error(`[responses:stream] error: ${msg} [${errName}]`);
          // error+completed 使用 event: 前缀格式（Codex 依赖 event: 分派事件）
          const errEvent = `event: response.error\ndata: ${JSON.stringify({ error: { message: msg }, type: "response.error" })}\n\n`;
          const doneEvent = `event: response.completed\ndata: ${JSON.stringify({ response: { id: `resp_${Date.now()}`, object: "response", model: canonical.model, status: "completed", output: [], incomplete_details: { reason: "upstream_error" } }, type: "response.completed" })}\n\n`;
          try {
            controller.enqueue(encoder.encode(errEvent + doneEvent + "data: [DONE]\n\n"));
            logger.info(`[responses:stream] error+completed forwarded to client OK`);
          } catch (enqErr) {
            logger.warn(`[responses:stream] failed to forward error to client (${(enqErr as Error).message}), stopped=${stopped}`);
          }
        } finally {
          stopped = true;
          clearInterval(kaTimer);
          try { controller.close(); } catch { /* 已关 */ }
        }
      },
      cancel() {
        logger.info(`[responses:stream] client cancelled (upstream disconnected)`);
        /* 客户端断开，无需额外清理 */
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  try {
    const upstreamRes = await callUpstream({
      route, canonical, clientFormat: "openai-responses", clientSignal: req.signal,
    });
    const body = canonicalToResponsesResponse(upstreamRes);
    const httpStatus = errorResponseToHttpStatus(upstreamRes);
    return httpStatus !== undefined
      ? Response.json(body, { status: httpStatus })
      : Response.json(body);
  } catch (e) {
    return Response.json(responsesErrorBody((e as Error).message), { status: 500 });
  }
}
