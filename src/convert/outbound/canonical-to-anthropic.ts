// ============================================================================
// Canonical → Anthropic Messages 响应
// ============================================================================
import type { CanonicalResponse, StopReason } from "../../canonical/types";

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }>;
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Anthropic 错误响应：{ type: "error", error: { type, message } } */
interface AnthropicErrorResponse {
  type: "error";
  error: { type: string; message: string };
}

export function canonicalToAnthropicResponse(res: CanonicalResponse): AnthropicResponse | AnthropicErrorResponse {
  // 错误响应：短路返回 Anthropic 错误 shape
  if (res.error) {
    return {
      type: "error",
      error: {
        type: res.error.type ?? "api_error",
        message: res.error.message,
      },
    };
  }

  const content: AnthropicResponse["content"] = [];
  for (const b of res.content) {
    if (b.type === "text") content.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    // 其他 block 类型（image / tool_result）不应出现在 assistant 消息里
  }

  return {
    id: res.id,
    type: "message",
    role: "assistant",
    model: res.model,
    content,
    stop_reason: res.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: res.usage.inputTokens,
      output_tokens: res.usage.outputTokens,
      ...(res.usage.cacheReadTokens !== undefined && { cache_read_input_tokens: res.usage.cacheReadTokens }),
      ...(res.usage.cacheWriteTokens !== undefined && { cache_creation_input_tokens: res.usage.cacheWriteTokens }),
    },
  };
}
