// ============================================================================
// POST /v1/responses 处理器
// ============================================================================
import { responsesToCanonical } from "../../convert/inbound/responses-to-canonical";
import { callUpstream, callUpstreamStream, UpstreamError } from "../upstream";
import { canonicalToResponsesResponse } from "../../convert/outbound/canonical-to-responses";
import { responsesErrorBody } from "../error";
import { errorResponseToHttpStatus } from "../error-status";
import { resolveRoute } from "../../core/routing";
import { wrapWithKeepalive } from "../keepalive";
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
    try {
      const { upstreamStream, parser, format } = await callUpstreamStream({
        route,
        canonical,
        clientFormat: "openai-responses",
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
            logger.error(`[responses:stream] error: ${(e as Error).message}`);
            if (e instanceof UpstreamError) {
              // Responses 错误 SSE 事件：event: response.error / data: {...}
              // 注意：发完 error 后**不再发 response.completed**（cc-switch 二元化约束）
              const errEvent = `event: response.error\ndata: ${JSON.stringify({
                code: e.status?.toString() ?? "upstream_error",
                message: e.message,
              })}\n\n`;
              controller.enqueue(encoder.encode(errEvent));
            }
          } finally {
            controller.close();
          }
        },
      });
      return new Response(wrapWithKeepalive(inner), {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    } catch (e) {
      return Response.json(responsesErrorBody((e as Error).message), { status: 500 });
    }
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
