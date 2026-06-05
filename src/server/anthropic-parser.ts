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
