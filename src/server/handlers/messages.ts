// ============================================================================
// POST /anthropic/v1/messages 处理器
// ============================================================================
import { anthropicToCanonical } from "../../convert/inbound/anthropic-to-canonical";
import { callUpstream, callUpstreamStream } from "../upstream";
import { canonicalToAnthropicResponse } from "../../convert/outbound/canonical-to-anthropic";
import { anthropicErrorBody } from "../error";
import { resolveRoute } from "../../core/routing";
import { anthropicStreamToCanonical } from "../../convert/streaming/inbound/anthropic-stream";
import { chatStreamToCanonical } from "../../convert/streaming/inbound/chat-stream";
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
      const { upstreamStream, formatChunk } = await callUpstreamStream({
        route,
        canonical,
        clientFormat: "anthropic-messages",
      });
      // v1 简化：上游 stream 一律当 Chat SSE 解析
      const cstream = route.apiFormat === "anthropic-messages"
        ? anthropicStreamToCanonical(upstreamStream)
        : chatStreamToCanonical(upstreamStream);
      const encoder = new TextEncoder();
      const out = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of cstream) {
              const s = formatChunk(chunk);
              if (s) controller.enqueue(encoder.encode(s));
            }
          } catch (e) {
            logger.error(`[messages:stream] error: ${(e as Error).message}`);
          } finally {
            controller.close();
          }
        },
      });
      return new Response(out, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    } catch (e) {
      return Response.json(anthropicErrorBody((e as Error).message), { status: 500 });
    }
  }

  try {
    const upstreamRes = await callUpstream({ route, canonical, clientFormat: "anthropic-messages" });
    return Response.json(canonicalToAnthropicResponse(upstreamRes));
  } catch (e) {
    return Response.json(anthropicErrorBody((e as Error).message), { status: 500 });
  }
}
