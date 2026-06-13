// ============================================================================
// 上游响应解析：Anthropic Messages → CanonicalResponse
// ============================================================================
import type { CanonicalResponse, CanonicalContentBlock } from "../canonical/types";

interface AnthropicUpstreamResponse {
  id?: string;
  model?: string;
  content?: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "thinking"; thinking: string; signature?: string }
    | { type: "redacted_thinking"; data: string }
  >;
  stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function parseAnthropicUpstreamResponse(raw: unknown, model: string): CanonicalResponse {
  const r = raw as AnthropicUpstreamResponse;
  const blocks: CanonicalContentBlock[] = [];
  for (const b of r.content ?? []) {
    if (b.type === "text") blocks.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") blocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    else if (b.type === "thinking") blocks.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
    else if (b.type === "redacted_thinking") {
      // 降级为占位 text + extras 保留 data（与 inbound 对称；不引入新 canonical 变体）
      blocks.push({ type: "text", text: "[redacted_thinking]", extras: { anthropic: { data: b.data } } });
    }
  }

  return {
    id: r.id ?? `msg-${Date.now()}`,
    model: r.model ?? model,
    content: blocks,
    stopReason: r.stop_reason ?? "end_turn",
    usage: {
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
      cacheReadTokens: r.usage?.cache_read_input_tokens,
      cacheWriteTokens: r.usage?.cache_creation_input_tokens,
    },
  };
}
