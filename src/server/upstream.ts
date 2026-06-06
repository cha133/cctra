// ============================================================================
// 上游转发 orchestrator：把 Canonical 请求转成上游协议，注入 auth，fetch，解析响应
// 同时支持 stream 和非 stream
// ============================================================================
import type { Source, Subscription, ApiFormat } from "../types";
import type { CanonicalRequest, CanonicalResponse, CanonicalChunk } from "../canonical/types";
import { canonicalToChatUpstream } from "../convert/upstream/canonical-to-chat";
import { canonicalToAnthropicUpstream } from "../convert/upstream/canonical-to-anthropic";
import { canonicalToResponses } from "../convert/upstream/canonical-to-responses";
import { parseChatUpstreamResponse } from "./chat-parser";
import { parseAnthropicUpstreamResponse } from "./anthropic-parser";
import { parseResponsesResponse } from "./responses-parser";
import { pickInboundStreamParser, type InboundStreamParser } from "../convert/streaming/inbound/pick";
import { ChatStreamFormatter } from "../convert/streaming/outbound/format-chat";
import { ResponsesStreamFormatter } from "../convert/streaming/outbound/format-responses";
import { AnthropicStreamFormatter } from "../convert/streaming/outbound/format-anthropic";
import { cancelableFetch } from "./cancelable-fetch";
import { logger } from "../utils/logger";
import type { CanonicalResponseError } from "../canonical/types";

/**
 * 流式路径专用 typed error：携带上游 HTTP status 给 handler 决定 HTTP 响应。
 * HTTP 4xx/5xx 到达 `callUpstreamStream` 时直接 throw，handler 在 SSE 流内发 error event。
 */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface UpstreamCallOptions {
  route: { source: Source; upstreamModelId: string; apiFormat: ApiFormat };
  canonical: CanonicalRequest;
  clientFormat: "openai-chat" | "openai-responses" | "anthropic-messages";
  /** 客户端 req.signal；为 undefined 时只用上游 5min 硬超时 */
  clientSignal?: AbortSignal;
}

/** 非流式上游调用 */
export async function callUpstream(opts: UpstreamCallOptions): Promise<CanonicalResponse> {
  const ready = await resolveUpstream(opts.route);
  if (!ready) {
    return makeError(opts.route.upstreamModelId, "plugin_returned_no_config", { type: "plugin_error" });
  }

  const upstreamBody = pickUpstreamSerializer(ready.apiFormat)(opts.canonical);

  const url = joinUrl(ready.baseUrl, ready.path);
  logger.info(`[upstream] ${opts.route.apiFormat} → POST ${url} (model=${opts.canonical.model})`);

  let res: Response;
  try {
    res = await cancelableFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...ready.authHeader,
      },
      body: JSON.stringify(upstreamBody),
    }, opts.clientSignal);
  } catch (e) {
    return makeError(
      opts.route.upstreamModelId,
      `network_error: ${(e as Error).message}`,
      { type: "network_error" },
    );
  }

  if (!res.ok) {
    const text = await res.text();
    // 优先抽 body 的 error.message（OpenAI/Anthropic/Responses 标准 shape），
    // 抽不到时回退到 raw text 截 500 字符
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") {
        message = parsed.error.message.slice(0, 500);
      }
    } catch { /* 非 JSON body，保持 raw text */ }
    return makeError(
      opts.route.upstreamModelId,
      message,
      { status: res.status, type: "upstream_error" },
    );
  }

  const raw = await res.json();
  return pickUpstreamParser(ready.apiFormat)(raw, opts.route.upstreamModelId);
}

/** 流式上游调用 */
export interface UpstreamStream {
  upstreamStream: ReadableStream<Uint8Array>;
  /** 按 ready.apiFormat（真实上游协议）选 inbound 解析器 */
  parser: InboundStreamParser;
  /** 按 clientFormat 选输出格式化器；返回 0+ SSE 行（含 \n\n） */
  format: (chunk: CanonicalChunk) => string[];
}

export async function callUpstreamStream(opts: UpstreamCallOptions): Promise<UpstreamStream> {
  const ready = await resolveUpstream(opts.route);
  if (!ready) throw new Error("plugin_returned_no_config");

  const upstreamBody = pickUpstreamSerializer(ready.apiFormat)(opts.canonical);

  const url = joinUrl(ready.baseUrl, ready.path);
  logger.info(`[upstream:stream] ${opts.route.apiFormat} → POST ${url} (model=${opts.canonical.model})`);

  const res = await cancelableFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...ready.authHeader,
    },
    body: JSON.stringify(upstreamBody),
  }, opts.clientSignal);

  if (!res.ok || !res.body) {
    const text = res.body ? await res.text() : `upstream_${res.status}`;
    throw new UpstreamError(res.status, text.slice(0, 500), text.slice(0, 500));
  }

  // 关键：parser 用 ready.apiFormat（plugin 真实返回），不是 route.apiFormat（plugin 占位）
  const parser = pickInboundStreamParser(ready.apiFormat);

  const formatter = opts.clientFormat === "openai-chat" ? new ChatStreamFormatter()
    : opts.clientFormat === "openai-responses" ? new ResponsesStreamFormatter()
    : new AnthropicStreamFormatter();

  return {
    upstreamStream: res.body,
    parser,
    format: (chunk) => formatter.format(chunk),
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
    const path = pickUpstreamPath(sub);
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

function makeError(
  model: string,
  msg: string,
  opts?: { status?: number; type?: CanonicalResponseError["type"] },
): CanonicalResponse {
  const base = {
    id: `error-${Date.now()}`,
    model,
    content: [{ type: "text", text: msg }] as CanonicalResponse["content"],
    stopReason: "error" as const,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  if (opts?.status === undefined && !opts?.type) return base;
  return {
    ...base,
    error: {
      message: msg,
      ...(opts.status !== undefined && { status: opts.status }),
      ...(opts.type && { type: opts.type }),
    },
  };
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (b.endsWith("/v1") && p.startsWith("/v1/")) return `${b}${p.slice(3)}`;
  if (b.endsWith("/v1beta") && p.startsWith("/v1beta/")) return `${b}${p.slice(7)}`;
  return `${b}${p}`;
}

// ============================================================================
// 工厂函数：按 apiFormat 选上游 serializer / parser / path
// ============================================================================

type UpstreamSerializer = (req: CanonicalRequest) => unknown;
type UpstreamParser = (raw: unknown, model: string) => CanonicalResponse;

function pickUpstreamSerializer(format: ApiFormat): UpstreamSerializer {
  switch (format) {
    case "openai-chat":        return canonicalToChatUpstream;
    case "openai-responses":   return canonicalToResponses;
    case "anthropic-messages": return canonicalToAnthropicUpstream;
  }
}

function pickUpstreamParser(format: ApiFormat): UpstreamParser {
  switch (format) {
    case "openai-chat":        return parseChatUpstreamResponse;
    case "openai-responses":   return parseResponsesResponse;
    case "anthropic-messages": return parseAnthropicUpstreamResponse;
  }
}

function pickUpstreamPath(sub: Subscription): string {
  switch (sub.apiFormat) {
    case "openai-chat":        return sub.chatCompletionsPath ?? "/v1/chat/completions";
    case "openai-responses":   return sub.responsesPath ?? "/v1/responses";
    case "anthropic-messages": return sub.messagesPath ?? "/v1/messages";
  }
}
