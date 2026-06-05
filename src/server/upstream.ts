// ============================================================================
// 上游转发 orchestrator：把 Canonical 请求转成上游协议，注入 auth，fetch，解析响应
// 同时支持 stream 和非 stream
// ============================================================================
import type { Source, Subscription, ApiFormat } from "../types";
import type { CanonicalRequest, CanonicalResponse, CanonicalChunk } from "../canonical/types";
import { canonicalToChatUpstream } from "../convert/upstream/canonical-to-chat";
import { canonicalToAnthropicUpstream } from "../convert/upstream/canonical-to-anthropic";
import { parseChatUpstreamResponse } from "./chat-parser";
import { parseAnthropicUpstreamResponse } from "./anthropic-parser";
import { logger } from "../utils/logger";

export interface UpstreamCallOptions {
  route: { source: Source; upstreamModelId: string; apiFormat: ApiFormat };
  canonical: CanonicalRequest;
  clientFormat: "openai-chat" | "openai-responses" | "anthropic-messages";
}

/** 非流式上游调用 */
export async function callUpstream(opts: UpstreamCallOptions): Promise<CanonicalResponse> {
  const ready = await resolveUpstream(opts.route);
  if (!ready) {
    return makeError(opts.route.upstreamModelId, "plugin_returned_no_config");
  }

  const upstreamBody = ready.apiFormat === "anthropic-messages"
    ? canonicalToAnthropicUpstream(opts.canonical)
    : canonicalToChatUpstream(opts.canonical);

  const url = joinUrl(ready.baseUrl, ready.path);
  logger.info(`[upstream] ${opts.route.apiFormat} → POST ${url} (model=${opts.canonical.model})`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...ready.authHeader,
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(60_000 * 5),
    });
  } catch (e) {
    return makeError(opts.route.upstreamModelId, `network_error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text();
    return makeError(opts.route.upstreamModelId, `upstream_${res.status}: ${text.slice(0, 500)}`);
  }

  const raw = await res.json();
  return ready.apiFormat === "anthropic-messages"
    ? parseAnthropicUpstreamResponse(raw, opts.route.upstreamModelId)
    : parseChatUpstreamResponse(raw, opts.route.upstreamModelId);
}

/** 流式上游调用 */
export async function callUpstreamStream(opts: UpstreamCallOptions): Promise<{
  upstreamStream: ReadableStream<Uint8Array>;
  formatChunk: (chunk: CanonicalChunk) => string;
}> {
  const ready = await resolveUpstream(opts.route);
  if (!ready) throw new Error("plugin_returned_no_config");

  const upstreamBody = ready.apiFormat === "anthropic-messages"
    ? canonicalToAnthropicUpstream(opts.canonical)
    : canonicalToChatUpstream(opts.canonical);

  const url = joinUrl(ready.baseUrl, ready.path);
  logger.info(`[upstream:stream] ${opts.route.apiFormat} → POST ${url} (model=${opts.canonical.model})`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...ready.authHeader,
    },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(60_000 * 5),
  });

  if (!res.ok || !res.body) {
    const text = res.body ? await res.text() : `upstream_${res.status}`;
    throw new Error(text.slice(0, 500));
  }

  return {
    upstreamStream: res.body,
    formatChunk: (chunk: CanonicalChunk): string => {
      if (opts.clientFormat === "openai-chat") return formatChatChunk(chunk);
      if (opts.clientFormat === "openai-responses") return formatResponsesChunk(chunk);
      return formatAnthropicChunk(chunk);
    },
  };
}

// ============================================================================
// 解析上游 ready config（subscription 直接用；plugin 调用 getConfig）
// ============================================================================

interface ReadyConfig {
  baseUrl: string;
  path: string;
  apiFormat: ApiFormat;
  authHeader: Record<string, string>;
}

async function resolveUpstream(route: UpstreamCallOptions["route"]): Promise<ReadyConfig | null> {
  const source = route.source;
  if (source.kind === "subscription") {
    const sub = source as Subscription;
    const path = sub.apiFormat === "anthropic-messages"
      ? (sub.messagesPath ?? "/v1/messages")
      : (sub.chatCompletionsPath ?? "/v1/chat/completions");
    return {
      baseUrl: sub.endpoint,
      path,
      apiFormat: sub.apiFormat,
      authHeader: { Authorization: `Bearer ${sub.token}`, ...sub.headers },
    };
  }
  // plugin
  if (source.kind !== "plugin") return null;
  const pluginCfg = source as unknown as import("../types").PluginConfig;
  const { loadPlugin } = await import("../plugin/loader");
  const { makePluginContext } = await import("../plugin/host");
  const { loadConfigFile } = await import("../core/config");
  const config = loadConfigFile();
  const plugin = await loadPlugin(pluginCfg, config);
  if (!plugin?.getConfig) return null;
  try {
    const ctx = makePluginContext(pluginCfg.name, pluginCfg.config);
    const result = await plugin.getConfig(ctx);
    const ready = Array.isArray(result) ? result[0] : result;
    if (!ready) return null;
    return {
      baseUrl: ready.baseUrl,
      path: ready.path,
      apiFormat: ready.apiFormat,
      authHeader: ready.authHeader,
    };
  } catch (e) {
    logger.error(`[plugin:${source.name}] getConfig failed: ${(e as Error).message}`);
    return null;
  }
}

// ============================================================================
// 流式客户端格式输出
// ============================================================================

function formatChatChunk(chunk: CanonicalChunk): string {
  if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
    return `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "",
      choices: [{ index: 0, delta: { content: chunk.delta.text }, finish_reason: null }],
    })}\n\n`;
  }
  if (chunk.type === "message_delta" && chunk.delta.stop_reason) {
    return `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "",
      choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(chunk.delta.stop_reason) }],
    })}\n\n`;
  }
  if (chunk.type === "message_stop") return "data: [DONE]\n\n";
  return "";
}

function formatResponsesChunk(chunk: CanonicalChunk): string {
  if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
    return `data: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: chunk.delta.text,
    })}\n\n`;
  }
  if (chunk.type === "message_stop") {
    return `data: ${JSON.stringify({ type: "response.completed" })}\n\ndata: [DONE]\n\n`;
  }
  return "";
}

function formatAnthropicChunk(chunk: CanonicalChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function mapStopReason(r: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error"): string {
  if (r === "max_tokens") return "length";
  if (r === "tool_use") return "tool_calls";
  if (r === "error") return "content_filter";
  return "stop";
}

function makeError(model: string, msg: string): CanonicalResponse {
  return {
    id: `error-${Date.now()}`,
    model,
    content: [{ type: "text", text: msg }],
    stopReason: "error",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (b.endsWith("/v1") && p.startsWith("/v1/")) return `${b}${p.slice(3)}`;
  if (b.endsWith("/v1beta") && p.startsWith("/v1beta/")) return `${b}${p.slice(7)}`;
  return `${b}${p}`;
}
