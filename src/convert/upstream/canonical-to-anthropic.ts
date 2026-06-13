// ============================================================================
// Canonical → Anthropic Messages 请求（发给 Anthropic 上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock, StopReason } from "../../canonical/types";
import { mergeExtras } from "../common/extras";

// Anthropic 合法 stop_reason 值：end_turn | max_tokens | stop_sequence | tool_use | refusal
// canonical StopReason 里的 "error" 必须落到 refusal（上游 content_filter 等价）
export type AnthropicStopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "refusal";

export function mapStopReasonToAnthropic(r: StopReason): AnthropicStopReason {
  if (r === "error") return "refusal";
  return r;
}

interface AnthropicUpstreamRequest {
  model: string;
  // system 可以是 string（无 per-block 元数据时）或 Array<{ type: "text"; text: string; ... }>（带 cache_control 等 extras 时）
  system?: string | Array<{ type: "text"; text: string; [k: string]: unknown }>;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<AnthropicContentBlock>;
  }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream: boolean;
  // 让 Anthropic thinking 模型按 effort 估算预算（粗略映射）
  thinking?: { type: "enabled"; budget_tokens: number };
  // forward-compat: 顶层 extras.anthropic（metadata / context_management / mcp_servers 等）一并 spread
  [k: string]: unknown;
}

// 每个变体都加 `[k: string]: unknown` —— 允许 cache_control 等 forward-compat 字段在 wire 出现
// （mergeExtras 会注入；TS 需要知道这是合法的）
type AnthropicContentBlock =
  | { type: "text"; text: string; [k: string]: unknown }
  | { type: "image"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string }; [k: string]: unknown }
  | { type: "document"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string }; [k: string]: unknown }
  | { type: "tool_use"; id: string; name: string; input: unknown; [k: string]: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean; [k: string]: unknown }
  | { type: "thinking"; thinking: string; signature?: string; [k: string]: unknown };

export function canonicalToAnthropicUpstream(req: CanonicalRequest): AnthropicUpstreamRequest {
  const messages: AnthropicUpstreamRequest["messages"] = req.messages.map((m) => {
    // 短路条件：单 text block 且无 extras → 直接 emit 字符串（wire 简洁）
    // 有 extras → 必须走数组形态才能透传 cache_control / redacted_data 等
    const first = m.content[0];
    const msgContent = m.content.length === 1 && first?.type === "text" && !first.extras
      ? first.text
      : m.content.map(blockToAnthropic);
    return {
      role: m.role,
      content: msgContent,
      // 透传 message 级别未识别字段
      ...(m.extras?.anthropic ?? {}),
    };
  });

  // system：所有 block 都没 extras → flatten 成 string（保持现状，零回归）；
  // 任意 block 有 extras → 输出数组形态，per-block 字段完整保留（cache_control 等）
  let system: string | Array<{ type: "text"; text: string; [k: string]: unknown }> | undefined;
  if (typeof req.system === "string") {
    system = req.system;
  } else if (Array.isArray(req.system)) {
    const hasExtras = req.system.some((b) => b.extras && Object.keys(b.extras).length > 0);
    if (!hasExtras) {
      system = req.system.map((b) => b.type === "text" ? b.text : "").join("");
    } else {
      system = req.system.map((b) => {
        const flat: { type: "text"; text: string; [k: string]: unknown } = {
          type: "text" as const,
          text: b.type === "text" ? b.text : "",
        };
        if (b.extras?.anthropic) Object.assign(flat, b.extras.anthropic);
        return flat;
      });
    }
  }

  return {
    model: req.model,
    system,
    messages,
    tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    top_p: req.topP,
    stop_sequences: req.stopSequences,
    stream: req.stream,
    thinking: req.reasoning?.effort ? { type: "enabled", budget_tokens: effortToBudget(req.reasoning.effort) } : undefined,
    // 顶层 extras spread（metadata / context_management / mcp_servers 等）
    ...(req.extras?.anthropic ?? {}),
  };
}

function effortToBudget(effort: "low" | "medium" | "high"): number {
  switch (effort) {
    case "low": return 1024;
    case "medium": return 4096;
    case "high": return 16_384;
  }
}

function blockToAnthropic(b: CanonicalContentBlock): AnthropicContentBlock {
  switch (b.type) {
    case "text":
      return mergeExtras({ type: "text", text: b.text } as AnthropicContentBlock, b.extras, "anthropic");
    case "image": {
      const src = b.source;
      const built: AnthropicContentBlock = src.kind === "base64"
        ? { type: "image", source: { type: "base64", media_type: src.mediaType, data: src.data } }
        : { type: "image", source: { type: "url", media_type: src.mediaType, url: src.data } };
      return mergeExtras(built, b.extras, "anthropic");
    }
    case "document": {
      const src = b.source;
      const built: AnthropicContentBlock = src.kind === "base64"
        ? { type: "document", source: { type: "base64", media_type: src.mediaType, data: src.data } }
        : { type: "document", source: { type: "url", media_type: src.mediaType, url: src.data } };
      return mergeExtras(built, b.extras, "anthropic");
    }
    case "tool_use": {
      const built: AnthropicContentBlock = { type: "tool_use", id: b.id, name: b.name, input: b.input };
      return mergeExtras(built, b.extras, "anthropic");
    }
    case "tool_result": {
      const built: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: b.toolUseId,
        content: typeof b.content === "string" ? b.content : b.content.map((cb) => cb.type === "text" ? cb.text : "").join(""),
        is_error: b.isError,
      };
      return mergeExtras(built, b.extras, "anthropic");
    }
    case "thinking": {
      // 原生 thinking block + 透传 signature（如果有）+ extras
      const built: AnthropicContentBlock = { type: "thinking", thinking: b.thinking, ...(b.signature ? { signature: b.signature } : {}) };
      return mergeExtras(built, b.extras, "anthropic");
    }
    case "refusal":
      // Anthropic 无 refusal block；降级为加前缀的 text
      return mergeExtras({ type: "text", text: `[refusal] ${b.refusal}` } as AnthropicContentBlock, b.extras, "anthropic");
  }
}
