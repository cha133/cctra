// ============================================================================
// POST /v1/responses 处理器
// ============================================================================
import { responsesToCanonical } from "../../convert/inbound/responses-to-canonical";
import { callUpstream, callUpstreamStream } from "../upstream";
import { canonicalToResponsesResponse } from "../../convert/outbound/canonical-to-responses";
import { responsesErrorBody } from "../error";
import { resolveRoute } from "../../core/routing";
import { chatStreamToCanonical } from "../../convert/streaming/inbound/chat-stream";
import { responsesStreamToCanonical } from "../../convert/streaming/inbound/responses-stream";
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
      const { upstreamStream, formatChunk } = await callUpstreamStream({
        route,
        canonical,
        clientFormat: "openai-responses",
      });
      // v1 简化：上游 stream 一律当 Chat SSE 解析
      const cstream = chatStreamToCanonical(upstreamStream);
      const encoder = new TextEncoder();
      const out = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of cstream) {
              const s = formatChunk(chunk);
              if (s) controller.enqueue(encoder.encode(s));
            }
          } catch (e) {
            logger.error(`[responses:stream] error: ${(e as Error).message}`);
          } finally {
            controller.close();
          }
        },
      });
      return new Response(out, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    } catch (e) {
      return Response.json(responsesErrorBody((e as Error).message), { status: 500 });
    }
  }

  try {
    const upstreamRes = await callUpstream({ route, canonical, clientFormat: "openai-responses" });
    return Response.json(canonicalToResponsesResponse(upstreamRes));
  } catch (e) {
    return Response.json(responsesErrorBody((e as Error).message), { status: 500 });
  }
}

// 抑制未用导入警告
void responsesStreamToCanonical;
